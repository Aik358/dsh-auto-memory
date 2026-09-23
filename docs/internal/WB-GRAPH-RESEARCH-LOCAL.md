# R1·白板接续本地代码审计报告

> 任务书：`docs/internal/WB-GRAPH-RESEARCH-BRIEF.md`（2026-09-13）。
> 审计对象：`lib/index.js`（8281 行）、`lib/handoff-anchor-pre.js`、`lib/l0-extract-pre.js`、`lib/client.js` 等。
> 所有行号均为 2026-09-13 工作树实测（grep/read 验证，非臆造）。仅读代码，未改任何文件。

---

## 一、白板数据模型（PLAN.md 磁盘存储）

**路径解析**

- `lib/index.js:1549-1579` — `resolvePaths(agent)` 返回全部记忆路径对象；`handoffDir = projectDir/handoff`（1573）、`planPath = projectDir/handoff/PLAN.md`（1574）。解析前强制加载配置（1552），工作区锁定防 cwd 漂移（1559-1561）。
- `lib/index.js:1504-1515` — `projectDirOf(ws)`：集中式记忆根 `config.memoryRoot`（默认 `dshHome()/memory/workspaces`，1513）+ 每工作区一个子目录（1514）。
- `lib/index.js:1498-1501` — `wsKey(ws)`：工作区路径 → `--<特殊字符替换为->--` 目录名，'default' 兜底。
- `lib/index.js:1530-1543` — `migrateLegacy`：旧分散结构 `{ws}/.dsh-memory` → 集中式根的复制式迁移。

**文件结构约定（无 schema）**

- PLAN.md 与账本均为自由 Markdown，代码中不存在任何 schema/结构校验。唯一的"结构约定"有三处且都不做校验：
  - `lib/index.js:1641` — P7 老化只按标题正则 `/^## .*(历史|踩坑|流水线要点)/` 分类顶层节；
  - 四段式标题字符串只出现在 prompt 文案（`lib/index.js:445`、`2506`、`3703`）与权重表（`lib/handoff-anchor-pre.js:18-23`），写入端无任何代码消费它们；
  - `lib/index.js:1674` — 账本统一由写入函数加系统头部 `# 交接账本 · <日期> <HH:MM>`。

**归档与老化**

- `lib/index.js:1620-1662` — `writePlanSnapshot(projectDir, content)`：整篇重写 PLAN.md；旧内容非空且与新内容不同 → 先归档到 `handoff/archive/PLAN-<ts>.md`（1626-1631）。
- `lib/index.js:1633-1656` — P7 白板老化（2026-09-09）：新内容中标题命中「历史|踩坑|流水线要点」的顶层 `##` 节移入 `handoff/archive/PLAN-history-<ts>.md`；**只移动不删除**；全部节都命中时 fail-soft 放弃老化原样写入（1645）。
- `lib/index.js:1657` + `lib/index.js:3798-3801` — 落盘走 `writeFullRaw`（原始整篇写，**不经 anchor 分流**；契约上白板属"非记忆文件"排除项）。
- `lib/index.js:464-467` — `handoffStamp()`：`YYYYMMDD-HHMMSS`，文件名字典序=时间序（同秒多写用 `-b/-c` ASCII 后缀防撞，`1672`、`1650`）。

**历史版本查询**

- `lib/index.js:1682-1686` — `listHandoffLedgers(dir, limit)`：白名单正则 `/^(?:handoff-\d{8}-\d{6}(-[a-z])?|PLAN-\d{8}-\d{6})\.md$/`，字典序倒序=新→旧。
- `lib/index.js:2795-2874` — `handoffPanelData(fileQ, sessionId)`：GUI 白板面板——当前 PLAN 全文（2864）、归档历史版本列表（2806-2812，最多 30 条）、账本时间线（2813-2820，最多 60 条）；`fileQ` 非空时按**严格白名单**（2800：`PLAN.md|handoff-*|archive/PLAN-*`）返回指定文件文本 → 白板历史版本查询的唯一入口（HTTP：`lib/index.js:7370-7377`，GET `/handoff-state`，loopback-only）。
- `lib/index.js:1603-1615` — `readLatestHandoff(handoffDir)`：按 mtime 取最新账本（同秒 `-b` 后缀参与竞争）。
- `lib/index.js:1584-1600` — `findLatestGlobalHandoff()`：跨工作区扫描全部 ws 的 `handoff/handoff-*.md`，取 mtime 最新一篇（工作区未绑定时的降级材料源）。

