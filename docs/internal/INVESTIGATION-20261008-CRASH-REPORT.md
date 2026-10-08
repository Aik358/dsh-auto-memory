# 崩溃报告调查报告（2026-10-08）

> 调查对象：用户报告 `@a9i5k4/dsh-auto-memory` v3.2.10 导致「前端三槽位崩溃 + 后端持续高 CPU」。
> 纪律：**全程只读**（未修改任何 `lib/`、`tests/`、配置）；核查基准 = `git show v3.2.10:lib/client.js`。
> 每条结论附可复算命令与输出。验证不了的已如实标注「无法验证」。

---

## 1. 版本判定

| 项 | 值 | 取证 |
|---|---|---|
| 报告针对版本 | **v3.2.10**（npm 发布版） | `git show v3.2.10:lib/client.js` 共 **18,565** 行；L18470 = `surfaceDisposers.push(slots.inject('sidebar.footer.action', function () {`，与报告引用逐字吻合 |
| 我的核查基准 | **v3.2.10**（tag `8280500`） | 同上；开发树 HEAD 行号**不**用于本报告 |
| 版本判别力 | v3.2.9 仅 18,200 行，**无 L18470** | `git show v3.2.9:lib/client.js` → 18,200 行 |

⇒ Lead 的版本判定**复核通过**。报告所有行号均按 v3.2.10 解释。

---

## 2. 逐条裁定表

| # | 指控 | 裁定 | 关键证据 |
|---|---|---|---|
| **A** | `#130 Element type is invalid`＝组件被注入成 `undefined`；ESM/CJS 互操作导致组件 undefined | **不成立** | ① v3.2.10 全量审计 `h(X)` 首参大写标识符 **114 个，未定义 0 个**；② 五个重点组件全部有定义；③ 真执行 factory **不抛异常**（8/8 PASS）；④ 本架构**根本没有 ESM 互操作面**（顶层 `import`/`export` 各 0 处，`require()` 字面量仅 `react`/`react-dom`） |
| **B** | 报告引用的行号 | **成立（对 v3.2.10 精确）** | L2585 / L5219 / L6204 / L18470 / L18474–18482 **逐条吻合**（见 §3） |
| **C** | 同一插件在 `shell.overlay` 注入 3 次 | **成立但不构成缺陷（设计使然）** | 三处注册 id 互不相同（`auto-memory-pre` / `-dialogs` / `-autocont`），宿主 `shell.overlay` 是 **`list` 槽**：按 `id`+`priority` 去重、按 `priority`→`order` 排序；同 id 同 priority 会**显式抛错**而非静默崩。实测三注册共存、互不顶替 |
| **D** | 四处 500ms 轮询造成「无谓 re-render」 | **不成立** | 实测真 React 18.3.1：`setState(相同值)` **走 bail out**；20 次同值 setState ⇒ 渲染次数仍为 1（挂载那一次） |
| **E** | `/semantic-deep-detect` 周期性触发导致后端 70% CPU | **不成立** | 后端**无任何**定时器调用它（全仓 0 个周期性调用点）；前端 4 个调用点中 3 个是**点击处理器**、1 个是**开屏一次性 `setTimeout(…, 12000)`** |

---

## 3. A 项：详细裁定（报告核心假设）

### 3.1 机械审计：`h(X)` 首参是否都有定义

```
$ node  (脚本见 §7 证据索引 E1)
v3.2.10 lib/client.js bytes=2124874 lines=18566
=== A) h(X) uppercase first-arg ===
distinct=114 total=532
defined-uppercase-symbols=222
UNDEFINED first-arg=0
```

⇒ **114 个首参全部有定义，0 个未定义**。Lead 在开发树得到的「113 个、0 未定义」在 v3.2.10 上复现（数量 114 系版本差）。

### 3.2 五个重点组件的定义与引用点（v3.2.10）

| 组件 | 定义 | 引用点 |
|---|---|---|
| `Iter5Surface` | **2 处**：L10977、L13454（`function Iter5Surface(props)`） | 14 处（含 L28 portal 调用、L18475/18478/18481 三处 overlay） |
| `MemoryPanel` | L16000 | 3 处（含 L18475 注入） |
| `DialogHost` | L16395 | 6 处（含 L18478 注入） |
| `AutoContinueHost` | L17026 | 4 处（含 L18481 注入） |
| `SidebarButton` | L6183 | 2 处（含 L18471 注入） |

