# R4 P5 真缺口执行结果（2026-11-12）

> 执行者：handoff-ledger（DeepSeek 队友）。范围：仅 P5 两项可执行真缺口 + 只读观测 + 提示词；**不含** 2.6/2.7/2.8、D4、2.3/2.4，不含 P6/P7。
> 未 git commit、未发布；未写生产记忆、未动 19387。

## 0. 结论边界（先说不成立的部分）

- **真实模型轮次未做**：见 §5。本报告不把源码措辞断言冒充「模型行为已改」。
- 两进程并发、R4-off 写侧、历史门面观测/入口、classic 完整正文截图 —— **本次已拿到实测证据**。
- 跨设备团队基线端到端仍**未做**（不在本次可执行面）。

## 1. 改动清单（3 文件，全部可复算）

| 文件 | 改动 | 守恒 |
|---|---|---|
| `lib/index.js` | ① GUIDANCE 与 memory_log 工具描述两处「交接账本=新开一篇」改为「目标态=就地更新维护文档；`ledgerDocEnabled=false` 时仍走旧路径新开 `handoff-*.md`，且只使用实际给出的 documentId，不得编造」；② `debugInfo()` 尾部新增只读投影 `ledgerDoc` | 字节 2,141,721 → **2,143,692**（Δ +1,971）；行 29,552 → 29,578；CRLF 29,577 / **裸 LF 0**；export 27 不变；路由 86 不变 |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | 按**本套件自身管道**（第 23 行 IX=LF 归一化全文）重钉 `R153_CHARS` 1,592,471 → **1,594,012**，sha16 `FEE5CE42FF7B9225` → `A533BCD355062B96` | 26 PASS / 0 FAIL |
| `tests/smoke/` 新增 3 套件 | `smoke-test-r4-p5-concurrency.mjs`(8)、`smoke-test-r4-p5-off-write.mjs`(7)、`smoke-test-r4-p5-history-probe.mjs`(9) | 合计 24 PASS / 0 FAIL |

**只读投影字段**（8 个键，全部聚合/布尔/revision，无正文、无路径、无事件体）：
`available / enabled / cachedSystems / historyEntryPoint / historyEntryPointKind / hostRoute / lastCommittedRevision / lastCommittedDocumentId`

## 2. 两进程同文档并发（PROC，真子进程）

套件：`tests/smoke/smoke-test-r4-p5-concurrency.mjs`（**8 PASS / 0 FAIL**，1,786 ms）
证据：`artifacts/_r4-p5-20261112/evidence/concurrency.json`

| 判据 | 实测 |
|---|---|
| 同文档同 revision 两进程 | **恰 1 winner / 恰 1 `document-version-conflict`**，最终 revision 与 content 等于 winner |
| 竞态后清洁度 | `.tmp` 0 个、`.lock` 0 个 |
| 失败方按 winner revision 重试 | 成功，两笔写入按序保留 |
| 8 进程突发 | **winner 1 / conflict 7**，文件里 `revision:` 与 `documentId:` 各恰 1 行（无撕裂） |
| 变异（删除 document lock，隔离副本 `artifacts/_r4-p5-20261112/mutations/no-lock`） | **CAUGHT**（barrier 下两进程均通过内层 CAS ⇒ 无锁必丢一次更新）；还原后 GREEN |

**明确非替代**：kill/reconcile 属另一不变量（由 `smoke-test-r4-wal` 覆盖）；本套件 P5C-05 已把该边界写成显式断言，不作为本条证据。

## 3. R4-off 的 memory_note 零 R4 副作用（PROC+MOD）

套件：`tests/smoke/smoke-test-r4-p5-off-write.mjs`（**7 PASS / 0 FAIL**，853 ms）
证据：`artifacts/_r4-p5-20261112/evidence/off-write.json`

隔离 `DSH_HOME=artifacts/_r4-p5-20261112/fixtures/off-write/dsh-home`，`ledgerDocEnabled=false`，真 `apply()` + 真 `memory_note.execute()`：

