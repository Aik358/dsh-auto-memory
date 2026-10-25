/**
 * v4 E3 · 中栏事件卡（照搬原型 renderCard）
 *
 * ## 原型核心设计：三档 ticket（检查点数自适应）
 *   narrow (≤1 cp)：只有 row1(title+datetime)，**不渲染 meta/badge**
 *   medium (2-3)  ：row1 + meta(状态 + 检查点数 + 空档)
 *   wide   (≥4)   ：再加 kind/conf 徽章 + summary + 成果 + why
 *
 * ★这是本步最容易写错的地方：所有卡片长一样（不分档）= 用户看到的「照搬失败」。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   - ' + msg) } else { fail++; console.log('  FAIL - ' + msg) } }

function extractFn (src, name) {
  const at = src.indexOf('function ' + name + '(')
  if (at < 0) return null
  const open = src.indexOf('{', src.indexOf(')', at))
  if (open < 0) return null
  let depth = 1
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1) }
  }
  return null
}

console.log("== 0. 抽纯函数层并真求值 ==")
const FNS = ['pad2Pre', 'isoToLocalPre', 'monthLabelPre', 'ev4ShapeOf', 'monthDensityPre', 'relLabelPre', 'eventSpanOfPre',
  'ev4TicketOfPre', 'ev4StatusLabelPre', 'ev4StatusClsPre', 'ev4KindLabelPre', 'ev4ConfLabelPre', 'ev4ConfClsPre', 'ev4CardModelPre']
let bundle = ""
let missing = []
for (const f of FNS) {
  const s = extractFn(SRC, f)
  if (!s) { missing.push(f); continue }
  bundle += s + "\n"
}
ok(missing.length === 0, "★★ 全部 " + FNS.length + " 个纯函数可定位（缺失：" + (missing.join(",") || "无") + "）")
bundle += "var GAP_MS_PRE = 2 * 3600000;\n"
bundle += "var WEEK_PRE = ['周日','周一','周二','周三','周四','周五','周六'];\n"
const ctx = vm.createContext({ console })
vm.runInContext(bundle + "\n;globalThis.__E3 = { ev4TicketOfPre, ev4StatusLabelPre, ev4StatusClsPre, ev4KindLabelPre, ev4ConfLabelPre, ev4ConfClsPre, ev4CardModelPre, ev4ShapeOf, eventSpanOfPre };", ctx)
const E3 = ctx.__E3
ok(!!E3 && typeof E3.ev4CardModelPre === 'function', '★★ 纯函数层真求值成功（不是静态断言）')
if (!E3) { console.log("\nSUMMARY  PASS " + pass + " / FAIL " + fail); process.exit(1) }

const H = 3600000
const T0 = Date.UTC(2026, 9, 20, 2, 0, 0)
function hostEv (over) {
  return Object.assign({ id: "e1", name: "测试事件", status: "active", updatedAt: T0, checkpointCount: 1, kind: "ledger" }, over || {})
}

console.log("")
console.log("== 1. ★★三档 ticket 分档（本步核心：必须照搬原型）==")
const tNarrow0 = E3.ev4TicketOfPre(hostEv({ checkpointCount: 0 }))
const tNarrow1 = E3.ev4TicketOfPre(hostEv({ checkpointCount: 1 }))
const tMedium2 = E3.ev4TicketOfPre(hostEv({ checkpointCount: 2 }))
const tMedium3 = E3.ev4TicketOfPre(hostEv({ checkpointCount: 3 }))
const tWide4 = E3.ev4TicketOfPre(hostEv({ checkpointCount: 4 }))
const tWide9 = E3.ev4TicketOfPre(hostEv({ checkpointCount: 9 }))
ok(tNarrow0 === "narrow", "★★[正] 0 检查点 ⇒ narrow（实测 " + tNarrow0 + "）")
ok(tNarrow1 === "narrow", "★★[正] 1 检查点 ⇒ narrow（边界，实测 " + tNarrow1 + "）")
ok(tMedium2 === "medium", "★★[正] 2 检查点 ⇒ medium（边界，实测 " + tMedium2 + "）")
ok(tMedium3 === "medium", "★★[正] 3 检查点 ⇒ medium（实测 " + tMedium3 + "）")
ok(tWide4 === "wide", "★★[正] 4 检查点 ⇒ wide（边界，实测 " + tWide4 + "）")
ok(tWide9 === "wide", "★★[正] 9 检查点 ⇒ wide（实测 " + tWide9 + "）")
ok(E3.ev4TicketOfPre(hostEv({ kind: "demo", checkpointCount: 9 })) === "narrow", "★[正] kind=demo ⇒ 强制 narrow（原型规则）")
ok(E3.ev4TicketOfPre(hostEv({ kind: "note", checkpointCount: 9 })) === "narrow", "★[正] kind!=ledger ⇒ 强制 narrow（原型规则）")
// ★变异：边界改成 <1 / >=3（全体上移一档）⇒ 边界断言必红
// ★变异用**不含引号**的锚点替换（引号在多层转义里容易失配，本轮踩过）
const mutTicket = extractFn(SRC, "ev4TicketOfPre")
  .replace("n <= 1", "n < 1")
  .replace("n >= 4", "n >= 3")
// ★不依赖 bundle.replace（CRLF 下容易失配）：直接把其余依赖 + 变异体拼起来
const mutDeps = ['pad2Pre', 'isoToLocalPre', 'ev4ShapeOf', 'eventSpanOfPre'].map((f) => extractFn(SRC, f)).filter(Boolean).join("\n")
const mutT = vm.createContext({ console })
vm.runInContext(mutDeps + "\n" + mutTicket + "\n;globalThis.__T = { ev4TicketOfPre };", mutT)
// ★变异预期必须自己先算对：n<1 / n>=3 下，2 仍落在 medium（2 < 3），
//   真正的分界变化发生在 **3**：原版 3 ⇒ medium；变异 n>=3 ⇒ wide。
//   （上一版我把预期写成「2 ⇒ wide」，那是算错了 —— 变异断言必须先手算期望，不能凭感觉。）
ok(mutT.__T.ev4TicketOfPre(hostEv({ checkpointCount: 1 })) === "medium", "[变异] 边界改 n<1 ⇒ **1 检查点变 medium**（原版是 narrow；1 不满足 <1）")
ok(mutT.__T.ev4TicketOfPre(hostEv({ checkpointCount: 2 })) === "medium", "[变异] 2 检查点在 n>=3 规则下仍是 medium（2 < 3，这条也不变）")
ok(mutT.__T.ev4TicketOfPre(hostEv({ checkpointCount: 3 })) === "wide", "★★[变异] 边界改 n>=3 ⇒ **3 检查点变 wide**（原版是 medium）⇒ 原「3⇒medium」断言必红（判据非恒真）")
ok(tMedium2 === "medium", "[还原] 未变异版 2 ⇒ medium 复绿")

console.log("")
console.log("== 2. ★★narrow 档必须 **无 badge**（原型直接 return，不渲染 meta）==")
const mNarrow = E3.ev4CardModelPre(hostEv({ checkpointCount: 1, name: "窄卡" }))
ok(mNarrow.ticket === "narrow", "★[正] 模型 ticket = narrow")
ok(mNarrow.badges.length === 0, "★★★[正] narrow 档 badges **为空数组**（实测 length " + mNarrow.badges.length + "）⇒ 这是「照搬原型」的关键差异")
ok(mNarrow.title === "窄卡", "★[正] 标题透传")
ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(mNarrow.datetime), "★[正] datetime 是 16 位「YYYY-MM-DD HH:MM」（实测 " + mNarrow.datetime + "）")

console.log("")
console.log("== 3. medium 档：状态 + 检查点数 badge，但**无** kind/conf ==")
const mMed = E3.ev4CardModelPre(hostEv({ checkpointCount: 3, status: "done" }))
ok(mMed.ticket === "medium", "★[正] ticket = medium")
ok(mMed.badges.length === 2, "★★[正] medium 恰 2 个 badge（状态 + 检查点数，实测 " + mMed.badges.length + "）")
ok(mMed.badges[0].text === "已完成", "★[正] 首 badge = 状态中文（实测 " + mMed.badges[0].text + "）")
ok(mMed.badges[0].cls === "b-done", "★[正] 首 badge class = b-done（实测 " + mMed.badges[0].cls + "）")
ok(mMed.badges[1].text === "3 检查点", "★[正] 次 badge = 「3 检查点」（实测 " + mMed.badges[1].text + "）")
ok(mMed.badges.every((b) => b.cls !== "b-kind" || b.text.includes("检查点")), "★★[正] medium **无** kind 徽章（只有检查点数用 b-kind class）")
ok(mMed.summary === "" || !mMed.summary, "★[负] medium 不取 summary（原型只在 wide 渲染）")

console.log("")
console.log("== 4. wide 档：+kind +conf +summary +成果 ==")
const mWide = E3.ev4CardModelPre(hostEv({ checkpointCount: 5, status: "active", kind: "ledger", confidence: "high", summary: "这是摘要", outcomes: ["成果A", "成果B", "成果C"], rationale: "这是理由" }))
ok(mWide.ticket === "wide", "★[正] ticket = wide")
ok(mWide.badges.length === 4, "★★[正] wide 恰 4 个 badge（状态+kind+conf+检查点数，实测 " + mWide.badges.length + "）")
ok(mWide.badges[1].text === "账本事件", "★[正] 第 2 badge = kind 中文（实测 " + mWide.badges[1].text + "）")
ok(mWide.badges[2].text === "高置信", "★[正] 第 3 badge = 置信度中文（实测 " + mWide.badges[2].text + "）")
ok(mWide.badges[2].cls === "b-high", "★[正] 置信度 class = b-high")
ok(mWide.summary === "这是摘要", "★[正] wide 取 summary（实测 \"" + mWide.summary + "\"）")
ok(mWide.outcomes.length === 2, "★★[正] 成果只取**前 2 条**（原型 slice(0,2)，实测 " + mWide.outcomes.length + "）")
ok(mWide.outcomeMore === 1, "★★[正] 剩余成果数 = 1（3-2，实测 " + mWide.outcomeMore + "）")
ok(mWide.why === "这是理由", "★[正] wide 取 rationale → why（实测 \"" + mWide.why + "\"）")

console.log("")
console.log("== 5. 状态/类型/置信度 标签表（逐项对原型）==")
ok(E3.ev4StatusLabelPre("done") === "已完成" && E3.ev4StatusLabelPre("active") === "进行中" && E3.ev4StatusLabelPre("paused") === "搁置" && E3.ev4StatusLabelPre("x") === "未判定", "★★[正] statusLabel 四档全对")
ok(E3.ev4StatusClsPre("done") === "b-done" && E3.ev4StatusClsPre("active") === "b-active" && E3.ev4StatusClsPre("paused") === "b-paused" && E3.ev4StatusClsPre("x") === "b-unknown", "★★[正] statusCls 四档全对")
ok(E3.ev4KindLabelPre("planSnapshot") === "白板快照" && E3.ev4KindLabelPre("sessionTranscript") === "会话转写" && E3.ev4KindLabelPre("note") === "说明" && E3.ev4KindLabelPre("unplanned") === "待归并" && E3.ev4KindLabelPre("x") === "账本事件", "★★[正] kindLabel 五档全对")
ok(E3.ev4ConfLabelPre("high") === "高置信" && E3.ev4ConfLabelPre("medium") === "中置信" && E3.ev4ConfLabelPre("x") === "待人工", "★★[正] confLabel 三档全对")
ok(E3.ev4ConfClsPre("high") === "b-high" && E3.ev4ConfClsPre("medium") === "b-medium" && E3.ev4ConfClsPre("x") === "b-low", "★★[正] confCls 三档全对")

console.log("")
console.log("== 6. 空档 badge（检查点间 >2h）==")
const gapEv = hostEv({ checkpointCount: 3 });
const shapedG = E3.ev4ShapeOf(gapEv);
ok(shapedG.checkpoints.length === 3, "★[前置] 3 个检查点占位已生成")
// 占位检查点 ms 全相同 ⇒ 无空档 ⇒ 无空档 badge
const mNoGap = E3.ev4CardModelPre(gapEv);
ok(mNoGap.gapMaxHours === 0, "★★[负] 检查点无间隔 ⇒ gapMaxHours 0（实测 " + mNoGap.gapMaxHours + "）")
ok(!mNoGap.badges.some((b) => b.text.indexOf("空档") === 0), "★★[负] 无 >2h ⇒ **不出现空档 badge**")

console.log("")
console.log("== 7. 边界与负路径 ==")
ok(E3.ev4CardModelPre({}).ticket === "narrow", "[负] 空对象 ⇒ narrow，不崩")
ok(E3.ev4CardModelPre(null).ticket === "narrow", "[负] null ⇒ narrow，不崩")
ok(E3.ev4CardModelPre({}).title === "(未命名)", "[负] 空对象 ⇒ 标题降级")
ok(E3.ev4CardModelPre(hostEv({ checkpointCount: 4, outcomes: [] })).outcomes.length === 0, "[负] wide 但无成果 ⇒ outcomes 空数组")

console.log("");
console.log("== 8. 渲染层：三档渲染结果必须**结构不同** ==")
// 用真 h() 渲染（从 client.js 抽 h 太复杂，这里用极简 h 桩但**断言的是真渲染函数的返回结构**）
const renderSrc = extractFn(SRC, "renderEv4CardPre")
ok(!!renderSrc, "★[正] renderEv4CardPre 可抽取（" + (renderSrc ? renderSrc.length : 0) + " 字符）")
function hStub (tag, props, kids) {
  if (Array.isArray(props) || props == null) { kids = props; props = {} }
  const arr = []
  const push = (x) => { if (x == null || x === false) return; if (Array.isArray(x)) { x.forEach(push); return } arr.push(x) }
  push(kids)
  return { tag, props: props || {}, children: arr }
}
const rctx = vm.createContext({ console, h: hStub })
const rBundle = ['pad2Pre', 'isoToLocalPre', 'ev4ShapeOf', 'eventSpanOfPre', 'ev4TicketOfPre', 'ev4StatusLabelPre', 'ev4StatusClsPre', 'ev4KindLabelPre', 'ev4ConfLabelPre', 'ev4ConfClsPre', 'ev4CardModelPre', 'renderEv4CardPre']
  .map((f) => extractFn(SRC, f)).filter(Boolean).join("\n") + "\nvar GAP_MS_PRE = 2*3600000;\n;globalThis.__R = { renderEv4CardPre, ev4CardModelPre };";
vm.runInContext(rBundle, rctx)
const R = rctx.__R
function countByClass (node, cls) {
  let n = 0
  const walk = (x) => {
    if (!x || typeof x !== "object") return
    const cn = (x.props && x.props.className) || ""
    if (String(cn).split(" ").includes(cls)) n++
    ;(x.children || []).forEach(walk)
  }
  walk(node)
  return n
}
const rNarrow = R.renderEv4CardPre(hostEv({ checkpointCount: 1, name: "窄" }), true, null, null)
const rMedium = R.renderEv4CardPre(hostEv({ checkpointCount: 3, name: "中" }), true, null, null)
const rWide = R.renderEv4CardPre(hostEv({ checkpointCount: 5, name: "宽", summary: "摘", outcomes: ["a"], rationale: "r" }), true, null, null)
ok(rNarrow.props["data-dam-ticket"] === "narrow", "★★[正] narrow 渲染根 data-dam-ticket=narrow")
ok(rMedium.props["data-dam-ticket"] === "medium", "★★[正] medium 渲染根 data-dam-ticket=medium")
ok(rWide.props["data-dam-ticket"] === "wide", "★★[正] wide 渲染根 data-dam-ticket=wide")
ok(countByClass(rNarrow, "meta") === 0, "★★★[正] narrow **不渲染 .meta**（实测 " + countByClass(rNarrow, "meta") + " 个）⇒ 与原型一致")
ok(countByClass(rMedium, "meta") === 1, "★★[正] medium 渲染 1 个 .meta（实测 " + countByClass(rMedium, "meta") + "）")
ok(countByClass(rWide, "meta") === 1, "★★[正] wide 渲染 1 个 .meta")
ok(countByClass(rNarrow, "badge") === 0, "★★★[正] narrow **零 badge**（实测 " + countByClass(rNarrow, "badge") + "）")
ok(countByClass(rMedium, "badge") === 2, "★★[正] medium 恰 2 badge（实测 " + countByClass(rMedium, "badge") + "）")
ok(countByClass(rWide, "badge") === 4, "★★[正] wide 恰 4 badge（实测 " + countByClass(rWide, "badge") + "）")
ok(countByClass(rMedium, "summary") === 0, "★★[正] medium **不渲染 summary**（原型只在 wide）")
ok(countByClass(rWide, "summary") === 1, "★★[正] wide 渲染 summary")
ok(countByClass(rMedium, "why") === 0 && countByClass(rWide, "why") === 1, "★★[正] why 只在 wide")
ok(countByClass(rNarrow, "row1") === 1 && countByClass(rMedium, "row1") === 1, "★[正] row1 三档都有（原型共有结构）")
ok(countByClass(rNarrow, "expand") === 1, "★[正] expand 提示三档都有")
// ★变异：把 ticket!=="narrow" 的判断去掉 ⇒ narrow 也会有 meta ⇒ 断言必红
const mutRender = renderSrc.replace("if (m.ticket !== 'narrow') {", "if (true) {")
ok(mutRender !== renderSrc, "[变异] 成功把 narrow 判断改成恒真")
const rMutBundle = ['pad2Pre', 'isoToLocalPre', 'ev4ShapeOf', 'eventSpanOfPre', 'ev4TicketOfPre', 'ev4StatusLabelPre', 'ev4StatusClsPre', 'ev4KindLabelPre', 'ev4ConfLabelPre', 'ev4ConfClsPre', 'ev4CardModelPre'].map((f) => extractFn(SRC, f)).filter(Boolean).join("\n") + "\nvar GAP_MS_PRE = 2*3600000;\n" + mutRender + "\n;globalThis.__RM = { renderEv4CardPre };";
const rMutCtx = vm.createContext({ console, h: hStub })
vm.runInContext(rMutBundle, rMutCtx)
const rMutNarrow = rMutCtx.__RM.renderEv4CardPre(hostEv({ checkpointCount: 1 }), true, null, null)
ok(countByClass(rMutNarrow, "meta") === 1, "★★★[变异] 去掉 narrow 判断 ⇒ narrow 也渲染 .meta ⇒ 原断言必红（判据非恒真）")
ok(countByClass(rNarrow, "meta") === 0, "[还原] 未变异版仍 0 个 .meta ⇒ 复绿")

console.log("")
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
if (fail > 0) process.exit(1)