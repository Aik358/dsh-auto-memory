// Smoke test for @a9i5k4/dsh-auto-memory host half (no dsh runtime needed).
// 2026-08-16: 适配 section→context 迁移 —— 静态纪律在 section(稳定锚), 动态记忆在 context(user-role 快照)
import { apply, name, inject, GUIDANCE } from '@a9i5k4/dsh-auto-memory'

const registeredTools = []
const registeredRoutes = []
const sections = []
const contexts = []
const effects = []

const ctx = {
  get(service) { return undefined },
  on() { return () => {} },
  effect(fn, label) { effects.push(label); return () => {} },
  systemPrompt: {
    section(section) { sections.push(section); return () => {} },
    context(context) { contexts.push(context); return () => {} },
  },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register(route) { registeredRoutes.push(route); return () => {} } },
}

apply(ctx, {})

console.log('name:', name, '| inject:', JSON.stringify(inject))
console.log('GUIDANCE head:', GUIDANCE.slice(0, 30) + '…')
console.log('sections:', sections.length, '| contexts:', contexts.length, '| effects:', JSON.stringify(effects))
console.log('tools:', registeredTools.map((t) => t.name).join(', '))
console.log('routes:', registeredRoutes.map((r) => r.path).join(', '))

if (registeredTools.length !== 14) throw new Error('expected 14 tools, got ' + registeredTools.length)
if (registeredRoutes.length !== 24) throw new Error('expected 24 routes, got ' + registeredRoutes.length)
if (sections.length !== 1) throw new Error('expected 1 prompt section (static rules)')
if (contexts.length !== 1) throw new Error('expected 1 dynamic context (memory snapshot)')

// ---- tool shape ----
const log = registeredTools.find((t) => t.name === 'memory_log')
if (!log.parameters || log.parameters.type !== 'object' || !log.parameters.properties.note) throw new Error('memory_log parameters malformed')
if (typeof log.execute !== 'function' || typeof log.output.render !== 'function') throw new Error('memory_log contract broken')

// ---- execute memory_log against the real workspace ----
const agent = { session: { header: { cwd: 'D:\\Ark9Tools' } } }
const r1 = await log.execute({ note: '冒烟测试: 持久化插件包 host 半验证通过(apply/工具/注入契约全部正常)。' }, { agent })
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

console.log('\n✅ smoke test passed')
