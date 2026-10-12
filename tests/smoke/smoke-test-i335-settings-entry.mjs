#!/usr/bin/env node
/**
 * smoke-test-i335-settings-entry.mjs —— #335 吸收（2026-10-12 用户裁定「都放」+ 可关）：
 * 设置入口三处落点的**可达性契约**与**双关纠错**。
 *
 * 用户裁定原文：「(B) 都放，并且在设置里的外观与目录界面加设置让用户决定是否在官方设置页面暴露设置？
 *   是否在插件界面暴露设置？记忆面板里的设置默认常驻。」
 *
 * 本套件**真执行**（不是源码字符串断言）：
 *   ① 从 lib/index.js 抽取 DEFAULT_CONFIG 字面量并**求值**，断言两个新键存在、默认 true，
 *      且落在 POST /config 的白名单口径（= Object.keys(DEFAULT_CONFIG)）内 —— 这是「设置了能不能存下来」的前提；
 *   ② 从 lib/client.js 抽取 settingsEntryPre() **真调用**四档配置，断言分流与**双关纠正**；
 *   ③ 负路径：把纠正逻辑打坏（忠实回退为「双关也照实返回 false」）后必须变红。
 *
 * 纪律：只读产线源码 + 沙箱求值，零运行时变化（本套件不随包发布）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import pathModule from 'node:path'

const ROOT = pathModule.join(pathModule.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
const IDX = readFileSync(pathModule.join(ROOT, 'lib', 'index.js'), 'utf8')
const CLI = readFileSync(pathModule.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('PASS ' + label) }
  else { fail++; console.log('FAIL ' + label) }
}
const DS = 'settingsEntryInDsSettings', PG = 'settingsEntryInPluginsPage'

// ── ① DEFAULT_CONFIG 真求值（Proxy 沙箱吸收未定义标识符，只取对象字面量本身）──
const cfgLiteral = /const DEFAULT_CONFIG = \{[\s\S]*?\n\}/.exec(IDX)
assert(cfgLiteral, 'settings: 必须能从 lib/index.js 抽出 DEFAULT_CONFIG 字面量')
const sandbox = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : 0) })
const DEFAULT_CONFIG = new Function('sandbox', 'with (sandbox) { ' + cfgLiteral[0] + '; return DEFAULT_CONFIG }')(sandbox)
const whitelist = Object.keys(DEFAULT_CONFIG)

ok(DEFAULT_CONFIG[DS] === true, '① 配置键 ' + DS + ' 存在且默认 true（出厂即暴露）')
ok(DEFAULT_CONFIG[PG] === true, '① 配置键 ' + PG + ' 存在且默认 true（出厂即暴露）')
ok(whitelist.includes(DS) && whitelist.includes(PG), '① 两键在白名单内（POST /config = Object.keys(DEFAULT_CONFIG)）⇒ 用户改动能落盘')
ok(!whitelist.includes('settingsEntryInDsSetting'), '① 负路径：少一个 s 的错键名**不在**白名单（证明①的判据有鉴别力，非恒真）')
ok(whitelist.length > 50, '① 白名单规模合理（' + whitelist.length + ' 键）⇒ 抽取未截断')

// ── ② settingsEntryPre 真调用 ──
// ★2026-10-12 自检修复：settingsEntryPre 现委托 settingsEntryEffectivePre（双关纠正已抽出成独立函数），
//   故必须**两个一起**抽取求值，否则被测函数引用不到 helper（该套件曾正确报红此重构回归）。
const fnEff = /function settingsEntryEffectivePre\(c\) \{[\s\S]*?\n      \}/.exec(CLI)
const fnSrc = /function settingsEntryPre\(key\) \{[\s\S]*?\n      \}/.exec(CLI)
assert(fnEff && fnSrc, 'settings: 必须能从 lib/client.js 抽出 settingsEntryEffectivePre 与 settingsEntryPre')
const makeGuard = (cfg, override) => {
  let body = fnEff[0] + '\n' + fnSrc[0]
  if (override) body = override(body)
  return new Function('console', 'var settingsEntryCachePre = ' + JSON.stringify(cfg) + ';' + body + '; return settingsEntryPre')({ warn: () => {} })
}
const bothOn = makeGuard({})
ok(bothOn(DS) === true && bothOn(PG) === true, '② 未设置时两个 DSH 入口都放行（默认暴露）')
const dsOff = makeGuard({ [DS]: false })
ok(dsOff(DS) === false && dsOff(PG) === true, '② 只关「DSH 设置页」时，仅该入口隐藏，插件页入口不受影响')
const pgOff = makeGuard({ [PG]: false })
ok(pgOff(PG) === false && pgOff(DS) === true, '② 只关「插件页」时，仅该入口隐藏，DSH 设置页入口不受影响')
const bothOff = makeGuard({ [DS]: false, [PG]: false })
ok(bothOff(DS) === true && bothOff(PG) === true, '② ★双关纠正：两个都关时强制回到都开（否则用户在 DSH 侧一个设置入口都找不到）')

// ── ③ 负路径：忠实回退「纠正」逻辑 ⇒ 必红 ──
const broken = makeGuard({ [DS]: false, [PG]: false }, (s) => s.replace(/if \(!ds && !pg\) \{[\s\S]*?return \{ ds: true, pg: true \}\s*\}/, ''))
ok(broken(DS) === false && broken(PG) === false, '③ 负路径：忠实回退双关纠正后，两个入口确实都被隐藏（证明②的纠正断言有鉴别力）')

// ── ③b ★#335b（2026-10-12 修正）：**插件管理页详情页**是独立槽位族，与「设置 → 插件」分区无关 ──
//   根因：初版把 `settings.plugins.tab` 当成「插件界面」，实际它住在 DSH 设置里的插件分区；
//   用户在左侧栏「插件」看到的**插件管理页**走的是 `plugins.*` 槽位（详情页扩展点是 plugins.detail.section）。
ok(CLI.includes("slots.inject('plugins.detail.section'"), '③b 已向**插件管理页详情页**注册（plugins.detail.section）')
ok(CLI.includes("subj.pkg.name !== '@a9i5k4/dsh-auto-memory'"), '③b 按包名认领：非本包的 subject 不渲染')
ok(/subj\.kind !== 'bundle'/.test(CLI), '③b 仅认领 bundle 形态（row/item 不渲染）')
ok(/plugins\.detail\.section[\s\S]{0,400}return null/.test(CLI), '③b 对无关 subject 返回 null（宿主契约硬要求）')

// ── ③c 认领逻辑**真执行**：真跑到注册出的组件并断言返回值（不是源码字符串断言） ──
//   复用本套件既有的 vm 装载方式太重；这里直接从产线源码抽出该组件体求值，
//   断言四条负路径 + 一条正路径 —— 与 .diag 探针同口径，但固化为永久断言。
// 精确边界：组件体止于 `})` + `}))`（用「本包名 」这一行之后的收尾做终点锚，避免吞掉后续代码）
const fnDetail = /function \(props\) \{[\s\S]*?\r?\n            \}\)/.exec(
  CLI.slice(CLI.indexOf("slots.inject('plugins.detail.section'")),
)
ok(!!fnDetail, '③c 能从产线源码抽出 plugins.detail.section 的渲染函数')
if (fnDetail) {
  // 把组件体做成可调用函数：h 与 t 用替身，null 语义保持
  // 只去掉 slots.register( 的收尾右括号 ⇒ 片段以函数体的 `}` 结束
const body = fnDetail[0].replace(/\)$/, '')
  // Iter5HostSettings 用「哨兵」替身：走到渲染分支即抛该哨兵，借此区分「返回 null」与「进入渲染」
const SENTINEL = 'REACHED_RENDER'
const Iter5HostSettingsStub = function () { throw new Error(SENTINEL) }
const make = () => new Function('h', 't', 'Iter5HostSettings', 'return (' + body + ')')((tag, p) => ({ tag, p }), (k) => k, Iter5HostSettingsStub)
// 判定：null ⇒ 未认领；抛 SENTINEL ⇒ 已认领并进入渲染
const claim = (subject) => { const f = make(); try { return f({ subject }) === null ? 'null' : 'rendered' } catch (e) { return String(e && e.message) === SENTINEL ? 'rendered' : 'throw:' + (e && e.message) } }
const callClaim = (subject) => claim(subject) === 'rendered' ? {} : null
  ok(callClaim({ kind: 'item', id: 'x' }) === null, '③c 真执行：item 形态 ⇒ null')
  ok(callClaim({ kind: 'bundle', pkg: { name: 'other-pkg', rows: [] } }) === null, '③c 真执行：他包 ⇒ null（防越权认领）')
  ok(callClaim({ kind: 'row', pkg: { name: '@a9i5k4/dsh-auto-memory' }, row: {} }) === null, '③c 真执行：row 形态 ⇒ null')
  ok(callClaim(null) === null && make()({}) === null, '③c 真执行：无 subject ⇒ null')
  ok(callClaim({ kind: 'bundle', pkg: { name: '@a9i5k4/dsh-auto-memory', version: '3.3.0', installed: true, enabled: true, rows: [] } }) !== null, '③c 真执行：本包 bundle ⇒ 渲染')
}

// ── ④ 落点接线：三处，且两处 DSH 入口受 helper 控制、面板入口常驻不可关 ──
ok(CLI.includes("if (settingsEntryPre('" + DS + "')) surfaceDisposers.push(slots.inject('settings.section'"), '④ DSH 设置页入口受 helper 控制（可关）')
ok(CLI.includes("if (settingsEntryPre('" + PG + "')) surfaceDisposers.push(slots.inject('settings.plugins.tab'"), '④ DSH「插件」页入口受 helper 控制（可关）')
ok(/name: 'settings\.plugins\.tab'[\s\S]{0,240}Iter5HostSettings/.test(CLI), '④ 插件页与设置页**共用同一组件** Iter5HostSettings ⇒ 天然同源、同一份配置')
ok(!CLI.includes("slots.inject('settings.plugins.tab', function () {\n            return slots.register"), '④ 负路径：插件页注册**不得**绕开 helper 无条件注册')
ok(CLI.includes('controller.subscribe(function () { void refreshSettingsEntryCachePre() })'), '④ 缓存订阅既有广播总线 ⇒ 任一入口保存后其余入口即时同步')
// ★2026-10-12 自检修复：判据跟着实现演进（新增「只在有效值变化时才重注册」+ 单飞），
//   但守住的原事故不变 = 「关掉开关当场消失，无需刷新」。窗口放宽到 1600 是因为函数内新增了注释与判定。
ok(/function refreshSettingsEntryCachePre\(\) \{[\s\S]{0,1600}surfacesRefreshHook/.test(CLI), '④ 缓存刷新后按需重注册 slot ⇒ 关闭开关当场消失（无需重启/刷新）')
ok(/settingsEntryInflightPre/.test(CLI), '④ 接入全量广播总线时做了**单飞**去重（emit() 27 个调用点含拖动/缩放等高频路径，防拖动时持续发请求）')
ok(/prev\.ds === e\.ds && prev\.pg === e\.pg/.test(CLI), '④ 仅在入口开关**有效值变化**时才重注册 slot（高频广播退化为零 slot 重建）')
ok(CLI.includes("set('" + DS + "', e.target.checked)") && CLI.includes("set('" + PG + "', e.target.checked)"), '④ 外观与目录界面确有这两个开关（用户裁定的落点）')
ok(!CLI.includes('settingsEntryInPanelTab') && !CLI.includes('settingsEntryInPanel'), '④ 负路径：**未**为「记忆面板设置页签」引入开关（用户裁定「默认常驻」）')

console.log('--- ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
