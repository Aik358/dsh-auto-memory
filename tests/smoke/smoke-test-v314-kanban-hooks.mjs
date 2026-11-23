/**
 * v3.1.4 批 J 追加守卫：白板看板白屏（React #310）回归网。
 *
 * 用户报障（2026-09-22）：「白板看板没有办法点进去看内容了，点进去以后就直接白屏」。
 * 栈追踪：
 *   useCardFull (client.js:2070) → KanbanView (client.js:2545)
 *   React error #310 = "Rendered more hooks than during the previous render"
 *   → slot entry crashed in 'conversation.view'
 *
 * 根因：抽屉正文写成 `h('pre', …, (useCardFull(drawer) || …))`，位于
 *   `drawer ? kxPortal(...) : null` 的**条件分支内部** ⇒ 开/关抽屉改变 hook 数量 ⇒ #310。
 *
 * 本守卫钉死：**hook 调用不得出现在条件表达式或 JSX 实参里**（只许顶层无条件调用）。
 * 判据取自本次真实事故，属"下次谁再这么写就红"的硬网。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CL = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const lines = CL.split(/\r?\n/)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.error('  ✗ ' + n + (d ? ' — ' + d : '')) } }
const cnt = (h, n) => { let c = 0, i = 0; for (;;) { const p = h.indexOf(n, i); if (p < 0) return c; c++; i = p + n.length } }

// ★★D14（2026-10-24 用户裁定）：看板组件已退场，K1 的**对象**（KanbanDrawerBody / KanbanCard）不再存在。
//   但本套件真正的价值是下面的 **K2/K4 hook 安全网**（React #310 / #300 真实事故），
//   那两条与「哪个组件」无关，**原样保留**。K1 改为守**事件视图**是否复用了同一套安全写法：
//   ① 事件卡必须是**独立组件**（hook 收进组件内 ⇒ 挂载期 hook 数恒定）；
//   ② 渲染必须是 `h(EventCard, ...)` 挂载，不是内联调用；
//   ③ 展开态用 state 而不是在条件分支里调 hook。
console.log('=== K1 事件视图沿用 #310 修法（hook 收进独立组件）===')
ok(CL.includes('function EventCard(props)'), 'K1a ★事件卡是独立组件（hook 收进组件内 ⇒ 挂载期 hook 数恒定）')
ok(CL.includes('h(EventCard, {'), 'K1b 事件卡经 h(EventCard, ...) 挂载（不是内联调用）')
ok(CL.includes('var openPair = useState(false)'), 'K1c ★展开态用 state 持有（不在条件分支里调 hook）')
// ★2026-10-25 判据更新（Lead 裁决 · 判据过期，非缺陷）：
//   旧判据盯字面量 `h(EventCard, { key: ev.id` —— 它假设事件卡只在一个地方、且 key 就是 ev.id。
//   P1 加三视图后，事件卡挪进 renderStreamViewPre 的循环里，key 变成 `'sc-' + id + '-' + i`
//   （循环内保证唯一，比 ev.id 更正确）⇒ 旧判据**检的字面量已不存在，但功能更强了**。
//   这不是放宽：改成三条**结构性**断言，任一条都盯真实语义，不盯字面量。
const EVVIEW_I = CL.indexOf('function EventView(props)')
// ★2026-10-25 Lead 修（判据过期，非缺陷）：原用固定 12000 字符窗口 —— 实测 EventView 的**真实函数体
//   长约 15,972 字符**，三个渲染器调用点分别在 +12,109 / +12,222 / +12,326 字符处 ⇒ **全部落在窗口外** ⇒
//   断言恒假（真缺陷是判据的窗口，不是实现）。修法：按**结构边界**切函数体（到下一个同级 function 为止），
//   不写死任何字符数 —— 「按内容长度估边界」和「按字面量断语义」是同一类错误。
const _EVVIEW_END = (() => {
  if (EVVIEW_I < 0) return -1
  const rest = CL.slice(EVVIEW_I + 10)
  const m = /\n    function \w+/.exec(rest)
  return m ? EVVIEW_I + 10 + m.index : CL.length
})()
const EVVIEW_BODY = EVVIEW_I >= 0 && _EVVIEW_END > EVVIEW_I ? CL.slice(EVVIEW_I, _EVVIEW_END) : ''
ok(EVVIEW_I >= 0 && EVVIEW_BODY.length > 0, 'K1d-1 事件视图组件可定位（不是只定义不调用）')
// ② 事件视图必须真的把三视图渲染器之一调起来（结构性：进了渲染树才对）
ok(/render(Stream|Lanes|Workflow)ViewPre\(/.test(EVVIEW_BODY), 'K1d-2 ★事件视图体内真的调用三视图渲染器（结构性，不盯字面量）')
// ③ 事件卡必须被挂载（挂载点可以在任一视图渲染器里，不限 stream）
ok(/h\(EventCard, \{/.test(CL), 'K1d-3 ★事件卡真被 h(EventCard, {...}) 挂载（全仓任一视图渲染器内）')

console.log('\n=== K2 全仓 hook 调用面：不得出现在条件表达式/JSX 实参里 ===')
{
  const HOOKS = ['useState', 'useEffect', 'useMemo', 'useRef', 'useCallback', 'useContext', 'useReducer', 'useLayoutEffect']
  const hookRe = new RegExp('\\b(' + HOOKS.join('|') + ')\\s*\\(')
  const bad = []
  lines.forEach((l, i) => {
    if (!hookRe.test(l)) return
    if (/^\s*function use[A-Z]/.test(l)) return                       // hook 定义行
    if (/^\s*(\/\*|\*|\/\/)/.test(l)) return                          // 注释
    // 判定：同一行里，hook 调用是否出现在 `h(` 的实参中，或出现在 `? :`/`&&`/`||` 条件表达式的右侧
    const inJsxArg = /h\(/.test(l) && /\(\s*(use[A-Z][A-Za-z]*)\s*\(/.test(l.replace(/^[\s\S]*?h\(/, 'h(').replace(/[\s\S]*?h\(/, '')) === false && hookRe.test(l) && /,\s*(use[A-Z]|\()/.test(l)
    const conditional = /[?:]|&&|\|\|/.test(l.slice(0, l.search(hookRe)))
    if (inJsxArg || conditional) bad.push('L' + (i + 1) + '  ' + l.trim().slice(0, 130))
  })
  ok(bad.length === 0, '★K2 无「条件/实参里调 hook」的写法（实得 ' + bad.length + ' 处）', bad.join('\n           '))
}

console.log('\n=== K3 同一 hook 的既有正确写法未被改坏 ===')
// ★D14：KanbanCard 已删除 ⇒ 该写法不再存在；改守「事件卡也不在条件分支里调 hook」（同族判据，对象换新组件）
ok(!/\?\s*[^:]*use[A-Z]/.test(CL.slice(CL.indexOf('function EventCard'), CL.indexOf('function EventView'))), 'K3 事件卡内 hook 不得出现在三元表达式里')

// ★2026-09-28 追加 K4（issue #145 同族）：**组件级早退之后不得再有 hook 调用**。
//   背景：宿主槽位边界报 React error #300（"rendered fewer hooks than expected"），
//   根因是 GreetingCard 把 `if (!g) return null` 放在两个 useState 之前 —— 首渲染 g 为空
//   （OverviewTab 的 state 初值 null，等 apiGet 回填）走早退（0 hook），数据到达后二次渲染
//   执行 4 个 hook ⇒ 数量变化即抛 #300，该 overlay 条目整块不渲染。
//   K2 守的是「条件表达式里调 hook」，K4 守的是**早退位置**——两族不同，都要拦。
//   判据：对每个组件函数体，若组件体**顶层层级**（缩进 == 首语句缩进）存在 `if (...) return`，
//   则其后不得再出现顶层层级的 `use*` 调用。仅看顶层 ⇒ 不误报 useEffect 回调内的 return。
{
  const HOOKS = ['useState', 'useEffect', 'useMemo', 'useRef', 'useCallback', 'useContext', 'useReducer', 'useLayoutEffect', 'useTick', 'useTeamTick', 'useDeepTheme', 'useSkinCenter']
  const hookRe = new RegExp('\\b(' + HOOKS.join('|') + ')\\s*\\(')
  const comps = []
  lines.forEach((l, i) => { const m = /^(\s*)function\s+([A-Z][A-Za-z0-9_]*)\s*\(/.exec(l); if (m) comps.push({ name: m[2], start: i }) })
  const offenses = []
  for (const c of comps) {
    // 花括号配平求函数体范围
    let depth = 0, end = -1
    for (let i = c.start; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { end = i; i = lines.length; break } } }
    }
    // 组件体首层缩进
    let base = -1
    for (let i = c.start + 1; i <= end; i++) { const t = lines[i].trim(); if (t && t !== '{' && !/^(\/\/|\*|\/\*)/.test(t)) { base = lines[i].match(/^\s*/)[0].length; break } }
    if (base < 0) continue
    let earlyLine = -1
    for (let i = c.start + 1; i <= end; i++) {
      const l = lines[i]
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue
      if (l.match(/^\s*/)[0].length !== base) continue
      if (earlyLine < 0 && /^\s*if\s*\(.*\)\s*return\b/.test(l)) { earlyLine = i; continue }
      if (earlyLine >= 0 && hookRe.test(l) && !/^\s*function\s+use/.test(l)) {
        offenses.push(c.name + ' @L' + (i + 1) + ': ' + l.trim().slice(0, 110) + '   (早退在 L' + (earlyLine + 1) + ')')
      }
    }
  }
  ok(offenses.length === 0, '★K4 无「组件级早退之后仍有 hook 调用」的组件（否则宿主槽位边界会报 React #300/#310）（实得 ' + offenses.length + ' 处）', offenses.join('\n           '))
}

