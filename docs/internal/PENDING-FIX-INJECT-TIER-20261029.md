# 待修清单 · 注入档位体系（INJECT-TIER）续修

> 来源：`docs/internal/INJECT-TIER-DOUBLE-CHECK-REPLY-20261028.md`（2026-10-28 交叉检验回执）
> 核验：2026-10-29 逐条抽真源码 + 真跑验证脚本 + 真引擎渲染
> 背景：该文档提出的修复**修到一半就转去修「提示词」问题**，本清单列出未修完项

---

## §0 结论速览

| 状态 | 数量 | 说明 |
|---|---|---|
| ✅ 已修完 | 5 | P0-A / P0-B / P1-C(部分) / 死配置(部分) / planCap |
| ⚠️ **半修** | 2 | P1-C 只剩 `legacy` 一档漂移；`snapshotReinjectOnCompact` 前端仍渲染但后端死键 |
| ❌ **未修** | 3 | `fullInjectOnCompact` 死键；`run_slim` 完整帧事件卡（已修）；文档说未修 |
| 📋 待补验证脚本 | 2 | v3/v4 脚本捕获方式过期，需修脚本才能当证据 |

---

## §1 ✅ 已确认修完（不用再动）

| # | 项 | 核验证据 |
|---|---|---|
| **P0-A** | `_compactSeqSeenPre` 首帧基线保护 | `lib/index.js:20809` 有 `=== undefined` 基线分支；`.verify-tmp/v2-state.mjs` 真跑 **PASS 7 / FAIL 0**（文档当时是 4/3） |
| **P0-B** | `post_compact` 强制完整版短路 | `lib/index.js:21565` `if (_postCompactForceFull || ...)`；`:21583` `else if (!_postCompactForceFull && ...)` 两侧都接了 |
| **planCap** | 改取白板实际预算 | `lib/index.js:11182-11184` `planCap = _planCapFullIdx ? max(injectBudgetChars, _planCapSlim) : _planCapSlim` |
| **run_slim 事件卡** | 完整帧已砍 | `lib/index.js:10778` `const _evCardsOk = !(_tier === _T.RUN_SLIM)` + `:10779` 门控 |
| **「刚才压缩了」提示** | 已补 | `lib/index.js:10474` `pushPart('otherDynamic', 'post-compact-notice', '\n[上下文已压缩] …')` |

> ⚠️ 最后一项（post-compact-notice）当初漏了 **zone 注册**，被 `smoke-test-v4-b2-zone-registry` 抓出，已补 `lib/injection-zones.js`。

---

## §2 ⚠️ 半修 · 必修

### T1 · P1-C 残留：`isPlanFullTierPre` 的 `legacy` 档仍与内联漂移

**实测**（2026-10-29 真跑逐档对比）：

```
档位                模块级 isPlanFullTierPre    生产内联 _planSpec.fullTier
legacy              true                        → false  ← ★唯一剩余漂移
human_full          true                           true
human_slim          false                          false
run_full            false                          false
run_slim            false                          false
post_compact        true                           true   ← 已修好
handoff_carry       true                           true
hang_compensate     false                          false
```

**证据**：

```
模块级 lib/index.js:1789
  const isPlanFullTierPre = (tier) => tier === HUMAN_FULL || tier === HANDOFF_CARRY
                              || tier === POST_COMPACT || tier === LEGACY
内联   lib/index.js:10451 附近
  const fullTier = _tier === _T.HUMAN_FULL || _tier === _T.HANDOFF_CARRY || _tier === _T.POST_COMPACT
  ↑ 【没有 LEGACY】
```

**为什么 legacy 该是 false**：内联把 `LEGACY` 单独走了 `_T.LEGACY` 分支（因为 legacy 要按 `_legacySlim` 强制白名单），所以它不属于 `fullTier`。

**修法（二选一）**：

