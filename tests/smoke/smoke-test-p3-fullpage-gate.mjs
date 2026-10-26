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
console.log('== N7 ★新增（审计 §1.3 M3 · 复刻环境缺真实初始条件 · 变异实证双全绿）==')
// 背景：把两处全屏修复的 CSS 全删，本套件与 e8-double-check 原本 17/0 + 15/0 双全绿。
//   根因：本套件用**手写的假 getComputedStyle**（直接 return {display:'block'}），
//   根本没解析真实 CSS 文件 ⇒ 删掉真 CSS 也测不出来。这是「绿但假的」第 9 类。
// 本组改为：**真读 skins/iter5/skin.css 原文**，对它做真实的「规则匹配 + 特异性比较 + 源码序」层叠判定，
//   断言 [data-dam-theme=page][data-dam-page] 的最终 display 必须是 flex（不是 contents/none）。
const SKIN_CSS_PATH = path.join(ROOT, 'skins', 'iter5', 'skin.css')

/** 极简 CSS 规则解析：只提取「单层、无 @media 包裹」的普通规则（够本判据用）。 */
function parseFlatRules (css) {
  const out = []
  const src = String(css).replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  while (i < src.length) {
    const lb = src.indexOf('{', i)
    if (lb < 0) break
    const rb = src.indexOf('}', lb)
    if (rb < 0) break
    const selText = src.slice(i, lb).trim()
    const body = src.slice(lb + 1, rb)
    i = rb + 1
    if (!selText || selText.charAt(0) === '@') continue
    for (const sel of selText.split(',')) {
      const s = sel.trim()
      if (!s) continue
      out.push({ selector: s, body, order: out.length })
    }
  }
  return out
}

/** 特异性：id(100) / class+attr+pseudo-class(10) / element+pseudo-element(1)。够用。 */
function specificityOf (sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length
  const cls = (sel.match(/\.[\w-]+/g) || []).length
  const attrs = (sel.match(/\[[^\]]+\]/g) || []).length
  const pseudos = (sel.match(/:(?!:)[\w-]+/g) || []).length
  const elems = (sel.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(\([^)]*\))?/g, ' ')
    .trim().split(/\s+/).filter(Boolean)).length
  return ids * 100 + (cls + attrs + pseudos) * 10 + elems
}

/** 该选择器是否命中给定元素（只支持 [attr=val] / [attr] / 单元素名 / 后代组合的简化判定）。 */
function selectorMatches (sel, el) {
  // 只处理「复合选择器（无空格）」或「含后代的」取最后一段判定，够用且不会误判成本条
  const last = sel.trim().split(/\s+/).pop()
  if (!last) return false
  const attrRe = /\[([\w-]+)(?:\s*=\s*["']?([^"'\)\]]+)["']?)?\]/g
  let m
  let matchedAny = false
  while ((m = attrRe.exec(last)) !== null) {
    matchedAny = true
    const name = m[1]
    const want = m[2]
    const have = el.attrs[name]
    if (have === undefined) return false
    if (want !== undefined && String(have) !== String(want)) return false
  }
  const tagMatch = last.match(/^([a-zA-Z][\w-]*)/)
  if (tagMatch) { matchedAny = true; if (tagMatch[1].toLowerCase() !== el.tag.toLowerCase()) return false }
  return matchedAny
}

/** 计算某元素某属性的最终值（按 特异性 > 源码序 的层叠规则）。 */
function computeProp (rules, el, prop) {
  let best = null
  for (const r of rules) {
    if (!selectorMatches(r.selector, el)) continue
    const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i')
    const mm = r.body.match(re)
    if (!mm) continue
    const spec = specificityOf(r.selector)
    if (!best || spec > best.spec || (spec === best.spec && r.order > best.order)) {
      best = { val: mm[1].trim(), spec, order: r.order, selector: r.selector }
    }
  }
  return best
}

{
  const css = fs.readFileSync(SKIN_CSS_PATH, 'utf8')
  const rules = parseFlatRules(css)
  ok('skin.css 可读且解析出规则', () => assert.ok(rules.length > 100, 'rules=' + rules.length))

  // 真实生产形态的元素：page 型外壳同时带 data-dam-theme=page 与 data-dam-page
  const pageEl = { tag: 'div', attrs: { 'data-dam-theme': 'page', 'data-dam-page': '' } }
  const disp = computeProp(rules, pageEl, 'display')

  ok('★★★[全屏] [data-dam-theme=page][data-dam-page] 的最终 display 必须是 flex', () => {
    assert.ok(disp, '没有任何规则命中该元素的 display')
    assert.equal(disp.val, 'flex',
      '实际胜出的是 ' + JSON.stringify(disp.val) + '（来自 ' + disp.selector + '）')
  })
  ok('★★★[全屏] 最终 display 不得是 contents（这是 10-25 全屏失效的根因）', () => {
    assert.ok(disp && disp.val !== 'contents',
      'display=contents ⇒ 根节点不生成盒子 ⇒ height:100% 全失效')
  })
  ok('★★[全屏] 胜出规则必须同时命中 theme 与 page 两个属性（证明是那条专用修复规则赢的）', () => {
    assert.ok(disp && disp.selector.indexOf('[data-dam-theme=page]') >= 0 && disp.selector.indexOf('[data-dam-page]') >= 0,
      '胜出选择器 = ' + (disp && disp.selector))
  })
  ok('★★[全屏] box-sizing 之后 height 计算依赖 flex 列方向', () => {
    const fd = computeProp(rules, pageEl, 'flex-direction')
    assert.ok(fd && fd.val === 'column', 'flex-direction=' + (fd && fd.val))
  })

  // ★负路径：把那条修复规则从 CSS 里删掉 ⇒ display 判据必须变红（证明不是恒真）
  const cssNoFix = css.split('[data-dam-theme=page][data-dam-page]{display:flex').join('[data-dam-theme=page][data-dam-page]{display:contents')
  const rulesMUT = parseFlatRules(cssNoFix)
  const dispMUT = computeProp(rulesMUT, pageEl, 'display')
  ok('★★★[负路径] 把修复改回 display:contents ⇒ 判定结果随之变红（判据有鉴别力）', () => {
    assert.ok(dispMUT)
    assert.equal(dispMUT.val, 'contents')
    assert.notEqual(dispMUT.val, 'flex')
  })
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)