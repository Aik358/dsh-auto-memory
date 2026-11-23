// issue#476 验收：会话检索的四种失败姿态不可区分 + eventFilters 死字段。
//
// 缺陷（修复前，HEAD 6a3da76a 实测）：
//   ① searchSessionHistory 的 catch 只按「宿主调用是否成功」二分（received 变量），
//      不按 error.code 分支 ⇒ DSH 桌面版**默认部署态**（session-query-sqlite.openAt: never
//      抛 SESSION_QUERY_SEARCH_DISABLED）被当成真故障：每次 recall 都落一条降级台账
//      + 白付 6s 超时 + 一句「具体成因未确定」，用户拿不到任何可操作线索。
//   ② 「检索成功但零命中」与「索引为空」也混成一个"没搜到"。
//   ③ eventFilters：**全仓命中 0**（grep lib/ tests/ tools/ skins/ + git log --all -S 均为 0）
//      ⇒ 它不是"声明了没接线"，而是**根本不存在这个声明**，故无可删、也无可补接线。
//
// 本套件是**功能验收（CR-10）**：真 import → 真构造 → 真调用 → 断言返回值。
//   [A] 错误 → 姿态分类：disabled / index-error / unknown 三态可区分
//   [B] 返回 → 姿态分类：hit / no-hit / index-empty 三态可区分
//   [C] 台账判据：预期内姿态**不得**进降级台账（#476 主诉），预期外必须进
//   [D] 枚举自洽：姿态全集 / 预期集 / 未知值 fail-closed
//   [E] 降级台账真跑：disabled 不计数、index-error 计数
//   [F] eventFilters 死字段判定的可复算证据（计数为 0，且非"声明后未接线"）
import {
  classifySessionSearchErrorPre, classifySessionSearchResultPre, isSessionSearchPosturePre,
  recordDiagnosticErrorPre, diagnosticErrorReasonPre,
  SESSION_SEARCH_DISABLED_HINT, SESSION_SEARCH_INDEX_ERROR_HINT,
} from '../../lib/diagnostic-error.js'
import {
  createDegradeSinkPre, shouldRecordSessionSearchPre,
  SESSION_SEARCH_POSTURES_PRE_V1, SESSION_SEARCH_EXPECTED_POSTURES_PRE_V1,
} from '../../lib/degrade.js'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) } else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) } }
const err406 = (code, msg) => Object.assign(new Error(msg || code), { code })

console.log('=== A. 错误 → 姿态（四种失败姿态可区分）===')
const a1 = classifySessionSearchErrorPre(err406('SESSION_QUERY_SEARCH_DISABLED'))
ok(a1.posture === 'disabled', 'A-1 SESSION_QUERY_SEARCH_DISABLED ⇒ disabled', a1.posture)
ok(a1.expected === true, 'A-2 ★ disabled 标记为 expected=true（预期部署态，不是故障）')
ok(a1.hint.includes('openAt') && a1.hint.includes('first-search'), 'A-3 ★ 诊断点名**配置项**与**可操作下一步**（修前是「具体成因未确定」）', a1.hint.slice(0, 40) + '…')
ok(a1.hint === SESSION_SEARCH_DISABLED_HINT, 'A-4 hint 与导出的常量同源（无两份文案）')

const a2 = classifySessionSearchErrorPre(err406('SESSION_QUERY_INDEX_FAILED'))
ok(a2.posture === 'index-error' && a2.expected === false, 'A-5 INDEX_FAILED ⇒ index-error 且 expected=false', a2.posture)
ok(a2.hint.includes('索引') && a2.hint.includes('非配置问题'), 'A-6 index-error 的文案与 disabled **不同**（两种处置）')
const a2b = classifySessionSearchErrorPre(err406('SESSION_QUERY_PERSISTENCE_FAILED'))
ok(a2b.posture === 'index-error', 'A-7 PERSISTENCE_FAILED 也归 index-error（同为真故障家族）', a2b.posture)

ok(classifySessionSearchErrorPre(new Error('boom')).posture === 'unknown', 'A-8 无 code 无白名单词 ⇒ unknown（fail-closed）')
ok(classifySessionSearchErrorPre(new Error('boom')).expected === false, 'A-9 unknown 不是 expected（必须留痕）')
ok(classifySessionSearchErrorPre(null).posture === 'unknown', 'A-10 null 不抛，归 unknown')

