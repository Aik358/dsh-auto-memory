# 轨二调研 R1/R2 — 每轮注入成本逐项实测 + 分档注入节奏评估

> 调研类型：**只读**。本轮未修改 `lib/` 与 `tests/` 下任何文件，未 commit/push，未重启宿主。
> 探针脚本：`.vision-tmp/inject-probe-0{1,2,3,4,5}-*.mjs`（前缀 `inject-probe-`）。
> 日期：2026-09-22 ｜ 执行：docs-hermetic（task-11）

## 0. 口径与证据来源（先看这一节，避免把结论当估算）

| 项 | 结论 |
|---|---|
| **数据源（最强证据）** | `~/.dsh/sessions/--D-dsh-auto-memory--/**/session.v3.jsonl.zstd` —— 会话记录里保存的就是**真实发给模型的 messages**。把其中的 `<memory_system>…</memory_system>` 段原样切出来量长 ⇒ 得到的是**真值字节**，不是重算、不是估算。 |
| **容器格式** | 该 `.zstd` 是**多帧 zstd 追加流**（5.5 MB 文件 = 1,049 帧）。`zlib.zstdDecompressSync(整个文件)` 只解**第一帧**（274 字符的 session header），必须逐帧解（见探针 02/04 的 `decodeAll()`：从偏移处向后扫魔数 `28 b5 2f fd`，**取第一个能成功解压的候选边界**，截断帧必然报错从而自动跳过假阳性）。 |
| **分段口径** | 用各段**标题行**在块内的出现位置切分（标题来自 `DEFAULT_PROMPT_LAYERS` / 规则段常量），段长 = 下一标题位置 − 本标题位置。 |
| **token 口径** | 仓内唯一估算器 `lib/tier0-catalog-pre.js:135` `estimateTokensPre(text,{mode})`：`repo` 口径 = `ceil(字符/4)+4`；**保守口径（默认）= `max(ceil(字符/2), repo)`**（`tier0-catalog-pre.js:140-143`）。本报告凡标「≈N token」一律用**保守口径**，即 `ceil(字符/2)` 封顶。 |
| **比例分母** | `injectBudgetChars`，本机 = **8000**。 |

## 1. R1 — 逐项实测每轮固定注入成本

### 1.1 复现命令

```bash
node .vision-tmp/inject-probe-04-sections.mjs            # 逐段量长（真值块）
node .vision-tmp/inject-probe-04-sections.mjs --dump=.vision-tmp/inject-probe-blocks.txt   # 导出原始块
```

### 1.2 实测结果（原始输出片段，未改动）

```
distinct blocks: total=195 full=181 slim=14

=== FULL  683b1987-5b2:L1956 | 18291 chars | 占 budget(8000) = 228.6% ===
  frame-head                     16 chars
  frame-meta(记忆定位)              211 chars
  rules-section(规则)            7634 chars
  tier0-catalog(索引)            1249 chars
  whiteboard-plan(白板)          1112 chars
  handoff-ledger(账本)            782 chars
  recent-logs(日志)              780 chars
  reflection(反思)                529 chars
  user-memory(用户级)             1670 chars
  project-notes(项目笔记)          1706 chars
  external-memory(外部记忆)         817 chars
  calendar(日历)                  648 chars
  frame-inscription(铭文)        1137 chars

=== SLIM  683b1987-5b2:L1925 | 9886 chars | 占 budget(8000) = 123.6% ===
  frame-head                     16 chars
  frame-meta(记忆定位)              211 chars
  rules-section(规则)            7414 chars
  tier0-catalog(索引)            1249 chars
  whiteboard-plan(白板)           468 chars
  handoff-ledger(账本)             253 chars
  slim-note(精简说明)               110 chars
  recall-note(唤回声明)             165 chars

Δ(full - slim) = 8405 chars
```

### 1.3 逐项成本表

