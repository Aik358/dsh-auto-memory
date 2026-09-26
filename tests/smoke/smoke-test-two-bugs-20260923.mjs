/**
 * 守卫：两个用户报告缺陷的回归（2026-09-23）。
 *
 * Bug#2 锚点空格被吃掉：
 *   `sanitizeReservedSyntax` 曾无差别把 `<!-- memory:` 改写成 `<!--memory:`，
 *   连**锚点行本体**一起改 ⇒ `memory-anchor.js` 的严格 MARKER_RE（写死空格）认不出
 *   ⇒ parseAnchors 把整篇降级成 legacy 块 ⇒ 白板卡片识别失败。
 *   守：① 锚点行必须原样保留（行为级，真调函数）
 *       ② 正文里的字面串仍须改写（防 orphan-content 的原意不能被破坏）
 *       ③ 两处读取端口径必须一致（严格 MARKER_RE 与宽松锚点正则不能分叉）
 *
 * Bug#1 水位卡整张消失：
 *   前端渲染门曾是 `wl.window > 0` ⇒ 未测出窗口时卡片根本不渲染，
 *   连「尚未测量」提示都不可达 ⇒ 用户只看到"没有水位"而无解释。
 *   守：① 渲染门不得只认 window>0
 *       ② 新文案键 zh/en 各定义一次（避免显示裸键）
 *       ③ 未测出窗口时仍给出可操作指引
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAnchors, MARKER_RE } from '../../lib/memory-anchor.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const IDX = read('lib/index.js')
const CLI = read('lib/client.js')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg) } }

console.log('[carry/water] 两缺陷回归守卫\n')

// ── Bug#2 行为级：真调修复后的函数 ──────────────────────────────────────────
const fnSrc = IDX.match(/const ANCHOR_LINE_SAFE_RE = [^\n]+\r?\nfunction sanitizeReservedSyntax\(text\) \{[\s\S]*?\r?\n\}/)
ok(!!fnSrc, 'B2-1 sanitizeReservedSyntax 可定位（结构未变）')
if (fnSrc) {
  // 在隔离作用域里求值该函数（只用纯字符串逻辑，无外部依赖）
  const factory = new Function(fnSrc[0].replace('const ANCHOR_LINE_SAFE_RE', 'var ANCHOR_LINE_SAFE_RE') + '; return sanitizeReservedSyntax')
  const sanitize = factory()
  const id = 'mem_' + 'a'.repeat(32)
  const anchor = '<!-- memory:' + id + ' -->'
  ok(sanitize(anchor) === anchor, 'B2-2 锚点行原样保留（治本：不再被改写）')
  const inline = '文档示例: <!-- memory:demo -->'
  ok(sanitize(inline) === '文档示例: <!--memory:demo -->', 'B2-3 正文里的字面串仍被改写（保留防 orphan-content 原意）')
  const multi = '### 卡片\n' + anchor + '\n正文 <!-- memory:demo -->'
  const outMulti = sanitize(multi)
  ok(outMulti.includes(anchor), 'B2-4 多行混合：锚点行存活')
  ok(outMulti.includes('<!--memory:demo -->'), 'B2-5 多行混合：正文串仍改写')

  // 端到端：改写后的文本喂给真解析器，锚点条目必须还在
  const parsed = parseAnchors(outMulti)
  const anchored = (parsed.records || []).filter((r) => r.memoryId)
  ok(anchored.length === 1 && anchored[0].memoryId === id, 'B2-6 端到端：解析出 1 个锚点条目（修复前为 0）')
}

// ── Bug#2 结构级：两端口径一致 ──────────────────────────────────────────────
// ★判据要分清：**函数级无差别替换**必须消失；但逐行的 replace 必须保留（非锚点行仍要改写）。
//   上一版断言把两者混为一谈，恒假 —— 是守卫写错，不是代码问题。
const codeLines = IDX.split(/\r?\n/).filter((l) => {
  const t = l.trim()
  return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
})
ok(!codeLines.some((l) => l.includes("return String(text || '').replace(/<!-- memory:/g")),
  'B2-7 函数级无差别替换已移除（逐行的 replace 保留，用于改写非锚点行）')
ok(codeLines.some((l) => l.includes("return line.replace(/<!-- memory:/g, '<!--memory:')")),
  'B2-7b 非锚点行的改写仍在（原意未丢）')
// 严格 MARKER_RE 不含 \s* 正是"必须做锚点行豁免"的原因；宽松的是白板侧 WB_ANCHOR_LINE_RE。
// 守的是"两者分工不变"：严格端不放松（否则等于把契约放宽），豁免在写入侧做。
ok(String(MARKER_RE) === '/^<!-- memory:(mem_[0-9a-f]{32}) -->$/',
  'B2-8 严格 MARKER_RE 保持拒绝浮动空白（豁免在写入侧，不放宽读取契约）')
ok(MARKER_RE.test('<!-- memory:mem_' + 'a'.repeat(32) + ' -->') && !MARKER_RE.test('<!--memory:mem_' + 'a'.repeat(32) + ' -->'),
  'B2-8b MARKER_RE 认标准形态、拒紧凑形态（差集正是本缺陷的致因）')
ok(/export const WB_ANCHOR_LINE_RE_PRE_V1 = \/\^<!--\\s\*memory:\(mem_\[0-9a-f\]\{32\}\)\\s\*-->\$\//.test(read('lib/wb-sidecar.js')),
  'B2-8c 白板侧锚点正则仍容浮动空白（两端口径分工：读取严格端 + 渲染宽松端）')
ok(/ANCHOR_LINE_SAFE_RE\s*=\s*\/\^<!--\\s\*memory:\(mem_\[0-9a-f\]\{32\}\)\\s\*-->\$\//.test(IDX),
  'B2-9 豁免判据用与 WB 锚点同形的正则（含 \\s*，与白板端口径一致）')

// ── Bug#1 结构级 ────────────────────────────────────────────────────────────
ok(!/if \(wl\.window > 0\) \{/.test(CLI), 'B1-1 旧渲染门 `wl.window > 0` 已不存在')
ok(/if \(wl && \(wl\.window > 0 \|\| wl\.at \|\| Object\.keys\(wl\)\.length\)\) \{/.test(CLI),
  'B1-2 新渲染门：有对象即渲染（未测出窗口也显示）')
ok(/var hasWin = \(wl\.window \|\| 0\) > 0/.test(CLI), 'B1-3 hasWin 判据存在')
// ⚠️ 2026-09-26（水位 v4）判据演进：进度条仍是 `hasWin ? ... : null` 门控（**不变量本体未变**：
//   无窗口时绝不画进度条、不显示假 0%）。变的是条内结构 —— 现改为「位置容器 + 已用填充 + 插件阈值
//   刻度 + 官方阈值实带」多层，首行由 `h('div', { style: { height: '6px'` 变为带 `data-dam-water-bar`
//   与 `position: 'relative'` 的容器。故判据改写为「存在 data-dam-water-bar 容器，且它仍由 hasWin 门控」，
//   既守住原事故不变量，又不锁死条内实现细节。
ok(/data-dam-water-bar/.test(CLI) && /hasWin \? h\('div', \{ 'data-dam-water-bar': ''/.test(CLI),
  'B1-4 无窗口时不画进度条（不显示假 0%）—— 进度条仍由 hasWin 门控')
ok(/data-dam-official-band/.test(CLI) && /hasOff \? h\('div', \{ 'data-dam-official-band'/.test(CLI),
  'B1-4b 官方压缩阈值实带：仅在测出窗口且 officialRatio>0 时绘制（不得显示假官方线）')
ok(/t\('waterWindowUnknown'\)/.test(CLI) && /t\('waterWindowUnknownHint'\)/.test(CLI), 'B1-5 未测出窗口时给出说明与指引')
for (const k of ['waterWindowUnknown', 'waterWindowUnknownHint']) {
  const n = (CLI.match(new RegExp('\\b' + k + ':', 'g')) || []).length
  ok(n === 2, 'B1-6 文案键 ' + k + ' zh/en 各定义一次（实际 ' + n + '）')
}
// 不可达提示：旧代码把「尚未测量」关在 window>0 门内 ⇒ 结构性恒不可达场景已被移除
ok(!/if \(wl\.window > 0\) \{[\s\S]{0,900}?waterNotMeasured/.test(CLI), 'B1-7 「尚未测量」提示不再被 window>0 门遮蔽')

console.log('\n[carry/water] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