---

## 二、交接账本（生成路径与四段式映射点）

**生成路径共 3 条**

1. 工具显式写：`lib/index.js:7069-7112` — `memory_note` 工具，`kind` 枚举 `note|handoff|plan`（7072）；`kind=handoff/plan` 分支在 7078-7091：`sanitizeForWrite`（plan 20 万字 / handoff 8000 字上限，7079）→ `writePlanSnapshot`（7083）或 `writeHandoffLedger`（7084）→ 同步 `state.planText` / `state.latestHandoffText`（7086-7087）。注意：**此分支不检查 `handoffEnabled`**（其余读写路径均有该开关门禁，见 1691/1869/2679/2796/3137/3616）。
2. 水位自动骨架账本：`lib/index.js:2002-2024` — `checkWaterLevel` 内 `waterLevelAutoHandoff!==false` 且本会话未写过时触发（每会话一次，`rt.waterLevelAutoHandoffDone`）；骨架从"已策展源"抽取（今日日志尾部 16 行 2008、失败行去重 4 条 2009、反思摘要 2010、笔记头部 6 行 2011），**四段标题在代码里硬编码**（2014-2017：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步`），`slice(0,4000)`（2018）后**直调 `writeHandoffLedger`（2019）——完全绕过工具层门禁**。
3. 接续前刷新仪式：`lib/index.js:2502-2509` — `refreshRitualPrompt()` 明文要求旧会话执行 `memory_note(kind=plan)`（2505）与 `memory_note(kind=handoff)` 四段式（2506）。宿主侧 `hostRefreshRitual`（2540-2574）经 `sessionController.prompt` 发回旧会话并轮询 `handoffMaterialStamp`（2524-2533，PLAN mtime+最新账本名指纹）等待材料变化；client 路径 `refreshOldSession`（`lib/client.js:2117`）+ `waitForRefresh`（2145-2166）同序。

**四段式标题在代码里的全部映射点**

- prompt 约束（唯一的"生成质量约束"载体）：`lib/index.js:445`（水位建议 `snapshotWaterBody`，四段各≤5行的完整描述）、`2506`（刷新仪式）、`3703`（静态纪律 `renderMemoryStatic` 中的账本质量纪律：每段≤5行、失败项写「方案→失败原因」、下一步必须可直接执行）。
- 结构消费：`lib/handoff-anchor-pre.js:18-23` — 四段权重表 `HANDOFF_LEDGER_WEIGHT_VERSION='handoff_ledger_weight_pre_v1'`：已试方案与失败原因 `.35` > 进度与下一步 `.30` > 目标 `.20` > 任务状态 `.15`；未知 `##` 段权重 `.05`（27）。
- 水位骨架硬编码：`lib/index.js:2014-2017`。
- 权重化截断实现：`lib/handoff-anchor-pre.js:41-58`（`parseHandoffLedgerPre`：行级切分 `## ` 标题，无任何段 → 返回 null fail closed）；`91-114`（`weightedTrimHandoffLedgerPre`：预算充足逐字节原样返回；不足从最低权重段截 body、保标题、截点带 `TRIM_MARK`（28）；仍超回落 `slice(0,budget)`）。

**账本命名**

- `lib/index.js:1667-1679` — `writeHandoffLedger`：每篇新文件 `handoff-<handoffStamp()>.md`（1669，即 `handoff-YYYYMMDD-HHMMSS.md`）；同秒 `-b..-v` 后缀（1672）；模型 content 自带的 `# 交接账本` 标题行一律剔除（1673），正文经返回值 `clean` 带回（1675）供 state 同步（7087）。

---

## 三、注入/检索路径（新窗口如何唤醒）

**接续材料组装：`buildContinueCarry`（`lib/index.js:2677-2792`）**

