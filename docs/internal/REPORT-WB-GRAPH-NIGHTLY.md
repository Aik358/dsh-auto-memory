# REPORT · WB-GRAPH 白板线一夜完工（2026-09-16 凌晨）

> 权威依据：`WB-GRAPH-DECISIONS-20260914.md` §E（拍板留痕）+ `WB-GRAPH-INTEGRATION-PLAN.md` §5 + `WB-FORMAT-CONVENTION.md` v1
> 用户裁定：一口气全做完，但**线先别接**——设置页/接续面板一键切换「旧版白板 / 新版看板」，默认旧版。

## 交付总览

| # | 交付物 | 状态 |
| --- | --- | --- |
| ① | `board_mode_pre_v1` 总开关（`lib/board-mode-pre.js`）：legacy（默认）/ graph，非法值 fail closed | ✅ |
| ② | P1 判据门对账 + 单一真源再导出（`lib/ledger-criteria-pre.js`） | ✅ 10/10 |
| ③ | P2 sidecar（`lib/wb-sidecar-pre.js` + index.js 两咽喉挂接）：index.json 完全可重建 | ✅ 10/10 |
| ④ | P3 两遍历工具 `memory_expand`/`memory_trace`（仅 graph 档注册，工具数 14→16） | ✅ |
| ⑤ | dsh-graph v0.11.0 vendor 搬入（`vendor/dsh-graph/`，MIT 留痕 NOTICE-VENDOR.md） | ✅ |
| ⑥ | GUI 一键切换（设置页双按钮 + 接续面板快捷键，同键 boardMode，即时回显） | ✅ |
| ⑦ | 验收套件 `smoke-test-p1-ledger-criteria-pre.mjs` / `smoke-test-p23-wb-sidecar-pre.mjs` | ✅ 10+10 |

## 验证证据

- 定向套件：P1 判据 **10/10**、P2/P3 sidecar **10/10** 全绿。
- 变异演示（`artifacts/_mutate-p23-sidecar.mjs`）：**3/3 真失败**（删工具注册/tag 丢前缀/撤 sidecar 闸门），SHA256 逐字节还原。
- **全量回归：PASS 95 / FAIL 0 / TIMEOUT 0（145.4s）**，套件 92→95，零破坏。
- 施工中发现并修复 2 处抽取式测试套件缺 sidecar 桩（`smoke-test-handoff-pre.mjs` / `smoke-test-p7-write-fix-pre.mjs`，fake engine 无 `writeSidecarEntryPre` → TypeError）；修复后 53/53、40/40。

## 关键勘误（施工实测推翻方案假设）

1. **P1 判据门主体在 P0 已交付**：`wb-contract-pre.js` 已实现 H1-H4/S1-S4，`checkMutationPre`（index.js:1990）已接线两咽喉 + skipCriteria 降级 + 丢卡门 + 人机分区——本窗口=对账验证+转发再导出，不重复造轮。
2. tag 提取须**保留前缀**（`type:dead-end` 整串），否则 expand 按 tag 查不到（M3 变异实证）。
3. 抽取式套件（bindMethod 沙箱）的 fake engine 需与新方法同步补桩——新增引擎方法时要排查所有 `bindMethod('async write…')` 套件。

## 用户使用方式

- **默认**：什么都不做 = 旧版白板，行为与 3.0 收官时完全一致（sidecar 不写、新工具不注册、graph_* 不激活）。
- **切新版**：设置页「记忆窗口→白板模式」或接续面板按钮 → 「新版看板（dsh-graph）」→ 重启 dsh web（用户自行重启）→ 生效：P2 sidecar 开始写 `handoff/index.json`、`memory_expand`/`memory_trace` 注册（14→16）。dsh-graph vendor 的 cordis 接线步骤见 `vendor/dsh-graph/NOTICE-VENDOR.md`（需在 profile patch 加 insert 行，升级动作待用户明示）。
- **回滚**：切回「旧版白板」+ 重启 = 完全回滚；sidecar 是派生物，删 `handoff/index.json` 不丢任何信息。

