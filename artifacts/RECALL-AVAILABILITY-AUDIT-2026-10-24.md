# memory_recall 可用性审计（全失败面）

- 审计对象：`D:\dsh-auto-memory`，分支 `dev`，基线提交 **a53560e**
- 审计时间：2026-10-24
- 用户原话（背景）：「Memory recall，主要是你之前有一次超时。它不是效果好不好，而是有时候调不起来，这个也做到排查的其中之一，先把这个功能修好，再谈效果如何。」
- 探针：`artifacts/probe-recall-avail.mjs`（只读，不写用户数据）
- 复算方式：见 §0.2

> **重要前提（必读）**：本审计执行期间，工作树 `lib/index.js` 被 Lead 的 R0 修复改动（`git status` 出现 `M lib/index.js`，+88/-5）。为保证「测的是 a53560e 基线」，全部计时与失败复现都在 **`git show a53560e:lib/index.js` 导出到仓外的纯净副本**（`D:\_recall_audit\base`，index.js sha256 = `a573265370972b6837f280baaa1ad1f29409e76bea603d87d58f5eafc0341ffd`，21,232 行）上跑。R0 修复后的行为在 §6 单列「已落地验证」，两者不混。

---

## §0 方法与口径

### 0.1 环境（探针实测）

| 项 | 值 |
|---|---|
| 工作区 | `D:\dsh-auto-memory` |
| 记忆项目目录 | `C:\Users\JH Z\.dsh\memory\workspaces\--D--dsh-auto-memory--` |
| 用户级记忆 | `C:\Users\JH Z\.dsh\memory\MEMORY.md` |
| `~/.dsh/sessions` 下会话文件 | **780 个 / 1,360.6 MiB**（探针实测；Lead 起点为 776 / 1,357MB，属会话文件自然增长） |
| 配置 | boardMode=graph，handoffEnabled=true，externalSources=13 |
| Node | v24.18.0 |

**探针手法**：用 `node:module` 的 `registerHooks` 在加载 `lib/index.js` 时追加一行 `export { MemoryEngine as __ProbeEngine }`，拿到真类后直接 `new MemoryEngine()` —— 不经过 `apply(ctx)`，因此不会注册 15s 心跳、不会写 `polling-heartbeat.json`、不会起团队拉取循环。所有断言都真跑真 import。

**已知边界**：
- `_semanticRankBest` / `_jsSemanticRank` 未挂载 ⇒ 进程内数字是**纯词法 + IO 基线**，不含语义臂（宿主生产实例含语义臂，见 §1.3 对照）。
- 宿主 `sq.searchSessions` 的真实 ~8s 无法离线复现，改用「抛错桩 / 延迟桩」测边界（§2.6）。

### 0.2 复算命令

```bash
# 1) 导出 a53560e 基线到仓外（不污染工作树）
git -C /d/dsh-auto-memory show a53560e:lib/index.js > /d/_recall_audit/base/lib/index.js
cp -r /d/dsh-auto-memory/lib/. /d/_recall_audit/base/lib/        # 其余模块用现值（本次 R0 只改 index.js）
cp /d/dsh-auto-memory/package.json /d/_recall_audit/base/

# 2) 跑探针（默认跑当前树；PROBE_ROOT 指向基线树）
cd /d/dsh-auto-memory
PROBE_ROOT=/d/_recall_audit/base node artifacts/probe-recall-avail.mjs
```

探针输出为 `===PROBE_JSON_BEGIN=== … ===PROBE_JSON_END===` 包住的 JSON，含 `tree`、`indexSha`、`sections.env/arms/matrixInProcess/failures/degradationVisibility`。

---

## §1 逐 scope 计时矩阵

### 1.1 进程内矩阵（基线 a53560e，宿主桩=抛 `SESSION_QUERY_PERSISTENCE_FAILED`，每格 2 次）

| scope | format | min (ms) | median (ms) | 输出字符 | 说明 |
|---|---|---:|---:|---:|---|
| all | l0 | 2163.17 | **2401.30** | 14,638 | 最慢；跨工作区臂 + 会话臂全开 |
| all | full | 1427.71 | **1524.47** | 152,803 | 比 all/l0 快，见 1.4 |
| current | l0 | 194.48 | **197.02** | 4,258 | |
| current | full | 71.23 | **73.97** | 149,204 | |
| handoff | l0 | 23.78 | **24.69** | 2,899 | 最轻 |
| handoff | full | 23.82 | **25.12** | 2,899 | full 对本 scope 无差异 |
| archive | l0 | 39.27 | **39.44** | 5,206 | |
| archive | full | 38.53 | **38.56** | 34,610 | |
| sessions | l0 | 303.46 | **309.60** | 2,613 | |
| sessions | full | 285.15 | **294.33** | 2,613 | |

**读法**：`handoff`/`archive` 是**几十毫秒级**；`all` 与 `current` 差 **约 12 倍**。这个差不是「检索更多文件」造成的（current 也读同一批日志/反思/笔记），而是 `scope==='all'` 独有的两条外挂臂（跨工作区 + 历史会话）。

