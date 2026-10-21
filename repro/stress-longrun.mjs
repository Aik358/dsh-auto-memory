#!/usr/bin/env node
/**
 * 修正版诊断：去掉测试数据里的「假指针」污染
 *
 * 上一版的问题：我用「批次块回放」这种记录形态时，写入了形如
 *   - 本批原文：archive/notes-archived.md §<假时间戳>（约 900 字符）
 * 的假指针，导致诊断把测试数据当真实指针，报出 39 个「未命中」。
 * ⇒ 这是**测试数据缺陷**，不是产品缺陷。
 *
 * 本版：测试数据只含普通工作记录（不含伪造的指针行），
 *       然后检验产品自己产生的每个指针能否在归档命中。
 */
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 本方案 = 仓库自身 lib；原方案（未打补丁的 v3.3.11）= 需调用方指定，或用 git 取出。
const __REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NEW = process.env.NEW_LIB || path.join(__REPO_ROOT, 'lib')
const OLD = process.env.OLD_LIB || ''
if (!OLD) {
  console.error('用法: OLD_LIB=<未打补丁的 lib 目录> node repro/stress-longrun.mjs')
  console.error('  例: git worktree add /tmp/v3311 v3.3.11 && OLD_LIB=/tmp/v3311/lib node repro/stress-longrun.mjs')
  process.exit(2)
}

const SIG = '  async compactLegacyLayer(agent, layer, p, keepBudget, allowFold) {'
const MK = "return { ok: true, reason: folded ? 'folded' : 'archived' }"

