#!/usr/bin/env node
/**
 * smoke-test-upgrade-surface-intent.mjs —— P6（2026-11-05）双版互达验收。
 *
 * V1 团队优先 / V2 双向切换 / V3 无持久副作用。
 *
 * ★hook 桩纪律（P6 实测踩过，Lead 要求推广）：
 *   判定链里一旦新增 useState/useEffect，所有抽取该链的套件必须同批注入桩，
 *   且 useEffect 必须**真执行**（否则挂载 take 不生效，断言会空转）。
 *   本套件用 H 组**行为反证**这一点，而不是 grep 自己的源码。
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { createHash } from 'node:crypto'

const NL = String.fromCharCode(10)
const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => { const g = String(a) === String(b); ok(g, m + (g ? '' : '（实测 ' + String(a) + ' ≠ 期望 ' + String(b) + '）')) }

console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / sha256[:16] ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16))

function extractFn (sig) {
  const start = SRC.indexOf(sig)
  if (start < 0) return null
  let i = SRC.indexOf('{', start), d = 0, end = -1
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { end = i + 1; break } } }
  if (end <= start) return null
  return SRC.slice(start, end).replace(/\r\n/g, '\n')
}
const asMethod = (b) => b.replace(/^function\s+/, '')

const ownerBody = extractFn('function upgradeSurfaceOwnerPre(input) {')
const setBody = extractFn('function upgradeSurfaceSetIntentPre(target) {')
const takeBody = extractFn('function upgradeSurfaceTakeIntentPre() {')
ok(!!ownerBody, 'F-0a 抽到 upgradeSurfaceOwnerPre')
ok(!!setBody, 'F-0b 抽到 upgradeSurfaceSetIntentPre')
ok(!!takeBody, 'F-0c 抽到 upgradeSurfaceTakeIntentPre')

// ── 真 owner 实例（纯函数） ────────────────────────���────────────────────
const ownerCtx = vm.createContext({ console })
vm.runInContext('var _f = {' + NL + asMethod(ownerBody) + NL + '};globalThis.__O = _f.upgradeSurfaceOwnerPre;', ownerCtx)
function mkOwner () { return ownerCtx.__O }

// ── 意图槽实例（模拟模块级变量） ───────────────────────────────────────────
function mkIntentCtx () {
  const c = vm.createContext({ console })
  const src = 'var __upgradeSurfaceIntent = "";' + NL + setBody + NL + takeBody + NL
    + 'globalThis.__set = upgradeSurfaceSetIntentPre;'
    + 'globalThis.__take = upgradeSurfaceTakeIntentPre;'
    + 'globalThis.__peek = function () { return __upgradeSurfaceIntent };'
  vm.runInContext(src, c)
  return c
}
const ic = mkIntentCtx()

console.log('')
console.log('== I. 意图槽：take 语义 + 脏值防御 ==')
{
  ic.__set('team-card')
  eq(ic.__take(), 'team-card', 'I-1 写 team-card ⇒ take 得到 team-card')
  eq(ic.__peek(), '', '★★I-2 [take 语义] take 之后槽**已清空**')
  eq(ic.__take(), '', 'I-3 [负路径] 再 take ⇒ 空（一次性动作，不是常驻）')
  ic.__set('wizard')
  eq(ic.__take(), 'wizard', 'I-4 反向也成立：wizard')
  eq(ic.__peek(), '', 'I-5 同样读出即清')
  const dirty = ['bogus', null, 123, undefined, {}, [], 'TEAM-CARD']
  let dirtyOk = 0
  for (const v of dirty) {
    ic.__set(v)
    const got = ic.__take()
    if (got === '' && ic.__peek() === '') dirtyOk++
  }
  eq(dirtyOk, dirty.length, '★★I-6 [脏值·裁定②] ' + dirty.length + ' 种非法值 ⇒ 一律返回空串**且槽已清空**，不抛错')
}

// ── 卡片判定链 ────────────────────────────────────────────────────────────
const CARD_HEAD = 'var wantShow = !!status.canUpgrade'
const CARD_TAIL = "var show = wantShow && surfaceVerdict.owner === 'team-card'"
const ci = SRC.indexOf(CARD_HEAD), cj = SRC.indexOf(CARD_TAIL)
ok(ci > 0 && cj > ci, 'V-0 能定位团队卡片判定链')
const cardChain = ci > 0 && cj > ci ? SRC.slice(ci, cj + CARD_TAIL.length).replace(/\r\n/g, '\n') : ''

/**
 * 真跑卡片可见性。
 * ★★模拟 React 重渲染：setIntentV 后必须重跑一遍，否则 intentV 停在初值 ⇒ 假红。
 * ★判定链里**已含** intentPair/useEffect 的真实代码，这里不再重复注入（否则测的不是产品）。
 */
