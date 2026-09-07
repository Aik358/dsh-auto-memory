# -*- coding: utf-8 -*-
"""BGE-M3 model-sparse arm (handoff §6 '模型 sparse(若支持)').

Official recipe (FlagEmbedding research/BGE_M3/modeling.py):
  token_weights = relu(sparse_linear(hidden_states))
  per-token-id weight = max over positions (scatter amax)
  unused tokens (cls/eos/pad/unk) zeroed
  sparse score = dot of the two sparse vectors

Compares: lexical clone / model-sparse / dense / weighted(dense+model-sparse)
over L1+L2 with the same evaluate_arm. Output appended to
artifacts/m7-hybrid-pre/results-model-sparse.{json,csv}.
"""
import csv
import json
import os

import numpy as np
import torch

import m7b_config as C
import m7b_corpus as corpus_l1
from m7b_chunker import chunk_record
from m7b_embed import EmbedModel, PeakRss
from m7b_hybrid import (LexicalBM25, evaluate_arm, minmax, tokenize)
from m7b_run import MANIFEST

OUT = r"D:\dsh-auto-memory\artifacts\m7-hybrid-pre"
SPARSE_PT = r"D:\dsh-auto-memory\python\bench\models\bge-m3\sparse_linear.pt"
VOCAB = 250002  # xlm-roberta-large vocab


class BgeSparse:
    def __init__(self, model, manifest_model):
        self.tok = model.tokenizer
        self.enc = model.model
        self.pad = self.tok.pad_token_id or self.tok.eos_token_id
        sd = torch.load(SPARSE_PT, map_location="cpu", weights_only=True)
        w = (sd["weight"] if "weight" in sd else sd["linear.weight"]).float()
        b = sd.get("bias", sd.get("linear.bias"))
        b = b.float() if b is not None else None  # checkpoint ships fp16
        self.w = w.squeeze(0)
        self.b = b.squeeze(0) if b is not None else None
        self.unused = {self.tok.cls_token_id, self.tok.eos_token_id,
                       self.tok.pad_token_id, self.tok.unk_token_id}

    def sparse_vec(self, text):
        enc = self.tok(text, add_special_tokens=True, truncation=True,
                       max_length=512, return_tensors="pt")
        ids = enc["input_ids"][0]
        att = enc["attention_mask"][0]
        with torch.no_grad():
            hidden = self.enc(input_ids=enc["input_ids"],
                              attention_mask=att).last_hidden_state[0]
        weights = torch.relu(hidden @ self.w + (self.b if self.b is not None else 0.0))
        vec = np.zeros(VOCAB, dtype=np.float32)
        kept = att.bool()
        for pos in range(len(ids)):
            if not kept[pos] or int(ids[pos]) in self.unused:
                continue
            t = int(ids[pos])
            v = float(weights[pos])
            if v > vec[t]:
                vec[t] = v
        return vec

    def query_vec_batch(self, texts, batch=8):
        return [self.sparse_vec(t) for t in texts]


def run(model, sparse, records, queries):
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

    rec_texts = [r["text"] for r in records]
    rec_ids = [r["id"] for r in records]
    doc_sparse = np.stack([sparse.sparse_vec(t) for t in rec_texts])
    lex = LexicalBM25([tokenize(t) for t in rec_texts])

    model_sp_rank, lex_rank, dense_rank, fused_rank = [], [], [], []
    for qi, q in enumerate(queries):
        qv = sparse.sparse_vec(q["text"])
        sp_scores = doc_sparse @ qv
        lex_scores = np.array([lex.score(tokenize(q["text"]), i)
                               for i in range(len(records))])
        ms = minmax(sp_scores)
        ml = minmax(lex_scores)
        fused = 0.7 * minmax(dense[qi]) + 0.3 * ms
        model_sp_rank.append([rec_ids[i] for i in sorted(
            range(len(rec_ids)), key=lambda i: (-float(sp_scores[i]), rec_ids[i]))[:10]])
        lex_rank.append([rec_ids[i] for i in sorted(
            range(len(rec_ids)), key=lambda i: (-float(lex_scores[i]), rec_ids[i]))[:10]])
        dense_rank.append([uniq[i] for i in sorted(
            range(len(uniq)), key=lambda i: (-float(dense[qi, i]), uniq[i]))[:10]])
        fused_rank.append([rec_ids[i] for i in sorted(
            range(len(rec_ids)), key=lambda i: (-float(fused[i]), rec_ids[i]))[:10]])
    return [
        ("dense", dense_rank), ("lexical", lex_rank),
        ("model-sparse(bge-m3)", model_sp_rank),
        ("weighted(dense,model-sparse) w=0.7", fused_rank),
    ]


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    model = EmbedModel("bge-m3", manifest, PeakRss())
    sparse = BgeSparse(model, manifest)

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
        print(f"[model-sparse] {layer_name}", flush=True)
        for arm, ranked in run(model, sparse, records, queries):
            results.append({"layer": layer_name, "arm": arm, "params": "",
                            **evaluate_arm(ranked, queries)})
            print("  ", results[-1])
    with open(os.path.join(OUT, "results-model-sparse.json"), "w",
              encoding="utf-8") as f:
        json.dump({"environment": {
            "sparseLinear": "sha256:45c93804d214… (sparse_linear.pt, 3.5KB)",
            "recipe": "relu(linear(hidden)) -> amax per token id -> dot"},
            "results": results}, f, ensure_ascii=False, indent=2)
    cols = ["layer", "arm", "recall@1", "recall@5", "recall@10", "mrr",
            "ndcg@10", "hardneg_error", "supersede_correct"]
    with open(os.path.join(OUT, "results-model-sparse.csv"), "w", newline="",
              encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in results:
            w.writerow(r)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
