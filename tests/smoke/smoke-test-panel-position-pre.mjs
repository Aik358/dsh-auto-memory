/**
 * 记忆承载面「左下角浮层 × 会话页」双形态验证 —— 纯源码守卫,不起浏览器。
 *
 * 演进史(重要,防回退):
 *   v1(2026-09-21 首版)把第二承载面做成 shell.overlay 里的「顶部通栏覆盖条」。
 *   用户实测否定,原话:「它现在是浮在整个页面上方的,而不是和对话轨迹、上下文、白板看板在一起,作为一个单独的一页」。
 *   根因:宿主只给插件 4 个槽位(sidebar/main/rightbar/shell.overlay),overlay 里的东西只能"盖"在界面上,
 *        做不出并列的一页 ⇒ 要成为并列页必须注册到 conversation.view(官方对话轨迹与本插件白板看板都这么做)。
 *   v2(本版)第二承载面 = conversation.view 会话页。
 *
 * 断言目标(用户诉求):
 *  ① 两档承载面:bottom-left(浮层) / page(会话页) / both 共存;旧值 'top' 自动迁移到 'page';
 *  ② 两种承载面共享同一份状态(模块级 panelTab + 同一 MemoryTabBody/MEMORY_TABS)⇒ 天然同步;
 *  ③ 会话页注册在 conversation.view(与对话轨迹/白板看板并列),且随承载面切换即时增删;
 *  ④ 覆盖条形态不得复活(data-pos="top" / 标题栏变量同步等残留必须为 0);
 *  ⑤ 设置页切档必须当场可见(关闭态自动打开 + 重注册页签)。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ FAIL: ' + msg) } }
const eq = (a, b, msg) => ok(a === b, msg + (a === b ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`))

console.log('== 1. 双承载面共享同一份状态（不是抄两份实现） ==')
ok(/var pos = controller\.panelPos\(\)/.test(SRC), 'MemoryPanel 读取 controller.panelPos()')
ok(/var panelTab = 'overview'/.test(SRC), '页签状态是模块级共享变量（浮层与会话页同源）')
ok(/function setPanelTab\(v\) \{ if \(panelTab !== v\) \{ panelTab = v; emit\(\) \} \}/.test(SRC), 'setPanelTab 改状态即 emit ⇒ 两处同时重渲染')
ok(/panelTab: function \(\) \{ return panelTab \}/.test(SRC), 'controller.panelTab() 暴露给会话页')
ok(/var tab = controller\.panelTab\(\)\s*\n\s*var setTab = controller\.setPanelTab/.test(SRC), 'MemoryPanel 用共享页签（不再各自 useState）')
ok(/function MemoryPageView\(props\)/.test(SRC), '存在会话页组件 MemoryPageView')
ok(/var tab = controller\.panelTab\(\)/.test(SRC), '会话页也读同一份共享页签')
ok(/function MemoryTabBody\(tab, nonce\)/.test(SRC), '内容体抽成共享工厂 MemoryTabBody（一处事实,防漂移）')
ok(/function MEMORY_TABS\(\)/.test(SRC), '页签表抽成共享工厂 MEMORY_TABS')
// 只数「调用」（前面不是 function 声明）:定义处 `function MemoryTabBody(` 不算
const bodyReuse = (SRC.match(/(?<!function )MemoryTabBody\(tab, nonce\)/g) || []).length
eq(bodyReuse, 2, '浮层与会话页各调用一次 MemoryTabBody（同一内容源）')
const tabsReuse = (SRC.match(/(?<!function )MEMORY_TABS\(\)/g) || []).length
eq(tabsReuse, 2, '浮层与会话页各调用一次 MEMORY_TABS（同一页签源）')

console.log('== 2. 承载面三档 & 持久化 & 旧值迁移 ==')
ok(/var POS_KEY = 'dsh-auto-memory\.panel\.pos'/.test(SRC), 'pos 使用独立 localStorage key（与 geom/pin 解耦）')
ok(/var PANEL_POS_VALUES = \{ 'bottom-left': 1, page: 1, both: 1 \}/.test(SRC), '合法值枚举受控（bottom-left | page | both）')
ok(/if \(savedPos === 'top'\) savedPos = 'page'/.test(SRC), '旧值 top(覆盖条) 自动迁移为 page（老用户不必手动重选）')
// ★2026-09-22 期望值更新:默认承载面由 'bottom-left' 改为 'both'(用户拍板:出厂即两者共存,
//   用户更新后能在会话页顶栏直接看到「记忆」窗口,不必先去设置里找)。
//   判据本身不变:非法值必须回落到**默认档**,不能变成 undefined/空串。
ok(/panelPos = PANEL_POS_VALUES\[v\] \? v : 'both'/.test(SRC), '非法值回退默认档 both')
ok(/panelPos: function \(\) \{ return panelPos \}/.test(SRC), 'controller.panelPos() 暴露给设置页')

console.log('== 3. 「会话页」注册在 conversation.view（与对话轨迹/白板看板并列） ==')
ok(/slots\.inject\('conversation\.view', function \(\) \{[\s\S]{0,300}id: 'auto-memory-panel'/.test(SRC), '记忆页注册到 conversation.view,id=auto-memory-panel')
ok(/label: function \(\) \{ return locale === 'zh' \? '记忆' : 'Memory' \}/.test(SRC), '页签标签中英双语')
ok(/if \(controller\.panelPos\(\) === 'page' \|\| controller\.panelPos\(\) === 'both'\)/.test(SRC), '仅 page/both 档才挂该页签')
ok(!/slots\.register\(\s*\{[^}]*'shell\.overlay'[^}]*label/.test(SRC), '不得再往 shell.overlay 注册带 label 的"第二页面"（那是覆盖层,做不出并列页）')

console.log('== 4. 覆盖条形态不得复活（v1 废弃物零残留） ==')
ok(!/data-pos': 'top'/.test(SRC), '不存在 data-pos="top" 停靠条节点')
ok(!/\[data-dam-panel\]\[data-pos="top"\]/.test(SRC), '不存在 [data-pos="top"] 的 CSS 规则')
ok(!/posTop:/.test(SRC), 'i18n 无 posTop（已被 posPage 取代）')
ok(!/syncTitlebarVar/.test(SRC.replace(/\/\/[^\n]*syncTitlebarVar[^\n]*\n/g, '')), '标题栏变量同步函数已删除（覆盖条专用,无消费者）')
ok(!/dsh-windows-titlebar-height/.test(SRC.replace(/\/\/[^\n]*\n/g, '')), '不再依赖 --dsh-windows-titlebar-height')

console.log('== 5. 切档即时可见（2026-09-21 用户实测故障回归） ==')
ok(/setPanelPos: function \(v\) \{[\s\S]{0,300}localStorage\.setItem\(POS_KEY/.test(SRC), '切换写入 localStorage')
ok(/setPanelPos: function \(v\) \{[\s\S]{0,900}if \(surfacesRefreshHook\) surfacesRefreshHook\(\)/.test(SRC), '切档时重注册承载面（页签当场增/删,不必重启）')
ok(/setPanelPos: function \(v\) \{[\s\S]{0,900}if \(!panelOpen\) controller\.open\(\)/.test(SRC), '面板关闭时自动 open()（否则切档无任何可见变化）')
ok(/setSurfacesRefreshHook\(refreshSurfaces\)/.test(SRC), 'refreshSurfaces 已挂到模块级钩子')
ok(/if \(!panelOpen && !panelClosing\) return null/.test(SRC), '（已知约束）浮层关闭时组件返回 null ⇒ 故必须有上面的自动打开')

console.log('== 6. i18n 两语 ==')
for (const k of ['fPanelPos', 'fPanelPosHint', 'posBottomLeft', 'posPage', 'posBoth']) {
  ok(new RegExp('\\b' + k + ": '[^']+'").test(SRC), `${k} 中文文案存在`)
}
ok(/\bposPage: 'Session page/.test(SRC), 'posPage 英文文案存在')
ok(/\bfPanelPos: 'Memory surface'/.test(SRC), 'fPanelPos 英文文案存在')
ok(!/\btop full-width bar\b/.test(SRC), '英文提示不再提「top full-width bar」')

console.log(`\n[panel-surface] PASS ${pass} / FAIL ${fail}`)
process.exit(fail ? 1 : 0)
