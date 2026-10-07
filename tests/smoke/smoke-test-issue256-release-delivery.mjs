import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * issue #256（BD-01）守卫：tools/reconcile-upstream.mjs 从未被交付 + DEV 硬编码本机路径。
 *
 * 缺陷机理（docs/internal/AUDIT-20261007-ABC-CLASSIFICATION.md §8.7）：
 *   tools/ 用**白名单**入包，reconcile-upstream.mjs 从未列入 ⇒ **永远进不了发布树**；
 *   而 GitHub main 由发布树生成 ⇒ 干净克隆永远拿不到它；而 release.mjs 3.7 段**无条件调用**它
 *   ⇒ 干净 main 克隆跑 release 必 MODULE_NOT_FOUND。
 *   第二重：release.mjs 的 DEV 默认值硬编码本机绝对路径 ⇒ CI/他人机器上该目录不存在。
 *
 * 本套件立场：**真执行**（跑真实 release.mjs 的复制/交付阶段），不靠「源码里有没有该字符串」。
 *   正路径：fixture 里放**哨兵文件** → 若 staging 出现哨兵，即证明 DEV == fixture（相对解析生效）；
 *           若仍用硬编码路径，DEV 会是本机真实仓库、哨兵绝不出现（强鉴别力来源）。
 *   负路径：移走 fixture 的 reconcile-upstream.mjs ⇒ 必须**明确报错退出**（非静默通过）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RELEASE = path.join(ROOT, 'tools', 'release.mjs')
const SRC = readFileSync(RELEASE, 'utf8')

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.log('  FAIL - ' + n) } }

console.log('[#256] A. 源码守卫（判据：接线在不在，不是「有没有做过」）')
const HARDCODED_DEV = "const DEV = process.env.DSH_AUTO_MEMORY_DEV || 'D:\\\\dsh-auto-memory'"
ok(SRC.indexOf(HARDCODED_DEV) < 0, '★ DEV 默认值不再是硬编码本机路径')
const RELATIVE_DEV = "const DEV = process.env.DSH_AUTO_MEMORY_DEV || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')"
ok(SRC.indexOf(RELATIVE_DEV) >= 0, '★ DEV 默认值相对脚本自身位置解析（任意克隆/CI 可运行）')
ok(SRC.includes("import { fileURLToPath } from 'node:url'"), 'fileURLToPath 已 import')
ok(SRC.includes('process.env.DSH_AUTO_MEMORY_DEV ||'), '★ DSH_AUTO_MEMORY_DEV 覆盖优先保留（本机工作流依赖它指向另一棵源树）')
const copyListAnchor = "for (const toolFile of '"
const copyStart = SRC.indexOf(copyListAnchor)
const copyList = copyStart >= 0 ? SRC.slice(copyStart + copyListAnchor.length, SRC.indexOf("'.split(',')", copyStart)) : ''
ok(copyList.includes('reconcile-upstream.mjs'), '★ tools 拷贝清单含 reconcile-upstream.mjs（实测清单：' + copyList + '）')
const reqIdx = SRC.indexOf('REQUIRED_RELEASE_TOOLS')
ok(reqIdx >= 0 && SRC.slice(reqIdx).includes('reconcile-upstream.mjs'), '★ 有「产物侧」必需工具清单且含 reconcile-upstream.mjs（不信任源侧清单）')
ok(SRC.includes("path.join(REL, 'tools', 'reconcile-upstream.mjs')"), '★ §5.5 发布物完整性断言 tools/reconcile-upstream.mjs 存在')
ok(SRC.includes('const sameDir = (x, y) =>') && SRC.includes('if (sameDir(DEV, REL))'), '★ DEV === REL 同目录 fail closed（DEV 相对化后的自毁风险）')
ok(SRC.includes("process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase()"), '★ 同目录判据在 win32 下大小写不敏感')

console.log('[#256] B. 真执行：复制/交付阶段（fixture 隔离，不触碰真实发布基座）')
const fixture = mkdtempSync(path.join(tmpdir(), 'dam-256-delivery-'))
const stagingDirs = []
const runFixtureRelease = (env) => spawnSync(process.execPath, [path.join(fixture, 'tools', 'release.mjs'), '3.2.10', '--dry-run'], {
  cwd: fixture, encoding: 'utf8', timeout: 60000, windowsHide: true, env,
})
const stagingOf = (out) => {
  const m = out.match(/staging 目录: (.+)/)
  const d = m && m[1].trim()
  if (d) stagingDirs.push(d)
  return d
}

