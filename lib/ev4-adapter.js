/**
 * ev4-adapter.js —— 数据适配层：把本插件的事件 store 转成**原型页面要的 payload**。
 *
 * ★这是整个 iframe 方案里**唯一一处「我们写的逻辑」** —— 其余 12 万字符全是原型源码原样。
 *   所以本文件必须：①纯函数 ②零 IO ③零依赖 ④可被 node 直接 import 做真函数测试（CR-10）。
 *
 * ★为什么 adapter 也要走「ESM 源 → 生成器内联」（见规格 §5-S3）：
 *   lib/client.js 是 CJS factory 闭包（0 import / 0 export / require 只有 react+react-dom），
 *   它既 import 不了本文件、也 require 不了相对路径（宿主 require.async 只认 /^client\.[\w.-]+\.js$/）。
 *   ⇒ 本文件是**单一真源**，由 tools/gen-ev4-blocks.mjs 序列化后内联进 client.js。
 *
 * ★payload schema 依据：规格 §3（从原型 index.html L714 反推）+ 原型消费点实测。
 */

/** 原型认的 panel.kind（注意：原型的 dead 对应我们的 deadend）。 */
const PANEL_KIND_MAP = { state: 'state', log: 'log', deadend: 'dead', next: 'next', userPercept: 'userPercept', commitment: 'commitment' }

/** 原型认的 panel.source —— ★坑①：log 面板的 source 必须是 quote（不是 log）。 */
const PANEL_SOURCE_MAP = { state: 'state', log: 'quote', deadend: 'dead', next: 'next', userPercept: 'userPercept', commitment: 'commitments' }

/** 四类 percept 字段名（原样，不改名）。 */
const PERCEPT_FIELDS = ['userPercept', 'agentTrace', 'sharedGround', 'commitments']

// ═══════════════════════════════════════════════════════════════════════════
// ★★2026-10-26 清洗层（审计 §2.1 修复）：sections / 检查点正文里的**元数据标记**必须在
//   进入注入文本与渲染之前剥掉，否则 `<!-- type=goal -->` 会被当成正文显示。
//
//   用户实报（2026-10-26）：白板事件卡右侧「理由」一整段开头是 `<!-- type=dead-end -->`，
//   卡片被撑到近 2000 字符，真正的教训被埋在元数据后面。
//
//   为什么必须在这里做（而不是渲染侧）：
//     · adapter 是**单一真源**（client.js 里那份是生成的）⇒ 在这改一次，两个渲染器都对；
//     · 同一份 sections 还被**注入文本**消费（buildTierLayerInjection 等）⇒ 在源头剥，注入侧也干净；
//     · 白板看板卡片那条路已有 wbStripComment（client.js L6246），但事件视图是**另一条通路**，
//       从未清洗 ⇒ 这是「同一缺陷两套渲染、只修了一半」的典型。
//
//   ★判据（smoke-test-wb-time-and-drawer E 组）：
//     ① adapter 输出的任何文本字段都不含 `<!--`；② 真数据端到端断言；③ 负路径（还原后必红）。
// ═══════════════════════════════════════════════════════════════════════════

/** 标题清洗：剥注释/前缀后压成单行（标题不该含换行）。 */
function titlePre(s) { return cleanSectionTextPre(s).split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean).join(' ').slice(0, 120) }

/** 剥 HTML 注释（`<!-- memory:mem_xxx -->` 锚点行与 `<!-- type=goal -->` tag 行）。 */
function stripHtmlCommentsPre(s) { return String(s == null ? '' : s).replace(/<!--[\s\S]*?-->/g, '') }

/**
 * 剥**行首**元数据 tag 前缀，例如 `type=state ｜ …` / `tag:goal …` / 纯 `type:goal` 整行。
 * ★只剥行首：正文中间出现的 `type=xxx` 可能是真内容，不该动。
 * 整行只有 tag 的，剥完变空串，由调用方 filter 掉。
 */