- 2682-2688 — 读 PLAN 全文 + 最新账本；工作区无账本 → 降级全局最近账本（`ledgerFrom='global'`，2687）。
- 2689 — `buildPrevSessionPack`（2592-2671）：定位旧会话 `~/.dsh/sessions/<ws>/<sid>/session.jsonl[.zstd]`，逐帧 zstd 解压折叠，转写落盘 `handoff/prev-session-<sid8>-<HHMMSS>.md`（2638）；单条截断 2000 字符、总长上限 60000（2649、2655）。
- 2712 — **第0层**：`【第0层 · 白板 PLAN.md(节选)】` + `plan.slice(0, 3000)`。
- 2713-2723 — **第1层**：账本 8000 预算 `weightedTrimHandoffLedgerPre(ledger, 8000)`（2720，动态 import，失败 fail-soft 回落位置截断 `slice(0,8000)` 2717——注释明示 I4 绝不阻塞接续，2715）；预算 8000 与动态快照的 `handoffLedgerChars`(800) **不同源不复用**（2716 注释）。
- 2725-2726 — **第2层**：近期线程 `tailText`=最近 20 条消息、单条 700 字（2667）。
- 2727-2737 — **第3层**：转写文件绝对路径 + 按需 read 指令（"仅在第0-2层不足以推进时再 read"，2730）。
- 2739-2760 — P5 接续锚点表：`buildL0IndexPre(body, {maxChars:48})` 对工作区笔记/今日日志各取 10 条 `mem_<32hex>` 锚点摘要，置于 parts 末尾（预算超限时先被截掉=自动回退平铺，2742-2743）。
- 2774 — `carryText = parts.join(NL+NL).slice(0, 18000)`（材料总预算 18000 字符）。
- 消费端两条：宿主兜底 `hostAutoContinue`（2264）在 2279 取材料、2305 `sc.prompt` 直接作为新会话首条消息；client 路径 HTTP POST `/handoff-continue`（7381-7393，7390 调 `buildContinueCarry`）→ `lib/client.js:2226` → `executeContinue`（2167-2213）在 2201 `rf.session.prompt` 注入 `d.carryText`。

**动态快照注入（每轮 user-role 快照，非接续场景也在注入）**

- `lib/index.js:3593-3690` — `renderMemoryDynamic`：白板注入点 3616-3618（`handoffPlanChars` 预算，默认 1200，配置定义 255-256）＋最新账本注入点 3619-3620（`handoffLedgerChars` 预算，**默认 800**，配置定义 257-258）；均经 `stripSensitiveSections`+`sanitizeForInjection`+`truncateLinesBounded`（行边界截断，482-487）；位于动态快照**首位**（在日志/笔记段之前，3614 注释）。
- 3623-3624 — 工作区未绑定时注入全局最近账本**绝对路径指针**（模型自行 read）。
- 3627-3628 — 水位越阈（≥0.75 且 10 分钟内）注入 `snapshotWaterTitle/Body`（445）。
- state 来源：`_doRefresh`（3107-3205）在 3137-3146 读 PLAN+最新账本入 `state.planText/latestHandoffText`；写入工具同步同字段（7086-7087）。
- 注册：`lib/index.js:6958-7024` — `ctx.systemPrompt.context({name:'dsh:auto-memory-pre'})`（user-role 快照追加历史尾部）；频率控制（日志段指纹+`snapshotMinGapRounds`，6971-7019）；压缩后强制重注入（6984-6989）。

**"检索"逻辑现状**

- 唯一的检索是**词法行级匹配**：`searchHandoffCorpus`（1689-1719）对 `白板 PLAN.md`（每文件最多 3 命中行）＋最新 12 篇账本（2 行）＋20 篇归档（2 行）做 `line.toLowerCase().includes(term)` 计分，平铺直返；`handoffEnabled===false` 时返回空（1691）。
- 路由：`recall()`（3827-3853）`scope='handoff'` 走 3838-3844；`scope='all'` 时白板语料并入头部（3875-3881）；`scope='sessions'` 走 `searchSessionHistory`（1722-1735，sessionQuery 部署时可用）；工具参数面在 `lib/index.js:7169`（`memory_recall` 的 `scope` 枚举）。
- 结论：**主注入路径是平铺**（固定分层+预算截断+一张锚点表），没有图导航/主动重建；P5 锚点表是唯一的"地图"形态（也只覆盖笔记与日志，不覆盖白板与账本本身）。

---

## 四、前缀缓存约束（I1 字节级稳定的实现）

