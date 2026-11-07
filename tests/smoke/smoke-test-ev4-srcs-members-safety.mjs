#!/usr/bin/env node
/**
 * smoke-test-ev4-srcs-members-safety.mjs —— 「本事件来源」块对 members / checkpoints 长度失配的安全性（真执行）
 *
 * 背景（2026-11-07 alpha.7）：
 *   原型运行时 renderDetail 的「本事件来源 · N 篇原始账本」块曾用 **members 条数**索引 checkpoints：
 *     for (var mi = 0; mi < Math.min(ev.members.length, 8); mi++) { var cp2 = ev.checkpoints[mi]; cp2.rel ... }
 *   ⇒ members.length > checkpoints.length 的事件必然抛
 *     TypeError: Cannot read properties of undefined (reading 'rel')
 *   该段无 try/catch ⇒ 异常冒到 select() ⇒ 理由 / 可追溯 / percept 三块与深链 replaceState 全丢。
 *   真实 store 实测 25 事件中 8 个 members > checkpoints。
 *
 * 本套件**不绑定修复层次**（payload 裁剪 / 原型 null-safe 两种都算通过），只锁三条用户可见不变量：
 *   ① 任何 members/checkpoints 组合都不得抛异常（崩溃即整块右栏丢失）；
 *   ② 来源条数不得被静默截断 —— 每一条 member 都要出现在渲染结果里（截断=用户看不到来源）；
 *   ③ 渲染行数 = min(members, 8)（8 是原型自己的上限，不改）。
 *
 * 真执行方式（照抄 smoke-test-client-loadable 的 vm / 源码抽取形态）：
 *   · 真 import lib/ev4-adapter.js 的 adaptStoreToPrototypePayload（生产适配层）；
 *   · 从 lib/client.js **真源码**按花括号配对抽出 ev4ProtoPayloadPre / ev4ProtoCheckpointPre / ev4ProtoDatePre，
 *     在 vm 里真调用；
 *   · 从 lib/client.js 的 EV4_PROTO_RUNTIME **字符串值**（= iframe 里真跑的那份）切出 srcs 块，用 new Function 真跑。
 *
 * 判据：
 *   A 正路径：11 种长度组合（含 members>cp / members<cp / cp=0 / members=0 / members=20）全部零异常。
 *   B 不截断：每个 member 路径都必须出现在渲染结果里（对应缺陷的「保来源」目标）。
 *   C 行数 = min(members,8)。
 *   D [负路径] 把同一块里可空解引用改回裸解引用 ⇒ members>cp 时必须抛 TypeError（判据非恒真）。
 *   E [负路径] 真实 store 的同批事件在「裸解引用」变体下必须崩 —— 证明本批数据真的会触发该缺陷。
 *   F 真实 store（存在才跑）：25 事件零崩溃、零截断。
 *   G 行尾守恒：lib/client.js 裸 LF = 0。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  ok   - ' + msg) } else { fail++; console.log('  FAIL - ' + msg + (extra ? ' :: ' + extra : '')) }
}

// ─── 源码抽取（花括号配对，同 client-loadable 手法） ───
function extractFn (src, name) {
  const key = 'function ' + name + '('
  const i = src.indexOf(key)
  if (i < 0) return null
  let depth = 0, started = false, j = i
  for (; j < src.length; j++) {
    const ch = src[j]
    if (ch === '{') { depth++; started = true } else if (ch === '}') { depth--; if (started && depth === 0) { j++; break } }
  }
  return src.slice(i, j)
}

// ─── 取 EV4_PROTO_RUNTIME 的字符串值，再切 srcs 块 ───
function runtimeValue (src) {
  const i0 = src.indexOf('var EV4_PROTO_RUNTIME = ')
  if (i0 < 0) return null
  const start = src.indexOf('"', i0)
  let end = start + 1, esc = false
  for (; end < src.length; end++) {
    const c = src[end]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') break
  }
  try { return JSON.parse(src.slice(start, end + 1)) } catch (e) { return null }
}

function el (tag, cls, text) {
  return { tag, cls, text, children: [], appendChild (c) { this.children.push(c); return c } }
}

const RUNTIME = runtimeValue(SRC)
ok(!!RUNTIME && RUNTIME.length > 10000, '[0] EV4_PROTO_RUNTIME 字符串值可从 client.js 解出（chars=' + (RUNTIME ? RUNTIME.length : 0) + '）')

const iSrcs = RUNTIME ? RUNTIME.indexOf('本事件来源') : -1
ok(iSrcs > 0, '[0] 运行时里存在「本事件来源」块')
const bs = RUNTIME ? RUNTIME.lastIndexOf('var srcs = el(', iSrcs) : -1
const be = RUNTIME ? RUNTIME.indexOf('box.appendChild(srcs);', iSrcs) + 'box.appendChild(srcs);'.length : -1
const BLOCK = (bs >= 0 && be > bs) ? RUNTIME.slice(bs, be) : ''
ok(BLOCK.length > 200, '[0] srcs 块被切出（chars=' + BLOCK.length + '）')
ok(/Math\.min\(ev\.members\.length, 8\)/.test(BLOCK), '[0] 8 条上限仍在（原型语义未被改宽）')

const mkRender = (blockText) => new Function('el', 'box', 'ev', blockText)
const renderSrcs = BLOCK ? mkRender(BLOCK) : null

// ─── 抽出 payload 适配函数（当前实现可能不裁 members，这里只要求它能把 store → 原型形状搬对） ───
const FN_TEXT = ['ev4ProtoDatePre', 'ev4ProtoCheckpointPre', 'ev4ProtoPayloadPre']
  .map((n) => extractFn(SRC, n)).filter(Boolean).join('\n')
ok(FN_TEXT.split('function ev4ProtoPayloadPre(').length - 1 === 1, '[0] ev4ProtoPayloadPre 从真源码抽出（唯一）')

const ADAPTER = await import(pathToFileURL(path.join(ROOT, 'lib', 'ev4-adapter.js')).href)
const ctx = vm.createContext({ adaptStoreToPrototypePayload: ADAPTER.adaptStoreToPrototypePayload, console })
vm.runInContext(FN_TEXT + '\nglobalThis.__p = ev4ProtoPayloadPre', ctx)
const payloadFn = ctx.__p
ok(typeof payloadFn === 'function', '[0] payload 函数在 vm 中真加载成功')

// ─── 夹具：11 种长度组合 ───
const SHAPES = [
  [3, 1], [9, 3], [5, 3], [5, 2], [3, 2], [2, 1], [7, 2], [4, 1],   // 8 = 真实 store 观测到的超长形态
  [1, 5],   // members < cp
  [0, 3],   // 无 members
  [20, 0],  // 无 checkpoints（最极端：cp2 必为 undefined）
]
const mkFixture = (n, cpN, i) => ({
  id: 'evt_synth_' + i, name: 'synthetic ' + n + '/' + cpN, status: 'active', createdAt: 1793000000000,
  members: Array.from({ length: n }, (_, k) => 'docs/m' + k + '.md'),
  checkpoints: Array.from({ length: cpN }, (_, k) => ({ at: 1793000000000 + k * 60000, kind: 'log', text: 'cp' + k, sourceRef: 'docs/cp' + k + '.md', panels: [] })),
})
const FIXTURES = SHAPES.map((s, i) => mkFixture(s[0], s[1], i))

/** 渲染并返回 { threw, rows, paths } */
function renderOne (fn, fx) {
  const out = { threw: null, rows: -1, paths: [] }
  try {
    const payload = payloadFn({ events: [fx] }, 0)
    const ev = payload.events[0]
    const box = el('div', 'box')
    fn(el, box, ev)
    const srcs = box.children[0]
    if (srcs) {
      // ★只数 .row —— 末尾的 "… 还有 N 篇" 是 .more，不属于来源行
      const rows = srcs.children.filter((c) => c && c.cls === 'row')
      out.rows = rows.length
      for (const row of rows) {
        if (row.children && row.children[1]) out.paths.push(String(row.children[1].text == null ? '' : row.children[1].text))
      }
      out.moreLine = srcs.children.some((c) => c && c.cls === 'more')
    }
    out.payloadMembers = (ev.members || []).length
  } catch (e) { out.threw = e && (e.name + ': ' + e.message) }
  return out
}

