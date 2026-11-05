#!/usr/bin/env node
/**
 * smoke-test-upgrade-surface-arbitration.mjs —— 批2（2026-11-05）**真渲染互斥**验收。
 *
 * ## 批1 与批2 的分工
 * 批1 证明了**判据本身**对（upgradeSurfaceOwnerPre，58 条）。
 * 批2 要证明的是**接线正确**：两个组件真的按同一判据互斥渲染。所以本套件不看纯函数，
 * 而是**从两个组件的真实源码里抽出可见性判定链**，在 vm 里真跑，断言「恰好一个可见」。
 *
 * ## 为什么必须真执行（不是源码字符串断言）
 * 若只 grep 'owner === team-card'，删掉 `&& surfaceVerdict.owner === ...` 后断言仍绿。
 * 本套件把 `wantShow` / `show` 那几行连同 owner 调用整段抽出来跑，判据是**运行结果**。
 *
 * ## 三层验证
 *   ① 判定链真执行：从源码抽 `wantShow ... var show = ...`，对 fixture 逐组跑（T 组）
 *   ② 互斥穷举：全状态组合下两组件可见性**从不同真**（X 组）
 *   ③ 负路径变异：把 show 退回旧的 `canUpgrade||running||sticky` ⇒ 重合组合必须出现（V 组）
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => { const g = String(a) === String(b); ok(g, m + (g ? '' : '（实测 ' + String(a) + ' ≠ 期望 ' + String(b) + '）')) }

console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / sha256[:16] ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16))

/** 抽 `function name(...) {...}` 声明体（CRLF 归一，批0/批1 实测坑）。 */
function extractFn (signature) {
  const start = SRC.indexOf(signature)
  if (start < 0) return null
  let i = SRC.indexOf('{', start), d = 0, end = -1
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { end = i + 1; break } } }
  if (end <= start) return null
  return SRC.slice(start, end).replace(/\r\n/g, '\n')
}
/** ★函数声明 → 对象字面量的方法简写（去 function 前缀；批1 实测：声明不能直接放进字面量）。 */
function asMethod (b) { return b.replace(/^function\s+/, '') }

const ownerBody = extractFn('function upgradeSurfaceOwnerPre(input) {')
ok(!!ownerBody, 'F-1 能抽出 upgradeSurfaceOwnerPre')

// ── 从**真实源码**抽出团队卡片的可见性判定链 ─────────────────────────────────
const CARD_HEAD = 'var wantShow = !!status.canUpgrade || phase === \'running\' || sticky'
const CARD_TAIL = "var show = wantShow && surfaceVerdict.owner === 'team-card'"
const ci = SRC.indexOf(CARD_HEAD)
const cj = SRC.indexOf(CARD_TAIL)
ok(ci > 0, 'F-2a 团队卡片判定链起点在场（wantShow 那行）')
ok(cj > ci, 'F-2b 团队卡片判定链终点在场（show = wantShow && owner 那行）')
const cardChain = ci > 0 && cj > ci ? SRC.slice(ci, cj + CARD_TAIL.length).replace(/\r\n/g, '\n') : ''

// ── 从真实源码抽出向导的自动触发闸门片段 ─────────────────────────────────────
const WIZ_HEAD = 'var ownerV = upgradeSurfaceOwnerPre({'
const WIZ_TAIL = "if (ownerV.owner !== 'wizard') return"
const wi = SRC.indexOf(WIZ_HEAD)
const wj = SRC.indexOf(WIZ_TAIL)
ok(wi > 0, 'F-3a 向导判定链起点在场（ownerV 调用）')
ok(wj > wi, 'F-3b 向导判定链终点在场（owner !== wizard 则 return）')
const wizChain = wi > 0 && wj > wi ? SRC.slice(wi, wj + WIZ_TAIL.length).replace(/\r\n/g, '\n') : ''

/**
 * 在 vm 里真跑两段判定链，返回 { card, wizard } 两个布尔。
 * ★判定链片段引用 status / phase / sticky / r 等**自由变量** ⇒ 必须种成 vm 内变量
 *   （不能用 arguments 技巧：片段不在函数体里）。
 * ★向导片段里的 `return` 是**合法**语法（在 IIFE 内）—— 不能靠 catch 判可见性，
 *   必须在片段之后置一个「已到达」标记（本套件第一版就在这里假绿过）。
 */
