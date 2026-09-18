#!/usr/bin/env node
/**
 * Issue #56 回归:幂等缓存在落盘**之前**登记 id → 一次写失败后同 id 进程内重试恒被拒。
 *
 * 根因(修前):`append()` 先 `this._appended.add(id)` 再把 `_writeLine` 挂进串行链;
 *   `_writeLine` 失败只 `stats.writeFailed++` 并 return false,**没有任何路径把 id 移出缓存**
 *   (唯一清理在 dispose)。此后同 evidenceId 的重试在幂等判定处命中 ⇒ 恒 `duplicate-evidence`
 *   ⇒ 一次 EDQUOT/EBUSY/杀软占用(Windows 现实存在)就让这条证据在进程生命周期内永久丢失。
 *
 * 修复口径:**登记时机不变**(仍在入链前,保住 in-flight 去重),**失败时回滚登记**。
 * 因此本套件同时锁死两侧:
 *   A. 写失败 → 故障恢复后同 id 重试成功,且磁盘只有一条(修前失败:恒 duplicate)。
 *   B. 写成功后同 id 仍被 duplicate 拒(幂等语义不回归)。
 *   C. 不 await 的并发同 id 第二次仍被 duplicate 拒(不得因修复引入重复落盘)。
 *   D. BoundedIdSet.delete 的语义(存在性/大小/不破坏 FIFO 淘汰序)。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

process.env.DSH_HOME = mkdtempSync(path.join(tmpdir(), 'dam-issue56-home-'))

const { EvidenceEventStore } = await import('../../lib/evidence-store.js')
const CB = await import('../../lib/context-bridge.js')

const mem1 = 'mem_' + 'aa'.repeat(16)
function mkEv(over = {}) {
  return CB.createAccessEvidencePre({
    kind: over.kind || 'read', memoryId: over.memoryId || mem1, anchorId: 'memory:' + (over.memoryId || mem1),
    scope: over.scope || 'Workspace', workspaceKey: over.workspaceKey || 'C:\\wsA',
    sessionId: over.sessionId || 'sess-A', eventSeq: 3, contextVersion: 5,
    ts: 1700000000000, sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: 2,
    fileDigest: 'e'.repeat(64), recordDigest: 'c'.repeat(64),
  }).evidence
}
let seq = 0
/** 每次给唯一 evidenceId(与 m52 同法:复用同一实例才谈得上"同 id 重试")。 */
function freshEv() { seq += 1; return mkEv({ memoryId: 'mem_' + String(seq).padStart(2, 'a').repeat(16) }) }
const linesOnDisk = (eventsDir) => {
  let files = []
  try { files = readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl')) } catch (_) { return 0 }
  let n = 0
  for (const f of files) n += readFileSync(path.join(eventsDir, f), 'utf8').split('\n').filter((l) => l.trim()).length
  return n
}

/** 起一个 store,并把 events 目录位置先占成一个**文件** ⇒ 头几次写入必然抛错。 */
function makeBlockedStore() {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'dam-issue56-')), 'evidence')
  const eventsDir = path.join(root, 'events')
  mkdirSync(eventsDir, { recursive: true })
  const store = new EvidenceEventStore({ root })
  // 制造瞬时故障:目录改名成文件(mkdirSync → EEXIST,appendFile → ENOTDIR/ENOENT)
  rmSync(eventsDir, { recursive: true, force: true })
  writeFileSync(eventsDir, 'locked-by-antivirus', 'utf8')
  return { store, eventsDir }
}
const unblock = (eventsDir) => {
  rmSync(eventsDir, { force: true })
  mkdirSync(eventsDir, { recursive: true })
}

test('A1 写入失败:append 如实回报 write-failed', async () => {
  const { store, eventsDir } = makeBlockedStore()
  const ev = freshEv()
  const r1 = await store.append(ev)
  assert.equal(r1.ok, false, '失败不得伪装成成功')
  assert.equal(r1.reason, 'write-failed')
  assert.equal(r1.evidenceId, ev.evidenceId)
  assert.equal(store.stats.writeFailed, 1, 'writeFailed 计账')
  assert.equal(store.stats.appended, 0, '未落盘不得计 appended')
  unblock(eventsDir)
})

