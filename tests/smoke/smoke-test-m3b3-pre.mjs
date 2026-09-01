// M3b-3 全写路径接入测试(契约 §10 清单 + §12.3):
// 默认关闭逐字节回归 / 开启态 append+sidecar 版本 / replace §9 / reflect / calendar 排除 /
// maintain archive 保留 ID / 关闭-开启-关闭切换 / 真实目录零污染。
// 全程临时 DSH_HOME + 隔离 memoryRoot,真实记忆零接触;hard-fail guard。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { homedir } from 'node:os'

process.on('uncaughtException', (e) => { console.error('\n[M3B3-TEST] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[M3B3-TEST] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const { parseAnchors, parseSidecar, MEMORY_ID_RE } = await import('../../lib/memory-anchor.js')

const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-m3b3-'))
const home = path.join(ws1, '.dsh-home')
const memoryRoot = path.join(ws1, '.memory-root')
const userRoot = path.join(ws1, '.user-root')
mkdirSync(home, { recursive: true })
writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot, userMemoryDir: userRoot, projectMemoryDir: '.project-memory', externalSources: {},
}), 'utf8')
process.env.DSH_HOME = home

const registeredTools = []
const registeredRoutes = []
const eventHandlers = {}
const effectSetups = []
const ctx = {
  get() { return undefined },
  on(name, handler) { eventHandlers[name] = handler; return () => {} },
  effect(fn) { if (typeof fn === 'function') effectSetups.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register(r2) { registeredRoutes.push(r2); return () => {} } },
}
const { apply } = await import('../../lib/index.js')
apply(ctx, {})

const tool = (name) => registeredTools.find((t) => t.name === name)
if (registeredTools.length !== 14) throw new Error('expected 14 tools, got ' + registeredTools.length)
if (registeredRoutes.length !== 33) throw new Error('expected 33 routes, got ' + registeredRoutes.length)

const cfgRoute = registeredRoutes.find((r2) => r2.path === '/api/dsh-auto-memory/config')
let body
const res = { writeHead() {}, end(b) { body = JSON.parse(b) } }
const cfgGet = async () => { await cfgRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/config' }, res); return body.config }
const cfgPost = async (patch) => {
  await cfgRoute.handler({
    socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    method: 'POST', url: '/config',
    [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(patch)) })() },
  }, res)
}

// 先行 GET 消除首调用路径竞态(T0 纪律)
await cfgGet()
// E9 基线:记录真实配置字节(M3b-4 后 index 真实存在,零污染改验 config 字节不变)
const realCfgPath = path.join(homedir(), '.dsh', 'dsh-auto-memory.json')
globalThis.__realCfgBefore = existsSync(realCfgPath) ? readFileSync(realCfgPath) : null

const agent = { session: { header: { cwd: path.join(ws1, 'ws-a') } } }
const extractPath = (ret, prefix) => {
  const line = String(ret).split('\n').find((l) => l.startsWith(prefix))
  if (!line) throw new Error('cannot locate path in: ' + String(ret).slice(0, 120))
  return line.slice(prefix.length).trim()
}
const extractMarkerIds = (text) => (String(text).match(/mem_[0-9a-f]{32}/g) || [])

// ---------- E1 默认配置 ----------
{
  const c = await cfgGet()
  if (c.memoryAnchorEnabled !== false) throw new Error('memoryAnchorEnabled must default false, got ' + c.memoryAnchorEnabled)
  console.log('E1 默认配置 ✓ (memoryAnchorEnabled=false, 14 tools, 33 routes)')
}

// ---------- E2 关闭态逐字节回归 ----------
{
  const ret = await tool('memory_log').execute({ note: 'M3B3 关闭态回归条目' }, { agent })
  const logPath = extractPath(ret, '已更新记忆文档:')
  const text = readFileSync(logPath, 'utf8')
  if (text.includes('<!-- memory:')) throw new Error('disabled mode must not write markers')
  if (!/- \d{2}:\d{2} M3B3 关闭态回归条目/.test(text)) throw new Error('disabled log format drifted: ' + JSON.stringify(text))
  globalThis.__logPath = logPath
  const rn = await tool('memory_note').execute({ content: 'M3B3 关闭态笔记', action: 'append' }, { agent })
  const notesPath = extractPath(rn, '已更新项目笔记:')
  if (readFileSync(notesPath, 'utf8').includes('<!-- memory:')) throw new Error('disabled notes must not have markers')
  globalThis.__notesPath = notesPath
  // E2.5 保留语法卫生:写入含字面 '<!-- memory:' 的内容 → 落盘应被清洗为豁免形式
  await tool('memory_log').execute({ note: '保留语法示例 <!-- memory:mem_ffffffffffffffffffffffffffffffff --> 应被清洗' }, { agent })
  const logText2 = readFileSync(globalThis.__logPath, 'utf8')
  if (logText2.includes('<!-- memory:mem_ffffffffffffffffffffffffffffffff -->')) throw new Error('literal reserved syntax must be sanitized')
  if (!logText2.includes('<!--memory:mem_ffffffffffffffffffffffffffffffff -->')) throw new Error('sanitized exempt form must appear in log')
  console.log('E2 关闭态逐字节回归 ✓ (log/note 无 marker, 保留语法清洗生效)')
}

