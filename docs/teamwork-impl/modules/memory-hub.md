
## memory-hub

- **规模**：29,911 B / 485 行 / 6 个导出符号
- **交付形态**：**完整版**

### 职责

**M8-3 Memory Hub 编排器**（记忆中枢）。纯内存编排、零 IO 依赖（`node:crypto` 仅身份）。把三层记忆串成一条即插即用的链：
`M-02 Episodic（经历）→ M-03 Semantic/Profile（事实）→ M-04 Procedural（技能）`
`M2 segments / M5 evidence → judgement-shadow.jsonl → M5 success/reuse evidence`
**职责三条**：①消费 M7 judgement-shadow 的 semantic/profile/procedure_candidate，喂给对应 store；②把 episodic 巩固后的 episode 转成 episodic_candidate 供上层消费；③把 active procedure 渲染成 checklist（供 M7 召回系统在相似场景注入）。

### 数据流

```
judgement-shadow.jsonl（Python 侧产出）
   └─ ingestJudgement(row)  L122
        ├─ kindCandidate → KIND_TO_LAYER_PRE_V1 L74 映射到层
        │     semantic_candidate → fact-store.upsert
        │     profile_candidate  → fact-store.upsert
        │     procedure_candidate→ procedure-store.observe
        │     episodic_candidate → （供上层消费）
        └─ 计数 stats：judgedRows / consumed* / rejected* / skipped（L119）
        │
   ingestJudgementRows(rows)  L197   ★ 批语义（含 beginBatch/endBatch）
        │
   consolidateEpisodes()  L227  → episodic.flush()
        │
   crossFeed(sessionRef)  L234  ★ 举一反三：episode → fact/procedure 候选
        │
   renderChecklists()  L270     → active procedure → checklist（注入用）
   overview()  L282             → 总览（面板）
   snapshot L355 / dispose L365 / getStats L375
        │
   judgement 行适配器（模块级导出）：
     factCandidateFromRow(row)          L382
     procedureCandidateFromRow(row)     L414
     lessonCandidateFromRetractedPre(...) L463
   MEMORY_HUB_POLICY_VERSION L29
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L29 | `MEMORY_HUB_POLICY_VERSION` | 策略版本 |
| L74 | `KIND_TO_LAYER_PRE_V1` | **kind → 层映射（冻结）** |
| L91 | `createMemoryHubPre(opts)` | **工厂** |
| L382 | `factCandidateFromRow(row)` | judgement 行 → fact 候选 |
| L414 | `procedureCandidateFromRow(row)` | judgement 行 → procedure 候选 |
| L463 | `lessonCandidateFromRetractedPre(...)` | 撤回项 → 教训候选 |

**实例方法**：`ingestJudgement L122`、`ingestJudgementRows L197`、`consolidateEpisodes L227`、`crossFeed L234`、`renderChecklists L270`、`overview L282`、`snapshot L355`、`dispose L365`、`getStats L375`。

### 内部关键实现

**1. 惰性注入避免循环依赖（L92-95）**

`const { createEpisodicStorePre } = opts._stores || {}` —— 三个 store 的构造函数从 `opts._stores` 取。注释：*"惰性 import 避免循环依赖(各 store 是独立模块)"*。⇒ 团队化新增 store（如团队 fact store）也走 `_stores` 注入，**不改本模块的 import 结构**。

**2. 机械 procedure 切片开关已退役（L96-102）**

注释逐字：*"★A-1（2026-09-23）：机械 procedure 切片开关**已退役**（用户裁定「机械通路已被我弃用」）。原 `mechanicalProcedureFeedEnabled` 只包住 crossFeed 里那条 `intent.slice(0,40)` 分支；该分支产出的观察行既非真技能、又要用户在审批列表里手动清理 ⇒ 整段删除。⚠️ **只删该分支**：fact 分支、episode 巩固、judgement 消费一律不受影响（用户硬规矩「单一开关不得顺带改变其他功能行为」）。"*
⇒ **这是一个完整的"删开关"案例**：删对了范围（只删那一个分支），并显式记录了"哪些没动"。

**3. 批语义收在拥有这批行的这一层（L198-204）**

注释逐字：*"issue #110 的剩余缺口：批内合并落盘此前**只挂在宿主的喂数定时循环上**（index.js 里手动 beginBatch/endBatch）。于是走 `ingestJudgementRows` 的其它批量入口 —— HTTP `/memory-hub` 的 `action=feed`（面板/外部重放器喂一整批判据）—— 仍是 N 行 = N 次整份快照写盘，正是写放大。把批语义收到"拥有这批行"的这一层，**任何批量入口都自动只落一次**。"*
⇒ 修法值得复用：**把正确性收到拥有数据的那一层**，而不是依赖每个调用方自觉。

**4. finally 里不 return（L216-218）**

*"批末必落：中途抛错也不能把已接受的改动留在内存里等下次。⚠️ **不在 finally 里 return** —— 那会吞掉正在传播的异常（静默失败的同一种形状）。"*

### 与团队化的关系

**判定：S2 团队共享（hub 是团队记忆的中枢编排层）+ S3（候选转换是纯函数）。**

理由：hub 是"judgement → 三店"的**唯一编排入口**。团队化要么给它第二个 store 组（团队三店），要么让候选在进入 hub 前分流 —— **前者更符合本模块的注入式设计**（`opts.stores` 已支持注入）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| MH1 | `createMemoryHubPre(opts)` L91 | 单组 stores | 注入**第二组**团队 stores（复用同一编排逻辑） | 新增 opts |
| MH2 | `ingestJudgement` L122 | 写入本地 store | 按 scope 路由到团队组（**同一行不双写**） | 新增分支 |
| MH3 | `crossFeed` L234 | 本地 episode | 团队 episode 巩固产物走团队 store | 新增分支 |
| MH4 | `renderChecklists` L270 | 本地技能 | 团队技能合并渲染（**来源标**） | 渲染增字段 |
| MH5 | `overview` L282 | 本地总览 | 团队总览分段（个人 vs 团队） | 结构新增 |

#### 可直接落地的代码片段

**片段 1**：按 scope 路由的 store 解析（新增内部函数）。位置：`memory-hub.js:91`（`createMemoryHubPre` 内，store 装配处 L106-116 附近）。

```js
  // ★ Teamwork：本地 store 组 + 可选团队 store 组（**同构、复用同一套方法签名**）。
  //   为什么用"第二组 store"而不是在 store 内部加 scope 分支：
  //   三个 store 都是"纯内存状态机 + 注入 io"的形态（见各文件头的设计目标），
  //   它们天然支持"换一个 io 就是另一个库"。⇒ 团队库 = 同一份 store 代码 + 团队 io，
  //   这是本仓最省改动、也最难出错的接法。
  const teamStores = {}
  teamStores.episodic = opts.teamStores && opts.teamStores.episodic ? opts.teamStores.episodic : null
  teamStores.facts = opts.teamStores && opts.teamStores.facts ? opts.teamStores.facts : null
  teamStores.procedures = opts.teamStores && opts.teamStores.procedures ? opts.teamStores.procedures : null

  /**
   * 按行的 scope 选择 store。**团队行只进团队库、本地行只进本地库**（绝不双写）。
   * 为什么不双写：双写会让"同一条事实"在两处各有副本，
   * 后续任何一次编辑都要同步两处 —— 一旦漏一处就产生**静默分叉**
   * （表现是"改了这边那边没变"，且没有报错）。
   */
  function storesForPre(scope) {
    const s = String(scope || 'workspace')
    // team 前缀或显式 team scope ⇒ 团队库；团队库不可用时**退化为不进库并留痕**
    if (s === 'team' || s.indexOf('team:') === 0) {
      if (!teamStores.facts) { stats.skipped++; return null }
      return teamStores
    }
    return stores
  }
