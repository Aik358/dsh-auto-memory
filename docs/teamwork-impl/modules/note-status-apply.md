
## note-status-apply

- **规模**：5,659 B / 119 行 / 4 个导出符号
- **交付形态**：**完整版**

### 职责

**结论层状态 · 条目级应用**（G3 写盘的核心纯函数）。职责：把一条 status 落到**指定 memoryId 的条目正文末尾**，返回**新文本**（不写盘）。
与 `note-status.js` 的分工：前者 = 状态行的**语法**（渲染/解析/剥离）；本模块 = 状态行的**定位与落点**（在文件里找到那条、放到末尾）。
**与既有写入通道的关系（重要）**：本模块**不代替** `memory-writer` 事务写入，只产出**新全文**。

### 数据流

```
输入：全文 + 目标 memoryId + 新状态
   │
   ▼
locateRecordBodyPre(content, memoryId)   L36
   └─ 用锚点在全文里定位该条目的正文区间
        │
        ▼
applyStatusToRecordPre(content, memoryId, status, reason)  L76
   ├─ 调 note-status.stripStatusLinePre  去掉旧状态行
   ├─ 调 note-status.withStatusLinePre   写新状态行
   └─ 返回**新全文**（不写盘）
        │
        ▼
readRecordStatusPre(content, memoryId)  L108   读取当前状态
NOTE_STATUS_MARKER_PRE_V1  L118                状态行定位标记
        │
        ▼
   新全文交给 memory-writer 的事务写入
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L36 | `locateRecordBodyPre(content, memoryId)` | 定位条目正文区间 |
| L76 | `applyStatusToRecordPre(content, memoryId, status, reason)` | 应用状态 → 新全文 |
| L108 | `readRecordStatusPre(content, memoryId)` | 读取条目状态 |
| L118 | `NOTE_STATUS_MARKER_PRE_V1` | 状态行标记 |

### 内部关键实现

**1. 职责切分：定位 vs 语法（文件头 L5-7）**

文件头逐字：*"note-status.js = 状态行的**语法**；本模块 = 状态行的**定位与落点**"*。
⇒ 团队化要改状态语法，**只改 note-status**；要改"写哪、写多少"，**只改本模块**。

**2. 只产出新全文，不写盘（文件头 L10-11）**

文件头逐字：*"本模块**不代替** memory-writer 事务写入，只产出**新全文**"*。
⇒ 这保证状态变更能与正文变更**在同一事务内提交**（否则会出现"正文改了、状态没改"的半提交）。团队化必须维持这一点：**状态更新不能走独立写路径**。

**3. locateRecordBodyPre 依赖锚点**

定位靠 memoryId 锚点 ⇒ 与 `memory-anchor.js` 的锚点契约强耦合。**memoryId 不稳定会直接导致状态写错条目**。

### 关联行号索引

- lib/note-status-apply.js:36
- lib/note-status-apply.js:76
- lib/note-status-apply.js:108

### 与团队化的关系

**判定：S3 派生重算（本模块是纯函数）+ S2 共享（产物状态）。**

理由：本模块本身是**无状态纯函数**（输入全文 → 输出新全文），不可能需要同步。但它产出的状态行是 S2：状态 + supersededBy 必须跨端一致（见 `note-status.md` 的判定）。⇒ 团队化接入点是：**状态变更后把状态行作为补丁投递**，而不是同步全文。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| NS1 | `applyStatusToRecordPre` L76 | 返回新全文 | 返回值增加结构化产物 {content, recordRange, statusLine} | 返回值增字段（需先确认调用点） |
| NS2 | `locateRecordBodyPre` L36 | 未找到语义模糊 | 明确返回 ok=false + reason，供团队回执区分"没找到"与"空操作" | 返回值结构化 |
| NS3 | 新增 `buildStatusPatchPre` | 无 | 产出团队状态补丁（**只含 memoryId + status + reason + by**，不含全文） | 新增导出 |
| NS4 | 状态补丁应用 | 无 | 复用本模块 + memory-writer 事务 | 接线 |

#### 可直接落地的代码片段

**片段 1**：状态补丁构造（新增导出，放文件末尾）。

```js
/**
 * 构造团队状态补丁 —— **只传状态，不传全文**。
 *
 * 为什么坚持只传状态：全文可能有几 KB，而一次状态变更的语义信息只有几十字节。
 * 若传全文，团队同步的载荷会随"有人点了下标记过时"而暴涨；更糟的是，
 * 传全文意味着**用 A 的整份正文覆盖 B 的**，会静默丢掉 B 的本地编辑。
 *
 * @param {string} memoryId
 * @param {string} status
 * @param {string} reason
 * @param {{actorId?:string, at?:number, baseDigest?:string, groupId?:string}} meta
 * @returns {object} 团队补丁
 */
export function buildStatusPatchPre(memoryId, status, reason, meta) {
  const m = meta || {}
  return {
    v: 1,
    entity: 'note-status',
    op: 'set-status',
    groupId: m.groupId || '',
    actorId: String(m.actorId || 'local'),
    payload: {
      memoryId: String(memoryId || ''),
      status: String(status || ''),
      reason: String(reason || '').slice(0, 200),
      // baseDigest = 本端写入前的条目指纹。对端用它判断"你我是否基于同一版本"
      baseDigest: String(m.baseDigest || ''),
    },
    at: Number(m.at) || Date.now(),
  }
}
```

**片段 2**：让 locateRecordBodyPre 返回结构化结果。位置：`note-status-apply.js:36`（函数体末尾返回处）。

```js
export function locateRecordBodyPre(content, memoryId) {
  const text = String(content == null ? '' : content)
  const id = String(memoryId || '')
  // ...原有定位逻辑...
  if (!found) {
    // ★ Teamwork：明确区分"没找到"与"找到但未变更"。
    //   团队回执若把两者混为 ok:false，会导致"补丁应用失败"与"补丁是空操作"无法区分，
    //   进而无法实现"失败重试"（重试一个空操作会无限循环）。
    return { ok: false, reason: 'record-not-found', memoryId: id, start: -1, end: -1 }
  }
  return { ok: true, memoryId: id, start: start, end: end }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **返回值形状变更打红既有调用方** | 上游按字符串消费 | NS1/NS2 需先全仓搜索调用点；本模块可能**当前无生产调用方**（同 note-status 的未接线状态）【推断】 |
| **状态更新走独立写路径** | 为图省事直接写文件 | 文件头 L10-11 明文禁止；必须经 memory-writer 事务 |
| **全量正文覆盖** | 补丁携带全文 | 片段 1 只传状态 + baseDigest |
| **memoryId 失稳** | 锚点被重写 | 依赖 memory-anchor 的身份稳定契约 |

**既有测试/守卫**：本模块的定位/应用往返用例。改动返回值形状**必须先全仓搜索调用点**（grep `applyStatusToRecordPre` / `locateRecordBodyPre`）。
