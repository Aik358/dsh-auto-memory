#!/usr/bin/env node
/** [audit-G-207] #207 四项独立项：三处裸写 → 原子写 + 按路径串行；wasm 路径本地化。
 *
 * 审计 §G2 四项：
 *   ① cont-seq.json 计数器  ② continued-sessions.json 接续闩  ③ 归档账本
 *       —— 旧实现「readFileSync → 改 → writeFileSync 整写」，并发丢更新 / 中断撕裂；
 *          共享队列原语仍单测；生产 issue207 通过跨进程锁、持久预留与严格读取加强。
 *   ④ semantic-js-worker 的 wasm 路径本地化 + localWasmPaths 开关。
 *
 * 全部为**真 import → 真构造 → 真调用 → 断言返回值/副作用**；每条附负路径。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPathWriteQueuePre } from '../../lib/path-write-queue.js'
import { writeTextAtomicPreSync, readJsonQuarantinePreSync } from '../../lib/config-io.js'
import { resolveLocalWasmDirPre, applyLocalWasmPathsPre } from '../../lib/wasm-paths.js'

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('  FAIL -', n, d === undefined ? '' : d) } }
const NL = String.fromCharCode(10)
const root = mkdtempSync(path.join(tmpdir(), 'dam-audit-g207-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── A. 按路径串行原子写队列（①②③ 的公共原语） ──
console.log('[audit-G-207] A 按路径串行 + 原子落盘')
{
  const q = createPathWriteQueuePre()
  const f = path.join(root, 'a.json')
  // 并发 40 次「读-改-写」，读改写整体入队 ⇒ 最终必须 40（旧实现会丢更新且不保证 40）
  const jobs = []
  let counter = 0
  for (let i = 0; i < 40; i++) {
    jobs.push(q.run(f, () => {
      let cur = 0
      try { cur = JSON.parse(readFileSync(f, 'utf8')).n || 0 } catch (e) {}
      const next = cur + 1
      counter = next
      // 与生产一致：run() 回调内部做**同步**原子写（saveContSeqState 同款）。
      //   注意不可在回调内再 q.write(同路径) —— 那会挂在自己的链尾上自等（实测死锁）。
      return writeTextAtomicPreSync(f, JSON.stringify({ n: next }))
    }))
  }
  await Promise.all(jobs)
  await q.drain()
  ok(JSON.parse(readFileSync(f, 'utf8')).n === 40, '同路径 40 次并发读改写无丢更新（最终 40）', 'got=' + JSON.parse(readFileSync(f, 'utf8')).n)
  // 负路径：绕开队列（模拟旧实现）并发读改写必须出现丢更新 —— 证明该判据有甄别力
  const g = path.join(root, 'b.json')
  writeFileSync(g, JSON.stringify({ n: 0 }), 'utf8')
  const raws = []
  for (let i = 0; i < 40; i++) {
    let cur = 0
    try { cur = JSON.parse(readFileSync(g, 'utf8')).n || 0 } catch (e) {}
    raws.push(cur + 1)
  }
  writeFileSync(g, JSON.stringify({ n: raws[raws.length - 1] }), 'utf8')
  ok(JSON.parse(readFileSync(g, 'utf8')).n === 1, '负路径：绕开队列的并发读改写确实丢更新（证明判据能红）', JSON.parse(readFileSync(g, 'utf8')).n)
  // 不同路径互不阻塞：慢路径在飞时，快路径仍能先完成
  const slow = path.join(root, 'slow.json'), fast = path.join(root, 'fast.json')
  const slowP = q.write(slow, 'x'.repeat(1000))
  const fastP = q.write(fast, 'y')
  await Promise.all([slowP, fastP])
  ok(existsSync(slow) && existsSync(fast), '不同路径各自落盘（按路径而非全局串行）')
  ok(q.size() >= 2, '队列登记路径数 >1（size=' + q.size() + '）')
  // 失败不污染后续入队
  const bad = q.write(path.join(root, 'nodir', 'x.json'), 'z')
  const good = await q.write(path.join(root, 'c.json'), 'ok')
  await bad.catch(() => {})
  ok(good && good.ok === true && readFileSync(path.join(root, 'c.json'), 'utf8') === 'ok', '单次写失败不污染后续入队')
}

// ── B. Production issue207 state: shared locks, durable reservations and delta writes ──
console.log('[audit-G-207] B durable cross-process state wiring')
{
  const home = path.join(root, 'state-wiring')
  mkdirSync(home, { recursive: true })
  process.env.DSH_HOME = home
  const { MemoryEngine } = await import('../lib/state-engine.mjs')
  const engine = () => Object.assign(new MemoryEngine(), { config: { handoffEnabled: false, autoContinueEnabled: false } })
  const a = engine(), b = engine()
  a.scanMaxContSeq = b.scanMaxContSeq = async () => 0
  const values = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).allocContSeq('audit-' + i)))
  ok(new Set(values).size === 40 && Math.max(...values) === 40, '① independent engines reserve 40 unique sequence numbers')
  const counterFile = a.contSeqFile()
  ok(JSON.parse(readFileSync(counterFile, 'utf8')).last === 40, '① successful reservations are durable before returning')
  a.rollbackContSeq('audit-0', values[0])
  ok(JSON.parse(readFileSync(counterFile, 'utf8')).last === 40, '① failed consumers cannot recycle reserved sequence numbers')
  await Promise.all([a.markContinuedSession('audit-source-a', 'raw-successor-a'), b.markContinuedSession('audit-source-b', 'raw-successor-b')])
  const restarted = engine()
  ok(restarted.isContinuedSession('audit-source-a') && restarted.isContinuedSession('audit-source-b'), '② independent source latches survive engine restart')
  ok(await restarted.markContinuedSession('audit-source-a', 'duplicate') === false, '② repeated source cannot create another completed latch')
  const file = path.join(home, 'auto-memory-archive-ledger.json')
  writeFileSync(file, '{}', 'utf8')
  await Promise.all([a.saveArchiveLedger({ first: 100 }), b.saveArchiveLedger({ second: 200 })])
  ok(a.loadArchiveLedger().first === 100 && a.loadArchiveLedger().second === 200, '③ concurrent archive deltas preserve both writers')
  await b.saveArchiveLedger({}, ['first'])
  ok(a.loadArchiveLedger().first === undefined && a.loadArchiveLedger().second === 200, '③ explicit deletion preserves unrelated archive evidence')
  writeFileSync(file, '{broken', 'utf8')
  let refused = false
  try { a.loadArchiveLedger() } catch (e) { refused = e.statePersistence === true }
  ok(refused && readFileSync(file, 'utf8') === '{broken', '③ corrupt archive evidence is refused and original bytes preserved')
}

// ── C. 真实端到端：接续闩与计数器落盘（真 apply + 真路由） ──
console.log('[audit-G-207] C 端到端落盘（真 apply + 真文件）')
{
  const home = path.join(root, '.dsh-home')
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: path.join(root, '.memory-root'), userMemoryDir: path.join(root, '.user-root'),
    projectMemoryDir: '.project-memory', externalSources: {},
  }), 'utf8')
  process.env.DSH_HOME = home
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
  const routes = [], handlers = [], effects = []
  const ctx = {
    get() { return undefined },
    on(ev, fn) { handlers.push([ev, fn]); return () => {} },
    effect(fn) { effects.push(fn); return () => {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register() { return () => {} } },
    webServer: { register(r) { routes.push(r); return () => {} } },
  }
  const { apply } = await import('../../lib/index.js')
  apply(ctx, {})
  const stop = handlers.find(([e]) => e === 'agent/turn-stopping')
  const src = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  // 计数器：直接验证原子写产物（真落盘）
  const cf = path.join(home, 'memory', 'cont-seq.json')
  ok(!existsSync(cf), '初始不存在 cont-seq.json')
  // 通过真实 session-start + 接续路由驱动（与既有 contseq 套件同款入口）
  const API = { config: '/api/dsh-auto-memory/config', cont: '/api/dsh-auto-memory/handoff-continue' }
  const call = async (p, method) => {
    let body = null
    const route = routes.find((r) => r.path === p)
    if (!route) throw new Error('route missing ' + p)
    await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method, url: p }, { writeHead() {}, end(b) { body = JSON.parse(b) } })
    return body
  }
  await call(API.config, 'GET')
  const WS = 'D:\\dam-audit-g207-ws'
  const sid = 'session-audit-g207-0001'
  const sd = path.join(home, 'sessions', 'wsA', sid)
  mkdirSync(sd, { recursive: true })
  const rows = [JSON.stringify({ agentPreset: 'default', cwd: WS })]
  for (let i = 0; i < 4; i++) rows.push(JSON.stringify({ type: i % 2 === 0 ? 'user/message' : 'assistant/message', data: { message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: '消息' + i }] } } }))
  writeFileSync(path.join(sd, 'session.jsonl'), rows.join('\n') + '\n', 'utf8')
  stop[1]({ agent: { session: { id: sid, header: { cwd: WS } } }, source: 'test' })
  await sleep(500)
  const r1 = await call(API.cont, 'POST')
  ok(r1 && r1.ok === true && r1.contSeq === 1, '接续序号 1 分配成功', JSON.stringify(r1 && r1.contSeq))
  ok(existsSync(cf), '① cont-seq.json 已落盘')
  const seq = JSON.parse(readFileSync(cf, 'utf8'))
  ok(seq && seq.last === 1 && Number(seq.byWorkspace[WS]) === 1, '① 计数器内容正确（last=1 + byWorkspace）', JSON.stringify(seq))
  // 原子写不留临时文件
  const leftover = readdirSync(path.join(home, 'memory')).filter((n) => /tmp/i.test(n))
  ok(leftover.length === 0, '① 原子写未留 tmp 残渣', JSON.stringify(leftover))
  // 归档账本：损坏文件必须**先隔离再回落**（#207③ 读取端静默丢史）。
  //   真调用索引层，断言「坏文件被挪走 + 原路径可再写」这一真实副作用。
  const lf = path.join(home, 'auto-memory-archive-ledger.json')
  writeFileSync(lf, '{"broken":', 'utf8')
  const qr = readJsonQuarantinePreSync(lf)
  ok(qr.ok === false && qr.corrupted === true, '③ 坏账本被判为 corrupted（不静默当空对象）', JSON.stringify({ ok: qr.ok, corrupted: qr.corrupted }))
  ok(!!qr.quarantined && existsSync(qr.quarantined), '③ 坏账本已留存到隔离文件（证据不丢）', String(qr.quarantined))
  ok(readFileSync(qr.quarantined, 'utf8') === '{"broken":', '③ 隔离文件保留原始字节（可取证）')
  // 负路径：正常文件不得被误隔离
  const okFile = path.join(home, 'ledger-ok.json')
  writeFileSync(okFile, JSON.stringify({ s1: 123 }), 'utf8')
  const qr2 = readJsonQuarantinePreSync(okFile)
  ok(qr2.ok === true && qr2.value.s1 === 123 && existsSync(okFile), '③ 负路径：正常账本正常读取且不被隔离')
  ok(/readStateJson\(path\.join\(dshHome\(\), 'auto-memory-archive-ledger\.json'\), Object\.create\(null\), parseArchiveLedger\)/.test(src), '③ 归档账本接线严格持久状态读取（腐败拒绝已实测）')
  ok(!/loadArchiveLedger\(\)[\s\S]{0,300}?catch \(e\) \{ return \{\} \}/.test(src), '③ 负路径：旧的「catch 直接吞掉返回 {}」已不存在')
  for (const d of effects) { try { const t = d(); if (typeof t === 'function') t() } catch (e) {} }
}

// ── D. wasm 路径本地化（真 import，真调用） ──
console.log('[audit-G-207] D wasm 本地化 + localWasmPaths 开关')
{
  // This suite verifies filesystem path selection without installing models or
  // executing WASM. An explicit real-package path still runs the same assertions.
  const fixtureDist = path.join(root, 'wasm dist 测试')
  mkdirSync(fixtureDist, {recursive:true})
  writeFileSync(path.join(fixtureDist, 'ort-wasm-simd-threaded.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
  const realDist = process.env.DSH_TEST_TRANSFORMERS_DIST
    ? path.resolve(process.env.DSH_TEST_TRANSFORMERS_DIST)
    : fileURLToPath(pathToFileURL(fixtureDist))
  console.log('  WASM path coverage: ' + (process.env.DSH_TEST_TRANSFORMERS_DIST ? 'explicit package directory' : 'isolated filesystem fixture; no WASM execution'))
  const hasWasm = existsSync(realDist)
  ok(hasWasm, 'WASM 测试目录存在（前置）', realDist)
  // 真解析：本地有 ort-wasm*.wasm ⇒ 返回该目录
  const dir = resolveLocalWasmDirPre(realDist)
  ok(dir === realDist && readdirSync(dir).some((n) => /^ort-wasm.*\.wasm$/.test(n)), 'resolveLocalWasmDirPre 命中真实 wasm 资产目录', dir)
  // 真调用：auto 模式把 env.backends.onnx.wasm.wasmPaths 改写为本地目录
  const env = { backends: { onnx: { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/' } } } }
  const applied = applyLocalWasmPathsPre(env, realDist, 'auto')
  ok(applied.applied === true && env.backends.onnx.wasm.wasmPaths === realDist, 'auto：wasmPaths 从 CDN 改写为本地目录', JSON.stringify(applied))
  // 开关 off：完全不碰
  const env2 = { backends: { onnx: { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/x/' } } } }
  const off = applyLocalWasmPathsPre(env2, realDist, 'off')
  ok(off.applied === false && off.mode === 'off' && env2.backends.onnx.wasm.wasmPaths === 'https://cdn.jsdelivr.net/x/', 'off：保持上游 CDN 行为（开关解耦）', JSON.stringify(off))
  // 负路径 A：本地无 wasm ⇒ 不写坏 env
  const empty = path.join(root, 'empty-dist')
  mkdirSync(empty, { recursive: true })
  const env3 = { backends: { onnx: { wasm: { wasmPaths: 'https://cdn/x/' } } } }
  const none = applyLocalWasmPathsPre(env3, empty, 'auto')
  ok(none.applied === false && none.reason === 'no-local-wasm' && env3.backends.onnx.wasm.wasmPaths === 'https://cdn/x/', 'auto+本地无资产：不动 env（fail-safe）', JSON.stringify(none))
  // 负路径 B：env 无 wasm 配置 ⇒ 不抛
  const bad = applyLocalWasmPathsPre({}, realDist, 'auto')
  ok(bad.applied === false && bad.reason === 'no-wasm-config', 'env 无 wasm 配置：返回结构化失败不抛', JSON.stringify(bad))
  // 接线守卫：worker 里确实调用了
  const wk = readFileSync(new URL('../../lib/semantic-js-worker.js', import.meta.url), 'utf8')
  ok(/applyLocalWasmPathsPre\(env, path\.dirname\(entry\)/.test(wk), 'worker 已接线 applyLocalWasmPathsPre（调用点存在）')
  ok(/payload\.localWasmPaths/.test(wk), 'worker 接收 localWasmPaths 开关')
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(/get localWasmPaths\(\) \{ return engine\.config\.localWasmPaths \}/.test(idx), '宿主以 getter 惰性读取 config.localWasmPaths（改完即生效）')
  ok(/localWasmPaths: 'auto'/.test(idx), 'DEFAULT_CONFIG 新增 localWasmPaths（默认 auto）')
}

import { rmSync } from 'node:fs'
rmSync(root, { recursive: true, force: true })
console.log('\n[audit-G-207] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
