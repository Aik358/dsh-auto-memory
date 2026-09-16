/** 上下文窗口解析(2.2.4,2026-09-08)。
 *
 * 背景:水位 = 当前上下文占用 / 模型窗口。占用取官方 tokenMeter(与聊天框 context ring 同源),
 * 窗口此前有三条来源:手动覆盖 > 官方 request/context 的 contextWindow > settings.yaml 解析 > fallback。
 * 实测发现两条路同时失效,导致窗口恒为 fallback 131072(真实模型 1M),水位被算成 150%+:
 *   1) 官方 request/context 只在会话早期追加(本会话 2999 个事件里仅 2 条),而旧代码只扫最近 256 条 → 永远扫不到;
 *   2) settings.yaml 的 llm-deepseek 段是 flow 风格 YAML(`{ models: [ { id: x, contextWindow: 1000000, ... } ] }`),
 *      旧解析器只认 block 风格(`- id: x` + 行尾纯数字),整段解析不出来。
 *
 * 本模块把「settings.yaml → 模型窗口映射」与「按 provider/model 选窗口」抽成纯函数,便于 smoke 覆盖。
 */

/**
 * 从 settings.yaml 文本解析 `模型 id → contextWindow` 映射。
 * 同时支持 block 风格(llm-pi-ai 那种 `- id: x` / `contextWindow: N`)与 flow 风格(llm-deepseek 那种 `id: x,` / `contextWindow: N,`)。
 * @param {string} text - settings.yaml 原文。
 * @returns {{byRoute:Record<string,number>,byModel:Record<string,number>}} byRoute 键为 provider/id,byModel 键为 id。
 */
export function parseModelWindowsPre(text) {
  const byRoute = {}
  const byModel = {}
  if (!text || typeof text !== 'string') return { byRoute, byModel }
  const lines = String(text).split(/\r?\n/)
  let currentProvider = ''
  let currentId = null
  for (const line of lines) {
    // provider 段(block 风格,2 空格缩进的裸键,如 `opencode-go:`);flow 风格段名同样以冒号结尾但缩进更深
    const pm = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/)
    if (pm) { currentProvider = pm[1]; currentId = null; continue }
    // 模型 id:兼容 block(`- id: x`)与 flow(`id: x,`)两种写法,允许行尾逗号。
    // 2026-09-14 移植 PR #31(上游修复,作者 Minervaowl7):字符类须含 `/` ——
    // provider 前缀式 id(`deepseek/deepseek-v4.1-flash`、`z-ai/glm-5.3-flash`、`meituan/LongCat-2.0:free`)
    // 是常见形态;旧字符类不含斜杠 → 整条 id 行匹配失败,其 contextWindow 被**静默丢弃**,
    // 窗口退化为 fallback 131072。实测:真实窗口 1,000,000 的会话被按 131,072 当分母,
    // **水位放大 7.63 倍(12.8% 显示成 98%)**,未达 0.75 阈值即误弹「接续到新会话」确认卡。
    const im = line.match(/^\s*(?:-\s*)?id:\s*([A-Za-z0-9._:/-]+?)\s*,?\s*$/)
    if (im) { currentId = im[1]; if (byModel[currentId] === undefined) byModel[currentId] = 0; continue }
    // 2026-09-14 补齐 PR #31 的第二半:上一轮只移植了「字符类须含 `/`」那一半,漏了本条。
    // id 行存在但格式仍不被识别(带引号/含空格/中文等):重置 currentId,避免紧随其后的
    // contextWindow 被记到上一条模型头上 —— 静默错配比"读不到"更危险:读不到只退化为 fallback,
    // 错配会给出**偏小**的窗口,使水位漏报。
    if (/^\s*(?:-\s*)?id:/.test(line)) { currentId = null; continue }
    // 窗口:允许行尾逗号(flow 风格)
    const cm = line.match(/^\s*contextWindow:\s*([0-9]+)\s*,?\s*$/)
    if (cm && currentId) {
      const value = Number(cm[1])
      const route = currentProvider + '/' + currentId
      if (byRoute[route] === undefined) byRoute[route] = value
      if (!byModel[currentId]) byModel[currentId] = value
    }
  }
  return { byRoute, byModel }
}

