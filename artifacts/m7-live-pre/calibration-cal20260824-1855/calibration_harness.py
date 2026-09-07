#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M7-8 Phase F Shadow Semantic Calibration harness (read-only analysis).

Reproduces the PRODUCTION code path of python/worker_semantic_pre_v1.py
offline (no host, no sockets, no config changes):
  embed   -> m7_embedding_pre_v1.BgeM3Embedder (frozen D1 provider)
  chunk   -> emb.chunk_record_token_ids (m7_chunk_pre_v1 para-512-noov)
  dense   -> exact cosine, tie-break score desc -> id asc -> chunkOrdinal asc
  hybrid  -> weighted minmax fusion dense 0.7 + lexical(BM25 k1=1.2 b=0.75,
             HIT stopwords extracted from lib/shadow-retrieval-pre.js) 0.3
  features-> worker _activation_features parity (recency dormant: occurredAt
             is null per index_sync contract)
  score   -> worker _semantic_score parity (weights from DEFAULT_ACTIVATION_POLICY)
  decision-> first-observation state (arming='suppressed'), cooldown contract
             untouched; hysteresis sequences out of scope for single queries.

Surfaces:
  live     = the 11 real records of the running system's derived-corpus.json
             (C:/Users/JH Z/.dsh/memory/semantic-pre/, read-only)
  episodes = artifacts/m7-corpus-pre/episodes.jsonl (251 redacted episodes)

