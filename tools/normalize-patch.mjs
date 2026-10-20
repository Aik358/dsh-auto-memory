#!/usr/bin/env node
/**
 * 把 pnpm 生成的 patch **规范化**成可移植形态（幂等，可反复跑）。
 *
 * 为什么需要它（2026-10-20 TTA 两次交叉复核的教训）：
 *   `pnpm patch-commit` 会用**工作目录的文件行尾**重新生成 patch 文件（Windows 下是 CRLF），
 *   并且**丢弃手工加的任何注释头**。上一轮手工做过「LF 归一化 + 加基线声明头」，
 *   这一轮升级重新 patch-commit 后**两件事全部丢失**：
 *     · CRLF 从 0 回到 434（其中 + 行 314 / - 行 13 / 上下文 107）
 *     · 基线声明头消失 ⇒ apply 工具的基线校验**整体空转**（解析出 0 个文件就跳过校验）
 *   ⇒ 结论：**不能靠手工**。规范化必须是 patch-commit 之后的一个固定步骤。
 *
 * 用法：
 *   node tools/normalize-patch.mjs <patchFile> --upstream-tag v3.3.11 --pkg <pkgDir>
 *   node tools/normalize-patch.mjs <patchFile> --check     仅检查，不修改（CI 用）
 *
 * 做的事：
 *   ① 把整个 patch 转成纯 LF
 *   ② 从上游 tag 取基线三文件的 sha256(LF)，写进注释头
 *   ③ --check 模式下只报告是否已规范化，退出码表达结果
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const FILES = ['index.js', 'rules-layer.js', 'tier0-catalog.js']

function parseArgs(argv) {
  const o = { check: false, tag: 'v3.3.11', pkg: '', repo: 'G:/AMup/dsh-auto-memory' }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') o.check = true
    else if (a === '--upstream-tag') o.tag = argv[++i]
    else if (a === '--pkg') o.pkg = argv[++i]
    else if (a === '--repo') o.repo = argv[++i]
    else rest.push(a)
  }
  o.patch = rest[0]
  return o
}

/** 从上游 tag 解出基线文件内容，算 LF 规范化后的 sha256 */
function upstreamHashes(tag, repo) {
  // ★注意：不要用 `git archive` —— 它输出整个仓库的 tar（本仓约 25MB），
  //   execFileSync 默认 maxBuffer 1MB ⇒ ENOBUFS。逐文件 `git show` 即可。
  const hashes = {}
  for (const f of FILES) {
    try {
      const buf = execFileSync('git', ['-C', repo, 'show', tag + ':lib/' + f], { maxBuffer: 64 * 1024 * 1024 })
      const text = buf.toString('utf8').replace(/\r\n/g, '\n')
      hashes[f] = createHash('sha256').update(text).digest('hex')
    } catch (e) {
      hashes[f] = null
    }
  }
  return hashes
}

function buildHeader(tag, hashes) {
  const rows = FILES.map((f) => `#   lib/${f.padEnd(20)} sha256(LF) = ${hashes[f] || '(缺失)'}`).join('\n')
  return `# ============================================================================
# DSH 自动记忆插件 · 笔记归档可寻址补丁
#
# ★本文件由 tools/normalize-patch.mjs 生成，**请勿手工编辑**。
#   每次 pnpm patch-commit 之后都必须重跑本工具，否则会丢下面两样东西。
#
# ★基线声明（apply 前必须校验；不匹配就不要打）：
#   上游 tag: ${tag}
${rows}
#
# ★为什么必须有这段（2026-10-20 TTA 交叉复核发现）：
#   按 3.3.9 切的 patch 能**静默 apply 到 3.3.11**（exit=0）—— 因为 3.3.11 新增的
#   waterLevelProxyCompat 整段没撞上本补丁上下文。「碰巧能打上」比「打不上」更危险。
#
# ★为什么必须纯 LF（同日第二次复核发现）：
#   pnpm patch-commit 按工作目录行尾重新生成 patch（Windows 下 CRLF 434 行），
#   而 lock 里的 patch_hash 按 **LF 归一化**记录 ⇒ 原始字节对不上。
#   当前机器靠 pnpm 的规范化能装上，换机器/换 pnpm 版本可能被判不匹配而静默回退。
#
# ★apply 纪律：
#   用 tools/apply-patch-safely.mjs —— 它先校验上面三个 sha256（**无声明头即拒绝**），
#   再在仓库外 apply，最后核对内容哈希真的变了（防「exit=0 但零改动」）。
#
# ★幂等性与可重建性（TTA 补充判据 2026-10-20）：
#   ① 本工具必须**幂等** —— 连跑两次产物 sha256 不变（已实测成立）。
#   ② 从源头重建 patch 能得到**同一文件**。
#   ★实测踩到一：git diff 默认把 index 行的 blob 哈希**缩写为 7 位**，
#     而 pnpm patch-commit 写的是**完整 40 位** ⇒ 两种来源生成的 patch 字节不同、
#     sha256 不同，「重建」与「现状」永远对不上（实测差异 6 行 index 行）。
#     重建 patch 必须用 git diff --full-index。
#   ★实测踩到二（更重要）：**即便都用 --full-index，blob 哈希仍不相同**。
#     根因：pnpm 的 patch 基线是 **npm 包里那份文件**（可能是 CRLF 或不同行尾），
#     而 git tag 里的文件是 LF ⇒ 同一逻辑内容的 blob 哈希不同。
#     ⇒ 结论：**「从 git tag 重建」与「pnpm patch 产物」不可逐字节比对**，
#       可重建性只能以「apply 后三文件内容相同」为准（内容级，不是 patch 字节级）。
#   判据用法：patch-commit 后立刻跑本工具 + 与上次快照比 sha256，
#     两轮前那类「手工修补被冲掉」当场就能发现（这一条是**幂等性**，成立）。
# --- END OF GENERATED HEADER ---

`
}

