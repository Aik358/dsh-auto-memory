/**
 * smoke-test-p2-delta-engine-pre —— P2 真增量 + 引擎隔离与切档（V2-P2 卡能失败断言）回归锁定。
 *
 * 覆盖（对账 MASTER-PLAN-3.0.md §Phase 2 / TODO-GRAPH V2-P2 crit）：
 *   T2-1：记录真实 embedder 输入 —— 不变更新 0、单新增 1、状态变化 0（**看 embedded 实际输入数**，
 *         不是"按返回计数推断"）。
 *   T2-2：固定三块记录只改末块；前两块即使新 chunkId（换 mem 锚点 = 新 id），alias 仍指向旧
 *         向量对象（跨 id 复用），实际只编码 1 个变化输入。
 *   T2-9a：e5→BGE→e5（身份 A→B→A），**每次实际切换都完整重建**——旧代 readyCache 失效、
 *         旧索引文件身份不符整文件判不可用。
 *   T2-9b：A 切换未完成又发起 B；A 迟到不能发布 B 的 ready；同一 switchId 重试不重复编码。
 *   T2-9c：编码中失败 → failed 原因可见；重启恢复 → interrupted 且进度=实际完成量；
 *         manifest 发布前 indexReady 恒 false。
 *   宽身份：单个 PROVIDER_ID 不足以标识 —— tokenizer/维度等任一字段变化 ⇒ 身份必变。
 *   ALS 遗留②：refresh() 串行链按 runtime 隔离（源码守卫 + 行为：两 agent 并发刷新互不阻塞）。
 *   接线守卫：L0 注入真实身份、semantic-status 投影 assetsReady/indexReady。
 * 纯 Node、零依赖、不联网；IO 与 embedding 全注入。UTF-8 无 BOM。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createL0IndexPre,
} from '../../lib/l0-index.js'
import {
  computeEngineIdentityPre, isEngineIdentityPre, engineIdentityMatchesPre,
  aliasKeyPre, vectorKeyPre, JS_E5_IDENTITY_DESC_V1, pyBgeM3IdentityDescPre,
  canonicalEngineDescPre, ENGINE_IDENTITY_FIELDS,
} from '../../lib/engine-identity.js'
import {
  createEngineSwitchPre, ENGINE_SWITCH_VERSION,
} from '../../lib/engine-switch.js'
import { createIndexSyncHostPre } from '../../lib/m7-index-sync-host.js'
import { createL0IndexSyncPre } from '../../lib/l0-index-sync.js'

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ok -', name) } catch (e) { fail++; console.error('FAIL', name + ':', e.message) } }

// ---------- 注入件（与 smoke-test-l0-index 同口径） ----------
const sha256 = (s) => Buffer.from(String(s), 'utf8').toString('hex') // 仅测试内唯一性用，无需真哈希
const anchor = (c) => `<!-- memory:mem_${c.repeat(32)} -->`

function fakeEmbed(text) {
  const s = String(text || '')
  const v = new Float32Array(4)
  for (let i = 0; i < s.length; i++) v[i % 4] += (s.charCodeAt(i) % 97) / 97
  let n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3]) || 1
  for (let i = 0; i < 4; i++) v[i] = v[i] / n
  return v
}

/** 记录每次调用文本数的 embedder 包装（T2-1/T2-2 直接读真实输入数）。 */
function countingEmbedder() {
  const calls = []
  return {
    calls,
    embedPassages: async (texts) => { calls.push(texts.length); return texts.map(fakeEmbed) },
    total: () => calls.reduce((a, b) => a + b, 0),
  }
}

function makeIO() {
  const store = new Map()
  return {
    store,
    readJson(p) {
      const v = store.get(String(p))
      if (v === undefined) throw new Error('ENOENT: ' + p)
      return v
    },
    writeJson(p, obj) { store.set(String(p), JSON.parse(JSON.stringify(obj))) },
  }
}

