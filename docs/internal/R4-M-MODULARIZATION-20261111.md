# R4-M · 模块化 / API 化 / 系统化收尾（待做）

> 日期：2026-11-11
> 性质：**待做项登记**，不是已完成工作
> 用户裁定（2026-11-11）：「可以等到 R4 全部做完以后，把这一项做好，现在把它的内容写到文档里」
> 位置：R4 全部实施完成后执行（P7 之后）。

---

## 一、现状实测（2026-11-11 本机只读）

`lib/ledger-doc/` 已有 **6 个模块 / 1,885 行 / 94,976 B**：

| 模块 | 字节 | 行 | 导出 | 干什么 |
|---|---|---|---|---|
| `protocol.js` | 4,739 | 115 | **18** | 协议常量 + 字段校验器（零依赖）|
| `document-store.js` | 13,347 | 262 | 1 | `LedgerDocumentStore`（首建/CAS/原子写/读回）|
| `locked-store.js` | 6,292 | 132 | 1 | `LockedLedgerDocumentStore`（跨进程锁）|
| `material-stamp.js` | 15,374 | 336 | 5 | `HandoffMaterialStamp` + `MaterialInvalidationBus` |
| `history-query.js` | 17,087 | 298 | 4 | `LedgerHistoryQuery` + `queryHistory` |
| `coverage-audit.js` | 38,137 | 742 | 9 | `LedgerCoverageAuditor` |

### 已做到的

**① 模块化（已具备）**：每个模块只做一件事，职责清晰；依赖关系有向无环：

```
protocol.js        ← 协议常量与校验（零依赖）
document-store.js  ← 文档存储（依赖 protocol）
locked-store.js    ← 锁包装（依赖 document-store + shared-state-lock）
material-stamp.js  ← 指纹（依赖 protocol + file-boundary）
history-query.js   ← 历史查询（依赖 protocol）
coverage-audit.js  ← 审计（依赖 protocol）
```

**② 协议复用（部分）**：`protocol.js` 被 4 个模块复用（document-store / material-stamp / history-query / coverage-audit）。

**③ 测试覆盖**：每个模块独立 smoke 套件，合计 **146 PASS / 0 FAIL**、变异 **16 CAUGHT / 0 MISSED**。

---

## 二、还缺的三块（R4-M 要补的）

### ① 没有统一入口 ❌

`lib/ledger-doc/` 下**没有 `index.js`**。调用方必须知道每个模块的路径：

```js
// 现状
import { LedgerDocumentStore } from './ledger-doc/document-store.js'
import { LockedLedgerDocumentStore } from './ledger-doc/locked-store.js'
import { HandoffMaterialStamp } from './ledger-doc/material-stamp.js'

// 目标
import { LedgerDocumentStore, LockedLedgerDocumentStore, HandoffMaterialStamp, ... } from './ledger-doc/index.js'
```

### ② 接口约定不统一 ⚠️

各类的方法命名与返回形状**没有统一契约**：

| 类 | 方法 | 返回形状 |
|---|---|---|
| `LedgerDocumentStore` | `createDocument` / `updateDocument` / `readDocument` / `listDocuments` | 各自形状 |
| `LockedLedgerDocumentStore` | 同名 + `withDocumentLock`/`withIndexLock`/`runOperation` | 包装 |
| `HandoffMaterialStamp` | `read`/`readStamp`/`subscribe`/`publishCommitted` | 不同 |
| `LedgerHistoryQuery` | `query` | 不同 |
| `LedgerCoverageAuditor` | `auditFile`/`auditAll` | 不同 |

**没有一份「这些类都遵循什么约定」的成文协议**（例如：是否都返回 `{ok, ...}`？错误码怎么统一？）。

### ③ 没有「系统」这一层 ❌

现在是**六个独立模块**，但没有一个「把它们组合成一个系统」的地方：

```
没有：LedgerDocSystem（文档存储 + 锁 + 指纹 + 查询 + 审计 的统一门面）
没有：统一的配置（rootDir、开关、预算）
没有：统一的生命周期（启动/关闭/对账）
```

---

## 三、R4-M 要做什么（三块）

