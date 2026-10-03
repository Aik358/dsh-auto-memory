# P1 设计稿 · 统一状态提交与快照（miv 单源）＋ 并发原子边界

> 状态：**待审**（先审后写代码 —— 用户裁定顺序：设计稿是必审点）
> 依据：`MASTER-PLAN-3.0.md` Phase 1（§216-227）、`TODO-GRAPH.html` 卡 `V2-P1`、`ROUND3-REVIEW-INTEGRATION-20260914.md` §3.2
> 作者：执行方 · 日期：2026-09-15 · 全部 file:line 为**本机实测**取值，非转述

---

## 0. 一句话目标

把「谁在写、写的什么版本、写完算不算数」收敛成**一个提交边界**：所有窗口经同一工作区 owner 提交，
提交时在边界**内**校验 `expectedDigest` 与 `miv`；快照的 `miv` 成为**唯一事实源**（内容身份 + 状态清单摘要，
哈希身份、不递增、不比较）。并发不加锁，靠「队列串行 + 边界内比较」保证恰好一项成功、另一项收到**可见冲突**。

---

## 1. 现码取证（每条都可在本机复现）

### 1.1 已有的好东西（**不要重造**）

| 机制 | 位置 | 实测语义 |
|---|---|---|
| 短提交队列 | `lib/memory-writer-pre.js:235 _queue` | 按 `path.resolve(filePath)` 分键串行；空闲即回收 Map 条目（`:242`），无界增长已处理 |
| 原子写 | `lib/memory-writer-pre.js:199 atomicReplace` | 同目录 tmp + fsync + rename。**签名里没有 `expectedDigest`** —— 它**不是** CAS，只做原子写 |
| 边界内 digest 校验 | `lib/memory-writer-pre.js:344 replace` / `:332` / `:357` / `:369` / `:380` | 五个提交方法**都在 `_queue` 内部**先比 `expectedDigest`，不匹配返回 `{ok:false, reason:…}`；**这是当前唯一正确的并发保护** |
| 无 BOM 闸 | `lib/memory-writer-pre.js:287` | 提交前拒 BOM（用户硬性规则的代码级保障） |
| 写入门 | `lib/memory-mutation-pre.js:76 validateMutationBoundaryPre` | 只收规范化投影（`beforeIds`/`afterIds`/`archivedIds`）；`M1 丢卡保护`无条件生效（`:99-101`） |
| 门调用点 | `lib/index.js:1984` | **全仓唯一实调**（`memory-mutation-pre.js:231` 是自身内部调用） |

### 1.2 缺口（P1 要修的）

**(a) `miv` 有生成、无单源，且**没有被提交边界校验****

- 生成：`lib/shadow-retrieval-pre.js:144` —— `idx_pre_ + first32hex(sha256(canonical corpus tuples))`；经 `lib/m4-corpus-pre.js:128` → `context-host-pre.js:216/393` 装配进快照。
- 消费：`lib/activation-host-pre.js:102 setMiv` / `:252 currentMiv` 只做**缓存**（`mivCache = {wsRef, miv}`），`setMiv` 是**显式写入口**（`:111`）——即"谁调谁说了算"，**没有单一权威计算点**。
- **关键缺口**：`memory-writer-pre.js` 的提交方法**只比 `expectedDigest`，完全不看 `miv`**。⇒ 图内容变了但 digest 恰好相等（或调用方没传 digest）时，快照仍可能带着**旧 miv** 发出去。

**(b) ~~复用命中只查 `contextVersion`，不查 `miv` ⇒ 契约 I6 失守~~ —— ★施工期核实：本条已过时，撤销**

> **勘误（实测取证，非推断）**：以下三行是**当时**（09-14 评审 C9 口径）的判断；动手前逐行复核，现状已是：
> - 投影**已携带** miv —— `lib/activation-host-pre.js:165`：`miv: String(req.memoryIndexVersion || '') || undefined`（同处 `:164/166/167` 带 `contextVersion`/`observationId`/`requestKey`）；
> - 版本门**已含 miv 两道 fail-closed** —— `lib/tier-layer-inject-pre.js:200-204`：`if (!curMiv || !projMiv) return no('version-unknown')` / `if (curMiv !== projMiv) return no('miv-changed')`；
> - 调用方**已传当前 miv** —— `lib/index.js:4269`：`miv: this.tierCurrentMivPre()`；
> - **且有专项测试** —— `tests/smoke/smoke-test-t0-2-version-gate-pre.mjs:75`（`miv-changed`）、`:96/:103`（`version-unknown` 两侧）。
>
> **结论**：I6 在 P1 开工前**已由 P0 的 T0-2 守住**。§3 表中「I6 失守 → 守住」一栏作废；原 §2.4（版本门补 miv）**从改动清单撤销** —— 重复实现只会引入回归风险。
> **教训**：外部评审结论带时间戳，动手前必须用**当前**代码复核，不得把评审描述当现状直接排进施工项。

