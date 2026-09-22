#!/usr/bin/env node
/** smoke-test-p9d-recent-evidence-ts-pre —— P9d recentEvidenceForSuccess 时间戳取值修复 回归锁定(2026-09-09)。
 * 缺陷:旧写法 e.ts || e.createdAt || 0,但 store 投影事件顶层无 ts/createdAt(时间戳在 event.ts)
 *       → 恒 0 → 窗口全跳过 → 恒返回空 → success 证据链(index.js:4575 唯一调用方)结构性断裂。
 * 覆盖:真实 host 实例(DSH_HOME 注入 + 磁盘投影形态 fixture)下窗口内 cite/read 可选出 /
 *       窗口外排除 / kind 过滤 / memoryId 去重 / 坏条目跳过 / 修复前同夹具返回空(回归证明)。
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContextHost } from '../../lib/context-host.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'context-host.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }

const NOW = Date.now()
const WINDOW = 5 * 60 * 1000
const memId = (c) => 'mem_' + c.repeat(32)
const hex64 = (c) => c.repeat(64)
/** 磁盘投影形态(prompt §0 实样):无顶层 ts/createdAt,时间戳在 event.ts。 */
const proj = (kind, mem, ts) => JSON.stringify({
  schemaVersion: 1, namespace: 'ctx-evidence-v1', storePolicyVersion: 'evidence_store_v1',
  evidenceId: 'evx_' + mem.slice(4, 12) + '_' + kind, kind, memoryId: mem,
  anchorId: 'anc_' + mem.slice(4, 12), scope: 'Workspace', workspaceRef: 'Workspace:demo',
  event: { sessionRef: 'session-demo', eventSeq: 1, contextVersion: 1, ts },
  source: { sourceRef: 'workspace:notes.md', sourceEpoch: '1', sourceVersion: 1, fileDigest: hex64('a'), recordDigest: hex64('b') },
  policyVersion: 'evidence_policy_v1', recordedAt: ts,
})

// 临时 DSH_HOME + 投影 JSONL
const home = mkdtempSync(path.join(tmpdir(), 'p9d-'))
const eventsDir = path.join(home, 'memory', 'evidence', 'events')
mkdirSync(eventsDir, { recursive: true })
const lines = [
  proj('cite', memId('a'), NOW - 60 * 1000),      // 窗口内 cite
  proj('read', memId('b'), NOW - 30 * 1000),      // 窗口内 read(最近)
  proj('cite', memId('a'), NOW - 10 * 1000),      // 同 memoryId 第二条(去重)
  proj('seen', memId('c'), NOW - 20 * 1000),      // 仅 seen → 不选
  proj('cite', memId('d'), NOW - WINDOW - 1000),  // 窗口外 → 排除
  proj('read', memId('e'), 'not-a-number'),       // event.ts 非法 → 跳过
  'broken-line{{{',                                // 坏行 → 跳过
].join('\n')
writeFileSync(path.join(eventsDir, '2026-09-09.jsonl'), lines + '\n', 'utf8')

process.env.DSH_HOME = home
const host = createContextHost({ engine: { config: { associativeMemoryEnabled: true, contextBridgeEnabled: true } } })

console.log('[p9d] G1 修复后:窗口内 cite/read 可选出,投影形态 ts 生效')
const got = host.recentEvidenceForSuccess(WINDOW)
ok(Array.isArray(got) && got.length > 0, '不再恒返回空(选出 ' + (got ? got.length : 0) + ' 条)')
ok(got.some((e) => e.kind === 'cite' && e.memoryId === memId('a')), '窗口内 cite(mem_a) 选出')
ok(got.some((e) => e.kind === 'read' && e.memoryId === memId('b')), '窗口内 read(mem_b) 选出')

console.log('[p9d] G2 过滤与去重语义')
ok(!got.some((e) => e.memoryId === memId('c')), '仅 seen 不被选(kind 过滤仍生效)')
ok(!got.some((e) => e.memoryId === memId('d')), '窗口外排除')
ok(got.filter((e) => e.memoryId === memId('a')).length === 1, '同 memoryId 去重(2 条 → 1 条)')

console.log('[p9d] G3 坏条目不抛错(非法 ts / 坏行跳过)')
ok(!got.some((e) => e.memoryId === memId('e')), 'event.ts 非法条目被跳过')
ok(!got.some((e) => e.memoryId === undefined), '无 memoryId 残留(坏行不产出)')

console.log('[p9d] G4 回归证明:修复前口径对同一夹具返回空')
{
  // 旧实现逐字复刻:e.ts || e.createdAt || 0 —— 投影形态下恒 0 < cutoff → 全跳过
  const events = JSON.parse('[' + lines.split('\n').filter((l) => l.startsWith('{')).map((l) => {
    try { const j = JSON.parse(l); return j && j.evidenceId && j.kind && j.memoryId ? JSON.stringify(j) : '' } catch (_) { return '' }
  }).filter(Boolean).join(',') + ']')
  const cutoff = Date.now() - WINDOW
  const oldOut = new Map()
  for (const e of events) {
    const ets = e.ts || e.createdAt || 0 // ← 修复前口径
    if (ets < cutoff) continue
    if (e.kind !== 'read' && e.kind !== 'cite') continue
    if (!e.memoryId) continue
    if (!oldOut.has(e.memoryId)) oldOut.set(e.memoryId, e)
  }
  ok(oldOut.size === 0, '修复前口径同夹具返回 0 条(实证缺陷)')
  ok(got.length >= 2, '修复后同夹具选出 ' + got.length + ' 条(前后对照)')
}

console.log('[p9d] G5 源核验(口径一致 + 停止条件)')
ok(SRC.includes('const ets = Number(e.event && e.event.ts) || Number(e.ts) || Number(e.createdAt) || 0'), '时间戳口径与 selectCorrectionAttributionPre 一致')
ok(!/const ets = e\.ts \|\| e\.createdAt \|\| 0/.test(SRC), '旧写法已消失(-pre 源)')
ok(!readFileSync(path.resolve(HERE, '..', '..', 'lib', 'context-host.js'), 'utf8').includes('Number(e.event && e.event.ts)'), '发布产物 context-host.js 未手改(仍为旧版,由发布流水线重建)')

console.log(`\n[p9d] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
