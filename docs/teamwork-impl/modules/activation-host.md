
## activation-host

- **规模**：32,705 B / 596 行 / 3 个导出符号
- **交付形态**：**完整版**

### 职责

**M6-3 Surface Adapter**（`docs/M6-CONTRACT.md` §7-§11）。桥接 `lib/index.js`（pre-step 生命周期 / systemPrompt surface / 调试路由）与 M6-1/2 纯核心。
三条核心行为（文件头逐字）：
- **capability 快照（不按模型名硬编码）**：本 DSH 构建可证明进入下一请求 messages 的 surface = `systemPrompt.context`（user-role 快照追加历史尾部）；pre-step/user-message patch 不存在 ⇒ `capability='dynamic-context'`；连 context 都没有 ⇒ `'none'`（**降级 Shadow，不标 delivered**）；
- **pre-step 时序（§8）**：`bumpStep` → `setCursor` → `claim`（四重门）；claimed packet 缓存于 runtime 态；
- **渲染即投递**：专用 context 组件 `'dsh:m6-reference-tail-pre'` 的 `text()` 重渲染并校验 `exactDigest`，一致则返回尾注文本（**= 已实际进入 messages**）并 `markDelivered` + 异步创建 `seen` 证据；`systemPrompt.section` **永不承载动态 tail**。
**默认关闭**（`associativeMemoryEnabled ∧ activationInboxEnabled` 双门）；`activationSource='fake'` 为路由注入唯一入口。

### 数据流

```
pre-step（每步）
   └─ bumpStep → setCursor → claim（四重门）
        └─ claimed packet 缓存于 runtime 态
             │
             ▼
      context 组件 'dsh:m6-reference-tail-pre'.text()
        ├─ 重渲染 → 校验 exactDigest（activation-inbox.computeExactDigest L328）
        ├─ 一致 ⇒ 返回尾注文本 = **已实际进入 messages**
        ├─ markDelivered（activation-inbox-state L227 的 inbox）
        └─ 异步创建 seen 证据
             │
             ▼
      能力判定：detectPacketCapabilityPre(snapshot)  L31
        ├─ systemPrompt.context 可用 → 'dynamic-context'
        └─ 无 context → 'none'（**降级 Shadow，不标 delivered**）
      CAPABILITY_SNAPSHOT_PRE_V1  L28
      默认关闭双门：associativeMemoryEnabled ∧ activationInboxEnabled
      唯一注入入口：activationSource='fake'
      外部激活（python）：assoc ∧ inbox ∧ pythonBackend 三重门 → offerExternalActivation
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L28 | `CAPABILITY_SNAPSHOT_PRE_V1` | 能力快照形状 |
| L31 | `detectPacketCapabilityPre(snapshot)` | **能力判定（不按模型名硬编码）** |
| L43 | `createActivationHost(opts)` | **Host 工厂（唯一入口）** |

### 内部关键实现

**1. capability 不按模型名硬编码（文件头）**

*"capability 快照（**不按模型名硬编码**）：本 DSH 构建可证明进入下一请求 messages 的 surface = `systemPrompt.context`"*
⇒ 判据是**可证明的 surface**，不是模型标识。⇒ 换模型不需要改代码；团队化换 provider 也不会破坏它。

**2. "渲染即投递"是证据诚实性的核心（文件头）**

*"重渲染并校验 `exactDigest`，一致则返回尾注文本（**=已实际进入 messages**）并 `markDelivered` + 异步创建 `seen` 证据"*
⇒ **只有真的进入了 messages 才记 seen**。这与 `activation-inbox-state` 的"markDelivered 才允许建 seen"是同一条纪律的两端。
**团队化含义**：seen 是 importance 与技能晋升的输入；虚报会污染**他人**的排序。

**3. capability='none' 时降级且不标 delivered（文件头）**

*"连 context 都没有 → `'none'`（**降级 Shadow，不标 delivered**）"* ⇒ **诚实降级**：不假装投递成功。

**4. systemPrompt.section 永不承载动态 tail（文件头）**

⇒ 因为 section 是**静态**的，无法承载逐轮变化的内容。把动态内容放进去会破坏缓存或产出过期内容。

**5. 三重门的外部激活（文件头）**

*"`'python'` 仅在 assoc ∧ inbox ∧ pythonBackend 三重门下经 `offerExternalActivation`"* ⇒ 每增加一个来源就多一道门。团队化新增团队来源时应**再加一门**，而不是复用 python 的门。

### 关联行号索引

- lib/activation-host.js:28
- lib/activation-host.js:43

### 与团队化的关系

**判定：S0 私有（Surface 适配是本机能力）+ S2（激活内容可来自团队）。**

理由：capability 快照描述的是**本机 DSH 构建**的 surface 能力 —— 每台机器的 DSH 版本可能不同，同步它没有意义。
**但激活来源可以是团队记忆** ⇒ 共享内容而非状态。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| AH1 | 双门（文件头） | assoc ∧ inbox | 团队来源**再加一门**（不复用 python 门） | 新增门 |
| AH2 | `detectPacketCapabilityPre` L31 | 本机 surface | **不改**（能力是本机事实） | 无 |
| AH3 | seen 证据创建 | 本地 | 团队来源的 seen 带 actorId | 结构新增 |
| AH4 | `createActivationHost(opts)` L43 | 本地 opts | 增加 `opts.team`（groupId/actorId） | 纯新增 |
| AH5 | `'none'` 降级 | 不标 delivered | 团队来源同样**不得**标 delivered | 纪律 |

#### 可直接落地的代码片段

**片段 1**：团队来源的独立门（新增内部判定 + 接线说明）。位置：`activation-host.js:43`（`createActivationHost` 内，门判定处）。

```js
  /**
   * ★ Teamwork：团队激活源的**独立门**。
   *
   * 为什么不复用 python 的门（assoc ∧ inbox ∧ pythonBackend）：
   *   用户铁律：JS 端与 Python 端是**两项相对独立、可互相替换**的功能，严禁联动。
   *   若团队来源复用 python 门，就等于"要用团队激活必须先装 Python"
   *   —— 正是该铁律禁止的联动。
   *   而且三门里 pythonBackend 与团队毫无关系（团队激活走 JS 路径即可）。
   *
   * 门数：assoc ∧ inbox ∧ teamEnabled 三门（与既有双门保持同构）。
   *
   * @returns {{ok:boolean, reason?:string}}
   */
  function teamActivationGatePre() {
    const cfg = opts.config || {}
    if (cfg.associativeMemoryEnabled === false) return { ok: false, reason: 'assoc-disabled' }
    if (cfg.activationInboxEnabled === false) return { ok: false, reason: 'inbox-disabled' }
    // 团队门**缺省关闭**（fail closed：团队激活是对外语义，不靠猜开启）
    if (!opts.team || opts.team.enabled !== true) return { ok: false, reason: 'team-disabled' }
    return { ok: true }
  }
