#!/usr/bin/env node
/**
 * smoke-test-issue488-baseline-bomb.mjs —— #488 基线解包的 64MiB 限制在解压**之后**才检查。
 *
 * ## 缺陷（改前实测）
 * `unpackBaselinePre` 先 `zlib.brotliDecompressSync(buf)` 把整个明文拉进内存，
 * **然后**才判 `inner.length > 64MiB`。高压缩比包（brotli 对全零/重复字节的压缩比可达
 * 数千倍）因此可以先用「解压产物」把进程撑爆，再收到一句「太大了」。
 *
 * ## 修法（lib/team-baseline.js）
 *   ① 编码输入闸门：`TEAM_BASELINE_MAX_ENCODED_PRE` 在 **base64 解码之前**判；
 *   ② 解压阶段闸门：`brotliDecompressSync(buf, { maxOutputLength: 64MiB })`
 *      ⇒ zlib 在解压途中抛 ERR_BUFFER_TOO_LARGE，堆上不会出现超限的输出缓冲。
 *
 * ## 验收方式（CR-10：真 import → 真构造 → 真调用 → 断言返回值 + 可复算物理量）
 *   用**流式** brotli 压缩造一个 192MiB 明文的合法 JSON（本进程峰值只多 0.4MiB），
 *   把它伪造成基线包喂给**真模块**，断言：
 *     · 返回值是 { ok:false, reason:/brotli-cap/ }，**不是**一个大数组/大 Buffer；
 *     · 解压路径的峰值增量 ΔarrayBuffers ≤ 96MiB（改前是 320MiB，实测见下方 J-1）。
 *
 * ## 判据
 *   正路径 J-1 192MiB 炸弹 ⇒ ok:false + reason 含 brotli-cap + ΔarrayBuffers ≤ 96MiB
 *   正路径 J-2 刚好超限（64MiB+2MiB）⇒ 同样在解压阶段被截停
 *   正路径 J-3 正常包 pack→unpack 逐字节一致（修复没有误伤合法包）
 *   正路径 J-4 **接近上限**的合法包（48MiB 明文，低于 64MiB 线）仍能解包成功
 *   负路径 J-5 编码输入超限 ⇒ reason 以 body-too-large 开头（在 base64 解码**之前**判）
 *   守卫   J-6 上限常量形状（有限正数、encoded > raw）
 *
 * ## 变异负路径（自带，MUT-488）
 *   把 `maxOutputLength` 从产线删掉（锚串先断言恰好命中 1 次）⇒
 *   J-1 的「reason 含 brotli-cap」与「ΔarrayBuffers ≤ 96MiB」两条**必红**：
 *   实测改后 ΔarrayBuffers = 320.0MiB / reason = 'unpacked-too-large: 201326592'。
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import zlib from 'node:zlib'

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const ROOT = path.resolve(HERE, '..', '..')
const MOD_PATH = path.join(ROOT, 'lib', 'team-baseline.js')
const M = await import(pathToFileURL(MOD_PATH).href)

const { packBaselinePre, unpackBaselinePre, TEAM_BASELINE_MAX_RAW_BYTES_PRE, TEAM_BASELINE_MAX_ENCODED_PRE } = M

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.error('  FAIL - ' + name + ' :: ' + String((e && e.message) || e).slice(0, 300)) }
}
async function okAsync(name, fn) {
  try { await fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.error('  FAIL - ' + name + ' :: ' + String((e && e.message) || e).slice(0, 300)) }
}

// ── 构造一个「明文 N 字节、压缩后只有几十 KB」的合法基线 JSON（**流式**压缩，避免本进程被撑大）
const CHUNK = 4 * 1024 * 1024
async function streamBombBody(totalBytes) {
  const head = Buffer.from('{"v":1,"checksum":"deadbeef","files":{"event-store.json":"', 'utf8')
  const tail = Buffer.from('"}}', 'utf8')
  async function* gen() {
    let left = totalBytes - head.length - tail.length
    const chunk = Buffer.alloc(CHUNK, 0x41)
    yield head
    while (left > 0) { const n = Math.min(CHUNK, left); yield n === CHUNK ? chunk : chunk.subarray(0, n); left -= n }
    yield tail
  }
  const bro = zlib.createBrotliCompress({ params: (() => { const p = {}; p[zlib.constants.BROTLI_PARAM_QUALITY] = 1; return p })() })
  const chunks = []
  for await (const c of Readable.from(gen()).pipe(bro)) chunks.push(c)
  return Buffer.concat(chunks).toString('base64')
}

/** 调一次解包并量出**解压路径**的峰值增量（ΔarrayBuffers / Δrss）。 */
function measureUnpack(mod, payload) {
  const before = process.memoryUsage()
  const t0 = Date.now()
  const r = mod.unpackBaselinePre(payload)
  const after = process.memoryUsage()
  return {
    r,
    ms: Date.now() - t0,
    dAB: (after.arrayBuffers - before.arrayBuffers) / 1048576,
    dRss: (after.rss - before.rss) / 1048576,
  }
}