```js
// 方案 A（推荐，改动最小）：模块级去掉 LEGACY
const isPlanFullTierPre = (tier) => tier === INJECT_TIERS.HUMAN_FULL
  || tier === INJECT_TIERS.HANDOFF_CARRY || tier === INJECT_TIERS.POST_COMPACT

// 方案 B（根治）：删整簇，让模块级从内联派生（单一真源）
//   删 isPlanFullTierPre / shouldInjectPlanPre / planSpecForTierPre 三者
//   本簇当前【零生产消费】，只有测试在用
```

**验收判据**：

```
改后必须跑：node .verify-tmp/v4-drift.mjs
  现状：PASS 3 / FAIL 1（漂移档位: legacy）
  目标：PASS 4 / FAIL 0
负路径：把 LEGACY 加回内联的 fullTier ⇒ 必须重新变红
```

---

### T2 · `snapshotReinjectOnCompact` —— 后端死键但前端仍在渲染

**实测**：

```
lib/index.js     命中 2 处：L1036 注释 / L1047 DEFAULT_CONFIG —— 零消费
lib/client.js    命中 3 处：L15795 / L19355 / L22483 —— 前端仍在渲染开关
⇒ 用户拨动这个开关【完全无效果】
```

**注意**：`post-compact-notice` 已补（见 §1），所以「压缩后提示」这个功能本身**已生效**；但**开关仍不控制它**——即用户无法关闭这条提示。

**修法（二选一，建议 A）**：

```js
// 方案 A（接线）：让提示段受开关控制
//   lib/index.js:10474 附近
if (cfg.snapshotReinjectOnCompact !== false) {
  pushPart('otherDynamic', 'post-compact-notice', '\n[上下文已压缩] …')
}

// 方案 B（删干净）：删 DEFAULT_CONFIG 键 + 前端 3 处 UI + 三语文案
//   风险：用户已习惯有这个开关，删了会「少一个选项」
```

---

## §3 ❌ 未修

### T3 · `fullInjectOnCompact` —— 彻底死键（连前端都没接线）

```
lib/index.js     命中 2 处：L1085 DEFAULT_CONFIG / L10467 注释 —— 零消费
lib/client.js    命中 0 处 —— 连 UI 都没有
⇒ 这是比 snapshotReinjectOnCompact 更彻底的死键
```

**注意**：该键的注释承诺「显式告知模型『刚才压缩了』」，而这个功能**已经由 post-compact-notice 实现**（见 §1）。

**修法**：**直接删这个键**（它的语义已被 `post-compact-notice` 接管，保留它只会误导后来人）。

```js
// lib/index.js:1085 删掉这一行
// fullInjectOnCompact: true,
// 同时改 L10467 的注释引用，指到 post-compact-notice
```

**验收**：`grep -c fullInjectOnCompact lib/index.js lib/client.js` 必须都为 0。

---

## §4 📋 验证脚本本身过期（不是产品缺陷，但会误报）

### T4 · `.verify-tmp/v3-forcefull.mjs` 捕获方式失效 ⇒ 三条恒红

**现象**：

```
场景 1：diags=["→ 完整版（★压缩后强制重建 · post_compact 档）","→ 完整版（间距已满足）"]
        out=NONE  ← 诊断说走了完整版，但脚本捕获不到
```

**根因**：脚本用 `finalizePre` 桩捕获返回值（`script:113-117`），但当前代码的完整版分支**不再经过 `finalizePre`** 返回。

⇒ **`out=NONE` 是脚本的假红，不是 P0-B 没修**。P0-B 已由源码行号证据确认修好（见 §1）。

**修法**：把捕获方式从 `finalizePre` 改成「读 `tieredFullGranted` 变量」或「读 `st._postCompactPending` 是否被消费」。

**为什么必须修**：这份脚本是 P0-B 的**唯一反例证据**。留着恒红会被后来人当成真缺陷，从而误改已修好的代码。

### T5 · `.verify-tmp/v4-drift.mjs` 只报 legacy 一格

**现象**：`PASS 3 / FAIL 1（漂移档位: legacy）`

