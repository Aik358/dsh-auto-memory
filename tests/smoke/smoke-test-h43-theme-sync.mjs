#!/usr/bin/env node
/**
 * [h43-theme-sync] 明暗模式跨实现同步守卫（真执行，非静态断言）。
 *
 * ★由来（2026-10-01 用户真机实测）：
 *   「明暗模式改了很多次还是不对」。真因不是没修，而是**修在被生成器覆盖的位置 + 只改了半套**：
 *   ① 冻結页主题实现（iter5ThemeSet / useIter5Theme）在 lib/client.js 的**生成区内**，
 *      其源是 skins/legacy/iter5-325.js.frozen ⇒ 直接改 client.js 会被下一次生成器重跑整段还原；
 *   ② 凌晨的 H37 修法（set 端广播 + 挂载订阅）在 client.js 与 .frozen **两处都不在**，
 *      .frozen 的四个备份也都没有 ⇒ 本会话任何一次生成器重跑都会把它擦掉。
 *
 *   用户 Console 实测（决定性证据）：
 *     点击外观按钮后 themeKey dark→light、btn dark→light、pageDeep true→false，
 *     而 modeKey 恒为 dark、html colorScheme 恒为 dark ⇒ 冻結页自洽，跨实现镜像**从未发生**。
 *
 * ★本守卫的判据（CR-10）：真读**生成源** .frozen、按花括号配平抽出活代码、vm 真执行，
 *   断言「设档 ⇒ 对面收到」「挂载 ⇒ 注册订阅」，并带**两条变异负路径**（删广播 / 删订阅必红）。
 *   只读、零网络、零副作用。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC_FILE = 'skins/legacy/iter5-325.js.frozen'   // ← 生成源（改 client.js 会被覆盖）
const src = readFileSync(path.join(ROOT, SRC_FILE), 'utf8')

// ① 生成源必须是纯 LF（本仓冻结文件的历史约定；混入 CRLF 会污染产物）
assert.equal((src.match(/\r\n/g) || []).length, 0, SRC_FILE + ' 必须保持纯 LF')

/** 按名字 + 花括号配平抽函数体（不依赖缩进宽度——client.js 与 .frozen 缩进不同）。 */
function grabFn(text, name) {
  const s = text.indexOf('function ' + name + '(')
  assert.ok(s >= 0, 'function not found: ' + name)
  const lineStart = text.lastIndexOf('\n', s) + 1
  const b = text.indexOf('{', s)
  let d = 0
  for (let k = b; k < text.length; k++) {
    if (text[k] === '{') d++
    else if (text[k] === '}') { d--; if (!d) return text.slice(lineStart, k + 1) }
  }
  throw new Error('unbalanced function: ' + name)
}
const FN_GET = grabFn(src, 'iter5ThemeGet')
const FN_SET = grabFn(src, 'iter5ThemeSet')
const FN_USE = grabFn(src, 'useIter5Theme')

/** 忠实替身：localStorage + 模块级 iter5SetMode/listeners + React hooks（setter 记录调用）。 */
function harness(setSrc, useSrc) {
  const store = new Map(), calls = [], listeners = new Set(), setterCalls = []
  const sb = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    ITER5_THEME_KEY: 'dam-skin-theme',
    window: { addEventListener() {}, removeEventListener() {} },
    // 「对面」那份实现——记录收到的值并广播（= 模块级 iter5SetMode 的真实行为）
    iter5SetMode(v) { calls.push(v); listeners.forEach((l) => l(v)) },
    iter5ModeListeners: listeners,
    useState(v) { return [typeof v === 'function' ? v() : v, (nv) => { setterCalls.push(nv) }] },
    useEffect(fn) { fn(); return () => {} },
    useDeepTheme() { return true },
  }
  sb.globalThis = sb
  vm.createContext(sb)
  vm.runInContext(
    FN_GET + '\n' + setSrc + '\n' + useSrc +
    '\n;__o = { set: iter5ThemeSet, use: useIter5Theme };', sb,
  )
  return { sb, store, calls, listeners, setterCalls, o: sb.__o }
}

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok -', m) } else { fail++; console.error('  FAIL -', m) } }

