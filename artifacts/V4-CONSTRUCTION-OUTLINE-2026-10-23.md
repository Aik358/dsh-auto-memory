# v4 大版本 · 全工程改动面勘察 + 施工纲要

> 生成：2026-10-23 23:5x · 全部数字为实测（可复算）
> 定位：**明天施工用**。当前 lib/ 与 tests/ **零改动**，本文件是方案，不是已落地的改动。
> 决策真源：`artifacts/V4-FINAL-SPEC-v2-2026-10-23.md`（884 行 / 裁定 1–30）

---

# 第一部分 · 现状实测基线

## 1.1 代码体量

```
lib/         113 个 .js        5.38 MB / 75,427 行
  ├─ index.js          1,445.6 KB / 21,233 行   （后端主体）
  └─ client.js         2,269.6 KB / 19,754 行   （前端主体）
tests/       452 个 .mjs       其中 tests/smoke/ 443 个
tools/       release.mjs 861 行 · verify-docs.mjs 124 行
```

## 1.2 硬计数真值（`node tools/verify-docs.mjs` 实测）

| 项 | 值 | 被谁锁 |
|---|---|---|
| 模型工具 | **19** | 4 个 smoke 用例 + 4 份文档 |
| HTTP 路由 | **73** | 5 个 smoke 用例 + 4 份文档 |
| 配置键 | **160** | 多个用例 + 4 份文档 |
| 板模式默认 | `graph` | 白皮书 + 用例 |
| Tier-0 token | 400 | GM53 文档 |

⚠ **v4 一旦加 `memory_event` 工具 ⇒ 19→20；加 event API ⇒ 73→N；加配置键 ⇒ 160→N。这三处是"自动变红"的连环锁，必须一次改全。**

## 1.3 白板模式现状（v4 第三档的接入点）

`lib/board-mode.js`（仅 31 行，是干净的总开关）：

```js
BOARD_MODES_PRE_V1 = Object.freeze(['legacy', 'graph'])   // ← 加 'event'
resolveBoardModePre(raw) → { mode, graphEnabled, source }
// fail closed：非法值一律按 legacy
```

**调用点只有 4 处**（这是好消息）：
| 位置 | 作用 |
|---|---|
| `index.js:101` | import |
| `index.js:4179` | `graphEnabled` getter |
| `index.js:19113` | 决定 graph 工具是否注册 |
| `index.js:3184 / 15742` | 注释（说明顺序依赖） |

## 1.4 前端 boardMode 落点（6 处 + 3 处 UI）

| 位置 | 类型 |
|---|---|
| `client.js:8172-8187` | React state + 从 config 初始化 |
| `client.js:8269-8272` | 一键切换按钮 + alert 文案 |
| `client.js:8304` | `kbData && boardModeLocal !== 'graph'` 判据 |
| `client.js:12719 / 16056 / 19185` | **设置页三处相同的 `var cur = cfg.boardMode === 'graph' ? 'graph' : 'legacy'`** |

⚠ 这三处是**同一语义的三份副本** —— 必须**一次改全**，否则进入"半修"（有的路径能解析、有的恒判失败）。

## 1.5 看板组件区

`client.js` L5298–L6005 = **708 行**，6 个组件：

| 组件 | 行 | 行长 |
|---|---|---|
| `KanbanDrawerBody` | 5298 | 7 |
| `KanbanCard` | 5305 | 388 |
| `KanbanBoardRail` | 5693 | 92 |
| `KanbanBoard` | 5785 | 169 |
| `KanbanMatrixCard` | 5954 | 51 |
| `KanbanView` | 6005 | — |

## 1.6 后端白板数据层

- `kanbanBoardData(sessionId, opts)` @ `index.js:4302`
  - 第一行就判 `boardMode !== 'graph' ⇒ return { enabled:false, reason:'legacy-mode' }`
  - 数据链：`_collectWhiteboardDocsPre` → `buildSectionCardsPre` → `dedupeCardsPre` → `buildKanbanPre`
  - 已内置：`includeArchive`（默认 false）、`foldDays`（首屏 7 天）、`actor` 过滤、`stats.cards4` 四统计卡
