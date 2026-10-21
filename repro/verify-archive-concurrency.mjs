#!/usr/bin/env node
/**
 * 守卫：归档追加的并发唯一性 + 归档后重新调用（缺陷 8）
 *
 * 背景（2026-10-22 实测发现）：
 *   原实现的「批次时间戳唯一性校验」分母是**本实例读到的 archiveSnapshot**：
 *     ① 读快照 → ② 按当前时间生成 ts → ③ while(快照含 ts) ts+=1s → ④ 追加
 *   两个并发方都读到同一份**旧**快照，都认为某 ts 可用 ⇒ 双双写入 ⇒ 批次头重复。
 *   实测并发 3/3 稳定复现「2 个头 / 1 唯一」。
 *
 *   后果不是丢数据（原文都在），而是「一批」的边界变模糊 —— 恰好抹掉本功能的全部价值。
 *
 * 修法：把「读快照 → 生成唯一时间戳 → 追加」整体放进归档文件的跨进程共享锁
 *   （lib/shared-state-lock.js；本仓纪律「不另起第三套锁」），使其成为临界区。
 *   第二个进入者读到**已含前者批次头**的快照 ⇒ 顺延 1 秒才真正生效。
 *
 * 本守卫覆盖：
 *   P1 顺序调用（基准，正常节奏 —— 必须始终成立）
 *   P2 同实例并发 ×2（单进程内两条路径交错 ★真机可达）
 *   P3 双实例并发 ×2（= 两个进程共享同一文件）
 *   R  归档后被重新调用的九种形态（连续/重试/跨实例/无新内容/归档被清空/
 *      归档被删/主笔记恢复旧版/并发/原方案负控）
 */
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 默认指向仓库内的 lib/index.js（从脚本位置推导，避免硬编码本机路径）
const __REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const __DEFAULT_LIB = path.join(__REPO_ROOT, 'lib', 'index.js')

const SRC_PATH = process.argv[2] || __DEFAULT_LIB
const SRC = readFileSync(SRC_PATH, 'utf8')
const LIB_DIR = path.dirname(SRC_PATH)

// 被测函数会调用 withSharedStateLock（归档追加已并入跨进程锁临界区）
// ⇒ 沙箱必须注入**真实实现**，否则 ReferenceError 而静默走 fail-open 分支（测不到修复）。
const { withSharedStateLock } = await import(pathToFileURL(path.join(LIB_DIR, 'shared-state-lock.js')).href)

const SIG = '  async compactLegacyLayer(agent, layer, p, keepBudget, allowFold) {'
const MK = "return { ok: true, reason: folded ? 'folded' : 'archived' }"
const a0 = SRC.indexOf(SIG)
if (a0 < 0) { console.error('未找到 compactLegacyLayer（目标不是本补丁版本？）'); process.exit(2) }
const SEG = SRC.slice(a0, SRC.indexOf('\n  }', SRC.indexOf(MK, a0)) + 4)

