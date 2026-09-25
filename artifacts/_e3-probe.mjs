/**
 * E3 轮换门行为探针 —— 抽**真源码**函数体真跑（临时 DSH_HOME 隔离，真实 ~/.dsh 零接触）。
 * 覆盖：相位机三态迁移、族静止主判据（含 E0/M3 修正的空 catalog / 全幽灵 / 有活条目三种语义）、
 *       超时纯防御（不切换）、sealing 重试节流、同意门（只弹一次）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const SRC = path.join(process.cwd(), 'lib', 'index.js')
const src = fs.readFileSync(SRC, 'utf8')

let P = 0, F = 0
const ok = (n, c, extra) => { if (c) { P++; console.log('  ✓ ' + n + (extra ? '  — ' + extra : '')) } else { F++; console.log('  ✗ ' + n + (extra ? '  — ' + extra : '')) } }

/* ---------- 从真源码按「正面锚点 + 花括号配平」抽函数全文 ---------- */
function extractFn(anchor) {
  const i = src.indexOf(anchor)
  if (i < 0) throw new Error('锚点未命中: ' + anchor)
  const braceStart = src.indexOf('{', i)
  let depth = 0, j = braceStart
  for (; j < src.length; j++) {
    const c = src[j]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { j++; break } }
  }
  return src.slice(i, j)
}
function extractConst(name) {
  const m = src.match(new RegExp('^const ' + name + ' = [^\\n]+$', 'm'))
  if (!m) throw new Error('常量未命中: ' + name)
  // ★CRLF 坑：`[^\n]+` 会吃掉行尾的 \r ⇒ 必须 trim，否则常量比较恒假红
  return m[0].replace(/\r$/, '')
}

const fnSetPhase = extractFn('  async _wbSetPhase(phase, extra) {')
const fnCatalog = extractFn('  async _wbCatalogChildIds(sid) {')
const fnMtimes = extractFn('  async _wbChildMtimes(ids) {')
const fnQuiet = extractFn('  async _wbFamilyQuiet(nowMs) {')
const fnTick = extractFn('  async _wbRotateTick() {')
const cQuiet = extractConst('WB_QUIET_MS')
const cSeal = extractConst('WB_SEAL_TIMEOUT_MS')
const cRetry = extractConst('WB_SEAL_RETRY_MS')

console.log('【① 相位机：active → draining → sealing → active(新期)】')