function renderBoth (state) {
  // ★P6（2026-11-05）：卡片判定链新增了 useState/useEffect（意图快照 + 挂载 take）
  //   ⇒ 抽取环境必须注入桩，否则 ReferenceError（这正是方案里预警的「SKIP 退化」形态）。
  //   ★桩要**真执行 effect**：意图 take 发生在挂载 effect 里，不跑就取不到意图。
  const hookStub = {
    __intentState: state.intent == null ? '' : state.intent,
  }
  const useStateStub = function (init) {
    // 只模拟「卡片的意图快照」这一个 state；其它 state 返回初值即可（本判定链不依赖它们）
    if (init === '') return [hookStub.__intentState, function (v) { hookStub.__intentState = v }]
    return [typeof init === 'function' ? init() : init, function () {}]
  }
  const useEffectStub = function (fn) { try { fn() } catch (e) {} }   // 挂载即执行（本链只需挂载那次）
  const cardCtx = vm.createContext({ console })
  vm.runInContext(
    'var _fns = {\n' + asMethod(ownerBody) + '\n};' +
    'var status = __st; var phase = __ph; var sticky = __sk;' +
    'var upgradeSurfaceOwnerPre = _fns.upgradeSurfaceOwnerPre;' +
    'var upgradeSurfaceTeamStickyNowPre = function () { return __ts === true };' +
    'var __intentLeft = __il;' +
    'var upgradeSurfaceTakeIntentPre = function () { var v = __intentLeft; __intentLeft = ""; return v };\n' +
    cardChain + '\nglobalThis.__cardVisible = (show === true);',
    Object.assign(cardCtx, {
      __st: state.status, __ph: state.phase, __sk: state.sticky, __ts: state.sticky === true,
      useState: useStateStub, useEffect: useEffectStub,
      __il: state.intent == null ? '' : state.intent,
    }))
  const cardVisible = cardCtx.__cardVisible === true

  // 源码在片段之前有一句：if (phase === 'running') { setOpen(true); setPage('progress'); return }
  //   ⇒ running 态**直接开进度页**，根本不走 owner 判据。必须把这条语义补回。
  if (state.phase === 'running') return { card: cardVisible, wizard: true }

  const wizCtx = vm.createContext({ console })
  vm.runInContext(
    'var _fns2 = {\n' + asMethod(ownerBody) + '\n};' +
    'var r = __r; var phase = __ph2;' +
    'var upgradeSurfaceOwnerPre = _fns2.upgradeSurfaceOwnerPre;' +
    'var upgradeSurfaceTeamStickyNowPre = function () { return __ts2 === true };' +
    'globalThis.__wizReached = false;' +
    '(function () {\n' + wizChain + '\nglobalThis.__wizReached = true;\n})();',
    Object.assign(wizCtx, { __r: state.r, __ph2: state.phase, __ts2: state.sticky === true }))
  return { card: cardVisible, wizard: wizCtx.__wizReached === true }
}