| 段（kind） | 桶 | 完整版 | 精简版 | 入队优先级 | 精简版是否在场 | 每轮在场？ |
|---|---|---|---|---|---|---|
| `frame-head` `<memory_system>` | otherDynamic | 16 | 16 | must | ✅ | 恒在（不可关） |
| `frame-meta` 记忆定位 | otherDynamic | 211 | 211 | normal | ✅ | 恒在（不可关） |
| **`rules-section` 规则段** | **rules** | **7,634** | **7,414** | normal（桶=rules ⇒ 不参与裁剪） | ✅ | **恒在** |
| **`tier0-catalog` 索引** | memoryReferences | **1,249** | **1,249** | normal | ✅ | **恒在** |
| `whiteboard-plan` 白板 | memoryReferences | 1,112 | **468** | normal | ✅（额度 400） | 恒在（额度不同） |
| `handoff-ledger` 账本 | memoryReferences | 782 | **253** | normal | ✅（额度 300） | 恒在（额度不同） |
| `recent-logs` 日志 | memoryReferences | 780 | — | low | ❌ | 仅完整版 |
| `reflection` 反思 | memoryReferences | 529 | — | normal | ❌ | 仅完整版 |
| `user-memory` 用户级 | memoryReferences | 1,670 | — | **must** | ❌ | 仅完整版 |
| `project-notes` 项目笔记 | memoryReferences | 1,706 | — | **must** | ❌ | 仅完整版 |
| `external-memory` 外部记忆 | otherDynamic | 817 | — | normal | ❌ | 仅完整版 |
| `calendar` 日历 | otherDynamic | 648 | — | normal | ❌ | 仅完整版（精简版默认剔除，见 `:5620-5633`） |
| `frame-inscription` 铭文 | otherDynamic | 1,137 | — | **must** | ❌ | 仅完整版 |
| `slim-note` 精简说明 | （slim 专有） | — | 110 | — | ✅ | 仅精简版 |
| `recall-note` 唤回声明 | （slim 专有） | — | 165 | — | ✅ | 仅精简版 |
| **合计** | | **18,291** | **9,886** | | | |

**占 `injectBudgetChars`(8000) 比例**：完整版 **228.6%**；精简版 **123.6%**。

### 1.4 三个「每轮固定成本」的关键数：规则段 / Tier-0 / 白板+账本

- **规则段**：完整 7,634 / 精简 7,414 字符 ⇒ 保守口径 **≈3,707 token**（精简 ≈3,817? 见下注）。
  ⚠️ **待复核数字「规则段 6,214 字符 ≈ 3,107 token」与本次实测不符**：实测 7,414–7,634 字符（差 ~1.2–1.4k 字符），原因是规则条目在两次采样之间**又长了**（用户级记忆条目持续追加；两次采样同为今日不同轮次）。token 换算无误：`6,214/2 = 3,107` ✅ 与保守口径一致 —— **差异在字符数本身，不在换算口径**。判定：**换算口径 3,107 可信；字符数 6,214 已过期**（本轮实测 7,414–7,634，取精简版 7,414）。
- **Tier-0 目录段**：实测 **1,249 字符**（含标题行）。插件自报「实计 385/400 token」= **目录正文**的保守估算（对应正文约 770 字符 × 1/2）。⇒ 两个数**量程不同**（1,249 含标题/说明行；385 只算正文），不是矛盾。**推断**：385 与 770 字符自洽，故 token 口径为 `字符/2`。
- **白板 + 账本**：完整 1,112 + 782 = **1,894**；精简 468 + 253 = **721**。截断额度经实测确认：完整版 `handoffPlanChars` 1200 / `handoffLedgerChars` 800（`:5925-5927`）、精简版 `slimPlanChars` 400 / `slimLedgerChars` 300（`:5615-5617`）—— 实测 468/253 均**小于**其额度上限，说明当前 PLAN/账本原文本身没顶到额度（白板 1,112 也未顶到 1,200）。

### 1.5 「精简 vs 完整」差额（真值，非估算）

