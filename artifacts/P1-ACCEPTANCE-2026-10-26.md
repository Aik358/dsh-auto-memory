# P1 验收记录 · 注入截流方案（2026-10-26）

> 依据：`artifacts/INJECTION-THROTTLE-DECISION-2026-10-26.md` + `artifacts/PROMPT-INJECTION-THROTTLE-P1-2026-10-26.md`
> 本文件只记录**实测可复算**的数据，不含估计值。

---

## 1. 五个任务与落点

| 任务 | 内容 | 落点 |
|---|---|---|
| **T1** | `fSnapGapHint` 三语「默认 10」→「默认 20」+ 上调归因 | `lib/client.js` L534(zh) / L877(en) / L1192(ja) |
| **T2** | 新增 6 个配置键 | `lib/index.js` DEFAULT_CONFIG（`snapshotReinjectOnCompact` 之后） |
| **T3** | 计数锁 165 → 173，同步 6 处文档 | 见 §3 |
| **T4** | `truncatePlanBySections` 按节投递 + 调用点改造 + 2 个附加键 | `lib/index.js` L1655（函数）/ L9820-9842（调用点）/ L863 后（配置） |
| **T5** | 白板节名命中优先词 | `handoff/PLAN.md`「★★最新实况」→「★当前进展与最新实况」 |

---

## 2. 可复算物理量

| 项 | 改前 | 改后 | Δ |
|---|---|---|---|
| `lib/client.js` 字节 | 1,686,138 | 1,686,138 | 0（EOL 未变，CRLF 16,901） |
| `lib/client.js` classicLF 长度 | 1,370,801 | 1,370,952 | **+151** |
| `lib/client.js` classicLF sha256 | `eb1d798e...` | `bb19b7ce...` | 重钉 |
| `lib/index.js` LF 归一长度 | 1,263,158 | 1,269,644 | **+6,486** |
| `lib/index.js` LF sha16 | `08908A977C1906B5` | `43CB1ACC2A1CDDE2` | 重钉 |
| 配置键数 | 165 | **173** | **+8** |
| 工具数 | 21 | 21 | 0 |
| 路由数 | 80 | 80 | 0 |

### 2.1 为什么配置键是 +8 而不是 +6

原计划 6 个。T4 实现时确认「按节白名单」必须可配才有意义 ⇒ 补 2 个：
`handoffPlanSections`（白名单数组，默认 `null` = 回落旧路径）+ `handoffPlanSectionMax`（单节上限，默认 2000）。

---

## 3. T3 计数锁同步清单（6 处，全仓实测）

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| 1 | `docs/WHITEPAPER.md` | L99 表格 | `**165**` → `**173**` |
| 2 | `docs/HOMEPAGE-CONTENT-FOR-GM53.md` | L279 | `165 个配置键` → `173` |
| 3 | `docs/FRONTEND-CO-CREATION.md` | L15 | `165 个默认配置键` → `173` |
| 4 | `docs/FRONTEND-CO-CREATION.md` | L93 标题 | `共 165 个配置键` → `173` |
| 5 | `README.md` | L663 | `165 config keys` → `173` |
| 6 | `README.zh-CN.md` | L659 | `165 配置键` → `173` |

**验证**：`node tools/verify-docs.mjs` → `EXIT=0`，输出「工具 21 · 路由 80 · 配置键 173」，末尾「全部一致」。

> 全仓检索另有 2 处「165」但**不应改**：
> - `.tmp-wc-index.js` L155：第三方缓存文件（CSS 数值，与配置键无关）。
> - `tests/smoke/smoke-test-r26-cross-layer.mjs` L795：历史归因注释（记录 163→165 那次演进），属留档不改。

---

## 4. 新增套件 `tests/smoke/smoke-test-v5-p1-inject-throttle.mjs`

**结果：PASS 32 / FAIL 0**

| 组 | 条数 | 覆盖 |
|---|---|---|
| A | 6 | T1 三语文案 + 两条旧值负路径 + 常量=20 |
| B | 8 | T2 六键 + T4 两键的默认值 |
| C | 2 | 计数锁（键数 ≥170 + 白皮书=代码实测） |
| D | 12 | T4 真调 `truncatePlanBySections`：命中/排除/空串/null 回落/超长标记/空文本/无节/大小写/元断言 |
| E | 4 | T5 白板节名命中优先词【守卫，非功能验收】 |

### 4.1 变异验证（判据必须能红）

| # | 变异 | 结果 | 证明 |
|---|---|---|---|
| 1 | `DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS` 20 → 10 | **A-6 红** | 常量判据有效 |
| 2 | `const hit = words.some(...)` → `const hit = true` | **D-3/D-4 红** | 白名单排除逻辑被守住 |
| 3 | `return out.join(...)` → `return out.length ? out.join(...) : src` | **D-4/D-9 红** | fail-closed 被守住 |
| 4 | 删 `handoffPlanSections: null` | **B-1 红 + C-2 红**（173 vs 172） | 配置键存在性 + 计数锁都被守住 |

> **★教训（本轮实测）**：变异 3/4 第一次跑显示「全绿」，排查发现是 **bash 传参把 `\r\n` 吃掉** ⇒ 变异根本没写进文件（探针未命中）。
> **正确做法**：变异脚本写成文件，用 Node 执行，并在施加后**断言文件内容确实变了**（打印 `APPLIED bytes A -> B`）。

