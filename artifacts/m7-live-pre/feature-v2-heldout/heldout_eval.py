#!/usr/bin/env python3
"""Structural precheck on PROPOSED held-out labels (strong-agent synthetic).

These are NOT human gold until reviewed via heldout-review-v2.xlsx.
Score-based evaluation (actPrecision, bootstrap CI) runs offline with the
frozen policy after human review; it does NOT require live shadow.
"""
import json, os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))

# Prefer the merged proposed set (queue + supplementary); fall back to legacy.
merged = os.path.join(HERE, 'heldout-proposed-all.jsonl')
if os.path.isfile(merged):
    gold = [json.loads(l) for l in open(merged, encoding='utf-8') if l.strip()]
else:
    gold = json.load(open(os.path.join(HERE, 'heldout-final-gold.json'),
                          encoding='utf-8'))

# Load the frozen policy thresholds (hardcoded from verified artifact — no retuning)
TAU_HI = 0.45; DELTA_EXP = 0.03

# For held-out samples we don't have retrieval scores (they weren't embedded).
# We evaluate using the DECISION LABELS from the user (which ARE the gold),
# and check structural consistency instead of score-based decisions.
# The actual score-based evaluation requires live shadow (embedder + worker).

# Structural validation gates:
def act_of(g):
    return g.get('finalAction') or g.get('proposedAction')


acts = Counter(act_of(g) for g in gold)
nA = acts.get('activate', 0)
nP = acts.get('prefetch', 0)
nS = acts.get('suppress', 0)

# Check en/zh activate positives (gate: both languages have activate gold)
lang_act = Counter((g.get('language') or g.get('lang'), act_of(g))
                   for g in gold)

# Check expected/forbidden disjoint
disjoint_ok = all(
    not (set(g.get('expected', [])) & set(g.get('forbidden', [])))
    for g in gold)

# Check isolation from training set
train_ids = set()
for fn in ('../label-review-cal20260824-1954/gold-confirmed.jsonl',
           '../label-review-cal20260824-1954/gold-confirmed-cf.jsonl',
           '../label-review-cal20260824-1954/gold-confirmed-b3.jsonl'):
    for l in open(os.path.join(HERE, fn), encoding='utf-8'):
        if l.strip():
            train_ids.add(json.loads(l)['sampleId'])
overlap = sum(1 for g in gold if g['sampleId'] in train_ids)

gates = {
    'activateGold >= 15': nA >= 15,
    'prefetchGold >= 15': nP >= 15,
    'suppressGold >= 15': nS >= 15,
    'enActivatePositive >= 1': lang_act.get(('en', 'activate'), 0) >= 1,
    'zhActivatePositive >= 1': lang_act.get(('zh', 'activate'), 0) >= 1,
    'expectedForbiddenDisjoint': disjoint_ok,
    'isolationFromTraining': overlap == 0,
}
all_pass = all(gates.values())

report = {
    'verdict': 'PASS' if all_pass else 'FAIL',
    'scope': 'structural precheck on PROPOSED (synthetic, pre-human-review) labels',
    'labelSource': 'strong-agent synthetic — NOT human gold until xlsx review',
    'gates': gates,
    'totalGold': len(gold),
    'byAction': dict(acts),
    'langActivate': {f'{l}:{a}': c for (l, a), c in lang_act.items()
                     if a == 'activate'},
    'trainingOverlap': overlap,
    'note': ('Structural validation only. Score-based evaluation '
             '(actPrecision, bootstrap CI) runs OFFLINE with the frozen policy '
             '(BGE-M3 + hybrid retrieval over anchored corpora) after human '
             'review; it does not require live shadow.'),
    'nextStep': ('Human review via heldout-review-v2.xlsx -> score-based '
                 'offline gate -> controlled live shadow (18-24 queries, '
                 'user restarts 3080) -> single-session active canary '
                 '(explicit lane only).'),
}
json.dump(report, open(os.path.join(HERE, 'heldout-validation-report.json'), 'w'),
          ensure_ascii=False, indent=1)
print(json.dumps(report, ensure_ascii=False, indent=1))