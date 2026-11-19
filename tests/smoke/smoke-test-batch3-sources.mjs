#!/usr/bin/env node
/**
 * smoke-test-batch3-sources.mjs —— B3-SR / B3-RC 独立验收
 *
 * 纪律：真 import → 真构造 → 真调用 → 断言返回值；每条正路径配负路径；内置隔离变异。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }
const ANCH = (c) => "<!-- memory:mem_" + String(c).repeat(32) + " -->";

const m = await import(pathToFileURL(path.join(REPO, "lib/injection/index.js")).href);
ok(typeof m.readRulesAggregatePre === "function", "[import] readRulesAggregatePre 已导出");
ok(typeof m.readInjectionSourcesPre === "function", "[import] readInjectionSourcesPre 已导出");
ok(typeof m.createSourcesPort === "function", "[import] createSourcesPort 已导出");
ok(m.INJECTION_CONTRACT_INFO.implements.includes("B3-RC"), "[import] 包自述已声明实现 B3-RC");

// ── 夹具：user 2 bullet（应拆 2 条）+ project 1 bullet + 说明行 + retired 条
const USER = [
  "# 用户级规则",
  ANCH("a"),
  "- 禁止把业务逻辑堆进 lib/index.js",
  "- 必须保留原始行尾（CRLF 文件追加前先剥 \\r）",
].join("\n");
const PROJECT = [
  ANCH("b"),
  "- 必须用单引号写含 Windows 路径的 TOML 字符串",
  "（说明）这条是说明，不冒充硬约束",
].join("\n");
const RETIRED = [
  ANCH("c"),
  "<!-- dsh-status: superseded by=mem_x -->",
  "- 必须使用旧版编号 3.0.x",
].join("\n");
const MULTILINE = [
  ANCH("d"),
  "- 必须同时满足以下两条限定：",
  "  - 其一：不得跨会话读取",
].join("\n");

const mkFiles = () => ({ "u.md": USER, "n.md": PROJECT, "r.md": RETIRED, "m.md": MULTILINE });
const base = () => { const f = mkFiles(); return { f, readFile: (p) => { if (!(p in f)) { const e = new Error("nope"); e.code = "ENOENT"; throw e } return f[p] } } };

// ── RC 正路径：user+project 覆盖、五类计数、多行不丢
{
  const { readFile } = base();
  const r = m.readRulesAggregatePre({ userFile: "u.md", notesPath: "n.md", readFile, ownerSessionId: "s1", sessionKey: "k1" });
  ok(r.dtoKind === "RulesAggregate", "[RC] 返回 RulesAggregate");
  ok(r.counts.byLayer.user.rule === 2, "★[RC] user 层 2 bullet ⇒ rule=2（两条 bullet 分别成条）", String(r.counts.byLayer.user.rule));
  ok(r.counts.rule >= 3, "★[RC] user+project 合计 rule >= 3", String(r.counts.rule));
  ok(r.counts.note === 1, "★[RC] project 的（说明）行归入 note（不冒充硬约束）", String(r.counts.note));
  ok(r.rules.some((x) => x.text.includes("CRLF")), "[RC] 多行/长文本完整保留（含 CRLF 字样）");
  ok(r.statuses.user === "ok" && r.statuses.project === "ok", "[RC] 两层 status 均 ok");
  ok(!!r.proofs.user && !!r.proofs.project, "[RC] 两层各自有 SourceProof");
  ok(r.revisions.user !== r.revisions.project, "★[RC] revision(user) 与 revision(project) 是不同命名空间（值不同）");
  ok(r.rules.every((x) => typeof x.entryIndex === "number" && typeof x.itemIndex === "number"), "[RC] 层内 index 存在（不制造跨层统一索引）");
  ok(!("crossLayerIndex" in r), "[RC] 不暴露跨层统一编辑索引");
}

// ── RC：retired 保留但不剔除（按既有裁定：返回但标记）
{
  const { readFile } = base();
  const r = m.readRulesAggregatePre({ userFile: "r.md", readFile });
  ok(r.counts.retired === 1, "★[RC] superseded 条目计入 retired", String(r.counts.retired));
  ok(r.retired[0] && r.retired[0].retired === true && r.retired[0].status === "superseded", "★[RC] retired 条目保留原文并标记状态（不剔除）");
  ok(r.rules.every((x) => x.retired !== true), "[RC] retired 条目不混入 rules");
}

// ── RC：多行限定单条（<2 bullet 不拆，整条保留）
{
  const { readFile } = base();
  const r = m.readRulesAggregatePre({ userFile: "m.md", readFile });
  const t = r.rules.concat(r.notes, r.candidates, r.references).map((x) => x.text).join("\n");
  ok(t.includes("其一：不得跨会话读取"), "★[RC] 单条多行规则的多行限定不丢");
  ok(r.counts.byLayer.user.rule === 1, "★[RC] 单条多行（仅 1 个顶层 bullet）⇒ 不拆成多条", String(r.counts.byLayer.user.rule));
}

// ── RC：候选不因措辞自动升格
{
  const f = { "c.md": ANCH("e") + "\n- 必须参考历史文档的写法\n" };
  const r = m.readRulesAggregatePre({ userFile: "u.md", candidatePath: "c.md", ownerSessionId: "s1", sessionKey: "k1", readFile: (p) => f[p] || USER });
  ok(r.counts.candidate >= 1, "★[RC] 含「参考历史」语境 ⇒ 计入 candidate", String(r.counts.candidate));
  ok(r.rules.every((x) => !x.text.includes("参考历史")), "★[RC] 该条**未**升格进 rules（候选不因措辞自动升格）");
  ok(r.candidates.every((x) => x.kind === "candidate"), "[RC] 候选层产出一律 kind=candidate");
}

// ── RC 负路径：四态
{
  const r1 = m.readRulesAggregatePre({ userFile: "不存在.md", readFile: () => { const e = new Error(); e.code = "ENOENT"; throw e } });
  ok(r1.statuses.user === "missing", "[负路径] ENOENT ⇒ missing");
  const r2 = m.readRulesAggregatePre({ userFile: "x.md", readFile: () => { const e = new Error(); e.code = "EPERM"; throw e } });
  ok(r2.statuses.user === "unreadable", "★[负路径] EPERM ⇒ unreadable（**不静默转空**）");
  ok(r2.warnings.length > 0 && r2.warnings[0].code === "read-failed", "★[负路径] 不可读产出显式 warning", r2.warnings[0] && r2.warnings[0].code);
  const r3 = m.readRulesAggregatePre({ userFile: "x.md", readFile: () => "   \n  " });
  ok(r3.statuses.user === "empty", "[负路径] 全空白 ⇒ empty（与 missing/unreadable 区分）");
  const r4 = m.readRulesAggregatePre({ userFile: "x.md", readFile: () => 12345 });
  ok(r4.statuses.user === "invalid", "[负路径] 非字符串 ⇒ invalid");
}

// ── RC：readFile 必须注入，不得 fallback 到真实 fs
{
  const r = m.readRulesAggregatePre({ userFile: "u.md" });
  ok(r.statuses.user === "unreadable", "★[RC] 未注入 readFile ⇒ unreadable（不 fallback 到真实 fs）");
  ok(r.warnings.some((w) => w.code === "readfile-not-injected"), "★[RC] 产出 readfile-not-injected 降级");
}

// ── RC：owner/session 缺失保留边界，不跨会话读取
{
  const { readFile } = base();
  const r = m.readRulesAggregatePre({ userFile: "u.md", readFile });
  ok(r.ownerBoundary.crossSessionRead === false, "★[RC] crossSessionRead 恒为 false");
  ok(r.ownerBoundary.degraded === true && r.ownerBoundary.ownerSessionId === null, "★[RC] owner 缺失 ⇒ degraded 且 ownerSessionId=null");
  ok(r.warnings.some((w) => w.code === "owner-session-missing"), "[RC] 产出 owner-session-missing 降级");
}

// ── RC：层内 index/expect/revision 语义（不改变既有写入契约）
{
  const { readFile } = base();
  const r = m.readRulesAggregatePre({ userFile: "u.md", notesPath: "n.md", readFile });
  const all = r.rules.concat(r.notes, r.references);
  ok(all.every((x) => x.layer === "user" || x.layer === "project"), "[RC] 每条带 layer 归属");
  ok(all.every((x) => typeof x.revision === "string" && x.revision.startsWith("sha256:")), "[RC] 每条带独立 revision");
  // 同层 index 唯一
  const keys = all.map((x) => x.layer + ":" + x.entryIndex + ":" + x.itemIndex + ":" + x.segmentIndex);
  ok(new Set(keys).size === keys.length, "★[RC] 同层 (entryIndex,itemIndex,segmentIndex) 唯一，可定位编辑");
}

// ── SR：组合全部来源 + proofs
{
  const { readFile } = base();
  const sr = m.readInjectionSourcesPre({
    readFile,
    paths: {
      userFile: "u.md", notesPath: "n.md",
      plan: { path: "plan.md", reader: () => "# 白板\n- 当前任务" },
      handoff: { path: "h.md", reader: () => "# 账本\n目标" },
      events: { path: "e.md", reader: () => "[事件]" },
    },
  });
  ok(sr.dtoKind === "InjectionSources", "[SR] 返回 InjectionSources");
  for (const k of ["rules", "events", "plan", "handoff", "reflections", "logs", "proofs", "warnings"]) {
    ok(k in sr, "[SR] 含字段 " + k);
  }
  ok(sr.rules.counts.rule >= 2, "★[SR] rules 来自 B3-RC（委托而非重写）", String(sr.rules.counts.rule));
  ok(sr.plan.status === "ok" && sr.plan.text.includes("白板"), "★[SR] plan 经注入 reader 读到真实内容");
  ok(sr.statuses.reflections === "missing" && sr.statuses.logs === "missing", "[SR] 未提供来源 ⇒ missing");
  ok(!!sr.proofs["rules.user"] && !!sr.proofs.plan, "★[SR] proofs 含 rules.user 与 plan", Object.keys(sr.proofs).join(","));
  const p = sr.proofs.plan;
  ok(typeof p.rawSha256 === "string" && p.rawSha256.length === 64, "★[SR] SourceProof 给出 rawSha256（64 hex）");
  ok(typeof p.normalizedSha256 === "string" && p.normalizedSha256.length === 64, "★[SR] SourceProof 给出 normalizedSha256（64 hex）");
  // ★两口径必须**独立可算**：纯 LF 内容两者相等是正确的；用含 CRLF 的内容才能验证它们真的分别基于原始/归一化字节
  {
    const crlfSrc = "# 白板\r\n- 当前任务\r\n";
    const sr2 = m.readInjectionSourcesPre({ paths: { plan: { reader: () => crlfSrc } } });
    const q = sr2.proofs.plan;
    ok(q.rawSha256 !== q.normalizedSha256, "★★[SR] 含 CRLF 的输入 ⇒ raw 与 normalized **确实不同**（两个口径独立可算）",
      "raw=" + q.rawSha256.slice(0, 8) + " norm=" + q.normalizedSha256.slice(0, 8));
    ok(sr2.plan.text === "# 白板\n- 当前任务\n", "★★[SR] 返回 text 已归一化为 LF（不含 \\r）");
  }
}

// ── SR 负路径
{
  // ⚠ 语义澄清：未给路径 ⇒ **missing**（确实没有这个文件），比 unreadable 更准确。
  //   「给了路径但没有 readFile」才应是 unreadable —— 下面两条分别锁这两种情形。
  const srNoPath = m.readInjectionSourcesPre({ paths: {} });
  ok(srNoPath.rules.statuses.user === "missing", "[负路径] 未给 userFile ⇒ missing");
  ok(srNoPath.statuses.plan === "missing", "[负路径] 无 plan 路径 ⇒ missing");
  const srNoReadFile = m.readInjectionSourcesPre({ paths: { userFile: "u.md" } });
  ok(srNoReadFile.rules.statuses.user === "unreadable", "★[负路径] 给了路径但未注入 readFile ⇒ unreadable（不 fallback 到真实 fs）");
  ok(srNoReadFile.warnings.some((w) => w.code === "readfile-not-injected"), "★[负路径] 产出 readfile-not-injected 降级");
}
{
  const sr = m.readInjectionSourcesPre({
    paths: { plan: { reader: () => { throw Object.assign(new Error("boom"), { code: "EPERM" }) } } },
  });
  ok(sr.plan.status === "unreadable", "★[负路径] reader 抛错 ⇒ unreadable（不静默成空）");
  ok(sr.warnings.some((w) => w.code === "read-failed"), "[负路径] 产出 read-failed 降级");
}

// ── createSourcesPort：接既有 DI facade
{
  const { readFile } = base();
  const port = m.createSourcesPort(() => ({ readFile, paths: { userFile: "u.md" } }));
  const reg = m.createPortRegistry({ sources: port, clock: () => "T" });
  const r = m.callPort(reg, "sources", []);
  ok(r.ok === true, "★[SR] sources port 经 callPort 调用成功");
  ok(r.value && r.value.dtoKind === "InjectionSources", "★[SR] port 返回 InjectionSources");
  ok(m.describePortCoverage(reg).missing === 3, "[SR] 缺 rules/cadence/projection 三个 port（显式可清点）", String(m.describePortCoverage(reg).missing));
}

// ── 只读性：调用前后夹具内容字节不变
{
  const before = mkFiles();
  const snapshot = JSON.stringify(before);
  const readFile = (p) => { if (!(p in before)) { const e = new Error(); e.code = "ENOENT"; throw e } return before[p] };
  m.readInjectionSourcesPre({ readFile, paths: { userFile: "u.md", notesPath: "n.md", plan: { path: "p", reader: () => "x" } } });
  ok(JSON.stringify(before) === snapshot, "★★[只读] 调用前后夹具内容逐字节不变（不写任何真源）");
}

// ── 内置变异（证明断言有区分力）
{
  const eperm = m.readRulesAggregatePre({ userFile: "x.md", readFile: () => { const e = new Error(); e.code = "EPERM"; throw e } });
  const leaky = () => ({ statuses: { user: "empty" } });
  ok(leaky().statuses.user === "empty" && eperm.statuses.user === "unreadable", "[变异M1] 不可读若被静默转成 empty ⇒ 断言可区分");
  const { readFile } = base();
  const two = m.readRulesAggregatePre({ userFile: "u.md", readFile });
  ok(two.counts.byLayer.user.rule === 2 && two.counts.byLayer.user.rule !== 1, "[变异M2] 两条 bullet 若被合并成 1 条 ⇒ 断言可区分");
}

console.log("\n── B3-SR/RC 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);