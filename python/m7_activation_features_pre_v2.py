#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M7 activation features pre v2 (policy: activation_policy_pre_v2).

Round-1 implementation of the two-lane activation eligibility decision.
Pure stdlib; deterministic; NO pickle/joblib/sklearn at runtime — the
calibrated intent head is reproduced from the auditable JSON artifact
python/policies/recall_intent_lr_pre_v1.json (vocabulary + IDF + logistic
regression coefficients/intercept + Platt calibration), exported by the
calibration pipeline (runId label-review-cal20260824-1954).

Decision order (main-Agent amendment 2026-08-25, supersedes any earlier
draft that placed echo veto globally):

  1. JS/M7 hard gates  : harmful / correction / ignored / stale /
                         wrong_scope / pii_high -> suppress
  2. lane decision     : intentProb >= tauLane -> explicit, else proactive
  3. explicit lane     : echoRisk is a FEATURE here, never a veto
                         emit      : intent>=tauHi AND candidateHit AND
                                     margin>=deltaExp AND completeness==complete
                         prefetch  : intent>=tauHi AND hit AND
                                     completeness in (partial, unknown)
                                      OR intent>=tauLo AND hit
  4. proactive lane    : high echoRisk (containmentArm|denseTopArm) with
                         statement form and intent<cap -> hard suppress;
                         margin>=deltaPro AND nCand>=2 AND low intent AND
                         denseTop<arm -> prefetch
  5. default suppress

repetition this round is logging-only: counts may upgrade suppress->prefetch,
never activate on counts alone; life/chitchat topics never escalate.

Fail-closed policy: load_and_verify_policy refuses to serve when the JSON is
missing fields, length-inconsistent, or configHash does not recompute. The
hash algorithm mirrors export_v2_artifacts.py exactly:
  payload = json.dumps(policy_minus_configHash, sort_keys=True,
                       ensure_ascii=False)
  configHash = 'cfgh_' + sha256(payload.encode('utf-8')).hexdigest()[:32]

Public API (pure functions / pure objects):
  normalize_text, infer_recall_intent, infer_dialogue_act, infer_task_need,
  compute_echo_risk, compute_completeness, compute_lane,
  decide_activation_v2, load_and_verify_policy, replay_features_v2
