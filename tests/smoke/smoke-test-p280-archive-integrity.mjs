/**
 * smoke-test-p280-archive-integrity —— 座位复用任务 P280：PR #280 本机落地（真缺口部分）。
 *
 * 真缺口三项（来源：refs/remotes/prhead/280 的 a97d287 / a9c0e24；见
 * docs/internal/AUDIT-20261008-PR280-DEDUP.md）：
 *   ① #280 A4  维护归档：写归档后**回读校验双摘要**（source + archive，均 sha256），
 *              通过才删源；期间源或归档被改动 ⇒ 抛 LOG_CHANGED_SINCE_ARCHIVE 且**不删源**。
 *   ② #280 B   「读源 + 发布归档」放进**同一个** _withMemoryMutationPre 事务，
 *              归档目标由**被受理的物理路径**推导（防重叠维护者发布过期副本）。
 *   ③ #280 A1  同步事件带**稳定 eventId**：入队带 ID、随队列持久化、重试保留同一 ID、
 *              同键新负载原位替换 ⇒ 旧发送确认不得删掉新版本。
 *
 * 判据纪律（CR-10）：每条都真 import → 真构造 → 真调用 → 断言**副作用**；
 * 每条都配**变异负路径**（真跑被改回缺陷形态的副本），变异必红、正式实现不复现。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-p280-'))
const home = path.join(temp, 'home')
fs.mkdirSync(home, { recursive: true })
const prevHome = process.env.DSH_HOME
process.env.DSH_HOME = home

let pass = 0, fail = 0
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? ' :: ' + extra : '')) }
}
const crypto = await import('node:crypto')

/** 建一个隔离引擎（真 audit-engine 驱动器 → 真 lib/index.js）。 */
let engineSeq = 0
async function makeEngine(sourceOverride) {
  if (sourceOverride) process.env.DAM_AUDIT_ENGINE_SOURCE = sourceOverride
  else delete process.env.DAM_AUDIT_ENGINE_SOURCE
  const mod = await import(pathToFileURL(path.join(ROOT, 'tests/lib/audit-engine.mjs')).href + '?v=' + Date.now())
  const engine = new mod.MemoryEngine()
  engine.configLoaded = true
  Object.assign(engine.config, {
    memoryRoot: path.join(home, 'mem-' + (++engineSeq)), userMemoryDir: path.join(home, 'user-' + engineSeq),
    memoryAnchorEnabled: false, associativeMemoryEnabled: false, teamEnabled: false,
    pythonBackendEnabled: false, dayBoundaryMinutes: 450,
  })
  return engine
}
const seedOldLogs = async (engine, names, body) => {
  const p = await engine.resolvePaths(null)
  fs.mkdirSync(p.projectDir, { recursive: true })
  for (const n of names) fs.writeFileSync(path.join(p.projectDir, n), body(n), 'utf8')
  return p
}

// =====================================================================
console.log('[P280] ② B：归档发布进 mutation 事务 + 跟随被受理的物理路径')
// =====================================================================
{
  const engine = await makeEngine()
  const names = ['2020-02-01.md', '2020-02-02.md']
  const p = await seedOldLogs(engine, names, (n) => '## ' + n + '\n- lexical body of ' + n + '\n')
  const order = []
  const srcA = path.join(p.projectDir, names[0])
  const admittedA = path.join(p.projectDir, 'admitted-copy.md')
  fs.writeFileSync(admittedA, '## ' + names[0] + '\n- ADMITTED body (boundary re-judged target)\n', 'utf8')

  const origBoundary = engine._withMemoryMutationPre.bind(engine)
  const origWriteFull = engine.writeFull.bind(engine)
  engine._withMemoryMutationPre = async (file, job, admission) => {
    order.push('enter:' + path.basename(file))
    // 模拟边界把目标改判到另一个物理文件（P1 根绑定复核的合法形态）
    const isArchive = String(file).includes(path.sep + 'archive' + path.sep)
    const target = (!isArchive && path.basename(file) === names[0]) ? admittedA : file
    return job(target)
  }
  engine.writeFull = async (target, text, opts) => {
    if (String(target).includes(path.sep + 'archive' + path.sep)) order.push('archive:' + path.basename(target))
    return origWriteFull(target, text, opts)
  }

  const msg = await engine.maintain(30, null)
  const archiveDir = path.join(p.projectDir, 'archive')

  ok(fs.existsSync(archiveDir), 'B 正路径：归档目录已建立')
  const archA = path.join(archiveDir, names[0])
  const bodyA = fs.readFileSync(archA, 'utf8')
  ok(bodyA.includes('ADMITTED body'), '★B：归档跟随**被受理的物理路径**（非 lexical 源）')
  ok(order.filter((x) => x.startsWith('enter:')).length >= 2, '★B：每个日志都进入 mutation 边界，实得 ' + JSON.stringify(order.filter((x) => x.startsWith('enter:'))))
  const iEnter = order.indexOf('enter:' + names[0])
  const iArch = order.indexOf('archive:' + names[0])
  ok(iEnter >= 0 && iArch > iEnter, '★B：归档发布发生在源事务**之内**（enter 先于 archive），实得 ' + JSON.stringify(order))
  ok(msg.includes('原文保底') || msg.includes('30 天蒸馏完成'), 'B 正路径：maintain 正常返回')
}