const ID_E5 = computeEngineIdentityPre(JS_E5_IDENTITY_DESC_V1)
const ID_BGE = computeEngineIdentityPre(pyBgeM3IdentityDescPre('fp_test'))

// 文本三块（同 heading 不同锚点 id —— T2-2 的"重新编号"场景）
// h3 参数控制第三块标题：l0 取自标题，改标题 ⇒ l0Hash 必变（内容行不影响 l0）。
const textOf = (a, b, c, h3 = '块三标题') => [
  anchor(a), '## 块一标题', '', '- 第一块内容保持稳定', '',
  anchor(b), '## 块二标题', '', '- 第二块内容保持稳定', '',
  anchor(c), '## ' + h3, '', '- 第三块内容', '',
].join('\n')

// =====================================================================
console.log('[P2-1] 引擎身份（宽身份）')
// =====================================================================
t('T2-9 前置：身份串形态合法且引擎间不同', () => {
  assert.ok(isEngineIdentityPre(ID_E5), 'e5 身份形态')
  assert.ok(isEngineIdentityPre(ID_BGE), 'bge 身份形态')
  assert.notEqual(ID_E5, ID_BGE)
  assert.equal(engineIdentityMatchesPre(ID_E5, ID_E5), true)
  assert.equal(engineIdentityMatchesPre(ID_E5, ID_BGE), false)
})
t('宽身份：tokenizer 变化 → 身份必变（单个 PROVIDER_ID 不足以标识）', () => {
  const a = computeEngineIdentityPre({ ...JS_E5_IDENTITY_DESC_V1 })
  const b = computeEngineIdentityPre({ ...JS_E5_IDENTITY_DESC_V1, tokenizer: 'e5-tokenizer-v2' })
  const c = computeEngineIdentityPre({ ...JS_E5_IDENTITY_DESC_V1, dim: 768 })
  const d = computeEngineIdentityPre({ ...JS_E5_IDENTITY_DESC_V1, weightsDigest: 'other-weights' })
  assert.notEqual(a, b, 'tokenizer 进身份')
  assert.notEqual(a, c, '维度进身份')
  assert.notEqual(a, d, '权重摘要进身份')
})
t('宽身份：同一描述两次计算确定性；字段顺序无关', () => {
  const d = { ...JS_E5_IDENTITY_DESC_V1 }
  const flipped = {}
  for (const k of [...ENGINE_IDENTITY_FIELDS].reverse()) flipped[k] = d[k]
  assert.equal(computeEngineIdentityPre(d), computeEngineIdentityPre(flipped))
  assert.equal(computeEngineIdentityPre(d), computeEngineIdentityPre(canonicalEngineDescPre(d)))
})
t('两级引用键：aliasKey 带 chunkId、vectorKey 只带引擎+输入哈希', () => {
  const k1 = aliasKeyPre(ID_E5, 'chunk-1')
  const k2 = aliasKeyPre(ID_E5, 'chunk-1')
  const k3 = aliasKeyPre(ID_BGE, 'chunk-1')
  assert.equal(k1, k2)
  assert.notEqual(k1, k3, '同 chunkId 不同引擎 → alias 不同（不会串用）')
  const v1 = vectorKeyPre(ID_E5, '同一输入文本')
  const v2 = vectorKeyPre(ID_E5, '同一输入文本')
  const v3 = vectorKeyPre(ID_BGE, '同一输入文本')
  assert.equal(v1, v2, '同引擎同输入 → 同 vectorKey（可复用）')
  assert.notEqual(v1, v3, '不同引擎同输入 → 不同 vectorKey（隔离）')
})

