// M3b-1 anchor parser / sidecar / dry-run planner 测试(docs/M3B-CONTRACT.md §13 矩阵相应项):
// 纯只读实现——全部夹具来自 tests/m3b1-fixtures/ 与内存 Buffer,零磁盘写入、零侧效应。
// hard-fail guard:断言抛错/unhandledRejection 一律 exit 1。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.on('uncaughtException', (e) => { console.error('\n[M3B1-TEST] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[M3B1-TEST] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

const { parseAnchors, buildSidecar, parseSidecar, planMigration, newMemoryId, MEMORY_ID_RE, SIDECAR_NAMESPACE } = await import('./lib/memory-anchor-pre.js')
const { INDEX_MAX_FILE_BYTES } = await import('./lib/memory-index-pre.js')

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tests', 'm3b1-fixtures')
const load = (f) => readFileSync(path.join(FIX, f))

// hard 校验:BOM 检查 fixture + 输出串
const isBom = (b) => b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf

// ---------- C1 ID 格式与唯一 ----------
{
  const id = newMemoryId('7f8f6a45e27b45a09bcfd76f93acfd70')
  if (id !== 'mem_7f8f6a45e27b45a09bcfd76f93acfd70') throw new Error('newMemoryId shape broken: ' + id)
  if (!MEMORY_ID_RE.test(id)) throw new Error('newMemoryId must match MEMORY_ID_RE')
  let n = 0
  const plan = planMigration('x.md', load('legacy.md'), { idFactory: () => newMemoryId('a1b2c3d4e5f60718293a4b5c6d7e8f' + String(++n).padStart(2, '0')) })
  if (plan.aborted || plan.operations.length !== 3) throw new Error('legacy.md should produce 3 insert-anchor ops, got ' + plan.operations.length)
  const ids = plan.operations.map((o) => o.memoryId)
  if (new Set(ids).size !== ids.length) throw new Error('operation memoryIds must be unique')
  for (const i of ids) if (!MEMORY_ID_RE.test(i)) throw new Error('operation memoryId malformed: ' + i)
  if (!/^plan_[0-9a-f]{32}$/.test(plan.planId)) throw new Error('planId must be plan_+32hex, got ' + plan.planId)
  console.log('C1 ID 格式与唯一 ✓ (mem_+32hex, plan_+32hex, 3 ops unique)')
}

// ---------- C2 parse 幂等 + sidecar 序列化往返 ----------
{
  const content = load('anchored.md')
  const p1 = parseAnchors(content)
  const p2 = parseAnchors(content)
  if (p1.status !== 'clean') throw new Error('anchored.md must be clean, got conflicts: ' + JSON.stringify(p1.conflicts))
  if (JSON.stringify(p1.records) !== JSON.stringify(p2.records)) throw new Error('parse must be idempotent')
  const anchored = p1.records.filter((r) => r.kind === 'anchored')
  if (anchored.length !== 2) throw new Error('anchored.md should have 2 anchored records, got ' + p1.records.length + ' total')
  // preamble 应切出 1 个 legacy 块(heading 块含跟随散文本,契约 §7:非空 preamble 形成一个记录)
  const legacy = p1.records.filter((r) => r.kind === 'legacy')
  if (legacy.length !== 1 || legacy[0].position !== 'preamble' || legacy[0].lineStart !== 1 || legacy[0].lineEnd !== 2) throw new Error('preamble must yield one legacy block')
  const b1 = buildSidecar({ sourceFile: 'D:/x/MEMORY.md', content, now: 12345 })
  if (!b1.ok) throw new Error('buildSidecar failed: ' + b1.reason)
  const sc = b1.sidecar
  if (sc.schemaVersion !== 1 || sc.namespace !== SIDECAR_NAMESPACE || sc.sourceVersion !== 1) throw new Error('sidecar base fields wrong')
  if (sc.records.length !== 2) throw new Error('sidecar must carry only anchored records, got ' + sc.records.length)
  const rec0 = sc.records[0]
  if (rec0.sourceVersion !== 1 || rec0.fileDigest !== sc.fileDigest) throw new Error('sidecar record must carry file-level identity')
  if (!Number.isInteger(rec0.anchorByteStart) || !Number.isInteger(rec0.anchorByteEnd) || rec0.anchorByteEnd <= rec0.anchorByteStart) throw new Error('sidecar record must carry anchor marker byte range')
  if (rec0.anchorByteEnd > rec0.byteStart) throw new Error('anchor marker must precede content')
  const text = JSON.stringify(sc, null, 2) + '\n'
  if (isBom(Buffer.from(text))) throw new Error('serialized sidecar must be BOM-free')
  const back = parseSidecar(text)
  if (!back.ok) throw new Error('sidecar roundtrip must validate: ' + back.reason)
  if (JSON.stringify(back.sidecar) !== JSON.stringify(sc)) throw new Error('sidecar roundtrip must be identical')
  console.log('C2 parse 幂等 + sidecar 往返 ✓ (顶层 8 字段 + 记录级 11 字段校验, 输出无 BOM)')
}

