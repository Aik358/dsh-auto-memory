/**
 * 记忆写入保护门（memory_mutation_v1）—— 3.0 主体拥有「共同提交与保护入口」。
 *
 * 2026-09-14 建立（P0）。**边界（总纲 §0.5 / ROUND3 §3.1 定案，必须遵守）**：
 *   - **本模块**只接收**规范化投影**：`{beforeIds, afterIds, protectedRegions, changes}`。
 *     它**不自行解释图格式** —— 不知道 `### ` 是什么、不知道 `<!-- user -->` 是什么。
 *   - **格式由适配器提供**：白板走 `lib/wb-contract.js:parseWhiteboardPre` → `toMutationProjectionPre`；
 *     账本/笔记等其他目标各给各的投影。**格式只维护一份**。
 *
 * **为什么要这个门**（不是一个好想法，是事故根因）：
 *   `WB-FORMAT-CONVENTION.md` §4 的写入门只做一件事 —— **重写前后比对卡片集合**：
 *   允许移动、改状态、改正文、加卡；**不允许卡片凭空消失**；要消失必须显式移入 `archived` 并留痕。
 *   实际事故是「白板被整篇覆盖成骨架」（规范已批准、代码从未实现）。
 *   2026-09-14 实测缺口：`PLAN.md` 一个锚点、一个分区标记都没有。
 *
 * **三条保护**（每条都有能红断言，见 `tests/smoke/smoke-test-t0-8-mutation-gate-pre.mjs`）：
 *   M1 **丢卡保护**：`beforeIds` 里有、`afterIds` 里没有的 id，必须出现在 `archived` 里（显式归档 + 留痕）；
 *      否则**拒绝写入**并报出差异清单（不是静默接受）。
 *   M2 **用户区保护**（B4 预授权默认值：每卡分「模型维护区 / 用户备注区」）：
 *      `protectedRegions` 的 digest 必须原样出现在 after 侧 —— 模型整篇重写**必须原样带回**用户段。
 *   M3 **重复 id 保护**：after 侧同一 id 出现两次即拒绝（契约 §2 禁止复用同一 id 指两个卡片）。
 *
 * **fail-open 不得绕过保护**（ROUND3 §3.7 第 4 条，总纲 v2 明确）：
 *   `criteriaGate=false` 与"骨架 fail-soft"**只能退掉可选质量门**（H1–H4/S1–S4/P-H1/P-H2 那类
 *   判据），**不得**跳过丢卡、用户区、版本、状态保护。本模块的 `strict` 参数**只影响
 *   `changes` 类软项**（例如"本次是骨架写入"的提示），**对 M1/M2/M3 无任何影响** ——
 *   这三条是**无条件**的。测试 `T0-8C` 专门锁这一点。
 *
 * S9 合规：零 IO、零外部依赖（只用 node:crypto 做摘要）、纯函数、无网络/无 LLM/无子进程/无 await。
 * UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

export const MEMORY_MUTATION_VERSION = 'memory_mutation_v1'

/** 拒绝/提示的原因码 → 可读中文。 */
export const MUTATION_REASONS_V1 = Object.freeze({
  'card-disappeared': '卡片消失且无归档记录（契约 §4：不允许凭空消失）',
  'protected-region-lost': '受保护区域（用户备注区）未被原样带回',
  'protected-region-modified': '受保护区域被改动（必须逐字节保留）',
  'duplicate-id': '同一 id 在写入后出现两次（契约 §2 禁止）',
  'invalid-projection': '规范化投影形状非法（缺 beforeIds/afterIds）',
  'not-object': '传入的不是对象',
})

/** 原因码 → 可读中文（未知码原样返回）。 */
export function describeMutationReasonPre(code) {
  const k = String(code == null ? '' : code)
  return MUTATION_REASONS_V1[k] || k || '未知原因'
}

const asStringArray = (v) => (Array.isArray(v) ? v.map((x) => String(x == null ? '' : x)).filter(Boolean) : null)
const sha = (s) => createHash('sha256').update(String(s == null ? '' : s)).digest('hex').slice(0, 16)

/**
 * 共同提交与保护入口（**纯函数**）。
 *
 * @param {object} input
 * @param {string[]} input.beforeIds 写入前该目标拥有的卡片 id 集合（规范化投影；首建传 `[]`）
 * @param {string[]} input.afterIds  写入后将要拥有的卡片 id 集合
 * @param {Array<{key:string,digest:string,chars?:number}>} [input.protectedRegions]
 *   受保护区域的摘要清单（前后比对用；通常来自适配器的 `extractProtectedRegionsPre`）
 * @param {Array<{key:string,digest:string}>} [input.afterProtectedRegions]
 *   写入后同区域的实际摘要。**省略时的语义必须明确**：视为"无法证明被保留" ⇒ **拒绝**（fail closed），
 *   而不是"默认通过"。这是因为"忘了传"和"真的丢了"在保护语义上必须同样处理。
 * @param {string[]} [input.archivedIds] 显式归档的 id（进入归档集合 + 留痕 = 合法"消失"）
 * @param {object} [input.changes] 供报告使用的变更描述（**不参与保护判定**）
 * @param {string} [input.target] 'plan' | 'handoff' | 'note' | 'other'（仅用于报告）
 * @param {boolean} [input.strict=true] 只影响软提示（如"骨架写入"）；**不影响 M1/M2/M3**
 * @returns {{ok:boolean, version:string, target:string, gate:string,
 *            hard:Array<{id:string, pass:boolean, missing:Array, detail:string}>,
 *            soft:Array<{id:string, pass:boolean, detail:string}>,
 *            report:{disappeared:string[], archived:string[], unarchived:string[],
 *                    protectedChecked:number, protectedOk:number, duplicateIds:string[]}}}
 */
