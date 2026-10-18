# News 文案 · 2026-10-15

> **状态**：研究综述 · 下一阶段研究议程
> **用途**：主页 `landing/news` 的短文案草稿；对应[完整版综述](REVIEW.zh-CN.md)，不代表人格型配置已经发布。

## 标题

**她记得你，也记得你们**

## 副标题 / 导语

从 8 月 19 日的“谁决定何时召回”，走向下一阶段的“记忆为什么在此刻参与回应”：面向工作、助理与长期交流场景，研究情境化主动记忆、共同经历、克制表达，以及跨模型的主体连续性。

## 新闻卡片摘要（约 80–120 字）

主动召回让记忆自己出现。下一阶段继续追问：同一条记忆在工作、助理和长期交流中，应以怎样的分寸参与回应？本篇前瞻综述围绕共同经历、介入强度与跨模型连续性提出研究议程，把“更像一个持续存在的主体”变成可复算的评测问题。

## 新闻短文

你在赶项目，说了一句“又要重来一遍”。她最好想起上次踩过的坑。合上电脑，再说出同一句话，你也许只是想把今天讲完。

同一段过去，进入不同的此刻，需要不同的分寸。

8 月 19 日，我们为“无问自忆”划定了运行时边界：宿主观察上下文，在模型开口前送入相关记忆。下一阶段，我们继续追问：**记忆怎样参与理解一个人，以及你们共同经历过的事情？**

她需要记住的，可以包含一起完成的项目、曾经作出的承诺、被你纠正的误解，还有没有谈完的话题。这样的记忆，有时适合被自然提起，有时只该影响建议，有时需要先问一句，也有些应该等待。让她记得更多之前，我们要先研究每一次想起的理由。

这会改变整套系统的目标。工作、助理和长期交流，可能需要不同的唤起门槛、使用方式与表达尺度。我们将沿用宿主侧主动召回的基础，把“找到了”“送进了模型”“回答用上了”“向用户说出来了”分别记录、分别检验。那些让人觉得被理解的瞬间，也必须能够回到具体证据。

这一方向已有值得认真对话的先行研究：CHI 2026 的 [RECALLbot](https://doi.org/10.1145/3772318.3790714) 联合研究记忆与互惠披露；ACL 2026 的 [ENPMR-Bench](https://aclanthology.org/2026.findings-acl.2080/)、[StratMem-Bench](https://aclanthology.org/2026.acl-long.1491/) 和 [KnowMe-Bench](https://aclanthology.org/2026.acl-long.1394/) 分别探索情感主动检索、策略性记忆使用与人物理解。新综述会正面梳理这些成果，再提出本项目的跨情境、分组件验证路线。

还有一个更远的问题：底层模型会更换，窗口会翻页，共同经历、承诺和相处方式能否继续留下？用户会怎样判断，这还是不是自己熟悉的那个 Agent？

本文为下一阶段研究定下问题与路线；关系型策略的实际效果仍待验证。我们希望把“赋予 Agent 灵魂”的直觉，落在共同历史、感知连续性、可问责性与分寸感上。

**她为何想起，怎样回应，何时安静。下一阶段，从这里开始。**

## 社交媒体一句话

从“记忆如何主动出现”，走向“记忆如何在一段长期关系中恰当地参与回应”：下一阶段，我们研究共同经历、主动克制与跨模型的 Agent 连续性。

## English

### Title

**She Remembers You — and Remembers Us**

### Card summary

From deciding *when* memory should surface to studying *why and how* it should shape a relationship: a forward-looking agenda for context-conditioned recall, shared history, restraint, and continuity across model changes.

### News article

You are racing a deadline and say, “I have to start again.” It may help if she remembers what went wrong last time. Later, with the laptop closed, the same words may simply mean you want to finish telling her about your day.

The same past can matter differently in the present.

On August 19, we defined a runtime boundary for proactive recall: the host observes context and brings relevant memories into the next model request. The next phase asks how memory can support understanding a person and the history of what you have done together.

That history could include a finished project, a promise, a misunderstanding you corrected, or an unfinished conversation. Sometimes it should be mentioned. Sometimes it should only inform a suggestion. Sometimes a question or a pause is more appropriate. Before asking her to remember more, we want to study the reasons for each recall.

The goal changes across work, practical assistance, and ongoing conversation. Our proposed research separates what was retrieved, what reached the model, what the answer used, and what was explicitly disclosed. Moments that feel understanding must also be traceable to evidence.

Relevant work already provides foundations. [RECALLbot](https://doi.org/10.1145/3772318.3790714) studies memory alongside reciprocal disclosure; ACL 2026 benchmarks [ENPMR-Bench](https://aclanthology.org/2026.findings-acl.2080/), [StratMem-Bench](https://aclanthology.org/2026.acl-long.1491/), and [KnowMe-Bench](https://aclanthology.org/2026.acl-long.1394/) examine affective retrieval, strategic memory use, and person understanding. Our review builds on these findings to propose component-wise, cross-context tests of host-side memory policies.

A further question remains: when the underlying model changes, can shared history, commitments, and interaction preferences help preserve the continuity users perceive?

This article sets the next research agenda; the project's relational benefits remain to be tested. It turns the intuition of giving an agent a “soul” into questions about shared history, continuity, accountability, and appropriateness.

**Why she recalls, how she responds, when she stays quiet. The next phase starts here.**

## 发布备注

- 主页卡片建议标注：`研究综述 · 下一阶段研究议程`。
- 短文案只宣告研究方向与问题，不写“已实现人格型 Agent”“已经证明更有灵魂”或“世界首创”。
- 完整综述应单独交代相关工作，包括 RECALLbot（CHI 2026，N=40、两周实地研究）及其他长期伴侣、人格一致性、具身记忆和 Agent 记忆中间件研究；本页不承担完整文献表。