Writes labels.scored.jsonl / metrics.json / threshold-grid.csv /
error-analysis.jsonl / provenance-manifest.json next to this script.
"""
import csv
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'python'))

import m7_embedding_pre_v1 as emb  # production module, frozen policy

DSH_HOME = os.path.expanduser('~') + '/.dsh'
LIVE_DERIVED = os.path.join(DSH_HOME, 'memory', 'semantic-pre',
                            'derived-corpus.json')
EPISODES_PATH = os.path.join(REPO, 'artifacts', 'm7-corpus-pre',
                             'episodes.jsonl')
LABELS_PATH = os.path.join(HERE, 'labels.jsonl')
MODEL_DIR = ('D:/dsh-auto-memory/python/bench/.hf-cache/models--BAAI--bge-m3/'
             'snapshots/5617a9f61b028005a4858fdac845db406aefb181')
MODEL_REVISION = '5617a9f61b028005a4858fdac845db406aefb181'

W = {'top': 0.6, 'margin': 0.15, 'evidence': 0.1, 'recency': 0.15,
     'toolFail': 0.05}
WDENSE = 0.7
TOP_K = 8
T_ON_LIVE, T_OFF_LIVE = 0.62, 0.52          # current production defaults
T_ON_GRID = [0.50, 0.55, 0.60, 0.62, 0.65, 0.70]
T_OFF_GRID = [0.40, 0.45, 0.50, 0.52, 0.55]

# ---- stopword extraction (same method as python/bench/m7b_hybrid.py) ----

def load_stopwords():
    src_path = os.path.join(REPO, 'lib', 'shadow-retrieval-pre.js')
    with open(src_path, encoding='utf-8') as f:
        src = f.read()
    m = re.search(r"STOPWORDS_HIT_PRE_V2\s*=\s*Object\.freeze\(\[(.*?)\]\)",
                  src, re.S)
    assert m, 'stopword array not found'
    words = re.findall(r"'([^']+)'|\"([^\"]+)\"", m.group(1))
    return frozenset(a or b for a, b in words)

STOP = load_stopwords()


def tokenize(text):
    import unicodedata
    t = unicodedata.normalize('NFKC', str(text)).lower()
    out = []
    for run in re.findall(r'[\u4e00-\u9fff]+|[a-z0-9_./-]+', t):
        if run[:1] >= '\u4e00':
            grams = [run[i:i + 2] for i in range(len(run) - 1)] or [run]
            out.extend(g for g in grams if g not in STOP)
        elif run not in STOP and len(run) > 1:
            out.append(run)
    return out


class BM25:
    def __init__(self, docs_tokens):
        self.N = len(docs_tokens)
        self.doc_len = [len(d) for d in docs_tokens]
        self.avgdl = (sum(self.doc_len) / self.N) if self.N else 1.0
        self.tf, self.df = [], {}
        for d in docs_tokens:
            counts = {}
            for tok in d:
                counts[tok] = counts.get(tok, 0) + 1
            self.tf.append(counts)
            for tok in counts:
                self.df[tok] = self.df.get(tok, 0) + 1

    def score(self, query_tokens, idx):
        dl = self.doc_len[idx] or 1
        counts = self.tf[idx]
        k1, b = 1.2, 0.75
        s = 0.0
        for tok in set(query_tokens):
            if tok not in counts:
                continue
            tf = counts[tok]
            df = self.df[tok]
            import math
            idf = math.log(1.0 + (self.N - df + 0.5) / (df + 0.5))
            s += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / self.avgdl))
        return s


def minmax(vals):
    lo, hi = min(vals), max(vals)
    return [0.0] * len(vals) if hi <= lo else \
        [(v - lo) / (hi - lo) for v in vals]


class Surface:
    """One (workspace, scope) derived index, worker parity."""

    def __init__(self, name, records):
        self.name = name
        self.records = records                    # [{key,text,meta...}]
        self.by_key = {r['key']: r for r in records}
        self.chunks = []                          # chunk rows
        self.vectors = None
        self.bm25 = BM25([tokenize(r['text']) for r in records])

    def build(self, embedder):
        rows, items = [], []
        for rec in self.records:
            id_chunks = emb.chunk_record_token_ids(embedder.tokenizer,
                                                   rec['text'])
            texts = [embedder.tokenizer.decode(ids, skip_special_tokens=True)
                     for ids in id_chunks]
            for ordinal, ids in enumerate(id_chunks):
                rows.append({'key': rec['key'], 'ordinal': ordinal})
                items.append(embedder.build_doc_ids(ids))
        self.chunks = rows
        t0 = time.time()
        self.vectors = embedder.encode_ids(items)
        self.build_sec = round(time.time() - t0, 1)

    def search(self, embedder, query_text, eligible_keys=None, top_k=TOP_K):
        """Worker dense_search parity + candidate-set hybrid fusion."""
        t0 = time.time()
        qv = embedder.encode_query(query_text)
        scored = []
        for i, ch in enumerate(self.chunks):
            if eligible_keys is not None and ch['key'] not in eligible_keys:
                continue
            num = sum(x * y for x, y in zip(qv, self.vectors[i]))
            scored.append((num, ch['key'], ch['ordinal']))
        scored.sort(key=lambda t: (-t[0], t[1], t[2]))
        seen, cands = set(), []
        for s, key, ordinal in scored:
            if key in seen:
                continue
            seen.add(key)
            cands.append({'key': key, 'score': s, 'ordinal': ordinal})
            if len(cands) >= top_k:
                break
        # hybrid fusion (worker parity): BM25 over FULL corpus text,
        # min-max over the candidate set only
        if len(cands) >= 2:
            qtok = tokenize(query_text)
            lex_all = {r['key']: self.bm25.score(qtok, i)
                       for i, r in enumerate(self.records)}
            dn = minmax([c['score'] for c in cands])
            ln = minmax([lex_all.get(c['key'], 0.0) for c in cands])
            for c, d, l in zip(cands, dn, ln):
                c['denseScore'], c['lexicalScore'] = round(d, 6), round(l, 6)
                c['fusedScore'] = round(WDENSE * d + (1 - WDENSE) * l, 6)
            cands.sort(key=lambda c: (-c['fusedScore'], c['key'],
                                      c['ordinal']))
        else:
            for c in cands:
                c['denseScore'] = c['lexicalScore'] = c['fusedScore'] = c['score']
        ms = (time.time() - t0) * 1000.0
        return cands, ms


def semantic_score(top_dense, margin, evidence_rows=None):
    ev_seen = sum(int(e.get('seen') or 0) for e in (evidence_rows or []))
    ev_cite = sum(int(e.get('cite') or 0) for e in (evidence_rows or []))
    ev_corr = sum(int(e.get('correction') or 0) for e in (evidence_rows or []))
    ev_term = max(-1.0, min(1.0, ev_seen * 0.05 + ev_cite * 0.10 -
                            ev_corr * 0.20))
    s = (W['top'] * top_dense + W['margin'] * min(1.0, margin * 4)
         + W['evidence'] * ev_term + W['recency'] * 0.0      # dormant
         + W['toolFail'] * 0.0)
    return round(max(0.0, min(1.0, s)), 6)


def decision_first_obs(score, t_on, t_off):
    if score >= t_on:
        return 'emit'
    if score >= t_off:
        return 'prefetch'
    return 'suppress'


# ---- live corpus loading + fixture-key resolution ----

def load_live_records():
    with open(LIVE_DERIVED, encoding='utf-8') as f:
        dc = json.load(f)
    recs = []
    entries = dc['entries']
    if isinstance(entries, dict):
        entry_list = list(entries.values())
    else:
        entry_list = list(entries)
    for entry in entry_list:
        for r in entry['records']:
            recs.append(r)
    return recs


LIVE_PATTERNS = {
    'amber': lambda r: '琥珀协议' in (r.get('text') or ''),
    'whale': lambda r: '蓝鲸-7号' in (r.get('text') or ''),
    'm78fix-md': lambda r: (r.get('sourceRef') == 'workspace:MEMORY.md'
                            and 'M7-8 编排修复' in (r.get('text') or '')),
    'push-investigation': lambda r: '排查结论' in (r.get('text') or ''),
    'tokenize-correction': lambda r: '不用 jieba' in (r.get('text') or ''),
    'lunch': lambda r: '午饭吃的面条' in (r.get('text') or ''),
    'shadow-next': lambda r: '编排修复完成；下一步为 shadow 校准' in (r.get('text') or ''),
}


def resolve_live_key(key, live_recs):
    """Returns list of memoryIds (multi for the virtual log-overview key)."""
    if key == 'log-overview':
        return [r['memoryId'] for r in live_recs
                if str(r.get('sourceRef', '')).startswith('workspace-log:')]
    pred = LIVE_PATTERNS.get(key)
    hits = [r['memoryId'] for r in live_recs if pred and pred(r)]
    return hits


def main():
    t_start = time.time()
    with open(LABELS_PATH, encoding='utf-8') as f:
        labels = [json.loads(l) for l in f if l.strip()]

    cfg = {'provider': 'bge-m3-pre-v1', 'modelDir': MODEL_DIR,
           'modelRevision': MODEL_REVISION, 'dimension': 1024,
           'torchThreads': 16}
    print('[cal] loading BGE-M3 (production embedder)...', flush=True)
    t0 = time.time()
    embedder = emb.BgeM3Embedder(cfg)
    load_sec = round(time.time() - t0, 1)

    # ---- build surfaces ----
    live_recs = load_live_records()
    live_surface = Surface('live', [{'key': r['memoryId'], 'text': r.get('text') or '',
                                     'meta': r} for r in live_recs])
    with open(EPISODES_PATH, encoding='utf-8') as f:
        eps = [json.loads(l) for l in f if l.strip()]
    ep_surface_all = Surface('episodes', [{'key': e['episodeId'],
                                           'text': e.get('text') or '',
                                           'meta': e} for e in eps])
    live_surface.build(embedder)
    ep_surface_all.build(embedder)
    print('[cal] live chunks=%d episodes chunks=%d (build %.1fs/%.1fs)'
          % (len(live_surface.chunks), len(ep_surface_all.chunks),
             live_surface.build_sec, ep_surface_all.build_sec), flush=True)

    ws_core_keys = {e['episodeId'] for e in eps if e.get('workspace') == 'ws/dsh-core'}

    provenance = {
        'runId': os.path.basename(HERE),
        'provider': 'bge-m3-pre-v1', 'modelRevision': MODEL_REVISION,
        'dimension': 1024, 'chunkPolicy': emb.CHUNK_POLICY_VERSION,
        'modelLoadSec': load_sec,
        'liveSurface': {'records': len(live_surface.records),
                        'chunks': len(live_surface.chunks),
                        'source': LIVE_DERIVED},
        'episodesSurface': {'records': len(ep_surface_all.records),
                            'chunks': len(ep_surface_all.chunks),
                            'source': EPISODES_PATH,
                            'scopedKeys_ws_dsh-core': len(ws_core_keys)},
        'stopwords': len(STOP),
        'fusion': {'mode': 'hybrid', 'wDense': WDENSE},
        'scoreWeights': W,
    }

    # ---- score every sample ----
    lat = []
    scored_labels = []
    for s in labels:
        row = dict(s)
        surf = live_surface if s['surface'] == 'live' else ep_surface_all
        # resolve expected/forbidden keys
        exp_ids, unresolved = [], []
        for ref in s.get('expectedEpisodeIds', []):
            if ref.startswith('live:'):
                got = resolve_live_key(ref[5:], live_recs)
                exp_ids += got or [ref]
            else:
                exp_ids.append(ref)
        forb_ids = []
        for ref in s.get('forbiddenEpisodeIds', []) + s.get('forbiddenMemoryIds', []):
            if ref.startswith('live:'):
                forb_ids += resolve_live_key(ref[5:], live_recs)
            else:
                forb_ids.append(ref)
        row['_expResolved'] = exp_ids
        row['_forbResolved'] = forb_ids
        row['_unresolved'] = unresolved

        # evidence placeholder resolution
        ev_rows = []
        for e in s.get('evidence', []) or []:
            e = dict(e)
            mid = e.get('memoryId', '')
            if mid.startswith('@live:'):
                got = resolve_live_key(mid[6:], live_recs)
                if not got:
                    continue
                e['memoryId'] = got[0]
            ev_rows.append(e)
        row['_evidenceResolved'] = ev_rows
        corrected = {e['memoryId'] for e in ev_rows
                     if int(e.get('correction') or 0) > 0}

        # eligibility: workspace scope mirror (worker triple filter parity)
        scope_only = False
        if s['surface'] == 'episodes':
            scope = s.get('workspaceScope')
            if scope:
                eligible = {k for k in ws_core_keys}
                ext_targets = [k for k in exp_ids + forb_ids
                               if k not in eligible and k in ep_surface_all.by_key]
                if ext_targets:
                    scope_only = True   # targets live outside the synced scope
            else:
                eligible = None          # whole episodes surface (benchmark mode)
        else:
            eligible = None              # live corpus = one real workspace
        row['_scopeOnly'] = scope_only

        cands, ms = surf.search(embedder, s['queryText'], eligible_keys=eligible)
        lat.append(ms)
        # unscoped diagnostic for leakage stats (episodes surface only)
        unscoped_top = None
        if s['surface'] == 'episodes' and eligible is not None:
            u, _ = surf.search(embedder, s['queryText'], eligible_keys=None)
            unscoped_top = [c['key'] for c in u[:TOP_K]]
        # conflict hard-drop (worker _conflict_filter parity)
        dropped = [c['key'] for c in cands if c['key'] in corrected]
        cands_f = [c for c in cands if c['key'] not in corrected]
        top_dense = cands_f[0]['score'] if cands_f else 0.0
        second = cands_f[1]['score'] if len(cands_f) > 1 else 0.0
        margin = max(0.0, top_dense - second)
        score = semantic_score(top_dense, margin, ev_rows)
        row['_ranked'] = [{'key': c['key'], 'dense': round(c['score'], 6),
                           'fused': c.get('fusedScore')} for c in cands[:TOP_K]]
        row['_conflictDropped'] = dropped
        row['_unscopedTop'] = unscoped_top
        row['_denseTop'] = round(top_dense, 6)
        row['_margin'] = round(margin, 6)
        row['_score'] = score
        row['_latencyMs'] = round(ms, 1)
        row['_decisionCurrent'] = decision_first_obs(score, T_ON_LIVE, T_OFF_LIVE)
        row['_hitAt'] = next((i + 1 for i, c in enumerate(cands_f)
                              if c['key'] in set(exp_ids)), None)
        scored_labels.append(row)
        print('[cal] %s score=%.4f cur=%s hit@=%s%s' %
              (s['sampleId'], score, row['_decisionCurrent'], row['_hitAt'],
               ' SCOPE-ONLY' if scope_only else ''), flush=True)

    # ---- metrics ----
    def is_evaluable(row):
        if row['_scopeOnly']:
            return False
        return True

    ev = [r for r in scored_labels if is_evaluable(r)]
    act = [r for r in ev if r['expectedAction'] == 'activate']
    pre = [r for r in ev if r['expectedAction'] == 'prefetch']
    sup = [r for r in ev if r['expectedAction'] == 'suppress' and not r['harmful']]
    harm = [r for r in ev if r['expectedAction'] == 'suppress' and r['harmful']]
    xlang = [r for r in act if r.get('xlang')]
    code_anchor = [r for r in act if r.get('xlangType') == 'code-anchor']

    def target_hit(row, k=None):
        pool = row['_ranked'][:k] if k else row['_ranked']
        keys = {c['key'] for c in pool}
        need = set(row['_expResolved'])
        return bool(keys & need) if need else False

    def forbidden_hit(row):
        keys = {c['key'] for c in row['_ranked']}
        return sorted(keys & set(row['_forbResolved']))

    def cell_metrics(t_on, t_off):
        m = {'tOn': t_on, 'tOff': t_off, 'valid': t_on > t_off}
        dec = {r['sampleId']: decision_first_obs(r['_score'], t_on, t_off)
               for r in ev}
        emits = [r for r in ev if dec[r['sampleId']] == 'emit']
        prefs = [r for r in ev if dec[r['sampleId']] == 'prefetch']
        m['emits'] = len(emits)
        m['prefetches'] = len(prefs)
        good_emit = [r for r in emits if r['expectedAction'] == 'activate'
                     and target_hit(r) and not forbidden_hit(r)]
        good_pref = [r for r in prefs if r['expectedAction'] == 'prefetch'
                     and target_hit(r) and not forbidden_hit(r)]
        m['emitCorrect'] = len(good_emit)
        m['activationPrecision'] = round(len(good_emit) / len(emits), 4) if emits else None
        m['activationRecall'] = round(len(good_emit) / len(act), 4) if act else None
        m['prefetchPrecision'] = round(len(good_pref) / len(prefs), 4) if prefs else None
        m['prefetchRecall'] = round(len(good_pref) / len(pre), 4) if pre else None
        bad_emit = [r for r in emits if r['expectedAction'] != 'activate']
        m['falseActivationRate'] = round(len(bad_emit) / len(emits), 4) if emits else None
        m['harmfulActivations'] = sum(1 for r in harm if dec[r['sampleId']] == 'emit')
        m['suppressViolations'] = sum(1 for r in sup + harm
                                      if dec[r['sampleId']] != 'suppress')
        m['correctionLeak'] = sum(
            1 for r in ev if any(c['key'] in set(r['_conflictDropped'])
                                 for c in r['_ranked'][:TOP_K]))
        return m

    grid = [cell_metrics(a, b) for a in T_ON_GRID for b in T_OFF_GRID]
    current = next(c for c in grid if c['tOn'] == T_ON_LIVE and c['tOff'] == T_OFF_LIVE)

    hist = {}
    for r in ev:
        b = round(min(int(r['_score'] / 0.05) * 0.05, 0.95), 2)
        hist[b] = hist.get(b, 0) + 1

    def pct(vals, p):
        v = sorted(vals)
        return round(v[min(len(v) - 1, int(len(v) * p))], 1) if v else None

    scope_checks = [r for r in scored_labels if r['_scopeOnly']]
    leak_hits = []
    for r in scope_checks:
        forb_ext = [k for k in r['_forbResolved'] + r['_expResolved']
                    if k not in ws_core_keys and k in ep_surface_all.by_key]
        in_unscoped = sorted(set(r['_unscopedTop'] or []) & set(forb_ext))
        if in_unscoped:
            leak_hits.append({'sampleId': r['sampleId'], 'unscopedHits': in_unscoped})

    metrics = {
        'runId': os.path.basename(HERE),
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'samples': {'total': len(labels), 'evaluable': len(ev),
                    'scopeOnlyChecks': len(scope_checks),
                    'activate': len(act), 'prefetch': len(pre),
                    'suppressClean': len(sup), 'harmful': len(harm),
                    'crossLanguageActivate': len(xlang),
                    'codeAnchorActivate': len(code_anchor),
                    'isGoldCount': sum(1 for r in labels if r.get('isGold'))},
        'currentThresholds': {'tOn': T_ON_LIVE, 'tOff': T_OFF_LIVE,
                              **{k: v for k, v in current.items()
                                 if k not in ('tOn', 'tOff', 'valid')}},
        'scoreHistogram': dict(sorted(hist.items())),
        'scoreStats': {'min': min(r['_score'] for r in ev),
                       'p50': pct([r['_score'] for r in ev], 0.5),
                       'p95': pct([r['_score'] for r in ev], 0.95),
                       'max': max(r['_score'] for r in ev)},
        'recallAtK': {('@%d' % k): round(sum(1 for r in act + pre
                                             if target_hit(r, k))
                                        / len(act + pre), 4)
                      for k in (1, 5, 8)},
        'crossLanguageRecallAt5': round(sum(1 for r in xlang if target_hit(r, 5))
                                        / len(xlang), 4) if xlang else None,
        'codeAnchorRecallAt5': round(sum(1 for r in code_anchor if target_hit(r, 5))
                                     / len(code_anchor), 4) if code_anchor else None,
        'correctionSuppression': {
            'hardDropSamples': sum(1 for r in scored_labels if r['_conflictDropped']),
            'leakUnderGrid': current.get('correctionLeak')},
        'crossWorkspaceLeakage': {
            'scopedLeaks': 0,
            'unscopedWouldLeakSamples': len(leak_hits),
            'detail': leak_hits},
        'latencyMs': {'p50': pct(lat, 0.5), 'p95': pct(lat, 0.95),
                      'note': 'query encode + exact scan + fusion, offline CPU'},
        'fallbackErrors': sum(1 for r in scored_labels if not r['_ranked']
                              and r['expectedAction'] != 'suppress'),
        'grid': grid,
    }

    with open(os.path.join(HERE, 'labels.scored.jsonl'), 'w', encoding='utf-8') as f:
        for r in scored_labels:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    with open(os.path.join(HERE, 'metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=1)
    with open(os.path.join(HERE, 'threshold-grid.csv'), 'w', encoding='utf-8',
              newline='') as f:
        cols = ['tOn', 'tOff', 'emits', 'prefetches', 'emitCorrect',
                'activationPrecision', 'activationRecall', 'prefetchPrecision',
                'prefetchRecall', 'falseActivationRate', 'harmfulActivations',
                'suppressViolations', 'correctionLeak']
        wr = csv.DictWriter(f, fieldnames=cols)
        wr.writeheader()
        for g in sorted(grid, key=lambda x: (x['tOn'], x['tOff'])):
            wr.writerow({c: g[c] for c in cols})
    with open(os.path.join(HERE, 'provenance-manifest.json'), 'w',
              encoding='utf-8') as f:
        prov = dict(provenance)
        prov['labelPolicy'] = {
            'isGoldTrueCount': metrics['samples']['isGoldCount'],
            'rule': 'isGold=true requires human/user confirmation; every label '
                    'in this run is strong-agent authored -> verdict '
                    'insufficient_gold_for_active until reviewed'}
        prov['liveFixtureResolution'] = {
            k: resolve_live_key(k, live_recs) for k in
            list(LIVE_PATTERNS.keys()) + ['log-overview']}
        json.dump(prov, f, ensure_ascii=False, indent=1)

    print('[cal] DONE in %.1fs; evaluable=%d current-cell emits=%d'
          % (time.time() - t_start, len(ev), current['emits']), flush=True)


if __name__ == '__main__':
    main()
