
## memory-mutation

- **规模**：13,844 B / 252 行 / 6 个导出符号
- **交付形态**：**完整版**

### 职责

**记忆写入保护门**（`memory_mutation_pre_v1`）—— 主体拥有"共同提交与保护入口"。
**边界（总纲 §0.5 / ROUND3 §3.1 定案，必须遵守）**：本模块**只接收规范化投影** `{beforeIds, afterIds, protectedRegions, changes}`，它**不自行解释图格式** —— 不知道 `### ` 是什么、不知道 `<!-- user -->` 是什么。**格式由适配器提供**：白板走 `wb-contract.js:parseWhiteboardPre` → `toMutationProjectionPre`；账本/笔记等其他目标各给各的投影。**格式只维护一份**。

### 数据流

```
各格式适配器（格式解释层）
   ├─ 白板：wb-contract.js:parseWhiteboardPre → toMutationProjectionPre
   ├─ 账本：handoff/anchor 适配器
   └─ 笔记：note 适配器
        │  统一投影 {beforeIds, afterIds, protectedRegions, changes}
        ▼
validateMutationBoundaryPre(projection, opts)   L76   ← ★ 保护门
   ├─ 逐条比 beforeIds → afterIds：**消失的 id = 被删条目**
   ├─ 与 protectedRegions 求交
   │    └─ 命中受保护区域 → 拒绝（reason ∈ MUTATION_REASONS_PRE_V1  L37）
   └─ 产出 {ok, reason, report}
        │
        ▼
mutationRefusalTextPre(report)  L212   → 中文人话拒绝文本（给模型看）
validateProjectionPairPre(before, after)  L232   投影对校验
protectedRegionDigestPre(...)  L249    受保护区域指纹
describeMutationReasonPre(code)  L47   原因码 → 文案
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L34 | `MEMORY_MUTATION_VERSION` | 版本常量 |
| L37 | `MUTATION_REASONS_PRE_V1` | **封闭原因码枚举** |
| L47 | `describeMutationReasonPre(code)` | 原因码 → 文案 |
| L76 | `validateMutationBoundaryPre(projection, opts)` | **主保护门** |
| L212 | `mutationRefusalTextPre(report)` | 拒绝文本 |
| L232 | `validateProjectionPairPre(before, after)` | 投影对校验 |
| L249 | `protectedRegionDigestPre(projection)` | 受保护区域指纹 |

### 内部关键实现

**1. 为什么要这个门 —— "不是一个好想法，是事故根因"（文件头 L17）**

文件头明确写着这是**事故根因**而非设计偏好。⇒ 说明历史上真的发生过"写入动作误删了受保护内容"的事故。团队化会让**多人同时写同一份记忆**，这类事故的概率显著上升。

**2. 格式只维护一份（文件头 L12-15）**

*"本模块不自行解释图格式……格式由适配器提供……**格式只维护一份**"*。
这是本仓反复出现的架构纪律：**同一语义不在多处实现**（对照用户既有判据："同一语义若在多个函数里各写一份判据，改动必须一次改全，只改部分会进入半修状态"）。

**3. 原因码是封闭枚举 L37 + 文案映射 L47**

`MUTATION_REASONS_PRE_V1` 是冻结枚举，`describeMutationReasonPre` 负责转中文人话。⇒ **新增原因必须同时改两处**（字符串枚举写错编译器不报错的教训）。

**4. 保护门只判"消失的 id"**

判据是 `beforeIds → afterIds` 的差集与 `protectedRegions` 求交 ⇒ **纯集合运算、与格式无关**。这正是它能在多种格式间复用的原因。

### 关联行号索引

- lib/memory-mutation.js:37
- lib/memory-mutation.js:76
- lib/memory-mutation.js:212

### 与团队化的关系

**判定：S2 团队共享（保护规则本身）；投影是 S3 派生重算。**

理由：**保护规则必须全队一致** —— 如果 A 的保护门放行、B 的不放行，同一个补丁会在两端得到不同结果，导致**分叉**。⇒ 规则（含版本号 `MEMORY_MUTATION_VERSION`）必须进团队契约，且**两端版本不一致时应拒绝应用远端补丁**（fail closed）。
而"投影对象"是每次写入时本地实时算出的派生量，**不同步**。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| MU1 | `validateMutationBoundaryPre` L76 | 纯本地判据 | **不改判据**，新增"规则版本"出口供团队协商 | 新增读取器 |
| MU2 | `MEMORY_MUTATION_VERSION` L34 | 本地常量 | 纳入团队握手：远端补丁若来自更高版本 ⇒ **拒绝并提示升级** | 新增校验 |
| MU3 | 新增 `assertTeamRuleCompatPre` | 无 | 规则版本兼容性断言（fail closed） | 新增导出 |
| MU4 | `mutationRefusalTextPre` L212 | 本地文案 | 拒绝时附"哪一端拒绝的"（actorId） | 文案增字段 |
| MU5 | 团队审计 | 无 | 每次拒绝记入团队审计（谁尝试了什么被挡） | 新增 |

#### 可直接落地的代码片段

**片段 1**：团队规则版本兼容断言（新增导出，放文件末尾）。**fail closed。**

```js
/**
 * 团队规则版本兼容性断言 —— **fail closed**。
 *
 * 为什么必须 fail closed：保护门是"防止误删受保护内容"的最后一道闸。
 * 若远端补丁来自**更高版本的规则**（意味着它那边的"受保护区域"定义可能更宽），
 * 用本地旧规则去校验它，会**放行一条在新规则下本该被拒绝的补丁**。
 * ⇒ 版本不匹配时拒绝应用，让人先升级，而不是"尽力而为地放行"。
 *
 * @param {string} localVersion 本机 MEMORY_MUTATION_VERSION
 * @param {string} remoteVersion 补丁携带的规则版本（缺失视为不兼容）
 * @returns {{ok:boolean, reason?:string, action?:'upgrade'|'retry'}}
 */
