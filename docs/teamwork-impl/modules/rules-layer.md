
## rules-layer

- **规模**：18,935 B / 353 行 / 16 个导出符号
- **交付形态**：**完整版**

### 职责

**规则层抽取**（`rules_layer_pre_v1`）—— P6A 的"分类"部分。它解决用户最痛的病之一：注入开场白原来把所有记忆统一降格为「只是背景事实与规则参考」，**规则与资料混在一句措辞里** ⇒ 模型注意力不落在规矩上。用户原话：「这个 just for reference 说得太轻了，模型注意力没有在这上面。」
**本模块只做一件事**：从记忆文本里**认出规则类条目**，把它们与参考类分开。措辞分层与节奏由调用方负责。

### 数据流

```
记忆文本（用户级 / 项目笔记 / 工作日志 …）
   │
   ▼
splitMemoryEntriesPre(text)   L153   按锚点/标题切条目
   │
   ├─ 每条 → statusOfEntryPre(entry)  L114   取条目状态
   ├─ stripStatusLinesPre(text)       L141   剥离状态行
   │
   ▼
extractRulesLayerPre(entries, opts)  L211   ★ 主入口：分类
   ├─ classifyText   L177    判定"是规则还是参考"
   │    ├─ LOG_KIND_TAG_RE_PRE_V1 L56（日志 kind 标签）
   │    ├─ RULE_MARKERS_PRE_V1   L59
   │    ├─ RULE_CONSTRAINT_WORDS_PRE_V1 L64（硬约束词）
   │    └─ RULE_DESCRIPTION_MARKERS_PRE_V1 L73
   └─ 产出 {rules:[...], reference:[...]}
        │
        ▼
renderRulesSectionPre(rules, opts)  L326   → 注入文本段
   RULES_SECTION_TITLE_PRE_V1  L343
   RULES_SECTION_GUIDE_PRE_V1  L349   ← 「必须遵守」措辞
   REFERENCE_SECTION_GUIDE_PRE_V1 L352 ← 「背景参考」措辞
   ruleSummaryPre(...) L289   每条压成一行
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L41 | `RULES_LAYER_VERSION` | 版本常量 |
| L53 | `LOG_KINDS_PRE_V1` | 日志 kind 枚举 |
| L56 | `LOG_KIND_TAG_RE_PRE_V1` | kind 标签正则 |
| L59 | `RULE_MARKERS_PRE_V1` | 规则标记 |
| L64 | `RULE_CONSTRAINT_WORDS_PRE_V1` | 硬约束词表 |
| L73 | `RULE_DESCRIPTION_MARKERS_PRE_V1` | 规则描述标记 |
| L114 | `statusOfEntryPre(entry)` | 条目状态 |
| L141 | `stripStatusLinesPre(text)` | 剥离状态行 |
| L153 | `splitMemoryEntriesPre(text)` | 切条目 |
| L211 | `extractRulesLayerPre(entries, opts)` | **主分类入口** |
| L289 | `ruleSummaryPre(rule)` | 压成一行 |
| L326 | `renderRulesSectionPre(rules, opts)` | 渲染规则段 |
| L343 / L349 / L352 | 三个标题与引导语常量 | 措辞分层 |

### 内部关键实现

**1. 真源纪律（被 rules-edit.js 引用）**

`rules-layer.js:12` 定义了「用户级硬性约束」段的真源 = `~/.dsh/memory/MEMORY.md`。`rules-edit.js:12`（R7）明确引用这条真源纪律。

**2. 分类是"认出规则"而不是"过滤参考"**

`extractRulesLayerPre` 返回**两组**（rules + reference），而不是丢掉参考。⇒ 参考仍然在场（只是措辞降级为背景），符合"不剔除、只标记"的既有产品语义。

**3. 措辞分层是产品核心**

三个常量（`RULES_SECTION_TITLE_PRE_V1` / `RULES_SECTION_GUIDE_PRE_V1` / `REFERENCE_SECTION_GUIDE_PRE_V1`）承载了用户反馈的**注意力导向**：规则段用"必须遵守"，参考段用"背景参考"。团队化新增来源时**必须决定它归哪一段**，不能一律当背景。

**4. kind 标签体系 L53-56**

`LOG_KINDS_PRE_V1`（rule / preference / fact / todo）+ `LOG_KIND_TAG_RE_PRE_V1` ⇒ 日志条目可带 kind 标记（这是既有记忆纪律里"kind 按性质选，不要一律 fact"的落地）。

### 与团队化的关系

**判定：S2 团队共享（规则必须全队一致）。**

理由：规则层是"每轮无条件注入的硬约束"。团队成员若各自持不同规则集（A 看到 5 条、B 看到 3 条），会导致**同一团队里行为不一致** —— 这正是企业版最不能接受的。
**但必须区分**：用户级规则（`~/.dsh/memory/MEMORY.md`）是**个人**的；团队规则应是**独立的第二真源**（如 `memory/team/<groupId>/RULES.md`），两者**分别注入、互不覆盖**。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| R1 | `extractRulesLayerPre` L211 | 单一来源 | 支持 entries 项带 origin（user / project / team） | 兼容（无 origin ⇒ 老行为） |
| R2 | `renderRulesSectionPre` L326 | 单一规则段 | 支持**两段**：个人规则 + 团队规则（顺序固定：个人优先） | 新增渲染分支 |
| R3 | 新增 `TEAM_SECTION_TITLE_PRE_V1` | 无 | 团队规则段标题（措辞必须能区分来源） | 新增常量 |
| R4 | 团队规则真源 | 不存在 | 新增 `memory/team/<groupId>/RULES.md`，**独立于用户级** | 新增路径 |
| R5 | 冲突检测 | 无 | 个人与团队规则冲突时**显式提示**，不静默取一 | 新增导出 |

#### 可直接落地的代码片段

**片段 1**：按 origin 分流渲染（扩展 `renderRulesSectionPre`）。位置：`rules-layer.js:326`。

```js
// ★ Teamwork：团队规则段的标题与引导语 —— 必须能与个人规则区分。
//   用户硬规则「单一开关不得顺带改变其他功能的行为」的延伸：团队规则不得混进个人段，
//   否则用户无法判断"这条约束是我自己定的，还是公司要求的"。
export const TEAM_SECTION_TITLE_PRE_V1 = '## 团队规则（来自团队共享库 · 必须遵守）'
export const TEAM_SECTION_GUIDE_PRE_V1 =
  '以下是团队共享的硬性约束（真源：团队规则库），与上面的个人规则同等有效；两者冲突时以个人规则为准并需人工澄清。'

