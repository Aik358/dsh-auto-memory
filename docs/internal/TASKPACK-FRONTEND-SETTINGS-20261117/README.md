# 前端任务包：记忆投递策略大模块

日期：2026-11-17。读者：GPT（执行者）。本包是 `PROMPT-GPT-DELIVERY-SETTINGS-20261117.md` 的附件，不含后端完整引擎实现。

## 目标
在现有插件设置里做一个**大模块「投递策略」**，替换零散的投递设置：入口卡片 → 二级页面 → 细节编辑，并带只读预览。

## 包内文件
| 文件 | 用途 |
|---|---|
| skills/01-frontend-construction-map.md | 前端构造全貌：生成器内外三区、双副本落点、守卫与基线 |
| skills/02-ui-guard-map.md | 改 UI 结构前先测绘字符串锚定守卫锁清单 |
| skills/03-line-ending-mixed-check.md | 改完文件必做行尾混用检测 |
| 03-SETTINGS-CONTRACT.md | IA（入口 + 7 子页）、Policy v2 模型、预览 API、旧键处置 |
| 04-ACCEPTANCE.md | A1–A14 验收判据 |

## 必读顺序
1. skills/01 决定你改哪个文件（生成源 / frozen / client.js 手写区）。
2. skills/02 产出 guard map（文件:行号 → 锁内容 → 是否撞锁 → 对策）。
3. 03 的 IA 与数据模型。
4. 04 的验收判据。

## 硬边界（违反即返工）
- 禁止对 `lib/client.js` / `skins/iter5/*` 做三方合并或社区 merge 式重构；只做定点修改。
- 禁止绕生成器改 GENERATED 区：生成源改 `skins/iter5/*`，跑 `node tools/build-iter5-skin.mjs --check --strict` 到 `SYNC-OK`。
- 设置模块只读写 `deliveryPolicy` 一个键；旧键只读影子，**不双写**。
- 诊断开关默认关闭；关闭时零字节、不读诊断日志。
- 节奏默认：slim 15、full 40（由后端迁移负责，前端只展示/编辑）。
- 水位默认：只开 25 档（50 默认关闭）；前端 fallback/placeholder/文案必须与后端 `'25'` 一致；显式 `'25,50'` 保留。
- 不改后端注入算法（除任务书列出的薄接线）；不新增网络请求；不写遥测。
- 双语文案跟随现有 `L()` / 字典机制；行尾按目标文件现状。

## 交付物
1. 入口卡片 + 7 子页（预设与节奏 / 模块 / 预算与超额 / 触发 / 诊断 / 预览与回执 / 兼容）。
2. 模块表：11 生产者 + 2 锁定段；`logs` 作 alias 不单列；`diagnostic` 单独开关（默认关）。
3. 旧控件：迁入新模块、移除废弃项（`slimPlanChars`/`slimLedgerChars`）、其余保留原处；同一语义不得两个可编辑控件。
4. 预览：调 P1 路由；无路由时 mock 并显式标注。
5. 回执：文件清单 + 行号 + sha256 + SYNC-OK 原文 + 截图路径 + A1–A14 逐项证据。
