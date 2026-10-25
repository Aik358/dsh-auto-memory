# v4 总施工细则（MASTER PLAN）· 2026-10-24

> **这份文档是四份文档合并后的唯一施工依据。**
> 输入：SPEC-v2（883 行·决策真源）/ OUTLINE（488 行·改动面勘察）/ CONSTRUCTION-DOC（805 行·施工细则）/ INJECTION-PLAN（357 行·注入面+接续链实测）
> 合并后：**去重 + 消解 4 处冲突 + 补齐顺序/依赖/验收/回滚**。四份原件全部保留在原位，可回溯。
> 阶段定位：**方案阶段，lib/ 与 tests/ 零改动**（`git status --porcelain -- lib tests` = 0 行，HEAD = `a53560e`）。

---

# §0 · 这份文档怎么用

## 0.1 四份输入的权威分工（冲突时按此裁决）

| 输入 | 权威范围 | 冲突时 |
|---|---|---|
| **SPEC-v2**（883 行） | 设计取舍、裁定 1–30 | **「为什么这么做」以它为准** |
| **OUTLINE**（488 行） | 改动面、行号基线、R12 教训 | 「改哪些文件」以它为准 |
| **CONSTRUCTION-DOC**（805 行） | 可粘贴代码、工具注册、Prompt、存量三件套 | 「怎么改」以它为准 |
| **INJECTION-PLAN**（357 行） | 注入面分区、截断方向、接续链 5 点 | **「注入/接续怎么改」以它为准**（它是最新实测） |
| **本文档** | 顺序、依赖、验收、回滚、冲突消解 | **顺序与验收以本文档为准** |

**一条总规则**：四处冲突一律**取实测值**，不取早期估算。冲突消解记录见 §9。

## 0.2 起点干净判据（三条全过才动手）

```
cd D:\dsh-auto-memory
git status --porcelain -- lib tests     # 期望：0 行
node tools/verify-docs.mjs              # 期望：工具 19 · 路由 73 · 配置键 160 · 全绿
node artifacts/wb-event-preview/verify.mjs   # 期望：全绿（不写死语料的版本）
```

**实测基线（2026-10-24 13:34 复核）**：

| 项 | 值 |
|---|---|
| HEAD | `a53560e`（v3.3.17 回写） |
| 分支 | `dev` |
| 工具 / 路由 / 配置键 | **19 / 73 / 160** |
| `lib/` 改动 | **0** |
| `tests/` 改动 | **0** |
| smoke 套件 | 443 |

---

# §1 · 拍板清单（12 项，8 阻塞 + 4 不阻塞）

> **你只需回复「D1–D12 全部按建议」或指出要改的那几项。**

## 1.1 阻塞开工（批次 0，合计约 25 分钟）

| # | 要决定什么 | 我的建议 | 理由 |
|---|---|---|---|
| **D1** | 事件落盘文件名 | **`event-store.json`** | `handoff/events.jsonl` 已被 sidecar 事件链占用（`appendSidecarEventPre` @ index.js:4099）；与 `facts.json`/`episodes.json`/`procedures.json` 同构 |
| **D2** | 事件 ID 前缀 | ~~`evt_pre_`~~ → **`evt_`**（D2 最终值见 §1.3） | 用户裁定：新代码不带 pre |
| **D3** | boardMode 新档值 | **`'event'`** | 与 `legacy`/`graph` 同样简短，语义直白 |
| **D4** | 是否新建 skin 包 | **否** | `skins/v4/` 已被 2026-09-27 的第三方皮肤包占用；走 client.js 内 `boardMode==='event'` 分支 |
| **D5** | 事件 API 前缀 | **`/api/dsh-auto-memory/event-*`** | 与既有 73 条路由同前缀 |

## 1.2 在各批之前定（不阻塞开工）

| # | 要决定什么 | 我的建议 | 理由 | 何时 |
|---|---|---|---|---|
| **D6** | Tier-0 事件目录放哪 | **(b) 另开 `event-catalog` 段 ≤400 字符** | 实测 Tier-0 只剩 **4 token**（396/400）；改 B0=800 要动 18 个断言；(c) 会把 user 层从 1 条压到 0 | 批次 1 前 |
| **D7** | `frame-inscription` 分项归属 | **挪进 `rules` 分项** | 它带 `must` 却落在无上限的 `otherDynamic`，语义与保护等级矛盾 | 批次 3 前 |
| **D8** | user-memory / project-notes 撤多少 | **先普查再定**（30 min） | 规则抽取器只认 `- ` 行；段落型约定抓不到，直接撤会真丢内容 | 批次 3 前 |
| **D9** | 「未归档」口径 | **A：只算四段账本（~322 篇）** | 321 篇机械产物（PLAN 快照/转写）进审理队列没意义 | 批次 4 前 |
| **D10** | 审理批大小默认 | **40 篇** | ≈2.7 万输入 token，1–2 分钟，可控 | 批次 4 前 |
| **D11** | 草案确认粒度 | **逐条确认 + 批量「全部接受 high」并存** | 兼顾安全与效率 | 批次 4 前 |
| **D12** | 前端要不要第二个执行体 | **要 3 天完成就派人并行** | 并行省 1 天；串行则 ≈4 天，顺序与验收不变 | 开工前 |

## 1.3 ★拍板结果（2026-10-24 拟合会话，已定）

> 12 项全部拍完。以下为**最终值**，§1.1 / §1.2 的建议列已被本节覆盖。

| # | 决定 | **最终值** | 备注 |
|---|---|---|---|
| **D1** | 事件落盘文件名 | `event-store.json` | 按建议 |
| **D2** | 事件 ID 前缀 | **`evt_`（不带 pre）** | ⚠ 用户裁定：新代码不带 pre，旧代码不动 |
| **D3** | boardMode | **只留 `'event'` 单档** | ⚠ 用户新增裁定：legacy/graph 代码路径退场；config 保留不可见兜底值 |
| **D4** | skin 包 | 不新建 | 按建议 |
| **D5** | 事件 API 前缀 | `/api/dsh-auto-memory/event-*` | 按建议 |
| **D6** | Tier-0 事件目录 | **另开 `event-catalog` 独立段 ≤400** | 按建议 |
| **D7** | 铭文分项 | **挪进 `rules`** | 按建议 |
| **D8** | user-memory/project-notes | **先普查再定** | 按建议（30 min） |
| **D9** | 未归档口径 | **A（只算四段账本）** | 按建议 |
| **D10** | 审理批大小 | **40** | 按建议 |
| **D11** | 草案确认粒度 | **逐条 + 批量接受 high** | 按建议 |
| **D12** | 执行体 | **Lead 串行后端 + 子代理并行前端** | 前端须先全面测绘再动工 |
| **D13** | 旧看板 6 组件（708 行） | **能删就删，尽量精简** | ⚠ 2026-10-24 第二轮：撤销「保留不接线」。理由（用户原话）：「复杂容易出错」 |
| **D14** | **Q1 正式裁定（2026-10-24 20:0x 用户拍板）** | **采纳方案 (a)**：①**删除看板 6 组件**（实测 **522 行**，非文档的 708/902）；②**下线 `graph` 档**（boardMode 只剩 `event`，legacy 保留为 fail-safe 不进 UI）；③**追加裁定**：**「以后点击『白板看板』这个页签进去，只保留现在最新的、以事件为中心的内容」** ⇒ 白板页签 = **事件视图**，且**只展示最新**的事件（不铺全量历史）。 |

### 1.3.1 D3 带来的连锁（必须同步改）

⚠ **boardMode 退场到只剩 `event` 单档** 是本轮最大的范围变化。原方案里「legacy/graph 逐字节不变」这条最难的约束**直接消失**，但新增了以下改动：

| 要改的地方 | 现状 | 改动 |
|---|---|---|
| `lib/board-mode.js` | `BOARD_MODES_PRE_V1 = ['legacy','graph']`（31 行） | 改为 `['event']` + 保留 legacy 作 fail-safe（不进 UI） |
| 设置页 3 处副本 | 8187 / 12719 / 16056 / 19185 各一处三目 | 从「二选一」改为「单档展示」 |
| 看板组件 6 个 / 708 行 | KanbanDrawerBody / Card / BoardRail / Board / MatrixCard / View | **删除**（D13 拍板：能删就删，尽量精简） |
| `vendor/dsh-graph/` 191 个文件 | graph 档专用 | 不再接线（但**不删**，将来若要 graph 还能接） |
| 涉及 boardMode/legacy/kanban 的测试 | **102 个** | 逐条改为「event 单档」预期 |
| 验收项 V25（原 F-1「legacy/graph 逐字节不变」） | 现在无意义 | **改为「event 单档渲染基线锁」** |

### 1.3.2 前端：用户要求「先全面测绘再动工」

> 用户原话：「前端确实太复杂了。你需要通过记忆，或者通过一些别的系统、项目文档，来全面地了解现在前端的状态。目前前端有生成器，也有不同的皮肤要求，还有一些历史欠账。必须得先看明白，然后才动工。」

**已完成的前端测绘（实测，非文档抄）**：

| 项 | 实测值 |
|---|---|
| `client.js` | **19,753 行 / 2.32 MB / 纯 CRLF**（bareLF = 0） |
| 三区边界 | 旧款冻结块 `10804–13287`（内嵌 `10810–13282`）/ 主生成块 `13288–16697` / **手写区** `1–10803` + `16698–19753` |
| 生成器 | `tools/build-iter5-skin.mjs` 954 行；`--check --strict` = **SYNC-OK** |
| 四档皮肤 | `classic`（1 文件）/ `iter5`（25 文件，生成源）/ `legacy`（1 冻结副本）/ `v4`（3 文件，第三方包） |
| 守卫面 | **136 / 443** 个 smoke 读 client.js |
| 三把必看的锁 | `smoke-test-iter5-skin`（守经典档 sha）/ `smoke-test-settings-parity`（三面键集）/ `smoke-test-r26-cross-layer`（index.js sha 前 16 位） |
| 设置页副本 | `boardMode` 三目同一串出现 **4 次**（8187 / 12719 / 16056 / 19185） |

**前端改动落点决策树（按技能库 mem-skill-dsh-auto-memory-73fe8ffada24）**：

| 改动性质 | 改哪里 | 要不要重跑生成器 |
|---|---|---|
| 只影响经典档 | `lib/client.js` **手写区**（1–10803 / 16698–19753） | 不用 |
| 影响 iter5 皮肤 | `skins/iter5/*` 源 | **必须**重跑 |
| 两档共用（如设置页） | 手写区 **+** 重跑生成器 | 要 |
| 三面共有控件 | 还要补 `skins/legacy/iter5-325.js.frozen` | 否则 settings-parity 红 |

**前端的两项待定（拟合 4 轮上限未问完，见 §1.3.3）**

### 1.3.3 两项待定 —— 已于 2026-10-24 第二轮由用户裁决

| # | 问题 | 裁决 |
|---|---|---|
| **F-Q1** | 旧看板 6 个组件（708 行）怎么处置 | **删除**（D13）。用户原话：「看板的组件能删就删，尽量精简，不要复杂，复杂容易出错」 |
| **F-Q2** | 前端测绘够不够动工 | **不够，动工前必须重新测绘一遍**。用户原话：「等到改前端的时候，确实是需要再测绘一遍具体情况的」 |

### 1.3.4 ★2026-10-24 第二轮裁决（用户口头，优先级高于 D1–D13 之间的任何冲突）

> 本节是**新的一等输入**，与 §1.1/§1.2 冲突时以本节为准。来源：用户在「开工」指令同轮的追加说明。

| # | 裁决 | 用户原话 | 对计划的影响 |
|---|---|---|---|
| **R0** | **先修 memory_recall 可用性，再谈效果** | 「它不是效果好不好，而是有时候调不起来，这个也做到排查的其中之一，先把这个功能修好，再谈效果如何」 | **提到所有批次之前**，成为第 0 优先。原 P1/P2/P3 的「效果」部分全部后移 |
| **R0-2** | 失败面含**超时** | 「主要是你之前有一次超时」 | 必须查宿主工具调用超时面 + 每个 scope 的耗时上界 |
| **D13** | 看板组件能删就删 | 「看板的组件能删就删，尽量精简，不要复杂，复杂容易出错」 | F 线由「退场」升级为「删除」，工时待重估 |
| **F-Q2** | 前端动工前**重新测绘** | 「等到改前端的时候，确实是需要再测绘一遍具体情况的」 | F 线开工前加一次测绘（≈2h），并入 F |
| **S1** | 语义引擎有待升级（BGE-M3 / multilingual-e5） | 「这个语义引擎，比如 BGM3 和 multilingual 15，是有待升级的」 | 归入**唤回引擎改造**代号 R1，在 R0 之后、v4 之前或并行 |
| **S2** | 新模型未调好，**先用现有模型占位** | 「现在模型不是还没调好吗？你就先用现有的模型来占位就可以了」 | R1 第一版 = 只做**可插拔接口**，权重不动；接口契约必须能换模型 |
| **P1** | 每轮设 goal + plan，实时更新文档 | 「你立好规矩，每轮都可以设置一个 goal 和一个 plan，并且都需要看项目文档，实时对项目文档进行更新」 | 已落地：goal `goal-5cae684b`；每轮读写本文档 |
| **P2** | 可派子代理/团队成员减少上下文稀释 | 「可以派子代理和智能体团队里的团队成员」 | 已落地：只读研究类任务全部外派 |
| **P3** | 出现情况随时报告，由用户决定 | 「如果出现了一些情况，记得随时来报告我，由我来决定」 | 停手信号见 §7.2，另加「需用户裁决清单」§7.3 |

**R0 / R1 与 v4 的关系（我的建议，待确认）**：R0 必须最先做（它挡着「唤回能不能用」）；R1 只做接口不动权重，可与 v4 的 A–E 批并行；v4 批次 0.5（截断方向修正）本质也是 recall 家族的 bug，建议并入 R0 一起做。

### 1.3.5 ★R0 执行结果（2026-10-24 当日两轮，已闭环）

> 详见 `artifacts/R0-RECALL-AVAILABILITY-2026-10-24.md`（185 行）+ 独立审计 `artifacts/RECALL-AVAILABILITY-AUDIT-2026-10-24.md`（429 行）。