- `lib/wb-sidecar.js`（1,412 行）**38 个导出**，是纯函数层
  - `WB_KANBAN_LANES_PRE_V1` 5 泳道（goal/state/deadend/progress/archive）
  - `buildSectionCardsPre / buildKanbanPre / buildKanbanMatrixPre / foldCardsPre / filterCardsPre / buildStatCardsPre`
  - `laneOfEntryPre / dedupeCardsPre / ledgerDateOfPre / buildRailPre`

## 1.7 注入面 17 段（全部位置实测）

| # | 段名 | 位置 | 归属 |
|---|---|---|---|
| 1 | frame-head | `8501`(L8497) | otherDynamic |
| 2 | frame-meta | L8498 | otherDynamic |
| 3 | **rules-section** | L8499 | rules |
| 4 | workspace-map | L8502 | otherDynamic |
| 5 | tier0-catalog | L8510 | memoryReferences |
| 6 | whiteboard-plan | L8516 | memoryReferences |
| 7 | handoff-ledger | L8518 | memoryReferences |
| 8 | plan-update-request | L8528 | otherDynamic |
| 9 | handoff-pointer | L8531 | otherDynamic |
| 10 | water-advisory | L8535 | otherDynamic |
| 11 | external-memory | L8584 | otherDynamic |
| 12 | external-sessions | L8587 | otherDynamic |
| 13 | calendar | L8595 | otherDynamic |
| 14 | welcome-title | L8606 | otherDynamic |
| 15 | welcome-body | L8607 | otherDynamic |
| 16 | **frame-inscription** | L8612 | otherDynamic |
| 17 | frame-tail | L8613 | otherDynamic |

预算公式（`index.js:8544-8545 / 8625`）：
```js
catalogCost = tier0LayerText.length + 2
sub = max(0, floor((budget - 500 - catalogCost) / 4))
memRefLimit = sub*4 + catalogCost + planCap + ledgerCap + 400   // 实测 = 9,900
```

## 1.8 Tier-0 目录源装配（事件要加的类型）

`index.js:8020-8030`：
```js
add('user', ...) / add('project', ...) / add('log', ...) / add('whiteboard', ...) / add('reflection', ...)
//   ↑ 加 add('event', ...) 就是事件的入口
```

## 1.9 recall() 语料源

`index.js:9153` `async recall(query, limit, agent, scope, opts)`
- scope 路由：`handoff` / `archive` / `sessions` / `all` / `current`
- 语料读取：`scanFile(label, filePath, maxMatches, target)` 是统一入口
- **事件接入 = 在 `scope==='all'||'current'` 分支里加一个 `scanEventCorpus()`**

## 1.10 已有 store 家族（event-store 该照谁）

| store | 行数 | ID 前缀 | 落盘 |
|---|---|---|---|
| fact-store | 1,039 | `fact_pre_` | facts.json |
| episodic-store | 494 | `epi_pre_` | episodes.json |
| procedure-store | 1,098 | `proc_pre_` | procedures.json |
| evidence-store | 495 | — | — |
| plan-store | 206 | — | PLAN.md |

**统一范式**：`XXX_POLICY_VERSION` + `XXX_ID_PREFIX` + `XXX_ID_RE` + `validateXXX()` + 纯函数 + 单一 JSON 落盘。
⇒ **v4 的 event-store 照这个范式，ID 用 `evt_pre_<32hex>`**。

## 1.11 ★命名冲突（必须先解决）

**`events.jsonl` 这个文件名已被占用！**

`index.js:4099-4135` —— `appendSidecarEventPre()` 往 `handoff/events.jsonl` 追加
"criteria.passed/warned 事件链"（graph 档专用、append-only 派生物）。

**冲突后果**：v4 的事件存储若也叫 `events.jsonl`，会与 sidecar 事件链混在一个文件里，读侧解析必然出错。

**解决方案（三选一，需拍板）**：