| 对比项 | 值 |
|---|---|
| 完整块 | **18,291 字符** |
| 精简块 | **9,886 字符** |
| **Δ** | **8,405 字符**（≈4,203 token，保守口径） |
| 占 budget | 完整 228.6% → 精简 123.6% |
| 每 5 轮的均值（1 完整 + 4 精简） | **11,567 字符/轮**（≈143.5% budget） |

### 1.6 ★ 口径纠正：`envelopeMeta` **不满足**「差额一律取 envelopeMeta 权威值」这一要求（附代码证据）

1. **`envelopeMeta` 只在完整版路径上产生**：它由 `renderMemoryDynamic` 在 `lib/index.js:5943-5956` 写入 `this.state.envelopeMeta`。
2. **精简版路径完全不产生 `envelopeMeta`**：`renderSlimSnapshotPre`（`lib/index.js:5570-5646`）是**纯字符串拼接**（`out` 数组 → `neutralizePromptTemplateVars(head + meta + parts + tail)`），**没有** `composeMemoryEnvelopePre` 调用、不写任何 meta。⇒ **精简版的逐段账本在代码层面就不存在**。
3. **`envelopeMeta` 也没有任何对外可读通道**：全 `lib/` 检索 `envelopeMeta` 仅命中 `lib/index.js:5943` 与 `:5959`（写入点与注释），**无路由、无落盘、无日志**。⇒ 调研者无法从运行中的宿主读回它。

**替代口径（本报告采用）**：真实会话记录里的 `<memory_system>` 原文 —— 它比 `envelopeMeta` **更强**：`envelopeMeta.chars` 量的是「入队文本」，而会话记录量的是**真的发出去的字节**（含 `frame-inscription`/`frame-tail` 与降级标注行）。两者在完整版上口径一致（都覆盖全部入队段），但会话记录是端到端真值。**建议**：若要长期可观测，需给 `renderSlimSnapshotPre` 补一本 meta（当前没有），并把 `envelopeMeta` 挂到某条只读路由上。

## 2. R2 — 分档节奏该不该改

### 2.1 节奏的实测确认（不是转述前提）

宿主 diag 真值（`~/.dsh/storages/session_projcache/sessions/*.json`，探针 05）：

```
[session-85a450af-…json] 1773505 B | raw hits=2 | distinct=1
  turns where FULL was forced: turn:41
  labelled 真人=0 | 无真人消息=1
```

⇒ **实测支撑**：「人发的必然全量 + Agent 自跑每 5 轮一次全量、其余精简」与代码路径一致：`lib/index.js:10297-10317` 以 `turnBoundaryKeyPre(agent)` 的 turn 号判「新 turn」，每 turn 只强制一次（`st._humanFullKey` 去重），其余轮走 `:10288` 的 `renderSlimSnapshotPre`。

### 2.2 先说成本结构（决定"改节奏"值不值）

| 量 | 字符 | 说明 |
|---|---|---|
| 完整版 | 18,291 | 100% |
| 精简版 | 9,886 | 54.0% |
| Δ | 8,405 | 省下的部分 |
| **精简版中「必须在场」的两段：规则段 + Tier-0** | **8,663** | **= 精简版的 87.6%**；= 完整版的 47.4% |
| 每轮均值（1×完整 + 4×精简） | 11,567 | 143.5% of budget |

⇒ **实测支撑**：分档**已经在省**，但它省掉的是"证据层"（日志/反思/用户级/项目笔记/外部/日历/铭文 7 段共 7,888 字符），省不掉"约束层"（规则+Tier-0 8,663 字符）。**降低完整版频率的收益上限因此很低**：把周期从 5 轮拉到 10 轮，每轮均值 11,567 → 10,727，**只省 840 字符/轮（≈7.3%）**。

### 2.3 如果改节奏，会破掉哪些既有纪律（点名）

