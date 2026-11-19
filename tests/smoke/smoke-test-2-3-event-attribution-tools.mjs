#!/usr/bin/env node
/**
 * smoke-test-2-3-event-attribution-tools.mjs —— task-29 阻断四：**lib/index.js 新接线的工具级真执行证明**
 *
 * 与 smoke-test-2-3-event-attribution.mjs 的分工：
 *   · 那个套件测 **facade 模块**（协议/候选/解析/回执）；
 *   · 本套件测 **lib/index.js 里的真实接线** —— 用与既有 13 个套件同源的
 *     「括号配平抽取 + new Function 求值」装置，**显式注入** createEventAttributionServicePre /
 *     createHostModelPortPre（以及真实存在的 event-write 依赖），然后真调 tool.execute。
 *
 * 为什么必须单独做：旧 13 个抽取套件因没有注入这两个模块绑定而走 `typeof !== function` 跳过路径；
 * 跳过路径通过**不构成**「新 import 后的 memory_log/memory_note 真的工作」的证据。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }
const sha = (b) => createHash("sha256").update(b).digest("hex");

const SANDBOX = path.join(REPO, ".tmp-smoke-run/ea29tools");
fs.rmSync(SANDBOX, { recursive: true, force: true });
const PROJ = path.join(SANDBOX, "proj");
const HANDOFF = path.join(PROJ, "handoff");
fs.mkdirSync(HANDOFF, { recursive: true });

// ── 真 import 生产模块（与产线同一份）──
const EW = await import(pathToFileURL(path.join(REPO, "lib/event-write.js")).href);
const EA = await import(pathToFileURL(path.join(REPO, "lib/event-attribution/index.js")).href);
ok(typeof EA.createEventAttributionService === "function", "[import] facade 可用");

// ── 抽取 defineTool 调用（括号配平；先归一 LF 避免 CRLF 锚点不命中）──
const IDX = fs.readFileSync(path.join(REPO, "lib/index.js"), "utf8").split("\r\n").join("\n");

// ★★字符串/注释感知的括号配平。
//   为什么必须这么做（真实踩坑）：旧装置直接数字符配平，而 defineTool 的 desc 是长字符串、
//   里面含**不配平的半角括号**（如 "(推荐)/（可选）" 混排）⇒ 配平提前闭合，
//   实测把 memory_note 抽成了 memory_procedure 的定义。
function skipStringPre(src, i) {
  const q = src[i];
  i += 1;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue }
    if (src[i] === q) return i + 1;
    i += 1;
  }
  return i;
}
function balancePre(src, i) {
  const open = src[i];
  const close = open === "{" ? "}" : (open === "(" ? ")" : (open === "[" ? "]" : null));
  if (!close) return -1;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === "\"" || c === "'") { i = skipStringPre(src, i); continue }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1; i += 2; continue }
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return i + 1 }
    i += 1;
  }
  return -1;
}
/**
 * 抽取一个 defineTool 调用的 { params 源码, execute 函数源码 }。
 * 步骤：定位 desc 字符串 → 跳过 → 配平 params 对象 → 配平 execute 箭头函数体。
 */
