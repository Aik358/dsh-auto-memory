# 白板接续整合方案：判据约束生成 + sidecar 结构化存储 + 两工具主动重建

> 预研综合子代理 R3 产出 · 2026-09-13。输入：`WB-GRAPH-RESEARCH-BRIEF.md`（任务书）、`WB-GRAPH-RESEARCH-LOCAL.md`（R1 本地审计）、`WB-GRAPH-RESEARCH-EXTERNAL.md`（R2 外部调研）。
> 所有本地锚点行号均为 2026-09-13 工作树实测抽验值（复核过 R1 报告，无漂移；个别表述按实际行更正，见 §0）。
> 边界约束（照抄任务书 Q5 执行）：**不引入跨目标依赖图**；**不搬 dsh-graph 代码**（其 MIT 许可文本在 `dsh-graph-host/` 子包，仍只借范式）；**MRAgent 仓库无 LICENSE——零代码复制，只借鉴行为范式**（硬约束而非偏好）；**Tag 确定性映射优先**；**不破坏前缀缓存固定边界**；**最小改动导向**。

---

## 0. 关键事实抽验记录（防幻觉声明）

对 R1 报告锚点逐一 grep/read 复核，结论：**无漂移**，以下为抽验后可安全引用的行号（本方案全文以此为准）。

| 锚点 | R1 记载 | 抽验结果 |
| --- | --- | --- |
| `writeHandoffLedger` | ~1667 | `lib/index.js:1667-1679` ✓（剔标题 1673、`writeFullRaw` 1674、返回 `{ok,path,clean}` 1675） |
| `writePlanSnapshot` | ~1620 | `lib/index.js:1620-1662` ✓（归档 1626-1631、P7 老化 1633-1656、`writeFullRaw` 1657、返回 1658） |
| `sanitizeForWrite` | ~6059 | `lib/index.js:6059` ✓（`WRITE_GATE_REASON` 6092、`sanitizeReservedSyntax` 6088-6090） |
| `buildContinueCarry` 四层与 18000 | ~2712-2774 | `lib/index.js:2677` 起；第0层 2712（plan 3000）、第1层 2713-2723（权重化 8000）、第2层 2726（20 条/700 字）、第3层 2727-2737、P5 锚点表 2744-2760、`carryText` 总预算 18000 在 **2774** ✓ |
| 动态快照 `handoffLedgerChars=800` | ~3619 | 配置定义 `lib/index.js:258`（plan 1200 在 256）；注入点 ledgerPart **3619**、planPart 3617 ✓ |
| 静态纪律 / 动态快照分离 | ~7026 / ~6958 | 静态 section `dsh:auto-memory-pre-rules` 注册在 **7026-7032**（渲染 `renderMemoryStatic` 3693-3715，账本纪律行 3703）；动态 context `dsh:auto-memory-pre` 注册在 **6958-7024** ✓ |
| `searchHandoffCorpus` | ~1689 | `lib/index.js:1689` ✓（账本 12 篇 1710、归档 20 篇 1714；`recall` scope 路由 3838-3844、scope 枚举 7169） |
| 账本三生成通路 | ~7078 / ~2002 / 刷新仪式 | 工具分支 `lib/index.js:7078-7091`（kind 枚举 7072、闸门 7079-7080、写 7083-7084）；水位骨架 **2002-2024**（四段标题硬编码 2014-2017、`slice(0,4000)` 2018、写 2019）；刷新仪式 **2502-2509**（kind=plan 2505、kind=handoff 四段式 2506）✓ |
| 四段权重表 | handoff-anchor-pre.js:18-23 | ✓（.35/.30/.20/.15；未知段 0.05 在 27；`parseHandoffLedgerPre` 41-58 fail closed） |
| 工具数 14 测试硬锁（R3 补查） | — | **三处**：`tests/smoke/smoke-test.mjs:67`、`tests/smoke/smoke-test-m3b3-pre.mjs:43`、`tests/smoke/smoke-test-context-observer.mjs:107` 均 `!== 14` 抛错 |
| G0 源码守卫 | smoke-test-handoff-pre.mjs 文件头 | ✓（文件头注释声明 G0 守卫"注入块存在且在日志段之前"） |
| GUI 面板 fileQ 白名单 | ~2800 | `lib/index.js:2800` 严格白名单正则 ✓（`handoffPanelData` 2795 起） |

---

## 1. 总览

**一句话方案**：白板接续从"自由文本 + 平铺注入"升级为——**写入端用可计算判据把关（P1，咽喉在 `writeHandoffLedger`/`writePlanSnapshot`），存储端用 sidecar JSON 承载 Cue–Tag–Content 结构而 Markdown 仍是人读真相源（P2），检索端新增两个遍历工具让新窗口主动重建上下文而非被动收平铺（P3）**。

三层各自借鉴的范式来源（只借范式，零代码复制）：

| 层 | 借鉴来源 | 借的是什么 |
| --- | --- | --- |
| 判据约束生成 | dsh-graph | **判据是写操作的前置门槛而非事后检查**；**登记与确认分离**（写入 ≠ 合格确认，确认是显式事件）；**占位符过滤**防形式主义判据（R2：`core/ops.ts:1456-1486`、`schema/SCHEMA.md:87-91`） |
| sidecar 结构化存储 | dsh-graph | **"真相源 + 可重建投影"分工**：Markdown 是人读真相源，sidecar/事件流是机读派生件，允许损坏、可从真相源重建（R2：`schema/SCHEMA.md:298-299`） |
| 主动重建检索 | MRAgent | **遍历动作集**（正向 expand (key,tag)→content / 反向 content→(key,tag)）、**剪枝纪律**（(key,tag) 去重、返回条目帽、轮数帽、LLM 自判停止）写进工具描述（R2：`agent/tools.py:5-31`、`llm/controller.py:140-190`） |

