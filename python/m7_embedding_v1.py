#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""M7-3 production embedding core (frozen by docs/M7-ALGORITHM-DECISION.md).

Pure re-implementation of the frozen policy for the production sidecar path
(the benchmark rig lives separately under python/bench/ and stays untouched):

  provider      bge-m3 pinned revision, CLS pooling, L2-normalized float32
  chunk policy  m7_chunk_v1 = para-512-noov (tokenizer id space,
                greedy paragraph packing, oversized paragraph hard-split,
                no overlap; special tokens added by the model tokenizer)
  identity      provider/model/revision/dimension/normalization/policyVersion
                -> configHash; mismatch = stale = full rebuild

Providers:
  hash-pre-v1   deterministic stdlib-only embedding (sha256-seeded bag of
                token-trigram dims). Zero dependencies, zero network. Used
                by CI and offline protocol tests. NOT a quality provider.
  bge-m3-pre-v1 real model via transformers (lazy import; requires the
                pinned local snapshot dir passed in the embedding config).

No DSH file reads; no writes except what the worker explicitly passes in.
"""
import hashlib
import json
import re

PROVIDER_REAL = 'bge-m3-pre-v1'
PROVIDER_REAL_INT8 = 'bge-m3-onnx-int8-v1'
PROVIDER_HASH = 'hash-pre-v1'
CHUNK_POLICY_VERSION = 'm7_chunk_v1'
CHUNK_MAX_TOKENS = 512
QUERY_MAX_TOKENS = 256
DIMENSION = 1024

RE_CHUNK = re.compile(r'^chk_[0-9a-f]{16,}$')


def sha_hex(data):
    return hashlib.sha256(data).hexdigest()


def canonical(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float, str)):
        return json.dumps(v, ensure_ascii=False, separators=(',', ':'))
    if isinstance(v, list):
        return '[' + ','.join(canonical(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(json.dumps(str(k), ensure_ascii=False,
                                         separators=(',', ':')) + ':' + canonical(v[k])
                              for k in sorted(v.keys())) + '}'
    return 'null'


def config_hash(provider, model_revision, dimension):
    payload = {
        'provider': provider,
        'model': 'bge-m3' if provider == PROVIDER_REAL else provider,
        'modelRevision': model_revision,
        'dimension': dimension,
        'normalization': 'l2_normalize',
        'dtype': 'float32',
        'chunkPolicyVersion': CHUNK_POLICY_VERSION,
        'chunkParams': {'maxTokens': CHUNK_MAX_TOKENS, 'paraAligned': True,
                        'overlap': 0},
        'queryMaxTokens': QUERY_MAX_TOKENS,
    }
    return 'cfgh_' + sha_hex(canonical(payload).encode('utf-8'))


def chunk_id_for(memory_id, record_digest, ordinal):
    return 'chk_' + sha_hex(
        ('m7-chunk-pre-v1\u0000' + memory_id + '\u0000' + record_digest +
         '\u0000' + str(ordinal)).encode('utf-8'))[:32]


def chunk_record_token_ids(tokenizer, text):
    """para-512-noov over tokenizer ids; returns list of id-lists."""
    paras = []
    for p in text.split('\n'):
        ids = tokenizer(p, add_special_tokens=False)['input_ids']
        if ids:
            paras.append(ids)
    chunks, cur = [], []
    for ids in paras:
        if cur and len(cur) + len(ids) <= CHUNK_MAX_TOKENS:
            cur.extend(ids)
            continue
        if cur:
            chunks.append(cur)
            cur = []
        if len(ids) <= CHUNK_MAX_TOKENS:
            cur = list(ids)
        else:
            for i in range(0, len(ids), CHUNK_MAX_TOKENS):
                chunks.append(ids[i:i + CHUNK_MAX_TOKENS])
    if cur:
        chunks.append(cur)
    return chunks or [[]]


class HashEmbedder:
    """Deterministic dependency-free embedder for tests/offline paths.

    Unnormalized bag dims come from sha256 of character trigrams; the final
    vector is L2-normalized float32. Same text -> same vector, always.
    """

    provider = PROVIDER_HASH

    def __init__(self, config):
        self.dimension = int(config.get('dimension') or DIMENSION)

    def encode_texts(self, texts):
        import math
        out = []
        for t in texts:
            vec = [0.0] * self.dimension
            s = t if isinstance(t, str) else ''
            for i in range(max(0, len(s) - 2)):
                h = int.from_bytes(hashlib.sha256(s[i:i + 3].encode('utf-8',
                                    'ignore')).digest()[:8], 'big')
                vec[h % self.dimension] += 1.0
            norm = math.sqrt(sum(x * x for x in vec)) or 1.0
            out.append([round(x / norm, 8) for x in vec])
        return out

    def close(self):
        pass


class BgeM3Embedder:
    """Real frozen provider: transformers AutoModel, CLS pooling, L2 norm."""

    provider = PROVIDER_REAL

    def __init__(self, config):
        import os
        os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
        import torch
        from transformers import AutoModel, AutoTokenizer
        torch.set_num_threads(int(config.get('torchThreads') or 16))
        self._torch = torch
        path = config['modelDir']
        revision = str(config.get('modelRevision') or '')
        self.tokenizer = AutoTokenizer.from_pretrained(path, revision=revision)
        self.model = AutoModel.from_pretrained(path, revision=revision,
                                               dtype=torch.float32)
        self.model.eval()
        self.dimension = int(config.get('dimension') or DIMENSION)

    def _specials(self):
        probe = self.tokenizer('x', add_special_tokens=True)['input_ids']
        core = self.tokenizer('x', add_special_tokens=False)['input_ids']
        for i in range(len(probe) - len(core) + 1):
            if probe[i:i + len(core)] == core:
                return probe[:i], probe[i + len(core):]
        raise RuntimeError('content not found in tokenizer probe')

    def build_doc_ids(self, chunk_ids, max_total=512):
        """Wrap chunk token ids with the model's special tokens exactly once,
        capping total length at the XLM-R position limit (audit P0/P1)."""
        prefix, suffix = self._specials()
        budget = max_total - len(prefix) - len(suffix)
        body = list(chunk_ids)[:max(0, budget)]
        return list(prefix) + body + list(suffix)

    def encode_ids(self, ids_list, batch_size=8):
        torch = self._torch
        prefix, suffix = self._specials()
        pad = (self.tokenizer.pad_token_id if self.tokenizer.pad_token_id
               is not None else self.tokenizer.eos_token_id)
        vecs = []
        for i in range(0, len(ids_list), batch_size):
            part = [list(prefix) + list(ids) + list(suffix)
                    for ids in ids_list[i:i + batch_size]]
            maxlen = max(len(x) for x in part)
            inp = torch.full((len(part), maxlen), pad, dtype=torch.long)
            att = torch.zeros((len(part), maxlen), dtype=torch.long)
            for r, ids in enumerate(part):
                inp[r, :len(ids)] = torch.tensor(ids, dtype=torch.long)
                att[r, :len(ids)] = 1
            with torch.no_grad():
                hidden = self.model(input_ids=inp,
                                    attention_mask=att).last_hidden_state
            pooled = hidden[:, 0]  # CLS per repo 1_Pooling/config.json
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            vecs.extend(pooled.to(torch.float32).numpy().tolist())
        return vecs

    def _encode_texts_via_ids(self, texts, max_tokens):
        """Single source of truth for text->vector: tokenize WITHOUT specials,
        then let encode_ids wrap exactly once. Guarantees query/corpus share
        one template, and the truncation budget RESERVES room for the special
        tokens so wrapped length never exceeds max_tokens (audit round 2:
        same latent overlimit class as the e5 512 crash)."""
        prefix, suffix = self._specials()
        budget = max(1, max_tokens - len(prefix) - len(suffix))
        ids_list = []
        for t in texts:
            enc = self.tokenizer(t or '', add_special_tokens=False,
                                 truncation=True, max_length=budget)
            ids_list.append(enc['input_ids'])
        return self.encode_ids(ids_list)

    def chunk_and_encode(self, text):
        id_chunks = chunk_record_token_ids(self.tokenizer, text)
        return id_chunks, self.encode_ids(id_chunks)

    def encode_texts(self, texts, batch_size=8):
        """Record-level text -> vector (chunker bypasses: caller chunks).
        Used by the worker's hash-style flows and as the parity entry."""
        return self._encode_texts_via_ids(texts, 512)

    def encode_query(self, text):
        # audit fix P1: previously tokenized with add_special_tokens=True and
        # then wrapped again by encode_ids -> double specials, template drift.
        # query_cap already reserves the specials budget (see below).
        enc = self.tokenizer(text, add_special_tokens=False, truncation=True,
                             max_length=self.query_cap())
        return self.encode_ids([enc['input_ids']])[0]

    def query_cap(self):
        # 256 content + specials headroom: wrapped total never exceeds cap
        return 256 - 8

    def close(self):
        try:
            del self.model
            import gc
            gc.collect()
        except Exception:
            pass