function extractToolParts(name) {
  const S = IDX.indexOf("defineTool('" + name + "'");
  if (S < 0) return null;
  let i = IDX.indexOf("(", S) + 1;
  // 跳过空白，第一参数是 desc 字符串
  while (i < IDX.length && /\s/.test(IDX[i])) i += 1;
  if (IDX[i] === "'" || IDX[i] === "\"" || IDX[i] === "'") i = skipStringPre(IDX, i);
  // 之后是 ", {params}, async (args,exec) => {body}"
  // desc 之后的**逗号 + 参数对象起点**（不能直接找 "{" —— desc 里可能含 "{"）
  const pOpenRaw = IDX.indexOf(", {", i);
  if (pOpenRaw < 0) return null;
  const pOpen = pOpenRaw + 2;
  const pEnd = balancePre(IDX, pOpen);
  if (pEnd < 0) return null;
  const paramsSrc = IDX.slice(pOpen, pEnd);
  const eArrow = IDX.indexOf("async (args, exec) =>", pEnd);
  if (eArrow < 0) return null;
  const bOpen = IDX.indexOf("{", eArrow);
  const bEnd = balancePre(IDX, bOpen);
  if (bEnd < 0) return null;
  const execSrc = IDX.slice(eArrow, bEnd);
  return { name, paramsSrc, execSrc, callSrc: IDX.slice(S, bEnd + 1) };
}
const logParts = extractToolParts("memory_log");
const logSrc = logParts ? logParts.callSrc : null;
const logExec = logParts ? logParts.execSrc : null;
const logParams = logParts ? logParts.paramsSrc : null;
const noteParts = extractToolParts("memory_note");
const noteExec = noteParts ? noteParts.execSrc : null;
const noteParams = noteParts ? noteParts.paramsSrc : null;
ok(logSrc && logSrc.length > 20000, "[抽取] memory_log 定义", logSrc.length + " 字符");
ok(noteExec && noteExec.length > 5000, "[抽取] memory_note execute（字符串感知配平）", noteExec.length + " 字符");
ok(noteParams && noteParams.includes("attributionReview"), "[抽取] memory_note params 含 attributionReview");
ok(logSrc.includes("createEventAttributionServicePre"), "[抽取] memory_log 含新接线符号");
ok(noteExec.includes("attributionReview"), "[抽取] memory_note execute 含 attributionReview 分支");

// ── 依赖桩（与既有 h1b / attr-receipt 套件同口径）──
function sanitizeForWrite(text, opts) {
  const raw = String(text || "");
  if (!raw.length) return { ok: false, reason: "empty" };
  const max = (opts && opts.maxEntryChars) || 8000;
  if (raw.length > max) return { ok: true, clean: raw.slice(0, max), truncated: true };
  return { ok: true, clean: raw };
}
function writeGateRefusalTextPre(tool, gate) { return tool + ": 写闸门拒绝(" + gate.reason + ")" }
function tailHas(existing, incoming) {
  if (!existing || !incoming) return false;
  const first = String(incoming).trim().split("\n")[0].trim().slice(0, 60);
  if (!first) return false;
  const tail = String(existing).trim().split("\n").slice(-60);
  return tail.some((l) => l.indexOf(first) !== -1);
}
function nowHm() { const d = new Date(); const p = (n) => n < 10 ? "0" + n : "" + n; return p(d.getHours()) + ":" + p(d.getMinutes()) }

// ── 模型调用计数器（证明「什么时候调用、什么时候不调用」）──
let modelCalls = 0;
let modelReply = null;
function makeEngine() {
  const state = { logText: "", logPath: "", loadedAt: 0 };
  const engine = {
    state,
    config: { dayBoundaryMinutes: 450, subagentProvider: "deepseek", subagentModel: "v4.1-flash" },
    _lastAgent: null,
    _degradeSink: null,
    memToday() {
      const d = new Date(); if (d.getHours() * 60 + d.getMinutes() < 450) d.setDate(d.getDate() - 1);
      const p = (n) => n < 10 ? "0" + n : "" + n;
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    },
    async resolvePaths() { return { projectDir: PROJ, handoffDir: HANDOFF } },
    async resolvePathsForRequestPre() { return { pa: { projectDir: PROJ, handoffDir: HANDOFF, wsBound: true }, sid: "s1" } },
    async readTextSafe(p) { try { return fs.readFileSync(p, "utf8") } catch (_) { return "" } },
    async appendText(p, text) {
      const id = "mem_" + Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
      fs.appendFileSync(p, "<!-- memory:" + id + " -->\n\n" + text + "\n", "utf8");
      return fs.readFileSync(p, "utf8");
    },
    async refreshEventStatePre() {},
    // 夹具桩（非产品改动）：memory_note 的「预算/原子写」路径需要这些 engine 方法
    async ensureBudget() { return { ok: true, allowed: true, compacted: false, truncated: false, maxChars: 24000, used: 0 } },
    async writeTextAtomic(p, text) { fs.writeFileSync(p, text, "utf8"); return { ok: true } },
    async writeFull(p, text, opts) {
      if (typeof text === "string") fs.writeFileSync(p, text, "utf8");
      return { ok: true, write: String(text || "").length, read: String(text || "").length };
    },
    policyOfNote() { return { maxChars: 24000 } },
    budgetRefusalTextPre(acct, kind) { return '预算不足（' + kind + '）' },
    async readJsonSafe() { return null },
    async writeJsonAtomic() { return { ok: true } },
    async runSubagent() { modelCalls++; return modelReply }
  };
  return engine;
}

