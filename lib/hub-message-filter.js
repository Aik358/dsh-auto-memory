/**
 * 记忆中枢「子代理回报消息」过滤器（2026-10-28）。
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 【用户实测症状】
 *   记忆中枢（工作台）会话里收到一条本不该出现的消息，并**触发了下一轮回复**：
 *     Agent ca9dcea7-... sent a message: [TOPIC] 情境化记忆四项修复…
 *
 * 【根因（asar 二进制取证，非推测）】
 *   这不是子代理主动调 send_message，而是 **DSH 宿主自动构造**的消息：
 *     @deepseek-ai/dsh-subagent/continuation-messages
 *       function agentMessageSource(sender) {
 *         return { kind: 'agent-message', form: 'relay', senderSessionId: sender.id }
 *       }
 *       export function createAgentMessage(sender, content) {
 *         return createUserMessage({
 *           content: [ { type: 'text', text: 'Agent ' + sender.id + ' sent a message: ' }, ...content ],
 *           source: agentMessageSource(sender),
 *         })
 *       }
 *   宿主文档原文：「每条消息都以 Agent <sender-id> sent a message: 作为前缀，
 *     并记录 { kind: 'agent-message', form: 'relay', senderSessionId: sender.id }」
 *   ⇒ 这是**多 Agent 协作的通用机制**，本身不是 bug。任何 Team / subagent 场景都会产生。
 *   ⇒ 但对「记忆中枢」这种**挂机自跑、无人对话**的会话，它是纯噪音：
 *       - 会打断挂机节奏（消息进上下文 ⇒ 触发新的一轮回复）
 *       - 内容本身就是子代理产出，真正有价值的已由 consolidate 写进记忆
 *
 * 【为什么之前那版 prompt 护栏无效】
 *   我一度以为是子代理「自己决定」调 send_message，于是在 _runSubagentOnce 前置了
 *   「禁止调用任何工具」的 prompt 护栏。**方向错误**：消息由宿主在子代理状态变动时
 *   自动构造并投递，**不经过子代理的模型决策**，prompt 怎么写都拦不住。
 *   用户当场纠正：「它是自动检测的。检测到子代理有状态变动，就会自动向这个主窗口发送一条信息」。
 *
 * 【用户裁定（2026-10-28，逐字）】
 *   「这个得想想怎么处理，比如在记忆中枢的工作区，就仅仅在这里拦截掉这个自动回报
 *     不要动别的，就不要影响别的工作区的正常逻辑行为」
 *   ⇒ **只拦记忆中枢，其他工作区零影响。**
 *
 * 【设计三要点（用户逐条确认）】
 *   ① 双条件判定：记忆中枢 cwd AND source.kind === 'agent-message'
 *   ② 处理方式：从本请求批次里移除 + 记一行 diag（便于以后排查频率）
 *   ③ 工作区判定用 **cwd**（session.cwd === _workbenchCwd()）：sessionId 随工作台换期而变，cwd 稳定
 *
 * 【为什么不用 senderSessionId 做第三条件】
 *   _ownSubagents 是 WeakSet<agent>，存 agent 对象不是 sessionId ⇒ 反查要额外建 map；
 *   而记忆中枢本来就不该有人跟它对话，所有 agent-message 都是噪音 ⇒ 双条件已足够且更彻底。
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** 宿主 agent-message 的 source.kind 字面量（asar 取证，勿改）。 */
export const AGENT_MESSAGE_KIND_PRE = 'agent-message'

/**
 * 宿主「后台子代理结束通知」的 source.kind 字面量（asar 取证，勿改）。
 *
 * ★2026-10-31 补入：用户原话「比如 memory consolidate 等操作结束之后，记忆中枢还会自动
 *   接收到一条变化的信息」——**这句描述的正是这个字面量**，不是 agent-message。
 *   取证（@deepseek-ai/dsh-subagent `createSettlementMessage`）：
 *     source = { kind:'subagent-settled', form:'notice',
 *                summary:'Background subagent <id> finished and will do no further work…',
 *                senderSessionId: childId }
 *   正文两段：`Background subagent … finished…` + `Its closing message:` + 子代理收尾全文。
 *   它同样是**宿主自动构造**、不经过任何模型决策的投递 ⇒ prompt 护栏同样无效。
 *   隔离环境实测（tests/smoke/smoke-test-hub-reject-e2e.mjs）：只拦 agent-message 时，
 *   该字面量仍会开出新的一轮 ⇒ 中枢照样被唤醒。两者必须同一处判据一起拦。
 */
export const SUBAGENT_SETTLED_KIND_PRE = 'subagent-settled'

