# 五大开源 Agent 记忆系统全景对比（2026-09 更新版）

> 基于 B 站视频《Agent记忆系统深度拆解（下）》（2026-04）+ 各仓库 9 月最新 README 综合整理。
> 视频摘要由 B 站 AI 总结功能提取；仓库状态截至 2026-09-06。

---

## 一、总览对比表

| 维度 | MemOS 2.0 | OpenViking | Hindsight | Second Me | MetaMem |
|------|-----------|------------|-----------|-----------|---------|
| **定位** | Memory OS（统一存储/检索/管理） | Context Database（文件系统隐喻） | Learning Memory（学习>记忆） | AI Self（个人数字分身） | Meta-Memory（元记忆优化知识利用） |
| **Stars** | 11.2K | 35.7K | 22.7K | 15.7K | 44 |
| **语言** | TypeScript | Python | Python | Python | Python |
| **最近更新** | 2026-09-03 | 2026-09-06 | 2026-09-06 | 2025-09-30 ⚠️ | 2026-07-02 |
| **记忆类型** | 文本/图像/工具trace/人格，图结构 | L0抽象/L1概览/L2详情三层 | Episodic/Semantic/Procedural + Mental Models | L0/L1/L2 知识蒸馏 + LoRA | 自进化元记忆（符号化经验规则） |
| **存储后端** | SQLite + 向量 + 图（Multi-Cube KB） | viking:// 虚拟文件系统 + 向量索引 | PostgreSQL + 向量 + 知识图谱 | 本地文件 + LoRA 权重 | LightMem + 向量检索 |
| **检索机制** | Hybrid (FTS5 + vector) + 反馈修正 | 目录递归检索（先定位目录再逐层钻取） | MPFP 图检索 + Consolidation 巩固引擎 | HMM 层级建模 + Me-Alignment | Partial Correctness Filter + 自反思迭代 |
| **巩固/蒸馏** | 自然语言反馈修正/补充/替换记忆 | Session commit 后异步提取偏好和经验 | Retain→Recall→Reflect 三操作循环 | L0→L1→L2 层级蒸馏 + LoRA 微调 | 自反思 + 环境反馈迭代蒸馏可迁移经验 |
| **集成方式** | DSH/Hermes/OpenClaw 插件 + Cloud API | MCP Server + SDK + Studio Playground | Docker Server + MCP + 25+ LLM Provider | 独立训练/部署 + 去中心化网络 | 研究代码 + LightMem 依赖 |
| **Benchmark** | LoCoMo 88.83, LongMemEval 89.20 | Token 成本降低 92%~96%（官方） | LongMemEval SOTA（Virginia Tech 独立复现） | 无公开 benchmark | ACL'26 Findings 论文 |
| **核心差异点** | 统一 API + Multi-Cube 隔离 + 异步调度 | 文件系统隐喻（ls/tree/find）+ 可观测检索轨迹 | "学习"而非"记住" + Fortune 500 生产验证 | 个人 AI 身份 + 去中心化网络 + 隐私优先 | 不管存储只管"会不会用" + 元认知层 |

---

## 二、逐系统详解

### 1. MemOS 2.0 Stardust（MemTensor/MemOS）

**架构核心**：六层架构 + 三类记忆（文本/激活/参数），LoRA 记忆目前仍是 Placeholder。

**关键特性**：
- **Unified Memory API**：增删改查统一接口，记忆以图结构组织，可检视可编辑（非黑盒向量库）
- **Multi-Cube KB**：多个知识库作为可组合的"记忆立方体"，支持用户/项目/Agent 间的隔离与动态组合
- **MemScheduler**：异步摄入，毫秒级延迟，高并发生产稳定
- **Memory Feedback & Correction**：自然语言反馈修正/补充/替换已有记忆

**4 月以来重大更新**：
- 2026-08-17：**接入 DeepSeek Harness**（本地 + Cloud 双插件），自动召回 + 后台捕获 + hybrid retrieval + Memory Viewer
- 2026-07-02：OpenClaw 任务完成率从 36.63% → 50.87%；LoCoMo 88.83 / LongMemEval 89.20
- 2026-05-09：memos-local-plugin 2.0（Hermes/OpenClaw），L1 traces → L2 policies → L3 world models → crystallized Skills

