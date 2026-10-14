#!/usr/bin/env node
/**
 * check-write-contract.mjs —— #332 吸收（2026-10-12）：主记忆写入的**开发期契约检查**。
 *
 * 报告人要吸收的第一项：为「写入结果」建立**静态契约**，让「未知写入被当成成功」与
 * 「正文已写但索引失败被当成完全没写」这两类错误在**开发期**就暴露。
 *
 * ★为什么不是 TypeScript 的 `checkJs`：本仓是 **zero-deps** 包（`package.json` 无 typescript，
 *   `tsc` 不在 PATH，本机实测 `node_modules/typescript` 不存在）⇒ 照搬 `checkJs` 会让这条检查
 *   **在本机根本跑不起来**，属于"写了但没验收"。改用**零依赖的结构解析检查**达到同目的：
 *   ① 断言写入器的**成功返回必须携带可区分字段**（`committed` / `indexStale` / `revision`）；
 *   ② 断言**失败返回必须携带 `error`**（不得返回空对象让调用方猜）；
 *   ③ 断言**消费端真的读了这些字段**（生产者有、消费者不看 = 契约断裂）；
 *   ④ 内置**反向对照**：把契约打坏后本检查必须报红（证明检查本身有鉴别力）。
 *
 * 只读源码、零副作用、不进运行时；可单独跑，也由 smoke 套件 `smoke-test-i332-write-contract.mjs` 覆盖。
 * 纪律：本文件是**开发期检查**，不属于运行时路径。
 */
import { readFileSync } from 'node:fs'
import pathModule from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = pathModule.join(pathModule.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_PATH = pathModule.join(ROOT, 'lib', 'index.js')
const SRC = readFileSync(SRC_PATH, 'utf8')

let fail = 0
const problems = []
const check = (c, name, detail) => { if (!c) { fail++; problems.push(name + (detail ? ' :: ' + detail : '')) } }
const show = process.argv.includes('--verbose')

/** 取一个方法的源码段（到下一个同级方法注释/定义为止）。 */
function methodBody(src, sig, endMarker) {
  const a = src.indexOf(sig)
  if (a < 0) return null
  const b = endMarker ? src.indexOf(endMarker, a) : -1
  return b > a ? src.slice(a, b) : src.slice(a, a + 8000)
}

// ── ① 写盘口：成功返回必须可区分「已提交 / 索引过时」──
const planBody = methodBody(SRC, '  async writePlanSnapshot(projectDir, content, opts) {', '  /** P0 写入保护统一入口')
check(!!planBody, '① 定位到 writePlanSnapshot')
if (planBody) {
  const okReturn = planBody.match(/return \{ ok: true[^}]*\}/)
  check(!!okReturn, '① 成功返回存在（ok: true）')
  check(/committed:\s*true/.test(planBody), '① 成功返回携带 committed（正文提交与否可区分）')
  check(/indexStale/.test(planBody), '① 成功返回携带 indexStale（派生索引状态可区分）')
  check(/\brevision\b/.test(planBody), '① 成功返回携带 revision（正文版本身份可区分）')
  const failReturns = planBody.match(/return \{ ok: false[^}]*\}/g) || []
  check(failReturns.length > 0, '① 失败返回存在（ok: false）')
  check(failReturns.every((s) => /(?<![_$\w])error:/.test(s)), '① 每个失败返回都带 error（不得让调用方猜）', failReturns.join(' | ').slice(0, 120))
}

// ── ② 账本写盘口：成功/失败返回同样必须可区分 ──
const hbBody = methodBody(SRC, '  async writeHandoffLedger(projectDir, content, opts) {', '  /** P0 写入保护统一入口')
check(!!hbBody, '② 定位到 writeHandoffLedger')
if (hbBody) {
  check(/return \{ ok: true/.test(hbBody), '② 成功返回存在（ok: true）')
  check(/path:/.test(hbBody), '② 成功返回携带 path（落点可复算）')
  const hFails = hbBody.match(/return \{ ok: false[^}]*\}/g) || []
  check(hFails.every((s) => /(?<![_$\w])error:/.test(s)), '② 每个失败返回都带 error')
}

