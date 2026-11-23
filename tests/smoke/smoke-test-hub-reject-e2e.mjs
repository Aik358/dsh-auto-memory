#!/usr/bin/env node
/**
 * 隔离环境端到端复现：记忆中枢 agent-message 拦截是否真的生效。
 *
 * 判据（真执行）：
 *   构造一个「记忆中枢 cwd」的 agent，投递一条 source.kind==='agent-message' 的消息，
 *   调用真实的 ctx.on('agent/pre-step') handler，观察下一层 next() 返回的 decision 是否被
 *   改写成 { kind:'reject' }。
 *
 *   若 handler 内部抛 ReferenceError 并被空 catch 吞掉，则 decision 原样返回 ⇒ 拦截失效。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = process.env.DAM_INDEX_JS || path.join(ROOT, 'lib', 'index.js')

const ws = mkdtempSync(path.join(tmpdir(), 'dam-hubreject-'))
const home = path.join(ws, '.dsh-home')
mkdirSync(home, { recursive: true })
const projectRoot = path.join(ws, '.project-root')
const userRoot = path.join(ws, '.user-root')
mkdirSync(projectRoot, { recursive: true })
mkdirSync(userRoot, { recursive: true })

// workbenchRoot 走「自动」⇒ dshHome()/aik_auto_memory_use
const HUB_CWD = path.join(home, 'aik_auto_memory_use')
mkdirSync(HUB_CWD, { recursive: true })

writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: projectRoot,
  userMemoryDir: userRoot,
  projectMemoryDir: '.project-memory',
  externalSources: {},
}), 'utf8')
process.env.DSH_HOME = home
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const { apply } = await import('file:///' + SRC.replace(/\\/g, '/'))

const eventHandlers = new Map()
const ctx = {
  get() { return undefined },
  on(name, handler) { eventHandlers.set(name, handler); return () => eventHandlers.delete(name) },
  effect() { return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register() { return () => {} } },
  webServer: { register() { return () => {} } },
}
apply(ctx, {})

const preStep = eventHandlers.get('agent/pre-step')
if (!preStep) { console.log('FAIL - agent/pre-step 未注册'); process.exit(1) }

function mkAgent(cwd, sid) {
  return { id: sid, session: { id: sid, header: { id: sid, cwd }, events: [{ seq: 1, type: 'turn/start', data: { turn: 1 } }] } }
}
function agentMsg(text) {
  return { role: 'user', content: [{ type: 'text', text: 'Agent s-1 sent a message: ' + text }],
    source: { kind: 'agent-message', form: 'relay', senderSessionId: 's-1' } }
}
/** 宿主 createSettlementMessage 的真实形状（@deepseek-ai/dsh-subagent 取证）。 */
function settledMsg(childId) {
  const summary = 'Background subagent ' + childId + ' finished and will do no further work unless you send it more.'
  return { role: 'user',
    content: [{ type: 'text', text: summary }, { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: '[TOPIC] 情境化记忆四项修复' }],
    source: { kind: 'subagent-settled', form: 'notice', summary, senderSessionId: childId } }
}
function humanMsg(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

let pass = 0, fail = 0
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ok - ' + msg) }
  else { fail++; console.log('  FAIL - ' + msg + (extra ? '  << ' + extra : '')) }
}

async function run(label, agent, messages, expected) {
  const payload = { agent, messages, turn: 5, step: 1 }
  // next() 模仿宿主默认决策：返回 enter + 原批次
  const next = async () => ({ kind: 'enter', messages: messages.slice() })
  const decision = await preStep(payload, next)
  const got = decision && decision.kind
  ok(got === expected, label + ' (期望 kind=' + expected + '，实际=' + got + ')',
    decision && Array.isArray(decision.messages) ? 'messages.length=' + decision.messages.length : '')
  return decision
}

const hubAgent = mkAgent(HUB_CWD, 'session-hub')
const otherAgent = mkAgent(path.join(ws, 'other-ws'), 'session-other')
mkdirSync(path.join(ws, 'other-ws'), { recursive: true })

console.log('=== 隔离环境 (DSH_HOME=' + home + ') ===')
console.log('=== 记忆中枢 cwd = ' + HUB_CWD + ' ===\n')

await run('[中枢] 纯 agent-message 批次', hubAgent, [agentMsg('hello')], 'reject')
await run('[中枢] 两条 agent-message 批次', hubAgent, [agentMsg('a'), agentMsg('b')], 'reject')
// ★2026-10-31 用户原话「consolidate 等操作结束之后」—— 对应的正是 subagent-settled
await run('[中枢] 纯 subagent-settled 批次（操作结束通知）', hubAgent, [settledMsg('c-1')], 'reject')
await run('[中枢] agent-message+subagent-settled 混合批次（R159 实测形状）', hubAgent,
  [agentMsg('a'), settledMsg('c-1')], 'reject')
await run('[中枢] agent-message + 真人消息（必须放行）', hubAgent, [agentMsg('a'), humanMsg('用户说话')], 'enter')
await run('[中枢] subagent-settled + 真人消息（必须放行）', hubAgent, [settledMsg('c-1'), humanMsg('用户说话')], 'enter')
await run('[中枢] 纯真人消息（必须放行）', hubAgent, [humanMsg('用户说话')], 'enter')
await run('[其他工作区] 纯 agent-message（必须放行，用户硬要求）', otherAgent, [agentMsg('a')], 'enter')
await run('[其他工作区] 纯 subagent-settled（必须放行，用户硬要求）', otherAgent, [settledMsg('c-1')], 'enter')

console.log('\n=== 结果：' + pass + ' pass / ' + fail + ' fail ===')
rmSync(ws, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