/**
 * 按 provider/model 选窗口:先精确匹配 provider/model,再按 model 名全局兜底。
 * @param {{byRoute:Record<string,number>,byModel:Record<string,number>}} windows - parseModelWindowsPre 结果。
 * @param {string} provider - 路由 provider(可空)。
 * @param {string} model - 模型 id。
 * @returns {number} 窗口 token 数;未命中返回 0。
 */
export function pickWindowPre(windows, provider, model) {
  if (!windows || !model) return 0
  const byRoute = windows.byRoute || {}
  const byModel = windows.byModel || {}
  const exact = byRoute[(provider || '') + '/' + model]
  if (Number.isFinite(exact) && exact > 0) return exact
  const direct = byModel[model]
  if (Number.isFinite(direct) && direct > 0) return direct
  // 后缀兜底:路由 id 可能带 provider 前缀或版本后缀差异
  for (const route of Object.keys(byRoute)) {
    if (route.endsWith('/' + model) && byRoute[route] > 0) return byRoute[route]
  }
  for (const id of Object.keys(byModel)) {
    if (id.endsWith('-' + model) && byModel[id] > 0) return byModel[id]
  }
  return 0
}

/**
 * 从会话事件里取最近一条 request/header|request/context 的真实 provider/model(+ 顺带 contextWindow)。
 *
 * 背景(2026-09-08 用户实测):水位卡此前把「窗口来源」标成 settings.yaml 的 agent-default-model(新会话默认模型),
 * 用户在 GUI 里切过默认模型后,当前会话实际跑的模型与卡片显示不符
 * (实测:会话日志 request/header = deepseek-official/deepseek-v4.1-flash-expires-on-0910,卡片却写 opencode-go/deepseek-v4-flash)。
 * 会话自己的请求头才是「这个会话正在用哪个模型」的权威来源;默认模型只作兜底。
 *
 * @param {object[]} events - 会话事件数组。
 * @param {number} maxScan - 最多向前扫多少条(默认全部)。
 * @returns {{provider:string,model:string,contextWindow:number}} 未找到时字段为空/0。
 */
export function findSessionModelPre(events, maxScan = 0) {
  const out = { provider: '', model: '', contextWindow: 0, maxTokens: 0 }
  if (!Array.isArray(events) || !events.length) return out
  const floor = maxScan > 0 ? Math.max(0, events.length - maxScan) : 0
  for (let i = events.length - 1; i >= floor; i--) {
    const ev = events[i]
    const t = ev && ev.type
    if (t !== 'request/header' && t !== 'request/context') continue
    const d = (ev && ev.data) || {}
    const cfg = (d.header && d.header.config) || d.config || {}
    const provider = String(cfg.provider || d.provider || '')
    const model = String(cfg.model || d.model || '')
    const cw = Number(d.contextWindow) || 0
    const mt = Number(cfg.maxTokens) || 0
    if (!out.model && model) { out.model = model; out.provider = provider }
    if (!out.contextWindow && cw > 0) out.contextWindow = cw
    // maxTokens = 路由为**本次请求预留的输出预算**,provider 会把它计入 "requested tokens"(实测:
    // 消息 666,044 + 预留 384,000 = 1,050,044 > 上限 1,048,576 → 400 CONTEXT_WINDOW_EXCEEDED)。
    if (!out.maxTokens && mt > 0) out.maxTokens = mt
    if (out.model && out.contextWindow && out.maxTokens) break
  }
  return out
}

/**
 * 水位「硬信号」扫描(2026-09-10,实机取证后新增)。
 *
 * 背景(用户实测:官方压缩又抢在 75% 接续之前):本机 provider 的硬上限是 1,048,576 token,
 * 而**预留输出预算 384,000 也算在请求里** ⇒ 消息实际只能用到约 664,576。插件此前拿
 * `contextWindow`(1,000,000)当分母、拿本地计量当分子,两边都偏乐观,于是 75% 永远到不了,
 * 直到上游直接 400:
 *   "This model's maximum context length is 1048576 tokens. However, you requested 1050044 tokens
 *    (666044 in the messages, 384000 in the completion)."
 * 这条错误是**唯一权威**的口径来源。本函数把它与 compaction 事件一起扫出来,供上层:
 *   ① 解析真实窗口/预留额度/消息实占 → 自我校准分子;
 *   ② 一旦发生 overflow 或 compaction,直接当作「已到阈值」触发接续(不再依赖估算)。
 *
 * @param {object[]} events - 会话事件数组。
 * @returns {{reservedTokens:number,overflow:{seq:number,windowTokens:number,requestedTokens:number,messageTokens:number,completionTokens:number,code:string}|null,compactionSeq:number}}
 */
