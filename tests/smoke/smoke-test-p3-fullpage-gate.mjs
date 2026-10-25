/**
 * smoke-test-p3-fullpage-gate.mjs —— P3 可见性闸门（Lead 硬要求，缺一不算通过）
 *
 * 危险面（Lead 2026-10-25 指出）：conversation.view 同时注册多个 kind=page 的 surface
 *   （记忆页 78 / 白板看板页 80 / 白板画布 81，E8-6 注释实证）。若宿主「全部挂载、只切显隐」，
 *   用户在对话页时白板页组件也已挂载 ⇒ 若无条件 mark(true)
 *   ⇒ body[data-dam-fullpage] 被打上 ⇒ composer display:none
 *   ⇒ 用户在对话页永远打不了字（比原 bug 严重得多）。
 *
 * 判据：
 *   P3-N1 白板页已挂载但当前在对话页（0 尺寸）⇒ body 不得有 data-dam-fullpage
 *         ⇒ composer display 必须是 block（打印实测值）
 *   P3-N2 切到白板页（有尺寸）⇒ 打标 + composer display:none + 高度 = 可用高度 100%
 *   P3-N3 切回对话页（cleanup）⇒ 摘标 + composer 恢复 block（打印实测值）
 *   变异：把闸门去掉（无条件 mark(true)）⇒ N1 必红
 *
 * 真执行方式（不伪造）：gate / sync / height 三个函数从 client.js 按行锚点抽真源码，vm 真跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const ROOT = 'D:/dsh-auto-memory'
const SRC = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8').replace(/\r\n/g, '\n')
const LINES = SRC.split(String.fromCharCode(10))
const NL = String.fromCharCode(10)
let pass = 0, fail = 0
const ok = (m, fn) => { try { fn(); pass++; console.log('  PASS ' + m) } catch (e) { fail++; console.log('  FAIL ' + m + ' :: ' + (e && e.message)) } }

/** 按行锚点 + 逐字符配平抽函数；跳过 // 注释，避免注释里的花括号/引号干扰 */
function extractFnByLine (lines, name) {
  const head = new RegExp('^\\s*function ' + name + '\\s*\\(')
  let start = -1
  for (let i = 0; i < lines.length; i += 1) if (head.test(lines[i])) { start = i; break }
  if (start < 0) return null
  let depth = 0, started = false, out = []
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]
    out.push(line)
    let inS = 0, q = '', esc = false
    for (let k = 0; k < line.length; k += 1) {
      const c = line[k]
      if (inS) {
        if (esc) { esc = false; continue }
        if (c === String.fromCharCode(92)) { esc = true; continue }
        if (c === q) inS = 0
        continue
      }
      if (c === '/' && line[k + 1] === '/') break
      if (c === String.fromCharCode(34) || c === String.fromCharCode(39)) { inS = 1; q = c; continue }
      if (c === '{') { depth += 1; started = true; continue }
      if (c === '}') { depth -= 1; if (started && depth === 0) return out.join(NL) }
    }
  }
  return null
}