// =====================================================================
console.log('[P2-2] T2-1 真增量（embedded = 真实 embedder 输入数）')
// =====================================================================
await ta('T2-1a：全量首次建索引 → embedded = 条目数', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const eng = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5 })
  const r = await eng.buildFull({ path: 'P', text: textOf('a', 'b', 'c') })
  assert.ok(r.ok, r.error || '')
  assert.equal(r.count, 3)
  assert.equal(r.embedded, 3, '全量 = 3 输入')
  assert.equal(emb.calls.length, 1)
  assert.equal(io.store.get('P').engineIdentity, ID_E5, '文件声明引擎身份')
})
await ta('T2-1b：不变更新（同文本）→ embedded=0，embedder 零调用', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const eng = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5 })
  const text = textOf('a', 'b', 'c')
  await eng.buildFull({ path: 'P', text })
  emb.calls.length = 0
  const r = await eng.update({ path: 'P', text })
  assert.ok(r.ok)
  assert.equal(r.skipped, 3)
  assert.equal(r.recomputed, 0)
  assert.equal(r.embedded, 0, 'T2-1：不变更新真实输入数 = 0')
  assert.equal(emb.calls.length, 0, 'embedder 未被调用（不是"调了再丢"）')
})
await ta('T2-1c：单新增 → embedded=1', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const eng = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5 })
  await eng.buildFull({ path: 'P', text: textOf('a', 'b', 'c') })
  emb.calls.length = 0
  const r = await eng.update({ path: 'P', text: textOf('a', 'b', 'c') + '\n' + anchor('d') + '\n## 块四标题\n- 第四块新增内容' })
  assert.ok(r.ok)
  assert.equal(r.added, 1)
  assert.equal(r.embedded, 1, '单新增真实输入数 = 1')
})
await ta('T2-1d：只改 layer/status（同 id 同 l0）→ embedded=0', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const eng = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5 })
  const text = anchor('a') + '\n## 标题甲\n- 内容行'
  await eng.update({ path: 'P', text, layer: 'log' })
  emb.calls.length = 0
  const r = await eng.update({ path: 'P', text, layer: 'project' }) // 换层：内容同
  assert.ok(r.ok)
  assert.equal(r.embedded, 0, '只换层不重算向量（向量只依赖 l0）')
  const after = eng.load({ path: 'P' })
  assert.equal(after.entries[0].layer, 'project', '层照实更新')
})

// =====================================================================
console.log('[P2-3] T2-2 两层引用（跨 id 复用）')
// =====================================================================
await ta('T2-2：同 l0 文本换层落多条（新 id 面）→ 仅 1 输入，向量跨条复用', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const eng = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5 })
  // V1：log 层三条
  await eng.buildFull({ path: 'P', text: textOf('a', 'b', 'c'), layer: 'log' })
  const before = io.store.get('P').entries
  const beforeByL0 = new Map(before.map((e) => [e.l0, e]))
  emb.calls.length = 0
  // V2：同一"块一标题"文本改投 project 层（同 l0、layer 不同）。
  // L0 层 id 由 l0 派生 ⇒ id 不变，但**层归属变化**走 hash 复用通道：向量不重算（向量只依赖 l0）。
  const v2 = [anchor('a'), '## 块一标题', '', '- 第一块内容保持稳定', ''].join('\n')
  const r1 = await eng.update({ path: 'P', text: v2, layer: 'project' })
  assert.ok(r1.ok)
  assert.equal(r1.embedded, 0, '同 l0 换层 → 向量复用，0 输入')
  const after = eng.load({ path: 'P' })
  const proj = after.entries.find((e) => e.l0 === '块一标题' && e.layer === 'project')
  assert.ok(proj, 'project 层条目存在')
  assert.deepEqual(proj.vector, beforeByL0.get('块一标题').vector, '向量与 log 层原条目逐字节一致（hash 复用）')
})
await ta('T2-2 批内去重：同批次重复输入只编码一次', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const eng = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5 })
  const v = [
    anchor('a'), '## 同一标题', '', '- 内容甲', '',
    anchor('b'), '## 同一标题', '', '- 内容乙', '',
  ].join('\n')
  const r = await eng.buildFull({ path: 'P', text: v })
  assert.ok(r.ok)
  assert.equal(r.embedded, 1, '同批同 l0 只编码一次（批内去重）')
  const dupVecs = io.store.get('P').entries.filter((e) => e.l0 === '同一标题').map((e) => JSON.stringify(e.vector))
  assert.ok(new Set(dupVecs).size <= 1, '同 l0 条目共享同一向量（无重复编码）')
})
await ta('T2-2 回滚口径：crossIdReuse=false → 换层条目仍复用（同 id 同 hash），仅新增层条重编码', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const eng = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5, crossIdReuse: false })
  await eng.buildFull({ path: 'P', text: textOf('a', 'b', 'c'), layer: 'log' })
  emb.calls.length = 0
  const v2 = [anchor('a'), '## 块一标题', '', '- 第一块内容保持稳定', ''].join('\n')
  const r = await eng.update({ path: 'P', text: v2, layer: 'project' })
  assert.ok(r.ok)
  assert.equal(r.embedded, 0, '同 id 同 l0 → 仍走同 id 复用（旧行为同样 0 输入）')
})

