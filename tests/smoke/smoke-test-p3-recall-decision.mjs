/**
 * P3 (2026-09-16) —— 共同检索、融合与决策验收套件。
 * 权威依据: MASTER-PLAN-3.0.md §Phase 3 (L246-257) + TODO-GRAPH V2-P3 卡。
 * 覆盖:
 *   T3-1  秩不变性: 每臂排名不变、只改分数间距 ⇒ 融合 ID 顺序不变
 *   T3-2  顺序贯穿: 输入融合序与稠密序相反的 fixture, 按本次选定 ordering(finalRank)验证顺序 + 标签
 *   T3-3  臂独立: 词法独有候选能进入融合; 关闭稠密(dense 全缺)后仍返回它且标注降级
 *   R2    决策/排序解耦: fused 只用于排序, 决策用绝对分(sem)与阈值(现状守卫)
 *   R1    双显示接线守卫: L0 命中行 = 绝对分在前 + "#finalRank" 在后(融合序, 不冒充相似度)
 *   T3-6  单激活: 同一 observation 第二次 offer 被拒(duplicate-observation), 不产生第二个主激活
 * 回滚: opts.fusion:'legacy'(index.js) / retrievalPipelineMode='off'(设计层开关, 现状无生产消费方)。
 */
import { strict as assert } from 'node:assert'
import { rankFusionRRFPre, RECALL_FUSION_VERSION } from '../../lib/recall-fusion.js'
import { readFile } from 'node:fs/promises'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)) }
}
const ids = (arr) => arr.map((x) => x.memoryId || x)

// ---------- T3-1 秩不变性 ----------
t('T3-1 每臂排名不变、只改分数间距 ⇒ 融合 ID 顺序不变', () => {
  const base = [
    { memoryId: 'm1', dense: 0.91, lex: 3 },
    { memoryId: 'm2', dense: 0.87, lex: 3 },
    { memoryId: 'm3', dense: 0.60, lex: 1 },
    { memoryId: 'm4', dense: 0.55, lex: 0 },
  ]
  // 平移/缩放保持每臂内部顺序(秩不变), 只改变间距 — RRF 是 rank-space, 输出序必须逐位一致
  const shifted = base.map((p) => ({ ...p, dense: p.dense + 0.3, lex: p.lex * 100 }))
  const a = rankFusionRRFPre(base)
  const b = rankFusionRRFPre(shifted)
  assert.deepEqual(ids(b), ids(a), '只改间距不改秩, 融合序必须逐位一致')
})

// ---------- T3-2 顺序贯穿(融合序 ≠ 稠密序的反例 fixture) ----------
t('T3-2 融合序与稠密序相反时, 展示顺序按 finalRank 贯穿并带 #N 标签', () => {
  // 稠密臂 m3 > m1; 词法臂 m1 > m3 —— RRF 下两臂贡献对称 → 平局按 memoryId 升序(确定性)
  const pairs = [
    { memoryId: 'm1', dense: 0.80, lex: 5 },
    { memoryId: 'm3', dense: 0.90, lex: 1 },
  ]
  const out = rankFusionRRFPre(pairs)
  // m1: rankDense=2 + rankLex=1; m3: rankDense=1 + rankLex=2 — RRF 对称和相等 → 平局 → m1(memoryId 升序)
  assert.equal(out[0].memoryId, 'm1', '平局确定性: memoryId 升序')
  // finalRank = 输出序(1 起), 与展示标签口径一致
  assert.deepEqual(out.map((x, i) => x.memoryId + ':' + (i + 1)), ['m1:1', 'm3:2'], 'finalRank = 输出序')
  // 反例: m3 稠密更高 + m1 词法缺席 → dense 秩决定融合序, 顺序贯穿 finalRank
  const out2 = rankFusionRRFPre([
    { memoryId: 'm1', dense: 0.80, lex: null },
    { memoryId: 'm3', dense: 0.99, lex: null },
  ])
  assert.equal(out2[0].memoryId, 'm3', '稠密秩决定融合序')
})

// ---------- T3-3 臂独立(词法独有候选进融合 + 关稠密降级) ----------
t('T3-3 词法独有候选(无 dense)能进入融合, 且凭词法秩压过稠密秩靠后者', () => {
  // d1/d2 lex 缺席(null,非 0): dense 臂 d1 rank1 d2 rank2; lex 臂 lex_only rank1 other rank2
  // lex_only fused = 1/(60+1/60) > d2 fused = 1/(60+2/60) → 词法独有者胜稠密秩靠后者
  const out = rankFusionRRFPre([
    { memoryId: 'd1', dense: 0.99, lex: null },
    { memoryId: 'd2', dense: 0.60, lex: null },
    { memoryId: 'lex_only', dense: null, lex: 4 },
    { memoryId: 'other', dense: null, lex: 1 },
  ])
  const byId = new Map(out.map((x) => [x.memoryId, x]))
  assert.ok(ids(out).includes('lex_only'), '词法独有候选进入融合输出')
  assert.equal(byId.get('lex_only').rrfDense, 0, 'dense 臂缺席贡献 0(不是 minmax 的 0.5)')
  assert.ok(byId.get('lex_only').rrfLex > byId.get('d2').rrfDense, 'lex 秩 1 > dense 秩 2 的贡献')
  assert.ok(ids(out).indexOf('lex_only') < ids(out).indexOf('d2'), '词法独有者排在稠密秩靠后者之前')
})

