# -*- coding: utf-8 -*-
"""M7-3 hybrid arms benchmark (task set §6, decision doc D4).

Arms over L1 (synthetic) + L2 (real episodes):
  lexical    : Python parity clone of lexical_pre_v2 scoring (NFKC + CJK
               2-gram + HIT 507 stopwords extracted at runtime from
               lib/shadow-retrieval-pre.js + BM25 k1=1.2 b=0.75, JS formula)
  bm25s      : bm25s library, Lucene method, same splitter (library arm)
  dense      : frozen bge-m3 x para-512-noov exact cosine (parent score =
               max chunk cosine, frozen D2)
  weighted   : minmax(dense)*w + minmax(lexical)*(1-w), w in {0.3,0.5,0.7}
  rrf        : RRF(dense, lexical), k in {10,20,40,60,100}
  sup-pen    : best fusion + gamma penalty on superseded-by edges (L1)

Outputs artifacts/m7-hybrid-pre/results.{json,csv}.
"""
import csv
import json
import math
import os
import re
import unicodedata

import numpy as np

import m7b_config as C
import m7b_corpus as corpus_l1
from m7b_chunker import chunk_record
from m7b_embed import EmbedModel, PeakRss
from m7b_run import MANIFEST

OUT_DIR = r"D:\dsh-auto-memory\artifacts\m7-hybrid-pre"
JS_LEXICAL = r"D:\dsh-auto-memory\lib\shadow-retrieval-pre.js"
RRF_KS = [10, 20, 40, 60, 100]
WEIGHTS = [0.3, 0.5, 0.7]
GAMMAS = [0.02, 0.05]
TOP = 10


def load_stopwords():
    src = open(JS_LEXICAL, encoding="utf-8").read()
    m = re.search(r"STOPWORDS_HIT_PRE_V2\s*=\s*Object\.freeze\(\[(.*?)\]\)", src, re.S)
    words = re.findall(r"'([^']+)'|\"([^\"]+)\"", m.group(1))
    return {a or b for a, b in words}


STOPWORDS = load_stopwords()
assert len(STOPWORDS) >= 500, "stopwords extraction failed: %d" % len(STOPWORDS)


def tokenize(text):
    t = unicodedata.normalize("NFKC", str(text)).lower()
    out = []
    for run in re.findall(r"[\u4e00-\u9fff]+|[a-z0-9_./-]+", t):
        if re.match(r"[\u4e00-\u9fff]", run):
            grams = [run[i:i + 2] for i in range(len(run) - 1)] or [run]
            out.extend(g for g in grams if g not in STOPWORDS)
        elif run not in STOPWORDS and len(run) > 1:
            out.append(run)
    return out


class LexicalBM25:
    def __init__(self, docs_tokens):
        self.N = len(docs_tokens)
        self.doc_len = [len(d) for d in docs_tokens]
        self.avgdl = (sum(self.doc_len) / self.N) if self.N else 1.0
        self.tf, self.df = [], {}
        for d in docs_tokens:
            counts = {}
            for tok in d:
                counts[tok] = counts.get(tok, 0) + 1
            self.tf.append(counts)
            for tok in counts:
                self.df[tok] = self.df.get(tok, 0) + 1

    def score(self, query_tokens, idx):
        dl = self.doc_len[idx] or 1
        counts = self.tf[idx]
        k1, b = 1.2, 0.75
        s = 0.0
        for tok in set(query_tokens):
            if tok not in counts:
                continue
            tf = counts[tok]
            idf = math.log(1.0 + (self.N - self.df[tok] + 0.5) / (self.df[tok] + 0.5))
            s += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / self.avgdl))
        return s