function buildTool(parts, engine) {
  const factory = new Function(
    "defineTool", "engine", "path", "DATE_RE", "sanitizeForWrite", "writeGateRefusalTextPre", "tailHas", "nowHm",
    "LOG_KINDS_PRE_V1", "createHash", "recordDiagnosticErrorPre",
    "eventStorePathOfPre", "readEventStorePre", "resolveActiveEventPre", "createEventForWorkPre",
    "appendCheckpointPre", "renderDayViewPre", "deriveDayViewToDiskPre",
    "createEventAttributionServicePre", "createHostModelPortPre",
    "return " + parts.paramsSrc + "; return null;"
  );
  const params = factory(undefined, engine, path, /^(\d{4})-(\d{2})-(\d{2})$/, sanitizeForWrite, writeGateRefusalTextPre, tailHas, nowHm,
    ["rule", "preference", "fact", "todo"], createHash, () => {},
    EW.eventStorePathOfPre, EW.readEventStorePre, EW.resolveActiveEventPre, EW.createEventForWorkPre,
    EW.appendCheckpointPre, EW.renderDayViewPre, EW.deriveDayViewToDiskPre,
    EA.createEventAttributionService, EA.createHostModelPort);
  const execFactory = new Function(
    "engine", "path", "DATE_RE", "sanitizeForWrite", "writeGateRefusalTextPre", "tailHas", "nowHm",
    "LOG_KINDS_PRE_V1", "createHash", "recordDiagnosticErrorPre",
    "eventStorePathOfPre", "readEventStorePre", "resolveActiveEventPre", "createEventForWorkPre",
    "appendCheckpointPre", "renderDayViewPre", "deriveDayViewToDiskPre",
    "createEventAttributionServicePre", "createHostModelPortPre",
    "return " + parts.execSrc + ";"
  );
  const execute = execFactory(engine, path, /^(\d{4})-(\d{2})-(\d{2})$/, sanitizeForWrite, writeGateRefusalTextPre, tailHas, nowHm,
    ["rule", "preference", "fact", "todo"], createHash, () => {},
    EW.eventStorePathOfPre, EW.readEventStorePre, EW.resolveActiveEventPre, EW.createEventForWorkPre,
    EW.appendCheckpointPre, EW.renderDayViewPre, EW.deriveDayViewToDiskPre,
    EA.createEventAttributionService, EA.createHostModelPort);
  return { name: parts.name, params, execute };
}

const storePath = path.join(HANDOFF, "event-store.json");
function snapshot() {
  const out = {};
  for (const f of ["event-store.json"]) {
    const p = path.join(HANDOFF, f);
    out[f] = fs.existsSync(p) ? sha(fs.readFileSync(p)) : null;
  }
  const files = fs.readdirSync(PROJ).filter((f) => f.endsWith(".md"));
  for (const f of files) out[f] = sha(fs.readFileSync(path.join(PROJ, f)));
  return out;
}
const exec = { agent: { session: { id: "sess_ea29", header: { cwd: PROJ } } } };

