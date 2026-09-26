
## memory-importance

- **规模**：3,949 B / 71 行 / 4 个导出符号
- **交付形态**：**完整版**

### 职责

`memory-importance-pre` —— **evidence → importance 纯核心**（M8-2，2026-09-09；`memory_importance_pre_v1`）。
背景（M8-2 任务书）：六类证据 seen/read/cite/reuse/success/correction 已由 M5 写入（`lib/context-bridge.js:45` 枚举），消费侧聚合为 `fact-store.js:341 evidenceFor(memoryId)` → `{memoryId, total, distinctSessions, seen, read, cite, reuse, success, correction}`，但此前**只用于 M-04 技能晋升**（`procedure-store.js promote`），**从未接入记忆检索排序**。

### 数据流

```
证据聚合（fact-store.js:341 evidenceFor → 六类计数 + distinctSessions）
   │
   ▼
computeImportancePre(agg)   L48
   ├─ num0 / clamp01  L39 / L40   数值护栏
   ├─ neutral 判据：total === 0 && distinctSessions === 0
   │     → importance = IMPORTANCE_NEUTRAL_PRE_V1(0.5)  L29   中性（不置顶不垫底）
   ├─ correctionRate = total > 0 ? correction / total : 0
   │     ★ 口径**逐字复用** procedure-store.js:268-269，禁止另立
   ├─ diversity    = min(1, distinctSessions / w.diversityDivisor)
   ├─ successReuse = min(1, (success + reuse) / w.successReuseDivisor)
   ├─ pos = 0.5*diversity + 0.5*successReuse
   └─ importance = clamp01(0.5 + w.posGain*pos - w.negGain*correctionRate)
        │
        ▼
   IMPORTANCE_WEIGHTS_PRE_V1  L32
        │
        ▼
   作为 recall() L0 融合的加权因子之一（P8 融合入口）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L26 | `MEMORY_IMPORTANCE_VERSION` | 版本常量 |
| L29 | `IMPORTANCE_NEUTRAL_PRE_V1` | 中性值 0.5 |
| L32 | `IMPORTANCE_WEIGHTS_PRE_V1` | 权重（posGain / negGain / diversityDivisor / successReuseDivisor） |
| L48 | `computeImportancePre(agg)` | **主函数**：证据聚合 → importance |

返回：`{importance, correctionRate, neutral, total}`。

### 内部关键实现

**1. 中性值 0.5 —— "既不置顶也不垫底"**

无任何证据 ⇒ `importance = 0.5`（L29）。⇒ **新记忆不会被系统性埋没**，也不会凭空冒到最前。这是"冷启动公平性"的设计。

**2. correctionRate 口径禁止另立（文件头"口径纪律（禁止项）"）**

文件头逐字：*"correctionRate **逐字复用** procedure-store.js:268-269 的口径 —— total = seen+read+cite+reuse+success+correction；correctionRate = total > 0 ? correction / total : 0。**不另立纠正口径**"*。

**3. 权重集中在一个冻结常量 L32**

`IMPORTANCE_WEIGHTS_PRE_V1` 让调参有唯一入口 —— 符合本仓"唯一真源"的反复强调。

**4. 与 recall-stats 的分步走形成对照**

用户既有裁定："加权是**会自我强化**的机制……在埋点口径未被真实数据检验之前就加权，会把口径错误放大成系统性偏差"（见 `recall-stats.js`）。
⇒ **本模块是"已接入排序的加权"，而 recall-stats 是"只记录不加权"**。团队化引入**新的权重来源**（如团队热度）时，必须走 recall-stats 的**先记录后加权**路径，**不得**直接加进 L32。

### 与团队化的关系

**判定：S3 派生重算（纯派生）。**

理由：importance 完全由证据计数派生，**同步它没有意义**（同步聚合输入反而更小）。但团队化会**改变聚合输入本身**：
- `distinctSessions` 在单机上是"我用了几个会话"，团队共享后应变成"**团队**用了几个会话"
- 因此 `computeImportancePre` 的**输入契约**需要扩展，而不是函数本身要同步。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| I1 | `computeImportancePre` L48 | 输入来自本地聚合 | 输入**兼容**团队聚合（字段名不变，值来自多端合并） | **函数体零改动** |
| I2 | `IMPORTANCE_WEIGHTS_PRE_V1` L32 | 固定权重 | **不改默认值**；新增可选的团队权重覆盖（独立开关） | 新增配置 |
| I3 | 团队证据合并 | 无 | 需要"按 actorId 去重的会话数"（见 evidence-agg / procedure-store 的同款问题） | 上游改造 |
| I4 | 权重引入纪律 | 无 | 团队新权重必须先"只记录不加权"（沿用 recall-stats 分步走） | 纪律 |

#### 可直接落地的代码片段

**片段 1**：团队权重覆盖（**默认不改变行为**）。位置：`memory-importance.js:48`（`computeImportancePre` 内取权重处）。

```js
export function computeImportancePre(agg, opts) {
  const a = agg || {}
  const o = opts || {}
  // ★ Teamwork：团队权重是**可选的第二来源**，缺省完全走 IMPORTANCE_WEIGHTS_PRE_V1。
  //   为什么不能直接改 L32 的默认值：用户硬规则「单一开关不得顺带改变其他功能的行为」
  //   —— 开启团队版不得改变单机用户的 importance 分布。
  //   且按 recall-stats 的既定纪律（先记录、验证口径、再加权），团队权重
  //   应默认**只计算不影响排序**（shadow），确认无误后再由用户显式启用。
  const w = (o.teamWeights && typeof o.teamWeights === 'object')
    ? Object.assign({}, IMPORTANCE_WEIGHTS_PRE_V1, o.teamWeights)
    : IMPORTANCE_WEIGHTS_PRE_V1
  // ...原有公式，把 IMPORTANCE_WEIGHTS_PRE_V1 的引用替换为 w...
  const diversity = Math.min(1, (Number(a.distinctSessions) || 0) / w.diversityDivisor)
  const successReuse = Math.min(1, ((Number(a.success) || 0) + (Number(a.reuse) || 0)) / w.successReuseDivisor)
  const total = (Number(a.seen) || 0) + (Number(a.read) || 0) + (Number(a.cite) || 0)
    + (Number(a.reuse) || 0) + (Number(a.success) || 0) + (Number(a.correction) || 0)
  if (total === 0 && (Number(a.distinctSessions) || 0) === 0) {
    return { importance: IMPORTANCE_NEUTRAL_PRE_V1, correctionRate: 0, neutral: true, total: 0 }
  }
  // correctionRate 口径与 procedure-store.js:268-269 逐字一致（禁止另立）
  const correctionRate = total > 0 ? (Number(a.correction) || 0) / total : 0
  const pos = 0.5 * diversity + 0.5 * successReuse
  const importance = clamp01(IMPORTANCE_NEUTRAL_PRE_V1 + w.posGain * pos - w.negGain * correctionRate)
  return { importance, correctionRate, neutral: false, total }
}
```

**片段 2**：团队会话多样性去重（**关键**，与 procedure-store 同款问题的统一解法）。位置：`memory-importance.js` 文件末尾新增导出。

```js
/**
 * 计算团队的 distinctSessions —— **必须按 actorId 复合去重**。
 *
 * 为什么：evidence.sessions 在单机上是"本地会话数"。团队合并后若直接相加，
 * 同一个人的同一会话在 A/B 两端各存一份就会**重复计数** ⇒ diversity 虚高 ⇒
 * 一条其实只有 1 个人用过的记忆会被判为"跨 3 个独立会话验证"。
 * 这与 procedure-store.js 的 _sessions 去重是**同一个问题**，两处必须用同一套键规则。
 *
 * @param {Array<{actorId?:string, sessionRef:string}>} rows 多端汇总的证据行
 * @returns {number} 去重后的会话数
 */
export function distinctTeamSessionsPre(rows) {
  const set = new Set()
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || !r.sessionRef) continue
    const actor = String(r.actorId || '')
    // 兼容：旧数据无 actorId ⇒ 退化为裸 sessionRef（与改造前语义一致）
    set.add(actor ? (actor + ':' + String(r.sessionRef)) : String(r.sessionRef))
  }
  return set.size
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **diversity 被稀释/虚高** | 团队会话未按 actor 去重 | 片段 2；与 procedure-store 用**同一套键规则** |
| **默认权重被改** | 顺手调 L32 | 片段 1 只在显式传 teamWeights 时覆盖 |
| **过早加权** | 团队热度直接进排序 | I4 纪律（先记录、后加权）；对照 recall-stats 的既有裁定 |
| **口径分叉** | 团队场景另写一套 correctionRate | 文件头"禁止项"；复用同一式 |

**既有测试/守卫**：本模块用例（neutral=0.5、correctionRate 口径、clamp 边界）。片段 1 把常量引用换成变量 w（缺省等于原常量）⇒ **数值输出逐字节不变**，预计不红。