/* ---------- 隔离环境 ---------- */
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-e3-'))
const memDir = path.join(tmpHome, 'memory')
fs.mkdirSync(memDir, { recursive: true })
const WB = path.join(memDir, 'workbench.json')

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
function makeHost(extra) {
  const diags = []
  const host = Object.assign({
    _disposed: false,
    _wbRotateBusy: false,
    _subagentInflight: 0,
    config: { workbenchEnabled: true },    _workbenchPeriodDays() { return 2 },
    _workbenchEpoch(nowMs) {
      const d = new Date(Number(nowMs) || Date.now())
      const days = Math.floor(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).getTime() / 86400000)
      return 'B' + String(Math.floor(days / this._workbenchPeriodDays()))
    },
    _workbenchEpochToken(epoch, sessionId) {
      const e = String(epoch || ''), s = String(sessionId || '')
      if (!e || !s) return ''
      return crypto.createHash('sha256').update(e + '|' + s).digest('hex').slice(0, 16)
    },
    _wbStateOf(st) {
      const s = (st && typeof st === 'object') ? st : {}
      const pick = (v) => {
        if (!v) return null
        if (typeof v === 'string') return { sessionId: String(v) }
        const id = v.sessionId || v.id
        return id ? Object.assign({}, v, { sessionId: String(id) }) : null
      }
      const legacy = s.sessionId ? String(s.sessionId) : ''
      const cur = pick(s.current) || (legacy ? { sessionId: legacy, openedAt: s.createdAt || null } : null)
      return {
        epoch: s.epoch ? String(s.epoch) : '', epochToken: s.epochToken ? String(s.epochToken) : '',
        phase: s.phase ? String(s.phase) : 'active', current: cur, previous: pick(s.previous),
        drainStartedAt: Number(s.drainStartedAt) || 0, legacySessionId: legacy,
      }
    },
    async _readWorkbench() { try { const r = fs.readFileSync(WB, 'utf8'); return r ? JSON.parse(r) : null } catch (e) { return null } },
    async _writeWorkbench(st) { fs.writeFileSync(WB, JSON.stringify(st, null, 2), 'utf8') },
    diag(m) { diags.push(String(m)) },
  }, extra || {})
  // 真源码函数挂成方法简写（完整函数文本，避免剥掉 async 关键字）
  // ★常量必须显式注入：函数体被抽出后不在原模块作用域，不注入会抛 ReferenceError 并被 catch 吞掉 ⇒ 污染后续断言
  const built = new Function('diag', 'readFile', 'readdir', 'stat', 'dshHome',
    'WB_QUIET_MS', 'WB_SEAL_TIMEOUT_MS', 'WB_SEAL_RETRY_MS',
    'return {' + [fnSetPhase, fnCatalog, fnMtimes, fnQuiet, fnTick].join(',\n') + '}')
  const methods = built(
    (m) => diags.push(String(m)),
    (p, enc) => fs.promises.readFile(p, enc),
    (p, o) => fs.promises.readdir(p, o),
    (p) => fs.promises.stat(p),
    () => tmpHome,
    2 * 60 * 1000,          // WB_QUIET_MS（与源码同步断言在下方）
    30 * 60 * 1000,         // WB_SEAL_TIMEOUT_MS
    60 * 1000,              // WB_SEAL_RETRY_MS
  )
  Object.assign(host, methods)
  // ★顺序关键：`extra` 必须**最后**应用。上一版先 extra 后 methods，导致
  //   `_wbCatalogChildIds` / `_wbChildMtimes` 等 mock 被真源码方法**覆盖掉**
  //   ⇒ ⑤ 等负路径恒走「空 catalog ⇒ 静止」⇒ **假绿**。
  Object.assign(host, extra || {})
  host._diags = diags
  return host
}

/* 常量也要用真源码的值（把常量注入函数作用域不便，改为断言其字面量正确） */
ok('WB_QUIET_MS 真值 = 2 分钟', cQuiet === 'const WB_QUIET_MS = 2 * 60 * 1000', cQuiet)
ok('WB_SEAL_TIMEOUT_MS 真值 = 30 分钟（纯防御）', cSeal === 'const WB_SEAL_TIMEOUT_MS = 30 * 60 * 1000', cSeal)
ok('WB_SEAL_RETRY_MS 真值 = 60 秒（sealing 节流）', cRetry === 'const WB_SEAL_RETRY_MS = 60 * 1000', cRetry)

const NOW = Date.now()
function seed(state) { fs.writeFileSync(WB, JSON.stringify(state, null, 2), 'utf8') }

/* ---- ① active + 期号过期 ⇒ draining ---- */
{
  const curEpoch = 'B0'
  seed({ version: 2, sessionId: 's-old', epoch: curEpoch, epochToken: 'tok-old', phase: 'active',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null, drainStartedAt: 0, consentGranted: true })
  const h = makeHost({ _workbenchEpoch: () => 'B999' })  // 强制期号已变
  await h._wbRotateTick()
  const st = JSON.parse(fs.readFileSync(WB, 'utf8'))
  ok('① active + 期号过期 ⇒ draining', st.phase === 'draining', 'phase=' + st.phase)
  ok('① 记下 drainStartedAt（超时防御的计时起点）', Number(st.drainStartedAt) > 0, 'drainStartedAt=' + st.drainStartedAt)
}

/* ---- ② draining + 族静止（空 catalog）⇒ sealing ---- */
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'draining',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, consentGranted: true })
  const h = makeHost({ _workbenchEpoch: () => 'B999', _wbCatalogChildIds: async () => [] })
  await h._wbRotateTick()
  const st = JSON.parse(fs.readFileSync(WB, 'utf8'))
  ok('② draining + 族静止 ⇒ sealing', st.phase === 'sealing', 'phase=' + st.phase)
}

