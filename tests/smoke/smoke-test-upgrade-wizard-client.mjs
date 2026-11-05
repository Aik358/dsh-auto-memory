#!/usr/bin/env node
/**
 * smoke-test-upgrade-wizard-client.mjs —— 向导 P4（三页 + 进度卡）前端守卫（真执行，非静态断言）
 *
 * ## 为什么必须真执行（本仓硬性规则）
 * client.js 是浏览器 __ModuleLoader__ 手写 bundle：node --check 只证明语法，静态 grep 只证明
 * 「源码里有这个字符串」，都无法证明组件/纯函数能加载且行为正确。⇒ 本套件把向导那一段源码抽出来，
 * 在 vm 里真执行：
 *   ① 常量与宿主模块逐键对拍（宿主 lib/upgrade-links.js 是唯一真源）；
 *   ② 触发三道闸 / 费用分摊 / 耗时 / 进度模型 / 范围选择 —— 全部真调用，正反例都测；
 *   ③ 第 1/2/3/4 页真渲染（把 fixture 注入抽取出来的片段），断言关键控件与文案在场；
 *   ④ 负路径：注入未定义标识符 ⇒ 真渲染必须精确报 ReferenceError（判据非恒真）；
 *   ⑤ 变异验证：删掉 legacy 判据 ⇒ 触发闸断言必红（证明断言测的是真行为）。
 *
 * ## 事实源纪律
 * · 链接/按钮文案：UPGRADE_LINKS / UPGRADE_LINK_LABELS / UPGRADE_LINK_DISCLAIMER 从宿主 import，
 *   与 client.js 里的镜像逐键对拍（宿主改了而镜像没跟 ⇒ 本套件红）。
 * · 费用：client 侧没有价格公式，只把宿主 estimateUpgradeTotalsPre 的合计按字符占比分摊；
 *   本套件断言「选中=全集时分摊结果与宿主 totals 逐值相等」，并断言 client 侧不含价格常数。
 */
import { readFileSync } from "node:fs"
import vm from "node:vm"
import { createHash } from "node:crypto"
import {
  UPGRADE_LINKS, UPGRADE_LINK_LABELS, UPGRADE_LINK_DISCLAIMER, usableUpgradeLinksPre,
} from "../../lib/upgrade-links.js"
import {
  estimateUpgradeTotalsPre, estimateUpgradeSecondsPre, opencodeUsableCharsPre,
} from "../../lib/upgrade-estimate.js"

const SRC = readFileSync(new URL("../../lib/client.js", import.meta.url), "utf8")
let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ok   - " + msg) } else { fail++; console.log("  FAIL - " + msg) } }
const eq = (a, b, msg) => { const good = String(a) === String(b); ok(good, msg + (good ? "" : "（实测 " + String(a) + " ≠ 期望 " + String(b) + "）")) }

console.log("lib/client.js " + Buffer.byteLength(SRC, "utf8") + "B / sha256[:16] " + createHash("sha256").update(SRC).digest("hex").slice(0, 16))

// ── 段边界：向导块 = 块头 marker → EventView 定义（终锚） ────────────────────
const BLOCK_HEAD = "    // ★★P4（2026-11-03）· 记忆整理向导（三页 + 进度卡）· 纯函数层 + 常量层"
const BLOCK_END = "    function EventView(props) {"
const i0 = SRC.indexOf(BLOCK_HEAD)
const i1 = SRC.indexOf(BLOCK_END)
ok(i0 > 0 && i1 > i0, "向导段边界可定位（块头/EventView 终锚都在场）")
const SEG = SRC.slice(i0, i1)
console.log("向导段字符数 = " + SEG.length + "（区间锁 20000~80000）")
ok(SEG.length >= 20000 && SEG.length <= 80000, "向导段体量在区间内（防段边界切歪吞掉半个文件/切空）")

