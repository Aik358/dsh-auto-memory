#!/usr/bin/env node
/** [autocont-host] M-CM6-C 宿主兜底自动接续回归(2026-09-08,2.2.6)。
 * 背景:浏览器 AutoContinueHost 被后台节流/关闭时无接续能力;宿主侧新增
 * armAutoContinue / tickAutoContinue / hostAutoContinue / autoContinueState / decideAutoContinue,
 * 由 turn-stopping 测量后 arm + 15s 心跳到期自执行,经 ctx.get('sessionController') 直调官方会话服务。
 *   A1 源码守卫:方法存在;turn-stopping 在 checkWaterLevel 完成后 arm;心跳调 tickAutoContinue;
 *      API 常量/路由注册存在
 *   A2 行为-arm:水位不足不 arm;冷却内不 arm;拒绝窗口内不 arm;已有 armed 不重复;confirmSeconds 生效
 *   A3 行为-tick:未到期不执行;到期执行 hostAutoContinue(单次)
 *   A4 行为-decide:reject 清 armed+记拒绝窗口;agree 立即执行;stale edge 拒绝
 *   A5 行为-执行:成功=create→selectModel→prompt 顺序与入参;sessionController 缺失=ok:false 有 error
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }

function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}

console.log('[autocont-host] A1 源码守卫')
ok(SRC.includes('armAutoContinue(agent, wl) {'), 'armAutoContinue 定义存在')
ok(SRC.includes('async tickAutoContinue() {'), 'tickAutoContinue 定义存在')
ok(SRC.includes('async hostAutoContinue() {'), 'hostAutoContinue 定义存在')
ok(SRC.includes('autoContinueState() {'), 'autoContinueState 定义存在')
ok(SRC.includes('async decideAutoContinue(action, edgeAt) {'), 'decideAutoContinue 定义存在')
ok(/engine\.checkWaterLevel\(agent\)\.then\(function \(\) \{/.test(SRC) && /engine\.armAutoContinue\(agent, \{ ratio: rt2\.waterLevel/.test(SRC),
  'turn-stopping 在 checkWaterLevel 完成后 arm(宿主兜底接线)')
ok(/void engine\.tickAutoContinue\(\)/.test(SRC), '心跳定时器调用 tickAutoContinue')
ok(SRC.includes("'auto-continue-state': '/api/dsh-auto-memory/auto-continue-state'") && SRC.includes("'auto-continue-decide': '/api/dsh-auto-memory/auto-continue-decide'"),
  'API 常量定义存在')
ok(SRC.includes("path: API['auto-continue-state']") && SRC.includes("path: API['auto-continue-decide']"), '路由注册存在')
ok(/ctx\.get\('sessionController'\)/.test(SRC), '经 ctx.get(sessionController) 直调官方会话服务')

console.log('[autocont-host] A2-A5 行为')
function makeEngine(opts) {
  const calls = { create: [], select: [], prompt: [], decided: [] }
  const sc = {
    create: async (r) => { calls.create.push(r); if (opts && opts.createFail) throw new Error('create failed'); return { sessionId: 'session-new-' + calls.create.length } },
    selectModel: async (r) => { calls.select.push(r) },
    prompt: async (r) => { calls.prompt.push(r) },
  }
  const eng = {
    config: (opts && opts.config) || {},
    _autoContState: undefined,
    hasReliableSessionIdentity(agent) { return !!(agent && agent.session && agent.session.id) },
    runtimeFor() { return {} },
    _ctxRef: { get(name) { return name === 'sessionController' ? sc : undefined } },
    _sessionController: undefined,
    async buildContinueCarry() {
      if (opts && opts.carryFail) return { ok: false, error: 'no material' }
      return { ok: true, carryText: 'carry', ws: 'D:\\ws', workspaceId: 'ws-1', provider: 'p', model: 'm', reasoningEffort: 'high', agentPreset: 'code' }
    },
    _sc: sc,
  }
  const fns = {}
  for (const h of ['armAutoContinue(agent, wl) {', 'async tickAutoContinue() {', 'async hostAutoContinue() {', 'autoContinueState() {', 'async decideAutoContinue(action, edgeAt) {']) {
    const obj = new Function('diag', 'AbortSignal', 'return {' + extractFn(h) + '};')(() => {}, { timeout: () => undefined })
    const key = Object.keys(obj)[0]
    fns[key] = obj[key].bind(eng)
  }
  // tick/decide 内部经 this.hostAutoContinue() 互调:全部方法挂回同一对象
  Object.assign(eng, fns)
  return { fns, calls, eng }
}

const agent = { session: { id: 'session-a' } }
const wl = { ratio: 0.8, tokens: 800000, window: 1000000, source: 'official-context' }

// A2 arm 条件
const e1 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true, autoContinueThreshold: 0.75, autoContinueConfirmSeconds: 35, autoContinueCooldownMinutes: 30 } })
e1.fns.armAutoContinue(agent, { ratio: 0.5 })
ok(!e1.eng._autoContState || !e1.eng._autoContState.armed, '水位不足(0.5)不 arm')
e1.fns.armAutoContinue(agent, wl)
ok(e1.eng._autoContState.armed && e1.eng._autoContState.armed.ratio === 0.8, '达标后 arm')
const expires = e1.eng._autoContState.armed.expiresAt
e1.fns.armAutoContinue(agent, wl)
ok(e1.eng._autoContState.armed.expiresAt === expires, '已 armed 不重复建倒计时')
ok(Math.abs((e1.eng._autoContState.armed.expiresAt - Date.now()) - 35000) < 2000, 'confirmSeconds=35 生效(到期 ≈ now+35s)')

const e2 = makeEngine({ config: { autoContinueEnabled: false, handoffEnabled: true } })
e2.fns.armAutoContinue(agent, wl)
ok(!e2.eng._autoContState || !e2.eng._autoContState.armed, 'autoContinueEnabled=false 不 arm')

const e3 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e3.fns.armAutoContinue(agent, wl)
await e3.fns.decideAutoContinue('reject', 0)
e3.fns.armAutoContinue(agent, wl)
ok(!e3.eng._autoContState.armed, '拒绝窗口(10min)内不 arm')

const e4 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e4.eng._autoContState = { lastRunAt: Date.now() }
e4.fns.armAutoContinue(agent, wl)
ok(!e4.eng._autoContState.armed, '冷却期内不 arm')

// A3 tick
const e5 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e5.fns.armAutoContinue(agent, wl)
e5.eng._autoContState.armed.expiresAt = Date.now() + 60000
await e5.fns.tickAutoContinue()
ok(e5.calls.create.length === 0, '未到期 tick 不执行')
e5.eng._autoContState.armed.expiresAt = Date.now() - 1000
await e5.fns.tickAutoContinue()
ok(e5.calls.create.length === 1 && e5.calls.prompt.length === 1, '到期 tick 执行 create+prompt 各一次')
await e5.fns.tickAutoContinue()
ok(e5.calls.create.length === 1, '执行完后 armed 清空,不重复执行')

// A4 decide
const e6 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e6.fns.armAutoContinue(agent, wl)
const edge = e6.eng._autoContState.armed.edgeAt
const rAgree = await e6.fns.decideAutoContinue('agree', edge)
ok(rAgree && rAgree.ok && e6.calls.create.length === 1, 'agree=宿主立即执行')
const e7 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e7.fns.armAutoContinue(agent, wl)
const edge7 = e7.eng._autoContState.armed.edgeAt
const rStale = await e7.fns.decideAutoContinue('agree', edge7 + 1)
ok(rStale && !rStale.ok, 'stale edge 拒绝执行')
const e8 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e8.fns.armAutoContinue(agent, wl)
await e8.fns.decideAutoContinue('reject', 0)
ok(!e8.eng._autoContState.armed && e8.eng._autoContState.rejectedEdgeAt, 'reject 清 armed 且记录拒绝')

// A5 执行细节
const e9 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e9.fns.armAutoContinue(agent, wl)
await e9.fns.hostAutoContinue()
const c = e9.calls.create[0]
ok(c && c.workspaceId === 'ws-1' && c.agentPreset === 'code' && !('cwd' in c), 'create 传 workspaceId+agentPreset(优先工作区绑定)')
ok(e9.calls.select.length === 1 && e9.calls.select[0].provider === 'p' && e9.calls.select[0].model === 'm' && e9.calls.select[0].reasoningEffort === 'high', 'selectModel 沿用 provider/model/思考档位')
ok(e9.calls.prompt.length === 1 && e9.calls.prompt[0].content[0].text === 'carry', 'prompt 注入交接材料')
ok(e9.eng._autoContState.lastOk && e9.eng._autoContState.lastOk.sessionId === 'session-new-1', '执行成功记录 lastOk')

const e10 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true }, createFail: true })
e10.fns.armAutoContinue(agent, wl)
const rFail = await e10.fns.hostAutoContinue()
ok(rFail && !rFail.ok && /create failed/.test(rFail.error), '会话创建失败 → ok:false + 错误信息(不崩)')

const e11 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e11.eng._ctxRef = { get() { return undefined } }
const rNoSc = await e11.fns.hostAutoContinue()
ok(rNoSc && !rNoSc.ok && /sessionController service unavailable/.test(rNoSc.error), 'sessionController 缺失 → 明确报错(旧 host 兼容)')

console.log('\n[autocont-host] ' + pass + '/' + (pass + fail) + ' assertions passed')
if (fail) process.exit(1)