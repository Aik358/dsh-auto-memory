# 施工 Prompt · 注入截流方案（P1 阶段）

> **给谁**：实现 Agent（可直接照做）。
> **依据**：INJECTION-THROTTLE-DECISION-2026-10-26.md（决定文档，先读它）。
> **范围**：本 prompt 只覆盖 **P1**（低风险、可独立交付）。P2/P3/P4 另发。

---

## 0. 硬约束（违反即失败）

1. **禁止整文件 write** 任何 >500 行的文件（lib/index.js 1.26MB / lib/client.js 2.28MB）——只用定点 edit（内容锚定）。
2. **改前端必须跑** `smoke-test-client-loadable`（真 factory 守卫）。
3. **改生成区必须改源 + 重新生成**，跑 `node tools/gen-ev4-blocks.mjs --check`。
4. **计数锁红必须先归因**（真缺陷 or 判据过期），禁止整批回滚。
5. **每条新断言必须带负路径**（不满足条件时必须不触发）。
6. **禁止用「源码含某字符串」当功能验收**（只能是守卫，须注明）。
7. 发布类动作（提交/推送/改版本号）**等我明确指令**。

---

## 1. P1 任务清单（按顺序做，每步可独立验证）

### T1 · 修正设置页文案（fSnapGapHint 的「默认 10」→「默认 20」）

**位置**：`lib/client.js` 约 L534

**当前**：
```js
fSnapGap: '完整版间隔(模型请求)', fSnapGapHint: '每 N 次**模型请求**（即每个 step，不是对话轮、也不是工具调用次数）注入一次完整版快照，用来防止长任务里模型对上下文漂移。默认 10。0=每个模型请求都尝试（仍受内容变化去重约束）。★口径说明：一次用户发消息触发的整段工作算 1 个对话轮，其中可能包含几十上百次模型请求；本键数的是后者。',
```

**改为**：把「默认 10」改成「默认 20」，并补一句：
```text
默认 20（2026-10 实测从 10 上调：10 在长任务里模型漂移明显，20 实测更稳）。
```

**验收**：
- 断言 `fSnapGapHint` 里含「默认 20」且**不含**「默认 10」。
- 断言代码常量 `DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS === 20`。
- **变异验证**：把常量改回 10 ⇒ 上述文案断言必须变红（证明判据有鉴别力）。

---

### T2 · 新增 6 个配置键

**位置**：`lib/index.js` 的 `DEFAULT_CONFIG`（约 L760-900 区）

**新增**：
```js
/** ★2026-10-26（记忆中拟合裁定）：两轮「用户发声完整版」之间新增输出 token 的间隔。0=禁用 token 节流（退回按轮）。 */
fullInjectTokenGap: 250000,
/** 精简版给「当前事件最近 N 条检查点」。只允许 3/5/7，非法值回落 3。 */
slimCheckpointCount: 3,
/** 挂机代位补偿阈值（累计输出 token）。仅当 hangCompensateEnabled=true 时生效。 */
hangCompensateTokens: 300000,
/** 压缩后是否注入完整版（F5）。 */
fullInjectOnCompact: true,
/** 精简档（F2/F4）总字符预算。 */
fullInjectSlimBudgetChars: 3000,
/** 挂机代位补偿总开关。★默认 false（用户裁定：先做但默认关，更保险）。 */
hangCompensateEnabled: false,
```


**验收**：
- 6 个键全部在 DEFAULT_CONFIG 中可读到，类型正确。
- `slimCheckpointCount` 传 4 或 999 时回落 3（负路径）。

---

### T3 · 同步计数锁（165 → 171）

**必须改的地方**（全仓 grep 确认，不能漏）：
1. `tools/verify-docs.mjs` 的预期计数常量
2. `docs/WHITEPAPER.md` 的设置键计数
3. `docs/HOMEPAGE-CONTENT-FOR-GM53.md` 的计数
4. `README.md` / `README.zh-CN.md`（若有计数）
5. 白皮书/手册里所有出现「165」且指配置键的位置

**做法**：
```bash
# 先全仓找所有出现点
grep -rn "165" docs/ README*.md tools/verify-docs.mjs lib/index.js | grep -i "配置键\|config" 
```

**验收**：
- `node tools/verify-docs.mjs` EXIT=0，且输出「配置键 171」。
- **负路径**：故意把某份文档改回 165 ⇒ verify-docs 必须变红。

---

### T4 · 白板按「节」投递（替代字符截断）

**位置**：`lib/index.js` L1559 `truncatePlanByPriority` 的调用点（L9741）

