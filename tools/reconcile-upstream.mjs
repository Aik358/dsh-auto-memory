#!/usr/bin/env node
/**
 * 上游对账（issue 层面的"修复回流 pre"硬闸门）
 *
 * **为什么存在**（2026-09-22 实证事故）：
 *   pre 开发线与 GitHub `main` 自 2026-09-07 起分叉（当时 135 vs 72 个独有提交），
 *   而 **发布包是从 pre 线构建的**（tools/release.mjs 从 DEV 树生成 REL 树）。
 *   于是「在 main 上修」= 白修：既不影响发布包，还会被下一次发布强推冲成孤儿
 *   （实测 PR #118/#119/#120 的合并提交在本机 `git merge-base --is-ancestor … origin/main`
 *    返回 **128 = 对象不存在**，只存在于 GitHub 侧）。
 *   代价：三条 P1（#103/#104/#105）修了两轮、用户侧从未拿到。
 *   报告见 docs/internal/WHY-FIXES-MISSING-20260922.md。
 *
 * 本工具把那四条手工命令固化成一条可执行命令，供**发版前**与**合完 base=main 的 PR 后**使用。
 *
 * 用法：
 *   node tools/reconcile-upstream.mjs            # 报告模式（默认，退出码恒 0）
 *   node tools/reconcile-upstream.mjs --strict   # 闸门模式：发现"修复只在 main 侧"即退出 1
 *   node tools/reconcile-upstream.mjs --json     # 机器可读
 *
 * 判据（三条，全部只读、零网络）：
 *   1. 分叉度：merge-base 与左右独有提交数；
 *   2. 孤儿检测：给定 PR/提交 sha，判断它是否仍在本地可达（不在 = 已被强推冲掉）；
 *   3. 文件面：检查一份"必须在 pre 存在的上游产物清单"（新模块/守卫/关键修复标记）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const argv = process.argv.slice(2)
const STRICT = argv.includes('--strict')
const JSON_OUT = argv.includes('--json')

/** 本地可达性探测：git 在对象缺失时返回 128（≠ 1），必须三态区分 */
function reachable(rev) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', rev, 'HEAD'], { cwd: ROOT, stdio: 'ignore' })
    return 'yes'                       // 0：是 HEAD 的祖先
  } catch (e) {
    if (e.status === 128) return 'missing'   // ★对象根本不在本地 ⇒ 被强推冲掉
    if (e.status === 1) return 'no'          // 存在但不是 HEAD 祖先（例如只在 main 上）
    return 'error'
  }
}
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

const out = { fork: {}, orphans: [], artifacts: [] }

// ── 1. 分叉度 ────────────────────────────────────────────────────
try {
  const base = git(['merge-base', 'HEAD', 'origin/main'])
  const baseDate = git(['log', '-1', '--format=%ci', base])
  const baseSubj = git(['log', '-1', '--format=%s', base])
  const lr = git(['rev-list', '--left-right', '--count', 'HEAD...origin/main']).split(/\s+/).map(Number)
  out.fork = {
    mergeBase: base.slice(0, 8),
    mergeBaseDate: baseDate,
    mergeBaseSubject: baseSubj,
    preOnly: lr[0],
    mainOnly: lr[1],
  }
} catch (e) {
  out.fork = { error: String((e && e.message) || e) }
}

// ── 2. 孤儿检测（在 main 上合过、但本地已不可达的提交/PR —— 清单可增补）──────
// 这些 sha 是 2026-09-22 实测确认"只在 GitHub 侧、本地对象不存在"的合并提交。
const KNOWN_ORPHANS = [
  { sha: 'c010eaf3', what: 'PR #118 merge（#104 host 回填）' },
  { sha: 'eb858efd', what: 'PR #119 merge（#103 指纹游标）' },
  { sha: '8d843b39', what: 'PR #120 merge（#105 下载链路）' },
  { sha: '475abfe',  what: 'PR #126 courtesy merge（唯一还保存三条修复的快照）' },
]
for (const o of KNOWN_ORPHANS) {
  const st = reachable(o.sha)
  out.orphans.push({ ...o, state: st })
}

