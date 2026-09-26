
## m7-wire

- **规模**：14,620 B / 270 行 / 21 个导出符号
- **交付形态**：**完整版**

### 职责

**M7-0 Wire Protocol 纯核心**（`docs/PYTHON-SIDECAR-CONTRACT.md` §7-§9/§13）。**零 IO、零依赖（`node:crypto`）；本模块不 spawn、不监听、不读文件、不改 M5/M6 schema。**
五部分组成（文件头逐字）：
1. 协议常量（`m7_wire_pre_v1` / 传输预算 / **帧类型两个不相交集合** / 请求→响应对应）；
2. canonical JSON + SHA-256（**JS 与 Python worker 的逐字节一致实现**；排序键、无空白、UTF-8）；
3. `M7TransportFramePre` envelope validator（**fail closed；方向门**）；
4. SemanticRecordPre / IndexSyncBegin/Page/Commit payload validators；
5. pageDigest / finalDigest / chunkId / syncId canonical identity。

### 数据流

```
帧对象
   │
   ▼
canonicalJson(obj)   L59   排序键 + 无空白 + UTF-8（**与 Python 逐字节一致**）
   └─ sha256Canonical(obj)  L73
        │
        ▼
validateTransportFramePre(frame)  L82   ★ **fail closed + 方向门**
   ├─ JS_FRAME_TYPES_PRE_V1  L34   JS → Python 的帧类型集合
   ├─ PY_FRAME_TYPES_PRE_V1  L39   Python → JS 的帧类型集合（**两个不相交集合**）
   └─ RESPONSE_TYPE_FOR_PRE_V1  L44  请求 → 响应对应
        │
   makeRequestFramePre(...)  L101
        │
        ▼
   payload validators：
     validateSemanticRecordPre       L130
     validateIndexSyncBeginPre       L153
     validateIndexSyncPagePre        L180
     validateIndexSyncCommitPre      L195
     validateIndexAckPayloadPre      L207
        │
        ▼
   canonical identity：
     buildChunkIdPre      L226   chunkId = f(memoryId, recordDigest)
     buildSyncIdPre       L231
     computePageDigestPre L236
     computeFinalDigestPre L244
     ackMatchesObservationPre L258   ★ ACK ↔ observation 匹配
   wireModuleHygieneOk  L263     模块卫生自检
   M7_WIRE_PROTOCOL_VERSION_PRE_V1 L19 / M7_INDEX_POLICY_VERSION_PRE_V1 L20
   M7_TRANSPORT_BUDGET_PRE_V1 L23
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L19–L44 | 协议常量 | 版本、传输预算、两个**不相交**帧类型集、请求→响应映射 |
| L59 | `canonicalJson(obj)` | **canonical JSON**（跨语言逐字节一致） |
| L73 | `sha256Canonical(obj)` | canonical 哈希 |
| L82 | `validateTransportFramePre(frame)` | **帧校验（fail closed + 方向门）** |
| L101 | `makeRequestFramePre(...)` | 构造请求帧 |
| L130–L207 | 五个 payload validator | record / begin / page / commit / ack |
| L226 / L231 | `buildChunkIdPre` / `buildSyncIdPre` | 身份派生 |
| L236 / L244 | `computePageDigestPre` / `computeFinalDigestPre` | 摘要 |
| L258 | `ackMatchesObservationPre(...)` | **ACK ↔ observation 匹配** |
| L263 | `wireModuleHygieneOk()` | 模块卫生自检 |

### 内部关键实现

**1. 两个不相交的帧类型集合（L34 / L39）**

JS → Python 与 Python → JS 的帧类型**互不重叠** ⇒ 方向门可判定"这个帧走错方向了"。⇒ 防止 A 方向的帧被当作 B 方向处理（会导致协议错乱但不报错）。

**2. canonical JSON 必须跨语言逐字节一致（L59）**

文件头逐字：*"canonical JSON + SHA-256（**JS 与 Python worker 的逐字节一致实现**；排序键、无空白、UTF-8）"* ⇒ `pageDigest` / `finalDigest` 依赖它。⇒ 任一语言实现偏差都会导致 digest 不匹配，**表现为"同步永远失败"**。

**3. fail closed + 方向门（L82）**

帧校验失败即拒 ⇒ 不猜测、不补救。

**4. ackMatchesObservationPre（L258）**

校验 ACK 与 observation 的对应关系 ⇒ 防"张冠李戴的回执"（`context-sink-python.js:1` 的 import 依赖它）。

**5. wireModuleHygieneOk（L263）**

模块卫生自检 ⇒ 可在守卫中断言"本模块确实零 IO / 零 spawn"（与文件头的自我约束对应）。

### 与团队化的关系

**判定：S2 团队共享（协议契约必须全端一致）+ 安全边界。**

理由：wire 协议是 JS ↔ Python 的**字节级契约**。团队化会引入**第三端**（团队服务端），若它用自己的序列化实现，digest 必然不匹配。
**纪律**：团队服务端**必须复用同一 canonical JSON 规范**（排序键、无空白、UTF-8），否则 `pageDigest` 校验永远失败。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| M7W1 | `JS_FRAME_TYPES_PRE_V1` L34 | JS→Py 集合 | 团队帧**单独一个集合**（不混入既有，避免方向门二义） | 枚举新增 |
| M7W2 | `canonicalJson` L59 | JS/Py 一致 | 团队服务端**必须复用同一规范**（文档化） | 纪律 |
| M7W3 | `validateSemanticRecordPre` L130 | 既有字段 | 团队 `origin` 字段需**同步登记**（否则 record 校验失败） | 字段登记 |
| M7W4 | `wireModuleHygieneOk` L263 | 模块自检 | 团队新增字段后**必须仍通过**该自检 | 回归 |
| M7W5 | 新增 `assertTeamWireBudgetPre` | 无 | 团队帧预算断言（复用 M7_TRANSPORT_BUDGET_PRE_V1 L23） | 新增导出 |

#### 可直接落地的代码片段

**片段 1**：团队帧类型集合（**与既有两个集合互不相交**）。位置：`m7-wire.js:44`（帧类型常量区，`RESPONSE_TYPE_FOR_PRE_V1` 之后）。

```js
// ★ Teamwork：团队帧类型**独立成第三集合**，与既有两个方向集合互不相交。
//
// 为什么不复用（也不混入）JS_FRAME_TYPES_PRE_V1 / PY_FRAME_TYPES_PRE_V1：
//   文件头明确"帧类型两个不相交集合"是**方向门**的判据基础。
//   若把团队帧塞进 JS 集合，方向门就无法区分"发往本机 worker 的帧"
//   与"发往团队服务端的帧" ⇒ 可能出现把团队帧喂给本地 worker（协议错乱但不报错）。
// ⇒ 第三集合 + 显式的目标判定。
export const TEAM_FRAME_TYPES_PRE_V1 = Object.freeze([
  'team_index_push',      // 本机 → 团队（推送索引）
  'team_index_pull',      // 本机 → 团队（拉取索引增量）
  'team_index_ack',       // 团队 → 本机（推送回执）
  'team_index_delta',     // 团队 → 本机（增量载荷）
])