// ═══ A 正路径：全部组合零异常 ═══
console.log('== A 正路径：11 种长度组合 ==')
const RA = FIXTURES.map((fx) => renderOne(renderSrcs, fx))
const aThrew = RA.filter((r) => r.threw)
ok(aThrew.length === 0, '[A] 11 种组合零异常（异常数=' + aThrew.length + (aThrew.length ? '；首个 ' + aThrew[0].threw : '') + '）')

// ═══ B 不截断：每条 member 都必须出现在渲染结果里 ═══
console.log('== B 不截断：来源一条都不能少 ==')
let bLost = 0, bChecked = 0
for (let i = 0; i < FIXTURES.length; i++) {
  const fx = FIXTURES[i], r = RA[i]
  const expect = fx.members.slice(0, 8)
  if (!expect.length) continue
  bChecked++
  for (const p of expect) if (r.paths.indexOf(p) < 0) bLost++
}
ok(bChecked > 0, '[B] 有可检的 members 夹具（' + bChecked + ' 组）')
ok(bLost === 0, '[B] 全部成员路径都渲染出来了（丢失条数=' + bLost + '）—— 「来源显示不全」这一失败形态被锁住')

// ═══ C 行数 = min(members,8) ═══
console.log('== C 行数 = min(members,8) ==')
let cBad = 0
for (let i = 0; i < FIXTURES.length; i++) {
  const want = Math.min(FIXTURES[i].members.length, 8)
  if (RA[i].rows !== want) cBad++
}
ok(cBad === 0, '[C] 11 组行数都等于 min(members,8)（不符=' + cBad + '）')