class BgeM3OnnxInt8Embedder:
    """Quantized slim tier: Xenova/bge-m3 onnx/model_int8.onnx (dynamic int8)
    via onnxruntime. Same XLM-R tokenizer + CLS pooling + L2 norm contract as
    BgeM3Embedder; text->vector template methods are byte-twin copies of the
    parent so query/corpus share one wrapping path. L2 head-to-head 2026-08-25:
    R@5 identical to fp32 (0.925), encode ~6x faster, vec cos mean 0.975.
    Identity dtype differs from fp32 -> switching providers invalidates the
    vector store by design (stale -> rebuild)."""

    provider = PROVIDER_REAL_INT8

    def __init__(self, config):
        import os
        os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer
        self._np = np
        base = config['modelDir']
        onnx_rel = str(config.get('onnxFile') or 'onnx/model_int8.onnx')
        self.session = ort.InferenceSession(
            os.path.join(base, *onnx_rel.split('/')),
            providers=['CPUExecutionProvider'])
        self.tokenizer = AutoTokenizer.from_pretrained(base)
        self._inp = self.session.get_inputs()[0].name
        self._att = self.session.get_inputs()[1].name
        self.dimension = int(config.get('dimension') or DIMENSION)

    def _specials(self):
        probe = self.tokenizer('x', add_special_tokens=True)['input_ids']
        core = self.tokenizer('x', add_special_tokens=False)['input_ids']
        for i in range(len(probe) - len(core) + 1):
            if probe[i:i + len(core)] == core:
                return probe[:i], probe[i + len(core):]
        raise RuntimeError('content not found in tokenizer probe')

    def build_doc_ids(self, chunk_ids, max_total=512):
        prefix, suffix = self._specials()
        budget = max_total - len(prefix) - len(suffix)
        body = list(chunk_ids)[:max(0, budget)]
        return list(prefix) + body + list(suffix)

    def encode_ids(self, ids_list, batch_size=16):
        np = self._np
        prefix, suffix = self._specials()
        pad = (self.tokenizer.pad_token_id if self.tokenizer.pad_token_id
               is not None else self.tokenizer.eos_token_id)
        vecs = []
        for i in range(0, len(ids_list), batch_size):
            part = [list(prefix) + list(ids) + list(suffix)
                    for ids in ids_list[i:i + batch_size]]
            maxlen = max(len(x) for x in part)
            inp = np.full((len(part), maxlen), pad, dtype=np.int64)
            att = np.zeros((len(part), maxlen), dtype=np.int64)
            for r, ids in enumerate(part):
                inp[r, :len(ids)] = np.asarray(ids, dtype=np.int64)
                att[r, :len(ids)] = 1
            hidden = self.session.run(None, {self._inp: inp,
                                             self._att: att})[0]
            pooled = hidden[:, 0].astype(np.float32)  # CLS per 1_Pooling
            norms = np.linalg.norm(pooled, axis=1, keepdims=True)
            pooled = pooled / np.maximum(norms, 1e-12)
            vecs.extend([row.tolist() for row in pooled])
        return vecs

    def _encode_texts_via_ids(self, texts, max_tokens):
        prefix, suffix = self._specials()
        budget = max(1, max_tokens - len(prefix) - len(suffix))
        ids_list = []
        for t in texts:
            enc = self.tokenizer(t or '', add_special_tokens=False,
                                 truncation=True, max_length=budget)
            ids_list.append(enc['input_ids'])
        return self.encode_ids(ids_list)

    def chunk_and_encode(self, text):
        id_chunks = chunk_record_token_ids(self.tokenizer, text)
        return id_chunks, self.encode_ids(id_chunks)

    def encode_texts(self, texts, batch_size=16):
        return self._encode_texts_via_ids(texts, 512)

    def encode_query(self, text):
        enc = self.tokenizer(text, add_special_tokens=False, truncation=True,
                             max_length=self.query_cap())
        return self.encode_ids([enc['input_ids']])[0]

    def query_cap(self):
        return 256 - 8

    def close(self):
        try:
            del self.session
            import gc
            gc.collect()
        except Exception:
            pass


