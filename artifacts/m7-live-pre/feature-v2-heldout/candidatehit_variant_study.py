#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Variant study: how should production candidateHit be defined?

Baseline (accepted): candidateHit = expectedMemoryIds ∩ dense top-K  — the
oracle used by held-out acceptance. Production today = JS lexicalRefs ∩ dense
topK, measured 12/12 False on controlled shadow.

Variants replayed here over the SAME 67 human-gold held-out set:
  A) hit := baseline OR max lexicalScore within top-K >= theta_l
     (lexical arm has a substantive term hit -> trust single-arm evidence)
  B) explicit-lane demotion: intent >= tauHi AND not hit(A) -> prefetch
     instead of suppress (high-intent no-evidence still warms)
Both variants reuse the frozen thresholds; nothing else changes.
Target interpreter: python/bench/.venv"""
import json, os, sys, warnings
warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'python'))
sys.path.insert(0, os.path.join(REPO, 'artifacts', 'm7-live-pre',
                                'calibration-cal20260824-1855'))
import numpy as np  # noqa: E402
import m7_embedding_pre_v1 as emb  # noqa: E402
import m7_activation_features_pre_v2 as fv2  # noqa: E402
from worker_semantic_pre_v1 import LexicalBM25, _tokenize  # noqa: E402
from calibration_harness import Surface, load_live_records, TOP_K, \
    MODEL_DIR, MODEL_REVISION  # noqa: E402

cfg = {'provider': 'bge-m3-pre-v1', 'modelDir': MODEL_DIR,
       'modelRevision': MODEL_REVISION, 'dimension': 1024, 'torchThreads': 16}
print('[v] loading frozen policies...', flush=True)
hp = fv2.load_and_verify_policy(
    os.path.join(REPO, 'python', 'policies', 'recall_intent_lr_pre_v1.json'),
    os.path.join(REPO, 'python', 'policies', 'activation_policy_pre_v2.json'))
HEAD, POLICY = hp['head'], hp['policy']
print('[v] loading BGE-M3...', flush=True)
embedder = emb.BgeM3Embedder(cfg)

ANCH = json.load(open(os.path.join(HERE, 'anchor-recovery.json'),
                      encoding='utf-8'))
live = load_live_records()
ids = {r['memoryId'] for r in live}
recovered = [{'memoryId': mid, 'text': a['text']}
             for mid, a in sorted(ANCH.items()) if mid not in ids]
recs = recovered + live
CACHE = os.path.join(HERE, '..', 'label-review-cal20260824-1954', 'vec-cache')


def build_cached(name, records):
    key = emb.sha_hex(('|'.join(r['key'] + ':' + str(len(r['text']))
                                for r in records)
                       + '|' + MODEL_REVISION).encode())[:16]
    path = os.path.join(CACHE, f'{name}-{key}.npz')
    surf = Surface(name, records)
    if os.path.isfile(path):
        z = np.load(path, allow_pickle=True)
        surf.chunks = list(z['chunks']); surf.vectors = list(z['vectors'])
        print(f'[{name}] cache hit', flush=True)
    else:
        surf.build(embedder)
        np.savez(path, chunks=np.array(surf.chunks, dtype=object),
                 vectors=np.array(surf.vectors, dtype=np.float32))
        print(f'[{name}] built {len(surf.chunks)} chunks', flush=True)
    return surf


live_surf = build_cached('live', [{'key': r['memoryId'],
                                   'text': r.get('text') or ''} for r in recs])
eps = [json.loads(l) for l in open(os.path.join(REPO, 'artifacts',
        'm7-corpus-pre', 'episodes.jsonl'), encoding='utf-8') if l.strip()]
ep_surf = build_cached('episodes', [{'key': e['episodeId'],
                                     'text': e.get('text') or ''} for e in eps])
texts = {e['episodeId']: e.get('text') or '' for e in eps}
_dc = json.load(open(os.path.expanduser(
    '~') + '/.dsh/memory/semantic-pre/derived-corpus.json', encoding='utf-8'))
for entry in (_dc['entries'] if isinstance(_dc['entries'], list)
              else list(_dc['entries'].values())):
    for rec in entry['records']:
        texts[rec['memoryId']] = rec.get('text') or ''

INTERRO = ['什么', '如何', '怎么', '哪些', '哪个', '为什么', '多少', '吗',
           '呢', '啥', 'recall', 'what', 'how', 'which', 'when', 'where',
           'why', 'who']
RECALL_CTX = ['之前', '上次', '当时', '早前', '以往', '历史', '记录里', '记忆里',
              '找出来', '调出来', '翻下', '说下', 'previous', 'earlier',
              'last time']


def bigrams(t):
    q = ''.join(c for c in str(t).lower()
                if c.isalnum() or '\u4e00' <= c <= '\u9fff')
    return set(q[i:i + 2] for i in range(len(q) - 1)) or {q}


gold = [json.loads(l) for l in open(os.path.join(HERE,
        'heldout-human-gold.jsonl'), encoding='utf-8') if l.strip()]
out = []
for g in gold:
    exp = set(g.get('expectedMemoryIds') or [])
    use_live = bool(exp) and list(exp)[0].startswith('mem_')
    surf = live_surf if use_live else ep_surf
    ranked, _ms = surf.search(embedder, g['queryText'])
    keys = [k['key'] for k in ranked]
    scores = [float(k['score']) for k in ranked]
    dense_top = scores[0] if scores else 0.0
    margin = (scores[0] - scores[1]) if len(scores) > 1 else 1.0
    cand_text = texts.get(keys[0], '') if keys else ''
    containment = len(bigrams(g['queryText']) & bigrams(cand_text)) \
        / max(1, len(bigrams(g['queryText'])))
    tl = g['queryText'].lower()
    mark = int(any(x in tl for x in fv2.INTERROG + fv2.RECALL_CTX))
    hits = exp & set(keys)
    # ---- lexical arm over same top-K (D6 BM25 raw, then minmax within K) ----
    corpus_texts = [(r['memoryId'], r.get('text') or '') for r in recs] if use_live \
        else [(e['episodeId'], e.get('text') or '') for e in eps]
    bm = LexicalBM25([_tokenize(t) for _, t in corpus_texts])
    idx_of = {mid: i for i, (mid, _) in enumerate(corpus_texts)}
    qt = _tokenize(g['queryText'])
    lraw = [bm.score(qt, idx_of[k]) if k in idx_of else 0.0 for k in keys]
    n_pos = sum(1 for x in lraw if x > 0.5)
    max_lex = max(lraw) if lraw else 0.0
    out.append({
        'sampleId': g['sampleId'], 'category': g.get('category'),
        'language': g.get('language'), 'independence': g.get('independence'),
        'pairId': g.get('pairId'), 'goldAction': g['finalAction'],
        'queryText': g['queryText'], '_denseTop': round(dense_top, 4),
        '_margin': round(margin, 4), '_containment': round(containment, 3),
        '_mark': mark, '_nCand': len(ranked), '_hit': bool(hits),
        '_maxLexRaw': round(max_lex, 3), '_nLexPos': n_pos,
    })

json.dump(out, open(os.path.join(HERE, 'variant-study-rows.json'), 'w',
                    encoding='utf-8'), ensure_ascii=False, indent=1)
main = [r for r in out if r['category'] != 'cross-workspace']
print('\n== maxLexNorm distribution ==')
act = sorted([r['_maxLexRaw'] for r in main if r['goldAction'] == 'activate'],
             reverse=True)
non = sorted([r['_maxLexRaw'] for r in main if r['goldAction'] != 'activate'],
             reverse=True)
print('activate golds maxLexRaw:', act[:14])
print('non-activate maxLexRaw  :', non[:14])
print('nLexPos>=1 counts: activate=%d/%d non=%d/%d' % (
    sum(1 for r in main if r['goldAction']=='activate' and r['_nLexPos']>=1),
    sum(1 for r in main if r['goldAction']=='activate'),
    sum(1 for r in main if r['goldAction']!='activate' and r['_nLexPos']>=1),
    sum(1 for r in main if r['goldAction']!='activate')))


json.dump(out, open(os.path.join(HERE, 'variant-study-rows.json'), 'w'),
                    ensure_ascii=False, indent=1)
print('probe complete:', len(out), 'rows')
