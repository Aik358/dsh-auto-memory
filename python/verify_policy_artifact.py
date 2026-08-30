#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Standalone policy artifact verifier for activation_features_pre_v2.

Recomputes both configHashes with the canonical recipe (UTF-8, sorted keys,
compact separators, ensure_ascii=false, configHash field excluded), the
86-gold goldDigest over the three confirmed files, and validates structural
invariants. Exit 0 only when everything verifies. No runtime module import —
this is the independent auditor."""
import argparse
import hashlib
import json
import os
import sys

REPO = r'D:\dsh-auto-memory'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify(policy_dir, gold_dir):
    problems = []
    ip_path = os.path.join(policy_dir, 'recall_intent_lr_pre_v1.json')
    ap_path = os.path.join(policy_dir, 'activation_policy_pre_v2.json')
    dr_path = os.path.join(
        policy_dir, 'decision-record-activation-v2-delta-exp-override-20260824.json')
    ip = json.load(open(ip_path, encoding='utf-8'))
    ap = json.load(open(ap_path, encoding='utf-8'))

    def recompute(doc):
        probe = {k: v for k, v in doc.items() if k != 'configHash'}
        payload = json.dumps(probe, sort_keys=True, ensure_ascii=False)
        return 'cfgh_' + sha(payload.encode('utf-8'))[:32]

    for name, doc in (('intent', ip), ('activation', ap)):
        if doc.get('configHash') != recompute(doc):
            problems.append('%s configHash mismatch' % name)
    if not (ip.get('configHash') and ap.get('configHash')):
        problems.append('missing configHash')

    # goldDigest over three confirmed files (sorted concat, same as exporter)
    h = hashlib.sha256()
    for fn in ('gold-confirmed.jsonl', 'gold-confirmed-cf.jsonl',
               'gold-confirmed-b3.jsonl'):
        p = os.path.join(gold_dir, fn)
        if not os.path.isfile(p):
            problems.append('missing gold file %s' % fn)
            continue
        h.update(open(p, 'rb').read())
    digest = h.hexdigest()
    if ap.get('goldDigest') != digest or ip.get('goldDigest') != digest:
        problems.append('goldDigest mismatch: %s vs recomputed %s'
                        % (ap.get('goldDigest'), digest))

    L = len(ip['vocabulary'])
    if not (L == len(ip['idf']) == len(ip['coefficients'])):
        problems.append('vocab/idf/coef length mismatch')
    cal = ip.get('calibration') or {}
    if cal.get('method') != 'platt' or 'a' not in cal or 'b' not in cal:
        problems.append('platt calibration params missing')
    th = ap.get('thresholds') or {}
    expect_th = {'tauLane': 0.45, 'tauHi': 0.45, 'tauLo': 0.35,
                 'deltaExp': 0.03, 'deltaPro': 0.05}
    for k, v in expect_th.items():
        if th.get(k) != v:
            problems.append('thresholds.%s=%s expected %s'
                            % (k, th.get(k), v))
    if ap.get('mode') != 'shadow-candidate':
        problems.append('mode must be shadow-candidate for round-1 runtime')
    if ap.get('echoVeto', {}).get('scope') != 'proactive-lane-only':
        problems.append('echoVeto.scope must be proactive-lane-only')
    order = ap.get('decisionOrder') or []
    if order[:2] != ['js_hard_gates', 'lane_decision']:
        problems.append('decisionOrder must start js_hard_gates/lane_decision')
    need_rc = {'hard_gate_harmful', 'echo_veto_proactive',
               'completeness_unknown', 'proactive_margin'}
    missing_rc = need_rc - set(ap.get('reasonCodes') or [])
    if missing_rc:
        problems.append('reasonCodes missing %s' % sorted(missing_rc))
    dr = json.load(open(dr_path, encoding='utf-8'))
    if dr.get('approvedDeltaExp') != th.get('deltaExp'):
        problems.append('decision record / thresholds delta mismatch')

    # fixture provenance spot-check (first + last)
    fx_path = os.path.join(gold_dir.replace(
        'label-review-cal20260824-1954',
        'label-review-cal20260824-1954'), 'golden-parity-fixtures-v1.jsonl')
    fx_path = os.path.join(gold_dir,
                           'golden-parity-fixtures-v1.jsonl')
    if os.path.isfile(fx_path):
        lines = [json.loads(l) for l in open(fx_path, encoding='utf-8')
                 if l.strip()]
        for f in (lines[0], lines[-1]):
            pr = f.get('provenance', {})
            if pr.get('configHash') != ap['configHash'] \
                    or pr.get('intentConfigHash') != ip['configHash']:
                problems.append('fixture %s provenance hash mismatch'
                                % f.get('sampleId'))
    else:
        problems.append('parity fixtures not found at %s' % fx_path)

    print(json.dumps({
        'verified': not problems,
        'policyDir': policy_dir,
        'intentConfigHash': ip['configHash'],
        'activationConfigHash': ap['configHash'],
        'goldDigest': digest,
        'thresholds': th,
        'problems': problems}, ensure_ascii=False, indent=1))
    return 0 if not problems else 1


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--policy-dir', default=os.path.join(REPO, 'python',
                                                         'policies'))
    ap.add_argument('--gold-dir', default=os.path.join(
        REPO, 'artifacts', 'm7-live-pre', 'label-review-cal20260824-1954'))
    args = ap.parse_args()
    sys.exit(verify(args.policy_dir, args.gold_dir))
