
## procedure-observation

- **规模**：2,620 B / 49 行 / 6 个导出符号
- **交付形态**：**完整版**

### 职责

**「仅观察」判定** —— 文件头第一行就是判据本身：*"Episode-only rows cannot earn memory-ID evidence. Do not fabricate provenance or gates."*
即：**只由 episode 产生的观察行不能获得记忆 ID 级证据**，不得伪造 provenance 或门限。本模块是 procedure 晋升体系的**诚实性边界**。

### 数据流

```
procedure 候选行
   │
   ├─ isObservationOnlyPre(p)          L4    ★ 核心判据
   │     ├─ p.observationOnly === true                → true
   │     ├─ origin === 'user' ||
   │     │  (stage 存在且不是 observed/candidate)     → **false**（历史语义保留）
   │     └─ sourceEpisodes 非空 &&
   │        (!sourceMemoryIds || sourceMemoryIds 为空) → true
   │
   ├─ normalizeProcedureObservationPre(p)  L15  归一化
   ├─ procedureFingerprintPre(p)           L21  指纹（去重/匹配）
   ├─ matchingProcedurePre(...)            L27  匹配既有 procedure
   ├─ mergeProcedureSourcesPre(...)        L32  合并来源
   └─ newProcedureIdentityPre(...)         L38  新身份
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L4 | `isObservationOnlyPre(p)` | **核心判据**：是否仅观察 |
| L15 | `normalizeProcedureObservationPre(p)` | 归一化 |
| L21 | `procedureFingerprintPre(p)` | 指纹 |
| L27 | `matchingProcedurePre(...)` | 匹配 |
| L32 | `mergeProcedureSourcesPre(...)` | 合并来源 |
| L38 | `newProcedureIdentityPre(...)` | 新身份 |

### 内部关键实现

**1. 判据的三分支结构（L4-12，源码逐字）**

```js
export function isObservationOnlyPre(p) {
  if (!p || typeof p !== 'object') return false
  if (p.observationOnly === true) return true
  // Already validated/active, user-authored and deprecated history keeps its existing semantics.
  if (p.origin === 'user' || (p.stage && !['observed', 'candidate'].includes(p.stage))) return false
  return Array.isArray(p.sourceEpisodes) && p.sourceEpisodes.length > 0 &&
    (!p.sourceMemoryIds || p.sourceMemoryIds.length === 0)
}
```
⇒ **显式标记优先**（`observationOnly === true`）→ **历史语义保护**（user 来源或已进入后续阶段的**一律不算仅观察**）→ **启发式判定**（有 episode 但无 memoryId）。

**2. "不得伪造 provenance 或门限"是硬边界**

文件头把它写成祈使句，说明这是一条**给未来维护者的禁令**：不能为了让观察行晋升而编造证据或放宽门限。

**3. 被 procedure-store 直接依赖**

`procedure-store.js` 顶部 import 本模块的 `isObservationOnlyPre` 等 ⇒ 该判据贯穿 observe / promote / evaluatePromotion 全链（见 `procedure-store.js:453` 的 `isObservationOnlyPre(p)` 早退）。

### 与团队化的关系

**判定：S2 团队共享（判据必须全队一致）。**

理由：本判据决定"这条技能有没有资格拿证据"。团队场景下证据会来自多名成员，**如果判据在两端不同，同一条 procedure 在 A 端可晋升、B 端不可** ⇒ 团队技能库分叉。
**尤其关键**：团队共享会**放大证据量**，若判据被放宽，"仅观察"的条目可能因凑够多样性而错误晋升。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| PO1 | `isObservationOnlyPre` L4 | 三分支 | **不改判据**；团队来源（actorId）**不得**让它变宽松 | 纪律 |
| PO2 | `normalizeProcedureObservationPre` L15 | 本地归一 | 团队观察行携带 actorId；归一化时**保留**该字段 | 兼容 |
| PO3 | `procedureFingerprintPre` L21 | 本地指纹 | **不得掺入 actorId**（否则同一技能在两端指纹不同） | 纪律 |
| PO4 | `mergeProcedureSourcesPre` L32 | 合并来源 | 团队合并时来源要**可追溯**（保留每端 sourceRef） | 新增字段 |
| PO5 | 新增 `auditTeamEvidencePre` | 无 | 团队证据**卫生检查**：检出重复/无归属投递并如实标记 | 新增导出 |

#### 可直接落地的代码片段

**片段 1**：指纹**必须与团队身份无关**。位置：`procedure-observation.js:21`（`procedureFingerprintPre` 函数内）。

```js
export function procedureFingerprintPre(p) {
  const x = p || {}
  // ★ Teamwork 纪律：指纹**绝不掺入 actorId / groupId / 时间戳**。
  //   理由：指纹用于 matchingProcedurePre L27 判断"团队里这条是不是同一条技能"。
  //   若掺入来源身份，A 与 B 对同一条技能会算出不同指纹 ⇒
  //     ① 团队技能库出现重复条目（同一技能两份）；
  //     ② 证据被分散到两条上，**双方都达不到晋升门限** ⇒ 团队化反而让技能更难晋升。
  //   ⇒ 指纹只能由技能的**内容**（title + steps 等）派生。
  const parts = [String(x.title || ''), (Array.isArray(x.steps) ? x.steps : []).join(String.fromCharCode(10))]
  const canonical = parts.join(String.fromCharCode(9))
  // ...原有 hash 逻辑不变...
  return 'pf_' + sha256HexPre(canonical).slice(0, 24)
}
```

**片段 2**：团队证据卫生检查（新增导出，放文件末尾）。

```js
/**
 * 团队证据卫生检查 —— 检出**可疑的证据投递**，如实标记而非静默采纳。
 *
 * 与文件头的禁令同源："Do not fabricate provenance or gates."
 * 团队化之后证据来自多方，出现两类新风险：
 *   ① **重复投递**：同一 (actorId, sessionRef, kind) 的证据被投多次 ⇒ 多样性/成功数虚高；
 *   ② **无归属证据**：补丁缺 actorId ⇒ 无法判断是否真来自独立会话（却会被当成"独立"）。
 * 本函数只**标记**不篡改 —— 门限判定归 procedure-store，
 * 本模块不越权改门限（这也是文件头禁令的一部分）。
 *
 * @param {Array<{actorId?:string, sessionRef?:string, kind?:string, at?:number}>} rows
 * @returns {{clean:boolean, duplicates:number, unidentified:number, detail:Array}}
 */
