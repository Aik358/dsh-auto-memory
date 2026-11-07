/**
 * smoke-test-upgrade-pending.mjs —— P6 验收（2026-11-03）
 *
 * 依据：docs/internal/PLAN-UPGRADE-WIZARD-20261103.md §5 + §7 的 P6 行：
 *   「迁移中 memory_log ⇒ 拒绝文案 + 落队列；replay 后日志 +N；负路径：replay 失败不丢文件」
 *
 * ★全部真调用：真 import → 真入队（真写盘）→ 真 replay（真删/真留）→ 读盘断言。
 * ★负路径覆盖：apply 抛错、apply 明确拒绝（{ok:false} / false）、文件损坏、缺 apply、
 *   runId 非法、未知 run → 队列文件一律**不得删除**。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createHarness } from './_harness.mjs'
import {
  PENDING_DIRNAME,
  PENDING_SCHEMA,
  PENDING_FILE_RE,
  pendingRunDirPre,
  pendingFileNamePre,
  enqueuePendingWritePre,
  listPendingWritesPre,
  listPendingRunIdsPre,
  countPendingWritesPre,
  replayPendingWritesPre,
} from '../../lib/upgrade-pending.js'

const T = createHarness('upgrade-pending')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const readSha = async (f) => sha256(await readFile(f))
const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'))

const RUN = 'run-20261103-abc'
const T0 = 1793500000000

/** 新根目录（每个分组独立，互不干扰） */
function newRoot(tag) { return T.tmpdir('upgrade-pending-' + tag + '-') }