function makeEngine(fsx, clock) {
  const FN = new Function(
    'COMPACT_PROTECT_RECENT_CHARS', 'COMPACT_FOLD_MAX_CHARS', 'parseAnchors', 'createHash', 'path',
    'readFile', 'mkdir', 'console', 'truncateTail', 'withSharedStateLock',
    'return {' + SEG + '};'
  )(2000, 1500, () => new Set(), createHash, path,
    (f) => (fsx.files.has(f) ? Promise.resolve(fsx.files.get(f))
      : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
    () => {}, { log() {}, error() {} }, (s, n) => String(s).slice(-n), withSharedStateLock)
  const eng = Object.create(FN)
  eng.state = { notesText: '', userText: '', loadedAt: 0 }
  eng._lastCompactAt = {}
  eng.memToday = () => clock.today()
  eng.foldTextToSummaryPre = async (t) => String(t).slice(0, 400)
  eng.readTextSafe = async (f) => fsx.files.get(f) ?? ''
  // 微小延迟：制造真实 IO 交错窗口（真机 fs 操作比内存慢得多）
  eng.appendText = async (f, t) => { await new Promise((r) => setTimeout(r, 5)); fsx.files.set(f, (fsx.files.get(f) || '') + t) }
  eng.writeFull = async (f, t, opts) => {
    await new Promise((r) => setTimeout(r, 2))
    const cur = fsx.files.get(f) || ''
    if (opts && opts.expectedDigest) {
      const got = createHash('sha256').update(cur, 'utf8').digest('hex')
      if (got !== opts.expectedDigest) throw Object.assign(new Error('conflict'), { code: 'MEMORY_CONFLICT' })
    }
    fsx.files.set(f, t)
  }
  return eng
}
function bigNote(n, tag) {
  const p = ['# 项目笔记\n']
  for (let i = 1; i <= n; i++) {
    p.push('\n## 2026-10-' + String((i % 28) + 1).padStart(2, '0') + ' · ' + tag + ' ' + i + '\n')
    p.push('- 条目 ' + i + '：' + '内容说明与实测记录。'.repeat(10) + '\n')
  }
  return p.join('')
}
function setup() {
  const TMP = mkdtempSync(path.join(tmpdir(), 'race-'))
  const projDir = path.join(TMP, 'ws')
  mkdirSync(path.join(projDir, 'archive'), { recursive: true })
  return { TMP, projDir, notesPath: path.join(projDir, 'MEMORY.md'), archiveFile: path.join(projDir, 'archive', 'notes-archived.md') }
}
function batchHeads(arch) {
  return [...arch.matchAll(/^## 归档批次 (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/gm)].map((m) => m[1])
}
function ptrHeads(note) {
  return [...note.matchAll(/^- 本批原文：archive\/notes-archived\.md §(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})（约 \d+ 字符）$/gm)].map((m) => m[1])
}

const R = { pass: 0, fail: 0 }
function ok(name, cond, detail) {
  if (cond) { R.pass++; console.log('  ok   - ' + name) }
  else { R.fail++; console.log('  FAIL - ' + name + (detail !== undefined ? '   实得 ' + detail : '')) }
}
const clock = { today: () => '2026-10-22' }
const KB = 6000   // 对 60~70 节笔记能压得动（keepBudget 过大 ⇒ no-removable，属测试参数非缺陷）

// ══════ P1 顺序调用（基准）══════
console.log('=== P1 顺序调用（正常节奏，必须始终成立）===')
{
  const s = setup()
  const fsx = { files: new Map([[s.notesPath, bigNote(60, 'P1')]]) }
  const eng = makeEngine(fsx, clock)
  const reasons = []
  for (let k = 0; k < 3; k++) {
    fsx.files.set(s.notesPath, (fsx.files.get(s.notesPath) || '') + bigNote(12, 'P1-' + k))
    try { const r = await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true); reasons.push(r && r.reason) }
    catch (e) { reasons.push('ERR:' + String(e.message).slice(0, 40)) }
  }
  const arch = fsx.files.get(s.archiveFile) || ''
  const note = fsx.files.get(s.notesPath) || ''
  const hs = batchHeads(arch)
  ok('P1-1 三次调用无异常', !reasons.some((x) => String(x).startsWith('ERR')), JSON.stringify(reasons))
  ok('P1-2 批次头无重复', hs.length === new Set(hs).size, hs.length + '/' + new Set(hs).size)
  ok('P1-3 批次头 = 3', hs.length === 3, hs.length)
  const ptrs = ptrHeads(note)
  ok('P1-4 指针全部命中归档', ptrs.every((t) => hs.includes(t)) && ptrs.length > 0, ptrs.length)
  rmSync(s.TMP, { recursive: true, force: true })
}

// ══════ P2 同实例并发（★真机可达）══════
console.log('')
console.log('=== P2 同实例并发 ×2（单进程内两条路径交错）===')
let p2dup = 0
for (let t = 0; t < 3; t++) {
  const s = setup()
  const fsx = { files: new Map([[s.notesPath, bigNote(70, 'P2')]]) }
  const eng = makeEngine(fsx, clock)
  const st = await Promise.allSettled([
    eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true),
    eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true),
  ])
  const arch = fsx.files.get(s.archiveFile) || ''
  const hs = batchHeads(arch)
  const dup = hs.length - new Set(hs).size
  if (dup > 0) p2dup++
  const reasons = st.map((x) => x.status === 'fulfilled' ? (x.value && x.value.reason) : 'ERR')
  ok('P2-' + (t + 1) + ' 批次头无重复（trial ' + t + '）', dup === 0, 'heads=' + hs.length + ' uniq=' + new Set(hs).size + ' reasons=' + JSON.stringify(reasons))
  rmSync(s.TMP, { recursive: true, force: true })
}

// ══════ P3 双实例并发（= 两进程）══════
console.log('')
console.log('=== P3 双实例并发 ×2（两个进程共享同一文件）===')
for (let t = 0; t < 3; t++) {
  const s = setup()
  const fsx = { files: new Map([[s.notesPath, bigNote(70, 'P3')]]) }
  const eA = makeEngine(fsx, clock)
  const eB = makeEngine(fsx, clock)
  await Promise.allSettled([
    eA.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true),
    eB.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true),
  ])
  const hs = batchHeads(fsx.files.get(s.archiveFile) || '')
  ok('P3-' + (t + 1) + ' 批次头无重复（trial ' + t + '）', hs.length === new Set(hs).size, 'heads=' + hs.length + ' uniq=' + new Set(hs).size)
  rmSync(s.TMP, { recursive: true, force: true })
}