## 未做与待用户（如实）

- dsh-graph cordis patch 接线（profile 层动作，涉及用户配置文件，待用户明示节奏）。
- T6-7 发行产物测试、compat-U1 实测（沿用 P5 结论，releaseReady=false 不变）。
- 代码全部 pre 线，未 commit/push/publish。

---

# 勘误节 · 次日全量复检与修复（2026-09-16 白天）

> 触发：用户指出「15 号下午到 16 号凌晨的修改比较不严谨」，要求全量粗检 + 修 bug + 与规划对账。
> 本节**追加**、不修改上文（保留当时的判断，便于回溯）。

## 一、上文三处结论被实测推翻

| 上文原文 | 实测结论 | 证据 |
| --- | --- | --- |
| ③「P2 sidecar：index.json **完全可重建**」✅ | **不成立**。write 与 rebuild 两条路径算出**两个不同 id**（write 传 `path.relative` 反斜杠 + title 含 `handoff-` 前缀；rebuild 传正斜杠 + 去前缀）⇒ 同一条目在索引里出现两份 | `artifacts/_audit-id-repro.mjs`：write id `mem_95fc2c2404de55c0…` ≠ rebuild id `mem_7329b82cde69f937…` |
| ④「P3 两工具（仅 graph 档注册，工具数 14→16）」✅ | **永不注册**（两道独立致命缺陷叠加）：① `apply()` **非 async** 且 cordis **不 await 其返回值**，构建 tools 时 `engine.config` 仍是构造期默认 `legacy` ⇒ 闸门恒假；② 闸门块里的 `defineTool(...)` 返回值**从未 push 进 tools 数组**（数组已在 `]` 处闭合） | `dsh-cordis-host-runner/lib/index.js` 的 `guardedPlugin`（`return objectPlugin.apply(...)`，无 await）+ 探针；修复后 graph 档实测 **16 tools** |
| ⑥「GUI 一键切换…即时回显」✅ | **设置页那条路径不落盘**：`pick()` 只改本地 React 态再 `location.reload()`，配置从未写到服务端 ⇒ 刷新后回跳原档，用户会判定"开关坏了" | 代码对照：接续面板走 `saveConfigPatch({boardMode})`（正确），设置页走 `set()`（缺陷） |
| ⑤「dsh-graph vendor 搬入」✅ | ✅ **成立**（唯一经受住复检的一条） | 目录与 `NOTICE-VENDOR.md` 均在，默认关闭声明完整 |

## 二、复检新发现（自审与首次交付均漏报）

- **BUG-15（致命，本轮新发现）**：即上表第二行的第 ② 条缺陷。**它比 BUG-1 更隐蔽**——修好「读到真配置」也仍然不注册；若不是补了 graph 档端到端套件，这条会带着"已修复"的标签活到发布。
- **BUG-12/13/14**：遍历工具返回契约与工具描述不符（缺 `preview/mtime/cues/criteria`）；`index.json` 缺 `by_tag/by_cue/versions/ws` ⇒ 工具描述承诺的「版本链」**根本没有数据可返回**；tag 正则漏采中文标点紧邻写法（`（topic:登录流程）` → `[]`）。
- **BUG-2/4/8**：遍历工具用不存在的 `agent.cwd` 取路径（应为 `await this.resolvePaths(agent)`）；`this.wsDirKey` 不存在（真名 `wsKey(ws)`，且对 `projectDir` 而言 `basename` 恰好恒等）；tag 无命中时没有词法回落。
- **结构性**：`WB-FORMAT-CONVENTION §2` 的锚点**从未写进 Markdown**（只写进 sidecar）⇒ 规范承诺的"白板自动进 L0 语料"收益恒为零。

## 三、为何「全量回归 PASS 95 / FAIL 0」没抓到上面任何一条

这是本次最值得留档的一条**方法论教训**：