**判定**：**这是真红**，对应 T1。修完 T1 后应变 `PASS 4 / FAIL 0`。

---

## §5 建议修复顺序

| # | 项 | 优先级 | 预估 | 理由 |
|---|---|---|---|---|
| 1 | **T1** `isPlanFullTierPre` legacy 漂移 | **高** | 改 1 行 | 真漂移，且有现成验证脚本可判绿 |
| 2 | **T4** 修 v3 脚本捕获方式 | **高** | 改 5 行 | 不修则 P0-B 永远「看着是红的」，后续会误改已修代码 |
| 3 | **T3** 删 `fullInjectOnCompact` 死键 | 中 | 删 1 行 + 改注释 | 纯清理，零风险 |
| 4 | **T2** `snapshotReinjectOnCompact` 接线或删 | 中 | 接线 3 行 / 删 UI 3 处 | 用户拨开关无效果，属产品缺陷 |

---

## §6 一键复现命令

```bash
cd /d/dsh-auto-memory

# ① 语法 + 导入
node --check lib/index.js && node -e "import('./lib/index.js').then(m=>console.log('IMPORT_OK',Object.keys(m).length))"

# ② 四个反例脚本（当前状态）
node .verify-tmp/v2-state.mjs      # P0-A  → 现在 PASS 7 / FAIL 0 ✅
node .verify-tmp/v3-forcefull.mjs  # P0-B  → 现在 0/3，但【是脚本假红】，见 T4
node .verify-tmp/v4-drift.mjs      # P1-C  → 现在 3/1，漂移 legacy，见 T1
node .verify-tmp/v1-matrix.mjs     # 8 档渲染矩阵

# ③ 漂移逐档对比（我本轮新写的，可直接用）
node artifacts/_drift-check.mjs

# ④ 死键检查
grep -c 'fullInjectOnCompact'        lib/index.js lib/client.js   # 应都 0（T3 修完后）
grep -c 'snapshotReinjectOnCompact'  lib/index.js lib/client.js

# ⑤ 全量回归（约 162 秒，需用户批准）
node tools/run-smoke.mjs --jobs=8 --timeout=180000   # 基线 PASS 529-531 / FAIL 0-2
```

---

## §7 一句话

**这份文档的修复完成度约 70%：3 个 P0/P1 真缺陷（P0-A / P0-B / planCap / 事件卡 / 压缩提示）都修完了，只剩下 `legacy` 一档名单漂移和两个死配置键。但验证脚本 v3 已过期，会让人误判 P0-B 没修 —— 这个假红比真缺陷更危险。**

---

## §8 追加（2026-10-29 14:20）· T5 白板渲染回写环（P1 · 刷新仪式时实测发现）

### T5 · `memory_note(kind=plan)` 与白板渲染构成回写放大环

**触发**：任何一次 `memory_note(kind=plan)`。刷新仪式必然触发。

**机理**（三步闭合）：

1. `memory_note(kind=plan)` 把**白板全文**写成一个 `kind=plan` 的检查点（append-only，不可删）。
2. 白板渲染器（`fromEvents` 路径）把该事件**最近的 `kind=plan` 检查点**当作 `sections.doing` 摘要带回白板。
3. 带回的内容进入下一版白板 ⇒ 下一次 `memory_note(kind=plan)` 又把它整篇写成新的 plan 检查点。

⇒ **白板 → 检查点 → doing → 白板**，闭环成立。

**实测数据**（`~/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json`）：

```
evt_89786878（项目白板）的 16 个 plan 检查点长度序列：
  17408, 16994, 967, 900, 20750, 20652, 20762, 20766,
  22350, 22354, 23385, 24549, 26010, 27578, 7517, 6564

单调增长段（连续 4 次）：23385 → 24549 → 26010 → 27578（每次 +1,000~1,600 字符）
该事件当前 sections.doing = 6,496 字符（正常应为百字级摘要）
```

