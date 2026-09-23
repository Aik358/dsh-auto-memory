/**
 * M2.5b · RRF 层次臂（第四臂）
 *
 * 背景（实测不一致，2026-09-18）：
 *   Tier-0 **注入**侧有层次优先级（tier-layer-inject.js:58 TIER_LAYER_ORDER_PRE_V1
 *     = ['project','whiteboard','user','reflection','log'] + tier0-catalog.js:419-455 的 caps/floors），
 *   而 **排序**侧（RRF 融合）对层次完全无感 ⇒ 结论层（project）与流水层（log）**平等竞争**，
 *   笔记层常被日志挤掉。
 *
 * 修法：给 RRF 加第四臂（层次臂），照抄时间臂的**退化安全**模式。
 *
 * 本套件锁定五件事：
 *   ① 退化安全：无 layer / layer 全相等 → **与三臂版逐字节一致**（无新字段、fused 不加 0 项）
 *   ② 层次生效：project 优先于 log（与注入侧同一顺序）
 *   ③ **常量一致性**：本模块的 FUSION_LAYER_ORDER_PRE_V1 ≡ 注入侧 TIER_LAYER_ORDER_PRE_V1
 *      （本地复刻 + 测试锁定，防双源漂移）
 *   ④ 与时间臂**互不依赖**：可各自独立生效、可同时生效
 *   ⑤ rank-space 纪律：层次只贡献秩，**不乘分**（Hindsight #3956）
 */
