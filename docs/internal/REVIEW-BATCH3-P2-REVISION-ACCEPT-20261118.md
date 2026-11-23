# 批次3 P2 修正版复核：行为通过，余 1 项契约退回（2026-11-18）

## 结论
**P2 修正版主体行为通过**：F1（旧控件恢复可写，只在有效键范围内）、F2（未接线横幅）、F3（13 段开关恢复）、F4（40/15 与水位 25）均已核实。
仍有一项**契约退回**：externalInjectionChars 与 handoffPlanChars 这两个**当前无效的死键**被恢复成可编辑输入——与自己先前的裁定「dead 键只读兼容、不得做成可编辑控件」冲突，属假开关。需改为只读（显示当前值 +「当前无效」标注）。
另：回执物理量与最终工作树不符，需按实测更正。真实宿主 a11y/截图仍未验证。

## Lead 独立复跑（最终工作树）
| 套件 | 自报 |
|---|---|
| T1 prompt sections | 59 / 0 |
| delivery settings UI | 20 / 0 |
| gap-rounds 三面 | 56 / 0 |
| frozen mirror | 37 / 0 |
| client loadable | 34 / 0 |
| i335 settings entry | 32 / 0 |
| r26 cross layer | 26 / 0 |
| settings parity | 110 键 × 3 面，0 FAIL |
| iter5 / 水位 / settings-sync / s2 / batch-Y | 退出码 0 |

build-iter5-skin --check --strict → SYNC-OK；verify-docs 22 / 87 / 182；lib/index.js 导出 41；后端六个文件 sha16 与 P1 一致。

## 最终树实测（Lead 复算）
- lib/client.js 3,018,587 B / 27,060 行 / 纯 CRLF（bareLF 0）/ sha256 5c574cf276fac8e4…
- policy-settings.js 63,968 B / 877 行 LF；frozen 357,811 B / 2,537 行 LF
- 三面节奏 fallback 40/15（各 3 处）；水位 placeholder 25（3 面 + 策略页）
- set('promptSectionToggles') 6 处（3 面 × 开关 + 恢复）；legacyPolicyKeys 已删除
- 保存仍 { deliveryPolicy }；预览仍 policy|tier|isHuman|isFull
- 三面挂载齐全：skins/iter5/surfaces.js:420（宿主）、lib/client.js:17567/20553/24010、frozen :866/1329

## 待修（F5）
**死键必须只读**：externalInjectionChars（lib/index.js:13611-13616 注释明确「完全无效、已删死变量」）与 handoffPlanChars（lib/index.js:12967 赋值给 _fullBudget，而 _fullBudget 全仓无消费点）都属当前无效键。
- 三面设置模板：这两个键改为只读展示（值 + 「当前无效（历史键）」标注），不得提供可编辑输入。
- UI 守卫：把 17 键断言拆成 **15 个有效键可编辑 + 2 个死键只读**；负路径：把死键做成可编辑 ⇒ 必红。
- 兼容页可保留它们的只读说明；不得用可编辑控件伪装生效。

## 需更正的文档
回执写 27,089 行 / 3,015,548 B / sha256 93b45595…、policy 907 行、frozen 2,536、UI 17/0；最终树实测为 27,060 行 / 3,018,587 B / sha256 5c574cf276fac8e4…、policy 877、frozen 2,537、UI 20/0。回执需按最终树更新并复跑一次。
git diff --check 的 1071 条告警主要来自 CRLF 文件在 eol=lf 属性下的 CR 假红（client 950 条、index 114 条；HEAD blob 本身即 CRLF），不是真实尾随空格；回执不应写「通过」而不说明这一点（README 两处为真实告警，需清理）。

## 视觉小项（不阻塞，建议 P3 一并收）
- 390px 窄窗：页签条右侧被裁（「预览与回…」），需滚动提示或换行。
- 子页顶部与页头显示同一条「生效范围」横幅两次，信息重复。
- 编辑器内同时存在「保存策略」（策略草稿）与底部「保存设置」（页面草稿）两个保存动作，作用域需区分或合并提示。

## 未验证（不得并入通过）
- 真实 DSH 宿主截图 / a11y 树。
- classic 独立运行时入口（当前为生成器模板；实际可达面是 v4 / frozen）。
- 策略模块/预算/触发尚未接入真实注入（UI 横幅已如实披露；这是 P3 的目标）。

## 下一步
P3 分两段、一次重启：
- P3-0（只读测绘，GPT）：按 PLAN §6「deliveryPolicy 为唯一写入源、旧键只读影子」测绘生产接线面（CA 节奏、11 模块选择/表示、预算/transport、legacy 回退），产出接线映射回执，不改生产。
- P3-A（代码）：按回执接线；随后旧控件转为只读影子（回滚方式 = 删除 deliveryPolicy）。
- P3-B（Lead）：真实宿主重启后，三入口 a11y + 截图 + 真实会话注入 + 全量回归（--jobs=8）。

## 追加（2026-11-18 第二次复审）：F5 关闭，P2 通过

- 死键只读已核实：externalInjectionChars / handoffPlanChars 在三面均为静态只读行（client.js:18390/18486、22953/23050、26189/26286），带「当前无效（历史键）」标注，无 input/select/button 与 set() 写路径；保存值（含显式 0）原样显示。
- UI 守卫 21/0（真挂载 + 真回调）；F5 变异：把两键分别改回可编辑输入，三面及 Frozen 内嵌镜像共 8 个变异全部被检出。
- 有效旧键仍为 15 个可编辑；`git diff --check` 默认 1,072 条均为 CRLF 在 eol=lf 下的 CR 假红（`git -c core.whitespace=cr-at-eol diff --check` 退出 0；HEAD blob 本身 CRLF）。
- 最终树：`lib/client.js` 27,060 行 / 3,017,717 B / sha256 f9a3119cb466fe1a… / 纯 CRLF / 14 factory 导出；`build-iter5-skin --check --strict` = SYNC-OK；verify-docs 22/87/182；后端六文件 sha16 与 P1 一致。
- **P2 状态：通过。** 真实宿主 a11y/截图仍归 P3-B，不并入本轮通过。