| 方案 | 落盘名 | 优点 | 缺点 |
|---|---|---|---|
| **A（推荐）** | `handoff/event-store.json` | 与 sidecar 的 `events.jsonl` 物理分开；与 facts.json / episodes.json 同构 | 与 events.jsonl 名字接近，仍有认知负担 |
| B | `handoff/mem-events.json` | 加 `mem-` 前缀明确归属 | 前缀不一致（其他都是 xxx.json） |
| C | `handoff/events-store.json` | 明确是"store" | 略啰嗦 |

**我推荐 A**：`event-store.json`，与 `facts.json` / `episodes.json` / `procedures.json` 完全同构。

## 1.12 ★另一个命名冲突

**`skins/v4/` 已存在**（2026-09-27 立的"客户要的新款皮肤"第三方包，3 项 / 3.3 KB，十屏未开工）。

- 它叫 v4 指的是**皮肤版本**，不是**插件大版本**
- 插件 v4 的 event 档新皮肤如果也叫 `skins/v4/` ⇒ 直接撞车
- **建议**：插件 v4 的前端走 `boardMode='event'` 分支（在 client.js 内），**不新建 skin 包**；若必须新建，用 `skins/event/`

## 1.13 测试面（443 smoke）

按主题分布（文件名匹配，实际影响面见 1.14）：

| 主题 | 受影响用例数 |
|---|---|
| recall 检索 | 21 |
| 配置键 config | 23 |
| semantic 语义 | 12 |
| skin 皮肤 | 11 |
| 预算/信封 budget | 10 |
| 注入骨架 injection | 10 |
| 看板/白板 kanban | 9 |
| 规则层 rules | 3 |
| 工具注册 tools | 3 |

**硬锁用例**：18 个含具体 sha256 十六进制；7 个含计数常量断言（`smoke-test-graph-mode` / `issue207-routes` / `issue454-panel-lan` 等）。

---

# 第二部分 · 施工纲要（分 6 批）

## 前置 · 命名与契约拍板（施工前必须定，0 代码）

| 待定 | 选项 | 我的建议 |
|---|---|---|
| 事件落盘文件名 | event-store.json / mem-events.json / events-store.json | **event-store.json** |
| 事件 ID 前缀 | `evt_pre_` / `evt_` | **`evt_pre_`**（与既有 `fact_pre_`/`epi_pre_`/`proc_pre_` 同构） |
| 事件档 boardMode 值 | `'event'` | **`'event'`** |
| 前端是否新建 skin 包 | 是/否 | **否**（走 client.js 内 `boardMode==='event'` 分支） |
| 事件 API 前缀 | `/api/dsh-auto-memory/event-*` | 是 |

---

## 批次 1 · 数据层（无 UI、可独立验收）

**新增文件（3 个）**
| 文件 | 规模估计 | 内容 |
|---|---|---|
| `lib/event-store.js` | ~450 行 | `EVENT_POLICY_VERSION` / `EVENT_ID_PREFIX='evt_pre_'` / `EVENT_ID_RE` / `EVENT_STATUS_PRE_V1=['active','paused','closed']` / `PERCEPT_STAGES_PRE_V1=['retrieved','delivered','used','mentioned','accepted']` / `PANEL_KINDS_PRE_V1` 6 类 / `validateEventPre()` / `createEventPre()` / `applyEventPatchPre()` / `appendCheckpointPre()` / `closeEventPre()` / `listEventsPre()` / `eventToTier0LinePre()` |
| `lib/event-plan.js` | ~180 行 | 把"未归档账本"扫出来：`scanUnplannedLedgersPre(handoffDir, planSet)` → 返回 `{planned, unplanned, total}`；复用原型里已验证的 `unplannedLedgers` 思路 |
| `lib/event-render.js` | ~200 行 | 三档渲染：`renderEventCardT0Pre`（80 字）/ `T1Pre`（140 字）/ `T2Pre`（2400 字） |

**必改文件（1 个）**
| 文件 | 改动 |
|---|---|
| `lib/index.js` | ① import event-store；② 新增 `_loadEventStorePre` / `_saveEventStorePre`（照 facts.json 的原子写 + retryRename 范式）；③ 新增 DEFAULT_CONFIG 键（见批次 5）|

