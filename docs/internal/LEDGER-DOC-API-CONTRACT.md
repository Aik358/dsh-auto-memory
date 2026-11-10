# Ledger Doc API Contract

版本：r4-ledger-doc-api-v1（2026-11-11）

## 1. 范围与导入

本契约覆盖 `lib/ledger-doc/` 的七个功能模块及 R4-M 的系统门面。统一导入：

```js
import {
  LedgerDocSystem,
  LedgerDocumentStore, LockedLedgerDocumentStore,
  HandoffMaterialStamp, MaterialInvalidationBus,
  LedgerHistoryQuery, LedgerCoverageAuditor, LedgerWal,
} from './lib/ledger-doc/index.js'
```

入口同时导出 protocol.js 的协议常量/纯函数、material-stamp.js 的两个 schema 常量、coverage-audit.js 的常量/纯函数、history-query.js 的查询/时间解析/错误类型和 system.js。没有生产注册表或默认全局实例。

R4-M 只组织既有模块，不改变字段、WAL 状态机、存储原子性或物理删除边界。除下面明确指出的调用方式外，不把 new、订阅、通知或纯函数包装成另一种返回类型。

## 2. 统一约定

### 2.1 返回形状

- 执行 I/O、查询、状态转换的方法以 `{ok:boolean,...}` 表示完成或失败；保留各模块的领域字段，不另加平行的 `result/error` 容器。
- `ok:true` 只表示本次 API 合约已完成，不自动等于全部业务门通过。例如 stamp 的 `complete:false`、审计报告中的 `errors`、历史查询的 `readErrors` 必须继续检查。
- `ok:false` 时通常有 `error` 字符串及可选 `cause`、阶段或部分成功字段。不得把部分成功折叠成全无。
- 低层模块保留既有例外：MaterialInvalidationBus 的同步通知/订阅没有 `ok`；`readStamp()` 返回字符串；`auditFile()` 返回 `{reportPath,reportBytes,readbackBytes,report}`，顶层没有 `ok`；纯函数返回计算值。
- 参数错误、适配器错误和低层校验失败可用 `TypeError` 或 `HistoryQueryError` 拒绝，不强制转成成功形状的失败。调用方不得假设所有错误都返回对象。
- Promise 只表示异步执行完成，不表示 `ok:true`。每个 facade 命令均须同时 await 并检查 `ok`。
- start 返回 `complete:false` 时仍可 `started:true`：对账发现的已被后续 committed 取代的旧版本会保留 attention 信号，但正常历史演进不等于启动失败。只有未决恢复或 stamp readErrors 才使 `ok:false`；原始 reconciliation 与 stamp 结果必须保留供调用方检查。

### 2.2 空值与幂等

- `noop:true` 是 `ok:true` 的一种：当前内容/关联已满足意图，没有新增文档字节、WAL 检查点或 committed 通知。它不是失败，也不等于 `ok:false`。
- `null` 表示明确不存在、不可用、尚未持久化或尚未配置。旧 checkpoint 没有持久化 ID 时 `checkpointId:null`，使用 `identityMode:'legacy-derived'` 和 `legacyCheckpointKey`，不得伪造 checkpointId。
- `undefined` 仅表示 JS 入参缺省或未提供可选字段；面向调用方的结构化结果对重要缺失字段使用 `null`。`auditFile` 等持久化报告遵循原 schema。
- `readErrors:[]` 表示无读取错误，不是无记录。`coveredSources` 中的 missing/empty/error/read 分开表达。

### 2.3 异步、同步与副作用

- 文件 I/O、锁、WAL、stamp 读取、历史查询、审计、系统 start/stop/reconcile 及 facade 命令全部 async。
- 协议校验/规范化/摘要、审计文本解析、失效总线、时间解析和对象构造可同步；构造不发起网络或生产写入。
- `create/update/upsert` 可能写文档；WAL 还追加合成或注入事件汇；`auditCoverage` 写隔离报告；系统 start 仅创建隔离目录、对账与预热，不修改生产文件。
- 读取文档、历史查询和 stamp.read 不写目标正文。审计读源并写报告，不能误称纯只读。
- committed 通知只在实际 committed 文档后发送；通知 listener 的异常进入 `listenerErrors`，不能静默声称全部刷新成功。
- 锁由 LockedLedgerDocumentStore 的各操作作用域管理；系统 stop 等待本 facade 跟踪的调用，不持有全局文件锁或后台进程。