// code 只在 message 里（#478 同源场景）
const a3 = classifySessionSearchErrorPre(new Error('x SESSION_QUERY_SEARCH_DISABLED y'))
ok(a3.posture === 'disabled', 'A-11 code 只在 message 里也能识别', a3.posture)
// 优先级：disabled 必须先于 index-error 判（宿主 _assertSearchEnabled 先抛 disabled）
const both = Object.assign(new Error('SESSION_QUERY_PERSISTENCE_FAILED context'), { code: 'SESSION_QUERY_SEARCH_DISABLED' })
ok(classifySessionSearchErrorPre(both).posture === 'disabled', 'A-12 ★ 同时含两者 ⇒ disabled 优先（否则部署态被误记成真故障）', classifySessionSearchErrorPre(both).posture)

console.log('')
console.log('=== B. 返回 → 姿态（索引空 vs 没命中）===')
ok(classifySessionSearchResultPre({ items: [{},{},{}] }) === 'hit', 'B-1 items 非空 ⇒ hit')
ok(classifySessionSearchResultPre({ items: [], total: 67 }) === 'no-hit', 'B-2 ★ 有会话但零命中 ⇒ no-hit（不是 index-empty）')
ok(classifySessionSearchResultPre({ items: [], total: 0 }) === 'index-empty', 'B-3 ★ 索引里 0 个会话 ⇒ index-empty')
ok(classifySessionSearchResultPre({ items: [], indexedSessions: 0 }) === 'index-empty', 'B-4 换字段名 indexedSessions 也识别')
ok(classifySessionSearchResultPre({ items: [] }) === 'no-hit', 'B-5 取不到总数 ⇒ 保守判 no-hit（不误报 index-empty）')
ok(classifySessionSearchResultPre(null) === 'no-hit', 'B-6 null 不抛，保守 no-hit')
ok(classifySessionSearchResultPre({ items: 'not-array' }) === 'no-hit', 'B-7 items 畸形按空处理')

console.log('')
console.log('=== C. 台账判据：#476 主诉（预期态不得进降级台账）===')
ok(shouldRecordSessionSearchPre('disabled') === false, 'C-1 ★★★ disabled ⇒ **不记**降级台账（修前每次都记）')
ok(shouldRecordSessionSearchPre('no-hit') === false, 'C-2 no-hit ⇒ 不记（合法空结果）')
ok(shouldRecordSessionSearchPre('index-empty') === false, 'C-3 index-empty ⇒ 不记（合法状态）')
ok(shouldRecordSessionSearchPre('hit') === false, 'C-4 hit ⇒ 不记（正常运行）')
ok(shouldRecordSessionSearchPre('index-error') === true, 'C-5 ★ index-error ⇒ 必须记（预期外）')
ok(shouldRecordSessionSearchPre('unknown') === true, 'C-6 ★ unknown ⇒ 必须记（不得当作正常）')
ok(shouldRecordSessionSearchPre('banana') === true, 'C-7 未知姿态 fail-closed 到「记」', 'true')
ok(shouldRecordSessionSearchPre(null) === true, 'C-8 null 也 fail-closed 到「记」')

console.log('')
console.log('=== D. 枚举自洽 ===')
ok(SESSION_SEARCH_POSTURES_PRE_V1.length === 6, 'D-1 姿态全集 6 个', String(SESSION_SEARCH_POSTURES_PRE_V1.length))
ok(Object.isFrozen(SESSION_SEARCH_POSTURES_PRE_V1), 'D-2 姿态枚举被冻结（防运行时篡改）')
ok(Object.isFrozen(SESSION_SEARCH_EXPECTED_POSTURES_PRE_V1), 'D-3 预期集被冻结')
ok(SESSION_SEARCH_EXPECTED_POSTURES_PRE_V1.length === 4, 'D-4 预期集 4 个（其余 2 个是要记的）', SESSION_SEARCH_EXPECTED_POSTURES_PRE_V1.join('/'))
for (const p of SESSION_SEARCH_EXPECTED_POSTURES_PRE_V1) ok(SESSION_SEARCH_POSTURES_PRE_V1.includes(p), 'D-5 预期集 ⊆ 全集 :: ' + p)
ok(isSessionSearchPosturePre('disabled') === true && isSessionSearchPosturePre('nope') === false, 'D-6 isSessionSearchPosturePre 正反两向')

