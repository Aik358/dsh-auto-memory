import path from 'node:path'
import { startDeliveryHost, message, markers } from '../lib/delivery-step-fixture.mjs'

if (process.env.DAM_INDEX_JS && !process.env.DAM_AUDIT_ENGINE_SOURCE) {
  process.env.DAM_AUDIT_ENGINE_SOURCE = path.resolve(process.env.DAM_INDEX_JS)
}
let pass = 0, fail = 0
function ok(cond, label) { if (cond) { pass++; console.log('  ok - ' + label) } else { fail++; console.log('  FAIL - ' + label) } }
const host = await startDeliveryHost()
try {
  const session = () => host.session({ runTierInjectEnabled: true, snapshotMinGapRounds: 5, slimEveryRounds: 3 })
  const freshHuman = () => message('user')
  const r = (s, messages) => s.request(messages, { repeat: true, toolStep: true })

  // No new turn/start: a fresh user message still owns this request, even behind a notice.
  const lag = session()
  ok((await r(lag, [freshHuman()])).text.includes(markers.full), 'T1-a 首次真人请求交付完整正文')
  const adjacent = await r(lag, [message('runtime-context'), freshHuman()])
  ok(adjacent.kind === 'human-slim' && adjacent.text.includes(markers.event), 'T1-b 轮界未变，新的真人请求得到精简事件，而非运行档或重复完整帧')

  const cron = session()
  ok((await r(cron, [])).kind === 'full', 'T2-a 运行档开启，首次非真人请求为完整')
  ok((await r(cron, [])).kind === 'run-slim', 'T2-b 非真人且间距未到，仍受节流')

  const mixed = session()
  const first = await r(mixed, [freshHuman()]), next = await r(mixed, [])
  ok(first.kind === 'full', 'T3-a 首次真人请求为完整')
  ok(next.kind === 'run-slim' && !next.text.includes(markers.event), 'T3-b 同 turn 下一工具步不继承真人')

  const repeated = session()
  const granted = await r(repeated, [freshHuman()])
  ok(granted.firstPostText.includes(markers.full), 'T4-a 真人首个准入读取为完整正文')
  ok(granted.kind === 'full', 'T4-b 同请求的重复读取未将完整正文覆盖为精简')
  ok(granted.firstPostText === granted.text, 'T4-c 准入帧逐字节等于最终投影，非仅档位相同')
  const cross = await r(repeated, [message('agent-message')])
  ok(cross.kind === 'run-slim' && cross.text !== granted.text, 'T4-d 跨步重新判档，不复读上个真人帧')
} finally { await host.close() }
console.log('PASS ' + pass + ' / FAIL ' + fail)
process.exitCode = fail ? 1 : 0
