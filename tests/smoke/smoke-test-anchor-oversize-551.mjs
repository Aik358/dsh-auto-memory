#!/usr/bin/env node
/**
 * #551 回归：锚点追加/迁移/替换必须判「组装后的最终字节」，不只判输入尺寸。
 *
 * 缺陷（修前实测）：
 *   appendAnchoredRecord 只在 :132 判 `buf.length > INDEX_MAX_FILE_BYTES`；
 *   组装出 marker + 状态行 + 正文后**不判最终字节**，直接返回 ok:true。
 *   5,242,780 B（余量 100 B）的文件追加 161 B 块 ⇒ 落盘 5,242,941 B（超限 61 B）；
 *   此后 parseAnchors.status=oversized、buildIndex.skipped=true、再追加永久 oversized。
 *
 * 本套件锁定的修复：
 *   ① 组装后超限 ⇒ { ok:false, reason:'oversized-after-append', limit, bytes, delta, text }，**零写盘**；
 *   ② limit/bytes/delta 数值（delta = bytes - limit，text = 组装结果，供调用方归档/拆分）；
 *   ③ 余量充足时正常追加/迁移/替换；
 *   ④ 同批收口的 applyMigrationPlan / renderReplace / replaceSingleRecord 各一条正/负路径。
 *
 * 全部走真 fs 夹具 + 真 MemoryDocumentStore（读→渲染→提交链路），不做源码字符串断言。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { installExitGuard, guardCleanup } from './_exit-guard.mjs'
import {
  appendAnchoredRecord, applyMigrationPlan, renderReplace, replaceSingleRecord, MemoryDocumentStore,
} from '../../lib/memory-writer.js'
import { parseAnchors } from '../../lib/memory-anchor.js'
import { INDEX_MAX_FILE_BYTES, buildIndex } from '../../lib/memory-index.js'

const G = installExitGuard({ suite: 'anchor-oversize-551' })
const LIMIT = INDEX_MAX_FILE_BYTES
const ROOT = mkdtempSync(path.join(tmpdir(), 'dsh-551-'))
const STORE = new MemoryDocumentStore()
const ID_A = 'mem_' + 'a'.repeat(32)
const ID_B = 'mem_' + 'b'.repeat(32)
const BODY = '锚点追加正文，64 字节量级 —— padding padding padding 01234567'
const BODY_BYTES = Buffer.byteLength(BODY, 'utf8')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const snap = (file) => {
  const buf = readFileSync(file)
  return { bytes: buf.length, sha: sha256(buf) }
}

/** 合法、无 anchor 的夹具：标题行 + 单条超长填充（legacy 块起点 = 0，且**不以换行结尾**）。 */
function fixture(bytes) {
  const head = '## 2026-08-22\n- x'
  const headLen = Buffer.byteLength(head, 'utf8')
  assert.ok(bytes > headLen, 'fixture target too small')
  const buf = Buffer.concat([Buffer.from(head, 'utf8'), Buffer.alloc(bytes - headLen, 0x61)])
  assert.equal(buf.length, bytes)
  return buf
}

const planFor = (buf, memoryId) => ({
  aborted: false,
  expectedFileDigest: sha256(buf),
  operations: [{ kind: 'insert-anchor', atByte: 0, memoryId }],
})

let pass = 0
let fail = 0
async function test(name, fn) {
  try {
    await fn()
    pass += 1
    console.log('[PASS] ' + name)
  } catch (e) {
    fail += 1
    console.error('[FAIL] ' + name + ' — ' + (e && (e.message || e)))
  }
}

