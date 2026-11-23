#!/usr/bin/env node
/**
 * smoke-test-batch3-events.mjs —— B3-EV 验收（L1 §4.9 / L2 §8）
 * 真 import → 真构造 → 真调用 → 断言返回值；覆盖 L2 §8.4 全部反例。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }

const m = await import(pathToFileURL(path.join(REPO, "lib/injection/index.js")).href);
for (const fn of ["projectEventSectionsPre", "renderCheckpointPreviewPre", "selectEventProjectionPre", "renderEventSourcePointersPre"]) {
  ok(typeof m[fn] === "function", "[import] " + fn + " 已导出");
}
ok(m.INJECTION_CONTRACT_INFO.implements.includes("B3-EV"), "[import] 自述已声明实现 B3-EV");
ok(!m.INJECTION_CONTRACT_INFO.doesNotImplement.includes("B3-EV"), "[import] B3-EV 已移出未实现列表");

// ══════════ 1. 事件头 vs 检查点四段（不混映射）══════════
{
  ok(m.EVENT_HEAD_KEYS.join(",") === "goal,doing,deadend,next", "★★[EV] 事件头四段 = goal/doing/deadend/next", m.EVENT_HEAD_KEYS.join(","));
  ok(m.CHECKPOINT_KEYS.join(",") === "goal,state,dead,next", "★★[EV] 检查点四段 = goal/state/dead/next", m.CHECKPOINT_KEYS.join(","));
  ok(!m.EVENT_HEAD_KEYS.includes("dead") && !m.EVENT_HEAD_KEYS.includes("state"), "★★[EV] 事件头**不含** dead/state（那是检查点的字段）");
  ok(!m.CHECKPOINT_KEYS.includes("deadend") && !m.CHECKPOINT_KEYS.includes("doing"), "★★[EV] 检查点**不含** deadend/doing（那是事件头的字段）");
}

// 2. 不混映射：给事件头喂检查点字段，不得被读进来
{
  const polluted = { goal: "G", doing: "D", deadend: "W", next: "N", state: "不该出现", dead: "不该出现" };
  const r = m.projectEventSectionsPre({ sections: polluted });
  const keys = r.map((s) => s.key);
  ok(keys.join(",") === "goal,doing,deadend,next", "★★[EV] 事件头只取自己四段", keys.join(","));
  ok(!r.some((s) => s.text === "不该出现"), "★★[EV] 事件头**不读** state/dead（不混映射）");
  const cp = { goal: "G", state: "S", dead: "D", next: "N", doing: "不该出现", deadend: "不该出现" };
  const rc = m.projectCheckpointSectionsPre({ sections: cp });
  ok(rc.map((s) => s.key).join(",") === "goal,state,dead,next", "★★[EV] 检查点只取自己四段", rc.map((s) => s.key).join(","));
  ok(!rc.some((s) => s.text === "不该出现"), "★★[EV] 检查点**不读** doing/deadend");
}

// 3. 空字段不输出
{
  const r = m.projectEventSectionsPre({ sections: { goal: "", doing: "   ", deadend: "有内容", next: null } });
  ok(r.length === 1 && r[0].key === "deadend", "★★[EV] 空串/空白/null 字段**不输出**", r.map((s) => s.key).join(","));
  const none = m.projectEventSectionsPre({ sections: {} });
  ok(none.length === 0, "★★[EV] 四段全空 ⇒ 输出空数组");
  const partial = m.projectEventSectionsPre({ sections: { goal: "G", doing: "", deadend: "", next: "" } });
  ok(partial.length === 1 && partial[0].key === "goal", "★[EV] 部分空 ⇒ 只输出非空项", partial.map((s) => s.key).join(","));
}

// 4. 多语言
{
  const r = m.projectEventSectionsPre({ sections: { goal: "目标甲", doing: "Doing B", deadend: "卡在 EPERM", next: "Next 步骤" } });
  ok(r.length === 4 && r.every((s) => s.text.length > 0), "★[EV] 多语言四段都保留", String(r.length));
}

// ══════════ 5. 检查点预览（1400 字首尾）══════════
{
  const long = "开头关键信息。" + "中间填充内容。".repeat(200) + "尾部结论：EPERM是根因";
  ok(long.length > 1400, "[夹具] 长检查点 > 1400 字", String(long.length));
  const snap = long;
  const pv = m.renderCheckpointPreviewPre({ checkpoint: { id: "cp1", text: long }, budget: { capChars: 300 } });
  ok(pv.truncated === true, "★[EV] 超预算 ⇒ truncated");
  ok(pv.head.includes("开头关键信息"), "★★[EV] 预览保留**开头**");
  ok(pv.tail.includes("EPERM是根因"), "★★[EV] 预览保留**尾部**（结论在段尾）");
  ok(pv.head.length + pv.tail.length <= 300 + 60, "★[EV] 首尾总长受预算约束", pv.head.length + "+" + pv.tail.length);
  ok(long === snap, "★★[EV] **不改检查点原文**");
  ok(pv.omittedChars > 0, "★★[EV] 省略量如实", String(pv.omittedChars));
}

// 6. 四段分配模式
{
  const cp = { goal: "G", state: "S", dead: "D", next: "N" };
  const long = "x".repeat(2000);
  const pv = m.renderCheckpointPreviewPre({ checkpoint: { id: "c2", text: long, sections: cp }, budget: { capChars: 400, mode: "sections" } });
  ok(pv.mode === "sections", "★[EV] sections 模式生效", pv.mode);
  ok(pv.sections.length === 4, "★★[EV] 按四段分配 ⇒ 四段都在", String(pv.sections.length));
  ok(pv.sections.every((s) => ["goal", "state", "dead", "next"].includes(s.key)), "★[EV] 段 key 正确");
}

// 7. 未给预算 ⇒ 不截断、不擅自定值
{
  const pv = m.renderCheckpointPreviewPre({ checkpoint: { id: "c3", text: "abcdef" }, budget: {} });
  ok(pv.truncated === false && pv.text === "abcdef", "★★[EV] 未给预算 ⇒ **不截断**");
  ok(pv.unresolved.some((u) => u.key === "budget.capChars"), "★★[EV] 未给预算进 unresolved（不擅自定值）");
}

// 8. 空检查点
{
  const pv = m.renderCheckpointPreviewPre({ checkpoint: {} });
  ok(pv.text === "" && pv.truncated === false, "★★[EV] 空检查点 ⇒ 空预览（空字段不输出）");
}

// ══════════ 9. 事件选择与目录 ══════════
const mkEvents = (n, activeN) => Array.from({ length: n }, (_, i) => ({
  id: "evt_" + String(i).padStart(8, "0"),
  name: "事件" + i,
  status: i < activeN ? "active" : "closed",
  updatedAt: 1000 + i,
  sections: { goal: "g" + i, doing: "d" + i, deadend: "", next: "n" + i },
}));
const EV10 = mkEvents(10, 7);

// 10. ★activeLimit 来自 eventMaxActiveInInject，不擅自增加
{
  const r = m.selectEventProjectionPre({ events: EV10, activeLimit: 2 });
  ok(r.cards.length === 2, "★★[EV] activeLimit=2 ⇒ 只展开 2 个 active", String(r.cards.length));
  ok(r.activeLimit === 2, "★[EV] 回显 activeLimit");
  const r99 = m.selectEventProjectionPre({ events: EV10, activeLimit: 99 });
  ok(r99.cards.length === 7, "★★[EV] activeLimit 大于 active 数 ⇒ 只取实际 active（7）", String(r99.cards.length));
  const rNone = m.selectEventProjectionPre({ events: EV10 });
  ok(rNone.activeLimit === null, "★★[EV] **未给 activeLimit ⇒ null**（不擅自设默认值）", String(rNone.activeLimit));
  ok(rNone.cards.length === 0, "★★[EV] 未给 activeLimit ⇒ **不展开任何 active**（不擅自增加）", String(rNone.cards.length));
  ok(rNone.unresolved.some((u) => u.key === "activeLimit"), "★★[EV] 未给 activeLimit 进 unresolved");
  const r0 = m.selectEventProjectionPre({ events: EV10, activeLimit: 0 });
  ok(r0.cards.length === 0 && r0.activeLimit === 0, "★[EV] activeLimit=0 ⇒ 全进目录，不展开");
}

// 11. ★目录排除已展开事件
{
  const r = m.selectEventProjectionPre({ events: EV10, activeLimit: 2 });
  const cardIds = new Set(r.cards.map((c) => c.id));
  ok(r.catalog.every((c) => !cardIds.has(c.id)), "★★[EV] 目录**排除已展开事件**", "catalog=" + r.catalog.length);
  ok(r.cards.length + r.catalog.length === 10, "★★[EV] 展开 + 目录 = 全部事件（无重复无丢失）", r.cards.length + "+" + r.catalog.length);
}

// 12. 四种状态分别验证（L2 §8.2）
{
  for (const st of ["active", "paused", "closed", "archived"]) {
    const one = [{ id: "e1", name: "x", status: st, updatedAt: 1, sections: { goal: "g" } }];
    const r = m.selectEventProjectionPre({ events: one, activeLimit: 2 });
    if (st === "active") ok(r.cards.length === 1 && r.catalog.length === 0, "★[EV] status=active ⇒ 进卡片", String(r.cards.length));
    else ok(r.cards.length === 0 && r.catalog.length === 1, "★★[EV] status=" + st + " ⇒ **不展开**，只进目录", "cards=" + r.cards.length);
  }
}

// 13. ★currentEventIds 真实输入 vs 缺省（不冒充当前任务）
{
  const r = m.selectEventProjectionPre({ events: EV10, activeLimit: 2, currentEventIds: ["evt_00000005"] });
  const cur = r.cards.filter((c) => c.isCurrentTask);
  ok(cur.length === 1 && cur[0].id === "evt_00000005", "★★[EV] 真实 currentEventIds ⇒ 恰一个「当前任务」", cur.map((c) => c.id).join(","));
  ok(cur.length > 0 && cur[0].label === "当前任务", "★[EV] 标签为「当前任务」", cur.length ? cur[0].label : "(无当前任务卡片)");
  const others = r.cards.filter((c) => !c.isCurrentTask);
  ok(others.every((c) => c.label === "最近更新"), "★★[EV] 非当前事件标「最近更新」", others.map((c) => c.label).join(","));
  const noCur = m.selectEventProjectionPre({ events: EV10, activeLimit: 2 });
  ok(noCur.cards.every((c) => c.isCurrentTask === false), "★★[EV] **无 currentEventIds ⇒ 无一标为当前任务**（不冒充）");
  ok(noCur.cards.every((c) => c.label === "最近更新"), "★★[EV] 无上下文时一律「最近更新」");
  ok(noCur.labelSemantics.hasCurrentEventIds === false, "★[EV] 显式声明未提供真实上下文");
  const emptyCur = m.selectEventProjectionPre({ events: EV10, activeLimit: 2, currentEventIds: [] });
  ok(emptyCur.cards.every((c) => c.isCurrentTask === false), "★★[EV] 空数组 currentEventIds ⇒ 同样不冒充");
}

// 14. 重复 id / 缺 id（非法不伪造）
{
  const dup = [{ id: "e1", name: "a", status: "active", updatedAt: 2 }, { id: "e1", name: "b", status: "active", updatedAt: 1 }];
  const rd = m.selectEventProjectionPre({ events: dup, activeLimit: 2 });
  ok(rd.counts.unique === 1, "★★[EV] 重复 id 去重", String(rd.counts.unique));
  ok(rd.warnings.some((w) => w.code === "duplicate-id"), "★[EV] 重复 id 记 warning");
  const noid = [{ name: "x", status: "active" }, { id: "e2", name: "y", status: "active", updatedAt: 1 }];
  const rn = m.selectEventProjectionPre({ events: noid, activeLimit: 2 });
  ok(!rn.cards.some((c) => !c.id), "★★[EV] **缺 id 不伪造 id**");
  ok(rn.cards.every((c) => typeof c.id === "string" && c.id.length > 0), "★[EV] 所有卡片 id 合法");
  ok(rn.warnings.some((w) => w.code === "missing-id"), "★[EV] 缺 id 记 warning，不静默丢弃");
}

// 15. 目录预算 + 最终预算（未定不擅自定值）
{
  const r = m.selectEventProjectionPre({ events: EV10, activeLimit: 2, catalogChars: 50 });
  ok(r.counts.catalogChars <= 50, "★[EV] 目录受字符预算约束", String(r.counts.catalogChars));
  ok(r.counts.catalogOmitted > 0, "★[EV] 超预算条目如实计 omitted", String(r.counts.catalogOmitted));
  ok(r.degradations.length > 0, "★[EV] 目录裁剪产生 degradation");
  const noBudget = m.selectEventProjectionPre({ events: EV10, activeLimit: 2 });
  ok(noBudget.unresolved.some((u) => u.key === "catalogChars"), "★★[EV] 未给目录预算进 unresolved");
  ok(noBudget.unresolved.some((u) => u.key === "finalBudget"), "★★[EV] 未给最终帧预算进 unresolved（不擅自定值）");
}

// 16. 卡片携带事件头四段（而非检查点四段）
{
  const r = m.selectEventProjectionPre({ events: EV10, activeLimit: 1 });
  const keys = r.cards[0].sections.map((s) => s.key);
  ok(keys.every((k) => ["goal", "doing", "deadend", "next"].includes(k)), "★★[EV] 卡片四段用**事件头**字段", keys.join(","));
  ok(!keys.includes("state") && !keys.includes("dead"), "★★[EV] 卡片**不含** state/dead（那是检查点的）");
}

// ══════════ 17. 来源指针 ══════════
{
  const pt = m.renderEventSourcePointersPre({
    members: ["docs/internal/RESULT-A.md", "不存在的/文件.md"],
    checkpoints: [{ id: "c1", rel: "lib/x.js", quoteRef: "这是一段引文不是路径", sourceRef: "handoff/账本.md" }],
    resolvePath: (p) => ({ ok: p.startsWith("docs/") }),
  });
  ok(pt.injectedContent === false, "★★[EV] **不注入任何正文**（injectedContent=false）");
  ok(pt.pointers.every((p) => p.content === null), "★★[EV] 每个指针 content 恒 null（不预塞全文）", String(pt.pointers.length));
  ok(pt.counts.total === 5, "★[EV] 2 members + rel + quoteRef + sourceRef = 5", String(pt.counts.total));
}

// 18. ★quoteRef 是引文不是路径
{
  const pt = m.renderEventSourcePointersPre({ checkpoints: [{ id: "c", quoteRef: "lib/injection/index.js" }] });
  const q = pt.pointers.find((p) => p.kind === "quoteRef");
  ok(q.sourceKind === "quote", "★★[EV] quoteRef 的 sourceKind=**quote**（即使内容看起来像路径）", q.sourceKind);
  ok(q.resolved === null, "★★[EV] quoteRef **不做路径解析**（resolved=null）", String(q.resolved));
  ok(q.hint.includes("不是路径"), "★[EV] hint 显式说明不是路径", q.hint);
}

// 19. ★sourceRef 可能是账本/日志，不冒充施工文档
{
  const pt = m.renderEventSourcePointersPre({ checkpoints: [
    { id: "a", sourceRef: "handoff/2026-11-17.md" },
    { id: "b", sourceRef: ".dsh-memory/2026-11-17.md" },
    { id: "c", sourceRef: "docs/internal/DETAIL-BATCH3-UNIFIED-20261116.md" },
  ] });
  const srcs = pt.pointers.filter((p) => p.kind === "sourceRef");
  ok(srcs.length === 3 && srcs[0].sourceKind === "ledger", "★★[EV] handoff/ ⇒ ledger", srcs.length ? srcs[0].sourceKind : "(无 sourceRef)");
  ok(srcs.length === 3 && srcs[1].sourceKind === "log", "★★[EV] .dsh-memory/ ⇒ log", srcs.length > 1 ? srcs[1].sourceKind : "(无)");
  ok(srcs.length === 3 && srcs[2].sourceKind === "doc", "★[EV] docs/internal/DETAIL- ⇒ doc", srcs.length > 2 ? srcs[2].sourceKind : "(无)");
  ok(srcs.length === 3 && srcs[0].sourceKind !== "doc" && srcs[1].sourceKind !== "doc", "★★[EV] **账本/日志不冒充施工文档**");
}

// 20. ★路径失效显式标未解析（不静默丢弃）
{
  const pt = m.renderEventSourcePointersPre({
    members: ["存在/a.md", "不存在/b.md"],
    resolvePath: (p) => ({ ok: p.startsWith("存在") }),
  });
  const unresolved = pt.pointers.filter((p) => p.resolved === false);
  ok(unresolved.length === 1 && unresolved[0] && unresolved[0].ref === "不存在/b.md", "★★[EV] 失效路径**显式** resolved=false", String(unresolved.length));
  ok(unresolved.length > 0 && String(unresolved[0].hint).includes("未解析"), "★[EV] hint 明说未解析", unresolved.length ? unresolved[0].hint : "(无未解析指针)");
  ok(pt.warnings.some((w) => w.code === "unresolved-path"), "★★[EV] 失效路径记 warning（不静默丢弃）");
  ok(pt.pointers.length === 2, "★★[EV] 失效路径**仍在 pointers 里**（不当成丢弃）", String(pt.pointers.length));
}

// 21. 无 resolvePath ⇒ 一律标未解析（不假装已解析）
{
  const pt = m.renderEventSourcePointersPre({ members: ["a.md"] });
  ok(pt.pointers.length > 0 && pt.pointers[0].resolved === false, "★★[EV] 未注入 resolvePath ⇒ resolved=false（不假装）", pt.pointers.length + " 个指针");
}

// 22. 纯函数性
{
  const ev = mkEvents(3, 2);
  const snap = JSON.stringify(ev);
  const a = m.selectEventProjectionPre({ events: ev, activeLimit: 2 });
  const b = m.selectEventProjectionPre({ events: ev, activeLimit: 2 });
  ok(JSON.stringify(ev) === snap, "★★[EV] 调用**不修改入参** events");
  ok(JSON.stringify(a) === JSON.stringify(b), "★★[EV] 同输入两次输出一致");
  ok(Object.isFrozen(a), "[EV] 返回已冻结");
  const cpText = "原文" + "x".repeat(2000);
  const cpSnap = cpText;
  m.renderCheckpointPreviewPre({ checkpoint: { id: "x", text: cpText }, budget: { capChars: 100 } });
  ok(cpText === cpSnap, "★★[EV] 预览**不改检查点原文**");
}

// 23. 内置变异（证明断言有区分力）
{
  const a = m.projectEventSectionsPre({ sections: { goal: "G", state: "S", dead: "D" } });
  ok(a.length === 1 && a[0].key === "goal", "[变异M1] 若事件头读 state/dead ⇒ 断言可区分", String(a.length));
  const r1 = m.selectEventProjectionPre({ events: EV10, activeLimit: 2 });
  const r2 = m.selectEventProjectionPre({ events: EV10 });
  ok(r1.cards.length === 2 && r2.cards.length === 0, "[变异M2] 若缺 activeLimit 时擅自展开 ⇒ 断言可区分");
  const nc = m.selectEventProjectionPre({ events: EV10, activeLimit: 2 });
  ok(nc.cards.every((c) => c.label === "最近更新"), "[变异M3] 若无 currentEventIds 却标「当前任务」⇒ 断言可区分");
  const pt = m.renderEventSourcePointersPre({ checkpoints: [{ id: "c", quoteRef: "a/b.md" }] });
  ok(pt.pointers.length > 0 && pt.pointers[0].sourceKind === "quote", "[变异M4] 若 quoteRef 被当路径 ⇒ 断言可区分");
}

console.log("\n── B3-EV 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);