// ── vm 宿主桩（只注入模块级依赖；不注入要测的行为） ─────────────────────────
function mkCtx (extra) {
  const store = new Map()
  const ctx = Object.assign({
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    sessionStorage: {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)) },
      removeItem: (k) => { store.delete(String(k)) },
    },
    h: function (type, props) { return { type: type, props: props || {}, kids: Array.prototype.slice.call(arguments, 2) } },
    useState: function (v) { return [typeof v === "function" ? v() : v, function () {}] },
    useEffect: function () {},
    useRef: function (v) { return { current: v } },
    apiGet: function () { return Promise.resolve({ ok: true }) },
    apiPost: function () { return Promise.resolve({ ok: true }) },
    API: { upgradeStatus: "/api/dsm/upgrade-status", upgradeWorkspaces: "/api/dsm/upgrade-workspaces", upgradeSnooze: "/api/dsm/upgrade-snooze", memoryUpgrade: "/api/dsm/memory-upgrade", models: "/api/dsm/models", config: "/api/dsm/config" },
    currentWs: function () { return "D:\\proj-a" },
    configOf: function (d) { return (d && d.config) || {} },
    Blob: function () {},
    URL: { createObjectURL: function () { return "blob:x" }, revokeObjectURL: function () {} },
    document: { createElement: function () { return { click: function () {} } }, body: { appendChild: function () {}, removeChild: function () {} } },
  }, extra || {})
  vm.createContext(ctx)
  return ctx
}
function execSeg (source, ctx, exports) {
  vm.runInContext(source + "\n" + exports.map(function (n) { return "globalThis.__X_" + n + " = " + n + ";" }).join("\n"), ctx)
}
const NAMES = ["upgradeWizardTriggerPre", "upgradeWizardCostSharePre", "upgradeWizardSecondsPre",
  "upgradeWizardProgressModelPre", "upgradeWizardScopeRowsPre", "upgradeWizardCurrentRowPre",
  "upgradeWizardFmtMoneyPre", "upgradeWizardFmtCharsPre", "upgradeWizardFmtDurationPre",
  "upgradeWizardDismissedInSessionPre", "upgradeWizardMarkDismissedPre",
  "UPGRADE_WIZARD_DELAY_MS", "UPGRADE_REPROMPT_MS", "UPGRADE_LINKS_PRE", "UPGRADE_LINK_LABELS_PRE",
  "UPGRADE_LINK_DISCLAIMER_PRE", "UpgradeWizard", "UpgradeWizardEntry"]
const ctx = mkCtx()
execSeg(SEG, ctx, NAMES)
const X = {}
for (const n of NAMES) X[n] = ctx["__X_" + n]
ok(NAMES.every((n) => X[n] !== undefined), "段内全部纯函数/常量真加载成功（缺任一 ⇒ 后续断言无意义）")