| 轮次 | 修了什么 | 关键数字 |
|---|---|---|
| 第 1 轮 | 失败熔断 10min + 半开 60s + 超时哨兵 6s + 复用 `_wsCache` + `[通道状态]` 说明段 | all/l0 8.9–12.0s → 熔断期内 ≈0.3–0.9s |
| 第 2 轮 | `R0_RECALL_MAX_LIMIT=50`（入口统一夹紧）+ `R0_RECALL_MAX_OUTPUT_CHARS=60000`（带拿全指引）+ HTTP /recall 尊重 `body.format` | `limit=1000+full` 283,596 字符 → ≤60k |

**验收**：新套件 `smoke-test-r0-recall-availability` **45 PASS / 0 FAIL**，八组真行为 + 三条变异负路径实测必红（删熔断 16/3、删自愈 18/1、删夹紧 38/7）。
**全量回归**：444 套件两轮均 **443 PASS / 1 FAIL**；两轮失败套件**不同**且各自单跑均 PASS ⇒ 并行资源竞争抖动，非本批引入。

**审计另找出、但本轮刻意未做的（待用户裁决，见 §1.3.6）**：

| 项 | 证据 | 为什么不现在做 |
|---|---|---|
| **P1-3 中文无空格分词** | handoff 域「白板账本机制」**0 命中** / 「白板 账本 机制」**6 命中** | **效果面**，会改变召回结果；应与 P1 评测集同批 |
| P1-6 `external.search` 预算 | 中位 **492.11ms** 无上限 | 同上 |
| P2-1 六处空 catch / P2-2 台账读驱动写 / P2-4 `withTimeout` 真取消 | 台账本机停在 2026-10-03 ⇒ **「有记录」不能作证据** | 结构性，需单独评估改动面 |

### 1.3.6 待用户裁决（不自行决定）

1. **是否刷新插件做真机复测**（不刷新则 R0 改动不生效，本轮只能证明源码层 + 抽出方法体的真调用）。
2. **v4 是否现在开工**。
3. **审计 P1-3 / P1-6 / P2-* 是否纳入 R0**（尤其 P1-3：用户体感「调不起来」有一大块是「返回 0 条」）。
4. **语义引擎**（见 `artifacts/SEMANTIC-UPGRADE-PATH-2026-10-24.md` 691 行）：sparse 是否先 shadow 双写；接口第一版是否只做形状校验 + 三套超时收敛（Python 8000 / sidecar 5000 / JS 120000 三口径并存）；fp32 档是否只改文档不改代码。

---

# §1.4 ★★2026-10-24 第三轮追加裁定（优先级最高，覆盖本文件此前所有批次安排）

> **背景**：用户 2026-10-24 22:2x 指出本文件与 SPEC-v2 的**核心原则未落地** ——
> 「理论上，现在白板应该会大刀阔斧地改动，因为这是底层的改动，就是所有记忆的单元会从原先的流水账式改成以事件为中心的形式」。
> 核实结论：**用户判断正确**。已完成的 A–G 批建好了**容器**，但**没有做单元迁移**（8 个写记忆工具 0 个接事件层）。
>
> **★代码级施工文档见**：`artifacts/V4-CODE-LEVEL-SPEC-2026-10-24.md`（**652 行 / 29,651 字节**，含 §0 六段判据 + §1 现有代码资产清单（含实测行号）+ §2–§13 逐批代码级改动 + §14 多线并行方案 + §15 验证依据 + §16 交付要求）。
> **架构图**：`artifacts/_diagrams/v4-h-architecture.svg` / `.png`（1560×1260，四层 + 六段判据 + 三步存量转换）。
> **详细排期表见**：`artifacts/V4-H-BATCH-SCHEDULE-2026-10-24.md`（249 行，含 H0–H11 逐批验收判据）
> **施工面见**：`artifacts/V4-UNIT-MIGRATION-SURFACE-2026-10-24-v2.md`（231 行，含 19 个 pushPart 段 + 5 个独立段的逐段迁移表）。
> 本文件的 §5 批次 A–G 视为**已完成的地基**，新增的 H 批（H0–H11）才是底层改造主体。

## 1.4.1 用户本轮五条裁决（全部已定，不再询问）

| # | 问题 | 裁决 |
|---|---|---|
| Q1 | `memory_log` 只写事件 / 双写 / 事件为主+md派生 | **(c) 事件为主 + 日 md 派生**；**每日反思链必须保留** |
| Q2 | 日 `.md` 是否继续生成 | **继续生成，由事件派生**（供反思与 consolidate 使用） |
| Q3 | 白板与事件关系 | **事件的投影视图** |
| Q4 | 项目笔记 | **保留为「项目规约」**（最重要的部分 + 事件格式：可变头 + 只追加尾 + status） |
| Q5 | 旧注入段迁移时机 | **所有新东西建好之后**再迁移；完整版 + 精简版 + 其他全部**量全，不得遗漏** |

## 1.4.2 蒸馏链（用户明确要求保留，不得丢环）

```
每日日志（原料，细碎） → 每日反思（当天蒸馏） → consolidate（多日蒸馏） → 项目规约 / 事件头
```

| 环 | 工具 | 输入 → 输出 | 是否事件化 |
|---|---|---|---|
| ① 原料 | `memory_log` | 每轮工作 → 事件检查点（+ 日视图 `.md`） | **事件是源，md 是投影** |
| ② 日蒸馏 | `memory_reflect` | 当日日志 → `reflections/YYYY-MM-DD.md` | ❌ **不事件化**（蒸馏产物） |
| ③ 多日蒸馏 | `memory_consolidate` | 最近 N 天日志 → `MEMORY.md` | ❌ **不事件化**（蒸馏产物） |
| ④ 规约 | `memory_note(kind=plan)` / `memory_rules` | 长期结论 → 白板 / 规则 | ❌ **保留为项目规约** |
| ⑤ 事件收口 | `memory_event(action=close)` | 一件事做完 → 事件 `outcome` | ✅ |

## 1.4.3 新增批次 H0–H11（底层改造主体）

| 批 | 名称 | 内容 | 依赖 | 估时 |
|---|---|---|---|---|
| **H0** | 工具闸门解耦 | `memory_expand`/`memory_trace` 从 `graphEnabled` 摘下 | 无 | 0.5h |
| **H1** | **写入层统一** | `memory_log` → 事件检查点 + 日视图派生 | H0 | 3h |
| **H2** | 其余写入收敛 | `memory_note(handoff)` → 检查点；`memory_note(plan)` → 事件头投影 | H1 | 3h |
| **H3** | 项目规约改造 | `MEMORY.md` → 规约卡（可变头 + 只追加尾 + status） | **H11 之后（最后）** | 2h | **★用户 2026-10-25 裁定：要做，但排在最后** —— 「确实应该放在最后，然后保证稳定的情况下去做」。前置条件：①全量回归 0 FAIL ②A/C 线不再动 index.js/client.js ③单独批次不并行 |
| **H4** | **四个 percept 接线** | `renderT2Pre` 读四字段 + `commitments` 暴露到工具 + `panels` 渲染 | H1 | 2.5h |
| **H5** | **用户画像段** | 新增 `user-portrait` 注入段（与 rules-section 并列） | H4 | 2.0h |
| **H6** | **问候环节改造** | 问候读事件摘要 + 未完成承诺（现在纯静态，不读记忆） | H4 | 1.5h |
| **H7** | 注入预算重排 | 重算 budget / Tier-0 配额 / 事件段容量（硬前置：现状只剩 341 字，差 12.7 倍） | H1-H6 | 2h |
| **H8** | 注入主结构换事件 | **19 个 pushPart 段 + 5 个独立段逐段迁移** | H7 | 6h |
| **H9** | 检索补完 | `all` scope 含事件 / 事件目录进 Tier-0 / 按事件聚合 | H8 | 2h |
| **H10** | 存量迁移 | 587 日志 + 516 账本 → 事件（分批 + 用户确认） | H9 | 4h |
| **H11** | 全量回归 + 文档同步 | 457 套件 + verify-docs + 7 份文档 | H10 | 2h |

**串行总量 ≈ 30.5h**（不含暂停等用户确认）。**顺序不可跳步**：H1 必须在 H5 之前，否则注入读到空事件 ⇒ 记忆功能直接失效。

## 1.4.4 本轮偏移的根因（防复发）

| 根因 | 对策 |
|---|---|
| 原则只有一句话（「第一等单元：日志→事件」），没有施工细则 | §1.4.3 拆成 H0–H11 十二个可验收批次 |
| 批次表按「容器」组织，不按「数据流」组织 | H 批按**数据流**（写入→注入→检索→迁移）重排 |
| 「量全」没有清单 | 逐段表：**19 个 pushPart 段 + 5 个独立段 = 24 处**，每处都要有迁移结论 |
| 自行判断「某些改动不必要」 | Q1 三方案已向用户解释并裁定；不得再自行取舍 |
| **「只存不用」被当成已完成** | 四个 percept 字段存储已建、注入 0 消费 ⇒ H4 专门接线；问候纯静态 ⇒ H6 专门改造；用户画像无容器 ⇒ H5 专门新建 |

---
# §2 · 涉及哪些方面（七条线 + 两条前导线）

> ⚠ **2026-10-24 第二轮新增前导线**（§1.3.4）：R0 与 R1 排在 A–G 之前 / 之侧，不占 v4 的 26.5h。

| 线 | 名称 | 改什么 | 产出 | 估时 | 归属 |
|---|---|---|---|---|---|
| **R0** | 唤回可用性 | memory_recall 超时/失败面；每 scope 耗时上界；静默降级可见化；并入批次 0.5 截断修正 | index.js 改 3–5 处 + 1 个新诊断模块 | 待 R0 审计出数（预估 0.5–1 天） | 后端（Lead） |
| **R1** | 唤回引擎可插拔 | 语义臂抽象成可换模型的接口；第一版绑现有 e5-small/BGE-M3 占位 | 1 个新模块 + index.js 改 2 处 | 待 SEMANTIC-UPGRADE-PATH 出数 | 后端（Lead） |
| **A** | 数据层 | event-store / event-plan / event-render + index.js 接线 | 3 个新文件（450+180+200 行） | 3.0h | 后端 |
| **B** | 工具层 | 注册 `memory_event`（19→20）+ 11 处计数锁 | index.js +70 | 2.0h | 后端 |
| **C** | 注入面 | 一框三区 + 铭文 4 处 + 2 新段 + **3 个截断方向修正** | index.js 改 8 处 | 4.5h | 后端 |
| **D** | 检索 | `recall(scope='events')` + 事件目录进 Tier-0 | index.js 改 2 处 | 2.5h | 后端 |
| **E** | 接续链 | 5 个必改点 + 2 个新增（carry 事件绑定块） | index.js 改 5 处 | 3.5h | 后端 |
| **F** | 前端 | `boardMode='event'` **单档**（D3）：三视图 + 未归档栏 + 二次确认 + **删除旧看板组件（D13）** + 开工前重新测绘（F-Q2） | client.js +900~1200 / **删 708 行** / 改 102 个测试 | **8.0h + 2.0h 重测绘 = 10.0h** | 前端 |
| **G** | 配置/收尾 | 新配置键 + 设置页 3 处同步 + 回归 + 文档锁 | index.js / client.js / docs | 3.0h | 共用 |

**串行总量 ≈26.5h**（含 0.5 批与缓冲；D3 退场 +1.5h）。**并行后 ≈3.5 个工作日。**
**± 第二轮变化**：D13 由「保留不接线」改为「删除」⇒ F 线内部结构变化（删代码通常比留代码快，但删要连带清理 102 个测试的引用，工时暂按 **不变 8.0h** 保守估计）；F 线开工前**加一次重新测绘 ≈2h**（F-Q2 裁决）。**前导线 R0 / R1 不计入本表**（见上）。

## 2.1 三个「连环锁」（改一个就不止改一处）

| 锁 | 当前值 | v4 后 | 要同步的地方 |
|---|---|---|---|
| 工具数 | **19** | **20** | 4 个 smoke 用例 + 5 份文档 |
| 路由数 | **73** | **+2~4**（event-unarchived / event-curate / 可能 event-list） | 同上 |
| 配置键 | **160** | **+6~8** | 同上 |

**具体 11 处（一处不改就红）**：

```
tests/smoke/smoke-test.mjs
tests/smoke/smoke-test-m3b3*.mjs
tests/smoke/smoke-test-graph-mode.mjs
tests/smoke/smoke-test-p23-wb-sidecar-pre.mjs
tests/smoke/smoke-test-context-observer.mjs
docs/WHITEPAPER.md              §3.1 规模表
docs/HOMEPAGE-CONTENT-FOR-GM53.md
docs/FRONTEND-CO-CREATION.md
README.md
README.zh-CN.md
docs/HANDBOOK.md                §6 工具表
```

**执行顺序（必须按这个序，否则会反复红）**：

> 1. 改代码 → 2. 跑 `node tools/verify-docs.mjs`（它打印实测真值）→ 3. **按它打印的新值**同步上面 11 处 → 4. 再跑一次确认全绿。

## 2.2 前端改动面（实测）

| 项 | 位置 / 数量 |
|---|---|
| `boardMode` 三目分支 | **6 处**（client.js:8187 / 8269 / 8272 / 12719 / 16056 / 19185） |
| 看板组件区 | **6 个组件 / 708 行**（KanbanDrawerBody 5298 / KanbanCard 5305 / KanbanBoardRail 5693 / KanbanBoard 5785 / KanbanMatrixCard 5954 / KanbanView 6005） |
| 数据源 | `/kanban-board` 单路由；event 档需**新增** `/event-list` 或复用（见 §3.3） |
| 设置页 | **3 处完全相同的副本**（12719 / 16056 / 19185）—— 改一处必须改三处 |

**硬约束（用户已固化，不得违反）**：

> ① 禁止对 `lib/client.js` / `skins/iter5/*` 做三方合并或整块替换式重构。
> ② ~~`legacy` 与 `graph` 两档必须**逐字节不变**（sha 比对）~~ ⇒ **已被 D3 作废**：legacy/graph 退场，改为「**event 单档渲染基线锁** + legacy 兜底可用」。
> ③ 前端改动必须跑**真执行 factory 的运行时守卫**（不能只靠 `node --check` 与静态断言）。
> ④ **（2026-10-24 F-Q2 裁决）动工前必须重新测绘一遍**：用户原话「等到改前端的时候，确实是需要再测绘一遍具体情况的」。
>    上次测绘是 2026-10-24 上午，只作**基线**；F 线第一件事是复测（三区边界是否漂移、生成器是否仍 SYNC-OK、四档皮肤是否被人动过、136 个守卫是否仍是 136）。
> ⑤ **（D13）能删就删**：旧看板 6 组件（708 行）走**删除**，不留死代码。删除必须同时清掉 102 个测试里的引用，否则 r26/iter5-skin 的计数锁会红。