try {
  // 块开销/插入开销都用**真实调用**量出，不写死魔法数；同时验证小文件路径仍未回归。
  const refBase = Buffer.from('## 2026-08-22\n- x', 'utf8')
  const ref = appendAnchoredRecord(refBase, { memoryId: ID_A, text: BODY })
  assert.equal(ref.ok, true, '小文件追加必须仍成功')
  const BLOCK_BYTES = ref.text.length - refBase.length

  const migBase = fixture(200)
  const migRef = applyMigrationPlan(migBase, planFor(migBase, ID_B))
  assert.equal(migRef.ok, true, '小文件迁移必须仍成功')
  const MARKER_BYTES = migRef.text.length - migBase.length

  console.log('[phy] INDEX_MAX_FILE_BYTES=' + LIMIT + ' BODY=' + BODY_BYTES + 'B 块开销=' + BLOCK_BYTES + 'B marker=' + MARKER_BYTES + 'B')
  assert.equal(BLOCK_BYTES, 161, '夹具/渲染格式变了就必须重钉期望（原实测 161 B）')
  assert.equal(MARKER_BYTES, 53, 'marker 行长度变了就必须重钉期望（原实测 53 B）')

  // ── T1/T2：上限 −100 B，首追加被拒、字段正确、磁盘字节+sha 完全不变 ──
  const nearFile = path.join(ROOT, 'append-near-limit.md')
  const nearStart = LIMIT - 100
  writeFileSync(nearFile, fixture(nearStart))
  const nearBefore = snap(nearFile)
  const rejected = await STORE.append(nearFile, BODY, { memoryId: ID_A })

  await test('T1 首追加被拒：ok=false / reason / limit / bytes / delta / text', async () => {
    assert.equal(rejected.ok, false)
    assert.equal(rejected.reason, 'oversized-after-append')
    assert.equal(rejected.limit, LIMIT)
    assert.equal(rejected.bytes, nearStart + BLOCK_BYTES)
    assert.equal(rejected.bytes - LIMIT, 61, '报告实测超限 61 B')
    assert.equal(rejected.delta, rejected.bytes - LIMIT)
    assert.ok(Buffer.isBuffer(rejected.text), '失败结果必须保留组装结果 text')
    assert.equal(rejected.text.length, rejected.bytes)
    assert.ok(Buffer.isBuffer(rejected.text))
    assert.ok(rejected.text.length > LIMIT)
  })

  await test('T2 被拒后磁盘字节与 sha 完全不变', async () => {
    const after = snap(nearFile)
    assert.deepEqual(after, nearBefore, '拒绝路径绝不写盘')
    assert.equal(statSync(nearFile).size, nearStart)
  })

  await test('T3 未进入 oversized 坏状态：parse=clean / 可索引 / 再追加仍按同一判据拒绝', async () => {
    const parsed = parseAnchors(readFileSync(nearFile))
    assert.equal(parsed.status, 'clean', '被拒的追加不得破坏文件可解析性')
    const idx = buildIndex(nearFile, readFileSync(nearFile))
    assert.notEqual(idx.skipped, true, '文件不得因此变成 skipped')
    assert.ok(idx.records.length >= 1)
    const again = await STORE.append(nearFile, BODY, { memoryId: ID_B })
    assert.equal(again.ok, false)
    assert.equal(again.reason, 'oversized-after-append')
    assert.deepEqual(snap(nearFile), nearBefore)
  })

  // ── T4：余量 4096 B，正常追加且可续写 ──
  await test('T4 余量充足时正常追加（落盘 ≤ 上限、parseAnchors=clean、可续写）', async () => {
    const file = path.join(ROOT, 'append-headroom.md')
    const start = LIMIT - 4096
    writeFileSync(file, fixture(start))
    const r1 = await STORE.append(file, BODY, { memoryId: ID_B })
    assert.equal(r1.ok, true)
    assert.equal(statSync(file).size, start + BLOCK_BYTES)
    assert.ok(statSync(file).size <= LIMIT)
    assert.equal(parseAnchors(readFileSync(file)).status, 'clean')
    const r2 = await STORE.append(file, '第二条', { memoryId: ID_A })
    assert.equal(r2.ok, true)
    assert.ok(statSync(file).size <= LIMIT)
  })

  // ── T5：applyMigrationPlan（插入 marker 后判总长）──
  await test('T5 迁移插入后超限被拒且不写盘（负路径）', async () => {
    const file = path.join(ROOT, 'plan-near-limit.md')
    const start = LIMIT - 30
    const buf = fixture(start)
    writeFileSync(file, buf)
    const before = snap(file)
    const r = await STORE.applyPlan(file, planFor(buf, ID_A))
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'oversized-after-append')
    assert.equal(r.limit, LIMIT)
    assert.equal(r.bytes, start + MARKER_BYTES)
    assert.equal(r.delta, r.bytes - LIMIT)
    assert.equal(r.delta, 23)
    assert.ok(Buffer.isBuffer(r.text))
    assert.equal(r.text.length, start + MARKER_BYTES)
    assert.deepEqual(snap(file), before, '拒绝路径绝不写盘')
  })

  await test('T5b 余量充足时迁移正常（正路径）', async () => {
    const file = path.join(ROOT, 'plan-headroom.md')
    const start = LIMIT - 4096
    const buf = fixture(start)
    writeFileSync(file, buf)
    const r = await STORE.applyPlan(file, planFor(buf, ID_B))
    assert.equal(r.ok, true)
    assert.equal(r.applied, 1)
    assert.equal(statSync(file).size, start + MARKER_BYTES)
    assert.ok(statSync(file).size <= LIMIT)
    const parsed = parseAnchors(readFileSync(file))
    assert.equal(parsed.status, 'clean')
    assert.equal(parsed.records[0].kind, 'anchored')
  })

  // ── T6：renderReplace（整篇替换 + 插入 marker 后判总长）──
  await test('T6 替换插入后超限被拒且不写盘（负路径）', async () => {
    const file = path.join(ROOT, 'replace-near-limit.md')
    writeFileSync(file, '## 2026-08-22\n- old\n')
    const before = snap(file)
    const rep = fixture(LIMIT - 30)
    const r = await STORE.replace(file, rep)
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'oversized-after-append')
    assert.equal(r.bytes, (LIMIT - 30) + MARKER_BYTES)
    assert.equal(r.delta, 23)
    assert.ok(Buffer.isBuffer(r.text))
    assert.equal(r.text.length, r.bytes)
    assert.deepEqual(snap(file), before, '拒绝路径绝不写盘')
  })

  await test('T6b 余量充足时替换正常（正路径）', async () => {
    const file = path.join(ROOT, 'replace-headroom.md')
    writeFileSync(file, '## 2026-08-22\n- old\n')
    const rep = fixture(LIMIT - 4096)
    const r = await STORE.replace(file, rep)
    assert.equal(r.ok, true)
    assert.equal(r.added.length, 1)
    assert.equal(statSync(file).size, (LIMIT - 4096) + MARKER_BYTES)
    assert.ok(statSync(file).size <= LIMIT)
    assert.equal(parseAnchors(readFileSync(file)).status, 'clean')
  })

  // ── T7：replaceSingleRecord（同形状第四处；组装后不判总长）──
  await test('T7 单记录替换组装后超限被拒且不写盘（负路径）', async () => {
    const file = path.join(ROOT, 'single-near-limit.md')
    writeFileSync(file, '## 2026-08-22\n- old\n')
    const before = snap(file)
    const body = 'x'.repeat(LIMIT - 10)
    const r = await STORE.replaceSingle(file, body)
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'oversized-after-append')
    assert.equal(r.bytes, LIMIT + MARKER_BYTES - 10)
    assert.equal(r.delta, MARKER_BYTES - 10)
    assert.ok(Buffer.isBuffer(r.text))
    assert.equal(r.text.length, r.bytes)
    assert.deepEqual(snap(file), before, '拒绝路径绝不写盘')
  })

  await test('T7b 余量充足时单记录替换正常（正路径）', async () => {
    const file = path.join(ROOT, 'single-headroom.md')
    writeFileSync(file, '## 2026-08-22\n- old\n')
    const body = 'x'.repeat(1024)
    const r = await STORE.replaceSingle(file, body)
    assert.equal(r.ok, true)
    assert.equal(statSync(file).size, MARKER_BYTES + Buffer.byteLength(body, 'utf8'))
    const parsed = parseAnchors(readFileSync(file))
    assert.equal(parsed.status, 'clean')
    assert.equal(parsed.records.length, 1)
  })

  // ── T8：三个原语的纯函数返回值与提交层一致（防止 store 层单独吞掉判据）──
  await test('T8 纯渲染原语自身也返回同一超限判据', async () => {
    const a = appendAnchoredRecord(fixture(LIMIT - 100), { memoryId: ID_A, text: BODY })
    assert.equal(a.ok, false)
    assert.equal(a.reason, 'oversized-after-append')
    const mBase = fixture(LIMIT - 30)
    const m = applyMigrationPlan(mBase, planFor(mBase, ID_B))
    assert.equal(m.ok, false)
    assert.equal(m.reason, 'oversized-after-append')
    const rep = fixture(LIMIT - 30)
    const r = renderReplace(Buffer.from('## 2026-08-22\n- old\n'), rep)
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'oversized-after-append')
    const s = replaceSingleRecord(Buffer.from('## 2026-08-22\n- old\n'), 'x'.repeat(LIMIT - 10))
    assert.equal(s.ok, false)
    assert.equal(s.reason, 'oversized-after-append')
  })
} finally {
  guardCleanup(G, 'rm-temp', () => rmSync(ROOT, { recursive: true, force: true }))
}

console.log('[551] PASS ' + pass + ' / ' + (pass + fail) + ' 组；' + G.summary())
process.exit(fail === 0 && !G.failed() ? 0 : 1)
