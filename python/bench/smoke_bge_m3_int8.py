#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Smoke + quality spot-check for the prepared Python int8 tier.

Loads Xenova/bge-m3 onnx/model_int8.onnx via onnxruntime (CLS pooling +
L2 normalize, matching frozen D1), then:
  1. latency probe on sample queries;
  2. green-light check: mean cosine(fp32 torch vector, int8 ort vector)
     over 20 shared texts (>0.99 = gate);
  3. mini retrieval check on the L2 hard subset (the 40 authored queries'
     gold episodes vs a 60-distractor pool) compared against fp32 numbers.
Target interpreter: python/bench/.venv (onnxruntime added 2026-08-25).
"""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, REPO) if os.path.isdir(os.path.join(REPO, 'python')) else None
sys.path.insert(0, os.path.join(REPO, 'python'))

MODEL_DIR = os.path.join(REPO, 'python', 'bench', 'models-xenova-bge-m3-int8')
import onnxruntime as ort  # noqa: E402

sess = ort.InferenceSession(os.path.join(MODEL_DIR, 'onnx', 'model_int8.onnx'),
                            providers=['CPUExecutionProvider'])
tok_dir = MODEL_DIR
from transformers import AutoTokenizer  # noqa: E402
tok = AutoTokenizer.from_pretrained(tok_dir)
inp_name = sess.get_inputs()[0].name
att_name = sess.get_inputs()[1].name


def embed(texts):
    """CLS pooling + L2 normalize; returns float32 [n,1024]."""
    enc = tok(texts, padding=True, truncation=True, max_length=512,
              return_tensors='np')
    out = sess.run(None, {inp_name: enc['input_ids'].astype(np.int64),
                          att_name: enc['attention_mask'].astype(np.int64)})[0]
    v = out[:, 0].astype(np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


eps = [json.loads(l) for l in open(os.path.join(REPO, 'artifacts',
        'm7-corpus-pre', 'episodes.jsonl'), encoding='utf-8') if l.strip()]
queries = [json.loads(l) for l in open(os.path.join(REPO, 'artifacts',
           'm7-corpus-pre', 'multilingual-queries.jsonl'),
           encoding='utf-8') if l.strip()]

# 1) latency probe (batch=1 like production query path)
lat = []
for q in queries[:10]:
    t = time.time()
    embed(['query: ' + q['text']])
    lat.append((time.time() - t) * 1000)
print('int8 query latency p50/p95 ms: %.0f / %.0f' % (
    np.percentile(lat, 50), np.percentile(lat, 95)))

# 2) fp32-vs-int8 cosine over 20 texts (torch fp32 reference from bench stack)
import m7_embedding_pre_v1 as emb  # noqa: E402
ref = emb.BgeM3Embedder({'provider': 'bge-m3-pre-v1',
                         'modelDir': ('D:/dsh-auto-memory/python/bench/'
                                      '.hf-cache/models--BAAI--bge-m3/'
                                      'snapshots/5617a9f61b028005a4858fdac845db4'
                                      '06aefb181'),
                         'modelRevision': '5617a9f61b028005a4858fdac845db406aefb181',
                         'dimension': 1024, 'torchThreads': 16})
sample_texts = ['query: ' + q['text'] for q in queries[:20]]
v32 = ref.encode_texts([s[7:] for s in sample_texts])
v8 = embed([s[7:] for s in sample_texts]).astype(np.float32)
cos = np.sum(v32 * v8, axis=1)
print('fp32-vs-int8 cosine mean/min over 20 texts: %.4f / %.4f -> %s' % (
    float(cos.mean()), float(cos.min()),
    'GREEN' if cos.mean() > 0.99 else 'YELLOW'))

# 3) mini retrieval: gold episodes of all 40 queries + 60 distractors
gold_ids = sorted({g for q in queries for g in q.get('gold') or []})
distract = [e['episodeId'] for e in eps if e['episodeId'] not in set(gold_ids)][:60]
pool_ids = gold_ids + distract
texts_by_id = {e['episodeId']: e.get('text') or '' for e in eps}
pv = embed(['passage: ' + texts_by_id[i] for i in pool_ids])
id_pos = {i: k for k, i in enumerate(pool_ids)}
r5 = mrr = 0
for q in queries:
    qv = embed(['query: ' + q['text']])[0]
    sc = pv @ qv
    order = [pool_ids[i] for i in np.argsort(-sc)[:8]]
    first = min((order.index(g) + 1 for g in q['gold'] if g in order),
                default=999)
    r5 += first <= 5
    mrr += 0 if first == 999 else 1 / first
print('mini-retrieval (100-doc pool): R@5=%.3f MRR=%.3f' % (r5 / len(queries),
                                                            mrr / len(queries)))
