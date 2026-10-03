
## wb-contract

- **规模**：35,381 B / 692 行 / 20 个导出符号
- **交付形态**：**完整版**

### 职责

**白板格式适配器**（`wb_contract_pre_v1`）—— 白板线**拥有「白板格式及其适配器」**。它一次性承担三件事：①解析白板 Markdown 为结构化卡片（`parseWhiteboardPre`）；②**lint**（`lintWhiteboardPre`）；③**判据门**（`checkHandoffCriteriaPre` / `checkPlanCriteriaPre`）并把解析结果投影成 `memory-mutation` 需要的规范化形状（`toMutationProjectionPre`）。
**格式只维护一份**：`memory-mutation` 不解释格式，一切格式语义都在本模块。

### 数据流

```
白板 PLAN.md / 交接账本文本
   │
   ▼
parseWhiteboardPre(text)   L118   ★ 唯一解析入口
   ├─ 按 WB_ANCHOR_RE_PRE_V1 L35 / WB_MARKERS_PRE_V1 L38 切卡片
   ├─ computeWhiteboardCardIdPre L97   卡片**稳定 id**
   ├─ WB_STATUSES_PRE_V1 L51          卡片状态
   └─ WB_REASONS_PRE_V1  L54 / describeWbReasonPre L72   原因码与文案
        │
        ├──▶ lintWhiteboardPre(parsed, opts)   L321   （WB_LINT_VERSION L284 / WB_LINT_CODES_PRE_V1 L287 / WB_LINT_DEFAULTS_PRE_V1 L296）
        │
        ├──▶ extractProtectedRegionsPre(parsed)  L462   ★ 受保护区域
        │
        ├──▶ toMutationProjectionPre(parsed)      L484   → memory-mutation 输入
        │        （产出 {afterIds, protectedRegions, cards, issues}）
        │
        └──▶ checkHandoffCriteriaPre(text)  L540   / checkPlanCriteriaPre(text)  L647
                 （CRITERIA_GATE_VERSION L506 / HANDOFF_REQUIRED_SECTIONS_PRE_V1 L509
                  / CRITERIA_PLACEHOLDERS_PRE_V1 L514 / CRITERIA_LIMITS_PRE_V1 L517
                  / criteriaRefusalTextPre L684）
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L32 | `WB_CONTRACT_VERSION` | `wb_contract_pre_v1` |
| L35 | `WB_ANCHOR_RE_PRE_V1` | 卡片锚点正则 |
| L38 | `WB_MARKERS_PRE_V1` | 卡片标记集合 |
| L51 | `WB_STATUSES_PRE_V1` | 卡片状态枚举 |
| L54 | `WB_REASONS_PRE_V1` | 原因码枚举 |
| L72 | `describeWbReasonPre(code)` | 原因码 → 文案 |
| L97 | `computeWhiteboardCardIdPre(card)` | **卡片稳定 id** |
| L118 | `parseWhiteboardPre(text)` | **唯一解析入口** |
| L321 | `lintWhiteboardPre(parsed, opts)` | lint |
| L462 | `extractProtectedRegionsPre(parsed)` | **受保护区域** |
| L484 | `toMutationProjectionPre(parsed)` | → memory-mutation 投影 |
| L540 | `checkHandoffCriteriaPre(text)` | 账本判据 H1–H4/S1–S4 |
| L647 | `checkPlanCriteriaPre(text)` | PLAN 判据 P-H1/P-H2/P-S1 |
| L684 | `criteriaRefusalTextPre(report)` | 拒绝文本 |

### 内部关键实现

**1. 判据不能张冠李戴（L497-499，v2 修正）**

注释逐字：*"⚠️ **判据不能张冠李戴**（v2 修正，务必遵守；`ROUND3 §2.2` 把我方原写法判为**实质错误**）：H1–H4/S1–S4 是**交接账本**的判据；PLAN 是自由全貌文档（节名不固定，P7 老化按标题分类），其判据**刻意保持最弱** = P-H1/P-H2/P-S1。把账本判据套给 PLAN 会**误拒合法白板**。"*

**2. 与共同保护的关系（L501-503）**

*"本判据门是**可选质量门**，`criteriaGate=false` 只退掉它；**丢卡 / 用户区 / 重复 id 三条保护在 `memory-mutation.js` 里，无条件生效**，任何开关都绕不过。"*
⇒ 这是**分层保护**：可选的质量门 + 不可绕过的安全门。团队化新增任何开关都必须遵守同样的分层。

**3. 段名真源不另写（L509-511）**

`HANDOFF_REQUIRED_SECTIONS_PRE_V1` 由 `HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1`.map 而来 ⇒ **与 handoff-anchor.js 同源**，不另写一份。

**4. 占位符黑名单（L514）**

`CRITERIA_PLACEHOLDERS_PRE_V1` 用**小写比对**（L524 的 `PLACEHOLDER_SET`）⇒ 大小写不敏感地识别"未填写"。

**5. 阈值与 sanitizeForWrite 同源（L517-522）**

`handoffMaxChars: 8000` / `planMaxChars: 200000` —— 注释说明"**先于它执行**以免双重截断语义混乱"。⇒ 截断只应发生在一处。

### 与团队化的关系

**判定：S2 团队共享（交接账本与白板正是团队协作产物）+ S3 派生重算（解析/lint/投影）。**

理由：白板是"项目全貌"，账本是"交接记录" —— 二者的**读者在团队场景下会变成队友**。**解析、lint、投影**是纯派生（无 IO、纯函数），不同步；但**格式版本（`WB_CONTRACT_VERSION`）必须全队一致**：若 A 用 v1 解析、B 用 v2 解析同一份白板，卡片 id 与受保护区域会不同 ⇒ 保护门在两端行为不一致。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| WB1 | `WB_CONTRACT_VERSION` L32 | 本地常量 | 纳入团队握手；版本不一致时**拒绝解析他人白板**（fail closed） | 新增校验 |
| WB2 | `computeWhiteboardCardIdPre` L97 | 本地派生 | 保持确定性（**不得掺入 actorId**），团队靠它对齐卡片 | 纪律 |
| WB3 | `extractProtectedRegionsPre` L462 | 本地判定 | 团队白板的"用户区"定义必须**同一版本**，否则保护范围不同 | 依赖 WB1 |
| WB4 | 新增 `assertWbContractCompatPre` | 无 | 版本兼容断言 | 新增导出 |
| WB5 | `lintWhiteboardPre` L321 | 本地 lint | 团队 lint 结果**分端记录**（谁的白板有 issue） | 新增字段 |

#### 可直接落地的代码片段

**片段 1**：白板格式版本兼容断言（新增导出，放文件末尾）。**fail closed。**

```js
/**
 * 白板格式版本兼容性断言 —— **fail closed**。
 *
 * 为什么必须 fail closed：cardId 与 protectedRegions 都由**解析结果**派生
 * （computeWhiteboardCardIdPre L97 / extractProtectedRegionsPre L462）。
 * 若两端用不同版本的解析器处理同一份白板：
 *   · cardId 可能不同 ⇒ 团队对齐失效，同一张卡被当成两张；
 *   · protectedRegions 可能不同 ⇒ **保护门在其中一端形同虚设**（该拦的没拦）。
 * 后者是数据丢失级风险，所以版本不一致时拒绝解析/应用远端白板，而不是"尽力而为"。
 *
 * @param {string} localVersion 本机 WB_CONTRACT_VERSION
 * @param {string} remoteVersion 远端白板携带的版本（缺失视为不兼容）
 * @returns {{ok:boolean, reason?:string}}
 */
