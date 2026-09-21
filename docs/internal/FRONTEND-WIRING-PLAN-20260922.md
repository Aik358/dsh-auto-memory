# 前端接线施工图 · 四项（hubIo 落盘健康度 / facts 淘汰可观测 / python 侧车诊断 / 结论层状态徽章）

- 出图日期：2026-09-22
- 依据：`docs/internal/FRONTEND-WIRING-AUDIT-20260922.md` 第 4/5/6/7 条；本图对每条**独立复验**，并修正了 3 处与 Lead 口述/审计不一致的事实
- 纪律声明：本图**只读调研 + 只写本文件**；未修改 `lib/` 下任何文件；未 commit / 未 push；未重启任何进程
- 证据口径：每条结论带 `file:line`；凡属推断均显式标注「推断」

## ⚠️ 读图前必读：line number 正在漂移

`lib/client.js` 由 Lead 并发施工中，**行号每次读取都会变**：

| 时刻 | client.js 行数 |
|---|---|
| 审计报告成稿时（01:17） | 6 362 |
| 本次复验时（01:56:59） | **6 675** |

⇒ 本图的 `file:line` 是 **2026-09-22 01:56:59 快照**下的值；施工时请以**锚点代码形态**（下表的「锚点」列）重新定位，或以 `grep` 原始串定位。`lib/index.js` 当前 mtime 01:05:33，**未**在本次复验窗口内变化。

## 一、硬事实复验（含三处必须纠正的偏差）

| # | 待验事实 | 复验结果 | 证据 |
|---|---|---|---|
| 1 | `lib/client.js` 里 `hubIo` / `pythonBackend` / `pruneProtected` / `debugInfo` 零命中 | **成立** | 逐词 `-SimpleMatch` 计数均为 0；`Select-String` 行号为空 |
| 2 | 同上，`pruned` 也是 0 命中 | ❌ **不成立，有 1 处命中** | `lib/client.js:567`，但它是 **i18n 英文串内部**：`fFactRetentionHint: 'Maximum facts kept; when exceeded, revoked facts are pruned first…'` ⇒ **非消费者**。结论（前端不读 prune）不变，但「0 命中」的表述应改为「1 命中且位于 i18n 文本内」 |
| 3 | 「facts 保留上限可配置」是未接线项（审计总表第 4 条：客户端 `factRetention` 0 命中、设置页无此项） | ❌ **该条已过时 —— Lead 已接线完成** | `lib/client.js:6113` 设置项 `field(t('fFactRetention'), h('input', { type:'number', min:10, value: cfg.factRetentionMax … onChange: set('factRetentionMax', …) }), t('fFactRetentionHint'))`；i18n zh `lib/client.js:372`、en `:567`。⇒ **该条应从待办列表划掉**，不要重复施工 |
| 4 | `getLastPrune()` / `retentionLimit()` 连宿主都无调用方 | **成立** | `lib/fact-store-pre.js:832` / `:834` 是唯一定义；`lib/index.js` 对这两个名字 `-SimpleMatch` 计数 **均为 0** |
| 5 | `mark`（结论层徽章文本）是否已进应答体 | **成立，且进的是 `smartRecall` 的 hits 投影** | `lib/index.js:6469` 投影 `{label, id8, score, l0, layer, mark: rec.mark}`；徽章文本产生于 `lib/l0-extract-pre.js:295+`（`' ' + L0_SUPERSEDED_MARK_PRE_V1 + '（已被 … 取代）'` / 撤回态带 `reason`）；另 `lib/index.js:6362` 把 `c.mark` 内联进 `recall` 的文本 `result` |

## 二、四项施工图

> 每行 = 一个可独立施工的接线点。「API 常量」列全部取自 `lib/client.js` 的 `var API = {…}` 表（`lib/client.js:1185` 起），**未新建任何常量**。
> 「重启 dsh web」列：本插件的前端是宿主启动时注入的浏览器 bundle，改 `lib/client.js` 后 **仅需刷新页面**；只有改 `lib/index.js`（宿主路由/字段）才需要重启宿主进程。

### P0-2 · `hubIo` 三层记忆落盘健康度（最高优先：回答「记忆到底写进磁盘没有」）