**验收（真跑，不许静态）**
- 真 import → 真构造 → 真调用：`createEventPre()` 返回对象含全部字段
- `validateEventPre()` 负路径：缺 `stage` 应报错、非法 `status` 应报错
- `appendCheckpointPre()` 追加后 `checkpoints.length` +1
- `closeEventPre()` 后 `status==='closed'` 且 `outcome` 必填
- 原子写：模拟写入中途抛错 ⇒ 原文件不变（用 .tmp + rename）

---

## 批次 2 · 工具层（+1 工具，19→20）

**必改文件（1 个）**
| 文件 | 改动 |
|---|---|
| `lib/index.js` | 在 `defineTool` 序列中插入 `memory_event`（位置建议 L18590 附近，memory_rules 之后）。参数：`action`(create/set/append/close/rename) / `eventId` / `summary` / `outcome` / `skillRef` / `userPercept` / `agentTrace` / `sharedGround` / `commitments` / `checkpoint` / `constraints` |

**连环锁（必须同批改全，否则 CI 红）**
| 位置 | 改什么 |
|---|---|
| `tests/smoke/smoke-test.mjs` | 工具数 19→20 |
| `tests/smoke/smoke-test-m3b3*.mjs` | 同上 |
| `tests/smoke/smoke-test-graph-mode.mjs` | 同上 |
| `tests/smoke/smoke-test-p23-wb-sidecar-pre.mjs` | 同上 |
| `docs/WHITEPAPER.md` §3.1 规模表 | 19→20 |
| `docs/HOMEPAGE-CONTENT-FOR-GM53.md` | 19→20 |
| `docs/FRONTEND-CO-CREATION.md` | 19→20 |
| `README.md` / `README.zh-CN.md` | 19→20 |
| `locale/zh.json` / `locale/en.json` | 新增工具名/描述键 |

**验收**
- `memory_event` 五动作逐个真调用 + 断言返回值
- 负路径：非法 action 报错；不存在的 eventId 报错；close 缺 outcome 报错
- `node tools/verify-docs.mjs` 全绿（会立刻发现文档没同步）

---

## 批次 3 · 注入 + 检索（后端线核心）

**注入面（改 1 个文件，加 2 段）**
| 段 | 位置 | 预算 |
|---|---|---|
| `event-cards` | 插在 `handoff-ledger`(L8518) 之后 | ≤2,400 字（只放 active 1–2 个） |
| `event-unarchived` | 条件式，接在 `water-advisory`(L8535) 之后 | ≤200 字（有存量才出现，否则零字节） |

**Tier-0（改 1 处）**
`index.js:8030` 后加 `add('event', s.eventTier0Text, s.eventPath)`
⚠ 需要先给 `s` 增加 `eventTier0Text` 字段（在 `refresh()` 里预计算）

**recall（改 1 处）**
`index.js` 的 `scope==='all'||'current'` 分支（L9253 起）加事件语料扫描

**铭文（改 1 处）**
`snapshotInscription` @ `index.js:1198-1205`：改 ②、加 ⑧⑨（文案已在定稿文档 §五）

**验收**
- 新段真出现在快照里（真构造 snapshot 断言字符串存在 + 长度上限）
- **负路径**：无 active 事件时 `event-cards` 零字节；无存量时 `event-unarchived` 零字节
- `memory_recall` 能命中事件（真调用 → 断言返回含事件标题）
- 铭文字数 ≤1,500（现 1,445）

---

## 批次 4 · 前端（最大一批，最高风险）

**改 1 个文件：`lib/client.js`**

| 改动 | 位置 | 规模 |
|---|---|---|
| `boardMode` 加第三档 | 8172-8187 / 8269-8272 / 8304 | ~30 行 |
| **设置页三处同步改** | 12719 / 16056 / 19185 | ~15 行 ×3（必须一次改全） |
| 新增 `EventView` 组件家族 | 在 KanbanView 之后（L6005 后） | **~800–1,200 行**（含三视图/懒加载/折叠/主题/响应式） |
| 接线 | `if (boardModeLocal === 'event') return EventView(...)` | ~20 行 |

