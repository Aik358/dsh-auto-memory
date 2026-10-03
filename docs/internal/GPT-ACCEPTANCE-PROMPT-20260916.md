# GPT 验收任务书 · dsh-auto-memory「2026-09-15 下午 → 09-16 上午」全窗口改动

> **交付对象**：具备本地文件读取与命令执行能力的 AI 验收者（GPT）。
> **你的角色**：**独立第三方验收者**。不要相信施工方的任何自述——包括本文件。
> **产出**：一份**可执行的验收报告**，含逐项判定（通过/不通过/证据不足）+ 缺陷清单 + 放行建议。
> **铁律**：**只读审查，禁止修改任何文件**。本文件里凡是"作者声称"的部分，都是**待你证伪的假设**，不是事实。

---

## 0. 一句话背景

`dsh-auto-memory` 是 DeepSeek Harness（DSH）的记忆插件。本窗口（15 日下午到 16 日上午）施工方完成了一次**底层重建（代号 3.0，八阶段）**，并在 16 日白天追加了**白板可视化兼并改造**与**文档/贡献者页**工作。

施工方**自认这段窗口"比较不严谨"**（用户原话），因此本轮验收的重点不是"功能能不能跑"，而是：

1. **声称与事实是否一致**（有没有把未做的写成已做）；
2. **绿灯是否可信**（测试全过 ≠ 缺陷不存在——本窗口已两次踩到"假绿"）；
3. **与权威规划是否对得上**（有没有跑偏、有没有擅自扩大范围）。

---

## 1. 审查对象与时间窗（精确边界）

| 项 | 值 |
| --- | --- |
| 代码仓库（pre 开发线，**唯一审查对象**） | `D:\dsh-auto-memory` |
| 时间窗 | **2026-09-15 12:00 → 2026-09-16 12:00（本地时间）** |
| 窗口内 Git 提交数 | **0**（全部是未提交的工作区改动） |
| 工作区待审改动 | **204 项**（`git -C D:\dsh-auto-memory status --short`；**含本任务书自身**，去掉它是 203 项） |
| 宿主插件主体 | `D:\dsh-auto-memory\lib\index.js`（约 12,000 行，单文件） |
| 浏览器半边 | `D:\dsh-auto-memory\lib\client.js`（约 5,300 行） |
| 用户配置（**只读**） | `C:\Users\JH Z\.dsh\dsh-auto-memory-pre.json` |
| 全量回归入口 | `cd D:\dsh-auto-memory && node tools/run-smoke.mjs` |
| **施工方声称的当前基线** | `PASS 96 / FAIL 0 / TIMEOUT 0（143.3s）` |

**取窗口内文件清单的权威命令**（不要凭本文件的表格当结论）：

```powershell
cd D:\dsh-auto-memory
# 窗口内改动过的 lib 业务文件（排除备份）
Get-ChildItem lib -File | Where-Object {
  $_.LastWriteTime -ge '2026-09-15 12:00' -and $_.LastWriteTime -le '2026-09-16 12:00' -and $_.Name -notlike '*.bak*'
} | Sort-Object Name | Select-Object LastWriteTime, Length, Name

# 窗口内新增的测试套件
Get-ChildItem tests\smoke -File | Where-Object {
  $_.LastWriteTime -ge '2026-09-15 12:00' -and $_.LastWriteTime -le '2026-09-16 12:00' -and $_.Name -notlike '*.bak-*'
} | Sort-Object Name | Select-Object LastWriteTime, Length, Name

# 窗口内产出的内部文档
Get-ChildItem docs\internal -File | Where-Object {
  $_.LastWriteTime -ge '2026-09-15 12:00' -and $_.LastWriteTime -le '2026-09-16 12:00'
} | Sort-Object LastWriteTime | Select-Object LastWriteTime, Length, Name
```

---

## 2. 环境与硬约束（违反任一条即验收失败）

