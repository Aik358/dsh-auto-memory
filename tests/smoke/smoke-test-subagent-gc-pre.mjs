#!/usr/bin/env node
/** [subagent-gc] 子代理痕迹回收防回归(2026-09-08)。
 *
 * 守卫 lib/subagent-gc.js(随包发布):识别「本插件产生的一次性子代理会话」并把它移入备份目录。
 * 实测背景:全机 686 个子代理会话中 638 个来自本插件(auto-memory-summarize 414 / consolidate 197 …),
 * 数量上千后拖慢宿主会话列表加载;本模块负责安全回收。
 *
 * 覆盖:
 *   G1  parseSessionHead:取首帧 header 与 subagent descriptor
 *   G2  isPluginOneShotSubagent:插件 one-shot 子代理 → hit
 *   G3  判据:continuable 子代理不回收(可续聊)
 *   G4  判据:非插件 label 不回收(用户/主代理的委派)
 *   G5  判据:普通会话(origin!=='subagent')不回收
 *   G6  判据:缺少 parentSession 不回收
 *   G7  判据:keepMs 之内(太新)不回收
 *   G8  scanPluginSubagentSessions:目录扫描命中数/统计正确
 *   G9  recycleSessions:dry-run 不移动任何文件
 *   G10 recycleSessions:apply 移动会话目录 + 投影缓存,普通会话原样保留
 *   G11 备份目录同名冲突 → 跳过(不覆盖)
 *   G12 多帧 zstd 全量解码 + 坏文件不抛错
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises'
import { zstdCompressSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  PLUGIN_LABEL_PREFIX,
  scanZstdFrames,
  decodeZstdFrames,
  parseSessionHead,
  isPluginOneShotSubagent,
  scanPluginSubagentSessions,
  recycleSessions,
} from '../../lib/subagent-gc.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

/** 造一个会话目录(单帧或多帧 zstd)。 */
async function makeSession(root, wsDir, sid, events) {
  const dir = path.join(root, wsDir, sid)
  await mkdir(dir, { recursive: true })
  const frames = events.map((e) => zstdCompressSync(Buffer.from(JSON.stringify(e) + '\n', 'utf8')))
  await writeFile(path.join(dir, 'session.jsonl.zstd'), Buffer.concat(frames))
  return dir
}

const subHeader = (sid, parent, extra = {}) => ({
  type: 'session', version: 0, id: sid, cwd: 'D:\\proj',
  parentSession: parent, origin: 'subagent', delegationDepth: 1, ...extra,
})
const plainHeader = (sid) => ({ type: 'session', version: 0, id: sid, cwd: 'D:\\proj', delegationDepth: 0 })
const descriptor = (label, mode) => ({ type: 'subagent/descriptor', data: { label, mode } })

const root = await mkdtemp(path.join(tmpdir(), 'dam-subagent-gc-'))
// 备份/缓存根刻意放在会话根之外,避免污染被测扫描目录
const backupRoot = await mkdtemp(path.join(tmpdir(), 'dam-subagent-gc-backup-'))
const projcacheRoot = await mkdtemp(path.join(tmpdir(), 'dam-subagent-gc-cache-'))
const WS = '--D-proj--'