*（以下为当时的分析原文，仅作留痕，勿据此施工）*

- 契约原文 `docs/internal/THREE-LAYER-CONTRACT.md:184`：**I6** 三层来自同一份快照（同一 `miv`），混版视为错误。
- 实测 `lib/tier-layer-inject-pre.js:169 selectReusableTierHitsPre`：① 时间门（`:186`）② 身份门 session/workspace（`:188-194`）③ **版本门只有 `contextVersion`**（`:195-198`）。**`gh.miv` 虽被读入快照字段（`:177`）却不参与判定** ⇒ 语料换了、miv 变了，只要 contextVersion 没变就**照样复用旧命中**，三层可能混版。
- 这与我方 09-14 外部评审 **C9** 结论一致（`lib/index.js:3894/3896/3901` 复用命中只查时间与会话）。

**(c) 提交接口没有来源身份**

- 现签名（`memory-writer-pre.js:344`）只收 `expectedDigest` + `replacement` + `idFactory`。
- 缺 `workspaceKey / boardId / txId / actor` ⇒ 冲突被拒时**说不出"谁和谁撞了"**，`mutationRefusalTextPre`（`:212`）也拿不到 actor 信息。

**(d) 共享 vs 隔离虽已分开，但缺显式声明**

- 图（共享）：按工作区分键（`_queue` 的 key 是文件路径；工作区文件路径天然隔离）✓
- 激活/冷却/已交付标记（隔离）：`lib/activation-host-pre.js` 的 `registry.forRuntime(sessionId, workspaceKey, …)`（`:132/248`）已按会话隔离 ✓
- **缺**：这个"哪些共享、哪些隔离"的边界目前只存在于代码直觉里，没有写成常量表 ⇒ 后续 P6B 容易越界。

**(e) 三种状态目前无类型隔离**

- 记忆有效状态：`current / superseded / retracted`（契约 I5，`index.js` 注入侧过滤）
- 任务进度：`done / passed / archived`（看板语义）
- 归档位置：`archived`（同时也是任务态 —— **同名不同义**）
- 风险：`archived` 一词两义，跨线传递时会误判。P1 只做**命名隔离**（见 §2.3），不做语义合并。

---

## 2. 改动清单（按依赖序，每步可独立回归）

### 2.1 【新增】`lib/state-commit-pre.js` —— 统一提交契约（纯函数，零依赖）

```js
export const STATE_COMMIT_VERSION_PRE = 'state_commit_pre_v1'

// 提交单据（P1 唯一的写入契约）
// { workspaceKey, boardId, txId, expectedDigest, expectedStateVersion,
//   actor: { sessionId, contSeq, kind },        // kind: 'user' | 'plugin' | 'model' | 'system'
//   writes: [{ path, content, expectedDigest }],
//   stateChanges: [{ target, from, to }] }

export function buildStateCommitPre(input)      // 归一化 + 必填校验，缺字段 fail-closed
export function commitConflictPre(commit, observed)  // → { ok:false, reason, detail:{ expected, observed, actor, boardId } }
export function commitReceiptPre(commit, result)     // → { txId, boardId, miv, digest, at, actor }
```

**`boardId` 硬约束（卡内明确要求）**：在工作区内**稳定**、**不含当前会话号**
⇒ 由 `sha256(workspaceKey + '|' + scope)` 派生，**不得**掺 `sessionId`。理由：接续后新窗口换 sessionId，
若 boardId 跟着变，图就会被当成两块，共享语义直接崩。

### 2.2 【新增】`miv` 单源：`memoryIndexVersionPre(projection)`

> **★2026-09-15 施工期核实：§6 第 2 步「收敛 `activation-host-pre.js:111 setMiv`」已撤销。**
> 实测 `setMiv`（`lib/activation-host-pre.js:111` + 孪生 `lib/activation-host.js:111`）**全仓零调用者**（`lib/`、`tests/`、`lib/client.js` 全量检索仅命中其自身定义行）⇒ 它是**死代码**，
> **没有"活跃写者"需要收敛**。真实 miv 更新路径是 `:100-104` 的 `corpusRegistry.get(catalog)` 分支（`mivCache = { wsRef: ws, miv: res.snapshot.memoryIndexVersion }`），
> 而该 `memoryIndexVersion` 来自契约 §8 的 `shadow-retrieval-pre.js:145 memoryIndexVersion(sources)` —— **它才是建索引侧真源**。
> 结论：P1 **不删死代码、不动 `mivCache`**（删死代码属独立清理项，不混进 P1；动了反而扩大回归面）。

