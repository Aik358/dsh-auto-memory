// 回归:index-sync 页预算必须为线帧信封留余量。
// 旧预算 maxPageBytes == MAX_LINE_BYTES(256KiB):builder 接受的临界页出站时被
// envelope(requestId/workerEpoch/sentAt/frameId/pageDigest…约230B)+换行推过行限,
// Python worker 对超行帧 fail-closed 退出(line-oversize→break),而熔断计数被每段的
// index_sync_begin 成功帧清零 → 每 Segment 重生 worker 重建同一坏页,索引永不 ready。
import { createHash } from 'node:crypto'

let pass = 0, fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }

const WIRE = await import('../../lib/m7-wire.js')
const SYNC = await import('../../lib/index-sync.js')
const MAX_LINE_BYTES = 256 * 1024
const BUDGET = SYNC.INDEX_SYNC_PAGE_BUDGET_V1
const hex32 = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex').slice(0, 32)
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')

// —— 1) 预算常量:必须给信封留出余量 ——
ok(BUDGET.maxPageBytes <= MAX_LINE_BYTES - 4096, '页预算 ≤ MAX_LINE_BYTES-4KiB(实测信封约230B,余量18倍) got ' + BUDGET.maxPageBytes)

// —— 2) 真实 builder 产出的每一页,包上真实帧后的线长都不得超 MAX_LINE_BYTES ——
function mkSnapshot(n, tag, textBytes) {
  const epochWs = 'ws-epoch-' + tag
  const rec = (i) => ({
    memoryId: 'mem_' + hex32(tag + ':Workspace:' + i), anchorId: 'anc_' + hex32(tag + 'Workspace' + i).slice(0, 12),
    scope: 'Workspace', sourceClass: 'workspace-notes', sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: epochWs, sourceVersion: 1,
    fileDigest: sha256Hex(Buffer.from(tag + 'file')), recordDigest: sha256Hex(Buffer.from(tag + 'rec' + i)),
    lineStart: i * 2 + 1, lineEnd: i * 2 + 2, byteStart: i * 40, byteEnd: i * 40 + 38,
    heading: '标题' + i,
    // 长度抖动让各页 payload 稠密覆盖预算窗口,而不是整齐地落在同一位置
    text: '记录内容关于部署与验证流程'.repeat(Math.ceil((textBytes + (i % 7) * 97) / 39)) + '#' + i,
    bytes: 38,
  })
  return {
    memoryIndexVersion: 'idx_' + hex32('miv-' + tag),
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: epochWs, sourceVersion: 1, fileDigest: sha256Hex(Buffer.from(tag + 'file')) }],
    records: Array.from({ length: n }, (_, i) => rec(i)),
  }
}
function lineBytesOf(page) {
  const mf = WIRE.makeRequestFramePre({ type: 'index_sync_page', payload: page, requestId: 'req_budgetcheck', workerEpoch: 'wk_budgetcheck', sentAt: 1700000000000 })
  if (!mf.ok) return -1
  return Buffer.byteLength(JSON.stringify(mf.frame) + '\n', 'utf8')
}

{
  const built = SYNC.buildIndexSyncPlansPre({ snapshot: mkSnapshot(320, 'budget', 5200), workspaceKey: 'D:/tmp/wsBudget' })
  ok(built.ok, '稠密语料构建成功' + (built.ok ? '' : ':' + built.reason))
  if (built.ok) {
    let pages = 0, maxPayload = 0, maxLine = 0, maxEnvelope = 0
    for (const p of built.plans) for (const pg of p.pages) {
      pages++
      const payload = Buffer.byteLength(JSON.stringify(pg), 'utf8')
      const line = lineBytesOf(pg)
      ok(line > 0 && line <= MAX_LINE_BYTES, '页 ' + pg.pageNo + ' 线长 ≤256KiB (' + line + 'B, payload ' + payload + 'B)')
      if (line > maxLine) { maxLine = line; maxPayload = payload; maxEnvelope = line - payload }
      ok(pg.records.length <= BUDGET.maxRecordsPerPage, '页 ' + pg.pageNo + ' ≤64 条')
    }
    ok(pages >= 4, '确实分了多页 pages=' + pages)
    ok(maxEnvelope <= 4096, '信封开销 ≤4KiB (实测 ' + maxEnvelope + 'B)')
    ok(maxPayload <= BUDGET.maxPageBytes, '最大页 payload 在预算内 (' + maxPayload + 'B)')
    ok(maxPayload > BUDGET.maxPageBytes - 8 * 1024, '最大页 payload 贴近预算(覆盖旧临界窗口,证明分页真的被预算约束) got ' + maxPayload)
  }
}

// —— 3) 反证:若恢复旧预算(贴满 256KiB),builder 接受的临界页线上必超限 ——
{
  const snap = mkSnapshot(320, 'budget', 2600)
  // 直接构造一个 payload 恰落入旧临界窗口的页(262134B,fork 复核实测值同型)
  const danger = { schemaVersion: 1, syncId: 'syn_' + hex32('d'), pageNo: 0, pageCount: 1, pageDigest: '0'.repeat(64), records: [] }
  const padRec = (len) => ({ memoryId: 'mem_' + hex32('pad' + len), anchorId: 'anc_' + hex32('padA' + len).slice(0, 12), scope: 'Workspace', workspaceRef: 'wsr_' + hex32('ws'), sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep', sourceVersion: 1, fileDigest: sha256Hex(Buffer.from('f')), recordDigest: sha256Hex(Buffer.from('r' + len)), occurredAt: null, heading: '', text: 'x'.repeat(len), chunkId: 'chk_' + hex32('c' + len), chunkOrdinal: 0, chunkCount: 1 })
  while (Buffer.byteLength(JSON.stringify(danger), 'utf8') < 262134 - 4600) danger.records.push(padRec(4096))
  // 尾部用一条可调长度的记录,迭代收紧其 text 长度,把 payload 精确推进旧临界窗口 [262134, 262144]
  danger.records.push(padRec(4096))
  for (let i = 0; i < 8; i++) {
    const cur = Buffer.byteLength(JSON.stringify(danger), 'utf8')
    if (cur >= 262134 && cur <= 262144) break
    const last = danger.records[danger.records.length - 1]
    const overhead = cur - Buffer.byteLength(last.text, 'utf8')
    last.text = 'x'.repeat(Math.max(16, 262139 - overhead))
  }
  const p = Buffer.byteLength(JSON.stringify(danger), 'utf8')
  ok(p <= 262144 && p > 262144 - 300, '构造出旧预算下的临界页 payload=' + p + 'B (builder 会接受)')
  const line = lineBytesOf(danger)
  ok(line > MAX_LINE_BYTES, '该页真实线长 ' + line + 'B > 256KiB —— 这就是旧预算的死锁页')
}

console.log(`\n[page-line-budget] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
