#!/usr/bin/env node
/**
 * legacy 分支验收（★真实路径）：memoryAnchorEnabled=false 时走的就是 compactLegacyLayer。
 *
 * 背景（2026-10-20 真机验证抓到）：本插件 memoryAnchorEnabled 出厂默认 false，
 * 全部 10 个真实工作区 MEMORY.md 锚点数都是 0 ⇒ 真实部署永远走 legacy 分支。
 * 只改 compactAnchoredLayer 对真实数据零效果。
 *
 * 验收点：
 *   1. 归档出现 `## 归档批次 <完整时间戳>` 批次头
 *   2. 主笔记出现 `## 归档批次 #N · …` 短号标题（进注入目录）
 *   3. full 档：正文带 `- 本批原文：… §<完整时间戳>（约 N 字符）` 指针
 *   4. 历史区标记幂等（重复 compact 只插 1 次）
 *   5. 主笔记确实变小（指针不吃掉腾位）
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SRC_PATH = process.argv[2] || 'G:/AMup/upstream-work/v339/lib/index.js'
const SRC = readFileSync(SRC_PATH, 'utf8')
const SIG = '  async compactLegacyLayer(agent, layer, p, keepBudget, allowFold) {'
const a0 = SRC.indexOf(SIG)
if (a0 < 0) { console.error('找不到 compactLegacyLayer'); process.exit(2) }
// 用下一个同级方法或 return 结尾定位；legacy 函数以 `return { ok: true, reason: folded ? 'folded' : 'archived' }` 结束
const tailIdx = SRC.indexOf("return { ok: true, reason: folded ? 'folded' : 'archived' }", a0)
const end = SRC.indexOf('\n  }', tailIdx) + 4
const SEG = SRC.slice(a0, end)
console.log('抽取 compactLegacyLayer:', SEG.length, '字符')

const PROT = Number(((SRC.match(/const COMPACT_PROTECT_RECENT_CHARS\s*=\s*([^\n]+)/) || [])[1] || '2000').replace(/[^0-9]/g, '')) || 2000
const { parseAnchors } = await import(pathToFileURL(path.join(path.dirname(SRC_PATH), 'memory-anchor.js')).href)
const TMP = mkdtempSync(path.join(tmpdir(), 'legacy-'))
mkdirSync(path.join(TMP, 'memory'), { recursive: true })
const pad = (n) => String(n).padStart(2, '0')

function makeFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    read(p) { return files.get(p) ?? '' },
  }
}

function buildEngine(fsx) {
  const FN = new Function(
    'COMPACT_PROTECT_RECENT_CHARS', 'COMPACT_FOLD_MAX_CHARS', 'parseAnchors', 'createHash', 'path',
    'readFile', 'mkdir', 'pad', 'console', 'truncateTail',
    'return {' + SEG + '};'
  )(PROT, 1500, parseAnchors, createHash, path,
    (f, enc) => {
      if (fsx.files.has(f)) return Promise.resolve(fsx.files.get(f))
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    },
    () => {}, pad, { log() {}, error() {} }, (s, n) => String(s).slice(-n))
  const eng = Object.create(FN)
  eng.state = { notesText: '', userText: '', loadedAt: 0 }
  eng._lastCompactAt = {}
  eng.memToday = () => '2026-10-20'
  eng.foldTextToSummaryPre = async (t) => '[折叠要点] ' + String(t).slice(0, 90).replace(/\n/g, ' ') + '…'
  eng.readTextSafe = async (f) => fsx.read(f)
  eng.appendText = async (f, t) => { fsx.files.set(f, (fsx.files.get(f) || '') + t) }
  eng.writeFull = async (f, t, opts) => {
    const cur = fsx.files.get(f) || ''
    if (opts && opts.expectedDigest) {
      const got = createHash('sha256').update(cur, 'utf8').digest('hex')
      if (got !== opts.expectedDigest) throw Object.assign(new Error('conflict-external-edit'), { code: 'MEMORY_CONFLICT' })
    }
    fsx.files.set(f, t)
  }
  return eng
}

// 造一份**无锚点**的笔记（真实形态：## 日期标题 + 正文，无 <!-- memory: --> ）
function makeLegacyNote(n = 12, per = 12) {
  const out = ['# 项目笔记', '']
  for (let k = 0; k < n; k++) {
    out.push('## 2026-09-' + pad((k % 28) + 1) + ' · 条目 ' + k)
    out.push('- 第 ' + k + ' 条内容，' + '填充文字。'.repeat(per))
    out.push('')
  }
  return out.join('\n')
}

const note = makeLegacyNote(12, 12)
const anchors = (note.match(/<!--\s*memory:/g) || []).length
console.log('构造笔记:', note.length, '字符 | 锚点数:', anchors, anchors === 0 ? '(无锚点 ⇒ legacy 路径 ✓)' : '(★应为 0)')

let pass = 0, fail = 0
const ok = (c, name, detail) => { if (c) { pass++; console.log('  ok   - ' + name) } else { fail++; console.log('  FAIL - ' + name + (detail !== undefined ? '  实得 ' + JSON.stringify(detail).slice(0, 170) : '')) } }

const projDir = path.join(TMP, 'proj')
const filePath = path.join(projDir, 'MEMORY.md')
const archiveFile = path.join(projDir, 'archive', 'notes-archived.md')
const paths = { projectDir: projDir, userFile: path.join(TMP, 'u', 'MEMORY.md'), notesPath: filePath }

console.log('')
console.log('=== [1] full 档：批次头 + 短号标题 + 完整指针 ===')
{
  const fx = makeFs({ [filePath]: note })
  const eng = buildEngine(fx)
  // keepBudget 越小 → 缺口越大 → slack 越小；取中等值让 full 档成立
  const keepBudget = 400
  const r = await eng.compactLegacyLayer(null, 'project', paths, keepBudget, true)
  const after = fx.read(filePath)
  const arch = fx.read(archiveFile)
  console.log('  结果:', JSON.stringify(r), '| 主笔记:', note.length, '->', after.length)
  ok(r && r.ok === true, '1-1 压缩成功', r)
  ok(after.length < note.length, '1-2 主笔记确实变小', { before: note.length, after: after.length })

  const titleM = after.match(/^## 归档批次 (#\d+) · /m)
  const ptrM = after.match(/^- 本批原文：archive\/notes-archived\.md §(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})（约 (\d+) 字符）$/m)
  console.log('  批次标题:', titleM ? titleM[0].trim() : '(无)')
  console.log('  指针行:  ', ptrM ? ptrM[0].trim() : '(无)')
  ok(!!titleM, '1-3 主笔记标题带短号 #N')
  ok(!titleM || !/T\d{2}:\d{2}/.test(titleM[0]), '1-4 标题不含完整时间戳')
  ok(!!ptrM, '1-5 正文带完整时间戳指针')
  ok(/^## 归档批次 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/m.test(arch), '1-6 归档批次头用完整时间戳')
  if (ptrM) ok(arch.includes('## 归档批次 ' + ptrM[1]), '1-7 指针时间戳可在归档 grep 到')
  else ok(false, '1-7 指针时间戳可在归档 grep 到（无指针）')
  const parts = arch.split('## 归档批次 ').filter((x) => x.trim())
  ok(parts.length >= 1 && parts[0].trim().length > 100, '1-8 按批次头可切出该批原文')
}

console.log('')
console.log('=== [2] 折叠被节流（allowFold=false）===')
{
  const fx = makeFs({ [filePath]: note })
  const eng = buildEngine(fx)
  const r = await eng.compactLegacyLayer(null, 'project', paths, 400, false)
  const after = fx.read(filePath)
  ok(r && r.ok === true, '2-1 压缩成功', r)
  ok(/## 归档批次 #\d+ · 已归档\(未折叠\)/.test(after) || /## 归档批次 #\d+ 已归档\(未折叠\)/.test(after), '2-2 出现「已归档(未折叠)」段', after.slice(0, 150))
}

console.log('')
console.log('=== [3] 历史区幂等 ===')
{
  const legacy = '## 2026-09-27\n- 旧内容 A\n'
  const fx = makeFs({ [filePath]: note, [archiveFile]: legacy })
  const eng = buildEngine(fx)
  const kb = Math.max(0, note.length - 800)
  await eng.compactLegacyLayer(null, 'project', paths, kb, true)
  let arch = fx.read(archiveFile)
  const c1 = (arch.match(/archive-legacy/g) || []).length
  ok(c1 === 1, '3-1 首次插入历史区标记恰 1 次', c1)
  ok(arch.indexOf('archive-legacy') < arch.indexOf('旧内容 A'), '3-2 标记位于旧内容之前')
  await eng.compactLegacyLayer(null, 'project', paths, Math.max(0, fx.read(filePath).length - 400), true)
  arch = fx.read(archiveFile)
  const c2 = (arch.match(/archive-legacy/g) || []).length
  ok(c2 === 1, '3-3 第二次 compact 后仍恰 1 次（幂等）', c2)
  ok((arch.match(/^## 归档批次 /gm) || []).length >= 2, '3-4 各批独立成段', (arch.match(/^## 归档批次 /gm) || []).length)
}

console.log('')
console.log('══ 结果: ' + pass + ' passed, ' + fail + ' failed ══')
try { rmSync(TMP, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)
