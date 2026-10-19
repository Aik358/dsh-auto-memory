/**
 * a29 — Python 语义侧车「静默残废」根治（2026-10-19）
 *
 * 事故（真机取证）：
 *   · 活跃侧车 PID 56780 的 cmdline 是裸 `python …worker_semantic_v1.py`，实际落到
 *     C:\Python314\python.exe（系统 python，无 transformers）⇒ embedding-init-failed（stderr 67 字节）
 *     ⇒ embedder=None ⇒ dense_search 恒 [] ⇒ 256/256 shadow 决策全 suppress_low_signal。
 *   · 进程**从未退出**（stats.starts=1 / exits=0 / exitKinds 全 0）⇒ 主诊断日志里没有任何崩溃记录，
 *     且 lastStderrTail 只在退出时落盘 ⇒ 界面上完全看不出「活着但残废」。
 *
 * 本套件**真执行**被测代码（真构造 client / 真 spawn fixture 进程 / 真发真收协议帧），
 * 不用「源码含某字符串」充当功能验收（仅 F 组那段日志轮转为守卫，已显式标注）。
 *
 * 覆盖：
 *   A. 解释器验证闸（requireVerifiedCommand）—— 拿不到已验证命令时**拒绝 spawn**（负路径）
 *   B. 真实拿到命令后 spawn（正路径）
 *   C. stderr 增量告警 —— 进程不死也能看见错误
 *   D. 长驻 health 巡检 —— 对正在服务的进程发帧并识别「活着但残废」
 *   E. debug 视图暴露解释器与健康账本
 *   F. ctx-host 诊断日志轮转（守卫，非功能证据）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createPythonSidecarClientPre } from '../../lib/python-sidecar-client.js'

const root = fs.mkdtempSync(path.join(tmpdir(), 'dam-a29-'))
let pass = 0
const ok = (cond, label) => { assert.ok(cond, label); pass++; console.log('  ok   - ' + label) }
const eq = (a, b, label) => { assert.equal(a, b, label); pass++; console.log('  ok   - ' + label) }

const WORKER_SRC = "let buf = ''\nconst CFG = JSON.parse(process.env.FIXTURE_CFG || '{}')\nprocess.stdin.on('data', (c) => {\n  buf += c.toString('utf8')\n  let i\n  while ((i = buf.indexOf('\\n')) >= 0) {\n    const line = buf.slice(0, i); buf = buf.slice(i + 1)\n    if (!line.trim()) continue\n    let f = null\n    try { f = JSON.parse(line) } catch (_) { continue }\n    const reply = (type, payload) => {\n      process.stdout.write(JSON.stringify({ protocolVersion: 'm7_wire_pre_v1', frameId: 'f_x', requestId: f.requestId, workerEpoch: f.workerEpoch || '', type, payload, sentAt: 0 }) + '\\n')\n    }\n    if (f.type === 'health') {\n      reply('health_result', { worker: 'semantic', embedding: { enabled: CFG.enabled !== false, ready: CFG.ready === true, provider: 'fixture', error: CFG.embeddingError || '' } })\n    } else if (f.type === 'context_push') {\n      reply('context_ack', { observationId: (f.payload || {}).observationId || '', accepted: true })\n    } else {\n      reply('index_ack', { accepted: true })\n    }\n  }\n})\nprocess.stdin.resume()\n"

/**
 * 一个**最小但真实**的 worker 夹具（Node 脚本）：
 *   · 读 stdin 的 JSONL 帧、按 RESPONSE_TYPE_FOR_PRE_V1 回对应类型；
 *   · health 回「健康」还是「活着但残废」，由 env FIXTURE_CFG 决定 ⇒ 两种真实现场都可造。
 * 用它而不是真 python：套件在无 onnxruntime/transformers 的机器上也能确定性跑通。
 */
function writeWorker(file) {
  fs.writeFileSync(file, WORKER_SRC, 'utf8')
}