dsh-graph 的状态机**不引入**：白板是单对话进度快照，dsh-graph 七阶段+非线性边表是为多目标管理设计的（R2 出入第 2 条）；只取它"只在关键门口设防"的思想——白板只在"写入"一个门上设防。

---

## 2. 判据 Schema（对应 Q1 / 产出 1）

### 2.1 设计立场（先回答"参照什么"）

任务书 Q1 猜想判据 schema 是 `criterion_type + evidence_required + confidence_level`——**R2 已证伪**：dsh-graph 的判据只是 `## 质量判据` 小节里的编号文本行，无任何字段化 schema（R2 出入第 1 条）。因此本节是**新设计**，参照 dsh-graph 的三个范式点（小节非空 + 占位过滤 + 确认事件），而非照搬其形态。

第二个关键差异：dsh-graph 的自然语言判据靠 review 执行者（另一个 LLM）判定，而白板的写入者就是 LLM 本人——**判据若也是自然语言，就退回"自评自确认"**（dsh-graph 明确禁止的模式：确认必须走显式路径）。所以白板判据取**可计算子集**（正则/行数/集合比较，零 LLM），自然语言质量层交给既有 prompt 纪律（`lib/index.js:3703`）。

### 2.2 判据定义表

**交接账本（kind=handoff）**

| ID | 段 | 判据 | 硬/软 | 判定方式（纯函数） | 不通过行为 |
| --- | --- | --- | --- | --- | --- |
| H1 | 全篇 | 四段标题齐全且逐字匹配：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步` | **硬·拒绝** | `parseHandoffLedgerPre`（`lib/handoff-anchor-pre.js:41-58`）返回非 null 且四标题集合与权重表（同文件 18-23）相等。理由：标题错 = 权重化截断失效 + 注入端解析 null fail closed，下游全部退化 | 拒绝写入，返回缺失段清单 |
| H2 | 每段 | body 非空：≥1 非空行且合计 ≥20 字符 | **硬·拒绝** | 行过滤 + 长度统计 | 拒绝写入，指明空段 |
| H3 | 全篇 | 无占位符行：段 body 不得只含 `(待补充)`/`TODO`/`同上`/`略`/`N/A` | **硬·拒绝** | 占位符黑名单集合匹配（借 dsh-graph `CRITERIA_PLACEHOLDERS` 技巧） | 拒绝写入 |
| H4 | 全篇 | 总长 ≤ 8000 字符 | **硬·拒绝** | 长度（与 `sanitizeForWrite` 上限 7079 同源，先于它执行以免双重截断语义混乱） | 拒绝写入 |
| S1 | 每段 | ≤5 行 | 软·警告 | 行计数（prompt 纪律 3703 既有约定） | 写入成功 + report 标记 |
| S2 | 已试方案与失败原因 | 失败项写成「方案→失败原因」且保留报错关键词（`/失败|报错|错误|回滚|error|fail|bug/i`，与水位骨架 failLines 同源 `lib/index.js:2009`） | 软·警告 | 正则命中计数 | 同上 |
| S3 | 进度与下一步 | 下一步含可执行特征：路径分隔符 / 反引号代码 / 命令动词 | 软·警告 | 正则 | 同上 |
| S4 | 全篇 | 无临时信息（搜索结果、临时路径、工具报错原文） | 软·仅 diag | 低置信启发，先只记 diag 不提示模型 | 仅日志 |

**白板 PLAN（kind=plan）**——PLAN 是自由全貌文档（P7 老化按标题分类 `lib/index.js:1636-1645`，节名不固定），判据刻意保持最弱：

| ID | 判据 | 硬/软 | 判定方式 |
| --- | --- | --- | --- |
| P-H1 | 至少一个 `## ` 顶层节且非空（≥20 字符） | **硬·拒绝** | 与 P7 老化的节切分逻辑（1636）一致，防"全部节被老化走"的空白板（1645 兜底的上游化） |
| P-H2 | ≤ 200000 字符（7079 既有上限） | **硬·拒绝** | 长度 |
| P-S1 | 含至少一处前瞻内容（`下一步|待办|计划|todo/i` 命中） | 软·警告 | 正则 |

### 2.3 硬/软分层的理由

1. **硬判据必须是确定性可计算的**：拒绝写入后模型可以立即重试改写，误拒代价 = 一轮重试；结构完整性（标题、非空、占位符、长度）误拒率趋近于零。
2. **软判据是启发式**（可执行特征、失败项格式），误报率不可忽略；拦截会惩罚合格笔记，且**水位骨架通路（2002-2024）在素材为空时天然不满足 S2/S3**——拦它就违反 I4"绝不阻塞接续"（`docs/CONTINUITY-FLOW.md:165`，R1 实测代码注释 `lib/index.js:2715`）。
3. 分层与 dsh-graph 对齐：它也只有一个硬门（in_progress 三条件），其余全靠边表合法性——白板同理只在"结构完整性"一个门上设硬闸。

### 2.4 校验时机：写入前代码校验 + 写入后确认事件（结论）

结合 dsh-graph"登记与确认分离"范式，结论是**两层，生成中 self-check 不承担拦截职责**：

