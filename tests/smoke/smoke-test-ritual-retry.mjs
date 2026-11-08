// smoke-test-ritual-retry.mjs — 接续仪式有界重试（#524）
//
// 覆盖 hostRefreshRitual 的重试决策：
//   · completed + 材料有变 → 一次成功
//   · completed + 材料未变（假成功）→ 重试
//   · failed / 超时 → 重试
//   · aborted → 不重试（用户主动中断）
//   · 两次都不成 → 分别落到 partial / 失败原因
//
// 手法同 tests/smoke 里既有的做法：用 new Function 把 hostRefreshRitual / refreshRitualPrompt
// 的函数体从 lib/index.js 抽出来单独执行 —— 不走 apply()，避免注册 interval 与进程级钩子。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const libDir = path.resolve(here, '../../lib')
const src = fs.readFileSync(path.join(libDir, 'index.js'), 'utf8')

function extractBody(source, signature) {
  const i = source.indexOf(signature)
  if (i < 0) throw new Error('未找到签名: ' + signature)
  const b = source.indexOf('{', i)
  let depth = 0
  for (let j = b; j < source.length; j++) {
    const c = source[j]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(b + 1, j)
    }
  }
  throw new Error('括号未闭合: ' + signature)
}

const hostBody = extractBody(src, 'async hostRefreshRitual(oldSid) {')
const promptBody = extractBody(src, 'refreshRitualPrompt(retryHint) {')

const continuation = await import(pathToFileURL(path.join(libDir, 'continuation.js')).href)

const makeHost = new Function(
  'DEFAULT_AUTO_CONTINUE_REFRESH_TIMEOUT_SECONDS',
  'DEFAULT_AUTO_CONTINUE_PROBE_TIMEOUT_SECONDS',
  'continuationProbePre',
  'continuationRitualEndPre',
  // ★2026-11-08（DSH 0.2.2-rc.1 移除 inspect）：事件尾统一走 sessionTailPre，
  //   抽出的函数体在 new Function 作用域里没有模块级绑定 ⇒ 必须按本表纪律一并注入，
  //   否则 ReferenceError 会让仪式整段失效（表现为恒 timeout）。
  'sessionTailPre',
  'randomUUID',
  'diag',
  'Date',
  'setTimeout',
  'return async function (oldSid) {' + hostBody + '}'
)

const promptTail = promptBody.split('return [')[1].split('].filter(Boolean).join(String.fromCharCode(10))')[0]
const makePrompt = new Function('retryHint', 'return [' + promptTail + '].filter(Boolean).join(String.fromCharCode(10))')

function buildEnv(script, opts = {}) {
  const hints = []
  const promptCalls = []
  const logs = []
  const sid = 'sess-test'
  let stamp = 0
  let seq = 0
  let pendingReqId = null
  let turnEnded = false
  let attempts = 0
  let fakeNow = 1_000_000

  const FakeDate = { now: () => fakeNow }
  const fakeSetTimeout = (fn, ms) => {
    fakeNow += Math.max(Number(ms) || 1, 1000)
    queueMicrotask(fn)
    return 0
  }

  const sc = {
    async prompt(args) {
      promptCalls.push(args)
      pendingReqId = args.requestId
      turnEnded = false
      const step = script[attempts - 1] || {}
      if (step.stampUp) stamp++
    },
    async inspect() {
      if (!pendingReqId || turnEnded) return { meta: { id: sid }, events: [] }
      turnEnded = true
      const step = script[attempts - 1] || {}
      if (step.neverEnds) {
        turnEnded = false
        return { meta: { id: sid }, events: [] }
      }
      return {
        meta: { id: sid },
        events: [
          { seq: ++seq, type: 'turn/start', data: { turn: 7 } },
          { seq: ++seq, type: 'user/message', data: { message: { source: { rpcId: pendingReqId } } } },
          { seq: ++seq, type: 'turn/end', data: { turn: 7, reason: { kind: step.kind || 'completed' } } },
        ],
      }
    },
  }

  const self = {
    config: {
      autoContinueRefreshRitual: true,
      autoContinueRefreshTimeoutSeconds: 15,
      autoContinueProbeTimeoutSeconds: 10,
      ...(opts.attempts ? { autoContinueRefreshAttempts: opts.attempts } : {}),
    },
    _sessionController: sc,
    _autoContState: {},
    _ritualPollMs: 1,
    async handoffMaterialStamp() {
      return 'v' + stamp
    },
    refreshRitualPrompt(hint) {
      hints.push(hint)
      attempts++
      return makePrompt(hint)
    },
  }

  let n = 0
  const host = makeHost(
    240, 60,
    (fn) => Promise.resolve().then(() => fn(undefined)),
    continuation.continuationRitualEndPre,
    continuation.sessionTailPre,
    () => 'req-' + (++n) + '-' + Math.random().toString(36).slice(2, 7),
    (m) => logs.push(m),
    FakeDate,
    fakeSetTimeout
  )

  return { host, self, hints, promptCalls, logs }
}

