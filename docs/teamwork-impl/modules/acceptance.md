## acceptance

- **规模**：4,130 B / 72 行 / 3 个导出符号
- **交付形态**：**简版**（基础设施组；职责 + 同步判定 + 改造要点）

### 职责

**P5 分档运行验收清单**。核心纪律（卡内原文）：**发布材料逐项记录通过/失败/未执行 —— 不把「没测试环境」写成「已验收」**；U1（兼容档实测）未完成时不能填"兼容已验收"；T6-3 资源界限必须事前登记。纯数据结构 + 纯函数、零 IO。三类状态 `pass|fail|not-run`；只有全部必需项 `pass` 才 release-ready；**兼容档实测门**：未登记设备/负载数据 ⇒ 兼容项强制 `not-run`，**不可手工标 pass**。

### 对外接口

| 行号 | 符号 | 说明 |
|---|---|---|
| L13 | `ACCEPTANCE_VERSION` | 版本常量 |
| L16 | `ACCEPTANCE_ITEMS_PRE_V1` | 验收项定义（冻结） |
| L29 | `createAcceptanceLedgerPre(...)` | 台账工厂 |

### 数据流

```
ACCEPTANCE_ITEMS_PRE_V1  L16   （冻结的验收项定义）
        │
        ▼
   createAcceptanceLedgerPre(...)  L29
        每项状态 ∈ {'pass' | 'fail' | 'not-run'}
        │
        ├─ 全部必需项 === 'pass'  → **release-ready**
        └─ 任一 fail / not-run    → **not-ready**（如实）
        │
        ▼
   发布材料逐项记录通过 / 失败 / 未执行

兼容档（compat）实测门：
   未登记设备 / 负载数据 ⇒ 兼容项**强制 not-run**，**不可手工标 pass**
```

### 内部关键实现

**1. 核心纪律（文件头逐字引卡内原文）**

*"发布材料逐项记录通过 / 失败 / 未执行 —— **不把「没测试环境」写成「已验收」**；U1（兼容档实测）未完成时不能填写「兼容已验收」；T6-3 资源界限必须事前登记。"*

**2. "不可手工标 pass"是机制而非约定**

兼容项在缺少登记数据时**被强制** not-run ⇒ 任何人都无法把它改成 pass。这是**用代码约束诚实**，比流程约定可靠。

**3. 纯数据结构 + 纯函数、零 IO**

⇒ 可被直接断言，不需要环境。这也是它能被复用为团队门禁模板的原因。

### 可直接落地的代码片段

**插入位置**：acceptance.js:29 附近的 `createAcceptanceLedgerPre`。

```js
/**
 * 团队发布门禁 —— 复用"不可手工标 pass"语义，扩展为多成员会签。
 *
 * 本模块最有价值的性质是**用代码约束诚实**：兼容项在缺少登记数据时被强制 not-run，
 * 任何人都无法把它改成 pass。团队发布门禁正需要同一性质 ——
 * 不能因为"某个成员口头保证测过"就放行，必须有**登记数据**。
 *
 * @param {object} local 本机验收台账
 * @param {Array<{actorId:string, items:object}>} members 各成员台账
 * @returns {{ok:boolean, ready:boolean, blockedBy:string[]}}
 */
export function mergeAcceptanceForTeamPre(local, members) {
  const all = [local].concat(Array.isArray(members) ? members : []).filter(Boolean)
  const blockedBy = []
  for (const m of all) {
    const items = (m && m.items && typeof m.items === 'object') ? m.items : {}
    for (const k of Object.keys(items)) {
      const st = String(items[k] && items[k].status || '')
      // 任一成员 fail / not-run ⇒ 团队不 ready（如实记账，不放行）
      if (st === 'fail') blockedBy.push('fail:' + k)
      else if (st !== 'pass') blockedBy.push('not-run:' + k)
    }
  }
  return {
    ok: true,
    ready: blockedBy.length === 0,
    blockedBy: [...new Set(blockedBy)],
  }
}
```

### 关联行号索引

- lib/acceptance.js:13
- lib/acceptance.js:16
- lib/acceptance.js:29

### 与团队化的关系

**判定：团队共享（Shared）· 治理文档。**

**这几乎是团队治理的现成模板**：它的"不可手工标 pass"与"如实记录 not-run"正是团队发布门禁应有的语义。团队化可把验收台账扩展为多成员会签。

### Teamwork 改造要点

1. **直接复用"not-run 强制"语义做团队门禁**：团队成员未在某平台实测 ⇒ 该平台项强制 `not-run`，任何人不得手工标 pass。这比"信任声明"可靠得多。
2. **验收台账可进团队共享**：它是**治理文档**而非个人数据，正是团队该共享的东西。
3. **保持纯数据结构**：零 IO 是它能被直接断言的原因；团队化的持久化应放在宿主侧。

### 风险与回归

- 回归：`ACCEPTANCE_ITEMS_PRE_V1` 是冻结的验收项集合——团队化新增团队项应**新增集合**而不是改动冻结集合。
- "只有全部必需项 pass 才 release-ready"是核心不变式，不得放宽。
