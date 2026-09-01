// M5-3 Context Bridge Host Wiring 测试(docs/M5-CONTRACT.md §12 M5-3/§13):
// 默认关闭零留存/开关矩阵/fake sink envelope/read coverage 持久化隐私/cite-correction/
// Shadow hit 不追认/关闭恢复零残留/prompt 零变化。语料=shadow-copy;真实记忆零接触。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[M53-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M53-TEST] REJ:', r); process.exit(1) })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const { parseAnchors } = await import('../../lib/memory-anchor.js')

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }

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
    bytes: r.bytes, recordDigest: r.recordDigest, sourceVersion: 1, fileDigest,
  }))
  return {
    file, mdText: md, memoryId: id,
    sidecar: { schemaVersion: 1, namespace: 'dsh-auto-memory', sourceFile: file,
      sourceEpoch: '22222222-2222-4222-8222-222222222222', sourceVersion: 1, fileDigest,
      newline: p.newline === 'crlf' ? 'crlf' : 'lf', updatedAt: 1700000000000, records },
    writeSidecarTo(sideDir) {
      mkdirSync(sideDir, { recursive: true })
      const h = createHash('sha256').update(canonicalizePath(file), 'utf8').digest('hex')
      writeFileSync(path.join(sideDir, h + '.json'), JSON.stringify(this.sidecar, null, 2) + '\n', 'utf8')
    },
  }
}
function canonicalizePath(p) { return path.resolve(p).replace(/\\/g, '/').toLowerCase() }

