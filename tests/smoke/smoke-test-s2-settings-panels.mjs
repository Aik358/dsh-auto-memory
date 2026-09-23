/**
 * S2 永久守卫：设置页「语义环境检测面板 / 安装向导」的**触发点↔渲染点同分区**不变量
 *
 * 背景（真实事故，2026-09-22）：B1 分区重构把两个面板留在 store 分区，而触发它们的
 * 「⟳ 检测」「🧩 安装向导」按钮在 engine 分区。分区导航是**滚动式**（jumpToSection 只
 * scrollIntoView，全部 section(…) 顺序平铺渲染）⇒ 状态正确置位、面板也确实渲染了，但渲染在
 * 当前视口下方 6 个分区处 ⇒ 用户看到「点了毫无反应」，报障为「引导页和检测页弹不出来」。
 *
 * 本守卫钉死的不变量（不是拼写、是结构）：
 *   G1 触发点与渲染点必须落在**同一个 section** 区间内，且该分区 = engine
 *   G2 面板/向导的渲染不得被任何折叠或编辑器开合状态包裹（AnimatedDisclosure / promptEditOpen）
 *   G3 触发链路齐全：⟳ → runDetect → setDetOpen(true)（唯一）+ 检测结果/切模式两条自动弹卡分支
 *   G4 根因前提：分区导航仍是滚动式（平铺渲染全部 section），engine 在 store 之前
 *   G5 反例自检：把面板人为搬回 store 后，G1 判据必须变红（证明守卫不是恒真）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  (got ' + JSON.stringify(a) + ')')
const cnt = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }

const SRC = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

const KEYS = ['engine', 'window', 'capacity', 'skills', 'handoff', 'auto', 'store', 'look', 'about']
const STORE_HEAD = "section('store', sectionLabels.store, ["
const MARK_START = 'M-CM6-B v3·环境检测面板:⟳ 按钮触发'
// ★MARK_START 故意不含行首的 `// ` 与 10 空格缩进（这样 indexOf 抗缩进漂移）；
//   但用它做「行首邻接」判定时必须补回注释标记，否则恒假（本次踩过）。
const MARK_LINE = '// ' + MARK_START
const INSERT_ANCHOR = "]), t('semModeHint')),"

/**
 * 面板块的正面边界（★不可用「store 头前的 fUserDir 行」当终点）：
 * 搬移后 fUserDir 与块首之间隔着 window/capacity/… 若干分区，用后者当终点会把
 * 中间全部内容一起吞进「块」里（2026-09-22 本守卫自身踩过这个坑：块被算成 226 行）。
 * 正确终点 = 块尾部「安装引导卡」IIFE 的收尾 `t('gotIt')` → `: null,` 行末。
 */
function blockSpan(src) {
  const start = src.indexOf(MARK_START)
  if (start < 0) return null
  const startLine = src.lastIndexOf('\n', start) + 1
  const gotIt = src.indexOf("t('gotIt'))))", start)
  if (gotIt < 0) return null
  const nullAt = src.indexOf(': null,', gotIt)
  if (nullAt < 0) return null
  const nl = src.indexOf('\n', nullAt)
  return { startLine, end: nl < 0 ? src.length : nl + 1, block: src.slice(startLine, nl < 0 ? src.length : nl + 1) }
}

/** 各设置分区的源码区间：分区头 → 下一个分区头 */
function sectionBounds(src) {
  const heads = []
  for (const k of KEYS) {
    const i = src.indexOf("section('" + k + "', sectionLabels." + k + ', [')
    if (i >= 0) heads.push({ key: k, at: i })
  }
  heads.sort((a, b) => a.at - b.at)
  const out = []
  for (let i = 0; i < heads.length; i++) out.push({ key: heads[i].key, from: heads[i].at, to: i + 1 < heads.length ? heads[i + 1].at : src.length })
  return out
}
function sectionOf(bounds, idx) {
  for (const b of bounds) if (idx >= b.from && idx < b.to) return b.key
  return null
}
const afterLine = (s, i) => { const n = s.indexOf('\n', i); return n < 0 ? s.length : n + 1 }
/** 取「包含 i 的那一行」的下一行文本（去 CRLF 行尾 + 去缩进）——邻接判定专用 */
function nextLineText(s, i) {
  const p = afterLine(s, i)
  const n = s.indexOf('\n', p)
  return s.slice(p, n < 0 ? s.length : n).replace(/\r$/, '').trim()
}
/** 三对「触发点 → 渲染点」 */
const PAIRS = [
  ['⟳ 检测 按钮 → 检测面板', "'⟳ 检测'", 'data-dam-detect-panel'],
  ['🧩 安装向导 按钮 → Python 向导', "'🧩 安装向导'", 'h(PySetupWizard)'],
  ['🧩 安装向导 按钮 → JS/Python 安装引导卡', "'🧩 安装向导'", "guide === 'js' || guide === 'python'"],
]
/** 返回违规列表（空数组 = 全部同区） */
function coLocationViolations(src) {
  const bounds = sectionBounds(src)
  const bad = []
  for (const [label, trig, rend] of PAIRS) {
    const ti = src.indexOf(trig)
    const ri = src.indexOf(rend)
    if (ti < 0 || ri < 0) { bad.push(label + '（标记缺失: trig=' + ti + ' rend=' + ri + '）'); continue }
    const ts = sectionOf(bounds, ti), rs = sectionOf(bounds, ri)
    if (ts !== rs) bad.push(label + '（触发在 ' + ts + '，渲染在 ' + rs + '）')
    else if (rs !== 'engine') bad.push(label + '（同区但不在 engine，实为 ' + rs + '）')
  }
  return bad
}

