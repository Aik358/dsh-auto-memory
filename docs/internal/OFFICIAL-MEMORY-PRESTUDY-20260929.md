# 官方长期记忆系统预研 + 唤回亲和/对话归档向量化/疑虑唤醒调研

日期：2026-09-29
作者：ZCode（dsh-auto-memory 会话）
性质：预研报告（供拍板，未动任何代码）

---

## 一、证据基座（全部实读源码/registry 获得，非推测）

### 1.1 0.2.0-rc.1/rc.2 宿主全量实测（2026-09-28/29 发布，本机正在升级）

- npm registry `@deepseek-ai/dsh` 0.2.0-rc.2 依赖 **82 个官方包，无任何 memory/recall 包**；287 个官方包名逐一核对，无 `dsh-memory*`。
- 0.1.7 主包 README 唯一的 memory 表述：`config/examples/` ships opt-in overlays for **memory MCP servers**——即官方当前对「记忆」的官方口径是 **MCP 服务器 overlay（自选装配）**，不是内置服务。
- 0.2.0 新增三个实验包：`experimental-auto-review`（权限复盘）、`experimental-agent-team(-profile)`（官方团队协作）、`experimental-voice-input-bundle`（语音输入）。**没有 experimental-memory**。

### 1.2 官方「上下文进模型」的统一车道（对本插件最关键的发现）

实读 6 个接缝包源码（npm tarball 0.2.0-rc.1），官方所有动态上下文**统一走 user-role 消息注入，不改 system prompt**：

| 包 | 机制 | 注入形态 |
|---|---|---|
| `dsh-agent-instructions` | AGENTS.md/CLAUDE.md 发现+基线+变更对账 | `createUserMessage({source:{kind:"agent-instructions"}})` |
| `dsh-time-context` | 每轮时间/时区/流逝 | `inject:["agents","sessionProjections"]` + pre-step 产 user 消息 |
| `dsh-session-reference` | 跨会话快照引用 | `@[label](dsh-session:…)` 提及 → 解析为快照上下文（≤3 条/消息，64KB 预算，溢出存 spill） |
| `dsh-schedule` | 定时任务到期投递 | `createUserMessage({source:{kind:"schedule"}})` + `agent.followup(message)` **投回原会话** |
| `dsh-compaction` | 压缩接缝 | compact-checkpoint 作为**带 source 标记的 user 消息**留在会话面 |
| `dsh-system-prompt` | 静态节注册表 | 只有身份/工具说明等静态节在此；动态事实全走上面车道 |

结论：**官方的「记忆感」由带 `source.kind` 标记的 user 消息承载**。若官方出原生记忆，注入形态几乎必然沿用此范式（新 `source.kind:"memory"` 或等价物），挂点在 `agent/pre-step` / `system-prompt/assemble` 两个 cordis 事件。

### 1.3 官方已备好的两个「记忆邻居」接缝

- **`ctx.sessionProjections`（dsh-session-projection）**：merge-extensible 投影注册表。任何域插件 `register({key, stateVersion, init, apply, wire})` 即可在**每个会话事件**上做纯折叠，得到持久化状态（checkpoint/restore 契约齐全，`ver+seq+val` 行式落盘）。这是官方预留的「给会话挂任意持久派生状态」的标准位。
- **`dsh-session:` URI（dsh-session-reference）**：会话级引用协议（`dsh-session:base64url(sid)`），模型可见、UI 可渲染、带 untrusted 警示与预算控制。**这是跨窗口接续可以白嫖的官方协议面。**

---

## 二、官方长期记忆系统的机制预测（三形态 + 概率 + 观察点）

**形态 A：官方 MCP memory server（概率最高，~60%）**
- 依据：README 已点名 memory MCP servers overlay；`dsh-mcp-client`/`dsh-mcp-resources` 已在 0.2.0 依赖树里；自建 MCP 服务器投入小、与「Local-first、模型管工具」哲学一致。
- 形态：官方发布一个（或推荐社区的）memory MCP 服务器，工具面形如 `memory_write/memory_search/memory_read`，模型**主动调用**。存储大概率是本地 JSON/SQLite + 词法或轻量向量检索。
- 判据/观察点：npm 出现 `@deepseek-ai/dsh-memory-mcp` 或 config/examples 出现 memory server 样例；设置页出现 MCP memory 推荐项。