### 1.2 纯臂差分（同一查询、同一进程、只切 scope）

| 组合 | min (ms) | median (ms) |
|---|---:|---:|
| all / l0 | 1368.33 | **1414.79** |
| current / l0 | 195.57 | **201.72** |
| **Δ（all − current）** | — | **+1213.08** |
| all / full | 1232.33 | **1236.50** |
| current / full | 71.51 | **72.84** |
| **Δ（all − current）** | — | **+1163.66** |

即：**`scope='all'` 相对 `current` 的固定增量 ≈ 1.2 秒**（本机离线口径）。

### 1.3 与 Lead 实测（生产宿主）对照

Lead 已实测（勿重复测，此处仅引用）：all/l0 默认 8.9–12.0s、current 153ms、handoff 28ms、archive 42ms、sessions 8.35s。

本次审计**额外做了一次最小规模的活宿主复核**（5 次调用，代码在 `D:\_recall_audit\live.mjs`，走 `POST /api/dsh-auto-memory/recall`）：

| case | 实测 |
|---|---|
| all / l0 ×3 | **18565 / 14118 / 10835 ms** |
| current / l0 ×2 | **258 / 225 ms** |

**结论一致**：prod 上 `all` 是 10–18s、`current` 是 0.22–0.26s，两者差 ~2 个数量级。离线口径只有 1.4s vs 0.2s，缺的那 ~8s 正是宿主 `sq.searchSessions` 的失败等待（离线已被桩替换）。

### 1.4 反直觉项：all/full 比 all/l0 快

进程内 all/full 中位 **1524ms** < all/l0 **2401ms**。原因是 `full` 走的是全文扫描分支（`recall:9462` 的 `else`），**完全不构建 L0 索引语料**；而 l0 要跑 `buildL0IndexPre` + 分层归组 + 可选语义臂。⇒ 「full 更贵」在本实现里**不成立**，不要按直觉做容量假设。

### 1.5 冷/热启动

| 项 | 值 |
|---|---|
| 冷（新引擎首调 current/l0） | 201.85 ms |
| 热（同引擎第二调） | 198.54 ms |
| 冷启动额外开销 | **+3.31 ms** |

**结论**：17 处 `await import()` **不是**性能问题（Node 模块缓存生效，冷启只多 3.3ms）。这条排除了一个常见误判方向。

---

## §2 逐臂计时

### 2.1 searchHandoffCorpus（交接白板臂）

| n | min | median | max | hits |
|---:|---:|---:|---:|---:|
| 3 | 26.14 | **30.21** | 35.16 | 9 |

证据：`lib/index.js:4592` 方法体；`recall:9183`（handoff scope）与 `recall:9254`（all/current）两处调用。

### 2.2 跨工作区臂（11 个 workspace）

| n | min | median | max | workspaces | hits |
|---:|---:|---:|---:|---:|---:|
| 2 | 1203.60 | **1214.92** | 1226.25 | 11 | 9 |

该数字已**包含** `discoverWorkspaces`（见 2.3），因为复刻的是 `recall:9482-9497` 的真实调用序列：`discoverWorkspaces()` → 逐工作区 `listDailyLogs(p2, 15)` → 逐日志 `readFile` + `recallPassagesPre` → 再扫 `MEMORY.md`。

⇒ 扣掉 2.3 的发现成本（~1.19s）后，**真正的跨区文件扫描只有几十毫秒**；这条臂 98% 的时间花在「找出有哪些工作区」上。

### 2.3 discoverWorkspaces

| n | min | median | max | 返回工作区数 |
|---:|---:|---:|---:|---:|
| 3 | 1162.50 | **1192.69** | 1421.15 | 11 |

**根因**（`lib/index.js:9758-9797`）：递归 walk `~/.dsh/sessions`（深度≤4），**对每个会话文件都 `readFirstLine()` 打开读首行**再 `JSON.parse` 取 `cwd`，然后 `stat` 取 mtime。780 个会话文件 / 1,360 MiB ⇒ 全量开文件。

**关键缺陷**：`refresh()` 在 `index.js:7373-7377` 已有 5 分钟 TTL 的 `_wsCache`，**但 `recall:9483` 绕过缓存直接调原函数** ⇒ 每次 `scope='all'` 都重扫全盘。

> 与 Lead 起点的差异：Lead 报 637ms，本次实测中位 **1192.69ms**（3 次：1162/1193/1421）。差异可能来自会话文件数增长（776→780）与页缓存状态；两次测量都远大于 0，结论（必须缓存）不变。**报告采用本次可复算值，并标注与 Lead 值的差异。**

### 2.4 external.search（外部记忆臂）

| n | min | median | max | 命中源数 |
|---:|---:|---:|---:|---:|
| 3 | 486.02 | **492.11** | 760.72 | 5 |

