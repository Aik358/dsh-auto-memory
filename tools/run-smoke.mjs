#!/usr/bin/env node
/**
 * tools/run-smoke.mjs — 冒烟回归串行运行器(零第三方依赖,仅 node 内置)。
 *
 * 用法:
 *   node tools/run-smoke.mjs                      # 逐个跑 tests/smoke/*.mjs,每套件超时 60s
 *   node tools/run-smoke.mjs --timeout=30000      # 自定义每套件超时(毫秒)
 *   node tools/run-smoke.mjs --timeout=0          # 关闭超时(不建议:见下)
 *   node tools/run-smoke.mjs --filter=handoff     # 只跑文件名含该子串的套件
 *
 * 设计原因
 * --------
 * 全量回归曾因**单个套件忙等**而永不返回,使"全量零失败"这一发版前置门不可靠:
 * 2026-09-14 实测 tests/smoke/smoke-test-consolidate-isolation.mjs 空转约 29 分钟
 * (累计 CPU 约 18 分钟),宿主侧只能整批中断,无法区分"哪个套件坏了"。
 *
 * 两条实测到的失效路径,决定了本运行器的形态:
 *   1) **进程不退出**:该套件在断言失败后不再执行收尾(清定时器),而被测插件注册的
 *      5 分钟/15 秒/1 小时 setInterval 仍在,加上被测插件自己装了
 *      process.on('uncaughtException') 监听器(会抑制 Node 的默认致命退出),
 *      于是 node 进程**既不退出也不报错**,挂钟可以无限长。
 *   2) **忙等烧 CPU**:当读到本进程 stdout 的那一端消失(父工具调用被 abort / 运行器被
 *      强杀)后,向已断的管道写日志会抛 EPIPE;被测插件的 uncaughtException 处理器
 *      本身又用 console.error 写日志 → 再次抛 EPIPE → 再次进入同一处理器 → 自激循环,
 *      100% CPU 永不收敛。
 *
 * 因此本运行器:**先杀子进程、再收管道**(顺序反了会人为制造上面第 2 条),并且
 * 每个套件独立计时、超时只影响一个套件,**绝不整体挂住**。这是引擎侧根因修好之前的护栏。
 *
 * 退出码:有任何 FAIL 或 TIMEOUT → 非 0;全绿 → 0。
 */

import { readdirSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SMOKE_DIR = path.join(ROOT, 'tests', 'smoke')

const DEFAULT_TIMEOUT_MS = 60000
/** ★T7-f（2026-09-20 用户裁定「默认并行」）：默认并发度。`--jobs=1` 可回退串行。 */
const DEFAULT_JOBS = 4
/** 每个套件保留的输出尾部字符数(用于定位卡点,不需要全量)。 */
const TAIL_CHARS = 2000
/** 收到退出信号后,最多再等多久收尸(毫秒),防止运行器自己挂住。 */
const REAP_GRACE_MS = 5000

function parseArgs(argv) {
  // ★T7-f（2026-09-20 用户裁定「默认并行，提高效率」）：`jobs` 默认 4。
  //   ★ 危害评估（用户问「危害会很大吗」——**实测后**回答，非推断）：
  //   ① 4 并发全量 136 套件**实测全绿**（42.3s vs 串行 143.6s，3.4×），无共享状态冲突；
  //   ② 本运行器原本串行的理由是**管道 EPIPE 自激循环**（见文件头第 2 条）——那是
  //      「父端消失后子进程往断管道写日志」的场景，与「同时开几个子进程」无关；
  //      并发只是把独立管道从 1 条提到 4 条，风险量级不变（仍每子进程独立 pipe+destroy）。
  //   ③ ★ **真正的残余风险**：`--timeout` 是**墙钟**计时，4 路并发下重负载套件的墙钟会
  //      被 CPU 抢占拉长 ⇒ 可能触发**偶发 TIMEOUT（而非 FAIL）**。本仓全量用 90s 阈值，
  //      实测无超时；若日后见到「单套件 TIMEOUT 但单独跑就过」，优先怀疑这一条，
  //      用 `--jobs=2` 或 `--jobs=1` 复验即可确认。
  //   ④ 可回退：`--jobs=1` 恢复逐字节等价的串行路径（原代码路径保留，未删改）。
  const opts = { timeoutMs: DEFAULT_TIMEOUT_MS, filter: '', exclude: [], jobs: DEFAULT_JOBS }
  for (const a of argv) {
    const m = /^--timeout=(\d+)$/.exec(a)
    if (m) { opts.timeoutMs = Number(m[1]); continue }
    const f = /^--filter=(.+)$/.exec(a)
    if (f) { opts.filter = f[1]; continue }
    // `--jobs=N` 显式覆盖；`--jobs=1` 回到串行。
    const j = /^--jobs=(\d+)$/.exec(a)
    if (j) { opts.jobs = Math.max(1, Math.min(16, Number(j[1]))); continue }
    // ★ test CI 支持（issue #73）：`--exclude=<子串>` 可多次传入，排除依赖**本地产物**
    //   （如 python/bench/.venv、artifacts/release-c2-asset-pack/*.tgz 均在 .gitignore 里，
    //   CI 全新克隆必然缺失）或需要**真实网络**的套件。本地全量回归不受影响（不传即不排除）。
    const x = /^--exclude=(.+)$/.exec(a)
    if (x) { opts.exclude.push(x[1]); continue }
    if (a === '--help' || a === '-h') { opts.help = true; continue }
    console.error('[run-smoke] unknown argument: ' + a)
    process.exit(2)
  }
  return opts
}

function listSuites(filter, exclude) {
  let names = []
  try { names = readdirSync(SMOKE_DIR) } catch (e) {
    console.error('[run-smoke] cannot read ' + SMOKE_DIR + ': ' + (e && e.message || e))
    process.exit(2)
  }
  return names
    .filter((n) => n.endsWith('.mjs'))
    .filter((n) => !filter || n.includes(filter))
    .filter((n) => !(exclude || []).some((x) => n.includes(x)))
    .filter((n) => { try { return statSync(path.join(SMOKE_DIR, n)).isFile() } catch (e) { return false } })
    .sort()
}

/**
 * Windows 下 SIGKILL 对 node 是"尽力而为":子进程可能还有自己 spawn 的后代。
 * 先 taskkill /T /F 拆整棵树,再补一发 child.kill 兜底。
 */
function hardKill(child) {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch (e) {}
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch (e) {}
  }
  try { child.kill('SIGKILL') } catch (e) {}
}

