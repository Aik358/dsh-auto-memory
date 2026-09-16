/**
 * ledger-criteria-pre —— WB-GRAPH P1 判据校验中间件核心(2026-09-16, ledger_criteria_v1)。
 *
 * 权威依据: WB-GRAPH-INTEGRATION-PLAN.md §2.2 判据定义表 + WB-FORMAT-CONVENTION.md v1
 *   + WB-GRAPH-DECISIONS-20260914.md §E(2026-09-16 拍板: P1 全量、A6 照写+警示行、B7 跳过试点)。
 *
 * 设计(方案 §2.1-2.5):
 *  - 纯函数、零 IO、fail closed(仿 handoff-anchor-pre.js 契约)。
 *  - 硬判据 = 确定性可计算(标题逐字/非空/占位符/长度), 不过 → 拒绝写入。
 *  - 软判据 = 启发式, 只标记不拦截(误报不可忽略; 水位骨架素材空时天然不满足 → 绝不阻塞接续 I4)。
 *  - 白板判据取可计算子集(零 LLM), 自然语言质量层交既有 prompt 纪律(§2.1 结论)。
 *  - 报告契约 = §2.5 ledger_criteria_v1 JSON(机器可读, P2 确认事件消费)。
 */

export const LEDGER_CRITERIA_VERSION = 'ledger_criteria_v1'
// 兼容性再导出(2026-09-16 勘误): P0 窗口的 wb-contract-pre.js 已实现同名判据函数(H1-H4/S1-S4),
// 且 index.js 两咽喉(checkMutationPre)已接线它 — 本模块勿重复造轮,统一转发保持单一真源。
export { checkHandoffCriteriaPre as checkHandoffCriteriaContractPre, checkPlanCriteriaPre as checkPlanCriteriaContractPre } from './wb-contract-pre.js'

import { parseHandoffLedgerPre } from './handoff-anchor-pre.js'

/** 交接账本四段权威标题(与 handoff-anchor-pre.js 权重表同源)。 */
export const HANDOFF_SECTIONS_PRE_V1 = Object.freeze(['任务状态', '目标', '已试方案与失败原因', '进度与下一步'])

/** 占位符黑名单(借 dsh-graph CRITERIA_PLACEHOLDERS 技巧, 方案 H3)。 */
export const CRITERIA_PLACEHOLDERS_PRE_V1 = Object.freeze(['(待补充)', '（待补充）', 'TODO', '同上', '略', 'N/A', 'n/a'])

/** 账本硬上限(H4, 与 sanitizeForWrite 8000 同源, 先于它执行)。 */
export const LEDGER_MAX_CHARS_PRE_V1 = 8000
/** 白板硬上限(P-H2, 200000)。 */
export const PLAN_MAX_CHARS_PRE_V1 = 200000

function nz(s) { return String(s || '') }

