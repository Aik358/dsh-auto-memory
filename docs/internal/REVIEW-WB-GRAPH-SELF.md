# REVIEW · WB-GRAPH 白板线自审（2026-09-16 凌晨，施工方自审）

> 自审立场：**假设自己有错**，逐行回读本窗口写下的代码，只采信代码/配置/日志证据。
> 结论先行：**P1 判据对账是扎实的；P2/P3 与 GUI 开关存在 3 个致命 bug + 6 项未按规划完成**。"切了没反应"不是环境问题，是代码问题。

---

## 一、致命 bug（会让功能整体失效）

### BUG-1 ★ 工具注册时机早于配置加载 ⇒ graph 档永不生效

**证据链**：
- `lib/index.js:8506` `const tools = [...]` 在 `apply()`（`:7633`）内**同步构建**；`:9763` `for (const tool of tools)` → `:9772 ctx.tools.register(tool)`。
- P3 注册闸门写的是 `resolveBoardModePre(engine.config.boardMode)`。而 `engine.config` 在 `MemoryEngine` 构造时（`:982` `this.config = { ...DEFAULT_CONFIG }`）是**默认值**，`DEFAULT_CONFIG.boardMode = 'legacy'`。
- 真配置只在 `loadConfig()` 里合并（`:1597`），而 `loadConfig()` 是**懒加载**：全仓唯一自动调用点是 `resolvePaths()`（`:1739` `if (!this.configLoaded) await this.loadConfig()`）——即"首次工具调用"才发生。
- 取证：`apply()` 段（7632–8510）内 **无** `await engine.loadConfig()`。

**后果**：不管配置里写 `graph` 还是 `legacy`，插件启动时读到的永远是默认 `legacy` ⇒ **`memory_expand` / `memory_trace` 永远不注册**。用户配置里 `"boardMode": "graph"` 是真写进去了（见 §四证据），但工具从未出现。

**修法**：`apply()` 内在构建 tools 之前 `await engine.loadConfig()`（必要时兜底 catch）；或把注册闸门的判定改为"延迟到首次调用时再判"。

### BUG-2 ★ P2/P3 取工作区路径的 API 用错了 ⇒ 跑到 DSH 安装目录

**证据链**：
- 我写的 `expandWhiteboardByTagPre` / `traceWhiteboardByIdPre`（`:2041`、`:2054`）用 `agent && agent.cwd ? agent.cwd : process.cwd()`。
- 全仓 grep `agent.cwd` **只有这 2 处命中**（就是我新加的两行）⇒ 该字段不是本仓库既有约定，**几乎必然为 undefined**。
- 既有权威写法是 `await this.resolvePaths(agent)` → 返回 `{ ws, projectDir, planPath, handoffDir, ... }`（`:1738-1790`）。全仓 20+ 处都这么写（`:1835`/`:2483`/`:3809`/`:3990`/`:4062`…）。
- 于是回退到 `process.cwd()`：dsh web 宿主的工作目录是 **DSH 自己的安装/启动目录**，不是用户工作区。

