#!/usr/bin/env node
/** [issue135-water-cold] 水位卡「按会话取数」回归（2026-09-23，终端用户实证：两台 Windows 恒显示
 *  「0 / 1,000,000 token · 本会话尚未测量」，发过轮次也不更新）。issue #135。
 *
 * 纯 Node、零依赖、不联网。真 apply(ctx) + 真临时 DSH_HOME + 真会话日志（zstd 与未压缩两式），
 * 只经路由/事件入口驱动，断言的是用户看到的那张卡的字段本身。
 *
 * 锁定的口径：
 *   W1 冷会话（磁盘有日志、宿主里没有活 agent）→ 分母照实推导，分子**必须**保持 0 且不得标 stale。
 *      真机取证：DSH 会话日志里**没有 usage 事件**，而头帧解码（32 帧）只覆盖 60/1088 行 ⇒
 *      从磁盘日志推分子必然给出一个伪装成实测的错数（差 1~2 个数量级）。宁可明说未测量。
 *   W1b 未压缩会话日志 → 分母同样要推对（旧实现无条件走 zstd 解码 ⇒ 静默降级 131072）。
 *   W2 本进程测过的会话 → 实测值照常返回（既有行为守卫）。
 *   W3 实测过但闲置超过 10 分钟 → **保留最后实测值并标 stale**，不得整卡退回「尚未测量」。
 *   W3b 陈旧到 7 小时 → 按无记录处理（陈旧值只会偏高：期间官方压缩可能已压过上下文）。
 *   W4 会话在宿主 agents 注册表里活着、但本进程没测过 → 按 checkWaterLevel 同口径现场算一次分子。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../lib/index.js'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { zstdCompressSync } from 'node:zlib'

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const root = mkdtempSync(path.join(tmpdir(), 'dam-water-cold-'))
const home = path.join(root, '.dsh-home')
mkdirSync(home, { recursive: true })
writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(root, '.memory-root'),
  userMemoryDir: path.join(root, '.user-root'),
  projectMemoryDir: '.project-memory',
  handoffEnabled: true,
  waterLevelWindowTokens: 0,
  externalSources: {},
}), 'utf8')
process.env.DSH_HOME = home

const WS = path.join(root, 'xp-deploy')
mkdirSync(WS, { recursive: true })
const SID_COLD = 'session-cold-zstd-0001'   // 只有磁盘日志，宿主里没有活 agent
const SID_PLAIN = 'session-cold-plain-0002' // 同上，但未压缩
const SID_LIVE = 'session-live-measured-3'  // 本进程内跑过一轮
const SID_OPEN = 'session-open-unmeas-0004' // 在 agents 注册表里活着，本进程从没测过

function buildEvents(n) {
  const evs = [
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4.1-flash', maxTokens: 384000 } } } },
    { type: 'request/context', data: { contextWindow: 1000000 } },
  ]
  for (let i = 0; i < n; i++) {
    evs.push({
      type: i % 2 === 0 ? 'user/message' : 'assistant/message',
      data: { message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: ('部署调度单签收监控到XP机，第' + i + '轮：').repeat(60) }] } },
    })
  }
  return evs
}
const jsonlText = [JSON.stringify({ agentPreset: 'default', cwd: WS }), ...buildEvents(40).map((e) => JSON.stringify(e))].join('\n') + '\n'
function putSession(sid, name, asZstd) {
  const dir = path.join(home, 'sessions', 'wsxp', sid)
  mkdirSync(dir, { recursive: true })
  const buf = Buffer.from(jsonlText, 'utf8')
  writeFileSync(path.join(dir, name), asZstd ? zstdCompressSync(buf) : buf)
}
putSession(SID_COLD, 'session.v3.jsonl.zstd', true)
putSession(SID_PLAIN, 'session.jsonl', false)
putSession(SID_LIVE, 'session.v3.jsonl.zstd', true)
putSession(SID_OPEN, 'session.v3.jsonl.zstd', true)

const registry = { list: () => [{ id: 'ws-xp', path: WS, sessionIds: [SID_COLD, SID_PLAIN, SID_LIVE, SID_OPEN] }] }
// 宿主 agents 注册表：SID_OPEN 活着（面板据此可现场计量），SID_COLD/SID_PLAIN 不在里面
const liveAgents = new Map()
const routes = []
const handlers = {}
const effects = []
const ctx = {
  get(name) {
    if (name === 'workspaceRegistry') return registry
    if (name === 'agents') return liveAgents
    return undefined
  },
  on(ev, fn) { handlers[ev] = fn; return () => {} },
  effect(fn) { effects.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register() { return () => {} } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
apply(ctx, {})

const mkAgent = (sid, withMeter) => ({
  id: 'agent-' + sid,
  session: { id: sid, header: { cwd: WS }, events: buildEvents(40) },
  ctx: { get: (n) => (n === 'tokenMeter' && withMeter
    ? { measure: () => ({ totalTokens: 424242, baseline: { kind: 'usage' } }) }
    : null) },
})
const call = async (needle, q, method, body) => {
  const r = routes.find((x) => String(x.path).includes(needle))
  assert.ok(r, 'route not registered: ' + needle)
  const url = r.path + (q || '')
  const rq = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: method || (body ? 'POST' : 'GET'), url,
  })
  let out = null
  await r.handler(rq, { writeHead() {}, end(b) { out = JSON.parse(b) } })
  return out
}
const waterFor = async (sid) => (await call('handoff-state', '?sessionId=' + sid) || {}).waterLevel
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('W0 前置：配置已加载且面板按 sessionId 出水位字段', async () => {
  await call('/config', '', 'GET')
  const w = await waterFor(SID_LIVE)
  assert.ok(w && typeof w === 'object', 'waterLevel 字段应存在（boardMode 默认 graph）')
  assert.equal(w.tokens, 0, '尚未测量的会话初值为 0')
})

test('W1 冷会话（zstd、宿主无活 agent）：分母照实推导，分子不得伪造', async () => {
  const w = await waterFor(SID_COLD)
  assert.equal(w.window, 1000000, '分母从磁盘推导为官方路由容量')
  assert.equal(w.source, 'official-context', '来源标注为官方容量')
  assert.equal(w.tokens, 0, '★ 真机取证：日志无 usage 事件、头帧解码只覆盖 60/1088 行 ⇒ 冷会话推不出可信分子，宁可显示未测量也不许编一个数')
  assert.notEqual(w.stale, true, '未测量不得标成 stale（stale 专指"曾有实测但过期"）')
})

test('W1b 冷会话（未压缩 session.jsonl）：分母同样要推对', async () => {
  const w = await waterFor(SID_PLAIN)
  assert.equal(w.window, 1000000, '★ 未压缩日志也该推出官方容量（旧实现无条件走 zstd 解码 ⇒ 静默降级 131072）')
  assert.equal(w.source, 'official-context', '★ 来源不得冒充 fallback')
})

test('W2 本进程跑过一轮的会话：实测值照常返回（既有行为守卫）', async () => {
  const agent = mkAgent(SID_LIVE, false)
  handlers['agent/session-start']({ agent, source: 'test' })
  await sleep(500)
  handlers['agent/turn-stopping']({ agent, turn: { id: 'turn-1', messages: [] } })
  await sleep(1500)
  const w = await waterFor(SID_LIVE)
  assert.ok(Number(w.tokens) > 0, '分子 > 0（启发式或官方计量任一路径出数）')
  assert.ok(Number(w.at) > 0, '带实测时间戳')
  assert.notEqual(w.stale, true, '新鲜记录不得标 stale（修前无此字段同样放行）')
})

test('W3 实测过但闲置 11 分钟：保留最后实测值并标 stale，不得退回「尚未测量」', async () => {
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 11 * 60 * 1000
    const w = await waterFor(SID_LIVE)
    assert.ok(Number(w.tokens) > 0, '★ 过期后分子仍须是上次实测值（旧实现整卡归零 ⇒ 用户看到的正是这个症状）')
    assert.ok(Number(w.window) > 0, '分母照常')
    assert.equal(w.stale, true, '★ 同时如实标 stale，供界面说明这是多久前的数')
  } finally { Date.now = realNow }
})

test('W3b 陈旧到 7 小时：按无记录处理，不得把半天前的数当真', async () => {
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 7 * 60 * 60 * 1000
    const w = await waterFor(SID_LIVE)
    // 闲置期间官方压缩可能已把上下文压下去而插件没测到 ⇒ 陈旧值只会偏高，比偏低更糟
    assert.equal(Number(w.tokens), 0, '★ 超过陈旧上限须退回未测量')
    assert.notEqual(w.stale, true, '★ 且不得仍标 stale')
    assert.equal(w.at, 0, '时间戳随之清零')
  } finally { Date.now = realNow }
})

test('W4 会话在宿主注册表里活着但本进程没测过：现场按同口径算一次分子', async () => {
  liveAgents.set(SID_OPEN, mkAgent(SID_OPEN, true))
  const w = await waterFor(SID_OPEN)
  assert.equal(Number(w.tokens), 424242, '★ 官方 tokenMeter 可用时取官方计量')
  assert.match(String(w.meter), /^official:/, '★ 计量来源如实标注')
  assert.ok(Number(w.ratio) > 0, '比率随之非零')
})

test('W4b 同场景但宿主无官方计量：回落启发式并如实标注', async () => {
  const sid = 'session-open-heuristic-05'
  putSession(sid, 'session.v3.jsonl.zstd', true)
  registry.list = () => [{ id: 'ws-xp', path: WS, sessionIds: [SID_COLD, SID_PLAIN, SID_LIVE, SID_OPEN, sid] }]
  liveAgents.set(sid, mkAgent(sid, false))
  const w = await waterFor(sid)
  assert.ok(Number(w.tokens) > 0, '★ 无官方计量时至少给出启发式估计')
  assert.equal(w.meter, 'heuristic', '计量来源标为启发式降级')
})

for (const d of effects) { try { if (typeof d === 'function') d() } catch (e) {} }
