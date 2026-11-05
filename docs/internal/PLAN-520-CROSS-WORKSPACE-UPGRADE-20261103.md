# B 级规划 v2 · 中枢特权跨区整理（#520）

> 2026-11-03 · 已按用户三条裁定重写（v1 的「改 parent 优先级」方案**作废**）
> 本文件只出方案，不含实现改动。

## 0 · 用户裁定（2026-11-03，本规划的前提）

| # | 裁定 | 对设计的影响 |
|---|---|---|
| 1 | **记忆中枢工作区本身就是完全权限的** | 权限模型 = 「中枢是唯一可跨区写的身份」，不是"引擎特权"，也不是"给模型开放任意 ws" |
| 2 | **subagent 逻辑就是加在「记忆中枢」工作区里的** | 子代理固定挂中枢是**设计意图**；#520 建议的「parent 优先级改为调用方优先」**不采纳**（那会把子代理拽出中枢，破坏设计） |
| 3 | **默认范围让用户在弹窗里选，并做好备注说明** | 新增前端范围选择（仅当前 / 全部）+ 成本与影响面说明 |

## 1 · 本机跨区之谜的结论（沿用 v1 证据）

本机 2026-10-27 那批「12 个工作区已迁移」**不是 upgrade 子代理写的**：
15 事件跨 2 区在 46ms 内写完（代码循环）／`upgrade-state` 那个 job 自述"只做读盘核验"／
窗口内 22 个子代理会话 cwd 全为中枢／引擎层 `writeStorePre(storePath)` 接受显式路径。

## 2 · 根因重排：两条独立缺陷，D2 比 D1 更硬

### D1 · 跨区写没有通道（#520 主体）

前端只传 `ws` 不传 `sessionId` → 后端按空 sid 解析 agent → 回退 `_workbenchParent`（这符合裁定 2）
→ 子代理 cwd = 中枢 → 写工具 `resolvePaths(exec.agent)` 绑中枢 → 目标工作区永远写不进去。

**性质**：不是"子代理挂错地方"，而是**"中枢会话缺少显式目标工作区的写入通道"**。

### D2 · legacy 判据把「status 行」当结构缺陷（本轮修正版，证据见 VERIFY-520-CONCLUSIONS-20261103.md）

`lib/rules-layer.js:515`：`legacy = !anchors || !statuses`（`events` 只进 reasons，不参与判定）。

status 行是怎么来的（实测）：
- `engine.appendText()` → `MemoryDocumentStore.append()` → `appendAnchoredRecord()` ⇒ **每条新追加记录自带
  `<!-- dsh-status: current -->`**（`memory-writer.js:145-146`，2026-10-27 F1(a) 拍板）；
- 但**没有给存量已锚定条目回填 status 的路径**：`applyMigrationPlan` 只插锚点（`markerBuf` 不含 status），
  `memory_user(action='replace')` 走 `renderReplace` 反而会丢 status；
- **升级/迁移流程不写 MEMORY.md**（v7 提示词只写事件库 + 白板）。

⇒ 精确后果：**「有锚点 + 0 status」的库，整理成功后 `legacy` 仍为 true ⇒ 弹窗不退，是真死循环**；
该库只有在之后碰巧追加过一条笔记/用户记忆时才会自愈（statuses 变 1）——不是迁移带来的，是运气。
（#520 报告人 78 条、有锚点、无 status 正属此类。）

> 勘误：v2 初稿写「`current` 永远不会写盘」是**错的**，已更正。修法结论不变，但理由换成
> 「statuses 不是格式新旧的判据」（新库天然没有过时条目）。

> **历史追加（2026-11-03·已实证）**：本机 2026-10-27 那次「12 个工作区已迁移」，是子代理自己写了一套
> python 迁移工具（`migration-2026-10-27/apply.py`+ `spec.py`+`v2.py`），用 `win_bash` 直接遍历 `SPEC` 改写各工作区的
> `event-store.json` / `PLAN.md` —— **绕开写工具的会话绑定**。工具层仍只能写中枢（19/19 次 memory_event 无 workspace）。
> ⇒ 本方案不是"增加能力"，而是**把一条已存在但不受控的路径收进受控通道**。
> 同时 **P6 必须显式禁止 bash 直写记忆库**，否则旧行为与新通道并存，再造"无来源写入"。