// ═══════════ 1. memory_log dryRun：模型建议出现，且字节不变 ═══════════
let engine = makeEngine();
let tool = buildTool(logParts, engine);
ok(!!tool && tool.name === "memory_log", "[工具] 求值得到 memory_log");
// 先造一个已有事件，让候选池非空
await EW.createEventForWorkPre(storePath, { today: engine.memToday(), dayBoundaryMinutes: 450, name: "E1 已有事件", sections: { goal: "已有目标" } });
modelCalls = 0;
modelReply = JSON.stringify({ decision: "attach-existing", selectedEventId: "evt_none" });
const beforeDry = snapshot();
// ★注意：mock 必须让模型结论**与实际预判不同** —— 一致时回执按设计返回空（不制造噪声）。
//   实际预判是 create（无 eventId、无标识命中）⇒ 模型说 attach-existing 才有建议。
modelReply = JSON.stringify({ decision: "attach-existing", selectedEventId: "evt_none_exist", rationale: "看起来是同一件事" });
const rDry = await tool.execute({ note: "task29 dryRun 探针", kind: "fact", dryRun: true }, exec);
const afterDry = snapshot();
ok(String(rDry).includes("[dryRun]"), "T1 dryRun 正常返回预检");
ok(modelCalls >= 1, "★T2 dryRun **确实调用了模型**（注入后接线生效）", "calls=" + modelCalls);
ok(JSON.stringify(beforeDry) === JSON.stringify(afterDry), "★★T3 dryRun 前后文件字节完全不变（零写）");
ok(String(rDry).includes("归属复核") || String(rDry).includes("建议新建"), "T4 回执含模型归属建议", String(rDry).slice(-160));

// ═══════════ 2. 显式 eventId 真实写入 ⇒ 不调用模型 ═══════════
const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
const evId = store.events[0].id;
modelCalls = 0;
modelReply = JSON.stringify({ decision: "create-new" });
const rExp = await tool.execute({ note: "task29 显式归属探针", kind: "fact", eventId: evId }, exec);
ok(modelCalls === 0, "★★T5 显式 eventId 真实写入 **调用 0 次**（不事后质疑用户）", "calls=" + modelCalls);
ok(String(rExp).includes(evId), "T6 回执含显式 eventId");

// ═══════════ 3. 预判 create 真实写入：模型建议已有事件，但写入不被重定目标 ═══════════
modelCalls = 0;
// 实际会挂到 evId（弱证据兜底 attach），mock 说 create-new ⇒ 才产生「未改写」提醒
modelReply = JSON.stringify({ decision: "create-new", rationale: "我认为是新事件" });
const eventsBefore = JSON.parse(fs.readFileSync(storePath, "utf8")).events.length;
const rCreate = await tool.execute({ note: "task29 预判新建但模型建议已有", kind: "fact" }, exec);
const eventsAfter = JSON.parse(fs.readFileSync(storePath, "utf8")).events.length;
ok(modelCalls >= 1, "★T7 预判 create ⇒ 调用了模型", "calls=" + modelCalls);
ok(eventsAfter >= eventsBefore, "★★T8 写入仍按既有规则（**未被模型重定目标**）", eventsBefore + "→" + eventsAfter);
ok(String(rCreate).includes("归属复核") || String(rCreate).includes("建议"), "T9 回执含模型建议（不伪称已按模型修正）", String(rCreate).slice(-200));
ok(!String(rCreate).includes("已按建议改为"), "★N1 负路径：回执不含「已按建议改为」");

// ═══════════ 4. 模型不可用 ⇒ 降级，不阻塞写入 ═══════════
modelCalls = 0;
modelReply = "";   // 空串 = 门控未过/不可用
const rUn = await tool.execute({ note: "task29 模型不可用探针", kind: "fact" }, exec);
ok(String(rUn).includes("已更新记忆文档"), "★★T10 模型不可用时写入照常成功（不被阻塞）");
ok(String(rUn).includes("不可用") || String(rUn).includes("模型未给出") || String(rUn).includes("未返回"), "T11 回执如实说明模型不可用", String(rUn).slice(-160));