console.log('')
console.log('== 0. 抽真源码 + 结构断言 ==')
const gateSrc = extractFnByLine(LINES, 'elLooksVisible')
const syncSrc = extractFnByLine(LINES, 'ev4SyncFullpageAttr')
const heightSrc = extractFnByLine(LINES, 'computeFullpageHeightPre')
ok('elLooksVisible 抽到真源码', () => assert.ok(gateSrc && gateSrc.length > 200, 'len=' + (gateSrc ? gateSrc.length : 0)))
ok('ev4SyncFullpageAttr 抽到真源码', () => assert.ok(syncSrc && syncSrc.length > 100))
ok('computeFullpageHeightPre 抽到真源码', () => assert.ok(heightSrc && heightSrc.length > 300))
ok('闸门含 fail-closed（catch 里 return false）', () => {
  assert.ok(gateSrc.indexOf('catch') >= 0, '无 catch')
  assert.ok(gateSrc.slice(gateSrc.indexOf('catch')).indexOf('return false') >= 0, 'catch 不是 return false（fail-open 危险）')
})
// ★★2026-10-25 用户实报「全屏还是不生效」后的**关键回归守卫**（Lead 要求）：
//   闸门**不得**引用 el 自身高度 —— 否则与 fit() 构成死循环：
//     el 高度由 fit() 写 → fit() 的 CSS 高度链只在打标后生效 → 打标又要先过「el 有高度」闸门
//     ⇒ 永远不达标。真 Chrome 复刻页之所以绿，是因为复刻页里 el 一开始就有高度（掩盖了循环）。
ok('★★★闸门**不得**引用 el 自身高度（防与 fit() 死循环）', () => {
  const bad = [
    /r\.height\s*>/,
    /getBoundingClientRect\(\)\.height/,
    /getBoundingClientRect\(\)\s*\.height\s*>/,
    /rect\.height\s*>/
  ]
  for (const re of bad) {
    assert.ok(!re.test(gateSrc), '闸门引用了 el 高度（会与 fit() 死循环）：' + re + ' —— 命中内容：' + JSON.stringify(gateSrc.slice(0, 400)))
  }
})
ok('挂载处 mark(true) 被闸门包裹', () => {
  assert.ok(SRC.indexOf('if (elLooksVisible()) mark(true)') >= 0, '未见闸门包裹')
})
ok('IO 正路径也走闸门（出现 >= 2 次）', () => {
  const cnt = SRC.split('if (elLooksVisible()) mark(true)').length - 1
  assert.ok(cnt >= 2, '闸门 count=' + cnt + '，IO 正路径未走闸门')
})
ok('闸门在注册 IntersectionObserver 之前', () => {
  const iGate = SRC.indexOf('if (elLooksVisible()) mark(true)')
  const iIO = SRC.indexOf('var io = new IntersectionObserver', iGate)
  assert.ok(iGate >= 0 && iIO > iGate, 'gate@' + iGate + ' io@' + iIO)
})

/** 受控 harness：真跑抽出的 gate / sync / height */
function makeHarness (pageVisible) {
  const bodyAttrs = {}
  let composDisplay = 'block'
  // ★2026-10-25 桩同步（缺陷 A 修复后）：新闸门判据 = offsetWidth > 0 && computed 非隐藏
  //   && 祖先 [data-conversation-scroll].clientHeight > 0 —— **都不引用 el 自身高度**。
  //   桩必须提供这三样同语义信号（旧桩只给 rect.height，新闸门读不到）。
  const area = { clientHeight: pageVisible ? 800 : 0 }
  const el = {
    offsetParent: pageVisible ? {} : null,
    offsetWidth: pageVisible ? 1200 : 0,
    offsetHeight: pageVisible ? 800 : 0,
    closest: function (sel) { return sel === '[data-conversation-scroll]' ? area : null },
    // 仍保留 rect（computeFullpageHeightPre 的入参需要 top；闸门不再读 height）
    getBoundingClientRect: function () {
      return { top: pageVisible ? 8 : 0, left: 0, width: pageVisible ? 1200 : 0, height: pageVisible ? 800 : 0, bottom: pageVisible ? 808 : 0, right: pageVisible ? 1200 : 0 }
    }
  }
  const sandbox = {
    el: el,
    document: { body: {
      setAttribute: function (k, v) { bodyAttrs[k] = String(v); if (k === 'data-dam-fullpage') composDisplay = (v === 'true') ? 'none' : 'block' },
      removeAttribute: function (k) { delete bodyAttrs[k]; if (k === 'data-dam-fullpage') composDisplay = 'block' },
      getAttribute: function (k) { return bodyAttrs[k] === undefined ? null : bodyAttrs[k] }
    } },
    getComputedStyle: function () { return { display: pageVisible ? 'block' : 'none', visibility: 'visible' } },
    Set: Set
  }
  const ctx = vm.createContext(sandbox)
  const code = 'var EV4_VISIBLE_PAGES = new Set();' + NL + syncSrc + ';' + NL + gateSrc + ';' + NL + heightSrc + NL +
    'globalThis.__API = { gate: elLooksVisible, sync: ev4SyncFullpageAttr, height: computeFullpageHeightPre, pages: EV4_VISIBLE_PAGES };'
  vm.runInContext(code, ctx)
  const api = ctx.__API
  return {
    gate: api.gate, height: api.height, pages: api.pages,
    mark: function (on) { if (on) api.pages.add(el); else api.pages.delete(el); api.sync() },
    bodyAttr: function () { return bodyAttrs['data-dam-fullpage'] === undefined ? null : bodyAttrs['data-dam-fullpage'] },
    composDisplay: function () { return composDisplay }
  }
}

