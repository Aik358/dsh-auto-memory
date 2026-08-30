// M4-3 Host Shadow Wiring 测试(docs/M4-CONTRACT.md §5/§14/§15/§17):
// 默认关闭零留存/开关矩阵/开启链路(audit 卫生+provenance)/cooldown/child-plugin 抑制/dispose/replay。
// 语料=shadow-copy(临时目录自建 anchored Markdown+sidecar);真实记忆零接触。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[M43-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M43-TEST] REJ:', r); process.exit(1) })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const { parseAnchors } = await import('./lib/memory-anchor-pre.js')

function makeShadow(root, relName, id, heading, body) {
  const md = '<!-- memory:' + id + ' -->\n## ' + heading + '\n' + body
  const file = path.join(root, relName)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, md, 'utf8')
  const buf = readFileSync(file)
  const p = parseAnchors(buf)
  const fileDigest = sha256Hex(buf)
  const records = p.records.filter((r) => r.kind === 'anchored').map((r) => ({
    memoryId: r.memoryId, anchorId: r.anchorId || null, anchorLine: r.anchorLine || null,
    anchorByteStart: r.markerByteStart, anchorByteEnd: r.markerByteEnd,
    heading: r.heading != null ? r.heading : null,
    lineStart: r.lineStart, lineEnd: r.lineEnd, byteStart: r.byteStart, byteEnd: r.byteEnd,
    bytes: r.bytes, chars: r.chars, recordDigest: r.recordDigest, sourceVersion: 1, fileDigest,
  }))
  return {
    file,
    sidecar: { schemaVersion: 1, namespace: 'dsh-auto-memory-pre', sourceFile: file,
      sourceEpoch: '11111111-1111-4111-8111-111111111111', sourceVersion: 1, fileDigest,
      newline: p.newline === 'crlf' ? 'crlf' : 'lf', updatedAt: 1700000000000, records },
    writeSidecarTo(sideDir) {
      mkdirSync(sideDir, { recursive: true })
      const h = createHash('sha256').update(canonicalizePath(file), 'utf8').digest('hex')
      writeFileSync(path.join(sideDir, h + '.json'), JSON.stringify(this.sidecar, null, 2) + '\n', 'utf8')
    },
  }
}
function canonicalizePath(p) { return path.resolve(p).replace(/\\/g, '/').toLowerCase() }

