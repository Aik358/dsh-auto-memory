/**
 * lib/user-portrait.js —— v4-H5：用户画像段（跨事件聚合「这个人是谁」）。
 *
 * ★为什么必须独立成段（不是并入 rules-section）：
 *   用户原话（SPEC-v2 L14）：「用户画像记忆和项目规约还是可以单独的」⇒ 两者**并列**，不能合并。
 *   语义也不同：
 *     · rules-section  = 「这个项目必须怎么做」（项目规约 / 硬约束）
 *     · user-portrait  = 「**这个人是谁**」（跨项目的偏好 / 当前状态 / 未完成目标）
 *
 * ★★2026-10-25 数据来源的硬教训（决定了本模块**不做**语料启发式抽取）：
 *   实测 1：`kind` 字段根本没落到可检索元数据层 —— index/files/ 下 300 个 json / 3,491 条 records，
 *           带 kind 的 = 0；kindTag 只进日日志正文前缀（lib/index.js L19000），MEMORY.md 里已丢失。
 *           ⇒ 「按 kind=preference 抽取」这条路**不存在**。
 *   实测 2：纯文本特征词抽取准确率仅 20% —— 严格组（偏好/喜欢/不要/禁止）在真实
 *           user MEMORY.md 的 138 个 `- ` 条目里命中 10 条，其中 3 条是项目技术规范
 *           （CR-10 验收纪律 / 空 catch 门控 / HTML 注释标记），真正该进画像的只有 2 条。
 *           ⇒ 正则分不开「用户是谁」与「项目怎么做事」，而把技术规范塞进画像段
 *             会让模型误以为那是主人的性格偏好 —— **比空段更糟**。
 *   ⇒ 本模块**只消费结构化数据**（events[].userPercept），不猜。
 *     写入端的职责是模型/工具（memory_event action=append 的 userPercept 参数，已接线实测可用）。
 *
 * ★stage 过滤依据：
 *   PERCEPT_STAGES = ['retrieved','delivered','used','mentioned','accepted'] 是**五阶段流水线**。
 *   只有 accepted / used 代表「用户确认过 / 真的用过」⇒ 才配进画像。
 *   retrieved / delivered / mentioned 只代表「被检索到 / 被投递 / 被提到过」⇒ 是噪声，不进画像。
 *
 * ★零依赖设计：本模块不 import 任何东西（含 event-store / event-render），
 *   以便被测套件与源码抽取式沙箱都能独立执行。
 */

/** 画像段硬上限（§7.2）。★模块常量，不是配置键 —— DEFAULT_CONFIG 键数恒 163。 */
export const PORTRAIT_MAX_CHARS = 600

/** 每一类的条数上限（§7.4：偏好 ≤5 / 当前状态 ≤3 / 未完成目标 ≤3）。 */
export const PORTRAIT_LIMITS = Object.freeze({
  preference: 5,
  state: 3,
  unfinished: 3,
  // ★task-33（2026-10-25 用户裁定「要加入作者回应这类内容」）：第四类独立配额。
  //   为什么不复用 preference：偏好是「他喜欢什么」，作者回应是「他对我说的话怎么回的」——
  //   混在一起画像段就废了；且会挤占 preference 的 5 条配额 ⇒ 越聊越不像他。
  authorResponse: 3,
})

/**
 * 只有这两个 stage 代表「用户确认过 / 真的用过」，才配进画像。
 * retrieved / delivered / mentioned 是被动阶段（被检索到/被投递/被提到），是噪声。
 */
export const PORTRAIT_STAGES = Object.freeze(['accepted', 'used'])

/**
 * ★2026-10-28（审计缺陷 D2）：**stage 白的旁路：authorResponse 不受 stage 门限制**。
 *
 * 缺陷实证：事件库实测 userPercept 14 条全是 accepted、sharedGround 6 条、commitments 6 条，
 *   但**没有一条 authorResponse** —— 因为提示词教模型写 `{kind:'authorResponse', text:'这个方案我不同意'}`
 *   （只填 kind，不填 stage），而抽取段第一道门是 `PORTRAIT_STAGES.indexOf(stage) < 0 -> continue`，
 *   stage 为空串 ⇒ 直接 continue ⇒ 用户的正面回应/反对**永远进不了画像**。
 *
 * 语义依据：stage 回答「这条观察处于哪个生命周期」（被检索到？被确认？），
 *   kind 回答「这条观察是什么类型」（偏好？作者回应？）。authorResponse 是**类型**，
 *   它的可信度不来自 stage 而是来自「用户亲口说的」这一事实本身 ⇒ 不需要 stage 背书。
 *
 * 保守边界：只放行 authorResponse 一种 kind，其余 kind 仍必须过 stage 门。
 */
export const PORTRAIT_KIND_BYPASS = Object.freeze(['authorResponse'])

