#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate held-out review queue (≥45) + calibration doc for feature v2."""
import json, os, hashlib
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = 'D:/dsh-auto-memory'
OUT = os.path.join(ROOT, 'artifacts', 'm7-live-pre', 'feature-v2-heldout')
os.makedirs(OUT, exist_ok=True)

def hx32(s): return hashlib.sha256(s.encode()).hexdigest()[:32]

AMBER = 'mem_27a7b9a977e04d2498ed94f0282e5844'
WHALE = 'mem_b914e1b055d4437eaed77cace8546b91'
JIEBA = 'mem_31919729c447464585ee14ab25d2f033'
LUNCH = 'mem_4257151bfacc49ecbd54f4f9f60c092d'

samples = []
n = [0]

def add(pair_id, category, text, action, lang='zh', intent=True,
        expected=None, forbidden=None, harmful=False,
        parent_ep=None, parent_mem=None, rationale='',
        echo_risk='none', task_need='required', dact='question',
        workspace_scope=None):
    n[0] += 1
    sid = f'hd-{n[0]:03d}'
    h = int(hashlib.sha256(pair_id.encode()).hexdigest()[:8], 16) % 10
    split = 'train' if h < 7 else ('dev' if h < 9 else 'test')
    samples.append({
        'sampleId': sid, 'pairId': pair_id, 'category': category,
        'queryText': text, 'language': lang,
        'proposedAction': action,
        'expectedMemoryIds': expected or [],
        'forbiddenMemoryIds': forbidden or [],
        'harmful': harmful, 'recallIntent': intent,
        'echoRisk': echo_risk, 'taskNeed': task_need,
        'dialogueAct': dact,
        'parentEpisodeId': parent_ep if parent_ep and parent_ep.startswith('ep_') else None,
        'parentMemoryId': parent_mem if parent_mem and parent_mem.startswith('mem_') else None,
        'synthetic': True, 'generator': 'zcode-agent/ox-alpha',
        'labelSource': 'strong-agent', 'isGold': False,
        'split': split, 'rationale': rationale, 'confidence': 0.75,
    })

# === Echo vs Recall (10 pairs = 20 samples) ===
EP_BGE='ep_69025fcb515a3c27'; EP_VAL='ep_0fb0cc7f49cd63ba'; EP_TAIL='ep_61e630101d904981'
EP_STALE='ep_821e9a67dfaa1167'; EP_ENV='ep_9695c53761cd879c'; EP_COV='ep_d5a1fada0a5eb4e9'
echo_data = [
    (AMBER, None, '之前关于琥珀协议的决策内容是什么？', '琥珀协议这名字挺特别的。'),
    (WHALE, None, '蓝鲸-7号那个联调结论是什么？', '蓝鲸-7号听起来好厉害。'),
    (JIEBA, None, '现在分词方案最终定的是什么？', '分词用 jieba 挺方便的吧。'),
    (EP_BGE, None, '为什么选了 BGE-M3？', 'BGE-M3 效果挺好的。'),
    (EP_VAL, None, 'activation validator 都校验哪些字段？', 'validator 写得好严格。'),
    (EP_TAIL, None, 'Reference Tail 是哪个里程碑交付的？', '尾注渲染差不多了。'),
]
for i, (parent, pmem, qa, qs) in enumerate(echo_data):
    pid = f'hd-echo-{i+1:02d}'
    pe = parent if parent.startswith('ep_') else None
    pm = parent if parent.startswith('mem_') else None
    add(pid, 'echo-vs-recall', qa, 'activate', expected=[parent], parent_ep=pe, parent_mem=pm)
    add(pid, 'echo-vs-recall', qs, 'suppress', forbidden=[parent], intent=False, echo_risk='high', parent_ep=pe, parent_mem=pm)

# === Failure vs Planning (5 pairs = 10 samples) ===
fail_data = [
    (EP_STALE, '注入又被 stale-context 丢掉了！', '之后留意 contextVersion。'),
    (EP_ENV, 'envelope 超 4096 被裁了。', '计划调整 envelope 预算。'),
    (EP_COV, 'coverage 数值跟上次差很多。', '想复测 coverage 投影。'),
]
for k, (ep, qf, qp) in enumerate(fail_data):
    pid = f'hd-fail-{k+1:02d}'
    add(pid, 'failure-vs-planning', qf, 'activate', expected=[ep], dact='error_report', parent_ep=ep)
    add(pid, 'failure-vs-planning', qp, 'prefetch', expected=[ep], dact='planning',
        task_need='optional', parent_ep=ep)

# === Supersede (2 pairs = 4 samples) ===
sup_pairs = [
    (JIEBA, None, '分词现在是 jieba 吧？', '就用 jieba 预切，别改了。'),
]
for m, (parent, pmem, qoq, qos) in enumerate(sup_pairs):
    pid = f'hd-sup-{m+1:02d}'
    add(pid, 'supersede', qoq, 'activate', expected=[parent], parent_mem=pmem)
    add(pid, 'supersede', qos, 'suppress', harmful=True, forbidden=[parent], parent_mem=pmem)