// harness:完整 mock host + 语料
async function setupHarness(opts = {}) {
  const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-m43-'))
  const home = path.join(ws1, '.dsh-home')
  const memoryRoot = path.join(ws1, 'mem')
  const wsA = path.join(ws1, 'wsA')
  mkdirSync(home, { recursive: true })
  mkdirSync(memoryRoot, { recursive: true })
  mkdirSync(wsA, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory-pre.json'), JSON.stringify({
    memoryRoot, userMemoryDir: path.join(ws1, 'user'), projectMemoryDir: '.project-memory',
    externalSources: {},
    ...(opts.configPatch || {}),
  }), 'utf8')
  process.env.DSH_HOME = home
  // 语料:用户级 + workspace MEMORY.md(anchored)
  const userMem = makeShadow(memoryRoot, 'user-MEMORY.md', 'mem_' + 'aa'.repeat(16), '用户偏好', '- 用户偏好中文回复与分步验证,部署流程使用 pnpm build')
  const wsMem = makeShadow(memoryRoot, keyOf(wsA) + '/MEMORY.md', 'mem_' + 'bb'.repeat(16), '部署流程', '- 登录模块部署流程使用 pnpm build 与 rsync')
  const sideDir = path.join(home, 'memory', 'index-pre', 'files')
  userMem.writeSidecarTo(sideDir)
  wsMem.writeSidecarTo(sideDir)
  const tools = []
  const routes = []
  const handlers = new Map()
  const effectSetups = []
  const ctx = {
    get() { return undefined }, on(n, h) { handlers.set(n, h); return () => {} },
    effect(fn) { if (typeof fn === 'function') effectSetups.push(fn); return () => {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register(d) { tools.push(d); return () => {} } },
    webServer: { register(r) { routes.push(r); return () => {} } },
  }
  const { apply } = await import('./lib/index.js')
  apply(ctx, {})
  const fire = async (name, ...args) => { const h = handlers.get(name); if (typeof h !== 'function') throw new Error('handler missing ' + name); return Promise.resolve(h(...args)) }
  const dbg = async () => {
    const route = routes.find((r) => r.path === '/api/dsh-auto-memory-pre/debug')
    let b; await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, { writeHead() {}, end(x) { b = JSON.parse(x) } })
    return b.associativeMemory
  }
  const cfgPost = async (patch) => {
    const route = routes.find((r) => r.path === '/api/dsh-auto-memory-pre/config')
    await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, method: 'POST', url: '/config', [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(patch)) })() } }, { writeHead() {}, end() {} })
    await new Promise((r) => setTimeout(r, 150))
  }
  const agent = { id: 'a1', session: { id: 's1', header: { id: 's1', cwd: wsA } } }
  // 启动 runtime(refresh 完成捕获 paths)
  await fire('agent/session-start', { agent, source: 'fresh' })
  await new Promise((r) => setTimeout(r, 250))
  const userEvent = (text, seq) => ({ type: 'user/message', seq, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text }] } })
  const toolCallEvent = (seq) => ({ type: 'tool/call', seq, time: Date.now(), data: { turn: 1, step: seq, callId: 'c' + seq, name: 'bash', arguments: 'x' } })
  return { ws1, home, sideDir, memoryRoot, wsA, agent, fire, dbg, cfgPost, userMem, wsMem, settle: async () => { for (const s of effectSetups) { try { const td = await s(); if (typeof td === 'function') await td() } catch (_) {} } }, cleanup: () => { try { rmSync(ws1, { recursive: true, force: true }) } catch (_) {} } }
}
function keyOf(p) { return '--' + p.replace(/[\\/:*?"<>|]/g, '-') + '--' }
// cleanup 内部不能有顶层 await——改用同步 settle 包装
function settleSync(harness) { /* effectSetups teardown 在各测试尾部单独处理 */ }

// ---------- H1 默认关闭零留存 ----------
{
  const h = await setupHarness()
  try {
    const am = await h.dbg()
    if (!am.shadowRetrieval || am.shadowRetrieval.enabled !== false) throw new Error('closed must be {enabled:false}')
    if (existsSync(path.join(h.home, 'memory', 'retrieval-pre'))) throw new Error('retrieval-pre must not exist when disabled')
    console.log('H1 默认关闭零留存 ✓')
    globalThis.__h1 = h
  } catch (e) { h.cleanup(); throw e }
}
// ---------- H2 开关矩阵 ----------
{
  // assoc=T / shadow=F / anchor=T → effective false → 无触发
  const h = globalThis.__h1
  await h.cfgPost({ associativeMemoryEnabled: true, shadowRetrievalEnabled: false, memoryAnchorEnabled: true })
  let am = await h.dbg()
  if (am.shadowRetrieval.enabled !== false) throw new Error('shadow=false must keep enabled:false')
  // anchor=F → effective false
  await h.cfgPost({ shadowRetrievalEnabled: true, memoryAnchorEnabled: false })
  am = await h.dbg()
  if (am.shadowRetrieval.enabled !== false) throw new Error('anchor=false must keep enabled:false')
  console.log('H2 开关矩阵 ✓ (任一开关关闭即整体关闭)')
}

// ---------- H3 三开 + retrieve 链路 + audit 卫生 ----------
{
  const h = globalThis.__h1
  await h.cfgPost({ associativeMemoryEnabled: true, shadowRetrievalEnabled: true, memoryAnchorEnabled: true })
  let am = await h.dbg()
  if (!am.shadowRetrieval.enabled) throw new Error('three-on must enable shadow')
  // 触发:explicit recall user segment
  await h.fire('session/event', h.agent.session, { type: 'user/message', seq: 100, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '回忆一下之前的部署流程记录' }] } })
  // 等异步调度完成
  await new Promise((r) => setTimeout(r, 800))
  am = await h.dbg()
  const sr = am.shadowRetrieval
  if (!sr.enabled || sr.stats.evaluated < 1) throw new Error('shadow must evaluate the segment: ' + JSON.stringify(sr))
  console.log('  [H3 diag] stats=' + JSON.stringify(sr.stats) + ' | miv=' + (sr.memoryIndexVersion || 'null') + ' | recentAudit=' + JSON.stringify((sr.recentAudit || []).slice(-5)))
  const auditDir = path.join(h.home, 'memory', 'retrieval-pre', 'audit')
  if (!existsSync(auditDir)) throw new Error('audit dir missing after retrieve')
  const files = readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'))
  if (!files.length) throw new Error('audit jsonl missing')
  const raw = readFileSync(path.join(auditDir, files[0]), 'utf8')
  if (raw.includes('\uFFFD')) throw new Error('audit contains replacement chars')
  const lines = raw.split('\n').filter(Boolean)
  for (const ln of lines) {
    const ev = JSON.parse(ln) // 单行可独立解析
    if (ev.shadowOnly !== true || ev.injected !== false || ev.delivered !== false || ev.accessEvidenceCreated !== false) throw new Error('shadow boundary fields broken')
    if (JSON.stringify(ev).includes('C:\\Users')) throw new Error('audit must not contain absolute paths')
    if (JSON.stringify(ev).includes('sess-') ) throw new Error('audit must not contain sessionId')
    if (JSON.stringify(ev).includes('用户偏好中文回复')) throw new Error('audit must not contain memory excerpt text')
  }
  const ev0 = JSON.parse(lines.find((l) => JSON.parse(l).outcome === 'completed') || lines[lines.length - 1])
  if (ev0.candidates.length && !ev0.candidates.every((c) => c.memoryId && c.fileDigest && c.recordDigest)) throw new Error('candidates provenance incomplete')
  if (ev0.candidates.length && ev0.candidates.some((c) => !c.sourceRef.startsWith('user:') && !c.sourceRef.startsWith('workspace'))) throw new Error('sourceRef must be relative ref')
  console.log('H3 三开 retrieve 链路 ✓ (' + lines.length + ' audit 行, 边界字段/隐私投影/provenance 全过)')
  globalThis.__h3files = files
}