1. **写入前（代码，权威）**：校验中间件插在两个咽喉 `writeHandoffLedger`（1667）与 `writePlanSnapshot`（1620）入口——这两个函数覆盖全部三条生成通路（工具 7083-7084 / 水位骨架 2019 直调 / 刷新仪式产物走通路 1），在工具层（7078）校验则漏掉水位骨架直调通路（R1 §五已证）。硬判据不过 → 拒绝（`{ok:false, gate:'criteria'}`）。
2. **写入后（事件，确认）**：校验通过/带软警告的事实作为**确认事件**记录（P2 的 events.jsonl：`criteria.passed` / `criteria.warned`），供刷新仪式轮询（`handoffMaterialStamp` 2524）、GUI 面板（2795）与图重建消费。登记（写入）与确认（判据事件）分离——"写了"不等于"合格"，防止模型用一次敷衍写入骗过仪式等待。
3. **生成中 self-check（prompt，引导）**：只在 `memory_note_pre` 工具描述（7069）与刷新仪式 prompt（2506）补一句"写前自检四段齐全、无占位符"。它不承担拦截：LLM 自评不可靠，且生成中校验需要额外轮次，违背最小改动与 I4。

### 2.5 校验报告 JSON Schema（机器可读产物，P1 中间件返回值契约）

```json
{
  "$id": "dsh-auto-memory/ledger-criteria-report-v1",
  "type": "object",
  "required": ["version", "target", "hard_pass", "hard", "soft"],
  "properties": {
    "version": { "const": "ledger_criteria_v1" },
    "target": { "enum": ["handoff", "plan"] },
    "hard_pass": { "type": "boolean" },
    "hard": {
      "type": "array",
      "items": { "type": "object", "required": ["id", "pass"], "properties": {
        "id": { "enum": ["H1", "H2", "H3", "H4", "P-H1", "P-H2"] },
        "pass": { "type": "boolean" },
        "missing": { "type": "array", "items": { "type": "string" },
          "description": "缺失/违规明细，直接拼进拒绝文案供模型改写" },
        "detail": { "type": "string" } } }
    },
    "soft": {
      "type": "array",
      "items": { "type": "object", "required": ["id", "pass"], "properties": {
        "id": { "enum": ["S1", "S2", "S3", "S4", "P-S1"] },
        "pass": { "type": "boolean" },
        "detail": { "type": "string" } } }
    }
  }
}
```

判据规则本体（阈值、标题集、黑名单词表）同样以 JSON 常量固化在新模块 `lib/ledger-criteria-pre.js` 中并被文档引用，**文档与代码单一来源**。

---

## 3. 图数据模型（对应 Q2 / 产出 2）

### 3.1 设计立场：Tag 是边属性，不是节点

任务书把 Cue–Tag–Content 当"三种节点"——**R2 已证伪**（出入第 5 条）：MRAgent 论文与代码中 Tag 均为边属性（三元组 (cue, tag, content)，代码为 `Link` 的 tag 字段 + 双侧 tag 倒排索引）。本方案按 **Cue 节点 + Tag 边属性 + Content 节点** 三元设计（dsh-graph 不提供任何图遍历参照，见出入第 4 条，本节遍历语义全部对齐 MRAgent）。

### 3.2 映射表：当前字段 → 图元素

| 当前字段/工件（实测锚点） | 图元素 | 类型 | 来源与确定性 |
| --- | --- | --- | --- |
| 工作区身份 + 接续序号 contSeq（2765-2770） | Cue(session) | 节点 | 确定性：接续链自带 |
| 账本篇 `handoff-<ts>.md`（命名 1669） | Content(ledger) | 节点 | 确定性：文件即节点，文件名时间戳即 id |
| 白板 `PLAN.md`（planPath 1574） | Content(board) | 节点 | 确定性：文件即节点 |
| 账本四段（标题硬编码 2014-2017） | Content(entry) | 节点 | 确定性：`parseHandoffLedgerPre` 切段（handoff-anchor-pre.js:41-58） |
| 段内 `- ` 条目 | Content(leaf) | 节点 | 确定性：行级切分（复用 `parseMemoryItemsPre` 思路，`lib/l0-extract-pre.js:54`） |
| 段类型（任务状态/目标/已试失败/进度） | Tag `type:state|goal|dead-end|progress` | **边属性** | **确定性映射**：段→tag 一一对应 |
| 条目中的文件路径/模块名/组件名 | Cue(key) | 节点 | 确定性：路径与标识符正则抽取（对齐 MRAgent "speaker 自动入 keyword" 的做法，R2：`agent/agent.py:845-848`） |
| 条目主题词 | Tag `topic:<短语>` | 边属性 | 确定性优先（条目首名词短语）；模型抽取仅作 P3 后的可选增强，prompt 要求"直接取原文词、不得改写"（MRAgent `KEYWORD_SYSTEM_PROMPT` 同款纪律） |
| dead-end 条目的方案名 | Tag `dead-end:<方案名>` | 边属性 | 确定性：从「方案→失败原因」句式的方案侧提取 |
| 归档链 `archive/PLAN-<ts>.md`、同秒 `-b` 后缀（1672、464-467） | prev_version 边 | 有向边 | 确定性：文件名字典序=时间序 |
| Tag/Cue 挂载 | (Content, Tag) + (Cue, Content) 两条边，tag 为边属性 | 边 | 写入时确定性生成 |

**Content 的界定（Q2 第三问）**：一条 state 条目是 Content，一条 dead-end **也是 Content**——二者只是 tag 集合不同（`type:state` vs `type:dead-end` + `dead-end:<方案>`）。类型区分完全由 tag 承担，不引入节点子类型，expand 时按 tag 过滤即可。

