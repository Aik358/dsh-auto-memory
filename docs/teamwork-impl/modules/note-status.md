
## note-status

- **规模**：10,336 B / 205 行 / 9 个导出符号
- **交付形态**：**完整版**

### 职责

**结论层状态（G3）· 纯函数核心** —— 零 IO、零副作用、可单测。
状态：**形态候选，未接线**（2026-09-19）。本模块只提供**判定与格式**能力，**没有任何调用方**，因此不产生任何写入。写盘接线必须等 `G3-DISK-FORMAT-GAP-20260919.md` 的 **F1/F2 拍板**（F1 = 状态行的磁盘语法；F2 = 「显式声明取代」的模型侧写法）。
**理由（误判代价不对称）**：漏判 = 维持现状（可接受）；**误判 = 有效结论被当废纸**。

### 数据流

```
条目正文（记忆条目的 Markdown 片段）
   │
   ├─ renderStatusLinePre(...)   L67   → 渲染状态行（语法）
   ├─ parseStatusLinePre(text)   L89   → 解析状态行
   ├─ statusOfBodyPre(body)      L121  → 取条目当前状态
   ├─ stripStatusLinePre(body)   L141  → 剥离状态行（回正文）
   ├─ withStatusLinePre(body, s) L168  → 替换/追加状态行
   └─ detectSupersedeIntentPre(text) L191  → 检测「显式声明取代」的模型侧写法
        │
        ▼
   状态值 ∈ NOTE_STATUSES_PRE_V1  L52
   缺省 = NOTE_STATUS_OPEN_PRE_V1  L32
   reason 截断 = NOTE_STATUS_REASON_MAX_PRE_V1  L55
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L32 | `NOTE_STATUS_OPEN_PRE_V1` | 缺省 open 状态常量 |
| L52 | `NOTE_STATUSES_PRE_V1` | **封闭状态枚举** |
| L55 | `NOTE_STATUS_REASON_MAX_PRE_V1` | reason 长度上限 |
| L67 | `renderStatusLinePre(status, reason)` | 渲染状态行 |
| L89 | `parseStatusLinePre(text)` | 解析状态行 |
| L121 | `statusOfBodyPre(body)` | 取条目状态 |
| L141 | `stripStatusLinePre(body)` | 剥离状态行 |
| L168 | `withStatusLinePre(body, status, ...)` | 写入/替换状态行 |
| L191 | `detectSupersedeIntentPre(text)` | 检测取代意图 |

### 内部关键实现

**1. 误判代价不对称（文件头 L10-12）**

文件头逐字：*"漏判 = 维持现状（可接受）；**误判 = 有效结论被当废纸**"*。
这是一条**判定策略铁律**：状态判定必须**保守**（宁可标 open 也不误标 superseded）。团队化会显著增加状态变更的来源（他人取代了你的结论），这条纪律更重要。

**2. 用户裁定：superseded 的可见后果 = 「返回但标记」**

用户明确裁定：**不剔除、不降权**，检索命中作废条目时**照常返回**，但必须显式标注它已过时、并指出最新结论在哪（`supersededBy` 指针）。本模块的状态判定直接服务这条产品语义。

**3. 未接线是显式状态**

文件头把这个模块标为"形态候选、未接线"，并写明**接线的前置条件**（F1/F2 拍板）。团队化若想用它的状态语义，**必须先把 F1/F2 拍板**。

### 关联行号索引

- lib/note-status.js:52
- lib/note-status.js:67
- lib/note-status.js:168

### 与团队化的关系

**判定：S2 团队共享（状态语义必须全队一致）。**

理由：若 A 端把某条结论标为 `superseded`、B 端仍视为 `current`，两个成员会得到**相反的行为**（一个标记过时、一个正常使用）⇒ 团队认知分裂。状态 + supersededBy 指针必须同步，且带上"判定依据"（reason）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| N1 | `renderStatusLinePre` L67 | 本地语法 | 状态行增加**可选**来源段（谁判定的） | 语法扩展，须 F1 拍板 |
| N2 | `parseStatusLinePre` L89 | 解析本地格式 | 容忍/解析来源段；缺失即无归属（向后兼容） | 同上 |
| N3 | `statusOfBodyPre` L121 | 只返回状态 | 增加"被谁取代"信息出口 | 返回值增字段 |
| N4 | 团队状态合并 | 无 | 新增 `mergeStatusPre`：**保守合并** | 新增导出 |
| N5 | F1/F2 前置 | 未接线 | 团队化不得先于 F1/F2 拍板接线 | 纪律 |

#### 可直接落地的代码片段

**片段 1**：保守状态合并（新增导出，放文件末尾）。这是团队化最关键的一段。

```js
/**
 * 合并两端对同一条目的状态判定 —— **保守（conservative）优先**。
 *
 * 为什么保守合并是正确的：
 *   文件头已定判据「漏判 = 维持现状（可接受）；误判 = 有效结论被当废纸」。
 *   两端分歧时的两种选法：
 *     · 选 open       ⇒ 若对方其实是对的，则继续用一个已作废结论（误判，代价高）
 *     · 选 superseded ⇒ 若己方其实是对的，则结论被标过时但仍会被返回（漏判，代价低）
 *   ⇒ 分歧时取**更保守**的那一端（非 open 优先于 open）。
 *
 * 为什么保留两方 reason：团队场景下"谁为什么判它过时"是审计信息；
 * 覆盖掉会让裁决无法回溯。
 *
 * @param {{status?:string, reason?:string, by?:string}} a
 * @param {{status?:string, reason?:string, by?:string}} b
 * @returns {{status:string, reason:string, by:string, sources:Array}}
 */
