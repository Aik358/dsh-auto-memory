#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Artifact consistency gate for activation_features_pre_v2 dispatch.
Checks 1-5 of the implementation brief. Exit 0 only when ALL pass."""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
POL = r'D:\dsh-auto-memory\python\policies'
fails = []


def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + (('  ' + str(detail)) if detail else ''))
    if not cond:
        fails.append(name)


# 1. parseable
try:
    ip = json.load(open(os.path.join(POL, 'recall_intent_lr_pre_v1.json'), encoding='utf-8'))
    ap = json.load(open(os.path.join(POL, 'activation_policy_pre_v2.json'), encoding='utf-8'))
    check('1.policy-json-parse', True)
except Exception as e:
    check('1.policy-json-parse', False, e)
    sys.exit(1)

# 2. required fields
need_ip = ['policyVersion', 'goldDigest', 'runId', 'createdAt', 'featureSchema',
           'vocabulary', 'idf', 'coefficients', 'intercept', 'calibration',
           'parentPolicyVersion']
need_ap = ['policyVersion', 'goldDigest', 'runId', 'configHash', 'mode',
           'thresholds', 'decisionOrder', 'echoVeto', 'completenessGate',
           'hardGates', 'reasonCodes', 'parentPolicyVersion']
check('2.intent-required-fields', all(k in ip for k in need_ip),
      [k for k in need_ip if k not in ip])
check('2.policy-required-fields', all(k in ap for k in need_ap),
      [k for k in need_ap if k not in ap])
check('2.intent-policyVersion', ip['policyVersion'] == 'recall_intent_lr_pre_v1')
check('2.policy-policyVersion', ap['policyVersion'] == 'activation_policy_pre_v2')
check('2.mode-shadow-candidate', ap['mode'] == 'shadow-candidate')
check('2.goldDigest-match', ip['goldDigest'] == ap['goldDigest'])
check('2.runId-match', ip['runId'] == ap['runId'] == 'label-review-cal20260824-1954')

# configHash recompute (must mirror exporter algorithm)
pol_copy = {k: v for k, v in ap.items() if k != 'configHash'}
payload = json.dumps(pol_copy, sort_keys=True, ensure_ascii=False)
expect_hash = 'cfgh_' + hashlib.sha256(payload.encode('utf-8')).hexdigest()[:32]
check('2.configHash-stable-recompute', expect_hash == ap['configHash'],
      '%s vs %s' % (expect_hash, ap.get('configHash')))

# 3. lengths
L = len(ip['vocabulary'])
check('3.vocab-idf-coef-lengths', len(ip['idf']) == L == len(ip['coefficients']),
      'vocab=%d idf=%d coef=%d' % (L, len(ip['idf']), len(ip['coefficients'])))

# 4. fixture provenance
fx_path = os.path.join(HERE, 'golden-parity-fixtures-v1.jsonl')
fx = [json.loads(l) for l in open(fx_path, encoding='utf-8') if l.strip()]
check('4.fixture-count>=20', len(fx) >= 20, len(fx))
prov_ok = all(all(k in f.get('provenance', {}) for k in
                  ('runId', 'goldDigest', 'configHash')) for f in fx)
prov_match = prov_ok and all(f['provenance']['goldDigest'] == ap['goldDigest']
                             and f['provenance']['configHash'] == ap['configHash']
                             and f['provenance']['runId'] == ap['runId'] for f in fx)
prov_detail = '' if prov_ok and prov_match else \
    ('missing fields' if not prov_ok else 'digest/configHash/runId mismatch')
check('4.fixture-provenance', prov_ok and prov_match, prov_detail)

# 5. determinism: rerun exporter twice, byte compare
def run_export():
    subprocess.run([sys.executable, os.path.join(HERE, 'export_v2_artifacts.py')],
                   cwd=HERE, capture_output=True)
    a = open(os.path.join(POL, 'recall_intent_lr_pre_v1.json'), 'rb').read()
    b = open(os.path.join(POL, 'activation_policy_pre_v2.json'), 'rb').read()
    c = open(fx_path, 'rb').read()
    return a, b, c


r1a, r1b, r1c = run_export()
r2a, r2b, r2c = run_export()
check('5.byte-stable-intent', r1a == r2a)
check('5.byte-stable-policy', r1b == r2b)
check('5.byte-stable-fixtures', r1c == r2c)
# reload after reruns
ip = json.loads(r1a); ap = json.loads(r1b)
fx = [json.loads(l) for l in r1c.decode('utf-8').splitlines() if l.strip()]
prov_match = all(f['provenance']['goldDigest'] == ap['goldDigest']
                 and f['provenance']['configHash'] == ap['configHash'] for f in fx)
check('5.provenance-after-rerun', prov_match)

# ---- stage-0 additions ----
ip_payload = {k: v for k, v in ip.items() if k != 'configHash'}
ih_payload = json.dumps(ip_payload, sort_keys=True, ensure_ascii=False)
ih_expect = 'cfgh_' + hashlib.sha256(ih_payload.encode('utf-8')).hexdigest()[:32]
check('s0.intent-configHash-recompute', ih_expect == ip.get('configHash'),
      '%s vs %s' % (ih_expect, ip.get('configHash')))
dr_path = os.path.join(POL, 'decision-record-activation-v2-delta-exp-override-20260824.json')
try:
    dr = json.load(open(dr_path, encoding='utf-8'))
    ok_dr = (dr.get('decisionId') == 'activation-v2-delta-exp-override-20260824'
             and dr.get('previousDeltaExp') == 0.02
             and dr.get('approvedDeltaExp') == 0.03
             and dr.get('rollback') == '0.02 historical only'
             and ap.get('decisionRecordId') == dr['decisionId'])
    check('s0.decision-record', ok_dr)
except Exception as e:
    check('s0.decision-record', False, e)
fx_dual = all(f['provenance'].get('policyConfigHash') == ap['configHash']
              and f['provenance'].get('intentConfigHash') == ip.get('configHash')
              for f in fx)
check('s0.fixture-dual-hashes', fx_dual)
th_ok = (ap['thresholds']['tauLane'] == 0.45 and ap['thresholds']['tauHi'] == 0.45
         and ap['thresholds']['tauLo'] == 0.35 and ap['thresholds']['deltaExp'] == 0.03
         and ap['thresholds']['deltaPro'] == 0.05)
check('s0.thresholds-brief-approved', th_ok, json.dumps(ap['thresholds']))

print('\n%d checks failed' % len(fails))
sys.exit(1 if fails else 0)