export function scanPressureSignalsPre(events) {
  const out = { reservedTokens: 0, overflow: null, compactionSeq: 0 }
  if (!Array.isArray(events) || !events.length) return out
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (!ev) continue
    const seq = Number(ev.seq) || 0
    const t = ev.type
    if (!out.reservedTokens && (t === 'request/header' || t === 'request/context')) {
      const d = (ev.data || {})
      const cfg = (d.header && d.header.config) || d.config || {}
      const mt = Number(cfg.maxTokens) || 0
      if (mt > 0) out.reservedTokens = mt
    }
    if (!out.compactionSeq && (t === 'compaction/start' || t === 'compaction/summary')) out.compactionSeq = seq
    if (out.overflow && out.compactionSeq && out.reservedTokens) break
    if (out.overflow || t !== 'assistant/attempt') continue
    const stream = (ev.data && ev.data.stream) || []
    for (const item of stream) {
      const chunk = (item && item.chunk) || {}
      if (chunk.type !== 'finish') continue
      const failure = (chunk.reason && chunk.reason.failure) || {}
      const code = String(failure.code || '')
      const msg = String(failure.message || '')
      if (code !== 'CONTEXT_WINDOW_EXCEEDED' && !/maximum context length/i.test(msg)) continue
      const win = Number((msg.match(/maximum context length is\s+(\d+)\s+tokens/i) || [])[1]) || 0
      const req = Number((msg.match(/you requested\s+(\d+)\s+tokens/i) || [])[1]) || 0
      const inMsg = Number((msg.match(/\((\d+)\s+in the messages/i) || [])[1]) || 0
      const inComp = Number((msg.match(/(\d+)\s+in the completion\)/i) || [])[1]) || 0
      out.overflow = { seq, windowTokens: win, requestedTokens: req, messageTokens: inMsg, completionTokens: inComp, code: code || 'CONTEXT_WINDOW_EXCEEDED' }
      break
    }
  }
  return out
}


/**
 * 从会话事件里取最近一条 request/context 的 contextWindow(路由权威值)。
 * 不限制扫描窗口:该事件只在请求头部变化时追加,长会话里往往只存在于开头。
 * @param {object[]} events - 会话事件数组。
 * @param {number} maxScan - 最多向前扫多少条(默认全部;设小值可限制开销)。
 * @returns {number} contextWindow;未找到返回 0。
 */
export function findOfficialContextWindowPre(events, maxScan = 0) {
  if (!Array.isArray(events) || !events.length) return 0
  const floor = maxScan > 0 ? Math.max(0, events.length - maxScan) : 0
  for (let i = events.length - 1; i >= floor; i--) {
    const ev = events[i]
    if (ev && ev.type === 'request/context') {
      const cw = Number(ev && ev.data && ev.data.contextWindow)
      return Number.isFinite(cw) && cw > 0 ? cw : 0
    }
  }
  return 0
}

/**
 * 判断「会话模型扫描结果」缓存可否复用(2026-09-14)。
 *
 * checkWaterLevel 把事件扫描结果按会话缓存 5 分钟,但**空结果也被一并缓存**:
 *   `if (cached && cached.sid === sid && now - cached.at < 300000 && cached.info) { 复用 }`
 * `cached.info` 恒为对象(即使内容为空) ⇒ 空结果照样命中,并被锁死 5 分钟。
 *
 * 而 `request/header` / `request/context` 是**发起请求时**才追加的事件 —— 实测同一轮内
 * `turn/start`(seq=4) → `request/context`(seq=13) 仅相隔 58ms,而首轮 `agent/pre-step`
 * 的测量早于这两条(step/start 在 request/context 之前约 21ms)。所以首次扫描必然扫不到
 * `request/context`:只能从 `request/header` 拿到 provider/model,`contextWindow` 为 0。
 * 该结果随后被锁死 5 分钟,这 5 分钟里 `official-context`(路由权威口径)始终不可用,
 * 窗口只能靠 settings.yaml 查表;若该模型在 settings.yaml 里查不到(新模型 / 切到未配置的
 * provider),窗口即退化为 fallback 131072,水位被系统性放大。
 *
 * 复用规则:
 *  - **非空**(contextWindow > 0):TTL 内直接复用 —— `request/context` 只在会话开头追加、值稳定,
 *    且扫描是 O(n),长会话理应避免重复全量扫描。
 *  - **空**:仅在**事件数未增长**时复用 —— 事件数增长意味着可能有新事件写入,值得重扫一次;
 *    未增长则复用,不为每个 pre-step 付出一次 O(n) 扫描。
 *
 * 兼容性:`cached.events` 为本次新增字段,旧缓存对象取到 undefined ⇒ 与 eventsLen 不相等 ⇒
 * 不复用、走重扫 —— 安全降级。
 *
 * @param {{sid:string, at:number, info:object, events:number}|null|undefined} cached - 上次缓存(cached.events = 扫描时的事件数)。
 * @param {string} sid - 当前会话 id。
 * @param {number} eventsLen - 当前事件数组长度。
 * @param {number} now - 当前时间戳(ms)。
 * @param {number} [ttlMs=300000] - 缓存有效期。
 * @returns {boolean} true 表示可复用 cached.info。
 */
