/**
 * E3-FIX-2 受控演练（A/B 对照）—— 用户要求「手动操控进行一次演练」。
 *
 * 目的：证明「轮换卡死」是**真实缺陷**、且本次修复在**真机写盘路径**上把它治好了。
 * 手法：取**真机 workbench.json 原文**当输入，分别喂给
 *   ① 旧代码（lib/index.js.bak-20260926-000522-e3fix2，即宿主当前仍在跑的那份）
 *   ② 新代码（lib/index.js，本次修复后）
 * 两者都用**各自真源码**抽出的 `_wbRotateTick` / `_wbSetPhase` / `_wbFamilyQuiet` 在隔离 temp 目录真跑。
 *
 * ★三个关键保真点（首版都踩过）：
 *   1 `_wbRotateTick` 内部用 **`Date.now()`**（不是入参）⇒ 必须注入 FakeDate 才能越过 `WB_SEAL_RETRY_MS` 节流；
 *   2 期号算法含**基准日 `Date.UTC(1970,0,5)`**，mock 漏掉会算错期号；
 *   3 抽出的是**类方法**（`async _wbX() {}`），装配须转成 `host._wbX = async function () {}`。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const LIVE = path.join(os.homedir(), '.dsh', 'memory', 'workbench.json')
const OLD = path.join(ROOT, 'lib', 'index.js.bak-20260926-000522-e3fix2')
const NEW = path.join(ROOT, 'lib', 'index.js')

let P = 0, F = 0
const ok = (n, c, extra) => { if (c) { P++; console.log('  ✓ ' + n + (extra ? '  — ' + extra : '')) } else { F++; console.log('  ✗ ' + n + (extra ? '  — ' + extra : '')) } }

const liveRaw = fs.readFileSync(LIVE, 'utf8')
const live = JSON.parse(liveRaw)


/** 真源码的期号算法（逐字复刻，含基准日 1970-01-05）。 */
function epochOf(nowMs, per) {
  const d = new Date(Number(nowMs))
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const days = Math.floor((day.getTime() - Date.UTC(1970, 0, 5)) / 86400000)
  return 'B' + String(Math.floor(days / (per || 2)))
}
const tokenOf = (e, s) => crypto.createHash('sha256').update(String(e) + '|' + String(s)).digest('hex').slice(0, 16)


/**
 * ★自造「卡死态」夹具（2026-09-26 修正）。
 * **为什么必须自造**：本演练原本直接拿真机 workbench.json 当输入，而真机在用户重启后
 * 已自愈（phase=active / epoch=B10359）⇒ 「A 组复现卡死」的前提消失，13 条断言集体转红。
 * 那是**夹具缺陷**，不是代码回归：一个受控演练的输入必须由自己构造，
 * 不得依赖「真机此刻恰好处于故障态」（否则演练只在故障窗口内可重放）。
 * 构造方式：取真机文件的**形状**（字段名/嵌套），把相位与期号改回卡死值：
 *   phase=sealing + epoch=<上一期> + sealTriedAt 已过期 ⇒ 恰好命中 E3-FIX-2 修复的那条路径。
 */
const STUCK_EPOCH = 'B10000'          // 一个人为的「旧期」，保证与当前期不同
const STUCK_SID = 'session-drill-stuck-old-0001'
const NOW_SEED = Date.UTC(2026, 8, 26, 0, 0, 0)   // 固定受控时刻，避免依赖当天时间
const stuckObj = {
  version: 2,
  sessionId: STUCK_SID,
  epoch: STUCK_EPOCH,
  epochToken: tokenOf(STUCK_EPOCH, STUCK_SID),
  phase: 'sealing',
  current: { sessionId: STUCK_SID, openedAt: NOW_SEED - 3 * 86400000 },
  previous: null,
  drainStartedAt: NOW_SEED - 3600 * 1000,
  sealTriedAt: NOW_SEED - 120 * 1000,     // 已超 WB_SEAL_RETRY_MS(60s) ⇒ 不被节流挡住
  cwd: (live && live.cwd) || '',          // 形状沿用真机（值不影响本演练判定）
  permission: 'danger-full-access',
  createdAt: new Date(NOW_SEED - 3 * 86400000).toISOString(),
  periodDays: 2,
  greetCount: 0,
  gen: {},
}
// consentGranted 刻意**缺失** ⇒ 命中「迁移态」（= E3-FIX-2② 的三态分支）
const stuckRaw = JSON.stringify(stuckObj, null, 2)

