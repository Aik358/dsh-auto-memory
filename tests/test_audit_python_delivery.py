"""Offline worker framing and embedding model-input regressions; no weights."""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
import m7_embedding_v1 as emb
import worker_semantic_v1 as semantic


class Tokenizer:
    pad_token_id = 1
    eos_token_id = 2

    def __call__(self, text, add_special_tokens=False, truncation=False, max_length=None):
        ids = [10 + i for i, _ in enumerate(text.split())] if text != 'x' else [10]
        if truncation:
            ids = ids[:max_length]
        return {'input_ids': [0] + ids + [2] if add_special_tokens else ids}

    def decode(self, ids, skip_special_tokens=True):
        return ' '.join(str(i) for i in ids)


class Matrix:
    def __init__(self, shape, fill):
        self.rows = [[fill] * shape[1] for _ in range(shape[0])]

    def __setitem__(self, index, values):
        row, cols = index
        count = len(self.rows[row][cols])
        self.rows[row][cols] = values if isinstance(values, list) else [values] * count


class Captured(Exception):
    pass


class FakeNumeric:
    int64 = long = 1

    @staticmethod
    def full(shape, fill, dtype=None):
        return Matrix(shape, fill)

    @staticmethod
    def zeros(shape, dtype=None):
        return Matrix(shape, 0)

    @staticmethod
    def asarray(ids, dtype=None):
        return list(ids)

    tensor = asarray

    @staticmethod
    def no_grad():
        return contextlib.nullcontext()


def provider_fixture(cls):
    provider = cls.__new__(cls)
    provider.tokenizer = Tokenizer()
    provider._np = provider._torch = FakeNumeric()
    provider._inp, provider._att = 'ids', 'mask'
    provider.inputs = []

    def capture(inputs):
        provider.inputs = inputs.rows
        raise Captured()

    class Session:
        def run(self, _, inputs):
            capture(inputs['ids'])

    provider.session = Session()
    provider.model = lambda **inputs: capture(inputs['input_ids'])
    return provider


class AuditPythonDelivery(unittest.TestCase):
    def test_recall_rank_envelope_rejection_keeps_worker_alive(self):
        frame = {'protocolVersion': semantic.base.PROTOCOL, 'frameId': 'f',
                 'requestId': 'r', 'workerEpoch': 'fixture', 'type': 'recall_rank',
                 'payload': {}, 'sentAt': 0}
        bad = []
        for key in ('protocolVersion', 'frameId', 'requestId', 'workerEpoch', 'payload', 'sentAt'):
            copy = dict(frame)
            del copy[key]
            bad.append(copy)
        bad.extend([dict(frame, sentAt=True), dict(frame, payload=[]),
                    dict(frame, workerEpoch=3), dict(frame, frameId='')])
        health = dict(frame, requestId='health', type='health')
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, DSH_HOME=tmp, DSH_M7_EMBEDDING_CONFIG='')
            result = subprocess.run([sys.executable, str(ROOT / 'python/worker_semantic_v1.py'),
                                     '--expect-epoch', 'fixture', '--dsh-home', tmp],
                                    input='\n'.join(json.dumps(f) for f in bad + [frame, health]) + '\n',
                                    text=True, capture_output=True, env=env, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        frames = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(frames), len(bad) + 2)
        for output in frames[:len(bad)]:
            self.assertEqual(output['type'], 'error')
            self.assertEqual(output['payload']['code'], 'invalid-envelope')
        self.assertEqual(frames[-2]['type'], 'recall_rank_result')
        self.assertEqual(frames[-1]['type'], 'health_result')

    def test_real_provider_inputs_wrap_once_and_preserve_corpus_tokens(self):
        text = ' '.join('token' for _ in range(512))
        for cls in (emb.BgeM3Embedder, emb.BgeM3OnnxInt8Embedder):
            with self.subTest(provider=cls.provider), tempfile.TemporaryDirectory() as tmp:
                provider = provider_fixture(cls)
                with self.assertRaises(Captured):
                    provider.encode_ids([list(range(10, 520))])
                self.assertEqual(provider.inputs[0], [0] + list(range(10, 520)) + [2])
                self.assertEqual(len(provider.inputs[0]), 512)
                actual_encode = provider.encode_ids

                def encode(items):
                    with self.assertRaises(Captured):
                        actual_encode(items)
                    return [[1.0, 0.0] for _ in items]

                provider.encode_ids = encode
                worker = semantic.SemanticWorker('fixture', tmp, {})
                worker.embedder = provider
                worker.embedding_config = {'provider': cls.provider, 'dimension': 2, 'modelRevision': 'fixture'}
                key = ('wsr_fixture', 'Workspace')
                record = dict(memoryId='mem_' + 'a' * 32, recordDigest='a' * 64,
                              anchorId='anchor', scope=key[1], workspaceRef=key[0],
                              sourceRef='workspace:notes.md', sourceEpoch='e', sourceVersion='v',
                              fileDigest='f', text=text)
                worker.derived[key] = {'records': [record], 'memoryIndexVersion': 'idx_fixture'}
                persisted, count = worker.build_vectors(*key)
                self.assertTrue(persisted)
                self.assertEqual(count, 2)  # 510 body tokens + 2 in the next chunk
                rows = provider.inputs
                bodies = []
                for row in rows:
                    self.assertEqual(row[0], 0)
                    end = row.index(2)
                    self.assertNotIn(0, row[1:end])
                    bodies.extend(row[1:end])
                self.assertEqual(bodies, list(range(10, 522)))
                provider.encode_query('one two')
                self.assertEqual(provider.inputs[0], [0, 10, 11, 2])

                # Reconstruct the old config fingerprint, then replay actual loader.
                original = json.loads(emb.canonical({
                    'provider': cls.provider, 'model': 'bge-m3' if cls.provider == emb.PROVIDER_REAL else cls.provider,
                    'modelRevision': 'fixture', 'dimension': 2, 'normalization': 'l2_normalize',
                    'dtype': 'float32', 'chunkPolicyVersion': emb.CHUNK_POLICY_VERSION,
                    'chunkParams': {'maxTokens': 512, 'paraAligned': True, 'overlap': 0}, 'queryMaxTokens': 256}))
                old_hash = 'cfgh_' + hashlib.sha256(emb.canonical(original).encode()).hexdigest()
                vectors_file = next(Path(tmp, 'memory/semantic').glob('vectors-*.json'))
                payload = json.loads(vectors_file.read_text(encoding='utf-8'))
                self.assertNotEqual(payload['identity']['configHash'], old_hash)
                source = Path(tmp, 'source-memory.md')
                source.write_text('unchanged source', encoding='utf-8')
                payload['identity']['configHash'] = old_hash
                vectors_file.write_text(json.dumps(payload), encoding='utf-8')
                worker._load_vectors_from_disk()
                self.assertTrue(worker.vectors[key]['stale'])
                self.assertEqual(source.read_text(encoding='utf-8'), 'unchanged source')
                worker.build_vectors(*key)
                worker._load_vectors_from_disk()
                self.assertFalse(worker.vectors[key]['stale'])


if __name__ == '__main__':
    unittest.main()
