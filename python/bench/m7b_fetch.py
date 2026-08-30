# -*- coding: utf-8 -*-
"""Segmented parallel downloader for pinned HF models via hf-mirror.

Direct huggingface.co is unreachable without proxy on this machine;
hf-mirror.com works. Files are fetched as parallel HTTP range segments,
concatenated, and verified against the LFS sha256 oid published by the
model API (fetched from the mirror, same metadata). Small files download
whole. Bounded retries everywhere; nothing is written into git-tracked
paths (cache lives under python/bench/).
"""
import concurrent.futures as cf
import hashlib
import json
import os
import sys
import time

import requests

MIRROR = "https://hf-mirror.com"
SEG_WORKERS = 8
SEG_BYTES = 8 << 20  # 8 MiB segments
SMALL_LIMIT = 50 << 20


def api_model(repo, revision):
    r = requests.get(f"{MIRROR}/api/models/{repo}",
                     params={"revision": revision}, timeout=30)
    r.raise_for_status()
    return r.json()


def lfs_map(info):
    out = {}
    for s in info.get("siblings", []):
        lfs = s.get("lfs")
        if lfs:
            out[s["rfilename"]] = (lfs["oid"], lfs["size"])
    return out


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fetch_range(url, start, end, out_path, tries=6):
    for t in range(tries):
        try:
            r = requests.get(url, headers={"Range": f"bytes={start}-{end}"},
                             timeout=120, stream=True)
            if r.status_code in (200, 206):
                data = b""
                for chunk in r.iter_content(1 << 18):
                    data += chunk
                if len(data) == end - start + 1:
                    with open(out_path, "r+b") as f:
                        f.seek(start)
                        f.write(data)
                    return len(data)
        except Exception:
            pass
        time.sleep(min(2 ** t, 30))
    raise RuntimeError(f"segment failed {start}-{end} {url}")


def download_file(repo, revision, fname, dest, size, workers=SEG_WORKERS):
    url = f"{MIRROR}/{repo}/resolve/{revision}/{fname}"
    with open(dest, "wb") as f:
        f.truncate(size)
    if size <= SMALL_LIMIT:
        fetch_range(url, 0, size - 1, dest)
    else:
        segs = [(s, min(s + SEG_BYTES, size) - 1)
                for s in range(0, size, SEG_BYTES)]
        done = 0
        with cf.ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(fetch_range, url, a, b, dest): (a, b)
                    for a, b in segs}
            for fut in cf.as_completed(futs):
                done += fut.result()
    return size


def fetch_model(name, cfg, out_root):
    info = api_model(cfg["repo_id"], cfg["revision"])
    lfs = lfs_map(info)
    plain = {s["rfilename"] for s in info.get("siblings", [])}
    allow = set(cfg["allow_patterns"])
    dest_dir = os.path.join(out_root, name)
    os.makedirs(dest_dir, exist_ok=True)
    entries = []
    for fname in sorted(allow):
        if fname not in plain:
            print(f"  [warn] {fname} not in repo listing; skipping")
            continue
        dest = os.path.join(dest_dir, fname.replace("/", "__"))
        if fname in lfs:
            oid, size = lfs[fname]
            okfile = dest + ".sha256.ok"
            if os.path.exists(dest) and os.path.exists(okfile):
                print(f"  [skip] {fname} (verified)")
            else:
                t0 = time.time()
                download_file(cfg["repo_id"], cfg["revision"], fname, dest, size)
                local = sha256_file(dest)
                if local != oid:
                    os.remove(dest)
                    raise RuntimeError(f"sha256 mismatch {fname}: {local} != {oid}")
                open(okfile, "w").write(oid)
                dt = time.time() - t0
                print(f"  [ok] {fname} {size/1e6:.1f}MB in {dt:.0f}s "
                      f"({size/1e6/dt:.2f}MB/s) sha256 verified")
            entries.append({"file": fname, "bytes": size, "sha256": oid,
                            "local_name": dest})
        else:
            dest = os.path.join(dest_dir, fname.replace("/", "__"))
            t0 = time.time()
            r = requests.get(f"{MIRROR}/{cfg['repo_id']}/resolve/"
                             f"{cfg['revision']}/{fname}", timeout=60)
            r.raise_for_status()
            with open(dest, "wb") as f:
                f.write(r.content)
            print(f"  [ok] {fname} {len(r.content)/1e3:.1f}KB "
                  f"(plain, no lfs oid)")
            entries.append({"file": fname, "bytes": len(r.content),
                            "sha256": sha256_file(dest), "local_name": dest})
    return {"repo_id": cfg["repo_id"], "revision": cfg["revision"],
            "license": cfg["license"], "local_path": dest_dir,
            "total_bytes": sum(e["bytes"] for e in entries),
            "files": entries}


def main():
    import m7b_config as C
    names = sys.argv[1].split(",") if len(sys.argv) > 1 else \
        ["qwen3-emb-0.6b", "multilingual-e5-large"]
    out_root = os.path.join(C.BENCH_ROOT, "models")
    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    manifest_path = os.path.join(C.RESULTS_DIR, "model-manifest.json")
    manifest = {"pinnedAt": "2026-08-24", "models": {}}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
    for name in names:
        print(f"[fetch] {name}")
        manifest["models"][name] = fetch_model(name, C.MODELS[name], out_root)
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("manifest ->", manifest_path)


if __name__ == "__main__":
    main()