| # | 纪律 | 现状证据 | 改「更稀疏/整块跳轮」的后果 |
|---|---|---|---|
| **a** | **规则段「每轮无条件注入且不裁剪」** | 桶级豁免：`lib/memory-envelope-pre.js:119-121` `if (b === 'rules') return null`；显式传限也被忽略并留痕 `rulesIgnored`（`:131-136`）。P6A 裁定写在 `lib/index.js:5757-5762`「本段**不受 gap 约束、不参与裁剪**」 | **直接复现已被修掉的老 bug**。`:5758-5760` 逐字记录了病因 B：「`snapshotMinGapRounds` 使规矩在第 2–5 轮**不在场**（模型不是不听话，是没收到）」⇒ 再降频就是把这条病重新种回去 |
| **b** | **每轮维护白板的可行性** | `lib/index.js:5605-5613`（用户裁定）：白板与账本**必须进精简版**，理由「不把 PLAN/账本放进精简版，模型在 2–5 轮就看不见自己该更新什么」 | 白板被移出精简版 ⇒ 模型在 2–5 轮重新"看不见白板" ⇒ 白板首建/重写纪律失效（与 2026-09-22 刚落地的白板自动首建四条纪律冲突） |
| **c** | **水位提醒 / 收尾写账本的触发条件** | `plan-update-request`（`:5838`）与 `water-advisory`（`:5845`）都是**完整版路径**产生的 must 段；水位门是"越阈 + 10 分钟新鲜度"（`:5844`），且 `renderPlanUpdateRequest()` 是一次性索取（取到即置位，`:5835`） | 完整版频率下降 ⇒ 这两段最多**滞后 N 轮**才出现。水位越阈→官方压缩往往只有几十轮窗口 ⇒ 可能整段错过，"提醒写账本"的兜底失效 |
| **d** | **Tier-0 的常驻指引作用** | `lib/index.js:5814-5818`：目录层每轮在场是刻意设计（「先读索引，再决定深入哪一页」） | 降频/移除 ⇒ 模型失去"有什么记忆"的常驻感知，跨工作区 recall 的触发率下降（**推断**：本轮未测 recall 命中率） |
| **e** | 前缀缓存友好性 | `lib/index.js:5967`：静态 system prompt 保持字节稳定 = 缓存锚；动态块追加在尾部 | 完整版更稀疏 ⇒ 尾部字节变动次数减少 ⇒ **理论上**更省（**推断**，本轮未测 cache 命中率） |

### 2.4 结论

**实测支撑的三条**：
1. 现有分档**有效且已生效**（diag 真值 + 代码路径一致）；「人发全量、自跑 5 轮一次」前提成立。
2. **降完整版频率的收益上限 ≈7.3%/轮**（5→10 轮），因为恒定成本是规则段+Tier-0（8,663 字符，占精简版 87.6%）。
3. 分档能省的只有"证据层"；「约束层」按设计**不能省**（a/b/c/d 四条纪律都钉在这里）。

**推断（需实测才能升级为结论）**：
4. 真正的降本方向是**结构降本**而非降频：① 规则段瘦身（7,414 字符是最大单段，且随用户级记忆持续增长 —— 本轮实测已比待复核数字多 ~1.2k 字符）；② Tier-0 目录再压（当前 1,249 字符/385 token 并未顶到 B0=800 的契约上限，说明**目录内容**而非账本是瓶颈）；③ 把 `renderMemoryDynamic` 里非恒需的段做成"按需/按命中注入"。
5. **must 段应脱离"完整版专有"**：把 `plan-update-request` / `water-advisory` 的**评估**提到每轮（即使精简版也评估，触发时插一行短提示），可修掉 2.3-c 的滞后缺陷 —— 这是本轮唯一发现**既降本又增强**的改动方向。

**明确不建议**：把 `<memory_system>` 整块改成"每 N 轮注入一次"。它同时破 a/b/c/d 四条纪律，且省不到 10%。

## 3. 待复核数字的逐条核对