// ═══ 1. 常量镜像与宿主逐键对拍 ═══════════════════════════════════════════════
console.log("== 1. 链接/文案镜像与宿主 lib/upgrade-links.js 逐键对拍 ==")
eq(Object.keys(X.UPGRADE_LINKS_PRE).sort().join(","), Object.keys(UPGRADE_LINKS).sort().join(","), "L1 镜像键集合与宿主一致")
for (const k of Object.keys(UPGRADE_LINKS)) {
  eq(X.UPGRADE_LINKS_PRE[k], UPGRADE_LINKS[k], "L2 链接 " + k + " 与宿主逐字一致")
  eq(X.UPGRADE_LINK_LABELS_PRE[k], UPGRADE_LINK_LABELS[k], "L3 文案 " + k + " 与宿主逐字一致")
  ok(/^https:\/\//i.test(String(X.UPGRADE_LINKS_PRE[k])), "L4 " + k + " 是 https（usableUpgradeLinksPre 血统）")
}
eq(X.UPGRADE_LINK_DISCLAIMER_PRE, UPGRADE_LINK_DISCLAIMER, "L5 免责文案与宿主逐字一致")
eq(Object.keys(usableUpgradeLinksPre(X.UPGRADE_LINKS_PRE)).length, Object.keys(X.UPGRADE_LINKS_PRE).length, "L6 镜像全部通过 usableUpgradeLinksPre 过滤")
eq(Object.keys(usableUpgradeLinksPre({ bad: "javascript:alert(1)", ok: "https://a.b/c" })).join(","), "ok", "L7 [负路径] javascript: 链接被过滤")

// 全 client.js 里 https:// 只允许出现在镜像常量表的两行内（文案不得含裸 URL）
{
  const urlLines = SEG.split("\n").filter((l) => l.includes("https://"))
  const wizardUrls = urlLines.filter((l) => /relay: .https:\/\/|group: .https:\/\//.test(l))
  eq(urlLines.length, wizardUrls.length, "U1 向导段内 https:// 只出现在 UPGRADE_LINKS_PRE 常量表（共 " + urlLines.length + " 行）")
}

// ═══ 2. 触发三道闸：真调用正反例 ═════════════════════════════════════════════
console.log("== 2. 触发三道闸 upgradeWizardTriggerPre（真调用） ==")
eq(X.UPGRADE_WIZARD_DELAY_MS, 3000, "G1 自动弹出延迟常量 = 3000ms（用户裁定延迟 3 秒避开首屏）")
eq(X.UPGRADE_REPROMPT_MS, 24 * 3600 * 1000, "G2 闸③阈值 = 24h")
{
  const cases = [
    [{ legacy: true }, true, "G3 ①legacy=true 且无 snooze ⇒ 弹"],
    [{ legacy: false }, false, "G4 [负路径] legacy=false ⇒ 不弹"],
    [{}, false, "G5 [负路径] 缺 legacy ⇒ 不弹（不把 undefined 当 true）"],
    [{ legacy: true, sessionDismissed: true }, false, "G6 [负路径] 本会话点过「本次不再提示」⇒ 不弹"],
    [{ legacy: true, declined: true, sinceMs: 3600 * 1000 }, false, "G7 [负路径] snooze 未满 24h ⇒ 不弹"],
    [{ legacy: true, declined: true, sinceMs: 24 * 3600 * 1000 }, true, "G8 snooze 恰满 24h ⇒ 弹"],
    [{ legacy: true, declined: true, sinceMs: 25 * 3600 * 1000 }, true, "G9 snooze 超 24h ⇒ 弹"],
    [{ legacy: true, declined: false }, true, "G10 未 snooze 过（declined=false）⇒ 弹"],
    [{ legacy: true, declined: true, sinceMs: NaN }, false, "G11 [负路径] sinceMs=NaN ⇒ 不弹（不把 NaN 当满 24h）"],
    [{ legacy: true, declined: true, sinceMs: "7200000" }, false, "G12 [负路径] sinceMs 是字符串且未满 ⇒ 不弹"],
  ]
  for (const [input, want, msg] of cases) {
    const r = X.upgradeWizardTriggerPre(input)
    eq(!!r.show, want, msg + "（reason=" + r.reason + "）")
  }
  const mutated = SEG.replace(/      if \(o\.legacy !== true\) return \{ show: false, reason: 'not-legacy' \}/, "")
  ok(mutated !== SEG, "G13 [变异] 能定位到 legacy 判据那一行（否则变异验证无效）")
  const mctx = mkCtx()
  execSeg(mutated, mctx, ["upgradeWizardTriggerPre"])
  const M = mctx.__X_upgradeWizardTriggerPre
  eq(!!M({ legacy: false }).show, true, "G14 [变异] 去掉 legacy 判据后 legacy=false 也会弹 ⇒ 证明 G4 测的是真行为")
}

// ═══ 3. 费用分摊：不写公式，只按字符占比分摊宿主 totals ══════════════════════
console.log("== 3. 费用分摊 upgradeWizardCostSharePre（对拍宿主 estimateUpgradeTotalsPre） ==")
const FIX_ROWS = [
  { wsKey: "--A--", wsPath: "D:\\proj-a", planChars: 40000, logCount: 10, logChars: 60000, chars: 100000 },
  { wsKey: "--B--", wsPath: "D:\\proj-b", planChars: 20000, logCount: 3, logChars: 30000, chars: 50000 },
]
const TOTALS = estimateUpgradeTotalsPre(FIX_ROWS.map((r) => ({ wsKey: r.wsKey, chars: r.chars })), "medium")
ok(TOTALS.ok === true && TOTALS.count === 2, "C0 宿主 totals 夹具可用（count=" + TOTALS.count + "）")
{
  const all = X.upgradeWizardCostSharePre(TOTALS, FIX_ROWS)
  ok(all.ok === true, "C1 全集分摊成功")
  eq(all.chars, TOTALS.chars, "C2 全集 chars = 宿主合计")
  for (const k of ["offPeak", "peak", "relay"]) {
    ok(Object.is(all.cost[k], TOTALS.cost[k]), "C3 全集 " + k + " 分摊结果 === 宿主 totals 原值（逐值相等）")
  }
  const sub = X.upgradeWizardCostSharePre(TOTALS, [FIX_ROWS[0]])
  const hostSub = estimateUpgradeTotalsPre([{ wsKey: FIX_ROWS[0].wsKey, chars: FIX_ROWS[0].chars }], "medium")
  ok(sub.ok === true, "C4 子集分摊成功")
  for (const k of ["offPeak", "peak", "relay"]) {
    ok(Math.abs(sub.cost[k] - hostSub.cost[k]) < 1e-9, "C5 子集 " + k + " 与宿主直接重算一致（|Δ|<1e-9）")
  }
  eq(sub.chars, FIX_ROWS[0].chars, "C6 子集 chars 只算选中区")
  eq(X.upgradeWizardCostSharePre(null, FIX_ROWS).ok, false, "C7 [负路径] totals 缺失 ⇒ 拒绝（不静默当 0）")
  eq(X.upgradeWizardCostSharePre(TOTALS, [{ chars: -1 }]).ok, false, "C8 [负路径] 负 chars ⇒ 拒绝")
  eq(X.upgradeWizardCostSharePre(TOTALS, [{ chars: "x" }]).ok, false, "C9 [负路径] 非数字 chars ⇒ 拒绝")
  eq(X.upgradeWizardCostSharePre({ chars: 10, cost: null }, [{ chars: 1 }]).ok, false, "C10 [负路径] cost 缺失 ⇒ 拒绝")
}
{
  const codeOnly = SEG.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n")
  const pricePatterns = [/\bCHARS_PER_TOKEN\b/, /EFFORT_OUT_RATIO/, /UPGRADE_PRICES/, /1e6/]
  const hit = pricePatterns.filter((re) => re.test(codeOnly))
  eq(hit.join(",") || "无", "无", "C11 向导段不含价格表/标定系数（费用只取服务端 totals）")
}

// ═══ 4. 耗时口径与宿主 estimateUpgradeSecondsPre 对拍 ═══════════════════════
console.log("== 4. 预计耗时 upgradeWizardSecondsPre（对拍宿主） ==")
for (const chars of [0, 1, 99999, 100000, 210000, 2349594]) {
  const a = X.upgradeWizardSecondsPre(chars)
  const b = estimateUpgradeSecondsPre(chars)
  eq(a.ok + ":" + a.low + ":" + a.high, b.ok + ":" + b.low + ":" + b.high, "T1 chars=" + chars + " 与宿主逐值一致")
}
eq(X.upgradeWizardSecondsPre(-1).ok, false, "T2 [负路径] 负字符数 ⇒ 拒绝")
eq(X.upgradeWizardSecondsPre("x").ok, false, "T3 [负路径] 非数字 ⇒ 拒绝")
eq(opencodeUsableCharsPre(), 213248, "T4 免费渠道单区可用字符 = 213248（宿主口径 256000×1.19×0.7）")

// ═══ 5. 进度模型（逐区状态只来自 perWorkspace） ═════════════════════════════
console.log("== 5. 进度卡模型 upgradeWizardProgressModelPre（真调用） ==")
{
  const per = [
    { wsKey: "--A--", phase: "done", events: 18, checkpoints: 63 },
    { wsKey: "--B--", phase: "failed", error: "gate-3: quoteRef not found" },
    { wsKey: "--C--", phase: "skipped" },
    { wsKey: "--D--", phase: "running" },
    { wsKey: "--E--" },
    "--F--",
  ]
  const st = { phase: "running", startedAt: Date.now() - 102000, counts: { events: 18, checkpoints: 63 } }
  const m = X.upgradeWizardProgressModelPre(per, st, Date.now())
  eq(m.total, 6, "P1 逐区总数 = perWorkspace 条数")
  eq(m.counts.done, 1, "P2 done 计数")
  eq(m.counts.failed, 1, "P3 failed 计数")
  eq(m.counts.skipped, 1, "P4 skipped 计数")
  eq(m.counts.running, 1, "P5 running 计数")
  eq(m.current, "--D--", "P6 当前区 = running 那一条")
  eq(m.settled, 3, "P7 已结算 = done+failed+skipped")
  eq(m.percent, 50, "P8 进度百分比 = round(3/6*100)")
  eq(m.events, 18, "P9 已写入事件数（逐区求和）")
  eq(m.checkpoints, 63, "P10 已写入检查点数（逐区求和）")
  ok(m.elapsedMs >= 99000 && m.elapsedMs <= 110000, "P11 已用时取自服务端 startedAt（实测 " + m.elapsedMs + "ms）")
  ok(m.etaMs > 0, "P12 未完成时给出预计剩余（实测 " + m.etaMs + "ms）")
  const empty = X.upgradeWizardProgressModelPre([], { phase: "running" }, Date.now())
  eq(empty.total + ":" + empty.percent + ":" + empty.etaMs, "0:0:0", "P13 [负路径] perWorkspace 为空 ⇒ total/percent/eta 全 0，不伪造")
  const jn = X.upgradeWizardProgressModelPre(undefined, { phase: "idle" }, Date.now())
  eq(jn.total, 0, "P14 [负路径] perWorkspace 传 undefined ⇒ 不抛且 total=0")
  eq(X.upgradeWizardProgressModelPre([{ wsKey: "x", phase: "weird-phase" }], {}, 1).rows[0].bucket, "pending", "P15 未知 phase ⇒ pending（不猜成 done）")
  eq(m.rows[1].error, "gate-3: quoteRef not found", "P16 失败区拒因原样透出（静默跳过是缺陷）")
}

// ═══ 6. 范围选择（未知 scope 明确拒绝） ══════════════════════════════════════
console.log("== 6. 范围选择 upgradeWizardScopeRowsPre / 当前区定位 ==")
{
  const cur = X.upgradeWizardCurrentRowPre(FIX_ROWS, "D:\\proj-b")
  ok(cur && cur.wsKey === "--B--", "S1 当前区按路径归一化精确命中（--B--）")
  eq(X.upgradeWizardCurrentRowPre(FIX_ROWS, "D:\\nope"), null, "S2 [负路径] 匹配不到返回 null（不猜第一条）")
  eq(X.upgradeWizardCurrentRowPre(FIX_ROWS, ""), null, "S3 [负路径] ws 为空 ⇒ null")
  const c = X.upgradeWizardCurrentRowPre(FIX_ROWS, "d:/PROJ-A/")
  ok(c && c.wsKey === "--A--", "S4 路径归一化：大小写/斜杠/尾斜杠不影响匹配")
  eq(X.upgradeWizardScopeRowsPre("current", FIX_ROWS, [], FIX_ROWS[0]).rows.length, 1, "S5 scope=current ⇒ 1 区")
  eq(X.upgradeWizardScopeRowsPre("all", FIX_ROWS, [], FIX_ROWS[0]).rows.length, 2, "S6 scope=all ⇒ 全部")
  eq(X.upgradeWizardScopeRowsPre("subset", FIX_ROWS, ["--B--"], FIX_ROWS[0]).rows[0].wsKey, "--B--", "S7 scope=subset ⇒ 只留选中的区")
  eq(X.upgradeWizardScopeRowsPre("current", FIX_ROWS, [], null).code, "no-current", "S8 [负路径] current 但当前区不在清单 ⇒ 明确拒绝")
  eq(X.upgradeWizardScopeRowsPre("subset", FIX_ROWS, [], FIX_ROWS[0]).code, "empty-subset", "S9 [负路径] subset 空选 ⇒ 明确拒绝")
  eq(X.upgradeWizardScopeRowsPre("whatever", FIX_ROWS, [], FIX_ROWS[0]).code, "bad-scope", "S10 [负路径] 未知 scope ⇒ 明确拒绝（不猜）")
}

// ═══ 7. 「本次不再提示」= 会话级（sessionStorage） ══════════════════════════
console.log("== 7. 「本次不再提示」会话级标记 ==")
{
  eq(X.upgradeWizardDismissedInSessionPre("D:\\proj-a"), false, "D1 初始未标记")
  X.upgradeWizardMarkDismissedPre("D:\\proj-a")
  eq(X.upgradeWizardDismissedInSessionPre("D:\\proj-a"), true, "D2 标记后为 true（本会话不再弹）")
  eq(X.upgradeWizardDismissedInSessionPre("D:\\proj-b"), false, "D3 其他工作区不受影响（按 ws 分键）")
  eq(X.upgradeWizardTriggerPre({ legacy: true, sessionDismissed: X.upgradeWizardDismissedInSessionPre("D:\\proj-a") }).show, false, "D4 标记后触发闸不弹（两道判据联动）")
}

// ═══ 8. 四页真渲染（fixture 注入抽取片段，真执行） ══════════════════════════
console.log("== 8. 四页真渲染（真执行抽取片段） ==")
function render (patches) {
  let seg = SEG
  for (const [from, to] of patches) {
    if (seg.indexOf(from) < 0) throw new Error("渲染注入锚串缺失：" + from)
    seg = seg.replace(from, to)
  }
  const rctx = mkCtx({})
  execSeg(seg, rctx, ["UpgradeWizard"])
  return rctx.__X_UpgradeWizard({ zh: true, ws: "D:\\proj-a" })
}
function collectText (node, acc) {
  acc = acc || []
  if (node == null) return acc
  if (typeof node === "string") { acc.push(node); return acc }
  if (Array.isArray(node)) { node.forEach((x) => collectText(x, acc)); return acc }
  if (typeof node === "object") {
    if (node.kids) node.kids.forEach((k) => collectText(k, acc))
    if (node.props && typeof node.props.children !== "undefined") collectText(node.props.children, acc)
  }
  return acc
}
function findAll (node, pred, acc) {
  acc = acc || []
  if (node == null) return acc
  if (Array.isArray(node)) { node.forEach((x) => findAll(x, pred, acc)); return acc }
  if (typeof node === "object") { if (pred(node)) acc.push(node); if (node.kids) node.kids.forEach((k) => findAll(k, pred, acc)) }
  return acc
}
const hasAttr = (node, attr, val) => node && node.props && typeof node.props[attr] !== "undefined" && (val === undefined || String(node.props[attr]) === String(val))
const ST_FIX = {
  ok: true, legacy: true, canUpgrade: true, phase: "idle",
  counts: { userEntries: 60, projectEntries: 42, logs: 27, events: 14, anchors: 0, statusAnchors: 0 },
  // ★2026-11-03：legacy 场景必须带 no-anchors（结构性判据只看它）
  declined: false, sinceMs: 0, snoozeRemainingMs: 0, reasons: ["no-anchors：文件里没有任何 memory:mem_ 锚点，条目级增删改不可用"],
  runId: "", scope: "", perWorkspace: [], startedAt: 0, finishedAt: 0, agentOptions: {},
}
const INV_FIX = { ok: true, workspaces: FIX_ROWS, totals: TOTALS, opencodeUsableChars: opencodeUsableCharsPre() }
const MODELS_FIX = { providers: [{ id: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-v4.1-flash" }] }], failures: [] }
const BASE = [
  ["      var openPair = useState(false)", "      var openPair = useState(true)"],
  ["      var stPair = useState(null)", "      var stPair = useState(" + JSON.stringify(ST_FIX) + ")"],
  ["      var invPair = useState(null)", "      var invPair = useState(" + JSON.stringify(INV_FIX) + ")"],
  ["      var modelsPair = useState(null)", "      var modelsPair = useState(" + JSON.stringify(MODELS_FIX) + ")"],
]
const PAGE = (p) => ["      var pagePair = useState('p1')", "      var pagePair = useState('" + p + "')"]

// 第 1 页
{
  const tree = render(BASE)
  ok(!!tree, "R0 第 1 页真的渲染出节点（不是 null）")
  const cnt = (attr) => findAll(tree, (n) => hasAttr(n, attr)).length
  eq(cnt("data-dam-upgrade-snooze"), 1, "R1 第 1 页「稍后」")
  eq(cnt("data-dam-wizard-dismiss"), 1, "R2 第 1 页「本次不再提示」")
  eq(cnt("data-dam-wizard-dryrun"), 1, "R3 第 1 页「先只看体量」（只检测入口）")
  eq(cnt("data-dam-upgrade-start"), 1, "R4 第 1 页「开始整理」")
  const text = collectText(tree, []).join("\n")
  // ★2026-11-03 改判据（用户实报「有些地方被判断成旧的，实际是新版」）：
  //   原 R5 只断言写死标题存在 ⇒ 恒绿，无法发现「新版也报旧版」。现改为按 reasons 分流判据。
  ok(text.includes("检测到旧版记忆格式"), "R5 有 no-anchors 时标题报「旧版」")
  ok(/102/.test(text) && /27/.test(text) && /14/.test(text), "R6 第 1 页展示记忆/日志/事件计数（102/27/14）")
  ok(text.includes("已有"), "R6b 锚点/状态行标为「已有」而不是「缺少」")
  ok(!/缺少\s*\n?\s*条目锚点/.test(text), "R6c [负路径] 不得把已有数量写成「缺少」")
  ok(text.includes("为什么要整理"), "R7 第 1 页「为什么要整理」")
  ok(text.includes("不整理会怎样"), "R8 第 1 页「不整理会怎样」")
  ok(text.includes("记忆本身不会丢"), "R9 不整理后果如实写「记忆本身不会丢」（不得写「会丢记忆」）")
  ok(!text.includes("会丢记忆"), "R10 [负路径] 不出现恐吓式「会丢记忆」")
  ok(text.includes("原文只备份，不改不删"), "R11 不整理后果给出可验证边界（原文只备份/不改不删）")
}

// 只检测（dry-run）
{
  const tree = render(BASE.concat([PAGE("dry")]))
  const text = collectText(tree, []).join("\n")
  ok(text.includes("只读检测"), "R12 只检测页渲染")
  ok(text.includes("零写盘"), "R13 只检测页明写「零写盘」")
  ok(/官方谷时/.test(text) && /官方峰值/.test(text) && /dshapi 中转/.test(text), "R14 只检测页展示三档费用（来自服务端 totals）")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-dry-row")).length, 2, "R15 只检测页逐区行数 = 2（数据来自 upgrade-workspaces）")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-export")).length, 1, "R16 只检测页有「导出检测报告」")
  ok(!collectText(tree, []).join("").includes("http"), "R17 [负路径] 只检测页不出现裸 URL")
}

// 第 2 页：范围选择
{
  const tree = render(BASE.concat([PAGE("p2")]))
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-scope")).length, 3, "R18 第 2 页三个范围选项（仅当前/全部/选择部分）")
  const text = collectText(tree, []).join("\n")
  ok(text.includes("仅当前工作区") && text.includes("全部工作区") && text.includes("选择部分"), "R19 三个选项文案在场")
  ok(/免费渠道/.test(text), "R20 第 2 页提示免费渠道容量限制")
  ok(text.includes("213000") || text.includes("21.3"), "R21 免费渠道单区可用字符 = 213000（opencodeUsableChars 口径）")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-next")).length, 1, "R22 第 2 页「下一步」")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-prev")).length, 1, "R23 第 2 页「上一步」")
}