console.log('【输入 = 自造「卡死态」夹具（不依赖真机此刻是否故障）】')
console.log('  epoch=' + stuckObj.epoch + '  phase=' + stuckObj.phase + '  token=' + stuckObj.epochToken +
  '  previous=' + JSON.stringify(stuckObj.previous) + '  consentGranted=' + String(stuckObj.consentGranted))
console.log('  current.sessionId=' + stuckObj.current.sessionId)
console.log('  sealTriedAt=' + stuckObj.sealTriedAt + '  drainStartedAt=' + stuckObj.drainStartedAt)
console.log('  （真机现状仅用于 D 组零接触比对：phase=' + live.phase + ' epoch=' + live.epoch + '）')
console.log('【输入 = 真机 workbench.json 原文】')
console.log('  epoch=' + live.epoch + '  phase=' + live.phase + '  token=' + live.epochToken +
  '  previous=' + JSON.stringify(live.previous) + '  consentGranted=' + String(live.consentGranted))
console.log('  current.sessionId=' + (live.current && live.current.sessionId))
console.log('  sealTriedAt=' + live.sealTriedAt + '  drainStartedAt=' + live.drainStartedAt)

/** 正面锚点 + 花括号配平抽取 */
function extractFn(src, anchor) {
  const i = src.indexOf(anchor)
  if (i < 0) throw new Error('锚点未命中: ' + anchor)
  let depth = 0, j = src.indexOf('{', i)
  for (; j < src.length; j++) {
    const c = src[j]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { j++; break } }
  }
  return src.slice(i, j)
}
function extractConst(src, name) {
  const m = src.match(new RegExp('^const ' + name + ' = [^\\n]+$', 'm'))
  if (!m) throw new Error('常量未命中: ' + name)
  return m[1] === undefined ? m[0].replace(/\r$/, '') : m[0].replace(/\r$/, '')
}
const constVal = (src, name) => eval(extractConst(src, name).split('=').slice(1).join('='))

/** 类方法 → 可挂到 host 的赋值语句 */
function methodToAssign(fnSrc, name) {
  const head = new RegExp('^\\s*async\\s+' + name + '\\s*\\(')
  if (!head.test(fnSrc)) throw new Error('方法头未命中: ' + name)
  return 'host.' + name + ' = async function ' + fnSrc.replace(head, '(')
}

let CTL = { now: 0 }
class FakeDate extends Date { static now() { return CTL.now } }

/** ★rotate 建新会话时的确定性 id（真机每次不同，演练固定值便于断言）。 */
const DRILL_NEW_SID = 'session-drill-rotated-0001'

/**
 * 用「给定源码」在隔离 temp 目录跑一次 tick。
 * @param srcPath 源码路径
 * @param seedRaw 初始落盘内容
 * @param nowMs   受控「当前时刻」（越过节流）
 * @param fakeEnsure 是否用 mock ensureWorkbench（否则用真源码的→会真建会话，故必用 mock）
 */