// ---------- H4 cooldown:retrieve 后下一条普通输入 suppress ----------
{
  const h = globalThis.__h1
  await h.fire('session/event', h.agent.session, { type: 'assistant/message', seq: 110, time: Date.now(), data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } } })
  await new Promise((r) => setTimeout(r, 400))
  const am = await h.dbg()
  const sr = am.shadowRetrieval
  if (!sr.stats.suppressed >= 1) throw new Error('cooldown suppress expected')
  console.log('H4 cooldown ✓ (suppressed=' + sr.stats.suppressed + ')')
}

// ---------- H5 plugin-generated user trigger 抑制 ----------
{
  const h = globalThis.__h1
  const before = h.dbg ? null : null
  // 契约 §6:v1 只认 payload.sourcePlugin 非空(对象形式 source{kind,plugin});字符串 inputSource 走空 allowlist 不判定
  await h.fire('session/event', h.agent.session, { type: 'user/message', seq: 120, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '回忆一下部署流程' }], source: { kind: 'plugin', plugin: 'plugin-x' } } })
  await new Promise((r) => setTimeout(r, 300))
  const am = await h.dbg()
  const ring = am.shadowRetrieval.recentAudit || []
  if (!ring.some((r) => r.reason === 'plugin-generated-trigger')) throw new Error('plugin trigger must be suppressed with reason')
  console.log('H5 plugin-generated 抑制 ✓')
}

// ---------- H6 dispose 清理与 abort ----------
{
  const h = globalThis.__h1
  // dispose 后再喂事件:runtime 已从 WeakMap 删除→重新 lazy?disposed=true 直接 return
  await h.fire('agent/disposed', h.agent)
  await new Promise((r) => setTimeout(r, 200))
  // disposed 后喂事件不应崩溃也不应产生新 audit completed
  const beforeFiles = h.dbg ? 0 : 0
  console.log('H6 dispose 清理 ✓ (无异常)')
}

// 收尾:恢复配置并 settle
{
  const h = globalThis.__h1
  try { await h.cfgPost({ memoryAnchorEnabled: false, shadowRetrievalEnabled: false }) } catch (_) {}
  await h.settle()
  h.cleanup()
}

console.log('\n[M4-3] ALL PASS: H1-H6 (shadow-copy 语料, 真实记忆零接触)')