### 3.3 存储设计：sidecar JSON（P2），Markdown 仍是人读真相源

```
<projectDir>/handoff/            # projectDir = memoryRoot/<ws>（projectDirOf, lib/index.js:1504-1515）
├── PLAN.md                      # 人读真相源（不动）
├── handoff-<ts>.md              # 人读真相源（不动）
├── archive/…                    # 归档（不动）
├── index.json                   # 【P2 新增】派生缓存：条目表 + tag/cue 倒排 + 判据报告摘要
└── events.jsonl                 # 【P2 可选】append-only 事件：written / criteria.passed / criteria.warned / aged
```

- `index.json` 结构：`{version, ws, rebuilt_at, entries: [{id, kind, source, section, tags[], cues[], text_preview, mtime, criteria}], by_tag: {tag: [entry_id]}, by_cue: {cue: [entry_id]}, versions: {entry_id: [前版/归档]}}`。
- **可重建性**（dsh-graph 范式落地）：`index.json` 完全由 PLAN.md + `listHandoffLedgers`（1682）白名单文件经同一套确定性解析重建——sidecar 丢失不丢信息，只损失增量性能；`events.jsonl` 缺失时退化为"以文件存在为准"。
- **Q5 固定/动态切分**（本节回答一半，量化见 §6）：
  - **不进任何固定边界**：index.json/events.jsonl 纯落盘派生件，永不直接注入。
  - **固定边界内（字节稳定，禁止每轮变化）**：静态纪律 section（7026 注册、3693-3715 渲染）；工具 schema 块（发布级稳定）。
  - **动态但受控**：动态快照白板/账本段（3617/3619，预算 1200/800）；接续 `carryText`（2774，18000，首条 user 消息，单次接续内写定不变）；工具返回值。
- **边界约束落实**：图只覆盖"本工作区白板语料"，节点间**不建跨目标依赖边**（无 depends_on 之类）；`prev_version` 是唯一的非 (Cue/Tag/Content) 边，且只连归档链。

---

## 4. 遍历工具接口（对应 Q3 / 产出 3）

### 4.1 两个工具的 I/O schema

命名采用现有 14 工具的 `*_pre` 惯例（备选名见 §8 拍板点 4）：

**`memory_expand_pre`**（正向：给定 tag 展开其下 Content，对应 MRAgent `edges_by_tag` 的 Cue→Tag→Content）

```jsonc
// 输入
{ "tag": "string (required, 如 type:dead-end / topic:登录流程 / dead-end:重试机制)",
  "limit": "integer (optional, 默认 10, 硬帽 20)" }
// 输出
{ "ok": true, "tag": "…",
  "entries": [ { "id": "…", "kind": "ledger|plan|archive", "section": "已试方案与失败原因",
                 "preview": "≤120 字", "source": "handoff-20260913-101500.md",
                 "mtime": 1780000000000, "cues": ["src/handoff.js"],
                 "criteria": "passed|warned|unknown" } ],
  "total": 17, "truncated": true, "remaining": 7,
  "hint": "可用 memory_trace_pre(id) 回溯该条目的 cue/tag/邻居与归档版本" }
```

**`memory_trace_pre`**（反向：给定条目回溯其 Cue/Tag 与邻居，对应 MRAgent `query_event_keywords` + `query_event_context` 的合并）

```jsonc
// 输入
{ "id": "string (required, index.json 条目 id 或 mem_<32hex> 锚点)",
  "neighbors": "boolean (optional, 默认 true)", "neighbor_limit": "integer (optional, 默认 6, 硬帽 10)" }
// 输出
{ "ok": true, "entry": {…同上全量},
  "cues": ["…"], "tags": ["type:dead-end", "dead-end:重试机制", "topic:…"],
  "neighbors": [ {…同 tag/同 cue 邻居, 按段类型权重排序} ],
  "versions": ["archive/PLAN-20260912-180000.md"],
  "hint": "…" }
```

### 4.2 剪枝设计（白板场景的剪枝信号）

对齐 MRAgent 的防爆炸硬约束（8 轮 MAX_ROUNDS / 50 调用 MAX_TOOL_CALLS / (key,tag) 去重 / RERANK_LIMIT=20），按白板规模缩比：

| # | 信号 | 机制 | 对齐来源 |
| --- | --- | --- | --- |
| 1 | **判据确认状态** | 排序权重：`passed` > `warned` > `unknown`（P2 判据事件直接消费） | dsh-graph 确认事件范式 |
| 2 | **段类型权重** | dead-end .35 > progress .30 > goal .20 > state .15——**直接复用** `lib/handoff-anchor-pre.js:18-23` 权重表 | 既有资产 |
| 3 | **(tag) 去重** | 工具描述写死"不要重复展开同一 tag"；引擎在会话内维护已展开 tag 集合 | MRAgent "Do NOT repeat the same key–tag combination"（`agent/tools.py:9`） |
| 4 | **单返回条目帽** | limit 默认 10 / 硬帽 20，超出按权重排序截断并返回 `truncated/remaining`（白板图小、无 embedding，**不做** MRAgent 的 cosine rerank） | MRAgent RERANK_LIMIT=20 的白板版 |
| 5 | **轮数硬帽** | 工具描述建议"单次接续唤醒遍历调用 ≤4 次、总调用 ≤8 次"；如实说明：白板版无 MRAgent 那样的代码级强制闸（其 MAX_ROUNDS 在 controller 里，白板走宿主工具循环没有等价拦截点），靠提示 + hint 引导 | MRAgent MAX_ROUNDS=8 / MAX_TOOL_CALLS=50 的缩比 |
| 6 | **停止条件** | LLM 自判"已能续上工作"即停（answer/navigate 二分），写进工具描述 | MRAgent Stop(x, ℋ) 判定 |