13 个外部源，逐源整文件读 + 逐行 `includes` 扫（`lib/index.js:14805-14860`）。**这是除 discoverWorkspaces 之外的第二大固定开销**，且完全独立于宿主好坏。

### 2.5 lexicalSessionScanFallback（插件内词法兜底）

| n | min | median | max |
|---:|---:|---:|---:|
| 3 | 343.20 | **349.82** | 352.60 |

**与 Lead 起点的差异（重要）**：Lead 报「枚举 243ms + 扫描 124ms」（≈367ms 合计），本次实测单次 **343–353ms**，二者同量级、**结论一致**（兜底本身不慢）。差别只在拆分口径，本次未拆枚举/扫描两段。

### 2.6 searchSessionHistory 三态

| 状态 | n | min | median | max |
|---|---:|---:|---:|---:|
| 能力未提供（`sq` 缺失） | 3 | 0 | **0** | 0.18 |
| 宿主抛错（**立即**抛的桩） | 3 | 345.73 | **351.72** | 354.76 |
| 宿主抛错（桩先延迟 500ms） | 1 | — | **835.89** | — |
| 宿主抛错（桩先延迟 2000ms） | 1 | — | **2370.52** | — |

**这两行延迟桩是本次审计最关键的证据之一**：
- 500ms 延迟 ⇒ 总耗时 835.89ms（≈ 500 + 336 兜底）
- 2000ms 延迟 ⇒ 总耗时 2370.52ms（≈ 2000 + 370 兜底）

⇒ **宿主等多久，recall 就等多久，原实现没有任何 deadline / 熔断 / abort 上限**。这直接解释了 prod 上「宿主 8s ⇒ recall 10–18s」的线性关系：8s 不是上限，是宿主当前的失败耗时；宿主若恶化到 30s，recall 就会是 30s。

---

## §3 失败面复现表

全部在基线 a53560e 上真跑，宿主为「立即抛 `SESSION_QUERY_PERSISTENCE_FAILED`」桩，均未抛异常（`ok=true`）。

| # | 用例 | 实测耗时 | 输出 | 症状 | 根因（file:line） | 严重度 |
|---|---|---:|---:|---|---|---|
| F1 | `expand='mem_nothex'` | 0.26 ms | 65 字符 | 明确报错「需要合法记忆 id」 | `index.js:9704` 正则守卫 | — 正常 |
| F2 | `expand='mem_'+'0'×32`（合法但不存在） | 127.80 ms | 1,412 字符 | 列「已搜索」清单后如实报未找到 | `index.js:9731` | — 正常 |
| F3 | 空 query `''` | 0.01 ms | 24 字符 | 「query 为空」 | `index.js:9157` | — 正常 |
| F4 | 纯空白 query `'   \n\t '` | 0 ms | 24 字符 | 同上（trim 生效） | `index.js:9156-9157` | — 正常 |
| F5 | 纯标点 `，。；：、` | **1819.60 ms** | 339 字符 | 分词后 terms 为空，**仍然跑完整条 all 链**，最后只回一句「查询没有可扫描的词，未扫描」 | `index.js:9161` 分词产生空数组但**无早退** | **P2** |
| F6 | 5000 字 ASCII | 2530.39 ms | 5,348 字符 | 不报错；输出把**整个 5000 字查询原文回显**在 `[记忆检索] "…"` 里 | `index.js:9695-9696` 直接拼接 `q` | **P1**（token 放大） |
| F7 | 5000 字中文 | 2529.97 ms | 5,348 字符 | 同上 | 同上 | **P1** |
| F8 | 2000 个词 | **4428.49 ms** | 19,097 字符 | 比单查询慢 1 倍；OR 语义下几乎命中一切 | `index.js:9161` terms 无上限 | **P1** |
| F9 | `'.*'`（正则元字符） | 2672.62 ms | 10,059 字符 | 无异常；按字面 `includes` 处理（**不做正则**，无 ReDoS） | `recall-passages.js:29/37` 用 `includes` 非 `RegExp` | — 正常（已排除 ReDoS 假设） |
| F10 | `limit=1000` + l0 | 2286.81 ms | 32,005 字符 | 无上限截断，按 1000 取 | `index.js:9425/9431` `Math.max(1, Number(limit))` 无上界 | **P1** |
| F11 | `limit=1000` + full | 2182.51 ms | **283,596 字符** | 单次工具返回 28 万字符 | 同上 | **P0**（见下） |
| F12 | `limit='1000'`（字符串） | 2166.74 ms | 32,005 字符 | 与数字等价（被 Number 化） | 同上 | P1 |
| F13 | `limit=0` | 2385.78 ms | 4,127 字符 | **不等于 0 条**，`Math.max(1,0)=1` | `index.js:9425` | P2 |
| F14 | `limit=-5` | 2778.33 ms | 7,020 字符 | 同理回 1 条 | `index.js:9425/9431` | P2 |
| F15 | `limit=NaN` | 2486.35 ms | 18,970 字符 | `Number(limit)||8` 回落 8 | `index.js:9425` | — 正常 |
| F16 | 中文多词（带空格） | 2013.87 ms | 14,487 字符 | 正常 OR 命中 | `index.js:9161` | — |
| F17 | `scope='bogus'` | 372.65 ms | 3,081 字符 | **静默降级成 current 语义**（无白板命中、无告警），用户以为搜了 all | `index.js:9253`（`all\|\|current` 判定后无 else 分支），工具 schema 的 enum 只在 defineTool 侧约束模型、**不校验内部调用** | **P1** |
| F18 | `scope=null` | 422.98 ms | 3,081 字符 | 同上（`scope` 缺省由调用点 `'all'` 兜底，但传 null 时落入同一分支） | 同上 | P1 |
| F19 | 连续快速 5 次 all/l0 | 6372 / 7121 / 3963 / 4673 / 6500 ms | 均为 11,807 字符 | **无并发合并、无单飞**：5 次串行叠加；后续单次调用仍 4–7s | `recall` 无 in-flight 去重（对比 `_smartRecallFlight` 仅覆盖 smartRecall） | **P1** |
| F20 | HTTP 路由 `POST /api/dsh-auto-memory/recall` 带 `format` | — | — | **请求体里的 `format` 被忽略**，路由硬编码 `{ format: 'full' }`；实测同一查询传 l0 / full 返回**同为 17,542 字符** | `lib/index.js:20454`（a53560e 基线为 `:20371`）`engine.recall(body.query, body.limit, agent, scope, { format: 'full', hits })` | **P2**（GUI 面板永远拿 full 输出） |

