#!/usr/bin/env node
/**
 * smoke-test-batch3-final-frame.mjs —— B3-NT / B3-BD / B3-FM 验收（L1 §4.6-4.8、L2 §7）
 * 真 import → 真构造 → 真调用 → 断言返回值；正负路径 + 共同反例（L2 §7.4）。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }

const m = await import(pathToFileURL(path.join(REPO, "lib/injection/index.js")).href);
ok(typeof m.projectHandoffPre === "function", "[import] projectHandoffPre 已导出");
ok(typeof m.prepareNotificationPre === "function", "[import] prepareNotificationPre 已导出");
ok(typeof m.finalizeInjectionPre === "function", "[import] finalizeInjectionPre 已导出");
ok(typeof m.commitNotificationPre === "function", "[import] commitNotificationPre 已导出");
ok(typeof m.composeFinalEnvelopePre === "function", "[import] composeFinalEnvelopePre 已导出");
for (const u of ["B3-NT", "B3-BD", "B3-FM"]) {
  ok(m.INJECTION_CONTRACT_INFO.implements.includes(u), "[import] 自述已声明实现 " + u);
}

// ══════════ FM：最终帧 ══════════
const SEG = [
  { id: "t", kind: "title", bucket: "title", text: "[记忆注入]", priority: 100 },
  { id: "r", kind: "body", bucket: "rules", text: "- 规则甲\n- 规则乙", priority: 50 },
  { id: "n", kind: "notification", bucket: "notification", text: "[通知] 有 1 条待办", priority: 30 },
  { id: "f", kind: "reflection", bucket: "reflection", text: "[反思] 昨日要点", priority: 20 },
  { id: "d", kind: "degradationTail", bucket: "degradationTail", text: "[降级] 通道区超限已省略", priority: 10 },
];
const sumOf = (o) => Object.keys(o).reduce((a, k) => a + o[k], 0);

// 1. ★计量等式（L1 §4.7 核心）
{
  const fm = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "compat" } });
  const bucketSum = sumOf(fm.chars.byBucket);
  const segSum = fm.segments.reduce((a, s) => a + s.chars, 0);
  ok(fm.text.length === fm.chars.total, "★★[FM] text.length === chars.total", fm.text.length + " vs " + fm.chars.total);
  ok(fm.chars.total === bucketSum, "★★[FM] chars.total === 分桶之和", fm.chars.total + " vs " + bucketSum);
  ok(bucketSum === segSum + fm.chars.separatorChars, "★★[FM] 分桶和 === 最终段长和 + 分隔长度和", bucketSum + " vs " + segSum + "+" + fm.chars.separatorChars);
  ok(fm.chars.segmentChars === segSum, "★[FM] chars.segmentChars === 段长和");
  ok(typeof fm.chars.bytes === "number" && fm.chars.bytes > 0, "★★[FM] 另记 UTF-8 bytes", String(fm.chars.bytes));
  ok(fm.chars.bytes >= fm.chars.total, "★[FM] UTF-8 bytes >= 字符数（中文多字节）", fm.chars.bytes + " vs " + fm.chars.total);
  ok(fm.chars.tokens === null, "★★[FM] token **未实测 ⇒ null**，不冒称", String(fm.chars.tokens));
}

// 2. ★候选账与实际投递账分离
{
  const fm = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "hard", capChars: 30 } });
  ok(fm.candidateAccount.total === SEG.length, "★★[FM] 候选账记**全部**候选数（不受裁剪影响）", String(fm.candidateAccount.total));
  ok(fm.candidateAccount.chars > fm.deliveredAccount.chars, "★★[FM] 裁剪后候选账 chars > 实际投递 chars（两账分离）", fm.candidateAccount.chars + " vs " + fm.deliveredAccount.chars);
  ok(fm.deliveredAccount.segments === fm.segments.length, "★[FM] 实际账 segments === segments 数量", String(fm.deliveredAccount.segments));
  ok(fm.deliveredAccount.chars === fm.chars.total, "★[FM] 实际账 chars === chars.total");
}

// 3. 硬上限 / 兼容计量 / 未决边界
{
  const compat = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "compat" } });
  ok(compat.dropped.length === 0 && compat.text.length > 0, "★[FM] compat 模式**只计量不裁剪**", "dropped=" + compat.dropped.length);
  ok(compat.unresolved.some((u) => u.key === "budgetPolicy.capChars"), "★[FM] compat 模式显式声明「硬上限未启用」");
  const hardNoCap = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "hard" } });
  ok(hardNoCap.dropped.length === 0, "★★[FM] hard 模式但**未给 capChars ⇒ 不裁剪**（不擅自定值）", "dropped=" + hardNoCap.dropped.length);
  ok(hardNoCap.unresolved.some((u) => u.key === "budgetPolicy.capChars"), "★★[FM] 未给 cap 时进 unresolved，不擅自定值");
  const hard = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "hard", capChars: 30 } });
  ok(hard.text.length <= 30, "★[FM] hard + cap=30 ⇒ 不超限", String(hard.text.length));
  ok(hard.dropped.length > 0, "★[FM] 裁剪如实记 dropped", String(hard.dropped.length));
  ok(hard.degradations.length > 0, "★[FM] 裁剪产生显式 degradation");
  // 剥离后等式仍成立
  const hb = sumOf(hard.chars.byBucket);
  ok(hard.text.length === hard.chars.total && hard.chars.total === hb, "★★[FM] **裁剪后**计量等式仍成立", hard.text.length + "/" + hb);
}

// 4. ★未决边界：不擅自定值
{
  const fm = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "compat" } });
  const keys = fm.unresolved.map((u) => u.key);
  for (const k of ["budgetPolicy.fullExit", "budgetPolicy.compression", "budgetPolicy.50K", "budgetPolicy.segmentLevel", "budgetPolicy.frameLevel"]) {
    ok(keys.includes(k), "★★[FM] 未决边界 " + k + " 进 unresolved（不擅自定值）");
  }
  ok(!("capChars" in fm) && !("limit" in fm), "★[FM] 返回值**不含**擅自定下的上限值");
}

// 5. ★先成段再计量：标题/分隔符/降级尾巴/通知/反思都成为段
{
  const fm = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "compat" } });
  const kinds = fm.segments.map((s) => s.kind);
  for (const k of ["title", "notification", "reflection", "degradationTail"]) {
    ok(kinds.includes(k), "★★[FM] " + k + " **先成为段**（不是事后拼接）");
  }
  ok(new Set(kinds).size === fm.segments.length || kinds.length > 1, "[FM] 段列表非空");
  // 分隔符计入分桶
  ok(fm.chars.byBucket.separator === fm.chars.separatorChars, "★[FM] 分隔符长度进分桶（不凭空多出字符）");
}

// 6. 纯函数性
{
  const snap = JSON.stringify(SEG);
  const a = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "compat" } });
  const b = m.composeFinalEnvelopePre({ candidates: SEG, tier: "full", budgetPolicy: { mode: "compat" } });
  ok(JSON.stringify(SEG) === snap, "★★[FM] 调用**不修改入参** candidates");
  ok(a.text === b.text && a.chars.total === b.chars.total, "★★[FM] 同输入两次输出一致");
  ok(Object.isFrozen(a), "[FM] 返回已冻结");
}

// ══════════ BD：白板/账本投影 ══════════
const PLAN = ["# 白板", "", "type:goal", "目标A", "", "type:state", "进行中B"].join("\n");
const LEDGER = [
  "# 交接账本",
  "type:goal", "目标X",
  "type:state", "状态Y",
  "type:dead-end", "失败原因：方案一因 EPERM 失败",
  "type:progress", "下一步：先跑隔离副本",
].join("\n");

// 7. ★不得在**选择前**做 2000 预截断
{
  // 构造一个 > 2000 字的白板：若实现先截断 2000，尾部信息会丢
  // ★修正夹具（B1 首轮 MISSED 的根因）：原写法把「尾部关键结论」放在**开头第 19 位**，
  //   预截断到 2000 根本切不到它 ⇒ 断言恒真、变异无效。必须把填充内容**放在前面**，
  //   让关键结论真正落在 2000 之后。
  const filler = "很长的背景说明。".repeat(400);
  const bigPlan = ["# 白板", "type:goal", "目标G", filler, "尾部关键结论：这条必须在 >2000 之后"].join("\n");
  ok(bigPlan.indexOf("尾部关键结论") > 2000, "[夹具] 关键结论位置 **>2000**（否则预截断变异无区分力）", String(bigPlan.indexOf("尾部关键结论")));
  ok(bigPlan.length > 2000, "[夹具] 长白板 > 2000 字", String(bigPlan.length));
  const bd = m.projectHandoffPre({ planText: bigPlan, latestHandoffText: LEDGER, tier: "full" });
  ok(bd.planPart.includes("尾部关键结论"), "★★[BD] **选择前不做 2000 预截断**：>2000 字文本的**尾部**仍在", String(bd.planPart.length));
  ok(bd.view.preTruncated2000 === false, "★★[BD] 显式声明 preTruncated2000=false");
}

// 8. ★按节/四段选择，保尾部失败原因与下一步
{
  const full = m.projectHandoffPre({ planText: PLAN, latestHandoffText: LEDGER, tier: "full" });
  ok(full.ledgerPart.includes("失败原因"), "★[BD] full 保留失败原因");
  ok(full.ledgerPart.includes("下一步"), "★[BD] full 保留下一步");
  ok(full.ledgerPart.includes("目标X") && full.ledgerPart.includes("状态Y"), "★[BD] full 四段齐全");
  const slim = m.projectHandoffPre({ planText: PLAN, latestHandoffText: LEDGER, tier: "slim" });
  ok(slim.ledgerPart.includes("失败原因"), "★★[BD] slim **仍保留失败原因**（L1 §4.6 明文）");
  ok(slim.ledgerPart.includes("下一步"), "★★[BD] slim **仍保留下一步**（L1 §4.6 明文）");
  ok(slim.view.profile === "slim" && full.view.profile === "full", "★[BD] 视角正确区分", slim.view.profile + "/" + full.view.profile);
}

// 9. ★无命中不得擅自回退全文
{
  const noHit = m.projectHandoffPre({ planText: "", latestHandoffText: "", tier: "full" });
  ok(noHit.planPart === "" && noHit.ledgerPart === "", "★★[BD] **无命中 ⇒ 空**，不擅自回退全文", JSON.stringify(noHit.planPart));
  // ★加强（B2 首轮 MISSED 的补强）：上面的夹具是**空串**，回退全文也是空 ⇒ 断言无区分力。
  //   改用**只有空白/仅标题**的输入：无有效内容，但回退全文会得到非空串。
  const blankish = "   \n\n   ";
  const nn = m.projectHandoffPre({ planText: blankish, latestHandoffText: "", tier: "full" });
  ok(nn.planPart.trim() === "", "★★[BD] **空白输入 ⇒ 不回退原文**（回退会得到非空串）", JSON.stringify(nn.planPart));
  // 再补一条：只有 HTML 注释（无正文）⇒ 也不得回退
  const onlyComment = "<!-- memory:mem_" + "a".repeat(32) + " -->";
  const oc = m.projectHandoffPre({ planText: onlyComment, latestHandoffText: "", tier: "full" });
  ok(!oc.planPart.includes("memory:mem_"), "★★[BD] 仅注释无正文 ⇒ 不回退全文", JSON.stringify(oc.planPart).slice(0, 40));
  const noHitDeg = m.projectHandoffPre({ planText: "", latestHandoffText: "", tier: "full", policy: { onNoHit: "degrade" } });
  ok(noHitDeg.degradations.length > 0, "★[BD] 显式要求时，无命中产生 degradation");
  // 无标签但非空的文本：不能丢（不是「无命中」）
  const plain = m.projectHandoffPre({ planText: "一段没有四段标签的正文", latestHandoffText: "", tier: "full" });
  ok(plain.planPart.includes("没有四段标签"), "★[BD] 无标签但非空 ⇒ 保留内容（不误判为无命中）");
}

// 10. ★选择**之后**才截断（segmentCapChars）+ 保尾部
{
  const longDead = ["type:dead-end", "前面很长的失败描述。".repeat(60) + "\n最后一行：EPERM 是根因"].join("\n");
  const text = ["# 账本", "type:goal", "目标X", longDead].join("\n");
  const bd = m.projectHandoffPre({ planText: "", latestHandoffText: text, tier: "full", policy: { sectionCapChars: 80 } });
  ok(bd.counts.truncated === true, "★[BD] 超段级上限 ⇒ truncated=true");
  ok(bd.ledgerPart.includes(m.TRUNCATION_MARKER), "★★[BD] 截断处有**显式截断标记**");
  ok(bd.ledgerPart.includes("EPERM 是根因"), "★★[BD] 截断保留**尾部**（关键结论在段尾）");
  const noCap = m.projectHandoffPre({ planText: "", latestHandoffText: text, tier: "full", policy: {} });
  ok(noCap.counts.truncated === false, "★★[BD] 未给段级上限 ⇒ **不截断**（不擅自定值）");
  ok(noCap.unresolved.some((u) => u.key === "sectionCapChars"), "★[BD] 未给上限进 unresolved");
}

// 11. BD 纯函数性 + 不改原文
{
  const p0 = PLAN, h0 = LEDGER;
  const a = m.projectHandoffPre({ planText: PLAN, latestHandoffText: LEDGER, tier: "full" });
  ok(PLAN === p0 && LEDGER === h0, "★★[BD] **不改 PLAN/账本原文**（字符串不可变，且不写回）");
  const b = m.projectHandoffPre({ planText: PLAN, latestHandoffText: LEDGER, tier: "full" });
  ok(a.planPart === b.planPart && a.ledgerPart === b.ledgerPart, "★[BD] 同输入两次输出一致");
  ok(typeof a.sourceIdentity === "string" && a.sourceIdentity.length > 0, "★[BD] 提供 sourceIdentity", a.sourceIdentity);
  let threw = null;
  try { m.projectHandoffPre({ planText: "", latestHandoffText: "", tier: "bogus" }) } catch (e) { threw = e }
  ok(threw && threw.code === "injection-invalid-enum", "★[BD] 非法档位 ⇒ 显式报错", threw && threw.code);
}

// ══════════ NT：通知与定稿 ══════════
const mkScan = () => ({ planUpdatePending: true, due: [{ id: "n1" }, { id: "n2" }] });
const mkStore = () => { const mem = {}; return { mem, read: (k) => (k in mem ? mem[k] : null), write: (k, v) => { mem[k] = v } } };

// 12. ★prepare 只读（不消费/不清/不推进/不发）
{
  const scan = mkScan();
  const before = JSON.stringify(scan);
  const p = m.prepareNotificationPre({ scanResult: scan, runtimeScope: "ws-1", sessionId: "s-1" });
  ok(JSON.stringify(scan) === before, "★★[NT] prepare **不修改/不消费** scanResult", "");
  ok(scan.planUpdatePending === true, "★★[NT] prepare **不清** planUpdatePending");
  ok(p.dtoKind === "PreparedNotification", "★[NT] 产出 PreparedNotification");
  ok(typeof p.commitToken === "string" && p.commitToken.length > 0, "★[NT] 提供 commitToken");
  ok(!("sent" in p) && !("delivered" in p), "★★[NT] prepare **不发通知**（无 sent/delivered 字段）");
}

// 13. ★runtimeScope / sessionId 必填（不回落默认 runtime）
{
  let e1 = null, e2 = null;
  try { m.prepareNotificationPre({ scanResult: mkScan(), sessionId: "s-1" }) } catch (e) { e1 = e }
  try { m.prepareNotificationPre({ scanResult: mkScan(), runtimeScope: "ws-1" }) } catch (e) { e2 = e }
  ok(e1 && e1.field === "runtimeScope", "★★[NT] 缺 runtimeScope ⇒ 显式拒绝（**不回落默认 runtime**）", e1 && e1.code);
  ok(e2 && e2.field === "sessionId", "★★[NT] 缺 sessionId ⇒ 显式拒绝", e2 && e2.code);
}

// 14. prepare 幂等
{
  const a = m.prepareNotificationPre({ scanResult: mkScan(), runtimeScope: "ws-1", sessionId: "s-1" });
  const b = m.prepareNotificationPre({ scanResult: mkScan(), runtimeScope: "ws-1", sessionId: "s-1" });
  ok(a.id === b.id && a.version === b.version && a.commitToken === b.commitToken, "★★[NT] 同输入 ⇒ 同 id/version/commitToken（幂等）");
  const c = m.prepareNotificationPre({ scanResult: mkScan(), runtimeScope: "ws-1", sessionId: "s-2" });
  ok(c.id !== a.id, "★[NT] 不同 sessionId ⇒ 不同 id");
}

// 15. ★finalize 不冒充宿主已交付
{
  const p = m.prepareNotificationPre({ scanResult: mkScan(), runtimeScope: "ws-1", sessionId: "s-1" });
  const fin = m.finalizeInjectionPre({ requestId: "req-1", text: "最终文本", prepared: [p] });
  ok(fin.finalizeReceipt.hostObservation.projected === "unknown", "★★[NT] finalize 的 hostObservation **恒 unknown**（不冒充已交付）", fin.finalizeReceipt.hostObservation.projected);
  ok(fin.finalizeReceipt.hostObservation.retained === "unknown", "★★[NT] retained 也恒 unknown");
  ok(fin.selectedNotificationIds.length === 1 && fin.selectedNotificationIds[0] === p.id, "★[NT] selectedNotificationIds 记录候选身份");
  ok(fin.finalizeReceipt.preparedVersions[p.id] === p.version, "★[NT] preparedVersions 记录版本");
  ok(fin.text === "最终文本", "★[NT] finalize 只定稿**插件最终文本**");
  ok(typeof fin.finalizeReceipt.textSha256 === "string" && fin.finalizeReceipt.textSha256.length === 64, "★[NT] 记录 textSha256", fin.finalizeReceipt.textSha256.slice(0, 12) + "…");
}

// 16. ★commit 幂等 + 旧版本不清新待办 + 写盘失败可重试
{
  const store = mkStore();
  const p = m.prepareNotificationPre({ scanResult: mkScan(), runtimeScope: "ws-1", sessionId: "s-1" });
  const fin = m.finalizeInjectionPre({ requestId: "r-1", text: "T", prepared: [p] });
  const c1 = m.commitNotificationPre({ requestId: "r-1", finalizeReceipt: fin.finalizeReceipt, store });
  ok(c1.committed.length === 1 && c1.errors.length === 0, "★[NT] 首次 commit 成功", "committed=" + c1.committed.length);
  const c2 = m.commitNotificationPre({ requestId: "r-1", finalizeReceipt: fin.finalizeReceipt, store });
  ok(c2.committed.length === 0 && c2.skipped.length === 1, "★★[NT] 同请求再次 commit ⇒ **幂等跳过**（不重复提交）", "skipped=" + c2.skipped.length);
  // 旧版本 commit 不得清新待办
  const older = m.finalizeInjectionPre({ requestId: "r-1", text: "T", prepared: [{ id: p.id, version: p.version - 1 > 0 ? p.version - 1 : 0 }] });
  const c3 = m.commitNotificationPre({ requestId: "r-1", finalizeReceipt: older.finalizeReceipt, store });
  ok(c3.committed.length === 0, "★★[NT] **旧版本不得覆盖新版本**（committed=0）", String(c3.committed.length));
  ok(store.mem["r-1"].versions[p.id] === p.version, "★★[NT] 存储里的版本**仍是新版本**（旧 commit 未清掉新待办）", String(store.mem["r-1"].versions[p.id]));
}

// 17. ★写盘失败显式报错 + 可重试
{
  let failOnce = true;
  const mem = {};
  const flaky = {
    read: (k) => (k in mem ? mem[k] : null),
    write: (k, v) => { if (failOnce) { failOnce = false; const e = new Error("EPERM: readonly"); throw e } mem[k] = v },
  };
  const p = m.prepareNotificationPre({ scanResult: mkScan(), runtimeScope: "ws-1", sessionId: "s-1" });
  const fin = m.finalizeInjectionPre({ requestId: "r-2", text: "T", prepared: [p] });
  const c1 = m.commitNotificationPre({ requestId: "r-2", finalizeReceipt: fin.finalizeReceipt, store: flaky });
  ok(c1.errors.length > 0 && c1.errors.some((e) => e.code === "store-write-failed"), "★★[NT] 写盘失败 ⇒ **显式报错**（不吞）", c1.errors.map((e) => e.code).join(","));
  ok(c1.committed.length === 0, "★★[NT] 写失败时 **不谎报已提交**");
  ok(!("r-2" in mem), "★★[NT] 写失败时存储无残留");
  const c2 = m.commitNotificationPre({ requestId: "r-2", finalizeReceipt: fin.finalizeReceipt, store: flaky });
  ok(c2.committed.length === 1 && c2.errors.length === 0, "★★[NT] **重试成功**（可重试）", "committed=" + c2.committed.length);
}

// 18. 待办/水位/授予分开处理
{
  const sp = m.splitRuntimeSignalsPre({ planUpdatePending: true, recallJustDelivered: true, waterPct: 51, fullGranted: true, postCompact: true });
  ok(sp.pending.planUpdatePending === true, "★[NT] pending 类独立");
  ok(sp.recall.recallJustDelivered === true, "★[NT] recall 类独立");
  ok(sp.cadence.waterPct === 51 && sp.cadence.fullGranted === true && sp.cadence.postCompact === true, "★★[NT] cadence 类与 pending/recall **分开**");
  ok(!("waterPct" in sp.pending) && !("planUpdatePending" in sp.cadence), "★★[NT] 三类互不混入");
}

console.log("\n── B3-NT/BD/FM 验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);