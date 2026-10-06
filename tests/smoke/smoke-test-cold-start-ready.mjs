import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

// 冷启动就绪门（方案 A）负路径验收：
// 真执行决策段，断言「数据未就绪时不得冒充完整版、不得污染节流基准，且就绪后必须补完整版」。
// 判定口径：按**返回原文**判定（是不是原样返回了快照 / 是不是精简文本 / 是不是空串），
//           不按段落名——骨架快照本就不含「白板 PLAN.md」，用段落名会把两种情形混为一谈。
// 变异反向验证：去掉 snapNotReadyPre 门 ⇒ C1/C2/C5/C6 必红。
const SRC = readFileSync(process.env.DAM_INDEX_JS || "lib/index.js", "utf8")
const S0 = SRC.indexOf("let tieredFullGranted = false")
const END = "return snap + engine.renderReflectionRequest()"
const body = SRC.slice(S0, SRC.lastIndexOf(END) + END.length)
const NL = String.fromCharCode(10)
const LB = String.fromCharCode(91), RB = String.fromCharCode(93)
const RS = String.fromCharCode(92)

// 骨架快照：复刻实测的 2728 字节形态（缺规则段与日志段两个骨架锚）
const skeleton = [
  "<memory_system>",
  LB + "记忆定位 — 读法" + RB,
  LB + "来源身份 — 必须遵守" + RB + " 本块全部内容是既往记录。",
  "自动记忆已启用。工作区: D:" + RS + RS + "dsh-auto-memory",
  LB + "外部记忆 — 其他 AI 工具遗产" + RB,
  LB + "铭文 · 每轮提醒 2026-10-06" + RB,
  "</memory_system>",
].join(NL)
// 完整快照：含规则段与日志段两个骨架锚
const complete = [
  "<memory_system>",
  LB + "记忆定位 — 读法" + RB,
  LB + "规则 — 用户级硬性约束 · 必须遵守" + RB,
  "- 代码交付后不自动提交",
  LB + "记忆索引 — Tier-0 常驻目录" + RB,
  LB + "白板 PLAN.md" + RB,
  LB + "最近 1 天工作日志(尾部)" + RB,
  LB + "2026-10-06" + RB + " 日志正文",
  "</memory_system>",
].join(NL)
const SLIM = "<memory_system>SLIM</memory_system>"

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log("  ok - " + m) } else { fail++; console.log("  FAIL - " + m) } }

const mk = (opts) => {
  const st = { _slimStep: 0, _lastSlimCounted: 0, _slimCount: 0, _humanFullKey: undefined,
    _snapFp: undefined, _snapLogFp: "", _snapRound: 0, _snapLastRound: 0, _snapPendingSnap: null,
    _snapPendingLogFp: null, _snapCv: undefined,
    loadedAt: opts.loadedAt === undefined ? 0 : opts.loadedAt }
  const engine = {
    stateFor: () => st,
    runtimeFor: () => ({ contextVersion: 0 }),
    turnBoundaryKeyPre: () => opts.tk || "turn:1",
    humanTurnObservedPre: () => !!opts.isHuman,
    humanTurnSeqPre: () => (opts.isHuman ? 77 : null),
    renderReflectionRequest: () => "",
    config: Object.assign({ snapshotMinGapRounds: 5, snapshotTieredInject: true, fullEverySlims: 3,
      slimEveryRounds: 3, snapshotReinjectOnCompact: true }, opts.cfg || {}),
  }
  const F = new Function("engine", "agent", "gap", "snap", "slimText", "diag", "createHash", "parseGapRoundsPre", body + ";")
  const slimText = opts.slimText === undefined ? SLIM : opts.slimText
  const diags = []
  const run = (snap) => {
    const o = F(engine, {}, opts.gap === undefined ? 5 : opts.gap, snap, slimText,
      (m) => diags.push(m), createHash, (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d }) || ""
    return o
  }
  return { st, run, diags, slimText }
}
// 按返回原文判定
const isSlim = (o, slimText) => o === slimText
const isEmpty = (o) => o === ""