async function runTick(srcPath, seedRaw, nowMs) {
  const src = fs.readFileSync(srcPath, 'utf8')
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-drill-'))
  const memDir = path.join(tmpHome, 'memory'); fs.mkdirSync(memDir, { recursive: true })
  const WB = path.join(memDir, 'workbench.json')
  fs.writeFileSync(WB, seedRaw, 'utf8')

  CTL.now = nowMs
  const diags = [], ensureCalls = []
  const host = {
    _disposed: false, _wbRotateBusy: false, _subagentInflight: 0,
    config: { workbenchEnabled: true },
    _workbenchPeriodDays() { return Number(live.periodDays) || 2 },
    // ★逐字复刻真源码算法（含基准日）
    _workbenchEpoch(nowMs) { return epochOf(Number(nowMs) || Date.now(), this._workbenchPeriodDays()) },
    _workbenchEpochToken(e, s) { return tokenOf(e, s) },
    _wbStateOf(st) {
      const s = (st && typeof st === 'object') ? st : {}
      const pick = (v) => {
        if (!v) return null
        if (typeof v === 'string') return { sessionId: String(v) }
        const id = v.sessionId || v.id
        return id ? Object.assign({}, v, { sessionId: String(id) }) : null
      }
      return {
        epoch: String(s.epoch || ''), phase: String(s.phase || 'active'),
        current: pick(s.current) || (s.sessionId ? { sessionId: String(s.sessionId) } : null),
        previous: pick(s.previous),
        drainStartedAt: Number(s.drainStartedAt || 0) || 0,
        epochToken: String(s.epochToken || ''),
      }
    },
    _workbenchFile() { return WB },
    async _readWorkbench() { try { const t = fs.readFileSync(WB, 'utf8'); return t ? JSON.parse(t) : null } catch (e) { return null } },
    async _writeWorkbench(st) {
      try {
        const s = this._wbStateOf(st)
        if (s.current && s.current.sessionId) {
          st.version = 2
          st.sessionId = st.sessionId || s.current.sessionId
          st.phase = st.phase || s.phase || 'active'
          st.current = st.current || { sessionId: s.current.sessionId, openedAt: s.current.openedAt || null }
          if (st.previous === undefined) st.previous = s.previous || null
          if (st.drainStartedAt === undefined) st.drainStartedAt = s.drainStartedAt || 0
          if (!st.epochToken && s.epoch) st.epochToken = this._workbenchEpochToken(s.epoch, s.current.sessionId)
        }
        fs.writeFileSync(WB, JSON.stringify(st, null, 2), 'utf8')
        return true
      } catch (e) { return false }
    },
    // 真机当时无存活子代理目录（E0/M3 空 catalog 语义）；族静止由 E3 探针单独覆盖
    async _wbCatalogChildIds() { return [] },
    async _wbChildMtimes() { return new Map() },
    async _wbFamilyQuiet() { return { quiet: true, ghosts: 0, live: 0, reason: 'quiet' } },
    // ★真机行为复刻（2026-09-26 由线上日志实证，取代此前的 `reused:true` 简化 mock）：
    //   诊断日志两次出现 `workbench session created via sessionController: <新 id>` +
    //   `previous={"sessionId":"<旧 id>","sealedAt":...}` ⇒ **rotate 会建新会话**、旧的进 previous。
    //   ⚠ 上一版 mock 恒返回 `reused:true` 且不建会话 ⇒ 断言 B7「current 未换」变成
    //   **mock 决定的假绿**（真机其实换了会话）。教训：mock 必须复刻真机的可观测行为，
    //   否则断言只在 mock 的假设里成立（本仓纪律「负路径必须实测」的同族问题）。
    async ensureWorkbench(o) {
      ensureCalls.push(o || null)
      if (o && o.rotate === true) {
        const cur = JSON.parse(fs.readFileSync(WB, 'utf8'))
        const prevSid = (cur.current && cur.current.sessionId) || live.current.sessionId
        cur.previous = { sessionId: prevSid, sealedAt: new Date(CTL.now).toISOString() }
        cur.current = { sessionId: DRILL_NEW_SID, openedAt: CTL.now }
        fs.writeFileSync(WB, JSON.stringify(cur, null, 2), 'utf8')
        return { ok: true, reused: false, sessionId: DRILL_NEW_SID, epoch: epochOf(CTL.now, 2) }
      }
      return { ok: true, reused: true, sessionId: live.current.sessionId, epoch: epochOf(CTL.now, 2) }
    },
    diag(m) { diags.push(String(m)) },
  }

  const body = [
    methodToAssign(extractFn(src, '  async _wbSetPhase(phase, extra) {'), '_wbSetPhase'),
    methodToAssign(extractFn(src, '  async _wbCatalogChildIds(sid) {'), '_wbCatalogChildIds'),
    methodToAssign(extractFn(src, '  async _wbChildMtimes(ids) {'), '_wbChildMtimes'),
    methodToAssign(extractFn(src, '  async _wbFamilyQuiet(nowMs) {'), '_wbFamilyQuiet'),
    methodToAssign(extractFn(src, '  async _wbRotateTick() {'), '_wbRotateTick'),
    'return true',
  ].join('\n\n')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const factory = new AsyncFunction(
    'host', 'fs', 'path', 'crypto', 'Date', 'WB_QUIET_MS', 'WB_SEAL_TIMEOUT_MS', 'WB_SEAL_RETRY_MS',
    // ★真源码函数体调用**模块级** diag()；不注入会抛 ReferenceError 并被 tick 的 catch 吞掉
    'const { writeFile, readFile, mkdir, rename } = fs.promises\n' +
    'const diag = (m) => host.diag(m)\n' + body
  )
  await factory(host, fs, path, crypto, FakeDate,
    constVal(src, 'WB_QUIET_MS'), constVal(src, 'WB_SEAL_TIMEOUT_MS'), constVal(src, 'WB_SEAL_RETRY_MS'))

  // ★覆盖必须在装配**之后**（否则被真实现盖掉）
  host._wbFamilyQuiet = async () => ({ quiet: true, ghosts: 0, live: 0, reason: 'quiet' })

  await host._wbRotateTick()
  const after = JSON.parse(fs.readFileSync(WB, 'utf8'))
  fs.rmSync(tmpHome, { recursive: true, force: true })
  return { after, diags, ensureCalls }
}

