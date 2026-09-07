# -*- coding: utf-8 -*-
"""Fix handoff-audit gap §4: emit the >=30-item human review queue.

Samples a stratified set of episodes (every source/kind/lang) for human
review of cleaning quality and episode boundaries. Read-only over
episodes.jsonl; writes artifacts/m7-corpus-pre/review-queue.jsonl.
"""
import json
import random

SRC = r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\episodes.jsonl"
OUT = r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\review-queue.jsonl"


def main():
    eps = [json.loads(l) for l in open(SRC, encoding="utf-8")]
    rng = random.Random(20260824)
    picked, seen_sources = [], {}
    # stratify: up to 8 per (source,kind) across splits, prefer test/dev first
    for split_pref in ("test", "dev", "train"):
        pool = [e for e in eps if e["split"] == split_pref]
        rng.shuffle(pool)
        for e in pool:
            key = (e["source"], e["kind"])
            if seen_sources.get(key, 0) >= 8:
                continue
            seen_sources[key] = seen_sources.get(key, 0) + 1
            picked.append(e)
            if len(picked) >= 60:
                break
        if len(picked) >= 60:
            break
    while len(picked) < 30:  # guarantee the >=30 floor
        rest = [e for e in eps if e not in picked]
        if not rest:
            break
        e = rest[rng.randrange(len(rest))]
        picked.append(e)
    with open(OUT, "w", encoding="utf-8") as f:
        for i, e in enumerate(picked):
            f.write(json.dumps({
                "reviewId": "rv_%03d" % (i + 1),
                "episodeId": e["episodeId"],
                "source": e["source"], "kind": e["kind"], "lang": e["lang"],
                "split": e["split"],
                "reviewFocus": ["cleaning quality (no secrets/paths left)",
                                "episode boundary sensible",
                                "text substance (not filler)"][i % 3],
                "text": e["text"][:600],
            }, ensure_ascii=False) + "\n")
    print(f"review queue: {len(picked)} items -> {OUT}")


if __name__ == "__main__":
    main()
