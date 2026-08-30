#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Feasibility probe for main-Agent-suggested algorithms on 58 human golds.

T1  3-class action-from-text   : char n-gram TF-IDF + LogisticRegression,
                                 GroupKFold by pairId/sample group.
T2  binary recallIntent        : A(intent=1) vs S(echo/chitchat=0), P excluded
                                 (context-dependent by design); grouped CV,
                                 raw LR vs CalibratedClassifierCV(sigmoid):
                                 AUC / Brier.
T3  echo containment probe     : char-bigram containment(query -> top-1
                                 candidate text) for echo-S golds vs
                                 activate golds (P1 core signal).
Outputs intent-probe-results.json + printed summary.
"""
import json
import os
import warnings

warnings.filterwarnings('ignore')
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import (f1_score, confusion_matrix, roc_auc_score,
                             brier_score_loss)

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

rows = []
for g in g1 + g2:
    if not g.get('isGold'):
        continue
    s = scored_cal.get(g['sampleId']) or scored_cf.get(g['sampleId'])
    m = cfd.get(g['sampleId'])
    rows.append({
        'id': g['sampleId'], 'action': g['finalAction'],
        'text': g['queryText'],
        'group': (m or {}).get('pairId', g['sampleId']),
        'category': (m or {}).get('category'),
        'topKey': s['_ranked'][0]['key'] if s and s.get('_ranked') else None,
    })

# ---- corpus texts for containment probe ----
texts = {}
eps = load(r'D:\dsh-auto-memory\artifacts\m7-corpus-pre\episodes.jsonl')
for e in eps:
    texts[e['episodeId']] = e.get('text') or ''
_dc = json.load(open(r'C:\Users\JH Z\.dsh\memory\semantic-pre\derived-corpus.json',
                     encoding='utf-8'))
for entry in (_dc['entries'] if isinstance(_dc['entries'], list)
              else list(_dc['entries'].values())):
    for rec in entry['records']:
        texts[rec['memoryId']] = rec.get('text') or ''

def bigrams(t):
    t = ''.join(ch for ch in t.lower() if ch.isalnum() or '\u4e00' <= ch <= '\u9fff')
    return set(t[i:i + 2] for i in range(len(t) - 1)) or {t}

# ---------- T2/T1 datasets ----------
bin_rows = [r for r in rows if r['action'] in ('A', 'S')]          # 39
tri_rows = rows                                                     # 58

res = {}

def grouped_cv(X, y, groups, clf, proba=False):
    gkf = GroupKFold(n_splits=5)
    return cross_val_predict(clf, X, y, groups=groups, cv=gkf,
                             method='predict_proba' if proba else 'predict')

# ---- T1: 3-class ----
vec1 = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4), min_df=1,
                       sublinear_tf=True)
X1 = vec1.fit_transform([r['text'] for r in tri_rows])
y1 = [r['action'] for r in tri_rows]
gr1 = [r['group'] for r in tri_rows]
pred1 = grouped_cv(X1, y1, gr1, LogisticRegression(max_iter=2000,
                                                   class_weight='balanced'))
res['T1_3class'] = {
    'macroF1': round(f1_score(y1, pred1, average='macro'), 3),
    'confusionOrder': sorted(set(y1)),
    'confusion': confusion_matrix(y1, pred1, labels=sorted(set(y1))).tolist(),
}

# ---- T2: binary recallIntent, raw vs calibrated ----
vec2 = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4), min_df=1,
                       sublinear_tf=True)
X2 = vec2.fit_transform([r['text'] for r in bin_rows])
y2 = np.array([1 if r['action'] == 'A' else 0 for r in bin_rows])
gr2 = [r['group'] for r in bin_rows]
p_raw = grouped_cv(X2, y2, gr2, LogisticRegression(max_iter=2000,
                 class_weight='balanced'), proba=True)[:, 1]
p_cal = grouped_cv(X2, y2, gr2,
                   CalibratedClassifierCV(LogisticRegression(
                       max_iter=2000, class_weight='balanced'),
                       method='sigmoid', cv=3), proba=True)[:, 1]
pred_raw = (p_raw >= 0.5).astype(int)
pred_cal = (p_cal >= 0.5).astype(int)
res['T2_recallIntent_binary'] = {
    'n': int(len(y2)), 'positives': int(y2.sum()),
    'auc': round(roc_auc_score(y2, p_raw), 3),
    'acc_raw@0.5': round(float((pred_raw == y2).mean()), 3),
    'acc_calibrated@0.5': round(float((pred_cal == y2).mean()), 3),
    'brier_raw': round(brier_score_loss(y2, p_raw), 3),
    'brier_calibrated': round(brier_score_loss(y2, p_cal), 3),
    'note': 'P 类按设计排除：其必要性来自任务语境而非文本本身',
}

# ---- T3: echo containment probe ----
echo_s = [r for r in rows if r['action'] == 'S'
          and r['id'] not in ('cal-0014', 'cal-0015')]      # 非回声型 S 剔除
act_a = [r for r in rows if r['action'] == 'A']

def containment(r):
    q = bigrams(r['text'])
    cand = texts.get(r['topKey'], '')
    c = bigrams(cand)
    return round(len(q & c) / max(1, len(q)), 3)

ech = sorted((containment(r) for r in echo_s), reverse=True)
act = sorted((containment(r) for r in act_a), reverse=True)
res['T3_echoContainment'] = {
    'echoS_n': len(ech), 'echoS_median': ech[len(ech)//2], 'echoS_max': ech[0],
    'activate_n': len(act), 'activate_median': act[len(act)//2],
    'activate_max': act[0],
    'echo_ids': [r['id'] for r in echo_s],
    'note': 'containment = |bigram(query) ∩ bigram(top1候选)| / |bigram(query)|；'
            '与 denseTop 正交的词面复述信号',
}
out_path = os.path.join(HERE, 'intent-probe-results.json')
json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
