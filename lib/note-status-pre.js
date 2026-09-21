/**
 * 结论层状态（G3）· **纯函数核心** —— 零 IO、零副作用、可单测。
 *
 * ⚠️ **状态：形态候选，未接线**（2026-09-19）
 *   本模块只提供**判定与格式**能力；**没有任何调用方**，因此不产生任何写入。
 *   写盘接线必须等 `G3-DISK-FORMAT-GAP-20260919.md` §4 的 **F1/F2 拍板**后才做：
 *     F1 = 状态行的磁盘语法；F2 = 「显式声明取代」的模型侧写法。
 *   理由（误判代价不对称）：漏判 = 维持现状（可接受）；**误判 = 有效结论被当废纸**。
 *
 * ── 为什么需要本模块（设计稿未覆盖的缺口）─────────────────────────
 * `MEMORY-GOVERNANCE-20260917.md` §8.1 断言「地基已存在，只差写入方」。
 * 实施前核查证明：该断言**只对内存索引列成立**；`status` 的**磁盘表示完全不存在**：
 *   ① `memory-anchor-pre.js:28` `MARKER_RE` 是**严格锚定** ⇒ 锚点行加不了属性；
 *   ② 行首含 `MARKER_OPEN` 但不匹配 ⇒ `malformed-anchor` **冲突**（:214）⇒ 写入被拒（storage-manage:181）；
 *   ③ 全仓**零处**从磁盘读 `status`（`statusOf` 无任何生产者）；
 *   ④ sidecar 不能承载（`memory-writer-pre.js:434` 明示其为**可重建的派生数据**）。
 *   ⇒ 必须先定一个**磁盘形态**，这正是 F1 要拍的板。
 *
 * ── 形态选择（方案 A/B 已排除，见 GAP 文档 §3）────────────────────
 *   方案 A（锚点加属性）❌ 撞 ①②，属契约级改动；
 *   方案 B（独立状态文件）❌ 违反 S10.4「不新建状态源」；
 *   **方案 C（条目正文内保留行）✅ 采用** —— 状态归条目自身，零语法风险，用户可读。
 *
 * ── ★ 关键实现约束：不得污染 L0 ──────────────────────────────────
 * `extractL0Pre` 规则③（`l0-extract-pre.js:385`）会把**所有非标题行压平**成 L0。
 * 若状态行留在正文里，无标题条目的 L0 会变成「⚠已作废…」⇒ **检索质量被污染**
 * （与 M2.5a 修的是同一类问题）。
 * ⇒ 消费方**必须先 `stripStatusLinePre(body)` 再抽取 L0**，或经 `statusOf` 提供状态。
 */

/** 状态行开标记。**刻意不复用** `MARKER_OPEN`（`<!-- memory:`）—— 复用会撞锚点契约。 */
export const NOTE_STATUS_OPEN_PRE_V1 = '<!-- dsh-status:'

/**
 * 状态行语法（F1 候选 (a)：HTML 注释形态）。
 *
 * 为什么用 HTML 注释而非裸行 `status: superseded`：
 *   ① 与仓储既有习俗一致（锚点本身也是 HTML 注释）；
 *   ② 与正文散文**零碰撞**（裸行会被「正文恰好以 status: 开头」误命中）；
 *   ③ 渲染后不可见，不干扰人读 Markdown。
 * 属性值支持裸词与双引号两种写法（reason 含空格时用引号）。
 */
const NOTE_STATUS_RE = /^<!--\s*dsh-status:\s*(current|superseded|retracted)\s*((?:\w+=(?:"[^"]*"|[^\s"]+)\s*)*)-->$/

/** 属性解析：`by=mem_xxx` / `reason="含空格 的原因"`。 */
const NOTE_STATUS_ATTR_RE = /(\w+)=(?:"([^"]*)"|([^\s"]+))/g

/** 只认本仓 id 形态，防把任意文本拼进状态（同 R4-A 的 `supersededMarkPre` 纪律）。 */
const MEMORY_ID_RE = /^mem_[0-9a-f]{32}$/

