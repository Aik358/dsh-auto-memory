#!/usr/bin/env node
/**
 * smoke 回归运行器 —— 逐文件 `node` 跑 `tests/smoke/*.mjs`，红即非零退出。
 *
 * 来历：issue #73 要求「每次 push/PR 跑全量 smoke，让红立刻可见」；本文件是它的落地件。
 * v3.1.0 的发布线把它和 `.github/workflows/tests.yml` 一起丢了 ⇒ 唯一测试门禁归零，
 * `smoke-test-t7bcd-pre.mjs` 也因 ENOENT 直接崩。此处按 **T7-c 契约**（同一套断言就是它的规格）重建：
 *   · 默认并发 4（T7-f 裁定「默认并行提高效率」），`--jobs=1` 回退串行；
 *   · `--jobs` 有上界钳制，防止开满管道再次触发 stdout EPIPE 自激；
 *   · 进度行含百分比 / done总数 / 已耗时；并发实现是**有界工作池**，不是无界 Promise.all 扇出。
 *
 * 门禁语义（不可协商）：任何 FAIL/TIMEOUT ⇒ **exit 1**。绝不内建 continue-on-error ——
 * 「把必需的信号变成绿」正是 #73 要修的东西。
 *
 * 用法：node tools/run-smoke.mjs [--filter=<子串>] [--exclude=<子串>]... [--timeout=ms] [--jobs=N] [--list]
 *   --exclude 可重复；被排除的套件会打印原因（排除不等于放弃覆盖，理由必须留在日志里）。
 */
import { readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SMOKE_DIR = path.join(ROOT, 'tests', 'smoke')
const DEFAULT_JOBS = 4
const JOBS_MAX = 16
const DEFAULT_TIMEOUT_MS = 90000
const FAIL_TAIL_CHARS = 2400

function parseArgs(argv) {
  const opts = { filter: '', exclude: [], timeout: DEFAULT_TIMEOUT_MS, jobs: DEFAULT_JOBS, list: false }
  for (const a of argv) {
    let m
    if ((m = /^--jobs=(\d+)$/.exec(a))) opts.jobs = Math.max(1, Math.min(16, Number(m[1])))
    else if ((m = /^--timeout=(\d+)$/.exec(a))) opts.timeout = Math.max(1000, Number(m[1]))
    else if ((m = /^--filter=(.+)$/i.test(a))) opts.filter = /^--filter=(.+)$/i.exec(a)[1]
    else if ((m = /^--exclude=(.+)$/.exec(a))) opts.exclude.push(m[1])
    else if (a === '--list') opts.list = true
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
    else { console.error('[run-smoke] 未知参数：' + a); printHelp(); process.exit(2) }
  }
  return opts
}

function printHelp() {
  console.log('用法: node tools/run-smoke.mjs [--filter=<子串>] [--exclude=<子串>]... [--timeout=ms] [--jobs=N] [--list|--help]')
  console.log('默认 --jobs=' + DEFAULT_JOBS + '（上界 ' + JOBS_MAX + '）、--timeout=' + DEFAULT_TIMEOUT_MS + 'ms；有 FAIL/TIMEOUT 则 exit 1')
}

function discover() {
  if (!existsSync(SMOKE_DIR) || !statSync(SMOKE_DIR).isDirectory()) return []
  return readdirSync(SMOKE_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) => !f.includes('.bak')) // 备份文件不算套件（历史上确有 *.mjs.bak-* 被跟踪）
    .sort()
}

function runSuite(file, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [path.join(SMOKE_DIR, file)], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
    let out = ''
    const collect = (chunk) => { out += chunk.toString('utf8'); if (out.length > FAIL_TAIL_CHARS * 4) out = out.slice(-FAIL_TAIL_CHARS * 2) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    let killed = false
    const timer = setTimeout(() => { killed = true; try { child.kill('SIGKILL') } catch (_) {} }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); resolve({ file, code: -1, timedOut: false, ms: Date.now() - started, tail: 'spawn 失败: ' + (e && e.message) }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ file, code: killed ? 'TIMEOUT' : (code === null ? -1 : code), timedOut: killed, ms: Date.now() - started, tail: out.trimEnd() })
    })
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const all = discover()
  if (!all.length) {
    // 「0 个套件」必须显式失败 —— 空选中的绿是最危险的一种绿
    console.error('[run-smoke] tests/smoke 下没有 .mjs 套件（目录错了吗？）')
    process.exit(1)
  }
  const suites = []
  let excludedByUser = 0
  for (const f of all) {
    if (opts.filter && !f.includes(opts.filter)) continue
    const hit = opts.exclude.find((p) => f.includes(p))
    if (hit) { excludedByUser++; console.log('  skip ' + f + '  (--exclude=' + hit + ')'); continue }
    suites.push(f)
  }
  if (opts.list) { for (const f of suites) console.log(f); console.log('共 ' + suites.length + ' 个待跑 / 目录内 ' + all.length); return }
  if (!suites.length) {
    console.error('[run-smoke] 过滤后待跑套件为 0（filter=' + (opts.filter || '(无)') + ' exclude=' + opts.exclude.join(',') + '）⇒ 判失败，避免"没跑到"被当成全绿')
    process.exit(1)
  }

  const jobs = opts.jobs
  const t0 = Date.now()
  const results = []
  const report = (r) => {
    results.push(r)
    const done = results.length
    const pct = Math.round((done / suites.length) * 100)
    const el = ((Date.now() - t0) / 1000).toFixed(1)
    const bad = r.timedOut || r.code !== 0
    console.log('[' + pct + '%] ' + done + '/' + suites.length + ' 已耗时 ' + el + 's  '
      + (bad ? '✗ ' + (r.timedOut ? 'TIMEOUT' : 'exit ' + r.code) : '✓') + '  ' + r.file)
  }

  if (jobs === 1) {
    console.log('[run-smoke] 串行模式 (sequential (never parallel))：' + suites.length + ' 个套件，timeout=' + opts.timeout + 'ms')
    for (const f of suites) report(await runSuite(f, opts.timeout))
  } else {
    console.log('[run-smoke] 并发 ' + jobs + '（有界工作池）：' + suites.length + ' 个套件，timeout=' + opts.timeout + 'ms')
    let cursor = 0
    const worker = async () => {
      while (true) {
        const i = cursor++
        if (i >= suites.length) return
        report(await runSuite(suites[i], opts.timeout))
      }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, () => worker()))
  }

  const failed = results.filter((r) => r.timedOut || r.code !== 0)
  const passed = results.length - failed.length
  console.log('\n==== 汇总 ====')
  console.log('套件 ' + results.length + '：通过 ' + passed + ' / 失败 ' + failed.length
    + (excludedByUser ? '（另有 ' + excludedByUser + ' 个被 --exclude 跳过，理由见上方 skip 行）' : '')
    + '，总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
  for (const r of failed) {
    console.log('\n--- FAIL: ' + r.file + ' (' + (r.timedOut ? 'TIMEOUT after ' + opts.timeout + 'ms' : 'exit ' + r.code) + ') ---')
    console.log(r.tail ? r.tail.slice(-FAIL_TAIL_CHARS) : '(该套件无任何输出)')
  }
  if (failed.length) {
    console.log('\n[run-smoke] 有失败 ⇒ exit 1（本地复现: node tools/run-smoke.mjs --filter=<套件名关键字>）')
    process.exit(1)
  }
  console.log('[run-smoke] 全绿')
}

main().catch((e) => { console.error('[run-smoke] 运行器自身异常: ' + (e && (e.stack || e.message))); process.exit(1) })
