// External memory discovery test against the REAL machine.
import { apply } from '../../lib/index.js'

// T0: stub 掉真实网络(update-check/notices),与 isolation 系列保持一致。
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

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

// T0: 结算插件 effect —— effect(setup) 是工厂:调用后返回真正的 disposer 再执行。
for (const setup of effectDisposers) {
  try { const teardown = typeof setup === 'function' ? await setup() : undefined; if (typeof teardown === 'function') await teardown() } catch (e) {}
}

console.log('\n✅ external memory test done')
