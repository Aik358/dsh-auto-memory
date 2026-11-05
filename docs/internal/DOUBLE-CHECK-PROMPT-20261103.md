# 独立复核任务提示词（供第二位 Agent 做 double check）

> 复制下面「=== 提示词开始 ===」到「=== 提示词结束 ===」之间的全部内容，交给另一位 Agent。
> 目的：对「注入档位（user full/slim、run full/slim）」的调查结论做**独立复核**，不采信既有结论。

=== 提示词开始 ===

# 任务：独立复核 dsh-auto-memory 注入档位实现（禁止采信既有结论）

你是**独立复核者**。仓库：`D:\dsh-auto-memory`（DSH 插件 dsh-auto-memory，Node ESM，无第三方运行时依赖）。

## 你的立场（非常重要）

已有一份调查报告声称发现了若干缺陷。**你的任务不是确认它，而是独立重做一遍**：
- 你可以得出相同结论，也可以**推翻**它。推翻同样是有价值的交付。
- **禁止**先读已有结论再去找证据（确认偏误）。正确顺序：先自己查代码与实测，得出你的结论，**最后**再与已有报告比对，逐条写「一致 / 不一致 / 无法判定」。
- 凡你说「存在缺陷」，必须给出 **file:line + 可复现命令 + 实测输出**。
- 凡你没能验证的，明确写「未验证」，不要用「应该是 / 大概是」填充。

## 背景术语（用于定位，不作为结论）

本插件有「注入档位」机制，注入文本按档位渲染成完整版（full）或精简版（slim）。据称存在四档：
`human_full` / `human_slim` / `run_full` / `run_slim`（真人侧 vs 自动运行侧各两档）。
可能的落点（**线索，需你自己核实真伪**）：
- `lib/index.js`：INJECT_TIERS 枚举、`decideInjectTierPre`、`planSpecForTierPre`、`isRulesFullTierPre`、`isHumanTierPre`、`renderSlimSnapshotPre`、`renderMemoryDynamic`、`renderMemoryStatic`
- `lib/rules-layer.js`：`renderRulesSectionPre`、`renderRulesSlimPre`、`extractRulesLayerPre`、`detectLegacyFormatPre`
- `lib/memory-envelope.js`：`composeMemoryEnvelopePre` 与各段预算
- `lib/user-portrait.js`、`lib/tier-layer-inject.js`、`lib/injection-policy.js`

## 必须回答的问题

### 1 · 档位枚举与判定
1.1 全仓检索档位枚举（关键词：INJECT_TIERS、human_full、human_slim、run_full、run_slim）。列出**每个档位值的定义位置**与**所有引用位置**（file:line）。
1.2 判定函数是谁？它的入参是什么、返回值被谁消费？给出**从判定到帧渲染的完整调用链**（逐跳 file:line）。
1.3 是否存在**同一语义多处各写一份判据**（本仓历史病）？若有，列出全部副本并说明它们是否等价。

### 2 · 可达性（核心）
2.1 对 `human_slim` / `run_slim` 分别在**生产路径**上验证可达性：从入口（会话注入装配）一路到最终返回的文本，逐跳确认判定的返回值没有被丢弃、没有被更早的 return 短路、没有「降级发生在渲染之后」这类时序错误。
2.2 若不可达，指出**确切的那一行**与推理链。若可达，给出一条能触发它的**最小调用序列**（可写成脚本）。
2.3 特别检查：是否存在 try/catch 把异常吞掉导致某条分支永不生效？（本仓历史事故：`catch (_) {}` 吞掉 ReferenceError 使整条门控失效。）建议做法：把可疑片段抽出来**真执行**（`new Function` / `vm` / 单独脚本），不要只靠读代码。

### 3 · 四档两两区分度（实测）
3.1 用**同一份真实记忆数据**（就用本仓库当前工作区的真实数据，不要造数据），分别按四个档位各装配一次注入文本，落盘到 `artifacts/doublecheck-tiers-20261103/`。
3.2 给出四份文本的：字符数、字节数、sha256、**段标题清单**。
3.3 给出 **6 对两两重叠矩阵**：行重叠率、字符重叠率。
3.4 判据：**不同语义档之间不得 sha256 完全相同**。凡相同的，点名并定位原因（共用渲染器？判定写错落到同分支？）。

### 4 · 与「用户设计意图」的符合度
用户声明的意图是：
> full 档**不应每轮注入**，只在【会话首轮 / 上下文压缩后 / 压缩水位到 25% 和 50% 时人说话的下一轮次】注入，且**不设注入量上限**（或上限极大）；其余时候都注入 slim。

4.1 分别对 user 侧与 run 侧，逐条判定「满足 / 不满足 / 无法判定」，并给证据。
4.2 特别验证「25% / 50% 水位」这条钩子：找到水位判定（关键词：waterPct、parseWaterPctThresholdsPre、decideWaterPctFirePre、fullInjectWaterPct），确认它是否**真的能触发**。给出触发条件与验证方法。
4.3 4000 字符这类「预算」到底是**告警线**还是**截断线**？去 `lib/rules-layer.js` 找原文，给出 file:line 与原文引用。
4.4 用户记忆（user-memory）、项目笔记（project-notes）这两个数据源在注入时**实际被截到多少**？给出「注入字符数 / 源文件字符数」的比值。

### 5 · 与已有报告比对
在你完成 1–4 之后，读 `docs/internal/INVESTIGATE-USER-TIERS-20261103.md`，逐条列出：
- 你的结论与它**一致**的有哪些
- **不一致**的有哪些（给出你的证据）
- 你**无法判定**的有哪些（说明缺什么证据）

## 交付

- 报告：`docs/internal/DOUBLECHECK-TIERS-20261103.md`
- 证据：`artifacts/doublecheck-tiers-20261103/`（四份注入文本 + metrics.json + 重叠矩阵 CSV + 可复算脚本）
- 报告结尾给：bytes / 行数 / sha256；以及一条「**本次复核的最大不确定性是什么**」。

## 硬纪律

1. **只读**：不得修改 `lib/` 下任何文件，不得 commit / push / 改版本号。
2. **禁止采信**：不要因为「已有报告这么写」就当作事实。每条都要自己验。
3. **禁止静态冒充功能**：不许用「源码里有某字符串」当功能证据。要么真执行，要么明确标为「守卫，非功能证据」。
4. **给可复算物理量**：字节数、sha256、PASS/FAIL 数。
5. 退出码必须直接取被测程序的（`node x.mjs > /tmp/x.log 2>&1; echo EXIT=$?`），**不要**经过管道取 `$?`。
6. 若发现与本提示词背景描述矛盾的事实，**以你实测为准**，并在报告里明确指出背景描述错在哪。

=== 提示词结束 ===