| 项 | 内容 |
|---|---|
| **宿主字段/接口** | `lib/index.js:6959` `hubIo: this._hubIoViewSnapshot()`；快照实现 `lib/index.js:6847-6849` → `hubIoHealthSnapshotPre(this._hubIoHealth)`；投影定义与**人话**生成 `lib/hub-io-pre.js:186-217`（`verdict` `:209`、`summary` `:210-212`）；errno→中文表 `lib/hub-io-pre.js:30-43`，翻译函数 `:46-52`。注：`explainHubIoErrorPre` 的产物**已并入 `summary` 文本**，前端**不需要**再调它 |
| **前端 API 常量** | `API.debug`（声明 `lib/client.js:1192`） |
| **响应体字段路径** | `data.hubIo.verdict`（`'ok'`\|`'io-error'`）、`data.hubIo.summary`（中文整句）、`data.hubIo.errors`（次数）、`data.hubIo.lastError`、`data.hubIo.lastErrorAt`、`data.hubIo.saves` / `.loads` / `.clears`、`data.hubIo.byFile{<文件名>:{count,lastError,lastErrorAt}}` |
| **锚点（现文件内）** | `apiGet(API.debug)` = `lib/client.js:4966`；`function kv(label, value, warn)` = `lib/client.js:4971`；kv 首行 `kv(t('kvVersion')` = `:5039`；kv 末行 `kv(t('kvWs')` = `:5049` |
| **建议落点组件** | 诊断页签的 kv 列表尾部（在 `kv(t('kvWs'), …)` **之后**追加；该 kv 块现为 `lib/client.js:5039-5050+`）。颜色判据直接用 `verdict === 'io-error'` 传 `kv()` 第三参 `warn=true`（`kv` 的告警色在 `lib/client.js:4971`） |
| **新增 i18n 键（zh / en）** | `kvHubIo`：`'三层记忆落盘'` / `'Hub persistence'`；`kvHubIoOk`：`'正常（本轮无写入失败）'` / `'OK (no write failures this session)'`；`kvHubIoErr`：`'异常'` / `'ERROR'` |
| **重启 dsh web** | **否**（仅刷新页面） |
| **会变红的既有断言** | **0 条**。实测：全 `tests/` 对 `kvVersion` / `kvHeartbeat` / `data.subagents` / `duplicateHeadings` **零断言**（grep 0 命中）；本项不新增 `API.*` 常量 ⇒ `smoke-test-api-paths-pre` 的路径表一致性锁不触发 |

### P0-3 · `facts` 淘汰可观测性（**须拆两半**：一半前端可接，一半宿主也缺）

**P0-3a 可接线部分：`pruned` / `pruneProtected` 已在应答体里**

| 项 | 内容 |
|---|---|
| **宿主字段/接口** | 计数写入 `lib/fact-store-pre.js:716`（`stats.pruned`）/ `:717`（`stats.pruneProtected`）；全量导出 `lib/fact-store-pre.js:824` `getStats: () => ({ ...stats })`；经 `lib/memory-hub-pre.js:241` 组装的 `facts` 对象、`:245` `stats: stores.facts.getStats()` 进 overview |
| **前端 API 常量** | `API.memoryHub`（声明 `lib/client.js:1232`） |
| **响应体字段路径** | `data.facts.stats.pruned`（累计淘汰条数）、`data.facts.stats.pruneProtected`（**已被轮到删「重要项」的条数 ⇒ >0 表示上限设得过低**，语义见 `lib/fact-store-pre.js:672-677` 注释） |
| **锚点** | `fetch(API.memoryHub)` = `lib/client.js:3430`；`function MemoryHubTab` = `lib/client.js:3414`；`var facts = data.facts` = `lib/client.js:3454`；facts 卡片渲染 = `lib/client.js:3527-3534` 一带 |
| **建议落点组件** | MemoryHubTab · **事实层卡片**（现为 `Card(t('hubFacts') + ' (' + facts.size + ')')`）。在卡片内加一行：`本上限淘汰 N 条（其中保护项 M 条）`；`pruneProtected > 0` 时用告警色，提示「上限设得过低」 |
| **新增 i18n 键（zh / en）** | `hubPruned`：`'已按上限淘汰'` / `'Pruned by retention limit'`；`hubPrunedProtected`：`'其中受保护项'` / `'of which protected'`；`hubPrunedWarn`：`'已开始裁剪重要项 —— 建议调高事实条数上限'` / `'Important facts are now being pruned — raise the fact retention limit'` |
| **重启 dsh web** | **否** |
| **会变红的既有断言** | **0 条**（实测：全 `tests/` 对 `facts.recent` / `facts.size` / `hubFacts` 零断言） |