### 2.4 错误与错误码

统一失败字段为 `error`（kebab-case），底层异常为 `error.code` 或 `code`。结构化 readErrors 保留各自来源的 code（包括已有大写错误码），不将其重写为另一套协议。

| 分类 | 稳定代码 |
|---|---|
| 身份与关联 | `document-id-invalid`、`event-ids-required`、`event-id-unavailable`、`event-ids-conflict`、`checkpoint-id-invalid`、`checkpoint-id-conflict`、`op-id-invalid` |
| 文档版本与内容 | `document-already-exists`、`document-not-found`、`document-version-conflict`、`document-revision-mismatch`、`document-format-invalid`、`document-title-invalid`、`document-content-invalid`、`document-clock-invalid`、`revision-invalid` |
| 文件与读回 | `document-root-invalid`、`document-read-failed`、`document-write-failed`、`document-readback-failed`、`index-path-invalid`、`index-write-failed`、`cache-refresh-failed` |
| 变更集 | `changeset-invalid`、`changeset-base-mismatch`、`candidate-revision-mismatch` |
| 锁 | `locked-store-requires-ledger-store`、`lock-adapter-invalid`、`lock-unavailable`、`lock-nesting-forbidden` |
| WAL 与事件 | `wal-store-invalid`、`wal-event-sink-invalid`、`wal-prepared-invalid`、`wal-prepared-missing`、`wal-operation-failed`、`wal-committed-document-mismatch`、`op-payload-mismatch`、`op-payload-unverifiable`、`event-append-failed`、`event-prepare-failed`、`event-commit-failed`、`aborted-before-document` |
| 历史查询 | `history-root-invalid`、`history-time-required`、`history-timezone-required`、`history-time-invalid`、`history-timezone-invalid`、`history-range-invalid`、`history-range-too-large`、`history-event-id-invalid`、`history-kinds-invalid`、`history-include-quad-invalid`、`history-limit-invalid`、`history-cursor-invalid` |
| Stamp/通知 | `r4-material-stamp-disabled`、`handoff-root-invalid`、`material-path-invalid`、`invalidation-bus-invalid`、`invalidation-listener-invalid`、`committed-write-required`；readErrors 另保留 MATERIAL_* 与文件系统 code |
| 审计 | `audit-path-invalid`、`audit-root-invalid`、`audit-report-root-invalid`、`audit-event-store-invalid`、`audit-event-store-schema-invalid`、`audit-source-name-invalid`、`audit-source-invalid`、`audit-report-path-invalid`、`audit-input-list-invalid`；报告内含 source-*/event-store-*/report-* 错误 |
| 系统门面 | `ledger-doc-root-invalid`、`ledger-doc-enabled-invalid`、`ledger-doc-system-disabled`、`ledger-doc-system-not-started`、`ledger-doc-start-failed`、`ledger-doc-start-incomplete`、`wal-not-configured` |

## 3. protocol.js：常量与纯函数

导出 PROTOCOL_VERSION、DOCUMENT_MARKER、DOCUMENT_ID_RE、EVENT_ID_RE、OP_ID_RE、CHECKPOINT_ID_RE、REVISION_RE。以下函数同步、无文件副作用；校验返回 `{ok:true,value}` 或 `{ok:false,error}`。

| 导出 | 约定 |
|---|---|
| validateDocumentId(id) | 校验稳定文档 ID；非法路径/格式为 document-id-invalid。 |
| validateEventIds(ids) | 去空、去重、排序并校验事件 ID；store 另行核对存在与状态。 |
| validateOpId(opId) | 校验 `r4op_<32hex>`。 |
| validateCheckpointId(id) | 校验 `ckpt_<16hex>`，不为旧 checkpoint 生成新 ID。 |
| validateRevision(revision) | 校验 `sha256:<64hex>`。 |
| validateChangeSet(changeSet) | 校验区域 ID、beforeText/afterText 与重复区域。 |
| normalizeText(text) | 去开头 BOM、CRLF/CR 转 LF、去行尾空白；非字符串 TypeError。 |
| canonicalize(value) | 递归键序确定的 JSON canonical 字符串；拒绝循环/非 JSON 值。 |
| computeRevision(docText) | 只置空固定 revision 元数据行后计算 SHA-256。 |
| computeOperationDigest(payload) | canonical 内容的 `sha256:<64hex>` 摘要。 |
| computeLegacyCheckpointKey(cp) | 对既有快照字段计算 legacy 派生身份，不是持久化 checkpointId。 |