const opt = parseArgs(process.argv.slice(2))
if (!opt.patch) {
  console.error('用法: node tools/normalize-patch.mjs <patchFile> [--check] [--upstream-tag v3.3.11] [--repo <repo>]')
  process.exit(2)
}
if (!existsSync(opt.patch)) {
  console.error('patch 不存在: ' + opt.patch)
  process.exit(2)
}

const raw = readFileSync(opt.patch, 'utf8')
const crlfCount = (raw.match(/\r\n/g) || []).length
const hasHeader = /sha256\(LF\)\s*=/.test(raw) && /上游 tag:/.test(raw)
const parsedCount = [...raw.matchAll(/lib\/([\w.-]+\.js)\s+sha256\(LF\)\s*=\s*([0-9a-f]{64})/g)].length

console.log('patch: ' + opt.patch)
console.log('  CRLF 行数:        ' + crlfCount)
console.log('  有基线声明头:     ' + hasHeader)
console.log('  可解析基线文件数: ' + parsedCount)

if (opt.check) {
  const ok = crlfCount === 0 && hasHeader && parsedCount === FILES.length
  console.log(ok ? '\n✓ 已规范化（LF + 完整基线头）' : '\n✗ 未规范化 —— 跑一次 tools/normalize-patch.mjs 不带 --check')
  process.exit(ok ? 0 : 1)
}

// ── ① 去头（若已有旧头）──
//
// ★幂等性 bug（2026-10-20 连踩两次，最终这样修）：
//   版本 A：`while (lines[i].startsWith('#') || blank) i++`
//     —— 从文件开头跳过所有 # 行；patch 正文里的上下文行也可能以 # 开头，边界不可靠。
//   版本 B：找 `# ====` 当结束标记
//     —— **错**：buildHeader 自己内部就有多行 `# ====`（首行与末行各一条），
//        找到的是**头部内第一条**，于是只砍了几行 ⇒ 每跑一次头就多一份
//        （实测 37394 → 40282 → 43170，可解析基线数 3 → 6 → 9）。
//   版本 C（现用）：用**带唯一标识的结束标记** `# --- END OF GENERATED HEADER ---`，
//     它是本工具自己写的、且**正文里不可能出现**（patch 正文行都以 diff/index/@@/+/-/space 开头）。
//     去头 = 砍到该标记之后的第一个空行。若找不到该标记（说明是无头 patch），原样不动。
const END_MARK = '# --- END OF GENERATED HEADER ---'
let body = raw.replace(/\r\n/g, '\n')
{
  const lines = body.split('\n')
  const end = lines.findIndex((l) => l.trimEnd() === END_MARK)
  if (end >= 0) {
    let i = end + 1
    while (i < lines.length && lines[i].trim() === '') i++
    body = lines.slice(i).join('\n')
  }
  // 找不到标记 = 无头 patch（或旧格式头），原样保留交给下游
}

// ── ② 取基线 hash 并加头 ──
const hashes = upstreamHashes(opt.tag, opt.repo)
console.log('\n基线 sha256(LF)（tag ' + opt.tag + '）:')
for (const f of FILES) console.log('  ' + f.padEnd(20) + (hashes[f] || '(缺失)'))

const header = buildHeader(opt.tag, hashes)
const out = header + body.replace(/^\n+/, '')

// ── ③ 写回，确保纯 LF ──
writeFileSync(opt.patch, out.replace(/\r\n/g, '\n'), 'utf8')
const after = readFileSync(opt.patch, 'utf8')
console.log('\n✓ 已规范化写回')
console.log('  CRLF: ' + (after.match(/\r\n/g) || []).length + '（期望 0）')
console.log('  可解析基线文件数: ' + [...after.matchAll(/lib\/([\w.-]+\.js)\s+sha256\(LF\)/g)].length)
console.log('  大小: ' + Buffer.byteLength(after) + ' B')
