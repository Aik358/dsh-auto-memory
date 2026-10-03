## recall-stats

- **规模**：12,283 B / 278 行 / 3 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**召回统计 —— 只记录、不参与排序**。用户 2026-09-22 拍板分步走：加权是**会自我强化**的机制（召回越多→权重越高→越容易被召回），在埋点口径未被真实数据检验前就加权会把口径错误放大成系统性偏差。所以本模块只累积计数并落盘，`recall()` 的排序与返回**逐字节不变**。三条通路**分账**（channel 不同，含义完全不同）。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L25 | `RECALL_STATS_VERSION_PRE` | 版本常量 |
| L28 | `RECALL_CHANNELS_PRE` | 三条通路枚举（**分账**） |
| L50 | `createRecallStatsPre(...)` | 统计工厂 |

### 数据流

```
recall() 三条通路各自调用埋点：
   channel ∈ RECALL_CHANNELS_PRE  L28
        │
        ▼
   createRecallStatsPre(...)  L50   ← **只累积计数、只落盘**
        ├─ 落盘：固定名 tmp（后缀 .tmp）   L123  ← ⚠️ 见风险
        └─ 失败清理：rmSync(同路径)  L129
        │
        ▼
   ~/.dsh/memory/recall-stats.json
        │
        ▼
   仅用于观测/诊断 —— **不进排序、不进返回**
```

### 内部关键实现

**1. 为什么"只记录不排序"（用户 2026-09-22 拍板的分步走）**

文件头逐字：*"加权是**会自我强化**的机制（召回越多 → 权重越高 → 越容易被召回）。在埋点口径未被真实数据检验之前就加权，会把口径错误放大成系统性偏差。所以本模块**只累积计数并落盘**，recall() 的排序与返回**逐字节不变**"*。
守卫断言：**本模块的调用不改任何排序输入**。

**2. 三条通路分账（不混为一谈）**

文件头逐字：*"同一个「召回」在三条通路里的含义完全不同，合成一个数会误导判断"*。表格列出 channel / 含义 / 语义 / 用来判断什么 四列。⇒ **任何聚合都必须按 channel 分别求和**。

**3. 固定名 tmp 是已确认缺陷 L123**

L123 用目标文件名直接拼后缀生成临时文件 —— 与 `config-io.js` 曾以 issue #82 修过的缺陷**同型**，也与用户既有判据一致："固定名临时文件属同型缺陷第三次出现；原子写临时文件名必须带 pid + 序号"。

### 可直接落地的代码片段

**插入位置**：recall-stats.js:50 附近的 `createRecallStatsPre`。

```js
/**
 * 团队召回统计 —— **按 channel 分账聚合，且只记录不加权**。
 *
 * 两条既有纪律必须同时遵守：
 *   ① channel 分账：文件头明确"同一个「召回」在三条通路里的含义完全不同，
 *      合成一个数会误导判断" ⇒ 团队聚合必须按 channel 分别求和。
 *   ② 先记录后加权：用户 2026-09-22 拍板"加权是会自我强化的机制，
 *      在埋点口径未被真实数据检验之前就加权，会把口径错误放大成系统性偏差"。
 *
 * @param {Array<object>} snapshots 各端的 recall-stats 快照
 * @returns {{byChannel:object, total:number, members:number}}
 */
export function aggregateTeamRecallStatsPre(snapshots) {
  const list = Array.isArray(snapshots) ? snapshots : []
  const byChannel = Object.create(null)
  let total = 0
  const members = new Set()
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    if (s.actorId) members.add(String(s.actorId))
    const ch = (s.byChannel && typeof s.byChannel === 'object') ? s.byChannel : {}
    for (const k of Object.keys(ch)) {
      const n = Number(ch[k]) || 0
      byChannel[k] = (byChannel[k] || 0) + n
      total += n
    }
  }
  return { byChannel, total, members: members.size }
}
```

### 与团队化的关系

**判定：团队共享（Shared）· 聚合指标。**

**这是团队化最有价值的观测层**：单机召回统计只反映一个人；团队聚合后能看到"这个知识在团队里被召回 N 次" ⇒ 天然的共享价值排序证据。**但**必须沿用"先只记录、不加权"的分步走纪律。

### Teamwork 改造要点

1. **团队聚合必须先于加权**：先收集多端计数、验证口径（三条通路在团队场景是否仍可分账），**确认无误后再讨论加权**。不得跳过验证直接加团队权重。
2. **channel 分账不得合并**：注释明确"同一个『召回』在三条通路里的含义完全不同，合成一个数会误导判断"。团队聚合必须按 channel 分别求和。
3. **落盘是追加式**：注意 `L123` 的 `tmp = f + '.tmp'` 是**固定名临时文件**——同一缺陷类第三次出现。团队化提高并发后这里会撞车，**必须改为带 pid + 序号**。

### 风险与回归

- 回归：守卫断言"本模块的调用不改任何排序输入"——团队聚合若被接进排序路径会直接打红这条守卫。
- `RECALL_CHANNELS_PRE` 是封闭枚举，新增团队 channel 必须同步测试。
- `recall-stats.js:123` 的固定 `.tmp` 是**已确认缺陷**，与 `config-io.js` 修复过的 issue #82 同型。
