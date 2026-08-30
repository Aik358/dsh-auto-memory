# -*- coding: utf-8 -*-
"""Export a deterministic offline CI fixture from a chosen model+policy.

The fixture contains real benchmark vectors (float64 JSON) for a fixed
query/doc subset plus the expected exact-cosine ranking computed here.
CI (smoke-test-m72-pre.mjs) recomputes cosine ordering in pure JS and
asserts equality - no network, no model download, no Python at test time.
"""
import json
import os

import numpy as np

import m7b_config as C
import m7b_corpus as corpus
from m7b_chunker import chunk_record
from m7b_embed import EmbedModel, PeakRss
from m7b_run import MANIFEST, config_hash, rank_list

FIXTURE_QUERIES = ["q001", "q011", "q023", "q032", "q053", "q085", "q111", "q131"]
# doc subset: gold docs + confusable twins + xws mirrors + a few distractors
FIXTURE_RECORDS = [
    "r001", "r002", "r003", "r010",        # zh2en golds
    "r011", "r014", "r020",                # en2zh golds
    "r021", "r023", "r024",                # mixed
    "r032", "r033", "r034", "r035", "r036", "r038",  # code
    "r053", "r054", "r058",                # hardneg twins
    "r087", "r088",                        # supersede pair (correction wins)
    "r111", "r112", "r113", "r114", "r115", "r116", "r117", "r118",
    "r119", "r120", "r121", "r122",        # xws core + all 6 mirrors
    "r131",                                # longdoc
    "d001", "d002", "d003", "d010", "d020", "d027", "d033",  # distractors
]


def main(model_name, policy_name):
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    rss = PeakRss()
    model = EmbedModel(model_name, manifest, rss)
    policy = C.CHUNK_POLICIES[policy_name]

    rec_by_id = {r["id"]: r for r in corpus.RECORDS}
    text_prefix = model.cfg["doc_prefix"]
    docs = []
    for rid in FIXTURE_RECORDS:
        rec = rec_by_id[rid]
        rec_text = text_prefix + rec["text"] if text_prefix else rec["text"]
        for ch in chunk_record(model.tokenizer, dict(rec, text=rec_text),
                               policy_name, policy):
            docs.append({"key": f"{rid}:{ch['ord']}", "record_id": rid,
                         "ws": rec["ws"], "scope": rec["scope"], **ch})
    doc_ids = [model.build_doc_ids(d["ids"]) for d in docs]
    doc_vecs = model.encode_ids(doc_ids, C.ENC_BATCH_DOCS).astype(np.float64)
    doc_norms = np.linalg.norm(doc_vecs, axis=1)

    q_by_id = {q["id"]: q for q in corpus.QUERIES}
    queries = [q_by_id[qid] for qid in FIXTURE_QUERIES]
    q_ids = [model.build_query_ids(q["text"]) for q in queries]
    q_vecs = model.encode_ids(q_ids, C.ENC_BATCH_QUERIES).astype(np.float64)

    out_queries = []
    for qi, q in enumerate(queries):
        # scope gate: expected ranking computed on the query-workspace view
        # (ws/other-project docs excluded from scoring, mirrors stay in the
        # fixture as decoys for the CI scope assertion)
        scoped = [di for di, d in enumerate(docs)
                  if d["ws"] == corpus.WS_CORE]
        sub = doc_vecs[scoped]
        scores = q_vecs[qi] @ sub.T
        top5_idx = rank_list(scores, [docs[scoped[i]] for i in range(len(scoped))], 5)
        top5 = [docs[scoped[i]]["key"] for i in top5_idx]
        top5_scores = [round(float(scores[i]), 6) for i in top5_idx]
        out_queries.append({
            "id": q["id"], "text": q["text"], "lang": q["lang"],
            "ws": corpus.WS_CORE,
            "vector": [round(float(x), 7) for x in q_vecs[qi]],
            "expected_top5": top5,
            "expected_top5_scores": top5_scores,
        })

    fixture = {
        "purpose": ("M7-2 offline CI fixture: deterministic exact-cosine "
                    "ordering over frozen vectors. CI MUST NOT download "
                    "models or call any embedding service."),
        "exportedAt": "2026-08-24",
        "model": {
            "provider": "local-hf-snapshot",
            "repo": model.cfg["repo_id"],
            "revision": model.cfg["revision"],
            "license": model.cfg["license"],
            "dimension": model.cfg["dimension"],
            "normalization": model.cfg["normalization"],
            "pooling": model.cfg["pooling"],
        },
        "policy": {
            "name": policy_name,
            "chunkingPolicyVersion": "m7_chunk_pre_v1",
            "params": policy,
        },
        "configHash": config_hash(model.cfg, policy_name, policy),
        "similarity": "exact cosine = dot of L2-normalized float vectors",
        "docs": [{
            "key": d["key"], "record_id": d["record_id"], "ws": d["ws"],
            "scope": d["scope"], "token_len": d["token_len"],
            "text": d["text"][:400],
            "vector": [round(float(x), 7) for x in doc_vecs[di]],
        } for di, d in enumerate(docs)],
        "doc_norm_min": round(float(doc_norms.min()), 6),
        "doc_norm_max": round(float(doc_norms.max()), 6),
        "queries": out_queries,
        "scope_rule": ("expected_top5 was computed on the WS_CORE-scoped "
                       "view; ws/other-project docs must never appear in "
                       "expected_top5"),
    }
    os.makedirs(os.path.dirname(C.FIXTURE_OUT), exist_ok=True)
    with open(C.FIXTURE_OUT, "w", encoding="utf-8") as f:
        json.dump(fixture, f, ensure_ascii=False, indent=1)
    print("fixture ->", C.FIXTURE_OUT,
          f"({os.path.getsize(C.FIXTURE_OUT)/1e6:.2f}MB, "
          f"{len(docs)} docs x {len(out_queries)} queries)")


if __name__ == "__main__":
    import sys
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "para-512-noov")
