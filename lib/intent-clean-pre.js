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

/** 完整的注入快照块(开闭标签配对)。 */
const SNAPSHOT_BLOCK_RE = /<memory_system>[\s\S]*?<\/memory_system>/g
/** harness 合成前缀(剥离块后若只剩这段,说明整条都是注入)。 */
const RUNTIME_CONTEXT_RE = /^current runtime context\./i

/**
 * 剥离注入内容,返回剩余的真人文本:
 *   (a) 完整的 <memory_system>…</memory_system> 块整体移除(可多块);
 *   (b) 只剩闭合标签(快照被拆条/半截注入)→ 取其后内容;
 *   (c) 其余原样。
 */
export function stripInjectedBlockPre(text) {
  let s = String(text == null ? '' : text)
  s = s.replace(SNAPSHOT_BLOCK_RE, '')
  const marker = '</memory_system>'
  const idx = s.lastIndexOf(marker)
  if (idx >= 0) s = s.slice(idx + marker.length)
  // harness 的 "Current runtime context. …" 导语是整行噪声,且可能出现在任一行
  // (快照在前真问题在后 / 真问题在前快照在后,两种拼法都要能剥干净)
  return s.split(/\r?\n/).filter((ln) => !RUNTIME_CONTEXT_RE.test(ln.trim())).join('\n')
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
