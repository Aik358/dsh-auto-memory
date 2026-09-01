// M8-0 Fact Store 纯核心验证(docs/proactive-associative-memory-system-map.html M-03)
// F1 基础 upsert: 新建/合并/推断不覆盖/冲突入集
// F2 冲突: 定义/解析(left/right)/pending 视图
// F3 supersede: 显式取代 → 旧 revoked + 新落库
// F4 TTL: 过期过滤 + 永不过期默认
// F5 持久化: 可注入 IO save/restore 幂等 + 坏记录跳过
// F6 judgement-shadow 消费: 8 类只取 semantic/profile + supersede_suggest 走 supersede + 幂等去重
// F7 M5 evidence 挂钩: evidenceFor 聚合六类计数 + 去重 session
// F8 卫生: 零进程/网络原语静态扫描
import { createFactStorePre, validateFactCandidatePre, validateFactPre, isFactConflict,
  factCandidateFromJudgementRow, ingestJudgementRows, FACT_ID_RE } from '../../lib/fact-store.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }

// 内存 IO + 确定性时钟
function memIO() {
  let saved = null
  return {
    io: { save: (s) => { saved = s }, load: () => saved ? saved.facts : [], clear: () => { saved = null } },
    get saved() { return saved }, set saved(v) { saved = v },
  }
}
let fakeNow = 1000000
const now = () => fakeNow

console.log('[F1] 基础 upsert')
{
  const io = memIO()
  const s = createFactStorePre({ io: io.io, now })
  // 新建 explicit
  const r1 = s.upsert({ scope: 'Workspace', subject: '项目', predicate: '构建工具', object: 'esbuild', sourceKind: 'explicit', sourceClass: 'user-memory', provenance: ['user-message-1'] })
  ok(r1.ok && r1.outcome === 'created' && r1.fact.factId.match(FACT_ID_RE), 'explicit 新建 created + factId 形状')
  // 合并 explicit 追加 provenance(同 subject+predicate+object 不冲突)
  const r2 = s.upsert({ scope: 'Workspace', subject: '项目', predicate: '构建工具', object: 'esbuild', sourceKind: 'explicit', sourceClass: 'workspace-notes', provenance: ['note-2'] })
  ok(r2.ok && r2.outcome === 'merged' && r2.fact.provenance.length === 2, '同值合并 merged + provenance 追加到 2')
  // 推断不覆盖已有: 同 object 的推断(重复确认)不覆盖已确认事实 → inference-blocked
  const r3 = s.upsert({ scope: 'Workspace', subject: '项目', predicate: '构建工具', object: 'esbuild', sourceKind: 'inference', sourceClass: 'semantic-candidate', provenance: ['obs_1'] })
  ok(r3.ok && r3.outcome === 'inference-blocked', '同值推断不覆盖 explicit → inference-blocked')
  // 冲突: 同 subject+predicate 不同 object 的显式声明 → 入冲突集(元代码:冲突检测先于推断覆盖)
  const r3b = s.upsert({ scope: 'Workspace', subject: '项目', predicate: '构建工具', object: 'webpack', sourceKind: 'inference', sourceClass: 'semantic-candidate', provenance: ['obs_2'] })
  ok(r3b.ok && r3b.outcome === 'conflict-added', '不同 object 推断也先入冲突集(待用户裁决)')
  // 显式不同 object → 冲突
  const r4 = s.upsert({ scope: 'Workspace', subject: '项目', predicate: '构建工具', object: 'webpack', sourceKind: 'explicit', provenance: ['user-2'] })
  ok(r4.ok && r4.outcome === 'conflict-added' && s.conflictCount === 2, '不同 object 显式声明 → conflict-added')
  // validator 反例
  ok(!validateFactCandidatePre({ scope: 'Bad', subject: 'x', predicate: 'y', sourceKind: 'explicit' }).ok, '坏 scope 拒绝')
  ok(!validateFactCandidatePre({ scope: 'Workspace', subject: '', predicate: 'y', sourceKind: 'explicit' }).ok, '空 subject 拒绝')
  ok(!validateFactCandidatePre({ scope: 'Workspace', subject: 'x', predicate: 'y', sourceKind: 'bad' }).ok, '坏 sourceKind 拒绝')
}

