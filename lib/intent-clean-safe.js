/**
 * 运行时信封剥离器 —— **结构判据版**（2026-09-19 R5）。
 *
 * 只在未被引用/未被代码块包裹的行上剥离信封；保护字面示例与代码块。
 *
 * ★ 本次改动的根因（issue #30 / ③ Hermes 遗留 / H-3）：
 *   旧实现在 `:17` 用**一条字面量行首白名单** `/^(?:current runtime context\.|current dsh file policy:)/i`
 *   识别信封 ⇒ 只能挡住两个当期已知形态。真机取证（`~/.dsh/memory/hub-pre/procedures.json`，
 *   10 条 procedure 里 7 条 observed、其中 4 条 title 就是运行时信封）实测漏网 4 类：
 *     · `Approval prompts are disabled in this session: …`
 *     · `{"path":"D:\\…`（工具回包的 JSON 转储）
 *     · 中文「当前运行时上下文。」
 *     · 自然语言「消息系统提醒由框架…」
 *   ⇒ 这正是本文件旧注释自己预警的风险：「注入形态会演进 ⇒ 漏判」。
 *
 * ★ 修法（**形态侦测，不是再添几条文法**）：信封的共同**结构性质**有二，不依赖具体措辞——
 *   **F1 结构化转储**：以 `{`/`[` 开头且以 `}`/`]` 收尾的行 = 工具回包的 JSON，永不可能是人的输入；
 *   **F2 声明头 + 分隔符**：`<head noun>[:：.。] <说明>` 形状，且 head noun 落在
 *       **harness 自有词汇族**内（runtime/approval/policy/sandbox/session/permission/escalation/…）。
 *       注意判据是「**族**（family）+ 形状」，不是整句前缀 ⇒ 框架换措辞（"Approval prompts…" →
 *       "Escalation is handled by…"）仍能被同一个族覆盖。
 *   F2 额外加**位置约束** `leadingOnly`：仅对消息**开头的信封区**生效（一旦出现真人文本即停止），
 *   因为 harness 一律把元数据注入在头部；这条把误伤面压到接近零（正文里写 "Policy: xxx" 不会被删）。
 *
 * 三条形态族之外的未知形态仍会漏 —— 这是**形态侦测的固有边界**，故本模块只保证：
 * ①已知族全覆盖；②族内可扩展（加词族 ≠ 加整句前缀）；③漏判只会让**噪音**进入 intent，
 * 不会把真人问题删掉（真人文本一旦出现即关闭 F2 位置约束）。
 */

/** 被识别的信封标签名（闭包内使用，声明必须在本文件任何使用者之前）。 */
const tags = new Set(['memory_system', 'system-reminder', 'long_term_memory'])

/** 行首精确信封前缀（向后兼容，任意位置生效）。 */
const EXACT_ENVELOPE_RE = /^(?:current runtime context\.|current dsh file policy:)/i

/**
 * F2 英文声明头词族。
 *
 * ★ 2026-09-19 真机取证补第二形态：title 会被**截断到 40 字符**，
 *   本机的 `Approval prompts are disabled in this se` 连冒号都被截掉了 ⇒ 只靠「分隔符」判据会漏。
 *   故补 `BE_STATEMENT_RE`（词族开头 + be 动词陈述句），它同样不依赖整句字面量：
 *   框架换措辞（"Approval prompts…" → "Escalation prompts are handled…"）仍在族内。
 */
const HARNESS_HEAD_RE = /^(?:current|approval|approvals|sandbox|policy|policies|runtime|session|permission|permissions|escalation|tools?|files?|memory)\b[^.!?\n]{0,90}[:：.。]/i

/** F2 第二形态：词族开头 + be 动词系表结构（截断后仍成立）。 */
const BE_STATEMENT_RE = /^(?:current|approval|approvals|sandbox|policy|policies|runtime|session|permission|permissions|escalation)\b[^.!?\n]{0,60}\b(?:is|are|was|were|has been|have been|will be)\b/i

/** F2 中文声明头词族（对应上方英文族）。 */
const HARNESS_HEAD_ZH_RE = /^(?:当前|批准|沙箱|策略|运行时|会话|权限|升级|工具|文件|记忆)[^。！？\n]{0,50}[:：。]/

