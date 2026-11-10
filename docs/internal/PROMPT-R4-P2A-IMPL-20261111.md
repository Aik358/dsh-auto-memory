# 【任务】R4 P2A 隔离实现：文档锁 / CAS / 跨进程

你是**实现 Agent**。本任务在**隔离夹具**中实现 R4 的 P2A，**不碰真实生产代码路径**。
工作目录：D:/dsh-auto-memory

---

# 零、授权范围

**允许**：默认开关关闭的隔离实现 + 合成夹具测试。
**禁止**：真实存量迁移、接管唯一接续来源、物理删除、修改现有生产写入路径。

---

# 一、目标

给 ledger-doc 文档存储补上**跨进程互斥与真实负路径**（P1 只有 CAS，无锁）。

---

# 二、必读材料

- docs/internal/PROTOCOL-R4-20261110.md §4（跨进程锁粒度与测试设计）
- lib/shared-state-lock.js（全文，真实锁能力）
- lib/ledger-doc/document-store.js（P1 现有实现）

---

# 三、要实现什么

1. 新建 `lib/ledger-doc/locked-store.js`：包装 LedgerDocumentStore，用 `withSharedStateLock` 覆盖「读→CAS→校验→写→读回」整个临界区
2. **锁名必须与既有写入器一致**：MemoryDocumentStore 传 `filePath+'.lock'`（lib/memory-writer.js:503-521）——新文档若需互斥，最终锁路径必须完全相同
3. **锁顺序**：默认禁止同时持有文档锁/索引锁/事件锁；顺序 D-read→释放→E-prepared→释放→D-CAS/write→释放→E-committed
4. **失败回滚边界**：锁失败不写；文档写失败清理临时文件；索引写失败正文是赢家标 stale；committed 失败正文是赢家保留 prepared；catch 不得吞异常
5. 新建 `tests/smoke/smoke-test-r4-ledger-lock.mjs`：真跨进程（两个 Node 子进程），含：
   · 两进程同文档同 expectedRevision → 至多一个成功，另一个 conflict
   · 两进程不同文档 → 都成功
   · 持锁期间 kill 子进程 → 死主协议恢复，无半截文档
   · 活主持锁 → 竞争者超时且文档不变
   · 锁内写失败 → 无回滚（这是锁的真实边界，必须断言出来）
   · 变异：去掉锁 → 并发丢更新用例必须红

---

# 四、交付要求

1. **新模块**：按上文指定路径
2. **测试**：真执行 + 负路径 + 变异验证
3. **报告**：`docs/internal/R4-P2A-RESULT-20261111.md`（含实测 PASS/FAIL 数、变异 CAUGHT/MISSED、字节数）

---

# 五、硬纪律

【共同前提】
· R4 P0+P1 已完成（commit dfa00e1e）：lib/ledger-doc/protocol.js 与 document-store.js 已存在，43 PASS/0 FAIL、变异 3 CAUGHT。
· 权威协议：docs/internal/PROTOCOL-R4-20261110.md（41,324 B / 580 行）
· 现有模块：lib/ledger-doc/protocol.js（4,739 B）、lib/ledger-doc/document-store.js（13,347 B）
· 既有测试：tests/smoke/smoke-test-r4-ledger-doc.mjs（43 PASS）

【硬边界（所有任务共享）】
· **不改既有生产文件**：lib/index.js、lib/event-write.js、lib/event-store.js、lib/shared-state-lock.js、lib/event-recall.js 等一律不碰
· **不改 P0+P1 已有文件**：lib/ledger-doc/protocol.js、lib/ledger-doc/document-store.js、tests/smoke/smoke-test-r4-ledger-doc.mjs（除非任务明确要求扩展）
· **不碰真实数据**：夹具用合成文档/事件，不复制真实记忆正文
· **隔离实现**：新功能在新文件或既有文件的**新增导出**中，不改既有行为
· **真执行**：真 import→真构造→真调用→断言返回值；禁止「源码含某字符串」当验收
· **负路径**：每个「必须拒绝」配反向对照「必须成功」
· **变异验证**：在隔离副本里做（复制到 artifacts/_r4-<task>-mutation/ 再改），断言必须变红、还原复绿
· **本机坑**：os.tmpdir() 返回 undefined\\temp（相对路径陷阱），临时文件放工作区内
· 新文件可用 LF，不改既有文件行尾


完成后用 send_message 把结果发给 Lead（目标：lead）。