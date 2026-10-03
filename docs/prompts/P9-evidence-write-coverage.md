> **给使用者的说明**：M8-2b 验收后的下一个瓶颈。同样**自包含**（硬约束内联 + 绝对路径），复制时从 `你是一名严谨的排查 Agent` 开始复制到文件末尾。

---

你是一名严谨的排查 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：evidence 写入侧覆盖率排查（reuse / success 零产出，correction 近乎为零）

## 0. 背景（已有实测数据，你必须先自行复现）

evidence 事件落盘于 `C:\Users\JH Z\.dsh\memory\evidence-pre\events\*.jsonl`（按日）。对全量事件按 `kind` 统计的实测分布：

| kind | 全量 | 近 7 天 |
|---|---|---|
| seen | 4930 | 4828 |
| cite | 286 | 199 |
| read | 82 | 33 |
| correction | **2** | 1 |
| **reuse** | **0** | **0** |
| **success** | **0** | **0** |

**问题**：`reuse` 与 `success` **从未落盘**，`correction` 全量仅 2 条。而 `lib\context-bridge-pre.js` 的六类枚举为 `['seen','read','cite','reuse','success','correction']`。

**影响**：M8-2b 的 importance 目前实质由 `seen`（曝光次数）驱动 ≈ **曝光度**，不是有用性；负向下压（correction）几乎不存在。这决定了 M8-2「重要性排序」最终能兑现多少价值。

**第一步请用脚本复现上述分布**（任选 python/node，读取 events 目录统计 `kind`），并把你的实测结果贴进回报。

## 1. 必读文件（绝对路径）

- `D:\dsh-auto-memory\lib\context-bridge-pre.js` —— 六类枚举（第 45 行 `ACCESS_KINDS_PRE_V1`）、各 create 函数
- `D:\dsh-auto-memory\lib\index.js` —— 写入侧调用点（重点搜索 `createSuccessEvidencePre`、`createCorrectionEvidencesFromText`、`createCiteEvidencesFromText`、`createAccessEvidencePre`、`recordEvidence`、`:1301` 附近的 read coverage 观察、`:4539` 附近的 success evidence）
- `D:\dsh-auto-memory\lib\procedure-store-pre.js` —— success/correction 是否只喂给 procedure 晋升而**未落 events**
- `D:\dsh-auto-memory\lib\evidence-agg-pre.js` —— 消费侧（**禁止修改**）
- 真实数据：`C:\Users\JH Z\.dsh\memory\evidence-pre\events\*.jsonl`

## 2. 目标

1. **定位根因**：`reuse` / `success` 零产出、`correction` 近乎为零的**确切原因**，三选一（须有证据）：
   - (a) **调用点未接线** —— create 函数存在但生产路径从未调用；
   - (b) **触发条件未满足** —— 有调用但前置条件（如"本轮 substantive 且记忆被 read/cite"）几乎不成立；
   - (c) **落盘分流** —— 事件被写入别处（如只喂 procedure store）而未进 events 目录。
2. **给出影响判断**：当前 importance 实际由哪些信号驱动，与设计的六类模型差多少。
3. **视根因决定是否修复**：若是 (a) 明显未接线 → 提出最小修复方案；若是 (b)/(c) → **只报告，不改代码**，等待用户决策。

## 3. 硬约束（违反即打回）

1. **搜索优先**：每个符号先 grep 到定义处并记下真实行号；统计必须基于**真实文件**，不得沿用本 prompt 的数字而不复现。
2. **默认不动代码**：本段定位为**排查**，除用户明确同意外**不得修改任何 `lib/` 文件**（修复方案写进回报）。
3. 若确需改：最小 diff、零新依赖、不改既有 API 签名、不删既有断言。
4. **不得修改 events 目录**（只读）。
5. 不得修改 `lib\evidence-agg-pre.js`、`lib\memory-importance-pre.js`、`lib\recall-fusion-pre.js`（均已锁定）。

## 4. 改动边界

- ✅ 允许：新增临时统计脚本（**用完即删，不得留在仓库**）
- ✅ 允许：在用户确认后做最小修复
- ❌ 禁止修改：`lib\evidence-agg-pre.js`、`lib\memory-importance-pre.js`、`lib\recall-fusion-pre.js`、`lib\context-bridge-pre.js`、`lib\procedure-store-pre.js`、`lib\fact-store-pre.js`
- ❌ 禁止：events 目录任何写操作

## 5. 验收标准

1. 回报含**你实测的 kind 分布**（全量 + 近 7 天），与背景表对照
2. 对 `reuse`、`success`、`correction` 三者**分别**给出根因结论，各自标注 (a)/(b)/(c) 并附 `文件:行号` 证据
3. 列出所有 **写入 events 的调用点行号**（完整清单）
4. 给出"当前 importance 实际由哪些信号驱动"的判断
5. **附加「每类事件的理想触发场景清单」**（执行侧建议，2026-09-09 采纳）：对六类 evidence 逐个给出——
   - 应该在什么用户行为/系统事件下产生（例：`read` = 模型实际读取了该记忆原文；`cite` = 回复中引用了该记忆；`reuse` = 跨会话再次命中同一记忆；`success` = 该记忆参与后任务被判定成功；`correction` = 用户纠正了由该记忆产生的内容）
   - **当前实际是否触发**（有数据 / 零产出）
   - 修复后**预期分布**（粗略量级即可，如"success 应达 seen 的 1%~5%"）
   此清单用于判断修复后的实际分布是否健康，是本段的核心交付物之一。
6. 若提出修复方案：说明改哪个文件哪一行、预期新增哪些 kind 的事件、如何验证、回滚方式

## 6. 停止条件

- 找不到任何写入 events 的代码路径（说明落盘机制与理解不同）；
- `ACCESS_KINDS_PRE_V1` 与实际落盘 kind 不一致且无法解释。

回报格式：
```
停止原因：未能定位 <符号/路径>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 7. 完成后自检

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory

# 若做了修复才需要；仅排查则跳过编译检查
node --check lib/index.js

node tests/smoke/smoke-test-evidence-agg-pre.mjs        # 14
node tests/smoke/smoke-test-memory-importance-pre.mjs   # 18
node tests/smoke/smoke-test-p4-l0-response-pre.mjs      # 34
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs       # 14

git status --short   # 仅排查时不得有任何 lib/ 改动
git diff --stat
```

## 8. 回报必须包含

1. 实测 kind 分布（全量 + 近 7 天）
2. 三者的根因结论 + `文件:行号` 证据
3. events 写入点完整清单
4. importance 实际驱动信号判断
5. 修复方案（若适用）+ 回滚方式
6. 自检原始输出

---

> **投喂提示**：本段自包含，无需再附 `_COMMON.md`。背景依据见 `D:\dsh-auto-memory\docs\prompts\M8-2-ADJUDICATION.md` §6.3。