## 4. 文档与锁

### LedgerDocumentStore(rootDir, options)

| 方法 | 返回与副作用 |
|---|---|
| createDocument({documentId,title,eventIds,eventId,content}) | async；原子首建，返回 ok/documentId/revision/text/noop:false；已存在不覆盖。 |
| updateDocument({documentId,expectedRevision,eventIds,eventId,changeSet}) | async；CAS 后原子更新，成功 noop:false；相同语义 noop:true；返回文档形状。 |
| readDocument(documentId) | async；读取并校验 ID、结构、revision；不写盘。 |
| listDocuments() | async；`{ok,documents,readErrors}`，按 updatedAt 倒序，正文不在 summary 返回。 |

### LockedLedgerDocumentStore(store, options)

| 方法 | 返回与副作用 |
|---|---|
| withDocumentLock(documentId,job,options) | async；同文档临界区内执行 job；禁止嵌套资源锁。 |
| withIndexLock(indexPath,job,options) | async；索引临界区执行 job；不与文档/事件锁叠加。 |
| createDocument(input,options) | async；文档锁内转调底层 createDocument，返回原形状。 |
| updateDocument(input,options) | async；文档锁内转调底层 updateDocument，返回原形状。 |
| readDocument(documentId,options) | async；文档锁内转调底层 readDocument。 |
| listDocuments() | async；直接读取底层列表，不持锁。 |
| runOperation({documentId,expectedRevision,changeSet,eventIds,prepareEvents,commitEvents,reindex},options) | async；按 D-read→E-prepared→D-write→E-committed→I-reindex 调用注入适配器，返回资源状态与部分成功。 |

## 5. 指纹与失效

### HandoffMaterialStamp(options)

| 方法 | 返回与副作用 |
|---|---|
| read() | async；disabled 时 `{ok:false,enabled:false,error:'r4-material-stamp-disabled',stamp:'',material:null}`；启用时从正文重算 revision，返回 `{ok:true,enabled:true,complete,stamp,material,invalidationVersion}`。readErrors 使 complete:false。 |
| readStamp() | async；返回 read().stamp 字符串，包括 disabled 时的 ''。 |

### MaterialInvalidationBus（同步、进程内）

| 方法 | 返回与副作用 |
|---|---|
| key(handoffDir) | 返回规范化 key；不读盘。 |
| version(handoffDir) | 返回当前版本数字。 |
| subscribe(handoffDir,listener) | 注册监听；返回 unsubscribe 函数。 |
| publishCommitted({handoffDir,documentId,revision,opId}) | 同步递增版本、调用监听；返回通知（schema/epoch/sequence/revision/committed/listenerErrors），无 ok 字段。 |

`publishCommittedDocument(bus,handoffDir,writeResult)` 同步要求 writeResult.ok:true 且 noop:false，返回 publishCommitted 的通知；两个 schema 常量 MATERIAL_STAMP_SCHEMA、MATERIAL_INVALIDATION_SCHEMA 由统一入口导出。

## 6. 历史查询

### LedgerHistoryQuery(options)

`query({from,to,eventId,kinds,cursor,limit,includeQuad})` async 返回 `{ok,range,items,total,count,coveredSources,readErrors,truncated,nextCursor}`。写文件副作用为零；仅读取事件、日志与 archive。includeQuad:true 返回持久化四段，不返回渲染截断版；日志无四段为 null。

`queryHistory(options,filter)` 是同实现 async 便捷入口。`parseHistoryTime(value,timeZone='UTC')` 同步返回 epoch 毫秒；日期按显式 IANA 时区解析，无时区日期时间拒绝。`HistoryQueryError` 含 code。

## 7. 覆盖审计

### LedgerCoverageAuditor(options)

| 方法 | 返回与副作用 |
|---|---|
| auditFile(relPath,prepared=null) | async；读取单篇源并原子写报告，返回 `{reportPath,reportBytes,readbackBytes,report}`；顶层无 ok，检查 report.errors/gates。 |
| auditAll({relPaths=null}) | async；逐源写报告并写 summary，返回 `{ok,summaryPath,summary,reports}`；ok 仅表示批次持久化通过，不表示 eligibleForPhysicalDelete。 |

