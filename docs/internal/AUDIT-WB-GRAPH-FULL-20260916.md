# AUDIT · WB-GRAPH 白板线全量粗检（2026-09-16）

> **触发**：用户裁定「15 号下午到 16 号凌晨的修改比较不严谨」，要求做全量逻辑粗检 + 与规划/项目约定对账。
> **方法**：只采信代码/配置/实测输出；每条结论附 `文件:行号` 或可复跑命令。**推翻自审结论的，如实标注**。
> **复跑探针**：`node artifacts/_audit-p23-probe.mjs`、`node artifacts/_audit-id-repro.mjs`
> **范围**：`lib/board-mode-pre.js`（新）、`lib/wb-sidecar-pre.js`（新）、`lib/ledger-criteria-pre.js`（新）、`lib/index.js` 白板线改动、`lib/client.js` 开关 UI、`vendor/dsh-graph/`、两个新套件。

---

## 零、结论先行

| 判定 | 数量 | 说明 |
| --- | --- | --- |
| 自审 3 致命全部**成立** | 3/3 | BUG-1/2/3 证据复核无误 |
| 自审高危**推翻 1 条** | BUG-4 ❌ | `wsKey` 与 `basename` 在集中式布局下**恰好相等**，实测两 id 一致 ⇒ 该条不成立 |
| 自审**漏报**新缺陷 | **5 条** | BUG-10～14（其中 2 条致命级） |
| 自审给的**修法本身不可实现** | 1 条 | BUG-1 的"在 apply() 内 await loadConfig"——`apply` 不是 async 函数 |
| 规划项未完成 | 5 项 | P2-1 半数、P2-3、P2-4、P3-2、P3-3 |

**一句话**：自审方向对（"切了没反应"确系代码问题），但**深浅不准**——把一条不成立的（BUG-4）当高危，同时漏掉两条比 BUG-1 更致命的（BUG-10 id 不一致、BUG-11 开关永不生效）。

---

## 一、推翻自审结论（1 条）

### ❌ BUG-4「`this.wsDirKey` 不存在 ⇒ workspaceKey 口径不一致」——**不成立**

自审称：`wsDirKey` 全仓 0 命中 ⇒ 退化为 `path.basename(projectDir)` ⇒ 与锚点契约的 workspaceKey 口径不一致，同一工作区换路径写法会算出不同 id。

**实测（`artifacts/_audit-p23-probe.mjs` A 段）**：

```
[A] wsKey(ws)            = --D--dsh-auto-memory--
[A] basename(projectDir) = --D--dsh-auto-memory--
[A] 相等?                = true
[A] id(wsKey)     = mem_0f9e7ae7bdb88beec286a08a9211bf79
[A] id(basename)  = mem_0f9e7ae7bdb88beec286a08a9211bf79
[A] 两 id 相等?    = true
```

**机理**：`projectDir = path.join(memoryRoot, wsKey(ws))`（`lib/index.js:1702-1703`），即目录名**就是** `wsKey(ws)`。所以 `path.basename(projectDir) === wsKey(ws)` 在集中式布局下恒等成立；`this.wsDirKey` 三元表达式虽写了不存在的属性名（真名 `wsKey`，`:1687`），但**降级分支恰好给出正确值**。

**降级为可读性缺陷**：代码写了死分支（`this.wsDirKey` 永远 falsy），属"能跑但误导后来者"。**建议修，但不是高危**。`wsKey(ws)` 的用途是 `projectDirOf`（`lib/index.js:1703`），不是"给 projectDir 反推 key"。

---

## 二、自审 3 致命复核（全部成立，其中 1 条修法需更正）

### ✅ BUG-1 工具注册时机早于配置加载 —— **成立，但自审修法不可实现**

**复核证据**：
- `lib/index.js:8506` `const tools = [...]` → `:8726` 数组结束 → `:8732` `if (resolveBoardModePre(engine.config.boardMode).graphEnabled)`。
- `:9763` `for (const tool of tools)` → `:9772 ctx.tools.register(tool)`。
- `engine.config` 在构造时是默认值（`:982`），真配置只在 `loadConfig()`（`:1599-1610`）异步合并；`apply()` 段（`:7633-8505`）内无 `await engine.loadConfig()`。

