#!/usr/bin/env node
/**
 * [generator-idempotent] 生成器幂等性 + R2 负路径（G0-4，2026-10-02 恢复）。
 *
 * ★由来：原「生成器幂等」fixture 在病根 3 事故期被移除，注释留在
 *   tests/smoke/smoke-test-iter5-skin.mjs:396-407（"待生成器改正则配对后由维护者按需恢复"）。
 *   恢复判据（原文）：「生成器能在当前 client.js 上幂等重跑，且 --check 通过」。
 *   2026-10-02 实测满足：--check 绿（SYNC-OK）；生成器在同一文件上真实重跑逐字节不变。
 *
 * ★本套件做什么（真跑生成器，不是读注释）：
 *   ① H0 = sha256(lib/client.js) → 无 flag 真实重跑一次 → H1，断言 H1 === H0（真实重建是 no-op）；
 *   ② 重跑后 --check 仍绿（R1：同步即通过）；
 *   ③ R2-b 负路径：注入一行"只在磁盘上"的探针 → 默认模式必须 exit 2 且探针存活、文件未被改写；
 *   ④ R2-b 逃生门：同一探针下 --force 必须真写盘（探针被覆盖）——证明 --force 不是空话。
 *
 * ★备份/恢复纪律：照抄 smoke-test-generator-guard.mjs ④ 段的既有先例（backup + finally 还原）。
 *   全程 finally 还原，即使断言失败也不会把探针留在产物里。
 * ★并发纪律（2026-10-02 补，实测踩到）：run-smoke 默认 --jobs=4，而本套件要**真跑生成器**
 *   （会写 lib/client.js）。故全部真跑改在 os.tmpdir() 的**临时仓库副本**里做（lib/+skins/+tools
 *   整份复制）；真仓库只留只读断言（H0 与 --check 绿）。原实现直接写真仓库，曾造成并发读者
 *   读到半写文件 ⇒ 偶发假红 252/1（单独重跑三次全绿）。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, copyFileSync, rmSync, cpSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const GEN = path.join(ROOT, 'tools', 'build-iter5-skin.mjs')
const CLIENT = path.join(ROOT, 'lib', 'client.js')
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok -', m) } else { fail++; console.error('  FAIL -', m) } }

// ★并发纪律（2026-10-02 补，实测踩到）：run-smoke 默认 --jobs=4。本套件要**真跑生成器**，
//   而生成器会写 lib/client.js。若在真仓库里跑，读 client.js 的并发套件（builtin-tokens /
//   iter5-skin 等）会读到半写状态 ⇒ 偶发假红（实测一次 252/1，单独重跑三次全绿）。
//   故全部真跑都在**临时仓库副本**里做：lib/ + skins/ + tools/ 整份复制到 os.tmpdir()，
//   生成器按自身文件位置解析 root，副本内行为与真仓库逐字节等价。
//   真仓库只做**只读**断言（门①的 H0 与门⑤的 --check 绿）。
const H0src = readFileSync(CLIENT, 'utf8')
const H0 = sha256(H0src)
const TMP = mkdtempSync(path.join(os.tmpdir(), 'dam-gen-idem-'))
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }) } catch (e) {} })
for (const d of ['lib', 'skins', 'tools']) cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true })
const TCLIENT = path.join(TMP, 'lib', 'client.js')
const TGEN = path.join(TMP, 'tools', 'build-iter5-skin.mjs')
const runGen = (args) => spawnSync(process.execPath, [TGEN, ...args], { cwd: TMP, encoding: 'utf8' })

// ---- ① 真实重跑幂等：H1 === H0 ----
let H1 = null, runOut = ''
{
  const rd = runGen([])
  runOut = String(rd.stdout || '') + String(rd.stderr || '')
  H1 = sha256(readFileSync(TCLIENT, 'utf8'))
  ok(rd.status === 0, '无 flag 真实重跑退出码 = 0（实 ' + rd.status + '）')
}
ok(H1 === H0, '真实重建是 no-op：H1 === H0（' + String(H0).slice(0, 16) + '）')
ok(/Embedded iter5 skin \(\d+ bytes\)/.test(runOut), '重跑打印了产物字节数（可复算物理量）')

// ---- ② 重跑后 --check 仍绿（副本 + 真仓库都绿）----
const chk = runGen(['--check'])
ok(chk.status === 0, '重跑后 --check 退出码 = 0')
ok(/SYNC-OK/.test(String(chk.stdout || '')), '--check 打印 SYNC-OK（R1 唯一通过判据）')

// ---- ③ R2-b 负路径：探针 ⇒ 默认 exit 2 且不写盘 ----
const MARK = '      // ★GEN-IDEM-PROBE: only-on-disk line'
const backup = TCLIENT + '.gen-idem-bak'
copyFileSync(TCLIENT, backup)
let defCode = null, defOut = '', probeAlive = false
try {
  const lines = readFileSync(TCLIENT, 'utf8').split('\n')
  const at = lines.findIndex((l) => l.includes('function iter5ThemeGet'))
  assert.ok(at > 0, 'probe anchor found')
  lines.splice(at, 0, MARK)
  writeFileSync(TCLIENT, lines.join('\n'))
  const rd = runGen([])
  defCode = rd.status
  defOut = String(rd.stdout || '') + String(rd.stderr || '')
  probeAlive = readFileSync(TCLIENT, 'utf8').includes(MARK)
} finally {
  copyFileSync(backup, TCLIENT)
}
ok(defCode === 2, '默认模式遇未落源内容退出码 = 2（R2-b 硬停，实 ' + defCode + '）')
ok(probeAlive, '默认模式确实没写盘（探针行还在）')
ok(/\[R2\] 拒绝写盘/.test(defOut), '停机文案点名 R2')

// ---- ④ R2-b 逃生门：--force 必须覆盖 ----
let forceCode = null, forceOut = '', probeGone = false
try {
  const lines = readFileSync(TCLIENT, 'utf8').split('\n')
  const at = lines.findIndex((l) => l.includes('function iter5ThemeGet'))
  lines.splice(at, 0, MARK)
  writeFileSync(TCLIENT, lines.join('\n'))
  const rd = runGen(['--force'])
  forceCode = rd.status
  forceOut = String(rd.stdout || '') + String(rd.stderr || '')
  probeGone = !readFileSync(TCLIENT, 'utf8').includes(MARK)
} finally {
  copyFileSync(backup, TCLIENT)
  rmSync(backup, { force: true })
}
ok(forceCode === 0, '--force 退出码 = 0（实 ' + forceCode + '）')
ok(probeGone, '--force 确实写盘（探针行已被覆盖）')
ok(/\[--force\]/.test(forceOut), '--force 打印了显式放弃提示')

// ---- ⑤ 收尾：副本产物回到 H0；真仓库全程只读 ----
ok(sha256(readFileSync(TCLIENT, 'utf8')) === H0, '全部负路径结束后副本产物回到 H0')
ok(readFileSync(CLIENT, 'utf8') === H0src, '真仓库 lib/client.js 全程未被写入（并发安全）')
{
  const real = spawnSync(process.execPath, [GEN, '--check'], { cwd: ROOT, encoding: 'utf8' })
  ok(real.status === 0 && /SYNC-OK/.test(String(real.stdout || '')), '真仓库 --check 仍绿（R1：同步即通过）')
}

console.log('')
console.log('== generator-idempotent: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) process.exit(1)