// 受控「当前时刻」：夹具 sealTriedAt 之后 61s ⇒ 越过 WB_SEAL_RETRY_MS(60s)
const NOW = NOW_SEED
const wantEpoch = epochOf(NOW, stuckObj.periodDays)
const wantTokFromStuck = tokenOf(wantEpoch, STUCK_SID)   // rotate 前（旧会话）
console.log('\n  受控时刻 now=' + NOW + '（夹具 sealTriedAt + 61s）⇒ 当前期应为 ' + wantEpoch)

/* ═══ A：旧代码 ═══ */
console.log('\n【A 旧代码（E3-FIX-2 之前，宿主当时在跑的那份）—— 预期复现卡死】')
const A = await runTick(OLD, stuckRaw, NOW)
console.log('  diag: ' + (A.diags.join(' | ') || '(空)'))
console.log('  ensureWorkbench opts: ' + JSON.stringify(A.ensureCalls))
ok('A1 进入 sealing 分支并调用了 ensureWorkbench', A.ensureCalls.length === 1, '调用 ' + A.ensureCalls.length + ' 次')
ok('A2 ★复现：调用**不带** rotate ⇒ 走复用分支、永不建新期',
  A.ensureCalls.length === 1 && !(A.ensureCalls[0] && A.ensureCalls[0].rotate === true), JSON.stringify(A.ensureCalls))
ok('A3 ★复现：epoch 仍停在旧期（未推进）', A.after.epoch === STUCK_EPOCH, 'epoch=' + A.after.epoch + '（当前期应为 ' + wantEpoch + '）')
ok('A4 ★复现：phase 仍为 sealing（未回流 active）', A.after.phase === 'sealing', 'phase=' + A.after.phase)
ok('A5 ★复现：期牌仍是旧期牌 ⇒ E2 归属门会拒全部写路径', A.after.epochToken === stuckObj.epochToken,
  'token=' + A.after.epochToken + '（旧会话在当期应为 ' + wantTokFromStuck + '）')

/* ═══ B：新代码 ═══ */
console.log('\n【B 新代码（本次修复后）—— 预期闭环】')
const B = await runTick(NEW, stuckRaw, NOW)
console.log('  diag: ' + (B.diags.join(' | ') || '(空)'))
console.log('  ensureWorkbench opts: ' + JSON.stringify(B.ensureCalls))
ok('B1 新代码带 rotate:true（跳过复用分支）', B.ensureCalls.length === 1 && B.ensureCalls[0].rotate === true, JSON.stringify(B.ensureCalls))
ok('B2 同意门三态：consentGranted 缺失 + 已有 current ⇒ 迁移态放行、带 consent:true',
  B.ensureCalls.length === 1 && B.ensureCalls[0].consent === true, JSON.stringify(B.ensureCalls))
