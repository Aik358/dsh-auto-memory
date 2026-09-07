// M3b-2 原子写入基础设施测试(契约 §8-§9 + §13 矩阵 2/3/11/12/13/14 + §16 衔接项):
// render/parse 幂等、applyMigrationPlan、appendAnchoredRecord、renderReplace(§9 keep/add/remove/foreign)、
// 原子写+backup+tmp 清理、digest precondition、并发串行、故障注入(rename/copy/sidecar)、
// sidecar 落盘/损坏/重建、buildAnchoredIndex(anchor-aware, M-06)、超限防御。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { promises as fsDefault } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.on('uncaughtException', (e) => { console.error('\n[M3B2-TEST] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[M3B2-TEST] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

import { createHash } from 'node:crypto'
const {
  parseAnchors, buildSidecar, planMigration, newMemoryId, MEMORY_ID_RE, ANCHOR_PREFIX, buildAnchoredIndex,
} = await import('../../lib/memory-anchor.js')
const {
  applyMigrationPlan, appendAnchoredRecord, renderReplace, atomicReplace, MemoryDocumentStore, toEol,
} = await import('../../lib/memory-writer.js')
const { verifyRecord, INDEX_MAX_FILE_BYTES } = await import('../../lib/memory-index.js')

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'm3b1-fixtures')
const load = (f) => readFileSync(path.join(FIX, f))

// ---------- D1 render/parse 幂等 + block 移动保留 ID ----------
{
  const content = load('legacy.md')
  let n = 0
  const idFactory = () => newMemoryId('d1d2d3d4d5d6d7d8d9dadbdcdddedf' + String(++n).padStart(2, '0'))
  const plan = planMigration('f.md', content, { idFactory })
  const ap = applyMigrationPlan(content, plan)
  if (!ap.ok || ap.applied !== 3) throw new Error('apply failed: ' + (!ap.ok ? ap.reason : 'applied=' + ap.applied))
  const parsed = parseAnchors(ap.text)
  if (parsed.status !== 'clean') throw new Error('applied doc must be clean: ' + JSON.stringify(parsed.conflicts))
  if (parsed.records.length !== 3 || parsed.records.some((r) => r.kind !== 'anchored')) throw new Error('all blocks must be anchored after apply')
  for (let i = 0; i < 3; i++) {
    if (parsed.records[i].memoryId !== plan.operations[i].memoryId) throw new Error('applied id order mismatch at ' + i)
  }
  // 内容保持:每块内容包含原 heading 文本,且 marker 在内容之前(anchorByteEnd <= byteStart)
  const texts = ['# dsh 用户记忆', '硬性规则：UTF-8 无 BOM', '发布节奏：本地联调为主']
  for (let i = 0; i < 3; i++) {
    const slice = ap.text.subarray(parsed.records[i].byteStart, parsed.records[i].byteEnd).toString('utf8')
    if (!slice.includes(texts[i])) throw new Error('block ' + i + ' content drifted: ' + slice.slice(0, 40))
    if (parsed.records[i].anchorByteEnd > parsed.records[i].byteStart) throw new Error('marker must precede content')
  }
  // 重放拒绝(天然幂等):digest 已变 → 整份 stale(先拦截)
  const re = applyMigrationPlan(ap.text, plan)
  if (re.ok) throw new Error('re-apply must be rejected once file is migrated')
  if (re.reason !== 'stale-plan') throw new Error('re-apply must hit stale-plan, got: ' + re.reason)
  // 即使 digest 手工对齐,已迁移文件也无 legacy 起点可插 → not-legacy-start
  const curDigest = createHash('sha256').update(ap.text).digest('hex')
  const freshPlan = { ...plan, expectedFileDigest: curDigest }
  const re2 = applyMigrationPlan(ap.text, freshPlan)
  if (re2.ok || re2.reason !== 'not-legacy-start') throw new Error('migrated file must hit not-legacy-start, got: ' + re2.reason)
  // appendAnchoredRecord:追加后原记录区间不变 + 重复 ID 拒绝
  const app = appendAnchoredRecord(content, { memoryId: newMemoryId('aab1b2b3b4b5b6b7b8b9bacbbcbdbebf'), text: '## 2026-08-22\n- 新增条目' })
  if (!app.ok) throw new Error('append failed: ' + app.reason)
  const pa = parseAnchors(app.text)
  if (pa.status !== 'clean' || pa.records.length !== 4) throw new Error('append must yield 3 legacy + 1 anchored')
  const last = pa.records[3]
  if (last.kind !== 'anchored' || !last.memoryId.startsWith('mem_')) throw new Error('appended record shape wrong')
  for (let i = 0; i < 3; i++) {
    if (pa.records[i].byteStart !== parseAnchors(content).records[i].byteStart) throw new Error('append must not shift existing blocks')
  }
  const dup = appendAnchoredRecord(app.text, { memoryId: last.memoryId, text: 'x' })
  if (dup.ok || dup.reason !== 'duplicate-id') throw new Error('duplicate append must be rejected')
  console.log('D1 render/parse 幂等 + apply 应用 + append 稳定 + 重放拒绝 ✓')
}