⇒ 五个组件**均在 `slots.register` 调用之前于同一模块作用域内定义**（函数声明提升 + 同一 factory 闭包），不存在「注入时尚未定义」的时序。

### 3.3 真执行 factory（本报告最硬的一条证据）

用 `vm` 沙箱把 **v3.2.10 的 `client.js` 原样编译并执行**，再**真调用一次 `entry.factory(require)`**：

```
=== v3.2.10 REAL factory execution ===
  PASS top-level executes without throw
  PASS __ModuleLoader__.load called (entry captured)
  PASS entry id                              (@a9i5k4/dsh-auto-memory)
  PASS factory() real call did NOT throw
  PASS exports.inject is array               ["slots","sessions","remote","remote.session"]
  PASS exports.apply is function
  PASS inject contains slots
   console.error count=0

=== negative path: same predicate must catch ReferenceError ===
  PASS injected undefined identifier -> ReferenceError
[P280-inv] PASS 8 / FAIL 0
```

**负路径**同样成立：同一判据对「引用未定义标识符」的注入体**确实捕获到 `ReferenceError`** ⇒ 本判据**不是恒真守卫**，它有能力失败。

### 3.4 架构前提：ESM/CJS 互操作面在本架构下是否存在

```
top-level import statements: 0
top-level export statements: 0
__ModuleLoader__ occurrences: 3
require( occurrences: 2
distinct require() specifiers (string literals): ["react","react-dom"]
```

⇒ `client.js` **没有任何顶层 `import`/`export`**，是纯 `__ModuleLoader__.load({ id, factory })` 形态；`require()` 只出现 2 次且**全部是 `react` / `react-dom` 字面量**（由宿主注入）。
⇒ **本架构不存在「ESM/CJS 互操作导致组件 undefined」这条路径**：文件里没有 ESM 模块边界可发生互操作，也就没有互操作失败可言。报告的这条因果链在架构层面不成立。

### 3.5 A 项结论

**报告的核心假设错误。** 具体错在三处：
1. **错把注释当代码**：报告引用的 L5219 / L6204 在本仓是 `//` 注释（`grep` 命中 `error #300` / `白屏` 的正是这些**历史修复说明**），它们是「曾修过 issue #145」的记录，**不是**当前存在的缺陷点。
2. **错把 `#130` 当成实际错误码**：全仓（v3.2.10）检索 `Element type is invalid` / `type is invalid` / `#130`，**命中 0 次**；反而 `#145` 与 `error #300` 真实存在——那正是**已经修好**的那条。
3. **错在架构判断**：把「ESM/CJS 互操作」当作本插件加载模型，而本插件是手写 `__ModuleLoader__` bundle，无 ESM 边界。

⇒ **无法给出「确切的 undefined 组件」，因为不存在这样的组件**（114/114 有定义，真执行 factory 不抛错）。

---

## 4. B 项：行号可信度

在 **v3.2.10** 上逐条核对报告引用：

| 报告引用 | v3.2.10 实际内容 | 裁定 |
|---|---|---|
| L2585 | `'★ 修复:启动时 shell.overlay 槽位条目崩溃(React error #300,issue #145)—— 问候卡的早退判断排在 4 个 hook 之前…'` | **吻合** |
| L5219 | `//   被宿主槽位错误边界接住 ⇒ shell.overlay 与 conversation.view 两个承载面**整页白屏**。` | **吻合**（是注释） |
| L6204 | `// ★2026-09-28 修 issue #145（宿主槽位边界报 React error #300 / shell.overlay）：` | **吻合**（是注释） |
| L18470 | `surfaceDisposers.push(slots.inject('sidebar.footer.action', function () {` | **吻合** |
| L18474–18482 | 三处 `shell.overlay` 注册（order 5/6/7）逐行吻合 | **吻合** |

⇒ **裁定：报告行号对 v3.2.10 精确，无错位。** 报告作者确实读过 v3.2.10 源码。
⇒ **但「引用了真实行号」不等于「对行号内容的解释正确」**：L5219/L6204 是**注释**，报告把注释里描述的历史缺陷当成了现存缺陷（见 §3.5 第 1 条）。

