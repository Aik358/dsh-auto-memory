// M8-1 C2 内置语义接线验证(离线;docs/M7-CLOSED-LOOP-WIRING.md §2)
// F1 fuseD6Pre 纯函数(归一/缺臂/平局确定性)
// E1-E3 引擎宿主:注入 embedder 的排名+miv 缓存+失败回退 null
// D1-D4 下载器:双源自动回退/SHA256 失败→error/单飞行/取消
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SEM = await import('../../lib/semantic-js.js')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- F1 融合纯函数 ----------
console.log('[F1] fuseD6Pre')
{
  const r = SEM.fuseD6Pre([
    { memoryId: 'a', dense: 0.9, lex: 0.1 },
    { memoryId: 'b', dense: 0.5, lex: 0.8 },
    { memoryId: 'c', dense: null, lex: 0.8 },
  ])
  // dense 臂 minmax:a=1,b=0,c=0(missing);lex 臂:a=0,b=1,c=1
  ok(r[0].memoryId === 'a' && Math.abs(r[0].fused - 0.7) < 1e-9, 'dense-dominant top1 fused=0.7')
  const b = r.find((x) => x.memoryId === 'b')
  const c = r.find((x) => x.memoryId === 'c')
  ok(b && c && b.fused === c.fused && b.memoryId < c.memoryId, 'tie broken by memoryId asc')
  const flat = SEM.fuseD6Pre([{ memoryId: 'x', dense: 0.5, lex: 0.2 }, { memoryId: 'y', dense: 0.5, lex: 0.9 }])
  ok(flat[0].memoryId === 'y' && flat[1].denseN === 0.5, 'flat arm → 0.5 for present values')
  ok(SEM.fuseD6Pre(null).length === 0, 'null input → empty (fail closed)')
}

// ---------- E 引擎宿主(注入 embedder) ----------
console.log('[E] js semantic engine (injected embedder)')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm81-'))
  const vec = (amber, lunch) => Float32Array.from([amber, lunch])
  const embedOf = (t) => (/琥珀|协议/.test(t) ? vec(1, 0) : /面条/.test(t) ? vec(0, 1) : vec(0.2, 0.2))
  let passageCalls = 0
  let queryCalls = 0
  const eng = SEM.createJsSemanticEnginePre({
    pluginDir: home,
    injectEmbedder: {
      model: 'fake/q8',
      async embedQuery(t) { queryCalls++; return embedOf(t) },
      async embedPassages(texts) { passageCalls++; return texts.map(embedOf) },
    },
  })
  const miv = 'idx_' + createHash('sha256').update('m81').digest('hex').slice(0, 32)
  const records = [
    { memoryId: 'mem_aaaa', text: '采用琥珀协议作为模块间通信格式的决策记录' },
    { memoryId: 'mem_bbbb', text: '今天中午吃了面条' },
    { memoryId: 'mem_cccc', text: '无关内容第三条' },
  ]
  const st0 = eng.status()
  ok(st0.ready === false && st0.assetPresent === false, 'initial status not ready (no asset)')
  const r1 = await eng.rank({ memoryIndexVersion: miv, records }, '之前关于琥珀协议的决策是什么？')
  ok(r1 && r1.scores.get('mem_aaaa') > r1.scores.get('mem_bbbb'), 'dense ranking: amber doc wins for amber query')
  const callsAfterFirst = passageCalls
  await eng.rank({ memoryIndexVersion: miv, records }, '再问一次琥珀协议')
  ok(passageCalls === callsAfterFirst && queryCalls === 2, 'miv cache: no re-embed on same index version (only new query embed)')
  const st1 = eng.status()
  ok(st1.ready === true && st1.model === 'fake/q8' && st1.indexedRecords === 3, 'status reflects ready + indexed count')
  const bad = await eng.rank({ memoryIndexVersion: 'not-a-miv', records }, '任意')
  ok(bad === null, 'invalid miv → null (fail closed)')
  const boom = SEM.createJsSemanticEnginePre({
    pluginDir: home,
    injectEmbedder: { model: 'boom', async embedQuery() { throw new Error('embed-exploded') }, async embedPassages() { return [] } },
  })
  const rBoom = await boom.rank({ memoryIndexVersion: miv, records }, '琥珀')
  ok(rBoom === null && boom.status().lastRankError.includes('embed-exploded'), 'embedder failure → rank null + lastRankError recorded (caller falls back to lexical)')
  rmSync(home, { recursive: true, force: true })
}