/** 三态取值域（与 `l0-extract-pre.js` 的 `L0_STATUSES` 同源；此处独立声明以免循环依赖）。 */
export const NOTE_STATUSES_PRE_V1 = Object.freeze(['current', 'superseded', 'retracted'])

/** reason 上限：状态行是**元数据**不是正文，超长即视为脏数据。 */
export const NOTE_STATUS_REASON_MAX_PRE_V1 = 120

/**
 * 渲染状态行（**纯函数**）。
 *
 * `current` ⇒ 返回 `''`（**当前态无需落盘**：缺失即默认 current，少写字节、少一处漂移源）。
 * 未知 status / 非法 id ⇒ 返回 `''`（**fail-closed**：宁可不写，绝不写错 —— 与消费侧同纪律）。
 *
 * @param {string} status current | superseded | retracted
 * @param {{supersededBy?:string, reason?:string}} [opts]
 * @returns {string} 状态行（含 `\n` 时不带）；不可渲染时为空串
 */
export function renderStatusLinePre(status, opts = {}) {
  try {
    if (status !== 'superseded' && status !== 'retracted') return ''
    let line = NOTE_STATUS_OPEN_PRE_V1 + ' ' + status
    const by = opts && opts.supersededBy ? String(opts.supersededBy).trim() : ''
    if (MEMORY_ID_RE.test(by)) line += ' by=' + by
    const reason = opts && opts.reason
      ? String(opts.reason).replace(/[\r\n]+/g, ' ').replace(/--+>/g, '').trim().slice(0, NOTE_STATUS_REASON_MAX_PRE_V1)
      : ''
    if (reason) line += ' reason="' + reason.replace(/"/g, "'") + '"'
    return line + ' -->'
  } catch (_) { return '' }   // fail-soft：渲染失败绝不抛（与 supersededMarkPre 同纪律）
}

/**
 * 解析单行状态。非状态行 ⇒ `null`（不抛、不猜）。
 *
 * 返回对象**只含合法字段**：非法 `by` 被丢弃（不写进结果），未知属性忽略。
 *
 * @param {string} line 单行文本
 * @returns {{status:string, supersededBy?:string, reason?:string}|null}
 */
export function parseStatusLinePre(line) {
  try {
    const s = String(line == null ? '' : line).trim()
    if (!s) return null
    const m = NOTE_STATUS_RE.exec(s)
    if (!m) return null
    const out = { status: m[1] }
    NOTE_STATUS_ATTR_RE.lastIndex = 0
    let a
    while ((a = NOTE_STATUS_ATTR_RE.exec(m[2] || '')) !== null) {
      const key = a[1]
      const val = a[2] !== undefined ? a[2] : a[3]
      if (key === 'by') {
        if (MEMORY_ID_RE.test(String(val || ''))) out.supersededBy = String(val)
      } else if (key === 'reason') {
        const r = String(val || '').replace(/[\r\n]+/g, ' ').trim().slice(0, NOTE_STATUS_REASON_MAX_PRE_V1)
        if (r) out.reason = r
      }
    }
    return out
  } catch (_) { return null }
}

/**
 * 从**条目正文**解析状态。
 *
 * 语义：**最后一个**状态行胜出（后写覆盖先写 —— 状态是"当前值"不是"历史轨迹"）。
 * 无状态行 ⇒ `{status:'current'}`（与索引层「缺失即默认」口径完全一致）。
 *
 * @param {string} body 条目正文（不含锚点行）
 * @returns {{status:string, supersededBy?:string, reason?:string}}
 */
export function statusOfBodyPre(body) {
  const s = String(body == null ? '' : body)
  const lines = s.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const hit = parseStatusLinePre(lines[i])
    if (hit) return hit
  }
  return { status: 'current' }
}