function stripMetaPrefixPre(s) {
  return String(s == null ? '' : s)
    // 整行只是一个 tag（可带 type/tag/topic 前缀与 = 或 : 分隔）：直接清空
    .replace(/^\s*(?:tag|type|topic)?\s*[:：=]?\s*(?:goal|state|dead-?end|progress|todo|done|active|paused)\s*$/gim, '')
    // 行首 tag + 分隔符 + 正文：只保留正文
    .replace(/^\s*(?:tag|type|topic)\s*[:：=]\s*[\w\u4e00-\u9fff-]+\s*[｜|]?\s*/gim, '')
    .replace(/^\s*[｜|]\s*/gim, '')
}

/** 组合：剥注释 → 剥行首 tag → 丢空行 → 收尾。用于所有面向人/模型的文本字段。 */
function cleanSectionTextPre(s) {
  return stripMetaPrefixPre(stripHtmlCommentsPre(s))
    .split(/\r?\n/)
    .map(function (l) { return l.replace(/\s+$/, '') })
    .filter(function (l) { return l.trim() })
    .join('\n')
    .trim()
}

// ═══════════════════════════════════════════════════════════════════════════
// 小工具（纯函数）
// ═══════════════════════════════════════════════════════════════════════════

/** 2 位补零。 */
function p2(n) { return (n < 10 ? "0" : "") + n }

/**
 * ms → { at: "YYYY-MM-DD HH:mm", date, time }（★坑④：at 必须是这个精确格式，cpRow 直接输出）
 * ★本地时区，不用 UTC —— 事件时间是用户本地语义，转 UTC 会差 8 小时。
 */
function fmtAtPre(ms) {
  const n = Number(ms)
  if (!isFinite(n)) return { at: "", date: "", time: "" }
  const d = new Date(n)
  const date = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate())
  const time = p2(d.getHours()) + ":" + p2(d.getMinutes())
  return { at: date + " " + time, date: date, time: time }
}

/** 取字符串（null/undefined → ""，其余 String()）。 */
function sPre(v) { return v == null ? "" : String(v) }

/** 数组化（非数组 → []）。 */
function arrPre(v) { return Array.isArray(v) ? v : [] }

/** 稳定字符串签名用：把值压成短串（对象走 JSON，长度截断防爆）。 */
function sigVal(v) {
  if (v == null) return ""
  if (typeof v === "object") {
    try { const j = JSON.stringify(v); return j.length > 400 ? j.slice(0, 400) + "#" + j.length : j } catch (e) { return "?" }
  }
  return String(v)
}

// ═══════════════════════════════════════════════════════════════════════════
// Checkpoint 适配
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把本插件的 checkpoint 转成原型 cpRow() 能读的形状。
 *
 * ★四个坑全部在这里处理：
 *   ① panel.source：log → quote（不是 log）
 *   ② panel.kind：deadend → dead
 *   ③ cp.ms：必须给（gapsOf 用它算空档；缺了「搁置 N 小时」永远不显示）
 *   ④ at：必须是 "YYYY-MM-DD HH:mm"
 */
