# Minervaowl7 批次（13 issue + 11 PR）只读核实台账

> 2026-10-08 生成。基准 = 开发树 HEAD `167208f`（= **v3.2.11 发布版**，与报告指认的 `39a882d` 同源）。
> 三条只读车道并行核实（按域切分、文件不重叠），**全程未写任何产品文件**（`git status --porcelain -- lib tests skins tools` 为空）。

## 0. 批次背景

- **作者单一**：13 条 issue + 11 个 PR **全部来自 `Minervaowl7`**（与已合并的 #279/#280 同一人）。
- **PR ↔ issue 严格一一对应**（分支名 `codex/issue-NNN-minimal-*`），全部 `base=main`。
- **共同祖先停在 `e951d9eb @ 2026-09-30`** ⇒ PR 一律**不可三方合并**，只能逐条本机实现。

## 1. ★核心裁定：11 条缺陷**全部成立（A）**，无一误报

| issue | 级别 | 一句话缺陷 | 我方证据（file:line） | 核实方式 |
|---|---|---|---|---|
| **#285** | P1 | 后端硬信号可 arm，**前端仍按普通比例门**判显示 ⇒ 已 armed 却无确认卡（前后端资格判据**不同源**） | 后端门 `index.js:5256`（`!wl.hard && ...` 短路放行）；抬比 `:4918`（`armRatio = hard ? Math.max(ratio, threshold) : ratio`，抬到的是**动态水位建议阈值**而非 `autoContinueThreshold`）；`st.armed` `:5270-5285` **无 hard/reason**；投影 `:5537-5547` **无 hard/reason**；前端门 `client.js:17145` + `:17202`（`arm.ratio >= thr`） | 真跑：后端=true / 前端=false |
| **#286** | P1 | `awaitIdle` 用**跨会话 30s 全局活动窗**代替源回合状态 ⇒ 35s 静默长工具被误判空闲并 cancel | `index.js:5299-5307`（`busy = Date.now() - this._globalLastActiveAt < 30000`）；`:2227` 注释自述「**任意会话/工作区任一活动即更新**」；tick 内**零回合状态读取** | 真跑矩阵：静默 35s⇒执行接续；**其它会话活动反而挡住该接续的源会话**；5 次封顶属实 |
| **#288** | P1 | `lastOk` 分支**早返回**遮蔽当前 armed 的确认卡 | `client.js:17166-17199` 的 `return` **早于** `:17201` 的 `var arm = s.armed`；冷却 `min:1` 可配（`:12006/:15202/:18079`） | 真挂载组件：armed + 历史 lastOk ⇒ `confirmation=false`；对照 `lastOk=null` ⇒ `true` |
| **#289** | P2 | 轮询回调**无会话身份校验、无请求代次保护** ⇒ 迟到响应拉走其他会话 + 乱序恢复旧卡 | `client.js:17135`（第二处轮询仅 alive 检查）；`:17189-17196`（比较的是发起时捕获的 `sidQ`）；`:17201-17211`（无条件 `setAcConfirm`） | 真跑两点均复现：切到 B 后迟到 A 响应 ⇒ 拉走；旧 armed 晚到 ⇒ 旧卡恢复 |
| **#287** | P2 | 成功提示**无持久化** ⇒ 重挂载重播；过期不清 | 关闭身份只存 ref `client.js:17123`（写入点仅 `:17252`），**全文件无任何 localStorage 键**；过期分支不 return（`:17201-17202`） | 真跑：dismiss⇒重挂载⇒**再次出现**；+11 分钟⇒**仍显示** |
| **#290** | P2 | 模型继承失败**静默用默认模型**，回执仍报源模型 | `index.js:5439-5441`（失败只 diag、异常被吞）；`:5494` lastOk 与 `:5496` 返回体**无条件**复制请求值 | 真跑：selectModel 抛错 ⇒ `delivered=host-default` 但 `reported=source-model`、`error` 空、`completed=true` |
| **#291** | P1 | 转写文件名只取 `sid.slice(0,8)` + 秒级时间戳 ⇒ 同秒同前缀**互相覆盖** | `index.js:5921`（`prev-session- + sid.slice(0,8) + - + stamp`）；写入 `:5963` **无 `wx`** | 真跑：两 sid 同秒 ⇒ `samePath=true`，写后 **A 内容消失、B 覆盖** |
| **#302** | — | 长用户请求跨接续**被截断丢失** | 单条截断 `index.js:1354`（perMsg 2000）、调用参数 `:5910-5913`、转写正文 `:5952` | 真跑：2224 字符请求目标位于 ~2200 ⇒ `goalInCarry=false`、`goalInTranscript=false`；pack **不含 tailText** ⇒ 第 2 层恒不投递 |
| **#282** | Bug | 经典/默认档**浮层缺 CSS**（新组件配旧表） | `damSharedSurfaceCss()` `client.js:10253-10263`：`legacy`/`classic` **均返回旧表**；**逐选择器计数**：旧表 `[data-native-continuation]`/`[data-native-dialog]`/`.i5-native-notice`/`.i5-continuation-heading` = **0/0/0/0**，现行表 = **1/12/8/6**；`AutoContinueHost` `:17098` **无 flavor 分派** | 静态结构性证据（选择器计数） |
| **#283** | Bug | 检测弹窗 **content-box** ⇒ 新版外观横向越界 | 全局 border-box reset 唯一形态 = `[data-iter5] *{box-sizing:border-box}`；而 `DialogHost` 挂载链 `client.js:18576 → Iter5Surface :13511` 返回节点**不带 `data-iter5`**；全仓对 `[data-native-dialog]` 的 box-sizing 规则 = **0** | 属性链 + 规则枚举 |
| **#284** | Bug | 换肤后**共享 CSS 不同步** | 共享样式 effect 依赖数组 = **`[]`**（`client.js:13558`，生成源 `skins/iter5/surfaces.js:44` 同为 `[]`）；换肤只触发**重渲染**（改 `data-i5-style`）而非重挂载 ⇒ `#dam-shared-ui-style` 滞留旧档 | 依赖数组 + 生命周期链 |