## 3 · 目标架构：中枢特权（单一判据）

### 权限矩阵

| 会话绑定 | 传 `workspace` | 行为 |
|---|---|---|
| **中枢工作区** | 不传 | 写中枢（现状不变） |
| **中枢工作区** | 传且 ∈ manifest 白名单 | **写目标工作区**（新能力） |
| **中枢工作区** | 传但 ∉ 白名单 | 明确拒绝，回执里列出可用工作区清单 |
| **普通工作区** | 不传 | 写自己（现状不变） |
| **普通工作区** | 传 | **明确拒绝**（不是静默忽略）："跨区写仅限记忆中枢会话" |

### 判据单一化（不得出现第二套）

1. **身份**：`isHubSessionPre(agent)` —— 会话 id == 中枢会话 id（`_workbenchParent.session.id` / `wbOwnerOf === 'current'`）。
2. **目标**：`workspace` 必须 ∈ `buildWorkspaceManifestPre()` 算出的清单（引擎算，**不接受自报**）。
3. 二者同时成立才放行；工具侧不再有"跳过守卫"的旁路。

⇒ **删掉现有 `args.workspace` 幻影逃逸口**（未声明 + 只跳过守卫 + 不改落点，是比 #503 修前更隐蔽的污染面）。

### 写入口径收敛

`resolvePaths(exec.agent)` → `resolvePaths(exec.agent, { workspace })`：
- 有 `workspace` ⇒ 用 `projectDir({ ws: workspace })`（复用 `lib/datadir.js` 的 layout 收口，不新起判据）
- 无 ⇒ 走会话绑定（现状）

## 4 · D2 的修法（两选一，建议 A + B 轻量）

| 方案 | 做法 | 判定 |
|---|---|---|
| **A · 修正判据语义（主）** | `legacy = !anchors`（锚点才是条目级增删改的硬前提）；`statuses === 0` 降级为 advisory 理由（"退役标记尚不可用"）；新增**已事件化**判据 `events > 0` 用于"是否待迁移" | ✅ 根治判据不成立；不写盘、无迁移成本 |
| **B · 补 current 状态行（辅）** | `renderStatusLinePre` 允许 `current`；记忆写入时按需补一行 | ⚠ 会改动所有记忆文件的渲染面与 AI 折叠路径，须评估 M1 保护门与锚点漂移；仅作后续可选 |

**验收要点**：`legacy` 必须满足「全新库 events=0/logs=0 ⇒ 不判旧」+「有日志无事件 ⇒ 判待迁移」+
「已事件化且无 superseded ⇒ **不判旧**」（这条是现在恒真的反面）。

## 5 · 前端弹窗（裁定 3）

```text
┌ 检测到记忆尚未事件化 ────────────────────────┐
│ 整理范围：  (●) 仅当前工作区        快，约 1–3 分钟 │
│             ( ) 全部工作区（N 个）  慢，约 N×3–10 分钟│
│                                              │
│ 备注：                                        │
│ · 整理会为每个工作区创建事件并**重渲染其白板**    │
│ · 原件会先备份到 handoff/backup/，不删除原文      │
│ · 全部工作区会依次处理，可随时中断；已完成区不受影响 │
│ · 仅「记忆中枢」可写其他工作区——其他会话里此选项置灰 │
└ [立即派子代理整理] [稍后] ─────────────────┘
```

进度按区回执：`[3/12] --D--project-- 8 事件 / 22 检查点 / 白板 4.2K`，失败区可单区重试。

## 6 · 改动清单（文件级）