| 判据 | 实测 |
|---|---|
| 引擎真读到 `ledgerDocEnabled=false` | `engine.config.ledgerDocEnabled === false` |
| 写前 | handoff 目录不存在 |
| 真实写入 | 产出 `handoff-20261112-020645.md`（旧路径） |
| `handoff/documents/` | **不存在**（0 条目） |
| 事件库 | 1 条检查点，`wal-*` **0**，带 `opId` **0** |
| 账本字节 | 332 B，200 ms 窗口内**逐字节不变**，首行 `# 交接账本` |
| 第二次写 | 账本 1 → 2，`documents/` 仍 0 |

## 4. 历史门面观测 / 入口

### 4.1 进程内（PROC+MOD）
套件 `smoke-test-r4-p5-history-probe.mjs`（**9 PASS / 0 FAIL**）：
- `engine.debugInfo()` 真实返回 `ledgerDoc`；键集合恰为上述 8 个；**不含** `## 任务状态`/`## 目标`/`handoff/documents`/`C:\\Users` 等正文或路径串；长字符串 >200 字符即判泄漏（本轮通过）。
- `enabled=false` 如实反映；`hostRoute=null`；`lastCommittedRevision=null`。
- `LedgerDocSystem.queryHistory` 在隔离合成库上**真调用成功**（total=1）。**注意**：合成 eventId 必须满足 `/^evt_[0-9a-f]{8}$/`，本轮首版用 `evt_p5h00001` 被 `event-id-invalid` 拒（已修正为 `evt_a1b2c3d4`）——这是协议约束，不是缺陷。

### 4.2 真实宿主（HOST）
隔离宿主：`DSH_HOME=artifacts/_r4-p5-20261112/dsh-home`、profile `p5`、端口 **19500**、pid **6088**、插件 `engine + 22 tools + injection + 86 routes`。
证据：`artifacts/_r4-p5-20261112/evidence/host-debug-projection.json`

| 探针 | 实测 |
|---|---|
| `GET /api/dsh-auto-memory/debug` | 200；`ledgerDoc = {available:true, enabled:true, cachedSystems:1, historyEntryPoint:"LedgerDocSystem.queryHistory", historyEntryPointKind:"facade", hostRoute:null, lastCommittedRevision:null, lastCommittedDocumentId:null}` |
| `GET /api/dsh-auto-memory/config` | 200；180 键；`ledgerDocEnabled=true`、`handoffEnabled=true`、`boardMode=legacy` |

**口径诚实**：`hostRoute` 仍为 `null` —— 本次**没有新增 HTTP 路由**（路由数 86 守恒）。`queryHistory` 的**宿主观测**是通过 `/debug` 的只读投影声明「入口存在且 kind=facade」，而不是新增一条历史查询路由。

## 5. 旧提示词改与真实模型行为 —— **模型行为未验证（如实记缺口）**

### 5.1 已改（源码级，可复算）
- `GUIDANCE`（`lib/index.js:453`）：交接账本条改为「目标态=就地更新维护文档（handoff/documents/<documentId>.md，按 revision 原地改）」+「当前默认（ledgerDocEnabled=false）仍走旧路径——每次新开一篇 handoff-*.md，append-only、不追改旧账本」+「只能使用注入面或工具实际给出的 documentId，没有给出就按旧路径写，不要凭猜测编造 documentId」。
- `memory_log` 工具描述（`:24759`）：同款三句。
- 断言（P5H-05..P5H-09，5 PASS）：目标态措辞在场、`ledgerDocEnabled=false` 在场、`append-only` 保留、反编造规则在场、**旧的无条件「新开一篇」措辞在两处均已消失**。

### 5.2 真实模型轮次：**未做**
环境事实（`evidence/agent-model-descriptor.json`）：
- 本 lane 模型 descriptor：`deepseek-v4.1-flash`（DeepSeek Harness）。
- 隔离 `DSH_HOME` 的 `.credentials.yaml` 仅含宿主鉴权记录（2 个顶层键 `version`/`records`），**不含 provider 模型凭据**；隔离宿主可启动、可服务路由，但**无法在此 lane 提交一次真实对话轮次**。
- 因此：**「模型是否从『新开一篇』转向就地编辑、是否会在无 documentId 时编造」本轮无证据**，不作静态断言替代。