```js
// lib/state-commit-pre.js
export function memoryIndexVersionPre(projection) {
  // 输入：{ records:[{id, status, l0?}], boardCards?:[{id, status}], scope }
  // 输出：'idx_pre_' + first32hex(sha256(canonical))
  // canonical = 按 id 升序的 [id, status, contentDigest] 三元组（换行拼接，无尾随空白）
}
```

**三条硬规则**（卡内 T1-5 扩展口径）：

1. **内容身份 + 状态清单摘要**：`status` 进摘要 ⇒ 仅状态变化（`current→superseded`）**miv 必变**。
2. **不递增、不比较**：miv 是哈希身份，**不是版本序**。任何代码不得写 `if (miv > lastMiv)`。
3. **白板卡片状态也进摘要**：`boardCards` 参与 canonical ⇒ 扩到白板。

**必须废弃的口径**：WB-GRAPH 的 `index.json` 里 `rebuilt_at` **不得**当版本序。它是时间戳，重建时间变但内容没变时它会变 ⇒ 用它当版本序会造成**假失效 + 真混版**。P1 交付物里包含一条断言专门钉死它。

### 2.3 【改动】`memory-writer-pre.js`：提交方法收 `expectedStateVersion` + actor

- `replace` / `append` / `migrate` 等五个方法（`:332/344/357/369/380`）在 `_queue` **内部**、`expectedDigest` 校验**之后**，追加：
  ```
  if (opts.expectedStateVersion != null && state.stateVersion !== opts.expectedStateVersion)
      return commitConflictPre(...)   // 可见冲突，不写
  ```
- **不改 `atomicReplace` 签名**（它不是 CAS，别给它加语义）。
- **不引入长期编辑锁、不按会话分片**（卡内明确否决）。队列 key 仍是文件路径。

### 2.4 【撤销】~~`tier-layer-inject-pre.js:195` 版本门补 `miv`~~

**★2026-09-15 施工期核实后撤销**：该检查**已存在**（`:200-204`，含 `version-unknown` 与 `miv-changed` 两条 fail-closed），
投影与调用方亦已就位（`activation-host-pre.js:165` / `index.js:4269`），并有专项测试
`tests/smoke/smoke-test-t0-2-version-gate-pre.mjs`。**I6 已守住，此处不改任何代码。**

*（以下原始改动设想作废，仅留痕）*
- ~~现：只比 `contextVersion`。改：`contextVersion` 且 `miv` 两侧可得且相等；任一侧缺 `miv` ⇒ 不复用。~~
- ~~新增拒绝原因 `miv-mismatch` / `miv-unknown`~~ ⇒ 既有实现用的是 **`version-unknown`** 与 **`miv-changed`**（`tier-layer-inject-pre.js:200-204`），命名不同因而已有测试可依。

### 2.5 【新增】状态命名隔离常量

```js
export const MEMORY_STATUS_PRE = Object.freeze(['current', 'superseded', 'retracted'])
export const TASK_STATE_PRE    = Object.freeze(['open', 'done', 'passed'])
export const ARCHIVE_STATE_PRE = Object.freeze(['active', 'archived'])
```

三者**不得互转**（卡内"三种状态不能混"）。`archived` 一词两义的问题以 `ARCHIVE_STATE_PRE` 独立命名解决，
**映射由白板线适配器负责**（KICKOFF §3.4 边界约定：3.0 不自行解释图格式）。

### 2.6 【改动】冲突可见性

- `mutationRefusalTextPre`（`memory-mutation-pre.js:212`）扩字段：拒绝文本必须带**当前版本 + 冲突目标**（卡内 T1-7C 要求），形如
  `[提交被拒] tx=<txId> 目标=<path> 期望 miv=<a> 实测 miv=<b> 冲突方=<actor.sessionId>@<contSeq>`

---

## 3. 契约影响

| 契约 | 现状 | P1 后 | 是否接口改动 |
|---|---|---|---|
| **I5** 非 current 两处过滤 | P0 已达标（注入侧 import 检索侧 `isCurrentPre`） | 不变 | 否 |
| **I6** 三层同快照（同一 miv） | **已守住**（P0 的 T0-2 已修，见 §1.2b 勘误） | **不变**（P1 不动此路径） | 否 |
| **I7** 降级必须显式标注 | 达标 | 新增 `miv-unknown` 降级行 | 否（复用既有降级通道 `index.js:4246`） |
| T1-5 仅状态变化 miv 必变 | 未覆盖白板 | 覆盖（§2.2 规则 3） | 否 |
| `validateMutationBoundaryPre` | 只收投影 | **不变**（3.0 只接收规范化投影，不解释图格式） | 否 |

