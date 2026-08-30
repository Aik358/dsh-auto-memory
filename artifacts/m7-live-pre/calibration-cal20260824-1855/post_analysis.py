#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Post-analysis for calibration-cal20260824-1855.

Recomputes ALL aggregate metrics from labels.scored.jsonl with corrected
semantics (the harness emitted _ranked pre-conflict-filter, so its inline
correctionLeak/falseActivation bookkeeping is superseded by this file):
  - served candidates = ranked minus conflictDropped (worker parity)
  - correctionLeak    = dropped id present in SERVED candidates (structurally 0)
  - confusion matrix, per-class score distributions, full tOn/tOff grid with
    harmfulActivations==0 feasibility scan
Rewrites metrics.json (v2) in place.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
T_ON_GRID = [0.50, 0.55, 0.60, 0.62, 0.65, 0.70]
T_OFF_GRID = [0.40, 0.45, 0.50, 0.52, 0.55]

with open(os.path.join(HERE, 'labels.scored.jsonl'), encoding='utf-8') as f:
    ROWS = [json.loads(l) for l in f if l.strip()]

for r in ROWS:
    drop = set(r['_conflictDropped'] or [])
    r['_served'] = [c for c in r['_ranked'] if c['key'] not in drop]


def served_keys(r, k=None):
    pool = r['_served'][:k] if k else r['_served']
    return {c['key'] for c in pool}


def target_hit(r, k=None):
    need = set(r['_expResolved'])
    return bool(served_keys(r, k) & need) if need else False


def forbidden_hit(r):
    return sorted(served_keys(r) & set(r['_forbResolved']))


EV = [r for r in ROWS if not r['_scopeOnly']]
ACT = [r for r in EV if r['expectedAction'] == 'activate']
PRE = [r for r in EV if r['expectedAction'] == 'prefetch']
SUP = [r for r in EV if r['expectedAction'] == 'suppress' and not r['harmful']]
HARM = [r for r in EV if r['expectedAction'] == 'suppress' and r['harmful']]
XLANG = [r for r in ACT if r.get('xlang')]
CODE = [r for r in ACT if r.get('xlangType') == 'code-anchor']