# === Cross-workspace (3 pairs = 6 samples) ===
xws = [
    ('ep_e515177f4c632f2c', 'ws/external-workbuddy', 'WorkBuddy 跨设备用什么模式？'),
    ('ep_fed40ce72e0ecc0f', 'ws/external-codex', 'PsychoPy 移植的技术栈？'),
]
for x, (ep, ws, q) in enumerate(xws):
    pid = f'hd-xws-{x+1:02d}'
    add(pid, 'cross-workspace', q, 'suppress', forbidden=[ep],
        workspace_scope='ws/dsh-core', parent_ep=ep)
    add(pid, 'cross-workspace', q, 'activate', expected=[ep],
        workspace_scope=ws, parent_ep=ep)

# === Low info / chitchat (5 pairs = 10 samples) ===
low_texts = ['好的。', '嗯嗯。', '在吗？', '晚安。', '谢谢！']
for w, txt in enumerate(low_texts):
    pid = f'hd-low-{w+1:02d}'
    add(pid, 'low-info', txt, 'suppress', intent=False, echo_risk='none')

# === Cross-language recalls (4 samples) ===
xl = [
    ('What was decided about the amber protocol?', AMBER, None),
    ('When did Blue Whale-7 pass testing?', WHALE, None),
    ("What's the current tokenization decision?", JIEBA, None),
    ('Why was BGE-M3 selected over the others?', EP_BGE, None),
]
for x, (q, tgt, pmem) in enumerate(xl):
    add(f'hd-xl-{x+1:02d}', 'cross-lingual', q, 'activate', lang='en',
        expected=[tgt], parent_mem=pmem, parent_ep=tgt if tgt.startswith('ep_') else None)

# --- Additional echo pairs ---
more_echo = [
    (AMBER, None, '之前定的琥珀协议具体内容是什么？', '这个琥珀协议听起来不错。'),
    (WHALE, None, '帮我找一下蓝鲸-7号的记录。', '蓝鲸-7号真厉害。'),
    (EP_BGE, None, '选 BGE-M3 的理由是什么来着？', 'BGE-M3 是最好的选择。'),
    ('ep_0fb0cc7f49cd63ba', None, 'activation validator 的硬校验矩阵有哪些？', 'validator 校验好多东西。'),
]
for i, (parent, pmem, qa, qs) in enumerate(more_echo):
    pid = f'hd-echo-{len(echo_data)+i+1:02d}'
    pe = parent if parent.startswith('ep_') else None
    pm = parent if parent.startswith('mem_') else None
    add(pid, 'echo-vs-recall', qa, 'activate', expected=[parent], parent_ep=pe, parent_mem=pm)
    add(pid, 'echo-vs-recall', qs, 'suppress', forbidden=[parent], intent=False,
        echo_risk='medium', parent_ep=pe, parent_mem=pm)

# --- Additional failure/planning ---
more_fail = [
    ('ep_d55314eeacdc176f', 'coverage 又偏了。', '之后想重新测一下 coverage。'),
    ('ep_0fb0cc7f49cd63ba', 'activation 校验一直报错。', '准备过一遍校验逻辑。'),
    (EP_STALE, 'contextVersion 冲突又出现了。', '留意一下 contextVersion 变化。'),
]
for k, (ep, qf, qp) in enumerate(more_fail):
    pid = f'hd-fail-{len(fail_data)+k+1:02d}'
    add(pid, 'failure-vs-planning', qf, 'activate', expected=[ep],
        dact='error_report', parent_ep=ep)
    add(pid, 'failure-vs-planning', qp, 'prefetch', expected=[ep],
        dact='planning', task_need='optional', parent_ep=ep)

# --- Additional cross-workspace ---
add('hd-xws-03', 'cross-workspace', 'CC switch 的上下文上限配置是多少？',
    'suppress', forbidden=['ep_ee3abeb31860e867'],
    workspace_scope='ws/dsh-core', parent_ep='ep_ee3abeb31860e867')
add('hd-xws-04', 'cross-workspace', '抽卡演出的像素化要求是什么？',
    'suppress', forbidden=['ep_dc824cdd457c6222'],
    workspace_scope='ws/dsh-core', parent_ep='ep_dc824cdd457c6222')

# --- Additional cross-language ---
xl_more = [
    ('What was the amber protocol decision about?', AMBER, None),
    ('How does the activation validator work?', EP_VAL, None),
]
for x, (q, tgt, pmem) in enumerate(xl_more):
    add(f'hd-xl-{len(xl)+x+1:02d}', 'cross-lingual', q, 'activate', lang='en',
        expected=[tgt], parent_mem=pmem, parent_ep=tgt if tgt.startswith('ep_') else None)

# --- Additional low-info ---
for w, txt in enumerate(['嗯。', '好的好的。']):
    add(f'hd-low-{len(low_texts)+w+1:02d}', 'low-info', txt, 'suppress',
        intent=False)

total = len(samples)

total = len(samples)
print(f'Total held-out candidates: {total}')

with open(os.path.join(OUT, 'heldout-review-queue.jsonl'), 'w', encoding='utf-8') as f:
    for s in samples:
        f.write(json.dumps(s, ensure_ascii=False) + '\n')

acts = Counter(s['proposedAction'] for s in samples)
cats = Counter(s['category'] for s in samples)
langs = Counter(s['language'] for s in samples)
splits = Counter(s['split'] for s in samples)
dist = {'total': total, 'actions': dict(acts), 'categories': dict(cats),
        'languages': dict(langs), 'splits': dict(splits)}
json.dump(dist, open(os.path.join(OUT, 'heldout-distribution.json'), 'w'),
          ensure_ascii=False, indent=1)
print(json.dumps(dist, ensure_ascii=False, indent=1))