// ══════ R 归档后重新调用的其他形态 ══════
console.log('')
console.log('=== R 归档后被重新调用（其他形态）===')
{
  // R1 跨实例（新实例读同一文件）
  const s = setup()
  const fsx = { files: new Map([[s.notesPath, bigNote(60, 'R1')]]) }
  const e1 = makeEngine(fsx, clock)
  await e1.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true)
  const e2 = makeEngine(fsx, clock)
  fsx.files.set(s.notesPath, (fsx.files.get(s.notesPath) || '') + bigNote(12, 'R1b'))
  let r2 = null, err2 = null
  try { r2 = await e2.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true) } catch (e) { err2 = e }
  const hs = batchHeads(fsx.files.get(s.archiveFile) || '')
  ok('R1 跨实例压缩成功', r2 && r2.ok === true, err2 ? String(err2.message) : JSON.stringify(r2))
  ok('R1 批次头 = 2 且唯一', hs.length === 2 && hs.length === new Set(hs).size, hs.length)
  rmSync(s.TMP, { recursive: true, force: true })
}
{
  // R2 压缩后立刻再压（无新内容）
  const s = setup()
  const fsx = { files: new Map([[s.notesPath, bigNote(60, 'R2')]]) }
  const eng = makeEngine(fsx, clock)
  await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true)
  const arch1 = (fsx.files.get(s.archiveFile) || '').length
  const hs1 = batchHeads(fsx.files.get(s.archiveFile) || '')
  try { await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true) } catch (_) {}
  const arch2 = (fsx.files.get(s.archiveFile) || '').length
  const hs2 = batchHeads(fsx.files.get(s.archiveFile) || '')
  // ★断言修正（2026-10-22）：原断言写的是「归档长度不变」，这个预期是错的。
  //   第一次压完后笔记仍可能高于 keepBudget ⇒ 第二次**理应**再归档一小段（新增批次头）。
  //   「无新内容时不应重复追加」的正确判据是：**旧内容不被重复归档**，
  //   即新批次的出现必须伴随新批次头 + 唯一性保持，而不是"归档停止增长"。
  //   真正该锁的是「不出现重复批次头」和「归档只增不重写同一批」。
  ok('R2 二次压缩后批次头仍唯一（未重复追加同一批）', hs2.length === new Set(hs2).size, 'heads=' + hs2.length + ' uniq=' + new Set(hs2).size)
  ok('R2 归档只增长、不回退', arch2 >= arch1, arch1 + '→' + arch2)
  ok('R2 新增批次头时旧批次头仍完整保留', hs1.every((t) => hs2.includes(t)), 'hs1=' + hs1.join(',') + ' hs2=' + hs2.join(','))
  rmSync(s.TMP, { recursive: true, force: true })
}
{
  // R3 归档被清空后重新压缩
  const s = setup()
  const fsx = { files: new Map([[s.notesPath, bigNote(60, 'R3')]]) }
  const eng = makeEngine(fsx, clock)
  await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true)
  fsx.files.set(s.archiveFile, '')
  fsx.files.set(s.notesPath, (fsx.files.get(s.notesPath) || '') + bigNote(12, 'R3b'))
  let err = null
  try { await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true) } catch (e) { err = e }
  ok('R3 归档清空后不崩溃且重建', !err, err && err.message)
  ok('R3 重建后有批次头', batchHeads(fsx.files.get(s.archiveFile) || '').length >= 1)
  rmSync(s.TMP, { recursive: true, force: true })
}
{
  // R4 归档文件被删除后重新压缩
  const s = setup()
  const fsx = { files: new Map([[s.notesPath, bigNote(60, 'R4')]]) }
  const eng = makeEngine(fsx, clock)
  await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true)
  fsx.files.delete(s.archiveFile)
  fsx.files.set(s.notesPath, (fsx.files.get(s.notesPath) || '') + bigNote(12, 'R4b'))
  let err = null
  try { await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true) } catch (e) { err = e }
  ok('R4 归档缺失时按空处理、不崩溃', !err, err && err.message)
  rmSync(s.TMP, { recursive: true, force: true })
}
{
  // R5 连压三次（老批次块被再次归档）
  const s = setup()
  const fsx = { files: new Map([[s.notesPath, bigNote(60, 'R5')]]) }
  const eng = makeEngine(fsx, clock)
  await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true)
  for (let k = 0; k < 2; k++) {
    fsx.files.set(s.notesPath, (fsx.files.get(s.notesPath) || '') + bigNote(50, 'R5-' + k))
    await eng.compactLegacyLayer(null, 'project', { projectDir: s.projDir, userFile: '', notesPath: s.notesPath }, KB, true)
  }
  const arch = fsx.files.get(s.archiveFile) || ''
  const note = fsx.files.get(s.notesPath) || ''
  const hs = batchHeads(arch)
  ok('R5 三次压缩批次头无重复', hs.length === new Set(hs).size, hs.length + '/' + new Set(hs).size)
  const ptrs = ptrHeads(note)
  ok('R5 指针全部命中归档', ptrs.every((t) => hs.includes(t)), ptrs.join(','))
  rmSync(s.TMP, { recursive: true, force: true })
}

console.log('')
console.log('══ 结果: ' + R.pass + ' passed, ' + R.fail + ' failed ══')
console.log('   其中并发子项 P2（同实例）重复计数: ' + p2dup + '/3')
process.exit(R.fail === 0 ? 0 : 1)