/**
 * 团队帧方向判定 —— 复用"不相交集合"的思路做**双向**判定。
 * @param {string} type 帧类型
 * @returns {{ok:boolean, direction:'out'|'in'|null, reason?:string}}
 */
export function teamFrameDirectionPre(type) {
  const t = String(type || '')
  if (t === 'team_index_push' || t === 'team_index_pull') return { ok: true, direction: 'out' }
  if (t === 'team_index_ack' || t === 'team_index_delta') return { ok: true, direction: 'in' }
  return { ok: false, direction: null, reason: 'unknown-team-frame:' + t }
}
```

**片段 2**：团队帧预算断言（新增导出）。位置：`m7-wire.js` 文件末尾。

```js
/**
 * 团队帧预算断言 —— **复用 M7_TRANSPORT_BUDGET_PRE_V1**（L23），不另立预算。
 *
 * 为什么要复用：预算的口径必须与本地传输一致，否则团队通道会成为
 * "可以发超大帧"的后门 —— 单帧过大会导致服务端截断或超时，
 * 而症状是"某次同步之后索引缺了一块"，极难定位。
 * 分页上界见 index-sync.js:31 的 INDEX_SYNC_PAGE_BUDGET_PRE_V1（64 records / 252KiB）。
 *
 * @param {object} frame
 * @returns {{ok:boolean, bytes:number, limit:number, reason?:string}}
 */
export function assertTeamWireBudgetPre(frame) {
  const b = M7_TRANSPORT_BUDGET_PRE_V1 || {}
  const limit = Number(b.maxFrameBytes) || 256 * 1024
  let bytes = -1
  try { bytes = Buffer.byteLength(canonicalJson(frame), 'utf8') } catch (_) { bytes = -1 }
  if (bytes < 0) return { ok: false, bytes: bytes, limit: limit, reason: 'not-canonicalizable' }
  if (bytes > limit) return { ok: false, bytes: bytes, limit: limit, reason: 'frame-oversize' }
  return { ok: true, bytes: bytes, limit: limit }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **序列化不一致** | 团队端自写序列化 | M7W2 纪律：必须复用 canonical 规范；否则 digest 永不匹配 |
| **方向门二义** | 团队帧混入既有集合 | 片段 1 独立第三集合 + 双向判定 |
| **新字段未登记** | 团队 origin 未进 validator | M7W3：validator 会拒 ⇒ 必须先登记再启用 |
| **单帧超预算** | 团队载荷过大 | 片段 2 复用既有预算（分页见 index-sync L31） |
| **模块卫生破坏** | 在 wire 层引入 IO | M7W4：wireModuleHygieneOk 自检会打红 |

**既有测试/守卫**：`m7-wire` 的 canonical 一致性用例、帧方向门用例、各 payload validator 用例、模块卫生自检。**两个帧类型集合的"不相交"性质很可能被断言**（文件头明文）。
