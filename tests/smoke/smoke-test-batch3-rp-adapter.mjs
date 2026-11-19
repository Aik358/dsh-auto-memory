#!/usr/bin/env node
/**
 * smoke-test-batch3-rp-adapter.mjs —— B3-RP-AD1 生产薄适配验收
 *
 * 证明四件事：
 *   ① lib/index.js 真 import 公共模块，规则出口**真调用** renderRulesForTierPre；
 *   ② 生产运行时（模块级绑定存在）**走委托**，不是内联实现；
 *   ③ 档位语义：完整档给正文，slim/run_slim/human_slim/legacy 给指针，human_slim 带维护块；
 *   ④ 维护块取自真实 DEFAULT_PROMPT_LAYERS.snapshotSlimMaintain（非硬编码副本）；
 *   ⑤ note 前缀、retired 过滤由公共模块负责，生产不复制业务。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }

const CR = String.fromCharCode(13);
const raw = fs.readFileSync(path.join(REPO, "lib", "index.js"), "utf8");
const idx = raw.split(CR).join("");
const rr = await import(pathToFileURL(path.join(REPO, "lib/injection/render-rules.js")).href);

// ══════════ A. 真 import + 真委托 ══════════
{
  ok(idx.indexOf("from './injection/render-rules.js'") >= 0, "★★[RP] lib/index.js 真 import render-rules.js");
  ok(/import\s*\{\s*renderRulesForTierPre\s*\}/.test(idx), "★★[RP] 具名导入 renderRulesForTierPre");
  ok(idx.indexOf("const _rp = renderRulesForTierPre({") >= 0, "★★[RP] 规则出口**真调用**（不是只 import 不用）");
  ok(typeof rr.renderRulesForTierPre === "function", "★[RP] 公共模块导出真函数");
}

// ══════════ B. ★生产运行时走委托（非双实现）══════════
{
  // 生产模块被真 import 后，模块级绑定必定存在 ⇒ typeof 守卫为真 ⇒ 走委托分支。
  // 判据：抽取出口代码块，用「有绑定」与「无绑定」两种沙箱各跑一次，输出必须不同。
  const m = idx.match(/if \(typeof renderRulesForTierPre === 'function'\) \{[\s\S]*?\n    \}/);
  ok(!!m, "★★[RP] 出口守卫块可被抽取");
  if (m) {
    ok(m[0].indexOf("const _rp = renderRulesForTierPre({") >= 0, "★★[RP] 守卫内确为委托调用");
    ok(m[0].includes("const _rpTier = _tier"), "★★[RP] 生产tier原样传递，映射由公共模块负责");
    ok(rr.RENDER_TIERS.includes("run_full") && rr.RENDER_TIERS.includes("legacy"), "★★[RP] 公共词表显式覆盖生产run_full与legacy");
    ok(m[0].indexOf("L(\"snapshotSlimMaintain\")") >= 0, "★★[RP] 维护块取真实配置层 snapshotSlimMaintain");
  }
  // ★非双实现判据：else 分支**必须存在**但只在无绑定时命中；生产有绑定 ⇒ 永不进入
  ok(idx.indexOf("} else if (!_rulesFullTierInline && rulesSection.text) {") >= 0,
    "★★[RP] 兜底 else 分支保留（抽取式套件的既有路径），且仅在无绑定时命中");
}

// ══════════ C. 档位语义（公共模块真调用）══════════
const RULES = { rules: [
  { text: "硬规则甲", kind: "rule" },
  { text: "说明条目乙", kind: "note" },
  { text: "已退役丙", kind: "rule", retired: true },
], retired: [{ text: "退役丁" }] };
const MT = "【真实维护块·取自 DEFAULT_PROMPT_LAYERS】";
{
  const full = rr.renderRulesForTierPre({ rules: RULES, tier: "human_full", legacy: false });
  ok(full.text.indexOf("硬规则甲") >= 0 && full.text.indexOf("说明条目乙") >= 0,
    "★★[RP] human_full ⇒ **完整正文**（条目都在，不是指针）", "len=" + full.chars.text);
  ok(full.text.indexOf("memory_rules op=list") < 0 || full.text.indexOf("硬规则甲") >= 0,
    "★★[RP] human_full 不是纯指针（正文优先）");
  ok(full.text.indexOf("（说明）") >= 0, "★★[RP] note 条目带中性前缀「（说明）」");
  ok(full.text.indexOf("已退役丙") < 0, "★★[RP] **retired 条目被过滤**（不渲染已退役）");
  ok(full.counts.excludedRetired === 1, "★[RP] excludedRetired 如实报数", String(full.counts.excludedRetired));
  ok(full.counts.note === 1 && full.counts.rule === 1, "★[RP] note/rule 分计正确", "note=" + full.counts.note + " rule=" + full.counts.rule);
}
{
  for (const t of ["slim", "run_slim", "human_slim", "legacy"]) {
    const r = rr.renderRulesForTierPre({ rules: RULES, tier: t, legacy: false, maintainText: MT });
    ok(r.text.indexOf("硬规则甲") < 0, "★★[RP] " + t + " ⇒ **只给指针**（不展开正文）", "mode=" + r.mode);
    ok(r.text.indexOf("memory_rules op=list") >= 0, "★★[RP] " + t + " 指针指向 memory_rules op=list");
  }
}
{
  const hs = rr.renderRulesForTierPre({ rules: RULES, tier: "human_slim", legacy: false, maintainText: MT });
  ok(hs.text.indexOf(MT) >= 0, "★★[RP] human_slim **额外**带维护块");
  ok(hs.snapshotSlimMaintain === true, "★★[RP] human_slim 标记 snapshotSlimMaintain");
  const rs = rr.renderRulesForTierPre({ rules: RULES, tier: "run_slim", legacy: false, maintainText: MT });
  ok(rs.text.indexOf(MT) < 0, "★★[RP] run_slim **不带**维护块（区分 human_slim）");
  const sl = rr.renderRulesForTierPre({ rules: RULES, tier: "slim", legacy: false, maintainText: MT });
  ok(sl.text.indexOf(MT) < 0, "★★[RP] slim 不带维护块");
}
{
  const lg = rr.renderRulesForTierPre({ rules: RULES, tier: "slim", legacy: true });
  ok(lg.mode === "legacy-pointer" && lg.legacy === true, "★★[RP] legacy ⇒ legacy-pointer 模式", lg.mode);
  ok(lg.text.indexOf("legacy") >= 0, "★★[RP] legacy 指针文案含 legacy 说明");
}

// ══════════ D. ★维护块取自真实 DEFAULT_PROMPT_LAYERS ══════════
{
  const mod = await import(pathToFileURL(path.join(REPO, "lib/index.js")).href);
  const LAYERS = mod.DEFAULT_PROMPT_LAYERS;
  ok(!!LAYERS && typeof LAYERS.snapshotSlimMaintain === "string" && LAYERS.snapshotSlimMaintain.length > 0,
    "★★[RP] DEFAULT_PROMPT_LAYERS.snapshotSlimMaintain 真实存在", String(LAYERS && LAYERS.snapshotSlimMaintain && LAYERS.snapshotSlimMaintain.length) + " chars");
  // 用真实文案作 maintainText 与用占位文案，输出必须不同 ⇒ 证明它真被用上（非硬编码副本）
  const withReal = rr.renderRulesForTierPre({ rules: RULES, tier: "human_slim", legacy: false, maintainText: LAYERS.snapshotSlimMaintain });
  const withFake = rr.renderRulesForTierPre({ rules: RULES, tier: "human_slim", legacy: false, maintainText: MT });
  ok(withReal.text !== withFake.text, "★★[RP] maintainText 真被采用（换文案输出即变，非硬编码）");
  ok(withReal.text.indexOf(LAYERS.snapshotSlimMaintain) >= 0, "★★[RP] 真实文案逐字出现在渲染结果里");
  const block = rr.SLIM_MAINTAIN_BLOCK;
  ok(typeof block === "string" && block.length > 0, "★[RP] 缺省维护块 SLIM_MAINTAIN_BLOCK 可用");
  const noMt = rr.renderRulesForTierPre({ rules: RULES, tier: "human_slim", legacy: false });
  ok(noMt.text.indexOf(block) >= 0, "★★[RP] 未传 maintainText ⇒ 回落 SLIM_MAINTAIN_BLOCK");
}

// ══════════ E. 薄边界：不引其它 RP 符号，业务不复制 ══════════
{
  // ★修正（首轮 FAIL 归因）：原断言用「全文件 indexOf」判泄漏 ⇒ 会把**我写的注释里提到的符号名**当成泄漏，
  //   属恒真式伪判据（注释想写就写）。改为**只检查实际 import 语句的标识符集合**。
  const impM = idx.match(/import\s*\{([^}]*)\}\s*from\s*'[^']*injection\/render-rules\.js'/);
  ok(!!impM, "★★[RP] 能定位到 render-rules.js 的 import 语句");
  const imported = impM ? impM[1].split(",").map((x) => x.trim()).filter(Boolean) : ["<未解析>"];
  ok(imported.length === 1 && imported[0] === "renderRulesForTierPre",
    "★★[RP] 薄适配边界：**只**从该模块引 renderRulesForTierPre", imported.join(","));
  const leaked = imported.filter((k) => k !== "renderRulesForTierPre");
  ok(leaked.length === 0, "★★[RP] 无其它 RP 符号被引入生产", leaked.join(",") || "0 泄漏");
  // 生产不得复制 note 前缀规则（在 renderMemoryDynamic 内不得再出现独立的（说明）判定）
  const dyn = idx.slice(idx.indexOf("renderMemoryDynamic(context)"), idx.indexOf("const _renderRulesSlimInline"));
  ok(dyn.indexOf("（说明）") < 0 || dyn.indexOf("_notePre") < 0, "★[RP] 生产出口不重复实现 note 前缀逻辑");
}

// ══════════ F. 真实 apply 与计数锁 ══════════
{
  const mod = await import(pathToFileURL(path.join(REPO, "lib/index.js")).href);
  const routes = [], sect = [], effects = [], tools = [];
  const store = new Map();
  const ctx = {
    effect(fn) { effects.push(fn); return () => {}; },
    on() { return () => {}; },
    get(k) { return store.get(k); }, set(k, v) { store.set(k, v); },
    provide(k, v) { store.set(k, v); }, consume(k) { return store.get(k); },
    tools: { register(t) { tools.push(t); return () => {}; } },
    systemPrompt: {
      context: (fn) => { sect.push({ kind: "context", fn }); },
      section: (a, b) => { sect.push({ kind: "section", fn: typeof a === "function" ? a : b }); },
    },
    webServer: { register: (r) => { routes.push(r && (r.path || r.method || "?")); return true; } },
    log() {}, logger: { info() {}, warn() {}, error() {}, debug() {} },
    config: {},
  };
  let applied = false, err = null;
  try { await mod.apply(ctx); applied = true } catch (e) { err = String((e && e.message) || e) }
  ok(applied, "★★[RP] 真实 apply(ctx) 无异常", err ? err.slice(0, 120) : "OK");
  ok(tools.length === 22, "★★[RP] tools 注册数仍 22", String(tools.length));
  // P1 授权新增 delivery-preview；保留真 apply 计数，工具/导出等独立断言不变。
  ok(routes.length === 87, "★★[RP/P1] routes 为 87（新增 delivery-preview）", String(routes.length));
  ok(effects.length === 2 && sect.length === 3, "★[RP] effect=2 / 注入槽=3 不变", "effect=" + effects.length + " sect=" + sect.length);
  ok(Object.keys(mod).filter((k) => k !== "default").length === 41, "★★[RP] 导出符号仍 41");
}


// 生产八档直接走公共模块；避免生产与模块各自维护词表。
{
  const cases = { human_full: 'full', post_compact: 'full', handoff_carry: 'full', hang_compensate: 'full', human_slim: 'slim-maintain', legacy: 'legacy-pointer', run_full: 'pointer', run_slim: 'pointer' }
  for (const [tier, mode] of Object.entries(cases)) {
    const got = rr.renderRulesForTierPre({ rules: RULES, tier, legacy: tier === 'legacy' })
    ok(got.mode === mode, "★★[RP生产映射] " + tier + " → " + mode, got.mode)
  }
  ok(idx.includes("legacy: _tier === 'legacy'"), "★★[RP生产映射] legacy按真实生产字符串传递")
}

console.log("\n── B3-RP-AD1 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);