function runSuite(file, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const capture = (chunk, sink) => {
      const s = String(chunk)
      const next = (sink === 'out' ? out : err) + s
      if (sink === 'out') out = next.length > TAIL_CHARS ? next.slice(-TAIL_CHARS) : next
      else err = next.length > TAIL_CHARS ? next.slice(-TAIL_CHARS) : next
    }
    child.stdout.on('data', (c) => capture(c, 'out'))
    child.stderr.on('data', (c) => capture(c, 'err'))

    let settled = false
    let timedOut = false
    let timer = null
    let reapTimer = null

    const finish = (status, code, signal) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (reapTimer) clearTimeout(reapTimer)
      // 先杀、后收管道:反过来会让子进程向已断管道写日志(见文件头第 2 条)。
      if (status === 'TIMEOUT') hardKill(child)
      try { child.stdout.destroy() } catch (e) {}
      try { child.stderr.destroy() } catch (e) {}
      resolve({
        name: path.basename(file),
        status,
        code,
        signal,
        seconds: (Date.now() - started) / 1000,
        tail: (out + (err ? '\n--- stderr ---\n' + err : '')).trimEnd(),
      })
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        hardKill(child)
        // 杀完仍可能因为握有子进程/句柄而迟迟不触发 exit:给一段收尸窗口,到点直接判定。
        reapTimer = setTimeout(() => finish('TIMEOUT', null, 'SIGKILL'), REAP_GRACE_MS)
      }, timeoutMs)
    }

    child.on('error', () => finish('FAIL', null, null))
    child.on('close', (code, signal) => {
      if (timedOut) return finish('TIMEOUT', code, signal)
      finish(code === 0 ? 'PASS' : 'FAIL', code, signal)
    })
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log('usage: node tools/run-smoke.mjs [--timeout=<ms>] [--filter=<substr>] [--exclude=<substr>]...')
    return 0
  }
  const suites = listSuites(opts.filter, opts.exclude)
  if (!suites.length) {
    console.error('[run-smoke] no suites matched in ' + SMOKE_DIR + (opts.filter ? ' (filter=' + opts.filter + ')' : ''))
    return 2
  }

  const jobs = Math.max(1, Math.min(16, opts.jobs || 1))
  console.log('[run-smoke] ' + suites.length + ' suite(s) in tests/smoke, per-suite timeout='
    + (opts.timeoutMs > 0 ? opts.timeoutMs + 'ms' : 'disabled')
    + ', ' + (jobs === 1 ? 'sequential (never parallel)' : 'parallel x' + jobs))
  console.log('')

  const results = []
  const runStart = Date.now()
  let done = 0
  // ★T7-c：进度行。写成 `[12/135] (1m02s) 最近: xxx.mjs`，让"还要等多久"一眼可见。
  //   串行时每套件跑完刷新一次；并行时也在每个完成点刷新（谁先完成谁先报）。
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000)
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's'
  }
  const report = (r) => {
    results.push(r)
    done++
    const mark = r.status === 'PASS' ? 'PASS   ' : (r.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL   ')
    console.log('[' + mark + '] ' + r.name + '  (' + r.seconds.toFixed(1) + 's)'
      + (r.status === 'PASS' ? '' : '  exit=' + r.code + ' sig=' + r.signal))
    // 进度行:已跑完 X/N,已耗时,最近完成者。末行会被汇总覆盖,不留垃圾。
    const pct = String(Math.round((done / suites.length) * 100)).padStart(3)
    console.log('   └─ ' + pct + '% [' + done + '/' + suites.length + ']  已耗时 ' + fmtDur(Date.now() - runStart)
      + '  最近: ' + r.name)
  }

  if (jobs === 1) {
    for (const name of suites) {
      report(await runSuite(path.join(SMOKE_DIR, name), opts.timeoutMs))
    }
  } else {
    // 有界工作池:固定 jobs 个 worker 从同一下标游标取任务,天然限流、无第三方依赖。
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const i = cursor++
        if (i >= suites.length) return
        const r = await runSuite(path.join(SMOKE_DIR, suites[i]), opts.timeoutMs)
        report(r)
      }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, () => worker()))
  }

  const pass = results.filter((r) => r.status === 'PASS')
  const fail = results.filter((r) => r.status === 'FAIL')
  const timeout = results.filter((r) => r.status === 'TIMEOUT')
  const totalSeconds = (Date.now() - runStart) / 1000

  console.log('')
  console.log('================ SUMMARY ================')
  console.log('PASS ' + pass.length + ' / FAIL ' + fail.length + ' / TIMEOUT ' + timeout.length
    + '   (total ' + totalSeconds.toFixed(1) + 's)')
  for (const r of [...timeout, ...fail]) {
    console.log('')
    console.log('--- ' + r.status + ': ' + r.name + (r.status === 'TIMEOUT' ? '  (exceeded ' + opts.timeoutMs + 'ms)' : '  (exit=' + r.code + ')') + ' ---')
    console.log('last output tail:')
    console.log(r.tail ? r.tail.split('\n').slice(-25).join('\n') : '(no output captured)')
  }
  console.log('=========================================')

  return (fail.length || timeout.length) ? 1 : 0
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('[run-smoke] runner crashed: ' + (e && (e.stack || e.message) || e))
  process.exit(2)
})
