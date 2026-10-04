/** ★2026-10-05 工作台新建熔断行为级守卫（配套路径归一修复，见 smoke-test-workbench-canon.mjs）。
 *  背景：Android 真机实证 —— 「校验失败 + consentGranted 已持久化 ⇒ 新建」对任何不能自愈的
 *  失败原因都会无限堆「记忆中枢」会话（16 个）。修复 = 同 (epoch, 失败原因) 连续 3 次
 *  verify-after-create 失败即停新建，只回报 needPrompt；原因或期号一变即重新计数。
 *
 *  本套件用真 MemoryEngine + 桩服务（verify 恒败同因 / agents.create 计数）验证：
 *  ① 未经同意绝不新建（D9-B 既有不变式，防熔断改动误伤同意门）；
 *  ② 同因连败：第 1–3 次允许新建（给自愈机会），第 4 次熔断（不再 create）；
 *  ③ 换失败原因 ⇒ 熔断重计（不会把无关原因的新建立需求一起拦死）；
 *  ④ 熔断后返回仍带 needPrompt（UI 可见原因码，不是静默失踪）。 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MemoryEngine } from '../lib/audit-engine.mjs'

let P = 0, F = 0
const ck = (name, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '  ' + String(detail || '')))
  ok ? P++ : F++
}

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-breaker-')))
try {
  process.env.DSH_HOME = path.join(tmp, '.dsh')
  fs.mkdirSync(process.env.DSH_HOME, { recursive: true })

  const mkEngine = (failReason) => {
    const eng = new MemoryEngine()
    eng.configLoaded = true
    eng.config.workbenchEnabled = true
    let creates = 0
    eng._ctxRef = {
      get: (k) => (k === 'agents'
        ? { create: async () => { creates++; return { agent: { session: { id: 'fake-' + creates, header: { cwd: path.join(tmp, '.dsh', 'aik_auto_memory_use') } } } } } }
        : null),
    }
    eng._workspaceRegistry = { list: () => [], create: async () => ({ id: 'ws-x' }) }
    eng._verifyWorkbench = async () => ({ ok: false, reason: failReason, sessionId: 'stub' })
    return { eng, getCreates: () => creates }
  }

  console.log('\n══ ① 未经同意绝不新建（既有 D9-B 不变式不被熔断改动误伤）══')
  {
    const { eng, getCreates } = mkEngine('permission-mismatch')
    const r = await eng.ensureWorkbench() // 无 consent ⇒ 惰性门控路径
    ck('无同意 ⇒ needPrompt 且零新建', r && r.needPrompt === true && getCreates() === 0, JSON.stringify(r))
    ck('无同意 ⇒ 不计入熔断（streak 未建）', !eng._wbCreateFailStreak)
  }

  console.log('\n══ ② 同因连败：3 次放行、第 4 次熔断 ══')
  {
    const { eng, getCreates } = mkEngine('permission-mismatch')
    const r1 = await eng.ensureWorkbench({ consent: true })
    const r2 = await eng.ensureWorkbench({ consent: true })
    const r3 = await eng.ensureWorkbench({ consent: true })
    ck('前 3 次各自新建（streak 1→3）', getCreates() === 3, 'creates=' + getCreates())
    ck('前 3 次不熔断', r1.breaker !== true && r2.breaker !== true && r3.breaker !== true)
    ck('streak 落到 3', eng._wbCreateFailStreak && eng._wbCreateFailStreak.count === 3, JSON.stringify(eng._wbCreateFailStreak))
    const r4 = await eng.ensureWorkbench({ consent: true })
    ck('第 4 次熔断：不再新建', getCreates() === 3, 'creates=' + getCreates())
    ck('第 4 次返回 breaker 标记 + needPrompt（UI 可见，非静默）',
      r4 && r4.breaker === true && r4.needPrompt === true, JSON.stringify(r4))
    ck('熔断原因码保留原始原因（前端文案不失明）', String(r4 && r4.reason) === 'permission-mismatch')
    const r5 = await eng.ensureWorkbench({ consent: true })
    ck('第 5 次仍熔断（不随重试复位）', getCreates() === 3 && r5.breaker === true)
  }

  console.log('\n══ ③ 换失败原因 ⇒ 重新计数（不误伤新原因的自愈窗口）══')
  {
    let reason = 'permission-mismatch'
    const eng = new MemoryEngine()
    eng.configLoaded = true
    eng.config.workbenchEnabled = true
    let creates = 0
    eng._ctxRef = { get: (k) => (k === 'agents' ? { create: async () => { creates++; return { agent: { session: { id: 'f' + creates, header: { cwd: 'x' } } } } } } : null) }
    eng._workspaceRegistry = { list: () => [], create: async () => ({ id: 'ws-x' }) }
    eng._verifyWorkbench = async () => ({ ok: false, reason, sessionId: 'stub' })
    await eng.ensureWorkbench({ consent: true })
    await eng.ensureWorkbench({ consent: true })
    await eng.ensureWorkbench({ consent: true })
    ck('同因 3 连败后进入熔断', creates === 3)
    const rA = await eng.ensureWorkbench({ consent: true })
    ck('第 4 次（同因）熔断', rA.breaker === true && creates === 3)
    reason = 'cwd-mismatch' // 环境变了（如归一修复上线）⇒ 新原因给新的自愈窗口
    const rB = await eng.ensureWorkbench({ consent: true })
    ck('新原因放行新建（streak 重计）', rB.breaker !== true && creates === 4, 'creates=' + creates)
    ck('streak 键已切到新原因', eng._wbCreateFailStreak && eng._wbCreateFailStreak.key.indexOf('cwd-mismatch') >= 0, JSON.stringify(eng._wbCreateFailStreak))
  }

  console.log('\n══ ④ 建立成功 ⇒ 熔断清零（成功路径不受历史失败影响）══')
  {
    // 桩模式：入口 verify 败（进新建分支）+ 建后 verify 过（v2 成功）——同一 stub 按「奇数次=入口、偶数次=建后」区分。
    // 直接让 verify 恒 ok 会走**复用分支**，到不了新建成功路径（熔断清零点在新建路径上）。
    let mode = 'always-fail' // 'always-fail' | 'entry-fail-create-ok' | 'always-fail-again'
    let verifyCalls = 0
    const eng = new MemoryEngine()
    eng.configLoaded = true
    eng.config.workbenchEnabled = true
    let creates = 0
    eng._ctxRef = { get: (k) => (k === 'agents' ? { create: async () => { creates++; return { agent: { session: { id: 'f' + creates, header: { cwd: 'x' } } } } } } : null) }
    eng._workspaceRegistry = { list: () => [], create: async () => ({ id: 'ws-x' }) }
    eng._verifyWorkbench = async () => {
      verifyCalls++
      const okResult = { ok: true, reason: 'ok', sessionId: 'stub' }
      const failResult = { ok: false, reason: 'permission-mismatch', sessionId: 'stub' }
      if (mode === 'always-fail') return failResult
      if (mode === 'always-fail-again') return failResult
      return verifyCalls % 2 === 1 ? failResult : okResult // 入口败、建后过
    }
    await eng.ensureWorkbench({ consent: true })
    await eng.ensureWorkbench({ consent: true })
    ck('铺垫：同因 2 连败（streak=2）', eng._wbCreateFailStreak && eng._wbCreateFailStreak.count === 2, JSON.stringify(eng._wbCreateFailStreak))
    mode = 'entry-fail-create-ok'
    const rOk = await eng.ensureWorkbench({ consent: true })
    ck('建后校验通过 ⇒ ok 且熔断态清空', rOk && rOk.ok === true && eng._wbCreateFailStreak === null, 'r=' + JSON.stringify(rOk) + ' streak=' + JSON.stringify(eng._wbCreateFailStreak))
    mode = 'always-fail-again'
    await eng.ensureWorkbench({ consent: true })
    ck('成功后再失败从 1 重计（不继承历史 2 连败）', eng._wbCreateFailStreak && eng._wbCreateFailStreak.count === 1, JSON.stringify(eng._wbCreateFailStreak))
  }

  console.log('\nPASS ' + P + ' / FAIL ' + F)
  process.exit(F ? 1 : 0)
} finally {
  delete process.env.DSH_HOME
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}
