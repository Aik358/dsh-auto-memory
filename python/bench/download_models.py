# -*- coding: utf-8 -*-
"""Download pinned model snapshots and verify local sha256 checksums.

Produces results/model-manifest.json with revision, license, file sizes,
sha256 of every downloaded file, and the local cache path. Offline from
here on: the benchmark runner reads from this manifest only.
"""
import hashlib
import json
import os
import time

import m7b_config as C
from huggingface_hub import snapshot_download


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    os.environ["HF_HOME"] = C.HF_CACHE
    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    manifest = {"pinnedAt": "2026-08-24", "models": {}}
    for name, m in C.MODELS.items():
        t0 = time.time()
        path = snapshot_download(
            repo_id=m["repo_id"],
            revision=m["revision"],
            cache_dir=C.HF_CACHE,
            allow_patterns=m["allow_patterns"],
        )
        dl_secs = round(time.time() - t0, 1)
        files = []
        for fn in sorted(os.listdir(path)):
            fp = os.path.join(path, fn)
            if not os.path.isfile(fp):
                continue
            files.append({
                "file": fn,
                "bytes": os.path.getsize(fp),
                "sha256": sha256_file(fp),
            })
        total = sum(f["bytes"] for f in files)
        manifest["models"][name] = {
            "repo_id": m["repo_id"],
            "revision": m["revision"],
            "license": m["license"],
            "local_path": path,
            "total_bytes": total,
            "download_seconds": dl_secs,
            "files": files,
        }
        print(f"[ok] {name} rev={m['revision'][:12]} {total/1e6:.1f}MB in {dl_secs}s -> {path}")
    out = os.path.join(C.RESULTS_DIR, "model-manifest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("manifest ->", out)


if __name__ == "__main__":
    main()