class Bm25sArm:
    """bm25s (Lucene BM25) over our CJK-2gram token lists. bm25s 0.3.x has
    no custom splitter hook, so we feed raw token lists and wrap the query
    in a Tokenized with our own vocab (unknown query tokens dropped)."""

    def __init__(self, records):
        import bm25s as lib
        from bm25s.tokenization import Tokenized
        self.lib = lib
        self.Tokenized = Tokenized
        self.ids = [r["id"] for r in records]
        docs = [tokenize(r["text"]) for r in records]
        self.vocab = {t: i for i, t in enumerate(
            sorted({tok for doc in docs for tok in doc}))}
        self.retriever = lib.BM25(method="lucene")
        self.retriever.index(docs, show_progress=False)

    def _qtok(self, query):
        toks = [t for t in tokenize(query) if t in self.vocab]
        ids = [[self.vocab[t] for t in toks]] if toks else [[]]
        return self.Tokenized(ids=ids, vocab=self.vocab)

    def search(self, query, k=TOP):
        res, _ = self.retriever.retrieve(self._qtok(query),
                                         k=min(k, len(self.ids)))
        return [self.ids[i] for i in res[0]][:k]


def minmax(vec):
    arr = np.array(vec, dtype=np.float64)
    lo, hi = arr.min(), arr.max()
    return (arr - lo) / (hi - lo) if hi > lo else np.zeros_like(arr)


def evaluate_arm(ranked_ids, queries):
    m = {"recall@1": [], "recall@5": [], "recall@10": [], "mrr": [],
         "ndcg@10": [], "hardneg_error": [], "supersede_correct": [],
         "xlang_recall@5": [], "code_recall@5": []}
    for q, top in zip(queries, ranked_ids):
        top = top[:TOP]
        gold_rank = next((r + 1 for r, x in enumerate(top) if x in q["gold"]), None)
        dcg = sum(1.0 / math.log2(r + 2) for r, x in enumerate(top) if x in q["gold"])
        ideal = sum(1.0 / math.log2(r + 2) for r in range(min(len(q["gold"]), 10)))
        m["ndcg@10"].append(dcg / ideal if ideal else 0.0)
        m["recall@1"].append(1 if top and top[0] in q["gold"] else 0)
        m["recall@5"].append(1 if any(g in top[:5] for g in q["gold"]) else 0)
        m["recall@10"].append(1 if any(g in top for g in q["gold"]) else 0)
        m["mrr"].append(1.0 / gold_rank if gold_rank else 0.0)
        if q.get("neg"):
            neg_rank = next((r + 1 for r, x in enumerate(top) if x in q["neg"]), None)
            m["hardneg_error"].append(1 if (neg_rank and (not gold_rank or neg_rank < gold_rank)) else 0)
        if q.get("old"):
            old_rank = next((r + 1 for r, x in enumerate(top) if x in q["old"]), None)
            m["supersede_correct"].append(1 if (gold_rank and old_rank and gold_rank < old_rank) else 0)
        if q["cat"] in ("zh2en", "en2zh"):
            m["xlang_recall@5"].append(m["recall@5"][-1])
        if q["cat"] == "code":
            m["code_recall@5"].append(m["recall@5"][-1])
    mean = lambda v: round(sum(v) / len(v), 4) if v else None
    return {k: mean(v) for k, v in m.items()}


def build_layer(model, records, queries):
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
    rec_ids = [r["id"] for r in records]
    bm = Bm25sArm(records)
    per_query = []
    for qi, q in enumerate(queries):
        qt = tokenize(q["text"])
        lex_scores = np.array([lex.score(qt, i) for i in range(len(records))])
        dense_rank = [uniq[i] for i in sorted(range(len(uniq)),
                        key=lambda i: (-float(dense[qi, i]), uniq[i]))[:TOP]]
        lex_rank = [rec_ids[i] for i in sorted(range(len(rec_ids)),
                      key=lambda i: (-float(lex_scores[i]), rec_ids[i]))[:TOP]]
        per_query.append({
            "dense_scores": dense[qi].copy(), "dense_rank": dense_rank,
            "lex_scores": lex_scores, "lex_rank": lex_rank,
            "bm25s_rank": bm.search(q["text"]),
        })
    return per_query, uniq, rec_ids


