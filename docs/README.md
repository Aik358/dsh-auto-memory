# 文档目录

源码核对：2026-10-06。使用入口在下表；阶段材料按原日期解读。

## 使用、接手与贡献

| 文档 | 回答什么 |
|---|---|
| [HANDBOOK.md](HANDBOOK.md) | 环境、架构、运维、回归与验收 |
| [SOURCE-REFERENCE.md](SOURCE-REFERENCE.md) | 常用默认值与完整源码入口 |
| [USER-GUIDE.zh-CN.md](USER-GUIDE.zh-CN.md) | 中文安装与功能用法 |
| [USER-GUIDE.en.md](USER-GUIDE.en.md) | English installation and usage |
| [WHITEPAPER.md](WHITEPAPER.md) | 存储、归属与生命周期约束 |
| [FRONTEND-CO-CREATION.md](FRONTEND-CO-CREATION.md) | 前端修改落点与贡献边界 |
| [SKIN-GUIDE.md](SKIN-GUIDE.md) | 皮肤 token、CSS 与资源规则 |
| [TEAMWORK-GUIDE.md](TEAMWORK-GUIDE.md) | 团队功能与未实装边界 |

## 研究与阶段契约

保留研究结论、原阶段命名和实验规模；看日期、数据集与执行证据后引用。操作步骤、默认值、当前文件名先核对源码速查。

- [Issue 反馈（roadmap-aligned，2026-08-26）](ISSUE-REPLY-UNATTENDED.md)
- [M3b 稳定 Anchor 与持久索引契约](M3B-CONTRACT.md)
- [M4 Shadow Retrieval 契约](M4-CONTRACT.md)
- [M5 JS Context / Evidence Bridge 指导性契约](M5-CONTRACT.md)
- [M6 JS Activation Inbox / Reference Tail 指导性契约](M6-CONTRACT.md)
- [M7 Activation 算法扩展参考：中文方向与跨中英文](M7-ACTIVATION-ALGO-REFERENCES.md)
- [M7-8 Shadow Semantic Calibration(Phase F 校准报告)](M7-ACTIVATION-CALIBRATION.md)
- [M7 Activation Feature v2 校准报告](M7-ACTIVATION-FEATURE-CALIBRATION.md)
- [M7 Activation Feature Design](M7-ACTIVATION-FEATURE-DESIGN.md)
- [M7-8 受控 Live Shadow 报告（2026-08-25 晚）](M7-ACTIVATION-V2-CONTROLLED-SHADOW.md)
- [M7 Activation v2 — Held-out Score-Based Evaluation (2026-08-25)](M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md)
- [M7 Activation v2 · Held-out Shadow 操作清单](M7-ACTIVATION-V2-HOLDEDOUT-SHADOW.md)
- [从语义相关到唤起必要：个人记忆系统激活策略的回声陷阱发现、度量与修正](M7-ACTIVATION-V2-PAPER.md)
- [M7-2 算法决策(冻结)](M7-ALGORITHM-DECISION.md)
- [M7 闭环接线：唤起决策 → 系统默认提示词投递（2026-08-26）](M7-CLOSED-LOOP-WIRING.md)
- [M7-2 Embedding / Tokenizer / Chunking Benchmark 报告](M7-EMBEDDING-BENCHMARK.md)
- [M7 接口契约摘要（上下文压缩恢复用速查）](M7-INTERFACE-DIGEST.md)
- [M7 Activation Calibration 标签复核与定向扩充报告](M7-LABEL-REVIEW-REPORT.md)
- [JS 词法降级层（lexical_pre_v2）调优实验报告](M7-LEXICAL-TUNING.md)
- [M7 Python Semantic Engine 实施研究报告](M7-PYTHON-IMPLEMENTATION-REPORT.md)
- [面向开发者记忆系统的多语言嵌入式检索选型研究](M7-RESEARCH-PAPER.md)
- [M8 记忆中枢（Memory Hub）：三层记忆系统路径/功能图](M8-MEMORY-HUB.md)
- [五大开源 Agent 记忆系统全景对比（2026-09 更新版）](MEMORY-SYSTEMS-SURVEY-2026-09.md)
- [面向异构大语言模型 Agent 的宿主侧主动联想记忆中间件](proactive-associative-memory-research-report.zh-CN.md)
- [M7 Python Semantic Engine 完整实施契约](PYTHON-SIDECAR-CONTRACT.md)

## 历史计划与交接

[归档目录](archive/README.md)按计划、交接、宣传分组，仅供追溯。

## 工程记录与设计素材

| 位置 | 用途与边界 |
|---|---|
| [internal/](internal/) | 内部审计、工程决策与证据；仅在源码仓库维护 |
| [teamwork-impl/](teamwork-impl/README.md) | 团队实现阶段记录；看各轮日期和代码身份 |
| [teamwork-research/](teamwork-research/README.md) | 团队研究与设计素材 |
| [landing/](landing/) | 静态项目主页 |
| [screenshots/](screenshots/) | 截图与宣传资源；截图不替代本次验收 |
| [prompts/](prompts/) / [promo/](promo/) / [proposal/](proposal/) | 原阶段委派、宣传与提案材料 |
| [ui-demo/](ui-demo/) | 历史界面演示 |


文档和设计素材保留在源码仓库；npm 包内容以 `package.json` 的 `files` 为准。

[中文 README](../README.zh-CN.md) · [English README](../README.md) · [CHANGELOG](../CHANGELOG.md)