console.log('[J-0] 真 import 的模块契约')
ok('J-0a unpackBaselinePre / packBaselinePre 是函数', () => {
  assert.equal(typeof unpackBaselinePre, 'function')
  assert.equal(typeof packBaselinePre, 'function')
})
ok('J-0b 编码输入上限常量是有限正数且大于明文上限', () => {
  assert(Number.isFinite(TEAM_BASELINE_MAX_ENCODED_PRE), 'encoded cap 必须是有限数')
  assert(TEAM_BASELINE_MAX_ENCODED_PRE > TEAM_BASELINE_MAX_RAW_BYTES_PRE, 'base64 膨胀后上限必须大于明文上限')
})

// ─────────────────────────────────────────────────────────────
console.log('[J-1] 192MiB 高压缩比包：必须在解压阶段被截停，且峰值有界')
const BOMB_BYTES = 192 * 1024 * 1024
const bombBody192 = await streamBombBody(BOMB_BYTES)
console.log('  · 明文 ' + BOMB_BYTES + ' 字节 → base64 包体仅 ' + bombBody192.length + ' 字节（压缩比 '
  + (BOMB_BYTES / bombBody192.length).toFixed(0) + ':1）')
const m1 = measureUnpack(M, { v: 1, enc: 'br+base64', checksum: 'deadbeef', body: bombBody192 })
console.log('  · 实测：' + JSON.stringify({ ok: m1.r.ok, reason: String(m1.r.reason).slice(0, 60), ms: m1.ms, dArrayBuffersMiB: +m1.dAB.toFixed(1), dRssMiB: +m1.dRss.toFixed(1) }))
ok('J-1a 抛错/拒绝而不是返回大数组（ok === false）', () => assert.equal(m1.r.ok, false, 'ok=' + m1.r.ok + ' reason=' + m1.r.reason))
ok('J-1b 拒绝原因来自 brotli 输出上限（reason 含 brotli-cap）', () => assert(/brotli-cap/.test(String(m1.r.reason)), 'reason=' + m1.r.reason))
ok('J-1c 没有把超限明文交出去（无 files / 无 inner 大缓冲）', () => {
  assert.equal(m1.r.files, undefined, 'files 不应存在')
  assert.equal(m1.r.inner, undefined, 'inner 不应存在')
})
ok('J-1d 解压路径峰值 ΔarrayBuffers ≤ 96MiB（改前 320.0MiB）', () => {
  assert(m1.dAB <= 96, '实测 ΔarrayBuffers=' + m1.dAB.toFixed(1) + 'MiB')
})

// ─────────────────────────────────────────────────────────────
console.log('[J-2] 刚好超过上限（64MiB + 2MiB）同样在解压阶段被截停')
const overBody = await streamBombBody(TEAM_BASELINE_MAX_RAW_BYTES_PRE + 2 * 1024 * 1024)
const m2 = measureUnpack(M, { v: 1, enc: 'br+base64', checksum: 'deadbeef', body: overBody })
console.log('  · 实测：' + JSON.stringify({ ok: m2.r.ok, reason: String(m2.r.reason).slice(0, 60), dArrayBuffersMiB: +m2.dAB.toFixed(1) }))
ok('J-2a 略超上限仍被拒', () => assert.equal(m2.r.ok, false, 'reason=' + m2.r.reason))
ok('J-2b 略超上限也走 brotli-cap 通道', () => assert(/brotli-cap/.test(String(m2.r.reason)), 'reason=' + m2.r.reason))

// ─────────────────────────────────────────────────────────────
console.log('[J-3] 正常包：修复没有误伤合法基线')
const EV = JSON.stringify({ events: [{ id: 'evt_aaaaaaaa', name: 'A' }] })
const baseFiles = { 'event-store.json': EV, 'PLAN.md': '# 白板\n内容', 'MEMORY.project.md': '# 项目\n笔记' }
const packed = packBaselinePre({ files: baseFiles, by: { id: 'u1', name: '阿三' }, at: 1700000000000 })
ok('J-3a 正常包 pack 成功', () => {
  assert.equal(packed.ok, true, 'reason=' + packed.reason)
})
ok('J-3b 正常包 unpack 成功且文件逐字节一致', () => {
  const u = unpackBaselinePre(packed.payload)
  assert.equal(u.ok, true, 'reason=' + u.reason)
  for (const k of Object.keys(baseFiles)) assert.equal(u.files[k], baseFiles[k], 'mismatch: ' + k)
})