/** 队列目录里的文件（只列 .json，忽略 .tmp） */
async function queueFiles(root, runId) {
  try {
    return (await readdir(pendingRunDirPre(root, runId))).filter((n) => /\.json$/i.test(n) && !/\.tmp$/i.test(n)).sort()
  } catch (_) { return [] }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('== A. 入队（原子写 + 命名契约 + 参数 fail-closed）==')
{
  const root = newRoot('enqueue')
  const entry = { tool: 'memory_log', args: { note: '迁移期被拒的第 1 条', kind: 'fact' }, wsKey: '--w--' }
  const r = await enqueuePendingWritePre({ root, runId: RUN, entry, now: T0 })
  T.ok(r.ok === true && typeof r.file === 'string', 'A-1 入队成功并返回文件路径')
  T.ok(fs.existsSync(r.file), 'A-2 队列文件已真实落盘')
  const dir = pendingRunDirPre(root, RUN)
  T.eq(path.dirname(r.file), dir, 'A-3 落在 <root>/pending-writes/<runId>/ 下')
  T.ok(PENDING_FILE_RE.test(path.basename(r.file)) && path.basename(r.file).startsWith(String(T0) + '-'), 'A-4 文件名 <ts>-<rand>.json（字典序 = 时间序）', path.basename(r.file))
  T.eq(r.id, path.basename(r.file).replace(/\.json$/i, ''), 'A-5 回执 id = 文件名去后缀')

  const rec = await readJson(r.file)
  T.eq(rec.schema, PENDING_SCHEMA, 'A-6 文件 schema 正确')
  T.eq([rec.runId, rec.queuedAt], [RUN, T0], 'A-7 runId / queuedAt 落盘正确')
  T.eq(rec.entry, entry, 'A-8 entry 原样保留（深比较）')
  const st = await stat(r.file)
  T.eq(r.bytes, st.size, 'A-9 回执 bytes === 文件真实字节数')
  T.ok((await queueFiles(root, RUN)).length === 1, 'A-10 目录里恰好 1 个 .json')
  T.ok((await readdir(dir)).every((n) => !/\.tmp$/i.test(n)), 'A-11 ★原子写收尾：无 .tmp 残留')

  T.eq((await listPendingWritesPre({ root, runId: RUN })).length, 1, 'A-12 listPendingWritesPre 返回 1 条')
  T.eq((await countPendingWritesPre({ root })).total, 1, 'A-13 countPendingWritesPre 总计 1 条')
  T.eq(await listPendingRunIdsPre(root), [RUN], 'A-14 listPendingRunIdsPre 列出该 run')

  const badEntry = await enqueuePendingWritePre({ root, runId: RUN, entry: null, now: T0 })
  T.ok(badEntry.ok === false && badEntry.code === 'bad-entry', 'A-15 ★entry 非对象 ⇒ 拒（bad-entry）')
  const noRun = await enqueuePendingWritePre({ root, entry: { tool: 'x' }, now: T0 })
  T.ok(noRun.ok === false && noRun.code === 'bad-args', 'A-16 ★缺 runId ⇒ 拒（bad-args）')
  const noRoot = await enqueuePendingWritePre({ runId: RUN, entry: { tool: 'x' }, now: T0 })
  T.ok(noRoot.ok === false && noRoot.code === 'bad-args', 'A-17 ★缺 root ⇒ 拒（bad-args）')
  const evil = await enqueuePendingWritePre({ root, runId: '../../evil', entry: { tool: 'x' }, now: T0 })
  T.ok(evil.ok === false && evil.code === 'bad-args' && !fs.existsSync(path.join(root, '..', '..', 'evil')), 'A-18 ★runId 路径穿越 ⇒ 拒且不越界创建目录')

  T.eq(pendingFileNamePre(T0, 'abcd1234'), T0 + '-abcd1234.json', 'A-19 pendingFileNamePre 命名确定性')
  T.ok(PENDING_FILE_RE.test(pendingFileNamePre(T0, 'abcd1234')) === true, 'A-20 命名契约可被正则识别')

  // 并发入队：同一毫秒、随机后缀 ⇒ 必须 5 个不同文件且全部可解析（不得互相覆盖/写坏）
  const rs = await Promise.all([0, 1, 2, 3, 4].map((i) => enqueuePendingWritePre({ root, runId: RUN, entry: { seq: i }, now: T0 })))
  const files = rs.map((x) => x.file)
  T.ok(new Set(files).size === 5, 'A-21 ★并发 5 次入队 ⇒ 5 个不同文件（无覆盖）')
  let allParse = true
  for (const f of files) { try { await readJson(f) } catch (_) { allParse = false } }
  T.ok(allParse, 'A-22 ★并发写入全部 JSON 可解析（原子写无半截）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== B. 列表顺序 / 边界 ==')
{
  const root = newRoot('list')
  for (let i = 0; i < 3; i++) await enqueuePendingWritePre({ root, runId: RUN, entry: { seq: i }, now: T0 + i })
  const list = await listPendingWritesPre({ root, runId: RUN })
  T.eq(list.length, 3, 'B-1 列出 3 条')
  const seqs = []
  for (const f of list) seqs.push((await readJson(f)).entry.seq)
  T.eq(seqs, [0, 1, 2], 'B-2 ★列表按文件名排序 = 入队时间序（replay 顺序依据）')
  // .tmp 残留不得被当成队列条目
  await writeFile(path.join(pendingRunDirPre(root, RUN), '1793500009999-deadbeef.json.tmp'), '{"half":', 'utf8')
  T.eq((await listPendingWritesPre({ root, runId: RUN })).length, 3, 'B-3 ★.tmp 残片不计入队列（只认 .json）')
  T.eq(await listPendingWritesPre({ root, runId: 'run-never' }), [], 'B-4 不存在的 run ⇒ 空数组（不建目录）')
  T.ok(!fs.existsSync(pendingRunDirPre(root, 'run-never')), 'B-5 ★读取不创建目录（零写盘的读路径）')
  T.eq(await listPendingRunIdsPre(path.join(root, 'no-such-root')), [], 'B-6 不存在的根 ⇒ 空 run 列表（不抛）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== C. replay 成功路径（补写 N 条 + 删源文件）==')
{
  const root = newRoot('replay-ok')
  for (let i = 0; i < 3; i++) await enqueuePendingWritePre({ root, runId: RUN, entry: { tool: 'memory_log', seq: i }, now: T0 + i })
  const seen = []
  const metas = []
  const r = await replayPendingWritesPre({ root, runId: RUN, apply: async (entry, meta) => { seen.push(entry.seq); metas.push(meta); return { ok: true } } })
  T.ok(metas.length === 3 && metas.every((m) => !!m.file && m.runId === RUN && m.queuedAt > 0), 'C-0 apply 逐条收到 meta(file/runId/queuedAt)')
  T.eq([r.replayed, r.failed, r.remaining], [3, 0, 0], 'C-1 ★replay 成功：replayed=3 failed=0 remaining=0')
  T.eq(seen, [0, 1, 2], 'C-2 ★apply 按时间序被逐条调用')
  T.eq(await queueFiles(root, RUN), [], 'C-3 ★成功条目源文件已删除（队列清空）')
  T.ok(r.ok === true && Array.isArray(r.results) && r.results.length === 3, 'C-4 回执形状完整（results 逐条）')
  const r2 = await replayPendingWritesPre({ root, runId: RUN, apply: async () => ({ ok: true }) })
  T.eq([r2.replayed, r2.failed, r2.remaining], [0, 0, 0], 'C-5 再 replay 空队列 ⇒ 全 0（幂等空转）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== D. replay 失败路径（★负路径：失败文件必须留在盘上）==')
{
  const root = newRoot('replay-fail')
  for (let i = 0; i < 4; i++) await enqueuePendingWritePre({ root, runId: RUN, entry: { seq: i }, now: T0 + i })
  const before = await listPendingWritesPre({ root, runId: RUN })
  const badFile = before[1]
  const badSha = await readSha(badFile)
  const r = await replayPendingWritesPre({
    root, runId: RUN,
    apply: async (entry) => { if (entry.seq === 1) throw new Error('补写时宿主写盘失败'); return { ok: true } },
  })
  T.eq([r.replayed, r.failed, r.remaining], [3, 1, 1], 'D-1 ★apply 抛错 ⇒ replayed=3 failed=1 remaining=1')
  T.ok(fs.existsSync(badFile), 'D-2 ★★失败的队列文件仍在盘上（不得静默丢弃）')
  // ★#549 判据变更：旧断言「逐字节未变」守的是旧实现细节（旧版不写回 attempts）；新判据守不变量 = 文件仍在 + entry 主体未篡改。
  T.ok(fs.existsSync(badFile) && (await readSha(badFile)) !== badSha, 'D-3 ★失败文件仍在盘上且写入可见状态（attempts/lastError）')
  const badRec = await readJson(badFile)
  T.eq(badRec.entry.seq, 1, 'D-3b ★entry 主体未被篡改（仍可原样重试）')
  T.eq(badRec.attempts, 1, 'D-3c attempts 已累加为 1')
  T.eq(await queueFiles(root, RUN), [path.basename(badFile)], 'D-4 其余成功条目已删除，只剩失败那条')
  const failResult = r.results.find((x) => !x.ok)
  T.eq(failResult && failResult.code, 'apply-threw', 'D-5 失败回执带 code=apply-threw')

  // 下一轮 apply 明确拒绝（{ok:false}）⇒ 仍算失败、文件仍留
  const r2 = await replayPendingWritesPre({ root, runId: RUN, apply: async () => ({ ok: false, error: '写闸仍在' }) })
  T.eq([r2.replayed, r2.failed, r2.remaining], [0, 1, 1], 'D-6 ★apply 返回 {ok:false} ⇒ 算失败（remaining 仍为 1）')
  T.ok(fs.existsSync(badFile), 'D-7 {ok:false} 路径文件仍保留')
  T.eq(r2.results[0].code, 'apply-rejected', 'D-8 拒绝回执 code=apply-rejected')

  // 返回 false 同样算失败
  const r3 = await replayPendingWritesPre({ root, runId: RUN, apply: async () => false })
  T.eq([r3.replayed, r3.failed, r3.remaining], [0, 1, 1], 'D-9 ★apply 返回 false ⇒ 算失败、文件保留')

  // 文件损坏 ⇒ 解析失败、文件保留
  const broken = path.join(pendingRunDirPre(root, RUN), (T0 + 99) + '-broken.json')
  await writeFile(broken, '{ 这不是 JSON', 'utf8')
  const r4 = await replayPendingWritesPre({ root, runId: RUN, apply: async () => ({ ok: true }) })
  // ★#549：badFile 已失败 3 次（D-1/D-6/D-9）达上限 ⇒ 本轮不再自动重试但仍留盘（issue 要求的「失败重试+不丢文件」）。
  T.eq([r4.replayed, r4.failed, r4.remaining, r4.skipped], [0, 1, 2, 1], 'D-10 ★达上限条目本轮跳过但仍保留；损坏条目 failed 且保留')
  T.ok(fs.existsSync(broken), 'D-11 损坏文件仍在盘上（供人工排查）')
  T.ok(r4.results.some((x) => x.code === 'unreadable'), 'D-12 损坏回执 code=unreadable')
  T.ok(fs.existsSync(badFile), 'D-12b ★★达上限的条目仍在盘上（不静默丢弃，供人工处置）')
  T.ok(r4.results.some((x) => x.code === 'retry-exhausted'), 'D-12c 回执明写 retry-exhausted（不静默跳过）')

  // 缺 apply ⇒ 明确拒绝，不动任何文件
  const r5 = await replayPendingWritesPre({ root, runId: RUN })
  T.ok(r5.ok === false && r5.code === 'no-apply', 'D-13 ★缺 apply 回调 ⇒ no-apply（不静默成功）')
  T.eq((await queueFiles(root, RUN)).length, 2, 'D-14 缺 apply 时队列文件一个都没动（达上限那条 + 损坏那条）')

  // 不存在的 run ⇒ 全 0，不建目录
  const r6 = await replayPendingWritesPre({ root, runId: 'run-nope', apply: async () => ({ ok: true }) })
  T.eq([r6.replayed, r6.failed, r6.remaining], [0, 0, 0], 'D-15 不存在的 run ⇒ 全 0（不抛）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== E. 多 run 回放（下次启动场景：runId 省略）==')
{
  const root = newRoot('all-runs')
  await enqueuePendingWritePre({ root, runId: 'run-a', entry: { seq: 'a1' }, now: T0 })
  await enqueuePendingWritePre({ root, runId: 'run-b', entry: { seq: 'b1' }, now: T0 + 1 })
  await enqueuePendingWritePre({ root, runId: 'run-b', entry: { seq: 'b2' }, now: T0 + 2 })
  const got = []
  const r = await replayPendingWritesPre({ root, apply: async (entry) => { got.push(entry.seq); return { ok: true } } })
  T.eq([r.replayed, r.failed, r.remaining], [3, 0, 0], 'E-1 ★runId 省略 ⇒ 回放全部 run（3 条）')
  T.eq(got, ['a1', 'b1', 'b2'], 'E-2 跨 run 按 runId 字典序 + 文件时间序回放')
  T.eq(r.runIds, ['run-a', 'run-b'], 'E-3 回执列出扫描到的 runIds')
  T.eq(await queueFiles(root, 'run-a'), [], 'E-4 run-a 队列已清空')
  T.eq(await queueFiles(root, 'run-b'), [], 'E-5 run-b 队列已清空')
}

T.done()
