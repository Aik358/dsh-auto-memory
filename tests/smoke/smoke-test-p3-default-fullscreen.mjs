/**
 * smoke-test-p3-default-fullscreen.mjs —— P3「默认全屏」+ IO 撤销判据（#533）+ 身份轮询（#532）
 *
 * 本套件用**真执行**验收：把 skins/iter5/*.js 里那段源码**切片**出来，喂给 vm 真跑并断言副作用，
 * 不再手写一份「逻辑复刻」当替身（旧版第 39-81 行就是手写复刻：源码改了它也不会红）。
 *
 * 守七件事：
 *   N1 挂载后**立即** mark(true)（不等 IO 回调）——「进白板页即全屏」
 *   N2 #533：**单次** isIntersecting=false ⇒ 250ms 有上界复核后摘标记
 *         （旧判据「连续 2 次不可见」等于在等一个 IO 不保证会再发的事件 —— 实测永不摘）
 *   N3 过渡帧（<250ms 内恢复可见）不得闪掉标记；isIntersecting=true 必须 clearTimeout
 *   N4 cleanup 必然 mark(false)，并且清掉待复核定时器（无悬挂 timer）
 *   N5 多 page 引用计数：只删自己，全部不可见才摘标记（防「对话页打不了字」）
 *   N6 闸门：挂载时不可见（对话页）不得打标；变异（去掉闸门）必红
 *   N7 #532 身份轮询：setter 被调用 1 次且收到**更新函数**；同值 bail out 不重渲染
 *
 * ★归因（独立注释行，不塞进被测字符串）：
 *   本套件旧版 :35 / :88 / :110 三条断言把 #533 的**缺陷行为**钉成了绿
 *   （「单次不可见不摘标记」「missStreak>=2」「client.js 已含 missStreak」）。
 *   #533 修复后这三条判据过期：按「单次不可见 + 250ms 后应摘标记」重写，
 *   并把「产物里有某字符串」降级为 stale-aware 的存在性守卫（生成区同步的真权威是
 *   node tools/build-iter5-skin.mjs --check 的逐字节比对）。判据意图不变：功能必须真跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ★#507（2026-11-02）：ROOT 由**本文件位置**派生，而不是写死维护者本机路径。
//   旧写法把 ROOT 写成维护者本机的绝对路径，在 CI（ubuntu）与任何非本机检出下都读不到文件，
//   套件因此必红 —— 而那不是产品缺陷，是测试不可移植。**不要改回 process.cwd()**：
//   run-smoke 的工作目录、开发者 shell 的 cwd 都不保证是仓库根。
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const NL = String.fromCharCode(10)
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, NL)
const SURF = read('skins/iter5/surfaces.js')
const UI = read('skins/iter5/ui.js')
const CL = read('lib/client.js')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   - ' + m + (x ? ' :: ' + x : '')) } else { fail++; console.log('  FAIL - ' + m + (x ? ' :: ' + x : '')) } }
const countOf = (text, needle) => text.split(needle).length - 1

// ═══════════════════════════════════════════════════════════════════════════════
// 0. 源码切片器（内容锚定；锚点变动会**响亮失败**，不会静默绿）
// ═══════════════════════════════════════════════════════════════════════════════
const MOD_HEAD = '    var EV4_VISIBLE_PAGES = (typeof Set === ' + "'" + 'function' + "'" + ') ? new Set() : null'
const MOD_TAIL = '      } catch (e) { /* fail-soft：DOM 不可用时不抛 */ }' + NL + '    }'
const EFF_HEAD = '      useEffect(function () {' + NL + "        if (props.kind !== 'page') return"
const EFF_TAIL = '      }, [props.kind])'

/** 模块级 EV4_VISIBLE_PAGES + ev4SyncFullpageAttr（真源码切片）。 */
function extractFullpageModule (text) {
  if (countOf(text, MOD_HEAD) !== 1) return null
  if (countOf(text, MOD_TAIL) !== 1) return null
  const i = text.indexOf(MOD_HEAD)
  const j = text.indexOf(MOD_TAIL, i)
  return j < 0 ? null : text.slice(i, j + MOD_TAIL.length)
}