// ═══ D 负路径：把可空解引用改回裸解引用 ⇒ 必须崩 ═══
console.log('== D 负路径：裸解引用变体必须重新崩 ==')
// 还原成**原始缺陷三行**（三处都退回裸解引用，少还原一处会被 false || 短路掩盖）
let MUT = BLOCK
const MUTATIONS = [
  ['(ev.checkpoints && ev.checkpoints[mi]) || null', 'ev.checkpoints[mi]'],
  ['String(ev.members[mi] || (cp2 && cp2.rel) || "")', 'cp2.rel'],
  ['(cp2 && cp2.at) || ""', 'cp2.at'],
]
let mutApplied = 0
for (const [a, b] of MUTATIONS) { if (MUT.indexOf(a) >= 0) { MUT = MUT.split(a).join(b); mutApplied++ } }
ok(mutApplied === 3, '[D] 变异点全部定位成功（' + mutApplied + '/3 处裸解引用还原）')
if (MUT !== BLOCK) {
  const renderBroken = mkRender(MUT)
  const dExpect = FIXTURES.filter((f) => f.members.length > f.checkpoints.length).length
  let dCrash = 0
  for (const fx of FIXTURES) {
    const r = renderOne(renderBroken, fx)
    if (r.threw && /TypeError/.test(r.threw)) dCrash++
  }
  ok(dCrash === dExpect, '[D] ' + dExpect + ' 个 members>checkpoints 夹具在裸解引用下全部 TypeError（实得 ' + dCrash + '）—— 判据非恒真')
}

// ═══ E 负路径 · 真实数据：同批真实事件在裸解引用下必须崩 ═══
console.log('== E 负路径 · 真实 store 数据 ==')
const STORE = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json'
let storeText = null
try { storeText = readFileSync(STORE, 'utf8') } catch (e) { storeText = null }

if (!storeText) {
  console.log('  SKIP - 本机无真实 store（' + STORE + '），E/F 组跳过（记 SKIP，不计 FAIL）')
} else {
  const J = JSON.parse(storeText)
  const overCp = J.events.filter((e) => (e.members || []).length > (e.checkpoints || []).length)
  ok(overCp.length > 0, '[E] 真实 store 里确实存在 members>checkpoints 的事件（' + overCp.length + ' 个）')
  if (MUT !== BLOCK) {
    const renderBroken = mkRender(MUT)
    let eCrash = 0
    for (const e of overCp) {
      const raw = { members: e.members.slice(), checkpoints: e.checkpoints.map((c) => ({ rel: c.sourceRef || '', at: String(c.at || '') })) }
      try { renderBroken(el, el('div', 'box'), raw) } catch (err) { eCrash++ }
    }
    ok(eCrash === overCp.length, '[E] 这 ' + overCp.length + ' 个真实事件在裸解引用下全部崩溃（实得 ' + eCrash + '）—— 缺陷真实存在过')
  }

  // ═══ F 真实 store 走生产链路：零崩溃 + 零截断 ═══
  console.log('== F 真实 store 走生产链路 ==')
  let fCrash = 0, fLost = 0, fRowsBad = 0
  for (const e of J.events) {
    const fx = { id: e.id, name: e.name, status: e.status, createdAt: e.createdAt, members: e.members || [], checkpoints: e.checkpoints || [] }
    const r = renderOne(renderSrcs, fx)
    if (r.threw) { fCrash++; continue }
    const want = Math.min((e.members || []).length, 8)
    if (r.rows !== want) fRowsBad++
    for (const p of (e.members || []).slice(0, 8)) if (r.paths.indexOf(p) < 0) fLost++
  }
  ok(fCrash === 0, '[F] ' + J.events.length + ' 个真实事件零崩溃（crash=' + fCrash + '）')
  ok(fRowsBad === 0, '[F] 行数全部 = min(members,8)（不符=' + fRowsBad + '）')
  ok(fLost === 0, '[F] 真实事件的来源路径零丢失（丢失=' + fLost + '）')
}

// ═══ G 行尾守恒 ═══
console.log('== G 行尾守恒 ==')
const bareLF = (SRC.match(/(?<!\r)\n/g) || []).length
ok(bareLF === 0, '[G] lib/client.js 裸 LF = 0（实得 ' + bareLF + '）')

console.log('\n[ev4-srcs-members-safety] PASS ' + pass + ' / FAIL ' + fail)
process.exitCode = fail ? 1 : 0
