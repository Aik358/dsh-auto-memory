#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Real-gold threshold analysis: merge batch1+batch2 human gold with observed
scores (labels.scored.jsonl + cf-scored.jsonl) and compute the first
gold-backed confusion matrices / grid / separability for M7-8 Phase F."""
import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load(p):
    return [json.loads(l) for l in open(os.path.join(HERE, p), encoding='utf-8')
            if l.strip()]


gold1 = load('gold-confirmed.jsonl')
gold2 = load('gold-confirmed-cf.jsonl')
scored_cal = {r['sampleId']: r for r in load(
    '../calibration-cal20260824-1855/labels.scored.jsonl')}
scored_cf = {r['sampleId']: r for r in load('cf-scored.jsonl')}

rows = []
for g in gold1 + gold2:
    s = scored_cal.get(g['sampleId']) or scored_cf.get(g['sampleId'])
    if not s:
        print('WARN no score for', g['sampleId'])
        continue
    if not g.get('isGold'):
        continue
    rows.append({
        'sampleId': g['sampleId'], 'action': g['finalAction'],
        'harmful': bool(g.get('finalHarmful', g.get('previousProposal', {}).get('harmful'))),
        'relay': bool(g.get('requiresCrossWorkspaceRelay')),
        'exp': g.get('finalExpectedMemoryIds') or [],
        'forb': g.get('finalForbiddenMemoryIds') or [],
        'score': s['_score'], 'ranked': s.get('_ranked') or [],
    })

evaluable = [r for r in rows if not r['relay']]
relay_bucket = [r for r in rows if r['relay']]
ACT = [r for r in evaluable if r['action'] == 'A']
PRE = [r for r in evaluable if r['action'] == 'P']
SUP = [r for r in evaluable if r['action'] == 'S']


def hit(r, k=None):
    if not r['exp']:
        return None                       # no unique target -> hit waived
    pool = r['ranked'][:k] if k else r['ranked']
    keys = {c['key'] for c in pool}
    return bool(keys & set(r['exp']))


def forb_hit(r):
    return bool({c['key'] for c in r['ranked']} & set(r['forb']))


def dec(score, ton, toff):
    return 'emit' if score >= ton else ('prefetch' if score >= toff else 'suppress')


def cell(ton, toff):
    m = {'tOn': ton, 'tOff': toff}
    for r in evaluable:
        r['_d'] = dec(r['score'], ton, toff)
    emits = [r for r in evaluable if r['_d'] == 'emit']
    good_emit = [r for r in emits if r['action'] == 'A' and hit(r)
                 and not forb_hit(r)]
    good_pref = [r for r in PRE if r['_d'] == 'prefetch'
                 and (hit(r) is not False)]
    m['emits'] = len(emits)
    m['emitCorrectA'] = len(good_emit)
    m['actPrecision'] = round(len(good_emit) / len(emits), 3) if emits else None
    m['actRecall'] = round(len(good_emit) / len(ACT), 3) if ACT else 0.0
    m['emitOnP'] = sum(1 for r in PRE if r['_d'] == 'emit')
    m['prefCorrect'] = len(good_pref)
    m['prefRecall'] = round(len(good_pref) / len(PRE), 3) if PRE else 0.0
    m['sViolations'] = sum(1 for r in SUP if r['_d'] != 'suppress')
    m['harmfulEmit'] = sum(1 for r in SUP if r['harmful'] and r['_d'] == 'emit')
    return m


T_ON = [0.50, 0.55, 0.60, 0.62, 0.65, 0.70]
T_OFF = [0.40, 0.45, 0.50, 0.52, 0.55]
grid = [cell(a, b) for a in T_ON for b in T_OFF if a > b]

conf_cur = {}
for r in evaluable:
    d = dec(r['score'], 0.62, 0.52)
    conf_cur.setdefault(r['action'], {}).setdefault(d, 0)
    conf_cur[r['action']][d] += 1


def cls(rows_):
    v = sorted(r['score'] for r in rows_)
    return {'n': len(v), 'min': round(v[0], 4), 'median': round(v[len(v)//2], 4),
            'max': round(v[-1], 4)}


best = min(grid, key=lambda g: (g['harmfulEmit'], g['sViolations'],
                                -(g['emitCorrectA'] + g['prefCorrect'])))
metrics = {
    'generatedAt': '2026-08-24',
    'goldTotal': len(rows),
    'evaluable': len(evaluable),
    'crossWorkspaceRelayDeferred': [r['sampleId'] for r in relay_bucket],
    'classScoreDistributions': {'activate': cls(ACT), 'prefetch': cls(PRE),
                                'suppress': cls(SUP)},
    'separabilityGold': {
        'maxActivate': max(r['score'] for r in ACT),
        'maxSuppress': max(r['score'] for r in SUP),
        'overlapSamples': [
            {'sampleId': r['sampleId'], 'score': r['score'],
             'why': 'suppress-gold above some activate-golds'}
            for r in SUP if r['score'] > min(x['score'] for x in ACT)][:8],
    },
    'currentThresholds': cell(0.62, 0.52),
    'confusionCurrent': conf_cur,
    'bestCellByRank': best,
    'recallAtK_goldTargets': {
        '@5': round(sum(1 for r in ACT + PRE if hit(r, 5)) /
                    sum(1 for r in ACT + PRE if r['exp']), 3),
        '@8': round(sum(1 for r in ACT + PRE if hit(r, 8)) /
                    sum(1 for r in ACT + PRE if r['exp']), 3),
    },
    'grid': grid,
}
with open(os.path.join(HERE, 'metrics-gold.json'), 'w', encoding='utf-8') as f:
    json.dump(metrics, f, ensure_ascii=False, indent=1)
with open(os.path.join(HERE, 'threshold-grid-gold.csv'), 'w', encoding='utf-8',
          newline='') as f:
    cols = ['tOn', 'tOff', 'emits', 'emitCorrectA', 'actPrecision', 'actRecall',
            'emitOnP', 'prefCorrect', 'prefRecall', 'sViolations', 'harmfulEmit']
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for g in sorted(grid, key=lambda x: (x['tOn'], x['tOff'])):
        w.writerow({c: g[c] for c in cols})

print(json.dumps({'classes': metrics['classScoreDistributions'],
                  'separabilityGold': metrics['separabilityGold'],
                  'current': metrics['currentThresholds'],
                  'confusion': conf_cur,
                  'best': best,
                  'recallAtK': metrics['recallAtK_goldTargets'],
                  'relay': metrics['crossWorkspaceRelayDeferred']},
                 ensure_ascii=False, indent=1))
