# 待办总表 · dsh-auto-memory（2026-09-13 汇总）

> 用途：**唯一待办入口**。跨会话/跨工具（DSH、ZCode）通用 —— 不依赖任何一方的工作记忆，全部写路径与判据。
> 状态约定：🔴 阻塞或高优先 / 🟡 应做但可排期 / ⚪ 可选或长期 / ✅ 已关闭（留在 §J 备查，别重复劳动）
> 事实基线（**2026-09-14 02:5x 独立验收实测**）：npm latest = **2.5.2**（`--registry=https://registry.npmjs.org`，dist-tags.latest 同值）；pre 线 `D:\dsh-auto-memory` HEAD = **`1c06c46`**（已跟踪改动 0；`747aa68` 之后多出 4 个纯 `docs/` 提交，属本机 DSH 会话的 harness bug 上报，非 ZCode 线）；REL = tag `v2.5.0`/`v2.5.1`/`v2.5.2` = GitHub main = **`55c3deb`**（REL 唯一未跟踪项 = `.github/cloud/qq-webhook/index.zip`，发版纪律要求排除，正常）；冒烟 **71/71 全绿**（含本轮修好的 `m73` 夹具 flake）。
> **验收报告**：`docs/internal/ACCEPTANCE-20260914.md`（三任务 + 10 项追加需求逐项源码取证、2 处偏差更正、1 项真问题修复、不可独立复核项清单）。

---

## 0. 一分钟看板（2026-09-14 重排：**四大问题优先，界面/美化推后**；同日追加群反馈 9 项 + 群友报 3 条缺陷，见 §L，**主线与依赖看 `ROADMAP.md`**）

| 级别 | 事项 | 归属 | 参考 |
| --- | --- | --- | --- |
| **P0-①** | **解锁会话检索**（**口径已拍板：C+B + 丁组允许就地改字段**，2026-09-14 用户定）：51 个阻塞文件 = 39 descriptor v2 + 7 `permission/preset.origin` + 3 seq 缺口 + 1 空工具名 + 1 `kind=anchored-monitor`，四组均有对症处方；**禁删行**（seq 必须等于行序号）。施工按 `SESSION-FILE-REPAIR-PROTOCOL.md`，并同时给索引器加"跳过+计数"保险 → 重启 → 验证 | 执行方 + 用户重启 | `SESSION-FILE-REPAIR-PROTOCOL.md` |
| **P0-①附** | **治本防复发**：锚定监控插件的干预注入改用白名单 kind（现用 `anchored-monitor`，写得出读不回 → 每次干预都造出日后不可索引的会话） | 执行方（改锚定监控） | `SESSION-FILE-REPAIR-PROTOCOL.md` §3 |
| **P0-①附** | **上游三点可报**：写读不对称 / 冻结清单与写入侧不一致 / 索引器 fail-closed 应改"跳过+计数+报告" | 执行方写稿 → 用户贴 | 同上 §3 末 |
| **P0-②** | **OpenViking 式补全（返工）**：`l0-index-pre.js` 接线、Tier 分级、L0 条目补 `layer/status` | 执行方 | 本表 §K |
| **P0-③** | **分级精确检索**：Tier-0 目录 → L0 摘要 → 原文；仲裁规则（笔记>日志、被更正过滤、provenance） | 执行方 | 本表 §K |
| **P0-④** | **记忆增删 × 少重建**：块级向量缓存 → supersede 语义 → 差量同步 → 检索 fail-open | 执行方 | `MEMORY-MUTATION-AND-INDEX-DESIGN.md` |
| **P0-A** | **接口 bug 插队先修①**：白板「接续」开关互锁 + **取消强制接续**（强制接续会让主力 agent 用贵模型；现况=开了"接续"后"强制接续"点不动，要关只能把整个白板关掉） | 执行方 | `ROADMAP.md` C1 |
| **P0-B** | **接口 bug 插队先修②**：设置里用于归纳/总结/沉淀的 sub agent「模型 + 思考强度」**选不动**（能读出、选不动，用起来估计也用不上）→ 排查 persist/控件 | 执行方 | `ROADMAP.md` C3 |
| **P0-④附** | **记忆纠错链路**：错误记忆可**废弃/修改**且触发**全库重排**（supersede + 块级缓存，即 P0-④ 的两个内核）；注入加**压缩上限** + 可**排除来源**（坏记忆不再被反复灌进去） | 执行方 | `ROADMAP.md` A1/A2 |
| **P1-⑤** | **验收方法返工**：加"能力可达性"判据（默认配置下每条对外承诺都要有可达证明） | 执行方 | 本表 §K |
| **P1-⑥** | **白板图**：项目演进图（git+CHANGELOG+白板+日志 → 数据层）+ 评估 DSH-Plan-Graph 作渲染层 | 执行方 | 本表 §K |
| P2-⑦ | 跨 Agent 记忆入检索（外部文档/会话）——待拍板 | 用户 → 执行方 | `CROSS-SESSION-SEARCH-*.md` |
| **P1-⑧** | **procedural memory 重构**（3/5/8 号的共同前置）：晋升标准不只按次数（**长时攻关/突破也晋升**）+ **skill 互链 hand-off** + 晋升物**可读** + 项目→全局**晋升开关** | 执行方 | `ROADMAP.md` §B |
| **P1-⑨** | **检索语义框架审计**：按规范 RAG 策略清单审 A1/A3，产出「我们的策略 vs 框架」对照表 + 缺失项 + 评估基准 | 执行方 | `ROADMAP.md` A6 |
| P2-⑩ | **日历换开源方案**：调研公开开源日历组件，替换自研 | 执行方 | `ROADMAP.md` C5 |
| P2-⑪ | **手机端首次启动指引太大且关不掉**（远期随 UI 调整，与 §C「向导无兜底触发」合并处理） | 执行方 | `ROADMAP.md` C4 |
| **P1-⑬** | **记忆文件卫生**（群友报的 3 条）：**第 1 条本机已复现**——项目笔记开头 **63 行连续空行** + 5 处标题层级错位，已于 2026-09-14 清理（191→128 行、空行 93→30、最长连续 63→2、字符 11,308、**15 个锚点不变**、无 BOM、保持 LF）；**仍悬**：容量 94% 逼近上限（第 2 条"超容量写入被拒"）、账本被快照段落污染（第 3 条）。真修法=压缩时清空行残留 + 90% 前主动折叠 | 执行方 | 本表 §L、`TODO-GRAPH.html` |
| 推后 | 界面重构/美化、文档体系、分发门面、冷启动余项（含大排期三件套） | — | §C/§D/§E/§F |
| 待入池 | 群反馈小问题 + ZCode 交回文件里的待办（§G 剩余观察项等） | 用户提供 | §C/§G |