---

# §3 · 数据契约（批次 0 冻结，之后不改）

> **冻结理由**：前端 F 线要用 mock 开发，必须先有稳定契约。此节在批次 0 结束后不再变更。

## 3.1 事件对象（**严格 16 个顶层字段**；文档旧称「21 字段」已归因）

> ★**批次 0 实测归因（2026-10-24）**：本节标题原写「21 字段」，但逐个数只有 **16 个顶层键**。
> 21 只在「16 顶层 + 4 个 sections 子键 + 1 个 PANEL_KINDS 注册表」这种**混口径**下成立。
> 按 §0.1「四处冲突一律取实测值」：**契约以 16 为严格可断言值**；21 只作文档口径保留，不作断言。
> 冻结件：`artifacts/v4-contract/event-schema.json`（含 `fieldCountReconciliation` 留档）+ 2 fixture + `verify.mjs`（**25 PASS / 0 FAIL**，含 8 条负路径）。

```
event = {
  id: 'evt_<8hex>',          // D2 最终值：不带 pre（旧代码的 pre 不动）
  name,          // 一句话标题（≤80 字）
  summary,       // 一段话总览（L0，≤400 字）
  outcome,       // 成果（closed 时必填）
  skillRef,      // 是否固化成 skill（null / proc_pre_xxx）
  status: 'active' | 'paused' | 'closed',
  pausedReason,  // status='paused' 时填

  sections: { goal, doing, deadend, next },   // 四段（用户原有结构，不变）

  checkpoints: [{
    at, kind, text,
    sourceRef,   // 指向原账本文件 + 行区间
    panels: [{ kind, text }],   // 六类注册表：state/log/deadend/next/userPercept/commitment
    idemKey,     // 防重试重复追加（append-only 不可撤销）
  }],

  userPercept:  [{ at, kind, stage, text, sourceRef }],
  agentTrace:   [{ at, action, result, wasRefuted, sourceRef }],
  sharedGround: [{ at, claim, confirmedBy, correction, sourceRef }],
  commitments:  [{ at, promise, boundary, state, sourceRef }],
  constraints:  ['rule:<id>', 'spec:<id>'],

  createdAt, updatedAt
}
```

**`stage` 取值**：'retrieved' | 'delivered' | 'used' | 'mentioned' | 'accepted'（来自 2026-10-15 情境化记忆综述 §2.3）
**`panels[].kind` 走注册表**：`PANEL_KINDS = ['state','log','deadend','next','userPercept','commitment']`，新增类型只需注册，不改 event 结构

## 3.2 三档渲染（对齐既有三层契约）

| 档 | 上限 | 内容 | 放哪 |
|---|---|---|---|
| **T0** | 80 字/事件 | name + status | 事件目录（独立段，≤400 字符） |
| **T1** | 140 字/事件 | summary 首句 | Tier-1 命中摘要 |
| **T2** | 2,400 字/事件 | 完整四段 + 最近 3 检查点 | `event-cards` 段（只放 active 1–2 个） |

## 3.3 前端数据契约（F 线 mock 依据）

⚠ **发现一个缺口**：四份文档只定义了 `/event-unarchived` 与 `/event-curate` 两条事件路由，**没有定义「事件列表」读接口**。而 F 线的三视图（时间流 / 泳道 / 工作流线索）必须读全部事件。

**必须先补定（列入批次 0）**：

| 路由 | 方法 | 返回 |
|---|---|---|
| `/api/dsh-auto-memory/event-list` | GET | `{ ok, total, events: [ {id, name, summary, status, sections, updatedAt, checkpointCount} ], nextCursor }` |

- 分页：默认 50/页（与未归档栏同口径）
- 三视图需要**全量**时间轴 ⇒ 支持 `?all=1` 一次返回精简字段（不含 checkpoints 正文，只含 count）
- 检查点正文走 `/event-detail?id=evt_xxx`（点开单个事件时才拉）

> 这三条是我在合并时补的，原四份文档都没有。**请连同 D5 一起确认。**

## 3.4 存储布局

```
<projectDir>/handoff/
  ├─ PLAN.md                  ← v4 退化为「事件板快照」
  ├─ handoff-*.md             ← v4 降为「检查点原文载体」（仍写，但带 eventId 引用）
  ├─ event-store.json         ← 新：事件存储（D1 决定）
  ├─ event-curation-log.jsonl ← 新：审理审计日志（批号/输入清单/sha/子代理输出/人工决定）
  └─ index.json               ← 既有 sidecar（graph 档用，event 档不复用，避免撞车）
```

**并发保护**：与 `facts.json` 同族做法 —— `tmp → rename` 原子写（`index.js:3280` 已验证该范式）。


---

# §4 · 执行顺序与依赖（核心）

## 4.1 依赖图

```
【批次 0】拍板 12 项 + 冻结契约（15 min，0 代码）
     |
     +------------------------+--------------------------+
     |                                                   |
【批次 0.5】截断修正                                  【批次 A】数据层（3h）
  1.5h · 完全独立 · 与 A 无先后                              |
  可先可后，只共享「跑一遍 verify-docs」                     +--------+--------+--------+
                                                            |        |        |        |
                                                          【B】    【C】    【D】    【E】
                                                          2h      4.5h     2.5h     3.5h
                                                        工具层   注入面   检索    接续链
                                                            |        |        |        |
                                                            +--------+--------+--------+
                                                                     |
                                                          【批次 F】前端（6.5h）
                                                          ★ 只依赖 A 的契约，可与 B/C/D/E
                                                            全程并行（用 mock fixture）
                                                                     |
                                                            【批次 G】收尾（3h）
                                                            全量回归 + 锁同步 + 发版预检
```

## 4.2 硬依赖矩阵

| 线 | 硬依赖 | 软依赖（可 mock/可后补） | 能否并行 |
|---|---|---|---|
| **0.5 截断修正** | **无** | 无 | ✅ 可与 A 同时/先后任意 |
| **A 数据层** | 批次 0 契约 | 无 | 串行第一步 |
| **B 工具层** | **A** | 计数锁可最后统一补 | ❌ 必须等 A |
| **C 注入面** | **A**（事件部分）；**无**（截断修正部分） | B 的 `memory_event` 描述文案 | C 的截断修正已拆到 0.5 |
| **D 检索** | **A + C** | 语义臂可占位（现有引擎） | ❌ 必须等 C |
| **E 接续链** | **A + B + C** | 无 | ❌ 必须等 C |
| **F 前端** | **A 的契约（mock）** | 真实路由可最后联调 | ✅ **与后端全程并行** |
| **G 收尾** | **C + E + F** | 无 | ❌ 最后 |

## 4.3 三工作日排期

### 方案一（推荐）：两个执行体并行

| | 后端线（串行） | 前端线（并行） |
|---|---|---|
| **第 1 天** | 批次 0（15min）→ 0.5 截断修正（1.5h）→ **A 数据层**（3h）→ **B 工具层**（2h）→ buffer | 读契约 → 搭 mock fixture → 三视图骨架 |
| **第 2 天** | **C 注入面**（4.5h）→ **E 接续链**（3.5h） | **F 前端** 主体（8.0h，含 D3 退场） |
| **第 3 天** | **D 检索**（2.5h）→ **G 收尾**（3h） | 收尾 F + **联调 1h** |

**关键路径**：0 → 0.5 → A → B → C → E → D → G ≈ **19h + 缓冲 5h = 24h**

### 方案二：只有一个执行体（串行）

> 0 → 0.5 → A → B → C → E → D → **F** → G ≈ **≈30h / 4 个工作日**
> **顺序与验收完全不变**，只是把 F 从并行挪到 E 之后。

## 4.4 每天收工前的三条必跑

```
node tools/verify-docs.mjs      # 工具/路由/配置键三值是否同步
node tools/run-smoke.mjs        # 443 套件全量
git status --porcelain -- lib tests   # 确认改动范围符合预期（不多改）
```

**任一红 ⇒ 当天不推进下一条线，先归因**（真缺陷 / 判据过期），**严禁「整批回滚」**（用户 2026-10-01 裁定）。

---

# §5 · 每批施工细则

## 5.1 批次 0 · 拍板 + 冻结契约（15 min，0 代码）—— ✅ **已完成 2026-10-24**

**做什么**：
1. 确认 D1–D5（§1.1）
2. 把 §3.1 的事件对象 + §3.3 的三条路由写成 `artifacts/v4-contract/event-schema.json` + `fixtures/`
3. 签字：本文件 §3 冻结，后续变更需走「契约变更」流程

**实际产出**：
| 文件 | 内容 |
|---|---|
| `artifacts/v4-contract/event-schema.json` | 6.3 KB：16 顶层字段 + 6 条跨字段规则 + 三档渲染 + **4 条路由**（含原文档缺的 `event-list`/`event-detail`）+ 存储布局 + `fieldCountReconciliation` 口径归因 |
| `artifacts/v4-contract/fixtures/minimal-active.json` | 最小合法事件（所有集合为空） |
| `artifacts/v4-contract/fixtures/full-closed.json` | 全分支填充（closed + outcome + 3 检查点 + 六类 panels 中的四类 + 四个人类侧数组） |
| `artifacts/v4-contract/verify.mjs` | 验收器：JSON.parse + 全字段校验 + **8 条负路径** |
| `artifacts/gen-v4-contract.mjs` | 生成器（契约可复算重生成，防手改漂移） |

**验收结果**：`node artifacts/v4-contract/verify.mjs` = **25 PASS / 0 FAIL**。
负路径实测全部抓住：删字段 / id 带 pre / closed 缺 outcome / active 带 pausedReason / 重复 idemKey / stage 非法 / panel kind 未注册 / name 超长。

## 5.2 批次 0.5 · 截断方向修正（1.5h，**完全独立，强烈建议先做**）—— ✅ **已完成 2026-10-24**

> **为什么单独拆出来**：这是既有代码的**纯 bug**，与事件完全无关。实测三个「最近记忆」段注入的都是**最老**的内容。先落地能立刻兑现收益，也给 A 的拍板留缓冲。

> ⚠ **2026-10-24 执行状态更新**：本批**尚未开工**。同属「既有代码纯 bug」的 **R0（memory_recall 可用性）已先行落地**（§1.3.4 R0），
> 报告见 `artifacts/R0-RECALL-AVAILABILITY-2026-10-24.md`（126 行）。R0 与 0.5 是**同一类工作**（都不新功能、都改 index.js 既有行），
> 但**改动行不重叠**（R0 改 :4680-4760 与 :9524-9700；0.5 改 :8516-8565 与 :8640），**可以连做，不需要分开验收**。

**实测证据（可复算）**：

| 段 | 现行为 | 实测注入的内容 | 修法 |
|---|---|---|---|
| user-memory | `truncateHead(userText, 1596)` | 日期 **2026-09-22 单日**（文件最新 2026-10-22） | 改 `truncateTail`（已存在，index.js:1364） |
| project-notes | `truncateHead(notesText, 1596)` | 日期 **2026-10-20 单日**（文件最新 2026-10-24） | 同上 |
| whiteboard-plan | `truncateLinesBounded(planText, 1200)` | 13 个 `##` 节**丢 9 个**，含「★v4 待办（下一步）」 | 按节优先级取（目标/待办/硬约束优先） |
| handoff-ledger | `truncateLinesBounded(ledger, 800)` | 四段只覆盖前两段，**「失败原因」「下一步」整段丢** | **换用已存在的** `weightedTrimHandoffLedgerPre(ledger, 800)`（实测 797 字符、四段全覆盖） |

**改动清单**：

| # | 文件:行 | 改什么 |
|---|---|---|
| 1 | index.js:8556 附近 | `part('memoryReferences','recent-logs', …, sub)` 不动（已用 tail） |
| 2 | index.js:8564-8565 | `part(...userText..., sub, 'must')` → 改用 tail 截断 |
| 3 | index.js:8516 | `truncateLinesBounded(planPart, planCap)` → 按节优先级 |
| 4 | index.js:8517 | `truncateLinesBounded(ledgerPart, ledgerCap)` → `weightedTrimHandoffLedgerPre` |

**⚠ 这会改变注入字节 ⇒ 既有字节断言会红**。按 R12 纪律：先归因（判据过期 vs 真缺陷），逐条更新判据，不许整批回滚。

**验收（真执行 + 负路径）**：

| # | 断言 | 结果 |
|---|---|---|
| 1 | 两个日期文件 → 注入窗口含**最新**日期、不含最老 | ✅ 真执行 `truncateTail` vs `truncateHead` 对比 |
| 2 | 四段账本 → 注入文本四段标题全在 | ✅ `weightedTrimHandoffLedgerPre` 实测四段全保留 |
| 3 | PLAN → 「★v4 待办（下一步）」在窗口内 | ✅ 高优先节按关键词保活 |
| **负 1** | 把 `truncateTail` 改回 `truncateHead` | ✅ 变异必红（b05 套件 24 PASS / 1 FAIL） |
| **负 2** | 把 PLAN 换回 `truncateLinesBounded` | ✅ 变异必红 |
| **负 3** | 把账本换回 `truncateLinesBounded` | ✅ 变异必红 |
| **负 4** | 旧位置截断确实丢掉待办/四段 | ✅ 套件内直接断言（证明修的是真问题） |

**实际产出**：新增套件 `tests/smoke/smoke-test-b05-truncation-direction.mjs` = **26 PASS / 0 FAIL**（4 组真执行 + 4 组 fail-closed + 3 条变异负路径 + 接线守卫）。

**改了什么**：
| # | 位置 | 改动 |
|---|---|---|
| 1 | 新增 `truncatePlanByPriority` + `PLAN_SECTION_PRIORITY_RE` | PLAN 按节优先级（目标/待办/硬约束等关键词节保活；同类内先截靠前的；只截节内、保节标题、带标记） |
| 2 | 新增静态 import `weightedTrimHandoffLedgerPre` | 账本改用已存在的加权截断（单一真源，不再复制权重表） |
| 3 | `part()` 新增第 7 参 `direction`（默认 head） | **旧行为逐字节不变**；user-memory / project-notes 传 `'tail'` |
| 4 | 两处调用点均带 fail-closed 回落 | 骨架解析失败 ⇒ 回落原位置截断 |