console.log("=== C1 未就绪（loadedAt=0）+ 骨架快照 ⇒ 必须精简，且不得写指纹 ===")
{
  const E = mk({ loadedAt: 0 })
  const o = E.run(skeleton)
  ok(isSlim(o, E.slimText), "未就绪首帧 ⇒ 精简版（实得 " + JSON.stringify(o.slice(0, 40)) + "）")
  ok(E.st._snapFp === undefined, "★关键：不得把骨架快照记进 _snapFp（否则污染节流基准）")
  ok(E.st._snapLogFp === "" || E.st._snapLogFp === undefined, "不得写 _snapLogFp")
  ok(E.diags.some((d) => d.includes("冷启动")), "留痕可观测（" + (E.diags[0] || "无") + "）")
  // 精确匹配放行分档的文案（"→ 完整版"）；冷启动文案里的「待下帧补完整版」不算放行
  ok(!E.diags.some((d) => d.includes("→ 完整版")), "不得留「放行完整版」痕迹（名实一致）")
}
console.log("")
console.log("=== C2 同会话下一帧就绪 + 完整快照 ⇒ 必须补完整版（复刻实测 turn17 场景）===")
{
  const E = mk({ loadedAt: 0 })
  E.run(skeleton)                       // 首帧：未就绪 ⇒ 精简
  E.st.loadedAt = Date.now()            // _doRefresh 完成
  const o = E.run(complete)             // 次帧：就绪
  ok(o === complete, "就绪后首帧必须给完整版原文（实得 " + JSON.stringify(o.slice(0, 40)) + "）")
  ok(E.diags.some((d) => d.includes("首次注入")), "且走的是「首次注入」分支（" + (E.diags[E.diags.length - 1] || "") + "）")
  ok(E.st._snapFp === complete, "此时才登记 _snapFp")
}
console.log("")
console.log("=== C3 负路径：已就绪但快照本身缺锚（空记忆安装）⇒ 不得误伤 ===")
{
  const E = mk({ loadedAt: Date.now() })
  const o = E.run(skeleton)
  // ★2026-10-06（INJ-1）：本用例走「首次注入」分支（st._snapFp === undefined），该分支本就给完整版，
  //   与 S1/S3 的「未获授路径收口」无关 ⇒ 原样返回快照这条断言保持不变（不得误伤首轮足量上下文）。
  ok(o === skeleton, "loadedAt 已就绪 ⇒ 不抑制，原样返回快照（实得 " + JSON.stringify(o.slice(0, 40)) + "）")
  ok(!E.diags.some((d) => d.includes("冷启动")), "不得误报冷启动")
  ok(E.diags.some((d) => d.includes("首次注入")), "确为首次注入分支（非未获授路径）")
}
console.log("")
console.log("=== C4 负路径：未就绪但 slimText 为空（snapshotTieredInject=false）⇒ 不得吞掉注入 ===")
{
  const E = mk({ loadedAt: 0, slimText: "", cfg: { snapshotTieredInject: false } })
  const o = E.run(skeleton)
  ok(!isEmpty(o), "不得返回空串（实得 " + JSON.stringify(o.slice(0, 40)) + "）")
}
console.log("")
console.log("=== C5 真人轮 + 未就绪 ⇒ 仍走精简（不得因真人旁路放行骨架）===")
{
  const E = mk({ loadedAt: 0, isHuman: true })
  const o = E.run(skeleton)
  ok(isSlim(o, E.slimText), "真人在场也不放行未就绪骨架（实得 " + JSON.stringify(o.slice(0, 40)) + "）")
  ok(E.st._snapFp === undefined, "真人轮同样不得写指纹")
}
console.log("")
console.log("=== C6 未就绪多帧连续 ⇒ 每帧精简且始终不写指纹（防抖）===")
{
  const E = mk({ loadedAt: 0 })
  const a = E.run(skeleton), b = E.run(skeleton)
  ok(isSlim(a, E.slimText) && isSlim(b, E.slimText), "连续两帧均精简")
  ok(E.st._snapFp === undefined, "连续两帧后仍未写指纹")
}
console.log("")
console.log("=== C7 逐字节一致契约：同一步两次调用返回相同文本 ===")
{
  const E = mk({ loadedAt: 0 })
  const a = E.run(skeleton), b = E.run(skeleton)
  ok(a === b, "同一状态下两次调用逐字节相同")
}
console.log("")
console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