/** 「全屏标记」那个 useEffect 的**函数体**（真源码切片，不含 useEffect 外壳）。 */
function extractMarkEffectBody (text) {
  if (countOf(text, EFF_HEAD) !== 1) return null
  const i = text.indexOf(EFF_HEAD)
  const start = i + '      useEffect(function () {'.length
  const j = text.indexOf(EFF_TAIL, start)
  return j < 0 ? null : text.slice(start, j)
}

/** 按行锚点 + 逐字符配平抽函数（跳过 // 行注释与字符串里的括号）。 */
function extractFnByLine (text, name) {
  const lines = String(text).split(NL)
  const head = new RegExp('^\\s*function ' + name + '\\s*\\(')
  let start = -1
  for (let i = 0; i < lines.length; i += 1) if (head.test(lines[i])) { start = i; break }
  if (start < 0) return null
  let depth = 0, started = false
  const out = []
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]
    out.push(line)
    let inS = 0, q = '', esc = false
    for (let k = 0; k < line.length; k += 1) {
      const c = line[k]
      if (inS) {
        if (esc) { esc = false; continue }
        if (c === '\\') { esc = true; continue }
        if (c === q) inS = 0
        continue
      }
      if (c === '/' && line[k + 1] === '/') break
      if (c === '"' || c === "'") { inS = 1; q = c; continue }
      if (c === '{') { depth += 1; started = true; continue }
      if (c === '}') { depth -= 1; if (started && depth === 0) return out.join(NL) }
    }
  }
  return null
}

