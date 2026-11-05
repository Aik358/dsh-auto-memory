#!/usr/bin/env node
/**
 * smoke-test-upgrade-scope-wiring.mjs —— 批0（2026-11-05）止血验收：范围选择真的生效。
 *
 * ## 修的是什么（真缺陷）
 * 前端早已发送 scope / workspaceKeys，但后端**零读取**：
 *   · workspaceKeys 全仓仅 client.js 一处（写进 payload），后端零读取
 *   · buildWorkspaceManifestPre() 签名无参 ⇒ 清单恒为全部工作区
 *   · 提示词写死「一个不许漏」⇒ 子代理即使拿到窄清单也会自行补扫
 * ⇒ 用户选「仅当前工作区」，实际处理全部区。个人版与团队版**都是假的**。
 *
 * ## 本套件怎么验（真执行，不是源码字符串）
 *   ① 真抽两个方法到 vm 里**真调用**：断言 rows 的 wsKey 集合与长度随 scope 变化；
 *   ② 真造 3 个临时工作区目录，真跑 manifest，断言**生成出来的清单文本**（区名集合、
 *      标题 N、提示词）随 scope 变化；
 *   ③ 向后兼容负路径：不传参 ⇒ 清单与 scope=all **逐字相同**；
 *   ④ 负路径：current 但当前区不在清单 ⇒ fail-open 回全量（绝不返回空清单）；
 *   ⑤ 变异：删掉对 workspaceKeys 的读取 ⇒ subset 断言必红。
 *
 * ## 抽取纪律
 * 函数体是 **CRLF** 源码切片 ⇒ 先归一为 \n 再拼进 vm（否则裸 \r ⇒ SyntaxError）；
 * 方法之间无逗号 ⇒ 用 class 包裹（对象字面量会报 Unexpected token 'async'）；
 * 函数体里的动态 import 在 vm 里不可用 ⇒ 文本替换为注入的模块变量（抽取式真执行的既有做法）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import fsp from 'node:fs/promises'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => { const g = String(a) === String(b); ok(g, m + (g ? '' : '（实测 ' + String(a) + ' ≠ 期望 ' + String(b) + '）')) }

console.log('lib/index.js ' + Buffer.byteLength(IX, 'utf8') + 'B / sha256[:16] ' + createHash('sha256').update(IX).digest('hex').slice(0, 16))

/** 抽方法体（花括号配平）。★必须归一 CRLF —— 本仓「跨文件搬字符串先剥 \r」同族陷阱。 */
function extractMethod (signature) {
  const start = IX.indexOf(signature)
  if (start < 0) return null
  let i = IX.indexOf('{', start), depth = 0, end = -1
  for (; i < IX.length; i++) { const c = IX[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break } } }
  if (end <= start) return null
  return IX.slice(start, end).replace(/\r\n/g, '\n')
}

const scopeBody = extractMethod('resolveUpgradeScopeRowsPre(scope, workspaceKeys, currentWs, rows) {')
const maniBody = extractMethod('async buildWorkspaceManifestPre(scope, workspaceKeys, currentWs) {')
ok(!!scopeBody, 'X-0a 能抽出 resolveUpgradeScopeRowsPre 函数体')
ok(!!maniBody, 'X-0b 能抽出 buildWorkspaceManifestPre 函数体（三参签名）')

// ── 夹具：3 个真实工作区目录 ────────────────────────────────────────────────
// ★夹具根**不能放在 os.tmpdir()**：Windows 下那是 %LOCALAPPDATA%\\Temp，
//   算出的目录名会含 "AppData-Local-Temp"，正命中生产 JUNK 过滤正则
//   ⇒ 工作区被当测试残留过滤掉 ⇒ 清单恒空（本套件第一版就在这里假红过）。
//   ⇒ 放到工作区内（路径不含该串），并在末尾强制清理。
const FIXTURE_BASE = path.join(ROOT, 'artifacts', '_tmp-scope-wiring')
fs.mkdirSync(FIXTURE_BASE, { recursive: true })
const memoryRoot = fs.mkdtempSync(path.join(FIXTURE_BASE, 'run-'))
/** 引擎口径的 wsKey（与生产 resolveUpgradeScopeRowsPre 里 this.wsKey() 逐字同规则 —— 夹具不复制逻辑，直接调引擎实例） */
const ENGINE_FOR_KEY = {
  config: { memoryRoot },
  expandUserPath: (p) => p,
  wsKey: function (ws) { return '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--' },
}
const wsKeyOf = (dir) => ENGINE_FOR_KEY.wsKey(dir)

