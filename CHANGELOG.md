# Changelog

All notable changes to dsh-auto-memory.

---

## [3.0.0] — 2026-09-17 · 底层重建收官（大版本）

> **这是大版本。** 3.0 线把插件的检索、注入、容量、并发四条底层全部重建，并把「白板/看板」从实验特性提升为出厂形态。
> **升级须知（三条默认值变化，都可显式改回）**：①**白板默认开启**（`handoffEnabled: true`，原为 false）②**白板默认新版看板**（`boardMode: 'graph'`，旧版文字白板保留为兼容档，工具数 14→16）③**自动接续仍默认关闭**（`autoContinueEnabled: false`，本次特意维持——判据尚未实机验证到位）。老用户已落盘的显式设置**不受影响**，只有从未设过该键的用户吃这组新默认。

### 变更 · 白板线（兼并 dsh-graph，含可视化）

- **`boardMode` 默认翻为 `graph`**：出厂即启用新版看板——结构化 sidecar（`handoff/index.json`：条目/标签倒排/线索索引/版本链）+ 列式泳道矩阵（行=日期分组，列=5 泳道）+ 两个遍历工具（`memory_expand_pre` 按 tag 展开、`memory_trace_pre` 按 id 回溯）。**`legacy` 完整保留**：显式设置即回到字节级旧行为（文字白板、14 工具）。
- **可视化长在本插件自己身上**，不并列挂第二个插件：不新增 profile bundle、不新增存储、不新增工具命名空间。
- **`handoffEnabled` 默认翻为 `true`**：白板（PLAN.md 项目全貌）+ 四段式交接账本是 3.0 的招牌能力，出厂关着等于新用户看不到它；且 README/用户手册早已对外声称「交接默认开启」，此项现在与文档一致。
- 面板新增看板路由与两处一键切换按钮（白板页 / 设置页），切换即时回显并落盘。

### 缺陷修复 · 语义索引永久不就绪（记忆唤回全程降级的真因）

- **症状**：`memory_recall` 的语义臂长期不可用，每轮降级为「词法命中 + Tier-0 常驻目录」，只出目录层、不下探 Tier-1/Tier-2。诊断日志 `index-not-ready` 累计 **22,945** 行，自 2026-08-26 起持续；**worker 重启后仍继续产生**（实测重启后仍增 1,593 行）⇒ 重启只是暂时缓解。
- **根因（代码级）**：JS 侧契约是「新 miv latest-wins；旧 in-flight sync abort/cancel」，但 `abort()` 只作用于 JS 的 fetch，**Python 从不收到取消帧**；而 worker 的 `active_sync` 原先只在「主动拒绝」与「commit 成功」两处清零 ⇒ 一次「begin 之后没收 page/commit」的同步会把槽**永久占住**，此后每次 `index_begin` 都被回 `sync-in-progress`，索引再也建不起来（`engine-switch-state.json` 记 `failed:2527`）。
- **修复**：给 `index_begin` 补两条「**可证已死**」的接管出口——①同 key（同 workspaceRef+scope）但 syncId 变了（= JS 已按 per-key latest-wins 放弃旧的）②距**最后一次活动**超过 150s 仍无进展（> JS 侧 syncTimeoutMs 120s，保证 JS 先放弃、worker 后回收）。按「最后活动」而非「开始时间」计时，避免误夺正在推进的长同步（BGE 加载+全量建库可能很久）。
- **未放宽拒绝矩阵**：同 key 同 syncId 重复 begin 仍拒 `sync-in-progress`；**跨工作区并发仍按原样拒绝**（worker 只有一个槽、而 JS 的 abort 是按 (wsRef,scope) 的，故不能一律让新 syncId 抢占，否则工作区 B 会踩掉 A）。协议帧格式零改动。

### 缺陷修复 · 其他

- **升级弹窗看不到本版说明**（`lib/client.js`）：`bigKey` 原为硬编码 `'2.1.0'` ⇒ 老用户升级到 3.0.0 时弹的仍是 2.1.0 的说明卡。改为**动态取当前版本**（本版有条目就弹本版），以后每个大版本自动正确。
- **多工作区/多会话适配（4 处「单槽」）**：同时跑两个会话时「谁也没法注入」；点进不同工作区时语义模型跟着走。根因是引擎里 4 处状态写成单槽变量（`engine._tierGateHits` 整体覆盖、`mivCache` 只认最后一个 wsRef、`lastIndexDegrade` 读方只判 10 分钟窗、`_lastTierQuery` 无条件覆盖），A/B 交替时互相覆盖。现按会话/工作区分片；旧字段保留为兼容投影，老读取方不受影响。
- 外部贡献者 PR 合并：**#36 / #44 / #46 / #49 / #50 / #53 / #37**（procedure 观测标记、容量计费与原子替换、欢迎向导配置闸、recall 记录截断、原子 rename 重试、白板概览日期匹配、接续 idle 门讨论）。对应 issue **#30 / #35 / #38 / #40 / #45 / #48 / #51 / #52 / #54** 全部处理完毕。

### 内部重构 · 3.0 底层重建八阶段（全部结项）