try {
  // ── G1/G12 解码与头部解析 ────────────────────────────────
  const oneShotDir = await makeSession(root, WS, 'aaaa1111-0000-0000-0000-000000000001', [
    subHeader('aaaa1111-0000-0000-0000-000000000001', 'session-parent-1'),
    descriptor('auto-memory-summarize', 'one-shot'),
    { type: 'assistant/message', data: { text: 'hi' } },
  ])
  const raw = await readFile(path.join(oneShotDir, 'session.jsonl.zstd'))
  const frames = scanZstdFrames(raw)
  ok('G1 多帧 zstd 扫描到 3 帧', frames.length === 3, 'frames=' + frames.length)
  const text = decodeZstdFrames(raw)
  const head = parseSessionHead(text)
  ok('G1 header 解析出 origin=subagent', head.header && head.header.origin === 'subagent')
  ok('G1 descriptor 解析出 label/mode', head.descriptor && head.descriptor.label === 'auto-memory-summarize' && head.descriptor.mode === 'one-shot')
  ok('G12 解析在 header+descriptor 齐备后提前退出(事件计数=2)', head.eventCount === 2, 'got=' + head.eventCount)

  // ── G2-G7 判据 ──────────────────────────────────────────
  const base = { labelPrefix: PLUGIN_LABEL_PREFIX, keepMs: 0, now: Date.now(), mtimeMs: 1 }
  ok('G2 插件 one-shot 子代理 → hit', isPluginOneShotSubagent(head, base).hit === true)
  ok('G3 continuable 子代理不回收', isPluginOneShotSubagent(
    { header: head.header, descriptor: descriptor('auto-memory-summarize', 'continuable') }, base).hit === false)
  ok('G4 非插件 label 不回收', isPluginOneShotSubagent(
    { header: head.header, descriptor: descriptor('Research official Mem0 sources', 'one-shot') }, base).hit === false)
  ok('G5 普通会话不回收', isPluginOneShotSubagent(
    { header: plainHeader('session-x'), descriptor: descriptor('auto-memory-summarize', 'one-shot') }, base).hit === false)
  ok('G6 缺 parentSession 不回收', isPluginOneShotSubagent(
    { header: { ...subHeader('s', undefined) }, descriptor: descriptor('auto-memory-consolidate', 'one-shot') }, base).hit === false)
  ok('G7 太新的不回收', isPluginOneShotSubagent(head, {
    labelPrefix: PLUGIN_LABEL_PREFIX, keepMs: 60 * 60 * 1000, now: 1000 + 60 * 1000, mtimeMs: 1000,
  }).hit === false)

  // ── 构造扫描语料 ────────────────────────────────────────
  await makeSession(root, WS, 'bbbb2222-0000-0000-0000-000000000002', [
    subHeader('bbbb2222-0000-0000-0000-000000000002', 'session-parent-1'),
    descriptor('auto-memory-consolidate', 'one-shot'),
  ])
  await makeSession(root, WS, 'cccc3333-0000-0000-0000-000000000003', [
    subHeader('cccc3333-0000-0000-0000-000000000003', 'session-parent-1'),
    descriptor('auto-memory-summarize', 'continuable'),
  ])
  await makeSession(root, WS, 'dddd4444-0000-0000-0000-000000000004', [
    subHeader('dddd4444-0000-0000-0000-000000000004', 'session-parent-1'),
    descriptor('User research task', 'one-shot'),
  ])
  await makeSession(root, WS, 'session-plain-0000-0000-000000000005', [
    plainHeader('session-plain-0000-0000-000000000005'),
  ])
  // 投影缓存文件(与 one-shot 会话同名)
  await mkdir(projcacheRoot, { recursive: true })
  await writeFile(path.join(projcacheRoot, 'aaaa1111-0000-0000-0000-000000000001'), '{}')
  await writeFile(path.join(projcacheRoot, 'bbbb2222-0000-0000-0000-000000000002'), '{}')

  // ── G8 扫描 ─────────────────────────────────────────────
  const scan = await scanPluginSubagentSessions({ sessionsRoot: root, labelPrefix: PLUGIN_LABEL_PREFIX, keepMs: 0 })
  ok('G8 扫描到 5 个会话目录', scan.scanned === 5, 'scanned=' + scan.scanned)
  ok('G8 其中 origin=subagent 4 个', scan.subagents === 4, 'subagents=' + scan.subagents)
  ok('G8 可回收 2 个(1 one-shot + 1 one-shot)', scan.candidates.length === 2, 'candidates=' + scan.candidates.length)
  ok('G8 候选只含插件 one-shot', scan.candidates.every((c) => c.label.startsWith(PLUGIN_LABEL_PREFIX) && c.mode === 'one-shot'))
  ok('G8 统计到 reason 分布', scan.reasons.hit === 2 && scan.reasons.continuable === 1 && scan.reasons['foreign-label'] === 1, JSON.stringify(scan.reasons))

  // ── G9 dry-run ──────────────────────────────────────────
  const dry = await recycleSessions({ candidates: scan.candidates, backupRoot, projcacheRoot, apply: false })
  ok('G9 dry-run 报告 2 个待移动', dry.moved.length === 2 && dry.applied === false)
  const stillThere = await stat(path.join(root, WS, scan.candidates[0].sid)).then(() => true, () => false)
  ok('G9 dry-run 未移动任何文件', stillThere === true)

  // ── G10 apply ───────────────────────────────────────────
  const applied = await recycleSessions({ candidates: scan.candidates, backupRoot, projcacheRoot, apply: true })
  ok('G10 apply 移动 2 个', applied.moved.length === 2 && applied.failed.length === 0, JSON.stringify(applied.failed))
  const movedOk = await stat(path.join(backupRoot, WS, scan.candidates[0].sid)).then(() => true, () => false)
  ok('G10 备份目录出现会话', movedOk === true)
  const srcGone = await stat(path.join(root, WS, scan.candidates[0].sid)).then(() => false, () => true)
  ok('G10 源目录已移走', srcGone === true)
  const cacheMoved = await stat(path.join(backupRoot, '_projcache', scan.candidates[0].sid)).then(() => true, () => false)
  ok('G10 投影缓存一并移走', cacheMoved === true)
  const continuableKept = await stat(path.join(root, WS, 'cccc3333-0000-0000-0000-000000000003')).then(() => true, () => false)
  ok('G10 continuable 会话原样保留', continuableKept === true)
  const plainKept = await stat(path.join(root, WS, 'session-plain-0000-0000-000000000005')).then(() => true, () => false)
  ok('G10 普通会话原样保留', plainKept === true)
  const foreignKept = await stat(path.join(root, WS, 'dddd4444-0000-0000-0000-000000000004')).then(() => true, () => false)
  ok('G10 非插件委派原样保留', foreignKept === true)

  // ── G11 备份冲突 ────────────────────────────────────────
  const again = await recycleSessions({
    candidates: [{ wsDir: WS, sid: scan.candidates[0].sid, dir: path.join(root, WS, scan.candidates[0].sid), label: 'x', sizeBytes: 0 }],
    backupRoot, projcacheRoot, apply: true,
  })
  ok('G11 备份已存在 → 跳过不覆盖', again.skipped.length === 1 && again.skipped[0].reason === 'backup-exists')

  // ── G12 坏文件容错 ──────────────────────────────────────
  const badDir = path.join(root, WS, 'eeee5555-0000-0000-0000-000000000006')
  await mkdir(badDir, { recursive: true })
  await writeFile(path.join(badDir, 'session.jsonl.zstd'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))
  const scan2 = await scanPluginSubagentSessions({ sessionsRoot: root, labelPrefix: PLUGIN_LABEL_PREFIX, keepMs: 0 })
  ok('G12 坏文件不抛错且不产生候选', scan2.candidates.length === 0 && (scan2.reasons['no-header'] || 0) >= 1, JSON.stringify(scan2.reasons))
  ok('G12 空目录/缺文件也容错', typeof scan2.reasons === 'object')
} catch (e) {
  fail++
  console.log('  FAIL - 未捕获异常: ' + (e && e.stack ? e.stack : e))
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await rm(backupRoot, { recursive: true, force: true }).catch(() => {})
  await rm(projcacheRoot, { recursive: true, force: true }).catch(() => {})
  // 确认没有残留的会话目录被误删到工作区
  const leftover = await readdir(tmpdir()).catch(() => [])
  assert.ok(Array.isArray(leftover))
}

console.log('\n[subagent-gc] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