---

## K. 当前排期（2026-09-14 用户定：**先把四大问题做成工程现实**）

> 原则：①先让**工程真正实现**（能力可达、可用、可验证），界面/美化/文档全部推后；②每项都要有**可执行的验证判据**，不许只写"已完成"；③P0 内部按依赖排序，①最快解锁、②③④同一套 ID 与增量纪律，尽量同版实现。

### K.0 四个问题的准确定义（含一处必要更正）

| # | 用户的表述 | 拧准后的定义 |
| --- | --- | --- |
| **P1** | DSH 旧/新版本参数不兼容 → 语义向量崩溃 → 有些东西检索不了 | **不是插件的向量库崩了**。是 DSH 的**严格读取器拒收它自己写的老格式**（v0 日志里 `subagent/descriptor` v2 ×39、`permission/preset` 多出 `origin` ×7、畸形字段 ×2、`seq` 缺口 ×3 = **51 个文件**）→ 索引器 fail-closed → **DSH 侧的内容检索整条失败**。插件侧另有"承诺了 `scope='sessions'` 但默认不可达"的问题（见 §B）。**2026-09-14 副本实验结论：51 个里 49 个可"就地修复"（descriptor v2→v3 / 删多余 origin / seq 连续化，语义无损、不动 DSH 代码），仅剩 2 个（空 name、来源无法归类）需单独处理——因此首选方案从"隔离"升级为"就地修复 + 备份"** |
| **P2** | 验收有问题；OpenViking 式做得不周全，需返工/补全 | ✅ 成立。**功能缺口**：`l0-index-pre.js` **未接线**、`metamem-rules-pre.js` **未建**、L0 条目无 `layer/status`、无 Tier 分级。**方法缺口**：验收只验了"声明过的项"，没验"默认配置下能力是否真的可达"；且发现 3 处**文档与代码不一致**（详见 K.4） |
| **P3** | 语义处理需要"精确且分级检索" | = **Tier-0 目录（指引）→ Tier-1 L0 摘要 → Tier-2 原文**；Tier-0 带 `layer`+`status`+日期，负责"要不要用这条记忆"；检索时仲裁：**当前认知（笔记）优先于历史日志、被更正项过滤、时间衰减、输出带 provenance** |
| **P4** | 如何自动增删记忆而尽量少触发语义重建 | = `MEMORY-MUTATION-AND-INDEX-DESIGN.md` 的 P0-P2：**块级向量缓存**（`Map<chunkId,vector>` + 集合差，只嵌变化块）→ **supersede 语义**（改正 = 新增一条声明 `supersedes`，旧条标记不退场）→ **差量同步**（upsert + tombstone）→ **检索 fail-open** |

**我建议补一项（P1-⑤，属于 P2 的方法半）**：**验收判据换代** —— 每条对外承诺（尤其 guidance 里写给模型的能力）都必须有"默认配置下可达"的证据；文档中"默认关闭/未接线"等状态必须由测试锁住，避免再次出现"文档说 A、代码是 B"。

### K.1 依赖与顺序

```
①解锁会话检索（半天，先做：它挡住一切"基于历史对账"的工作）
   ↓
④块级缓存 + supersede（P4：让记忆能改而不重排，是 ②③ 的地基）
   ↓
②OpenViking 式补全（l0-index 接线 + Tier 分级 + layer/status）
   ↓
③分级精确检索（Tier-0 目录 → L0 → 原文；仲裁规则）
   ↓
⑤验收方法返工（把 ①②③④ 的判据固化进回归）
   ↓ 并行
⑥白板图/目标看板（参照 `miuzel/dsh-graph`；双轨：立即装它管版本与目标 ‖ 自研按 WB-GRAPH 方案 P0→P1）
   ↓
⑦跨 Agent 检索（待拍板；与 ②③ 共用同一套 ID/增量纪律，别做两套）
```

### K.2 各项的验证判据（验收时逐条打勾）

- **①**：`memory_recall(scope='sessions')` 返回命中（不再是 disabled / descriptor 报错）；51 个文件各有明确去向（隔离 / 跳过计数）。
- **②**：`l0-index-pre.js` 被 `index.js` 引用且跑通一次增量重建；L0 列表每条带 `layer`；`M8-3-enable-verify.md` 与代码状态一致。
- **③**：Tier-0 目录可注入且 ≤N token；同题查询在"有更正"场景下返回更正后的条目（旧条被过滤/降权）；输出含来源+日期+状态。
- **④**：编辑 1 条 → 只 embed 变化的 chunk（断言 encode 覆盖数）；删除 1 条 → 零 encode；破坏一个源文件 → 仍返回词法命中 + 降级标注。
- **⑤**：新增"能力可达性"套件（至少覆盖：`scope='sessions'`、语义臂、外部源、白板语料）。
- **⑥**：能按版本号回答"这个版本改了什么、哪些是弯路"（数据层可先出 CLI/静态报告，UI 后置）。

### K.3 白板图 / 目标看板（⑥）的落法（参照 = **`miuzel/dsh-graph`**，你方的预研**早已完成**）

