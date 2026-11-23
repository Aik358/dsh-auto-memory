# 交接任务书：2.3 模型接入后完成 SidecarStore 生产接线

交给后续执行 Agent。工作目录：`D:/dsh-auto-memory`。

本任务的前置条件是 **2.3 事件聚类模型接入已经完成，并且模型 profile/API 已冻结**。在此前置条件未满足前，不要修改 `lib/` 的生产接线。

## 1. 目标

把已验证的 `prototypes/sidecar-store/` 原型接入生产白板 sidecar 读写链，解决 `handoff/index.json` 每次 source 更新都全量重写的问题，同时保持现有消费者的八字段兼容视图、Markdown 真源、PLAN CAS、M1 保护、归档和迁移生命周期。

预期行为：

- 正常 source 更新只追加受影响 source 的事务日志，不再整份写 `handoff/index.json`。
- `by_tag`、`by_cue`、`versions` 在内存中维护，兼容读取接口仍返回完整八字段对象。
- 多进程/多会话对同一 workspace 写入不丢更新。
- 旧 `index.json` 可以导入，新 API 可以导出兼容 JSON。
- sidecar 失败不会让正文写入失败，但必须可观测为 stale。
- 2.3 的语义模型只用于候选排序和提案，不触发自动事件归属、自动合并或批量归档。

## 2. 必须先满足的 2.3 前置条件

执行 Agent 开工前，先确认 2.3 已提供并冻结以下接口契约：

1. 模型 profile：`model`、`dimension`、`dtype`、`pooling`、query/passage prefix、模型文件路径、输入规范化版本。
2. engine identity：模型权重、tokenizer、维度、pooling、输入版本和缓存分区进入 identity；旧向量不能与新模型混用。
3. 事件表示：优先 `name + summary + 最近 checkpoint 的 goal + state`，缺失时回退 `checkpoint.text`。
4. 归属结果只返回候选、分数、margin、解释和提案状态，不直接改事件库。
5. 降级链清楚：模型不可用时回到可用模型，最终回到词法路径；失败原因可观测。
6. 模型选择、pooling 和 prefix 不再由 SidecarStore 自己决定。

当前评测不能支持自动判定：早期 C2 fields top-1=47.6%、ARI=0.409、C3 fields top-1=50.8%、ARI=0.443 只作历史对照。后续 `ATTR-REALISTIC-20261110.md` 的 630 真实查询复测为 C2 top-1=21.7%、top-5=57.1%，早期 fields 增益已证伪。2.3 归属判定器的新基准见 `PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`。不得把旧报告中的 margin 自动 attach 示例或全局 merge threshold 直接复制进生产。

## 3. 原型资产

先阅读以下文件，不要重写协议：

- `prototypes/sidecar-store/README.md`
- `prototypes/sidecar-store/index.js`
- `prototypes/sidecar-store/index.d.ts`
- `prototypes/sidecar-store/sidecar-store.js`
- `prototypes/sidecar-store/index-state.js`
- `prototypes/sidecar-store/markdown-adapter.js`
- `prototypes/sidecar-store/journal-storage.js`
- `prototypes/sidecar-store/codec.js`
- `prototypes/sidecar-store/tests/run-contracts.mjs`
- `prototypes/sidecar-store/tests/contract.test.mjs`
- `prototypes/sidecar-store/tests/adapter.test.mjs`

原型验证记录：

- `artifacts/_index-gov-20261109/out/prototype-tests.json`：27/27，通过，0 failed，0 skipped。
- `artifacts/_index-gov-20261109/out/prototype-fixture.json`：2,848 entries，原索引 SHA-256 `76ac012a1ba5af429d5699109043de33ca3bb6bbb0757b0a2968ccfbdd06e719`。
- 固定 PLAN source 事务：`33,568 B`；最新模块 API 运行中位 `13.8257 ms`。
- 正常 source 更新不改 checkpoint/manifest；checkpoint 不保存 `by_tag/by_cue`。
- 原型测试是在 Node/Windows 沙盒完成的，不等于 Electron、断电或生产全链路已验证。
- 独立评审 `REVIEW-SIDECARSTORE-PROTOTYPE-20261113.md` 曾证四个接入阻断；B1–B4修复已由 `RESULT-SIDECARSTORE-BLOCKERS-20261113.md` 与Lead独立复跑验证（37/37、0 skipped、6 CAUGHT/0 MISSED）。这只解除原型层阻断，不是生产/HOST验收；facade、R4/审计/迁移与真实宿主仍未实施或未验。
- 归属基准以 `PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md` 为准；R4 维护文档生命周期与 `events.jsonl` 审计必须保留。

## 4. 生产接线范围

### 4.1 移植模块

建议将原型移到 `lib/sidecar-store/`，保持职责分层：

```text
sidecar-service.js       workspace -> SidecarStore 实例、生命周期、迁移屏障
sidecar-store.js         公共 API、CAS、幂等、内存发布
index-state.js           entries、source 桶、保序倒排、八字段视图
markdown-adapter.js      Markdown -> entries、source revision
journal-storage.js       shared lock、checkpoint、JSONL、恢复、压实
codec.js                 checksum、schema、错误类型
```