**后果**：两个工具会在错误目录找 `handoff/index.json`，找不到就触发 `rebuildSidecarIndexPre` 在**错误目录建 handoff/**；即便 sidecar 已生成，查询也永远返回 0 条。

### BUG-3 ★ 设置页按钮"改了不保存就刷新" ⇒ 用户点完等于没点

**证据链**：
- 我在设置页加的双按钮调的是 `set('boardMode', m)`，然后 `setTimeout(() => window.location.reload(), 350)`。
- `set()` 的实现（`lib/client.js:4047`）是：`var next = {...cfg}; next[key]=value; setCfg(next); setDirty(true)` —— **只改本地 state 并标脏，不写盘**。真正写盘要靠设置页的"保存"按钮。
- 350ms 后 `location.reload()` ⇒ **脏数据被丢弃**，配置文件不变。
- 接续面板那个按钮用的是 `saveConfigPatch({...})`（立即写盘）⇒ 那个是对的。

**后果**：用户在**设置页**切换 = 无任何效果（连配置都没改）。用户看到配置里是 `graph`，说明他点的是**接续面板**那个按钮（或另有写入路径）。

---

## 二、高/中危缺陷

| # | 缺陷 | 证据 | 影响 |
| --- | --- | --- | --- |
| BUG-4 | sidecar 用了不存在的 `this.wsDirKey` | grep `wsDirKey` 全仓 0 命中；真名是 `wsKey(ws)`（`:1686`） | `workspaceKey` 退化为 `path.basename(projectDir)`，与 `WB-FORMAT-CONVENTION §2` 锚点契约的 workspaceKey 口径不一致；同一工作区换路径写法会算出不同 id |
| BUG-5 | 三处工具数硬锁未同步 | `smoke-test.mjs:67` / `smoke-test-m3b3-pre.mjs:43` / `smoke-test-context-observer.mjs:107` 仍是 `!== 14` | 方案 P3-3 标为"**必须项**"（漏改任一处即红）。当前全绿只因测试跑在 legacy 档、工具数确实是 14 —— **graph 档下这三个套件会红**，属"锁没建全"而非"锁对了" |
| BUG-6 | `events.jsonl` 未实现 | 方案 A2 与 P2-1 明确要求 `index.json` + `events.jsonl`（append-only `{ts,actor,event,target,details}`）；实际只写了 index.json | P2 未按规划完成；`criteria.passed/warned` 确认事件链缺失（方案 §2.4 第 2 层） |
| BUG-7 | 遍历工具不返回正文 | 方案 §4.1 要求返回条目 Content；`expandByTagPre` 只回 `{id,title,source,tags,cue,chars,ts}` | "主动重建上下文"的核心价值（省去通读 18000 carryText）没落地 |
| BUG-8 | 无正文级检索兜底 | 方案 P3-1 要求"index.json 缺失时 fail-soft 回落 `searchHandoffCorpus`"；实际只做重建，未回落词法检索 | 与规划不符 |
| BUG-9 | 未接线 dsh-graph | `vendor/dsh-graph/NOTICE-VENDOR.md` 自述"待用户明示" | 用户的核心诉求（可视化看板）未兑现；用户对此的抱怨成立 |

---

## 三、确认「做对了」的部分（避免自审只挑刺）

- **P1 判据门对账**：`wb-contract-pre.js` 的 H1–H4/S1–S4 实现与 `checkMutationPre` 两咽喉接线**经实测确认存在**（不是假设），`ledger-criteria-pre.js` 只做转发再导出（单一真源），10/10 断言绿。
- **legacy 档零行为**：`writeSidecarEntryPre` 首行闸门 + 工具注册闸门 + `DEFAULT_CONFIG.boardMode='legacy'` 三处齐备；全量回归 **95/0/0（145.4s）** 证明既有 92 套件未破。
- **变异演示有效**：3/3 真失败（且发现 M9 断言被注释串骗过，已改用行首锚定 `/^\s*defineTool\(/`）—— 这个自我纠错是真实的。
- **抽取式套件补桩**：handoff-pre 53/53、p7-write-fix 40/40 修复到位（新增引擎方法必须同步补 fake engine 桩）。

---

## 四、外部可复核证据

| 项 | 值 |
| --- | --- |
| 用户配置文件 | `C:\Users\JH Z\.dsh\dsh-auto-memory-pre.json` 内 `"boardMode": "graph"`（**已落盘**） |
| 全量回归 | `PASS 95 / FAIL 0 / TIMEOUT 0（145.4s）`（`node tools/run-smoke.mjs`） |
| 工具数硬锁 | 三处仍 `!== 14` |
| `agent.cwd` | 全仓仅 2 处，均为本次新增 |
| `wsDirKey` | 全仓 0 处 |
| `apply()` 内 loadConfig | 0 处 |

---

## 五、为什么"切了也什么都没有发生"（一句话归因）

**三重叠加**：① 设置页按钮不保存（BUG-3）；② 即便保存了，工具注册时机早于配置加载（BUG-1）⇒ 新工具永不注册；③ 即便工具注册了，取路径 API 用错（BUG-2）⇒ 查询也查不到东西。**再加上 dsh-graph 看板本身还没接线（BUG-9）**，所以从用户视角"什么都没发生"是完全符合代码现状的。
