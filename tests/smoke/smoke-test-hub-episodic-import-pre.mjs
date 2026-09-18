// 回归:episodic_candidate 逐行消费不得覆写已巩固 episodes(restore 整体替换语义误用)
// + restore 的 current 形状校验(损坏快照置 null 而非让 consolidate 恒 TypeError)。
import { createEpisodicStorePre } from '../../lib/episodic-store.js'
import { createMemoryHubPre } from '../../lib/memory-hub.js'

let pass = 0, fail = 0
function ok(cond, msg) { if (cond) { pass++; console.log('  ok - ' + msg) } else { fail++; console.error('  FAIL - ' + msg) } }

// 无 IO 的内存 store(与 hub 装配一致的最小形态)
const mkEpisodic = () => createEpisodicStorePre({ io: { save() {}, load() { return null }, clear() {} }, nowFn: () => 1700000000000 + (globalThis.__tick = (globalThis.__tick || 0) + 1) })

// —— 1) hub 逐行喂 episodic_candidate(缺必填键,与 worker 实际字段集一致)不得清空已巩固 episodes ——
{
  const episodic = mkEpisodic()
  const hub = createMemoryHubPre({ stores: { episodic } })
  // 先造一条真实 episode:append 两段 → consolidate
  episodic.append({ sessionRef: 'sr-1', userText: '帮我把部署脚本改成幂等写法并验证一遍', assistantText: '已完成部署脚本幂等改造并回归验证通过', eventSeq: 1, contextVersion: 1 })
  episodic.append({ sessionRef: 'sr-1', userText: '再把回滚步骤补上', assistantText: '回滚步骤已补齐并演练成功', eventSeq: 2, contextVersion: 1 })
  ok(episodic.hasCurrent, '前置:append 后 current 缓冲存在')
  const c = episodic.consolidate()
  ok(c.ok && !!c.episode, '前置:consolidate 产出真实 episode (got ' + JSON.stringify(c) + ')')
  ok(episodic.size >= 1, '前置:episodes 非空 size=' + episodic.size)
  // consolidate 会消费掉 current;再造一段进行中缓冲,验证候选行不清空它
  episodic.append({ sessionRef: 'sr-1', userText: '继续跟进部署验证的后续观察记录', assistantText: '观察确认幂等写法生效', eventSeq: 3, contextVersion: 1 })
  ok(episodic.hasCurrent, '前置:新 current 缓冲存在')

  // worker_semantic_v1.py 实际发出的 episodic_candidate 行形状(仅 schemaVersion+observation 等,缺 9 项必填)
  const candidateRow = {
    schemaVersion: 1, namespace: 'dsh-auto-memory', policyVersion: 'm7-activation-v2',
    observationId: 'obs_test_1', contextVersion: 1, memoryIndexVersion: 1,
    kindCandidate: 'episodic_candidate', suggestion: '沉淀为情景记忆',
    sourceIds: ['mem_x'], supportEvidence: [], counterEvidence: [], confidence: 0.6,
  }
  const r1 = hub.ingestJudgement(candidateRow)
  ok(r1.consumed === 'episodic', '候选行仍被 episodic 层消费 (got ' + JSON.stringify(r1) + ')')
  ok(String(r1.outcome).startsWith('rejected'), '但 outcome 如实报 rejected (got ' + r1.outcome + ')')
  ok(episodic.size >= 1, '回归点:已巩固 episode 未被清空 size=' + episodic.size)
  ok(episodic.hasCurrent, '回归点:current 缓冲未被清空')
  const r2 = hub.ingestJudgement({ ...candidateRow, observationId: 'obs_test_2' })
  ok(episodic.size >= 1, '再次喂行仍不清空 size=' + episodic.size)
  void r2
}

// —— 2) 合法 episode 走 importEpisodes 能进 ——
{
  const episodic = mkEpisodic()
  const hub = createMemoryHubPre({ stores: { episodic } })
  const valid = {
    episodeId: 'epi_' + 'a'.repeat(32), sessionRef: 'sr-2', intent: '跑通索引同步',
    actions: ['begin', 'page', 'commit'], entities: [], unresolved: [],
    outcome: 'success', provenance: ['seg-1'], startedAt: 1700000000000, success: true,
  }
  const r = hub.ingestJudgement({ schemaVersion: 1, kindCandidate: 'episodic_candidate', ...valid })
  ok(r.outcome === 'restored', '合法 episode 导入成功 (got ' + JSON.stringify(r) + ')')
  ok(episodic.size === 1, '导入后 size=1')
  // 幂等:同 episodeId 再喂不重复
  hub.ingestJudgement({ schemaVersion: 1, kindCandidate: 'episodic_candidate', ...valid })
  ok(episodic.size === 1, '同 episodeId 幂等去重')
}

// —— 3) restore 对损坏 current 置 null(不抛),consolidate 不再 TypeError ——
{
  const episodic = mkEpisodic()
  const bad = episodic.restore({ schemaVersion: 1, episodes: [], current: {} })
  ok(bad.ok === true, 'restore 恢复成功(坏 current 被驯化)')
  ok(episodic.hasCurrent === false, '坏 current → 置 null')
  const c = episodic.consolidate()
  ok(c && typeof c === 'object', 'consolidate 不再抛 TypeError (got ' + JSON.stringify(c) + ')')
  // 合法 current 仍被接受
  const good = episodic.restore({ schemaVersion: 1, episodes: [], current: { sessionRef: 'sr-3', startedAt: 1, segments: [], userTexts: [], assistantTexts: [] } })
  ok(good.ok && episodic.hasCurrent, '合法 current 保留')
  // 非对象/缺字段一律置 null
  episodic.restore({ schemaVersion: 1, episodes: [], current: 'junk' })
  episodic.restore({ schemaVersion: 1, episodes: [], current: { sessionRef: 'x', startedAt: 1, segments: 'not-array', userTexts: [], assistantTexts: [] } })
  ok(episodic.hasCurrent === false, '缺字段/类型错 current → 置 null')
}

console.log(`\n[episodic-import] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