**新增函数**（放在 `truncatePlanByPriority` 附近）：
```js
/**
 * ★2026-10-26（拟合裁定）：**按节白名单**投递白板，替代纯字符截断。
 *
 * 为什么需要它：truncatePlanByPriority(text, 1200) 是"字符截断 + 关键词打分"，
 * 实测导致「★★最新实况」这类不含优先词的节**第一个被砍** ⇒ 白板最新内容永远进不了注入面。
 *
 * 语义：
 *   - sections 为 null/undefined ⇒ 退回 truncatePlanByPriority（向后兼容）
 *   - sections 为数组 ⇒ 只保留标题命中该数组的节（子串匹配），每节再按 perSectionMax 限长
 *   - 命中 0 节 ⇒ 返回空串（**不静默回落全文**，避免超预算）
 */
const truncatePlanBySections = (text, sectionWhitelist, perSectionMax) => {
  const src = typeof text === "string" ? text : ""
  if (!src.trim()) return ""
  if (!Array.isArray(sectionWhitelist) || !sectionWhitelist.length) return null
  const lines = src.split("\n")
  const out = []
  let cur = null
  let curTitle = ""
  const flush = () => {
    if (!cur) return
    const hit = sectionWhitelist.some((w) => String(w) && curTitle.indexOf(String(w)) >= 0)
    if (hit) {
      const body = cur.join("\n")
      const cap = Number(perSectionMax) > 0 ? Number(perSectionMax) : 2000
      out.push(body.length > cap ? body.slice(0, cap) + "\n…(本节超长已截断)" : body)
    }
    cur = null
  }
  for (const line of lines) {
    if (/^## /.test(line)) { flush(); curTitle = line; cur = [line] }
    else if (cur) cur.push(line)
  }
  flush()
  return out.join("\n\n")
}
```

**调用点改法**（L9739-9741）：
```js
const _planBudget = Math.max(Number(cfg.handoffPlanChars) || 1200, 200)
const _planRaw = stripSensitiveSections(sanitizeForInjection(s.planText || ""))
// ★按节白名单优先；未配置白名单时退回原字符截断（fail-closed，不改变旧行为）
const _planSections = Array.isArray(cfg.handoffPlanSections) ? cfg.handoffPlanSections : null
const planPart = (() => {
  if (_planSections) {
    const bySec = truncatePlanBySections(_planRaw, _planSections, cfg.handoffPlanSectionMax)
    if (bySec !== null) return bySec
  }
  return truncatePlanByPriority(_planRaw, _planBudget) || truncateLinesBounded(_planRaw, _planBudget)
})()
```

**验收**：
- 负路径 1：`handoffPlanSections` 未配置 ⇒ 行为与改前**逐字节相同**（断言注入文本 hash 不变）。
- 负路径 2：白名单命中 0 节 ⇒ 返回空串（断言不含白板标题）。
- 正例：白名单 `['最新实况','当前目标']` ⇒ 注入文本含这两节标题，**不含**「★E 批」节。
- 正例：全文长度 > perSectionMax ⇒ 出现「本节超长已截断」标记。

---

### T5 · 节名命中优先词（白板自身改造）

**位置**：白板 PLAN.md 本身（`~/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/PLAN.md`）

**改动**：
- 把「## ★★最新实况 · 2026-10-26（v4 收口后 · Lead 独立实测）」
- 改为「## ★当前进展与最新实况 · 2026-10-26」

理由：`PLAN_SECTION_PRIORITY_RE = /(目标|待办|下一步|硬约束|当前|进度|待用户|裁决|风险)/`，
「当前进展」双命中 ⇒ 即使在旧字符截断路径下也优先保留。

**注意**：这是**记忆文件**改动，不是源码。用 `memory_note(kind=plan)` 重写，必须带 `expectedRevision` 且完整抄回全部锚点（当前 42 个）。

---

## 2. P1 验收清单（全部必须绿）

| # | 项 | 判据 |
|---|---|---|
| 1 | T1 文案 | fSnapGapHint 含「默认 20」不含「默认 10」；变异回 10 必红 |
| 2 | T2 配置键 | 6 键可读 + 非法值回落 |
| 3 | T3 计数锁 | verify-docs EXIT=0 且显示 171 |
| 4 | T4 白板按节 | 4 条验收（2 负 2 正）全绿 |
| 5 | T5 节名 | 白板锚点仍 42 个、无重复 |
| 6 | 回归 | 全量 PASS >= 511 / FAIL 0 / TIMEOUT 0 |
| 7 | 前端守卫 | client-loadable 全绿 |
| 8 | 生成区 | gen-ev4-blocks --check OK |

---

## 3. 拿不准时停下报告 Lead

以下情况**必须停**，不要自行决定：
1. 计数锁红且归因不明（真缺陷 or 判据过期？）
2. 白板按节投递导致既有套件的字节断言红（需判断是判据过期还是真缺陷）
3. 发现配置键在 11 份文档之外还有第 12 处出现点
4. 任何需要改 `lib/ev4-prototype-blocks.js` 原型源码的情况

---

**Prompt 版本**：v1.0（2026-10-26，配合决定文档 v1.0）
