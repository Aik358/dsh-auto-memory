#!/usr/bin/env node
/**
 * smoke-test-batch3-bd-adapter.mjs —— B3-BD-AD1 验收（Lead 硬门①–⑥）
 *
 * 硬门清单：
 *  ① legacy 入 HANDOFF_VIEW_TIERS，原 tier 传入不改名；白板 legacy 独立兼容 + memLegacy 截流
 *  ② _legacySlim 优先于 profile：任何 tier（含 human_full）+ memLegacy=true 都必须 7节/2400/800
 *  ③ run_full/hang_compensate 走核心节（不扩大）；human_full/handoff_carry/post_compact 全文；run_slim 不投
 *  ④ 账本 legacy 保留四段加权预算；full 选择后仍必须 weightedTrim；FM 负责最终预算
 *  ⑤ 移除 BD 对 _isFullTier 依赖；空 catch 禁止吞档位错误，异常留 degradation 且走同档安全投影
 *  ⑥ 覆盖 8 档 × memLegacy、冲突 profile/tier、异常、重复请求、入口实参 + 最终字符验证
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }

const ph = await import(pathToFileURL(path.join(REPO, "lib/injection/project-handoff.js")).href);
const { parseHandoffLedgerPre, weightedTrimHandoffLedgerPre } = await import(pathToFileURL(path.join(REPO, "lib/handoff-anchor.js")).href);
const CR = String.fromCharCode(13);
const idx = fs.readFileSync(path.join(REPO, "lib", "index.js"), "utf8").split(CR).join("");

// ══════════ ① legacy 入表 ══════════
{
  const T = ph.HANDOFF_VIEW_TIERS;
  ok(T.includes("legacy"), "★★[①] legacy 已入 HANDOFF_VIEW_TIERS", T.length + " 项");
  for (const t of ["human_full","human_slim","run_full","run_slim","post_compact","handoff_carry","hang_compensate","legacy"]) {
    ok(T.includes(t), "★★[①] 生产档位 " + t + " 合法");
  }
  let bad = null;
  for (const t of T) { try { ph.projectHandoffPre({ planText: "## a\nb", latestHandoffText: "", tier: t, policy: {} }) } catch (e) { bad = t } }
  ok(bad === null, "★★[①] 表内每档都可真调用（legacy 不再抛 INVALID_ENUM）", bad || "0 抛错");
}

// ══════════ ⑤ 移除 _isFullTier 依赖 ══════════
{
  const blk = idx.slice(idx.indexOf("const _planPart = (() => {"), idx.indexOf("if (planPart) pushPart"));
  ok(blk.indexOf("_isFullTier") < 0, "★★[⑤] 白板块**不再引用** _isFullTier");
  const lb = idx.slice(idx.indexOf("const ledgerPart = (() => {"), idx.indexOf("if (ledgerPart) pushPart"));
  ok(lb.indexOf("_isFullTier") < 0, "★★[⑤] 账本块**不再引用** _isFullTier");
  ok(idx.indexOf("const _LEDGER_FULL_TIERS = [") >= 0, "★★[⑤] 账本有独立显式 profile 映射表");
  ok(blk.indexOf("planSpecForTierPre") >= 0, "★★[⑤] 白板严格锚 planSpecForTierPre");
}

// ══════════ ②③ 白板 8 档 × memLegacy 矩阵 ══════════
const CORE7 = ["最新实况","当前目标","载体分工","当前状态","近期进展","关键约束","待办"];
const PLAN_BIG = ["## 当前状态","A".repeat(600),"## 近期进展","B".repeat(600),"## 关键约束","C".repeat(600),"## 待办","D".repeat(600),"## 最新实况","E".repeat(600),"## 当前目标","F".repeat(600),"## 载体分工","G".repeat(600)].join("\n");
const _T = {HUMAN_FULL:"human_full",HUMAN_SLIM:"human_slim",RUN_FULL:"run_full",RUN_SLIM:"run_slim",POST_COMPACT:"post_compact",HANDOFF_CARRY:"handoff_carry",HANG_COMPENSATE:"hang_compensate",LEGACY:"legacy"};
const mP = idx.match(/const _planPart = \(\(\) => \{[\s\S]*?\n      \}\)\(\)/);
ok(!!mP, "★[②③] 能抽取生产 planPart 块");
function runPlan(tier, legacySlim, budget) {
  const fn = new Function("projectHandoffPre","_tier","cfg","_legacySlim","_LEGACY_CORE","_planSectionMax","_planRaw","_planSections","_planBudget","_T","_truncatePlanBySectionsInline","truncatePlanByPriority","truncateLinesBounded","_bdDegradations", mP[0] + "\nreturn {p:_planPart,d:_bdDegradations}");
  const d = [];
  const isFull = ["human_full","handoff_carry","post_compact"].includes(tier);
  const r = fn(ph.projectHandoffPre, tier, { handoffPlanSectionMax: 2000 }, legacySlim, CORE7, 2000, PLAN_BIG, isFull ? null : CORE7, budget, _T, (t,w,c)=>null, (t,b)=>t.slice(0,b), (t,b)=>t.slice(0,b), d);
  return { len: r.p.length, degs: r.d };
}
const TIERS8 = ["human_full","human_slim","run_full","run_slim","post_compact","handoff_carry","hang_compensate","legacy"];
for (const t of TIERS8) {
  for (const ls of [false, true]) {
    const budget = ls ? 2400 : (["human_full","handoff_carry","post_compact"].includes(t) ? 8000 : 3000);
    const r = runPlan(t, ls, budget);
    ok(r.len <= budget, "★★[②③] " + t + " × legacySlim=" + ls + " 不超预算", r.len + " <= " + budget);
  }
}
{
  // ★硬门②：human_full + memLegacy=true 必须被压到 2400（full 不得绕过）
  const a = runPlan("human_full", false, 8000);
  const b = runPlan("human_full", true, 2400);
  ok(a.len > b.len, "★★[②] human_full 在 memLegacy=true 时被截流（full 不得绕过）", a.len + " -> " + b.len);
  ok(b.len <= 2400, "★★[②] memLegacy 截流上限 2400 生效", String(b.len));
}
{
  // ★硬门③：run_slim 不投白板
  ok(runPlan("run_slim", false, 3000).len === 0, "★★[③] run_slim **不投白板**");
  // run_full/hang_compensate 走核心节，不等于完全文
  const rf = runPlan("run_full", false, 3000);
  const hf = runPlan("human_full", false, 8000);
  ok(rf.len < hf.len, "★★[③] run_full 走核心节（**不扩大**为全文档）", rf.len + " < " + hf.len);
  ok(runPlan("hang_compensate", false, 3000).len === rf.len, "★★[③] hang_compensate 与 run_full 同为核心节");
  ok(runPlan("legacy", false, 3000).len === rf.len, "★★[①] legacy 走核心节（= run_full 同策略）");
}

// ══════════ ④ 账本 8 档映射 ══════════
const LEDGER4 = ["# 账本","","## 任务状态","type:state","状态E","","## 目标","type:goal","目标F","","## 已试方案与失败原因","type:dead-end","失败G","","## 进度与下一步","type:progress","下一步H"].join("\n");
const ALL4 = ["type:goal","type:state","type:dead-end","type:progress"];
const mL = idx.match(/const ledgerPart = \(\(\) => \{[\s\S]*?\n      \}\)\(\)/);
ok(!!mL, "★[④] 能抽取生产 ledgerPart 块");
function runLedger(tier) {
  const fn = new Function("projectHandoffPre","_tier","_ledgerRaw","_ledgerBudget","parseHandoffLedgerPre","weightedTrimHandoffLedgerPre","truncateLinesBounded","_bdDegradations", mL[0] + "\nreturn {p:ledgerPart,d:_bdDegradations}");
  const d = [];
  const r = fn(ph.projectHandoffPre, tier, LEDGER4, 8000, parseHandoffLedgerPre, weightedTrimHandoffLedgerPre, (t, b) => t.slice(0, b), d);
  return { len: r.p.length, text: r.p, has: ALL4.filter((x) => r.p.indexOf(x) >= 0), degs: d };
}
// P1 R1 明确将 run_full 账本降为三段；其他 full 档仍逐项要求四段。
const FULL_LEDGER = ["human_full","post_compact","handoff_carry","hang_compensate","legacy"];
for (const t of FULL_LEDGER) {
  ok(runLedger(t).has.length === 4, "★★[④] " + t + " 账本保留四段（full 映射）");
}
for (const t of ["human_slim","run_full","run_slim"]) {
  const projected = runLedger(t);
  ok(projected.has.indexOf("type:state") < 0, "★★[④] " + t + " 账本省略 type:state（slim 映射）");
  ok(projected.has.length === 3 && ["type:goal","type:dead-end","type:progress"].every(tag => projected.has.includes(tag)),
    "★★[④/P1] " + t + " 三段完整：目标、失败原因、下一步");
  if (t === "run_full") ok(!projected.text.includes("任务状态"), "★★[R1负路径] run_full 不含任务状态标题或正文段");
}
ok(runLedger("human_full").has.length !== runLedger("human_slim").has.length, "★★[④] full/slim 两组可区分（判据非恒真）");

// ══════════ ⑤ 异常路径 ══════════
{
  const d = [];
  const fn = new Function("projectHandoffPre","_tier","cfg","_legacySlim","_LEGACY_CORE","_planSectionMax","_planRaw","_planSections","_planBudget","_T","_truncatePlanBySectionsInline","truncatePlanByPriority","truncateLinesBounded","_bdDegradations", mP[0] + "\nreturn {p:_planPart,d:_bdDegradations}");
  const boom = () => { throw new Error("simulated-plan-failure") };
  // ★修正：上一版把 _planBudget 传 8000（= 不截断），桩也是恒等 ⇒ 兜底自然返全文，测不出。
  //   真实语义：兜底必须受 _planBudget 约束 ⇒ 用 3000（瘦档真实预算）验证。
  const r = fn(boom, "human_full", { handoffPlanSectionMax: 2000 }, false, CORE7, 2000, PLAN_BIG, null, 3000, _T,
    (t,w,c)=>{ if(!Array.isArray(w)||!w.length) return null; const sg=t.split(/\n(?=## )/); const k=sg.filter(x=>{const ti=(x.split("\n")[0]||"").replace(/^#{2,3}\s+/,"");return w.some(y=>ti.indexOf(y)>=0)}); return k.join("\n\n"); },
    (t,b)=>t.slice(0,b), (t,b)=>t.slice(0,b), d);
  ok(r.d.length === 1 && r.d[0].code === "handoff-projection-failed", "★★[⑤] 白板抛错**留 degradation**（不空吞）", r.d.length + " 条");
  ok(r.p.length > 0, "★★[⑤] 白板抛错**不得返回空**（必须给同档安全投影）", r.p.length + " 字符");
  ok(r.p.length <= 3000, "★★[⑤] 白板抛错仍受 _planBudget 约束（非无限全文）", r.p.length + " <= 3000");
  ok(r.p.length < PLAN_BIG.length, "★★[⑤] 白板抛错**未放大为全文**", r.p.length + " < " + PLAN_BIG.length);
}
{
  const d = [];
  const fn = new Function("projectHandoffPre","_tier","_ledgerRaw","_ledgerBudget","parseHandoffLedgerPre","weightedTrimHandoffLedgerPre","truncateLinesBounded","_bdDegradations", mL[0] + "\nreturn {p:ledgerPart,d:_bdDegradations}");
  const boom = () => { throw new Error("simulated-ledger-failure") };
  const r = fn(boom, "human_full", LEDGER4, 8000, parseHandoffLedgerPre, weightedTrimHandoffLedgerPre, (t, b) => t.slice(0, b), d);
  ok(r.d.length === 1, "★★[⑤] 账本抛错**留 degradation**", r.d.length + " 条");
  ok(r.p === "", "★★[⑤/R-I] 账本投影失败显式省略，不回落原文", String(r.p.length));
}

// ══════════ ⑥ 冲突 profile/tier + 重复请求 ══════════
{
  const a = ph.projectHandoffPre({ planText: PLAN_BIG, latestHandoffText: LEDGER4, tier: "slim", policy: { profile: "full" } });
  ok(a.view.profile === "full", "★★[⑥] tier=slim + profile=full ⇒ **policy.profile 优先**", a.view.profile);
  const b = ph.projectHandoffPre({ planText: PLAN_BIG, latestHandoffText: LEDGER4, tier: "human_full", policy: { profile: "slim" } });
  ok(b.view.profile === "slim", "★★[⑥] tier=human_full + profile=slim ⇒ policy 优先", b.view.profile);
}
{
  const x = runPlan("human_full", false, 8000);
  const y = runPlan("human_full", false, 8000);
  const z = runPlan("human_full", false, 8000);
  ok(x.len === y.len && y.len === z.len, "★★[⑥] 白板重复请求**不累积/不放大**", x.len + "/" + y.len + "/" + z.len);
  const l1 = runLedger("human_full"), l2 = runLedger("human_full");
  ok(l1.len === l2.len, "★★[⑥] 账本重复请求稳定", l1.len + "/" + l2.len);
}

// ══════════ ⑦ 真实 apply 与计数锁 ══════════
{
  const mod = await import(pathToFileURL(path.join(REPO, "lib/index.js")).href);
  const routes = [], sect = [], effects = [], tools = [];
  const store = new Map();
  const ctx = {
    effect(fn) { effects.push(fn); return () => {}; }, on() { return () => {}; },
    get(k) { return store.get(k); }, set(k, v) { store.set(k, v); },
    provide(k, v) { store.set(k, v); }, consume(k) { return store.get(k); },
    tools: { register(t) { tools.push(t); return () => {}; } },
    systemPrompt: { context: (fn) => { sect.push({ kind: "context", fn }); }, section: (a, b) => { sect.push({ kind: "section", fn: typeof a === "function" ? a : b }); } },
    webServer: { register: (r) => { routes.push(r && (r.path || r.method || "?")); return true; } },
    log() {}, logger: { info() {}, warn() {}, error() {}, debug() {} }, config: {},
  };
  let applied = false, err = null;
  try { await mod.apply(ctx); applied = true } catch (e) { err = String((e && e.message) || e) }
  ok(applied, "★★[⑦] 真实 apply(ctx) 无异常", err ? err.slice(0, 120) : "OK");
  // P1 新增唯一 preview 路由；工具与导出保持原数。
  ok(tools.length === 22 && routes.length === 87, "★★[⑦/P1] tools=22 / routes=87（新增 delivery-preview）", tools.length + "/" + routes.length);
  ok(Object.keys(mod).filter((k) => k !== "default").length === 41, "★★[⑦] 导出仍 41");
}

console.log("\n── B3-BD-AD1 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);