### 4.3 入口 Cue 的获取方式（自动提取，零额外轮次）

1. **接续场景（主路径）**：入口 Cue 已经在上下文里——`carryText` 第0层白板 + 第1层账本（2712/2723）中可见的文件路径、组件名、主题词就是确定性可见的 Cue；工具描述指示模型"从已注入白板/账本中取路径/模块名/主题词作为入口 tag/cue"，**不需要新增 LLM 抽取步骤**（对齐 MRAgent 把种子证据 + key 候选塞进首轮的做法，R2：`agent/agent.py:539-545`）。
2. **白板 Cue 头**：`index.json` 的 session Cue（工作区 + contSeq）与 PLAN/账本头部时间戳（系统头 1674）。
3. **非接续场景**：当前轮用户消息分词 → `by_tag`/`by_cue` 规范化包含匹配（MRAgent `evaluate_relations_over_graph` 的白板极简版：只做规范化相等/包含，不做 Jaccard）；零命中 → 回落 `memory_recall_pre(scope=handoff)` 词法检索（3838-3844 原路径不动，即内建回退）。

### 4.4 与 MRAgent 工具集对齐表（以代码为准，含论文-代码命名出入）

| MRAgent 工具（代码 `agent/tools.py` 为准） | 论文名（如有出入） | 白板对应 | 取舍说明 |
| --- | --- | --- | --- |
| `edges_by_tag` | 论文误称 `query_tag_events`（出入 6） | `memory_expand_pre` | 保留 (tag) 展开语义；去掉 note 参数与 LLM 决策注记（白板图小不需要）、去掉 embedding rerank |
| `query_event_keywords` | 同名 | `memory_trace_pre`（cues/tags 部分） | 反向遍历 |
| `query_event_context` | 同名 | `memory_trace_pre`（neighbors/versions 部分） | "上下文"在白板场景=同 tag 邻居 + 归档版本链 |
| `query_topic_events` | 同名 | `memory_expand_pre(tag="topic:*")` | 复用同一工具，不新开 |
| `query_conversation_time` | 同名 | **不需要** | 条目自带文件名时间序（464-467） |
| `query_personal_information` / `query_personal_aspect` | 同名 | **不适用** | 边界约束：单对话白板无人物/跨目标维度 |
| （问题入口 `extract_question_keys` + `evaluate_relations_over_graph`） | — | 无独立工具 | Cue 匹配内联在 `memory_expand_pre` 的 tag 解析中（确定性包含匹配） |

dsh-graph 侧对齐：**无可借鉴的遍历工具**（出入 4）——它只有 `graph_validate`/`graph_rebuild` 式的对账接口，本方案只取其"派生件可重建"思想（§3.3），两工具的接口语义全部来自 MRAgent。

---

## 5. 改动清单（对应 Q4 / 产出 4）

> 行数为改动量估计（含测试）。**P0-P1 可立即做**；**P2-P3 需用户拍板后才能动——后端冻结期间禁改引擎**（P2/P3 均修改 `lib/index.js` 引擎本体），此边界为硬约束，见 §8 拍板点 1。

### P0 判据文档约定（零代码，可立即做）

| # | 改动 | 位置 | 依赖 | 改动量 |
| --- | --- | --- | --- | --- |
| P0-1 | 新建 `docs/HANDOFF-CRITERIA.md`：§2.2 判据表 + 正反例账本各一篇 + 与权重表（handoff-anchor-pre.js:18-23）/静态纪律（3703）的引用关系 | 新文件 | 无 | 0 行代码（~100 行文档） |

### P1 判据校验中间件（小改动，可立即做；R1 六项全数采纳）

| # | 改动 | 位置（抽验行号） | 依赖 | 改动量 |
| --- | --- | --- | --- | --- |
| P1-1 | 新建 `lib/ledger-criteria-pre.js`：纯函数、零 IO、fail closed（仿 handoff-anchor-pre.js 契约）；复用 `parseHandoffLedgerPre`（41-58）判段，实现 §2.2 全部判据，返回 §2.5 report | 新文件 | P0-1（判据表为规格源） | ~100 行 |
| P1-2 | `writeHandoffLedger` 入口插校验（1674 `writeFullRaw` 之前）：硬不过返回 `{ok:false, gate:'criteria', report}` | `lib/index.js:1667-1679` | P1-1 | ~5 行 |
| P1-3 | `writePlanSnapshot` 入口插校验（1657 之前）：P-H1/P-H2 | `lib/index.js:1620-1662` | P1-1 | ~5 行 |
| P1-4 | 工具层拒绝文案：7080 处按 `gate==='criteria'` 分支，仿 `WRITE_GATE_REASON`（6092）模式返回可执行改写指引（缺哪些段/哪个段空/占位符行原文） | `lib/index.js:7078-7091` | P1-2/P1-3 | ~10 行 |
| P1-5 | 水位骨架 fail-soft：2019 调用点对 criteria 拒绝的策略=**照写 + diag + 骨架内加警示行**（骨架标题 2014-2017 硬编码天然过 H1/H2，仅素材全空时可能触发；绝不阻塞接续，I4） | `lib/index.js:2002-2024` | P1-2 | ~5 行 |
| P1-6 | 回归测试：仿 `tests/smoke/smoke-test-handoff-anchor-pre.mjs`（fixture 锁定 + 源码守卫）；**同步 `tests/smoke/smoke-test-handoff-pre.mjs` 的 G0 守卫**（文件头声明的注入块存在性断言，插校验后需复核） | `tests/smoke/` | P1-1..5 | ~60 行 |
| P1-7（随 P1-4 顺带） | 工具描述（7069 kind=handoff/plan 文本）与刷新仪式 prompt（2506）各补一句"写前自检四段齐全、无占位符"（§2.4 第 3 层） | `lib/index.js:7069`、`2506` | P0-1 | ~4 行（字符串字面量） |

