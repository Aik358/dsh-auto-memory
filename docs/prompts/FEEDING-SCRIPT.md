# 轮次投喂脚本（FEEDING-SCRIPT）

> 用法：每个轮次 = **新开一个干净会话**，把下方开场模板 + 两个材料文件**全文粘贴**给 Agent。
> 轮次 1–4 可分给 4 个不同 Agent 同时跑；只有一个 Agent 就按顺序 1→2→3→4。
> 每轮验收通过后 **git commit 一次**（便于回滚归因），再进下一轮。

---

## 〇、每次投喂的固定开场模板（每次都要带）

```
你是本次任务的执行 Agent，工作目录 D:\dsh-auto-memory。
下面给你两份材料：【材料一】通用前置约束，必须全部遵守；【材料二】你的唯一任务。
执行顺序：先按材料二的「需先检索的仓库路径与符号关键词」用 Grep 定位真实符号与行号，
回报定位结果后再实施；完成后按材料二的「完成自检」逐项回报。
仓库实际代码与材料描述不符时，以实际代码为准并明确指出差异；
无法定位或信息不足立即停止回报，禁止猜测，禁止整文件重写。

======== 材料一 ========
（粘贴 _COMMON.md 全文）

======== 材料二 ========
（粘贴当轮任务文件全文）
```

---

## 一、每轮之后的固定验收（你来跑，约 1 分钟）

```bash
cd D:/dsh-auto-memory
git status --short          # 改动文件不得超过该轮"允许"清单
git diff --stat             # 最小 diff，无整文件重写
# —— 十三套基线（收官后实测值，数字不得下降）——
node tests/smoke/smoke-test-m73-pre.mjs 2>&1 | tail -1                 # 59
node tests/smoke/smoke-test-handoff-anchor-pre.mjs 2>&1 | tail -1      # 42
node tests/smoke/smoke-test-m81-hub-pre.mjs 2>&1 | tail -1             # 39
node tests/smoke/smoke-test-p4-recall-l0-pre.mjs 2>&1 | tail -1        # 34
node tests/smoke/smoke-test-memory-importance-pre.mjs 2>&1 | tail -1   # 17
node tests/smoke/smoke-test-l0-extract-pre.mjs 2>&1 | tail -1          # 18
node tests/smoke/smoke-test-handoff-pre.mjs 2>&1 | tail -1             # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs 2>&1 | tail -1      # 58
node tests/smoke/smoke-test-water-step-pre.mjs 2>&1 | tail -1          # 12
node tests/smoke/smoke-test-autocont-host-pre.mjs 2>&1 | tail -1       # 29
# 另有 l0-index / recall-fusion / fact-store 等新增套件，按各轮"应产出"核对
```

> 若某个 smoke 文件名与实际不符，先 `ls tests/smoke/` 确认真实文件名再跑——**文件名以仓库实际为准**。

---

## 二、轮次表

### 批次 A（轮次 1–4，互相零冲突，可并行）

**轮次 1 · P1 L0 向量索引**（纯新增，删文件即回滚）
- 投喂：`_COMMON.md` + `P1-l0-index.md`
- Agent 要读的仓库文件：`lib/l0-extract-pre.js`、`lib/memory-index-pre.js`、`lib/semantic-js-pre.js`、`lib/m4-corpus-pre.js`
- 应产出：`lib/l0-index-pre.js`、`tests/smoke/smoke-test-l0-index-pre.mjs`
- 额外验收：新 smoke 全绿；`git status` 只新增这 2 个文件

**轮次 2 · P5 接续锚点表**
- 投喂：`_COMMON.md` + `P5-handoff-anchor.md`
- Agent 要读的仓库文件：`lib/index.js`（定位 `buildContinueCarry` / 三处 `slice`）
- 应产出：`lib/index.js` 最小 diff
- 额外验收：handoff 51 / continue-chain 58 不降；回报里必须有"相同输入两次注入 hash 一致"的断言证据

**轮次 3 · P7 写入侧修复**
- 投喂：`_COMMON.md` + `P7-write-fix.md`
- Agent 要读的仓库文件：`lib/index.js`（账本/白板写入函数）、`lib/memory-writer-pre.js`
- 应产出：`lib/index.js` 最小 diff
- ⚠️ 开工前先备份：`cp -r ~/.dsh/memory ~/.dsh/memory-backup-$(date +%m%d)`
- 额外验收：既有账本/白板文件内容零丢失

