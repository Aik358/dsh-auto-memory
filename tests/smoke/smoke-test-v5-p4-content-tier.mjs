/**
 * smoke-test-v5-p4-content-tier.mjs
 *
 * v5-P4（2026-10-26）验收套件：**内容档位化的收尾三项**。
 *   A 规则段档位化（F4 只给标题+摘要+条数）
 *   B 画像段档位化（运行档/LEGACY 不投）
 *   C F7 挂机代位补偿（纯函数判定）
 *   D 端到端：真跑 renderRulesSlimPre + 真实规则文本
 *   E 接线守卫（档位判定含 F7、守卫齐全）
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = 'D:/dsh-auto-memory'
let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const idxSrc = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

// 抽取模块级常量块（从 INJECT_TIERS 到 parseWaterPctThresholdsPre）
const blockStart = idxSrc.indexOf("const INJECT_TIERS = {")
const blockEnd = idxSrc.indexOf("const parseWaterPctThresholdsPre")
if (blockStart < 0 || blockEnd < 0) { console.error("模块级块抽取失败"); process.exit(2) }
const tierBlock = idxSrc.slice(blockStart, blockEnd)
let T = null
try {
  T = new Function(tierBlock + "; return { INJECT_TIERS, decideInjectTierPre, planSpecForTierPre, isHumanTierPre, isPlanFullTierPre, shouldInjectPlanPre, isRulesFullTierPre, PLAN_CORE_SECTIONS, renderRulesSlimPre, decideHangCompensatePre };")()
} catch (e) { console.error("模块级块执行失败: " + e.message); process.exit(2) }
const I = T.INJECT_TIERS

console.log("== A. 规则段档位化 ==")
const R = T.renderRulesSlimPre
ok(typeof R === "function", "A-0 renderRulesSlimPre 可真构造")
const sampleLayer = {
  rules: [
    { id: "r1", text: "发布类动作必须等用户明确指令。不得自行提交。" },
    { id: "r2", text: "修改计数锁时必须全仓检索所有出现点；否则校验器全绿仍属假绿。" },
    { id: "r3", text: "长耗时回归须先给出执行提示再启动" },
  ],
}
const slim = R(sampleLayer, { title: "[规则 — 精简版]", guide: "摘要如下", maxPerRule: 60 })
ok(slim && slim.text.length > 0, "A-1 精简渲染产出非空")
ok(slim.count === 3, "A-2 条数正确", "实测 " + slim.count)
ok(slim.text.indexOf("共 3 条") >= 0, "A-3 含总条数标注（模型知道有多少条）")
ok(slim.text.indexOf("r1") < 0, "A-4 不含内部 id（负路径）")
ok(slim.text.length < JSON.stringify(sampleLayer).length + 200, "A-5 显著短于全文", slim.text.length + " 字符")
// A-6 每条取首句
ok(slim.text.indexOf("发布类动作必须等用户明确指令") >= 0, "A-6 取首句（到句号）")
ok(slim.text.indexOf("不得自行提交") < 0, "A-7 句号后的内容被截掉（负路径）")
// A-8 空规则层
const slimEmpty = R({ rules: [] }, {})
ok(slimEmpty.text === "" && slimEmpty.count === 0, "A-8 空规则 => 空串（零字节）")
const slimNull = R(null, {})
ok(slimNull.text === "" && slimNull.count === 0, "A-9 null => 空串（不崩）")
// A-10 长规则被截
const longTxt = "甲".repeat(200)
const slimLong = R({ rules: [{ text: longTxt }] }, { maxPerRule: 60 })
ok(slimLong.text.indexOf("甲".repeat(61)) < 0, "A-10 超长规则被夹到 maxPerRule")
// A-11 谓词一致性
ok(T.isRulesFullTierPre(I.RUN_SLIM) === false, "A-11 F4 规则不全给")
ok(T.isRulesFullTierPre(I.RUN_FULL) === true, "A-12 F3 规则给全文")
ok(T.isRulesFullTierPre(I.LEGACY) === true, "A-13 LEGACY 给全文（= 改前行为）")
// ★A-14（变异 m1 抓出的判据缺口）：**接线**必须真的按档位分叉 —— 只测纯函数测不到接线。
//   变异「把 if (_tier === _T.RUN_SLIM && ...) 改成 if (false && ...)」时，若只测纯函数则恒绿。
const wireAnchor = "if (_tier === _T.RUN_SLIM && rulesSection.text && typeof renderRulesSlimPre === \"function\")"
ok(idxSrc.indexOf(wireAnchor) >= 0, "A-14 规则段接线按档位分叉（F4 才走精简）")
ok(idxSrc.indexOf("pushPart(\"rules\", \"rules-section\", _rulesOut)") >= 0, "A-15 统一出口 pushPart(_rulesOut)")

console.log("")
console.log("== B. 画像段档位化 ==")
// 画像守卫的**最终写法**（受 H5 套件四条判据约束，见 lib/index.js 注释）：
//   守卫字样逐字保持 `if (s.userPortraitText) pushPart(`，
//   档位判断放在**文本实参**里（不该投的档传空串 ⇒ pushPart 内部零字节跳过）。
// ★必须排除**注释行**：源码里有一条注释也含 `if (s.userPortraitText) pushPart(` 字样，
//   只用 indexOf 会先命中注释 ⇒ B-1~B-6 全部测的是注释而不是代码（实测踩过）。
const portraitLine = (idxSrc.split(/\r?\n/).find((l) => l.indexOf("if (s.userPortraitText) pushPart") >= 0 && l.trim().startsWith("if ("))) || ""
ok(portraitLine.length > 0, "B-1 画像守卫行存在（字面量形式）")
const indentLen = (portraitLine.match(/^[ \t]*/) || [""])[0].length
ok(indentLen === 4, "B-2 缩进恰 4 空格且在顶层（H5 E3）", "缩进=" + indentLen)
ok(idxSrc.indexOf("const _portraitOk = !(") >= 0, "B-3 有档位判断变量（在守卫行前一行）")
ok(idxSrc.indexOf("_tier === _T.LEGACY || _tier === _T.RUN_FULL || _tier === _T.RUN_SLIM") >= 0, "B-4 LEGACY/运行两档都跳过（= 改前行为不投画像）")
// B-5：不该投时传空串（三元第二个分支为空串字面量）
const pCtx = portraitLine
// B-5：不该投时传空串（三元第二个分支为空串字面量）—— 直接从**真实代码行**取上下文，
//   不能用 idxSrc.indexOf("if (s.userPortraitText) pushPart")：它先命中的是**注释里的示例文本**。
const SQc = String.fromCharCode(39)
const isEmptyLit = pCtx.indexOf("_portraitOk ?") >= 0 && pCtx.indexOf(" : " + SQc + SQc) >= 0
ok(isEmptyLit, "B-5 用三元传空串（靠 pushPart 内部零字节跳过）")
ok(portraitLine.indexOf("&&") < 0, "B-6 守卫条件只有 s.userPortraitText（H5 E4）")
// B-7 真跑 H5 套件（跨套件口径一致性）
let h5ok = false
try {
  const o = execSync("node tests/smoke/smoke-test-v4-h5-user-portrait.mjs", { cwd: ROOT, encoding: "utf8" })
  h5ok = o.indexOf("0 FAIL") >= 0 || o.indexOf("FAIL 0") >= 0
} catch (e) { h5ok = false }
ok(h5ok, "B-7 真跑 H5 套件全绿（跨套件口径一致）")