**连带修的 3 处判据过期（按 2026-10-01 裁定先归因）**：
- `smoke-test-t0-3-budget-ledger`：`'must')` → `'must', 'tail')` 导致正则不命中 ⇒ 判据过期，改为 `'must'\s*[,)]`。
- `smoke-test-handoff` / `smoke-test-a13-inject-seg-chars`：抽取式沙箱缺 `truncateTail` / `truncatePlanByPriority` / handoff-anchor ⇒ **补注入模块级依赖**（不是放宽断言）。
- `smoke-test-r26-cross-layer`：index.js 归一化 sha 复算重钉 `2A63E9EA…` → `60271F14…`（1,132,369 → 1,136,455 字符，净 +4,086；开工基线逐字节相等证明无历史漂移）。

## 5.3 批次 A · 数据层（3h）—— ✅ **已完成 2026-10-24**

**新增 3 个文件**：

| 文件 | 行数 | 职责 | 参照 |
|---|---|---|---|
| `lib/event-store.js` | ~450 | 五动作（create/set/append/close/rename）+ 原子写 + idemKey 去重 + 列表/详情读 | `fact-store.js`（1,039 行） |
| `lib/event-plan.js` | ~180 | 未归档账本扫描 + 分页 + 事件归属判定 | `plan-store.js`（206 行） |
| `lib/event-render.js` | ~200 | T0/T1/T2 三档渲染 | `handoff-anchor.js` |

**改 index.js（+60）**：import 三模块 + `refresh()` 里预计算 `state.eventCardsText` / `state.eventUnarchivedCount`（**不在 renderMemoryDynamic 里做 IO** —— 它被 47 个套件用 `new Function` 独立执行）

**验收**：

**实际产出（4 个新文件 + 3 处 index.js 接线 + 3 个新套件 141 PASS）**：

| 文件 | 实测行数 | 内容 |
|---|---|---|
| `lib/event-store.js` | **287** | 五动作 + 原子写（tmp→rename，失败清 tmp）+ idemKey 去重 + list/detail + `validateEventPre`（严格 16 字段 fail-closed） |
| `lib/event-render.js` | **134** | T0/T1/T2 三档硬上限 + 代理对安全截断 + 事件目录段 ≤400 + `firstSentencePre`（中英句末 + 缩写白名单） |
| `lib/event-plan.js` | **150** | 四段账本识别/切分 + 未归档扫描（D9 口径 A）+ 分页 + 确定性候选分组 + 成本估算 |
| `tests/smoke/smoke-test-v4-event-store.mjs` | — | **59 PASS / 0 FAIL** |
| `tests/smoke/smoke-test-v4-event-render-plan.mjs` | — | **56 PASS / 0 FAIL** |
| `tests/smoke/smoke-test-v4-batchA-wiring.mjs` | — | **26 PASS / 0 FAIL**（真 import MemoryEngine → 真调 refreshEventStatePre） |

| # | 项 | 判据 | 结果 |
|---|---|---|---|
| 1 | create | 返回**严格 16** 字段（旧文档称 21，已在 §3.1 归因） | ✅ + name 空/全空白 → 报错 |
| 2 | append checkpoint | length +1 | ✅ + closed 事件 append → 报错 |
| 3 | close | status==='closed'、重复 close 幂等 | ✅ + 缺 outcome → 报错 |
| 4 | set | 字段更新、updatedAt 变大 | ✅ + 非法字段（id/checkpoints）→ 报错 |
| 5 | rename | name 变、id 不变 | ✅ + 空名/超 80 字 → 报错 |
| 6 | idemKey 去重 | 同 key 二次 append 只 +0 且 `deduped:true` | ✅ 变异必红（删去重 ⇒ 写前校验报 duplicate-idemKey） |
| 7 | 原子写 | 写被拒绝后原文件**逐字节不变** | ✅ 变异必红（删写前校验 ⇒ 2 FAIL） |
| 8 | 三档渲染 | T0≤80 / T1≤140 / T2≤2400 | ✅ 变异必红（T0 上限失效 ⇒ 3 FAIL） |
| 9 | 事件目录段 | ≤400 字符 + 如实报 dropped | ✅ 变异必红（不夹上限 ⇒ 3 FAIL） |
| 10 | 未归档口径 | 只算四段账本，非四段**如实报数** | ✅ 变异必红（只查两段 ⇒ 1 FAIL） |
| 11 | 接线 | refresh() 真调用 → state 四字段被填；renderMemoryDynamic 体内**零 IO** | ✅ 真 import 生产类验证 |

**接线设计（关键决策）**：事件层的**唯一 IO 点**是新增的 `refreshEventStatePre(agent)`（在 `refresh()` 尾部调用），产出 `eventCardsText` / `eventCatalogText` / `eventUnarchivedCount` / `eventActiveCount` 四个 state 字段。**绝不在 `renderMemoryDynamic` 里做 IO** —— 它被 47 个套件用 `new Function` 抽出独立执行，加 `await`/读盘会让那 47 个套件全部要重写沙箱。

**新增配置键 3 个**（160 → 163，5 处文档已同步）：`eventMaxActiveInInject`（默认 2）/ `eventCatalogChars`（默认 400）/ `eventUnarchivedScanTtlMs`（默认 30000，带 5s 下限）。

## 5.4 批次 B · 工具层（2h）—— ✅ **已完成 2026-10-24**

**插在 `memory_rules` 之后、`memory_consolidate` 之前**（index.js:18679 的 `}),` 之后）。

**三个关键判断（理由必须写进代码注释）**：

| # | 判断 | 理由 |
|---|---|---|
| 1 | `checkpoint` 用 `type:'object'`，**不展开成 4 个平铺参数** | `defineTool`（index.js:14003-14013）**只透传 type/description/enum/items/required** —— 嵌套 `object` 的 `properties` 会被丢掉。写 `properties:{...}` 等于没写 |
| 2 | `append` 必须支持 `idemKey` | 防模型重试导致检查点重复；事件 append-only 不可撤销 |
| 3 | `action` 枚举五值 `['create','set','append','close','rename']` | 与 §3.1 的 21 字段一一对应 |

**同步 11 处锁**（§2.1 清单）。**注意**：`locale/zh.json` 与 `en.json` **不含工具名**，不用改。

### 实际产出（已完成）

| 项 | 结果 |
|---|---|
| 工具注册 | `memory_event` 插在 `memory_rules` 之后、`memory_consolidate` 之前；**工具 19→20** |
| 三个关键判断 | ① `checkpoint` **只声明 `type:'object'`**（字段语义全写进 description —— `defineTool` 只透传 type/description/enum/items/required）；② `append` 支持 `idemKey`；③ `action` 五值枚举 |
| 写后刷新 | 每次写成功都调 `refreshEventStatePre` **立刻刷新注入面**（不等 15s TTL） |
| 失败姿态 | 参数语义错（name 空/事件不存在/已 closed/非法字段）**返回可读错误文本而不抛** —— 抛成 isError 会让宿主整轮失败，而这类错几乎都是模型写错参数 |
| 新套件 | `tests/smoke/smoke-test-v4-memory-event-tool.mjs` = **37 PASS / 0 FAIL**（五动作真调用 + 9 条负路径 + schema 形状 + 注入面刷新 + 文档守卫） |
| 计数锁同步 | **5 个测试**（smoke-test / m3b3 / context-observer / graph-mode / p23-wb-sidecar）+ **5 份文档**（WHITEPAPER / GM53 / FRONTEND-CO-CREATION / README×2） |
| verify-docs | **全绿，工具 20 · 路由 73 · 配置键 163** |

**验收结果**：
| # | 判据 | 结果 |
|---|---|---|
| 1 | 五动作真调用（真抽取产线定义 → 真 execute → 断言返回+磁盘） | ✅ 37 PASS |
| 2 | `verify-docs` 报「工具 20」且文档已同步 | ✅ 全绿 |
| 3 | **负：删掉 `memory_event` 注册 → verify-docs 必红** | ✅ 实测（删后工具数回落 20→19，5 处文档断言同时红） |
| 4 | `checkpoint` 无 `properties`（防「写了等于没写」） | ✅ 断言 `!props.checkpoint.properties` |

**全量回归（两轮，按 2026-10-01 裁定先归因）**：

| 轮次 | 结果 | 失败套件 | 归因 |
|---|---|---|---|
| 第 1 轮 | **448 PASS / 1 FAIL** | `smoke-test-a1-mutation-admission` | **判据过期（非本批缺陷）**：该套件在「④ 重新挂载后心跳恢复」上偶发 —— 它靠 `await sleep(250)` 等心跳文件落盘，并行 8 车道满负载时 250ms 不够。**3 次单跑全 PASS（52 PASS / 0 FAIL）**，且本批**未改动**该文件（`git status` 空） |
| 第 2 轮 | **447 PASS / 2 FAIL** | `a1-mutation-admission` + `smoke-test-la4-291-transcript-name` | 同族：`la4` 的失败全在**变异负路径**（复制整棵 lib 树 + 起子进程），并行时子进程 I/O 抢不到配额。**两者单跑均 PASS**，且**均未被本批改动** |
| **第 3 轮（修完抖动后）** | **449 PASS / 0 FAIL / 0 TIMEOUT** | — | ✅ 全绿 |

⇒ 定性为**并行资源竞争的抖动**，与本批改动无关（本批新增的 37 PASS 套件在两轮里都全绿）。**已按「只放宽等待、不放宽判据」修掉两处**（不是只记录）：

| 套件 | 原判据 | 修法 | 非空验证 |
|---|---|---|---|
| `a1-mutation-admission` | 固定 `await sleep(250)` 后断言心跳文件存在 | 改**自适应轮询**（最多 3,000ms，每 25ms 查一次，判据仍是「必须存在」） | ✅ 把产线心跳写盘改成 `if (false)` ⇒ **50 PASS / 2 FAIL**；还原 ⇒ 52 / 0 |
| `la4-291-transcript-name` | 变异路径靠「同秒内两次调用」撞路径 | 把**时钟冻结**在同一毫秒（变异不动，仍是秒级 stamp），消除跨秒随机性 | ✅ 3 次单跑全绿（23 PASS / 0 FAIL） |

## 5.5 批次 C · 注入面（4.5h，**最容易出错的一批**）—— C-1 ✅ / C-3 ✅ / C-2 的 P2·P3 ✅、**P1 待裁定**

### C-1 · 一框三区（INJECTION-PLAN §2）—— ✅ **已完成 2026-10-24**

| 区 | 成员 | 契约 | 落地方式 |
|---|---|---|---|
| **区 I 遵循区** | frame-head / frame-meta / frame-tail / rules-section / frame-inscription | **约束**：不参与裁剪，逐字节稳定 | 由 `complianceStablePre(before, after)` 做**可执行判据**（裁剪前后 (kind,text) 序列逐字节相等） |
| **区 II 记忆区** | Tier-0 目录 / 白板 / 账本 / 事件卡 / recent-logs / 反思 / user-memory / project-notes / workspace-map | **证据**：统一淘汰序 | 沿用 envelope 既有 priority 淘汰序（low → normal → must，同档从尾部丢） |
| **区 III 通道区** | water-advisory / plan-update-request / calendar / external-* / welcome-* / handoff-pointer / event-unarchived | **提醒**：条件式，触发即清位 | `enforceChannelCapPre(segs, 300)`，超限先丢本区最低优先级段 |

**⚠ 文档缺口与处置（先归因再动手）**：原 §5.5 C-1 **只有一张成员表，没有给任何可执行判据，也没有说「区」在代码里怎么体现**。当时代码里只有 `bucket`（rules/memoryReferences/otherDynamic，是**记账维度**）与 `priority`（淘汰档位），二者都不是「区」。据此新增独立纯函数模块 `lib/injection-zones.js`，把「区」做成**显式契约**而不是隐式约定：
- `ZONE_BY_KIND_PRE_V1`：kind → 区 的**唯一真源**（23 个 kind 已登记）；
- `zoneOfKindPre`：未登记 kind ⇒ **fail-safe 落到 memory 区**（不是 compliance —— 默认给「不可裁剪」待遇会让一个拼写错误变成永久豁免，方向必须 fail-closed）；
- `enforceChannelCapPre`：通道区 ≤300，超限按优先级丢，`must` 永不丢且如实报超额；
- `complianceStablePre`：把「不参与裁剪、逐字节稳定」变成**可执行判据**；
- `zoneReportPre`：分区账本（挂 `envelopeMeta.zones`，可审计）。

**实际产出**：`lib/injection-zones.js`（185 行）+ `tests/smoke/smoke-test-v4-c1-zones.mjs` = **57 PASS / 0 FAIL**（真 import 真调用 + 真抽取 `renderMemoryDynamic` 真执行），**3 条变异全部实测必红**（通道区不设上限 / must 可丢 / 未登记落 compliance）。

**★踩到并修掉的一个真缺陷（靠断言抓出）**：首版在**中和前**量三区账本、envelope 在**中和后**量 ⇒ 两本账差 **6 字符**（1973 vs 1967）。「账本对不上」正是 T0-3 要根治的病灶 ⇒ 改成 **先中和 → 再分区 → 再 envelope**，两本账现在逐字节对齐（断言 `meta.chars.total === meta.zones.chars.total`）。

**★另一个必须记录的坑**：`injection-zones.js` 里的 `PRIORITY_RANK` 与 `memory-envelope.js` **同名**，两者被同一个 `new Function` 拼接时会 `SyntaxError: Identifier 'PRIORITY_RANK' has already been declared`。已重命名为 `ZONE_PRIORITY_RANK`。判据：**任何会被拼进同一沙箱的模块，顶层 const 名必须全局唯一**。

**回归**：全量 450 PASS / 1 FAIL（`issue207-processes`，单跑 PASS ⇒ 并行抖动，与前三轮同族）。

### C-2 · 铭文改造（4 处 Prompt，不是 1 处）—— **P2/P3 ✅ 完成；P1 待用户裁定；P4 = C-3 已完成**