// ---------- C3 LF/CRLF/多字节/无尾换行/preamble/空文件 ----------
{
  const crlf = parseAnchors(load('crlf.md'))
  if (crlf.newline !== 'crlf') throw new Error('crlf.md newline detect failed: ' + crlf.newline)
  if (parseAnchors(Buffer.from('a\r\nb\nc\n')).newline !== 'mixed') throw new Error('mixed newline detect failed')
  if (parseAnchors(Buffer.from('a\nb\n')).newline !== 'lf') throw new Error('lf newline detect failed')
  if (crlf.records.length !== 2 || crlf.records.every((r) => r.kind === 'legacy') === false) throw new Error('crlf legacy blocks wrong')
  const mb = parseAnchors(load('multibyte.md'))
  const rec = mb.records[0]
  if (rec.kind !== 'anchored' || rec.memoryId !== 'mem_33333333333333333333333333333333') throw new Error('multibyte anchored wrong')
  const slice = load('multibyte.md').subarray(rec.byteStart, rec.byteEnd).toString('utf8')
  if (!slice.startsWith('## 2026-08-22') || !slice.includes('中文🙂emoji')) throw new Error('multibyte byte range must roundtrip content')
  if (rec.bytes <= rec.chars || rec.chars < 8) throw new Error('bytes/chars stats broken')
  const noTrail = Buffer.from('## 2026-08-22\n- x\n- y')
  const nt = parseAnchors(noTrail)
  if (nt.records.length !== 1 || nt.records[0].byteEnd !== noTrail.length) throw new Error('no-trailing-newline file broken')
  if (parseAnchors(Buffer.alloc(0)).records.length !== 0) throw new Error('empty file must have 0 records')
  if (parseAnchors(Buffer.from('\n\n  \n')).records.length !== 0) throw new Error('whitespace-only file must have 0 records')
  if (parseAnchors(Buffer.from('a\r\nb\nc\n')).newline !== 'mixed') throw new Error('mixed newline detect failed')
  if (parseAnchors(Buffer.from('a\nb\n')).newline !== 'lf') throw new Error('lf newline detect failed')
  // anchored × CRLF 组合(既有 fixture 只覆盖 legacy CRLF)
  const aCrlf = parseAnchors('<!-- memory:mem_44444444444444444444444444444444 -->\r\n## 2026-08-22\r\n- x\r\n')
  if (aCrlf.newline !== 'crlf' || aCrlf.status !== 'clean') throw new Error('anchored+CRLF parse failed')
  if (aCrlf.records.length !== 1 || aCrlf.records[0].kind !== 'anchored' || aCrlf.records[0].memoryId !== 'mem_44444444444444444444444444444444') throw new Error('anchored+CRLF record wrong')
  console.log('C3 LF/CRLF/mixed/多字节/无尾换行/preamble/空文件 + anchored×CRLF ✓')
}

// ---------- C4 duplicate/malformed/orphan 拒绝(fail closed) ----------
{
  const dup = parseAnchors(load('conflict.md'))
  if (dup.status !== 'conflict' || !dup.conflicts.some((c) => c.type === 'duplicate-anchor')) throw new Error('duplicate must be conflict')
  const mal = parseAnchors(load('malformed.md'))
  if (mal.status !== 'conflict' || !mal.conflicts.some((c) => c.type === 'malformed-anchor')) throw new Error('malformed must be conflict')
  const orphanA = parseAnchors('<!-- memory:mem_55555555555555555555555555555555 -->\n<!-- memory:mem_66666666666666666666666666666666 -->\n')
  if (orphanA.status !== 'conflict' || !orphanA.conflicts.some((c) => c.type === 'orphan-anchor')) throw new Error('empty anchored record must be orphan-anchor')
  const orphanC = parseAnchors('- 示例 <!-- memory:mem_77777777777777777777777777777777 --> 引用\n')
  if (orphanC.status !== 'conflict' || !orphanC.conflicts.some((c) => c.type === 'orphan-content')) throw new Error('inline marker syntax must be orphan-content')
  const pdup = planMigration('c.md', load('conflict.md'))
  if (!pdup.aborted || pdup.operations.length !== 0 || pdup.conflicts.length === 0) throw new Error('planner must abort on conflict')
  console.log('C4 duplicate/malformed/orphan-anchor/orphan-content 全部 fail closed ✓')
}

