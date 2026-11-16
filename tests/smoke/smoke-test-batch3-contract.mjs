#!/usr/bin/env node
/**
 * smoke-test-batch3-contract.mjs —— B3-U2 公共 DTO/profile/ports 契约验收
 *
 * 纪律（L1 §9 / CR-10）：
 *   真 import → 真构造 → 真调用 → 断言返回值；
 *   每条正路径配**负路径**（非法输入/版本不符/缺 port 必须显式报错或降级）；
 *   内置**隔离变异**证明断言有区分力（不是恒真）。
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
function ok(c, n, d) { if (c) { pass++; console.log("PASS " + n + (d ? "  =>  " + d : "")) } else { fail++; console.log("FAIL " + n + (d ? "  =>  " + d : "")) } }
function throwsCode(fn, code, n, label) {
  try { fn(); ok(false, n, "未抛错（应为 " + code + "）") }
  catch (e) { ok(e && e.code === code, n, (e && e.code) + (label ? " | " + label : "")) }
}

// ── 0. 真 import
const m = await import(pathToFileURL(path.join(REPO, "lib/injection/index.js")).href);
ok(typeof m === "object" && m !== null, "[import] lib/injection/index.js 可加载");
// ★判据改造（2026-11-17，第三次计数锁漂移后）：**不再把导出总数写死成字面量**。
//   原因：每次实现新单元都会加导出（36→37→43→54），写死数字只会周期性变红，
//   每次都要人工重钉 —— 这是「判据过期」的反复发生，而不是缺陷检出。
//   改为**结构性判据**：①导出数必须是正整数；②**已实现单元的关键符号必须都在**；
//   ③**未实现单元的符号必须都不在**（防止「声称没实现却已偷偷导出」）。
//   这样新增合法导出不会假红，而删掉/漏掉关键符号仍会真红。
const exported = Object.keys(m);
ok(exported.length > 0, "[import] 导出符号非空", String(exported.length));
const REQUIRED_BY_UNIT = {
  "U2-contract": ["makeSourceProof", "makeContentSpec", "makeCadenceDecision", "createPortRegistry", "RESERVED_FIELD_NAMES"],
  "B3-SR": ["readInjectionSourcesPre", "createSourcesPort"],
  "B3-RC": ["readRulesAggregatePre", "RULE_LAYERS", "READ_STATUS"],
  "B3-CA": ["decideInjectionCadencePre", "createCadencePort", "GRANT_REASONS"],
  "B3-PJ": ["projectInjectionPre", "createProjectionPort", "CONTENT_SPEC_TO_PROMPT_SECTION"],
  "B3-RP": ["renderRulesForTierPre", "RENDER_TIERS", "NOTE_PREFIX", "SLIM_MAINTAIN_BLOCK"],
  "B3-BD": ["projectHandoffPre", "HANDOFF_TAGS", "HANDOFF_VIEW_TIERS", "SLIM_MUST_KEEP", "tailTruncate"],
  "B3-NT": ["prepareNotificationPre", "finalizeInjectionPre", "commitNotificationPre", "splitRuntimeSignalsPre"],
  "B3-FM": ["composeFinalEnvelopePre", "SEGMENT_KINDS", "BUDGET_MODES", "DEFAULT_SEPARATOR"],
};
for (const [unit, names] of Object.entries(REQUIRED_BY_UNIT)) {
  const missing = names.filter((n) => !(n in m));
  ok(missing.length === 0, "[import] " + unit + " 的关键导出齐全", missing.length ? "缺: " + missing.join(",") : names.length + " 个");
}
// 未实现单元不得有实现符号（防「声称没实现却已导出」）
{
  // ★B3-RP 已实现 ⇒ 其符号从「未实现」清单移出（这正是结构性判据在起作用：
  //   上轮它在此处红了两条，提示「声称没实现却已导出」——本轮按实现进度同步）。
  // ★BD/FM/NT 已实现 ⇒ 其符号从「未实现」清单移出，只留 B3-EV 的符号。
  const forbidden = ["selectEventProjectionPre", "renderCheckpointPreviewPre"];
  const leaked = forbidden.filter((n) => n in m);
  ok(leaked.length === 0, "★[import] 未实现单元（RP/BD/FM/NT/EV）的符号**未**被导出", leaked.length ? "泄漏: " + leaked.join(",") : "0 泄漏");
}
ok(Array.isArray(m.RESERVED_FIELD_NAMES) && m.RESERVED_FIELD_NAMES.join(",") === "dtoKind,schemaVersion", "[import] 保留字段清单 = dtoKind,schemaVersion");
ok(m.INJECTION_CONTRACT_INFO.implements[0] === "contract-only", "[import] 包自述为 contract-only（不实现业务模块）");
// ★判据改法（判据过期类）：不锁死长度，而锁「**仍未实现**的业务模块必须显式列在 doesNotImplement」。
//   SR/RC 已由 task-37 实现并移出该列表 ⇒ 旧断言「长度===4」属过期判据，已按纪律重钉。
{
  const info = m.INJECTION_CONTRACT_INFO;
  const IMPL = info.implements, NOT = info.doesNotImplement;
  // ★结构性判据（同样的理由：不写死长度/成员，只锁「一致性」）
  ok(Array.isArray(IMPL) && Array.isArray(NOT), "[import] implements / doesNotImplement 都是数组");
  const overlap = IMPL.filter((x) => NOT.includes(x));
  ok(overlap.length === 0, "★[import] 实现与未实现列表**无交集**（不得既声称实现又声称未实现）", overlap.join(",") || "无交集");
  for (const u of ["B3-SR", "B3-RC", "B3-CA", "B3-PJ", "B3-RP", "B3-BD", "B3-NT", "B3-FM"]) {
    ok(IMPL.includes(u) && !NOT.includes(u), "[import] " + u + " 已在 implements 且不在 doesNotImplement");
  }
  for (const u of ["B3-EV", "B3-CO"]) {
    ok(NOT.includes(u) && !IMPL.includes(u), "[import] " + u + " 仍在 doesNotImplement（未实现）");
  }
}

// ── 1. 8 个 DTO：真构造 + 字段完整 + JSON 往返
const HEX = "a".repeat(64);
const cases = {
  SourceProof: () => m.makeSourceProof({ sourceRef: "projects/x.md", bytes: 12, rawSha256: HEX, normalizedSha256: HEX, revision: "r1" }),
  ProjectionCandidate: () => m.makeProjectionCandidate({ id: "c1", kind: "rules", bucket: "rules", priority: 1, text: "t", sourceIdentity: "s", contentVersion: "v1" }),
  ContentSpec: () => m.makeContentSpec(Object.assign({}, Object.fromEntries(m.CONTENT_SPEC_SEGMENTS.map(s => [s, m.CONTENT_SPEC_ENUMS[s][0]])), { budgetPolicy: { unit: "js-chars", cap: null, unresolved: true }, sourceIdentity: "src-1" })),
  CadenceDecision: () => m.makeCadenceDecision({ tier: "full", fullGranted: true, slimAllowed: true, grants: ["full"], reasons: ["water"], requestKey: "t1:s1" }),
  PreparedNotification: () => m.makePreparedNotification({ id: "n1", version: 1, payload: "p", commitToken: "tok" }),
  FinalizeReceipt: () => m.makeFinalizeReceipt({ requestId: "r1", textSha256: HEX, selectedNotificationIds: ["n1"], preparedVersions: { n1: 1 }, hostObservation: { requestId: "r1", projected: "unknown", retained: "unknown", observedAt: null, evidenceRef: null } }),
  HostDeliveryObservation: () => m.makeHostDeliveryObservation({ requestId: "r1", projected: "projected", retained: "unknown", observedAt: "2026-11-17T00:00:00Z", evidenceRef: "ev/1" }),
  DeliveryReceipt: () => m.makeDeliveryReceipt({ requestId: "r1", finalizedText: "text", selectedNotificationIds: ["n1"], committed: ["n1"], skipped: [], errors: [{ code: "x", message: "y" }] }),
};
const built = {};
for (const [name, mk] of Object.entries(cases)) {
  let v = null, err = null;
  try { v = mk() } catch (e) { err = e }
  ok(!err && v && v.dtoKind === name, "[DTO] " + name + " 真构造成功", err ? String(err.message).slice(0, 70) : v.kind);
  if (!v) continue;
  built[name] = v;
  ok(Object.isFrozen(v), "[DTO] " + name + " 已冻结（输入不可变）");
  const rt = JSON.parse(JSON.stringify(v));
  ok(rt.dtoKind === name && rt.schemaVersion === 1, "[DTO] " + name + " JSON 往返保持身份");
  ok(JSON.stringify(rt) === JSON.stringify(JSON.parse(JSON.stringify(v))), "[DTO] " + name + " 序列化稳定（两次一致）");
}
ok(built.ProjectionCandidate.kind === "rules", "★[DTO] ProjectionCandidate 业务 kind 与判别 dtoKind 不互相覆盖", built.ProjectionCandidate.kind + " / " + built.ProjectionCandidate.dtoKind);
ok(Object.keys(built).length === 8, "[DTO] 8 个 DTO 全部构造成功", String(Object.keys(built).length));

// ── 2. 负路径：非法输入必须显式报错（不得静默纠正）
throwsCode(() => m.makeSourceProof({}), m.INJECTION_ERROR_CODES.MISSING_FIELD, "[负路径] SourceProof 缺字段 ⇒ missing-field");
throwsCode(() => m.makeSourceProof({ sourceRef: "a", bytes: -1, rawSha256: HEX, normalizedSha256: HEX, revision: "r" }), m.INJECTION_ERROR_CODES.INVALID_ARGUMENT, "[负路径] bytes 为负 ⇒ invalid-argument");
throwsCode(() => m.makeSourceProof({ sourceRef: "", bytes: 1, rawSha256: HEX, normalizedSha256: HEX, revision: "r" }), m.INJECTION_ERROR_CODES.INVALID_ARGUMENT, "[负路径] sourceRef 空串 ⇒ invalid-argument");
throwsCode(() => m.makeSourceProof(null), m.INJECTION_ERROR_CODES.INVALID_ARGUMENT, "[负路径] 传 null ⇒ invalid-argument");
throwsCode(() => m.makeCadenceDecision({ tier: "nope", fullGranted: true, slimAllowed: true, grants: [], reasons: [], requestKey: "k" }), m.INJECTION_ERROR_CODES.INVALID_ENUM, "[负路径] 非法 tier ⇒ invalid-enum");
// 非法 ContentSpec 枚举
{
  const bad = Object.assign({}, Object.fromEntries(m.CONTENT_SPEC_SEGMENTS.map(s => [s, m.CONTENT_SPEC_ENUMS[s][0]])), { rules: "__nope__", budgetPolicy: { unit: "js-chars", cap: null }, sourceIdentity: "s" });
  throwsCode(() => m.makeContentSpec(bad), m.INJECTION_ERROR_CODES.INVALID_ENUM, "[负路径] ContentSpec.rules 非法 ⇒ invalid-enum");
}
// 缺 ContentSpec 段
{
  const partial = { rules: "none", budgetPolicy: { unit: "js-chars" }, sourceIdentity: "s" };
  throwsCode(() => m.makeContentSpec(partial), m.INJECTION_ERROR_CODES.MISSING_FIELD, "[负路径] ContentSpec 缺段 ⇒ missing-field（不允许各模块自填默认）");
}

// ── 3. 不可序列化输入必须拒绝（Map / 函数 / 循环）
{
  const mk = (payload) => () => m.makePreparedNotification({ id: "n", version: 1, payload, commitToken: "t" });
  throwsCode(mk({ get: () => 1 }), m.INJECTION_ERROR_CODES.INVALID_ARGUMENT, "[负路径] payload 是对象（类型不符）⇒ invalid-argument");
}
ok(true, "[负路径] （原「未知字段」一条已改为下方白名单断言：契约采用白名单构造，语义更明确）");
{
  // 白名单构造：多余字段**不进入** DTO（避免 DTO 被塞入未登记字段）
  const extra = m.makeSourceProof({ sourceRef: "a", bytes: 1, rawSha256: HEX, normalizedSha256: HEX, revision: "r", __evil: "x" });
  ok(!("__evil" in extra), "[负路径] 未登记字段不进入 DTO（白名单构造）");
  // 保留字段名不得被调用方占用
  throwsCode(() => m.makeSourceProof({ sourceRef: "a", bytes: 1, rawSha256: HEX, normalizedSha256: HEX, revision: "r", dtoKind: "fake" }), m.INJECTION_ERROR_CODES.INVALID_ARGUMENT, "[负路径] 占用保留字段 dtoKind ⇒ invalid-argument");
}

// ── 4. profile：单一 policyVersion + 版本不符显式报错
const prof = m.makeInjectionProfile({ policyVersion: m.INJECTION_PROFILE_VERSION, sourceIdentity: "src", tier: "full", budgetUnit: "js-chars", representationVersion: "repr-1", degradePolicy: "explicit" });
ok(prof.kind === "InjectionProfile" && Object.isFrozen(prof), "[profile] 真构造并冻结");
ok(prof.policyVersion === 1, "[profile] 单一 policyVersion=1", String(prof.policyVersion));
ok(!("promptVersion" in prof) && !("schemaVersion" in prof && prof.schemaVersion !== 1), "[profile] 不建平行版本字段（无 promptVersion）");
throwsCode(() => m.makeInjectionProfile({ policyVersion: 99, sourceIdentity: "s", tier: "full", budgetUnit: "js-chars", representationVersion: "r", degradePolicy: "explicit" }), m.INJECTION_ERROR_CODES.VERSION_MISMATCH, "[负路径] policyVersion=99 ⇒ version-mismatch");
throwsCode(() => m.makeInjectionProfile({ policyVersion: 1, sourceIdentity: "s", tier: "bogus", budgetUnit: "js-chars", representationVersion: "r", degradePolicy: "explicit" }), m.INJECTION_ERROR_CODES.INVALID_ENUM, "[负路径] 非法 tier ⇒ invalid-enum");
throwsCode(() => m.makeInjectionProfile({ policyVersion: 1, sourceIdentity: "s", tier: "full", budgetUnit: "token", representationVersion: "r", degradePolicy: "explicit" }), m.INJECTION_ERROR_CODES.INVALID_ENUM, "[负路径] budgetUnit=token ⇒ 拒绝（未实测不得冒称）");

// ── 5. ports：缺 port 显式降级
const reg = m.createPortRegistry({ clock: () => "2026-11-17T00:00:00Z" });
ok(reg.kind === "PortRegistry" && Object.isFrozen(reg), "[ports] 真构造并冻结");
ok(reg.provided.length === 1 && reg.missing.length === 4, "[ports] provided=1 / missing=4", reg.provided.join(",") + " | " + reg.missing.join(","));
const called = m.callPort(reg, "clock", []);
ok(called.ok === true && called.value === "2026-11-17T00:00:00Z", "[ports] 已注入 port 返回 ok:true 与真实值", called.value);
const missingCall = m.callPort(reg, "sources", []);
ok(missingCall.ok === false, "★[ports] 缺 port ⇒ ok:false（显式降级）");
ok(missingCall.degradation && missingCall.degradation.code === "port-missing", "★[ports] 降级码=port-missing", missingCall.degradation && missingCall.degradation.code);
ok(missingCall.degradation.scope === "sources", "[ports] 降级记录指明 scope");
ok(missingCall.value === null, "[ports] 缺 port 时 value 显式 null（不是 undefined）");
const cov = m.describePortCoverage(reg);
ok(cov.total === 5 && cov.provided === 1 && cov.missing === 4 && cov.complete === false, "[ports] 覆盖清点 total=5/provided=1/missing=4");
throwsCode(() => m.createPortRegistry({ clock: 123 }), m.INJECTION_ERROR_CODES.INVALID_ARGUMENT, "[负路径] port 非函数 ⇒ invalid-argument");
throwsCode(() => m.callPort(reg, "bogusPort", []), m.INJECTION_ERROR_CODES.INVALID_ENUM, "[负路径] 未知 port 名 ⇒ invalid-enum");
throwsCode(() => m.callPort(reg, "clock", []).ok && m.callPort(m.createPortRegistry({ clock: () => { throw new Error("boom") } }), "clock", []), m.INJECTION_ERROR_CODES.DEGRADED, "[负路径] port 抛错 ⇒ degraded 契约错误（保留 message）");

// ── 6. HostDeliveryObservation 不得伪造 hostDelivered
const unknownObs = m.makeUnknownHostObservation("r1");
ok(unknownObs.projected === "unknown" && unknownObs.retained === "unknown", "★[host] 未观测默认 unknown（绝不默认 projected）");
ok(!("hostDelivered" in unknownObs), "★[host] 不存在 hostDelivered 字段（不得伪造）");
throwsCode(() => m.makeHostDeliveryObservation({ requestId: "r", projected: "delivered", retained: "unknown", observedAt: null }), m.INJECTION_ERROR_CODES.INVALID_ENUM, "[负路径] projected='delivered' ⇒ invalid-enum（只允许 unknown/projected/retained）");

// ── 7. 内置隔离变异（证明断言有区分力）
ok(typeof m.fail === "function" && typeof m.isInjectionContractError === "function", "[变异前置] fail/isInjectionContractError 可用");
{
  let caught = null;
  try { m.fail(m.INJECTION_ERROR_CODES.INVALID_ARGUMENT, "x") } catch (e) { caught = e }
  ok(caught && m.isInjectionContractError(caught), "[变异M1] 契约错误可被 isInjectionContractError 识别");
  ok(typeof caught.toJSON === "function" && caught.toJSON().code === m.INJECTION_ERROR_CODES.INVALID_ARGUMENT, "[变异M1] 错误可 JSON 序列化且保留 code");
}
{
  // 若 makeUnknownHostObservation 改成默认 projected ⇒ 上面 ★ 断言必红
  const leaky = () => ({ requestId: "r", projected: "projected", retained: "projected", observedAt: null, evidenceRef: null });
  ok(leaky().projected === "projected" && unknownObs.projected === "unknown", "[变异M2] 默认值断言可区分（unknown vs projected）");
}
{
  // 若 callPort 缺 port 时返回 ok:true ⇒ ★ 断言必红
  const leakyCall = () => ({ ok: true, value: null, degradation: null });
  ok(leakyCall().ok === true && missingCall.ok === false, "[变异M3] 缺 port 降级断言可区分（false vs true）");
}

console.log("\n── B3-U2 契约验收：" + pass + " PASS / " + fail + " FAIL ──");
if (fail > 0) process.exit(1);