export function assertWbContractCompatPre(localVersion, remoteVersion) {
  const L = String(localVersion || '')
  const R = String(remoteVersion || '')
  // 缺版本 ⇒ 无法判断 ⇒ 拒绝（不要假设"没写就是同版本"）
  if (!R) return { ok: false, reason: 'remote-wb-version-missing' }
  if (R === L) return { ok: true }
  return { ok: false, reason: 'wb-version-mismatch:' + R + '!=' + L }
}
```

**片段 2**：卡片 id 必须**保持内容确定性**（不得掺入团队身份）。位置：`wb-contract.js:97`（`computeWhiteboardCardIdPre` 函数内，注释与实现之间）。

```js
export function computeWhiteboardCardIdPre(card) {
  const c = card || {}
  // ★ Teamwork 纪律：cardId **绝不掺入 actorId / groupId / 时间戳**。
  //   理由：cardId 是团队两端对齐"这是同一张卡"的**唯一凭据**。
  //   若掺入 actorId，A 与 B 对同一张卡会算出两个 id ⇒
  //     ① 团队卡片去重失效（同一张卡出现两次）；
  //     ② memory-mutation 的丢卡保护把"对方重命名的同一张卡"判为新卡，
  //        把本地卡判为"消失" ⇒ **误报丢卡并拒绝写入**。
  //   ⇒ cardId 只能由**内容**派生（标题 + 序号等稳定量），与"谁在什么组里"无关。
  const parts = [String(c.title || ''), String(c.section || ''), String(c.ordinal == null ? '' : c.ordinal)]
  const canonical = parts.join(String.fromCharCode(9))
  // ...原有 hash 逻辑不变...
  return 'wb_' + sha256HexPre(canonical).slice(0, 24)
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **两端解析版本不一致** | 一端升级一端未升级 | 片段 1 fail-closed；WB1 纳入握手 |
| **cardId 掺入团队身份** | 为"区分来源"改 cardId | 片段 2 明令禁止；回归断言"仅改 actorId 时 cardId 不变" |
| **判据张冠李戴** | 把 H1–H4 套给 PLAN | L497-499 明文禁止；两条判据函数分开 |
| **保护门被开关绕过** | 新开关顺带关掉 protection | L501-503 分层纪律：保护在 memory-mutation 里无条件生效 |
| **两处截断** | lint/解析各截一次 | L517 阈值与 sanitizeForWrite 同源，先于它执行 |

**既有测试/守卫**：`wb-contract` 的解析/lint/判据用例；`ledger-criteria.js:18` 明确**再导出**本模块的判据函数并注释"本模块勿重复造轮，统一转发保持单一真源" ⇒ **判据函数签名被两处引用**，改动会打红 `ledger-criteria` 侧。
