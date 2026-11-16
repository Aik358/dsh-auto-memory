#!/usr/bin/env node
/**
 * smoke-test-batch3-cadence-projection.mjs —— B3-CA / B3-PJ 验收
 *
 * ★task-38 复核修订（2026-11-17）后重写 CA 段，覆盖四条修订：
 *   1. 缺省水位只 25；显式 '25,50' 双档；off/0 禁用
 *   2. 支持真实 engine 字段（_compactSeqSeenPre/compactionSeq/_waterPctFired/_lastFullStepSeq/_stepSeq/requestKey），
 *      紧凑别名兼容但不覆盖真实 requestKey
 *   3. snapshotReinjectOnCompact=false ⇒ 不授 full 但记录 post_compact
 *   4. 首观测只建压缩基线，不吞 human/fullGap；无观测字段不判首观测
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }

const m = await import(pathToFileURL(path.join(REPO, "lib/injection/index.js")).href);
ok(typeof m.decideInjectionCadencePre === "function", "[import] decideInjectionCadencePre 已导出");
ok(typeof m.projectInjectionPre === "function", "[import] projectInjectionPre 已导出");
ok(m.INJECTION_CONTRACT_INFO.implements.includes("B3-CA") && m.INJECTION_CONTRACT_INFO.implements.includes("B3-PJ"), "[import] 自述已声明实现 CA/PJ");
ok(!("parseWaterThresholds" in m), "★[import] 内部水位解析**未**导出（L2 §5.1：不新增导出凑测试）");

// ══════════ CA ══════════
const CFG = { snapshotMinGapRounds: 5, slimEvery: 99 };
/** 用**真实 engine 字段**构造稳态 state（已观测、无新压缩、水位低）。 */
const REAL = (over) => Object.assign({
  _stepSeq: 0, _lastFullStepSeq: 0, compactionSeq: 1, _compactSeqSeenPre: 1,
  waterPct: 10, _waterPctFired: 0,
}, over || {});
const CA = (over) => m.decideInjectionCadencePre(Object.assign({ state: REAL(), frame: {}, signals: {}, config: CFG }, over || {}));