- **P0** 写入门 + 判据账本 + 注入表达 ｜ **P6A** 注入节奏与措辞 ｜ **P1** 状态提交 + miv 单源 + 并发原子写 ｜ **P6B** `kind` 持久化 + 撤回 + 迁移。
- **P2** 真增量（embedded 真实输入数/复用顺序/引擎身份门）+ 引擎身份与切换状态机。
- **P3** 共同检索融合决策：R1 双显示（绝对分 + #N finalRank；`opts.fusion:'legacy'` 可回滚）+ 词法臂独立。
- **P4** 精排多级 + 有界异步窗口：档位门、入队起算到期不续命、LRU≤16、busy 门、审计。
- **P5** 验收清单（`lib/acceptance-pre.js`：7 必需项 + U1 兼容门 + release-ready 门）。
- **三层注入（C5）**：Tier-0 常驻目录（指引层）＋ Tier-1 下探 ＋ Tier-2 证据；索引未就绪时**显式降级不静默丢弃**。

### 流程

- 发版固定流程四件套：`docs/internal/RELEASE-PROCESS.md`（检查表）＋ `docs/prompts/RELEASE-AGENT.md` 等四份子代理任务书 ＋ `tools/release.mjs`（pre→发布线转换与三道版本标识闸门）。
- README 与用户手册双语按大版本标准改写（for-the-badge 徽章、技术段、3.0 章）。

### 验证

- 全量回归 **106 套件 / FAIL 0 / TIMEOUT 0（182.8s）**（3.0 基线 105 套件；本版新增「索引同步卡死自愈」套件 9 断言）。
- 变异演示：把索引接管分支改回「恒拒绝」⇒ 新套件真红 **PASS 7 / FAIL 2**（T2 实测 `sync-in-progress`、T4 实测 `unknown-sync` + `transport:worker-error`），且 T1/T3/T5 保持绿（证明钉的不是同一件事）；变异后按 SHA256 逐字节还原并复跑 9/9。
- `node --check` 双文件通过；改动文件无 BOM；`py_compile` 双 worker 通过。

---

## [2.5.3] — 2026-09-14 · 水位虚高修复（PR #31，外部贡献者）

- **修复：`provider/id` 前缀式模型 id 的窗口被静默丢弃导致水位虚高**（贡献者 Minervaowl7，PR #31，已合并）。`parseModelWindowsPre` 的 id 字符类不含 `/`，而 `deepseek/deepseek-v4.1-flash`、`z-ai/glm-5.3-flash` 这类 provider 前缀写法很常见 ⇒ 整条 id 行匹配失败、其 `contextWindow` 被丢弃，窗口退化为 fallback 131072。实测真实窗口 1,000,000 的会话被按 131,072 当分母，**水位放大 7.63 倍（12.8% 显示成 98%）**，未达阈值即误弹接续确认卡。
- 配套补齐 PR #31 第二半：id 行存在但格式仍不被识别（带引号/含空格/中文等）时**重置 `currentId`**，避免紧随其后的 `contextWindow` 被记到上一条模型头上——静默错配比"读不到"更危险（读不到只退化为 fallback，错配会给出偏小的窗口使水位漏报）。

---

### 缺陷修复

- **开启「无人值守模式」的用户切工作区整个失灵**（面板恒显示启动目录、今日日志 0、注入报"当前会话未绑定工作区"）：`resolvePaths` 的防漂移锁是**全局**的——`state.ws` 一旦确立就被永久钉死，所有会话的解析都被拉回首个工作区（终端用户只读诊断实证，判 C 类）。现改为**按会话锁定**：每个会话首次解析出有会话身份依据的工作区时记入本会话运行时，只防**本会话内**的 cwd 漂移（设计本意保留），不再跨会话污染；未开启该模式的用户行为不变。
- **面板白板/账本恒显示「最近活跃会话」的工作区**：`handoffPanelData` 收到 sessionId 却只用于水位，白板/账本/归档全部取全局单值。现按 sessionId 解析——查看哪个会话就显示哪个会话的白板。
- **会话经 workspaceId 创建时 header.cwd 缺失，静默回退到 dsh 启动目录**：新增按会话身份的回退链（workspaceRegistry 的 sessionIds 反查 → 持久化会话日志首行 cwd，头帧解码防 Node 22 崩溃，带缓存零热路径开销）；全部落空时如实返回 `wsBound:false`，面板显示「当前会话未绑定工作区」而不是错误路径下的空内容。
- **宿主刚重启、面板先于任何会话活动打开时误报「白板未启用」**：`handoffPanelData` 补配置加载守卫（`handoffEnabled` 出厂默认 false，未加载配置时按默认值误判）。

### 验证

- 新增 `smoke-test-wsfix-pre.mjs` **16 断言**：双实例（无人值守开/关）对照——按会话解析互不污染、会话内漂移保护保留、registry/持久化头两级回退、未绑定诚实返回、无 sessionId 全局调用方兼容、默认配置零影响。
- 全量回归 71 套件 0 失败；`node --check` 双文件通过；无 BOM。

---

## [2.5.1] — 2026-09-13 · Node 22 巨型会话文件宿主崩溃修复（PR #29）

### 缺陷修复