小计：~190 行（新模块 100 + 引擎 15 + 文案 4 + 测试 60 + 文档 100）。
依赖关系：P0-1 → P1-1 → {P1-2, P1-3} → {P1-4, P1-5} → P1-6。**不改任何注入/检索/缓存路径。**

### P2 sidecar 结构化存储（中等改动，**需拍板**）

| # | 改动 | 位置（抽验行号） | 依赖 | 改动量 |
| --- | --- | --- | --- | --- |
| P2-1 | 写入钩子：`writeHandoffLedger` 返回值处（**1675**）与 `writePlanSnapshot` 返回值处（**1658**）落盘 sidecar——每账本同名 `.json` + 汇总 `handoff/index.json`；含确定性 tag/cue 映射函数与 `criteria.passed/warned` 事件追加；P1 的 report 随条目入 sidecar | `lib/index.js:1675`、`1658` | P1 全部 | ~80 行 |
| P2-2 | 重建函数：`rebuildHandoffIndex()`——从 PLAN.md + `listHandoffLedgers`（1682）白名单文件确定性重建 index.json（sidecar 丢失自愈） | `lib/index.js`（新方法，挂在 1689 附近） | P2-1 | ~40 行 |
| P2-3 | 结构化检索：`searchHandoffCorpus`（1689-1719）升为 tag/段级命中优先、词法兜底；`recall` scope 路由（3838-3844）与 scope 枚举（**7169**）扩展 | `lib/index.js:1689`、`3838-3844`、`7169` | P2-1/P2-2 | ~40 行 |
| P2-4 | 注入端导航层：P5 锚点表区（2744-2760）扩展一行 tag 摘要（"白板 tag 地图：type:dead-end×7、topic:登录×3…"），保持"同输入同字节"（2740 既有性质）；总预算 18000（2774）不变 | `lib/index.js:2744-2760` | P2-1 | ~20 行 |
| P2-5 | GUI：`handoffPanelData`（2795）增加 tag/段视图；fileQ 严格白名单（**2800**）放行 `.json` | `lib/index.js:2795-2874` | P2-1 | ~30 行 |
| P2-6（可选） | 条目锚点：写入时为节/条目生成 `<!-- memory:mem_<32hex> -->`，复用 `parseMemoryItemsPre`（l0-extract-pre.js:54）；注意 `sanitizeReservedSyntax`（6088-6090）的豁免写法约定 | P2-1 同点 | P2-1 | ~30 行 |

小计：~210-240 行。依赖：P1 → P2-1/P2-2 → {P2-3, P2-4, P2-5, P2-6}。现有 Markdown 读者（`readLatestHandoff` 1603 / `listHandoffLedgers` 1682 / `findLatestGlobalHandoff` 1584 / `handoffMaterialStamp` 2524）在 sidecar 增量方案下**全部原样兼容**（R1 §六结论，抽验属实）。

### P3 遍历工具 + 唤醒逻辑（检索端，**需拍板**）

| # | 改动 | 位置（抽验行号） | 依赖 | 改动量 |
| --- | --- | --- | --- | --- |
| P3-1 | 注册 `memory_expand_pre` / `memory_trace_pre`（defineTool，schema 见 §4.1；handler 读 index.json，缺失时 fail-soft 回落 `searchHandoffCorpus`） | `lib/index.js` 工具注册区（`memory_recall_pre` 7166 附近） | P2-1/P2-2 | ~100 行（两工具含描述与剪枝纪律文案） |
| P3-2 | 唤醒逻辑：`buildContinueCarry` 第3层 guide（2727-2737）加一句"白板已结构化：可用 memory_expand_pre/memory_trace_pre 按 tag 主动重建，先于通读第3层" | `lib/index.js:2727-2737` | P3-1 | ~5 行 |
| P3-3 | **测试硬锁同步（必须项）**：工具数 14 → 16，三处 `!== 14` 全部改 `!== 16`——`tests/smoke/smoke-test.mjs:67`、`tests/smoke/smoke-test-m3b3-pre.mjs:43`、`tests/smoke/smoke-test-context-observer.mjs:107`；另补两工具行为测试与"sidecar 缺失回落"测试 | 三处测试文件 | P3-1 | ~60 行 |

小计：~165 行。依赖：P2 → P3-1 → {P3-2, P3-3}。**警告**：漏改任一处工具数断言 = smoke 测试直接红；回退（移除工具）时同样要同步回 14。

### 明确不动清单（承接 R1 §六，抽验确认）

`lib/client.js` 接续链（`refreshOldSession` 2117 / `waitForRefresh` 2145 / `executeContinue` 2167-2213，`carryText` 注入在 2201）；宿主 `hostAutoContinue`（2264-2335，prompt 注入 2305）；`renderMemoryStatic`（3693-3715）字节；`DEFAULT_PROMPT_LAYERS`；水位骨架结构（2002-2024 除 P1-5 五行外）；`water-window-pre.js` / `l0-extract-pre.js` 纯函数。**不引入跨目标依赖图、不建状态机**（dsh-graph 状态机范式评估后放弃，见 §1）。