/** 造工作区：目录名 = wsKey(会话 cwd 虚拟路径)，与生产「memoryRoot/目录名=wsKey」同形 */
const VROOT = path.join(FIXTURE_BASE, 'vroot')
function mkWs (label, planChars, logs) {
  const virtualCwd = path.join(VROOT, label)
  const name = wsKeyOf(virtualCwd)
  const dir = path.join(memoryRoot, name)
  fs.mkdirSync(path.join(dir, 'handoff'), { recursive: true })
  if (planChars > 0) fs.writeFileSync(path.join(dir, 'handoff', 'PLAN.md'), 'x'.repeat(planChars))
  for (let i = 0; i < logs; i++) fs.writeFileSync(path.join(dir, '2026-11-0' + (i + 1) + '.md'), 'log')
  return { key: name, dir, cwd: virtualCwd }
}
const WSA = mkWs('proj-a', 400, 2)
const WSB = mkWs('proj-b', 200, 0)
const WSC = mkWs('proj-c', 0, 1)
fs.mkdirSync(path.join(memoryRoot, 'dam-plan-cas-xyz'), { recursive: true })
const KA = WSA.key, KB = WSB.key, KC = WSC.key
const ROWS = [
  { wsKey: KA, wsPath: WSA.dir, planChars: 400, logCount: 2 },
  { wsKey: KB, wsPath: WSB.dir, planChars: 200, logCount: 0 },
  { wsKey: KC, wsPath: WSC.dir, planChars: 0, logCount: 1 },
]
const ALLKEYS = [KA, KB, KC].slice().sort().join(',')

function mkEngine () {
  return {
    config: { memoryRoot },
    expandUserPath: (p) => p,
    wsKey: ENGINE_FOR_KEY.wsKey,
  }
}
/** 把抽出的方法装进 class（方法间无需逗号），并注入动态 import 的替代品 */
/**
 * 把抽出的方法装进 vm 里的 class，并返回**绑定好 this 的实例**。
 * ★关键：buildWorkspaceManifestPre 内部会调 `this.resolveUpgradeScopeRowsPre(...)`，
 *   所以 this 必须是那个同时拥有两个方法的 **vm 实例**，而不是宿主的假引擎对象。
 *   ⇒ 做法：先建实例、再把 config/expandUserPath/wsKey 这些数据成员补到实例上
 *     （vm 里的 class 方法访问的是同一 realm 的 this，跨 realm 只传数据不传方法）。
 */
function buildCtx (bodies) {
  const c = vm.createContext({ console, diag: () => {}, memoryDir: () => memoryRoot, FSP: fsp, NPATH: path })
  const fixed = bodies.map((b) => b
    .replace(/await import\('node:fs\/promises'\)/g, 'FSP')
    .replace(/await import\('node:path'\)/g, 'NPATH'))
  vm.runInContext('class __E {' + fixed.join('\n') + '\n}' +
    ';globalThis.__mk = () => new __E();',
    c)
  const inst = c.__mk()
  // 把引擎的数据面补到实例上（方法留在 vm 实例自身，this 链完整）
  const e = mkEngine()
  inst.config = e.config
  inst.expandUserPath = e.expandUserPath
  inst.wsKey = e.wsKey
  c.__scope = inst.resolveUpgradeScopeRowsPre.bind(inst)
  c.__mani = inst.buildWorkspaceManifestPre.bind(inst)
  return c
}
const ctx = buildCtx([scopeBody, maniBody])

// ═══ 1. 纯过滤函数：真调用，集合级断言 ══════════════════════════════════════
console.log('== 1. resolveUpgradeScopeRowsPre 真调用（集合级断言） ==')
{
  const keysOf = (r) => r.rows.map((x) => x.wsKey).sort().join(',')
  const all = ctx.__scope('all', [], '', ROWS)
  eq(keysOf(all), ALLKEYS, 'S1 scope=all ⇒ 全部 3 个区')
  eq(all.scope, 'all', 'S2 scope=all 的生效档位 = all')
  eq(all.scopedOut, 0, 'S3 scope=all 时 scopedOut=0')
  const one = ctx.__scope('current', [], WSB.cwd, ROWS)
  eq(keysOf(one), KB, '★S4 scope=current ⇒ 只剩当前区（集合级断言，不只是长度）')
  eq(one.rows.length, 1, '★S5 scope=current 的 rows.length = 1（确实变小）')
  eq(one.scope, 'current', 'S6 scope=current 的生效档位')
  eq(one.scopedOut, 2, 'S7 scope=current 时被排除 2 个区')
  const sub = ctx.__scope('subset', [KA, KC], '', ROWS)
  eq(keysOf(sub), [KA, KC].sort().join(','), '★S8 scope=subset ⇒ 只留勾选的两个区')
  eq(sub.scopedOut, 1, 'S9 subset 时被排除 1 个区')
  eq(keysOf(ctx.__scope('current', [], '', ROWS)), ALLKEYS, 'S10 [负路径] current 但无当前区 ⇒ fail-open 全量（不缩成空）')
  eq(keysOf(ctx.__scope('current', [], path.join(VROOT, 'nope'), ROWS)), ALLKEYS, 'S11 [负路径] current 但当前区不在清单 ⇒ fail-open 全量')
  eq(keysOf(ctx.__scope('subset', [], '', ROWS)), ALLKEYS, 'S12 [负路径] subset 空选 ⇒ fail-open 全量')
  eq(keysOf(ctx.__scope('subset', ['--ZZZ--'], '', ROWS)), ALLKEYS, 'S13 [负路径] subset 全不存在 ⇒ fail-open 全量')
  eq(keysOf(ctx.__scope('bogus', [], '', ROWS)), ALLKEYS, 'S14 [负路径] 未知 scope ⇒ 按 all（不猜）')
  eq(keysOf(ctx.__scope(undefined, undefined, undefined, ROWS)), ALLKEYS, 'S15 [负路径] 全 undefined ⇒ 不抛且回全量')
  eq(keysOf(ctx.__scope('all', [], '', null)), '', 'S16 [负路径] rows=null ⇒ 空数组（不抛）')
}