// ═══ T. Lead 点名的三组场景（真渲染互斥） ═══════════════════════════════════
console.log('')
console.log('== T. 真渲染互斥（三类场景） ==')
{
  // T-1 团队 + legacy + 非 sticky ⇒ 恰好一个可见，且是**团队卡片**
  // ★★V1 裁定（用户 2026-11-05）：「打开团队 Teamwork 功能的用户，应当**优先展示团队版**，
  //   两版之间可以相互切换，且没有负面影响」。
  //   ⇒ 团队 + legacy 的默认面由**向导**改为**团队卡片**（reason 改为 team-home-legacy）。
  //   ⇒ 本条是**有意修改**，不是回退：批2 时代码里 legacy 排在卡片之前，旧断言只是描述既成事实；
  //     V1 就是要推翻它。保留位置并**反向标注**，将来谁改回去会立刻红。
  const s1 = {
    status: { canUpgrade: true, teamMode: { mode: 'team' } },
    phase: 'idle', sticky: false,
    r: { ok: true, legacy: true, teamMode: { mode: 'team' }, phase: 'idle' },
  }
  const r1 = renderBoth(s1)
  eq(r1.card, true, '★★T-1a [V1 裁定后] {isTeam,legacy,sticky=false} ⇒ 团队卡片**可见**（团队优先；改回去立刻红）')
  eq(r1.wizard, false, '★★T-1b [V1 裁定后] 同场景 ⇒ 向导**不弹**（向导改为经卡片上 E1 进入）')
  eq((r1.card ? 1 : 0) + (r1.wizard ? 1 : 0), 1, '★★T-1c 恰好一个可见（互斥，不是两个都弹）—— V1 改值后互斥仍成立')

  // T-2 团队 + sticky + legacy + done ⇒ 团队卡片可见、向导不弹（#524）
  const s2 = {
    status: { canUpgrade: true, teamMode: { mode: 'team' } },
    phase: 'done', sticky: true,
    r: { ok: true, legacy: true, teamMode: { mode: 'team' }, phase: 'done' },
  }
  const r2 = renderBoth(s2)
  eq(r2.card, true, '★★T-2a {isTeam,sticky,legacy,done} ⇒ 团队卡片**可见**（#524 终态不卸载）')
  eq(r2.wizard, false, '★★T-2b 同场景 ⇒ 向导**不弹**（不抢前台）')
  eq((r2.card ? 1 : 0) + (r2.wizard ? 1 : 0), 1, '★★T-2c 恰好一个可见')

  // T-3 个人 + legacy ⇒ 向导可见、团队卡片不可见（个人版零回归）
  const s3 = {
    status: { canUpgrade: true, teamMode: { mode: 'personal' } },
    phase: 'idle', sticky: false,
    r: { ok: true, legacy: true, teamMode: { mode: 'personal' }, phase: 'idle' },
  }
  const r3 = renderBoth(s3)
  eq(r3.card, false, '★T-3a {personal,legacy} ⇒ 团队卡片不可见')
  eq(r3.wizard, true, '★T-3b {personal,legacy} ⇒ 向导可见（个人版零回归）')
  eq((r3.card ? 1 : 0) + (r3.wizard ? 1 : 0), 1, '★T-3c 恰好一个可见')

  // T-4 团队 + 无 legacy ⇒ 只剩卡片（发布/订阅面板），向导不弹
  const s4 = {
    status: { canUpgrade: false, teamMode: { mode: 'team' } },
    phase: 'idle', sticky: false,
    r: { ok: true, legacy: false, teamMode: { mode: 'team' }, phase: 'idle' },
  }
  const r4 = renderBoth(s4)
  eq(r4.card, false, 'T-4a 团队无 legacy 且 wantShow=false ⇒ 卡片不可见（旧判据仍生效，未被 owner 放宽）')
  eq(r4.wizard, false, 'T-4b 团队无 legacy ⇒ 向导不弹')

  // ★T-6（Lead 批2 复核补强）：**done 后重新整理** —— 合法产品路径，不是「万一」
  //   终态 done ⇒ sticky 置位、卡片留前台（#524）；
  //   用户**又点一次「立即整理」** ⇒ phase 回到 running，而 sticky 仍为 true。
  //   ⇒ running + sticky 同时为真。此时应看**这一次的进度**，卡片（上一轮终态）必须让位。
  //   （穷举 X-1 本来就覆盖到了这组，但那是聚合计数；这条是**具名**断言，防将来改回顺序。）
  const s6 = {
    status: { canUpgrade: true, teamMode: { mode: 'team' } },
    phase: 'running', sticky: true,
    r: { ok: true, legacy: true, teamMode: { mode: 'team' }, phase: 'running' },
  }
  const r6 = renderBoth(s6)
  eq(r6.card, false, '★★T-6a [done 后重新整理] running+sticky ⇒ 团队卡片**不可见**（上一轮终态让位）')
  eq(r6.wizard, true, '★★T-6b [done 后重新整理] running+sticky ⇒ 向导**可见**（看这一次的进度）')
  eq((r6.card ? 1 : 0) + (r6.wizard ? 1 : 0), 1, '★★T-6c [done 后重新整理] 恰好一个可见')
  // 对照：同一份 sticky，只要 phase 回到 done，卡片就必须重新拿回前台（#524 未退化）
  const s6b = {
    status: { canUpgrade: true, teamMode: { mode: 'team' } },
    phase: 'done', sticky: true,
    r: { ok: true, legacy: true, teamMode: { mode: 'team' }, phase: 'done' },
  }
  const r6b = renderBoth(s6b)
  eq(r6b.card, true, '★★T-6d [对照] 同一 sticky + phase 回到 done ⇒ 卡片**重新可见**（#524 未被 T-6 推翻）')
  eq(r6b.wizard, false, '★★T-6e [对照] 同场景向导不弹')

  // T-5 团队 + running ⇒ 进度在向导
  const s5 = {
    status: { canUpgrade: false, teamMode: { mode: 'team' } },
    phase: 'running', sticky: false,
    r: { ok: true, legacy: false, teamMode: { mode: 'team' }, phase: 'running' },
  }
  const r5 = renderBoth(s5)
  eq(r5.card, false, 'T-5a 团队 + running ⇒ 卡片不可见')
  eq(r5.wizard, true, 'T-5b 团队 + running ⇒ 向导可见（进度页）')
}

