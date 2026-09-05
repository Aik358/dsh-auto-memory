# M-CM 集成规划：上下文管理系统（对标 Codex history-notes / new_context）

> 2026-09-06 源码级调查后产出。目标：把"上下文管理"有机接入现有 M1–M7 架构，而不是另起炉灶。
> 功能事实对账以 [NEXT-MAJOR-VISION.md](NEXT-MAJOR-VISION.md) §2 为准；本文件是实施蓝图（路标非权威，实现以代码与测试为准）。

---

## 0. 情报摘要

### 0.1 Codex 真实机制（openai/codex 源码证据，2026-09-06 抓取）

`features.context_management.experimental_mode`（v0.153.0，2026-09-03，默认关）激活三件套：**token 预算上下文 + history notes + `new_context` 工具**。源码事实：

- **笔记是服务端存储**：`codex-rs/ext/history-notes/src/backend.rs` 把 `alpha/notes/v2/write_file`、`append_to_file`、`search_contents`、`alpha/history/v2/search_contents` 全部 POST 到 OpenAI 后端（加密参数头 `x-openai-encrypted-tool-arguments`）。**笔记不在用户机器上。**
- **门槛校验在源码里**：`extension.rs` 要求 `token_budget.use_history_notes_extension && provider.is_openai() && auth_uses_codex_backend()`——API-key 会话、自定义 provider 全部排除。
- **窗口续命 = thread_hint 片段**：`ContextContributor` 在线程启动时调 `alpha/notes/v2/thread_hint`，取回 **≤4KB** 文本，以 `PromptSlot::ContextWindow` + 内容类型 `notes.thread_hint` 注入新窗口。超 4KB 直接判失败不注入。
- **new_context 工具只有一行**：`handlers/new_context_window.rs` → `session.request_new_context_window()`，回执文案 "A new context window will start without summarizing conversation history."——**开新窗是 host 的领地，工具只是触发器**（与我们"插件只助产"的边界判断完全一致）。
- **实现形态 = 扩展 + 四种 contributor**（thread lifecycle / config / context / tools）——OpenAI 自己也把这一层做成插件式扩展，验证了我们在 DSH 插件层做这件事的架构正确性。
- 传统压缩仍在：`model_auto_compact_token_limit`（默认 200K 阈值）、`/compact`、`compact_prompt`；0.154.0-alpha 在 TUI 加"实时压缩状态"。

### 0.2 Anthropic 路线（对照）

[Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)（Agent 在本地 memory 目录 CRUD 文件）+ [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)（2026-01 beta，API 级自动压缩）+ context editing。模式 = **有损压缩 + 无损旁路（文件笔记）双轨**。痛点：Claude Agent SDK 的压缩边界对调用方不可见（[SDK issue #772](https://github.com/anthropics/claude-agent-sdk-python/issues/772)）——印证"压缩预告事件"是行业缺口。

### 0.3 Letta/MemGPT 路线（开源先例）

OS 式记忆分层：core memory（上下文内的 self-edited memory blocks，"RAM"）vs archival memory（上下文外的外存，"磁盘"，按需检索拉入）——[Agent Memory](https://www.letta.com/blog/agent-memory/) / [Memory Blocks](https://www.letta.com/blog/memory-blocks/)。开源、本地、Agent 自编辑记忆——与本插件同宗，但其为独立框架，我们为宿主内插件。

### 0.4 命名澄清（2026-09-06 boss 纠正）

"Extra"是误传——boss 所指即 **Astra 本身**：GPT-6 Astra（2026-09-03 发布，9/4–9/5 铺开 Business/Pro）带来的**一套新的上下文机制**（中文媒体口径："上下文窗口填满时不再只靠压缩摘要，而是跨上下文窗口的笔记保留，可检索此前的需求/测试结果/工具输出"，另有 105 万 token 窗口、12.8 万最大输出）。机制挂 Astra 名下，Codex 侧配置键 `context_management.experimental_mode`，将成 Astra 默认。本文 §0.1 的源码级机制调查即该机制的实现细节。

## 1. 对账：现有架构 vs 三家机制

| 能力 | Codex | Anthropic | Letta | 本插件现状 |
|---|---|---|---|---|
| 任务态笔记 | 服务端 alpha/notes（厂商托管） | 本地 memory tool 文件 | core memory blocks | 四层记忆+治理式写回（本地已有；**缺任务态四段结构**） |
| 新窗续命注入 | thread_hint ≤4KB 片段 | —（SDK 压缩黑盒） | core memory 常驻 | 固定边界注入动态快照（**已 live，缺 handoff 专用片段**） |
| 归档可搜索 | 服务端 search_contents | context editing 清理 | archival+检索 | evidence store+词法/语义双臂（已 live）；**会话帧未索引** |
| 开新窗 | new_context 工具触发 | 自动压缩 | 自动分层 | DSH host 领地（**未接**） |
| 水位感知 | session/token_budget.rs | SDK 阈值 | 自动 | M2 ContextObserver 可投影（**未接**） |

结论：四件套里**两件半已存在**，且两处比 Codex 强（本地所有权、语义双臂）。缺的是四件事——正是 M-CM1..4。

## 2. M-CM1 四段式交接笔记（结构化 ledger）

- **存储**：`workspaces/{workspace}/handoff/YYYY-MM-DD-HHMM-{slug}.md`。四段 schema：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步`，头部 front-matter（workspace、触发原因、关联会话 id）。
- **写入者三入口**：①自动沉淀子代理的"里程碑判定"顺手写（复用既有队列/心跳/预算设施）；②`memory_note` 工具显式写（M-CM2）；③水位触发自动写（M-CM4）。全部过 `sanitizeForWrite` 门禁（34 特征 + 8000 字/条）。
- **生命周期**：最近一篇进入注入快照首位（见下）；90 天归档复用 Hermes 规则；**用户可直接读改**——这是与 Codex 服务端加密笔记的根本差异。
- **注入（我们的 thread_hint）**：动态快照首位加"接续摘要"片段——handoff 最新一篇的压缩版（对齐 Codex 4KB 上限教训，设硬预算并给 evidence 引用），内容类型 `handoff.hint`，走既有 M6 固定边界，前缀缓存纪律不破。

## 3. M-CM2 主动检索工具（门控代理标准工具）

- 注册 `memory_search` / `memory_note` 两个工具（CUA 插件 30 工具先例验证可行；**ctx.get() 坑**必须规避）。
- `memory_search(query, scope: notes|logs|handoff|sessions|all, k=5, workspace?)` → 条目 + 来源（文件路径:行号 或 会话帧时间戳）+ evidence 引用（复用 M5 cite 规范）。检索通道：lexical_pre_v2（BM25+CJK 2gram，0GB 兜底）+ C2/BGE-M3 可选升档——复用 M7 双臂与 held-out 校准。
- `memory_note(text, kind: handoff|note)` → 追加写入对应文件，回执含落点。
- **权限分立不破**：工具返回=建议素材（advisory），注入仍只走 M6 固定边界；工具结果不直接改写已发请求。

## 4. M-CM3 会话帧索引（可搜索归档，零复制）

- **不新建存储**：DSH 已把会话持久化为 `session.jsonl.zstd` 帧（v0.1.29 已解压读 cwd）。M-CM3 做**索引而非复制**——增量为王。
- 索引器：增量扫描 profiles 会话目录 → digest 去重 → 按 user/assistant/tool 分条 → 词法倒排（复用 lexical_pre_v2）；语义向量仅对 C2/Python 档启用（复用 M7 index_sync 的 digest/分页思路）。
- 入口：`memory_search scope=sessions`，结果带时间戳与帧位置引用——"笔记没捕获的细节"由此可寻。
- 边界：凭证段过滤**先于**入索引；脏 token 拒入；索引元数据落 memoryRoot 独立目录，可整体删除。

## 5. M-CM4 水位感知与压缩联动

- 水位估计：M2 ContextObserver 已投影上下文——先做回合 token 估算的启发式 fill ratio；若 DSH 暴露真实 token 计数则直连。
- 行为：fill ≥ 80% → 注入 advisory 尾注（"上下文将满，建议开新会话——交接笔记已就绪"）+ 自动写/刷新 handoff；无人值守模式下 advisory 静默（不打断批处理）。
- 压缩预告事件：若 DSH host 有则订阅，压缩发生前自动落 handoff；若无 → **向 DSH 提 feature request**（Anthropic SDK #772 同款痛点=行业缺口，提案有据）。
- 边界重申：开新窗/压缩是 host 领地，插件只提示与助产（与 Codex new_context 设计同理）。

## 6. 差异化事实（宣传可直接引用，全部有源码/文档依据）

1. **本地优先**：Codex 笔记在厂商侧加密存储；我们在用户盘上的纯 Markdown。
2. **模型无关**：Codex 源码硬校验 ChatGPT backend；我们任何模型、任何 provider（含自定义代理）。
3. **可读可改**：Codex thread_hint 服务端生成、只读；我们的 handoff 用户直接编辑。
4. **检索更强**：词法/语义双臂 + 67 条人工金标（actPrecision 0.917、有害注入 0）。

## 7. 排期与验收

| 顺序 | 里程碑 | 依赖 | 验收 |
|---|---|---|---|
| 1 | M-CM1 交接笔记 | 无（纯插件侧） | schema+三写入者+注入片段；smoke（真实函数抽取驱动）+ 复放 precision 不回退 |
| 2 | M-CM2 检索工具 | CM1 存储 | 门控代理 E2E：工具注册/调用/回执/审计；检索复放 |
| 3 | M-CM3 会话帧索引 | 双臂就绪 | 索引覆盖率+增量正确性；scope=sessions 复放召回 |
| 4 | M-CM4 水位联动 | CM1 自动写 | 模拟水位→advisory+handoff 自动落盘；无人值守静默 |

宣传联动：CM1+CM2 live 后，README「她怎么交接」占位章换实装说明，摘除三处"即将上线"标注（位置清单见记忆存档）。

## 8. 风险与开放问题

- DSH 是否暴露 token 计数/压缩事件——**待验证**；无则 M-CM4 降级为启发式 + feature request。
- 会话帧索引隐私边界：凭证段过滤必须先于索引器上线，顺序不可倒。
- 工具返回的 token 预算：对齐 Codex 教训设硬上限（hint ≤4KB 的同款纪律），超出部分给 evidence 引用让模型按需 `memory_search` 深查。
- 工具调用的用户可见性：复用唤起回顾审计页，避免"黑箱工具"观感。