- **参照物的真实能力**（`dsh-graph`，**MIT**，npm `dsh-graph` v0.10.0，已对 DSH 0.1.5-rc.2 完整验证）：**基于图的目标管理 + 二维泳道看板**，渲染进 `conversation.view` 槽；**39 个 `graph_*` 工具** + `/api/dsh-graph*` 端点；四阶段生命周期（描述→收集→执行→确认）与状态机（draft→planning→collecting→ready→in_progress→review→delivered，任意阶段可 blocked）；**判据先于执行**（执行前登记质量判据、评审逐条核验）；上下文卡片；排期三态（Backlog ↔ Version ↔ 独立目标）；换会话交接（`graph_handoff` / `graph_claim_supervisor`）；数据落在**工作区 `.dsh-graph`**（`backlog/ goals/ versions/ events.jsonl`，**事件流是唯一事实源**，git 友好、可审计）。
- **预研已完成**（ZCode 交付，提交 `e2762f0`；看板化延伸 `c9ed268`）：`docs/internal/WB-GRAPH-INTEGRATION-PLAN.md`（370 行）+ 三份调研（`WB-GRAPH-RESEARCH-BRIEF/LOCAL/EXTERNAL.md`）；ZCode 侧记忆条目 `wb-graph-integration-plan.md`。分级：**P0 判据文档约定（零代码，可立即做）→ P1 判据校验中间件（≈190 行，可立即做，咽喉=`writeHandoffLedger`/`writePlanSnapshot`）→ P2 sidecar 结构化存储（≈240 行）→ P3 两个遍历工具（≈165 行，工具数 **14→16**，三处测试硬锁必须同步）**。
- **预研的硬约束（不可越）**：**不搬 dsh-graph 代码**（只借范式；其 MIT 在子包，仍不复制）；**不引入跨目标依赖图**；白板**不建状态机**（只在"写入"一个门设防）；四处任务书前提已被证伪（dsh-graph 判据**无字段化 schema**；MRAgent **无 LICENSE** → 零代码复制；**Tag 是边属性不是节点**）。
- **待拍板 8 点**（方案 §8）：①P2/P3 是否立项 ②sidecar 位置（建议 `memoryRoot/<ws>/handoff/`）③静态纪律 3703 是否一次性更新 ④工具命名（`memory_expand`/`memory_trace` 惯例 vs 直译）⑤是否进 2.6.0（P0-P1 可进；P2-P3 建议 2.7.x）⑥水位骨架硬判据失败策略（照写+警示 vs 跳过）⑦PLAN 判据强度 ⑧P2-6 条目锚点。
- **两条腿（建议并行）**：
  1. **立即可用（当天见效）**：把 `dsh-graph` 作为**独立插件**装上（`dsh plugin add dsh-graph`），用它管"这个项目接下来要做什么"——Version 泳道 + 目标 + 判据 + 事件流，直接回应"一个人改了一个月、记不清哪个版本改了什么/走了哪些弯路"。**需你同意新增插件 + 重启宿主**；数据独立在 `<工作区>/.dsh-graph`，与本插件白板不耦合。
  2. **产品能力**：按 WB-GRAPH 方案 **P0→P1 先做**（零代码/小改动），P2/P3 等后端冻结解除 + 8 点拍板。

### K.4 顺带发现的 3 处文档与代码不一致（②的返工里一并修）

1. `docs/M8-3-enable-verify.md:7`：「`index.js:365` `memoryHubEnabled: false`，M8 三层记忆系统默认关闭」→ 实际 `index.js:403` 已是 **`true`**（2.3.0 起默认启用）。
2. `docs/INTEGRATION-ANALYSIS.md` §4.2：把 `recall-fusion-pre.js`、锚点表标为"未接线"→ 实际**均已接线**；仍真"未接线"的只有 `l0-index-pre.js`。
3. 插件 guidance（`lib/index.js:2737`、`:2812-2816`）让模型使用 `scope='sessions'`，**未交代前提**（需宿主开启内容检索且历史格式兼容）。

### K.5 明确推后（不在本轮打勾）

界面重构与美化、令牌层/组件层/i18n、文档体系（README/USER-GUIDE/配图）、分发门面（npm 瘦身、homepage、Pages）、冷启动余项、群反馈 CI 的安全运维收口 —— 全部等本轮 P0/P1 落地后再说。

---

## A. 阻塞在用户决策上（不点头无法开工）

- [ ] 🔴 **大排期的 6 个拍板点**（`docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md` §8）：①首页托管（htmlpreview vs GitHub Pages）②设计主张（面板靠 DSH 原生 / 首页留品牌色，接受"两种语境"？）③浮层面板是否降级为"状态+快捷入口"④`associativeMemoryEnabled` 是否改出厂默认（**建议保持 false + 向导明说并一键开启**）⑤docs 是否分层出包 ⑥排期节奏（P0-P6 顺序 vs 先集中做界面）。
- [ ] 🔴 **大排期开工需要的 3 样输入**（`docs/internal/ART-DIRECTION-WIREFRAME.md` §8）：①官方 DSH 网页的 URL/截图（全网只搜到第三方介绍文）②角色基准（默认用 `docs/banner.jpg` 的水彩版做线稿化，或用户另给设定图）③风格探针许可（需用户在 Ark9 生图面板点批准）。
- [ ] 🟡 **是否解除 `docs/PROJECT-FREEZE-AND-ROADMAP.md:8`「大版本完成前禁止改 README」**的冻结（本次排期就是那个大版本）。
- [ ] 🎯 **WB-GRAPH 拍板点（8 点 + 看板化 7 点）→ 已整理成一页纸 `docs/internal/WB-GRAPH-DECISIONS-20260914.md`**：**P0 判据文档约定（零代码）+ P1 判据校验中间件（≈190 行）不等拍板，可立即做**；P2/P3（sidecar + 两工具）与看板化需拍板（方案 §8 / §10）。用户已定方向：**把看板/流程图 combine 进自己的白板**，让用户实时看到进展与整个项目流程。
- [ ] 🟡 **procedure 记忆机制整体逻辑重构（等用户统一拍板，期间不动引擎）**：现状 = 插件的 procedure store（`lib/procedure-store-pre.js`：observed→candidate→validated→active 晋升状态机、M6 六级渐进激活、`renderChecklist` 渲染进动态快照）整体沿用 **Hermes 的记忆方式**；而 Hermes 的记忆工具在社区里**褒贬不一**，用户对这套机制整体不满，届时**统一重构整体逻辑**，不做零敲碎打。审计补充（2026-09-13）：①数据层从未产出过任何 active procedure（全机 7 个工作区均无 `procedures.json`）②`renderChecklist` 语义是"主对话自己照步骤执行"，无"执行类流程派子代理"出口 ③`memory_recall` 无 procedures scope（只能被动注入）。此前提议的两个小改点（delegate 出口 + procedures scope）**并入**这次统一重构，不单独做。过渡期执行类流程的固化走**仓库任务书通道**（`docs/prompts/*-AGENT.md` + 角色分工，主对话派子代理）。用户更详细的不满与改进建议见 **QQ 群反馈与 GitHub issues**（发版后的反馈核查任务要专门检索 procedure/技能/记忆/skill 相关条目）。

