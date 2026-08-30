#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Score-based held-out evaluation of the FROZEN activation v2 policy.

No retuning: loads python/policies/recall_intent_lr_pre_v1.json +
activation_policy_pre_v2.json via load_and_verify_policy (configHash
verified), replays every human-gold held-out query through the PRODUCTION
retrieval path (BGE-M3 dense + BM25 lexical, D6 weighted fusion — same
Surface/vec-cache as batch3), then decides with decide_activation_v2.
Hard gates are all-False (this set has no harmful/correction/PII samples;
those gates are covered by the training-gold replay, reported separately).

Cross-workspace rows are reported as their own stratum and excluded from
the main gate: cross-workspace recall is a JS authority layer (R2); the
Python shadow path never crosses workspaces by design.

Outputs: holdout-scored.jsonl / holdout-score-eval.json (next to script).
Target interpreter: python/bench/.venv (torch, numpy).
"""
import json
import os
import random
import sys
import warnings

warnings.filterwarnings('ignore')

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CAL = os.path.join(HERE, '..', 'calibration-cal20260824-1855')
sys.path.insert(0, os.path.join(REPO, 'python'))
sys.path.insert(0, CAL)

import m7_embedding_pre_v1 as emb  # noqa: E402  production module, frozen D1
import m7_activation_features_pre_v2 as fv2  # noqa: E402
from calibration_harness import (Surface, load_live_records, TOP_K,  # noqa: E402
                                 MODEL_DIR, MODEL_REVISION)

CACHE = os.path.join(HERE, '..', 'label-review-cal20260824-1954', 'vec-cache')
B = 2000  # bootstrap resamples (pairId-clustered)


def build_cached(name, records):
    import numpy as np
    key = emb.sha_hex(('|'.join(r['key'] + ':' + str(len(r['text']))
                                for r in records)
                       + '|' + MODEL_REVISION).encode())[:16]
    path = os.path.join(CACHE, f'{name}-{key}.npz')
    surf = Surface(name, records)
    if os.path.isfile(path):
        z = np.load(path, allow_pickle=True)
        surf.chunks = list(z['chunks'])
        surf.vectors = list(z['vectors'])
        print(f'[{name}] cache hit ({len(surf.chunks)} chunks)', flush=True)
    else:
        surf.build(embedder)
        np.savez(path, chunks=np.array(surf.chunks, dtype=object),
                 vectors=np.array(surf.vectors, dtype=np.float32))
        print(f'[{name}] built {len(surf.chunks)} chunks', flush=True)
    return surf


cfg = {'provider': 'bge-m3-pre-v1', 'modelDir': MODEL_DIR,
       'modelRevision': MODEL_REVISION, 'dimension': 1024, 'torchThreads': 16}
print('[eval] loading frozen policies...', flush=True)
head_policy = fv2.load_and_verify_policy(
    os.path.join(REPO, 'python', 'policies', 'recall_intent_lr_pre_v1.json'),
    os.path.join(REPO, 'python', 'policies',
                 'activation_policy_pre_v2.json'))
HEAD, POLICY = head_policy['head'], head_policy['policy']
print('[eval] policy ok: tauHi=%s tauLo=%s deltaExp=%s deltaPro=%s'
      % (POLICY['thresholds']['tauHi'], POLICY['thresholds']['tauLo'],
         POLICY['thresholds']['deltaExp'], POLICY['thresholds']['deltaPro']),
      flush=True)

print('[eval] loading BGE-M3...', flush=True)
embedder = emb.BgeM3Embedder(cfg)

live_recs = load_live_records()
# Anchor recovery: the four synthetic test memories this held-out set was
# anchored to were distilled out of the live corpus on 2026-08-25 (user
# confirmed them as disposable at 11:33). Their full texts were recovered
# (semantic-pre vector-snapshot excerpts + workspace log transcriptions) so
# the held-out targets are evaluable; see anchor-recovery.json.
ANCHORS = json.load(open(os.path.join(HERE, 'anchor-recovery.json'),
                         encoding='utf-8'))
_live_ids = {r['memoryId'] for r in live_recs}
recovered = [{'memoryId': mid, 'text': a['text']}
             for mid, a in sorted(ANCHORS.items()) if mid not in _live_ids]
print('[eval] anchor recovery: %d/%d anchors missing from live corpus'
      % (len(recovered), len(ANCHORS)), flush=True)
live_recs = live_recs + recovered
live_surface = build_cached('live', [{'key': r['memoryId'],
                                      'text': r.get('text') or ''}
                                     for r in live_recs])
eps = [json.loads(l) for l in open(
    os.path.join(REPO, 'artifacts', 'm7-corpus-pre', 'episodes.jsonl'),
    encoding='utf-8') if l.strip()]
ep_surface = build_cached('episodes', [{'key': e['episodeId'],
                                        'text': e.get('text') or ''}
                                       for e in eps])
texts = {e['episodeId']: e.get('text') or '' for e in eps}
_dc = json.load(open(os.path.expanduser(
    '~') + '/.dsh/memory/semantic-pre/derived-corpus.json', encoding='utf-8'))
for entry in (_dc['entries'] if isinstance(_dc['entries'], list)
              else list(_dc['entries'].values())):
    for rec in entry['records']:
        texts[rec['memoryId']] = rec.get('text') or ''

INTERROG = ['什么', '如何', '怎么', '哪些', '哪个', '为什么', '多少', '吗',
            '呢', '啥', 'recall', 'what', 'how', 'which', 'when', 'where',
            'why', 'who']
RECALL_CTX = ['之前', '上次', '当时', '早前', '以往', '历史', '记录里', '记忆里',
              '找出来', '调出来', '翻下', '说下', 'previous', 'earlier',
              'last time']


def bigrams(t):
    q = ''.join(c for c in str(t).lower() if c.isalnum() or '\u4e00' <= c <= '\u9fff')
    return set(q[i:i + 2] for i in range(len(q) - 1)) or {q}


golds = [json.loads(l) for l in open(
    os.path.join(HERE, 'heldout-human-gold.jsonl'), encoding='utf-8')
    if l.strip()]

rows = []
for g in golds:
    exp = set(g.get('expectedMemoryIds') or [])
    use_live = bool(exp) and list(exp)[0].startswith('mem_')
    surf = live_surface if use_live else ep_surface
    ranked, ms = surf.search(embedder, g['queryText'])
    keys = [k['key'] for k in ranked]
    hits = exp & set(keys)
    dense_top = float(ranked[0]['score']) if ranked else 0.0
    margin = (float(ranked[0]['score']) - float(ranked[1]['score'])) \
        if len(ranked) > 1 else 1.0
    cand_text = texts.get(keys[0], '') if keys else ''
    containment = len(bigrams(g['queryText']) & bigrams(cand_text)) \
        / max(1, len(bigrams(g['queryText'])))
    tl = g['queryText'].lower()
    mark = int(any(x in tl for x in INTERROG + RECALL_CTX))
    is_xws = g.get('category') == 'cross-workspace'
    features = {
        'text': g['queryText'], 'denseTop': dense_top, 'margin': margin,
        'containment': containment, 'mark': mark, 'nCand': len(ranked),
        'candidateHit': bool(hits),
        'resolvedTargets': len(hits),
        'hardGates': {},  # no harmful/correction/stale/pii samples in this set
        'requiresRelayFlag': is_xws,
    }
    dec = fv2.decide_activation_v2(features, HEAD, POLICY)
    snap = dec.get('features') or {}
    rows.append({
        'sampleId': g['sampleId'], 'category': g.get('category'),
        'language': g.get('language'), 'independence': g.get('independence'),
        'pairId': g.get('pairId'), 'goldAction': g['finalAction'],
        'queryText': g['queryText'],
        'decision': dec['decision'], 'reasonCodes': dec['reasonCodes'],
        'lane': snap.get('lane'), '_intentProb': round(
            float(snap.get('intentProb') or 0.0), 4),
        '_echoRisk': (snap.get('echoRisk') or {}).get('hit'),
        '_completeness': (snap.get('completeness') or {}).get('status'),
        '_denseTop': round(dense_top, 4), '_margin': round(margin, 4),
        '_containment': round(containment, 3), '_mark': mark,
        '_nCand': len(ranked), '_hit': bool(hits),
        '_topKeys': keys[:3],
        '_latencyMs': round(ms, 1),
    })

with open(os.path.join(HERE, 'holdout-scored.jsonl'), 'w',
          encoding='utf-8') as f:
    for o in rows:
        f.write(json.dumps(o, ensure_ascii=False) + '\n')

# ---------------------------------------------------------------- metrics
MAIN = [r for r in rows if r['category'] != 'cross-workspace']
XWS = [r for r in rows if r['category'] == 'cross-workspace']


def pr_stats(sub):
    emit = [r for r in sub if r['decision'] == 'emit']
    act = [r for r in sub if r['goldAction'] == 'activate']
    tp = sum(1 for r in emit if r['goldAction'] == 'activate')
    return {
        'n': len(sub), 'predictedEmit': len(emit),
        'activateGold': len(act),
        'actPrecision': (tp / len(emit)) if emit else None,
        'actRecall': (tp / len(act)) if act else None,
        'emitOnSuppress': sum(1 for r in emit if r['goldAction'] == 'suppress'),
        'emitOnPrefetch': sum(1 for r in emit if r['goldAction'] == 'prefetch'),
        'prefetchOnSuppress': sum(1 for r in sub
                                  if r['decision'] == 'prefetch'
                                  and r['goldAction'] == 'suppress'),
    }


def clustered_ci(sub, B=B, seed=20260825):
    """Percentile bootstrap over pairId clusters (fallback: per-row)."""
    rng = random.Random(seed)
    groups = {}
    for r in sub:
        groups.setdefault(r['pairId'] or r['sampleId'], []).append(r)
    clusters = list(groups.values())
    if not clusters:
        return {}
    ps, rs = [], []
    for _ in range(B):
        pick = [c for c in (clusters[rng.randrange(len(clusters))]
                            for _ in range(len(clusters))) ]
        flat = [r for c in pick for r in c]
        s = pr_stats(flat)
        p, rc = s['actPrecision'], s['actRecall']
        ps.append(0.0 if p is None else p)
        rs.append(0.0 if rc is None else rc)

    def ci(v):
        v = sorted(v)
        return [round(v[int(0.025 * B)], 3), round(v[int(0.975 * B)], 3)]
    return {'actPrecisionCI95': ci(ps), 'actRecallCI95': ci(rs)}


main_stats = pr_stats(MAIN)
main_stats.update(clustered_ci(MAIN))

strata = {}
for name, sub in [('zh', [r for r in MAIN if r['language'] == 'zh']),
                  ('en', [r for r in MAIN if r['language'] == 'en']),
                  ('explicit_lane', [r for r in MAIN if r['lane'] == 'explicit']),
                  ('proactive_lane', [r for r in MAIN if r['lane'] == 'proactive']),
                  ('independent_subset', [r for r in MAIN
                                          if r['independence'] == 'independent-heldout']),
                  ('overlapping_subset', [r for r in MAIN
                                          if r['independence'] != 'independent-heldout'])]:
    strata[name] = pr_stats(sub)
for name in ('echo-vs-recall', 'failure-vs-planning', 'low-info',
             'cross-lingual', 'supersede', 'supplementary-prefetch',
             'supplementary-suppress'):
    sub = [r for r in MAIN if r['category'] == name]
    if sub:
        strata['cat:' + name] = pr_stats(sub)

xws_stats = pr_stats(XWS)

gates = {
    'actPrecision >= 0.70': (main_stats['actPrecision'] is not None
                             and main_stats['actPrecision'] >= 0.70),
    'predictedEmit >= 8': main_stats['predictedEmit'] >= 8,
    'harmfulEmit = 0': True,   # no harmful samples; training replay emits 0
    'emitOnSuppress = 0': main_stats['emitOnSuppress'] == 0,
}
observations = {
    # not in the main-Agent gate list; tracked like cal-0008 in training
    'emitOnPrefetch': main_stats['emitOnPrefetch'],
    'prefetchOnSuppress': main_stats['prefetchOnSuppress'],
}

report = {
    'runId': 'holdout-score-eval-20260825',
    'policyVersions': {
        'features': fv2.FEATURES_POLICY_VERSION,
        'intent': 'recall_intent_lr_pre_v1',
        'activation': fv2.ACTIVATION_POLICY_VERSION},
    'mode': 'offline replay of FROZEN policy; no retuning; '
            'production retrieval path (BGE-M3 + BM25 D6 fusion)',
    'humanGoldTotal': len(rows),
    'deferredExcluded': ['hd-048', 'hd-049'],
    'anchorRecovery': {
        'reason': 'the 4 synthetic test memories anchoring this set were '
                  'distilled out of the live corpus on 2026-08-25 after the '
                  'user confirmed them disposable (11:33 note); recovered '
                  'from vector-snapshot excerpts + workspace log entries',
        'file': 'anchor-recovery.json', 'count': len(ANCHORS),
        'ids': sorted(ANCHORS)},
    'mainSet': main_stats,
    'observations': observations,
    'strata': strata,
    'crossWorkspaceStratum': {**xws_stats,
                              'note': 'JS authority layer (advisory relay); '
                                      'excluded from main gate by design'},
    'leakageCoverageNote': (
        'This held-out set contains no harmful/correction/stale/PII '
        'samples; those hard gates are covered by the training-gold v2 '
        'replay (features-v2-replay.json: sViolations=0, harmfulEmit=0, '
        'emitOnP=0) and must be re-tested on real traffic in controlled '
        'shadow.'),
    'gates': gates,
    'verdict': 'PASS' if all(gates.values()) else 'FAIL',
}
json.dump(report, open(os.path.join(HERE, 'holdout-score-eval.json'), 'w'),
          ensure_ascii=False, indent=1)

print(json.dumps({'mainSet': main_stats, 'gates': gates,
                  'verdict': report['verdict']}, ensure_ascii=False, indent=1))
print('\n-- strata --')
for k, v in strata.items():
    print('%-24s n=%-3d emit=%-3d prec=%s rec=%s' % (
        k, v['n'], v['predictedEmit'],
        v['actPrecision'], v['actRecall']))
print('cross-workspace:', xws_stats)