export function mergeStatusPre(a, b) {
  const norm = (x) => ({
    status: String((x && x.status) || NOTE_STATUS_OPEN_PRE_V1),
    reason: String((x && x.reason) || '').slice(0, NOTE_STATUS_REASON_MAX_PRE_V1),
    by: String((x && x.by) || 'unknown'),
  })
  const A = norm(a), B2 = norm(b)
  const isOpen = (s) => s === NOTE_STATUS_OPEN_PRE_V1
  if (isOpen(A.status) && isOpen(B2.status)) {
    return { status: NOTE_STATUS_OPEN_PRE_V1, reason: '', by: '', sources: [A, B2] }
  }
  // 至少一端非 open ⇒ 取非 open 的那一端（两端都非 open 时取 A 的状态，但合并 reason）
  const winner = !isOpen(A.status) ? A : B2
  const other = winner === A ? B2 : A
  const reasonParts = [winner.reason, other.reason].filter(Boolean)
  return {
    status: winner.status,
    reason: reasonParts.join(' | ').slice(0, NOTE_STATUS_REASON_MAX_PRE_V1),
    by: winner.by,
    sources: [A, B2],
  }
}
```

**片段 2**：状态行的来源标注。位置：`note-status.js:67`（`renderStatusLinePre` 内拼装返回串处）。

```js
export function renderStatusLinePre(status, reason, opts) {
  const s = String(status || NOTE_STATUS_OPEN_PRE_V1)
  const r = String(reason || '').slice(0, NOTE_STATUS_REASON_MAX_PRE_V1)
  // ★ Teamwork：可选来源标注 by:<actorId>，附在 reason 之后。
  //   为什么可选：F1（磁盘语法）尚未拍板，强制写入会绑定一个未定的语法。
  //   缺省（不传 opts.by）⇒ 输出与改造前逐字节一致，零破坏。
  const by = (opts && opts.by) ? String(opts.by).replace(/[\s|]+/g, '_').slice(0, 64) : ''
  const tail = by ? (r ? (r + ' | by:' + by) : ('by:' + by)) : r
  // ...原有拼装逻辑，使用 tail 替代裸 reason...
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **越过 F1/F2 拍板** | 团队化直接接线写盘 | 文件头明文前置条件；N5 列为纪律 |
| **非保守合并** | 分歧时取 open | 片段 1 显式推导保守性；回归覆盖"一端 superseded、一端 open" |
| **reason 被覆盖** | 只保留胜者 reason | 片段 1 合并两方并保留 sources |
| **语法扩展破坏解析** | 来源段与既有 reason 冲突 | 片段 2 用分隔符 + 字符清洗；回归覆盖"reason 含 by:" |

**既有测试/守卫**：`note-status` 的渲染/解析往返用例、状态枚举断言。本模块**当前无调用方**，改动不影响运行路径，但会让后续接线承担语法债。