// ─────────────────────────────────────────────────────────────
console.log('[J-4] 接近上限的**合法**包（48MiB 明文，低于 64MiB 线）必须仍能解包')
const BIG_FILLER = 'A'.repeat(48 * 1024 * 1024)
const bigFiles = { 'event-store.json': JSON.stringify({ events: [], filler: BIG_FILLER }) }
const bigPacked = packBaselinePre({ files: bigFiles, at: 1700000000000 })
ok('J-4a 48MiB 合法包 pack 成功', () => assert.equal(bigPacked.ok, true, 'reason=' + bigPacked.reason))
ok('J-4b 48MiB 合法包 unpack 成功（闸门不误杀）', () => {
  const u = unpackBaselinePre(bigPacked.payload)
  assert.equal(u.ok, true, 'reason=' + u.reason)
  assert.equal(u.files['event-store.json'].length, bigFiles['event-store.json'].length)
})

// ─────────────────────────────────────────────────────────────
console.log('[J-5] 编码输入闸门：超长 base64 体在**解码之前**就被拒')
{
  const oversizeBody = 'A'.repeat(TEAM_BASELINE_MAX_ENCODED_PRE + 1)
  const r = unpackBaselinePre({ v: 1, enc: 'br+base64', checksum: 'deadbeef', body: oversizeBody })
  ok('J-5a 超长包体被拒且原因以 body-too-large 开头', () => {
    assert.equal(r.ok, false)
    assert(/^body-too-large/.test(String(r.reason)), 'reason=' + r.reason)
  })
  ok('J-5b 拒绝发生在 base64/brotli 之前（不是 decode 失败）', () => {
    assert(!/base64-decode-failed|brotli-decode-failed/.test(String(r.reason)), 'reason=' + r.reason)
  })
}

// ─────────────────────────────────────────────────────────────
console.log('[MUT-488] 变异负路径：删掉 maxOutputLength ⇒ J-1 的两条判据必须变红')
await okAsync('MUT-488a 锚串恰好命中 1 次（否则变异无鉴别力）', () => {
  const src = readFileSync(MOD_PATH, 'utf8')
  const anchor = 'inner = zlib.brotliDecompressSync(buf, { maxOutputLength: TEAM_BASELINE_MAX_RAW_BYTES_PRE })'
  const hits = src.split(anchor).length - 1
  assert.equal(hits, 1, '锚串命中 ' + hits + ' 次（应为 1）')
})
{
  const src = readFileSync(MOD_PATH, 'utf8')
  const anchor = 'inner = zlib.brotliDecompressSync(buf, { maxOutputLength: TEAM_BASELINE_MAX_RAW_BYTES_PRE })'
  const mutated = src.replace(anchor, 'inner = zlib.brotliDecompressSync(buf)')
  const tmpDir = path.join(ROOT, '.tmp-smoke-run')
  try { mkdirSync(tmpDir, { recursive: true }) } catch (_) {}
  const tmpFile = path.join(tmpDir, '_mut-issue488-' + process.pid + '.mjs')
  writeFileSync(tmpFile, mutated, 'utf8')
  try {
    const MM = await import(pathToFileURL(tmpFile).href + '?t=' + Date.now())
    const mm = measureUnpack(MM, { v: 1, enc: 'br+base64', checksum: 'deadbeef', body: bombBody192 })
    console.log('  · 变异体实测：' + JSON.stringify({ ok: mm.r.ok, reason: String(mm.r.reason).slice(0, 60), dArrayBuffersMiB: +mm.dAB.toFixed(1), dRssMiB: +mm.dRss.toFixed(1) }))
    ok('MUT-488b 变异体不再走 brotli-cap 通道（证明 J-1b 有鉴别力）', () => {
      assert(!/brotli-cap/.test(String(mm.r.reason)), '仍含 brotli-cap，说明变异没生效：' + mm.r.reason)
    })
    ok('MUT-488c 变异体峰值 ΔarrayBuffers 明显超过 96MiB 上限（证明 J-1d 有鉴别力）', () => {
      assert(mm.dAB > 96, '实测 ΔarrayBuffers=' + mm.dAB.toFixed(1) + 'MiB（应 > 96，改后实测 320.0MiB）')
    })
  } finally {
    try { unlinkSync(tmpFile) } catch (_) {}
  }
}

console.log('\nPASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