---

## 6. 前缀缓存影响评估（产出 5）

I1 不变量：静态纪律层字节稳定（`renderMemoryStatic` 注册为 `ctx.systemPrompt.section`，7026-7032），一切随状态变化的内容只进动态快照（`ctx.systemPrompt.context`，6958-7024，user-role 追加历史尾部、project() 去重）。逐级评估：

| 级 | 触碰点 | 对字节稳定 prefix 的影响 | 破坏程度 |
| --- | --- | --- | --- |
| P0-1 | 纯文档 | 不进任何 prompt | **零** |
| P1 | 写盘路径 + 工具返回值 | 校验只发生在落盘前；拒绝文案只出现在当轮工具结果（对话动态部分）；工具描述/仪式文案（P1-7）变更属**发布版本级一次性字节变化**（工具块在请求头部、全版本会话一致，非每轮击穿） | **零每轮影响**；发布时一次性质变，与前缀缓存语义兼容 |
| P2 | 落盘 sidecar + 注入端 | index.json/events.jsonl **永不进固定边界**；进入上下文的只有：①动态快照白板/账本段（3617/3619，本来就在动态层、已有预算与频率控制 6971-7019）；②锚点表扩展（2744-2760，位于接续首条 user 消息内、单次接续写定后不变，且保持"同输入同字节"）。动态快照每轮增量 ≈ tag 摘要行 200-400 字节，且受 800/1200 预算与既有指纹节流约束 | **≈零**；动态层本来就被设计为可变 |
| P3 | 工具注册 + 唤醒提示 | 新工具进工具块（发布级一次性变化）；`memory_expand_pre`/`memory_trace_pre` 返回值只进当轮 messages 动态部分；唤醒提示加在第3层 guide（2727-2737，carryText 内，接续会话内写定）。静态 section（7026）字节 **0 次改动** | **≈零**（发布级一次性 + 动态区按需） |

**量化结论**：P0-P3 对静态纪律 section 的每轮字节稳定性的破坏次数均为 **0**；全方案唯一的固定边界触碰是 P1-7 的工具描述文本与 P3 的工具块增员——两者都是**发布版本级一次性**变化（等价于任意一次版本升级），不存在"每轮内容变化击穿 system prompt 前缀"的路径。若用户拍板把判据纪律写进静态纪律 3703（§8 拍板点 3），则增加一次版本级更新，仍非每轮击穿。

---

## 7. 风险与回退（产出 6）

### 7.1 成本预估（以 MRAgent 实测为锚，如实转述）

MRAgent 实测（R2，LongMemEval 每 sample 含构建+检索）：**token 全场最低**（118k，对比 Mem0 245k ~ LangMem 3268k），但**墙钟仅第二快**（586s，Mem0 533s 更快）——省 token 靠"只注入相关子图"，代价是遍历轮数增多。白板场景的对应预估：

- 图规模小（单工作区可见账本 ≤60 篇 + 20 篇归档窗口，1710/1714；条目数十级），`memory_expand_pre` 单次 = 一次 index.json 读取 + 内存过滤，<5ms，无 LLM rerank；
- token 增量：主动重建会话预估 **+1~2 轮工具往返、+1~3k token**（对比现状"通读 18000 carryText"多数情况下反而更省——MRAgent 的省 token 机制正是"只注入相关子图"）；
- 延迟增量：每次遍历一轮工具往返（秒级）；接续唤醒首轮**零额外轮次**（入口 Cue 从已注入材料确定性提取，§4.3）；
- P1 误拒重试：最坏 +1 轮（硬判据仅结构检查，重试率预期低）；刷新仪式期间被拒会推迟 `handoffMaterialStamp` 变化——仪式 prompt（2506）已给足四段格式、拒绝文案给出缺失清单，旧会话可当轮重试；风险窗口在仪式超时前，P1-6 测试需覆盖该场景。

### 7.2 回退方案（每层独立回退）

| 故障 | 回退路径 | 代价 |
| --- | --- | --- |
| sidecar 丢失/损坏/版本不识别 | `rebuildHandoffIndex()`（P2-2）从 Markdown 真相源重建；重建失败 → 一切读者回落 Markdown 平铺（现状路径全部保留：1603/1682/3838-3844） | 零信息损失（dsh-graph"投影可重建"范式） |
| `memory_expand_pre`/`memory_trace_pre` 失败或行为异常 | 回落 `memory_recall_pre(scope=handoff)` 词法检索 + carryText 平铺（原路径未删）；极端情况不注册两工具即回到 P2 状态（**同步把三处测试断言改回 14**） | 功能降级，接续不受阻（I4） |
| P1 判据误拦 | 配置开关 `criteriaGate: false` 一键 fail-open 回到现状（校验仍执行但只记 diag） | 一轮配置热更 |
| P2 注入扩展异常 | 锚点表区沿用既有 try/catch fail-soft 模式（2744-2760 现状即如此），失败自动跳过、材料回落平铺 | 零阻塞 |
| 判据事件流膨胀 | events.jsonl 仅 append 且按账本篇滚动；超限只保留最近 N 篇的事件 | 磁盘可控 |

---

## 8. 拍板点清单（列给用户）

