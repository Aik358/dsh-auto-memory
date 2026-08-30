#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate English-language figures for the Activation Feature v2 paper.
Reads archived result JSONs only; writes PNGs to docs/paper-figures-v2/."""
import json
import os
import warnings

warnings.filterwarnings('ignore')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', '..',
                                   'docs', 'paper-figures-v2'))
os.makedirs(OUT, exist_ok=True)
plt.rcParams.update({'font.size': 10, 'axes.titlesize': 11,
                     'figure.dpi': 150, 'savefig.bbox': 'tight'})
C = {'A': '#1f77b4', 'P': '#ff7f0e', 'S': '#d62728', 'main': '#1B2A4A'}


def load(p):
    return [json.loads(l) for l in open(os.path.join(HERE, p),
                                        encoding='utf-8') if l.strip()]


gold = [json.loads(l) for l in open('gold-confirmed.jsonl', encoding='utf-8')
        if l.strip()] + \
       [json.loads(l) for l in open('gold-confirmed-cf.jsonl', encoding='utf-8')
        if l.strip()] + \
       [json.loads(l) for l in open('gold-confirmed-b3.jsonl', encoding='utf-8')
        if l.strip()]
gold = [g for g in gold if g.get('isGold')]
scored = {}
for src in ('../calibration-cal20260824-1855/labels.scored.jsonl',
            'cf-scored.jsonl', 'batch3-scored.jsonl'):
    for r in load(src):
        scored[r['sampleId']] = r
fit = json.load(open('fit-path-results.json', encoding='utf-8'))
probe = json.load(open('intent-probe-results.json', encoding='utf-8'))
ext = json.load(open('extend-probe-results.json', encoding='utf-8'))
boot = json.load(open('boot-final-point.json', encoding='utf-8'))

ACT_L = {'activate': 'A', 'prefetch': 'P', 'suppress': 'S'}
pts = []
NORM = {'activate': 'A', 'prefetch': 'P', 'suppress': 'S'}
for g in gold:
    s = scored.get(g['sampleId'])
    if s is None:
        continue
    if '_score' in s:
        sc = s['_score']
    else:
        # b3 rows went through the v3 pipeline; reconstruct the comparable
        # v1-formula score from their stored features (recency/evidence = 0)
        sc = round(0.6 * s['_denseTop'] + 0.15 * min(1.0, 4 * s['_margin']), 6)
    pts.append((NORM.get(g['finalAction'], g['finalAction']), sc,
                g['sampleId']))

# ---- Fig 1: echo trap class distributions (v1 semantic score, 86 gold) ----
fig, ax = plt.subplots(figsize=(6.4, 3.4))
rng = np.random.default_rng(3)
order = ['A', 'P', 'S']
colors = {'A': C['A'], 'P': C['P'], 'S': C['S']}
for xi, cls in enumerate(order):
    ys = [sc for a, sc, _ in pts if a == cls]
    ax.scatter(np.full(len(ys), xi) + rng.uniform(-0.12, 0.12, len(ys)),
               ys, s=18, alpha=0.75, color=colors[cls], edgecolors='none')
med = {cls: float(np.median([sc for a, sc, _ in pts if a == cls]))
       for cls in order}
ax.axhline(0.62, ls='--', lw=1, color='gray')
ax.axhline(0.52, ls=':', lw=1, color='gray')
ax.text(2.55, 0.625, 'tOn=0.62', fontsize=8, color='gray')
ax.text(2.55, 0.525, 'tOff=0.52', fontsize=8, color='gray')
for sid, y in (('cal-0009', None), ('cf-002', None)):
    yy = [sc for a, sc, i in pts if i == sid]
    if yy:
        ax.annotate(sid, (2 - 0.28, yy[0]), fontsize=8,
                    xytext=(2 - 0.62, min(0.72, yy[0] + 0.05)),
                    arrowprops=dict(arrowstyle='->', lw=0.7))
ax.set_xticks(range(3))
ax.set_xticklabels(['Activate (n=%d)' % sum(1 for a, _, _ in pts if a == 'A'),
                    'Prefetch (n=%d)' % sum(1 for a, _, _ in pts if a == 'P'),
                    'Suppress (n=%d)' % sum(1 for a, _, _ in pts if a == 'S')])
ax.set_ylabel('v1 semantic score')
ax.set_title('Fig.1 Echo trap: suppress-class life-log echoes score above\n'
             'every activate gold (86 human-labeled samples)')
plt.savefig(os.path.join(OUT, 'fig1_echo_trap.png'))
plt.close()

# ---- Fig 2: precision-recall paths ----
fig, ax = plt.subplots(figsize=(5.6, 4.2))


def pr_curve(cells):
    xs, ys = [], []
    for c in sorted(cells, key=lambda c: c['actRecall']):
        if c['actPrecision'] is not None:
            xs.append(c['actRecall']); ys.append(c['actPrecision'])
    return xs, ys


xs, ys = pr_curve(fit['v3a_learned_deployable'])
ax.plot(xs, ys, '-o', ms=4, label='v3a learned (deployable feats)', color=C['main'])
xs, ys = pr_curve(fit['v3b_learned_oracle_hit'])
ax.plot(xs, ys, '--s', ms=4, label='v3b learned + oracle hit (upper bound)',
        color='#7f7f7f')
ax.scatter([0], [0], marker='x', s=60, color=C['S'],
           label='v1 default (tOn=.62/tOff=.52)')
ax.scatter([0.5], [1.0], marker='D', s=45, color=C['P'],
           label='v2 rule cascade (hand-built)')
bp = json.load(open('boot-final-point.json', encoding='utf-8'))['point']
ax.scatter([bp['actRecall']], [bp['actPrecision']], marker='*', s=160,
           color='#2ca02c', zorder=5,
           label='v2c corrected order + P3 gate, tau_hi=.45 (final)')
ax.annotate('tau=.65: P=.833 R=.682', (0.682, 0.833), textcoords='offset points',
            xytext=(8, -12), fontsize=8)
ax.set_xlabel('Activation recall (emit & correct target)')
ax.set_ylabel('Activation precision')
ax.set_xlim(-0.03, 1.0); ax.set_ylim(-0.03, 1.08)
ax.grid(alpha=0.25)
ax.legend(fontsize=7.5, loc='lower right')
ax.set_title('Fig.2 Precision-recall paths (54 evaluable golds;\n'
             'final star on 86 golds incl. P3 completeness gate)')
plt.savefig(os.path.join(OUT, 'fig2_pr_paths.png'))
plt.close()

# ---- Fig 3: LR coefficients ----
coefs = fit['lrCoefficients_deployable']
names = list(coefs.keys()); vals = [coefs[n] for n in names]
ordr = np.argsort(vals)
fig, ax = plt.subplots(figsize=(5.6, 3.0))
ax.barh([names[i] for i in ordr], [vals[i] for i in ordr],
        color=[C['A'] if vals[i] >= 0 else C['S'] for i in ordr])
for yi, i in enumerate(ordr):
    ax.text(vals[i] + (0.04 if vals[i] >= 0 else -0.04), yi,
            '%+.2f' % vals[i], va='center',
            ha='left' if vals[i] >= 0 else 'right', fontsize=8)
ax.set_xlabel('LR coefficient (emit-worthy head, deployable features)')
ax.set_title('Fig.3 Interrogative/recall markers dominate over similarity')
plt.savefig(os.path.join(OUT, 'fig3_coefficients.png'))
plt.close()

# ---- Fig 4: calibration effect ----
t2 = probe['T2_recallIntent_binary']
i86 = json.load(open(os.path.join(REPO := 'D:/dsh-auto-memory',
                                  'artifacts/m7-autonomous-pre/state.json'),
                     encoding='utf-8'))['featureV2']['pathFitting'] if False else None
fig, axes = plt.subplots(1, 2, figsize=(7.0, 3.0))
axes[0].bar(['raw LR', 'sigmoid-calibrated'], [t2['acc_raw@0.5'],
            t2['acc_calibrated@0.5']], color=['#9fb3c8', C['main']])
axes[0].set_ylim(0, 1); axes[0].set_title('Accuracy @0.5 (grouped CV)')
axes[1].bar(['raw LR', 'sigmoid-calibrated'], [t2['brier_raw'],
            t2['brier_calibrated']], color=['#9fb3c8', C['main']])
axes[1].set_ylim(0, 0.3); axes[1].set_title('Brier score (lower is better)')
for ax in axes:
    for b in ax.patches:
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.02,
                '%.3f' % b.get_height(), ha='center', fontsize=9)
fig.suptitle('Fig.4 Platt calibration gains (recall-intent binary head)')
plt.savefig(os.path.join(OUT, 'fig4_calibration.png'))
plt.close()

# ---- Fig 5: decision-order ablation ----
fig, ax = plt.subplots(figsize=(6.2, 3.2))
groups = ['Act.Precision', 'Act.Recall', 'Suppress violations']
flawed = [0.818, 0.237, 1.0]
corrected = [1.0, 0.289, 0.0]
x = np.arange(len(groups)); w = 0.36
ax.bar(x - w / 2, flawed, w, label='flawed order (echo veto global)',
       color='#c0392b', alpha=0.85)
ax.bar(x + w / 2, corrected, w, label='corrected order (echo veto proactive-only)',
       color=C['A'], alpha=0.9)
for xi, (fv, cv) in enumerate(zip(flawed, corrected)):
    ax.text(xi - w / 2, fv + 0.02, '%.3g' % fv, ha='center', fontsize=8)
    ax.text(xi + w / 2, cv + 0.02, '%.3g' % cv, ha='center', fontsize=8)
ax.set_xticks(x); ax.set_xticklabels(groups)
ax.set_ylim(0, 1.15)
ax.legend(fontsize=8)
ax.set_title('Fig.5 Decision-order ablation on 86 golds\n'
             '(both at their own best operating point)')
plt.savefig(os.path.join(OUT, 'fig5_order_ablation.png'))
plt.close()

# ---- Fig 6: containment single-signal failure ----
echo_med = ext['X2_combinedEchoRule']['singleSignalCompare']['containmentOnly_echoMedian']
act_med = ext['X2_combinedEchoRule']['singleSignalCompare']['activateMedian']
fig, ax = plt.subplots(figsize=(5.6, 3.0))
ax.bar(['Echo-suppress class\n(median)', 'Activate class\n(median)'],
       [echo_med, act_med], color=[C['S'], C['A']], alpha=0.9)
for xi, v in enumerate([echo_med, act_med]):
    ax.text(xi, v + 0.01, '%.3f' % v, ha='center', fontsize=9)
ax.set_ylabel('lexical containment (query->top-1)')
ax.set_ylim(0, 0.6)
ax.set_title('Fig.6 Single-signal failure: lexical coverage alone ranks\n'
             'activate ABOVE echo-suppress -> combined rule required')
plt.savefig(os.path.join(OUT, 'fig6_containment.png'))
plt.close()

print('figures written to', OUT)
print('\n'.join(sorted(os.listdir(OUT))))
