
## memory-envelope

- **规模**：14,987 B / 258 行 / 6 个导出符号
- **交付形态**：**完整版**

### 职责

**记忆注入信封 · 分项账本**（`memory_envelope_pre_v1`）—— 契约 T0-3 / 总纲 §0.5 第 6 条。
把"最终注入给模型的记忆文本"拆成**带优先级的若干桶**，按桶分配字符预算，保证**总长可控且裁剪可见**。

### 数据流

```
各来源片段（目录层 / 常驻层 / 下探层 / 降级说明 …）
   │
   ▼
composeMemoryEnvelopePre(parts, opts)   L91
   ├─ normalizePriority  L55     优先级归一
   ├─ clean              L72     清洗
   ├─ 按 ENVELOPE_BUCKETS_PRE_V1  L40 分桶
   │    （桶文本模板 ENVELOPE_BUCKET_TEXT_PRE_V1 L58）
   ├─ limitOf  L119              每桶上限（按 ENVELOPE_PRIORITIES_PRE_V1 L53）
   ├─ rankOf   L141              桶内排序
   ├─ bucketTotal L142           桶小计
   └─ enforceLimit L151          ★ 总长门
        │
        ▼
   注入文本 + describeEnvelopeCharsPre(...) L253   ← 分项账本（哪个桶占了多少字符、裁了多少）
        │
        ▼
   ENVELOPE_REASONS_PRE_V1 L65   裁剪原因码
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L37 | `MEMORY_ENVELOPE_VERSION` | 版本常量 |
| L40 | `ENVELOPE_BUCKETS_PRE_V1` | **封闭桶枚举** |
| L53 | `ENVELOPE_PRIORITIES_PRE_V1` | 优先级枚举 |
| L58 | `ENVELOPE_BUCKET_TEXT_PRE_V1` | 桶文案模板 |
| L65 | `ENVELOPE_REASONS_PRE_V1` | 裁剪原因码枚举 |
| L91 | `composeMemoryEnvelopePre(parts, opts)` | **主编排** |
| L253 | `describeEnvelopeCharsPre(env)` | 分项账本 |

### 内部关键实现

**1. 它修的是两处实测缺陷（文件头 L8-16，读码确认，不是推测）**

| 缺陷 | 位置 | 表现 |
|---|---|---|
| ① 总长门只裁"下探段" | `tier-layer-inject.js:327-335`（旧行号） | `headParts`（目录 + 降级行）**从不动**；而且降级说明是**在裁剪之后**才追加 ⇒ 最终长度可以**超过** `maxTotalChars` |
| ② `catalogCost` 被硬封顶 | `lib/index.js`（`renderMemoryDynamic`） | `Math.min(…, budget*0.35)` 封顶 ⇒ 目录层永远拿不到它该有的预算 |

**2. `enforceLimit` L151 是核心总长门**

把"按桶裁剪"集中到一处，并且**裁剪必须可见**（`ENVELOPE_REASONS_PRE_V1` 记录为什么裁）。⇒ 直接回应了缺陷①"降级说明在裁剪之后追加导致超长"的根因：**所有追加都必须经过同一个长度门**。

**3. `describeEnvelopeCharsPre` L253 = 分项账本**

回答"这轮注入的 N 个字符分别来自哪个桶、被裁了多少"。在团队化下这非常关键：**团队记忆会显著增加注入体量**，账本是判断"是不是同步太多"的唯一依据。

### 与团队化的关系

**判定：S3 派生重算（完全本地）。**

理由：信封是"本轮往模型上下文塞什么"的**运行时装配结果**，完全由当轮的命中与预算决定 ⇒ 不可能也不应该同步。
**但它的账本有团队价值**：多端汇总"团队记忆平均每轮注入多少字符"能直接回答产品问题"团队版是否撑爆上下文"。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| E1 | `ENVELOPE_BUCKETS_PRE_V1` L40 | 本地桶集合 | **新增 `team` 桶**：团队共享记忆单独一桶，**独立预算** | 封闭枚举新增项 |
| E2 | `ENVELOPE_PRIORITIES_PRE_V1` L53 | 优先级枚举 | 给 `team` 桶定优先级（建议**低于**本机规则层、高于普通参考） | 同上 |
| E3 | `composeMemoryEnvelopePre` L91 | 只用本地 parts | 支持 `parts[].origin='team'` 自动归入 team 桶 | 兼容（无 origin ⇒ 老行为） |
| E4 | `describeEnvelopeCharsPre` L253 | 本地账本 | 增加 `byOrigin`（local vs team 字符占比） | 结构新增 |
| E5 | 团队预算上限 | 无 | 新增 `opts.teamBudgetRatio`（**独立开关**，不得顺带改本地预算） | 新增配置 |

#### 可直接落地的代码片段

**片段 1**：新增 `team` 桶与独立预算。位置：`memory-envelope.js:40`（`ENVELOPE_BUCKETS_PRE_V1` 定义处）。

```js
// ★ Teamwork：新增 team 桶 —— 团队共享记忆**独立成桶、独立预算**。
//   为什么不并进既有桶：用户硬规则「单一开关不得顺带改变其他功能的行为」。
//   若把团队记忆混进既有桶，则"开启团队版"会顺带挤压本机记忆的预算 ⇒ 违反该规则。
//   ⇒ 独立桶 + 独立预算，两者互不侵占。
export const ENVELOPE_BUCKETS_PRE_V1 = Object.freeze([
  'head',        // 目录 + 降级说明（从不动的那部分）
  'resident',    // 常驻层
  'tier1',       // 闸门下探层
  'tier2',       // 按需下探层
  'team',        // ★ 团队共享记忆（独立预算）
])
```

**片段 2**：独立预算计算。位置：`memory-envelope.js:119`（`limitOf` 函数内）。

```js
  function limitOf(bucket, budget) {
    const b = Number(budget) || 0
    // ★ Teamwork：team 桶走**独立预算**，不参与既有桶的分配比例。
    //   teamBudgetRatio 缺省 0 ⇒ 新用户装完**行为与改造前逐字节一致**（零破坏）。
    //   显式开启团队版时才占用预算，且**上限封顶**防止团队记忆淹没本机记忆。
    if (bucket === 'team') {
      const ratio = Number(opts && opts.teamBudgetRatio)
      if (!Number.isFinite(ratio) || ratio <= 0) return 0
      return Math.floor(b * Math.min(0.5, ratio))   // 硬顶 50%：本机记忆永远保有一半以上
    }
    // ...原有各桶逻辑不变...
  }