## 6. classic 修复后完整正文宿主截图（HOST）

证据：`evidence/classic-full-body.json`；截图 `screenshots/classic-doc-full-body-scrolled.png`（1,280×600，144,854 B）。

- 隔离宿主 real GUI（`http://127.0.0.1:19500`，classic 皮肤，`boardMode=legacy`），合成维护文档 `p5-classic-261112-0001`（708 B，revision `sha256:d2519bd9…`）。
- 路径：记忆面板 → **白板** → 维护文档 → `版本 d2519bd9 · p5-classic-261112-0001` → 打开。
- 服务端 `GET /handoff-state?...&file=documents/p5-classic-261112-0001.md` 返回 **708 B 全文**，含四节（任务状态/目标/已试方案与失败原因/进度与下一步）。
- 面板内 `div[data-dam-content]` 实测 **390×420**（不是 220px 硬裁）；在卡片内滚动后，**四节全部可见**，末节 `## 进度与下一步` 与正文完整呈现。
- 判定：**classic 修复后完整正文已闭合**（此前 `R4-P4-2-SCREENSHOT-REVIEW` 记录的「正文停在 ## 任务状态」不再复现）。

## 7. 回归

| 套件 | 结果 |
|---|---|
| r26-cross-layer（含重钉） | 26 / 0 |
| r4-p5-concurrency / off-write / history-probe | 8 / 7 / 9，全 0 FAIL |
| r4-ledger-lock / r4-wal / r4-ledger-doc | 15 / 25 / 43 |
| r4-system / r4-read-side / r4-event-store-sink | 20 / 26 / 14 |
| r4-acceptance-fix / r4-history-query / r4-coverage-audit | 5 / 23 / 41 |
| r4-material-stamp / r4-team-baseline / r4-p4-2-panels / r4-p4-3-brief-scan | 24 / 14 / 14 / 20 |
| `node tools/verify-docs.mjs` | 全部一致（EXIT 0） |

合计 **17 套 / 289 PASS / 0 FAIL**。

## 8. 仍未闭合（不掩盖）

1. **真实模型行为**（§5.2）。
2. **跨设备团队基线端到端**（本 lane 无第二台设备/团队服务端）。
3. `queryHistory` **没有 HTTP 路由**，宿主观测只到「投影可见 + facade 可调用」；若 P6 要真实宿主点按钮，需另开入口。
4. P5 的「注入帧真正进入模型上下文」仍只能 MOD（与 `R4-HOST-VERIFY` C1 同结论）。

## 9. 产物路径

- 基线：`artifacts/_r4-p5-20261112/baseline-index-js.json`、`baseline-files.json`
- 证据：`evidence/{concurrency,off-write,history-probe,host-debug-projection,classic-full-body,agent-model-descriptor}.json`
- 截图：`screenshots/classic-doc-full-body-scrolled.png`、`classic-doc-open-full.png`、`classic-panel-maintenance-list.png`
- 宿主日志：`logs/host-boot.log`；GUI：`gui-url.txt`（token 仅在隔离 home）
- 变异副本：`mutations/no-lock/`
## 11. 【已被取代】维护文档写入侧在 P5 时无入口

> **本条由 `R4-P6P7-A1-RESULT-20261112.md` 取代（2026-11-12 同日）**。
> P5 执行时维护文档写入侧确实没有工具入口（`lib/index.js` 中 `createDocument|updateDocument|upsertDocument|new LedgerWal` 全 0 命中），因此当时把提示词写成「当前只能读」是正确的。
> P6/P7 A1 已落地真实入口（`memory_note` 的 `documentId`/`expectedRevision`/`changeSet`，走 CAS + WAL），并已按新接口改写提示词。
> **保留本节是为了留痕：不要把 P5 的「无入口」当成现状引用。**

## 10. Lead 复核后的两项补齐（P5-2 · 2026-11-12 第二轮）

> 复核意见原文：① `debugInfo().ledgerDoc` 只静态声明 facade，未记录最近 query 结果；② R4-on 提示词要求就地更新，但 `memory_note` 无 `documentId`/`expectedRevision`/`changeSet` 入参，不要让提示词诱导不存在的工具参数。