**对 dsh-auto-memory 的启发**：
- Multi-Cube 隔离思想 ≈ 我们的工作区隔离，但更灵活（可动态组合）
- 自然语言反馈修正记忆 → 我们目前只有手动编辑，可加 `memory_correct` 工具
- 已原生支持 DSH → 可作为我们的语义后端替代方案

---

### 2. OpenViking（volcengine/OpenViking）

**架构核心**：字节火山引擎出品的"上下文数据库"，文件系统隐喻 + L0/L1/L2 分层。

**关键特性**：
- **viking:// URI**：记忆/资源/技能统一为虚拟文件系统，Agent 用 `ls`/`tree`/`find` 浏览上下文
- **三层加载**：写入时自动处理为 L0（一句话摘要）/ L1（核心信息）/ L2（完整原文），按需加载
- **目录递归检索**：向量搜索先定位最高分目录，再逐层钻取，结果带完整上下文
- **可观测检索**：每次查询保留目录浏览轨迹，结果不对时可追溯路径
- **Session → Memory**：会话 commit 后异步提取用户偏好和 Agent 经验入长期记忆

**Token 成本**：官方称降低 92%~96%（L0/L1 预判避免加载 L2）。

**对 dsh-auto-memory 的启发**：
- L0/L1/L2 分层 ≈ 我们的 PLAN.md（L1）+ 日志原文（L2），但我们缺 L0 快速相关性判断
- 目录递归检索比扁平向量搜索更有结构性 → 我们的 handoff/ 目录天然适合这种模式
- 检索轨迹可观测 → 我们的 evidence chain 是同类思路，但粒度在消息级而非目录级

---

### 3. Hindsight（vectorize-io/hindsight）

**架构核心**：仿生三层记忆 + MPFP 图检索 + Consolidation 巩固引擎。**核心理念："学习"而非"记住"**。

**关键特性**：
- **三种记忆类型**：Episodic（情景）/ Semantic（语义）/ Procedural（程序性）+ Mental Models（心智模型）+ Knowledge Pages
- **Retain → Recall → Reflect 三操作循环**：不只是存取，还有反思巩固
- **MPFP 图检索**：Multi-Perspective Fact Propagation，图上多视角事实传播
- **Consolidation Engine**：主动巩固，将碎片记忆整合为结构化知识
- **25+ LLM Provider**：包括 openai-codex / claude-code / github-copilot 订阅直接用

**Benchmark**：LongMemEval SOTA，Virginia Tech + Washington Post 独立复现。Fortune 500 生产使用。

**对 dsh-auto-memory 的启发**：
- Reflect 操作 → 我们有每日反思但缺"反思驱动的记忆重组"
- Mental Models → 我们的 PLAN.md 白板是雏形，但缺跨会话的心智模型演化
- Procedural Memory → 我们的 skill crystallization 是同一路径，但 Hindsight 的巩固引擎更系统化

---

### 4. Second Me（mindverse/Second-Me）⚠️

**架构核心**：本地训练"第二个你"，L0/L1/L2 知识蒸馏 + LoRA 微调 + 去中心化网络。

**关键特性**：
- **Hierarchical Memory Modeling (HMM)**：层级记忆建模 + Me-Alignment 算法
- **L0/L1/L2 知识蒸馏**：从原始数据到身份理解的层级提炼
- **LoRA 微调**：将记忆编码进模型权重（不是外挂检索）
- **去中心化网络**：AI Self 可在网络上代表你交互
- **100% 本地**：训练和推理全在本地

**⚠️ 注意**：最后更新 2025-09-30，已一年未活跃。视频中提到的"100% 本地的隐私悖论"（LoRA 权重本身可能泄露隐私）仍是开放问题。

