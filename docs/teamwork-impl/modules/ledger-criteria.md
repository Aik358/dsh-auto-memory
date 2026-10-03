
## ledger-criteria

- **规模**：7,985 B / 143 行 / 7 个导出符号
- **交付形态**：**完整版**

### 职责

`ledger-criteria-pre` —— WB-GRAPH P1 **判据校验中间件核心**（`ledger_criteria_v1`）。对交接账本与白板执行 H1–H4 / S1–S4（账本）与 P-H1/P-H2/P-S1（PLAN）判据，并给出拒绝文案。
**关键性质**：本模块**不重复造轮** —— 开头就**兼容性再导出** `wb-contract.js` 的同名判据函数（L18），因为 P0 窗口的 `wb-contract.js` 已实现同名判据，且 `index.js` 两咽喉（`checkMutationPre`）已接线它。

### 数据流

```
账本 / 白板全文
   │
   ├─ checkHandoffCriteriaPre(text)   L59   （账本：H1–H4 硬 + S1–S4 软）
   ├─ checkPlanCriteriaPre(text)      L106  （PLAN：P-H1/P-H2/P-S1，**刻意最弱**）
   └─ checkWriteCriteriaPre(text, kind) L131 ★ 统一入口（按 kind 分派）
        │
        ▼
   renderCriteriaRejectionPre(report)  L138   → 拒绝文案
        │
        ▼
   index.js 的 checkMutationPre（写入咽喉）
        │
        ▼
   真源转发：L18 export { checkHandoffCriteriaPre as checkHandoffCriteriaContractPre,
                         checkPlanCriteriaPre  as checkPlanCriteriaContractPre } from './wb-contract.js'
   段名真源：L23 HANDOFF_SECTIONS_PRE_V1（与 handoff-anchor.js 权重表同源）
   解析复用：L20 import { parseHandoffLedgerPre } from './handoff-anchor.js'
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L15 | `LEDGER_CRITERIA_VERSION` | `ledger_criteria_v1` |
| L18 | `checkHandoffCriteriaContractPre` / `checkPlanCriteriaContractPre` | **真源转发**（别名再导出） |
| L23 | `HANDOFF_SECTIONS_PRE_V1` | 四段权威标题（与 handoff-anchor 同源） |
| L26 | `CRITERIA_PLACEHOLDERS_PRE_V1` | 占位符黑名单 |
| L29 | `LEDGER_MAX_CHARS_PRE_V1` | 账本硬上限 8000（与 sanitizeForWrite 同源） |
| L31 | `PLAN_MAX_CHARS_PRE_V1` | 白板硬上限 200000 |
| L59 | `checkHandoffCriteriaPre(text)` | 账本判据 |
| L106 | `checkPlanCriteriaPre(text)` | PLAN 判据 |
| L131 | `checkWriteCriteriaPre(text, kind)` | **统一入口** |
| L138 | `renderCriteriaRejectionPre(report)` | 拒绝文案 |

### 内部关键实现

**1. "勿重复造轮"的单一真源纪律（L16-18）**

注释逐字：*"兼容性再导出(2026-09-16 勘误): P0 窗口的 `wb-contract.js` 已实现同名判据函数(H1-H4/S1-S4)，且 `index.js` 两咽喉(`checkMutationPre`)已接线它 — **本模块勿重复造轮,统一转发保持单一真源**。"*
⇒ 这正是用户既有判据的正面案例："同一语义若在多个函数里各写一份判据，改动必须一次改全" —— 本模块选择**不写第二份**。

**2. 占位符判据（L40-44）**

`isPlaceholderLine` 同时识别裸占位、`-` 列表前缀、`*` 列表前缀三种写法 ⇒ "TODO"、"略"、"N/A" 等不会被当成实质内容。

**3. 段 body 的实质内容判据（L46-52）**

"每段 body 非空（**≥1 非空行且合计 ≥20 字符**）" —— 双阈值 ⇒ 防止"填了一个字"蒙混过关。

**4. 解析失败按 H1 fail 处理（L57）**

注释：*"不抛错; 解析失败按 H1 fail 处理"* ⇒ 与 `handoff-anchor.parseHandoffLedgerPre` 的 `null`（fail closed）配合，全链 fail closed。

**5. 上限与 sanitizeForWrite 同源（L28-31）**

注释：*"账本硬上限(H4, 与 sanitizeForWrite 8000 同源, **先于它执行**)"* ⇒ **截断只在一处发生**，否则两处截断会产生语义混乱。

### 关联行号索引

- lib/ledger-criteria.js:15
- lib/ledger-criteria.js:23
- lib/ledger-criteria.js:131

### 与团队化的关系

**判定：S2 团队共享（判据规则必须全队一致）+ S3 派生重算（判据执行）。**

理由：判据是**写入咽喉的门**。若两端对同一份账本给出不同判据结果，会出现"A 能写、B 不能写"的分叉。⇒ **判据规则版本（`LEDGER_CRITERIA_VERSION`）必须进团队契约**。
但判据**执行**是纯函数、不产生状态 ⇒ 不同步。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| LC1 | `checkWriteCriteriaPre` L131 | 本地分派 | 增加 `opts.fromTeam` + 远端版本校验 | 新增分支 |
| LC2 | `LEDGER_CRITERIA_VERSION` L15 | 本地常量 | 纳入团队握手；不一致 ⇒ 拒绝应用远端写入 | 新增校验 |
| LC3 | 新增 `assertLedgerCriteriaCompatPre` | 无 | 版本兼容断言（fail closed） | 新增导出 |
| LC4 | 占位符黑名单 L26 | 本地集合 | 团队可**追加**团队特有占位符（如"待团队确认"），但**不得删减**既有项 | 兼容 |
| LC5 | 上限 L29/L31 | 本地硬上限 | 团队不得放宽（放宽会让团队内容超长注入） | 纪律 |

#### 可直接落地的代码片段

**片段 1**：版本兼容断言（新增导出，放文件末尾）。

```js
/**
 * 判据规则版本兼容性断言 —— **fail closed**。
 *
 * 为什么判据版本必须一致：本模块是**写入咽喉的门**（index.js 的 checkMutationPre 接线它）。
 * 若 A 用旧版判据放行、B 用新版判据拒绝，同一份账本会在两端得到相反结果：
 *   · A 写成功并把结果同步给 B；
 *   · B 拒绝应用 ⇒ **两端分叉**，且双方都认为自己是"按规则行事"。
 * ⇒ 版本不一致时拒绝跨端应用，让人先统一版本。
 *
 * @param {string} localVersion
 * @param {string} remoteVersion
 * @returns {{ok:boolean, reason?:string}}
 */
