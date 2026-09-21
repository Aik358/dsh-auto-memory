#!/usr/bin/env node
/**
 * smoke-test-batch3-20260919-pre.mjs —— 第三批上游 issue 修复套件（#66 BOM 坐标系）
 *
 * #66 机制（已实测复现，见 artifacts/_probe-66-fix.mjs）：
 *   `parseAnchors` 的 `byteStart/byteEnd/recordDigest` 相对**剥掉 BOM 之后**的内容
 *   （契约：smoke-test-m3b1-pre.mjs:195 C18 断言 `byteStart === 0`），
 *   而 sidecar 的 `fileDigest` 是 `sha256Hex(buf)`（**含 BOM**）。
 *   读侧 `m4-corpus-pre.js` 旧实现直接 `buf.subarray(...)` 用在含 BOM 的原 buffer 上
 *   ⇒ 整体偏 3 字节 ⇒ `recordDigest` 恒不等 ⇒ **该文件全部记录被判 record-stale 丢弃**
 *   ⇒ BOM 文件从语料/召回**静默消失**（写侧渲染错位同理）。
 *   修法：**保留坐标系契约不动**，让消费侧自己剥 BOM 对齐。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseAnchors, buildSidecar } from '../../lib/memory-anchor-pre.js'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = (p) => readFileSync(new URL('../../lib/' + p, import.meta.url), 'utf8')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const isBom = (b) => b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf

const marker = '<!-- memory:mem_' + 'a'.repeat(32) + ' -->'
const bodyText = marker + '\n## 2026-09-19\n- 正文内容一条\n'
const withBom = Buffer.concat([BOM, Buffer.from(bodyText, 'utf8')])
const plain = Buffer.from(bodyText, 'utf8')

console.log('\n[1] 坐标系契约保持不变（M3b1 C18：偏移相对剥 BOM 内容）')
{
  const p = parseAnchors(withBom)
  ok(p.bom === true, 'BOM 输入被标记')
  const rec = p.records.find((r) => r.kind === 'anchored')
  // ★ 注意：`byteStart/byteEnd` 是**内容块**范围（anchored 记录不含 marker 行，故非 0）；
  //   判断坐标系要看的锚点是 `markerByteStart`（= 0 表示相对剥 BOM 内容）。
  ok(rec.markerByteStart === 0, '★★ markerByteStart 相对剥 BOM 内容（契约未改，守住 C18）', String(rec.markerByteStart))
  // C18 原样复现：legacy 文件（无 marker）的 records[0].byteStart === 0
  const legacy = Buffer.concat([BOM, Buffer.from('## 2026-08-22\n- a\n')])
  const lp = parseAnchors(legacy)
  ok(lp.records[0].byteStart === 0, '★★ C18 逐字复现：BOM 下 records[0].byteStart === 0', String(lp.records[0].byteStart))
  // 反向锁：不得为了修 #66 而把坐标系改成含 BOM（那会打破 M3b1 C18）
  const s = src('memory-anchor-pre.js')
  ok(!/start: l\.start \+ bomLen/.test(s), '★★ 未把 parseAnchors 偏移改成含 BOM 坐标系（守住既有契约）')
}

console.log('\n[2] 读侧 m4-corpus 必须自己剥 BOM 对齐')
{
  const s = src('m4-corpus-pre.js')
  ok(/const body = \(buf\.length >= 3 && buf\[0\] === 0xef/.test(s),
    '★★ 读侧显式检测并剥掉 BOM（body）')
  ok(/sha256Hex\(body\.subarray\(r\.byteStart, r\.byteEnd\)\)/.test(s),
    '★★ recordDigest 用剥 BOM 后的 body 回算（不再是裸 buf）')
  ok(/r\.byteEnd > body\.length/.test(s), '★ 边界校验同样基于 body.length')
  // 反向锁：不得再有「裸 buf.subarray 配 recordDigest」
  ok(!/sha256Hex\(buf\.subarray\(r\.byteStart, r\.byteEnd\)\)/.test(s),
    '★★ 旧写法（裸 buf 切片）已不存在')

  // 行为验证：BOM 文件读侧不再 record-stale
  const p = parseAnchors(withBom)
  const rec = p.records.find((r) => r.kind === 'anchored')
  const body = isBom(withBom) ? withBom.subarray(3) : withBom
  ok(sha(body.subarray(rec.byteStart, rec.byteEnd)) === rec.recordDigest,
    '★★ 剥 BOM 后回算 digest === recordDigest（BOM 文件不再丢）')
  ok(sha(withBom.subarray(rec.byteStart, rec.byteEnd)) !== rec.recordDigest,
    '★ 反证：不剥 BOM 必然失配（复现 #66 机制）')
}

console.log('\n[3] sidecar 两套 digest 分工明确且各自正确')
{
  const r = buildSidecar({ sourceFile: 'MEMORY.md', content: withBom, now: () => 1000 })
  ok(r.ok === true, 'buildSidecar 成功')
  ok(r.sidecar.fileDigest === sha(withBom), '★ fileDigest = 含 BOM 全 buffer（防篡改/变更检测）')
  const rec = r.sidecar.records[0]
  const body = isBom(withBom) ? withBom.subarray(3) : withBom
  ok(sha(body.subarray(rec.byteStart, rec.byteEnd)) === rec.recordDigest,
    '★★ recordDigest 用剥 BOM 回算一致')
}

console.log('\n[4] 无 BOM 文件零行为变化（回归保护）')
{
  ok(isBom(plain) === false, '夹具本身无 BOM')
  // ★ 用**纯 legacy** 夹具才能断言 records[0].byteStart === 0（anchored 记录的 byteStart 是内容块起点，非 0）
  const legacyPlain = Buffer.from('## 2026-09-19\n- 正文内容一条\n', 'utf8')
  const p = parseAnchors(legacyPlain)
  ok(p.records[0].kind === 'legacy', '夹具产出 legacy 记录')
  ok(p.records[0].byteStart === 0, '★ 无 BOM 时 records[0].byteStart 仍为 0', String(p.records[0].byteStart))
  ok(sha(legacyPlain.subarray(p.records[0].byteStart, p.records[0].byteEnd)) === p.records[0].recordDigest,
    '★ 无 BOM 时 digest 一致（剥 BOM 分支不触发）')
  // 读侧对齐写法对无 BOM 输入必须等价（body === buf）
  const s = src('m4-corpus-pre.js')
  const bodyLine = s.split('\n').find((l) => l.includes('const body =')) || ''
  ok(/: buf/.test(bodyLine), '★ 无 BOM 分支回退为原 buffer（零行为变化）', bodyLine.trim().slice(0, 90))
}

console.log('\n[5] 全仓 BOM 对齐假设与坐标系自洽')
{
  // `storage-manage-pre.js` 的 `+bomLen` 对齐**是正确的**（坐标系确实相对剥 BOM 内容）——不得反向断言，
  //   而应断言它**仍然存在且与坐标系一致**（防止有人误删）。
  const sm = src('storage-manage-pre.js')
  ok(/const bomLen = parsed\.bom \? 3 : 0/.test(sm), '★ storage-manage 保留 BOM 长度判断')
  ok(/const body = bomLen \? buf\.subarray\(bomLen\) : buf/.test(sm),
    '★★ storage-manage 仍按「剥 BOM」对齐（与 parseAnchors 坐标系一致，不得误删）')
  // 写侧 memory-writer 的 insertMarkers 用 atByte 直切 —— 坐标系一致性由 parseAnchors 保证；
  //   此处只锁「不再有依赖相反假设的注释」（该注释已于本轮修正）。
  const mw = src('memory-writer-pre.js')
  ok(!/去掉 BOM 之后.*切除前先对齐/.test(mw), '★ memory-writer 无相反的 BOM 假设注释')
}

console.log(`\n[batch3-20260919] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