try {
  // ───────────────────────── A. 解释器验证闸（负路径） ─────────────────────────
  console.log('A. requireVerifiedCommand：拿不到已验证解释器 ⇒ 拒绝 spawn')
  {
    const never = path.join(root, 'never-worker.mjs')
    writeWorker(never)
    let resolverCalls = 0
    const c = createPythonSidecarClientPre({
      requireVerifiedCommand: true,
      resolveCommand: async () => { resolverCalls++; return { ok: false, command: '', reason: '无候选解释器通过依赖探测' } },
      scriptPath: never, dshHome: root, requestTimeoutMs: 1500,
    })
    const res = await c.request('health', {}, { timeoutMs: 1500 })
    eq(res.ok, false, 'A1 结构化失败（不抛）')
    eq(res.code, 'interpreter-unverified', 'A2 ★负路径：拒绝码是 interpreter-unverified（不是静默用裸 python 顶上）')
    eq(c.isStarted(), false, 'A3 ★没有起任何进程')
    eq(resolverCalls, 1, 'A4 解析确实被调用一次（不是压根没走验证）')
    const dv = c.debugView()
    eq(dv.interpreter.resolveFailures >= 1, true, 'A5 解析失败已记账')
    eq(dv.stats.starts, 0, 'A6 ★stats.starts 仍为 0（没有偷偷 spawn 过任何解释器）')
    c.dispose()
  }

  // ───────────────────────── B. 正路径：真 spawn ─────────────────────────
  console.log('B. 拿到已验证命令 ⇒ 真 spawn 真应答')
  {
    const w = path.join(root, 'ok-worker.mjs')
    writeWorker(w)
    const c = createPythonSidecarClientPre({
      requireVerifiedCommand: true,
      resolveCommand: async () => ({ ok: true, command: process.execPath, source: 'probe' }),
      scriptPath: w, dshHome: root, requestTimeoutMs: 8000,
    })
    const res = await c.request('health', {}, { timeoutMs: 8000 })
    eq(res.ok, true, 'B1 真进程真应答')
    eq(c.isStarted(), true, 'B2 进程已起')
    const dv = c.debugView()
    eq(dv.interpreter.source, 'probe', 'B3 debug 暴露命令来源')
    eq(String(dv.interpreter.command).length > 0, true, 'B4 ★debug 暴露**实际 spawn 的命令**（此前没有这个字段）')
    eq(dv.interpreter.requireVerified, true, 'B5 debug 如实标记验证模式')
    eq(dv.stats.starts, 1, 'B6 只起了 1 个进程')
    c.dispose()
  }

  // ───────────────────────── C. stderr 增量告警 ─────────────────────────
  console.log('C. stderr 增量告警：进程不死也能看见错误')
  {
    const w = path.join(root, 'noisy-worker.mjs')
    fs.writeFileSync(w, "process.stderr.write(\"[worker_v1] embedding-init-failed: No module named 'transformers'\\n\")\nprocess.stdin.resume()\n", 'utf8')
    const c = createPythonSidecarClientPre({ command: process.execPath, scriptPath: w, dshHome: root, requestTimeoutMs: 2000 })
    c.request('health', {}, { timeoutMs: 1200 }).catch(() => {})
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && c.debugView().stats.stderrAlerts === 0) await new Promise(r => setTimeout(r, 50))
    const dv = c.debugView()
    eq(dv.stats.stderrAlerts >= 1, true, 'C1 ★stderr 报错被**增量**捕获（旧实现只在进程退出时落盘）')
    eq(dv.stats.exits, 0, 'C2 进程**没有退出**（证明捕获不依赖退出路径）')
    const hits = (dv.recentDiag || []).filter(d => String(d.message).includes('embedding-init-failed'))
    eq(hits.length >= 1, true, 'C3 诊断环形缓冲里有这条错误原文')
    eq(String(hits[0] && hits[0].message).includes('活着但残废'), true, 'C4 归因文案点明这是「活着但残废」的现场')
    c.dispose()
  }

  // ───────────────────────── D. 长驻 health 巡检 ─────────────────────────
  console.log('D. 长驻 health 巡检：问**正在服务的那个进程**')
  {
    const badW = path.join(root, 'degraded-worker.mjs')
    writeWorker(badW)
    const prevCfg = process.env.FIXTURE_CFG
    process.env.FIXTURE_CFG = JSON.stringify({ enabled: true, ready: false, embeddingError: 'embedding-init-failed' })
    const cBad = createPythonSidecarClientPre({ command: process.execPath, scriptPath: badW, dshHome: root, requestTimeoutMs: 8000 })
    // 生产顺序：先有语义请求把进程拉起来，巡检才去问它（巡检本身**不会** spawn —— 见 D9/D11）。
    await cBad.request('health', {}, { timeoutMs: 8000 })
    const rBad = await cBad.checkHealthOnce({ timeoutMs: 8000 })
    eq(rBad.ok, false, 'D1 ★负路径：有应答但 embedder 未就绪 ⇒ 判不健康')
    eq(rBad.code, 'embedder-degraded', 'D2 归因码是 embedder-degraded（不是笼统的 request-failed）')
    eq(cBad.debugView().health.degraded, 1, 'D3 degraded 计数 +1')
    eq(cBad.debugView().stats.starts, 1, 'D4 ★真相在此：**长驻进程**只起了 1 个（不是另起短命探针）')
    cBad.dispose()

    process.env.FIXTURE_CFG = JSON.stringify({ enabled: true, ready: true })
    const goodW = path.join(root, 'healthy-worker.mjs')
    writeWorker(goodW)
    const cGood = createPythonSidecarClientPre({ command: process.execPath, scriptPath: goodW, dshHome: root, requestTimeoutMs: 8000 })
    await cGood.request('health', {}, { timeoutMs: 8000 })
    const rGood = await cGood.checkHealthOnce({ timeoutMs: 8000 })
    eq(rGood.ok, true, 'D5 正路径：embedder 就绪 ⇒ 判健康')
    eq(rGood.embedderOk, true, 'D6 embedderOk 如实为 true')
    const dv = cGood.debugView()
    eq(dv.health.lastEmbedderOk, true, 'D7 health 账本记录了 embedder 结论')
    eq(dv.health.checks >= 1, true, 'D8 巡检次数已记账')

    const cIdle = createPythonSidecarClientPre({ command: process.execPath, scriptPath: goodW, dshHome: root, requestTimeoutMs: 800 })
    const rIdle = await cIdle.checkHealthOnce({ timeoutMs: 800 })
    eq(rIdle.ok, false, 'D9 负路径：进程未启动 ⇒ 不健康，且不得为此 spawn')
    eq(rIdle.code, 'not-started', 'D10 归因码 not-started')
    eq(cIdle.isStarted(), false, 'D11 巡检不得产生副作用（没起进程）')
    cIdle.dispose()
    cGood.dispose()
    if (prevCfg === undefined) delete process.env.FIXTURE_CFG; else process.env.FIXTURE_CFG = prevCfg
  }

  // ───────────────────────── E. debug 视图字段完整性 ─────────────────────────
  console.log('E. debug 视图暴露排查所需字段')
  {
    const w = path.join(root, 'dbg-worker.mjs')
    writeWorker(w)
    const c = createPythonSidecarClientPre({ command: process.execPath, scriptPath: w, dshHome: root, requestTimeoutMs: 4000 })
    const dv0 = c.debugView()
    ok('interpreter' in dv0, 'E1 debug.interpreter 存在（此前完全没有）')
    ok('health' in dv0, 'E2 debug.health 存在（长驻进程健康账本）')
    eq(typeof dv0.stats.stderrAlerts, 'number', 'E3 debug 暴露 stderrAlerts 计数')
    await c.request('health', {}, { timeoutMs: 4000 })
    eq(String(c.debugView().interpreter.command).length > 0, true, 'E4 spawn 后 interpreter.command 有值')
    c.dispose()
  }

  // ───────────────────────── F. ctx-host 诊断日志轮转（守卫） ─────────────────────────
  console.log('F. ctx-host 诊断日志轮转（⚠守卫，非功能证据：真跑需注入 2MB 日志）')
  {
    const hostMod = await import('../../lib/context-host.js')
    ok(typeof hostMod.createContextHost === 'function', 'F1 context-host 可加载')
    const src = fs.readFileSync(new URL('../../lib/context-host.js', import.meta.url), 'utf8')
    const m = /const CTX_DIAG_MAX_BYTES = (\d+) \* 1024 \* 1024/.exec(src)
    ok(!!m, 'F2 轮转阈值常量存在且为 MB 量级')
    eq(Number(m[1]), 2, 'F3 阈值 = 2MB（与主诊断日志同口径）')
    ok(src.includes('renameSync(file, bak)'), 'F4 真改名（不是删除）')
    ok(src.includes("file + '.1'"), 'F5 保留一份历史（与主日志同命名）')
    const diagFn = /function diagCtx\(msg\) \{[\s\S]{0,900}?rotateCtxDiagIfNeeded\(diagFile\)/.exec(src)
    ok(!!diagFn, 'F6 ★diagCtx 真的调用了轮转（接线不算漏）')
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\n结果: ' + pass + ' PASS / 0 FAIL')