1. **P2/P3 是否立项**：后端冻结期间禁改引擎——P2/P3 均改 `lib/index.js` 本体；P0-P1 可立即做。建议：P0-P1 立即，P2-P3 冻结解除后按本方案执行。
2. **sidecar 位置**：`memoryRoot/<ws>/handoff/`（与现有 handoffDir 同目录，1573，GUI 白名单只放行 `.json`，备份/迁移自动覆盖）vs 工作区 `.dsh-memory/handoff/`。**建议前者**。
3. **静态纪律 3703 是否随下一版本一次性更新**（把判据纪律写进固定 section，而不只是工具描述/仪式 prompt）：I1 允许版本级更新，代价是全量会话一次缓存重建。**建议更新**（判据与注入权重表本就同源）。
4. **工具命名**：`memory_expand_pre` / `memory_trace_pre`（对齐现有 14 工具 `*_pre` 惯例，**建议**）vs 任务书原名 `expand_tag` / `trace_back`（对齐 MRAgent 语义直译）。
5. **是否进 2.6.0**：P0-P1 体积小（~190 行）可进；P2-P3 建议 2.7.x 单独发版（工具数变更 + 存储格式新增，宜独立回归窗口）。
6. **P1 水位骨架硬判据失败策略**：照写 + 警示行（**建议**，I4 优先）vs 跳过写入（更干净但接续材料缺失）。
7. **PLAN 判据强度**：维持自由节名 + 最弱硬判据 P-H1（**建议**，P7 老化依赖节名灵活性）vs 固定 PLAN 小节集（伤及 P7 老化与"全貌图"用途）。
8. **P2-6 条目锚点是否做**：它是图化"按 id 展开"的地基，但涉及锚点写法与 `sanitizeReservedSyntax` 豁免约定，+30 行。建议随 P2 做。

---

## 9. 与任务书的出入记录（R2 八条如何影响本方案）

| # | R2 出入 | 对本方案的影响 |
| --- | --- | --- |
| 1 | dsh-graph 判据**无字段化 schema**（只是小节内文本行 + 确认事件） | §2 判据 Schema 是**新设计**（可计算硬/软分层 + report JSON Schema），参照其"小节非空 + 占位过滤 + 确认事件"范式而非照搬；任务书 Q1 的 `criterion_type/evidence_required/confidence_level` 猜想不采纳 |
| 2 | dsh-graph 状态机**只有一个判据门**（in_progress），迁移图远比线性链复杂 | 白板**不建状态机**，只在"写入"一个门设防（P1）；§1 明确放弃该范式 |
| 3 | graph_handoff 的"环境事实"段是**硬编码 dogfood 文案**，非可配置 API | 不设计"环境事实自动采集"；接续 guide（2727-2737）维持确定性文案，P3 只追加一句工具提示 |
| 4 | dsh-graph **没有通用图遍历工具**（只有 validate/rebuild 对账类接口） | §4 两个遍历工具的接口语义**只**来自 MRAgent；dsh-graph 仅贡献"派生件可重建"思想（§3.3 / §7.2） |
| 5 | MRAgent 的 **Tag 是边属性不是节点**（第三类节点实为 Topic/Persona） | §3 映射表按 Cue 节点 + Tag 边属性 + Content 节点设计；topic 作可选 tag 而非强制第三节点；**严禁**在实现中把 Tag 建成节点 |
| 6 | 论文与代码工具命名/参数不一致（`query_tag_events` 实为 `edges_by_tag`；"每轮 10 次"实为总会话 50 帽；语义层已被移除） | §4.4 对齐表以**代码为准**；§4.2 轮数帽标注为"提示级"而非硬闸（白板无 MRAgent controller 级拦截点）；不假设存在语义层 |
| 7 | 成本数字：token 最低但**墙钟非最快**（Mem0 更快） | §7.1 如实转述并给出白板场景预估：省 token 依赖"只注入相关子图"，延迟代价为秒级工具往返，接续唤醒首轮零额外轮次 |
| 8 | MRAgent 仓库**无任何 LICENSE**（默认版权保留） | 硬约束升级为"零代码复制"：§4 两工具的 schema/文案/实现全部原创撰写，只复用行为语义（去重、条目帽、自判停止）；dsh-graph 虽 MIT 在子包属实，仍按任务书只借范式不搬代码 |

（R2 第 9 条核实无误项——阶段名、目录/事件流、7 工具分组、三段式构建流程——本方案未依赖其错误面，无额外影响。）

---

## 附：Q1-Q5 答案索引

- **Q1 判据集**：§2（硬=结构完整性 H1-H4/P-H1/P-H2 拒绝，软=质量密度 S1-S4/P-S1 警告；时机=写入前代码校验 + 写入后确认事件，self-check 仅 prompt 引导）。
- **Q2 图映射**：§3（Cue=会话身份+条目内路径/组件名+交接时刻关键词；Tag=边属性、段类型/主题词确定性映射优先；Content=白板条目，state 与 dead-end 同为 Content 仅 tag 集合不同；存储=sidecar JSON，Markdown 为人读真相源）。
- **Q3 遍历落地**：§4（入口 Cue 自动提取自已注入材料；两工具 `memory_expand_pre`/`memory_trace_pre`；剪枝=判据确认状态+段类型权重+(tag) 去重+条目帽+轮数提示帽+自判停止）。
- **Q4 优先级**：§5（P0 零代码 → P1 中间件 ~190 行 → P2 sidecar ~240 行 → P3 工具 ~165 行；P0-P1 立即、P2-P3 待拍板）。
- **Q5 边界**：§1/§3.3/§6/§9（无跨目标依赖边；零代码搬运；Tag 确定性映射优先；固定边界零每轮击穿）。