// ── ③ 消费端必须真的读取这些字段（否则契约是摆设）──
const branchA = SRC.indexOf("      const content = args.kind === 'plan' ? String(args.content || '')")
const branchB = SRC.indexOf("      const replace = args.action === 'replace'", branchA)
const branch = branchA > 0 && branchB > branchA ? SRC.slice(branchA, branchB) : ''
check(!!branch, '③ 定位到 memory_note 的 plan/handoff 分支')
check(/!r \|\| !r\.ok/.test(branch), '③ 消费端显式判 ok（未知结果不得当成功）')
check(/r\.indexStale/.test(branch), '③ 消费端读取 indexStale（正文/索引区分被真的用上）')
check(/r\.revision/.test(branch), '③ 消费端读取 revision')
check(/r\.path/.test(branch), '③ 消费端读取 path')
check(/r\.conflictPath/.test(branch), '③ 冲突路径被消费（可恢复指引）')

// ── ④ 反向对照：打坏契约后检查必须报红（内置，保证检查非恒真）──
{
  const brokenOk = SRC.replace(/committed: true/, 'committed: false');
  // 变异②：把所有「失败返回」的 error 字段改名 ⇒ 调用方再也拿不到失败原因（契约被打破）。
  const brokenFail = SRC.replace(/return \{ ok: false, error:/g, 'return { ok: false, _error:');
  const brokenConsumer = SRC.replace(/if \(!r \|\| !r\.ok\) \{/, 'if (false) {');
  check(brokenOk !== SRC, '④ 变异锚命中（committed）')
  check(brokenFail !== SRC, '④ 变异锚命中（失败 error）')
  check(brokenConsumer !== SRC, '④ 变异锚命中（消费端判 ok）')
  // 逐条重跑上面的判据，确认「打坏后必然失败」
  const reChecks = (src) => {
    const b = methodBody(src, '  async writePlanSnapshot(projectDir, content, opts) {', '  /** P0 写入保护统一入口')
    if (!b) return false
    if (!/committed:\s*true/.test(b)) return false
    const fs = b.match(/return \{ ok: false[^}]*\}/g) || []
    if (!fs.length || !fs.every((s) => /(?<![_$\w])error:/.test(s))) return false
    const a = src.indexOf("      const content = args.kind === 'plan' ? String(args.content || '')")
    const z = src.indexOf("      const replace = args.action === 'replace'", a)
    const br = z > a ? src.slice(a, z) : ''
    return /!r \|\| !r\.ok/.test(br) && /r\.indexStale/.test(br)
  };
  check(reChecks(SRC) === true, '④ 基准：原源码通过同一判据函数')
  check(reChecks(brokenOk) === false, '④ 变异①（committed 打坏）⇒ 判据必红')
  check(reChecks(brokenFail) === false, '④ 变异②（失败缺 error）⇒ 判据必红')
  check(reChecks(brokenConsumer) === false, '④ 变异③（消费端不判 ok）⇒ 判据必红')
}

// ── ⑤ 回归守卫：本仓不得引入 typescript 依赖（保持 zero-deps）──
const pkg = JSON.parse(readFileSync(pathModule.join(ROOT, 'package.json'), 'utf8'))
const allDeps = Object.assign({}, pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies)
check(!Object.keys(allDeps).some((k) => /typescript|^ts-/.test(k)), '⑤ 未引入 TypeScript 依赖（zero-deps 保持）', Object.keys(allDeps).join(','))

if (fail) {
  console.error('✗ 写入契约检查未通过: ' + fail + ' 项');
  for (const x of problems) console.error('  - ' + x);
  process.exit(1)
}
console.log('✓ 写入契约检查通过（' + pathModule.basename(SRC_PATH) + '）');
if (show) console.log('  · 契约: ok / committed / indexStale / revision / path / conflictPath 生产端与消费端均在场');
