#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Full L2 head-to-head: bge-m3 int8 (onnxruntime) vs fp32 (torch), SAME protocol.

Protocol notes: whole-text truncated to 512 tokens (NOT the production
para-512 chunk+aggregate path) so both backends share one code path; bge-m3
uses NO query/passage prefixes per model card FAQ. Metrics mirror the M7-2
L2 table (R@1/R@5/MRR/nDCG@10/negHit@5). Verdict metric = R@5 delta.
Target interpreter: python/bench/.venv."""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))

import onnxruntime as ort  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402

MODEL_DIR = os.path.join(HERE, 'models-xenova-bge-m3-int8')
sess = ort.InferenceSession(os.path.join(MODEL_DIR, 'onnx', 'model_int8.onnx'),
                            providers=['CPUExecutionProvider'])
tok = AutoTokenizer.from_pretrained(MODEL_DIR)
IN, AT = sess.get_inputs()[0].name, sess.get_inputs()[1].name


def embed_ort(texts):
    out = []
    for i in range(0, len(texts), 16):
        enc = tok(texts[i:i + 16], padding=True, truncation=True,
                  max_length=512, return_tensors='np')
        o = sess.run(None, {IN: enc['input_ids'].astype(np.int64),
                            AT: enc['attention_mask'].astype(np.int64)})[0]
        v = o[:, 0].astype(np.float32)
        out.append(v / np.linalg.norm(v, axis=1, keepdims=True))
    return np.concatenate(out)


sys.path.insert(0, os.path.join(REPO, 'python'))
import m7_embedding_pre_v1 as emb  # noqa: E402

REF_DIR = ('D:/dsh-auto-memory/python/bench/.hf-cache/models--BAAI--bge-m3/'
           'snapshots/5617a9f61b028005a4858fdac845db406aefb181')


def embed_fp32(texts):
    ref = emb.BgeM3Embedder({'provider': 'bge-m3-pre-v1', 'modelDir': REF_DIR,
                             'modelRevision':
                                 '5617a9f61b028005a4858fdac845db406aefb181',
                             'dimension': 1024, 'torchThreads': 16})
    return np.array(ref.encode_texts(texts), dtype=np.float32)


eps = [json.loads(l) for l in open(os.path.join(REPO, 'artifacts',
        'm7-corpus-pre', 'episodes.jsonl'), encoding='utf-8') if l.strip()]
queries = [json.loads(l) for l in open(os.path.join(REPO, 'artifacts',
           'm7-corpus-pre', 'multilingual-queries.jsonl'),
           encoding='utf-8') if l.strip()]
doc_texts = [(e.get('text') or '').replace('\n', ' ').strip()[:2000]
             for e in eps]
q_texts = [q['text'] for q in queries]
ep_ids = [e['episodeId'] for e in eps]


def metrics(doc_vecs, q_vecs):
    r1 = r5 = mrr = ndcg = neg5 = 0
    for qi, q in enumerate(queries):
        sc = doc_vecs @ q_vecs[qi]
        order = np.argsort(-sc)[:64]
        ranked = [ep_ids[i] for i in order]
        first = min((ranked.index(g) + 1 for g in q.get('gold') or []
                     if g in ranked), default=999)
        r1 += first == 1
        r5 += first <= 5
        mrr += 0 if first == 999 else 1 / first
        dcg = sum(1 / np.log2(i + 2) for i, gid in enumerate(ranked[:10])
                  if gid in (q.get('gold') or []))
        idcg = sum(1 / np.log2(i + 2)
                   for i in range(min(len(q.get('gold') or []), 10)))
        ndcg += dcg / idcg if idcg else 0
        if any(n in ranked[:5] for n in (q.get('neg') or [])):
            neg5 += 1
    n = len(queries)
    return dict(R1=round(r1 / n, 3), R5=round(r5 / n, 3),
                MRR=round(mrr / n, 3), nDCG10=round(ndcg / n, 3),
                negHit5=round(neg5 / n, 3))


t = time.time()
dv8 = embed_ort(doc_texts)
qv8 = embed_ort(q_texts)
t8 = time.time() - t
m8 = metrics(dv8, qv8)

t = time.time()
dv32 = embed_fp32(doc_texts)
qv32 = embed_fp32(q_texts)
t32 = time.time() - t
m32 = metrics(dv32, qv32)

cosd = np.sum((dv8 * dv32 / np.linalg.norm(dv32, axis=1, keepdims=True)), axis=1)
print('int8 :', json.dumps(m8), '| encode %ds' % round(t8))
print('fp32 :', json.dumps(m32), '| encode %ds' % round(t32))
print('vec cosine int8-vs-fp32 mean/min over %d docs: %.4f / %.4f'
      % (len(eps), float(cosd.mean()), float(cosd.min())))
print('R5 delta:', round(m8['R5'] - m32['R5'], 3))