---

## 5. C 项：`shell.overlay` 三注入

### 5.1 三处注册（v3.2.10 L18474–18482）

```
L18474-18476: slots.inject('shell.overlay', …) → register({ name: 'shell.overlay', id: 'auto-memory-pre',          order: 5 }, … h(Iter5Surface,{kind:'panel'},   h(MemoryPanel)))
L18477-18479: slots.inject('shell.overlay', …) → register({ name: 'shell.overlay', id: 'auto-memory-pre-dialogs',  order: 6 }, … h(Iter5Surface,{kind:'dialogs'}, h(DialogHost)))
L18480-18482: slots.inject('shell.overlay', …) → register({ name: 'shell.overlay', id: 'auto-memory-pre-autocont', order: 7 }, … h(Iter5Surface,{kind:'autocont'},h(AutoContinueHost)))
```

⇒ **三个不同 `id`**，分别承载「主面板 / 弹窗 / 自动接续」三个独立 UI 面，`order` 5/6/7 决定绘制次序。

### 5.2 宿主 slot 机制的注册/去重/排序语义（只读检索宿主 checkout）

宿主实现位置：`G:/dsh_desktop/resources/app.asar` → `dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js`（23,433 B）。

`shell.overlay` 的 **spec**（`dsh-client-ui-layout/lib/client.js` L617–620）：
```
"shell.overlay": { kind: "list", scope: "root" }
```

`SlotCore.register` 的 list 分支判据（slots/lib/index.js 原文）：
```js
case "list": {
  if (options.id === void 0) throw new Error(`list slot "${options.name}" requires options.id`);
  const occupant = rec.entries.find((e) => e.options.id === options.id && (e.options.priority ?? 0) === priority);
  if (occupant) throw new Error(`list slot "${options.name}" already has an entry with id "${options.id}" ${occupantHint(occupant)}`);
  break;
}
```
排序（同文件 L221）：
```js
next.sort(spec.kind === "list"
  ? (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0)
  : (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
```

### 5.3 用真实宿主模块实测（负路径同跑）

把 `@deepseek-ai/dsh-client-ui-slots`（v0.2.0-rc.2）**真 import 并真构造 `SlotCore`**，按宿主方式声明 `shell.overlay` 后注册：

```
spec(shell.overlay)={"kind":"list","scope":"root"}
entries after 3 registrations=3
ids in ledger order=["auto-memory-pre","auto-memory-pre-dialogs","auto-memory-pre-autocont"]
orders=[5,6,7]
after another plugin registers: count=4
order after sort=["other-plugin@1","auto-memory-pre@5","auto-memory-pre-dialogs@6","auto-memory-pre-autocont@7"]
duplicate id+priority rejected: true :: list slot "shell.overlay" already has an entry with id "auto-memory-pre" at priority 0 — register at a different priorit
after one entry crashes: live entries=["other-plugin","auto-memory-pre","auto-memory-pre-autocont"]
onEntryError events=[{"key":"shell.overlay","id":"auto-memory-pre-dialogs","abdicated":true}]
ledger still holds all registrations=4
```

### 5.4 C 项裁定

1. **「同插件注入 3 次」属实**——但三次是**三个不同 `id`**，宿主 list 槽的语义就是「同 id + 同 priority 才冲突」，**不同 id 是正常多条目共存**，且宿主已有插件（`dsh-client-ui-chat` / `plugin-manager` / `schedule` / `shortcuts` / `workspace` / `settings-session-log`）同样注入该槽 ⇒ 多插件共占是**设计内的常态**。
2. **同 id 同 priority 会被宿主显式抛错**（实测已复现），不会静默崩溃或互相顶替。
3. **条目崩溃不会互相连坐**：宿主 renderer（`dsh-client-ui-renderer/lib/client.js`）对 **每个 list 条目**各自包一层 `SlotErrorBoundary`——
   ```js
   // renderer L1113-1130（节选）
   const guarded = (entry, key, owner = ownerProps) => {
     const onEntryError = (error) => {
       host.reportEntryError(slotKey, entry, error, { abdicate: spec.kind !== "chain" });
     };
     return … (0, react_jsx_runtime.jsx)(SlotErrorBoundary, { slotKey, onEntryError, children: … })
   }
   ```
   实测：**一个条目崩溃后其余条目照常在列**（`live entries` 仍含另两条），仅该条目被 `abdicated` 退役，registration 仍留在 ledger 由注册方处置。

