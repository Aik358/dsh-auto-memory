#!/usr/bin/env node
/**
 * smoke-test-a01-python-cache-expiry.mjs —— #422 守卫套件（Python 健康缓存过期后不自愈）。
 *
 * 缺陷（改前实测）：
 *   ① lib/index.js 的 pythonRuntimeCached 在 TTL 到期时**只 return null**，不摘 _pyRtCache
 *      也不归零 _pyRtCacheAt ⇒ 过期对象永久占位；
 *   ② 发布守卫见「缓存里有 worker 而本次结果没有 worker」就**整条不发布**（连 TTL 都不刷）
 *      ⇒ interpreterOnly 探测产出的结果永远发布不进去 ⇒ preparePythonRecallPre 的
 *      current === runtime 恒不成立 ⇒ **每次显式召回都探测、每次都失败，且不会自愈**。
 *
 * 验收方式：照 issue414-416 的既有范式，用 vm 从 lib/index.js **抽真实源码片段**执行
 * （pythonRuntimeCached / probePythonRuntime / preparePythonRecallPre），全部断言对着返回值与
 * engine 状态；不含任何「源码含某字符串」式断言。
 */
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { readEffectiveEmbeddingConfigPre } from '../../lib/embedding-config.js'

let pass = 0, fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (x == null ? '' : ' << ' + x)) } }
const eq = (a, b, n) => ok(a === b, n, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))

