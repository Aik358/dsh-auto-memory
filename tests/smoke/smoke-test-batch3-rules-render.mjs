#!/usr/bin/env node
/**
 * smoke-test-batch3-rules-render.mjs —— B3-RP 验收（L1 §4.5 / L2 §6）
 * 真 import → 真构造（真 RC 聚合）→ 真调用 → 断言返回值；正负路径 + 内置变异。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }

const m = await import(pathToFileURL(path.join(REPO, "lib/injection/index.js")).href);
ok(typeof m.renderRulesForTierPre === "function", "[import] renderRulesForTierPre 已导出");
ok(m.INJECTION_CONTRACT_INFO.implements.includes("B3-RP"), "[import] 自述已声明实现 B3-RP");
ok(!m.INJECTION_CONTRACT_INFO.doesNotImplement.includes("B3-RP"), "[import] B3-RP 已移出未实现列表");

// ── 夹具：用**真实 RC 聚合**作为输入（不是手搓对象）
const ANCH = (c) => "<!-- memory:mem_" + String(c).repeat(32) + " -->";
const LONG_TAIL = Array.from({ length: 6 }, (_, i) => "  第" + (i + 1) + "条：" + "这一条限定很长，用于验证不逐条200截断。".repeat(6)).join("\n");
const FILES = {
  "u.md": [ANCH("a"), "- 禁止把业务逻辑堆进 lib/index.js", "- 必须保留原始行尾（CRLF 追加前先剥 \\r）"].join("\n"),
  "l.md": [ANCH("b"), "- 必须同时满足以下多条限定：", LONG_TAIL].join("\n"),
  "n.md": [ANCH("c"), "- 必须用单引号写 Windows 路径", "（说明）这条是说明，不冒充硬约束"].join("\n"),
  "r.md": [ANCH("d"), "<!-- dsh-status: superseded by=mem_x -->", "- 必须使用旧版编号 3.0.x（已作废）"].join("\n"),
};
const readFile = (p) => { if (!(p in FILES)) { const e = new Error("nope"); e.code = "ENOENT"; throw e } return FILES[p] };
const RC = m.readRulesAggregatePre({ userFile: "u.md", notesPath: "l.md", candidatePath: "n.md", readFile, ownerSessionId: "s1", sessionKey: "k1" });
const RC_WITH_RETIRED = m.readRulesAggregatePre({ userFile: "u.md", notesPath: "r.md", readFile });
ok(RC.rules.length > 0, "[夹具] 真实 RC 聚合产出有效规则", String(RC.rules.length));

// ── 1. 摘要档一行指针（L1 §4.5）
for (const tier of ["slim"]) {
  const r = m.renderRulesForTierPre({ rules: RC, tier });
  ok(r.mode === "pointer", "★[RP] " + tier + " 档 mode=pointer", r.mode);
  ok(r.text.split("\n").length === 1, "★★[RP] " + tier + " 档输出**恰好一行**（不是整段规则）", r.text.split("\n").length + " 行");
  ok(r.text.includes("memory_rules op=list"), "★[RP] 指针给出去处（memory_rules op=list）");
  ok(r.counts.rendered === 0, "★[RP] 摘要档**不渲染**任何规则条目", String(r.counts.rendered));
  ok(!r.text.includes("禁止把业务逻辑"), "★[RP] 摘要档不含规则正文");
}

// ── 2. human_full 完整有效正文（不逐条 200）
{
  const r = m.renderRulesForTierPre({ rules: RC, tier: "human_full" });
  ok(r.mode === "full", "★[RP] human_full mode=full");
  ok(r.text.includes("第1条") && r.text.includes("第6条"), "★★[RP] human_full 含多行限定的**最后一条**（证明没被逐条截断）", "第6条=" + r.text.includes("第6条"));
  ok(!r.text.includes("…"), "★★[RP] human_full **不含省略号**（不逐条 200 截断）");
  ok(!r.text.includes(m.TRUNC_POINTER), "★★[RP] human_full 不含截断指针（说明没触发截断）");
  // 单条正文完整：把 RC 里最长的一条与渲染文本比对
  const longest = RC.rules.slice().sort((a, b) => b.text.length - a.text.length)[0];
  const lastLine = longest.text.split("\n").map((x) => x.trim()).filter(Boolean).pop();
  ok(r.text.includes(lastLine), "★★[RP] 最长条目的**末行**完整出现在 human_full 输出里", lastLine.slice(0, 40) + "…");
  ok(longest.text.length > 200, "[夹具] 最长条目 > 200 字（能区分是否截断）", String(longest.text.length));
}

// ── 3. 对照：full/human_full 完整 vs run_slim 摘要（同输入不同档位）
{
  const full = m.renderRulesForTierPre({ rules: RC, tier: "full" });
  const slim = m.renderRulesForTierPre({ rules: RC, tier: "run_slim" });
  ok(full.chars.text > slim.chars.text, "★[RP] 同输入 full 字符数 > run_slim（档位真起作用）", full.chars.text + " vs " + slim.chars.text);
  ok(full.text.includes("第6条") && !slim.text.includes("第6条"), "★★[RP] 「第6条」只在完整档出现，精简档没有", "full=" + full.text.includes("第6条") + " slim=" + slim.text.includes("第6条"));
  // ★修正断言（原写法假定排序后首行是那条长规则 —— 实际首行取决于 RC 顺序，属断言写错）
  //   正确判据：精简档**每一行**都只含该条目的首行，不含其后续多行限定。
  const slimLines = slim.text.split("\n").filter((l) => l.trim());
  ok(slimLines.length === 1 && slim.counts.rendered === 0, "★[RP] 精简档只给一行指针，不渲染规则条目", slimLines.length + "/" + slim.counts.rendered);
  ok(!slim.text.includes("第6条") && full.text.includes("第6条"), "★★[RP] 精简档不展开多行限定，完整档才展开");
}

// ── 4. snapshotSlimMaintain 只在 human_slim
{
  const hs = m.renderRulesForTierPre({ rules: RC, tier: "human_slim" });
  const rs = m.renderRulesForTierPre({ rules: RC, tier: "run_slim" });
  const fu = m.renderRulesForTierPre({ rules: RC, tier: "human_full" });
  ok(hs.snapshotSlimMaintain === true && hs.text.includes(m.SLIM_MAINTAIN_BLOCK), "★★[RP] human_slim **含** snapshotSlimMaintain 维护块");
  ok(hs.mode === "slim-maintain", "★[RP] human_slim mode=slim-maintain", hs.mode);
  ok(rs.snapshotSlimMaintain !== true, "★★[RP] run_slim **不含**维护块（snapshotSlimMaintain 未置位）", String(rs.snapshotSlimMaintain));
  ok(!rs.text.includes(m.SLIM_MAINTAIN_BLOCK), "★★[RP] run_slim 文本里**没有**维护块正文");
  ok(!fu.text.includes(m.SLIM_MAINTAIN_BLOCK), "★[RP] human_full 也不含维护块");
}

// ── 5. note 中性前缀（不冒充硬规则）
{
  // notesPath=n.md 里有一条 note（（说明）行）
  const nrc = m.readRulesAggregatePre({ userFile: "n.md", readFile });
  ok(nrc.counts.note >= 1, "[夹具] RC 产出 note 条目", String(nrc.counts.note));
  const r = m.renderRulesForTierPre({ rules: nrc, tier: "human_full" });
  const noteLine = r.text.split("\n").find((l) => l.includes("这条是说明"));
  ok(!!noteLine && noteLine.includes(m.NOTE_PREFIX), "★★[RP] note 条目带中性前缀「（说明）」", noteLine ? noteLine.slice(0, 60) : "(未找到)");
  // ★加强（D2/M6 曾 MISSED 的补强）：必须**恰好一个**前缀，且行首严格为 "- （说明）"
  //   原断言只查 includes ⇒ 重复前缀（（说明）（说明））或完全无前缀都能通过 ⇒ 无区分力。
  if (noteLine) {
    const cnt = (noteLine.match(/（说明）/g) || []).length;
    ok(cnt === 1, "★★[RP] note 行**恰好一个**中性前缀（不重复拼接）", "出现 " + cnt + " 次");
    ok(noteLine.startsWith("- " + m.NOTE_PREFIX), "★★[RP] note 行首严格为「- （说明）」", JSON.stringify(noteLine.slice(0, 12)));
    ok(!noteLine.startsWith("- - "), "★★[RP] note 行**不出现**双列表前缀「- - 」", JSON.stringify(noteLine.slice(0, 8)));
  } else {
    ok(false, "★★[RP] note 行未找到（后续前缀断言无法进行）");
    ok(false, "★★[RP] note 行未找到（跳过）");
    ok(false, "★★[RP] note 行未找到（跳过）");
  }
  ok(r.counts.note >= 1, "★[RP] counts.note 如实计数", String(r.counts.note));
  // 规则行也不得出现双前缀
  ok(!r.text.split("\n").some((l) => l.trim().startsWith("- - ")), "★★[RP] 全文无任何「- - 」双前缀行");
  // ★★关键补强（M6/D2 曾"不可区分"的根因）：上面的夹具 note 原文**自带「（说明）」**，
  //   所以「实现主动加前缀」与「正文本来就有前缀」在输出上无法区分 ⇒ 两个变异都抓不到。
  //   这里用**不带前缀**的 note 正文，才能验证「实现真的会补前缀」。
  {
    const bare = { rules: [
      { text: "这条 note 正文不含任何前缀标记", kind: "note", retired: false, status: "current" },
      { text: "这条 rule 正文也不含前缀", kind: "rule", retired: false, status: "current" },
    ] };
    const br = m.renderRulesForTierPre({ rules: bare, tier: "human_full" });
    const noteLine2 = br.text.split("\n").find((l) => l.includes("不含任何前缀标记"));
    ok(!!noteLine2 && noteLine2.startsWith("- " + m.NOTE_PREFIX),
      "★★[RP] 无前缀的 note 正文 ⇒ 实现**主动补**中性前缀（证明不是靠正文自带）",
      noteLine2 ? JSON.stringify(noteLine2.slice(0, 20)) : "(未找到)");
    ok(!!noteLine2 && (noteLine2.match(/（说明）/g) || []).length === 1,
      "★★[RP] 补前缀后**恰好一个**（不重复）");
    const ruleLine2 = br.text.split("\n").find((l) => l.includes("也不含前缀"));
    ok(!!ruleLine2 && ruleLine2.startsWith("- 这"), "★★[RP] 无前缀的 rule 正文 ⇒ **不补**前缀", ruleLine2 ? JSON.stringify(ruleLine2.slice(0, 16)) : "(未找到)");
  }
  const ruleLine = r.text.split("\n").find((l) => l.includes("必须用单引号"));
  ok(!!ruleLine && !ruleLine.includes(m.NOTE_PREFIX), "★★[RP] 硬规则条目**不带**中性前缀（不混同）", ruleLine ? ruleLine.slice(0, 50) : "(未找到)");
}

// ── 6. retired 不进有效规则（但仍如实报数）
{
  ok(RC_WITH_RETIRED.counts.retired >= 1, "[夹具] RC 有 retired 条目", String(RC_WITH_RETIRED.counts.retired));
  const r = m.renderRulesForTierPre({ rules: RC_WITH_RETIRED, tier: "human_full" });
  ok(!r.text.includes("已作废"), "★★[RP] retired 条目**不进入**渲染输出（不冒充有效规则）");
  ok(r.counts.excludedRetired === RC_WITH_RETIRED.counts.retired, "★[RP] excludedRetired 如实报出被排除条数", String(r.counts.excludedRetired));
  ok(r.counts.total === RC_WITH_RETIRED.counts.rule, "★[RP] counts.total = 有效规则条数（不含 retired）", r.counts.total + "/" + RC_WITH_RETIRED.counts.rule);
  // ★★加强（M4 变异曾"无效"的补强）：RC 把 retired 放在单独数组、渲染从不读它 ⇒
  //   前面几条断言根本无法被「不排除 retired」的变异触发。这里**直接把带 retired 标记的
  //   条目塞进 rules 数组**，让过滤分支真正被执行 —— 变异才有机会暴露。
  {
    const mixed = { rules: [
      { text: "正常规则甲", kind: "rule", retired: false, status: "current" },
      { text: "已作废规则乙", kind: "rule", retired: true, status: "superseded" },
      { text: "已撤回规则丙", kind: "rule", retired: false, status: "retracted" },
      // ★★关键（M4 首轮 MISSED 的根因）：上面的「已作废规则乙」**同时**有
      //   retired=true 与 status=superseded ⇒ 删掉 retired 检查后 status 检查仍会挡住它，
      //   两条判据互为兜底 ⇒ 变异被**短路掩盖**、看不出 retired 检查是否生效。
      //   这条只设 retired=true 而 status 保持 current，**让 retired 成为唯一拦截面**。
      { text: "仅靠retired拦下的规则丁", kind: "rule", retired: true, status: "current" },
      // 同理：这条只靠 status 拦下（retired 为 false），让 status 成为唯一拦截面
      { text: "仅靠status拦下的规则戊", kind: "rule", retired: false, status: "superseded" },
    ] };
    const mr = m.renderRulesForTierPre({ rules: mixed, tier: "human_full" });
    ok(!mr.text.includes("已作废规则乙"), "★★[RP] rules 数组内 retired=true 的条目被排除");
    ok(!mr.text.includes("已撤回规则丙"), "★★[RP] status=retracted 的条目被排除");
    ok(!mr.text.includes("仅靠retired拦下的规则丁"),
      "★★[RP] **仅** retired=true（status=current）也被排除（retired 是独立判据，不靠 status 兜底）");
    ok(!mr.text.includes("仅靠status拦下的规则戊"),
      "★★[RP] **仅** status=superseded（retired=false）也被排除（status 是独立判据）");
    ok(mr.counts.rendered === 1 && mr.text.includes("正常规则甲"), "★★[RP] 只有 current 且未 retired 的条目被渲染", String(mr.counts.rendered));
  }
}

// ── 7. legacy 少给
{
  const many = { rules: Array.from({ length: 10 }, (_, i) => ({ text: "规则" + i, kind: "rule", retired: false, status: "current" })) };
  const normal = m.renderRulesForTierPre({ rules: many, tier: "full" });
  const legacy = m.renderRulesForTierPre({ rules: many, tier: "full", legacy: true });
  ok(normal.counts.rendered === 10, "[RP] 非 legacy 全量渲染 10 条", String(normal.counts.rendered));
  ok(legacy.counts.rendered === 0 && legacy.mode === "legacy-pointer", "★★[RP] legacy 只给指针，不渲染完整规则", String(legacy.counts.rendered));
  ok(legacy.counts.omittedLegacy === 10, "★[RP] legacy 如实报出省略 10 条", String(legacy.counts.omittedLegacy));
  ok(legacy.legacy === true, "[RP] legacy 标记可见");
  ok(normal.text.includes("规则9") && !legacy.text.includes("规则9"), "★★[RP] 第 10 条只在非 legacy 出现");
  ok(!legacy.text.includes("- 规则0"), "★[RP] legacy 不引入完整规则条目");
  ok(legacy.text.includes("已省略 10 条"), "★[RP] legacy 输出显式说明已省略");
  const legacyTier = m.renderRulesForTierPre({ rules: many, tier: "legacy" });
  ok(legacyTier.mode === "legacy-pointer" && legacyTier.counts.rendered === 0, "★[RP] tier=legacy 直接走指针");
}

// ── 8. 空值 / 边界
{
  const empty = m.renderRulesForTierPre({ rules: { rules: [] }, tier: "human_full" });
  ok(empty.text === "" && empty.chars.text === 0, "★[RP] 空规则 ⇒ 空文本（不产裸 '-' 行）");
  ok(empty.counts.rendered === 0, "[RP] 空规则 rendered=0");
  const noArg = m.renderRulesForTierPre({});
  ok(noArg.text === "", "[RP] 无 rules 参数 ⇒ 空文本，不崩");
  const ptrEmpty = m.renderRulesForTierPre({ rules: { rules: [] }, tier: "slim" });
  ok(ptrEmpty.text === "", "[RP] 摘要档 + 空规则 ⇒ 空文本（不产空指针）");
}

// ── 9. 跨语言 / 多行不丢
{
  const multi = { rules: [
    { text: "必須保留原始行尾（繁体）", kind: "rule", retired: false, status: "current" },
    { text: "Must keep original line endings", kind: "rule", retired: false, status: "current" },
  ] };
  const r = m.renderRulesForTierPre({ rules: multi, tier: "human_full" });
  ok(r.text.includes("繁体") && r.text.includes("original line endings"), "★[RP] 跨语言（中/英）条目都渲染");
  ok(r.counts.rendered === 2, "[RP] 两条都渲染", String(r.counts.rendered));
}

// ── 10. 负路径：非法档位显式报错
{
  let threw = null;
  try { m.renderRulesForTierPre({ rules: RC, tier: "bogus" }) } catch (e) { threw = e }
  ok(threw && threw.code === "injection-invalid-enum", "★[RP] 非法档位 ⇒ 显式 invalid-enum（不静默降级）", threw && threw.code);
  ok(threw && threw.field === "tier", "[RP] 错误指明 field=tier");
}

// ── 11. 纯函数性：不改入参 + 幂等
{
  const snap = JSON.stringify(RC);
  const a = m.renderRulesForTierPre({ rules: RC, tier: "human_full" });
  const b = m.renderRulesForTierPre({ rules: RC, tier: "human_full" });
  ok(JSON.stringify(RC) === snap, "★★[RP] 调用**不修改入参** rules（纯函数）");
  ok(a.text === b.text && a.chars.text === b.chars.text, "★★[RP] 同输入两次输出逐字节一致（幂等）", "len " + a.text.length);
  ok(Object.isFrozen(a), "[RP] 返回已冻结");
  ok(a.dtoKind === "RulesRender", "[RP] dtoKind=RulesRender");
}

// ── 12. 内置变异（证明断言有区分力）
{
  const full = m.renderRulesForTierPre({ rules: RC, tier: "human_full" });
  const slim = m.renderRulesForTierPre({ rules: RC, tier: "run_slim" });
  ok(full.text.includes("第6条") && !slim.text.includes("第6条"), "[变异M1] 若 human_full 被逐条200截断 ⇒ 「第6条」断言可区分");
  const hs = m.renderRulesForTierPre({ rules: RC, tier: "human_slim" });
  const rs = m.renderRulesForTierPre({ rules: RC, tier: "run_slim" });
  ok(hs.text.includes(m.SLIM_MAINTAIN_BLOCK) && !rs.text.includes(m.SLIM_MAINTAIN_BLOCK), "[变异M2] 若维护块误入 run_slim ⇒ 断言可区分");
  const ptr = m.renderRulesForTierPre({ rules: RC, tier: "slim" });
  ok(ptr.text.split("\n").length === 1 && full.text.split("\n").length > 1, "[变异M3] 若摘要档也渲染正文 ⇒ 一行断言可区分");
  const withRetired = m.renderRulesForTierPre({ rules: RC_WITH_RETIRED, tier: "human_full" });
  ok(!withRetired.text.includes("已作废") && RC_WITH_RETIRED.counts.retired >= 1, "[变异M4] 若 retired 混入 ⇒ 断言可区分");
}

console.log("\n── B3-RP 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);