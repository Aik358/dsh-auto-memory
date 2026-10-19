import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withSharedStateLock } from './shared-state-lock.js'
import { retryRename } from './fs-retry.js'
import { digest, redact, memoryText, score, excerpt } from './text.js'

const empty = () => ({ version: 1, revision: 0, records: [], sources: {}, blocked: [], imports: [] })
const visible = (item, workspace) => item.scope === 'user' || item.workspace === workspace
const key = (text, scope, workspace) => digest(JSON.stringify([scope, scope === 'user' ? '' : workspace, text.replace(/\s+/g, ' ').trim()]))
const latest = (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)

export async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: 'wx' })
    await retryRename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

export class MemoryStore {
  constructor(root) {
    this.root = path.resolve(root)
    this.file = path.join(this.root, 'memory.json')
  }

  async load() {
    let state
    try {
      if ((await lstat(this.file)).isSymbolicLink()) throw new Error('记忆库不能是符号链接')
      state = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return empty()
      throw error
    }
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.records)
      || !state.sources || typeof state.sources !== 'object' || Array.isArray(state.sources)
      || !Array.isArray(state.blocked) || !Array.isArray(state.imports)
      || state.records.some(item => !item || typeof item.id !== 'string' || typeof item.text !== 'string'
        || !['project', 'user'].includes(item.scope) || typeof item.workspace !== 'string'
        || !Array.isArray(item.sources) || !Number.isSafeInteger(item.version))
      || Object.entries(state.sources).some(([id, item]) => !item || item.id !== id
        || !/^src_[a-f0-9]{32}$/.test(id) || !['project', 'user'].includes(item.scope)
        || typeof item.workspace !== 'string' || !Number.isSafeInteger(item.length)
        || !Number.isSafeInteger(item.cursor) || item.cursor < 0 || item.cursor > item.length)) {
      throw new Error('记忆库格式损坏；已停止写入，请恢复备份')
    }
    return state
  }

  async transaction(update) {
    return withSharedStateLock(this.file, async () => {
      const state = await this.load()
      const result = await update(state)
      state.revision++
      await atomicWrite(this.file, JSON.stringify(state, null, 2) + '\n')
      return result
    })
  }

  sourcePath(id) {
    if (!/^src_[a-f0-9]{32}$/.test(id)) throw new Error('无效的来源 ID')
    return path.join(this.root, 'sources', `${id}.json`)
  }

  async archive({ workspace, sessionId = '', turn = '', content, scope = 'project', origin = 'session', importKey }) {
    if (!workspace && scope !== 'user') throw new Error('当前会话尚未绑定工作区')
    const safe = redact(content)
    const id = 'src_' + digest(JSON.stringify([workspace, sessionId, turn, origin, safe])).slice(0, 32)
    return this.transaction(async state => {
      if (importKey && state.imports.includes(importKey)) return null
      if (state.sources[id]) {
        if (importKey) state.imports.push(importKey)
        return id
      }
      // Source write precedes its reference; an interrupted transaction can only leave an unindexed file.
      await atomicWrite(this.sourcePath(id), JSON.stringify({ id, workspace, sessionId, turn, origin, content: safe }, null, 2))
      state.sources[id] = { id, workspace, sessionId, turn, scope, origin, createdAt: Date.now(), cursor: 0, length: safe.length, suppressed: false }
      if (importKey) state.imports.push(importKey)
      return id
    })
  }

  async source(id, workspace, offset = 0, limit = 12000) {
    const state = await this.load()
    const meta = state.sources[id]
    if (!meta || !visible(meta, workspace)) throw new Error('来源不存在')
    const file = this.sourcePath(id)
    if ((await lstat(file)).isSymbolicLink()) throw new Error('来源不能是符号链接')
    const source = JSON.parse(await readFile(file, 'utf8'))
    const start = Math.max(0, Math.floor(Number(offset) || 0))
    const end = Math.min(source.content.length, start + Math.max(1, Math.min(24000, Number(limit) || 12000)))
    return { ...meta, content: source.content.slice(start, end), offset: start, nextOffset: end < source.content.length ? end : null }
  }

  async list(workspace, query = '', limit = 30, offset = 0) {
    const state = await this.load()
    offset = Math.max(0, Math.floor(Number(offset) || 0))
    return state.records.filter(record => visible(record, workspace))
      .map(record => ({ ...record, score: query ? score(query, record.text) : 0 }))
      .filter(record => !query || record.score > 0)
      .sort((a, b) => b.score - a.score || latest(a, b))
      .slice(offset, offset + Math.max(1, Math.min(100, Number(limit) || 30)))
  }

  async search(workspace, query, limit = 10, originals = false) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('请输入检索关键词')
    query = query.trim().slice(0, 300)
    const records = await this.list(workspace, query, limit)
    const sources = []
    if (originals) {
      const state = await this.load()
      // Full originals remain on disk; only requested matches enter the prompt.
      for (const meta of Object.values(state.sources)) {
        if (!visible(meta, workspace) || meta.suppressed) continue
        const file = this.sourcePath(meta.id)
        if ((await lstat(file)).isSymbolicLink()) continue
        const source = JSON.parse(await readFile(file, 'utf8'))
        const rank = score(query, source.content)
        if (rank) sources.push({ ...meta, score: rank, excerpt: excerpt(source.content, query) })
      }
      sources.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
    }
    return { records, sources: sources.slice(0, Math.max(1, Math.min(20, Number(limit) || 10))) }
  }

  async read(id, workspace) {
    const state = await this.load()
    const record = state.records.find(item => item.id === id && visible(item, workspace))
    if (!record) throw new Error('记忆不存在')
    return record
  }

  suppress(state, record) {
    state.blocked.push(key(record.text, record.scope, record.workspace))
    state.blocked = [...new Set(state.blocked)]
    // Old evidence must not re-create a user-corrected/deleted memory on a later extraction pass.
    for (const id of record.sources) if (state.sources[id]) state.sources[id].suppressed = true
  }

  async write({ workspace, id, text, scope = 'project', expectedVersion }) {
    text = memoryText(text)
    if (!['user', 'project'].includes(scope)) throw new Error('scope 需为 user 或 project')
    if (!workspace && scope === 'project') throw new Error('当前会话尚未绑定工作区')
    return this.transaction(async state => {
      let record = id ? state.records.find(item => item.id === id && visible(item, workspace)) : null
      if (id && !record) throw new Error('记忆不存在')
      if (record && record.version !== expectedVersion) throw new Error('记忆已变化，请重新读取后再修改')
      if (record) this.suppress(state, record)
      const now = Date.now()
      const sourceId = 'src_' + digest(randomUUID()).slice(0, 32)
      await atomicWrite(this.sourcePath(sourceId), JSON.stringify({ id: sourceId, content: text }, null, 2))
      state.sources[sourceId] = { id: sourceId, workspace: scope === 'user' ? '' : workspace, scope, sessionId: '', origin: 'manual', createdAt: now, cursor: text.length, length: text.length, suppressed: false }
      if (!record) {
        record = { id: 'mem_' + randomUUID(), createdAt: now, version: 0 }
        state.records.push(record)
      }
      Object.assign(record, { text, scope, workspace: scope === 'user' ? '' : workspace, sources: [sourceId], updatedAt: now, version: record.version + 1, manual: true })
      return record
    })
  }

  async remove(id, workspace, expectedVersion) {
    return this.transaction(state => {
      const record = state.records.find(item => item.id === id && visible(item, workspace))
      if (!record) throw new Error('记忆不存在')
      if (record.version !== expectedVersion) throw new Error('记忆已变化，请重新读取后再删除')
      this.suppress(state, record)
      state.records = state.records.filter(item => item.id !== id)
      return { removed: id }
    })
  }

  async nextBatch(workspace, maxChars = 24000) {
    const state = await this.load()
    const meta = Object.values(state.sources).filter(item => visible(item, workspace) && !item.suppressed && item.cursor < item.length)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]
    if (!meta) return null
    const source = await this.source(meta.id, workspace, meta.cursor, maxChars)
    const records = await this.list(workspace, source.content, 40)
    // User corrections are always presented, even when keyword overlap is low.
    const manual = state.records.filter(item => visible(item, workspace) && item.manual).sort(latest).slice(0, 20)
    let budget = 16000
    const candidates = [...new Map([...manual, ...records].map(item => [item.id, item])).values()].filter(item => {
      budget -= item.text.length + 150
      return budget >= 0
    })
    return { source, records: candidates, expectedCursor: meta.cursor, end: source.nextOffset ?? meta.length }
  }

  async consolidate(workspace, batch, updates) {
    if (!Array.isArray(updates) || updates.length > 20) throw new Error('提取结果必须包含至多 20 条 memories')
    // Validate the complete response before committing anything.
    const prepared = updates.map(item => {
      if (!item || !['project', 'user'].includes(item.scope)) throw new Error('提取结果 scope 无效')
      if (batch.source.scope === 'user' && item.scope !== 'user') throw new Error('用户级旧资料只能生成用户级记忆')
      if (item.id && !batch.records.some(record => record.id === item.id)) throw new Error('提取结果引用未知记忆')
      return { ...item, text: memoryText(item.text) }
    })
    return this.transaction(state => {
      const meta = state.sources[batch.source.id]
      if (!meta || meta.suppressed || meta.cursor !== batch.expectedCursor) return { applied: 0, stale: true }
      let applied = 0
      for (const item of prepared) {
        if (state.blocked.includes(key(item.text, item.scope, workspace))) continue
        let record = item.id ? state.records.find(candidate => candidate.id === item.id && visible(candidate, workspace)) : null
        if (item.id) {
          const previous = batch.records.find(candidate => candidate.id === item.id)
          if (!record || record.manual || record.version !== previous.version || record.scope !== item.scope) continue
        } else {
          record = state.records.find(candidate => key(candidate.text, candidate.scope, candidate.workspace) === key(item.text, item.scope, workspace))
          if (record?.manual) continue
        }
        const now = Date.now()
        if (!record) {
          record = { id: 'mem_' + randomUUID(), createdAt: now, version: 0, sources: [], manual: false }
          state.records.push(record)
        }
        Object.assign(record, { text: item.text, scope: item.scope, workspace: item.scope === 'user' ? '' : workspace,
          sources: [...new Set([...record.sources, meta.id])], updatedAt: now, version: record.version + 1 })
        applied++
      }
      meta.cursor = batch.end
      return { applied, remaining: meta.cursor < meta.length }
    })
  }

  async summary(workspace, budget = 3000) {
    const records = await this.list(workspace, '', 100)
    const lines = ['<memory_summary>', '以下是历史背景；当前用户指令优先。详情按需 memory_search / memory_read，原文用 memory_source。']
    for (const record of records) {
      const line = `- [${record.id}] ${record.scope === 'user' ? '用户' : '项目'}：${record.text.replace(/\s+/g, ' ')}`
      if (lines.join('\n').length + line.length + 20 > budget) continue
      lines.push(line)
    }
    if (lines.length === 2) return ''
    lines.push('</memory_summary>')
    return lines.join('\n')
  }
}