- **DSH Desktop 0.5.10（Electron 内置 Node 22.22.1）下，装上本插件后 dsh web 启动 60–155 秒必崩**：每日兜底巡检 `scanPluginSubagentSessions` 会对 `~/.dsh/sessions` 下每个会话**全量解压** zstd，Node 22 的实验性 zstd 在解压巨型会话文件（数 MB 压缩、数万帧）时直接令宿主进程崩溃（crashpad 报 `not connected`，无 JS 异常可捕获）；同样文件在 Node 24 下正常。社区贡献者 **fei009009**（PR #29，已合并）定位并修复：新增 `decodeZstdFramesHead`（只解前 8 帧 / 4MB 即停），扫描判定只需首帧附近的 header 与 subagent descriptor；全量解码保留给确需全文的路径。
- **同类全量解压路径一并加固**：`waterWindowForSession`（切会话时从磁盘推导模型/窗口）改为头帧解码（前 32 帧 / 8MB——request/header 与 request/context 都在会话开头），与巡检扫描同防（PR 作者在遗留建议中指出）。

### 验证

- `smoke-test-subagent-gc-pre.mjs` 新增 **G13**：帧数在上限内头帧解码=全量解码 / `maxFrames=1` 只解首帧 / 前 2 帧即可完成扫描判定；`smoke-test-water-hard-trigger-pre.mjs` 新增源码反向锁（`waterWindowForSession` 不得回退全量解压）。全量回归 70 套件 0 失败。

---

## [2.5.0] — 2026-09-13 · 水位口径对齐官方压缩 · 接续序号持久计数器

> 覆盖：v2.4.2 遗留的两项判据修正（NEXT-VERSION-TODO 改点 1/2）+ 发版流程外包（改点 3，纯文档）。水位触发不再"刚过半就接续"；接续序号不再错乱。**`autoContinueEnabled` 出厂默认仍为关**——等实机验证新口径后再决定是否翻回。

### 变更 · 水位判据口径（改点 1）

- **正常触发线与官方压缩同坐标系**：分母改为**官方声明窗口**（provider 自报过硬限时取二者较小值），不再把「预留输出」（本机 384,000）从分母里扣掉。阈值 0.75 的触发点从 ≈46 万 token 后移到 ≈78.6 万（1,048,576 窗口），与官方"约 80% 才压缩"站在同一条线上。
- **新增预测性硬墙判据**：`estTokens + reserve > 判定窗`（下一次请求必被 provider 拒绝，即实测 400 事故的复现边界）时**立即硬触发**，不等比例线；compaction / CONTEXT_WINDOW_EXCEEDED 两个既有硬触发不变。
- **reserve 退出分母**，只保留两个职责：「距硬墙余量」展示（硬限 − 预留）与上面这条硬判据。水位 / ring / 触发比例三者同分母，确认卡与面板不再各说各话；反向锁（`water-hard-trigger` 套件）断言"不得把 reserve 计入分母"。
- 大预留路由说明：本机这类 reserve=36.6% 窗口的路由，硬墙点（≈66.5 万）会先于 0.75 比例线（≈78.6 万）到达——那是"下一步必 400"的最后一格，不是浪费；常规路由（reserve < 25% 窗口）仍由比例线先行。
- 设置页阈值提示与接续确认卡文案同步改为官方窗口口径（中英双语）。

### 变更 · 接续序号（改点 2）

- **`contSeq` 改持久计数器** `~/.dsh/memory/cont-seq.json`：全局单调递增，**换工作区接续不重复已有序号**（byWorkspace 记账）。旧口径（数 handoff 目录里 prev-session 包文件数 +1）在落盘失败 / 跨工作区 / carry 复用时会重复、跳号或为空——为空即 rename 被跳过、新会话标题退回自动生成（实机两次观察到）。
- **分配与落盘成序**：先分配序号、再写转写包；**包落盘失败回滚计数器，不跳号**。
- **兜底链**：包已分配 → 持久计数器 → 计数器缺失时从历史「接续 #N / Cont.#N」标题解析最大值（兼容老数据）→ 旧文件数口径 → 1。`contSeq` 恒非空，宿主与浏览器两条 rename 路径都不再被跳过；浏览器路径 rename 失败不再静默（console.warn 可见）。

### 流程（改点 3，纯文档）

- 发版流程外包子代理固化：`docs/internal/RELEASE-PROCESS.md` 顶部新增**角色分工**（主对话=决策者，只做开闸/放行/处置；子代理=执行者，出错即停，回报 `{ ok, version, pre_sha, rel_sha, tag, npm_latest, failed_step, error_tail }`）。
- 新增任务书：`docs/prompts/RELEASE-AGENT.md`（发版执行）、`REGRESSION-AGENT.md`（全量回归）、`DOCS-AUDIT-AGENT.md`（双语对账）、`TRACE-PATROL-AGENT.md`（痕迹巡检）。

### 验证

- 全量 smoke **70 文件 0 失败**（新增 `smoke-test-contseq-pre.mjs`：持久化 / 跨工作区不重号 / 落盘失败回滚不跳号 / 标题扫描兜底 / 重启后递增，20 断言）；`water-hard-trigger` / `water-window` / `water-step` / `autocont-host` / `continue-host` / `continue-chain` / `handoff-anchor` 全绿；`node --check` 双文件通过；改动文件无 BOM。

---

## [2.4.2] — 2026-09-10 · 自动接续改为出厂默认关闭

> 一行默认值变更 + 一把反向锁。目的：在触发判据尚未与官方压缩口径对齐之前，不让公开用户被过早接续白白消耗 token。

### 变更