export function validateMutationBoundaryPre(input = {}) {
  const o = input && typeof input === 'object' ? input : null
  const target = String((o && o.target) || 'other')
  const strict = !o || o.strict !== false
  const hard = []
  const soft = []

  if (!o) {
    hard.push({ id: 'M0', pass: false, missing: ['projection'], detail: describeMutationReasonPre('not-object') })
    return report(false, target, hard, soft, emptyReport())
  }

  const beforeIds = asStringArray(o.beforeIds)
  const afterIds = asStringArray(o.afterIds)
  if (!beforeIds || !afterIds) {
    hard.push({ id: 'M0', pass: false, missing: ['beforeIds', 'afterIds'].filter((k) => !Array.isArray(o[k])), detail: describeMutationReasonPre('invalid-projection') })
    return report(false, target, hard, soft, emptyReport())
  }

  const archived = asStringArray(o.archivedIds) || []
  const afterSet = new Set(afterIds)
  const beforeSet = new Set(beforeIds)

  // ── M1 丢卡保护（无条件；`strict`/质量门开关都绕不过） ──
  const disappeared = beforeIds.filter((id) => !afterSet.has(id))
  const unarchived = disappeared.filter((id) => !archived.includes(id))
  hard.push({
    id: 'M1',
    pass: unarchived.length === 0,
    missing: unarchived.slice(),
    detail: unarchived.length
      ? '这些卡片消失了且没有归档记录：' + unarchived.slice(0, 8).join('、')
        + (unarchived.length > 8 ? ' 等 ' + unarchived.length + ' 张' : '')
        + '。契约 §4：要"消失"必须显式移入归档集合并留痕（时间 + 原因）。'
      : '前后比对无未归档的丢卡（消失 ' + disappeared.length + ' 张，其中已归档 ' + (disappeared.length - unarchived.length) + ' 张）',
  })
  const newlyArchived = archived.filter((id) => !beforeSet.has(id))

  // ── M3 重复 id 保护（契约 §2：禁止复用同一个 id 指两个卡片） ──
  const seen = new Set()
  const duplicateIds = []
  for (const id of afterIds) {
    if (seen.has(id)) { if (!duplicateIds.includes(id)) duplicateIds.push(id) }
    else seen.add(id)
  }
  hard.push({
    id: 'M3',
    pass: duplicateIds.length === 0,
    missing: duplicateIds.slice(),
    detail: duplicateIds.length
      ? '写入后同一 id 出现两次：' + duplicateIds.slice(0, 6).join('、') + '。契约 §2 禁止复用同一 id 指两个卡片。'
      : '写入后无重复 id（' + afterIds.length + ' 张）',
  })

  // ── M2 用户区保护（无条件；**省略 afterProtectedRegions = fail closed**） ──
  const prot = Array.isArray(o.protectedRegions) ? o.protectedRegions.filter(Boolean) : []
  const afterProtRaw = o.afterProtectedRegions
  const afterProtMissing = !Array.isArray(afterProtRaw)
  const afterProt = afterProtMissing ? [] : afterProtRaw.filter(Boolean)
  const afterByKey = new Map(afterProt.map((r) => [String((r && r.key) || ''), String((r && r.digest) || '')]))
  const lost = []
  const modified = []
  for (const r of prot) {
    const key = String((r && r.key) || '')
    const want = String((r && r.digest) || '')
    if (!afterByKey.has(key)) { lost.push(key); continue }
    if (afterByKey.get(key) !== want) modified.push(key)
  }
  const m2pass = !afterProtMissing && lost.length === 0 && modified.length === 0
  hard.push({
    id: 'M2',
    pass: m2pass,
    missing: lost.concat(modified),
    detail: afterProtMissing
      ? '未提供写入后的受保护区域摘要（afterProtectedRegions）⇒ 无法证明用户备注区被保留，按 fail closed 拒绝。'
        + '（"忘了传"与"真的丢了"在保护语义上必须同样处理。）'
      : (m2pass
        ? '受保护区域 ' + prot.length + ' 处全部原样保留（逐摘要比对）'
        : '受保护区域未原样保留：丢失 ' + lost.length + ' 处、被改动 ' + modified.length + ' 处'
          + (lost.concat(modified).length ? '（' + lost.concat(modified).slice(0, 6).join('、') + '）' : '')
          + '。契约 §5：模型整篇重写必须原样带回用户段。'),
  })

  // ── 软项：只做提示，不拦截（`strict=false` 只影响这里） ──
  const newCards = afterIds.filter((id) => !beforeSet.has(id))
  soft.push({
    id: 'S-cards',
    pass: true,
    detail: '新增 ' + newCards.length + ' 张 · 消失 ' + disappeared.length + ' 张（已归档 ' + newlyArchived.length + ' 张）'
      + ' · 保留 ' + afterIds.filter((id) => beforeSet.has(id)).length + ' 张',
  })
  if (strict && beforeIds.length > 0 && afterIds.length === 0) {
    soft.push({ id: 'S-empty', pass: false, detail: '写入后卡片集合为空（整篇被覆盖成空白板的典型形态）—— 已由 M1 硬拦，此处仅提示' })
  }
  if (!strict) {
    soft.push({ id: 'S-strict-off', pass: true, detail: 'strict=false：已退掉可选质量门（不影响 M1/M2/M3 三条共同保护）' })
  }

  return report(hard.every((h) => h.pass), target, hard, soft, {
    disappeared, archived, unarchived, newlyArchived,
    protectedChecked: prot.length, protectedOk: prot.length - lost.length - modified.length,
    protectedLost: lost, protectedModified: modified,
    duplicateIds,
  })
}

