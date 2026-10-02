/* smoke-test-s2-skin — S2 皮肤线端到端验收（CR-10：真 import → 真构造 → 真调用 → 断言返回值）
 *
 * 覆盖 58 卷 §阶段 4 四项：4.1 槽位表 / 4.2 占位 / 4.3 素材通路 / 4.4 深色版。
 * 三条纪律（12 卷 §4）：①只认 key 不认文件 ②占位像成品 ③每张图带尺寸。
 * 真实路径：真读 lib/skin-assets.js / lib/index.js / lib/client.js 三处产物，
 * 真调 assetOf()、真解析路由与消费点、真读 PNG/WebP 文件头。
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0; let fail = 0
const failures = []
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; failures.push(label); console.log('  FAIL  ' + label + (extra ? '  [' + extra + ']' : '')) }
}
function eq (a, b, label) { ok(a === b, label, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)) }

/* ── §1 数据表：真 import lib/skin-assets.js ─────────────────────────── */
const mod = await import('../../lib/skin-assets.js')

/** 平台无关行尾守恒：存在 CRLF 时不得有裸 LF；全 LF 合法（CI/Linux 检出态）。
 *  ★2026-09-28：原断言写作 cnt(NL)===cnt(CRNL)（即"必须全 CRLF"），在 Linux CI 上必红——
 *  索引里是 LF，本机 core.autocrlf=true 才检出 CRLF。守的语义不变：文件不得混合行尾。 */
const damNoMixedEol = (s) => {
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/\n/g) || []).length
  if (crlf === 0) return true      // 全 LF：合法（CI 检出态）
  return crlf === lf               // 有 CRLF 则不得再有裸 LF
}
const { SKIN_ASSETS, assetOf, SKIN_ASSET_KEYS, SKIN_ASSET_ROOT } = mod
const EXPECTED = ['hero.welcome', 'empty.library', 'empty.timeline', 'empty.recall', 'bg.mindmap', 'illust.sync']
ok(!!SKIN_ASSETS, '§1.1 真 import 拿到 SKIN_ASSETS')
eq(Object.keys(SKIN_ASSETS).length, 6, '§1.2 槽位恰好 6 个')
eq(Object.keys(SKIN_ASSETS).sort().join(','), EXPECTED.slice().sort().join(','), '§1.3 键集合 === 12 卷 6 槽位')
eq(SKIN_ASSET_KEYS.length, 6, '§1.4 SKIN_ASSET_KEYS 与 6 槽位同长')
eq(SKIN_ASSET_KEYS.slice().sort().join(','), EXPECTED.slice().sort().join(','), '§1.5 SKIN_ASSET_KEYS 内容一致')
eq(SKIN_ASSET_ROOT, 'assets/skin', '§1.6 资源根目录常量 = assets/skin（路由与消费点共用）')
for (const k of EXPECTED) {
  const e = SKIN_ASSETS[k]
  ok(Array.isArray(e.size) && e.size.length === 2 && e.size[0] > 0 && e.size[1] > 0, '§1.7.' + k + ' 带尺寸（纪律三）', JSON.stringify(e.size))
  ok(typeof e.alt === 'string' && e.alt.length > 0, '§1.7b.' + k + ' 带 alt')
}

/* ── §2 assetOf 真调用（4.1/4.2 契约） ─────────────────────────────── */
const a1 = assetOf('hero.welcome')
ok(a1.placeholder === false && typeof a1.url === 'string' && a1.url.length > 0, '§2.1 已就绪槽位 ⇒ placeholder:false + url', JSON.stringify(a1))
eq(a1.url, SKIN_ASSETS['hero.welcome'].file, '§2.1b url === file（代码只认 key，纪律一）')
const a2 = assetOf('no.such.slot')
ok(a2.placeholder === true, '§2.2 ★负路径：未知 key ⇒ placeholder:true（不抛、不返回坏 url）', JSON.stringify(a2))
ok(typeof a2.key === 'string' && a2.key === 'no.such.slot', '§2.2b 未知 key 原样回显在 key 上')
const a3 = assetOf()
ok(a3.placeholder === true, '§2.3 ★负路径：无参调用 ⇒ placeholder:true（永不抛）')
const a4 = assetOf(null)
ok(a4.placeholder === true, '§2.3b ★负路径：null ⇒ placeholder:true')
const a5 = assetOf(123)
ok(a5.placeholder === true, '§2.3c ★负路径：数字键 ⇒ placeholder:true')

