# 【任务】R4-M 隔离实现：模块化 / API 化 / 系统化

你是**实现 Agent**。本任务把 R4 的六个模块组织成**统一入口 + 统一契约 + 统一门面**，**不碰真实生产代码路径**。
工作目录：D:/dsh-auto-memory

---

# 零、为什么现在做

用户 2026-11-11 裁定：「现在应该得先做模块化和 API 化，再做接线」。

**R4-M 在 P4（读侧接线）之前执行**。理由：P4 要接线，若无统一门面则按分散接口做，做完 R4-M 又得返工。

---

# 一、现状（已实测）

`lib/ledger-doc/` 已有 **7 个模块**（P3 交付 wal.js 后）：

| 模块 | 字节 | 导出 | 干什么 |
|---|---|---|---|
| `protocol.js` | 4,739 | 18 | 协议常量 + 字段校验器 |
| `document-store.js` | 13,347 | 1 | `LedgerDocumentStore` |
| `locked-store.js` | 6,292 | 1 | `LockedLedgerDocumentStore` |
| `material-stamp.js` | 15,374 | 5 | `HandoffMaterialStamp` + `MaterialInvalidationBus` |
| `history-query.js` | 17,087 | 4 | `LedgerHistoryQuery` + `queryHistory` |
| `coverage-audit.js` | 38,137 | 9 | `LedgerCoverageAuditor` |
| `wal.js` | 18,702 | 1 | `LedgerWal` |

**集中验收已通过**：171 PASS/0 FAIL、变异 20 CAUGHT/0 MISSED。

---

# 二、权威文档

**docs/internal/R4-M-MODULARIZATION-20261111.md**（本任务的唯一权威契约）

---

# 三、要实现什么（三块）

## 3.1 统一入口 `lib/ledger-doc/index.js`

```js
export { LedgerDocumentStore } from './document-store.js'
export { LockedLedgerDocumentStore } from './locked-store.js'
export { HandoffMaterialStamp, MaterialInvalidationBus, publishCommittedDocument } from './material-stamp.js'
export { LedgerHistoryQuery, queryHistory, parseHistoryTime, HistoryQueryError } from './history-query.js'
export { LedgerCoverageAuditor } from './coverage-audit.js'
export { LedgerWal } from './wal.js'
export * from './protocol.js'
```

**验收**：调用方只 import `./ledger-doc/index.js` 即可拿到全部公开符号，无遗漏。

## 3.2 接口约定文档 `docs/internal/LEDGER-DOC-API-CONTRACT.md`

必须回答：

1. **返回形状**：所有公开方法是否统一返回 `{ok:boolean, ...}`？还是 `{result, error}`？
2. **错误码**：全模块统一的错误码清单（`document-id-invalid`/`document-version-conflict`/`event-ids-required`/`op-payload-mismatch` 等）
3. **空值语义**：`noop:true` vs `ok:false` 的区别；`null` vs `undefined` 的使用
4. **异步约定**：哪些方法必须 async、哪些可同步
5. **副作用声明**：每个方法是否写盘/改状态/发通知
6. **生命周期**：构造/启动/关闭/对账的统一签名

**验收**：文档存在且每个模块的公开方法都能在文档中找到对应条目；错误码全模块一致。

## 3.3 系统门面 `lib/ledger-doc/system.js`

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

**验收**：
- `new LedgerDocSystem({rootDir, enabled:false})` 可构造
- `start()`/`stop()` 可调用
- 各模块通过门面可达
- **默认 enabled:false**

---

# 四、测试要求

新建 `tests/smoke/smoke-test-r4-system.mjs`：

| 用例 | 断言 |
|---|---|
| 统一入口 | 只 import `./ledger-doc/index.js` 即可拿到全部公开符号 |
| 门面构造 | `new LedgerDocSystem({rootDir, enabled:false})` 可构造 |
| 门面生命周期 | `start()`/`stop()` 可调用且不抛错 |
| 门面到各模块 | `system.documents/stamp/history/audit/wal` 均可达且为正确类型 |
| 门面操作 | `upsertDocument`/`queryHistory`/`auditCoverage` 可调用且返回正确形状 |
| **回归** | 既有 R4 套件（171 PASS）在引入门面后仍全绿 |
| **隔离** | 门面不接管生产路径；默认 enabled:false |
| **变异** | 去掉门面某模块的接线 → 对应用例必须红 |

---

# 五、交付要求

1. `lib/ledger-doc/index.js`（统一入口）
2. `lib/ledger-doc/system.js`（系统门面）
3. `docs/internal/LEDGER-DOC-API-CONTRACT.md`（接口约定文档）
4. `tests/smoke/smoke-test-r4-system.mjs`（真执行 + 回归 + 变异）
5. `docs/internal/R4-M-RESULT-20261111.md`（实测报告）

---

# 六、硬纪律

1. **不改既有生产文件**：lib/index.js、lib/event-write.js、lib/event-store.js 等一律不碰
2. **不改已有 R4 模块的既有行为**（可新增导出，不改既有方法语义）
3. **不碰真实数据**：合成夹具
4. **真执行**：真 import→真构造→真调用→断言返回值
5. **负路径**：每个「必须拒绝」配反向对照「必须成功」
6. **变异验证**：在隔离副本里做
7. **本机坑**：os.tmpdir() 返回 undefined\\temp（相对路径陷阱），临时文件放工作区内
8. **不跑全仓回归**（用户裁定「先不用回归，太耗时间」）

完成后用 send_message 把结果发给 Lead（目标：lead）。