**形态 B：宿主原生记忆接缝（~30%）**
- 依据：session-projection RFC（2026-07-27）的 registry 设计、以及 DeepSeek 官方在群/发布中「承诺出官方长期记忆」的说法；官方 0.2.0 把上下文积木（压缩/引用/投影/指令/时间）全部补齐后，记忆是自然下一步。
- 形态：`ctx.memory` 服务接缝（可被插件贡献/扩展），存储在 `~/.dsh/memory/` 下，注入走 `agent/pre-step` 新 user 消息；检索端可能开放给插件贡献 ranked provider（类比 sessionProjections.register）。
- 判据/观察点：`dsh-session-projection` 出现官方 `memory` key；system-prompt SECTION_ORDERS 出现 MEMORY 段；`source.kind` 枚举新增 memory。

**形态 C：纯平台侧记忆（概率低，~10%）**
- 形态：记忆存在 DeepSeek 账号云端（dsh-deepseek-account 已在树上），跨设备同步，本地不可控。
- 与本插件 Local-first 立场冲突最大，但与官方商业路径（账号绑定）有吸引力。

**对三种形态的共同结论**：官方记忆大概率做的是「**模型主动查**」（工具面）或「**官方决定注入什么**」（服务面）；本插件的核心差异化——**写入前主动唤回 + 语义判定（fv2）+ 预算仲裁**——在三种形态下都不被覆盖。

---

## 三、唤回系统如何亲和官方（正面回答「要不要额外建索引文件」）

**不需要为官方记忆另建一套索引文件。** 论证：

1. 官方记忆（无论 A/B）自带存储与检索；本插件唤回的内容主体是**自有工件**（MEMORY.md 账本 / procedure / handoff / 白板 / PLAN），这些永远是我们自己的数据，索引建在自己数据上，与官方存储零耦合。
2. 亲和的正确姿势是**车道对齐**而非数据对齐：
   - 若官方记忆在场（探测 `ctx.memory` 或 MCP memory 工具面），插件的注入车道做**分工让位**：事实层（fact 类记忆的重复注入）降频或停注，保留官方不覆盖的过程层（procedure 步骤、handoff 交接、白板裁决、PLAN 断点）。
   - 探测方式与现团队线同款：能力探测（`ctx.get` 不存在即视为不在场，插件当前已是这么处理 sessionProjections 的）。
3. 写入侧可选**镜像**：官方记忆在场时，把插件沉淀的高置信 fact 追加写一份到官方存储（走其 MCP 工具或接缝），让模型主动查询车道也能命中——这是「两套系统互不重叠」的最后一块拼图，做成可关的设置项。
4. 锚点兼容：本插件已有 `<!--memory:mem_[0-9a-f]{32}-->` 锚点豁免形态与读侧 `^mem_[0-9a-f]{32}` 解析；若官方记忆条目有稳定 id，沿用同一锚点格式即可实现「插件记忆 ↔ 官方记忆条目」的互引，无需新索引。

---

## 四、「实时语义引擎直接找行号」可行性

**可行，且大半零件已在。** 方案：

- 现有 sidecar 语义引擎（JS 档 e5-small q8，本地推理）已支撑 C2 检索 + fv2 决策（`recall_intent_lr_v1.json` 工件 + `candidateHit` 特征）。
- 行级化改动：嵌入单元从「条目」降到「块/行区间」——入库时按 `## 节` 或固定 token 窗口切分，向量旁挂 `(file, lineStart, lineEnd)` 元数据；查询时 ANN top-k 直接映射回行区间。
- 成本量级：e5-small 单条前向毫秒级；一次会话的账本文件几百块，全量索引 < 1s，增量写入逐块更新。零外部依赖。
- 结论：**「不建索引、查询时实时全量嵌入」不可行**（每次查询都要嵌入全库，延迟与 CPU 不可接受）；**「向量索引 + 实时查询」本来就是我们现在的架构**，要做的是把粒度从条目降到行区间，改动集中在 sidecar 的 index.json 结构与 C2 的命中回显。

---

## 五、对话归档向量化（跨窗口接续第三条腿）——方案与预算

**判定：可行，且与官方 0.2.0 的新协议面天然亲和。**