// ═══ X. 互斥穷举：任何状态都不允许两组件同时可见 ══════════════════════════
console.log('')
console.log('== X. 互斥穷举 ==')
{
  const combos = []
  for (const mode of ['team', 'personal']) {
    for (const legacy of [true, false]) {
      for (const phase of ['idle', 'running', 'done', 'failed']) {
        for (const sticky of [true, false]) {
          combos.push({
            status: { canUpgrade: legacy, teamMode: { mode } },
            phase, sticky,
            r: { ok: true, legacy, teamMode: { mode }, phase },
          })
        }
      }
    }
  }
  let bothVisible = 0, neitherVisible = 0
  const overlaps = []
  for (const c of combos) {
    const v = renderBoth(c)
    if (v.card && v.wizard) { bothVisible++; overlaps.push(c) }
    if (!v.card && !v.wizard) neitherVisible++
  }
  eq(bothVisible, 0, '★★X-1 穷举 ' + combos.length + ' 组状态 ⇒ **零**个两组同时可见（叠加缺陷的回归锁）')
  ok(overlaps.length === 0, 'X-1b 重合清单为空（若不是空，下面会打印具体组合）')
  if (overlaps.length) console.log('        重合组合：' + JSON.stringify(overlaps.slice(0, 3)))
  // 「都不可见」是合法的（例如团队已无 legacy 且无 sticky、向导也无触发条件）—— 只记录不判红
  console.log('        其中「两组都不可见」= ' + neitherVisible + ' 组（合法：没有需要显示的东西）')
}

// ═══ X2. 套件内变异：去掉 owner 收窄 ⇒ 重合必然出现（Lead 指定的回归锁）═══
console.log('')
console.log('== X2. 套件内变异：owner 收窄失效 ⇒ 重合必现 ==')
{
  // 直接从真实链构造「失效版」：wantShow || (wantShow && owner)
  //   —— 与源码里 `show = wantShow && owner==='team-card'` 只差收窄是否生效，
  //     用来证明 X-1 测的是**收窄**这个行为，而不是夹具恒假。
  const mutatedChain = cardChain.replace(
    CARD_TAIL,
    "var show = (wantShow && surfaceVerdict.owner === 'team-card') || wantShow",
  )
  ok(mutatedChain !== cardChain, 'X2-0 [变异] 能构造出收窄失效版')
  // ★P6：与 renderBoth 同款注入（useState/useEffect + takeIntent 桩）
  const runCardChain = (chain, st) => {
    const c = vm.createContext({ console })
    vm.runInContext('var _fns = {\n' + asMethod(ownerBody) + '\n};' +
      'var status = __st; var phase = __ph; var sticky = __sk;' +
      'var upgradeSurfaceOwnerPre = _fns.upgradeSurfaceOwnerPre;' +
      'var upgradeSurfaceTeamStickyNowPre = function () { return __ts === true };' +
      'var __intentLeft = "";' +
      'var upgradeSurfaceTakeIntentPre = function () { var v = __intentLeft; __intentLeft = ""; return v };\n' +
      chain + '\nglobalThis.__v = (show === true);',
      Object.assign(c, {
        __st: st.status, __ph: st.phase, __sk: st.sticky, __ts: st.sticky === true,
        useState: (init) => [typeof init === 'function' ? init() : init, function () {}],
        useEffect: (fn) => { try { fn() } catch (e) {} },
      }))
    return c.__v === true
  }
  const s = {
    status: { canUpgrade: true, teamMode: { mode: 'team' } },
    phase: 'idle', sticky: false,
    r: { ok: true, legacy: true, teamMode: { mode: 'team' }, phase: 'idle' },
  }
  const mutCard = runCardChain(mutatedChain, s)
  const realCard = runCardChain(cardChain, s)
  const wiz = renderBoth(s).wizard
  // ★★V1 裁定（用户 2026-11-05）后的**保留骨架 + 反值**：
  //   V1 把「团队+legacy」的默认面从向导改成卡片 ⇒ realCard 由 false 变 true、wiz 由 true 变 false。
  //   **但变异的证明力必须保留**：失效版（去掉收窄）下仍必须能造出「卡片+向导同时可见」。
  //   ⇒ 换一个能区分两者的场景：团队 + **无 legacy** + 非 sticky。
  //      · 正常版：owner=team-card，wantShow=false（无 canUpgrade/running/sticky）⇒ 卡片**不可见**
  //      · 失效版（show=wantShow||...）：……wantShow 仍 false ⇒ 也不可见
  //     ⇒ 该场景区分不了。改用 **running** 场景（wantShow=true，owner 会判 wizard）：
  //      · 正常版：owner=wizard ⇒ show=false（卡片不可见），向导可见 ⇒ 互斥
  //      · 失效版：show=wantShow=true ⇒ 卡片可见，向导也可见 ⇒ **重合**
  const s2 = {
    status: { canUpgrade: false, teamMode: { mode: 'team' } },
    phase: 'running', sticky: false,
    r: { ok: true, legacy: false, teamMode: { mode: 'team' }, phase: 'running' },
  }
  const mutCard2 = runCardChain(mutatedChain, s2)
  const realCard2 = runCardChain(cardChain, s2)
  const wiz2 = renderBoth(s2).wizard
  eq(mutCard2, true, '★X2-1 [变异] running 下收窄失效 ⇒ 团队卡片可见（旧行为复现）')
  eq(realCard2, false, '★X2-2 [现实现] running 下有收窄 ⇒ 团队卡片**不可见**（进度归向导）')
  eq(wiz2, true, '★X2-3 同场景向导可见（running ⇒ 开进度页）')
  ok(mutCard2 === true && wiz2 === true, '★★X2-4 [变异证明] 失效版下卡片+向导**同时可见** = 叠加缺陷复现（骨架保留）')
  ok(realCard2 === false && wiz2 === true, '★★X2-5 [现实现] 互斥成立 ⇒ X-1 测的是真行为')
}

