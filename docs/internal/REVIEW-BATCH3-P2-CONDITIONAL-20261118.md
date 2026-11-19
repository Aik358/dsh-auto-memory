# 批次3 P2 复核：有条件退回（2026-11-18）

性质：Lead 对 P2 交付的独立复核。结论：**P2 代码质量合格，但产品行为不合格，暂不通过；按 F1–F4 修正后可复审。**

## 0. 已独立核实的通过项

| 项 | 实测 |
|---|---|
| 生成器严格检查 | `node tools/build-iter5-skin.mjs --check --strict` → `SYNC-OK` |
| 计数 | 工具 22 / 路由 87 / 配置键 182；`lib/index.js` 导出 41 |
| 文件形态 | `lib/client.js` 3,020,831B / 27,105 行 / 全 CRLF；`skins/iter5/policy-settings.js` 896 行 / LF；frozen 2,545 行 / LF |
| P1 后端未被动 | index/policy-v2/preview/diagnostics/cadence/dto 的 sha16 与 P1 验收时逐字节一致 |
| 组件单一实现 | 共享源 1 份，三面通过 `policySettings` props 接入（client.js:17567/20561/24046/25941、surfaces.js:420、frozen:1344） |
| 保存/预览 | 保存只发 `{ deliveryPolicy }`（policy-settings.js:883）；预览只发 policy/tier/isHuman/isFull（:885 起） |
| 水位默认 | 三处 placeholder/fallback 已是 `25`（client.js:18417/23005/26250），settings-copy 文案已改 |
| 相关守卫 | 我复跑 8 套件（UI/T1/水位/parity/frozen-mirror/iter5/client-loadable/i335）退出码 0 |

## 1. 不通过的三条产品缺陷

### D1（阻断）旧的**有效**投递控件被全部禁用，而新控件尚未接线 ⇒ 用户改不了任何真实投递行为

- `legacyPolicyKeys` 17 个键（`client.js:17951 / 22561 / 25852`），渲染时被 `React.cloneElement(control, { disabled: true, 'data-policy-legacy-readonly': legacyKey })` 禁用（`:17963 / 22566 / 25857`）。
- 覆盖节奏（`snapshotMinGapRounds`、`slimEveryRounds`）、水位（`fullInjectWaterPct`）、预算（`injectBudgetChars` 等）、开关（`injectEnabled`、`handoffEnabled` 等）。
- 新 UI 把它们"迁入"了 `deliveryPolicy`，但**生产只消费 policy 的 diagnostics 一项**（`lib/index.js:13684-13688`）；模块/预算/触发字段对真实注入零影响。⇒ 新控件是假开关，旧控件被禁 ⇒ **投递设置在界面上完全失效**。

### D2（阻断）13 个 prompt section 的编辑能力被删除，且守卫被改写成"只读即正确"

- HEAD 三面各有可编辑开关 + 「全部恢复全开」，写 `set('promptSectionToggles', …)`（HEAD 实测 3 处 ×2）。
- 当前三面只剩只读清单：全仓 `set('promptSectionToggles'` 命中 0；T1 守卫被改成断言 `disabled: true` 且无 set 按钮（`smoke-test-t1-prompt-sections.mjs` 新增 G5b-G5f）。
- 这与用户"设置里直接选择有哪些投递点"的核心诉求、以及 2026-09-22 的 T1 裁定直接冲突。把回归写成新判据不能使其成立。

### D3（应修）前端节奏 fallback 仍是 20 / 8，与 R2 的 40 / 15 不符

- `client.js:18406 / 18410`、`:22997 / 23008`、`:26242 / 26253` 仍是 `=== undefined ? 20` / `? 8`。水位已改 `25`，节奏漏改。
- 另有两处过期注释仍写「默认 25,50」（`:22998 / :26243`）。

## 2. 修正要求（F1–F4，全部完成后复审）

**F1 恢复旧的有效控件可编辑**：移除 `legacyPolicyKeys` 的 `disabled: true` 克隆（或把机制改为仅加说明、不禁用）。17 个键在三面必须可写；这是 P3 接线完成前唯一真实生效的控制路径。

**F2 新策略编辑器加"未接线"明示**：页头与「模块 / 预算与超额 / 触发」三个子页加显著 badge/横幅：
> 当前策略仅用于预览与回执（以及诊断开关）；真实注入尚未接入，实际投递仍由原设置控制。
保存成功的提示必须同义，不得让用户以为已生效。P3 完成接线后再撤掉该提示并移除旧控件（需用户裁定）。

**F3 恢复 13 段开关**：三面恢复每个 section 的可编辑开关与「全部恢复全开」；只读 registry 可以保留为信息展示，但不得作为唯一形态。

**F4 前端默认与守卫**：
- 节奏 fallback 改 `40` / `15`（三面），过期注释改 `25`；
- T1 守卫恢复"可编辑"断言（`set('promptSectionToggles'` 命中 + 恢复按钮存在）；
- 新增守卫：对 `legacyPolicyKeys` 每个键，三面至少存在 1 个**可编辑**控件（`set('KEY'` 且 `disabled !== true`）；负路径：只读注入 ⇒ 必红；
- 新增守卫：策略 UI 的"未接线"横幅存在且保存提示同义（负路径：删除横幅 ⇒ 红）。

## 3. 说明与边界

- **SettingsPage 无运行时调用点**：HEAD 同样只有定义（`git show HEAD:lib/client.js` 仅 1 处定义、0 调用），属既存事实；但回执不应把 classic 模板说成"运行时三面一致"，P3 验收只认实际可达面。
- **真实宿主 a11y/截图未验证**：不阻塞本轮修正，但阻塞最终验收（P3 必做）。
- **P1/P2 均未提交**：提交裁决仍待用户；P2 修正不依赖提交。
- 责任说明：P2 提示词只写「旧控件迁入新模块」，未写"新模块未接线前旧控件必须保持可编辑"——这是 Lead 侧契约缺口，P3 提示词将补齐该条。

## 4. 复审判据

F1–F4 落地后，Lead 复跑：`SYNC-OK`、T1、UI 守卫、水位守卫、parity、frozen-mirror、iter5、client-loadable、i335、settings-sync、s2-panels、batch-y、r26；并逐条确认：旧有效控件可写、新编辑器横幅存在、节奏 fallback 40/15、只读清单不是唯一形态。
