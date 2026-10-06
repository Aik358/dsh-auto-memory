/**
 * smoke-test-compaction-concurrency —— 压缩等待窗口内的并发写入（#225，批 B-1 验收）
 *
 * 缺陷（line-B-report #225）：compactAnchoredLayer 读快照 → 等模型折叠（秒级）→ 整篇回写，
 *   回写**不带 expectedDigest** ⇒ 等待期间被调用方判为「已写入成功」的新记录既不在主文件、
 *   也不在归档，静默丢失。
 *
 * 契约：
 *   ① 无并发写入时压缩照常成功（回收最早记录、最新记录保留、原文进归档）；
 *   ② 等待窗口内 store.append 成功 ⇒ 该记录**压缩后仍在主文件**（禁止静默丢失）；
 *   ③ 外部编辑（非经 store）⇒ 同样不得被覆盖；
 *   ④ 归档文件存在且含被回收记录的原文（保底不丢）。
 *
 * 手法：真 MemoryEngine + 真 MemoryDocumentStore + 真 store.append，fold 用挂起闸门放大窗口。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const root = await mkdtemp(path.join(tmpdir(), 'dam-compaction-cas-'))
process.env.DSH_HOME = path.join(root, '.dsh')
process.env.HOME = root
process.env.USERPROFILE = root
const { MemoryEngine } = await import('../lib/audit-engine.mjs')
const { MemoryDocumentStore } = await import('../../lib/memory-writer.js')
try {
  for (const external of [false, true]) {
    const engine = new MemoryEngine()
    const projectDir = path.join(root, external ? 'external' : 'append')
    await fs.mkdir(projectDir, { recursive: true })
    const file = path.join(projectDir, 'MEMORY.md')
    const store = new MemoryDocumentStore({ backupDir: path.join(root, 'backups') })
    await store.append(file, '## OLD_NOTE\nPrior reusable information.')
    await store.append(file, '## LATEST_NOTE\nLatest reusable information.')
    let enter, resume
    const entered = new Promise(resolve => { enter = resolve })
    const paused = new Promise(resolve => { resume = resolve })
    engine.foldTextToSummaryPre = async () => { enter(); await paused; return '' }
    const pending = engine.compactAnchoredLayer(store, file, 'note', '2026-10-05', { projectDir }, 1, null, true)
    await entered
    if (external) await fs.appendFile(file, '\nEXTERNAL_USER_EDIT\n')
    else assert.equal((await store.append(file, '## CONCURRENT_NEW_NOTE\nAccepted while folding.')).ok, true)
    resume()
    const result = await pending
    const fresh = await fs.readFile(file, 'utf8')
    const marker = external ? 'EXTERNAL_USER_EDIT' : 'CONCURRENT_NEW_NOTE'
    // ②/③ 核心：等待窗口内落盘的内容必须仍在（压缩成功→重算重试保留；压缩放弃→文件未变）
    assert.ok(fresh.includes(marker), 'accepted write during fold must survive compaction, reason=' + JSON.stringify(result))
    assert.ok(fresh.includes('LATEST_NOTE'), 'latest record is the hard floor and must remain')
    if (result.ok) assert.ok(!fresh.includes('OLD_NOTE'), 'successful compaction still reclaims the oldest record')
    else assert.match(result.reason, /conflict|replace-failed/, 'failure must be a visible conflict, got ' + JSON.stringify(result))
    const archive = await fs.readFile(path.join(projectDir, 'archive', 'notes-archived.md'), 'utf8')
    assert.ok(archive.includes('OLD_NOTE'), 'reclaimed record must be archived verbatim (no silent loss)')
  }

  /* ① 无并发写入：压缩照常成功（不得因为加了 CAS 就整条路径失效） */
  {
    const engine = new MemoryEngine()
    const projectDir = path.join(root, 'quiet')
    await fs.mkdir(projectDir, { recursive: true })
    const file = path.join(projectDir, 'MEMORY.md')
    const store = new MemoryDocumentStore({ backupDir: path.join(root, 'backups') })
    await store.append(file, '## QUIET_OLD\n' + 'x'.repeat(400))
    await store.append(file, '## QUIET_LATEST\n' + 'y'.repeat(120))
    engine.foldTextToSummaryPre = async () => ''
    const r = await engine.compactAnchoredLayer(store, file, 'note', '2026-10-05', { projectDir }, 1, null, true)
    assert.equal(r.ok, true, 'quiet compaction must succeed: ' + JSON.stringify(r))
    const fresh = await fs.readFile(file, 'utf8')
    assert.ok(fresh.includes('QUIET_LATEST'), 'latest record kept')
    assert.ok(!fresh.includes('QUIET_OLD'), 'oldest record reclaimed')
    console.log('PASS compaction preserves accepted appends and external edits; safe retry succeeds')
  }
} finally { await rm(root, { recursive: true, force: true }) }