// ═══ V. 负路径变异：退回旧判据 ⇒ 重合必须出现 ═══════════════════════════
console.log('')
console.log('== V. 负路径变异：把 owner 判定撤回旧判据 ==')
{
  // 旧实现：show = canUpgrade || running || sticky（团队模式内）—— 完全不含 owner
  const legacyChain = cardChain.replace(CARD_TAIL, CARD_TAIL.replace('wantShow && surfaceVerdict.owner === \'team-card\'', 'wantShow'))
  const mutated = legacyChain !== cardChain
  ok(mutated, 'V-0 [变异] 能构造出旧的 show 判据（否则变异无效）')
  if (mutated) {
    // ★P6：同款注入（useState/useEffect + takeIntent 桩）
    const runCard = (chain, st) => {
      const c = vm.createContext({ console })
      vm.runInContext('var _fns = {\n' + asMethod(ownerBody) + '\n};' +
        'var status = __st; var phase = __ph; var sticky = __sk;' +
        'var upgradeSurfaceOwnerPre = _fns.upgradeSurfaceOwnerPre;' +
        'var upgradeSurfaceTeamStickyNowPre = function () { return __ts === true };' +
        'var __intentLeft = "";' +
        'var upgradeSurfaceTakeIntentPre = function () { var v = __intentLeft; __intentLeft = ""; return v };\n' +
        chain + '\nglobalThis.__v = (show === true);',
        Object.assign(c, {
          __st: st.status, __ph: st.phase, __sk: st.sticky, __ts: st.sticky === true,
          useState: (init) => [typeof init === 'function' ? init() : init, function () {}],
          useEffect: (fn) => { try { fn() } catch (e) {} },
        }))
      return c.__v === true
    }
    // ★★V1 裁定后必须**换场景**：原用「团队+legacy+idle」，但 V1 已把该场景的默认面改成卡片，
    //   旧判据与新判据在这里**结果相同**（都可见）⇒ 失去区分力。
    //   改用 running（wantShow=true 且 owner 判 wizard）：两条判据在此**必然分叉**。
    const s = {
      status: { canUpgrade: false, teamMode: { mode: 'team' } },
      phase: 'running', sticky: false,
      r: { ok: true, legacy: false, teamMode: { mode: 'team' }, phase: 'running' },
    }
    const oldCardVisible = runCard(legacyChain, s)
    eq(oldCardVisible, true, '★V-1 [变异] 旧判据下团队卡片**可见**（running ⇒ wantShow=true，无收窄）')
    const real = renderBoth(s)
    eq(real.card, false, '★V-2 [对照] 现实现下同场景团队卡片**不可见**（owner 判 wizard）')
    eq(real.wizard, true, '★V-3 [对照] 现实现下同场景向导可见')
    ok(oldCardVisible === true && real.card === false,
       '★★V-4 [变异证明] 旧判据 ⇒ 卡片可见；现判据 ⇒ 卡片不可见 ⇒ 收窄确实生效，X-1 测的是真行为')
    ok(oldCardVisible === true && real.wizard === true,
       '★★V-5 [变异证明] 旧判据下 卡片+向导**同时可见** = 叠加缺陷；现实现下互斥')
  }
}

console.log('')
console.log('[upgrade-surface-arbitration] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
