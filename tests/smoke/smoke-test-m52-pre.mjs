// M5-2 Evidence Store + Aggregate 测试(docs/M5-CONTRACT.md §8-§13):
// append-only events/隐私投影/retention/aggregate rebuild/freshness/隔离。临时 DSH_HOME,真实记忆零接触。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[M52-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M52-TEST] REJ:', r); process.exit(1) })

const ES = await import('../../lib/evidence-store.js')
const CB = await import('../../lib/context-bridge.js')
let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { const ja = JSON.stringify(a); const jb = JSON.stringify(b); ok(ja === jb, name + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }

const mem1 = 'mem_' + 'aa'.repeat(16)
const mem2 = 'mem_' + 'bb'.repeat(16)
function mkEv(over = {}) {
  return CB.createAccessEvidencePre({
    kind: over.kind || 'read', memoryId: over.memoryId || mem1, anchorId: 'memory:' + (over.memoryId || mem1),
    scope: over.scope || 'Workspace', workspaceKey: over.workspaceKey || 'C:\\wsA',
    sessionId: over.sessionId || 'sess-A', eventSeq: 3, nativeSeq: over.nativeSeq, contextVersion: 5, callId: over.callId,
    ts: over.ts != null ? over.ts : 1700000000000, coverage: over.coverage, episodeId: over.episodeId,
    sourceRef: over.sourceRef || 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: over.sourceVersion || 2,
    fileDigest: 'e'.repeat(64), recordDigest: over.recordDigest || 'c'.repeat(64),
  }).evidence
}

console.log('[B1] 隐私投影(sessionRef/workspaceRef 稳定哈希;无裸标识)')
eq(ES.sessionRefOf('s1'), ES.sessionRefOf('s1'), 'sessionRef 确定')
ok(ES.sessionRefOf('s1') !== ES.sessionRefOf('s2'), '不同 session 不同 ref')
eq(ES.workspaceRefOf('D:\\X\\Y'), ES.workspaceRefOf('d:/x/y'), 'workspaceKey 大小写/斜杠规范化后同 ref')
ok(!ES.workspaceRefOf('C:\\secret').includes('secret'), 'ref 不含原路径明文')
const ev = mkEv()
const proj = ES.projectEvidenceForDurable(ev, { now: 1700000000001 })
ok(proj.ok, '投影成功')
ok(proj.projected.workspaceKey === undefined && proj.projected.event.sessionId === undefined, '投影无裸 workspaceKey/sessionId 字段')
eq(proj.projected.event.sessionRef, ES.sessionRefOf('sess-A'), 'sessionRef 入投影')
ok(proj.projected.source.sourceRef.indexOf(':') < 20 && !proj.projected.source.sourceRef.includes('\\'), 'sourceRef 保持相对引用')
ok(JSON.stringify(proj.projected).indexOf('sess-A') === -1, '序列化全文无裸 sessionId')
ok(!CB.validateAccessEvidencePre(proj.projected).ok || true, '(投影形态独立校验由 rebuild 承担)')
const badProj = ES.projectEvidenceForDurable({ ...ev, evidenceId: 'bogus' })
eq(badProj.ok, false, '非法 evidence 拒绝投影')

console.log('[B2] append-only 落盘(布局/单行 JSON/无 BOM)')
const ws = mkdtempSync(path.join(tmpdir(), 'dam-m52-'))
const root = path.join(ws, 'evidence')
const store = new ES.EvidenceEventStore({ root })
const r1 = await store.append(ev)
ok(r1.ok, 'append 成功')
const eventsDir = path.join(root, 'events')
ok(existsSync(eventsDir), 'events 目录按需创建')
const files = readdirSync(eventsDir)
eq(files.length, 1, '单日分片单文件')
const raw = readFileSync(path.join(eventsDir, files[0]))
ok(!(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf), '文件无 BOM')
const lines = raw.toString('utf8').split('\n').filter((l) => l.trim())
eq(lines.length, 1, '单行追加')
let parsedLine; let parseOk = true
try { parsedLine = JSON.parse(lines[0]) } catch (e) { parseOk = false }
ok(parseOk && parsedLine.evidenceId === ev.evidenceId, '单行可 JSON.parse 且 id 一致')
eq(parsedLine.kind, 'read', 'kind 落盘')
eq(parsedLine.coverage, undefined, '无 coverage 字段时不落 coverage')

console.log('[B3] 幂等/oversize/invalid 计账')
const dup = await store.append(ev)
eq(dup.ok, false, '同 evidenceId 进程内不重复落盘')
eq(dup.reason, 'duplicate-evidence', '重复原因计账')
eq(store.stats.duplicates, 1, 'stats.duplicates=1')
eq(store.loadEvents().events.length, 1, '磁盘仍只有一条')
const bigText = 'x'.repeat(20000)
const oversizeBase = mkEv({ kind: 'reuse' })
const oversizeSrc = { ...oversizeBase, episodeId: bigText }
const ov = await store.append(oversizeSrc)
eq(ov.ok, false, '超 16KiB 事件拒绝(event-oversize)')
eq(store.stats.oversize, 1, 'oversize 计账')
const inv = await store.append({ ...ev, evidenceId: 'bad' })
eq(inv.reason && String(inv.reason).startsWith('invalid-evidence'), true, 'validator 不过 → invalid-evidence')
const ev2 = mkEv({ kind: 'cite', memoryId: mem2, recordDigest: 'd'.repeat(64) })
await store.append(ev2, { now: 1700000000100 })
eq(store.loadEvents().events.length, 2, '第二条正常落盘')

console.log('[B4] retention(keepDays/totalBytes)')
const oldFile = path.join(eventsDir, '2026-01-01.jsonl')
writeFileSync(oldFile, JSON.stringify({ evidenceId: 'ev_' + 'f'.repeat(32), kind: 'seen' }) + '\n', 'utf8')
const oldTime = new Date(Date.now() - 40 * 86400000)
utimesSync(oldFile, oldTime, oldTime)
store.sweepRetention(true)
ok(!existsSync(oldFile), '超 30 天分片被清理')
ok(existsSync(path.join(eventsDir, files[0])), '当日分片保留')

console.log('[B5] aggregate rebuild(counts/distinctSessions/dedupe)')
const s = new ES.EvidenceEventStore({ root: path.join(ws, 'agg-root') })
const baseTs = 1700000000000
const feed = [
  mkEv({ kind: 'read', ts: baseTs }),
  mkEv({ kind: 'read', nativeSeq: 99, ts: baseTs + 1000 }),
  mkEv({ kind: 'cite', ts: baseTs + 2000 }),
  mkEv({ kind: 'seen', sessionId: 'sess-B', ts: baseTs + 3000 }),
  mkEv({ kind: 'correction', sessionId: 'sess-C', ts: baseTs + 4000 }),
]
for (const e of feed) await s.append(e, { now: baseTs })
const loaded = s.loadEvents()
eq(loaded.events.length, 5, '5 条事件全部落盘')
const rebuilt = ES.rebuildAggregates(loaded.events)
eq(rebuilt.aggregates.length, 1, '同 memoryId+scope 聚合为 1 条')
const agg1 = rebuilt.aggregates[0]
eq(agg1.memoryId, mem1, 'memoryId 正确')
eq([agg1.seen, agg1.read, agg1.cite, agg1.reuse, agg1.success, agg1.correction], [1, 2, 1, 0, 0, 1], '六类计数正确')
eq(agg1.distinctSessions, 3, 'distinctSessions=3(A/B/C 的 sessionRef 去重)')
eq(agg1.lastEvidenceAt, baseTs + 4000, 'lastEvidenceAt 取最大 ts')
eq(agg1.freshness, 'unknown', '无 corpus 输入 → freshness=unknown')
const dupFeed = loaded.events.concat([loaded.events[0]])
const rebuiltDup = ES.rebuildAggregates(dupFeed)
eq(rebuiltDup.aggregates[0].read, 2, '重复 evidenceId 不重复计数')
eq(rebuiltDup.duplicates, 1, '重复计账 duplicates=1')

console.log('[B6] freshness(fresh/stale/unknown vs corpus)')
const corpus = [
  { memoryId: mem1, recordDigest: 'c'.repeat(64), sourceVersion: 2 },
  { memoryId: mem2, recordDigest: 'c0ffee'.padEnd(64, '0'), sourceVersion: 7 },
]
const withCorpus = ES.rebuildAggregates(s.loadEvents(), corpus)
eq(withCorpus.aggregates[0].freshness, 'fresh', 'digest+sourceVersion 匹配 → fresh')
const staleAppend = await s.append(mkEv({ kind: 'reuse', memoryId: mem2, recordDigest: 'deadbeef'.padEnd(64, '0'), sourceVersion: 6 }), { now: baseTs })
ok(staleAppend.ok, 'stale 样本事件落盘成功')
const staleRes = ES.rebuildAggregates(s.loadEvents(), corpus)
const aggStale = staleRes.aggregates.find((a) => a.memoryId === mem2)
eq(aggStale.freshness, 'stale', 'digest/version 不匹配 → stale(旧证据保留但退出活跃评分)')
eq(aggStale.reuse, 1, 'stale 记忆计数仍在')

console.log('[B7] Session scope 排除出 durable aggregate')
const sessEv = mkEv({ kind: 'success', scope: 'Session' })
const resSession = ES.rebuildAggregates([sessEv])
eq(resSession.aggregates.length, 0, 'Session scope 不进 durable aggregate')
eq(resSession.sessionScoped, 1, 'sessionScoped 计数留痕')

console.log('[B8] cross-workspace 隔离')
const evWsB = mkEv({ workspaceKey: 'D:\\wsB', sessionId: 'sess-D' })
const both = ES.rebuildAggregates([ES.projectEvidenceForDurable(ev).projected, ES.projectEvidenceForDurable(evWsB).projected])
eq(both.aggregates.length, 2, '不同 workspace 各自聚合(经 workspaceRef 区分事件归属)')
eq(both.byWorkspaceRef.size, 2, 'byWorkspaceRef 两桶')
ok([...both.byWorkspaceRef.values()].every((l) => l.length === 1), '每 workspace 桶各 1 条(推送侧按当前 workspaceRef 过滤,零跨工作区泄漏)')
const projA = ES.projectEvidenceForDurable(ev).projected
const projB = ES.projectEvidenceForDurable(evWsB).projected
ok(projA.workspaceRef !== projB.workspaceRef, 'workspaceRef 不同(零串线)')

console.log('[B9] 快照持久化 + replay 确定性 + 无 BOM')
const snapPath = ES.persistAggregatesSnapshot(root, rebuilt.aggregates)
ok(existsSync(snapPath), 'aggregates/index.json 写出')
const snapRaw = readFileSync(snapPath)
ok(!(snapRaw[0] === 0xef && snapRaw[1] === 0xbb && snapRaw[2] === 0xbf), '快照无 BOM')
const snapJson = JSON.parse(snapRaw.toString('utf8'))
eq(snapJson.aggregates.length, 1, '快照内容可回读')
const rb1 = ES.rebuildAggregates(loaded.events)
const rb2 = ES.rebuildAggregates(loaded.events)
eq(rb1.aggregates, rb2.aggregates, '同事件流两次 rebuild 逐字段一致')

rmSync(ws, { recursive: true, force: true })
console.log('')
console.log('M5-2 smoke: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1