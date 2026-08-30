#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""activation_features_pre_v2 offline replay (shadow experiment, no prod wiring).

Two-lane policy over existing retrieval outputs:
  hard gates      : harmful -> suppress (correction/stale family)
  echo veto       : containment>=theta AND intentProb<0.5 -> suppress
  explicit lane   : intentProb>=tau_hi AND target-hit AND denseMargin>=delta_exp
                    -> emit ; intentProb>=tau_lo AND hit -> prefetch
  proactive lane  : denseMargin>=delta_pro (task-signal proxy) -> prefetch
  else            : suppress

intentProb = OUT-OF-FOLD grouped-CV probability from the T2 classifier
(char_wb 2-4gram TF-IDF + LR, trained on A/S golds only), so A/S metrics are
not self-fit. P golds are scored by the final model (caveat logged).
Grid over tau_hi x delta_exp; gates: actPrecision>=0.7, harmfulEmit=0,
leak=0; zh / en-mixed reported separately at the chosen cell.
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
    contain = len(qb & cbs) / max(1, len(qb))
    tl = g['queryText'].lower()
    mark = int(any(x in tl for x in INTERROG + RECALL_CTX))
    rows.append({
        'id': g['sampleId'], 'action': g['finalAction'],
        'harmful': bool(g.get('finalHarmful', False)),
        'relay': bool(g.get('requiresCrossWorkspaceRelay')),
        'exp': list(g.get('finalExpectedMemoryIds') or []),
        'forb': list(g.get('finalForbiddenMemoryIds') or []),
        'lang': 'en/mixed' if lang != 'zh' else 'zh',
        'group': (m or {}).get('pairId', g['sampleId']),
        'containment': round(contain, 3), 'mark': mark,
        'margin': round(max(0.0, margin), 4),
        'denseTop': round(ranked[0]['dense'], 4) if ranked else 0.0,
        'nCand': len(ranked),
    })

# ---- intentProb: OOF for A/S rows, final-model for P rows ----
tr = [r for r in rows if r['action'] in ('A', 'S')]
vec = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4), min_df=1,
                      sublinear_tf=True)
texts_by_id = {g['sampleId']: g['queryText'] for g in g1 + g2}
Xt = vec.fit_transform([texts_by_id[r['id']] for r in tr])
yt = np.array([1 if r['action'] == 'A' else 0 for r in tr])
gt = [r['group'] for r in tr]
oof = cross_val_predict(LogisticRegression(max_iter=2000,
                                          class_weight='balanced'),
                        Xt, yt, groups=gt,
                        cv=GroupKFold(n_splits=5),
                        method='predict_proba')[:, 1]
for r, p in zip(tr, oof):
    r['intentProb'] = round(float(p), 4)
final = LogisticRegression(max_iter=2000, class_weight='balanced').fit(Xt, yt)
prows = [r for r in rows if r['action'] == 'P']
if prows:
    pp = final.predict_proba(vec.transform(
        [texts_by_id[r['id']] for r in prows]))[:, 1]
    for r, p in zip(prows, pp):
        r['intentProb'] = round(float(p), 4)

THETA = 0.30


def decide(r, tau_hi, delta_exp, delta_pro=0.05, tau_lo=0.35):
    if r['harmful']:
        return 'suppress'
    # echo veto v2: 词面复述 OR 语义近重复(denseTop) + 陈述句式 + 无回忆意图
    echo_hit = ((r['containment'] >= THETA or r['denseTop'] >= 0.75)
                and r['mark'] == 0)
    if echo_hit and r['intentProb'] < 0.5:
        return 'suppress'
    keys = {c['key'] for c in (scored[r['id']].get('_ranked') or [])}
    hit = bool(set(r['exp']) & keys) if r['exp'] else None
    if r['intentProb'] >= tau_hi:
        if hit and r['margin'] >= delta_exp:
            return 'emit'
        if hit:
            return 'prefetch'
    if r['intentProb'] >= tau_lo and hit:
        return 'prefetch'
    # proactive lane 收紧：低意图 + 非语义近重复 + 高 margin 才允许备用 prefetch
    if (r['margin'] >= delta_pro and r['nCand'] >= 2
            and r['intentProb'] < 0.35 and r['denseTop'] < 0.70):
        return 'prefetch'
    return 'suppress'


