# 1.2 冲突处置（A+B）施工方案

> 2026-11-09 · 由 Lead 起草，依据用户 2026-11-08/09 连续裁定
> 上游：[施工总表](file:///D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md) 批次 1 的 `1.2` 项
> 本文件状态：**方案定稿，待施工**。不含任何已落地代码改动。

---

## 〇、一页纸摘要

| 项 | 定论 |
|---|---|
| 存量 66,533 条 | **清空**（实测 100% 是 non-triple-subject，真冲突 0 条） |
| 冲突存放路径 | **迁出 `facts.json`** → 新文件 `hub/facts-conflicts.json` |
| 路径迁移的作用 | 老用户升级后首次落盘即自然瘦身：**90.3 MB → 约 1.5 MB** |
| 面板 | Memory Hub 页签内新增独立页签，**概览之后 / 日志之前** |
| 提醒落点 | **工具返回值**（不是 system prompt，也不是 `context()` 尾部） |
| 一次性状态 | **持久化滑动窗口**（有界），不是纯内存 |
| 冲突门槛 | 提高：只在高可能性时记录/提醒 |
| 社区皮肤 | **不做镜像**（iter5 / frozen 零改动） |

---

## 一、为什么换路径（用户裁定）

> 用户原话：「我这个插件是面向用户的，用户升级以后也要清空，所以建议换个路径」

三条收益：

1. **升级即清空**：新文件不存在 ⇒ 老用户升级后自然从空开始，不需要写迁移脚本删数据。
2. **立刻瘦身**：`facts.json` 的 `snapshot()` 不再含 `conflicts` 键 ⇒ 下一次落盘时整份重写 ⇒ **90.3 MB 变约 1.5 MB**（现存 facts 仅约 1,000 条 / 0.42 MB）。
3. **职责分离**：事实库只存事实；冲突是可裁决的临时状态，独立生命周期与独立上限。

### 1.1 新文件规格

```
<memoryRoot>/hub/facts-conflicts.json
{
  "schemaVersion": 1,
  "namespace": "dsh-auto-memory-pre-conflicts",
  "savedAt": <ms>,
  "conflicts": [ <与现有 conflict 记录同构> ]
}
```

**保持记录结构不变**，只换持久化目标 ⇒ `memory-hub.js:297` 的 `stores.facts.pendingConflicts()` 接口不变 ⇒ 前端既有渲染点零改动。

### 1.2 落点

| 改动 | 文件 | 行 |
|---|---|---|
| `snapshot()` 移除 `conflicts` 键 | `lib/fact-store.js` | `snapshot()` 内 `conflicts: conflicts.map(...)` |
| `restore()` 不再读 `data.conflicts` | `lib/fact-store.js` | 约 `:831` `conflicts = Array.isArray(data.conflicts) ? ...` |
| 新增冲突独立 IO | `lib/fact-store.js` | 新增 `conflictsIo` 参数 + `persistConflicts()` |
| 宿主编排处注入冲突 IO | `lib/index.js` | 约 `:21629` `createFactStorePre({...})` |
| 首次落盘清空存量 | `lib/fact-store.js` | 加载时若旧 `facts.json` 带 `conflicts` ⇒ 丢弃并记诊断 |

> ⚠️ **一次性清空要在加载侧兜住**：不能只靠"不再写"，否则旧 `facts.json` 里的 89 MB 会一直留在盘上直到下次落盘。加载时识别到 legacy `conflicts` 字段 ⇒ 写入诊断计数 `legacyConflictsDropped` 并丢弃。

---

## 二、为什么把提醒放工具返回（订正后的理由）

### 2.1 缓存不是理由（我此前说错了）

本仓架构（见 `lib/index.js:23203-23204`、`:13334`）早已分流：

| 通道 | 内容 | 位置 | 缓存影响 |
|---|---|---|---|
| `systemPrompt.section()` | 静态纪律 | system prompt | **字节级稳定 = 前缀缓存锚** |
| `systemPrompt.context()` | 动态记忆快照 | **user-role 追加在历史尾部** | **不影响前缀** |

⇒ 提醒放进尾部快照 **不会**击穿前缀缓存。**「打碎缓存」不是选工具返回的理由。**

### 2.2 真实理由（三条）

1. **历史膨胀**：`context()` 的内容一变就追加**整份新快照**（`project()` 去重按整体内容比）。提醒逐轮有/无 ⇒ 多追加若干整份快照。工具返回只是**一条就地消息**。
2. **可见性有保证**：`context()` 会受精简档、去重、注入预算裁剪影响；工具返回不会。
3. **语义对齐**：提醒描述的是"你刚才这次写入的结果"，天然属于那次调用的返回。

### 2.3 提醒文案（三分支，全部可判定）

模型负责判断，工具只负责**指出可能冲突**。文案必须给可执行的分支，且**禁止模型单方撤销**：

```
⚠️ 本次写入可能与既有记忆冲突
  既有：<subject> · <predicate> = <object>（<来源/时间>）
  本次：<subject> · <predicate> = <object>
  请按以下分支处理，**不要自行 revoke 任何一条**：
  ① 明显更新（版本/日期递增等）→ 写入新值，并把旧值显式标为 superseded
  ② 不同侧面（如"端口 3080" vs "端口 8080（仅测试环境）"）→ 两条都保留，各自补限定语
  ③ 判断不了 → 保留双方，并在回答里明确告知用户存在分歧，等用户在面板裁定
```

> **为什么不让模型 revoke**：`fact-store.js:654-659` 的 `choice:'right'` 会把现役 fact 置 `revoked:true`，不可逆。模型没有 ground truth，误判一次即永久丢事实。

---

## 三、冲突门槛：从「有差异就记」提高到「高可能性才记」

### 3.1 现状问题

`isFactConflict` 只要 `object` 字面不同就判冲突。但 `3.3.6 → 3.4.0` 是**更新**不是冲突。存量 66,533 条已经证明：门槛低到没有意义。

### 3.2 新增置信分层（纯规则、零模型调用，可单测）

在 `detectNonTriplePre` 之后加一层 `classifyConflictLikelihoodPre(a, b)`，返回 `high | low | none`：

| 判据 | 结论 | 理由 |
|---|---|---|
| 任一方 object 为空 | `none` | 空值不是陈述 |
| 两侧 object 归一化后相等 | `none` | 纯重复，走 merge |
| 一方是另一方的前缀/子串 | `low` | 更像**细化**而非矛盾（`esbuild` vs `esbuild 用于构建`） |
| 两侧都是数字 | `low`（大者较新） | 更像**更新** |
| 两侧都是日期/版本号 | `low`（后者较新） | 更像**更新** |
| 双方均为长度 ≥ 4 的实质文本且互不包含 | **`high`** | 真矛盾可能性高 |

**落地时的订正（比本方案原写法更保守，理由见下）**：

| 档 | 记录冲突？ | 允许提醒？ | 计数 |
|---|---|---|---|
| `high` | 是 | **是** | `stats.conflictAdded` |
| `low` | **仍然记录**（带 `likelihood:"low"`） | **否** | `stats.conflictLowLikelihood` |
| `none` | 否（走 merge） | 否 | — |

**为什么 `low` 不能只计数、然后丢给 merge**：

> 实测读 `lib/fact-store.js` 的 `mergeInto()`：它只合并 `sourceKind` / `provenance` /
> `confidence` / 时间元数据，**不更新 `object`**。
>
> 因此若把「版本号 3.3.6 → 3.4.0」这类 `low` 差异交给合并，**新值会被静默丢弃** ——
> 这比「多记一条冲突」严重得多。

⇒ 保留记录（用户仍可在面板裁定），但**不触发提醒**（用户裁定「在 conflict 的可能性
比较高的时候再提醒」）。面板可用 `likelihood` 字段区分/过滤。

> 这条同时缓解「提醒太多」和「面板太吵」。上限 `maxConflicts` 仍然保留（防回归）。

---

## 四、一次性提醒：持久化滑动窗口

### 4.1 语义

同一条冲突对**同一会话**最多提醒 **2 次**（首次 + 一次追认）。之后不再主动提醒，只在 `memory_recall` 命中时内联标记。

### 4.2 为什么必须持久化（用户裁定）

> 用户原话：「一次性状态确实是正确的，但是我觉得还是得记，不过是一个滑动的窗口」
> 「你重启一下不见了，对用户就有点繁琐、有点烦恼」

若纯内存，宿主重启后已提醒状态丢失 ⇒ 同一条冲突被反复提醒 ⇒ 用户反复看到同一问题。

### 4.3 存储规格

```
<memoryRoot>/hub/conflict-reminders.json
{
  "schemaVersion": 1,
  "savedAt": <ms>,
  "entries": [ { "key": "<conflictId>|<sessionId>", "count": 1|2, "lastAt": <ms> } ]
}
```

- **滑动窗口**：只保留最近 **256 条**，超出按 `lastAt` 最旧淘汰。
- 文件本身用 `maxConflicts=2000` 上限保护，体积可控（256 × 约 80 B ≈ 20 KB）。
- 损坏 ⇒ fail-soft 视为空（最坏是多提醒一次，不会崩）。

---

## 五、面板（A）：独立页签

### 5.1 位置（用户裁定）

> 用户原话：「把这个选择页签放在概览就是记忆库，然后是概览后面的一个独立窗口，在"日志检索"的前面」

`MEMORY_TABS()`（`client.js:16104`）当前顺序：

```
overview → logs → refine → hub → storage → notes → plan → reflections → team → connect → calendar → search → workspaces → stats
```

改为：

```
overview → conflicts(新) → logs → refine → hub → storage → ...
```

### 5.2 徽标（用户裁定）

> 「如果有待解决的问题，就加一个酒红色的小点，代表有待解决的问题，注意美术要做好一点，高端大气一点」

- 有待解决冲突时，页签文字右上角一个 **酒红色**（`#7B2135` 系，需与既有 `--dam-` 变量体系对齐）圆点。
- 无待解决 ⇒ 不渲染任何装饰（不留空位，避免布局抖动）。
- 尺寸建议 6px，与外层文字基线右上偏移 2px；不使用 emoji / 图片。
- **必须**：点的高对比可读性、深浅主题都可见（需实测两种主题）。

### 5.3 面板内容

| 区 | 内容 |
|---|---|
| 列表 | 每行：`subject · predicate` / 左值 / 右值 / 检测时间 / 来源 |
| 操作 | `[保留左]` / `[采用右]` —— 二次确认（采用右会 revoke 现役 fact） |
| 空态 | 明确文案「暂无待裁决冲突」 |
| 上限提示 | 达到 `maxConflicts` 时提示已淘汰条数 |

### 5.4 前端纪律

- **只改手写区**，不碰 `skins/iter5/*` 与 `frozen`（用户裁定：社区皮肤不做镜像）。
- 改完**必须**跑真执行 `__ModuleLoader__` factory 的运行时守卫（项目硬规则），不能只 `node --check`。
- `client.js` 现 2,918,684 B，**禁止整文件 write**，只用定点 edit。

---

## 六、工具侧（B）：`memory_conflict`

### 6.1 形态

```js
memory_conflict({
  action: 'list' | 'resolve',
  conflictId?: string,
  choice?: 'left' | 'right',
  dryRun?: boolean,   // 默认 true
  confirm?: boolean,  // 真落盘时必须 true
})
```

### 6.2 三道闸（缺一不可）

| 闸 | 作用 |
|---|---|
| `dryRun` 默认 `true` | 首调只返回"会发生什么"，不落盘 |
| 返回 `wouldRevoke` 全文 | 让调用方看到将被撤销的那条事实 |
| `confirm:true` 二次门 | 与仓库既有 `consent === true` 同型 |

去掉任意一条 ⇒ 就是再造「点了没反应」或「点了毁数据」的假通道。

### 6.3 计数同步（不能跳过）

| 计数 | 现值 | 改后 | 锁位置 |
|---|---|---|---|
| 工具数 | 21 | **22** | 文档 6 处 + `tools/verify-docs.mjs` |
| 路由数 | 85 | **86** | `smoke-test-task36-p2b-backend.mjs:69`、`smoke-test-team-routes.mjs:93` |

> 用户同意「别处不做同步」，但**只限社区皮肤**；计数锁属于硬断言，跳过直接红。

### 6.4 路由

沿用仓库既有约定（`teamBaseline` 同型）：**单路由 + body.action**，避免多一条计数锁。

```
facts-conflicts: '/api/dsh-auto-memory/facts-conflicts'
  GET  → 列表（只读）
  POST { action:'resolve', conflictId, choice, confirm }
```

---

## 七、审计留痕

`resolveConflict` 目前只写 `resolved/resolvedAt/choice`，**没有 who、没有 why**。补三个伴生字段：

```
resolvedBy:   'user-panel' | 'model'
resolvedNote: string
revokedFactId: string | null
```

这是「B 误调后能追责」的唯一依据。字段为伴生属性，不新建状态源。

---

## 八、验收判据

### 8.1 真执行（禁止源码字符串断言）

| 项 | 断言 |
|---|---|
| 迁移 | 造 legacy `facts.json`（含 conflicts）⇒ 加载后 `conflictCount === 0` 且 `legacyConflictsDropped > 0` |
| 瘦身 | 迁移后落盘，文件字节数 < 原文的 5% |
| 新文件 | 产生冲突 ⇒ `facts-conflicts.json` 存在且含该条；`facts.json` **不含** `conflicts` 键 |
| 门槛 | `3.3.6 → 3.4.0` ⇒ `low`，不记录；`端口 3080` vs `端口 8080` ⇒ `high`，记录 |
| 提醒 | 首次写入返回含提醒；第 3 次同冲突**不再**含提醒 |
| 滑动窗口 | 写入 300 条提醒状态 ⇒ 文件内 `entries.length === 256` 且保留的是最新 256 条 |
| 工具 | `dryRun` 默认不落盘；`confirm` 缺省时拒绝；正确调用后 `pendingConflicts` -1 |
| 面板 | 有待解决 ⇒ 酒红点存在；清空后 ⇒ 不渲染 |

### 8.2 负路径

- 已 `resolved` 的冲突再次 resolve ⇒ 必须拒绝（`already-resolved`）。
- 非三元组 subject 写入 ⇒ 仍**不**产生冲突（1.3b 回归）。
- `dryRun:true` 时 `confirm:true` 也**不得**落盘。

### 8.3 变异必红

- 去掉 `dryRun` 门 ⇒ 「默认不落盘」断言必红。
- 去掉滑动窗口淘汰 ⇒ 「300 条只剩 256」必红。
- 去掉 `high` 门槛 ⇒ 「版本号不算冲突」必红。

---

## 九、施工顺序（用户已同意）

| 步 | 动作 | 风险 | 前置 |
|---|---|---|---|
| **1** | conflicts 迁出 `facts.json` + 清空存量 + 瘦身 | 低（真冲突 0 条；已有备份） | 无 |
| **2** | `resolveConflict` 补审计字段 | 低 | — |
| **3** | 冲突置信分层 `classifyConflictLikelihoodPre` | 低（纯函数可单测） | — |
| **4** | 面板独立页签 + 酒红点（A） | 中（要跑 factory 运行时守卫） | 1 |
| **5** | `memory_conflict` 工具 + 三道闸（B） | 中（工具 21→22） | 2 |
| **6** | 工具返回 / recall 返回的提醒 + 滑动窗口 | 低 | 3 |
| **7** | 计数同步 + 验收套件 + 文档 | 低 | 4,5 |

### 每步收工固定动作

```
1. node --check 目标文件
2. 真 import 一次
3. 跑该步验收（真执行 + 负路径 + 变异）
4. 受影响子集 impact-run
5. 对照三元组基线
6. 写事件检查点 + 更新本文件状态
```

---

## 十、明确不做

| 不做 | 原因 |
|---|---|
| 社区皮肤（iter5 / frozen）镜像 | 用户裁定：同步压力大，且社区维护 |
| 全量回归 | 按项目口径走 impact-run |
| 让模型自动 revoke 事实 | 不可逆，误判代价不对称 |
| 语义向量判冲突（L2） | 属 S-1，独立待办，不在本批 |
| 改 `isFactConflict` 语义 | 只加前置门槛与后置分层，不改其判定 |

---

## 十一、与 S-1 的关系

本文件只做「形态层 + 处置层」。语义层（句法分析 / 自然语言处理 / 向量对齐）仍归
[施工总表 §S-1](file:///D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md)，**待定**。

本批的高置信度分层是 **S-1 的离线样本来源**：`high` 命中的样本可直接用作语义对齐的评估集。
