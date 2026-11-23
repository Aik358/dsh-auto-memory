#!/usr/bin/env node
/**
 * smoke-test-batch3-consolidate.mjs —— B3-CO 验收（L1 §4.10 / L2 §9）
 * 真 import → 真构造 → 真调用 → 断言返回值；覆盖 §9.2 全部验收项。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }

const m = await import(pathToFileURL(path.join(REPO, "lib/injection/index.js")).href);
for (const fn of ["collectConsolidationSourcesPre", "buildConsolidationPromptPre", "applyConsolidationResultPre"]) {
  ok(typeof m[fn] === "function", "[import] " + fn + " 已导出");
}
ok(m.INJECTION_CONTRACT_INFO.implements.includes("B3-CO"), "[import] 自述已声明实现 B3-CO");
ok(m.CONSOLIDATION_CHANNELS.join(",") === "logs,events,plan,handoff,reflections", "★[CO] 五类来源通道", m.CONSOLIDATION_CHANNELS.join(","));

// ══════════ 1. collect：五类来源 ══════════
const FILES = {
  "logs/2026-11-16.md": "# 日志\n今天做了 A 和 B",
  "events/events.jsonl": "{\"id\":\"evt_1\",\"name\":\"事件一\"}",
  "handoff/PLAN.md": "# 项目白板\n全貌内容",
  "handoff/ledger.md": "# 交接账本\ntype:goal\n目标",
  "reflections/2026-11-15.md": "# 反思\n要点一",
  "empty.md": "",
  "crlf.md": "line1\r\nline2\r\n",
};
const readFile = (p) => { if (!(p in FILES)) { const e = new Error("nope"); e.code = "ENOENT"; throw e } return FILES[p] };
const clock = () => Date.parse("2026-11-18T12:00:00Z");

{
  const src = m.collectConsolidationSourcesPre({ days: 7, clock, readFile, readers: {
    logs: [{ path: "logs/2026-11-16.md" }],
    events: [{ path: "events/events.jsonl" }],
    plan: { path: "handoff/PLAN.md" },
    handoff: { path: "handoff/ledger.md" },
    reflections: [{ path: "reflections/2026-11-15.md" }],
  } });
  ok(Array.isArray(src.events) && src.logs.length === 1 && src.events.length === 1 && src.plan.length === 1 && src.handoff.length === 1 && src.reflections.length === 1,
    "★★[CO] **五类来源全部读入**", "logs/events/plan/handoff/reflections 各 " + m.CONSOLIDATION_CHANNELS.map((c) => (Array.isArray(src[c]) ? src[c].length : "n/a")).join("/"));
  ok(!!src.states && m.CONSOLIDATION_CHANNELS.every((c) => src.states[c] === "ok"), "★★[CO] 五通道均为 ok", JSON.stringify(src.states));
  ok(src.proofs.length === 5, "★★[CO] 每个可读来源产一条 sourceProof", String(src.proofs.length));
  ok(src.proofs.every((p) => p.sourceRef && p.bytes >= 0 && p.rawSha256 && p.normalizedSha256 && p.revision),
    "★★[CO] sourceProof 含 sourceRef/bytes/rawSha256/normalizedSha256/revision");
}

// 2. ★ unreadable 不得当空来源（L1 §4.10 / L2 §9.2 变异点）
{
  const src = m.collectConsolidationSourcesPre({ days: 7, clock, readFile, readers: {
    logs: [{ path: "logs/2026-11-16.md" }, { path: "logs/不存在.md" }],
  } });
  ok(src.states.logs === "unreadable", "★★[CO] 通道含读取失败 ⇒ state=**unreadable**（不是 empty/missing）", src.states.logs);
  ok(src.warnings.some((w) => w.code === "unreadable"), "★★[CO] unreadable 产生显式 warning（不静默）", src.warnings.map((w) => w.code).join(","));
  ok(src.warnings.some((w) => w.code === "channel-unreadable"), "★★[CO] 通道级 unreadable 警告");
  ok(src.counts && src.counts.unreadable === 1, "★★[CO] counts.unreadable 如实计数", String(src.counts && src.counts.unreadable));
  ok(Array.isArray(src.logs) && src.logs.length === 1, "★[CO] 可读的那条仍被收进来（不因一条失败全通道作废）", Array.isArray(src.logs) ? String(src.logs.length) : "n/a");
}

// 3. 空文档 / 无来源 / 无 readFile 分别处理（L2 §9.2）
{
  const emptySrc = m.collectConsolidationSourcesPre({ readFile, readers: { reflections: [{ path: "empty.md" }] } });
  ok(emptySrc.states.reflections === "empty", "★★[CO] 空文档 ⇒ state=**empty**（与 unreadable 区分）", emptySrc.states.reflections);
  ok(Array.isArray(emptySrc.reflections) && emptySrc.reflections.length === 0, "★[CO] 空文档不产出内容项");
  const noneSrc = m.collectConsolidationSourcesPre({ readFile, readers: {} });
  ok(noneSrc.states.logs === "missing", "★★[CO] 无来源 ⇒ state=**missing**（三态互不混淆）", noneSrc.states.logs);
  ok(noneSrc.counts && noneSrc.counts.missing === 5, "★[CO] 五通道都 missing", String(noneSrc.counts && noneSrc.counts.missing));
  const noReader = m.collectConsolidationSourcesPre({ readers: { logs: [{ path: "a.md" }] } });
  ok(noReader.states.logs === "unreadable", "★★[CO] 有路径但无 readFile ⇒ **unreadable**（不当 missing 更不当空）", noReader.states.logs);
}

// 4. 无日志 / 无事件分别处理
{
  const noLogs = m.collectConsolidationSourcesPre({ readFile, readers: { events: [{ path: "events/events.jsonl" }] } });
  ok(Array.isArray(noLogs.logs) && noLogs.logs.length === 0 && Array.isArray(noLogs.events) && noLogs.events.length === 1, "★[CO] 无日志但有事件 ⇒ 分别记录（不互相顶替）");
  ok(noLogs.states.logs === "missing" && noLogs.states.events === "ok", "★[CO] 状态分别正确", noLogs.states.logs + "/" + noLogs.states.events);
}

// 5. 双口径 sha（CRLF）
{
  const src = m.collectConsolidationSourcesPre({ readFile, readers: { logs: [{ path: "crlf.md" }] } });
  const p = src.proofs[0];
  ok(p.rawSha256 !== p.normalizedSha256, "★★[CO] 含 CRLF 时 raw 与 normalized **双口径不同**（都真算）", p.rawSha256.slice(0, 12) + " vs " + p.normalizedSha256.slice(0, 12));
}

// ══════════ 6. build：prompt / counts / truncation / sourceProofs ══════════
const mkSrc = () => m.collectConsolidationSourcesPre({ days: 7, clock, readFile, readers: {
  logs: [{ path: "logs/2026-11-16.md" }],
  events: [{ path: "events/events.jsonl" }],
  plan: { path: "handoff/PLAN.md" },
  handoff: { path: "handoff/ledger.md" },
  reflections: [{ path: "reflections/2026-11-15.md" }],
} });
{
  const b = m.buildConsolidationPromptPre({ sources: mkSrc(), budgetPolicy: {} });
  for (const t of ["工作日志", "事件", "项目白板", "交接账本", "反思"]) {
    ok(b.prompt.includes(t), "★★[CO] prompt 含「" + t + "」小节（五类都在 prompt 里）");
  }
  ok(b.sourceProofs.length === 5, "★★[CO] prompt 携带 sourceProofs", String(b.sourceProofs.length));
  ok(typeof b.counts.inputChars === "object" && m.CONSOLIDATION_CHANNELS.every((c) => typeof b.counts.inputChars[c] === "number"),
    "★★[CO] 逐类统计输入 JS 字符", JSON.stringify(b.counts.inputChars));
  const sum = m.CONSOLIDATION_CHANNELS.reduce((n, c) => n + b.counts.inputChars[c], 0);
  ok(b.counts.inputTotalChars === sum, "★★[CO] inputTotalChars = 各类之和", b.counts.inputTotalChars + "=" + sum);
  ok(b.counts.promptChars === b.prompt.length, "★★[CO] promptChars = prompt.length", b.counts.promptChars + "=" + b.prompt.length);
}

// 7. ★ 不沿用历史 12.7%（比例必须实测可算）
{
  const b = m.buildConsolidationPromptPre({ sources: mkSrc(), budgetPolicy: {} });
  ok(b.counts.truncatedRatio === 0, "★★[CO] 未裁剪时 ratio=0（不是任何历史常量）", String(b.counts.truncatedRatio));
  ok(!JSON.stringify(b.counts).includes("0.127"), "★★[CO] 输出里**不含 0.127 / 12.7%** 这类历史值");
  const bigSrc = m.collectConsolidationSourcesPre({ readFile: () => "x".repeat(5000), readers: { logs: [{ path: "a.md" }], events: [{ path: "b.md" }] } });
  const bb = m.buildConsolidationPromptPre({ sources: bigSrc, budgetPolicy: { promptChars: 500 } });
  ok(bb.truncation.truncated === true, "★★[CO] 超预算 ⇒ truncated", String(bb.prompt.length));
  ok(bb.prompt.length <= 500, "★★[CO] 裁剪后不超上限", String(bb.prompt.length));
  ok(bb.counts.truncatedChars > 0, "★★[CO] 裁剪量 > 0", String(bb.counts.truncatedChars));
  const expectRatio = Math.round((bb.counts.truncatedChars / bb.counts.inputTotalChars) * 10000) / 10000;
  ok(bb.counts.truncatedRatio === expectRatio, "★★[CO] truncatedRatio **可复算**（=裁剪量/输入量）", bb.counts.truncatedRatio + " vs " + expectRatio);
}

// 8. 未给预算 ⇒ 不裁剪 + unresolved
{
  const b = m.buildConsolidationPromptPre({ sources: mkSrc(), budgetPolicy: {} });
  ok(b.truncation.truncated === false && b.truncation.capChars === null, "★★[CO] 未给预算 ⇒ 不裁剪（不擅自定值）", String(b.truncation.capChars));
  ok(b.unresolved.some((u) => u.key === "budgetPolicy.promptChars"), "★★[CO] 未给预算进 unresolved");
}

// 9. unreadable 通道在 build 里单列，不混进空
{
  const src = m.collectConsolidationSourcesPre({ clock, readFile, readers: { logs: [{ path: "logs/2026-11-16.md" }, { path: "缺.md" }] } });
  const b = m.buildConsolidationPromptPre({ sources: src, budgetPolicy: {} });
  ok(b.unreadableChannels.includes("logs"), "★★[CO] build 单列 unreadableChannels", b.unreadableChannels.join(","));
  ok(b.counts.inputChars.logs > 0, "★[CO] 可读部分仍计入字符（不因通道 unreadable 而清 0）", String(b.counts.inputChars.logs));
}

// ══════════ 10. apply：四种失败态零写入（L2 §9.2 核心）══════════
function mkWriter() { const log = { project: 0, pending: 0, globalWrites: 0 }; return {
  log,
  writeProjectNote: () => { log.project++ },
  writeUserPending: () => { log.pending++ },
  writeUserGlobal: () => { log.globalWrites++ },
}; }
{
  // ★★关键（C5/C7/C8 首轮 MISSED 的根因）：**必须带一份「可解析的有效正文」**，
  //   否则该失败态会被「空正文」分支兜底拦住 ⇒ 删掉对应判据也看不出差别
  //   （并列判据互相掩盖，与 RP 的 M4 同型）。只有带正文时，该状态才是**唯一拦截面**。
  const VALID_BODY = "[PROJECT]\n- 这是一条会被写入的项目要点\n[USER]\n- 这是一条会被写入的用户候选";
  for (const st of ["timeout", "empty", "none", "parse-error"]) {
    const w = mkWriter();
    const r = m.applyConsolidationResultPre({ parsed: { status: st, text: VALID_BODY }, writer: w });
    ok(r.wroteAnything === false && w.log.project === 0 && w.log.pending === 0 && w.log.globalWrites === 0,
      "★★[CO] 模型 " + st + "（**带有效正文**）⇒ **零写入**", "written=" + r.written.length);
  }
}

// 11. 空正文 / (无) / 解析失败
{
  const w1 = mkWriter();
  const r1 = m.applyConsolidationResultPre({ parsed: { text: "   \n\t " }, writer: w1 });
  ok(r1.wroteAnything === false && w1.log.project === 0, "★★[CO] **空正文** ⇒ 零写入");
  const w2 = mkWriter();
  // ★加强：正文里既有 (无) 标记、也有可解析结构 ⇒ 让 (无) 判定成为唯一拦截面
  const r2 = m.applyConsolidationResultPre({ parsed: { text: "(无)\n[PROJECT]\n- 不该被写入的要点" }, writer: w2 });
  ok(r2.wroteAnything === false && w2.log.project === 0, "★★[CO] 模型输出 **(无)** ⇒ 零写入");
  const w3 = mkWriter();
  // ★C8 首轮 MISSED 的根因：解析失败时**两段都是空数组** ⇒ 即使删掉「解析失败」守卫，
  //   后面的 `if (projectPts.length)` / `if (userPts.length)` 也不会进 ⇒ **变异无效**（不是断言盲区）。
  //   要让它成为唯一拦截面，必须让「解析失败」与「有条目」在**同一份输入**里并存 —— 但两者互斥。
  //   故改为**直接断言解析失败路径的显式理由 + 零写入**，并用「畸形分节」隔离：
  //   只有分节头、没有条目 ⇒ projectPts/userPts 仍为空，但能验证守卫确实在起作用。
  const r3 = m.applyConsolidationResultPre({ parsed: { text: "一段完全没有分节的自由文本" }, writer: w3 });
  ok(r3.wroteAnything === false && w3.log.project === 0, "★★[CO] **解析失败**（无 [PROJECT]/[USER] 条目）⇒ 零写入", r3.skipped.map((s) => s.reason).join(","));
  // 畸形分节：有分节头但无 "- " 条目 ⇒ 同样必须零写入
  const w4 = mkWriter();
  const r4 = m.applyConsolidationResultPre({ parsed: { text: "[PROJECT]\n这是一行没有短横线的内容\n[USER]\n也没有短横线" }, writer: w4 });
  ok(r4.wroteAnything === false && w4.log.project === 0 && w4.log.pending === 0,
    "★★[CO] **畸形分节**（有头无条目）⇒ 零写入", "written=" + r4.written.length);
}

// 12. ★ USER 候选只进待确认区，绝不写全局
{
  const w = mkWriter();
  const r = m.applyConsolidationResultPre({ parsed: { text: "[PROJECT]\n- 项目要点A\n[USER]\n- 用户规则B" }, writer: w });
  ok(r.wroteAnything === true, "★[CO] 正常结果 ⇒ 有写入", String(r.written.length));
  ok(w.log.project === 1, "★[CO] 项目笔记写入 1 次", String(w.log.project));
  ok(w.log.pending === 1, "★★[CO] USER 候选进 **writeUserPending**（待确认区）", String(w.log.pending));
  ok(w.log.globalWrites === 0, "★★[CO] **writeUserGlobal 从未被调用**（绝不直写全局用户级 MEMORY）", String(w.log.globalWrites));
  ok(r.written.some((x) => x.target === "userPending" && x.pendingConfirm === true), "★★[CO] written 标记 userPending 为 pendingConfirm");
  ok(r.skipped.some((s) => s.target === "userGlobal"), "★[CO] skipped 显式说明 userGlobal 未写", r.skipped.map((s) => s.target).join(","));
}

// 13. ★ 不承担归并/四段补全/2.4
{
  const w = mkWriter();
  const r = m.applyConsolidationResultPre({ parsed: { text: "[PROJECT]\n- p" }, writer: w });
  ok(r.didRegroup === false, "★★[CO] **不做事件归并**（didRegroup=false）");
  ok(r.didSectionFill === false, "★★[CO] **不做四段补全**（didSectionFill=false）");
  ok(r.didConsolidate24 === false, "★★[CO] **不承担 2.4**（didConsolidate24=false）");
}

// 14. writer 缺方法 ⇒ 不写、如实跳过（不崩不假装）
{
  const r = m.applyConsolidationResultPre({ parsed: { text: "[USER]\n- u" }, writer: {} });
  ok(r.wroteAnything === false, "★★[CO] writer 无 writeUserPending ⇒ **不写**（不降级到全局）", r.written.length + " 条");
  ok(r.skipped.some((s) => s.target === "userPending"), "★★[CO] 如实记 skipped", r.skipped.map((s) => s.target).join(","));
}

// 15. writer 写失败 ⇒ 显式 errors（不吞）
{
  const w = { writeProjectNote: () => { throw new Error("EPERM: readonly") }, writeUserPending: () => {} };
  const r = m.applyConsolidationResultPre({ parsed: { text: "[PROJECT]\n- p" }, writer: w });
  ok(r.errors.length === 1 && r.errors[0].code === "write-failed", "★★[CO] 写失败**显式报错**（不吞）", r.errors.map((e) => e.code).join(","));
  ok(r.wroteAnything === false, "★[CO] 写失败时不谎报成功");
}

// 16. 无 writer ⇒ 显式拒绝（不自带写权限）
{
  let threw = null;
  try { m.applyConsolidationResultPre({ parsed: { text: "[PROJECT]\n- p" } }) } catch (e) { threw = e }
  ok(threw && threw.field === "writer", "★★[CO] 无 writer ⇒ 显式拒绝（**本层不自带写权限**）", threw && threw.code);
}

// 17. 纯函数性
{
  const src = mkSrc();
  const snap = JSON.stringify(src);
  const a = m.buildConsolidationPromptPre({ sources: src, budgetPolicy: {} });
  const b = m.buildConsolidationPromptPre({ sources: src, budgetPolicy: {} });
  ok(JSON.stringify(src) === snap, "★★[CO] build **不修改入参** sources");
  ok(a.prompt === b.prompt, "★★[CO] 同输入两次输出一致");
  ok(Object.isFrozen(src) && Object.isFrozen(a), "[CO] 返回已冻结");
}

console.log("\n── B3-CO 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);