export function assertTeamRuleCompatPre(localVersion, remoteVersion) {
  const L = String(localVersion || '')
  const R = String(remoteVersion || '')
  if (!R) {
    // 缺版本 = 无法判断 ⇒ 拒绝（不要假设"没写就是同版本"）
    return { ok: false, reason: 'remote-rule-version-missing', action: 'upgrade' }
  }
  if (R === L) return { ok: true }
  // 版本串形如 memory_mutation_pre_v1 —— 只比较尾号，不猜语义
  const num = (s) => {
    const m = String(s).match(/_v(\d+)$/)
    return m ? Number(m[1]) : NaN
  }
  const ln = num(L), rn = num(R)
  if (Number.isFinite(ln) && Number.isFinite(rn) && rn > ln) {
    return { ok: false, reason: 'remote-rule-newer:' + R + '>' + L, action: 'upgrade' }
  }
  if (Number.isFinite(ln) && Number.isFinite(rn) && rn < ln) {
    // 远端更旧 ⇒ 它对"受保护区域"的认知更少，本地判据更严 ⇒ **本地判据可以放行校验**
    // 但仍要打标，让上层决定是否提示对方升级。
    return { ok: true, reason: 'remote-rule-older:' + R + '<' + L, action: 'retry' }
  }
  // 无法解析版本号 ⇒ 保守拒绝
  return { ok: false, reason: 'unparseable-version:' + R, action: 'upgrade' }
}
```

**片段 2**：在保护门入口加一道版本前置。位置：`memory-mutation.js:76`（`validateMutationBoundaryPre` 函数体最开头，早退分支之前）。

```js
export function validateMutationBoundaryPre(projection, opts = {}) {
  // ★ Teamwork：来自远端的投影必须先过规则版本门（fail closed）。
  //   放在**最前面**：若投影来自团队且规则不兼容，不应进入任何本地判据逻辑
  //   —— 连"计算报告"都不做，避免消费方误把部分结果当成有效判决。
  if (opts && opts.fromTeam) {
    const compat = assertTeamRuleCompatPre(MEMORY_MUTATION_VERSION, opts.remoteRuleVersion)
    if (!compat.ok) {
      return {
        ok: false,
        reason: compat.reason,
        report: { refused: true, gate: 'team-rule-version', action: compat.action },
      }
    }
  }
  // ...原有逻辑不变...
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **两端规则版本分叉** | 一端升级、一端未升级 | 片段 1 的 fail-closed 断言；片段 2 在入口拦截 |
| **版本号解析失败静默放行** | `_v` 后缀格式变化 | 片段 1 末行保守拒绝；回归覆盖"无法解析"路径 |
| **保护门被绕过** | 新写入路径不走 `validateMutationBoundaryPre` | 团队化必须先确认**所有写入路径都过门**（本模块是唯一共同入口） |
| **投影里含格式语义** | 适配器偷懒把 `###` 塞进投影 | 文件头 L12-15 明文禁止；代码评审点 |

**既有测试/守卫**：`memory-mutation` 的保护门用例（受保护区域命中/未命中、原因码）。本次为纯新增导出 + 一处前置分支，预计不红；但**新增原因码必须同步 `MUTATION_REASONS_PRE_V1`` 与 `describeMutationReasonPre`` 两处**。
