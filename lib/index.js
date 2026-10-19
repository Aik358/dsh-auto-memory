import { MemoryEngine } from './engine.js'
import { route } from './http.js'

export const name = 'auto-memory-pre'
export const inject = ['webServer', 'tools', 'systemPrompt', 'llm']

const string = description => ({ type: 'string', description })
const integer = description => ({ type: 'integer', description })

export function apply(ctx, config = {}) {
  const engine = new MemoryEngine(ctx, config)
  const disposers = []
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    engine.close()
    for (const fn of disposers.reverse()) { try { fn?.() } catch (error) { console.warn('[dsh-auto-memory]', error.message) } }
  }
  ctx.effect(() => dispose, 'dsh-auto-memory: core')
  const add = value => { disposers.push(value); return value }
  try {
    add(ctx.systemPrompt.section({ name: 'memory-tools', order: 80, interpolate: false,
      text: '长期记忆只提供历史背景。相关任务可按需 memory_search；memory_read 读取完整条目，memory_source 读取原文。用户纠正或要求忘记时，先读取条目的 version，再用 memory_write 或 memory_delete。当前用户指令和现场证据优先。无需每轮主动调用记忆工具。' }))
    add(ctx.systemPrompt.context({ name: 'memory-summary', order: 80, interpolate: false, text: context => engine.snapshot(context.agent) }))
    add(ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      const text = await engine.prepare(context.agent)
      const result = await next()
      // Respect host suppression: update only the context admitted by the host.
      return { ...result, contexts: result.contexts.map(item => item.name === 'memory-summary' ? { ...item, text } : item) }
    }))
    add(ctx.on('agent/pre-step', async ({ agent }, next) => { await engine.begin(agent); return next() }))
    add(ctx.on('agent/turn-stopping', ({ agent, turn }) => engine.end(agent, turn)))
    add(ctx.on('agent/disposed', ({ agent }) => engine.forget(agent)))

    const tool = (name, description, properties, required, execute) => add(ctx.tools.register({ name, description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async (args, exec) => {
        const workspace = await engine.bind(exec?.agent)
        return JSON.stringify(await execute(workspace, args))
      },
    }))
    tool('memory_search', '按关键词搜索当前项目和用户记忆；originals=true 时也搜索原文。',
      { query: string('关键词'), limit: integer('返回数量，默认10，最多100条记忆'), originals: { type: 'boolean' } }, ['query'],
      (workspace, args) => engine.store.search(workspace, args.query, args.limit, args.originals))
    tool('memory_read', '读取一条记忆、当前版本和来源 ID。', { id: string('记忆 ID') }, ['id'],
      (workspace, args) => engine.store.read(args.id, workspace))
    tool('memory_source', '按来源 ID 追溯脱敏原文；通过 nextOffset 分页。已撤回的原文只用于审计，不可恢复为当前结论。',
      { id: string('来源 ID'), offset: integer('起始字符位置'), limit: integer('最多24000字符') }, ['id'],
      (workspace, args) => engine.store.source(args.id, workspace, args.offset, args.limit))
    tool('memory_write', '按用户要求新增或纠正记忆。纠正需提供 id 和当前 expectedVersion；用户级适用于跨项目偏好。',
      { id: string('纠正的记忆 ID；新增时省略'), text: string('完整新内容，最多2000字符'), scope: { type: 'string', enum: ['project', 'user'] }, expectedVersion: integer('刚读取的版本') }, ['text', 'scope'],
      (workspace, args) => engine.mutate(workspace, 'write', args))
    tool('memory_delete', '按用户要求删除记忆，停用旧证据的检索和自动提取。原文仍保留用于已有条目的追溯。',
      { id: string('记忆 ID'), expectedVersion: integer('刚读取的版本') }, ['id', 'expectedVersion'],
      (workspace, args) => engine.mutate(workspace, 'delete', args))
    add(ctx.webServer.register(route(engine)))
  } catch (error) { dispose(); throw error }
  return engine
}
