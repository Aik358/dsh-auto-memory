# -*- coding: utf-8 -*-
"""L2 benchmark: real episodes + hand-authored queries.

Reuses run_combo from m7b_run with injected records/queries. Episodes become
records (episodeId as record id, workspace from the episode); queries carry
their own workspace view ('ws/dsh-core' or 'all').
"""
import json
import os

import psutil

import m7b_config as C
from m7b_embed import EmbedModel, PeakRss
from m7b_run import MANIFEST, run_combo

EPS = r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\episodes.jsonl"
QUERIES = r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\multilingual-queries.jsonl"


def load():
    records = []
    for line in open(EPS, encoding="utf-8"):
        e = json.loads(line)
        records.append({"id": e["episodeId"], "ws": e["workspace"],
                        "scope": e.get("scope", "Workspace"),
                        "text": e["text"]})
    queries = []
    for line in open(QUERIES, encoding="utf-8"):
        q = json.loads(line)
        queries.append({"id": q["qid"], "text": q["text"], "lang": q["lang"],
                        "cat": q["cat"], "gold": q["gold"], "neg": q["neg"],
                        "old": [], "ws": q.get("workspace", "all")})
    return records, queries


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    records, queries = load()
    rss = PeakRss()
    results = []
    for name in C.MODELS:
        rss.reset_baseline()
        model = EmbedModel(name, manifest, rss)
        rss_after_load = rss.peak
        for pname, policy in C.CHUNK_POLICIES.items():
            print(f"[L2] {name} x {pname} ...", flush=True)
            res, *_ , detail = run_combo(model, pname, policy, records, queries,
                                         rss, layer="L2")
            res["rss_mb_after_model_load"] = round(rss_after_load / 1e6, 1)
            res["query_detail"] = {d["qid"]: d for d in detail}
            results.append(res)
            print("     recall@5={recall@5} mrr={mrr} ndcg={ndcg@10} "
                  "hardneg_err={hardneg_error} p95={latency_encode_search_p95_ms}ms".format(**res),
                  flush=True)
        del model
        import gc
        gc.collect()
    out = {"records": len(records), "queries": len(queries), "results": results}
    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    with open(os.path.join(C.RESULTS_DIR, "m7-2-l2-results.json"), "w",
              encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("wrote", os.path.join(C.RESULTS_DIR, "m7-2-l2-results.json"))


if __name__ == "__main__":
    main()