// ★2026-09-28 追加 K5（与社区作者 PR #146 报出的同一缺陷族）：**三元/逻辑表达式里的 hook 调用**。
//   背景：欢迎向导首屏原写作 `tourStep === 0 ? h(SkinHero, { deep: useDeepTheme() }) : null` ——
//   hook 在条件表达式里 ⇒ 只有 tourStep===0 时才执行 ⇒ 翻页后 hook 数量变化 ⇒ React #310
//   （"rendered more hooks than expected"）。表现：**重看欢迎向导时崩溃**。
//   K2 守「条件表达式里调 hook」的若干写法、K4 守「早退之后」；K5 专补**三元分支里的 hook**——
//   把真实教训直接编码进判据：hook 只允许出现在语句级无条件位置。
{
  const HOOKS5 = ['useState', 'useEffect', 'useMemo', 'useRef', 'useCallback', 'useContext', 'useReducer', 'useLayoutEffect', 'useTick', 'useTeamTick', 'useDeepTheme', 'useSkinCenter']
  const hookRe5 = new RegExp('\\b(' + HOOKS5.join('|') + ')\\s*\\(')
  const offenses5 = []
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return          // 注释行跳过（本段注释自己就含样板）
    if (!hookRe5.test(l)) return
    const at = l.search(hookRe5)
    const before = l.slice(0, at)
    const after = l.slice(at)
    // 违规形态判定（务实版）：hook **前**有 `?` 且**后**有 `:` —— 即它落在三元的两支之间。
    //   ① 真缺陷 `cond ? h(X, {deep: useFoo()}) : null`：前有 `?`、后有 `:` ⇒ 命中 ✓
    //   ② 合法 `h('div', cond ? a : b, useFoo())`：前有 `?` 但 `useFoo` 之后无 `:` ⇒ 不命中 ✓
    //   ③ 合法 `var x = useFoo(` / `return useFoo(`：前无 `?` ⇒ 不命中 ✓
    //   （已知不判的形态：同行多个三元、hook 恰在第一个三元之后且行尾还有另一个 `:` —— 罕见，
    //     若将来出现会被本守卫报出，届时人工确认即可；宁可偶报也不放过真缺陷。）
    const bad = before.includes('?') && after.includes(':') || /&&\s*$/.test(before) || /\|\|\s*$/.test(before)
    if (bad) offenses5.push('L' + (i + 1) + ': ' + l.trim().slice(0, 120))
  })
  ok(offenses5.length === 0, '★K5 无「三元/逻辑表达式里的 hook 调用」（翻页即改 hook 数量 → React #310）（实得 ' + offenses5.length + ' 处）', offenses5.join('\n           '))
  // 负向自证：把真实缺陷形态喂进判据，必须被拦（否则 K5 是空断言）
  const probe = 'tourStep === 0 ? h(SkinHero, { slot: "hero.welcome", deep: useDeepTheme() }) : null,'
  const pat = probe.search(hookRe5)
  ok(probe.slice(0, pat).includes('?') && probe.slice(pat).includes(':'),
    '★K5 负向自证：真实缺陷形态 `… ? h(X, {deep: useDeepTheme()}) : null` 会被本判据拦截')
  // 正向自证：合法写法不得被误报（否则守卫会被绕过或被迫放宽）
  const legit = "var pair = useState({})"
  const lat = legit.search(hookRe5)
  ok(!(legit.slice(0, lat).includes('?') && legit.slice(lat).includes(':')),
    '★K5 正向自证：`var pair = useState({})` 这类无条件写法不误报')
}

console.log('\n[汇总] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