**为什么之前的「修复」没生效**：本会话曾把 `sections.doing` 手动改回 130 字符（`memory_event(action="set")`），
但下一次 `memory_note(kind=plan)` 又把它写回 6,496 字符 —— **手改 sections 治不了，因为污染源是渲染器读 plan 检查点**。

**影响面**：

- 白板每刷新一次膨胀约 1~1.6k 字符，注入预算被逐步吃掉。
- `sections.doing` 语义被破坏：它变成「整篇白板」而不是「正在做什么」。
- 与 `planCap` 超配（§3.1）叠加：白板越长，`memoryReferences` 越容易被挤爆 ⇒ 丢 `recent-logs`。

**修法（二选一，建议 A）**：

```js
// 方案 A（推荐 · 渲染侧一行守卫）：渲染 doing 时跳过 kind=plan 检查点
//   位置：白板渲染器取「最近检查点」处（`fromEvents` 路径）
const _lastCk = (ev.checkpoints || [])
  .filter(c => c.kind !== 'plan')   // ★plan 检查点存的是白板全文，不是进展摘要
  .slice(-1)[0]

// 方案 B（写侧）：plan 检查点不再整篇存白板正文，只存摘要/差分
//   代价：失去「白板历史版本可从事件库完整回放」的能力（现在靠 handoff/archive/ 也能回放）
```

**验收判据（必须真跑，不能只断言源码含某字符串）**：

```
① 造 5 个 plan 检查点，前 4 个 text ≥ 5,000 字符，第 5 个 200 字符
② 真调渲染器生成白板
③ 断言 sections.doing（或等价的「进行中」段）长度 ≤ 500 字符
④ 负路径：把 filter 去掉 ⇒ 必须重新变长
```

**同族关联**：这是「同一语义两份判据」家族的又一例 ——
「最近检查点是什么」在白板渲染里有**两份口径**（`sections.doing` 优先 vs 检查点回落），
而 plan 检查点只该喂「正文」面板，不该喂「进行中」。

---

## §9 刷新仪式超时（本次同批修复）

**背景**：真实使用中报 `✗ refresh ritual failed: timeout`（120 秒不够）。

**用户裁定（2026-10-29）**：默认超时**加倍** 120 → **240 秒**。

**一次改全 6 处**（防半修）：

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| 1 | `lib/index.js` | L608 | `DEFAULT_AUTO_CONTINUE_REFRESH_TIMEOUT_SECONDS` 120 → **240** |
| 2 | `lib/index.js` | L969 | `DEFAULT_CONFIG.autoContinueRefreshTimeoutSeconds` 120 → **240** |
| 3 | `lib/index.js` | L606 | 注释补「240 秒」与裁定原因 |
| 4 | `lib/client.js` | L11155 | 前端轮询兜底 `var timeoutMs` 120000 → **240000** |
| 5 | `lib/client.js` | L15926 | 设置页 input 默认 120 → **240** |
| 6 | `lib/client.js` | L15926 | 设置页 onChange 兜底 120 → **240** |
| 7 | `lib/client.js` | L344 | 设置页 hint 文案「默认 120 秒」→「默认 240 秒」 |

**注意第 4 项**：前端 `var timeoutMs = 120000` 是**独立兜底**，不读后端配置。
只改后端会让「后端等 240 秒、前端 120 秒就放弃」⇒ 用户看到仍然超时。**这是最容易漏的一处。**

**验收**：

```
node --check lib/index.js && node --check lib/client.js   # OK
node -e "import('./lib/index.js').then(m=>console.log(m.DEFAULT_AUTO_CONTINUE_REFRESH_TIMEOUT_SECONDS))"
  → 240  （实测输出 EXPORT=240）

残留旧值核查（应全为 0）：
  grep 'autoContinueRefreshTimeoutSeconds: 120'          lib/index.js
  grep 'DEFAULT_AUTO_CONTINUE_REFRESH_TIMEOUT_SECONDS = 120' lib/index.js
  grep 'var timeoutMs = 120000'                          lib/client.js
```

**区间未变**：仍为 15–900 秒，用户可在设置页自行调低。