export function assertLedgerCriteriaCompatPre(localVersion, remoteVersion) {
  const L = String(localVersion || '')
  const R = String(remoteVersion || '')
  if (!R) return { ok: false, reason: 'remote-criteria-version-missing' }
  if (R === L) return { ok: true }
  return { ok: false, reason: 'criteria-version-mismatch:' + R + '!=' + L }
}
```

**片段 2**：团队占位符扩展（**只允许追加，不允许删减**）。位置：`ledger-criteria.js:26`（`CRITERIA_PLACEHOLDERS_PRE_V1` 定义处）。

```js
// ★ Teamwork：占位符黑名单**只允许追加**团队特有项，禁止删减既有项。
//   为什么禁止删减：黑名单的作用是识别"未填写"。若团队把 '略' 从黑名单里去掉，
//   那么写了"略"的账本会被判为"已填写"从而**通过质量门** ⇒ 空的交接看起来是完整的。
//   这是"用代码约束诚实"（acceptance.js 同款思路）的反面，必须避免。
const TEAM_PLACEHOLDERS_EXTRA_PRE_V1 = Object.freeze(['待团队确认', '团队决定', 'TBD(team)'])

/**
 * 合并占位符黑名单。**结果集合必为超集**（只能变多，不能变少）。
 * @param {string[]} [teamExtra]
 * @returns {string[]}
 */
export function mergePlaceholdersPre(teamExtra) {
  const base = CRITERIA_PLACEHOLDERS_PRE_V1.slice()
  const extra = Array.isArray(teamExtra) ? teamExtra : TEAM_PLACEHOLDERS_EXTRA_PRE_V1
  const seen = new Set(base.map((x) => String(x).toLowerCase()))
  for (const x of extra) {
    const k = String(x).toLowerCase()
    if (k && !seen.has(k)) { seen.add(k); base.push(String(x)) }
  }
  // 断言超集性质：任何既有项都不得因合并而消失
  for (const b of CRITERIA_PLACEHOLDERS_PRE_V1) {
    if (base.indexOf(b) < 0) return CRITERIA_PLACEHOLDERS_PRE_V1.slice()
  }
  return base
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **版本分叉** | 两端判据版本不同 | 片段 1 fail-closed；LC1 在入口拦 |
| **第二份判据实现** | 为团队另写一套判据 | L16-18 明文禁止；本模块继续转发 wb-contract |
| **上限被放宽** | 团队为"装下更多内容"抬高 8000 | LC5 纪律：上限不得放宽，需要更多空间应走 Tier 分层而非破上限 |
| **占位符被删** | 合并时误用替换语义 | 片段 2 断言超集性质并 fail-soft 回退 |
| **两处截断** | 判据门与 sanitizeForWrite 各截一次 | L28 同源且先于它执行 |

**既有测试/守卫**：`ledger-criteria` 的判据用例；**本模块的 L18 再导出被 `index.js` 的 `checkMutationPre` 使用** ⇒ 改别名会打红宿主接线。`HANDOFF_SECTIONS_PRE_V1` 必须与 `handoff-anchor` 一致（有联合断言的可能性高）。
