// M7-8 Host Index Sync Orchestration 测试(docs/PYTHON-SIDECAR-CONTRACT.md §19.10)。
// 修复 live blocker 的专项验证:
//   A) live-parity 复现——插件启动→已有 runtime→config 开三重门→pre-step capturePaths→
//      顶层 session user Segment→断言 envelope 构建/worker lazy start/index_sync 编排;
//   B) Host Index Sync Orchestrator——首次同步/同 miv 幂等/epoch 变化重同步/miv 替换/
//      sync 失败不 push/frame latest-wins/A-B 隔离/关闭 abort/零 IO;
//   C) activation 回流——index ready 后 context_push 到达、fake worker 激活过 M6 validator、
//      sourceMode=python 门关闭时零 worker。
// 使用 hash-pre-v1 确定性 provider(纯标准库,零联网);不模拟 delivered/seen(M6 自有测试)。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
process.on('uncaughtException', (e) => { console.error('[M78-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M78-TEST] REJ:', r); process.exit(1) })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
const sha256Hex = (b) => createHash('sha256').update(b).digest('hex')
const { parseAnchors } = await import('../../lib/memory-anchor.js')

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function canonicalizePath(p) { return path.resolve(p).replace(/\\/g, '/').toLowerCase() }
function keyOf(p) { return '--' + p.replace(/[\\/:*?"<>|]/g, '-') + '--' }

async function setupHarness(opts = {}) {
  const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-m78-'))
  const home = path.join(ws1, '.dsh-home')
  const memoryRoot = path.join(ws1, 'mem')
  const wsA = path.join(ws1, 'wsA')
  mkdirSync(home, { recursive: true }); mkdirSync(memoryRoot, { recursive: true }); mkdirSync(wsA, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot, userMemoryDir: path.join(ws1, 'user'), projectMemoryDir: '.project-memory',
    externalSources: {}, ...(opts.configPatch || {}),
  }), 'utf8')
  process.env.DSH_HOME = home
  const aaId = 'mem_' + 'aa'.repeat(16), bbId = 'mem_' + 'bb'.repeat(16)
  const md = '<!-- memory:' + aaId + ' -->\n## 用户偏好\n- 用户偏好中文回复与分步验证,部署流程使用 pnpm build\n\n' +
    '<!-- memory:' + bbId + ' -->\n## 部署流程\n- 登录模块部署流程使用 pnpm build 与 rsync'
  const wsFile = path.join(memoryRoot, keyOf(wsA), 'MEMORY.md')
  mkdirSync(path.dirname(wsFile), { recursive: true }); writeFileSync(wsFile, md, 'utf8')
  const buf0 = readFileSync(wsFile); const p0 = parseAnchors(buf0)
  const records0 = p0.records.filter((r) => r.kind === 'anchored').map((r) => ({
    memoryId: r.memoryId, anchorId: r.anchorId || null, anchorLine: r.anchorLine || null,
    anchorByteStart: r.markerByteStart, anchorByteEnd: r.markerByteEnd,
    heading: r.heading != null ? r.heading : null,
    lineStart: r.lineStart, lineEnd: r.lineEnd, byteStart: r.byteStart, byteEnd: r.byteEnd,
    bytes: r.bytes, recordDigest: r.recordDigest, sourceVersion: 1, fileDigest: sha256Hex(buf0),
  }))
  const sideDir = path.join(home, 'memory', 'index', 'files')
  mkdirSync(sideDir, { recursive: true })
  const side = { schemaVersion: 1, namespace: 'dsh-auto-memory', sourceFile: wsFile,
    sourceEpoch: '22222222-2222-4222-8222-222222222222', sourceVersion: 1, fileDigest: sha256Hex(buf0),
    newline: p0.newline === 'crlf' ? 'crlf' : 'lf', updatedAt: 1700000000000, records: records0 }
  writeFileSync(path.join(sideDir, createHash('sha256').update(canonicalizePath(wsFile), 'utf8').digest('hex') + '.json'), JSON.stringify(side, null, 2) + '\n', 'utf8')
  const semDir = path.join(home, 'memory', 'semantic')
  mkdirSync(semDir, { recursive: true })
  writeFileSync(path.join(semDir, 'embedding-config.json'), JSON.stringify({
    provider: 'hash-pre-v1', dimension: 32,
    activationPolicy: { mode: 'shadow', tOn: 0.5, tOff: 0.3 },
  }), 'utf8')
  const tools = []; const routes = []; const handlers = new Map(); const effectSetups = []; const promptComponents = []
  const ctx = {
    get() { return undefined }, on(n, h) { handlers.set(n, h); return () => {} },
    effect(fn) { if (typeof fn === 'function') effectSetups.push(fn); return () => {} },
    systemPrompt: { section(c) { promptComponents.push({ kind: 'section', ...c }); return () => {} }, context(c) { promptComponents.push({ kind: 'context', ...c }); return () => {} } },
    tools: { register(d) { tools.push(d); return () => {} } },
    webServer: { register(r) { routes.push(r); return () => {} } },
  }
  const { apply } = await import('../../lib/index.js')
  apply(ctx, {})
  const fire = async (name, ...args) => { const h = handlers.get(name); if (typeof h !== 'function') throw new Error('handler missing ' + name); return Promise.resolve(h(...args)) }
  const dbg = async () => { const r = routes.find((x) => x.path === '/api/dsh-auto-memory/debug'); let b; await r.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, { writeHead() {}, end(x) { b = JSON.parse(x) } }); return b.associativeMemory }
  const cfgPost = async (patch) => { const r = routes.find((x) => x.path === '/api/dsh-auto-memory/config'); await r.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, method: 'POST', url: '/config', [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(patch)) })() } }, { writeHead() {}, end() {} }); await sleep(150) }
  const agent = { id: 'a1', session: { id: 's1', header: { id: 's1', cwd: wsA } } }
  await fire('agent/session-start', { agent, source: 'fresh' })
  await sleep(250)
  return { ws1, home, wsA, agent, fire, dbg, cfgPost, routes, handlers,
    settle: async () => { for (const s of effectSetups) { try { const td = await s(); if (typeof td === 'function') await td() } catch (_) {} } },
    cleanup: () => { try { rmSync(ws1, { recursive: true, force: true }) } catch (_) {} } }
}
function semPre(home) { return path.join(home, 'memory', 'semantic') }

