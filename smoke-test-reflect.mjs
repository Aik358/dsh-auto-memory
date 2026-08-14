// Reflection + config flow test (isolated temp workspace).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '@a9i5k4/dsh-auto-memory'

const ws = mkdtempSync(path.join(tmpdir(), 'dam-test-'))
const projectDir = path.join(ws, '.dsh-memory')
mkdirSync(projectDir, { recursive: true })

// yesterday log
const d = new Date()
d.setDate(d.getDate() - 1)
const y = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
writeFileSync(path.join(projectDir, `${y}.md`), '- 10:00 完成了登录模块重构\n- 14:30 修复了缓存穿透 bug\n', 'utf8')

const registeredTools = []
const registeredRoutes = []
const sections = []
const ctx = {
  get() { return undefined },
  on() { return () => {} },
  effect() { return () => {} },
  systemPrompt: { section(s) { sections.push(s); return () => {} } },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register(route) { registeredRoutes.push(route); return () => {} } },
}
apply(ctx, {})
const agent = { session: { header: { cwd: ws } } }
const provider = sections[0].text

// 1) refresh with agent → pending reflection for yesterday
const status = registeredTools.find((t) => t.name === 'memory_status')
await status.execute({}, { agent })
const text1 = provider({ agent })
console.log('has reflection request:', text1.includes('昨日反思 · ' + y))
if (!text1.includes('昨日反思 — 待生成')) throw new Error('reflection request not injected')

// 2) style auto guidance present
if (!text1.includes('风格由内容决定')) throw new Error('style guidance missing')

// 3) second call same session → not repeated
const text2 = provider({ agent })
if (text2.includes('昨日反思 — 待生成')) throw new Error('reflection request repeated in same session')

// 4) memory_reflect saves and clears pending
const reflect = registeredTools.find((t) => t.name === 'memory_reflect')
const rr = await reflect.execute({ date: y, text: '成果: 登录模块重构完成;教训: 注意缓存一致性;明天: 继续性能优化。' }, { agent })
console.log('reflect →', rr)
const reflFile = path.join(projectDir, 'reflections', `${y}.md`)
if (!existsSync(reflFile)) throw new Error('reflection file not written')
const text3 = provider({ agent })
if (text3.includes('昨日反思 — 待生成')) throw new Error('pending not cleared after reflect')
if (!text3.includes('最近反思 ' + y)) throw new Error('latest reflection not injected')
console.log('latest reflection injected ✓')

// 5) config route GET/POST
const configRoute = registeredRoutes.find((r) => r.path === '/api/dsh-auto-memory/config')
let lastBody
const res = {
  writeHead() {}, end(b) { lastBody = JSON.parse(b) },
}
await configRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/api/dsh-auto-memory/config' }, res)
console.log('config GET →', lastBody.config.reflectStyle, lastBody.config.injectBudgetChars)
await configRoute.handler({
  socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
  method: 'POST', url: '/api/dsh-auto-memory/config',
  [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify({ reflectStyle: 'life', injectBudgetChars: 3000 })) })() },
}, res)
console.log('config POST →', lastBody.config.reflectStyle, lastBody.config.injectBudgetChars)
if (lastBody.config.reflectStyle !== 'life' || lastBody.config.injectBudgetChars !== 3000) throw new Error('config POST failed')

// restore config defaults
await configRoute.handler({
  socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
  method: 'POST', url: '/api/dsh-auto-memory/config',
  [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify({ reflectStyle: 'auto', injectBudgetChars: 2400 })) })() },
}, res)

// 6) memory_recall finds the log content
const recall = registeredTools.find((t) => t.name === 'memory_recall')
const rq = await recall.execute({ query: '缓存穿透' }, { agent })
console.log('recall hit:', rq.includes('缓存穿透'))
if (!rq.includes('缓存穿透')) throw new Error('recall failed to find log content')

rmSync(ws, { recursive: true, force: true })
console.log('\n✅ reflection + config + recall test passed (temp workspace cleaned)')
