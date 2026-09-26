
## activation-inbox-state

- **规模**：12,235 B / 261 行 / 3 个导出符号
- **交付形态**：**完整版**

### 职责

**M6-2 Per-runtime Activation Inbox**（`docs/M6-CONTRACT.md` §8-§9）。**纯内存状态机**，零 IO、零依赖（依赖 activation-inbox 纯核心）；不接 Host、不碰 prompt。
**核心纪律（文件头逐字）**：*"每个 SessionRuntime 一个 inbox 实例(Host 接线时经严格身份键注册,M6-3);本模块禁止任何全局 pendingPacket 或「最后活跃代理」式 fallback——状态只存在于实例内。"*

### 数据流

```
offer(request)
   ├─ JS 硬校验（schema / 身份 / 重复 / contextVersion / memoryIndexVersion / 抑制名单）
   ├─ 构建 ReferenceTailPacketPre（activation-inbox.buildReferenceTailPacketPre L373）
   └─ pending：**新 cv 替换旧 pending = latest-wins**
        │
        ▼
claim({nowStep, cursor})   ★ 四重门
   ├─ ① TTL（activation-inbox.isExpired L366）
   ├─ ② cursor（推进位置）
   ├─ ③ index（memoryIndexVersion 是否已就绪）
   └─ ④ cooldown（REFERENCE_TAIL_COOLDOWN_STEPS_PRE_V1 L19）
   → claimed 并返回 packet
        │
        ▼
markDelivered(packetId)   claimed → delivered，**启动 cooldown**
   ★ "只有此时才允许上游建 seen"（文件头）
        │
        ▼
dispose()   清空全部状态
   ActivationInboxRegistry（L227）—— 每 runtime 一个实例的注册表
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L19 | `REFERENCE_TAIL_COOLDOWN_STEPS_PRE_V1` | 冷却步数 |
| L27 | `createActivationInboxPre(opts)` | **每 runtime 一个实例** |
| L227 | `ActivationInboxRegistry` | **身份键注册表** |

### 内部关键实现

**1. "禁止全局 pendingPacket 或最后活跃代理式 fallback"（文件头）**

这是**并发正确性**的核心纪律：若状态是全局的，多会话并发时 A 的激活包可能被投递给 B。
⇒ **团队化会加剧这个问题**（团队场景下同一用户可能开多个窗口/多台机器），这条纪律必须原样保留。

**2. 四重门（TTL / cursor / index / cooldown）**

四道门**全部**通过才 claim ⇒ 防"过期包被投递"、"索引未就绪就投递"、"高频重复投递"。

**3. latest-wins（offer 内）**

新 contextVersion 的 pending **替换**旧的 ⇒ 不排队、不累积。⇒ 与 `shadow-host` 的"异步 latest-wins 调度"同款策略。

**4. markDelivered 才建 seen（文件头）**

*"`markDelivered(packetId)`:claimed→delivered,启动 cooldown;**只有此时才允许上游建 seen**。"* ⇒ **证据只在"真的投递了"之后才生成**。这是证据诚实性的关键：否则"生成了 packet 但没投递"会被记为"模型看过"。
**团队化含义**：seen 证据若被虚报，会让他人的 importance 排序被污染。

**5. ActivationInboxRegistry L227**

注册表按**严格身份键**注册 ⇒ 状态隔离。团队化新增"团队激活源"时必须走同一注册表（不能新增第二个全局表）。

### 关联行号索引

- lib/activation-inbox-state.js:19
- lib/activation-inbox-state.js:27
- lib/activation-inbox-state.js:227

### 与团队化的关系

**判定：S0 私有（每 runtime 的运行态）+ S2（激活的来源内容可共享）。**

理由：inbox 状态（pending / claimed / cooldown）是**运行时会话态**，天然本机、本 runtime。跨端同步它毫无意义（B 端的 cooldown 跟 A 无关）。
**但激活来源可以是团队记忆** ⇒ 共享的是**内容**，不是状态。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| AS1 | `createActivationInboxPre` L27 | 本地来源 | 支持团队来源候选（**同一 inbox、同一四重门**） | 新增参数 |
| AS2 | 全局态禁令（文件头） | 无全局 | **团队激活也不得引入全局表** | 纪律 |
| AS3 | `markDelivered` | 本地 seen | 团队投递的 seen 证据带 actorId | 结构新增 |
| AS4 | `ActivationInboxRegistry` L227 | 本地键 | 团队源沿用同一注册表（不新增第二张表） | 纪律 |
| AS5 | cooldown L19 | 本地步数 | 团队候选与本地候选**共用同一冷却** | 纪律 |

#### 可直接落地的代码片段

**片段 1**：团队候选准入（**同一 inbox、同一四重门**）。位置：`activation-inbox-state.js:27`（`createActivationInboxPre` 内 offer 的候选处理处）。

```js
  /**
   * ★ Teamwork：团队候选的准入判定。
   *
   * 三条纪律（每条都对应一种真实故障）：
   *   ① **不新建第二张注册表** —— 文件头明令禁止全局 pendingPacket；
   *      团队源若自建注册表，同一 runtime 会出现两套状态 ⇒
   *      同一个包可能被两条路径各投递一次（用户看到重复尾注）。
   *   ② **共用 cooldown** —— 冷却的目的正是"防高频重复投递"。
   *      若团队候选走独立冷却，本地刚投递完、团队同一条又投一次 ⇒ 冷却失效。
   *   ③ **index 门对团队更严** —— 团队记忆的索引可能还没同步完，
   *      在 index 未就绪时投递会给出**过期的团队结论**。
   *
   * @param {object} cand 候选（可带 origin:'team'）
   * @param {{indexReady:boolean}} state
   * @returns {{admit:boolean, reason?:string}}
   */
  function admitTeamCandidatePre(cand, state) {
    const c = cand || {}
    if (String(c.origin || '') !== 'team') return { admit: true }
    // ③ 团队候选在索引未就绪时**一律不投递**（宁可晚，不可给过期结论）
    if (!state || state.indexReady !== true) return { admit: false, reason: 'team-index-not-ready' }
    return { admit: true }
  }