**P0-3b 宿主也缺部分（前端接不了，见第三节）**：`getLastPrune()` / `retentionLimit()`。
**关键提醒**：不要在 `lib/client.js` 里改 `JSON.stringify(data.stats)`（现 `lib/client.js:3546`）来「顺便人话化」——那是 **hub 自身的 stats**（`lib/memory-hub-pre.js:236`），与 facts 淘汰无关；它对应审计 P2-1/P2-2，**不在本图范围**（改它另有断言风险，见第五节）。

### P1-1 · Python 侧车看门狗 + stderr 可视（本行成果，宿主字段已就绪）

| 项 | 内容 |
|---|---|
| **宿主字段/接口** | `lib/index.js:6944-6947`：`pythonBackend: (() => { const c = this._pythonSidecar; return Object.assign({ enabled: this.config.pythonBackendEnabled === true }, c ? c.debugView() : {}) })()` |
| **字段本体（即上一任务新造的 debugView 投影）** | `lib/python-sidecar-client-pre.js:583-601`，键为：`started`、`epoch`（截断显示用）、`generation`（第几代）、`pending`、`breaker{open,consecutiveFailures,cooldownMs,halfOpenProbePending}`、`stderrTailBytes`、`lastStderrTail`（**截断后的多行文本**）、`lastStderrTailBytes`、`lastStderrTailTruncated`、`lastStderrTailAt`、`consecutiveTimeouts`、`watchdog{kills,respawns,lastReason,lastAt,lastDetail}`、`recentDiag[≤4]{at,level,message}`、`stats{…}` |
| **前端 API 常量** | `API.debug`（同上） |
| **响应体字段路径** | `data.pythonBackend.enabled` / `.started` / `.generation` / `.watchdog.kills` / `.watchdog.respawns` / `.watchdog.lastReason` / `.lastStderrTail` / `.lastStderrTailTruncated` / `.stderrTailBytes` / `.recentDiag[]` |
| **锚点** | 同 P0-2（`apiGet(API.debug)` = `lib/client.js:4966`；kv 块 `:5039-5050+`） |
| **建议落点组件** | 诊断页签 · kv 块**之后**新增一个折叠块（`<details>` 或既有 `Card`）。**三行 kv + 一段 `<pre>`**：①`enabled/started` 一行；②`watchdog.kills / respawns / lastReason` 一行（中文人话）；③`lastStderrTail` 用 `<pre>` 原样铺开（**不要塞进 `kv()`**，它是多行文本；`lastStderrTailTruncated=true` 时前缀加「已截断」）。`recentDiag` 可直接渲染 `message`（宿主已写成中文整句，见 `lib/python-sidecar-client-pre.js:143-152` 的 `pushDiag`） |
| **新增 i18n 键（zh / en）** | `kvPyTitle`：`'Python 语义侧车'` / `'Python semantic sidecar'`；`kvPyOff`：`'未启用（JS 端语义不受影响）'` / `'disabled (JS-side semantics unaffected)'`；`kvPyAlive`：`'运行中'` / `'running'`；`kvPyWatchdog`：`'看门狗击杀 / 重生'` / `'Watchdog kills / respawns'`；`kvPyStderr`：`'最近 stderr 尾部'` / `'Last stderr tail'`；`kvPyStderrTrunc`：`'（已截断）'` / `'(truncated)'` |
| **重启 dsh web** | **否**（宿主字段 01:05 前已就位；本项纯前端） |
| **会变红的既有断言** | **0 条**（实测 `tests/` 对 `pythonBackend` / `watchdog` / `stderrTail` 零断言；本项不新增 `API.*` 常量） |
| **模型友好提醒** | 该块的文案必须显式写「Python 档 = 可选进阶项；未启用不影响 JS 端语义」——这是本仓铁律在 UI 上的落点，避免用户以为语义失效 |

### P1-2 · 结论层 `superseded` / `retracted` 徽章（**最省事的一项：数据已在应答体，只差渲染**）