async function loadEngine(lib) {
  const src = readFileSync(path.join(lib, 'index.js'), 'utf8')
  const a0 = src.indexOf(SIG)
  const seg = src.slice(a0, src.indexOf('\n  }', src.indexOf(MK, a0)) + 4)
  const { parseAnchors } = await import(pathToFileURL(path.join(lib, 'memory-anchor.js')).href)
  return { seg, parseAnchors }
}
function build(loaded, fsx, clock) {
  const FN = new Function(
    'COMPACT_PROTECT_RECENT_CHARS', 'COMPACT_FOLD_MAX_CHARS', 'parseAnchors', 'createHash', 'path',
    'readFile', 'mkdir', 'console', 'truncateTail',
    'return {' + loaded.seg + '};'
  )(2000, 1500, loaded.parseAnchors, createHash, path,
    (f) => (fsx.files.has(f) ? Promise.resolve(fsx.files.get(f))
      : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
    () => {}, { log() {}, error() {} }, (s, n) => String(s).slice(-n))
  const eng = Object.create(FN)
  eng.state = { notesText: '', userText: '', loadedAt: 0 }
  eng._lastCompactAt = {}
  eng.memToday = () => clock.today()
  eng.foldTextToSummaryPre = async (t) => String(t).slice(0, 420)
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
function d(i) {
  const ms = Date.UTC(2026, 4, 1) + i * 1.5 * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

// 9 种真实记录形态，**不含任何伪造的「本批原文」指针行**
const KINDS = [
  (i) => ['', '## ' + d(i) + ' · 第 ' + i + ' 轮', '- 完成 ' + i + '：' + '实现与验证。'.repeat(18), '- 结论 ' + i + '：' + '实测支持。'.repeat(16)].join('\n'),
  (i) => ['', 'type:progress', '## 账本 · 第 ' + i + ' 段', '- 状态：' + '已完成。'.repeat(20)].join('\n'),
  (i) => ['', '## ' + d(i) + ' 裁定 ' + i, '- 裁定：' + '方案 A，理由充分。'.repeat(18)].join('\n'),
  (i) => ['', '## 命令 ' + i, '- `pnpm run build --filter=p' + i + '`', '- 说明：' + '重建产物。'.repeat(22)].join('\n'),
  (i) => ['', '## 代码 ' + i, '```js', 'function f' + i + '(x) {', '  return x * ' + i, '}', '```', '- 注：' + '边界需注意。'.repeat(18)].join('\n'),
  (i) => ['', '## 背景 ' + i, '较长背景说明，' + '模拟真实笔记的连续性叙述。'.repeat(14), '- 短 A', '- 短 B'].join('\n'),
  (i) => ['', '## 锚点 ' + i, '<!-- memory:mem_' + createHash('md5').update('x' + i).digest('hex') + ' -->', '- 内容：' + '稳定段落。'.repeat(18)].join('\n'),
  (i) => ['', '## Q' + i + '：如何配置 ' + i + '？', 'A：' + '按步骤操作。'.repeat(16)].join('\n'),
  (i) => ['', '## 表 ' + i, '| 指标 | 值 |', '| --- | --- |', '| 通过 | ' + (50 + i) + ' |', '- 备注：' + '第 ' + i + ' 次运行。'.repeat(14)].join('\n'),
]

const CAP = 24000

async function sim(lib, rounds) {
  const loaded = await loadEngine(lib)
  const TMP = mkdtempSync(path.join(tmpdir(), 'clean-'))
  const projDir = path.join(TMP, 'ws')
  mkdirSync(path.join(projDir, 'archive'), { recursive: true })
  const filePath = path.join(projDir, 'MEMORY.md')
  const archiveFile = path.join(projDir, 'archive', 'notes-archived.md')
  let di = 0
  const clock = { today: () => d(di) }
  const fsx = { files: new Map([[filePath, '# 项目笔记\n']]) }
  const eng = build(loaded, fsx, clock)
  let compactions = 0
  const errors = []
  const snaps = []

  for (let i = 1; i <= rounds; i++) {
    di = i
    fsx.files.set(filePath, (fsx.files.get(filePath) || '') + KINDS[(i - 1) % KINDS.length](i))
    if ((fsx.files.get(filePath) || '').length > CAP) {
      try {
        await eng.compactLegacyLayer(null, 'project',
          { projectDir: projDir, userFile: '', notesPath: filePath }, Math.floor(CAP * 0.62), true)
        compactions++
        const note = fsx.files.get(filePath) || ''
        const arch = fsx.files.get(archiveFile) || ''
        snaps.push({
          round: i, n: compactions,
          short: [...note.matchAll(/## 归档批次 (#\d+)/g)].map((m) => parseInt(m[1].slice(1), 10)),
          strict: (arch.match(/^## 归档批次 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/gm) || []).length,
          ptr: (note.match(/^- 本批原文：archive\/notes-archived\.md §\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}（约 \d+ 字符）$/gm) || []).length,
        })
      } catch (e) { errors.push({ round: i, msg: String(e.message).slice(0, 90) }) }
    }
  }
  const r = { compactions, errors, snaps, arch: fsx.files.get(archiveFile) || '', note: fsx.files.get(filePath) || '' }
  rmSync(TMP, { recursive: true, force: true })
  return r
}

const R = 900
console.log('clean 长程测试：' + R + ' 轮 / 9 种形态 / 跨 6 个月（测试数据不含伪造指针）\n')
const A = await sim(OLD, R)
const B = await sim(NEW, R)
console.log('原方案: 压缩 ' + A.compactions + ' 次, 错误 ' + A.errors.length)
console.log('本方案: 压缩 ' + B.compactions + ' 次, 错误 ' + B.errors.length)

console.log('')
console.log('═══ 主笔记短号演化（每次抽 6 次压缩）═══')
console.log('压缩#  短号序列                        归档严格头  笔记指针')
for (let i = 0; i < B.snaps.length; i += 6) {
  const s = B.snaps[i]
  console.log(String(s.n).padStart(4) + '   ' + (s.short.join(',') || '(空)').padEnd(38) + String(s.strict).padStart(8) + String(s.ptr).padStart(10))
}
const last = B.snaps[B.snaps.length - 1]
console.log(String(last.n).padStart(4) + '   ' + (last.short.join(',') || '(空)').padEnd(38) + String(last.strict).padStart(8) + String(last.ptr).padStart(10))

console.log('')
console.log('═══ 核心检验：产品产生的指针 → 归档能否命中 ═══')
const archTimes = new Set([...B.arch.matchAll(/^## 归档批次 (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/gm)].map((m) => m[1]))
const ptrs = [...B.note.matchAll(/^- 本批原文：archive\/notes-archived\.md §(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})（约 (\d+) 字符）$/gm)]
let hit = 0
const missList = []
for (const m of ptrs) { if (archTimes.has(m[1])) hit++; else missList.push(m[1]) }
console.log('  主笔记指针 ' + ptrs.length + ' 个 → 命中 ' + hit + ' / 未命中 ' + missList.length)
if (missList.length) missList.slice(0, 5).forEach((t) => console.log('    ★未命中 ' + t))

console.log('')
console.log('═══ 归档批次头唯一性 ═══')
const hs = [...B.arch.matchAll(/^## 归档批次 (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/gm)].map((m) => m[1])
console.log('  ' + hs.length + ' 个头 / ' + new Set(hs).size + ' 唯一  ⇒ ' + (hs.length === new Set(hs).size ? '全部唯一 ✓' : '★有重复'))

console.log('')
console.log('═══ 归档结构完整性 ═══')
let bad = 0
const hAll = [...B.arch.matchAll(/^## 归档批次 (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/gm)]
for (let i = 0; i < hAll.length; i++) {
  const from = hAll[i].index
  const to = i + 1 < hAll.length ? hAll[i + 1].index : B.arch.length
  if (to - from < 100) { bad++; console.log('  ★过短: ' + hAll[i][1] + ' = ' + (to - from)) }
}
console.log('  批次段 ' + hAll.length + ' 个，过短 ' + bad + ' 个')
console.log('  归档总字符: ' + B.arch.length.toLocaleString())
console.log('  主笔记字符: ' + B.note.length.toLocaleString())

console.log('')
console.log('═══ 对比总结 ═══')
const rows = [
  ['压缩次数', A.compactions, B.compactions],
  ['归档字符', A.arch.length.toLocaleString(), B.arch.length.toLocaleString()],
  ['★归档严格批次头', (A.arch.match(/^## 归档批次 \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/gm) || []).length, hs.length],
  ['主笔记指针（产品产生）', '(无此概念)', ptrs.length],
  ['错误数', A.errors.length, B.errors.length],
]
console.log('维度'.padEnd(28) + '原方案'.padEnd(16) + '本方案')
console.log('-'.repeat(66))
for (const [k, a, b] of rows) console.log(String(k).padEnd(28) + String(a).padEnd(16) + String(b))
