/**
 * Minervaowl7 批 A-2（#288 / #289）专项套件 —— **真执行产线代码**（CR-10 纪律）：
 *   ① 从 lib/client.js 按花括号配平抽出 **真** AutoContinueHost 组件体；
 *   ② 受控 hooks / 受控 setInterval / 可注入 apiGet / sessions / currentSessionIdClient 真挂载；
 *   ③ 真推进 3 秒轮询，断言**真渲染输出**（props.confirmation / props.status / countdown）。
 *
 * #288：lastOk 分支早返回遮蔽当前 armed 的确认卡（历史成功提示优先于当下确认卡）。
 * #289：轮询缺请求代次 + 会话身份校验（迟到响应拉走会话 / 旧 armed 复活已消失的确认卡）。
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CLIENT = path.join(ROOT, 'lib', 'client.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const sleep = () => new Promise((r) => setImmediate(r))

function extractFnBody (src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0
  for (let i = start + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  throw new Error('unbalanced: ' + header)
}

function mount (SRC, opts) {
  const o = opts || {}
  const AC_BODY = extractFnBody(SRC, 'function AutoContinueHost() {')
  const cells = new Map()
  let cursor = 0
  let first = true
  const intervals = new Map()
  let ivSeq = 0
  const effects = []
  const useState = (init) => { const i = cursor++; if (!cells.has(i)) cells.set(i, typeof init === 'function' ? init() : init); return [cells.get(i), (n) => { cells.set(i, typeof n === 'function' ? n(cells.get(i)) : n) }] }
  const useRef = (v) => { const i = 'r' + (cursor++); if (!cells.has(i)) cells.set(i, { current: v }); return cells.get(i) }
  const useEffect = (fn) => { if (first) effects.push(fn) }
  const h = (type, props, ...kids) => ({ type, props: props || {}, children: kids })
  const apiGet = o.apiGet || (() => Promise.resolve(null))
  const sessions = o.sessions || { open: () => {} }
  const sidOf = typeof o.sidOf === 'function' ? o.sidOf : () => o.sid || 'sid-A'
  const render = new Function('useState', 'useEffect', 'useRef', 'useReducer', 'useMemo', 'useCallback', 'h', 'L', 't', 'apiGet', 'apiPost', 'API', 'sessions', 'currentSessionIdClient', 'Iter5AutoContinue', 'configOf', 'setInterval', 'clearInterval',
    AC_BODY + '\nreturn AutoContinueHost()')
  const origFirst = () => first
  const show = () => {
    cursor = 0
    // ★effect 只在**首次渲染**收集（与 #278 夹具同法）：runEffects 之前不得把 first 置假，
    //   否则 useEffect 收集不到、setInterval 永不注册 ⇒ 轮询推不动（首版实测：pending=0）。
    return render(useState, useEffect, useRef, (r, i) => [i, () => {}], (f) => f(), (f) => f, h, (zh) => zh, (k) => 'T:' + k, apiGet, () => Promise.resolve({ ok: true }), { config: '/c', autoContState: '/s', autoContDecide: '/d' }, sessions, sidOf, h, (d) => d, (fn) => { const id = ++ivSeq; intervals.set(id, fn); return id }, (id) => intervals.delete(id))
  }
  return {
    body: AC_BODY,
    intervals,
    sessions,
    show,
    runEffects: () => { for (const fn of effects.splice(0)) { try { fn() } catch (e) {} } },
    poll: async () => { for (const fn of Array.from(intervals.values())) fn(); return null },
    tick: async () => { for (const fn of Array.from(intervals.values())) fn(); await sleep(); await sleep(); return show() },
    settle: async () => { await sleep(); await sleep(); return show() },
    _first: origFirst,
  }
}

const SRC = readFileSync(CLIENT, 'utf8')
const cfg = { autoContinueThreshold: 0.75, autoContinueEnabled: true }
const NOW = Date.now()
const ARM = { sessionId: 'sid-A', ratio: 0.9, tokens: 10, window: 100, ring: 90, wall: 90, edgeAt: NOW - 1000, expiresAt: NOW + 35000 }
const armedState = (over) => Object.assign({ executing: false, lastOk: null, error: null, armed: ARM }, over || {})
const okState = (over) => Object.assign({ executing: false, lastOk: { at: NOW - 5000, sessionId: 'sid-A', fromSid: 'sid-A', model: 'm1', reasoningEffort: 'high' }, error: null, armed: null }, over || {})
const confirmOf = (v) => (v && v.props && v.props.confirmation) ? v.props.confirmation : null
const statusOf = (v) => (v && v.props && typeof v.props.status === 'string') ? v.props.status : null
const CHECK = String.fromCharCode(10003)

console.log('')
console.log('[A2-①] #288 armed 与历史 lastOk 并存 ⇒ 确认卡优先（不得被吞）')
{
  const h1 = mount(SRC, { sid: 'sid-A', apiGet: (u) => Promise.resolve(u === '/c' ? cfg : armedState({ lastOk: { at: NOW - 2 * 60 * 1000, sessionId: 'sid-A', fromSid: 'sid-A', model: 'm1' } })) })
  h1.show(); h1.runEffects(); await h1.settle()
  const v1 = h1.show()
  const conf = confirmOf(v1)
  ok(!!conf, '①-1 ★★核心：armed(0.9 ≥ 0.75) + 2 分钟前历史 lastOk ⇒ confirmation 非空（旧实现必红）ratio=' + (conf && conf.ratio))
  ok(Number(conf && conf.ring) === 90 && Number(conf && conf.wall) === 90, '①-2 卡片字段完整（ring/wall 一并拷入，防 09-10 双口径回归）')
  ok(Number(v1 && v1.props && v1.props.countdown) > 0, '①-3 倒计时照常透出（' + (v1 && v1.props && v1.props.countdown) + 's）')
  const st = statusOf(v1)
  ok(!st || st.indexOf(CHECK) !== 0, '①-4 历史成功文案让位、不覆盖确认卡（status=' + JSON.stringify(st) + '）')
}

console.log('[A2-②] #288 守恒：无 armed ⇒ 成功提示语义逐字不变')
{
  const h2 = mount(SRC, { sid: 'sid-A', apiGet: (u) => Promise.resolve(u === '/c' ? cfg : okState()) })
  h2.show(); h2.runEffects(); await h2.settle()
  const v2 = h2.show()
  ok(!confirmOf(v2), '②-1 无 armed ⇒ 无确认卡')
  const s2 = statusOf(v2)
  ok(!!s2 && s2.indexOf(CHECK) === 0 && s2.indexOf('m1') > 0, '②-2 成功提示照常（含模型/档位展示，status=' + JSON.stringify(s2) + '）')
}

console.log('[A2-③] #289 乱序回写：迟到响应不得复活已消失的确认卡')
{
  // ★请求可定位性说明：load 与 poll 走**同一个 URL**（/s），故不能靠 URL 区分；
  //   靠**创建顺序**定位 —— 每一轮 setInterval 触发时，load 的 interval 先注册（先发），
  //   poll 的 interval 后注册（后发）⇒ 该轮**最后一个** pending 即 poll 的请求。
  const pending = []
  const h3 = mount(SRC, { sid: 'sid-A', apiGet: (u) => { if (u === '/c') return Promise.resolve(cfg); const box = {}; box.n = pending.length; box.promise = new Promise((res) => { box.res = res }); pending.push(box); return box.promise } })
  h3.show(); h3.runEffects(); await sleep()
  ok(pending.length >= 1, '③-1 首次 load 请求已发出（pending=' + pending.length + '）')
  pending[0].res(okState({ armed: null })); await sleep(); await sleep()
  h3.show()
  // 第 1 轮：本轮最后一个 pending = poll#1（armed）——**故意留在途**
  await h3.poll(); h3.show(); await sleep()
  const poll1 = pending[pending.length - 1]
  ok(pending.length >= 3, '③-2 第 1 轮 poll 请求已发出（pending=' + pending.length + '）')
  // 第 2 轮：本轮最后一个 pending = poll#2（无 armed）
  await h3.poll(); h3.show(); await sleep()
  const poll2 = pending[pending.length - 1]
  ok(poll2 !== poll1, '③-3 第 2 轮 poll 请求是新的一次（代次递增，两对象不同）')
  // 先回**最新**的 poll#2（无 armed）⇒ 卡不得存在
  poll2.res(okState({ armed: null })); await sleep(); await sleep()
  const vNewest = h3.show()
  ok(!confirmOf(vNewest), '③-4 最新响应无 armed ⇒ 无确认卡（基线）')
  // 再回**迟到**的 poll#1（armed）⇒ 必须被丢弃；旧实现会据此把卡复活
  poll1.res(armedState()); await sleep(); await sleep()
  const vLate = h3.show()
  ok(!confirmOf(vLate), '③-5 ★核心：迟到的旧 armed 响应不得复活已消失的确认卡（旧实现必红）conf=' + JSON.stringify(confirmOf(vLate)))
}

console.log('[A2-④] #289 会话身份：迟到响应不得把用户切走的会话拉走')
{
  const opened = []
  let cur = 'sid-A'
  const pending = []
  const h4 = mount(SRC, {
    sessions: { open: (id) => opened.push(id) },
    sidOf: () => cur,
    apiGet: (u, q) => {
      if (u === '/c') return Promise.resolve(cfg)
      const box = { q: q }; box.promise = new Promise((res) => { box.res = res }); pending.push(box); return box.promise
    },
  })
  h4.show(); h4.runEffects(); await sleep()
  ok(opened.length === 0, '④-1 首次轮询（sid=A，无 lastOk）不跳转')
  // A 的迟到响应回来了，但用户已切到 B
  cur = 'sid-B'
  pending[0].res(okState({ lastOk: { at: NOW - 5000, sessionId: 'sid-A-next', fromSid: 'sid-A', model: 'm1' } }))
  await sleep(); await sleep()
  h4.show()
  ok(opened.length === 0, '④-2 ★核心：A 的迟到响应到达时当前会话已是 B ⇒ 不得把 B 拉走（opened=' + JSON.stringify(opened) + '）')
  // 守恒：未切会话时该跳转**照样跳**
  const opened2 = []
  const h5 = mount(SRC, {
    sessions: { open: (id) => opened2.push(id) },
    sidOf: () => 'sid-A',
    apiGet: (u) => Promise.resolve(u === '/c' ? cfg : okState({ lastOk: { at: NOW - 5000, sessionId: 'sid-A-next', fromSid: 'sid-A', model: 'm1' } })),
  })
  h5.show(); h5.runEffects(); await h5.settle()
  ok(opened2.length === 1, '④-3 ★守恒：未切会话（sid=A 且 fromSid=A）⇒ 该跳转照常发生（opened=' + JSON.stringify(opened2) + '）')
  ok(opened2.length === 1 && opened2[0] === 'sid-A-next', '④-4 跳转目标 = 后继会话 id（opened[0]=' + opened2[0] + '）')
}

console.log('[A2-⑥] #289 第二层：响应处理途中会话被切走 ⇒ 跳转前重读必须拦住')
{
  // 为什么需要这一节：④ 里「迟到响应」被**第一层**（代次/身份收口）就丢弃了，
  //   于是第四道闸（跳转前重读 sidNowJump）永远走不到 ⇒ 只变异它不会变红（实测 18/0）。
  //   本节用「会话可在一次响应处理途中改变」的受控取到值把**第二层单独照出来**：
  //   第一层读到 sid-A（放行），跳转前重读读到 sid-B（应拦住）。
  const opened = []
  const trail = []
  //   读点顺序（实测 5 处 currentSessionIdClient 引用）：①load 取 sidQ ②poll 取 sidQ
  //   ③load 响应里的身份复核 ④poll 的 acFresh 复核 ⑤跳转前重读。
  //   前四处必须都是 sid-A（放行到跳转），**第五处**才切成 sid-B。
  const script = ['sid-A', 'sid-A', 'sid-A', 'sid-A', 'sid-B']
  let n = 0
  const h6 = mount(SRC, {
    sessions: { open: (id) => opened.push(id) },
    sidOf: () => { const v = n < script.length ? script[n] : 'sid-B'; trail.push(v); n++; return v },   // 逐次读点
    apiGet: (u) => Promise.resolve(u === '/c' ? cfg : okState({ lastOk: { at: NOW - 5000, sessionId: 'sid-A-next', fromSid: 'sid-A', model: 'm1' } })),
  })
  h6.show(); h6.runEffects(); await h6.settle(); h6.show()
  ok(trail.length >= 5, '⑥-1 取到值序列已覆盖五层读点（trail=' + JSON.stringify(trail) + '）')
  ok(trail.slice(0, 4).every((v) => v === 'sid-A'), '⑥-2 前四层读到 sid-A（放行到跳转）')
  ok(trail.indexOf('sid-B') >= 0, '⑥-3 跳转前重读读到 sid-B（会话已切走）')
  ok(opened.length === 0, '⑥-4 ★核心：跳转前重读发现会话已切走 ⇒ 不得跳转（旧实现用请求期 sidQ，必红）opened=' + JSON.stringify(opened))
}

console.log('[A2-⑤] 夹具开缝自检：sessions / currentSessionIdClient 必须真的进得了组件体闭包')
{
  const h = mount(SRC, { sessions: { open: () => {} }, sidOf: () => 'sid-X' })
  ok(h.body.indexOf('sessions') >= 0, '⑤-1 真组件体引用 sessions（可补桩）')
  ok(h.body.indexOf('currentSessionIdClient') >= 0, '⑤-2 真组件体引用 currentSessionIdClient（身份可驱动）')
  h.show(); h.runEffects()
  await sleep()
  ok(true, '⑤-3 注入替身挂载不抛（开缝可用）')
}

console.log('')
console.log('[A2] 结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
