> **给使用者的说明**：P9a 附带发现的修复段。**优先级高于一切观察类动作**——不修它，success 永远是 0。
> 复制时从 `你是一名严谨的修复 Agent` 开始到文件末尾（自包含，无需 `_COMMON.md`）。
> ⚠️ 改 `lib\context-host-pre.js`（**源文件**）；`lib\context-host.js` 是发布产物，**禁止手改**。

---

你是一名严谨的修复 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：修复 recentEvidenceForSuccess 时间戳取值错误（success 证据链结构性断裂）

## 0. 缺陷（已实证，你必须先复现）

**磁盘事件实样**（`C:\Users\JH Z\.dsh\memory\evidence-pre\events\*.jsonl` 最新一行）：

```
顶层字段: ['anchorId','event','evidenceId','kind','memoryId','namespace','policyVersion','recordedAt','schemaVersion','scope','source','storePolicyVersion','workspaceRef']
有无顶层 ts: False   有无 createdAt: False   event.ts = 1788932690285
```

即：**时间戳在 `event.ts`，顶层只有 `recordedAt`，既无 `ts` 也无 `createdAt`。**

**缺陷代码**（`lib\context-host-pre.js`，`recentEvidenceForSuccess` 内，约 772 行）：

```js
const ets = e.ts || e.createdAt || 0     // ← 顶层无这两个字段 → 恒为 0
if (ets < cutoff) continue               // ← 0 < cutoff → 全部跳过
```

**后果**：该函数**恒返回空数组**。唯一调用方是 `lib\index.js:4576` 的 M9 success 块 → `cited.length === 0` → **success 事件永远为 0**（实测全量 5388 事件中 success=0）。

**对照**：P9a 新增的 `selectCorrectionAttributionPre`（同文件约 68/77 行）已用正确口径：

```js
const ets = Number(e.event && e.event.ts) || Number(e.ts) || Number(e.createdAt) || 0
```

**你的第一步**：复现上述磁盘字段结构与代码行，把实测结果写进回报。

## 1. 必读文件（绝对路径）

- `D:\dsh-auto-memory\lib\context-host-pre.js` —— 改动面：`recentEvidenceForSuccess`（约 766-782）、正确范式见 `selectCorrectionAttributionPre`（约 44-94）
- `D:\dsh-auto-memory\lib\index.js` —— 唯一调用方 `:4575-4576`，理解 success 块上下文（**禁止修改**）
- 真实数据：`C:\Users\JH Z\.dsh\memory\evidence-pre\events\*.jsonl`

## 2. 目标

把 `recentEvidenceForSuccess` 的时间戳取值改为与 P9a 选择器**同口径**，使该函数能真正选出近窗口内的 read/cite 事件，从而让 success 证据链恢复工作。

## 3. 改动边界

- ✅ 允许修改：`lib\context-host-pre.js` 中 `recentEvidenceForSuccess` 的**时间戳取值那一行**（最小 diff，1 行）
- ✅ 允许新增：`tests\smoke\` 断言
- ❌ **禁止修改**：`lib\context-host.js`（发布产物，由 `-pre` 生成）、`lib\index.js`、`lib\context-bridge-pre.js`
- ❌ **禁止顺带放宽窗口**（窗口是否放宽属下一步，本段只修缺陷）
- ❌ 禁止：整文件重写、引入新依赖、改变函数签名或返回结构

## 4. 验收标准

1. 时间戳取值与 `selectCorrectionAttributionPre` 口径一致：`Number(e.event && e.event.ts) || Number(e.ts) || Number(e.createdAt) || 0`
2. **新增断言**（fixture 用磁盘投影形态：`{kind, memoryId, event:{ts}, recordedAt}`）：
   - 窗口内 cite/read 能被选出；窗口外被排除
   - 仅 `seen` 不被选（kind 过滤仍生效）
   - 按 memoryId 去重仍生效
   - 缺 `event` / 坏条目 → 跳过，不抛错
   - **修复前用同样 fixture 会返回空（回归证明）**
3. 既有断言不降：memory-importance 18 / p4 34 / p8 14 / evidence-agg 14 / p9a 26 / handoff 51 / continue-chain 58
4. **真实数据对照证据**（本段核心，缺此项视为未完成）：实读真实 events 文件，用**修复后**的逻辑统计——
   - 近 **5 分钟**窗口能选出几条 read/cite
   - 近 **30 分钟**窗口能选出几条（30 分钟 ≈ `autoConsolidateCooldownMinutes` 默认周期）
   - 目的：判断修复后 success 是否仍会因"5 分钟窗口 vs 30 分钟 consolidation 周期"而稀疏。**只统计，不要因此改窗口。**
5. 回报中给出该函数修复前后对同一真实数据的输出对比

## 5. 停止条件

- 若 `loadEvents()` 返回的形状**与磁盘不一致**（例如已被规范化出顶层 `ts`），说明缺陷前提不成立 → **立即停止回报**，不得盲改；
- 若 `recentEvidenceForSuccess` 有多个实现副本（`-pre` 与 `.js` 行为不同）→ 停止回报并说明。

```
停止原因：<描述>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 6. 完成后自检（逐项执行并贴原始输出）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory

node --check lib/context-host-pre.js

node tests/smoke/smoke-test-p9a-correction-attribution-pre.mjs   # 26
node tests/smoke/smoke-test-memory-importance-pre.mjs            # 18
node tests/smoke/smoke-test-p4-l0-response-pre.mjs               # 34
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs                # 14
node tests/smoke/smoke-test-evidence-agg-pre.mjs                 # 14
node tests/smoke/smoke-test-handoff-pre.mjs                      # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs               # 58

git status --short
git diff --stat
```

## 7. 回报必须包含

1. 磁盘事件形状复现结果（顶层字段清单 + `event.ts` 值）
2. 改动：`文件:行号 — 原内容 → 新内容`
3. 新增断言清单与结果（含"修复前返回空"的回归证明）
4. **真实数据 5 分钟 / 30 分钟窗口的命中条数**（§4.4）
5. 对"修复后 success 是否仍稀疏"的判断与建议（**不要在本段放宽窗口**）
6. 回滚：`git checkout lib/context-host-pre.js`

---

> 立项依据：`D:\dsh-auto-memory\docs\prompts\P9-REVIEW-DECISION.md` §七（P9a 附带发现已核实）。