移植时只改相对 import 路径：原型中的 `../../lib/shared-state-lock.js` 应改为 `../shared-state-lock.js`；Markdown 解析器改为从 `../wb-sidecar.js`、`../plan-store.js` 引入。

不要把 store 实例直接挂在全局单例上。按 canonical `projectDir`/workspace 缓存，每个 workspace 一个实例；配置根变化时关闭旧实例、清理缓存、重新打开目标实例。

### 4.2 五个生产接入门

必须逐个收口以下位置：

1. `lib/index.js:writeSidecarEntryPre`：PLAN/ledger source 更新委托 `replaceSource` 或 `replaceSources`；保持 `{ ok: false, error: 'sidecar-stale' }` 的 fail-soft 返回。
2. `lib/index.js:_writeSidecarIndexPre`：保留兼容方法，但不再执行整份 `JSON.stringify` + `writeTextAtomicPre`；只调用 store 的 source 事务或兼容导出。
3. `lib/index.js:rebuildSidecarIndexPre`：只用于缺失、损坏、显式修复或迁移；保留当前默认 source 范围，不默认加入 archive；全量重建需要全局 generation/CAS。
4. `lib/index.js:_loadSidecarIndexPre`：返回 store 的八字段 view；继续检查 `sourceRevisions['handoff/PLAN.md']`，PLAN 外改时触发有限 source 修复，而不是静默使用旧缓存。
5. `lib/index.js:handoffPanelData` 的 `?file=index.json` 旁路（约 `:8892/:8910`）：不能继续直接读旧文件；改为边界校验后返回 `exportLegacySnapshot()` 的最新内容。

生产消费者继续拿到：

```text
version, ws, rebuilt_at, entries, by_tag, by_cue, versions, sourceRevisions
```

不要求消费者理解 JSONL、manifest、generation 或 checkpoint。

接线时必须冻结以下五个契约，不能让不同 Agent 各自猜测：

1. legacy 空 `sourceRevisions` 如何迁移为新 revision。
2. `versions` 是否只作为 opaque compatibility metadata，不能当文件路径。
3. shared-lock timeout 如何映射为公共 `INDEX_*` 错误。
4. `recoveredTailBytes` 是本次 read 的观测还是启动累计告警。
5. 多节文档的外部 `title` 是否覆盖正文标题；否则 parserVersion 会变化而 entries 可能不变。

解析失败必须返回 sidecar failure/stale，不能把 parser fallback 的 `[]` 当合法空文档提交为 tombstone；否则修复解析器后可能因为相同 revision/parserVersion 触发 `INDEX_REVISION_MISMATCH`，无法自动恢复。

## 5. 接入顺序

### S0：冻结契约

- 记录 2.3 profile/API/identity 的最终形状。
- 固定事件表示和降级链。
- 确认 SidecarStore 只负责派生索引，不负责事件聚类决策。
- 建立 production/Node 两套测试入口。

停止条件：2.3 profile、模型 identity 或事件提案 DTO 仍会变化。

### S1：移植原型和 service

- 移植 `lib/sidecar-store/`。
- 新增 `sidecar-service.js` 管理 workspace 实例、打开、关闭、失效、stale 状态。
- 先只接兼容读取和旁路导出，不改变正文写行为。
- 对旧 `index.json` 做一次受控导入，原文件只读保留。

验收：旧 fixture 导入后八字段导出 SHA 与旧文件一致；新服务可被两个实例同时打开。

### S2：接 source 写入

- `writeSidecarEntryPre` 改为 source 事务。
- 先完成所有输入校验和 CAS，再写一条日志；不能写半条事务。
- 写入成功后再更新内存状态；失败清缓存并从 checkpoint/journal 恢复。
- 无变化 source 必须 0 B 追加。

验收：PLAN 五条 entries 修改一条时，不能写整份旧 JSON；source 事务小于 64 KiB 只是当前 fixture 的预算，不是任意文档的硬保证。

### S3：接读、导出和损坏恢复

- `_loadSidecarIndexPre` 使用 store view。
- `handoffPanelData(?file=index.json)` 使用兼容导出。
- 缺失/损坏新格式不得静默初始化空库；保留坏代证据，再按明确 source 范围从 Markdown 重建。
- 旧格式仍可显式导入，导入失败不能覆盖原件。

验收：外部 PLAN 修改、旧 JSON 缺失、日志残尾、完整坏行、manifest 缺失分别得到明确行为。

### S4：接迁移生命周期

`_saveConfigChecked` 在约 `lib/index.js:4412` 开启迁移窗口，并在约 `:4434` drain mutation flights。SidecarStore 的打开、读修复、写入、压实必须纳入同一迁移屏障。

- 迁移窗口内的新 sidecar 写必须拒绝或等待明确的已受理 flight。
- 不要在 sidecar 写路径里取得 `config-lock`，避免和配置保存的 drain 互等。
- PLAN 的 admission scope 目标是 PLAN.md；不要把 manifest 路径当成自动继承了 PLAN admission。
- 根切换成功后：关闭旧 store、清理 cache、重新打开目标 store、复核 Markdown source revision。
- `disposeSurfaces` 关闭 store 时必须等待已受理队列，不得留下裸 rejection。

