#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pre-score all 109 counterfactual samples through the production code path
(same parity as calibration_harness.py) and write cf-scored.jsonl.
Vector caches under vec-cache/ make later gold reruns instant."""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'python'))
sys.path.insert(0, os.path.join(HERE, '..', 'calibration-cal20260824-1855'))

import m7_embedding_pre_v1 as emb
from calibration_harness import (Surface, tokenize, STOP, minmax, semantic_score,
                                 decision_first_obs, load_live_records, TOP_K,
                                 WDENSE, MODEL_DIR, MODEL_REVISION)

CACHE = os.path.join(HERE, 'vec-cache')
os.makedirs(CACHE, exist_ok=True)

cfg = {'provider': 'bge-m3-pre-v1', 'modelDir': MODEL_DIR,
       'modelRevision': MODEL_REVISION, 'dimension': 1024, 'torchThreads': 16}
print('[cfscore] loading BGE-M3...', flush=True)
embedder = emb.BgeM3Embedder(cfg)


def build_cached(name, records):
    """Surface build with npz vector cache keyed by record digests."""
    import numpy as np
    key = emb.sha_hex(('|'.join(r['key'] + ':' + str(len(r['text'])) for r in records)
                       + '|' + MODEL_REVISION).encode())[:16]
    path = os.path.join(CACHE, f'{name}-{key}.npz')
    surf = Surface(name, records)
    if os.path.isfile(path):
        z = np.load(path, allow_pickle=True)
        surf.chunks = list(z['chunks'])
        surf.vectors = list(z['vectors'])
        print(f'[cfscore] {name}: cache hit ({len(surf.chunks)} chunks)', flush=True)
    else:
        surf.build(embedder)
        np.savez(path, chunks=np.array(surf.chunks, dtype=object),
                 vectors=np.array(surf.vectors, dtype=np.float32))
        print(f'[cfscore] {name}: built {len(surf.chunks)} chunks '
              f'({surf.build_sec}s), cached', flush=True)
    return surf


live_recs = load_live_records()
live_surface = build_cached('live', [{'key': r['memoryId'], 'text': r.get('text') or ''}
                                     for r in live_recs])
eps = [json.loads(l) for l in open(os.path.join(REPO, 'artifacts', 'm7-corpus-pre',
                                                'episodes.jsonl'), encoding='utf-8')
       if l.strip()]
ep_surface = build_cached('episodes', [{'key': e['episodeId'], 'text': e.get('text') or ''}
                                       for e in eps])
ws_core_keys = {e['episodeId'] for e in eps if e.get('workspace') == 'ws/dsh-core'}

cf = [json.loads(l) for l in open(os.path.join(HERE, 'counterfactual-pairs.jsonl'),
                                  encoding='utf-8') if l.strip()]
lat = []
out = []
for s in cf:
    surf = live_surface if s.get('parentMemoryId') else ep_surface
    scoped = None
    scope_only = False
    unscoped_top = None
    if s.get('parentMemoryId') is None and s.get('workspaceScope'):
        eligible = set(ws_core_keys)
        targets = [k for k in (s.get('expectedMemoryIds') or []) +
                   (s.get('forbiddenMemoryIds') or []) if k in ep_surface.by_key]
        ext = [k for k in targets if k not in eligible]
        if ext:
            scope_only = True
        scoped = eligible
    cands, ms = surf.search(embedder, s['queryText'], eligible_keys=scoped)
    lat.append(ms)
    if scoped is not None:
        u, _ = surf.search(embedder, s['queryText'], eligible_keys=None)
        unscoped_top = [c['key'] for c in u[:TOP_K]]
    exp = list(s.get('expectedMemoryIds') or [])
    forb = list(s.get('forbiddenMemoryIds') or [])
    keys = [c['key'] for c in cands]
    hit_at = next((i + 1 for i, k in enumerate(keys) if k in set(exp)), None)
    forb_hit = sorted(set(keys[:TOP_K]) & set(forb))
    top_dense = cands[0]['score'] if cands else 0.0
    second = cands[1]['score'] if len(cands) > 1 else 0.0
    score = semantic_score(top_dense, max(0.0, top_dense - second))
    out.append({
        'sampleId': s['sampleId'], 'pairId': s['pairId'], 'category': s['category'],
        'surface': surf.name, 'scopeOnly': scope_only,
        'proposedAction': s['proposedAction'], 'language': s.get('language'),
        'expectedMemoryIds': exp, 'forbiddenMemoryIds': forb,
        '_score': float(score), '_denseTop': round(float(top_dense), 6),
        '_margin': round(float(max(0.0, top_dense - second)), 6),
        '_ranked': [{'key': c['key'], 'dense': round(float(c['score']), 6)}
                    for c in cands[:TOP_K]],
        '_hitAt': hit_at, '_forbiddenHit': forb_hit, '_unscopedTop': unscoped_top,
        '_decisionCurrent': decision_first_obs(score, 0.62, 0.52),
        '_latencyMs': round(ms, 1),
    })

with open(os.path.join(HERE, 'cf-scored.jsonl'), 'w', encoding='utf-8') as f:
    for o in out:
        f.write(json.dumps(o, ensure_ascii=False) + '\n')

sc = sorted(o['_score'] for o in out)
print('[cfscore] done: %d samples | score min/p50/max = %.3f/%.3f/%.3f | '
      'p50/p95 latency = %.0f/%.0f ms'
      % (len(out), sc[0], sc[len(sc)//2], sc[-1],
         sorted(lat)[len(lat)//2], sorted(lat)[int(len(lat)*0.95)]))
from collections import Counter
print('[cfscore] decisions@current:',
      dict(Counter(o['_decisionCurrent'] for o in out)))
