# 【任务】R4 P2B 隔离实现：存量只读审计生成器

你是**实现 Agent**。本任务在**隔离夹具**中实现 R4 的 P2B，**不碰真实生产代码路径**。
工作目录：D:/dsh-auto-memory

---

# 零、授权范围

**允许**：默认开关关闭的隔离实现 + 合成夹具测试。
**禁止**：真实存量迁移、接管唯一接续来源、物理删除、修改现有生产写入路径。

---

# 一、目标

实现 **coverageReport 生成器**（只读，不改任何源文件），把 687 篇账本的覆盖证据落成可机械验收的报告。

---

# 二、必读材料

- docs/internal/PROTOCOL-R4-20261110.md §7（存量只读审计方案）
- artifacts/_protocol-r4-20261110/data/coverage-summary.json（已有基础覆盖）
- artifacts/_protocol-r4-20261110/data/audit-partition.json（例外分桶）
- lib/event-store.js（检查点结构）

---

# 三、要实现什么

1. 新建 `lib/ledger-doc/coverage-audit.js`：实现 **coverageReport 生成器**（只读）
2. **五条判据的机械化实现**（协议 §7.3）：
   · 身份映射：sourceRef + 声明 eventId + 检查点内容；无 sourceRef 时只在规范化全文唯一匹配且无身份冲突时形成候选
   · 规范等价：固定 `r4-ledger-normalize-v1`（UTF-8 严格解码、CRLF→LF、只去生成 H1 与协议元数据整行、去行尾空白和首尾空行）；比较完整规范化 SHA-256
   · 四段语义：统一解析器逐段比较 goal/state/dead/next；区分缺字段/空字符串/显式「无已确认失败」
   · 绑定时间线：filenameTimestamp/birthtime/mtime/cp.at 差值；指针存在时验证同源；多事件逐个核对
   · 报告持久化：读完重读源核对 SHA；原子写报告；读回核对 reportSha256；汇总总数=输入文件数
3. **coverageReport 字段**按协议 §7.2 完整实现（schemaVersion/auditRulesVersion/source/eventStoreSnapshot/normalization/candidates/identity/content/quad/timeline/binding/recovery/gates/disposition/eligibleForPhysicalDelete/review/sourceRereadSha256/errors/auditDurationMs/reportSha256）
4. **536 篇无匹配的分类处置**（协议 §7.4）：pointer-only-content-diff / declared-event-only / normalization-candidate / extra-semantic-content / no-event-side-evidence-in-scope / illegible-or-ambiguous
5. **eligibleForPhysicalDelete 默认且当前恒 false**
6. 新建 `tests/smoke/smoke-test-r4-coverage-audit.mjs`：真执行 + 五判据各有反向夹具 + 536 类无匹配永不可删
7. **在真实 store 副本上跑一次**（只读）：生成 687 篇报告，统计各判据通过率

---

# 四、交付要求

1. **新模块**：按上文指定路径
2. **测试**：真执行 + 负路径 + 变异验证
3. **报告**：`docs/internal/R4-P2B-RESULT-20261111.md`（含实测 PASS/FAIL 数、变异 CAUGHT/MISSED、字节数）

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