**轮次 4 · M8-1 Fact 元数据补强**
- 投喂：`_COMMON.md` + `M8-1-fact-metadata.md`
- Agent 要读的仓库文件：`lib/fact-store-pre.js`、`lib/index.js`（定位 `hubIo`）
- 应产出：`lib/fact-store-pre.js` 增量 diff + 新断言
- ⚠️ 内置硬停止：`hubIo()` 查不到 → Agent 必须停下回报，不许猜

### 批次 B（主链串行，P1 完成后开工）

**轮次 5 · P2 语义臂接入 recall**（前置：轮次 1 完成）
- 投喂：`_COMMON.md` + `P2-semantic-recall.md`
- Agent 要读的仓库文件：`lib/index.js`、`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`、`lib/context-host-pre.js`
- 额外验收：`recall(query, limit, agent, scope)` 签名未变；语义引擎不可用时退回纯词法

**轮次 6 · P3 融合层改造**（前置：轮次 5）
- 投喂：`_COMMON.md` + `P3-fusion.md`
- Agent 要读的仓库文件：`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`、`lib/context-bridge-pre.js`
- 额外验收：`fuseD6Pre` 既有行为未被删改（并存）；无 score-space 加权 RRF

**轮次 7 · P4 返回 L0 + 按需展开**（前置：轮次 6）
- 投喂：`_COMMON.md` + `P4-l0-response.md`
- Agent 要读的仓库文件：`lib/index.js`、`lib/memory-index-pre.js`
- 额外验收：旧调用方式（不传新参数）行为不变

### 批次 C（接续链 + M8 后续）

**轮次 8 · P6 账本权重化截断**（前置：轮次 2 完成）
- 投喂：`_COMMON.md` + `P6-ledger-weight.md`
- Agent 要读的仓库文件：`lib/index.js`、`docs/M-CM7-HANDOFF-LAYERED-RETRIEVAL.md`
- 应产出：`lib/handoff-anchor-pre.js` + smoke + `buildContinueCarry` 接线

**轮次 9 · M8-2 importance 接线**（前置：轮次 6 完成；否则只交付纯函数不接线）
- 投喂：`_COMMON.md` + `M8-2-importance-wiring.md`
- Agent 要读的仓库文件：`lib/context-bridge-pre.js`、`lib/fact-store-pre.js`、`lib/procedure-store-pre.js`、`lib/shadow-retrieval-pre.js`、`lib/semantic-js-pre.js`
- ⚠️ 内置硬停止：`evidenceFor()` 返回结构与 `correctionRate` 口径无法确认 → 停下回报

**轮次 10 · M8-3 M8 启用与 live 验证**（⚠️ 最后；投喂前你必须先书面确认三问）
- 你先回答（在投喂材料开头附上）：① 是否同意 `memoryHubEnabled` 默认改 true？② 是否保留回滚开关？③ live 验证由谁做？
- 投喂：`_COMMON.md` + `M8-3-enable-verify.md`
- Agent 要读的仓库文件：`lib/index.js`、`docs/M8-MEMORY-HUB.md`
- 额外验收：Agent 产出 live 验证清单（重启 dsh web / 三栏有内容 / facts.json 落盘 / restore 不丢），由你执行

---

### 批次 D（2026-09-09 收官后补做，修 M8-2 未达成的排序目标）

**轮次 11 · P8 RRF 接线进 recall**（前置：P3 已交付）
- ⭐ **复制即投喂**：直接复制 `docs/prompts/FIX-AGENT-P8.md` 全文（**自包含，硬约束已内联，无需再拼 `_COMMON.md`**）
- 或按公式投喂：`_COMMON.md` + `P8-rrf-wiring.md`
- Agent 要读的仓库文件：`lib/index.js`（`recall()` 的 L0 分支）、`lib/recall-fusion-pre.js`、`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`
- 应产出：`lib/index.js` 最小 diff + 新断言
- 额外验收：必须有「lex 相同、sem 不同 → 排序随 sem 变化」的断言；回报须含 **legacy vs rrf 的 top-5 id 序列 diff**（≥3 条查询）
- 备注：本段是**缺陷修复**（P2 语义臂当前实效为零），默认开启 + `legacy` 回退