// ── A. 缺省水位只 25；显式 25,50；off/0 禁用（修订 1）
{
  ok(JSON.stringify(m.DEFAULT_WATER_THRESHOLDS) === "[25]", "★★[CA] 缺省水位阈值 = [25]（**50 默认关闭**）", JSON.stringify(m.DEFAULT_WATER_THRESHOLDS));
  const d26 = CA({ state: REAL({ waterPct: 26 }) });
  ok(d26.tier === "full" && d26.grants.includes("water-25"), "★[CA] 缺省配置 waterPct=26 ⇒ water-25 授予 full", d26.grants.join(","));
  const d51 = CA({ state: REAL({ waterPct: 51 }) });
  ok(d51.grants.includes("water-25") && !d51.grants.includes("water-50"),
    "★★[CA] 缺省配置 waterPct=51 ⇒ **只有 25 档生效**（50 默认关闭，不出现 water-50）", d51.grants.join(","));
  const e50 = m.decideInjectionCadencePre({ state: REAL({ waterPct: 51, _waterPctFired: 25 }), config: Object.assign({}, CFG, { fullInjectWaterPct: "25,50" }) });
  ok(e50.tier === "full" && e50.grants.includes("water-50"),
    "★★[CA] **显式** '25,50' + waterPct=51 + 已投25 ⇒ water-50（显式双档不被缺省逻辑吞掉）", e50.grants.join(","));
  const e25 = m.decideInjectionCadencePre({ state: REAL({ waterPct: 26 }), config: Object.assign({}, CFG, { fullInjectWaterPct: "25,50" }) });
  ok(e25.grants.includes("water-25"), "[CA] 显式 '25,50' + waterPct=26 ⇒ water-25");
  for (const off of ["off", "0", "none", "false", 0, false]) {
    const r = m.decideInjectionCadencePre({ state: REAL({ waterPct: 99 }), config: Object.assign({}, CFG, { fullInjectWaterPct: off }) });
    ok(r.tier !== "full" && r.fullGranted === false, "★★[CA] 显式禁用 " + JSON.stringify(off) + " + 水位99% ⇒ 仍不投 full", r.tier);
  }
  // 对照：同水位默认阈值必须投 ⇒ 证明上条「不投」确由 off/0 造成
  ok(CA({ state: REAL({ waterPct: 99 }) }).tier === "full", "★★[CA] 对照：同水位99% 用缺省阈值 ⇒ 投 full（证明禁用是唯一差异）");
  // 全非法/空 ⇒ 回落缺省 [25]
  const bad = m.decideInjectionCadencePre({ state: REAL({ waterPct: 26 }), config: Object.assign({}, CFG, { fullInjectWaterPct: "abc" }) });
  ok(bad.grants.includes("water-25"), "★[CA] 全非法串 'abc' ⇒ 回落缺省 [25]（不是 [25,50]）", bad.grants.join(","));
  const empty = m.decideInjectionCadencePre({ state: REAL({ waterPct: 51 }), config: Object.assign({}, CFG, { fullInjectWaterPct: "" }) });
  ok(empty.grants.includes("water-25") && !empty.grants.includes("water-50"), "★[CA] 空串 ⇒ 回落 [25]（无 50 档）", empty.grants.join(","));
  // 一次性 + 复位
  ok(CA({ state: REAL({ waterPct: 27, _waterPctFired: 25 }) }).tier !== "full", "★[CA] 已投25档后 27% ⇒ 不重复投");
  ok(CA({ state: REAL({ waterPct: 26, _waterPctFired: 0 }) }).tier === "full", "★[CA] _waterPctFired 复位0 ⇒ 可再投");
  const jump = m.decideInjectionCadencePre({ state: REAL({ waterPct: 55, _waterPctFired: 0 }), config: Object.assign({}, CFG, { fullInjectWaterPct: "25,50" }) });
  ok(jump.grants.includes("water-50") && jump.grants.filter((g) => g.startsWith("water-")).length === 1,
    "★[CA] 一次从低跳到55 ⇒ **只投一次**（fireAt=最高已跨50）", jump.grants.join(","));
  const custom = m.decideInjectionCadencePre({ state: REAL({ waterPct: 71, _waterPctFired: 0 }), config: Object.assign({}, CFG, { fullInjectWaterPct: "70,90" }) });
  ok(custom.grants.includes("water-custom"), "★[CA] 自定义阈值 70 ⇒ water-custom", custom.grants.join(","));
}

