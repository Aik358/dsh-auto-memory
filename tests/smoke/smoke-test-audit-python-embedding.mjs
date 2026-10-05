import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const pythonDir = fileURLToPath(new URL('../../python', import.meta.url))
const result = spawnSync('python', ['-c', `
import sys, types
sys.path.insert(0, ${JSON.stringify(pythonDir)})
# A tiny local array substitute records model inputs; no numpy/ORT/model install.
class Row(list):
    def tolist(self): return list(self)
class Matrix:
    def __init__(self, data): self.data = data
    def __len__(self): return len(self.data)
    def __iter__(self): return iter(Row(r) for r in self.data)
    def tolist(self): return self.data
    def __setitem__(self, key, value):
        r, columns = key
        self.data[r][columns] = value if isinstance(value, list) else [value] * len(self.data[r][columns])
    def astype(self, _): return self
    def __truediv__(self, other): return Matrix([[v / other.data[i][0] for v in r] for i,r in enumerate(self.data)])
class Hidden:
    def __init__(self, count): self.count = count
    def __getitem__(self, _): return Matrix([[1.,1.,1.,1.] for _ in range(self.count)])
np = types.SimpleNamespace(
    full=lambda shape,pad,**kw: Matrix([[pad]*shape[1] for _ in range(shape[0])]),
    zeros=lambda shape,**kw: Matrix([[0]*shape[1] for _ in range(shape[0])]),
    asarray=lambda ids,**kw: list(ids), int64='int64', float32='float32',
    maximum=lambda values,floor: Matrix([[max(r[0],floor)] for r in values.data]),
    linalg=types.SimpleNamespace(norm=lambda values,**kw: Matrix([[sum(v*v for v in r)**.5] for r in values.data])))
sys.modules['numpy'] = np
import m7_embedding_v1 as m
class Tokenizer:
    pad_token_id = 0
    eos_token_id = 102
    def __call__(self, text, add_special_tokens=False, **kw):
        ids = [ord(c) for c in text]
        return {'input_ids': [101] + ids + [102] if add_special_tokens else ids}
tok = Tokenizer()
calls = []
class Session:
    def __init__(self, file, providers): calls.append(providers); self.inputs = []
    def get_inputs(self): return [types.SimpleNamespace(name='ids'), types.SimpleNamespace(name='mask')]
    def run(self, _, feed):
        self.inputs.extend(feed['ids'].tolist())
        return [Hidden(len(feed['ids']))]
sys.modules['onnxruntime'] = types.SimpleNamespace(InferenceSession=Session)
sys.modules['transformers'] = types.SimpleNamespace(AutoTokenizer=types.SimpleNamespace(from_pretrained=lambda _: tok))
e = m.BgeM3OnnxInt8Embedder({'modelDir': 'isolated-fake-model', 'gpu': True, 'dimension': 4})
assert calls[-1] == ['CUDAExecutionProvider','CPUExecutionProvider']
cpu = m.BgeM3OnnxInt8Embedder({'modelDir': 'isolated-fake-model', 'gpu': False, 'dimension': 4})
assert calls[-1] == ['CPUExecutionProvider']
text = ''.join(chr(0x1000+i) for i in range(1532))
chunks = m.chunk_record_token_ids(tok, text)
assert max(map(len,chunks)) <= 510
body = [e.build_doc_ids(c) for c in chunks]
assert [i for c in body for i in c] == [ord(c) for c in text]
e.encode_ids(body, batch_size=1)
wrapped = e.session.inputs
assert all(x[0] == 101 and x[-1] == 102 and len(x) <= 512 for x in wrapped)
assert [i for x in wrapped for i in x[1:-1]] == [ord(c) for c in text]
fp = m.BgeM3Embedder.__new__(m.BgeM3Embedder); fp.tokenizer = tok
assert fp.build_doc_ids(chunks[0]) == chunks[0]
assert m.CHUNK_POLICY_VERSION == 'm7_chunk_pre_v2'
print('PASS F26/F27: complete document payload, one special wrapper, CPU/GPU provider selection')
`], { encoding: 'utf8', timeout: 10000 })
assert.equal(result.status, 0, result.stderr || result.stdout)
console.log(result.stdout.trim())