⇒ **裁定：C 项「注入 3 次」为事实，但不构成缺陷，也不是崩溃来源。** 若报告作者观察到「某一面白屏而其它面正常」，那正是**宿主 per-entry 边界的预期行为**，反而证明宿主隔离在生效。

---

## 6. D 项：500ms 轮询是否造成无谓 re-render

### 6.1 指控的形状

v3.2.10 中确有 **4 处** 500ms 轮询（L10543 / L11054 / L13042 / L13557），全部形如：
```js
var timer = setInterval(function () { identity[1](iter5Identity()) }, 500)
```
其中 `iter5Identity()`（L10275 / L12824）= `String(currentSessionIdClient()||'') + '|' + String(currentWs()||'')` —— **纯本地字符串拼接，不发网络请求**（与 Lead 结论一致）。

### 6.2 实测 React 是否 bail out（真 React 18.3.1，`react-test-renderer`）

在**仓库之外**的临时目录安装真 React（未改动仓库任何文件），真挂载组件并驱动 setState：

```
react version=18.3.1
renders: mount=1 afterSameValue=1 afterDifferent=2
SAME_VALUE_BAILED_OUT=true
DIFFERENT_VALUE_RERENDERED=true
20 identical setState -> renders=1 (mount was 1)
NO_RERENDER_ON_IDENTICAL_TICKS=true
```

⇒ **`setState(相同值)` 确实走 bail out**：20 次同值 setState 后渲染次数**仍是 1**（仅挂载那次）；而换成不同值时渲染次数立即 2 ⇒ 该判据**不是恒真**（有区分力）。

### 6.3 D 项裁定

**「500ms 轮询造成无谓 re-render」不成立。**
- 轮询回调**不发网络请求**（纯本地字符串拼接，实测 Lead 结论复现）；
- 值未变化时 React **短路**，不触发 re-render（实测 20 次 0 次重渲染）；
- 该行为对**所有**轮询组件一致，属 React 内建优化，与本插件实现无关。

**无法验证的部分（如实标注）**：我无法在**真实浏览器**中测量该插件的实际渲染次数（宿主 GUI 需登录态与页面驱动，本次未介入）。上述结论是 React 语义层面的**确定性**结论，但「用户机器上是否存在其它高频 setState 源」我**无法验证**——这需要真实 Performance/profile 证据。

---

## 7. E 项：后端 CPU 指控

### 7.1 `/semantic-deep-detect` 是否周期性触发

**后端（`lib/index.js` v3.2.10）** 全部命中：
```
L398:  'semantic-deep-detect': '/api/dsh-auto-memory/semantic-deep-detect'   ← 路由注册表
L14342: // …semanticDeepDetect 命中后 probe/加载/档位即时生效                  ← 注释
L14358: engine.semanticDeepDetect = async () => {                        ← 实现
L16116: path: API['semantic-deep-detect']                                   ← 路由挂载
L16120: try { return writeJson(res, 200, await engine.semanticDeepDetect()) }  ← 请求处理
```
⇒ **后端零个周期性调用点**。它是一条**被动 HTTP 路由**，只在收到请求时执行。

**前端（`lib/client.js` v3.2.10）** 4 个调用点：
| 行 | 上下文 | 触发方式 |
|---|---|---|
| L11473 | `function runDetect() { … apiGet(API.semanticDeepDetect)` | **点击处理器**（设置页 ⟳ 按钮） |
| L14649 | 同上（变体档同一实现） | **点击处理器** |
| L17524 | 同上（变体档同一实现） | **点击处理器** |
| L18422 | `setTimeout(function () { apiGet(API.semanticDeepDetect) …` （L18421） | **开屏一次性** 12s 延时 |

⇒ **裁定：`/semantic-deep-detect` 不是周期性触发**，最坏情况是「每次页面加载一次」，之后不再触发。

### 7.2 `semantic-js-worker` 是独立进程还是阻塞主线程