// ---------- D2 applyMigrationPlan 校验矩阵 ----------
{
  const content = load('legacy.md')
  let gn = 0
  const goodPlan = planMigration('v.md', content, { idFactory: () => newMemoryId('2233445566778899aabbccddeeff00' + String(++gn).padStart(2, '0')) })
  if (applyMigrationPlan(content, null).ok) throw new Error('null plan must fail')
  if (applyMigrationPlan(content, { ...goodPlan, expectedFileDigest: '0'.repeat(64) }).ok) throw new Error('stale digest must fail')
  const badOps = { ...goodPlan, operations: [...goodPlan.operations, { ...goodPlan.operations[0] }] }
  if (applyMigrationPlan(content, badOps).ok) throw new Error('duplicate id must fail')
  const chaos = { ...goodPlan, operations: [goodPlan.operations[2], goodPlan.operations[0], goodPlan.operations[1]] }
  if (applyMigrationPlan(content, chaos).ok) throw new Error('out-of-order atByte must fail')
  const mid = { ...goodPlan, operations: [{ ...goodPlan.operations[0], atByte: goodPlan.operations[0].atByte + 1 }] }
  if (applyMigrationPlan(content, mid).ok) throw new Error('non-line-start atByte must fail')
  const big = Buffer.concat([Buffer.from('## 2026-08-22\n- x\n', 'utf8'), Buffer.alloc(INDEX_MAX_FILE_BYTES + 8, 0x61)])
  const bigPlan = { ...goodPlan, expectedFileDigest: 'x' }
  if (applyMigrationPlan(big, bigPlan).ok || applyMigrationPlan(big, bigPlan).reason !== 'oversized') throw new Error('oversized must fail first')
  // 恒定 idFactory 必须被重试上限拦截,不得挂死
  const constPlan = planMigration('c.md', load('legacy.md'), { idFactory: () => newMemoryId('22aa'.repeat(8)) })
  if (!constPlan.aborted || !constPlan.conflicts.some((c) => c.type === 'id-exhausted')) throw new Error('constant idFactory must abort with id-exhausted')
  console.log('D2 apply 校验矩阵 ✓ (bad-plan/stale/duplicate/out-of-order/非行首/超限/恒定 idFactory 上限)')
}

