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
  // ★v3.1.4 审校修正：原判据的 HOOKS 白名单只列 8 个**内置** hook，而造成本次 #310 白屏的
  //   useCardFull 是**自定义** hook ⇒ 事故行连判定都进不去（实测对该行 SKIPPED、不报警），
  //   文件头「下次谁再这么写就红」成了空头承诺。改按形态匹配任意 useXxx( 调用。
  //   同时把原判据里恒假的 inJsxArg 复合式（`X.test(...) === false && ...` 自相矛盾）
  //   换成两个可独立成立的条件。误报实测：client.js 全 7537 行 0 命中；
  //   四条已知事故形态（实参里调 hook / 三元右侧 / 数组实参 / 自定义 hook）全部报警。
  const hookRe = /\buse[A-Z][A-Za-z0-9]*\s*\(/
  const bad = []
  lines.forEach((l, i) => {
    if (!hookRe.test(l)) return
    if (/^\s*function use[A-Z]/.test(l)) return                       // hook 定义行
    if (/^\s*(\/\*|\*|\/\/)/.test(l)) return                          // 注释
    const at = l.search(hookRe)
    const before = l.slice(0, at)
    // ① 条件右侧：hook **之前**同行出现 ? : && || ⇒ 是否调用取决于分支 ⇒ hook 数可变
    const conditional = /[:?](?!\/)/.test(before) || /&&|\|\|/.test(before)
    // ② JSX 实参：hook **之前**同行有 h( ，且 hook 紧跟在 , ( [ 之后 ⇒ 被当实参传入（本次事故形态）
    const inJsxArg = /\bh\(/.test(before) && /[,([]\s*(\(?\s*)$/.test(before)
    if (conditional || inJsxArg) bad.push('L' + (i + 1) + '  ' + l.trim().slice(0, 130))
  })
  ok(bad.length === 0, '★K2 无「条件/实参里调 hook」的写法（实得 ' + bad.length + ' 处）', bad.join('\n           '))
  // 判据自身的哨兵：把已知事故行喂进去，必须报警（防"守卫再次看不见自己的猎物"）
  const CATCHES = (s) => {
    if (!hookRe.test(s)) return false
    const b = s.slice(0, s.search(hookRe))
    return /[:?](?!\/)/.test(b) || /&&|\|\|/.test(b) || (/\bh\(/.test(b) && /[,([]\s*(\(?\s*)$/.test(b))
  }
  ok(CATCHES("h('pre', { key: 'body' }, (useCardFull(drawer) || drawer.full))"), 'K2s 哨兵：本次事故行（自定义 hook 作实参）能报警')
  ok(CATCHES("h('p', null, useTick(30))"), 'K2s 哨兵：数组外的实参位调用自定义 hook 能报警')
}

console.log('\n=== K3 同一 hook 的既有正确写法未被改坏 ===')
ok(CL.includes('useCardFull(expanded ? c : null)'), 'K3 KanbanCard 仍是无条件调用 + 可空参数')

console.log('\n[汇总] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