// ═══ 2. 清单文本：真执行，断言区名集合 / N / 提示词都随 scope 变 ════════════
console.log('')
console.log('== 2. buildWorkspaceManifestPre 真执行（清单文本级断言） ==')
{
  const runMani = (scope, keys, curWs) => ctx.__mani(scope, keys, curWs)
  const allTxt = await runMani('all', [], '')
  const curTxt = await runMani('current', [], WSB.cwd)
  const subTxt = await runMani('subset', [KA, KC], '')
  const legacyTxt = await runMani()
  ok(typeof allTxt === 'string' && allTxt.length > 200, 'M1 scope=all 产出清单（len=' + (allTxt || '').length + '）')
  ok(allTxt.indexOf('dam-plan-cas') < 0, 'M2 [负路径] junk 目录不进清单')
  const wsIn = (txt) => [KA, KB, KC].filter((k) => txt.indexOf('`' + k + '`') >= 0).sort().join(',')
  eq(wsIn(allTxt), ALLKEYS, '★M3 scope=all 清单含 3 个区名')
  eq(wsIn(curTxt), KB, '★M4 scope=current 清单只含当前区名（其余区名一个都不在）')
  eq(wsIn(subTxt), [KA, KC].sort().join(','), '★M5 scope=subset 清单只含勾选的 2 个区名')
  const nOf = (txt) => { const m = txt.match(/共 (\d+) 个/); return m ? m[1] : '?' }
  eq(nOf(allTxt), '3', '★M6 scope=all 标题 N=3')
  eq(nOf(curTxt), '1', '★M7 scope=current 标题 N=1（真的变了）')
  eq(nOf(subTxt), '2', '★M8 scope=subset 标题 N=2')
  ok(allTxt.indexOf('一个不许漏，也一个不许加') >= 0, '★M9 scope=all 保留原句（向后兼容逐字不变）')
  ok(curTxt.indexOf('一个不许漏，也一个不许加') < 0, '★★M10 [退出条件] scope=current 时**不再**出现「一个不许漏」')
  ok(curTxt.indexOf('本次范围由用户指定') >= 0, '★★M11 [退出条件] scope=current 提示词改写为「本次范围由用户指定」')
  ok(curTxt.indexOf('不在本次范围') >= 0, '★★M12 [退出条件] 明写「其余区不在本次范围、不要去扫」')
  ok(subTxt.indexOf('用户勾选的 2 个区') >= 0, '★M13 scope=subset 提示词写明「用户勾选的 2 个区」')
  eq(legacyTxt, allTxt, '★★M14 [向后兼容] 不传任何参数时清单与 scope=all **逐字相同**')
  eq(await runMani('all', [], ''), allTxt, 'M15 同一输入两次调用结果稳定（无隐藏状态）')
  const missTxt = await runMani('current', [], path.join(VROOT, 'nope'))
  eq(nOf(missTxt), '3', 'M16 [负路径] current 但当前区不在清单 ⇒ fail-open 回 3 个（清单不空）')
  ok(missTxt.indexOf('一个不许漏，也一个不许加') >= 0, 'M17 [负路径] fail-open 时提示词回到原句（与 all 一致）')
}

// ═══ 3. 变异：删掉 workspaceKeys 读取 ⇒ subset 必红 ════════════════════════
console.log('')
console.log('== 3. 变异：删掉 workspaceKeys 读取 ⇒ subset 断言必红 ==')
{
  const need = "        ? workspaceKeys.map((k) => String(k == null ? '' : k).trim()).filter(Boolean)"
  const mutated = scopeBody.replace(need, '        ? []')
  ok(mutated !== scopeBody, 'V0 [变异] 能定位到 workspaceKeys 读取那一行（否则变异本身无效）')
  if (mutated !== scopeBody) {
    const mctx = buildCtx([mutated, maniBody])
    eq(mctx.__scope('subset', [KA, KC], '', ROWS).rows.length, 3,
      'V1 [变异] 删掉 workspaceKeys 读取后 subset 不再收窄（rows=3）⇒ 证明 S8/M5 测的是真行为')
    eq(ctx.__scope('subset', [KA, KC], '', ROWS).rows.length, 2, 'V2 [还原] 原实现 subset 仍收窄到 2 ⇒ 复绿')
  }
}

fs.rmSync(memoryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
// 整个夹具基目录一并清掉（失败时也清，避免留垃圾）
try { if (fs.readdirSync(FIXTURE_BASE).length === 0) fs.rmdirSync(FIXTURE_BASE) } catch (_) {}
console.log('')
console.log('[upgrade-scope-wiring] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
