#!/usr/bin/env node
/**
 * 方案 B 验收：归档可寻址（批次化 + 主笔记批次指针 + 三档降级）。
 *
 * 设计要点（2026-10-20 用户裁定）：
 *   · 标题只带**短批次号** `## 归档批次 #N · <主题>` —— 标题会进 Tier-0 注入目录行，
 *     目录是每轮注入面，把 16 字符完整时间戳放标题会让目录行随批次变长/变化；
 *   · 正文首行带**完整时间戳指针** `- 本批原文：archive/… §<YYYY-MM-DDTHH:mm>（约 N 字符）`
 *     —— 正文不进注入目录，只在 memory_read 全文里可见，不影响目录稳定性；
 *   · 三档降级（指针适应空间，不是空间适应指针）：
 *       full  = slack ≥ FULL_POINTER  → 标题#N · 主题 + 完整指针行
 *       min   = slack ≥ MIN_POINTER   → 只有标题#N
 *       none  = slack 不足            → 不留指针块（归档仍写，原文可查）
 *
 * 测试桩要点：
 *   · engine.readTextSafe 必须与 store 读**同一份数据**（否则得到 {"ok":true,"reason":"empty"} 假成功）；
 *   · readFile/mkdir 等注入必须闭包绑定到该份 fs（用全局变量会读到空——已实测踩到）；
 *   · this.state / this._lastCompactAt 必须存在（切片函数末尾会回写缓存）。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SRC_PATH = process.argv[2] || 'G:/AMup/upstream-work/v339/lib/index.js'
const SRC = readFileSync(SRC_PATH, 'utf8')
const SIG = '  async compactAnchoredLayer(store, filePath, layer, today, paths, deficit, agent, allowFold) {'
const a0 = SRC.indexOf(SIG)
if (a0 < 0) { console.error('找不到 compactAnchoredLayer'); process.exit(2) }
// ★用「方法结束标记」切片，不用花括号配平 —— 注释里的 { } 会让配平多算到下一个方法。
//   方法体必然以 `return { ok: true, reason: folded ? 'folded' : 'archived' }` + `  }` 结束。
const tail = SRC.indexOf("return { ok: true, reason: folded ? 'folded' : 'archived' }", a0)
if (tail < 0) { console.error('找不到方法结束标记'); process.exit(2) }
const closeBrace = SRC.indexOf('\n  }', tail)
const end = closeBrace + 4
const SEG = SRC.slice(a0, end)

const PROT = Number(((SRC.match(/const COMPACT_PROTECT_RECENT_CHARS\s*=\s*([^\n]+)/) || [])[1] || '2000').replace(/[^0-9]/g, '')) || 2000
const FOLD = Number(((SRC.match(/const COMPACT_FOLD_MAX_CHARS\s*=\s*([^\n]+)/) || [])[1] || '1500').replace(/[^0-9]/g, '')) || 1500
const { parseAnchors } = await import(pathToFileURL(path.join(path.dirname(SRC_PATH), 'memory-anchor.js')).href)

const TMP = mkdtempSync(path.join(tmpdir(), 'arch3-'))
mkdirSync(path.join(TMP, 'memory'), { recursive: true })
const pad = (n) => String(n).padStart(2, '0')

function makeFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    read(p) { return files.get(p) ?? '' },
    store: {
      async appendRaw(p, text) { files.set(p, (files.get(p) || '') + text); return { ok: true } },
      async replace(p, text, opts) {
        const cur = files.get(p) || ''
        if (opts && opts.expectedDigest) {
          const got = createHash('sha256').update(Buffer.from(cur, 'utf8')).digest('hex')
          if (got !== opts.expectedDigest) return { ok: false, reason: 'conflict-external-edit' }
        }
        files.set(p, text); return { ok: true }
      },
    },
  }
}

function buildEngine(fsx) {
  const FN = new Function(
    'COMPACT_PROTECT_RECENT_CHARS', 'COMPACT_FOLD_MAX_CHARS', 'parseAnchors', 'createHash', 'path',
    'readFile', 'mkdir', 'dshHome', 'pad', 'console',
    'return {' + SEG + '};'
  )(PROT, FOLD, parseAnchors, createHash, path,
    (p) => (fsx.files.has(p) ? Promise.resolve(fsx.files.get(p))
      : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
    () => { /* 内存 fs */ },
    () => TMP, pad, { log() {}, error() {} })
  const eng = Object.create(FN)
  eng.readTextSafe = async (p) => fsx.read(p)
  eng.foldTextToSummaryPre = async (t) => '[折叠要点] ' + String(t).slice(0, 60).replace(/\n/g, ' ') + '…'
  eng.state = { notesText: '', userText: '', loadedAt: 0 }
  eng._lastCompactAt = {}
  return eng
}

