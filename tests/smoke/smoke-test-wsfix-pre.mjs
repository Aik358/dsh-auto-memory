#!/usr/bin/env node
/** [wsfix] 工作区切换修复回归(2026-09-13,终端用户 C 类诊断实证)。
 *
 * 背景:①面板 handoffPanelData 用全局单值 state.*,sessionId 只喂给水位——查看非活跃会话时
 * 白板/账本张冠李戴;②resolvePaths 的无人值守锁**全局**钉死 state.ws,一次定终身,开了
 * unattendedMode 的用户切工作区整个解析被冻结(面板恒主目录、今日日志 0、注入报未绑定)。
 * 修复:F1 resolvePaths 增加 C 类回退(header.cwd 缺失 → workspaceRegistry → 持久化会话头);
 * F2 handoffPanelData 按 sessionId 解析 + wsBound:false 诚实返回;F3 无人值守锁改按会话。
 *
 * 全部经真 apply(ctx) + 真实临时 DSH_HOME 的 handoff-state 端点驱动:
 *   S0 源码守卫
 *   W1-W3 实例1(unattendedMode:true):按会话解析/互不污染/会话内漂移保护保留
 *   W4-W5 C 类回退:registry 命中 / 持久化会话头
 *   W6   身份解析不出 → wsBound:false(不拿启动目录冒充)
 *   W7-W8 无 sessionId 全局兼容 + fileQ 按 会话目录 读
 *   W9-W10 实例2(默认配置):无锁行为不变——其他用户体验零影响
 */
import { apply } from '../../lib/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
process.on('uncaughtException', (e) => { console.error('\n[wsfix] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[wsfix] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('  FAIL -', n) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const root = mkdtempSync(path.join(tmpdir(), 'dam-wsfix-'))
const HOME1 = path.join(root, 'home1')
const HOME2 = path.join(root, 'home2')
const WS_A = 'D:\\wsfix-proj-a'
const WS_B = 'D:\\wsfix-proj-b'
const WS_R = 'D:\\wsfix-registry-ws'
const WS_D = 'D:\\wsfix-disk-ws'
const WS_C2 = 'D:\\wsfix-drifted-ws'
const SID_A = 'session-wsfix-a'
const SID_B = 'session-wsfix-b'
const SID_C = 'session-wsfix-c'
const SID_D = 'session-wsfix-d'
const SID_E = 'session-wsfix-e'

function mkHome(home, unattended) {
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory-pre.json'), JSON.stringify({
    memoryRoot: path.join(root, path.basename(home), '.memory-root'),
    userMemoryDir: path.join(root, path.basename(home), '.user-root'),
    projectMemoryDir: '.project-memory',
    handoffEnabled: true,
    externalSources: {},
    ...(unattended ? { unattendedMode: true } : {}),
  }), 'utf8')
}
mkHome(HOME1, true)

// SID_D 的持久化会话头(首行 cwd)——registry 查不到时的磁盘回退源
const SID_D_DIR = path.join(HOME1, 'sessions', 'wsD', SID_D)
mkdirSync(SID_D_DIR, { recursive: true })
writeFileSync(path.join(SID_D_DIR, 'session.jsonl'), JSON.stringify({ agentPreset: 'default', cwd: WS_D }) + '\n', 'utf8')

let agents = {}
let registryList = []
function makeCtx(routes, handlers, effects) {
  return {
    get(name) {
      if (name === 'agents') return { get: (id) => agents[id] || null }
      if (name === 'workspaceRegistry') return { list: () => registryList }
      return undefined
    },
    on(ev, fn) { handlers[ev] = fn; return () => {} },
    effect(fn) { effects.push(fn); return () => {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register() { return () => {} } },
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
}
function makeCaller(routes) {
  return async (p) => {
    let body = null
    const route = routes.find((r) => r.path === '/api/dsh-auto-memory-pre/handoff-state')
    if (!route) throw new Error('route not registered')
    await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: p }, { writeHead() {}, end(b) { body = JSON.parse(b) } })
    return body
  }
}