ok('B3 ★闭环：epoch 已收敛到当前期', B.after.epoch === wantEpoch, 'epoch=' + B.after.epoch + ' want=' + wantEpoch)
ok('B4 ★闭环：phase 已复位 active', B.after.phase === 'active', 'phase=' + B.after.phase)
ok('B5 ★闭环：期牌已不再是旧期牌', B.after.epochToken !== stuckObj.epochToken, 'token=' + B.after.epochToken)
ok('B6 ★闭环：drainStartedAt / sealTriedAt 已清零',
  Number(B.after.drainStartedAt) === 0 && Number(B.after.sealTriedAt) === 0,
  'drain=' + B.after.drainStartedAt + ' sealTried=' + B.after.sealTriedAt)
ok('B7 ★rotate 建新会话、旧会话进 previous（真机语义，非「不换会话」）',
  !!B.after.current && B.after.current.sessionId === DRILL_NEW_SID &&
  !!B.after.previous && B.after.previous.sessionId === STUCK_SID,
  'current=' + (B.after.current && B.after.current.sessionId) + ' previous=' + JSON.stringify(B.after.previous && B.after.previous.sessionId))
ok('B7b 旧会话仍在受保护集合（不删除，守卫 ⑰）',
  String(B.after.previous && B.after.previous.sessionId) === STUCK_SID)
ok('B7c ★期牌键到**新**会话（收敛④的重读落盘生效）',
  B.after.epochToken === tokenOf(wantEpoch, DRILL_NEW_SID),
  'token=' + B.after.epochToken + ' want=' + tokenOf(wantEpoch, DRILL_NEW_SID))
ok('B8 收敛后 _verifyWorkbench 的期号判据成立（epoch 与当前期一致）',
  String(B.after.epoch) === wantEpoch && !!(B.after.epochToken))

/* ═══ C：幂等 ═══ */
console.log('\n【C 幂等：收敛后的状态再 tick 一次（期号相符）】')
const C = await runTick(NEW, JSON.stringify(B.after, null, 2), NOW + 15 * 1000)
ok('C1 已收敛态再 tick ⇒ 不再调用 ensureWorkbench（不空转）', C.ensureCalls.length === 0, '调用 ' + C.ensureCalls.length + ' 次')
ok('C2 相位保持 active', C.after.phase === 'active', 'phase=' + C.after.phase)
ok('C3 epoch 未被改写', C.after.epoch === wantEpoch, 'epoch=' + C.after.epoch)

/* ═══ D：真机零接触 ═══ */
console.log('\n【D 真机零接触 + 线上现状比对】')
ok('D1 真机 workbench.json 逐字节未被改动', fs.readFileSync(LIVE, 'utf8') === liveRaw, 'len=' + liveRaw.length)
const nowLive = JSON.parse(fs.readFileSync(LIVE, 'utf8'))
// ★D2 口径修正：原断言写死「真机仍为 sealing/旧期（宿主未重启）」——那是**当时的现场快照**，
//   用户重启后真机已自愈（active/新期）⇒ 旧断言必然转红。改为**形状不变量**：
//   真机必须始终自洽（phase 与 epoch/期牌三者一致），而不是绑定某个历史相位。
ok('D2 真机状态自洽（phase 合法 + 期牌 = sha256(落盘期|当前会话)）',
  ['active', 'draining', 'sealing'].includes(nowLive.phase) &&
  nowLive.epochToken === tokenOf(nowLive.epoch, nowLive.current && nowLive.current.sessionId),
  'phase=' + nowLive.phase + ' epoch=' + nowLive.epoch + ' token=' + nowLive.epochToken)
ok('D3 真机未处于卡死态（若为 sealing 则不应长期滞留 —— 由 converged 链保证）',
  !(nowLive.phase === 'sealing' && Number(nowLive.sealTriedAt || 0) > 0),
  'phase=' + nowLive.phase + ' sealTriedAt=' + String(nowLive.sealTriedAt))

console.log('\n═══ 演练结果：' + P + ' PASS / ' + F + ' FAIL ═══')
process.exit(F ? 1 : 0)