export function reusableWindowCachePre(cached, sid, eventsLen, now, ttlMs = 300000) {
  if (!cached || !sid) return false
  if (cached.sid !== sid) return false
  if (!(now - Number(cached.at || 0) < ttlMs)) return false
  const info = cached.info
  if (!info) return false
  if (Number(info.contextWindow) > 0) return true
  return Number(cached.events) === Number(eventsLen)
}

/**
 * 判断是否具备「按水位比例触发自动接续」的资格(2026-09-14)。
 *
 * 背景:窗口来源优先级为 手动覆盖 > 官方 request/context > settings.yaml 按「会话真实模型」查表
 * > fallback 131072。而「会话真实模型」只能从会话事件 `request/header` / `request/context` 读取 ——
 * DSH 的 sessionApi 只提供 `selectModel`(只写不读),没有任何查询会话当前模型的接口。
 *
 * 这两个事件都是**发起请求时**才追加的:实测首轮 `turn/start` → `request/header` 之间不存在任何
 * 模型信息,即在 **新会话首轮 `agent/pre-step`** 的测量点上,`findSessionModelPre` 返回
 * `{provider:'',model:'',contextWindow:0,maxTokens:0}` —— **全空**。此时窗口与预留额度只能用
 * settings.yaml 的 `agent-default-model` 推算,而它与会话实际模型可以完全不同
 * (实测同一台机器上 `agent-default-model` 是 `command-code/deepseek-v4.1-flash`,
 * 而某个会话实际跑的是 `deepseek-official/deepseek-flash`,连 `maxTokens` 都不一致)。
 *
 * 用推算出来的分母按比例触发「建新会话 + 注入交接材料 + 切走窗口」这类重动作,风险不对称:
 * 分母偏小会让水位虚高数倍(实测 1,000,000 被当 131,072,放大 7.63 倍),未达阈值即误弹接续卡。
 * 因此模型未知时**只放行硬信号**(`compaction` / `overflow` / 撞硬墙 —— 均为真实事件,不依赖窗口估算);
 * 纯比例判据推迟到轮末再判 —— 届时 `request/header` 已写入,模型已知,判定链条完整。
 *
 * `wl.modelKnown !== true` 采用 fail-closed(2026-09-14 审查修正):字段缺失(undefined/null/0)一律
 * 视为「未知」,只放行硬信号。原先 `=== false` 显式判等本意是让未传字段的旧调用点行为不变,但
 * checkWaterLevel 存在早退路径(handoff 关闭 / win<=0 / 测量中途异常),此时 rt.waterLevelModelKnown
 * 为 undefined → 闸被静默绕过(变异验证:直调 {ratio:0.99, modelKnown:undefined, hard:false} 放行)。
 * fail-closed 后该路径收口为「不按比例 arm」—— 漏判优于误判,与本函数的整体取舍一致;两个 in-repo
 * 调用点都以 `!!(...)` 写入真布尔,正常测量路径行为不变。
 *
 * @param {{ratio:number, modelKnown?:boolean, hard?:boolean}|null|undefined} wl - 水位快照。
 * @returns {boolean} true 表示允许按比例 arm。
 */
export function shouldArmAutoContinuePre(wl) {
  if (!wl) return false
  if (wl.modelKnown !== true && !wl.hard) return false
  return true
}