1. 新工具全部挂在 `boardMode==='graph'` 闸门后，而**回归整体跑 legacy 档** ⇒ graph 分支**一行都没执行**；
2. P23 套件的 M6 只比「**同源 rebuild 自洽**」（拿 rebuild 的输出和 rebuild 比），抓不到 write≠rebuild；
3. M7 端到端**手工拼 `index.json`**，绕过了引擎两个咽喉 ⇒ 接线通不通它不知道；
4. `client.js` 是浏览器侧，套件只做了源码字符串守卫（M10）⇒ 逻辑错也照样绿。

⇒ **结论：绿灯不是证据，覆盖率才是。** 本轮据此新增 `smoke-test-graph-mode-pre.mjs`（graph 档端到端，**13/13**），它一跑就抓出 BUG-15。

## 四、本轮修复清单（落点到函数名）

| # | 缺陷 | 修复落点 |
| --- | --- | --- |
| 1 | 闸门读到默认配置 | 新增 `MemoryEngine.loadConfigSync()`（与 `loadConfig` 共用 `_mergeConfigPre`）；`apply` 构建 tools 前调用 |
| 2 | 注册返回值被丢弃 | `apply` 内 `tools.push(defineTool(...))` |
| 3 | write/rebuild 两个 id | 新增 `wbRefPre()` 作**唯一构造口径**；`writeSidecarEntryPre` / `rebuildSidecarIndexPre` 共用 |
| 4 | 契约缺字段 | `buildSidecarEntryPre` / `rebuildSidecarIndexPre` 补齐 §3.3+§4.1 全字段 |
| 5 | tag 正则漏采 | `extractTagsPre` 改左边界判定（拒绝 `xxxtype:` 假阳性，接受中文标点紧邻） |
| 6 | 路径取错 | `expandWhiteboardByTagPre` / `traceWhiteboardByIdPre` 改走 `resolvePaths` |
| 7 | 死分支 | 新增 `wbWsKeyPre(projectDir)` 并注明恒等依据 |
| 8 | 无词法回落 | `expandWhiteboardByTagPre` 无命中时回落 `searchHandoffCorpus` |
| 9 | 锚点从未写入 | 新增 `applyAnchorsPre()`（纯函数、幂等、重排不变 id）；两咽喉在 graph 档写入 |
| 10 | events.jsonl 未实现 | 新增 `appendSidecarEventPre()`；两咽喉写入后追加事件 |
| 11 | 设置页不落盘 | `client.js` 的 `pick()` 改走 `saveConfigPatch(…, {onSaved, onError})` |
| 12 | 面板看不到 sidecar | `handoffPanelData` 的 `fileQ` 白名单放行 `index.json` / `events.jsonl`（仍是枚举式，不通配） |

**关于 P3-3（三处工具数硬锁 14→16）的一处主动偏离**：规划写这条时**闸门还不存在**。现设计要求「legacy 默认档字节级不变」⇒ 三处硬锁**保持 14**，graph 档的 16 由新套件独立断言。这是对规划的**有意修正**，不是漏做。

## 四点五、P2/P3 输入端与检索端补线（2026-09-16 第二批）

第一轮审计的结论是「白板线只做完**存储/写入**半边，**消费/检索**半边整体缺失」。本批补齐这半边，**默认仍走 legacy**。

| 项 | 规划原文要求 | 本次落点 | 验证 |
| --- | --- | --- | --- |
| **P0-1** | 新建 `docs/HANDOFF-CRITERIA.md`（判据表 + 正反例 + 引用关系） | 新文件（H1-H4/P-H1/P-S1 全表 + 正反例 + 5 处引用关系） | 文件存在 |
| **P2-3** | `searchHandoffCorpus` 升 **tag/段级优先 + 词法兜底** | 改为**两段式**：结构化臂消费 `by_tag`/`by_cue` 倒排（label `白板结构化/<source> [<id8>]`），词法臂原样保留作兜底 | E3 |
| **P2-4** | 注入端锚点表区扩展 **tag 摘要行** | `buildContinueCarry` 内调 `whiteboardTagMapPre(null, p)` 注入「【白板 tag 地图(结构化导航)】」+ 工具用法提示 | E1 |
| **P2-5** | GUI 加 **tag/段视图**；fileQ 放行 `.json` | 后端 `handoffPanelData` 返回 `structured`（tags 倒排 + 按 kind 段视图）与 `boardMode`；前端**条件渲染**两张卡 | E4 |
| **P3-2** | 第3层 guide 加**唤醒句** | 注入「【白板结构化检索(优先于通读第3层)】」并点名两工具与参数 | E2 |
| 白板页切换按键 | — | 复核确认**已存在**（`switchCard` 内 `data-dam-key: 'boardMode'`，走 `saveConfigPatch` + `location.reload`） | E5 |

