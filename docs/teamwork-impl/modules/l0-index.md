
## l0-index

- **规模**：18,439 B / 350 行 / 5 个导出符号
- **交付形态**：**完整版**

### 职责

**L0 向量索引**（`l0_index_pre_v1`）—— 为 T1 产出的 L0 建立向量索引，供语义检索使用。
参照 OpenViking「Vector Index 只存 URI+向量+元数据，**不含文件内容**」：每条目仅 `{id, vector, l0, source, l0Hash, updatedAt}`，**绝不存记忆原文**。
工厂 `createL0IndexPre`：**IO 与 embedding 全注入，模块层零 fs / 零模型**。

### 数据流

```
L0 条目（来自 l0-extract）
   │
   ├─ buildFull  L244   全量建索引：buildL0IndexPre(text) × embedPassages(l0s)，一次性写盘
   ├─ update     L269   增量：逐条比 l0Hash → 新增 / 重算 / 跳过 / 移除，**仅重算变化条**
   ├─ remove     L314   显式按 ids 移除失效条目
   ├─ load       L99    fail-soft 读取：文件缺失 / schema 不符 / 条目非法 → {ok:false, entries:[]}，**绝不抛**
   └─ status     L343   索引概况（count / version / updatedAt）
        │
        ▼
   computeL0IndexVersionPre(entries)  L62   ★ 版本派生
        l0IndexVersion = 'l0idx_pre_' + first32hex(sha256(canonical sorted [id, l0Hash] tuples))
   身份约定：l0Hash = sha256(l0)，**增量重算的唯一判据**（l0 不变 → 跳过该条）
   L0_INDEX_VERSION L28 / L0_INDEX_SCHEMA_VERSION L29 / L0_INDEX_DEFAULT_STATUS L38
   内部：assemble L152 / resolveReuse L159 / writeIndex L235
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L28 | `L0_INDEX_VERSION` | `l0_index_pre_v1` |
| L29 | `L0_INDEX_SCHEMA_VERSION` | schema 版本 |
| L38 | `L0_INDEX_DEFAULT_STATUS` | 缺省状态 |
| L62 | `computeL0IndexVersionPre(entries)` | **版本派生**（确定性） |
| L83 | `createL0IndexPre(opts)` | **工厂**（IO/embedding 注入） |

**实例方法**：`load L99`、`assemble L152`、`resolveReuse L159`、`writeIndex L235`、`buildFull L244`、`update L269`、`remove L314`、`status L343`。

### 内部关键实现

**1. 只存 URI + 向量 + 元数据，不含原文（文件头）**

文件头逐字：*"参照 OpenViking「Vector Index 只存 URI+向量+元数据,不含文件内容」：每条目仅 `{id, vector, l0, source, l0Hash, updatedAt}`，**绝不存记忆原文**。"*
⇒ 索引文件本身**不含正文**，但仍然包含 L0 摘要（`l0` 字段）⇒ **共享索引 = 共享 L0 摘要**，不等于共享全文。

**2. l0Hash 是增量重算的唯一判据（文件头）**

*"`l0Hash = sha256(l0)`，增量重算的唯一判据（l0 不变 → 跳过该条）"* ⇒ 团队化后若两端 l0 摘要一致，可**跳过重嵌入**（embedding 是最贵的操作）。

**3. 版本派生是 canonical 排序元组（L62）**

`sha256(canonical sorted [id, l0Hash] tuples)` ⇒ **顺序无关**（先排序）。团队合并多端索引时，这条性质保证"同集合必得同版本"。

**4. load 是 fail-soft、绝不抛（文件头）**

*"fail-soft 读取:文件缺失/schema 不符/条目非法 → `{ok:false, entries:[]}`，**绝不抛**"* ⇒ 索引损坏不会拖垮检索。

**5. resolveReuse L159 —— 跨 id 复用**

结合 `l0-index-sync.js:82` 的 `crossIdReuse` 开关 ⇒ 允许"id 变了但 l0 未变"时复用既有向量。

### 与团队化的关系

**判定：S3 派生重算（索引完全可由 L0 + embedding 重建）+ S2（可选：共享向量以省算力）。**

理由：索引是**纯派生**。但 embedding 是**昂贵操作**（模型推理），团队化最有价值的做法是：**共享向量 + 各端复用**（同 l0Hash 直接复用，不重嵌入）。
**前提**：必须先对齐 `engine-identity`（模型/维度/池化），否则会把 384 维与 1024 维混进同一次排序（这正是 `engine-identity.js` 文件头记录的 T2-9 失败案例）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| LI1 | `computeL0IndexVersionPre` L62 | 单端元组 | 团队合并后**重算**（不传版本值） | 调用侧 |
| LI2 | `resolveReuse` L159 | 跨 id 复用 | 扩展为**跨端复用**（l0Hash 命中即复用） | 新增分支 |
| LI3 | 引擎身份 | 由 l0-index-sync 透传 | **必须先过 engine-identity 门**才允许跨端复用向量 | 前置门 |
| LI4 | 新增 `extractReusableVectorsPre` | 无 | 导出"可共享的向量子集"（**不带 l0 正文**） | 新增导出 |
| LI5 | `load` L99 | fail-soft | 团队索引损坏时**必须留痕**（不能静默空） | 接线 |

#### 可直接落地的代码片段

**片段 1**：跨端向量复用（**必须过引擎身份门**）。位置：`l0-index.js:159`（`resolveReuse` 内判定处）。

```js
/**
 * 跨端向量复用判定 —— **引擎身份必须一致，否则拒绝复用**。
 *
 * 为什么这是硬门：向量只有在**同一模型 / 同维度 / 同池化 / 同归一化**下才可比。
 *   engine-identity.js 文件头记录了失败案例：e5（384 维）与 bge-m3（1024 维）
 *   混进同一次排序 ⇒ T2-9 判失败。团队场景下这种混用**极易发生**：
 *   成员 A 用默认 JS 小模型、成员 B 装了 Python bge-m3。
 * ⇒ 身份不一致时**宁可重算**，也不复用对方向量。
 *
 * @param {object} local 本端条目 { id, l0Hash }
 * @param {object} remote 远端条目 { id, l0Hash, engineIdentity }
 * @param {string} localEngineIdentity 本端引擎身份（computeEngineIdentityPre 的输出）
 * @returns {{reusable:boolean, reason:string}}
 */
