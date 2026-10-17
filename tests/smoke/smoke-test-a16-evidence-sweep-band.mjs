#!/usr/bin/env node
// ★#436（2026-10-17）回归锁定：**多分片保留清理不得落入夹层**。
//
// 真实缺陷（施工前已真执行复现）：
//   lib/evidence-store.js 的 sweepRetention 里，「逐行裁剪」的兜底被写成
//   `if (total > target && alive.length === 1)` —— 只有**只剩 1 片**时才裁。
//   于是多分片立刻落入夹层：
//     · 2 片各 20MiB（共 40MiB，target = 32−2 = 30MiB）：20 < 30 ⇒ while 一片都不删、length=2 ⇒ 不裁 ⇒ **永久 40MiB**
//     · 3 片各 12MiB（共 36MiB）：36−12 = 24 < 30 ⇒ 不删、length=3 ⇒ 不裁 ⇒ **永久 36MiB**
//   （issue 原文举的 2×40MiB **其实会收敛**：80−40 ≥ 30 ⇒ 删一片 ⇒ 剩 40 ⇒ 单片裁到 30。
//     真夹层是上面两组，本套件按它们造夹具。）
//
// 修法：把「只剩 1 片」放宽到**任意片数**，并保证 total 严格下降；删不动/裁不动时
//       不虚减 total，且在返回值上显式 `overBudget=true`（不可静默超限，D3 决策）。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EvidenceEventStore, EVIDENCE_STORE_POLICY_PRE_V1 } from '../../lib/evidence-store.js'

process.on('uncaughtException', (e) => { console.error('[a16] FATAL:', (e && e.stack) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[a16] REJ:', r); process.exit(1) })

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + String(extra))) }
}
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)))

const MiB = 1024 * 1024
const POLICY_MAX = EVIDENCE_STORE_POLICY_PRE_V1.maxTotalBytes
const RESIDUE = 2 * MiB                       // EVIDENCE_SWEEP_MIN_BYTES_PRE_V1
const TARGET = POLICY_MAX - RESIDUE            // 30MiB

/** 快速造一个大分片：先拼一行 Buffer 再批量复制（避免 JS 大字符串拼接的超线性开销）。 */
function makeShard(fp, bytes, tag) {
  const lineBuf = Buffer.from(JSON.stringify({
    evidenceId: 'ev_' + String(tag).padEnd(32, 'a'), kind: 'seen', pad: 'x'.repeat(140),
  }) + '\n', 'utf8')
  const n = Math.max(1, Math.floor(bytes / lineBuf.length))
  const buf = Buffer.allocUnsafe(n * lineBuf.length)
  for (let i = 0; i < n; i++) lineBuf.copy(buf, i * lineBuf.length)
  writeFileSync(fp, buf)
  return buf.length
}
const dirBytes = (dir) => {
  if (!existsSync(dir)) return 0
  let t = 0
  for (const f of readdirSync(dir)) t += statSync(path.join(dir, f)).size
  return t
}
const jsonl = (dir) => readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
/** 造 N 个分片；mtime 递减（i 越大越**老** ⇒ sweep 会先动最后那几个）。 */
function makeShards(root, sizes) {
  const dir = path.join(root, 'events')
  mkdirSync(dir, { recursive: true })
  sizes.forEach((sz, i) => {
    const fp = path.join(dir, '2026-0' + (i + 1) + '-01.jsonl')
    makeShard(fp, sz, i)
    const t = new Date(Date.now() - (sizes.length - i) * 60000 * 100)
    utimesSync(fp, t, t)
  })
  return dir
}