| 待复核说法 | 本轮实测判定 |
|---|---|
| 规则段 6,214 字符 ≈ 3,107 token | **换算口径正确**（保守 `字符/2`：6,214/2 = 3,107 ✅）；**字符数已过期** —— 本轮实测 7,414（精简）/ 7,634（完整） |
| Tier-0 实计 385/400 token | **成立，但与 1,249 字符不是同一量程**：385 ≈ 目录**正文**（约 770 字符 × 1/2），1,249 是**含标题行的整段**。两者不矛盾（**推断**：口径一致、量程不同） |
| 白板截断 1,200 / 账本截断 800 | **成立**（`lib/index.js:5925-5926`；精简版 400/300 见 `:5615-5617`）；实测两者**均未顶额**（1,112 / 782） |
| `injectBudgetChars` 是可见性阈值、不是硬门 | **实测支撑**：budget 只用于 ①推导 `sub` 再合成分项上限 `memRefLimit`（`:5747`/`:5855`/`:5927`）②写入 `envelopeMeta.budget` 作"合计是否超预算"的可见性（`:5938-5940`/`:5952`）。**没有任何一处**拿 `chars.total` 与 budget 比较后丢段；丢段由分项 limit + priority 决定（`memory-envelope-pre.js:152-210`） |
| `rules` 桶不参与裁剪 | **实测支撑**：`lib/memory-envelope-pre.js:120-121`（`limitOf('rules') → null`）+ `:131-136`（显式上限被忽略并记 `rulesIgnored`） |

## 4. 不确定项与下一步建议

1. **采样代表性**：FULL/SLIM 各取 1 块（同一会话相邻两轮）。规则段随用户级记忆增长而单调变长 ⇒ 字符数会随时间漂移，**结论的"比例"稳定、"绝对值"需定期重测**。
2. **`envelopeMeta` 原值本轮无法读回**（无路由、无落盘，见 §1.6）。我用端到端真值替代；若必须取 meta 原值，需要给宿主加只读投影（**属改动，本轮禁止**）。
3. **精简版在代码层没有分项账本**：`renderSlimSnapshotPre` 不调 `composeMemoryEnvelopePre`、不写 meta ⇒ 精简版的成本只能靠会话记录反推。**建议补一本**（低成本、纯增量）。
4. **token 数是插件自估**（`estimateTokensPre` 保守口径），非真实 tokenizer 计数；保守口径系统性偏大，真实差异可能 −30%（**推断**）。
5. **未跑全量回归**：本轮探针全部只读、未改 `lib/`/`tests/`，按任务描述「仅在确认探针没破坏现状时跑一次」——因仓库内有其它 agent 在用机器，为避免并发假红未跑；如需我补跑，请指派。
6. **建议的下一步（按性价比排序）**：① must 段逐轮评估（§2.4-5，改 1 处条件）；② 给精简版补 meta（可观测性）；③ 规则段瘦身方案（需用户拍板，因为它是"用户级硬约束"层）。

## 附录 · 探针清单与复现命令

| 探针 | 作用 | 命令 |
|---|---|---|
| `inject-probe-01-transcript.mjs` | 初次尝试（单帧解压，**失败留档**：多帧容器只解第一帧） | `node .vision-tmp/inject-probe-01-transcript.mjs` |
| `inject-probe-02-frames.mjs` | 多帧解压 + 块提取（**失败留档**：候选边界须"首个可解压者"，非"首个报错即停"） | `node .vision-tmp/inject-probe-02-frames.mjs` |
| `inject-probe-03-structure.mjs` | 容器结构判定（魔数计数 1,043 / 首帧 274 字符 / streaming 只给首帧） | `node .vision-tmp/inject-probe-03-structure.mjs` |
| **`inject-probe-04-sections.mjs`** | **R1 主证据**：真实注入文本逐段量长 | `node .vision-tmp/inject-probe-04-sections.mjs [--dump=…]` |
| `inject-probe-05-cadence.mjs` | R2 主证据：分档节奏 diag 真值 | `node .vision-tmp/inject-probe-05-cadence.mjs` |

> 全部探针只读：只读 `~/.dsh/sessions/**`、`~/.dsh/storages/session_projcache/**`、`lib/*.js`（源码取证），写盘仅限 `.vision-tmp/` 与 `docs/internal/`。