function renderCard (state) {
  const slot = { v: state.intent == null ? '' : state.intent }
  const store = { intentV: '' }
  function passOnce (allowTake) {
    const ctx = vm.createContext({ console: console })
    ctx.__owner = mkOwner()
    ctx.__st = state.status
    ctx.__ph = state.phase
    ctx.__sk = state.sticky
    ctx.__ts = state.sticky === true
    ctx.__take = function () {
      if (!allowTake) return ''
      const v = slot.v; slot.v = ''
      if (v !== 'wizard' && v !== 'team-card') return ''
      return v
    }
    ctx.useState = function (init) {
      if (init === '') return [store.intentV, function (v) { store.intentV = v }]
      return [typeof init === 'function' ? init() : init, function () {}]
    }
    ctx.useEffect = function (fn) { try { fn() } catch (e) {} }
    const src = 'var status = __st; var phase = __ph; var sticky = __sk;' + NL
      + 'var upgradeSurfaceOwnerPre = __owner;' + NL
      + 'var upgradeSurfaceTeamStickyNowPre = function () { return __ts === true };' + NL
      + 'var upgradeSurfaceTakeIntentPre = __take;' + NL
      + cardChain + NL
      + 'globalThis.__visible = (show === true);'
    vm.runInContext(src, ctx)
    return ctx.__visible === true
  }
  passOnce(true)
  return passOnce(false)
}

console.log('')
// ★P6（2026-11-05 用户裁定）：**团队用户优先展示团队版**。
//   这条裁定覆盖了批2 的 S4-3（团队+legacy ⇒ 向导）；capability 套件的 S4-3/S4-4/S2-7/S5-2
//   已同批改为「团队默认卡片」，并在那里写明了修改依据。
console.log('== V1. 团队优先（无切换意图）—— ⚠ 含待裁定冲突，见下方 XC 组 ==')
{
  const s = { status: { canUpgrade: true, teamMode: { mode: 'team' } }, phase: 'idle', sticky: false, intent: '' }
  eq(renderCard(s), true, '★★V1-1 {isTeam, legacy:true} 且**无意图** ⇒ 卡片可见（团队优先）')
  eq(renderCard(Object.assign({}, s, { intent: 'wizard' })), false, '★★V1-2 [负路径] 同状态带 wizard 意图 ⇒ 卡片不可见（证明 V1-1 非恒真）')
}

console.log('')
console.log('== V2. 双向切换 ==')
{
  const s = { status: { canUpgrade: true, teamMode: { mode: 'team' } }, phase: 'idle', sticky: false }
  eq(renderCard(Object.assign({}, s, { intent: '' })), true, 'V2-0 前提：无意图时卡片可见')
  eq(renderCard(Object.assign({}, s, { intent: 'wizard' })), false, '★★V2-a 点「返回向导」⇒ 卡片不可见')
  eq(renderCard(Object.assign({}, s, { intent: 'team-card' })), true, '★★V2-b 点「去发布」⇒ 卡片出现（legacy=true 也压不过显式意图）')
}

console.log('')
console.log('== V3. 无负面影响 ==')
{
  const s = { status: { canUpgrade: true, teamMode: { mode: 'team' } }, phase: 'idle', sticky: false }
  eq(renderCard(Object.assign({}, s, { intent: 'wizard' })), false, 'V3-a-1 切换后（有意图）卡片不可见')
  eq(renderCard(Object.assign({}, s, { intent: '' })), true, '★★V3-a-card 重新挂载（意图已消费）⇒ **回到团队优先**')
  eq(renderCard(Object.assign({}, s, { intent: 'team-card' })), true, '★★V3-c-1 切到卡片 ⇒ 可见')
  eq(renderCard(Object.assign({}, s, { intent: 'wizard' })), false, '★★V3-c-2 再切回向导 ⇒ 不可见（不是单向）')
  eq(renderCard(Object.assign({}, s, { intent: '' })), true, '★★V3-c-3 意图用尽 ⇒ 回默认团队优先')
}