/**
 * 记忆中枢里需要被拦下的「宿主自动回报」kind 全集（唯一来源）。
 * 新增 kind 只改这里 —— 遵守仓库「同一语义只许一处判据」纪律。
 */
export const HUB_NOISE_KINDS_PRE = Object.freeze([AGENT_MESSAGE_KIND_PRE, SUBAGENT_SETTLED_KIND_PRE])

/**
 * 判断一条消息是否为「子代理/相邻 Agent 的自动回报」。
 *
 * 判据只用宿主写入的 source.kind，**不看正文前缀**：
 *   正文前缀可能被模型或工具改写，而 source 是宿主在 createAgentMessage 里
 *   驱动的结构化字段，不可伪造。
 *
 * @param {unknown} msg 一条待投递消息
 * @returns {boolean} true = 是 agent-message 自动回报
 */
export function isAgentMessagePre(msg) {
  try {
    const src = msg && msg.source
    if (!src) return false
    // 兼容两种形状：source 为对象（正常）/ 为字符串 kind（旧宿主兜底）
    const kind = typeof src === 'string' ? src : String(src.kind || '')
    return kind === AGENT_MESSAGE_KIND_PRE
  } catch (_) {
    return false
  }
}

/**
 * 判断一条消息是否为「记忆中枢里应当被丢弃的宿主自动回报」（agent-message ∪ subagent-settled）。
 *
 * ★★这是拦截判定应使用的**唯一入口**。只用 isAgentMessagePre 会漏掉
 *   subagent-settled —— 那正是用户报的「操作结束之后收到变化信息」。
 *
 * @param {unknown} msg 一条待投递消息
 * @returns {boolean}
 */
export function isHubNoiseMessagePre(msg) {
  try {
    const src = msg && msg.source
    if (!src) return false
    const kind = typeof src === 'string' ? src : String(src.kind || '')
    return HUB_NOISE_KINDS_PRE.indexOf(kind) >= 0
  } catch (_) {
    return false
  }
}

/**
 * 判断当前会话是否「记忆中枢（工作台）会话」。
 *
 * @param {object} p
 * @param {string} p.sessionCwd   当前 agent 的 session.header.cwd
 * @param {string} p.workbenchCwd 记忆中枢工作区路径（_workbenchCwd()）
 * @param {(s:string)=>string} p.pathKey 路径归一函数（_pathKey，需处理 realpath/大小写差异）
 * @returns {boolean}
 */
export function isHubSessionPre(p) {
  try {
    const o = p || {}
    const cwd = String(o.sessionCwd || '').trim()
    const want = String(o.workbenchCwd || '').trim()
    if (!cwd || !want) return false
    const key = typeof o.pathKey === 'function' ? o.pathKey : ((x) => String(x || '').toLowerCase())
    return key(cwd) === key(want)
  } catch (_) {
    return false
  }
}

/**
 * ★主入口：在记忆中枢会话里剔除 agent-message 自动回报。
 *
 * **原地修改** messages 数组（splice 回写），因为宿主 hook 的 next() 不接受参数，
 * 无法「返回替换后的批次」；只能保证传给下一个监听器/组装逻辑的是同一个数组对象。
 *
 * 安全纪律：
 *   · 非记忆中枢 ⇒ **原样返回、零副作用**（用户硬要求「不要影响别的工作区」）
 *   · 空数组 / 非数组 ⇒ 原样返回
 *   · 全部消息都被剔除 ⇒ removed>0 但 kept=0，调用方**仍必须 next()**
 *     （不能让宿主开一个没有消息的 step）
 *
 * @returns {{ok:boolean, removed:number, kept:number, reason?:string}}
 */
export function filterHubAgentMessagesPre(p) {
  try {
    const o = p || {}
    const messages = o.messages
    if (!Array.isArray(messages) || !messages.length) return { ok: true, removed: 0, kept: Array.isArray(messages) ? messages.length : 0, reason: 'empty' }
    // ① 非记忆中枢：**直接放行，一个字节都不碰**
    if (!isHubSessionPre(o)) return { ok: true, removed: 0, kept: messages.length, reason: 'not-hub' }
    // ② 记忆中枢：原地剔除宿主自动回报（agent-message ∪ subagent-settled）
    let removed = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isHubNoiseMessagePre(messages[i])) { messages.splice(i, 1); removed++ }
    }
    return { ok: true, removed, kept: messages.length, reason: removed ? 'filtered' : 'no-agent-message' }
  } catch (e) {
    // 过滤器异常 ⇒ 放行（宁可漏拦，不可卡死宿主会话）
    return { ok: false, removed: 0, kept: 0, reason: 'error:' + String((e && e.message) || e).slice(0, 80) }
  }
}
