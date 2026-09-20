// M3a 只读 MemoryFileIndex 测试(系统地图 M-06 契约 + 审查闭环轮2):
// 不修改 Markdown / 确定性重建 / 文件级版本语义 / coverage() / stale(文件级+前置插入) /
// 多字节字符 / CRLF / 模块级 5MB 上限 / 关闭零行为变化 / engine 版本递增 / 并发会话归属。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.on('uncaughtException', (e) => { console.error('\n[M3A-TEST] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[M3A-TEST] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const { buildIndex, verifyRecord, coverage, splitByteLines, INDEX_MAX_FILE_BYTES } = await import('../../lib/memory-index.js')

// ---------- B1 确定性重建 + 版本 + 文件级 stale ----------
{
  const text = '用户级纪律：不存密钥。\n## 2026-08-22\n- 修复了缓存穿透 bug 🙂\n- 完成了登录模块重构\n## 2026-08-21\n- 中文编码验证：你🙂好\n'
  const buf = Buffer.from(text, 'utf8')
  const i1 = buildIndex('a.md', buf, undefined)
  const i2 = buildIndex('a.md', buf, { fileDigest: i1.fileDigest, version: i1.sourceVersion })
  if (i1.records.length !== 2) throw new Error('records expected 2, got ' + i1.records.length)
  if (i1.sourceVersion !== i2.sourceVersion) throw new Error('rebuild must keep sourceVersion')
  if (!i1.records[0].sourceVersion || i1.records[0].fileDigest !== i1.fileDigest) throw new Error('records must carry file-level identity')
  const edited = Buffer.from(text.replace('登录模块重构', '架构重构'), 'utf8')
  const i3 = buildIndex('a.md', edited, { fileDigest: i1.fileDigest, version: i1.sourceVersion })
  if (i3.sourceVersion !== 2) throw new Error('edited file must bump sourceVersion to 2')
  const buf2edit = Buffer.from(text.replace('中文编码验证', '中文编码复查'), 'utf8')
  if (verifyRecord(i1.records[0], buf2edit).fresh) throw new Error('other-block edit must stale block1 (file-level)')
  console.log('B1 determinism+version+file-level stale ✓')
}

// ---------- B2 coverage / stale / 前置插入 ----------
{
  const text = '## 2026-08-22\n- 修复了缓存穿透 bug 🙂\n- 完成了登录模块重构\n'
  const buf = Buffer.from(text, 'utf8')
  const idx = buildIndex('b.md', buf, undefined)
  const rec = idx.records[0]
  const full = coverage([rec.byteStart, rec.byteEnd], rec, buf)
  if (full.status !== 'fresh' || full.ratio !== 1) throw new Error('full coverage broken')
  const half = coverage([rec.byteStart, rec.byteStart + Math.floor(rec.bytes / 2)], rec, buf)
  if (half.ratio < 0.49 || half.ratio > 0.51) throw new Error('half coverage broken')
  const disjoint = coverage([rec.byteEnd + 100, rec.byteEnd + 200], rec, buf)
  if (disjoint.ratio !== 0 || disjoint.status !== 'fresh') throw new Error('disjoint coverage should be fresh ratio 0')
  const edited = Buffer.from(text.replace('缓存穿透 bug', '缓存穿透漏洞'), 'utf8')
  if (verifyRecord(rec, edited).fresh) throw new Error('edited block must be stale')
  if (coverage([rec.byteStart, rec.byteEnd], rec, edited).status !== 'stale') throw new Error('stale must reject, not fake coverage=0')
  const prepended = Buffer.from('## 2026-08-20\n- 前置插入行\n' + text, 'utf8')
  if (verifyRecord(rec, prepended).fresh) throw new Error('prepended file must be stale')
  console.log('B2 coverage+stale+prepend ✓')
}

// ---------- B3 多字节字符(精确断言交付说明的固定值) ----------
{
  const head = '用户：你🙂好\n'
  const block = '## 2026-08-22\n- 中文🙂emoji 混合\n'
  const buf = Buffer.from(head + block, 'utf8')
  const idx = buildIndex('c.md', buf, undefined)
  const rec = idx.records[0]
  if (rec.byteStart !== 20) throw new Error('multibyte byteStart must be 20, got ' + rec.byteStart)
  if (rec.bytes !== 39) throw new Error('multibyte bytes must be 39, got ' + rec.bytes)
  if (rec.chars !== 28) throw new Error('multibyte chars must be 28, got ' + rec.chars)
  const slice = buf.subarray(rec.byteStart, rec.byteEnd).toString()
  if (!slice.startsWith('## 2026-08-22') || slice.indexOf('中文🙂emoji 混合') < 0) throw new Error('multibyte slice mismatch')
  console.log('B3 multibyte ✓ (byteStart=20 bytes=39 chars=28)')
}

