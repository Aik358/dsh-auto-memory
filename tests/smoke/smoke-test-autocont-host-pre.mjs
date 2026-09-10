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
ok(SRC.includes('armAutoContinue(agent, wl, opts = null) {'), 'armAutoContinue 定义存在')
// 2.2.7:pre-step 水位测量后同样 arm(否则长回合里官方压缩抢先、接续永不触发)
ok(/checkWaterLevelAtStep\(agent, minGapMs = 0\)[\s\S]{0,900}?this\.armAutoContinue\(agent, \{ ratio: rt2\.waterLevel[\s\S]{0,220}?awaitIdle: true/.test(SRC),
  'pre-step 测量后 arm 自动接续(awaitIdle 标记,避免打断进行中回合;默认不节流)')
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
    _ctxRef: {
      get(name) {
        if (name === 'sessionController') return sc
        // 2026-09-10:权限继承(permissionPresets + agents)按需注入,便于断言继承行为
        if (name === 'permissionPresets') return (opts && opts.pp) || undefined
        if (name === 'agents') return (opts && opts.agents) || undefined
        return undefined
      },
    },
    _sessionController: undefined,
    async buildContinueCarry(preferSid) {
      calls.carrySid = String(preferSid || '')
      if (opts && opts.carryFail) return { ok: false, error: 'no material' }
      return { ok: true, carryText: 'carry', ws: 'D:\\ws', workspaceId: 'ws-1', provider: 'p', model: 'm', reasoningEffort: 'high', agentPreset: 'code' }
    },
    _sc: sc,
    // 2026-09-10:刷新仪式依赖「材料指纹」与仪式文案;真实实现走文件 IO(path/stat/readdir),
    // 夹具给出替身:默认每次调用都变(模拟旧会话已产出新白板/账本),轮询间隔调小以免拖慢用例。
    handoffMaterialStamp: (() => { let n = 0; return async () => ((opts && opts.stamp) ? opts.stamp() : 'stamp-' + (++n)) })(),
    refreshRitualPrompt: () => 'ritual-prompt',
    _ritualPollMs: 5,
  }
  const fns = {}
  // 2026-09-10:hostAutoContinue 现在会调 this.inheritPermissionPreset / hostRefreshRitual 继承权限与刷材料,
  // 夹具是"从源码抽方法拼假 engine",新增的被调方法必须一并抽取,否则 this 上不存在(TypeError)。
  for (const h of ['armAutoContinue(agent, wl, opts = null) {', 'async tickAutoContinue() {', 'async hostAutoContinue() {', 'autoContinueState() {', 'async decideAutoContinue(action, edgeAt) {', 'async inheritPermissionPreset(oldAgent, newSid, opts = {}) {', 'agentForSessionId(sid) {', 'async inheritPermissionForContinue(fromSessionId, toSessionId, opts = {}) {', 'async hostRefreshRitual(oldSid) {']) {
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

// A3 tick(本条只验 tick→执行链;刷新仪式由 A7 覆盖,故此处关掉以免 prompt 计数被仪式占一位)
const e5 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true, autoContinueRefreshRitual: false } })
e5.fns.armAutoContinue(agent, wl)
e5.eng._autoContState.armed.expiresAt = Date.now() + 60000
await e5.fns.tickAutoContinue()
ok(e5.calls.create.length === 0, '未到期 tick 不执行')
e5.eng._autoContState.armed.expiresAt = Date.now() - 1000
await e5.fns.tickAutoContinue()
ok(e5.calls.create.length === 1 && e5.calls.prompt.length === 1, '到期 tick 执行 create+prompt 各一次')
// 0.1.5 回归:SessionPromptRequest.requestId 为必填(客户端铸造的用户消息身份)。缺失时官方在
// createUserMessage 处抛普通 Error 并包成误导性的 session/agent-busy "prompt rejected",
// 表现为「建出空会话、交接材料从未送达」。锁死该字段,防止再次退化成不传。
ok(typeof e5.calls.prompt[0].requestId === 'string' && e5.calls.prompt[0].requestId.length >= 16,
  'prompt 携带非空 requestId(0.1.5 必填字段)')
ok(e5.calls.prompt[0].sessionId === 'session-new-1', 'prompt 目标会话取自 create 结果(session-new-1)')
ok(e5.calls.prompt[0].mode === 'queue' && Array.isArray(e5.calls.prompt[0].content) && e5.calls.prompt[0].content.length > 0,
  'prompt mode=queue 且 content 非空')
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
const e9 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true, autoContinueRefreshRitual: false } })
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

// A6 权限继承(2026-09-10):官方 session.create 不收权限参数 → 新会话必落 settings 的
// permission.defaultPreset,接续出来的新会话因此丢掉旧会话的完全权限(实机:静默运行被打断)。
// 现按旧会话 current(session) → 新会话 set(session, preset) 继承;服务/对象缺失一律 fail-soft。
const e12 = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true } })
e12.eng._lastAgent = { session: { id: 'session-a' } }
e12.fns.armAutoContinue(agent, wl)
const r12 = await e12.fns.hostAutoContinue()
ok(r12 && r12.ok && e12.eng._autoContState.lastOk.permissionPreset === '',
  '无 permissionPresets 服务时接续照常成功(fail-soft,不记预设)')