**⚠ 前端硬规则（用户已固化）**
1. **禁止三方合并 / 整块替换式重构**
2. `legacy` / `graph` 两档**逐字节不变**
3. 必须跑**真执行 factory 的运行时守卫**（`tests/smoke/` 下用 `node:vm` 真执行）

**从原型直接搬的资产**（`artifacts/wb-event-preview/`）
| 原型文件 | 搬成 | 注意 |
|---|---|---|
| `view.mjs` 的 CSS 段 | EventView 的样式对象 | 去掉原型专用调试色 |
| `view.mjs` 的 SCRIPT 段 | EventView 的交互逻辑 | 改成 React 或保持原生 DOM？**需拍板** |
| `build.mjs` 的 lane/空档算法 | 内联进 client.js | 抽成纯函数便于测试 |

**验收**
- 真 factory 守卫：`boardMode='legacy'` 和 `'graph'` 渲染输出**与改动前逐字节一致**
- event 档：三视图切换 / 懒加载 / 折叠 / 三主题 / 三字号 / 三断点，逐项真点击断言
- 负路径：`boardMode` 非法值 → fail closed 到 legacy

---

## 批次 5 · 配置 + 设置页

**DEFAULT_CONFIG 新增键（160→N）**

| 键 | 默认 | 说明 |
|---|---|---|
| `boardMode` | 保持 `graph` 或改 `event`？ | **需拍板** |
| `eventAutoCreate` | `true` | 新会话是否自动建事件 |
| `eventCardBudget` | `2400` | T2 事件卡预算 |
| `eventMaxActiveInInject` | `2` | 注入几个 active 事件 |
| `eventUnarchivedWarn` | `true` | 存量提示开关 |
| `eventLazyWindowSize` | `36` | 前端初始渲染窗口（原型实测最优值） |

**连环锁**：160→166 ⇒ 白皮书 / GM53 / 共创 / 两份 README 共 **5 处**文档 + 多个用例

---

## 批次 6 · 收尾（回归 + 发版准备）

| 步骤 | 命令 | 期望 |
|---|---|---|
| 1 | `node tools/verify-docs.mjs` | 全绿（工具/路由/配置键三处同步） |
| 2 | 全量 smoke | PASS ≥ 443，FAIL 0 |
| 3 | `node tools/release.mjs --dry` | 通过 |
| 4 | 真 factory 守卫 | legacy/graph 字节级一致 |
| 5 | 手工：三档切换 + 三主题 + 三断点 | 逐项截图 |

---

# 第三部分 · 风险清单（按严重度）

| # | 风险 | 后果 | 对策 |
|---|---|---|---|
| **R1** | **设置页三处 boardMode 副本只改部分** | "半修"：有的路径能解析、有的恒判失败（历史实测过同类事故） | 改前先 `grep` 出全部 3 处，改完再 `grep` 验证 3 处都是新逻辑 |
| **R2** | **`events.jsonl` 命名撞车** | sidecar 事件链与事件存储混读，解析必错 | 用 `event-store.json`（批次 0 拍板） |
| **R3** | **工具/路由/配置键三处连环锁** | 改了代码没改文档 ⇒ `verify-docs` 红；改了文档没改用例 ⇒ smoke 红 | 每批结束立刻跑 `verify-docs` + 相关 smoke |
| **R4** | **前端整块替换式重构** | 用户明确警告过：曾 merge 社区前端导致大量污染、修一整天 | 只做**定点插入**，legacy/graph 分支不动一行 |
| **R5** | **静态守卫冒充功能验收** | 全绿但运行时才炸（本仓历史事故） | 每条验收必须真 import→真调用→断言返回值；新增断言带负路径 |
| **R6** | **`skins/v4/` 撞名** | 与已存在的第三方皮肤包冲突 | 不新建 skin 包，走 client.js 内部分支 |
| **R7** | **注入段加进去但没进预算公式** | 溢出导致其他段被裁（规则段冻结不能裁） | 加段时同步改 `memRefLimit` 计算 |
| **R8** | **事件 ID 前缀与既有冲突** | 索引串味 | `evt_pre_` 与 `fact_pre_`/`epi_pre_`/`proc_pre_` 同构不冲突 |
| **R9** | **`release.mjs:240` 把 `docs/` 整树 cpSync 覆盖** | 若 dev 与 main 的 docs 文案不同步，发版会用 dev 覆盖 main（v3.3.13 实证过） | 发版前先 `git fetch` 核对 main 的 docs 版本；docs 改动分批提交 |
| **R10** | **发版流程不得委派 subagent** | 用户硬规则 | 发版由 Lead 直接执行 |
| **R11** | **npm publish 成功有三层不同步** | exit 0 / 服务端 202 / registry 可读 是三层，只看 exit 0 会误判 | 按 `shasum` + `gitHead` + `time` 三值回查 |

