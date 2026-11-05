// Reflection + config flow test (isolated temp workspace).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { apply } from '../../lib/index.js'

// T0: stub 掉真实网络(update-check/notices),与 isolation 系列保持一致。
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const ws = mkdtempSync(path.join(tmpdir(), 'dam-test-'))
const projectDir = path.join(ws, '.dsh-memory')
mkdirSync(projectDir, { recursive: true })
// T0/隔离卫生: 使用临时 DSH_HOME 并显式覆盖 memoryRoot/userMemoryDir ——
// 关键点:默认配置的 '~/.dsh/memory/workspaces' 会按真实 homedir 展开,仅设置 DSH_HOME 挡不住
// 集中记忆迁移/反思写入穿进真实用户目录(审查修复轮)。
const t0Home = path.join(ws, '.dsh-home')
mkdirSync(t0Home, { recursive: true })
writeFileSync(path.join(t0Home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(ws, '.memory-root'),
  userMemoryDir: path.join(ws, '.user-root'),
  projectMemoryDir: '.project-memory',
  externalSources: {},
}), 'utf8')
process.env.DSH_HOME = t0Home

// ★2026-11-05（FAKE-GREEN-AUDIT）· 真实用户记忆目录的**污染基线快照**，必须在 apply() 之前采集。
//   背景：本机真实存在一个 2026-09-23 建下的 dam-test-* 残留目录（七周前旧版套件遗留），
//   旧断言「扫到 dam-test- 就抛」因此恒红；改成「只比较**本次新增**」才是有意义的判据。
const REAL_WS_ROOT = path.join(homedir(), '.dsh', 'memory', 'workspaces')
const snapshotRealWorkspaces = () => {
  try { return new Set(readdirSync(REAL_WS_ROOT).filter((name) => name.includes('dam-test-'))) } catch (e) { return new Set() }
}
const LEAK_BASELINE = snapshotRealWorkspaces()

// yesterday log —— 必须按插件日界(dayBoundaryMinutes=450, 凌晨7:30前归前一天)推算"插件昨天",
// 否则 00:00-07:30 之间运行本测试时, 日历昨天==插件今天, 反思请求永远不会注入。
const PLUGIN_DAY_BOUNDARY_MIN = 450
const pad2 = (n) => String(n).padStart(2, '0')
const pluginDateStrOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
const y = pluginDateStrOf(Date.now() - PLUGIN_DAY_BOUNDARY_MIN * 60000 - 24 * 3600 * 1000)
writeFileSync(path.join(projectDir, `${y}.md`), '- 10:00 完成了登录模块重构\n- 14:30 修复了缓存穿透 bug\n', 'utf8')

const registeredTools = []
const registeredRoutes = []
const sections = []
const contexts = []
// T0: 收集 effect disposer, 结束时统一执行, 让插件 timer 全部结算、进程自然 exit 0。
const effectDisposers = []
const ctx = {
  get() { return undefined },
  on() { return () => {} },
  effect(fn) { if (typeof fn === 'function') effectDisposers.push(fn); return () => {} },
  systemPrompt: { section(s) { sections.push(s); return () => {} }, context(c) { contexts.push(c); return () => {} } },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register(route) { registeredRoutes.push(route); return () => {} } },
}
apply(ctx, {})
const agent = { session: { header: { cwd: ws } } }
// v0.1.15+ 架构: 静态纪律在 section, 动态反思请求在 context(user-role 快照)。provider = context 动态部分。
const provider = contexts[0].text

// 1) refresh with agent → pending reflection for yesterday
const status = registeredTools.find((t) => t.name === 'memory_status')
await status.execute({}, { agent })
const text1 = provider({ agent })
console.log('has reflection request:', text1.includes('昨日反思 · ' + y))
if (!text1.includes('昨日反思 — 待生成')) throw new Error('reflection request not injected')

// 2) style auto guidance present
if (!text1.includes('风格由内容决定')) throw new Error('style guidance missing')
if (!sections[0].text().includes('[记忆写入纪律')) throw new Error('section static discipline missing')

// 3) second call same session → not repeated
const text2 = provider({ agent })
if (text2.includes('昨日反思 — 待生成')) throw new Error('reflection request repeated in same session')

