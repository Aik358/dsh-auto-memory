#!/usr/bin/env node
/**
 * 方案 B 验收：归档可寻址（批次化 + 主笔记批次指针）。
 *
 * ★关键修正：engine.readTextSafe 必须读**同一个 store**。
 *   生产里 readTextSafe 读磁盘、store.replace 也写磁盘，是同一份数据；
 *   测试桩若让 readTextSafe 读真实文件而 store 走内存，会得到
 *   `{"ok":true,"reason":"empty"}` 的假成功（已实测踩到）。
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
let depth = 0, i = SRC.indexOf('{', a0), end = -1
for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break } } }
const SEG = SRC.slice(a0, end)

const PROT = Number(((SRC.match(/const COMPACT_PROTECT_RECENT_CHARS\s*=\s*([^\n]+)/) || [])[1] || '2000').replace(/[^0-9]/g, '')) || 2000
const FOLD = Number(((SRC.match(/const COMPACT_FOLD_MAX_CHARS\s*=\s*([^\n]+)/) || [])[1] || '1500').replace(/[^0-9]/g, '')) || 1500

const { parseAnchors } = await import(pathToFileURL(path.join(path.dirname(SRC_PATH), 'memory-anchor.js')).href)
const TMP = mkdtempSync(path.join(tmpdir(), 'arch2-'))
mkdirSync(path.join(TMP, 'memory'), { recursive: true })
const pad = (n) => String(n).padStart(2, '0')
const dshHome = () => TMP

console.log('抽取函数体:', SEG.length, '字符 | PROT=' + PROT + ' FOLD=' + FOLD)

function makeFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  const calls = []
  return {
    files, calls,
    read(p) { return files.get(p) ?? '' },
    store: {
      async appendRaw(p, text) {
        calls.push(['appendRaw', p, text.length])
        files.set(p, (files.get(p) || '') + text)
        return { ok: true }
      },
      async replace(p, text, opts) {
        calls.push(['replace', p, text.length])
        const cur = files.get(p) || ''
        if (opts && opts.expectedDigest) {
          const got = createHash('sha256').update(Buffer.from(cur, 'utf8')).digest('hex')
          if (got !== opts.expectedDigest) return { ok: false, reason: 'conflict-external-edit' }
        }
        files.set(p, text)
        return { ok: true }
      },
      async appendText(p, text) {
        files.set(p, (files.get(p) || '') + text)
        return { ok: true }
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
    (p) => { if (fsx.files.has(p)) return Promise.resolve(fsx.files.get(p)); return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) },
    (p) => { /* 内存 fs */ },
    dshHome, pad, { log() {}, error() {} })
  const eng = Object.create(FN)
  eng.readTextSafe = async (p) => fsx.read(p)            // ★与 store 同源
  eng.foldTextToSummaryPre = async (t) => '[折叠要点] ' + String(t).slice(0, 60).replace(/\n/g, ' ') + '…'
  // 生产里 this.state 是引擎持有态；切片函数末尾会回写 it（notesText/userText 缓存）
  eng.state = { notesText: '', userText: '', loadedAt: 0 }
  eng._lastCompactAt = {}
  return eng
}

function makeNote(n = 12) {
  const out = ['# 项目笔记', '']
  for (let k = 0; k < n; k++) {
    out.push('## 2026-09-' + pad((k % 28) + 1) + ' · 条目 ' + k)
    out.push('<!-- memory:mem_' + createHash('sha256').update('card' + k).digest('hex').slice(0, 32) + ' -->')
    out.push('- 这是第 ' + k + ' 条内容，' + '填充文字。'.repeat(10))
    out.push('')
  }
  return out.join('\n')
}

const note = makeNote(12)
const parsed = parseAnchors(Buffer.from(note, 'utf8'))
console.log('构造笔记:', note.length, '字符 | parse:', parsed.status, '| anchored:', parsed.records.filter((r) => r.kind === 'anchored').length)

const projDir = path.join(TMP, 'proj')
const filePath = path.join(projDir, 'MEMORY.md')
const archiveFile = path.join(projDir, 'archive', 'notes-archived.md')
const paths = { projectDir: projDir }

let pass = 0, fail = 0
const ok = (c, name, detail) => { if (c) { pass++; console.log('  ok   - ' + name) } else { fail++; console.log('  FAIL - ' + name + (detail !== undefined ? '  实得 ' + JSON.stringify(detail).slice(0, 160) : '')) } }
const sec = (t) => console.log('\n=== ' + t + ' ===')
const TS_RE = /^## 归档批次 (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}) · /m
const PTR_RE = /^- 本批原文：archive\/notes-archived\.md §(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})（约 (\d+) 字符）$/m

