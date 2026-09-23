/**
 * M8 采集侧 intent 清洗(2026-08-30 P1,docs/HANDOFF-M8-M9-M10.md §2 P1)。
 *
 * 背景:episode 的 intent 来自 consolidateTurn 取到的「本轮最后一条 user 文本」,而该文本
 * 在真实运行时常被三种形态污染(已实录于 ~/.dsh/memory/hub-pre/episodes.json):
 *   ① harness 注入的上下文快照 —— 以 "Current runtime context. This snapshot supersedes…" 开头
 *   ② 工具回包 —— role 也是 user,但 eventType='tool/result',正文是 JSON 转储
 *   ③ 行号引用文本 —— 同属工具回包("436: ## 2026-08-25\n437: …")
 *
 * 三层修复原本内联在 lib/index.js consolidateTurn 的 for 循环里,只能靠「用户自然对话两轮」
 * 实机验证,无法回归锁定。抽出为纯函数后,上述真实形态全部变成可重复执行的断言。
 *
 * 抽取时发现并修掉的实质缺陷(2026-08-30):
 *   原第 2 层「正文含 <memory_system> 就整条跳过」会抢在第 3 层之前生效,于是第 3 层的
 *   快照剥离**永远轮不到**——真人问题一旦与注入快照拼在同一条消息里,整条被丢,intent
 *   只能退化成上一轮的旧问题。现改为「先剥离块,再看剩下什么」:剥离后为空或只剩
 *   harness 前缀才判为合成消息,否则剩下的就是真人问题(严格优于原行为:原行为会丢问题,
 *   新行为只是把问题捞回来;纯快照消息两种行为都跳过)。
 *
 * 设计约束:
 *   - 纯函数、零 IO、零依赖;同输入同输出。
 *   - 只认 eventType='user/message' 的真人消息(messageOfEvent 只产出
 *     user/message | assistant/message | tool/result 三类)。
 * 命名空间:_pre 隔离。UTF-8 无 BOM。
 */

import { stripRuntimeIntentPre } from './intent-clean-safe.js'

/**
 * 剥离注入内容,返回剩余的真人文本。
 *
 * 2026-09-16(issue #30):改为复用 `stripRuntimeIntentPre` 的**行边界**剥离器。
 * 旧实现用两条正则(整块配对 + `^current runtime context.`)硬套,漏判面很宽:
 *   - 只认 `<memory_system>` 一种标签,新标签(如 `<system-reminder>`/`<long_term_memory>`)整条漏过;
 *   - 块被拆条时靠"取最后一个闭合标签之后"这一刀切,前真问题后快照的拼法会**丢掉真问题**;
 *   - 导语正则只匹配行首,前缀被拼到行中时不生效。
 * 新剥离器按行处理:仅在**未被引用/未被代码块包裹**的普通行上剥离信封标签,
 * 保留行内尾随的真人文(如 `<memory_system>…</memory_system> 我的问题` 只剩"我的问题"),
 * 并保证代码块/引用块里的字面示例不被误删。
 */
export function stripInjectedBlockPre(text) {
  return stripRuntimeIntentPre(text)
}

/** 合成注入消息识别:剥离注入内容后什么都不剩 → 整条都是注入。 */
export function isInjectedContextTextPre(text) {
  return !stripInjectedBlockPre(text).trim()
}

/**
 * 从会话消息序列挑选本轮沉淀用的 user/assistant 文本。
 * 第 1 层:只认 role=user && eventType='user/message'(滤掉工具回包);
 * 第 2 层:剥离注入块后,空或仅剩 runtime-context 前缀 → 判为合成消息并跳过;
 * 第 3 层:取**最后一条**真人消息(与原逻辑一致);assistant 取最后一条非空文本。
 */
export function pickConsolidationTextPre(messages) {
  let userText = ''
  let assistantText = ''
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'user' && m.eventType === 'user/message') {
      const rest = stripInjectedBlockPre(m.text).trim()
      if (!rest) continue
      userText = rest
    } else if (m.role === 'assistant' && m.text) {
      assistantText = String(m.text)
    }
  }
  return { userText, assistantText }
}