/** 三类标题（顺序即输出顺序，与 §7.4 一致）。 */
const CATEGORY_TITLES = [
  ['preference', '偏好'],
  ['state', '当前状态'],
  ['unfinished', '未完成目标'],
  ['authorResponse', '作者回应'],
]

/**
 * 把 userPercept 的 kind 归一到三类。
 *
 * 已知 kind 取值（memory_event 工具的 userPercept.kind 是自由串）：
 *   preference / state / unfinished-goal 三种是 §7.4 定义的；
 *   其余一律回落 preference（保守：宁可归到「偏好」也不丢，因为 preference 配额最大 = 5 条）。
 */
function categoryOfPre(kind) {
  const k = String(kind || '').trim().toLowerCase()
  // ★★task-33（2026-10-25）：`authorResponse`（作者回应）必须**显式命中**，不能靠兜底。
  //   缺陷实证（改前）：`{kind:'authorResponse',text:'这个方案我不同意'}` 会被兜底归到 preference
  //   ⇒ 画像段出现「偏好：这个方案我不同意」，语义错位且挤占 preference 配额。
  //   ★兜底行为（未知 kind ⇒ preference）**保留** —— 保守不丢；但 authorResponse 属于**已知**取值，不许走兜底。
  if (k === 'authorresponse' || k === 'author-response' || k === 'author_response') return 'authorResponse'
  if (k === 'state' || k === 'status') return 'state'
  if (k === 'unfinished' || k === 'unfinished-goal' || k === 'goal' || k === 'todo') return 'unfinished'
  return 'preference'
}

/** 安全截断（不切断代理对，超限加省略号）。与 event-render 的 cutPre 口径一致但不依赖它。 */
function cutSafePre(text, max) {
  const s = String(text == null ? '' : text)
  if (!Number.isFinite(max) || max <= 0) return ''
  if (s.length <= max) return s
  if (max <= 1) return '\u2026'
  let cut = s.slice(0, max - 1)
  const last = cut.charCodeAt(cut.length - 1)
  // 若切在代理对中间（高代理结尾），再退一个字符，避免渲染成乱码
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut + '\u2026'
}

/**
 * 从事件集合聚合用户画像。
 *
 * @param {Array<object>} events 事件数组（每个可能有 userPercept 数组）
 * @param {object} [opts]
 * @param {number} [opts.maxChars=600] 整段硬上限
 * @returns {{ text: string, counts: {preference:number, state:number, unfinished:number}, dropped: number }}
 *   text 为**严格空串**当三类全空（不返回空标题壳）；counts 供上层 state 挂载（H7 预算按类分配）。
 */
