// F1 结构修复测试:anchor 开启时 compactLayer 记录级压缩(整条保留/移除,经 store.replace,永不字符切片)。
// 超预算触发→今天记录无条件保留→最旧记录整条入归档(writeFullRaw)→腾位后可继续写入。临时 DSH_HOME。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[F1-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[F1-TEST] REJ:', r); process.exit(1) })

const { parseAnchors } = await import('../../lib/memory-anchor.js')
const genProse = (tag, n) => { let s = tag + '。'; for (let i = 1; i <= n; i++) s += '第' + i + '条要点：围绕模块' + (i % 9) + '的接口约定与参数校验做出决定，附带边界条件说明和示例路径。'; return s }
let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }

async function setupHarness(opts = {}) {
  const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-f1-'))
  const home = path.join(ws1, '.dsh-home')
  const memoryRoot = path.join(ws1, 'mem')
  const wsA = path.join(ws1, 'wsA')
  mkdirSync(home, { recursive: true }); mkdirSync(memoryRoot, { recursive: true }); mkdirSync(wsA, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot, userMemoryDir: path.join(ws1, 'user'), projectMemoryDir: '.project-memory',
    externalSources: {}, ...(opts.configPatch || {}) }), 'utf8')
  process.env.DSH_HOME = home
  const tools = []; const routes = []; const handlers = new Map(); const effectSetups = []
  const promptComponents = []
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
  return { ws1, home, wsA, tools, fire, promptComponents,
    settle: async () => { for (const s of effectSetups) { try { const td = await s(); if (typeof td === 'function') await td() } catch (_) {} } },
    cleanup: () => { try { rmSync(ws1, { recursive: true, force: true }) } catch (_) {} } }
}