/**
 * 剥掉状态行，返回**可安全送往 L0 抽取**的正文。
 *
 * ★ 这是本模块存在的主要理由之一：不剥 ⇒ 无标题条目的 L0 会被状态行污染（见文件头注释）。
 * 纪律：只删**整行**匹配的；行内出现（如正文引用该语法）**保持原样**交由
 * `checkReservedSyntaxInContent` 一类守卫处理，本函数不做静默改写。
 *
 * @param {string} body
 * @returns {string}
 */
export function stripStatusLinePre(body) {
  const s = String(body == null ? '' : body)
  if (!s.includes(NOTE_STATUS_OPEN_PRE_V1)) return s
  // ★ 2026-09-21 bugfix(A-4):原实现 `split(/\r?\n/).join('\n')` 会把**所有** CRLF 改写成裸 LF,
  //   而本函数的调用方 `applyStatusToRecordPre` 作用于**目标条目正文**并回写整篇文档 ⇒
  //   每次 supersedes/retract/restore 都破坏该条目的行尾,与「除状态行外逐字节保持原样」的
  //   文档承诺相反;本仓文件全 CRLF,还会连带 recordDigest 漂移、GUI diff 放大。
  //   修法:**先探测原文换行风格,再按同风格重组** —— 保持行尾不变(纯函数语义也随之更严格)。
  const nl = s.includes('\r\n') ? '\r\n' : '\n'
  const kept = s.split(/\r?\n/).filter((ln) => parseStatusLinePre(ln) === null)
  // 注意:split 后不含行尾符,join 时统一用探测到的风格;末尾空行会被自然保留(与 split 前条目数一致)
  return kept.join(nl)
}

/**
 * 追加状态行到正文末尾（**纯函数**，不写盘）。
 *
 * 约束（见文件头）：
 *   - 先剥旧状态行 ⇒ 结果是**幂等**的（同参数重复调用不叠加）；
 *   - 只追加在**末尾**，绝不前置（前置会污染 L0 规则②/③）；
 *   - `current` ⇒ 只剥不写。
 *
 * @param {string} body
 * @param {string} status
 * @param {{supersededBy?:string, reason?:string}} [opts]
 * @returns {string}
 */
export function withStatusLinePre(body, status, opts = {}) {
  const base = stripStatusLinePre(body).replace(/[\r\n\s]+$/, '')
  const line = renderStatusLinePre(status, opts)
  if (!line) return base
  return base + '\n' + line
}

/**
 * ★F2 候选 (b)：从**正文**识别「显式声明取代」。
 *
 * ⚠️ 本函数**未接线**，且**不建议作为首个版本的唯一通路**：
 *   用户裁定的门槛是「**(a) 只认显式声明**」，而**结构化参数**（F2 候选 a）才是最纯的显式声明；
 *   从自然语言里正则识别**必然**存在误判，与「宁可漏判不可误判」冲突。
 *   保留它用于：(b)/(c) 落地时作为**第二通路**，或作为「M2 lint 只报告」的输入。
 *
 * 判据（**双条件**，缺一不可 —— 这是保守性的关键）：
 *   ① 出现取代**动作词**（取代/替换/作废/推翻/废弃 supersede）/ 或显式参数；
 *   ② 同时出现**合法 memoryId**。
 *   仅命中其一 ⇒ 返回 `null`（**只报告不标**）。
 *
 * @param {string} content 新写入的正文
 * @returns {{target:string, evidence:string}|null}
 */
export function detectSupersedeIntentPre(content) {
  try {
    const s = String(content == null ? '' : content)
    if (!s) return null
    const ACT_RE = /(取代|替换|作废|废弃|推翻|supersede[sd]?|replaces?)/i
    const ID_RE = /mem_[0-9a-f]{32}/g
    const ids = s.match(ID_RE)
    if (!ids || !ids.length) return null
    if (!ACT_RE.test(s)) return null
    // 去重保序；多目标时**不自动全标**（保守），交调用方逐个确认
    const uniq = [...new Set(ids)]
    return { target: uniq[0], evidence: (s.match(ACT_RE) || [''])[0] }
  } catch (_) { return null }
}