try {
  // 最小可跑夹具：足以走到「tools 交付核对」（与 issue170 同款隔离思路）。
  for (const dir of ['lib', 'tests', 'python', 'tools', 'locale']) mkdirSync(path.join(fixture, dir), { recursive: true })
  writeFileSync(path.join(fixture, 'lib', 'index.js'), 'export const fixture = true' + String.fromCharCode(10))
  writeFileSync(path.join(fixture, 'lib', 'client.js'), 'export const fixture = true' + String.fromCharCode(10))
  for (const f of ['run-smoke.mjs', 'smoke-impact.mjs', 'build-iter5-skin.mjs']) writeFileSync(path.join(fixture, 'tools', f), '// fixture' + String.fromCharCode(10))
  // ★关键：release.mjs **本体**拷进 fixture，使其相对解析的 DEV == fixture。
  cpSync(RELEASE, path.join(fixture, 'tools', 'release.mjs'))
  // ★哨兵：fixture 独有（真仓库绝无此文件）⇒ 出现在 staging 即证明 DEV == fixture。
  const SENTINEL = 'zz-devroot-sentinel-256.json'
  writeFileSync(path.join(fixture, 'locale', SENTINEL), '{ "sentinel": "issue-256" }' + String.fromCharCode(10))
  // 环境隔离：清空两个覆盖变量，逼 release.mjs 走默认值（= 相对解析）分支。
  const cleanEnv = { ...process.env, DSH_AUTO_MEMORY_DEV: '', DSH_AUTO_MEMORY_REL: '' }

  // ── B1 负路径：缺 reconcile-upstream.mjs ⇒ 必须明确报错、非静默通过 ──
  const neg = runFixtureRelease(cleanEnv)
  const negOut = neg.stdout + neg.stderr
  stagingOf(negOut)
  ok(neg.status !== 0, '★ 负路径：缺 reconcile-upstream.mjs 时**非零退出**（实测 exit ' + neg.status + '）')
  ok(negOut.includes('reconcile-upstream.mjs'), '★ 负路径：报错**点名** reconcile-upstream.mjs（不是含糊失败）')
  ok(!negOut.includes('交付核对: OK'), '★ 负路径：不得打印「交付核对 OK」（否则是假绿）')

  // ── B2 正路径：补上该文件 ⇒ 交付核对通过 + 哨兵证明 DEV 是 fixture 自身 ──
  writeFileSync(path.join(fixture, 'tools', 'reconcile-upstream.mjs'), 'process.exit(0)' + String.fromCharCode(10))
  const pos = runFixtureRelease(cleanEnv)
  const posOut = pos.stdout + pos.stderr
  const posStaging = stagingOf(posOut)
  ok(posOut.includes('交付核对: OK'), '★ 正路径：tools 交付核对通过（' + (posOut.match(/交付核对: OK\([^)]*\)/) || [''])[0] + '）')
  ok(!!posStaging && existsSync(path.join(posStaging, 'tools', 'reconcile-upstream.mjs')), '★ 正路径：staging 里**存在** tools/reconcile-upstream.mjs（本缺陷的直接验收）')
  ok(!!posStaging && existsSync(path.join(posStaging, 'locale', SENTINEL)), '★★ 正路径：staging 出现**哨兵** ⇒ DEV 解析为 fixture 自身（相对脚本位置生效，未用硬编码路径）')
  ok(!existsSync(path.join(ROOT, 'locale', SENTINEL)), '哨兵是真仓库不存在的 fixture 专有文件（鉴别力前提成立）')

  // ── B3 自毁护栏：DEV === REL（同一目录）必须 fail closed ──
  const same = spawnSync(process.execPath, [path.join(fixture, 'tools', 'release.mjs'), '3.2.10'], {
    cwd: fixture, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, DSH_AUTO_MEMORY_DEV: fixture, DSH_AUTO_MEMORY_REL: fixture },
  })
  const sameOut = (same.stdout || '') + (same.stderr || '')
  ok(same.status !== 0, '★ DEV === REL 时非零退出（实测 exit ' + same.status + '）')
  ok(sameOut.includes('同一个目录') || sameOut.includes('自毁'), '★ DEV === REL 时给出明确自毁指引')
  ok(existsSync(path.join(fixture, 'lib', 'index.js')), '★★ DEV === REL 被拒后 fixture 仍完好（**没有真的执行清空**）')
} finally {
  rmSync(fixture, { recursive: true, force: true })
  for (const d of stagingDirs) { if (d) rmSync(d, { recursive: true, force: true }) }
}

console.log('');
console.log('[#256] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