### 3.1 补充：纯中文多词（无空格）命中为 0

| 查询 | 耗时 | L0 命中数 |
|---|---:|---:|
| `记忆检索` | 2313 ms | **0** |
| `记忆检索插件` | 2250 ms | **0** |
| `发布踩坑` | 2104 ms | **0** |
| `白板账本机制` | 2086 ms | **0** |
| `超时` | 2008 ms | 1 |

**根因**：`index.js:9161` 只按**空白与标点**分词，中文连写整体当一个 term 做字面 `includes`。用户/模型写「记忆检索插件」时，只有原文里**连续出现这 6 个字**才命中。
**这是「有时调不起来」体感的重要来源**：不是慢，是**返回 0 条**（用户看到的下一句是「未找到相关记忆」）。

### 3.2 连续调用的输出一致性

同一查询连调 2 次，输出 **52 行逐行完全相同**（0 行差异，len 均 8332）。⇒ 本实现**确定性**，F19 的耗时抖动来自机器负载/页缓存，不是结果漂移。

### 3.3 F11 为什么列 P0

`limit=1000 + full` 实测返回 **283,596 字符**（约 71k tokens）。工具返回值直接进模型上下文，一次调用即可吃掉大半窗口；且 `full` 分支会把整条正文（含未截断段落）拼进输出（`recall-passages.js:30-31` `line: body.trim()`）。这不是「慢」，是**一次调用就能把会话打死**，与用户「调不起来」的体感同源。

---

## §4 超时面取证

### 4.1 宿主对原生 `ctx.tools.register` 工具的调用：**默认没有超时**

| 证据 | 位置 | 内容 |
|---|---|---|
| 超时策略只在**工具自己声明 `timeoutMs`** 时才生效 | `app.asar → dsh/node_modules/@deepseek-ai/dsh-tool-call-timeout-policy/lib/index.js:123-124` | `const timeoutMs = ctx.tools.get(exec.name, exec.agent)?.timeoutMs;` / `if (timeoutMs === void 0) return next();` |
| 该策略挂在 `tools/execute` 中间件 | 同文件 `:116` | `ctx.on("tools/execute", async (exec, next) => {` |
| 注册时只校验、不注入默认值 | `dsh-tools/lib/index.js:2979-2980` | `const timeoutMs = definition.timeoutMs;` / `if (timeoutMs !== undefined && …) throw` —— **未声明就保持 undefined** |
| 本插件**从未声明** `timeoutMs` | `lib/index.js:13999-14036` `defineTool()` | 函数只搬 `type/description/enum/items/required`，**产物中无 `timeoutMs` 键**（探针实测 `defineTool has timeoutMs key: false`） |
| 对照：唯一显式声明的工具是 `session_query` | `dsh-tool-session-query/lib/index.js:937/960/969` | `searchTimeoutMs … .default(DEFAULT_SEARCH_TIMEOUT_MS)`（默认 3e4 ms） |

**⇒ 结论：`memory_recall` 在宿主侧没有工具级超时。它跑多久，模型就等多久。** 这也解释了为什么用户侧表现为「超时」——那是**上层（模型/客户端）** 先放弃了，而不是宿主掐断。

### 4.2 MCP 的 60000 与本插件无关（确认 Lead 的假设成立）

