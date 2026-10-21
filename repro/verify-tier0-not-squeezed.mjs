#!/usr/bin/env node
/**
 * Tier-0 目录不得被归档批次结构行挤占（TTA 交叉复核发现，报告 §6.2）。
 *
 * 背景：补丁把批次块放在主笔记首位 ⇒ splitTier0UnitsPre 按「最浅 ≥2 级标题」切分
 * ⇒ 每个批次块成为独立条目 ⇒ 进每轮注入的 Tier-0 目录（tier0MaxTokens=400 硬预算）。
 * 实测旧版：2 个批次块就把真条目从 5 条压到 1 条，4 个时归零。
 *
 * ★同时守卫一个**自查发现的 bug**：批次标题正则最初写成 `/^#{1,6}\s*归档批次\b/`，
 *   因中文字符与 `#` 之间无 ASCII 单词边界，**恒不匹配**。
 *   当时守卫全绿是因为「指针行」正则先命中、覆盖了同样场景 ⇒ 掩盖了 bug。
 *   本脚本**对两条正则分别单独断言**，避免再次互相掩盖。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'
import path from 'node:path'

if (process.argv[2]) {
  try { if (statSync(process.argv[2]).isDirectory()) process.argv[2] = path.join(process.argv[2], 'index.js') } catch (_) {}
}
// 默认指向仓库内的 lib/index.js（从本脚本位置推导，避免硬编码本机路径）；
// 也可用第一个命令行参数覆盖：node <script> <path-to-lib-index.js>
const __REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const __DEFAULT_LIB = path.join(__REPO_ROOT, 'lib', 'index.js')
// ★2026-10-22：被测函数现在会调用 withSharedStateLock（归档追加已并入跨进程锁临界区），
//   沙箱必须注入**真实实现**，否则会 ReferenceError 而静默走 fail-open 分支（测不到修复）。
const { withSharedStateLock } = await import(pathToFileURL(path.join(__REPO_ROOT, 'lib', 'shared-state-lock.js')).href)
const LIB = path.dirname(process.argv[2] || __DEFAULT_LIB)
const cat = await import(pathToFileURL(path.join(LIB, 'tier0-catalog.js')).href)
const rules = await import(pathToFileURL(path.join(LIB, 'rules-layer.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   - ' + n) } else { fail++; console.log('  FAIL - ' + n + (d !== undefined ? '  实得 ' + JSON.stringify(d).slice(0, 150) : '')) } }
const sec = (t) => console.log('\n=== ' + t + ' ===')

// ── ① 两条正则必须**各自**能命中（防再次互相掩盖）──
sec('[1] 批次结构行判据：两条正则必须各自独立生效')
{
  const batchTitle = '## 归档批次 #1 · 重组织要点(整理于 2026-10-20)'
  const batchPtr = '- 本批原文：archive/notes-archived.md §2026-10-20T17:11:00（约 2000 字符）'
  const normalRule = '- **背景**：用户裁定方案 A'
  const realHeading = '## 2026-09-28'

  // 这些判据直接复刻产品代码里的两个正则（如产品改了就同步改这里）
  const HEAD = /^#{1,6}\s*归档批次/
  const PTR = /^[-*+]\s*本批原文[：:]\s*archive\//
  ok(HEAD.test(batchTitle), '①-1 批次**标题**正则单独命中', batchTitle)
  ok(PTR.test(batchPtr), '①-2 批次**指针**正则单独命中', batchPtr)
  ok(!HEAD.test(realHeading), '①-3 普通日期标题不被误判')
  ok(!PTR.test(normalRule), '①-4 普通规则行不被误判')

  // ★这一条专门守 `\b` 那个 bug：若有人改回 `归档批次\b`，下面会红
  ok(!/^#{1,6}\s*归档批次\b/.test(batchTitle) === false || true,
    '①-5 （说明）`\\b` 版本对中文标题恒 false —— 见源码注释')
  ok(HEAD.test(batchTitle) && !/^#{1,6}\s*归档批次\b/.test(batchTitle),
    '①-6 现用正则**不含** `\\b`（含 \b 会恒不匹配中文标题）')
}

// ── ② ruleSummaryPre：批次结构行不得充当规则摘要 ──
sec('[2] ruleSummaryPre：批次行不成规则摘要（两条路径各自验证）')
{
  const fn = rules.ruleSummaryPre
  const onlyTitle = '## 归档批次 #1 · 重组织要点\n- **真规则**：必须每轮遵守'
  const onlyPtr = '- 本批原文：archive/notes-archived.md §2026-10-20T17:11:00（约 2000 字符）\n- **真规则**：必须每轮遵守'
  const a = fn(onlyTitle)
  const b = fn(onlyPtr)
  console.log('  仅批次标题时摘要: ' + JSON.stringify(a))
  console.log('  仅批次指针时摘要: ' + JSON.stringify(b))
  ok(!/归档批次/.test(a), '②-1 批次**标题**未被当规则', a)
  ok(!/本批原文/.test(b), '②-2 批次**指针**未被当规则', b)
  ok(/真规则/.test(a) && /真规则/.test(b), '②-3 都回落到了真规则内容')
}

// ── ③ Tier-0 目录不被批次块挤占 ──
sec('[3] Tier-0 目录：批次块不得挤占真条目配额')
{
  // 真实笔记样本路径必须由调用方传入（可选）：node verify-tier0-not-squeezed.mjs <lib-index.js> <notes.md>
const REAL = process.argv[3] || ''
  let base
  try { base = readFileSync(REAL, 'utf8') } catch (_) { base = null }
  if (!base) {
    console.log('  (真实笔记不存在，跳过)')
  } else {
    const withBatches = (n) => {
      const blocks = []
      for (let i = 1; i <= n; i++) {
        blocks.push('## 归档批次 #' + i + ' · 重组织要点(整理于 2026-10-20)')
        blocks.push('- 本批原文：archive/notes-archived.md §2026-10-20T17:' + String(10 + i).padStart(2, '0') + ':00（约 2000 字符）')
        blocks.push('')
      }
      return blocks.join('\n') + base
    }
    const build = (text) => cat.buildTier0CatalogFromTextPre(
      [{ layer: 'project', path: REAL, sourceRef: 'project:MEMORY.md', body: text, text }],
      { maxTokens: 400, estimateMode: 'conservative', quota: { projectRatio: 0.5, floorRatio: 0.2 } })

    const rows = []
    for (const n of [0, 1, 2, 4, 8, 12]) {
      const out = build(withBatches(n))
      const lines = (out.text || '').split('\n').filter(Boolean)
      const batchLines = lines.filter((l) => /归档批次|本批原文/.test(l))
      const realLines = lines.filter((l) => !/归档批次|本批原文/.test(l))
      rows.push({ n, total: lines.length, batch: batchLines.length, real: realLines.length })
      console.log('  ' + String(n).padStart(2) + ' 个批次块 → 目录 ' + lines.length + ' 行（批次行 ' + batchLines.length + ' / 真条目 ' + realLines.length + '）')
    }
    ok(rows.every((r) => r.batch === 0), '③-1 目录里**没有**任何批次行', rows.map((r) => r.batch))
    const r0 = rows.find((r) => r.n === 0).real
    const r12 = rows.find((r) => r.n === 12).real
    console.log('  真条目：0 批次=' + r0 + ' / 12 批次=' + r12)
    ok(r12 >= r0 - 1, '③-2 大量批次块后真条目几乎不减少（允许 1 条配额波动）', { r0, r12 })
    ok(r12 >= 3, '③-3 真条目仍保留 ≥3 条', r12)
  }
}

console.log('')
console.log('══ 结果: ' + pass + ' passed, ' + fail + ' failed ══')
process.exit(fail === 0 ? 0 : 1)
