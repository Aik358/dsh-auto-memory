#!/usr/bin/env node
/**
 * 并发一致性回归（2026-10-08 批 · #304 / #306 / #311 / #312 / #309）
 *
 * 家族根因：**「已报告成功的写」实际没落盘**（错误成功回执 / 丢更新），
 *   以及目录迁移与发布边界的错误缓存。
 *
 * 纪律（本仓硬性）：
 *   · 每条断言都**真 import → 真构造 → 真调用 → 断言返回值/副作用**，不用「源码含某字符串」充当验收；
 *   · 变异反向验证由 tools 侧脚本单独跑（见 .diag-i304/），本套件只钉行为；
 *   · 并发用例用**真文件系统 + 真延迟注入**制造确定性交错，不靠 sleep 碰运气。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promises as realFs } from 'node:fs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const W = await import(new URL('../../lib/memory-writer.js', import.meta.url).href)
const MT = await import(new URL('../../lib/memory-mutation-transaction.js', import.meta.url).href)
const { MemoryDocumentStore } = W

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.log('  FAIL - ' + n) } }
const tmps = []
const mkroot = (tag) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-conc-' + tag + '-')); tmps.push(d); return d }
const markerCount = (t) => (t.match(/<!--\s*memory:mem_[0-9a-f]{32}\s*-->/g) || []).length

// ══════════════════════════════════════════════════════════════
console.log('[①] #311 不同目录并行写：别名基准必须按任务隔离（旧实现：实例字段互相覆写 ⇒ 假拒绝）')
// ══════════════════════════════════════════════════════════════
{
  const root = mkroot('311')
  mkdirSync(path.join(root, 'a'), { recursive: true })
  mkdirSync(path.join(root, 'b'), { recursive: true })
  const fa = path.join(root, 'a', 'MEMORY.md')
  const fb = path.join(root, 'b', 'MEMORY.md')
  writeFileSync(fa, 'A 原始\n', 'utf8')
  writeFileSync(fb, 'B 原始\n', 'utf8')
  const store = new MemoryDocumentStore({})
  const [ra, rb] = await Promise.all([store.append(fa, '- 甲'), store.append(fb, '- 乙')])
  ok(ra && ra.ok === true, '★ ① 目录 A 的并行写成功（未被 B 的基准污染成 MEMORY_PATH_ESCAPED；实 ' + JSON.stringify(ra && (ra.ok || ra.reason)) + '）')
  ok(rb && rb.ok === true, '★ ① 目录 B 的并行写成功（实 ' + JSON.stringify(rb && (rb.ok || rb.reason)) + '）')
  const ta = readFileSync(fa, 'utf8'), tb = readFileSync(fb, 'utf8')
  ok(ta.includes('- 甲') && markerCount(ta) === 1, '★ ① A 的内容落在 A 文件（未串到 B）')
  ok(tb.includes('- 乙') && markerCount(tb) === 1, '★ ① B 的内容落在 B 文件（未串到 A）')
}

// ══════════════════════════════════════════════════════════════
console.log('[②] #306 同一文件跨进程并发追加：物理路径锁必须串行化（旧实现：进程内 Map ⇒ 丢更新）')
// ══════════════════════════════════════════════════════════════
{
  const root = mkroot('306')
  const file = path.join(root, 'MEMORY.md')
  writeFileSync(file, '原始\n', 'utf8')
  // 真子进程 + 读盘延迟注入：把「已读到旧内容、尚未提交」的窗口撑开
  const workerSrc = [
    "import { promises as realFs } from 'node:fs'",
    "import { MemoryDocumentStore } from " + JSON.stringify(new URL('../../lib/memory-writer.js', import.meta.url).href),
    'const file = process.argv[2], tag = process.argv[3], delay = Number(process.argv[4] || 400)',
    'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))',
    'const slowFs = Object.create(realFs)',
    'slowFs.readFile = async (p, ...rest) => { const out = await realFs.readFile(p, ...rest); if (String(p).endsWith("MEMORY.md")) await sleep(delay); return out }',
    'const store = new MemoryDocumentStore({ fs: slowFs })',
    'const r = await store.append(file, tag)',
    'process.exit(r && r.ok ? 0 : 1)',
  ].join('\n')
  const worker = path.join(root, 'worker.mjs')
  writeFileSync(worker, workerSrc, 'utf8')
  const driverSrc = [
    "import fs from 'node:fs'",
    "import { spawn } from 'node:child_process'",
    'const worker = process.argv[2], file = process.argv[3]',
    'const run = (tag) => new Promise((res) => { const p = spawn(process.execPath, [worker, file, tag, "400"], { stdio: ["ignore", "pipe", "pipe"] }); let e = ""; p.stderr.on("data", (d) => { e += String(d) }); p.on("exit", (c) => res({ c, e: e.split("\\n")[0].slice(0, 160) })) })',
    'const runs = await Promise.all([run("RECORD_AAA"), run("RECORD_BBB")])',
    'const t = fs.readFileSync(file, "utf8")',
    'console.log(JSON.stringify({ codes: runs.map((r) => r.c), errs: runs.map((r) => r.e), hasA: t.includes("RECORD_AAA"), hasB: t.includes("RECORD_BBB"), markers: (t.match(/<!-- memory:mem_[0-9a-f]{32} -->/g) || []).length }))',
  ].join('\n')
  const driver = path.join(root, 'driver.mjs')
  writeFileSync(driver, driverSrc, 'utf8')
  const out = spawnSync(process.execPath, [driver, worker, file], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  let got = null
  try { got = JSON.parse(String(out.stdout).trim().split('\n').pop()) } catch (_) {}
  ok(!!got, '★ ② 跨进程驱动真的跑出结果（实 ' + JSON.stringify(String(out.stdout).slice(0, 120)) + ' stderr=' + String(out.stderr).slice(0, 160) + '）')
  if (got) {
    ok(got.hasA && got.hasB, '★ ② 两条记录都在（旧实现丢一条；实测 hasA=' + got.hasA + ' hasB=' + got.hasB + '）')
    ok(got.markers === 2, '★ ② 锚点恰 2 个（实测 ' + got.markers + '）')
    ok(got.codes.every((c) => c === 0), '★ ② 两个进程都如实回执成功（实 ' + JSON.stringify(got.codes) + '）')
  }
}

// ══════════════════════════════════════════════════════════════
console.log('[③] #312 目录迁移失败**不得**留下已处理缓存（旧实现：失败后第二次改读空新目录）')
// ══════════════════════════════════════════════════════════════
{
  const root = mkroot('312')
  const home = path.join(root, 'home')
  const base = path.join(home, 'memory')
  mkdirSync(path.join(base, 'hub-pre'), { recursive: true })
  writeFileSync(path.join(base, 'hub-pre', 'facts.json'), '{"facts":[1,2,3]}', 'utf8')
  // 真 import 迁移函数：datadir.js 的 memoryDir(name, homeFn)
  const dd = await import(new URL('../../lib/datadir.js?v=312', import.meta.url).href)
  const first = dd.memoryDir('hub', () => home)
  ok(existsSync(path.join(first, 'facts.json')), '★ ③ 正路径：首次迁移后新目录真有 facts.json（实 ' + first + '）')
  // 负路径：真制造失败（新目录位置被同名**文件**占位 ⇒ mkdir/copy 必失败）
  const home2 = path.join(root, 'home2')
  const base2 = path.join(home2, 'memory')
  mkdirSync(path.join(base2, 'hub-pre'), { recursive: true })
  writeFileSync(path.join(base2, 'hub-pre', 'facts.json'), '{"facts":[9]}', 'utf8')
  writeFileSync(path.join(base2, 'hub'), 'BLOCKER-FILE', 'utf8')   // 占位文件 ⇒ 迁移必失败
  const dd2 = await import(new URL('../../lib/datadir.js?v=312b', import.meta.url).href)
  const r1 = dd2.memoryDir('hub', () => home2)
  const r2 = dd2.memoryDir('hub', () => home2)
  ok(r1 === path.join(base2, 'hub-pre'), '★ ③ 首次失败回退旧目录（实 ' + r1 + '）')
  ok(r2 === path.join(base2, 'hub-pre'), '★ ③ 第二次**仍**回退旧目录（旧实现在此返回空新目录；实 ' + r2 + '）')
  ok(existsSync(path.join(r2, 'facts.json')), '★ ③ 回退目录里历史数据可读（实 facts.json 存在 = ' + existsSync(path.join(r2, 'facts.json')) + '）')
}


// ══════════════════════════════════════════════════════════════
console.log('[④] #320 受理登记、有限等待与配置锁内持久根复核')
// ══════════════════════════════════════════════════════════════
{
  const mkEngine = (cfg, mig) => {
    const root = mkroot('320'), file = path.join(root, 'settings.json')
    writeFileSync(file, JSON.stringify(cfg))
    return { config: cfg, _configPath: file, _settingsMigrationActive: !!mig, expandUserPath: p => p ? path.resolve(p) : '' }
  }
  // ④-1 flight 登记后必须能被 drain 到，settle 后集合清空（不悬挂）
  const e1 = mkEngine({ memoryRoot: 'D:/r1' })
  const reg = MT.registerMemoryMutationFlightPre(e1, 'D:/r1/f.md')
  ok(e1._memoryMutationFlights.size === 1, '★ ④ 受理即登记 flight（旧实现：普通写通道零登记 ⇒ 迁移等不到它；实 ' + e1._memoryMutationFlights.size + '）')
  let settledBefore = false
  const drainP = MT.drainMemoryMutationFlightsPre(e1, { timeoutMs: 500 })
  setTimeout(() => { settledBefore = true; reg.settle() }, 20)
  const d1 = await drainP
  ok(settledBefore === true && d1.settled === true, '★ ④ drain 等到落盘结束（实 ' + JSON.stringify(d1) + '）')
  ok(e1._memoryMutationFlights.size === 0, '★ ④ settle 后集合清空（不悬挂；实 ' + e1._memoryMutationFlights.size + '）')
  // ④-2 drain 必须有界：永不 settle 的 flight 不能让迁移卡死
  const e2 = mkEngine({ memoryRoot: 'D:/r2' })
  const reg2 = MT.registerMemoryMutationFlightPre(e2, 'D:/r2/f.md')
  const t0 = Date.now()
  const d2 = await MT.drainMemoryMutationFlightsPre(e2, { timeoutMs: 300 })
  const elapsed = Date.now() - t0
  ok(d2.settled === false && elapsed < 3000, '★ ④ drain 有界（不 settle 时不卡死；实 elapsed=' + elapsed + 'ms ' + JSON.stringify(d2) + '）')
  reg2.settle()
  // ④-3 提交时复核持久根：写期间根被改 ⇒ 结构化 409（不给出「成功但落在旧根」的回执）
  const e3 = mkEngine({ memoryRoot: 'D:/old' })
  const adm3 = MT.captureMemoryMutationPre(e3, 'D:/old/f.md')
  let threw3 = null
  try { await MT.withMemoryMutationPre(e3, 'D:/old/f.md', async () => { writeFileSync(e3._configPath, JSON.stringify({ memoryRoot: 'D:/new' })); return 'wrote' }, adm3) } catch (e) { threw3 = e }
  ok(threw3 && threw3.code === 'SETTINGS_ROOT_CHANGED' && threw3.statusCode === 409, '★ ④ 写期间根被改 ⇒ 409 SETTINGS_ROOT_CHANGED（旧实现静默成功；实 ' + (threw3 ? threw3.code : 'NO-THROW') + '）')
  // ④-4 负路径的另一半：根**没**变 ⇒ 不得误拒（含中间有 await 的正常写）
  const e4 = mkEngine({ memoryRoot: 'D:/same' })
  const adm4 = MT.captureMemoryMutationPre(e4, 'D:/same/f.md')
  const out4 = await MT.withMemoryMutationPre(e4, 'D:/same/f.md', async () => { await new Promise((r) => setTimeout(r, 30)); return 'ok' }, adm4)
  ok(out4 === 'ok', '★ ④ 根未变 ⇒ 正常写不受影响（无假拒绝；实 ' + JSON.stringify(out4) + '）')
  // ④-5 迁移窗口仍照旧 409
  const e5 = mkEngine({}, true)
  let threw5 = null
  try { await MT.withMemoryMutationPre(e5, 'D:/z/f.md', async () => 'x') } catch (e) { threw5 = e }
  ok(threw5 && threw5.code === 'SETTINGS_MIGRATION_ACTIVE', '★ ④ 迁移窗口 409 语义未变（实 ' + (threw5 ? threw5.code : 'NO-THROW') + '）')
}
console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true }) } catch (_) {} }
process.exit(fail ? 1 : 0)
