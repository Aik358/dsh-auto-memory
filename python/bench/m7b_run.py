# -*- coding: utf-8 -*-
"""M7-2 benchmark orchestrator.

For each pinned model x chunk policy:
  - chunk the corpus with the model's own tokenizer
  - embed chunks (float32), L2-normalized, exact cosine via dot product
  - evaluate the query suite with workspace scope filtering
  - record quality, latency, memory, index-size metrics
Writes results/m7-2-results.{json,csv} and a summary to stdout.
No ANN, no FAISS, no graph. CPU only.
"""
import csv
import hashlib
import json
import math
import os
import platform
import time

import numpy as np
import psutil

import m7b_config as C
import m7b_corpus as corpus
from m7b_chunker import chunk_record
from m7b_embed import EmbedModel, PeakRss

MANIFEST = os.path.join(C.RESULTS_DIR, "model-manifest.json")


def config_hash(model_cfg, policy_name, policy):
    payload = json.dumps({
        "repo_id": model_cfg["repo_id"],
        "revision": model_cfg["revision"],
        "dimension": model_cfg["dimension"],
        "normalization": model_cfg["normalization"],
        "pooling": model_cfg["pooling"],
        "query_prefix": model_cfg["query_prefix"],
        "doc_prefix": model_cfg["doc_prefix"],
        "policy": policy_name,
        "policy_params": policy,
        "dtype": "float32",
    }, sort_keys=True)
    return "cfgh_" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def rank_list(scores, chunks, topn):
    """score desc, then record id asc, then chunk ord asc (contract tie-break)."""
    order = sorted(range(len(chunks)),
                   key=lambda i: (-float(scores[i]), chunks[i]["record_id"],
                                  chunks[i]["ord"]))
    return order[:topn]


def evaluate(queries, chunks, scores_matrix):
    """scores_matrix: [n_queries, n_chunks] over scope-filtered chunk view."""
    m = {
        "recall@1": [], "recall@5": [], "recall@10": [], "mrr": [],
        "ndcg@10": [],
        "hardneg_error": [], "supersede_correct": [],
        "xlang_recall@5": [], "xlang_mrr": [], "code_recall@5": [],
        "xws_mirror_top5_unscoped": [],
    }
    leaks = 0
    detail = []
    for qi, q in enumerate(queries):
        scores = scores_matrix[qi]
        order = sorted(range(len(chunks)),
                       key=lambda i: (-float(scores[i]), chunks[i]["record_id"],
                                      chunks[i]["ord"]))
        top10_order = order[:10]
        detail.append({
            "qid": q["id"],
            "gold": q["gold"],
            "top10": [chunks[i]["record_id"] for i in top10_order],
            "top10_scores": [round(float(scores[i]), 4) for i in top10_order],
        })
        top1 = [chunks[i]["record_id"] for i in order[:1]]
        top5 = [chunks[i]["record_id"] for i in order[:5]]
        top10 = [chunks[i]["record_id"] for i in order[:10]]
        gold_rank = next((r + 1 for r, i in enumerate(order)
                          if chunks[i]["record_id"] in q["gold"]), None)
        # nDCG@10: binary gain for gold records (supersede-old counts 0)
        dcg = sum(1.0 / math.log2(r + 2) for r, i in enumerate(top10_order)
                  if chunks[i]["record_id"] in q["gold"])
        ideal = sum(1.0 / math.log2(r + 2) for r in range(min(len(q["gold"]), 10)))
        m["ndcg@10"].append(dcg / ideal if ideal else 0.0)
        m["recall@1"].append(1 if q["gold"][0] in top1 else 0)
        m["recall@5"].append(1 if any(g in top5 for g in q["gold"]) else 0)
        m["recall@10"].append(1 if any(g in top10 for g in q["gold"]) else 0)
        m["mrr"].append(1.0 / gold_rank if gold_rank else 0.0)
        if q.get("neg"):
            neg_rank = next((r + 1 for r, i in enumerate(order)
                             if chunks[i]["record_id"] in q["neg"]), None)
            m["hardneg_error"].append(1 if (neg_rank and (not gold_rank or
                                        neg_rank < gold_rank)) else 0)
        if q.get("old"):
            old_rank = next((r + 1 for r, i in enumerate(order)
                             if chunks[i]["record_id"] in q["old"]), None)
            m["supersede_correct"].append(
                1 if (gold_rank and old_rank and gold_rank < old_rank) else 0)
        if q["cat"] in ("zh2en", "en2zh"):
            m["xlang_recall@5"].append(m["recall@5"][-1])
            m["xlang_mrr"].append(m["mrr"][-1])
        if q["cat"] == "code":
            m["code_recall@5"].append(m["recall@5"][-1])
    return m, leaks, detail


