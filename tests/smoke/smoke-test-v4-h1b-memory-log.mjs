#!/usr/bin/env node
/**
 * smoke-test-v4-h1b-memory-log.mjs —— H1-B：memory_log 改造后行为（事件检查点 + 日视图派生）
 *
 * 源码抽取 defineTool(memory_log) 产线同一份代码后真调 execute，断言检查点数/日视图行数/state.logText 无锚点/失败不 fallback。
 *
 * 来源：2026-10-25 由 A 线一次性验证脚本升格为永久回归套件（Lead 批准）。
 * 升格理由：这些断言是 v4-H 写入层的核心不变量，只放临时目录 ⇒ 下次谁改回去只有临时跑才发现。
 *
 * 纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值/副作用；每条正向都配负路径。
 * 全部在仓库内的 .tmp-smoke-run/ 临时目录里跑（每次自清），不碰真实 handoff/ 与真实记忆目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { createHash } from 'node:crypto'

import { fileURLToPath } from 'node:url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('FAIL ' + n + (d ? '  =>  ' + d : '')) } }

const SANDBOX = path.join(REPO, '.tmp-smoke-run/s2b')
fs.rmSync(SANDBOX, { recursive: true, force: true })
const PROJ = path.join(SANDBOX, 'proj')
fs.mkdirSync(path.join(PROJ, 'handoff'), { recursive: true })

// ── 真 import 依赖模块（与产线同一份）──
const EW = await import(pathToFileURL(path.join(REPO, 'lib/event-write.js')).href)

// ── 从 index.js 抽取 memory_log 的 defineTool 调用（括号配平扫描）──
const IDX = fs.readFileSync(path.join(REPO, 'lib/index.js'), 'utf8')
const START = IDX.indexOf("defineTool('memory_log'")
ok(START > 0, '找到 defineTool(memory_log) 定义', 'idx=' + START)
let i = IDX.indexOf('(', START), depth = 0, end = -1
for (; i < IDX.length; i++) {
  const ch = IDX[i]
  if (ch === '(') depth++
  else if (ch === ')') { depth--; if (depth === 0) { end = i + 1; break } }
}
const callSrc = IDX.slice(START, end)
ok(callSrc.length > 3000, '抽取到 memory_log 定义', callSrc.length + ' 字符')
ok(callSrc.includes('resolveActiveEventPre'), '★抽取的代码含事件写入（H1 已落盘）')
ok(callSrc.includes('deriveDayViewToDiskPre'), '★抽取的代码含日视图派生')
ok(!callSrc.includes('engine.appendText(logPath, entry)'), '★旧实现（直接 appendText）已不在')

// ── 造最小 engine（只实现被调用的方法，全部真实现）──
const state = { logText: '', logPath: '', loadedAt: 0 }
const engine = {
  state,
  config: { dayBoundaryMinutes: 450 },
  memToday() {
    const b = 450
    const d = new Date()
    if (d.getHours() * 60 + d.getMinutes() < b) d.setDate(d.getDate() - 1)
    const pad = n => n < 10 ? '0' + n : '' + n
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
  },
  async resolvePaths() { return { projectDir: PROJ, handoffDir: path.join(PROJ, 'handoff') } },
  async readTextSafe(p) { try { return fs.readFileSync(p, 'utf8') } catch (_) { return '' } },
  // 真实现：模拟 MemoryDocumentStore 的锚点行为（每次 append 生成新锚点）
  async appendText(p, text) {
    const fakeId = 'mem_' + Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32)
    fs.appendFileSync(p, '<!-- memory:' + fakeId + ' -->\n\n' + text + '\n', 'utf8')
    return fs.readFileSync(p, 'utf8')
  },
  _degradeSink: null,
  async refreshEventStatePre() {},
}

// ── 依赖（产线同源）──
const deps = {
  DATE_RE: /^(\d{4})-(\d{2})-(\d{2})$/, path, sanitizeForWrite, writeGateRefusalTextPre, tailHas, nowHm,
  LOG_KINDS_PRE_V1: ['rule', 'preference', 'fact', 'todo'],
  createHash, recordDiagnosticErrorPre: () => {},
  eventStorePathOfPre: EW.eventStorePathOfPre,
  readEventStorePre: EW.readEventStorePre,
  resolveActiveEventPre: EW.resolveActiveEventPre,
  createEventForWorkPre: EW.createEventForWorkPre,
  appendCheckpointPre: EW.appendCheckpointPre,
  renderDayViewPre: EW.renderDayViewPre,
  deriveDayViewToDiskPre: EW.deriveDayViewToDiskPre,
}

// 这些是 index.js 里的**模块级函数**，抽取的代码会引用它们 ⇒ 必须按产线口径提供
function sanitizeForWrite(text, opts) {
  const raw = String(text || '')
  if (!raw.length) return { ok: false, reason: 'empty' }
  const max = (opts && opts.maxEntryChars) || 8000
  if (raw.length > max) return { ok: true, clean: raw.slice(0, max), truncated: true }
  return { ok: true, clean: raw }
}
function writeGateRefusalTextPre(tool, gate) { return tool + ': 写闸门拒绝(' + gate.reason + ')' }
function tailHas(existing, incoming) {
  if (!existing || !incoming) return false
  const first = String(incoming).trim().split('\n')[0].trim().slice(0, 60)
  if (!first) return false
  const tail = String(existing).trim().split('\n').slice(-60)
  return tail.some(l => l.indexOf(first) !== -1)
}
function nowHm() { const d = new Date(); const pad = n => n < 10 ? '0' + n : '' + n; return pad(d.getHours()) + ':' + pad(d.getMinutes()) }

const factory = new Function(
  'defineTool', 'engine', 'path', 'DATE_RE', 'sanitizeForWrite', 'writeGateRefusalTextPre', 'tailHas', 'nowHm',
  'LOG_KINDS_PRE_V1', 'createHash', 'recordDiagnosticErrorPre',
  'eventStorePathOfPre', 'readEventStorePre', 'resolveActiveEventPre', 'createEventForWorkPre',
  'appendCheckpointPre', 'renderDayViewPre', 'deriveDayViewToDiskPre',
  'return (' + callSrc + ')'
)
const defineToolStub = (name, desc, params, execute) => ({ name, desc, params, execute })
const tool = factory(defineToolStub, engine, path, deps.DATE_RE, sanitizeForWrite, writeGateRefusalTextPre, tailHas, nowHm,
  deps.LOG_KINDS_PRE_V1, createHash, deps.recordDiagnosticErrorPre,
  deps.eventStorePathOfPre, deps.readEventStorePre, deps.resolveActiveEventPre, deps.createEventForWorkPre,
  deps.appendCheckpointPre, deps.renderDayViewPre, deps.deriveDayViewToDiskPre)
ok(!!tool && tool.name === 'memory_log', '求值得到 memory_log 工具')

const exec = { agent: { session: { id: 'sess_t1', header: { cwd: PROJ } } } }
const storePath = path.join(PROJ, 'handoff', 'event-store.json')

// ── 正路径 1：首次调用 ──
const note1 = '真调验证 A：事件写入与日视图派生'
const r1 = await tool.execute({ note: note1, kind: 'fact' }, exec)
ok(String(r1).includes('已更新记忆文档'), '真调成功', String(r1).slice(0, 100))
ok(fs.existsSync(storePath), '★event-store.json 已创建')
const s1 = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(s1.events.length === 1, '自动建 1 个事件', 'events=' + s1.events.length)
ok(s1.events[0].status === 'active', '事件 active')
ok(s1.events[0].checkpoints.length === 1, '★检查点 = 1', 'ck=' + s1.events[0].checkpoints.length)
ok(s1.events[0].checkpoints[0].kind === 'log', 'kind=log')
ok(s1.events[0].checkpoints[0].text.includes(note1), 'text 含 note')
ok(!!s1.events[0].checkpoints[0].idemKey, '带 idemKey')
ok(s1.events[0].checkpoints[0].panels.length === 1, '带 1 panel')

const today = engine.memToday()
const logPath = path.join(PROJ, today + '.md')
ok(fs.existsSync(logPath), '★日视图 .md 已创建', logPath)
const lt1 = fs.readFileSync(logPath, 'utf8')
const cl1 = lt1.split('\n').filter(l => l.trim().startsWith('- '))
ok(cl1.length === 1, '★日视图内容行 = 1', 'lines=' + cl1.length)
ok(lt1.includes(note1), '日视图含 note')
ok((lt1.match(/<!-- memory:mem_/g) || []).length === 1, '日视图保留 1 条锚点（未被破坏）')

// ── ★Lead 断言 3：state.logText 不含锚点 ──
ok(String(state.logText).length > 0, 'state.logText 非空', 'len=' + String(state.logText).length)
ok(!String(state.logText).includes('<!-- memory:mem_'), '★★Lead 断言3：state.logText 不含 <!-- memory:mem_', 'has=' + String(state.logText).includes('<!-- memory:mem_'))
ok(String(state.logText).includes(note1), 'state.logText 含 note')
ok(!String(state.logText).includes('<!--'), 'state.logText 完全无 HTML 注释')

// ── ★Lead 断言 4：再调一次 → 检查点 +1 且 .md 行 +1 ──
const note2 = '真调验证 B：第二次写入'
const r2 = await tool.execute({ note: note2, kind: 'fact' }, exec)
const s2 = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(s2.events[0].checkpoints.length === 2, '★Lead 断言4a：检查点 1 → 2', 'ck=' + s2.events[0].checkpoints.length)
const cl2 = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim().startsWith('- '))
ok(cl2.length === 2, '★Lead 断言4b：日视图行 1 → 2', 'lines=' + cl2.length)
ok(cl2[0].includes(note1) && cl2[1].includes(note2), '两行内容正确且有序')
ok((fs.readFileSync(logPath, 'utf8').match(/<!-- memory:mem_/g) || []).length === 2, '锚点累计 2 条')

// ── 幂等：同分钟同内容重调 ──
const r3 = await tool.execute({ note: note2, kind: 'fact' }, exec)
const s3 = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(s3.events[0].checkpoints.length === 2, '★幂等：重复调用不加检查点', 'ck=' + s3.events[0].checkpoints.length)
const cl3 = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim().startsWith('- '))
ok(cl3.length === 2, '★幂等：日视图不重复加行', 'lines=' + cl3.length)

// ── ★Lead 断言 5：负路径 —— appendText 抛错 ⇒ 不静默成功 ──
const origAppend = engine.appendText
engine.appendText = async () => { throw new Error('模拟 appendText 失败') }
const note3 = '真调验证 C：派生应失败'
const r4 = await tool.execute({ note: note3, kind: 'fact' }, exec)
engine.appendText = origAppend
const r4s = String(r4)
ok(r4s.includes('日视图写入失败') || r4s.includes('⚠'), '★★Lead 断言5：派生失败返回 ⚠ 警告（不静默成功）', r4s.slice(0, 180))
ok(r4s.includes('事件已记录'), '警告明确指出事件已记录（半完成状态）', r4s.includes('事件已记录') ? 'yes' : 'no')
const s4 = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(s4.events[0].checkpoints.length === 3, '★派生失败但事件已写入（不丢数据）', 'ck=' + s4.events[0].checkpoints.length)

// ── 负路径：事件 store 损坏 ⇒ 必须报错，不得 fallback 写 .md ──
fs.writeFileSync(storePath, '{ this is not json', 'utf8')
const beforeLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
const r5 = await tool.execute({ note: '真调验证 D：store 损坏', kind: 'fact' }, exec)
const r5s = String(r5)
ok(r5s.includes('事件写入失败'), '★负路径：store 损坏 → 报「事件写入失败」（不 fallback）', r5s.slice(0, 140))
ok(r5s.includes('未降级只写'), '负路径文案明确声明未降级', r5s.includes('未降级只写') ? 'yes' : 'no')
const afterLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
ok(beforeLog === afterLog, '★负路径：.md 未被追加（真没 fallback）', beforeLog === afterLog ? 'unchanged' : 'CHANGED')

console.log('')
console.log('TOTAL ' + (pass + fail) + '  PASS ' + pass + '  FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)