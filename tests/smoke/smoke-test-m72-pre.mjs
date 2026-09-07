// M7-2 Embedding Benchmark 离线 CI 测试(docs/M7-EMBEDDING-BENCHMARK.md):
// fixture vectors 固化于 tests/m7-2-fixtures/embedding-fixture.json,
// 本测试不联网、不下载模型、不调用 Python——只在 Node 内重算 exact cosine
// 排序并断言与导出时(NumPy float64)一致,同时固化 scope 门/embedding identity 契约。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.on('uncaughtException', (e) => { console.error('[M72-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M72-TEST] REJ:', r); process.exit(1) })

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name) }

const FIXTURE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'm7-2-fixtures', 'embedding-fixture.json')
const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))

console.log('[K1] fixture 结构 + embedding identity 契约(不联网)')
{
  ok(Array.isArray(fx.docs) && fx.docs.length >= 25, `docs 数组 >=25 (实际 ${fx.docs.length})`)
  ok(Array.isArray(fx.queries) && fx.queries.length >= 8, `queries 数组 >=8 (实际 ${fx.queries.length})`)
  const m = fx.model
  ok(m && typeof m.repo === 'string' && m.repo.includes('/'), 'model.repo 存在')
  ok(m && /^[0-9a-f]{40}$/.test(m.revision || ''), 'model.revision 是 40-hex pinned commit')
  ok(m && (m.license === 'MIT' || m.license === 'Apache-2.0'), `model.license 允许分发 (${m && m.license})`)
  ok(m && m.dimension === 1024 && m.normalization === 'l2_normalize', 'dimension=1024 + l2_normalize')
  ok(typeof fx.configHash === 'string' && fx.configHash.startsWith('cfgh_') && fx.configHash.length === 5 + 64, 'configHash = cfgh_+64hex')
  ok(fx.policy && fx.policy.chunkingPolicyVersion === 'm7_chunk_v1', 'chunkingPolicyVersion 冻结为 m7_chunk_v1')
  ok(fx.similarity && fx.similarity.includes('exact cosine'), '相似度 = exact cosine(无 ANN)')
}

console.log('[K2] 向量完整性:维度/无 NaN/归一化')
{
  let allNorm1 = true, allFinite = true, allDim = true
  for (const d of fx.docs) {
    if (d.vector.length !== fx.model.dimension) allDim = false
    let s = 0
    for (const x of d.vector) { if (!Number.isFinite(x)) allFinite = false; s += x * x }
    if (Math.abs(Math.sqrt(s) - 1) > 1e-4) allNorm1 = false
  }
  ok(allDim, `全部 doc 向量维度 = ${fx.model.dimension}`)
  ok(allFinite, '全部 doc 向量值有限(无 NaN/Inf)')
  ok(allNorm1, '全部 doc 向量 L2 范数 = 1 ±1e-4')
  ok(Math.abs(fx.doc_norm_min - 1) < 1e-4 && Math.abs(fx.doc_norm_max - 1) < 1e-4, '导出端范数范围 [min,max] ≈ 1')
}

console.log('[K3] exact cosine 重算:JS 逐向量点积排序 = NumPy 导出的期望 top5')
{
  // mirror the exporter's scope view: foreign-workspace docs are decoys
  // (K4 asserts they never appear), scoring runs on the core view only
  const scopedDocs = fx.docs.filter((d) => d.ws === 'ws/dsh-core')
  let rankOk = 0, scoreOk = 0, maxScoreDelta = 0
  for (const q of fx.queries) {
    const scores = scopedDocs.map((d) => {
      let s = 0
      for (let k = 0; k < q.vector.length; k++) s += q.vector[k] * d.vector[k]
      return s
    })
    const order = scopedDocs.map((_, i) => i)
      .sort((a, b) => (scores[b] - scores[a]) || (scopedDocs[a].key < scopedDocs[b].key ? -1 : scopedDocs[a].key > scopedDocs[b].key ? 1 : 0))
      .slice(0, 5)
    const got = order.map((i) => scopedDocs[i].key)
    if (JSON.stringify(got) === JSON.stringify(q.expected_top5)) rankOk++
    for (let i = 0; i < order.length; i++) {
      const delta = Math.abs(scores[order[i]] - q.expected_top5_scores[i])
      if (delta > maxScoreDelta) maxScoreDelta = delta
    }
    if (order.every((i, j) => Math.abs(scores[i] - q.expected_top5_scores[j]) < 1e-5)) scoreOk++
  }
  ok(rankOk === fx.queries.length, `全部 ${fx.queries.length} 条查询 top5 排序逐位一致 (${rankOk}/${fx.queries.length})`)
  ok(scoreOk === fx.queries.length, `top5 分数重算误差 <1e-5 (最大 delta ${maxScoreDelta.toExponential(2)})`)
}

console.log('[K4] scope 门:跨 workspace 文档禁止进入期望结果')
{
  const foreign = fx.docs.filter((d) => d.ws !== 'ws/dsh-core').map((d) => d.key)
  ok(foreign.length >= 4, `fixture 含 >=4 条 ws/other-project 文档作为诱饵 (${foreign.length})`)
  let leaked = 0
  for (const q of fx.queries) for (const k of q.expected_top5) if (docWs(k) !== 'ws/dsh-core') leaked++
  function docWs(key) { return fx.docs[fx.docs.findIndex((d) => d.key === key)].ws }
  ok(leaked === 0, `期望 top5 中跨 workspace 命中数 = 0 (实际 ${leaked})`)
}

console.log('[K5] 跨语言/gold 抽查:fixture 查询的期望结果含 gold 记录')
{
  const goldMap = {
    q001: 'r001', q011: 'r011', q023: 'r023', q032: 'r032',
    q053: 'r053', q085: 'r088', q111: 'r111', q131: 'r131',
  }
  let hits = 0
  for (const q of fx.queries) {
    const gold = goldMap[q.id]
    if (!gold) continue
    const recIds = q.expected_top5.map((k) => k.split(':')[0])
    if (recIds.includes(gold)) hits++
  }
  ok(hits >= 6, `gold 记录进入期望 top5 >=6/8 (实际 ${hits};余下为模型真实弱点,由 benchmark 报告解释)`)
}

console.log('[K6] supersede 方向:q085 期望结果中 correction(r088) 在 old(r087) 之前')
{
  // q081 方向性弱点(旧 jieba 记录压过 correction)由 benchmark §4.5 记录,
  // 交给 M7-3 融合层修复;fixture 选 correction 胜出的 q085 冻结回归基线。
  const q = fx.queries.find((x) => x.id === 'q085')
  const pos = (rid) => { const i = q.expected_top5.findIndex((k) => k.startsWith(rid + ':')); return i === -1 ? 99 : i }
  ok(pos('r088') < pos('r087'), `correction r088 排位 (${pos('r088')}) 优于 old r087 (${pos('r087')})`)
}

console.log('[K7] fixture 与 benchmark 结果一致性声明')
{
  ok(fx.purpose && fx.purpose.includes('MUST NOT download'), 'fixture 自述:CI 禁止下载模型')
  ok(typeof fx.scope_rule === 'string' && fx.scope_rule.includes('WS_CORE-scoped'), 'scope_rule 文档化:期望值来自 scope 过滤视图')
}

console.log(`[M72] pass=${pass} fail=${fail}`)
if (fail > 0) process.exit(1)