---

## B. 下一版代码改动（3 项，均已定位到行，详见 `docs/internal/NEXT-VERSION-TODO.md`）

> **✅ 2026-09-13 状态：三项已全部落地并随 v2.5.0 发布**（pre `18807ee` / REL+tag+main `7234627` / npm latest 2.5.0，子代理执行、三处复核一致）。全量回归 70/70 绿；细节与验收见 `NEXT-VERSION-TODO.md` 顶部状态行与 §J 存档。以下原文保留备查（文中行号为落地前观测值）。

- [ ] 🔴 **水位判据口径**：现触发用 `effectiveWin = win − reserve` 当分母（`lib/index.js:1900`，本机 1,048,576 − 384,000 = 664,576）→ 上下文**刚过半就触发接续**，比官方压缩点（≈80% ≈ 83.9 万）早约 45%。
  **改法**：正常触发线改用官方声明窗口（或 `min(win, hardWin)`）为分母，阈值 0.75–0.78；`reserve` 只留"距硬墙余量"展示 + 硬判据（`estTokens + reserve > win` 才硬触发）。**加反向锁**：断言"不得把 reserve 计入分母"。
  验收：阈值 0.75 时触发点 ≈ 78.6 万（而非 ≈46 万）；`water-window` / `water-hard-trigger` / `autocont-host` / `water-step` 全绿。
- [ ] 🔴 **接续序号**：`contSeq = handoff 目录里 prev-session-*.md 文件数 + 1`（`lib/index.js:2646-2648`）→ 落盘失败 / 跨工作区 / carry 复用缓存时会**不递增、重复或为空**（为空即不 rename，标题退回自动生成）。
  **改法**：持久计数器 `handoff/cont-seq.json`（键 = workspaceId），缺失时从现有 `接续 #N` 标题/包名解析最大值 +1 兼容老数据；序号分配与包落盘同序事务；三条入口（面板一键 / 宿主兜底 / 重启后）全覆盖。
  验收：连做 3 次接续得到 `#N → #N+1 → #N+2`，跨工作区不重复；新增 smoke 覆盖计数器持久化与"落盘失败不跳号"。
- [ ] 🟡 **固定流程外包给子代理**：主对话只做三件事（开闸前确认前置门 / 放行或中止 / 失败时处置），子代理按检查表全跑、出错即停、回报 `{ ok, version, pre_sha, rel_sha, tag, npm_latest, failed_step, error_tail }`。
  落地物：①`docs/prompts/RELEASE-AGENT.md`（自包含任务书，**尚未创建**）②`docs/internal/RELEASE-PROCESS.md` 顶部加「角色分工」段 ③同类流程（全量回归 / 双语对账 / 痕迹巡检）各配任务书。
  已知约束：当前工具面**不能给 subagent 指定思考强度**（`subagent` 只收 description/prompt/run_in_background；`workflow.agent()` 显式拒绝 effort）→ 要压到 low/off 得靠 DSH 侧配路由默认强度，或由插件自身 spawn（插件已有 `subagentReasoningEffort: off|low|high|max`）。
- [ ] 🟡 **跨会话 / 跨 Agent 记忆检索（2026-09-14 新增；⚠️ 已拍板"等大排期一起定"，暂不动工）**：现状取证 —— 插件只有"自己的本地记忆 + 白板账本"可检索；**跨 DSH 会话**完全外挂 DSH 的 opt-in 特性（出厂 `openAt: never`，插件 guidance `index.js:2737/2812-2816` 却指示模型用 `scope='sessions'` → 用户照做只收到上游错误原文，`:3953-3960`）；**外部 Agent 记忆文档**只被 `discover()` 抓成 `content`（`:5822-5902`）却从不进 `recall` 语料（`:3983-4002`），外部**会话**源更只是路径指针（`:5849-5863`、`:5880-5893`）。
  **两份文档**：路径决策 `docs/internal/CROSS-SESSION-SEARCH-PATH-DECISION.md`（A 自建统一检索面 / B 只修提示与降级 / C 分期版 A）；技术调研 `docs/internal/CROSS-SESSION-SEARCH-RESEARCH.md`（本机语料实测、逐源字段抽取规则、业界实证、三方案优缺点、成本模型、风险清单）。
  **调研推荐**：**词法主干（`node:sqlite` FTS5，Node 内置、零依赖）+ 轮次级分块 + 字节 offset 增量 + 逐文件跳过计数**，语义向量仅作增益（装了走 RRF 融合）。实证：LongMemEval-S 上 BM25-only R@5 = 86.2% → 混合 95.2% → 纯向量 96.6%（加向量 +9pp；混合与纯向量仅差 1.4pp）。预算建议：时间窗 90 天 + 单源 2 万块 + 总量 10 万块 + 单文件解码 16MB。
  **DSH 侧上游缺陷（不阻塞本路径，建议单独上报）**：①v0 日志里 `subagent/descriptor` v2 被编解码器硬拒（`dsh-session-format-v0-to-v1/lib/index.js:1584-1587`，是 DSH 自己写的数据；本机 39 个会话中招）；②索引器 fail-closed 且无容错开关（`dsh-session-query-sqlite/lib/index.js:724-739`）；`next`(rc.2) 两处代码与 rc.1 逐字相同。社区同族：#4811、#4910、#5694。

---

