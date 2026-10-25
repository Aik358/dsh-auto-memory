#!/usr/bin/env node
/**
 * probe-epipe-selfignite.mjs —— EPIPE 自激探针
 *
 * 【身份】原件已于 2026-10-24 被误删且从未进 git，无法找回。本文件是依据**存活证据**逐字段重建的：
 *   · artifacts/probe-epipe-runner.ps1            —— 调用契约（位置参数 mode、--boom-delay、--verdict-delay、--keep-streams、--breaker、--sink）
 *   · artifacts/probe-epipe-trace-*.jsonl         —— 内部事件序列与字段（start / handler-installed / streams-broken / boom-thrown / verdict-written / exit）
 *   · artifacts/probe-epipe-runs/*.metrics.json   —— verdict 文件形状（mode / reachedAfterBoom / cpuMs / wallMs）
 *   · artifacts/probe-epipe-FINDINGS.md           —— 判据矩阵
 * 局限与差异见 artifacts/probe-epipe-RESTORED-README.md。
 *
 * 用法（由 runner.ps1 调用）：
 *   node probe-epipe-selfignite.mjs <old|old-stream|new|new-noswallow>
 *        [--boom-delay=800] [--verdict-delay=1500] [--keep-streams] [--breaker=none|both]
 *   node probe-epipe-selfignite.mjs --sink      # 管道读端「立刻退出」的发生器
 *
 * 关键前提（来自 runner 注释，勿改）：本机让 Node 进程级 stdio 写入真正失败的唯一办法，
 * 是从**进程外**关掉真实管道读端；process.stdout.destroy() 在 Node 24 上是 no-op。
 * ⇒ 探针自己**不造断管**，只负责回答「断管发生后，处理器怎么写、写几次、退不退」。
 */
import { writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const T0 = Date.now()

const hasFlag = (k) => argv.includes(k)
const val = (k, d) => { const h = argv.find((a) => a.startsWith(k + '=')); return h ? h.slice(k.length + 1) : d }

// —— --sink：读端「立刻退出」的管道发生器（runner 里 | node probe --sink）——
if (hasFlag('--sink')) {
  try { process.stdout.end() } catch (_) {}
  try { process.stderr.end() } catch (_) {}
  process.exit(0)
}

// 位置参数 = mode（与 runner.ps1 第 50 行一致：$node $probe $Mode ...）
const MODE = String(argv.find((a) => !a.startsWith('--')) || 'old')
const MODES = ['old', 'old-stream', 'new', 'new-noswallow']
if (!MODES.includes(MODE)) { console.error('unknown mode: ' + MODE); process.exit(2) }

const BOOM_DELAY = Math.max(0, Number(val('--boom-delay', '800')) || 0)
const VERDICT_DELAY = Math.max(0, Number(val('--verdict-delay', '1500')) || 0)
const KEEP_STREAMS = hasFlag('--keep-streams')
const BREAKER = val('--breaker', 'none')

const tracePath = path.join(HERE, 'probe-epipe-trace-' + MODE + '.jsonl')
const verdictPath = path.join(HERE, 'probe-epipe-verdict-' + MODE + '.json')

const trace = (ev, extra) => {
  try {
    const row = Object.assign({ t: Date.now() - T0, ev: ev, pid: process.pid }, extra || {})
    appendFileSync(tracePath, JSON.stringify(row) + String.fromCharCode(10), 'utf8')
  } catch (_) {}
}

const snap = (s) => ({ destroyed: s.destroyed, writable: s.writable, writableEnded: s.writableEnded })

// ---- 阶段 1：启动即置流不可写（--keep-streams 时跳过，留给外部管道去断）----
trace('start', {
  mode: MODE, node: process.version, platform: process.platform,
  argv: argv, keepStreams: KEEP_STREAMS, breaker: BREAKER,
  stdoutIsTTY: !!process.stdout.isTTY, stderrIsTTY: !!process.stderr.isTTY,
})

if (!KEEP_STREAMS) {
  const rec = { requested: 'both', afterDestroy: null, afterEnd: null }
  try { process.stdout.destroy() } catch (_) {}
  try { process.stderr.destroy() } catch (_) {}
  rec.afterDestroy = { stdout: snap(process.stdout), stderr: snap(process.stderr) }
  try { process.stdout.end() } catch (_) {}
  try { process.stderr.end() } catch (_) {}
  rec.afterEnd = { stdout: snap(process.stdout), stderr: snap(process.stderr) }
  trace('streams-broken', rec)
} else {
  trace('streams-broken', { skipped: 'keep-streams', note: 'only an external pipe closure can break writes' })
}

// ---- 阶段 2：按 mode 决定「吞不吞写失败」----
function damSwallowStreamErrors(stream) {
  try {
    if (stream && typeof stream.on === 'function' && !stream.__damWriteErrorSwallowed) {
      stream.__damWriteErrorSwallowed = true
      stream.on('error', () => {})
    }
  } catch (_) {}
}
if (MODE === 'new') { damSwallowStreamErrors(process.stderr); damSwallowStreamErrors(process.stdout) }

// ---- 阶段 3：装 uncaughtException 处理器；处理器内按 mode 选择写路径 ----
let entries = 0
function writeByMode() {
  entries++
  if (MODE === 'old') {
    try { console.error('#entry console.error') } catch (_) {}
  } else if (MODE === 'old-stream') {
    try { process.stderr.write('#entry raw stderr.write' + String.fromCharCode(10)) } catch (_) {}
  } else if (MODE === 'new') {
    if (process.stderr && !process.stderr.writableEnded) {
      try { process.stderr.write('#entry guarded write' + String.fromCharCode(10)) } catch (_) {}
    }
  } else if (MODE === 'new-noswallow') {
    try { process.stderr.write('#entry raw stderr.write' + String.fromCharCode(10)) } catch (_) {}
  }
  if (BREAKER === 'both') {
    setTimeout(() => { trace('exit', { code: 0, reason: 'breaker' }); process.exit(0) }, 0)
  }
}
process.on('uncaughtException', () => { writeByMode() })
trace('handler-installed', { mode: MODE })

// ---- 阶段 4：boom（定时抛出，与 runner 的 --boom-delay 对齐）----
setTimeout(() => {
  trace('boom-thrown', { delayMs: BOOM_DELAY })
  const e = new Error('probe-boom')
  e.code = 'probe-boom'
  throw e
}, BOOM_DELAY)

// ---- 阶段 5：verdict（证明「写得出文件」与「退不出进程」可并存）----
setTimeout(() => {
  const wallMs = Date.now() - T0
  let cpuMs = 0
  try { const c = process.cpuUsage(); cpuMs = Math.round((c.user + c.system) / 1000) } catch (_) {}
  try {
    writeFileSync(verdictPath, JSON.stringify({ mode: MODE, reachedAfterBoom: entries > 0, cpuMs: cpuMs, wallMs: wallMs }), 'utf8')
    trace('verdict-written', { cpuMs: cpuMs, wallMs: wallMs })
  } catch (_) {}
  // 判据（与 FINDINGS 矩阵一致）：**免疫形态自己退**；**自激形态写完 verdict 继续转、等 runner 超时杀掉**。
  // 原件行为即如此（矩阵里 old/new 是 exit 0 (own)，old-stream/new-noswallow 是 killed @10s / 90% CPU）。
  // 重建首版错在所有 mode 都在此 exit ⇒ 自激形态只跑到 22.8% CPU，掩盖了真实差异（已修正）。
  const immune = entries <= 1
  if (BREAKER === 'both' || immune) { trace('exit', { code: 0, immune: immune }); process.exit(0) }
}, VERDICT_DELAY)

// 保活：让事件循环不排空（自激形态的必要条件）
setInterval(() => {}, 1000)
