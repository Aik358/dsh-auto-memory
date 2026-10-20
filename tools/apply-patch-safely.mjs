#!/usr/bin/env node
/**
 * 安全 apply：先校验基线 sha256，再在**仓库外**的纯目录里 apply，最后核对内容。
 *
 * 为什么需要它（2026-10-20 TTA 交叉复核的两条发现）：
 *   发现 1：「碰巧能打上」比「打不上」更危险。按 3.3.9 切的 patch 居然能静默 apply 到 3.3.11
 *           （exit=0，因为新增的 waterLevelProxyCompat 整段没撞上上下文）⇒ 必须校验基线。
 *   发现 2：git apply 在 git 仓库的子目录里可能 exit=0 却什么都不改
 *           ⇒ 必须在仓库外的纯目录 apply，且 apply 后必须核对内容，不能只看 exit code。
 *
 * 用法：
 *   node tools/apply-patch-safely.mjs <patch> <targetPkgDir> [--dry-run]
 *
 * targetPkgDir 形如 .../node_modules/@a9i5k4/dsh-auto-memory
 */
import { readFileSync, mkdtempSync, rmSync, cpSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const [patchPath, targetDir, ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')
if (!patchPath || !targetDir) {
  console.error('用法: node tools/apply-patch-safely.mjs <patch> <targetPkgDir> [--dry-run]')
  process.exit(2)
}

const sha = (f) => createHash('sha256').update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex')
const patchText = readFileSync(patchPath, 'utf8')

// ── ① 从 patch 头部解析基线声明 ──
const base = {}
for (const m of patchText.matchAll(/lib\/([\w.-]+\.js)\s+sha256\(LF\)\s*=\s*([0-9a-f]{64})/g)) {
  base[m[1]] = m[2]
}
const baseVer = (patchText.match(/上游版本:\s*([\d.]+)/) || [])[1]
console.log('基线声明: 版本 ' + (baseVer || '(未声明)') + '，文件 ' + Object.keys(base).length + ' 个')

// ── ② 校验目标文件是否匹配基线 ──
let mismatch = 0
for (const [f, want] of Object.entries(base)) {
  const p = path.join(targetDir, 'lib', f)
  if (!existsSync(p)) { console.log('  ✗ 缺文件 ' + f); mismatch++; continue }
  const got = sha(p)
  const ok = got === want
  if (!ok) mismatch++
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + f.padEnd(20) + (ok ? '基线匹配' : '基线不匹配 got=' + got.slice(0, 16)))
}
if (mismatch > 0) {
  console.error('\n★基线不匹配 ' + mismatch + ' 个文件 —— 拒绝 apply（防止静默打错版本）')
  console.error('  若确认要打，请先确认补丁与目标版本对应，或重新生成对应基线的补丁。')
  process.exit(1)
}

// ── ③ 在仓库外的纯临时目录里 apply ──
const tmp = mkdtempSync(path.join(tmpdir(), 'safe-apply-'))
try {
  cpSync(path.join(targetDir, 'lib'), path.join(tmp, 'lib'), { recursive: true })
  let insideRepo = false
  try {
    execFileSync('git', ['-C', tmp, 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' })
    insideRepo = true
  } catch (_) { insideRepo = false }
  console.log('\napply 目录: ' + tmp + '（在 git 仓库内: ' + insideRepo + '）')

  const args = ['apply', '--verbose', patchPath]
  if (insideRepo) args.push('--unsafe-paths', '--directory', tmp)
  try {
    execFileSync('git', args, { cwd: tmp, stdio: 'pipe' })
  } catch (e) {
    console.error('★git apply 失败: ' + (e.stderr ? e.stderr.toString().slice(0, 400) : e.message))
    process.exit(1)
  }

  // ── ④ 核对内容真的变了（防「exit=0 但没改」）──
  let changed = 0
  for (const f of Object.keys(base)) {
    const after = sha(path.join(tmp, 'lib', f))
    if (after !== base[f]) changed++
    else console.log('  ⚠ ' + f + ' 内容未变（apply 可能静默失败）')
  }
  if (changed === 0) { console.error('\n★apply 后所有文件都没变 —— 判定为静默失败'); process.exit(1) }
  console.log('内容确实改变的文件数: ' + changed + '/' + Object.keys(base).length)

  if (dryRun) { console.log('\n--dry-run：未写入目标'); process.exit(0) }

  // ── ⑤ 写回目标 ──
  for (const f of Object.keys(base)) {
    cpSync(path.join(tmp, 'lib', f), path.join(targetDir, 'lib', f))
  }
  console.log('\n✓ 已写回: ' + targetDir)
  for (const f of Object.keys(base)) {
    console.log('  ' + f.padEnd(20) + 'sha256(LF) = ' + sha(path.join(targetDir, 'lib', f)).slice(0, 16))
  }
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
}
