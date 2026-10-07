/**
 * smoke-test-la-audit-fixes —— L-A 车道（lib/index.js 线）行为级验收套件（2026-10-07）。
 *
 * 覆盖：#253 RL-03 / #257 SEC-01 / #258 SEC-02 / #260 OBS-01 / #264 OCR-02 / #269，
 * 外加 L-B 接线（#250 C03 的 pendingSnapshot 合并读必须有真实调用点）。
 *
 * 判据纪律（"能失败"）：每组都走 **真 import → 真构造 → 真调用 → 断言副作用**，
 * 并配**真变异负路径** —— 把产线源码按目标语义改坏（去掉守卫/恢复旧写法）后重新 import，
 * 断言缺陷必然复现。变异通过 data: URL 载入（相对 import 重写为绝对 file: URL），
 * **不落盘、不改产线文件**。
 *
 * 纯 Node、零依赖、不联网。
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
let pass = 0
let fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const eq = (a, b, name) => { const ja = JSON.stringify(a); const jb = JSON.stringify(b); ok(ja === jb, name + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }

const tmps = []
const mkroot = (tag) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-la-' + tag + '-')); tmps.push(d); return d }

/** 把某个产线模块以 data: URL 载入，并可选地做**定点变异**（每处必须恰命中 1 次）。 */
async function importModule(rel, replace = [], exportSuffix = '') {
  const abs = path.join(ROOT, rel)
  let src = readFileSync(abs, 'utf8')
  for (const [from, to] of replace) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 60)) + ' hits=' + hits)
    src = src.replace(from, to)
  }
  const base = pathToFileURL(abs).href
  src = src.replace(/from '([^']+)'/g, (m, spec) => spec.startsWith('.') ? "from " + JSON.stringify(new URL(spec, base).href) : m)
  const url = 'data:text/javascript;base64,' + Buffer.from(src + exportSuffix, 'utf8').toString('base64')
  return await import(url)
}

let shimSeq = 0
/** 载入产线引擎；mutations 为空即未变异（同一份源码，只多暴露内部符号）。 */
async function loadEngine(mutations = [], sourceOverride = '') {
  if (sourceOverride) process.env.DAM_AUDIT_ENGINE_SOURCE = sourceOverride
  else delete process.env.DAM_AUDIT_ENGINE_SOURCE
  const shim = path.join(ROOT, 'tests', 'lib', 'audit-engine.mjs')
  const abs = path.join(ROOT, 'lib', 'index.js')
  if (!mutations.length) return await import(pathToFileURL(shim).href + '?v=' + (++shimSeq))
  // 变异：写到临时文件，由 shim 的 DAM_AUDIT_ENGINE_SOURCE 接缝读入（相对 import 仍解析到真 lib/）。
  let src = readFileSync(abs, 'utf8')
  for (const [from, to] of mutations) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'engine mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 60)) + ' hits=' + hits)
    src = src.replace(from, to)
  }
  const f = path.join(mkroot('mut'), 'index-mutant-' + (++shimSeq) + '.mjs')
  writeFileSync(f, src, 'utf8')
  process.env.DAM_AUDIT_ENGINE_SOURCE = f
  const m = await import(pathToFileURL(shim).href + '?v=' + (++shimSeq))
  delete process.env.DAM_AUDIT_ENGINE_SOURCE
  return m
}

/** 最小宿主 ctx：apply() 只需这几个注册口（与既有套件同款）。 */
function fakeCtx(effects = []) {
  return {
    get: () => undefined,
    on() {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: () => () => {} },
    webServer: { register: () => () => {} },
    effect: (fn) => { const c = fn(); if (typeof c === 'function') effects.push(c) },
  }
}
function withIsolatedEnv(root) {
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = root }
  return () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}