// =====================================================================
console.log('[P280] ① A4：正路径（无并发变动 ⇒ 行为与现状一致）')
// =====================================================================
{
  const engine = await makeEngine()
  const names = ['2020-03-01.md', '2020-03-02.md']
  const p = await seedOldLogs(engine, names, (n) => '## ' + n + '\n- normal body of ' + n + '\n')
  const before = {}
  for (const n of names) before[n] = fs.readFileSync(path.join(p.projectDir, n), 'utf8')

  const msg = await engine.maintain(30, null)
  const archiveDir = path.join(p.projectDir, 'archive')
  for (const n of names) {
    const a = path.join(archiveDir, n)
    ok(fs.existsSync(a), 'A4 正路径：归档文件存在 ' + n)
    ok(fs.readFileSync(a, 'utf8') === before[n], '★A4 正路径：归档内容与源**逐字节一致**（非边界守恒） ' + n)
    ok(!fs.existsSync(path.join(p.projectDir, n)), 'A4 正路径：源日志已删除 ' + n)
  }
  ok(!msg.includes('未删除'), 'A4 正路径：返回值无「未删除」提示，实得 ' + JSON.stringify(msg.slice(0, 120)))
}

// =====================================================================
console.log('[P280] ① A4 负路径：归档后、删除前篡改源 ⇒ 抛错且源仍在')
// =====================================================================
{
  const engine = await makeEngine()
  const names = ['2020-04-01.md']
  const p = await seedOldLogs(engine, names, (n) => '## ' + n + '\n- ORIGINAL body\n')
  const src = path.join(p.projectDir, names[0])
  const thrown = []
  const origBoundary = engine._withMemoryMutationPre.bind(engine)
  const origWriteFull = engine.writeFull.bind(engine)
  engine._withMemoryMutationPre = async (file, job, admission) => {
    try { return await origBoundary(file, job, admission) }
    catch (e) { thrown.push(e && e.code); throw e }
  }
  engine.writeFull = async (target, text, opts) => {
    const r = await origWriteFull(target, text, opts)
    // ★归档已发布、删除尚未发生 —— 此刻篡改源日志（模拟并发改动）
    if (String(target).includes(path.sep + 'archive' + path.sep)) {
      fs.writeFileSync(src, '## ' + names[0] + '\n- CONCURRENT body written after archive\n', 'utf8')
    }
    return r
  }

  const msg = await engine.maintain(30, null)
  ok(thrown.includes('LOG_CHANGED_SINCE_ARCHIVE'), '★A4 负路径：抛 LOG_CHANGED_SINCE_ARCHIVE，实得 ' + JSON.stringify(thrown))
  ok(fs.existsSync(src), '★A4 负路径：源文件**仍在**（未被删除）')
  ok(fs.readFileSync(src, 'utf8').includes('CONCURRENT body'), '★A4 负路径：并发写入的内容未被丢失')
  ok(msg.includes('未删除') && msg.includes(names[0]), 'A4 负路径：返回值如实列出未删除项，实得 ' + JSON.stringify(msg.slice(-120)))
  const archived = fs.readFileSync(path.join(p.projectDir, 'archive', names[0]), 'utf8')
  ok(archived.includes('ORIGINAL body'), 'A4 负路径：归档保留的是归档时刻的原文')
}

