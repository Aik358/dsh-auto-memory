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

console.log('=== K1 抽屉正文已收进独立组件（#310 修法的落点）===')
ok(CL.includes('function KanbanDrawerBody(props)'), 'K1a ★抽屉正文是独立组件（hook 收进组件内 ⇒ 挂载期 hook 数恒定）')
ok(CL.includes('h(KanbanDrawerBody, {'), 'K1b 抽屉渲染改为挂载该组件')
ok(!/(useCardFull\(drawer\))/.test(CL.replace(/[\s\S]*?function KanbanDrawerBody[\s\S]*?\n    }/, '')), 'K1c ★已无「在条件分支里裸调 useCardFull(drawer)」')
ok(CL.includes('useCardFull(d) || d.full || d.preview'), 'K1d 兜底链保留（取不到全文时回退 preview，绝不空白）')

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
ok(CL.includes('useCardFull(expanded ? c : null)'), 'K3 KanbanCard 仍是无条件调用 + 可空参数')

console.log('\n[汇总] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