export function canReuseRemoteVectorPre(local, remote, localEngineIdentity) {
  const r = remote || {}
  const l = local || {}
  if (!r.l0Hash || !l.l0Hash) return { reusable: false, reason: 'missing-l0hash' }
  // ① l0 摘要必须逐字相同（l0Hash = sha256(l0)，见文件头身份约定）
  if (String(r.l0Hash) !== String(l.l0Hash)) return { reusable: false, reason: 'l0hash-mismatch' }
  // ② 引擎身份必须一致（缺失视为不一致 —— fail closed）
  const re = String(r.engineIdentity || '')
  const le = String(localEngineIdentity || '')
  if (!re || !le) return { reusable: false, reason: 'engine-identity-missing' }
  if (re !== le) return { reusable: false, reason: 'engine-identity-mismatch' }
  return { reusable: true, reason: 'ok' }
}
```

**片段 2**：可共享向量子集导出（新增导出，放文件末尾）。**不带 l0 正文。**

```js
/**
 * 导出可共享的向量子集 —— **只出 id / vector / l0Hash / 引擎身份**。
 *
 * 为什么不出 l0 字段：本模块条目里的 l0 是**摘要文本**（L0 抽取产物）。
 * 团队共享时若连摘要一起传，等于把队友记忆的内容带进你的索引；
 * 而向量本身不可逆地还原原文，**向量是可共享的、摘要是要控制的**。
 * 需要摘要时让上层走显式的内容共享通道（按 memoryId 下钻 + 权限校验）。
 *
 * @param {Array<{id:string, vector:any, l0Hash:string}>} entries
 * @param {string} engineIdentity
 * @param {{limit?:number}} [opts]
 * @returns {Array<{id:string, vector:any, l0Hash:string, engineIdentity:string}>}
 */
export function extractReusableVectorsPre(entries, engineIdentity, opts) {
  const list = Array.isArray(entries) ? entries : []
  const cap = Number.isFinite(opts && opts.limit) ? Number(opts.limit) : list.length
  const out = []
  for (const e of list) {
    if (out.length >= cap) break
    if (!e || !e.id || e.vector == null || !e.l0Hash) continue
    out.push({
      id: String(e.id),
      vector: e.vector,                 // 向量本身（不可逆）
      l0Hash: String(e.l0Hash),
      engineIdentity: String(engineIdentity || ''),
      // 明确不包含：l0（摘要文本）、source（路径）
    })
  }
  return out
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **跨引擎复用向量** | 只比 l0Hash 不比引擎身份 | 片段 1 硬门（fail closed）；对照 engine-identity 的 T2-9 案例 |
| **摘要随向量外传** | 复用条目时连 l0 字段一起传 | 片段 2 白名单字段（不含 l0/source） |
| **版本值跨端传递** | 直接同步 l0IndexVersion | LI1：各端重算（canonical 排序保证同集合同版本） |
| **fail-soft 变静默** | 索引损坏返回空且无痕迹 | LI5 留痕；与 degrade 台账联动 |
| **增量重算失效** | l0Hash 口径变化 | 文件头明文约定 l0Hash = sha256(l0)，改动会全量重嵌入（成本高） |

**既有测试/守卫**：`l0-index` 的 buildFull/update/remove 用例、load fail-soft 用例、版本确定性用例。`l0-index-sync.js` 是本模块的接线口（文件头明确"长期零引用……本模块是它的接线口"）。
