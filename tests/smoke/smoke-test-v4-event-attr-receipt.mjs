#!/usr/bin/env node
/**
 * smoke-test-v4-event-attr-receipt.mjs —— 批次 1B（1.4 / 1.5 / 1.6）永久验收
 *
 * 被测面（全部真执行；禁止「源码含某字符串」当功能证据，静态断言一律标注「守卫」）：
 *   1.4  归属判据：L1 高基数标识层 → 强负证据（标识冲突）→ #543 的 0.34 词袋兜底层
 *        + L2 语义候选（**只排序不判定**）+ dryRun 写前预检 + 回执三态（已挂/已新建/未自动归属）
 *   1.5  新建事件名 40 → 80（两处：memory_log 内联 + event-write 模块；契约仍 80）
 *   1.6  注入面 evt id（T2 卡头 +14 字符；目录行 opt-in 由生产调用点传 withId:true）
 *
 * 装置：与 smoke-test-v4-h1b-memory-log 同源的**抽取式夹具** —— 括号配平抽出
 *   defineTool('memory_log') 后用 new Function 求值（产线同一份代码），真调 tool.execute；
 *   事件存储用真 lib/event-write.js。全部在仓库内 .tmp-smoke-run/ 临时目录跑。
 *
 * 变异纪律：变异只发生在**已读入内存的抽取源码字符串**上（不写工作区文件），
 *   每条变异先断言锚串恰命中 1 次，再对比「原型 vs 变异体」的行为差异 ⇒ CAUGHT/MISSED。
 *   失败即说明判据没有区分力，属真实缺陷。
 *
 * 来源：2026-11-09 批次 1B 落地同批升格（用户裁定 C 形态：铭文主路径 + dryRun + 写后回执）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('FAIL ' + n + (d ? '  =>  ' + d : '')) } }

const SANDBOX = path.join(REPO, '.tmp-smoke-run/attr1b')
const PROJ = path.join(SANDBOX, 'proj')
const HANDOFF = path.join(PROJ, 'handoff')
const storePath = path.join(HANDOFF, 'event-store.json')

// ── 真 import 依赖模块（与产线同一份）──
const EW = await import(pathToFileURL(path.join(REPO, 'lib/event-write.js')).href)
const ER = await import(pathToFileURL(path.join(REPO, 'lib/event-render.js')).href)

// ── 抽取 memory_log 定义（括号配平；源码先归一成 LF，避免 CRLF 锚点恒不命中）──
const IDX = fs.readFileSync(path.join(REPO, 'lib/index.js'), 'utf8').split('\r\n').join('\n')
const START = IDX.indexOf("defineTool('memory_log'")
ok(START > 0, '[抽取] 找到 defineTool(memory_log) 定义')
let _i = IDX.indexOf('(', START), _depth = 0, END = -1
for (; _i < IDX.length; _i++) {
  const ch = IDX[_i]
  if (ch === '(') _depth++
  else if (ch === ')') { _depth--; if (_depth === 0) { END = _i + 1; break } }
}
const callSrc = IDX.slice(START, END)
ok(callSrc.length > 20000, '[抽取] 抽到含 1.4 主体的工具定义', callSrc.length + ' 字符')
ok(callSrc.includes('_attrVecCache'), '[抽取] 含 L2 语义候选块')
ok(callSrc.includes('dryRun'), '[抽取] 含 dryRun 预检')
ok(callSrc.includes('slice(0, 80)'), '[抽取] 含 1.5 的 80 字截断')

// ── 最小 engine（只实现被调用的方法；语义引擎默认不挂载 ⇒ 降级路径可达）──
const engState = { logText: '', logPath: '', loadedAt: 0 }
const engine = {
  state: engState,
  config: { dayBoundaryMinutes: 450 },
  memToday() {
    const b = 450
    const d = new Date()
    if (d.getHours() * 60 + d.getMinutes() < b) d.setDate(d.getDate() - 1)
    const pad = n => n < 10 ? '0' + n : '' + n
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  },
  async resolvePaths() { return { projectDir: PROJ, handoffDir: HANDOFF } },
  async readTextSafe(p) { try { return fs.readFileSync(p, 'utf8') } catch (_) { return '' } },
  async appendText(p, text) {
    const fakeId = 'mem_' + Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32)
    fs.appendFileSync(p, '<!-- memory:' + fakeId + ' -->\n\n' + text + '\n', 'utf8')
    return fs.readFileSync(p, 'utf8')
  },
  _degradeSink: null,
}

// ── 依赖（产线同源）──
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
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const LOG_KINDS = ['rule', 'preference', 'fact', 'todo']

const stub = (name, desc, params, execute) => ({ name, desc, params, execute })
function buildTool(src) {
  const factory = new Function(
    'defineTool', 'engine', 'path', 'DATE_RE', 'sanitizeForWrite', 'writeGateRefusalTextPre', 'tailHas', 'nowHm',
    'LOG_KINDS_PRE_V1', 'createHash', 'recordDiagnosticErrorPre',
    'eventStorePathOfPre', 'readEventStorePre', 'resolveActiveEventPre', 'createEventForWorkPre',
    'appendCheckpointPre', 'renderDayViewPre', 'deriveDayViewToDiskPre',
    'return (' + src + ')'
  )
  return factory(stub, engine, path, DATE_RE, sanitizeForWrite, writeGateRefusalTextPre, tailHas, nowHm,
    LOG_KINDS, createHash, () => {},
    EW.eventStorePathOfPre, EW.readEventStorePre, EW.resolveActiveEventPre, EW.createEventForWorkPre,
    EW.appendCheckpointPre, EW.renderDayViewPre, EW.deriveDayViewToDiskPre)
}
const tool = buildTool(callSrc)
ok(tool && tool.name === 'memory_log', '[抽取] 求值得到 memory_log 工具')

// ── 参数表（1.4 新增 dryRun 是**参数**不是工具 ⇒ 工具数不变）──
ok(tool.params && tool.params.dryRun && tool.params.dryRun.type === 'boolean', 'S1 参数表暴露 dryRun（boolean）')
ok(/已知归属就必须传/.test(String((tool.params.eventId || {}).description || '')), 'S2 eventId 描述写明「已知归属就必须传」（主路径）')

// ── 项目夹具 ──
const exec = { agent: { session: { id: 'sess_attr', header: { cwd: PROJ } } } }
function resetProject() {
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  fs.mkdirSync(HANDOFF, { recursive: true })
  engState.logText = ''; engState.logPath = ''; engState.loadedAt = 0
  delete engine._jsSemantic
  delete engine._attrVecCache
}
function readStore() { return JSON.parse(fs.readFileSync(storePath, 'utf8')) }
function writeStore(st) { fs.writeFileSync(storePath, JSON.stringify(st, null, 2)) }
async function seed(specs) {
  resetProject()
  for (const sp of specs) await EW.createEventForWorkPre(storePath, { today: engine.memToday(), dayBoundaryMinutes: 450, name: sp.name })
  if (!specs.length) { if (!fs.existsSync(storePath)) return { events: [] }; return readStore() }
  const st = readStore()
  specs.forEach((sp, i) => {
    const ev = st.events[i]
    ev.updatedAt = Number(sp.updatedAt == null ? 100 + i : sp.updatedAt)
    if (sp.summary != null) ev.summary = sp.summary
    if (sp.status) ev.status = sp.status
  })
  writeStore(st)
  return st
}
async function runLog(note, extra) {
  const r = String(await tool.execute(Object.assign({ note, kind: 'fact' }, extra || {}), exec))
  return { r, st: fs.existsSync(storePath) ? readStore() : { events: [] } }
}
const idOf = (st, name) => { const ev = st.events.find(e => e.name === name); return ev && ev.id }

// ══════════════════════════════════════════════════════════════════════
console.log('\n══ A · L1 标识命中 ⇒ 自动 attach（不新建）══')
{
  const st0 = await seed([{ name: '#543 修复' }])
  const idX = idOf(st0, '#543 修复')
  const ck0 = st0.events[0].checkpoints.length
  const { r, st } = await runLog('修复 #543 的遗留问题')
  ok(st.events.length === 1, 'A1 事件数不变（未新建）', 'events=' + st.events.length)
  ok(st.events.find(e => e.id === idX).checkpoints.length === ck0 + 1, 'A2 目标事件检查点 +1')
  ok(r.indexOf(idX) >= 0, 'A3 回执含目标 evt id', r.split('\n').find(l => l.indexOf('归属') >= 0).slice(0, 90))
  ok(/标识匹配/.test(r), 'A4 回执说明「按标识匹配」自动挂载')
  ok(/eventId/.test(r), 'A5 回执给出纠正路径（带 eventId 重调）')
  const twin = EW.pickActiveEventByTopicPre(st0, '修复 #543 的遗留问题')
  ok(!!twin && twin.id === idX, 'A6 ★模块孪生同判（内联 vs event-write 不分叉）', twin && twin.id)
}

console.log('\n══ B · 标识冲突（有标识但零交集）⇒ 强负证据新建 ══')
{
  const st0 = await seed([{ name: '#543 修复' }])
  const { r, st } = await runLog('处理 #544 的问题')
  ok(st.events.length === 2, 'B1 事件数 +1（明确新建）', 'events=' + st.events.length)
  ok(/未自动归属/.test(r) && /自动新建/.test(r), 'B2 回执三态之「未自动归属 + 已新建」')
  ok(/请带 eventId 重新调用/.test(r), 'B3 回执给出「带 eventId 重新调用」纠正路径')
  ok(/语义引擎未接入/.test(r), 'B4 语义不可用 ⇒ 回执注明降级（不阻塞写入）')
  const twin = EW.pickActiveEventByTopicPre(st0, '处理 #544 的问题')
  ok(twin === null, 'B5 ★模块孪生同判（返回 null = 新建）', JSON.stringify(twin))
}

console.log('\n══ C · 无标识但词袋重合 ⇒ 兜底 attach（#543 判据逐字节保留）══')
{
  const st0 = await seed([{ name: '记忆系统大修施工总表' }])
  const idX = idOf(st0, '记忆系统大修施工总表')
  const { r, st } = await runLog('记忆系统大修施工总表 更新')
  ok(st.events.length === 1, 'C1 事件数不变（词袋兜底挂上）', 'events=' + st.events.length)
  ok(/词袋兜底/.test(r), 'C2 回执说明走的是词袋兜底层（弱证据）')
  const twin = EW.pickActiveEventByTopicPre(st0, '记忆系统大修施工总表 更新')
  ok(!!twin && twin.id === idX, 'C3 ★模块孪生同判')
}

console.log('\n══ D · 无标识且词袋不匹配 ⇒ 新建（#543 行为不回退）══')
{
  await seed([{ name: '记忆系统大修施工总表' }])
  const { st } = await runLog('今天天气不错，去公园散步')
  ok(st.events.length === 2, 'D1 事件数 +1（不吸附到无关 active 事件）', 'events=' + st.events.length)
  const st0 = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  ok(EW.pickActiveEventByTopicPre({ events: st0.events.slice(0, 1) }, '今天天气不错，去公园散步') === null, 'D2 ★模块孪生同判（null）')
}

console.log('\n══ E · 多个 active 事件 ⇒ 按标识定位，而不是「最近更新」══')
{
  const st0 = await seed([{ name: 'task-38 收尾', updatedAt: 100 }, { name: '#557 取证', updatedAt: 999 }])
  const idX = idOf(st0, 'task-38 收尾')
  const idY = idOf(st0, '#557 取证')
  const { st } = await runLog('task-38 的收尾')
  ok(st.events.length === 2, 'E1 两侧事件都还在（未新建）')
  const x = st.events.find(e => e.id === idX), y = st.events.find(e => e.id === idY)
  ok(x.checkpoints.length === 1 && y.checkpoints.length === 0, 'E2 挂到 task-38 事件（不是 updatedAt 更新的 #557）',
    'task38 ck=' + x.checkpoints.length + ' / 557 ck=' + y.checkpoints.length)
  const twin = EW.pickActiveEventByTopicPre(st0, 'task-38 的收尾')
  ok(!!twin && twin.id === idX, 'E3 ★模块孪生同判（多事件取标识命中者）')
}

console.log('\n══ F · 日期串不得被当成 commit sha（纯数字不算标识）══')
{
  const st0 = await seed([{ name: '#999 的记录' }])
  const idX = idOf(st0, '#999 的记录')
  const { st } = await runLog('20261108 的记录')
  ok(st.events.length === 1 && st.events[0].id === idX, 'F1 走词袋兜底挂到 #999（未被日期误判成新事）')
  ok(EW.pickActiveEventByTopicPre(st0, '20261108 的记录') !== null, 'F2 ★模块孪生同判（非 null）')
}

console.log('\n══ G · dryRun 写前预检：零副作用 ══')
{
  const st0 = await seed([{ name: '#543 修复' }])
  const idX = idOf(st0, '#543 修复')
  const bytes0 = fs.readFileSync(storePath, 'utf8')
  const logPath = path.join(PROJ, engine.memToday() + '.md')
  const hadMd = fs.existsSync(logPath)
  const r = String(await tool.execute({ note: '修复 #543 的另一个问题', kind: 'fact', dryRun: true }, exec))
  const bytes1 = fs.readFileSync(storePath, 'utf8')
  ok(/\[dryRun\]/.test(r) && /未写入/.test(r), 'G1 回执明确标注 dryRun / 未写入')
  ok(bytes1 === bytes0, 'G2 ★event-store 逐字节不变（零副作用）', bytes0.length + 'B')
  ok(fs.existsSync(logPath) === hadMd && !fs.existsSync(logPath), 'G3 未创建/未改动日视图 .md')
  ok(r.indexOf('将挂到') >= 0 && r.indexOf(idX) >= 0, 'G4 预判断言「将挂到 X」', r.split('\n').slice(1, 2).join('').slice(0, 100))
  ok(JSON.parse(bytes1).events[0].checkpoints.length === st0.events[0].checkpoints.length, 'G5 检查点数不变')
}

console.log('\n══ H · dryRun 在空库 ⇒ 预告新建，仍零写入 ══')
{
  resetProject()
  const existed = fs.existsSync(storePath)
  const r = String(await tool.execute({ note: '一件全新的事 xyzzy-dry-1', kind: 'fact', dryRun: true }, exec))
  ok(!existed && !fs.existsSync(storePath), 'H1 不创建 event-store 文件')
  ok(/将\*\*新建\*\*/.test(r) || /将新建/.test(r), 'H2 预判「将新建」', r.split('\n').slice(1, 2).join('').slice(0, 100))
  ok(!fs.existsSync(path.join(PROJ, engine.memToday() + '.md')), 'H3 不创建日视图')
}