| 证据 | 位置 | 内容 |
|---|---|---|
| MCP 默认值 | `dsh-mcp-client/lib/index.js:765` | `const DEFAULT_TOOL_CALL_TIMEOUT_MS = 6e4;` |
| 该值只用于 MCP 传输层 | 同文件 `:145` `timeout: opts.toolCallTimeoutMs`；`:787/796` zod schema `.default(DEFAULT_TOOL_CALL_TIMEOUT_MS)` | 作用于 MCP client 的请求超时 |

**⇒ 本插件是原生 `ctx.tools.register` 工具，不走 MCP，60s 那条路径完全不覆盖它。**

### 4.3 `exec.signal` 有没有传给 execute？有，但本插件**一次都没用**

| 事实 | 证据 |
|---|---|
| 宿主确实传 `exec.signal`（`AbortSignal`）给工具 | `dsh-tools/lib/types/index.js:785` `const signal = exec.signal;`；`:946-970` 把 wrapper/caller signal 融合后 `exec.signal = signal` 再调 body |
| 策略插件会临时替换 `exec.signal` 为带 deadline 的融合信号 | `dsh-tool-call-timeout-policy/lib/index.js:126-133` |
| **本插件全 lib 目录 `exec.signal` 出现次数 = 0** | 探针实测：`total exec.signal in lib: 0` |
| 唯一带超时的调用是插件自己写的 `withTimeout`（**不响应 abort，只是 `Promise.race`**） | `lib/index.js:13328-13337`（a53560e 基线 `:13245`）；超时后原 promise 继续跑，只是结果被丢弃 |

**⇒ 即使上层取消，recall 内部也感知不到**：`discoverWorkspaces` 会继续 walk 780 个文件、`searchSessions` 会继续等宿主、`external.search` 会继续读 13 个源，全部白跑。这是「越忙越慢」的正反馈。

### 4.4 宿主抛错的上游根因（超出插件范围）

`SESSION_QUERY_PERSISTENCE_FAILED` 由 `dsh-session-query-sqlite/lib/index.js` 抛出，共两处：

- `:739` —— `_observeStable()` 内 `persistence.list()` / `readColdSessionLog()` 抛错被包装
- `:755` —— `persistence observation did not stabilize after one retry`（**两轮观察快照不一致**）

`_observeStable` 的实现（`:707-756`）会：① `persistence.list()` 全量列会话；② 对每个 revision 变化的会话 `readColdSessionLog()` 读冷日志；③ **再列一次**比对前后快照；④ 不一致就重试一轮。在 780 文件 / 1.36GB 的规模上，这套「读两遍再比对」的固定成本就是那 ~8s。

⇒ **这是宿主 bug（或至少是宿主侧的规模不适配），插件无法修**；插件能做的是**不等它**（R0 的做法）。

---

## §5 静默降级清单

> 判据：**失败既不抛给模型、也不写进返回文本、也不进 degrade 台账**，只写 diag（滚动日志）→ 归为「静默」。
> 本机 `C:\Users\JH Z\.dsh\memory\degrade\latest.json` 现状（实测）：`counts={"session-search":1}`，`updatedAt=2026-10-03T15:10:53Z`，**仅 1 条**。

| # | 位置 | 失败内容 | 只写 diag？ | 进 degradeSink？ | 返回文本可见？ | 判定 |
|---|---|---|---|---|---|---|
| S1 | `index.js:9497` | 跨工作区臂整体异常 | 否（**连 diag 都没有**，纯 `catch (e) {}`） | 否 | 否 | **完全静默** |
| S2 | `index.js:9512` | `external.search` 抛错 | 否（`catch (e) {}`） | 否 | 否 | **完全静默** |
| S3 | `index.js:9522` | `searchSessionHistory` 在 `scope==='all'` 分支里抛错 | 否（`catch (e) {}`） | 否（内层已自行记录，但外层吞掉不补） | 否 | **完全静默** |
| S4 | `index.js:9426` | RRF 融合失败 → 回落旧排序 | 否 | 否 | 否 | **完全静默**（排序质量变化无人知） |
| S5 | `index.js:9442` | recall 统计埋点失败 | 否 | 否 | 否 | **静默（可接受）**：观测失败不应扰主流程 |
| S6 | `index.js:9608` | 语义臂整体异常 | 否 | 否（外层无 record） | 否 | **静默**：语义臂失效，用户只感到「搜不准」 |
| S7 | `index.js:9591` | 白板语义来源取不到 | 否 | 否 | 否 | 静默（设计如此：fail-soft） |
| S8 | `index.js:9319` | 白板 L0 来源取不到 | 否 | 否 | 否 | 静默（设计如此） |
| S9 | `index.js:9720/9723` | `expand` 逐源读文件/解析锚点失败 | 否 | 否 | **部分**：只在末尾「已搜索」列出源名，不说失败原因 | **半静默** |
| S10 | `index.js:9731` | `expand` 找不到 id | 否 | 否 | 是（明确告知） | 正常 |