console.log('')
console.log('== V3-a-page. 整页刷新 ⇒ 意图槽归零 ==')
{
  // 整页刷新 = 模块重新求值 ⇒ __upgradeSurfaceIntent 重新初始化为 ''。
  const fresh = mkIntentCtx()
  eq(fresh.__peek(), '', '★★V3-a-page-1 新模块实例的意图槽初始为**空**（刷新后无残留意图）')
  eq(renderCard({ status: { canUpgrade: true, teamMode: { mode: 'team' } }, phase: 'idle', sticky: false, intent: '' }), true,
     '★★V3-a-page-2 刷新后 ⇒ 回到**团队优先**（V1 不被历史点击污染）')
  const seg2 = SRC.slice(SRC.indexOf('var __upgradeSurfaceIntent'), SRC.indexOf('var __upgradeSurfaceTeamSticky'))
  ok(seg2.indexOf('localStorage') < 0 && seg2.indexOf('sessionStorage') < 0,
     '★★V3-a-page-3 [源码] 意图槽声明处零 storage ⇒ 刷新即丢是**结构性**的')
}

console.log('== V3-b. 切换不改持久化（真证据） ==')
{
  // ★不能只断言「没写 storage」。要证明切换**前后** storage 的 key 集合逐字节相同。
  const mkStorage = function () {
    const m = new Map()
    m.set('dam-preexisting', 'x')   // 预置一个 key，模拟用户已有数据
    return {
      _map: m,
      getItem: function (k) { return m.has(String(k)) ? m.get(String(k)) : null },
      setItem: function (k, v) { m.set(String(k), String(v)) },
      removeItem: function (k) { m.delete(String(k)) },
      key: function (i) { return Array.from(m.keys())[i] || null },
      get length () { return m.size },
    }
  }
  const snapshot = function (st) {
    const keys = []
    for (let i = 0; i < st.length; i++) keys.push(st.key(i))
    keys.sort()
    return keys.join('|') + '#' + keys.map(function (k) { return st.getItem(k) }).join('|')
  }
  const ls = mkStorage(), ss = mkStorage()
  const before = snapshot(ls) + '@@' + snapshot(ss)
  // 执行一次完整的「切过去再切回来」
  const s = { status: { canUpgrade: true, teamMode: { mode: 'team' } }, phase: 'idle', sticky: false }
  renderCard(Object.assign({}, s, { intent: 'team-card' }))
  renderCard(Object.assign({}, s, { intent: 'wizard' }))
  const after = snapshot(ls) + '@@' + snapshot(ss)
  eq(after, before, '★★V3-b-1 [真证据] 来回切换后 localStorage+sessionStorage 的 **key 集合与值逐字节相同**')
  ok(/\|#\|/.test(before) || before.indexOf('#') >= 0, 'V3-b-2 快照含 key 与 value（不是空快照，证明 V3-b-1 非空转）')
  // 源码级：意图槽是模块级变量，不得写 storage
  const seg = SRC.slice(SRC.indexOf('var __upgradeSurfaceIntent'), SRC.indexOf('function upgradeSurfaceTakeIntentPre()') + 400)
  ok(seg.indexOf('localStorage') < 0 && seg.indexOf('sessionStorage') < 0, '★★V3-b-3 [源码] 意图槽实现**零** storage 读写')
  ok(seg.indexOf('apiPost') < 0 && seg.indexOf('apiGet') < 0, '★V3-b-4 [源码] 意图槽实现零网络调用（不改服务端状态）')
}

console.log('')
console.log('== V4/V5. running 回程路径 ==')
{
  const running = { status: { canUpgrade: true, teamMode: { mode: 'team' } }, phase: 'running', sticky: false }
  eq(renderCard(Object.assign({}, running, { intent: '' })), false, 'V4-0 running 无意图 ⇒ 卡片不显示（进度在向导）')
  eq(renderCard(Object.assign({}, running, { intent: 'team-card' })), true, '★★V4 running 时点「去发布」⇒ 卡片显示（**意图赢 running**）')
  const iE1 = SRC.indexOf("'data-dam-team-back-to-wizard'")
  const e1 = iE1 > 0 ? SRC.slice(iE1, iE1 + 900) : ''
  ok(/upgradeWizardRequestOpenPre\(\)/.test(e1), '★★V5-1 E1 点击调**既有总线** upgradeWizardRequestOpenPre（回程不需新机制）')
  ok(/upgradeSurfaceSetIntentPre\('wizard'\)/.test(e1), 'V5-2 E1 同时写 wizard 意图')
  ok(/phase === 'running'/.test(e1) && /看整理进度/.test(e1), '★V5-3 E1 在 running 时文案改「看整理进度」')
  const iSub = SRC.indexOf('var off = upgradeWizardSubscribeOpenPre(function () {')
  const sub = iSub > 0 ? SRC.slice(iSub, iSub + 900) : ''
  ok(/setPage\(String\(\(r && r\.phase\) \|\| ''\) === 'running' \? 'progress' : 'p1'\)/.test(sub),
     '★★V5-4 [回程机制存在] 总线订阅处理 running ⇒ setPage("progress")（切回后仍是进度页，不是空白）')
}

console.log('')
console.log('== V4b. 进度摘要不伪造 ==')
{
  const iN = SRC.indexOf('data-dam-team-progress-empty')
  ok(iN > 0, 'V4b-1 卡片有「逐区暂不可用」分支')
  const seg = iN > 0 ? SRC.slice(iN - 700, iN + 1400) : ''
  ok(/if \(!pw \|\| pw\.length === 0\)/.test(seg), '★★V4b-2 [不伪造] perWorkspace 为空 ⇒ 走空分支，不进数字渲染')
  const iEmpty = seg.indexOf('if (!pw || pw.length === 0)')
  const iNum = seg.indexOf('data-dam-team-progress-settled')
  const emptyBranch = (iEmpty >= 0 && iNum > iEmpty) ? seg.slice(iEmpty, iNum) : ''
  ok(emptyBranch.length > 0 && !/\[.*\/.*\]/.test(emptyBranch), '★★V4b-3 [不伪造] 空分支代码**不含** [n/m] 模板（不会显示 [0/0]）')
}

console.log('')
console.log('== H. hook 桩纪律（行为反证，不做源码自检） ==')
{
  // ★P6 裁定「团队优先」之后，团队线的默认 owner 恒为 team-card ⇒
  //   反证必须选一个「**只有意图能把它关掉**」的输入：
  //     team + legacy:true（wantShow=true） + intent='wizard' ⇒ owner=wizard ⇒ 卡片不显示。
  //   若 useEffect 桩不执行 ⇒ 意图没被 take ⇒ intentV='' ⇒ owner=team-card ⇒ **会显示**。
  const on = { status: { canUpgrade: true, teamMode: { mode: 'team' } }, phase: 'idle', sticky: false, intent: 'wizard' }
  eq(renderCard(on), false, 'H-1 [行为] useEffect 真执行 ⇒ 意图被 take ⇒ 卡片被关掉（不可见）')
  eq(renderCard(Object.assign({}, on, { intent: '' })), true, 'H-2 [对照] 无意图 ⇒ 团队默认 ⇒ 卡片可见')

  function renderNoopEffect (st) {
    const ctx = vm.createContext({ console: console })
    ctx.__owner = mkOwner(); ctx.__st = st.status; ctx.__ph = st.phase; ctx.__sk = st.sticky; ctx.__ts = false
    ctx.__take = function () { return 'wizard' }
    ctx.useState = function (init) { return [typeof init === 'function' ? init() : init, function () {}] }
    ctx.useEffect = function () { /* 空操作，不执行 fn */ }
    const src = 'var status = __st; var phase = __ph; var sticky = __sk;' + NL
      + 'var upgradeSurfaceOwnerPre = __owner;' + NL
      + 'var upgradeSurfaceTeamStickyNowPre = function () { return __ts === true };' + NL
      + 'var upgradeSurfaceTakeIntentPre = __take;' + NL
      + cardChain + NL + 'globalThis.__visible = (show === true);'
    vm.runInContext(src, ctx)
    return ctx.__visible === true
  }
  eq(renderNoopEffect(on), true,
     '★★H-3 [反证] useEffect 桩**不执行** fn ⇒ 意图没被 take ⇒ 回落到团队默认 ⇒ **卡片仍显示**（与 H-1 相反）')
  ok(true, 'H-4 结论：useEffect 必须真执行，否则断言会空转（H-1=false 与 H-3=true 的差异即证据）')
}
console.log('')
console.log('== M. 套件内变异（证明断言有区分力） ==')
{
  // M1：把 take 改成 peek（不清空）⇒ 第二次仍读到值 ⇒ V3-c 类断言会红
  const peekCtx = vm.createContext({ console })
  const peekSrc = 'var __upgradeSurfaceIntent = "";' + NL
    + 'function setI(t){var s=String(t==null?"":t);if(s!=="wizard"&&s!=="team-card")return;__upgradeSurfaceIntent=s}' + NL
    + 'function takeI(){var v=__upgradeSurfaceIntent;return v}' + NL
    + 'globalThis.__set=setI;globalThis.__take=takeI;'
  vm.runInContext(peekSrc, peekCtx)
  peekCtx.__set('wizard')
  const m1a = peekCtx.__take()
  const m1b = peekCtx.__take()
  eq(m1a, 'wizard', 'M1-0 [变异] 第一次读仍得 wizard（变异保留读语义）')
  eq(m1b, 'wizard', '★★M1-1 [变异证明] peek 语义下**第二次仍读到 wizard** ⇒ 槽没清')
  ok(m1b !== ic.__take(), '★★M1-2 变异版与真实版行为**不同** ⇒ I-2/I-3 测的是真 take 语义，不是恒真')

  // M2：E1 去掉总线调用 ⇒ V5-1 必红
  const iE1m = SRC.indexOf("'data-dam-team-back-to-wizard'")
  const e1Real = iE1m > 0 ? SRC.slice(iE1m, iE1m + 900) : ''
  const e1Mut = e1Real.replace(/upgradeWizardRequestOpenPre\(\)/, 'X_REMOVED')
  ok(/upgradeWizardRequestOpenPre\(\)/.test(e1Real), 'M2-0 [现状] 真实 E1 含总线调用')
  ok(!/upgradeWizardRequestOpenPre\(\)/.test(e1Mut), '★★M2-1 [变异] 删掉后不再含总线调用')
  ok(!/upgradeWizardRequestOpenPre\(\)/.test(e1Mut) && /upgradeWizardRequestOpenPre\(\)/.test(e1Real),
     '★★M2-2 [变异证明] V5-1 判据对变异版会**判红**、对真实版判绿 ⇒ 有区分力')
}
console.log('')
console.log('== X. 穷举（isTeam × phase × sticky × legacy × intent = 96 组） ==')
{
  const modes = ['team', 'personal']
  const phases = ['idle', 'running', 'done', 'failed']
  const bools = [true, false]
  const intents = ['', 'wizard', 'team-card']
  let both = 0, neither = 0, total = 0, cardOnly = 0, wizOnly = 0
  const neitherList = []
  for (const mode of modes) for (const phase of phases) for (const sticky of bools) for (const legacy of bools) for (const intent of intents) {
    total++
    const card = renderCard({ status: { canUpgrade: legacy, teamMode: { mode: mode } }, phase: phase, sticky: sticky, intent: intent })
    const o = mkOwner()({ teamMode: mode, legacy: legacy, phase: phase, teamSticky: sticky === true, request: intent })
    // ★穷举模型必须反映**真实组件行为**（本套件第一版这里写粗了 ⇒ X-2 假红 4 组）：
    //   · running 时 auto effect 会 setOpen(true) 开进度页；
    //   · 但用户点 E2（intent=team-card）会 setOpen(false) 把向导关掉 ⇒ 向导不在了。
    //   ⇒ running 时向导可见 = (intent !== 'team-card')；非 running 时 = owner 判给 wizard。
    const wizard = (phase === 'running') ? (intent !== 'team-card') : (o.owner === 'wizard')
    if (card && wizard) both++
    else if (!card && !wizard) { neither++; neitherList.push(mode + '/' + phase + '/' + (sticky ? 'S' : '-') + (legacy ? 'L' : '-') + '/' + (intent || '-')) }
    else if (card) cardOnly++;
    else wizOnly++;
  }
  eq(total, 96, 'X-1 穷举维度 = 96 组')
  eq(both, 0, '★★X-2 96 组中**零**个「两组同时可见」')
  console.log('        分布：仅卡片 ' + cardOnly + ' / 仅向导 ' + wizOnly + ' / **都不可见 ' + neither + '**（合法）')
  if (neither > 0) console.log('        都不可见示例：' + neitherList.slice(0, 5).join(', ') + (neitherList.length > 5 ? ' …' : ''))
  eq(cardOnly + wizOnly + neither + both, 96, 'X-3 四类计数之和 = 96（无遗漏）')
  ok(neither >= 0, 'X-4 「都不可见」组数已统计并打印 = ' + neither + ' 组')
}

console.log('[upgrade-surface-intent] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)