
## context-bridge

- **规模**：31,966 B / 622 行 / 22 个导出符号
- **交付形态**：**完整版**

### 职责

**M5-1 Context / Evidence Bridge 纯核心**（`docs/M5-CONTRACT.md` §4-§11）。它定义"把记忆推给模型"（context push）与"记录模型怎么用了记忆"（evidence）之间的**契约**：授权引用、观察 ID / 证据 ID 的确定性生成、引用覆盖度计算、六类证据构造、以及 `context_push` 信封与 ACK 校验。
零 IO、零依赖（仅 `node:crypto`），是 M5 链路的**纯逻辑半边**（Host 半边是 `context-host.js`）。

### 数据流

```
记忆记录（M-06 投影）
   └─ buildAuthorizedMemoryRefFromRecord(...)  L411   ★ 授权引用
        └─ validateAuthorizedMemoryRefPre(ref)  L86
             │
             ▼
        buildContextPushEnvelopePre(...)  L426   ← context_push 信封
             └─ validateContextAckPre(ack)  L399  ← 回执校验
                  │
                  ▼
             createAccessEvidencePre(...)  L244   ★ 六类证据之一
             ├─ buildObservationId(...)  L159
             ├─ buildEvidenceId(...)     L165
             ├─ createCiteEvidencesFromText(...)         L285   cite 类
             ├─ createCorrectionEvidencesFromText(...)   L302   correction 类
             ├─ createSuccessEvidencePre(...)            L352   success 类
             ├─ computeReadCoverage(...)   L221   / computeRangeCoverage L177 / computeContainmentCoverage L199
             └─ IdentityEpisodeTracker  L322 / BoundedIdSet L518
                  │
                  ▼
             createContextPushBridge(...)  L533  / replayContextBridge(...)  L590
             isSuperseded(...)  L511
             枚举与常量：CONTEXT_BRIDGE_POLICY_VERSION L27 / EVIDENCE_POLICY_VERSION L28
                        / OBSERVATION_PREFIX L29 / EVIDENCE_PREFIX L30
                        / CONTEXT_BRIDGE_BUDGET_PRE_V1 L33 / ACCESS_KINDS_PRE_V1 L45
                        / ACK_REASONS_PRE_V1 L48 / CITATION_MEMORY_ID_PATTERN_PRE_V1 L51
                        / CORRECTION_LEXICON_PRE_V1 L54
             Sink 实现：createNullContextSinkPre L358 / createFakeContextSinkPre L374
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L27–L54 | 策略常量与封闭枚举 | 版本、前缀、预算、六类证据（L45）、ACK 原因、引用正则、纠正词典 |
| L67 | `validateContextSegmentPre(seg)` | 上下文段校验 |
| L86 | `validateAuthorizedMemoryRefPre(ref)` | **授权引用校验** |
| L106 | `validateEvidenceAggregatePre(agg)` | 聚合校验 |
| L121 | `validateAccessEvidencePre(ev)` | 证据校验 |
| L159 / L165 | `buildObservationId` / `buildEvidenceId` | **确定性身份** |
| L177 / L199 / L221 | 三种覆盖度计算 | range / containment / read |
| L244 | `createAccessEvidencePre(...)` | **六类证据构造** |
| L285 / L302 / L352 | cite / correction / success 证据构造 | — |
| L322 | `IdentityEpisodeTracker` | 身份追踪 |
| L399 | `validateContextAckPre(ack)` | ACK 校验 |
| L411 | `buildAuthorizedMemoryRefFromRecord(rec)` | 记录 → 授权引用 |
| L426 | `buildContextPushEnvelopePre(...)` | context_push 信封 |
| L511 | `isSuperseded(entry)` | 作废判定 |
| L518 | `BoundedIdSet` | 有界 ID 集 |
| L533 / L590 | `createContextPushBridge` / `replayContextBridge` | 桥接与重放 |

### 内部关键实现

**1. 六类证据是**（L45 `ACCESS_KINDS_PRE_V1`）

seen / read / cite / reuse / success / correction —— 这六类被 `procedure-store`（晋升门限）、`memory-importance.js:48`（importance 公式）、`evidence-agg.js`（聚合）三处消费。⇒ **它是全仓证据体系的口径源头**（`memory-importance.js` 文件头明确"correctionRate 逐字复用 procedure-store 口径"）。

**2. 覆盖度有三种算法（L177 / L199 / L221）**

`computeRangeCoverage`（区间）/ `computeContainmentCoverage`（包含）/ `computeReadCoverage`（混合）—— 分别对应"读了片段"、"读了全文"、"部分包含"三种真实行为。⇒ **覆盖度不是二元值**，这决定了 `read` 类证据的质量。

**3. 身份确定性（L159 / L165）**

`buildObservationId` / `buildEvidenceId` 由内容派生 ⇒ 同输入同 ID ⇒ **幂等**。这与 `evidence-store.js:138` 的 `duplicate-evidence` 去重直接配合。团队化后多端会产生 ID，**确定性是跨端去重的前提**。

**4. `isSuperseded` L511 是"返回但标记"的实现点之一**

用户裁定 superseded 的可见后果 =「返回但标记，不剔除不降权」⇒ 本函数提供判定，渲染层据此加标记。

**5. `createFakeContextSinkPre` L374 与 `createNullContextSinkPre` L358**

测试与"关闭态"两种 sink 实现 ⇒ 纯核心可被完整单测，不需要真实 Host。

### 与团队化的关系

**判定：S2 团队共享（证据契约必须全队一致）+ S3 派生重算（ID / 覆盖度）。**

理由：六类证据的**口径**决定了重要性排序与技能晋升。若两端口径不同（如 A 把"引用"记成 cite、B 记成 read），团队聚合后的 importance 与晋升门限都会错。
**ID 本身是确定性派生** ⇒ 可由各端独立重算，**不需要同步 ID**（但**必须保证同输入同 ID**，否则跨端去重失效）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| CB1 | `ACCESS_KINDS_PRE_V1` L45 | 六类枚举 | **不改**（全仓口径源头，改了牵动三处消费） | 纪律 |
| CB2 | `buildEvidenceId` L165 | 内容派生 | **不得掺入 actorId**（否则跨端同一证据两个 ID ⇒ 去重失效） | 纪律 |
| CB3 | `createAccessEvidencePre` L244 | 本地证据 | 证据行增加 `actorId` 字段（**不进 ID**） | 结构新增 |
| CB4 | 新增 `mergeEvidenceAcrossTeamPre` | 无 | 多端证据合并（按 ID 去重 + actor 溯源） | 新增导出 |
| CB5 | `CONTEXT_BRIDGE_POLICY_VERSION` L27 | 本地版本 | 进团队握手；不一致 ⇒ 拒绝跨端合并证据 | 新增校验 |

#### 可直接落地的代码片段

**片段 1**：跨端证据合并（新增导出，放文件末尾）。**按确定性 ID 去重是核心。**

```js
/**
 * 跨端证据合并 —— **按确定性 evidenceId 去重**，并保留 actor 溯源。
 *
 * 为什么去重必须靠 ID 而不是内容比较：
 *   buildEvidenceId L165 由内容派生 ⇒ 同一条证据在 A 端与 B 端算出**同一个 ID**。
 *   这正是"多路径投递同一证据"能被识别的依据；若改用内容模糊比较，
 *   稍有字段差异（如时间戳）就会被判为两条 ⇒ importance 虚高
 *   （虚高的 importance 会把一条记忆推到排序前列，且**没有明显症状**）。
 *
 * 为什么保留 actorId 但不进 ID：
 *   actor 是审计信息（谁产生的这条证据），进 ID 会让同一行为在两个端产生不同 ID。
 *
 * @param {Array<object>} evidenceLists 各端证据数组
 * @returns {{merged:Array, duplicates:number, byActor:object}}
 */