console.log('[G1] 触发点 ↔ 渲染点 同分区（核心不变量）')
{
  const bounds = sectionBounds(SRC)
  eq(bounds.map((b) => b.key).join(','), 'engine,window,capacity,skills,handoff,auto,store,look,about', 'G1a 九个分区头齐备且顺序不变')
  const bad = coLocationViolations(SRC)
  ok(bad.length === 0, 'G1b 三对触发↔渲染全部同区且落在 engine' + (bad.length ? ' ⇒ ' + JSON.stringify(bad) : ''))
  const detSec = sectionOf(bounds, SRC.indexOf('data-dam-detect-panel'))
  eq(detSec, 'engine', 'G1c 检测面板归属 engine')
  eq(sectionOf(bounds, SRC.indexOf('h(PySetupWizard)')), 'engine', 'G1d Python 向导归属 engine')
  eq(sectionOf(bounds, SRC.indexOf("guide === 'js' || guide === 'python'")), 'engine', 'G1e 安装引导卡归属 engine')
}

console.log('[G2] 渲染路径不被折叠/编辑器开合包裹')
{
  const span = blockSpan(SRC)
  ok(!!span, 'G2a 面板块边界可解（正面终点锚）')
  const block = span ? span.block : ''
  const blkLines = cnt(block, '\n')
  ok(blkLines >= 100 && blkLines <= 130, 'G2a2 块行数在 100~130（实得 ' + blkLines + '，禁止用 store 邻接当终点导致过捕获）')
  ok(!block.includes('AnimatedDisclosure'), 'G2b 面板块内无 AnimatedDisclosure（不被折叠包裹）')
  ok(!block.includes('promptEditOpen'), 'G2c 面板块不依赖「编辑 prompt 层」编辑器开合')
  ok(block.includes('detOpen ? (function () {'), 'G2d 面板开合只由 detOpen 单一状态决定')
  eq(cnt(SRC, 'data-dam-detect-panel'), 1, 'G2e 检测面板容器全仓唯一（无重复挂载）')
  ok(cnt(block, "guide === 'python' ? h(PySetupWizard) : null") === 1, 'G2f Python 向导挂载点在块内唯一')
  ok(!block.includes("section('"), 'G2g 块内不含任何 section 头（未把别的分区吞进来）')
}

console.log('[G3] 触发链路齐全')
{
  eq(cnt(SRC, 'setDetOpen(true)'), 1, 'G3a setDetOpen(true) 全仓唯一（唯一入口 = runDetect）')
  const runDetectAt = SRC.indexOf('function runDetect()')
  const openAt = SRC.indexOf('setDetOpen(true)')
  ok(runDetectAt > 0 && openAt > runDetectAt, 'G3b setDetOpen(true) 位于 runDetect 内')
  ok(SRC.indexOf("onClick: function () { void runDetect() }") > 0, 'G3c ⟳ 按钮 onClose→runDetect 绑定存在')
  // 两条自动弹卡：检测结果驱动 + 切模式后资产未就绪驱动
  ok(/rec === 'setup-python'[\s\S]{0,80}setGuide\('python'\)/.test(SRC), 'G3d 检测结果 → 自动弹 Python 向导')
  ok(/(download-model|install-peer|setup-both)[\s\S]{0,120}setGuide\('js'\)/.test(SRC), 'G3e 检测结果 → 自动弹 JS 引导')
  ok(/s2\.ready === false\) setGuide\('js'\)/.test(SRC), 'G3f 切 JS 模式且资产未就绪 → 自动弹引导')
  ok(/s2\.pythonInt8Present === false\) setGuide\('python'\)/.test(SRC), 'G3g 切 Python 模式且资产未就绪 → 自动弹向导')
  ok(cnt(SRC, "setGuide(guide ? '' : ((cfg.semanticEngineMode === 'python') ? 'python' : 'js'))") === 1, 'G3h 🧩 常驻入口可开可收（不受资产状态 gate）')
}