## C. 冷启动与上手（公开用户"装上没反应"的根治）

来自冷启动审计（`docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md` §2.5）。**除最后一条外均未修**：

- [ ] 🔴 **首启向导无兜底触发**：只有 `update-check` 成功返回 `current` 才分发首启弹窗（`lib/client.js:4439`）→ **断网/代理环境下零引导零提示**。改法：请求失败/超时也用本地条件（版本号或 localStorage）照常 dispatch；清掉死键 `firstRunDone`（只读无写）。
- [ ] 🔴 **卖点功能与向导显示不一致**：`associativeMemoryEnabled` 出厂 `false`（`lib/index.js:349`），而向导把它渲染成「推荐 + 默认开」（`lib/client.js:3229/3303` 用 `tg.def !== false` 显示 ON）→ 用户不点 = 看到 ON 实际 OFF（幻觉 ON）。
  改法（不动后端默认值）：向导如实显示"出厂关，这里帮你打开"，点击即写入；同时修 `client.js:163` 与代码矛盾的"默认关"提示。
- [ ] 🟡 **引擎步自动下 129MB 且失败无重试**：进入引擎步即 `semanticDownload start`（`client.js:3168-3175`），失败态（`:3287`）只有报错没有重试按钮（`:3425-3439` 无重试分支）。改法：改为"点『安装』才下载"+ 加重试按钮（复用设置页 `semActionRetry` 同源逻辑）。
- [ ] 🟡 **`welcomeTourEnabled` 是死键**：host 从不读（`lib/index.js:317` 仅定义），所以设置里关掉也拦不住首启自动播放。改法：host 读该键并下发，client 在 `dispatchStartupDialog` 的 freshInstall 分支加门闸。
- [ ] 🟡 **术语改写 Top5**（走客户端 i18n，中英同步）：水位 → 上下文余量；接续 → 换窗口续做；锚定 → 记忆索引；白板 PLAN/账本 → 项目看板/交接记录；唤起·固化·晋升 → 想起来/记下来/变成技能。
- [ ] ⚪ **装完给一句"她在工作"的反馈**：现在唯一信号是侧栏多了个「记忆」按钮；自动沉淀有 240 字符门槛，头几句闲聊会被跳过且无任何提示。

---

## D. 分发与门面（npm / GitHub 对外）

- [ ] 🟡 **npm 包瘦身**：`files` 含整个 `docs`（同日实测 **11.0 MB / 167 文件**，其中 `docs/screenshots` 约占 7.9 MB、内部工程文档 101/106 个 md）。改法：`docs/internal/**` 与 `docs/prompts/**` 移出包；**必须保留** `docs/screenshots/**` + 3 篇论文 + `system-map.html`（README/USER-GUIDE 的图片走相对路径，整目录删会让 npm 页图全断）。
- [ ] 🟡 **`package.json` 对外字段**：缺 `homepage`（README 现在挂的是 htmlpreview 伪首页）、缺 `scripts`（无 `test` 入口，陌生人无法一条命令验证）、缺 `engines`（Node 版本无约束）；`description` 331 字符被 npm 截到 255（中文段全丢）。
- [ ] 🟡 **首页托管**：`docs/landing/index.html`（1,745 行自包含单文件）目前只在 `preview` 分支，靠第三方 `htmlpreview.github.io` 代理渲染（README.md:9）→ 单点依赖。建议改 GitHub Pages（`.github/workflows/` 现在已存在，可加 `pages.yml`）或至少加 `gh-pages` 分支。
- [ ] ⚪ **.github 门面件**：`issue 模板 / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT` 仍缺（`.github/` 目前只有 CI 与云函数）。已有真实外部贡献（PR #12、Issue #10），却无模板与指南。
- [ ] ⚪ **`CHANGELOG.md` 不在 tarball 里**，而 README 末尾链接指向它 → npm 视图是死链。二选一：把 CHANGELOG 加进 `files`，或改链接。

---

## E. 文档体系

- [ ] 🟡 **README 大改**（490 行 / 说明书式内容占 30%）：落地 `docs/NEXT-MAJOR-README-DRAFT.zh.md` 前必须先修 —— 它沿用「十个页签」旧错（实为 12）、含违反 `PROMO-STYLE-GUIDE.md:70` 的句式、`memory_search` 工具名不存在（实为 `memory_recall`）、安装位置反而更靠后。目标 ≤120 行五段式。
- [ ] 🟡 **USER-GUIDE 改任务导向**（现各 382 行、页面导向、61 个配置键）：目标 ≤260 行；删 `-pre` 期命名泄漏与不可用命令（`node tools/subagent-gc.mjs` —— `tools/` 根本没打包）。
- [ ] 🟡 **6 处事实性错误**：①handoff「默认开启」写 4 处（实为 false）②「Ten tabs」实为 12 ③`memory_search` 实为 `memory_recall` ④`README.md:294` 的 `/n/n` ⑤英文 README 的 H1 是中文 ⑥配置路径写成非 `-pre` 名（`dsh-auto-memory.json` vs 实际 `dsh-auto-memory-pre.json`）。
- [ ] 🟡 **双语对账脚本**（`tools/check-readme-parity.mjs`）：锁标题序列 + 命令块 + 关键数字（0GB/130MB/563MB、0.75/0.80、8000/200000）逐字符一致 —— 现在只靠人工纪律，已漏过。
- [ ] ⚪ **27 张配图重拍**（22 张界面图 + 7 张六幕宣传图，旧 29 张中部分已不再被引用）：必须在 UI 定稿后做，顺序为"UI 冻结 → 重拍 → 改文"。

---

## F. 界面技术债（= 大排期主体，量化见预研 §2.6）

- [ ] 🔴 **令牌层**：硬编码颜色 **320 处 / 132 种**；圆角 **25 种**、padding **47 种**、gap 14 种、字号 19 种、阴影 20 种、毛玻璃 **8 套配方**；同一个 `--dam-accent` 有 **5 个不同 fallback**；**3 个幽灵令牌**（`--dsw-alias-text-primary` / `-warn` / `-danger` 上游根本不存在，9 处永久走 fallback）。
  目标：颜色/边框 **100% 走 `--dsw-*`**；自建 `--dam-*` 度量令牌（间距 4/8/12/16/24、圆角 4/8/12、字号 11/12/13/15/18）；向导美术隔离到 `--dam-tour-*`。