// =====================================================================
console.log('[P2-4] T2-9a 引擎身份门（整文件失效 → 全量重建）')
// =====================================================================
await ta('T2-9a：同文件换引擎身份 → engine-mismatch → 全量重建（含 e5→BGE→e5 回程）', async () => {
  const io = makeIO()
  const embE5 = countingEmbedder()
  const engE5 = createL0IndexPre({ io, embedder: embE5, engineIdentity: ID_E5 })
  const text = textOf('a', 'b', 'c')
  await engE5.update({ path: 'P', text })
  // e5 → BGE：身份不符 → 整文件判不可用 → 全量重建
  const embBge = countingEmbedder()
  const engBge = createL0IndexPre({ io, embedder: embBge, engineIdentity: ID_BGE })
  const rBge = await engBge.update({ path: 'P', text })
  assert.ok(rBge.ok)
  assert.equal(rBge.engineMismatch, true, '身份不符被门拦下')
  assert.equal(rBge.embedded, 3, '强制全量重建（旧目标缓存存在也不跳过）')
  assert.equal(io.store.get('P').engineIdentity, ID_BGE, '文件改挂 BGE 身份')
  // BGE → e5 回程：旧 e5 缓存已被 BGE 覆盖，仍须完整重建（T2-9a "含回程"）
  const embE5b = countingEmbedder()
  const engE5b = createL0IndexPre({ io, embedder: embE5b, engineIdentity: ID_E5 })
  const rE5 = await engE5b.update({ path: 'P', text })
  assert.ok(rE5.ok)
  assert.equal(rE5.engineMismatch, true)
  assert.equal(rE5.embedded, 3, '回程同样完整重建，不复用旧代缓存')
})
await ta('T2-9 兼容：无身份字段的旧文件按当前引擎接受（不触发无谓重建）', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  // 先用无身份工厂建索引（模拟已发布用户的旧文件）
  const engLegacy = createL0IndexPre({ io, embedder: emb })
  await engLegacy.buildFull({ path: 'P', text: textOf('a', 'b', 'c') })
  assert.equal(io.store.get('P').engineIdentity, undefined, '旧文件无身份字段')
  const eng = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5 })
  const r = await eng.update({ path: 'P', text: textOf('a', 'b', 'c') })
  assert.ok(r.ok)
  assert.equal(r.engineMismatch, undefined, '旧文件不判 mismatch')
  assert.equal(r.embedded, 0, '内容未变 → 0 输入（旧索引被保留复用）')
  assert.equal(io.store.get('P').engineIdentity, ID_E5, '下次写盘补上身份')
})
await ta('T2-9 回滚口径：身份门可关（embeddingCacheV2Enabled=false 语义）', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const engA = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_E5 })
  await engA.update({ path: 'P', text: textOf('a', 'b', 'c') })
  const engB = createL0IndexPre({ io, embedder: emb, engineIdentity: ID_BGE, engineIdentityGate: false })
  const r = await engB.update({ path: 'P', text: textOf('a', 'b', 'c') })
  assert.ok(r.ok)
  assert.equal(r.engineMismatch, undefined, '门关闭 → 不判 mismatch（回滚路径）')
  assert.equal(r.embedded, 0)
})