def load_embedder(config):
    provider = str(config.get('provider') or '')
    if provider == PROVIDER_HASH:
        return HashEmbedder(config)
    if provider == PROVIDER_REAL:
        return BgeM3Embedder(config)
    if provider == PROVIDER_REAL_INT8:
        return BgeM3OnnxInt8Embedder(config)
    raise ValueError('unknown embedding provider: %r' % (provider,))


def identity_block(provider, config):
    model_name = provider
    dtype = 'float32'
    if provider == PROVIDER_REAL:
        model_name = 'bge-m3'
    elif provider == PROVIDER_REAL_INT8:
        model_name = 'bge-m3-int8'
        # different dtype -> fp32-built vector stores are stale under the
        # int8 tier and must rebuild (provider switch is never silent)
        dtype = 'int8-dynamic-onnx'
    return {
        'schemaVersion': 1,
        'namespace': 'dsh-auto-memory',
        'policyVersion': 'semantic_vectors_v1',
        'provider': provider,
        'model': model_name,
        'modelRevision': str(config.get('modelRevision') or 'hash'),
        'dimension': int(config.get('dimension') or DIMENSION),
        'normalization': 'l2_normalize',
        'dtype': dtype,
        'chunkPolicyVersion': CHUNK_POLICY_VERSION,
        'configHash': config_hash(provider,
                                  str(config.get('modelRevision') or 'hash'),
                                  int(config.get('dimension') or DIMENSION)),
    }


def identity_matches(block, provider, config):
    want = identity_block(provider, config)
    keys = ('provider', 'model', 'modelRevision', 'dimension',
            'normalization', 'dtype', 'chunkPolicyVersion', 'configHash')
    return all(block.get(k) == want.get(k) for k in keys)
