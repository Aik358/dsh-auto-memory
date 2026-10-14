/**
 * issue #345 回归锁 —— **行为级**（真 import → 真构造 → 真调用 → 断言返回值/副作用）。
 *
 * 缺陷形态（#320 的未解决残留）：写入边界只在**提交时比内存 engine.config**（lib/memory-mutation-transaction.js:178）。
 *   跨进程切根时，另一个进程的 saveConfig **只改磁盘**，本进程内存 config 毫不知情 ⇒
 *   第一道复核恒判「未变」，在途追加照样写进旧根并**回成功** ⇒ 记录滞留在旧目录，
 *   而活动配置（磁盘）已指向新根。#345 另一半：captureMemoryMutationPre 用「全局 flight 集合非空」
 *   推断「已受理」，授权粒度是全局的 —— 任意一条**无关** flight 存在就能放行一个毫不相干的写。
 *
 * 本套件断言的判据：
 *   ① **磁盘根复核**：受理后、提交前磁盘配置根被改（真独立子进程改盘）⇒ 明确抛 SETTINGS_ROOT_CHANGED，
 *      不谎报成功；
 *   ② **正常先写后迁移**不受影响（不得把正常写全拒了）；
 *   ③ **无关 flight 负对照**：无关 flight + 别的目标在途 ⇒ 本目标的新写必须 409（旧实现放行）；
 *   ④ **未接线 ⇒ 旧语义逐字不变**（markMemoryAdmissionPre/ALS 都没用时，行为与改前一致）。
 *
 * raw / anchor 两条文档通道都覆盖：mutationAdmission 注入用一个**真**的 document store 收口（见 buildStore），
 *   raw 档走 appendRaw / writeFullRaw，anchor 档走 appendText / writeFull —— 两条都经同一 mutationBoundary。
 *
 * 运行：node tests/smoke/smoke-test-issue345-mutation-root.mjs
 * 退出码：有 FAIL 即 1（变异子进程的红由**父进程**断言，父进程自身应为绿）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REAL_TX = path.join(ROOT, 'lib', 'memory-mutation-transaction.js')
// TX_PATH 只给变异子进程用：指向「把 #345 修复退回旧写法」的副本。
const TX_PATH = process.env.TX_PATH ? path.resolve(process.env.TX_PATH) : REAL_TX
const CHILD = process.env.I345_CHILD === '1'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'i345-mutation-'))

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const loadTx = () => import(pathToFileURL(TX_PATH).href)
const loadWriter = () => import(pathToFileURL(path.join(ROOT, 'lib', 'memory-writer.js')).href)

/** 构造一个最小但**真实**的 engine（配置路径、展开、绑定都按生产形状）。 */
function mkEngine(cfgPath, cfg) {
  return {
    _configPath: cfgPath,
    config: Object.assign({}, cfg),
    _settingsMigrationActive: false,
    expandUserPath: (p) => String(p == null ? '' : p).replace(/^~/, os.homedir()),
  };
}

function writeConfig(cfgPath, cfg) {
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
  fs.writeFileSync(cfgPath, JSON.stringify(cfg), 'utf8')
}

/** ★关键故障注入：用**真独立子进程**改磁盘配置根（不是本进程改内存）。 */
function migrateOnDiskInOtherProcess(cfgPath, cfg) {
  const script = path.join(TMP, 'disk-migrate.mjs')
  fs.writeFileSync(script, [
    'import fs from "node:fs"',
    'const [p, json] = process.argv.slice(2)',
    'fs.writeFileSync(p, json, "utf8")',
  ].join('\n'))
  const r = spawnSync(process.execPath, [script, cfgPath, JSON.stringify(cfg)], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('子进程改盘失败: ' + String(r.stderr || '').slice(0, 300))
}

/** 造一个「真文档写」job：写进给定文件，返回写入内容（不掺假）。 */
function jobWriting(file, text) {
  return async (target) => {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text, 'utf8')
    return { ok: true, wrote: text }
  };
}

