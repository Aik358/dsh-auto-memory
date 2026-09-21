/**
 * L1/L2 验收(2026-09-17) —— 「渲染不该被产物开关拦住」的行为断言。
 *
 * 权威依据: docs/internal/BATTLE-PLAN-20260917.md §1 判据 + §2 L1
 *           docs/internal/ROADMAP-20260917-WEEK.md §3.6.1(终端用户报障)
 *
 * 为什么必须单独存在:
 *   终端用户实测报障「白板看板现在是空的, 说未启用或加载失败, 但实际上它已经启用了」。
 *   根因是两处叠加: ① kanbanBoardData 首行被 handoffEnabled 拦住(渲染耦合产物开关)
 *                  ② 前端丢弃后端已返回的 reason, 硬编码一句猜测式提示。
 *   既有回归**全跑 handoffEnabled:true** ⇒ 缺陷 ① 一行不执行, 属"结构性假绿"。
 *   本套件把 handoffEnabled 置 false, **走真实路由 handler**, 断言看板仍 enabled:true。
 *
 * ★ 断言形态: 走 apply(ctx) 注册的真路由 → 调 handler → 读回 JSON。
 *   不是源码正则守卫 —— 源码守卫只能证明"代码长这样", 证明不了"行为是这样"。
 */
import { apply, API } from '../../lib/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
process.on('uncaughtException', (e) => { console.error('\n[L1-FATAL] uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[L1-FATAL] unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

let pass = 0, fail = 0
const pending = []
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)) }
}
const ta = (name, fn) => {
  const p = (async () => {
    try { await fn(); pass++; console.log('  ok - ' + name) }
    catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)) }
  })()
  pending.push(p)
  return p
}
const assert = (c, m) => { if (!c) throw new Error(m) }