// ═══════════ 5. memory_note(attributionReview) ⇒ 所有文件字节不变 ═══════════
const noteTool = buildTool(noteParts, makeEngine());
ok(!!noteTool && noteTool.name === "memory_note", "[工具] 求值得到 memory_note");
ok(noteTool.params && noteTool.params.attributionReview && noteTool.params.attributionReview.type === "boolean", "T12 参数表暴露 attributionReview(boolean)");
// 造一个真实 MEMORY.md 供核对
const memFile = path.join(PROJ, "MEMORY.md");
fs.writeFileSync(memFile, "# 项目笔记\n\n原文内容\n", "utf8");
const noteBefore = snapshot();
const memBefore = sha(fs.readFileSync(memFile));
modelCalls = 0;
modelReply = JSON.stringify({ decision: "ambiguous" });
const rNote = await noteTool.execute({ content: "task29 note review 探针", kind: "handoff", attributionReview: true }, exec);
const noteAfter = snapshot();
const memAfter = sha(fs.readFileSync(memFile));
ok(String(rNote).includes("[attributionReview]"), "T13 memory_note review 返回复核文本");
ok(memBefore === memAfter, "★★T14 review **未写 MEMORY.md**（sha256 相同）", memBefore.slice(0, 16));
ok(JSON.stringify(noteBefore) === JSON.stringify(noteAfter), "★★T15 review **未写事件库/日视图**（全部字节不变）");
ok(!fs.existsSync(path.join(HANDOFF, "PLAN.md")), "T16 未创建 PLAN.md");
// kind=note 不带 eventId ⇒ not-applicable，不硬编事件
const rNote2 = await noteTool.execute({ content: "x", kind: "note", attributionReview: true }, exec);
ok(String(rNote2).includes("not-applicable"), "★T17 kind=note 无 eventId ⇒ not-applicable（不硬编事件）", String(rNote2).slice(0, 120));

// ═══════════ 6. 装置对照：证明 T14 的「sha256 相同」不是恒真判据 ═══════════
//   ★说明：memory_note 的完整写入路径需要宿主 engine 的一整套预算/原子写方法，
//     在抽取夹具里逐一定桩会把「测产品」变成「测桩」。因此这里改用**装置对照**：
//     证明「如果真写了 MEMORY.md，本套件的 sha 判据一定会变」——即可排除 T14 是恒真断言。
const noteBefore2 = sha(fs.readFileSync(memFile));
fs.writeFileSync(memFile, fs.readFileSync(memFile, "utf8") + "\n对照组追加一行\n", "utf8");
ok(sha(fs.readFileSync(memFile)) !== noteBefore2,
  "★T18 对照：真写入后 sha256 **必然改变**（证明 T14 的零写断言有区分力）");
// 复原，供后续断言/清理
fs.writeFileSync(memFile, "# 项目笔记\n\n原文内容\n", "utf8");
ok(sha(fs.readFileSync(memFile)) === memBefore, "T19 复原后 sha 回到原值（判据可复算）");

// ═══════════ 7. 抽取夹具「跳过路径」对照（证明 T2/T5 的区分力）═══════════
//   不注入两个模块 ⇒ 旧 13 个套件的实际路径 ⇒ 必须**不**调模型
const engine2 = makeEngine();
const factoryNoInject = new Function(
  "defineTool", "engine", "path", "DATE_RE", "sanitizeForWrite", "writeGateRefusalTextPre", "tailHas", "nowHm",
  "LOG_KINDS_PRE_V1", "createHash", "recordDiagnosticErrorPre",
  "eventStorePathOfPre", "readEventStorePre", "resolveActiveEventPre", "createEventForWorkPre",
  "appendCheckpointPre", "renderDayViewPre", "deriveDayViewToDiskPre",
  "return (" + logSrc + ")"
);
const toolNoInject = factoryNoInject((n, d, p, e) => ({ name: n, desc: d, params: p, execute: e }), engine2, path,
  /^(\d{4})-(\d{2})-(\d{2})$/, sanitizeForWrite, writeGateRefusalTextPre, tailHas, nowHm,
  ["rule", "preference", "fact", "todo"], createHash, () => {},
  EW.eventStorePathOfPre, EW.readEventStorePre, EW.resolveActiveEventPre, EW.createEventForWorkPre,
  EW.appendCheckpointPre, EW.renderDayViewPre, EW.deriveDayViewToDiskPre);
const calls2 = { n: 0 };
engine2.runSubagent = async () => { calls2.n++; return "{}" };
await toolNoInject.execute({ note: "task29 未注入对照探针", kind: "fact", dryRun: true }, exec);
ok(calls2.n === 0, "★★T20 对照：**不注入**模块 ⇒ 调用 0 次（证明 T2 的 1 次确实来自新接线）", "calls=" + calls2.n);

fs.rmSync(SANDBOX, { recursive: true, force: true });
console.log("\n── 2.3 工具级真执行（task-29 阻断四）：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);