- **`autoContinueEnabled` 出厂默认 `true` → `false`**。原因：现有水位判据把该路由的**预留输出**从分母里扣掉（`effectiveWin = win − reserve`，本机 1,048,576 − 384,000 = 664,576），实测「上下文刚过半」即触发，而官方约在 80% 才压缩 —— 早约 45%。想用的人可在「白板 / 接续」页签手动打开。
- **老用户已落盘的显式值不受影响**（只改默认值，不改已有配置）。
- 新增**反向锁**：`smoke-test-autocont-host-pre.mjs` 断言出厂默认必须为 `false`，防止在判据修好之前被悄悄翻回。

### 待办（下一版，本版不含）

- 水位判据口径（改为与官方压缩同坐标系、`reserve` 只用于"距硬墙余量"与硬触发）与接续序号（改持久计数器）两项，已记录在 `docs/internal/NEXT-VERSION-TODO.md`。

### 验证

- 全量 smoke 69 文件 0 失败；`autocont-host` **71/71**（含新增反向锁）。

---

## [2.4.1] — 2026-09-10 · 接续闩锁 · 面板状态修复 · 界面路径表锁 · 版本标识同步

> 覆盖：自动接续重复建会话（闩锁）、接续确认卡状态残留、水位双口径渲染缺失、界面侧内部重构（路径表一致性锁 + 写配置单一出口 + 语义刷新去重）、发版流程固化两笔（CHANGELOG 与软件内版本标识必改）。

### 缺陷修复

- **已接续的会话被再次接续（重复建窗口）**：旧实现只有 30 分钟冷却，冷却一过、水位仍高即再次 arm。新增**已接续闩锁**（`~/.dsh/memory/auto-continue-done.json`，以 session id 为键、落盘、重启有效）：宿主路径在交接材料投料成功后落闩，浏览器路径在新会话真建成后落闩，**失败不落闩**以便重试；并按 diag 证据预置一条既有记录。
- **确认卡状态残留**：宿主已完成接续后，卡片仍停在「同意接续 / 拒绝」并与「✓ 已自动接续到新会话」并存 —— 两个分支先清 `acConfirm` / `acCd`；`lastOk` 加 10 分钟有效期（宿主状态是全局单值，不设期限会挂到每个窗口）。
- **水位双口径那一行永不渲染**：客户端漏拷贝 `ring` / `wall`，已补。
- **armed 串窗口**：`autoContinueState` 改为按 `sessionId` 过滤（取不到 id 时 fail-open），不再在别的窗口弹「本会话水位已达 x%」。

### 内部重构（界面半边，功能零变化）

- 路径表引入唯一前缀常量 + **一致性锁** `tests/smoke/smoke-test-api-paths-pre.mjs`（客户端路径 ⊆ 宿主路径、宿主独有仅白名单两条、表外零裸字面量、注册键在表内）。
- 写配置 4 条路径收敛为单一出口 `saveConfigPatch()`；10 处逐字重复的语义状态刷新收敛为 `refreshSem()`。
- 修掉 `smoke-test-m53-pre.mjs` 的顺序敏感 flake（固定 `sleep(900)` → 有界轮询，断言口径不变）。

### 流程（本次固化）

- **发版必改 CHANGELOG**；**发版必同步软件内版本标识**（应用内更新说明字典、界面指纹行、`package.json.version`）。
- `tools/release.mjs` 增加校验：以上任一项与新版本号不一致即**拒绝构建**——避免检测更新时仍拿旧版本号去比对。

### 验证

- 全量 smoke 69 文件 0 失败；`autocont-host` 70/70、`continue-chain` 63/63；改动文件 `node --check` 通过、无 BOM。

---

## [2.4.0] — 2026-09-10 · DSH 0.1.5 实机核验修复 · 水位按路由额度 · 记忆容量口径重做

> 覆盖：0.1.5 三项实机缺陷、记忆容量口径重做（字符/文件上限）、Python 引擎贯通修复与向导常驻、接续体验与权限继承、**水位判据按「该会话当前模型」的预留额度自适应**、压缩/溢出即接续、接续材料认会话。

### 缺陷修复（实测于 0.1.5-rc.1 的 live 宿主）

- **自动接续静默失效（严重）**：0.1.5 起 `SessionPromptRequest.requestId` 为必填（客户端铸造的用户消息身份，落到 `source.rpcId`）。宿主侧兜底接续漏传该字段时，官方在 `createUserMessage` 处抛普通 `Error`，并被包装成**误导性的** `session/agent-busy / "prompt rejected"` —— 现象是**新会话建出来了、但交接材料从未送达**（实测 14:02 接入生成的会话只有 314 字节头部即停更）。现补传 `randomUUID()`，并透出官方藏在 `details.reason` 里的真实原因，避免再出现无法排查的一句 "prompt rejected"。
- **`_agentSvc` 恒为空 → `restoreLastAgent` 永久失效**：0.1.5 移除了单数服务键 `ctx.agent`，Agent 注册表改名为 **`ctx.agents`**（`AgentRegistry`）。旧写法使定时兜底每小时刷 `restoreLastAgent: svc missing … agent=false` 且永不恢复。现先取新键、保留旧键兜底以兼容 0.1.4 及更早。
- **诊断日志被会话回放刷屏**：DSH 载入/观测历史会话时会对每段历史都走一次 accept，而这些 runtime 从未 `capturePaths` → 同一原因一次性刷出上百行（实测单次回放 288 行；最近 6000 行日志里 2976 行是 drop，占近半）。现在同一 drop 原因按 30 秒窗口限流：窗口内只写首条并附 `runtime key`（可定位是哪个会话），其余仅计数。