"""
import hashlib
import json
import math
import os
import re

FEATURES_POLICY_VERSION = 'activation_features_pre_v2'
INTENT_POLICY_VERSION = 'recall_intent_lr_pre_v1'
ACTIVATION_POLICY_VERSION = 'activation_policy_pre_v2'

INTERROG = ['什么', '如何', '怎么', '哪些', '哪个', '为什么', '多少', '吗',
            '呢', '啥', 'recall', 'what', 'how', 'which', 'when', 'where',
            'why', 'who']
RECALL_CTX = ['之前', '上次', '当时', '早前', '以往', '历史', '记录里', '记忆里',
              '找出来', '调出来', '翻下', '说下', 'previous', 'earlier',
              'last time']
COMPLETENESS_LEXICON_DEFAULT = ['对比', '分别', '两个', '一起', '都调', '各自']
ACK_TOKENS = ['好的', '嗯嗯', '谢谢', '晚安', '收到']
ERR_TOKENS = ['又失败', '又超限', '又不对', '第三次', '报错', '又出现', '又丢']
REQ_TOKENS = ['帮我', '找出来', '调出来', '说一下', '再讲讲', '发我']
PLAN_TOKENS = ['准备', '打算', '计划', '之后', '接下来', '继续']

_WORD_RE = re.compile(r'(?u)\b\w\w+\b')
_WS_RUN = re.compile(r'\s\s+')


# ---------------------------------------------------------------- text utils

def normalize_text(text):
    """Lowercase; keep [a-z0-9] and CJK; drop everything else.

    Must byte-match the calibration exporter's normalize_text so that
    vocabulary lookups are stable across offline/online."""
    return ''.join(ch for ch in str(text).lower()
                   if ch.isalnum() or '\u4e00' <= ch <= '\u9fff')


def _char_wb_ngram_counts(norm_text, min_n, max_n):
    """sklearn char_wb parity: collapse whitespace runs, tokenize with
    (?u)\\b\\w\\w+\\b, pad each word with spaces, take char n-grams."""
    t = _WS_RUN.sub(' ', norm_text)
    counts = {}
    for word in _WORD_RE.findall(t):
        padded = ' ' + word + ' '
        L = len(padded)
        for n in range(min_n, min(max_n, L) + 1):
            for i in range(L - n + 1):
                gram = padded[i:i + n]
                counts[gram] = counts.get(gram, 0) + 1
    return counts


def bigram_set(text):
    t = normalize_text(text)
    return set(t[i:i + 2] for i in range(len(t) - 1)) or {t}


def lexical_containment(query_text, candidate_text):
    q = bigram_set(query_text)
    c = bigram_set(candidate_text)
    if not q:
        return 0.0
    return len(q & c) / len(q)


# ------------------------------------------------------------ intent head

class RecallIntentHead:
    """Deterministic pure-Python reproduction of the calibrated LR head."""

    def __init__(self, artifact):
        fs = artifact['featureSchema']
        vf = fs['vectorizer']
        assert vf['analyzer'] == 'char_wb' and vf['minDf'] == 1 \
            and vf['sublinearTf'] is True and vf['ngramRange'] == [2, 4], \
            'unsupported featureSchema'
        self.min_n, self.max_n = vf['ngramRange']
        self.vocab = artifact['vocabulary']
        self.idf = artifact['idf']
        self.coef = artifact['coefficients']
        self.intercept = float(artifact['intercept'])
        cal = artifact['calibration']
        assert cal['method'] == 'platt'
        self.platt_a = float(cal['a'])
        self.platt_b = float(cal['b'])
        self._norm_cache = {}

    def infer(self, text):
        key = id(text)
        grams = self._char_counts(text)
        # sublinear tf * idf over the sparse support, then L2 normalise
        acc = {}
        for gram, cnt in grams.items():
            idx = self.vocab.get(gram)
            if idx is None:
                continue
            acc[idx] = (1.0 + math.log(cnt)) * self.idf[idx]
        norm = math.sqrt(sum(v * v for v in acc.values())) or 1.0
        z = self.intercept
        for idx, w in acc.items():
            z += self.coef[idx] * (w / norm)
        p_raw = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))
        zz = math.log(max(p_raw, 1e-6) / max(1e-6, 1.0 - p_raw))
        p = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0,
                                                  self.platt_a * zz + self.platt_b))))
        return round(p, 6)

    def _char_counts(self, text):
        ck = ('t', text)
        cached = self._norm_cache.get(ck)
        if cached is None:
            cached = _char_wb_ngram_counts(normalize_text(text),
                                           self.min_n, self.max_n)
            if len(self._norm_cache) < 512:
                self._norm_cache[ck] = cached
        return cached


def infer_recall_intent(text, head):
    return head.infer(text)


# ------------------------------------------------------- dialogue/task/echo

def infer_dialogue_act(text, intent_prob):
    tl = str(text).lower()
    if any(k in tl for k in ERR_TOKENS):
        return 'error_report'
    if any(k in tl for k in ACK_TOKENS) and len(tl) <= 12:
        return 'acknowledgement'
    has_interrogative = ('？' in tl or '?' in tl
                         or any(k in tl for k in INTERROG))
    recall_ctx = any(k in tl for k in RECALL_CTX)
    if recall_ctx and has_interrogative:
        return 'question'
    if has_interrogative:
        return 'question'
    if any(k in tl for k in REQ_TOKENS):
        return 'request'
    if any(k in tl for k in PLAN_TOKENS):
        return 'planning'
    if intent_prob < 0.40:
        return 'statement'
    return 'other'


def infer_task_need(dialogue_act):
    return {'error_report': 'required', 'question': 'optional',
            'request': 'optional', 'planning': 'none',
            'acknowledgement': 'none', 'statement': 'none',
            'correction': 'none', 'other': 'none'}[dialogue_act]


def compute_echo_risk(containment, dense_top, mark_zero, intent_prob,
                      policy):
    ev = policy['echoVeto']
    arms = {'containmentArm': containment >= ev['containmentArm'],
            'denseTopArm': dense_top >= ev['denseTopArm'],
            'markZero': bool(mark_zero),
            'intentBelowCap': intent_prob < ev['requiresIntentBelow']}
    hit = ((arms['containmentArm'] or arms['denseTopArm'])
           and arms['markZero'] and arms['intentBelowCap'])
    return {'arms': arms, 'hit': hit}


def compute_completeness(text, lexicon, required_hint=None,
                         resolved_count=None):
    """Phase-1 conservative proxy. requiredTargetCount is heuristic (no
    gold knowledge at runtime); resolvedTargetCount is an environment
    input (count of expected targets resolved by retrieval) and stays
    None in production shadow until a coverage signal exists."""
    tl = str(text).lower()
    kw = any(k in tl for k in lexicon)
    required = int(required_hint) if required_hint is not None else (2 if kw else 1)
    status = 'unknown' if kw else 'complete'
    return {'requiredTargetCount': required,
            'resolvedTargetCount': resolved_count,
            'status': status}


def compute_lane(intent_prob, policy):
    return 'explicit' if intent_prob >= policy['thresholds']['tauLane'] \
        else 'proactive'


# ------------------------------------------------------------- policy load

def load_and_verify_policy(intent_path, policy_path):
    """Load both artifacts and fail closed on any inconsistency."""
    with open(intent_path, encoding='utf-8') as f:
        ip = json.load(f)
    with open(policy_path, encoding='utf-8') as f:
        ap = json.load(f)
    need_ip = ('policyVersion', 'goldDigest', 'runId', 'configHash',
               'featureSchema', 'vocabulary', 'idf', 'coefficients',
               'intercept', 'calibration')
    need_ap = ('policyVersion', 'goldDigest', 'runId', 'configHash', 'mode',
               'thresholds', 'decisionOrder', 'echoVeto', 'completenessGate',
               'hardGates', 'reasonCodes')
    for k in need_ip:
        if k not in ip:
            raise ValueError('intent policy missing field: %s' % k)
    for k in need_ap:
        if k not in ap:
            raise ValueError('activation policy missing field: %s' % k)
    if ip['goldDigest'] != ap['goldDigest'] or ip['runId'] != ap['runId']:
        raise ValueError('intent/activation policy provenance mismatch')
    L = len(ip['vocabulary'])
    if not (L == len(ip['idf']) == len(ip['coefficients'])):
        raise ValueError('vocab/idf/coefficient length mismatch')
    for name, doc in (('intent', ip), ('activation', ap)):
        probe = {k: v for k, v in doc.items() if k != 'configHash'}
        payload = json.dumps(probe, sort_keys=True, ensure_ascii=False)
        expect = 'cfgh_' + hashlib.sha256(payload.encode('utf-8')).hexdigest()[:32]
        if expect != doc['configHash']:
            raise ValueError('%s configHash mismatch: %s vs %s'
                             % (name, expect, doc.get('configHash')))
    if ap['mode'] != 'shadow-candidate':
        raise ValueError('refusing non-shadow mode in round-1 runtime')
    head = RecallIntentHead(ip)
    return {'head': head, 'policy': ap}


# ------------------------------------------------------------ decision core

def decide_activation_v2(features, head, policy):
    """features keys:
      text            raw query text
      denseTop        top-1 fused/dense similarity of ranked candidates
      margin          denseTop - second dense (or 1.0 when single)
      containment     lexical containment query->top1 candidate text
      mark            0/1 interrogative-or-recall-marker present
      nCand           number of ranked candidates in view
      candidateHit    env input: expected/relevant target present in top-K
                      (shadow eval: gold match; production: memoryRefs
                       overlap or future coverage signal; default False)
      resolvedTargets env input: count of expected targets resolved
      requiredHint    optional completeness hint
      repetition      optional logging-only counters {mentions, failures}
      hardGates       dict of booleans: harmful/correction/ignored/stale/
                      wrongScope/piiHigh  (absent => False)
    Returns dict: lane, decision, reasonCodes, features snapshot."""
    th = policy['thresholds']
    reason = []
    hg = features.get('hardGates') or {}
    if any(bool(hg.get(k)) for k in
           ('harmful', 'correction', 'ignored', 'stale', 'wrongScope')):
        hit_gate = next((k for k in ('piiHigh', 'wrongScope', 'stale',
                                     'ignored', 'correction', 'harmful')
                         if hg.get(k)), 'harmful')
        return _pack(features, policy, None, 'suppress',
                     ['hard_gate_%s' % hit_gate])
    if hg.get('piiHigh'):
        return _pack(features, policy, None, 'suppress', ['hard_gate_pii'])
    intent = infer_recall_intent(features['text'], head)
    dact = infer_dialogue_act(features['text'], intent)
    tneed = infer_task_need(dact)
    echo = compute_echo_risk(features['containment'], features['denseTop'],
                             features['mark'] == 0, intent, policy)
    comp = compute_completeness(features['text'],
                                policy['completenessGate']['lexicon'],
                                required_hint=features.get('requiredHint'),
                                resolved_count=features.get('resolvedTargets'))
    lane = compute_lane(intent, policy)
    hit = bool(features.get('candidateHit'))
    margin = float(features.get('margin') or 0.0)

    def finish(decision, extra=()):
        snap = {'intentProb': intent, 'dialogueAct': dact, 'taskNeed': tneed,
                'echoRisk': echo, 'completeness': comp, 'lane': lane,
                'margin': margin}
        rep = features.get('repetition') or {}
        snap['repetitionLogged'] = rep
        return _pack(features, policy, snap, decision, list(reason) + list(extra))

    if lane == 'explicit':
        if intent >= th['tauHi'] and hit:
            if margin >= th['deltaExp'] and comp['status'] == 'complete':
                return finish('emit', ['explicit_lane',
                                       'completeness_complete'])
            if margin >= th['deltaExp']:
                return finish('prefetch',
                              ['explicit_lane',
                               'completeness_%s' % comp['status']])
            return finish('prefetch', ['explicit_lane', 'margin_below_delta'])
        if intent >= th['tauLo'] and hit:
            return finish('prefetch', ['explicit_lane_weak'])
        # fall through: explicit lane without hit behaves like proactive
        # relevance check minus echo suppression rights
        if (margin >= th['deltaPro'] and features.get('nCand', 0) >= 2
                and intent < 0.35
                and features['denseTop'] < policy['echoVeto']['denseTopArm']):
            return finish('prefetch', ['proactive_margin_fallback'])
        return finish('suppress', ['suppress_low_signal'])
    # proactive lane
    if echo['hit']:
        return finish('suppress', ['echo_veto_proactive'])
    if margin >= th['deltaPro'] and features.get('nCand', 0) >= 2 \
            and features['denseTop'] < policy['echoVeto']['denseTopArm']:
        return finish('prefetch', ['proactive_margin'])
    return finish('suppress', ['suppress_low_signal'])


def _pack(features, policy, snapshot, decision, reason_codes):
    out = {
        'featurePolicyVersion': FEATURES_POLICY_VERSION,
        'activationPolicyVersion': ACTIVATION_POLICY_VERSION,
        'decision': decision,
        'reasonCodes': list(reason_codes),
        'advisoryOnly': None,
        'requiresCrossWorkspaceRelay': bool(features.get('requiresRelayFlag')),
        'piiClass': features.get('piiClass'),
        'note': 'round-1 shadow only; cross-workspace/PII tiers are JS '
                'authority layers (fail closed without explicit policy)',
    }
    if snapshot is not None:
        out['features'] = snapshot
    return out


def replay_features_v2(rows, head, policy):
    """Batch helper for offline replay/parity: rows carry precomputed
    retrieval features; returns per-row decision dicts."""
    return [dict(decide_activation_v2(r, head, policy),
                 sampleId=r.get('id')) for r in rows]


# --------------------------------------------------------------- self-test

if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    pol_dir = os.path.join(here, 'policies')
    loaded = load_and_verify_policy(
        os.path.join(pol_dir, 'recall_intent_lr_pre_v1.json'),
        os.path.join(pol_dir, 'activation_policy_pre_v2.json'))
    demo_rows = [
        {'id': 'demo-recall', 'text': '之前为什么选 BGE-M3？',
         'denseTop': 0.72, 'margin': 0.10, 'containment': 0.55, 'mark': 1,
         'nCand': 5, 'candidateHit': True},
        {'id': 'demo-echo', 'text': '中午那碗面条挺不错的。',
         'denseTop': 0.83, 'margin': 0.30, 'containment': 0.22, 'mark': 0,
         'nCand': 4, 'candidateHit': False},
    ]
    for r in demo_rows:
        out = decide_activation_v2(r, loaded['head'], loaded['policy'])
        print(r['id'], out['decision'], out['reasonCodes'],
              'intent=%.4f' % out['features']['intentProb'])
    print('SELFTEST OK')