test('A2 ★故障恢复后同 evidenceId 重试必须成功(修前恒 duplicate-evidence)', async () => {
  const { store, eventsDir } = makeBlockedStore()
  const ev = freshEv()
  const r1 = await store.append(ev)
  assert.equal(r1.ok, false, '夹具:第一次写失败')
  unblock(eventsDir)
  const r2 = await store.append(ev)
  assert.equal(r2.ok, true, '★重试成功(修复前:reason=duplicate-evidence)')
  assert.equal(store.stats.duplicates, 0, '失败重试不得被计成 duplicate')
  assert.equal(store.loadEvents().events.length, 1, '磁盘恰好一条')
  assert.equal(linesOnDisk(eventsDir), 1, '同一条不重复落盘')
})

test('A3 连续多次瞬时失败后仍可在恢复时补上(不是一次性豁免)', async () => {
  const { store, eventsDir } = makeBlockedStore()
  const ev = freshEv()
  assert.equal((await store.append(ev)).ok, false)
  assert.equal((await store.append(ev)).ok, false, '仍处故障期 → 第二次也失败(且不报 duplicate)')
  unblock(eventsDir)
  assert.equal((await store.append(ev)).ok, true, '恢复后补写成功')
  assert.equal(store.loadEvents().events.length, 1, '三条尝试只落一条')
})

test('A4 失败回滚不牵连其它 id:另一条已成功的证据仍被 duplicate 拦', async () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'dam-issue56-')), 'evidence')
  const store = new EvidenceEventStore({ root })
  const good = freshEv()
  assert.equal((await store.append(good)).ok, true, '夹具:第一条正常落盘')
  // 瞬时故障:把写入目标临时指向"被同名文件占住"的路径(等价于一次 EBUSY/EDQUOT),
  // 不用 rm 真目录 —— 否则连已落盘的那条一起删掉,断言就变成了测夹具自己。
  const blockedDir = path.join(root, 'blocked-by-file')
  writeFileSync(blockedDir, 'locked-by-antivirus', 'utf8')
  const realEventsDir = store.eventsDir
  store.eventsDir = blockedDir
  const blocked = freshEv()
  assert.equal((await store.append(blocked)).ok, false, '夹具:第二条写失败')
  store.eventsDir = realEventsDir
  assert.equal((await store.append(good)).reason, 'duplicate-evidence', '已落盘的好证据仍被幂等拦(回滚不得越界)')
  assert.equal((await store.append(blocked)).ok, true, '失败的这条可补写')
  assert.equal(store.loadEvents().events.length, 2, '两条各一条')
})

test('B1 写成功后同 id 仍判 duplicate(幂等语义不回归)', async () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'dam-issue56-')), 'evidence')
  const store = new EvidenceEventStore({ root })
  const ev = freshEv()
  assert.equal((await store.append(ev)).ok, true)
  const dup = await store.append(ev)
  assert.equal(dup.ok, false)
  assert.equal(dup.reason, 'duplicate-evidence')
  assert.equal(store.stats.duplicates, 1)
  assert.equal(store.loadEvents().events.length, 1)
})

test('C1 in-flight 并发同 id:第二次必须被拒(不得重复落盘)', async () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'dam-issue56-')), 'evidence')
  const store = new EvidenceEventStore({ root })
  const ev = freshEv()
  const p1 = store.append(ev)
  const p2 = store.append(ev) // 不 await 第一条 ⇒ 第一条仍在链上排队/执行
  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r1.ok, true)
  assert.equal(r2.ok, false, '★并发窗口内同 id 仍只落一次')
  assert.equal(r2.reason, 'duplicate-evidence')
  assert.equal(store.loadEvents().events.length, 1)
})

test('D1 BoundedIdSet.delete:命中即移出、size 递减、不影响 FIFO 淘汰序', () => {
  const s = new CB.BoundedIdSet(2)
  s.add('a'); s.add('b')
  assert.equal(s.has('a'), true)
  assert.equal(s.delete('a'), true, 'delete 返回是否命中')
  assert.equal(s.has('a'), false)
  assert.equal(s.size, 1)
  assert.equal(s.delete('a'), false, '重复 delete 不误报命中')
  s.add('c'); s.add('d') // 容量 2:{b,c} → 加 d 时按插入序淘汰最旧的 b
  assert.deepEqual([s.has('b'), s.has('c'), s.has('d')], [false, true, true], '淘汰序仍按插入顺序(delete 不把它打乱)')
})

console.log('\nissue56-evidence-write-retry: done')