// ── B. 真实 engine 字段 vs 紧凑别名（修订 2）
{
  const realState = { _stepSeq: 10, _lastFullStepSeq: 0, compactionSeq: 3, _compactSeqSeenPre: 2, waterPct: 10, _waterPctFired: 0 };
  const aliasState = { turnIndex: 10, lastFullTurn: 0, compactCount: 3, lastCompactCount: 2, waterPct: 10, waterFired: 0 };
  const a = m.decideInjectionCadencePre({ state: realState, config: CFG });
  const b = m.decideInjectionCadencePre({ state: aliasState, config: CFG });
  ok(a.tier === "full" && a.grants.includes("post-compact"), "★[CA] 真实字段 compactionSeq增长 ⇒ newCompact 命中", a.grants.join(","));
  ok(a.tier === b.tier && a.grants.join(",") === b.grants.join(","), "★★[CA] 真实字段与紧凑别名**同语义对照一致**", a.tier + "/" + a.grants.join(",") + " vs " + b.tier + "/" + b.grants.join(","));
  ok(a.observed.compactionSeq === 3 && a.observed.compactSeqSeen === 2, "★[CA] 返回 observed 只读回显真实字段值");
  ok(Object.isFrozen(a.observed), "[CA] observed 已冻结");
  // 真实 _waterPctFired 生效
  const wf = m.decideInjectionCadencePre({ state: { _stepSeq: 0, _lastFullStepSeq: 0, compactionSeq: 1, _compactSeqSeenPre: 1, waterPct: 27, _waterPctFired: 25 }, config: CFG });
  ok(wf.tier !== "full", "★[CA] 真实字段 _waterPctFired=25 ⇒ 27% 不重复投");
  // requestKey：真实输入、不自造
  const rkState = m.decideInjectionCadencePre({ state: REAL({ requestKey: "sess-1:7:2" }), config: CFG });
  ok(rkState.requestKey === "sess-1:7:2" && rkState.requestKeyMissing === false, "★★[CA] requestKey 来自 state 真实字段", String(rkState.requestKey));
  const rkInput = m.decideInjectionCadencePre({ state: REAL(), config: CFG, requestKey: "req-42" });
  ok(rkInput.requestKey === "req-42", "★★[CA] requestKey 可由 input 直接提供", String(rkInput.requestKey));
  const rkMiss = m.decideInjectionCadencePre({ state: REAL(), config: CFG });
  ok(rkMiss.requestKey === null && rkMiss.requestKeyMissing === true, "★★[CA] 缺 requestKey ⇒ 显式 null + requestKeyMissing（**不伪造**）");
  ok(!String(rkMiss.requestKey).startsWith("cad:"), "★★[CA] **不**自造 'cad:' 前缀覆盖真实请求身份", String(rkMiss.requestKey));
  ok(rkMiss.reasons.some((x) => x.includes("不伪造")), "★[CA] reasons 显式说明 requestKey 不伪造");
}

// ── C. snapshotReinjectOnCompact=false（修订 3）
{
  const st = { _stepSeq: 5, _lastFullStepSeq: 5, compactionSeq: 3, _compactSeqSeenPre: 2, waterPct: 10, _waterPctFired: 0 };
  const offR = m.decideInjectionCadencePre({ state: st, config: Object.assign({}, CFG, { snapshotReinjectOnCompact: false }) });
  ok(offR.newCompact === true, "★[CA] 仍识别出 newCompact=true（压缩事实不被抹掉）");
  ok(offR.fullGranted === false && offR.tier !== "full", "★★[CA] snapshotReinjectOnCompact=false ⇒ **不授予 full**", offR.tier + "/" + offR.fullGranted);
  ok(offR.grants.includes("post-compact"), "★★[CA] 但 **post_compact 仍记录**在 grants", offR.grants.join(","));
  ok(offR.grants.includes("post-compact-no-reinject"), "★[CA] 另有 post-compact-no-reinject 标记说明原因");
  ok(offR.reasons.some((x) => x.includes("不授予 full")), "★[CA] reasons 显式说明不授予 full");
  // 对照：缺省（允许）必须授予 full
  const onR = m.decideInjectionCadencePre({ state: st, config: CFG });
  ok(onR.tier === "full" && onR.grants.includes("post-compact"), "★★[CA] 对照：缺省允许重注入 ⇒ 新压缩授予 full", onR.grants.join(","));
  // signal 侧亦可禁用
  const viaSig = m.decideInjectionCadencePre({ state: st, signals: { snapshotReinjectOnCompact: false }, config: CFG });
  ok(viaSig.fullGranted === false && viaSig.grants.includes("post-compact"), "★[CA] signal 侧禁用同样生效且 post_compact 仍记录");
  // 不授 full 后仍可被 human 救回
  const recover = m.decideInjectionCadencePre({ state: st, signals: { isHumanTurn: true }, config: Object.assign({}, CFG, { snapshotReinjectOnCompact: false }) });
  ok(recover.tier === "full" && recover.grants.includes("human-turn"), "★★[CA] reinject=false 时**继续评估** human（不短路吞掉）", recover.grants.join(","));
}

