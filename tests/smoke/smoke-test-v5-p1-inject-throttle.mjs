/**
 * smoke-test-v5-p1-inject-throttle.mjs
 *
 * ★v5-P1（2026-10-26 记忆拟合裁定）验收套件。
 * 决定文档：artifacts/INJECTION-THROTTLE-DECISION-2026-10-26.md
 *
 * A = T1 设置页文案（三语）与常量一致
 * B = T2 六个新配置键 + T4 附加键
 * C = T3 计数锁
 * D = T4 白板按节投递（真调函数）
 * E = T5 白板节名命中优先词【守卫，非功能验收】
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
const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

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

console.log("== A. T1 设置页文案（三语）==")
ok(clientSrc.indexOf("用来防止长任务里模型对上下文漂移。默认 20。") >= 0, "A-1 中文写「默认 20」")
ok(clientSrc.indexOf("drifting in long tasks. Default 20.") >= 0, "A-2 英文写「Default 20」")
ok(clientSrc.indexOf("文脈ドリフトを防ぎます。既定 20。") >= 0, "A-3 日文写「既定 20」")
ok(clientSrc.indexOf("防止长任务里模型对上下文漂移。默认 10。") < 0, "A-4 中文旧值已清（负路径）")
ok(clientSrc.indexOf("drifting in long tasks. Default 10.") < 0, "A-5 英文旧值已清（负路径）")
const mConst = idxSrc.match(/DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS\s*=\s*(\d+)/)
ok(mConst && Number(mConst[1]) === 20, "A-6 常量 === 20", mConst ? mConst[1] : "null")

console.log("")
console.log("== B. T2 新配置键 ==")
// ★口径必须与 verify-docs 一致：**大括号配平取 body**，不能按 "\n};" 截断
//   （后者会把嵌套对象里的键也算进去 ⇒ 本轮实测 206 vs 真实 173，判据假红）
const dcMatch = idxSrc.match(/DEFAULT_CONFIG\s*=\s*\{/)
let dcStart = dcMatch ? idxSrc.indexOf("{", dcMatch.index) : -1
let dcEnd = dcStart
if (dcStart >= 0) {
  let d = 0
  for (let i = dcStart; i < idxSrc.length; i++) {
    const ch = idxSrc[i]
    if (ch === "{") d++
    else if (ch === "}") { d--; if (d === 0) { dcEnd = i; break } }
  }
}
const dcBody = dcStart >= 0 ? idxSrc.slice(dcStart + 1, dcEnd) : ""
const dc = dcBody
const want = [
  // ★v5-P2（2026-10-26 用户裁定）判据更新：fullInjectTokenGap 已被 fullInjectWaterPct 取代。
  //   原因：用户认为「累计 250k token」太死板，且 250k 在不同窗口大小下语义漂移
  //   （1M 窗口是 25%，128k 窗口是 195%）⇒ 改为直接按水位百分比判定（默认 "25,50"）。
  //   本行原为 ["fullInjectTokenGap", "250000"]，现改为新键（判据意图不变：F1 触发配置存在且可用）。
  ["fullInjectWaterPct", "'25,50'"],
  ["slimCheckpointCount", "3"],
  ["hangCompensateTokens", "300000"],
  ["fullInjectOnCompact", "true"],
  ["fullInjectSlimBudgetChars", "3000"],
  ["hangCompensateEnabled", "false"],
  ["handoffPlanSections", "null"],
  ["handoffPlanSectionMax", "2000"],
]
for (const pair of want) {
  const key = pair[0]
  const val = pair[1]
  const esc = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp("^\\s{2}" + key + "\\s*:\\s*" + esc + "\\s*,", "m")
  ok(re.test(dc), "B-1 " + key + " = " + val)
}

console.log("")
console.log("== C. T3 计数锁 ==")
const keys = [...dc.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)].map((x) => x[1])
ok(keys.length >= 170, "C-1 键数 >= 170", "实测 " + keys.length)
const wp = fs.readFileSync(path.join(ROOT, "docs", "WHITEPAPER.md"), "utf8")
const mWp = wp.match(/\| 设置键 \| \*\*(\d+)\*\* \|/)
ok(mWp && Number(mWp[1]) === keys.length, "C-2 白皮书 = 代码实测", (mWp ? mWp[1] : "null") + " vs " + keys.length)

console.log("")
console.log("== D. T4 白板按节投递（真调）==")
const fnSrc = extractFn(idxSrc, "truncatePlanBySections")
ok(!!fnSrc, "D-0 抽取成功")
let fn = null
if (fnSrc) {
  try { fn = new Function(fnSrc + "; return truncatePlanBySections;")() } catch (e) { fn = null }
}
ok(typeof fn === "function", "D-1 可真构造并调用")
if (typeof fn === "function") {
  const sample = ["# 标题", "", "## 这是什么", "正文A", "## 当前目标", "正文B", "## E 批前端", "正文C"].join("\n")
  const r2 = fn(sample, ["这是什么", "当前目标"], 2000)
  ok(r2 !== null && r2.indexOf("正文A") >= 0 && r2.indexOf("正文B") >= 0, "D-2 命中 2 节")
  ok(r2 !== null && r2.indexOf("正文C") < 0, "D-3 未命中节被排除", r2 ? "len=" + r2.length : "null")
  ok(fn(sample, ["不存在xyz"], 2000) === "", "D-4 命中 0 节 => 空串（负路径）")
  ok(fn(sample, null, 2000) === null, "D-5 null => null（向后兼容）")
  ok(fn(sample, [], 2000) === null, "D-6 空数组 => null")
  const big = "## 目标\n" + "x".repeat(500)
  const r4 = fn(big, ["目标"], 100)
  ok(r4 !== null && r4.indexOf("本节超长已截断") >= 0, "D-7 超长 => 截断标记")
  ok(fn("", ["目标"], 2000) === "", "D-8 空文本 => 空串")
  ok(fn("只有正文", ["目标"], 2000) === "", "D-9 无 ## 节 => 空串（fail-closed）")
  ok(fn("## Current Goal\nbody", ["current goal"], 2000) !== "", "D-10 大小写不敏感")
  ok(typeof r2 === "string" && r2.length > 0, "D-11 元断言：确实返回非空（非仅构造）")
}

console.log("")
console.log("== E. T5 节名命中优先词【守卫】==")
const PLAN = "C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/PLAN.md"
let plan = ""
try { plan = fs.readFileSync(PLAN, "utf8") } catch (e) { plan = "" }
const PRIO_RE = /(目标|待办|下一步|硬约束|当前|进度|待用户|裁决|风险)/
const titles = plan.split("\n").filter((l) => l.startsWith("## "))
const hit = titles.filter((t) => PRIO_RE.test(t))
ok(titles.length > 0, "E-1 白板有 ## 节", "共 " + titles.length)
ok(hit.length >= 3, "E-2 >=3 节命中优先词", "实测 " + hit.length)
const latestTitle = titles.find((t) => t.indexOf("最新实况") >= 0) || ""
ok(!!latestTitle, "E-3 含「最新实况」节", latestTitle.slice(0, 50))
ok(PRIO_RE.test(latestTitle), "E-4 该节命中优先词", latestTitle.slice(0, 40))

console.log("")
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
process.exit(fail === 0 ? 0 : 1)