// ② 设档 ⇒ 对面必须收到（值域映射 auto→system）
{
  const h = harness(FN_SET, FN_USE)
  h.o.set('light')
  ok(h.calls.length === 1 && h.calls[0] === 'light', '设 light ⇒ 模块级收到 light（实 ' + JSON.stringify(h.calls) + '）')
  ok(h.store.get('dam-skin-theme') === 'light', 'dam-skin-theme 写入 light')
}
{
  const h = harness(FN_SET, FN_USE)
  h.o.set('auto')
  ok(h.calls.length === 1 && h.calls[0] === 'system', '设 auto ⇒ 模块级收到 system（值域映射，实 ' + JSON.stringify(h.calls) + '）')
  ok(h.store.get('dam-skin-theme') === undefined, 'auto ⇒ 移除 dam-skin-theme')
}
// ③ 挂载 ⇒ 注册订阅；外部改档 ⇒ 本页被推动
{
  const h = harness(FN_SET, FN_USE)
  const t = h.o.use()
  ok(h.listeners.size === 1, '挂载后注册进 iter5ModeListeners（实 ' + h.listeners.size + '）')
  ok(h.setterCalls.length === 0, '挂载期无多余 setter（实 ' + h.setterCalls.length + '）')
  ok(t[0] === 'auto' && t[1] === true, '初值 auto ⇒ 跟随宿主 true（实 ' + JSON.stringify([t[0], t[1]]) + '）')
  h.o.set('dark')
  ok(h.setterCalls.length === 1, '★外部改档 ⇒ 本页 setter 被触发（实 ' + h.setterCalls.length + '）')
  t[2]('light')
  ok(h.setterCalls.length === 3, '本页按钮 ⇒ sync + 本地直调共 2 次 setter（实 ' + h.setterCalls.length + '）')
  ok(h.calls.lastIndexOf('light') >= 0, '且本页按钮的值外传到模块级（实 ' + JSON.stringify(h.calls) + '）')
}
console.log('PASS theme sync: 冻結页 ⇄ 模块级 双向接通（值 + 渲染）')

// ④ 变异负路径 A：真删广播 ⇒ 对面收不到（本套件必红）
{
  const mut = FN_SET.replace(/\/\/ ★H43[\s\S]*?catch \(eB\) \{\}/, '')
  assert.notEqual(mut, FN_SET, 'MUTATION CHECK: 广播段锚点必须命中（否则负路径恒绿）')
  const h = harness(mut, FN_USE)
  // ★#176①：必须真调用 setter，否则两条断言恒真（空转）；并去掉 `|| undefined` 逃逸（它与断言消息自相矛盾）。
  h.o.set('light')
  ok(h.calls.length === 0, 'MUTATION: 删广播 ⇒ 模块级收不到（实 ' + JSON.stringify(h.calls) + '）')
  ok(h.store.get('dam-skin-theme') === 'light',
    'MUTATION: 但本键仍写 ⇒ 精确复现「只写单键」症状（实 ' + JSON.stringify(h.store.get('dam-skin-theme')) + '）')
}
// ⑤ 变异负路径 B：真删订阅 ⇒ 外部改档本页毫无反应
{
  const mutUse = FN_USE.replace(/useEffect\(function \(\) \{[\s\S]*?\}, \[\]\)/, '')
  assert.notEqual(mutUse, FN_USE, 'MUTATION CHECK: 订阅段锚点必须命中')
  const h = harness(FN_SET, mutUse)
  h.o.use()
  ok(h.listeners.size === 0, 'MUTATION: 删订阅 ⇒ listeners = ' + h.listeners.size)
  h.o.set('dark')
  ok(h.setterCalls.length === 0, 'MUTATION: 删订阅 ⇒ 外部改档本页无反应（实 ' + h.setterCalls.length + '）')
}
console.log('PASS mutation checks: 删广播 / 删订阅 均必红')
console.log('')
console.log('== h43 theme sync: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) process.exit(1)