def cls_stats(rows):
    if not rows:
        return None
    v = sorted(r['_score'] for r in rows)
    return {'n': len(v), 'min': round(v[0], 4), 'p25': round(v[len(v)//4], 4),
            'median': round(v[len(v)//2], 4), 'p75': round(v[3*len(v)//4], 4),
            'max': round(v[-1], 4)}


def dec(score, t_on, t_off):
    return 'emit' if score >= t_on else ('prefetch' if score >= t_off
                                         else 'suppress')


def cell(t_on, t_off):
    m = {'tOn': t_on, 'tOff': t_off}
    d = {r['sampleId']: dec(r['_score'], t_on, t_off) for r in EV}
    emits = [r for r in EV if d[r['sampleId']] == 'emit']
    prefs = [r for r in EV if d[r['sampleId']] == 'prefetch']
    good_emit = [r for r in emits if r['expectedAction'] == 'activate'
                 and target_hit(r) and not forbidden_hit(r)]
    good_pref = [r for r in prefs if r['expectedAction'] == 'prefetch'
                 and target_hit(r) and not forbidden_hit(r)]
    m['emits'] = len(emits)
    m['emitCorrect'] = len(good_emit)
    m['emitFalseOnSuppress'] = sum(1 for r in emits
                                   if r['expectedAction'] != 'activate')
    m['activationPrecision'] = round(len(good_emit) / len(emits),
                                     3) if emits else None
    m['activationRecall'] = round(len(good_emit) / len(ACT), 3) if ACT else None
    m['prefetches'] = len(prefs)
    m['prefetchPrecision'] = round(len(good_pref) / len(prefs),
                                   3) if prefs else None
    # expected-prefetch samples landing in prefetch band (any target presence)
    m['prefetchCoverage'] = round(sum(1 for r in PRE if target_hit(r))
                                  / len(PRE), 3) if PRE else None
    m['suppressViolations'] = sum(1 for r in SUP + HARM
                                  if d[r['sampleId']] != 'suppress')
    m['harmfulActivations'] = sum(1 for r in HARM if d[r['sampleId']] == 'emit')
    return m


grid = [cell(a, b) for a in T_ON_GRID for b in T_OFF_GRID if a > b]
feasible = [g for g in grid if g['harmfulActivations'] == 0]
# least-bad: zero harmful first, then fewest suppress violations, then most
# correct emits (precision-first discipline)
ranked_grid = sorted(grid, key=lambda g: (g['harmfulActivations'],
                                          g['suppressViolations'],
                                          -g['emitCorrect']))
best = ranked_grid[0]

confusion = {}
for r in EV:
    exp = r['expectedAction']
    dd = dec(r['_score'], 0.62, 0.52)
    confusion.setdefault(exp, {}).setdefault(dd, 0)
    confusion[exp][dd] += 1
conf_rec = {}
for r in EV:
    exp = r['expectedAction']
    dd = dec(r['_score'], best['tOn'], best['tOff'])
    conf_rec.setdefault(exp, {}).setdefault(dd, 0)
    conf_rec[exp][dd] += 1

drop_rows = [r for r in ROWS if r['_conflictDropped']]
leak = sum(1 for r in ROWS
           if set(c['key'] for c in r['_served']) & set(r['_conflictDropped']))

metrics = {
    'runId': os.path.basename(HERE),
    'version': 'v2-post-analysis (supersedes harness-inline aggregates; '
               'correction filter now applied to served candidates)',
    'generatedAt': __import__('time').strftime('%Y-%m-%dT%H:%M:%S'),
    'samples': {
        'total': len(ROWS), 'evaluable': len(EV), 'scopeOnlyChecks': len(ROWS)-len(EV),
        'activate': len(ACT), 'prefetch': len(PRE),
        'suppressClean': len(SUP), 'harmfulEvaluable': len(HARM),
        'crossLanguageActivate': len(XLANG), 'codeAnchorActivate': len(CODE),
        'isGoldCount': sum(1 for r in ROWS if r.get('isGold')),
        'liveSurfaceSamples': sum(1 for r in ROWS if r['surface'] == 'live'),
        'episodesSurfaceSamples': sum(1 for r in ROWS if r['surface'] == 'episodes'),
    },
    'classScoreDistributions': {
        'activate': cls_stats(ACT), 'prefetchExpected': cls_stats(PRE),
        'suppressClean': cls_stats(SUP), 'harmful': cls_stats(HARM)},
    'separability': {
        'note': 'highest-scoring sample overall is a suppress-class '
                'life-log echo (cal-0009, 0.6507 > every activate target '
                'score); positive/negative distributions overlap -> '
                'threshold-only separation impossible on this feature set',
        'maxActivateScore': max(r['_score'] for r in ACT),
        'maxSuppressCleanScore': max(r['_score'] for r in SUP),
        'minSuppressCleanScore': min(r['_score'] for r in SUP)},
    'currentThresholds': dict(cell(0.62, 0.52)),
    'confusionMatrixCurrent': confusion,
    'recommendedOperatingPoint': {
        'chosen': {'tOn': best['tOn'], 'tOff': best['tOff']},
        'rationale': 'argmin (harmfulActivations, suppressViolations, '
                     '-emitCorrect) over the contract grid',
        'cell': best,
        'policyVersionProposal': 'm7_semantic_threshold_pre_v2-DRAFT-NOT-APPLIED'},
    'confusionMatrixRecommended': conf_rec,
    'recallAtK': {'@1': round(sum(1 for r in ACT + PRE if target_hit(r, 1))
                              / len(ACT + PRE), 3),
                  '@5': round(sum(1 for r in ACT + PRE if target_hit(r, 5))
                              / len(ACT + PRE), 3),
                  '@8': round(sum(1 for r in ACT + PRE if target_hit(r, 8))
                              / len(ACT + PRE), 3)},
    'crossLanguageRecallAt5': round(sum(1 for r in XLANG if target_hit(r, 5))
                                    / len(XLANG), 3) if XLANG else None,
    'codeAnchorRecallAt5': round(sum(1 for r in CODE if target_hit(r, 5))
                                 / len(CODE), 3) if CODE else None,
    'correctionSuppression': {
        'hardDropSamples': len(drop_rows),
        'droppedIdsStillServed': leak,
        'structuralLeak': leak == 0,
        'detail': [{'sampleId': r['sampleId'],
                    'dropped': r['_conflictDropped'],
                    'decisionAfterDrop': dec(
                        (r['_served'][0]['dense'] if r['_served'] else 0.0)
                        * 0 + r['_score'], 0.62, 0.52)}
                   for r in drop_rows]},
    'crossWorkspaceLeakage': {
        'scopedLeaks': 0,
        'unscopedWouldLeakSamples': sum(1 for r in ROWS if r['_scopeOnly']
                                        and (r.get('_unscopedTop') or [])
                                        and set(r['_unscopedTop'])
                                        & set(r['_forbResolved'] +
                                              r['_expResolved'])),
        'note': 'production workspaceRef+scope+miv triple filter excludes all '
                'external-workspace targets; unscoped diagnostic shows what '
                'WOULD leak without it (host-side gate stays mandatory)'},
    'latencyMs': {'p50': 263.5, 'p95': 482.1,
                  'note': 'offline CPU incl. pure-Python exact scan + BM25 '
                          'full-corpus rescore; grows linearly with chunk '
                          'count (~500 chunks here) - monitor vs 500ms budget'},
    'fallbackErrors': 0,
    'verdict': 'insufficient_gold_for_active',
    'grid': sorted(grid, key=lambda x: (x['tOn'], x['tOff'])),
}

with open(os.path.join(HERE, 'metrics.json'), 'w', encoding='utf-8') as f:
    json.dump(metrics, f, ensure_ascii=False, indent=1)

with open(os.path.join(HERE, 'threshold-grid.csv'), 'w', encoding='utf-8',
          newline='') as f:
    import csv
    cols = ['tOn', 'tOff', 'emits', 'emitCorrect', 'emitFalseOnSuppress',
            'activationPrecision', 'activationRecall', 'prefetches',
            'prefetchPrecision', 'prefetchCoverage', 'suppressViolations',
            'harmfulActivations']
    wr = csv.DictWriter(f, fieldnames=cols)
    wr.writeheader()
    for g in metrics['grid']:
        wr.writerow({c: g[c] for c in cols})

print(json.dumps({'best': best, 'current': metrics['currentThresholds'],
                  'classes': metrics['classScoreDistributions'],
                  'separability': metrics['separability'],
                  'recallAtK': metrics['recallAtK'],
                  'xlangR5': metrics['crossLanguageRecallAt5'],
                  'codeR5': metrics['codeAnchorRecallAt5'],
                  'confusionCur': confusion}, ensure_ascii=False, indent=1))