| 项 | 内容 |
|---|---|
| **宿主字段/接口** | 写侧 `lib/index.js:6047`（`applyNoteStatusPre` 导入）/ `lib/index.js:10286`（`memory_note_pre` 调用）；读侧注入 `lib/index.js:6209-6213`（`statusOf: (id) => statusOfNotePre(text, id)` → `l0Corpus.push({… status, mark: markL0(it) })` at `:6216`）、`lib/index.js:6486`（`statusOf: statusOfNotePre`）；徽章文本产出 `lib/l0-extract-pre.js:295+`（`supersededMarkPre`） |
| **已进应答体的位置** | ①`lib/index.js:6469` 语义 hits 投影含 `mark: rec.mark`（该数组即 `smartRecall` 的 `hits`）；②`lib/index.js:6362` 把 `c.mark` 内联进 `recall` 的文本 `result` |
| **前端 API 常量** | `API.smartRecall`（声明 `lib/client.js:1190`）；若走文本流则 `API.recall`（`:1189`） |
| **响应体字段路径** | `smart.hits[i].mark`（字符串，**带前导空格**，渲染前 `.trim()`）；`mark === ''` 表示现行（`current`）条目 |
| **锚点** | `smart.hits.map(function (hit, i) {` = `lib/client.js:4163`（当前只读 `hit.where` 等字段，未读 `mark`） |
| **建议落点组件** | SearchTab · 智能检索结果行（`lib/client.js:4163` 的 `hits.map` 内），在当前拼接串末尾追加 `String(hit.mark \|\| '').trim()`，用 `.includes('已撤回')` 或 `hit.mark` 非空决定是否加徽章样式（宿主文本形态见 `lib/l0-extract-pre.js:295+`） |
| **新增 i18n 键** | **0 条** —— 徽章文案由宿主产出的中文串承载，前端只做条件渲染。若日后要加「现行」徽章才需 +2 键（本图不建议，理由：`mark` 为空即现行，加徽章反而噪声） |
| **重启 dsh web** | **否** |
| **会变红的既有断言** | **0 条**。但 ⚠️ **绝对不要顺手改 `lib/index.js:6467-6469` 那个闭包**：其注释明写「★本闭包会被 smoke 套件用 `new Function` 抽源码单独求值，故只能依赖 env/自身」⇒ 改它会让对应套件判红（**具体套件名未定位，标注为推断**，需施工时实测确认） |

## 三、「宿主还没做完、前端接不了」的项（必须先改宿主）

| 项 | 宿主证据 | 为什么前端接不了 | 结论 / 建议 |
|---|---|---|---|
| **`getLastPrune()`（最近一次淘汰的详情）** | `lib/fact-store-pre.js:832` 定义；`lib/index.js` 全域 **0 命中** | 它没进任何路由应答体。`memory-hub-pre.js:245` 只转 `getStats()`（`({...stats})`，**不含 `lastPrune`**，因为 `lastPrune` 是闭包变量 `lib/fact-store-pre.js:681`，只在 `:718` 赋值、`:832` 单独暴露） | **需先改宿主**：在 `lib/memory-hub-pre.js:241` 的 `facts: {…}` 里补一个字段（如 `lastPrune: stores.facts.getLastPrune ? stores.facts.getLastPrune() : null`）。之后前端才可接。**未列入本图可施工项** |
| **`retentionLimit()`（当前生效上限）** | `lib/fact-store-pre.js:834` 定义；`lib/index.js` **0 命中** | 同上未进应答体 | **不建议接线**：当前上限已由 `config.factRetentionMax` 暴露（宿主默认值 `lib/index.js:582`；注入点 `lib/index.js:9236`），且**设置页已可读可改**（`lib/client.js:6113`）⇒ 该访问器与配置值**冗余**。建议按死码处理（删除，或加注释标注「仅诊断用、当前无消费者」） |
| **（已闭环，勿重复施工）facts 保留上限的可视可改** | 宿主 `lib/index.js:582` / `:9236` | — | **Lead 已于 01:48 前后接线完成**（`lib/client.js:6113` + i18n `:372`/`:567`）。从待办中移除 |

## 四、i18n 键新增清单（汇总）

**共需新增 12 键（zh 6 条 + en 6 条口径合并计为 12 行）：**

| 键名 | zh | en | 归属 |
|---|---|---|---|
| `kvHubIo` | 三层记忆落盘 | Hub persistence | P0-2 |
| `kvHubIoOk` | 正常（本轮无写入失败） | OK (no write failures this session) | P0-2 |
| `kvHubIoErr` | 异常 | ERROR | P0-2 |
| `hubPruned` | 已按上限淘汰 | Pruned by retention limit | P0-3a |
| `hubPrunedProtected` | 其中受保护项 | of which protected | P0-3a |
| `hubPrunedWarn` | 已开始裁剪重要项 —— 建议调高事实条数上限 | Important facts are now being pruned — raise the fact retention limit | P0-3a |
| `kvPyTitle` | Python 语义侧车 | Python semantic sidecar | P1-1 |
| `kvPyOff` | 未启用（JS 端语义不受影响） | disabled (JS-side semantics unaffected) | P1-1 |
| `kvPyAlive` | 运行中 | running | P1-1 |
| `kvPyWatchdog` | 看门狗击杀 / 重生 | Watchdog kills / respawns | P1-1 |
| `kvPyStderr` | 最近 stderr 尾部 | Last stderr tail | P1-1 |
| `kvPyStderrTrunc` | （已截断） | (truncated) | P1-1 |

