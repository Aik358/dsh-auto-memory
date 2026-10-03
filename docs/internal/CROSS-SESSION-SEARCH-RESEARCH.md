# 跨会话 / 跨 Agent 记忆检索 · 调研报告（2026-09-14）

> 与 `CROSS-SESSION-SEARCH-PATH-DECISION.md`（决策页）配套：那页定"走哪条路"，本页回答"**具体怎么做、优缺点是什么**"。
> 证据分级：**[实测]** = 本机跑出来的数字；**[实证]** = 有公开 benchmark/事故报告支撑；**[经验]** = 工程界共识/无硬数据；**[估算]** = 由实测外推。

---

## 一、一句话结论

**词法为主干（`node:sqlite` FTS5，Node 内置、零依赖）+ 轮次级分块 + 字节 offset 增量 + 逐文件跳过计数**，语义向量只作**可选增益**（装了走 RRF 融合，不装也必须独立可用）。
理由：LongMemEval-S（500 题，all-MiniLM-L6-v2）上 **BM25-only R@5 = 86.2% → BM25+向量 = 95.2% → 纯向量 96.6%** —— 加向量是单项收益最大的一步（+9pp），但混合与纯向量只差 1.4pp，**混合才是性价比点**（[来源](https://raw.githubusercontent.com/rohitg00/agentmemory/a8e7d19a814a24a21818afc715f3301b3eaeee80/benchmark/LONGMEMEVAL.md)）。**[实证]**

---

## 二、本机实测：语料盘点与格式规则 [实测]

### 2.1 体量（决定了"能不能全量索引"）

| 来源 | 文件数 | 体量 | 备注 |
| --- | --- | --- | --- |
| DSH 会话 `~/.dsh/sessions/**/session*.jsonl.zstd` | 191 | **321 MB**（压缩态） | 最大单文件 25 MB 压缩 |
| WorkBuddy `~/.workbuddy/projects/**/*.jsonl` | 89 | 155 MB | 最大单文件 **53 MB** |
| ZCode `~/.zcode/cli/rollout/*.jsonl` | 3 | 80 MB | **model-io 日志：同一段历史重复 N 次** |
| Codex `~/.codex/sessions/**/rollout-*.jsonl` | 17 | 46 MB | 最大单文件 25 MB |
| Claude Code `~/.claude/projects/**/*.jsonl` | 4 | 0.1 MB | 本机几乎没在用 |
| Kimi `~/.kimi-code/sessions` | 0 | — | 目录为空 |
| 外部记忆 markdown（CLAUDE/AGENTS/MEMORY.md） | 55 | 0.5 MB | 成本最低、收益最直接 |

### 2.2 DSH 会话的压缩比与正文占比 [实测]

抽样 4 个文件（含 3.4 MB 级）：**压缩比 2.1x、正文占解压文本 52%**。
→ 外推：321 MB 压缩 ≈ **0.67 GB 解压文本 ≈ 0.35 GB 可索引正文**。
→ 速度：解码 5.5 MB 压缩（11 MB 文本、1.7 万事件）耗时 **0.7 s** → **全量扫一遍 DSH 会话约 1 分钟 CPU** [估算]。**结论：一次性全扫完全可接受，问题不在解码速度，而在索引体量。**

### 2.3 各源正文抽取规则（已逐源实测字段路径）

| 源 | 取哪些 | 字段路径 | 必须排除 |
| --- | --- | --- | --- |
| DSH | 消息事件文本 | 现有解码器 + 事件 type 过滤 | 系统提示/工具结果大块 |
| Claude Code | `user` / `assistant` | `message.content`（字符串或 blocks） | `file-history-snapshot`、`mode` |
| Codex | `response_item` | `payload.content[].text` | **`session_meta.payload.base_instructions.text`（系统提示，每文件 ~17 KB）**、`world_state` |
| WorkBuddy | `message` | `content[].text` | `reasoning`（思维链，默认不索引）、`file-history-snapshot` |
| ZCode | `model_io` | `request.body.input[].content` / `request.messages[].content` + `response` | **重复消费**：每次请求重发全史 |

**两个坑（不避开就会把索引撑爆或污染结果）**：
1. **Codex 的 `base_instructions` 是系统提示**（每个会话一份、上万字符），索引它等于把"我的插件说明"混进用户记忆。
2. **ZCode 是请求日志**：同一段对话在每次 API 调用里重复出现，**必须按 `turnId`/`requestId` 去重或只取最后一条**，否则 80 MB 里绝大多数是重复。[实测]

---

## 三、业界实证：怎么做才不翻车

| 议题 | 结论 | 证据 |
| --- | --- | --- |
| 架构 | 词法打底 + 可选向量 + RRF 融合；RRF 是零调参行业默认 | **[实证]** LongMemEval 数据；[ADR 016](https://github.com/psmfd/agent-experise-api/blob/main/adrs/016-hybrid-rrf-search.md) |
| 分块粒度 | **轮次（round = user+assistant）优于会话级**；进一步压成"单条 fact"会因信息损失**整体变差**（只在多会话推理上更好） | **[实证]** LongMemEval 论文 §5.2 [arXiv 2410.10813](https://arxiv.org/abs/2410.10813) |
| 增益技巧 | 多键索引（抽取 user facts 扩展 key）recall@k **+9.4%**、QA +5.4%；**时间感知索引 + 查询扩展 时序 recall +6.8~11.3%** | **[实证]** 同上 |
| 增量 | 指纹 `(path, size, mtime)`；更稳是内容哈希做 chunk 级；**append-only JSONL 记字节 offset 续读**，不重解析 | **[经验]** |
| 容错 | **跳过 + 计数 + quarantine 表**，逐文件/逐行隔离；绝不 fail-closed | **[实证]** LightRAG 曾因"索引 FAILED 卡死所有查询"，修复方式是显式 rebuild（[PR#3177](https://github.com/HKUDS/LightRAG/pull/3177)）—— 与 DSH 上游同款病灶 |
| 模型 | 中英混合：bge-small(24M/384d) 或 multilingual-e5-small(118M/384d)；**bge-m3 2.27GB 与 130MB 预算不匹配**；量化可压 1/4 | **[经验]** |
| 隐私 | 入索引前做**路径级排除名单**（`.env`/credentials）+ 展示层高熵串脱敏；**全密文与可检索互斥**，不要设计成全密文本地检索 | **[经验]** |
| 换模型 | 必须版本化模型标识并全量重算，否则向量空间混用 | **[实证]** [Neo4j 迁移教训](https://neo4j.com/labs/agent-memory/how-to/migrate-embedding-model/) |

本机已有的可复用件：`decodeZstdFrames(Head)`（已按 PR#29 加固）、`_jsSemanticRank`（零依赖 JS 语义臂）、`_semanticRankBest`（python dense 择优）、`l0-extract-pre.js`（L0 摘要抽取）、`discover()`（外部源扫描，已抓 md `content`）。

---

## 四、三种实现方案的优缺点

### 方案 1：FTS5 词法索引（`node:sqlite`，Node 内置）— **推荐做 P0**
- **怎么做**：`node:sqlite`（Node ≥22.5 内置，本机 v24.18.0 已实测可用）建 `chunks(source, sids, ts, role, text)` + FTS5 虚表；写入按轮次切块；查询 `MATCH` + 元数据过滤（时间/工具/工作区）。
- **优点**：零依赖、不下载模型；毫秒级查询；索引体量小（估 FTS5 约为正文 30–60% → **100–200 MB** 级 [估算]）；实现与测试成本最低；完全离线。
- **缺点**：**隐含偏好类查询是硬伤**（BM25 该类 60% vs 混合 83.3%）；同义/换词检索弱。
- **适用**：所有用户默认路径（含没装引擎的）。

### 方案 2：向量索引（复用/扩展现有引擎）
- **怎么做**：轮次切块 → 现有 provider 抽象（bge-m3 / hash）或新增小模型 → 向量存 sqlite BLOB（int8）或分开的 `.bin`；查询 top-K 后与词法 RRF 融合。
- **优点**：召回最高（纯向量 96.6%），改述查询也能命中。
- **缺点**：**成本最高的部分** —— 本机语料量级 [估算] 需 embed ~25–40 万块；384 维 float32 约 **400–600 MB**（int8 约 100–150 MB）；CPU 全量重算是分钟~小时级；模型/版本漂移要全量重算；现有 python 向量落盘是 JSON（`vectors-*.json`），**这个量级不能继续用 JSON 存**。
- **适用**：装了语义引擎的进阶用户；作为增益项。

### 方案 3：轻量"倒排 + JS 语义臂"（零依赖兜底）
- **怎么做**：纯 JS 倒排表（词→chunk ids）+ 现有 `_jsSemanticRank` 重排；索引落单个紧凑 jsonl/二进制。
- **优点**：兼容老 Node；无 sqlite 依赖；实现小。
- **缺点**：自建倒排的查询质量/性能都不如 FTS5；内存占用随语料涨；容易变成"自研半成品数据库"。
- **适用**：**仅当检测不到 `node:sqlite` 时的降级路径**（DSH Desktop 的 Electron Node 22 需实测），不要作为主路径。

### 横向对比

| 维度 | 方案 1 FTS5 | 方案 2 向量 | 方案 3 JS 倒排 |
| --- | --- | --- | --- |
| 依赖/下载 | 0 | 130 MB+(可选) | 0 |
| 首次建索引 | 分钟级 | 分钟~小时级 | 分钟级 |
| 索引体量 [估算] | 100–200 MB | +100–150 MB(int8) | 50–150 MB |
| 召回（LongMemEval 口径） | 86.2% | 96.6% | ~86% 或更低 |
| 实现风险 | 低 | 中（模型/版本/存储） | 中（自研存储） |
| 老 Node 兼容 | 需降级 | 需引擎 | 最好 |

---

## 五、推荐组合与分阶段

**P0（零依赖基线，必须独立可用）**：DSH 会话 + 外部记忆 markdown 入 FTS5 + 轮次分块 + offset 增量 + 跳过计数 + 来源/时间元数据 + 时间感知查询扩展（词法下性价比最高项，+6.8~11.3% 时序召回）。**目标：不装任何模型也能检索。**
**P1（外部 Agent 会话）**：Claude Code / Codex / WorkBuddy / ZCode 适配器（按 §2.3 规则；ZCode 先按 turnId 去重），**逐源可开关**、单源失败不影响其他源。
**P2（语义增益）**：小模型（bge-small / e5-small 量级）向量 + RRF 融合；沿用"模型标识版本化 + 不匹配即重算"。
**P3（体验）**：`scope='sessions'` 改为插件原生（有 DSH sessionQuery 就补充、没有/失败就用自建索引）；面板里显示"索引了多少条 / 跳过了几个文件"。

**硬性预算（默认值建议）**：时间窗 90 天 + 单源上限 2 万块 + 总量上限 10 万块 + 单文件解码上限 16 MB；超限只索引"最近优先"并**在面板如实显示跳过/截断数量**。理由：本机语料 [估算] 会产生 25–40 万块，无上限必然失控。

**隐私默认**：入索引前路径级排除（`.env`、credentials、密钥目录）+ 高熵串脱敏；索引只落本机 `~/.dsh/memory/`；提供"一键清除索引"与工作区排除名单。

---

## 六、风险清单（按优先级）

1. **fail-closed 传染**（最高危）：任何"单文件坏 → 整库不可用"的设计直接否决 —— 这是 DSH 上游正在发生的病灶，必须反着做。
2. **规模失控**：600 MB 压缩语料全量索引必然爆预算 → 必须时间窗 + 条数上限 + 如实计数。
3. **敏感内容入库不可逆**：脱敏要在入索引前；排除名单要能改并支持重建索引。
4. **热路径阻塞**：索引只在空闲/后台做，单批限量；查询只扫 top-K。
5. **重复内容污染**（ZCode 请求日志、Codex 系统提示）：先做源级去重与字段白名单，否则"检索到 10 条其实是一条"。
6. **模型/版本漂移**：向量必须带模型标识，换模型全量重算。
7. **格式漂移**：各家会话格式会变 → 适配器版本化 + 解析失败即跳过并计数（不要抛给用户）。
8. **跨工具隐私**：索引别人的记忆目录（Claude Code / Codex）等于把别的工具的对话搬进来 → 默认只索引"用户勾选过的源"。

---

## 七、与上游那份缺陷的关系

- 本方案**不依赖** DSH 的 `sessionQuery`：自建索引是主路径，它只作可选补充。→ 上游那个 fail-closed 缺陷**不再是阻塞**。
- 建议仍单独上报（可并入 #5732 系列）：①v0 日志里 `subagent/descriptor` v2 被编解码器硬拒（DSH 自己写的数据）；②索引器 fail-closed 且无容错开关。社区同族：#4811、#4910、#5694。
- 决策状态：**等大排期一起拍板，暂不动工**（用户 2026-09-14 决定）。