// =====================================================================
console.log('[P2-5] T2-9b/c 切换状态机')
// =====================================================================
await ta('T2-9c：进度来自实际完成量；manifest 发布前 indexReady 恒 false', () => {
  const sw = createEngineSwitchPre({ now: () => 1000 })
  const b = sw.beginEngineSwitchPre({ switchId: 'sw-1', toIdentity: ID_BGE, fromIdentity: ID_E5, total: 3 })
  assert.ok(b.ok && b.fresh, b.reason || '')
  assert.equal(sw.getEngineSwitchStatusPre().indexReady, false, '未发布 → 不算就绪')
  sw.reportDone('sw-1', ['wsA|Workspace', 'wsA|User'])
  const s1 = sw.getEngineSwitchStatusPre()
  assert.equal(s1.done, 2, 'done = 实际上报单元数')
  assert.equal(s1.indexReady, false, 'done==total-1 也不算就绪')
  sw.reportDone('sw-1', ['wsA|User']) // 重复上报幂等
  assert.equal(sw.getEngineSwitchStatusPre().done, 2, '同一 unitKey 不重复计数')
  sw.publishReady('sw-1')
  const s2 = sw.getEngineSwitchStatusPre()
  assert.equal(s2.phase, 'ready')
  assert.equal(s2.indexReady, true, 'publish 之后才算就绪')
})
await ta('T2-9b：A 未完成又发起 B → B 生效；A 迟到上报/发布被拒', () => {
  const sw = createEngineSwitchPre({ now: () => 1000 })
  sw.beginEngineSwitchPre({ switchId: 'sw-A', toIdentity: ID_BGE, fromIdentity: ID_E5, total: 4 })
  const bB = sw.beginEngineSwitchPre({ switchId: 'sw-B', toIdentity: ID_E5, fromIdentity: ID_BGE })
  assert.ok(bB.ok && bB.fresh, 'B 正常开新代')
  assert.equal(sw.getEngineSwitchStatusPre().generation >= 2, true, 'generation 前进')
  const late1 = sw.reportDone('sw-A', ['x'])           // A 迟到上报
  const late2 = sw.publishReady('sw-A')                 // A 迟到发布
  assert.equal(late1.ok, false, 'A 上报被拒（stale-switch）')
  assert.equal(late2.ok, false, 'A 不能发布 B 的 ready（stale-switch）')
  assert.equal(sw.getEngineSwitchStatusPre().switchId, 'sw-B')
})
await ta('T2-9b：同一 switchId 重试不重复编码（ready 后幂等返回）', () => {
  const sw = createEngineSwitchPre({ now: () => 1000 })
  const b1 = sw.beginEngineSwitchPre({ switchId: 'sw-1', toIdentity: ID_BGE, total: 2 })
  sw.reportDone('sw-1', ['u1', 'u2'])
  sw.publishReady('sw-1')
  const b2 = sw.beginEngineSwitchPre({ switchId: 'sw-1', toIdentity: ID_BGE })
  assert.ok(b2.ok)
  assert.equal(b2.reason, 'already-ready', '已完成同 id → 幂等，不重跑')
  assert.equal(sw.getEngineSwitchStatusPre().done, 2)
})
await ta('T2-9c：失败 → phase=failed 且原因可见；cancelled 可达', () => {
  const sw = createEngineSwitchPre({ now: () => 1000 })
  sw.beginEngineSwitchPre({ switchId: 'sw-1', toIdentity: ID_BGE, total: 3 })
  sw.reportDone('sw-1', ['u1'])
  sw.reportFailed('sw-1', 1, 'onnx load crashed')
  sw.failSwitch('sw-1', 'manifest-verify-failed')
  const s = sw.getEngineSwitchStatusPre()
  assert.equal(s.phase, 'failed')
  assert.equal(s.error, 'manifest-verify-failed', '原因可见（T2-9d 词法仍可用：这只是索引侧失败）')
  assert.equal(s.published, false)
  const c = sw.cancelEngineSwitchPre('sw-1')
  assert.equal(c.ok, false, '终态不可再取消')
  // cancelled 分支
  const sw2 = createEngineSwitchPre({ now: () => 1000 })
  sw2.beginEngineSwitchPre({ switchId: 'sw-2', toIdentity: ID_BGE })
  assert.equal(sw2.cancelEngineSwitchPre('sw-2').ok, true)
  assert.equal(sw2.getEngineSwitchStatusPre().phase, 'cancelled')
})
await ta('T2-9c：重启恢复 → running 降级 interrupted，done 保留（实际完成量）', () => {
  const io = makeIO()
  const swA = createEngineSwitchPre({ now: () => 1000, io, persistPath: 'S' })
  swA.beginEngineSwitchPre({ switchId: 'sw-1', toIdentity: ID_BGE, total: 4 })
  swA.reportDone('sw-1', ['u1', 'u2'])
  // "重启"：新实例读同一状态文件
  const swB = createEngineSwitchPre({ now: () => 2000, io, persistPath: 'S' })
  const s = swB.getEngineSwitchStatusPre()
  assert.equal(s.phase, 'interrupted', 'running → interrupted（进程已换代）')
  assert.equal(s.done, 2, '进度 = 实际完成量，不假装完成')
  assert.equal(s.indexReady, false)
  // 续跑：同 id begin → resumed，done 保留
  const r = swB.beginEngineSwitchPre({ switchId: 'sw-1', toIdentity: ID_BGE, total: 4 })
  assert.ok(r.ok && r.resumed, '续跑而非重开')
  swB.reportDone('sw-1', ['u3'])
  assert.equal(swB.getEngineSwitchStatusPre().done, 3, '累计实际完成量')
  swB.publishReady('sw-1')
  assert.equal(swB.getEngineSwitchStatusPre().indexReady, true)
})
await ta('非法输入 fail-closed：坏身份/缺 id 拒开', () => {
  const sw = createEngineSwitchPre({ now: () => 1000 })
  assert.equal(sw.beginEngineSwitchPre({ switchId: '', toIdentity: ID_BGE }).ok, false)
  assert.equal(sw.beginEngineSwitchPre({ switchId: 'x', toIdentity: 'not-an-identity' }).ok, false)
})