// ---------- B4 CRLF 容错 ----------
{
  const lines = splitByteLines(Buffer.from('a\r\n## b\r\nc\r\n', 'utf8'))
  if (lines.map((l) => l.text).join('|') !== 'a|## b|c') throw new Error('CRLF split wrong')
  const idx = buildIndex('d.md', '## 标题\r\n- 内容一\r\n- 内容二\r\n', undefined)
  if (idx.records[0].lineStart !== 1 || idx.records[0].lineEnd !== 3) throw new Error('CRLF line locator wrong')
  console.log('B4 CRLF ✓')
}

// ---------- B4.5 模块级 5MB 上限(含合法标题的超限文件) ----------
{
  const big = Buffer.concat([Buffer.from('## 2026-08-22\n- 大文件标题行\n', 'utf8'), Buffer.alloc(INDEX_MAX_FILE_BYTES + 16, 0x61)])
  const idx = buildIndex('big.md', big, { fileDigest: 'x', version: 1 })
  if (!idx.skipped) throw new Error('module must skip oversized buffer')
  if (idx.records.length !== 0 || idx.fileDigest !== '') throw new Error('skipped result must be empty')
  if (idx.sourceVersion !== 1) throw new Error('skipped result keeps version')
  const small = buildIndex('ok.md', '## 2026-08-22\n- ok\n', undefined)
  if (small.skipped || small.records.length !== 1) throw new Error('small file must not be skipped')
  console.log('B4.5 module 5MB cap ✓ (heading-bearing oversized buffer skipped at module level)')
}