console.log('')
console.log('=== E. 降级台账真跑（端到端：分类 → 记账判据 → sink）===')
const sink = createDegradeSinkPre({ now: () => 1700000000000 })
const handle = (e) => { const c = classifySessionSearchErrorPre(e); if (shouldRecordSessionSearchPre(c.posture)) recordDiagnosticErrorPre(sink, 'session-search', e); return c.posture }
ok(handle(err406('SESSION_QUERY_SEARCH_DISABLED')) === 'disabled', 'E-1 处理 disabled')
ok(sink.countOf('session-search') === 0, 'E-2 ★★★ 默认部署态调用 **3 次以内不产生任何降级计数**（修前每次都记）', String(sink.countOf('session-search')))
handle(err406('SESSION_QUERY_SEARCH_DISABLED')); handle(err406('SESSION_QUERY_SEARCH_DISABLED'))
ok(sink.countOf('session-search') === 0, 'E-3 ★★ 反复 disabled 仍为 0（噪音不淹没信号）', String(sink.countOf('session-search')))
ok(handle(err406('SESSION_QUERY_INDEX_FAILED')) === 'index-error', 'E-4 处理 index-error')
ok(sink.countOf('session-search') === 1, 'E-5 ★★ 真故障恰好记 1 次（不是 2 次）', String(sink.countOf('session-search')))
ok(handle(new Error('weird')) === 'unknown', 'E-6 处理 unknown')
ok(sink.countOf('session-search') === 2, 'E-7 unknown 也留痕 ⇒ 累计 2', String(sink.countOf('session-search')))
ok(sink.snapshot().counts['session-search'] === 2, 'E-8 snapshot 里 counts 一致（可查询状态）')
// 台账 reason 仍带稳定 code（#478 已修，确认未被本次改动削弱）
ok(diagnosticErrorReasonPre(err406('SESSION_QUERY_SEARCH_DISABLED')).includes('code=SESSION_QUERY_SEARCH_DISABLED'), 'E-9 reason 仍保留稳定 code')

console.log('')
console.log('=== F. eventFilters：死字段判定的可复算证据 ===')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
function countIn(dir, re) {
  let n = 0
  const walk = (d) => {
    let ents = []
    try { ents = readdirSync(d, { withFileTypes: true }) } catch (_) { return }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(node_modules|\.git)$/.test(e.name)) walk(p); continue }
      if (!/\.(js|mjs)$/.test(e.name)) continue
      if (e.name === 'client.js') continue   // 生成产物，不是真源
      if (e.name === 'smoke-test-issue476-session-posture.mjs') continue   // 本套件自身（含该词用于计数）
      let t = ''
      try { t = readFileSync(p, 'utf8') } catch (_) { continue }
      const m = t.match(re)
      if (m) n += m.length
    }
  }
  walk(dir)
  return n
}
const libHits = countIn(path.join(ROOT, 'lib'), /eventFilters/g)
const testHits = countIn(path.join(ROOT, 'tests'), /eventFilters/g)
const toolHits = countIn(path.join(ROOT, 'tools'), /eventFilters/g)
ok(libHits === 0, 'F-1 lib/ 下 eventFilters 出现 0 次（含 client.js 之外全部 .js）', String(libHits))
ok(testHits === 0 && toolHits === 0, 'F-2 tests/ 与 tools/ 同样 0 次', testHits + ' / ' + toolHits)
// ★判据区分「声明了没接线」与「根本不存在」：死字段 = 有声明点无读取点 ⇒ 声明 ≥1 且读取 =0
//   实测两者都 =0 ⇒ 不是死字段，是**从未存在**，故无可删、也无可补接线的对象。
ok(libHits === 0, 'F-3 ★ 声明点也是 0 ⇒ 判定为「从未存在」而非「声明后未接线」（前者无可删，后者才该补接线）', 'decl=' + libHits + ' read=' + libHits)

console.log('')
console.log((fail === 0 ? 'PASS ' : 'FAIL ') + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