console.log("== C. F7 挂机代位补偿 ==")
const H = T.decideHangCompensatePre
ok(typeof H === "function", "C-0 decideHangCompensatePre 可真构造")
let h = H(0, 300000, true)
ok(h.fire === false && h.nextAccum === 0, "C-1 累计 0 => 不触发")
h = H(100000, 300000, true)
ok(h.fire === false && h.nextAccum === 100000, "C-2 未达阈值 => 不触发且累计保留")
h = H(300000, 300000, true)
ok(h.fire === true && h.nextAccum === 0, "C-3 恰好达阈值 => 触发并清零")
h = H(400000, 300000, true)
ok(h.fire === true && h.nextAccum === 0, "C-4 超阈值 => 触发并清零")
h = H(999999, 300000, false)
ok(h.fire === false, "C-5 开关关 => 永不触发（负路径，默认就是 false）")
h = H(-100, 300000, true)
ok(h.fire === false, "C-6 负累计 => 不触发（fail-closed）")
h = H(NaN, 300000, true)
ok(h.fire === false, "C-7 NaN => 不触发（fail-closed）")
h = H(300000, 0, true)
ok(h.fire === true, "C-8 阈值 0 => 回落默认 300000（300000 恰好触发）")
h = H(1000, 0, true)
ok(h.fire === false, "C-9 阈值 0 且累计很小 => 不触发（证明回落生效）")