## 2. 决策项（3 条，非缺陷或需拍板）

| issue | 裁定 | 现状与开工前置 |
|---|---|---|
| **#179** | **A 成立**（真缺陷） | `wsKey` `index.js:3289-3292` 与 `migrate-pack.js:37-40` **逐字同款** `'--' + replace(/[\\/:*?"<>|]/g,'-') + '--'`；真跑：`D:\ws\a-b` 与 `D:\ws\a\b` **同为 `--D--ws-a-b--`**。⇒ 缺**①升级时机 ②确认交互**（迁移 fail-closed ⇒ 用户会看到「记忆消失 + 每轮提示」） |
| **#201** | **A 成立**（真缺陷） | `CHUNK_POLICY_VERSION = 'm7_chunk_pre_v1'`（`m7_embedding_v1.py:31`）且**写入 `identity_block()`** `:371`；stale 判定 `worker_semantic_v1.py:239` 是 identity **全字段逐项相等** ⇒ 升 v2 后既有向量**全部判 stale**。⇒ 缺**①升级时机 ②发布说明口径**（BGE-M3 CPU 分钟级、重建期语义检索拒服务；JS 档零影响） |
| **#241** | **C 非缺陷**（确认） | 作者原文自述「这是维护成本的改进建议，**不是新发现的故障报告**」，无复现步骤；本仓对 `lib/client.js`/`skins/iter5/*` 有**禁止整块替换式重构**红线 |

## 3. 修复风险与前置约束（车道上报）

- **#284 不能只改 `lib/client.js`** —— 该 effect 在**生成区**，源是 `skins/iter5/surfaces.js`，须**两处同改**再跑 `build-iter5-skin.mjs`，否则生成器重跑会整段还原（本仓 2026-10-01 已因「修在被生成器覆盖的位置」吃过一次亏）。
- **#289 写回归前必须先给夹具开缝** —— 首版探针报 `opened=[]`（**假绿**），因 #278 夹具里 `sessions` 是硬编码空替身 `{ open: () => {} }`，被抽取的组件体闭包捕获它，外注入传不进去。判据：**补桩命中数断言 = 1**。
- **#290 附带产品语义待裁决** ——「继承失败后是否**停止投递**」是行为契约变更，不是改回执文案。两种口径：允许降级但**必须如实标注** / 未确认即**拒绝投递**。
- **#302 含新产物** —— 方案要求新增「不截断的原文文件」，**建议先定契约再动手**。
- **未过 DSH 桌面端到端验收** —— 三条前端项（#282/#283/#284）为源码级结构性证据；如需几何物理量（`getBoundingClientRect`）需另开 Playwright 实测轮。与报告者证据等级一致。
- **#286 修复可行性未验证** —— PR#294 依赖 `agents.get(sessionId).status`；本机未找到宿主包（asar 未解包、本仓无 `lib/types`）⇒ 该接口面**待核**。

## 4. 建议施工顺序（待用户拍板）

**批 A（P1 · 状态机正确性，落点均在 `lib/index.js` + `lib/client.js`）**：#286（忙闲判据）→ #285（前后端资格同源）→ #288（早返回遮蔽）→ #289（轮询代次/会话校验）
**批 B（数据完整性，纯 `lib/index.js`）**：#291（文件名冲突 + `wx`）→ #302（长请求保留）
**批 C（前端外观，`lib/client.js` + `skins/iter5/*`）**：#283（box-sizing，1 行级）→ #282（补旧档浮层 CSS）→ #284（生成器双写）
**批 D（提示与回执）**：#287（持久化）→ #290（模型继承如实回执，**待语义拍板**）
**单独立项**：#179 / #201（决策项，等用户定升级时机与说明口径）

**每批判据**（沿用）：`node --check` 全绿 + 本道专项套件真跑（含负路径变异必红）+ Lead 统一跑全量回归 `FAIL 0 / TIMEOUT 0` 且计数 ≥ 305 + commit message 点名该批。

## 5. 只读确认

- 三条车道：`git status --porcelain -- lib tests skins tools` **为空**；HEAD 仍 `167208f`；无 commit / push / git 写操作。
- 探针脚本全部写在**仓库外**（`D:\_lane-a-tmp\`、`D:\_lane2-probe\`、`D:\_lane281-patch\`）并已整体删除。
- 唯一 tracked 改动 = `package.json`（`3.2.10→3.2.11`，mtime 04:23）属**发版线**产物，与本批次无关。
- 过程瑕疵（如实记录）：-lane-256 读 issue 时曾误在仓库内落临时文件 `.diag-issues20261007/_lane282.txt`，已即刻删除（`Test-Path`=False，`git status` 无残留）。