// 4) memory_reflect saves and clears pending
const reflect = registeredTools.find((t) => t.name === 'memory_reflect')
const rr = await reflect.execute({ date: y, text: '成果: 登录模块重构完成;教训: 注意缓存一致性;明天: 继续性能优化。' }, { agent })
console.log('reflect →', rr)
// v0.1.15+ 集中式记忆: 反思写入集中目录(从工具返回消息解析实际路径), 不再写在 {ws}/.dsh-memory
const reflMatch = String(rr || '').match(/已保存反思\s+(.+?)(?:\n|$)/)
const reflFile = reflMatch ? reflMatch[1].trim() : path.join(projectDir, 'reflections', `${y}.md`)
if (!existsSync(reflFile)) throw new Error('reflection file not written: ' + reflFile)
if (provider({ agent }).includes('昨日反思 — 待生成')) throw new Error('pending not cleared after reflect')
// ★★2026-11-05 假绿审计（FAKE-GREEN-AUDIT）· 判据修正，非放宽：
//   【旧判据】`const text3 = provider({ agent })` 后断言含 '最近反思 y'。
//     它对**同一 agent 的同一 turn** 连续取帧 ⇒ 命中 injected-tier 节流（`finalizePre` +
//     snapshotMinGapRounds，默认 20），第 2 帧起返回**精简版**；而精简版按 2026-10-01 用户裁定
//     「规则段/Tier-0/白板账本/反思全部移出精简版」**设计上就不含**反思段
//     （renderSlimSnapshotPre 函数体内 reflection|反思 命中数 = 0，实测）。
//   【为什么这不是「产品坏了」】实测三帧对照：同 agent 第 1 帧 2,731 字符含反思请求；
//     第 2 帧起 2,067 字符为精简版；**换一个新 session 的 agent ⇒ 同一 provider 立刻返回
//     2,766 字符完整帧且含 '最近反思'** ⇒ 反思注入通路本身完好，只是同 agent 同 turn 被节流。
//   【修法】断言「反思已写入且能从注入面读到」的正确观测点是**新 turn/新会话的完整帧**，
//     而不是同 turn 的第 3 帧。这里用独立 session 的 agent 取完整帧 —— 它才是生产里
//     「重启后/下一轮」真实发生的路径，比原来更贴语义，且仍有区分力（见变异证明）。
const agentNext = { session: { id: 'session-next-turn', header: { id: 'session-next-turn', cwd: ws } } }
await status.execute({}, { agent: agentNext })
const text3 = provider({ agent: agentNext })
if (!text3.includes('最近反思 ' + y)) throw new Error('latest reflection not injected')
console.log('latest reflection injected ✓（完整帧 · 新会话）')

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

// T0: 结算插件 effect —— effect(setup) 是工厂:调用后返回真正的 disposer 再执行。
for (const setup of effectDisposers) {
  try { const teardown = typeof setup === 'function' ? await setup() : undefined; if (typeof teardown === 'function') await teardown() } catch (e) {}
}

// 审查修复轮:验证真实用户集中记忆目录未被本测试污染(不能用"清理临时目录"代替验证)。
// ★★2026-11-05 假绿审计（FAKE-GREEN-AUDIT）· 判据修正，非放宽：
//   【旧判据】扫描全部 dam-test- 前缀目录并「只要命中就抛」。
//     它把**历史残留**与**本次污染**混为一谈：本机真实存在一个
//     2026-09-23 15:59 建下的 `--C--Users-JHZ~1-AppData-Local-Temp-dam-test-ISBPN6--`
//     （七周前某次旧版套件留下的），于是这条断言**从那天起就恒定失败**。
//     而它此前从未被执行过 —— 因为旧套件在更早的 'latest reflection not injected' 就抛了，
//     假绿防线一上线才让它暴露。
//   【正确判据】污染是**增量**语义：本次运行**新产生**的目录才算。故改为运行前后快照对比
//     （只比较 delta）。这样：① 历史残留不再造成恒红；② 真出现新泄漏立刻红（有区分力）。
//   【为什么不删断言】删掉就等于放弃这条防线；改成 delta 后它**更准**，且能抓住真正的新污染。
{
  const after = snapshotRealWorkspaces()
  const leaked = [...after].filter((name) => !LEAK_BASELINE.has(name))
  if (leaked.length) throw new Error('reflect test polluted real user memory: ' + leaked.join(', '))
}
rmSync(ws, { recursive: true, force: true })
console.log('\n✅ reflection + config + recall test passed (temp workspace cleaned, real user memory untouched)')
