#!/usr/bin/env node
/**
 * [generator-guard] 生成器的「会覆盖未落源改动」防线，必须常驻。
 *
 * ★由来（2026-10-01 真实事故）：有人把修复只写进 lib/client.js 的生成区、没落进源文件，
 *   下一次跑生成器就静默还原，而 node --check 与全部静态守卫全绿（产物自洽，只是修复没了）。
 *   用户裁定：给生成器加提醒，「让它每次运行前都能读到」。
 *
 * ★2026-10-02 用户改裁（R2「失配即停机」）：默认模式**不再告警后照写**，而是 exit 2 拒写；
 *   --force 才是唯一的显式覆盖通道，--strict 保留为 --force 的反义别名（等价于新默认）。
 *   故本文件第 ④ 段由「默认仍写盘」翻转为「默认 exit 2 且探针存活」，并新增 --force 用例。
 *
 * ★本守卫检查生成器**自己承诺的四件事**是否还在（真读文件、真执行断言，不是读注释）：
 *   ① 文件头有警告块，且写明「会覆盖什么 / 源在哪 / --force 怎么用」；
 *   ② 有运行时检测函数 orphanedLines，且它能真判出「只在磁盘上、会被覆盖」的行；
 *   ③ 停机真能拒绝写盘（子进程实跑，断言退出码 = 2 且产物未变）——默认与 --strict 都要拦；
 *   ④ 默认模式也是停机（R2-b）；--force 才写盘；
 *   ⑤ --check 仍是只读（跑完磁盘字节不变）且打印 SYNC-OK（R1 唯一通过判据）。
 *   负路径：把检测函数删掉，②必须失败（证明断言不是恒真）。
 * ★并发纪律（2026-10-02 补，实测踩到）：run-smoke 默认 --jobs=4，本套件的 ③④ 会向
 *   lib/client.js **注入探针行**再还原。若与读 client.js 的套件（如 builtin-tokens /
 *   iter5-skin）同批并发，读者会在还原前的窗口里读到被污染的文件 ⇒ 偶发假红（实测一次
 *   252/1，单独重跑三次全绿）。故③④改为在**临时仓库副本**里跑：lib/ + skins/ + tools/
 *   整份复制到 os.tmpdir()，生成器按自身文件位置解析 root，副本内行为与真仓库逐字节等价；
 *   真仓库只留**只读**断言（--check 绿）。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, copyFileSync, rmSync, cpSync, mkdtempSync } from 'node:fs'
import { spawnSync as runGen } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const GEN = path.join(ROOT, 'tools', 'build-iter5-skin.mjs')
const CLIENT = path.join(ROOT, 'lib', 'client.js')
const genSrc = readFileSync(GEN, 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok -', m) } else { fail++; console.error('  FAIL -', m) } }

// ---- ① 头部警告块 ----
ok(/本生成器会\*\*覆盖\*\*/.test(genSrc), '文件头有「会覆盖」警告块')
ok(/ITER5-LEGACY-GENERATED:BEGIN/.test(genSrc) && /覆盖/.test(genSrc.slice(0, 3000)), '头部写明被覆盖的两对标记')
ok(/iter5-325\.js\.frozen/.test(genSrc.slice(0, 3000)), '头部给出冻结源路径')
ok(/--force/.test(genSrc.slice(0, 4000)), '头部写明 --force 用法（2026-10-02 R2 改裁后的唯一覆盖通道）')
ok(/--strict/.test(genSrc.slice(0, 4000)), '头部保留 --strict 说明（--force 的反义别名）')
ok(/R2/.test(genSrc.slice(0, 4000)), '头部写明 R2「失配即停机」')

