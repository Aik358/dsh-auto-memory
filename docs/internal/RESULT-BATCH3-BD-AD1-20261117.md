# 批次3 · B3-BD-AD1 实施结果（硬门①–⑥ 修正版）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-45）
> 基线 HEAD **`dd8c87ec`**（**未提交**，等 Lead 亲自复核）
> 裁定：**六项硬门**（见下）；A1 草稿已由 Lead 撤回，本版为 A2' + 硬门修正

---

## 0. 六项硬门落实情况

| # | 硬门 | 落实 |
|---|---|---|
| ① | `legacy` 入 `HANDOFF_VIEW_TIERS`，原 tier 传入不改名；白板 legacy 独立兼容 + memLegacy 截流 | ✅ **已加入**（表现 10 项），`legacy` 可正常调用不再抛 `INVALID_ENUM` |
| ② | `_legacySlim` **优先于** profile：任何 tier（含 `human_full`）+ `memLegacy=true` 都必须 7节/2400/800 | ✅ `_bdFull = (_legacySlim !== true) && _ps.sections === null` —— `_legacySlim` 前置短路 |
| ③ | `run_full`/`hang_compensate` 走**核心节**（不扩大）；`human_full`/`handoff_carry`/`post_compact` 全文；`run_slim` 不投 | ✅ 严格由 `planSpecForTierPre` 决定，未采纳「全文档扩大」建议 |
| ④ | 账本 `legacy` 保留**四段加权预算**；full 选择后**仍必须 weightedTrim**；FM 负责最终预算 | ✅ 独立 `_LEDGER_FULL_TIERS` 映射 + `_finish()` 恒过 `weightedTrimHandoffLedgerPre` |
| ⑤ | 移除 BD 对 `_isFullTier` 依赖；空 catch 禁止吞档位错误，异常留 degradation 且走同档安全投影 | ✅ 两块均**零引用** `_isFullTier`；`_bdDegradations` 留痕 |
| ⑥ | 覆盖 8 档 × memLegacy、冲突 profile/tier、异常、重复请求、入口实参 + 最终字符验证 | ✅ **60 断言**全覆盖 |

---

## 1. 三元组与行尾

### `lib/index.js`（**全 CRLF**）

| 量 | 改前 | 改后 | Δ |
|---|---|---|---|
| 字节 | 2,187,629 | **2,194,383** | **+6,754** |
| 行数 | 30,060 | **30159** | **+99** |
| sha16 | `A947474502070B60` | **`A34DFB18C5D673BC`** | — |
| CRLF | 30,059 | **30158** | — |
| 裸 LF | 0 | **0** | 0 |
| 孤立 CR | 1 | **1** | **0（既有）** |
| sha256 | —— | **`a34dfb18c5d673bcbdaafb63e3c043e36f684c5a596ad6e9ddbf50e136d9329e`** | — |

### `lib/injection/project-handoff.js`（**全 LF**）

| 量 | 改前 | 改后 | Δ |
|---|---|---|---|
| 字节 | 9,992 | **13,721** | **+3,729** |
| 行数 | 223 | **278** | **+55** |
| sha16 | `6C7224C49171C189` | **`65B6EB2061932FA6`** | — |
| 行尾 | 全 LF | **全 LF**（裸 LF 277、CRLF 0） | 未混用 |
| sha256 | —— | **`65b6eb2061932fa6a981db0c169c2e7028385e2dd2b0a30dd323d56bdc6e42db`** | — |

---

## 2. 白板策略（硬门②③）

### 核心判定

```js
const _ps = (typeof planSpecForTierPre === 'function')
  ? planSpecForTierPre(_tier, cfg)        // ★严格锚生产既有函数
  : (内联同义实现)                          // 抽取式套件沙箱兜底
if (!_ps || _ps.inject === false) return ''  // run_slim 不投

// ★硬门②：_legacySlim 前置短路 —— full 不得绕过截流
const _bdFull = (_legacySlim !== true) && _ps.sections === null
const _bdPolicy = {
  profile: _bdFull ? 'full' : 'slim',
  planCoreSections: _bdFull ? null : (_legacySlim ? _LEGACY_CORE : _ps.sections),
}
```

### 8 档 × memLegacy 矩阵（实测字符数）

夹具：7 节 × 600 字符 = 4,200，原文 4,260

