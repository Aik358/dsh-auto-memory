import assert from 'node:assert/strict'
import { createFactStorePre } from '../../lib/fact-store.js'

/**
 * 1.2 第1步验收：冲突集迁出 facts.json（独立文件）+ legacy 存量清空。
 *
 * 背景（用户 2026-11-09 裁定）：「插件是面向用户的，用户升级以后也要清空，
 * 所以建议换个路径」⇒ 冲突不再写进 facts.json，改存 hub/facts-conflicts.json；
 * 老用户升级后 facts.json 首次重写即自然瘦身，旧 conflicts 段丢弃并计数。
 *
 * 全部断言为**真执行**：真构造 → 真 restore/upsert → 断言返回值与 IO 副作用。
 */

let pass = 0
let fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message)) }
}

/** 造一对记录 IO 的内存适配器，能观测「谁写了什么」。 */
function mkIo(initialFacts, opts = {}) {
  const box = { savedFacts: null, savedConflicts: null, clears: 0 }
  const io = {
    save(d) { box.savedFacts = d },
    load() { return initialFacts || null },
    clear() { box.clears++ },
  }
  if (opts.transaction !== false) {
    // 真实 hub-io 的 transaction 会把**盘上最新**交进来；桩必须照此语义，
    // 否则跨事务丢事实（首版桩恒返回 null，第二条 upsert 看不到第一条 ⇒ 不产生冲突）。
    io.transaction = (job) => job(box.savedFacts || initialFacts || null)
  }
  const conflictsIo = {
    save(d) { box.savedConflicts = d },
    load() { return opts.conflictsFile || null },
    clear() { box.clears++ },
  }
  return { box, io, conflictsIo }
}

const legacyConflict = (i) => ({
  conflictId: 'legacy_' + i,
  scope: 'Workspace', subject: '<!-- dsh-status: current -->', predicate: '记录要点',
  left: { factId: 'l' + i, subject: '<!-- dsh-status: current -->', predicate: '记录要点', object: 'a' },
  right: { factId: 'r' + i, subject: '<!-- dsh-status: current -->', predicate: '记录要点', object: 'b' },
  detectedAt: 1700000000000 + i, resolved: false,
})

console.log('[1.2-1] snapshot 不再含 conflicts 键')
t('★ snapshot() 无 conflicts 字段（facts.json 从此只存事实）', () => {
  const { io, conflictsIo } = mkIo(null)
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  const snap = s.snapshot()
  assert.equal(snap.conflicts, undefined, 'snapshot 不得再含 conflicts')
  assert.equal(snap.namespace, 'dsh-auto-memory-pre')
  assert.ok(Array.isArray(snap.facts))
})
t('conflictsSnapshot() 独立产出（命名空间可区分）', () => {
  const { io, conflictsIo } = mkIo(null)
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  const cs = s.conflictsSnapshot()
  assert.equal(cs.namespace, 'dsh-auto-memory-pre-conflicts')
  assert.ok(Array.isArray(cs.conflicts))
})

console.log('[1.2-1] legacy 存量清空（升级路径）')
t('★ 旧 facts.json 带 120 条 conflicts ⇒ restore 后全部丢弃并计数', () => {
  const legacy = {
    schemaVersion: 1, namespace: 'dsh-auto-memory-pre', savedAt: 1,
    facts: [], teamReceipts: {},
    conflicts: Array.from({ length: 120 }, (_, i) => legacyConflict(i)),
  }
  const { io, conflictsIo } = mkIo(legacy)
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  const r = s.restore(legacy)
  assert.equal(r.ok, true)
  assert.equal(s.getLegacyConflictsDropped(), 120, '未计数 = 静默丢弃')
  assert.equal(s.conflictCount, 0, 'legacy 冲突不得被装回内存')
})
t('重复 restore 不重复累加（事务每轮都会重放，计数必须幂等）', () => {
  const legacy = {
    schemaVersion: 1, facts: [], teamReceipts: {},
    conflicts: Array.from({ length: 7 }, (_, i) => legacyConflict(i)),
  }
  const { io, conflictsIo } = mkIo(legacy)
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  s.restore(legacy); s.restore(legacy); s.restore(legacy)
  assert.equal(s.getLegacyConflictsDropped(), 7, 'got=' + s.getLegacyConflictsDropped())
})
t('负路径：新格式（无 conflicts 键）⇒ 计数保持 0，不误报', () => {
  const fresh = { schemaVersion: 1, facts: [], teamReceipts: {} }
  const { io, conflictsIo } = mkIo(fresh)
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  s.restore(fresh)
  assert.equal(s.getLegacyConflictsDropped(), 0)
})

console.log('[1.2-1] 新冲突写独立文件，facts.json 保持干净')
t('★ 产生冲突 ⇒ conflictsIo 收到数据，io.save 收到的快照不含 conflicts', () => {
  const { box, io, conflictsIo } = mkIo(null)
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  s.upsert({ scope: 'Workspace', subject: 'dsh-auto-memory', predicate: '构建工具', object: 'esbuild', sourceKind: 'explicit' })
  s.upsert({ scope: 'Workspace', subject: 'dsh-auto-memory', predicate: '构建工具', object: 'rollup', sourceKind: 'explicit' })
  assert.equal(s.conflictCount, 1)
  assert.ok(box.savedConflicts, '冲突集必须落到独立 IO')
  assert.equal(box.savedConflicts.conflicts.length, 1)
  assert.equal(box.savedConflicts.namespace, 'dsh-auto-memory-pre-conflicts')
  assert.ok(box.savedFacts, 'facts 也必须落盘')
  assert.equal(box.savedFacts.conflicts, undefined, 'facts.json 不得再夹带 conflicts')
})
t('无冲突变更时不额外写冲突文件（避免每次 flush 多一次 IO）', () => {
  const { box, io, conflictsIo } = mkIo(null)
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  s.upsert({ scope: 'Workspace', subject: 'a', predicate: 'p', object: '1', sourceKind: 'explicit' })
  assert.equal(box.savedConflicts, null, '无冲突变更不应写 conflicts 文件')
})
t('★ 冲突集能从独立文件装载回来（重启后待裁定不丢）', () => {
  const file = { schemaVersion: 1, namespace: 'dsh-auto-memory-pre-conflicts', conflicts: [legacyConflict(0)] }
  const { io, conflictsIo } = mkIo(null, { conflictsFile: file })
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  assert.equal(s.conflictCount, 1, '懒装载失败：重启后待裁定会消失')
  assert.equal(s.pendingConflicts().length, 1)
})

console.log('[1.2-1] 解析冲突不影响 1.3b 守卫')
t('负路径：非三元组 subject 仍不产生冲突（1.3b 回归）', () => {
  const { box, io, conflictsIo } = mkIo(null)
  const s = createFactStorePre({ config: {}, io, conflictsIo })
  for (let i = 0; i < 5; i++) {
    s.upsert({ scope: 'Workspace', subject: '2026-09-22', predicate: '记录要点', object: 'v' + i, sourceKind: 'explicit' })
  }
  assert.equal(s.conflictCount, 0)
})

console.log('')
console.log('[fact-store-conflict-split] pass=' + pass + ' fail=' + fail)
if (fail) process.exitCode = 1