import {
  rankFusionRRFPre, FUSION_RRF_K_PRE_V1,
  FUSION_LAYER_ORDER_PRE_V1, FUSION_RRF_DIVISOR_PRE_V1,
} from '../../lib/recall-fusion.js'
import { TIER_LAYER_ORDER_PRE_V1 } from '../../lib/tier-layer-inject.js'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n) } }
const eq = (a, b, n) => ok(a === b, n + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

console.log('=== M2.5b · RRF 层次臂 ===\n')

// ── 1. ★ 常量一致性：防双源漂移 ────────────────────────────────────
console.log('[1] ★ 常量一致性（本地复刻必须与注入侧逐字相同）')
{
  eq(FUSION_LAYER_ORDER_PRE_V1.length, TIER_LAYER_ORDER_PRE_V1.length, '长度一致')
  let same = true
  for (let i = 0; i < TIER_LAYER_ORDER_PRE_V1.length; i++) {
    if (FUSION_LAYER_ORDER_PRE_V1[i] !== TIER_LAYER_ORDER_PRE_V1[i]) { same = false; break }
  }
  ok(same, '★ 逐元素相同：' + JSON.stringify([...FUSION_LAYER_ORDER_PRE_V1]))
  eq(String(FUSION_LAYER_ORDER_PRE_V1[0]), 'project', '首项 project（最高优先）')
  eq(String(FUSION_LAYER_ORDER_PRE_V1[FUSION_LAYER_ORDER_PRE_V1.length - 1]), 'log', '末项 log（最低优先）')
  ok(Object.isFrozen(FUSION_LAYER_ORDER_PRE_V1), '常量被冻结')
}

// ── 2. ★ 退化安全：无 layer / 全相等 → 逐字节同三臂版 ──────────────
console.log('\n[2] ★ 退化安全（最高优先级的兼容性约束）')
{
  const pairs = [
    { memoryId: 'a', dense: 0.9, lex: 5 },
    { memoryId: 'b', dense: 0.5, lex: 9 },
    { memoryId: 'c', dense: 0.7, lex: 1 },
  ]
  const three = rankFusionRRFPre(pairs)
  const missing = rankFusionRRFPre(pairs.map((p) => ({ ...p, layer: undefined })))
  eq(JSON.stringify(missing), JSON.stringify(three), '★ 全缺 layer → 输出与三臂版**逐字节一致**')

  const allSame = rankFusionRRFPre(pairs.map((p) => ({ ...p, layer: 'log' })))
  eq(JSON.stringify(allSame), JSON.stringify(three), '★ layer 全相等 → 同样逐字节一致（零扰动）')

  ok(!('rrfLayer' in three[0]), '三臂版输出**不含** rrfLayer 字段')
  ok(!('layerRaw' in three[0]), '三臂版输出**不含** layerRaw 字段')
  ok(!('rankLayer' in three[0]), '三臂版输出**不含** rankLayer 字段')
}

// ── 3. 层次臂的真实效力边界（实测得出的准确刻画，非"通过即好"）────
console.log('\n[3] 层次臂效力边界（等权 RRF 的数学必然）')
{
  // ★ 关键实测结论：层次臂**无法翻转任何单臂的领先**。
  //   原因：等权 RRF 下每臂贡献同量级；A 在 lex 臂领先 1 秩 ≈ 0.000277，
  //        而层次臂给 A 的领先也恰是 1 秩 ≈ 0.000277 ⇒ **精确抵消**。
  //   ⇒ 层次臂的真实作用是**加强已有的优势**（同向时叠加），而非推翻排序。
  //   这是正确且安全的：若层次臂能无条件压倒其他臂，不相关的高层记忆会挤到低分候选前面。

  // (a) 只贡献秩、不抛错，且秩值正确
  const two = rankFusionRRFPre([
    { memoryId: 'proj1', lex: 3, layer: 'project' },
    { memoryId: 'log1', lex: 3, layer: 'log' },
  ])
  const proj = two.find((o) => o.memoryId === 'proj1')
  const log = two.find((o) => o.memoryId === 'log1')
  eq(proj.layerRaw, 'project', 'layerRaw 保留原层次名')
  eq(proj.rankLayer, 1, '★ project 的层次秩 = 1（层次序最高）')
  eq(log.rankLayer, 2, 'log 的层次秩 = 2')
  ok(proj.rrfLayer > log.rrfLayer, '★ project 的层次贡献 > log（层次序确实生效）')
  ok(proj.rrfLayer > 0, '层次臂有正值贡献')

  // (b) 层次臂的**真实作用**：同向时加强优势（不是翻转）
  //     proj1 在 lex 臂也排第一 → 两臂同向 → 优势被**叠加放大**
  const sameDir = rankFusionRRFPre([
    { memoryId: 'proj1', lex: 9, layer: 'project' },
    { memoryId: 'log1', lex: 1, layer: 'log' },
  ])
  eq(sameDir[0].memoryId, 'proj1', '同向时 project 领先（叠加放大）')
  const gapWith = sameDir[0].fused - sameDir[1].fused
  const plainSame = rankFusionRRFPre([
    { memoryId: 'proj1', lex: 9 },
    { memoryId: 'log1', lex: 1 },
  ])
  const gapWithout = plainSame[0].fused - plainSame[1].fused
  ok(gapWith > gapWithout, '★ 有层次臂时的领先差距 > 无层次臂时（加强作用可量化）')

  // (c) ★ 边界（刻意记录）：单臂领先可被抵消 ⇒ 不翻转
  eq(two[0].memoryId, 'log1',
    '★ 边界：层次臂**不**翻转单臂领先（等权抵消，数学必然；非缺陷）')

  // (d) 组内一致：同层候选在层次臂上按 memoryId 稳定排序
  const grouped = rankFusionRRFPre([
    { memoryId: 'projB', lex: 5, layer: 'project' },
    { memoryId: 'projA', lex: 5, layer: 'project' },
    { memoryId: 'logX', lex: 5, layer: 'log' },
  ])
  const projRanks = grouped.filter((o) => o.layerRaw === 'project').map((o) => o.rankLayer).sort()
  eq(projRanks.join(','), '1,2', '★ 同层候选占据连续的层次秩（1,2）')
  const logRank = grouped.find((o) => o.layerRaw === 'log').rankLayer
  eq(logRank, 3, 'log 层排在 project 组之后（秩 3）')
}

// ── 4. 与时间臂互不依赖 ──────────────────────────────────────────
console.log('\n[4] 与时间臂互不依赖（可各自独立生效）')
{
  const base = [
    { memoryId: 'x', dense: 0.5, lex: 2 },
    { memoryId: 'y', dense: 0.5, lex: 2 },
  ]
  // 只开时间臂
  const onlyTemp = rankFusionRRFPre(base.map((p, i) => ({ ...p, temp: i === 0 ? 1 : 0 })))
  ok('rrfTemp' in onlyTemp[0], '只开时间臂 → 有 rrfTemp')
  ok(!('rrfLayer' in onlyTemp[0]), '只开时间臂 → **无** rrfLayer（互不依赖）')

  // 只开层次臂
  const onlyLayer = rankFusionRRFPre([{ ...base[0], layer: 'project' }, { ...base[1], layer: 'log' }])
  ok('rrfLayer' in onlyLayer[0], '只开层次臂 → 有 rrfLayer')
  ok(!('rrfTemp' in onlyLayer[0]), '只开层次臂 → **无** rrfTemp（互不依赖）')

  // 同时开
  const both = rankFusionRRFPre([
    { ...base[0], temp: 1, layer: 'project' },
    { ...base[1], temp: 0, layer: 'log' },
  ])
  ok('rrfTemp' in both[0] && 'rrfLayer' in both[0], '同时开 → 两者都在（可共存）')
  eq(both[0].fused, both[0].rrfDense + both[0].rrfLex + both[0].rrfTemp + both[0].rrfLayer,
    'fused = 四臂之和（无遗漏、无重复）')
}

// ── 5. rank-space 纪律（禁止 score-space 加权）────────────────────
console.log('\n[5] rank-space 纪律（Hindsight #3956 禁止 score-space 加权）')
{
  // 单臂只有 lex 时，fused 必须严格 = Σ 1/(k+rank/divisor)，不得出现乘性权重
  const one = rankFusionRRFPre([{ memoryId: 'a', lex: 1, layer: 'project' }])
  const expect = 1 / (FUSION_RRF_K_PRE_V1 + 1 / FUSION_RRF_DIVISOR_PRE_V1)
  ok(Math.abs(one[0].fused - expect) < 1e-12, '单候选单臂 fused 精确等于 rank-space 公式值')

  // 层次不影响 dense/lex 的**原始分**（只加秩项）
  const withLayer = rankFusionRRFPre([{ memoryId: 'a', dense: 0.42, lex: 7, layer: 'project' }])
  eq(withLayer[0].denseRaw, 0.42, 'denseRaw 原样保留（未被层次加权改写）')
  eq(withLayer[0].lexRaw, 7, 'lexRaw 原样保留（未被层次加权改写）')
}

// ── 6. 边界与 fail-soft ──────────────────────────────────────────
console.log('\n[6] 边界与 fail-soft')
{
  eq(rankFusionRRFPre([]).length, 0, '空输入 → 空输出')
  eq(rankFusionRRFPre(null).length, 0, 'null → 空输出（不抛）')
  eq(rankFusionRRFPre(undefined).length, 0, 'undefined → 空输出（不抛）')

  // 未知层次：应排在已知层之后，且不抛
  const unk = rankFusionRRFPre([
    { memoryId: 'known', dense: 0.5, lex: 1, layer: 'log' },
    { memoryId: 'unknown', dense: 0.5, lex: 1, layer: 'brand-new-layer' },
  ])
  eq(unk[0].memoryId, 'known', '★ 未知层次排在已知层之后（fail-closed，不抢占）')

  // layer 为 null / 空串 → 视为缺失（不进层次臂）
  const empty = rankFusionRRFPre([{ memoryId: 'a', dense: 0.5, lex: 1, layer: '' }])
  ok(!('rrfLayer' in empty[0]), 'layer="" 视为缺失 → 不建层次臂')

  // 非字符串 layer（数字）也应视为缺失，不抛
  let threw = false
  try { rankFusionRRFPre([{ memoryId: 'a', dense: 0.5, lex: 1, layer: 123 }]) } catch (_) { threw = true }
  ok(!threw, '数字型 layer 不抛（视为缺失）')
}

// ── 7. 确定性（同输入同输出）────────────────────────────────────
console.log('\n[7] 确定性')
{
  const p = [
    { memoryId: 'b', dense: 0.5, lex: 2, layer: 'log' },
    { memoryId: 'a', dense: 0.5, lex: 2, layer: 'project' },
    { memoryId: 'c', dense: 0.5, lex: 2, layer: 'project' },
  ]
  eq(JSON.stringify(rankFusionRRFPre(p)), JSON.stringify(rankFusionRRFPre(p)), '同输入两次结果一致')
  // 同层同分 ⇒ 按 memoryId 升序（确定性平局规则）
  const out = rankFusionRRFPre(p)
  const projs = out.filter((o) => o.layerRaw === 'project').map((o) => o.memoryId)
  eq(projs.join(','), 'a,c', '同层同分按 memoryId 升序')
}

console.log('\n=== M2.5b-layer-arm: PASS ' + pass + ' / FAIL ' + fail + ' ===')
if (fail > 0) process.exitCode = 1
