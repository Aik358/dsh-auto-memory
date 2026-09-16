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
/** 每个套件保留的输出尾部字符数(用于定位卡点,不需要全量)。 */
const TAIL_CHARS = 2000
/** 收到退出信号后,最多再等多久收尸(毫秒),防止运行器自己挂住。 */
const REAP_GRACE_MS = 5000

function parseArgs(argv) {
  const opts = { timeoutMs: DEFAULT_TIMEOUT_MS, filter: '' }
  for (const a of argv) {
    const m = /^--timeout=(\d+)$/.exec(a)
    if (m) { opts.timeoutMs = Number(m[1]); continue }
    const f = /^--filter=(.+)$/.exec(a)
    if (f) { opts.filter = f[1]; continue }
    if (a === '--help' || a === '-h') { opts.help = true; continue }
    console.error('[run-smoke] unknown argument: ' + a)
    process.exit(2)
  }
  return opts
}

function listSuites(filter) {
  let names = []
  try { names = readdirSync(SMOKE_DIR) } catch (e) {
    console.error('[run-smoke] cannot read ' + SMOKE_DIR + ': ' + (e && e.message || e))
    process.exit(2)
  }
  return names
    .filter((n) => n.endsWith('.mjs'))
    .filter((n) => !filter || n.includes(filter))
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
    console.log('usage: node tools/run-smoke.mjs [--timeout=<ms>] [--filter=<substr>]')
    return 0
  }
  const suites = listSuites(opts.filter)
  if (!suites.length) {
    console.error('[run-smoke] no suites matched in ' + SMOKE_DIR + (opts.filter ? ' (filter=' + opts.filter + ')' : ''))
    return 2
  }

  console.log('[run-smoke] ' + suites.length + ' suite(s) in tests/smoke, per-suite timeout='
    + (opts.timeoutMs > 0 ? opts.timeoutMs + 'ms' : 'disabled') + ', sequential (never parallel)')
  console.log('')

  const results = []
  const runStart = Date.now()
  for (const name of suites) {
    const r = await runSuite(path.join(SMOKE_DIR, name), opts.timeoutMs)
    results.push(r)
    const mark = r.status === 'PASS' ? 'PASS   ' : (r.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL   ')
    console.log('[' + mark + '] ' + r.name + '  (' + r.seconds.toFixed(1) + 's)'
      + (r.status === 'PASS' ? '' : '  exit=' + r.code + ' sig=' + r.signal))
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
