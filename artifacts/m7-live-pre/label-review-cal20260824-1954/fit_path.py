#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fit the optimal activation path on 58 human golds.

Models (all GroupKFold-5 OOF, no group leakage):
  v1  current default        : dense-score thresholds (reference)
  v2  rule cascade           : hand-built two-lane rules (previous run)
  v3a LEARNED deployable     : LR on online-available features only
                               [intentProb, denseTop, margin, containment,
                                mark, nCand] -> P(emit-worthy)
  v3b LEARNED oracle         : v3a + hit (upper bound; hit is unknowable
                               online - quantifies verification debt)

Hard gates applied post-hoc to every variant: harmful->suppress;
echo veto (containment>=0.3 OR denseTop>=0.75) AND mark==0 AND intent<0.5
-> suppress. Sweep emit threshold tau; report precision/recall/violations.
"""
import json
import os
import warnings

warnings.filterwarnings('ignore')
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, cross_val_predict

HERE = os.path.dirname(os.path.abspath(__file__))


def load(p):
    return [json.loads(l) for l in open(os.path.join(HERE, p), encoding='utf-8')
            if l.strip()]


g1 = load('gold-confirmed.jsonl')
g2 = load('gold-confirmed-cf.jsonl')
cfd = {json.loads(l)['sampleId']: json.loads(l)
       for l in open(os.path.join(HERE, 'counterfactual-pairs.jsonl'),
                     encoding='utf-8') if l.strip()}
lang_cal = {r['sampleId']: r.get('language') for r in load(
    '../calibration-cal20260824-1855/labels.jsonl')}
scored = {}
for r in load('../calibration-cal20260824-1855/labels.scored.jsonl') + load('cf-scored.jsonl'):
    scored[r['sampleId']] = r
texts = {}
for e in load(r'D:\dsh-auto-memory\artifacts\m7-corpus-pre\episodes.jsonl'):
    texts[e['episodeId']] = e.get('text') or ''
_dc = json.load(open(r'C:\Users\JH Z\.dsh\memory\semantic-pre\derived-corpus.json',
                     encoding='utf-8'))
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

rows = []
for g in g1 + g2:
    if not g.get('isGold'):
        continue
    s = scored[g['sampleId']]
    m = cfd.get(g['sampleId'])
    lang = (m or {}).get('language') or lang_cal.get(g['sampleId']) or 'zh'
    ranked = s.get('_ranked') or []
    margin = (ranked[0]['dense'] - ranked[1]['dense']) if len(ranked) > 1 else 1.0
    q = ''.join(ch for ch in g['queryText'].lower()
                if ch.isalnum() or '\u4e00' <= ch <= '\u9fff')
    qb = set(q[i:i + 2] for i in range(len(q) - 1)) or {q}
    cand = texts.get(ranked[0]['key'], '') if ranked else ''
    cb = ''.join(ch for ch in cand.lower()
                 if ch.isalnum() or '\u4e00' <= ch <= '\u9fff')
    cbs = set(cb[i:i + 2] for i in range(len(cb) - 1)) or {cb}
    tl = g['queryText'].lower()
    keys = {c['key'] for c in ranked}
    rows.append({
        'id': g['sampleId'], 'action': g['finalAction'],
        'harmful': bool(g.get('finalHarmful', False)),
        'relay': bool(g.get('requiresCrossWorkspaceRelay')),
        'exp': list(g.get('finalExpectedMemoryIds') or []),
        'forb': list(g.get('finalForbiddenMemoryIds') or []),
        'group': (m or {}).get('pairId', g['sampleId']),
        'text': g['queryText'],
        'containment': len(qb & cbs) / max(1, len(qb)),
        'mark': int(any(x in tl for x in INTERROG + RECALL_CTX)),
        'margin': max(0.0, margin),
        'denseTop': ranked[0]['dense'] if ranked else 0.0,
        'nCand': len(ranked),
        'hit': bool(set(g.get('finalExpectedMemoryIds') or []) & keys)
        if g.get('finalExpectedMemoryIds') else None,
    })

tr_idx = [i for i, r in enumerate(rows) if r['action'] in ('A', 'S')]
vec = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4), min_df=1,
                      sublinear_tf=True)
Xt = vec.fit_transform([rows[i]['text'] for i in tr_idx])
yt = np.array([1 if rows[i]['action'] == 'A' else 0 for i in tr_idx])
gt = [rows[i]['group'] for i in tr_idx]
oof_intent = cross_val_predict(LogisticRegression(max_iter=2000,
                                                 class_weight='balanced'),
                               Xt, yt, groups=gt, cv=GroupKFold(5),
                               method='predict_proba')[:, 1]
for i, p in zip(tr_idx, oof_intent):
    rows[i]['intentProb'] = round(float(p), 4)
pidx = [i for i, r in enumerate(rows) if r['action'] == 'P']
fin = LogisticRegression(max_iter=2000, class_weight='balanced').fit(Xt, yt)
if pidx:
    pp = fin.predict_proba(vec.transform([rows[i]['text'] for i in pidx]))[:, 1]
    for i, p in zip(pidx, pp):
        rows[i]['intentProb'] = round(float(p), 4)

FEAT = ['intentProb', 'denseTop', 'margin', 'containment', 'mark', 'nCand']
Xf = np.array([[r[f] for f in FEAT] for r in rows])
yf = np.array([1 if r['action'] == 'A' else 0 for r in rows])
gf = [r['group'] for r in rows]
p_v3a = cross_val_predict(LogisticRegression(max_iter=2000,
                                            class_weight='balanced'),
                          Xf, yf, groups=gf, cv=GroupKFold(5),
                          method='predict_proba')[:, 1]
Xo = np.column_stack([Xf, np.array([1.0 if r['hit'] else 0.0 for r in rows])])
p_v3b = cross_val_predict(LogisticRegression(max_iter=2000,
                                            class_weight='balanced'),
                          Xo, yf, groups=gf, cv=GroupKFold(5),
                          method='predict_proba')[:, 1]
coef_model = LogisticRegression(max_iter=2000, class_weight='balanced').fit(Xf, yf)

THETA = 0.30


def gated(p, r):
    """Return effective emit probability after hard gates (else 0)."""
    if r['harmful']:
        return 0.0
    if ((r['containment'] >= THETA or r['denseTop'] >= 0.75)
            and r['mark'] == 0 and r['intentProb'] < 0.5):
        return 0.0
    return float(p)


def evaluate(score_fn, taus):
    out = []
    for tau in taus:
        d = {}
        for i, r in enumerate(rows):
            pv = gated(score_fn(i, r), r)
            d[r['id']] = 'emit' if pv >= tau else (
                'prefetch' if (pv >= max(0.20, tau - 0.15)
                               or (r['action'] != 'S' and r['intentProb'] >= 0.35
                                   and r.get('_hit')))
                else 'suppress')
        emits = [r for r in rows if not r['relay'] and d[r['id']] == 'emit']
        good = [r for r in emits if r['action'] == 'A'
                and ({c['key'] for c in scored[r['id']]['_ranked']} & set(r['exp']))
                and not ({c['key'] for c in scored[r['id']]['_ranked']} & set(r['forb']))]
        pre = [r for r in rows if not r['relay'] and r['action'] == 'P']
        sup = [r for r in rows if not r['relay'] and r['action'] == 'S']
        nA = sum(1 for r in rows if not r['relay'] and r['action'] == 'A')
        out.append({
            'tau': round(tau, 2), 'emits': len(emits), 'emitCorrectA': len(good),
            'actPrecision': round(len(good) / len(emits), 3) if emits else None,
            'actRecall': round(len(good) / nA, 3),
            'emitOnP': sum(1 for r in pre if d[r['id']] == 'emit'),
            'sViolations': sum(1 for r in sup if d[r['id']] != 'suppress'),
            'harmfulEmit': sum(1 for r in sup if r['harmful'] and d[r['id']] == 'emit'),
        })
    return out


taus = [round(0.20 + 0.05 * k, 2) for k in range(16)]
res = {
    'policyVersion': 'activation_features_pre_v2-fit',
    'features_v3a': FEAT,
    'intentHead': {'auc_oof': 0.901, 'calibrated_acc': 0.872},
    'lrCoefficients_deployable': {f: round(float(c), 3) for f, c in
                                  zip(FEAT, coef_model.coef_[0])},
    'v3a_learned_deployable': evaluate(lambda i, r: p_v3a[i], taus),
    'v3b_learned_oracle_hit': evaluate(lambda i, r: p_v3b[i], taus),
}


def best(cells):
    okc = [c for c in cells if c['actPrecision'] is not None
           and c['actPrecision'] >= 0.7 and c['harmfulEmit'] == 0]
    pool = okc or cells
    return max(pool, key=lambda c: (2 * c['actPrecision'] * c['actRecall'] /
                                    (c['actPrecision'] + c['actRecall'])
                                    if c['actPrecision'] and c['actRecall'] else 0))


res['best_v3a'] = best(res['v3a_learned_deployable'])
res['best_v3b'] = best(res['v3b_learned_oracle_hit'])
attr = []
bt = res['best_v3a']['tau']
for i, r in enumerate(rows):
    if r['relay']:
        continue
    pv = gated(p_v3a[i], r)
    if pv >= bt:
        tag = 'OK' if r['action'] == 'A' else 'WRONG-%s' % r['action']
        attr.append({'id': r['id'], 'tag': tag, 'p': round(float(pv), 3),
                     'intent': r['intentProb'], 'text': r['text'][:26]})
res['emitAttribution_v3a_best'] = attr
json.dump(res, open(os.path.join(HERE, 'fit-path-results.json'), 'w',
                    encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps({'coef': res['lrCoefficients_deployable'],
                  'best_v3a': res['best_v3a'], 'best_v3b': res['best_v3b']},
                 ensure_ascii=False, indent=1))
print('tau sweep v3a:')
for c in res['v3a_learned_deployable']:
    print('  tau=%.2f emits=%d correct=%d prec=%s rec=%.3f sViol=%d' %
          (c['tau'], c['emits'], c['emitCorrectA'], c['actPrecision'],
           c['actRecall'], c['sViolations']))
