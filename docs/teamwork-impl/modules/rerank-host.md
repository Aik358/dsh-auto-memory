
## rerank-host

- **规模**：8,715 B / 161 行 / 5 个导出符号
- **交付形态**：**完整版**

### 职责

`rerank-host-pre` —— **P4 精排多级档位 + 有界异步窗口**（2026-09-16；`rerank_host_pre_v1`）。
**实测推翻方案假设（留痕，文件头逐字）**：bge-reranker-v2-m3 **P95 37.4 秒**（50 对/题，RSS 3.84GB）；qwen3-reranker-0.6b P95 8.8 秒（小样本 10 对/题，RSS 4.95GB，**不可与 bge 直接比**）；收益真实：**recall@1 0.739 → 0.898**（bge）；cross-encoder 模型已下载；**真实缺口 = GPU 版 torch（torch 2.13.0+cpu）与快档量化产物**。
⇒ **精排不得同步等待，只能走有界异步窗口。**
**设计（卡内 v2 修正）**：多级档位（用户裁定）`'off' | 'fast'(int8+CPU，未就绪=不可用) | 'enthusiast'(完整模型+GPU)` —— 档位**只决定"是否允许排精排任务"**；一期本地无 GPU torch / 无量化产物 ⇒ fast/enthusiast **均 fail closed 降级为粗排**（绝不阻塞前台、绝不发出模型请求）。

### 数据流

```
粗排结果（候选 + 分数）
   │
   ▼
resolveRerankTierPre(cfg)   L35   ★ 档位解析（fail closed）
   ├─ 'off'         ⇒ 不排精排任务
   ├─ 'fast'        ⇒ int8+CPU；**未就绪 = 不可用**
   └─ 'enthusiast'  ⇒ 完整模型+GPU；**未就绪 = 不可用**
        │
        ▼
computeRerankInputKeyPre(input)  L46   输入键（缓存 / 去重）
        │
        ▼
createRerankHostPre(opts)  L71   ★ 有界异步窗口
   ├─ RERANK_WINDOW_MS_PRE_V1  L28      窗口时长
   ├─ RERANK_KILL_GRACE_MS_PRE_V1 L30   超时宽限
   ├─ RERANK_CACHE_MAX_PRE_V1 L32       缓存上限
   └─ **绝不阻塞前台、绝不发出模型请求（未就绪时）**
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L25 | `RERANK_HOST_VERSION` | `rerank_host_pre_v1` |
| L28 | `RERANK_WINDOW_MS_PRE_V1` | 异步窗口时长 |
| L30 | `RERANK_KILL_GRACE_MS_PRE_V1` | 超时宽限 |
| L32 | `RERANK_CACHE_MAX_PRE_V1` | 缓存上限 |
| L35 | `resolveRerankTierPre(cfg)` | **档位解析（fail closed）** |
| L46 | `computeRerankInputKeyPre(input)` | 输入键 |
| L71 | `createRerankHostPre(opts)` | **Host 工厂** |

### 内部关键实现

**1. 实测数据推翻方案假设（文件头）**

文件头逐字：*"实测推翻方案假设(留痕): bge-reranker-v2-m3 P95 37.4 秒(50 对/题, RSS 3.84GB); …… ⇒ 精排不得同步等待, 只能走**有界异步窗口**。"*
⇒ **P95 37.4 秒**意味着同步等待会直接卡死交互 ⇒ 异步窗口是**被实测逼出来的**唯一可行设计。
（这也是"留痕"的价值：后人看到 37.4 秒的数字就不会再提"要不还是同步吧"。）

**2. 档位只决定"是否允许排任务"（文件头）**

*"档位只决定"是否允许排精排任务""* ⇒ **不决定结果**。⇒ 与 `procedure-switch.js:26` 的"单一开关不得顺带改变其他功能"同源。

**3. fail closed 降级为粗排（文件头）**

*"一期本地无 GPU torch / 无量化产物 ⇒ fast/enthusiast 均 **fail closed 降级为粗排**（绝不阻塞前台、绝不发出模型请求）"*
⇒ 未就绪时**降级而非报错、且绝不发请求**。⇒ 用户看到的是粗排结果，而不是卡住。

**4. 有界（窗口 + 宽限 + 缓存上限）**

三个上限 ⇒ 防止精排任务堆积。

### 与团队化的关系

**判定：S0 私有（本机算力与模型资产）+ S3（精排结果是派生）。**

理由：档位取决于**本机有没有 GPU torch / 量化产物**，成员之间必然不同。同步档位毫无意义。
**团队化含义**：团队成员的检索质量会**天然不一致**（有的人有精排、有的人没有）⇒ 团队视图应能解释这个差异，而不是把差异归因于记忆内容。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| RH1 | `resolveRerankTierPre` L35 | 本地档位 | **不改**（设备事实） | 无 |
| RH2 | 团队检索 | 无 | 团队记忆同样走本精排窗口（**不另开窗口**） | 接线 |
| RH3 | 新增就绪度上报导出 | 无 | 上报"本机精排就绪度"（解释检索质量差异） | 新增导出 |
| RH4 | 缓存 L32 | 本地 | 团队候选同样受缓存上限约束（不得膨胀） | 纪律 |
| RH5 | fail closed | 降级为粗排 | 团队路径**同样 fail closed**，不得例外 | 纪律 |

#### 可直接落地的代码片段

**片段 1**：精排就绪度上报（新增导出，放文件末尾）。**解释质量差异，而非强求一致。**

```js
/**
 * 上报"本机精排就绪度" —— 用于**解释团队成员间的检索质量差异**。
 *
 * 为什么需要它：本模块文件头的实测数据表明精排收益显著
 * （recall@1 0.739 → 0.898）。团队成员的档位不同 ⇒ 检索质量天然不同。
 * 若不解释，用户会把"我这边的结果比队友差"归因于**记忆内容有问题**，
 * 从而怀疑同步是否生效 —— 这是一个纯误导性的归因。
 *
 * 为什么不"为了一致而禁用精排"：禁用会让所有人都变差；
 * 正确做法是**如实呈现差异**（acceptance.js:13 同款纪律：如实记录，不粉饰）。
 *
 * @param {{tier:string, gpuTorch:boolean, quantized:boolean, windowMs:number}} probe
 * @returns {{tier:string, ready:boolean, expectedQualityHint:string}}
 */