| tier | memLegacy=false | 预算 | memLegacy=true | 预算 |
|---|---|---|---|---|
| `human_full` | 4,239 | 8,000 | **2,400** | **2,400** |
| `human_slim` | 3,000 | 3,000 | **2,400** | 2,400 |
| `run_full` | 3,000 | 3,000 | **2,400** | 2,400 |
| `run_slim` | **0（不投）** | 3,000 | **0（不投）** | 2,400 |
| `post_compact` | 4,239 | 8,000 | **2,400** | 2,400 |
| `handoff_carry` | 4,239 | 8,000 | **2,400** | 2,400 |
| `hang_compensate` | 3,000 | 3,000 | **2,400** | 2,400 |
| `legacy` | 3,000 | 3,000 | **2,400** | 2,400 |

**16 种组合全部 ≤ 预算，无一超限。** 关键观察：

- `human_full` + `memLegacy=true`：**8,000 → 2,400**（硬门②成立，full 不得绕过）
- `run_full` / `hang_compensate`：**3,000 < 4,239**（走核心节，**未扩大为全文档**）
- `run_slim`：**恒 0**（不投白板）

---

## 3. 账本策略（硬门④）

### 独立显式映射

```js
const _LEDGER_FULL_TIERS = ['human_full','run_full','post_compact',
                            'handoff_carry','hang_compensate','legacy']
const _ledgerProfile = _LEDGER_FULL_TIERS.indexOf(String(_tier)) >= 0 ? 'full' : 'slim'
// ★full 选择后仍必须过四段加权预算（legacy 也不是无限全文）
const _finish = (sel) => weightedTrimHandoffLedgerPre(sel, _ledgerBudget) || sel
```

### 实测（恒等桩，看选择语义）

| tier | 保留段 | 字符 |
|---|---|---|
| `human_full` / `run_full` / `post_compact` / `handoff_carry` / `hang_compensate` / `legacy` | **四段全** | 70 |
| `human_slim` / `run_slim` | goal + dead-end + progress（**省略 type:state**） | 55 |

**两组可区分**（70 ≠ 55）⇒ 判据非恒真。**`legacy` 在 full 组但输出仍受 `_finish` 加权**。

---

## 4. 异常路径（硬门⑤）

| 场景 | 结果 |
|---|---|
| 白板投影抛错 | **非空**（1,211 字符，安全投影）+ **1 条 degradation**（`handoff-projection-failed`） |
| 白板抛错时预算 | **≤ `_planBudget`**（3,000），**未放大为全文**（4,260） |
| 账本投影抛错 | **1 条 degradation** + 输出仍**过四段加权**（≤40） |
| 公共模块整体不可用 | 退回**不依赖该模块**的 `_truncatePlanBySectionsInline`（生产既有路径） |

> ★关键修正：初版 `_safeSlim` 内部**又调用了同一个公共模块** ⇒ 若该模块本身故障，安全投影也返回 **0 字符（空白板）**。已补「不依赖公共模块」的最终兜底。

---

## 5. 负路径与重复请求（硬门⑥）

| 用例 | 结果 |
|---|---|
| `tier=slim` + `profile=full` | 实际 profile = **full**（**policy.profile 优先**，公共模块文档已声明） |
| `tier=human_full` + `profile=slim` | 实际 profile = **slim**（policy 优先） |
| 白板同输入连调 3 次 | 1,011 / 1,011 / 1,011 —— **完全一致，不累积不放大** |
| 账本同输入连调 2 次 | 70 / 70 —— 稳定 |

---

## 6. 被移除的依赖（硬门⑤）

| 位置 | 改前 | 改后 |
|---|---|---|
| 白板块 | `profile: _isFullTier ? 'full' : 'slim'` | **零引用** `_isFullTier` |
| 账本块 | `profile: _isFullTier ? 'full' : 'slim'` | **零引用** `_isFullTier` |

**为什么必须移除**：`_isFullTier` 属**规则层预算**语义（含 `LEGACY`、不含 `RUN_FULL`/`HANG_COMPENSATE`），与内容选节语义**不一致**：

| 档位 | `_isFullTier` | 内容应否全文 | 若沿用会怎样 |
|---|---|---|---|
| `legacy` | **true** | **否**（须截流） | 推 full ⇒ **截流失效** |
| `run_full` | **false** | **否**（核心节） | 推 slim ⇒ 碰巧对，但依据错 |
| `hang_compensate` | **false** | **否**（核心节） | 同上 |

---