- [ ] 🔴 **组件层**：内联 style **228 个** vs `className` **4 处**；**6 套卡片**、4 种"表格"宽度、4 种标题写法、4 套浮层、2 套页签并存。目标：抽 `Card / Row / Field / Badge / Tabs / Modal / Toolbar` 七个原语。
- [ ] 🟡 **巨型函数**：`SettingsPage` **582 行**（8 分组+目录浏览器+模型抽屉+环境检测+向导挂载+更新检查+调试中心）、`DialogHost` **478 行**（7 种弹窗+首启向导状态机）。
- [ ] 🟡 **状态与可访问性**：`:focus` / `:focus-visible` **各 0 条**；`aria-*` 仅 9 个、`tabIndex` 0；危险操作 `window.confirm` **0 次**（`StorageTab` 删除是**单击即删**）。
- [ ] 🟡 **i18n 双机制**：`I18N` 字典 + **约 354 处内联 `locale === 'zh' ? … : …`**；`t()` 的兜底是中文 → 英文 UI 必然中英混杂。
- [ ] ⚪ **幽灵配置键 `pythonGpu`**：`lib/client.js` 会写、`lib/index.js` **零引用**（宿主从不读）→ 删客户端那一处即可。
- [ ] 🟡 **IA 重排**：12 个页签塞进 **440×560 浮层**（拖到 300px 时表单控件只剩 ~48px）。DSH 有约 58 个原生插槽可用（`sidebar.panellist` / `sidebar.right.tab.document` / `conversation.session.header.utilities` …），`slots.inject/register` 是通用 API —— **挂原生位不需要改后端**。开工第一步：向 `sidebar.panellist` 注册一个空面板做 spike，失败则回退为"保留浮层但按三组重排"。

---

## G. 群反馈 / 日报 CI（2026-09-12~13 新建，ZCode 线）

> **2026-09-13 深夜～09-14 凌晨大更新（caf161a..1104864，全部已部署至线上 n 版并经群里实战验证）**：
> ① **定时班自触发**：GitHub schedule 从未生效（全仓库 schedule 运行 0 次）→ 改 SCF 定时触发器（名 `digest_dispatch`，Cron `0 40 11,20 * * * *`）→ 函数收 Type:Timer 事件调 workflow_dispatch（10h 防重落 `bot-state.json`；timer 秒回受理后台执行，绕开 3s 同步窗）。
> ② **@ 答疑**：@机器人 + 问题 → M3 回答（每小时限 1 次，配额落 gist；被动回复不占主动配额）；@ 优先答疑，反馈词命中改静默收集（回答开头合并「已记录」确认）。
> ③ **未解决事项跟踪**：日报群反馈从一次性归纳升级为跨期清单（gist `group-issues.json`）——没修好的持续列出（带首报/最近日期），**群里确认修复或发版 CHANGELOG 写明修复 → AI 对号自动销账**，14 天无提及归档；确定性兜底「包含即同类」去重。
> ④ **LLM base 401 根因**：webhook 代码读 `LLM_BASE_URL`，部署文档误写 `LLM_API_BASE` → base 恒为默认 DeepSeek → 401；已双名兼容。**教训：给用户的 env 清单必须与代码实际读取名逐一核对。**
> ⑤ **已闭环（09-14 凌晨实战验证）**：函数超时已调、LLM 链路全通（答疑成片正文+思维链过滤生效）、@ 即查四指令上线、机器人 mention id 变更导致"失聪"已修（学习改最新优先，即查/答疑不再依赖 id 匹配）——用户确认"没毛病了"。
> ⑥ **剩余观察/待办**：a) 明早 11:40 定时触发器首跑（digest_dispatch，观察群里是否准点出总结）；b) 群里确认 AI 会主动引导群友用即查指令；c) 群反馈跟踪的首个实战销账预期：下期日报应把「工作区切换问题」按 v2.5.2 CHANGELOG 自动销账；d) **云函数版本 LLM_SOURCE 同步**：n 版之后若再改，记得用户要再上传 zip（当前线上=n=源码同步）；e) AI 答疑限频=AI_MAX_PER_HOUR env（当前 5/小时，用户侧可改）；f) ~~全量回归假红~~ **已修（2026-09-14 验收）**：`smoke-test-m73-pre.mjs` 负载敏感 flake（python worker 冷启动超 `requestTimeoutMs=8000` → `health()` 返回无 frame 响应 → N8 抛 `TypeError`），新增 `healthReady()` 有界轮询（只重试"无 frame"，断言不变），单跑 3/3 绿、全量 71/71 绿；g) 排障提示（源码取证，非缺陷）：答疑配额落 gist（冷启动不丢），而机器人 mention 标识是**进程内学习**（`let botMentionToken`，收到带 @ 的消息即刷新为最新）——冷启动后若群里没人 @ 过，即查/答疑暂不认旧 id 属预期行为，别误判成"又失聪了"。

**已有资产**：`.github/cloud/qq-webhook/`（腾讯 SCF 云函数：`index.js` / `index.zip` / `scf_bootstrap`）、`.github/scripts/{group-digest,group-listener,qq-capture-openid,qq-send,report-sync}.mjs`、`.github/workflows/{group-digest,group-report-status}.yml`、`.github/digest/{NOTES,PREVIEW}.md`、说明文档 `docs/internal/GROUP-{LISTENER,DIGEST,WEBHOOK}-SETUP.md`；插件侧新增按需报告端点 `?report=N`（`9461cea`）。