console.log('[G1/G2/G3] anchor 开启:超预算 → 记录级压缩(整条归档+腾位)')
{
  const h = await setupHarness({ configPatch: { memoryAnchorEnabled: true } })
  const agent = { id: 'a1', session: { id: 's1', header: { id: 's1', cwd: h.wsA } } }
  await h.fire('agent/session-start', { agent, source: 'fresh' })
  await new Promise((r) => setTimeout(r, 250))
  // 构造带 3 条 anchored 记录的项目笔记:A(旧,大)、B(旧,大)、C(今天,小)
  const idA = 'mem_' + 'aa'.repeat(16), idB = 'mem_' + 'bb'.repeat(16), idC = 'mem_' + 'cc'.repeat(16)
  // 动态日期(与引擎 memToday 同款 450 分钟日界):硬编码日期跨日即 flake(audit)
  const pad2F1 = (n) => String(n).padStart(2, '0')
  const dAdjF1 = new Date()
  if (dAdjF1.getHours() * 60 + dAdjF1.getMinutes() < 450) dAdjF1.setDate(dAdjF1.getDate() - 1)
  const fmtD = (dd) => dd.getFullYear() + '-' + pad2F1(dd.getMonth() + 1) + '-' + pad2F1(dd.getDate())
  const daysAgo = (n) => { const x = new Date(dAdjF1); x.setDate(x.getDate() - n); return fmtD(x) }
  const p = { root: path.join(h.ws1, 'mem'), dir: null }
  p.dir = path.join(p.root, '--' + h.wsA.replace(/[\\/:*?"<>|]/g, '-') + '--')
  mkdirSync(p.dir, { recursive: true })
  const notesFile = path.join(p.dir, 'MEMORY.md')
  const recA = '<!-- memory:' + idA + ' -->\n## ' + daysAgo(5) + '\n' + 'A'.repeat(2400)
  const recB = '<!-- memory:' + idB + ' -->\n## ' + daysAgo(2) + '\n' + 'B'.repeat(900)
  const recC = '<!-- memory:' + idC + ' -->\n## ' + fmtD(dAdjF1) + '\n- 今天的记录'
  writeFileSync(notesFile, [recA, recB, recC].join('\n'), 'utf8')
  // 写对应 sidecar(与 m53 相同方式)
  const buf = readFileSync(notesFile)
  const p0 = parseAnchors(buf)
  const records0 = p0.records.filter((r) => r.kind === 'anchored').map((r) => ({
    memoryId: r.memoryId, anchorId: r.anchorId || null, anchorLine: r.anchorLine || null,
    anchorByteStart: r.markerByteStart, anchorByteEnd: r.markerByteEnd,
    heading: r.heading != null ? r.heading : null,
    lineStart: r.lineStart, lineEnd: r.lineEnd, byteStart: r.byteStart, byteEnd: r.byteEnd,
    bytes: r.bytes, recordDigest: r.recordDigest, sourceVersion: 1, fileDigest: sha256Hex(buf),
  }))
  const sideDir = path.join(h.home, 'memory', 'index', 'files')
  mkdirSync(sideDir, { recursive: true })
  const canon = (x) => path.resolve(x).replace(/\\/g, '/').toLowerCase()
  const sidePath = path.join(sideDir, createHash('sha256').update(canon(notesFile), 'utf8').digest('hex') + '.json')
  writeFileSync(sidePath, JSON.stringify({ schemaVersion: 1, namespace: 'dsh-auto-memory', sourceFile: notesFile,
    sourceEpoch: '44444444-4444-4444-8444-444444444444', sourceVersion: 1, fileDigest: sha256Hex(buf),
    newline: 'lf', updatedAt: 1700000000000, records: records0 }, null, 2) + '\n', 'utf8')
  const memIds = () => { const b2 = readFileSync(notesFile); const pp = parseAnchors(b2); return { status: pp.status, ids: pp.records.filter((r) => r.kind === 'anchored').map((r) => r.memoryId) } }
  const before = memIds()
  eq(before.status, 'clean', 'G1 初始文件 clean')
  eq(before.ids, [idA, idB, idC], 'G1 初始 id 序 A,B,C')
  // 触发:第一笔 2200 字(写入为今天的 anchored 记录 D) → 第二笔 2200 字超日预算 → 压缩
  const noteTool = h.tools.find((t) => t.name === 'memory_note')
  ok(!!noteTool, 'memory_note 工具已注册')
  const big1 = genProse('第一笔内容', 45)
  const out1 = await noteTool.execute({ content: big1, action: 'append' }, { agent })
  ok(String(out1).includes('已更新项目笔记'), 'G1 第一笔写入成功')
  const midIds = memIds()
  const big2 = genProse('第二笔内容', 45)
  const out2 = await noteTool.execute({ content: big2, action: 'append' }, { agent })
  ok(String(out2).includes('已更新项目笔记'), 'G2 超预算触发记录级压缩后第二笔写入成功(腾位生效)')
  // 主文件状态
  const after = memIds()
  eq(after.status, 'clean', 'G2 压缩后主文件 clean')
  ok(!after.ids.includes(idA) && !after.ids.includes(idB), 'G2 最旧两条(A,B)被整条移除')
  ok(after.ids.includes(idC), 'G2 今天记录 C 无条件保留')
  eq(after.ids.length, 3, 'G2 剩余 C+两笔新记录(n=' + after.ids.length + ')')
  // 归档:整条原文逐字节包含 A/B 的 marker 与正文
  const archCandidates = [
    path.join(p.dir, 'archive', 'notes-archived.md'),
  ]
  let archiveText = null
  for (const f of archCandidates) if (existsSync(f)) archiveText = readFileSync(f, 'utf8')
  ok(!!archiveText, 'G2 归档文件存在')
  if (archiveText) {
    ok(archiveText.includes('<!-- memory:' + idA + ' -->') && archiveText.includes('## ' + daysAgo(5)), 'G2 归档含 A 整条(marker+日期标题+正文)')
    ok(archiveText.includes(idB) , 'G2 归档含 B')
    ok(!archiveText.includes(idC), 'G2 归档不含今天记录 C')
  }
  // sidecar fresh 且保留 id 稳定(C 同 id 同记录)
  const sp = path.join(h.home, 'memory', 'index', 'files', createHash('sha256').update(canon(notesFile), 'utf8').digest('hex') + '.json')
  const sc = JSON.parse(readFileSync(sp, 'utf8'))
  const buf2 = readFileSync(notesFile)
  eq(sc.fileDigest, sha256Hex(buf2), 'G3 sidecar fileDigest 与当前文件一致(FRESH)')
  const scIds = sc.records.map((r) => r.memoryId)
  ok(scIds.includes(idC), 'G3 保留记录 C 的 id 在 sidecar 中稳定不变')
  ok(!scIds.includes(idA) && !scIds.includes(idB), 'G3 被移除记录已从 sidecar 删除')
  // G3 腾位后再写小条成功
  const out3 = await noteTool.execute({ content: '- 压缩后的追加', action: 'append' }, { agent })
  ok(String(out3).includes('已更新项目笔记'), 'G3 压缩后继续写入成功')
  // G4 无 BOM
  const head = readFileSync(notesFile)
  ok(!(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf), 'G3 主文件无 BOM')
  console.log('[G1-G3] 记录级压缩全链路')
  await h.settle(); h.cleanup()
}

console.log('[G4] anchor 关闭:旧文本路径不异常')
{
  const h = await setupHarness({ configPatch: { memoryAnchorEnabled: false } })
  const agent = { id: 'a2', session: { id: 's2', header: { id: 's2', cwd: h.wsA } } }
  await h.fire('agent/session-start', { agent, source: 'fresh' })
  await new Promise((r) => setTimeout(r, 250))
  const noteTool = h.tools.find((t) => t.name === 'memory_note')
  const big = genProse('旧路径大内容', 45)
  const o1 = await noteTool.execute({ content: big, action: 'append' }, { agent })
  ok(String(o1).includes('已更新项目笔记'), 'G4 关闭态首笔照常写入')
  const o2 = await noteTool.execute({ content: big + '二', action: 'append' }, { agent })
  ok(typeof o2 === 'string' && o2.length > 0, 'G4 超预算走旧路径优雅处理(不崩溃,返回说明)')
  console.log('[G4] anchor 关闭回归')
  await h.settle(); h.cleanup()
}

function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a))) }
function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex') }
console.log('')
console.log('F1 smoke: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1