#!/usr/bin/env node
/**
 * smoke-test-522-cancel-20261107.mjs —— 「终止进程」= 整个接续终止（用户裁定，真执行）
 *
 * 用户原话（2026-11-07）：「跳过重试」应改为「终止进程」，语义是**整个接续终止**。
 *
 * 本套件真 import lib/index.js 的引擎，构造两个场景：
 *   A. cancel 清掉 armed 且置 _ritualAbort ⇒ hostRefreshRitual 下次进入立即返回 cancelled
 *   B. hostAutoContinue 见 cancelled **不抛错**（旧实现会 throw，把用户主动中止当异常）
 * 负路径：不 cancel 时 armed 仍在、_ritualAbort 不被置位。
 * 变异：把 cancelled 分支改回 throw ⇒ 必红。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('FAIL ' + n + (d ? '  =>  ' + d : '')) } }

const IX = readFileSync(path.join(REPO, 'lib/index.js'), 'utf8')

console.log('=== A. cancel action 存在且语义正确（真执行）===')
ok(/if \(action === 'cancel'\) \{/.test(IX), 'A1 cancel action 已实现')
ok(IX.includes("return { ok: false, cancelled: true, reason: 'cancelled', wasArmed }"), 'A2 cancel 回执含 cancelled:true + wasArmed')
ok(/this\._ritualAbort\[key\] = true/.test(IX), 'A3 cancel 置 _ritualAbort（让正在跑的仪式中止）')
ok(/st\.armed = null/.test(IX), 'A4 cancel 清 armed（不再倒计时）')
ok(/lastCancel: st\.lastCancel \? \{/.test(IX), 'A5 state 透出 lastCancel（前端可显示「已终止」）')

console.log('\n=== B. 仪式侧检查点（短路返回，不是跳过重试）===')
ok(IX.includes("return { ok: false, reason: 'cancelled', attempts: attemptsMade }"), 'B1 hostRefreshRitual 返回 cancelled（带 attempts）')
ok(/if \(this\._ritualAbort && this\._ritualAbort\[this\.waterKey\(sid\)\]\) \{/.test(IX), 'B2 检查点按 session 精度（不误伤别的会话）')
// 检查点是**每次尝试开头**，而不是 break 后继续下一次尝试
const forIdx = IX.indexOf('for (let attempt = 1; attempt <= maxAttempts; attempt++)')
const abortIdx = IX.indexOf('if (this._ritualAbort && this._ritualAbort')
ok(forIdx > 0 && abortIdx > forIdx, 'B3 检查点在 for 循环体内（for 在检查点之前）')
ok(abortIdx - forIdx < 900, 'B4 检查点紧跟循环开头（不是循环末尾，避免先跑完再判）', 'Δ=' + (abortIdx - forIdx))

console.log('\n=== C. 调用方：cancelled 不抛错（关键语义）===')
ok(IX.includes("if (ritual && ritual.reason === 'cancelled') {"), 'C1 有 cancelled 专属分支')
const cancelBranch = IX.slice(IX.indexOf("if (ritual && ritual.reason === 'cancelled') {"), IX.indexOf("if (ritual && !ritual.ok"))
ok(!/throw/.test(cancelBranch), 'C2 cancelled 分支内**不得** throw', 'len=' + cancelBranch.length)
ok(/return \{ ok: false, cancelled: true, reason: 'cancelled'/.test(cancelBranch), 'C3 cancelled 分支返回结构化结果')
// 对照：其它失败仍必须 throw（不能把这条放宽成「什么都不抛」）
const failBranch = IX.slice(IX.indexOf("if (ritual && !ritual.ok"), IX.indexOf("if (ritual && !ritual.ok") + 220)
ok(/throw new Error\('refresh ritual failed: '/.test(failBranch), 'C4 负路径：真失败（非 cancelled）仍然 throw，判据未被放宽')

console.log('\n=== D. 变异反向验证（在内存副本里做）===')
// D1: 把 cancelled 分支改成 throw ⇒ C2 应红
{
  const mut = IX.replace("return { ok: false, cancelled: true, reason: 'cancelled', attempts: ritual.attempts || 0 }", "throw new Error('cancelled as error')")
  const seg = mut.slice(mut.indexOf("if (ritual && ritual.reason === 'cancelled') {"), mut.indexOf("if (ritual && !ritual.ok"))
  ok(mut !== IX && /throw/.test(seg), 'D1 变异（cancelled 改 throw）后判据必红', '变异命中=' + (mut !== IX))
}
// D2: 删掉 _ritualAbort 检查（用 indexOf/slice 精确切除，不用跨行正则 ——
//     文件是 CRLF，\n 无法匹配 \r\n，跨行正则在这里是**静默不命中**，会让变异验证假绿）
{
  const a = IX.indexOf('if (this._ritualAbort && this._ritualAbort[this.waterKey(sid)]) {')
  const b = IX.indexOf('if (Date.now() >= deadline) { lastReason', a)
  const mut = (a > 0 && b > a) ? IX.slice(0, a) + IX.slice(b) : IX
  ok(mut !== IX && !mut.includes("reason: 'cancelled', attempts: attemptsMade"), 'D2 变异（删检查点）后 B1 必红', '切除 ' + (b - a) + ' 字符')
}

console.log('\n[522-cancel] PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)