async function setupHarness(opts = {}) {
  const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-m53-'))
  const home = path.join(ws1, '.dsh-home')
  const memoryRoot = path.join(ws1, 'mem')
  const wsA = path.join(ws1, 'wsA')
  mkdirSync(home, { recursive: true })
  mkdirSync(memoryRoot, { recursive: true })
  mkdirSync(wsA, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot, userMemoryDir: path.join(ws1, 'user'), projectMemoryDir: '.project-memory',
    externalSources: {}, ...(opts.configPatch || {}),
  }), 'utf8')
  process.env.DSH_HOME = home
  // 合并单文件:workspace MEMORY.md 承载两条 anchored 记录(aa 用户偏好 / bb 部署流程),引擎 projectDirOf 指向集中 root
  const aaId = 'mem_' + 'aa'.repeat(16)
  const bbId = 'mem_' + 'bb'.repeat(16)
  const combinedMd = '<!-- memory:' + aaId + ' -->\n## 用户偏好\n- 用户偏好中文回复与分步验证,部署流程使用 pnpm build\n\n' +
    '<!-- memory:' + bbId + ' -->\n## 部署流程\n- 登录模块部署流程使用 pnpm build 与 rsync'
  const wsFile = path.join(memoryRoot, keyOf(wsA), 'MEMORY.md')
  mkdirSync(path.dirname(wsFile), { recursive: true })
  writeFileSync(wsFile, combinedMd, 'utf8')
  const buf0 = readFileSync(wsFile)
  const p0 = parseAnchors(buf0)
  const records0 = p0.records.filter((r) => r.kind === 'anchored').map((r) => ({
    memoryId: r.memoryId, anchorId: r.anchorId || null, anchorLine: r.anchorLine || null,
    anchorByteStart: r.markerByteStart, anchorByteEnd: r.markerByteEnd,
    heading: r.heading != null ? r.heading : null,
    lineStart: r.lineStart, lineEnd: r.lineEnd, byteStart: r.byteStart, byteEnd: r.byteEnd,
    bytes: r.bytes, recordDigest: r.recordDigest, sourceVersion: 1, fileDigest: sha256Hex(buf0),
  }))
  const wsMem = { file: wsFile, mdText: combinedMd, memoryId: bbId,
    sidecar: { schemaVersion: 1, namespace: 'dsh-auto-memory', sourceFile: wsFile,
      sourceEpoch: '22222222-2222-4222-8222-222222222222', sourceVersion: 1, fileDigest: sha256Hex(buf0),
      newline: p0.newline === 'crlf' ? 'crlf' : 'lf', updatedAt: 1700000000000, records: records0 },
    writeSidecarTo(sideDir) {
      mkdirSync(sideDir, { recursive: true })
      const h = createHash('sha256').update(canonicalizePath(wsFile), 'utf8').digest('hex')
      writeFileSync(path.join(sideDir, h + '.json'), JSON.stringify(this.sidecar, null, 2) + '\n', 'utf8')
    },
  }
  const sideDir = path.join(home, 'memory', 'index', 'files')
  wsMem.writeSidecarTo(sideDir)
  const tools = []
  const routes = []
  const handlers = new Map()
  const effectSetups = []
  const promptComponents = []
  const ctx = {
    get() { return undefined }, on(n, h) { handlers.set(n, h); return () => {} },
    effect(fn) { if (typeof fn === 'function') effectSetups.push(fn); return () => {} },
    systemPrompt: {
      section(c) { promptComponents.push({ kind: 'section', ...c }); return () => {} },
      context(c) { promptComponents.push({ kind: 'context', ...c }); return () => {} },
    },
    tools: { register(d) { tools.push(d); return () => {} } },
    webServer: { register(r) { routes.push(r); return () => {} } },
  }
  const { apply } = await import('../../lib/index.js')
  apply(ctx, {})
  const fire = async (name, ...args) => { const h = handlers.get(name); if (typeof h !== 'function') throw new Error('handler missing ' + name); return Promise.resolve(h(...args)) }
  const dbg = async () => {
    const route = routes.find((r) => r.path === '/api/dsh-auto-memory/debug')
    let b; await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, { writeHead() {}, end(x) { b = JSON.parse(x) } })
    return b.associativeMemory
  }
  const cfgPost = async (patch) => {
    const route = routes.find((r) => r.path === '/api/dsh-auto-memory/config')
    await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, method: 'POST', url: '/config', [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(patch)) })() } }, { writeHead() {}, end() {} })
    await new Promise((r) => setTimeout(r, 150))
  }
  const agent = { id: 'a1', session: { id: 's1', header: { id: 's1', cwd: wsA } } }
  await fire('agent/session-start', { agent, source: 'fresh' })
  await new Promise((r) => setTimeout(r, 250))
  return { ws1, home, sideDir, wsA, agent, aaId, bbId, wsMem, fire, dbg, cfgPost, routes, promptComponents,
    settle: async () => { for (const s of effectSetups) { try { const td = await s(); if (typeof td === 'function') await td() } catch (_) {} } },
    cleanup: () => { try { rmSync(ws1, { recursive: true, force: true }) } catch (_) {} } }
}
function keyOf(p) { return '--' + p.replace(/[\\/:*?"<>|]/g, '-') + '--' }
function evidenceEventsDir(home) { return path.join(home, 'memory', 'evidence', 'events') }
function readEvidenceLines(home) {
  const dir = evidenceEventsDir(home)
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    for (const ln of readFileSync(path.join(dir, f), 'utf8').split('\n')) if (ln.trim()) out.push(JSON.parse(ln))
  }
  return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- C1 默认关闭零留存 ----------
{
  const h = await setupHarness()
  globalThis.__h = h
  const am = await h.dbg()
  ok(am.contextBridge && am.contextBridge.enabled === false, 'C1 关闭态严格 {enabled:false}')
  ok(!existsSync(path.join(h.home, 'memory', 'evidence')), 'C1 默认不创建 evidence 目录')
  console.log('[C1] 默认关闭零留存')
}

// ---------- C2 开关矩阵 ----------
{
  const h = globalThis.__h
  await h.cfgPost({ associativeMemoryEnabled: true, contextBridgeEnabled: false })
  let am = await h.dbg()
  ok(am.contextBridge.enabled === false, 'C2 assoc=T/bridge=F → disabled')
  await h.cfgPost({ associativeMemoryEnabled: false, contextBridgeEnabled: true })
  am = await h.dbg()
  ok(am.contextBridge.enabled === false, 'C2 assoc=F/bridge=T → disabled(双门)')
  await h.cfgPost({ associativeMemoryEnabled: true, contextBridgeEnabled: true })
  am = await h.dbg()
  ok(am.contextBridge.enabled === true, 'C2 双开 → enabled')
  ok(am.contextBridge.sinkKind === 'null', 'C2 默认 sink=null(零 IO)')
  console.log('[C2] 开关矩阵(assoc∧bridge 双门)')
}

// ---------- C3 fake sink envelope 组装 ----------
{
  const h = globalThis.__h
  await h.cfgPost({ contextSinkMode: 'fake' })
  await h.fire('session/event', h.agent.session, { type: 'user/message', seq: 200, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '回忆一下之前的部署流程记录' }] } })
  await sleep(900)
  const am = await h.dbg()
  const cb = am.contextBridge
  ok(cb.stats.envelopesBuilt >= 1, 'C3 envelope 组建 ≥1(built=' + cb.stats.envelopesBuilt + ')')
  ok(cb.sinkKind === 'fake', 'C3 sink 切换为 fake')
  ok(cb.lastFrame && String(cb.lastFrame.observationId).startsWith('obs_'), 'C3 lastFrame.observationId=obs_*')
  ok(cb.lastFrame.memoryRefCount >= 1, 'C3 frame 含授权 memoryRefs(lexical 基线选中=' + cb.lastFrame.memoryRefCount + ')')
  ok(cb.stats.pushesAccepted >= 1, 'C3 fake sink 接受推送(accepted=' + cb.stats.pushesAccepted + ')')
  ok(!existsSync(evidenceEventsDir(h.home)) || readEvidenceLines(h.home).length === 0, 'C3 null→fake 切换前零落盘;envelope 推送本身不写盘(fake 内存态)')
  // A/B 隔离:B 会话不同 cwd,无 sidecar 语料 → 不崩溃且不产生跨工作区 refs
  const agentB = { id: 'b1', session: { id: 's2', header: { id: 's2', cwd: path.join(h.ws1, 'wsB') } } }
  await h.fire('agent/session-start', { agent: agentB, source: 'fresh' })
  await h.fire('session/event', agentB.session, { type: 'user/message', seq: 210, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: 'B 会话普通输入 部署流程' }] } })
  await sleep(700)
  const am2 = await h.dbg()
  ok(am2.contextBridge.stats.errors === 0, 'C3 A/B 并发零错误(errors=' + am2.contextBridge.stats.errors + ')')
  console.log('[C3] fake sink envelope 组装 + A/B 隔离')
}