export function describeRerankReadinessForTeamPre(probe) {
  const p = probe || {}
  const tier = String(p.tier || 'off')
  const gpu = p.gpuTorch === true
  const q = p.quantized === true
  const ready = (tier === 'fast') ? q : ((tier === 'enthusiast') ? gpu : false)
  const hint = ready
    ? ('精排已就绪（' + tier + '），排序质量较高。')
    : ('精排不可用（档位 ' + tier + '，GPU torch=' + String(gpu) + '，量化产物=' + String(q) +
       '），当前使用粗排；这不是记忆同步问题，队友的结果可能因此更好。')
  return { tier: tier, ready: ready, expectedQualityHint: hint }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **同步等待精排** | 有人提"等等就出结果" | 文件头留痕（P95 37.4 秒）；必须走异步窗口 |
| **未就绪仍发请求** | fast/enthusiast 未就绪时照发 | 文件头纪律：fail closed；回归覆盖未就绪负路径 |
| **团队另开窗口** | 团队候选走独立精排 | RH2：同一窗口 |
| **缓存被团队候选撑爆** | 忽略缓存上限 | RH4：沿用 `RERANK_CACHE_MAX_PRE_V1` L32 |
| **差异被误归因** | 不解释质量差异 | 片段 1 显式 hint |

**既有测试/守卫**：`rerank-host` 的档位解析用例、fail closed 降级用例、异步窗口用例。文件头的实测数字**很可能是守卫断言的一部分**（"留痕"意味着要防回退）。
