/**
 * 后台子代理 prompt 统一护栏（2026-10-28）。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 【缺陷实证】用户实测收到一条不该出现的消息：
 *   "Agent ca9dcea7-f3ff-45b2-b9cc-8bfbc09a5072 sent a message: [TOPIC] 情境化记忆四项修复…"
 *
 *   → 这是 **auto-memory-consolidate 子代理**的产出格式（lib/index.js 的 consolidate prompt
 *     要求输出 [TOPIC]/[LOG]/[NOTE]/[USER] 四段）。
 *   → 它本该**只作为最终回复文本返回**，被 parse 成要点写进日志/笔记。
 *   → 但子代理是**完整 agent**（_runSubagentOnce 里 run.localAgent 是真实 agent 对象，
 *     继承父会话工具面）⇒ 它**顺手调用了 send_message**，把整段结构化结果投给了父会话。
 *   → 用户的记忆中枢因此收到一条本不该出现的通知，并**触发了下一轮回复**。
 *
 * 【根因】所有 auto-memory-* prompt 都只约束「输出格式」，没有一句约束「行为」。
 *   实测 7 个 prompt（consolidate / consolidate-logs / distill / fold / greet /
 *   summarize / smart-kw / smart-ans / ws-map）里，「不要调用任何工具」出现 **0 次**。
 *   「只输出」≠「不许用工具」：对模型来说「按格式输出」和「按格式发给谁」是两件事。
 *
 * 【为什么放在这里而不是逐处改 prompt】
 *   用户规约：「同一语义若在多个函数里各写一份判据，改动必须一次改全；只改部分会进入
 *   半修状态」。11 个调用点分散在 lib/index.js 各处，逐处加约束必然改漏。
 *   本模块提供**唯一收口**：_runSubagentOnce 发 prompt 前统一前置这段护栏。
 *
 * 【设计取舍】只做提示词层，不做运行时硬拦 —— 用户 2026-10-28 裁定：
 *   「从提示词上出手就可以，我觉得现在模型的指令遵循不会很差」。
 *   ⇒ 本模块是**纯文本生成**，无状态、无副作用、可独立单测（零 import）。
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** 护栏首行标记（测试与诊断据此定位，勿改字面量）。 */
export const SUBAGENT_GUARD_MARK = '【后台子代理行为约束 · 必须遵守】'

/**
 * 生成要前置到后台子代理 prompt 前的护栏文本。
 *
 * ★措辞纪律（逐条对应一个实证泄漏路径）：
 *   ① 身份声明 —— 模型不知道自己是子代理，会按「助理该主动汇报」的默认行为行事
 *   ② 禁止 send_message —— 本次事故的直接路径
 *   ③ 不调无关工具 —— 防止写盘/读文件/再派子代理（子代理套娃）；但放开 memory_*（见下方修正）
 *   ④ 明确「唯一交付方式」—— 只给禁止不给正解，模型仍会找出口
 *   ⑤ 明确「父代理会自己解析」—— 消除「不发出去父代理收不到」的误解
 *
 * ★★2026-10-28 修正（用户裁定，逐字）：「这个写得有点太严了，有些 consolidate 是需要写进
 *   memory 记录的 然后我发现你的 prompt 确实没用，它是自动检测的。」
 *   ① **放开 memory_***：consolidate 类子代理本该能写记忆，一刀切禁掉会砍掉正常业务能力。
 *   ② **诚实记录**：本护栏**拦不住宿主自动回报** —— 那条消息由宿主 createAgentMessage()
 *      在子代理状态变动时构造（见 lib/hub-message-filter.js 头部取证），不经过子代理决策，
 *      prompt 怎么写都无效。真正的拦截在 hub-message-filter.js（记忆中枢 pre-step 过滤）。
 *      本护栏剩下的价值只有一条：防子代理**额外主动**调 send_message。
 *
 * @param {string} label 子代理标签（如 'auto-memory-consolidate'），写进身份行便于排查
 * @returns {string} 以换行结尾的护栏文本（空 label 时用通用称呼）
 */
export function buildSubagentGuardPre(label) {
  const tag = String(label == null ? '' : label).trim() || 'auto-memory-task'
  return [
    SUBAGENT_GUARD_MARK,
    '你是 <label>' + tag + '</label> 标记的后台子代理(不是与用户对话的助理)。',
    '· **不要主动向用户/其他会话发送消息**: 你的回复由父代理读取, 不要用 send_message 转述给用户。',
    '· **不要调用与你任务无关的工具**(read/write/bash 等外部副作用工具); 但**允许并鼓励**用 memory_* 完成写记忆等本职操作。',
    '· **唯一的交付方式**: 把结果直接写在你的最终回复正文里, 由父代理解析。',
    '· 父代理会自行读取并处理你的最终回复 —— 不发 send_message 也不会丢结果。',
    '',
  ].join('\n')
}

/**
 * 把护栏前置到既有 prompt。纯函数、幂等（已含标记则不重复前置）。
 *
 * @param {string} prompt 原始 prompt
 * @param {string} label  子代理标签
 * @returns {string} 加了护栏的 prompt
 */
export function withSubagentGuardPre(prompt, label) {
  const body = String(prompt == null ? '' : prompt)
  // 幂等：调用方若已自行加了护栏（或测试注入了带护栏的 prompt），不重复堆叠
  if (body.indexOf(SUBAGENT_GUARD_MARK) >= 0) return body
  return buildSubagentGuardPre(label) + body
}