**不变量出处**：`docs/CONTINUITY-FLOW.md:159-168` 定义 I1-I5（I1=前缀缓存字节级稳定：只动动态快照层，静态纪律层字节不碰；I3=凭证永不进提示词；I4=绝不阻塞接续）。代码中显式引用 I4 的注释在 `lib/index.js:2715`。

**静态/动态分离（I1 的实现点）**

- `lib/index.js:3590-3592` — 关键注释：动态记忆 → `ctx.systemPrompt.context()`（user-role 快照追加在历史尾部，内容变化才追加、由 dsh-agent-loop `project()` 去重）；system prompt 不含动态内容 → 字节级稳定 → DeepSeek 前缀缓存全程命中。
- `lib/index.js:3692-3715` — `renderMemoryStatic`：固定纪律文本（含白板/账本写入纪律 3703），同步、零状态依赖；注册为 `ctx.systemPrompt.section`（7026-7032，`text: () => ...` 无动态输入）——字节稳定锚。
- `lib/index.js:6956-6958` — 动态快照注册为 `ctx.systemPrompt.context`（6958-7024）。
- `lib/index.js:3134` — refresh 注释：白板/账本"内容属动态层，不碰静态字节"。
- 动态快照内部结构：`<memory_system>` 头（3608）…铭文行（3686，含日期，注释明示"秒级时间戳也不再击穿 system prompt 前缀"）…`</memory_system>`（3687）。
- 防意外击穿：`neutralizePromptTemplateVars`（6050-6052）无 `{{` 时恒等变换（3713-3714 注释）；白板/账本块注入前统一清洗（3617、3619）。

**接续链路的缓存影响**

- `carryText` 是新会话**首条 user 消息**（`lib/client.js:2201`、`lib/index.js:2305`），含材料 mtime 时间戳（2692-2703、2712-2723）——单次接续内写定后不再变化（对该新会话的前缀稳定）；跨接续会话间不共享。
- P5 锚点表被明确设计为字节稳定："同输入 → 同抽取+同排序+同格式"（2740 注释）——这是新检索方案必须保持的性质。

---

## 五、写入路径与校验

**触发条件汇总**（写入白板/账本的仅此三条通路）

| 通路 | 代码位置 | 门禁 |
| --- | --- | --- |
| 工具 `memory_note(kind=plan/handoff)` | `lib/index.js:7078-7091` | sanitizeForWrite（7079）；**无 handoffEnabled 检查** |
| 水位自动骨架账本 | `lib/index.js:2002-2024`（写 2019） | `waterLevelAutoHandoff` 开关 + 每会话一次；**直调 writeHandoffLedger，绕过工具层** |
| 刷新仪式（旧会话自己调工具） | `2505-2506` + `hostRefreshRitual` 2540-2574 + client 2117/2145 | 仅 prompt 约束，产物仍走通路 1 |

**写入前校验现状（"判据校验缺失"证据链）**

- 已有校验=通用卫生闸门 `sanitizeForWrite`（`lib/index.js:6059-6083`）：空内容/乱码密度>0.001/复读退化（hasStutter）/raw JSON envelope/base64 行/连续同文行≥3，超长截断（6070-6073）；原因表 `WRITE_GATE_REASON`（6092）；保留语法改写 `sanitizeReservedSyntax`（6088-6090，`<!-- memory:` → `<!--memory:` 防锚点冲突）。返回 `{ok, reason, clean}` 模式（6063-6082）。
- `writeHandoffLedger`（1667-1679）对 content 做的唯一结构处理 = 剔除 `# 交接账本` 标题行（1673）+ 加系统头（1674）。
- `writePlanSnapshot`（1620-1662）对 content 做的唯一结构处理 = P7 节分类老化（1633-1656）。
- **判据（四段齐全、每段≤5行、下一步可执行、失败项含报错词）无任何代码校验**：
  - 这些纪律只存在于 prompt 文案（445、2506、3703），是纯"模型自觉"约束；
  - `parseHandoffLedgerPre`（handoff-anchor-pre.js:41-58）虽能解析四段，但只在**注入端**被调用（2720）；解析失败返回 null → 注入端 fail-soft 回落位置截断（2722）——是读取端的容忍，不是写入端的拦截；
  - 水位骨架（2019）绕过工具层，即使把校验加在工具里也覆盖不到该通路 → 校验必须下沉到 `writeHandoffLedger`/`writePlanSnapshot` 才能全覆盖。

