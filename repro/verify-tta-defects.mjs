#!/usr/bin/env node
/**
 * TTA 侧发现的三缺陷 —— 修复守卫。
 *
 * 三个缺陷都只在**真实数据 + 连续压缩**下暴露，空归档单次压测测不出来：
 *   缺陷 1：批次短号跳号（#1 → #4 → #6 → #8）
 *   缺陷 2：指针行被当成用户硬性约束注入，真规则整段消失
 *   缺陷 3：同分钟两次压缩产生重复批次头，指针失去唯一性
 *
 * 本脚本对**修复后**的源码必须全绿；对**TTA 验证的那版**（修复前）必须变红。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SRC_PATH = process.argv[2] || 'G:/AMup/upstream-work/v339/lib/index.js'

// ── 缺陷 2 的守卫：规则层（独立模块，直接 import 真实源码）──
const LIB = path.dirname(SRC_PATH)
const rules = await import(pathToFileURL(path.join(LIB, 'rules-layer.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   - ' + n) } else { fail++; console.log('  FAIL - ' + n + (d !== undefined ? '  实得 ' + JSON.stringify(d).slice(0, 170) : '')) } }
const sec = (t) => console.log('\n=== ' + t + ' ===')

// ─────────────────────────────────────────────
sec('[缺陷 2] 指针行不得充当规则摘要（最严重：静默削弱模型行为）')
{
  const fn = rules.ruleSummaryPre || rules.default?.ruleSummaryPre
  ok(typeof fn === 'function', '定位到 ruleSummaryPre 导出')

  // 场景 A：补丁压缩后的真实形态 —— 批次块在主笔记首位
  const withBatch = [
    '## 归档批次 #1 · 重组织要点(整理于 2026-10-20)',
    '- 本批原文：archive/notes-archived.md §2026-10-20T17:13（约 917 字符）',
    '- **背景**：Gitee 仓库 ... 用户裁定方案 A：archive 改回未脱敏的内部存档',
    '- 禁止把密钥写进日志',
  ].join('\n')
  const gotA = fn ? fn(withBatch) : ''
  console.log('  摘要(含批次块) = ' + JSON.stringify(gotA))
  ok(!/本批原文/.test(gotA), '②-1 摘要不含指针行（`- 本批原文：`）', gotA)
  ok(!/归档批次/.test(gotA), '②-2 摘要不含批次标题', gotA)
  ok(/背景|禁止/.test(gotA), '②-3 摘要回落到了**真规则内容**', gotA)

  // 场景 B：无批次块（压缩前）—— 摘要应与 A 一致，证明批次块不影响结论
  const noBatch = [
    '- **背景**：Gitee 仓库 ... 用户裁定方案 A：archive 改回未脱敏的内部存档',
    '- 禁止把密钥写进日志',
  ].join('\n')
  const gotB = fn ? fn(noBatch) : ''
  console.log('  摘要(无批次块) = ' + JSON.stringify(gotB))
  ok(gotA === gotB, '②-4 有无批次块，摘要**完全一致**（A/B 等价）', { withBatch: gotA, without: gotB })

  // 场景 C：只有批次块时不得产出"把指针当规则"
  const onlyBatch = [
    '## 归档批次 #1 · 已归档(未折叠)',
    '- 本批原文：archive/notes-archived.md §2026-10-20T17:13（约 917 字符）',
  ].join('\n')
  const gotC = fn ? fn(onlyBatch) : ''
  console.log('  摘要(仅批次块) = ' + JSON.stringify(gotC))
  ok(!/本批原文/.test(gotC), '②-5 仅批次块时也不把指针当规则', gotC)
}

// ── 缺陷 1/3 的守卫：需要抽取 compactLegacyLayer ──
const SRC = readFileSync(SRC_PATH, 'utf8')
const SIG = '  async compactLegacyLayer(agent, layer, p, keepBudget, allowFold) {'
const a0 = SRC.indexOf(SIG)
const MARKER = "return { ok: true, reason: folded ? 'folded' : 'archived' }"
const tail = SRC.indexOf(MARKER, a0)
const end = SRC.indexOf('\n  }', tail) + 4
const SEG = SRC.slice(a0, end)
const { parseAnchors } = await import(pathToFileURL(path.join(LIB, 'memory-anchor.js')).href)
const TMP = mkdtempSync(path.join(tmpdir(), 'tta-fix-'))

function buildEngine(fsx) {
  const FN = new Function(
    'COMPACT_PROTECT_RECENT_CHARS', 'COMPACT_FOLD_MAX_CHARS', 'parseAnchors', 'createHash', 'path',
    'readFile', 'mkdir', 'console', 'truncateTail',
    'return {' + SEG + '};'
  )(2000, 1500, parseAnchors, createHash, path,
    (f) => (fsx.files.has(f) ? Promise.resolve(fsx.files.get(f))
      : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
    () => {}, { log() {}, error() {} }, (s, n) => String(s).slice(-n))
  const eng = Object.create(FN)
  eng.state = { notesText: '', userText: '', loadedAt: 0 }
  eng._lastCompactAt = {}
  eng.memToday = () => '2026-10-20'
  eng.foldTextToSummaryPre = async (t) => String(t).slice(0, 300)
  eng.readTextSafe = async (f) => fsx.files.get(f) ?? ''
  eng.appendText = async (f, t) => { fsx.files.set(f, (fsx.files.get(f) || '') + t) }
  eng.writeFull = async (f, t, opts) => {
    const cur = fsx.files.get(f) || ''
    if (opts && opts.expectedDigest) {
      const got = createHash('sha256').update(cur, 'utf8').digest('hex')
      if (got !== opts.expectedDigest) throw Object.assign(new Error('conflict'), { code: 'MEMORY_CONFLICT' })
    }
    fsx.files.set(f, t)
  }
  return eng
}

function makeNote(n = 10, per = 12) {
  const out = ['# 项目笔记', '']
  for (let k = 0; k < n; k++) {
    out.push('## 2026-09-' + String((k % 28) + 1).padStart(2, '0') + ' · 条目 ' + k)
    out.push('- 第 ' + k + ' 条内容，' + '填充文字。'.repeat(per))
    out.push('')
  }
  return out.join('\n')
}

// 模拟 TTA 真实归档：含「被再次归档的主笔记标题」这种伪批次头
const FAKE_HEADER_ARCHIVE = [
  '<!-- dsh-auto-memory:archive-legacy 历史区（批次化之前的旧内容，不可按批次定位） -->',
  '',
  '## 2026-09-01',
  '- 很旧的内容 A',
  '',
  '## 归档批次 2026-10-20T17:12:01',
  '## 2026-09-28',
  '- 真批次 1 的内容',
  '',
  '## 归档批次 #1 · 重组织要点(整理于 2026-10-20)',
  '- 这是被再次归档进来的**主笔记标题**（伪头，不该计数）',
  '',
  '## 归档批次 2026-10-20T17:13:22',
  '## 2026-09-29',
  '- 真批次 2 的内容',
  '',
].join('\n')

sec('[缺陷 1] 批次短号只数真批次头（不被"被归档的主笔记标题"污染）')
{
  const projDir = path.join(TMP, 'd1')
  mkdirSync(path.join(projDir, 'archive'), { recursive: true })
  const filePath = path.join(projDir, 'MEMORY.md')
  const archiveFile = path.join(projDir, 'archive', 'notes-archived.md')
  const note = makeNote(10, 12)
  const fsx = { files: new Map([[filePath, note], [archiveFile, FAKE_HEADER_ARCHIVE]]) }
  const eng = buildEngine(fsx)
  await eng.compactLegacyLayer(null, 'project', { projectDir: projDir, userFile: '', notesPath: filePath }, Math.max(0, note.length - 800), true)
  const after = fsx.files.get(filePath) || ''
  const m = after.match(/^## 归档批次 #(\d+)/m)
  const bad = after.match(/^## 归档批次 #(\d+) · 重组织要点/m)
  const no = after.match(/^## 归档批次 #(\d+) 重组织要点/m)
  const num = Number((m || bad || no || [])[1] || 0)
  // 归档里真批次头 = 2（17:12:01、17:13:22），伪头 1 个 ⇒ 新短号应为 3（2+1）
  console.log('  归档真批次头 = 2，伪头(#1 标题) = 1 ⇒ 期望新短号 = 3；实得 #' + num)
  ok(num === 3, '①-1 短号 = 真批次头数 + 1 = 3（不被伪头污染）', num)
  ok(num !== 4, '①-2 不是旧算法的 4（旧算法会把伪头也数进去）', num)

  const archAfter = fsx.files.get(archiveFile) || ''
  const realHeaders = (archAfter.match(/^## 归档批次 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/gm) || []).length
  const anyHeaders = (archAfter.match(/^## 归档批次 /gm) || []).length
  console.log('  压缩后归档：真头=' + realHeaders + ' 任意头=' + anyHeaders)
  ok(realHeaders === anyHeaders || anyHeaders > realHeaders, '①-3 归档同时含真头与伪头（场景成立）')
}

sec('[缺陷 3] 同一秒内两次压缩不得产生重复批次头')
{
  const projDir = path.join(TMP, 'd3')
  mkdirSync(path.join(projDir, 'archive'), { recursive: true })
  const filePath = path.join(projDir, 'MEMORY.md')
  const archiveFile = path.join(projDir, 'archive', 'notes-archived.md')
  const fsx = { files: new Map([[filePath, makeNote(10, 12)]]) }
  const eng = buildEngine(fsx)
  // 连压三次（模拟 ensureBudget 三轮重试，全在同一秒内）
  for (let i = 0; i < 3; i++) {
    const cur = fsx.files.get(filePath) || ''
    await eng.compactLegacyLayer(null, 'project', { projectDir: projDir, userFile: '', notesPath: filePath }, Math.max(0, cur.length - 500), true)
  }
  const arch = fsx.files.get(archiveFile) || ''
  const headers = arch.match(/^## 归档批次 (\S+)$/gm) || []
  const tsList = headers.map((h) => h.replace('## 归档批次 ', ''))
  const uniq = new Set(tsList)
  console.log('  批次头: ' + JSON.stringify(tsList))
  console.log('  唯一: ' + uniq.size + ' / 总数 ' + tsList.length)
  ok(tsList.length >= 2, '③-1 至少产生 2 个批次（场景成立）', tsList.length)
  ok(uniq.size === tsList.length, '③-2 所有批次时间戳唯一（补秒生效）', { list: tsList, uniq: uniq.size })
  ok(tsList.every((t) => /T\d{2}:\d{2}:\d{2}$/.test(t)), '③-3 时间戳格式含秒 HH:mm:ss', tsList)
}

console.log('')
console.log('══ 结果: ' + pass + ' passed, ' + fail + ' failed ══')
try { rmSync(TMP, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)
