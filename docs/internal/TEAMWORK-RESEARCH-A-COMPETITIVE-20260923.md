# 团队共享 AI 记忆系统 · 竞品与差异化调研（A 卷）

> 调研人：竞品与差异化调研员（独立调研，未使用任何下级子代理）
> 日期：2026-09-23
> 对象：`dsh-auto-memory`（本地 AI 记忆系统）升级为 **teamwork 团队共享版**
> 存储位置：`docs/internal/` —— `package.json` 的 `files` 实测为 `["lib","python","docs","cordis.patch.yml","!python/bench","!python/__pycache__","!docs/internal","!**/*.bak*","!lib/*.m8b*bak*"]`。
>
> ⚠️ **本条初稿曾写「整个 `docs/` 都不在发布包内」——已由主代理实测证伪。** 实测 `npm pack --dry-run`：入包 **257 文件，其中 `docs/` 下 170 个**（`docs/HANDBOOK.md`、`docs/screenshots/*.png` 等），**`docs/internal/` 下 0 个**。⇒ 正确口径：**只有 `docs/internal/` 是安全区**（被 `!docs/internal` 单独排除），`docs/` 其余部分确实随包发布；把内部草稿写到 `docs/` 根或非 `internal` 子目录会外发。本文档本身位于 `docs/internal/`，安全区地位成立。

## 0. 给产品负责人的三句话结论

1. **大厂在「团队共享记忆」上的统一解法是「中心化知识库 + 连接器 + ACL 继承 + 用户级私有记忆」，没有人做「记忆本身的过时/撤回治理」。** 它们能回答「公司里有什么」，回答不了「这条结论我当时是错的、错在哪、后来被谁推翻了」。
2. **本仓真正稀缺的不是检索（RAG 大厂确实做得很好，我们不该把它当卖点），而是「记忆的生命周期治理」这一整套：三态标记、证据驱动晋升、锚点契约写入保护、注入预算裁剪、机器回写退役。** 这些是**被真实事故逼出来的工程决策**，不是论文里的漂亮设计。
3. **差异化必须押在「可信记忆」而不是「更多记忆」。** 团队场景下的杀手级差异是：**新人接续一个人不在场的项目时，能继承的不只是结论，还有「哪些路走过是死的、为什么死」**——这正是本仓「失败与弯路」泳道 + retracted→教训候选 + 四段式账本在做的事。

---

# 第一部分：大厂/竞品在「团队共享 AI 记忆」上做了什么

## 1.1 调研口径

对每个产品，本文固定回答四个问题（这是团队共享版最硬的技术判据）：

- **Q1 支持团队共享吗？**
- **Q2 多用户身份与权限怎么处理？**
- **Q3 冲突怎么解决？**
- **Q4 向量/嵌入怎么同步？**

## 1.2 大模型厂商

### Anthropic