// ---------- C4 read coverage 持久化 + 隐私投影 + stale 门 ----------
{
  const h = globalThis.__h
  // read 工具结果包含整份 anchored 文件内容(含 mem_bb token+记录全文)→ containment=1
  const exec = { agent: h.agent, callId: 'cx1', rootCallId: 'rx1', name: 'read' }
  const result = { value: { content: [{ type: 'text', text: h.wsMem.mdText }] } }
  await h.fire('tools/result', exec, result)
  await sleep(600)
  const lines = readEvidenceLines(h.home)
  ok(lines.length >= 1, 'C4 read evidence 落盘 ≥1 条(n=' + lines.length + ')')
  const readEv = lines.find((l) => l.kind === 'read')
  ok(!!readEv, 'C4 存在 kind=read')
  if (readEv) {
    eq(readEv.evidenceId && readEv.evidenceId.startsWith('ev_'), true, 'C4 evidenceId=ev_*')
    ok(readEv.coverage > 0 && readEv.coverage <= 1, 'C4 coverage∈(0,1](前缀比例=' + readEv.coverage + ')')
    ok(readEv.event.sessionRef && readEv.event.sessionRef.startsWith('sesr_'), 'C4 sessionRef=sesr_*')
    ok(readEv.workspaceRef && readEv.workspaceRef.startsWith('wsr_'), 'C4 workspaceRef=wsr_*')
    const rawAll = JSON.stringify(lines)
    ok(!rawAll.includes('sess') || !rawAll.includes(':s1'), 'C4 无裸 sessionId')
    ok(!rawAll.includes(h.ws1.replace(/\\/g, '\\/')) , 'C4 无绝对路径明文(ws1)')
    ok(readEv.source.sourceRef.startsWith('workspace:') || readEv.source.sourceRef.startsWith('user:'), 'C4 sourceRef 相对引用')
  }
  // stale 门:修改文件使 fingerprint 变化但 sidecar 未更新 → corpus fail closed → 无新 read;随后恢复原文件
  const before = readEvidenceLines(h.home).length
  writeFileSync(h.wsMem.file, h.wsMem.mdText + '\n<!-- drifted -->', 'utf8')
  await h.fire('tools/result', { agent: h.agent, callId: 'cx2', rootCallId: 'rx2', name: 'read' }, { value: { content: [{ type: 'text', text: h.wsMem.mdText + '\n<!-- drifted -->' }] } })
  await sleep(600)
  const mid = readEvidenceLines(h.home).length
  ok(mid === before, 'C4 stale-source 期间无新 read evidence(before=' + before + ')')
  writeFileSync(h.wsMem.file, h.wsMem.mdText, 'utf8')
  await sleep(400)
  console.log('[C4] read coverage 持久化 + 隐私 + stale fail closed')
}

// ---------- C5 cite / correction ----------
{
  const h = globalThis.__h
  const bbId = 'mem_' + 'bb'.repeat(16)
  const aaId = 'mem_' + 'aa'.repeat(16)
  await h.fire('session/event', h.agent.session, { type: 'user/message', seq: 300, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: aaId + ' 这条不对，已经过时了，别再用了' }] } })
  await h.fire('session/event', h.agent.session, { type: 'assistant/message', seq: 310, time: Date.now(), data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: '根据 ' + bbId + ' 的流程执行完成' }] } } })
  await sleep(800)
  const lines = readEvidenceLines(h.home)
  const corr = lines.find((l) => l.kind === 'correction')
  const cites = lines.filter((l) => l.kind === 'cite')
  ok(!!corr, 'C5 用户纠正词典+token → correction 落盘')
  ok(corr && corr.memoryId === aaId, 'C5 correction 关联正确 memoryId')
  ok(cites.some((c) => c.memoryId === bbId), 'C5 assistant 可见文本 token → cite 落盘')
  ok(lines.every((l) => l.policyVersion === 'evidence_v1'), 'C5 全部 evidence policyVersion 固定')
  console.log('[C5] cite/correction precision-first 落盘')
}