def pct(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    return s[min(len(s) - 1, int(round(p / 100.0 * (len(s) - 1))))]


def mean(vals):
    return round(sum(vals) / len(vals), 4) if vals else None


def run_combo(model: EmbedModel, policy_name, policy, records, queries, rss,
              layer="L1"):
    chunks = []
    # doc prefix (e5 "passage: ") is part of the embedded TEXT: prepend it to
    # the record before tokenizer-driven chunking so chunk[0] carries it.
    text_prefix = model.cfg["doc_prefix"]
    for rec in records:
        rec_text = text_prefix + rec["text"] if text_prefix else rec["text"]
        for ch in chunk_record(model.tokenizer, dict(rec, text=rec_text),
                               policy_name, policy):
            chunks.append({"record_id": rec["id"], "ws": rec["ws"],
                           "scope": rec["scope"], **ch})
    ids_list = [model.build_doc_ids(ch["ids"]) for ch in chunks]
    t0 = time.perf_counter()
    doc_vecs = model.encode_ids(ids_list, C.ENC_BATCH_DOCS)
    encode_secs = time.perf_counter() - t0
    rss.tick()

    # query side, scoped view: only chunks in the query's workspace
    query_ids = [model.build_query_ids(q["text"]) for q in queries]
    query_vecs = model.encode_ids(query_ids, C.ENC_BATCH_QUERIES)

    def query_view(qi):
        q = queries[qi]
        qws = q.get("ws")
        idx = [i for i, ch in enumerate(chunks)
               if qws in (None, "all") or ch["ws"] == qws]
        sub = doc_vecs[idx]
        return idx, sub, [chunks[i] for i in idx]

    lat_base_idx, lat_sub, _ = query_view(0)
    lat = []
    for it in range(C.LATENCY_WARMUP + C.LATENCY_ITERS):
        t1 = time.perf_counter()
        qv = model.encode_ids([query_ids[it % len(query_ids)]], 1)
        _ = qv @ lat_sub.T
        if it >= C.LATENCY_WARMUP:
            lat.append((time.perf_counter() - t1) * 1000.0)
        rss.tick()

    # unscoped diagnostic for xws queries: does the mirror intrude without gate
    un_scores = query_vecs @ doc_vecs.T
    mirror_top5 = []
    for qi, q in enumerate(queries):
        if not q.get("mirror"):
            continue
        order = rank_list(un_scores[qi], chunks, 5)
        ids5 = [chunks[i]["record_id"] for i in order]
        mirror_top5.append(1 if q["mirror"] in ids5 else 0)
    leak_count = 0
    all_scores = []
    for qi, q in enumerate(queries):
        idx, sub, sub_chunks_q = query_view(qi)
        s = query_vecs[qi] @ sub.T
        all_scores.append(s)
        if q.get("mirror"):
            top = rank_list(s, sub_chunks_q, 10)
            leak_count += sum(1 for i in top if sub_chunks_q[i]["ws"] != q["ws"])

    # simpler: evaluate per query with its own view, reusing rank logic
    m = {"recall@1": [], "recall@5": [], "recall@10": [], "mrr": [],
         "ndcg@10": [], "hardneg_error": [], "supersede_correct": [],
         "xlang_recall@5": [], "xlang_mrr": [], "code_recall@5": []}
    detail = []
    for qi, q in enumerate(queries):
        if not q.get("gold"):  # unresolved gold: skip defensively, count as miss
            for k in ("recall@1", "recall@5", "recall@10", "mrr", "ndcg@10"):
                m[k].append(0)
            detail.append({"qid": q["id"], "gold": [], "top10": [],
                           "top10_scores": []})
            continue
        idx, sub, sub_chunks_q = query_view(qi)
        s = all_scores[qi]
        order = sorted(range(len(sub)),
                       key=lambda i: (-float(s[i]), sub_chunks_q[i]["record_id"],
                                      sub_chunks_q[i]["ord"]))
        top10_order = order[:10]
        detail.append({
            "qid": q["id"], "gold": q["gold"],
            "top10": [sub_chunks_q[i]["record_id"] for i in top10_order],
            "top10_scores": [round(float(s[i]), 4) for i in top10_order],
        })
        top1 = [sub_chunks_q[i]["record_id"] for i in order[:1]]
        top5 = [sub_chunks_q[i]["record_id"] for i in order[:5]]
        top10 = [sub_chunks_q[i]["record_id"] for i in order[:10]]
        gold_rank = next((r + 1 for r, i in enumerate(order)
                          if sub_chunks_q[i]["record_id"] in q["gold"]), None)
        dcg = sum(1.0 / math.log2(r + 2) for r, i in enumerate(top10_order)
                  if sub_chunks_q[i]["record_id"] in q["gold"])
        ideal = sum(1.0 / math.log2(r + 2) for r in range(min(len(q["gold"]), 10)))
        m["ndcg@10"].append(dcg / ideal if ideal else 0.0)
        m["recall@1"].append(1 if q["gold"][0] in top1 else 0)
        m["recall@5"].append(1 if any(g in top5 for g in q["gold"]) else 0)
        m["recall@10"].append(1 if any(g in top10 for g in q["gold"]) else 0)
        m["mrr"].append(1.0 / gold_rank if gold_rank else 0.0)
        if q.get("neg"):
            neg_rank = next((r + 1 for r, i in enumerate(order)
                             if sub_chunks_q[i]["record_id"] in q["neg"]), None)
            m["hardneg_error"].append(1 if (neg_rank and (not gold_rank or
                                        neg_rank < gold_rank)) else 0)
        if q.get("old"):
            old_rank = next((r + 1 for r, i in enumerate(order)
                             if sub_chunks_q[i]["record_id"] in q["old"]), None)
            m["supersede_correct"].append(
                1 if (gold_rank and old_rank and gold_rank < old_rank) else 0)
        if q["cat"] in ("zh2en", "en2zh", "xlang"):
            m["xlang_recall@5"].append(m["recall@5"][-1])
            m["xlang_mrr"].append(m["mrr"][-1])
        if q["cat"] == "code":
            m["code_recall@5"].append(m["recall@5"][-1])
    result = {
        "layer": layer,
        "model": model.name,
        "policy": policy_name,
        "configHash": config_hash(model.cfg, policy_name, policy),
        "records": len(records),
        "queries": len(queries),
        "chunks": len(chunks),
        "chunks_per_record": round(len(chunks) / max(1, len(records)), 3),
        "avg_chunk_tokens": round(mean([c["token_len"] for c in chunks]) or 0, 1),
        "recall@1": mean(m["recall@1"]),
        "recall@5": mean(m["recall@5"]),
        "recall@10": mean(m["recall@10"]),
        "mrr": mean(m["mrr"]),
        "ndcg@10": mean(m["ndcg@10"]),
        "xlang_recall@5": mean(m["xlang_recall@5"]),
        "xlang_mrr": mean(m["xlang_mrr"]),
        "code_recall@5": mean(m["code_recall@5"]),
        "hardneg_error": mean(m["hardneg_error"]),
        "supersede_correct": mean(m["supersede_correct"]),
        "xws_mirror_top5_unscoped": (mean(mirror_top5) if mirror_top5 else None),
        "xws_scoped_leak": leak_count,
        "latency_encode_search_p50_ms": round(pct(lat, 50), 1),
        "latency_encode_search_p95_ms": round(pct(lat, 95), 1),
        "corpus_encode_seconds": round(encode_secs, 1),
        "corpus_encode_chunks_per_sec": round(len(chunks) / max(0.001, encode_secs), 1),
        "vector_index_bytes": int(doc_vecs.nbytes),
        "vector_index_bytes_per_chunk": int(doc_vecs.nbytes / max(1, len(chunks))),
        "peak_rss_mb": round(rss.peak / 1e6, 1),
        "model_load_seconds": model.load_seconds,
    }
    return result, chunks, doc_vecs, query_vecs, ids_list, None, detail


def main(models=None, policies=None, out_suffix=""):
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    rss = PeakRss()
    results = []
    lat_detail = {}
    for name in (models or list(C.MODELS)):
        rss.reset_baseline()
        model = EmbedModel(name, manifest, rss)
        base_rss_after_load = rss.peak
        for pname in (policies or list(C.CHUNK_POLICIES)):
            print(f"[run] {name} x {pname} ...", flush=True)
            res, chunks, doc_vecs, query_vecs, ids_list, scoped, detail = run_combo(
                model, pname, C.CHUNK_POLICIES[pname],
                corpus.RECORDS,
                [dict(q, ws=corpus.WS_CORE) for q in corpus.QUERIES],
                rss, layer="L1")
            res["model_load_seconds"] = model.load_seconds
            res["rss_mb_after_model_load"] = round(base_rss_after_load / 1e6, 1)
            res["query_detail"] = {d["qid"]: d for d in detail}
            results.append(res)
            print("     recall@5={recall@5} mrr={mrr} xlang@5={xlang_recall@5} "
                  "hardneg_err={hardneg_error} sup={supersede_correct} "
                  "p95={latency_encode_search_p95_ms}ms".format(**res), flush=True)
        del model  # free weights before next model
        import gc, torch
        gc.collect()

    env = {
        "cpu": platform.processor(),
        "logical_cores": psutil.cpu_count(logical=True),
        "ram_total_gb": round(psutil.virtual_memory().total / 1e9, 1),
        "torch": __import__("torch").__version__,
        "device": "cpu",
        "threads": C.TORCH_THREADS,
        "corpus": corpus.corpus_stats(),
    }
    out = {"environment": env, "results": results}
    jpath = os.path.join(C.RESULTS_DIR, f"m7-2-results{out_suffix}.json")
    with open(jpath, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    cols = ["model", "policy", "chunks", "chunks_per_record", "avg_chunk_tokens",
            "recall@1", "recall@5", "recall@10", "mrr", "ndcg@10", "xlang_recall@5",
            "xlang_mrr", "code_recall@5", "hardneg_error", "supersede_correct",
            "xws_mirror_top5_unscoped", "xws_scoped_leak",
            "latency_encode_search_p50_ms", "latency_encode_search_p95_ms",
            "corpus_encode_seconds", "corpus_encode_chunks_per_sec",
            "vector_index_bytes", "vector_index_bytes_per_chunk",
            "model_load_seconds", "rss_mb_after_model_load", "peak_rss_mb",
            "configHash"]
    cpath = os.path.join(C.RESULTS_DIR, f"m7-2-results{out_suffix}.csv")
    with open(cpath, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in results:
            w.writerow(r)
    print("wrote", jpath)
    print("wrote", cpath)


if __name__ == "__main__":
    import sys
    models = sys.argv[1].split(",") if len(sys.argv) > 1 and sys.argv[1] else None
    main(models=models)