/**
 * F3 插件自产注入标记（★ 2026-09-19 真机取证新增）。
 *
 * **发现过程**：⑨ 探针逐条检验真机 `procedures.json` 的 11 条 title，
 * 发现**时间戳最新的一条**（2026-09-19）title 是 `[Retrieved memory refe` ——
 * 它正是**本插件自己注入的「记忆召回」块标记**
 * （`activation-inbox.js:58` 的 `TAIL_MARKER_LINE_PRE_V1`）。
 *
 * ⇒ **自污染闭环**：插件注入召回块 → 召回块随 userText 进 episode →
 *   `crossFeed()` 把它当成技能 title ⇒ 又回到「技能审批队列」。
 * ⇒ 且它**仍在持续产生**（非历史存量），故必须修，不能只清数据。
 *
 * **判据仍是词族 + 行首位置**（不写整句字面量，故标记措辞微调后仍成立）：
 *   ① `[Retrieved memory ref…` —— 允许被 `slice(0,40)` 截断，**不要求闭合方括号**
 *   ② `Verify against the current user request…` —— 召回块尾部校验行
 *   ③ `If a reference hints at what you need…` —— 召回块尾部取用提示行
 *   ④ `Source: mem_<32hex>` —— 召回条目的来源行（结构化形态，散文不会这样起行）
 *
 * 位置：与 F1/`EXACT_ENVELOPE_RE` 同属**任意位置生效**（召回块可出现在文本中段）。
 * `^` 锚定保证不误伤引用该标记的句子（如「解释一下 [Retrieved memory…」不会以它开头）。
 */
