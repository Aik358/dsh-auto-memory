#!/usr/bin/env node
/** [startup-dispatch] 启动弹窗分发链状态机(0.1.38 first 卡删除后的回归守卫;issue#40 扩宿主配置闸)。
 * 从 lib/client.js 源码抽取真实 dispatchStartupDialog / welcomeAutoAllowedPre 函数体(花括号配平),
 * 在受控闭包里注入 localStorage/cmpVersion/openDialog 跑关键用户状态 —— 测的是随包发布的真实代码:
 *   G1 全新安装(current=0.1.37,无任何标记,配置允许)→ welcomeTour(修复:此前误落已删除的 first)
 *   G2 新装已看完向导(wizDone+seen)→ 不再弹(不重复打扰)
 *   G3 老用户 seen=0.1.29 升级且向导未看过 → welcomeTour(0.1.30 大更新补引导)
 *   G4 老用户 seen=0.1.29 且向导已看过 → update(changelog 0.1.30)
 *   G5 老用户 seen=0.1.36(有更新)→ update(changelog)
 *   G6 老用户 seen=current 且向导看过 → 不弹
 *   G7 老用户 seen=0.1.39 升级到 2.1.0(跨大版本,向导看过)→ update
 *   G8 (issue#40) welcomeTourEnabled=false → 全新安装/老用户都不自动弹(修复:false 无效)
 *   G9 (issue#40) 宿主配置未知(cfg=null)→ 不自动弹,等配置到达再分发
 *   G10 (issue#40) 用户曾关闭向导(tourDismissed)→ 配置允许也不自动弹
 * 另含源码守卫:first 卡渲染/分发/文案引用必须为 0;三个欢迎向导分支都必须过 allowTour 配置闸。 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }

console.log('[startup-dispatch] G0 源码守卫:first 卡已彻底移除 + 具名分发函数存在 + 配置闸在位')
ok(!/kind: 'first'/.test(SRC) && !/kind === 'first'/.test(SRC) && !/gFeat\d/.test(SRC) && !/guideTitle/.test(SRC),
  'first 卡渲染/分发/文案引用全部为 0')
// ★S9（2026-09-24）：签名加了第三个**可选**形参 wbReady（工作台是否就绪）。
//   语义不变：不传 ⇒ 视为「未知」⇒ 不延后更新通知（与该版本之前的行为逐字一致）。
//   守卫仍守「具名分发函数存在且可状态机驱动」，形参由 2 扩到「2 或 3」。
ok(/function dispatchStartupDialog\(d, cfg(?:, wbReady)?\) \{/.test(SRC), '具名分发函数存在(可状态机驱动,含宿主配置入参)')
ok(/function welcomeAutoAllowedPre\(cfg\) \{/.test(SRC), 'welcomeAutoAllowedPre 配置闸函数存在')
ok((SRC.match(/if \(allowTour && /g) || []).length === 3, '三个欢迎向导自动弹出分支全部经过 allowTour 配置闸')
ok(SRC.includes("var seenV = (dialogState && dialogState.currentVersion) || lastV")
  && SRC.includes("var seenV2 = (dialogState && dialogState.currentVersion) || lastV"),
  'update 卡 ✕/知道了 关闭写入 currentVersion(修复 seen 被钉回 0.1.30 的「每次打开都弹」死循环)')

// —— 抽取真实函数体 ——
function extractFn(header) {
  const start = SRC.indexOf(header)
  ok(start > 0, '源码定位成功: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    const ch = SRC[i]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  ok(end > start, '花括号配平抽取成功: ' + header)
  return SRC.slice(start, end + 1)
}
const fnSrc = extractFn('function dispatchStartupDialog(d, cfg, wbReady) {')
const allowPreSrc = extractFn('function welcomeAutoAllowedPre(cfg) {')

function run(current, storageMap, cfg, wbReady) {
  const factory = new Function('openDialog', 'cmpVersion', 'allowPreSrc', 'cfgJson', 'wbReady', `
    var MAJOR_TOUR_KEY = 'dsh-auto-memory.majorTourV130'
    var localStorage = {
      _m: new Map(${JSON.stringify([...(storageMap || [])])}),
      getItem: function (k) { return this._m.has(k) ? this._m.get(k) : null },
      setItem: function (k, v) { this._m.set(k, String(v)) },
      removeItem: function (k) { this._m.delete(k) },
    }
    var opened = []
    var queued = []
    function openDialog(d) { opened.push(d && d.kind) }
    var dialogQueue = { push: function (d) { queued.push(d && d.kind) } }
    function cmpVersion(a, b) {
      var pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
      for (var i = 0; i < 3; i++) { var x = pa[i] || 0, y = pb[i] || 0; if (x > y) return 1; if (x < y) return -1 }
      return 0
    }
    var CHANGELOG = { '2.1.0': { zh: [], en: [] }, '0.1.36': { zh: [], en: [] } }
    var apiGet = function () { return { then: function () { return Promise.resolve() } } }
    ${allowPreSrc}
    ${fnSrc}
    try { dispatchStartupDialog({ current: '${current}' }, JSON.parse(cfgJson), wbReady) } catch (e) { opened.push('THROW:' + (e && e.message)) }
    return { opened: opened, queued: queued }
  `)
  return factory(function () {}, function () {}, allowPreSrc, JSON.stringify(cfg === undefined ? null : cfg), wbReady)
}

const S = (k) => [k, '1']
const CFG_ON = { welcomeTourEnabled: true }

console.log('[startup-dispatch] G1 全新安装 current=0.1.37(无标记,配置允许)→ welcomeTour')
{
  const r = run('0.1.37', [], CFG_ON)
  ok(r.opened.length === 1 && r.opened[0] === 'welcomeTour', '新装首启弹 welcomeTour(修复:不再误落 first)')
}

console.log('[startup-dispatch] G2 新装已看完向导(wizDone+seen=current)→ 不再弹')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.37'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')], CFG_ON)
  ok(r.opened.length === 0, '看完向导后静默(seen===current)')
}

console.log('[startup-dispatch] G3 老用户 seen=0.1.29 升级且向导未看过 → welcomeTour')
{
  const r = run('0.1.37', [S('dsh-auto-memory.seenVersion') && ['dsh-auto-memory.seenVersion', '0.1.29']], CFG_ON)
  ok(r.opened.length === 1 && r.opened[0] === 'welcomeTour', '大更新补引导 welcomeTour')
}

console.log('[startup-dispatch] G4 老用户 seen=0.1.29 且向导已看过 → update')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.29'], S('dsh-auto-memory.semWizardDone')], CFG_ON)
  ok(r.opened.length === 1 && r.opened[0] === 'update', '看过向导 → 弹 changelog')
}

console.log('[startup-dispatch] G5 老用户 seen=0.1.36(有更新,向导看过)→ update')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.36'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')], CFG_ON)
  ok(r.opened.length === 1 && r.opened[0] === 'update', '版本推进 → 弹 changelog')
}

console.log('[startup-dispatch] G6 老用户 seen=current 且向导看过 → 不弹')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.37'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')], CFG_ON)
  ok(r.opened.length === 0, '已追平且看过 → 静默')
}

console.log('[startup-dispatch] G7 老用户 seen=0.1.39 升级到 2.1.0(跨大版本,向导看过)→ update')
{
  const r = run('2.1.0', [['dsh-auto-memory.seenVersion', '0.1.39'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')], CFG_ON)
  ok(r.opened.length === 1 && r.opened[0] === 'update', '跨大版本 → 弹 2.1.0 changelog')
}

console.log('[startup-dispatch] G8 issue#40: welcomeTourEnabled=false → 自动弹出全关')
{
  const rFresh = run('0.1.37', [], { welcomeTourEnabled: false })
  ok(rFresh.opened.length === 0, '全新安装 + 配置关闭 → 静默(修复:false 无效仍自动弹出)')
  const rOld = run('0.1.37', [S('dsh-auto-memory.seenVersion') && ['dsh-auto-memory.seenVersion', '0.1.29']], { welcomeTourEnabled: false })
  ok(!rOld.opened.includes('welcomeTour'), '老用户升级 + 配置关闭 → 补引导也不弹(更新日志卡不受向导闸管辖,issue#40 保留更新通知)')
}

console.log('[startup-dispatch] G9 issue#40: 宿主配置未知(cfg=null)→ 不自动弹')
{
  const r = run('0.1.37', [], null)
  ok(r.opened.length === 0, '配置未知 → 静默(等待 loadWelcomeConfigPre 回来后再分发,不猜默认值)')
}

console.log('[startup-dispatch] G10 issue#40: 用户曾关闭向导(tourDismissed)→ 配置允许也不弹')
{
  const r = run('0.1.37', [['dsh-auto-memory.tourDismissed', '1']], CFG_ON)
  ok(r.opened.length === 0, 'tourDismissed=1 → 静默(用户意愿优先于配置)')
}

// ── ★S9（2026-09-24）：工作台未就绪 ⇒ changelog **延后**（进 dialogQueue），不是丢弃 ──
console.log('[startup-dispatch] G11 S9: 工作台未就绪(wbReady=false)→ changelog 延后入队,不立即弹')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.36'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')], CFG_ON, false)
  ok(r.opened.length === 0 && r.queued.length === 1 && r.queued[0] === 'update',
    '未就绪 → 不弹但入队(配置完成后由队列送达)')
}
console.log('[startup-dispatch] G11b S9: 工作台已就绪(wbReady=true)→ changelog 立即弹')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.36'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')], CFG_ON, true)
  ok(r.opened.length === 1 && r.opened[0] === 'update' && r.queued.length === 0, '就绪 → 照旧立即弹')
}
console.log('[startup-dispatch] G11c S9: 就绪状态未知(缺省)→ 行为与本版之前逐字一致(立即弹)')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.36'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')], CFG_ON)
  ok(r.opened.length === 1 && r.opened[0] === 'update', '缺省(undefined) ⇒ 不延后(向后兼容)')
}

console.log(`[startup-dispatch] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