// ---------- C5 用户伪造 marker 拒绝 ----------
{
  const fake = Buffer.from('## 2026-08-22\n- 语法示例: <!-- memory:mem_88888888888888888888888888888888 --> 代码引用\n')
  const p = parseAnchors(fake)
  if (!p.conflicts.some((c) => c.type === 'orphan-content')) throw new Error('in-content marker must be rejected')
  const semi = parseAnchors('<!-- memory:mem_9999999999999999999999999999999 -->  // 缺一位 hex\n')
  if (!semi.conflicts.some((c) => c.type === 'malformed-anchor')) throw new Error('bad-length marker must be malformed')
  console.log('C5 伪造/残缺 marker 拒绝 ✓')
}

// ---------- C6 legacy plan 重跑 ID 稳定 + planId 确定性 ----------
{
  const content = load('legacy.md')
  let n = 0
  const idFactory = () => newMemoryId('a1b2c3d4e5f60718293a4b5c6d7e8f' + String(++n).padStart(2, '0'))
  const p1 = planMigration('f.md', content, { idFactory })
  const p2 = planMigration('f.md', content, { idFactory, existingPlan: p1 })
  if (p1.planId !== p2.planId) throw new Error('planId must be deterministic for same file+digest')
  if (p2.reusedIds !== p1.operations.length) throw new Error('re-run must reuse ALL ids, got ' + p2.reusedIds + '/' + p1.operations.length)
  if (JSON.stringify(p2.operations.map((o) => o.memoryId)) !== JSON.stringify(p1.operations.map((o) => o.memoryId))) throw new Error('re-run id order must match first plan')
  for (let i = 0; i < p1.operations.length; i++) {
    if (p1.operations[i].legacyRecordDigest !== p2.operations[i].legacyRecordDigest) throw new Error('op digest mapping must be stable')
  }
  // C6.5 同 digest 的两个 legacy 块:ID 必须互异,且重跑按出现序号稳定复用
  const dupContent = Buffer.from('## A\n- 相同内容\n## B\n- 相同内容\n')
  let dn = 0
  const dupFactory = () => newMemoryId('c1c2c3c4c5c6c7c8c9cacbcccdcecf' + String(++dn).padStart(2, '0'))
  const dp1 = planMigration('dup.md', dupContent, { idFactory: dupFactory })
  if (dp1.operations.length !== 2 || dp1.operations[0].memoryId === dp1.operations[1].memoryId) throw new Error('same-digest blocks must get distinct ids')
  const dp2 = planMigration('dup.md', dupContent, { idFactory: dupFactory, existingPlan: dp1 })
  if (dp2.reusedIds !== 2) throw new Error('same-digest rerun must reuse both distinct ids, got ' + dp2.reusedIds)
  if (JSON.stringify(dp2.operations.map((o) => o.memoryId)) !== JSON.stringify(dp1.operations.map((o) => o.memoryId))) throw new Error('same-digest rerun id order must match')
  console.log('C6 plan 重跑 ID 稳定(全部复用) + planId 确定性 + 同 digest 块独立 ID ✓')
}

// ---------- C7 plan digest stale 拒绝 ----------
{
  const before = Buffer.from('## 2026-08-22\n- 内容 A\n')
  const after = Buffer.from('## 2026-08-22\n- 内容 A 变 B\n')
  const oldPlan = planMigration('s.md', before, { idFactory: () => newMemoryId('00000000000000000000000000000001') })
  const cur = planMigration('s.md', after, { existingPlan: oldPlan })
  if (cur.reusedIds !== 0) throw new Error('stale plan must not reuse ids')
  if (cur.operations[0].memoryId === oldPlan.operations[0].memoryId) throw new Error('stale run must assign fresh id')
  console.log('C7 plan digest 变化 → 整份 stale 拒绝复用 ✓')
}

// ---------- C8 sidecar 跨重启 sourceVersion 递增 ----------
{
  const c1 = Buffer.from('## 2026-08-22\n- a\n')
  const s1 = buildSidecar({ sourceFile: 'v.md', content: c1 })
  if (!s1.ok || s1.sidecar.sourceVersion !== 1) throw new Error('fresh sidecar must start at version 1')
  const epoch1 = s1.sidecar.sourceEpoch
  const s2 = buildSidecar({ sourceFile: 'v.md', content: c1, prev: s1.sidecar })
  if (!s2.ok || s2.sidecar.sourceVersion !== 1 || s2.sidecar.sourceEpoch !== epoch1) throw new Error('same digest keeps version+epoch')
  const c2 = Buffer.from('## 2026-08-22\n- a\n- b\n')
  const s3 = buildSidecar({ sourceFile: 'v.md', content: c2, prev: s1.sidecar })
  if (!s3.ok || s3.sidecar.sourceVersion !== 2) throw new Error('digest change must bump version')
  if (s3.sidecar.sourceEpoch !== epoch1) throw new Error('epoch must survive digest changes (cross-restart identity)')
  // 模拟"重启":prev 从 parseSidecar 读回
  const reread = parseSidecar(JSON.stringify(s3.sidecar))
  if (!reread.ok) throw new Error('written sidecar must parse back: ' + reread.reason)
  console.log('C8 sidecar 跨重启版本/epoch 语义 ✓ (1→1→2, epoch 不变)')
}