console.log('[G4] 根因前提：导航为滚动式 + 块的物理位置')
{
  ok(SRC.includes("'data-dam-settings-content': ''"), 'G4a 设置内容容器存在')
  ok(SRC.includes("h('nav', { 'data-dam-settings-nav'"), 'G4b 分区导航存在')
  ok(SRC.includes("el.scrollIntoView({ behavior: 'smooth', block: 'start' })"), 'G4c 导航为 scrollIntoView（滚动式，非分页）')
  // 平铺渲染：engine 头之后仍能看到 window / capacity 头（说明不是按需渲染单分区）
  const engAt = SRC.indexOf("section('engine', sectionLabels.engine, [")
  ok(SRC.indexOf("section('window', sectionLabels.window, [") > engAt, 'G4d 分区平铺渲染（engine 之后仍渲染 window）')
  // 块的物理位置：紧贴 semMode 行之后，且仍在 store 头之前
  const insLine = cnt(SRC.slice(0, SRC.indexOf(INSERT_ANCHOR)), '\n')
  const blkLine = cnt(SRC.slice(0, SRC.indexOf(MARK_START)), '\n')
  eq(blkLine - insLine, 1, 'G4e 面板块紧贴 semMode 行之后（行号差 = 1）')
  ok(SRC.indexOf(MARK_START) < SRC.indexOf(STORE_HEAD), 'G4f 面板块物理位置在 store 分区头之前')
  eq(cnt(SRC, STORE_HEAD), 1, 'G4g store 分区头唯一')
  // store 分区内不得再出现面板/向导（防再次异地）
  const bounds = sectionBounds(SRC)
  const store = bounds.find((b) => b.key === 'store')
  const storeBody = SRC.slice(store.from, store.to)
  ok(!storeBody.includes('data-dam-detect-panel'), 'G4h store 分区内不再有检测面板')
  ok(!storeBody.includes('PySetupWizard'), 'G4i store 分区内不再有 Python 向导')
}

console.log('[G5] 反例自检：把面板搬回 store 后 G1 必须变红（守卫非恒真）')
{
  const span = blockSpan(SRC)
  const eng = sectionBounds(SRC).find((b) => b.key === 'engine')
  const block = span.block
  const rest = SRC.slice(0, span.startLine) + SRC.slice(span.end)
  const afterStoreHead = rest.indexOf('\n', rest.indexOf(STORE_HEAD)) + 1
  const badSrc = rest.slice(0, afterStoreHead) + block + rest.slice(afterStoreHead)
  ok(badSrc.length === SRC.length, 'G5a 反例构造是纯移动（长度守恒）')
  const bad = coLocationViolations(badSrc)
  ok(bad.length === PAIRS.length, 'G5b 反例下三对全部报违规（实得 ' + bad.length + '/' + PAIRS.length + '）')
  ok(sectionOf(sectionBounds(badSrc), badSrc.indexOf('data-dam-detect-panel')) === 'store', 'G5c 反例下面板确实落在 store')
  // ★邻接判定必须「取下一行文本再 trim 后比较」：
  //   ① 别用「锚 + CRLF + 缩进片段」的 includes 近似 —— 删除块后 engine 下一个元素同样 10 空格缩进 ⇒ 恒真；
  //   ② 别用 startsWith(锚, 行首偏移) —— 行首有 10 空格缩进 ⇒ 恒假。（两类近似本次都踩过）
  ok(!nextLineText(badSrc, badSrc.indexOf(INSERT_ANCHOR)).startsWith(MARK_LINE), 'G5d 反例下面板不再紧贴 semMode 行')
  ok(nextLineText(badSrc, badSrc.indexOf(STORE_HEAD)).startsWith(MARK_LINE), 'G5f 反例复现了事故形态（面板紧贴 store 分区头）')
  ok(nextLineText(SRC, SRC.indexOf(INSERT_ANCHOR)).startsWith(MARK_LINE), 'G5g 真源码里面板确实紧贴 semMode 行')
  // 正向：真源码里 engine 与 store 都还在（未被反例污染）
  ok(eng && sectionOf(sectionBounds(SRC), SRC.indexOf(MARK_START)) === 'engine', 'G5e 真源码未被反例影响，块仍在 engine')
}

console.log('\n[S2] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