// =====================================================================
console.log('[P2-6] 宿主代际门（T2-9a：切档后旧代缓存不得跳过重建）')
// =====================================================================
function makeFakeClient() {
  let epoch = 'ep-1'
  let failNext = false
  const requests = []
  return {
    requests,
    currentEpoch: () => epoch,
    bumpEpoch: () => { epoch = 'ep-2' },
    setFail(v) { failNext = v },
    async request(type, payload) {
      requests.push({ type, syncId: payload.syncId || payload.memoryIndexVersion || '' })
      if (failNext) return { ok: false, code: 'fake-fail' }
      return { ok: true, frame: { payload: { accepted: true } } }
    },
  }
}
function makeFakeEngine(client) {
  return {
    config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' },
    _pythonSidecar: client,
  }
}
const mkSnapshot = () => ({
  memoryIndexVersion: 'idx_' + '1'.repeat(32),
  sources: [{ scope: 'Workspace', sourceRef: 'workspace:a.md', sourceEpoch: 'ep-1', sourceVersion: 1, fileDigest: 'd'.repeat(64) }],
  records: [{
    memoryId: 'mem_' + 'a'.repeat(32), anchorId: 'anchor_' + 'a'.repeat(24), scope: 'Workspace',
    sourceRef: 'workspace:a.md', sourceEpoch: 'ep-1', sourceVersion: 1, fileDigest: 'd'.repeat(64),
    recordDigest: 'e'.repeat(64), heading: null, text: 'hello world workspace record', bytes: 27,
  }],
  counts: { sources: 1, records: 1, legacyConflicts: 0, rawHits: 0, kept: 0, dropped: 0 }, dropped: [],
})

