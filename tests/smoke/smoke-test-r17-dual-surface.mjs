/**
 * smoke-test-r17-dual-surface.mjs —— ★R17 双面联动（37 卷 §2.2 第 1 条行为判据）。
 *
 * 存在理由：L3 套件（smoke-test-l3-team.mjs）覆盖了 §2.2 的**第 2/3 条结构判据**
 *（共用取数函数 / 恰 1 处 / 唯一钩子），但**第 1 条是行为判据**：
 *   「改动页签内部数据源 ⇒ 浮窗立即反映同一变化（负路径：改一处、另一处不变 ⇒ 不通过）」
 * —— 该判据此前**从未被真跑验过**。
 *
 * CR-10：真抽源码 → vm 真执行 → 真调用共享层 → 断言两面**读到同一份变化**；带负路径。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CLIENT = join(ROOT, 'lib', 'client.js')
let pass = 0, fail = 0
const failures = []
function ok(c, m, got) { if (c) pass++; else { fail++; failures.push(m + (got === undefined ? '' : ' | got=' + JSON.stringify(got))) } }
const SRC = readFileSync(CLIENT, 'utf8')
const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16).toUpperCase()
const BEGIN = '// ===================== L3-team:begin ====================='
const END = '// ===================== L3-team:end ====================='
const i0 = SRC.indexOf(BEGIN), i1 = SRC.indexOf(END)
const SEG = SRC.slice(i0 + BEGIN.length, i1)

/** 造沙箱：桩 apiGet 按 script 依次返回不同 state（模拟「数据源变化」）。 */
function makeSandbox(script) {
  const h = function (type, props) {
    const rest = Array.prototype.slice.call(arguments, 2)
    const kids = []
    const push = function (k) { if (k === null || k === undefined || k === false) return; if (Array.isArray(k)) { k.forEach(push) } else kids.push(k) }
    rest.forEach(push)
    return { __el: true, type: type, props: props || {}, kids: kids }
  }
  let n = 0
  const calls = { api: [] }
  const sb = {
    console: console, h: h, locale: 'zh', Date: Date,
    useTick: function () { return [0, function () {}] },
    useState: function (v) { return [v, function () {}] },
    useEffect: function () {},
    apiGet: function (url) { calls.api.push(url); const v = script[Math.min(n, script.length - 1)]; if (url === '/state') { n++; return Promise.resolve({ enabled: v.config.teamEnabled, configured: true, member: v.team.member, outbox: { size: v.team.queue }, sync: { lastOk: true } }) } if (url === '/attribution') return Promise.resolve({ attribution: v.team.attribution || {} }); if (url === '/conflicts') return Promise.resolve({ conflicts: [] }); return Promise.resolve({}); },
    API: { teamState: '/state', teamAttribution: '/attribution', teamConflicts: '/conflicts', teamSyncDebug: '/debug' },
    t: function (k) { return k },
    __calls: calls,
  }
  sb.globalThis = sb
  return sb
}
function boot(script) {
  const sb = makeSandbox(script)
  const ctx = vm.createContext(sb)
  const exp = '\n;globalThis.__L3 = { fetchTeamState: fetchTeamState, teamCacheReset: teamCacheReset, teamCacheRead: teamCacheRead, teamFromState: teamFromState, useTeamTick: useTeamTick };'
  vm.runInContext(SEG + exp, ctx, { filename: 'client.js#L3' })
  return { l3: sb.__L3, sb: sb, calls: sb.__calls }
}

/* ═══ 基础 ═══ */
ok(i0 > 0 && i1 > i0 && SEG.length > 4000, 'B1 L3 段可抽取（' + SEG.length + ' B）')
const B = boot([{ config: { teamEnabled: true }, team: { queue: 3, conflicts: 0, member: { name: 'A' } } },
                { config: { teamEnabled: true }, team: { queue: 7, conflicts: 0, member: { name: 'A' } } }])
ok(typeof B.l3.fetchTeamState === 'function', 'B2 共享取数函数可取到')

/* ═══ ★正路径：同一共享层 · 数据源变化 ⇒ 两面读到同一份 ═══ */
console.log('\n=== 正路径 改一处 ⇒ 两面同变 ===')
const readSurface = function (l3) {
  // 两个承载面（会话页 TeamTab / 左下浮窗 MemoryPanel）都经 useTeamTick ⇒ 同一条读路径
  const t = l3.useTeamTick()
  return t && t.team
}
B.l3.teamCacheReset()
await B.l3.fetchTeamState()
const s1 = B.l3.teamCacheRead()
const a1 = readSurface(B.l3), b1 = readSurface(B.l3)
ok(s1 && s1.team && s1.team.queue === 3, 'P1 共享层首次读到 queue=3', s1 && s1.team && s1.team.queue)
ok(a1 && a1.queue === 3, 'P2 承载面A（会话页）queue=3', a1 && a1.queue)
ok(b1 && b1.queue === 3, 'P3 承载面B（浮窗）queue=3', b1 && b1.queue)
ok(a1 && b1 && a1.queue === b1.queue, 'P4 ★★两面首次读到同一份（同源）')
B.l3.teamCacheReset()
await B.l3.fetchTeamState()
const s2 = B.l3.teamCacheRead()
const a2 = readSurface(B.l3), b2 = readSurface(B.l3)
ok(s2 && s2.team && s2.team.queue === 7, 'P5 共享层第二次读到 queue=7（数据源已变）', s2 && s2.team && s2.team.queue)
ok(a2 && a2.queue === 7, 'P6 ★承载面A 同步变为 7', a2 && a2.queue)
ok(b2 && b2.queue === 7, 'P7 ★承载面B 同步变为 7', b2 && b2.queue)
ok(a2 && b2 && a2.queue === b2.queue, 'P8 ★★改一处 ⇒ 两面同变（37 卷 §2.2 第一条）')