### 记忆容量与水位检测（第二轮实机修正）

- **整理后复查改为"按实际文件大小迭代、有界重试"**：旧实现只压一轮就复查，而单轮缺口是按"容纳本次写入"估算的 —— 折叠产物、`## 日期` 标题行开销会让实际结果偏小，于是出现"压缩确实成功（折叠块已写入）、复查却不过、工具还把**成功标识** `folded` 当成失败原因报出来"的怪象（实机踩到）。现在每轮都用**重新测量的实际文件大小**算缺口，复查不过就再来一轮（最多 3 轮）；失败时返回**真实**原因（`still-over-capacity` / `compact-made-no-progress`），不再复用成功标识。
- **容量检查计入追加开销**：`capacityCheck` 现在把 `'\n## YYYY-MM-DD\n'` 标题行（约 15 字符）计入，此前会低估导致边界判断偏移。
- **取消 pre-step 水位检查的 5 秒节流（默认 `minGapMs` 5000 → 0）**：旧默认使"两次 pre-step 间隔 <5 秒即整段跳过"（不测量、不 arm），而官方自动压缩挂在**每个** `agent/pre-step` 上、没有任何节流。**模型越快、单步越短，被跳过的概率越高** —— 实测 DeepSeek-V41-Flash 下单步常低于 5 秒，于是官方永远抢先压缩、自动接续从不触发。本函数开销很小（`tokenMeter.measure()` + 最近 64 条会话事件扫描），省这点开销不划算；`minGapMs` 仅保留给测试注入。

### 子代理模型与思考强度（0.1.5 agent 自定义）

- 设置页「子代理模型 / 思考强度」：模型与推理档位（`off` / `low` / `high` / `max`）统一经 0.1.5 的 `SubagentStartRequest.agentOptions` 下发给子代理（时段总结 / 问候 / 自动沉淀 / 蒸馏），**不影响主对话**；留空跟随路由与模型默认。
- 服务端对强度做白名单过滤（DeepSeek 适配器口径 `off|low|high|max`，默认 `high`），非法值直接不下发，避免 `UNSUPPORTED_REASONING_EFFORT` 触发子代理 30 分钟熔断。
- 补回归锁：`prompt` 必带非空 `requestId`（`smoke-test-autocont-host-pre.mjs`）。

### 记忆容量口径重做（新记忆不再被堵在外面）

- **写入预算由「当日写入量」改为「文件容量上限」**：旧口径下"当天写得多"就会撞墙——而压缩对象只有"今天之前"的记录，当天记录被无条件保留，于是可回收集合为空、直接拒绝写入，**必须跨天才自解**（实测：一天写入 8 条约 8,700 字符即触发）。现在只看"写入后总字符数是否超过上限"，超出先自动整理腾位，整理后仍超才拒绝。
- **单位统一为字符**：旧实现记账用字符（`String.length`）、压缩配额用字节（`rec.byteEnd - rec.markerByteStart`），同一个 3000 在中文内容下差约 1.44 倍；且 legacy 文本路径用字符、anchor 路径用字节，开不开 anchor 有效配额还会跳变。现已全部统一为字符。
- **整理改为"先折叠、后退归档"**：超出容量时先把较早内容交给 AI 折叠成要点留在主文件（原文同时归档），AI 不可用才退回整条归档。**要点留在语料里**——不再像纯归档那样"移出索引即被遗忘"。
- **保护窗口 + 硬底线**：最近写入的 2000 字符不参与回收；硬底线是"至少保留最新 1 条"。旧实现"今天记录无条件保留"正是堵死的根因，已移除。
- **节流只限制 AI 折叠，不阻止整条归档**：否则短时间内反复超容量时仍会拒绝写入。节流按层独立（旧实现是单变量，压过用户级会连带节流项目级）。
- **修复重复实现**：`compactAnchoredLayer` 原有 **3 份逐字节相同的实现**（类体同名方法后者覆盖前者，只有最后一份生效），改前两份会静默无效。已合并为一份。
- **报错不再含糊**：旧文案把三种不同原因压成"（刚压缩过或 AI 不可用）"，实测会把使用者直接带偏。现在区分「锚点文件脏 / 无可回收内容 / 折叠与归档都失败」并给出相应处置建议。
- **新增设置项** `noteCapacityChars` / `userCapacityChars`（默认各 12000 字符）——与「注入预算」`injectBudgetChars` 是两回事：前者管文件本体大小，后者管每轮往上下文注入多少摘要。

### Python 引擎「装了用不了」贯通修复

