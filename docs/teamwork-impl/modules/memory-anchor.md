
## memory-anchor

- **规模**：23,358 B / 507 行 / 13 个导出符号
- **交付形态**：**完整版**

### 职责

**Anchor / Sidecar / Dry-run Planner** —— M3b-1（系统地图 M-06 契约 + `docs/M3B-CONTRACT.md` §3-§7）。**只读分析层**：解析独占行 anchor、构建/校验 sidecar、生成 dry-run 迁移计划。
**不修改任何 Markdown，不接入真实写路径**（写入事务属 M3b-2 = memory-writer）。
anchor 格式（契约 §3）：`memoryId = mem_<32 lowercase hex>`（**首次随机分配后永久稳定，禁止由内容/digest/路径/行号派生**）、`anchorId = memory:<memoryId>`、`marker = <!-- memory:<memoryId> -->`（独占一行，置于记录内容之前）。

### 数据流

```
输入：记忆 Markdown 全文（只读）
   │
   ▼
parseAnchors(content)   L119
   ├─ 逐行找 MARKER_RE（MARKER_RE L28）
   ├─ 建立 {memoryId → {heading, lineStart, lineEnd, bytes, chars, memoryId}}
   ├─ finalizeAnchored  L137   收尾锚定记录
   ├─ flushLegacy      L174    无锚点的历史内容 → legacy 块
   └─ finishLegacyBlock L233
        │
        ├──▶ buildSidecar(content, anchors)  L258   → sidecar 对象
        │        （SIDECAR_SCHEMA_VERSION L24 / SIDECAR_NAMESPACE L25）
        │
        ├──▶ parseSidecar(text)  L308   反向校验（sidecar ↔ 正文一致性）
        │
        ├──▶ planMigration(content)  L364   **dry-run**：产出迁移计划（不写盘）
        │        └─ 计划交给 memory-writer.applyMigrationPlan L84 执行
        │
        ├──▶ buildAnchoredIndex(content)  L456
        └──▶ stripAnchorLines(content)  L500   （给纯文本消费者）

newMemoryId()  L40   ← 首次分配（随机，永久稳定）
checkReservedSyntaxInContent(...) L57  ← 保留语法守卫
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L24 | `SIDECAR_SCHEMA_VERSION` | sidecar schema 版本 |
| L25 | `SIDECAR_NAMESPACE` | 命名空间 |
| L26 | `ANCHOR_PREFIX` | `memory:` |
| L27 | `MEMORY_ID_RE` | `mem_` + 32 hex 正则 |
| L28 | `MARKER_RE` | 独占行 marker 正则 |
| L34 | `MARKER_OPEN` | marker 起始串 |
| L40 | `newMemoryId()` | **随机分配稳定 memoryId** |
| L57 | `checkReservedSyntaxInContent(content)` | 保留语法守卫 |
| L119 | `parseAnchors(content)` | 解析锚点 → 锚定记录数组 |
| L258 | `buildSidecar(content, anchors)` | 构建 sidecar |
| L308 | `parseSidecar(text)` | 解析 + 校验 sidecar |
| L364 | `planMigration(content)` | **dry-run** 迁移计划 |
| L456 | `buildAnchoredIndex(content)` | 锚定索引 |
| L500 | `stripAnchorLines(content)` | 去锚点行（纯文本视图） |

### 内部关键实现

**1. memoryId 必须"随机分配后永久稳定"（契约 §3）**

文件头 L8-10 逐字：*"memoryId = mem_<32 lowercase hex>（首次随机分配后永久稳定，**禁止由内容/digest/路径/行号派生**）"*。
**理由（团队化后尤其关键）**：若 memoryId 由内容派生，则**编辑条目正文就会换 ID** ⇒ 锚点失效、引用断裂、同步补丁找不到目标。这是"身份稳定"的设计铁律。

**2. `parseAnchors` 要处理"无锚点历史内容"**

`flushLegacy L174` / `finishLegacyBlock L233`：给尚未锚定的历史条目生成 legacy 块 ⇒ 支持**渐进迁移**（不必一次性重写全部 Markdown）。

**3. `planMigration` 是 dry-run L364**

产出计划但**不写盘**，执行交给 `memory-writer.applyMigrationPlan`。⇒ 迁移可以**先预览、再执行**，这是安全迁移的前提。

**4. sidecar 双向校验 L258 / L308**

`buildSidecar` 产出、`parseSidecar` 校验 ⇒ 能检出"sidecar 与正文不一致"（例如正文被外部工具改过）。

### 关联行号索引

- lib/memory-anchor.js:40
- lib/memory-anchor.js:119
- lib/memory-anchor.js:258

### 与团队化的关系

**判定：S3 派生重算（sidecar）+ S2 共享（memoryId 契约）。**

理由：**sidecar 完全由正文派生**（锚点 + digest），不该同步 —— 各端本地重建即可，且同步会造成"sidecar 与正文版本错位"。
**但 `memoryId` 的分配规则必须成为团队契约**：它是团队内引用一条记忆的**唯一稳定标识**。若两端对同一条内容各分配一个 ID，团队引用就会分裂。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| A1 | `newMemoryId()` L40 | 纯随机 | 保持随机（**正确**），但新增**冲突登记**：团队内碰撞检测 | 新增辅助 |
| A2 | `buildSidecar` L258 | 只含本地派生信息 | 增加 `origin.actorId`（谁最后写的），但**不参与 digest** | 结构新增 |
| A3 | `parseAnchors` L119 | 返回本地记录 | 新增 `teamProjectionOfAnchorsPre`：只出 {memoryId, heading, digest} 供团队索引用 | 新增导出 |
| A4 | `planMigration` L364 | 单机计划 | 新增"团队合并计划"：把远端新 memoryId 纳入本地迁移 | 新增导出 |
| A5 | sidecar 同步 | — | **明确拒绝**：sidecar 不同步，见同步判定 | 纪律 |

#### 可直接落地的代码片段

**片段 1**：团队锚点投影（新增导出）。位置：`memory-anchor.js` 文件末尾（`stripAnchorLines` L500 之后）。

```js
/**
 * 生成可安全共享的锚点投影 —— 团队索引层只需要"这条记忆叫什么、在哪、什么版本"。
 *
 * 为什么**不含正文**：锚点投影的用途是"让其他成员知道存在这条记忆并能在需要时按 id 下钻"，
 * 正文由按需拉取（pull）解决。把正文塞进投影会让每次同步都搬运全部记忆内容。
 *
 * 为什么 digest 必须带：团队两端可能对同一 memoryId 有**不同的正文**（离线编辑冲突）。
 * 带上 digest 才能在不拉正文的情况下检出"同一 id 内容不同"。
 *
 * @param {Array} anchors parseAnchors() 的输出
 * @param {number} [limit] 单次投影条数上限（防止一次同步撑爆载荷）
 * @returns {Array<{memoryId:string, heading:string|null, digest:string, chars:number}>}
 */