| # | Prompt | 状态 | 实际改了什么 |
|---|---|---|---|
| **P1** | `snapshotInscription` | ✅ **完成（2026-10-24 用户裁定后）** | **接近现状重写**（不推倒重来）：在旧 ② 的「白板/账本硬映射」上**追加**事件归属与四动作，保留全部旧判据。**1446 字符 / 上限 1500**（净增 22）。⑦ archive 层独立保留（175 字符，原 221，压缩但信息不丢）。 |
| **P2** | `snapshotSlimMaintain` | ✅ 完成 | 新增第 7 项 `memory_event`（建事件/加检查点 + **写明「写了事件就不必再写 memory_log」**，防重复写两遍）；**「这六项」→「这七项」**。字符 240 → **299**。 |
| **P3** | `snapshotSlimGuide` | ✅ 完成（**含一处口径纠正**） | 加「需要**当前在做什么**时：先看注入的事件卡片」并**放在白板/账本之前**（当下优先于历史）；白板/账本语义改为「四段式：任务状态/目标/已试方案与失败原因/进度与下一步」。字符 ~150 → **231**。 |
| **P4** | 注入面两段 | ✅ = C-3 | 见 §C-3 |

**★发现并拦下一个假承诺（文档要求写 `scope="events"`，但代码里根本没有这个 scope）**：grep 全仓确认 `memory_recall` **不支持** `scope="events"`（只有 `all/handoff/sessions/archive`）。若照文档原样写进铭文，就是「前端文案承诺了后端没有的能力」，正撞用户级硬规则「**前端文案承诺的能力，后端指令须有对应条款**」。处置：**P3 文案不写该 scope**，把「给 memory_recall 加 `scope="events"`」登记为 **D 批交付物**（D 批本来就改检索面）。套件里有负路径断言（铭文不得含该假承诺）。

**P2/P3 的镜像纪律**：两段都在 `DEFAULT_PROMPT_LAYERS` 里，而 `client.js` 的 `DEFAULT_PROMPT_LAYERS_CLIENT` 与它**逐键逐字一致**（G4-6b/G4-6d 硬锁）⇒ **必须两侧同改**。本轮实测踩到：`client.js` 里双引号是 `\"` 转义形态，首版替换串没转义 ⇒ 只改到服务端、G4-6d 立刻报「服务端 299 vs 客户端 240」。已修。

**实际产出**：`tests/smoke/smoke-test-v4-c2-inscription.mjs` = **23 PASS / 0 FAIL**（量的是 `DEFAULT_PROMPT_LAYERS` **求值结果**，不是源码字面量；含客户端镜像自证），**回退 P2/P3 ⇒ 7 FAIL** 实测必红。

**连带重钉两把 client.js 基线锁**（都是经典档手写区字节守恒，属**判据过期**非缺陷）：
- `smoke-test-iter5-skin`：`8866638c…` → `512f90ad…`
- `smoke-test-settings-archive-interval`：`5226d738…` → `a52f5cff…`
归因实测：把两段文案回退到旧值 ⇒ 两套件**都 PASS**（旧锁绿），换回本批改动即红 ⇒ 漂移 100% 来自这两段。

**C-1 + C-2(P2/P3) 全量回归终态：452 PASS / 0 FAIL / 0 TIMEOUT**（278.8s，`--heavy-jobs=3`）。套件总数 450 → **452**（新增 C-1 zones 与 C-2 inscription 两套）。

---

### ★P1 定稿（2026-10-24 用户裁定后完成）—— 「接近现状」重写 + 功能暴露全审计

**用户裁定要点**：「P1 定稿还是要接近现状。原稿可能会有一定的过失，但一定要保证所有的功能都连接正确，能够正确地提醒模型该做全部的事情…完整版和精简版可能都需要相应的改动，一定不要有错漏，例如：1. 有没有暴露给模型的功能；2. 有没有及时提醒模型增加记忆、更新记忆、更新事件等内容。」

**做法**：不采用 CONSTRUCTION-DOC §2.2.2 的推倒式重写（它删掉 kind=plan、把四个 tag 缩写成 state/dead-end/progress、把白板说成「退化为事件板快照不再手工写」、把段名写成 [事件未归档] 而实际是 [待审理账本] —— 4 处会让现有守卫红或语义错）。改为**在旧 ② 上追加**：

| 项 | 旧 | 新 |
|---|---|---|
| ② 白板/账本硬映射 | 三条（handoff / plan / note） | **原样保留**，其后**追加**「★事件归属（先判后写）」+ create/append/set/close + 「事件只是索引，账本仍是原文载体，两者都要写」+ memory_recall(scope=events) |
| ⑧ 存量未归档 | 无 | **新增**：指向实际段名 [待审理账本]，并写明「无存量时该段零字节」 |
| ①③④⑤⑥ | — | 语义不动（只压缩 ③ 的冗长表述） |
| ⑦ archive 层 | 221 字符 | 175 字符（压缩散文，两条命令 + 「不在 all 里」全保留） |
| **合计** | **1,424** | **1,446 / 1500**（净增 22，余量 54） |

**★功能暴露全审计（用户第 1 点）—— 发现并修掉 3 个真缺陷**：

| # | 缺陷 | 证据 | 修法 |
|---|---|---|---|
| 1 | memory_event **只在精简版出现，完整版铭文完全没有** | 三通路矩阵实测 | 完整版 ② 补入事件四动作 |
| 2 | **memory_search 是长期假承诺** —— 全仓 grep 仅 1 次命中（就在这句文案里），工具**从未注册** | index.js 出现次数 = 1 | 服务端 + 客户端两处删除，新增负路径断言防回流 |
| 3 | 日历四工具（calendar_add/list/done/remove）**三条通路全无** | 覆盖矩阵 | 并入 GUIDANCE（静态注入） |

**审计后覆盖矩阵（20 个工具）**：GUIDANCE 覆盖 17 个、铭文 8 个、精简版 7 个；**三通路全无的只剩 memory_expand / memory_trace —— 这两个是 boardMode=graph 才条件注册的，不写进常规提示是有意设计，不是遗漏**（套件显式豁免并注明理由）。

**用户第 2 点（增加/更新记忆、更新事件）的落地**：完整版与精简版**都**有可执行指令 —— memory_log（增加）、memory_note(kind=…)/memory_user/memory_rules（更新记忆）、memory_event(action=…)（更新事件）；精简版第 7 项从「建事件/加检查点」升级为**完整语义**（开工判归属 + create/append/set/close + 宁建勿挂 + 事件是索引/账本是原文载体）。

**新增套件 smoke-test-v4-p1-exposure.mjs = 45 PASS / 0 FAIL**（不是「源码含某字符串」的恒真守卫）：
① 遍历**全部 20 个已注册工具** × **三条真实提示通路**，断言无遗漏（条件注册者豁免）；② 断言三类动作在两版里都有可执行指令；③ 完整版 8 条自检判据逐条；④ 字数 ≤1500 + 客户端逐字镜像；⑤ **负路径**：文案提到的每个 memory_*/calendar_* 必须真实注册（假承诺检测）—— 正是这条抓出 memory_search；⑥ **负路径**：memory_event 的 action 必须都在合法枚举内。

**连带**：smoke-test-v4-c2-inscription 的 3 条判据过期（旧字面「建事件/加检查点」「写了事件就不必再写 memory_log」「原三个检索工具」）按新语义更新为**更强**的断言；现 **27 PASS / 0 FAIL**。

**⚠ 待用户裁定的 P1（唯一的批次内未完成项）**：文档 §5.5 C-2 要求把 `snapshotInscription` 的「② 整段重写：开工先判任务归属」—— 但**没有给新版正文**。这段是模型每轮必读的行为指令（现 1,424 字符含 ⑦ 层，上限 1,500，余量仅 76），重写会实质改变模型每轮行为。按纪律「文档未定不给正文的部分不自行发挥」+「用户裁定权」，本轮**只钉住现状不擅自改**。需要用户：①给新版 ② 全文，或 ②授权我拟稿后审。

**字数核算（实测，注意与旧文档不同）**：

| 项 | 字符 |
|---|---|
| 现 ①–⑥ | 1,203 |
| 现 ⑦（archive 段） | 221 |
| **现合计** | **1,424** |
| **新版合计** | **1,286** |
| **净变化** | **−138**（有 214 余量） |

> ⚠ **旧文档写「1,445 → ≤1,500（净增 55）」是错的**：那是把「不含 ⑦」与「含 ⑦」混算了。实测 1,424 含 ⑦，新版 1,286 ⇒ **净减 138**。见 §9 冲突①。

### C-3 · 新增两段 —— ✅ **已完成 2026-10-24**

| 段 | 位置（实测行号） | 上限 | 触发条件 | 优先级 |
|---|---|---|---|---|
| `event-cards` | **8760**（handoff-ledger **之后，且在 handoff 分支之外**） | ≤2,400（由 renderT2Pre 硬夹） | `state.eventCardsText` 非空（≥1 个 active 事件） | `normal` |
| `event-unarchived` | **8786**（water-advisory 之后） | ≤200（固定模板，实测 ~95） | `state.eventUnarchivedCount > 0` | `low` |

**实际产出**：新增套件 `tests/smoke/smoke-test-v4-c3-inject-segments.mjs` = **24 PASS / 0 FAIL**（真抽取 `renderMemoryDynamic` 本体 → 真执行 → 断言返回值），**5 条变异负路径全部实测必红**。

**本轮踩到并修掉的两个真缺陷（都靠变异测试抓出来的，不是靠读码）**：

| # | 缺陷 | 症状 | 修法 |
|---|---|---|---|
| **1** | `event-cards` 首次**误放进** `handoffEnabled && (planText \|\| latestHandoffText)` 块内 | 「没有白板/账本的工作区」，事件卡**永不注入** —— 而这恰恰是最需要它的场景（新会话还没有账本）。变异「把事件卡挂进 handoff 分支」⇒ 2 FAIL | 移到该 if-block **之外**；补结构性负路径断言（`runCase({eventCardsText})` 且无 planText/handoffText ⇒ 必须出现） |
| **2** | 两个段标题首次**加进了 `DEFAULT_PROMPT_LAYERS`** | 服务端 29 层 / 客户端镜像 27 层 ⇒ `smoke-test-g4-whiteboard` 的 G4-6d（逐键镜像硬锁）立刻红 | 改为**内联字面量**（不进镜像表）；补回归守卫断言「新标题不在 DEFAULT_PROMPT_LAYERS 内」 |

**另外修掉 1 处自己引入的行尾混用**：插入多行注释时用了裸 `\n` ⇒ `smoke-test-la-audit-fixes` 的「单一行尾」守卫红（CRLF 21632 / bareLF 3）。已把该注释改回 CRLF，现 **CRLF 21,633 / bareLF 0**。

**全量回归（4 轮，按 2026-10-01 裁定逐轮归因）**：

| 轮次 | 结果 | 失败套件 | 归因与处置 |
|---|---|---|---|
| 1 | 448 / 2 FAIL | `g4-whiteboard` + `m71` | g4 = **真缺陷**（我把标题加进 DEFAULT_PROMPT_LAYERS ⇒ 29 vs 27 层）→ 改内联；m71 = 并行抖动（单跑 PASS） |
| 2 | 448 / 2 FAIL | `la-audit-fixes` + `a2-hub-transactions` | la = **真缺陷**（我插入多行注释用了裸 `\n` ⇒ CRLF 21632 / bareLF 3）→ 改回 CRLF；a2 = 抖动（单跑 PASS） |
| 3 | 449 / 1 FAIL | `a1-mutation-admission` | 抖动（心跳固定 `sleep(60)`/`sleep(250)` 在并行下不够）→ **两处都改自适应轮询**（只放宽等待，判据不变），并变异验证：禁用产线心跳写盘 ⇒ 50 PASS / 2 FAIL |
| **4（终态）** | **450 PASS / 0 FAIL / 0 TIMEOUT**（243.7s，`--heavy-jobs=3`） | — | ✅ 全绿 |

**结论**：4 轮里失败套件两两不同、且除 g4/la 两个我引入的真缺陷外**全部单跑 PASS** ⇒ 已确认「并行资源竞争抖动」是既有测试基础设施问题（非本批引入）。本轮顺手修掉 `a1` 的两处固定等待（变异验证过非空），其余留 G 批统一处理。

**⚠ 有意偏离文档**：两段**不注册进 `PROMPT_SECTION_KEYS_PRE_V1`****（文档未明写但原设计隐含「加段即可关」）。理由：该清单会在 `client.js` 有一张逐键文案表（`PROMPT_SECTION_TEXT`），加键必须同步改前端；而用户裁定「前端到时须重新测绘一遍再动工」⇒ 本批只做后端，两段作为**内部段**（与 `frame-head`/`frame-meta` 同等待遇）。开关能力留到 F 批随前端一起做（届时 13→15）。已在代码注释与套件守卫里双向留痕。

### C-4 · 三个必须先解决的冲突

| # | 冲突 | 拍板 |
|---|---|---|
| 1 | Tier-0 只剩 **4 token**（396/400），事件目录放不进去 | **D6**：(b) 另开 `event-catalog` 段 |
| 2 | `frame-inscription` 落 `otherDynamic` 无上限 | **D7**：挪进 `rules` |
| 3 | user-memory / project-notes 撤多少 | **D8**：先普查 |

**验收**：

| # | 项 | 判据 | 负路径 |
|---|---|---|---|
| 1 | event-cards 出现 | 真构造 snapshot → 含事件名 | 无 active → 零字节 |
| 2 | event-unarchived 条件式 | 有存量 → 出现 | **无存量 → 字符串不含「事件未归档」** |
| 3 | 铭文 ≤1,500 | 断言 length | — |
| 4 | 「七项」数字对 | 含「七项」 | **断言不含「六项」** |
| 5 | 总量不膨胀 | 完整版 ≤15,300（现状 17,515） | — |
| 6 | 缓存不退化 | 同内容两次渲染 sha 相同 | — |


## 5.6 批次 D · 检索（2.5h）

> ⚠ **C-2 移交进本批的一项**：`PROMPT_SECTION_KEYS_PRE_V1` 之外，铭文 P3 原要求写 `scope="events"`，但该 scope **代码里不存在**。C-2 已把文案里的假承诺**撤掉**，并把「给 `memory_recall` 加 `scope="events"`」并入本批第 1 项 —— **D 批做完后才可以把这句话写回铭文**（届时同步改 C-2 套件里那条负路径断言）。

**三处改动**：

| # | 位置 | 改什么 |
|---|---|---|
| 1 | index.js:18564 | memory_recall 的 scope 枚举从 ['all','handoff','sessions','archive'] → 加 'events' |
| 2 | index.js:9182 附近 | 加 scope==='events' 分支：读 event-store，按 name/summary/sections/checkpoints 做词法+语义匹配 |
| 3 | index.js:8014-8030 | buildTierLayerInjection 加事件目录（按 D6 决定：独立段 or 加进 Tier-0） |