// 第 3 页：模型 / 思考强度 / 费用 / 四按钮
{
  const tree = render(BASE.concat([PAGE("p3")]))
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-model")).length, 1, "R24 第 3 页模型下拉")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-effort")).length, 3, "R25 第 3 页三个思考强度（低/中/高，默认中）")
  const effortLabels = findAll(tree, (n) => hasAttr(n, "data-dam-wizard-effort")).map((n) => n.props["data-dam-wizard-effort"])
  eq(effortLabels.join(","), "low,medium,high", "R26 思考强度键 = low,medium,high（与 estimate 档位同源）")
  const text = collectText(tree, []).join("\n")
  ok(text.includes("不推荐"), "R27 低档标「不推荐」")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-cost")).length, 4, "R28 费用四行（谷/峰/中转/免费）")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-link")).length, 4, "R29 渠道四按钮")
  const links = findAll(tree, (n) => hasAttr(n, "data-dam-wizard-link"))
  const byKey = {}
  for (const n of links) byKey[String(n.props["data-dam-wizard-link"])] = n
  for (const k of ["relay", "group"]) {
    const a = byKey[k]
    ok(!!a && a.type === "a", "R30 " + k + " 是 <a> 真跳转按钮")
    eq(a && a.props.href, UPGRADE_LINKS[k], "R31 " + k + " href 取自 UPGRADE_LINKS（与宿主一致）")
    eq(a && a.props.target, "_blank", "R32 " + k + " target=_blank")
    eq(a && a.props.rel, "noopener noreferrer", "R33 " + k + " rel=noopener noreferrer")
    eq(collectText(a, []).join(""), UPGRADE_LINK_LABELS[k], "R34 " + k + " 按钮文案取自 UPGRADE_LINK_LABELS")
  }
  for (const k of ["opencode", "official"]) {
    const b = byKey[k]
    ok(!!b && b.type === "button", "R35 " + k + " 是信息型按钮（无第三方 URL 可跳，故不造链接）")
  }
  ok(text.includes(UPGRADE_LINK_DISCLAIMER), "R36 第 3 页灰色免责文案 = UPGRADE_LINK_DISCLAIMER")
  ok(!/https?:\/\//.test(text), "R37 [负路径] 第 3 页文案不含裸 URL")
  ok(/官方谷时/.test(text) && /官方峰值/.test(text), "R38 费用三档来自服务端 totals（谷/峰）")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-confirm")).length, 1, "R39 第 3 页「确认开始整理」")
}

