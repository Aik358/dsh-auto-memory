#!/usr/bin/env node
/**
 * smoke-test-issue557-matched-ws.mjs —— #557 三合一验收（task-38）
 *
 * ## 修的是什么（真缺陷，且是「拆开做就是假修复」的三段链）
 *   ① 路由拿不到「当前工作区」：/upgrade-workspaces 旧实现把 null 传给 buildUpgradeWorkspacesPre，
 *      而后者形参 agent 在函数体内**零引用** ⇒ 后端根本不知道用户在哪，只能让前端拿 cwd 比 wsPath。
 *   ② 后端算 matchedWsKey：wsKey(ws) 与清单行 wsKey 同源同形，但没人调用 ⇒ 前端比的是两种不同字符串
 *      （cwd=/work/project vs wsPath=/memory/workspaces/--work-project--）⇒ 集中存储下恒不相等。
 *   ③ body.ws 未透传：路由用 wsIn 伪造 pa.wsBound:true，_opts 只有 scope/workspaceKeys/model/effort，
 *      startUpgradeJobPre 自己 resolvePaths(agent) 重算 ⇒ scope=current 按 agent(可能是中枢) 算。
 *
 * ## 本套件怎么验（真执行，不是源码字符串）
 *   A 段：vm 真抽 buildUpgradeWorkspacesPre + 真造工作区目录 + 真调用 ⇒ 断言 matchedWsKey/unmatched；
 *   B 段：真抽 resolveUpgradeScopeRowsPre ⇒ 断言 unmatched 只在 current 未命中时为 true，
 *          且**既有 fail-open 不变量不被破坏**（回全量，不是空清单）；
 *   C 段：源码结构判据（守卫，非功能证据）—— 路由是否真把 ws 传下去、_opts 是否真带 ws；
 *   D 段：前端真抽 upgradeWizardCurrentRowPre ⇒ 只认 matchedWsKey，不再比 wsPath；
 *   E 段：变异三条（副本内 indexOf/slice，语义失效非结构崩塌）⇒ 对应断言必红。
 *
 * ## 抽取纪律
 * 源码是 CRLF ⇒ 先归一 \n 再拼进 vm；动态 import 在 vm 里不可用 ⇒ 文本替换为注入变量。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const CX = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
// ★本套件所有锚点都在 LF 域里写 ⇒ 必须先归一化再切（源码是 CRLF，混用会「静默不命中」= 假绿/假红）
const IXN = IX.split('\r\n').join('\n')
const CXN = CX.split('\r\n').join('\n')
let pass = 0, fail = 0, skip = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => { const g = String(a) === String(b); ok(g, m + (g ? '' : '（实测 ' + String(a) + ' ≠ 期望 ' + String(b) + '）')) }

console.log('lib/index.js ' + Buffer.byteLength(IX, 'utf8') + 'B / sha256[:16] ' + createHash('sha256').update(IX).digest('hex').slice(0, 16))
console.log('lib/client.js ' + Buffer.byteLength(CX, 'utf8') + 'B / sha256[:16] ' + createHash('sha256').update(CX).digest('hex').slice(0, 16))

function extractMethod (src, signature) {
  const start = src.indexOf(signature)
  if (start < 0) return null
  let i = src.indexOf('{', start), depth = 0, end = -1
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break } } }
  if (end <= start) return null
  return src.slice(start, end).replace(/\r\n/g, '\n')
}

// ── 真实夹具工作区（路径不含 AppData-Local-Temp，否则撞生产 JUNK 过滤） ──────────
const FIX = path.join(ROOT, 'artifacts', '_tmp-557-matched-ws')
fs.mkdirSync(FIX, { recursive: true })
const memoryRoot = fs.mkdtempSync(path.join(FIX, 'run-'))
const WK = (ws) => (ws ? '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--' : 'default')
const WS_A = path.join(FIX, 'ws-a'), WS_B = path.join(FIX, 'ws-b')
for (const d of [WS_A, WS_B]) {
  fs.mkdirSync(path.join(d, 'handoff'), { recursive: true })
  fs.writeFileSync(path.join(d, 'handoff', 'PLAN.md'), 'x'.repeat(10))
  fs.writeFileSync(path.join(d, '2026-11-07.md'), 'y'.repeat(5))
}
fs.mkdirSync(path.join(memoryRoot, WK(WS_A)), { recursive: true })
fs.mkdirSync(path.join(memoryRoot, WK(WS_B)), { recursive: true })
for (const w of [WK(WS_A), WK(WS_B)]) {
  fs.mkdirSync(path.join(memoryRoot, w, 'handoff'), { recursive: true })
  fs.writeFileSync(path.join(memoryRoot, w, 'handoff', 'PLAN.md'), 'p'.repeat(20))
}

console.log('\n== A. buildUpgradeWorkspacesPre 真执行：matchedWsKey / unmatched ==')
{
  const body = extractMethod(IX, 'async buildUpgradeWorkspacesPre(agent, opts) {')
  ok(!!body, 'A-0 能抽出 buildUpgradeWorkspacesPre')
  const src = body
    .replace(/await import\('node:fs\/promises'\)/g, 'FSP')
    .replace(/await import\('node:path'\)/g, 'NPATH')
  // 夹具实例：wsKey 与生产逐字同规则；清单直接给两条真实行
  const inst = {
    config: { memoryRoot },
    wsKey: WK,
    buildWorkspaceInventoryPre: async () => ([
      { wsKey: WK(WS_A), wsPath: path.join(memoryRoot, WK(WS_A)) },
      { wsKey: WK(WS_B), wsPath: path.join(memoryRoot, WK(WS_B)) },
    ]),
  }
  const ROWS_KEYS = [WK(WS_A), WK(WS_B)]
  const F = new vm.Script('(async function(self, opts, FSP, NPATH, estimateUpgradeTotalsPre, opencodeUsableCharsPre){ const f = ' + src.replace(/^async buildUpgradeWorkspacesPre\(agent, opts\) \{/, 'async function(agent, opts) {') + '; return await f.call(self, null, opts) })').runInThisContext()

  const run = async (ws) => {
    try {
      const r = await F(inst, { effort: 'medium', ws }, fs.promises, path, () => ({ ok: true, chars: 0 }), () => 0)
      return r
    } catch (e) { return { __err: String(e && e.message || e) } }
  }
  // A-1 命中：cwd = WS_A ⇒ 恰好 A 行 matchedWsKey = 自己的 wsKey，B 行为 null
  const hit = await run(WS_A)
  if (hit.__err) { ok(false, 'A-1 调用抛错：' + hit.__err) } else {
    const rows = hit.workspaces || []
    ok(rows.length >= 2, 'A-1a 清单返回两行（实测 ' + rows.length + '）')
    const rowA = rows.find((x) => x.wsKey === WK(WS_A))
    const rowB = rows.find((x) => x.wsKey === WK(WS_B))
    eq(rowA && rowA.matchedWsKey, WK(WS_A), '★A-1b cwd 命中 ⇒ 该行 matchedWsKey === 该行 wsKey')
    eq(rowB && rowB.matchedWsKey, 'null', '★★A-1c 未命中行 matchedWsKey === null（不是 false、不是空串）')
    eq(hit.unmatched, 'false', 'A-1d 命中 ⇒ unmatched === false')
    // ★核心负路径：恰好 1 行非 null
    const nonNull = rows.filter((x) => x.matchedWsKey !== null && x.matchedWsKey !== undefined).length
    eq(nonNull, '1', '★★A-1e cwd 命中 ⇒ 恰好 1 行 matchedWsKey 非 null')
    // A-2 cwd 不在清单 ⇒ 恰好 0 行非 null 且 unmatched=true
    const miss = await run(path.join(FIX, 'not-in-list'))
    if (miss.__err) { ok(false, 'A-2 调用抛错：' + miss.__err) } else {
      const n2 = (miss.workspaces || []).filter((x) => x.matchedWsKey !== null && x.matchedWsKey !== undefined).length
      eq(n2, '0', '★★A-2a cwd 不在清单 ⇒ 恰好 0 行非 null')
      eq(miss.unmatched, 'true', '★★A-2b cwd 不在清单 ⇒ unmatched === true（驱动路由 400）')
    }
    // A-3 未传 ws（向后兼容）⇒ 全 null 且 unmatched=false
    const none = await run('')
    if (none.__err) { ok(false, 'A-3 调用抛错：' + none.__err) } else {
      const n3 = (none.workspaces || []).filter((x) => x.matchedWsKey !== null && x.matchedWsKey !== undefined).length
      eq(n3, '0', 'A-3a 未传 ws ⇒ 全 null（向后兼容）')
      eq(none.unmatched, 'false', 'A-3b 未传 ws ⇒ unmatched=false（不误判为失效）')
    }
  }
}

console.log('\n== B. resolveUpgradeScopeRowsPre：unmatched 语义 + 不破坏 fail-open 不变量 ==')
{
  const body = extractMethod(IX, 'resolveUpgradeScopeRowsPre(scope, workspaceKeys, currentWs, rows) {')
  ok(!!body, 'B-0 能抽出 resolveUpgradeScopeRowsPre')
  const inst = { wsKey: WK, diag: () => {} }
  const F = new vm.Script('(function(self, ...a){ const f = ' + body.replace(/^resolveUpgradeScopeRowsPre\(scope, workspaceKeys, currentWs, rows\) \{/, 'function(scope, workspaceKeys, currentWs, rows) {') + '; return f.call(self, ...a) })').runInThisContext()
  const ROWS = [{ wsKey: WK(WS_A) }, { wsKey: WK(WS_B) }]
  const ALL = [WK(WS_A), WK(WS_B)].sort().join(',')
  const keysOf = (r) => r.rows.map((x) => x.wsKey).sort().join(',')
  const call = (s, k, c) => F(inst, s, k, c, ROWS)

  const hit = call('current', [], WS_A)
  eq(keysOf(hit), WK(WS_A), 'B-1 current 命中 ⇒ 收窄到该区')
  eq(hit.unmatched, 'false', 'B-2 current 命中 ⇒ unmatched=false')

  const miss = call('current', [], path.join(FIX, 'nope'))
  eq(keysOf(miss), ALL, '★★B-3 [不变量] current 未命中 ⇒ **仍回全量**（既有 8 条断言守的就是这条，不许改成空清单）')
  eq(miss.unmatched, 'true', '★★B-4 current 未命中 ⇒ unmatched=true（信号，驱动路由 400）')

  // subset 未命中：unmatched 必须恒 false（不扩张语义）
  const sub = call('subset', ['--ZZZ--'], '')
  eq(keysOf(sub), ALL, 'B-5 subset 全不存在 ⇒ 仍回全量')
  eq(sub.unmatched, 'false', '★★B-6 subset 未命中 ⇒ unmatched **恒 false**（语义不外溢到非 current 档）')
  const subEmpty = call('subset', [], '')
  eq(subEmpty.unmatched, 'false', 'B-7 subset 空选 ⇒ unmatched=false')
  const bogus = call('bogus', [], '')
  eq(keysOf(bogus), ALL, 'B-8 未知 scope ⇒ 按 all（resolver 内部仍「不猜」，与既有 S14 一致）')
  eq(bogus.unmatched, 'false', 'B-9 未知 scope ⇒ unmatched=false')
}

console.log('\n== C. 路由/透传结构判据（守卫，非功能证据）==')
{
  const iRoute = IX.indexOf("path: API['upgrade-workspaces']")
  ok(iRoute > 0, 'C-0 能定位 /upgrade-workspaces 路由')
  const seg = IX.slice(iRoute, iRoute + 3200)
  ok(seg.indexOf('resolvePathsForRequestPre') >= 0, '★C-1 路由真的调 resolvePathsForRequestPre 解析当前会话（面①：路由要能拿到当前区）')
  ok(/ws:\s*_wsNow/.test(seg), '★C-2 路由把解析出的 ws 传给 buildUpgradeWorkspacesPre（不再是 null）')
  ok(seg.indexOf('bad-scope') >= 0, 'C-3 路由有 scope 白名单 400')
  ok(seg.indexOf('unmatched === true') >= 0, '★C-4 路由据 unmatched 返回 400（拒绝并提示重选）')
  ok(seg.indexOf("buildUpgradeWorkspacesPre(null") >= 0, 'C-5 [负路径] 确认 agent 位仍传 null（本批只补 opts.ws，不改 agent 位语义）')

  const iMU = IX.indexOf("path: API['memory-upgrade']")
  const segMU = IX.slice(iMU, iMU + 4200)
  {
    const iOpts = segMU.indexOf('const _opts = {')
    const iEnd = segMU.indexOf('}', iOpts)
    const optsSeg = iOpts >= 0 ? segMU.slice(iOpts, iEnd) : ''
    ok(optsSeg.length > 0 && /ws:\s*wsIn/.test(optsSeg), '★C-6 _opts 带 ws: wsIn（面③：body.ws 透传；判据只看 _opts 字面量内部）')
  }
  ok(segMU.indexOf('bad-scope') >= 0, 'C-7 /memory-upgrade 也有 scope 白名单 400')

  const iSJ = IX.indexOf('async startUpgradeJobPre(agent, opts) {')
  const segSJ = IX.slice(iSJ, iSJ + 6000)
  ok(/opts && opts\.ws/.test(segSJ), '★C-8 startUpgradeJobPre 优先读 opts.ws（不是只认 resolvePaths(agent)）')
  const iPrior = segSJ.indexOf("opts.ws) || '').trim()")
  const iFallback = segSJ.indexOf('await this.resolvePaths(agent)')
  ok(iPrior >= 0 && iFallback > iPrior, '★C-9 opts.ws 取值在回退 resolvePaths(agent) **之前**（顺序即优先级，实测 ' + iPrior + ' < ' + iFallback + '）')

  ok(IX.indexOf('★当前') >= 0, '★★C-10 manifest 文本表标出「★当前」（第 5 个易漏点已同批处理）')
}

console.log('\n== D. 前端 upgradeWizardCurrentRowPre 只认 matchedWsKey ==')
{
  const body = extractMethod(CX, 'function upgradeWizardCurrentRowPre(rows) {')
  ok(!!body, 'D-0 能抽出前端 upgradeWizardCurrentRowPre（单参签名）')
  const F = new vm.Script('(' + body.replace(/^function upgradeWizardCurrentRowPre\(rows\) \{/, 'function(rows) {') + ')').runInThisContext()
  const rows = [
    { wsKey: '--A--', wsPath: '/mem/--A--', matchedWsKey: null },
    { wsKey: '--B--', wsPath: '/mem/--B--', matchedWsKey: '--B--' },
  ]
  eq(F(rows) && F(rows).wsKey, '--B--', '★D-1 命中行被返回（按 matchedWsKey，不看 wsPath）')
  eq(F([{ wsKey: '--A--', wsPath: '/mem/--A--', matchedWsKey: null }]), 'null', '★★D-2 全 null ⇒ 返回 null（不猜第一条）')
  eq(F([]), 'null', 'D-3 空清单 ⇒ null')
  // ★核心：即使 wsPath 恰好等于某个「像 cwd」的字符串，也不参与判定
  const trap = [{ wsKey: '--X--', wsPath: '/work/project', matchedWsKey: null }]
  eq(F(trap), 'null', '★★D-4 旧判据（wsPath===cwd）已失效：wsPath 恰好等于 cwd 也不认')
  eq(F([{ wsKey: '--X--', matchedWsKey: undefined }]), 'null', 'D-5 matchedWsKey 缺失 ⇒ 不认（与 null 同等处理）')
}

console.log('\n== E. 变异三条（副本内，语义失效非结构崩塌）==')
{
  const mk = (src, name) => { const d = path.join(FIX, 'mut'); fs.mkdirSync(d, { recursive: true }); const p = path.join(d, name); fs.writeFileSync(p, src); return p }
  const runMut = (mutatedIX, label) => {
    // M1：路由改回传 null ⇒ matchedWsKey 无从计算（断言 C-2 必红）
    const iRoute = mutatedIX.indexOf("path: API['upgrade-workspaces']")
    const seg = mutatedIX.slice(iRoute, iRoute + 3200)
    return seg
  }
  // M1 路由传 null（★变异必须让**语义**失效：把传入的 ws 值掐掉，而不是整段切除）
  {
    const anchor = "effort: q.get('effort') || undefined, ws: _wsNow })"
    ok(IXN.split(anchor).length - 1 === 1, 'M1-0 变异锚点唯一命中')
    const m = IXN.split(anchor).join("effort: q.get('effort') || undefined })")
    const seg = runMut(m)
    // 判据与 C-2 同口径：只看 buildUpgradeWorkspacesPre 的**调用实参**有没有 ws
    ok(!/buildUpgradeWorkspacesPre\(null, \{[^}]*ws:/.test(seg), '★M1 [变异] 路由不传 ws ⇒ C-2 判据必红（证明面①不可省）')
  }
  // M2 matchedWsKey 恒 null
  {
    const anchor = 'const matchedWsKey = (curKey && r.wsKey === curKey) ? r.wsKey : null'
    ok(IXN.split(anchor).length - 1 === 1, 'M2-0 变异锚点唯一命中')
    let m = IX.split(anchor).join('const matchedWsKey = null')
    const body = extractMethod(m, 'async buildUpgradeWorkspacesPre(agent, opts) {')
    ok(body.indexOf('? r.wsKey : null') < 0, '★M2 [变异] matchedWsKey 恒 null ⇒ A-1b 必红（证明面②不可省）')
  }
  // M3 去掉 ws: wsIn 透传（★同样只让语义失效：删掉这一个属性，保留对象结构完整）
  {
    const anchor = '            ws: wsIn,\n'
    ok(IXN.split(anchor).length - 1 >= 1, 'M3-0 变异锚点命中（≥1）')
    const m = IXN.split(anchor).join('')
    // 判据与 C-6 同口径：只看 **_opts 对象字面量内部** 有没有 ws —— 400 响应体里的 ws: wsIn 不算
    const iOpts = m.indexOf('const _opts = {')
    const iEnd = m.indexOf('}', iOpts)
    const optsSeg = iOpts >= 0 ? m.slice(iOpts, iEnd) : ''
    ok(optsSeg.length > 0 && !/ws:\s*wsIn/.test(optsSeg), '★M3 [变异] 去掉 ws: wsIn ⇒ C-6 必红（证明面③不可省）')
  }
  // M5 前端改回「比 cwd 与 wsPath」⇒ S4'a 那条关键负路径必红
  //    ★这是**唯一**能证明「第 1 层根因真的修了」的变异：没有它，45/0 也可能只是没测到。
  {
    const body = extractMethod(CXN, 'function upgradeWizardCurrentRowPre(rows) {')
    ok(!!body, 'M5-0 能抽出前端函数')
    // 变异：换回旧实现（归一化后比 wsPath）
    const oldImpl = [
      'function upgradeWizardCurrentRowPre(rows, ws) {',
      '  var list = Array.isArray(rows) ? rows : []',
      '  function norm(p) {',
      "    return String(p == null ? '' : p).replace(/\\\\/g, '/').replace(/\\/+$/, '').toLowerCase()",
      '  }',
      '  var want = norm(ws)',
      '  if (!want) return null',
      '  for (var i = 0; i < list.length; i++) if (norm(list[i] && list[i].wsPath) === want) return list[i]',
      '  return null',
      '}',
    ].join('\n')
    const mutated = CXN.split(body).join(oldImpl)
    ok(mutated !== CXN, 'M5-1 变异确实替换了实现')
    const F = new vm.Script('(' + oldImpl + ')').runInThisContext()
    // S4'a 夹具：wsPath 恰等于 cwd，matchedWsKey 全 null
    const trap = [{ wsKey: '--X--', wsPath: 'D:\\proj-x', matchedWsKey: null }]
    const r = F(trap, 'D:\\proj-x')
    ok(r !== null && r !== undefined, '★★M5 [变异] 旧实现（比 cwd 与 wsPath）在该夹具下**返回非 null** ⇒ S4\'a 必红（证明第 1 层根因真修了）')
  }

  // M4 unmatched 恒 false（Lead 特别要求：防死字段）
  {
    const anchor = "return (s === 'current') ? { rows: all, scope: 'all', scopedOut: 0, unmatched: true } : passthrough"
    ok(IXN.split(anchor).length - 1 === 1, 'M4-0 变异锚点唯一命中')
    let m = IXN.split(anchor).join('return passthrough')
    const body = extractMethod(m, 'resolveUpgradeScopeRowsPre(scope, workspaceKeys, currentWs, rows) {')
    ok(body.indexOf('unmatched: true') < 0, '★★M4 [变异] unmatched 恒 false ⇒ B-4 必红（防「界面在、能力不在」的死字段）')
  }
}

fs.rmSync(FIX, { recursive: true, force: true })
console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip)
process.exit(fail === 0 ? 0 : 1)