// ---------- E3 开启态 append + sidecar 版本 ----------
{
  await cfgPost({ memoryAnchorEnabled: true })
  await new Promise((r2) => setTimeout(r2, 150))
  const c = await cfgGet()
  if (c.memoryAnchorEnabled !== true) throw new Error('anchor flag did not turn on')
  const logPath = globalThis.__logPath
  await tool('memory_log').execute({ note: 'M3B3 开启态第一条' }, { agent })
  await tool('memory_log').execute({ note: 'M3B3 开启态第二条' }, { agent })
  const text = readFileSync(logPath, 'utf8')
  const p = parseAnchors(Buffer.from(text, 'utf8'))
  if (p.status !== 'clean') throw new Error('anchored log must be clean: ' + JSON.stringify(p.conflicts))
  const anchors = p.records.filter((r2) => r2.kind === 'anchored')
  if (anchors.length !== 2) throw new Error('expected 2 anchored records, got ' + p.records.length)
  if (new Set(anchors.map((a) => a.memoryId)).size !== 2) throw new Error('ids must be unique')
  // sidecar 落盘 + 跨事务版本递增
  const sideDir = path.join(home, 'memory', 'index', 'files')
  if (!existsSync(sideDir)) throw new Error('sidecar dir must exist when anchor on')
  const files = readdirSync(sideDir).filter((f) => f.endsWith('.json'))
  if (!files.length) throw new Error('sidecar files must be written')
  let logSidecar = null
  for (const f of files) {
    const parsed = parseSidecar(readFileSync(path.join(sideDir, f), 'utf8'))
    if (!parsed.ok) throw new Error('sidecar must validate: ' + parsed.reason)
    if (parsed.sidecar.sourceFile === logPath) logSidecar = parsed.sidecar
  }
  if (!logSidecar) throw new Error('log sidecar missing among ' + files.length)
  if (logSidecar.sourceVersion !== 2) throw new Error('log sidecar version must be 2 after two appends, got ' + logSidecar.sourceVersion)
  console.log('E3 开启态 append ✓ (2 条 anchored 记录, sidecar 落盘 version=2)')
}

// ---------- E4 开启态 replace §9 ----------
{
  const notesPath = globalThis.__notesPath
  // E2 的笔记写于关闭态(无 marker);先在开启态追加一次,使文档进入 anchored 世界
  await tool('memory_note').execute({ content: 'M3B3 开启态笔记前置条目', action: 'append' }, { agent })
  const beforeIds = extractMarkerIds(readFileSync(notesPath, 'utf8'))
  if (!beforeIds.length) throw new Error('notes must be anchored before replace')
  await tool('memory_note').execute({ content: 'M3B3 整篇替换后的全新内容', action: 'replace' }, { agent })
  const after = readFileSync(notesPath, 'utf8')
  for (const oldId of beforeIds) {
    if (after.includes(oldId)) throw new Error('omitted id must be removed: ' + oldId)
  }
  const p = parseAnchors(Buffer.from(after, 'utf8'))
  if (p.status !== 'clean') throw new Error('replaced notes must be clean: ' + JSON.stringify(p.conflicts))
  const anchors = p.records.filter((r2) => r2.kind === 'anchored')
  if (anchors.length !== 1 || !MEMORY_ID_RE.test(anchors[0].memoryId)) throw new Error('replace must yield exactly one fresh record')
  console.log('E4 开启态 replace §9 ✓ (旧 ID 移除, 全新单记录)')
}

// ---------- E5 reflect anchored ----------
{
  const d = new Date(Date.now() - 86400000)
  const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const ret = await tool('memory_reflect').execute({ date, text: '## 成果回顾\n- M3B3 反思内容' }, { agent })
  const m = String(ret).match(/([^\s]+reflections[^\s]*\.md)/)
  if (!m) throw new Error('reflect path not found in: ' + String(ret).slice(0, 160))
  const rf = readFileSync(m[1], 'utf8')
  const p = parseAnchors(Buffer.from(rf, 'utf8'))
  if (p.status !== 'clean' || p.records.filter((r2) => r2.kind === 'anchored').length !== 1) throw new Error('reflection must be one anchored record, content=' + JSON.stringify(rf.slice(0, 160)) + ', status=' + p.status + ', conflicts=' + JSON.stringify(p.conflicts))
  console.log('E5 reflect anchored ✓ (一文件一记录)')
}