---

# 第四部分 · 施工顺序建议（给明天的你）

```
批次 0（拍板）     15 分钟   5 个命名决定
   ↓
批次 1（数据层）   ~3 小时   3 新文件 + 1 改文件，可独立验收
   ↓
批次 2（工具层）   ~2 小时   +1 工具，连同 4 用例 5 文档一起改
   ↓
批次 3（注入检索） ~3 小时   2 新段 + Tier0 + recall + 铭文
   ↓
批次 4（前端）     ~6 小时   最大一批，建议单独一天
   ↓
批次 5（配置设置） ~2 小时   6 个新键 + 5 处文档
   ↓
批次 6（收尾）     ~1 小时   verify-docs + 全量 smoke + factory 守卫
```

**总计约 17 小时 / 2–3 个工作日。**

**建议切分点**：批次 1+2 一批（后端数据与工具，可独立发内测）；批次 3+5 一批（注入与配置，需要一起验预算）；批次 4 单独一天（前端）。

---

# 第五部分 · 本纲要的自我复核（13 条关键断言逐条验过）

| # | 断言 | 复核方式 | 结果 |
|---|---|---|---|
| 1 | 工具数 19 | 正则数 `defineTool('...')` | ✅ |
| 2 | 配置键 160 | `verify-docs.mjs` 实测 | ✅ |
| 3 | `board-mode.js` 31 行 | 读文件 | ✅ |
| 4 | `BOARD_MODES` 只有 legacy/graph | 读源码 | ✅ |
| 5 | 设置页 **3 处** boardMode 副本 | 正则精确匹配 | ✅ 确认 3 处 |
| 6 | 看板组件区 708 行 | L5298→L6005 | ✅ |
| 7 | `events.jsonl` **已被占用** | 定位 `appendFile(...'events.jsonl')` | ✅ 确认冲突真实 |
| 8 | `skins/v4/` 已存在 | `fs.existsSync` | ✅ 确认撞名真实 |
| 9 | `wb-sidecar` 导出数 | 正则数 `export` | ⚠️ **初稿写 37，实为 38 —— 已修正** |
| 10 | 注入 17 段 | 正则数 `pushPart(` | ✅ |
| 11 | Tier-0 有 5 类 add | 读 8020-8030 | ✅ |
| 12 | `recall()` 在 L9153 | 定位 | ✅ |
| 13 | 铭文在 L1198 | 定位 | ✅ |

**12/13 直接通过，1 条（导出数）初稿写错、已当场修正。** 这条错误本身说明：**报告里的计数必须实测，不能凭印象**——即使是我自己刚读过的文件。

---

# 第六部分 · 明天开工第一件事

```bash
cd D:\dsh-auto-memory
git status --porcelain -- lib tests          # 期望 0 行（确认起点干净）
node tools/verify-docs.mjs                    # 期望：工具 19 / 路由 73 / 配置键 160 / 全绿
node artifacts/wb-event-preview/verify.mjs    # 期望：133 PASS / 0 FAIL（原型基线）
```

三条都过 ⇒ 起点干净，可以从批次 0 开始。
有任何一条不过 ⇒ 先修起点，不要开始施工。

---

# 附 · 相关文件索引