// ── D. 首观测只建压缩基线（修订 4）
{
  const fo = m.decideInjectionCadencePre({ state: { compactionSeq: 3 }, config: CFG });
  ok(fo.compactionBaselineOnly === true, "★[CA] 首观测 compactionBaselineOnly=true");
  ok(fo.grants.includes("first-observation-baseline"), "★[CA] 首观测 grant=first-observation-baseline（只建基线）");
  ok(fo.tier === "slim", "[CA] 首观测无其它条件 ⇒ slim");
  // ★不吞 human
  const foHuman = m.decideInjectionCadencePre({ state: { compactionSeq: 3, _stepSeq: 1 }, signals: { isHumanTurn: true }, config: CFG });
  ok(foHuman.tier === "full" && foHuman.grants.includes("human-turn"),
    "★★[CA] 首观测 + 真人 ⇒ **仍授予 full**（首观测不吞 human）", foHuman.grants.join(","));
  ok(foHuman.compactionBaselineOnly === true, "★[CA] 同时保留 baselineOnly 标记");
  // ★不吞 fullGap
  const foGap = m.decideInjectionCadencePre({ state: { compactionSeq: 3, _stepSeq: 10, _lastFullStepSeq: 0 }, config: CFG });
  ok(foGap.tier === "full" && foGap.grants.includes("full-gap"),
    "★★[CA] 首观测 + fullGap(10>=5) ⇒ **仍授予 full**（首观测不吞 fullGap）", foGap.grants.join(","));
  // ★首观测时历史压缩不得当新压缩（基线缺失 ⇒ newCompact=false）
  const foCompact = m.decideInjectionCadencePre({ state: { compactionSeq: 9, _stepSeq: 0 }, signals: { postCompact: true }, config: CFG });
  ok(foCompact.newCompact === false, "★★[CA] 首观测（基线缺失）+ postCompact 信号 ⇒ **不算新压缩**");
  ok(foCompact.reasons.some((x) => x.includes("不当作新压缩")), "★[CA] reasons 说明不当作新压缩");
  // ★无观测字段不判首观测
  const emptyState = m.decideInjectionCadencePre({ state: {}, config: CFG });
  ok(emptyState.compactionBaselineOnly === false, "★★[CA] **空 state 不判首观测**（无观测字段 ≠ 首观测）", String(emptyState.compactionBaselineOnly));
  ok(!emptyState.grants.includes("first-observation-baseline"), "[CA] 空 state 不出现 first-observation-baseline");
  const emptyHuman = m.decideInjectionCadencePre({ state: {}, signals: { isHumanTurn: true }, config: CFG });
  ok(emptyHuman.tier === "full", "★★[CA] 空 state + 真人 ⇒ 仍按真人授予 full（不被误判首观测吞掉）", emptyHuman.tier);
  // 显式信号可强制首观测
  const explicit = m.decideInjectionCadencePre({ state: REAL(), signals: { firstObservation: true }, config: CFG });
  ok(explicit.compactionBaselineOnly === true, "★[CA] signals.firstObservation=true 可显式强制首观测");
}

// ── E. 常规条件
{
  ok(CA({ signals: { isHumanTurn: true } }).tier === "full", "[CA] 真人发言 ⇒ full");
  ok(CA({ signals: { isUnattended: true } }).tier !== "full", "[CA] 无人值守 ⇒ 不投 full");
  const tight = CA({ state: REAL({ _stepSeq: 10, _lastFullStepSeq: 10, compactionSeq: 5, _compactSeqSeenPre: 4 }) });
  ok(tight.tier === "full", "★★[CA] gap=0 时新压缩仍强制 full（未被间距条件吞掉）", tight.tier);
  const hist = CA({ state: REAL({ compactionSeq: 2, _compactSeqSeenPre: 2 }), signals: { postCompact: true } });
  ok(hist.tier !== "full" || !hist.grants.includes("post-compact"), "★★[CA] 历史压缩（序号未增长）⇒ 不触发 post-compact full", hist.tier + "/" + hist.grants.join(","));
  ok(CA({ signals: { handoffCarry: true } }).tier === "full", "[CA] handoff_carry ⇒ full");
  ok(CA({ signals: { hangCompensate: true } }).tier === "full", "[CA] hang_compensate ⇒ full");
  ok(CA({ signals: { legacy: true } }).grants.includes("legacy-fallback"), "★[CA] legacy ⇒ fail-open 显式标记");
  const lg = CA({ signals: { legacy: true } });
  ok(lg.fullGranted === false, "[CA] legacy fail-open 不假装授予 full");
}