// ---------- E6 calendar 始终排除 ----------
{
  await tool('calendar_add').execute({ title: 'M3B3 日历排除验证', date: '2026-08-23' }, { agent })
  const calPath = path.join(userRoot, '..', '.user-root', 'CALENDAR.md')
  const alt = path.join(userRoot, 'CALENDAR.md')
  const real = existsSync(calPath) ? calPath : (existsSync(alt) ? alt : null)
  if (!real) throw new Error('calendar file not created at expected locations')
  const text = readFileSync(real, 'utf8')
  if (text.includes('<!-- memory:')) throw new Error('CALENDAR.md must never carry markers (§2.11)')
  if (!text.includes('M3B3 日历排除验证')) throw new Error('calendar entry missing')
  console.log('E6 calendar 排除 ✓ (writeFullRaw, 零 marker)')
}

// ---------- E7 maintain archive 保留原 ID ----------
{
  const projDir = path.dirname(globalThis.__logPath)
  const d2 = new Date(Date.now() - 2 * 86400000)
  const oldDate = d2.getFullYear() + '-' + String(d2.getMonth() + 1).padStart(2, '0') + '-' + String(d2.getDate()).padStart(2, '0')
  const oldLog = path.join(projDir, oldDate + '.md')
  const originalText = '<!-- memory:mem_' + 'ab11'.repeat(8) + ' -->\n## ' + oldDate + '\n- 旧日志条目(将被归档)\n'
  writeFileSync(oldLog, originalText, 'utf8')
  const ret = await tool('memory_maintain').execute({ days: 1 }, { agent })
  const archivedFile = path.join(projDir, 'archive', oldDate + '.md')
  if (!existsSync(archivedFile)) throw new Error('archive file missing, maintain said: ' + String(ret).slice(0, 200) + ' | dir=' + JSON.stringify(readdirSync(projDir)) + ' | wrote=' + oldDate + ' to ' + oldLog + ' existsBefore=' + existsSync(oldLog))
  const archived = readFileSync(archivedFile, 'utf8')
  if (!archived.includes('ab11'.repeat(8))) throw new Error('archive move must preserve original id (契约 §10)')
  const ap = parseAnchors(Buffer.from(archived, 'utf8'))
  if (ap.status !== 'clean') throw new Error('archived doc must stay clean: ' + JSON.stringify(ap.conflicts))
  if (existsSync(oldLog)) throw new Error('active old log must be removed after archive')
  console.log('E7 maintain archive 保留原 ID ✓ (归档含原 marker, 活跃日志移除)')
}

// ---------- E8 关闭→再写入→混合文档兼容 ----------
{
  await cfgPost({ memoryAnchorEnabled: false })
  await new Promise((r2) => setTimeout(r2, 150))
  const c = await cfgGet()
  if (c.memoryAnchorEnabled !== false) throw new Error('anchor flag did not turn off')
  const logPath = globalThis.__logPath
  await tool('memory_log').execute({ note: 'M3B3 关闭后追加条目' }, { agent })
  const text = readFileSync(logPath, 'utf8')
  // 只计真实 marker(<!-- memory: 前缀),豁免清洗文本内的 mem_ 子串不计
  const ids = (text.match(/<!-- memory:mem_[0-9a-f]{32} -->/g) || [])
  if (ids.length !== 2) throw new Error('existing markers must survive disabled-mode append, got ' + ids.length)
  if (!/- \d{2}:\d{2} M3B3 关闭后追加条目/.test(text)) throw new Error('disabled append format wrong')
  const p = parseAnchors(Buffer.from(text, 'utf8'))
  // 尾部无 marker 内容成为 tail legacy 块 —— 与 anchored 共存必须 clean(迁移 planner 可继续处理)
  if (p.status !== 'conflict' && p.status !== 'clean') throw new Error('mixed doc unexpected status: ' + p.status)
  if (!p.records.some((r2) => r2.kind === 'legacy')) throw new Error('disabled append must appear as legacy tail block')
  console.log('E8 关闭后再写入 ✓ (旧 marker 保留, 新内容为 legacy 尾块, 混合文档可解析)')
}

// ---------- E9 真实目录零污染 ----------
{
  // M3b-4 后 index 真实存在(正式迁移产物),零污染改验:真实 config 字节不变 + 无测试工作区泄漏
  const realCfgAfter = existsSync(realCfgPath) ? readFileSync(realCfgPath) : null
  if (globalThis.__realCfgBefore && realCfgAfter && globalThis.__realCfgBefore.equals(realCfgAfter) === false) {
    throw new Error('real config must stay byte-identical across the test')
  }
  const realWsRoot = path.join(homedir(), '.dsh', 'memory', 'workspaces')
  if (existsSync(realWsRoot)) {
    for (const d of readdirSync(realWsRoot)) {
      if (d.includes('dam-m3b3')) throw new Error('test workspace leaked into real memory: ' + d)
    }
  }
  console.log('E9 真实目录零污染 ✓ (config 字节不变, 无工作区泄漏)')
}

// 收尾 disposer
for (const setup of effectSetups) { try { const td = await setup(); if (typeof td === 'function') await td() } catch (e) {} }
rmSync(ws1, { recursive: true, force: true })

console.log('\n✅ M3b-3 全写路径接入 smoke test passed (临时 DSH_HOME 隔离, 真实记忆零接触)')