/* ---- ③ ★负路径：有子代理在飞 ⇒ 保持 draining，绝不 sealing ---- */
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'draining',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, consentGranted: true })
  const h = makeHost({ _workbenchEpoch: () => 'B999', _subagentInflight: 2 })
  await h._wbRotateTick()
  const st = JSON.parse(fs.readFileSync(WB, 'utf8'))
  ok('③ 负路径：inflight=2 ⇒ 保持 draining（不强切）', st.phase === 'draining', 'phase=' + st.phase)
  // ★不要断言「记了 diag」：本分支**刻意不记** —— 心跳每 15 秒跑一次，非超时分支记 diag 会刷屏。
  //   改为直接断言判据函数的返回值（那才是语义），并顺带验「未超时时不记 diag」这条设计意图。
  const q = await h._wbFamilyQuiet(Date.now())
  ok('③ 判据函数报 quiet=false 且 reason=inflight（语义正确）', q.quiet === false && q.reason === 'inflight', JSON.stringify(q))
  ok('③ 未超时分支**不记 diag**（防每 15 秒刷屏，这是刻意设计）', h._diags.length === 0, 'diags=' + JSON.stringify(h._diags))
}

/* ---- ④ ★负路径：全幽灵（E0/M3 修正）⇒ 视为静止 ⇒ sealing，且记 wb-quiet: ghosts=N ---- */
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'draining',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, consentGranted: true })
  // catalog 有 3 条 childId，但磁盘上一个目录都没有 ⇒ 全幽灵
  const h = makeHost({
    _workbenchEpoch: () => 'B999',
    _wbCatalogChildIds: async () => ['c1', 'c2', 'c3'],
    _wbChildMtimes: async () => new Map(),
  })
  await h._wbRotateTick()
  const st = JSON.parse(fs.readFileSync(WB, 'utf8'))
  ok('④ 全幽灵（原文判据恒真处）⇒ 修正后仍判「静止」', st.phase === 'sealing', 'phase=' + st.phase)
  ok('④ 且按 §9.10 记一行 wb-quiet: ghosts=3（不阻塞）', h._diags.some((d) => /wb-quiet: ghosts=3/.test(d)), h._diags.filter((d) => /wb-quiet/.test(d)).join(''))
}

/* ---- ⑤ ★负路径：有活条目但 mtime 刚更新 ⇒ 未静默 ⇒ 保持 draining ---- */
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'draining',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, consentGranted: true })
  const h = makeHost({
    _workbenchEpoch: () => 'B999',
    _wbCatalogChildIds: async () => ['c1'],
    _wbChildMtimes: async () => new Map([['c1', Date.now()]]),   // 刚刚活动
  })
  await h._wbRotateTick()
  const st = JSON.parse(fs.readFileSync(WB, 'utf8'))
  ok('⑤ 活条目刚活动（未满静默窗）⇒ 保持 draining', st.phase === 'draining', 'phase=' + st.phase)
}

/* ---- ⑥ 有活条目且已静默超过窗口 ⇒ sealing ---- */
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'draining',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 10000, consentGranted: true })
  const h = makeHost({
    _workbenchEpoch: () => 'B999',
    _wbCatalogChildIds: async () => ['c1'],
    _wbChildMtimes: async () => new Map([['c1', Date.now() - 5 * 60 * 1000]]),  // 静默 5 分钟 > 2 分钟
  })
  await h._wbRotateTick()
  const st = JSON.parse(fs.readFileSync(WB, 'utf8'))
  ok('⑥ 活条目静默 5min（> 2min 窗）⇒ sealing', st.phase === 'sealing', 'phase=' + st.phase)
}