console.log('[F2] 冲突解析')
{
  const io = memIO()
  const s = createFactStorePre({ io: io.io, now })
  s.upsert({ scope: 'Workspace', subject: '端口', predicate: '默认值', object: '3080', sourceKind: 'explicit', provenance: ['a'] })
  const r = s.upsert({ scope: 'Workspace', subject: '端口', predicate: '默认值', object: '9090', sourceKind: 'explicit', provenance: ['b'] })
  ok(r.outcome === 'conflict-added', '冲突入集')
  const pc = s.pendingConflicts()
  ok(pc.length === 1 && !pc[0].resolved, 'pendingConflicts 可见未解析')
  const cid = pc[0].conflictId
  // 解析 left: 保留旧(3080), 新(9090)不落库
  const rl = s.resolveConflict(cid, 'left')
  ok(rl.ok && rl.conflict.choice === 'left' && s.pendingConflicts().length === 0, 'resolve left 保留旧')
  ok(s.get('Workspace', '端口', '默认值').object === '3080', 'left 后仍是旧值 3080')
  // 新冲突 resolve right: 旧 revoked + 新落库
  const r2 = s.upsert({ scope: 'Workspace', subject: '端口', predicate: '默认值', object: '9090', sourceKind: 'explicit', provenance: ['c'] })
  ok(r2.outcome === 'conflict-added', '再冲突入集')
  const pc2 = s.pendingConflicts()
  ok(s.resolveConflict(pc2[0].conflictId, 'right').ok, 'resolve right')
  ok(s.get('Workspace', '端口', '默认值').object === '9090', 'right 后采用新值 9090')
  ok(s.snapshot({ includeRevoked: true }).facts.filter((f) => f.subject === '端口' && f.revoked).length === 1, '旧值被 revoked 保留')
  ok(!s.resolveConflict('nope', 'left').ok, '未知 conflictId 拒绝')
  ok(!s.resolveConflict(pc2[0].conflictId, 'left').ok, '已解析再解析拒绝')
}

console.log('[F3] supersede')
{
  const io = memIO()
  const s = createFactStorePre({ io: io.io, now })
  s.upsert({ scope: 'Workspace', subject: '模型', predicate: '默认档', object: 'lexical', sourceKind: 'explicit', provenance: ['a'] })
  const r = s.supersede({ scope: 'Workspace', subject: '模型', predicate: '默认档', object: 'c2', sourceKind: 'explicit', provenance: ['b'] })
  ok(r.ok && r.outcome === 'created', 'supersede 后新事实 created')
  const snap = s.snapshot({ includeRevoked: true })
  ok(snap.facts.filter((f) => f.subject === '模型' && f.revoked).length === 1, '旧事实 revoked=true 保留')
  ok(s.get('Workspace', '模型', '默认档').object === 'c2', '查询返回新值 c2')
}

console.log('[F4] TTL')
{
  const io = memIO()
  const s = createFactStorePre({ io: io.io, now })
  s.upsert({ scope: 'Workspace', subject: '临时', predicate: '任务', object: 'x', sourceKind: 'explicit', ttl: 100, provenance: ['a'] })
  ok(s.get('Workspace', '临时', '任务') !== null, 'TTL 内可见')
  fakeNow += 101
  ok(s.get('Workspace', '临时', '任务') === null, 'TTL 过期后不可见')
  ok(s.snapshot({ includeRevoked: true }).facts.length === 1, '过期记录保留(审计)')
  fakeNow = 1000000
}

console.log('[F5] 持久化 + 恢复')
{
  const io = memIO()
  const s1 = createFactStorePre({ io: io.io, now })
  s1.upsert({ scope: 'Workspace', subject: 'A', predicate: 'B', object: 'c', sourceKind: 'explicit', provenance: ['x'] })
  s1.upsert({ scope: 'Workspace', subject: 'A', predicate: 'B', object: 'd', sourceKind: 'explicit', provenance: ['y'] }) // 冲突
  ok(io.saved && io.saved.facts.length === 1 && io.saved.conflicts.length === 1, 'save 落盘(1 fact + 1 conflict)')
  // 新实例 restore
  const s2 = createFactStorePre({ io: io.io, now })
  const r = s2.restore(io.saved)
  ok(r.ok && r.restored === 1, 'restore 恢复 1 fact')
  ok(s2.get('Workspace', 'A', 'B').object === 'c', 'restore 后查询正常')
  ok(s2.conflictCount === 1, 'restore 后冲突保留')
  // 坏记录跳过
  const bad = { schemaVersion: 1, facts: [{ factId: 'bad', scope: 'Workspace', subject: 'x', predicate: 'y' }], conflicts: [] }
  const r2 = s2.restore(bad)
  ok(r2.ok && r2.restored === 0, '坏记录跳过(幂等恢复)')
  // clear
  s2.clear()
  ok(s2.size === 0 && s2.conflictCount === 0, 'clear 清空')
}