/** boot 一个真 apply 的实例; cfg 覆盖写进配置文件。 */
function bootPre(cfg) {
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-l1-'))
  const home = path.join(ws, '.dsh-home')
  mkdirSync(home, { recursive: true })
  const memRoot = path.join(ws, '.memory-root')
  writeFileSync(path.join(home, 'dsh-auto-memory-pre.json'), JSON.stringify(Object.assign({
    memoryRoot: memRoot,
    userMemoryDir: path.join(ws, '.user-root'),
    projectMemoryDir: '.project-memory',
    externalSources: {},
  }, cfg)), 'utf8')
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const tools = [], routes = [], sections = [], contexts = [], effects = [], disposers = []
  const ctx = {
    get() { return undefined },
    on() { return () => {} },
    effect(fn, label) { effects.push(label); if (typeof fn === 'function') disposers.push(fn); return () => {} },
    systemPrompt: {
      section(s) { sections.push(s); return () => {} },
      context(c) { contexts.push(c); return () => {} },
    },
    tools: { register(d) { tools.push(d); return () => {} } },
    webServer: { register(r) { routes.push(r); return () => {} } },
  }
  apply(ctx, {})
  return { ws, home, memRoot, tools, routes, sections, contexts, effects, disposers, prevHome }
}
const cleanup = (b) => {
  for (const d of b.disposers || []) { try { d() } catch (_) {} }
  if (b.prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = b.prevHome
  try { rmSync(b.ws, { recursive: true, force: true }) } catch (_) {}
}

/** 造一个 loopback GET req(isLoopbackRequest 只读 socket/headers)。 */
function loopbackReq(url) {
  return {
    url,
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
  }
}
/** 捕获 writeJson 的输出。 */
function captureRes() {
  const out = { status: 0, body: null }
  return {
    out,
    writeHead(status) { out.status = status },
    end(payload) { try { out.body = JSON.parse(payload) } catch (_) { out.body = payload } },
    setHeader() {}, write() {},
  }
}
/** 调某条路由的 handler, 返回解析后的 JSON。 */
async function callRoute(b, routePath, url) {
  const r = b.routes.find((x) => x.path === routePath)
  assert(r, '路由未注册: ' + routePath)
  const res = captureRes()
  await r.handler(loopbackReq(url || routePath), res)
  return res.out
}

const b1 = bootPre({ boardMode: 'graph', handoffEnabled: false })
const b2 = bootPre({ boardMode: 'legacy', handoffEnabled: true })
const b3 = bootPre({ boardMode: 'graph', handoffEnabled: true })

console.log('=== L1/L2 渲染解耦 + reason 消费 ===')

// ─────────────────────────────────────────────────────────────
// L1a: 看板渲染**不再**依赖 handoffEnabled  ← 用户报障的核心断言
// ─────────────────────────────────────────────────────────────
await ta('L1a-1 ★ handoffEnabled=false + boardMode=graph ⇒ 看板仍 enabled:true(旧实现返回 handoff-disabled)', async () => {
  const r = await callRoute(b1, API['kanban-board'])
  assert(r.status === 200, 'HTTP 应 200, 实为 ' + r.status)
  assert(r.body && r.body.enabled === true,
    '关掉白板产物后看板仍须渲染(渲染不归 handoffEnabled 管); 实得 ' + JSON.stringify(r.body))
  assert(r.body.reason !== 'handoff-disabled',
    '不得再以 handoff-disabled 拒绝渲染')
})

await ta('L1a-2 handoffEnabled=false 时**数据仍在**: 返回完整 lanes/matrix 形状(不是空壳)', async () => {
  const r = await callRoute(b1, API['kanban-board'])
  assert('matrix' in r.body, '必须带 matrix(前端矩阵视图依赖它)')
  assert(r.body.wsBound === false || Array.isArray(r.body.lanes) || r.body.lanes == null,
    'lanes 形状合法')
  assert(r.body.boardMode === 'graph', 'boardMode 回显 graph')
})

await ta('L1a-3 回归面: legacy 档**仍**返回 legacy-mode(不许把 boardMode 门一起删掉)', async () => {
  const r = await callRoute(b2, API['kanban-board'])
  assert(r.body.enabled === false, 'legacy 档必须不启用看板')
  assert(r.body.reason === 'legacy-mode',
    'legacy 档 reason 必须是 legacy-mode(前端据此提示切换); 实得 ' + r.body.reason)
})

await ta('L1a-4 回归面: graph + handoff 开 ⇒ 照常 enabled:true(没改坏原路径)', async () => {
  const r = await callRoute(b3, API['kanban-board'])
  assert(r.body.enabled === true, 'graph+handoff 开应 enabled:true')
})

// ─────────────────────────────────────────────────────────────
// L1b: 白板面板同病同修, 且**补上了 reason**
// ─────────────────────────────────────────────────────────────
await ta('L1b-1 ★ handoffEnabled=false ⇒ 白板面板不再返回裸 {enabled:false}, 而是带 reason', async () => {
  const r = await callRoute(b1, API['handoff-state'])
  assert(r.status === 200, 'HTTP 应 200')
  assert(r.body && r.body.enabled !== undefined, '应有 enabled 字段')
  if (r.body.enabled === false) {
    assert(typeof r.body.reason === 'string' && r.body.reason.length > 0,
      '★ 旧实现 return {enabled:false} **连 reason 都不给**, 前端只能猜; 现必须带 reason')
  }
})

await ta('L1b-2 legacy 档白板面板 reason=legacy-mode(可被前端分支)', async () => {
  const r = await callRoute(b2, API['handoff-state'])
  assert(r.body.enabled === false, 'legacy 档面板应 enabled:false')
  assert(r.body.reason === 'legacy-mode', 'reason 应为 legacy-mode; 实得 ' + r.body.reason)
})

// ─────────────────────────────────────────────────────────────
// L2: 前端消费 reason(源码守卫 —— 前端是浏览器侧 bundle, 无 DOM 无法行为测)
//     守卫目标: 「硬编码猜测式提示」必须已消失, 且 reason 分支必须存在
// ─────────────────────────────────────────────────────────────
const src = (await import('node:fs')).readFileSync('lib/client.js', 'utf8')

t('L2-1 ★ 误导性硬编码提示已删除(不再出现「需 boardMode=graph 且 handoff 已开启」)', () => {
  assert(!/需 boardMode=graph 且 handoff 已开启/.test(src),
    '该措辞把用户指向错误方向(用户实测报障), 必须删除')
})

t('L2-2 前端按 reason 分支: legacy-mode / error 两条分支都在场', () => {
  assert(/'legacy-mode'/.test(src), '必须按 legacy-mode 分支给「去切新版看板」提示')
  assert(/reason === 'error'|r === 'error'/.test(src), '必须按 error 分支把 error.message 显示出来')
  assert(/Board load error|看板加载出错/.test(src), '错误分支要有人话文案')
})

t('L2-3 ★ 前端**保留**原始载荷(旧实现 setData(k && k.enabled ? k : null) 把 reason 丢了)', () => {
  assert(/setPay\(/.test(src), '必须另存原始载荷才能读 reason')
  assert(!/setData\(k && k\.enabled \? k : null\)\s*\n/.test(src) || /setPay/.test(src),
    '原丢弃式写法必须已被 setPay 取代')
})

t('L2-4 面板侧同样按 reason 分支(不一律显示「白板未启用」)', () => {
  assert(/disMsg/.test(src), '面板禁用分支应有 disMsg 变量按 reason 分派')
  assert(!/if \(!data\.enabled\) return h\('div', null, \[switchCard, h\(Card[^\n]*t\('planDisabled'\)\)\]\)/.test(src),
    '面板旧的一行式硬编码 planDisabled 必须已被 reason 分支取代')
})

t('L2-5 文案里给出了**可操作**出口(告诉用户去哪切/点刷新), 而非只报症状', () => {
  assert(/设置 → 自动记忆引擎|Settings → Auto Memory Engine/.test(src), 'legacy 分支须给出设置路径')
  assert(/刷新|reload/.test(src), '兜底分支须提示刷新动作')
})

await Promise.all(pending)
const total = pass + fail
console.log('[l1-render-decouple] ' + pass + ' passed, ' + fail + ' failed (共 ' + total + ')')
cleanup(b1); cleanup(b2); cleanup(b3)
if (fail) process.exit(1)
