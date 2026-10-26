# P3 验收记录 · 按档位差异化内容 + semantic-recall（2026-10-26）

> 用户核心裁定：「用户发声的完整版 / 用户发声的精简版 / 运行当中的完整版 / 运行当中的精简版 /
>   压缩后的完整提醒 / 交接的文档注入 —— 要**分开考虑，不可混为一谈**。」

---

## 1. 交付内容

### 1.1 按档位差异化（P3 第一件事）

| 组件 | 落点 | 说明 |
|---|---|---|
| `INJECT_TIERS` 枚举 | `lib/index.js` L1716 | 8 档（含 LEGACY 回退档） |
| `decideInjectTierPre(p)` | L1776 | 档位判定，含优先级 |
| `planSpecForTierPre(tier, cfg)` | L1795 | 白板投递规格 |
| 4 个谓词 | L1734-1743 | isHumanTier / isPlanFullTier / shouldInjectPlan / isRulesFullTier |
| `PLAN_CORE_SECTIONS` | L1755 | 核心 3 节白名单 |
| 渲染层内联 `_T` / `_planSpec` | `renderMemoryDynamic` 内 | **必须内联**（见 §4.1 事故） |
| 外层档位写入 | `snap` 渲染之前 | 写 `st._injectTierPre` |

**七档 → 白板投递**：

| 档位 | 白板 | 预算 |
|---|---|---|
| F1 HUMAN_FULL | **全文** | handoffPlanChars |
| F6 HANDOFF_CARRY | **全文** | handoffPlanChars |
| F2 HUMAN_SLIM | 核心 3 节 | fullInjectSlimBudgetChars |
| F3 RUN_FULL | 核心 3 节 | fullInjectSlimBudgetChars |
| F5 POST_COMPACT | 核心 3 节 | fullInjectSlimBudgetChars |
| F7 HANG_COMPENSATE | 核心 3 节 | fullInjectSlimBudgetChars |
| F4 RUN_SLIM | **不投** | — |
| **LEGACY**（档位缺失） | **全文** | handoffPlanChars（= 改前行为） |

### 1.2 semantic-recall 预留段（P3 第二件事）

**用户要求的引导语（逐字）**：
> 【以下是自动机引擎检索到的相关情感、共同经历和用户喜好的相关内容，可做参考】

**实现**：

| 项 | 内容 |
|---|---|
| 段名 | `semantic-recall`（bucket=`otherDynamic`） |
| 段标题 | `[长期关系记忆 —— 以下是自动机引擎检索到的相关情感、共同经历和用户喜好的相关内容，可做参考]` |
| 内容来源 | ① 用户画像前 240 字符（做基调）② `sharedExperienceText`（共同经历，最多 6 条、每条 ≤120 字） |
| 字符上限 | `fullInjectSemanticChars = 800`（用户裁定「量不能太多」） |
| 投递范围 | **仅** F1/F2（人声档）+ F5（压缩后）+ F6（交接）—— **运行档不投** |
| 零字节纪律 | 无画像且无共同经历 ⇒ 整段不 push（连引导语都不出） |
| 11 月底切换 | 模型上线后**在引导语下方追加**召回结果，**段位与引导语不变** ⇒ 零迁移 |

**新增预计算**：`state.sharedExperienceText` —— 从事件的 `accepted`/`used` 感知抽取（与画像同源但语义不同：画像=「他偏好什么」，共同经历=「我们一起做过什么」）。

---

## 2. 验收结果

### 2.1 新套件 `smoke-test-v5-p3-tier-content.mjs`：**PASS 44 / FAIL 0**

| 组 | 条数 | 覆盖 |
|---|---|---|
| A | 12 | 档位判定（7 档 + 优先级 + 空参数不崩） |
| B | 9 | 白板投递规格（全文/3节/不投 + 预算可配） |
| C | 9 | 4 个谓词（含负路径） |
| D | 6 | 端到端：真跑 `truncatePlanBySections` + **真实白板** |
| E | 8 | semantic-recall（配置键/引导语/投递范围/零字节） |

### 2.2 端到端（真数据）

真实白板 **24,549 字符**：
- 瘦档（核心 3 节）→ **4,064 字符 = 16.6%**
- 含「最新实况」「当前目标」✓
- 全文档（sections=null）→ 返回 `null` ⇒ 调用方走全文路径 ✓

### 2.3 变异验证：**5 / 5 全部能红**

| # | 变异 | 结果 |
|---|---|---|
| m1 | F1 不再给全文 | **B-1/B-2 红** |
| m2 | F4 也投白板 | **B-7/C-6 红** |
| m3 | 优先级错乱（压缩后 > 交接） | **A-8 红** |
| m4 | semantic-recall 去掉档位守卫 | **E-5/E-6 红** |
| m5 | 人声谓词失效 | **C-2/C-3 红** |

> m3 首次未红是因为**锚点用 `\n` 而文件是 CRLF**（探针未命中）。改用 CRLF 锚点后精确变红。
> 这是本仓反复踩的坑，已再次验证。

---

## 3. 可复算物理量

