// Offline integrity regressions: mock fetch, real temporary files, no Python/model
// installation. Sparse ONNX fixtures exercise the declared size without downloading it.
import assert from 'node:assert/strict'
import { mkdtemp, cp, readFile, writeFile, mkdir, rm, stat, open, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = await mkdtemp(path.join(tmpdir(), 'dam-audit-integrity-'))
const realFetch = globalThis.fetch
let passed = 0, failed = 0, seq = 0
async function check(name, run) {
  try { await run(); passed++; console.log('ok - ' + name) }
  catch (error) { failed++; console.error('FAIL - ' + name + '\n' + error.stack) }
  finally { globalThis.fetch = realFetch }
}
const exists = async (file) => { try { await access(file); return true } catch { return false } }
function response(text, status = 200, range) {
  return new Response(text, { status, headers: { 'content-length': String(Buffer.byteLength(text)), ...(range ? { 'content-range': range } : {}) } })
}
async function partial(target, url, size) {
  await mkdir(path.dirname(target), { recursive: true })
  const file = await open(target + '.part', 'w'); await file.truncate(size); await file.close()
  await writeFile(target + '.part.meta.json', JSON.stringify({ url, bytes: size }))
}
try {
  await cp(path.join(root, 'lib'), path.join(temp, 'lib'), { recursive: true })
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}')
  const entry = path.join(temp, 'lib/python-setup.js')
  let source = await readFile(entry, 'utf8')
  const anchor = 'return { detect, ensureVenv, ensureDeps, downloadModel, cancelDownload, status, engineRoot, venvPython, modelPath }'
  assert.equal(source.split(anchor).length, 2)
  // Expose existing closures in the temporary copy only; production exports stay intact.
  source = source.replace(anchor, anchor.replace('return {', 'return { auditDownload: downloadWithResume, auditVerify: verifyArtifact, auditRename: writeFileSyncSafe,'))
  await writeFile(entry, source)
  const { createPythonSetupPre } = await import(pathToFileURL(entry).href)
  const setup = () => createPythonSetupPre({ dshHome: path.join(temp, 'case-' + (++seq)) })
  const cn = 'https://hf-mirror.com/Xenova/bge-m3/resolve/main/onnx/model_int8.onnx'
  const MODEL_BYTES = 568456694

  await check('public model download rejects a 100 MiB truncated model and preserves its predecessor', async () => {
    const api = setup(), target = api.modelPath(), truncated = 100 * 1024 * 1024 + 1
    await partial(target, cn, truncated - 1); await writeFile(target, 'known-good-predecessor')
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('.onnx')) return options.headers.Range
        ? response('x', 206, `bytes ${truncated - 1}-${truncated - 1}/${truncated}`) : response('x')
      return response(String(url).endsWith('.json') ? '{}' : 'tokenizer')
    }
    const result = await api.downloadModel()
    assert.equal(result.phase, 'error')
    assert.notEqual(result.modelReady, true)
    assert.equal(await readFile(target, 'utf8'), 'known-good-predecessor')
    assert.equal(await exists(target + '.part'), false)
  })
  await check('declared-size model plus valid tokenizer files completes offline', async () => {
    const api = setup(), target = api.modelPath()
    await partial(target, cn, MODEL_BYTES - 1)
    globalThis.fetch = async (url) => String(url).endsWith('.onnx')
      ? response('x', 206, `bytes ${MODEL_BYTES - 1}-${MODEL_BYTES - 1}/${MODEL_BYTES}`)
      : response(String(url).endsWith('.json') ? '{}' : 'tokenizer')
    const result = await api.downloadModel()
    assert.equal(result.phase, 'ready'); assert.equal(result.configOk, true)
    assert.equal((await stat(target)).size, MODEL_BYTES)
    assert.equal(await exists(target + '.part'), false)
  })
  await check('invalid tokenizer JSON is rejected before it replaces a valid file', async () => {
    const api = setup(), dir = path.join(temp, 'invalid-json'); await mkdir(dir)
    const target = path.join(dir, 'tokenizer.json'); await writeFile(target, '{"valid":true}')
    globalThis.fetch = async () => response('<html>mirror error</html>')
    await assert.rejects(api.auditDownload('https://example.test/tokenizer', target, () => {}, () => false, { kind: 'json', minBytes: 1 }), /JSON/)
    assert.equal(await readFile(target, 'utf8'), '{"valid":true}')
    assert.equal(await exists(target + '.part'), false)
  })
  await check('public tokenizer download actually uses the integrity gate', async () => {
    const api = setup(), target = api.modelPath()
    await partial(target, cn, MODEL_BYTES - 1)
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('.onnx')) return options.headers.Range
        ? response('x', 206, `bytes ${MODEL_BYTES - 1}-${MODEL_BYTES - 1}/${MODEL_BYTES}`) : response('x')
      return response('<html>not JSON</html>')
    }
    const result = await api.downloadModel()
    assert.equal(result.phase, 'error')
    assert.equal(await exists(path.join(path.dirname(target), 'config.json')), false)
  })
  await check('SHA256 verification reads the actual file and rejects corruption', async () => {
    const api = setup(), file = path.join(temp, 'hash.bin'); await writeFile(file, 'hello')
    const hash = createHash('sha256').update('hello').digest('hex')
    assert.equal(await api.auditVerify(file, { bytes: 5, sha256: hash }), 'sha256')
    await writeFile(file, 'jello')
    await assert.rejects(api.auditVerify(file, { bytes: 5, sha256: hash }), /sha256/)
  })
  await check('empty binary artifacts are rejected before publication', async () => {
    const api = setup(), target = path.join(temp, 'empty.bin')
    globalThis.fetch = async () => response('')
    await assert.rejects(api.auditDownload('https://example.test/empty', target, () => {}, () => false, { minBytes: 1 }), /下载不完整/)
    assert.equal(await exists(target), false)
  })
  await check('failed atomic promotion leaves the existing target intact', async () => {
    const api = setup(), target = path.join(temp, 'old.bin'); await writeFile(target, 'old')
    await assert.rejects(api.auditRename(path.join(temp, 'missing.part'), target))
    assert.equal(await readFile(target, 'utf8'), 'old')
  })
  await check('a mismatched Content-Range is never appended to a resumable prefix', async () => {
    const api = setup(), target = path.join(temp, 'range.bin'), url = 'https://example.test/range'
    await partial(target, url, 4); await writeFile(target, 'old')
    globalThis.fetch = async () => response('ab', 206, 'bytes 0-1/6')
    await assert.rejects(api.auditDownload(url, target, () => {}, () => false, { bytes: 6 }), /Range/)
    assert.equal(await readFile(target, 'utf8'), 'old')
    assert.equal(await exists(target + '.part'), false)
  })
  await check('a valid resume appends exactly once and removes its metadata', async () => {
    const api = setup(), target = path.join(temp, 'resume.bin'), url = 'https://example.test/resume'
    await partial(target, url, 4); await writeFile(target + '.part', 'abcd')
    globalThis.fetch = async (_, options) => { assert.equal(options.headers.Range, 'bytes=4-'); return response('ef', 206, 'bytes 4-5/6') }
    await api.auditDownload(url, target, () => {}, () => false, { bytes: 6 })
    assert.equal(await readFile(target, 'utf8'), 'abcdef')
    assert.equal(await exists(target + '.part.meta.json'), false)
  })
} finally { globalThis.fetch = realFetch; await rm(temp, { recursive: true, force: true }) }
console.log(`\n[audit-download-integrity] ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
