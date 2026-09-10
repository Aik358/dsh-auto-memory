> **给使用者的说明**：**现在投喂的主段**。复制时从 `你是一名严谨的排查 Agent` 开始，一直到文件末尾（自包含，硬约束已内联，无需再附 `_COMMON.md`）。
> 产出报告后**先交给规划侧过目**，再决定是否投喂修复段。

---

你是一名严谨的排查 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：evidence 写入侧覆盖率排查（reuse / success 零产出，correction 近乎为零）

## 0. 背景（已有实测数据，你必须先自行复现）

evidence 事件落盘于 `C:\Users\JH Z\.dsh\memory\evidence-pre\events\*.jsonl`（按日，每行一条 JSON）。全量按 `kind` 统计的实测分布：

| kind | 全量 | 近 7 天 |
|---|---|---|
| seen | 4930 | 4828 |
| cite | 286 | 199 |
| read | 82 | 33 |
| correction | **2** | 1 |
| **reuse** | **0** | **0** |
| **success** | **0** | **0** |

**问题**：`reuse` 与 `success` **从未落盘**（`createSuccessEvidencePre` 在 `lib/` 下有 5 处调用点，却零事件产出）；`correction` 全量仅 2 条。六类枚举见 `lib\context-bridge-pre.js:45`。

**影响**：下游 `lib\memory-importance-pre.js` 把六类计数转成 importance，再经 `lib\evidence-agg-pre.js` 加权进 `recall()` 的 dense 臂。信号缺三类 ⇒ **importance 现在实质是"曝光度"（seen 驱动），不是"有用性"**；负向下压（correction）几乎不存在。

**第一步**：写脚本复现上述分布（python 或 node 均可），把你的实测结果贴进回报。**不得直接引用本 prompt 的数字而不复现。**

## 1. 必读文件（绝对路径）

- `D:\dsh-auto-memory\lib\context-bridge-pre.js` —— 六类枚举（第 45 行 `ACCESS_KINDS_PRE_V1`）与各 create 函数
- `D:\dsh-auto-memory\lib\index.js` —— 写入侧调用点（重点搜 `createSuccessEvidencePre`、`createCorrectionEvidencesFromText`、`createCiteEvidencesFromText`、`createAccessEvidencePre`、`recordEvidence`；另见 `:1301` 附近的 read coverage 观察、`:4539` 附近的 success evidence）
- `D:\dsh-auto-memory\lib\procedure-store-pre.js` —— 查 success/correction 是否**只喂给 procedure 晋升**而未落 events
- `D:\dsh-auto-memory\lib\evidence-agg-pre.js` —— 消费侧（**禁止修改**）
- 真实数据：`C:\Users\JH Z\.dsh\memory\evidence-pre\events\*.jsonl`

## 2. 目标

1. **定位根因**：对 `reuse` / `success` / `correction` 三者**分别**给出结论，三选一（须有证据）：
   - (a) **调用点未接线** —— create 函数存在，但生产路径从未调用；
   - (b) **触发条件未满足** —— 有调用，但前置条件（如"本轮 substantive 且记忆被 read/cite"）几乎不成立；
   - (c) **落盘分流** —— 事件被写到别处（如只喂 procedure store）而没进 events 目录。
2. **影响判断**：当前 importance 实际由哪些信号驱动，与设计的六类模型差多少。
3. **理想触发场景清单**（本段核心交付物之一）：六类逐个给出——应在什么用户行为/系统事件下产生（例：`read` = 模型实际读了记忆原文；`cite` = 回复引用了该记忆；`reuse` = 跨会话再次命中；`success` = 该记忆参与后任务被判成功；`correction` = 用户纠正了由该记忆产生的内容）／当前是否触发／修复后**预期分布量级**（如"success 应达 seen 的 1%~5%"）。
4. **默认不修**：本段是排查。除用户明确同意外**不得修改任何 `lib/` 文件**，修复方案写进回报等批准。

## 3. 硬约束（违反即打回）

1. **搜索优先**：每个符号先 grep 到定义处并记下真实行号；统计必须基于真实文件，行号以实际为准（prompt 中的行号是上次观测值，可能漂移）。
2. **默认零代码改动**（见 §2.4）。
3. 若获准修复：最小 diff、零新依赖、不改既有 API 签名、不删既有断言。
4. **events 目录只读**，禁止任何写操作。
5. 禁改：`lib\evidence-agg-pre.js`、`lib\memory-importance-pre.js`、`lib\recall-fusion-pre.js`（均已锁定）。
6. **不得臆造**：查不到就说查不到，按 §6 停止回报，禁止"应该是""大概是"。

## 4. 改动边界

- ✅ 允许：临时统计脚本（**用完即删，不得留在仓库**）
- ✅ 允许：获用户批准后的最小修复
- ❌ 禁止修改：`lib\evidence-agg-pre.js`、`lib\memory-importance-pre.js`、`lib\recall-fusion-pre.js`、`lib\context-bridge-pre.js`、`lib\procedure-store-pre.js`、`lib\fact-store-pre.js`
- ❌ 禁止：events 目录任何写操作

## 5. 验收标准

1. 回报含**你实测的 kind 分布**（全量 + 近 7 天），与背景表对照
2. `reuse` / `success` / `correction` 三者各自标注 (a)/(b)/(c)，各附 `文件:行号` 证据
3. **所有写入 events 的调用点清单**（完整，含行号）
4. "当前 importance 实际由哪些信号驱动"的判断
5. **理想触发场景清单**（§2.3）
6. 修复方案（若适用）：改哪个文件哪一行、预期新增哪些 kind、如何验证、回滚方式

## 6. 停止条件

- 找不到任何写入 events 的代码路径（落盘机制与理解不同）；
- `ACCESS_KINDS_PRE_V1` 与实际落盘 kind 不一致且无法解释。

```
停止原因：未能定位 <符号/路径>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 7. 自检（排查段，lib/ 不得有改动）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory

node tests/smoke/smoke-test-evidence-agg-pre.mjs        # 14
node tests/smoke/smoke-test-memory-importance-pre.mjs   # 18
node tests/smoke/smoke-test-p4-l0-response-pre.mjs      # 34
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs       # 14

git status --short     # 仅排查时 lib/ 不得有任何改动
git diff --stat        # 应为 0
```

## 8. 回报必须包含（缺一不可）

1. 实测 kind 分布（全量 + 近 7 天）+ 复现脚本核心片段
2. 三者根因结论 + `文件:行号` 证据
3. events 写入点完整清单
4. importance 实际驱动信号判断
5. 六类理想触发场景清单（含预期分布量级）
6. 修复方案（若适用）+ 回滚方式 + 自检原始输出

**重要**：若你未能实际运行统计而只做了静态分析，必须在回报顶部**显式标注「未实证」**。

---

> 背景依据：`D:\dsh-auto-memory\docs\prompts\M8-2-ADJUDICATION.md` §6.3。报告产出后请交规划侧确认，再决定是否投喂修复段。
