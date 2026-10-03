
## procedure-switch

- **规模**：2,604 B / 39 行 / 2 个导出符号
- **交付形态**：**完整版**

### 职责

★ B-2 修复（2026-09-22）：**procedure 技能生效总闸的语义纠正与兼容层**。
**背景（代码取证）**：旧键 `procedurePromotionEnabled` 的名字/文案是「技能固化与晋升」，但它的**唯一两个消费者都与"晋升"无关"**：
- `context-host.js:537` → `skillEnabled = memoryHubEnabled && procedurePromotionEnabled !== false`（决定技能是否**注入上下文**）
- `activation-host.js:330` → `if (procedurePromotionEnabled === false) return null`（决定**主动唤起**这条臂开不开）

真正的"晋升"由 store 的门限（`procedure-store.js`）与路由动作决定，**与该键无关**。它默认 `false`（`index.js:546`）⇒ **新用户装完即"技能永不生效"，且没有任何提示**。
⇒ 用户硬规则「单一开关不得顺带改变其他功能的行为」—— 本键正是反例。

### 数据流

```
插件 config（engine.config）
   │
   ▼
resolveProcedureInjectEnabledPre(cfg)   L26   ★ 唯一解析口径
   ├─ procedureInjectEnabled 为 boolean        → 用它（新键，语义正确）
   ├─ procedurePromotionEnabled 为 boolean     → 用它（旧键，兼容别名）
   └─ 都没有                                    → **true**（默认开启）
        │
        ▼
   两个唯一消费者：
     context-host.js:537    skillEnabled = memoryHubEnabled && <本值>
     activation-host.js:330 if (<本值> === false) return null
        │
        ▼
usesLegacyProcedureSwitchPre(cfg)  L35   → 是否仍在用旧键（供设置页提示"建议迁移"）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L26 | `resolveProcedureInjectEnabledPre(cfg)` | **开关唯一解析口径** |
| L35 | `usesLegacyProcedureSwitchPre(cfg)` | 是否仍用旧键 |

### 内部关键实现

**1. 不新增死开关（文件头）**

文件头逐字：*"纠正方案（**不新增死开关**）：新增 `procedureInjectEnabled`（默认 **true**）作为语义正确的总闸，供上面两个消费者读取。旧键保留为**兼容别名**：新键缺省时按旧键取值，两键都缺省时取 `true`。"*

**2. 本文件是并行开发的接口契约（文件尾）**

文件尾逐字：*"⚠️ 本文件是并行开发的**接口契约**：其他文件只允许通过本模块解析该开关，**不得各自 inline 一份判断**（否则又会出现口径漂移）。"* ⇒ 这是"同一语义不得多处实现"的正面落地。

**3. 默认值反转的后果**

旧键默认 `false` ⇒ 新用户"技能永不生效"。新解析默认 `true` ⇒ **修复了静默失效**。这也是团队技能库能否工作的前提：若总闸默认关，团队共享再多技能也不会被注入。

### 与团队化的关系

**判定：S2 团队共享（总闸语义必须全队一致）+ 新增独立的团队技能子开关。**

理由：总闸决定"技能这条臂开不开"。若成员 A 开、B 关，同一份团队技能库在两人那里效果不同 ⇒ 团队技能共享失效。
**但**：团队技能是否共享**必须用独立开关**（不得复用本键）—— 否则"开团队版"会顺带打开个人技能注入（违反单一开关解耦）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| PS1 | `resolveProcedureInjectEnabledPre` L26 | 三优先级 | **不改**（保持权威解析） | 无 |
| PS2 | 新增 `resolveTeamSkillSharePre` | 无 | **独立**团队技能共享开关（缺省 false） | 新增导出 |
| PS3 | 团队技能过滤 | 无 | 团队技能注入前按 PS2 过滤，**总闸仍由 PS1 决定** | 接线点 |
| PS4 | 旧键迁移提示 | `usesLegacyProcedureSwitchPre` L35 | 团队设置页沿用该提示 | 复用 |

#### 可直接落地的代码片段

**片段 1**：独立的团队技能共享开关（新增导出，放文件末尾）。**默认 false ⇒ 零破坏。**

```js
/**
 * 团队技能共享开关 —— **刻意与技能注入总闸分离**。
 *
 * 为什么不复用 resolveProcedureInjectEnabledPre 的结果（用户硬规则
 * 「单一开关不得顺带改变其他功能的行为」）：
 *   · 总闸回答的是"技能这条臂开不开"（个人功能开关）；
 *   · 本键回答的是"我的技能要不要进团队共享库"（治理选择）。
 *   两者语义无关，且四种组合都有意义：
 *     个人开 + 不共享 / 个人开 + 共享 / 个人关 + 不共享 / 个人关 + 只读团队库。
 *   若复用一个键，开启团队共享会连带打开个人技能注入 —— 正是该规则禁止的行为。
 *
 * 默认 false：未显式开启时**逐字节等价于改造前**（不产生任何团队技能读写）。
 *
 * @param {object} cfg 插件 config（engine.config）
 * @returns {{enabled:boolean, mode:'off'|'push'|'push-pull', source:'default'|'config'|'fallback'}}
 */
export function resolveTeamSkillSharePre(cfg) {
  const c = cfg || {}
  const raw = c.teamSkillShare
  if (raw === true) return { enabled: true, mode: 'push-pull', source: 'config' }
  if (raw === false) return { enabled: false, mode: 'off', source: 'config' }
  if (raw === 'push') return { enabled: true, mode: 'push', source: 'config' }
  if (raw === 'push-pull') return { enabled: true, mode: 'push-pull', source: 'config' }
  // 缺省或非法 ⇒ 关闭（fail closed：团队共享是**对外动作**，不能靠猜开启）
  return { enabled: false, mode: 'off', source: raw === undefined ? 'default' : 'fallback' }
}
```

**片段 2**：接线说明（**不改本模块的解析函数**，在消费侧组合）。

```js
// ★ Teamwork：消费侧组合（示意，实际写在 context-host.js:537 / activation-host.js:330 附近）
//
// 顺序要求：**先问总闸、再问共享**。
//   总闸关 ⇒ 整条技能臂关闭，团队共享与否都无意义（且不应产生任何团队读写）；
//   总闸开 ⇒ 才检查团队共享，决定注入的候选集是否包含团队技能。
//
// 两条判据**各自独立**，任一为假都不注入团队技能，但**个人技能的行为只受总闸控制**：
//   const injectOn = resolveProcedureInjectEnabledPre(cfg)     // procedure-switch.js:26
//   const teamOn   = resolveTeamSkillSharePre(cfg).enabled     // 本文件新增
//   const candidates = teamOn ? localSkills.concat(teamSkills) : localSkills
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **复用总闸承载团队语义** | 图省事把团队开关塞进同一键 | 片段 1 独立键 + 注释；违反用户硬规则 |
| **总闸默认值被改回 false** | 误"恢复"旧行为 | 文件头已记录该默认值是 bug 根因；回归断言缺省返回 true |
| **口径漂移** | 某处 inline 自己判断开关 | 文件尾明文禁止；本模块是唯一解析口径 |
| **团队共享默认开启** | 缺省时误开 | 片段 1 fail closed（对外动作不靠猜） |
| **非法值静默开启** | 解析写成"非 false 即 true" | 白名单式判定 + source='fallback' 留痕 |

**既有测试/守卫**：`procedure-switch` 的两键优先级用例、`usesLegacyProcedureSwitchPre` 的迁移提示用例。**两个消费点（`context-host.js:537` / `activation-host.js:330`）是硬编码行号引用**，改开关语义必须同时复核这两处。