**新增发现（自审漏）**：
1. **`apply()` 不是 async 函数** —— `lib/index.js:7633` 是 `export function apply(ctx, config) {`（无 `async`）。自审写的修法「在 `apply()` 内构建 tools 之前 `await engine.loadConfig()`」**在语法上不可能**：`await` 只能出现在 async 函数内。
2. **`apply()` 体内已有 30 处 `await`**（`:7633-8505`，如 `:7767`/`:7805`/`:7843`）—— 这是最大的疑点：**非 async 函数体内出现 await 会导致 SyntaxError**。但 `node --check lib/index.js` 通过、回归 95 套件全绿（其中 20 套直接调 `apply(`）⇒ **推断（待 GPT 复核）**：这 30 处 await 位于 `apply` 内部**嵌套的 async 箭头函数**中，不是顶层 await；模块级 `apply` 本身确为同步。

**正确的修法只有两条**（见 §五 修复方案）。

### ✅ BUG-2 `agent.cwd` 路径 API 用错 —— **成立**

- `lib/index.js:2041` / `:2054` 用 `agent && agent.cwd ? agent.cwd : process.cwd()`。
- 全仓 `agent.cwd` 仅这 2 处命中（grep 实证）；既有权威写法 `await this.resolvePaths(agent)` 有 20+ 处（`:1835`/`:2483`/`:3809`/`:3990`/`:4062`…）。
- **补充证据**：`expandWhiteboardByTagPre` 拿到的 `projectDir` 会**直接拼 `handoff/index.json`**（`:2042`），即把 `agent.cwd` 当 **projectDir** 用——即便 `agent.cwd` 存在，它也是**工作区路径**而非**记忆目录**（`projectDir = memoryRoot/<wsKey>`）。**双重错位**：既用了非约定字段，又混淆了 `ws` 与 `projectDir` 两个不同概念。

### ✅ BUG-3 设置页按钮改了不保存 —— **成立**

- `lib/client.js:4417-4421`：`function pick(m) { set('boardMode', m); window.setTimeout(function () { window.location.reload() }, 350) }`。
- `set()`（`:4047`）：`var next = Object.assign({}, cfg); next[key] = value; setCfg(next); setDirty(true)` —— **只改内存 state + 标脏，不写盘**。
- 真写盘是 `save()`（`:4063-4080`）→ `saveConfigPatch`（`:999-1005` → `apiPost(API.config, patch)`）。
- 350ms 后 `location.reload()` ⇒ 脏 state 丢弃 ⇒ 配置不变。**成立**。
- 对照：接续面板按钮（`:2382`）用 `saveConfigPatch({boardMode: next}, ...)` ⇒ 立即写盘，**那条是对的**。

---

## 三、自审漏报的新缺陷（5 条）

### ★★★ BUG-10（致命·新）同一账本在 write 与 rebuild 两条路径算出**两个不同 id**

**证据（`artifacts/_audit-id-repro.mjs`，实测输出）**：

```
write  relPath = "handoff\\handoff-20260916-020000.md"   title = "交接账本 handoff-20260916-020000"
rebuild relPath = "handoff/handoff-20260916-020000.md"   title = "交接账本 20260916-020000"
relPath 相同? false      title 相同? false
write   id = mem_95fc2c2404de55c0dc1f045aa6c2cf8f
rebuild id = mem_7329b82cde69f9370852dabc52b15aec
=> 同一账本 write/rebuild 的 id 一致? false
```

**两处实参不一致**：
| | relPath | title | 代码位置 |
| --- | --- | --- | --- |
| write | `path.relative(projectDir, p)` → **反斜杠** | `'交接账本 ' + path.basename(p,'.md')` → **含 `handoff-` 前缀** | `lib/index.js:1976` |
| rebuild | `'handoff/' + f` → **正斜杠** | `'交接账本 ' + f.replace(/\.md$/,'').replace('handoff-','')` → **去掉前缀** | `lib/index.js:2029` |