`lib/semantic-js-process.js`：
```js
L5:  import { fork } from 'node:child_process'
L88: child = fork(new URL('./semantic-js-worker.js', import.meta.url), [], {
```
⇒ **独立子进程**（`child_process.fork`），**不阻塞主线程**。且文件头明确纪律：`This module must never import transformers/sharp, even as a fallback.`；进程在父进程退出/dispose 时 `SIGKILL` 回收。

### 7.3 是否存在其它周期任务（「70% CPU」的其它可能来源）

**前端定时器（v3.2.10 `client.js`，共 17 处 `setInterval`）中会发网络请求的**：
| 行 | 周期 | 动作 |
|---|---|---|
| L6365 | 1200ms | `refresh`（**仅在下载/安装进行中启用**：`if (!poll) return`） |
| L8210 | 15000ms | `load`（纯 GET 只读查询，注释自述「卸载时清掉，不留悬挂定时器」） |
| L9398 | 5000ms | `fetchTeamState()`（**团队启用时才注册**） |
| L17059 | 3000ms | 自动接续状态 `load` |
| L17128 | 3000ms | 自动接续 `poll` |
| L18416 | 3600s | `checkNotices` |
| L18460 | 30000ms | `pollTimeState` |

**后端定时器（v3.2.10 `index.js`）**：
| 行 | 周期 | 动作 |
|---|---|---|
| L13863 | `teamSyncIntervalMs`（≥5000） | 团队 pull（**`teamEnabled` 为真才动作**） |
| L14237 | 60000ms | `hubFeedTick`（`.unref()`） |
| L14917 | 3600s | `noticesRefresh` |
| L17708 | 15s | 心跳 + `tickTime()` + `subagentGcSweep()`（`.unref()`） |

⇒ 存在**多个**周期性任务（并非只有 deep-detect 一条），其中 15s 心跳与 60s hub feed 是后端常态负载来源。

### 7.4 E 项裁定

- **「`/semantic-deep-detect` 周期性触发」不成立**（后端 0 个周期调用点；前端 3 点击 + 1 次开屏延时）。
- **「阻塞主线程」不成立**（JS 语义 worker 是 `fork` 的独立子进程）。
- **「后端 70% CPU」的原因本次无法验证**：这需要用户机器的采样证据（进程名 + 采样栈）。可解释该现象的**已证实**候选是上表中 15s 心跳 / 60s hub feed / 团队 pull 等常态周期任务，以及 Python 侧语义 worker（BGE-M3 CPU 推理为分钟级、期间占满单核）——**但这些都只是候选，不是结论**。

---

## 8. 真实存在的问题清单

即便主要结论不成立，调查中**确认存在**的若干问题：

| # | 问题 | 证据 | 定性 |
|---|---|---|---|
| R1 | `iter5Identity()` 与两处 `Iter5Surface`、`iter5Identity` **各有 2 份定义**（L10275/L12824、L10977/L13454、L10498/L12998…） | 三处 `grep` 均命中 2 个定义点 | **真实冗余**（经典档 + 变体档各一份）。当前无功能错误，但任何「只改一处」的后续修改会造成两档行为分叉——这是本仓已固化过的同型教训 |
| R2 | 4 处 500ms 轮询**永不停止地调用 setState**（即使值没变） | L10543/L11054/L13042/L13557 | **真实但无实害**：React 短路使其零 re-render；仅消耗极小的定时器唤醒成本。可优化（改成只在值变化时 setState），但不是缺陷 |
| R3 | 前端 5000ms 团队轮询在多标签页/多视图下**共享单定时器引用计数**，但 `_teamPollTimer` 是模块级全局 | L9396–9403 | **待复核**：计数归零才 `clearInterval`，逻辑自洽；未发现泄漏，但在热重载/异常路径下模块级变量的生命周期值得复核 |
| R4 | `hubFeedTimer` / `heartbeatTimer` 用 `.unref()`，而 `pullTimer`（L13863）**未见 unref** | L14239/L17709 vs L13863 | **待复核**：可能影响测试/退出时的进程 settle（本仓已有「定时器不 unref 会挂住测试」的历史修复） |

---

## 9. 给用户的回复要点

