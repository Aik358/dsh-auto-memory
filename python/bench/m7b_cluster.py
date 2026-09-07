# -*- coding: utf-8 -*-
"""Clustering Shadow benchmark (task set §7).

Objects: memory RECORDS (never tokenizer subwords). L1 synthetic corpus with
hand-authored topic ground truth (twins share a topic; distinct answers are
distinct topics) + L2 real episodes (structure metrics only, no labels).

Algorithms:
  agglomerative  cosine distance, average linkage, distance_threshold sweep
  hdbscan        cosine metric, min_cluster_size sweep, soft membership
  (UMAP / BERTopic: skipped-by-scope - UMAP is visualization-only per task
   set, BERTopic is a labeling layer; neither gates the shadow decision)

Metrics: ARI / NMI / B-cubed F1 vs topic truth, noise recall (HDBSCAN),
cross-lingual same-cluster rate (zh/en members of a topic), hard-negative
co-clustering rate (twins merged - expected HIGH for topics, reported),
bootstrap stability (5x 80% subsample pairwise ARI).

Shadow discipline: outputs are artifacts only; cluster membership never
triggers M6 injection (no production wiring in this stage).

Output: artifacts/m7-cluster-pre/{results.json, clusters.json}
"""
import json
import os
import re

import numpy as np

import m7b_config as C
import m7b_corpus as corpus
from m7b_chunker import chunk_record
from m7b_embed import EmbedModel, PeakRss
from m7b_run import MANIFEST

OUT_DIR = r"D:\dsh-auto-memory\artifacts\m7-cluster-pre"
POLICY = "cluster_shadow_pre_v1"

# ---- hand-authored topic ground truth (L1) ----
# twins share a topic; every other record is its own topic; distractor
# mini-groups by obvious everyday theme.
DISTRACTOR_GROUPS = {
    "food": ["d002", "d017", "d032", "d043", "d059"],
    "fitness": ["d014", "d044", "d053", "d006"],
    "games-media": ["d010", "d018", "d056"],
    "home": ["d005", "d016", "d030", "d037", "d040", "d051"],
    "travel-outdoors": ["d033", "d038", "d055"],
    "admin-paperwork": ["d013", "d023", "d026", "d039", "d049", "d050"],
    "learning": ["d003", "d015", "d028", "d042", "d045"],
    "music-arts": ["d036", "d048", "d057"],
    "work-social": ["d001", "d006", "d011", "d021", "d022", "d024", "d027",
                    "d029", "d031", "d034", "d046", "d047"],
    "health-body": ["d034", "d052", "d058"],
    "devices": ["d004", "d007", "d009", "d035", "d054"],
}
PAIR_TOPICS = [
    ("latency-budgets", ["r051", "r052"]),
    ("digest-scopes", ["r053", "r054"]),
    ("config-gates-inbox", ["r055", "r056"]),
    ("cooldowns", ["r057", "r058"]),
    ("version-keys", ["r059", "r060"]),
    ("tokenizer-caps", ["r061", "r062"]),
    ("scopes-ws-user", ["r063", "r064"]),
    ("rerankers", ["r065", "r066"]),
    ("dense-ann", ["r067", "r068"]),
    ("zstd-channels", ["r069", "r070"]),
    ("sup-jieba", ["r081", "r082"]),
    ("sup-pagination", ["r083", "r084"]),
    ("sup-epoch", ["r085", "r086"]),
    ("sup-chunkid", ["r087", "r088"]),
    ("sup-tiebreak", ["r095", "r096"]),
    ("sup-persist", ["r097", "r098"]),
    ("sup-mixing", ["r099", "r100"]),
    ("xws-deploy", ["r111", "r112"]),
    ("xws-layout", ["r113", "r114"]),
    ("xws-rotation", ["r115", "r116"]),
    ("xws-contact", ["r117", "r118"]),
    ("xws-hardware", ["r119", "r120"]),
    ("xws-scope-rule", ["r121", "r122"]),
]


def topic_truth():
    truth = {}
    for topic, ids in PAIR_TOPICS:
        for rid in ids:
            truth[rid] = topic
    for topic, ids in DISTRACTOR_GROUPS.items():
        for rid in ids:
            truth.setdefault(rid, topic)
    for r in corpus.RECORDS:
        truth.setdefault(r["id"], "own:" + r["id"])
    return truth


def b_cubed(pred, truth):
    """B-cubed precision/recall/F1 (bag-of-labels multiset version)."""
    from collections import Counter
    n = len(truth)
    p_sum = r_sum = 0.0
    for i in range(n):
        same_t = [j for j in range(n) if truth[j] == truth[i]]
        same_p = [j for j in range(n) if pred[j] == pred[i]]
        c = Counter(truth[j] for j in same_p)
        p_sum += c[truth[i]] / len(same_p) if same_p else 0.0
        c2 = Counter(pred[j] for j in same_t)
        r_sum += c2[pred[i]] / len(same_t) if same_t else 0.0
    prec, rec = p_sum / n, r_sum / n
    return round(2 * prec * rec / (prec + rec), 4) if prec + rec else 0.0