export function auditTeamEvidencePre(rows) {
  const list = Array.isArray(rows) ? rows : []
  const seen = new Set()
  let duplicates = 0, unidentified = 0
  const detail = []
  for (const r of list) {
    if (!r) continue
    const actor = String(r.actorId || '')
    if (!actor) { unidentified++; detail.push({ at: Number(r.at) || 0, issue: 'missing-actor' }); continue }
    const key = actor + '|' + String(r.sessionRef || '') + '|' + String(r.kind || '')
    if (seen.has(key)) { duplicates++; detail.push({ at: Number(r.at) || 0, issue: 'duplicate', key: key }) }
    else seen.add(key)
  }
  return { clean: (duplicates === 0 && unidentified === 0), duplicates, unidentified, detail: detail.slice(0, 50) }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **判据被放宽** | 为让团队技能晋升而放松 | PO1 纪律 + 文件头禁令；回归断言"加 actorId 不改变 isObservationOnlyPre 结果" |
| **指纹掺入身份** | 为区分来源改指纹 | 片段 1 禁止；回归断言"仅改 actorId 时指纹不变" |
| **证据重复/无归属** | 团队补丁重投或缺 actorId | 片段 2 如实标记；不篡改门限 |
| **历史语义被改** | 动了 L9 的历史保护分支 | 该分支保护"已晋升/用户来源"的既有语义，改动会让老数据被误判为"仅观察" |

**既有测试/守卫**：`procedure-observation` 的判据用例；`procedure-store` 的多处调用（`:453` 早退、`promote` 路径）依赖它。