---

## 六、最小改动点清单

### P1 判据校验中间件（写入路径上加校验函数）

| # | 改动点 | 位置 | 上游（谁调它） | 下游（它调谁） | 改动量 |
| --- | --- | --- | --- | --- | --- |
| 1 | 新建纯函数校验模块（建议 `lib/ledger-criteria-pre.js`，仿 handoff-anchor-pre.js 契约：纯函数、零 IO、fail closed） | 新文件 | index.js 两处写入函数 | 复用 `parseHandoffLedgerPre`（handoff-anchor-pre.js:41）判段结构；自身判段数/段名/段行数/下一步特征 | 新增 ~100 行 |
| 2 | `writeHandoffLedger` 入口插校验（或 1674 `writeFullRaw` 之前） | `lib/index.js:1667-1679` | ① `memory_note` 7084；② 水位骨架 2019 | `writeFullRaw`(3798)、`handoffStamp`(464)、`memToday`(3208)、`nowHm`(462) | ~5 行 |
| 3 | `writePlanSnapshot` 入口插校验 | `lib/index.js:1620-1662` | 仅 `memory_note` 7083 | `writeFullRaw`(1657) | ~5 行 |
| 4 | 工具层拒绝文案：把判据 gate 并入 7079-7081 的 `sanitizeForWrite` 判定处，仿 `WRITE_GATE_REASON`(6092) 模式返回可执行的改写指引 | `lib/index.js:7078-7091` | harness 工具分发 | 新校验函数 | ~10 行 |
| 5 | 水位骨架路径的 fail-soft 策略：校验不过时照写+diag+骨架内加警示行（或仅记日志跳过），**不得阻塞接续**（I4，`docs/CONTINUITY-FLOW.md:165`） | `lib/index.js:2002-2024` | `checkWaterLevel`(1867) ← pre-step 钩子 2049 与 `agent/turn-stopping` 钩子 6868/6884 | 通路 2 | ~5 行 |
| 6 | 回归测试：仿 `tests/smoke/smoke-test-handoff-anchor-pre.mjs`（fixture 锁定+源码守卫）；注意 `tests/smoke/smoke-test-handoff-pre.mjs` 的 G0 源码守卫断言了写入/注入块的存在与顺序（文件头 13-17），插校验后需同步 | tests/smoke | — | — | ~60 行 |

### P2 结构化存储改造（Markdown → 附加结构，增量兼容）

| # | 改动点 | 位置 | 说明 |
| --- | --- | --- | --- |
| 1 | 结构化元数据写入钩子 | `writeHandoffLedger` 返回值（`lib/index.js:1675` `{ok,path,clean}`）与 `writePlanSnapshot` 返回值（1658） | sidecar JSON（如 `handoff/index.json` 或每账本同名 `.json`）在此落盘；现有 Markdown 读取方全部兼容 |
| 2 | 结构化读取视图 | `handoffPanelData`（2795-2874） | GUI 增加 tag/段落级视图；`fileQ` 白名单（2800）需放行新文件名 |
| 3 | 结构化检索 | `searchHandoffCorpus`（1689-1719）与 `recall` scope 路由（3838-3844、7169） | 词法匹配 → 段/Tag 级命中；scope 枚举扩展 |
| 4 | 注入端导航层 | `buildContinueCarry`（2739-2760 锚点表、2708-2711 分层说明） | `expand_tag`/`trace_back` 产物作为新"层"或锚点表扩展；总预算 18000（2774）与字节稳定约束（2740）不变 |
| 5 | 白板/账本条目加锚点（可选，图化前提） | `writeHandoffLedger`/`writePlanSnapshot` 写入时为节/条目生成 `<!-- memory:mem_<32hex> -->` 锚 | 复用 `parseMemoryItemsPre`（l0-extract-pre.js:54）切分；注意与 `sanitizeReservedSyntax`（6088）的豁免写法约定 |

### 完全不用动

