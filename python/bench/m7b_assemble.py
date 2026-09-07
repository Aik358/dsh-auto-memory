# -*- coding: utf-8 -*-
"""Assemble M7-2 benchmark artifacts into artifacts/m7-benchmark-pre/.

Reads python/bench/results/m7-2-results.{json,csv} (L1) and
m7-2-l2-results.json (L2) + model-manifest.json, and produces the
contract-mandated layout:
  artifacts/m7-benchmark-pre/results.json   (both layers, summary rows)
  artifacts/m7-benchmark-pre/results.csv
  artifacts/m7-benchmark-pre/runs/<runId>/  (full detail + manifest copy)
"""
import csv
import hashlib
import json
import os
import shutil
import time

BENCH = r"D:\dsh-auto-memory\python\bench\results"
OUT = r"D:\dsh-auto-memory\artifacts\m7-benchmark-pre"

COLS = ["layer", "model", "policy", "records", "queries", "chunks",
        "chunks_per_record", "avg_chunk_tokens",
        "recall@1", "recall@5", "recall@10", "mrr", "ndcg@10",
        "xlang_recall@5", "xlang_mrr", "code_recall@5", "hardneg_error",
        "supersede_correct", "xws_mirror_top5_unscoped", "xws_scoped_leak",
        "latency_encode_search_p50_ms", "latency_encode_search_p95_ms",
        "corpus_encode_seconds", "corpus_encode_chunks_per_sec",
        "vector_index_bytes", "vector_index_bytes_per_chunk",
        "model_load_seconds", "rss_mb_after_model_load", "peak_rss_mb",
        "configHash"]


def main():
    l1 = json.load(open(os.path.join(BENCH, "m7-2-results.json"), encoding="utf-8"))
    l2 = json.load(open(os.path.join(BENCH, "m7-2-l2-results.json"), encoding="utf-8"))
    manifest = json.load(open(os.path.join(BENCH, "model-manifest.json"), encoding="utf-8"))
    rows = l1["results"] + l2["results"]
    run_id = time.strftime("run%Y%m%d-%H%M%S")
    run_dir = os.path.join(OUT, "runs", run_id)
    os.makedirs(run_dir, exist_ok=True)

    summary = {
        "runId": run_id,
        "environment": l1.get("environment"),
        "l2Corpus": {"records": l2["records"], "queries": l2["queries"]},
        "models": {n: {"repo": m["repo_id"], "revision": m["revision"],
                       "license": m["license"], "total_bytes": m["total_bytes"]}
                   for n, m in manifest["models"].items()},
        "results": rows,
    }
    with open(os.path.join(OUT, "results.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT, "results.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    # full-detail archive (query_detail included)
    with open(os.path.join(run_dir, "l1-full.json"), "w", encoding="utf-8") as f:
        json.dump(l1, f, ensure_ascii=False, indent=2)
    with open(os.path.join(run_dir, "l2-full.json"), "w", encoding="utf-8") as f:
        json.dump(l2, f, ensure_ascii=False, indent=2)
    shutil.copy(os.path.join(BENCH, "model-manifest.json"),
                os.path.join(run_dir, "model-manifest.json"))
    digest = hashlib.sha256(open(os.path.join(OUT, "results.json"), "rb").read()).hexdigest()
    with open(os.path.join(run_dir, "artifact-digest.txt"), "w", encoding="utf-8") as f:
        f.write(f"results.json sha256={digest}\nrunId={run_id}\n")
    print("assembled ->", OUT, "runId", run_id, "rows", len(rows))


if __name__ == "__main__":
    main()
