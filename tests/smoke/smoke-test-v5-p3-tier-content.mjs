/**
 * smoke-test-v5-p3-tier-content.mjs
 *
 * v5-P3（2026-10-26）验收套件：**按档位差异化注入内容**。
 *
 * 覆盖两件事：
 *   A 档位判定 decideInjectTierPre（七档，优先级）
 *   B 白板投递规格 planSpecForTierPre（全文 / 核心3节 / 不投）
 *   C 档位谓词（isHumanTierPre / isPlanFullTierPre / shouldInjectPlanPre / isRulesFullTierPre）
 *   D 端到端：真跑 truncatePlanBySections + 真实白板，验证 F1 全文 vs 瘦档 3 节
 *   E semantic-recall：配置键 / 引导语字面量 / 投递范围 / 零字节纪律
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'D:/dsh-auto-memory'
let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const idxSrc = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

function extractFn(src, name) {
  const marker = 'const ' + name + ' = ('
  const i = src.indexOf(marker)
  if (i < 0) return null
  let j = src.indexOf('=> {', i)
  if (j < 0) return null
  j = src.indexOf('{', j)
  let depth = 0
  let k = j
  for (; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { k++; break } }
  }
  return src.slice(i, k)
}

// 抽取档位常量块（INJECT_TIERS + 谓词 + PLAN_CORE_SECTIONS + 两个判定函数）
const tierBlockStart = idxSrc.indexOf("const INJECT_TIERS = {")
const tierBlockEnd = idxSrc.indexOf("const parseWaterPctThresholdsPre")
if (tierBlockStart < 0 || tierBlockEnd < 0) { console.error("档位块抽取失败"); process.exit(2) }
const tierBlock = idxSrc.slice(tierBlockStart, tierBlockEnd)
let T = null
try {
  T = new Function(tierBlock + "; return { INJECT_TIERS, isHumanTierPre, isPlanFullTierPre, shouldInjectPlanPre, isRulesFullTierPre, PLAN_CORE_SECTIONS, decideInjectTierPre, planSpecForTierPre };")()
} catch (e) { console.error("档位块执行失败: " + e.message); process.exit(2) }

console.log("== A. decideInjectTierPre 档位判定 ==")
const D = T.decideInjectTierPre
const I = T.INJECT_TIERS
ok(D({ isHuman: true, isFull: true }) === I.HUMAN_FULL, "A-1 真人+完整 -> HUMAN_FULL")
ok(D({ isHuman: true, isFull: false }) === I.HUMAN_SLIM, "A-2 真人+精简 -> HUMAN_SLIM")
ok(D({ isHuman: false, isFull: true }) === I.RUN_FULL, "A-3 非真人+完整 -> RUN_FULL")
ok(D({ isHuman: false, isFull: false }) === I.RUN_SLIM, "A-4 非真人+精简 -> RUN_SLIM")
ok(D({ isHuman: true, isFull: true, isCarry: true }) === I.HANDOFF_CARRY, "A-5 交接优先级最高")
ok(D({ isHuman: true, isFull: true, postCompact: true }) === I.POST_COMPACT, "A-6 压缩后优先于真人档")
ok(D({ isHuman: false, isFull: true, hangComp: true }) === I.HANG_COMPENSATE, "A-7 挂机补偿")
ok(D({ isHuman: true, isFull: true, isCarry: true, postCompact: true, hangComp: true }) === I.HANDOFF_CARRY, "A-8 全部命中时交接最高")
ok(D({ postCompact: true, hangComp: true }) === I.POST_COMPACT, "A-9 压缩 > 挂机")
ok(D({ hangComp: true }) === I.HANG_COMPENSATE, "A-10 挂机 > 普通")
ok(D({}) === I.RUN_SLIM, "A-11 空参数 -> RUN_SLIM（默认最省）")
ok(D(null) === I.RUN_SLIM, "A-12 null -> RUN_SLIM（不崩）")

console.log("")
console.log("== B. planSpecForTierPre 白板投递规格 ==")
const P = T.planSpecForTierPre
const cfg = { handoffPlanSectionMax: 2000 }
let sp = P(I.HUMAN_FULL, cfg)
ok(sp.inject === true && sp.sections === null, "B-1 F1 用户发声完整 -> 投全文（sections=null）")
sp = P(I.HANDOFF_CARRY, cfg)
ok(sp.inject === true && sp.sections === null, "B-2 F6 交接 -> 投全文")
sp = P(I.HUMAN_SLIM, cfg)
ok(sp.inject === true && Array.isArray(sp.sections) && sp.sections.length === 3, "B-3 F2 人声精简 -> 核心3节")
sp = P(I.RUN_FULL, cfg)
ok(sp.inject === true && Array.isArray(sp.sections) && sp.sections.length === 3, "B-4 F3 运行完整 -> 核心3节")
sp = P(I.POST_COMPACT, cfg)
ok(sp.inject === true && Array.isArray(sp.sections), "B-5 F5 压缩后 -> 核心3节")
sp = P(I.HANG_COMPENSATE, cfg)
ok(sp.inject === true && Array.isArray(sp.sections), "B-6 F7 挂机 -> 核心3节")
sp = P(I.RUN_SLIM, cfg)
ok(sp.inject === false, "B-7 F4 运行精简 -> **不投白板**")
sp = P(I.RUN_FULL, {})
ok(sp.maxChars === 2000, "B-8 maxChars 缺失 -> 默认 2000")
sp = P(I.RUN_FULL, { handoffPlanSectionMax: 500 })
ok(sp.maxChars === 500, "B-9 maxChars 可配")

console.log("")
console.log("== C. 档位谓词 ==")
ok(T.isHumanTierPre(I.HUMAN_FULL) === true && T.isHumanTierPre(I.HUMAN_SLIM) === true, "C-1 人声档谓词 true")
ok(T.isHumanTierPre(I.RUN_FULL) === false && T.isHumanTierPre(I.RUN_SLIM) === false, "C-2 运行档谓词 false（负路径）")
ok(T.isHumanTierPre(I.POST_COMPACT) === false, "C-3 压缩后不算人声档")
ok(T.isPlanFullTierPre(I.HUMAN_FULL) === true && T.isPlanFullTierPre(I.HANDOFF_CARRY) === true, "C-4 全文档只有 F1/F6")
ok(T.isPlanFullTierPre(I.RUN_FULL) === false, "C-5 运行完整版**不给**全文（负路径）")
ok(T.shouldInjectPlanPre(I.RUN_SLIM) === false, "C-6 只有 F4 不投白板")
ok(T.isRulesFullTierPre(I.RUN_SLIM) === false, "C-7 只有 F4 规则不全给")
ok(T.isRulesFullTierPre(I.RUN_FULL) === true, "C-8 运行完整版给规则全文")
ok(Array.isArray(T.PLAN_CORE_SECTIONS) && T.PLAN_CORE_SECTIONS.length === 3, "C-9 核心 3 节")

console.log("")
console.log("== D. 端到端：真跑 truncatePlanBySections + 真实白板 ==")
const fnSrc = extractFn(idxSrc, "truncatePlanBySections")
let tps = null
if (fnSrc) { try { tps = new Function(fnSrc + "; return truncatePlanBySections;")() } catch (e) {} }
ok(typeof tps === "function", "D-0 truncatePlanBySections 可真构造")
const PLAN = "C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/PLAN.md"
let planRaw = ""
try { planRaw = fs.readFileSync(PLAN, "utf8") } catch (e) { planRaw = "" }
ok(planRaw.length > 0, "D-1 真实白板可读", "共 " + planRaw.length + " 字符")
if (typeof tps === "function" && planRaw.length > 0) {
  const core = T.PLAN_CORE_SECTIONS
  const slimOut = tps(planRaw, core, 2000)
  ok(slimOut !== null && slimOut.length > 0, "D-2 瘦档真产出非空", "len=" + (slimOut ? slimOut.length : 0))
  const slimPct = (100 * (slimOut || "").length / planRaw.length).toFixed(1)
  ok((slimOut || "").length < planRaw.length / 2, "D-3 瘦档显著小于全文", slimPct + "%")
  let hasCore = true
  for (const sname of ["最新实况", "当前目标"]) { if ((slimOut || "").indexOf(sname) < 0) hasCore = false }
  ok(hasCore, "D-4 瘦档含核心节（最新实况/当前目标）")
  const fullOut = tps(planRaw, null, 2000)
  ok(fullOut === null, "D-5 全文档（sections=null）-> 返回 null ⇒ 调用方走全文路径")
}

console.log("")
console.log("== E. semantic-recall（P3 第二件事）==")
const dcStart = idxSrc.indexOf("const DEFAULT_CONFIG = {")
let dcEnd = dcStart
if (dcStart >= 0) {
  let d = 0
  for (let i = idxSrc.indexOf("{", dcStart); i < idxSrc.length; i++) {
    const ch = idxSrc[i]
    if (ch === "{") d++
    else if (ch === "}") { d--; if (d === 0) { dcEnd = i; break } }
  }
}
const dcBody = dcStart >= 0 ? idxSrc.slice(dcStart + 1, dcEnd) : ""
ok(/^\s{2}fullInjectSemanticChars\s*:\s*800/m.test(dcBody), "E-1 配置键 fullInjectSemanticChars = 800")
ok(idxSrc.indexOf("semantic-recall") >= 0, "E-2 源码含 semantic-recall 段名")
const GUIDE = "以下是自动机引擎检索到的相关情感、共同经历和用户喜好的相关内容，可做参考"
ok(idxSrc.indexOf(GUIDE) >= 0, "E-3 用户指定的引导语字面量存在")
ok(idxSrc.indexOf("长期关系记忆") >= 0, "E-4 段标题「长期关系记忆」存在")
// E-5/E-6 投递范围：只在「人声 / 压缩后 / 交接」三档投递
//   ★判据口径（实测修正）：不能用 idxSrc.indexOf("semantic-recall") —— 它第一次出现在
//     文件开头 INJECT_TIERS 的**注释里**（L1717），不是守卫处。正解：定位**守卫语句本身**。
const guardAnchor = "if (_tier === _T.HUMAN_FULL || _tier === _T.HUMAN_SLIM || _tier === _T.POST_COMPACT || _tier === _T.HANDOFF_CARRY) {"
const guardPos = idxSrc.indexOf(guardAnchor)
ok(guardPos >= 0, "E-5 semantic-recall 有档位守卫（字面量精确匹配）")
// 守卫之后 3000 字符内必须出现 semantic-recall 的 pushPart
const afterGuard = guardPos >= 0 ? idxSrc.slice(guardPos, guardPos + 3000) : ""
ok(afterGuard.indexOf('pushPart("otherDynamic", "semantic-recall"') >= 0 || afterGuard.indexOf("'semantic-recall'") >= 0, "E-6 守卫体内确实 push semantic-recall")
// 负路径：运行档（RUN_FULL/RUN_SLIM）不得进该守卫
ok(guardAnchor.indexOf("_T.RUN_FULL") < 0 && guardAnchor.indexOf("_T.RUN_SLIM") < 0, "E-7 运行档不在投递守卫内（负路径）")
// E-8 零字节纪律
ok(idxSrc.indexOf("if (_semParts.length)") >= 0, "E-8 空内容不 push（零字节纪律）")

console.log("")
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
process.exit(fail === 0 ? 0 : 1)