**关键纪律**：
- 检索**用现有引擎占位**（用户已定：模型未训练完）
- 事件目录**必须走注册表**（PANEL_KINDS 思路），不把类型写死
- Tier-0 已有 121 候选裁 114、只进 7 条的实测；**加事件行前必须确认不会把 user 层压到 0**

**验收**：
- 真调用 recall('关键词', 8, agent, 'events') → 断言返回含事件标题
- 负：删掉事件 → 不可命中
- 负：不加 tier0MaxTokens 调整直接加事件行 → perLayer.user.picked 变 0，必红

### 实际产出（第 1、2 项 ✅ 完成；第 3 项未做）

| # | 项 | 状态 | 说明 |
|---|---|---|---|
| 1 | scope 枚举加 `'events'` | ✅ | `['all','handoff','sessions','archive','events']`，描述同步说明「all 不含 archive/events」 |
| 2 | `scope==='events'` 分支 | ✅ | 读 `event-store.json`；把每个事件拼成可检索文本（标题 + 总览 + 四段 + 检查点 + 成果）；**复用既有 `recallPassagesPre` 打分**（不新造打分器）；按**命中词总分降序 + updatedAt 降序**排；标题与总览重复一次做天然加权（按行打分的机制下等于加权，不用改打分器） |
| 3 | `buildTierLayerInjection` 加事件目录 | ⬜ **未做** | 见下：Tier-0 已 396/400 满，且 C-3 已用**独立段** `event-cards` 解决「当前在做什么」，本项与 §C-4 冲突 1（D6 已裁定独立段）重复 ⇒ 建议**取消本项**，待用户确认 |

**验收结果**：`tests/smoke/smoke-test-v4-d-events-recall.mjs` = **22 PASS / 0 FAIL**（真 `new MemoryEngine()` → 真调 `recall(q, n, agent, 'events')`），含 8 组：空库语义 / 命中标题+id+状态 / 命中四段与检查点正文 / 排序（命中词数 + updatedAt）/ limit / **store 损坏必须显式报错而非「未命中」** / store 不存在按空库 / **events 不并入 all**。

**3 条变异全部实测必红**：
| 变异 | 结果 |
|---|---|
| 损坏时静默成空库 | **2 FAIL** |
| 去掉 updatedAt 二级排序 | **1 FAIL**（★这条一开始没抓住，见下） |
| 只搜标题不搜检查点 | **1 FAIL** |

**★变异测试连踩两次才抓住 D2（值得记的教训）**：第一版两个事件**词频不同**（得分本不同，测不到二级排序）；第二版把新事件放数组**前面**（丢掉二级排序后插入顺序恰好正确，仍恒绿）。第三版才改对：**文本逐字节相同、只有 updatedAt 不同，且旧的放数组前面**。判据：测「二级排序」必须让**一级键完全相等**，并且让**默认顺序与期望顺序相反**。


### D2 批 · 存量未归档三件套 —— ✅ **已完成 2026-10-24**

| 件 | 实现 | 验收 |
|---|---|---|
| **(a) 未归档栏** | `GET /event-unarchived` + 引擎 `listUnarchivedPre`（口径 A：只算四段账本；分页默认 50；如实报 `skippedNonLedger`） | 真调 handler：200 / total 只算四段 / 限 2 条时 nextCursor=2 |
| **(b) 审理按钮** | `POST /event-curate` + 引擎 `curateUnarchivedPre`（**只产草案、`wrote:false`、绝不写盘**；`dryRun` 预览不烧 token；草案带 `confidence` 支持 D11「全部接受 high」；附成本估算） | 真调：200 / drafts≥1 / **审理前后目录无任何新增文件** |
| **(c) 二次确认** | 前端双段 confirm（F 批）+ **后端 `confirmToken` 校验 ⇒ 缺/错/空一律 409** | 真调：三种缺失场景全 409、错误码 `confirm-required`、GET 405 |
| **(+)** | `GET /event-list` / `GET /event-detail`（MASTER-PLAN §9⑤ 补的缺口：四份文档都没有事件读接口，而 F 线三视图必须读全部事件） | 真调：200 / 空库 total=0 / 缺 id 400 / 不存在 404 |
| **负路径** | 全部路由 loopback-only | 非回环来源 ⇒ **403**（实测） |

**套件**：`tests/smoke/smoke-test-v4-d2-unarchived.mjs` = **35 PASS / 0 FAIL**，**4 条变异全部必红**：
| 变异 | 结果 |
|---|---|
| 去掉 confirmToken 校验（后端门失效） | **4 FAIL** |
| 口径 B：把非四段也计入未归档 | **3 FAIL** |
| 不分页（一次返回全部） | **3 FAIL** |
| 审理会写盘（`wrote:true`） | **1 FAIL** |

**★本批我自己引入的两个真缺陷（都靠既有守卫抓到，已修）**：
1. **往对象字面量尾部插键时用 `lastIndexOf('\n')` 截断再拼 ⇒ 覆盖掉了 `migrate-upload`**。它的 handler 仍在引用 ⇒ `API['migrate-upload']` 变 `undefined`，**运行期才炸**。教训：**插键必须锚定到具体键行之后，不能用「取最后一行」的位置算术**。
2. **插入的 7 行用了裸 `\n` ⇒ CRLF 22003 / bareLF 7 行尾混用**（`la-audit-fixes` 立刻红）。已归一化为纯 CRLF。
### D 批收尾状态（2026-10-24）

| 项 | 状态 |
|---|---|
| ① `memory_recall` scope 枚举加 `'events'` | ✅ |
| ② `scope==='events'` 分支（读 event-store，按 name/summary/sections/checkpoints 词法匹配，复用 `recallPassagesPre`，按命中词总分 + updatedAt 排序） | ✅ |
| ③ `buildTierLayerInjection` 加事件目录 | ⏸ **待裁定是否取消** —— INJECTION-PLAN §1.7 实测 Tier-0 已 396/400 token（121 候选裁 114），直接加会把 user 层压到 0；而 D6 拍板 + C-3 的独立段 `event-cards` 已覆盖「当前在做什么」这一需求 ⇒ 本项很可能是重复项 |
**连带处理 C-2 移交的假承诺**：后端枚举与分支就位后，P3 铭文把 `scope="events"` **写回**（服务端 + `client.js` 两侧同改），并把 C-2 套件里那条「不得含假承诺」的**负断言翻转为正断言**（外加一条「后端枚举确实含 events」的一致性断言）—— 断言语义没变（始终是「文案承诺必须与后端能力一致」），只是后端补上了。

**连带的锁**：
- `smoke-test-handoff`：`memory_recall scope 枚举` 断言由「字符串全等四值」改为**逐值断言五值都在** + 新增 `events 分支确实接线`（判据意图不变，且将来再加 scope 不会假红）。
- `r26` 重钉 `EF063FB8…` → `C64A91FB…`（+3,965）。
- `iter5-skin` / `settings-archive-interval` 两把 client.js 锁重钉（`512f90ad…`→`91969ff1…`、`a52f5cff…`→`418e659e…`），原因同上（P3 文案回归经典档手写区）。

## 5.7 批次 E · 接续链（3.5h，**不这样改就不能上事件**）—— ✅ **已完成 2026-10-24**

### 实际产出（5 个必改点 + 2 个新增，全部落地）

| # | 位置 | 改了什么 | 证据 |
|---|---|---|---|
| **1** | `refreshRitualPrompt()` | 加**第 0 步「先确认事件归属」**（用 `memory_recall(scope=events)` 查回 eventId；查不到就 `memory_event(action=create)`），并规定**账本首行必须写 `eventId=`**。原「只做下面两件事」→「三件事」 | E-7（5 条） |
| **2** | `handoffMaterialStamp()` | 指纹加**事件维度**（`事件数 | 最近 updatedAt | 检查点总数`），事件维度 fail-soft。**同时修掉原 TODO** —— 旧实现读全局 `this.state.handoffDir`（跨工作区比较的是另一个目录），已改走 `resolvePathsForSession(sid)` | E-8（5 条） |
| **3** | `buildContinueCarry()` | ① 事件绑定块（`【事件绑定】eventId=… name=… status=…` + `【未完成项】`）**进 head 区**（永不截断，与 nav 同等待遇）；② 返回值加 `eventId` / `eventName`；③ 绑定块在 `assembleCarryPre` **之前**入队 | E-1/E-2/E-3/E-6（14 条） |
| **4** | 水位骨架账本 | 改为**优先写进事件 `checkpoints`**（`kind='water'` / `sourceRef='auto:water'` / 同分钟 `idemKey` 幂等），**账本降为兜底**（事件不可用时仍写账本，I4 绝不阻塞接续）。这是「最新账本」主要污染源的根治 | E-9（5 条） |
| **5** | `planUpdatePending` | **实跑确认是真缺陷后**才改：`get state()` 在无 ALS 上下文（心跳/路由）落到 default runtime，而读取点在 `withAgent` 内读该 agent 的 runtime ⇒ **写入的待办永远不会被读到**。两处置位改为写目标 runtime（`runtimeFor(agent).state` / runtimes 兜底），读取端清空语义不变 | E-10（4 条） |
| **新增 A** | carry 结构化块 | 即上表 #3 的绑定块（INJECTION-PLAN §3.2 新增 A 的原文要求） | E-1/E-3 |
| **新增 B** | 接续硬门 | 原来只认 `PLAN/账本/转写包`；新增**事件存在性**为第三条合法材料（`eventCarriesMaterialPre`：active 或有检查点）⇒「事件已建但还没写账本」的会话能接过去 | E-4/E-6 |

**新模块**：`lib/event-carry.js`（约 105 行纯函数，零 IO）—— 因为 `buildContinueCarry` 体量大、依赖多，无法被 `new Function` 抽取式测试单独执行；而「新会话必须知道自己续接哪个事件」是**唯一**能防「同一任务建第二个事件」的机制，必须能被独立真执行地验证。

**验收**：`tests/smoke/smoke-test-v4-e-continuation.mjs` = **61 PASS / 0 FAIL**。

**变异验证（6 条全部实测必红）**：
| 变异 | 结果 |
|---|---|
| 绑定块改放 `bulkParts`（可截断区） | **3 FAIL** |
| 无事件时输出占位而非零字节 | **2 FAIL** |
| 事件存在性从硬门条件里删掉 | **1 FAIL**（★首版断言太宽松漏掉，改整行精确匹配后才抓住） |
| 仪式去掉第 0 步 | **1 FAIL** |
| 水位仍走账本不写事件 | **1 FAIL** |
| `planUpdatePending` 置位退回裸 `this.state` | **2 FAIL** |

**★测试自身的一个弱点被抓出并修正**：E-3 首版用两个分开的 `includes`（`'evMaterial'` 且 `'no handoff material'`）判「事件进了硬门」——把 `!evMaterial &&` 从条件里删掉后两个词仍各自都在 ⇒ **变异恒绿、等于没测**。改为精确匹配整条判据行后必红。教训：**判「某段逻辑在条件里」必须整行匹配，不能分多个 includes**。

> **根因**：eventId 在整个 lib/index.js 出现 **0 次**（实测 grep）；buildContinueCarry 返回的 23 个字段全是路径/模型/序号。
> 新会话读铭文「开工先判任务归属」→ 找不到 eventId → 只能 create → **同一任务变成第二个事件**，旧事件永远停在 active。

### 5 个必改点

| # | 位置 | 现状 | 改法 | 风险 |
|---|---|---|---|---|
| **1** | refreshRitualPrompt() @ 6253 | 只要求写 PLAN + 账本；旧会话不知道 eventId | 加第 0 步「先读回我的 eventId」；账本降为原文载体但**必须带 eventId 引用**；判定成功 = 该事件 checkpoints 长度 +1 | 中：仪式失败会中止接续（5809 只在 disabled 时放行） |
| **2** | handoffMaterialStamp() @ 6277 | stat(PLAN).mtime + 竖线 + 最新账本名；注释自承 TODO：读的是**当前工作区** handoffDir | 改判事件的 updatedAt + checkpoints.length；顺手把 TODO 修掉（改走已在用的 resolvePathsForSession(sid)） | 低：一句话 |
| **3** | buildContinueCarry() @ 6565 | 23 字段无事件标识 | 返回加 eventId / eventName；carryText 的 **head 区**（永不截断）加两块 | 中：head 写多了会挤 nav |
| **4** | 水位骨架账本 @ 5359-5412 | 越阈就 writeHandoffLedger 一篇四段骨架 | 改写进事件 checkpoints，kind='water'、sourceRef='auto:water'；T2 渲染时折叠、不占主叙事位 | 中：这是「最新账本」的主要污染源 |
| **5** | planUpdatePending @ 5347 / 5484 | **写**在无 ALS 上下文（心跳/路由）⇒ 落 default runtime；**读**在 withAgent 内 | 置位改走 runtimeFor(agent).state；或去掉这个待办，改由「事件缺 checkpoint」推导 | **静态推断，施工时必须实跑确认**（不确认不许改） |

### 2 个新增

**新增 A · carry 的结构化块**（进 **head 区**，永不截断）：

```
【事件绑定】eventId=evt_ab12cd34  name="v4 注入面改造"  status=active
【未完成项】- ①给 injected plane 写测试  - ②确认 Tier-0 余量
```

理由：assembleCarryPre({head, nav, bulk, budget: 18000}) 已区分三段，nav 先扣配额永不 slice（1403-1406）。事件绑定是「逃生通道」同族，不能进 bulk。

**新增 B · 「事件存在性」硬门**

现有唯一硬门（6590）：if (!plan && !ledger && !(pack && …)) return { ok:false, error:'no handoff material' }
v4 后要有第三条合法材料：**「该事件存在且有 active checkpoint」也算材料**。否则「事件已建但还没写账本」的会话接不过去。

### 三个「语义变化后会失准」的既有判定（复核项）

| 位置 | 判定 | v4 后 |
|---|---|---|
| 6590 | 接续硬门看 PLAN/账本/转写包 | 见新增 B |
| 8514 | if (handoffEnabled !== false && (s.planText || s.latestHandoffText)) 决定整段是否出现 | 事件存在但 PLAN 空 ⇒ 整段消失 |
| 7327 | 无 PLAN/账本 ⇒ 跨工作区扫「全局最近账本」 | 会扫到**别的任务**的账本，应改为扫「最近事件」或不扫 |

