# 【任务】R4 P2C 隔离实现：handoffMaterialStamp 改造与失效协议

你是**实现 Agent**。本任务在**隔离夹具**中实现 R4 的 P2C，**不碰真实生产代码路径**。
工作目录：D:/dsh-auto-memory

---

# 零、授权范围

**允许**：默认开关关闭的隔离实现 + 合成夹具测试。
**禁止**：真实存量迁移、接管唯一接续来源、物理删除、修改现有生产写入路径。

---

# 一、目标

把 `handoffMaterialStamp` 从「只看文件名」改为「含文档内容 revision」，并配失效协议。

---

# 二、必读材料

- docs/internal/PROTOCOL-R4-20261110.md §3（handoffMaterialStamp 改造方案与负路径断言）
- lib/index.js:7950-7970（现行 handoffMaterialStamp）
- lib/index.js:20709-20719（latestLedgerNamePre 只认旧文件名）
- lib/index.js:8034/8068/8078（三个调用点语义）
- artifacts/_protocol-r4-20261110/data/fingerprint.json（现行盲点实测）

---

# 三、要实现什么

1. 新建 `lib/ledger-doc/material-stamp.js`：实现**新版指纹**（不改既有 handoffMaterialStamp）
   · 结构化指纹再求 SHA-256：schema/plan/legacyLatest/documents[]/events/readErrors
   · documents 对 handoff/documents/ 全部合法文档按 documentId 排序，逐份从正文真源算 revision（不只读 manifest）
   · 旧账本与新文档并存时两类都参与
   · 事件投影含 id/name/summary/status/sections/updatedAt/checkpointCount/outcome
   · 缺失/空目录/读取失败是三种不同状态；读取失败进 readErrors
2. **失效协议**：定义「文档写入后如何通知读侧刷新」的机制（不改既有 latestHandoffText，新增独立失效信号）
3. 新建 `tests/smoke/smoke-test-r4-material-stamp.mjs`：实现协议 §3.3 的 **F-1～F-8** 全部断言：
   · F-1 同 documentId 同 mtime 正文 A→B ⇒ after!==before
   · F-2 不改内容再读 ⇒ after===before
   · F-3 只更新 updatedAt 元数据 ⇒ revision 与 stamp 均变化
   · F-4 新增/删除/重命名新文档 ⇒ stamp 均变化
   · F-5 旧账本与新文档并存只改旧账本 ⇒ stamp 变化
   · F-6 A 工作区改 B 不改 ⇒ stamp(A) 变 stamp(B) 不变
   · F-7 读取从成功变 EACCES/损坏 ⇒ stamp 含错误变化
   · F-8 隔离副本移除 revision 维度 ⇒ F-1/F-5 必须变红，恢复复绿

---

# 四、交付要求

1. **新模块**：按上文指定路径
2. **测试**：真执行 + 负路径 + 变异验证
3. **报告**：`docs/internal/R4-P2C-RESULT-20261111.md`（含实测 PASS/FAIL 数、变异 CAUGHT/MISSED、字节数）

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