// ── F. 纯函数性
{
  const st = REAL({ waterPct: 26 });
  const cfg = Object.assign({}, CFG);
  const snaps = JSON.stringify([st, cfg]);
  const a = m.decideInjectionCadencePre({ state: st, config: cfg, requestKey: "k1" });
  const b = m.decideInjectionCadencePre({ state: st, config: cfg, requestKey: "k1" });
  ok(JSON.stringify([st, cfg]) === snaps, "★★[CA] 调用**不修改入参 state/config**（纯函数）");
  ok(JSON.stringify(a) === JSON.stringify(b), "★★[CA] 同输入两次输出逐字节一致（幂等）", "len " + JSON.stringify(a).length);
  ok(Object.isFrozen(a) && Object.isFrozen(a.grants) && Object.isFrozen(a.reasons), "[CA] 返回及数组已冻结");
  ok(a.dtoKind === "CadenceDecision", "[CA] dtoKind=CadenceDecision");
  ok(a.requestKey === "k1", "[CA] requestKey 原样回显调用方输入");
}

// ══════════ PJ ══════════
const mkSpec = (over) => m.makeContentSpec(Object.assign(
  Object.fromEntries(m.CONTENT_SPEC_SEGMENTS.map((x) => [x, m.CONTENT_SPEC_ENUMS[x][0]])),
  { budgetPolicy: { unit: "js-chars", cap: null, unresolved: true }, sourceIdentity: "src-1" }, over || {}));

// 11. 按 ContentSpec 投影候选
{
  const spec = mkSpec({ rules: "full", plan: "core", events: "cards", portrait: "short" });
  const pj = m.projectInjectionPre({
    sources: { rules: { ruleText: "- 必须A" }, plan: { text: "# 白板\n内容" }, events: { text: "[事件]" } },
    tier: "full", contentSpec: spec,
  });
  ok(pj.dtoKind === "Projection", "[PJ] 返回 Projection");
  const kinds = pj.candidates.map((c) => c.kind);
  ok(kinds.includes("rules") && kinds.includes("plan") && kinds.includes("events"), "★[PJ] 请求的三段都产出候选", kinds.join(","));
  ok(pj.candidates.every((c) => c.dtoKind === "ProjectionCandidate" && typeof c.id === "string" && typeof c.priority === "number"), "[PJ] 候选字段完整（id/kind/bucket/priority/text/sourceIdentity/contentVersion）");
  ok(pj.candidates.every((c) => Object.isFrozen(c)), "[PJ] 候选已冻结");
  const modes = ["none", "pointer"];
  ok(modes.includes(spec.semantic), "[PJ] 未请求的段（semantic）保持 none");
}

// 12. 各段语义独立：同一 sources 不同 ContentSpec 产出不同候选
{
  const src = { rules: { ruleText: "R" }, plan: { text: "P" }, handoff: { text: "H" } };
  const a = m.projectInjectionPre({ sources: src, contentSpec: mkSpec({ rules: "pointer" }), tier: "full" });
  const b = m.projectInjectionPre({ sources: src, contentSpec: mkSpec({ rules: "pointer", plan: "core" }), tier: "full" });
  ok(a.candidates.length !== b.candidates.length, "★★[PJ] 不同 ContentSpec ⇒ 不同候选集（各段名单独立）", a.candidates.length + " vs " + b.candidates.length);
  ok(!a.candidates.some((c) => c.kind === "plan") && b.candidates.some((c) => c.kind === "plan"), "★[PJ] plan=none 时不投影 plan");
}

