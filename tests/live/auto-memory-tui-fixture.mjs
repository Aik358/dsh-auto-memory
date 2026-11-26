import assert from 'node:assert/strict'
import { setTimeout as wait } from 'node:timers/promises'
import { runTui } from '../../lib/terminal/tui.js'

const identity = { instanceId: 'pty-test', pluginVersion: '3.4.4', buildId: 'fixture', harness: 'dsh', profile: 'pty-fixture' }
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const string = { type: 'string' }
const integer = { type: 'integer' }
const op = (id, title, group, inputSchema = schema(), access = 'read', status = 'available') => ({
  id, title, group, inputSchema, access, status, scope: 'session',
  approval: access === 'read' ? 'none' : 'explicit-confirmation', resultSchema: true,
})
const operations = [
  op('status', '实时状态', 'system'),
  op('memory.overview', '项目记忆', 'memory'),
  op('memory.recall', '检索记忆', 'memory', schema({ query: string }, ['query'])),
  op('memory.source', '回读来源', 'memory', schema({ path: string }, ['path'])),
  op('settings.set', '保存设置', 'settings', schema({ patch: schema({ enabled: { type: 'boolean' } }), revision: string }, ['patch', 'revision']), 'write'),
  op('board.events.list', '事件流和检查点', 'board', schema({ cursor: integer, limit: integer, status: string })),
  op('board.events.detail', '事件详情与来源', 'board', schema({ id: string }, ['id'])),
  op('board.kanban', '白板泳道', 'board'),
  op('board.card', '回读完整卡片', 'board', schema({ id: string }, ['id'])),
  op('board.continue.status', '接续状态', 'board'),
  op('board.continue.decide', '处理接续请求', 'board', schema({ action: string, edgeAt: integer }, ['action']), 'write'),
  op('system.workspaces', '工作区', 'system'),
  op('future.inspect', '未来诊断', 'system', schema({ filters: { type: 'array', items: schema({ mode: { enum: ['deep'] } }) } }, ['filters'])),
  op('jobs.cancel', '取消后台任务', 'jobs', schema({ id: string }, ['id']), 'write', 'unavailable'),
  op('jobs.wait', '测试慢读取', 'jobs'),
  op('jobs.fail', '测试权限拒绝', 'jobs'),
]
const workspace = 'D:\\测试资料\\记忆项目\\2026-11-26\\很长的工作区路径\\隔离环境'
const start = Date.UTC(2026, 10, 16, 10)
const events = Array.from({ length: 240 }, (_, index) => ({
  id: `event-${index + 1}`, name: `事件 ${String(index + 1).padStart(3, '0')} · ${index % 2 ? 'P1' : 'P1 R2'} 会话检索 ${index === 0 ? '🧭' : ''}`,
  status: index % 3 === 0 ? 'closed' : index % 3 === 1 ? 'active' : 'paused',
  kind: 'ledger', startMs: start + index * 3600000, endMs: start + (index + 5) * 3600000,
  checkpointQuad: [{ at: start + index * 3600000 }, { at: start + (index + 5) * 3600000 }],
  summary: '验证已提交索引、白板状态和历史会话中的来源回读。',
}))
const longText = [
  '# 已提交索引验证', '## 工作区回读',
  ...Array.from({ length: 90 }, (_, index) => `段落 ${index + 1}。长正文可完整翻阅 📚 ${workspace}\\资料\\包含空格的原文文件.md`),
  '\x1b]2;UNTRUSTED_OSC_PAYLOAD\x07\x1b[2J\x1b[31m正文保持可见\x1b[0m',
  '最终段落 · 已保留末尾内容',
].join('\n')
const receipts = new Map()
let currentRevision = 1
let statusReads = 0
let clock = 0
const continuation = [
  { status: { armed: { edgeAt: 100 }, executing: false }, args: { action: 'agree', edgeAt: 100 } },
  { status: { armed: { edgeAt: 200 }, executing: false }, args: { action: 'reject', edgeAt: 200 } },
  { status: { armed: { edgeAt: 300 }, executing: false }, args: { action: 'cancel', edgeAt: 300 } },
  { status: { executing: true, execution: { edgeAt: 400, canCancel: true } }, args: { action: 'cancel', edgeAt: 400 } },
  { status: { executing: false }, args: { action: 'manual' } },
]
const countStatus = () => ++statusReads
const client = {
  async discover({ scope }) {
    if (scope.workspace === 'unauthorized') throw new Error('工作区未授权')
    return { contractVersion: '1.0', identity, operations }
  },
  async call(id, args, { signal, scope, instanceId, approved, requestId } = {}) {
    assert.equal(instanceId, identity.instanceId)
    if (id === 'status') {
      ++clock
      if (process.env.DAM_TUI_TEST_CONNECTION === '1' && clock === 3) throw new Error('测试装置已断开')
      return { revision: `${currentRevision}.${countStatus()}`, scope, index: 'ready', delivery: { state: 'delivered' }, engine: 'lexical' }
    }
    if (id === 'board.events.list') {
      const start = args.cursor ?? 0
      const filtered = scope.workspace === 'D:\\空工作区' ? [] : events.filter(event => !args.status || event.status === args.status)
      if (args.all === 1) return { events: filtered, total: filtered.length, nextCursor: null }
      const end = start + (args.limit ?? 120)
      return { events: filtered.slice(start, end), total: filtered.length, nextCursor: end < filtered.length ? end : null }
    }
    if (id === 'board.events.detail') {
      const event = events.find(item => item.id === args.id)
      assert.ok(event)
      return { event: { ...event, revision: 'event-revision-1', checkpoints: [{ goal: '读到提交后的索引', state: longText, dead: '构建中保留旧结果', next: '校验来源', sourceRef: `${workspace}\\checkpoints.md`, quoteLine: 42 }] } }
    }
    if (id === 'board.kanban') return { lanes: [{ key: 'active', title: '处理中', cards: [{ id: 'card-1', title: '来源与原文', docTitle: 'PLAN.md' }] }] }
    if (id === 'board.card') return { id: args.id, content: '# PLAN\n完整卡片末尾' }
    if (id === 'board.continue.status') return continuation[0]?.status ?? { executing: true, execution: { edgeAt: 500, canCancel: false } }
    if (id === 'board.continue.decide') {
      assert.equal(approved, true)
      assert.match(requestId, /^[a-f0-9-]{36}$/)
      assert.equal(scope.workspace, workspace)
      assert.deepEqual(args, continuation.shift().args)
      return { outcome: '接续操作已确认' }
    }
    if (id === 'system.workspaces') return { workspaces: [
      { cwd: workspace }, { cwd: 'D:\\空工作区' }, { cwd: 'unauthorized' }, { cwd: workspace, sessionId: 'pty-session' },
    ] }
    if (id === 'memory.overview') return { 项目: scope.workspace, 规约: longText }
    if (id === 'memory.recall') {
      if (args.query === '后台检索夹具') {
        await wait(2500, null, { signal })
        assert.equal(scope.workspace, workspace)
        assert.equal(scope.sessionId, 'pty-session')
      }
      return { result: `找到 ${args.query}`, hits: [{ path: `${workspace}\\checkpoints.md`, title: '原文检查点' }] }
    }
    if (id === 'memory.source') return { path: args.path, content: longText }
    if (id === 'future.inspect') {
      assert.deepEqual(args, { filters: [{ mode: 'deep' }] })
      return { result: ['未来契约', { nested: { value: 42 } }] }
    }
    if (id === 'jobs.wait') {
      await wait(10000, null, { signal })
      throw new Error('应在完成前取消')
    }
    if (id === 'jobs.fail') throw Object.assign(new Error('读取范围未授权'), { code: 'forbidden' })
    if (id === 'settings.set') {
      assert.equal(approved, true)
      assert.match(requestId, /^[a-f0-9-]{36}$/)
      assert.deepEqual(args, { patch: { enabled: true }, revision: 'rev-1' })
      ++currentRevision
      receipts.set(requestId, { state: 'finished', result: { revision: 'rev-2' } })
      return receipts.get(requestId).result
    }
    throw new Error(`Unexpected fixture operation ${id}`)
  },
  async receipt(requestId) {
    assert.ok(receipts.has(requestId))
    return receipts.get(requestId)
  },
}

process.exitCode = await runTui({ client, scope: { workspace, sessionId: 'pty-session' }, interval: 650 })