## 7. 套件实跑（HEAD `dd8c87ec`）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-bd-adapter.mjs`（**重写，60 断言**） | 0 | **60** | 0 |
| `smoke-test-batch3-rp-adapter.mjs` | 0 | 53 | 0 |
| `smoke-test-batch3-ca-adapter.mjs` | 0 | 39 | 0 |
| `smoke-test-batch3-contract.mjs` | 0 | 99 | 0 |
| `smoke-test-batch3-rules-render.mjs` | 0 | 68 | 0 |
| `smoke-test-batch3-events.mjs` | 0 | 86 | 0 |
| `smoke-test-batch3-final-frame.mjs` | 0 | 93 | 0 |
| `smoke-test-batch3-cadence-projection.mjs` | 0 | 97 | 0 |
| `smoke-test-batch3-sources.mjs` | 0 | 64 | 0 |
| `smoke-test-batch3-cb.mjs` | 0 | 23 | 0 |
| `smoke-test-p6a-rules-layer.mjs` | 0 | 125 | 0 |
| `smoke-test-r26-cross-layer.mjs`（**重钉**） | 0 | 26 | 0 |
| `smoke-test-v4-h5-user-portrait.mjs` | 0 | 41 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **964** | **0** |

真实 apply：**22 tools / 86 routes / effect 2 / 注入槽 3 / 导出 41** 全不变。

---

## 8. 基线锁重钉

| 锁 | HEAD 值 | 本轮值 |
|---|---|---|
| LF 归一化 sha16 | `6A3C5E4C70D9CAA5` | **`4D7FDD4F3CC87959`** |
| `R153_CHARS` | 1,627,421 | **1,633,024**（Δ **+5,603**） |

归因：唯一漂移源 = 本轮 `lib/index.js` 三处（import + planPart 重写 + ledgerPart 重写）。复算用**套件自身管道**（`readFileSync(...).replace(/\r\n/g,'\n')`），非手填。

---

## 9. 未验边界与如实声明

1. **未做真实 HOST**：全部为 node 进程内真 import / 真调用 / 真 apply。
2. **未在真实会话观察白板/账本注入**：只验证模块行为与生产接线，**未看 prompt 里实际形态与字符数**。
3. **矩阵用的是抽取沙箱**：`planPart`/`ledgerPart` 块被抽到 `new Function` 并注入桩函数，**非完整引擎上下文**。
4. **`_planBudget` 语义变化**：白板现在多了一道「总预算截断」（`slice(0, _planBudget)`），与改前 `truncatePlanByPriority` 的**截断算法不同**（前者硬切，后者按优先级）。**未逐字节比对两者输出**。
5. **`legacy` 的 `_ps.sections` 为 `CORE7`**（非 `null`）⇒ 走 slim 核心节。这与「legacy 有独立兼容策略」一致，但**未与改前 `_truncatePlanBySectionsInline(7节/800)` 逐字节比对**。
6. **`sectionCapChars` 与 `_LEGACY_CORE` 的 800 单节上限**：我传的是 `_planSectionMax`（`_legacySlim` 时已被压到 800）⇒ 语义对齐，但**未独立验证**。
7. **FM 未联验**：整帧最终预算按裁定归 FM，本模块未参与。
8. **closed 事件选择未实现**（归 EV）。
9. **未跑全量回归**（只跑 14 个相关套件 964 PASS）。
10. **未 commit / 未 push**，等 Lead 亲自复核 diff 与输出。

---

## 10. 交付物

| 路径 | 说明 |
|---|---|
| `lib/injection/project-handoff.js` | **改**：legacy 入表 + policy 两键 + selectSections 接入 |
| `lib/index.js` | **改**：import + 白板（planSpec 锚定/legacySlim 优先/安全投影）+ 账本（独立映射/加权） |
| `tests/smoke/smoke-test-batch3-bd-adapter.mjs` | **重写**：60 断言（六硬门全覆盖） |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | 改：基线锁重钉 |
| `artifacts/_batch3-bd-ad1-20261117/` | triple / fingerprints / suite-runs / MANIFEST |

---

## 11. 复算校验

```powershell
# lib/index.js：期望 2,194,383 B / 30159 行 / A34DFB18C5D673BC
(Get-Item lib/index.js).Length
(Get-FileHash lib/index.js -Algorithm SHA256).Hash.ToLower()
# project-handoff.js：期望 13,721 B / 278 行 / 65B6EB2061932FA6
(Get-Item lib/injection/project-handoff.js).Length
```

```powershell
node tests/smoke/smoke-test-batch3-bd-adapter.mjs   # 期望 60 PASS
node tests/smoke/smoke-test-r26-cross-layer.mjs     # 期望 26 PASS
```

> 行尾：`lib/index.js` CRLF 30158 / 裸 LF 0 / 孤立 CR 1；`project-handoff.js` CRLF 0 / 裸 LF 277。