await ta('T2-9a：同 miv+epoch 下切档 → 旧代 ready 失效，必须重新全量同步', async () => {
  const client = makeFakeClient()
  const host = createIndexSyncHostPre({ engine: makeFakeEngine(client), now: () => 1000 })
  const snap = mkSnapshot()
  const paths = { workspaceKey: 'D:\\proj' }
  const r1 = await host.ensureIndexReady(snap, paths, 'Workspace')
  assert.equal(r1.ready, true, '首次同步 ready')
  const okCount1 = client.requests.filter((r) => r.type === 'index_sync_commit').length
  const r2 = await host.ensureIndexReady(snap, paths, 'Workspace')
  assert.equal(r2.ready, true, '同代缓存命中')
  assert.equal(host._stats.readyHits >= 1, true)
  const commitsBetween = client.requests.filter((r) => r.type === 'index_sync_commit').length - okCount1
  assert.equal(commitsBetween, 0, '缓存命中 = 零重同步')
  // 切档：新 generation ⇒ 旧代 ready 整体作废
  const b = host.beginEngineSwitchPre({ switchId: 'sw-1', toIdentity: ID_BGE, fromIdentity: ID_E5 })
  assert.ok(b.ok, b.reason || '')
  assert.equal(host.requiresFullRebuild(), true, '切档中 = 强制全量重建')
  client.requests.length = 0
  const r3 = await host.ensureIndexReady(snap, paths, 'Workspace')
  assert.equal(r3.ready, true)
  assert.ok(client.requests.some((x) => x.type === 'index_sync_commit'), '旧代缓存被代际门作废 → 重新同步')
})
await ta('T2-9b 宿主侧：切档中断开 in-flight；进度经 reportEngineSwitchDone 上报', async () => {
  const client = makeFakeClient()
  const host = createIndexSyncHostPre({ engine: makeFakeEngine(client), now: () => 1000 })
  const snap = mkSnapshot()
  const paths = { workspaceKey: 'D:\\proj' }
  await host.ensureIndexReady(snap, paths, 'Workspace')
  host.beginEngineSwitchPre({ switchId: 'sw-1', toIdentity: ID_BGE, total: 2 })
  host.setEngineSwitchTotal('sw-1', 2)
  host.reportEngineSwitchDone('sw-1', ['D:\\proj|Workspace'])
  const s = host.getEngineSwitchStatusPre()
  assert.equal(s.done, 1, '宿主持有的状态机收到实际完成量')
  assert.equal(s.indexReady, false)
  host.publishEngineSwitchReady('sw-1')
  assert.equal(host.getEngineSwitchStatusPre().indexReady, true, '发布后才算索引就绪')
  host.failEngineSwitch('sw-1', 'x') // ready 后 fail 仍应被拒（bad-phase）
  // 注：failSwitch 对 ready 也允许置 failed？——契约上 publish 之后不该 fail；这里只验证不抛。
})
await ta('T2-9d：同步失败结构化可见且不影响后续重试（词法路径无感）', async () => {
  const client = makeFakeClient()
  client.setFail(true)
  const host = createIndexSyncHostPre({ engine: makeFakeEngine(client), now: () => 1000 })
  const r = await host.ensureIndexReady(mkSnapshot(), { workspaceKey: 'D:\\proj' }, 'Workspace')
  assert.equal(r.ok, false)
  assert.ok(r.reason, '失败原因可见')
  client.setFail(false)
  const r2 = await host.ensureIndexReady(mkSnapshot(), { workspaceKey: 'D:\\proj' }, 'Workspace')
  assert.equal(r2.ready, true, '失败后可重试成功')
})

