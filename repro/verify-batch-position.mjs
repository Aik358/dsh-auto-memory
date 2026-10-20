#!/usr/bin/env node
/**
 * 批次块**位置**守卫（2026-10-20 真机发现后新增）。
 *
 * 真机现场：本区首次生产压缩（2026-10-20T20:20:25）产出主笔记的 L1-L2 就是批次块。
 * 当时规则层未被占位（因为已加"批次结构行排除"），但那是**规则层兜住**、不是**位置正确**：
 *   · 缺陷 2 的机制是「规则层取条目第一条实质内容行做摘要」，块在首位时第一条实质行就是指针行；
 *   · 排除逻辑只覆盖 rules-layer 与 tier0-catalog 两个已知消费路径，
 *     任何新增消费路径（上游未来加的、第三方读笔记的）都会重新踩中；
 *   · 而「块在首位」本身没有设计收益：它不进 Tier-0（已排除）、
 *     指针靠 `- 本批原文` 前缀被 grep（与位置无关）。
 *
 * 本守卫锁的是：**批次块必须在保留段之后**，即首个非空行不得是批次标题/指针。
 * 旧实现 `[foldedBlock, keptText]` 会让本守卫变红；新实现 `[keptText, foldedBlock]` 变绿。
 */
import { readFileSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

if (process.argv[2]) {
  try { if (statSync(process.argv[2]).isDirectory()) process.argv[2] = path.join(process.argv[2], 'index.js') } catch (_) {}
}
const SRC_PATH = process.argv[2] || 'G:/AMup/upstream-work/v339/lib/index.js'
const LIB = path.dirname(SRC_PATH)
const SRC = readFileSync(SRC_PATH, 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   - ' + n) } else { fail++; console.log('  FAIL - ' + n + (d !== undefined ? '  实得 ' + JSON.stringify(d).slice(0, 160) : '')) } }
const sec = (t) => console.log('\n=== ' + t + ' ===')

// ── 抽 compactLegacyLayer ──
const SIG = '  async compactLegacyLayer(agent, layer, p, keepBudget, allowFold) {'
const a0 = SRC.indexOf(SIG)
const MARKER = "return { ok: true, reason: folded ? 'folded' : 'archived' }"
const tail = SRC.indexOf(MARKER, a0)
const end = SRC.indexOf('\n  }', tail) + 4
const SEG = SRC.slice(a0, end)
const { parseAnchors } = await import(pathToFileURL(path.join(LIB, 'memory-anchor.js')).href)
const TMP = mkdtempSync(path.join(tmpdir(), 'batch-pos-'))

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

function makeNote(n = 12, per = 14) {
  const out = ['# 项目笔记', '']
  for (let k = 0; k < n; k++) {
    out.push('## 2026-09-' + String((k % 28) + 1).padStart(2, '0') + ' · 条目 ' + k)
    out.push('- 第 ' + k + ' 条内容，' + '填充文字。'.repeat(per))
    out.push('')
  }
  return out.join('\n')
}

sec('[1] 批次块必须在保留段之后（首个非空行不得是批次结构行）')
{
  const projDir = path.join(TMP, 'pos')
  mkdirSync(path.join(projDir, 'archive'), { recursive: true })
  const filePath = path.join(projDir, 'MEMORY.md')
  const note = makeNote()
  const fsx = { files: new Map([[filePath, note]]) }
  const eng = buildEngine(fsx)
  // ★参数说明：keepBudget 越小则回收越多 ⇒ slack 越大 ⇒ 档位越高。
  //   要让档位走到 full（才产指针），需让 deficitHere 足够小、oldText 足够大。
  //   实测：keepBudget = note.length - 1200 时旧文本全部被回收 ⇒ slack=deficitHere≈1200 < legacyFULL(约 130) 才对……
  //   实际 legacyFULL ≈ 93 字符左右，1200 足够 ⇒ 之前落 none 是因为 folded 被清空导致没进分支。
  //   这里用「保留一半」让 folded 与指针都有空间。
  const r = await eng.compactLegacyLayer(null, 'project',
    { projectDir: projDir, userFile: '', notesPath: filePath }, Math.floor(note.length * 0.5), true)
  const after = fsx.files.get(filePath) || ''
  const lines = after.split('\n').filter((l) => l.trim())
  console.log('  压缩结果: ' + JSON.stringify(r))
  console.log('  首个非空行: ' + JSON.stringify(lines[0]))
  console.log('  非空行数: ' + lines.length)
  ok(lines.length > 0, '有内容')
  ok(!/^## 归档批次 /.test(lines[0]), '①-1 首个非空行**不是**批次标题', lines[0])
  ok(!/^- 本批原文：/.test(lines[0]), '①-2 首个非空行**不是**批次指针', lines[0])

  // 批次块仍必须存在（不能为了位置把块丢掉）
  const batchIdx = lines.findIndex((l) => /^## 归档批次 /.test(l))
  ok(batchIdx >= 0, '①-3 批次块仍然存在', batchIdx)
  ok(batchIdx > 0, '①-4 批次块位于**非首位**', batchIdx)
  console.log('  批次块在非空行序号: ' + batchIdx + ' / 共 ' + lines.length)
  // 保留段必须在批次块之前
  const keptFirst = lines.slice(0, batchIdx).join('\n')
  ok(keptFirst.trim().length > 0, '①-5 批次块之前有保留段内容', keptFirst.slice(0, 60))
}

sec('[2] 位置变化不影响功能（指针、可定位、总量）')
{
  const projDir = path.join(TMP, 'func')
  mkdirSync(path.join(projDir, 'archive'), { recursive: true })
  const filePath = path.join(projDir, 'MEMORY.md')
  const archiveFile = path.join(projDir, 'archive', 'notes-archived.md')
  const note = makeNote()
  const fsx = { files: new Map([[filePath, note]]) }
  const eng = buildEngine(fsx)
  // 与第 1 段同参数（保留一半），确保档位能到 full
  await eng.compactLegacyLayer(null, 'project',
    { projectDir: projDir, userFile: '', notesPath: filePath }, Math.floor(note.length * 0.5), true)
  const after = fsx.files.get(filePath) || ''
  const arch = fsx.files.get(archiveFile) || ''

  // 档位判定：full 才有完整指针；min 只有标题 —— 本守卫只要求「指针与位置无关」，
  // 所以先断言档位，再按档位断言指针（min 档无指针属正常设计，不算失败）。
  const hasFullPtr = /^- 本批原文：/.test(after)
  const hasMinTitle = /^## 归档批次 (#\d+)/m.test(after)
  console.log('  档位: ' + (hasFullPtr ? 'full' : hasMinTitle ? 'min' : 'none'))
  ok(hasFullPtr || hasMinTitle, '②-0 至少产出 min 档（不是 none）', { hasFullPtr, hasMinTitle })

  const ptrM = after.match(/^- 本批原文：archive\/notes-archived\.md §(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)（约 (\d+) 字符）$/m)
  ok(hasFullPtr ? !!ptrM : true, '②-1 指针行仍完整（full 档时）', ptrM ? ptrM[0].slice(0, 60) : '(min 档无指针，正常)')
  ok(after.length < note.length, '②-2 主笔记仍变小', { before: note.length, after: after.length })
  if (ptrM) {
    const ts = ptrM[1]
    ok(arch.includes('## 归档批次 ' + ts), '②-3 指针时间戳仍可在归档 grep 到', ts)
  }
  const hdr = arch.match(/^## 归档批次 (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)$/m)
  ok(!!hdr, '②-4 归档批次头仍带严格时间戳', hdr ? hdr[1] : null)
  // 标题仍不含完整时间戳
  ok(!/^## 归档批次[^\n]*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/m.test(after), '②-5 标题仍不含完整时间戳')
}

sec('[3] 规则层与 Tier-0 对"块在末尾"的形态同样免疫')
{
  // 用真实模块跑：构造一个「块在末尾」的笔记，确认两条消费路径都不取批次行
  const note = makeNote(8, 10)
  const withTailBatch = note + '\n\n## 归档批次 #1 · 重组织要点(整理于 2026-10-20)\n- 本批原文：archive/notes-archived.md §2026-10-20T20:25:00（约 900 字符）\n'
  const rules = await import(pathToFileURL(path.join(LIB, 'rules-layer.js')).href)
  const cat = await import(pathToFileURL(path.join(LIB, 'tier0-catalog.js')).href)

  let rulesText = ''
  try {
    const r = rules.extractRulesLayerPre({ rulesLayeringMode: 'all', userText: '', notesText: withTailBatch })
    rulesText = r.text || ''
  } catch (_) {}
  ok(!/本批原文/.test(rulesText), '③-1 规则段不含指针行', rulesText.slice(0, 80))
  ok(!/归档批次/.test(rulesText), '③-2 规则段不含批次标题')

  let catText = ''
  try {
    const out = cat.buildTier0CatalogFromTextPre(
      [{ layer: 'project', path: 'x', sourceRef: 'p', body: withTailBatch, text: withTailBatch }],
      { maxTokens: 400, estimateMode: 'conservative', quota: { projectRatio: 0.5, floorRatio: 0.2 } })
    catText = out.text || ''
  } catch (_) {}
  const catBatch = (catText.split('\n').filter(Boolean)).filter((l) => /归档批次|本批原文/.test(l))
  ok(catBatch.length === 0, '③-3 Tier-0 目录不含批次行', catBatch)
}

console.log('')
console.log('══ 结果: ' + pass + ' passed, ' + fail + ' failed ══')
try { rmSync(TMP, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)