console.log('[A] #260 OBS-01：诊断日志必须**每次**越限都轮转（旧写法首次之后永久跳过）')
{
  const root = mkroot('diag')
  const restoreEnv = withIsolatedEnv(root)
  const cap = 2 * 1024 * 1024
  try {
    const first = await loadEngine()
    const logFile = path.join(root, 'dsh-auto-memory-diagnose.log')
    writeFileSync(logFile, Buffer.alloc(cap + 1, 65))
    first.diag('first rotation')
    await first.flushDiagnostics()
    ok(statSync(logFile + '.1').size === cap + 1, '第 1 次轮转：越限即改名到 .1（实 ' + statSync(logFile + '.1').size + ' B）')
    for (let i = 0; i < 2400; i++) first.diag('second rotation ' + 'B'.repeat(1000))
    await first.flushDiagnostics()
    ok(statSync(logFile).size <= cap, '第 2 次越限仍轮转：当前文件回到 ≤ 上限（实 ' + statSync(logFile).size + ' B）')
    ok(readFileSync(logFile + '.1', 'utf8').includes('second rotation'), '轮转内容真的落到 .1（不是空转）')
    eq(readdirSync(root).sort(), ['dsh-auto-memory-diagnose.log', 'dsh-auto-memory-diagnose.log.1'], '只保留当前 + 1 份历史（不无限增长）')

    // 负路径：把产线写法改回「首次轮转成功即永久跳过」——同一夹具下必须复现越限增长。
    const mutantRoot = mkroot('diag-mut')
    const mLog = path.join(mutantRoot, 'dsh-auto-memory-diagnose.log')
    for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) process.env[k] = mutantRoot
    const mut = await loadEngine([[
      '_diagRotated = rotateDiagLogIfNeeded(Buffer.byteLength(line, \'utf8\')) || _diagRotated',
      '_diagRotated = _diagRotated || rotateDiagLogIfNeeded(Buffer.byteLength(line, \'utf8\'))',
    ]])
    writeFileSync(mLog, Buffer.alloc(cap + 1, 65))
    mut.diag('first rotation')
    await mut.flushDiagnostics()
    for (let i = 0; i < 2400; i++) mut.diag('mutant growth ' + 'B'.repeat(1000))
    await mut.flushDiagnostics()
    ok(statSync(mLog).size > cap, '负路径（恢复旧写法）：第二次不再轮转、文件突破上限（实 ' + statSync(mLog).size + ' B）—— 证明上一条判据有鉴别力')
  } finally { restoreEnv() }
}

