#!/usr/bin/env python3
"""Held-out independence audit: check 53 candidates vs 86 gold / 55 parity."""
import json, os, hashlib
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))

def load(p):
    return [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]

def norm(t):
    return ''.join(c for c in str(t).lower() if c.isalnum() or '\u4e00' <= c <= '\u9fff')

def bigrams(t):
    n = norm(t)
    return set(n[i:i+2] for i in range(len(n)-1)) or {n}

def jaccard(a, b):
    if not a or not b: return 0.0
    return len(a & b) / len(a | b)

g1 = load('gold-confirmed.jsonl')
g2 = load('gold-confirmed-cf.jsonl')
g3 = load('gold-confirmed-b3.jsonl')
training = [g for g in g1+g2+g3 if g.get('isGold')]
parity = load('golden-parity-fixtures-v1.jsonl')
heldout = load('heldout-review-queue.jsonl')

train_bigrams = [(g['sampleId'], bigrams(g['queryText'])) for g in training]
par_bigrams = [(f.get('sampleId', f.get('id','')), bigrams(f.get('normalizedText', f.get('queryText','')))) for f in parity]

JAC_THRESH = 0.5
results = []
for s in heldout:
    sb = bigrams(s['queryText'])
    overlap_train = any(jaccard(sb, tb) >= JAC_THRESH for _, tb in train_bigrams)
    overlap_par = any(jaccard(sb, pb) >= JAC_THRESH for _, pb in par_bigrams)
    if overlap_par:
        cls = 'overlaps-parity'
    elif overlap_train:
        cls = 'overlaps-training'
    else:
        cls = 'independent-heldout'
    results.append({'sampleId': s['sampleId'], 'classification': cls,
                    'bestTrainJ': round(max((jaccard(sb,tb) for _,tb in train_bigrams), default=0), 3),
                    'bestParJ': round(max((jaccard(sb,pb) for _,pb in par_bigrams), default=0), 3)})

cls_counts = Counter(r['classification'] for r in results)
print(json.dumps(dict(cls_counts), ensure_ascii=False))
json.dump(results, open(os.path.join(HERE,'..','..','feature-v2-heldout',
          'heldout-independence-report.json'),'w'), ensure_ascii=False, indent=1)
indep = sum(1 for r in results if r['classification']=='independent-heldout')
print(f'independent: {indep}/{len(results)}')
