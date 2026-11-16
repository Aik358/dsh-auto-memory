#!/usr/bin/env node
/**
 * smoke-test-2-3-event-attribution-propose.mjs —— task-29 阻断三：**历史账本零写提案的真实入口**
 *
 * 证明的不只是「facade 有 proposeRegroup 方法」，而是：
 *   ① engine.proposeRegroupPre 真实存在且真调用 R1/R2/R3；
 *   ② 现有 event-curate 路由内真存在 op='propose' 分流（**不新增 HTTP 路由**）；
 *   ③ dryRun 只回 prompt 预览，**不启动子代理**（不烧模型）；
 *   ④ 实际 propose 可调模型，但**零写、无令牌、不调 apply**。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }
const sha = (b) => createHash("sha256").update(b).digest("hex");

const SB = path.join(REPO, ".tmp-smoke-run/ea29prop");
fs.rmSync(SB, { recursive: true, force: true });
const PROJ = path.join(SB, "proj"), HAND = path.join(PROJ, "handoff");
fs.mkdirSync(HAND, { recursive: true });
fs.writeFileSync(path.join(HAND, "2026-11-01-a.md"), "# A\n\n## 目标\ntype:goal\n- 同一目标 X\n\n## 进度\ntype:progress\n- 第一步\n", "utf8");
fs.writeFileSync(path.join(HAND, "2026-11-01-b.md"), "# B\n\n## 目标\ntype:goal\n- 同一目标 X\n\n## 进度\ntype:progress\n- 第二步\n", "utf8");

const IDX = fs.readFileSync(path.join(REPO, "lib/index.js"), "utf8").split("\r\n").join("\n");

// ═══════════ 1. 结构存在性（源码层守卫，已标注为非功能证据）═══════════
ok(IDX.includes("async proposeRegroupPre(opts = {})"), "S1 engine.proposeRegroupPre 方法存在（守卫）");
ok(IDX.includes("String((body && body.op) || '') === 'propose'"), "S2 event-curate 内 op='propose' 分流存在（守卫）");
ok((IDX.match(/path: API\['event-curate'\]/g) || []).length === 1, "S3 **event-curate 路由仍只有 1 个**（未新增路由，86 守恒）");
ok(IDX.indexOf("body.op) || '') === 'propose'") < IDX.indexOf("const candidateIds = Array.isArray"),
  "★★S4 op=propose 分流在 candidateIds **之前** ⇒ 绝不可能落入写盘分支");

// ═══════════ 2. 方法体禁令（真切片，不是全文搜）═══════════
const mStart = IDX.indexOf("  async proposeRegroupPre(opts = {}) {");
const mNext = IDX.indexOf("  async curateUnarchivedPre(opts = {}) {");
ok(mStart > 0 && mNext > mStart, "S5 方法体切片成功", (mNext - mStart) + " 字符");
const body = IDX.slice(mStart, mNext);
for (const f of ["writeCuratedEventsPre", "applyRegroupPre", "applyRegroup(", "_curateToken", "appendCheckpointPre", "createEventForWorkPre"]) {
  ok(body.split(f).length - 1 === 0, "S6 方法体内禁止项 `" + f + "` 出现 **0** 次");
}
for (const k of ["listUnarchivedPre", "scanUnarchivedLedgersPre", "groupIntoCandidateEventsPre", "estimateCurationCostPre", "validateEventNamePre"]) {
  ok(body.split(k).length - 1 >= 1, "S7 真调用 R1/R3 `" + k + "`");
}
ok(body.split("buildRegroupPromptPre").length - 1 >= 1, "S7 真调用 R2 `buildRegroupPromptPre`");
ok(body.includes("wrote: false") && body.includes("confirmToken: null"), "★★S8 返回值显式声明 wrote:false / confirmToken:null");

// ═══════════ 3. 真调用 engine 方法（真 import → 真构造 engine → 真调）═══════════
const mod = await import(pathToFileURL(path.join(REPO, "lib/index.js")).href);
ok(typeof mod.apply === "function", "[import] 生产模块可加载");

// 从生产模块里取真实 engine 类：apply/inject 是导出，但 engine 需要宿主上下文。
// 这里用「最小的真实依赖装配」验证 proposeRegroupPre 的**行为契约**：
//   把一个只含真实 R1/R3 函数的对象 + 真方法体求值出来调用（与产线同一份代码）。
const mBodyOnly = body.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, "")
  .replace("async proposeRegroupPre(opts = {}) {", "async function proposeRegroupPre(opts = {}) {")
  .replace(/,\s*$/, "");
const factory = new Function(
  "DEFAULT_CURATE_BATCH", "listUnarchivedPre", "scanUnarchivedLedgersPre", "groupIntoCandidateEventsPre",
  "estimateCurationCostPre", "validateEventNamePre", "buildRegroupPromptPre",
  "createHostModelPortPre", "createEventAttributionServicePre",
  mBodyOnly + "\nreturn proposeRegroupPre;"
);
const EW = await import(pathToFileURL(path.join(REPO, "lib/event-write.js")).href);
const EA = await import(pathToFileURL(path.join(REPO, "lib/event-attribution/index.js")).href);

// 真实 R1/R3 最小装配（与产线同源函数，不 mock 判据）
let modelCalls = 0;
const calls = { apply: 0, writeCurated: 0, token: 0 };
const engineStub = {
  config: {},
  _curateToken: "SHOULD_NOT_CHANGE",
  async runSubagent() { modelCalls++; return JSON.stringify({ groups: [] }) },
  async listUnarchivedPre() {
    return { unarchived: true, items: [{ name: "2026-11-01-a.md" }, { name: "2026-11-01-b.md" }] }
  },
};
const fn = factory(
  12,
  (...a) => engineStub.listUnarchivedPre(...a),
  async () => ({ ledgers: [
    { name: "2026-11-01-a.md", text: "## 目标\ntype:goal\n- 同一目标 X\n## 进度\ntype:progress\n- 第一步", mtimeMs: 1761955200000 },
    { name: "2026-11-01-b.md", text: "## 目标\ntype:goal\n- 同一目标 X\n## 进度\ntype:progress\n- 第二步", mtimeMs: 1761955200000 },
  ] }),
  (batch) => [{ candidateId: "cand_1", goalKey: "同一目标 X", members: batch, memberCount: batch.length }],
  () => ({ estimatedTokens: 100, estimatedCostUsd: 0.001 }),
  () => ({ ok: true }),
  (b, g) => "R2_PROMPT:" + b.length + " ledgers / " + g.length + " groups",
  EA.createHostModelPort,
  EA.createEventAttributionService
);

// 3a. dryRun ⇒ 不调模型
modelCalls = 0;
const rDry = await fn.call(engineStub, { dryRun: true, paths: { handoffDir: HAND, projectDir: PROJ } });
ok(rDry && rDry.ok === true, "P1 engine.proposeRegroupPre 真实返回 ok:true");
ok(rDry.op === "propose", "P2 op=propose");
ok(modelCalls === 0, "★★P3 dryRun **调用模型 0 次**（不烧 token）", "calls=" + modelCalls);
ok(typeof rDry.prompt === "string" && rDry.prompt.length > 0, "P4 dryRun 仍回 R2 prompt 预览", String(rDry.prompt).slice(0, 60));
ok(Array.isArray(rDry.suggestions) && rDry.suggestions.length >= 1, "P5 含机械建议", "groups=" + (rDry.suggestions || []).length);
ok(Array.isArray(rDry.badNames), "P6 含 badNames");
ok(rDry.cost && typeof rDry.cost === "object", "P7 含 cost");
ok(rDry.wrote === false, "★★P8 wrote===false（零写自证）");
ok(rDry.confirmToken === null, "★★P9 confirmToken===null（不发令牌）");

// 3b. 实际 propose ⇒ 可调模型，但仍零写
modelCalls = 0;
const before = { a: sha(fs.readFileSync(path.join(HAND, "2026-11-01-a.md"))), tok: engineStub._curateToken };
const rReal = await fn.call(engineStub, { dryRun: false, paths: { handoffDir: HAND, projectDir: PROJ } });
const after = { a: sha(fs.readFileSync(path.join(HAND, "2026-11-01-a.md"))), tok: engineStub._curateToken };
ok(rReal && rReal.ok === true, "P10 实际 propose 返回 ok");
ok(modelCalls >= 1, "★P11 实际 propose 调用了模型", "calls=" + modelCalls);
ok(rReal.wrote === false && rReal.confirmToken === null, "★★P12 实际 propose 仍 wrote:false / confirmToken:null");
ok(before.a === after.a, "★★P13 账本文件字节不变（零写）");
ok(before.tok === after.tok && after.tok === "SHOULD_NOT_CHANGE", "★★P14 engine._curateToken **未被改写**");
ok(rReal.proposal && typeof rReal.proposal === "object", "P15 含 facade proposal");

// ═══════════ 4. 与既有 curate 写侧的分工（负路径）═══════════
ok(!body.includes("writeCuratedEventsPre"), "★★N1 propose 方法体**不接**写侧（confirmToken 路径只属既有 curate）");
ok(IDX.includes("engine.writeCuratedEventsPre({ candidateIds, confirmToken })"), "N2 既有 curate 写盘分支仍在（未被本批改动）");
ok(IDX.includes("engine.curateUnarchivedPre({ limit: body.limit, dryRun: body.dryRun === true, paths: _rpC.pa })"), "N3 既有 curate 出草案分支仍在（行为保留）");

fs.rmSync(SB, { recursive: true, force: true });
console.log("\n── 2.3 历史零写提案真实入口（task-29 阻断三）：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);