// ---------- D 下载器 ----------
console.log('[D] semantic downloader (stub fetch)')
{
  const sha = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex')
  const manifest = {
    model: 'tiny-model', dtype: 'q8',
    files: [
      { rel: 'tiny-model/a.txt', bytes: 11, sha256: sha('hello world') },
      { rel: 'tiny-model/b.txt', bytes: 5, sha256: sha('nihao') },
    ],
  }
  manifest.totalBytes = manifest.files.reduce((s, f) => s + f.bytes, 0)
  const home = mkdtempSync(path.join(tmpdir(), 'm81dl-'))
  const modelsRoot = path.join(home, 'models')
  const CONTENT_A_CN = 'hello world'           // cn 源 a 正确
  const CONTENT_B_INTL = 'nihao'               // intl 源 b 正确
  function makeFetch(gates) {
    return async (url) => {
      const isCn = url.includes('hf-mirror')
      const file = url.endsWith('a.txt') ? 'a' : 'b'
      if (gates.block && gates.block(file, isCn)) return new Promise(() => {})
      if (file === 'a') {
        if (isCn) return resp(200, CONTENT_A_CN)
        return resp(404, 'nf')
      }
      if (isCn) throw new Error('network-unreachable-cn-b')
      return resp(200, CONTENT_B_INTL)
    }
  }
  function resp(status, text) {
    const body = Buffer.from(text)
    return {
      ok: status === 200, status,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? String(body.length) : null) },
      body: { getReader: () => { let done = false; return { read: async () => { if (done) return { done: true }; done = true; return { done: false, value: body } } } } },
    }
  }

  // D1 双源自动回退:auto 顺序 [cn,intl];a 来自 cn,b 回退 intl
  const d1 = SEM.createSemanticDownloaderPre({ modelsRoot, manifest, fetchImpl: makeFetch({}) })
  ok(d1.start('nope').ok === false && d1.start('nope').reason === 'bad-mirror', 'bad mirror rejected (fail closed)')
  ok(d1.start('auto').ok === true, 'start(auto) accepted')
  await waitFor(() => ['done', 'error', 'cancelled'].includes(d1.state().phase), 4000)
  const s1 = d1.state()
  ok(s1.phase === 'done', 'auto fallback completes (got phase=' + s1.phase + ' err=' + s1.error + ')')
  ok(s1.mirrorUsed === 'intl' || s1.mirrorUsed === 'cn', 'mirrorUsed recorded (' + s1.mirrorUsed + ')')
  ok(readFileSync(path.join(modelsRoot, 'tiny-model/a.txt'), 'utf8') === 'hello world', 'file A landed with verified content')
  ok(readFileSync(path.join(modelsRoot, 'tiny-model/b.txt'), 'utf8') === 'nihao', 'file B landed with verified content')

  // D2 SHA256 不匹配(两源都坏)→ error 且错误含 sha256
  const badManifest = { model: 'tiny-model', dtype: 'q8', files: [{ rel: 'tiny-model/c.txt', bytes: 3, sha256: sha('right') }], totalBytes: 3 }
  const d2 = SEM.createSemanticDownloaderPre({
    modelsRoot: path.join(home, 'models2'), manifest: badManifest,
    fetchImpl: async () => resp(200, 'bad'),
  })
  d2.start('auto')
  await waitFor(() => d2.state().phase === 'error', 3000)
  ok(d2.state().phase === 'error' && d2.state().error.includes('sha256-mismatch'), 'corrupt payload → error with sha256 reason')

  // D3 单飞行:运行中再次 start 被拒
  const releaseA = defer()
  const gatedFetch = async (url) => {
    if (url.endsWith('a.txt')) { await releaseA.promise; return resp(200, 'hello world') }
    return resp(200, 'nihao')
  }
  const d3 = SEM.createSemanticDownloaderPre({ modelsRoot: path.join(home, 'models3'), manifest, fetchImpl: gatedFetch })
  d3.start('auto')
  await sleep(120)
  ok(d3.state().phase === 'downloading', 'download in progress')
  ok(d3.start('auto').ok === false && d3.start('auto').reason === 'already-running', 'second start rejected while running')

  // D4 取消:挂起的文件在恢复后触发 cancelled
  d3.cancel()
  releaseA.resolve()
  await waitFor(() => d3.state().phase !== 'downloading', 3000)
  ok(d3.state().phase === 'cancelled', 'cancel leads to cancelled phase (got ' + d3.state().phase + ')')

  // 清单完整性:总字节数与逐项和一致(冻结清单自检)
  ok(SEM.E5_SMALL_Q8_MANIFEST_V1.totalBytes === SEM.E5_SMALL_Q8_MANIFEST_V1.files.reduce((s, f) => s + f.bytes, 0), 'real manifest totalBytes consistent')
  rmSync(home, { recursive: true, force: true })
}

function waitFor(pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (pred()) { clearInterval(iv); resolve() } else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error('waitFor-timeout')) }
    }, 60)
  })
}
function defer() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve: () => resolve() } }

console.log(`[M81] pass=${pass} fail=${fail}`)
process.exit(fail > 0 ? 1 : 0)