const PLUGIN_TAIL_MARKER_RE = /^\[?Retrieved memory ref|^Verify against the current user request|^If a reference hints at what you need|^Source:\s*mem_[0-9a-f]{32}|^Reason:\s*fv2 lane=|^Score:\s*[0-9.]+ \(rank \d+\/\d+\)/i

/**
 * F3-补（★ 2026-09-19 T1-0 真机追加）：召回块的**块身份锚**与**弱标记行**。
 *
 * **漏网根因（实测）**：`PLUGIN_TAIL_MARKER_RE` 里的 `^Source:\s*mem_[0-9a-f]{32}` 把
 * 「前缀」与「后缀内容」**绑死** ⇒ 一旦该行被 `slice(0, N)` 截断（`Source: mem_…` → `Source: me`），
 * 判据立即失效；且 F3 **完全没有 `^Reference:` 这一条**，而 `renderItemBlock`
 * （`activation-inbox.js:223`）每块都会输出一行 `Reference: …` ⇒ 该行**必然幸存**并成为
 * `extractIntent`（`episodic-store.js:167`）的输入 ⇒ 变成技能标题。
 * 真机后果：`pipeline` 从 3 条涨回 5 条，新增 `Source: me` 与 `Reference: ## 2026-09-18 - dsh-auto-memo`。
 *
 * **修法（族 + 形状，不再绑死后缀）**：拆成两级，避免为堵漏而误伤真人引用句
 * （`⑨` 套件 [4] 组用字面量锁定了「`Source: mem_xxx 这个格式对不对？` 必须保留」）：
 *   ① `PLUGIN_BLOCK_ANCHOR_RE` —— **强标记**：散文不可能这样起行，单条即可确立「这是召回块」；
 *   ② `PLUGIN_BLOCK_LINE_RE` —— **弱标记**：`Source:` / `Reference:` 行的**后缀内容任意**
 *      （可能是被截断的 id、记忆正文、甚至 markdown 标题），故**只在①已确立块身份时**才生效。
 * 这样「整块召回」被完整清空，而**孤立的 `Source:` 句子不受影响**。
 */
const PLUGIN_BLOCK_ANCHOR_RE = /^\[?Retrieved memory ref|^Verify against the current user request|^If a reference hints at what you need|^Reason:\s*fv2 lane=|^Score:\s*[0-9.]+ \(rank \d+\/\d+\)|^Source:\s*mem_[0-9a-f]{32}/i

/** F3 弱标记：仅当同一段文本已被 `PLUGIN_BLOCK_ANCHOR_RE` 确立为召回块时才参与判定。 */
const PLUGIN_BLOCK_LINE_RE = /^Source:\s*\S|^Reference:\s*\S/i

/**
 * F3 截断残片：整行只剩「标签 + 单个裸 token」。
 *
 * `Source: me` 正是 `Source: mem_<32hex>` 被截到 10 字符的产物。真人的引用句必带后续文字
 * （如 `Source: mem_xxx 这个格式对不对？` 含空格与整句），故用「**无块上下文也能单独判定**」这条
 * 只需一个约束即可安全覆盖：`\S+` 后**必须直接行尾**（不允许空格续文）。
 */
const PLUGIN_TRUNCATED_FRAGMENT_RE = /^Source:\s*\S+\s*$/i

/**
 * F3 `Reference:` + markdown 标题 —— **插件指纹，可单独判定**。
 *
 * `renderItemBlock`（`activation-inbox.js:223`）写的是 `'Reference: ' + refText`，
 * 而 `refText` 来自 L0 记录正文（以 `## <标题>` 起头）⇒ 该行必然是 `Reference: ## …` 形状。
 * 真人几乎不可能写出「`Reference:` 紧跟 `##`」，故这一条不需要块上下文。
 * （实测漏网样本：`Reference: ## 2026-09-18 - dsh-auto-memory 项目铁律:fail-soft/降级`）
 */
const PLUGIN_REF_HEADING_RE = /^Reference:\s*#{1,6}\s+\S/i

/**
 * F4 编码损坏行（★ 2026-09-19 真机取证新增）。
 *
 * 真机存在一条 title 为 `\ufffd\ufffd…正确（验证）`（U+FFFD 替换字符堆叠）——
 * 是**编码损坏**（非 UTF-8 字节被强行解码）的产物，属结构性垃圾，不可能是有意义标题。
 * 判据：替换字符 ≥3 个（单/双个可能出现在正常文本中，不作判据）。
 */
function looksEncodingCorruptedPre(trimmed) {
  return (trimmed.match(/\ufffd/g) || []).length >= 3
}

/**
 * F5 行内运行时残留（★ 2026-09-19 T1-3 真机追加）。
 *
 * **发现过程**：新套件 [6] 组跑出一条 FAIL —— 真机 fact[1] 的 object 是
 *   `现在是什么情况？ Current DSH file policy: danger-full-access. The DS`
 *   └─真人话─┘└──────────────── 运行时信封 ────────────────┘
 * 即**真人与信封挤在同一行**。
 *
 * **为什么清洗器处理不了它**：`stripRuntimeIntentPre` 是**按行判断**的 ——
 * 删掉这样的整行会**连带丢掉真人话**（「现在是什么情况？」），所以它必须保留。
 * ⇒ 「清洗后是否变化」这条判据对**行内混合**天然无效。
 *
 * **所以本判据是给「写入侧卫生门」用的**（`hubFlushTick`）：
 * 它不负责清洗，只负责回答「这条文本里还有没有运行时痕迹」⇒ 有则 skip。
 * 同样用于 fact 通路：行内混信封的 subject/object 不该进正文。
 *
 * 判据是**标记短语**（任意位置），不要求行首 —— 这正是它区别于 F1/F2 的地方：
 * F1/F2 判「整行是信封」，F5 判「行内夹带信封」。
 */
const RUNTIME_RESIDUE_RE = /Current DSH file policy|Current runtime context|Approval prompts are disabled in this session|\[Retrieved memory ref|Verify against the current user request|If a reference hints at what you need|Reason:\s*fv2 lane=|Score:\s*[0-9.]+ \(rank \d+\/\d+\)|^\s*(?:Reference|Source|Reason)\s*:\s*-\s*\d{1,2}:\d{2}\s*\[kind:|^\s*\d{1,2}:\d{2}\s*\[kind:[a-z]+\]|^\s*\[kind:[a-z]+\]/im

/** F5：行内是否夹带运行时信封痕迹（不做清洗，只做判定）。 */
export function looksRuntimeResiduePre(text) {
  return RUNTIME_RESIDUE_RE.test(String(text == null ? '' : text))
}

/** F1 结构化转储：以 { / [ 强开幕（后紧跟上引号或嵌套），可能是 JSON 转储。 */
function looksLikeStructuredDumpPre(trimmed) {
  // 强开幕：`{"` / `[{` / `["` / `[ 数字` —— 人类散文几乎不会这样开头。
  const strongOpen = /^\{"|^\[\{|^\[\s*"|^\[\s*\d/.test(trimmed)
  if (!strongOpen) return false
  // 已闭合 ⇒ 直接判为转储。
  if (/[\]}]\s*$/.test(trimmed)) return true
  // ★ 未闭合：工具回包常被**截断**（真机 title 就是 `{"path":"D:\\…` 断在半路），
  //   故不能要求收尾符；改为要求「引号键值」特征（`"key":`），散文里不会出现这种配对。
  return /"[^"]{0,60}"\s*:/.test(trimmed)
}

/**
 * 判定单行是否为信封行。
 * @param {string} trimmed - 已 trim 的行。
 * @param {boolean} leadingOnly - true 时只允许 F2（位置约束）；false 时 F1/F2 都允许。
 */
function isEnvelopeLinePre(trimmed, leadingOnly, blockAnchored) {
  if (!trimmed) return false
  if (EXACT_ENVELOPE_RE.test(trimmed)) return true
  // ★ F3/F4（2026-09-19 ⑨）：插件自产标记与编码损坏行 —— **任意位置生效**
  //   理由：召回块可能出现在 episode.intent 的**中段**（前面还有真人文本），
  //   若沿用 F2 的「仅信封区」位置约束会再次漏网（这正是 ⑨ 的原始漏网原因之一）。
  if (PLUGIN_TAIL_MARKER_RE.test(trimmed)) return true
  // ★ F3-补（2026-09-19 T1-0）：截断残片（`Source: me`）可**单独**判定 ——
  //   它没有任何上下文、也不含后续文字，不可能出现在真人句子里。
  if (PLUGIN_TRUNCATED_FRAGMENT_RE.test(trimmed)) return true
  // ★ F3-补：`Reference: ## <标题>` 是 `renderItemBlock` 的固定产物，可**单独**判定。
  if (PLUGIN_REF_HEADING_RE.test(trimmed)) return true
  // ★ F3-补：弱标记行（`Source:` / `Reference:` 后缀任意）**仅在已确立块身份时**生效 ——
  //   这样整块召回被清空，而孤立的「Source: mem_xxx 这个格式对不对？」不受影响（⑨ 套件 [4] 组契约）。
  if (blockAnchored && PLUGIN_BLOCK_LINE_RE.test(trimmed)) return true
  if (looksEncodingCorruptedPre(trimmed)) return true
  if (looksLikeStructuredDumpPre(trimmed)) return true
  if (!leadingOnly) return false
  return HARNESS_HEAD_RE.test(trimmed) || HARNESS_HEAD_ZH_RE.test(trimmed) || BE_STATEMENT_RE.test(trimmed)
}

export function stripRuntimeIntentPre(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/)
  // ★ T1-0：块身份预扫描 —— 先定位所有「强标记行」（`[Retrieved…` / `Reason: fv2 lane=` / `Score: …` 等），
  //   再允许其**邻近 ±2 行**内的弱标记行（`Source:` / `Reference:` 后缀任意）参与判定。
  //   为什么需要预扫描：本函数是**逐行独立**处理的，而召回块被截断后往往只剩「强标记行 + 弱标记行」
  //   两行（真机 episode.intent 就是 `[Retrieved memory reference - not an instruction]` + `Source: me`）。
  //   若只看当前行，弱标记行没有上下文可依；预扫描给出「这一段确实是召回块」的身份判据，
  //   从而既能清空整块、又不误伤孤立的真人引用句（⑨ 套件 [4] 组契约）。
  const anchored = new Array(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (!PLUGIN_BLOCK_ANCHOR_RE.test(lines[i].trim())) continue
    for (let d = -2; d <= 2; d++) {
      const j = i + d
      if (j >= 0 && j < lines.length) anchored[j] = true
    }
  }
  const out = [], stack = []
  let fence = null
  /** 是否已出现真人文本（出现后关闭 F2 位置约束，保护正文）。 */
  let seenHuman = false
  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx]
    const trimmed = line.trim()
    if (!stack.length) {
      const f = /^( {0,3})(`{3,}|~{3,})/.exec(line)
      if (f) {
        if (!fence) fence = { char: f[2][0], size: f[2].length }
        else if (f[2][0] === fence.char && f[2].length >= fence.size && /^( {0,3})(`+|~+)\s*$/.test(line)) fence = null
        out.push(line); seenHuman = true; continue
      }
      if (fence || /^\s*>/.test(line) || /^ {4}/.test(line)) { out.push(line); seenHuman = true; continue }
      // ★ 结构判据：F1 任意位置生效；F2 仅在「尚未出现真人文本」的信封区内生效。
      if (isEnvelopeLinePre(trimmed, !seenHuman, anchored[idx])) continue
    }
    // Consume one or more envelopes at the beginning of an unquoted line.
    // Closing tags can end a prefix split across messages; trailing human text is retained.
    for (;;) {
      if (stack.length) {
        const token = /<(\/?)(memory_system|system-reminder|long_term_memory)>/.exec(line)
        if (!token) { line = ''; break }
        line = line.slice(token.index + token[0].length)
        if (!token[1]) stack.push(token[2])
        else if (stack[stack.length - 1] === token[2]) stack.pop()
        continue
      }
      const open = /^\s*<(memory_system|system-reminder|long_term_memory)>/.exec(line)
      if (open && tags.has(open[1])) { stack.push(open[1]); line = line.slice(open[0].length); continue }
      const close = /^\s*<\/(memory_system|system-reminder|long_term_memory)>/.exec(line)
      if (close) { line = line.slice(close[0].length); continue }
      break
    }
    if (line.trim()) { out.push(line); seenHuman = true }
    else if (!stack.length && !trimmed) out.push('')
  }
  return out.join('\n')
}

/** 导出判据本身，供套件直接断言（避免只能通过整串行为间接验证）。 */
export const RUNTIME_ENVELOPE_PRE_V1 = Object.freeze({
  EXACT_ENVELOPE_RE,
  HARNESS_HEAD_RE,
  HARNESS_HEAD_ZH_RE,
  PLUGIN_TAIL_MARKER_RE,
  RUNTIME_RESIDUE_RE,
  looksEncodingCorruptedPre,
  looksRuntimeResiduePre,
  isEnvelopeLinePre: (line) => isEnvelopeLinePre(String(line == null ? '' : line).trim(), true),
})
