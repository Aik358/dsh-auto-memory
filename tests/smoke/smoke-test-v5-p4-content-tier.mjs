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
// ★2026-10-28 判据更新（设计纲要 2026-10-27）：run_full 不投规则全文。
ok(T.isRulesFullTierPre(I.RUN_SLIM) === false, "A-11 运行精简档规则不全给（负路径）")
ok(T.isRulesFullTierPre(I.RUN_FULL) === false, "A-12 ★运行完整档规则也不全给（纲要 2026-10-27）")
ok(T.isRulesFullTierPre(I.HUMAN_FULL) === true, "A-12b 人声全量档给规则全文（正路径）")
ok(T.isRulesFullTierPre(I.LEGACY) === true, "A-13 LEGACY 给全文（= 改前行为）")
// ★★A-14（2026-10-27 **判据升级**，原为静态锚点断言）：
//   原判据：源码必须含 `if (_tier === _T.RUN_SLIM && ... typeof renderRulesSlimPre === "function")`。
//   问题：那个 typeof 守卫**本身就是缺陷**（模块级 const 在抽取执行时恒 undefined ⇒ 条件恒假
//         ⇒ 规则摘要从未生效）。10-27 已改为内联实现 ⇒ 旧锚点必然消失。
//   ⇒ 判据从「源码含某字符串」（恒真守卫）升级为「**真跑渲染、比字节**」：
//        F4(run_slim) 的 rules 段必须 < 完整档的 rules 段。
//   这才是 A-14 原本想表达的东西（「接线必须真的分叉」）—— 静态锚点只能证明"写了 if"，
//   证明不了"if 真的进了"。
{
  // 真引擎：动态 import（本套件主体是静态断言，此处单独引入真引擎做功能验收）
  const { MemoryEngine: _ME } = await import('../../tests/lib/audit-engine.mjs')
  const _probeEng = new _ME()
  await _probeEng.refresh(undefined)
  const _st = _probeEng.stateFor ? _probeEng.stateFor(undefined) : _probeEng.state
  const _rulesCharsOf = (tier) => {
    _st._injectTierPre = tier
    _st.memLegacy = { legacy: false, reasons: [], counts: {} }
    _st.envelopeMeta = null
    _probeEng.renderMemoryDynamic({ agent: undefined })
    const mm = _st.envelopeMeta || {}
    let n = 0
    for (const sg of (mm.segments || [])) if (sg.kind === "rules-section") n = sg.chars
    return n
  }
  const _full = _rulesCharsOf("human_full")
  const _slim = _rulesCharsOf("run_slim")
  ok(_full > 0, "A-14a 完整档规则段有内容（真跑渲染）", _full + "B")
  ok(_slim > 0, "A-14b ★F4 规则段有内容（真跑渲染；修前是 0 或全文）", _slim + "B")
  ok(_slim < _full, "A-14c ★★接线真的分叉：F4 规则摘要 < 全文（修前 8397 == 8397）", _slim + " < " + _full)
}
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
// ★★2026-10-28 判据更新（P2-5 修复）：画像档位判据从**负向列举**改为**正向列举**。
//   旧：!(LEGACY || RUN_FULL || RUN_SLIM)  ⇒ 漏了 HANG_COMPENSATE（实测多投 480 字符画像）
//   新：(HUMAN_FULL || HUMAN_SLIM || POST_COMPACT || HANDOFF_CARRY)
//       —— 与同函数 semantic-recall 段**同一张名单**（一次改全，杜绝再漏）。
//   判据意图不变：运行档/legacy 不投画像；只是把「哪些档投」写成正向，避免新增档位再漏。
ok(idxSrc.indexOf("const _portraitOk = (") >= 0, "B-3 有档位判断变量（正向名单）")
ok(idxSrc.indexOf("_tier === _T.HUMAN_FULL || _tier === _T.HUMAN_SLIM") >= 0, "B-4 人声档/压缩后/交接档才投画像（正向列举）")
ok(idxSrc.indexOf("|| _tier === _T.POST_COMPACT || _tier === _T.HANDOFF_CARRY)") >= 0, "B-4b 名单含 POST_COMPACT + HANDOFF_CARRY")
ok(idxSrc.indexOf("const _portraitOk = !(") < 0, "B-4c ★负向列举已消失（防回退，P2-5）")
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