// ---------- C6 Shadow hit 不追认为 seen/read ----------
{
  const h = globalThis.__h
  await h.cfgPost({ shadowRetrievalEnabled: true, memoryAnchorEnabled: true })
  const before = readEvidenceLines(h.home).length
  await h.fire('session/event', h.agent.session, { type: 'user/message', seq: 400, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '回忆一下之前的部署流程记录' }] } })
  await sleep(1100)
  const auditDir = path.join(h.home, 'memory', 'retrieval-pre', 'audit')
  let auditCandidates = -1
  if (existsSync(auditDir)) {
    const f = readdirSync(auditDir).filter((x) => x.endsWith('.jsonl'))[0]
    if (f) {
      const allEvents = readFileSync(path.join(auditDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      const completed = allEvents.filter((e) => e.outcome === 'completed')
      auditCandidates = completed.length ? completed[completed.length - 1].candidates.length : 0
      if (auditCandidates <= 0) console.log('  [C6 diag] outcomes=' + JSON.stringify(allEvents.map((e) => e.outcome + '/' + e.reason + '/kept' + e.counts.kept)))
    }
  }
  const after = readEvidenceLines(h.home).length
  ok(auditCandidates > 0, 'C6 Shadow retrieve 有 candidates(n=' + auditCandidates + ')')
  ok(after === before, 'C6 Shadow hit 不产生任何新 AccessEvidence(before=' + before + ' after=' + after + ')')
  ok(!readEvidenceLines(h.home).some((l) => l.kind === 'seen'), 'C6 seen 类证据全程为零')
  const am = await h.dbg()
  const sr = am.shadowRetrieval
  ok(sr && sr.enabled === true, 'C6 shadow 视图开启(结构隔离共存)')
  console.log('[C6] Shadow hit 不追认 seen/read(结构隔离)')
}

// ---------- C7 关闭恢复零残留 ----------
{
  const h = globalThis.__h
  await h.cfgPost({ contextBridgeEnabled: false, shadowRetrievalEnabled: false })
  const am = await h.dbg()
  ok(am.contextBridge.enabled === false, 'C7 关闭后 debug 严格 {enabled:false}')
  const evDir = evidenceEventsDir(h.home)
  const sizeBefore = existsSync(evDir) ? readdirSync(evDir).reduce((a, f) => a + statSync(path.join(evDir, f)).size, 0) : 0
  await h.fire('session/event', h.agent.session, { type: 'user/message', seq: 500, time: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '关闭后再输入 ' + 'mem_' + 'bb'.repeat(16) }] } })
  await sleep(600)
  const sizeAfter = existsSync(evDir) ? readdirSync(evDir).reduce((a, f) => a + statSync(path.join(evDir, f)).size, 0) : 0
  ok(sizeAfter === sizeBefore, 'C7 关闭后零新增写入(bytes=' + sizeBefore + '→' + sizeAfter + ')')
  console.log('[C7] 关闭恢复零残留')
}

// ---------- C8 prompt 零变化 ----------
{
  const h = globalThis.__h
  ok(h.promptComponents.length === 3, 'C8 注册组件=section+context+m6 尾注面(n=' + h.promptComponents.length + ')')
  ok(h.promptComponents.every((c) => c.name && String(c.name).includes('-pre')), 'C8 组件名保持 _pre 命名空间')
  const ctxObj = { agent: h.agent }
  const textsBefore = h.promptComponents.map((c) => (typeof c.text === 'function' ? String(c.text(ctxObj)) : ''))
  ok(textsBefore.every((t) => !t.includes('[Retrieved memory reference')), 'C8 开启前无 Reference Tail 文本')
  await h.cfgPost({ contextBridgeEnabled: true })
  const textsAfter = h.promptComponents.map((c) => (typeof c.text === 'function' ? String(c.text(ctxObj)) : ''))
  // section(静态纪律)字节级稳定;context(动态快照)不承载 tail
  ok(textsAfter[1] === textsBefore[1], 'C8 section 输出逐字节不变(prompt 零变化)')
  ok(textsAfter.every((t) => !t.includes('[Retrieved memory reference')), 'C8 bridge 开启后仍零 Reference Tail(M5 不改 prompt)')
  console.log('[C8] prompt/section/context 零变化')
}

// 收尾
{
  const h = globalThis.__h
  try { await h.cfgPost({ associativeMemoryEnabled: false, contextBridgeEnabled: false, contextSinkMode: 'null', shadowRetrievalEnabled: false, memoryAnchorEnabled: false }) } catch (_) {}
  await h.settle()
  h.cleanup()
}

function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))) }
console.log('\n[M5-3] ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1