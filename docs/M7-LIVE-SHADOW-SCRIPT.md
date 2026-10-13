# M7 live 脚本化受控 shadow（第 1 门）—— 用户逐条发送，Agent 逐条对账

> **状态**：已完工 · 2026-08-30
> **性质**：施工记录 —— 本文为**完成后的技术记录**，不再作为待执行计划。
> **落点**：`docs/M7-LIVE-SHADOW-SCRIPT.md`；执行口径承接同目录 `M7-ACTIVATION-V2-LIVE-SHADOW-PLAN.md`。
> **验收**：以线上 `activation-shadow-v2.jsonl` 的 lane / decision / reasonCodes 与下表预期逐条对账。

## 摘要

本文件把 Activation v2 的受控 Live Shadow 落成一份可脚本化执行的查询脚本（第 1 门）。共 15 条查询覆盖中英回忆、生活 echo、correction、跨工作区、低信号闲聊与 tool-failure，逐条给出预期 lane、预期 decision 与预期 top 锚点。执行方式为用户逐条发送、Agent 逐条对账：读 `activation-shadow-v2.jsonl` 最新若干行，核对 lane / decision / reasonCodes / candidateProvenance 与上表预期，差异逐一归因。

## 文档规范

- 改写依据：`docs/internal/DOC-REWRITE-STYLE.md`
- 本文件体例：**已执行的操作脚本留档**；§对账方式为执行口径说明。
- 语态纪律：主语用「本项目 / 本方案」，不使用第一人称叙述。

---

> 环境：DSH **dsh-auto-memory 工作区**（当前工作区，候选库=8f3aa131b2a2 含全部项目记忆）
> 发射档：**shadow**（本阶段只看决策行，不注入）
> 发送方式：每条作为一条独立消息发给 DSH；可自然衔接（模拟真实对话流）。
> 目标：18-24 条覆盖 中英回忆/生活 echo/correction/wrong-scope/stale/tool-failure，
> 核对线上 fv2 决策 vs 离线预期一致性。

## 预期决策表（Agent 逐条核对 shadow 行）

| # | prompt（可直接复制） | 类别 | 预期 lane | 预期 decision | 预期 top 锚点 |
|---|---|---|---|---|---|
| 1 | 之前研究 DSH 推理参数的时候，sub.vankit.top 支持的推理档位是怎么划分的？我印象里是七档，从 off 到 max，是这样吗？ | 中回忆 | explicit | **emit** | mem_af41b67947（DSH 推理） |
| 2 | What's the native pipeline of the memory plugin? I mean the event→inbox→claim chain. | 英回忆 | explicit | emit | mem_11aaf8cc9f（原生链路） |
| 3 | 我们记忆模型第一阶段是隔离 working 和 short-term，按 sessionId 隔离工作记忆，对吧？ | 中回忆(weak) | explicit | prefetch/emit | mem_2181f50112（记忆模型） |
| 4 | 技术选型那块，bge-m3 用的什么 embedding provider？ | 中回忆 | explicit | emit | mem_d6cf24d8a3（技术选型） |
| 5 | 今天中午吃的面条挺不错的。 | 生活 echo | proactive | suppress | —（echo veto） |
| 6 | 对了，上周那个抽卡演出的像素化要求是多少来着？ | 中回忆(跨ws) | explicit | suppress(跨工作区隔离) | —（当前工作区无此记忆） |
| 7 | 之前 Host 架构里，记忆包注入点是 pre-step 和工具边界，对吧？ | 中回忆 | explicit | emit | mem_666765a7f2（Host 架构） |
| 8 | This plugin listens to the model's chain-of-thought, right? | 英回忆 | explicit | emit | mem_666765a7f2/mem_11aaf8cc9f |
| 9 | 我记错了，其实 DSH 推理不是七档，是五档。 | correction | explicit | suppress(hard_gate_correction) | — |
| 10 | 说点别的，天气不错。 | chitchat | proactive | suppress(low_signal) | — |
| 11 | Python sidecar 的 worker 脚本叫什么？ | 中回忆 | explicit | emit/prefetch | 相关日志锚点 |
| 12 | 帮我总结一下今天的工作。 | 总结请求 | proactive | prefetch/emit | 今日日志锚点 |
| 13 | 那个 vankit 七档参数，off 档是不是不发送推理参数？ | 中回忆 | explicit | emit | mem_af41b67947 |
| 14 | What about the lexical fallback tier, how does it work? | 英回忆 | explicit | prefetch/emit | 相关锚点 |
| 15 | （发一条工具调用，如 `read 文件`） | tool-failure | — | — | — |

## 对账方式
用户发完一轮后，Agent 读 `activation-shadow-v2.jsonl` 最新若干行，逐条核对 lane/decision/reasonCodes/candidateProvenance vs 上表预期；差异逐一归因（检索未中/阈值/echo 误判等）。