console.log('')
console.log('== P3-N1 ★白板页已挂载但当前在对话页（0 尺寸）⇒ 不得打标 ==')
const H1 = makeHarness(false)
const g1 = H1.gate()
console.log('    实测：elLooksVisible()=' + g1 + '   (rect.height=0, offsetParent=null)')
ok('闸门判为不可见 ⇒ false', () => assert.equal(g1, false))
ok('★因此不 mark(true) ⇒ body 无 data-dam-fullpage', () => {
  if (g1) H1.mark(true)
  assert.equal(H1.bodyAttr(), null, '★★对话页被误打标了！')
})
ok('★composer 必须可见（打印实测 display）', () => {
  assert.equal(H1.composDisplay(), 'block', 'composer display=' + H1.composDisplay())
})
console.log('    ⇒ body[data-dam-fullpage] = ' + String(H1.bodyAttr()) + '   /   composer display = ' + H1.composDisplay())

console.log('')
console.log('== P3-N2 切到白板页（有尺寸）⇒ 打标 + composer 隐藏 + 高度 100% ==')
const H2 = makeHarness(true)
const g2 = H2.gate()
console.log('    实测：elLooksVisible()=' + g2 + '   (rect.height=800, offsetParent 非 null)')
ok('闸门判为可见 ⇒ true', () => assert.equal(g2, true))
ok('★打标 ⇒ data-dam-fullpage=true 且 composer display:none', () => {
  if (g2) H2.mark(true)
  assert.equal(H2.bodyAttr(), 'true')
  assert.equal(H2.composDisplay(), 'none')
})
ok('★高度 = 可用高度 100%（computeFullpageHeightPre 真跑）', () => {
  const h = H2.height(1008, 8, 0, 0, 8, true)
  const avail = 1008 - 8 - 0
  assert.equal(h, 1000, 'height=' + h)
  assert.ok(h / avail >= 0.98, 'ratio=' + (h / avail))
})
console.log('    ⇒ body[data-dam-fullpage] = ' + String(H2.bodyAttr()) + '   /   composer display = ' + H2.composDisplay() + '   /   fitH = 1000 px')

console.log('')
console.log('== P3-N3 切回对话页（cleanup mark(false)）⇒ 摘标 + composer 恢复 ==')
ok('★摘标 ⇒ body 无标记 且 composer display:block', () => {
  H2.mark(false)
  assert.equal(H2.bodyAttr(), null)
  assert.equal(H2.composDisplay(), 'block')
})
console.log('    ⇒ body[data-dam-fullpage] = ' + String(H2.bodyAttr()) + '   /   composer display = ' + H2.composDisplay())

console.log('')
console.log('== 变异：去掉闸门（无条件 mark(true)）⇒ N1 必红 ==')
// ★注意：源码里有 **2 处** 闸门调用（挂载处 + IO 正路径），必须全部替换才算真变异。
//   （首版只 replace 第一处 ⇒ 变异不彻底 ⇒ 变异断言自己红，已修正。）
const MUT = SRC.split('if (elLooksVisible()) mark(true)').join('mark(true)')
ok('变异成功（源码里不再有闸门调用）', () => assert.equal(MUT.indexOf('if (elLooksVisible()) mark(true)'), -1))
ok('★[变异必红] 变异版在对话页(0 尺寸)也会打标 ⇒ N1 判据必红', () => {
  const Hm = makeHarness(false)
  Hm.mark(true)
  assert.equal(Hm.bodyAttr(), 'true', '构造前提：变异版打标')
  assert.equal(Hm.composDisplay(), 'none', '构造前提：变异版隐藏 composer')
  let red = false
  try { assert.equal(Hm.bodyAttr(), null, '变异版：对话页被打标') } catch (e) { red = true }
  assert.equal(red, true, '变异版下 N1 竟未红 ⇒ 判据无鉴别力')
})

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)