**验收**：
- 真调 buildContinueCarry → 断言返回 eventId 非空、carryText 含【事件绑定】
- 负：去掉字段 ⇒ 新会话 create 第二个事件（用「事件数不增」作端到端负路径）
- 仪式判据：事件 checkpoints +1 但 PLAN 未动 ⇒ 判 updated（负路径：仍用 planMtime ⇒ 判超时，必红）

## 5.8 批次 F · 前端（8.0h，**风险最高的一批**；D3 退场 +1.5h）—— ⛔ **测绘已完成，但发现阻塞性问题，待用户裁决**

### F 批测绘结果（2026-10-24，`artifacts/F-SURVEY-2026-10-24.md`）

### F 批「不依赖 Q1」的部分 —— ✅ **已完成 2026-10-24**（`event` 第三档落地）

| 项 | 实现 | 验收 |
|---|---|---|
| **`event` 第三档** | `lib/board-mode.js`：`BOARD_MODES_PRE_V1 = ['legacy','graph','event']`，版本 `board_mode_pre_v2`；`resolveBoardModePre` 返回新增 `eventEnabled` | 真 import 真调用：三档解析 / 大小写宽容 / **非法值 fail-closed** 全部断言 |
| **与看板线解耦** | `event` 档 `graphEnabled === false`（不注册 `memory_expand`/`memory_trace`、不写 sidecar） | ★这是 D13 删看板的前提：事件档不依赖看板线 |
| **设置页 3 处** | `cur` 改为三档派生 + 各加一个 `boardModeEvent` 按钮 | 实测 3/3 处 |
| **接续面板（第 4 处）** | 旧「两档翻转」会**永远切不到 event** ⇒ 改为三档轮转 `legacy→graph→event→legacy` | 正路径 + ★负路径（旧写法必须不存在） |
| **守卫锁测绘** | 456 套件 / **138 读 client.js** / **484 处结构断言**；其中 **13 处**显式断言 6 个看板组件必须存在（分布 4 套件） | 见 §8.2：**这 13 处锁的原始意图全是「graph 档的看板承诺」⇒ 删组件无法绕过 Q1** |

**新套件** `smoke-test-v4-f-event-tier.mjs` = **34 PASS / 0 FAIL**，**5 条变异全部必红**：
| 变异 | 结果 |
|---|---|
| event 档偷偷启用 graphEnabled | **3 FAIL** |
| 三档集合漏掉 event | **1 FAIL** |
| 设置页 cur 退回两档 | **1 FAIL** |
| 接续面板退回两档翻转 | **2 FAIL** |
| event 按钮 data-dam-key 写错 | **1 FAIL** |

### ★本批补上的**假承诺防线**（2026-10-24，加 event 档后才暴露）

**问题**：加了 `event` 档之后，`/kanban-board` 在 event 档下返回 `{enabled:false, reason:'legacy-mode'}` ⇒
前端三处 `reason` 消费点全部显示「当前是旧版白板(legacy)档，请切到新版看板」——
而用户明明选的是 **event 档**。这是**假承诺的反面：功能选了却像没开**。

**修法（前后端成对）**：
| 层 | 改动 |
|---|---|
| 后端 | `kanbanBoardData` 的档位闸门从「是不是 graph」改为读 `_bm`，event 档回 **专属 `reason:'event-mode'`** + `boardMode` 字段 |
| 前端 | 3 处 `reason` 消费点（L6052 / L6491 / L8290）全部加 `event-mode` 分支 |
| i18n | 三语新增 `planEventMode` 文案：说明「当前是事件视图」，并**指向正确入口**（设置 → 白板模式 → 新版看板） |

**判据（4 条，全部真断言）**：后端回专属 reason / 前端 3 处认得 / 三语齐全 / **负路径：中文文案不得含「未启用」**。

**★我的首版负路径写错了**：只断言「含事件视图」⇒ 变异版「白板未启用。当前是事件视图」**仍然包含**它 ⇒ 恒绿（M9 未被抓住）。
改成**断言不含误导词**（`!includes('未启用')` + `!includes('legacy')`）后才必红。教训：**负路径必须是「不得包含」，不能是「包含某个正面词」**。
**★本批我自己踩的两个测试缺陷（已修）**：
1. **把 `'EVENT '` / `'Event'` 当非法值测** ⇒ 假红。`resolveBoardModePre` 对输入做 `trim().toLowerCase()` 是**既有语义**（legacy/graph 一直如此），大小写宽容**是正确行为**。教训：**测试判据必须与被测函数的既有语义一致**，不能想当然。
2. **用 `assert.deepEqual` 做断言 ⇒ 变异恒「绿」**：硬抛会终止整个套件，不产出 `FAIL` 行，`grep '^  FAIL'` 抓到 0 条。教训：**变异可检测性要求的断言必须走 `ok()` 计数式**，不能用硬抛。
**★阻塞性发现：D13 与「graph 是出厂默认」直接冲突**

| 事实 | 证据 |
|---|---|
| `boardMode` 合法值只有 `['legacy','graph']` | `lib/board-mode.js` 的 `BOARD_MODES_PRE_V1` |
| **`graph` 档就是看板本身** | 同文件注释「graph(新版看板 dsh-graph + sidecar + 遍历工具)」 |
| **`graph` 是当前出厂默认** | `DEFAULT_CONFIG.boardMode = 'graph'`，注释写明「2026-09-17（3.0.0）用户裁定『白板默认新版，旧版为了兼容而保留』」 |
| 看板 6 组件是 `graph` 档的唯一渲染实现 | L8312（Rail 调用）/ L19634（View 导出） |

⇒ **删 6 个组件 = `graph` 档必然失效**。三条路：(a) 删组件 + 下线 graph 档（建议）/ (b) 删组件 + graph 改为事件视图另一种排布 / (c) 保留组件（**与 D13 冲突**）。**待用户裁决。**

**实测数据（取实测值，与旧文档冲突处已归因）**

| 项 | 实测 | 旧文档 | 判定 |
|---|---|---|---|
| 看板 6 组件总行数 | **522** | 902（CONSTRUCTION-DOC）/ 708（FINAL-SPEC-v2） | **取实测 522** |
| `boardMode` 需同步改的副本 | **4 处**（3 设置页 + 1 接续面板） | 3 处（只算设置页） | **取实测 4** |
| D2 事件 4 路由在前端 | **0 处引用** | — | **F 批硬前置：必须补 API 表 4 键** |

**删除顺序（关键）**：先清调用点（L19634 → L8312 → L5777 → L5850 → L6159 → L6202），最后**按行号倒序**删定义。


### F-1 · boardMode 单档（D3 拍板：只留 event）

| 项 | 要求 |
|---|---|
| **event** | **唯一档**，替换白板看板位置（不是新页面） |
| legacy | **代码路径退场**；config 层保留一个不可见兜底值（fail-safe，不进设置页 UI） |
| graph | **代码路径退场**；vendor/dsh-graph（191 文件）**保留但不接线** |

### F-2 · 三视图（严格按手绘 3 + 裁定 24–30）

| 视图 | 内容 |
|---|---|
| 时间流 | 倒序（**最新在底部**），向上懒加载，滚动锚定漂移 <2px |
| 泳道甘特 | 并行/交错的真实表达（**不再假设串行** —— 那是旧流水账的产物） |
| 工作流线索 | 同一工作线被拆成多事件时的分隔显示，断点留白 |

**时间轴重做要求（裁定 26）**：rail 200→**280~340px**；时间密度柱；月份 sticky 分隔；等距/真实比例切换；相对时间；scroll-spy；「今天」锚点；>2h 空档可视化。

**字号/自适应/主题（裁定 28–30）**：正文 14–15px；全站 **rem**；三档 A-/A/A+；最小可读 ≥11px；三档断点；明暗双主题（对比度 ≥4.5:1）。

**设计 skill（裁定 27，用户明确要求）**：apple-design / transitions-motion / emil-design-eng / dsign-compacted；复用既有 token（--dur-quick/fast/medium/slow + --ease-smooth-out），不新造时长数字。

### F-3 · 未归档栏 + 审理按钮 + 二次确认（用户问题 ③）

| 件 | 实现 |
|---|---|
| (a) 未归档栏 | 表格：文件/时间/目标首行/字节/状态；分页或虚拟滚动（839 行 DOM 太多） |
| (b) 审理按钮 | 点 → 后端 /event-curate → 子代理只出草案 |
| (c) 二次确认 | **双段 confirm + 首段显示预估 token + 明写「只出草案不写盘」+ 后端必须校验 confirmToken 否则 409** |

**二次确认四个硬要求（缺一不可）**：

| # | 要求 | 理由 |
|---|---|---|
| 1 | 第一段显示**预估 token** | 不显示数字等于没告知 |
| 2 | 第一段写明「**只出草案不写盘**」 | 消除「点一下就改了记忆」的恐惧 |
| 3 | 第二段必须存在 | 防手滑双击 + 防第一段没看清 |
| 4 | **后端必须校验 confirmToken** | 前端 confirm 可被 curl 绕过 ⇒ 只做前端等于没保护 |

**成本预估（实测可复算）**：账本均 1,153 字符 ÷ 1.7 ≈ **678 输入 token/篇** + **75 输出 token/篇**；40 篇 ≈ **27,120 输入 + 3,000 输出**；全量 839 篇 ≈ 569,000 + 63,000。

**验收**：

| # | 项 | 判据 | 负路径 |
|---|---|---|---|
| 1 | event 单档渲染基线 | 真 factory 渲染 → 与基线 sha 比对 | 改了任一分量 ⇒ 必红 |
| 1b | legacy 兜底可用 | config 切 legacy → 页面能回退 | 兜底失效 ⇒ 必红 |
| 2 | event 档三视图 | CDP 真点击 | 非法 boardMode → legacy |
| 3 | 倒序 + 懒加载 | 滚到底触发加载，**锚定漂移 <2px** | 加载后跳动 ⇒ 必红 |
| 4 | 未归档栏渲染 | 真点击页签 | 0 条时不显示「审理」按钮 |
| 5 | 二次确认双段 | CDP 拦截 confirm → 断言调用 **2 次** | 取消第二段 → 不发请求 |
| 6 | 后端校验 | curl 不带 token → **409** | 带错 token → 409 |
| 7 | 字号/主题 | 实测 computed style | — |

### F 批主体（D14 落地）—— ✅ **已完成 2026-10-24**

**用户裁定（Q1 方案 a + 追加）**：删看板组件 + 下线 `graph` 档；**「以后点击『白板看板』这个页签进去，只保留现在最新的、以事件为中心的内容」**。

| 改动 | 实现 | 验收 |
|---|---|---|
| **EventCard / EventView** | 新增组件（手写区）：事件卡（name/status/summary/检查点数 + 可展开四段）；EventView **只显示最新 N 件**（active 优先 → updatedAt 降序 → 截断），fail-soft、只读 | graph-mode F4/F7 改写后真断言：**真实调用点** + 取数 + 截断 + active 优先 + updatedAt 降序 |
| **白板页签换渲染** | `rows.unshift(... EventView ...)` 取代 `KanbanBoardRail`；整页/全宽（沿用 R40 规则） | 同上 |
| **移除 kbData 全链路** | state 声明 + `/kanban-board` 取数 + 看板渲染块 + `structured` 卡片（28 行）| `kbData` 残留 **0 处** |
| **既有守卫按原意改写** | `graph-mode` E4/F4/F7（3 条）+ `r15-left-rail` ㉑（1 条） | 全部保留原不变量本体（如「函数必须有真实调用点」「结构化视图不得空渲染」），只换判据对象 |

**结果**：`graph-mode` **35 passed / 0 failed**；`r15-left-rail` **66 passed / 0 failed**；`build-iter5-skin --check` = **SYNC-OK**（新增组件全在手写区）。

**★尚待做（F 批剩余）**：
1. **删除 6 个看板组件**（522 行）—— 渲染已换掉，但组件定义仍在（未被调用）。按 D13 应真删。
2. **`boardMode` 收敛到 `event` 单档**：设置页/接续面板从三档按钮改为单档展示；`BOARD_MODES_PRE_V1` 改 `['event']` + legacy 作 fail-safe。
3. 撞锁 13 处（graph-mode 6 / r15 3 / v314 4）逐条按原意改写。
## 5.9 批次 G · 配置 + 收尾（3h）—— 🔶 **部分完成（可做项已做，2 项待用户裁决）**

### 实际状态（2026-10-24）

| # | 内容 | 状态 | 实测 |
|---|---|---|---|
| 1 | 新增事件配置键 | ✅ **已完备** | `eventMaxActiveInInject` / `eventCatalogChars` / `eventUnarchivedScanTtlMs` **3 个键全部「已定义且被读取」**（审计：0 个「读了没定义」、0 个「定义了没人读」） |
| 2 | 设置页副本同步 | ⛔ 待 F 批 | 属于前端，随 F 批一起做（F 批待裁 Q1） |
| 3 | 废弃 `slimPlanChars` / `slimLedgerChars` | ✅ **已处置** | 实测全仓**只有定义行 + 1 行注释，0 处读取**。**处置方式：注释标记废弃，键保留不删**。理由：① 补实现会与 C-2/P3 冲突（精简版已改成「事件卡片入口 + 白板/账本只在完整版给」）；② 删键会让 `Object.keys(DEFAULT_CONFIG)` 白名单缩水 ⇒ 老用户配置里这两个键会被当未知键剔除，属**有感**行为变化。配置键仍 **163**。 |
| 4 | 死路由 `/handoff-continue` 处置 | ⛔ **待用户裁决** | 实测：后端有完整实现（3 处引用）、前端**有常量无调用**、**5 个测试套件**在调它。**这是用户可感知的功能（旧版接续入口）**，删除 = 移除一个可能仍有人用的入口 ⇒ 不由我定。 |
| 5 | 全量回归 + verify-docs + 发版预检 | 🔶 回归与 verify-docs 已做；**发版预检不做**（须用户明确指令） | verify-docs 全绿（工具 20 · 路由 77 · 配置键 163） |

**★G 批剩余阻塞项汇总（都需用户裁决）**：
1. `/handoff-continue` 死路由：删 / 保留 / 标记废弃？
2. 发版预检（须明确指令，且发版不得委派 subagent）


| # | 内容 |
|---|---|
| 1 | 新增配置键（eventMaxActiveInInject / eventCurateTimeoutMs / eventCatalogChars 等 6~8 个） |
| 2 | 设置页 **3 处副本同步**（12719 / 16056 / 19185） |
| 3 | 废弃 slimPlanChars/slimLedgerChars（全仓 0 处读取，名存实亡）或补实现 |
| 4 | 死路由 /handoff-continue 处置决定（有实现、全仓无调用，仅 5 个测试在调） |
| 5 | 全量回归 + verify-docs + 发版预检 |

