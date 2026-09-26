
## rules-edit

- **规模**：7,398 B / 160 行 / 9 个导出符号
- **交付形态**：**完整版**

### 职责

「用户级硬性约束」的**条目级**解析与增删改（R7 需求）。
**背景（用户 2026-09-20 明确要求「这个功能必须要落在前端」）**：`[规则 — 用户级硬性约束 · 必须遵守]` 这一段是**每轮无条件注入**的硬约束，真源 = `~/.dsh/memory/MEMORY.md`（见 `rules-layer.js:12` 的真源纪律）。它**不走语义层** —— 即没有检索/打分/淘汰环节 ⇒ **过时条目不会被自动清理**；而 AI（`memory_user`）也会往里写错东西。⇒ 用户必须能**自己增/删/改**，否则错一条就每轮都被误导。

### 数据流

```
真源：~/.dsh/memory/MEMORY.md 的「用户级硬性约束」段
   │
   ├─ listRuleItemsPre(text)     L51   → 条目列表（0 基序号 / 来源日期段 / 文本）
   ├─ updateRuleItemPre(text, index, expect, content) L84   → 新文本
   ├─ removeRuleItemPre(text, index, expect)          L103  → 新文本
   ├─ appendRuleItemPre(text, content, dateSection)   L118  → 新文本
   ├─ previewRulesPre(text)      L152  → 预览
   └─ isEmptyRulesPre(text)      L158  → 空判据
        │
        ▼
   RULE_DATE_SECTION_RE_PRE_V1 L37   日期段正则
   RULE_ITEM_RE_PRE_V1        L40   条目正则
   RULE_ITEM_MAX_CHARS_PRE_V1 L43   单条长度上限
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L37 | `RULE_DATE_SECTION_RE_PRE_V1` | 日期段正则（按日期分段） |
| L40 | `RULE_ITEM_RE_PRE_V1` | 条目正则 |
| L43 | `RULE_ITEM_MAX_CHARS_PRE_V1` | 单条字符上限 |
| L51 | `listRuleItemsPre(text)` | 列出全部条目 |
| L84 | `updateRuleItemPre(text, index, expect, content)` | 改写一条 |
| L103 | `removeRuleItemPre(text, index, expect)` | 真删一条 |
| L118 | `appendRuleItemPre(text, content, dateSection)` | 追加 |
| L152 | `previewRulesPre(text)` | 预览 |
| L158 | `isEmptyRulesPre(text)` | 空判据 |

### 内部关键实现

**1. expect 参数 = 内容锚定（防索引漂移）**

`updateRuleItemPre` / `removeRuleItemPre` 都要求传 `expect`（= 该条**当前**文本，从 `list` 原样回填），不符即拒。
**原因（用户级硬约束）**：*"删/改必须带 expect（= 该条当前文本，从 list 原样回填），不符即拒 —— 防索引漂移删错行"*。⇒ 这是**防误删**的关键机制：并发编辑或列表变化时，索引会漂移，光凭序号会删错。

**2. 不走语义层 ⇒ 没有淘汰机制**

文件头逐字：*"它**不走语义层** —— 即没有检索/打分/淘汰环节 ⇒ **过时条目不会被自动清理**"*。⇒ 用户手动维护是**唯一**的清理手段。这条在团队化下会放大：**团队规则若也每轮注入，过时条目会同时误导所有成员**。

**3. 段落按日期分段 L37**

条目挂在日期段下 ⇒ 保留"何时加入"的溯源信息。

**4. 本节每轮无条件注入、不参与裁剪**

文件头明确这是"每轮无条件注入的硬约束"，且用户既有判据指出：*"这段每轮注入且不参与裁剪，所以它同时是 prompt 成本的主要来源"* ⇒ 清理过时条目是**降低 prompt 成本**的首选手段。

### 与团队化的关系

**判定：S1 个人云（用户级规则默认不共享）+ S2（团队规则另立真源）。**

理由：本模块操作的是 `~/.dsh/memory/MEMORY.md` 的**用户级**段 —— 那是**个人**的硬约束（如"未经同意不得重启宿主"）。把个人规则同步给团队既无必要也有隐私风险。
**团队规则必须走独立真源**（`memory/team/<groupId>/RULES.md`），本模块的增删改能力可被**复用**为团队规则的编辑通道，但**目标文件不同、权限不同**（团队规则通常只有管理员可改）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| RE1 | `listRuleItemsPre` L51 | 只解析单段 | 增加 `opts.section` 参数：可解析"团队规则段" | 兼容（缺省 = 用户段） |
| RE2 | `updateRuleItemPre` L84 / `removeRuleItemPre` L103 / `appendRuleItemPre` L118 | 只写用户真源 | 支持目标文件参数化（**但禁止跨真源写入**） | 新增参数 |
| RE3 | 权限 | 无 | 新增 `canEditRulesPre(actor, scope)`：团队段仅管理员可改 | 新增导出 |
| RE4 | expect 纪律 | 已有 | **升级为跨端**：expect 不符时返回冲突信息（而非仅拒绝） | 返回值增字段 |
| RE5 | 审计 | 无 | 每次增删改记录 actorId + 时间（团队治理必需） | 新增 |

#### 可直接落地的代码片段

**片段 1**：团队段编辑权限门（新增导出）。位置：`rules-edit.js` 文件末尾。

```js
/**
 * 规则编辑权限门 —— 个人段人人可改，团队段需管理员。
 *
 * 为什么团队规则必须限制写入：团队规则是"每轮无条件注入的硬约束"，
 * 一次误写会**同时误导全部成员每一轮**。个人段的误写只影响自己且可即时改回；
 * 团队段的误写影响面是 N 倍且需要协调回滚 ⇒ 权限必须不同。
 *
 * @param {{actorId?:string, role?:string}} actor
 * @param {'user'|'team'} scope
 * @returns {{ok:boolean, reason?:string}}
 */
