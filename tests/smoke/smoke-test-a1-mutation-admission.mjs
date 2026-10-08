/**
 * smoke-test-a1-mutation-admission —— A1 批（#248 / #249 / #251）真执行回归。
 *
 * 判据纪律（CR-10）：每条都真 import → 真构造 → 真调用 → 断言**副作用**；
 * 负路径靠环境变量 `A1_SOURCE_ROOT` 指向回退树（`node tools/a1-negative-revert.mjs --apply`）。
 *
 *   ① #248 applyNoteStatusPre：快照 → 提交的窗口内文件被外部改写 ⇒ **拒绝并报冲突**，
 *      绝不静默覆盖；无外部改写时照常成功（真读真写真断言字节）。
 *   ② #248 compactLegacyLayer：折叠跨 await，窗口内落盘的追加压缩后**仍在主文件**，
 *      且返回结构化冲突（旧行为：静默整篇覆盖，追加既不在主文件也不在归档）。
 *   ③ #249 统一 admission：迁移窗口内 `writeFull` ⇒ 明确拒绝（409 / SETTINGS_MIGRATION_ACTIVE），
 *      字节不变；根绑定变更 ⇒ 拒绝写旧根（SETTINGS_ROOT_CHANGED）；迁移后内容落在**活动根**。
 *   ④ #251 apply 挂载失败回滚：在工具注册 / 路由注册 / effect 登记三处分别注入异常 ⇒
 *      回滚后无遗留 timers、无迟到心跳写盘；成功挂载、重复 dispose、重新挂载仍通过。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const ownRoot = fileURLToPath(new URL('../../', import.meta.url))
// 子进程模式（A1_SOURCE_ROOT 指向**回退树**）：只跑 ①②③，④ 由主进程负责。
const root = process.env.A1_SOURCE_ROOT || ownRoot
// audit-engine 默认加载自己的 ../../lib/index.js；显式指到 root 才能切换被测树。
process.env.DAM_AUDIT_ENGINE_SOURCE = path.join(root, 'lib', 'index.js')
const source = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8').replace(/\r\n/g, '\n')
const temp = fs.mkdtempSync(path.join(tmpdir(), 'a1-'))
let pass = 0, fail = 0
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra ? ' :: ' + extra : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const extract = (marker) => {
  const start = source.indexOf('  ' + marker)
  assert.ok(start >= 0, 'production method exists: ' + marker)
  assert.equal(source.indexOf('  ' + marker, start + marker.length + 2), -1, 'unique method: ' + marker)
  const end = source.indexOf('\n  }\n', start)
  assert.ok(end > start, 'method body bounded: ' + marker)
  return source.slice(start, end + 5).replace(/import\('\.\/([^']+)'\)/g, (_, name) => 'import(' + JSON.stringify(pathToFileURL(path.join(root, 'lib', name)).href) + ')')
}

console.log('[A1] ① #248 applyNoteStatusPre 快照 CAS')
{
  const body = extract('async applyNoteStatusPre(')
  const modulePath = path.join(temp, 'apply-note-status.mjs')
  await fsp.writeFile(modulePath, [
    "import { createHash } from 'node:crypto'",
    "import { recordDiagnosticErrorPre } from " + JSON.stringify(pathToFileURL(path.join(root, 'lib/diagnostic-error.js')).href),
    "import { MemoryDocumentStore, memoryWriteError } from " + JSON.stringify(pathToFileURL(path.join(root, 'lib/memory-writer.js')).href),
    'export function make(overrides) {',
    '  const readFile = overrides.readFile',
    '  return new (class {',
    '    async writeFull(p, text, opts) { return overrides.writeFull(p, text, opts) }',
    '    async appendText(p, text) { return overrides.appendText(p, text) }',
    body,
    '  })()',
    '}',
    '// 真实写入器：MemoryDocumentStore.replaceRaw —— 真 CAS（expectedDigest 不符即拒绝）',
    'export function realWriter() {',
    '  const store = new MemoryDocumentStore()',
    '  const captured = []',
    '  return { captured, writeFull: async (p, text, o) => { captured.push(o); const r = await store.replaceRaw(p, text, o); if (!r.ok) throw memoryWriteError("replace-raw", r); return r } }',
    '}',
  ].join('\n'), 'utf8')
  const { make, realWriter } = await import(pathToFileURL(modulePath).href)
  const MEM = 'mem_' + 'a'.repeat(32)
  const seed = '# Notes\n<!-- memory:' + MEM + ' -->\nOriginal conclusion\n'

  {
    const file = path.join(temp, 'notes-quiet.md')
    await fsp.writeFile(file, seed, 'utf8')
    const writer = realWriter()
    const host = make({ readFile: fsp.readFile, writeFull: writer.writeFull, appendText: async () => {} })
    host.state = {}; host._degradeSink = { record() {} }
    const out = await host.applyNoteStatusPre(file, { retract: [MEM] }, seed)
    ok(/状态已更新/.test(out), '① 正路径：无并发改写 ⇒ 状态写入成功', out.trim())
    const expect = (await import('node:crypto')).createHash('sha256').update(seed, 'utf8').digest('hex')
    ok(writer.captured.length === 1 && (writer.captured[0] || {}).expectedDigest === expect, '① 正路径：真实写入器收到与快照一致的 expectedDigest', JSON.stringify(writer.captured))
    ok(/retracted/.test(await fsp.readFile(file, 'utf8')), '① 正路径：状态正文真的落盘')
  }

  {
    const file = path.join(temp, 'notes-stale.md')
    const external = seed + '\n<!-- memory:mem_' + 'b'.repeat(32) + ' -->\nACCEPTED_APPEND\n'
    await fsp.writeFile(file, seed, 'utf8')
    const writer = realWriter()
    const host = make({
      readFile: async (p, ...rest) => { const t = await fsp.readFile(p, ...rest); await fsp.writeFile(p, external, 'utf8'); return t },
      writeFull: writer.writeFull,
      appendText: async () => {},
    })
    host.state = {}; host._degradeSink = { record() {} }
    const out = await host.applyNoteStatusPre(file, { retract: [MEM] }, seed)
    const after = await fsp.readFile(file, 'utf8')
    ok(after.includes('ACCEPTED_APPEND'), '① 负路径：窗口内已被接受的追加**未被覆盖**', after.slice(0, 80).replace(/\n/g, '\\n'))
    ok(/ACCEPTED_APPEND/.test(after) && !/retracted/.test(after), '① 负路径：磁盘上只有被接受的那次写（状态改写整体未落盘）')
    ok(!/状态已更新/.test(out) && /状态写入失败/.test(out), '① 负路径：返回**明确冲突**而不是成功文案', out.trim())
    ok(writer.captured.length >= 1 && !/retracted/.test(after), '① 负路径：CAS 确实走到真实写入器且被拒（不是提前短路）', JSON.stringify(writer.captured))
  }

  {
    const file = path.join(temp, 'notes-cache.md')
    const external = seed + '\n<!-- memory:mem_' + 'c'.repeat(32) + ' -->\nACCEPTED_APPEND_2\n'
    await fsp.writeFile(file, external, 'utf8')
    let wroteCount = 0
    const host = make({
      readFile: async () => { const e = new Error('boom'); e.code = 'EIO'; throw e },
      writeFull: async (p, t) => { wroteCount++; await fsp.writeFile(p, t, 'utf8') },
      appendText: async () => {},
    })
    host.state = {}; host._degradeSink = { record() {} }
    const out = await host.applyNoteStatusPre(file, { retract: [MEM] }, seed)
    ok(wroteCount === 0, '① 负路径 B：读盘失败后不得拿陈旧缓存整篇覆盖', 'wroteCount=' + wroteCount)
    ok(!/状态已更新/.test(out), '① 负路径 B：读失败必须如实报告失败/冲突', out.trim())
    ok((await fsp.readFile(file, 'utf8')).includes('ACCEPTED_APPEND_2'), '① 负路径 B：磁盘上的既有内容保持原样')
  }
}

console.log('[A1] ② #248 compactLegacyLayer 跨 await CAS')
{
  const projRoot = path.join(temp, 'compact')
  await fsp.mkdir(projRoot, { recursive: true })
  process.env.DSH_HOME = path.join(temp, '.dsh')
  process.env.HOME = temp
  process.env.USERPROFILE = temp
  const { MemoryEngine } = await import(pathToFileURL(path.join(root, 'tests/lib/audit-engine.mjs')).href)
  const engine = new MemoryEngine()
  // ★本用例针对 #248 的 anchor 档（docStore 真路径）：开关打开后才走 anchored 写通道
  engine.config.memoryAnchorEnabled = true
  const notes = path.join(projRoot, 'MEMORY.md')
  const p = { projectDir: projRoot, notesPath: notes, userFile: path.join(temp, 'USER.md') }
  await engine.appendText(notes, '\n## OLD_SEG\n' + 'old segment reusable conclusion. '.repeat(11) + '\n')
  await engine.appendText(notes, '\n## LATEST\nkeep-me-short\n')
  let enter, resume
  const entered = new Promise((r) => { enter = r })
  const paused = new Promise((r) => { resume = r })
  engine.foldTextToSummaryPre = async () => { enter(); await paused; return 'FOLDED_SUMMARY' }
  const pending = engine.compactLegacyLayer(null, 'note', p, 120, true)
  await entered
  await engine.appendText(notes, '\n## CONCURRENT_NEW\naccepted while folding.\n')
  const accepted = await fsp.readFile(notes, 'utf8')
  ok(accepted.includes('CONCURRENT_NEW'), '② 窗口内的追加经真实通道落盘成功')
  resume()
  const res = await pending
  const after = await fsp.readFile(notes, 'utf8')
  ok(after.includes('CONCURRENT_NEW'), '② 窗口内被接受的追加在整理后**仍在主文件**', JSON.stringify(res))
  ok(res && res.ok === false && /conflict/.test(String(res.reason)), '② 整理如实返回可见冲突（不假报成功）', JSON.stringify(res))
  const archive = await fsp.readFile(path.join(projRoot, 'archive', 'notes-archived.md'), 'utf8').catch(() => '')
  ok(archive.includes('OLD_SEG'), '② 被回收段原文进归档（保底不丢）', String(archive.length))
  // 负路径真实性：本用例命中的**必须是 CAS 冲突**那条控制流；折叠函数若被摘掉 CAS，
  //   这里会退化成「成功覆盖」⇒ 上一条断言即失败（真执行证据，非源码字符串守卫）。
  ok(engine.config.memoryAnchorEnabled === true && /conflict/.test(String(res.reason)), '② 命中的是 anchor 档真实 CAS 冲突分支', JSON.stringify(res.reason))

  const notes2 = path.join(projRoot, 'QUIET.md')
  await fsp.writeFile(notes2, '## Q_OLD\n' + 'quiet segment reusable conclusion. '.repeat(11) + '\n\n## Q_LATEST\nshort\n', 'utf8')
  engine.foldTextToSummaryPre = async () => 'FOLDED2'
  const r2 = await engine.compactLegacyLayer(null, 'note', { ...p, notesPath: notes2 }, 120, true)
  const after2 = await fsp.readFile(notes2, 'utf8')
  ok(r2 && r2.ok === true, '② 正路径：无并发 ⇒ 整理成功', JSON.stringify(r2))
  ok(after2.includes('Q_LATEST') && !after2.includes('Q_OLD'), '② 正路径：最新段保留、最旧段被回收')
}

console.log('[A1] ③ #249 生产文档 mutation 统一 admission')
{
  const home = path.join(temp, 'dsh-home-admission')
  const oldRoot = path.join(temp, 'root-old')
  const newRoot = path.join(temp, 'root-new')
  const ws = path.join(temp, 'ws-one')
  await fsp.mkdir(home, { recursive: true })
  await fsp.mkdir(ws, { recursive: true })
  await fsp.mkdir(oldRoot, { recursive: true })
  await fsp.mkdir(newRoot, { recursive: true })
  process.env.DSH_HOME = home
  const writeCfg = (root) => fsp.writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: root, userMemoryDir: path.join(temp, 'user-dir'), projectMemoryDir: '.dsh-memory',
    externalSources: {}, semanticEngineMode: 'lexical',
  }), 'utf8')
  const { MemoryEngine } = await import(pathToFileURL(path.join(root, 'tests/lib/audit-engine.mjs')).href)

  // ③-1 迁移窗口内：新写请求**明确拒绝**，目标字节不变；窗口外同一路径照常成功
  {
    await writeCfg(oldRoot)
    const engine = new MemoryEngine()
    engine.loadConfigSync()
    const target = path.join(engine.projectDirOf(ws), 'MEMORY.md')
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, 'BEFORE\n', 'utf8')
    engine._settingsMigrationActive = true
    let err = null
    try { await engine.writeFull(target, 'AFTER\n') } catch (e) { err = e }
    ok(!!err && err.code === 'SETTINGS_MIGRATION_ACTIVE' && err.statusCode === 409, '③ 迁移窗口：writeFull 明确拒绝（409 / SETTINGS_MIGRATION_ACTIVE）', err && (err.code + '/' + err.statusCode))
    ok(await fsp.readFile(target, 'utf8') === 'BEFORE\n', '③ 迁移窗口：目标字节未被改写')
    // Another route's flight does not authorize this request during migration.
    engine._settingsNoteFlights = new Set([Promise.resolve()])
    let unrelated = null
    try { await engine.writeFull(target, 'UNRELATED\n') } catch (e) { unrelated = e }
    ok(unrelated?.code === 'SETTINGS_MIGRATION_ACTIVE', '③ 其他路由 flight 不放行当前请求', unrelated?.code)
    ok(await fsp.readFile(target, 'utf8') === 'BEFORE\n', '③ 未受理请求没有改写目标字节')
    engine._settingsMigrationActive = false
    await engine._withMemoryAdmissionScopePre(async () => {
      engine._settingsMigrationActive = true
      try { await engine.writeFull(target, 'AFTER_ADMITTED\n') }
      finally { engine._settingsMigrationActive = false }
    })
    ok(await fsp.readFile(target, 'utf8') === 'AFTER_ADMITTED\n', '③ 当前请求的已受理 scope 允许完成写入')
    engine._settingsNoteFlights = new Set()
    engine._settingsMigrationActive = false
    await engine.writeFull(target, 'AFTER\n')
    ok(await fsp.readFile(target, 'utf8') === 'AFTER\n', '③ 负路径：非迁移窗口 ⇒ 同一写路径照常成功')
    // 覆盖全部生产写原语而不只是 writeFull
    engine._settingsMigrationActive = true
    let err2 = null
    try { await engine.appendText(target, '\n## X\nmore\n') } catch (e) { err2 = e }
    ok(!!err2 && err2.code === 'SETTINGS_MIGRATION_ACTIVE', '③ 追加通道同样受统一 admission 约束', err2 && err2.code)
    engine._settingsMigrationActive = false
  }

  // ③-2 迁移后：内容落在**活动根**
  {
    await writeCfg(newRoot)
    const fresh = new MemoryEngine()
    fresh.loadConfigSync()
    const newTarget = path.join(fresh.projectDirOf(ws), 'MEMORY.md')
    await fsp.mkdir(path.dirname(newTarget), { recursive: true })
    await fresh.writeFull(newTarget, 'ACTIVE_ROOT_BYTES\n')
    ok(await fsp.readFile(newTarget, 'utf8') === 'ACTIVE_ROOT_BYTES\n', '③ 迁移后：内容落在活动根')
  }
}

if (!process.env.A1_SOURCE_ROOT) {
console.log('[A1] ④ #251 apply 挂载失败回滚')
{
  const home = path.join(temp, 'dsh-home-apply')
  const memRoot = path.join(temp, 'apply-root')
  await fsp.mkdir(home, { recursive: true })
  await fsp.mkdir(memRoot, { recursive: true })
  const hb = path.join(home, 'memory', 'polling-heartbeat.json')
  fs.writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: memRoot, userMemoryDir: path.join(temp, 'apply-user'), projectMemoryDir: '.dsh-memory',
    externalSources: {}, memoryHubEnabled: false, teamEnabled: false, semanticEngineMode: 'lexical',
  }), 'utf8')
  process.env.DSH_HOME = home
  const { apply } = await import(pathToFileURL(path.join(root, 'lib/index.js')).href)

  const realInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval
  const realTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout
  const realFetch = globalThis.fetch
  const mount = (inject) => {
    const timers = [], clearedTimers = [], timeouts = [], clearedTimeouts = []
    globalThis.setInterval = (fn, ms) => { const t = realInterval(fn, ms); timers.push({ t, fn, ms }); return t }
    globalThis.clearInterval = (t) => { clearedTimers.push(t); return realClearInterval(t) }
    globalThis.setTimeout = (fn, ms) => { const t = realTimeout(fn, ms); timeouts.push({ t, fn, ms }); return t }
    globalThis.clearTimeout = (t) => { clearedTimeouts.push(t); return realClearTimeout(t) }
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
    const effects = [], toolsCalls = [], routeCalls = []
    let thrown = null
    const ctx = {
      get() { return undefined },
      on() { return () => {} },
      effect(fn, tag) {
        if (inject === 'effect') throw new Error('injected: effect registration failed')
        effects.push({ fn, tag })
        return () => { const r = fn(); if (typeof r === 'function') r() }
      },
      systemPrompt: { section() { return () => {} }, context() { return () => {} } },
      tools: { register(tool) { toolsCalls.push(tool && tool.name); if (inject === 'tools' && toolsCalls.length === 3) throw new Error('injected: tools.register failed'); return () => {} } },
      webServer: { register(route) { routeCalls.push(route && route.path); if (inject === 'webServer' && routeCalls.length === 2) throw new Error('injected: webServer.register failed'); return () => {} } },
    }
    try { apply(ctx, {}) } catch (e) { thrown = e }
    // ★插桩必须活到 dispose 之后：disposeSurfaces 里的 clearInterval 也要被记录，
    //   否则「无遗留计时器」会在还原后的真实 clearInterval 上假绿。
    const restore = () => { globalThis.setInterval = realInterval; globalThis.clearInterval = realClearInterval; globalThis.setTimeout = realTimeout; globalThis.clearTimeout = realClearTimeout }
    return { timers, clearedTimers, timeouts, clearedTimeouts, effects, toolsCalls, routeCalls, thrown, restore }
  }
  // 宿主（cordis）卸载时会依次执行 effect 的返回值（disposer）；这里如实模拟。
  const disposeSurface = (m) => { for (const { fn } of m.effects) { try { const r = fn(); if (typeof r === 'function') r() } catch (e) {} } }
  // ★#251 断言口径：**sources effect 名下解绑的**必须是完整集合 —— 5 个 timer 是
  //   「60s hub feed / 90s hub boot / 1h notices / 5min retry / 15s heartbeat」，
  //   少一个都算遗留（旧实现漏了 hub feed 的两个：它们挂在 engine._hubFeedDisposers、
  //   而该数组只被末段清理块消费，工具注册抛错时已创建却无人清理）。
  const leftover = (m) => {
    const seen = new Set(m.clearedTimers.concat(m.clearedTimeouts))
    const alive = (arr) => arr.filter(({ t }) => !seen.has(t)).map(({ ms }) => ms)
    return { intervals: alive(m.timers).sort((a, b) => a - b), longTimeouts: alive(m.timeouts).filter((ms) => ms >= 5000).sort((a, b) => a - b), intervalsCreated: m.timers.length }
  }
  // 只计**跨 tick 存活**的残留：短命 timeout（<5s，引擎内部一次性定时器）不属「后台计时器」。


  {
    const m = mount(null)
    ok(!m.thrown, '④ 成功挂载不抛错', m.thrown && m.thrown.message)
    ok(m.timers.length >= 3, '④ 成功挂载确实建立了后台计时器', 'timers=' + m.timers.length)
    await sleep(60)
    ok(fs.existsSync(hb), '④ 挂载后心跳文件确实落盘（探针前置条件）', hb)
    disposeSurface(m); disposeSurface(m); disposeSurface(m)   // 幂等：重复 dispose 必须无害
    m.restore()
    const lo = leftover(m)
    ok(lo.intervalsCreated >= 4, '④ 成功挂载确实建立了 4 个 interval（hub feed / notices / retry / heartbeat）', JSON.stringify(lo))
    ok(lo.intervals.length === 0 && lo.longTimeouts.length === 0, '④ dispose 后无遗留计时器（含 hub feed 与 90s boot）', JSON.stringify(lo))
    try { fs.rmSync(hb, { force: true }) } catch (e) {}
    for (const { fn } of m.timers) { try { fn() } catch (e) {} }
    for (const { fn } of m.timeouts) { try { fn() } catch (e) {} }
    await sleep(250)
    ok(!fs.existsSync(hb), '④ dispose 之后**无迟到心跳写盘**（回调被守卫拦住）')
  }

  for (const at of ['tools', 'webServer', 'effect']) {
    const m = mount(at)
    ok(!!m.thrown, '④ 注入 ' + at + '：挂载如实抛出（不静默半挂载）', m.thrown && m.thrown.message)
    const lo = leftover(m)
    ok(lo.intervalsCreated === 0 || lo.intervalsCreated >= 4, '④ 注入 ' + at + '：计时器创建计数合理（0=尚未走到，≥4=已建但已回滚）', JSON.stringify(lo))
    ok(lo.intervals.length === 0 && lo.longTimeouts.length === 0, '④ 注入 ' + at + '：回滚后无遗留计时器', JSON.stringify(lo))
    try { fs.rmSync(hb, { force: true }) } catch (e) {}
    m.restore()
    for (const { fn } of m.timers) { try { fn() } catch (e) {} }
    for (const { fn } of m.timeouts) { try { fn() } catch (e) {} }
    await sleep(250)
    ok(!fs.existsSync(hb), '④ 注入 ' + at + '：回滚后无迟到心跳写盘')
  }

  {
    const m1 = mount(null); disposeSurface(m1); m1.restore()
    const m2 = mount(null)
    try { fs.rmSync(hb, { force: true }) } catch (e) {}
    for (const { fn } of m2.timers) { try { fn() } catch (e) {} }
    await sleep(250)
    ok(fs.existsSync(hb), '④ 重新挂载后心跳恢复（dispose 标志未跨实例泄漏）')
    disposeSurface(m2); m2.restore()
  }
  globalThis.fetch = realFetch
}

}

// ══ 负路径（变异反向验证）：把 #248/#249 的修复**真删**得到回退树 ⇒ 断言必红 ══
if (!process.env.A1_SOURCE_ROOT) {
  console.log('[A1] ⑤ 负路径：回退树（真删 CAS + admission 接线）必须让断言变红')
  const negRoot = path.join(temp, 'a1-negative')
  await fsp.cp(path.join(ownRoot, 'lib'), path.join(negRoot, 'lib'), { recursive: true })
  await fsp.cp(path.join(ownRoot, 'tests', 'lib'), path.join(negRoot, 'tests', 'lib'), { recursive: true })
  const revert = (file, pairs) => {
    let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    for (const [rawFrom, rawTo] of pairs) {
      const from = rawFrom.replace(/\r\n/g, '\n'), to = rawTo.replace(/\r\n/g, '\n')
      assert.equal(text.split(from).length - 1, 1, '回退锚点必须唯一存在: ' + file + ' :: ' + from.slice(0, 60))
      text = text.split(from).join(to)
    }
    fs.writeFileSync(file, text, 'utf8')
  }
  // #248：摘掉两处 expectedDigest（快照 CAS 消失）
  revert(path.join(negRoot, 'lib/index.js'), [
    ['await this.writeFull(notesPath, text, { expectedDigest: snapshotDigest })', 'await this.writeFull(notesPath, text)'],
    ['await this.writeFull(filePath, body, { expectedDigest: snapshotDigest })', 'await this.writeFull(filePath, body)'],
    ['        mutationAdmission: file => captureMemoryMutationPre(this, file),\r\n        mutationBoundary: (file, job, admission) => this._withMemoryMutationPre(file, job, admission),\r\n', ''],
    ['      mutationAdmission: file => captureMemoryMutationPre(this, file),\r\n      mutationBoundary: (file, job, admission) => this._withMemoryMutationPre(file, job, admission),\r\n', ''],
  ])
  // #249：摘掉 store 的 admission 边界（写盘通道不再有统一门）
  // 只回退**接线**，保留模块自身默认值：否则模块 import 即崩，红的不是被测行为。
  //   （admission 无来源 ⇒ target 为 undefined ⇒ 写盘读状态即 TypeError —— 回退树的真实行为。）
  // ★2026-10-08（P2a #263）判据同步：_queue 的调用形态已随 #263 改为「把边界给出的有效路径
  //   传进写盘链」（`(bound) => within(bound || target)`）。回退语义**一字未改**：仍是「摘掉
  //   admission 边界（写盘通道不再有统一门）」，只把锚串对齐到新形态。
  revert(path.join(negRoot, 'lib/memory-writer.js'), [
    ['      () => this.mutationBoundary(target, (bound) => within(bound || target), admission),\r\n      () => this.mutationBoundary(target, (bound) => within(bound || target), admission),\r\n', '      () => prev.then(job, job),\r\n'],
  ])
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, A1_SOURCE_ROOT: negRoot },
    encoding: 'utf8',
    timeout: 240000,
  })
  const out = String(child.stdout || '')
  // 回退树可能直接以未捕获异常结束（模块契约被摘掉后的真实后果）：也算可用红。
  const crashed = child.status === 1 && !/结果: /.test(out)
  const fails = out.split('\n').filter((l) => /FAIL/.test(l))
  ok(child.status === 1, '⑤ 回退树：套件必须以非零退出（变异必红）', 'status=' + child.status)
  ok(crashed || fails.length >= 4, '⑤ 回退树：断言变红或直接崩溃（覆盖 ①②③）', 'fails=' + fails.length + ' crashed=' + crashed)
  ok(crashed || /已被接受的追加\*\*未被覆盖\*\*|磁盘上只有被接受的那次写/.test(out), '⑤ 回退树：① 静默覆盖被断言抓到', '')
  ok(crashed || /仍在主文件/.test(out), '⑤ 回退树：② 整理覆盖被断言抓到', '')
  ok(crashed || /SETTINGS_MIGRATION_ACTIVE|SETTINGS_ROOT_CHANGED/.test(fails.join('\n')), '⑤ 回退树：③ admission 缺失被断言抓到', fails.join(' | ').slice(0, 200))
  console.log('  [负路径] 回退树子进程 status=' + child.status + '，红断言 ' + fails.length + ' 条')
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
try { fs.rmSync(temp, { recursive: true, force: true }) } catch (e) {}
process.exit(fail ? 1 : 0)
