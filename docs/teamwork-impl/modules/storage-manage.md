## storage-manage

- **规模**：12,177 B / 231 行 / 3 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**M10 存储管理**：把三个原语组装成可用动作 —— ①删除一条记忆 = `docStore.replace`（原子事务，省略锚定 ID 即删除）+ `activationHost.purgeMemory`（在途激活包级联清理）+ `factStore.revokeBySource`（派生事实级联失效）；②语料健康扫描 = sidecar ↔ 正文 `fileDigest` 比对，stale 自动 `rebuildSidecar`；③管理动作审计（有界 64 条最小投影，只记 sourceRef/原因、**不记正文**）。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L22 | `STORAGE_MANAGE_VERSION_PRE_V1` | 版本常量 |
| L26 | `REPAIRABLE_REASONS_PRE_V1` | 可自动修复的 stale 原因枚举 |
| L28 | `createStorageManagerPre(...)` | 管理器工厂 |

### 数据流

```
① 删除一条记忆（原子事务）
   本模块 ──▶ docStore.replace(原子事务, 省略锚定 ID = 删除)
              + activationHost.purgeMemory(...)     ← 在途激活包级联清理
              + factStore.revokeBySource(...)       ← 派生事实级联失效
   （revokeBySource 见 fact-store.js:567）

② 语料健康扫描
   逐源 sidecar ──▶ 与正文 fileDigest 比对
        ├─ 一致 → 跳过
        └─ stale 且 reason ∈ REPAIRABLE_REASONS_PRE_V1  L26
             └─▶ rebuildSidecar（**只重建 sidecar，不动正文**，零风险）

③ 管理动作审计
   有界 64 条**最小投影**：只记 sourceRef / 原因，**不记正文**
```

### 内部关键实现

**1. 三个原语此前"都已就绪但零组装"**

文件头 L4 明确：*"原语此前都已就绪但零组装，本模块把三个接线点装起来"*。这是本仓常见的形态 —— 能力有了但没有编排层，导致功能"存在但不可用"。

**2. "只重建 sidecar，不动正文"是安全边界**

stale 自动修复**只作用于 sidecar**（派生索引），绝不改正文（用户数据）。这保证自动修复**永远不可能丢用户内容**，是"可自动修复"这一承诺成立的前提。

**3. 审计只记最小投影**

有界 64 条 + 只记 sourceRef/原因 ⇒ 审计面本身**不泄露正文**。这一点在团队化下会变成**必需**（审计会跨成员可见）。

### 可直接落地的代码片段

**插入位置**：storage-manage.js:28 附近的 `createStorageManagerPre`。

```js
/**
 * 团队删除广播（tombstone）—— **删除必须让其他成员知道**。
 *
 * 为什么这是团队化最易漏的一致性缺口：
 *   本地删除后若不发 tombstone，其他成员的本地副本仍在；
 *   下一次任何一端的同步都会把这条"复活"回来（因为对方手里还有它）。
 *   症状是"删了又回来"，且用户会以为是插件坏了。
 *
 * @param {object} store 记忆存储（提供 memoryId 列表）
 * @param {string[]} removedIds 本次删除的 memoryId
 * @param {{groupId:string, actorId:string, at?:number}} meta
 * @returns {Array<object>} tombstone 补丁数组
 */
export function buildTombstonesPre(removedIds, meta) {
  const m = meta || {}
  return (Array.isArray(removedIds) ? removedIds : [])
    .filter((id) => id)
    .map((id) => ({
      v: 1,
      entity: 'memory-doc',
      op: 'tombstone',
      groupId: String(m.groupId || ''),
      actorId: String(m.actorId || 'local'),
      payload: { memoryId: String(id) },
      at: Number(m.at) || Date.now(),
    }))
}
```

### 与团队化的关系

**判定：团队共享（Shared）· 含审计。**

团队化后"删除一条记忆"变成**治理动作**：谁删的、为什么删、影响谁，都必须留痕。本模块已有的"有界 64 条最小投影审计"正好是团队治理的雏形，但需要补 `actorId`。

### Teamwork 改造要点

1. **删除必须广播**：本地删除一条共享记忆时，必须向团队发出 `tombstone` 补丁，否则其他成员的本地副本会在下次同步"复活"这条记忆。**这是团队化最容易被忽略的一致性缺口**【推断】。
2. **审计补 `actorId` + `opts.reason` 必填**：当前审计只记 sourceRef/原因，团队治理需要知道**是谁**。
3. **级联清理走同一入口**：`purgeMemory` + `revokeBySource` 的级联链在团队场景下要延伸到"撤销其他成员端的派生事实"，否则会残留悬空引用。

### 风险与回归

- 回归：审计有界（64 条）——团队化后条数会暴涨，需评估上限是否仍合理。
- `REPAIRABLE_REASONS_PRE_V1` 是枚举：新增 stale 原因必须同步测试。