// ---------- C9 sidecar 损坏 → 重建 ----------
{
  const bad1 = parseSidecar('not json {')
  if (bad1.ok || !bad1.reason.startsWith('bad-json')) throw new Error('garbage must be bad-json')
  const bad2 = parseSidecar(JSON.stringify({ schemaVersion: 1, namespace: SIDECAR_NAMESPACE, sourceFile: 'x.md', sourceEpoch: 'not-a-uuid', sourceVersion: 1, fileDigest: '0'.repeat(64), newline: 'lf', updatedAt: 1, records: [] }))
  if (bad2.ok || !bad2.reason.includes('sourceEpoch')) throw new Error('bad epoch must be rejected')
  const dupRec = { memoryId: 'mem_11111111111111111111111111111111', anchorId: 'memory:mem_11111111111111111111111111111111', anchorLine: 1, byteStart: 0, byteEnd: 10, recordDigest: 'a'.repeat(64) }
  const bad3 = parseSidecar(JSON.stringify({ schemaVersion: 1, namespace: SIDECAR_NAMESPACE, sourceFile: 'x.md', sourceEpoch: '7f8f6a45-e27b-45a0-9bcf-d76f93acfd70', sourceVersion: 1, fileDigest: '0'.repeat(64), newline: 'lf', updatedAt: 1, records: [dupRec, dupRec] }))
  if (bad3.ok || !bad3.reason.includes('duplicate-id')) throw new Error('duplicate record id must be rejected')
  const rebuild = buildSidecar({ sourceFile: 'x.md', content: load('anchored.md') })
  if (!rebuild.ok) throw new Error('rebuild from markdown must succeed')
  const verify = parseSidecar(JSON.stringify(rebuild.sidecar))
  if (!verify.ok) throw new Error('rebuilt sidecar must validate: ' + verify.reason)
  // 读取端容忍 BOM(Windows 工具产物防御;写入端从不产出)
  const bomRead = parseSidecar('\uFEFF' + JSON.stringify(rebuild.sidecar))
  if (!bomRead.ok) throw new Error('BOM-prefixed sidecar must parse: ' + bomRead.reason)
  if (JSON.stringify(bomRead.sidecar) !== JSON.stringify(rebuild.sidecar)) throw new Error('BOM-tolerant parse must be identical')
  console.log('C9 sidecar 损坏隔离 + 从 Markdown 重建 + BOM 读取容忍 ✓')
}

// ---------- C18 无 BOM(输入 BOM 容忍 + 输出零 BOM + fixture 零 BOM) ----------
{
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('## 2026-08-22\n- a\n')])
  const p = parseAnchors(withBom)
  if (!p.bom) throw new Error('BOM input must be flagged')
  if (p.records[0].byteStart !== 0) throw new Error('byte ranges are relative to BOM-stripped content')
  for (const f of ['anchored.md', 'legacy.md', 'conflict.md', 'malformed.md', 'crlf.md', 'multibyte.md']) {
    if (isBom(load(f))) throw new Error('fixture must be BOM-free: ' + f)
  }
  console.log('C18 无 BOM ✓ (BOM 输入容忍标记, 所有输出与 fixture 零 BOM)')
}

// ---------- C10 超限防御(与 M3a 5MB skipped 语义一致) ----------
{
  const big = Buffer.concat([Buffer.from('## 2026-08-22\n- x\n', 'utf8'), Buffer.alloc(INDEX_MAX_FILE_BYTES + 8, 0x61)])
  const p = parseAnchors(big)
  if (p.status !== 'oversized' || p.records.length !== 0 || p.conflicts.length !== 0) throw new Error('parseAnchors must short-circuit oversized')
  const bs = buildSidecar({ sourceFile: 'big.md', content: big })
  if (bs.ok || bs.reason !== 'oversized') throw new Error('buildSidecar must reject oversized')
  const pl = planMigration('big.md', big)
  if (!pl.aborted || !pl.oversized || pl.operations.length !== 0) throw new Error('planMigration must abort oversized')
  if (pl.expectedFileDigest !== '') throw new Error('oversized plan must skip file hash')
  const okPl = planMigration('big.md', load('legacy.md'))
  if (okPl.aborted || okPl.operations.length !== 3) throw new Error('normal file must plan fine')
  console.log('C10 超限防御 ✓ (parse/build/plan 三入口一致, 正常文件不受影响)')
}

console.log('\n[M3B1] ALL PASS: C1-C10 + C18 (6 fixtures, 零磁盘写入, 纯只读)')