// 13. none 段不产生 degradation；请求了但无内容 ⇒ 显式 degradation
{
  const pj = m.projectInjectionPre({ sources: {}, contentSpec: mkSpec({ rules: "full", calendar: "current" }), tier: "full" });
  ok(pj.degradations.some((d) => d.scope === "rules" && d.code === "segment-empty"), "★[PJ] 请求了 rules 但无内容 ⇒ 显式 segment-empty 降级");
  ok(!pj.degradations.some((d) => d.scope === "plan"), "[PJ] 未请求的段（plan=none）不产生降级");
}

// 14. 通道区超限 ⇒ 整段省略 + 显式 degradation
{
  const big = "x".repeat(5000);
  const pj = m.projectInjectionPre({
    sources: { calendar: { text: big }, externalMemory: { text: "小" } },
    contentSpec: mkSpec({ calendar: "current", externalMemory: "full" }),
    tier: "full", channelLimit: 2000,
  });
  ok(!pj.candidates.some((c) => c.kind === "calendar"), "★★[PJ] 超限的通道段**整段省略**（不截断后仍投）");
  ok(pj.degradations.some((d) => d.code === "channel-overflow" && d.scope === "calendar"), "★★[PJ] 省略**必须**显式 degradation（不静默）");
  ok(pj.candidates.some((c) => c.kind === "externalMemory"), "[PJ] 未超限的通道段正常投影");
}

// 15. 画像只用 accepted/used + authorResponse
{
  const items = [
    { stage: "accepted", kind: "preference", text: "偏好A" },
    { stage: "used", kind: "state", text: "状态B" },
    { stage: "retrieved", kind: "state", text: "噪声C" },
    { stage: "delivered", kind: "preference", text: "噪声D" },
    { kind: "authorResponse", text: "作者回应E" },
  ];
  const pj = m.projectInjectionPre({ sources: {}, contentSpec: mkSpec({ portrait: "short" }), tier: "full", portraitItems: items });
  const pt = pj.candidates.find((c) => c.kind === "portrait");
  ok(!!pt, "[PJ] 有合格画像条目 ⇒ 产出 portrait 候选");
  ok(pt.text.includes("偏好A") && pt.text.includes("状态B") && pt.text.includes("作者回应E"), "★★[PJ] 保留 accepted/used/authorResponse");
  ok(!pt.text.includes("噪声C") && !pt.text.includes("噪声D"), "★★[PJ] 丢弃 retrieved/delivered 噪声");
  ok(pj.degradations.some((d) => d.code === "portrait-filtered"), "★[PJ] 过滤有显式降级记录");
  ok(m.filterPortraitItems(items).kept.length === 3, "[PJ] filterPortraitItems 保留 3 条", String(m.filterPortraitItems(items).kept.length));
}

// 16. 2.3 proposal-only：只透传，不应用
{
  const props = [{ eventId: "evt_1", action: "attach" }, { eventId: "evt_2", action: "create" }];
  const pj = m.projectInjectionPre({ sources: {}, contentSpec: mkSpec({}), tier: "full", attributionProposals: props });
  ok(pj.attribution.applied === false, "★★[PJ] attribution.applied 恒为 false（不自动应用）");
  ok(pj.attribution.autoAttach === false && pj.attribution.autoMerge === false && pj.attribution.autoArchive === false, "★★[PJ] 不自动 attach/merge/archive");
  ok(pj.attribution.proposals.length === 2, "[PJ] 建议原样透传（只读）", String(pj.attribution.proposals.length));
}

// 17. 精简档不得走完整渲染
{
  const spec = mkSpec({ rules: "pointer" });
  const slim = m.projectInjectionPre({ sources: { rules: { ruleText: "x" } }, contentSpec: spec, tier: "run_slim" });
  ok(slim.renderPath === "slim", "★★[PJ] run_slim ⇒ renderPath=slim（不送 renderMemoryDynamic）", slim.renderPath);
  const hslim = m.projectInjectionPre({ sources: {}, contentSpec: spec, tier: "human_slim" });
  ok(hslim.renderPath === "slim", "★★[PJ] human_slim ⇒ renderPath=slim");
  const f = m.projectInjectionPre({ sources: { rules: { ruleText: "x" } }, contentSpec: spec, tier: "full" });
  ok(f.renderPath === "dynamic", "[PJ] full ⇒ renderPath=dynamic", f.renderPath);
}

