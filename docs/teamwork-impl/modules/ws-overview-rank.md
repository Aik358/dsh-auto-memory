## ws-overview-rank

- **规模**：2,126 B / 41 行 / 1 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**M10 工作区总览采样排序**（issue #24）。`workspaceOverview` 对 `discoverWorkspaces()` 结果做 `slice(0,8)` 字母序取样，而字母序靠前常被临时工作区占据（实测字母序前 24 位全是无记忆目录）⇒ 真正带记忆的活跃工作区排在 20 位开外，**永远进不了跨工作区总结** ⇒ 面板显示"今日工作 0 条日志"。修复：按最新日志文件 mtime 降序。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L26 | `rankWorkspacesByMemoryRecencyPre(...)` | 按最新日志 mtime 降序排序（恒返回全部 cwd，截尾由调用方决定） |

### 数据流

```
discoverWorkspaces()  →  [cwd1, cwd2, ...]
        │
        ▼
  rankWorkspacesByMemoryRecencyPre(list, io)   L26
        ├─ 对每个 cwd 取「最新日志文件 mtime」→ latest
        ├─ 按 latest 降序排序
        │    ├─ latest = 0（无记忆工作区）自然沉底
        │    └─ 同分保持原字母序（sort 稳定）
        └─ **恒返回全部 cwd**（不截尾）
        │
        ▼
  调用方 slice(0,8)  ← 截尾由调用方决定
        │
        ▼
  workspaceOverview → 跨工作区总结 / 面板「今日工作」
```

### 内部关键实现

**1. 病症（issue #24 实测）**

`workspaceOverview` 对 `discoverWorkspaces()` 结果做 `slice(0, 8)` **字母序**取样，而会话目录字母序靠前的位置常被**临时/一次性工作区**占据（`ppt_build`、`jobs-issue-*` 等）。
**实测：字母序前 24 位全是无记忆目录** ⇒ 真正带记忆的活跃工作区排在 **20 位开外**，永远进不了跨工作区总结 ⇒ 面板显示**「今日工作 0 条日志」**。

**2. 为什么用"最新日志文件 mtime"**

它是"这个工作区是否活跃"的**低成本代理指标**（不需要解析内容），且单调、可比、天然区分"有记忆"与"无记忆"。

**3. 纯函数 + IO 注入**

IO 全部注入 ⇒ 可回归锁定（用假目录树直接断言排序结果）。

### 可直接落地的代码片段

**插入位置**：ws-overview-rank.js:26 附近的 `rankWorkspacesByMemoryRecencyPre`。

```js
/**
 * 团队工作区总览 —— **聚合多端结果后再排序**，不是同步排序结果。
 *
 * 为什么排序结果不能同步：各端的工作区集合不同（成员各自的机器上只有自己的目录），
 * 排序结果不具可比性；而且排序是纯函数、重算成本极低。
 * ⇒ 正确做法是各端算各自的，再由团队视图 concat 后统一排序。
 *
 * @param {Array<{workspaceKey:string, latest:number, memberCount?:number}>} rows 多端汇总
 * @returns {Array} 稳定排序后的数组（同分保持输入序）
 */
export function rankTeamWorkspacesPre(rows) {
  const list = Array.isArray(rows) ? rows.slice() : []
  // 团队口径：优先"参与成员数"，其次"最近活跃时间" —— 多人用同一个工作区比单人活跃更值得展示
  const keyOf = (x) => {
    const members = Number(x && x.memberCount) || 0
    const latest = Number(x && x.latest) || 0
    return members > 0 ? (1e15 + members) : latest
  }
  return list
    .map((x, i) => ({ x: x, i: i, k: keyOf(x) }))
    .sort((a, b) => (b.k - a.k) || (a.i - b.i))   // 同分保持原序（sort 稳定）
    .map((r) => r.x)
}
```

### 关联行号索引

- lib/ws-overview-rank.js:26

### 与团队化的关系

**判定：派生重算（Derived）· 纯函数。**

排序结果完全由本地文件 mtime 派生，各端算各自的。团队化后若做"团队工作区总览"，需要按 groupId 聚合多端结果——但那时是**聚合排序**，不是同步排序结果。

### Teamwork 改造要点

1. **团队总览需要二次聚合**：本函数只排序单机结果。团队视图应 `concat` 各端结果后再排序，**不要**把排序结果当同步对象。
2. **保持纯函数**：IO 全部注入是它能被回归锁定的原因。团队化不得在这里引入网络读取。
3. **活跃度口径可升级为团队口径**：当前用本地日志 mtime；团队场景可用"团队内最近一次相关活动"，但那属于**新函数**，不应改本函数语义。

### 风险与回归

- 回归：注释明确"同分保持原字母序（sort 稳定）"与"恒返回全部 cwd"两条性质，改动不得破坏。
- 无记忆工作区（latest=0）必须自然沉底——这是修复的核心行为。