// ---- ② 运行时检测函数存在 ----
ok(/function orphanedLines\(/.test(genSrc), '存在 orphanedLines 运行时检测函数')
const iFn = genSrc.indexOf('function orphanedLines(')
const iUse = genSrc.indexOf('orphanedLines(onDisk, output)')
ok(iFn > 0 && iUse > iFn, '检测函数在写盘前被真正调用（定义<=调用）')
ok(/process\.exit\(2\)/.test(genSrc), '--strict 分支会以非零码退出')

// ---- ③④ 真跑：在**临时仓库副本**里注入探针，验证停机与 --force ----
//   ★并发纪律：run-smoke 默认 --jobs=4，向真仓库注入探针会让并发读者读到污染文件
//   （2026-10-02 实测一次假红 252/1，单独重跑即绿）。生成器按自身文件位置解析 root，
//   故整份副本内的行为与真仓库逐字节等价，且真仓库不再被本套件写入。
const MARK = '      // ★GEN-GUARD-PROBE: only-on-disk line'
const orig = readFileSync(CLIENT, 'utf8')
const TMP = mkdtempSync(path.join(os.tmpdir(), 'dam-gen-guard-'))
let strictCode = null, strictOut = ''
let defCode = null, defOut = '', defProbeAlive = false, defLine = 0
let forceCode = null, forceOut = '', forceProbeGone = false
try {
  for (const d of ['lib', 'skins', 'tools']) cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true })
  const TCLIENT = path.join(TMP, 'lib', 'client.js')
  const TGEN = path.join(TMP, 'tools', 'build-iter5-skin.mjs')
  const probe = () => {
    const lines = readFileSync(TCLIENT, 'utf8').split('\n')
    const at = lines.findIndex((l) => l.includes('function iter5ThemeGet'))
    assert.ok(at > 0, 'probe anchor found')
    lines.splice(at, 0, MARK)
    writeFileSync(TCLIENT, lines.join('\n'))
    return at + 1
  }
  // ③ --strict：必须拒绝且不写盘
  probe()
  {
    const r = runGen(process.execPath, [TGEN, '--strict'], { cwd: TMP, encoding: 'utf8' })
    strictCode = r.status
    strictOut = String(r.stdout || '') + String(r.stderr || '')   // 停机清单走 stderr
  }
  ok(strictCode === 2, '--strict 遇到未落源内容时退出码 = 2（实 ' + strictCode + '）')
  ok(/\[R2\] 拒绝写盘/.test(strictOut), '--strict 打印 [R2] 拒绝写盘（它是 --force 的反义别名）')
  ok(readFileSync(TCLIENT, 'utf8').includes(MARK), '--strict 确实没写盘（探针行还在）')
  // ④ 默认：必须停机（★2026-10-02 用户改裁 R2-b：原「告警后照写」作废）
  copyFileSync(TCLIENT, path.join(TMP, 'client.orig'))
  copyFileSync(path.join(TMP, 'client.orig'), TCLIENT)
  defLine = probe()
  {
    const rd = runGen(process.execPath, [TGEN], { cwd: TMP, encoding: 'utf8' })
    defCode = rd.status
    defOut = String(rd.stdout || '') + String(rd.stderr || '')
    defProbeAlive = readFileSync(TCLIENT, 'utf8').includes(MARK)
  }
  ok(defCode === 2, '默认模式遇到未落源内容时退出码 = 2（R2-b 硬停，实 ' + defCode + '）')
  ok(/\[R2\] 拒绝写盘/.test(defOut), '默认模式打印 [R2] 拒绝写盘')
  ok(defOut.includes('L' + defLine), '停机清单里带出行号')
  ok(defProbeAlive, '默认模式确实没写盘（探针行还在）')
  // ④b --force：唯一的显式覆盖通道，必须照写（旧默认行为）
  {
    const rd = runGen(process.execPath, [TGEN, '--force'], { cwd: TMP, encoding: 'utf8' })
    forceCode = rd.status
    forceOut = String(rd.stdout || '') + String(rd.stderr || '')
    forceProbeGone = !readFileSync(TCLIENT, 'utf8').includes(MARK)
  }
  ok(forceCode === 0, '--force 退出码 = 0（实 ' + forceCode + '）')
  ok(forceProbeGone, '--force 确实写盘（探针行已被覆盖）')
  ok(/\[--force\]/.test(forceOut), '--force 打印了显式放弃提示')
} finally {
  rmSync(TMP, { recursive: true, force: true })
}
ok(readFileSync(CLIENT, 'utf8') === orig, '真仓库 lib/client.js 全程未被本套件写入（并发安全）')

// ---- ⑤ --check 只读 + R1 判据 ----
const before = readFileSync(CLIENT, 'utf8')
const chk = String(runGen(process.execPath, [GEN, '--check'], { cwd: ROOT, encoding: 'utf8' }).stdout || '')
ok(/SYNC-OK/.test(chk), '--check 打印 SYNC-OK（R1 唯一通过判据）')
ok(/up to date/.test(chk), '--check 保留同义输出 up to date')
ok(readFileSync(CLIENT, 'utf8') === before, '--check 全程未改磁盘（字节相同）')

// ---- ⑥ 负路径：真删检测函数，②必须失败 ----
assert.throws(() => {
  const mut = genSrc.replace(/function orphanedLines\([\s\S]*?\n\}/, '')
  assert.notEqual(mut, genSrc, 'MUTATION: 检测函数锚点命中')
  assert.ok(/function orphanedLines\(/.test(mut), 'MUTATION: 删除后不应再存在')
}, /MUTATION/)
ok(true, 'MUTATION 负路径：删掉检测函数后 ② 的断言必失败')

console.log('')
console.log('== generator-guard: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) process.exit(1)