**另外两处「有留痕但用户看不见」**：

| # | 位置 | 内容 |
|---|---|---|
| S11 | `index.js:9345-9346` | 语义臂择优失败：`diagThrottled('recall-best')` + `degradeSink.record('semantic-arm')`。**台账有、返回文本无** ⇒ 模型无从知道本轮是纯词法结果 |
| S12 | `index.js:9384-9385` | evidence 聚合失败：同上（`degrade-arm`）。importance 加权静默失效 |

**S13（结构性）**：`degrade` 台账是**读驱动写**——只有 `debugInfo()`（诊断端点）被调用时才落盘（`index.js:10463-10487`，注释自述「不引入定时器、不产生空闲期 IO」）。本机文件停在 **2026-10-03**，而 prod 每天都在抛 `SESSION_QUERY_PERSISTENCE_FAILED`。⇒ **「台账里有记录」这件事本身不可靠**：没人打开诊断页，就不落盘。

**S14（告警面）**：`recall:9229-9231` 在 `scope='sessions'` 时**会**把异常文本回给模型（「会话检索失败(…)」），但同一失败在 `scope='all'` 里被 §S3 吞掉，**只字不提**。同一次失败、两种 scope、两种可见性 ⇒ 模型无法建立稳定预期。

---

## §6 修复建议

### P0（必须先做，否则「修好」不成立）

**P0-1 · 宿主会话检索加 deadline + 熔断，不再线性等待**
- **症状**：`scope=all` 10–18s（prod）/ 1.4s（离线），`scope=sessions` 8.35s；且宿主拖多久就等多久（§2.6 延迟桩 835ms/2370ms 线性跟随）。
- **根因**：`searchSessionHistory`（`index.js:4663-4694`）直接 `await sq.searchSessions(...)`，无 timeout、无熔断、无 abort（§4.3）。
- **最小修法**：① 调用前判 `this._sessionQueryFailAt`，未过期直接走 `lexicalSessionScanFallback`；② 用 `withTimeout`（或 `AbortSignal.timeout` + 传 `{signal}`，宿主 `searchSessions(request, exec)` 已支持 `exec.signal`，见 §4.3 证据）；③ 失败置 TTL、成功清零；④ 半开重试，避免「宿主好了还封 10 分钟」。
- **验收判据**：① 宿主桩延迟 9s 时，`recall(scope='sessions')` 必须 < 8s 返回且输出含超时说明；② 连调 5 次，第 2–5 次 < 1s（熔断生效）；③ 失败 61s 后宿主恢复，下一次调用必须重新走宿主且清零标记（半开自愈）；④ `degradeSink.countOf('session-search')` 每次真失败**恰好 +1**（不得重复记）。
- **状态**：**已由 Lead 的 R0 落地**，本审计在修复树上独立复算，见表 R0-A。

**P0-2 · 工具返回值加硬上限**
- **症状**：`limit=1000 + format='full'` 单次返回 **283,596 字符**（§3 F11）。
- **根因**：`recall:9425/9431` 的 `Math.max(1, Number(limit) || 8)` 只有下界没有上界；`full` 分支把整条正文拼进 `line`（`recall-passages.js:30-31`）。
- **最小修法**：`limit` 夹到 `[1, 50]`；输出总字符超阈值（建议 60,000）时截断并追加「[输出已截断，共 N 条，可用 limit 收窄]」。
- **验收判据**：`limit=1000/full` 的返回字符数 ≤ 60,000 且**必须**含截断说明；`limit=0/-5` 返回 ≤ 1 条且带「limit 已夹到 1」提示（负路径：去掉夹取后断言必红）。

**P0-3 · `all` 复用 `refresh()` 的 `_wsCache`**
- **症状**：`discoverWorkspaces` 中位 **1192.69ms**（§2.3），每次 `scope=all` 都重扫 780 个会话文件。
- **根因**：`recall:9483` 绕过 `index.js:7373` 已有的 5 分钟缓存。
- **最小修法**：与 `refresh()` 同口径读/写 `this._wsCache`（同 TTL、同字段）。
- **验收判据**：同一进程连续两次 `scope=all`，第二次的 discover 部分 < 5ms；缓存过期后能重扫（负路径：把 TTL 改 0 应恢复 ~1.2s）。
- **状态**：**已由 R0 落地**，见表 R0-B。

### P1（显著影响可用性/可信度）

**P1-1 · 空 terms 早退**
- 症状：纯标点查询仍跑完整 all 链（1819.60ms），最后只说「没有可扫描的词」。
- 根因：`index.js:9161` 分词后不判空。
- 修法：`if (!terms.length) return 'memory_recall: 查询不含可检索词（仅空白/标点）。'`，在 `resolvePaths` 之前返回。
- 验收：`recall('，。；：、')` < 5ms 且返回明确文案；负路径：删掉早退后耗时回到 >1s。