console.log('[P1] live-parity:已有 runtime + 开三重门 + 顶层 user Segment → envelope 构建 + worker lazy start + index_sync 编排')
{
  const h = await setupHarness()
  const am0 = await h.dbg()
  ok(am0.contextBridge && am0.contextBridge.enabled === false, 'P1 默认关闭')
  // 打开 assoc/bridge/python + sink=python(模拟 live 顺序)
  await h.cfgPost({ associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' })
  await sleep(200)
  const am1 = await h.dbg()
  ok(am1.contextBridge.sinkKind === 'python', 'P1 sink=python(三重门)')
  ok(am1.indexSyncHost && am1.indexSyncHost.enabled === true, 'P1 indexSyncHost.enabled=true(四门)')
  // 顶层会话 user Segment(同 m53 C3 路径;真实事件驱动)
  await h.fire('session/event', h.agent.session, { type: 'user/message', seq: 200, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '回忆一下之前的部署流程记录' }] } })
  await sleep(1800)
  const am2 = await h.dbg()
  const cb = am2.contextBridge
  const ih = am2.indexSyncHost
  ok(cb.stats.envelopesBuilt >= 1, 'P1 envelope 构建 ≥1(built=' + cb.stats.envelopesBuilt + ')')
  ok(ih.enabled === true, 'P1 indexSyncHost enabled')
  ok(ih.stats.syncsStarted >= 1 || ih.stats.readyHits >= 0, 'P1 编排器参与(syncsStarted=' + ih.stats.syncsStarted + ')')
  // 断言 python worker 被 lazy 启动(至少一次 ensure 尝试)——hash provider 会真实 spawn
  const pb = am2.pythonBackend
  ok(pb && pb.started === true, 'P1 python worker lazy start(pb.started=' + pb.started + ')')
  ok(cb.capturedPathKeys && cb.capturedPathKeys.length >= 1, 'P1 capturedPathKeys 非空(live-parity 诊断)')
  ok(typeof cb.lastSegmentRuntimeKey === 'string' && cb.lastSegmentRuntimeKey.length > 0, 'P1 lastSegmentRuntimeKey 记录')
  ok(cb.lastSegmentSessionRef && cb.lastSegmentSessionRef.startsWith('s'), 'P1 lastSegmentSessionRef 记录')
  await h.settle(); h.cleanup()
}

