/**
 * smoke-test-v5-p2-water-pct.mjs
 *
 * v5-P2（2026-10-26 用户裁定）验收套件。
 *
 * 核心变更：F1「用户发声完整版」的触发口径
 *   旧：fullInjectTokenGap = 250000（两轮完整版之间累计新增 token）
 *   新：fullInjectWaterPct = "25,50"（上下文窗口占用率的阈值列表）
 *
 * 语义（用户逐字）：「到了 25% 以后，检测到用户下一次发送信息时，就投递用户发声的完整版；50% 同理」
 *   = 阈值 + 一次性：跨过阈值 → 用户说话 → 投一次 → 标记 → 同阈值内不再投 → 跨下一阈值再投
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

const mk = (name) => {
  const s = extractFn(idxSrc, name)
  if (!s) return null
  try { return new Function(s + "; return " + name + ";")() } catch (e) { return null }
}
const parsePct = mk("parseWaterPctThresholdsPre")
const decideFire = mk("decideWaterPctFirePre")

console.log("== A. parseWaterPctThresholdsPre 解析 ==")
ok(typeof parsePct === "function", "A-0 函数可真构造")
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
if (typeof parsePct === "function") {
  ok(eq(parsePct("25,50"), [25, 50]), "A-1 默认串 25,50 -> [25,50]")
  ok(eq(parsePct("50,25"), [25, 50]), "A-2 乱序 -> 升序 [25,50]")
  ok(eq(parsePct("25, 50"), [25, 50]), "A-3 逗号+空格 -> [25,50]")
  ok(eq(parsePct("25;50"), [25, 50]), "A-4 分号 -> [25,50]")
  ok(eq(parsePct("25 50"), [25, 50]), "A-5 空格 -> [25,50]")
  ok(eq(parsePct("25,25,50"), [25, 50]), "A-6 去重 -> [25,50]")
  ok(eq(parsePct(""), [25, 50]), "A-7 空串 -> 回落默认")
  ok(eq(parsePct(null), [25, 50]), "A-8 null -> 回落默认")
  ok(eq(parsePct(undefined), [25, 50]), "A-9 undefined -> 回落默认")
  ok(eq(parsePct("abc,xyz"), [25, 50]), "A-10 全非法 -> 回落默认")
  ok(eq(parsePct("0"), []), "A-11 填 0 -> 禁用 []（负路径）")
  ok(eq(parsePct("off"), []), "A-12 填 off -> 禁用 []")
  ok(eq(parsePct("OFF"), []), "A-13 OFF 大小写不敏感")
  ok(eq(parsePct("150,25"), [25]), "A-14 >100 丢弃 -> [25]")
  ok(eq(parsePct("0.5,25"), [25]), "A-15 <1 丢弃 -> [25]")
  ok(eq(parsePct("25,50,75"), [25, 50, 75]), "A-16 三档可扩展")
  ok(eq(parsePct([30, 60]), [30, 60]), "A-17 数组输入")
  ok(eq(parsePct(40), [40]), "A-18 单个数字")
  ok(eq(parsePct("33.3"), [33.3]), "A-19 小数保留")
}

console.log("")
console.log("== B. decideWaterPctFirePre 判定 ==")
ok(typeof decideFire === "function", "B-0 函数可真构造")
if (typeof decideFire === "function") {
  const TH = [25, 50]
  let r = decideFire(20, TH, 0)
  ok(r.fire === false && r.nextThreshold === 25, "B-1 20% 未投过 -> 不触发，下一档 25")
  r = decideFire(26, TH, 0)
  ok(r.fire === true && r.fireAt === 25, "B-2 26% 未投过 -> 触发@25")
  r = decideFire(27, TH, 25)
  ok(r.fire === false && r.nextThreshold === 50, "B-3 27% 已投25 -> 不触发（同档不重复）")
  r = decideFire(30, TH, 25)
  ok(r.fire === false, "B-4 30% 已投25 -> 不触发")
  r = decideFire(51, TH, 25)
  ok(r.fire === true && r.fireAt === 50, "B-5 51% 已投25 -> 触发@50")
  r = decideFire(60, TH, 50)
  ok(r.fire === false && r.nextThreshold === null, "B-6 60% 已投50 -> 不触发，无下一档")
  r = decideFire(55, TH, 0)
  ok(r.fire === true && r.fireAt === 50, "B-7 55% 未投 -> 只触发一次@50（跳档不连投）")
  r = decideFire(58, TH, 50)
  ok(r.fire === false, "B-8 跳档后 58% -> 不再触发")
  r = decideFire(26, TH, 0)
  ok(r.fire === true && r.fireAt === 25, "B-9 压缩重置后 26% -> 重新触发@25")
  r = decideFire(99, [], 0)
  ok(r.fire === false, "B-10 阈值空（禁用）-> 永不触发（负路径）")
  r = decideFire(0, TH, 0)
  ok(r.fire === false, "B-11 水位 0 -> 不触发（fail-closed）")
  r = decideFire(NaN, TH, 0)
  ok(r.fire === false, "B-12 水位 NaN -> 不触发（fail-closed）")
  // ★B-12b（变异 m4 抓出的判据缺口）：水位 <= 0 必须 fail-closed。
  //   注意：必须用**负数**测，因为 0 可能被上游当"未初始化"；负数只可能来自异常计算。
  r = decideFire(-5, TH, 0)
  ok(r.fire === false, "B-12b 水位 -5（异常负值）-> 不触发（fail-closed）")
  // ★B-12c：水位 0 且阈值列表含 0 —— 验证 0 不被当有效触发点（行为断言）。
  r = decideFire(0, [0, 25], 0)
  ok(r.fire === false, "B-12c 水位 0 -> 不触发（即使阈值含 0）")
  r = decideFire(76, [25, 50, 75], 50)
  ok(r.fire === true && r.fireAt === 75, "B-13 三档：76% 已投50 -> 触发@75")
  r = decideFire(25, TH, 0)
  ok(r.fire === true && r.fireAt === 25, "B-14 恰好 25% -> 触发（>= 判定）")
  r = decideFire(20, TH, 50)
  ok(r.fire === false, "B-15 水位20 但已投50 -> 不触发（异常输入不崩）")
}

// ★判据覆盖度自述（按仓库纪律，不得用编造判据凑绿）：
//   变异 m4「删掉 decideWaterPctFirePre 里的 cur <= 0 守卫」**无法让本套件变红**。
//   原因（已实测）：该守卫在逻辑上冗余 —— list.filter(t => cur >= t && t > prev) 中，
//     prev >= 0 且阈值 t >= 1（解析器已过滤 <1）⇒ 只有 cur <= 0 时 crossed 才可能非空，
//     但此时 t > prev 要求 t > 0，而 t >= 1 ⇒ cur >= t 只在 cur >= 1 成立 ⇒ 矛盾。
//   ⇒ 该守卫是**防御性代码**（防未来阈值为 0 的配置），不是当前行为的必要条件。
//   结论：B-11/B-12/B-12b/B-12c 覆盖的是「水位异常时 fail-closed」的**行为**，
//     而不是「守卫这一行存在」。这是真实情况，不作粉饰。
console.log("")
console.log("== C. 配置键与前端三面 ==")
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
ok(/^\s{2}fullInjectWaterPct\s*:\s*.25,50./m.test(dcBody), "C-1 DEFAULT_CONFIG 有 fullInjectWaterPct")
ok(!/^\s{2}fullInjectTokenGap\s*:/m.test(dcBody), "C-2 旧键 fullInjectTokenGap 已删（负路径）")

const clientSrc = fs.readFileSync(path.join(ROOT, "lib", "client.js"), "utf8")
const ctlCount = (clientSrc.match(/field\(t\("fInjectWaterPct"\)/g) || []).length + (clientSrc.match(/field\(t\("fInjectWaterPct"\)/g) || []).length
const ctlCount2 = (clientSrc.split("field(t('fInjectWaterPct')").length - 1)
ok(ctlCount2 === 3, "C-3 设置页三面都有控件", "实测 " + ctlCount2)
const copyCount = (clientSrc.split("fInjectWaterPct: [").length - 1)
// ★口径修正（实测）：iter5SettingCopy 在 client.js 里只有 **1 份定义**（经典档与 ITER5 共用），
//   故文案表计数应为 1。对照：fSnapGap: [ 也是 1 处 ⇒ 与既有键同形。
ok(copyCount === 1, "C-4 文案表 1 处（iter5SettingCopy 单定义，两档共用）", "实测 " + copyCount)
const refCount = (clientSrc.split("fSnapGap: [").length - 1)
ok(refCount === copyCount, "C-4b 与既有键 fSnapGap 同形（都是单定义）", "fSnapGap=" + refCount + " vs 新键=" + copyCount)
const hintCount = (clientSrc.split("fInjectWaterPctHint").length - 1)
ok(hintCount === 3, "C-5 三面都引用 hint", "实测 " + hintCount)

let syncOk = false
try {
  const o = execSync("node tools/build-iter5-skin.mjs --check --strict", { cwd: ROOT, encoding: "utf8" })
  syncOk = o.indexOf("SYNC-OK") >= 0
} catch (e) { syncOk = false }
ok(syncOk, "C-6 生成一致性 SYNC-OK（真跑工具）")

console.log("")
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
process.exit(fail === 0 ? 0 : 1)