/**
 * 渲染规则段 —— 个人段在前、团队段在后，两段**互不覆盖**。
 * @param {Array} rules 规则数组（每项可带 origin: 'user' | 'project' | 'team'）
 * @param {{includeTeam?:boolean, teamTitle?:string}} [opts]
 */
export function renderRulesSectionPre(rules, opts) {
  const o = opts || {}
  const list = Array.isArray(rules) ? rules : []
  // 分流：未标 origin 的（历史数据）一律算个人侧 —— 保证改造前行为不变
  const personal = list.filter((r) => String((r && r.origin) || 'user') !== 'team')
  const team = list.filter((r) => String(r && r.origin) === 'team')

  const parts = []
  if (personal.length) {
    parts.push(RULES_SECTION_TITLE_PRE_V1)
    parts.push(RULES_SECTION_GUIDE_PRE_V1)
    for (const r of personal) parts.push(ruleSummaryPre(r))
  }
  // 团队段：**默认不渲染**（includeTeam 缺省 false）⇒ 未开启团队版时零行为变化
  if (o.includeTeam && team.length) {
    parts.push('')
    parts.push(o.teamTitle || TEAM_SECTION_TITLE_PRE_V1)
    parts.push(TEAM_SECTION_GUIDE_PRE_V1)
    for (const r of team) parts.push(ruleSummaryPre(r))
  }
  return parts.join(String.fromCharCode(10))
}
```

**片段 2**：个人 / 团队规则冲突检测（新增导出）。位置：文件末尾。

```js
/**
 * 检出个人规则与团队规则的**显式冲突**。
 *
 * 为什么必须显式而不是静默取舍：规则是"必须遵守"的硬约束。
 * 若静默以个人为准，用户会以为团队规则生效了（实际没生效）；
 * 若静默以团队为准，等于公司能悄悄覆盖个人约束 —— 两个方向都不可接受。
 * ⇒ 检出并**呈现给用户裁决**（与 memory-mutation 的保护门同款思路：不猜，报出来）。
 *
 * 判据刻意保持简单（主题词交集 >= 2 且约束方向相反）：复杂判据的误报
 * 会让用户直接忽略整个提示，反而更糟。
 *
 * @param {Array<{text:string, origin?:string}>} personalRules
 * @param {Array<{text:string, origin?:string}>} teamRules
 * @returns {Array<{personal:string, team:string, sharedTokens:string[]}>}
 */
export function detectRuleConflictsPre(personalRules, teamRules) {
  const NEG = ['不要', '不得', '禁止', '严禁', 'never', 'must not', 'do not']
  const POS = ['必须', '务必', 'always', 'must']
  const words = (s) => {
    const out = new Set()
    const parts = String(s || '').toLowerCase().split(/[^0-9a-zA-Z\u4e00-\u9fa5]+/u)
    for (const p of parts) if (p && p.length >= 2) out.add(p)
    return out
  }
  const has = (s, arr) => arr.some((w) => String(s).toLowerCase().indexOf(w) >= 0)
  const out = []
  for (const p of (Array.isArray(personalRules) ? personalRules : [])) {
    if (!p || !p.text) continue
    const pt = words(p.text)
    for (const t of (Array.isArray(teamRules) ? teamRules : [])) {
      if (!t || !t.text) continue
      const tt = words(t.text)
      const shared = []
      for (const x of pt) if (tt.has(x)) shared.push(x)
      if (shared.length < 2) continue          // 主题词太少 ⇒ 不报（防误报）
      const pNeg = has(p.text, NEG), pPos = has(p.text, POS)
      const tNeg = has(t.text, NEG), tPos = has(t.text, POS)
      if ((pNeg && tPos) || (pPos && tNeg)) {
        out.push({ personal: String(p.text), team: String(t.text), sharedTokens: shared.slice(0, 8) })
      }
    }
  }
  return out
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队规则覆盖个人规则** | 渲染顺序/优先级写反 | 片段 1 固定"个人在前"；引导语明写"冲突时以个人规则为准" |
| **未开启团队版时行为改变** | 默认就渲染团队段 | 片段 1 的 includeTeam 缺省 false；回归断言默认输出逐字节相同 |
| **冲突检测误报过多** | 判据过宽 | 片段 2 要求主题词交集 >= 2；宁可漏报也不淹没用户 |
| **两套规则真源混用** | 团队规则写进用户级 MEMORY.md | R4 要求独立路径；直接写用户级会污染个人真源 |

**既有测试/守卫**：rules-layer 的切条目/分类/渲染用例；rules-edit 对真源路径的引用。三个引导语常量**很可能被守卫断言**（措辞是产品需求），改动文案会打红。
