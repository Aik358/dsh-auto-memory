# 【任务】R4 P3 隔离实现：WAL prepared→committed→failed / 恢复重放

你是**实现 Agent**。本任务在**隔离夹具**中实现 R4 的 P3（WAL 与恢复重放），**不碰真实生产代码路径**。
工作目录：D:/dsh-auto-memory

---

# 零、前置已完成（可直接复用）

| 模块 | 状态 | 你能用什么 |
|---|---|---|
| lib/ledger-doc/protocol.js | ✅ P0 | 协议常量、字段校验器、computeRevision/computeOperationDigest/computeLegacyCheckpointKey |
| lib/ledger-doc/document-store.js | ✅ P1 | 首建 create-only、CAS、原子写、读回、noop |
| lib/ledger-doc/locked-store.js | ✅ P2A | 跨进程锁包装（withSharedStateLock 覆盖整个临界区）|
| lib/ledger-doc/coverage-audit.js | ✅ P2B | 只读审计（本任务不用）|
| lib/ledger-doc/material-stamp.js | ✅ P2C | 指纹（本任务不用）|
| lib/ledger-doc/history-query.js | ✅ P2D | 历史查询（本任务不用）|

**集中验收已通过**：146 PASS/0 FAIL、变异 16 CAUGHT/0 MISSED（commit b2d80ae6）。

---

# 一、权威协议（必读）

**docs/internal/PROTOCOL-R4-20261110.md**：
- §2.1 字段级协议表（尤其 checkpointId/opId/changeSet/prepared/committed）
- §2.2 WAL 与失败补偿状态机（Phase 0/1/2/3 的精确语义）
- §2.3 失败矩阵（9 种失败点的文档/事件/补偿行为）
- §9.2 P3 判据

---

# 二、要实现什么

## 2.1 新建 `lib/ledger-doc/wal.js`

实现 **R4 的 WAL 与恢复重放**（隔离，不接管生产）：

```js
export class LedgerWal {
  constructor(store, eventSink) { /* store=LockedLedgerDocumentStore, eventSink=合成事件汇 */ }
  
  // 完整 WAL：Phase 0 → 1 → 2 → 3
  async execute({ documentId, eventIds, expectedRevision, changeSet, opId }) { /* ... */ }
  
  // 恢复重放：从检查点重建操作
  async replay(opId) { /* ... */ }
  
  // 对账：启动时按 opId 检查缺终态的操作
  async reconcile() { /* ... */ }
}
```

**必须实现**（按协议 §2.2 状态机）：

### Phase 0（构造与校验）
- 读取现有文档，构造候选文档
- 校验 documentId/eventIds/expectedRevision/固定结构/保护区
- 生成 candidateRevision、opId、operationDigest、完整 changeSet
- **可预期失败：返回错误，文档 +0、事件 +0**

### Phase 1（prepared）
- 对 eventIds 逐个追加 prepared 检查点
- `checkpoint.opId = 业务 opId`；**存储层操作键 = opId + ':prepared'**
- **任一失败：停止，绝不写文档**；报告逐事件 prepared 状态

### Phase 2（文档写入）
- 重新取得文档锁（用 locked-store）
- 重读并复核 expectedRevision
- 原子写候选文档，读回并复核 candidateRevision
- 冲突返回 conflict；意外异常进入 Phase 3

### Phase 3（committed/failed）
- 文档成功后逐事件追加 committed（**存储层操作键 = opId + ':committed'**）
- 文档意外失败则追加 failed（**存储层操作键 = opId + ':failed'**）
- failed 引用 preparedCheckpointId，记录实际残留 revision 和错误码

## 2.2 关键约束（协议明确）

1. **同一业务 opId 不能直接作为同一事件多次 append 的存储操作键**——否则现有 eventStorePre.append() 的重放早退会把 committed 吞掉（lib/event-store.js:915-969）
2. **appliedOps 扩展**：现有只存时间戳且容量 500（event-store.js:370-420）⇒ R4 须扩展为同时保存 operationDigest，并能在台账淘汰后从带 opId 的检查点恢复重放证据
3. **旧数字型台账记录**遇到新 R4 重放时返回 `op-payload-unverifiable`，不得默认同载荷
4. **多事件写入不是原子事务**：提供可审计的部分成功和补偿，不承诺分布式原子性

## 2.3 合成事件汇

