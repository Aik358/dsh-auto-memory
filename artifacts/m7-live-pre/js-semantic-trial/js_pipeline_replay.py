#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""C2 pipeline replay: JS semantic retrieval candidates -> frozen fv2 policy.

Answers: can the C2 (pure-JS) tier alone retrieve relevant memories AND make
sound activation-eligibility decisions, independent of the Python embedder?
Decision core = m7_activation_features_pre_v2.decide_activation_v2 (frozen,
byte-identical to C3 acceptance). Metrics mirror held-out acceptance."""
import json, os, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'python'))
import numpy as np  # noqa: E402
import m7_activation_features_pre_v2 as fv2  # noqa: E402

hp = fv2.load_and_verify_policy(
    os.path.join(REPO, 'python', 'policies', 'recall_intent_lr_pre_v1.json'),
    os.path.join(REPO, 'python', 'policies', 'activation_policy_pre_v2.json'))
HEAD, POLICY = hp['head'], hp['policy']

texts = {}
eps = [json.loads(l) for l in open(os.path.join(REPO, 'artifacts',
        'm7-corpus-pre', 'episodes.jsonl'), encoding='utf-8') if l.strip()]
for e in eps:
    texts[e['episodeId']] = e.get('text') or ''
_dc = json.load(open(os.path.expanduser(
    '~') + '/.dsh/memory/semantic-pre/derived-corpus.json', encoding='utf-8'))
for entry in (_dc['entries'] if isinstance(_dc['entries'], list)
              else list(_dc['entries'].values())):
    for rec in entry['records']:
        texts[rec['memoryId']] = rec.get('text') or ''

cands_rows = [json.loads(l) for l in open(os.path.join(HERE,
              'js-retrieval-candidates.jsonl'), encoding='utf-8') if l.strip()]


def bigrams(t):
    q = ''.join(c for c in str(t).lower()
                if c.isalnum() or '\u4e00' <= c <= '\u9fff')
    return set(q[i:i + 2] for i in range(len(q) - 1)) or {q}


def fv2_features(g, ranked):
    keys = [k['key'] for k in ranked]
    exp = set(g.get('expectedMemoryIds') or [])
    dense_top = float(ranked[0]['score']) if ranked else 0.0
    margin = (float(ranked[0]['score']) - float(ranked[1]['score'])) \
        if len(ranked) > 1 else 1.0
    cand_text = texts.get(keys[0], '') if keys else ''
    containment = len(bigrams(g['queryText']) & bigrams(cand_text)) \
        / max(1, len(bigrams(g['queryText'])))
    tl = g['queryText'].lower()
    mark = int(any(x in tl for x in fv2.INTERROG + fv2.RECALL_CTX))
    return {
        'text': g['queryText'], 'denseTop': dense_top, 'margin': margin,
        'containment': containment, 'mark': mark, 'nCand': len(ranked),
        'candidateHit': bool(exp & set(keys)),
        'resolvedTargets': len(exp & set(keys)),
        'hardGates': {}, 'requiresRelayFlag': g.get('category') == 'cross-workspace',
        'piiClass': 'unknown',
    }, keys


def metrics(sub):
    emit_n = tp = sup_viol = act_n = r5 = 0
    for r in sub:
        hit5 = bool(set(r.get('expectedMemoryIds') or []) &
                    set(x['key'] for x in r['ranked'][:5]))
        if r['goldAction'] == 'activate' and hit5:
            r5 += 1
        dec = r['_decision']
        if dec == 'emit':
            emit_n += 1
            if r['goldAction'] == 'activate':
                tp += 1
            if r['goldAction'] == 'suppress':
                sup_viol += 1
    act_n = sum(1 for r in sub if r['goldAction'] == 'activate')
    return {'n': len(sub), 'R5_retrieval': round(r5 / act_n, 3) if act_n else None,
            'emit': emit_n,
            'precision': round(tp / emit_n, 3) if emit_n else None,
            'recall': round(tp / act_n, 3) if act_n else None,
            'emitOnSuppress': sup_viol}


MAIN = [r for r in cands_rows if r.get('goldAction')]
XWS = [r for r in MAIN if r['category'] == 'cross-workspace']
MAIN = [r for r in MAIN if r['category'] != 'cross-workspace']

for r in MAIN + XWS:
    feat, _keys = fv2_features(r, r['ranked'])
    dec = fv2.decide_activation_v2(feat, HEAD, POLICY)
    r['_decision'] = dec['decision']
    r['_reasonCodes'] = dec['reasonCodes']
    snap = dec.get('features') or {}
    r['_lane'] = snap.get('lane')
    r['_intentProb'] = float(snap.get('intentProb') or 0)

ms = metrics(MAIN)
xs = metrics(XWS)
print('== C2 full-pipeline (JS e5-small q8 retrieval + frozen fv2 policy) ==')
print('main set          :', json.dumps(ms))
print('cross-workspace   :', json.dumps(xs))
strata = {}
for name, fn in (('zh', lambda r: r['language'] == 'zh'),
                 ('en', lambda r: r['language'] == 'en'),
                 ('independent', lambda r: r['independence'] == 'independent-heldout')):
    sub = [r for r in MAIN if fn(r)]
    strata[name] = metrics(sub)
for k, v in strata.items():
    print('%-12s' % k, json.dumps(v))
json.dump({'mainSet': ms, 'crossWorkspace': xs, 'strata': strata},
          open(os.path.join(HERE, 'js-pipeline-replay-metrics.json'), 'w'),
          ensure_ascii=False, indent=1)
print('saved -> js-pipeline-replay-metrics.json')
