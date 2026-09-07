#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Derive error-analysis.jsonl from labels.scored.jsonl + metrics.json.

For every sample: decision under CURRENT production defaults (tOn=0.62/tOff=
0.52) and under the RECOMMENDED operating point chosen by the calibration
doc, target-hit/forbidden-hit status, and a human-readable explanation when
the observed decision contradicts the expectation. Also emits confusion
matrix counts at both operating points.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(HERE, 'metrics.json'), encoding='utf-8') as f:
    MET = json.load(f)
with open(os.path.join(HERE, 'labels.scored.jsonl'), encoding='utf-8') as f:
    ROWS = [json.loads(l) for l in f if l.strip()]

CUR = MET['currentThresholds']
REC_TON = float(sys.argv[1]) if len(sys.argv) > 1 else CUR['tOn']
REC_TOFF = float(sys.argv[2]) if len(sys.argv) > 2 else CUR['tOff']


def dec(score, t_on, t_off):
    return 'emit' if score >= t_on else ('prefetch' if score >= t_off
                                         else 'suppress')


def explain(r, d):
    exp = r['expectedAction']
    why = []
    if r['_scopeOnly']:
        ext = sorted(set((r['_unscopedTop'] or []))
                     & set(r['_forbResolved'] + r['_expResolved']))
        why.append('scope-check 样本：目标属未同步工作区，生产三重过滤下不可达'
                   '（正确行为=无候选）；unscoped 诊断命中=%s' % (ext or '无'))
        return '; '.join(why)
    if d == 'emit' and exp == 'activate':
        if not r['_hitAt']:
            why.append('emit 但目标未入 top-%d（错误目标激活）' % len(r['_ranked']))
        elif r['_forbResolved'] and set(c['key'] for c in r['_ranked']) & set(r['_forbResolved']):
            why.append('emit 且带 forbidden 候选')
    elif d == 'emit' and exp != 'activate':
        why.append('过度激活：expected=%s 却 emit' % exp)
        if r['harmful']:
            why.append('有害样本被激活（必须为 0）')
    elif exp == 'activate' and d in ('prefetch', 'suppress'):
        why.append('漏激活：expected=activate 得 %s%s'
                   % (d, '' if r['_hitAt'] else '；检索层已失败(目标不在 top-K)'
                      if not r['_hitAt'] else '；检索命中但分数不足'))
    elif exp == 'prefetch' and d == 'emit':
        why.append('越级：expected=prefetch 却 emit（注入强度超出需要）')
    elif exp == 'prefetch' and d == 'suppress':
        why.append('漏 prefetch：expected=prefetch 得 suppress%s'
                   % ('' if r['_hitAt'] else '；目标不在 top-K'))
    elif exp == 'suppress' and d != 'suppress':
        why.append('该抑制未抑制：%s' % d)
        if r['harmful']:
            why.append('有害样本')
    return '; '.join(why)


out = []
conf_cur = {}
conf_rec = {}
for r in ROWS:
    d_cur = r['_decisionCurrent']
    d_rec = dec(r['_score'], REC_TON, REC_TOFF)
    exp = 'scope-check' if r['_scopeOnly'] else r['expectedAction']
    conf_cur[(exp, d_cur)] = conf_cur.get((exp, d_cur), 0) + 1
    conf_rec[(exp, d_rec)] = conf_rec.get((exp, d_rec), 0) + 1
    out.append({
        'sampleId': r['sampleId'],
        'surface': r['surface'],
        'language': r.get('language'),
        'xlang': bool(r.get('xlang')),
        'harmful': bool(r['harmful']),
        'scopeOnly': bool(r['_scopeOnly']),
        'expectedAction': exp,
        'score': r['_score'],
        'denseTop': r['_denseTop'],
        'margin': r['_margin'],
        'hitAt': r['_hitAt'],
        'decisionCurrent': d_cur,
        'decisionRecommended': d_rec,
        'matchCurrent': None if r['_scopeOnly'] else d_cur == (
            'emit' if exp == 'activate' else exp),
        'matchRecommended': None if r['_scopeOnly'] else d_rec == (
            'emit' if exp == 'activate' else exp),
        'conflictDropped': r['_conflictDropped'],
        'top3': [{'key': c['key'], 'dense': c['dense']} for c in r['_ranked'][:3]],
        'expectedTargets': r['_expResolved'],
        'explanation': explain(r, d_cur) or '符合预期',
    })

with open(os.path.join(HERE, 'error-analysis.jsonl'), 'w', encoding='utf-8') as f:
    f.write(json.dumps({'type': 'meta', 'currentThresholds': CUR,
                        'recommendedThresholds': {'tOn': REC_TON,
                                                  'tOff': REC_TOFF}},
                       ensure_ascii=False) + '\n')
    for o in out:
        f.write(json.dumps(o, ensure_ascii=False) + '\n')

print('error-analysis written:', len(out), 'rows')
print('confusion(current):', json.dumps({'%s->%s' % k: v
                                         for k, v in sorted(conf_cur.items())},
                                        ensure_ascii=False))
print('confusion(rec):   ', json.dumps({'%s->%s' % k: v
                                        for k, v in sorted(conf_rec.items())},
                                       ensure_ascii=False))
mism_c = [o['sampleId'] for o in out if o['matchCurrent'] is False]
print('mismatch@current:', len(mism_c), mism_c)