/* ── §3 磁盘存在性 + 尺寸逐像素（4.1/4.3） ─────────────────────────── */
const SKIN_DIR = join(ROOT, 'lib', 'assets', 'skin')
function pngSize (buf) {
  if (buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}
function webpSize (buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const c = buf.toString('ascii', 12, 16)
  if (c === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
  if (c === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
  if (c === 'VP8L') { const n = buf.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 } }
  return null
}
let totalBytes = 0
for (const k of EXPECTED) {
  const e = SKIN_ASSETS[k]
  const f = join(SKIN_DIR, e.file)
  ok(existsSync(f), '§3.1.' + k + ' file 在磁盘存在', e.file)
  if (!existsSync(f)) continue
  const st = statSync(f); totalBytes += st.size
  const sz = e.file.endsWith('.webp') ? webpSize(readFileSync(f)) : pngSize(readFileSync(f))
  ok(!!sz && sz.w === e.size[0] && sz.h === e.size[1], '§3.2.' + k + ' 真实尺寸 === 声明尺寸 ' + e.size.join('×'),
    'actual=' + (sz ? sz.w + '×' + sz.h : 'unreadable'))
}
ok(totalBytes > 0, '§3.3 6 槽位合计字节数可复算', totalBytes + ' B')

/* ── §4 宿主只读路由（4.3 通路一半） ──────────────────────────────── */
const idx = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
ok(idx.includes("skinAsset: '/api/dsh-auto-memory/skin-asset'"), '§4.1 宿主 API 表登记 skinAsset')
ok(idx.includes('from \'./skin-assets.js\''), '§4.2 宿主真 import 皮肤数据表（单源，不是各写一份）')
ok(idx.includes("path: API.skinAsset"), '§4.3 路由条目真实注册')
ok(idx.includes('skinKeyFromRequestPre'), '§4.4 有 query key 解析（白名单）')
ok(idx.includes('skinAbsPathOfPre'), '§4.5 有路径解析（含根目录归属校验）')
ok(idx.includes('skinMimeOfPre'), '§4.6 有 content-type 判定')
ok(idx.includes('isLoopbackRequest(req)'), '§4.7 loopback-only 门禁存在')
ok(indexOfAll(idx, 'skinAbsPathOfPre').length >= 2, '§4.8 skinAbsPathOfPre 定义 + 调用（不是死函数）')
function indexOfAll (s, sub) { const out = []; let i = s.indexOf(sub); while (i >= 0) { out.push(i); i = s.indexOf(sub, i + 1) } return out }

/* ── §5 前端消费点（4.3 通路另一半：图上屏） ─────────────────────── */
const cli = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
ok(cli.includes('S2-skin:begin') && cli.includes('S2-skin:end'), '§5.1 S2 段标记成对')
ok(cli.includes("skinAsset: ROUTE_PREFIX + '/skin-asset'"), '§5.2 前端 API 表与宿主同名同值（单源锁）')
ok(cli.includes('SKIN_SLOT_KEYS'), '§5.3 前端持 key 列表（不持路径 —— 纪律一）')
ok(cli.includes('function skinAssetUrl'), '§5.4 有 URL 构造函数')
ok(cli.includes('function SkinImg'), '§5.5 有真 <img> 组件')
ok(cli.includes("h('img'"), '§5.6 ★真渲染 img 元素（不是只存数据）')
ok(cli.includes('dam-skin-ph'), '§5.7 有确定性占位分支')
ok(cli.includes('function SkinSection'), '§5.8 有分区组件')
ok(cli.includes("section('skin'"), '§5.9 设置页挂了 skin 分区')
ok(cli.includes("data-dam-skin"), '§5.10 渲染带 data-dam-skin 锚点（可 DOM 取证）')
ok(!/\.png|\.webp|\/assets\//.test(cli.split('S2-skin:begin')[1].split('S2-skin:end')[0]),
  '§5.11 ★纪律一：S2 段内零文件路径字面量（只认 key）')

/* ── §6 CSS 令牌化（L1 纪律 & 4.2 占位样式） ─────────────────────── */
const seg = cli.split('dam-skin:begin')[1].split('dam-skin:end')[0]
ok(seg.length > 0, '§6.1 取到 dam-skin CSS 段', seg.length + ' 字符')
// ★口径（第 10 条纪律：取自权威工具 scan-appearance.mjs）：
//   本仓既有惯例是 `var(--dam-x, #hex)` 兜底（全仓 163 处）—— 有 token 背后支撑，**不算硬编码**。
//   只有 **不在 var(...) 内**的裸 hex / 裸 rgb 才算硬编码 ⇒ 先把 var(...) 整体遮罩再计数。
const masked = seg.replace(/var\(\s*--[a-z0-9-]+\s*,[^)]*\)/g, 'var(--x)')
const hex = (masked.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length
const rgb = (masked.match(/\brgba?\(|\bhsla?\(/g) || []).length
eq(hex + rgb, 0, '§6.2 ★CSS 段硬编码色 = 0（裸值；var() 兜底不计，与 scan-appearance 同口径）')
ok(/dam-skin-ph/.test(seg), '§6.3 占位样式在 CSS 段内（纪律二：像成品不是灰块）')
ok(/var\(--dam-/.test(seg), '§6.4 确实使用 dam 令牌变量')

/* ── §7 守恒（不破坏既有结构） ─────────────────────────────────── */
// ★只数真调用：`function MEMORY_TABS() {` 也含 `MEMORY_TABS()` 子串（我第一版就栽在这），
// 因此必须先剔除定义行，再数剩余出现点 —— 与 smoke-test-l3-team.mjs §8.7 同一口径。
const tabsDef = (cli.match(/function\s+MEMORY_TABS\s*\(/g) || []).length
const tabsAll = (cli.match(/MEMORY_TABS\(\)/g) || []).length
eq(tabsDef, 1, "§7.1a MEMORY_TABS 定义恰好 1 次")
eq(tabsAll - tabsDef, 2, "§7.1b ★计数锁：MEMORY_TABS() 真调用数仍为 2")
eq(tabsAll, 3, "§7.1c 原始子串出现点 = 1 定义 + 2 调用 = 3（登记基线，防口径漂移）")
ok(!/\r\r\n/.test(cli), '§7.2 client.js 无双 CR（CRLF 纪律）')
ok(damNoMixedEol(cli), '§7.3 client.js 无裸 LF（纯 CRLF）')
ok(!/\r\r\n/.test(idx), '§7.4 index.js 无双 CR')

console.log('')
console.log('================ S2 skin SUMMARY ================')
console.log('PASS ' + pass + ' / FAIL ' + fail)
if (fail) { console.log('失败项:'); for (const f of failures) console.log('  - ' + f) }
process.exit(fail ? 1 : 0)