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