export function teamProjectionOfAnchorsPre(anchors, limit) {
  const list = Array.isArray(anchors) ? anchors : []
  const cap = Number.isFinite(limit) ? Math.max(0, Number(limit)) : 2000
  const out = []
  for (const a of list) {
    if (!a || !a.memoryId) continue
    if (out.length >= cap) break
    // 注意：这里用条目**正文切片**的 digest（parseAnchors 已算出），不是整文件 digest。
    // 整文件 digest 会把"别的条目改了"也算成这条变了 ⇒ 团队端产生大量假冲突。
    out.push({
      memoryId: String(a.memoryId),
      heading: a.heading != null ? String(a.heading) : null,
      digest: String(a.recordDigest || ''),
      chars: Number(a.chars) || 0,
    })
  }
  return out
}

/**
 * 团队内 memoryId 碰撞检测。
 * 随机 32 hex 碰撞概率极低，但**低概率不等于零风险**：一旦碰撞，两条不同的记忆
 * 在团队索引里会互相覆盖，且症状是"某条记忆莫名失踪"—— 极难定位。
 * ⇒ 入组/同步时做一次显式检测，冲突则**重新分配本地那条的 id**（并记录映射）。
 *
 * @param {string[]} localIds
 * @param {string[]} remoteIds
 * @returns {{collisions:string[], ok:boolean}}
 */
export function detectMemoryIdCollisionsPre(localIds, remoteIds) {
  const remote = new Set((Array.isArray(remoteIds) ? remoteIds : []).map(String))
  const collisions = (Array.isArray(localIds) ? localIds : [])
    .map(String)
    .filter((id) => remote.has(id))
  return { ok: collisions.length === 0, collisions }
}
```

**片段 2**：让 `buildSidecar` 带上来源但**不进 digest**。位置：`memory-anchor.js:258`（`buildSidecar` 内组装返回对象处）。

```js
    // ★ Teamwork：sidecar 记录"谁最后写的"，但**绝不能纳入 digest 计算**。
    //   原因：digest 是"内容等价"的判据；若把 actorId 算进 digest，则
    //   "A 和 B 写出了逐字节相同的正文"会因 actorId 不同而被判为不一致 ⇒ 假冲突。
    //   ⇒ origin 是**旁路元数据**，只在诊断/审计面使用。
    origin: {
      actorId: String((opts && opts.actorId) || 'local'),
      at: Number((opts && opts.at) || 0) || null,
    },
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **memoryId 由内容派生** | 有人为"确定性"改成 hash(正文) | 契约 §3 明文禁止；回归须断言"改正文后 memoryId 不变" |
| **sidecar 被误纳入同步** | 团队同步框架"顺手同步该目录" | 同步白名单必须显式排除 `*.sidecar.json` |
| **整文件 digest 造成假冲突** | 用整文件 digest 当条目版本 | 片段 1 用**条目切片** digest；回归覆盖"改 A 条目后 B 条目 digest 不变" |
| **origin 进 digest** | 后续维护者把 origin 放进 digest 输入 | 片段 2 已注释；回归断言"仅改 actorId 时 digest 不变" |

**既有测试/守卫**：`memory-anchor` 的 parseAnchors / buildSidecar / planMigration 用例，以及与 `memory-writer` 的 **render→parse 幂等**联合断言。本次为纯新增导出 + 一处结构新增，预计不红。