**兼容档**：~~`memoryMutationMode='readonly'`（既有开关）~~ **★2026-09-15 施工期核实：该键在代码中不存在**
（`lib/`、`tests/`、`lib/client.js`、本机 `~/.dsh/dsh-auto-memory-pre.json` 全量检索均无命中；仅出现在 4 份文档里：
`PLAN-gpt6astra-round2-20260914.md:458/696`、`MASTER-PLAN-3.0.md:227`、本稿）。
⇒ **P1 的实际回滚面 = 新增字段全部可选**：不传 `expectedStateVersion`（也不传 `expectedDigest`）时，
`_checkCommitBoundary` 两个闸都不触发，行为与 P1 前**逐字节一致** —— 这是已实测的（见 T1-8）。
`readonly` 若要落地，属**独立新功能**（需实现 + 配置项 + GUI），**不在 P1 范围**，另行排期。

---

## 4. 验收断言（**能失败**，逐条对应卡片 crit）

| ID | 断言 | 对应 crit |
|---|---|---|
| **T1-1** | 两窗口读同一 digest 后**同时**提交替换 → 恰好一项 `ok:true`，另一项 `ok:false` 且 `reason` 可见 | 卡内 T1-4 |
| **T1-2** | 成功版本内容**未被覆盖**（终态 == 成功者写入内容） | 卡内 T1-4 |
| **T1-3** | A、B 会话共享图节点；**A 的激活包与交付记录不出现在 B** | 卡内 T1-7B |
| **T1-4** | 旧接续窗口迟到写入**不能覆盖新图**；拒绝信息带**当前版本 + 冲突目标** | 卡内 T1-7C |
| **T1-5a** | 业务内容改变 ⇒ miv 变 | 卡内 T1-5 |
| **T1-5b** | **仅**状态变化（`current→superseded`）⇒ miv **必变** | 卡内 T1-5 |
| **T1-5c** | 仅切换会话、仅更新 `rebuilt_at` ⇒ miv **不变** | 卡内 T1-5 |
| **T1-5d** | 白板卡片状态变化 ⇒ miv **必变** | Phase 1 扩展 |
| **T1-6** | `boardId` 不含 sessionId：同一工作区两个不同 sessionId ⇒ `boardId` 相等 | 卡内接口要求 |
| **T1-7** | 复用命中 `miv` 不等 ⇒ **不复用**（三层不混版）；任一侧缺 miv ⇒ 不复用 | 卡内 T1-5 / I6 |
| **T1-8** | `expectedStateVersion` 缺省 ⇒ 行为与 P1 前**逐字节一致**（回归守卫） | 兼容档 |
| **T1-9** | ~~`memoryMutationMode='readonly'` ⇒ 所有提交被拒~~ **★核实：该键不存在，本条改写为兼容档真值表**：① 不传 `expectedStateVersion` ⇒ 提交照常成功（零行为变化）② 传入且匹配 ⇒ 成功 ③ 传入且不符 ⇒ 拒绝且可见 | 兼容档 |

**注入式沙箱纪律**（本项目已踩 3 次）：新方法被抽进 `new Function` 沙箱时，
其引用的**所有**模块级符号必须显式列入 helpers，否则 `ReferenceError` 会被外层 `catch` 吞成"静默空内容"。

---

## 5. 明确**不做**的事（防止范围蔓延）

- ✗ 不加长期编辑锁、不按会话分片（卡内否决）
- ✗ 不改 `atomicReplace` 语义（它不是 CAS）
- ✗ 不引入 `miv` 序比较（哈希身份，不递增）
- ✗ 不在 3.0 内解析白板格式（KICKOFF §3.4：白板线拥有 `parseWhiteboardPre`）
- ✗ 多宿主同目录 —— **留给 U2 单独认证**；若要多进程直写同一文件，必须另加跨进程原子提交或单写者路由

---

## 6. 施工顺序（每步跑全量回归）

1. `state-commit-pre.js` + 单测（纯函数，无接入风险）
2. ~~`miv` 单源接线（`setMiv` 收敛到单一计算点）+ T1-5a/b/c/d~~ **已撤销**（见 §2.2 勘误：`setMiv` 为死代码，无对象可收敛）+ T1-5a/b/c/d ✅ **已完成**（`smoke-test-state-commit-pre.mjs`）
3. 队列内 `expectedStateVersion` 校验 + T1-1/T1-2/T1-4/T1-8/T1-9
4. ~~`tier-layer-inject-pre.js` 版本门补 miv + T1-7（修 I6）~~ **已撤销**（I6 由 P0 的 T0-2 守住，见 §2.4）
5. 状态命名隔离 + T1-3
6. 冲突可见性（拒绝文本）+ T1-4
7. 全量回归 + 更新 `TODO-GRAPH.html` V2-P1 卡