export function canEditRulesPre(actor, scope) {
  const s = String(scope || 'user')
  if (s === 'user') return { ok: true }              // 个人段：不受限
  if (s !== 'team') return { ok: false, reason: 'unknown-scope:' + s }
  const role = String((actor && actor.role) || '')
  // 只在显式声明为管理员/所有者时放行 —— 缺省拒绝（fail closed）
  if (role === 'admin' || role === 'owner') return { ok: true }
  return { ok: false, reason: 'team-rules-require-admin' }
}
```

**片段 2**：expect 不符时返回结构化冲突。位置：`rules-edit.js:84`（`updateRuleItemPre` 内，expect 校验失败分支）。

```js
export function updateRuleItemPre(text, index, expect, content) {
  const items = listRuleItemsPre(text)
  const i = Number(index)
  if (!Number.isFinite(i) || i < 0 || i >= items.length) {
    return { ok: false, reason: 'index-out-of-range', count: items.length }
  }
  const current = String(items[i].text || '')
  if (String(expect == null ? '' : expect) !== current) {
    // ★ Teamwork：把"锚定失败"升级为**可裁决的冲突**。
    //   个人场景下这里直接拒绝是对的（用户重试即可）；团队场景下
    //   "另一名成员刚改了同一条"是**正常现象**，需要把两边内容都交出去让人裁决，
    //   否则用户只会看到"改不了"，却不知道被谁改成了什么。
    return {
      ok: false,
      reason: 'expect-mismatch',
      conflict: {
        index: i,
        expected: String(expect == null ? '' : expect),
        actual: current,
        actualBy: String(items[i].by || 'unknown'),   // 若条目带来源标注
      },
    }
  }
  // ...原有替换逻辑...
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **跨真源误写** | 把团队规则写进个人 MEMORY.md | RE2 禁止；片段 1 的 scope 门隔离 |
| **索引漂移删错行** | 不带 expect 就删 | expect 是必填；片段 2 进一步返回冲突详情 |
| **prompt 成本膨胀** | 规则段无限增长 | 该段每轮注入不参与裁剪 ⇒ 团队规则必须有**条数上限**（建议显式配额） |
| **权限缺省放行** | role 缺失时误判为可改 | 片段 1 fail closed（仅 admin/owner 放行） |

**既有测试/守卫**：`rules-edit` 的 list/update/remove/append 用例（含 expect 不符的负路径）。本次为纯新增导出 + 一处返回值扩展，预计不红；但**若上游按 `reason` 字符串做精确匹配，`expect-mismatch` 语义不变 ⇒ 安全**。