sec('[1][2] 正常折叠：主笔记指针 + 批次号可在归档 grep')
{
  const fx = makeFs({ [filePath]: note })
  const eng = buildEngine(fx)
  const r = await eng.compactAnchoredLayer(fx.store, filePath, 'project', '2026-10-20', paths, 400, { session: { id: 's' } }, true)
  ok(r && r.ok === true, '① 压缩成功', r)
  const after = fx.read(filePath)
  const arch = fx.read(archiveFile)
  const m = after.match(TS_RE)
  ok(!!m, '①-a 折叠段标题含批次号', after.slice(0, 120))
  const p = after.match(PTR_RE)
  ok(!!p, '①-b 主笔记出现指针行')
  ok(m && p && m[1] === p[1], '①-c 标题批次号与指针批次号一致', { title: m && m[1], ptr: p && p[1] })
  ok(m && arch.includes('## 归档批次 ' + m[1]), '② 批次号能在归档 grep 到')
  if (m) {
    const mine = arch.split('## 归档批次 ').find((s) => s.startsWith(m[1]))
    ok(!!mine && mine.trim().length > 20, '②-b 按批次号可切出该批原文')
  }
  ok(p && Number(p[2]) > 0, '②-c 指针标注字符数', p && p[2])
}

sec('[3] 折叠被节流（allowFold=false）：指针仍在')
{
  const fx = makeFs({ [filePath]: note })
  const eng = buildEngine(fx)
  const r = await eng.compactAnchoredLayer(fx.store, filePath, 'project', '2026-10-20', paths, 400, { session: { id: 's' } }, false)
  ok(r && r.ok === true, '③ 压缩成功', r)
  const after = fx.read(filePath)
  ok(/## 归档批次 \d{4}-\d{2}-\d{2}T\d{2}:\d{2} · 已归档\(未折叠\)/.test(after), '③-a 出现「已归档(未折叠)」段')
  ok(PTR_RE.test(after), '③-b 无折叠时指针仍写入')
}

sec('[4] digest 冲突重试后指针不丢')
{
  const fx = makeFs({ [filePath]: note })
  const eng = buildEngine(fx)
  let n = 0
  const origReplace = fx.store.replace
  fx.store.replace = async (p, text, opts) => {
    n++
    if (n === 1) { fx.files.set(p, fx.read(p) + '\n## 2026-10-20\n- 冲突期间外部追加\n'); return { ok: false, reason: 'conflict-external-edit' } }
    return origReplace(p, text, opts)
  }
  const r = await eng.compactAnchoredLayer(fx.store, filePath, 'project', '2026-10-20', paths, 400, { session: { id: 's' } }, true)
  ok(r && r.ok === true, '④ 冲突后重试成功', r)
  const after = fx.read(filePath)
  ok(PTR_RE.test(after), '④-a 重试路径上指针仍在')
  ok(TS_RE.test(after), '④-b 重试路径上批次标题仍在')
  ok(after.includes('冲突期间外部追加'), '④-c 冲突期间的外部追加未被覆盖')
}

sec('[5] 重复 compact 不重复插历史区标记')
{
  const legacy = '<!-- dsh-auto-memory:archive-dump v1 -->\n## 2026-09-27\n- 旧内容 A\n'
  const fx = makeFs({ [filePath]: note, [archiveFile]: legacy })
  const eng = buildEngine(fx)
  await eng.compactAnchoredLayer(fx.store, filePath, 'project', '2026-10-20', paths, 400, { session: { id: 's' } }, true)
  let arch = fx.read(archiveFile)
  const c1 = (arch.match(/archive-legacy/g) || []).length
  ok(c1 === 1, '⑤-a 首次插入历史区标记恰 1 次', c1)
  ok(arch.indexOf('archive-legacy') < arch.indexOf('旧内容 A'), '⑤-b 标记位于旧内容之前')

  await eng.compactAnchoredLayer(fx.store, filePath, 'project', '2026-10-20', paths, 400, { session: { id: 's' } }, true)
  arch = fx.read(archiveFile)
  const c2 = (arch.match(/archive-legacy/g) || []).length
  ok(c2 === 1, '⑤-c 第二次 compact 后标记仍恰 1 次（幂等）', c2)
  const batches = (arch.match(/^## 归档批次 /gm) || []).length
  ok(batches >= 2, '⑤-d 各批独立成段（批次头 ≥ 2）', batches)
}

console.log('')
console.log('══ 结果: ' + pass + ' passed, ' + fail + ' failed ══')
try { rmSync(TMP, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)