- [ ] 🟡 **安全面收口（待确认）**：webhook 公网入口是否校验签名/时间戳与来源白名单？是否限流防重放？密钥是否只存 GitHub Secrets / SCF 环境变量（**绝不入库**）？
- [ ] 🟡 **运维面（待确认）**：定时班时区与失败告警（现在 11:40/20:40 + 55 分兜底重试）；SCF 免费额度/成本；`index.zip` 这类二进制是否应入库（建议改为构建产物，不入 git）。
- [ ] ⚪ **文档化**：把三份 `GROUP-*-SETUP.md` 合并成一份"从零部署"清单（含所需 secrets 名、验证命令、回滚方式）。
- [ ] ⚪ **与插件的关系**：`.github/**` 不在 npm `files` 里（不会随包发布）—— 保持这样；若日报内容要面向用户，走 `docs/` 或 landing，不要塞进包。
- [ ] 🟡 **SCF 云函数部署滞后（2026-09-13 实测）**：仓库源码 `9461cea` 已有 `?report=N` 按需报告路由，线上 zip（版本标记 `20260913c`）没有——`?report=12` 只回 `{"v":...}`。需重新打包部署（`index.zip` 重构建 + SCF 控制台上传）。部署前 gist 直读可用替代：用 `--D--dsh_debug--` 记忆里的 fine-grained PAT 与 gist id（只走 shell 变量，不落盘不回显）GET `api.github.com/gists/<gist-id>` 取 `group-raw-debug.txt` 原文。

---

## H. 插件功能侧遗留

- [ ] 🟡 **issue #30（open）= procedure 管线断裂社区实证**：与 §A 末条（procedure 统一重构）同根因，挂在重构下处置；Aik358 已回复「将在发布新版本时通知」——重构发版后需回来通知该用户。
- [x] ✅ **工作区切换问题（叉叉基，群反馈）——已随 v2.5.2 发布**（pre 20447e8+b9bf1e8 / REL+tag+main 55c3deb / npm 2.5.2）：诊断报告 2026-09-13 回传判 C 类；根因=①`handoffPanelData` 面板路径全局单值（sessionId 只喂水位）②`resolvePaths` 无人值守锁**全局**钉死 state.ws（`unattendedMode=true` 用户切工作区整个冻结）③workspaceId 创建的会话 header.cwd 缺失误回退 process.cwd()。修复：无人值守锁改按会话（rt.wsLocked）+ 面板按 sessionId 解析（新增 `resolvePathsForSession`+`sessionWorkspaceFallback`，registry→持久化头两级回退）+ 未绑定诚实返回 wsBound:false + 面板配置加载守卫。验证=`smoke-test-wsfix-pre.mjs` 16 断言双实例对照，全量 71 套件 0 失败。

- [ ] ⚪ **子代理通知无法跨会话继承**：durable 侧 `SessionHeader.parentSession` 是 readonly，`coldResume → authorizeLineage` 抛 UNAUTHORIZED，服务契约无 re-parent/transfer/attach → 新会话**收不到旧会话的子代理完成通知**。可选路线见 `docs/internal/SUBAGENT-REPORT-ROUTING-PRE-RESEARCH.md`。
- [ ] ⚪ **上下文桥不推子代理会话的 context**：被观测的子代理会话 runtime 从未 `capturePaths`（整段 drop）；本机已做 30s 窗口限流 + 首条附 runtime key，**工作区归属改造未做**。
- [ ] ⚪ **两个"界面零引用"端点不可删**：`/activation-inbox-pre`（契约测试 + 注入入口）、`/subagent-gc`（CLI `tools/subagent-gc.mjs`）—— 已有白名单锁守着，新增宿主独有端点必须更新白名单并注明消费者。

---

## I. 长期纪律（违反会直接出事故）

- **发布必须获用户明确授权**；未经要求不 `npm publish` / push / 打 tag。
- **不重启 dsh web 宿主**（会截断用户会话）；host 改完只改文件 + 提示用户重启。
- **写任何文件禁 BOM**（BOM 会让 dsh web 起不来，历史事故）。
- **`release.mjs` 的源就是工作区**：脏树整体进包且不可回溯 → 发版前核实 `git status` 范围 + 全量回归（`tests/smoke` 69 套件）。
- **凭据只走行内 URL / 环境变量**，绝不写进任何会上传 GitHub 或 npm 的文件（凭据位置见 `RELEASE-PROCESS.md`）。
- **发版 10 步唯一检查表**：`docs/internal/RELEASE-PROCESS.md`；其中「改 CHANGELOG + 同步软件内版本标识」由 `tools/release.mjs` §5.05 闸门强制。
- **npm 相关两个坑**：本机 `.npmrc` 是 npmmirror（查询/发布必须显式 `--registry=https://registry.npmjs.org`）；`npm view` 命中本地缓存（判定用 registry `/latest` 或 `--prefer-update`/`--prefer-online`）。

---

## J. ✅ 已关闭（存档，别重复劳动）

