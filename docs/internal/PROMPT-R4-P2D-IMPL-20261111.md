# 【任务】R4 P2D 隔离实现：历史时间线查询

你是**实现 Agent**。本任务在**隔离夹具**中实现 R4 的 P2D，**不碰真实生产代码路径**。
工作目录：D:/dsh-auto-memory

---

# 零、授权范围

**允许**：默认开关关闭的隔离实现 + 合成夹具测试。
**禁止**：真实存量迁移、接管唯一接续来源、物理删除、修改现有生产写入路径。

---

# 一、目标

实现**结构化历史查询**（指定时间区间 + 事件 + 全部检查点），不依赖账本历史文件。

---

# 二、必读材料

- docs/internal/PROTOCOL-R4-20261110.md §6（历史查询链）
- lib/event-recall.js:45-61（textOfEventPre 现状）
- lib/index.js:14168-14177（scope=all 默认只取最近 40 份）
- lib/index.js:14707-14712（expandEventRecordPre 只展开最近 5 条）
- lib/event-store.js（检查点结构）

---

# 三、要实现什么

1. 新建 `lib/ledger-doc/history-query.js`：实现**只读历史时间线查询**
   · 参数：from/to（显式日期或带时区 ISO，from 含 to 不含）、eventId（可选精确匹配）、kinds（可选过滤）、cursor/limit（分页）、includeQuad（返回持久化四段）
   · 输出：eventId/checkpointId/at/kind/text/goal/state/dead/next/sourceRef/opId + range/coveredSources/readErrors/truncated/nextCursor
   · **不依赖账本历史文件**：从事件检查点 + 日志回答
2. **不新增工具参数到生产 memory_recall**（P4 才接线）；本任务只实现独立查询模块
3. 新建 `tests/smoke/smoke-test-r4-history-query.mjs`：实现协议 §6.4 的 **H-1～H-8** 全部断言：
   · H-1 周初/周中/周末三条检查点 ⇒ 指定上周区间返回三条且按 at 正序
   · H-2 区间前后各有边界 ⇒ 只返回 [from,to) 内
   · H-3 当前维护文档含新词但无对应检查点 ⇒ 不得把当前态冒充上周事实
   · H-4 区间超 5 条 ⇒ 分页后全集完整，不受最近 5 条限制
   · H-5 检查点全文改摘要/指针 ⇒ 仍能返回四段/目标 revision/恢复指针
   · H-6 事件库损坏/读失败 ⇒ 返回 readErrors，不得返回「无记录」
   · H-7 所有账本文件从夹具移除 ⇒ H-1 仍通过
   · H-8 固定本地时钟和时区 ⇒ 日期边界三次运行一致

---

# 四、交付要求

1. **新模块**：按上文指定路径
2. **测试**：真执行 + 负路径 + 变异验证
3. **报告**：`docs/internal/R4-P2D-RESULT-20261111.md`（含实测 PASS/FAIL 数、变异 CAUGHT/MISSED、字节数）

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