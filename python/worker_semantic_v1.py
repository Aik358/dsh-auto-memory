#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M7-3 semantic sidecar worker (docs/M7-ALGORITHM-DECISION.md D4).

Extends the tested M7-0/M7-1 fake worker (python/worker_v1.py) WITHOUT
touching its protocol semantics: same JSONL framing, same validators, same
index_sync rejection matrix, same atomic derived-corpus persistence. Adds:

  - after a successful index_sync commit: chunk (m7_chunk_v1) + embed
    (frozen provider) every record and persist versioned vectors with an
    identity block under <dsh-home>/memory/semantic/ (atomic replace)
  - on startup: reuse persisted vectors only when the identity block
    matches the running embedding config; any mismatch = stale = refuse to
    serve until the next commit rebuilds (fail closed, never mix)
  - on context_push: dense top-8 shadow candidates appended to a bounded
    semantic/candidates-shadow.jsonl. NO new wire frames in M7-3: the
    frozen client correlates only acks/activations, so unsolicited
    candidate_result frames would regress it; the frame type stays reserved.

Embedding backend is selected by an optional JSON config file passed via
the DSH_M7_EMBEDDING_CONFIG environment variable (no CLI change, no JS
change): {"provider":"bge-m3-pre-v1"|"hash-pre-v1", "modelDir":...,
"modelRevision":..., "dimension":1024, "torchThreads":16}.
Without the env var the worker degrades to fake-worker behavior (protocol
alive, embedding not ready) - never crashes, never changes ack semantics.
"""

import argparse
import hashlib
import json
import os
import sys
import time
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import worker_v1 as base  # noqa: E402  (tested M7-0/M7-1 protocol layer)
import m7_embedding_v1 as emb  # noqa: E402
try:  # M7 activation feature v2 (round-1 shadow wiring)
    import m7_activation_features_v2 as featv2  # noqa: E402
except Exception as _featv2_import_exc:  # pragma: no cover
    featv2 = None
    _FEATV2_IMPORT_ERROR = str(_featv2_import_exc)[:160]
else:
    _FEATV2_IMPORT_ERROR = ''

EMBEDDING_CONFIG_ENV = 'DSH_M7_EMBEDDING_CONFIG'
SHADOW_LOG_MAX = 256
SHADOW_TOP_K = 8


def canonical_workspace_key(key):
    """Byte-twin of lib/evidence-store.js canonicalWorkspaceKey:
    path.resolve + backslash->slash + lowercase."""
    return os.path.abspath(str(key == None and '' or key)).replace('\\', '/').lower()


def wsref_of(workspace_key):
    """Byte-twin of evidence-store.js workspaceRefOf. JS owns identity;
    this is a deterministic reproduction of its published pure function so
    the worker can apply the workspace/scope/miv triple filter required by
    the M7-7.5 hardening audit (P1: isolation must be explicit, never an
    artifact of differing miv values)."""
    canon = canonical_workspace_key(workspace_key)
    return 'wsr_' + hashlib.sha256(
        ('evidence-wsref-pre-v1\u0000' + canon).encode('utf-8')).hexdigest()[:32]


def _tokenize(text, stopwords=frozenset()):
    """lexical_v2 parity tokenizer: NFKC + CJK 2-gram + ascii tokens."""
    t = unicodedata.normalize('NFKC', str(text)).lower()
    out = []
    for run in __import__('re').findall(r'[\u4e00-\u9fff]+|[a-z0-9_./-]+', t):
        if run[:1] >= '\u4e00':
            grams = [run[i:i + 2] for i in range(len(run) - 1)] or [run]
            out.extend(g for g in grams if g not in stopwords)
        elif run not in stopwords and len(run) > 1:
            out.append(run)
    return out


class LexicalBM25:
    """BM25 k1=1.2 b=0.75, JS-parity formula (D6 lexical arm)."""

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
            idf = __import__('math').log(1.0 + (self.N - df + 0.5) / (df + 0.5))
            s += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / self.avgdl))
        return s

# ---- M7-6 activation policy (default: shadow calibration only) ----
ACTIVATION_POLICY_VERSION = 'm7_semantic_threshold_v1'
DEFAULT_ACTIVATION_POLICY = {
    'mode': 'shadow',            # 'shadow' = calibrate/log only; 'active' = emit frames
    'tOn': 0.62, 'tOff': 0.52,   # dual threshold, T_on > T_off (hysteresis)
    'cooldownObs': 3,            # observations to skip after an emission
    'maxCandidates': 8,
    'ttlSteps': 3,
    # semantic score blend (all features recorded separately in the log);
    # correction is NEGATIVE (audit H4): a corrected memory must not gain
    # activation score, and corrected candidates are hard-dropped pre-rank.
    'w': {'top': 0.6, 'margin': 0.15, 'evidence': 0.1, 'recency': 0.15,
          'toolFail': 0.05},
    'levelBands': [[0.75, 'excerpt'], [0.0, 'hint']],
}
# ---- M7-7.5 search policy (D6 weighted hybrid, frozen) ----
DEFAULT_SEARCH_POLICY = {
    'mode': 'hybrid',            # 'hybrid' = D6 fusion; 'dense' = dense only
    'wDense': 0.7,               # D6: dense 0.7 + lexical 0.3
}


class SessionSemanticState:
    """Per (sessionId, workspaceKey, scope); never a scope-less global."""

    def __init__(self):
        self.obs = 0
        self.arming = 'suppressed'   # suppressed | prefetched | armed
        self.lastScore = 0.0
        self.lastEmitObs = -10 ** 9
        self.lastFeatures = None


def _vec_file(ws_ref, scope):
    key = hashlib.sha256((ws_ref + '|' + scope).encode('utf-8')).hexdigest()[:16]
    return 'vectors-' + key + '.json'


class SemanticWorker(base.Worker):
    def __init__(self, expect_epoch, dsh_home, embedding_config):
        super().__init__(expect_epoch, dsh_home)
        self.embedding_config = embedding_config or {}
        self.embedder = None
        self.vectors = {}        # (wsRef, scope) -> {'identity':..., 'chunks':[...], 'vectors':[...]}
        self.embedding_error = ''
        self.session_states = {}  # (sid, wsKey, scope) -> SessionSemanticState
        act = self.embedding_config.get('activationPolicy') or {}
        self.activation_policy = dict(DEFAULT_ACTIVATION_POLICY)
        self.activation_policy.update(act if isinstance(act, dict) else {})
        srch = self.embedding_config.get('search') or {}
        self.search_policy = dict(DEFAULT_SEARCH_POLICY)
        self.search_policy.update(srch if isinstance(srch, dict) else {})
        # ---- fv2 → wire 发射门(2026-08-26 闭环接线) ----
        # 'shadow'(默认)=只记 shadow 行零发射;'canary-explicit'=仅 explicit 车道
        # 的 emit 决策发 activation_request 帧;'active' 预留。非法值回退 shadow
        # (fail closed)。此开关属 JS/用户运营面,不进策略工件——阈值权威仍在
        # activation_policy_v2.json(append-only),发射节流依赖 M6 收件箱的
        # 硬校验+cooldown+TTL+latest-wins,worker 侧不重复限速。
        _em = str(self.embedding_config.get('activationEmitMode') or 'shadow')
        self.activation_emit_mode = _em if _em in (
            'shadow', 'canary-explicit', 'active') else 'shadow'
        self._stopwords = frozenset(
            self.embedding_config.get('lexicalStopwords') or [])
        self._lex_cache = None      # (wsRef, scope, miv) -> LexicalBM25
        # ---- M7 activation feature v2 (round-1 shadow wiring) ----
        self._fv2 = None
        self._fv2_invalid = ''
        if _FEATV2_IMPORT_ERROR:
            self._fv2_invalid = 'import-error: ' + _FEATV2_IMPORT_ERROR
        else:
            pol_dir = os.environ.get('DSH_M7_ACTIVATION_POLICY_DIR') or                 os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'policies')
            try:
                self._fv2 = featv2.load_and_verify_policy(
                    os.path.join(pol_dir, 'recall_intent_lr_v1.json'),
                    os.path.join(pol_dir,
                                 'activation_policy_v2.json'))
            except Exception as exc:  # fail closed, retrieval unaffected
                self._fv2_invalid = str(exc)[:200]
                base.diag('featuresV2-policy-invalid: ' + self._fv2_invalid)
        self._fv2_rep = {}          # (sid,topicKey) -> decayed counters
        self._fv2_rows = 0
        if self.embedding_config.get('provider'):
            self._init_embedding()

    # ---------- embedding lifecycle ----------

    def _init_embedding(self):
        try:
            self.embedder = emb.load_embedder(self.embedding_config)
            self._load_vectors_from_disk()
        except Exception as exc:  # noqa: BLE001 - protocol must survive
            self.embedding_error = str(exc)[:200]
            self.embedder = None
            base.diag('embedding-init-failed: ' + self.embedding_error)

    def _semantic_dir(self):
        return os.path.join(self.dsh_home, 'memory', 'semantic')

    def _load_vectors_from_disk(self):
        if not self.dsh_home:
            return
        d = self._semantic_dir()
        if not os.path.isdir(d):
            return
        identity = emb.identity_block(self.embedder.provider,
                                      self.embedding_config)
        for fn in os.listdir(d):
            if not (fn.startswith('vectors-') and fn.endswith('.json')):
                continue
            try:
                with open(os.path.join(d, fn), encoding='utf-8') as f:
                    payload = json.load(f)
            except (OSError, ValueError):
                continue
            if not isinstance(payload, dict):
                continue
            key = (payload.get('workspaceRef'), payload.get('scope'))
            if not isinstance(key[0], str) or key[1] not in ('Workspace', 'User'):
                continue
            block = payload.get('identity') or {}
            # stale check: identity mismatch -> ignore persisted vectors,
            # they will be rebuilt by the next index_sync commit
            usable = all(block.get(k) == identity.get(k) for k in identity)
            self.vectors[key] = {
                'identity': block,
                'memoryIndexVersion': payload.get('memoryIndexVersion'),
                'chunks': payload.get('chunks') or [],
                'vectors': payload.get('vectors') or [],
                'stale': (not usable) or
                         payload.get('memoryIndexVersion') != self.derived.get(key, {}).get('memoryIndexVersion'),
            }
            if self.vectors[key]['stale']:
                base.diag('vectors stale for %s (identity=%s version=%s)'
                          % (key, not usable,
                             payload.get('memoryIndexVersion')))

    def embedding_view(self):
        if not self.embedding_config.get('provider'):
            return {'enabled': False, 'ready': False,
                    'reason': 'no-embedding-config'}
        if self.embedder is None:
            return {'enabled': True, 'ready': False,
                    'error': self.embedding_error or 'init-failed'}
        ready = sum(1 for v in self.vectors.values() if not v['stale'])
        return {
            'enabled': True, 'ready': ready > 0, 'entries': len(self.vectors),
            'staleEntries': sum(1 for v in self.vectors.values() if v['stale']),
            'chunks': sum(len(v['chunks']) for v in self.vectors.values()
                          if not v['stale']),
            'provider': self.embedder.provider,
            'policyVersion': emb.CHUNK_POLICY_VERSION,
            'configHash': emb.identity_block(self.embedder.provider,
                                             self.embedding_config)['configHash'],
        }

    # ---------- vector build after commit ----------

    def _chunk_texts_for(self, text):
        """provider-aware chunking: real tokenizer ids vs deterministic
        char-paragraph packing for the offline hash provider."""
        if hasattr(self.embedder, 'chunk_and_encode'):
            id_chunks, _vecs = self.embedder.chunk_and_encode(text)
            texts = [self.embedder.tokenizer.decode(ids, skip_special_tokens=True)
                     for ids in id_chunks]
            return texts
        # hash provider: pack whole paragraphs up to 2048 chars per chunk;
        # an oversized paragraph is hard-split into 2048-char windows
        paras = [p for p in text.split('\n') if p.strip()]
        chunks, cur = [], ''
        for p in paras:
            if len(p) > 2048:
                if cur:
                    chunks.append(cur)
                    cur = ''
                chunks.extend(p[i:i + 2048] for i in range(0, len(p), 2048))
                continue
            if cur and len(cur) + len(p) + 1 <= 2048:
                cur = cur + '\n' + p
            else:
                if cur:
                    chunks.append(cur)
                cur = p
        if cur:
            chunks.append(cur)
        return chunks or ['']

    def build_vectors(self, ws_ref, scope):
        entry = self.derived[(ws_ref, scope)]
        real = hasattr(self.embedder, 'encode_ids')  # tokenizer-id path
        chunk_rows, encode_items = [], []
        for rec in entry['records']:
            if real:
                # audit fix P0: real provider embeds TOKEN IDS from the model
                # tokenizer directly (chunk_record_token_ids -> build_doc_ids
                # -> encode_ids); never decode->re-encode drift, and
                # encode_texts exists on both providers but the id path is
                # the canonical one for corpus building.
                id_chunks = emb.chunk_record_token_ids(self.embedder.tokenizer,
                                                       rec.get('text') or '')
                texts = [self.embedder.tokenizer.decode(ids, skip_special_tokens=True)
                         for ids in id_chunks]
                for ordinal, (ids, ctext) in enumerate(zip(id_chunks, texts)):
                    chunk_rows.append({
                        'chunkId': emb.chunk_id_for(rec['memoryId'],
                                                    rec['recordDigest'], ordinal),
                        'memoryId': rec['memoryId'],
                        'anchorId': rec['anchorId'],
                        'scope': rec['scope'],
                        'workspaceRef': rec['workspaceRef'],
                        'sourceRef': rec['sourceRef'],
                        'sourceEpoch': rec['sourceEpoch'],
                        'sourceVersion': rec['sourceVersion'],
                        'fileDigest': rec['fileDigest'],
                        'recordDigest': rec['recordDigest'],
                        'chunkOrdinal': ordinal,
                        'chunkCount': len(texts),
                        'occurredAt': rec.get('occurredAt'),
                        'excerpt': (ctext[:160] + '…') if len(ctext) > 160 else ctext,
                    })
                    encode_items.append(self.embedder.build_doc_ids(ids))
            else:
                texts = self._chunk_texts_for(rec.get('text') or '')
                for ordinal, ctext in enumerate(texts):
                    chunk_rows.append({
                        'chunkId': emb.chunk_id_for(rec['memoryId'],
                                                    rec['recordDigest'], ordinal),
                        'memoryId': rec['memoryId'],
                        'anchorId': rec['anchorId'],
                        'scope': rec['scope'],
                        'workspaceRef': rec['workspaceRef'],
                        'sourceRef': rec['sourceRef'],
                        'sourceEpoch': rec['sourceEpoch'],
                        'sourceVersion': rec['sourceVersion'],
                        'fileDigest': rec['fileDigest'],
                        'recordDigest': rec['recordDigest'],
                        'chunkOrdinal': ordinal,
                        'chunkCount': len(texts),
                        'occurredAt': rec.get('occurredAt'),
                        'excerpt': (ctext[:160] + '…') if len(ctext) > 160 else ctext,
                    })
                    encode_items.append(ctext)
        if real:
            vectors = self.embedder.encode_ids(encode_items)
        else:
            vectors = self.embedder.encode_texts(encode_items)
        identity = emb.identity_block(self.embedder.provider,
                                      self.embedding_config)
        payload = {
            'schemaVersion': 1,
            'namespace': base.NAMESPACE,
            'policyVersion': 'semantic_vectors_v1',
            'identity': identity,
            'workspaceRef': ws_ref,
            'scope': scope,
            'memoryIndexVersion': entry['memoryIndexVersion'],
            'chunks': chunk_rows,
            'vectors': vectors,
        }
        persisted = self._atomic_write_json(_vec_file(ws_ref, scope), payload)
        self.vectors[(ws_ref, scope)] = {
            'identity': identity,
            'memoryIndexVersion': entry['memoryIndexVersion'],
            'chunks': chunk_rows,
            'vectors': vectors,
            'stale': False,
        }
        return persisted, len(chunk_rows)

    def _atomic_write_json(self, filename, payload):
        if not self.dsh_home:
            return False
        d = self._semantic_dir()
        try:
            os.makedirs(d, exist_ok=True)
            fd, tmp = base.tempfile.mkstemp(dir=d, prefix='.tmp-vec-',
                                            suffix='.json')
            with os.fdopen(fd, 'wb') as fh:
                fh.write((base.dumps(payload) + '\n').encode('utf-8'))
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, os.path.join(d, filename))
            return True
        except OSError as exc:
            base.diag('vector-persist-failed: ' + str(exc))
            return False

    # ---------- dense shadow search ----------

    def _cosine(self, a, b):
        num = sum(x * y for x, y in zip(a, b))
        return num  # vectors are stored L2-normalized

    def dense_search(self, query_text, workspace_key, scope, miv,
                     top_k=SHADOW_TOP_K):
        """Hard triple filter (M7-7.5 audit P1): workspaceRef + scope + miv
        must ALL match the request; isolation never relies on miv differing.
        workspaceRef is reproduced from the request's workspaceKey via the
        JS-published pure function (see wsref_of)."""
        if self.embedder is None:
            return []
        ws_ref = wsref_of(workspace_key)
        try:
            if hasattr(self.embedder, 'encode_query'):
                qv = self.embedder.encode_query(query_text)
            else:
                qv = self.embedder.encode_texts([query_text])[0]
        except Exception as exc:  # noqa: BLE001
            base.diag('query-encode-failed: ' + str(exc))
            return []
        scored = []
        entry = self.vectors.get((ws_ref, scope))
        if entry is not None and not entry['stale'] \
                and entry['memoryIndexVersion'] == miv:
            for i, chunk in enumerate(entry['chunks']):
                vec = entry['vectors'][i]
                s = self._cosine(qv, vec)
                scored.append((s, chunk))
        scored.sort(key=lambda t: (-t[0], t[1]['memoryId'], t[1]['chunkOrdinal']))
        # aggregate to parent memory: top chunk score wins (frozen D2)
        seen, out = set(), []
        for s, chunk in scored:
            if chunk['memoryId'] in seen:
                continue
            seen.add(chunk['memoryId'])
            out.append({'score': round(s, 6), **{k: chunk[k] for k in (
                'chunkId', 'memoryId', 'anchorId', 'scope', 'workspaceRef',
                'sourceRef', 'sourceEpoch', 'sourceVersion', 'fileDigest',
                'recordDigest', 'chunkOrdinal', 'occurredAt', 'excerpt')}})
            if len(out) >= top_k:
                break
        return out

    def _lexical_scores(self, ws_ref, scope, miv, query_text, memory_ids):
        """D6 lexical arm over full authorized record text (from the derived
        corpus the worker already holds); BM25 k1=1.2 b=0.75."""
        key = (ws_ref, scope, miv)
        if self._lex_cache is None or self._lex_cache[0] != key:
            entry = self.derived.get((ws_ref, scope))
            texts = [(r['memoryId'], r.get('text') or '')
                     for r in (entry['records'] if entry else [])]
            self._lex_cache = (key, LexicalBM25(
                [_tokenize(t, self._stopwords) for _, t in texts]))
        bm = self._lex_cache[1]
        qt = _tokenize(query_text, self._stopwords)
        return {mid: bm.score(qt, i) for i, (mid, _) in enumerate(
            [(r['memoryId'], '') for r in
             self.derived.get((ws_ref, scope), {}).get('records', [])])}

    @staticmethod
    def _minmax(vals):
        lo, hi = min(vals), max(vals)
        return [0.0] * len(vals) if hi <= lo else \
            [(v - lo) / (hi - lo) for v in vals]

    def hybrid_rank(self, candidates, query_text, workspace_key, scope, miv):
        """D6 frozen fusion: fused = 0.7*minmax(dense) + 0.3*minmax(lexical).
        Single-candidate sets pass through unfused. Returns re-ranked list;
        each candidate gains denseScore/lexicalScore/fusedScore."""
        if self.search_policy['mode'] != 'hybrid' or len(candidates) < 2:
            for c in candidates:
                c['denseScore'] = c['lexicalScore'] = c['fusedScore'] = c['score']
            return candidates
        ws_ref = wsref_of(workspace_key)
        lex_all = self._lexical_scores(ws_ref, scope, miv, query_text,
                                       [c['memoryId'] for c in candidates])
        dense_norm = self._minmax([c['score'] for c in candidates])
        lex_norm = self._minmax([lex_all.get(c['memoryId'], 0.0)
                                 for c in candidates])
        w = float(self.search_policy['wDense'])
        for c, dn, ln in zip(candidates, dense_norm, lex_norm):
            c['denseScore'] = round(float(dn), 6)
            c['lexicalScore'] = round(float(ln), 6)
            c['fusedScore'] = round(w * dn + (1 - w) * ln, 6)
        candidates.sort(key=lambda c: (-c['fusedScore'], c['memoryId'],
                                       c['chunkOrdinal']))
        return candidates

    def _append_shadow(self, row):
        if not self.dsh_home:
            return
        d = self._semantic_dir()
        try:
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, 'candidates-shadow.jsonl')
            lines = []
            if os.path.isfile(path):
                with open(path, encoding='utf-8') as f:
                    lines = [l for l in f.read().splitlines() if l.strip()]
            lines.append(base.dumps(row))
            lines = lines[-SHADOW_LOG_MAX:]
            fd, tmp = base.tempfile.mkstemp(dir=d, prefix='.tmp-shadow-',
                                            suffix='.jsonl')
            with os.fdopen(fd, 'wb') as fh:
                fh.write(('\n'.join(lines) + '\n').encode('utf-8'))
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except OSError as exc:
            base.diag('shadow-append-failed: ' + str(exc))

    # ---------- M7-6 semantic activation (dual threshold + hysteresis) ----------

    def _session_state(self, p):
        session = p.get('session') or {}
        key = (str(session.get('sessionId', '')),
               str(session.get('workspaceKey', '')),
               session.get('scope'))
        if key not in self.session_states:
            self.session_states[key] = SessionSemanticState()
        return self.session_states[key]

    def _activation_features(self, p, candidates):
        """All feature groups recorded separately (task set §10).
        Audit H4 fixes: correction is NEGATIVE evidence; toolFailures carry
        explicit weight; recency consumes candidate occurredAt (now
        propagated through build_vectors -> dense_search)."""
        top = candidates[0]['score'] if candidates else 0.0
        second = candidates[1]['score'] if len(candidates) > 1 else 0.0
        evidence = p.get('evidence') if isinstance(p.get('evidence'), list) else []
        ev_seen = sum(int(e.get('seen') or 0) for e in evidence
                      if isinstance(e, dict))
        ev_cite = sum(int(e.get('cite') or 0) for e in evidence
                      if isinstance(e, dict))
        ev_correction = sum(int(e.get('correction') or 0) for e in evidence
                            if isinstance(e, dict))
        window = p.get('window') if isinstance(p.get('window'), list) else []
        tool_failures = sum(
            1 for s in window if isinstance(s, dict) and
            (s.get('errorName') or s.get('errorCode') or s.get('toolOk') is False))
        recency = 0.0
        occurred = (candidates[0] or {}).get('occurredAt') if candidates else None
        if isinstance(occurred, (int, float)) and occurred > 0:
            import time as _t
            age_days = max(0.0, (_t.time() * 1000 - occurred) / 86400000.0)
            recency = 1.0 / (1.0 + age_days / 30.0)
        return {
            'denseTop': round(float(top), 6),
            'denseMargin': round(float(max(0.0, top - second)), 6),
            'evidenceSeen': ev_seen, 'evidenceCite': ev_cite,
            'evidenceCorrection': ev_correction,
            'toolFailures': tool_failures,
            'recencyBoost': round(float(recency), 6),
        }

    def _semantic_score(self, f):
        w = self.activation_policy['w']
        # audit H4: correction LOWERS confidence (was wrongly positive)
        ev_term = max(-1.0, min(1.0,
                     f['evidenceSeen'] * 0.05 +
                     f['evidenceCite'] * 0.10 -
                     f['evidenceCorrection'] * 0.20))
        s = (w['top'] * f['denseTop'] + w['margin'] * min(1.0, f['denseMargin'] * 4)
             + w['evidence'] * ev_term + w['recency'] * f['recencyBoost']
             + w.get('toolFail', 0.05) * min(1.0, f['toolFailures'] * 0.5))
        return round(max(0.0, min(1.0, s)), 6)

    def _conflict_filter(self, p, candidates):
        """Audit H4 hard suppression: a memory carrying correction evidence is
        suppressed from candidates entirely (old claim must not activate)."""
        evidence = p.get('evidence') if isinstance(p.get('evidence'), list) else []
        corrected = {str(e.get('memoryId')) for e in evidence
                     if isinstance(e, dict) and int(e.get('correction') or 0) > 0}
        if not corrected or not candidates:
            return candidates, []
        kept = [c for c in candidates if c['memoryId'] not in corrected]
        dropped = [c['memoryId'] for c in candidates
                   if c['memoryId'] in corrected]
        return kept, dropped

    def _activation_decision(self, state, score):
        t_on = float(self.activation_policy['tOn'])
        t_off = float(self.activation_policy['tOff'])
        cooldown = int(self.activation_policy['cooldownObs'])
        if state.obs - state.lastEmitObs <= cooldown:
            return 'cooldown'
        if state.arming == 'suppressed':
            if score >= t_on:
                state.arming = 'armed'
                return 'emit'
            if score >= t_off:
                state.arming = 'prefetched'
                return 'prefetch'
            return 'suppress'
        if state.arming == 'prefetched':
            if score >= t_on:
                state.arming = 'armed'
                return 'emit'
            if score < t_off:
                state.arming = 'suppressed'
                return 'suppress'
            return 'prefetch'
        # armed: hysteresis - stay armed until score falls below T_off
        if score < t_off:
            state.arming = 'suppressed'
            return 'suppress'
        if score >= t_on and state.obs - state.lastEmitObs > cooldown:
            return 'emit'
        return 'hold'

    def _build_activation(self, req, p, candidates, score, features):
        pol = self.activation_policy
        session = p.get('session') or {}
        cursor = p.get('cursor') or {}
        obs = str(p.get('observationId', ''))
        miv = str((p.get('index') or {}).get('memoryIndexVersion', ''))
        level = 'hint'
        for bound, lv in pol['levelBands']:
            if score >= float(bound):
                level = lv
                break
        cands = []
        for i, c in enumerate(candidates[:int(pol['maxCandidates'])]):
            excerpt = (c.get('excerpt') or '')[:160]
            if len(excerpt.encode('utf-8')) > 480:
                excerpt = excerpt[:150]
            cands.append({
                'candidateId': 'cand_' + base.first32(
                    base.sha_str('m7-semantic-cand\u0000' + obs + '\u0000' +
                                 c['memoryId'] + '\u0000' + str(i))),
                'memoryId': c['memoryId'], 'anchorId': c['anchorId'],
                'scope': c['scope'], 'sourceRef': c['sourceRef'],
                'sourceEpoch': c['sourceEpoch'], 'sourceVersion': c['sourceVersion'],
                'fileDigest': c['fileDigest'], 'recordDigest': c['recordDigest'],
                'score': round(min(1.0, max(0.0, c['score'])), 6),
                'excerpt': excerpt,
            })
        if not cands:
            return None
        activation_id = 'act_' + base.first32(
            base.sha_str('m7-semantic-activation-pre-v1\u0000' + obs))
        created = req.get('sentAt', 0)
        ttl = int(pol['ttlSteps'])
        return {
            'schemaVersion': 1, 'namespace': base.NAMESPACE,
            'kind': 'activation_request',
            'activationId': activation_id, 'observationId': obs,
            'workerEpoch': str(req.get('workerEpoch', '')),
            'sessionId': str(session.get('sessionId', '')),
            'agentId': str(session.get('agentId', '')),
            'workspaceKey': str(session.get('workspaceKey', '')),
            'scope': session.get('scope'),
            'contextVersion': cursor.get('contextVersion'),
            'memoryIndexVersion': miv,
            'threshold': {
                'policyVersion': ACTIVATION_POLICY_VERSION,
                'score': score,
                'threshold': float(pol['tOn']),
                'reason': ('semantic dual-threshold t_on=%s score=%s top=%s'
                           % (pol['tOn'], score, features['denseTop']))[:160],
            },
            'level': level,
            'candidates': cands,
            'ttlSteps': max(1, min(10, ttl)),
            'createdAt': created,
            'expiresAt': created + max(1, min(10, ttl)) * 60000,
        }

    def _build_fv2_activation(self, req, p, candidates, out):
        """fv2 两车道决策 → ActivationRequestPre。候选/身份块复用 v1 构造器
        (同一 provenance 契约),判定块改用 fv2 策略版本与 reasonCodes;
        score=intentProb、threshold=tauHi(explicit 车道的放行量);
        level 固定 'excerpt'=最小内容级(full/checklist 需更严预算与用户策略,
        canary 不开放)。"""
        pol = self._fv2['policy'] if self._fv2 else {}
        th = pol.get('thresholds') or {}
        feats = out.get('features') or {}
        if not isinstance(feats, dict):
            feats = {}
        try:
            score = float(feats.get('intentProb') or 0.0)
        except (TypeError, ValueError):
            score = 0.0
        # v1 构造器的 reason 串引用 features['denseTop'];传快照避免 KeyError,
        # 该 threshold 块随后整体被 fv2 判定块覆写。
        act = self._build_activation(req, p, candidates, score,
                                     {'denseTop': feats.get('denseTop', 0)})
        if act is None:
            return None
        reasons = ','.join(str(x) for x in (out.get('reasonCodes') or []))
        act['threshold'] = {
            'policyVersion': featv2.ACTIVATION_POLICY_VERSION,
            'score': round(score, 6),
            'threshold': float(th.get('tauHi', 0.45)),
            'reason': ('fv2 lane=%s %s %s' % (
                feats.get('lane'), out.get('decision'), reasons))[:160],
        }
        act['level'] = 'excerpt'
        return act

    def _append_activation_shadow(self, row):
        if not self.dsh_home:
            return
        d = self._semantic_dir()
        try:
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, 'activation-shadow.jsonl')
            lines = []
            if os.path.isfile(path):
                with open(path, encoding='utf-8') as f:
                    lines = [l for l in f.read().splitlines() if l.strip()]
            lines.append(base.dumps(row))
            lines = lines[-SHADOW_LOG_MAX:]
            fd, tmp = base.tempfile.mkstemp(dir=d, prefix='.tmp-actshadow-',
                                            suffix='.jsonl')
            with os.fdopen(fd, 'wb') as fh:
                fh.write(('\n'.join(lines) + '\n').encode('utf-8'))
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except OSError as exc:
            base.diag('activation-shadow-append-failed: ' + str(exc))

    # ---------- M7-7 judgement shadow (audit only, never writes) ----------

    JUDGEMENT_POLICY = 'judgement_shadow_v1'

    _J_MARKERS = ('CORRECTION', 'UPDATED', 'REVISED', 'FREEZE',
                  'HARD RULE', 'DECISION reversing', '纠正', '更新:',
                  '决定:', '冻结')

    def _judge_kind(self, text):
        t = str(text or '')
        low = t.lower()
        if any(m in t for m in self._J_MARKERS[:9]):
            return 'conflict_or_supersede_candidate'
        if any(k in low for k in ('runbook', 'checklist', '步骤', '手册', '流程')):
            return 'procedure_candidate'
        if any(k in low for k in ('http', 'registry', '.exe', 'error', '错误码',
                                  'stack', '路径', 'cmd')):
            return 'resource_candidate'
        if any(k in low for k in ('偏好', '规则', '用户偏好', 'preference',
                                  'convention')):
            return 'profile_candidate'
        if any(k in t for k in ('午饭', 'lunch', 'backup', '日程')) or \
                len(t) < 120:
            return 'working_only' if len(t) < 80 else 'episodic_candidate'
        return 'semantic_candidate'

    def _judgement_rows(self, p, candidates, query):
        miv = str((p.get('index') or {}).get('memoryIndexVersion', ''))
        cv = (p.get('cursor') or {}).get('contextVersion')
        rows = []
        top = candidates[:3]
        for rank, c in enumerate(top):
            kind = self._judge_kind(c.get('excerpt') or '')
            conf = round(min(0.95, 0.4 + 0.15 * float(c['score'])), 4)
            rows.append({
                'schemaVersion': 1, 'namespace': base.NAMESPACE,
                'policyVersion': self.JUDGEMENT_POLICY,
                'observationId': str(p.get('observationId', '')),
                'contextVersion': cv, 'memoryIndexVersion': miv,
                'kindCandidate': kind,
                'suggestion': 'keep_suggest',
                'sourceIds': [c['memoryId']],
                'supportEvidence': {'denseScore': c['score'], 'rank': rank,
                                    'queryChars': len(query)},
                'counterEvidence': ({} if rank > 0 else
                                    {'secondScore': candidates[1]['score']
                                     if len(candidates) > 1 else 0.0}),
                'confidence': conf,
            })
        # duplicate/merge hint: top pair with near-identical scores
        if len(candidates) >= 2 and \
                float(candidates[0]['score']) - float(candidates[1]['score']) < 0.01:
            rows.append({
                'schemaVersion': 1, 'namespace': base.NAMESPACE,
                'policyVersion': self.JUDGEMENT_POLICY,
                'observationId': str(p.get('observationId', '')),
                'contextVersion': cv, 'memoryIndexVersion': miv,
                'kindCandidate': 'semantic_candidate',
                'suggestion': 'merge_suggest',
                'sourceIds': [candidates[0]['memoryId'],
                              candidates[1]['memoryId']],
                'supportEvidence': {'scoreGap': round(float(
                    candidates[0]['score']) - float(candidates[1]['score']), 6)},
                'counterEvidence': {},
                'confidence': 0.5,
            })
        # supersede hint from explicit correction markers in top-5
        for c in candidates[:5]:
            if any(m in str(c.get('excerpt') or '') for m in self._J_MARKERS):
                rows.append({
                    'schemaVersion': 1, 'namespace': base.NAMESPACE,
                    'policyVersion': self.JUDGEMENT_POLICY,
                    'observationId': str(p.get('observationId', '')),
                    'contextVersion': cv, 'memoryIndexVersion': miv,
                    'kindCandidate': 'conflict_or_supersede_candidate',
                    'suggestion': 'supersede_suggest',
                    'sourceIds': [c['memoryId']],
                    'supportEvidence': {'markerHit': True,
                                        'denseScore': c['score']},
                    'counterEvidence': {},
                    'confidence': 0.6,
                })
                break
        return rows

    def _append_judgement_shadow(self, rows):
        if not self.dsh_home or not rows:
            return
        d = self._semantic_dir()
        try:
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, 'judgement-shadow.jsonl')
            lines = []
            if os.path.isfile(path):
                with open(path, encoding='utf-8') as f:
                    lines = [l for l in f.read().splitlines() if l.strip()]
            lines.extend(base.dumps(r) for r in rows)
            lines = lines[-SHADOW_LOG_MAX:]
            fd, tmp = base.tempfile.mkstemp(dir=d, prefix='.tmp-judge-',
                                            suffix='.jsonl')
            with os.fdopen(fd, 'wb') as fh:
                fh.write(('\n'.join(lines) + '\n').encode('utf-8'))
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except OSError as exc:
            base.diag('judgement-shadow-append-failed: ' + str(exc))

    # ---------- overrides ----------

    def handle_index_commit(self, req):
        frames = super().handle_index_commit(req)
        accepted = bool(frames and frames[-1].get('payload', {}).get('accepted'))
        if accepted and self.embedder is not None:
            for key in list(self.derived.keys()):
                if self.vectors.get(key, {}).get('stale', True) or \
                   self.vectors.get(key, {}).get('memoryIndexVersion') != \
                   self.derived[key]['memoryIndexVersion']:
                    try:
                        persisted, n = self.build_vectors(*key)
                        base.diag('vectors built for %s: chunks=%d persisted=%s'
                                  % (key, n, persisted))
                    except Exception as exc:  # noqa: BLE001
                        base.diag('vector-build-failed %s: %s' % (key, exc))
        return frames

    def maybe_activation(self, req, p):
        """Semantic worker stage M7-3: no activations at all (fake path
        suppressed; real proactive activation arrives in M7-6)."""
        return None

    def handle_context_push(self, req):
        """Wrapper: any exception in the semantic pipeline is persisted to
        fv2-debug.log before re-raising (protocol layer turns it into an
        error frame; without this log the failure was invisible on live)."""
        try:
            return self._handle_context_push_impl(req)
        except Exception as exc:  # noqa: BLE001
            try:
                dbg = os.path.join(self.dsh_home or '', 'memory',
                                   'semantic', 'fv2-debug.log')
                with open(dbg, 'a', encoding='utf-8') as f:
                    f.write('CTX-PUSH-EXC: %s\n%s\n' % (
                        repr(exc)[:300],
                        __import__('traceback').format_exc()[-1800:]))
            except Exception:
                pass
            raise

    def _handle_context_push_impl(self, req):
        frames = super().handle_context_push(req)
        p = req.get('payload') or {}
        if not (frames and frames[0].get('payload', {}).get('accepted')):
            return frames
        miv = str((p.get('index') or {}).get('memoryIndexVersion', ''))
        if not base.RE_IDX.match(miv):
            return frames
        text_parts = []
        for seg in ([p.get('trigger')] + list(p.get('window') or [])):
            if isinstance(seg, dict) and isinstance(seg.get('text'), str):
                text_parts.append(seg['text'])
        query = ' '.join(text_parts)[-2000:]
        session = p.get('session') or {}
        candidates = self.dense_search(query, str(session.get('workspaceKey', '')),
                                       session.get('scope'), miv) or []
        conflict_dropped = []
        if candidates:
            # audit H4: corrected memories are hard-suppressed before ranking
            candidates, conflict_dropped = self._conflict_filter(p, candidates)
            # D6 frozen fusion (M7-7.5): weighted hybrid, not dense-only
            candidates = self.hybrid_rank(candidates, query,
                                          str(session.get('workspaceKey', '')),
                                          session.get('scope'), miv)
        if candidates:
            self._append_shadow({
                'schemaVersion': 1,
                'namespace': base.NAMESPACE,
                'policyVersion': 'semantic_shadow_v1',
                'observationId': str(p.get('observationId', '')),
                'workerEpoch': str(req.get('workerEpoch', '')),
                'memoryIndexVersion': miv,
                'method': self.search_policy['mode'],
                'queryChars': len(query),
                'conflictDropped': conflict_dropped,
                'candidates': candidates,
            })
        # ---- M7-7 judgement shadow (audit only) ----
        if candidates:
            self._append_judgement_shadow(self._judgement_rows(p, candidates,
                                                                query))
        # ---- M7-6 dual-threshold activation (shadow default) ----
        # no corpus view / no candidates at all -> nothing semantic to say;
        # activation path stays silent (fail closed, no log noise)
        if candidates:
            state = self._session_state(p)
            state.obs += 1
            features = self._activation_features(p, candidates)
            score = self._semantic_score(features)
            decision = self._activation_decision(state, score)
            state.lastScore = score
            state.lastFeatures = features
            row = {
                'ts': int(time.time()),
                'schemaVersion': 1, 'namespace': base.NAMESPACE,
                'policyVersion': ACTIVATION_POLICY_VERSION,
                'mode': self.activation_policy['mode'],
                'observationId': str(p.get('observationId', '')),
                'obs': state.obs, 'score': score, 'decision': decision,
                'arming': state.arming,
                'features': features,
            }
            if decision == 'emit':
                state.lastEmitObs = state.obs
                act = self._build_activation(req, p, candidates, score, features)
                if act is None:
                    row['decision'] = 'emit-blocked-no-candidates'
                else:
                    row['activationId'] = act['activationId']
                    row['level'] = act['level']
                    if self.activation_policy['mode'] == 'active':
                        frames.append(self._frame(req, 'activation_request',
                                                  {'activation': act},
                                                  fid_prefix='act_'))
            self._append_activation_shadow(row)
        # ---- feature v2 two-lane decision (shadow rows always; wire emits
        # gated by embedding-config activationEmitMode, default shadow) ----
        try:
            self._fv2_shadow_decide(req, p, candidates or [], frames)
        except Exception as _fv2_err:
            base.diag('fv2-callsite-error: ' + str(_fv2_err)[:300])
        return frames

    def handle_frame(self, req):
        import traceback as _tb
        import sys as _sys
        try:
            return super().handle_frame(req)
        except Exception:
            _sys.stderr.write('[fv2-trace] ' + _tb.format_exc() + '\n')
            raise

    def handle_close_session(self, req):
        p = req.get('payload') or {}
        sid = str(p.get('sessionId', ''))
        if sid:
            for key in [k for k in self.session_states if k[0] == sid]:
                del self.session_states[key]
        return super().handle_close_session(req)

    def handle_health(self, req):
        frames = super().handle_health(req)
        payload = frames[0]['payload']
        payload['worker'] = 'semantic'
        payload['capabilities'] = ['index-sync-v1', 'embedding-shadow-v1']
        payload['embedding'] = self.embedding_view()
        payload['featuresV2'] = {
            'loaded': self._fv2 is not None,
            'invalid': self._fv2_invalid or None,
            'rowsWritten': self._fv2_rows,
        }
        return frames

    # ---- feature v2 shadow wiring (round-1) ----

    def _fv2_append(self, filename, obj):
        if not self.dsh_home:
            return
        d = self._semantic_dir()
        try:
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, filename)
            prev = []
            if os.path.isfile(path):
                with open(path, encoding='utf-8') as f:
                    prev = [l for l in f.read().splitlines() if l.strip()]
            prev.append(base.dumps(obj))
            prev = prev[-256:]
            fd, tmp = base.tempfile.mkstemp(dir=d, prefix='.tmp-fv2-',
                                            suffix='.jsonl')
            with os.fdopen(fd, 'wb') as fh:
                fh.write(('\n'.join(prev) + '\n').encode('utf-8'))
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except OSError as exc:
            base.diag('fv2-append-failed: ' + str(exc))

    def _fv2_repetition(self, sid, query):
        """30-min decayed counters; logging-only, never activates."""
        now = time.time()
        topic = featv2.normalize_text(query)[:24]
        key = (sid, hashlib.sha256(topic.encode('utf-8')).hexdigest()[:16])
        st = self._fv2_rep.get(key) or {'mentions': 0, 'failures': 0,
                                        'lastSeen': 0}
        if now - st['lastSeen'] > 1800:
            st['mentions'] = 0
            st['failures'] = 0
        st['mentions'] += 1
        st['lastSeen'] = int(now)
        self._fv2_rep[key] = st
        return {'topicKey': key[1], 'mentions': st['mentions'],
                'failures': st['failures'], 'decayWindowSec': 1800}

    def _intent_config_hash(self):
        ip_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               'policies', 'recall_intent_lr_v1.json')
        try:
            with open(ip_path, encoding='utf-8') as f:
                ip = json.load(f)
            probe = {k: v for k, v in ip.items() if k != 'configHash'}
            payload = json.dumps(probe, sort_keys=True, ensure_ascii=False)
            return 'cfgh_' + hashlib.sha256(
                payload.encode('utf-8')).hexdigest()[:32]
        except Exception as exc:
            base.diag('intent-hash-failed: ' + str(exc))
            return None

    def _fv2_shadow_decide(self, req, p, candidates, frames):
        try:
            dbg = os.path.join(self.dsh_home or '', 'memory', 'semantic',
                               'fv2-debug.log')
            with open(dbg, 'a', encoding='utf-8') as f:
                f.write('CALLED obs=%s ncand=%s fv2=%s nrefs=%s nev=%s ws=%s\n' % (
                    str(p.get('observationId', ''))[:24],
                    len(candidates) if candidates else 0,
                    self._fv2 is not None,
                    len(p.get('memoryRefs') or []),
                    len(p.get('evidence') or []),
                    str((p.get('session') or {}).get('workspaceKey', ''))[-16:]))
        except Exception:
            pass
        """Round-1: compute the feature-v2 decision alongside v1 and append a
        bounded shadow row. Never emits frames; fail closed when policy
        artifacts are invalid. No raw query text or absolute paths are
        persisted (hash + chars only)."""
        obs = str(p.get('observationId', ''))
        session = p.get('session') or {}
        sid = str(session.get('sessionId', ''))
        query = ' '.join(
            seg.get('text') for seg in ([p.get('trigger')] +
                                        list(p.get('window') or []))
            if isinstance(seg, dict) and isinstance(seg.get('text'), str))[-2000:]
        base_row = {
            'schemaVersion': 1, 'namespace': base.NAMESPACE,
            'featurePolicyVersion': (featv2.FEATURES_POLICY_VERSION
                                     if featv2 else None),
            'observationId': obs, 'queryChars': len(query),
            'candidateCount': len(candidates or []),
            'v1Available': bool(candidates),
        }
        if self._fv2 is None:
            base_row.update({'shadowReason': 'policy-invalid',
                             'error': self._fv2_invalid[:160]})
            self._fv2_rows += 1
            self._fv2_append('activation-shadow-v2.jsonl', base_row)
            return
        try:
            head = self._fv2['head']
            pol = self._fv2['policy']
            intent = featv2.infer_recall_intent(query, head)
            dact = featv2.infer_dialogue_act(query, intent)
            tneed = featv2.infer_task_need(dact)
            top = candidates[0] if candidates else None
            cand_text = ''
            ws_ref_key = None
            if top is not None:
                for key in self.derived:
                    recs = self.derived[key].get('records') or []
                    if any(rr['memoryId'] == top['memoryId'] for rr in recs):
                        ws_ref_key = key
                        for rr in recs:
                            if rr['memoryId'] == top['memoryId']:
                                cand_text = rr.get('text') or ''
                                break
                        break
            containment = featv2.lexical_containment(query, cand_text)
            dense_top = float(top['score']) if top else 0.0
            second = (float(candidates[1]['score'])
                      if len(candidates) > 1 else 0.0)
            margin = max(0.0, dense_top - second)
            tl = query.lower()
            mark = int(any(x in tl for x in
                           featv2.INTERROG + featv2.RECALL_CTX))
            mem_ref_ids = {mr.get('memoryId')
                           for mr in (p.get('memoryRefs') or [])
                           if isinstance(mr, dict)}
            # 2026-08-30 candidateHit 接缝修复(变体 A,受控 shadow 14 条对账发现):
            # 生产 refs=JS 词法臂(快照),与稠密 top-K 交集窄 → candidateHit 12/12 False
            # → 高 intent 全 suppress。变体 A(candidatehit_variant_replay,63 gold 复放:
            # precision 0.846 / emitOnSup 0):词法臂对 top-K 候选有实质 BM25 命中(≥12.0,
            # activate 与 non-activate 在此分离)即信任单臂证据。baseline 交集仍保留。
            max_lex_raw = 0.0
            try:
                _lex_key = (wsref_of(str(session.get('workspaceKey', ''))),
                            session.get('scope'))
                _lex_entry = self.derived.get(_lex_key) or {}
                _lex_miv = _lex_entry.get('memoryIndexVersion')
                _lex_cached = getattr(self, '_lex_bm25_cache', None)
                if not _lex_cached or _lex_cached[0] != _lex_miv:
                    _lex_docs = [(rr.get('memoryId'), rr.get('text') or '')
                                 for rr in (_lex_entry.get('records') or [])]
                    _lex_cached = (_lex_miv,
                                   LexicalBM25([_tokenize(t) for _, t in _lex_docs]),
                                   {mid: i for i, (mid, _) in enumerate(_lex_docs)})
                    self._lex_bm25_cache = _lex_cached
                _qt = _tokenize(query)
                for c in candidates:
                    _di = _lex_cached[2].get(c.get('memoryId'))
                    if _di is not None:
                        _s = _lex_cached[1].score(_qt, _di)
                        if _s > max_lex_raw:
                            max_lex_raw = _s
            except Exception:
                max_lex_raw = 0.0
            candidate_hit = bool(mem_ref_ids &
                                 {c['memoryId'] for c in candidates}) \
                or max_lex_raw >= 12.0
            rep = self._fv2_repetition(sid, query)
            evidence = (p.get('evidence')
                        if isinstance(p.get('evidence'), list) else [])
            cand_ids = {c['memoryId'] for c in candidates}

            def _evidence_gate(field):
                """Per-candidate hard gate (controlled-shadow 2026-08-25
                finding: a session-wide any() gate let one stale/corrected
                memory anywhere in the evidence stream permanently suppress
                ALL 94 observations; the gate may only fire when the affected
                memoryId is among the CURRENT top-K candidates). See
                docs/M7-ACTIVATION-V2-CONTROLLED-SHADOW.md §3."""
                return any(e.get('memoryId') in cand_ids and
                           (e.get('freshness') == 'stale' if field == 'stale'
                            else int(e.get(field) or 0) > 0)
                           for e in evidence if isinstance(e, dict))

            correction_gate = _evidence_gate('correction')
            stale_gate = _evidence_gate('stale')
            # F1 降版本容忍(2026-08-31,docs/A3-RISK-ASSESSMENT-20260830.md):
            # 候选本身就是当前语料快照检索出来的记录(digest 与语料同版本),而 evidence
            # aggregate 的 stale 只表示「最近一条证据事件描述的是旧版本 digest」——语料
            # 每次重锚定(每日日志追加)都会让全部历史证据一夜变 stale,压制窗口随之振荡
            # (实测 35/64 记忆 stale,emit 全灭,靠用户恰好发起读取才自愈)。纠正风险已由
            # correction 门独立覆盖;stale 门据此降级:不进 hardGates(不再 suppress/
            # prefetch 压制),只作为 reasonCodes 标注 + emit 降 prefetch 的软信号保留。
            # 不动 fv2 决策核(hardGates 仍透传 correction)。
            features = {
                'id': obs, 'text': query,
                'denseTop': round(dense_top, 6), 'margin': round(margin, 6),
                'containment': round(containment, 4), 'mark': mark,
                'nCand': len(candidates), 'candidateHit': candidate_hit,
                'resolvedTargets': None, 'requiredHint': None,
                'hardGates': {'correction': correction_gate},
                'repetition': rep,
                'requiresRelayFlag': False, 'piiClass': 'unknown',
            }
            out = featv2.decide_activation_v2(features, head, pol)
            # stale 软处理(2026-08-27 优化④ 语义保留):emit 遇 stale 降级为 prefetch
            # (stale 内容不注入,保留预取),并标记 staleDowngraded 供索引刷新。
            if stale_gate and out.get('decision') == 'emit':
                out['decision'] = 'prefetch'
                out['reasonCodes'] = list(out.get('reasonCodes') or []) + ['stale_downgraded']
            nh = hashlib.sha256(featv2.normalize_text(query).encode(
                'utf-8')).hexdigest()[:16]
            row = {
                'ts': int(time.time()),
                'schemaVersion': 1, 'namespace': base.NAMESPACE,
                'policyVersions': {
                    'features': featv2.FEATURES_POLICY_VERSION,
                    'intent': featv2.INTENT_POLICY_VERSION,
                    'activation': featv2.ACTIVATION_POLICY_VERSION},
                'configHashes': {
                    'activation': pol['configHash'],
                    'intent': self._intent_config_hash()},
                'goldDigest': pol['goldDigest'],
                'mode': pol['mode'],
                'observationId': obs, 'queryChars': len(query),
                'normTextHash': nh,
                'normTextLen': len(featv2.normalize_text(query)),
                'maxLexRaw': round(max_lex_raw, 3),
                'lane': out.get('features', {}).get('lane'),
                'decision': out['decision'],
                'reasonCodes': out['reasonCodes'],
                'features': out.get('features'),
                'candidateProvenance': [
                    {'memoryId': c['memoryId'],
                     'recordDigest': c['recordDigest']}
                    for c in candidates[:3]],
                'candidateHit': candidate_hit,
                'requiresCrossWorkspaceRelay':
                    bool(features['requiresRelayFlag']),
                'piiClass': features['piiClass'], 'advisoryOnly': None,
            }
            self._fv2_rows += 1
            row['rowsWritten'] = self._fv2_rows
            self._fv2_append('activation-shadow-v2.jsonl', row)
            # ---- fv2 emit bridge:shadow 行恒写(观测连续性);发射仅在上面的
            # activationEmitMode 门放行时发生。canary-explicit 只发 explicit 车道;
            # proactive 车道 round-1 本就到 prefetch 为止,结构上不会发射。----
            _feats = out.get('features') or {}
            _lane = str(_feats.get('lane') or '') if isinstance(_feats, dict) else ''
            if (out.get('decision') == 'emit'
                    and (self.activation_emit_mode == 'active'
                         or (self.activation_emit_mode == 'canary-explicit'
                             and _lane == 'explicit'))):
                _act = self._build_fv2_activation(req, p, candidates or [], out)
                if _act is not None:
                    frames.append(self._frame(req, 'activation_request',
                                              {'activation': _act},
                                              fid_prefix='act_'))
                    base.diag('fv2-emit act=%s lane=%s mode=%s' % (
                        str(_act.get('activationId', ''))[:24], _lane,
                        self.activation_emit_mode))
        except Exception as exc:  # fail closed; retrieval unaffected
            import traceback as _tb2
            base.diag('FV2-DEEP:' + chr(10) + _tb2.format_exc()[-3000:])
            base.diag('fv2-decide-failed: ' + str(exc)[:200])
            self._fv2_rows += 1
            self._fv2_append('activation-shadow-v2.jsonl', {
                'shadowReason': 'decide-failed',
                'error': str(exc)[:200], 'observationId': obs})


def load_embedding_config_from_env(dsh_home=''):
    """M7-8 live path: env var overrides; otherwise fall back to a
    host-provisioned config at <dsh-home>/memory/semantic/embedding-config.json
    so the real provider survives restarts without env inheritance."""
    path = os.environ.get(EMBEDDING_CONFIG_ENV, '')
    if not path and dsh_home:
        cand = os.path.join(dsh_home, 'memory', 'semantic',
                            'embedding-config.json')
        if os.path.isfile(cand):
            path = cand
    if not path:
        return {}
    try:
        with open(path, encoding='utf-8') as f:
            cfg = json.load(f)
        return cfg if isinstance(cfg, dict) else {}
    except (OSError, ValueError) as exc:
        base.diag('embedding-config-unreadable: ' + str(exc))
        return {}


def run_loop(worker):
    """Byte-level twin of worker_v1.main()'s stdin/stdout loop, bound to
    the semantic worker. Kept as a copy so the tested M7-0 file stays
    untouched."""
    out = sys.stdout.buffer
    inp = sys.stdin.buffer
    while True:
        raw = inp.readline(base.MAX_LINE_BYTES + 2)
        if raw == b'':
            break
        ended_with_newline = raw.endswith(b'\n')
        line = raw[:-1] if ended_with_newline else raw
        oversized = (len(line) > base.MAX_LINE_BYTES) or (
            not ended_with_newline and len(raw) >= base.MAX_LINE_BYTES + 1)
        if oversized:
            err = worker.error_frame({'requestId': '', 'workerEpoch': '',
                                      'sentAt': 0}, 'line-oversize')
            out.write((base.dumps(err) + '\n').encode('utf-8'))
            out.flush()
            break
        req_for_error = {'requestId': '', 'workerEpoch': '', 'sentAt': 0}
        try:
            obj = json.loads(line.decode('utf-8'))
            if isinstance(obj, dict):
                req_for_error = {'requestId': str(obj.get('requestId', '')),
                                 'workerEpoch': str(obj.get('workerEpoch', '')),
                                 'sentAt': obj.get('sentAt', 0)}
        except (UnicodeDecodeError, ValueError):
            obj = None
        if not isinstance(obj, dict) or not base.envelope_shape_ok(obj):
            out.write((base.dumps(worker.error_frame(req_for_error,
                                                     'invalid-envelope')) + '\n').encode('utf-8'))
            out.flush()
            worker.counts['errors'] += 1
            continue
        if worker.expect_epoch and obj['workerEpoch'] != worker.expect_epoch:
            out.write((base.dumps(worker.error_frame(req_for_error,
                                                     'epoch-mismatch')) + '\n').encode('utf-8'))
            out.flush()
            worker.counts['errors'] += 1
            continue
        try:
            frames = worker.handle_frame(obj)
        except base.ProtocolError as exc:
            worker.counts['errors'] += 1
            frames = [worker.error_frame(req_for_error, exc.code, exc.detail)]
        except Exception as exc:  # noqa: BLE001 - worker never dies on a bad frame
            worker.counts['errors'] += 1
            frames = [worker.error_frame(req_for_error, 'internal-error',
                                         str(exc)[:120])]
        for fr in frames:
            out.write((base.dumps(fr) + '\n').encode('utf-8'))
        out.flush()
    return 0


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('--expect-epoch', default='')
    ap.add_argument('--dsh-home', default='')
    ap.add_argument('--selftest', action='store_true')
    args, _unknown = ap.parse_known_args()
    if args.selftest:
        base.run_selftest()
        w = SemanticWorker('ep', '', {'provider': 'hash-pre-v1',
                                      'dimension': 64})
        view = w.embedding_view()
        assert view['enabled'] is True and view['ready'] is False
        sys.stderr.write('SEMANTIC SELFTEST OK\n')
        return 0
    cfg = load_embedding_config_from_env(args.dsh_home)
    worker = SemanticWorker(args.expect_epoch, args.dsh_home, cfg)
    return run_loop(worker)


if __name__ == '__main__':
    sys.exit(main())
