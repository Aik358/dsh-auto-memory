#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Variant replay: production candidateHit definition for explicit lane.

Consumes variant-study-rows.json (retrieval + lexical probe output) plus
holdout-scored.jsonl (captured intents), replays the FROZEN two-lane policy
under three hit modes, and reports emit/TP/precision/recall/emitOnSuppress.

  oracle : hit = expectedMemoryIds ∩ dense topK        (acceptance口径)
  A      : hit = oracle OR maxLexNorm(topK) >= theta   (lexical arm trusts)
  A+B    : A, plus explicit & intent>=0.90 & no-hit & denseTop>0 -> prefetch
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(os.path.join(HERE, 'variant-study-rows.json'),
                      encoding='utf-8'))
main = [r for r in rows if r['category'] != 'cross-workspace']
INTENT = {r['sampleId']: r.get('_intentProb', 0.0) for r in
          (json.loads(l) for l in open(os.path.join(HERE,
           'holdout-scored.jsonl'), encoding='utf-8') if l.strip())}


def decide(r, hit, demote):
    ip = INTENT.get(r['sampleId'], 0.0)
    m = r['_margin']; dtop = r['_denseTop']; cnt = r['_containment']
    mark = r['_mark']; ncand = r['_nCand']
    comp_ok = True  # measured: completeness=complete on 100% of this set
    echo_hit = ((cnt >= 0.30 or dtop >= 0.70) and mark == 0 and ip < 0.40)
    if ip >= 0.45:  # explicit lane (tauLane=tauHi=0.45 frozen)
        if hit:
            if m >= 0.03 and comp_ok:
                return 'emit', 'explicit_complete'
            if m >= 0.03:
                return 'prefetch', 'explicit_partial'
            return 'prefetch', 'explicit_margin_low'
        if ip >= 0.35 and hit:
            return 'prefetch', 'explicit_weak'
        if demote and ip >= 0.90 and dtop > 0:
            return 'prefetch', 'explicit_no_hit_demote'
        return 'suppress', 'suppress_low_signal'
    if echo_hit:
        return 'suppress', 'echo_veto_proactive'
    if m >= 0.05 and ncand >= 2 and dtop < 0.70:
        return 'prefetch', 'proactive_margin'
    return 'suppress', 'suppress_low_signal'


def run(hit_fn, label, demote=False):
    emit = tp = sup_viol = 0
    for r in main:
        dec, _rc = decide(r, hit_fn(r), demote)
        if dec == 'emit':
            emit += 1
            if r['goldAction'] == 'activate':
                tp += 1
            if r['goldAction'] == 'suppress':
                sup_viol += 1
    n_act = sum(1 for r in main if r['goldAction'] == 'activate')
    prec = round(tp / emit, 3) if emit else None
    rec = round(tp / n_act, 3) if n_act else None
    print('%-30s emit=%-3d TP=%-3d precision=%-6s recall=%-6s emitOnSup=%d'
          % (label, emit, tp, prec, rec, sup_viol))


print('== %d main-set golds ==' % len(main))
run(lambda r: r['_hit'], 'baseline(oracle hit)')
for th in (8.0, 12.0, 20.0):
    run((lambda th_: (lambda r: r['_hit'] or r['_maxLexRaw'] >= th_))(th),
        'A) oracle|lexRaw>=%s' % th)
run((lambda r: r['_hit'] or r['_maxLexRaw'] >= 12.0),
    'A+B) lex>=12+demote', demote=True)
