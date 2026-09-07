#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extension probes (Chinese / cross-lingual direction):
X1 zh->en/mixed cross-lingual transfer of the calibrated intent classifier
X2 combined echo rule (containment x no-intent-marker) grid vs single signals
X3 interrogative/recall lexicon baseline for recallIntent
Writes extend-probe-results.json."""
import json
import os
import warnings

warnings.filterwarnings('ignore')
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import f1_score

HERE = os.path.dirname(os.path.abspath(__file__))


def load(p):
    return [json.loads(l) for l in open(os.path.join(HERE, p), encoding='utf-8')
            if l.strip()]


g1 = load('gold-confirmed.jsonl')
g2 = load('gold-confirmed-cf.jsonl')
cfd = {json.loads(l)['sampleId']: json.loads(l)
       for l in open(os.path.join(HERE, 'counterfactual-pairs.jsonl'),
                     encoding='utf-8') if l.strip()}
scored_cal = {r['sampleId']: r for r in load(
    '../calibration-cal20260824-1855/labels.scored.jsonl')}
scored_cf = {r['sampleId']: r for r in load('cf-scored.jsonl')}
lang_cal = {r['sampleId']: r.get('language') for r in load(
    '../calibration-cal20260824-1855/labels.jsonl')}

rows = []
for g in g1 + g2:
    if not g.get('isGold'):
        continue
    s = scored_cal.get(g['sampleId']) or scored_cf.get(g['sampleId'])
    m = cfd.get(g['sampleId'])
    lang = (m or {}).get('language') or lang_cal.get(g['sampleId']) or 'zh'
    rows.append({'id': g['sampleId'], 'action': g['finalAction'],
                 'text': g['queryText'], 'lang': lang,
                 'group': (m or {}).get('pairId', g['sampleId']),
                 'topKey': s['_ranked'][0]['key'] if s and s.get('_ranked') else None})

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
              '找出来', '调出来', '翻下', '说下', 'previous', 'earlier', 'last time']


def has_mark(t, marks):
    tl = t.lower()
    return int(any(m in tl for m in marks))


def bigrams(t):
    t = ''.join(ch for ch in t.lower() if ch.isalnum() or '\u4e00' <= ch <= '\u9fff')
    return set(t[i:i + 2] for i in range(len(t) - 1)) or {t}


def containment(r):
    q = bigrams(r['text'])
    c = bigrams(texts.get(r['topKey'], ''))
    return len(q & c) / max(1, len(q))


res = {}

# ---- X1: zh -> en/mixed transfer ----
binr = [r for r in rows if r['action'] in ('A', 'S')]
zh = [r for r in binr if r['lang'] == 'zh']
en = [r for r in binr if r['lang'] != 'zh']
vec = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4), min_df=1,
                      sublinear_tf=True)
Xz = vec.fit_transform([r['text'] for r in zh])
yz = np.array([1 if r['action'] == 'A' else 0 for r in zh])
gz = [r['group'] for r in zh]
gkf = GroupKFold(n_splits=min(5, len(set(gz))))
pz = cross_val_predict(LogisticRegression(max_iter=2000, class_weight='balanced'),
                       Xz, yz, groups=gz, cv=gkf, method='predict_proba')[:, 1]
clf = LogisticRegression(max_iter=2000, class_weight='balanced').fit(Xz, yz)
res['X1_zh_to_en_transfer'] = {
    'zhTrain_n': len(zh), 'zhPositives': int(yz.sum()),
    'zh_cv_auc': round(float(__import__('sklearn.metrics', fromlist=['roc_auc_score'])
                             .roc_auc_score(yz, pz)), 3),
    'enMixedTest_n': len(en),
    'enMixed_ids': [r['id'] for r in en],
    'enMixed_meanP': round(float(np.mean(clf.predict_proba(
        vec.transform([r['text'] for r in en]))[:, 1])), 3),
    'enMixed_recall@0.5': round(float(np.mean(clf.predict_proba(
        vec.transform([r['text'] for r in en]))[:, 1] >= 0.5)), 3),
}

# ---- X2: combined echo rule ----
echo_s = [r for r in rows if r['action'] == 'S'
          and r['id'] not in ('cal-0014', 'cal-0015')]
act_a = [r for r in rows if r['action'] == 'A']
grid = []
for theta in (0.3, 0.4, 0.5, 0.6, 0.7):
    flagged_e = sum(1 for r in echo_s
                    if containment(r) >= theta and not has_mark(r['text'], INTERROG + RECALL_CTX))
    flagged_a = sum(1 for r in act_a
                    if containment(r) >= theta and not has_mark(r['text'], INTERROG + RECALL_CTX))
    prec = flagged_e / (flagged_e + flagged_a) if (flagged_e + flagged_a) else None
    rec = flagged_e / len(echo_s)
    grid.append({'theta': theta, 'flaggedEcho': flagged_e,
                 'flaggedActivate': flagged_a,
                 'precision': round(prec, 3) if prec is not None else None,
                 'recall': round(rec, 3)})
best = max((g for g in grid if g['precision'] is not None),
           key=lambda g: (2 * g['precision'] * g['recall'] /
                          (g['precision'] + g['recall']) if g['precision'] and g['recall'] else 0))
res['X2_combinedEchoRule'] = {
    'rule': 'containment>=theta AND 无疑问/回忆标记 -> 判回声',
    'grid': grid, 'bestByF1': best,
    'singleSignalCompare': {
        'containmentOnly_echoMedian': 0.273, 'activateMedian': 0.462},
}

# ---- X3: lexicon intent baseline ----
ytrue = np.array([1 if r['action'] == 'A' else 0
                  for r in binr if not (r['action'] == 'A' and False)])
sub = binr
ypred = np.array([max(has_mark(r['text'], INTERROG), has_mark(r['text'], RECALL_CTX))
                  for r in sub])
tp = int(((ypred == 1) & (ytrue == 1)).sum())
fp = int(((ypred == 1) & (ytrue == 0)).sum())
fn = int(((ypred == 0) & (ytrue == 1)).sum())
res['X3_lexiconBaseline'] = {
    'n': len(sub), 'precision': round(tp / max(1, tp + fp), 3),
    'recall': round(tp / max(1, tp + fn), 3),
    'f1': round(2 * tp / max(1, 2 * tp + fp + fn), 3),
    'falsePositives': [r['id'] for r, p in zip(sub, ypred)
                       if p == 1 and r['action'] != 'A'],
    'note': '纯词表规则；对照 T2 学习型 AUC=0.901',
}

json.dump(res, open(os.path.join(HERE, 'extend-probe-results.json'), 'w',
                    encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