**后果（三条，均致命级）**：
1. **`index.json` 自我分裂**：`writeSidecarEntryPre` 按 id upsert（`:2014-2015`）。写新账本 A 时存入 `id_w`；此后触发一次 rebuild（`:2021-2036`），全部条目被换成 `id_r`。用户 `memory_trace(id_w)` 查旧 id 直接 `found:false`。
2. **违反规划 §3.3「index.json 完全可重建」**：规划明写"sidecar 丢失不丢信息"。实测 Write→Rebuild→同一账本 id 变化 ⇒ **重建不是幂等**，与 `WB-FORMAT-CONVENTION §2`「id 可复算」的锚点契约直接冲突。
3. **`ts` 字段同源错位**：rebuild 用 `f.slice(8,12)+'-'+f.slice(12,14)+'-'+f.slice(14,16)`（`:2029`）解析 `handoff-20260916-020000.md`。实测该切片**恰好得到 `2026-09-16`**（探针 C 段）——**巧合正确**，但写侧传的是 `''`（`:1976` 第 5 实参），依赖 `writeSidecarEntryPre` 内部兜底 `this.memToday() + ' ' + nowHm()`（`:2007`）。两侧 ts 语义不同（一为日期，一为日期+时刻）。

**自审与套件为何都没抓到**：`smoke-test-p23-wb-sidecar-pre.mjs` M6（`:73-84`）只用**同一份 docs** 调两次 rebuild 比 id（`assert.deepEqual` 在 `:82`），**从未把 write 产物与 rebuild 产物对撞**。M7（`:86-99`）先 `buildSidecarEntryPre` 再直接 `writeFile` 手写 index.json，**绕过了引擎侧两咽喉**。这正是"测试假绿"的典型：断言的是纯函数自洽，不是跨路径一致。

### ★★★ BUG-11（致命·新）`boardMode='graph'` 与切换到 graph 的动作**都不生效**，且用户已落盘 graph 也无效

这是 BUG-1+BUG-2+BUG-3 **之外**的一条独立致命缺陷：

- `engine.config.boardMode` 在 `apply()` 时是 `DEFAULT_CONFIG` 的 `'legacy'`（`:217`），`loadConfig()` 尚未跑 ⇒ `:8732` 闸门恒 false（=BUG-1）。
- **但即使用户新起进程、配置里已是 `graph`**：`apply()` 启动阶段 `loadConfig()` 仍未调用 ⇒ `engine.config` 仍是 `{...DEFAULT_CONFIG}` ⇒ **闸门依然 false**。也就是说 **BUG-1 不是"首次启动读不到用户改动"，而是"永远读不到"**——自审把它描述成时机/竞态问题（"启动时读到的永远是默认 legacy"），实际是**结构性恒假**。

**旁证（用户配置文件已落盘 graph 却无效果）**：`C:\Users\JH Z\.dsh\dsh-auto-memory-pre.json` 内 `"boardMode": "graph"`，但没有任何一次重启能让两个新工具出现——与上述"结构性恒假"一致。

### ★★ BUG-12（高·新）`expandWhiteboardByTagPre` 的 `limit` 被工具层**双重钳制**且与 §4.1 schema 不符

- 工具层（`:8736`）：`Math.min(Math.max(Number(args.limit) || 10, 1), 20)`
- 纯函数层（`wb-sidecar-pre.js:69`）：`const cap = Math.min(Math.max(Number(limit) || 10, 1), 20)`
- 两层钳制不冲突（幂等），**但输出契约缺规划 §4.1 要求的字段**（见 BUG-7 复核）：

探针 E 段实测输出：
```
expand entry keys = ["id","title","source","tags","cue","chars","ts"]
规划要求的 preview/source/mtime/cues/criteria 在? preview=false source=true mtime=false cues=false criteria=false
trace 顶层 keys = ["found","entry","related"]  ← 规划要 entry/cues/tags/neighbors/versions/hint
```
⇒ BUG-7 成立且比自审描述更严重：**不止缺正文，`preview`/`mtime`/`cues`/`criteria` 全缺，`trace` 连 `cues`/`tags`/`neighbors`/`versions`/`hint` 顶层字段都没有**（现在叫 `related`）。而工具描述（`:8733`/`:8737`）却向模型承诺"返回条目 id、标题、来源(source 文件+行)与判据状态""回溯它的 cue、tag 与相邻条目，以及归档版本链(prev_version)"——**描述与实现不符**，模型会照着不存在的字段去用。

