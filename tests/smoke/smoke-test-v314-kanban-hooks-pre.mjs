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
 * ⚠️ 已知边界（诚实记录，勿当全知）：K2 是**单行**启发式 —— 跨行的条件包 hook
 *   （如 `if (a)` 换行再 `useX()`）与 `h(...)` 换行传参它看不见；K1c 只锁本次事故的精确写法。
 *   真正兜底仍是 React 自身的 #310，本网的作用是把报红提前到 CI。
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

console.log('=== K1 抽屉正文已收进独立组件（#310 修法的落点）===')
ok(CL.includes('function KanbanDrawerBody(props)'), 'K1a ★抽屉正文是独立组件（hook 收进组件内 ⇒ 挂载期 hook 数恒定）')
ok(CL.includes('h(KanbanDrawerBody, {'), 'K1b 抽屉渲染改为挂载该组件')
ok(!/(useCardFull\(drawer\))/.test(CL.replace(/[\s\S]*?function KanbanDrawerBody[\s\S]*?\n    }/, '')), 'K1c ★已无「在条件分支里裸调 useCardFull(drawer)」')
ok(CL.includes('useCardFull(d) || d.full || d.preview'), 'K1d 兜底链保留（取不到全文时回退 preview，绝不空白）')

console.log('\n=== K2 全仓 hook 调用面：不得出现在条件表达式/JSX 实参里 ===')
{
  // 单行启发式仍只负责提前拦截已知事故族，但必须：
  // ① 扫一行里的**全部** hook，而不是只看第一个；② 只把真正的三元 ? 当条件，不把对象属性的 : 误判。
  const hookCallRe = /\buse[A-Z][A-Za-z0-9]*\s*\(/g
  const riskyHookCallsInLine = (s) => {
    const hits = []
    for (const m of s.matchAll(hookCallRe)) {
      const at = Number(m.index)
      const before = s.slice(0, at)
      // 条件右侧：&& / ||，或真正的三元 ?（排除 ?. 与 ??）。
      const conditional = /&&|\|\|/.test(before) || /(^|[^?])\?(?![?.])/.test(before)
      // h(...) 的实参位：hook 前同行已有 h(，且当前位置紧跟在逗号/左括号/左方括号之后。
      const inJsxArg = /\bh\(/.test(before) && /(?:,|\(|\[)\s*(?:\(?\s*)$/.test(before)
      if (conditional || inJsxArg) hits.push({ at, hook: m[0].trim(), conditional, inJsxArg })
    }
    return hits
  }

  const bad = []
  lines.forEach((l, i) => {
    if (/^\s*function use[A-Z]/.test(l)) return
    if (/^\s*(\/\*|\*|\/\/)/.test(l)) return
    const hits = riskyHookCallsInLine(l)
    if (hits.length) bad.push('L' + (i + 1) + '  ' + l.trim().slice(0, 130))
  })
  ok(bad.length === 0, '★K2 无「条件/实参里调 hook」的写法（实得 ' + bad.length + ' 处）', bad.join('\n           '))

  // 判据自身哨兵：既锁本次事故，也锁「同一行第二个 hook」漏报与对象属性冒号误报。
  const CATCHES = (s) => riskyHookCallsInLine(s).length > 0
  ok(CATCHES("h('pre', { key: 'body' }, (useCardFull(drawer) || drawer.full))"), 'K2s1 本次事故行（自定义 hook 作实参）能报警')
  ok(CATCHES("h('p', null, useTick(30))"), 'K2s2 普通实参位调用自定义 hook 能报警')
  ok(CATCHES("const a = useA(); cond && useB()"), 'K2s3 ★同一行第二个 hook 位于条件右侧也能报警')
  ok(CATCHES("const a = useA(); h('p', null, useB())"), 'K2s4 ★同一行第二个 hook 作 h() 实参也能报警')
  ok(!CATCHES("const x = { value: useFoo() }"), 'K2s5 ★对象属性冒号不是三元表达式，不误报合法顶层 hook')
}

console.log('\n=== K3 同一 hook 的既有正确写法未被改坏 ===')
ok(CL.includes('useCardFull(expanded ? c : null)'), 'K3 KanbanCard 仍是无条件调用 + 可空参数')

console.log('\n[汇总] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