const home = fs.mkdtempSync(path.join(tmpdir(), 'dam-a01-'))
try {
  const cfg = path.join(home, 'memory', 'semantic', 'embedding-config.json')
  const modelDir = path.join(home, 'model-dir')
  fs.mkdirSync(path.dirname(cfg), { recursive: true }); fs.mkdirSync(modelDir)
  fs.writeFileSync(path.join(modelDir, 'm.onnx'), 'fixture-model')
  fs.writeFileSync(cfg, JSON.stringify({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir, onnxFile: 'm.onnx', dimension: 1024 }))

  const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const probeStart = source.indexOf('  engine.probePythonRuntime = async (optsRt = {}) => {')
  const probeEnd = source.indexOf('  /** 只读缓存版', probeStart)
  const cachedStart = source.indexOf('  engine.pythonRuntimeCached = () => {')
  // ★2026-10-19 判据更新：原锚点是紧邻的 JSDoc 首行「解析最终要用的解释器命令」，
  //   而该注释上方新增了 P0 归因段（裸 python 兜底的成因），首行已不再是原文。
  //   锚点改为**定义行本身**（定义不该被搬走），并保留 prepStart 作为上界保险。
  const cachedEnd = source.indexOf('  engine.resolvedPythonCommand = () => {', cachedStart)
  // ★2026-10-19 判据更新（名额预算从字面量 8000 改为常量 PY_RECALL_PROBE_BUDGET_MS）：
  //   锚点改数字面量会让「预算被有意上调」误判成锚点失效。这里匹配签名骨架，常量值另断言。
  const prepStart = source.indexOf('  engine.preparePythonRecallPre = async (timeoutMs = ')
  const prepEnd = source.indexOf('  /**', prepStart)
  if (probeStart < 0 || probeEnd < 0 || cachedStart < 0 || cachedEnd < 0 || prepStart < 0 || prepEnd < 0) {
    console.error('FATAL: 源码锚点未命中（判据需随实现演进复核）'); process.exit(2)
  }

  let healthCalls = 0
  let healthImpl = async () => { healthCalls++; return { tried: true, healthSeen: true, ready: true } }
  const engine = {
    config: { pythonBackendExecutable: 'fixture-python', pythonBackendWorkerPath: '' },
    _pyRtCacheAt: 0, _pyRtGeneration: 0, _pyHealthProbes: new Set(), _pyRtCache: null, _pyWorkerVerdict: null,
    _probeWorkerHealthOnce: (...a) => healthImpl(...a),
    invalidatePythonRuntime(reason) { this._pyRtGeneration++; this._pyRtCache = null; this._pyWorkerVerdict = null; void reason },
  }
  const env = {
    engine, Date, Map, JSON, String, Number, Object, Promise, Set, Array, Boolean,
    readEffectiveEmbeddingConfigPre,
    existsSync: fs.existsSync,
    pluginRootDir: () => '/fixture/plugin',
    resolveDshHomePre: () => home,
    path,
    buildPythonCandidatesPre: () => [],
    resolvePythonInterpreterPre: async () => ({ chosen: 'fixture-python', probed: [], chosenIsDev: false }),
    setTimeout, clearTimeout,
  }
  vm.createContext(env)
  vm.runInContext(source.slice(probeStart, probeEnd), env)
  vm.runInContext(source.slice(cachedStart, cachedEnd), env)
  vm.runInContext(source.slice(prepStart, prepEnd), env)

  console.log('[A01-1] 正路径：缓存到期必须主动摘除，且下一次探测能重新发布')
  {
    const full = await engine.probePythonRuntime({ withWorker: true, refresh: true })
    ok(full.state === 'verified-ok', 'A01-1a 完整探测得 verified-ok（实=' + full.state + '）')
    ok(!!engine._pyRtCache && !!engine._pyRtCache.worker, 'A01-1b 缓存里有 worker 判定')
    const cacheRef = engine._pyRtCache
    engine._pyRtCacheAt = Date.now() - 60001
    const c = engine.pythonRuntimeCached()
    eq(c, null, 'A01-1c 过期缓存读不到（既有语义守恒：仍返回 null）')
    eq(engine._pyRtCache, null, 'A01-1d ★★ 过期对象被**摘除**（改前原地占位）')
    eq(engine._pyRtCacheAt, 0, 'A01-1e ★ 时间戳归零（改前不动）')
    ok(cacheRef !== engine._pyRtCache, 'A01-1f 确实换成了 null 而不是同一对象')
    const weak = await engine.probePythonRuntime({ interpreterOnly: true })
    ok(!!engine._pyRtCache && engine._pyRtCache === weak, 'A01-1g ★★ interpreterOnly 结果成功发布（改前被守卫整条拒绝 → 只留下残留旧对象）')
    // interpreterOnly 允许合并**新鲜**的 worker 判定（既有语义，正确）；关键是它必须来自
    //   _pyWorkerVerdict.res（同一引用），而不是从残留缓存里「继承」来的——这正是改前的病症。
    ok(!engine._pyRtCache.worker || (engine._pyWorkerVerdict && engine._pyRtCache.worker === engine._pyWorkerVerdict.res), 'A01-1h ★ worker 判定只能来自新鲜 verdict（同一引用），不得从残留缓存继承')
    eq(engine._pyRtCache, weak, 'A01-1h2 发布对象 === 返回对象（身份守恒，preparePythonRecallPre 依赖 ===）')
    ok(engine._pyRtCacheAt > 0, 'A01-1i ★ TTL 被无条件刷新（改前分文不动）')
  }

  console.log('[A01-2] 负路径①：**过期的** worker 结论不得再挡新结果')
  {
    engine._pyRtCacheAt = Date.now() - 60001
    engine.pythonRuntimeCached()
    engine._pyWorkerVerdict = { at: Date.now() - 600001, res: { tried: true, healthSeen: true, ready: true }, identity: undefined }
    const withWorker = await engine.probePythonRuntime({ withWorker: true, refresh: true })
    ok(!!engine._pyRtCache && !!engine._pyRtCache.worker, 'A01-2a 前提：缓存里现在有 worker（实=' + JSON.stringify(engine._pyRtCache && !!engine._pyRtCache.worker) + '）')
    if (engine._pyWorkerVerdict) engine._pyWorkerVerdict.at = Date.now() - 600001
    else engine._pyWorkerVerdict = { at: Date.now() - 600001, res: withWorker.worker, identity: engine._pyRtCache.identity }
    const weak = await engine.probePythonRuntime({ interpreterOnly: true, refresh: true })
    ok(!!engine._pyRtCache && engine._pyRtCache === weak, 'A01-2b ★ 弱档结果仍能发布（改前只留下残留旧对象）')
    eq(engine._pyRtCache.worker || null, null, 'A01-2c ★★ 过期 worker 结论**未被沿用**（新结果里没有 worker）')
    ok(weak && weak.worker == null, 'A01-2d 返回体同样无 worker（口径一致）')
  }

  console.log('[A01-3] 负路径①b：**新鲜的** worker 结论（<10min）仍优先')
  {
    engine._pyRtCache = null; engine._pyRtCacheAt = 0
    engine._pyWorkerVerdict = { at: Date.now(), res: { tried: true, healthSeen: true, ready: true, provider: 'fresh' }, identity: undefined }
    const strong = await engine.probePythonRuntime({ withWorker: true, refresh: true })
    ok(!!engine._pyRtCache.worker, 'A01-3a 前提：缓存里有 worker')
    const curIdentity = engine._pyRtCache.identity
    engine._pyWorkerVerdict = { at: Date.now(), res: { tried: true, healthSeen: true, ready: true, provider: 'fresh' }, identity: curIdentity }
    const weak = await engine.probePythonRuntime({ interpreterOnly: true, refresh: true })
    ok(!!engine._pyRtCache && !!engine._pyRtCache.worker, 'A01-3b ★★ 新鲜 worker 判定被保留（弱档不抹掉 verified-ok）')
    ok(engine._pyRtCache === weak, 'A01-3c 身份守恒：发布对象 === 返回对象')
    ok(!!strong, 'A01-3d 对照夹具自检')
  }

  console.log('[A01-4] 负路径②：identity 变化仍必须 invalidate（既有语义守恒）')
  {
    const genBefore = engine._pyRtGeneration
    fs.writeFileSync(cfg, JSON.stringify({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir, onnxFile: 'm.onnx', dimension: 512 }))
    const changed = await engine.probePythonRuntime({ withWorker: true, refresh: true })
    ok(engine._pyRtGeneration > genBefore, 'A01-4a identity 变化 ⇒ generation 前进（invalidate 触发）')
    ok(!!engine._pyRtCache, 'A01-4b 新代仍能发布')
    eq(engine._pyRtCache.identity, changed.identity, 'A01-4c 发布的是新身份的结果')
  }

  console.log('[A01-5] 负路径③：preparePythonRecallPre 在「缓存过期 + 解释器可用」时返回 true')
  {
    engine._pyRtCache = null; engine._pyRtCacheAt = 0
    const weak = await engine.probePythonRuntime({ interpreterOnly: true, refresh: true })
    ok(weak.usable === true, 'A01-5a 前提：弱档结果 usable（state=' + weak.state + '）')
    engine._pyRtCacheAt = Date.now() - 60001
    const prep = await engine.preparePythonRecallPre(8000)
    eq(prep, true, 'A01-5b ★★ preparePythonRecallPre 返回 true（改前恒 false）')
    ok(!!engine._pyRtCache, 'A01-5c 探测结果已发布（current === runtime 成立）')
    ok(engine._pyRtCacheAt > 0 && Date.now() - engine._pyRtCacheAt < 60000, 'A01-5d 发布时间戳新鲜（不是残留旧 TTL）')
  }

  console.log('[A01-6] 负路径④：探测被更大代际作废时仍不得发布（既有 fail-closed 守恒）')
  {
    engine._pyRtCache = null; engine._pyRtCacheAt = 0
    let resolveProbe
    env.resolvePythonInterpreterPre = () => new Promise((r) => { resolveProbe = r })
    const pending = engine.probePythonRuntime({ interpreterOnly: true, refresh: true })
    await new Promise((r) => setTimeout(r, 10))
    engine._pyRtGeneration++
    resolveProbe({ chosen: 'fixture-python', probed: [] })
    const stale = await pending
    eq(stale.ok, false, 'A01-6a 换代后结果如实标记失败')
    eq(engine._pyRtCache, null, 'A01-6b ★ 换代期间的结果**不发布**（不被我的改动放松）')
    env.resolvePythonInterpreterPre = async () => ({ chosen: 'fixture-python', probed: [], chosenIsDev: false })
  }

  void healthCalls; void healthImpl
  console.log('\n[A01] ' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
} finally {
  try { fs.rmSync(home, { recursive: true, force: true }) } catch (_) {}
}