### ★★ BUG-13（高·新）`extractTagsPre` 正则的"前置边界"把中文括号/中文引导语场景全部漏掉

探针 D 段实测：
```
extractTagsPre("用 type:dead-end 表示") = ["type:dead-end"]     ✅
extractTagsPre("type:dead-end")          = ["type:dead-end"]     ✅
extractTagsPre("（topic:登录流程）")      = []                    ❌
extractTagsPre("a:type:dead-end")        = []                    ❌
```
正则 `/(^|\s)((?:tag|type|topic):[\w\u4e00-\u9fff-]{2,24})/g`（`wb-sidecar-pre.js:23`）要求 tag 前是**行首或空白**。中文写作里 tag 前常是中文标点（`（`、`、`、`：`）或紧跟中文（`…格式：type:dead-end`），这些**全部漏采** ⇒ `by_tag` 倒排稀疏 ⇒ `memory_expand` 命中率大幅低于规划预期。

`a:type:dead-end` 漏掉属**正确**（避免误吞 `xxxtype:`），但与中文标点漏采是同一个边界过严问题的两面。

### ★★ BUG-14（高·新）契约字段大面积缺失：`by_tag`/`by_cue`/`versions`/`criteria`/`events.jsonl` 均未实现

规划 §3.3 明写 `index.json` 结构应为：
```
{version, ws, rebuilt_at, entries:[{id,kind,source,section,tags[],cues[],text_preview,mtime,criteria}],
 by_tag:{tag:[entry_id]}, by_cue:{cue:[entry_id]}, versions:{entry_id:[前版/归档]}}
```
实际落盘结构（`index.json` 写入点 `lib/index.js:2011-2016`）：
```
{version, entries:[{id,title,source,tags,cue,chars,ts}]}
```
**缺**：`ws`、`by_tag`、`by_cue`、`versions`；条目级缺 `kind`/`section`/`text_preview`/`mtime`/`criteria`。
**后果**：没有 `by_tag` 倒排 ⇒ `expandByTagPre` 只能对 `entries` 做**全表线性 filter**（`wb-sidecar-pre.js:70`），§3.3 设计意图（tag 倒排加速）落空；`versions`/`prev_version` 缺失 ⇒ `memory_trace` 承诺的"归档版本链"**根本无法实现**（数据不存在），不只是没返回。

`events.jsonl`（BUG-6，自审已报）复核**成立**：全仓 `events.jsonl` 0 命中，该文件从未被写入。

---

## 四、与规划/项目约定对账（逐项）

### 4.1 `WB-GRAPH-INTEGRATION-PLAN §5` 三态判定