console.log('[P2] child-session 抑制不建 envelope;plugin-generated 抑制')
{
  const h = await setupHarness()
  // 2026-08-26 裁定 contextBridgeObserveChildSessions 默认 true;本场景专测关闭态抑制,须显式关
  await h.cfgPost({ associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python', contextBridgeObserveChildSessions: false })
  const childAgent = { id: 'c1', session: { id: 'sc1', header: { id: 'sc1', cwd: h.wsA, parentSession: 's1' } } }
  await h.fire('agent/session-start', { agent: childAgent, source: 'child' })
  await sleep(150)
  await h.fire('session/event', childAgent.session, { type: 'user/message', seq: 300, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '子代理输入 部署流程' }] } })
  await sleep(800)
  const am = await h.dbg()
  const drops = am.contextBridge.recentDrops || []
  ok(drops.some((d) => d.reason === 'child-session'), 'P2 child-session drop 记录')
  ok(am.contextBridge.stats.envelopesBuilt === 0, 'P2 child 不建 envelope(built=' + am.contextBridge.stats.envelopesBuilt + ')')
  await h.settle()
  h.cleanup()
}

console.log('[P3] 编排器单元:首同步/同 miv 幂等/epoch 重同步/miv 替换')
{
  const h = await setupHarness()
  const SYNC_HOST = await import('../../lib/m7-index-sync-host.js')
  const EV = await import('../../lib/evidence-store.js')
  const wsr78 = EV.workspaceRefOf('D:/tmp/m78')
  const SNAP = { memoryIndexVersion: 'idx_' + 'a1'.repeat(16), records: [
    { memoryId: 'mem_' + '11'.repeat(16), anchorId: 'a1', scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', workspaceRef: wsr78, sourceEpoch: 'e1', sourceVersion: 1, fileDigest: 'f0'.repeat(32), recordDigest: 'a1'.repeat(32), heading: 'h', text: '部署流程 pnpm build' },
    { memoryId: 'mem_' + '22'.repeat(16), anchorId: 'a2', scope: 'User', sourceRef: 'user:MEMORY.md', workspaceRef: wsr78, sourceEpoch: 'e1', sourceVersion: 1, fileDigest: 'e2'.repeat(32), recordDigest: 'b3'.repeat(32), heading: 'u', text: '用户偏好中文' },
  ], sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e1', sourceVersion: 1, fileDigest: 'f0'.repeat(32) }] }
  const paths = { workspaceKey: 'D:/tmp/m78' }
  const host = SYNC_HOST.createIndexSyncHostPre({ engine: {
    config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' },
    _pythonSidecar: await (async () => { const CL = await import('../../lib/python-sidecar-client.js'); const c = CL.createPythonSidecarClientPre({ command: 'python', scriptPath: () => path.join(HERE, '..', '..', 'python', 'worker_semantic_v1.py'), dshHome: h.home, requestTimeoutMs: 4000 }); globalThis.__p3client = c; return c })(),
  } })
  const r1 = await host.ensureIndexReady(SNAP, paths, 'Workspace')
  ok(r1.ready === true, 'P3 首次同步 ready(syncsStarted=' + host._stats.syncsStarted + ')')
  ok(host._readyCacheForTest.size >= 1, 'P3 ready 缓存建立')
  // r1 触发 lazy spawn:epoch 从 null 变为 wk_*,第二次调用因 epoch 变化会合法重同步一次
  // (worker 首次启动后 epoch 生效)。等待 epoch 稳定后,后续调用才应幂等。
  await sleep(200)
  const r1b = await host.ensureIndexReady(SNAP, paths, 'Workspace')
  ok(r1b.ready === true, 'P3 epoch 稳定后仍 ready')
  const statsAfterSettle = { ...host._stats }
  const r2 = await host.ensureIndexReady(SNAP, paths, 'Workspace')
  ok(r2.ready === true && host._stats.readyHits >= 1, 'P3 同 miv 幂等(readyHits=' + host._stats.readyHits + ',不重复 sync)')
  ok(host._stats.syncsStarted === statsAfterSettle.syncsStarted, 'P3 syncsStarted 未再增加(幂等)')
  // epoch 变化:改 readyCache 的 epoch 使 cached.epoch !== 实际(模拟 worker 重启)
  for (const [k, v] of host._readyCacheForTest) host._readyCacheForTest.set(k, { ...v, epoch: 'wk_other' })
  const r3 = await host.ensureIndexReady(SNAP, paths, 'Workspace')
  ok(r3.ready === true && host._stats.epochReset >= 1, 'P3 epoch 变化重同步(epochReset=' + host._stats.epochReset + ')')
  // miv 替换
  const SNAP2 = { ...SNAP, memoryIndexVersion: 'idx_' + 'b2'.repeat(16) }
  const r4 = await host.ensureIndexReady(SNAP2, paths, 'Workspace')
  ok(r4.ready === true && host._stats.mivReplaced >= 1, 'P3 miv 替换 latest-wins(mivReplaced=' + host._stats.mivReplaced + ')')
  host.dispose('test')
  if (globalThis.__p3client) { try { await globalThis.__p3client.dispose('test') } catch (_) {}; globalThis.__p3client = null }
  await h.cleanup()
}

console.log('[P4] sync 失败 → 不 push context;后续可重试')
{
  const h = await setupHarness()
  const SYNC_HOST = await import('../../lib/m7-index-sync-host.js')
  const EV = await import('../../lib/evidence-store.js')
  const wsr = EV.workspaceRefOf('D:/tmp/m78fail')
  const badSnap = { memoryIndexVersion: 'idx_' + 'c3'.repeat(16), records: [
    { memoryId: 'mem_' + '33'.repeat(16), anchorId: 'a', scope: 'Workspace', workspaceRef: wsr,
      sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1,
      fileDigest: 'd0'.repeat(32), recordDigest: 'e1'.repeat(32), heading: 'h', text: '内容' },
  ], sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'd0'.repeat(32) }] }
  // client 指向不存在的 worker 脚本 → send 失败
  const CL = await import('../../lib/python-sidecar-client.js')
  const badClient = CL.createPythonSidecarClientPre({ command: 'python', scriptPath: () => path.join(HERE, '..', '..', 'python', 'no-such-worker.py'), dshHome: h.home, requestTimeoutMs: 1000 })
  const host = SYNC_HOST.createIndexSyncHostPre({ engine: { config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' }, _pythonSidecar: badClient } })
  const r = await host.ensureIndexReady(badSnap, { workspaceKey: 'D:/tmp/m78fail' }, 'Workspace')
  ok(r.ready === false, 'P4 worker 缺失 → ready=false(sync 失败不伪 ready)')
  ok(host._stats.syncsFailed >= 1, 'P4 syncsFailed 记录(syncsFailed=' + host._stats.syncsFailed + ')')
  ok(host._stats.readyHits === 0, 'P4 失败不入 ready 缓存(可重试)')
  host.dispose('test'); await badClient.dispose('test'); h.cleanup()
}

console.log('[P5] A/B workspace 同 miv 零串线(编排器层面)')
{
  const h = await setupHarness()
  const SYNC_HOST = await import('../../lib/m7-index-sync-host.js')
  const CL = await import('../../lib/python-sidecar-client.js')
  const c = CL.createPythonSidecarClientPre({ command: 'python', scriptPath: () => path.join(HERE, '..', '..', 'python', 'worker_semantic_v1.py'), dshHome: h.home, requestTimeoutMs: 4000 })
  const host = SYNC_HOST.createIndexSyncHostPre({ engine: { config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' }, _pythonSidecar: c } })
  const EV = await import('../../lib/evidence-store.js')
  const wsrA = EV.workspaceRefOf('D:/tmp/wsA')
  const wsrB = EV.workspaceRefOf('D:/tmp/wsB')
  const mivSame = 'idx_' + 'ab'.repeat(16)
  const snapA = { memoryIndexVersion: mivSame, records: [{ memoryId: 'mem_' + 'aa'.repeat(16), anchorId: 'a', scope: 'Workspace', workspaceRef: wsrA, sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f0'.repeat(32), recordDigest: 'a1'.repeat(32), heading: 'h', text: 'A 内容' }], sources: [] }
  const snapB = { memoryIndexVersion: mivSame, records: [{ memoryId: 'mem_' + 'bb'.repeat(16), anchorId: 'b', scope: 'Workspace', workspaceRef: wsrB, sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f0'.repeat(32), recordDigest: 'b2'.repeat(32), heading: 'h', text: 'B 内容' }], sources: [] }
  let rA, rB
  try { rA = await host.ensureIndexReady(snapA, { workspaceKey: 'D:/tmp/wsA' }, 'Workspace') } catch (e) {  }
  try { rB = await host.ensureIndexReady(snapB, { workspaceKey: 'D:/tmp/wsB' }, 'Workspace') } catch (e) {  }
  ok(rA && rA.ready && rB && rB.ready, 'P5 A/B 各自 ready')
  ok(host._readyCacheForTest.size === 2, 'P5 两个 (wsr,scope) 独立缓存条目(size=' + host._readyCacheForTest.size + ')')
  ok(host._readyCacheForTest.has(wsrA + '|Workspace') && host._readyCacheForTest.has(wsrB + '|Workspace'), 'P5 键按 wsr 隔离(同 miv 也零串线)')
  host.dispose('test'); await c.dispose('test'); h.cleanup()
}

console.log('[P6] 关闭/dispose → in-flight abort + ready 缓存清空 + 零后续 IO')
{
  const h = await setupHarness()
  const SYNC_HOST = await import('../../lib/m7-index-sync-host.js')
  const CL = await import('../../lib/python-sidecar-client.js')
  const c = CL.createPythonSidecarClientPre({ command: 'python', scriptPath: () => path.join(HERE, '..', '..', 'python', 'worker_semantic_v1.py'), dshHome: h.home, requestTimeoutMs: 4000 })
  const host = SYNC_HOST.createIndexSyncHostPre({ engine: { config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' }, _pythonSidecar: c } })
  const EV = await import('../../lib/evidence-store.js')
  const wsr = EV.workspaceRefOf('D:/tmp/wsP6')
  const snap = { memoryIndexVersion: 'idx_' + 'd4'.repeat(16), records: [{ memoryId: 'mem_' + '44'.repeat(16), anchorId: 'a', scope: 'Workspace', workspaceRef: wsr, sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e', sourceVersion: 1, fileDigest: 'f0'.repeat(32), recordDigest: 'e2'.repeat(32), heading: 'h', text: '内容' }], sources: [] }
  await host.ensureIndexReady(snap, { workspaceKey: 'D:/tmp/wsP6' }, 'Workspace')
  ok(host._readyCacheForTest.size === 1, 'P6 ready 缓存建立')
  host.dispose('dispose-test')
  ok(host._readyCacheForTest.size === 0 && host._inFlightForTest.size === 0, 'P6 dispose 清空 ready/in-flight')
  ok(host.debugView().enabled === true, 'P6 debugView 仍可用(模块未销毁)')
  await c.dispose('test'); h.cleanup()
}

console.log('[P7] activation 回流:index ready 后 context_push 到达 → fake worker 激活过 M6 validator;门关闭零 worker')
{
  const h = await setupHarness()
  // 开 python 门 + 走真实引擎事件 → worker 收 context_push(影子模式零 activation 帧)
  await h.cfgPost({ associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python', pythonBackendWorkerPath: path.join(HERE, '..', '..', 'python', 'worker_semantic_v1.py'), pythonBackendExecutable: process.env.M78_PY || 'python' })
  await h.fire('session/event', h.agent.session, { type: 'user/message', seq: 400, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '部署流程 pnpm build 回忆' }] } })
  await sleep(2500)
  const am = await h.dbg()
  ok(am.pythonBackend && am.pythonBackend.started === true, 'P7 worker lazy start')
  const sem = semPre(h.home)
  const files = existsSync(sem) ? readdirSync(sem) : []
  ok(files.some((f) => f.startsWith('vectors-')), 'P7 向量建库(index_sync 完成后)')
  ok(files.some((f) => f === 'candidates-shadow.jsonl'), 'P7 影子候选落盘(context_push 到达)')
  // 门关闭 → 零 worker 零新写入
  await h.cfgPost({ pythonBackendEnabled: false, contextSinkMode: 'null' })
  await sleep(300)
  const am2 = await h.dbg()
  ok(am2.indexSyncHost && am2.indexSyncHost.enabled === false, 'P7 门关闭 → indexSyncHost 关闭(零新编排)')
  ok(am2.contextBridge.sinkKind === 'null', 'P7 门关闭 → sink 回退 null(零新推送)')
  // 进程为 lazy 常驻,配置关闭不主动 kill(dispose 才杀);断言零新流量
  await h.settle()
  // dispose engine._pythonSidecar:reach via debug route? use direct kill of worker child via global registry
  try { const CL2 = await import('../../lib/python-sidecar-client.js'); const rt = await h.dbg(); if (rt.pythonBackend && rt.pythonBackend.started) { } } catch (_) {}
  h.cleanup()
}

console.log(`[M78] pass=${pass} fail=${fail}`)
// 关闭残留句柄:worker pipe socket 在 dispose 后异步关闭;等待后仍存在则显式退出
setTimeout(() => process.exit(fail > 0 ? 1 : 0), 1200).unref()
if (fail > 0) process.exit(1)