常量 COVERAGE_REPORT_SCHEMA、COVERAGE_SUMMARY_SCHEMA、AUDIT_RULES_VERSION、NORMALIZATION_ALGORITHM、STRICT_LEDGER_NAME、QUAD_FIELDS 同步可导入。normalizeLedgerForAudit(text) 同步返回规范化文本与计数/SHA；parseLedgerForAudit(text) 同步返回四段、区域摘要、事件声明；均不写盘。

## 8. WAL

### LedgerWal(store,eventSink,options)

| 方法 | 返回与副作用 |
|---|---|
| execute(input,options) | async；执行 Phase 0→3，返回 ok/phase/operation/prepared/committed/events/document 与适用的失败部分；追加注入事件汇，可能写文档。 |
| replay(opId,options) | async；从 prepared/检查点恢复或幂等去重；返回 replayed/noop/documentCommitted/eventComplete 等。 |
| reconcile(options) | async；逐 op replay，返回 `{ok,count,recovered,attention,results}`。 |

`execute` 当前面向已存在文档的更新，需要 expectedRevision/opId/changeSet/eventIds；它不凭空伪造首建 WAL。首建使用 documents.createDocument 的显式入口。

## 9. LedgerDocSystem

### 配置与目录

`new LedgerDocSystem({rootDir,enabled=false,...config})` 同步构造。rootDir 必须是当前工作区 artifacts 下的绝对隔离目录；enabled 必须为 boolean。没有默认 eventSink，也不导入生产 event-store。

默认目录：handoff/documents、handoff/event-store.json、logs、archive、legacy、coverage-reports，均位于 rootDir。可配置 useLocks、stampEnabled、timeZone、workspaceKey、now、fs、invalidation 和 eventSink。eventSink 实现 append/listCheckpoints/operations 才支持 WAL 与对账。

| 成员/方法 | 返回与副作用 |
|---|---|
| documents/stamp/history/audit/wal getters | 同步返回 LockedLedgerDocumentStore（useLocks:false 时为 LedgerDocumentStore）、HandoffMaterialStamp、LedgerHistoryQuery、LedgerCoverageAuditor、LedgerWal/null。 |
| invalidation | 同步返回本实例 MaterialInvalidationBus。 |
| started getter/status() | 同步返回生命周期状态或 `{ok,enabled,state,started,rootDir,modules}`；不读盘。 |
| start() | async；enabled:false 返回 `{ok:true,enabled:false,started:false,state:'disabled',noop:true}`，不建目录。启用时创建隔离目录、对账并预热 stamp，返回 `{ok,enabled,started,state,reconciliation,stamp}`；失败返回 ok:false。 |
| stop() | async；等待本 facade 跟踪的操作，返回 `{ok:true,enabled,started:false,state:'stopped',stopped:true}`；不写生产文件。 |
| reconcile(options) | async；启用且 started 后转调 wal.reconcile；无 sink 返回 wal-not-configured。 |
| upsertDocument(args) | async；启用且 started 后转调 wal.execute；committed 后发布失效通知，保留 WAL 原始返回形状。 |
| queryHistory(args) | async；启用且 started 后转调 history.query，保留原形状。 |
| auditCoverage(args={}) | async；启用且 started 后转调 audit.auditAll(args)，保留原形状并写隔离报告。 |
| readDocuments(args={}) | async；转调 LedgerDocReadSide.current(args)，按 documentId/eventIds/current manifest 选择当前维护文档，返回 `{ok,selection,document,documents,chunks,readErrors}`。无绑定多文档返回 document-selection-required。 |
| readSide getter | 同步返回 LedgerDocReadSide；list/chunks/readChunk/forEvent 提供只读枚举、按 revision 的 chunk、当前正文下钻和显式事件关联，不猜最近文档。 |

未启用时上述操作返回 `{ok:false,error:'ledger-doc-system-disabled',enabled:false}`；已启用未 start 返回 `{ok:false,error:'ledger-doc-system-not-started',enabled:true}`。getters 只是模块实例访问，不绕过系统生命周期隐式创建、迁移或启动生产功能。