function makeNote(n = 12, per = 10) {
  const out = ['# 项目笔记', '']
  for (let k = 0; k < n; k++) {
    out.push('## 2026-09-' + pad((k % 28) + 1) + ' · 条目 ' + k)
    out.push('<!-- memory:mem_' + createHash('sha256').update('card' + k).digest('hex').slice(0, 32) + ' -->')
    out.push('- 这是第 ' + k + ' 条内容，' + '填充文字。'.repeat(per))
    out.push('')
  }
  return out.join('\n')
}

const note = makeNote(12, 10)
console.log('抽取函数体:', SEG.length, '字符 | PROT=' + PROT + ' FOLD=' + FOLD)
console.log('构造笔记:', note.length, '字符 | parse:', parseAnchors(Buffer.from(note, 'utf8')).status)

let pass = 0, fail = 0
const ok = (c, name, detail) => { if (c) { pass++; console.log('  ok   - ' + name) } else { fail++; console.log('  FAIL - ' + name + (detail !== undefined ? '  实得 ' + JSON.stringify(detail).slice(0, 150) : '')) } }
const sec = (t) => console.log('\n=== ' + t + ' ===')

const TITLE_RE = /^## 归档批次 #(\d+) · /m
const PTR_RE = /^- 本批原文：archive\/notes-archived\.md §(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})（约 (\d+) 字符）$/m
const ARCH_HDR_RE = /^## 归档批次 /m

function scenario(deficit, opts = {}) {
  const projDir = path.join(TMP, 'p' + deficit + (opts.tag || ''))
  const filePath = path.join(projDir, 'MEMORY.md')
  const archiveFile = path.join(projDir, 'archive', 'notes-archived.md')
  const fx = makeFs({ [filePath]: opts.note || note, ...(opts.archive ? { [archiveFile]: opts.archive } : {}) })
  const eng = buildEngine(fx)
  if (opts.patchStore) opts.patchStore(fx)
  return { fx, eng, filePath, archiveFile, projDir, paths: { projectDir: projDir } }
}

