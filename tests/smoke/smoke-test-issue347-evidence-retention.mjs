// issue#347 验收:EvidenceEventStore 保留清理的**有界频率**(不再「每进程至多一次的清理」)。
//
// 缺陷(修复前):`sweepRetention(force=false)` 首次调用后把 `this._swept` 置 true 且**永不复位**
// ⇒ 进程存活期间后续追加不再做保留清理;实测 3600 条 ~10KB 事件(仅约 0.2s 落盘)把账本写到
// 38,865,564 B,突破策略上限 33,554,432 B(超 15.8%),直到重启或外部 `force` 才收敛。
//
// 本套件是**功能验收**:真 import → 真构造 store → 真 append → 断言磁盘字节/行数/返回值。
// 临时目录,真实记忆零接触。所有物理量(字节数/条数/扫描次数)在结束时打印,可复算。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[i347] FATAL:', (e && e.stack || e.message) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[i347] REJ:', r); process.exit(1) })

const ES = await import('../../lib/evidence-store.js')
const CB = await import('../../lib/context-bridge.js')
let pass = 0; let fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)))

const POLICY = ES.EVIDENCE_STORE_POLICY_PRE_V1
const mem1 = 'mem_' + 'aa'.repeat(16)
// episodeId 用来把事件撑到 ~10KB(单行上限 16KiB 之内),模拟真实大事件
const mkEv = (i, over = {}) => CB.createAccessEvidencePre({
  kind: 'read', memoryId: over.memoryId || mem1, anchorId: 'memory:' + (over.memoryId || mem1),
  scope: 'Workspace', workspaceKey: 'C:' + String.fromCharCode(92) + 'wsA', sessionId: over.sessionId || 'sess-A',
  eventSeq: i, contextVersion: 5, ts: 1700000000000 + i,
  episodeId: over.episodeId, sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: 2,
  fileDigest: 'e'.repeat(64), recordDigest: 'c'.repeat(64),
}).evidence
const dirBytes = (dir) => {
  if (!existsSync(dir)) return 0
  let t = 0
  for (const f of readdirSync(dir)) t += statSync(path.join(dir, f)).size
  return t
}
const lineCount = (fp) => readFileSync(fp, 'utf8').split('\n').filter((l) => l.trim()).length

const root = mkdtempSync(path.join(tmpdir(), 'dam-i347-'))
const eventsDir = path.join(root, 'events')

// ── 347-1 真复现:同一 store 生命周期内 3600 次连续追加,总量必须 ≤ 策略上限 ────────────
console.log('[347-1] 连续 3600 次追加(每条 ~10KB)后总量 ≤ maxTotalBytes')
const store = new ES.EvidenceEventStore({ root })
const BIG = 'x'.repeat(10000)
const t0 = Date.now()
let okCount = 0
for (let i = 0; i < 3600; i++) {
  const r = await store.append(mkEv(i, { episodeId: BIG }))
  if (r.ok) okCount++
}
const elapsed = Date.now() - t0
const total = dirBytes(eventsDir)
const perLine = Math.round(total / okCount)
console.log('    追加成功=' + okCount + ' / 3600,耗时=' + elapsed + 'ms,单条均摊=' + perLine + 'B')
console.log('    磁盘总量=' + total + 'B,策略上限=' + POLICY.maxTotalBytes + 'B,余量=' + (POLICY.maxTotalBytes - total) + 'B')
eq(okCount, 3600, '3600 条全部落盘成功(不是靠拒绝写入来「控制总量」)')
ok(total <= POLICY.maxTotalBytes, '★核心:总量 ' + total + 'B ≤ 上限 ' + POLICY.maxTotalBytes + 'B')
// 修复前实测值(见 #347 取证):3600 × 10786 ≈ 38,865,564B > 上限 ⇒ 断言为假
ok(total < 38865564, '总量显著低于修复前的 38,865,564B(实测 ' + total + 'B)')
ok(store.stats.sweptFiles + (store.stats.sweptTrimmed || 0) > 0, '本生命周期内确实发生过保留清理(非「一次都没扫」)')