| 项 | 值 |
|---|---|
| `lib/index.js` LF 长度 | 1,277,242 → **1,289,548**（Δ **+12,306**） |
| `lib/index.js` LF sha16 | `638437B9FEE67A55` → **`9910C79AAA333631`** |
| `lib/client.js` classicLF 长度 | 1,371,755 → **1,372,106**（Δ **+351**） |
| `lib/client.js` classicLF sha256 | `92dec88c…` → **`4141f989…`** |
| 配置键数 | 173 → **174**（+`fullInjectSemanticChars`） |
| 设置页控件 | 三面同步（frozen / settings-copy / SettingsPage） |

---

## 4. 事故与修复（本批最重要）

### 4.1 ★★`ReferenceError: INJECT_TIERS is not defined` —— 10 个套件全红

**现象**：首轮全量回归 `PASS 502 / FAIL 11`，其中 10 个是真失败（不是抖动）。

**根因**：`renderMemoryDynamic` 被 **20+ 个套件用 `new Function` 抽出执行**，抽出的沙箱里**没有模块级 const**。我最初在函数体里直接引用了模块级的 `INJECT_TIERS` / `isPlanFullTierPre` / `planSpecForTierPre` ⇒ 全部 ReferenceError。

**修复**：在函数体内**内联** `_T` 常量对象与 `_planSpec` 计算逻辑（与模块级版本逐字等价）。

**这是本仓已固化的教训**（「抽取式测试新增模块级依赖必须内联或补注入」），我这次又踩了。

**修复后**：a13 / c1 / c3 / context-observer / smoke-test 等 6 个立即转绿。

### 4.2 ★LEGACY 档 —— 为什么必须有第 8 档

**现象**：`smoke-test-handoff` 红（`PLAN 段硬预算截断(段长 2149,尾部未注入)`）。

**根因**：档位缺失时我回退到 `RUN_FULL`，而 `RUN_FULL` 是**明确档位**，会走瘦档预算（3000）与核心 3 节白名单 ⇒ **那是新行为**。但「档位缺失」必须退化为**改前行为**。

**修复**：新增 `LEGACY` 档 —— 全文 + `handoffPlanChars` 预算 + 不投 semantic-recall，与 P3 之前**逐字节等价**。

**教训**：「fail-open」不等于「回退到某个看起来安全的档位」，而是「回退到**没有任何改动**的行为」。

### 4.3 ★`frozen` 文件被写成 CRLF

**现象**：`smoke-test-h43-theme-sync` 红 —— `skins/legacy/iter5-325.js.frozen 必须保持纯 LF`。

**根因**：我用脚本插入控件时按 CRLF 拼行，把整文件翻了面（实测 CRLF=1、bareLF=2440）。

**修复**：归一为纯 LF（CRLF=0、bareLF=2441），重跑生成器。

### 4.4 哈希锁重钉

两个锁按实测重钉（判据过期，非缺陷）：
- `iter5-skin` classicLF sha256：`92dec88c → 4141f989`（Δ+351）
- `r26` sha16 + `R152_CHARS`：`638437B9 → 9910C79A`；`1,277,242 → 1,289,548`（Δ+12,306）

---

## 5. 回归结果

| 轮次 | 结果 | 说明 |
|---|---|---|
| 首轮 | PASS 502 / FAIL 11 | **真失败 10 个**（ReferenceError）+ 1 抖动 ⇒ 已修 |
| 第二轮 | PASS 508 / FAIL 5 | 4 抖动 + 1 真失败（frozen CRLF）⇒ 已修 |
| 第三轮 | PASS 512 / FAIL 1 | `v4-c2-slim-events` **单跑 3 次全 PASS**（39/0）⇒ 抖动 |
| 第四轮 | （卡死中断，未完成） | — |

**最终验证方式（按用户要求，不再反复跑全量）**：
针对性跑 **25 个**与注入/渲染/前端/事件相关的套件 ⇒ **PASS 25 / FAIL 0**。

覆盖：`v5-p1/p2/p3` · `v4-c1/c2/c3/c4` · `v4-h3*` · `handoff` · `frozen-mirror` · `settings-parity` · `h43-theme-sync` · `iter5-skin` · `r26` · `a13-inject-seg-chars` · `context-observer` · `client-loadable`。

---

## 6. 闸门

| 闸门 | 结果 |
|---|---|
| `node --check` index.js / client.js | OK |
| client-loadable（真 factory） | **PASS 17 / FAIL 0** |
| gen-ev4-blocks --check | OK（128,858） |
| build-iter5-skin --check --strict | **SYNC-OK** |
| verify-docs | **EXIT=0**（21 / 80 / **174**） |
| frozen 纯 LF | CRLF=0 |

---

## 7. 未做（P4 范围）

| 项 | 状态 |
|---|---|
| F7 挂机代位补偿 | ⬜ P4（含视觉 Agent 测试章程） |
| 规则段按档位差异化 | ⚠️ 谓词已备（`isRulesFullTierPre`），**尚未接入规则段渲染**（F4 仍给全文） |
| 画像段按档位差异化 | ⚠️ 已有 `isHumanTierPre`，**尚未接入画像段**（运行档仍可能投画像） |

> 说明：P3 已完成**白板投递差异化**与 **semantic-recall**（用户明确命名的两件事）。
> 规则段/画像段的档位化属**内容细化**，留 P4 一并收。

**记录版本**：v1.0（2026-10-26）