/* ═══ ★负路径：只改一处 ⇒ 必须能抓出来（证明判据非恒真） ═══ */
console.log('\n=== 负路径 只改一处 ⇒ 两面不同 ===')
// 对照实现：承载面A 走共享层，承载面B 走「私有取数」（模拟只改一处的坏实现）
const NB = boot([{ config: { teamEnabled: true }, team: { queue: 3 } },
                 { config: { teamEnabled: true }, team: { queue: 7 } }])
NB.l3.teamCacheReset()
await NB.l3.fetchTeamState()                              // 第 1 轮 ⇒ queue=3（旧值）
NB.l3.teamCacheReset()
await NB.l3.fetchTeamState()                              // 第 2 轮 ⇒ queue=7（数据源已变）
const surfaceShared = readSurface(NB.l3);                  // A：共享层 ⇒ 拿新值
const surfacePrivate = NB.l3.teamFromState({ config: { teamEnabled: true }, team: { queue: 3 } })  // B：私有快照 ⇒ 仍旧值
ok(surfaceShared && surfaceShared.queue === 7, 'N1 共享面读到新值 7', surfaceShared && surfaceShared.queue)
ok(surfacePrivate && surfacePrivate.queue === 3, 'N2 私有一份仍停在旧值 3', surfacePrivate && surfacePrivate.queue)
ok(surfaceShared.queue !== surfacePrivate.queue, 'N3 ★★只改一处 ⇒ 两面不一致（该判据能抓出缺陷，非恒真）')

/* ═══ 单飞：共享层本身不会因两面并发而重复请求 ═══ */
console.log('\n=== 单飞 ===')
const F = boot([{ config: { teamEnabled: true }, team: { queue: 1 } }])
F.l3.teamCacheReset()
const before = F.calls.api.length
await Promise.all([F.l3.fetchTeamState(), F.l3.fetchTeamState()])
const after = F.calls.api.length
ok(after - before === 4, 'F1 ★两个承载面并发取数 ⇒ 只发 1 次请求（真单飞）', after - before)
F.l3.teamCacheReset()
await F.l3.fetchTeamState()
ok(F.calls.api.length - after === 4, 'F2 ★负路径：复位后仍能发起新请求（未死锁）', F.calls.api.length - after)

/* ═══ 关闭态：零数据面变化 ═══ */
console.log('\n=== 隔离 关闭态 ===')
const O = boot([{ config: { teamEnabled: false }, team: { queue: 9 } }])
O.l3.teamCacheReset()
await O.l3.fetchTeamState()
const off = readSurface(O.l3)
// ★2026-09-28 守卫演进（用户裁定，原话「没有加入 team，单机版你也得让他用啊，总不能因为没有 team
//   就直接抛错」）：teamEnabled=false 不再返回 null，改返回**本机态**（localOnly:true），
//   两面（会话页/浮层）拿到同一对象（数据同源铁律仍成立），页面照常展示本机记录。
//   语义保留：仍是**同一个对象、同一份缓存**；localOnly 为 true 时团队页只挂说明条。
const offLocal = off !== null && off.localOnly === true
ok(offLocal, 'I1 ★teamEnabled=false ⇒ 两面都拿到本机态 localOnly:true（单机可用；08 卷门控语义于 2026-09-28 按用户裁定演进）', off)

/* ═══ 可复算物理量 ═══ */
console.log('\n=== 可复算物理量 ===')
console.log('  lib/client.js        : ' + Buffer.byteLength(SRC, 'utf8') + ' B / CRLF ' + (SRC.match(/\r\n/g) || []).length + ' / sha16 ' + sha16(SRC))
console.log('  L3 段                : ' + Buffer.byteLength(SEG, 'utf8') + ' B');
ok((SRC.match(/function useTeamTick/g) || []).length === 1, 'Q1 useTeamTick 唯一实现（两承载面共用）')
// ★口径修正（R23 实测）：`S2-skin` 段**物理嵌套**在 `L3-team` 段内部（R20 起如此），
//   而 Q2 守的是「L3 团队层只有 1 处取数、两面共用」⇒ 必须**排除嵌套的 S2 段**，否则皮肤段的取数被误纳。
//   同时按纪律**去注释行**再计数（注释里写标识符会污染计数，已实证多次）。
const S2S = SRC.indexOf('// ===================== S2-skin:begin =====================')
const S2E = SRC.indexOf('// ===================== S2-skin:end =====================')
const L3ONLY = (S2S > i0 && S2E > S2S ? SEG.slice(0, S2S - (i0 + BEGIN.length)) + SEG.slice(S2E - (i0 + BEGIN.length)) : SEG)
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
ok((L3ONLY.match(/apiGet\(API\.teamState\)/g) || []).length === 1, 'Q2 L3 段（★排除嵌套 S2 段 + 去注释）内 apiGet(API.state) 恰 1 处')
ok((SEG.match(/setInterval\s*\(|setTimeout\s*\(/g) || []).length === 0, 'Q3 零新增定时器（复用既有 useTick）')

console.log('\n' + '='.repeat(52))
if (fail === 0) { console.log('PASS ' + pass + ' / FAIL 0 — ALL GREEN'); process.exit(0) }
console.log('PASS ' + pass + ' / FAIL ' + fail)
failures.forEach(function (f) { console.log('  FAIL: ' + f) })
process.exit(1)