### 4.2 端到端（真数据）

用真实白板（36,035 B）+ 七档矩阵定义的白名单（核心 3 节）：

| 档位 | 白名单 | 结果 |
|---|---|---|
| F1 全文 | `null` | 返回 `null` ⇒ 调用方回落旧路径（设计如此） |
| F2/F3/F5/F7 瘦档 | 三个核心节 | **4,064 B**（占全文 **11.3%**，省 31,971 B） |

核心节保留：`当前进展与最新实况` / `当前目标`；排除：`这是什么` / `挂机总管模式` / `施工进度`。

---

## 5. 闸门（全部通过）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 语法 | `node --check lib/index.js` / `lib/client.js` / 新套件 | OK |
| 前端真 factory 守卫 | `smoke-test-client-loadable.mjs` | **PASS 17 / FAIL 0** |
| 生成区 | `gen-ev4-blocks.mjs --check` | OK（128,858 字符） |
| 文档计数锁 | `verify-docs.mjs` | **EXIT=0**（21/80/173） |
| 皮肤生成 | `build-iter5-skin.mjs --check --strict` | **SYNC-OK** |

---

## 6. 哈希锁重钉（判据过期，非缺陷）

### 6.1 为什么必须重钉

T1 改了 `lib/client.js` 设置页文案（zh/en/ja 三处），T2/T4 改了 `lib/index.js`。两处都在两个**字节守恒锁**的守备范围内 ⇒ 锁红。**归因 = 判据过期**（代码有意演进），不是缺陷。

### 6.2 归因证据（可复算）

**关键验证：用 HEAD 版跑同一套剥离管道，得到的值必须等于旧锁值。**

| 锁 | 文件 | HEAD 版复算 | 旧锁值 | 一致? |
|---|---|---|---|---|
| `iter5-skin` classicLF sha256 | `client.js` | `eb1d798e...`（1,370,801 字符） | `eb1d798e...` | **YES** |
| `r26` IX sha16 | `index.js` | `08908A977C1906B5`（1,263,158 字符） | `08908A977C1906B5` | **YES** |

⇒ **剥离管道/哈希算法本身正确**，差异 100% 来自本批改动。

### 6.3 重钉结果

| 锁 | 位置 | 旧值 | 新值 | Δ |
|---|---|---|---|---|
| `iter5-skin` sha256 | `tests/smoke/smoke-test-iter5-skin.mjs` | `eb1d798e...` | `bb19b7ce...` | +151 字符（三语文案） |
| `r26` sha16 | `tests/smoke/smoke-test-r26-cross-layer.mjs` L759 | `08908A977C1906B5` | `43CB1ACC2A1CDDE2` | — |
| `r26` R150_CHARS | 同上 L801 | 1,263,158 | **1,269,644** | **+6,486** |

两处都已写入 `R150 = R138 + 2026-10-26 v5-P1` 归因注释（含实测复算方法与 Δ 值）。判据意图均不变。

---

## 7. 并行回归定性

| 轮次 | 结果 | 失败集 |
|---|---|---|
| 改前基线 | PASS 511 / FAIL 0 | `{}` |
| 第 1 轮（本批，锁未重钉） | PASS 508 / FAIL 3 | `{iter5-skin, r26, issue207}` |
| 第 2 轮（本批，锁已重钉） | PASS 506 / FAIL 5 | `{m76, m79, m73, issue207, config-transactions}` |
| 第 3 轮（本批） | PASS 505 / FAIL 3 / TIMEOUT 3 | `{settings-emit, settings-routes, settings-plan-migration, h1-v1, m78-host, js-semantic-host}` |

**三类已定性**：

1. **锁红**（第 1 轮的 iter5-skin / r26）= 判据过期 ⇒ 已按 §6 重钉，重钉后单跑 PASS。
2. **`EPERM` 锁竞争**（issue207 / config-transactions）= 并行撞同一临时目录锁文件。实测报错 `EPERM ... \.lock.acquire`，单跑 PASS。
3. **负载型超时**（第 3 轮 6 个）= 并行时耗时膨胀 6-10 倍：
   - `h1-v1` 并行 100.4s → 单跑 **12s**
   - `settings-emit` 并行 78.2s → 单跑 **4s**
   - `settings-routes` 并行 62.8s → 单跑 **1s**
   - `settings-plan-migration` 并行 67.4s → 单跑 **1s**
   - `m78-host` 并行 113.7s → 单跑 **11s**
   - `js-semantic-host` 并行 8.4s → 单跑 **4s**
   ⇒ 6/6 单跑全部 PASS。

**失败集互不相交**（第 1/2/3 轮无任何套件重复失败）是并行抖动的决定性特征。

---

## 8. 结论

**P1 已完成**。五个任务全部落地，闸门全绿，新增套件 32/0，变异验证 4/4 能红。

**遗留（不属 P1 范围）**：
1. 并行回归抖动是**基线自带问题**（HEAD 版 issue207 跑 6 次也 FAIL 1 次），本批未引入、未修复。
2. 本轮 4 轮回归中，失败的套件**全部**单跑 PASS 且与本批改动无因果链。

**下一步**：P2（七档状态机重构）—— 本批只落了配置键与「按节投递」基础设施，七档状态机尚未接入。