/* ---- ⑦ ★超时纯防御：仍在 draining 超 30 分钟 ⇒ 记 diag 但**不切换**（规格 §9.10） ---- */
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'draining',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 31 * 60 * 1000, consentGranted: true })
  const h = makeHost({ _workbenchEpoch: () => 'B999', _subagentInflight: 1 })
  await h._wbRotateTick()
  const st = JSON.parse(fs.readFileSync(WB, 'utf8'))
  ok('⑦ 超时 31min 仍不切换（纯防御，phase 不变）', st.phase === 'draining', 'phase=' + st.phase)
  ok('⑦ 且明确记了 NO forced switch', h._diags.some((d) => /NO forced switch/.test(d)), h._diags.filter((d) => /draining|forced/.test(d)).join('').slice(0, 110))
}

/* ---- ⑧ ★sealing 重试节流：60 秒内重复心跳不得反复触发建新期 ---- */
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'sealing',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, sealTriedAt: NOW - 5000, consentGranted: true })   // 5 秒前试过
  let called = 0
  const h = makeHost({
    _workbenchEpoch: () => 'B999',
    ensureWorkbench: async () => { called++; return { ok: true } },
  })
  await h._wbRotateTick()
  ok('⑧ sealing 距上次尝试仅 5s（< 60s）⇒ 不重试', called === 0, 'ensureWorkbench 调用次数=' + called)
}
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'sealing',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, sealTriedAt: NOW - 70 * 1000, consentGranted: true })  // 70 秒前
  let seen = null
  const h = makeHost({
    _workbenchEpoch: () => 'B999',
    ensureWorkbench: async (o) => { seen = o; return { ok: true, reused: false } },
  })
  await h._wbRotateTick()
  ok('⑧ 超过 60s ⇒ 允许重试', seen !== undefined && seen !== null, 'opts=' + JSON.stringify(seen))
  ok('⑧ ★同意门：consentGranted=true ⇒ 自动带 {consent:true}（只弹一次）', !!(seen && seen.consent === true), JSON.stringify(seen))
}
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'sealing',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, sealTriedAt: NOW - 70 * 1000, consentGranted: false })
  let seen = 'unset'
  const h = makeHost({
    _workbenchEpoch: () => 'B999',
    ensureWorkbench: async (o) => { seen = o; return { ok: false, reason: 'consent', needPrompt: true } },
  })
  await h._wbRotateTick()
  ok('⑧ ★同意门负路径：**显式拒绝**（false）⇒ 不建新期（不同意门被架空）', seen === 'unset', 'opts=' + JSON.stringify(seen))
}
{
  // ★E3-FIX-2②：区分「字段缺失（迁移态）」与「显式 false（用户拒绝）」——缺字段是旧版本建立的工作台
  //   （当年从不弹窗、用户无拒绝机会），必须放行；显式 false 才是真拒绝。两者同判会让门形同虚设。
  seed({ version: 2, sessionId: 's-old', epoch: 'B0', epochToken: 'tok-old', phase: 'sealing',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, sealTriedAt: NOW - 70 * 1000 /* consentGranted 缺失 = 迁移态 */ })
  let seen = null
  const h = makeHost({
    _workbenchEpoch: () => 'B999',
    ensureWorkbench: async (o) => { seen = o; return { ok: true, reused: false } },
  })
  await h._wbRotateTick()
  ok('⑧ ★迁移态：consentGranted 缺失 + 已有 current ⇒ 视为已获批，放行', !!(seen && seen.consent === true), JSON.stringify(seen))
  ok('⑧ E3-FIX-2③：轮换必须带 rotate:true（跳过复用分支，否则永不建新期）', !!(seen && seen.rotate === true), JSON.stringify(seen))
}

/* ---- ⑨ 期号相符 ⇒ 相位复位 active（draining/sealing 是过期态） ---- */
{
  seed({ version: 2, sessionId: 's-old', epoch: 'B7', epochToken: 'tok', phase: 'draining',
    current: { sessionId: 's-old', openedAt: new Date(NOW).toISOString() }, previous: null,
    drainStartedAt: NOW - 1000, consentGranted: true })
  const h = makeHost({ _workbenchEpoch: () => 'B7' })
  await h._wbRotateTick()
  const st = JSON.parse(fs.readFileSync(WB, 'utf8'))
  ok('⑨ 期号相符 + draining ⇒ 复位 active（不留过期相位）', st.phase === 'active' && Number(st.drainStartedAt) === 0,
    'phase=' + st.phase + ' drainStartedAt=' + st.drainStartedAt)
}

