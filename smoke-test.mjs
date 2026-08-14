// Smoke test for @a9i5k4/dsh-auto-memory host half (no dsh runtime needed).
import { apply, name, inject, GUIDANCE } from '@a9i5k4/dsh-auto-memory'

const registeredTools = []
const registeredRoutes = []
const sections = []
const effects = []

const ctx = {
  get(service) { return undefined },
  on() { return () => {} },
  effect(fn, label) { effects.push(label); return () => {} },
  systemPrompt: { section(section) { sections.push(section); return () => {} } },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register(route) { registeredRoutes.push(route); return () => {} } },
}

apply(ctx, {})

console.log('name:', name, '| inject:', JSON.stringify(inject))
console.log('GUIDANCE head:', GUIDANCE.slice(0, 30) + '…')
console.log('sections:', sections.length, '| effects:', JSON.stringify(effects))
console.log('tools:', registeredTools.map((t) => t.name).join(', '))
console.log('routes:', registeredRoutes.map((r) => r.path).join(', '))

if (registeredTools.length !== 8) throw new Error('expected 8 tools, got ' + registeredTools.length)
if (registeredRoutes.length !== 9) throw new Error('expected 9 routes, got ' + registeredRoutes.length)
if (sections.length !== 1) throw new Error('expected 1 prompt section')

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

// ---- prompt section provider ----
const provider = sections[0].text
const text = provider({ agent })
console.log('\nsection length:', text.length)
console.log('section head:', text.slice(0, 120).replace(/\n/g, '⏎'))
if (!text.includes('<memory_system>')) throw new Error('injection missing memory_system block')
if (!text.includes('memory_log')) throw new Error('injection missing write discipline')

console.log('\n✅ smoke test passed')