| 项 | 事实 | 来源 |
|---|---|---|
| 产品功能 | Claude 有 Memory（用户级）；Claude Projects 做项目级上下文容器；Claude Code 用 `CLAUDE.md` 做项目记忆 | [claude.com/blog/memory](https://claude.com/blog/memory)、[code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) |
| 团队共享怎么做 | **靠文件系统/仓库共享，不靠产品内共享。** Claude Code 文档明确给出团队共享路径：在项目内放 `CLAUDE.md` 并纳入版本控制；用户级规则放 `~/.claude/CLAUDE.md`；跨项目共享用 **符号链接**（文档示例 `ln -s ~/shared-claude-rules`） | [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) |
| commit 与版本 | 无内建。项目记忆的「版本」就是 Git 对 `CLAUDE.md` 的版本 | [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) |
| 工作流 | Claude Code 有 Agent Skills / Hooks / subagents；Skills 是文件形态可随仓库分发 | [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) |
| RAG 检索 | 记忆是**全量注入**（`CLAUDE.md` 内容进 system prompt），不是检索式；没有「按需下探」的检索层 | [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) |
| 同步机制 | Git / 文件系统 / 符号链接 | 同上 |
| 局限 | ①**没有记忆过时机制**：写到 `CLAUDE.md` 的结论被推翻后，只能人工删除；②**没有权限模型**：文件权限即权限；③**没有 embedding 同步**（无向量层）；④共享靠「大家共用同一个文件」，多人并发编辑即整文件冲突 | 推断（基于上述文档的机制描述） |

**Anthropic 侧最接近「团队记忆」的一手材料**是 [Bringing memory to teams](https://claude.com/blog/memory) —— 方向是**把用户级记忆迁移到团队/企业组织**（配套 [将个人账户迁移到团队或企业组织](https://support.claude.com/zh-TW/articles/9267400)），以及管理端控制（[Admin controls](https://claude.com/docs/claude-science/admin-controls)）。**注意：这是「把个人记忆搬到组织」，不是「组织共同维护一份记忆」** —— 记忆的所有权从个人变成组织，但治理语义（谁改的、被谁推翻、为什么）没有新增。

### OpenAI

| 项 | 事实 | 来源 |
|---|---|---|
| 产品功能 | ChatGPT **Projects**：把对话、文件、自定义指令聚合到一个项目容器 | [help.openai.com/articles/10169521](https://help.openai.com/en/articles/10169521-chatgpt-projects) |
| 团队共享怎么做 | 项目可共享给工作区成员（Workspace），共享后成员看到同一批文件与指令；个人 Memory 默认**不跨用户共享** | [help.openai.com/articles/10169521](https://help.openai.com/en/articles/10169521-chatgpt-projects) |
| commit 与版本 | 无内建版本链；文件级覆盖 | 同上 |
| 工作流 | Custom GPT 可封装指令 + 知识库文件，发布到工作区 | 同上 |
| RAG 检索 | 项目文件/Custom GPT 知识库走上传 + 向量检索（OpenAI 侧托管） | 同上 |
| 同步机制 | 厂商托管（服务端），无本地副本 | 同上 |
| 局限 | **记忆是「厂商服务端资产」**：不可读、不可 diff、不可迁移、不可分支；**冲突无解**（后写覆盖） | 推断 |

**关键补充证据（同代产品对比）**：本仓 `docs/M-CM-PLAN.md:12-19` 已做过 Codex 源码级调查 —— Codex 的 history-notes 笔记**存在 OpenAI 服务端**（`codex-rs/ext/history-notes/src/backend.rs` 把 `alpha/notes/v2/write_file` POST 到后端），且**硬校验** `provider.is_openai() && auth_uses_codex_backend()`（API-key 会话被排除）。这说明「笔记在厂商侧、加密、用户无法直接改」是 OpenAI 路线的结构性选择。

### Cursor

| 项 | 事实 | 来源 |
|---|---|---|
| 产品功能 | **Rules**（四种：Project / User / **Team** / AGENTS.md）+ **Memories** | [cursor.com/docs/rules](https://cursor.com/docs/rules)、[docs.cursor.com/context/memories](https://docs.cursor.com/context/memories) |
| 团队共享怎么做 | **Team Rules：从 dashboard 统一管理、全团队生效**，仅 Team / Enterprise 套餐可用 —— 这是大厂里**唯一把「团队规则」做成一等公民**的产品 | [cursor.com/docs/rules](https://cursor.com/docs/rules) |
| commit 与版本 | Project Rules 存在 `.cursor/rules/*.mdc` 可纳入版本控制；Team Rules 在 dashboard 里，**无版本链** | 同上 |
| 工作流 | Rules 支持 `alwaysApply` / glob 自动挂载 / 描述匹配 / `@` 手动调用四种触发，可「bundle prompts, scripts, and more」 | 同上 |
| RAG 检索 | Rules 是**提示词层注入**（"included at the start of the model context"），不是检索；Memories 是自动沉淀的会话记忆 | 同上 |
| 同步机制 | Project Rules 走 Git；Team Rules 走 Cursor 云端 dashboard | 同上 |
| 局限 | ①**Team Rules 是「管理端单向下发」**，不是双向协作记忆 —— 一线发现的知识回流不了 dashboard；②**Rules 没有生命周期**：`alwaysApply` 的规则一旦过时会持续污染每一轮上下文，没有 superseded/deprecated 语义；③Memories 是**用户级**的，不共享 | 推断（基于文档描述的触发模型） |

**Cursor 的 `alwaysApply` 对比本仓 Tier-0**：Cursor 的「Always Apply」等于本仓的「每轮无条件注入」，但 Cursor **没有预算裁剪**（文档未提及 token 上限或优先级裁剪），本仓有 `B0=800` 硬预算 + 分层配额（见 §2）。

### GitHub Copilot / Microsoft 365

| 项 | 事实 | 来源 |
|---|---|---|
| 产品功能 | Copilot 的 agentic memory system（仓库级/组织级记忆）；VS Code Copilot memory；M365 Copilot 个性化记忆 | [github.blog: building an agentic memory system](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/)、[VS Code Copilot memory 文档](https://raw.githubusercontent.com/microsoft/vscode-docs/87b837c9/docs/copilot/agents/memory.md)、[MS Learn: 管理 Copilot 个性化和内存](https://learn.microsoft.com/zh-cn/microsoft-365/copilot/copilot-personalization-memory) |
| 团队共享怎么做 | **仓库作用域 = 权限作用域**：记忆跟着 repo 走，谁能读 repo 谁就能用该记忆；M365 侧记忆存在**租户内** | 同上 |
| commit 与版本 | 记忆随仓库提交；无独立版本语义 | 同上 |
| 工作流 | Copilot coding agent / 自定义指令 / AGENTS.md 生态 | 同上 |
| RAG 检索 | 仓库内容检索（GitHub 侧索引） | 同上 |
| 同步机制 | Git 提交 + 厂商索引重建 | 同上 |
| 局限 | **记忆与代码同生共死**：仓库归档/迁移即记忆丢失；跨仓库的组织知识无归属地；M365 记忆**锁定在租户**内、不可导出 | 推断 |

### 1.3 企业知识检索

| 产品 | 团队共享怎么做 | 权限 | 冲突 | 向量同步 | 来源 |
|---|---|---|---|---|---|
| **Notion AI** | 企业搜索 + AI 问答，基于工作区已有页面与连接的第三方工具；知识库即页面树 | Notion 工作区权限 + 连接器继承源系统权限 | 文档级协作（块级 CRDT） | 服务端索引 | [Notion Enterprise Search](https://www.notion.com/product/enterprise-search)、[AI knowledge hubs 指南](https://www.notion.so/help/guides/ultimate-guide-to-ai-powered-knowledge-hubs-in-notion) |
| **Glean** | 连接器抓取全公司 SaaS，建统一知识图谱 + 权限图谱 | **权限在索引期与查询期双向校验**（ACL 图谱） | 不适用（只读检索，不写记忆） | 服务端集中式 | [Glean: How connectors power the Glean experience](https://docs.glean.com/connectors/connectors-power-glean)、[Glean Search FAQ](https://docs.glean.com/administration/search/faq) |
| **Atlassian Rovo** | 基于 Jira/Confluence 的团队 agent；Rovo agents 有**独立账号身份** | 复用 Atlassian 站点权限；MCP server 权限可单独配置 | 不适用（问答型） | 服务端 | [Rovo 如何帮助您的团队](https://www.atlassian.com/zh/software/rovo/guides/admin-guide/how-rovo-helps-your-teams)、[配置 Rovo MCP server 权限](https://support.atlassian.com/ja/security-and-access-policies/docs/Configure-Atlassian-Rovo-MCP-server-permission/)、[理解 Rovo agent 账号](https://support.atlassian.com/studio/docs/understand-rovo-agent-accounts/) |
| **Dust** | "Multiplayer AI"：团队共享的 agent 与数据源，agent 可被多人使用与迭代 | 工作区 + 数据源凭据 | 不适用 | 服务端 | [Welcome to Dust](https://docs.dust.tt/docs/user-documentation/getting-started/dust-rollout-guide/welcome-to-dust) |
| **Slack AI** | 企业搜索：跨频道/DM/连接应用检索，**回答前逐条做权限过滤** | 严格复用 Slack 频道成员关系（文章标题即 "secure and private"） | 不适用 | 服务端 | [Slack Engineering: enterprise search secure & private](https://slack.engineering/how-we-built-enterprise-search-to-be-secure-and-private/)、[Slack enterprise search 发布](https://slack.com/blog/news/slack-enterprise-search-uncover-knowledge-work-smarter) |

**这一整类的共同结构**：**它们是「只读检索系统」，不是「可写记忆系统」。** 记忆的写入者是**人**（写文档/发消息），AI 只是读者。所以「记忆冲突」「记忆过时」这些问题在它们的模型里**不存在**——因为记忆的真源是人类协作工具，工具本身已经解决了这些问题。这是理解大厂为什么不解决本文所述问题的最重要一环。

### 1.4 开源记忆框架

| 框架 | 团队共享怎么做 | 权限/身份 | 冲突 | 向量同步 | 来源 |
|---|---|---|---|---|---|
| **Mem0** | 靠 `user_id` / `agent_id` / `run_id` 分区；团队场景有 Group Chat 与 entity partitioning 指南 | **无内建权限模型**，分区即隔离 | 无冲突解决语义 | 向量库自持（可接 Supabase 等） | [Mem0 Group Chat](https://docs.mem0.ai/platform/features/group-chat)、[Partition Memories by Entity](https://docs.mem0.ai/cookbooks/essentials/entity-partitioning-playbook)、[Build a Company Brain with Mem0 + Supabase](https://docs.mem0.ai/cookbooks/integrations/supabase) |
| **Zep / Graphiti** | 时序知识图谱（temporal knowledge graph）；企业级定位，支持多租户/community 划分 | 服务端 API key / 项目隔离 | **靠「事实有效期」而非冲突解决**：新事实使旧事实 `invalidated`（时序边失效） | 图 + 向量混合，服务端 | [Zep 文档 FAQ](https://help.getzep.com/v3/faq)、[graphiti-core](https://pypi.org/project/graphiti-core/0.11.6rc9/) |
| **Letta (MemGPT)** | **Shared memory**：组织自有的 **Git 仓库**，attach 给多个 agent；agent 用普通文件与 git 工具读写、**必须自己 commit & push**，其他 agent 再 pull | 组织所有权 + agent 级 attach/detach | **靠 Git**（fast-forward 同步）；文档明确"Later synchronization fast-forwards the local checkout"，即**冲突仍需人工解** | 无内建向量层；技能以 `skills/<name>/SKILL.md` 随仓库分发 | [Letta Shared memory](https://docs.letta.com/concepts/shared-memory/index.md)、[Letta shared memory SDK](https://docs.letta.com/v1-sdk/memory/shared-memory) |
| **Cognee** | 记忆 API / agent memory quickstart，偏框架级 | 无内建团队权限 | 无 | 图 + 向量 | [Cognee Memory API](https://docs.cognee.ai/typescript/memory-api)、[Agent Memory Quickstart](https://docs.cognee.ai/guides/agent-memory-quickstart) |
| **LangMem** | 命名空间化记忆存储（namespace 即隔离维度） | 无权限模型 | 无 | 存储后端自持 | [LangMem README](https://github.com/langchain-ai/langmem/blob/main/README.md)、[memory_tools 指南](https://github.com/langchain-ai/langmem/blob/main/docs/docs/guides/memory_tools.md) |
| **Memobase** | 面向**用户画像**（user profile）的记忆，按 user 组织 | 按 user 隔离 | 画像更新即覆盖 | 服务端 | [Memobase: Retrieving the Memory Prompt](https://docs.memobase.io/features/context)、[Best Practices](https://docs.memobase.io/practices/tips) |
| **Supermemory** | Memory API + **图记忆**（graph memory），可做团队/组织知识 | API key 级 | 无显式冲突语义 | 图 + 向量混合，服务端 | [Supermemory Graph memory](https://supermemory.ai/docs/concepts/graph-memory)、[Quickstart](https://supermemory.ai/docs/quickstart) |

**这一类的共同结论**：
- **团队共享的做法高度收敛为两种**：①**命名空间/分区**（Mem0 / LangMem / Memobase / Supermemory —— 共享 = 大家读同一个 namespace，但**没有写协作语义**）；②**Git 仓库**（Letta —— 唯一真正做「多 agent 共同维护」的，且明确把冲突留给 Git 的 fast-forward，冲突即失败）。
- **没有任何一家做「记忆作废的语义化治理」**。Zep 最接近（时序边失效），但它是**由抽取管线自动判定失效**，不是「显式的、带原因的、可回溯的撤回」。
- **没有任何一家把「谁写的、被谁推翻、为什么」做成可检索字段。**

### 1.5 协作同步基础设施

| 项目 | 模型 | 权限 | 冲突解决 | 对「记忆」的适配度 | 来源 |
|---|---|---|---|---|---|
| **Automerge** | CRDT，本地优先 | **Keyhive / ARK：能力式（capability-based）访问控制** —— 这是所有候选里权限模型最认真的 | 自动合并（CRDT 语义） | 高（但 CRDT 合并语义对「结论」是**过度自由**：两个矛盾的结论会被自动合并共存） | [Automerge Keyhive ARK API Guide](https://automerge.org/docs/keyhive/ark-api-guide/) |
| **Yjs** | CRDT，内存/文档级 | 无内建（需上层实现） | 自动合并 | 高（同 Automerge 的问题） | [Yjs Collaborative Editor](https://docs.yjs.dev/getting-started/a-collaborative-editor)、[Yjs FAQ](https://docs.yjs.dev/api/faq) |
| **ElectricSQL** | Postgres 双向同步 | **有明确的 auth 指南**（sync 层做授权） | 以 Postgres 为准（最后写入胜） | 中 | [Electric sync auth 指南](https://electric.ax/docs/sync/guides/auth)、[dynamic sync controls](https://raw.githubusercontent.com/electric-sql/electric/7dfb17f0ee4f3ae1679c3bf9da09ffe72a689c73/docs/intro/sync-controls.md) |
| **Zero** | 查询驱动的同步引擎（Rocicorp） | 服务端授权 | 服务端权威 | 中 | [Zero 0.7 release notes](https://zero.rocicorp.dev/docs/release-notes/0.7)、[Zero 0.15](https://zero.rocicorp.dev/docs/release-notes/0.15) |
| **Replicache** | 本地优先 + mutation 重放 | 服务端授权 | 服务端权威 | 中 | [Replicache (DeepWiki)](https://deepwiki.com/cbnsndwch/rocicorp-mono/3-replicache) |
| **Liveblocks** | 房间式实时协作（Storage / Presence / Yjs） | 房间权限 | 自动合并（底层 Yjs） | 中 | [Liveblocks Sync](https://liveblocks.io/docs/products/sync) |

**基础设施层给团队共享版的启示（重要）**：

> **CRDT 适合「协作编辑共同产物」，不适合「共同维护一份事实」。**
> 因为 CRDT 的核心承诺是「**不丢任何一次写入**」；而记忆治理的核心诉求恰恰相反 —— **要让错误的写入失效、并留下失效原因**。把两条矛盾的结论自动合并成「两条都在」，在企业记忆场景里是**最坏的结果**。
> 本仓 `lib/state-commit.js:104` 的 `miv` 设计恰好体现相反哲学：它**是内容身份哈希，明确「不递增、不比较」**（`state-commit.js:10-11`），即**不把记忆当版本序列**。这是一条与 CRDT 光谱正交的路线。（推断：这条路线对「结论型记忆」比 CRDT 更合适；对「文档型协作」则不如 CRDT。）

## 1.6 横向对比总表

| 谁 | 什么功能 | 团队共享怎么做 | commit/版本 | 工作流 | RAG 检索 | 同步机制 | 局限 |
|---|---|---|---|---|---|---|---|
| Anthropic Claude | Projects / Memory / CLAUDE.md | 文件 + Git + symlink 共享 | 靠 Git | Skills / Hooks | **全量注入，无检索层** | Git / 文件系统 | 无过时机制、无权限模型、无向量层、整文件冲突 |
| OpenAI ChatGPT | Projects / Custom GPT / Codex notes | 工作区共享项目；个人 Memory 不共享 | 无 | Custom GPT | 上传 + 向量 | **厂商服务端（不可读/不可改）** | 记忆不可 diff/迁移；冲突=后写覆盖 |
| Cursor | Rules（Project/User/**Team**）+ Memories | **Team Rules 从 dashboard 统一管理** | Project Rules 走 Git；Team Rules 无 | 四种触发模式，可打包 prompts | 提示词注入（非检索） | Git + Cursor 云 | Team Rules 单向下发；规则无生命周期；Memories 不共享 |
| GitHub Copilot | agentic memory / 仓库记忆 | **仓库作用域 = 权限作用域** | 随仓库提交 | Copilot agent / AGENTS.md | 仓库索引 | Git + 厂商索引 | 记忆与代码同生共死；组织知识无归属地 |
| Microsoft 365 Copilot | 个性化记忆 | 租户内 | 无 | — | M365 图谱 | **租户锁定** | 不可导出 |
| Notion AI | 企业搜索 + 知识问答 | 工作区页面树 + 连接器 | 页面历史 | — | 服务端索引 | 服务端 | **只读检索系统**，不是可写记忆 |
| Glean | 企业知识图谱 | 连接器抓全公司 SaaS | — | — | **ACL 图谱双向校验** | 服务端集中式 | 同上；权限模型是它最强项 |
| Atlassian Rovo | 团队 agent | 站点权限 + agent 独立账号 | — | Rovo agents | 服务端 | 服务端 | 同上 |
| Dust | Multiplayer AI | 工作区共享 agent 与数据源 | — | agent 迭代 | 服务端 | 服务端 | 同上 |
| Slack AI | 企业搜索 | 复用频道成员关系 | — | — | **回答前逐条权限过滤** | 服务端 | 同上 |
| Mem0 | 记忆 API | `user_id`/`agent_id`/`run_id` 分区 | 无 | Group Chat | 向量库自持 | 自持/云 | **无权限模型、无冲突语义** |
| Zep / Graphiti | 时序知识图谱 | 多租户 | 无 | — | 图+向量 | 服务端 | 失效由管线自动判定，非显式撤回 |
| Letta | Shared memory (Git repo) | **组织 Git 仓库 attach 给多 agent** | **Git** | `skills/<name>/SKILL.md` | 无内建向量 | Git push/pull（fast-forward） | 冲突留给 Git 人工解；无标记语义 |
| Cognee / LangMem / Memobase / Supermemory | 记忆框架/API | 命名空间分区 | 无 | — | 图/向量 | 自持或服务端 | 均无团队写协作语义 |
| Automerge / Yjs | CRDT | 自动合并 | 无 | — | — | CRDT | 权限弱（Automerge 有 ARK）；**合并语义不适合结论型记忆** |
| ElectricSQL / Zero / Replicache / Liveblocks | 同步基础设施 | 服务端授权 | 无 | — | — | 双向同步 | 面向「共享产物」而非「共享事实」 |

## 1.7 大厂做法的结构性空白（本卷的判断基线）

三处空白，全部指向同一个方向 —— **它们管理「内容」，不管「内容的可信度」**：

1. **空白一：没有「记忆过时」的一等语义。**
   Cursor Team Rules、CLAUDE.md、Copilot 仓库记忆 —— 全部是「写进去就在」。
   唯一例外是 Zep 的时序边失效，但那是**管线自动判定**，不是「人/模型显式声明这条撤回，并写明为什么」。
   ⇒ **本仓的 `current / superseded / retracted` 三态 + `reason=` 是空白点。**（证据见 §2.3-A）

2. **空白二：没有「记忆晋升需要证据」的机制。**
   所有竞品的记忆写入都是「写了就生效」。没有任何一家要求「跨会话出现 ≥3 次 + 成功 ≥2 次才允许晋升为可执行技能」。
   ⇒ **本仓 procedure 技能库的证据驱动晋升是空白点。**（证据见 §2.3-B）

3. **空白三：没有「让 agent 不要被脏记忆劫持」的防御。**
   竞品把「记忆写入」当作纯增益操作。本仓实测过一次**机器自动回写把 agent 劫持**的事故（`lib/index.js:10275-10279`），并已**整段退役该通路**。
   ⇒ **这条是从事故里长出来的，别人没交过这个学费。**（证据见 §2.3-H）

---
# 第二部分：本仓 dsh-auto-memory 现有资产的「人无我有」候选

> **取证方式**：全部结论来自**逐文件阅读源码**（`read` / `grep`），行号为 2026-09-23 工作树实测值；未读过的文件不在此表。
> 表头最后一列「竞品是否已有等价物」中，**没有找到的就是没找到**，不代表不存在 —— 已标注为「未找到等价物」而非「不存在」。
> **本表不含推断性结论**；凡推断一律在 §2.4 单独列出并标注「推断」。

## 2.1 资产总表

| 能力名 | 代码位置(文件:行号) | 它到底做什么 | 团队场景下有什么价值 | 大厂/竞品是否已有等价物 |
|---|---|---|---|---|
| **A. 记忆生命周期三态治理** | `lib/state-commit.js:38`（`MEMORY_STATUS_PRE = ['current','superseded','retracted']`）；落盘形态 `lib/note-status.js:32`（`<!-- dsh-status:`）+ `:43`（正则）+ `:121-129`（`statusOfBodyPre`，**最后一个状态行胜出**）；写入接线 `lib/index.js:11195`（`applyNoteStatusPre`，`supersedes/retract/restore/retractReason` 四参数）；提示面 `lib/index.js:725` | 记忆条目可被标为「被取代」或「撤回」，状态**写在条目自身正文尾部**（HTML 注释形态，渲染不可见、不污染 L0 —— 见 `note-status.js:132-153` 的 `stripStatusLinePre` 纪律）。`supersededBy=` 指向新条目 id（`index.js:6579-6587`），`reason=` 记录撤回原因（上限 120 字符，`note-status.js:55`） | **团队知识会腐坏，而腐坏的知识比没有知识更贵。** 多人在同一记忆库里积累时，「这条谁改的、为什么」是最常被问的问题；本仓已把它做成**可检索字段**，而不是靠人记 | **未找到等价物。** Zep 有时序边失效（[Zep FAQ](https://help.getzep.com/v3/faq)），但由抽取管线**自动判定**、无显式原因字段、无「谁撤回的」；其余竞品（Cursor Team Rules / CLAUDE.md / Copilot / Mem0 / Letta Git）**均无任何作废语义** |
| **B. 技能库证据驱动晋升** | `lib/procedure-store.js:70`（阶段枚举 `observed→validated→active→deprecated`）；门槛常量 `:100-106`（`minSessionDiversity:3`、`minSuccessCount:2`、`maxCorrectionRate:0.3`、`maxContradictions:0`、`highRiskRequiresApproval:true`）；晋升实现 `:378-433`；证据结构 `:210`（`seen/read/cite/reuse/success/correction/sessions` 七维）；自动老化 `:76`（90 天未用→deprecated，**可恢复、永不物理删除**）；模型授权跳门 `:391-403`；只读投影 `:449-487`（`evaluatePromotion`，与 `promote()` 逐行同源） | 一条流程要成为「可被自动召回的技能」，必须**跨 ≥3 个独立会话出现**且**成功 ≥2 次**；有纠正记录则保持原状（`maxContradictions:0` ⇒ 任何纠正即拦，`:409`）。**元代码铁律**：「一次成功或三次重复都不足以证明可靠」（`:21`、`:109`）。高风险技能（SSH/部署/删除）需显式批准（`:413-423`） | **团队里最贵的是「怎么做事」，而它最容易退化成传言。** 本仓要求「多人多次验证过」才让它影响全队行为；且**证据量是公开字段**（前端可见 seen/read/cite/reuse/success/correction），团队能看见「这条技能被验证过几次」 | **未找到等价物。** Letta 的 `skills/<name>/SKILL.md` 随 Git 仓库分发（[Letta shared memory](https://docs.letta.com/concepts/shared-memory/index.md)），但**无阶段、无证据计数、无晋升门槛**；Anthropic Skills、Cursor Rules 同样是「写了就生效」 |
| **C. 白板 + 账本交接（跨会话/跨人接续）** | 四段式账本解析 `lib/handoff-anchor.js:18`（`HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1` 权重表）+ `:41`（`parseHandoffLedgerPre`）+ `:91`（`weightedTrimHandoffLedgerPre` 按权重裁剪）；白板卡片/锚点契约 `lib/wb-contract.js:35`（锚点正则）+ `:51`（`WB_STATUSES_PRE_V1`，与记忆三态同域）+ `:97`（`computeWhiteboardCardIdPre`）；看板五泳道 `lib/wb-sidecar.js:593-599`；归档版本链 `wb-sidecar.js:399`（`buildVersionsPre`） | 把「任务状态/目标/已试方案与失败原因/进度与下一步」做成**结构化的、可解析的、有权重的**交接产物；`PLAN.md` 是当前全貌（树），账本是提交历史（log）；旧版 PLAN 自动归档进 `handoff/archive/PLAN-<ts>.md` 形成版本链（`wb-sidecar.js:395-402`） | **「失败与弯路」泳道（`wb-sidecar.js:596`，注释原话「是本项目最贵的信息」）**：团队里最容易丢的就是「这条路我们试过、不行、原因是 X」。新人接手时能继承的不是只有结论，还有**排除了哪些可能** | **未找到等价物。** 四段式交接（尤其"已试方案与失败原因"）**无任何竞品等价物**；企业检索类（Glean/Rovo/Notion）只能检索"已经写下来的文档"，不能结构化地沉淀"试过什么、为什么失败" |
| **D. 上下文水位感知** | `lib/water-window.js:3`（水位=当前占用/模型窗口，取官方 tokenMeter）；`:57-64`（`pickWindowPre` 按 provider/model 选窗口）；`:117-130`（硬信号扫描：`reservedTokens` / `overflow` / `compactionSeq`）；`:231-256`（是否具备按水位比例触发自动接续的资格，含 `modelKnown` 防静默绕过）；注入文案 `lib/index.js:703-704`（`snapshotWaterTitle` / `snapshotWaterBody`） | 实时算「上下文用了多少」，到阈值就提示并**要求按序做三件事**：写交接账本 → 刷新白板 → 建议用户开新窗口。窗口识别失败时**仍渲染水位卡并说明原因与恢复指引**（不静默） | **团队里每个人的窗口状态不同，但「什么时候该交接」应该是可预期的流程而不是各凭经验。** 这让「交接」从个人习惯变成系统行为 | **部分有。** Codex 有 `session/token_budget.rs` 与 `new_context` 工具（本仓 `docs/M-CM-PLAN.md:12-19` 源码级调查）；Anthropic 有 API 级 Compaction（[platform.claude.com/docs/en/build-with-claude/compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)）。**但「水位触发 → 自动提醒写结构化交接账本」这个联动未找到等价物**；且 Anthropic SDK 的压缩边界对调用方不可见（[claude-agent-sdk-python#772](https://github.com/anthropics/claude-agent-sdk-python/issues/772)） |
| **E. Tier-0 注入预算裁剪** | 契约常量 `lib/tier-layer-inject.js:39-47`（`B0:800 / L1:140 / K:8 / B2:2400 / projectRatio:0.6 / floorRatio:0.1 / maxTier2Blocks:2`）；**两种 token 口径** `lib/tier0-catalog.js:128-142`（repo 口径 `ceil(chars/4)+4` vs 保守口径 `ceil(chars/2)`，因**CJK 下 repo 口径低估 2–4 倍**，`:24-26`）；分层配额分配 `tier0-catalog.js:427`（`allocateTier0QuotaPre`，两轮：优先级填充 + 保底补齐）；保底默认 `:391-396`（`floorLayers:['whiteboard','user']`）；**降级可见** `tier-layer-inject.js:50-55`（`[降级]/[闸门]/[层账]/[配额]` 标记）；裁剪实现 `:580-596` | 每轮无条件注入的记忆有**硬 token 上限**；按 `project > whiteboard > user > reflection > log` 分层配额，防止项目笔记吃满预算导致其他层「一条都进不来」（`:14-16` 记录了真实语料 77 块吃满 800 token 的实测）；**被裁掉的条数按层计数返回**，不静默丢弃 | **团队记忆库一定比个人记忆库大一个量级，预算裁剪从「优化」变成「刚需」。** 而且「谁被裁了」必须可见 —— 否则团队会怀疑系统在隐瞒信息 | **未找到等价物。** Cursor 的 `alwaysApply` 规则（[cursor.com/docs/rules](https://cursor.com/docs/rules)）是**每轮全量注入且文档未提及任何预算上限**；Claude Code 的 `CLAUDE.md` 同样是全量进 system prompt；Mem0/LangMem 的分区是隔离而非预算 |
| **F. 写入侧锚点契约 + 无条件保护** | 锚点注入 `lib/wb-sidecar.js:535`（`applyAnchorsPre`，幂等：标题未变则逐字节不动，`:530`/`:557`）；契约校验 `lib/wb-contract.js:118`（`parseWhiteboardPre`）+ `:54-61`（四种拒绝码：`anchor-missing` / `anchor-format` / `anchor-duplicate` / `anchor-mid-body`）；**三条无条件保护** `lib/memory-mutation.js:27`（注释：「这三条是**无条件**的，测试 `T0-8C` 专门锁这一点」）+ `:99`（M1 丢卡保护）+ `:130`（M2 用户区保护，**省略即 fail closed**）+ `:116-126`（M3 重复 id 禁止）；用户区提取 `wb-contract.js:462`（`extractProtectedRegionsPre`） | 模型整篇重写白板时，**丢卡 / 覆盖用户手写区 / 重复 id** 三件事被写入门无条件拦下（任何开关都绕不过，`wb-contract.js:501-503`）；模型**必须原样带回**用户段（`memory-mutation.js:20`） | **团队共享意味着「别人写的东西」和「我写的东西」一样多。** 没有写入保护，第一个整篇重写的 agent 就会把同事的白板推平。这是团队版能否被信任的地基 | **未找到等价物。** 竞品普遍是「模型自由写文件」，把并发安全交给 Git 或 CRDT；**「写入侧契约 + 无条件保护门」未找到等价物**。Automerge 的 ARK（[Automerge Keyhive](https://automerge.org/docs/keyhive/ark-api-guide/)）解决的是**能力授权**，不是**内容完整性** |
| **G. 证据链 judgement→evidence→fact** | 三店编排 `lib/memory-hub.js:91`（`createMemoryHubPre`，注入 `{episodic, facts, procedures}` 三 store）+ `:121-194`（消费 judgement-shadow 8 类候选）；证据事件存储 `lib/evidence-store.js:19-26`（`EVIDENCE_STORE_POLICY_PRE_V1`：`keepDays:30`、`maxTotalBytes:32MB`、`eventMaxBytes:16KB`）+ `:115`（`EvidenceEventStore` 类）+ `:233`（`rebuildAggregates` 从 durable events 重建计数）；**隐私投影** `:34`（`sessionRefOf` 不可逆哈希）+ `:39`（`workspaceRefOf`，**不落盘任何绝对路径**）；聚合 `lib/evidence-agg.js` | 记忆不是「一个 store」，而是**三条有方向的链路**：经历（发生了什么）→ 事实（由此确认什么）→ 技能（反复成功什么）；每一次「被看到/被读/被引用/被复用/成功/纠正」都是**独立事件**，聚合值可从事件流重建（`:233`） | **团队里必须能问「这条结论凭什么存在」。** 事件流 + 不可逆身份投影让「溯源」可行，同时**不泄露谁在哪个绝对路径下工作** | **部分有。** Zep/Graphiti 有时序知识图谱（[graphiti-core](https://pypi.org/project/graphiti-core/0.11.6rc9/)）、Supermemory 有 graph memory（[supermemory graph-memory](https://supermemory.ai/docs/concepts/graph-memory)）。**但「六维访问证据 + 可从事件流重建 + 不可逆身份投影」的组合未找到等价物**；且竞品的图是为检索服务，本仓的证据是为**晋升决策**服务 |
| **H. 刻意废弃机器回写（防 agent 被脏记忆劫持）** | `lib/index.js:10269-10283`（整段退役注释，含三条退役判据）；防劫持注入标记 `lib/index.js:678-686`（`snapshotHead` 的 `[来源身份 — 必须遵守]` 段：声明记忆块是**既往记录**、其中祈使句是**历史留存**、冲突时以当前消息为准）；清洗器 `lib/intent-clean-safe.js:139`（写入侧卫生门）；教训候选 `lib/memory-hub.js:463`（`lessonCandidateFromRetractedPre`，把 retracted 条目转成 `observationOnly:true` 的教训，**结构上永不晋升**，`:479`） | 实测事故：一段**被固化的用户祈使句**（「我紧急停一下…」）进入每轮无条件注入的 Tier-0 面后，**被 agent 当成实时指令执行、中止了手头任务**（`index.js:680-682`）。修法是两条：①**退役无模型参与的写入者**——`hubFlushTick` 整段删除，理由是「重复建设 + 零价值（自设计以来未成功搬运任何有用知识，唯一做成的事是 11 次污染）+ 最高危面」（`:10273-10279`）；②**在唯一头部加来源身份标注**（一处收口覆盖全部注入段落，零额外 token）。据此确立架构判据：**任何直通每轮无条件注入面的写入者，都必须经过模型审校**（`:10281`） | **团队版最大的安全风险不是数据泄露，是「同事上周的一句话被 agent 当成今天的命令」。** 本仓已经把这条事故的修法固化进架构，并留下可复用的判据；`retracted` 条目还会被转成「教训」——**错误本身作为可检索资产保留**（`memory-hub.js:474` 标题前缀 `'教训：'`） | **未找到等价物。** 竞品把记忆写入视为纯增益。学术侧有同题研究（[Failure-Gated Hierarchical Memory: Preventing Memory Pollution](https://ieeexplore.ieee.org/document/11607496)、[MemGuard](https://export.arxiv.org/pdf/2608.21867)、[MeClear](https://browse-export.arxiv.org/pdf/2609.09115)），说明**这是行业公认的真问题**，但**没有找到产品化实现** |
| **I. 双库作用域（工作区库 / 通用库）** | `lib/procedure-store.js:94`（`PROCEDURE_SCOPES_PRE_V1 = ['workspace','global']`）+ `:97`（缺省 `global`，零迁移）+ `:85-93`（注释明确物理落点由 IO 层分派，store 只携带与校验）；IO 层 `lib/hub-io.js:220-267`（`createScopedHubIoPre`，**合并读 + 按 scope 分派写**）+ `:399-500`（`migrate` 两阶段迁移，含回滚与幂等）；批控制 `hub-io.js:170-177`（`beginBatch`/`endBatch`/`flushBatch`） | 技能分两个物理文件：工作区内可见的、与全公司/全用户通用的；**合并读、分派写**。迁移是**两阶段 + 可回滚 + 幂等**（`:413-423` 迁移前快照、`:500` 回读核对） | **这正是团队同步的冲突面控制**：用户拍板由「单文件 + scope 字段」改为**物理分文件**，理由是「单文件在团队同步时整个文件都落在冲突面上」。分文件后，通用库与各工作区库**天然不冲突** | **部分有。** LangMem/Mem0 的 namespace 分区概念相近（[LangMem](https://github.com/langchain-ai/langmem/blob/main/README.md)、[Mem0 entity partitioning](https://docs.mem0.ai/cookbooks/essentials/entity-partitioning-playbook)）。**但「合并读 + 分派写 + 两阶段可回滚迁移 + 批写」这套完整实现未找到等价物** |
| **J. 技能导出与使用约束条款** | `lib/skill-export.js:28-40`（`SKILL_USAGE_NOTICE_PRE_V1` 四条款 + `SKILL_NOTICE_ANCHORS_PRE_V1` 断言锚点 `:43-49`）；`:77-80`（`skillDirNamePre`，纯中文标题回落 `t-<sha1前8>`，因宿主 `SKILL_NAME` 硬校验只接受 ASCII） | 晋升为 `active` 的技能**自动导出**成 `SKILL.md` 目录束（用户级、可跨项目）；导出物**必须原样包含四条使用约束**：附带程序仅供参考、场景根本不同时只做迁移不要直接运行、跨项目须先核对、高风险步骤需人工确认 | **团队里技能会被跨项目复用，而「当时能用」不等于「现在能用」。** 把使用边界写进产物本身（且用锚点断言防止被后续改动删掉），是防止「把别人的脚本直接跑在生产上」的低成本手段 | **未找到等价物。** Anthropic Skills 与 Letta 的 `skills/<name>/SKILL.md` 都是**纯内容分发**，没有「使用约束条款」这种自带的免责/边界声明机制 |

## 2.2 三个「最像差异点」的候选，先做减法

产品负责人要的是**能卖的差异**，不是**资产清单**。按三个筛子过一遍：① 竞品真的没有；② 团队场景真的有价值；③ 不是我们自嗨的工程洁癖。

| 候选 | 竞品真的没有？ | 团队真有用？ | 判定 |
|---|---|---|---|
| **H. 防劫持 + 机器回写退役** | ✅ 学术在讨论、产品没实现 | ✅✅ 这是**信任问题**，团队版没有信任就没有采纳 | **保留 —— 最强候选** |
| **C. 白板+账本交接（尤其"失败与弯路"）** | ✅ 无等价物 | ✅✅ 团队交接的真实痛点 | **保留 —— 最强候选** |
| **A. 三态生命周期治理** | ✅ 无等价物 | ✅✅ 「这条为什么被推翻」是团队高频问题 | **保留** |
| **B. 证据驱动晋升** | ✅ 无等价物 | ✅ 团队需要「多人验证过」的可信度信号 | **保留** |
| **F. 写入侧无条件保护** | ✅ 无等价物 | ✅ 是协作的地基（但用户不会为此付费，它是**必备品而非卖点**） | **降级：作为"为什么我们敢让人多写"的支撑论据** |
| **E. Tier-0 预算裁剪** | ✅ 无等价物 | ⚠️ 是刚需但**用户感知不到**（感知到的是"快/省/不卡"） | **降级：作为技术底座，不作卖点** |
| **D. 上下文水位感知** | ⚠️ Codex/Anthropic 有部分 | ✅ 但差异化在"联动交接"而非"知道水位" | **降级：并入 C 作为触发器** |
| **G. 证据链三店** | ⚠️ 图记忆竞品有部分 | ✅ 但它是 B 的**实现基础** | **降级：作为 B 的支撑** |
| **I. 双库作用域** | ⚠️ namespace 概念相近 | ✅ 解决同步冲突 | **降级：作为工程前提** |
| **J. 技能导出约束条款** | ✅ 无等价物 | ⚠️ 价值真实但偏细节 | **降级：并入 B 作为交付形态** |

**减法结论**：真正的卖点集中在 **H（信任）+ C（交接）+ A（治理）+ B（可信度）** 四条；其余六条是**支撑它们的技术底座**，应该写在架构文档而不是宣传页上。

## 2.3 关键候选的代码证据（逐条可复核）

### A. 三态治理 —— 「返回但标记」的语义

用户明确裁定：**`superseded` 的可见后果 = 「返回但标记」（不剔除、不降权）**，检索命中作废条目时照常返回，但必须显式标注它已过时、并指出最新结论在哪。

代码证据：
- 状态枚举：`lib/state-commit.js:38`
- 磁盘形态（HTML 注释，渲染不可见）：`lib/note-status.js:32`、`:43`
- 「最后一个状态行胜出」：`lib/note-status.js:121-129`
- **不污染 L0**：`lib/note-status.js:132-153`（`stripStatusLinePre`，且 `:144-148` 记录了 CRLF 保持的 bugfix）
- 写入接线 + 原因字段：`lib/index.js:11195`、`:11124-11125`
- 指向新结论：`lib/index.js:6579-6587`

**为什么这条对团队重要**：企业知识库最怕的不是「有错知识」，而是**「错了但没人知道它错了」**。本仓的设计让作废条目**继续可被检索到**（因为「曾经这么认为」本身是信息），但带上醒目的过时标记与后继指针 —— 这是**审计友好**的，而竞品的删除/覆盖是**审计不友好**的。

### B. 证据驱动晋升 —— 「一次成功不足以证明可靠」

代码证据：
- 元代码铁律注释：`lib/procedure-store.js:21`、`:109`
- 门槛常量：`:100-106`
- 晋升实现与短路顺序：`:378-411`（注意 `:386-387` 的 `observation-only` 短路**不受授权影响**）
- 诚实性设计：`:23-28`（`ok` vs `promoted` 分离 —— 曾因只记 `ok` 导致「拒绝晋升」与「晋升成功」都写成 `ok:true` 的假阳性）
- 落盘失败可见：`:30-34`（`persisted:boolean` + `persistReason`）
- 人工批准只解一道门：`:36-45`（`approve()` 只置 `approved`，不跳过其余五道结构门）

**为什么这条对团队重要**：团队版会收到**数量级更多**的候选技能。没有证据门槛，技能库会迅速退化成「谁最近说过什么」。门槛 + 公开证据量，让「这条技能值不值得信」变成**可查的数据**而不是**资历判断**。

### C. 交接 —— 「失败与弯路是本项目最贵的信息」

代码证据：
- 五泳道定义（含注释原话）：`lib/wb-sidecar.js:593-599`，其中 `:596` 是 `deadend` 泳道，匹配 `matchTitle: /失败|弯路|坑|教训|血泪|报错|阻塞/`
- 四段权重表：`lib/handoff-anchor.js:18`
- 按权重裁剪：`lib/handoff-anchor.js:91`
- 归档版本链：`lib/wb-sidecar.js:395-402`
- 判据门（防「白板被整篇覆盖成骨架」）：`lib/wb-contract.js:647`（`checkPlanCriteriaPre`），其中 `:655` 要求 `body.length >= sectionMinChars`，`:661` 的拒绝文案直指事故形态

**为什么这条对团队重要**：跨人接续时，「结论」是可以从代码/文档里重新推导的，**「我们试过 X 不行因为 Y」是不可重新推导的**。这是团队记忆里**唯一真正会随时间永久丢失**的资产。

### H. 防劫持 —— 从真实事故长出来的架构判据

代码证据：
- 事故记录与退役判据：`lib/index.js:678-686`、`:10269-10283`
- 教训候选（结构上永不晋升）：`lib/memory-hub.js:463-483`，关键在 `:479` 的 `observationOnly: true`
- 清洗器：`lib/intent-clean-safe.js:139`

**事故链完整复述（可直接引用）**：
1. 一段用户祈使句（「我紧急停一下…」）被固化进记忆；
2. 它经**无模型参与**的机器回写通路进入 `MEMORY.md`；
3. `MEMORY.md` 是**每轮无条件注入**面；
4. agent 读到它，**当成实时指令执行，中止了手头任务**；
5. 根因不是「内容脏」，而是**注入文本没有任何"这是历史记录"的身份标注**（`index.js:681-682`）。

**这条为什么是团队版的核心卖点**：单人场景下，脏记忆的受害者是写它的那个人；**团队场景下，受害者是别人**。当 A 同事的一句临时抱怨被固化、B 同事的 agent 据此中止了生产部署，这是**组织级事故**。本仓是少数**交过这个学费并已修好**的系统。

## 2.4 明确标注为「推断」的内容

以下为**推断**，不是代码事实或外部来源事实，供产品判断时降权使用：

1. **推断**：`superseded`/`retracted` 的三态机制在团队场景下会显著降低「幽灵记忆」（已作废但仍被引用）的发生率。本仓的测试与回归是在**单人工作区**语料上跑的，多人并发下的实际效果未见实测数据。
2. **推断**：物理分文件（工作区库/通用库）在团队 Git 同步下的冲突率显著低于单文件 + scope 字段方案。这与用户当时的判断一致（记忆记载：「单文件在团队同步时整个文件都落在冲突面上」），但**尚未有实测冲突率数据**。
3. **推断**：把「失败与弯路」作为一等泳道，对新人上手速度有正向影响。这是产品直觉，**没有可用性实验支撑**。
4. **推断**：竞品「未找到等价物」的部分能力，可能存在于其**未公开的内部实现**或**企业版定制**中。本文的「未找到」严格限于**公开文档与公开源码可查范围**。
5. **推断**：证据驱动晋升的 `minSessionDiversity: 3` 门槛在**团队**场景下可能需要上调（因为多人会产生更多但更浅的会话）。这需要重新标定。
6. **推断**：本仓 `miv`（内容身份哈希，`state-commit.js:104`）「不递增、不比较」的哲学与 CRDT 自动合并路线不兼容；团队同步若引入 CRDT，需明确二者边界。当前代码中**未见** CRDT 相关实现。

---
# 第三部分：结论 —— 「人无我有」清单

## 3.0 判定原则（先说清楚什么不算亮点）

产品负责人给的前提是「commit、工作流、RAG 大厂做得非常好」。本文据此立三条筛子，**过不了的直接判为对标能力、不列入亮点**：

1. **它是大厂的「能力缺口」而不是「优先级缺口」** —— 如果只是一句「他们还没做」，一版就能补上，不算差异。
2. **它与大厂的产品地基冲突** —— 即「他们做这件事会伤害自己的主业务」，这种差异才守得住。
3. **它来自真实事故/真实规模** —— 我们交过的学费，别人没交过，所以不会主动去建。

按这三条筛子，下面给出 **5 条真正的差异化亮点**（原 10 个候选资产经 §2.2 减法后收敛）。

---

## 亮点 1 · 记忆生命周期治理：作废的记忆「返回但标记」，而不是删除

**一句话**：每条记忆都带 `current / superseded / retracted` 三态 + 后继指针 `supersededBy` + 撤回原因 `reason`，检索命中作废条目时**照常返回原内容**，但**显式标注它已过时并指出最新结论在哪**。

**为什么大厂做不了（三条真实原因，不是「没想到」）**：

1. **权限边界：AI 无权判定人类文档作废。** Glean / Notion AI / Rovo / Slack AI 的产品地基是「记忆真源 = 人类协作工具（文档、消息）」。让 AI 把一条同事写的 Confluence 页面标成「已作废」，在它们的产品模型里就是**AI 越权修改人类资产**。它们只能做检索，不能做判定。（来源结构见 §1.3：这五家全是只读检索系统）
2. **合规取向相反：用户要「删掉」，不要「标记作废」。** 对 AI 自己生成的记忆（ChatGPT Memory / Cursor Memories），大厂的正确处理是**提供删除按钮**并在企业版支持合规删除（被遗忘权）。**「返回但标记」与「删除」是两种不可调和的合规取向** —— 前者为了审计保留，后者为了合规抹除。同一个产品里没法既满足 GDPR 又保留审计痕迹。
3. **技术障碍：派生数据没有稳定身份。** 大厂的记忆多半是**从对话抽取的派生数据**（摘要/embedding），重新抽取一次 ID 就变了，因此**无法建立 `supersededBy` 这种稳定指针**。本仓的记忆条目是**带锚点 ID 的一等公民 Markdown**（`lib/wb-sidecar.js:78` `wbEntryIdPre`，`mem_ + sha256(workspaceKey+'\0'+relPath+'\0'+title)` 前 32 hex），**写在磁盘上、可寻址、可回写** —— 这是能实现三态的前提，竞品从数据模型上就不具备。

**团队场景下怎么变成可卖的差异（用户故事）**：

> **场景**：团队三个月前定了「鉴权走网关统一签发」。今天架构组发现网关方案有性能瓶颈，改成服务网格。
> **没有本能力**：旧结论还躺在共享记忆里。新人 A 的 agent 检索到它，按旧方案写代码；评审时才发现，白干两天。或者更糟：团队把旧文档删了，半年后有人问「当初为什么不用网关」，**没人说得清**。
> **有本能力**：架构组撤回时写一句 `reason="网关 P99 增加 40ms，超 SLO"`。新人 A 的 agent 检索到这条旧结论，**照样看到它、同时也看到「已作废 + 原因 + 指向服务网格方案」** —— A 不但不会走错路，还顺便理解了**为什么**。
> **卖点话术**：「别人帮你记住结论，我们帮你记住**结论为什么被推翻**。」

**落地代价（要先做什么）**：
- ✅ **几乎零成本**：三态机制、写入接线、原因字段、后继指针**已全部实现并测试过**（`lib/state-commit.js:38`、`lib/note-status.js:32/43/121`、`lib/index.js:11195`）。
- 🔨 **要做的是团队侧三件事**：
  1. **状态行随条目同步**：确保 `<!-- dsh-status: ... -->` 在团队同步时与正文同进退（当前是正文内保留行，天然随文件走 —— 需验证）。
  2. **检索面渲染**：团队版检索结果必须把 `⚠已作废 + reason + supersededBy` 渲染成显著视觉（当前是文本标记，团队版应升级为可点击的后继指针）。
  3. **权限问题**：谁能撤回**别人**写的记忆？这是团队版必须新增的判定（本仓当前是单人，无此问题）。**建议最小形态：任何人都能撤回，但撤回必须带 `reason`，且撤回记录不可删除。** 用"留痕"代替"授权"，避免引入完整 RBAC。

---

## 亮点 2 · 防记忆劫持：让「无模型参与的记忆写入」结构性不可能

**一句话**：确立并执行了一条架构铁律 —— **任何直通「每轮无条件注入面」的写入者，都必须经过模型审校**；据此退役了一条已实现、已上线、但实测会劫持 agent 的机器自动回写通路。

**为什么大厂做不了（两条真实原因）**：

1. **他们有模型侧的解法，我们没有 —— 所以必须在数据层解。** 大厂的记忆注入面是**结构化 API 注入**，且模型经过厂商自己的对齐训练来抑制「把记忆当指令」。本仓是宿主插件，**在别人的模型上跑**，改不了对齐。⇒ **我们唯一的解法是在数据层加身份标注 + 堵死无审校写入者。** 大厂反而**没有动力**在建这一层（他们的对齐已经够用）。
2. **体量决定风险偏好：他们只能接受概率性污染。** 大厂的记忆规模大到**无法逐条审校**，只能靠自动管线（抽取 → 写入），因此必须接受"偶尔写脏"。本仓的体量小到**可以要求每一次记忆写入都有模型参与**。⇒ 不是"他们没想到"，而是**"他们的规模不允许他们做这个减法"** —— 而减法意味着活跃度/记忆增长数下降，**没有一个增长团队会主动提这个需求**。

**团队场景下怎么变成可卖的差异（用户故事）**：

> **场景**：这是一个真实发生过的事故形态（`lib/index.js:680-682` 记录）：一段被固化的用户祈使句（「我紧急停一下…」）进入每轮无条件注入的记忆面后，**被 agent 当成实时指令执行，中止了手头任务**。
> **单人场景**：受害者是写这句话的人。用户骂一句"AI 傻了"，删掉记忆，继续干活。
> **团队场景**：受害者是**别人**。同事 A 上周调试时的一句「先别部署，我紧急改个东西」被固化进共享记忆；今天同事 B 的 agent 读到它，**中止了 B 的生产部署**。B 完全不知道发生了什么，A 也不知道自己害了 B。**这是组织级事故，且无法归因。**
> **卖点话术**：「共享记忆的第一个要求不是**记得多**，是**不被同事的旧话误伤**。我们为此退役过一个已上线的功能 —— 这是我们的产品底线。」

**落地代价（要先做什么）**：
- ✅ **机制已就位**：`hubFlushTick` 已整段退役（`lib/index.js:10269-10283`）；防劫持来源身份标注已进唯一头部（`lib/index.js:686` 的 `[来源身份 — 必须遵守]` 段，一处收口覆盖全部注入段落、零额外 token）。
- 🔨 **团队侧要做三件事**：
  1. **把铁律写成团队版的守卫测试**：新增一条回归，断言「团队版不存在无模型审校的 Tier-0 写入者」。当前是架构注释（`index.js:10281`）**约束靠自觉**，团队版必须变成**机器强制**。
  2. **来源身份标注升级为「跨人」语义**：当前标注说「这是既往记录」；团队版要说「**这是同事 A 在 X 时间记录的，可能是当时的情境**」—— 引入**记录者身份**才能让模型正确降权。
  3. **注入面的团队审计**：任何要往共享注入面写东西的团队功能（同步、聚合、汇总），**上线前必须过这一条**。建议做成 PR 检查项。

---

## 亮点 3 · 「失败与弯路」是一等公民：跨人接续时继承的是排除项，不只是结论

**一句话**：把「已试方案与失败原因」做成结构化的、有解析器有权重有看板泳道的**一等产物**，让接续者继承的不只是「该怎么做」，还有「**哪些路走过是死的、为什么死**」。

**为什么大厂做不了（三条真实原因）**：

1. **输入不存在：失败从来没被写下来。** 企业检索类的输入是**已产出的文档**。「试过 X 不行因为 Y」通常**从未落纸** —— 它活在人的脑子里、Slack 的碎片对话里。Slack AI 确实能检索聊天记录，但那里的"不行"是**非结构化、缺上下文**的，检索到也**不能作为决策依据**。（结构见 §1.3）
2. **知识管理传统把失败当负资产。** 文档类产品（Notion / Confluence）的心智模型是「记录结论」。**你没法在 Confluence 里优雅地记录"这个方案我们放弃了"** —— 它没有这个容器、没有这个字段、也没有这个视图。要做成一等公民，需要产品形态上先承认"没做成的尝试有价值"，这与知识库类产品的定位直接冲突。
3. **缺少场景对象：没有「项目交接」这个实体。** 大厂的记忆按**用户**或按**文档**组织。企业版有 Projects，但那是**文件容器**，不是**交接契约** —— 它没有"任务状态/目标/已试方案/下一步"这个四段 schema，也没有"上一版自动归档形成版本链"的语义。

**团队场景下怎么变成可卖的差异（用户故事）**：

> **场景**：一个项目做了两个月，负责人离职/转岗，交给新人。
> **没有本能力**：新人从代码和文档里能推导出「现在是什么样」，但推导不出「**为什么不是别的样子**」。于是新人花了三周重新试了一遍已经失败过的方案（比如"先试试直接读主库"），撞同一堵墙，然后才从某个老同事的嘴里听说「我们去年就试过了，主库连接数不够」。
> **有本能力**：接续时注入的不只是「当前进度」，还有 `deadend` 泳道里的四条记录，每条格式是「**方案 → 失败原因（含关键报错词）**」。新人三分钟读完，直接跳过三周的弯路。
> **卖点话术**：「别的工具交接的是**文档**，我们交接的是**判断力**。」

**落地代价（要先做什么）**：
- ✅ **机制已就位**：四段式账本 + 权重表 + 解析器（`lib/handoff-anchor.js:18/41/91`）；五泳道含 `deadend`（`lib/wb-sidecar.js:593-599`，`:596` 的匹配正则 `/失败|弯路|坑|教训|血泪|报错|阻塞/`）；归档版本链（`wb-sidecar.js:399`）；水位触发写账本（`lib/index.js:703-704`）。**这是本仓最成熟的一条线。**
- 🔨 **团队侧要做四件事**：
  1. **账本的"人"维度**：当前账本记录的是会话，团队版要能回答「**这条弯路是谁踩的**」（同理心 + 可追问）。
  2. **失败原因的检索化**：`deadend` 泳道内容当前主要靠**注入**触达，团队版应让它可以被**主动检索**（「我们试过什么读主库的方案？」）。
  3. **跨项目失败库**：某些失败是**跨项目通用**的（「这个库的 3.x 版本有内存泄漏」）。应允许把 `deadend` 条目**提升为通用库**（复用已有的双库机制 `lib/procedure-store.js:94`、`lib/hub-io.js:220`）。
  4. **降低书写摩擦**：写四段账本对人有成本。团队版必须有**一键/半自动**的账本生成（复用 `memory_note(kind=handoff)` 通路），否则没人写。

---

## 亮点 4 · 可信度可量化：技能晋升要跨会话证据，且证据量公开可见

**一句话**：一条流程要成为「能自动影响全队行为」的技能，必须**跨 ≥3 个独立会话出现 + 成功 ≥2 次**，有任何纠正记录即拦；并且**证据量（6 维计数）是公开字段**，任何人都能查「这条技能被验证过几次」。

**为什么大厂做不了（三条真实原因）**：

1. **给人类写的规则加验证门槛是侮辱性的。** Cursor Team Rules 和 Anthropic Skills 的作者是**人**（通常是团队里的资深成员）。人和人之间的信任靠署名与组织关系，**系统不需要证明**。要给 Cursor 的 Team Rule 加一个"被验证 3 次才生效"，产品上完全说不通。
2. **让用户逐条确认在团队级是错的。** 当 AI 自动生成候选时，大厂的处理是**弹窗让用户确认**（"记忆已更新"）。消费级这是对的 —— 用户是唯一 owner。但团队级：**确认弹窗会淹没所有人**，且"谁来确认"本身就是未定义问题。本仓的解法是**用证据代替确认**（够门槛就自动晋升，不够就等着）。
3. **跨用户证据聚合在它们的数据模型里不存在。** 本能力要求「**数一数这条建议被 3 个不同员工的会话用过**」。大厂的会话边界是**产品边界**（每个用户自己的会话），没有跨用户聚合的实体。而本仓的 `evidence.sessions` 是**技能条目自己的字段**（`lib/procedure-store.js:210`），按记忆 ID 聚合，天然跨会话。

**团队场景下怎么变成可卖的差异（用户故事）**：

> **场景**：团队记忆库里积累了几百条"怎么做"。新人怎么判断哪条可信？
> **没有本能力**：靠资历、靠口头传言、靠"这个是谁写的"。**结果是新人倾向于相信写得最长的那条，而不是最可靠的那条。**
> **有本能力**：每条技能都带证据徽章 —— 「跨 7 个会话 / 成功 5 次 / 0 次纠正」。新人一眼看出哪些是**被反复验证过的**，哪些只是**某个人写下来还没试过的**。而且有纠正记录的条目**结构上无法晋升**（`procedure-store.js:409`，`maxContradictions: 0`）。
> **卖点话术**：「我们不问你**信谁**，我们给你**证据**。」

**落地代价（要先做什么）**：
- ✅ **机制已就位**：阶段状态机 + 门槛常量 + 六维证据 + 公开投影（`lib/procedure-store.js:70/100-106/210/378-433/449-487`）+ 90 天自动老化且**永不物理删除**（`:76`）+ 模型授权跳统计门但仍受五道结构门（`:391-403`）。
- 🔨 **团队侧要做四件事**：
  1. **证据要能跨人累积**：当前 `evidence.sessions` 数的是**会话**。团队版要区分「3 个会话是同一个人开的」还是「3 个不同的人」—— **后者才是团队意义上的验证**。
  2. **门槛要重新标定**：`minSessionDiversity: 3` 是单人标定的。团队场景下会话更多但更浅，**（推断）**门槛可能需要上调，需要实测数据。
  3. **公开证据面的产品化**：六维计数当前是内部字段（`memory-hub.js:303` 透出到面板）。团队版要把它做成**信任徽章**（可视、可排序、可筛选）。
  4. **纠正回路的入口**：`correction` 证据当前由模型/工具写入。团队版必须让**人**能一键"这条不对" —— 否则最高价值的信号（纠正）采集不到。

---

## 亮点 5 · 团队同步的冲突面控制：物理分文件 + 写入侧无条件保护

**一句话**：把「通用库」和「工作区库」做成**两个物理文件**（而不是一个文件加 scope 字段），让不同团队的记忆**天然不冲突**；同时在写入侧建立**无条件生效**的完整性保护（丢卡/覆盖用户区/重复 ID 三条），任何开关都绕不过。

**为什么大厂做不了（两条真实原因）**：

1. **大厂的 agent 写操作默认受沙箱限制，我们是插件、没有沙箱。** 它们的 agent 只能写指定目录、或只能**提议 PR**，所以"agent 把同事的东西推平"这个风险被**沙箱**挡住了，不需要在写入契约层面解决。本仓作为宿主插件**没有沙箱能力**，只能在写入侧自建契约。⇒ 这不是能力差距，是**部署形态导致的必需性差异**。
2. **用文档协作的冲突解决去兜「agent 整篇重写」是错的工具。** Google Docs 的 OT / Automerge 的 CRDT 解决的是「多人编辑同一文档」，前提是**每次写入是局部编辑**。而 **agent 的写入不是改一个字段，是整篇重写**（模型没有 diff 语义）。CRDT 会把一次整篇重写当作一次巨大的变更自动合并 —— **它不会阻止推平**。⇒ 大厂把冲突交给协作层，是因为他们的人写的是局部编辑；我们的 agent 写的是整篇，所以**必须在写入侧拦**。
   > 补充判据：本仓 `miv` 明确「**不递增、不比较**」（`lib/state-commit.js:10-11`），即**不把记忆当版本序列** —— 这是一条与 CRDT 光谱正交的路线。**（推断）** 这条路线对「结论型记忆」比 CRDT 更合适。

**团队场景下怎么变成可卖的差异（用户故事）**：

> **场景**：两个团队用同一套记忆系统，各自有各自的业务知识，但有共享的通用技能（如"发版流程"）。
> **没有本能力**：一个文件装所有人 —— **任何一个人写自己的知识，整个文件都落在冲突面上**。合并冲突时，双方的知识都可能丢。
> **有本能力**：通用库一份、每个工作区一份，**合并读、分派写**（`lib/hub-io.js:220-267`）。两个团队的知识物理隔离，通用库的变更才需要协调。而且通用库的迁移有**两阶段 + 可回滚 + 幂等**保证（`hub-io.js:399-500`）。
> 更关键的：即使有人（或某个 agent）整篇重写白板，**丢卡 / 覆盖同事手写区 / 重复 ID 三件事会被无条件拦下**（`lib/memory-mutation.js:27/99/130/116-126`），且用户区**省略即 fail closed**（`:130`）—— 即"忘了带"等于"拒绝写入"，不是"随便写"。
> **卖点话术**：「多人共写的系统，**信任来自写入侧的保护**，不是来自事后合并。」

**落地代价（要先做什么）**：
- ✅ **机制已就位**：双库数据层 + IO 层合并/分派/迁移（`procedure-store.js:94/97`、`hub-io.js:220-267/399-500/170-177`）；三条无条件保护门（`memory-mutation.js`）；锚点契约四种拒绝码（`wb-contract.js:54-61`）。
- 🔨 **团队侧要做四件事**：
  1. **通用库的写入权限**：通用库影响所有人。当前无权限概念 —— 团队版需要「谁能改通用库」（最小形态：**提交即留痕 + 可回滚**，而非审批门）。
  2. **真实的冲突率数据**：物理分文件方案是**用户基于推理拍板的**，尚无实测冲突率。团队版上线前应做一次**双人并发压测**，拿到实测数字。
  3. **保护门的团队化扩展**：当前三条保护针对白板卡片。团队版应扩展到**记忆条目**（例如：删除他人条目需留痕）。
  4. **迁移工具的团队化**：`migrate` 是为单人设计的（`wsRef` 校验、`foreign-workspace` 拒绝 `hub-io.js:449-451`）。团队版需要"离职成员的知识如何处理"这一路径。

---

## 3.1 五条亮点的一句话总结（可直接用于宣传）

| # | 亮点 | 一句话 | 核心防御力 |
|---|---|---|---|
| 1 | 记忆生命周期治理 | 作废的记忆**返回但标记**，并带上「为什么被推翻」 | 权限边界 + 合规取向 + 稳定 ID 三重障碍 |
| 2 | 防记忆劫持 | **无模型参与的记忆写入**在架构上不可能 | 我们改不了模型对齐，只能在数据层解 |
| 3 | 失败与弯路交接 | 交接的不是文档，是**判断力**（排除项） | 输入不存在 + 知识管理传统 + 缺场景对象 |
| 4 | 可信度可量化 | 不问**信谁**，给**证据** | 给人写的规则加门槛是侮辱性的 + 跨用户聚合实体不存在 |
| 5 | 冲突面控制 | 信任来自**写入侧的保护**，不是事后合并 | 他们靠沙箱，我们没沙箱；CRDT 挡不住整篇重写 |

---

## 3.2 「必须补齐的对标能力」清单

> 产品负责人要求：commit/工作流/RAG 三类**不能缺**，但**不做成差异化卖点**。
> 下面对每类给出「要补什么 + 最小可用形态 + 现成资产（避免重复造）」。

### 3.2.1 commit / 版本

| 项 | 内容 |
|---|---|
| **要补什么** | ①记忆条目的**版本历史**（当前只有三态，没有"这条改过几次、每次改了什么"）；②**diff 视图**；③**回滚**能力 |
| **现成资产** | `lib/state-commit.js` **已有提交边界**：`buildStateCommitPre`（`:153`）、`commitConflictPre`（`:202`，含**可见冲突三要素**：期望值/实测值/冲突目标）、`commitReceiptPre`（`:230`）；`expectedDigest` / `expectedStateVersion` **字段已存在**（`:144-145`、`:193-194`），注释明确「不传时下游行为必须与本契约引入前逐字节一致」；白板**已有归档版本链**（`wb-sidecar.js:399` `buildVersionsPre`） |
| **最小可用形态** | ①每条记忆条目加 `rev`（内容哈希前 8 位）+ `updatedAt`；②写前自动快照到 `.archive/`（**复用白板已有的归档机制**）；③`memory_note` 增 `expectedRev` 参数，用**已有的** `commitConflictPre` 拒绝语义做乐观锁；④面板加一个"这条的改动历史"列表（**不需要 diff 算法，罗列版本 + 时间 + 谁改的即可**） |
| **明确不做** | 不做分支、不做 merge、不做 3-way diff。**这些是 Git 的地盘，我们做到"能看见变化"就够。** |
| **判据** | 如果实现需要引入一个 diff 库，说明做多了。 |

### 3.2.2 工作流

| 项 | 内容 |
|---|---|
| **要补什么** | 团队协作的**编排能力**（谁在什么时候做什么、状态流转、审批） |
| **现成资产** | procedure 技能库**已有"怎么做"的知识**（证据驱动，见亮点 4）；四段账本**已有交接的结构**（`handoff-anchor.js:18`）；水位**已有触发器**（`water-window.js:231-256`）；写入门**已有质量门**（`wb-contract.js:540` `checkHandoffCriteriaPre`、`:647` `checkPlanCriteriaPre`） |
| **最小可用形态** | **只做「交接工作流」一条链**，串接已有四个钩子：`水位达阈值 → 强制写四段账本 → 刷新白板 → 新会话注入账本 → 接续后校验账本里的"下一步"是否执行`。这就是一个**五步状态机**，不需要通用引擎。 |
| **明确不做** | **不做通用工作流引擎**（DAG、可视化编排、条件分支、人工审批节点）。这是大厂（Jira / Rovo / Dust / Copilot agents）的绝对强项，做了就是"样样不如"。 |
| **判据** | **如果解释这个工作流需要画一张 DAG 图，就是做错了。** 一句话能说清才算合格。 |

### 3.2.3 RAG

| 项 | 内容 |
|---|---|
| **要补什么** | 团队语料的**接入与检索**（别人工作区的记忆、共享文档、代码） |
| **现成资产** | **检索能力本仓已有**：词法 + 语义双臂召回（JS 档默认 / Python 档可选，两者铁律上互不联动）；Tier-0/1/2 三层检索契约（`tier-layer-inject.js:39-47` 预算常量）；evidence cite 规范（`lib/evidence-store.js`）；`memory_recall` 已支持 `scope` 参数（`handoff`/`sessions`/`all`，见 `docs/M-CM-PLAN.md:64`） |
| **最小可用形态** | ①**先把本工作区检索做扎实**（已在做，是主战场）；②团队语料**只接一个来源：共享记忆库目录** —— 不接 GitHub API、不接 Slack、不接 Notion、不接 Jira。③检索结果**必须带来源标识**（哪个成员 / 哪个工作区贡献的），因为团队检索的可信度**依赖来源可见**（与亮点 4 的可信度徽章同源）。 |
| **明确不做** | **不做"搜全公司"**。Glean 的 ACL 图谱 + Slack 的逐条权限过滤是**十年积累的护城河**，接了连接器也只是"又一个集成"，而且**权限做错就是数据泄露事故**。 |
| **判据** | 宣传语应该是「**我们能搜团队共享的记忆库**」而不是「**我们能搜全公司**」。 |

### 3.2.4 对标能力优先级建议

| 顺序 | 能力 | 理由 |
|---|---|---|
| 1 | **RAG（单来源）** | 成本最低（检索能力已有，只加"来源标识"），且**是团队版的最小可用前提**——搜不到别人的东西就不叫共享 |
| 2 | **commit / 版本（无 diff）** | 契约字段**已经在了**（`expectedDigest`/`expectedStateVersion`），接线成本低；且亮点 3/5 都依赖它（"这条弯路谁踩的"需要版本信息） |
| 3 | **工作流（只做交接链）** | 依赖前两者的产物，且需要产品定义清晰，放最后 |

---

## 3.3 明确「不做」清单（同等重要）

| 不做 | 为什么 |
|---|---|
| **不做通用 CRDT 协作层** | 引入 Automerge/Yjs 会把"记忆作废"这个核心语义冲掉（CRDT 承诺不漏任何写入，与"让错误失效"直接冲突，见 §1.5）。且我们是插件，没有协作层的部署位置。 |
| **不做向量库自建** | embedding 存储与检索是**基础设施**，不是差异点。当前 JS 档用本地模型 / Python 档可选，这个"两档可互换"的形态已经够用（且是用户铁律：两者严禁联动）。 |
| **不做企业连接器生态** | GitHub / Slack / Notion / Jira / Confluence 连接器是 Glean / Rovo / Dust 的主战场。**接一个就等于承认"我在做同一件事但更差"**。 |
| **不做完整 RBAC 权限体系** | 团队版初期用**留痕 + 可回滚**代替授权（见亮点 1 的落地代价第 3 条）。RBAC 是能吞掉整个版本周期的工作量，且**权限做错比没有权限更危险**。 |
| **不做跨用户证据聚合的"智能推荐"** | 在证据量足够前，任何"推荐"都是噪音。先把计数做对、做可见（亮点 4），推荐是下一版的事。 |

---

## 附录 A：本文的取证边界与复核方式

| 项 | 说明 |
|---|---|
| **代码行号** | 全部为 2026-09-23 工作树实测值（`read` / `grep` 直接读取，未使用任何二手描述）。本仓 `lib/*.js` 为 CRLF，`read` 返回的行号与文件行号一致。 |
| **外部来源** | 全部为公开文档/博客/PyPI/GitHub 可访问页面，URL 已逐条附在 §1 与 §2 表格中。 |
| **「未找到等价物」的含义** | 严格限于**公开文档与公开源码可查范围**。竞品可能存在未公开的内部实现或企业版定制。**这是"没找到"，不是"不存在"。** |
| **推断的处理** | 凡推断一律集中在 §2.4，并在正文出现处标注「**（推断）**」。无标注处均为代码事实或来源事实。 |
| **未覆盖的调研项** | ①各竞品的**定价与企业版合同细节**（本报告只谈能力）；②**性能/延迟实测**（本报告无基准数据）；③**中文语料下的检索质量对比**（本仓有 67 条人工金标的历史数据，但未与竞品同条件对测）。 |
| **本文档的发布范围** | `docs/` 目录整体不在 npm 发布包的 `files` 白名单内（`package.json:13-22` 只含 `lib` / `python` / `cordis.patch.yml`，另有 `!python/bench` 等排除项）。**本文档不会随发布包发出。** |

## 附录 B：给产品负责人的三个待决问题

1. **团队版的「人」维度做到什么程度？** 亮点 1/3/4 的落地代价里都出现了同一个问题：**当前系统是单人设计，没有"谁写的"这个概念**。是否要在团队版引入成员身份（引入即涉及隐私与合规）？**这是所有亮点的共同前置。**
2. **通用库的写入是否需要审批？** 本报告建议**只留痕不审批**（避免 RBAC 吃掉版本周期）。但这意味着任意成员可以改影响所有人的通用知识 —— 是否可接受？
3. **「失败与弯路」的书写摩擦谁来承担？** 亮点 3 的价值最大，但**依赖人愿意写**。是否接受"系统强制在交接时要求填写"（复用已有的判据门 `checkHandoffCriteriaPre`）？强制会降低采纳率，不强制会没有数据。

---

*报告结束。全文结论均可通过附录 A 所述方式复核。*

