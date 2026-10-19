import path from 'node:path'
import { MemoryStore } from './store.js'
import { dshHome, workspaceOf, rootAgent, turnSource, routeOf, extract, importLegacy } from './host.js'
import { redact } from './text.js'

export class MemoryEngine {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = { idleMs: 60000, requestTimeoutMs: 120000, summaryChars: 3000, ...config }
    for (const key of ['idleMs', 'requestTimeoutMs', 'summaryChars']) {
      if (!Number.isFinite(this.config[key]) || this.config[key] < 1) throw new Error(`无效配置：${key}`)
    }
    this.home = config.home || dshHome()
    this.store = new MemoryStore(config.directory || path.join(this.home, 'memory-core'))
    this.sessions = new Map()
    this.workspaces = new Map()
    this.closed = false
  }

  state(workspace) {
    if (!this.workspaces.has(workspace)) this.workspaces.set(workspace, { busy: new Set(), summary: '', error: '', timer: null, flight: null, controller: null, route: null, imported: false })
    return this.workspaces.get(workspace)
  }

  report(workspace, error) {
    const message = redact(error?.message || String(error))
    this.state(workspace).error = message
    console.warn('[dsh-auto-memory]', message)
  }

  async bind(agent) {
    if (!rootAgent(agent)) throw new Error('记忆仅用于绑定工作区的主会话')
    const workspace = await workspaceOf(this.ctx, agent)
    this.sessions.set(agent.session.id, workspace)
    const state = this.state(workspace)
    if (!state.imported) {
      state.importing ||= importLegacy(this.store, workspace, this.home)
      try { await state.importing; state.imported = true }
      catch (error) { this.report(workspace, error) }
      finally { state.importing = null }
    }
    try { state.route = routeOf(agent, this.config) } catch { /* Model becomes available on the first request. */ }
    return workspace
  }

  async forSession(id) {
    if (typeof id !== 'string' || !id) throw new Error('请先打开一个工作区会话')
    if (this.sessions.has(id)) return this.sessions.get(id)
    return this.bind({ session: { id, header: {} } })
  }

  async refresh(workspace) {
    const summary = await this.store.summary(workspace, this.config.summaryChars)
    this.state(workspace).summary = summary
    return summary
  }

  snapshot(agent) {
    if (!rootAgent(agent)) return ''
    return this.workspaces.get(this.sessions.get(agent.session.id))?.summary || ''
  }

  async prepare(agent) {
    if (!rootAgent(agent) || this.closed) return ''
    let workspace
    try {
      workspace = await this.bind(agent)
      const summary = await this.refresh(workspace)
      this.schedule(workspace)
      return summary
    } catch (error) {
      // A corrupt store must never leave an obsolete cached summary in use.
      if (workspace) this.state(workspace).summary = ''
      this.report(workspace || this.sessions.get(agent.session.id) || '', error)
      return ''
    }
  }

  async begin(agent) {
    if (!rootAgent(agent) || this.closed) return
    try {
      const workspace = await this.bind(agent)
      const state = this.state(workspace)
      state.busy.add(agent.session.id)
      clearTimeout(state.timer)
      state.controller?.abort(new Error('会话继续，提取延后'))
    } catch (error) { this.report(this.sessions.get(agent.session.id) || '', error) }
  }

  async end(agent, turn) {
    if (!rootAgent(agent) || this.closed) return
    const content = turnSource(agent, turn)
    let workspace = this.sessions.get(agent.session.id)
    try {
      workspace = await this.bind(agent)
      if (content) await this.store.archive({ workspace, sessionId: agent.session.id, turn, content })
    } catch (error) { this.report(workspace || '', error) }
    finally {
      if (workspace) {
        this.state(workspace).busy.delete(agent.session.id)
        this.schedule(workspace)
      }
    }
  }

  forget(agent) {
    const workspace = this.sessions.get(agent?.session?.id)
    this.sessions.delete(agent?.session?.id)
    if (workspace) {
      this.state(workspace).busy.delete(agent.session.id)
      this.schedule(workspace)
    }
  }

  schedule(workspace) {
    const state = this.state(workspace)
    if (this.closed || state.busy.size || !state.route || this.config.autoExtract === false) return
    clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      this.run(workspace).catch(error => this.report(workspace, error))
    }, this.config.idleMs)
    state.timer.unref?.()
  }

  async run(workspace) {
    const state = this.state(workspace)
    if (this.closed) throw new Error('记忆插件已停止')
    if (state.flight) return state.flight
    if (state.busy.size) throw new Error('当前工作区正在对话，空闲后再整理')
    if (!state.route) throw new Error('尚无可用模型；请先在工作区会话完成一次模型请求')
    state.flight = this.process(workspace, state).finally(() => { state.flight = null })
    return state.flight
  }

  async process(workspace, state) {
    const controller = new AbortController()
    state.controller = controller
    let timer, onAbort
    try {
      const batch = await this.store.nextBatch(workspace)
      if (!batch) return { applied: 0, pending: false }
      controller.signal.throwIfAborted()
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })
      timer = setTimeout(() => controller.abort(new Error('记忆提取超时；原文已保留，可重试')), this.config.requestTimeoutMs)
      if (this.closed || state.busy.size) controller.abort(new Error('会话继续，提取延后'))
      const updates = await Promise.race([extract(this.ctx.llm, state.route, batch, controller.signal), aborted])
      controller.signal.throwIfAborted()
      const result = await this.store.consolidate(workspace, batch, updates)
      await this.refresh(workspace)
      state.error = ''
      const pending = Boolean(await this.store.nextBatch(workspace))
      if (pending) this.schedule(workspace)
      return { ...result, pending }
    } catch (error) {
      if (!controller.signal.aborted || (!state.busy.size && !this.closed)) this.report(workspace, error)
      throw error
    } finally {
      clearTimeout(timer)
      if (onAbort) controller.signal.removeEventListener('abort', onAbort)
      state.controller = null
    }
  }

  async status(workspace) {
    const data = await this.store.load()
    const state = this.state(workspace)
    const visible = item => item.scope === 'user' || item.workspace === workspace
    return { workspace, memories: data.records.filter(visible).length,
      pending: Object.values(data.sources).filter(item => visible(item) && !item.suppressed && item.cursor < item.length).length,
      running: Boolean(state.flight), autoExtract: this.config.autoExtract !== false, error: state.error }
  }

  async mutate(workspace, operation, args) {
    const result = operation === 'delete'
      ? await this.store.remove(args.id, workspace, args.expectedVersion)
      : await this.store.write({ ...args, workspace })
    // User memories are shared: refresh every active workspace after a correction.
    await Promise.all([...this.workspaces.keys()].filter(Boolean).map(key => this.refresh(key)))
    return result
  }

  close() {
    this.closed = true
    for (const state of this.workspaces.values()) {
      clearTimeout(state.timer)
      state.controller?.abort(new Error('记忆插件已停止'))
    }
    this.sessions.clear()
  }
}