console.log('')
console.log('== 0. 真源码切片（锚点存在性 = 守卫，不是功能证据）==')
const MOD_SEG = extractFullpageModule(SURF)
const EFF_BODY = extractMarkEffectBody(SURF)
const SYNC_UI = extractFnByLine(UI, 'iter5SyncIdentityIfChanged')
const SYNC_SURF = extractFnByLine(SURF, 'iter5SyncIdentityIfChanged')
const IDENTITY_FN = extractFnByLine(UI, 'iter5Identity')
ok(!!MOD_SEG && MOD_SEG.length > 400, '★★切出 EV4_VISIBLE_PAGES + ev4SyncFullpageAttr（surfaces.js 真源码）', 'len=' + (MOD_SEG ? MOD_SEG.length : 0))
ok(!!EFF_BODY && EFF_BODY.length > 2000, '★★切出「全屏标记」useEffect 的函数体（surfaces.js 真源码）', 'len=' + (EFF_BODY ? EFF_BODY.length : 0))
ok(!!SYNC_UI && !!SYNC_SURF, '★切出两份 iter5SyncIdentityIfChanged（ui.js / surfaces.js 真源码）', 'len=' + (SYNC_UI ? SYNC_UI.length : 0) + '/' + (SYNC_SURF ? SYNC_SURF.length : 0))
ok(!!IDENTITY_FN, '★切出 iter5Identity（ui.js 真源码）', 'len=' + (IDENTITY_FN ? IDENTITY_FN.length : 0))
if (!MOD_SEG || !EFF_BODY || !SYNC_UI || !SYNC_SURF || !IDENTITY_FN) {
  console.log('')
  console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
  process.exit(1)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 受控世界：真 module 级 Set + 可挂多个 page surface + 假时钟 + 受控 IO
// ═══════════════════════════════════════════════════════════════════════════════
function createWorld (source, opts) {
  opts = opts || {}
  const modSeg = extractFullpageModule(source)
  const bodySeg = extractMarkEffectBody(source)
  if (!modSeg || !bodySeg) throw new Error('切片失败（锚点缺失）：source len=' + source.length)
  const attrs = Object.create(null)
  const timers = []
  let timerSeq = 0, clock = 0, surfaceSeq = 0
  const ios = []
  const sandbox = {
    document: {
      body: {
        setAttribute (k, v) { attrs[k] = String(v) },
        removeAttribute (k) { delete attrs[k] },
        getAttribute (k) { return k in attrs ? attrs[k] : null }
      }
    },
    getComputedStyle (node) { return (node && node.__cs) || { display: 'block', visibility: 'visible' } },
    setTimeout (fn, ms) {
      const id = ++timerSeq
      timers.push({ id, at: clock + (Number(ms) || 0), ms: Number(ms) || 0, fn })
      return id
    },
    clearTimeout (id) {
      const k = timers.findIndex((t) => t.id === id)
      if (k >= 0) timers.splice(k, 1)
    }
  }
  if (opts.io !== false) {
    sandbox.IntersectionObserver = function (cb) {
      this.__cb = cb
      this.__el = null
      this.disconnected = false
      this.observe = (el) => { this.__el = el }
      this.disconnect = () => { this.disconnected = true }
      ios.push(this)
    }
  }
  const ctx = vm.createContext(sandbox)
  vm.runInContext(modSeg, ctx)
  return {
    mount (visible) {
      const state = { visible: !!visible }
      const el = {
        id: 'PAGE#' + (++surfaceSeq),
        get offsetWidth () { return state.visible ? 1200 : 0 },
        get __cs () { return { display: state.visible ? 'block' : 'none', visibility: 'visible' } },
        closest (sel) {
          if (sel !== '[data-conversation-scroll]') return null
          return { clientHeight: state.visible ? 800 : 0 }
        }
      }
      sandbox.props = { kind: 'page' }
      sandbox.boundary = { current: el }
      const ioBefore = ios.length
      vm.runInContext('globalThis.__cleanup = (function () {' + bodySeg + NL + '})();', ctx)
      const cleanup = ctx.__cleanup
      return {
        el,
        setVisible (v) { state.visible = !!v },
        attr () { return 'data-dam-fullpage' in attrs ? attrs['data-dam-fullpage'] : null },
        pageCount () { return vm.runInContext('EV4_VISIBLE_PAGES.size', ctx) },
        hasIo () { return !!ios[ioBefore] },
        fire (entries) {
          const o = ios[ioBefore]
          if (!o || typeof o.__cb !== 'function') throw new Error('该 surface 没有 IntersectionObserver')
          o.__cb(entries)
        },
        cleanup () { if (typeof cleanup === 'function') cleanup() }
      }
    },
    advance (ms) {
      const target = clock + ms
      for (let guard = 0; guard < 10000; guard += 1) {
        let best = null
        for (const t of timers) if (t.at <= target && (!best || t.at < best.at)) best = t
        if (!best) break
        clock = best.at
        const k = timers.indexOf(best)
        if (k >= 0) timers.splice(k, 1)
        best.fn()
      }
      clock = target
    },
    pendingTimers () { return timers.map((t) => ({ id: t.id, ms: t.ms, dueAt: t.at })) },
    attr () { return 'data-dam-fullpage' in attrs ? attrs['data-dam-fullpage'] : null },
    pageCount () { return vm.runInContext('EV4_VISIBLE_PAGES.size', ctx) }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. N1/N5：挂载即全屏 + 引用计数
// ═══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== 1. ★真跑：挂载即全屏（不等 IO）==')
{
  const W = createWorld(SURF)
  const A = W.mount(true)
  ok(A.attr() === 'true', '★★★N1 挂载后**立即** body[data-dam-fullpage]=true（不等 IO 回调）', 'attr=' + A.attr())
  ok(W.pageCount() === 1, '★★N1 引用计数 Set 里有 1 个 page', 'size=' + W.pageCount())
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. N2/N3/N4：★#533 撤销判据（单次不可见 ⇒ 250ms 上界复核）
// ═══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== 2. ★#533：只收到**一次** isIntersecting=false（IO 之后不再回调）==')
{
  const W = createWorld(SURF)
  const A = W.mount(true)
  A.setVisible(false)
  A.fire([{ isIntersecting: false }])
  const pend = W.pendingTimers()
  console.log('     单次 false 后：attr=' + A.attr() + '  pendingTimers=' + JSON.stringify(pend))
  ok(pend.length === 1 && pend[0].ms === 250, '★★S2 单次不可见 ⇒ 排一个 250ms 的可见性复核（有上界，不依赖第二次回调）', JSON.stringify(pend))
  W.advance(249)
  ok(A.attr() === 'true', '★★N3 复核窗口内（<250ms）仍保留标记（过渡帧不闪）', 'attr=' + A.attr())
  W.advance(1)
  ok(A.attr() === null, '★★★N2 250ms 后仍不可见 ⇒ **摘标**（旧实现等第二次回调，而它永不发生）', 'attr=' + A.attr())
  ok(W.pageCount() === 0, '★★N2 引用计数同步清空（不再残留可见 page）', 'size=' + W.pageCount())
}
console.log('')
console.log('== 3. N3/N4：过渡帧不闪 + cleanup 清定时器 ==')
{
  const W = createWorld(SURF)
  const B = W.mount(true)
  B.setVisible(false)
  B.fire([{ isIntersecting: false }])
  W.advance(100)
  B.setVisible(true)
  B.fire([{ isIntersecting: true }])
  W.advance(1000)
  ok(B.attr() === 'true', '★★N3 过渡帧内恢复可见 ⇒ 标记保留（复核被取消，不误摘）', 'attr=' + B.attr())
  ok(W.pendingTimers().length === 0, '★★N3 isIntersecting=true 已 clearTimeout 待复核', JSON.stringify(W.pendingTimers()))
}
{
  const W = createWorld(SURF)
  const B = W.mount(true)
  B.setVisible(false)
  B.fire([{ isIntersecting: false }])
  B.cleanup()
  ok(W.pendingTimers().length === 0, '★★N4 cleanup 清掉待复核定时器（无悬挂 timer）', JSON.stringify(W.pendingTimers()))
  W.advance(1000)
  ok(B.attr() === null, '★★★N4 cleanup 后标记必摘（对话页可打字），且定时器不再回写', 'attr=' + B.attr())
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. N5：双 page 引用计数（只删自己）+ 无 IO 老环境
// ═══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== 4. N5：多 page 引用计数 ==')
{
  const W = createWorld(SURF)
  const C = W.mount(true), D = W.mount(true)
  ok(W.pageCount() === 2 && C.attr() === 'true', '★★N5 两个 page 同时可见', 'size=' + W.pageCount())
  C.setVisible(false)
  C.fire([{ isIntersecting: false }])
  W.advance(250)
  ok(C.attr() === 'true' && W.pageCount() === 1, '★★N5 只删自己：另一个 page 仍可见 ⇒ 标记保留', 'attr=' + C.attr() + ' size=' + W.pageCount())
  D.setVisible(false)
  D.fire([{ isIntersecting: false }])
  W.advance(250)
  ok(W.attr() === null && W.pageCount() === 0, '★★★N5 全部不可见 ⇒ 摘标（对话页 composer 必恢复）', 'attr=' + W.attr())
}
{
  const W = createWorld(SURF, { io: false })
  const E = W.mount(true)
  ok(E.attr() === 'true', '★★N5 无 IntersectionObserver 时挂载也打标（默认全屏）', 'attr=' + E.attr())
  E.cleanup()
  ok(E.attr() === null, '★★N5 无 IO 时 cleanup 必摘标', 'attr=' + E.attr())
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. N6：闸门（防「对话页打不了字」）
// ═══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== 5. N6：可见性闸门 ==')
{
  const W = createWorld(SURF)
  const G = W.mount(false)
  ok(G.attr() === null, '★★★N6 对话页（0 宽度）挂载 ⇒ 不得打标', 'attr=' + G.attr())
  ok(G.hasIo(), '★N6 即使不可见也注册了 IO（等它转可见时打标）')
  G.setVisible(true)
  G.fire([{ isIntersecting: true }])
  ok(G.attr() === 'true', '★★N6 转可见后 IO 正路径仍过闸门打标', 'attr=' + G.attr())
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. 变异：把撤销判据改回「连续 2 次不可见」⇒ N2 必红（判据有鉴别力）
// ═══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== 6. ★变异：撤销判据改回旧「missStreak>=2」⇒ N2 必红 ==')
const NEW_ELSE = [
  '            } else {',
  '              // 单次不可见：起 250ms 复核（不等待第二次回调 —— 它可能永不发生）',
  '              clearRecheck()',
  '              recheckTimer = setTimeout(function () {',
  '                recheckTimer = null',
  '                // 复核：期间若已恢复可见（IO 的 true 分支会 clearRecheck 并 mark(true)），',
  '                //   这里读到的 elLooksVisible() 为真 ⇒ 不摘标。',
  '                if (!elLooksVisible()) mark(false)',
  '              }, 250)',
  '            }'
].join(NL)
const OLD_ELSE = [
  '            } else {',
  '              missStreak += 1',
  '              // 连续 2 次不可见才认定「真的切走了」（首帧 0 尺寸只算 1 次）',
  '              if (missStreak >= 2) mark(false)',
  '            }'
].join(NL)
ok(countOf(SURF, NEW_ELSE) === 1, '★[变异装置] 新版 else 分支在源里恰命中 1 次（锚点没漂）', 'hits=' + countOf(SURF, NEW_ELSE))
const MUT_SRC = SURF
  .split(NEW_ELSE).join(OLD_ELSE)
  .split('        var recheckTimer = null').join('        var recheckTimer = null' + NL + '        var missStreak = 0')
ok(MUT_SRC !== SURF, '★★★[变异] 已把撤销判据改回「连续 2 次不可见」')
{
  const WM = createWorld(MUT_SRC)
  const A = WM.mount(true)
  A.setVisible(false)
  A.fire([{ isIntersecting: false }])
  WM.advance(1000)
  ok(WM.pendingTimers().length === 0, '★★[变异] 旧判据不排复核定时器（构造前提）', JSON.stringify(WM.pendingTimers()))
  ok(A.attr() === 'true', '★★★[变异必红] 旧判据下单次不可见 + 1000ms 仍**不摘标** ⇒ 上面 N2 判据必红', 'attr=' + A.attr())
}
ok(countOf(SURF, 'if (elLooksVisible()) mark(true)') >= 2, '★[变异装置] 闸门调用仍 >= 2 处（挂载 + IO 正路径）', 'count=' + countOf(SURF, 'if (elLooksVisible()) mark(true)'))
{
  const MUT_GATE = SURF.split('if (elLooksVisible()) mark(true)').join('mark(true)')
  ok(MUT_GATE !== SURF, '★★★[变异] 已去掉闸门（无条件 mark(true)）')
  const WM = createWorld(MUT_GATE)
  const G = WM.mount(false)
  ok(G.attr() === 'true', '★★★[变异必红] 无闸门时对话页（0 宽度）被打标 ⇒ N6 判据必红', 'attr=' + G.attr())
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. client.js 生成区（★stale-aware 守卫）：不许静默通过，也不许「修对了反而红」
// ═══════════════════════════════════════════════════════════════════════════════
// ★#533 归因（独立行）：旧判据断言 client.js 里存在 'missStreak >= 2'，那是把**缺陷行为**
//   钉成绿的产物断言 —— #533 修好后重生成产物里该串必然消失，旧断言会「修对了反而红」。
//   生成区同步的真权威是 node tools/build-iter5-skin.mjs --check（逐字节比对）；
//   本套件只做「产物里有没有这段逻辑」的存在性守卫，并且**区分三态**：
//     · 已同步（产物段 == 源段）                    ⇒ PASS
//     · 尚未重生成，且产物段确为**旧行为**形态        ⇒ PASS + STALE 提示（等 Lead 跑生成器）
//     · 其它（产物段缺失/形态不认识）                ⇒ FAIL
const clHasEffect = CL.indexOf('EV4_VISIBLE_PAGES') >= 0 && CL.indexOf('elLooksVisible') >= 0
ok(clHasEffect, '★★N7 client.js 生成区仍含全屏标记逻辑（EV4_VISIBLE_PAGES + elLooksVisible）')
{
  const clSeg = extractMarkEffectBody(CL)
  const srcSeg = extractMarkEffectBody(SURF)
  if (clSeg && srcSeg && clSeg === srcSeg) {
    ok(true, '★★N7 生成区这段逻辑已与源**逐字节一致**（已重生成）')
  } else {
    const isOldShape = !!clSeg && clSeg.indexOf('missStreak') >= 0 && clSeg.indexOf('recheckTimer') < 0
    ok(isOldShape, '★★N7 生成区落后于源（等 build-iter5-skin.mjs 重生成），且落后形态确为旧判据（不是坏产物）',
      'clSeg len=' + (clSeg ? clSeg.length : 0) + ' srcSeg len=' + (srcSeg ? srcSeg.length : 0))
    console.log('  note - STALE: 源与生成区不一致；同步权威 = node tools/build-iter5-skin.mjs --check')
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. ★#532 身份轮询：字符串不再被当函数调用
// ═══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== 7. ★#532：身份轮询（500ms）setter 被调用 1 次，同值 bail out ==')

/** React useState setter 语义（React 18：函数式更新返回同一引用 ⇒ bail out，不提交渲染）。 */
function makeStore (initial) {
  const st = { value: initial, calls: 0, commits: 0, types: [] }
  st.setter = function (arg) {
    st.calls += 1
    st.types.push(typeof arg)
    if (typeof arg === 'function') {
      const prev = st.value
      const next = arg(prev)
      if (next === prev) return
      st.value = next
      st.commits += 1
      return
    }
    if (arg === st.value) return
    st.value = arg
    st.commits += 1
  }
  return st
}

function makeSyncWorld (syncSrc, sid, ws) {
  const sandbox = {
    currentSessionIdClient () { return sandbox.__sid },
    currentWs () { return sandbox.__ws }
  }
  sandbox.__sid = sid
  sandbox.__ws = ws
  const ctx = vm.createContext(sandbox)
  vm.runInContext(IDENTITY_FN + NL + syncSrc + NL + 'globalThis.__sync = iter5SyncIdentityIfChanged;', ctx)
  return { ctx, sandbox, sync: ctx.__sync }
}

ok(SYNC_UI === SYNC_SURF, '★★N7 两份定义（ui.js / surfaces.js）逐字相同（不留「改一处漏一处」的半修）', SYNC_UI === SYNC_SURF ? 'identical' : 'differs')
{
  const W = makeSyncWorld(SYNC_UI, 's1', 'w1')
  const st = makeStore('s1|w1')
  W.sandbox.__sid = 's2'; W.sandbox.__ws = 'w2'
  W.sync(st.setter)
  ok(st.calls === 1, '★★N7 身份变化 ⇒ setter 被调用 1 次', 'calls=' + st.calls)
  ok(st.types[0] === 'function', '★N7 传给 setter 的是**更新函数**（不是字符串）', 'typeof=' + st.types[0])
  ok(st.value === 's2|w2' && st.commits === 1, '★★N7 身份确实更新为 s2|w2（提交 1 次）', 'value=' + st.value + ' commits=' + st.commits)

  const st2 = makeStore('s2|w2')
  W.sync(st2.setter)
  ok(st2.calls === 1 && st2.commits === 0, '★★★N7 同一身份 ⇒ setter 被调 1 次但**提交 0 次**（React bail out，无渲染风暴）', 'calls=' + st2.calls + ' commits=' + st2.commits)

  // 真实调用点形态：旧调用点第二个实参就是状态值（字符串）
  const st3 = makeStore('s1|w1')
  W.sandbox.__sid = 's3'; W.sandbox.__ws = 'w3'
  W.sync(st3.setter, 's1|w1')
  ok(st3.calls === 1, '★★★N7 第二实参为**字符串**时 setter 仍被调用 1 次（旧实现此处 0 次：TypeError 被吞）', 'calls=' + st3.calls)
  ok(st3.value === 's3|w3', '★★N7 该形态下身份确实更新为 s3|w3', 'value=' + st3.value)

  const st4 = makeStore('s3|w3')
  for (let i = 0; i < 20; i += 1) W.sync(st4.setter)
  ok(st4.calls === 20 && st4.commits === 0, '★★N7 20 次同值轮询 ⇒ 提交 0 次（500ms 轮询不产生渲染）', 'calls=' + st4.calls + ' commits=' + st4.commits)
}

// 调用点：从文件里取**实参原文**，再拿真函数真执行一次
console.log('')
console.log('== 8. ★#532：调用点实参（真执行文件里的实参原文）==')
function callArgsOf (text, label) {
  // 定义行也是同一个名字；调用点在其之后 ⇒ 取**最后一次**出现
  const at = text.lastIndexOf('iter5SyncIdentityIfChanged(')
  if (at < 0) throw new Error('call site missing: ' + label)
  const rest = text.slice(at + 'iter5SyncIdentityIfChanged('.length)
  const close = rest.indexOf(')')
  if (close < 0) throw new Error('call site unterminated: ' + label)
  return rest.slice(0, close)
}
function runCallSite (argsText, syncSrc) {
  const W = makeSyncWorld(syncSrc, 'cx', 'cw')
  const seen = []
  const spy = function () { seen.push(Array.prototype.slice.call(arguments)) }
  W.sandbox.identityState = ['cx|cw', spy]
  W.sandbox.identity = ['cx|cw', spy]
  vm.runInContext('iter5SyncIdentityIfChanged(' + argsText + ')', W.ctx)
  return seen
}
{
  const uiArgs = callArgsOf(UI, 'ui.js')
  const surfArgs = callArgsOf(SURF, 'surfaces.js')
  console.log('     ui.js 调用实参：' + uiArgs + '    surfaces.js 调用实参：' + surfArgs)
  for (const [label, argsText, syncSrc] of [['ui.js', uiArgs, SYNC_UI], ['surfaces.js', surfArgs, SYNC_SURF]]) {
    const seen = runCallSite(argsText, syncSrc)
    ok(seen.length === 1 && seen[0].length === 1, '★★★N7 ' + label + ' 调用点只传 1 个实参（setter）', 'args=' + JSON.stringify(seen.map((a) => a.length)))
    ok(seen.length === 1 && typeof seen[0][0] === 'function', '★★N7 ' + label + ' 调用点传入的是更新函数', 'typeof=' + (seen[0] ? typeof seen[0][0] : 'n/a'))
  }
}

// 变异：旧实现（取自 HEAD 的记录值；git 可用时逐字核对）
console.log('')
console.log('== 9. ★#532 变异：还原旧实现 ⇒ N7 必红 ==')
const OLD_FN = [
  '    function iter5SyncIdentityIfChanged(setter, readState) {',
  '      try {',
  '        var next = iter5Identity()',
  "        if (next === String((readState && readState()) || '')) return",
  '        setter(next)',
  '      } catch (e) { /* fail-soft */ }',
  '    }'
].join(NL)
const OLD_ARGS = 'identityState[1], identityState[0]'
// ★注意（判据不得随提交时序变红）：一旦本修复被提交，HEAD 里就是**新**实现，
//   所以「HEAD == 记录的旧实现」只能作为**佐证**（HEAD 仍是旧实现时核对一次），
//   不能作为必过断言 —— 否则提交当天本套件会因为「修好了」而红。这与 #533 归因同源。
try {
  const headUi = String(execFileSync('git', ['show', 'HEAD:skins/iter5/ui.js'], { cwd: ROOT, encoding: 'utf8' })).replace(/\r\n/g, NL)
  const headFn = extractFnByLine(headUi, 'iter5SyncIdentityIfChanged')
  const headArgs = callArgsOf(headUi, 'HEAD ui.js')
  if (headFn === OLD_FN && headArgs === OLD_ARGS) {
    ok(true, '★[变异装置] HEAD 仍是旧实现，记录中的旧形态与其逐字一致（变异前提有据）', 'HEAD = ' + OLD_ARGS)
  } else {
    console.log('  note - HEAD 已不是旧实现（修复已提交），跳过逐字核对；变异仍用记录值 ' + JSON.stringify(OLD_ARGS))
    ok(headFn !== OLD_FN || headArgs !== OLD_ARGS, '★★N7 HEAD 版本已不是旧形态（修复已落地并提交）', 'HEAD args=' + headArgs)
  }
} catch (e) {
  console.log('  note - git 不可用，跳过 HEAD 逐字核对（变异仍用记录值）：' + (e && e.message))
}
ok(SYNC_UI !== OLD_FN, '★★★N7 当前实现已不是旧实现（#532 已落地）')
{
  const seen = runCallSite(OLD_ARGS, OLD_FN)
  ok(seen.length === 0, '★★★[变异必红] 旧实现 + 旧调用点（真实生产形态）⇒ setter **0 次** ⇒ N7 判据必红', 'calls=' + seen.length)
  const W = makeSyncWorld(OLD_FN, 's1', 'w1')
  const st = makeStore('s1|w1')
  W.sandbox.__sid = 's2'; W.sandbox.__ws = 'w2'
  W.sync(st.setter, 's1|w1')
  ok(st.calls === 0, '★★★[变异必红] 旧实现 + 字符串第二实参 ⇒ setter 0 次（TypeError 被 try/catch 吞掉）', 'calls=' + st.calls)
  const st2 = makeSyncWorld(OLD_FN, 's1', 'w1')
  const s2 = makeStore('s1|w1')
  st2.sync(s2.setter)
  ok(s2.types[0] === 'string', '★★[变异必红] 旧实现即使能跑通也传**字符串**而不是更新函数（双契约）', 'typeof=' + s2.types[0])
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)
