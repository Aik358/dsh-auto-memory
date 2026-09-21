#!/usr/bin/env node
/**
 * Zero-dependency smoke-suite runner.
 *
 * Why this exists instead of `node --test`: the smoke files are standalone
 * programs, and a broken suite can keep the event loop alive indefinitely.
 * Every suite therefore runs in its own process with a wall-clock timeout.
 * On timeout we kill the process tree first, while continuing to drain stdout
 * and stderr, so a stuck suite cannot hang the whole regression run.
 *
 * Usage:
 *   node tools/run-smoke.mjs
 *   node tools/run-smoke.mjs --filter=handoff
 *   node tools/run-smoke.mjs --exclude=-live- --exclude=c4-fresh-install-pre
 *   node tools/run-smoke.mjs --jobs=1 --timeout=90000
 *   node tools/run-smoke.mjs --timeout=0   # disable timeout
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.dirname(SCRIPT_DIR)
const SMOKE_DIR = path.join(REPO_ROOT, 'tests', 'smoke')
const DEFAULT_JOBS = 4
const DEFAULT_TIMEOUT_MS = 60_000
const OUTPUT_TAIL_CHARS = 64 * 1024

function usage(message) {
  if (message) console.error(`error: ${message}\n`)
  console.error([
    'Usage: node tools/run-smoke.mjs [options]',
    '',
    'Options:',
    '  --filter=TEXT       run suites whose filename contains TEXT (repeatable)',
    '  --exclude=TEXT      skip suites whose filename contains TEXT (repeatable)',
    `  --jobs=N            concurrent suites (default ${DEFAULT_JOBS})`,
    `  --timeout=MS        per-suite wall timeout in ms (default ${DEFAULT_TIMEOUT_MS}; 0 disables)`,
    '  -h, --help          show this help',
  ].join('\n'))
  process.exit(message ? 2 : 0)
}

function readOptionValue(argv, index, name) {
  const arg = argv[index]
  const prefix = `--${name}=`
  if (arg.startsWith(prefix)) return { value: arg.slice(prefix.length), consumed: 0 }
  if (arg === `--${name}`) {
    if (index + 1 >= argv.length) usage(`--${name} requires a value`)
    return { value: argv[index + 1], consumed: 1 }
  }
  return null
}

function parseArgs(argv) {
  const opts = { filters: [], excludes: [], jobs: DEFAULT_JOBS, timeoutMs: DEFAULT_TIMEOUT_MS }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') usage()

    let parsed = readOptionValue(argv, i, 'filter')
    if (parsed) {
      if (!parsed.value) usage('--filter must not be empty')
      opts.filters.push(parsed.value)
      i += parsed.consumed
      continue
    }

    parsed = readOptionValue(argv, i, 'exclude')
    if (parsed) {
      if (!parsed.value) usage('--exclude must not be empty')
      opts.excludes.push(parsed.value)
      i += parsed.consumed
      continue
    }

    const jobsEq = /^--jobs=(\d+)$/.exec(arg)
    if (jobsEq) {
      opts.jobs = Math.min(16, Number(jobsEq[1]))
      if (!Number.isSafeInteger(opts.jobs) || opts.jobs < 1) usage('--jobs must be >= 1')
      continue
    }

    parsed = readOptionValue(argv, i, 'jobs')
    if (parsed) {
      if (!/^\d+$/.test(parsed.value)) usage('--jobs must be a positive integer')
      opts.jobs = Math.min(16, Number(parsed.value))
      if (!Number.isSafeInteger(opts.jobs) || opts.jobs < 1) usage('--jobs must be >= 1')
      i += parsed.consumed
      continue
    }

    parsed = readOptionValue(argv, i, 'timeout')
    if (parsed) {
      if (!/^\d+$/.test(parsed.value)) usage('--timeout must be a non-negative integer')
      opts.timeoutMs = Number(parsed.value)
      if (!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs < 0) usage('--timeout must be >= 0')
      i += parsed.consumed
      continue
    }

    usage(`unknown option: ${arg}`)
  }
  return opts
}

function appendTail(current, chunk) {
  const next = current + chunk.toString('utf8')
  return next.length > OUTPUT_TAIL_CHARS ? next.slice(-OUTPUT_TAIL_CHARS) : next
}

function formatSeconds(ms) {
  return (ms / 1000).toFixed(1) + 's'
}

function killProcessTree(child) {
  const pid = child.pid
  if (!pid) return Promise.resolve()

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        try { child.kill('SIGKILL') } catch {}
        resolve()
      }
      killer.once('error', done)
      killer.once('close', done)
    })
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try { child.kill('SIGKILL') } catch {}
  }
  return Promise.resolve()
}

const liveChildren = new Set()
let stopping = false

async function stopAllChildren() {
  if (stopping) return
  stopping = true
  await Promise.allSettled([...liveChildren].map(killProcessTree))
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await stopAllChildren()
    process.exit(130)
  })
}

function runSuite(file, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdoutTail = ''
    let stderrTail = ''
    let timedOut = false
    let spawnError = null
    let settled = false

    const child = spawn(process.execPath, [file], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    liveChildren.add(child)

    child.stdout?.on('data', (chunk) => { stdoutTail = appendTail(stdoutTail, chunk) })
    child.stderr?.on('data', (chunk) => { stderrTail = appendTail(stderrTail, chunk) })

    let timer = null
    if (timeoutMs > 0) {
      timer = setTimeout(async () => {
        timedOut = true
        await killProcessTree(child)
      }, timeoutMs)
      timer.unref?.()
    }

    child.once('error', (error) => { spawnError = error })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      liveChildren.delete(child)
      resolve({
        file,
        name: path.basename(file),
        code,
        signal,
        timedOut,
        spawnError,
        stdoutTail,
        stderrTail,
        elapsedMs: Date.now() - started,
      })
    })
  })
}

function printFailure(result, kind) {
  console.error(`\n--- ${kind}: ${result.name} ---`)
  console.error(`elapsed=${formatSeconds(result.elapsedMs)} exit=${result.code ?? 'null'} signal=${result.signal ?? 'none'}`)
  if (result.spawnError) console.error(result.spawnError.stack || result.spawnError.message || String(result.spawnError))
  const output = [result.stdoutTail, result.stderrTail].filter(Boolean).join('\n').trimEnd()
  if (output) console.error(output)
  else console.error('(no captured output)')
  console.error(`--- END ${kind}: ${result.name} ---\n`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let suites
  try {
    suites = readdirSync(SMOKE_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
      .map((entry) => path.join(SMOKE_DIR, entry.name))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'en'))
  } catch (error) {
    console.error(`failed to enumerate ${SMOKE_DIR}:`, error?.message || error)
    process.exit(2)
  }

  if (opts.filters.length) {
    suites = suites.filter((file) => opts.filters.some((needle) => path.basename(file).includes(needle)))
  }
  if (opts.excludes.length) {
    suites = suites.filter((file) => !opts.excludes.some((needle) => path.basename(file).includes(needle)))
  }
  if (suites.length === 0) {
    console.error('No smoke suites matched the requested filters/excludes.')
    process.exit(2)
  }

  const jobs = Math.min(16, opts.jobs)
  if (jobs === 1) console.log('mode: sequential (never parallel)')
  console.log(`smoke suites: ${suites.length} | jobs=${Math.min(jobs, suites.length)} | timeout=${opts.timeoutMs === 0 ? 'off' : opts.timeoutMs + 'ms'}`)

  const started = Date.now()
  const results = new Array(suites.length)
  let cursor = 0
  let done = 0

  const printProgress = () => {
    const pct = Math.round((done / suites.length) * 100)
    console.log('[' + pct + '%] ' + done + '/' + suites.length + ' 已耗时 ' + formatSeconds(Date.now() - started))
  }

  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= suites.length) return
      const result = await runSuite(suites[index], opts.timeoutMs)
      results[index] = result
      if (result.timedOut) {
        console.error(`TIMEOUT ${result.name} (${formatSeconds(result.elapsedMs)})`)
      } else if (result.spawnError || result.code !== 0) {
        console.error(`FAIL ${result.name} (${formatSeconds(result.elapsedMs)})`)
      } else {
        console.log(`PASS ${result.name} (${formatSeconds(result.elapsedMs)})`)
      }
      done++
      printProgress()
    }
  }

  await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, () => worker()))

  let pass = 0
  let fail = 0
  let timeout = 0
  for (const result of results) {
    if (result.timedOut) {
      timeout++
      printFailure(result, 'TIMEOUT')
    } else if (result.spawnError || result.code !== 0) {
      fail++
      printFailure(result, 'FAIL')
    } else {
      pass++
    }
  }

  console.log(`PASS ${pass} / FAIL ${fail} / TIMEOUT ${timeout} / total ${formatSeconds(Date.now() - started)}`)
  process.exitCode = fail || timeout ? 1 : 0
}

main().catch(async (error) => {
  console.error(error?.stack || error)
  await stopAllChildren()
  process.exitCode = 1
})