### 10.1 ① 真实 queryHistory 观测 —— 已补（`historyProbe`）

**实现**：`debugInfo()` 新增**并列字段** `historyProbe`（既有 8 键 `ledgerDoc` 逐字节不动，`P5H-02` 仍断言 8 键）。

- 复用**已缓存**的只读门面（`this._ledgerDocReadSystems.get(path.join(projectDir,'handoff'))`）——不新建缓存项，`cachedSystems` 不自增。
- 真调用 `system.start()` → `system.queryHistory({ from: now-1d, to: now+1d, limit: 5, includeQuad: false })`，取回 `total/count/truncated/readErrors`，并从 items 尾部扫 `targetRevision` 得 `latestRevision`（严格遵守 `REVISION_RE`）。
- 未启用 ⇒ `{attempted:false, reason:'disabled'}`；无缓存项 ⇒ `no-cached-system`；未启动成功 ⇒ `not-started` + `errorCode`；异常 ⇒ `{attempted:true, ok:false, errorCode:'probe-failed'}`。**任何情况都不 500**。
- **不泄漏**：只回聚合量 + revision（`sha256:...` 本身就是文档身份摘要，不含 documentId 原文）、耗时；**不含** `text`、路径、`documentId`、`eventId`、`sourceRef`。`hostRoute` 保持 `null`（未新增路由，86 守恒）。

**PROC 证据**（`smoke-test-r4-p5-history-probe.mjs`，现 **12 PASS / 0 FAIL**；本轮新增 3 条）：

| 判据 | 实测 |
|---|---|
| P5H-04b 真跑一次 query | `attempted:true ok:true total=1 count=1 ms=10 rev=none`（真实合成事件库，非替身） |
| P5H-04c 关闭时 fail-closed | `attempted=false reason=disabled` |
| P5H-04d 不自增缓存 | `cachedSystems=1` 前后稳定 |

**HOST 证据**（`evidence/host-history-probe.json`；隔离宿主 19501、profile `p5`、`DSH_HOME=artifacts/_r4-p5-20261112/dsh-home`）：

```
ledgerDoc    : {available:true, enabled:true, cachedSystems:1, historyEntryPoint:"LedgerDocSystem.queryHistory", historyEntryPointKind:"facade", hostRoute:null, lastCommittedRevision:null, lastCommittedDocumentId:null}   // 8 键未变
historyProbe : {attempted:true, ok:true, total:2, count:2, truncated:false, readErrors:0, latestRevision:"sha256:39dc9d1c…1fd4", revisionKind:"sha256", elapsedMs:11}
```