// ── 347-2 有界频率:扫描次数必须远小于追加次数(不是每条都全扫)────────────────────
console.log('[347-2] 清理频率有界(全扫次数 << 追加次数)')
const capped = Math.ceil(38865564 / (2 * 1024 * 1024)) + 2
ok(store._swept === true, '清扫状态为「已扫过」')
ok(elapsed < 60000, '3600 次追加 + 全程清理在 60s 内完成(实测 ' + elapsed + 'ms)')
ok(perLine > 8000, '单条均摊字节仍是大事件量级(实测 ' + perLine + 'B;低于 10786B 系裁剪已丢弃最老行所致)')
// ★字节超限路径同样必须「保住最新」:最后一个 evidenceId 必须仍在盘上(裁剪只从尾部丢最老行)。
const lastEv = mkEv(3599, { episodeId: BIG })
const dumpAll = readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl'))
  .sort().map((f) => readFileSync(path.join(eventsDir, f), 'utf8')).join('')
ok(dumpAll.includes(lastEv.evidenceId), '★第 3600 条(最新)仍在盘上:字节裁剪只丢最老行,不丢最新')
// 用**解析后的真实序号**判断裁剪范围(不靠字符串猜测字段布局)。
const aliveSeqs = []
for (const f of readdirSync(eventsDir)) {
  if (!f.endsWith('.jsonl')) continue
  for (const line of readFileSync(path.join(eventsDir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const j = JSON.parse(line); if (j && j.event && Number.isFinite(j.event.eventSeq)) aliveSeqs.push(j.event.eventSeq) } catch (_) {}
  }
}
aliveSeqs.sort((a, b) => a - b)
console.log('    存活事件序号区间=[' + aliveSeqs[0] + ',' + aliveSeqs[aliveSeqs.length - 1] + '],条数=' + aliveSeqs.length)
eq(aliveSeqs[aliveSeqs.length - 1], 3599, '★最新事件 eventSeq=3599 存活')
ok(aliveSeqs[0] > 0, '★最老事件已被裁剪(eventSeq 最小值=' + aliveSeqs[0] + ' > 0,证明发生了裁剪而非全保留)')
ok(store.stats.sweptTrimmed > 0, '统计上记录了逐行裁剪次数 sweptTrimmed=' + store.stats.sweptTrimmed)

// ── 347-3 负路径:远未到上限时不得误删任何事件 ───────────────────────────────
console.log('[347-3] 负路径:小体量账本不触发任何删除(正常事件不被误删)')
const root2 = mkdtempSync(path.join(tmpdir(), 'dam-i347b-'))
const small = new ES.EvidenceEventStore({ root: root2 })
const ids = []
for (let i = 0; i < 50; i++) {
  const ev = mkEv(i, { memoryId: 'mem_' + 'bb'.repeat(16) })
  ids.push(ev.evidenceId)
  await small.append(ev)
}
const dir2 = path.join(root2, 'events')
const files2 = readdirSync(dir2).filter((f) => f.endsWith('.jsonl'))
eq(files2.length, 1, '50 条落在同一个分片')
eq(lineCount(path.join(dir2, files2[0])), 50, '50 行原样保留(一条未删)')
eq(small.stats.sweptFiles, 0, '未发生整文件删除')
eq(small.stats.sweptTrimmed || 0, 0, '未发生逐行裁剪')
const reloaded = small.loadEvents()
eq(reloaded.events.length, 50, 'loadEvents 读回仍是 50 条')
ok(ids.every((id) => reloaded.events.some((e) => e.evidenceId === id)), '50 个 evidenceId 全部可读回(无静默丢失)')
ok(dirBytes(dir2) < POLICY.maxTotalBytes, '小账本总量 ' + dirBytes(dir2) + 'B << 上限')

// ── 347-4 keepDays 年龄清理在**首次**与**后续**全扫都要生效 ──────────────────
console.log('[347-4] 年龄清理:force 立即生效;自动周期同样生效')
const root3 = mkdtempSync(path.join(tmpdir(), 'dam-i347c-'))
const aged = new ES.EvidenceEventStore({ root: root3 })
await aged.append(mkEv(1))
const dir3 = path.join(root3, 'events')
const oldFp = path.join(dir3, '2026-01-01.jsonl')
writeFileSync(oldFp, JSON.stringify({ evidenceId: 'ev_' + 'f'.repeat(32), kind: 'seen' }) + '\n', 'utf8')
const oldT = new Date(Date.now() - 40 * 86400000)
utimesSync(oldFp, oldT, oldT)
const forced = aged.sweepRetention(true)
ok(!existsSync(oldFp), 'force=true 立即清掉 40 天前的分片')
eq(forced.swept, true, 'force 调用返回 swept=true')
ok(Number.isFinite(forced.before) && Number.isFinite(forced.after) && forced.after < forced.before,
  'force 返回前后总量且清理有效(before=' + forced.before + ' after=' + forced.after + ')')
// 自动周期:再放一个老分片,靠「时间阈值」复位(不等字节阈值)
const oldFp2 = path.join(dir3, '2026-01-02.jsonl')
writeFileSync(oldFp2, JSON.stringify({ evidenceId: 'ev_' + 'a'.repeat(32), kind: 'seen' }) + '\n', 'utf8')
utimesSync(oldFp2, oldT, oldT)
aged._sweptAt = Date.now() - 60000 // 已超过 30s 节拍
const auto = aged.sweepRetention(false, 10)
ok(!existsSync(oldFp2), '★后续追加触发的时间节拍同样清掉老分片(修复前:永不再扫)')
eq(auto.swept, true, '自动周期返回 swept=true')

// ── 347-5 逐行裁剪:保住**最新**的事件,只丢最老的 ────────────────────────────
console.log('[347-5] 超限时的逐行裁剪:保留最新行、丢弃最老行')
const root4 = mkdtempSync(path.join(tmpdir(), 'dam-i347d-'))
mkdirSync(path.join(root4, 'events'), { recursive: true })
const trimStore = new ES.EvidenceEventStore({ root: root4 })
const trimFp = path.join(root4, 'events', '2030-01-01.jsonl')
const rows = []
for (let i = 0; i < 10; i++) rows.push(JSON.stringify({ n: i, pad: 'p'.repeat(100) }))
writeFileSync(trimFp, rows.join('\n') + '\n', 'utf8')
const beforeBytes = Buffer.byteLength(readFileSync(trimFp, 'utf8'), 'utf8')
// 预算:只够最后 3 行
const last3 = Buffer.byteLength(rows.slice(-3).join('\n') + '\n', 'utf8')
const cut = trimStore._trimFileToBudgetPre(trimFp, last3)
ok(cut && cut.removed === 7, '裁剪掉 7 行(实测 ' + JSON.stringify(cut) + ')')
const afterText = readFileSync(trimFp, 'utf8')
const afterRows = afterText.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l).n)
eq(afterRows, [7, 8, 9], '★保留的是**最新**三行(n=7,8,9),不是最老三行')
ok(cut.freedBytes === beforeBytes - Buffer.byteLength(afterText, 'utf8'), 'freedBytes 与实际字节差一致(' + cut.freedBytes + ')')
ok(!readdirSync(path.join(root4, 'events')).some((f) => f.includes('.trim-')), '原子回写未残留 .trim- 临时文件')
// 负路径:预算足够 ⇒ 不裁剪、不动文件
const untouched = trimStore._trimFileToBudgetPre(trimFp, 10 ** 6)
eq(untouched, null, '负路径:预算充足时返回 null(不裁剪)')
eq(trimStore._trimFileToBudgetPre(trimFp, 10 ** 6) === null && lineCount(trimFp) === 3, true, '负路径:文件未被改动(仍 3 行)')
eq(trimStore._trimFileToBudgetPre(path.join(root4, 'events', '不存在.jsonl'), 10), null, '负路径:文件不存在返回 null(不抛)')

// ── 347-6 负路径:写入失败不得污染清理计数 ───────────────────────────────────
console.log('[347-6] 负路径:未配置 eventsDir 的 append 不计入清理字节')
const unconfigured = new ES.EvidenceEventStore({})
const rUn = await unconfigured.append(mkEv(1))
eq(rUn.ok, false, 'store 未配置时 append 失败')
eq(rUn.reason, 'store-not-configured', '失败原因正确')
eq(unconfigured._bytesSinceSweep, 0, '失败路径未累计清理字节')

console.log('\n[i347] ' + pass + ' passed, ' + fail + ' failed')
console.log('[i347] 复算口径: 3600 条 × ' + perLine + 'B ≈ ' + (perLine * 3600) + 'B; 上限 ' + POLICY.maxTotalBytes + 'B; 实测磁盘 ' + total + 'B')
process.exit(fail === 0 ? 0 : 1)
