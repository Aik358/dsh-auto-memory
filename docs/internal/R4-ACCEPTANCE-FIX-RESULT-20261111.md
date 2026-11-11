# R4 验收后修复结果 · 2026-11-11

## 范围与结论

完成 D-C3-1、D-C3-2、C1 观测面、E-C1-1/OBS-1。默认 `ledgerDocEnabled:false` 与 legacy 双读保持不变；未接管生产写入、未迁移/删除、未做 P4-2/P4-3、面板/简报或全仓回归。

开工实际 HEAD 为 `48cd2888f3d3d8142b08b945af0ea20b36599cea`（任务书所述 5fd3d9a3 之后已有合入）；当时无已跟踪未提交修改。Lead 已独立复核本批实现与证据。

> Lead 追加独立复核：实际启动另一隔离宿主（端口 **19428**），真实执行探针 16/16 PASS。探针 evidence.json 内的 `port:19427` 为脚本硬编码元数据，实际请求地址由启动日志动态解析；不影响断言。Node 受影响套件均已由 Lead 真跑复核。无真实模型轮次。

## 逐项修复

### D-C3-1：scope=all 同一 chunk 正文只返回一份

- handoff 命中改为稳定 chunk 级投影，携带 `chunkId=documentId+sectionId+revision`、documentId、revision、sourcePath、行列范围。
- recall 返回层使用请求内 `seenR4Chunks` 对 full、handoff、L0 三处去重；不按标题或路径粗删，不合并不同 section/revision。
- full 初始命中只在 full 模式登记；L0 的 handoff 命中保留下钻 ID，避免「去重后丢掉 L0/full 下钻」。readErrors 保持独立。
- scope=handoff 同步填充既有结构化 hits，不增加 events/sessions。

### D-C3-2：HTTP handoff 入口

- 现有 `/api/dsh-auto-memory/recall` 白名单最小增加 handoff，实际调用 `engine.recall(...,scope='handoff')`。
- current/all/archive 行为不变；缺 sessionId、未知工作区、events、sessions 和非法 scope 仍拒绝。
- 未新增路由，路由数仍 86；配置键仍 180。

### C1：只读注入装配观测面

- `snapshot()` 与 `handoffPanelData()` 增加 `latestHandoffTextTier`、`ledgerDocId`、`ledgerDocRevision`、`latestHandoffTextChars`。
- tier 只取 maintenance-document / legacy / empty；不返回整篇维护文档或其它无关记忆正文。字段均投影现有 state，不新增第二真源。
- `/handoff-state` 使用既有 withAgent 将 refresh 与渲染置于同一 runtime；committed 同时更新 documentId/revision，默认关闭/回退清理旧身份。
- 证据只说明「选定内容进入注入装配观测面」。没有真实模型轮次，不声称模型已消费。

### E-C1-1/OBS-1：readOnly 与真实根解耦

- `createLedgerDocSystemPre` 仅在 enabled 且非 readOnly 时构造真实 EventStoreLedgerSink。
- readOnly 可读取非 artifacts 的真实绝对 root/handoff，不要求 sink 路径或父目录；start 不创建 documents/logs/archive/legacy/coverage-reports，不做 WAL reconcile、不预热 stamp。
- readOnly document-store 的 create/update 返回 `document-read-only`；document/readStamp/history 以各自物理根为边界，auditCoverage 返回 `audit-read-only`。
- 显式写入仍构造真实 sink+WAL。sink 要求 storePath 为 `<cwd>/artifacts` 下的绝对路径，并在构造内创建校验后的隔离父目录；生产写入根约束未放宽。
- API 契约已补 readOnly 生命周期、sink 构造/目录前提、chunk 去重、HTTP handoff 和观测字段。

## 真执行证据

### 新验收套件

`tests/smoke/smoke-test-r4-acceptance-fix.mjs`：

- clean probe **51 项检查通过**，包括真实 apply、真实 MemoryEngine、真实 HTTP handler、state snapshot、真实 WAL committed、跨进程更新、非 artifacts 的 readOnly current/readChunk/forEvent/document/readStamp、缺失 sink 父目录、默认关闭 legacy 对照。
- 父套件 **SUMMARY PASS 5 / FAIL 0**。
- 隔离副本变异：去重失效、HTTP handoff 缺失、观测字段缺失、readOnly 构造 sink，全部 **4 CAUGHT / 0 MISSED**。
- 变异位于 `artifacts/_r4-acceptance-fix-mutations/`，共享 lib 未就地变异。audit adapter 仅增加真实 createLedgerDocSystemPre 导出，保证变异与 engine 使用同一 index 源。