// ---------- B5 关闭零行为变化 + engine 版本递增 + stat 守卫 + 并发归属 ----------
{
  const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-m3c-'))
  const home = path.join(ws1, '.dsh-home')
  mkdirSync(home, { recursive: true })
  const memoryRoot = path.join(ws1, '.memory-root')
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot, userMemoryDir: path.join(ws1, '.user-root'), projectMemoryDir: '.project-memory', externalSources: {},
  }), 'utf8')
  process.env.DSH_HOME = home
  const keyOf = (p2) => '--' + p2.replace(/[\\/:*?"<>|]/g, '-') + '--'
  // 插件"今天"(dayBoundaryMinutes=450):00:00-07:30 归前一日,与引擎 memToday() 一致(跨天稳定)
  const plugToday = () => { const d = new Date(Date.now() - 450 * 60000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
  const TODAY_MD = plugToday() + '.md'
  const wsA = path.join(ws1, 'ws-a')
  const wsB = path.join(ws1, 'ws-b')
  mkdirSync(wsA, { recursive: true })
  mkdirSync(wsB, { recursive: true })
  const mkMem = (ws, name, content) => {
    const dir = path.join(memoryRoot, keyOf(ws))
    mkdirSync(dir, { recursive: true })
    const f = path.join(dir, name)
    writeFileSync(f, content, 'utf8')
    return f
  }
  const logA = mkMem(wsA, TODAY_MD, '## A-会话日志\n- 多字节你🙂好 A\n')
  const logB = mkMem(wsB, TODAY_MD, '## B-会话日志\n- B 专属条目\n')
  const notesB = mkMem(wsB, 'MEMORY.md', '## 2026-08-22\n- B 项目笔记\n')
  mkdirSync(path.join(ws1, '.user-root'), { recursive: true })
  const bigUser = path.join(ws1, '.user-root', 'MEMORY.md')
  writeFileSync(bigUser, Buffer.concat([Buffer.from('## 2026-08-22\n- big\n'), Buffer.alloc(INDEX_MAX_FILE_BYTES + 1, 0x62)]))
  if (statSync(bigUser).size <= INDEX_MAX_FILE_BYTES) throw new Error('big fixture too small')

  const registeredRoutes = []
  const eventHandlers = new Map()
  const effectSetups = []
  const ctx = {
    get() { return undefined },
    on(name, handler) { eventHandlers.set(name, handler); return () => {} },
    effect(fn) { if (typeof fn === 'function') effectSetups.push(fn); return () => {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register() { return () => {} } },
    webServer: { register(r2) { registeredRoutes.push(r2); return () => {} } },
  }
  const { apply } = await import('../../lib/index.js')
  apply(ctx, {})
  const cfgRoute = registeredRoutes.find((r2) => r2.path === '/api/dsh-auto-memory/config')
  const dbgRoute = registeredRoutes.find((r2) => r2.path === '/api/dsh-auto-memory/debug')
  let body
  const res = { writeHead() {}, end(b) { body = JSON.parse(b) } }
  await cfgRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/config' }, res)
  if (body.config.memoryFileIndexEnabled !== false) throw new Error('M3a flag must default false')
  for (let i = 0; i < 2; i++) {
    await dbgRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, res)
    const offIdx = body.associativeMemory.memoryIndex
    if (!offIdx || offIdx.enabled !== false) throw new Error('disabled must show enabled=false')
    if (offIdx.files !== undefined) throw new Error('disabled mode must not read files')
  }
  const startAgent = (id, cwd) => {
    const ag = { id, session: { id: id + '-s', header: { id: id + '-s', cwd }, events: [] } }
    return eventHandlers.get('agent/session-start')({ agent: ag, source: 'fresh' })
  }
  await startAgent('agent-a', wsA)
  await startAgent('agent-b', wsB)
  await cfgRoute.handler({
    socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    method: 'POST', url: '/config',
    [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify({ memoryFileIndexEnabled: true })) })() },
  }, res)
  await new Promise((r2) => setTimeout(r2, 80))
  await dbgRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, res)
  const onIdx = body.associativeMemory.memoryIndex
  if (!onIdx || onIdx.enabled !== true) throw new Error('enabled flag missing')
  if (!Array.isArray(onIdx.files) || !onIdx.files.length) throw new Error('enabled mode must build files')
  if (!onIdx.files[0].ownerWs || !onIdx.files[0].ownerWs.includes('ws-b')) throw new Error('owner must be last-started session B, files=' + JSON.stringify(onIdx.files))
  for (const f of onIdx.files) {
    if (f.fileDigest && f.fileDigest.length !== 64) throw new Error('fileDigest must be full 64-hex: ' + f.fileDigest)
  }
  const skipEntry = onIdx.files.find((f) => f.sourceFile === bigUser)
  if (!skipEntry || !skipEntry.skipped) throw new Error('oversized userFile must be skipped by stat guard: ' + JSON.stringify(skipEntry))
  writeFileSync(logB, '## B-会话日志\n- B 专属条目(修订)\n', 'utf8')
  await new Promise((r2) => setTimeout(r2, 60))
  await dbgRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, res)
  const onIdx2 = body.associativeMemory.memoryIndex
  const logBEntry = onIdx2.files.find((f) => f.sourceFile === logB)
  if (!logBEntry || logBEntry.sourceVersion !== 2) throw new Error('host must increment sourceVersion on edit')
  const notesBEntry = onIdx2.files.find((f) => f.sourceFile === notesB)
  if (!notesBEntry || notesBEntry.sourceVersion !== 1) throw new Error('untouched file must keep sourceVersion 1')
  if (onIdx2.files.some((f) => f.sourceFile === logA)) throw new Error('snapshot must scope to owner workspace only (no A files)')
  if (readFileSync(logA, 'utf8') !== '## A-会话日志\n- 多字节你🙂好 A\n') throw new Error('Markdown must not be modified')
  await startAgent('agent-a', wsA)
  await new Promise((r2) => setTimeout(r2, 60))
  await dbgRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, res)
  const onIdx3 = body.associativeMemory.memoryIndex
  if (!onIdx3.files[0].ownerWs.includes('ws-a')) throw new Error('owner must follow last-started agent A')
  await cfgRoute.handler({
    socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    method: 'POST', url: '/config',
    [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify({ memoryFileIndexEnabled: false })) })() },
  }, res)
  for (const setup of effectSetups) { try { const td = await setup(); if (typeof td === 'function') await td() } catch (e) {} }
  rmSync(ws1, { recursive: true, force: true })
  console.log('B5 zero-change + version bump + stat guard + ownership ✓')
}

console.log('\n✅ M3a MemoryFileIndex smoke test passed (incl. review-round2 regressions)')
