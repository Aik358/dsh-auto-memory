/**
 * prompt.js —— 输入规范化 + prompt 构造 + promptSha256。
 *
 * 职责边界：
 *   · 把 (记录, 候选池, 触发来源) 规范化成**确定性的**模型输入文本
 *   · 计算 promptSha256（同一输入必得同一哈希 ⇒ 结果可复现、可审计）
 *
 * 禁止：调用宿主模型、解析模型输出、读写文件。
 *
 * ★确定性要求：本模块**不得**读取时钟、随机数、环境变量。
 *   同一 (record, candidates, trigger) 必须产出逐字节相同的 prompt —— 否则 promptSha256 无意义。
 */

import { createHash } from 'node:crypto'
import { EVENT_ATTRIBUTION_PROFILE_V1, TRIGGERS } from './contract.js'

/**
 * 规范化记录文本：压空白、去控制字符、按预算截断。
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {{ text:string, truncated:boolean, originalChars:number }}
 */
export function normalizeRecordPre(text, maxChars) {
  const lim = Math.max(80, Number(maxChars) || EVENT_ATTRIBUTION_PROFILE_V1.budget.maxRecordChars)
  const raw = String(text == null ? '' : text)
  // 去控制字符（保留 \n\t），再压连续空白 —— 顺序固定，保证确定性
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const truncated = cleaned.length > lim
  return { text: truncated ? cleaned.slice(0, lim) : cleaned, truncated, originalChars: cleaned.length }
}

/**
 * 构造模型 prompt。
 *
 * ★四态判据与「时间/主题不构成归属证据」的硬约束写进 prompt —— 这两条来自实证：
 *   · task-26：同域语义相似度是噪声（语义召回 0.25 vs 字面 0.5125）
 *   · task-27：sameDay 0.9028 < >30d 0.9767 ⇒ 「越近越可能同事件」不成立
 *
 * @param {{ record:object, candidates:Array<object>, trigger:string, pool:object }} input
 * @returns {{ prompt:string, promptSha256:string, promptVersion:string }}
 */
export function buildPromptPre(input = {}) {
  const prof = EVENT_ATTRIBUTION_PROFILE_V1
  const rec = input.record || {}
  const cands = Array.isArray(input.candidates) ? input.candidates : []
  const pool = input.pool || {}
  const trig = String(input.trigger || TRIGGERS.UNASSIGNED)

  const lines = []
  lines.push('你是事件归属判定器。判断下面这条【记录】应当归到哪个已有事件，还是应当新建。')
  lines.push('')
  lines.push('判定协议（严格遵守，不得跳步）：')
  lines.push('1. 只有当某候选与记录**实质对应同一件事**时，才判 attach-existing 并给出该 eventId。')
  lines.push('2. 记录本身是一个新任务、候选里没有对应同一件事的旧事件 ⇒ 判 create-new。')
  lines.push('3. 有多个同样合理、证据无法区分的候选 ⇒ 判 ambiguous，并列出分歧点。')
  lines.push('4. 候选都不适用（例如全部已关闭且无合适的开放容器）⇒ 判 not-applicable。')
  lines.push('5. **时间近不等于同一件事**：同一周内的不同工作是不同事件。时间只是约束，不是「越近越可能」。')
  lines.push('6. **主题相似不等于同一件事**：都属于某个领域或都提到某关键词，不代表是同一件事。')
  lines.push('7. 只能从给定候选里选 eventId；**不得创造 ID**。没有合适候选就判 create-new。')
  lines.push('8. 不确定就给 ambiguous，并在 counterHypothesis 里写出最强反对理由。')
  lines.push('')
  lines.push('只输出一个 JSON 对象，不要任何解释文字或代码块围栏。字段：')
  lines.push('{"decision":"attach-existing|create-new|ambiguous|not-applicable",')
  lines.push(' "selectedEventId":null, "rationale":"<=150字", "counterHypothesis":"<=100字"}')
  lines.push('')
  if (pool && Number(pool.omittedCount) > 0) {
    lines.push('【重要：候选不完整】')
    lines.push('本次只看到 eligible 候选中的 ' + Number(pool.visibleCount) + ' 条，'
      + '另有 ' + Number(pool.omittedCount) + ' 条未展示（共 ' + Number(pool.eligibleCount) + ' 条）。')
    lines.push('因此若你认为「应当有更合适的旧事件但没看到」，请判 ambiguous 并在 rationale 说明，'
      + '**不要**因为看不到就断言 create-new。')
    lines.push('')
  }
  lines.push('【触发来源】' + trig)
  lines.push('')
  lines.push('【记录】')
  lines.push('at: ' + (rec.atIso || ''))
  if (rec.kind) lines.push('kind: ' + String(rec.kind))
  lines.push('text:')
  lines.push(String(rec.text || ''))
  lines.push('')
  lines.push('【候选事件】（按确定顺序给出，非相关度排序）')
  if (!cands.length) {
    lines.push('（无 eligible 候选）')
  } else {
    for (const c of cands) {
      lines.push('- eventId: ' + c.eventId)
      for (const ev of (Array.isArray(c.evidence) ? c.evidence : [])) lines.push('  ' + ev)
    }
  }
  const prompt = lines.join('\n')
  const promptSha256 = createHash('sha256').update(prompt, 'utf8').digest('hex')
  return { prompt, promptSha256, promptVersion: prof.promptVersion }
}

export default { normalizeRecordPre, buildPromptPre }