console.log("")
console.log("== D. 端到端：真跑 renderRulesSlimPre + 真实用户级记忆 ==")
const USER = 'C:/Users/JH Z/.dsh/memory/MEMORY.md'
let userRaw = ""
try { userRaw = fs.readFileSync(USER, "utf8") } catch (e) { userRaw = "" }
ok(userRaw.length > 0, "D-1 真实用户级记忆可读", userRaw.length + " 字符")
if (userRaw.length > 0) {
  // 从真实文本抽「- 」开头的条目当作规则
  const realRules = userRaw.split(/\r?\n/).filter((l) => l.trim().indexOf("- ") === 0).slice(0, 20).map((l, i) => ({ id: "ur" + i, text: l.trim().slice(2) }))
  ok(realRules.length > 0, "D-2 从真实记忆抽出规则条目", realRules.length + " 条")
  const realSlim = R({ rules: realRules }, { title: "[规则 — 精简版]", maxPerRule: 60 })
  const fullLen = realRules.reduce((a, r) => a + r.text.length, 0)
  ok(realSlim.text.length > 0, "D-3 真实规则精简产出非空")
  ok(realSlim.text.length < fullLen, "D-4 精简确实更短", realSlim.text.length + " < " + fullLen)
  const ratio = (100 * realSlim.text.length / fullLen).toFixed(1)
  console.log("       实际压缩比: " + ratio + "%（" + realSlim.text.length + " / " + fullLen + "）")
}

console.log("")
console.log("== E. 接线守卫 ==")
// E-1 F7 档位判定已接进外层
ok(idxSrc.indexOf("INJECT_TIERS.HANG_COMPENSATE") >= 0, "E-1 外层档位判定含 F7")
ok(idxSrc.indexOf("hangCompensateEnabled === true") >= 0, "E-2 F7 开关已接线")
ok(idxSrc.indexOf("_hangFire.fire") >= 0, "E-3 F7 授予分支存在")
ok(idxSrc.indexOf("_hangAccumTokens = 0") >= 0, "E-4 F7 触发后清零累计")
// E-5 规则段精简有 typeof 守卫（抽取式测试保护）
ok(idxSrc.indexOf("typeof renderRulesSlimPre") >= 0, "E-5 renderRulesSlimPre 有 typeof 守卫")
// E-6 渲染层仍内联 _T（P3 教训）
ok(idxSrc.indexOf("const _T = {") >= 0, "E-6 渲染层仍内联 _T（P3 教训保持）")
// E-7 F7 与 F1 条件互斥
ok(idxSrc.indexOf("_hangOn && _hangUnattended && !isHuman") >= 0, "E-7 F7 要求挂机且非真人（与 F1 互斥）")
ok(idxSrc.indexOf("_waterFire.fire && isHuman") >= 0, "E-8 F1 要求真人（互斥的另一半）")

console.log("")
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
process.exit(fail === 0 ? 0 : 1)