```

**片段 2**：团队投递的 seen 证据带 actor。位置：`activation-inbox-state.js` 的 `markDelivered` 内（建 seen 之前）。

```js
    // ★ Teamwork：团队记忆的 seen 证据必须带 actorId。
    //   为什么：证据体系里 seen 会进入 importance 与技能晋升的计数。
    //   若不标 actor，"团队成员投递了一次"与"我自己看过一次"在聚合时无法区分，
    //   会导致多样性/成功数虚高（与 memory-importance 的 distinctSessions 同款问题，
    //   去重键必须统一为 actorId + sessionRef）。
    const evBase = {
      kind: 'seen',
      memoryId: packet.memoryId,
      sessionRef: sessionRef,
    }
    if (packet.origin === 'team') evBase.actorId = String(packet.actorId || 'unknown')
    // ...原有：把 evBase 交给 evidence 构造（context-bridge.createAccessEvidencePre L244）...
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **全局态回归** | 团队源自建注册表/全局 pending | 文件头禁令 + AS4；回归断言"两个 runtime 的 inbox 互不可见" |
| **重复投递** | 团队候选走独立 cooldown | 片段 1 共用冷却 |
| **过期团队结论** | index 未就绪就投递 | 片段 1 的 index 门（团队更严） |
| **seen 虚报** | 生成 packet 即建 seen | 文件头纪律：markDelivered 才建（改动不得绕过） |
| **actor 缺失** | 团队证据无归属 | 片段 2 显式带上；聚合侧再去重 |

**既有测试/守卫**：`activation-inbox-state` 的四重门用例、latest-wins 用例、dispose 用例。**"无全局态"很可能被守卫断言**（文件头明文）⇒ 新增字段若放在模块级会打红。