function adaptCheckpointPre(cp, ev, j) {
  const c = cp || {}
  // ★cp.ms：优先用原字段；没有就退到 at（本插件 at 是毫秒数）
  let ms = Number(c.ms)
  if (!isFinite(ms)) ms = Number(c.at)
  if (!isFinite(ms)) ms = 0
  const t = fmtAtPre(ms)
  const panels = arrPre(c.panels).map(function (p) {
    const q = p || {}
    const k0 = sPre(q.kind)
    const k = PANEL_KIND_MAP[k0] || k0 || "log"
    const src = PANEL_SOURCE_MAP[k0] || sPre(q.source) || "state"
    const out = { kind: k, label: sPre(q.label), source: src }
    if (Array.isArray(q.items)) out.items = q.items.map(function (x) { return sPre(x) })
    return out
  })
  return {
    id: sPre(c.id) || ("cp-" + sPre(ev && ev.id) + "-" + j),
    at: t.at, date: t.date, time: t.time,
    ms: ms,
    rel: sPre(c.sourceRef) || sPre(c.kind),
    bytes: sPre(c.text).length,
    goal: [], state: [], dead: [], next: [],
    quoteRef: sPre(c.sourceRef),
    quoteLine: sPre(c.text),
    userPercept: [],
    commitments: [],
    panels: panels,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event 适配
// ═══════════════════════════════════════════════════════════════════════════

/** 依据 checkpoints 与 sections 推断状态（原型只认 done/active/paused）。 */
function normStatusPre(st) {
  const v = sPre(st)
  if (v === "done" || v === "active" || v === "paused") return v
  // 本插件可能出现的其它状态：一律按 active 渲染（有进展就是进行中）
  return "active"
}

/** 置信度归一（原型只认 high/medium/low）。 */
function normConfPre(v) {
  const x = sPre(v)
  if (x === "high" || x === "medium" || x === "low") return x
  return "medium"
}

/**
 * 把本插件的事件转成原型要的 Event。
 * ★字段名从本插件的 name → 原型的 title（原型读 ev.title）。
 */
function adaptEventPre(e, i) {
  const ev = e || {}
  const sec = ev.sections || {}
  const cps = arrPre(ev.checkpoints).map(function (cp, j) { return adaptCheckpointPre(cp, ev, j) })
  // 起止时间：用首末检查点；无检查点则退到 createdAt/updatedAt/startMs。
  // ★★2026-10-26（用户实报「白板时间显示 1970 年」·真机复现）：
  //   原先 `isFinite(first) ? first : 0` —— 拿不到时间就伪造 `0`，而 `new Date(0)` 是合法日期
  //   ⇒ 静默渲染成 `1970-01-01 08:00`，既不报错也不降级，用户只能看到一个假年份。
  //   更隐蔽的是：`list()` 接口**刻意不返回 checkpoints**（正文走 /event-detail），
  //   所以前端在列表态**永远**走 `Number(ev.createdAt)` 这条分支 ⇒ 只要 createdAt 缺失就必然 1970。
  //   ⇒ 两级修：①`event-store.list()` 投影补 `createdAt`（已修，见 event-store.js）；
  //     ②本函数改成**多级兜底 + 不伪造 0**：真拿不到就返回空串（前端渲染为「时间未知」），绝不冒充 1970。
  function pickMsPre() {
    for (let ai = 0; ai < arguments.length; ai += 1) {
      const v = Number(arguments[ai])
      if (isFinite(v) && v > 0) return v
    }
    return NaN
  }
  const first = cps.length ? cps[0].ms : pickMsPre(ev.createdAt, ev.updatedAt, ev.startMs)
  const lastMs = cps.length ? cps[cps.length - 1].ms : pickMsPre(ev.updatedAt, ev.createdAt, ev.endMs)
  const startMs = isFinite(first) ? first : NaN
  const endMs = isFinite(lastMs) ? lastMs : startMs
  // ★fmtAtPre(NaN) 返回 { at:'', date:'', time:'' } ⇒ 前端显示空而非 1970
  const st = fmtAtPre(startMs), en = fmtAtPre(endMs)
  // 成果：本插件是单数 outcome 字符串 ⇒ 原型要 outcomes:[{text}]
  const outcomes = [];
  const oc = sPre(ev.outcome)
  if (oc) outcomes.push({ text: oc })
  return {
    id: sPre(ev.id) || ("ev-" + i),
    ordinal: i + 1,
    kind: "event",
    // ★★2026-10-26（审计 §2.1 修复）：所有面向人/模型的文本字段统一过 cleanSectionTextPre，
    //   剥掉 `<!-- type=xxx -->` / `<!-- memory:mem_xxx -->` 等元数据标记。
    //   用户实报：事件卡「理由」开头是 `<!-- type=dead-end -->`，整卡被撑到近 2000 字符。
    title: titlePre(ev.name) || "(未命名事件)",
    summary: cleanSectionTextPre(ev.summary),
    rationale: cleanSectionTextPre(sec.deadend) || cleanSectionTextPre(ev.pausedReason),
    // sections 四段也一并清洗（供详情页/注入消费）
    sections: {
      goal: cleanSectionTextPre(sec.goal),
      doing: cleanSectionTextPre(sec.doing),
      deadend: cleanSectionTextPre(sec.deadend),
      next: cleanSectionTextPre(sec.next),
    },
    confidence: normConfPre(ev.confidence),
    status: normStatusPre(ev.status),
    date: st.date,
    // ★★2026-10-26 修（用户实报时间显示 `08:0 年 0 月`）：
    //   原型 EV4_PROTO_RUNTIME 把 `ev.start` 当**完整时间戳 'YYYY-MM-DD HH:mm'** 消费，共 18 处：
    //     monthLabel `slice(0,7)` 取年月 / 日期分组 `slice(0,10)` / 时刻 `slice(11,16)` / relLabel 亦然；
    //   原型自己的 demo 生成器（runtime L89）亦为 `start: cps[0].at`（at 是完整串）⇒ 双证。
    //   旧代码给 `st.time`（仅 'HH:mm'）⇒ `'08:00'.slice(0,7)`='08:00' ⇒ `Number('')`=0 ⇒ '08:0 年 0 月'。
    //   ⚠ 本文件是**源**，lib/client.js 里那份由 tools/gen-ev4-blocks.mjs 生成；
    //     只改 client.js 会被下次生成覆盖（本次实测：改了 client.js ⇒ gen --check 立刻报 STALE）。
    start: st.at,
    end: en.at,
    startMs: startMs,
    endMs: endMs,
    members: [],
    checkpoints: cps,
    outcomes: outcomes,
    skills: [],
    userPercept: arrPre(ev.userPercept),
    agentTrace: arrPre(ev.agentTrace),
    sharedGround: arrPre(ev.sharedGround),
    commitments: arrPre(ev.commitments),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// stats / payload / sig
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 顶栏 chips 的数据源（★必须是真实数字，原型写死的 839/127 会被 patchShellStatsPre 替换）。
 * singleCpPct = 只有 1 个检查点的事件占比（原型显示「单检查点 62.3%」这类）。
 */
function computeStatsPre(events, extra) {
  const list = arrPre(events)
  const x = extra || {}
  let checkpoints = 0, maxEvent = 0, single = 0
  for (let i = 0; i < list.length; i += 1) {
    const n = arrPre(list[i] && list[i].checkpoints).length
    checkpoints += n
    if (n > maxEvent) maxEvent = n
    if (n === 1) single += 1
  }
  const singleCpPct = list.length ? Math.round((single / list.length) * 1000) / 10 : 0
  return {
    docs: x.docs != null ? x.docs : 0,
    events: list.length,
    checkpoints: checkpoints,
    maxEvent: maxEvent,
    singleCpPct: singleCpPct,
  }
}

/**
 * store → 原型 payload。
 * ★opts: { docs, generatedBy, params }
 */
function adaptStoreToPrototypePayload(store, opts) {
  const st = store || {}
  const o = opts || {}
  const srcEvents = arrPre(st.events)
  const events = srcEvents.map(function (e, i) { return adaptEventPre(e, i) })
  return {
    schema: 'wb-event-preview/2',
    generatedBy: sPre(o.generatedBy) || "dsh-auto-memory/ev4-adapter",
    params: o.params || {},
    fixture: {},
    demo: { events: [] },
    judge: {},
    perceptFields: PERCEPT_FIELDS.slice(),
    stats: computeStatsPre(events, o),
    events: events,
  }
}

/**
 * 稳定签名：供 client.js 的 useMemo 做依赖（★不能用 [data]，data 引用每次 refresh 都变）。
 *
 * 判据（规格 §5-S3）：
 *   · 覆盖所有影响渲染的字段：id/status/title/summary/checkpointCount/updatedAt
 *   · 检查点**内部内容**也要进签名（否则改了文字但 count 不变 ⇒ iframe 不刷新）
 *   · 签名相同 ⇒ payload 输出必须逐字节相同（套件做变异反向验证）
 */
function ev4PayloadSigPre(store) {
  const st = store || {}
  const list = arrPre(st.events)
  const parts = []
  for (let i = 0; i < list.length; i += 1) {
    const e = list[i] || {}
    const cps = arrPre(e.checkpoints)
    const sec = e.sections || {}
    parts.push([
      sPre(e.id), sPre(e.status), sPre(e.name), sPre(e.summary),
      sPre(e.outcome), sPre(e.updatedAt), sPre(e.createdAt),
      cps.length,
      // ★检查点内容进签名：at + kind + text 长度 + panels 数（轻量但足够敏感）
      cps.map(function (c) {
        const q = c || {}
        return sPre(q.at) + "~" + sPre(q.kind) + "~" + sPre(q.text).length + "~" + arrPre(q.panels).length;
      }).join("|"),
      sPre(sec.goal).length + "~" + sPre(sec.doing).length + "~" + sPre(sec.deadend).length + "~" + sPre(sec.next).length,
      sPre(e.userPercept && JSON.stringify(e.userPercept)).length,
    ].join("\u0001"))
  }
  parts.push(sPre(st.updatedAt))
  const joined = parts.join("\u0002")
  // FNV-1a 32bit：纯 JS、零依赖、够快（12 万字符级输入的签名开销可忽略）
  let h = 0x811c9dc5
  for (let i = 0; i < joined.length; i += 1) {
    h ^= joined.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return "ev4-" + list.length + "-" + joined.length + "-" + h.toString(16)
}

// ═══════════════════════════════════════════════════════════════════════════
// ★srcdoc 安全包装（规格 §5.0-③ 硬要求）
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ★patchShellStatsPre 不在这里实现（2026-10-25 Lead 裁决 A 方案）
//
// 原型模块里那份是**内部函数**（不 export），但它是纯函数、纯文本可抽。
// ⇒ 由 tools/gen-ev4-blocks.mjs 从 lib/ev4-prototype-blocks.js 的**源码文本**里
//    配平抽取后内联（单一真源，无两份实现、无漂移）。
// ★本文件里**故意没有** patchShellStatsPre —— 别再加回来。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ★★buildEv4IframeHtmlSafePre —— 安全版拼装（规格 §5.0-③）。
 *
 * 【为什么必须存在】原型模块的 buildEv4IframeHtmlPre 直接 JSON.stringify(payload) 拼进
 *   `<script type="application/json" id="payload">…</script>`。
 *   payload 里的**用户文案不受控**（事件标题/检查点正文都可能是用户写的），
 *   一旦含 `</script>` ⇒ HTML 解析器提前关闭脚本块 ⇒ **整页白屏**，
 *   而 node --check / 所有静态断言**全绿**（这是最危险的一类静默故障）。
 *
 * 【修法】JSON 是合法 JS 表达式，把 `</` 转义成 `<\/` 不改变 JSON.parse 的结果，
 *   但不会让 HTML 解析器看到结束标签。
 *   ★这只处理 `</script`，不动其它字符 —— 保证 payload 原文语义零改变。
 */
function escapeScriptJsonPre(json) {
  return String(json).replace(/<\/(script)/gi, "<\\/$1");
}

/**
 * 与原型 buildEv4IframeHtmlPre **同序拼装**，但 payload 做 </script> 转义。
 * ★五块顺序必须与 EV4_PROTO_PART_ORDER 一致（套件断言）。
 * @param {object} payload
 * @param {object} parts 五块常量 { HEAD, THEME_SCRIPT, CSS, BODY_SHELL, RUNTIME }
 */
function buildEv4IframeHtmlSafePre(payload, parts) {
  const p = payload && typeof payload === "object" ? payload : { events: [] }
  const P = parts || {}
  const json = escapeScriptJsonPre(JSON.stringify(p));
  const shell = patchShellStatsPre(P.BODY_SHELL, p.stats);
  return [
    P.HEAD,
    P.THEME_SCRIPT,
    P.CSS,
    shell,
    '<script type="application/json" id="payload">' + json + '</script>',
    '<script>' + P.RUNTIME + '</script>',
    '</body></html>',
  ].join('\n')
}

export {
  adaptStoreToPrototypePayload,
  adaptEventPre,
  adaptCheckpointPre,
  computeStatsPre,
  ev4PayloadSigPre,
  escapeScriptJsonPre,
  buildEv4IframeHtmlSafePre,
}