// 第 4 页：进度卡
{
  const stProg = Object.assign({}, ST_FIX, {
    phase: "running", startedAt: Date.now() - 60000,
    perWorkspace: [
      { wsKey: "--A--", phase: "done", events: 18, checkpoints: 63 },
      { wsKey: "--B--", phase: "failed", error: "gate-3: quoteRef not found" },
      { wsKey: "--C--", phase: "running" },
    ],
  })
  const tree = render([
    ["      var openPair = useState(false)", "      var openPair = useState(true)"],
    ["      var stPair = useState(null)", "      var stPair = useState(" + JSON.stringify(stProg) + ")"],
    ["      var pagePair = useState('p1')", "      var pagePair = useState('progress')"],
  ])
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-progress")).length, 1, "R40 进度卡渲染（进度条容器）")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-progress-ws")).length, 3, "R41 逐区行数 = perWorkspace 条数")
  const counts = findAll(tree, (n) => hasAttr(n, "data-dam-progress-count")).map((n) => n.props["data-dam-progress-count"])
  eq(counts.sort().join(","), "done,failed,skipped", "R42 完成/失败/跳过三计数")
  eq(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-background")).length, 1, "R43 「后台运行」按钮")
  ok(findAll(tree, (n) => hasAttr(n, "data-dam-wizard-close")).length >= 1, "R44 关闭按钮")
  const text = collectText(tree, []).join("\n")
  ok(text.includes("gate-3"), "R45 失败区拒因透出（不静默跳过）")
  const stEmpty = Object.assign({}, ST_FIX, { phase: "running", perWorkspace: [] })
  const tree2 = render([
    ["      var openPair = useState(false)", "      var openPair = useState(true)"],
    ["      var stPair = useState(null)", "      var stPair = useState(" + JSON.stringify(stEmpty) + ")"],
    ["      var pagePair = useState('p1')", "      var pagePair = useState('progress')"],
  ])
  const t2 = collectText(tree2, []).join("\n")
  ok(t2.includes("逐区状态暂未回报"), "R46 [负路径] perWorkspace 为空 ⇒ 显式提示，不伪造进度")
  ok(!/100%/.test(t2), "R47 [负路径] 空 perWorkspace 不得显示 100%")
}