| 路径 | 用途 |
|---|---|
| `artifacts/V4-FINAL-SPEC-v2-2026-10-23.md` | **决策真源**（884 行 / 裁定 1–30） |
| `artifacts/wb-event-preview/` | **可运行原型**（v3：倒叙+懒加载+三视图+三主题+响应式，133 PASS） |
| `artifacts/wb-event-preview/.lead-backup/` | v2 基线备份（2,547,940 B / sha `86db1973…`） |
| `artifacts/blueprints/` | 三张手绘原图 |
| `artifacts/_diagrams/` | 六张定稿图（H/I/J/K/L/M/N） |
| `lib/board-mode.js` | 白板总开关（31 行，v4 第三档入口） |
| `lib/wb-sidecar.js` | 看板纯函数层（1,412 行 / 38 导出） |
| `lib/index.js:4302` | `kanbanBoardData` |
| `lib/index.js:8020` | Tier-0 源装配 |
| `lib/index.js:9153` | `recall()` |
| `lib/index.js:8497-8613` | 17 段注入 |
| `lib/index.js:1198` | 铭文 |
| `lib/client.js:5298-6005` | 看板组件区（708 行） |


---

# 第七部分 · ★实战暴露的第 12 条风险（2026-10-24 00:1x，真实发生）

## R12 · 验证器把「语料快照数字」写死 ⇒ 语料一长就假红

**这不是假想风险，是本轮真实发生的。**

### 时间线
| 时刻 | 事件 | 语料 |
|---|---|---|
| 22:32 | 执行者 build 原型，基线三写 833/837/838 | **838** |
| 23:5x | 执行者交付，声称 133 PASS / 0 FAIL | 838（正确） |
| 00:10:06 | **Lead 重写 PLAN.md**（写施工纲要）⇒ 插件自动归档多 1 篇 | **839** |
| 00:1x | Lead 独立 verify → **118 PASS / 15 FAIL** | 839 |
| 00:1x | Lead rebuild 后 verify → **121 PASS / 12 FAIL** | 839 |

### 15 条 FAIL 逐条归因（全部判据过期，0 真缺陷）
| FAIL | 硬编码值 | 实际 |
|---|---|---|
| 源文件总数 | 838 | 839 |
| 顶层 578 / archive **260** | 260 | **261** |
| events.json 覆盖 | 838 | 839 |
| 时间流 **184** 刻度 | 184 | **185** |
| 关掉 demo 后卡片数 | ≤184 | 185 |
| 懒加载「共 184」 | 184 | 185 |
| 负路径①a 184/184 | 184 | 185 |
| 负路径①c loaded=184 | 184 | 185 |
| 负路径② 全量 184 | 184 | 185 |
| **倒叙② 末位 = `bucket-unplanned`** | 事件 id | 末位变成新 PLAN 快照 —— **逻辑正确，id 过期** |
| **三视图① last = 某 id** | 事件 id | 同上 |

### 判据
**这不是「断言太严」，是「断言比错了对象」**：
- ❌ 跟某个历史快照比数字（`=== 838`）⇒ 语料天然增长时必然红，且红了不代表有 bug
- ✅ 跟**不变量**比（自洽 / 单调 / 语义）：

| 不变量 | 断言写法 | 能抓什么真 bug |
|---|---|---|
| 覆盖自洽 | `coveredDocuments === timelineNodes` | 覆盖漏了、重复计了 |
| 倒叙语义 | `lastEvent.endMs === max(all.endMs)` | 倒序反了、排序错 |
| 单调性 | `snap.length >= 838`（只增不减） | 语料被误删 |
| 窗口自洽 | `loaded===36 && total===stats.timelineNodes && start===total-36` | 懒加载算错 |

**这三条不变量比 `=== 838` 更强** —— 前者能抓真 bug，后者只能抓「数字变了」。

### 对施工的启示（写进纲要的硬纪律）
> **凡是"语料天然会增长"的系统（账本、日志、归档、事件），验证器一律不得写死绝对值。**
> 必须改为「从 stats 派生 + 不变量断言 + 单调性下界」。
>
> 判据：**新增语料后 verify 不得因计数变化而红；只有语义/结构被破坏时才红。**

**这条同样适用于 v4 正式实现**：批次 1–3 的所有断言都不能写死「515 篇账本」「127 个事件」「837 检查点」，必须从运行时 stats 派生。