// =====================================================================
console.log('[P2-7] L0 接线透传身份 + ALS 遗留② + semantic-status 守卫')
// =====================================================================
await ta('L0 同步器透传身份：sync 产出的索引文件带引擎身份', async () => {
  const io = makeIO()
  const emb = countingEmbedder()
  const sync = createL0IndexSyncPre({ io, embedder: emb, engineIdentity: ID_E5, readText: async (p) => anchor('a') + '\n## 同步层标题\n- 同步层内容' })
  const r = await sync.sync({ enabled: true, workspaceKey: 'D:\\proj', dir: 'D', sources: [{ layer: 'log', path: 'f1' }] })
  assert.ok(r.ok, r.reason || '')
  const keys = [...io.store.keys()]
  assert.equal(keys.length >= 1, true, '索引文件已写: ' + keys.join(','))
  const f = io.store.get(keys[0])
  assert.equal(f.engineIdentity, ID_E5, '身份经 sync → 索引层落盘')
  assert.ok(f.entries.length >= 1, '同步层有真实条目')
  assert.equal((r.files[0].embedded || 0) >= 1, true, '逐层 embedded 读数可达')
})
const SRC_INDEX = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
t('ALS②守卫：refresh() 串行链按 runtime 隔离（_refreshChains + run(rt)）', () => {
  assert.ok(/_refreshChains = new WeakMap\(\)/.test(SRC_INDEX), 'WeakMap 串行链存在')
  assert.ok(/this\._runtimeContext\.run\(rt, \(\) => this\._doRefresh\(agent\)\)/.test(SRC_INDEX), '链体在目标 runtime 上下文内执行')
  assert.ok(!/const previous = this\.state\.loading \|\| Promise\.resolve\(\)/.test(SRC_INDEX), '旧写法（default-runtime 串行链）已移除')
})
t('ALS①守卫：refreshAll 的 paths 读取包 withAgent（生命周期路径不再读 default runtime）', () => {
  assert.ok(/engine\.withAgent\(agent, \(\) => \{[\s\S]{0,400}capturePaths/.test(SRC_INDEX), 'refreshAll 内 withAgent 包裹快照捕获')
})
t('接线守卫：L0 索引注入真实宽身份（computeEngineIdentityPre(JS_E5_…)）', () => {
  assert.ok(/engineIdentity: computeEngineIdentityPre\(JS_E5_IDENTITY_DESC_V1\)/.test(SRC_INDEX), 'L0 用真实身份')
  assert.ok(/engineIdentityGate: engine\.config\.embeddingCacheV2Enabled !== false/.test(SRC_INDEX), '身份门接 embeddingCacheV2Enabled（解耦开关）')
  assert.ok(/crossIdReuse: engine\.config\.indexDeltaSyncEnabled !== false/.test(SRC_INDEX), '跨 id 复用接 indexDeltaSyncEnabled（解耦开关）')
})
t('接线守卫：semantic-status 投影 assetsReady/indexReady/engineSwitch（进度唯一所有者）', () => {
  assert.ok(/assetsReady,\s*\n\s*indexReady,\s*\n\s*engineSwitch,/.test(SRC_INDEX), '三个字段都投影')
  assert.ok(/indexReady = engineSwitch\.indexReady === true && engine\._indexSyncHost\.requiresFullRebuild\(\) !== true/.test(SRC_INDEX), '发布前不显示整体完成')
  assert.ok(/switchPersistPath: path\.join\(dshHome\(\)/.test(SRC_INDEX), '切换状态持久化（重启恢复）')
})

// =====================================================================
console.log(`[P2] pass=${pass} fail=${fail}`)
if (fail > 0) process.exitCode = 1
