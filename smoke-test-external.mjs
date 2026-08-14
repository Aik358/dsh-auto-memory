// External memory discovery test against the REAL machine.
import { apply } from '@a9i5k4/dsh-auto-memory'

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
const agent = { session: { header: { cwd: 'D:\\Ark9Tools' } } }

// 1) force discovery
const externalTool = registeredTools.find((t) => t.name === 'memory_external')
const list = await externalTool.execute({ action: 'list' }, { agent })
console.log(list)
console.log('---')

// 2) recall across external sources
const recall = registeredTools.find((t) => t.name === 'memory_recall')
const r1 = await recall.execute({ query: '鸿蒙', limit: 5 }, { agent })
console.log('recall 鸿蒙 →', r1.slice(0, 600))
console.log('---')
const r2 = await recall.execute({ query: 'EEG', limit: 5 }, { agent })
console.log('recall EEG →', r2.slice(0, 600))

console.log('\n✅ external memory test done')
