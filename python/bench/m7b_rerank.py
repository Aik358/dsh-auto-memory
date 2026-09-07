# -*- coding: utf-8 -*-
"""M7-4 rerank benchmark (task set §8).

bge-reranker-v2-m3 (Apache-2.0, pinned) cross-encoder reranking the frozen
hybrid fusion top-50 -> top-10, over L1 + L2. Measures quality delta
(Recall@10/MRR/nDCG/hardneg/supersede), per-query latency (encode 50 pairs +
score), peak RSS, model load time. Timeout/unavailable semantics (keep
pre-rerank order) are production wiring concerns - validated in the worker
test, not here; this benchmark only proves the quality/speed budget.

Output: artifacts/m7-rerank-pre/results.{json,csv}
"""
import csv
import json
import os
import time

import numpy as np
import torch

import m7b_config as C
import m7b_corpus as corpus_l1
from m7b_chunker import chunk_record
from m7b_embed import EmbedModel, PeakRss
from m7b_hybrid import LexicalBM25, minmax, tokenize, evaluate_arm
from m7b_run import MANIFEST

OUT_DIR = r"D:\dsh-auto-memory\artifacts\m7-rerank-pre"
TOP_IN = 50
TOP_OUT = 10
NAME = "bge-reranker-v2-m3"


class Reranker:
    def __init__(self, manifest, rss):
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        m = manifest["models"][NAME]
        self.path = m["local_path"]
        self.revision = m["revision"]
        t0 = time.perf_counter()
        self.tok = AutoTokenizer.from_pretrained(self.path, revision=self.revision)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            self.path, revision=self.revision, dtype=torch.float32)
        self.model.eval()
        self.load_seconds = round(time.perf_counter() - t0, 2)
        rss.tick()

    def score_pairs(self, query, docs, batch=8, max_len=512):
        scores = []
        for i in range(0, len(docs), batch):
            part = docs[i:i + batch]
            enc = self.tok([query] * len(part), part, padding=True,
                           truncation=True, max_length=max_len,
                           return_tensors="pt")
            with torch.no_grad():
                logits = self.model(**enc).logits
            scores.extend(float(x) for x in logits[:, 0])
        return scores


def fused_top(model, records, queries, lex_topn=TOP_IN):
    """frozen hybrid fusion (dense .7 + lexical .3) -> top-50 ids per query."""
    policy = C.CHUNK_POLICIES["para-512-noov"]
    prefix = model.cfg["doc_prefix"]
    chunk_rows = []
    for rec in records:
        rt = prefix + rec["text"] if prefix else rec["text"]
        for ch in chunk_record(model.tokenizer, dict(rec, text=rt),
                               "para-512-noov", policy):
            chunk_rows.append((rec["id"], ch["ids"]))
    doc_vecs = model.encode_ids([model.build_doc_ids(c[1]) for c in chunk_rows],
                                C.ENC_BATCH_DOCS)
    uniq = list(dict.fromkeys(c[0] for c in chunk_rows))
    col_of = {rid: i for i, rid in enumerate(uniq)}
    q_vecs = model.encode_ids([model.build_query_ids(q["text"]) for q in queries],
                              C.ENC_BATCH_QUERIES)
    sims = q_vecs @ doc_vecs.T
    dense = np.zeros((len(queries), len(uniq)))
    for qi in range(len(queries)):
        for ci, rid in enumerate(c[0] for c in chunk_rows):
            j = col_of[rid]
            if sims[qi, ci] > dense[qi, j]:
                dense[qi, j] = sims[qi, ci]
    lex = LexicalBM25([tokenize(r["text"]) for r in records])
    rec_of = {r["id"]: r for r in records}
    out = []
    for qi, q in enumerate(queries):
        lex_scores = np.array([lex.score(tokenize(q["text"]), i)
                               for i in range(len(records))])
        comb = 0.7 * minmax(dense[qi]) + 0.3 * minmax(lex_scores)
        order = sorted(range(len(comb)), key=lambda i: (-float(comb[i]), uniq[i]))
        ids = [uniq[i] for i in order[:lex_topn]]
        out.append(ids)
    return out, rec_of


def main():
    from m7b_run import pct
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    rss = PeakRss()
    rss.reset_baseline()
    model = EmbedModel("bge-m3", manifest, rss)
    rr = Reranker(manifest, rss)

    eps = [json.loads(l) for l in open(
        r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\episodes.jsonl", encoding="utf-8")]
    l2_records = [{"id": e["episodeId"], "ws": e["workspace"], "scope": "Workspace",
                   "text": e["text"]} for e in eps]
    l2_queries = []
    for line in open(r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\multilingual-queries.jsonl",
                     encoding="utf-8"):
        q = json.loads(line)
        l2_queries.append({"id": q["qid"], "text": q["text"], "lang": q["lang"],
                           "cat": q["cat"], "gold": q["gold"], "neg": q["neg"],
                           "old": []})

    results = []
    for layer_name, records, queries in (
            ("L1", corpus_l1.RECORDS, corpus_l1.QUERIES),
            ("L2", l2_records, l2_queries)):
        print(f"[rerank] {layer_name} ...", flush=True)
        top50, rec_of = fused_top(model, records, queries)
        pre = evaluate_arm([t[:TOP_OUT] for t in top50], queries)
        results.append({"layer": layer_name, "arm": "fusion-top10 (no rerank)",
                        **pre})
        ranked, lat = [], []
        for q, ids in zip(queries, top50):
            t0 = time.perf_counter()
            scores = rr.score_pairs(q["text"], [rec_of[i]["text"] for i in ids])
            lat.append((time.perf_counter() - t0) * 1000)
            order = sorted(range(len(ids)),
                           key=lambda i: (-scores[i], ids[i]))[:TOP_OUT]
            ranked.append([ids[i] for i in order])
        post = evaluate_arm(ranked, queries)
        post.update({
            "latency_p50_ms": round(pct(lat, 50), 1),
            "latency_p95_ms": round(pct(lat, 95), 1),
            "pairs_per_query": TOP_IN,
        })
        results.append({"layer": layer_name,
                        "arm": "bge-reranker-v2-m3 top50->10", **post})
    env = {"reranker": NAME, "revision": rr.revision, "license": "Apache-2.0",
           "model_load_seconds": rr.load_seconds,
           "peak_rss_gb": round(rss.peak / 1e9, 2),
           "torch": torch.__version__}
    with open(os.path.join(OUT_DIR, "results.json"), "w", encoding="utf-8") as f:
        json.dump({"environment": env, "results": results},
                  f, ensure_ascii=False, indent=2)
    cols = ["layer", "arm", "recall@1", "recall@5", "recall@10", "mrr",
            "ndcg@10", "hardneg_error", "supersede_correct",
            "latency_p50_ms", "latency_p95_ms"]
    with open(os.path.join(OUT_DIR, "results.csv"), "w", newline="",
              encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in results:
            w.writerow(r)
    print("wrote", OUT_DIR)
    print(json.dumps(env, ensure_ascii=False))
    for r in results:
        print(f"{r['layer']:3s} {r['arm']:32s} R@5={r['recall@5']} "
              f"R@10={r['recall@10']} MRR={r['mrr']} hn={r['hardneg_error']} "
              f"sup={r.get('supersede_correct')} "
              f"p95={r.get('latency_p95_ms')}")


if __name__ == "__main__":
    main()