```

**片段 3**：按 origin 分账（扩展 `describeEnvelopeCharsPre`）。位置：`memory-envelope.js:253`。

```js
export function describeEnvelopeCharsPre(env) {
  const e = env || {}
  const base = {
    // ...原有字段...
  }
  // ★ Teamwork：分项账本补 byOrigin —— 回答"团队记忆占了多少字符"。
  //   这对团队版是**核心产品指标**：团队记忆若无节制地增长，会把本机记忆挤出上下文。
  let localChars = 0, teamChars = 0
  const buckets = (e.buckets && typeof e.buckets === 'object') ? e.buckets : {}
  for (const key of Object.keys(buckets)) {
    const n = Number(buckets[key] && buckets[key].chars) || 0
    if (key === 'team') teamChars += n
    else localChars += n
  }
  return {
    ...base,
    byOrigin: { localChars, teamChars },
    teamRatio: (localChars + teamChars) > 0
      ? Number((teamChars / (localChars + teamChars)).toFixed(3))
      : 0,
  }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队记忆挤占本机预算** | `teamBudgetRatio` 设得过大 | 片段 2 硬顶 50%；账本 `teamRatio` 可观测 |
| **默认行为改变** | 新增桶导致既有桶预算变化 | `teamBudgetRatio` 缺省 0 ⇒ team 桶为 0，行为不变；回归断言默认配置下输出逐字节相同 |
| **越权修改既有桶比例** | 顺手调整 `head` 桶 | 用户硬规则禁止；片段 2 只加一个分支 |
| **枚举漏加** | 只加了桶没加优先级 | E1+E2 必须同轮改；补测试断言两个枚举都含 `'team'` |

**既有测试/守卫**：信封总长门用例（含"降级说明追加后不得超长"）、分项账本用例。本次为纯新增桶 + 默认关闭的预算，预计不红。