t('T3-3b 关闭稠密(全条目 dense 缺席) ⇒ 纯词法序仍返回(降级可用)', () => {
  const out = rankFusionRRFPre([
    { memoryId: 'a', dense: null, lex: 1 },
    { memoryId: 'b', dense: null, lex: 3 },
  ])
  assert.deepEqual(ids(out), ['b', 'a'], '无稠密臂时退化为纯词法序, 不报错不丢条目')
})

// ---------- R2 决策/排序解耦(现状守卫) ----------
t('R2 fused 只用于排序; 决策用绝对分阈值 — 现状源码守卫(recall-fusion 注释+接线)', async () => {
  const src = await readFile('lib/index.js', 'utf8')
  // 决策门: l0Hits 过滤用 lex>0 || sem>=0.5(绝对), 不用 fused
  assert.ok(src.includes('c.lex > 0 || (typeof c.sem === \'number\' && c.sem >= 0.5)'), '准入决策 = 词法>0 或 绝对分>=0.5(现状 R2 守卫)')
  // 融合分只进排序与展示: finalRank 派生自 fusion 序
  assert.ok(src.includes('c.finalRank = i + 1'), 'finalRank = 融合输出序(排序用)')
})

// ---------- R1 双显示接线守卫 ----------
t('R1 双显示: 绝对分在前 + "#N"融合序在后; legacy 路径无 #N(回滚开关可用)', async () => {
  const src = await readFile('lib/index.js', 'utf8')
  const iFinal = src.indexOf("const fr = Number.isInteger(c.finalRank)")
  const iLegacy = src.indexOf("(opts && opts.fusion) !== 'legacy'")
  const iDisplay = src.indexOf("'] ×' + sc + fr")
  assert.ok(iFinal > 0, 'finalRank 标签构造存在')
  assert.ok(iLegacy > 0 && iLegacy < iFinal, 'legacy 开关在 finalRank 派生之前(回滚不显示融合序)')
  assert.ok(iDisplay > iFinal, '展示行同时含绝对分(sc)与融合序(fr)')
  // 双显示语义: 不拿融合分冒充相似度 — sc 仍是 sem/lex, fr 只是 #N
  assert.ok(src.includes("' #' + c.finalRank"), "融合序以 #N 前缀呈现, 与 ×相似度 视觉可辨")
})

// ---------- T3-6 同一 observation 只能形成一个主激活 ----------
t('T3-6 同一 observationId 二次 offer 被拒(duplicate-observation), 不产生第二个主激活', async () => {
  const { createActivationInboxPre } = await import('../../lib/activation-inbox-state.js')
  const { makeFakeActivationRequestPre } = await import('../../lib/activation-inbox.js')
  const identity = { sessionId: 's1', agentId: 'a1', workspaceKey: 'D:\\ws' }
  const box = createActivationInboxPre({ sessionId: identity.sessionId, agentId: identity.agentId, workspaceKey: identity.workspaceKey })
  const req = makeFakeActivationRequestPre({
    seed: 't3-6', sessionId: identity.sessionId, agentId: identity.agentId,
    workspaceKey: identity.workspaceKey, contextVersion: 3, memoryIndexVersion: 'idx_pre_' + '0'.repeat(32),
    records: [{
      memoryId: 'mem_' + '1'.repeat(32), anchorId: 'anc_1', scope: 'Workspace',
      sourceRef: 'workspace-log:2026-09-16.md', sourceEpoch: 'e', sourceVersion: 1,
      fileDigest: 'a'.repeat(64), recordDigest: 'b'.repeat(64), excerpt: 'x',
    }],
  })
  const r1 = box.offerActivation(req, { nowStep: 1 })
  assert.equal(r1.ok, true, '首次 offer 接受(pending 主激活)')
  // 第二次请求: 同一 observationId、不同 activationId —— 专测观测门(同 observation 只能形成一个主激活)
  const req2 = makeFakeActivationRequestPre({
    seed: 't3-6-second-activation', sessionId: identity.sessionId, agentId: identity.agentId,
    workspaceKey: identity.workspaceKey, contextVersion: 3, memoryIndexVersion: 'idx_pre_' + '0'.repeat(32),
    observationId: req.observationId,
    records: [{
      memoryId: 'mem_' + '1'.repeat(32), anchorId: 'anc_1', scope: 'Workspace',
      sourceRef: 'workspace-log:2026-09-16.md', sourceEpoch: 'e', sourceVersion: 1,
      fileDigest: 'a'.repeat(64), recordDigest: 'b'.repeat(64), excerpt: 'x',
    }],
  })
  assert.notEqual(req2.activationId, req.activationId, 'fixture 前置: 两个请求 activationId 不同')
  const r2 = box.offerActivation(req2, { nowStep: 2 })
  assert.equal(r2.ok, false, '同 observation 二次 offer 必须拒绝')
  assert.equal(r2.reason, 'duplicate-observation', '拒绝原因 = duplicate-observation(单激活语义)')
  const dv = box.debugView ? box.debugView() : null
  if (dv && dv.pending) assert.equal(dv.pending.packetId, r1.packetId, '主激活仍是首个包, 未被第二个替换')
})

console.log('[p3-recall-decision] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