**轮次 12 · M8-2b evidence 管道 + importance 加权**（前置：轮次 11 完成）
- ⭐ **复制即投喂**：直接复制 `docs/prompts/FIX-AGENT-M8-2b.md` 全文（**自包含**，无需 `_COMMON.md`）
- 或按公式投喂：`_COMMON.md` + `M8-2b-evidence-pipeline.md`
- Agent 要读的仓库文件：`lib/index.js`（`6861-6876` 读取范式）、`lib/context-bridge-pre.js`、`lib/memory-importance-pre.js`、`lib/fact-store-pre.js`、`lib/procedure-store-pre.js`、`lib/recall-fusion-pre.js`
- ⚠️ Agent 必须**实读一个真实 events 文件**确认行结构（`~/.dsh/memory/evidence-pre/events/*.jsonl`）
- 应产出：`lib/evidence-agg-pre.js` + smoke + `recall()` 加权接线
- 额外验收：只读性断言（不写回 events）、空数据返回中性值、有界读取（默认 7 天/末 400 行）


**轮次 13 · P9 evidence 写入侧覆盖率排查**（前置：轮次 12 完成；**默认只排查，不改码**）
- ⭐ **复制即投喂**：`docs/prompts/FIX-AGENT-P9.md` 全文（自包含，硬约束已内联）
- Agent 要读：`lib/index.js`、`lib/context-bridge-pre.js`、`lib/procedure-store-pre.js` + 真实 events 目录
- 应产出：实测 kind 分布 + reuse/success/correction 各自根因（(a) 未接线 / (b) 条件未满足 / (c) 分流）+ 修复方案（待你批准）
- 额外验收：`git status` 中 **lib/ 不得有任何改动**（排查段）


**轮次 14 · P11 静默 catch 可观测**（无依赖，**建议与轮次 13 并行**）
- ⭐ **复制即投喂**：`docs/prompts/FIX-AGENT-P11.md` 全文（自包含，可与轮次 13 并行）
- Agent 要读：`lib/index.js`（recall/接续链路的 catch）、`diag()` 定义处
- 额外验收：`git diff` **仅含 catch 行**（无控制流改动）；给出全仓空 catch 清单与取舍理由

**轮次 15 · P10 importance 效应定标**（前置：轮次 13 的 P9 结论）
- 投喂：`_COMMON.md` + `P10-importance-calibration.md`
- Agent 要读：`lib/index.js`（dense 臂）、`lib/memory-importance-pre.js`、既有配置读取机制
- 应产出：`w` 可配置（默认 0.5，行为等价）+ **三档翻转率实测**（w=0/0.5/1，≥10 条真实查询）+ 至少 1 个翻转样例
- ⚠️ 若没有统一配置机制 → Agent 必须停止回报，不得自造配置文件

---

## 三、依赖关系一图

```
轮次1(P1) ──→ 轮次5(P2) ──→ 轮次6(P3) ──→ 轮次7(P4)
轮次2(P5) ──→ 轮次8(P6)                    轮次6 ──→ 轮次9(M8-2) ──→ 轮次10(M8-3，需你确认)
轮次3(P7)
轮次4(M8-1)
轮次6(P3) ──→ 轮次11(P8 RRF 接线) ──→ 轮次12(M8-2b evidence 管道)
轮次12 ──→ 轮次13(P9 排查) ──→ 轮次15(P10 定标)；轮次14(P11) 无依赖可并行
（1–4 互不依赖，可并行；10 永远最后；11/12 为收官后补做）
```

## 四、常见翻车点

1. **只粘任务文件、忘粘 `_COMMON.md`** → Agent 会整文件重写。
2. **同一会话连喂多轮** → 上下文互相污染；每轮新开会话。
3. **并行 Agent 同改 `lib/index.js`** → 轮次 2/3 都改它，须串行验收（A 批次里这两轮错开跑）；P2/P3/P4 与 P5/P6 同理。
4. **跳过验收直接下一轮** → 错误跨轮传播，最后归因不了。