// ---------- D3 renderReplace §9 语义 ----------
{
  // 初始:一个 anchored 文件
  const initial = load('anchored.md') // 2 anchored (mem_1111..., mem_2222...) + 1 preamble legacy
  let rn = 0
  const rid = () => newMemoryId('e1e2e3e4e5e6e7e8e9eaebecedeeef' + String(++rn).padStart(2, '0'))
  // replacement:保留 mem_1111,删除 mem_2222,新增一个无 anchor 块(preamble;
  // 解析语义:anchored 记录之后的无 marker 文本属于该记录内容,新块必须在 preamble 或两条 anchored 之间)
  const replacement = Buffer.from('## 2026-08-22\n- 全新条目块\n\n<!-- memory:mem_11111111111111111111111111111111 -->\n## 2026-08-14\n- 文件编码规则：禁止 BOM\n')
  const rr = renderReplace(initial, replacement, { idFactory: rid })
  if (!rr.ok) throw new Error('replace failed: ' + rr.reason)
  if (!rr.kept.includes('mem_11111111111111111111111111111111')) throw new Error('kept must include existing id')
  if (!rr.removed.includes('mem_22222222222222222222222222222222')) throw new Error('removed must include omitted id')
  if (rr.foreign.length !== 0) throw new Error('no foreign ids expected')
  if (rr.added.length !== 1) throw new Error('one new block must get one id, got ' + rr.added.length)
  const rp = parseAnchors(rr.text)
  if (rp.status !== 'clean') throw new Error('replaced doc must be clean: ' + JSON.stringify(rp.conflicts))
  if (!rp.records.some((r) => r.kind === 'anchored' && r.memoryId === rr.added[0].memoryId)) throw new Error('added id must appear in output')
  if (!rp.records.some((r) => r.kind === 'anchored' && r.memoryId === 'mem_11111111111111111111111111111111')) throw new Error('kept id must appear in output')
  // 外来 ID(显式声明):保留并在 foreign 报告
  const foreignDoc = Buffer.from('<!-- memory:mem_abababababababababababababababab -->\n## 外来\n- 显式 ID 块\n<!-- memory:mem_11111111111111111111111111111111 -->\n## 2026-08-14\n- 保留块\n')
  const rf = renderReplace(initial, foreignDoc, { idFactory: rid })
  if (!rf.ok || !rf.foreign.includes('mem_abababababababababababababababab')) throw new Error('explicit foreign id must be kept+reported')
  // 冲突 replacement 拒绝
  const conflictDoc = Buffer.from('<!-- memory:mem_11111111111111111111111111111111 -->\n## A\n- x\n<!-- memory:mem_11111111111111111111111111111111 -->\n## B\n- y\n')
  const rc = renderReplace(initial, conflictDoc, { idFactory: rid })
  if (rc.ok || !rc.reason.startsWith('conflict')) throw new Error('conflict replacement must be rejected')
  // 空 replacement(清空):全部 removed
  const rEmpty = renderReplace(initial, Buffer.alloc(0), { idFactory: rid })
  if (!rEmpty.ok || rEmpty.removed.length !== 2 || rEmpty.kept.length !== 0) throw new Error('empty replacement must remove all')
  console.log('D3 replace §9 语义 ✓ (kept/added/removed/foreign/conflict/清空)')
}