```

**片段 2**：在 `ingestJudgement` 内使用（**保持既有的早退与计数纪律**）。位置：`memory-hub.js:122`。

```js
  function ingestJudgement(row) {
    if (!row || typeof row !== 'object') { stats.skipped++; return { skipped: true, reason: 'not-object' } }
    const kind = row.kindCandidate
    const layer = KIND_TO_LAYER_PRE_V1[kind]
    // ★ Teamwork：先解析目标 store 组；解析不到（团队库未装配）⇒ 按既有 skipped 路径处理，
    //   不抛错、不静默成功 —— 与上面 not-object 分支保持同一种"如实计数"形态。
    const target = storesForPre(row.scope)
    if (!target) return { skipped: true, reason: 'team-store-unavailable' }
    // ...原有分派逻辑，把 stores.facts / stores.procedures 替换为 target.facts / target.procedures...
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **双写导致分叉** | 本地 + 团队各写一份 | 片段 1 明令不双写；按 scope 单选 |
| **批语义丢失** | 团队写入绕过 ingestJudgementRows | 批语义已收在 L198 这一层；团队入口也走同一函数 |
| **finally 里 return** | 团队清理逻辑写成 return | L216-218 明文禁止；会吞异常 |
| **删开关误伤** | 学 A-1 删分支时扩大范围 | L101-102 是正确范例：只删该分支并声明"哪些没动" |
| **团队库不可用时静默成功** | 直接 return {ok:true} | 片段 2 走 skipped 计数路径 |

**既有测试/守卫**：`memory-hub` 的 ingest 分派用例、批语义用例（含"中途抛错仍落盘"）、crossFeed 用例。A-1 退役后有针对"机械分支确已删除"的断言可能性高。