/* ---- ⑩ 真源码静态判据 ---- */
console.log('\n【⑩ 真源码静态判据】')
// ★心跳行有 5 处（时间戳/心跳/dispose 兜底），必须用**含四个既有任务的那一行全文**做锚点，
//   否则 `src.includes(...)` 会命中别的行造成假绿/假红。
const HB = src.split('\n').filter((l) => l.includes('void engine._wbRotateTick()'))
ok('⑩ 挂 _wbRotateTick 的心跳行唯一', HB.length === 1, '命中 ' + HB.length + ' 行')
ok('⑩ 该行同时保留 4 个既有任务（未顶掉）',
  HB.length === 1 && ['void writeHeartbeat()', 'engine.tickTime()', 'engine.subagentGcSweep()', 'engine.tickAutoContinue()', 'engine.sessionArchiveSweep()'].every((k) => HB[0].includes(k)),
  HB.length === 1 ? HB[0].trim().slice(0, 130) : 'n/a')
ok('⑩ 仍是 15000ms 心跳', HB.length === 1 && HB[0].includes('}, 15000)'))
// ★花括号配平抽取 _verifyWorkbench 真函数体（无界正则会跨函数误判）
const vwBody = (() => {
  const i = src.indexOf('  async _verifyWorkbench(nowMs) {')
  let d = 0, j = src.indexOf('{', i)
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) { j++; break } } }
  return src.slice(i, j)
})()
ok('⑩ _verifyWorkbench 体内**无写盘**（保持只读语义）', !vwBody.includes('_writeWorkbench') && !vwBody.includes('_wbSetPhase'), 'len=' + vwBody.length)
// ★判据改为「与真源码自身比对」，不用魔法数字（纪律：断言里凡出现魔法数字，一律改为与入参/真源码比对）。
//   意图不变 =「相位迁移只发生在 _wbRotateTick」⇒ 断言 **全部调用点都在该函数体内**：
//   总数 === 1（定义） + 体内调用数。写死 5 会随实现演进（本轮 E3-FIX-2④ 新增一处收敛调用）假红。
const rotBody = (() => {
  const i = src.indexOf('  async _wbRotateTick() {')
  let d = 0, j = src.indexOf('{', i)
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) { j++; break } } }
  return src.slice(i, j)
})()
const inRot = (rotBody.match(/_wbSetPhase\(/g) || []).length
const setPhaseHits = (src.match(/_wbSetPhase\(/g) || []).length
ok('⑩ 相位迁移只发生在 _wbRotateTick（唯一写者）', setPhaseHits === 1 + inRot,
  '总 ' + setPhaseHits + ' = 1 定义 + _wbRotateTick 体内 ' + inRot + '（体内外零散落）')
ok('⑩ 该判据非空守卫（体内确有多处迁移）', inRot >= 4, '体内调用数=' + inRot)
ok('⑩ 定义体在 _wbRotateTick 之外（不在 verify 里写相位）', src.indexOf('async _wbSetPhase(phase, extra) {') < src.indexOf('async _wbRotateTick() {'))
ok('⑩ M3 修正语义齐备：empty-catalog / all-ghosts / 活条目', /empty-catalog/.test(src) && /all-ghosts/.test(src) && /idleMs >= WB_QUIET_MS/.test(src))
ok('⑩ 异常判「不静止」（保守，不 fail-open 架空门）', /treat as NOT quiet/.test(src))
ok('⑩ 旧期在 draining/sealing 仍可用（不停记忆功能）', /old epoch still authoritative/.test(src))

console.log('\n═══ 结果：' + P + ' PASS / ' + F + ' FAIL ═══')
fs.rmSync(tmpHome, { recursive: true, force: true })
console.log('（临时目录已清理，真实 ~/.dsh 零接触）')
process.exit(F ? 1 : 0)