**闸门纪律**：P2-3/P2-4/P3-2 与 `structured` **全部只在 `boardMode==='graph'` 生效**；
legacy 档注入文本与面板返回结构**逐字节不变**（后端 `structured:null` + 前端 `if (data.structured)` 双重保证）。

### 变异演示（第二批，3/3 真失败，逐字节还原）

| 变异 | 期望 | 实测 |
| --- | --- | --- |
| ① P2-4 调用点改成常量（退回「只定义不调用」） | E1 红 | **exit=1**，`实为 0 处` |
| ② 删掉 P3-2 唤醒句文案 | E2 红 | **exit=1**，`唤醒句不在场` |
| ③ 前端条件渲染改 `if (true)`（legacy 也渲染） | E4 红 | **exit=1**，`必须条件渲染` |

三次变异后 `lib/index.js` 与 `lib/client.js` **SHA256 均逐字节还原**。

### 套件

`smoke-test-graph-mode-pre.mjs` **13 → 18 断言**（新增 E1-E5）。
新增断言的**口径**值得记录：这四条缺陷的共同特征是「**函数写了但没人调用**」——无副作用，任何行为测试都测不出来。
所以 E 组断言的是**调用点在场**（`this.whiteboardTagMapPre(` 出现次数 ≥1、唤醒句字面量在场、`if (data.structured)` 在场），
而不是「函数存在」。

### 回归

**全量回归 PASS 96 / FAIL 0 / TIMEOUT 0（149.9s）**，无 BOM。

## 五、验证

- 新增套件 `smoke-test-graph-mode-pre.mjs`：**13 passed / 0 failed**（含 A1 graph=16、D1 legacy=14、D2 非法值 fail-closed=14、C1 两路径同 id、B6 锚点幂等/重排/改名）。
- 既有套件 P23 的 M9 断言语式随 BUG-15 修复同步更新（从「裸 `defineTool` 在场」升级为「`tools.push(defineTool(...))`」——前者会被注释骗过）。
- 补 2 处抽取式沙箱缺桩（`handoff-pre` / `p7-write-fix` 的 fake engine 加 `appendSidecarEventPre`）——**同类坑第二次踩**，已在本节留档。
- **全量回归：PASS 96 / FAIL 0 / TIMEOUT 0（143.2s）**，套件 95→96（新增 graph 套件），零破坏。

### 变异演示（§6 交付纪律：新增守卫必须演示变红后按字节还原）

| 变异 | 期望 | 实测 |
| --- | --- | --- |
| ① 把 `tools.push(defineTool('memory_expand'…))` 还原成裸 `defineTool(…)`（BUG-15 复发） | graph 套件变红 | **exit=1，真失败** |
| ② 删掉 `engine.loadConfigSync()` 调用（BUG-1/11 复发） | graph 套件变红，且应看到 `ready: engine + 14 tools`（回落 legacy） | **exit=1，真失败**；A1/A2/A3 三条同时红，日志实证退化为 14 工具 |

两次变异后 `lib/index.js` **SHA256 逐字节还原**（`0E36650A08DF616B19C46CE65AD110CD72C8FD3BFFD86AEEFE916A0A6026898B`）。

## 六、仍未做（如实）

- dsh-graph profile 接线：**用户裁定「先不接线，先把 memory 侧修干净」**，故本轮不碰 `~/.dsh/profiles/web/`。
- 三处工具数硬锁仍为 14：系上节所述**有意偏离**。
- 全量回归复跑结果见本轮对话记录（本节写作时后台进行中）。