- **配置写错位置（致命）**：向导把 `embedding-config.json` 写到 `<dsh-home>/memory/semantic/`，而本线 worker 读的是 `<dsh-home>/memory/semantic-pre/`（`worker_semantic_pre_v1.load_embedding_config_from_env`）—— 文件写进了**引擎从不读取的目录**，等于没有配置。现写规范路径（发布构建统一把 `semantic-pre` 折成 `semantic`，两线同源）。
- **配置缺 `provider` / `modelDir`（致命）**：向导原先只写 `gpu` 一个键。`load_embedder` 对未知 provider 直接抛 `unknown embedding provider`，int8 分支还强制读 `config['modelDir']`（缺失即 `KeyError`）。现模型下齐后回写 `provider`（`bge-m3-onnx-int8-pre-v1`）、`modelDir`、`onnxFile`、`dimension`，并与既有键做 read-modify-write，不覆盖引擎自管的 `search` / `activationPolicy` / `activationEmitMode`。
- **onnx 落位与 worker 默认路径错配**：向导下载是平铺的 `models/model_int8.onnx`，而 worker 默认按 `modelDir/onnx/model_int8.onnx` 找。现显式写入 `onnxFile: 'model_int8.onnx'` 对齐平铺布局（tokenizer 五件同在该目录根，`AutoTokenizer.from_pretrained(modelDir)` 因此可用）。
- **`depsOk` 探针与安装清单不同口径（致命）**：探针 `import transformers, onnxruntime, torch`，而 `PIP_DEPS_CPU` 从不安装 torch —— `depsOk` 恒为 false，UI 的"全部就绪"**永不出现**。现探针与 int8 档真实依赖同口径（`transformers` + `onnxruntime` + `numpy`，numpy 随 onnxruntime 装入）。
- **就绪判定新增 `configOk`（消除假绿）**：引导卡此前只看 onnx/tokenizer 是否下载齐全，配置坏掉也照常显示完成。现要求配置里的 `provider` / `modelDir` / `onnxFile` 指向磁盘上真实存在的模型与 tokenizer（按实际可加载口径 —— fast 路径有 `tokenizer.json` 即可，缺 `sentencepiece.bpe.model` 不算坏），"全部就绪"才亮起；模型在而配置没指过去时给出可操作提示。
- **安装向导入口常驻**：向导原先只在"资产未就绪"时自动弹出 —— 已经装好的用户反而**无处可点**（想重装、想换模型布局都进不去）。现设置页语义引擎区块常驻一个「🧩 安装向导」开关，随时可开可收；已就绪时打开复用同一套下载/校验步骤。

### 接续体验与权限继承（实机取证修复）

- **刷新仪式不再静默**：接续前的「刷新白板/账本」由浏览器侧执行，此前 `skipped` / 抛错一律被吞掉 —— 用户看到的现象是"点了接续什么也没发生、旧会话毫无动静"。现跳过、失败、超时都回报一句原因，接续本身照常继续（fail-soft 但**可见**）。
- **宿主重启后会话 id 可回退**：刷新仪式用的 `refresh.sessionId` 取自纯内存的 `_lastAgent`，宿主重启后要等下一次 pre-step 才重建；窗口期内它为空串 → 仪式被静默跳过（实测：旧会话在接续前后**零写入**，全文检索无 `[接续前刷新仪式]`）。现内存态为空时按会话日志 mtime 回退取最近活跃会话（5 秒缓存，优先普通会话目录），重启后立刻接续也能刷到最新材料。
- **接续继承旧会话的权限预设**：官方 `session.create` 入参只有 `{workspaceId, cwd, sessionId, agentPreset}`，**没有权限字段** —— 新会话一律走 `PermissionPresetService.pinInitialPermission()` 落 settings 的 `permission.defaultPreset`。于是接续出来的新会话丢掉旧会话的完全权限，静默运行每一步都要批准（实测：旧会话开局 41 秒后即升到完整权限，新会话则回落 `workspace-write + ask`）。现在建会话后按延迟重试取到该会话的 Agent，用 `current(session)` / `set(session, name)` 把旧预设套上去；拿不到就 fail-soft 并记诊断。
- **两条接续路径的行为对齐**：一键接续（浏览器侧建会话）与宿主兜底接续（浏览器关着时宿主直调官方会话服务）此前**行为不同** —— 宿主路径既不做刷新仪式，也不继承权限。现宿主路径补上刷新仪式（先让旧会话刷 PLAN/账本、轮询材料指纹变化或超时，再组装交接材料；只在 `armed.sessionId` 明确时注入，同一旧会话 10 分钟内只注入一次），并改为**按会话 id 从 agents 注册表取旧会话**（`_lastAgent` 重启后可能为空）；浏览器路径补上权限继承（新增 `handoff-permission` 端点，投料前先试一次、投料后再重试，尽量让新会话**首轮**就已继承）。
- **回退只认普通会话目录**：刷新仪式的会话 id 磁盘回退原本可能选中裸 uuid 目录（子代理会话），把仪式注进子代理等于白做还会污染它的上下文。现只认 `session-` 前缀目录，取不到就返回空串、由上层明确报"无刷新目标"。

### 水位口径重做：按路由预留额度算水位 + 压缩即接续 + 接续材料认会话（实机取证）

**现象**：官方压缩又一次抢在 75% 接续之前；同时在另一条路由上「自动接续」明明 armed 过，却从没真正跑完，用户侧的观感是「接续从来没有发生过」。

**取证一 · 阈值不可达（deepseek 路由）**（会话 `session-40727a84…` 的 v3 日志）：`assistant/attempt` 里存着 provider 的 400 原文 ——
`This model's maximum context length is 1048576 tokens. However, you requested 1050044 tokens (666044 in the messages, 384000 in the completion).`
即 **请求里含路由预留的输出预算 384,000**，消息实际只能用到约 **664,576**（= 1,048,576 − 384,000）。而旧阈值 `0.75 × 1,000,000 = 750,000` 比它**还高 85,424** ⇒ 这条路由上**永远不可达**；官方自己的 80% 线（800,000）同样不可达，只能靠 400 溢出兜底触发压缩。