**P1-2 · 查询长度与 terms 数上限**
- 症状：5000 字查询回显全文（5,348 字符）、2000 词查询 4428ms / 19,097 字符（§3 F6–F8）。
- 根因：`index.js:9695-9696` 原样拼 `q`；`9161` terms 无上限。
- 修法：`terms` 截到前 12 个；输出头部的 `q` 截到 120 字符并标「(查询已截断显示)」。
- 验收：5000 字查询的输出字符 < 8,000，且首行含「已截断」；terms 数 > 12 时只取前 12（可用埋点断言命中词数）。

**P1-3 · 中文无空格分词**
- 症状：`记忆检索`/`记忆检索插件`/`发布踩坑`/`白板账本机制` 全部 **0 命中**（§3.1）。
- 根因：`index.js:9161` 只按空白与标点切，中文连写整体做一个 term。
- 修法：对长度 ≥ 4 的纯 CJK term 做**字符二元组**补充（「记忆检索」→ 记忆/忆检/检索），并集召回；不改现有排序，只加候选。
- 验收：上述 4 条查询 L0 命中数 > 0；同时用 3 条「本不该命中」的对照查询确认未泛滥。
- **注**：这是**效果**问题，但用户体感上等同「调不起来」，建议与 P0 同批。

**P1-4 · `scope` 非法值显式报错**
- 症状：`scope='bogus'` 静默按 current 跑（372.65ms，无白板段、无告警），用户以为搜了 all（§3 F17/F18）。
- 根因：`index.js:9253` 只有 `all||current` 的正向分支，无 else。
- 修法：入口校验白名单，非法值直接返回「scope 非法，允许：all/current/handoff/sessions/archive」。
- 验收：`scope='bogus'` 返回 < 5ms 且含「scope 非法」；五个合法值全部照常。

**P1-5 · recall 单飞（in-flight 去重）**
- 症状：连调 5 次实测 6372/7121/3963/4673/6500ms，全部真跑（§3 F19）。
- 根因：`recall` 无 in-flight 合并（`_smartRecallFlight` 只覆盖 smartRecall，`index.js:2404`）。
- 修法：以 `(q, limit, scope, format, agentId)` 为 key 合并 1 秒内的同参调用，复用同一 promise。
- 验收：并发 5 个同参调用，宿主/磁盘只被触发 1 次（可用计数器断言），5 个返回值逐字节相同。

**P1-6 · `external.search` 加时间/规模预算**
- 症状：中位 **492.11ms**，13 个源逐文件整读（§2.4），且失败完全静默（S2）。
- 根因：`index.js:14805-14860` 无预算、无并发上限；`9512` 的 catch 全吞。
- 修法：整臂加 ~300ms 预算（超预算返回已得部分并标注「外部记忆未跑完」）；失败时至少写 degradeSink。
- 验收：注入 13 个慢源时 recall 总时长增量 < 350ms；失败时 `degradeSink.countOf('external-arm') === 1`。

### P2（结构性/可观测性）

**P2-1 · 把 6 处空 catch 至少接到 degradeSink**
- 位置：S1 `9497` / S2 `9512` / S3 `9522` / S4 `9426` / S6 `9608` / S7 `9591`。
- 修法：统一 `catch (e) { recordDiagnosticErrorPre(this._degradeSink, '<arm>', e) }`，**不改变返回文本**（避免噪声）。
- 验收：逐臂注入错误，`degradeSink.countOf('<arm>')` 各自 +1；正常路径计数为 0。

**P2-2 · degrade 台账改为「有变化即落盘 + 节流」**
- 现状：读驱动写，本机停在 2026-10-03（§5 S13）。
- 修法：`record()` 后置 dirty 标记，由既有 15s 心跳（`index.js:21264`）择机 flush，5 分钟最多一次。
- 验收：制造一次 `session-search` 失败后 ≤ 20s，`latest.json.updatedAt` 必须前进；无失败时文件 mtime 不变（负路径）。

**P2-3 · 语义臂失效要「说出来」**
- 现状：S11/S12 只进台账，模型看到的是纯词法结果却无从分辨。
- 修法：在返回尾部追加一行 `[能力状态] 语义臂本轮不可用，以下为纯词法结果`（仅当 `semScores` 为空且有失败记录时）。
- 验收：注入语义臂异常，输出必须含该行；语义臂正常时不得出现。

**P2-4 · `withTimeout` 改为真取消**
- 现状：`index.js:13328-13337`（基线 `:13245`）是 `Promise.race`，超时后原任务继续跑。
- 修法：改为 `AbortController` + 把 signal 传进被包函数（至少覆盖 `searchSessions`、`discoverWorkspaces` 的 walk）。
- 验收：超时后 100ms 内，被包的假任务应观测到 `signal.aborted === true`（负路径：不传 signal 时该断言必红）。

