
## index-sync

- **规模**：8,742 B / 173 行 / 4 个导出符号
- **交付形态**：**完整版**

### 职责

**M7-1 Authorized `index_sync` 构造与执行**（`docs/PYTHON-SIDECAR-CONTRACT.md` §8.4；handoff M7-1）。
**JS 是唯一语料授权者**：records **只能由现有 M3/M4 corpus snapshot 投影产生**；Python **绝不自行读文件或发现路径**（本模块是**唯一授权出口**）。
**约束（冻结）**：单页 ≤ 64 records 且 ≤ 256 KiB（JSON 字节）；`pageDigest = sha256(canonical(records))`；`finalDigest = sha256(canonical(final 对象))`；同一 sync 的 `workspaceRef / scope / memoryIndexVersion` 一致。
**占位 chunking**（M7-2 tokenizer 前冻结）：**整记录 = 单 chunk**，`chunkId` 由 `memoryId + recordDigest` 派生，**chunkId 只是派生定位，永不替代 memoryId**。

### 数据流

```
已授权 corpus snapshot（M4）
   │
   ▼
toSemanticRecordPre(rec, workspaceRef)  L42   ★ 授权投影
   ├─ 取 memoryId / anchorId / scope / workspaceRef / sourceRef
   ├─ sourceEpoch / sourceVersion / fileDigest / recordDigest
   ├─ heading（null 允许）/ text（**snapshot 已授权切片**）
   ├─ occurredAt = null（语料无此概念）
   ├─ chunkId = buildChunkIdPre(memoryId, recordDigest)   L56
   └─ chunkOrdinal 0 / chunkCount 1（占位 chunking）
        │
        ▼
buildIndexSyncPlansPre(input)  L69   ★ 按 scope 分组
   ├─ SCOPE_ORDER_PRE = ['Workspace', 'User']  L32  **确定顺序**
   ├─ 分页：INDEX_SYNC_PAGE_BUDGET_PRE_V1 L31 = { maxRecordsPerPage: 64, maxPageBytes: 252*1024 }
   ├─ pagePayloadBytes(syncId, pageNo, pageCount, records)  L34
   └─ 产出 { ok:true, plans:[{scope, begin, pages[], commit}], recordTotal }
        │
        ▼
sendIndexSyncPlanPre(plan, client)  L150   → 逐帧发送（step L154）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L31 | `INDEX_SYNC_PAGE_BUDGET_PRE_V1` | 分页预算（64 records / 252 KiB） |
| L34 | `pagePayloadBytes(...)` | 页面字节估算（**固定长度 digest 占位**） |
| L42 | `toSemanticRecordPre(rec, workspaceRef)` | **授权投影** |
| L69 | `buildIndexSyncPlansPre(input)` | **构造计划** |
| L150 | `sendIndexSyncPlanPre(plan, client)` | 执行发送 |

### 内部关键实现

**1. JS 是唯一语料授权者（文件头）**

文件头逐字：*"JS 是唯一语料授权者:records 只能由现有 M3/M4 corpus snapshot 投影产生; Python **绝不自行读文件或发现路径**（本模块是唯一授权出口）。"*
⇒ 这是一条**安全边界**：Python 侧永远不能自己去找记忆文件。团队化后同步的语料同样必须经此出口。

**2. chunkId 是派生定位、永不替代 memoryId（文件头）**

*"`chunkId` 只是派生定位,永不替代 memoryId"* ⇒ 团队里引用一条记忆**必须用 memoryId**（见 `memory-anchor.js:8` 的"随机分配后永久稳定"契约）。用 chunkId 会导致"重新分块即失联"。

**3. 分页上界是双约束（L31）**

records 数 **和** 字节数同时设界 ⇒ 防止"少量超长记录"绕过记录数限制。`pagePayloadBytes` 用固定长度的 digest 占位串计算 —— **固定长度占位**保证字节估算与实际一致。

**4. 同一 sync 的三元组必须一致（文件头）**

`workspaceRef / scope / memoryIndexVersion` 一致 ⇒ 否则同一批语料会被拆到不同索引下。

### 与团队化的关系

**判定：S2 团队共享（团队索引的语料出口）+ 安全边界（授权闸门）。**

理由：团队要共享语义检索能力，就必须共享**索引**。而索引的输入是语料 —— 本模块是**唯一授权出口** ⇒ 团队索引同步必须复用本模块，**绝不能另开一条"直接从磁盘读语料"的路径**。
**关键**：`workspaceRef` 已是哈希（`evidence-store.js:39`）⇒ 共享索引不泄露路径。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| IX1 | `toSemanticRecordPre` L42 | 本地授权投影 | 增加 `origin`（local/team）**但不得进 digest** | 结构新增 |
| IX2 | `buildIndexSyncPlansPre` L69 | 分页 64/252KiB | 团队语料更大 ⇒ 多批 sync，**复用同分页** | 调用侧 |
| IX3 | `sendIndexSyncPlanPre` L150 | 本地 client | 团队通道需独立 client（**不得复用本地请求通道**） | 新增参数 |
| IX4 | scope 顺序 L32 | Workspace → User | 团队增加 `'Team'` scope，**排最后** | 枚举新增 |
| IX5 | 授权边界 | 已是唯一出口 | **不得为团队新开语料读取路径** | 纪律 |

#### 可直接落地的代码片段

**片段 1**：团队 scope 追加（**排在最后，不改既有顺序**）。位置：`index-sync.js:32`（`SCOPE_ORDER_PRE` 定义处）。

```js
// ★ Teamwork：新增 Team scope，**追加在最后**。
//   为什么不插在前面：SCOPE_ORDER_PRE 决定 begin/page/commit 的发送顺序，
//   顺序变化会改变帧序列 ⇒ 既有测试（很可能断言顺序）会红，
//   更重要的是 Python 侧 worker 的接收顺序假设也会变。
//   ⇒ 只在末尾追加，既有两段顺序逐字节不变。
const SCOPE_ORDER_PRE = ['Workspace', 'User', 'Team']
```

**片段 2**：origin 标注**不得进 digest**。位置：`index-sync.js:42`（`toSemanticRecordPre` 组装 `out` 处）。

```js
export function toSemanticRecordPre(rec, workspaceRef) {
  const out = {
    memoryId: rec.memoryId,
    anchorId: rec.anchorId,
    scope: rec.scope,
    workspaceRef: workspaceRef,
    sourceRef: rec.sourceRef,
    sourceEpoch: rec.sourceEpoch,
    sourceVersion: rec.sourceVersion,
    fileDigest: rec.fileDigest,
    recordDigest: rec.recordDigest,
    heading: rec.heading != null ? String(rec.heading) : null,
    text: String(rec.text == null ? '' : rec.text),
    occurredAt: null,
    chunkId: buildChunkIdPre(rec.memoryId, rec.recordDigest),
    chunkOrdinal: 0,
    chunkCount: 1,
  }
  // ★ Teamwork：来源标注是**旁路元数据**，绝不参与 pageDigest/finalDigest 计算。
  //   为什么要标：团队索引里混有"我自己的语料"与"队友共享的语料"，
  //   检索结果需要能区分（否则会把队友上下文当成自己的经历）。
  //   为什么不能进 digest：digest 是"内容等价"的判据。若 origin 进 digest，
  //   同一份语料在 A/B 两端会因 origin 不同而算出不同 digest ⇒
  //   worker 侧去重失效，索引出现重复条目。
  if (rec.origin) out.origin = String(rec.origin)
  const v = validateSemanticRecordPre(out)
  return v.ok ? { ok: true, record: v.record } : { ok: false, reason: v.reason }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **另开语料读取路径** | 团队同步"顺手"读磁盘 | IX5 纪律 + 文件头的授权边界声明 |
| **scope 顺序变动** | 把 Team 插到中间 | 片段 1 只追加；回归断言前两段顺序不变 |
| **origin 进 digest** | 顺手把 origin 加进 canonical | 片段 2 禁止；回归断言"仅改 origin 时 digest 不变" |
| **单页超限** | 团队语料记录超长 | 双约束（64 records + 252KiB）；超长记录需拒绝而非截断 |
| **chunkId 替代 memoryId** | 团队引用用 chunkId | 文件头明文禁止 |

**既有测试/守卫**：`index-sync` 的分页用例（含"少量超长记录"边界）、digest 确定性用例、scope 顺序用例。`m7-wire.js:130` 的 `validateSemanticRecordPre` 会对本模块产出的记录做二次校验 ⇒ 新增字段必须同时通过 wire 层校验。
