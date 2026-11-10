# 【任务】R4 P4-0：真实事件汇适配 + 默认关闭的最小写入接线

你是实现 Agent。工作目录 D:/dsh-auto-memory。用户已同意按 P4-0 → P4-1… 推进。

## 0. 权威依据与真实基线

- 先读 docs/internal/PROTOCOL-R4-20261110.md §2、§9.2、§9.4；docs/internal/LEDGER-DOC-API-CONTRACT.md。
- 基线 HEAD 3cc1d12857236764cbe3f68af5316ad8716a14e4。
- lib/index.js 当前 29,264 行 / 2,118,777 B / SHA-256 0bd9d410f613192808df04e5abcff4d5347123f1f3d3b0d1140c28c76c9f7f49。大文件禁止整文件 write，只能内容锚定 edit；收工报告增量与 diff。
- 真跑验证：node tests/smoke/smoke-test-r4-system.mjs 当前 20/0；相关既有套件 tests/smoke/smoke-test-v4-event-store.mjs 必须跑。按用户既定偏好，不跑全仓回归。

## 1. 真实事件汇适配（本批主体）

### 1.1 新增 lib/ledger-doc/event-store-sink.js

实现 `EventStoreLedgerSink`，构造接收隔离工作区根目录及显式 storePath；公开 `append(eventId,{phase,opId,operationDigest,checkpoint})`、`listCheckpoints(eventId)`，签名与现有合成 sink 完全一致，可直接作为 LedgerWal 的 eventSink。

- `append` 调用真实 `eventStorePre.append(storePath,eventId,...)`，真实落盘到隔离 storePath。
- `opId` 按 `opId+':prepared'/':committed'/':failed'` 形成存储操作键；业务 opId 原样写入检查点；operationDigest 同时入检查点和台账。
- 持久化真实 `checkpointId=ckpt_<16hex>`，事件内唯一，由事件存储在 append 时生成并随结果返回；不能用数组下标/时间戳/idemKey 冒充。
- `listCheckpoints` 返回真实检查点，字段含 checkpointId/opId/phase/operationDigest 以及协议要求的 prepared/committed/failed 载荷。
- 允许 prepared/committed/failed 三类新 kind 通过既有校验；若需改白名单/校验，内容锚定小改并补正负测试。
- 默认拒绝真实记忆根；只允许工作区 artifacts 下的绝对隔离路径，复用 file-boundary.js 做物理越界校验。

### 1.2 对 lib/event-store.js 做最小兼容扩展

1. checkpoint 持久化白名单增加 checkpointId、opId、phase、operationDigest、WAL 必需载荷字段（只加可选字段，不改旧字段语义）。
2. 仅在显式 R4 载荷（phase/opId/operationDigest 齐全）时生成 checkpointId；旧 append 不生成、不新增键，保持旧返回/磁盘语义。
3. appliedOps 对 R4 操作保存 `{at,operationDigest,payloadDigest}`；同键同载荷重放去重；同键异载荷明确失败 `op-payload-mismatch`；不得静默早退。
4. 台账淘汰后，从该事件带 opId/phase/digest 的检查点恢复重放证据；旧数字台账记录遇到新 R4 重放返回 `op-payload-unverifiable`，不得默认同载荷。
5. closed 重放与既有 idemKey 语义不变；不传 opId 的所有既有调用点行为不变。
6. 不把全文再塞入检查点：R4 prepared 保存 changeSet 与摘要/四段，committed/failed 保存目标 revision、preparedCheckpointId 和实际结果。

## 2. 默认关闭的最小生产写入接线

- 在 lib/index.js 只新增显式 opt-in 的 `LedgerDocSystem` 装配点/入口：默认关闭，默认走旧写入链；不替换 memory_note(kind=handoff) 现行生产行为。
- 真实工作区生产根目录与本机真实记忆数据仍禁止写入；最小接线只证明「门面 + 真实 sink + WAL」在隔离副本上闭环。
- 不允许让新路径成为唯一接续来源；不迁移、不归档、不删除。
- 旧提示词本批不改，留到实际读侧启用前同批改。

## 3. 测试与报告

新增 tests/smoke/smoke-test-r4-event-store-sink.mjs，真 import/构造/调用/真实磁盘副作用；至少覆盖：

- 真 append 后 checkpointId 读回一致且格式正确，事件内唯一；重放不产生第二个 ID。
- prepared/committed/failed 同业务 opId 分阶段各落一条，互不吞掉。
- 同 opId+同阶段+同载荷去重；异载荷失败；台账淘汰后仍能判重放；旧数字台账 unverifiable。
- 旧检查点无 checkpointId 时保持 null/缺省，不原地回填。
- 真实 sink 接入 LedgerWal/LedgerDocSystem，prepared→原子文档→committed→listCheckpoints 全闭环；真实 kill 后 replay/reconcile。
- 非法 ID/closed/未知事件/越界路径均失败且文档/事件 +0。
- 负路径配正向对照；隔离副本变异至少覆盖 checkpointId 不持久化、opId 不按阶段分键、异载荷静默去重三条，均必须红、还原复绿。
- 既有 R4 七套件 191 PASS/0 FAIL + v4-event-store 既有套件通过；报告实测计数，不写估计。

## 4. 交付与边界

交付 event-store-sink.js、必要最小扩展、最小默认关闭装配点、测试与 docs/internal/R4-P4-0-RESULT-20261111.md。含源码/产物字节数、SHA-256、diff 范围、实测计数、变异结果。

不改真实记忆数据、不接读侧、不做全仓回归、不做 P5 真实宿主端到端、不迁移/删除。完成后 send_message 给 lead，等待 Lead 复核与提交。