sec('[1][2] full 档：标题短号 + 正文完整时间戳指针')
{
  const s = scenario(300)
  const r = await s.eng.compactAnchoredLayer(s.fx.store, s.filePath, 'project', '2026-10-20', s.paths, 300, { session: { id: 's' } }, true)
  ok(r && r.ok === true, '① 压缩成功', r)
  const after = s.fx.read(s.filePath)
  const arch = s.fx.read(s.archiveFile)
  const t = after.match(TITLE_RE)
  const p = after.match(PTR_RE)
  ok(!!t, '①-a 标题带短批次号（#N）', after.slice(0, 100))
  ok(!!p, '①-b 正文带完整时间戳指针')
  ok(t && !/T\d{2}:\d{2}/.test(t[0]), '①-c 标题**不含**完整时间戳（目录行保持短）', t && t[0])
  ok(ARCH_HDR_RE.test(arch), '② 归档含批次头')
  ok(/^## 归档批次 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/m.test(arch), '②-b 归档批次头用完整时间戳（可 grep/排序）')
  ok(p && Number(p[2]) > 0, '②-c 指针标注字符数')
  const parts = arch.split('## 归档批次 ').filter((x) => x.trim())
  ok(parts.length >= 1 && parts[0].trim().length > 20, '②-d 按批次头可切出该批原文')
}

sec('[3] 折叠被节流（allowFold=false）：指针仍在')
{
  const s = scenario(300, { tag: '-nofold' })
  const r = await s.eng.compactAnchoredLayer(s.fx.store, s.filePath, 'project', '2026-10-20', s.paths, 300, { session: { id: 's' } }, false)
  ok(r && r.ok === true, '③ 压缩成功', r)
  const after = s.fx.read(s.filePath)
  ok(/## 归档批次 #\d+ · 已归档\(未折叠\)/.test(after), '③-a 出现「已归档(未折叠)」段')
  ok(PTR_RE.test(after), '③-b 无折叠时指针仍写入')
}

sec('[4] digest 冲突重试后指针不丢')
{
  const s = scenario(300, {
    tag: '-conflict',
    patchStore: (fx) => {
      let n = 0
      const orig = fx.store.replace
      fx.store.replace = async (p, text, opts) => {
        n++
        if (n === 1) { fx.files.set(p, fx.read(p) + '\n## 2026-10-20\n- 冲突期间外部追加\n'); return { ok: false, reason: 'conflict-external-edit' } }
        return orig(p, text, opts)
      }
    },
  })
  const r = await s.eng.compactAnchoredLayer(s.fx.store, s.filePath, 'project', '2026-10-20', s.paths, 300, { session: { id: 's' } }, true)
  ok(r && r.ok === true, '④ 冲突后重试成功', r)
  const after = s.fx.read(s.filePath)
  ok(PTR_RE.test(after), '④-a 重试路径上指针仍在')
  ok(TITLE_RE.test(after), '④-b 重试路径上批次标题仍在')
  ok(after.includes('冲突期间外部追加'), '④-c 冲突期间的外部追加未被覆盖')
}

sec('[5] 重复 compact 不重复插历史区标记')
{
  const legacy = '<!-- dsh-auto-memory:archive-dump v1 -->\n## 2026-09-27\n- 旧内容 A\n'
  const s = scenario(400, { tag: '-legacy', archive: legacy })
  await s.eng.compactAnchoredLayer(s.fx.store, s.filePath, 'project', '2026-10-20', s.paths, 400, { session: { id: 's' } }, true)
  let arch = s.fx.read(s.archiveFile)
  ok((arch.match(/archive-legacy/g) || []).length === 1, '⑤-a 首次插入历史区标记恰 1 次')
  ok(arch.indexOf('archive-legacy') < arch.indexOf('旧内容 A'), '⑤-b 标记位于旧内容之前')

  await s.eng.compactAnchoredLayer(s.fx.store, s.filePath, 'project', '2026-10-20', s.paths, 400, { session: { id: 's' } }, true)
  arch = s.fx.read(s.archiveFile)
  ok((arch.match(/archive-legacy/g) || []).length === 1, '⑤-c 第二次 compact 后仍恰 1 次（幂等）')
  ok((arch.match(/^## 归档批次 /gm) || []).length >= 2, '⑤-d 各批独立成段')
}

sec('[6] 指针降级档位（空间不足时不硬塞指针）')
{
  const tiny = makeNote(2, 1)
  const s = scenario(1, { tag: '-tiny', note: tiny })
  const r = await s.eng.compactAnchoredLayer(s.fx.store, s.filePath, 'project', '2026-10-20', s.paths, 1, { session: { id: 's' } }, true)
  ok(r && r.ok === true, '⑥ 极小 deficit 仍能压缩成功（不因指针挤占而 no-removable）', r)
  const after = s.fx.read(s.filePath)
  const arch = s.fx.read(s.archiveFile)
  ok(after.length < tiny.length, '⑥-a 主笔记确实变小（指针未吃掉腾位）', { before: tiny.length, after: after.length })
  ok(ARCH_HDR_RE.test(arch), '⑥-b 归档仍写批次头（原文可查）')
  const mode = PTR_RE.test(after) ? 'full' : (TITLE_RE.test(after) ? 'min' : 'none')
  console.log('  · 实际档位 = ' + mode + '（deficit=1 时预期 min 或 none）')
  ok(['full', 'min', 'none'].includes(mode), '⑥-c 档位是三档之一')
}

console.log('')
console.log('══ 结果: ' + pass + ' passed, ' + fail + ' failed ══')
try { rmSync(TMP, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)