- ✅ **55 份未入 git 的 docs 已收编**（`f83e144`）—— 此前"npm tarball 是唯一副本"的数据丢失风险解除。
- ✅ **`.github/` 从不存在到就位**（2026-09-12~13 建起 CI + 云函数）。
- ✅ **v2.4.1 / v2.4.2 已发布**，三处一致（npm latest = 2.4.2 / main = tag = `243dee1`）。
- ✅ **`autoContinueEnabled` 出厂默认改 `false` + 反向锁**（v2.4.2；用户本机也已关）。
- ✅ **界面路径表一致性锁**（`tests/smoke/smoke-test-api-paths-pre.mjs`：客户端 ⊆ 宿主、表外零裸字面量）。
- ✅ **发版版本标识闸门**（`release.mjs` §5.05：缺 CHANGELOG 小节 / 应用内更新说明条目 / 界面指纹行即拒绝构建）。
- ✅ **第 0 步止血**：写配置 4 条路径 → `saveConfigPatch()`；10 处重复的语义刷新 → `refreshSem()`。
- ✅ **`smoke-test-m53-pre.mjs` 顺序敏感 flake**（固定 `sleep(900)` → 有界轮询）。
- ✅ **真实自动接续实机验证通过**（修复后首次 `auto-continue host-executed`）。
- ✅ **B 区三项深改落地 v2.5.0**（2026-09-13，未发版）：①水位口径——分母改官方声明窗口（`min(win, hardWin)`），reserve 退出分母只留"距硬墙余量"展示与预测性硬墙判据（`estTokens + reserve > 判定窗`），反向锁断言"不得把 reserve 计入分母"；②接续序号——`~/.dsh/memory/cont-seq.json` 持久计数器（全局单调、跨工作区不重号、写包失败回滚不跳号、历史标题扫描兜底），新增 `smoke-test-contseq-pre.mjs`（20 断言）；③流程外包——四份自包含任务书（`docs/prompts/{RELEASE,REGRESSION,DOCS-AUDIT,TRACE-PATROL}-AGENT.md`）+ `RELEASE-PROCESS.md` 角色分工（主对话派活后只读等待）。全量回归 70 套件 0 失败。
- ✅ **v2.5.0 / v2.5.1 同日两连发**（2026-09-13）：均按 RELEASE-AGENT 任务书派阻塞式子代理执行、主对话独立复核三处一致；2.5.0 = 三改点上线；2.5.1 = **PR #29 已合并（squash `f2efefa`，社区贡献者 fei009009）+ pre 线移植**（`decodeZstdFramesHead` + 巡检调用点 + `waterWindowForSession` 同防，G13 套件 + water-hard 反向锁），PR 已回复。任务书新增教训两条：构建后 `package.json` 补提交步骤（阶段 4）；REL 提交排除 `index.zip`。
- ✅ **ZCode 交班独立验收通过（2026-09-14 02:5x，`docs/internal/ACCEPTANCE-20260914.md`）**：三任务 + 10 项追加需求逐项源码取证（9 项完全成立、procedure 审计未单独成文）；基线独立复核（npm 2.5.2 / REL=55c3deb / pre=1c06c46 / 71 套件）；修掉 1 项真问题（`m73` 夹具负载敏感 flake → `healthReady()` 有界轮询，71/71 绿）；更正 2 处文档偏差（pre HEAD 已前进；白板曾误写"三项深改未动"）。

---

## L. 群反馈第二批（2026-09-14 用户亲述 9 项 + 群友脱敏文件 3 条）

> 来源：QQ 群记录（用户转发）+ 群友发来的脱敏项目记忆 `MEMORY_SANITIZED_LOG.md`。
> **归位、依赖与执行顺序见 `ROADMAP.md`**（四条主线 A/B/C/D + 第一批→第三批）。本表只做登记与映射，避免两处重复维护。

| 号 | 用户原话要点（提炼，非逐字） | 归类 | 对应看板 |
| --- | --- | --- | --- |
| 1 | **不要强制接续**（主力 agent 用的模型贵）。现况：白板"接续"开关开了之后"强制接续"点不动，要关只能把白板整个关掉。目标 = 集成 graph 时同时做到 ①**不启动 agent 也能单独看项目总进展** ②进展**注入 agent**，多轮压缩后仍准确 | C1 + C2 | P0-A / P1-⑥ |
| 2 | 设置里用于**归纳/总结/沉淀的 sub agent 的模型与思考强度选不动**（能读出、选不动，用起来估计也没法复制）→ 排查修复 | C3 | P0-B |
| 3 | 加 **「项目记忆 / 全局记忆」选项**，项目记忆可晋升到全局且能开能关（防串）。用户规划：**保留自动，但等 procedural memory 重过之后再做** | B4 | P1-⑧ |
| 4 | 要设 **压缩上限** + **排除用户提示**，避免因记忆问题一路走错。核心 = **旧记忆如何废弃、如何修改记忆文件**：要有一条既不影响语义模型换回、又能准确删除错误记忆的路 | A1 + A2 | P0-④附 |
| 5 | **技能晋升不直观**（"我都不知道是啥技能"）→ procedural memory 重构后再改 | B3 | P1-⑧ |
| 6 | 手机端远程控制**首次启动指引太大且关不掉** → 远期随 UI 调整 | C4 | P2-⑪ |
| 7 | **日历插件太粗糙** → 搜公开开源日历组件直接替换自研 | C5 | P2-⑩ |
| 8 | procedural memory **不能只按次数晋升**：长时攻关/突破做完也需晋升为 skill 类长期记忆；**两个紧密联系的 skill 之间可写 hand-off**（"用完这个经常会遇到那个问题"） | B1 + B2 | P1-⑧ |
| 9 | **语义分析需要规范框架**（B 站《7 分钟了解 10 种 RAG 策略》）——用规范框架做事、并作为审核标准 | A6 | P1-⑨ |

**群友脱敏文件 §八 附带的 3 条工具缺陷**（原文要点：项目笔记开头堆了 60 多行空标题碎片 / 笔记一度超过容量上限导致多个代理写入被拒 / 最近的交接账本被系统自动快照的段落污染、出现空标题）：

- **本机复核（2026-09-14，两次；第二次纠正第一次的错误口径）**：
  - 第一次（**口径错**）：我数的是"标题行本身为空（`^###\s*$`）"→ 得"0 处"，据此判"未复现"。**这个结论是错的。**
  - 第二次（**口径对**）：直接读项目笔记本体（191 行 / 11,366 字符）→ **开头有 63 行连续空行**、全文件 93 个空行（占 49%）、5 处相邻两个 `##` 的层级错位。**群友报的第 1 条在本机成立。**
  - 已清理：去掉 63 行空行 + 降级 5 处标题 → 128 行、空行 30、最长连续 2、字符 11,308、15 个记忆锚点不变、无 BOM、保持 LF（备份 `.hygiene-backup-20260914-075325.bak`）。
  - **机制推断**：笔记的自动压缩把旧内容移走后**留下了空行**（"空标题碎片"的真身）；容量 11,308/12,000 = **94%**，第 2 条"超容量写入被拒"随时可能发生。
  - 第 3 条（交接账本被自动快照段落污染）**本机尚未复现**，仍待证据。

**影响面判定**：`1 / 2 / 4` 是功能缺陷（用户可感知、修起来便宜）→ 已提到 **P0-A / P0-B / P0-④附**；`3 / 5 / 8` 全部锁在 procedural memory 重构（**P1-⑧**）之后；`6 / 7` 推后；`9` 是方法与验收层面的输入（**P1-⑨**）。