console.log('[F6] judgement-shadow 消费')
{
  const io = memIO()
  const s = createFactStorePre({ io: io.io, now })
  const rows = [
    { schemaVersion: 1, policyVersion: 'judgement_shadow_v1', observationId: 'obs_1', contextVersion: 1, memoryIndexVersion: 'idx_x', kindCandidate: 'semantic_candidate', suggestion: 'keep_suggest', sourceIds: ['mem_a'], supportEvidence: {}, counterEvidence: {}, confidence: 0.7, subject: '项目', predicate: '构建工具', object: 'esbuild', scope: 'Workspace' },
    { schemaVersion: 1, policyVersion: 'judgement_shadow_v1', observationId: 'obs_2', contextVersion: 1, memoryIndexVersion: 'idx_x', kindCandidate: 'profile_candidate', suggestion: 'supersede_suggest', sourceIds: ['mem_b'], supportEvidence: {}, counterEvidence: {}, confidence: 0.8, subject: '偏好', predicate: '语言', object: 'python', scope: 'User' },
    { schemaVersion: 1, policyVersion: 'judgement_shadow_v1', observationId: 'obs_3', contextVersion: 1, memoryIndexVersion: 'idx_x', kindCandidate: 'noise', suggestion: 'discard_suggest', sourceIds: ['mem_c'], supportEvidence: {}, counterEvidence: {}, confidence: 0.1 },
    { schemaVersion: 1, policyVersion: 'judgement_shadow_v1', observationId: 'obs_4', contextVersion: 1, memoryIndexVersion: 'idx_x', kindCandidate: 'procedure_candidate', suggestion: 'promote_suggest', sourceIds: ['mem_d'], supportEvidence: {}, counterEvidence: {}, confidence: 0.6 },
  ]
  const r = ingestJudgementRows(s, rows, {})
  ok(r.results.length === 4, '4 行全处理')
  ok(r.results[0].outcome === 'created', 'semantic_candidate → upsert created')
  ok(r.results[1].outcome === 'created' && s.get('User', '偏好', '语言').object === 'python', 'profile_candidate + supersede_suggest → 新事实')
  ok(r.results[2].skipped === true && r.results[3].skipped === true, 'noise/procedure_candidate 跳过(非 fact 类)')
  ok(s.size === 2, '共 2 fact 落库')
  // 幂等: 同 observationId 再喂一次 → 全 skipped
  const r2 = ingestJudgementRows(s, rows, { seenObservationIds: r.seenObservationIds })
  ok(r2.results.every((x) => x.skipped), '同 obs 重放全部跳过(幂等)')
}

console.log('[F7] M5 evidence 挂钩')
{
  const io = memIO()
  const s = createFactStorePre({ io: io.io, now })
  const evs = [
    { kind: 'seen', memoryId: 'mem_x', sessionRef: 'sesr_1' },
    { kind: 'read', memoryId: 'mem_x', sessionRef: 'sesr_1' },
    { kind: 'cite', memoryId: 'mem_x', sessionRef: 'sesr_1' },
    { kind: 'reuse', memoryId: 'mem_x', sessionRef: 'sesr_1' },
    { kind: 'success', memoryId: 'mem_x', sessionRef: 'sesr_1' },
    { kind: 'success', memoryId: 'mem_x', sessionRef: 'sesr_2' },
    { kind: 'correction', memoryId: 'mem_x', sessionRef: 'sesr_2' },
    { kind: 'read', memoryId: 'mem_other', sessionRef: 'sesr_9' },
  ]
  const e = s.evidenceFor('mem_x', evs)
  ok(e.total === 7 && e.seen === 1 && e.read === 1 && e.cite === 1 && e.reuse === 1 && e.success === 2 && e.correction === 1, '六类计数正确')
  ok(e.distinctSessions === 2, '去重 session=2')
  ok(s.evidenceFor('mem_x', []).total === 0, '空证据 → 0')
}

console.log('[F8] 卫生静态扫描')
{
  const src = readFileSync(new URL('../../lib/fact-store.js', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
  const bad = ['child' + '_process', 'node:' + 'net', 'node:' + 'http', 'spaw' + 'n', 'exec' + 'File', 'fetch' + '(']
  ok(!bad.some((b) => code.includes(b)), '零进程/网络原语')
  ok(!code.includes('console.log'), '零 stdout 污染')
}

console.log(`[M8-0] pass=${pass} fail=${fail}`)
process.exit(fail > 0 ? 1 : 0)