| # | 落点 | 内容 |
|---|---|---|
| 1 | `lib/datadir.js` | 复用既有 `projectDir({ws})` 做目标解析（零新判据） |
| 2 | `lib/index.js` 三处写工具 | 加真 `workspace` 参数（schema）+ 落点重定向 + `isHubSessionPre` 身份门 + manifest 白名单校验；删幻影逃逸口 |
| 3 | `lib/rules-layer.js` `detectLegacyFormatPre` | D2 方案 A：`legacy = !anchors`；statuses 降级；补"已事件化"判据 |
| 4 | `lib/migration-prompt.js` | 去掉 `$HOME/.dsh/...` 硬编码，改用 manifest 注入绝对 root；每区写完显式 `workspace` 回执 |
| 5 | `lib/client.js` 升级卡片 | 范围选择 + 备注 + 按区进度 |
| 6 | `lib/event-store.js` `normalizeEventPre` | **持久化来源**：`origin/createdBy/sessionId/runId`（现在被丢弃 ⇒ 写入来源不可审计） |
| 7 | `docs/TECH-DEBT.md` | 登记：事件库不记录写入来源；`current` 状态行无写入端 |

## 7 · 批次与验收（CR-10：真调用 + 负路径 + 可复算物理量）

| 批 | 内容 | 验收 |
|---|---|---|
| **P0** | D2 判据修正（`legacy = !anchors`；statuses 降 advisory） | 真 import→真调用 `detectLegacyFormatPre`：① 新库（无锚点/无事件）⇒ `legacy=false`；② 有日志无事件 ⇒ `legacy=true` 且理由含 `no-events`；③ 已事件化+有锚点+**无** superseded ⇒ **`legacy=false`**（变异：把 statuses 恢复为硬判据 ⇒ 必红） |
| **P1** | 权限矩阵 | `isHubSessionPre` 真调用：中枢会话 true、普通会话 false；写工具负路径：普通会话传 `workspace` ⇒ 拒绝文案含"仅限记忆中枢" |
| **P2** | 目标重定向 | 中枢会话传 `workspace=<其他区>` ⇒ 实际落点 = 该区 `projectDir`（断言写入文件路径 + sha256 变化）；清单外 ws ⇒ 拒绝并列清单 |
| **P3** | 幻影逃逸口清理 | 传未声明参数 ⇒ 明确报错；正常写不受影响 |
| **P4** | 提示词与 `$HOME` | 真跑：子代理**零**出现 `$HOME/.dsh`（grep 会话记录）；读到的 root == manifest 注入值 |
| **P5** | 前端范围 + 备注 | 默认「仅当前」；中枢会话外选项置灰；按区进度行数 == 区数 |
| **P6** | 溯源持久化 | 写入后读出事件：`origin/createdBy/sessionId/runId` 四字段存在且正确；负路径：老库无这些字段仍可读（向后兼容） |
| **P7** | 端到端 | 全新实例（12 区，4 区为空）⇒ 一次「全部」整理后：非空区 100% 有事件+白板、空区 skip 不建目录、**弹窗消失**（`legacy=false`）、全量回归 552/0 |

**工时**：P0 0.5d／P1 0.5d／P2 0.5d／P3 0.25d／P4 0.25d／P5 0.5d／P6 0.5d／P7 0.5d ≈ **3.5 人日**（比 v1 的 4.25 人日更小，因为不做草案/校验器/applier 那套）。

## 8 · 风险与对策

| 风险 | 对策 |
|---|---|
| 中枢身份判定被伪造（子代理冒充中枢） | 只认 `exec.agent.session.id` 与中枢会话 id 的相等，不接受参数自称 |
| 跨区写打乱 `#503` 语义 | 判据仍单一：**工具 = 绑会话 + 中枢例外；非中枢一律拒绝** |
| D2 放宽后「旧格式」漏判 | 用三个负路径固定语义（见 P0），且 advisory 理由仍显示 statuses 缺失 |
| 并发：用户正写目标区 | 复用 `withEventStoreLockPre` 库锁；apply 前比 `updatedAt`，冲突则跳过该区 |
| 弹窗消失后用户以为"已整理"但事件质量差 | 沿用四段/members/rationale 量化判据，回执给出每区计数 |

## 9 · 待确认（仅剩一项可选）

- D2 是否同时做方案 B（补 `current` 状态行）？我倾向**先只做 A**，B 单独立项（它触碰渲染面，风险与收益不对称）。
