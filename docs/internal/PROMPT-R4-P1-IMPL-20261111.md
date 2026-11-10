# 【任务】R4 P0+P1 隔离实现（协议冻结 + 字段层）

你是**实现 Agent**。本任务在**隔离夹具**中实现 R4 的 P0 与 P1，**不碰真实生产代码路径**。
工作目录：D:/dsh-auto-memory

---

# 零、授权范围（用户 2026-11-11 裁定「可以开工」）

**允许**：默认开关关闭的隔离实现 + 合成夹具测试。
**禁止**：真实存量迁移、接管唯一接续来源、物理删除、修改现有生产写入路径。

**你的代码必须是新增模块**，不得改动现有 `lib/index.js`、`lib/event-write.js`、`lib/event-store.js` 等既有文件的任何行为。

---

# 一、必读协议（先读完再动手）

**docs/internal/PROTOCOL-R4-20261110.md**（41,324 B / 580 行）——本任务的唯一权威契约。

重点读：
- §2.1 字段级协议表（9 个字段的语义/校验/失败行为/机械验收）
- §2.2 WAL 状态机（Phase 0/1/2/3）
- §9.4 隔离实现要求

---

# 二、P0：冻结协议与合成夹具

## 2.1 新建模块 `lib/ledger-doc/`（**全新目录，不改既有文件**）

创建以下文件：

### `lib/ledger-doc/protocol.js`

导出协议常量与字段校验器：

```js
// 协议版本
export const PROTOCOL_VERSION = 'r4-ledger-doc-v1'

// 字段格式正则（来自协议 §2.1）
export const DOCUMENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}-[0-9]{6}-[0-9]{4}$/
export const EVENT_ID_RE = /^evt_[0-9a-f]{8}$/
export const OP_ID_RE = /^r4op_[0-9a-f]{32}$/
export const CHECKPOINT_ID_RE = /^ckpt_[0-9a-f]{16}$/

// 校验函数（每个都要真返回结果，不是占位）
export function validateDocumentId(id) { /* ... */ }
export function validateEventIds(ids) { /* ... */ }
export function validateOpId(opId) { /* ... */ }
export function validateCheckpointId(id) { /* ... */ }
export function normalizeText(text) { /* UTF-8 无 BOM、CRLF/CR→LF、去行尾空白 */ }
export function computeRevision(docText) { /* sha256:<64hex>，revision 元数据行置空后计算 */ }
export function computeOperationDigest(payload) { /* sha256(canonical(...)) */ }
export function computeLegacyCheckpointKey(cp) { /* sha256(canonical({eventId,checkpointIndex,at,kind,text,sourceRef,idemKey,quad})) */ }
```

**每个函数都要真实现**，并配独立单元测试。

## 2.2 合成夹具

新建 `artifacts/_r4-p1-fixtures/`（**不入库**），含：

- `fixtures/documents/`：合成维护文档（**不用真实记忆正文**）
- `fixtures/events.json`：合成事件库
- `fixtures/README.md`：说明这是合成数据

---

# 三、P1：字段层实现

## 3.1 `lib/ledger-doc/document-store.js`

实现**隔离的**文档存储（不接管生产）：

```js
export class LedgerDocumentStore {
  constructor(rootDir) { /* rootDir 必须是隔离夹具目录 */ }
  
  // 首建（create-only）
  async createDocument({ documentId, title, eventIds, content }) { /* ... */ }
  
  // 就地更新（带 CAS）
  async updateDocument({ documentId, expectedRevision, eventIds, changeSet }) { /* ... */ }
  
  // 读取
  async readDocument(documentId) { /* ... */ }
  
  // 列出（按 updatedAt，不按字典序）
  async listDocuments() { /* ... */ }
}
```

**必须实现**：
- 路径白名单（只在 rootDir 内）
- `documentId` 校验（非法拒绝）
- `eventIds` 校验（至少 1 项、格式、去重）
- `expectedRevision` CAS（不匹配返回 `document-version-conflict`）
- 原子写（临时文件 + rename）
- 读回校验（revision 一致）
- 首建 create-only（同名冲突返回 `document-already-exists`）

**不要实现**：
- 锁（P2A 才做）
- WAL（P3 才做）
- RAG 索引（P4 才做）

## 3.2 单元测试 `tests/smoke/smoke-test-r4-ledger-doc.mjs`

**真执行 + 负路径 + 变异验证**：

| 用例 | 断言 |
|---|---|
| 正常首建 | 返回 documentId、revision；文件存在 |
| 同名首建冲突 | 返回 `document-already-exists`；文件数不变 |
| 非法 documentId | 返回 `document-id-invalid`；无文件创建 |
| 空 eventIds | 返回 `event-ids-required` |
| 未知 eventId 格式 | 返回 `event-id-unavailable` |
| 正常更新 | revision 变化；文件内容更新 |
| 错误 expectedRevision | 返回 `document-version-conflict`；文件不变 |
| 同内容重复更新 | 返回 `noop:true`；revision 不变 |
| 路径越界（`..`）| 返回 `document-id-invalid` |
| **变异**：去掉 revision 校验 | 错误 expectedRevision 用例**必须红** |

**变异验证必须在隔离副本里做**（复制 `lib/ledger-doc/` 到 `artifacts/_r4-p1-mutation/` 再改）。

---

# 四、交付要求

1. **新模块**：`lib/ledger-doc/protocol.js`、`lib/ledger-doc/document-store.js`
2. **测试**：`tests/smoke/smoke-test-r4-ledger-doc.mjs`（真执行 + 负路径 + 变异）
3. **夹具**：`artifacts/_r4-p1-fixtures/`（合成数据）
4. **报告**：`docs/internal/R4-P1-RESULT-20261111.md`（含实测 PASS/FAIL 数、变异 CAUGHT/MISSED、字节数）

---

# 五、硬纪律

1. **不改既有文件**：`lib/index.js`、`lib/event-write.js`、`lib/event-store.js`、`lib/shared-state-lock.js` 等**一律不碰**
2. **真执行**：必须真 import → 真构造 → 真调用 → 断言返回值；禁止「源码含某字符串」当验收
3. **负路径**：每个「必须拒绝」都要配反向对照「必须成功」
4. **变异验证**：在隔离副本里做，断言必须变红、还原复绿
5. **不碰真实数据**：夹具用合成文档，不复制真实记忆正文
6. **本机坑**：`os.tmpdir()` 返回 `undefined\\temp`（相对路径陷阱），临时文件放工作区内
7. **CRLF**：本仓源码是 CRLF，新文件可用 LF，但不要改既有文件的行尾

完成后用 send_message 把结果发给 Lead（目标：lead）。