- `lib/client.js` 接续流程（`refreshOldSession` 2117 / `waitForRefresh` 2145 / `executeContinue` 2167-2213 / `runContinueFlow` 2214-2232）——只透传 `carryText`。
- 宿主接续执行器 `hostAutoContinue`（2264-2335）与接续序号持久计数器（2106-2160）。
- `lib/memory-writer.js` / `memory-writer-pre.js`（自动沉淀完全不涉白板/账本，grep 零命中）。
- `lib/water-window-pre.js`、`lib/l0-extract-pre.js`（纯函数，原样复用）。
- `DEFAULT_PROMPT_LAYERS`（434-455）与静态纪律 `renderMemoryStatic`（3693-3715）——**I1 禁止改动其字节**；判据纪律如果要进 prompt 只能加在动态层或另开 section（需评估）。
- `readLatestHandoff`(1603)/`listHandoffLedgers`(1682)/`findLatestGlobalHandoff`(1584)/`handoffMaterialStamp`(2524)——sidecar 增量方案下原样可用。

---

## 七、现有可复用件盘点

| 组件 | 位置 | 能力 | 与新方案重叠度 |
| --- | --- | --- | --- |
| `parseHandoffLedgerPre` | lib/handoff-anchor-pre.js:41-58 | 四段账本解析（preamble+sections+权重），无段 fail closed | **最高**——判据校验与结构化解析的地基，可直接复用为校验前置解析 |
| `weightedTrimHandoffLedgerPre` | lib/handoff-anchor-pre.js:91-114 | 权重化预算截断（.35/.30/.20/.15），预算内逐字节原样 | 高——新检索方案下注入预算控制仍必需 |
| P7 白板老化 | lib/index.js:1633-1656 | 确定性节分类+移动不删除+fail-soft | 中——"节级 lifecycle"范式可推广（如 dead-end 节自动下沉归档） |
| 归档机制 | lib/index.js:1626-1631 | 旧版白板 `archive/PLAN-<ts>.md` 版本历史 | 中——结构化方案的版本链可直接挂在现有归档上 |
| `buildL0IndexPre`/`extractL0Pre`/`parseMemoryItemsPre` | lib/l0-extract-pre.js:118/84/54 | 锚点切分+确定性 L0 摘要（同输入同输出） | 中——"条目地图"地基；但 PLAN/账本当前**无锚点**（锚点仅存在于开启 memoryAnchorEnabled 的 notes/log），图化需写入端新增锚点注入 |
| `searchHandoffCorpus`+scope 路由 | lib/index.js:1689-1719 / 3838-3844 | 白板语料词法检索（行级 includes 计分） | 中——可原地升级为结构化检索的工具面 |
| `handoffMaterialStamp` | lib/index.js:2524-2533 | 材料变化指纹（PLAN mtime+最新账本名） | 中——判据校验失败重试、仪式等待、sidecar 失效检测可复用 |
| `sanitizeForWrite`+`WRITE_GATE_REASON` | lib/index.js:6059-6092 | 写闸门 `{ok,reason,clean}` 模式与拒绝文案模式 | 中——判据中间件照此模式实现，工具层文案零新概念 |
| `stripSensitiveSections`/`sanitizeForInjection` | lib/index.js:5987/6054 | 注入端敏感段清洗 | 中——任何新注入块必须复用（I3） |
| `handoffPanelData`+`/handoff-state` | lib/index.js:2795-2874 / 7370-7377 | 面板数据+严格白名单文件读取 | 低-中——结构化视图挂载点 |

---

## 八、给 R3 的关键代码事实（一句话版）

1. 四段式结构目前**只活在 prompt 文案里**，写入端零校验、解析端仅注入时消费——P1 校验中间件的两个咽喉是 `writeHandoffLedger`(index.js:1667) 与 `writePlanSnapshot`(1620)，其中账本咽喉可同时覆盖工具与水位骨架两条通路。
2. 注入是"固定分层平铺"而非检索；唯一的结构化地图是 P5 锚点表（2739-2760，且不覆盖白板/账本）；检索仅 `searchHandoffCorpus` 词法行匹配（1689）。
3. 前缀缓存纪律已工程化：静态纪律 section（7026）/动态快照 context（6958）分离，白板/账本/水位全部位于动态层（3614-3628）；新方案的图导航产物必须放动态层并保持"同输入同字节"（2740）。
4. 结构化存储的最小路径是 sidecar JSON（写入钩子在 1675/1658 返回值处），现有全部 Markdown 读者（1603/1682/1584/2795）可原样兼容。