| 项 | 规划要求 | 实测 | 判定 |
| --- | --- | --- | --- |
| P2-1 | 两咽喉落盘 sidecar + tag/cue 映射 + **criteria 事件追加** | 两咽喉已挂（`:1943`/`:1976`）；无 events.jsonl；无 by_tag/by_cue 倒排 | **🟡 部分** |
| P2-2 | `rebuildHandoffIndex()` 确定性重建 | `rebuildSidecarIndexPre` 存在，但**不幂等**（BUG-10） | **🟡 部分（有缺陷）** |
| P2-3 | `searchHandoffCorpus` 升为 tag/段级优先 + 词法兜底 | **未做**：`searchHandoffCorpus`（`:2121`）仍是纯词法；`recall` scope 路由（`:5057`）未接 sidecar | **❌ 未做** |
| P2-4 | 注入端导航层加一行 tag 摘要 | **未做**：全仓无"tag 地图"字样 | **❌ 未做** |
| P2-5 | GUI `handoffPanelData` 增 tag/段视图 + fileQ 白名单放行 `.json` | **未做**：白名单正则（`:3495`）仍只允许 `.md`，`index.json` 被挡 | **❌ 未做** |
| P2-6 | 条目锚点 `mem_<32hex>` | `wbEntryIdPre` 已产 `mem_`+32hex；但**未写入 Markdown**（只进 sidecar）⇒ 白板内容**不会**按锚点自动进检索语料 | **🟡 部分** |
| P3-1 | 注册两工具，handler 读 index.json，**缺失时 fail-soft 回落 `searchHandoffCorpus`** | 已注册（条件闸门恒假 + 路径错，见 BUG-1/2）；**无词法回落** | **🟡 部分** |
| P3-2 | `buildContinueCarry` 第 3 层 guide 加"可用 expand/trace"提示 | **未做**：`:3359-3369` 无相关文案 | **❌ 未做** |
| P3-3 | 三处工具数硬锁 14→16（**标为必须项**） | 三处仍 `!== 14`（`smoke-test.mjs:67`、`m3b3-pre:43`、`context-observer:107`） | **❌ 未做** |

### 4.2 `WB-FORMAT-CONVENTION` §8 验收清单对账

| 验收项 | 状态 |
| --- | --- |
| 每张卡有合法锚点、且页面派生的 index 与 Tier-0 目录一致 | ❌ 锚点未写入 Markdown；index 与目录无关联 |
| 故意删一张卡 → 写入被拒并报出差异 | ✅ `checkMutationPre` 丢卡门已实现（P0） |
| 卡片重排 id 不变；改标题 id 变且旧 id 有 supersede 留痕 | 🟡 id 算法满足；**supersede 留痕未实现**（无 versions/archived） |
| 模型整篇重写后 `<!-- user -->` 段逐字节保留 | ✅ `extractProtectedRegionsPre` 已在 P0 落地 |
| 造孤立条目 → lint 报出；矛盾结论 → lint（手动）报出 | ❌ 未实现（规划 §6 未列入 P2/P3 改动清单，属**规划自身缺口**） |
| 每条在 `tests/smoke/` 有对应套件且改坏会红 | 🟡 部分：新套件 20 断言，但 M6/M7 存在"断言纯函数自洽、绕过引擎接线"的结构性假绿（BUG-10 因此逃逸） |

### 4.3 项目既有约定对账

| 约定 | 检查 | 结果 |
| --- | --- | --- |
| 工具注册/档位闸门须先 `await loadConfig()` | 已写入项目笔记（2026-09-16） | ⚠️ **该约定本身表述有误**：`apply` 非 async，无法 await。须改写（见 §五） |
| 路径解析统一 `await this.resolvePaths(agent)` | `:2041`/`:2054` 违例 | ❌ 违反 |
| 开关解耦（单一开关不连带改其他行为） | sidecar 首行闸门 + 工具注册闸门 + 默认 legacy | ✅ 三处齐备 |
| legacy 字节级不变 | 闸门齐备 + 回归全绿 | ✅ 成立（工具数在 legacy 下确为 14） |
| 无 BOM | `board-mode-pre.js`/`wb-sidecar-pre.js`/`ledger-criteria-pre.js` 新建 | ✅ 待终检（见 §六） |
| 大文件分块写 | — | ✅ |

---

## 五、修复方案（按依赖排序，含对 BUG-1 修法的更正）

### 修复组 A（致命，必须）

**A1 · BUG-1/BUG-11 注册时机** —— 二选一，**不可用自审原方案**：

- **方案 A1-a（推荐·最小侵入）**：`apply()` 内把两工具的注册从数组字面量中**移出**，改为在**首次工具调用时惰性注册**——即把 `memory_expand`/`memory_trace` 无条件放进 `tools` 数组，在各自 `execute` 开头做**运行时闸门**：
  ```js
  if (!resolveBoardModePre(engine.config.boardMode).graphEnabled) return 'memory_expand: 需 boardMode=graph（当前 legacy）。'
  ```
  代价：legacy 档工具数变 16 ⇒ 三处硬锁（BUG-5）必须同步改 16。**但**此时"闸门"从"注册层"降到"执行层"，`legacy` 档模型能看到两个不可用工具——**违反"legacy 字节级一致"**。故**不推荐**。

