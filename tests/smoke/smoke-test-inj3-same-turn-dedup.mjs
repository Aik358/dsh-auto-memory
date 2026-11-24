/** Verify grant deduplication across requests and turns through the registered context. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { markers, message, startDeliveryHost } from '../lib/delivery-step-fixture.mjs'

const source = path.resolve(process.env.DAM_AUDIT_ENGINE_SOURCE || process.env.DAM_INDEX_JS || path.join(import.meta.dirname, '../../lib/index.js'))
if (process.env.DAM_INDEX_JS) process.env.DAM_AUDIT_ENGINE_SOURCE = source
const SRC = readFileSync(source, 'utf8') // T6 checks structural guards separately.
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const eq = (got, want, name) => ok(got === want, name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
const human = () => message('user'), notice = () => message('agent-message')
const host = await startDeliveryHost()
try {
  const session = () => host.session({ runTierInjectEnabled: true, snapshotMinGapRounds: 5, slimEveryRounds: 3 })
  const run = (s, batch, newTurn = false) => s.request(batch, { newTurn, repeat: true })
  const kinds = rows => rows.map(r => r.kind).join(',')

  const late = session()
  eq(kinds([await run(late, []), await run(late, [human()]), await run(late, [])]),
    'full,human-slim,run-slim', 'T1 同轮迟到的真人输入只影响当前模型请求')

  const first = session()
  eq(kinds([await run(first, [human()]), await run(first, [notice()]), await run(first, [])]),
    'full,run-slim,run-slim', 'T2 真人首请求完整版，随后通知及工具步受节流')

  const adjacent = session()
  eq(kinds([await run(adjacent, [human()]), await run(adjacent, [notice(), human()])]),
    'full,human-slim', 'T3 无新 turn/start 的第二条真人消息取得本步精简正文')

  const auto = session(), firstEight = []
  for (let i = 0; i < 8; i++) {
    auto.state.eventCardsText = markers.card + ' 变化的日志卡 ' + i
    firstEight.push((await run(auto, [notice()])).kind)
  }
  eq(firstEight.join(','), 'full,run-slim,run-slim,run-slim,run-slim,full,run-slim,run-slim',
    'T4 同 turn 八次请求，变化正文仍按间隔五步放行')

  const spanning = session(), fullAt = [], rows = []
  for (let step = 1; step <= 16; step++) {
    const row = await run(spanning, [], step > 5)
    rows.push(row)
    if (row.kind === 'full') fullAt.push(step)
  }
  eq(kinds(rows.slice(0, 5)), 'full,run-slim,run-slim,run-slim,run-slim', 'T5-a 首五步只有一份完整版')
  eq(fullAt.join(','), '1,6,11,16', 'T5-b 跨 turn 的模型请求继续推进同一间隔')
} finally { await host.close() }

console.log('=== T6 守卫：修复标记必须在位（防回退）===')
{
  ok(/const firstOfTurn = !!\(turnKey && [^\n]*_lastFullKey !== turnKey/.test(SRC), 'T6-a：firstOfTurn 经持久键比较（去重键未被绕过）')
  ok(/_upgradeFromFallback|_snapRoundTurnKey/.test(SRC), 'T6-b：两处修复标记至少一处可见（本套件与实现同源）')
}
console.log('')
console.log('[inj3-same-turn-dedup] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