// =====================================================================
console.log('[P280] ① A4 变异负路径：去掉双摘要校验 ⇒ 必红（源被删、并发内容丢失）')
// =====================================================================
{
  // 生成「去掉双摘要校验」的 index.js 副本，并真跑同一场景（子进程，隔离 ESM 缓存）
  const mutated = path.join(temp, 'index-nodigest.mjs')
  let src = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8').replace(/\r\n/g, '\n')
  const needle = "          if (!expected || createHash('sha256').update(current).digest('hex') !== expected.source\n            || createHash('sha256').update(archivedBytes).digest('hex') !== expected.archive) {\n"
  assert.equal(src.split(needle).length - 1, 1, 'mutation anchor hit exactly 1')
  src = src.replace(needle, '          if (false) {\n')
  fs.writeFileSync(mutated, src)

  const driver = path.join(temp, 'driver.mjs')
  fs.writeFileSync(driver, [
    "import fs from 'node:fs'",
    "import os from 'node:os'",
    "import path from 'node:path'",
    "import { pathToFileURL } from 'node:url'",
    'const ROOT = ' + JSON.stringify(ROOT),
    'const home = fs.mkdtempSync(path.join(os.tmpdir(), "p280-drv-"))',
    'process.env.DSH_HOME = home',
    'process.env.DAM_AUDIT_ENGINE_SOURCE = process.argv[2]',
    "const { MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests/lib/audit-engine.mjs')).href)",
    'const engine = new MemoryEngine(); engine.configLoaded = true',
    'Object.assign(engine.config, { memoryRoot: path.join(home,"mem"), userMemoryDir: path.join(home,"user"), memoryAnchorEnabled:false, associativeMemoryEnabled:false, teamEnabled:false, pythonBackendEnabled:false, dayBoundaryMinutes:450 })',
    'const p = await engine.resolvePaths(null)',
    "const name = '2020-04-01.md'",
    'fs.mkdirSync(p.projectDir, { recursive: true })',
    "fs.writeFileSync(path.join(p.projectDir, name), '## ' + name + '\\n- ORIGINAL body\\n')",
    'const src = path.join(p.projectDir, name)',
    'const thrown = []',
    'const ob = engine._withMemoryMutationPre.bind(engine)',
    'const ow = engine.writeFull.bind(engine)',
    'engine._withMemoryMutationPre = async (f, j, a) => { try { return await ob(f, j, a) } catch (e) { thrown.push(e && e.code); throw e } }',
    'engine.writeFull = async (t, x, o) => { const r = await ow(t, x, o); if (String(t).includes(path.sep + "archive" + path.sep)) fs.writeFileSync(src, "## " + name + "\\n- CONCURRENT body written after archive\\n"); return r }',
    'try { await engine.maintain(30, null) } catch (e) {}',
    "console.log('P280RESULT ' + JSON.stringify({ sourceExists: fs.existsSync(src), thrown }))",
  ].join('\n'))

  const run = (engineSource) => {
    const r = spawnSync(process.execPath, [driver, engineSource], { encoding: 'utf8', timeout: 120000 })
    const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('P280RESULT '))
    assert.ok(line, 'driver produced result (stderr=' + String(r.stderr || '').slice(0, 300) + ')')
    return JSON.parse(line.slice('P280RESULT '.length))
  }
  const real = run(path.join(ROOT, 'lib/index.js'))
  ok(real.sourceExists === true && real.thrown.includes('LOG_CHANGED_SINCE_ARCHIVE'),
    '真实现（子进程真跑）：源保留 + 抛 LOG_CHANGED_SINCE_ARCHIVE，实得 ' + JSON.stringify(real))
  const mut = run(mutated)
  ok(mut.sourceExists === false, '★变异（去掉双摘要校验）后源被删 ⇒ 负路径必红，实得 sourceExists=' + mut.sourceExists)
  ok(!mut.thrown.includes('LOG_CHANGED_SINCE_ARCHIVE'), '变异后不再抛该错，实得 ' + JSON.stringify(mut.thrown))
}

// =====================================================================
console.log('[P280] ③ A1：team-outbox 稳定 eventId（入队/持久化/重试/版本替换）')
// =====================================================================
{
  const { createTeamOutbox } = await import(pathToFileURL(path.join(ROOT, 'lib/team-outbox.js')).href)
  const dir = path.join(temp, 'outbox1')
  const ob = createTeamOutbox({ dir })

  // 正路径①：同键同负载 ⇒ 仍幂等（非边界守恒）
  ok(ob.enqueue({ kind: 'handoff', key: 'k1', payload: { a: 1 }, eventId: 'ev-1' }).ok === true, 'A1：首次入队 ok')
  const dup = ob.enqueue({ kind: 'handoff', key: 'k1', payload: { a: 1 }, eventId: 'ev-1' })
  ok(dup.ok === true && dup.dup === true, '★A1 非边界守恒：同键**同负载**仍判 dup:true，实得 ' + JSON.stringify(dup))

  // 正路径②：eventId 随队列持久化
  const disk1 = JSON.parse(fs.readFileSync(path.join(dir, 'team-outbox.json'), 'utf8'))
  ok(disk1.items[0].eventId === 'ev-1', '★A1：eventId 已持久化到磁盘，实得 ' + disk1.items[0].eventId)
  const ob2 = createTeamOutbox({ dir })
  ob2.load()
  ok(ob2.list()[0].eventId === 'ev-1', '★A1：重载后 eventId 保留，实得 ' + ob2.list()[0].eventId)

  // 正路径③：重试保留同一 eventId
  const seen = []
  const failSender = async (item) => { seen.push(item.eventId); throw new Error('network down') }
  const r1 = await ob.flush(failSender)
  ok(r1.failed === 1 && ob.size() === 1, 'A1：发送失败 ⇒ 条目留在队列，实得 failed=' + r1.failed + ' size=' + ob.size())
  const okSender = async (item) => { seen.push(item.eventId) }
  const r2 = await ob.flush(okSender)
  ok(r2.sent === 1 && ob.size() === 0, 'A1：重试成功出队，实得 sent=' + r2.sent)
  ok(seen.length === 2 && seen[0] === 'ev-1' && seen[1] === 'ev-1',
    '★A1：两次投递使用的是**同一个** eventId，实得 ' + JSON.stringify(seen))
}