新建 `artifacts/_r4-p3-fixtures/event-sink.js`（**合成，不接生产 event-store**）：

- 模拟事件 append（支持 prepared/committed/failed 三种阶段）
- 模拟 opId 重放早退（同 opId+同阶段+同载荷 ⇒ 去重；同 opId+不同载荷 ⇒ `op-payload-mismatch`）
- 模拟 checkpointId 生成（`ckpt_<16hex>`，事件内唯一）
- 模拟故障注入（指定某次 append 失败）

---

# 三、测试要求

新建 `tests/smoke/smoke-test-r4-wal.mjs`，**真执行 + 负路径 + 变异验证**：

## 3.1 正常路径

| 用例 | 断言 |
|---|---|
| 单事件正常 WAL | Phase 0→1→2→3 全过；文档更新；每事件一条 prepared+一条 committed |
| 多事件正常 WAL | 每事件独立 prepared/committed；同一 opId；文档只写一次 |
| 同内容重复 | noop:true；不新增 WAL |

## 3.2 失败矩阵（协议 §2.3 九种）

| 失败点 | 断言 |
|---|---|
| 非法 ID/结构错误/可预期 CAS | 文档不变、事件 +0、明确错误码 |
| 第一个事件 prepared 失败 | 文档不变、可能 0、`aborted-before-document` |
| 多事件 prepared 部分成功 | 文档不变、部分 prepared、逐事件状态可见 |
| Phase 2 CAS 竞争 | 旧版不变、prepared 已有、`document-version-conflict` |
| 原子写异常 | 读回判断旧/新、failed 记录实际 revision、保留 changeSet |
| committed 部分失败 | 目标版已存在、部分 committed、`documentCommitted:true,eventComplete:false` |
| 索引更新失败 | 正文不回滚、committed 不变、`indexStale:true` |
| 缓存刷新失败 | 正文不变、committed 不变、明确 stale |
| 进程被杀 | 由原子写决定旧/新、无半文件、可只剩 prepared |

## 3.3 恢复重放

| 用例 | 断言 |
|---|---|
| prepared 可重建目标 | 从 changeSet 重放得到逐字节等价目标文档 |
| 缺终态且磁盘为目标 | 启动时按 opId 对账补 committed |
| 同 opId/phase 重放 | 不重复产生检查点 |
| 同 opId 不同载荷 | `op-payload-mismatch`（不得静默去重）|
| 旧数字型台账 | `op-payload-unverifiable` |

## 3.4 变异验证（隔离副本）

| 变异 | 必须红 |
|---|---|
| 去掉 prepared 阶段 | 恢复重放用例红 |
| 去掉 committed 阶段 | 对账补 committed 用例红 |
| 同 opId 不区分阶段 | committed 被吞掉用例红 |
| 去掉 operationDigest 校验 | 同 opId 异载荷用例红 |

---

# 四、交付要求

1. **新模块**：`lib/ledger-doc/wal.js`
2. **合成事件汇**：`artifacts/_r4-p3-fixtures/event-sink.js`
3. **测试**：`tests/smoke/smoke-test-r4-wal.mjs`（真执行 + 失败矩阵 + 恢复重放 + 变异）
4. **报告**：`docs/internal/R4-P3-RESULT-20261111.md`（含实测 PASS/FAIL、变异 CAUGHT/MISSED、字节数）

---

# 五、硬纪律

1. **不改既有生产文件**：lib/index.js、lib/event-write.js、lib/event-store.js、lib/shared-state-lock.js 等一律不碰
2. **不改已有 R4 模块**：protocol.js/document-store.js/locked-store.js/coverage-audit.js/material-stamp.js/history-query.js（除非明确扩展且不改既有行为）
3. **不碰真实数据**：合成事件汇，不接生产 event-store
4. **真执行**：真 import→真构造→真调用→断言返回值；禁止「源码含某字符串」当验收
5. **负路径**：每个「必须拒绝」配反向对照「必须成功」
6. **变异验证**：在隔离副本里做（复制到 artifacts/_r4-p3-mutation/ 再改），断言必须变红、还原复绿
7. **本机坑**：os.tmpdir() 返回 undefined\\temp（相对路径陷阱），临时文件放工作区内
8. **不跑全仓回归**（用户裁定「先不用回归，太耗时间」）

完成后用 send_message 把结果发给 Lead（目标：lead）。