export function buildUserPortraitPre(events, opts = {}) {
  const maxChars = Number.isFinite(opts.maxChars) ? Math.max(40, Math.floor(opts.maxChars)) : PORTRAIT_MAX_CHARS
  const empty = { text: '', counts: { preference: 0, state: 0, unfinished: 0 }, dropped: 0, excludedByRules: 0 }
  const list = Array.isArray(events) ? events : []
  if (!list.length) return empty
  // ★★2026-10-26（审计 §2.2 + 用户裁定：硬约束留在「用户规约」，画像只留 emotional/情境化印象）：
  //   缺陷实测：同一条硬偏好（如「反对在 system prompt 注入长候选清单」「汇报恒分两条线」）
  //   **既在 [用户规约] 又在 [用户画像]** ⇒ 预算双耗 + 长期让模型把画像当规约（语义越界）。
  //   ⇒ 画像侧过滤：凡是**已在规约层出现**的偏好，不再重复进画像。
  //   ★为什么在画像侧滤而不是规约侧滤：用户裁定原话「肯定保留在用户规约里面」——
  //     规约是「每次完整版必须注入的硬约束」，一个字都不能少；画像才是可裁剪的印象摘要。
  //   ★判据用**规范化全文包含**（不是前 20 字，也不是严格相等）：
  //     规约条目常带前后缀（如「（实测：…）」括注），严格相等会漏；
  //     而「规约条目包含该偏好」或「该偏好包含规约条目」任一成立即视为重复。
  const rulesTexts = (Array.isArray(opts.excludeIfInRules) ? opts.excludeIfInRules : [])
    .map((t) => String(t == null ? '' : t).replace(/\s+/g, '').trim())
    .filter((t) => t.length >= 8)
  const _norm = (t) => String(t == null ? '' : t).replace(/\s+/g, '').trim()
  const _inRules = (text) => {
    if (!rulesTexts.length) return false
    const nText = _norm(text)
    if (nText.length < 8) return false
    for (const r of rulesTexts) {
      if (r.indexOf(nText) >= 0) return true
      if (nText.indexOf(r) >= 0) return true
      // 长条目用「前后 24 字」双端锚定，防中段被截断导致漏判
      if (nText.length >= 24 && r.length >= 24) {
        if (r.indexOf(nText.slice(0, 24)) >= 0 && r.indexOf(nText.slice(-24)) >= 0) return true
      }
    }
    return false
  }

  // ① 抽取：只收 stage ∈ {accepted, used} 的 userPercept
  const gathered = []
  let excludedByRules = 0
  for (const ev of list) {
    if (!ev || !Array.isArray(ev.userPercept)) continue
    for (const p of ev.userPercept) {
      if (!p) continue
      const stage = String(p.stage || '')
      // ★D2 修复：authorResponse 走 kind 旁路 —— 提示词让模型只填 kind 不填 stage，
      //   旧实现里 stage 空串必然被 stage 门 continue 掉，导致作者的回应永远进不了画像。
      const _bypass = PORTRAIT_KIND_BYPASS.indexOf(categoryOfPre(p.kind)) >= 0
      if (!_bypass && PORTRAIT_STAGES.indexOf(stage) < 0) continue
      const text = String(p.text == null ? '' : p.text).replace(/\s*\n+\s*/g, ' / ').trim()
      if (!text) continue
      // ★★2026-10-26：已在规约层的偏好不再进画像（详见函数头部注释）。
      if (_inRules(text)) { excludedByRules++; continue }
      gathered.push({ text, kind: p.kind, at: Number(p.at) || 0, stage })
    }
  }
  if (!gathered.length) return { ...empty, excludedByRules }

  // ② 去重：按 text 前 20 字（★Lead 断言 8）。保留**最新**那条（at 最大）。
  const byKey = new Map()
  let dropped = 0
  for (const g of gathered) {
    const key = g.text.slice(0, 20)
    const prev = byKey.get(key)
    if (prev) {
      dropped++
      if (g.at > prev.at) byKey.set(key, g)
    } else {
      byKey.set(key, g)
    }
  }

  // ③ 分类 + 按 at 降序（最近优先）+ 每类限额
  // ★buckets / counts / total 三处必须与 CATEGORY_TITLES **同步增删** —— 只加 TITLES 会「抽出但渲染不出来」。
  //   守卫：smoke-test-task33 的 T33-9（遍历式，不是列举式）。
  const buckets = { preference: [], state: [], unfinished: [], authorResponse: [] }
  for (const g of byKey.values()) buckets[categoryOfPre(g.kind)].push(g)
  for (const k of Object.keys(buckets)) {
    buckets[k].sort((a, b) => b.at - a.at)
    const cap = PORTRAIT_LIMITS[k] || 3
    if (buckets[k].length > cap) {
      dropped += buckets[k].length - cap
      buckets[k] = buckets[k].slice(0, cap)
    }
  }

  // ★保留旧三个键（H5 的 B4/C4/B5 断言逐字依赖），**新增** authorResponse 键（新增不是替换）。
  const counts = {
    preference: buckets.preference.length,
    state: buckets.state.length,
    unfinished: buckets.unfinished.length,
    authorResponse: buckets.authorResponse.length,
  }
  // ★必须同步加，否则配额判断漏算第四类。
  const total = counts.preference + counts.state + counts.unfinished + counts.authorResponse
  if (!total) return empty

  // ④ 输出（≤600 硬上限）。★注意：标题行本身也计入预算，逐行增量判，超了截断并加省略号。
  //    §7.4 格式：
  //      [用户画像 — 这是谁（跨事件聚合）]
  //      · 偏好：<最多 5 条>
  //      · 当前状态：<最多 3 条>
  //      · 未完成目标：<最多 3 条>
  const header = '[用户画像 \u2014 这是谁（跨事件聚合）]'
  const out = [header]
  const overhead = (s) => s.length + 1
  let used = overhead(header)
  let truncated = false
  for (const [key, title] of CATEGORY_TITLES) {
    const arr = buckets[key]
    if (!arr.length) continue
    const headLine = '\u00b7 ' + title + '\uff1a'
    if (used + overhead(headLine) > maxChars) { truncated = true; break }
    out.push(headLine)
    used += overhead(headLine)
    for (const item of arr) {
      const room = maxChars - used - 4 // '  - ' 开销
      if (room <= 2) { truncated = true; break }
      const body = cutSafePre(item.text, room)
      const line = '  - ' + body
      out.push(line)
      used += overhead(line)
      if (body !== item.text) truncated = true
    }
    if (truncated && used >= maxChars) break
  }
  let text = out.join('\n')
  if (text.length > maxChars) { text = cutSafePre(text, maxChars); truncated = true }
  // ★★2026-10-26：excludedByRules 必须**两条返回路径都带**（早返回已带，这里漏了 ⇒ 真缺陷，由新套件 A-3 抓出）
  return { text, counts, dropped, truncated, excludedByRules }
}

export default { buildUserPortraitPre, PORTRAIT_MAX_CHARS, PORTRAIT_LIMITS, PORTRAIT_STAGES }