def cell(tau_hi, delta_exp):
    m = {'tau_hi': tau_hi, 'delta_exp': delta_exp}
    d = {r['id']: decide(r, tau_hi, delta_exp) for r in rows}
    ev = [r for r in rows if not r['relay']]
    emits = [r for r in ev if d[r['id']] == 'emit']
    good = [r for r in emits if r['action'] == 'A'
            and ({c['key'] for c in scored[r['id']]['_ranked']} & set(r['exp']))
            and not ({c['key'] for c in scored[r['id']]['_ranked']} & set(r['forb']))]
    pre = [r for r in ev if r['action'] == 'P']
    sup = [r for r in ev if r['action'] == 'S']
    m['emits'] = len(emits)
    m['emitCorrectA'] = len(good)
    m['actPrecision'] = round(len(good) / len(emits), 3) if emits else None
    m['actRecall'] = round(len(good) / len([x for x in ev if x['action'] == 'A']), 3)
    m['emitOnP'] = sum(1 for r in pre if d[r['id']] == 'emit')
    m['prefCorrect'] = sum(1 for r in pre if d[r['id']] == 'prefetch')
    m['sViolations'] = sum(1 for r in sup if d[r['id']] != 'suppress')
    m['harmfulEmit'] = sum(1 for r in sup if r['harmful'] and d[r['id']] == 'emit')
    return m


grid = [cell(a, d) for a in (0.45, 0.50, 0.55, 0.60, 0.70)
        for d in (0.02, 0.03, 0.05)]
ok = [g for g in grid if g['actPrecision'] is not None and g['actPrecision'] >= 0.7
      and g['harmfulEmit'] == 0]
best = max(ok or grid,
           key=lambda g: ((g['actPrecision'] or 0), g['actRecall']))

out = {'policyVersion': 'activation_features_pre_v2-replay',
       'thetaEcho': THETA, 'tau_lo': 0.35, 'delta_pro': 0.05,
       'bestCell': best, 'gatesPass': bool(ok),
       'currentDefaultComparison': cell(0.62, 0.62),
       'grid': sorted(grid, key=lambda x: (x['tau_hi'], x['delta_exp']))}

chosen = best
zh = [r for r in rows if not r['relay'] and r['lang'] == 'zh']
en = [r for r in rows if not r['relay'] and r['lang'] != 'zh']
per = {}
for name, sub in (('zh', zh), ('enMixed', en)):
    dd = {r['id']: decide(r, chosen['tau_hi'], chosen['delta_exp'])
          for r in sub}
    per[name] = {
        'n': len(sub),
        'aCorrectEmit': sum(1 for r in sub if r['action'] == 'A'
                            and dd[r['id']] == 'emit'
                            and ({c['key'] for c in scored[r['id']]['_ranked']}
                                 & set(r['exp']))),
        'aTotal': sum(1 for r in sub if r['action'] == 'A'),
        'pPrefetch': sum(1 for r in sub if r['action'] == 'P'
                         and dd[r['id']] == 'prefetch'),
        'pTotal': sum(1 for r in sub if r['action'] == 'P'),
        'sViolations': sum(1 for r in sub if r['action'] == 'S'
                           and dd[r['id']] != 'suppress'),
    }
out['perLanguageAtBest'] = per
out['caveats'] = [
    'intentProb 对 A/S 为分组 OOF；对 P 为全量拟合模型外推（P 判定主要走 margin 门，影响有限）',
    'proactive lane 的任务信号在本重放中仅由 margin 代理（单查询无工具失败/重复上下文）',
    'relay 4 条单列不计入指标；deferred 2 条(cal-0062/0073)整体排除',
]

json.dump(out, open(os.path.join(HERE, 'features-v2-replay.json'), 'w',
                    encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps({'bestCell': best, 'gatesPass': bool(ok),
                  'currentDefault': out['currentDefaultComparison'],
                  'perLanguage': per}, ensure_ascii=False, indent=1))