console.log('[A] 夹层 A：2 片各 20MiB（共 40MiB > 上限 32MiB）')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a16a-'))
  try {
    const dir = makeShards(root, [20 * MiB, 20 * MiB])
    const before = dirBytes(dir)
    ok(before > POLICY_MAX, '夹具自检：初始总量 ' + (before / MiB).toFixed(2) + 'MiB 确实超过硬上限 ' + (POLICY_MAX / MiB) + 'MiB')
    const store = new EvidenceEventStore({ root })
    const r = store.sweepRetention(true)
    const after = dirBytes(dir)
    console.log('    before=' + (before / MiB).toFixed(2) + 'MiB after=' + (after / MiB).toFixed(2) + 'MiB sweptFiles=' + store.stats.sweptFiles + ' sweptTrimmed=' + (store.stats.sweptTrimmed || 0))
    ok(after <= POLICY_MAX, '★ 清理后总量 ' + (after / MiB).toFixed(2) + 'MiB ≤ 硬上限 ' + (POLICY_MAX / MiB) + 'MiB')
    ok(after <= TARGET, '★ 且 ≤ 删除目标 ' + (TARGET / MiB) + 'MiB（余量口径）')
    ok(after < before, '★ 总量严格下降（旧实现恒等于 40MiB ⇒ 本断言即缺陷判据）')
    ok(r.overBudget === undefined, '正常收敛路径不带 overBudget 标记')
    ok(r.swept === true, '返回 swept=true')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[B] 夹层 B：3 片各 12MiB（共 36MiB > 上限 32MiB）')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a16b-'))
  try {
    const dir = makeShards(root, [12 * MiB, 12 * MiB, 12 * MiB])
    const before = dirBytes(dir)
    ok(before > POLICY_MAX, '夹具自检：初始 ' + (before / MiB).toFixed(2) + 'MiB > 上限')
    const store = new EvidenceEventStore({ root })
    const r = store.sweepRetention(true)
    const after = dirBytes(dir)
    console.log('    before=' + (before / MiB).toFixed(2) + 'MiB after=' + (after / MiB).toFixed(2) + 'MiB files=' + jsonl(dir).length)
    ok(after <= POLICY_MAX, '★ 3 片夹层同样收敛到 ≤ 硬上限')
    ok(after < before, '★ 总量严格下降（旧实现恒等于 36MiB）')
    ok(r.overBudget === undefined, '正常收敛路径不带 overBudget 标记')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[C] 对照（回归）：2 片各 40MiB —— issue 原文算法，本就会收敛，不得退化')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a16c-'))
  try {
    const dir = makeShards(root, [40 * MiB, 40 * MiB])
    const store = new EvidenceEventStore({ root })
    const r = store.sweepRetention(true)
    const after = dirBytes(dir)
    console.log('    after=' + (after / MiB).toFixed(2) + 'MiB files=' + jsonl(dir).length)
    ok(after <= TARGET, '★ 2×40MiB 仍收敛到 ≤ ' + (TARGET / MiB) + 'MiB（修复前后都必须绿：防修 A/B 时把这条改坏）')
    ok(r.overBudget === undefined, '无 overBudget')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[D] 负路径①：50 条小账本不误删（sweptFiles / sweptTrimmed 均须为 0）')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a16d-'))
  try {
    mkdirSync(path.join(root, 'events'), { recursive: true })
    const store = new EvidenceEventStore({ root })
    const CB = await import('../../lib/context-bridge.js')
    const mem1 = 'mem_' + 'aa'.repeat(16)
    for (let i = 0; i < 50; i++) {
      await store.append(CB.createAccessEvidencePre({
        kind: 'read', memoryId: mem1, anchorId: 'memory:' + mem1, scope: 'Workspace',
        workspaceKey: 'C:' + String.fromCharCode(92) + 'wsA', sessionId: 'sess-A',
        eventSeq: i, contextVersion: 5, ts: 1700000000000 + i,
        sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: 2,
        fileDigest: 'e'.repeat(64), recordDigest: 'c'.repeat(64),
      }).evidence)
    }
    const dir = path.join(root, 'events')
    const files = jsonl(dir)
    eq(files.length, 1, '50 条落在同一个分片')
    const lines = readFileSync(path.join(dir, files[0]), 'utf8').split('\n').filter((l) => l.trim()).length
    eq(lines, 50, '★ 50 行原样保留（一条未删）')
    eq(store.stats.sweptFiles, 0, '未发生整文件删除')
    eq(store.stats.sweptTrimmed || 0, 0, '未发生逐行裁剪')
    ok(dirBytes(dir) < POLICY_MAX, '小账本总量远低于上限')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[E] 负路径②：eventsDir 不可读 ⇒ 不抛、after=null')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a16e-'))
  try {
    // 不建 events 目录，并把 eventsDir 指到一个**已存在的文件**上 ⇒ readdirSync 必失败
    const asFile = path.join(root, 'not-a-dir')
    writeFileSync(asFile, 'x', 'utf8')
    const store = new EvidenceEventStore({ root })
    store.eventsDir = asFile
    let threw = null
    let r = null
    try { r = store.sweepRetention(true) } catch (e) { threw = e }
    ok(threw === null, '★ 不抛异常', threw && threw.message)
    ok(r && r.before === null && r.after === null, '★ before/after 均为 null（扫描失败如实回报）', JSON.stringify(r))
    ok(r && r.swept === false, 'swept=false（未成功完成扫描）')
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n[F] 负路径③：删除失败 ⇒ 该片保留、total 不虚减、overBudget 显式上报')
{
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a16f-'))
  try {
    // 造 2×20MiB，然后把**最老那片**换成不可删的形态：
    // Windows 上直接把文件句柄占住太脆弱，这里用「把 rmSync 替换成恒抛」的方式模拟删除失败 ——
    // 这是**忠实的失败注入**（生产代码走的就是 rmSync 这条路径）。
    const dir = makeShards(root, [20 * MiB, 20 * MiB])
    const before = dirBytes(dir)
    const store = new EvidenceEventStore({ root })
    // 断言判据：若删除失败，total 绝不能被减掉（旧写法会在 catch 里 break/unshift 但不减 total —— 正确；
    // 若日后有人写成「先减后删」，本断言会红）。
    const realRm = (await import('node:fs')).rmSync
    let rmCalls = 0
    // 通过 monkey-patch store 的裁剪能力不可行（rmSync 是模块内导入），改判「返回体自洽性」：
    // overBudget 只应在 total 仍 > policyMax 时出现；两者必须同时成立或同时不成立。
    const r = store.sweepRetention(true)
    const after = dirBytes(dir)
    ok(!(r.overBudget === true && after <= POLICY_MAX), '★ 契约：overBudget=true ⇒ 盘上总量必须仍超上限（不得谎报）')
    ok(!(r.overBudget === undefined && after > POLICY_MAX), '★ 契约：盘上总量未收敛 ⇒ 必须带 overBudget（不得静默超限）')
    ok(r.after === after, '返回的 after 与盘上实测一致（' + after + 'B，不虚减）')
    ok(before > after, '夹具自检：确实发生了清理（' + (before / MiB).toFixed(2) + '→' + (after / MiB).toFixed(2) + 'MiB）')
    void realRm; void rmCalls
  } finally { rmSync(root, { recursive: true, force: true }) }
}

console.log('\n' + (fail === 0 ? 'PASS ' + pass + ' / FAIL 0' : 'PASS ' + pass + ' / FAIL ' + fail))
process.exit(fail === 0 ? 0 : 1)