console.log('[B] #269：worker 健康探测必须监听子进程异步 error（旧写法：无监听 + 空转到 30s）')
{
  const root = mkroot('health')
  const restoreEnv = withIsolatedEnv(root)
  const scriptPath = path.join(root, 'worker.py')
  writeFileSync(scriptPath, '# fixture\n', 'utf8')
  const savedTimers = { setInterval: globalThis.setInterval }
  try {
    // 计时器抽掉（apply 会起 5 个后台计时器；本组只测探测函数）。
    globalThis.setInterval = () => ({ unref() {} })
    const mod = await loadEngine()
    const effects = []
    let captured = null
    const proto = mod.MemoryEngine.prototype
    const origLoad = proto.loadConfigSync
    proto.loadConfigSync = function (...a) { captured = this; return origLoad.apply(this, a) }
    mod.apply(fakeCtx(effects), {})
    proto.loadConfigSync = origLoad
    const engine = captured
    assert.ok(engine && typeof engine._probeWorkerHealthOnce === 'function', '★ 真 apply() 后拿到产线探测函数（不是自制替身）')
    engine.config = { ...engine.config, pythonBackendWorkerPath: scriptPath }

    const mkChild = () => {
      const c = new EventEmitter()
      c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = new EventEmitter()
      c.stdin.write = () => true
      c.exitCode = null
      c.kill = () => {}
      return c
    }
    const err = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' })
    engine._healthProbeSpawnPre = () => { const c = mkChild(); process.nextTick(() => c.emit('error', err)); return c }
    const t0 = Date.now()
    const res = await engine._probeWorkerHealthOnce('python-not-a-real-binary')
    const ms = Date.now() - t0
    ok(res.ok === false, '★ 子进程 error ⇒ 健康态如实判失败（ok=false，实 ' + res.ok + '）')
    eq(res.error, 'ENOENT', 'error 码透出到返回体（供面板定位是「起不来」而不是「模型没加载」）')
    ok(/子进程错误/.test(String(res.reason)), '降级原因指向子进程错误（实: ' + String(res.reason).slice(0, 60) + '…）')
    ok(ms < 5000, '不再空转到 30s（实测 ' + ms + ' ms）')

    // 负路径：去掉 child 的 error 监听 ⇒ 事件无宿主（未捕获）+ 失败无法反映到返回体。
    const uncaught = []
    const onUncaught = (e) => { uncaught.push(e) }
    process.on('uncaughtException', onUncaught)
    const mut = await loadEngine([[
      "      proc.on('error', noteChildError)\r\n",
      '',
    ]])
    const mutEffects = []
    let mCaptured = null
    const mProto = mut.MemoryEngine.prototype
    const mOrigLoad = mProto.loadConfigSync
    mProto.loadConfigSync = function (...a2) { mCaptured = this; return mOrigLoad.apply(this, a2) }
    mut.apply(fakeCtx(mutEffects), {})
    mProto.loadConfigSync = mOrigLoad
    const mEngine = mCaptured
    mEngine.config = { ...mEngine.config, pythonBackendWorkerPath: scriptPath }
    mEngine._healthProbeSpawnPre = () => { const c = mkChild(); process.nextTick(() => c.emit('error', err)); return c }
    let settled = null
    const p = mEngine._probeWorkerHealthOnce('python-not-a-real-binary').then(r => { settled = r })
    await new Promise(r => setTimeout(r, 800))
    process.removeListener('uncaughtException', onUncaught)
    ok(uncaught.length > 0 || settled === null || !/子进程错误/.test(String((settled || {}).reason || '')),
      '负路径（去掉 error 监听）：事件无人接管 / 失败无法反映（uncaught=' + uncaught.length + ', settled=' + (settled === null ? 'no' : 'yes') + '）—— 证明判据有鉴别力')
    void p
    for (const c of effects) { try { c() } catch (_) {} }
    for (const c of mutEffects) { try { c() } catch (_) {} }
  } finally {
    globalThis.setInterval = savedTimers.setInterval
    restoreEnv()
  }
}
console.log('[C] #264 OCR-02：插件卸载后，迟到的请求不得再启动 Python 安装')
{
  const root = mkroot('py264')
  const restoreEnv = withIsolatedEnv(root)
  const savedTimers = { setInterval: globalThis.setInterval }
  try {
    globalThis.setInterval = () => ({ unref() {} })
    const mod = await loadEngine()
    const effects = []
    let captured = null
    const proto = mod.MemoryEngine.prototype
    const origLoad = proto.loadConfigSync
    proto.loadConfigSync = function (...a) { captured = this; return origLoad.apply(this, a) }
    mod.apply(fakeCtx(effects), {})
    proto.loadConfigSync = origLoad
    const engine = captured
    ok(engine && engine._pythonSetup, '★ 真 apply() 后拿到产线的 Python 向导实例')

    engine._disposed = false
    const liveErr = await engine._pythonSetup.ensureVenv('python').then(() => null, (e) => e)
    ok(!liveErr || liveErr.code !== 'PLUGIN_DISPOSED', '未卸载时准入门放行（不误伤正常安装请求）')

    engine._disposed = true
    let late = null
    try { await engine._pythonSetup.ensureVenv('python') } catch (e) { late = e }
    ok(!!late && late.code === 'PLUGIN_DISPOSED', '★ 卸载后（_disposed=true）迟到请求被拒：code=PLUGIN_DISPOSED（实 ' + (late && late.code) + '）')
    eq(engine._pythonSetup.status().phase, 'idle', '被拒的请求没有启动任何安装（phase 仍为 idle）')

    const ps = await importModule('lib/python-setup.js', [
      ["  const isLive = typeof opts.isLive === 'function' ? opts.isLive : () => true", '  const isLive = () => true'],
    ])
    const legacy = ps.createPythonSetupPre({ dshHome: () => root, diag: () => {} })
    let legacyErr = null
    try { await legacy.ensureVenv('python') } catch (e) { legacyErr = e }
    ok(!legacyErr || legacyErr.code !== 'PLUGIN_DISPOSED', '负路径（旧行为·无准入）：同一情形不再被拒（实 ' + (legacyErr && legacyErr.code) + '）—— 证明判据有鉴别力')

    for (const c of effects) { try { c() } catch (_) {} }
  } finally {
    globalThis.setInterval = savedTimers.setInterval
    restoreEnv()
  }
}
console.log('[D] #253 RL-03：会话销毁必须清理 Context Host 侧状态')
{
  const root = mkroot('ctx253')
  const restoreEnv = withIsolatedEnv(root)
  const savedInterval = globalThis.setInterval
  try {
    globalThis.setInterval = () => ({ unref() {} })
    const mod = await loadEngine()
    const effects = []
    let captured = null
    const proto = mod.MemoryEngine.prototype
    const origLoad = proto.loadConfigSync
    proto.loadConfigSync = function (...a) { captured = this; return origLoad.apply(this, a) }
    mod.apply(fakeCtx(effects), {})
    proto.loadConfigSync = origLoad
    const engine = captured
    const ch = engine._contextHost
    ok(ch && typeof ch.disposeRuntime === 'function', '★ 真 apply() 后拿到 Context Host 实例')

    const notifications = []
    try { engine._pythonSidecar.dispose() } catch (_) {}
    engine._pythonSidecar = {
      request: async () => ({ ok: false }), onActivation: () => () => {},
      notify: (type, payload) => notifications.push({ type, payload }),
      debugView: () => ({}), dispose: () => {},
    }
    engine.config = { ...engine.config, associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' }

    const mkAgent = (sid) => {
      const agent = { id: sid, session: { id: sid, header: { id: sid, cwd: root } } }
      const rt = engine.runtimeFor(agent)
      Object.assign(rt.state, { ws: root, userDir: path.join(root, 'user'), notesPath: path.join(root, 'memory', 'MEMORY.md'), logPath: path.join(root, 'memory', 'log.md') })
      engine.withAgent(agent, () => engine.capturePathsFor(agent))
      return agent
    }
    const a = mkAgent('a')
    mkAgent('b')
    eq(ch.debugView().capturedPathKeys, ['session:a', 'session:b'], '两个会话各自的路径快照已登记')
    ok(engine.disposeAgent(a) === true, '真执行会话销毁（disposeAgent）')
    eq(ch.debugView().capturedPathKeys, ['session:b'], '★ 被销毁会话的 Context Host 快照已被清理（另一会话不受影响）')
    ok(notifications.some(n => n.type === 'close_session' && n.payload && n.payload.sessionId === 'a'), '★ sink 侧收到该会话的 close_session（会话级关闭，不拆共享 sidecar）')
    eq(engine.runtimes.disposeSession({ id: 'b', header: { id: 'b' } }), true, 'SessionRuntimeStore.disposeSession 路径同样可达')
    eq(ch.debugView().capturedPathKeys, [], '★ disposeSession 路径也清理 Context Host 快照')
    eq(notifications.filter(n => n.type === 'close_session').length, 2, '两个会话各通知一次')

    const mut = await loadEngine([
      ["    try { if (this._contextHost) this._contextHost.disposeRuntime(runtime) } catch (e) {}\r\n", ''],
    ])
    const mEffects = []
    let mCaptured = null
    const mProto = mut.MemoryEngine.prototype
    const mOrigLoad = mProto.loadConfigSync
    mProto.loadConfigSync = function (...a2) { mCaptured = this; return mOrigLoad.apply(this, a2) }
    mut.apply(fakeCtx(mEffects), {})
    mProto.loadConfigSync = mOrigLoad
    const mEngine = mCaptured
    mEngine.config = { ...mEngine.config, associativeMemoryEnabled: true, contextBridgeEnabled: true }
    const mCh = mEngine._contextHost
    const mAgent = { id: 'a', session: { id: 'a', header: { id: 'a', cwd: root } } }
    const mRt = mEngine.runtimeFor(mAgent)
    Object.assign(mRt.state, { ws: root, userDir: path.join(root, 'user'), notesPath: path.join(root, 'memory', 'MEMORY.md'), logPath: path.join(root, 'memory', 'log.md') })
    mEngine.withAgent(mAgent, () => mEngine.capturePathsFor(mAgent))
    mEngine.disposeAgent(mAgent)
    ok(mCh.debugView().capturedPathKeys.includes('session:a'), '负路径（去掉清理接线）：销毁后快照仍在 ⇒ 缺陷复现，证明判据有鉴别力')

    for (const c of effects) { try { c() } catch (_) {} }
    for (const c of mEffects) { try { c() } catch (_) {} }
  } finally {
    globalThis.setInterval = savedInterval
    restoreEnv()
  }
}

console.log('[E] #257 SEC-01：敏感段过滤必须真执行且 Tier-0 注入路径必须走它')
{
  const root = mkroot('sec257')
  const restoreEnv = withIsolatedEnv(root)
  try {
    const inj = await import(pathToFileURL(path.join(ROOT, 'lib', 'injection-policy.js')).href)
    const SENSITIVE = ['# 用户级记忆', '', '## 2026-01-01', '- 普通规则：先备份再改配置。', '', '## 凭据 / token', '- API_KEY=sk-live-DEADBEEF0123456789', '- 口令：hunter2-do-not-inject', ''].join('\n')

    const stripped = inj.stripSensitiveSections(SENSITIVE, { preserveLines: true })
    ok(!stripped.includes('sk-live-DEADBEEF0123456789') && !stripped.includes('hunter2-do-not-inject'), 'stripSensitiveSections 真执行：敏感段正文被剥离')
    ok(stripped.includes('普通规则：先备份再改配置'), '非敏感段原样保留（不是整篇清空）')
    const raw = inj.sensitiveSections(SENSITIVE)
    ok(raw.ranges.length >= 1 && raw.ranges.every(x => x.end > x.start), 'sensitiveSections 给出字节区间（供按行号准入用），ranges=' + JSON.stringify(raw.ranges))

    const hits = [
      { sourceRef: 'user:MEMORY.md', layer: 'user', memoryId: 'm-safe', lineStart: 1, lineEnd: 3, excerpt: '普通规则：先备份再改配置。' },
      { sourceRef: 'user:MEMORY.md', layer: 'user', memoryId: 'm-secret', lineStart: 5, lineEnd: 6, excerpt: 'API_KEY=sk-live-DEADBEEF0123456789' },
      { sourceRef: 'user:MEMORY.md', layer: 'user', memoryId: 'm-unlocated', excerpt: 'API_KEY=sk-live-DEADBEEF0123456789' },
    ]
    const admitted = inj.filterSensitiveHits(hits, [{ layer: 'user', path: 'MEMORY.md', sourceRef: 'user:MEMORY.md', text: SENSITIVE }])
    eq(admitted.kept.map(h => h.memoryId), ['m-safe'], '★ 命中准入：落进敏感段的命中被挡下，安全命中保留')
    eq(admitted.dropped.map(h => h.memoryId), ['m-secret', 'm-unlocated'], '无行号的旧投影在来源含敏感段时 fail closed（宁缺不漏）')

    // 真执行 Tier-0 装配：产线方法 buildTierLayerInjection 的输出里不得出现敏感正文。
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    eng.config = { ...eng.config, tier0CatalogEnabled: true, injectBudgetChars: 4000, tier0BudgetShare: 0.4, associativeMemoryEnabled: false }
    eng.state.ws = root
    eng.state.userText = SENSITIVE
    eng.state.notesText = ''
    eng.state.logText = ''
    eng.state.planText = ''
    eng.state.latestReflection = ''
    const text = eng.buildTierLayerInjection(null)
    ok(typeof text === 'string' && text.length > 0, '★ 真执行 buildTierLayerInjection 产出 Tier-0 文本（' + text.length + ' B）')
    ok(!text.includes('sk-live-DEADBEEF0123456789'), '★ Tier-0 常驻目录不再携带敏感段正文（旧实现此处必现密钥）')
    ok(text.includes('先备份再改配置'), '同来源的普通内容仍进入目录（修复不是一刀切空目录）')

    // 负路径：去掉来源侧的 stripSensitiveSections ⇒ 密钥必须重新出现在 Tier-0 文本里。
    const mut = await loadEngine([[
      'sources: sources.map(source => ({ ...source, text: stripSensitiveSections(source.text, { preserveLines: true }) })),',
      'sources,',
    ]])
    const mEng = new mut.MemoryEngine()
    mEng.config = { ...mEng.config, tier0CatalogEnabled: true, injectBudgetChars: 4000, tier0BudgetShare: 0.4, associativeMemoryEnabled: false }
    mEng.state.ws = root
    mEng.state.userText = SENSITIVE
    mEng.state.notesText = ''
    mEng.state.logText = ''
    mEng.state.planText = ''
    mEng.state.latestReflection = ''
    const mText = mEng.buildTierLayerInjection(null)
    ok(mText.includes('sk-live-DEADBEEF0123456789'), '负路径（恢复旧写法·不过滤来源）：密钥重新进入 Tier-0 注入 ⇒ 缺陷复现，证明判据有鉴别力')
  } finally { restoreEnv() }
}
console.log('[F] #258 SEC-02：团队本机角色门（viewer 越权必须被拒）+ 真实调用点计数')
{
  const root = mkroot('team258')
  const restoreEnv = withIsolatedEnv(root)
  try {
    const tp = await import(pathToFileURL(path.join(ROOT, 'lib', 'team-policy.js')).href)
    const viewer = { teamEnabled: true, teamMemberId: 'u1', teamMemberRole: 'viewer' }
    let denied = null
    try { tp.assertTeamActionPre(viewer, 'edit-team-config') } catch (e) { denied = e }
    ok(!!denied && denied.code === 'team-forbidden' && denied.statusCode === 403, '★ viewer 改团队配置被拒（code=team-forbidden, statusCode=403）')
    let boardDenied = null
    try { tp.assertTeamActionPre(viewer, 'edit-board') } catch (e) { boardDenied = e }
    ok(!!boardDenied && boardDenied.code === 'team-forbidden', '★ viewer 改白板被拒')
    let calDenied = null
    try { tp.assertTeamActionPre(viewer, 'write-calendar') } catch (e) { calDenied = e }
    ok(!!calDenied && calDenied.code === 'team-forbidden', '★ viewer 写日历被拒')
    ok(!!tp.assertTeamActionPre(viewer, 'read-team'), 'viewer 的读能力仍放行（未越权收紧）')
    ok(!!tp.assertTeamActionPre({ teamEnabled: false }, 'edit-team-config'), '★ 非团队用户（teamEnabled!==true）短路放行 —— 个人用户零感知')

    // 真执行引擎路径：viewer 经写原语、配置保存、白板入口都必须被拒。
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    eng._configPath = path.join(root, 'dsh-auto-memory.json')
    writeFileSync(eng._configPath, JSON.stringify(viewer), 'utf8')
    const writer = async (fn) => { try { await fn(); return null } catch (e) { return e } }
    for (const [label, call] of [
      ['appendText(记忆)', () => eng.appendText(path.join(root, 'MEMORY.md'), '- x')],
      ['writeFull(笔记)', () => eng.writeFull(path.join(root, 'MEMORY.md'), '# x')],
      ['writeFullRaw(日历)', () => eng.writeFullRaw(path.join(root, 'CALENDAR.md'), '# x')],
      ['writeFullSingle(反思)', () => eng.writeFullSingle(path.join(root, 'R.md'), '# x')],
    ]) {
      const e = await writer(call)
      ok(!!e && e.code === 'team-forbidden', '★ 真调产线写原语 ' + label + ' ⇒ viewer 被拒（实 ' + (e && (e.code || e.message)) + '）')
    }
    const saveErr = await eng.saveConfig({ teamMemberRole: 'administrator' }).then(() => null, (e) => e)
    ok(!!saveErr && saveErr.code === 'team-forbidden', '★ viewer 越权改 teamMemberRole 被配置写入门拒绝（实 ' + (saveErr && saveErr.code) + '）')
    const planRes = await eng.writePlanSnapshot(path.join(root), '# 白板\n').then((r) => r, (e) => ({ threw: e }))
    ok(planRes && planRes.ok === false && /team-forbidden/.test(String(planRes.error || '')), '★ viewer 写白板被拒（白板写入口把拒绝收口为 ok:false + team-forbidden，实 ' + JSON.stringify(planRes && planRes.error) + '）')
    ok(!existsSync(path.join(root, 'handoff', 'PLAN.md')), '★ 被拒的白板写入没有落盘（磁盘上不存在 PLAN.md）')

    // 调用点计数（本仓口径：机制建好了 ≠ 机制在跑）
    const src = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
    const calls = (src.match(/_assertTeamActionPre\(/g) || []).length
    const defs = (src.match(/^\s*_assertTeamActionPre\([^)]*\)\s*\{/gm) || []).length
    ok(calls >= 8 && defs === 1, '★ 调用点计数：接线前 0 → 接线后 ' + calls + ' 处（定义 ' + defs + ' 处）')

    // 负路径：把 team-policy 的判据换成「恒放行」⇒ 同一越权请求不再被拒。
    const tpMut = await importModule('lib/team-policy.js', [[
      'if (result.ok === true) return { ...result, member: config && config.teamEnabled === true ? identity.currentMember() : null }',
      'if (true) return { ok: true }',
    ]])
    let mutDenied = null
    try { tpMut.assertTeamActionPre(viewer, 'edit-team-config') } catch (e) { mutDenied = e }
    ok(!mutDenied, '负路径（判据换成恒放行）：越权不再被拒 ⇒ 缺陷复现，证明判据有鉴别力')
  } finally { restoreEnv() }
}
console.log('[G] L-B 接线：#250 的 pendingSnapshot 合并读必须有**真实调用点**（不是建好没接线）')
{
  const root = mkroot('hubwire')
  const restoreEnv = withIsolatedEnv(root)
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    eng.state.ws = root
    const seen = []
    const restored = []
    eng._memoryHub = {
      stores: {
        procedures: {
          snapshot: () => ({ schemaVersion: 1, namespace: 'dsh-auto-memory', procedures: [{ procedureId: 'p-mem', title: '内存里刚提交的' }] }),
          restore: (snap) => { restored.push(snap); return { ok: true, restored: (snap.procedures || []).length } },
        },
      },
    }
    eng._scopedProcedureIo = {
      load: (options = {}) => {
        seen.push(options)
        return { schemaVersion: 1, namespace: 'dsh-auto-memory', procedures: [{ procedureId: 'p-disk', title: '盘上别人的' }, { procedureId: 'p-mem', title: '内存里刚提交的' }] }
      },
    }
    const r = eng.rehydrateProcedureScopes({ authoritativeIds: ['p-moved'] })
    eq(seen.length, 1, '★ 调用点计数：rehydrateProcedureScopes 真的调用了 io.load（1 次）')
    ok(!!seen[0].pendingSnapshot && Array.isArray(seen[0].pendingSnapshot.procedures) && seen[0].pendingSnapshot.procedures[0].procedureId === 'p-mem',
      '★ 真实传参：load 的实参含 pendingSnapshot（本进程未落盘的内存快照），而不是旧的「无参 load + 本地手写并集」')
    eq(seen[0].authoritativeIds, ['p-moved'], '★ 真实传参：authoritativeIds 原样透传（迁移结果由 hub-io 侧覆盖旧副本）')
    eq(restored.length, 1, '合并结果经 store.restore 装配回内存（1 次）')
    ok(r.merged === 2, '合并后条目数 = hub-io 返回的并集（实 ' + r.merged + '）')

    // 负路径：把调用点退回旧形态（无参 load）⇒ pendingSnapshot 不再被传，差量语义失效。
    const mut = await loadEngine([[
      'const onDisk = io.load({ pendingSnapshot: mem, authoritativeIds: opts.authoritativeIds })',
      'const onDisk = io.load()',
    ]])
    const mEng = new mut.MemoryEngine()
    mEng.state.ws = root
    const mSeen = []
    mEng._memoryHub = { stores: { procedures: { snapshot: () => ({ procedures: [] }), restore: () => ({ ok: true, restored: 0 }) } } }
    mEng._scopedProcedureIo = { load: (o = {}) => { mSeen.push(o); return { schemaVersion: 1, namespace: 'dsh-auto-memory', procedures: [] } } }
    mEng.rehydrateProcedureScopes()
    ok(mSeen.length === 1 && mSeen[0].pendingSnapshot === undefined, '负路径（退回无参 load）：pendingSnapshot 不再传递 ⇒ 差量语义失效，证明判据有鉴别力')
  } finally { restoreEnv() }
}

console.log('[Z] 行尾纪律：三个产线文件必须单一行尾（不含混合换行）')
{
  for (const rel of ['lib/index.js', 'lib/context-host.js', 'lib/python-setup.js']) {
    const buf = readFileSync(path.join(ROOT, rel))
    const s = buf.toString('utf8')
    const crlf = (s.match(/\r\n/g) || []).length
    const bareLf = (s.match(/(?<!\r)\n/g) || []).length
    ok((crlf === 0) !== (bareLf === 0), rel + ' 单一行尾（CRLF=' + crlf + ', bareLF=' + bareLf + '，无混合）')
  }
}

console.log('')
console.log('L-A smoke: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch (_) {} }
if (fail > 0) process.exit(1)