// ---------- D4 store 事务:新文件/追加/sidecar/backup/tmp 清理 ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m3b2-'))
  try {
    const dir = path.join(ws, 'mem')
    const side = path.join(ws, 'side')
    const bak = path.join(ws, 'bak')
    const store = new MemoryDocumentStore({ sidecarDir: side, backupDir: bak, now: () => 1700000000000 })
    const f = path.join(dir, 'MEMORY.md')
    const id1 = newMemoryId('aa11'.repeat(8))
    const a1 = await store.append(f, '## 2026-08-22\n- 第一条', { memoryId: id1 })
    if (!a1.ok || a1.dirty || !a1.sidecar) throw new Error('first append failed: ' + a1.reason)
    if (parseAnchors(readFileSync(f)).records.length !== 1) throw new Error('file must contain 1 record')
    const id2 = newMemoryId('aa22'.repeat(8))
    const a2 = await store.append(f, '## 2026-08-22\n- 第二条', { memoryId: id2 })
    if (!a2.ok) throw new Error('second append failed: ' + a2.reason)
    // backup 存在(第一次写无 backup,第二次写有)
    const baks = readdirSync(bak)
    if (baks.length !== 1 || !baks[0].endsWith('MEMORY.md')) throw new Error('backup missing: ' + JSON.stringify(baks))
    // tmp 清理
    const leftovers = readdirSync(dir).filter((x) => x.includes('.dam-pre-tmp-'))
    if (leftovers.length) throw new Error('tmp leftovers: ' + JSON.stringify(leftovers))
    // sidecar 落盘且可读
    const sc = await store.readSidecar(f)
    if (!sc.ok || sc.sidecar.records.length !== 2 || sc.sidecar.sourceVersion !== 2) throw new Error('sidecar wrong: ' + sc.reason)
    // 追加的内容字节级验证
    const final = parseAnchors(readFileSync(f))
    if (final.records.length !== 2 || final.records[0].memoryId !== id1 || final.records[1].memoryId !== id2) throw new Error('record order/ids wrong')
    console.log('D4 store 事务 ✓ (新文件创建/追加/sidecar 落盘/backup/tmp 零残留)')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ---------- D5 digest precondition(外部编辑冲突不覆盖) ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m3b2-'))
  try {
    const store = new MemoryDocumentStore({})
    const f = path.join(ws, 'log.md')
    writeFileSync(f, '## 2026-08-22\n- 原内容\n', 'utf8')
    const wrong = 'f'.repeat(64)
    const r1 = await store.append(f, '## 2026-08-22\n- 追加', { expectedDigest: wrong })
    if (r1.ok || r1.reason !== 'conflict-external-edit') throw new Error('wrong digest must be rejected')
    if (readFileSync(f, 'utf8') !== '## 2026-08-22\n- 原内容\n') throw new Error('file must be untouched on conflict')
    const text = readFileSync(f)
    const realDigest = createHash('sha256').update(text).digest('hex')
    const ok = await store.append(f, '## 2026-08-22\n- 追加', { expectedDigest: realDigest })
    if (!ok.ok) throw new Error('matching digest must pass: ' + ok.reason)
    console.log('D5 digest precondition ✓ (错 digest 拒绝且零写入, 对 digest 通过)')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ---------- D6 并发写同文件串行不丢失 ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m3b2-'))
  try {
    const store = new MemoryDocumentStore({})
    const f = path.join(ws, 'log.md')
    writeFileSync(f, '## 2026-08-22\n- 初始\n', 'utf8')
    const jobs = []
    for (let i = 1; i <= 4; i++) {
      jobs.push(store.append(f, '## 2026-08-22\n- 并发条目 ' + i))
    }
    const results = await Promise.all(jobs)
    for (const r of results) if (!r.ok) throw new Error('concurrent append failed: ' + r.reason)
    const final = parseAnchors(readFileSync(f))
    const anchors = final.records.filter((r) => r.kind === 'anchored')
    if (anchors.length !== 4) throw new Error('all concurrent appends must survive, got ' + anchors.length)
    const uniq = new Set(anchors.map((r) => r.memoryId))
    if (uniq.size !== 4) throw new Error('ids must be unique')
    console.log('D6 并发写同文件串行 ✓ (4 并发全部保留, ID 唯一)')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ---------- D7 故障注入:rename/copy/sidecar ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m3b2-'))
  try {
    const f = path.join(ws, 'doc.md')
    writeFileSync(f, '## 2026-08-22\n- 原内容\n', 'utf8')
    const original = readFileSync(f)
    const mkSpy = (fail) => ({
      ...fsDefault,
      rename: async (a, b) => {
        const isJson = String(b).endsWith('.json')
        if (isJson && (fail.sidecar || fail.all)) throw new Error('injected: ' + fail.kind)
        if (!isJson && fail.all) throw new Error('injected: ' + fail.kind)
        return fsDefault.rename(a, b)
      },
      copyFile: async (a, b) => { if (fail.copy) throw new Error('injected copy'); return fsDefault.copyFile(a, b) },
    })
    // 7a: rename 失败 → write-failed,原文件不动,tmp 清理
    const s1 = new MemoryDocumentStore({ fs: mkSpy({ all: true, kind: 'rename' }), backupDir: path.join(ws, 'bak1') })
    const r1 = await s1.append(f, '## x\n- y')
    if (r1.ok || !r1.reason.startsWith('write-failed')) throw new Error('rename failure must surface: ' + r1.reason)
    if (readFileSync(f).equals(original) === false) throw new Error('file must be untouched after rename failure')
    if (readdirSync(ws).some((x) => x.includes('.dam-pre-tmp-'))) throw new Error('tmp must be cleaned after rename failure')
    // 7b: backup 失败 → backup-failed 且不写
    const s2 = new MemoryDocumentStore({ fs: mkSpy({ copy: true }), backupDir: path.join(ws, 'bak2') })
    const r2 = await s2.append(f, '## x\n- y')
    if (r2.ok || !r2.reason.startsWith('backup-failed')) throw new Error('backup failure must abort: ' + r2.reason)
    if (readFileSync(f).equals(original) === false) throw new Error('file must be untouched after backup failure')
    // 7c: sidecar 写失败 → Markdown 已更新 + dirty=true(不回滚)
    const s3 = new MemoryDocumentStore({ fs: mkSpy({ sidecar: true, kind: 'sidecar' }), sidecarDir: path.join(ws, 'side3'), backupDir: path.join(ws, 'bak3') })
    const r3 = await s3.append(f, '## 2026-08-22\n- 新内容', { memoryId: newMemoryId('bbbb'.repeat(8)) })
    if (!r3.ok || r3.dirty !== true) throw new Error('sidecar failure must mark dirty, got: ' + JSON.stringify(r3))
    if (parseAnchors(readFileSync(f)).records.length !== 2) throw new Error('markdown must be updated despite sidecar failure')
    console.log('D7 故障注入 ✓ (rename 失败零污染+tmp 清理 / backup 失败中止 / sidecar 失败 dirty 不回滚)')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ---------- D8 sidecar 生命周期:损坏隔离 → 重建 → 删除重建(新 epoch) ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m3b2-'))
  try {
    const store = new MemoryDocumentStore({ sidecarDir: path.join(ws, 'side') })
    const f = path.join(ws, 'mem.md')
    await store.append(f, '## 2026-08-22\n- a', { memoryId: newMemoryId('cc11'.repeat(8)) })
    const sp = store.sidecarPath(f)
    if (!sp || !readdirSync(ws + '/side').length) throw new Error('sidecar file must exist')
    const epoch1 = (await store.readSidecar(f)).sidecar.sourceEpoch
    const v1 = (await store.readSidecar(f)).sidecar.sourceVersion
    // 损坏 → invalid
    writeFileSync(sp, '{ broken json', 'utf8')
    const bad = await store.readSidecar(f)
    if (bad.ok || !bad.reason.startsWith('bad-json')) throw new Error('corrupt sidecar must be flagged: ' + bad.reason)
    // 重建 → ok,新... 等等:rebuildSidecar 无 prev → 新 epoch + version=1(契约 §6)
    const rb = await store.rebuildSidecar(f)
    if (!rb.ok) throw new Error('rebuild failed: ' + rb.reason)
    const after = await store.readSidecar(f)
    if (!after.ok || after.sidecar.records.length !== 1) throw new Error('rebuilt sidecar must validate')
    if (after.sidecar.sourceEpoch === epoch1) throw new Error('rebuild from scratch must open new epoch')
    if (after.sidecar.sourceVersion !== 1) throw new Error('rebuild from scratch must start at version 1')
    // 删除 → missing → rebuild 恢复
    rmSync(sp, { force: true })
    const miss = await store.readSidecar(f)
    if (miss.ok || miss.reason !== 'missing') throw new Error('deleted sidecar must report missing')
    await store.rebuildSidecar(f)
    if (!(await store.readSidecar(f)).ok) throw new Error('rebuild after delete must restore')
    console.log('D8 sidecar 生命周期 ✓ (损坏隔离/重建新 epoch/删除后 restore)')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ---------- D9 buildAnchoredIndex(anchor-aware, M-06 rebuild 语义) ----------
{
  const anchored = load('anchored.md')
  const p = parseAnchors(anchored)
  const idx = buildAnchoredIndex('a.md', anchored, undefined)
  if (idx.skipped || idx.records.length !== 3) throw new Error('anchored index must have 3 records (1 legacy + 2 anchored), got ' + idx.records.length)
  for (let i = 0; i < idx.records.length; i++) {
    if (idx.records[i].byteStart !== p.records[i].byteStart || idx.records[i].recordDigest !== p.records[i].recordDigest) throw new Error('index must mirror parseAnchors ranges')
    if (idx.records[i].kind === 'anchored' && !MEMORY_ID_RE.test(idx.records[i].memoryId)) throw new Error('anchored index record must carry memoryId')
  }
  // marker 不在内容区间内
  if (idx.records[1].anchorByteEnd > idx.records[1].byteStart) throw new Error('marker bytes must not be inside content range')
  // 文件级 stale:编辑文件后所有记录 stale
  const edited = Buffer.from(anchored.toString('utf8').replace('禁止 BOM', '禁止 BOM 编辑'), 'utf8')
  for (const rec of idx.records) if (verifyRecord(rec, edited).fresh) throw new Error('edited file must stale all records')
  // 确定性版本:同内容重建版本不变,内容变为 2
  const idx2 = buildAnchoredIndex('a.md', anchored, { fileDigest: idx.fileDigest, version: idx.sourceVersion })
  if (idx2.sourceVersion !== idx.sourceVersion) throw new Error('same content must keep version')
  const idx3 = buildAnchoredIndex('a.md', edited, { fileDigest: idx.fileDigest, version: idx.sourceVersion })
  if (idx3.sourceVersion !== idx.sourceVersion + 1) throw new Error('edited content must bump version')
  // 超限 skipped
  const big = Buffer.concat([Buffer.from('## 2026-08-22\n- x\n', 'utf8'), Buffer.alloc(INDEX_MAX_FILE_BYTES + 8, 0x61)])
  if (!buildAnchoredIndex('big.md', big, undefined).skipped) throw new Error('oversized must be skipped')
  console.log('D9 buildAnchoredIndex ✓ (镜像 parse/区间不含 marker/文件级 stale/版本/超限)')
}

// ---------- D10 超限防御贯穿写入事务 ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m3b2-'))
  try {
    const store = new MemoryDocumentStore({})
    const f = path.join(ws, 'big.md')
    writeFileSync(f, Buffer.concat([Buffer.from('## 2026-08-22\n- x\n', 'utf8'), Buffer.alloc(INDEX_MAX_FILE_BYTES + 8, 0x61)]))
    const r = await store.append(f, '## 2026-08-22\n- 追加')
    if (r.ok || r.reason !== 'oversized') throw new Error('append to oversized must reject: ' + JSON.stringify(r))
    const rp = await store.replace(f, '## 2026-08-22\n- y\n')
    if (rp.ok || rp.reason !== 'oversized') throw new Error('replace on oversized must reject: ' + JSON.stringify(rp))
    const plan = planMigration('f.md', load('legacy.md'), {})
    const ra = await store.applyPlan(f, plan)
    if (ra.ok || ra.reason !== 'oversized') throw new Error('applyPlan on oversized must reject: ' + JSON.stringify(ra))
    console.log('D10 超限防御贯穿事务 ✓ (append/replace/applyPlan 三路一致)')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

// ---------- D11-D13 审查加固:BOM 拒绝/空记录拒绝/verify-mismatch ----------
{
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m3b2-'))
  try {
    const store = new MemoryDocumentStore({})
    const f = path.join(ws, 'bom.md')
    // D11: 带 BOM 的现有文件 append → bom-rejected 且字节零改动(fail closed,契约 §10 无 BOM)
    writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('## 2026-08-22\n- 有 BOM 的旧文件\n')]))
    const before = readFileSync(f)
    const rb = await store.append(f, '## 2026-08-22\n- 追加')
    if (rb.ok || rb.reason !== 'bom-rejected') throw new Error('BOM file must be rejected, got: ' + JSON.stringify(rb))
    if (readFileSync(f).equals(before) === false) throw new Error('BOM file must stay untouched')
    // D12: 空 text → empty-record(否则会产出 orphan-anchor conflict 文档)
    const okFile = path.join(ws, 'ok.md')
    const re = await store.append(okFile, '   ')
    if (re.ok || re.reason !== 'empty-record') throw new Error('empty record must be rejected, got: ' + JSON.stringify(re))
    if (readdirSync(ws).includes('ok.md')) throw new Error('empty record must not create file')
    // 矩阵3 写入侧:CRLF 文件追加 → marker/内容全部 \r\n,parse 回读 newline='crlf'
    const crlfFile = path.join(ws, 'crlf.md')
    writeFileSync(crlfFile, '# 旧日志\r\n\r\n旧内容行\r\n', 'utf8')
    const crlfId = newMemoryId('dd11'.repeat(8))
    const rc = await store.append(crlfFile, '## 2026-08-22\n- CRLF 追加', { memoryId: crlfId })
    if (!rc.ok) throw new Error('CRLF append failed: ' + rc.reason)
    const crlfBuf = readFileSync(crlfFile)
    const crlfText = crlfBuf.toString('utf8')
    if (crlfText.includes('<!-- memory:' + crlfId + ' -->\n')) throw new Error('marker must use file CRLF style')
    if (!crlfText.includes('<!-- memory:' + crlfId + ' -->\r\n')) throw new Error('marker must be present with CRLF ending')
    const pc = parseAnchors(crlfBuf)
    if (pc.newline !== 'crlf' || pc.status !== 'clean') throw new Error('CRLF append parse wrong: ' + JSON.stringify(pc.conflicts))
    // 原 preamble legacy 保留 + 新 anchored 追加 = 2 条;既有块字节区间不受追加影响
    if (pc.records.length !== 2 || pc.records[0].kind !== 'legacy' || pc.records[1].kind !== 'anchored') throw new Error('CRLF append records wrong')
    if (pc.records[1].memoryId !== crlfId) throw new Error('CRLF appended id wrong')
    console.log('D11 BOM 文件拒绝零改动 ✓ / D12 空记录拒绝 ✓ / CRLF append 渲染 ✓')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}
{
  // D13: 写入后重读内容被篡改(磁盘异常模拟) → verify-mismatch 且 written:true
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m3b2-'))
  try {
    const real = fsDefault
    let tamperNext = false
    let mdReads = 0
    const spy = {
      ...real,
      readFile: async (p) => {
        const buf = await real.readFile(p)
        if (String(p).endsWith('.md')) {
          mdReads += 1
          // 第 1 次 .md 读取是 _readState(读原文件);第 2 次是 _commit 的步骤8 重读——只篡改重读
          if (tamperNext && mdReads >= 2) { tamperNext = false; return Buffer.from('TAMPERED', 'utf8') }
        }
        return buf
      },
    }
    const store = new MemoryDocumentStore({ fs: spy })
    const f = path.join(ws, 'doc.md')
    writeFileSync(f, '## 2026-08-22\n- 原始\n', 'utf8')
    tamperNext = true
    const r = await store.append(f, '## 2026-08-22\n- 新记录')
    if (r.ok || r.reason !== 'verify-mismatch' || r.written !== true) throw new Error('tampered reread must surface verify-mismatch, got: ' + JSON.stringify(r))
    console.log('D13 verify-mismatch 注入 ✓ (步骤8 重读比对生效)')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

console.log('\n[M3B2] ALL PASS: D1-D13 (临时目录隔离, 真实记忆零接触)')