验收：迁移窗口、旧 writer、目标目录已有旧 generation、回滚、dispose 均有测试。

### S5：删除旧全量写路径

只有 S1-S4 全部通过后，才能删除或禁用正常路径的全量 `index.json` 写入。兼容导出可以保留，不能作为每次事务的持久化副本。

停止条件：任何消费者仍直接读 `handoff/index.json`，或任何正常 source 写仍会整份重写旧 JSON。

## 6. 必测项目

先跑原型测试：

```powershell
node prototypes/sidecar-store/tests/run-contracts.mjs
```

生产接线至少新增/更新以下测试：

- `smoke-test-board-index-atomic.mjs`
- `smoke-test-issue164-plan-cas.mjs`
- `smoke-test-issue164-plan-tools.mjs`
- `smoke-test-settings-plan-migration.mjs`
- `smoke-test-graph-mode.mjs`
- `smoke-test-p23-wb-sidecar.mjs`
- `smoke-test-handoff.mjs`
- `smoke-test-p7-write-fix.mjs`
- `smoke-test-plan-seed.mjs`
- `smoke-test-wsfix.mjs`

行为验收：

1. 两进程同 workspace 写不同 source，所有更新保留。
2. 同 source stale revision 只有一个写者成功，另一个明确冲突。
3. 同 operationId 同输入重试返回 alreadyApplied，不追加重复事务。
4. source 无变化 0 B 追加、seq 不变。
5. `by_tag`/`by_cue`/`versions` 与旧实现顺序和内容一致。
6. 旧 JSON 导入/导出保持八字段和未知 entry 字段。
7. 新格式坏行、seq 缺口、manifest 缺失不会建空库。
8. 外部 PLAN 修改能被 source revision 检测到。
9. 迁移窗口拒新写、等待已受理写、切根后旧实例不再写。
10. dispose 等待队列，不产生未处理 rejection。
11. 2.3 只产生候选/提案，不触发 event-regroup-apply。
12. C2/C3/profile 改变后向量缓存分区不串用。

接入前还要补原型当前未完全覆盖的边界：

- `appendAfterWrite` 强杀后，用同 operationId 重试，确认不会重复提交或错误返回 alreadyApplied。
- operation history 淘汰后的重复 operationId 行为。
- 缺 manifest、checkpoint、journal；symlink/非 regular file；schema、workspace、generation 不匹配。
- 初始化留下 orphan generation 文件时的处理。
- `durable:false`、锁超时、读/写/compact 并发、过期事务句柄。
- 多个读写已排队时立即 `close()`：已受理任务完成，新调用统一 `INDEX_CLOSED`，且无残留锁文件或未处理 rejection。
- 热 reader 已缓存前缀被同长度外部篡改时，冷重开是否能发现并拒绝。
- 真实生产源文件锁、正文 CAS、sidecar append、stale 标记的顺序。
- checkpoint 中未知 `view.version` 的冷启动行为；旧消费者只支持 `wb_sidecar_pre_v1` 时必须拒绝或显式降级。

注意：当前 JournalStorage 为恢复残尾会以 `r+` 打开 journal，读修复路径需要目录写权限；这是生产权限检查的一部分。

## 7. 禁止事项

- 不直接读写 `handoff/index.json` 作为正常业务路径。
- 不把 `by_tag`、`by_cue`、`versions` 从 API 删除。
- 不在正常 source 更新中整份写兼容 JSON。
- 不在 2.3 评测未达门槛时自动 attach、自动 merge、自动 archive。
- 不照抄报告中互相冲突的 margin/merge 全局阈值。
- 不在旧 writer 仍运行时做格式迁移。
- 不把 Node 原型测试当成 Electron 或真实掉电保证。
- 不把“27/27 原型通过”当作上述缺口已经完成；fixture 缺失时测试不得通过 skip 掩盖问题。
- 不把 SidecarStore 变成 Markdown 正文真源；Markdown 仍是真源。
- 不通过添加注释或改字符串来绕过已有测试守卫；改成行为测试。

## 8. 完成定义

执行 Agent 只有在以下条件全部满足时才能报告完成：

- 2.3 模型 profile/API 已冻结并有降级测试。
- SidecarStore 已进入生产模块边界，五个接入门无直接旧 JSON 读写。
- 旧数据已可导入、导出、恢复和回滚。
- 共享锁、CAS、幂等、source revision、迁移 admission 都有真实行为测试。
- 生产消费者八字段输出和顺序兼容。
- 正常 source 更新不再产生整份 `index.json` 写盘。
- 2.3 仍保持候选/提案模式，2.4 自动 apply 仍关闭。
- 报告列出修改文件、测试命令、真实字节/耗时、未测边界和回滚方式。

如果任何一项无法证明，保留旧路径或停在当前阶段，不要把部分接线描述成完成。