**取证二 · 预留额度随路由变，「能不能摸到 75%」也随之变**（逐会话扫描 `request/header.config.maxTokens`）：

| 路由 | 预留输出 | 消息可用上限 | 官方小圈理论上限 |
| --- | --- | --- | --- |
| glm-5.3-flash | 128,000 | 920,576 | 92% |
| deepseek-v4.1-flash-expires-on-0910 | 256,000 | 792,576 | 79% |
| deepseek-v4-flash / deepseek-flash | 384,000 | 664,576 | **66%** |

实测印证：`session-de10b34f` 走 glm 时小圈确实爬到 **80.1%**（`input 5,262 + cacheRead 796,160 = 801,422`），紧接着就被官方压缩（0.8 × 1e6 = 800,000 线）；而走 deepseek 的 `session-40727a84` 小圈**卡在 64~66%** 就撞 400。**这解释了「以前见过 75%、80%，现在只有 66%」——不是计量漂移，而是路由换了、额度天花板换了。**

**取证三 · 接续触发了，但死在 prompt 上**（诊断日志，今日）：`14:01:16 water level advisory: ratio=0.75 tokens=752959/1000000` → `auto-continue armed` → `14:02:06 deadline reached, executing host-side` → **`hostAutoContinue error: prompt rejected`**；`14:51:17` 再来一次（`0.76`，`759034`），同样下场。所以「接续从来没有发生过」的真因是 0.1.5 的 `requestId` 必填（见上文缺陷修复）——**与阈值是两条叠加的独立缺陷**，不是同一件事。

**修复**：
- **分母**改为「窗口 − 预留输出」，预留取自**该会话自己的**请求头 `config.maxTokens`（随路由变动，不再假定 384,000）＝消息真实额度；取不到预留的会话原样用窗口。
- **分子不做任何系数修正**（**更正**：曾一度加入「本地计量偏乐观 2×」的校准系数并落盘，**判错了、已撤除**）。实测压缩前最后一条 `usage.totalTokens = 660,728`，而 provider 8 秒后报 `666044 in the messages` —— 差 0.8%，**本地取数与官方小圈/dsh-context 同源且本来是准的**；先前看到的 `316,610` 是**压缩之后**的读数（被误当作压缩前）。
- **判别算式**：旧阈值 `0.75 × 1,000,000 = 750,000` 比消息实上限 `664,576` 还高 **85,424** ⇒ 永不触发；新阈值随路由为 `0.75 × (1,000,000 − 预留)`（deepseek 384,000 → 462,000；glm 128,000 → 654,000），都落在各自硬墙之前。
- **压缩/溢出即接续**：`compaction/*` 事件与 `CONTEXT_WINDOW_EXCEEDED` 都升级为**硬触发** —— 命中即触发接续（按 seq 去重避免重复触发），同时补写交接账本。
- **接续材料认「被接续的那个会话」**：`buildPrevSessionPack()` 原先只认 `this._lastAgent`（最近活跃的 agent），而自动接续要交接的是 `armed.sessionId` —— 二者可以不是同一个会话。实测 `14:54:30`：armed 是 `de10b34f`，却把 `1f621132` 的转写、provider、model、思考档位当成接续材料（新会话还会被 `selectModel` 套错模型）。现改为**显式旧会话优先、`_lastAgent` 仅作回退**；宿主路径传 `armed.sessionId`，一键接续把来源会话 id 经 `handoff-continue` 端点传入。
- **重启不再把历史压缩当成「刚刚发生」（实机事故修复）**：硬触发的去重状态（`lastCompactionSeen` / `lastOverflowSeen`）原本只存在内存里，宿主一重启就归零 —— 于是**每次重启都会把会话里那条历史 compaction 当成新事件**，在完全不到阈值的水位下武装自动接续（实测 17:50 重启后 0.7 分钟即 `armed`，当时水位只有 48%，还顺手写了一份空壳账本）。现改为：每个会话在**本进程内首次被观测时只建立基线**（把启动前已存在的 compaction/溢出 seq 记为「已见」），其后才按 seq 前进判定。
- 水位记录新增 `measuredRatio / reserve / windowRaw / hardTrigger`，面板与 diag 都能看出「比例是算出来的还是撞出来的」「分母扣掉了多少预留」。

**回归**：新增 `tests/smoke/smoke-test-water-hard-trigger-pre.mjs`（27 条：真实错误文本解析、请求头预留额度、compaction 全历史扫描、源码守卫、空/畸形事件不抛错）；`smoke-test-autocont-host-pre.mjs` 增补 **A8**（7 条：材料来源会话的行为锁 + 「显式旧会话优先于最近活跃 agent」的反向锁）。

## [2.3.1] — 2026-09-10 · 适配 DSH 0.1.5 会话数据格式 V3

### 兼容性修复

- **会话日志 V3 适配**：DSH 0.1.5 起会话持久化迁移到 `session.v3.jsonl.zstd`（旧 `session.jsonl.zstd` 保留但停止更新）。水位推导（模型/窗口/contextWindow 取数）与子代理痕迹回收改为**按修改时间择新解析**，两代命名共存兼容 —— 修复前会读到停在迁移时刻的旧快照，0.1.5 之后新建的会话更会直接读不到。
- 解析器实测兼容 V3：1835 行 0 失败；V3 已消除流式 chunk 事件（旧格式 2400+ 条），解析更轻。

### 体验修复