const ppCalls = []
const e13 = makeEngine({
  config: { autoContinueEnabled: true, handoffEnabled: true },
  pp: {
    current(s) { return s && s.id === 'session-a' ? 'danger-full-access' : '' },
    set(s, n) { ppCalls.push({ sid: s && s.id, preset: n }) },
  },
  agents: { get(id) { return id === 'session-new-1' ? { session: { id: 'session-new-1' } } : null } },
})
e13.eng._lastAgent = { session: { id: 'session-a' } }
e13.fns.armAutoContinue(agent, wl)
const r13 = await e13.fns.hostAutoContinue()
ok(ppCalls.length === 1 && ppCalls[0].sid === 'session-new-1' && ppCalls[0].preset === 'danger-full-access',
  '继承旧会话权限预设到新会话(current → set,目标为新会话)')
ok(r13 && r13.ok && e13.eng._autoContState.lastOk.permissionPreset === 'danger-full-access',
  'lastOk 记录继承到的预设')

// A7 刷新仪式(2026-09-10):宿主兜底接续原先完全不做刷新仪式 —— 浏览器关着时旧会话收不到
// 「刷白板+写账本」的指令,新会话拿到的材料停在旧版(实机:旧会话接续前后零写入)。
// 现补齐:先给旧会话发仪式指令(等材料指纹变化或超时),再给新会话投交接材料;
// 只在 armed.sessionId 明确时注入,同一旧会话 10 分钟内只注入一次。
const mkStamp = () => { let n = 0; return () => 'stamp-' + (++n) }
const eR = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true }, stamp: mkStamp() })
eR.fns.armAutoContinue(agent, wl)
const rRit = await eR.fns.hostAutoContinue()
ok(eR.calls.prompt.length === 2, '宿主接续产生 2 条 prompt(先仪式后材料)')
ok(eR.calls.prompt[0] && eR.calls.prompt[0].sessionId === 'session-a' && eR.calls.prompt[0].content[0].text === 'ritual-prompt',
  '第 1 条 prompt 是发给旧会话(session-a)的刷新仪式')
ok(eR.calls.prompt[1] && eR.calls.prompt[1].sessionId === 'session-new-1' && eR.calls.prompt[1].content[0].text === 'carry',
  '第 2 条 prompt 才是新会话的交接材料(顺序:先刷新后材料)')
ok(rRit && rRit.ok && rRit.refreshRitual === 'updated' && eR.eng._autoContState.lastOk.refreshRitual === 'updated',
  '材料指纹变化 → waited=updated,并记录到 lastOk')

const eOff = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true, autoContinueRefreshRitual: false }, stamp: mkStamp() })
eOff.fns.armAutoContinue(agent, wl)
const rOff = await eOff.fns.hostAutoContinue()
ok(eOff.calls.prompt.length === 1 && eOff.calls.prompt[0].sessionId === 'session-new-1' && rOff && rOff.refreshRitual === 'disabled',
  'autoContinueRefreshRitual=false → 不注入仪式,只发交接材料')

const eDup = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true }, stamp: mkStamp() })
eDup.eng._autoContState = { ritualForSid: 'session-a', ritualAt: Date.now() }
const rDup = await eDup.fns.hostRefreshRitual('session-a')
ok(rDup && !rDup.ok && rDup.reason === 'already-sent', '同一旧会话 10 分钟内只注入一次仪式(失败重试不刷屏)')
const rNoSid = await eDup.fns.hostRefreshRitual('')
ok(rNoSid && !rNoSid.ok && rNoSid.reason === 'no-old-session', '无旧会话 id → 不注入(绝不猜会话)')

// A8 材料来源会话(2026-09-10 实机取证):旧实现 buildPrevSessionPack() 只认 this._lastAgent(最近活跃的
// agent),而自动接续的旧会话是 armed.sessionId —— 二者可以不是同一个会话。实测 14:54:30:armed=de10b34f,
// 却把 1f621132 的转写与 provider/model/effort 当成接续材料(新会话还会被 selectModel 套错模型)。
const CLIENT = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
const eSid = makeEngine({ config: { autoContinueEnabled: true, handoffEnabled: true, autoContinueRefreshRitual: false } })
eSid.fns.armAutoContinue(agent, wl)
const rSid = await eSid.fns.hostAutoContinue()
ok(eSid.calls.carrySid === 'session-a', '宿主接续把 armed 的旧会话 id 传进材料构造(不再靠最近活跃 agent 猜)')
ok(rSid && rSid.ok, '带旧会话 id 时宿主接续仍成功')
ok(SRC.includes('async buildPrevSessionPack(preferSid) {') && SRC.includes('async buildContinueCarry(preferSid) {'),
  '材料包构造/材料组装都接受显式旧会话 id')
ok(/if \(want\) cands\.push\(want\)[\s\S]{0,160}?if \(lastSid && lastSid !== want\) cands\.push\(lastSid\)/.test(SRC),
  '显式旧会话优先,_lastAgent 仅作回退')
ok(/const d = await this\.buildContinueCarry\(oldSid\)/.test(SRC), 'hostAutoContinue 用 armed.sessionId 构造材料')
ok(/engine\.buildContinueCarry\(\(body && body\.fromSessionId\) \|\| ''\)/.test(SRC), 'handoff-continue 端点接受 fromSessionId')
ok(/apiPost\(API\.handoffContinue, fromSidForCarry \? \{ fromSessionId: fromSidForCarry \} : \{\}\)/.test(CLIENT),
  'client 一键接续把来源会话 id 传给端点')

console.log('\n[autocont-host] ' + pass + '/' + (pass + fail) + ' assertions passed')
if (fail) process.exit(1)