console.log('\n══ I · 回执三态 + 显式 eventId 不再误报「未传」 ══')
{
  const st0 = await seed([{ name: '#543 修复' }])
  const idX = idOf(st0, '#543 修复')
  const { r } = await runLog('修复 #543 的显式归属问题', { eventId: idX })
  ok(/归属: 已按你显式指定的 eventId 写入/.test(r), 'I1 显式 eventId ⇒ 回执如实说「按你指定的」', r.split('\n').find(l => l.indexOf('归属') >= 0).slice(0, 80))
  ok(!/未传 eventId/.test(r), 'I2 ★不再误报「未传 eventId」（旧实现把显式分支记成 attached 的死代码缺陷，已修）')
}

console.log('\n══ J · L2 语义候选：只排序不判定 + 增量缓存 + 降级 ══')
{
  const st0 = await seed([{ name: '事件甲' }, { name: '事件乙' }, { name: '事件丙' }])
  const idA = idOf(st0, '事件甲'), idB = idOf(st0, '事件乙'), idC = idOf(st0, '事件丙')
  let q = 0, p = 0
  engine._jsSemantic = {
    status() { return { ready: true, disposed: false, degraded: false } },
    async embedQuery() { q++; return [1, 0, 0] },
    async embedPassages(texts) {
      p++
      return texts.map((t) => t.indexOf('甲') >= 0 ? [1, 0, 0] : (t.indexOf('乙') >= 0 ? [0.8, 0.6, 0] : [0, 1, 0]))
    },
  }
  const note1 = '量子计算与超导材料研究进展 xyz-attr'
  const r1 = String(await tool.execute({ note: note1, kind: 'fact', dryRun: true }, exec))
  ok(/候选\(L2/.test(r1), 'J1 语义可用 ⇒ 回执含 L2 候选行')
  ok(r1.indexOf(idA) >= 0 && r1.indexOf(idB) >= 0 && r1.indexOf(idC) >= 0, 'J2 候选覆盖全部 active 事件（top-3）')
  ok(r1.indexOf(idA) < r1.indexOf(idB) && r1.indexOf(idB) < r1.indexOf(idC), 'J3 ★排序按余弦（甲 1.0 > 乙 0.8 > 丙 0.0）')
  ok(p === 1, 'J4 首次只批量嵌入一次（embedPassages=1）', 'p=' + p)
  const r2 = String(await tool.execute({ note: note1 + '续', kind: 'fact', dryRun: true }, exec))
  ok(p === 1 && q === 2, 'J5 ★事件未变 ⇒ 第二轮零重复嵌入（只算 query）', 'p=' + p + ' q=' + q)
  ok(/将\*\*新建\*\*/.test(r2) || /将新建/.test(r2), 'J6 ★语义只做提示：预判仍是「新建」（语义不参与判定）')
  const { st } = await runLog(note1)
  ok(st.events.length === 4, 'J7 ★真写入时语义不自动挂载（事件数 3→4，仍新建）', 'events=' + st.events.length)
  delete engine._jsSemantic
  const { r: r3 } = await runLog('另一件全新的独立事项 zzz-attr')
  ok(/语义引擎未接入/.test(r3), 'J8 ★负路径：语义不可用 ⇒ 回执注明降级，写入照常成功')
}

console.log('\n══ K · 变异（隔离在内存抽取源码上；锚串必须恰命中 1 次）══')
function mutate(src, from, to) {
  const n = src.split(from).length - 1
  if (n !== 1) throw new Error('变异锚串命中 ' + n + ' 次（应为 1）: ' + from.slice(0, 60))
  return src.replace(from, () => to)
}
{ // K1：删掉 L1 命中分支 ⇒ A 场景必红
  const mut = buildTool(mutate(callSrc, 'if (_hits.length) {', 'if (false) {'))
  const st0 = await seed([{ name: '#543 修复' }])
  const r = String(await mut.execute({ note: '修复 #543 的遗留问题', kind: 'fact' }, exec))
  const st = readStore()
  ok(st.events.length === 2, 'K1 CAUGHT：删掉标识匹配 ⇒ 不再自动挂载（退回新建）', 'events=' + st.events.length + ' / 原型=1')
}
{ // K2：把「标识冲突 ⇒ 新建」改成 attach ⇒ B 场景必红
  const mut = buildTool(mutate(callSrc,
    "if (_tagged.length) return { decision: 'create', reason: 'identifier-conflict', event: null, hits: [], ids: [..._logIds] }",
    "if (_tagged.length) return { decision: 'attach', reason: 'identifier', event: _latest, hits: [], ids: [..._logIds] }"))
  await seed([{ name: '#543 修复' }])
  const r = String(await mut.execute({ note: '处理 #544 的问题', kind: 'fact' }, exec))
  const st = readStore()
  ok(st.events.length === 1, 'K2 CAUGHT：标识冲突不再新建 ⇒ 误并入无关事件', 'events=' + st.events.length + ' / 原型=2')
}
{ // K3：关掉 dryRun 闸门 ⇒ 预检变成真写
  const mut = buildTool(mutate(callSrc, 'if (args.dryRun === true) {', 'if (false && args.dryRun === true) {'))
  await seed([{ name: '#543 修复' }])
  const before = fs.readFileSync(storePath, 'utf8')
  await mut.execute({ note: '修复 #543 的 dryRun 变异体', kind: 'fact', dryRun: true }, exec)
  const after = fs.readFileSync(storePath, 'utf8')
  ok(before !== after, 'K3 CAUGHT：dryRun 闸门失效 ⇒ 预检竟写入事件库')
}
{ // K4：事件名 80 → 40 回退
  const mut = buildTool(mutate(callSrc, 'name: (gate.clean || note).trim().slice(0, 80),', 'name: (gate.clean || note).trim().slice(0, 40),'))
  const note60 = '六'.repeat(60)
  resetProject()
  const rBase = String(await tool.execute({ note: note60, kind: 'fact' }, exec))
  const baseName = readStore().events[0].name
  resetProject()
  const rMut = String(await mut.execute({ note: note60 + 'x', kind: 'fact' }, exec))
  const mutName = readStore().events[0].name
  ok(baseName.length === 60 && mutName.length === 40, 'K4 CAUGHT：1.5 回退到 40 ⇒ 60 字名被截断', '原型=' + baseName.length + ' / 变异=' + mutName.length)
}
{ // K5：显式 eventId 回执回到旧形态（记成 attached）
  const mut = buildTool(mutate(callSrc, "_ownDecision = _wantEv ? 'explicit' : 'attached'", "_ownDecision = 'attached'"))
  const st0 = await seed([{ name: '#543 修复' }])
  const idX = idOf(st0, '#543 修复')
  const r = String(await mut.execute({ note: '修复 #543 的显式回执变异', kind: 'fact', eventId: idX }, exec))
  ok(/未传 eventId/.test(r), 'K5 CAUGHT：显式分支回退 ⇒ 回执误报「未传 eventId」', r.split('\n').find(l => l.indexOf('归属') >= 0).slice(0, 70))
}
{ // K6：sha 正则放宽成纯数字（日期被当 commit）
  const mut = buildTool(mutate(callSrc, 'if (!/[0-9]/.test(_w) || !/[a-f]/.test(_w)) continue', 'if (!/[0-9]/.test(_w)) continue'))
  const st0 = await seed([{ name: '#999 的记录' }])
  const idX = idOf(st0, '#999 的记录')
  await mut.execute({ note: '20261108 的记录', kind: 'fact' }, exec)
  const st = readStore()
  const x = st.events.find(e => e.id === idX)
  ok(st.events.length === 2 && x.checkpoints.length === 0, 'K6 CAUGHT：纯数字被当标识 ⇒ 日期日志误判成「另一件事」新建', 'events=' + st.events.length)
}

console.log('\n══ L · 1.6 注入面 evt id（真调渲染）══')
{
  const mkEv = (id) => ({ id, name: '事件甲', status: 'active', updatedAt: 1, summary: '摘要', sections: { goal: 'g', doing: 's', deadend: '', next: 'n' }, checkpoints: [{ kind: 'log', text: 'ck' }] })
  const t2No = ER.renderT2Pre(mkEv(undefined))
  const t2Id = ER.renderT2Pre(mkEv('evt_aaaaaaaa'))
  ok(t2Id.indexOf('#evt_aaaaaaaa') >= 0, 'L1 T2 卡头含 evt id', t2Id.split('\n')[0])
  ok(t2Id.length - t2No.length === 14, 'L2 ★T2 字符增量恰好 +14', String(t2Id.length - t2No.length))
  ok(ER.renderT2Pre(mkEv('ABC')) === t2No && ER.renderT2Pre(mkEv('evt_AAAAAAAA')) === t2No && ER.renderT2Pre(mkEv('evt_123')) === t2No,
    'L3 ★负路径：非法/大写/短 id ⇒ 输出与旧基线逐字节相同（不输出伪 id）')
  const catNo = ER.renderEventCatalogPre([mkEv('evt_aaaaaaaa')], { maxChars: 400 })
  const catId = ER.renderEventCatalogPre([mkEv('evt_aaaaaaaa')], { maxChars: 400, withId: true })
  ok(catNo.text.indexOf('evt_') < 0, 'L4 ★负路径：目录默认不输出 id（既有契约不变）')
  ok(catId.text.indexOf('#evt_aaaaaaaa') >= 0, 'L5 目录 withId:true ⇒ 行含 id（生产侧显式开启）')
  ok(ER.RENDER_LIMITS.T2 === 2400 && ER.EVENT_CATALOG_MAX_CHARS === 400, 'L6 预算常量未改（2,400 / 400）')
  ok(ER.renderT2Pre({ id: 'evt_aaaaaaaa', name: '超长', status: 'active', sections: { goal: 'g'.repeat(3000), doing: '', deadend: '', next: '' }, checkpoints: [] }).length <= 2400,
    'L7 T2 超长仍 ≤2,400（id 不击穿总限）')
  // 生产调用点守卫（守卫，非功能证据）：漏传 withId 即静默无 id，故必须钉住这一行
  ok(/renderEventCatalogPre\(events, \{[\s\S]{0,500}withId: true,/.test(IDX), 'L8 [守卫] 生产注入点显式传 withId: true（非功能证据）')
}

console.log('\n══ M · 1.5 新建事件名 40→80（模块级 + 关联契约）══')
{
  resetProject()
  const n60 = '六十'.repeat(30)
  const c1 = await EW.createEventForWorkPre(storePath, { today: engine.memToday(), dayBoundaryMinutes: 450, name: n60 })
  ok(c1.event.name.length === 60 && c1.event.name.indexOf('…') < 0, 'M1 60 字完整不截断', String(c1.event.name.length))
  const c2 = await EW.createEventForWorkPre(storePath, { today: engine.memToday(), dayBoundaryMinutes: 450, name: '长'.repeat(81) })
  ok(c2.event.name.length === 80 && c2.event.name.slice(-1) === '…', 'M2 81 字 ⇒ 80 + 省略号（契约 80 不变）', c2.event.name.length)
  const c3 = await EW.createEventForWorkPre(storePath, { today: engine.memToday(), dayBoundaryMinutes: 450, name: '短名' })
  ok(c3.event.name === '短名', 'M3 负路径：短名逐字节不变')
}

console.log('\n══ N · evt id 自指（真实会话接驳验证抓到的 P1 缺陷）══')
{
  // 缺陷复现条件：日志正文写「… evt_xxxxxxxx …」，而该 id 指向的事件自身 name/summary 里
  // 当然不含自己的 id ⇒ L1 求交必然零交集；若库里有其它带标识的 active 事件，
  // 「强负证据」分支就会把它误判成「标识冲突 ⇒ 新建」。
  // 修法：evt: 型标识不参与 name∪summary 求交，改为**按 id 直查**；不存在的 id 不算负证据。
  resetProject()
  const a = await EW.createEventForWorkPre(storePath, { today: engine.memToday(), dayBoundaryMinutes: 450, name: '甲事件' })
  const b = await EW.createEventForWorkPre(storePath, { today: engine.memToday(), dayBoundaryMinutes: 450, name: '乙事件 issue #777' })
  const st1 = await EW.readEventStorePre(storePath)
  // N1 正路径：正文引用 a 的 id ⇒ 必须挂到 a（修复前会判 create）
  const p1 = EW.pickActiveEventByTopicPre(st1, '这条日志属于 ' + a.id + '，继续处理')
  ok(!!p1 && p1.id === a.id, 'N1 正文写 evt id ⇒ 按 id 直挂该事件（不是判标识冲突）', p1 && p1 .id)
  // N2 负路径：不存在的 evt id ⇒ 不得升级成「标识冲突」，应落到词袋/新建
  const p2 = EW.pickActiveEventByTopicPre(st1, '这条提到一个不存在的 ' + 'evt_deadbeef' + '，应降级')
  ok(!p2 || p2.id !== a.id, 'N2 不存在的 evt id ⇒ 不当作负证据、不误挂', p2 && p2.id)
  // N3 标识层不被破坏：issue 编号仍按 name/summary 求交（b 的名字里有 #777）
  const p3 = EW.pickActiveEventByTopicPre(st1, '关于 issue #777 的进展')
  ok(!!p3 && p3.id === b.id, 'N3 issue 标识路径未被改动（回归对照）', p3 && p3.id)
  // N4 对照：显式 id 与正文 id 应落到同一事件（两条路径同源）
  const viaText = EW.pickActiveEventByTopicPre(st1, '见 ' + a.id)
  ok(!!viaText && viaText.id === a.id, 'N4 正文 id 与显式 eventId 同源（都指向 a）', viaText && viaText.id)
}

console.log('')
console.log('TOTAL ' + (pass + fail) + '  PASS ' + pass + '  FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