```

**片段 2**：团队来源的 seen 证据带 actor（**与 markDelivered 同点位**）。位置：`activation-host.js` 的 `markDelivered` + 创建 seen 处。

```js
        // ★ Teamwork：团队来源的 seen 必须带 actorId（与 context-host / inbox-state 同款）。
        //   理由：seen 进入 importance 与技能晋升计数；不标 actor 会让
        //   "队友的投递"与"我自己的阅读"在聚合时不可区分 ⇒ 多样性虚高。
        const seenBase = { kind: 'seen', memoryId: packet.memoryId, sessionRef: sessionRef }
        if (packet.origin === 'team') seenBase.actorId = String(packet.actorId || 'unknown')
        // ...原有：异步创建 seen 证据（必须仍在本分支内，即 exactDigest 校验通过之后）...
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队与 Python 联动** | 团队激活复用 python 门 | 片段 1 独立门；用户铁律 |
| **虚报 seen** | 未校验 exactDigest 就建 seen | 文件头"渲染即投递"；改动不得绕过 |
| **capability 按模型名硬编码** | 为兼容某模型加分支 | 文件头明文禁止；按 surface 判定 |
| **none 时仍标 delivered** | 降级路径漏改 | AH5 纪律；回归覆盖 none 路径 |
| **动态 tail 进 section** | 为省事放 section | 文件头明文"永不承载" |

**既有测试/守卫**：`activation-host` 的 capability 判定用例、pre-step 时序用例、渲染即投递用例（含 exactDigest 不一致的负路径）。**双门/三门判定很可能被逐个断言**。
