/**
 * P5 (2026-09-16) —— 分档运行验收清单套件。
 * 权威依据: MASTER-PLAN §Phase 5 + TODO-GRAPH V2-P5 卡 crit T6-1/5/6 + 兼容档门(U1)。
 * 核心纪律: 发布材料逐项记录 通过/失败/未执行 — 不把「没测试环境」写成「已验收」。
 */
import { strict as assert } from 'node:assert'
import { createAcceptanceLedgerPre, ACCEPTANCE_ITEMS_PRE_V1, ACCEPTANCE_VERSION } from '../../lib/acceptance.js'

let pass = 0, fail = 0
const t = (name, fn) => {
  Promise.resolve().then(fn).then(
    () => { pass++; console.log('  ok - ' + name); flush() },
    (e) => { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)); flush() },
  )
}
let done = 0
const TOTAL = 8
function flush() { if (++done === TOTAL) { console.log('[p5-acceptance] ' + pass + ' passed, ' + fail + ' failed'); if (fail) process.exit(1) } }

t('A1 清单完整性: 7 必需项(T6-1/2/3/5/6/7 + compat-U1), 版本常量正确', () => {
  assert.equal(ACCEPTANCE_VERSION, 'acceptance_pre_v1')
  assert.equal(ACCEPTANCE_ITEMS_PRE_V1.length, 7)
  assert.ok(ACCEPTANCE_ITEMS_PRE_V1.every((x) => x.required === true), '全部为必需项')
  const ids = ACCEPTANCE_ITEMS_PRE_V1.map((x) => x.id)
  for (const id of ['T6-1', 'T6-2', 'T6-3', 'T6-5', 'T6-6', 'T6-7', 'compat-U1']) assert.ok(ids.includes(id), id + ' 在清单内')
})

t('A2 初始状态全 not-run; releaseReady=false — 未验收就是未验收', () => {
  const led = createAcceptanceLedgerPre()
  const s = led.acceptanceSummaryPre()
  assert.equal(s.releaseReady, false, '初始不可宣称发布就绪')
  assert.equal(s.notRun.length, 7)
  assert.equal(s.passed, 0)
})

t('A3 U1 兼容门: 无实测数据(device/load)标 pass → 强制回落 not-run(不把没测写成已验收)', () => {
  const led = createAcceptanceLedgerPre()
  const r = led.recordAcceptancePre('compat-U1', 'pass', { evidence: '没有测试环境, 但应该没问题', note: '' })
  assert.equal(r.status, 'not-run', 'compat 门强制回落')
  const s = led.acceptanceSummaryPre()
  const item = s.items.find((x) => x.id === 'compat-U1')
  assert.equal(item.status, 'not-run')
  assert.ok(item.note.includes('compat-gate'), '回落原因留痕')
})

t('A4 U1 兼容门: 带实测数据(device+load)可标 pass; 全部 pass ⇒ releaseReady=true', () => {
  const led = createAcceptanceLedgerPre()
  for (const it of ACCEPTANCE_ITEMS_PRE_V1) {
    const ev = it.compatGate ? JSON.stringify({ device: 'ThinkPad T14 (16GB)', load: '500 条记忆 + 连续 50 轮对话' }) : 'smoke 全绿 + 逐项断言'
    led.recordAcceptancePre(it.id, 'pass', { evidence: ev })
  }
  const s = led.acceptanceSummaryPre()
  assert.equal(s.releaseReady, true, '全部必需项 pass 才就绪')
  assert.equal(s.passed, 7)
})

t('A5 任何一项 fail/not-run ⇒ not-ready(逐项可审计)', () => {
  const led = createAcceptanceLedgerPre()
  for (const it of ACCEPTANCE_ITEMS_PRE_V1) led.recordAcceptancePre(it.id, 'pass', { evidence: it.compatGate ? JSON.stringify({ device: 'd', load: 'l' }) : 'e' })
  led.recordAcceptancePre('T6-6', 'fail', { evidence: '回滚使旧状态复活(实测)' })
  const s = led.acceptanceSummaryPre()
  assert.equal(s.releaseReady, false)
  assert.deepEqual(s.failed, ['T6-6'])
  led.recordAcceptancePre('T6-6', 'not-run', {})
  assert.equal(led.acceptanceSummaryPre().releaseReady, false, 'not-run 同样阻塞')
})

t('A6 非法状态名按 not-run 处理并留痕(不静默吞)', () => {
  const led = createAcceptanceLedgerPre()
  const r = led.recordAcceptancePre('T6-1', 'maybe-ok')
  assert.equal(r.status, 'not-run')
  const item = led.acceptanceSummaryPre().items.find((x) => x.id === 'T6-1')
  assert.ok(item.note.includes('invalid-status:maybe-ok'), '非法状态如实记录')
})

t('A7 未知验收项拒绝登记(防清单漂移)', () => {
  const led = createAcceptanceLedgerPre()
  assert.deepEqual(led.recordAcceptancePre('T6-99', 'pass'), { ok: false, reason: 'unknown-item' })
})

t('A8 能力矩阵如实输出: 每项=状态(含 not-run), 不产生「已验收」字样', () => {
  const led = createAcceptanceLedgerPre()
  led.recordAcceptancePre('T6-1', 'pass', { evidence: 'e' })
  led.recordAcceptancePre('T6-5', 'fail', { evidence: 'e' })
  const s = led.acceptanceSummaryPre()
  assert.ok(s.capabilityMatrix.includes('T6-1=pass'))
  assert.ok(s.capabilityMatrix.includes('T6-5=fail'))
  assert.ok(s.capabilityMatrix.includes('compat-U1=not-run'))
  assert.ok(!/已验收/.test(s.capabilityMatrix), '矩阵只报状态, 不宣称验收')
})