**命名合规性核验**：全部沿用现有前缀族 —— 诊断页签行用 `kv*`（现有 `kvVersion`/`kvHeartbeat`/`kvWs`/`kvApi` 见 `lib/client.js:254-259`），中枢卡片用 `hub*`（现有 `hubFacts`/`hubConflicts`/`hubStage*`/`hubWhy*` 见 `lib/client.js:209`+`283-301`）。**未新造前缀**。中英双写惯例：zh 段 `lib/client.js:203-400`、en 段 `:401-…`（同一键在两侧各一条，插在与同类键相邻处）。
**P1-2 需 0 键**（徽章文本由宿主产出）。

## 五、既有断言受影响清单（施工前必读）

| 断言/套件 | 现状 | 本图四项是否触发 |
|---|---|---|
| `tests/smoke/smoke-test-api-paths-pre.mjs`（客户端 `API` 表 ⊆ 宿主路由表 + 表外禁裸路径 + 宿主独有路径白名单） | 锁死两份路径表一致性 | **不触发** —— 四项全部复用现有常量（`API.debug` / `API.memoryHub` / `API.smartRecall`），**不新增 `API.*` 常量** |
| `tests/smoke/smoke-test-issue30-procedure-promotion-pre.mjs:196` | 用正则锁死 `client.js` 里 `reasonCodes.join(', ')` 的**原文形态** | **不触发**（本图不含 `actMsg` 人话化）。⚠️ 若日后做审计 P2-2「操作回执人话化」，**这条会红**，必须同步改断言 |
| `tests/smoke/smoke-test-panel-position-pre.mjs:65` | 反向锁：i18n 不得出现 `posTop` | 不触发（新增键无 `posTop`） |
| i18n 中英对齐类断言 | 实测全 `tests/` **未发现**「zh/en 键集必须相等」的断言（唯一 i18n 相关命中是 `smoke-test-panel-position-pre.mjs:76` 的打印行） | 不触发；但仍按惯例双语补齐 |
| `lib/index.js:6467-6469` 闭包被 `new Function` 抽源码求值的套件 | 源码注释自陈 | **只要不动该闭包就不触发**（**推断**：具体套件名未定位） |
| 诊断卡 / 中枢卡内容断言 | 实测 `tests/` 对 `kvVersion`、`kvHeartbeat`、`data.subagents`、`duplicateHeadings`、`hubFacts`、`facts.size` **零断言** | **不触发** |

**结论：本图四项按上表落点施工，预期变红断言共 0 条。**

## 六、实施顺序与生效方式

1. **P1-2（最短路径，先做）** → 改 `lib/client.js:4163` 一行渲染，零 i18n、零宿主改动 ⇒ 立刻能看到「⚠已撤回」徽章。
2. **P0-2 + P1-1（同一落点，合并做）** → 都在诊断页签 kv 块之后；一次追加两组 kv/折叠块，共用一次刷新。
3. **P0-3a** → MemoryHubTab 事实层卡片加一行。
4. **P0-3b** → 需先改 `lib/memory-hub-pre.js`（宿主），**本图不施工**；`retentionLimit` 建议按死码清理。

**生效方式**：四项全部只改 `lib/client.js` ⇒ **用户刷新页面即可**，不需要重启 dsh web。若采用第 4 步的宿主侧扩展，才需要用户手动重启宿主（本 agent 一律不代劳）。

## 七、未取证的边界（如实声明）

- 本图为**静态源码复验**，未启浏览器点击、未重启宿主；「数据已在应答体」均由 `file:line` 源码链路证明，**未经运行时实拍**。
- `client.js` 行号随时漂移（本次窗口内已 +313 行）；施工请以锚点串为准。
- 「`lib/index.js:6469` 闭包被哪个 smoke 套件抽源码求值」**未定位到具体文件**，标注为推断。
- 审计报告里其余未列入本图的能力（memory-hub 编排动作、手动立即反思、子代理 GC 回执、debugInfo 其余最小投影等）仍在待办，本图未覆盖。
