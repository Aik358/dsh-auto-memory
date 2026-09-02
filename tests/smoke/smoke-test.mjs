import { apply, name, inject, GUIDANCE } from '../../lib/index.js'
// 2026-08-16: 适配 section→context 迁移 —— 静态纪律在 section(稳定锚), 动态记忆在 context(user-role 快照)

// T0: 与 isolation 系列一致,stub 掉真实网络(update-check/notices),避免测试进程被挂起 socket 拖住。
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

// 审查修复轮2:插件在 apply() 内注册进程级 uncaughtException 兜底会吞掉断言异常并让 interval 存活,
// 测试必须先注册硬失败出口,保证任何断言失败都立刻 exit 1 而不是挂住进程。
process.on('uncaughtException', (e) => { console.error('\n[SMOKE] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[SMOKE] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

// 审查修复轮2:集中记忆根与用户级目录显式覆盖到临时目录 ——
// '~' 按真实 homedir 展开,仅设 DSH_HOME 挡不住迁移/写入穿进真实用户记忆(复审轮已证实该泄漏)。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
const smkWs = mkdtempSync(path.join(tmpdir(), 'dam-smoke-'))
const smkHome = path.join(smkWs, '.dsh-home')
mkdirSync(smkHome, { recursive: true })
writeFileSync(path.join(smkHome, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(smkWs, '.memory-root'),
  userMemoryDir: path.join(smkWs, '.user-root'),
  projectMemoryDir: '.project-memory',
  externalSources: {},
}), 'utf8')
process.env.DSH_HOME = smkHome
// 唯一标记:每次运行不同 nonce,使"真实文件不含本 run 写入"可被精确断言
const smkNonce = 'smk' + Date.now() + 'x'
const smkToday = (() => { const d = new Date(); if (d.getHours() * 60 + d.getMinutes() < 450) d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })() // 与引擎 memToday 同界(dayBoundaryMinutes=450,07:30 前归前一天;修复凌晨窗口 flake)
const realArkToday = path.join(homedir(), '.dsh', 'memory', 'workspaces', '--D--Ark9Tools--', smkToday)

const registeredTools = []
const registeredRoutes = []
const sections = []
const contexts = []
const effects = []
// T0: 收集 effect disposer, 测试结束统一执行 —— 否则插件 interval(retry/heartbeat/notices)会让进程无法自然退出。
const effectDisposers = []

const ctx = {
  get(service) { return undefined },
  on() { return () => {} },
  effect(fn, label) { effects.push(label); if (typeof fn === 'function') effectDisposers.push(fn); return () => {} },
  systemPrompt: {
    section(section) { sections.push(section); return () => {} },
    context(context) { contexts.push(context); return () => {} },
  },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register(route) { registeredRoutes.push(route); return () => {} } },
}

apply(ctx, {})

// 审查修复轮2:先经 config 路由 await loadConfig,再执行任何工具调用,
// 消除"首个调用按默认 '~'(真实 homedir) 解析路径"的竞态(本测试污染真实记忆的根因)。
const configRouteEarly = registeredRoutes.find((r) => r.path === '/api/dsh-auto-memory/config')
let cfgBody
await configRouteEarly.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/api/dsh-auto-memory/config' }, { writeHead() {}, end(b) { cfgBody = JSON.parse(b) } })
if (cfgBody.config.memoryRoot.indexOf(smkWs) !== 0) throw new Error('memoryRoot not isolated to temp dir before execution: ' + cfgBody.config.memoryRoot)

console.log('name:', name, '| inject:', JSON.stringify(inject))
console.log('GUIDANCE head:', GUIDANCE.slice(0, 30) + '…')
console.log('sections:', sections.length, '| contexts:', contexts.length, '| effects:', JSON.stringify(effects))
console.log('tools:', registeredTools.map((t) => t.name).join(', '))
console.log('routes:', registeredRoutes.map((r) => r.path).join(', '))

if (registeredTools.length !== 14) throw new Error('expected 14 tools, got ' + registeredTools.length)
if (registeredRoutes.length !== 34) throw new Error('expected 34 routes, got ' + registeredRoutes.length)
if (sections.length !== 1) throw new Error('expected 1 prompt section (static rules)')
if (contexts.length !== 2) throw new Error('expected 2 dynamic contexts (memory snapshot + m6 reference tail surface), got ' + contexts.length)

// ---- tool shape ----
const log = registeredTools.find((t) => t.name === 'memory_log')
if (!log.parameters || log.parameters.type !== 'object' || !log.parameters.properties.note) throw new Error('memory_log parameters malformed')
if (typeof log.execute !== 'function' || typeof log.output.render !== 'function') throw new Error('memory_log contract broken')

// ---- execute memory_log:工作区键仍用真实 cwd 形态,但集中记忆根已隔离到临时目录(见文件头配置) ----
const agent = { session: { header: { cwd: 'D:\\Ark9Tools' } } }
const smkNote = '冒烟测试(' + smkNonce + '): 持久化插件包 host 半验证通过(apply/工具/注入契约全部正常)。'
const r1 = await log.execute({ note: smkNote }, { agent })
console.log('\nmemory_log →', r1)

// ---- execute memory_status ----
const status = registeredTools.find((t) => t.name === 'memory_status')
const r2 = await status.execute({}, { agent })
console.log('\nmemory_status →\n' + r2)

// ---- static rules section (byte-stable anchor) ----
const provider = sections[0].text
const staticA = provider()
const staticB = provider()
if (staticA !== staticB) throw new Error('static rules section must be byte-stable across calls')
if (!staticA.includes('[记忆写入纪律')) throw new Error('static section missing write discipline')
if (staticA.includes('<memory_system>')) throw new Error('static section must not carry dynamic <memory_system> block')
console.log('\nstatic section length:', staticA.length, '| byte-stable:', staticA === staticB)

// ---- dynamic memory context (user-role snapshot) ----
const ctxProvider = contexts[0].text
if (ctxProvider({}) !== '') throw new Error('context must be empty without agent')
const dyn = ctxProvider({ agent })
console.log('dynamic context length:', dyn.length)
console.log('dynamic context head:', dyn.slice(0, 120).replace(/\n/g, '⏎'))
if (!dyn.includes('<memory_system>')) throw new Error('dynamic context missing memory_system block')
if (!dyn.includes('自动记忆已启用')) throw new Error('dynamic context missing status line')
if (dyn.includes('[记忆写入纪律')) throw new Error('dynamic context must not duplicate static rules')

// 审查修复轮2:真实用户记忆零污染验证 —— 本 run 的 nonce 不得出现在真实集中记忆文件中,
// 且必须落在临时 memoryRoot 内(构造上隔离 + 结果双重验证,不受并发写入干扰)。
{
  if (existsSync(realArkToday)) {
    let realText = ''
    try { realText = readFileSync(realArkToday, 'utf8') } catch (e) {}
    if (realText.includes(smkNonce)) throw new Error('smoke test wrote into REAL user memory file: ' + realArkToday)
  }
  const tempCentral = path.join(smkWs, '.memory-root', '--D--Ark9Tools--', smkToday + '.md')
  if (!existsSync(tempCentral)) throw new Error('expected smoke log in temp memory root, missing: ' + tempCentral)
  if (!readFileSync(tempCentral, 'utf8').includes(smkNonce)) throw new Error('temp log missing nonce')
  // 真实 workspaces 根不得新增 dam-smoke-* 条目
  const realWsRoot = path.join(homedir(), '.dsh', 'memory', 'workspaces')
  if (existsSync(realWsRoot)) {
    const leaked = readdirSync(realWsRoot).filter((n) => n.includes('dam-smoke-'))
    if (leaked.length) throw new Error('smoke test leaked workspace dirs: ' + leaked.join(', '))
  }
}

// T0: 正式结算插件 effect —— effect(setup) 是工厂:调用后返回真正的 disposer 再执行。
for (const setup of effectDisposers) {
  try { const teardown = typeof setup === 'function' ? await setup() : undefined; if (typeof teardown === 'function') await teardown() } catch (e) {}
}
try { rmSync(smkWs, { recursive: true, force: true }) } catch (e) {}

console.log('\n✅ smoke test passed (isolated temp memory roots, real user memory untouched)')