泄漏扫描（对 `historyProbe` 序列化串）：`evt_`=false / `documents/`=false / `## `=false / `D:\`=false / `_r4-p5`=false / 文档 ID=**false**；`sha256:39dc…`=true（**这是 revision 本身，符合「最近 revision」要求**）。

### 10.2 ② 提示词不再诱导不存在的工具参数 —— 已改

**核查结论（实测，不是推断）**：`memory_note` 现有 **17 个参数键** —— `content, action, kind, expectedRevision, fromEvents, cardId, expectedCardRevision, supersedes, retract, retractReason, restore, archivedIds, userPercept, agentTrace, sharedGround, commitment, workspace`；**无 `documentId`、无 `changeSet`**，`expectedRevision` 存在但属于**白板卡片**语义，与维护文档 revision 无关。

**写入侧无生产入口**（全仓取证）：`lib/index.js` 中 `createDocument|updateDocument|upsertDocument|new LedgerWal` **0 命中**；`lib/ledger-doc` 内部只有 store/facade 自身定义。即：**维护文档目前只能读**（面板清单 / 单文档读取 / 历史查询），没有任何工具或路由能改它。

**提示词改法**（两处，均已改）：
- `GUIDANCE`（`:453`）：由「**目标态是就地更新**本工作区的维护文档…只能使用注入面或工具实际给出的 documentId」改为 —— 「**当前唯一可执行路径：每次新开一篇 handoff-*.md，append-only、不追改旧账本** —— memory_note 现在**没有** documentId / expectedRevision / changeSet 这类参数，工具层**无法**就地改维护文档，**不要编造这些参数**（维护文档目前只能读…写入侧尚未接工具入口）。**目标态（接口落地后）**才是就地更新…届时要由注入面或工具**实际给出** documentId 才可用」
- `memory_log` 工具描述（`:24785`）：同款三句（「当前唯一可执行路径」「暂无 documentId/expectedRevision/changeSet 参数」「不要编造这些参数」「维护文档目前只读」）。

断言（`P5H-05..P5H-09`，**5/5 绿**）：目标态措辞在场、`当前唯一可执行路径` 在场、`append-only` 保留、`不要编造这些参数` 在场、**旧的无条件「新开一篇」措辞两处均已消失**。

### 10.3 本轮 diff 指纹（可复算）

```
$ git diff --numstat -- lib/index.js tests/smoke/smoke-test-r26-cross-layer.mjs
69      2       lib/index.js
2       2       tests/smoke/smoke-test-r26-cross-layer.mjs
```

| 指标 | P5-1（上轮） | **P5-2（本轮）** | Δ |
|---|---|---|---|
| `lib/index.js` 字节 | 2,143,692 | **2,146,807** | +3,115 |
| 行数 | 29,578 | **29,619** | +41 |
| CRLF / 裸 LF | 29,577 / **0** | 29,618 / **0** | 行尾未翻面 |
| `export` 行 | 27 | **27** | 0（生成区/导出面零变化） |
| IX（LF 归一化长度） | 1,594,012 | **1,596,673** | +2,661 |
| sha16（IX 前 16 位） | `A533BCD355062B96` | **`123190137DD479DD`** | 已重钉 |
| raw SHA-256 | — | `35821faf55986963a56048e91b5663c98a4679f2f5dcc7d2d7e96a43221f7f11` | — |
| 路由数 | 86 | **86** | 0 |

**r26 锁按本套件自身管道（IX = LF 归一化全文）复算后重钉**：`R153_CHARS` 1,594,012 → **1,596,673**；sha16 → `123190137DD479DD`；归因注释已写为 ★R203b（含两项改动的逐条来源）。r26 实跑 **26 PASS / 0 FAIL**。

### 10.4 回归（本轮重跑）

| 套件 | 结果 |
|---|---|
| r26-cross-layer（含重钉） | **26 / 0** |
| r4-p5-concurrency / off-write / history-probe | **8 / 7 / 12**，全 0 FAIL |
| r4-ledger-lock / r4-wal / r4-ledger-doc | 15 / 25 / 43 |
| r4-system / r4-read-side / r4-event-store-sink | 20 / 26 / 14 |
| r4-acceptance-fix / r4-history-query / r4-coverage-audit | 5 / 23 / 41 |
| r4-material-stamp / r4-team-baseline / r4-p4-2-panels / r4-p4-3-brief-scan | 24 / 14 / 14 / 20 |

合计 **17 套 / 292 PASS / 0 FAIL**（较上轮 289 增 3，全部来自 historyProbe 新增断言）。

### 10.5 隔离与边界（本轮）

- 生产 19387 全程 OPEN 未动；隔离宿主（pid 12456，`--profile p5 --port 19501`，`DSH_HOME=artifacts/_r4-p5-20261112/dsh-home`）取证完即**已关闭**，19501 无监听。
- 未执行真实模型轮次、未做跨设备团队基线；未碰 P6/P7、2.6/2.7/2.8/2.3/2.4；未 commit、未发布。

### 10.6 仍未闭合（P5 收口口径）

1. **维护文档写入侧无工具入口**：提示词已如实说明「当前只能读、目标态待接口落地」。**这是 P6/P7 的 A1 接口工作范围**，P5 不越界实施。
2. **真实模型行为**仍未验证（隔离 home 无 provider 凭据）。
3. `historyProbe` 是**只读观测**，`hostRoute` 仍为 `null`；若 P6 要在宿主里给用户点按钮查历史，需另开路由。
4. 跨设备团队基线端到端未做。