**P2-5 · HTTP recall 路由不要硬编码 `format: 'full'`**
- 症状：`POST /api/dsh-auto-memory/recall` 传 `format:'l0'` 与 `format:'full'` 返回**同样 17,542 字符**（实测），GUI 面板因此永远拿全文。
- 根因：`lib/index.js:20454`（a53560e 基线 `:20371`）写死 `{ format: 'full', hits }`，未读 `body.format`。
- 修法：`format: body.format === 'l0' ? 'l0' : 'full'`（保持旧默认 full 不变，向后兼容）。
- 验收：同一查询传 l0 与 full，返回字符数必须不同；不传时行为与今天逐字节一致。

### 6.1 已落地修复的独立验证（R0，工作树未提交）

> Lead 的 R0 已改 `lib/index.js`（+88/−5）。本审计**独立复算**了四组行为，均通过：

| 编号 | 断言 | 实测 |
|---|---|---|
| R0-A | 宿主延迟 9s 时，`recall(sessions)` 必须被 6s 护栏截断 | **6348ms** 返回（< 8s 判据）✅ |
| R0-B | 首次失败后，第二次调用走熔断、不再等宿主 | 首次 351ms / 第二次 **346ms**，输出含「直接使用插件内词法扫描」✅ |
| R0-C | 成功一次即自愈（半开） | 回拨 `failAt` 61s 后调用：**4ms**、`failAt` 归 0 ✅ |
| R0-D | `scope=all` 第二次复用 `_wsCache` | 首次 1802ms / 第二次 **583ms**，`_wsCache.list.length = 11` ✅ |
| R0-E | 熔断窗口内输出必须告知模型通道不可用 | 输出含 `[通道状态]` ✅ |

**但请 Lead 注意一处未覆盖**（本审计发现，不在 R0 范围内）：
- R0 的 6s 护栏**只加在 `searchSessionHistory` 的宿主调用上**；`discoverWorkspaces`（~1.2s）与 `external.search`（~0.5s）仍无预算。R0 后 `all/l0` 的剩余固定成本 = 1.2 + 0.5 + 词法扫描 ≈ **2.0s**（实测修复树 all 首调 1802ms、次调 583ms），已可接受，但**仍是 `current`（~200ms）的 3–9 倍**。
- P0-3 已做（复用缓存），P1-6（external 预算）**未做**。

---

## §7 未验证项

| # | 项 | 原因 | 建议 |
|---|---|---|---|
| U1 | 真机端到端计时（修复后） | 运行中的宿主仍是**修复前**代码（本次实测 `all/l0` 18565/14118/10835ms、无 `[通道状态]` 段即可判定），需刷新插件并重启宿主才能测修复后 | 刷新后按 §1.3 的同一 5 次口径复测 |
| U2 | 宿主 `SESSION_QUERY_PERSISTENCE_FAILED` 的**根因修复** | 属宿主 `dsh-session-query-sqlite` 内部（`:739/:755`），插件侧无法改 | 提 issue；插件侧只做「不等它」 |
| U3 | `discoverWorkspaces` 637ms（Lead）vs 1192.69ms（本次）的差异归因 | 中间隔着一次会话文件增长（776→780）与页缓存状态，未隔离变量 | 清页缓存后对照重测；或按文件数归一 |
| U4 | 6s 超时阈值是否最优 | 本机宿主失败耗时 ~8s，6s 能截住；若宿主正常时单次耗时也接近 6s，会误伤 | 修复宿主后测正常路径 P99，再定阈值 |
| U5 | 语义臂（python/js）的耗时与失败率 | 离线引擎未挂 `_semanticRankBest`；prod 有语义臂，离线数字不含它 | 在 prod 用 `degradeSink.countOf('semantic-arm')` 侧写 |
| U6 | `limit=1000/full` 是否已在真实宿主触发过上下文超限 | 只在离线复现 283,596 字符，未在 prod 观察事故 | 查会话日志中的 tool result 长度分布 |
| U7 | 熔断 TTL 10 分钟对「连续多轮对话」是否够 | 需真实用户会话观察 | 上线后统计 `[通道状态]` 出现率 |

---

## 附：本次审计的方法学事故（如实记录）

1. **首版探针计时全 0**：写成了 `{ ms: ms(t), value: await fn() }`，`ms(t)` 在 `await` 之前求值 ⇒ 全部 0.0x。已修正为 `const value = await fn(); return { ms: ms(t), value }`。**该修正后重跑全部数字**，报告中的值均来自修正后的运行。
2. **审计中途工作树被改**：执行到一半 `git status` 出现 `M lib/index.js`（Lead 的 R0 落地）。此后全部基线测量改用仓外纯净副本 `D:\_recall_audit\base`（index.js sha256 `a5732653…`），修复树单独验证。**两者不混用。**
3. **未修改任何受保护文件**：`lib/`、`tests/`、`python/`、`docs/`、`tools/` 零改动（Lead 的 R0 改动由 Lead 自己产生，非本审计所为）。本审计只新增 `artifacts/probe-recall-avail.mjs` 与本报告，未删除任何文件。