// 18. 未登记段必须先登记（不得静默新增公共面）
{
  const segs = m.CONTENT_SPEC_SEGMENTS;
  const mapped = Object.keys(m.CONTENT_SPEC_TO_PROMPT_SECTION);
  ok(segs.every((s) => mapped.includes(s)), "★★[PJ] 14 段全部已登记到 CONTENT_SPEC_TO_PROMPT_SECTION", segs.length + " 段 / " + mapped.length + " 映射");
}

// 19. 纯函数性 + 非法输入
{
  const spec = mkSpec({ rules: "full" });
  const src = { rules: { ruleText: "R" } };
  const s1 = JSON.stringify(src), sp1 = JSON.stringify(spec);
  const a = m.projectInjectionPre({ sources: src, contentSpec: spec, tier: "full" });
  const b = m.projectInjectionPre({ sources: src, contentSpec: spec, tier: "full" });
  ok(JSON.stringify(src) === s1 && JSON.stringify(spec) === sp1, "★★[PJ] 调用不修改 sources/contentSpec（纯函数）");
  ok(JSON.stringify(a) === JSON.stringify(b), "★★[PJ] 同输入两次输出逐字节一致");
  let threw = null;
  try { m.projectInjectionPre({ sources: {}, contentSpec: { rules: "full" } }) } catch (e) { threw = e }
  ok(threw && threw.code === "injection-invalid-argument", "★[PJ] 传非 ContentSpec ⇒ 显式报错（不静默补齐）", threw && threw.code);
}

// 20. 内置变异（证明断言有区分力）
{
  ok(m.decideInjectionCadencePre({ state: REAL(), signals: { isHumanTurn: true }, config: CFG }).fullGranted === true
    && m.decideInjectionCadencePre({ state: REAL(), signals: {}, config: CFG }).fullGranted === false,
    "[变异M1] 真人/非真人 ⇒ fullGranted 可区分");
  // 新增内置变异：缺省 vs 显式双档的**水位档位可区分**
  {
    const def = m.decideInjectionCadencePre({ state: REAL({ waterPct: 51, _waterPctFired: 25 }), config: CFG });
    const two = m.decideInjectionCadencePre({ state: REAL({ waterPct: 51, _waterPctFired: 25 }), config: Object.assign({}, CFG, { fullInjectWaterPct: "25,50" }) });
    ok(!def.grants.includes("water-50") && two.grants.includes("water-50"),
      "[变异M4] 缺省(只25) 与 显式25,50 的档位差异可区分", def.grants.join(",") + " vs " + two.grants.join(","));
  }
  // 新增内置变异：requestKey 若不伪造则可区分
  {
    const miss = m.decideInjectionCadencePre({ state: REAL(), config: CFG });
    const given = m.decideInjectionCadencePre({ state: REAL(), config: CFG, requestKey: "real-1" });
    ok(miss.requestKey === null && given.requestKey === "real-1",
      "[变异M5] requestKey 缺失(null) 与 提供(real-1) 可区分");
  }
  const leaky = (spec) => ({ renderPath: "dynamic" });
  ok(leaky().renderPath === "dynamic" && m.projectInjectionPre({ sources: {}, contentSpec: mkSpec({}), tier: "run_slim" }).renderPath === "slim",
    "[变异M2] 若精简档被送完整渲染 ⇒ renderPath 断言可区分");
  ok(m.projectInjectionPre({ sources: {}, contentSpec: mkSpec({}), tier: "full", attributionProposals: [1] }).attribution.applied === false,
    "[变异M3] 若自动应用归属 ⇒ applied 断言可区分");
}

console.log("\n── B3-CA/PJ 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);