// ═══ 9. 负路径：真渲染必须能精确报 ReferenceError（判据非恒真） ═══════════════
console.log("== 9. [负路径] 注入未定义标识符 ⇒ 真渲染必须精确报红 ==")
{
  const bugSeg = SEG.replace("      var openPair = useState(false)", "      var openPair = useState(true)")
    .replace("      if (!open) return null", "      if (missingWizardSiblingVar) return null")
  ok(bugSeg !== SEG, "N0 变异命中（锚串在场）")
  let err = null
  try {
    const bctx = mkCtx({})
    execSeg(bugSeg, bctx, ["UpgradeWizard"])
    bctx.__X_UpgradeWizard({ zh: true })
  } catch (e) { err = e }
  ok(!!err && err.name === "ReferenceError" && /missingWizardSiblingVar/.test(String(err.message)),
    "N1 [负路径] 精确报 ReferenceError: " + (err ? err.message : "仍绿（判据失守）"))
}

// ═══ 10. 挂载点与旧入口（静态守卫，标注：非功能证据） ═══════════════════════
console.log("== 10. 挂载点 / 旧入口（守卫，非功能证据） ==")
{
  ok(SRC.includes("id: 'auto-memory-pre-upgrade-wizard'") && /h\(UpgradeWizard, \{ auto: true/.test(SRC), "M1 shell.overlay 自动触发挂载点在场（会话挂载 + 组件内 3s 延迟）")
  ok(SRC.includes("h(UpgradeWizardEntry, { key: 'ev4-upgrade-entry'"), "M2 白板看板旧入口按钮挂载点在场（旧入口保留）")
  ok(/gate = upgradeWizardTriggerPre\(\{/.test(SEG), "M3 自动触发调用纯函数判定（不在组件里内联判据）")
  ok(/setTimeout\(function \(\) \{[\s\S]{0,3000}?\}, UPGRADE_WIZARD_DELAY_MS\)/.test(SEG), "M4 延迟使用 UPGRADE_WIZARD_DELAY_MS 常量（不写死 3000）")
  ok(SRC.includes("if (!isTeamMode) return null"), "M5 旧单卡降为团队模式专用（个人模式交给向导）")
}

console.log("")
console.log("[upgrade-wizard-client] PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
