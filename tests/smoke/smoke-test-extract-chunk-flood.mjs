#!/usr/bin/env node
/** [chunk-flood] extractSessionMessages 截尾窗口回归(2026-09-08)。
 * 真实抽取 extractSessionMessages(花括号配平),注入 sessionEventsOf/messageOfEvent/textOfContent
 * 后在受控闭包里驱动 —— 测的是随包发布的真实代码:
 *   G1 chunk 洪流:真人 user/message 后跟 >2000 条流式 chunk → 窗口仍能取到该消息(修复点)
 *   G2 窗口兜底:消息类事件超过 2000 条 → 提取数 ≤2000,且含最新一条
 *   G3 旧版 host:session 以 .events 数组暴露时行为一致
 *   G4 源码守卫:过滤先于截尾(防止未来重构悄悄退化回"全量截尾")
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }

// —— 源码抽取器(花括号配平,同 smoke-test-handoff-pre) ——
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
const extractSessionMessages = new Function(
  'sessionEventsOf', 'messageOfEvent', 'textOfContent',
  'return (' + extractFn('function extractSessionMessages(agent) {') + ')'
)(sessionEventsOf, messageOfEvent, textOfContent)
function sessionEventsOf(session) {
  try {
    if (!session) return []
    if (Array.isArray(session.events)) return session.events
    if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  } catch (e) {}
  return []
}
function messageOfEvent(ev) {
  if (!ev) return null
  if (ev.type === 'user/message') return ev.data && ev.data.message ? ev.data.message : ev.data
  if (ev.type === 'assistant/message' || ev.type === 'tool/result') return ev.data && ev.data.message
  return null
}
function textOfContent(content) {
  const out = []
  const walk = (v, depth) => {
    if (depth > 8 || v == null) return
    if (typeof v === 'string') { out.push(v); return }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v !== 'object') return
    if (typeof v.text === 'string') out.push(v.text)
    else if (typeof v.input_text === 'string') out.push(v.input_text)
    if (v.content !== undefined) walk(v.content, depth + 1)
  }
  walk(content, 0)
  return out.join('')
}

console.log('[chunk-flood] G1 真人消息被 >2000 条流式 chunk 淹没后仍可取到')
const QUESTION = '请帮我复核一下这两个方案是否可行，并给出具体依据'
const flood = [ { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: QUESTION }] } } ]
for (let i = 0; i < 4680; i++) flood.push({ type: 'reasoning-chunks', data: { delta: 'thinking...' } })
flood.push({ type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '已复核，结论如下。' }] } } })
const m1 = extractSessionMessages({ session: { snapshotEvents: () => flood } })
const picked = m1.filter(m => m.role === 'user' && m.eventType === 'user/message')
ok(picked.length >= 1 && picked[picked.length - 1].text.includes('复核') && picked[picked.length - 1].text === QUESTION,
  'chunk 洪流后真人提问仍在提取结果中(' + (picked[picked.length - 1] || {}).text?.slice(0, 20) + '…)')

console.log('[chunk-flood] G2 消息类事件超过 2000 条 → 窗口兜底仍生效')
const big = [ { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '最初的问题' }] } } ]
for (let i = 0; i < 2500; i++) big.push({ type: 'tool/result', data: { message: { role: 'user', content: [{ type: 'text', text: 'tool output ' + i }] } } })
big.push({ type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '回答' }] } } })
const m2 = extractSessionMessages({ session: { snapshotEvents: () => big } })
ok(m2.length <= 2000, '提取消息数 ≤ 2000(实际 ' + m2.length + ')')
ok(m2.length > 0 && m2[m2.length - 1].text === '回答', '窗口保留最新一条消息')

console.log('[chunk-flood] G3 旧版 host(.events 数组)行为一致')
const legacy = { events: [
  { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '帮我看看这个配置' }] } },
  { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '配置检查完了' }] } } },
] }
const m3 = extractSessionMessages({ session: legacy })
ok(m3.length === 2 && m3[0].text === '帮我看看这个配置' && m3[1].text === '配置检查完了', '旧版 host 提取一致')

console.log('[chunk-flood] G4 源码守卫:过滤先于截尾')
const fnSrc = extractFn('function extractSessionMessages(agent) {')
const filterIdx = fnSrc.indexOf("ev.type === 'user/message'")
const capIdx = fnSrc.indexOf('slice(-2000)')
ok(filterIdx !== -1 && capIdx !== -1 && filterIdx < capIdx, '过滤逻辑位于截尾之前(防退化)')

console.log('[chunk-flood] 结果: pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