| 补什么 | 工作量 | 价值 |
|---|---|---|
| **统一入口 `lib/ledger-doc/index.js`** | 极小（一个文件）| 调用方只需 `import ... from './ledger-doc/index.js'` |
| **接口约定文档**（`docs/internal/LEDGER-DOC-API-CONTRACT.md`）| 小（一份契约）| 让六个模块的返回形状/错误码可预测 |
| **系统门面 `LedgerDocSystem`**（`lib/ledger-doc/system.js`）| 中（一个类）| 把六个模块组合成一个可用的系统，统一配置与生命周期 |

### 3.1 统一入口

```js
// lib/ledger-doc/index.js
export { LedgerDocumentStore } from './document-store.js'
export { LockedLedgerDocumentStore } from './locked-store.js'
export { HandoffMaterialStamp, MaterialInvalidationBus, publishCommittedDocument } from './material-stamp.js'
export { LedgerHistoryQuery, queryHistory, parseHistoryTime, HistoryQueryError } from './history-query.js'
export { LedgerCoverageAuditor } from './coverage-audit.js'
export { LedgerWal } from './wal.js'  // P3 交付后
export * from './protocol.js'
```

### 3.2 接口约定文档

`docs/internal/LEDGER-DOC-API-CONTRACT.md` 必须回答：

1. **返回形状**：所有公开方法是否统一返回 `{ok:boolean, ...}`？还是 `{result, error}`？
2. **错误码**：全模块统一的错误码清单（如 `document-id-invalid`/`document-version-conflict`/`event-ids-required`/`op-payload-mismatch` 等）
3. **空值语义**：`noop:true` vs `ok:false` 的区别；`null` vs `undefined` 的使用
4. **异步约定**：哪些方法必须 async、哪些可同步
5. **副作用声明**：每个方法是否写盘/改状态/发通知
6. **生命周期**：构造/启动/关闭/对账的统一签名

### 3.3 系统门面

`lib/ledger-doc/system.js` 的 `LedgerDocSystem`：

```js
export class LedgerDocSystem {
  constructor({ rootDir, enabled = false, ...config }) { /* 统一配置 */ }
  
  // 统一生命周期
  async start() { /* 对账、预热、初始化 */ }
  async stop() { /* 释放锁、刷盘、关闭 */ }
  
  // 统一入口到各模块
  get documents() { /* LedgerDocumentStore 或 LockedLedgerDocumentStore */ }
  get stamp() { /* HandoffMaterialStamp */ }
  get history() { /* LedgerHistoryQuery */ }
  get audit() { /* LedgerCoverageAuditor */ }
  get wal() { /* LedgerWal */ }
  
  // 统一操作
  async upsertDocument(args) { /* 走 WAL：Phase 0→1→2→3 */ }
  async queryHistory(args) { /* 走 history-query */ }
  async auditCoverage(args) { /* 走 coverage-audit */ }
}
```

---

# 四、验收判据（待 R4 完成后执行）

| 项 | 判据 |
|---|---|
| 统一入口 | 调用方只 import `./ledger-doc/index.js` 即可拿到全部公开符号；无遗漏 |
| 接口约定 | 文档存在且每个模块的公开方法都能在文档中找到对应条目；错误码全模块一致 |
| 系统门面 | `new LedgerDocSystem({rootDir, enabled:false})` 可构造；`start()`/`stop()` 可调用；各模块通过门面可达 |
| **回归** | 既有 R4 套件（146 PASS）在引入门面后仍全绿；门面自身有真执行测试 |
| **隔离** | 门面不接管生产路径；默认 enabled:false |

---

# 五、与 R4 的关系

- **R4-M 是 R4 的收尾项**，不是 R4 的前置
- 在 R4 全部实施完成（P7）之后执行
- 不改变 R4 的任何协议与判据，只做「组织方式」的收尾
- 用户裁定：「可以等到 R4 全部做完以后，把这一项做好」

---

# 六、诚实边界

- 本文件是**待做项登记**，不是已完成工作
- 现状实测数字（6 模块/1,885 行/94,976 B）来自 2026-11-11 本机只读核验
- 三块补什么（统一入口/接口约定/系统门面）是设计建议，非已实现
- 验收判据待 R4 完成后才能真正执行