**对 dsh-auto-memory 的启发**：
- 理念差异大：Second Me 是"成为你"，我们是"辅助你"——路线不同
- LoRA 编码记忆 → 参数级记忆 vs 我们的文本级记忆，互补而非竞争
- 活跃度低，暂不建议直接借鉴实现

---

### 5. MetaMem（OpenBMB/MetaMem）

**架构核心**：ACL'26 Findings 论文实现。不管存储只管"会不会用"——Learning to Learn 元记忆层。

**关键特性**：
- **Self-Reflective Symbolic Optimization**：自反思符号优化，迭代蒸馏可迁移的知识利用经验
- **Partial Correctness Filter**：部分正确性过滤，从失败案例中提取有效规则
- **元记忆框架**：不直接存事实，而是存"如何从散乱记忆中提取关键证据"的策略
- **跨架构泛化**：在多种 RAG 架构上显著提升多会话整合和时间推理

**规模**：44 stars，学术原型，非生产系统。依赖 LightMem + Qwen3/Llama3.1 + LLMLingua-2。

**对 dsh-auto-memory 的启发**：
- "元记忆"概念最有价值：不只记什么，还记"怎么用记忆"→ 我们的 advisory prompt 是手工版元记忆
- Partial Correctness Filter → 我们的失败项记录（"方案→失败原因"）是同思路的简化版
- 学术原型，不可直接用，但思想可融入 M-CM3+ 的检索策略优化

---

## 三、对 dsh-auto-memory 的综合启发

### 可直接借鉴的（短期）

| 来源 | 启发 | 落地建议 |
|------|------|----------|
| MemOS | 自然语言反馈修正记忆 | 新增 `memory_correct` 工具，支持"这条记忆不对，应该是…" |
| OpenViking | L0 快速相关性判断 | PLAN.md 头部加一行 L0 摘要，注入时先给 L0 再按需展开 |
| Hindsight | Reflect 驱动记忆重组 | 每日反思不止生成文本，还触发记忆条目的合并/归档/升级 |
| MemOS | 已原生支持 DSH | 评估 memos-local-plugin 作为可选语义后端 |

### 中期方向

| 来源 | 启发 | 对应 M-CM 路线 |
|------|------|----------------|
| OpenViking | 目录递归检索 + 检索轨迹可观测 | M-CM3 sessionProjections 深度接入 |
| Hindsight | Mental Models 跨会话演化 | PLAN.md → 心智模型版本化（不只是快照） |
| MetaMem | 元记忆策略学习 | advisory prompt 从手写规则 → 从历史反馈中自动优化 |

### 长期愿景

| 来源 | 启发 | 备注 |
|------|------|------|
| Second Me | 参数级记忆（LoRA） | 与文本级记忆互补，需本地训练基础设施 |
| Hindsight | "学习"范式 | 从"记住发生了什么"到"学会怎么处理类似情况" |
| MemOS | Multi-Cube 动态组合 | 跨工作区/跨项目的记忆动态编排 |

---

## 四、仓库链接

| 系统 | GitHub | 论文/文档 |
|------|--------|-----------|
| MemOS | [MemTensor/MemOS](https://github.com/MemTensor/MemOS) | [arXiv:2507.03724](https://arxiv.org/abs/2507.03724) · [Docs](https://memos-docs.openmem.net/) |
| OpenViking | [volcengine/OpenViking](https://github.com/volcengine/OpenViking) | [Blog](https://blog.openviking.ai/post/openviking-context-database/) · [Docs](https://docs.openviking.ai/) |
| Hindsight | [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) | [arXiv:2512.12818](https://arxiv.org/abs/2512.12818) · [Benchmarks](https://benchmarks.hindsight.vectorize.io/) |
| Second Me | [mindverse/Second-Me](https://github.com/mindverse/Second-Me) | [arXiv:2503.08102](https://arxiv.org/abs/2503.08102) · [Homepage](https://home.second.me/) |
| MetaMem | [OpenBMB/MetaMem](https://github.com/OpenBMB/MetaMem) | [arXiv:2602.11182](https://arxiv.org/abs/2602.11182) (ACL'26 Findings) |