console.log('[wsfix] S0 源码守卫')
{
  const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(/if \(sid\) \{\s*\n\s*const rt = this\.runtimeFor\(agent\)\s*\n\s*if \(rt\) \{\s*\n\s*if \(rt\.wsLocked\)/.test(SRC),
    '无人值守锁按会话(rt.wsLocked),不再全局钉死 state.ws')
  ok(/if \(!ws && sid\) \{\s*\n\s*const fb = await this\.sessionWorkspaceFallback\(sid\)/.test(SRC),
    'C 类回退:header.cwd 缺失时按会话身份解析(registry → 持久化头)')
  ok(/wsBound: false, plan: '', planPath: '', planMtime: 0/.test(SRC),
    'handoffPanelData 未绑定时诚实返回 wsBound:false,不拿启动目录冒充')
  ok(/ws: p\.ws \|\| '', wsBound,/.test(SRC), 'handoff-state 响应携带 ws/wsBound')
}

console.log('[wsfix] 实例1 · unattendedMode=true(复现用户的配置)')
process.env.DSH_HOME = HOME1
const routes1 = [], handlers1 = {}, effects1 = []
apply(makeCtx(routes1, handlers1, effects1), {})
const call1 = makeCaller(routes1)
const AG = 'agents'
void AG
agents[SID_A] = { session: { id: SID_A, header: { cwd: WS_A } } }
agents[SID_B] = { session: { id: SID_B, header: { cwd: WS_B } } }
agents[SID_C] = { session: { id: SID_C } }
agents[SID_E] = { session: { id: SID_E } }
registryList = [{ id: 'ws-r', path: WS_R, sessionIds: [SID_C] }]

const rA = await call1('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_A)
ok(rA && rA.ws === WS_A && rA.wsBound === true, 'W1 会话 A 解析到 A 的工作区(wsBound=true)')
const rB = await call1('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_B)
ok(rB && rB.ws === WS_B && rB.wsBound === true, 'W2 会话 B 解析到 B 的工作区(修复前恒为 A/启动目录)')
ok(rA.planPath !== rB.planPath && rA.planPath.includes('--D--wsfix-proj-a--') && rB.planPath.includes('--D--wsfix-proj-b--'),
  'W2b 白板/账本路径按会话分目录(不再全局单值)')
agents[SID_A].session.header.cwd = WS_C2
const rA2 = await call1('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_A)
ok(rA2 && rA2.ws === WS_A, 'W3 会话内 cwd 漂移仍被锁保护(无人值守设计本意保留)')

console.log('[wsfix] C 类回退(header.cwd 缺失)')
const rC = await call1('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_C)
ok(rC && rC.ws === WS_R && rC.wsBound === true, 'W4 registry 反查命中:workspaceId 创建的会话解析到绑定工作区')
const rD = await call1('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_D)
ok(rD && rD.ws === WS_D && rD.wsBound === true, 'W5 持久化会话头回退:磁盘首行 cwd 生效')
const rE = await call1('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_E)
ok(rE && rE.wsBound === false && rE.plan === '' && rE.planPath === '', 'W6 身份解析不出 → wsBound:false,不冒充')
ok(rE && rE.enabled === true && rE.waterLevel !== undefined, 'W6b 未绑定时水位照常返回(本就按会话取数)')

console.log('[wsfix] 全局兼容 + fileQ')
const rG = await call1('/api/dsh-auto-memory-pre/handoff-state')
ok(rG && rG.enabled === true && typeof rG.planPath === 'string' && rG.wsBound !== false,
  'W7 无 sessionId 全局路径保持兼容(旧调用方)')
mkdirSync(path.join(rA.planPath, '..'), { recursive: true })
writeFileSync(rA.planPath, '# 白板 A\n', 'utf8')
const rF = await call1('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_A + '&file=PLAN.md')
ok(rF && rF.text === '# 白板 A\n', 'W8 fileQ 按会话目录读取(写入 A 的白板从 A 的会话读回)')

console.log('[wsfix] 实例2 · 默认配置(unattendedMode 关,其他用户体验零影响)')
mkHome(HOME2, false)
process.env.DSH_HOME = HOME2
const routes2 = [], handlers2 = {}, effects2 = []
apply(makeCtx(routes2, handlers2, effects2), {})
const call2 = makeCaller(routes2)
const r2A = await call2('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_A)
ok(r2A && r2A.ws === WS_C2 && r2A.wsBound === true, 'W9 默认配置:会话工作区跟随当前 cwd(无锁)')
agents[SID_A].session.header.cwd = WS_B
const r2A2 = await call2('/api/dsh-auto-memory-pre/handoff-state?sessionId=' + SID_A)
ok(r2A2 && r2A2.ws === WS_B, 'W10 默认配置:cwd 变化即跟随(不存在隐藏的全局钉死)')

for (const d of [...effects1, ...effects2]) { try { if (typeof d === 'function') d() } catch (e) {} }
console.log('\n[wsfix] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