export function mergeEvidenceAcrossTeamPre(evidenceLists) {
  const lists = Array.isArray(evidenceLists) ? evidenceLists : []
  const byId = new Map()
  let duplicates = 0
  const byActor = Object.create(null)
  for (const list of lists) {
    for (const ev of (Array.isArray(list) ? list : [])) {
      if (!ev) continue
      // 无 ID 的证据不进合并集（契约要求 ID 存在，见 validateAccessEvidencePre L121）
      const id = String(ev.evidenceId || '')
      if (!id) continue
      if (byId.has(id)) { duplicates++; continue }   // 同一证据重复投递 ⇒ 丢弃
      byId.set(id, ev)
      const actor = String(ev.actorId || '')
      if (actor) byActor[actor] = (byActor[actor] || 0) + 1
    }
  }
  return { merged: [...byId.values()], duplicates, byActor }
}
```

**片段 2**：证据行加 actor 但**不进 ID**。位置：`context-bridge.js:244`（`createAccessEvidencePre` 组装返回对象处）。

```js
export function createAccessEvidencePre(input, opts) {
  const o = opts || {}
  const ev = { /* ...原有字段：kind / memoryId / sessionRef / 覆盖度 等... */ }
  // ★ Teamwork：actorId 作为**旁路元数据**写入。
  //   关键纪律：绝不参与 buildEvidenceId L165 的哈希输入 ——
  //   否则"同一个人在两个端做出同一行为"会得到两个 ID，跨端去重立刻失效，
  //   importance 与技能晋升门限都会被虚高计数污染。
  if (o.actorId) ev.actorId = String(o.actorId)
  return ev
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **六类口径分叉** | 团队另立一套证据种类 | CB1 纪律；该枚举是三处消费的口径源头 |
| **evidenceId 掺入 actor** | 为区分来源改 ID | 片段 2 禁止；回归断言"仅改 actorId 时 evidenceId 不变" |
| **重复证据虚高** | 多路径投递 | 片段 1 按 ID 去重；与 `evidence-store.js:138` 的 duplicate 判据同源 |
| **覆盖度口径不一** | 团队重写覆盖算法 | 三种覆盖度是既有契约（L177/L199/L221），不得另写 |
| **策略版本分叉** | 一端升级 | CB5 握手；不一致拒绝合并 |

**既有测试/守卫**：`context-bridge` 的 ID 确定性用例、六类证据构造用例、ACK 校验用例。`memory-importance.js` 文件头明确引用 `context-bridge.js:45` 的枚举 ⇒ **该行号是硬引用**。
