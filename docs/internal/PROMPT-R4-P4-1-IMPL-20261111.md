# 【任务】R4 P4-1：后端六个读侧接线（默认关闭、双读）

你是实现 Agent，工作目录 D:/dsh-auto-memory。用户已同意开始 P4-1。

## 0. 权威与基线

- 先读 docs/internal/PROTOCOL-R4-20261110.md §5、§9.2 P4、§9.4；docs/internal/LEDGER-DOC-API-CONTRACT.md。
- 基线 HEAD 2f4ab63c。P4-0 已有真实 EventStoreLedgerSink 与默认关闭 createLedgerDocSystemPre。
- 只改 lib/index.js 与 lib/ledger-doc/ 新模块；不改 lib/event-store.js、lib/event-write.js、lib/client.js、skins/。
- lib/index.js >500 行且 CRLF：只内容锚定 edit，禁止整文件 write；收工报行/字节/导出/行尾/diff。
- 不跑全仓回归；真 import→构造→调用→断言；负路径+隔离变异；不碰真实记忆、不迁移删除。

## 1. 先在门面内实现只读选择器

新增 lib/ledger-doc/read-side.js（或合适的新模块），由 LedgerDocSystem 暴露统一只读入口，不绕门面直接散落调用：

- 枚举 handoff/documents/ 合法文档；按 protocol 校验 documentId；fileWithinRoots 校验物理路径，symlink/junction 越界拒绝。
- 逐文档从磁盘正文重算 revision，不信任缓存/manifest；读取失败与无文档分开返回，readErrors 显式。
- 提供选择当前维护文档的确定性规则：优先显式 documentId/eventIds 绑定，其次明确的当前维护清单；禁止最近 active 事件兜底；多文档且无绑定时返回明确选择需求，不得猜。
- 文档按 documentId+sectionId+revision 形成只读 chunk；正文改变后 chunk identity 必变。
- 兼容既有文档正文（含四段/相关文档固定节），不新造 RAG 平行状态。

## 2. 六项生产读侧最小接线

### ① 动态注入 + ② 跨工作区接续

- `_doRefresh`：R4 启用且存在当前维护文档时，state.latestHandoffText 取它；同进程 committed 后立即更新，跨进程刷新后读到新 revision。
- `buildContinueCarry`：沿源会话 resolvePathsForSession；维护文档来自源工作区并携带 documentId/revision；不得回落到其他工作区。
- `handoffMaterialStamp`：R4 启用时接 HandoffMaterialStamp/readStamp，含 documents 内容 revision、旧账本、PLAN、事件与 readErrors；同名同 mtime 内容更新必须改指纹。

### ③ scope=all + ④ scope=handoff + ⑤ 语义检索

- `searchHandoffCorpus` 和 recall 的 all/handoff 都纳入维护文档；同一正文最多一份，不重复挤占 limit；无命中与读失败分开。
- L0/full 均可下钻：结果必须带可解析的文档身份/路径/revision/节标识，并可通过明确下钻入口读当前内容。
- 语义臂按 documentId+sectionId+revision 入 chunk；改内容后旧 chunk 失效；内联事件构造与 lib/event-recall.js 如需同型修复必须同批，不许半修。

### ⑥ 事件下钻/相关文档

- `expandEventRecordPre` 能从事件定位关联维护文档并读取当前 revision；无关联时如实返回，不猜最近文档。
- 路径不是只能复制的死信息：提供明确的只读下钻返回，含 documentId/revision/当前内容。

## 3. 开关与回滚

- 增加一个明确的后端开关（如 config.ledgerDocEnabled），默认 false；同时遵守 handoffEnabled。
- 默认行为逐字节不变；R4 开启后才是新行为。
- 关闭新读路径即恢复 legacy 双读；不删除文档、不接管唯一接续来源。
- 本批不改旧提示词（它约束的是默认旧写路径）；在实际启用 R4 写入/接续前再与 P5 同批改。

## 4. 验收

新增 tests/smoke/smoke-test-r4-read-side.mjs（或按项拆分），至少真执行覆盖：

1. 同文档同 mtime 更新后指纹变化；无修改指纹不变；跨工作区 A 改 B 不变；读失败进入 readErrors。
2. 动态注入与 carry 取到当前 revision；源会话路径隔离；committed 失效通知刷新。
3. scope=all/handoff 唯一标记词命中；同一正文最多一份；L0/full 下钻内容一致；读失败不冒充未命中。
4. 语义 chunk 在 revision 改变后 identity 必变；不得同时返回新旧 chunk。
5. 事件下钻只读关联文档当前 revision；无绑定不猜；越界 symlink/非法 ID 全拒。
6. 默认关闭行为与基线相同；关闭后旧读路径恢复；新增文件 LF 无混用。
7. 隔离变异：去掉 revision 身份、去掉工作区绑定、去掉失效通知三类均必须红、还原复绿。

必须真跑：新套件、tests/smoke/smoke-test-r4-event-store-sink.mjs、既有七套 R4、受影响既有检索/接续/注入套件（先全仓 grep 找真实套件名并运行）。写 docs/internal/R4-P4-1-RESULT-20261111.md，含每项实测计数与未做边界。

## 5. 边界

本批不做面板、iter5、外部变更简报、存量归并扫描、团队基线（后续 P4-2/P4-3/P4-4）；不做真实宿主端到端、不跑全仓、不迁移删除。

完成后 send_message 给 lead，等待 Lead 复核提交。