def cluster_artifacts(vecs, rec_ids, labels, probs=None, texts=None):
    from collections import defaultdict
    groups = defaultdict(list)
    for i, lab in enumerate(labels):
        if lab < 0:
            continue
        groups[int(lab)].append(i)
    out = []
    for cid, members in sorted(groups.items()):
        m_vecs = vecs[members]
        centroid = m_vecs.mean(axis=0)
        centroid /= np.linalg.norm(centroid) or 1.0
        medoid = members[int(np.argmax(m_vecs @ centroid))]
        radius = float(np.max(np.sqrt(np.maximum(
            0.0, 2 - 2 * (m_vecs @ centroid).clip(-1, 1)))))
        # keywords: top discriminative lexical terms of the cluster
        kw = []
        if texts:
            from m7b_hybrid import tokenize
            all_counts = {}
            for i in members:
                for t in tokenize(texts[i]):
                    all_counts[t] = all_counts.get(t, 0) + 1
            global_counts = {}
            for tx in texts:
                for t in set(tokenize(tx)):
                    global_counts[t] = global_counts.get(t, 0) + 1
            kw = [t for t, c in sorted(all_counts.items(), key=lambda kv: -kv[1])
                  if global_counts[t] <= max(4, len(texts) // 8)][:8]
        out.append({
            "clusterId": "clu_pre_%03d" % cid,
            "members": [rec_ids[i] for i in members],
            "centroidNorm": [round(float(x), 4) for x in centroid[:8]],
            "medoid": rec_ids[medoid],
            "radius": round(radius, 4),
            "softMembership": ({rec_ids[i]: round(float(probs[i]), 4)
                                for i in members} if probs is not None else None),
            "noise": [rec_ids[i] for i, lab in enumerate(labels) if lab < 0],
            "keywords": kw,
            "policyVersion": POLICY,
        })
    return out


def crosslingual_same_cluster(labels, rec_ids, truth):
    """For each PAIR topic with zh+en members, are they co-clustered?
    L1 pairs are mostly en+en, so use the zh2en/en2zh gold pairs instead:
    treat any two records sharing a non-'own:' topic."""
    pair_topics = {t: ids for t, ids in PAIR_TOPICS}
    idx = {rid: i for i, rid in enumerate(rec_ids)}
    hits = total = 0
    for topic, ids in pair_topics.items():
        if len(ids) == 2 and ids[0] in idx and ids[1] in idx:
            total += 1
            hits += int(labels[idx[ids[0]]] == labels[idx[ids[1]]] and
                        labels[idx[ids[0]]] >= 0)
    return round(hits / total, 4) if total else None


def main():
    from sklearn.cluster import AgglomerativeClustering, HDBSCAN
    from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    model = EmbedModel("bge-m3", manifest, PeakRss())
    policy = C.CHUNK_POLICIES["para-512-noov"]

    def embed_records(records):
        prefix = model.cfg["doc_prefix"]
        rows = []
        for rec in records:
            rt = prefix + rec["text"] if prefix else rec["text"]
            chunks = chunk_record(model.tokenizer, dict(rec, text=rt),
                                  "para-512-noov", policy)
            ids = [model.build_doc_ids(c["ids"]) for c in chunks]
            vecs = model.encode_ids(ids, 8)
            rows.append(vecs.mean(axis=0) /
                        np.linalg.norm(vecs.mean(axis=0)))  # record = mean of chunks
        return np.array(rows)

    # ---- L1 with ground truth ----
    rec_ids = [r["id"] for r in corpus.RECORDS]
    texts = [r["text"] for r in corpus.RECORDS]
    vecs = embed_records(corpus.RECORDS)
    truth_map = topic_truth()
    truth = [truth_map[rid] for rid in rec_ids]

    results = []
    best = None
    for thr in (0.3, 0.4, 0.5, 0.6, 0.7):
        agg = AgglomerativeClustering(
            n_clusters=None, metric="cosine", linkage="average",
            distance_threshold=thr)
        labels = agg.fit_predict(vecs)
        ari = round(adjusted_rand_score(truth, labels), 4)
        nmi = round(normalized_mutual_info_score(truth, labels), 4)
        bc = b_cubed(labels, truth)
        results.append({"layer": "L1", "algo": "agglomerative",
                        "params": f"thr={thr}", "clusters": int(labels.max()) + 1,
                        "ARI": ari, "NMI": nmi, "bCubedF1": bc,
                        "noiseRate": 0.0,
                        "pairSameCluster": crosslingual_same_cluster(labels, rec_ids, truth)})
        if best is None or nmi > best[0]:
            best = (nmi, ("agglomerative", f"thr={thr}", labels, None))
    for mcs in (3, 5, 8):
        hdb = HDBSCAN(metric="cosine", min_cluster_size=mcs,
                      cluster_selection_method="eom")
        labels = hdb.fit_predict(vecs)
        noise = float(np.mean(labels < 0))
        non_noise = labels >= 0
        ari = round(adjusted_rand_score([t for t, k in zip(truth, non_noise) if k],
                                        labels[non_noise]), 4) if non_noise.any() else 0.0
        nmi = round(normalized_mutual_info_score([t for t, k in zip(truth, non_noise) if k],
                                                 labels[non_noise]), 4) if non_noise.any() else 0.0
        bc = b_cubed(list(labels[non_noise]),
                     [t for t, k in zip(truth, non_noise) if k]) if non_noise.any() else 0.0
        # noise recall: known-topic (pair/distractor-group) members lost to noise
        known = [i for i, t in enumerate(truth) if not t.startswith("own:")]
        noise_recall = round(float(np.mean([labels[i] < 0 for i in known])), 4)
        results.append({"layer": "L1", "algo": "hdbscan",
                        "params": f"mcs={mcs}", "clusters": int(labels.max()) + 1,
                        "ARI": ari, "NMI": nmi, "bCubedF1": bc,
                        "noiseRate": round(noise, 4), "knownTopicNoiseRate": noise_recall,
                        "pairSameCluster": crosslingual_same_cluster(labels, rec_ids, truth)})
        if best is None or nmi > best[0]:
            best = (nmi, ("hdbscan", f"mcs={mcs}", labels,
                          getattr(hdb, "probabilities_", None)))

    # bootstrap stability for the winner
    rng = np.random.default_rng(7)
    stab = []
    _, (algo, params, _, _) = best, best[1]
    for it in range(5):
        keep = rng.random(len(vecs)) < 0.8
        sub = vecs[keep]
        if algo == "agglomerative":
            thr = float(params.split("=")[1])
            lab = AgglomerativeClustering(n_clusters=None, metric="cosine",
                                          linkage="average",
                                          distance_threshold=thr).fit_predict(sub)
        else:
            mcs = int(params.split("=")[1])
            lab = HDBSCAN(metric="cosine", min_cluster_size=mcs,
                          cluster_selection_method="eom").fit_predict(sub)
        lab_full = np.full(len(vecs), -1)
        lab_full[keep] = lab
        base = best[1][2]
        both = (lab_full >= 0) & (base >= 0)
        stab.append(round(adjusted_rand_score(base[both], lab_full[both]), 4)
                    if both.any() else 0.0)
    results.append({"layer": "L1", "algo": "bootstrap-stability",
                    "params": f"{best[1][0]}:{best[1][1]} x5@80%",
                    "meanPairwiseARI": round(float(np.mean(stab)), 4)})

    # artifacts from the winner
    algo, params, labels, probs = best[1]
    arts = cluster_artifacts(vecs, rec_ids, labels,
                             probs=np.asarray(probs) if probs is not None else None,
                             texts=texts)
    with open(os.path.join(OUT_DIR, "clusters.json"), "w", encoding="utf-8") as f:
        json.dump({"policyVersion": POLICY, "algo": algo, "params": params,
                   "recordCount": len(rec_ids),
                   "memoryIndexVersion": "bench-l1",
                   "clusters": arts}, f, ensure_ascii=False, indent=2)

    # ---- L2 structure-only (no labels) ----
    eps = [json.loads(l) for l in open(
        r"D:\dsh-auto-memory\artifacts\m7-corpus-pre\episodes.jsonl", encoding="utf-8")]
    l2_vecs = embed_records([{"id": e["episodeId"], "ws": e["workspace"],
                              "scope": "Workspace", "text": e["text"]} for e in eps])
    agg = AgglomerativeClustering(n_clusters=None, metric="cosine",
                                  linkage="average", distance_threshold=0.5)
    l2_labels = agg.fit_predict(l2_vecs)
    results.append({"layer": "L2", "algo": "agglomerative",
                    "params": "thr=0.5", "clusters": int(l2_labels.max()) + 1,
                    "note": "structure-only (no labels); singleton-heavy real corpus"})
    l2_arts = cluster_artifacts(l2_vecs, [e["episodeId"] for e in eps], l2_labels,
                                texts=[e["text"] for e in eps])
    with open(os.path.join(OUT_DIR, "clusters-l2.json"), "w", encoding="utf-8") as f:
        json.dump({"policyVersion": POLICY, "algo": "agglomerative",
                   "params": "thr=0.5", "clusters": l2_arts},
                  f, ensure_ascii=False, indent=2)

    with open(os.path.join(OUT_DIR, "results.json"), "w", encoding="utf-8") as f:
        json.dump({"environment": {"model": "bge-m3 record-mean-of-chunk vectors",
                                   "sklearn": "1.7.x"},
                   "groundTruth": "hand-authored topics: twins share, others own, distractor mini-groups",
                   "skipped": ["UMAP (visualization-only per task set)",
                               "BERTopic (labeling layer, not a gate)"],
                   "results": results}, f, ensure_ascii=False, indent=2)
    print("wrote", OUT_DIR)
    for r in results:
        print(r)


if __name__ == "__main__":
    main()