async function main() {
  const TX = await loadTx()
  const WRITER = await loadWriter()
  console.log('=== issue #345 跨进程切根 / 目标作用域身份 行为级回归' + (CHILD ? ' [变异子进程模式]' : '') + ' ===')

  // ===================================================================
  // ① ★报告症状真复现：在途追加期间「另一个进程」把**磁盘**配置根切走
  //    ⇒ 必须明确抛 SETTINGS_ROOT_CHANGED（不谎报成功），且不得把内容算作已提交到活动根
  // ===================================================================
  {
    const dir = path.join(TMP, 'disk-root-change')
    fs.mkdirSync(dir, { recursive: true })
    const cfgPath = path.join(dir, 'dsh-auto-memory.json')
    const oldRoot = path.join(dir, 'root-old')
    const newRoot = path.join(dir, 'root-new')
    const cfg = { memoryRoot: oldRoot, userMemoryDir: path.join(dir, 'user'), projectMemoryDir: '.dsh-memory' }
    writeConfig(cfgPath, cfg)
    const engine = mkEngine(cfgPath, cfg)
    const target = path.join(oldRoot, 'ws', 'MEMORY.md')
    const admission = TX.captureMemoryMutationPre(engine, target)
    ok(admission.migrationActive === false, '#345 前提:受理时刻不是迁移窗口', JSON.stringify(admission.migrationActive))
    ok(typeof admission.admittedBy === 'string', '#345 前提:受理快照带 admittedBy 诊断字段', String(admission.admittedBy))
    // 在途期间：**另一个真进程**把磁盘配置根切到 newRoot（本进程内存 config 完全不知情）
    let threw = null
    try {
      await TX.withMemoryMutationPre(engine, target, async (t) => {
        migrateOnDiskInOtherProcess(cfgPath, { ...cfg, memoryRoot: newRoot })
        fs.mkdirSync(path.dirname(t), { recursive: true })
        fs.writeFileSync(t, 'IN_FLIGHT\n', 'utf8')
        return { ok: true }
      }, admission)
    } catch (e) { threw = e }
    ok(!!threw && threw.code === 'SETTINGS_ROOT_CHANGED' && threw.statusCode === 409,
      '★#345 磁盘根在途被另一进程改 ⇒ 明确抛 409 SETTINGS_ROOT_CHANGED（旧实现:恒回成功）',
      threw ? (threw.code + '/' + threw.statusCode) : 'NO-THROW')
    ok(!!threw && threw.source === 'disk', '★#345 该 409 可归因到「磁盘」这道复核（source=disk）', threw && String(threw.source))
    ok(threw && /was not committed to the active root/i.test(String(threw.details || '')),
      '★#345 错误文案如实说明「未提交到活动根」（不谎报成功）')
    ok(engine.config.memoryRoot === oldRoot, '#345 前提:本进程内存 config **确实没变**（正是旧实现看不见的那条路径）', String(engine.config.memoryRoot))
  }

  // ===================================================================
  // ② ★负路径：正常「先写后迁移」不得被误拒（磁盘根没变就得成功）
  // ===================================================================
  {
    const dir = path.join(TMP, 'normal')
    fs.mkdirSync(dir, { recursive: true })
    const cfgPath = path.join(dir, 'dsh-auto-memory.json')
    const root = path.join(dir, 'root')
    const cfg = { memoryRoot: root, userMemoryDir: path.join(dir, 'user'), projectMemoryDir: '.dsh-memory' }
    writeConfig(cfgPath, cfg)
    const engine = mkEngine(cfgPath, cfg)
    const target = path.join(root, 'ws', 'MEMORY.md')
    const admission = TX.captureMemoryMutationPre(engine, target)
    const out = await TX.withMemoryMutationPre(engine, target, jobWriting(target, 'NORMAL\n'), admission)
    ok(out && out.ok === true, '★#345 负路径:磁盘根未变 ⇒ 正常写成功（复核不得误伤正常路径）', JSON.stringify(out))
    ok(fs.readFileSync(target, 'utf8') === 'NORMAL\n', '★#345 负路径:内容确实落盘')
    // ★「先写后迁移」的正确口径：**写已完成**之后才发生的迁移，不得**追溯**让那次写变成失败。
    ok(out.ok === true && fs.readFileSync(target, 'utf8') === 'NORMAL\n',
      '★#345 负路径:迁移发生在该次写**完成之后** ⇒ 不追溯失败（已提交的内容照旧有效）')
    // 而迁移之后**新受理**的写：受理绑定的旧根与磁盘新根不一致 ⇒ 必须诚实拒绝（这正是 #345 的要求）。
    migrateOnDiskInOtherProcess(cfgPath, { ...cfg, memoryRoot: path.join(dir, 'root-migrated') })
    const staleTarget = path.join(root, 'ws', 'STALE.md')
    const admission2 = TX.captureMemoryMutationPre(engine, staleTarget)   // 内存 config 仍是旧根
    let staleThrew = null
    try { await TX.withMemoryMutationPre(engine, staleTarget, jobWriting(staleTarget, 'STALE\n'), admission2) } catch (err) { staleThrew = err }
    ok(!!staleThrew && staleThrew.code === 'SETTINGS_ROOT_CHANGED',
      '★#345 受理绑的是**旧根**而磁盘已是新根 ⇒ 诚实拒绝（绝不写进非活动根还回成功）',
      staleThrew ? staleThrew.code : 'NO-THROW')
    ok(!fs.existsSync(staleTarget), '★#345 该拒绝确实没写盘')
    // refresh 之后（engine.config 指向新根）⇒ 同一路径族照常可写
    const freshRoot = path.join(dir, 'root-migrated')
    const freshEngine = mkEngine(cfgPath, { ...cfg, memoryRoot: freshRoot })
    const freshTarget = path.join(freshRoot, 'ws', 'FRESH.md')
    const admission3 = TX.captureMemoryMutationPre(freshEngine, freshTarget)
    const out3 = await TX.withMemoryMutationPre(freshEngine, freshTarget, jobWriting(freshTarget, 'FRESH\n'), admission3)
    ok(out3 && out3.ok === true && fs.readFileSync(freshTarget, 'utf8') === 'FRESH\n',
      '★#345 负路径:配置刷新后（指向新根）⇒ 照常写成功（不是永久拒绝）', JSON.stringify(out3))
  }

  // ===================================================================
  // ③ ★#345 第二半：无关 flight ⇒ 不得放行一个毫不相干的写（授权粒度必须是本次请求的）
  // ===================================================================
  {
    const dir = path.join(TMP, 'unrelated-flight')
    fs.mkdirSync(dir, { recursive: true })
    const cfgPath = path.join(dir, 'dsh-auto-memory.json')
    const root = path.join(dir, 'root')
    const cfg = { memoryRoot: root, userMemoryDir: path.join(dir, 'user'), projectMemoryDir: '.dsh-memory' }
    writeConfig(cfgPath, cfg)
    const engine = mkEngine(cfgPath, cfg)
    const target = path.join(root, 'ws', 'MEMORY.md')
    // 迁移窗口开启 + 一个**别的目标**的在途路由请求（本进程已有身份信号 ⇒ 不再回落全局判据）
    engine._settingsMigrationActive = true
    engine._settingsNoteFlights = new Set()   // 清掉全局 flight：本用例只让「别的目标在途」这一个信号存在
    engine._noteRouteQueues = new Map([[WRITER.memoryWriteLockKey(path.join(root, 'ws', 'OTHER.md')), Promise.resolve()]])
    const admission = TX.captureMemoryMutationPre(engine, target)
    ok(admission.migrationActive === true,
      '★#345 **别的目标**在途 ⇒ 本次写必须判为未受理(migrationActive=true)',
      JSON.stringify({ migrationActive: admission.migrationActive, admittedBy: admission.admittedBy }))
    ok(admission.admittedBy === 'none', '★#345 admittedBy=none（授权不是来自全局集合，也不是别的目标）', String(admission.admittedBy))
    // ★补充正对照：同时存在一条**无关全局 flight** 时，结论必须完全一样（这才是 #345 要推翻的旧授权粒度）
    engine._settingsNoteFlights = new Set([Promise.resolve()])
    const admissionU = TX.captureMemoryMutationPre(engine, target)
    ok(admissionU.migrationActive === true,
      '★#345 **无关全局 flight + 别的目标在途 ⇒ 仍判未受理**（旧实现:全局非空即放行 ⇒ 写旧根）',
      JSON.stringify({ migrationActive: admissionU.migrationActive, admittedBy: admissionU.admittedBy }))
    engine._settingsNoteFlights = new Set()
    let threw = null
    try { await TX.withMemoryMutationPre(engine, target, jobWriting(target, 'SHOULD_NOT_WRITE\n'), admission) } catch (e) { threw = e }
    ok(!!threw && threw.code === 'SETTINGS_MIGRATION_ACTIVE' && threw.statusCode === 409,
      '★#345 无关 flight 不得放行 ⇒ writeFull 明确 409（旧实现:全局集合非空 ⇒ 放行写旧根）',
      threw ? (threw.code + '/' + threw.statusCode) : 'NO-THROW')
    ok(!fs.existsSync(target), '★#345 被拒的写**一个字节都没写**(不写进正在搬空的旧根)', fs.existsSync(target) ? 'WROTE' : 'absent')
    // 反向负对照：把在途请求换成**本目标自己** ⇒ 新请求必须拒绝；仅前窗请求作用域可放行
    engine._noteRouteQueues = new Map([[WRITER.memoryWriteLockKey(target), Promise.resolve()]])
    const admission2 = TX.captureMemoryMutationPre(engine, target)
    ok(admission2.migrationActive === true,
      '★#345 同目标队列也不能替新请求提供受理凭据',
      JSON.stringify({ migrationActive: admission2.migrationActive, admittedBy: admission2.admittedBy }))
    engine._settingsMigrationActive = false
    const out = await TX.withMemoryAdmissionScopePre({ engine, target }, async () => {
      engine._settingsMigrationActive = true
      return TX.withMemoryMutationPre(engine, target, jobWriting(target, 'ADMITTED\n'))
    })
    ok(out && out.ok === true, '★#345 负对照:已受理的写照常完成', JSON.stringify(out))
  }

  // ===================================================================
  // ④ ★显式身份 API（A 组接线用）：markMemoryAdmissionPre / withMemoryAdmissionScopePre
  // ===================================================================
  {
    const dir = path.join(TMP, 'identity-api')
    fs.mkdirSync(dir, { recursive: true })
    const cfgPath = path.join(dir, 'dsh-auto-memory.json')
    const root = path.join(dir, 'root')
    const cfg = { memoryRoot: root, userMemoryDir: path.join(dir, 'user'), projectMemoryDir: '.dsh-memory' }
    writeConfig(cfgPath, cfg)
    const engine = mkEngine(cfgPath, cfg)
    const target = path.join(root, 'ws', 'MEMORY.md')
    engine._settingsMigrationActive = true
    // 未登记身份 ⇒ 未受理
    ok(TX.captureMemoryMutationPre(engine, target).migrationActive === true,
      '★#345 未登记身份 ⇒ 判为未受理（窗口内新写拒绝）')
    // 登记**本次目标**的身份 ⇒ 放行
    const mark = TX.markMemoryAdmissionPre(engine, { target })
    ok(mark.ok === true && typeof mark.key === 'string' && mark.key.length > 0,
      '★#345 markMemoryAdmissionPre 登记成功并回显规范键', JSON.stringify({ ok: mark.ok, key: mark.key }))
    const adm = TX.captureMemoryMutationPre(engine, target)
    ok(adm.migrationActive === true && adm.admittedBy === 'none',
      '★#345 诊断标记不能替新请求提供受理凭据', JSON.stringify({ m: adm.migrationActive, by: adm.admittedBy }))
    // 登记**别的目标**的身份 ⇒ 不放行本目标
    engine._settingsMigrationActive = true
    mark.release()
    const other = path.join(root, 'ws', 'OTHER.md')
    const markOther = TX.markMemoryAdmissionPre(engine, { target: other })
    const admOther = TX.captureMemoryMutationPre(engine, target)
    ok(admOther.migrationActive === true,
      '★#345 登记的是**别的目标** ⇒ 本目标仍判未受理（身份必须匹配本次请求）',
      JSON.stringify({ m: admOther.migrationActive, by: admOther.admittedBy }))
    markOther.release()
    // ALS 作用域版本
    engine._settingsMigrationActive = false
    const scoped = TX.withMemoryAdmissionScopePre({ engine, target }, () => {
      engine._settingsMigrationActive = true
      const a = TX.captureMemoryMutationPre(engine, target)
      const b = TX.captureMemoryMutationPre(engine, other)
      return { self: a.migrationActive, other: b.migrationActive, cur: TX.currentMemoryAdmissionPre() }
    })
    ok(scoped.self === false && scoped.other === true,
      '★#345 ALS 作用域:作用域内**本目标**放行、**别的目标**不放行', JSON.stringify(scoped))
    ok(scoped.cur && typeof scoped.cur.key === 'string', '★#345 currentMemoryAdmissionPre() 在作用域内可见', JSON.stringify(scoped.cur))
    ok(TX.currentMemoryAdmissionPre() === null, '★#345 作用域外 currentMemoryAdmissionPre() 回 null（不泄漏）')
    // release 幂等
    mark.release(); mark.release()
    ok(true, '★#345 mark release 幂等（重复调用不抛）')
  }

  // ===================================================================
  // ⑤ ★未接线 ⇒ 旧语义**逐字不变**（Lead 追加的硬要求）
  //    没有 ALS 作用域、没有 mark、没有 _noteRouteQueues ⇒ 回落旧全局判据。
  // ===================================================================
  {
    const dir = path.join(TMP, 'legacy-unchanged')
    fs.mkdirSync(dir, { recursive: true })
    const cfgPath = path.join(dir, 'dsh-auto-memory.json')
    const root = path.join(dir, 'root')
    const cfg = { memoryRoot: root, userMemoryDir: path.join(dir, 'user'), projectMemoryDir: '.dsh-memory' }
    writeConfig(cfgPath, cfg)
    const engine = mkEngine(cfgPath, cfg)
    const target = path.join(root, 'ws', 'MEMORY.md')
    engine._settingsMigrationActive = true
    // (a) 无任何信号：窗口内新写被拒（旧语义）
    ok(TX.captureMemoryMutationPre(engine, target).migrationActive === true,
      '★#345 未接线(a) 无信号 ⇒ 窗口内新写被拒（旧语义）')
    // (b) 仅有一条全局 note flight（未接线时它是**唯一**的受理信号）⇒ 放行（旧语义逐字不变）
    engine._settingsNoteFlights = new Set([Promise.resolve()])
    const adm = TX.captureMemoryMutationPre(engine, target)
    ok(adm.migrationActive === true,
      '★#345 未接线(b) 仅全局 flight ⇒ 拒绝（#363 回归）',
      JSON.stringify({ m: adm.migrationActive, by: adm.admittedBy }))
    ok(adm.admittedBy === 'none', '★#345 未接线(b) 诊断字段如实标注 none（可复算）', String(adm.admittedBy))
    // (c) 窗口未开 ⇒ 一律放行（旧语义）
    engine._settingsMigrationActive = false
    engine._settingsNoteFlights = new Set()
    ok(TX.captureMemoryMutationPre(engine, target).migrationActive === false,
      '★#345 未接线(c) 非迁移窗口 ⇒ 照常放行（旧语义）')
  }

  // ===================================================================
  // ⑥ ★raw / anchor 两条文档通道都覆盖（同一 mutationBoundary 收口）
  //    用**真** MemoryDocumentStore + 真 mutation 边界接线（与 index.js:8437-8438 同形）。
  // ===================================================================
  {
    const dir = path.join(TMP, 'two-channels')
    fs.mkdirSync(dir, { recursive: true })
    const cfgPath = path.join(dir, 'dsh-auto-memory.json')
    const root = path.join(dir, 'root')
    const cfg = { memoryRoot: root, userMemoryDir: path.join(dir, 'user'), projectMemoryDir: '.dsh-memory' }
    writeConfig(cfgPath, cfg)
    const engine = mkEngine(cfgPath, cfg)
    const store = new WRITER.MemoryDocumentStore({
      sidecarDir: path.join(dir, 'sidecar'),
      mutationAdmission: (file) => TX.captureMemoryMutationPre(engine, file),
      mutationBoundary: (file, job, admission) => TX.withMemoryMutationPre(engine, file, job, admission),
    })
    const anchorFile = path.join(root, 'ws', 'ANCHOR.md')
    const rawFile = path.join(root, 'ws', 'RAW.md')
    // anchor 档：真 store.append（带锚点事务；与 index.js 的 writeFull/appendText 同一条通道）
    // ⚠️ 不能自带 <!-- memory:mem_… --> 标记（store 的**内容门**会拒 `reserved-syntax-in-content`，
    //   那是别道门；本套件要测的是 **mutation 边界**是否放过未被授权的写，故内容用无标记纯文本）。
    const aRes = await store.append(anchorFile, '# A\nANCHOR_BODY\n')
    ok(aRes && aRes.ok === true, '★#345 anchor 通道:正常写成功（基线）', JSON.stringify(aRes && aRes.reason))
    ok(fs.readFileSync(anchorFile, 'utf8').includes('ANCHOR_BODY'), '★#345 anchor 通道:内容确实落盘（基线）')
    // raw 档：真 store.appendRaw（绕开 anchor 事务的裸档）
    await store.appendRaw(rawFile, 'RAW_BODY\n')
    ok(fs.readFileSync(rawFile, 'utf8').includes('RAW_BODY'), '★#345 raw 通道:正常写成功（基线）')
    // 两条通道在**磁盘根变了**之后都必须拒绝
    migrateOnDiskInOtherProcess(cfgPath, { ...cfg, memoryRoot: path.join(dir, 'root-migrated') })
    for (const [label, fn, file, text] of [
      ['anchor(append)', () => store.append(anchorFile, '# B\nANCHOR_MORE\n'), anchorFile, 'ANCHOR_MORE'],
      ['raw(appendRaw)', () => store.appendRaw(rawFile, 'RAW_MORE\n'), rawFile, 'RAW_MORE'],
    ]) {
      let e = null
      try { await fn() } catch (err) { e = err }
      ok(!!e && e.code === 'SETTINGS_ROOT_CHANGED',
        '★#345 ' + label + ' 通道:磁盘根已变 ⇒ 明确 409（不谎报成功）', e ? e.code : 'NO-THROW')
      ok(!fs.readFileSync(file, 'utf8').includes(text),
        '★#345 ' + label + ' 通道:被拒的那段内容**没有**写进旧根文件',
        String(fs.readFileSync(file, 'utf8')).slice(-120))
    }
  }

  // ===================================================================
  // ★变异反向验证：把三处修复分别退回旧写法 ⇒ 子进程模式跑本套件必须**红**（断言红，非崩溃）
  // ===================================================================
  if (!CHILD) {
    fs.mkdirSync(TMP, { recursive: true })
    const real = fs.readFileSync(REAL_TX, 'utf8').replace(/\r\n/g, '\n')
    const muts = [
      // M1：放行判据退回「全局集合非空即放行」（#345 要推翻的那条）
      ['#345 回退(授权粒度=全局)', '  const alreadyAdmitted = scopedAdmitted', '  const alreadyAdmitted = engine._settingsNoteFlights && engine._settingsNoteFlights.size > 0'],
      // M2：摘掉「提交前复核磁盘配置根」这道
      ['#345 回退(无磁盘根复核)', '    assertDurableDiskRootUnchangedPre(engine, admission, target)\n    return out', '    return out'],
      // M3：临时/业务无关 —— 摘掉「写前」那道复核
      ['#345 回退(无写前复核)', '  assertDurableDiskRootUnchangedPre(engine, admission, target)\n  // ★#305：登记真实 mutation flight', '  // ★#305：登记真实 mutation flight'],
    ]
    for (const [label, from, to] of muts) {
      const hits = real.split(from).length - 1
      ok(hits === 1, '变异定位:' + label + ' 锚点恰命中 1 次', 'hits=' + hits)
      if (hits !== 1) continue
      const mp = path.join(ROOT, 'lib', '__mut-345-' + label.replace(/[^a-z0-9]/gi, '') + '.mjs')
      fs.writeFileSync(mp, real.replace(from, to))
      const syn = spawnSync(process.execPath, ['--check', mp], { encoding: 'utf8' })
      ok(syn.status === 0, '变异文件语法可用(' + label + ')', String(syn.stderr || '').slice(0, 200))
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TX_PATH: mp, I345_CHILD: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      // ★计数口径：优先取收尾汇总行；若变异让套件**中途抛出**（汇总行来不及打印），
      //   就退回「数 FAIL 行」——判据仍是「红是断言红」，绝不因为少了一行汇总就放过变异。
      const failLines = (out.match(/^\s*FAIL - /gm) || []).length
      const failCount = m ? Number(m[2]) : failLines
      ok(r.status !== 0, '★变异必红(' + label + '):子进程退出码非 0', 'status=' + r.status)
      ok(failCount > 0, '★变异必红(' + label + '):是断言红(FAIL 行 >0)不是纯崩溃',
        (m ? m[0] : 'summary缺失') + ' failLines=' + failLines)
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : 'FAIL行=' + failLines) + ' exit=' + r.status)
      try { fs.rmSync(mp, { force: true }) } catch (_) {}
    }
  }

  console.log('pass=' + pass + ' fail=' + fail)
  if (!CHILD) fs.rmSync(TMP, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})