1. **感谢并被采纳的部分**：报告引用的行号与 v3.2.10 源码**逐条吻合**（L2585 / L5219 / L6204 / L18470 / L18474–18482），说明报告作者确实读过我们发布的代码——这是有价值的审查。
2. **核心指控不成立**（逐条给证据）：
   - `#130` 组件 undefined：**114/114 首参有定义、0 未定义**；真执行 factory 不抛错；本架构**无 ESM 边界**，不存在互操作 undefined 路径。
   - 三个槽位：三次注册是**三个不同 id**（主面板/弹窗/自动接续），宿主 `shell.overlay` 是 list 槽，**多 id 共占是设计**；同 id 同 priority 会被宿主**显式抛错**，且**每条目独立错误边界**（一条崩溃不连坐）。
   - 无谓 re-render：`setState(相同值)` React **短路**（实测 20 次同值 → 0 次重渲染）。
   - deep-detect 周期触发：后端**无周期调用点**；JS 语义 worker 是**独立子进程**。
3. **一个关键澄清（也是报告最可能的误读来源）**：报告引用的 L5219 / L6204 在本仓是 **`//` 注释**，内容是「我们**曾修过** issue #145 的说明」；`grep` `Element type is invalid` / `#130` 在全仓**命中 0 次**，而 `#145` / `error #300` 真实存在——**那正是已修好的那条**。把注释里的历史缺陷当成现存缺陷，是本报告因果链的起点。
4. **我们仍需要用户提供**（否则无法定位其真实故障）：
   - **真实堆栈**（浏览器 DevTools Console 完整 error + stack，含 React 的 component stack）；
   - **版本四元组**：DSH 宿主版本、插件版本、是否有多插件同时注入 `shell.overlay`；
   - **CPU 证据**：进程名 + 采样（如 Windows 任务管理器"详细信息"里哪个 PID 占 70%）+ 是否在跑 Python 语义引擎（BGE-M3 推理期间单核满载属预期）；
   - **可复现步骤**：是开屏即崩，还是某操作后崩；是否 `teamEnabled` / 语义引擎 / 自动接续开关为真；
   - **是否与我们报告的 R1–R4 有关**（尤其若用户做过「只改一处 identity/I iter5Surface」的本地改动）。

---

## 10. 证据索引（可复算）

| 代号 | 内容 | 复算方式 |
|---|---|---|
| E1 | `h(X)` 首参定义审计（114 / 0） | `git show v3.2.10:lib/client.js` → 正则 `\bh\(\s*([A-Z][A-Za-z0-9_]*)` 取首参，再对 `function\|const\|let\|var\|class` 定义集求差 |
| E2 | 真执行 factory（8/8 PASS，含负路径） | vm 沙箱（沙箱清单抄自 `tests/smoke/smoke-test-client-loadable.mjs`）加载 v3.2.10 字节并真调 `entry.factory` |
| E3 | 五个组件定义行号 | `grep` 组件名 → 过滤 `function X` / `const X =` |
| E4 | 宿主 list 槽语义 | asar 内 `dsh-client-ui-slots/lib/index.js`：`register` 的 `case "list"`、L221 排序、L455 `reportEntryError` |
| E5 | 宿主 per-entry 错误边界 | asar 内 `dsh-client-ui-renderer/lib/client.js` L1113–1130（`guarded(...)` → `SlotErrorBoundary`） |
| E6 | slot 注册实测（3 注册共存 / 同 id 拒绝 / 单条崩溃不连坐） | 真 import 宿主 `dsh-client-ui-slots` 并真构造 `SlotCore` |
| E7 | React bail out 实测 | 仓外安装 react@18.3.1 + react-test-renderer@18，真挂载 + 20 次同值 setState |
| E8 | deep-detect 调用点 | `grep semantic-deep-detect` on v3.2.10 `lib/index.js` / `lib/client.js` |
| E9 | worker 进程模型 | `lib/semantic-js-process.js` L5 `import { fork }` + L88 `child = fork(...)` |
| E10 | 定时器清单 | `grep setInterval` on v3.2.10 `lib/index.js` / `lib/client.js` |

---

<!-- 调查于 2026-10-08 · 只读 · 未修改任何 lib/ tests/ 配置 -->