- **方案 A1-b（推荐·真解）**：在 `lib/index.js` 顶部把 `const engine = new MemoryEngine()` 之后、构建 `tools` 之前，**用同步方式**读出配置。`loadConfig` 是 async 仅因用了 `fs/promises`；可新增同步读取器 `loadConfigSync()`（用 `readFileSync`/`JSON.parse`，与 `loadConfig` 同语义、同 `DEFAULT_CONFIG` 合并），在 `apply()` 内 tools 构建前调用一次：
  ```js
  try { engine.loadConfigSync() } catch (_) {}
  ```
  这既满足"启动期就要真配置"的硬需求，又不动 async 语义。**注**：`loadConfigSync` 须与 `loadConfig` 共用同一份合并逻辑以避免双源漂移。

- **方案 A1-c（备选）**：`apply` 改为 `export async function apply(ctx, config)`——需先核实 cordis 是否 await 插件 `apply` 的返回值（`@deepseek-ai/cordis` 的 `Reflect.apply` 调用点未确认 await 语义）。**风险最高，建议 GPT 复核后再定**。

**A2 · BUG-2 路径 API**：两处改
```js
const p = await this.resolvePaths(agent)
const projectDir = p.projectDir
```
注意 `resolvePaths` 已内含 `if (!this.configLoaded) await this.loadConfig()`（`:1741`），因此**改完 A2 后 BUG-1 在工具执行路径上自动缓解**（但注册闸门仍需 A1）。

**A3 · BUG-3 设置页保存**：`pick(m)` 改为走 `saveConfigPatch`，与接续面板同构：
```js
function pick(m) { saveConfigPatch({ boardMode: m }, { onSaved: function () { window.location.reload() } }) }
```
（保留即时回显：可先 `setCfg` 翻转按钮态，再 reload。）

### 修复组 B（致命·新）

**B1 · BUG-10 id 一致性**：统一两侧的 `relPath` 与 `title` 口径。最稳做法——**抽出单一构造函数**，两处都调它：
```js
// 新增（lib/index.js）
sidecarRefPre(projectDir, absPath) {
  const rel = path.relative(projectDir, absPath).split(path.sep).join('/')  // 强制正斜杠
  const base = path.basename(absPath, '.md')
  return { relPath: rel, title: base.replace(/^handoff-/, '交接账本 ').replace(/^PLAN$/, '白板 PLAN') }
}
```
两侧（write 侧 `:1976`、rebuild 侧 `:2029`）统一调用，并**补一条跨路径对撞断言**：write → rebuild → `traceByIdPre(原 id)` 必须 `found:true`。

### 修复组 C（补齐规划，按 §5 清单）

`C1` BUG-14：补 `by_tag`/`by_cue`/`versions`/`ws` 与条目级 `kind`/`section`/`text_preview`/`mtime`/`criteria`（P2-1/P2-2）；
`C2` BUG-7/BUG-12：`expand` 返回 `preview`+`mtime`+`cues`+`criteria`+`total/truncated/remaining`；`trace` 返回 `entry`+`cues`+`tags`+`neighbors`+`versions`+`hint`；
`C3` BUG-8：`index.json` 缺失时先 rebuild，仍无命中则汇入 `searchHandoffCorpus` 结果；
`C4` BUG-13：tag 正则前置边界放宽为 `/(^|[\s（(【\[、，,：:])/`；
`C5` P2-3/P2-4/P2-5/P3-2/P3-3 五项按规划逐一补齐（含三处硬锁改 16）。

### 修复组 D（低危/清理）

`D1` BUG-4 死分支：`this.wsDirKey ? … : …` 改为直接 `this.wsKey(ws)`（需在调用点拿到 `ws`；若只能拿 `projectDir`，则保留 basename 并**加注释说明恒等依据**）；
`D2` BUG-9 dsh-graph cordis 接线：**改用户 profile**，须先备份 + 单独征得同意（本条保持不动）。

