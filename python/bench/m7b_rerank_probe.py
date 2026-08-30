# -*- coding: utf-8 -*-
"""M7-4 candidate-2 probe: Qwen3-Reranker-0.6B quality+latency on a bounded
slice (10 queries x fusion-top10 pairs) - full-quality run of candidate 1
already proved rerank value; this probe establishes candidate 2's per-pair
cost and slice quality for the D9 decision without another full-hour run.

Qwen3 reranker recipe (model card): score = P('yes') via causal LM logits on
  <|im_start|>system Judge: ... <|im_end|><|im_start|>user
  Query: {q} Document: {d}<|im_end|><|im_start|>assistant<think>
  then compare logits of 'yes'/'no' first tokens.
"""
import json
import os
import time

import numpy as np
import torch

import m7b_config as C
import m7b_corpus as corpus_l1
from m7b_chunker import chunk_record
from m7b_embed import EmbedModel, PeakRss
from m7b_hybrid import LexicalBM25, evaluate_arm, minmax, tokenize
from m7b_rerank import fused_top
from m7b_run import MANIFEST

NAME = "qwen3-reranker-0.6b"
OUT = r"D:\dsh-auto-memory\artifacts\m7-rerank-pre"
NQ = 10
TOPK = 10

PREFIX = "<|im_start|>system\nJudge whether the Document meets the Query's requirements: choose 'yes' or 'no'.<|im_end|>\n<|im_start|>user\n"
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"


class QwenReranker:
    def __init__(self, manifest, rss):
        from transformers import AutoModelForCausalLM, AutoTokenizer
        m = manifest["models"][NAME]
        t0 = time.perf_counter()
        self.tok = AutoTokenizer.from_pretrained(m["local_path"],
                                                 revision=m["revision"])
        self.model = AutoModelForCausalLM.from_pretrained(
            m["local_path"], revision=m["revision"], dtype=torch.float32)
        self.model.eval()
        self.load_seconds = round(time.perf_counter() - t0, 2)
        self.yes_id = self.tok.encode("yes")[0]
        self.no_id = self.tok.encode("no")[0]
        rss.tick()

    def score(self, query, doc, max_len=512):
        text = PREFIX + f"Query: {query}\nDocument: {doc}" + SUFFIX
        enc = self.tok(text, truncation=True, max_length=max_len,
                       return_tensors="pt")
        with torch.no_grad():
            logits = self.model(**enc).logits[0, -1]
        return float(logits[self.yes_id] - logits[self.no_id])


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    rss = PeakRss()
    rss.reset_baseline()
    model = EmbedModel("bge-m3", manifest, rss)
    rr = QwenReranker(manifest, rss)

    results = []
    for layer_name, records, queries in (
            ("L1", corpus_l1.RECORDS, corpus_l1.QUERIES[:NQ]),
            ("L2", None, None)):
        if records is None:
            eps = [json.loads(l) for l in open(
                r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\episodes.jsonl",
                encoding="utf-8")]
            records = [{"id": e["episodeId"], "ws": e["workspace"],
                        "scope": "Workspace", "text": e["text"]} for e in eps]
            ql = [json.loads(l) for l in open(
                r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\multilingual-queries.jsonl",
                encoding="utf-8")]
            queries = [{"id": q["qid"], "text": q["text"], "lang": q["lang"],
                        "cat": q["cat"], "gold": q["gold"], "neg": q["neg"],
                        "old": []} for q in ql[:NQ]]
        print(f"[probe] {layer_name}", flush=True)
        top50, rec_of = fused_top(model, records, queries)
        ranked, lat = [], []
        for q, ids in zip(queries, top50):
            t0 = time.perf_counter()
            shortlist = ids[:TOPK]
            scores = [rr.score(q["text"], rec_of[i]["text"]) for i in shortlist]
            lat.append((time.perf_counter() - t0) * 1000)
            order = sorted(range(len(shortlist)),
                           key=lambda i: (-scores[i], shortlist[i]))
            ranked.append([shortlist[i] for i in order[:10]])
        m = evaluate_arm(ranked, queries)
        m.update({"latency_p50_ms": round(sorted(lat)[len(lat) // 2], 1),
                  "latency_p95_ms": round(sorted(lat)[-1], 1),
                  "pairs_per_query": TOPK, "sliceQueries": len(queries)})
        results.append({"layer": layer_name,
                        "arm": f"{NAME} top{TOPK}->10 (probe)", **m})
        print("  ", results[-1], flush=True)
    env = {"reranker": NAME, "revision": manifest["models"][NAME]["revision"],
           "license": "Apache-2.0", "model_load_seconds": rr.load_seconds,
           "peak_rss_gb": round(rss.peak / 1e9, 2),
           "note": "bounded probe: 10 queries x top-10 pairs; full-slice "
                   "quality comparable to candidate 1 slice, latency "
                   "extrapolates linearly per pair"}
    with open(os.path.join(OUT, "results-qwen-probe.json"), "w",
              encoding="utf-8") as f:
        json.dump({"environment": env, "results": results},
                  f, ensure_ascii=False, indent=2)
    print(json.dumps(env, ensure_ascii=False))


if __name__ == "__main__":
    main()
