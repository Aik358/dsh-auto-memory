# 【任务】R4 验收后修复：读侧去重 + 观测/入口 + 只读装配解耦

你是实现 Agent，工作目录 D:/dsh-auto-memory。用户已同意按裁定实施。

## 0. 基线与范围

- 基线 HEAD 5fd3d9a3；验收报告 docs/internal/R4-HOST-VERIFY-RESULT-20261111.md（26 PASS/2 PARTIAL，不是全绿）。
- 先读 PROTOCOL-R4-20261110.md §2、§5、§9.2A，LEDGER-DOC-API-CONTRACT.md 和验收报告 §9.2/附录 F。
- 本批只做 D-C3-1、D-C3-2、C1 观测面、E-C1-1/OBS-1；不做 P4-2/P4-3，不接管生产写入、不迁移/删除、不跑全仓回归。
- 保持默认 `ledgerDocEnabled:false` 与 legacy 双读；不改 event-store 写语义、不改团队基线。

## 1. D-C3-1：scope=all 同一正文只能一份

- 当前根因已核实：searchHandoffCorpus 的维护文档臂与 L0 臂都返回同一正文。
- 在统一读侧选择器/返回层按稳定 chunkId（documentId+sectionId+revision）去重；不得只按标题或路径粗删。
- 保留 L0/full 下钻、legacy 双读、readErrors；同 revision 同 section 只返回一次，不同 revision 不得混为同一内容。
- 验证维护文档正文出现次数恰 1；legacy 对照不变；同一文档多个不同 section 的正常检索不能误删。

## 2. D-C3-2：HTTP /recall 的 handoff 入口

- 在现有白名单最小增加 `handoff`；真实走 engine.recall(..., scope='handoff')；现有 current/all/archive 行为不变。
- 不顺便扩展 events/sessions（它们有各自路由，不属本缺陷）。
- 验证合法 handoff 返回 200 且唯一标记词命中、当前 revision 可读；缺 sessionId/未知工作区/非法 scope 仍拒绝；默认关闭时行为不变。

## 3. C1：补真实注入帧观测面

- 在现有合适的只读观测接口（优先 /state 或既有观测结构）暴露**明确标为 latestHandoffText 当前档位的字段**及 documentId/revision；不新增第二真源、不改渲染规则。
- 不得在响应里混入整篇维护文档正文或无关记忆正文；按当前已选文档的档位返回，保持默认关闭行为。
- 验证真实宿主配置开启后，观测字段反映当前维护文档档位；同进程 committed 与跨进程写入刷新后都指当前 revision。
- 如实说明：这证明的是「选定内容进入注入装配观测面」，没有真实模型轮次就仍不能声称模型已消费。

## 4. E-C1-1/OBS-1：只读装配解耦

- readOnly 的 LedgerDocSystem 不应构造 EventStoreLedgerSink；只读构造不要求可写 sink 路径，不要求 sink 父目录已存在。
- readOnly 生命周期不创建文档/日志/archive/legacy/report 目录，不做 WAL reconcile；只读 current/readChunk/forEvent 仍可用。
- 显式启用写入时仍构造真实 sink，并在 sink 构造函数内确保隔离父目录存在；不得把生产记忆根约束放松。
- 契约文档补明 sink 的构造/目录前提；默认关闭行为、旧检查点兼容、只读构造与真实 sink+WAL 分别真执行。

## 5. 验收与交付

- 修改 tests/smoke/smoke-test-r4-read-side.mjs、smoke-test-r4-system.mjs 或新增独立修复套件；全部真 import/构造/调用/真实副作用。
- 每个负路径配正向对照；隔离副本变异至少覆盖：去重失效、HTTP handoff 入口缺失、观测字段缺失、readOnly 构造 sink。变异必须红、还原复绿。
- 真跑新/改套件、八套 R4、v4-event-store、r26、既有 scope/接续/注入/检索套件与 verify-docs；报告真实文件名，不得引用不存在的套件。
- lib/index.js >500 行 CRLF，仅内容锚定 edit；收工报行/字节/导出/行尾/diff，r26 用自身管道重钉。配置数与路由数按实测同步，禁止估算。
- 交付 docs/internal/R4-ACCEPTANCE-FIX-RESULT-20261111.md：逐项修复、证据、变异、回归和未验证边界。
- 不提交；交付后 send_message 给 lead，由 Lead 复核并提交。