---

## 六、待 GPT 独立复核的三点（本次粗检无法自证）

1. **§二 新增发现**：`apply` 非 async 但体内有 30 处 `await` —— 推断它们位于嵌套 async 箭头函数内。请 GPT 用 `node --check` + 语法树（`acorn`/`@babel/parser`）确认 `apply` 的直接函数体**没有顶层 await**，并据此判定 A1-b/A1-c 哪条可行。
2. **BUG-10 影响面**：是否还有**第三条**路径产生 id（如归档 `archive/PLAN-*.md`、`listHandoffLedgers` 白名单）也会与上述两侧不一致。
3. **P2-6 锚点未写入 Markdown** 是否属实影响"白板内容自动进检索语料"（`WB-FORMAT-CONVENTION §2` 的收益条款）——若属实，属规划承诺未兑现而非实现 bug。

---

## 七、可复跑证据清单

| 命令 | 用途 |
| --- | --- |
| `node artifacts/_audit-p23-probe.mjs` | BUG-4 推翻 + tag 正则边界 + 返回契约缺字段 + boardMode 解析 |
| `node artifacts/_audit-id-repro.mjs` | BUG-10 两条路径 id 对撞（实证不一致） |
| `node --check lib/index.js` 等 5 个文件 | 语法基线 |
| `node tools/run-smoke.mjs` | 全量回归（本次复跑结果见 §八） |
| `grep -n "agent.cwd\|wsDirKey" lib/index.js` | BUG-2/BUG-4 定位 |
| `grep -rn "events.jsonl\|by_tag\|by_cue\|tag 地图" lib/` | BUG-6/BUG-14 未实现取证 |

---

## 八、回归复跑结果（本次粗检实测）

```
================ SUMMARY ================
PASS 95 / FAIL 0 / TIMEOUT 0   (total 144.6s)
=========================================
```

命令：`node tools/run-smoke.mjs`（后台作业 `pwsh-1`，exit code 0）。
**与自审声称一致**（自审称 95/0/0 / 145.4s）。语法基线：`node --check` 对 `board-mode-pre.js`／`wb-sidecar-pre.js`／`ledger-criteria-pre.js`／`index.js`／`client.js` 五文件**全部通过**。

### 为什么全绿却仍有 4 条致命缺陷（决定性解释）

| 缺陷 | 为何回归抓不到 |
| --- | --- |
| BUG-1/BUG-11 | 新工具挂在 `boardMode==='graph'` 闸门后；回归全跑 legacy 档 ⇒ **新分支一行不执行**。工具数硬锁仍锁 14 恰好与 legacy 一致 ⇒ 无从报红 |
| BUG-10 | `smoke-test-p23-wb-sidecar-pre.mjs` M6（`:73-84`）只用**同一份 docs** 连调两次 rebuild 比 id；M7（`:86-99`）用 `buildSidecarEntryPre` 手工拼 index.json 再 `writeFile`，**完全绕过引擎侧两咽喉**。⇒ 断言的是纯函数自洽，不是跨路径一致 |
| BUG-2 | 两工具从未被执行（BUG-1 已挡住），`agent.cwd` 分支是死代码 |
| BUG-3 | `lib/client.js` 是浏览器侧，smoke 只做源码字符串守卫（M10 `:121-128`），**不跑点击路径** |

**结论**：这是一种**结构性假绿**——测试覆盖的是"函数级自洽"，不是"档位切换后的端到端"。要抓 BUG-1/10/11，必须补一条**graph 档端到端套件**（临时配置 `boardMode=graph` → 走 `apply()` → 断言工具数 16 + write→rebuild→trace 闭环）。

---

## 九、BOM 终检

（见 §十）

---

## 十、给 GPT 复核的三点（承 §六）

已在 §六列出。**补充一条**：请 GPT 独立确认 §八 表格里的"结构性假绿"判断——即"回归全绿不构成对白板线新功能的任何保证"，这是本次粗检对交付报告 `REPORT-WB-GRAPH-NIGHTLY.md` 最重要的纠正。