// =====================================================================
console.log('[P280] ③ A1 负路径：同键新负载替换 ⇒ 旧确认不得删掉新版本')
// =====================================================================
{
  const { createTeamOutbox } = await import(pathToFileURL(path.join(ROOT, 'lib/team-outbox.js')).href)
  const dir = path.join(temp, 'outbox2')
  const ob = createTeamOutbox({ dir })
  ob.enqueue({ kind: 'handoff', key: 'same', payload: { v: 1 }, eventId: 'ev-old' })

  const delivered = []
  let updated = null
  const slowSender = async (item) => {
    delivered.push(item.eventId)
    // 在途期间：同键**新负载**（新 eventId）入队 —— 这是被防的「旧确认吃掉新版本」
    updated = ob.enqueue({ kind: 'handoff', key: 'same', payload: { v: 2 }, eventId: 'ev-new' })
  }
  const r = await ob.flush(slowSender)
  ok(updated && updated.ok === true && updated.updated === true,
    '★A1：同键新负载 ⇒ 原位替换（updated:true），实得 ' + JSON.stringify(updated))
  ok(delivered.length === 1 && delivered[0] === 'ev-old', 'A1：在途发送的仍是旧版本，实得 ' + JSON.stringify(delivered))
  ok(ob.size() === 1, '★A1：旧发送确认**没有删掉新版本**（队列仍留 1 条），实得 size=' + ob.size())
  ok(ob.list()[0].payload.v === 2 && ob.list()[0].eventId === 'ev-new',
    '★A1：留存的是新版本，实得 ' + JSON.stringify(ob.list()[0]))
  const delivered2 = []
  await ob.flush(async (item) => { delivered2.push(item.eventId) })
  ok(delivered2.length === 1 && delivered2[0] === 'ev-new', '★A1：新版本随后被投递，实得 ' + JSON.stringify(delivered2))
}

// =====================================================================
console.log('[P280] ③ A1 变异负路径：恢复「同键一律 dup（不看负载）」⇒ 必红')
// =====================================================================
{
  const mutated = path.join(temp, 'team-outbox-old.mjs')
  let s = fs.readFileSync(path.join(ROOT, 'lib/team-outbox.js'), 'utf8')
  // The real outbox now shares the production path lock; keep the copied mutant resolvable.
  s = s.replace("'./shared-state-lock.js'", JSON.stringify(pathToFileURL(path.join(ROOT, 'lib/shared-state-lock.js')).href))
  const start = s.indexOf('      const previous = seen.get(dk)', s.indexOf('    enqueue(entry)'))
  const end = s.indexOf('      queue.push(item)', start)
  assert.ok(start > 0 && end > start, 'mutation span located')
  s = s.slice(0, start) + '      if (seen.has(dk)) return { ok: true, id, dup: true, dropped: 0, size: queue.length }\n' + s.slice(end)
  fs.writeFileSync(mutated, s)

  const { createTeamOutbox } = await import(pathToFileURL(mutated).href)
  const dir = path.join(temp, 'outbox3')
  const ob = createTeamOutbox({ dir })
  ob.enqueue({ kind: 'handoff', key: 'same', payload: { v: 1 }, eventId: 'ev-old' })
  let updated = null
  const delivered = []
  await ob.flush(async (item) => {
    delivered.push(item.eventId)
    updated = ob.enqueue({ kind: 'handoff', key: 'same', payload: { v: 2 }, eventId: 'ev-new' })
  })
  ok(updated && updated.dup === true && !updated.updated,
    '★变异（同键一律 dup）：新版本被当作重复**静默丢弃**，实得 ' + JSON.stringify(updated))
  ok(ob.size() === 0, '★变异后旧确认把条目删净 ⇒ 新版本永不投递 ⇒ 负路径必红，实得 size=' + ob.size())
}

process.env.DSH_HOME = prevHome
fs.rmSync(temp, { recursive: true, force: true })
console.log('[P280] PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exitCode = 1