### 独立真实宿主

使用独立 `artifacts/_r4-acceptance-host/home`、独立 profile、真实 link 到工作树、端口 19427、合成 session 和合成 memoryRoot；未使用共享隔离 home，未重启/修改生产 19387。

`artifacts/_r4-acceptance-host/evidence.json` 实测 **16 项 PASS**：

- /handoff-state 与 /state 均返回 maintenance-document tier、documentId 和当前 revision，响应不含维护文档正文。
- HTTP scope=all 唯一标记正文恰 1 次；HTTP handoff 唯一标记恰 1 次且带当前 revision。
- 缺 sessionId、未知工作区、events、sessions 均拒绝。
- 跨进程文档更新后，/handoff-state 指向新 revision。
- `modelTurnObserved:false` 明确保留；未做真实模型轮次。

宿主与浏览器标签均已关闭；生产配置/生产记忆未接管。

## 影响面回归

| 套件 | 实测 |
|---|---|
| smoke-test-r4-acceptance-fix.mjs | 5/0，4 变异 CAUGHT；clean 51 检查 |
| smoke-test-r4-read-side.mjs | 26/0 |
| smoke-test-r4-event-store-sink.mjs | 14/0，含旧 checkpoint/旧数字台账兼容 |
| smoke-test-r4-ledger-doc.mjs | 43/0 |
| smoke-test-r4-ledger-lock.mjs | 15/0 |
| smoke-test-r4-material-stamp.mjs | 24/0 |
| smoke-test-r4-history-query.mjs | 23/0 |
| smoke-test-r4-coverage-audit.mjs | 41/0 |
| smoke-test-r4-wal.mjs | 25/0 |
| smoke-test-r4-system.mjs | 20/0 |
| smoke-test-v4-event-store.mjs | 96/0 |
| smoke-test-v4-d-events-recall.mjs | exit 0 |
| smoke-test-v4-c3-event-percept-recall.mjs | exit 0 |
| smoke-test-p4-l0-response.mjs | 34/0 |
| smoke-test-three-layer.mjs | 131/0 |
| smoke-test-p2-semantic-recall.mjs | 2/0 |
| smoke-test-continuation-transaction.mjs | exit 0 |
| smoke-test-v3314-continuation-timeout.mjs | 32/0 |
| smoke-test-v4-e-continuation.mjs | exit 0 |
| smoke-test-inject-frame-fidelity.mjs | 19/0 |
| smoke-test-v5-p1-inject-throttle.mjs | 32/0 |
| smoke-test-c5-tier-inject.mjs | 90/0 |
| smoke-test-recall-stats.mjs | exit 0 |
| smoke-test-conflict-recall-reminder.mjs | 11/0 |
| smoke-test-l0-extract.mjs | 26/0 |
| smoke-test-r26-cross-layer.mjs | 26/0 |
| tools/verify-docs.mjs | PASS；22 tools / 86 routes / 180 config keys |

以上均为指定影响套件，不是全仓回归。

## 物理量与判据

- `lib/index.js` 基线 **29,377 行 / 2,129,192 B / 41 exports**；最终 **29,408 行 / 2,131,442 B / 41 exports**，SHA-256 `3b1db0bdaebf1ec616946314bb582154d2c33e8511772ff1ab6eded622227b17`。
- index 行尾保持 **29,407 CRLF / 0 裸 LF**。新/改 ledger-doc 模块与测试保持 LF，未引入 CRLF+裸 LF 混用。
- r26 使用自身 `readFileSync(...).replace(/\r\n/g,'\n')` 管道复算：IX **1,583,258**，sha16 **CDB46E9D8590DAD5**，锁已重钉，26/0。
- 最终 tracked diff（不含新报告与新套件）：**8 files，+94/−35**；新增独立套件 `smoke-test-r4-acceptance-fix.mjs` **215 行 / 16,597 B**。
- 其它主要文件：system.js 184 行/8,408 B；document-store.js 271 行/13,809 B；material-stamp.js 342 行/15,887 B；history-query.js 299 行/17,212 B。
- 既有无关 untracked artifacts/tools 文件未清理、未纳入本批。

## 未验证与禁止扩张

- 没有真实模型轮次，故没有「模型已消费注入帧」证据；C1 仅证明观测面反映当前装配源。
- 未进行生产宿主开启、生产写入接管、真实数据迁移/恢复演练、物理删除或全仓回归。
- P4-2/P4-3、面板、简报不在本批。
- 请 Lead 复核完整 diff、真实宿主证据、变异和回归后统一提交。