1. **禁止修改、创建、删除仓库内任何文件**；禁止改配置文件。
2. **禁止重启、停止任何 dsh / node 进程**。该进程承载验收者本体，杀它会中断验收。
   禁止 `Stop-Process` / `taskkill` / `Get-Process node | Stop-Process` 等**按进程名批量杀**的命令。
3. 禁止 `git commit` / `git push` / `git checkout` / `npm publish`。**只读 Git 命令（log/diff/status/ls-files）允许**。
4. 不要为"验证"而写入用户真实记忆目录 `C:\Users\JH Z\.dsh\memory\...`。
   需要文件系统实验时，**只用系统临时目录**（如 `$env:TEMP\gpt-verify-*`）。
5. 允许：读文件、grep、跑测试命令、跑只读探针、把临时脚本写到系统临时目录后执行。
6. **不要采信记忆文件、不要运行任何会改动状态的命令**。若某条结论必须靠"跑一下"才能验证，且该命令有副作用，**请标注为"未能验证"并说明原因**，不要擅自执行。

---

## 3. 权威依据（合规审查的唯一标尺，请先读它们）

按优先级从高到低：

| # | 文件（绝对路径） | 作用 |
| --- | --- | --- |
| 1 | `D:\dsh-auto-memory\docs\internal\MASTER-PLAN-3.0.md` | **3.0 底层重建蓝本**——八阶段的目标、判据、验收口径 |
| 2 | `D:\dsh-auto-memory\docs\internal\TODO-GRAPH.html` | 3.0 看板（声称 47 卡全 ✅）；**这是施工方自己的记账，可核对但不可作为证据** |
| 3 | `D:\dsh-auto-memory\docs\internal\WB-FORMAT-CONVENTION.md` | 白板格式契约（§2 锚点 id 契约 / §3 索引派生 / §4 写入门 / §6 lint / §8 验收清单） |
| 4 | `D:\dsh-auto-memory\docs\internal\WB-GRAPH-DECISIONS-20260914.md` | 用户拍板记录（§E 为最新裁定） |
| 5 | `D:\dsh-auto-memory\docs\internal\REVIEW-WB-GRAPH-SELF.md` | **施工方自审**（3 致命 + 6 高/中危）——请独立复核，**不要照抄** |
| 6 | `D:\dsh-auto-memory\docs\internal\AUDIT-WB-GRAPH-FULL-20260916.md` | 全量粗检审计报告（带行号证据） |
| 7 | `D:\dsh-auto-memory\docs\internal\DIRECTION-CHECK-WB-GRAPH-20260916.md` | 方向核对清单（6 个裁决点） |
| 8 | `D:\dsh-auto-memory\docs\internal\REPORT-WB-GRAPH-NIGHTLY.md` | 施工方交付报告（**注意：其中的"交付总览"含未完成项，可能与实际不符**） |
| 9 | `D:\dsh-auto-memory\docs\internal\REPORT-P5-ACCEPTANCE.md` | P5 验收清单（含 `releaseReady=false` 的如实标注） |
| 10 | `D:\dsh-auto-memory\docs\HANDOFF-CRITERIA.md` | 交接账本判据表（H1-H4 / P-H1 / P-S1 + 正反例）——**注意在 `docs\` 而非 `docs\internal\`** |

**若上述文件互相矛盾**：以文件 #1（MASTER-PLAN-3.0）与 #3（格式契约）为准；并把矛盾本身**作为一条发现记入报告**。

---

## 4. 施工方声称的交付（**全部是待证伪的假设**）

### 4.1 3.0 八阶段（15 日下午 → 16 日凌晨）

声称全部结项，顺序为 `P0 → P6A → P1 与 P6B → P2 → P3 → P4 → P5`：

| 阶段 | 声称交付 | 对应文件（绝对路径） |
| --- | --- | --- |
| P0 | 写入门 + 判据账本 + 注入表达 | `lib\memory-envelope-pre.js`、`lib\memory-writer-pre.js` |
| P6A | 注入节奏与措辞 | `lib\rules-layer-pre.js` |
| P1 | 状态提交 + miv 单源 + 并发原子写 | `lib\state-commit-pre.js`、`lib\ledger-criteria-pre.js` |
| P6B | kind 持久化 + 撤回 + 迁移 | `lib\rules-layer-pre.js` |
| P2 | 真增量（真实输入数/复用顺序/引擎身份门） | `lib\engine-identity-pre.js`、`lib\engine-switch-pre.js`、`lib\l0-index-sync-pre.js` |
| P3 | 共同检索融合决策（R1 双显示 + `opts.fusion:'legacy'` 回滚） | `lib\l0-index-pre.js`、`lib\m7-index-sync-host-pre.js` |
| P4 | 精排多级 + 有界异步窗口 | `lib\rerank-host-pre.js` |
| P5 | 验收清单（7 必需项 + U1 兼容门 + release-ready 门） | `lib\acceptance-pre.js`、`docs\internal\REPORT-P5-ACCEPTANCE.md` |

窗口内新增 13 个 smoke 套件（**点名**，请核对是否真实存在且断言数对得上）：

```
tests\smoke\smoke-test-t0-3-budget-ledger-pre.mjs
tests\smoke\smoke-test-switch-decouple-pre.mjs
tests\smoke\smoke-test-capture-paths-pre.mjs
tests\smoke\smoke-test-state-commit-pre.mjs
tests\smoke\smoke-test-p1-concurrency-pre.mjs
tests\smoke\smoke-test-p6a-rules-layer-pre.mjs
tests\smoke\smoke-test-ws-hint-first-round-pre.mjs
tests\smoke\smoke-test-p6b-rules-kind-pre.mjs
tests\smoke\smoke-test-p2-delta-engine-pre.mjs
tests\smoke\smoke-test-p3-recall-decision-pre.mjs
tests\smoke\smoke-test-p4-rerank-window-pre.mjs
tests\smoke\smoke-test-p5-acceptance-pre.mjs
tests\smoke\smoke-test-p1-ledger-criteria-pre.mjs
```

### 4.2 白板可视化「兼并」（16 日凌晨 → 白天）

**用户裁定（原话口径）**：让 auto-memory **兼并** dsh-graph（**包括可视化**），不是往 profile 里再挂一个 dsh-graph 插件。

施工方声称的落点（**请逐条核对代码**）：

1. `lib\wb-sidecar-pre.js` —— 纯函数投影层：`buildKanbanPre`（泳道卡片）、`buildKanbanMatrixPre`（矩阵：行=日期分组、列=5 泳道 + `misc` 兜底）、`ledgerDateOfPre`
2. `lib\board-mode-pre.js` —— 总开关：`legacy`（默认）/ `graph`，**非法值 fail-closed 回 legacy**
3. `lib\index.js` —— `kanbanBoardData` 同一路由**同时**返回 `lanes`（窄容器用）与 `matrix`（宽容器用）
4. `lib\client.js` —— 双承载面：面板 `KanbanBoard`（侧边栏，列表视图）+ `KanbanView`（注册到 `conversation.view` 上栏，矩阵视图）

**声称的关键不变量**（可独立验证）：
- 矩阵列合计 == 总卡数（**不得静默丢卡**）；施工方称初版漏 `misc` 兜底列导致 59 张卡落不进任何列，已修
- `__undated__` 行必须存在（`PLAN.md` / 归档文件归此行）
- 行按日期倒序
- 同一输入**打乱顺序后**输出不变（注意：施工方自认"两次同输入结果相同"是**弱断言**，因为 V8 sort 稳定，撤掉 id 破平也照样通过）

### 4.3 16 日白天的文档与贡献者页

| 交付 | 状态 | 证据 |
| --- | --- | --- |
| `D:\dsh-auto-memory\docs\CONTRIBUTORS.html` | 新建，**已推送** | 远程 `origin/main` = `794717d` |
| `D:\dsh-auto-memory\README.md` | 修改，**已推送** | 同上 |
| `D:\dsh-auto-memory\README.zh-CN.md` | 修改，**已推送** | 同上 |
| 贡献者数据 | 声称 18 位外部贡献者 / 17 PR / 32 Issue | 施工方称取自 GitHub API |

**注意一处施工方主动交代的错误**：初次统计时凭印象写成"14 PR / 37 issue"与"Minervaowl7 11 PR + 12 issue"，后用脚本核对修正为 **17 PR / 32 issue**、**15 PR + 8 issue**。请复算验证最终数字是否正确。

---

## 4.4 【本批新增】2026-09-16 送审前缺陷清理批次（**请重点证伪**）

背景：用户要求在送审**之前**先把已知 issue / 外部 PR / 群反馈一次性清掉，避免带着已知缺陷送审。
施工清单与回执：`D:\dsh-auto-memory\docs\internal\PENDING-FIXES-20260916.md`（§「施工完成回执」）。
**关键前提**：外部 PR 打的是**发布线布局**（`lib/memory-writer.js` 等裸名），而 pre 线运行 `-pre.js` 具名模块，
⇒ **不能 `git apply`**，施工方是按**根因在 pre 线重写**的。请重点核查"是否真的等价修好，而非贴着 PR 抄"。

| # | 项 | 施工方声称 | 建议验证 |
|---|---|---|---|
| N1 | **issue #54** 写入侧保留语法过滤 | 新增 `checkReservedSyntaxInContent()`（复用既有 `MARKER_OPEN`）；`appendAnchoredRecord`/`replaceSingleRecord` 前置拦截；`conflict:` reason 带 `@行号` | 跑 `tests\smoke\smoke-test-issue54-pre.mjs`（声称 12/12）；**独立构造**一条含 `<!-- memory:` 的正文，确认被拒且**后续良性写入仍成功**（本 issue 的核心危害是"整体中断"而非丢一条） |
| N2 | **issue #51** DATE_RE 锚定 | `ws-overview-rank.js` 改 `^(\d{4})-(\d{2})-(\d{2})$` | 跑 `smoke-test-issue51.mjs`（声称 29/29）；核对与 `lib\index.js` 的 `DATE_RE` 是否**同源** |
| N3 | **issue #48** EPERM 退避 + 失败不降级 | 新增 `lib/fs-retry-pre.js`；`atomicReplace` 保留候选快照 + `recoveryPath`；`memory_log/note/user` 失败改为**抛出**（DSH 记 isError） | 跑 `smoke-test-issue48.mjs`（声称 37/37）；**重点**：确认"写入失败不再被包装成成功字符串"——这是静默丢记忆的根因 |
| N4 | **issue #40** welcomeTourEnabled 失效 | 三处自动弹出分支全过 `allowTour`；配置未知不自动播放；✕ 直接关闭 | 跑 `smoke-test-startup-dispatch-pre.mjs`（声称 20/20）；核对 `if (allowTour && ` 出现 **3** 次 |
| N5 | **issue #38** 容量整理净增长 | 根因 A：占位段 `(文件头)` 被凭空写出（引入 `synthetic` + `seqOf`）；根因 B：`replace` 误按旧文件额度计费 | 跑 `smoke-test-issue38-pre.mjs`（声称 12/12）。**请独立复现**：施工方称修前在 pre 线实测 **67→77→87、8 轮单调 +80**；请检查 `lib\index.js` 的 `compactLegacyLayer` 是否还有无条件 `'## ' + s.title` 重序列化 |
| N6 | **issue #45** recall 256 截断 | 移除 `l0Corpus.length = 256` 与语义臂记录预算；新增"窗口受限"提示 | 跑 `smoke-test-issue45-recall-corpus.mjs`（声称 45/45）+ `smoke-test-p2-semantic-recall-pre.mjs`（声称 15/15） |
| N7 | **issue #30** 技能永久无法晋升 | **去重口径由 title 改指纹**（标题不是身份）；观察行显式 `observationOnly`，晋升短接为 `observation-only` | 跑 `smoke-test-issue30-procedure-promotion-pre.mjs`（声称 36/36）。**注意**：施工方称 PR #36 自带用例**未覆盖它自己的根因**（同名碰撞链），故补了断言 —— 请复核该断言是否真的能抓住回归 |
| N8 | **issue #52** 子代理模型被旧 cfg 覆盖 | `set()` 改函数式更新 + 新增 `setMany()`；三个成对入口改原子更新 | 跑 `smoke-test-issue52-pre.mjs`（声称 9/9）；核对 `set(` 是否**不再**引用闭包变量 `cfg` |
| N9 | **群反馈 #4** 注入可排除来源 | 新增 `injectExcludeSources` + `filterExcludedSourcesPre()`（id/整层/目录前缀/精确路径）；注入闸门**之前**挡下 | 跑 `smoke-test-p0-4d-inject-exclude-pre.mjs`（声称 17/17）。**请核查施工方的一处自我更正**：该卡片写"注入上限待开工"，但施工方称**上限部分早已存在**（冻结常量 `TIER_BUDGET_PRE_V1`），只有"排除来源"是真缺口 —— 请判定此说法是否成立 |
| N10 | **PR #37**（issue #35）**未移植** | 施工方称 pre 线已于 2026-09-14 按**用户裁定方案**修好（`sessionController.cancel()` 停旧回合），而 PR #37 的方案（idle 门、**不** cancel）与用户裁定**直接冲突**，故挂起待裁 | 请读 `lib\index.js` 中 `hostAutoContinue()` 的 2026-09-14 注释与 `decideAutoContinue()` 的 2026-09-14 注释，判定"挂起"是否是有据可依，而非回避 |

### 4.5 施工期间**额外发现并修掉**的既有缺陷（不在原清单内 —— 请重点审这一条）

施工方声称：**issue #54 的守卫暴露出一个既有的静默结构损坏**。

- **症状**：`maintain()` 的"无 AI 蒸馏"回退分支把 `archive/` 里日志**原文**内联进 `MEMORY.md`，
  而原文首行是**旧日志自己的 anchor marker** ⇒ 该 marker 变成 `MEMORY.md` 的结构锚点，产生**幻影记录**。
- **为何此前无人发现**：整行合法 marker 能被 `parseAnchors` 当锚点**吃下**，所以不报错 —— 静默损坏比报错更危险。
- **声称的修法**：新增 `stripAnchorLines()`（只剥整行合法 marker，正文一字不动），在 `appendText()` 的
  **写入边界统一收口**（一处覆盖全部调用方），而非逐调用点打补丁。
- **建议验证**：跑 `tests\smoke\smoke-test-m3b3-pre.mjs`（E7 用例）；并独立构造"把含 marker 的文档原文
  追加进另一个锚点文档"，判定①是否被拒/被安全剥离 ②**是否产生幻影锚点**。
- **连带改动**（请一并复核是否合理，而非"为了过测试而改测试"）：
  - `smoke-test-m3b2-pre.mjs` D7：断言由"tmp 必须被清理"改为"完整候选必须保留"（与 N3 同一行为变更）
  - `smoke-test-p4-l0-response-pre.mjs`：import 正则放宽为允许同源附加导入（因 `index.js` 新增 `stripAnchorLines` 导入）

### 4.6 请特别检查的**方法论**问题（施工方自曝）

外部 PR 自带测试可能**不覆盖它自己的根因**（#36 即如此：其用例只验 `observationOnly` 标记，
未覆盖"同名观察行吞掉富候选"这条真实病灶链）。请抽查其余移植项是否也存在同类"测试在场但没测到点上"。

---

## 5. 施工方的"修复声明"（请逐条用命令证伪）

自审报告 `docs\internal\REVIEW-WB-GRAPH-SELF.md` 列出 **3 个致命 bug**。施工方声称**全部已修**，请逐条验证：

| BUG | 症状 | 声称的修法 | 建议验证命令 |
| --- | --- | --- | --- |
| **BUG-1** | 工具注册时机早于配置加载 ⇒ graph 档永不生效（注册闸门结构性恒假） | 新增同步读取器 `loadConfigSync()`，在构建 tools **之前**调用 | `Select-String -Path D:\dsh-auto-memory\lib\index.js -Pattern "loadConfigSync"` —— 确认**调用点**位于 tools 构建之前（不是只定义了函数） |
| **BUG-2** | 用 `agent.cwd` 取工作区路径 ⇒ 跑到 DSH 安装目录 | 改走 `await this.resolvePaths(agent)` | 统计 `resolvePaths(agent)` 与 `agent.cwd` 的出现次数（**残留的 `agent.cwd` 若只在注释里，请注明**） |
| **BUG-3** | 设置页按钮只 `setCfg+setDirty` 未写盘即 reload ⇒ 用户点完等于没点 | 改走 `saveConfigPatch` | `Select-String -Path D:\dsh-auto-memory\lib\client.js -Pattern "saveConfigPatch"`，并核对该函数**真正落盘** |

**其余 6 项高/中危（施工方未声明已修，请独立判定现状）**：

| BUG | 内容 |
| --- | --- |
| BUG-4 | sidecar 用了不存在的 `this.wsDirKey`（真名 `wsKey(ws)`） |
| BUG-5 | 三处工具数硬锁未同步（`smoke-test.mjs` / `smoke-test-m3b3-pre.mjs` / `smoke-test-context-observer.mjs`）——**注意**：施工方称 legacy 档保持 **14**、graph 档为 **16**，两组断言分工不同 |
| BUG-6 | `events.jsonl` 未实现（方案 A2 与 P2-1 明确要求 appended-only `{ts,...}`） |
| BUG-7 | 遍历工具不返回正文（方案 §4.1 要求返回条目 Content） |
| BUG-8 | 无正文级检索兜底（方案 P3-1 要求 index.json 缺失时 fail-soft 回落 `searchHandoffCorpus`） |
| BUG-9 | 未接线 dsh-graph —— **此处注意**：用户后来裁定"兼并"而非"接线"，请判断现行实现是否符合**兼并**语义（可视化长在 auto-memory 自己身上、不新增插件/存储/profile 改动） |

---

## 6. 施工方主动交代的"已踩过的坑"（请验证这些坑是否真的填上了）

施工方称本窗口踩到以下陷阱并已处理，**每一条都是可验证的**：

1. **结构性假绿**：graph 新能力全挂在 `boardMode==='graph'` 闸门后，而回归跑 legacy 档 ⇒ 新分支**一行都不执行**，测试全绿却漏掉 4 条致命缺陷。
   → 请确认是否存在一条**真正切到 graph 档**的端到端套件，并检查它是否**真的**在跑 graph 分支（而不是被 fail-closed 回落到 legacy）。
   → 相关文件：`D:\dsh-auto-memory\tests\smoke\smoke-test-graph-mode-pre.mjs`（声称 35 断言）

2. **异步断言未被 await**：该套件的 `ta()` 曾是 `async`，汇总行在异步断言完成前就打印 ⇒ 失败被漏计（"32 passed" 实为 35 条，甚至可能 exit 0）。
   → 请检查该套件是否用 `pending[]` 收集 + 汇总前 `await Promise.all(pending)`

3. **空 fixture 上的等式断言是假绿温床**：`totalCards=0` 时 `0 === 0` 恒真，第一版 G4 因此等于没测。
   → 请检查 G5 类断言是否**喂了带真实卡的 fixture**

4. **"函数写了但没人调用"**：`whiteboardTagMapPre()` 存在且逻辑正确，但**没有任何调用点**——这类缺陷无副作用，行为测试与 grep 定义处都会误判为"已实现"。
   → 请对**新增的关键函数**抽查调用点是否存在

5. **CSS 令牌凭印象拼写**：曾用 7 个**不存在**的 `--dsw-alias-*` 令牌（如 `--dsw-alias-text-primary`）⇒ 变量不解析 ⇒ 颜色静默失效（用户报"全都看不清"）。
   → 请 grep `D:\dsh-auto-memory\lib\client.js`，确认没有臆造令牌。**注意**：DSH 令牌由运行时注入，在 `dist/assets/*.css` 里 grep"定义"会全部落空，**判定真伪必须到官方 UI 包的 JS 源码里找"使用点"取并集**：
   ```powershell
   Get-ChildItem "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-client-ui-*" -Recurse -File -Include *.js |
     Select-String -Pattern "--dsw-alias-[a-z0-9-]+" -AllMatches |
     ForEach-Object { $_.Matches } | ForEach-Object { $_.Value } | Sort-Object -Unique
   ```

6. **浮层定位三次返工**：`fixed` → 容器内 `absolute` → `createPortal` 到 `document.body`。
   → 请确认 `lib\client.js` 中抽屉最终用的是 `createPortal` + `position:fixed`（容器内 absolute 会随容器滚动而看不见）

7. **变异演示基线必须是当前版本备份**：旧备份曾整体回滚改造。
   → 请检查 `lib\*.bak-*` 的时间戳，判断是否有"用旧备份当变异基线"的痕迹

---

## 7. 你的验收任务（按档执行，逐项给判定）

### A 档 · 事实核对（必做）

- **A1** 跑全量回归，**如实记录** `PASS / FAIL / TIMEOUT` 三个数字与实际耗时。若与施工方声称的 `104 / 0 / 0` 不符，**以你的实测为准**并写入报告。（注：本窗口早期基线为 `96 / 0 / 0`；本批新增 8 个套件后为 `104 / 0 / 0`，耗时 159.0s。）
- **A2** 单独跑 `tests\smoke\smoke-test-graph-mode-pre.mjs`，记录断言总数，**核对是否为 35**。
- **A3** 用第 1 节的命令列出窗口内改动文件，与第 4 节表格**逐项对账**：有没有"声称交付但文件不存在"、或"文件存在但不在窗口内"。
- **A4** 核对第 5 节的**三个致命 bug 修复声明**，各给出「已修 / 未修 / 证据不足」+ 证据（文件:行号）。
- **A5** 核对贡献者数字（18 / 17 / 32）与 `Minervaowl7` 的 15 PR + 8 Issue。（可用 `https://api.github.com/repos/Aik358/dsh-auto-memory/issues?state=all&per_page=100`；注意该端点**同时返回 PR 和 issue**，靠 `pull_request` 字段区分。）

### B 档 · 合规审查（必做）

- **B1** 打开 `docs\internal\MASTER-PLAN-3.0.md`，逐一核对八阶段的**验收口径**是否达成。给出三态判定：**达成 / 部分达成 / 未达成**，每项附证据。
- **B2** 核对 `docs\internal\WB-FORMAT-CONVENTION.md` 的 §2（锚点 id 契约）/ §3（索引派生）/ §4（写入门）/ §8（验收清单）是否被实现遵守。
- **B3** 核对 `docs\internal\REVIEW-WB-GRAPH-SELF.md` 的 9 项缺陷**逐条现状**（不只 3 个致命的）。
- **B4** 判断有无**擅自扩大范围**的改动（规划没要求但改了）。

### C 档 · 独立找缺陷（**这是本轮验收的核心价值**）

施工方已两次踩到"绿灯撒谎"。请主动寻找**自审未覆盖**的缺陷，重点方向：

- **C1** 新能力是否真的**被调用**（而不是定义了没人用）——抽查 3-5 个新增关键函数，grep 调用点
- **C2** 新旧档切换是否**真的解耦**（用户硬性要求：单一开关不得顺带改变其他功能行为）
- **C3** legacy 档是否**字节级不变**（用户要求旧行为不能被污染）
- **C4** 断言是否**可证伪**——是否存在"恒真断言"（空 fixture 上的等式、自己断言自己）
- **C5** 是否存在**静默失败路径**（出错时不报错、不提示、直接返回空）
- **C6** 前后端 API 路径表是否一致（施工方称有 `smoke-test-api-paths-pre.mjs` 强制两侧同步）
- **C7** 有没有**测试自己改自己**（测试里写死了与被测代码同源的期望值）

### D 档 · 变异测试（可选，但强烈建议）

挑 2-3 条**关键断言**做变异演示：把被断言的代码**故意改坏**（**只在你自己的临时副本上改，禁止改仓库内文件**），确认测试**真的变红**。

若某条断言在代码被改坏后**仍然通过**，说明它是**假绿**——这条发现的价值高于任何"全绿"报告。

---

## 8. 产出格式（严格按此结构）

```markdown
# GPT 验收报告 · dsh-auto-memory 2026-09-15→16 窗口

## 0. 结论先行
- 放行建议：☐ 通过 ☐ 有条件通过 ☐ 不通过
- 一句话理由：
- 最严重发现（1-3 条）：

## 1. 实测基线
| 项 | 施工方声称 | 我的实测 | 是否一致 |
|---|---|---|---|
| 全量回归 | PASS 96 / FAIL 0 / TIMEOUT 0 (143.3s) | | |
| graph 套件 | 35 断言 | | |
| 窗口内改动文件数 | 203（不含本任务书） | | |

## 2. A 档 · 事实核对
（逐项：A1…A5，每条给 判定 + 证据文件:行号）

## 3. B 档 · 合规审查
（B1…B4。B1 用表格：阶段 / 声称 / 判定 / 证据）

## 4. C 档 · 独立发现
（每条：编号 / 症状 / 最小复现 / 影响面 / 建议修法 / 严重度）

## 5. D 档 · 变异测试
（每条：被变异代码 / 变异内容 / 测试是否变红 / 结论）

## 6. 与施工方自述的差异清单
| 施工方声称 | 实际情况 | 性质（误报/漏报/口径偏差） |
|---|---|---|

## 7. 未验证项
（列出你**没能验证**的结论及原因——这比硬凑结论更有价值）

## 8. 建议的下一步
（按优先级排序，每条可执行）
```

---

## 9. 报告纪律（重要）

1. **结论必须附证据**：文件路径 + 行号，或命令 + 原始输出。**没有证据的结论请标注为"推断"**。
2. **不要照抄施工方自述**。本文件第 4、5 节的全部内容是**待证伪的假设**，不是事实。
3. **区分三态**：确认 / 证伪 / 证据不足。**"证据不足"是合法且必要的结论**，不要为了给出结论而猜测。
4. **绿不等于对**。若你发现某条断言在代码被改坏后仍然通过，**这比任何全绿报告都重要**，请优先报告。
5. **不要修改任何文件**。若某条验证必须写文件，只用系统临时目录，并在报告中说明。
6. **不要重启任何 dsh / node 进程**。
7. 若你判断本任务书本身有误导、口径不当或遗漏关键审查面，**请在报告第 6 节直接指出**——这同样是有价值的验收结论。

---

## 附：施工方主动申报的已知边界（请验证这些"边界"是否被如实履行）

1. **未接线的部分**：施工方称 `vendor\dsh-graph\` 只作**形态参照**，未搬运其代码、未新增 profile 依赖。请验证仓库中确实没有 `dsh-graph` 的运行时接线（比如 `~/.dsh/profiles/web/package.json` 未被改动）。
2. **未发布**：施工方称所有功能代码**留在 pre 线未提交未推送**，仅 `README` / `README.zh-CN.md` / `docs/CONTRIBUTORS.html` 三个文档被推到 `origin/main`（提交 `794717d`）。
   请用只读命令验证：`git -C D:\dsh-auto-memory log --oneline origin/main -3` 与 `git -C D:\dsh-auto-memory status --short -- lib/`
3. **P5 如实标注 `releaseReady=false`**：施工方称没有把未完成的说成已完成。请核对 `docs\internal\REPORT-P5-ACCEPTANCE.md` 与 `lib\acceptance-pre.js` 的实际门禁逻辑是否一致。
4. **已知未做项**：BUG-6（`events.jsonl`）/ BUG-7（遍历工具不返回正文）/ BUG-8（无正文级检索兜底）。施工方**未声称这三项已修**——请确认真实状态，并判断它们是否影响 3.0 的验收结论。