const results = []
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail })
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (cond ? '' : '  << ' + detail))
}

async function run(name, script, opts, expect) {
  console.log('--- ' + name)
  const env = buildEnv(script, opts)
  let r
  try {
    r = await env.host.call(env.self, 'sess-test')
  } catch (e) {
    r = { threw: String((e && e.message) || e) }
  }
  const actual = { ok: r.ok, reason: r.reason, waited: r.waited, attempts: r.attempts, partial: r.partial }
  const want = { ...expect }
  delete want._prompts
  console.log('    ' + JSON.stringify(actual) + '  prompts=' + env.promptCalls.length + ' hints=' + JSON.stringify(env.hints))
  check(name, JSON.stringify(actual) === JSON.stringify(want), '期望 ' + JSON.stringify(want) + ' 实得 ' + JSON.stringify(actual))
  if (expect._prompts !== undefined) check(name + ' · prompt 次数', env.promptCalls.length === expect._prompts, '期望 ' + expect._prompts + ' 实得 ' + env.promptCalls.length)
  return env
}

await run('T1 首次 completed 且材料更新', [{ kind: 'completed', stampUp: true }], {}, { ok: true, waited: 'updated', attempts: 1 })
await run('T2 首次假成功 → 重试成功', [{ kind: 'completed' }, { kind: 'completed', stampUp: true }], {}, { ok: true, waited: 'updated', attempts: 2 })
await run('T3 两次假成功 → partial 但不阻断', [{ kind: 'completed' }, { kind: 'completed' }], {}, { ok: true, waited: 'turn-ended', attempts: 2, partial: true })
await run('T4 首次 failed → 重试成功', [{ kind: 'failed' }, { kind: 'completed', stampUp: true }], {}, { ok: true, waited: 'updated', attempts: 2 })
await run('T5 aborted 不重试', [{ kind: 'aborted' }], {}, { ok: false, reason: 'ritual-aborted', attempts: 1 })
await run('T6 两次 failed', [{ kind: 'failed' }, { kind: 'failed' }], {}, { ok: false, reason: 'ritual-failed', attempts: 2 })
await run('T7 attempts=1 回到旧行为', [{ kind: 'failed' }], { attempts: 1 }, { ok: false, reason: 'ritual-failed', attempts: 1 })
await run('T8 一直不结束 → 预算耗尽即止', [{ neverEnds: true }], {}, { ok: false, reason: 'timeout', attempts: 1 })

const env = await run('T9 重试时把失败原因喂回模型', [{ kind: 'failed' }, { kind: 'completed', stampUp: true }], {}, { ok: true, waited: 'updated', attempts: 2 })
check('T9 · 首轮 hint 为空', env.hints[0] === null, '实得 ' + JSON.stringify(env.hints[0]))
check('T9 · 重试 hint = ritual-failed', env.hints[1] === 'ritual-failed', '实得 ' + JSON.stringify(env.hints[1]))
if (env.promptCalls[1]) check('T9 · 重试 prompt 含「第 2 次尝试」', /第 2 次尝试/.test(env.promptCalls[1].content[0].text), '尾部 ' + env.promptCalls[1].content[0].text.slice(-90))
if (env.promptCalls[0]) check('T9 · 首轮 prompt 不含重试段', !/第 2 次尝试/.test(env.promptCalls[0].content[0].text), '不应含')

const p1 = makePrompt(null)
const p2 = makePrompt('timeout')
check('P1 首轮 prompt 四步齐全', ['0. ', '1. ', '1b. ', '2. '].every((k) => p1.includes(k)), '步骤缺失')
check('P2 重试 prompt 四步齐全', ['0. ', '1. ', '1b. ', '2. '].every((k) => p2.includes(k)), '步骤缺失')
check('P3 重试 prompt 带原因', p2.includes('timeout'), p2.slice(-110))

const pass = results.filter((r) => r.pass).length
console.log('\n[SMOKE ritual-retry] PASS ' + pass + ' / ' + results.length + '  FAIL ' + (results.length - pass))
if (pass !== results.length) {
  results.filter((r) => !r.pass).forEach((r) => console.log('  未过: ' + r.name + ' :: ' + r.detail))
  process.exit(1)
}