function emptyReport() {
  return {
    disappeared: [], archived: [], unarchived: [], newlyArchived: [],
    protectedChecked: 0, protectedOk: 0, protectedLost: [], protectedModified: [], duplicateIds: [],
  }
}

function report(hardPass, target, hard, soft, r) {
  return {
    version: MEMORY_MUTATION_VERSION,
    target,
    // gate 名与 WB-GRAPH §2.4 的既有约定一致，便于工具层按 `gate==='criteria'`/`'mutation'` 分支
    gate: 'mutation',
    ok: hardPass,
    hardPass,
    hard,
    soft,
    report: r,
  }
}

/**
 * 把校验报告压成**给模型看的可执行拒绝文案**（不是给作者看的日志）。
 *
 * 为什么单独一个函数：拒绝文案要能直接驱动"改写后重试"。缺什么、哪张卡、哪个区，
 * 必须逐条列出 —— 模型拿到"写入失败"四个字是修不回来的。
 *
 * @param {object} res `validateMutationBoundaryPre` 的返回值
 * @returns {string}
 */
export function mutationRefusalTextPre(res) {
  const r = res && typeof res === 'object' ? res : {}
  const failed = (Array.isArray(r.hard) ? r.hard : []).filter((h) => !h.pass)
  if (!failed.length) return ''
  const lines = failed.map((h) => '· [' + h.id + '] ' + h.detail)
  const failedIds = new Set(failed.map((h) => String((h && h.id) || '')))
  const fixes = []

  // ★出路必须按失败类型给：archivedIds 只解决 M1，不能冒充 M2/M3 的万能修法。
  if (failedIds.has('M1')) {
    fixes.push('· [M1] 若只是漏抄卡片，请把标题 + 锚点行 + 正文（含用户备注区）原样带回；'
      + '若确属有意移除，才传 archivedIds 声明归档（旧版整份已在 handoff/archive/ 留痕）。')
  }
  if (failedIds.has('M2')) {
    fixes.push('· [M2] 恢复受保护的用户备注区，并逐字节原样带回；archivedIds 不能修复用户区丢失或改写。')
  }
  if (failedIds.has('M3')) {
    fixes.push('· [M3] 修正重复锚点，确保写入后每个 card id 唯一；archivedIds 不能修复重复 id。')
  }
  if (!fixes.length) fixes.push('· 请按上方失败项逐项修正。')

  return '写入被记忆保护门拦截（' + failed.map((h) => h.id).join('/') + '），原文件未改动：\n' + lines.join('\n')
    + '\n请逐项修正后重试：\n' + fixes.join('\n')
    + '\n白板重写前请先 read 磁盘 handoff/PLAN.md 原文抄全锚点（注入快照会被截断）。'
}

/**
 * 便捷入口：把"before 投影 + after 投影"直接对照（两端都由适配器产出）。
 *
 * @param {{before:object, after:object, archivedIds?:string[], target?:string, strict?:boolean}} input
 */
export function validateProjectionPairPre(input = {}) {
  const o = input && typeof input === 'object' ? input : {}
  const before = o.before && typeof o.before === 'object' ? o.before : null
  const after = o.after && typeof o.after === 'object' ? o.after : null
  return validateMutationBoundaryPre({
    target: o.target,
    strict: o.strict,
    beforeIds: before ? before.cardIds || before.ids || [] : null,
    afterIds: after ? after.cardIds || after.ids || [] : null,
    protectedRegions: before ? before.protectedRegions || [] : [],
    afterProtectedRegions: after ? after.protectedRegions || [] : undefined,
    archivedIds: o.archivedIds || [],
    changes: o.changes,
  })
}

/** 受保护区域摘要（给适配器与测试共用的唯一算法：只取 16 位十六进制，够比对、不泄露原文）。 */
export function protectedRegionDigestPre(text) {
  return sha(text)
}