**发版预检（注意：发版必须等用户明确指令，且不得委派 subagent）**：
- git fetch 核对远端真实版本（远端 main 与 dev 是两条没有共同 head 的线）
- release.mjs:240 会把 docs/ 整树覆盖 ⇒ 发版前必须核对 dev 与 main 的 docs 差异
- npm publish 后按 **shasum + gitHead + time 三值回查**，不能只看 exit 0

---

# §6 · 验收总表（28 条）

> **纪律**：禁止以「源码含某字符串」充当功能验收（仅可作守卫）。**每条必须真执行 + 带负路径。**

| # | 批次 | 验收项 | 方法 | 负路径 |
|---|---|---|---|---|
| 1 | 0 | 契约 fixture 合法 | JSON.parse + 21 字段校验 | 缺字段 → 报错 |
| 2 | 0.5 | user-memory 注入最新 | 两日期文件 → 断言含新不含老 | 换回 truncateHead → 必红 |
| 3 | 0.5 | 账本四段全覆盖 | 断言四段标题全在 | 换回 truncateLinesBounded → 必红 |
| 4 | 0.5 | PLAN 不丢「下一步」 | 断言含「下一步」节 | — |
| 5 | A | createEventPre 21 字段 | 真调用 | name 空 → 报错 |
| 6 | A | appendCheckpointPre | length +1 | closed 事件 append → 报错 |
| 7 | A | closeEventPre | status==='closed' | 缺 outcome → 报错 |
| 8 | A | setEventFieldPre | 值更新 + updatedAt 变 | 非法字段 → 报错 |
| 9 | A | renameEventPre | name 变 id 不变 | 空名 → 报错 |
| 10 | A | idemKey 去重 | 二次 append 只 +0 | — |
| 11 | A | 原子写 | 模拟中途抛错 → 原文件不变 | — |
| 12 | A | 三档渲染上限 | T0≤80 / T1≤140 / T2≤2400 | 超限 → 必红 |
| 13 | B | memory_event 五动作 | 逐个真调用 | 非法 action / 不存在 eventId |
| 14 | B | 工具数 20 | verify-docs 实测 | — |
| 15 | C | event-cards 出现 | 真构造 snapshot | 无 active → 零字节 |
| 16 | C | event-unarchived 条件式 | 有存量 → 出现 | **无存量 → 不含「事件未归档」** |
| 17 | C | 铭文 ≤1,500 | 断言 length | — |
| 18 | C | 「七项」数字对 | 含「七项」 | **断言不含「六项」** |
| 19 | C | 总量 ≤15,300 | 真渲染 | — |
| 20 | C | 缓存不退化 | 两次渲染 sha 相同 | — |
| 21 | D | recall scope=events | 真调用 | 删事件 → 不可命中 |
| 22 | D | Tier-0 user 层不被压到 0 | perLayer.user.picked ≥1 | 不调 maxTokens → 必红 |
| 23 | E | carry 带 eventId | 真调用 buildContinueCarry | 去掉 → 事件数增长 |
| 24 | E | 仪式判据认事件 | checkpoints +1 但 PLAN 未动 → updated | 仍用 planMtime → 超时，必红 |
| 25 | F | **event 单档渲染基线锁** | 真 factory 渲染 → 记录 sha 基线 | 改动后 sha 变 → 需归因（真缺陷 / 有意演进） |
| 25b | F | legacy 兜底值仍可用 | 改 config 为 legacy → 能回退 | 兜底失效 → 必红 |
| 26 | F | 倒序 + 懒加载锚定 <2px | CDP 真测 | 跳动 → 必红 |
| 27 | F | 二次确认双段 + 后端 409 | CDP + curl | 取消第二段 → 不发请求 |
| 28 | G | 全量 smoke PASS ≥443 / FAIL 0 | run-smoke | — |

---

# §7 · 风险与停手信号

## 7.1 十六条风险

| # | 风险 | 后果 | 对策 |
|---|---|---|---|
| **R1** | 设置页 3 处 boardMode 副本只改部分 | 半修：有的路径解析、有的恒失败 | 改前 grep 3 处，改后验证 3 处 |
| **R2** | events.jsonl 命名撞车 | sidecar 事件链与事件存储混读 | 用 event-store.json（D1） |
| **R3** | 工具/路由/配置键三处连环锁 | 改代码没改文档 → 红 | 每批跑 verify-docs |
| **R4** | 前端整块替换式重构 | 用户明确警告过（merge 社区前端污染，修一整天） | 只做定点插入 |
| **R5** | 静态守卫冒充功能验收 | 全绿但运行时才炸 | 真 import → 真调用 + 负路径 + 变异 |
| **R6** | skins/v4/ 撞名 | 与第三方皮肤包冲突 | 不新建 skin 包（D4） |
| **R7** | 注入段加了但没进预算公式 | 溢出致其他段被裁（规则段冻结不能裁） | 加段时同步改 memRefLimit |
| **R8** | 事件 ID 前缀冲突 | 索引串味 | **`evt_`**（D2 最终值，不带 pre） |
| **R9** | release.mjs:240 把 docs/ 整树覆盖 | dev 覆盖 main 的 docs | 发版前 git fetch 核对 |
| **R10** | 发版不得委派 subagent | 用户硬规则 | Lead 直接执行 |
| **R11** | npm publish 三层不同步 | 只看 exit 0 会误判 | shasum + gitHead + time 三值回查 |
| **R12** | **验证器写死语料绝对值** | 语料一长就假红（已真实发生一次，15 条全红 0 真缺陷） | 改**不变量断言**：覆盖自洽 / 倒序语义 / 单调下界 |
| **R13** | defineTool 不透传嵌套 object 的 properties | schema 子字段消失，模型看不到 | checkpoint 用 type:'object' + description 描述 |
| **R14**（新） | Tier-0 只剩 4 token 却硬加事件行 | user 层被压到 0，Tier-0 直接废掉 | D6：另开 event-catalog 段 |
| **R15**（新） | 注入面按「17 段」规划 | 实际只渲染 12 段，规划了不存在的段 | 验收一律按**实际渲染段** |
| **R16**（新） | 前端按「串行」假设画甘特 | 旧流水账的串行是格式产物，不是领域本质（用户已纠正） | 甘特/泳道必须表达并行 |
| **R17**（新·D3 引发） | **boardMode 退场到单档**，102 个测试 + 191 个 vendor 文件牵连 | 改一半会半修（有的路径解析、有的还在读旧数据） | 按 §1.3.1 清单逐项改全；legacy 兜底值必须真能用 |
| **R18**（新·recall 相关） | 顺手改 recall 会与 v4 的 C/D 批交织 | diff 无法区分、回滚回不干净 | recall 改造**定为 v4 之后的独立批次**，见 artifacts/RECALL-DEBT-PLAN-2026-10-24.md |

## 7.2 三处必须**当场停手**的信号

| 信号 | 含义 | 立刻做什么 |
|---|---|---|
| verify-docs 报的实测值与文档不符 | 锁没同步全 | 按它打印的新值同步 11 处，**别手改回去** |
| legacy/graph 渲染 sha 变了 | 前端动到了不该动的分支 | **停手回滚**，只做定点插入 |
| 注入快照总长 > 8,000 字 | 预算溢出 | 检查 memRefLimit；规则段冻结不能裁，从 recent-logs 让 |

---

# §8 · 回滚手册

| 场景 | 回滚动作 | 判据 |
|---|---|---|
| 批次 A/B/C 出错 | git checkout -- lib/index.js；新文件直接删 | verify-docs 回到 19/73/160 |
| 批次 F 前端出错 | git checkout -- lib/client.js；**不要**用备份覆盖（会丢别人的改动） | event 档 sha 回到基线 |
| event 视图上线后出严重问题 | 把 config 的 boardMode 改为 legacy（隐藏兜底值，不进 UI） | 页面回到旧版白板 |
| 批次 0.5 注入字节变了导致大范围红 | 单独 revert 该批的 4 处改动 | 注入总长回到 17,515 |
| 事件数据损坏 | 删 event-store.json（账本原件只读、未改） | 未归档栏回到全量 |

**铁律**：账本原件**只读**。事件存储与账本引用分离 ⇒ **删事件只删索引，账本回到「未归档」**。

---

# §9 · 冲突消解记录（四处 + 一处补漏）

## ① 铭文字数口径

| 来源 | 说法 | 判定 |
|---|---|---|
| SPEC / OUTLINE / DOC | 现 1,445 字，目标 ≤1,500（净增 ≤55） | **错：把「不含 ⑦」当成合计** |
| INJECTION-PLAN | 实测 1,424（①–⑥ 1,203 + ⑦ 221）→ 1,286 | **取这个** |

**结论**：现 1,424 → 新 1,286，**净减 138**，预算 1,500 有 214 余量。旧文档的「净增 55」是算错的。

## ② Tier-0 余量

| 来源 | 说法 | 判定 |
|---|---|---|
| SPEC / DOC | tier0-catalog 776 字符，「属替换，有预算」 | **错：把「段字符数」当成「token 余量」** |
| INJECTION-PLAN | 实测 tier0Tokens = 396/400，121 候选裁 114，**余 4 token** | **取这个** |

**结论**：加事件行必须先解决 D6，否则 user 层会被压到 0。

## ③ 未归档口径

| 来源 | 选项 | 判定 |
|---|---|---|
| DOC 附录 B1 | A=322 / B=839 / C=两 tab | 未定 |
| 本文档 | **统一 A（只算四段账本 ~322）** | **拍板 D9** |

**理由**：321 篇机械产物（PLAN 快照/会话转写）进审理队列没意义，且会消耗 token。

## ④ 注入段清单

| 来源 | 说法 | 判定 |
|---|---|---|
| SPEC / DOC | 按 **17 段**规划 | **错：代码里「可能段」≠「实际渲染段」** |
| INJECTION-PLAN | 实测本机真实渲染 **12 段** | **取这个** |

**结论**：施工与验收一律按**实际渲染段**。

## ⑤ 合并时补的一个缺口（不是冲突，是遗漏）

四份文档都定义了 /event-unarchived 与 /event-curate，但**没有定义「事件列表」读接口**。而 F 线三视图必须读全部事件。

⇒ 已在 §3.3 补三条路由（/event-list / /event-detail / 分页与精简字段约定），**列入批次 0 一起拍板**。

---

# §10 · 四张图

| 图 | 内容 |
|---|---|
| **M1** | 七条线总览（涉及哪些方面） |
| **M2** | 三工作日排期（依赖与并行） |
| **M3** | 四份文档合并与冲突消解 |
| **M4** | 12 项待拍板清单 |

文件：artifacts/_diagrams/M1-seven-lines.png / M2-schedule.png / M3-merge.png / M4-decisions.png

---

# §11 · 一句话

> **先把「注入变对了」落地（批次 0.5，1.5h，与事件无关），再立事件地基（A→B→C），**
> **然后改接续链（E）—— 不改它，事件化上线第一天就开始复制事件；**
> **前端全程用契约 mock 并行，最后一天联调。**
> **每一批都必须真执行验收 + 负路径；每条红都先归因，不许整批回滚。**


---

# §12 · 附录 · 行号复核（本文件引用的全部行号逐条验过）

| 行号 | 内容 | 结果 |
|---|---|---|
| index.js:1198 | snapshotInscription | ✅ |
| index.js:1222 | snapshotSlimGuide | ✅ |
| index.js:1229 | snapshotSlimMaintain | ✅ |
| index.js:1364 | truncateTail（0.5 批要复用的） | ✅ |
| index.js:5347 / 5484 | planUpdatePending 两处置位 | ✅ |
| index.js:6253 | refreshRitualPrompt() | ✅ |
| index.js:6277 | handoffMaterialStamp(sessionId) | ✅ |
| index.js:6565 | buildContinueCarry(preferSid) | ✅ |
| index.js:6590 | 接续唯一硬门 | ✅ |
| index.js:8516 / 8517 / 8518 | whiteboard-plan / ledger 截断 / handoff-ledger 段 | ✅ |
| index.js:8535 | water-advisory 段 | ✅ |
| index.js:8564 / 8565 | user-memory / project-notes 段 | ✅ |
| index.js:9153 | recall() | ✅ |
| index.js:13999 | defineTool 定义 | ✅ |
| index.js:14003-14013 | defineTool 的属性搬运段（只透传 5 个键） | ✅ |
| index.js:18347 | const tools = [ | ✅ |
| index.js:18564 | memory_recall 的 scope 枚举 | ✅ |
| index.js:18679 | memory_rules 结束（memory_event 插这之后） | ✅ |
| index.js:21198 | 工具注册循环 | ✅ |
| client.js:8187 / 12719 / 16056 / 19185 | boardMode 四处分支 | ✅ |
| client.js:19593 | settings.plugins.tab | ✅ |

**复核方式**：脚本逐条读源码对应行、断言包含预期子串。**21/21 通过**（2026-10-24 13:44）。

---

# §13 · 附录 · 本文件与四份原件的对应关系

| 本文件章节 | 主要来源 |
|---|---|
| §1 拍板清单 | CONSTRUCTION-DOC §0.2 + 附录 B + INJECTION-PLAN §6（合并去重，12 项） |
| §2 七条线 | CONSTRUCTION-DOC §4 六批 + INJECTION-PLAN §3（拆出 E 线，0.5 独立） |
| §3 数据契约 | SPEC §三 D1 + INJECTION-PLAN §2.5（补 §3.3 三条路由，原四份都缺） |
| §4 顺序与依赖 | **本文档原创**（四份原件都没有依赖矩阵与并行判断） |
| §5 每批细则 | CONSTRUCTION-DOC §1–§3 + INJECTION-PLAN §2–§3（合并，去重） |
| §6 验收总表 | CONSTRUCTION-DOC §5（18 条）+ INJECTION-PLAN §5（10 条）= 28 条 |
| §7 风险 | CONSTRUCTION-DOC §6（13 条）+ 新增 3 条（R14/R15/R16） |
| §8 回滚手册 | **本文档原创** |
| §9 冲突消解 | **本文档原创**（四处冲突是合并时才发现） |

**四份原件仍是权威来源**，本文件不替代它们，只是把它们合并成「可以直接照着做」的顺序层。