// ── 3. 文件面：这些上游产物必须**在 pre 线**存在（否则就是没回流）──────
const MUST_BE_IN_PRE = [
  { kind: 'module', p: 'lib/jsonl-tail-cursor.js', why: '#103 环形游标（去 pre 后源码名即发布名）' },
  { kind: 'module', p: 'lib/hub-io.js', why: '#110 写失败可见' },
  { kind: 'guard', p: 'tests/smoke/smoke-test-issue103-105-portfix.mjs', why: '#103/#104/#105 行为守卫' },
  { kind: 'guard', p: 'tests/smoke/smoke-test-issue110-hub-io.mjs', why: '#110 守卫' },
  { kind: 'guard', p: 'tests/smoke/smoke-test-issue112-hermetic-home.mjs', why: '#112 隔离守卫' },
]
// 关键修复标记（源码里必须存在的行；缺一即说明该修复没回流）
const MUST_MARKERS = [
  { p: 'lib/index.js', needle: 'engine.runtimes._shadowHost = engine._shadowHost', why: '#104 shadow host 回填' },
  { p: 'lib/index.js', needle: 'engine.runtimes._activationHost = engine._activationHost', why: '#104 activation host 回填' },
  { p: 'lib/index.js', needle: 'createJsonlTailCursorPre({ maxSeen: 1024 })', why: '#103 指纹游标实例' },
  { p: 'lib/index.js', needle: 'workspaceDiscoverMax', why: '#102 工作区发现上限参数化' },
  { p: 'lib/python-setup.js', needle: 'Readable.fromWeb(resp.body)', why: '#105 WHATWG→Node 流' },
  { p: 'lib/python-setup.js', needle: 'await pipeline(src, createWriteStream(part', why: '#105 真写入' },
]
for (const a of MUST_BE_IN_PRE) {
  const abs = path.join(ROOT, a.p)
  out.artifacts.push({ ...a, present: fs.existsSync(abs) })
}
for (const m of MUST_MARKERS) {
  const abs = path.join(ROOT, m.p)
  let hit = false
  try { hit = fs.readFileSync(abs, 'utf8').includes(m.needle) } catch (_) {}
  out.artifacts.push({ kind: 'marker', p: m.p, needle: m.needle, why: m.why, present: hit })
}

// ── 4. 过渡垫片核查（去 pre 2026-09-23）────────
// 去 pre 后 lib/*-pre.js 只应是**过渡垫片**（同名裸文件已存在，垫片仅 re-export）。
// 若出现「没有裸名孪生体的 -pre.js」，说明有模块漏改名 —— 点名报错。
{
  let reg = ''
  try { reg = fs.readFileSync(path.join(ROOT, 'tools', 'release.mjs'), 'utf8') } catch (_) {}
  const onDisk = []
  try {
    for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) if (f.endsWith('-pre.js')) onDisk.push(f)
  } catch (_) {}
  const realLeft = onDisk.filter((f) => !fs.existsSync(path.join(ROOT, 'lib', f.replace(/-pre\.js$/, '.js'))))
  out.unregistered = realLeft
}

// ── 输出 ─────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log('== 上游对账（pre ← main 回流检查）==\n')
  const f = out.fork
  if (f.error) console.log('[分叉度] 取不到：' + f.error)
  else {
    console.log('[分叉度] merge-base = ' + f.mergeBase + ' @ ' + f.mergeBaseDate)
    console.log('         即「' + f.mergeBaseSubject + '」')
    console.log('         pre 独有 ' + f.preOnly + ' 个提交 / main 独有 ' + f.mainOnly + ' 个提交')
    console.log('         ⚠ 在 main 上修 = 白修（发布包从 pre 构建）；main 还会被下次发布强推覆盖\n')
  }
  console.log('[孤儿检测] 本地可达性（missing = 已被强推冲掉、只剩 GitHub 侧）')
  for (const o of out.orphans) {
    const tag = o.state === 'missing' ? '✗ missing' : o.state === 'yes' ? '✓ 在 HEAD 历史' : '(' + o.state + ')'
    console.log('   ' + tag + '  ' + o.sha + '  ' + o.what)
  }
  console.log('\n[回流产物] 必须在 pre 线存在')
  const bad = out.artifacts.filter((a) => !a.present)
  for (const a of out.artifacts) {
    console.log('   ' + (a.present ? '✓' : '✗') + '  ' + a.p + (a.needle ? '  ⟨' + a.needle.slice(0, 48) + '⟩' : '') + '  — ' + a.why)
  }
  console.log('\n[release.mjs 登记] ' + (out.unregistered.length ? '✗ 未登记：' + out.unregistered.join(', ') : '✓ 全部 -pre 模块已登记'))
  const fails = bad.length + out.unregistered.length
  console.log('\n结论：' + (fails === 0 ? '✓ 上游产物已全部回流 pre 线' : '✗ 有 ' + fails + ' 项缺失/未登记 —— 需要回流或登记后再发版'))
  if (fails && STRICT) { console.log('[--strict] 退出 1'); process.exit(1) }
  if (fails) console.log('（本次为报告模式；加 --strict 可作发版闸门）')
}
process.exit(0)