def fuse_weighted(pq, uniq, w, gamma=0.0, superseded=frozenset(), penalty_of=None):
    d = minmax(pq["dense_scores"])
    s = minmax(pq["lex_scores"])
    # dense is over uniq; lexical over rec_ids - same set in our layers
    comb = w * d[:len(s)] + (1 - w) * s
    if gamma and superseded:
        for rid in superseded:
            if rid in penalty_of:
                comb[penalty_of[rid]] -= gamma
    order = sorted(range(len(comb)),
                   key=lambda i: (-float(comb[i]), uniq[i]))
    return [uniq[i] for i in order[:TOP]]


def fuse_rrf(pq, uniq, k):
    idx_of = {rid: i for i, rid in enumerate(uniq)}
    rl = [[idx_of[x] for x in pq["dense_rank"] if x in idx_of],
          [idx_of[x] for x in pq["lex_rank"] if x in idx_of]]
    scores = np.zeros(len(uniq))
    for ranks in rl:
        for r, i in enumerate(ranks):
            scores[i] += 1.0 / (k + r + 1)
    order = sorted(range(len(scores)), key=lambda i: (-float(scores[i]), uniq[i]))
    return [uniq[i] for i in order[:TOP]]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    model = EmbedModel("bge-m3", manifest, PeakRss())

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
                           "old": [], "ws": q.get("workspace", "all")})
    superseded_l1 = {r["id"] for r in corpus_l1.RECORDS if r["cat"] == "supersede-old"}

    results = []
    for layer_name, records, queries in (
            ("L1", corpus_l1.RECORDS, corpus_l1.QUERIES),
            ("L2", l2_records, l2_queries)):
        print(f"[hybrid] {layer_name} ...", flush=True)
        per_query, uniq, rec_ids = build_layer(model, records, queries)
        assert uniq == rec_ids or set(uniq) == set(rec_ids)
        penalty_of = {rid: i for i, rid in enumerate(uniq)}
        superseded = superseded_l1 if layer_name == "L1" else frozenset()
        for arm, ranked in (
                ("dense", [pq["dense_rank"] for pq in per_query]),
                ("lexical", [pq["lex_rank"] for pq in per_query]),
                ("bm25s", [pq["bm25s_rank"] for pq in per_query])):
            results.append({"layer": layer_name, "arm": arm, "params": "",
                            **evaluate_arm(ranked, queries)})
        for w in WEIGHTS:
            ranked = [fuse_weighted(pq, uniq, w) for pq in per_query]
            results.append({"layer": layer_name, "arm": "weighted", "params": f"w={w}",
                            **evaluate_arm(ranked, queries)})
        for k in RRF_KS:
            ranked = [fuse_rrf(pq, uniq, k) for pq in per_query]
            results.append({"layer": layer_name, "arm": "rrf", "params": f"k={k}",
                            **evaluate_arm(ranked, queries)})
        for g in GAMMAS:
            ranked = [fuse_weighted(pq, uniq, 0.5, gamma=g, superseded=superseded,
                                    penalty_of=penalty_of) for pq in per_query]
            results.append({"layer": layer_name, "arm": "weighted+sup-pen",
                            "params": f"w=0.5,g={g}",
                            **evaluate_arm(ranked, queries)})
    with open(os.path.join(OUT_DIR, "results.json"), "w", encoding="utf-8") as f:
        json.dump({"environment": {
            "model": "bge-m3 para-512-noov (frozen D1/D2)",
            "lexical": "parity clone of lexical_pre_v2 (stopwords extracted from lib/shadow-retrieval-pre.js)",
            "bm25s": "0.3.x lucene, same splitter"},
            "results": results}, f, ensure_ascii=False, indent=2)
    cols = ["layer", "arm", "params", "recall@1", "recall@5", "recall@10", "mrr",
            "ndcg@10", "xlang_recall@5", "code_recall@5", "hardneg_error",
            "supersede_correct"]
    with open(os.path.join(OUT_DIR, "results.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in results:
            w.writerow(r)
    print("wrote", OUT_DIR)
    for r in results:
        print(f"{r['layer']:3s} {r['arm']:16s} {r['params']:12s} R@5={r['recall@5']:.3f}"
              f" MRR={r['mrr']:.3f} hn={r['hardneg_error']} sup={r['supersede_correct']}")


if __name__ == "__main__":
    main()