1. 抽取器（新，约 150 行）：扫 `~/.dsh/sessions/*/session.jsonl.zstd`（复用 `decodeZstdFramesHead` 分帧读取 + intent 提纯只认真人消息），按 `projectSessionConversation` 同款规则抽 **user 提问 + assistant 最终回答**（排除 tool/reasoning/注入源），产出 `docs/memory/dialogues/<sid>.md` 式归档：每轮一段 `### 轮 N（seq a–b）\n**用户**: …\n**助手**: …`。
2. 向量入库：归档块以新 source kind（如 `dialogue`）入 sidecar 索引，元数据带 `(sessionId, seqRange, lineStart, lineEnd)`。
3. 唤醒回显：命中时注入「当时会话 X 第 N–M 轮讨论过 …」+ **`dsh-session:<sid>` 官方引用 URI**——0.2.0 的 session-reference 会把它渲染成可点开的引用卡片，预算走官方 64KB/spill 机制。这是「亲和官方」的黄金路径：我们只负责「找到」，全文捞回交给官方协议。
4. 预算：一轮对话对平均 300–800 token，e5 嵌入毫秒级；100 轮长会话 ≈ 100 向量 ≈ 数十 KB 索引。全机历史会话一次性回填约几千向量，量级无压力。
5. 边界：会话日志 >16MB 的跳过策略沿用 lexicalSessionScanFallback 现行红线；descriptor v2 毒会话已有兜底经验，抽取器必须 try/catch 单会话失败不毒化全批（descriptor v2 事故的直接教训）。

---

## 六、疑虑检测唤醒（「模型犹豫时推记忆」）——判定：方向可行，时机要换

用户设想的「检测到 CoT/输出里的 humm 就实时唤醒」：
1. **信号集成熟**：词表 + 正则（hmm/um/let me think/等一下/不对/重来/似乎不对/我不确定…）零成本起步；进阶用逻辑回归小分类器（`recall_intent_lr_v1.json` 同款工件格式与加载器，直接复用 `loadAndVerifyPolicy`）。
2. **时机修正（关键工程约束）**：流式 CoT 的**中断式注入没有车道**——官方 agent-loop 的 assistant/message 在整步完成后才提交为会话事件，进程内挂点（`agent/pre-step`、`turn/start`、`session/event`）都拿不到「半截思维链」。可行的是两个错位时机：
   - **轮前预判**：`user/message` 进来时对用户消息跑疑虑/模糊检测（「帮我看看之前那个问题」），命中即在 pre-step 注入候选记忆——这是现行唤回车道的自然扩展。
   - **轮后自纠**：`assistant/message` 事件（整轮落盘后）检测本条回答中的疑虑标记，命中则给会话打标记，**下一轮** pre-step 把相关记忆顶上去（「上一轮它犹豫了」作为 fv2 的一个新特征位）。语义上等效于实时唤醒，工程上零新协议。
3. 防误触：口头禅白名单（「其实/总之」类高频词不触发）+ 置信度门槛 + 每会话限频冷却（群答疑 `AI_MAX_PER_HOUR` 同款纪律）。
4. 「提示哪一行到哪一行」：命中回显带 `(file, lineStart–lineEnd)` / `(sessionId, seq 范围)`，由第五节的行级元数据直接供给。

---

## 七、演进路线（供拍板，未排期）

| 优先级 | 事项 | 依赖 |
|---|---|---|
| P0 | 行级嵌入索引（第四/五节共用底座：sidecar index 加行区间元数据） | 无，纯自有 |
| P0 | 对话归档抽取器 + 向量入库 + `dsh-session:` URI 回显 | P0 行级索引；官方 0.2.0 已在用户机 |
| P1 | 轮后疑虑检测 → 次轮唤醒（第六节时机②，最稳） | 行级索引 + fv2 特征位 |
| P1 | 官方记忆在场的车道分工（探测 + 过程层保留） | 形态 A/B 落地后适配，前置代码量小 |
| P2 | 官方记忆写入镜像（可关设置项） | 形态 A/B 的写接口定型 |
| 观察 | 形态 C（云端记忆）出现则重估 Local-first 立场 | — |

---

## 附：本次取证的环境备注

- 本机宿主正处于 0.1.7-rc.2 → 0.2.0-rc.1 升级中途（npm 全局树 `@deepseek-ai/` 下主包暂缺、profile junction 全部悬空、staging `.dsh-uHeWgOIL` 就位）。报告源码证据取自 npm registry tarball（0.2.0-rc.1），不受本机安装态影响。
- 宿主升级完成后（`dsh` 主包回到 npm 全局树）建议快速复核两件事：① profile junction 树恢复；② 本插件在 0.2.0 上 peer cordis ^4.0.4 的兼容（0.2.0 依赖树 cordis 版本待查）。
