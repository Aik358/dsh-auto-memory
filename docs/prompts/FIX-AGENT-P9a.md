> **给使用者的说明**：P9 裁决后唯一要投喂的修复段。复制时从 `你是一名严谨的修复 Agent` 开始到文件末尾（自包含，无需 `_COMMON.md`）。
> ⚠️ 改的是 `lib\context-host-pre.js`，**别和任何其他改该文件的任务同时跑**。

---

你是一名严谨的修复 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：修复 correction 证据「几乎不可能触发」的缺陷（重设计版）

## 0. 背景（实读代码 + 裁决结论，必须先自行复现）

- correction 是六类 evidence 中唯一的**负向信号**（`lib\memory-importance-pre.js`：`importance = 0.5 + 0.3×pos − 0.5×correctionRate`）。实测全量 events 里 correction 仅 **2 条**，近乎失效。
- 根因（已核实）：`lib\context-bridge-pre.js` 的 `createCorrectionEvidencesFromText` 要求**用户消息文本同时含**纠正词典词 **AND** 完整 32 位 memoryId（它内部先调 `createCiteEvidencesFromText` 找 id）。用户纠正时几乎不可能手打完整 id ⇒ 现实触发率 ≈0。
- 原方案（"用户段同时存在 cites 就升级"）**有漏洞已作废**：`lib\context-host-pre.js:490-501` 的 `cites` 也是从 `seg.text`（用户自己消息）算的，用户消息既不含 id 也不含 cites，前提本身不成立。
- **正确设计（本任务）**：correction 归因到「**最近被 cite/read 的记忆**」，而不是用户消息里新找的 id。

## 1. 必读文件（绝对路径）

- `D:\dsh-auto-memory\lib\context-host-pre.js` —— 改动面：`emitTextEvidence`（约 490-501）与 `recentEvidenceForSuccess`（约 691）的 store 读取范式
- `D:\dsh-auto-memory\lib\context-bridge-pre.js` —— `createCorrectionEvidencesFromText`、`createCiteEvidencesFromText`、`buildEvidenceId`、`CORRECTION_LEXICON_PRE_V1`（**只读参考，禁止修改**）
- `D:\dsh-auto-memory\lib\memory-importance-pre.js` —— 理解 correction 的负向作用（**禁止修改**）
- 参考范式：`git show 4d54664 -- lib/index.js`（diag 写法）

## 2. 目标

当 user 段命中纠正词典词时，把 correction 事件归因到「**最近一条被 cite 或 read 的记忆**」（若 5 分钟窗口内无 cite/read，则不发）。**保留 cite 事件，另发一条 correction**（不改写 cite）。

## 3. 设计约束（必须遵守，逐条）

1. **单条归因，precision 优先**：correction 是负向权重，误报代价高。只归因到**最近一条** cite/read 记忆，不做"该轮所有 cite 全连坐"。
2. **保留 cite 不改写**：correction 是**新增**事件，kind 与 evidenceId 均为 correction；原 cite 事件原样保留。
3. **复用既有 store 读取**：`recentEvidenceForSuccess(windowMs)` 已实现"从 store 读近 N 分钟 cite/read、按 memoryId 去重"的范式，**沿用同样思路**取「最近一条」（按时间戳降序取第 1 条即可），不要新造存储层。
4. **窗口默认 5 分钟**：与 `recentEvidenceForSuccess(5×60×1000)` 一致；窗口内无 cite/read → 静默不发（不报错）。
5. **同一记忆一轮最多一条 correction**（去重），避免重复惩罚。
6. **隐私**：diag 只记录「命中纠正词典 + 归因的 memoryId 前 12 位 + 词典词计数」，**绝不记录用户原文**。
7. **fail-soft**：任何异常 → 静默跳过（可 diag），不影响主流程，不改变 cite 的既有产出。

## 4. 改动边界

- ✅ 允许修改：`D:\dsh-auto-memory\lib\context-host-pre.js` 中 `emitTextEvidence` 及其附近（最小 diff）
- ❌ **禁止修改**：`lib\context-bridge-pre.js`、`lib\memory-importance-pre.js`、`lib\evidence-agg-pre.js`、`lib\index.js`、`lib\recall-fusion-pre.js`
- ❌ 禁止：改写既有 cite 证据；把 correction 归因到"该轮全部 cite"；引入新依赖；整文件重写

## 5. 验收标准

1. 构造 fixture：user 文本命中词典词（如含"不对""错了""不是"等词典词），且 store 内 5 分钟窗口有 1 条 cite → 产出 1 条 correction，其 `memoryId` = 那条 cite 的 memoryId，`kind === 'correction'`
2. 原 cite 事件仍在（数量不减少）
3. 窗口内无 cite/read → 0 条 correction（不发）
4. 同一 memoryId 一轮只 1 条 correction
5. **纯函数可测**：把"从最近 cite 集合选归因对象"抽成可注入/可 fixture 的纯函数（沿用 `-pre.js` 零 IO 惯例），IO 与 store 读取注入
6. 既有基线不降：memory-importance 18 / p4 34 / p8 14 / evidence-agg 14 / handoff 51 / continue-chain 58
7. 新增断言覆盖第 1、2、3、4 条

## 6. 停止条件

- `CORRECTION_LEXICON_PRE_V1` 不存在或内容为空；
- store 读取范式无法复用（`storeFor()` / `loadEvents()` 不存在）——此时停止回报，**不得自造存储层**。

```
停止原因：未能定位 <符号>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 7. 完成后自检（逐项执行并贴原始输出）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory

node --check lib/context-host-pre.js

node tests/smoke/smoke-test-memory-importance-pre.mjs   # 18
node tests/smoke/smoke-test-p4-l0-response-pre.mjs      # 34
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs       # 14
node tests/smoke/smoke-test-evidence-agg-pre.mjs        # 14
node tests/smoke/smoke-test-handoff-pre.mjs             # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs      # 58

git status --short
git diff --stat
```

## 8. 回报必须包含

1. 每处改动：`文件:行号 — 原内容 → 新内容`
2. 归因选择逻辑的说明（为何单条、为何 5 分钟窗口）
3. 隐私处理说明（diag 不记用户原文的证据）
4. 新增断言清单与结果
5. 回滚方式：`git checkout lib/context-host-pre.js`
6. 自检原始输出

---

> 裁决依据：`D:\dsh-auto-memory\docs\prompts\P9-REVIEW-DECISION.md` §三。