- 反思提示强化：明确要求「呈现后**必须**调用 `memory_reflect_pre` 落盘」，避免只呈现不落盘导致提示在后续轮次重复出现。

---

## [2.3.0] — 2026-09-10 · 分层语义唤回 · 时间臂 · C3 召回 · M8 默认启用

> 覆盖：分层语义检索、时间检索臂、C3 语义召回、主动联想截断修复、四层接续、M8 三层记忆默认启用、证据链修复、子代理生命周期与自动接续稳定性修复。

### 稳定性修复

- **子代理生命周期**：宿主 context 卸载（重启/禁用）后，残留定时器与面板请求不再尝试创建子代理 —— 消除 `cannot create effect on inactive context` 报错刷屏；同类竞态只记一条诊断日志。
- **自动接续提前布线**：水位在 pre-step 测量后即挂接续倒计时（此前只在轮末 arm，长回合中官方压缩先触发导致接续从不触发）；倒计时到期若回合仍活跃则自动推迟，不打断进行中的对话。
- **子代理回收抗占用**：Windows 下会话目录被占用导致 `rename` 失败时改为退避重试，仍失败则跳过留待下次，不再刷屏。
- **Python 引擎安装**：修正 BGE-M3 模型仓库名（原仓库不存在导致 HTTP 401），补齐 tokenizer 5 件，就绪判定改为模型与 tokenizer 全齐。

### 记忆检索 · 分层语义唤回（OpenViking 式）

- **L0 摘要与索引**：每条记忆生成约 93 字符摘要（压缩约 1:7），检索默认只返回 L0 列表（含 id/score/match_reason），按 `expand="mem_xxx"` 按需展开原文，不串条。
- **语义臂接入 recall**：C2 内置语义引擎（e5-small q8，约 130MB）对 L0 摘要编码——修复此前"全文进 embedding 超 512 token 被截断"的有损问题。
- **rank-space 融合（RRF，k=60）**：词法 + 语义 + 时间 三臂并行倒数排名融合，取代旧的 minmax 归一化（旧方案分数随候选集漂移、候选 ≤1 时退化为常数、矮子里拔将军）。
- **时间检索臂**：支持「上周 / 三天前 / 上个月 / 最近 N 天」等中文时间表达，软性提升命中时间范围的记忆；查询不含时间词时零行为变更。
- **C3/Python 档语义召回**：暴露 Python worker 已有的 `dense_search` 为召回入口，C3 档（BGE-M3）同样参与召回排序；`auto` 档择优（Python 可用则 C3，否则 C2）。

### 主动联想 · 决策层

- **修复 QueryPlan 词项截断**：从"按字典序截断"改为"按来源权重降序保留（trigger 1.0 ＞ user 0.8 ＞ tool-result 0.6 …）"，高权重词不再被低权重词挤掉，主动联想召回更准。

### 跨窗口接续

- **四层交接材料**：白板 / 账本 / 近期线程 / 完整转写（按需 read），改为「按需取用而非通读」，不再要求"接续前先 read 转写"。
- **账本权重化截断**：四段赋权（失败原因 .35 ＞ 下一步 .30 ＞ 目标 .20 ＞ 状态 .15），预算不足时从最低权重段起截，避免高价值段被整段截掉。
- **写入侧修复**：账本双标题重复、白板退化为日志（老化处理）。
- **接续阈值 0.75**：抢在官方压缩阈值 0.80 之前完成交接，水位测量在 pre-step。

### M8 三层记忆（默认启用）

- fact（事实）/ episodic（经历）/ procedure（技能）三层 store，配「记忆中枢」页签。
- **Fact 元数据**：时间三价（occurredAt / mentionedAt / ingestedAt）+ 认识论状态（fact / observation / directive）+ 趋势（new→stable→stale），向后兼容旧数据。
- **记忆重要性权重**：由证据聚合（跨会话重现度、成功/复用、纠正率）生成，作为加权因子接入检索排序。

### 证据链

- 六类 evidence（seen / read / cite / reuse / success / correction）落盘与聚合。
- **修复 correction 归因**：从"需用户消息含完整 32 位 memoryId"（几乎不可触发）改为"归因到最近被 cite/read 的记忆"，单条归因、保留 cite。
- **修复 success 时间戳缺陷**：事件时间戳在 `event.ts`（顶层无 `ts`/`createdAt`），旧写法恒为 0 → success 证据链结构性断裂（恒为 0）；改为与选择器同口径取值。

### 修复

- **P0 静默失效**：`readdirSync` 未导入 → importance 管道全程失效且被静默 catch 吞掉；补导入 + 降级加 diag。
- **设置页「自动记忆引擎」分区标题空白**：`sectionLabels.secSemantic` 键名错误 → 改为 `sectionLabels.semantic`。
- **bge-m3 仓库名**（issue #27，原 `-int8` 仓库不存在 → HF 401）；**tokenizer 五件套补齐**（issue #28）。
- **子代理兼容**（DSH 0.1.2 in-process 用 `localAgent` 而非 `agent`）+ `withTimeout` 兜底（防 result 卡死泄漏）。

### 已知限制（本版仍存在）

- 词法检索为全量扫描，无倒排索引（记忆上千条后才需优化）。
- C3/Python 召回需先在设置页安装 BGE-M3 模型（约 563MB）。
- `autoConsolidateCooldownMinutes = 0` 会回退为 30（`0 || 30`），与直觉不符，后续版本处理。