function sectionBodies(parsed) {
  // parseHandoffLedgerPre 的 title 保留 '## ' 前缀原样行 — 剥前缀与尾随空白后与权威表比对。
  return parsed.sections.map((s) => ({ title: nz(s.title).replace(/^##\s*/, '').replace(/\s+$/, ''), body: s.body }))
}

function isPlaceholderLine(line) {
  const t = nz(line).trim()
  if (!t) return false
  return CRITERIA_PLACEHOLDERS_PRE_V1.some((p) => t === p || t === '-' + p || t === '*' + p)
}

/** H2: 每段 body 非空(≥1 非空行且合计 ≥20 字符)。 */
function bodyStat(body) {
  const arr = Array.isArray(body) ? body : []
  const nonEmpty = arr.filter((l) => nz(l).trim()).length
  const chars = arr.join('').replace(/\s/g, '').length
  return { nonEmpty, chars }
}

/**
 * 校验交接账本(kind=handoff)。判据 H1-H4 硬 / S1-S4 软(方案 §2.2)。
 * @param {string} text 账本全文
 * @returns {report} §2.5 ledger_criteria_v1(不抛错; 解析失败按 H1 fail 处理)
 */
export function checkHandoffCriteriaPre(text) {
  const hard = []
  const soft = []
  let parsed = null
  try { parsed = parseHandoffLedgerPre(text) } catch (_) { parsed = null }

  // H1 四段标题齐全且逐字匹配
  const titles = parsed ? sectionBodies(parsed).map((x) => x.title) : []
  const missing = HANDOFF_SECTIONS_PRE_V1.filter((t) => !titles.includes(t))
  hard.push({ id: 'H1', pass: !!parsed && missing.length === 0, missing: parsed ? missing.map((t) => '缺段:' + t) : ['解析失败(无任何 ## 段)'] })

  // H2 每段非空
  const emptySections = parsed ? sectionBodies(parsed).filter((x) => { const st = bodyStat(x.body); return st.nonEmpty < 1 || st.chars < 20 }).map((x) => x.title) : []
  hard.push({ id: 'H2', pass: !!parsed && emptySections.length === 0, missing: emptySections.map((t) => '空段:' + t) })

  // H3 无占位符行(段 body 整行即占位符)
  const placeholderHits = []
  if (parsed) for (const s of sectionBodies(parsed)) for (const l of s.body) if (isPlaceholderLine(l)) placeholderHits.push('[' + s.title + '] ' + l.trim())
  hard.push({ id: 'H3', pass: placeholderHits.length === 0, missing: placeholderHits.slice(0, 5) })

  // H4 总长 ≤8000
  const len = nz(text).length
  hard.push({ id: 'H4', pass: len <= LEDGER_MAX_CHARS_PRE_V1, missing: len > LEDGER_MAX_CHARS_PRE_V1 ? ['总长 ' + len + ' > ' + LEDGER_MAX_CHARS_PRE_V1] : [] })

  // S1 每段 ≤5 行(软)
  const overLong = parsed ? sectionBodies(parsed).filter((x) => x.body.filter((l) => l.trim()).length > 5).map((x) => x.title) : []
  soft.push({ id: 'S1', pass: overLong.length === 0, detail: overLong.length ? '超 5 行段: ' + overLong.join('、') : '' })

  // S2 失败项含报错关键词(软)
  const failSection = parsed ? sectionBodies(parsed).find((x) => x.title === '已试方案与失败原因') : null
  const failText = failSection ? failSection.body.join('') : ''
  const s2pass = !failSection || /失败|报错|错误|回滚|error|fail|bug/i.test(failText)
  soft.push({ id: 'S2', pass: s2pass, detail: s2pass ? '' : '失败项建议写成「方案→失败原因」并保留报错关键词' })

  // S3 下一步含可执行特征(软)
  const nextSection = parsed ? sectionBodies(parsed).find((x) => x.title === '进度与下一步') : null
  const nextText = nextSection ? nextSection.body.join('') : ''
  const s3pass = !nextSection || /[\\/]|`|：:\s*(读取|运行|执行|检查|写|改|删|重建|跑)/.test(nextText)
  soft.push({ id: 'S3', pass: s3pass, detail: s3pass ? '' : '下一步建议含可执行特征(路径/代码/命令动词)' })

  const hard_pass = hard.every((x) => x.pass)
  return { version: LEDGER_CRITERIA_VERSION, target: 'handoff', hard_pass, hard, soft }
}

/**
 * 校验白板 PLAN(kind=plan)。判据刻意最弱(P-H1/P-H2 硬, P-S1 软, 方案 §2.2 白板表)。
 */
export function checkPlanCriteriaPre(text) {
  const hard = []
  const soft = []
  const src = nz(text)
  // P-H1 至少一个 '## ' 顶层节且非空(≥20 非空白字符)
  const lines = src.split('\n')
  const sections = []
  let cur = null
  for (const line of lines) {
    if (/^## (.+)$/.test(line.replace(/\r$/, ''))) { if (cur) sections.push(cur); cur = { body: [] } }
    else if (cur) cur.body.push(line)
  }
  if (cur) sections.push(cur)
  const nonEmptySections = sections.filter((s) => s.body.join('').replace(/\s/g, '').length >= 20)
  hard.push({ id: 'P-H1', pass: nonEmptySections.length >= 1, missing: nonEmptySections.length === 0 ? ['无非空 ## 顶层节(全部节被老化走或空白板)'] : [] })
  // P-H2 长度
  hard.push({ id: 'P-H2', pass: src.length <= PLAN_MAX_CHARS_PRE_V1, missing: src.length > PLAN_MAX_CHARS_PRE_V1 ? ['总长 ' + src.length + ' > ' + PLAN_MAX_CHARS_PRE_V1] : [] })
  // P-S1 前瞻内容(软)
  const s1pass = /下一步|待办|计划|todo/i.test(src)
  soft.push({ id: 'P-S1', pass: s1pass, detail: s1pass ? '' : '建议含前瞻内容(下一步/待办/计划)' })
  const hard_pass = hard.every((x) => x.pass)
  return { version: LEDGER_CRITERIA_VERSION, target: 'plan', hard_pass, hard, soft }
}

/** 统一入口: 按 target 分派。未知 target fail closed(返回 hard_pass=false)。 */
export function checkWriteCriteriaPre(target, text) {
  if (target === 'handoff') return checkHandoffCriteriaPre(text)
  if (target === 'plan') return checkPlanCriteriaPre(text)
  return { version: LEDGER_CRITERIA_VERSION, target: String(target || ''), hard_pass: false, hard: [{ id: 'INVALID', pass: false, missing: ['未知 target'] }], soft: [] }
}

/** 把 report 渲染为可执行改写指引文案(P1-4 工具层拒绝文案用)。 */
export function renderCriteriaRejectionPre(report) {
  const misses = []
  for (const h of report.hard) if (!h.pass) misses.push(...(h.missing || []))
  return '[写入门·判据未过(' + report.target + ')] 以下硬判据不通过, 请修正后重试(结构修正即可, 无需重写全文):\n- ' + misses.join('\n- ')
}
