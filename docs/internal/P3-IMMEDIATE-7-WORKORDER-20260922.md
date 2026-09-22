# 施工工单 · triage §2.1「立即修 7 条」（2026-09-22）

> **工单性质**：只读调查产出。本轮**未改任何 `lib/` 文件、未改任何既有测试**，只新增本文件。
> **上游依据**：`docs/internal/ISSUE117-TRIAGE-20260922.md` §2.1（该报告写成于 **3.1.0 发版之前**）。
> **本轮复核口径**：一律回 **pre 线当前工作树** 取 `file:line` + 原文片段。行号**不照抄** triage 报告。
> **漂移基线（实测）**：`lib/index.js` mtime `2026-09-22 2:26:06`（triage 报告 mtime `2026-09-22 1:13:04`，晚 73 分钟）⇒ `index.js` 内行号按区间漂移 **+40 ~ +57**；`lib/context-host-pre.js` mtime `2026-09-22 0:31:37`。其余 5 个文件 mtime 均停在 2026-09-19/09-20 ⇒ **行号零漂移**。
> **取证边界**：宿主 `lib/index.js:29-87` 的 import 全部指向 `-pre.js`；**同名无 `-pre` 的文件是发布构建产物，改它们零运行时效果**，本工单不涉及。
> **纪律**：未跑全量回归（避免污染计时敏感套件）；未创建/委派任何下级子代理、workflow 或 Ralph。

---

## 一、总表（7 条终态 + 锚点漂移）

| # | 条目 | 是否仍成立 | 当前锚点（复核后） | triage 旧锚点 | 漂移 | 改动面 | 批次 |
|---|---|---|---|---|---|---|---|
| 1 | **P3-6** `queueLength` 恒 `undefined` | ✅ **仍成立** | `lib/index.js:11685` | `:11628` | **+57** | 1 行 | **A** |
| 2 | **P3-1②** `linkObserverCall` 缺 disposed 闸 | ✅ **仍成立** | `lib/index.js:1631` | `:1624` | **+7** | 1 行 | **A** |
| 3 | **P3-3(a)** `pathsByKey` 无 `delete`/`clear` | ✅ **仍成立** | `lib/context-host-pre.js:818-822` | `:818-822` | 0 | 1 行 | **B** |
| 4 | **P3-12** 配置保存走裸 `renameSync` | ✅ **仍成立** | `lib/config-io-pre.js:97` | `:92-99` | 0 | 1 行 + 1 import | **B** |
| 5 | **P3-14** 开发树路径进发布包 | ✅ **仍成立** | `lib/semantic-js-pre.js:79/95/183` | `:79/95/183` | 0 | 3 处候选 + 1 常量 | **B** |
| 6 | **P3-9** 6 处裸 `diag`/`console.error` | ✅ **仍成立（6/6 全中）** | `index.js:6259/6298/6311`、`shadow-host-pre.js:228`、`evidence-store-pre.js:143` | 完全一致 | **0** | 3 处 in-file + 2 处跨文件 | **A+B** |
| 7 | **P3-20②** 路径类键裸赋值 | ✅ **仍成立** | `lib/index.js:11406` | `:11355` | **+51** | ~8 行 | **A** |

**终态统计：仍成立 7 / 已不成立 0 / 无法判定 0。**

**结论：triage §2.1 的 7 条一条都没被顺手修掉**，但 **4 条的锚点行号已漂移**（其中 2 条漂移 >50 行）。按旧行号施工会打错位置。

**可合并批次数：2**
- **批次 A**（`lib/index.js` 单文件，5 条：P3-6 / P3-1② / P3-9 三处 in-file / P3-20②）⇒ 一次全量回归
- **批次 B**（跨文件 4 条：P3-3(a) / P3-12 / P3-14 / P3-9 两处跨文件）⇒ 一次全量回归
- A 与 B **无同函数、无同行段重叠**，也可并成单批一次回归；分会降低「一次红不知道谁引起的」的归因成本。

---

## 二、逐条工单

### 1 · P3-6 —— `polling-heartbeat.json` 的 `queueLength` 恒 `undefined`

**当前锚点（复核）**

```js
// lib/index.js:11676-11689  ← writeHeartbeat 完整函数体
11676:   const writeHeartbeat = async () => {
11677:     try {
11678:       const q = engine.runtimes.values().reduce((sum, rt) => sum + rt.pendingConsolidations.length, 0)
11679:       const hb = path.join(dshHome(), 'memory', 'polling-heartbeat.json')
11680:       await mkdir(path.dirname(hb), { recursive: true })
11681:       await writeFile(hb, JSON.stringify({
11682:         pid: process.pid,
11683:         heartbeatAt: Date.now(),
11684:         uptimeMs: Math.round(process.uptime() * 1000),
11685:         queueLength: q.length,          // ← 问题行
11686:         lastConsolidatedAt: (engine.autoStats && engine.autoStats.lastAt) || 0,
11687:         todayCount: (engine.autoStats && engine.autoStats.count) || 0,
11688:       }, null, 2), 'utf8')
11689:     } catch (e) {}
```

**是否仍成立**：✅ **仍成立**。
- `:11678` 的 `q` 是 `Array.prototype.reduce` 的**数字返回**（累加 `rt.pendingConsolidations.length`），`(3).length === undefined` ⇒ `JSON.stringify` **静默丢键**，该字段从未写出过。
- **三处 `polling-heartbeat` 引用已复核齐全**：写点 `:11679`、读点 `:6908`（`debugInfo.heartbeat` 用 `readTextSafe` + `JSON.parse` 回读）、注释 `:11675`。triage 称「`docs/` 与两份 README 一处未提」——本轮**未推翻**该结论（`docs/**` 与 README 仍无命中）。
- **同族对照（说明 `q.length` 是笔误而非设计）**：`lib/index.js:7041` 的 `debugInfo` 投影写的是 `pendingQueue: this.runtimes.values().reduce((sum, rt) => sum + rt.pendingConsolidations.length, 0)` —— **同一个 reduce 表达式，直接赋值、没有 `.length`**。这一行是「正确写法」的现成样板。

**最小改动**（1 行，`lib/index.js:11685`）

```diff
-        queueLength: q.length,
+        queueLength: q,
```

无新增 import、无副作用、无 await 语义变化。

**守卫形状**：**可以做成真行为断言，不必退回源码文本断言**（比 triage 的建议更强）。

关键实测事实：`writeHeartbeat()` **不只在 5 分钟定时器里跑**——
- `lib/index.js:11711` `const heartbeatTimer = setInterval(() => { void writeHeartbeat(); ... }, 15000)` ⇒ **15 秒**定时器（不是 5 分钟；5 分钟那个是 `:11708` 的 `retryTimer`，与心跳无关）
- `lib/index.js:11713` `void writeHeartbeat() // 立即心跳一次:重启后马上可见轮询存活` ⇒ **插件初始化即写一次**

⇒ 任何「boot 真实插件 + 临时 `DSH_HOME`」的 smoke 套件，在 `settle()` 之后**必然**能读到 `path.join(dshHome(), 'memory', 'polling-heartbeat.json')`。这就是**非真空断言**：文件不存在 ⇒ 直接红。

**建议套件**：新增 `tests/smoke/smoke-test-heartbeat-queue-pre.mjs`（或并入 `smoke-test-t9-diag-home-pre.mjs`——该套件已是「diag/home 面」的归宿，6,804 B）。

**断言写法（改坏必红，且不可能零迭代通过）**

```js
// 1) 先证明确实跑了：文件必须存在（文件不存在 ⇒ 本条红，杜绝真空通过）
const hbPath = path.join(dshHome(), 'memory', 'polling-heartbeat.json')
let raw = null
for (let i = 0; i < 40 && raw === null; i++) {           // 最多等 ~4s
  try { raw = readFileSync(hbPath, 'utf8') } catch (_) { await sleep(100) }
}
ok(raw !== null, 'P3-6 心跳文件已写出（writeHeartbeat 真跑过）')
const hb = JSON.parse(raw)

// 2) 正断言：键存在、是数字、非 undefined
ok(Object.prototype.hasOwnProperty.call(hb, 'queueLength'), 'P3-6 queueLength 键存在（未被 JSON.stringify 丢掉）')
ok(Number.isFinite(hb.queueLength), 'P3-6 queueLength 是有限数字（实得 ' + JSON.stringify(hb.queueLength) + '）')

// 3) 反断言：bug 形状已消失（这条让「改回 q.length」必红）
ok(hb.queueLength !== undefined, 'P3-6 queueLength 非 undefined')

// 4) 交叉校验：与 debugInfo 的 pendingQueue 同源同值（防「写死一个 0 蒙过去」）
const dbg = /* 走 /state 或 debugAssoc 路由取 debugInfo */
ok(hb.queueLength === dbg.pendingQueue, 'P3-6 queueLength 与 debugInfo.pendingQueue 一致')
```

> **为什么第 4 条重要**：只断言「是数字」时，把 `queueLength: q` 误改成 `queueLength: 0` 也会绿。第 4 条把心跳与 `:7041` 的独立投影绑成同一事实，**构造一个非零队列**（灌两条 pending consolidation）再断言 `=== 2` 即成为强断言。

**风险标注**
- **是否热路径**：**否**。`writeHeartbeat` 15s 一次、单文件写，且已有 `try{}catch(e){}` 全包。
- **是否牵动既有断言**：**否**。全仓 `tests/` 对 `heartbeat` 的命中只有 3 处，且都不是心跳文件的字段断言：`smoke-test-continue-chain-pre.mjs:152`（对 `HSRC` 断言 `void engine.tickAutoContinue()`）、`smoke-test-m70-pre.mjs:357`（注释）、`smoke-test.mjs:37`（注释）。⇒ **新增套件是净增，无既有断言要改**。
- **是否需连带改别的文件**：**是，但属文档**。triage 指出的文档缺口（`docs/**` 与 README 无 `polling-heartbeat` 命中）本轮**未推翻** ⇒ 建议同批在 `docs/HANDBOOK.md` 补一句该探针的路径与字段名，否则修完仍无人知道看哪。**这是文档改动，不影响回归。**

---

### 2 · P3-1② —— `linkObserverCall` 缺 `runtime.disposed` 闸

**当前锚点（复核）**

```js
// lib/index.js:1629-1648  ← 完整函数体
1629:   /** callId→rootCallId 关联账本(root/nested tool call;tools/result 与持久 tool/result 双通道合并,有界)。关闭模式零留存。 */
1630:   linkObserverCall(runtime, callId, rootCallId, name, via) {
1631:     if (!runtime || !callId) return                                   // ← 问题行(无 disposed 闸)
1632:     if (this.config.associativeMemoryEnabled !== true) return // 方案 B:关闭时不保留任何关联数据
1633:     if (!runtime.callLinks) runtime.callLinks = new Map()             // ← 惰性重建(可把 Map 挂回已 disposed runtime)
1634:     const key = String(callId)
1635:     let link = runtime.callLinks.get(key)
...
1644:     while (runtime.callLinks.size > 64) {
1645:       const oldest = runtime.callLinks.keys().next().value
1646:       runtime.callLinks.delete(oldest)
1647:     }
1648:   }
```

**是否仍成立**：✅ **仍成立**。三条独立证据：

1. **函数体确无 `disposed` 判断**：`:1630-1648` 全段无 `disposed` 字样（本轮逐行读过）。
2. **同文件的对照组确实已修**：`lib/index.js:1541` `if (!runtime || runtime.disposed || !spec || typeof spec !== 'object') return null` —— 这正是 `ingestEnvelope` 的入口闸，且它挡在 `:1550` 的 `envelopes` 惰性重建**之前**。旁路闸另有 `:1670`（`if (!runtime || runtime.disposed || !event || ...)`）、`:1874`（`if (runtime.disposed) return null`）、`:1895`（`if (!runtime || runtime.disposed) return 0`）。⇒ **同一防线已有 4 处，唯独 `linkObserverCall` 漏了**。
3. **dispose 路径确实把 `callLinks` 置 null**（所以惰性重建是"挂回"，不是"复用"）：`lib/index.js:1243` `if (runtime.callLinks) runtime.callLinks.clear()`、`:1246` `runtime.callLinks = null`；`:1260`/`:1263`（第二条 dispose 分支同款）；`:1490`/`:1493`（`clear()` + `= null`）；初始化 `:1159` `callLinks: null`。

**接线点（3 个调用者）**：`lib/index.js:1718`（`this.linkObserverCall(runtime, callId, undefined, data.name)`）、`:1739`（`..., undefined, 'persisted')`）、`:1841`（`..., exec.rootCallId, exec.name, 'frozen')`）。

> **触发场景诚实标注（推断）**：本轮**未构造**出「已 dispose 的 runtime 传进 `linkObserverCall`」的可复现路径。这三个调用者分别位于 `tool/result`、持久 `tool/result`、`frozen` 通道，其上游是否可能在 `agent/disposed` 之后仍投递事件**本轮未追完**。⇒ 本条属**「同一防线漏一个入口」的对齐性修复**（风险近零、防御纵深），**不是**已验证的现网 bug。triage 报告也如实标注了这一点。**这一条不改判「仍成立」——闸缺失是硬事实，只是缺已证实的触发场景。**

**最小改动**（1 行，`lib/index.js:1631`）

```diff
-    if (!runtime || !callId) return
+    if (!runtime || runtime.disposed || !callId) return
```

无新增 import。写法与 `:1541`/`:1670` 完全同款（`runtime.disposed` 是普通布尔属性，`dispose()` 在 `:1225`/`:1252` 置 `true`）。

**守卫形状**：**建议并入既有套件，用真行为断言**。

**建议套件**：`tests/smoke/smoke-test-context-observer.mjs`（32,991 B）——**该套件已有现成的 dispose 段**，直接复用其形状最省：
- `:245-246` `const disposedHandler = h.eventHandlers.get('agent/disposed')` / `disposedHandler({ agent: agentB })`
- `:248` `if (postDispose) throw new Error('runtime B survived dispose')`
- `:253-257` 第二条 dispose + 跨会话串扰检查 + `console.log('P3f dispose cleanup ✓')`

**断言写法（改坏必红，非真空）**

```js
// 紧跟在既有 P3f 段之后（那里 runtime 刚被 dispose）
const rtB = hp.engine.runtimes.findBySessionId(sidB) || hp.engine.runtimes.get(agentB)
if (rtB.disposed !== true) throw new Error('P3-1② 前置失败：runtime B 未处于 disposed')  // ← 先证前置真跑过

// ① 直接打函数：dispose 后调用必须不留痕（改坏必红的核心断言）
rtB.callLinks = null                                    // 还原 dispose 后的真实态
hp.engine.linkObserverCall(rtB, 'call-after-dispose', 'root-1', 'probe', 'frozen')
if (rtB.callLinks !== null) throw new Error('P3-1② dispose 后 linkObserverCall 重建了 callLinks')

// ② 负向对照：正常（未 dispose）runtime 必须仍能写入 —— 防止「把闸加太宽、函数变空操作」也绿
const rtA = /* 一个未 dispose 的 runtime */
rtA.callLinks = null
hp.engine.linkObserverCall(rtA, 'call-alive', 'root-2', 'probe', 'frozen')
if (!rtA.callLinks || rtA.callLinks.size !== 1) throw new Error('P3-1② 正常 runtime 仍须可写入')
```

> **为什么必须有 ②**：只断言 ① 的话，把 `linkObserverCall` 整体改成 `return`（或把闸写成 `if (!runtime) return` 之外的更宽条件）也会绿。② 把「闸只挡 disposed」钉死。

**风险标注**
- **是否热路径**：**是**。`linkObserverCall` 在每个 tool/result 上被调；但改动是**在入口加一次布尔读**，无分配、无 IO、无 await ⇒ **零可测性能影响**。
- **是否牵动既有断言**：**否**。`smoke-test-context-observer.mjs` 的 P3f 段只断言「runtime 不复活 / 无跨会话串扰」，**未触碰 `callLinks`**；新增断言是净增。⚠️ 但要注意：该套件 `:64` / `:381-398` 已在用 config 路由 POST，本条的 harness 前置（找 disposed runtime）需复用同一 `hp` 实例 —— **必须写在同一个 `try/finally` 块内**（该文件 `:405-406` 有双层 finally 做 `hp.settle()/hp.cleanup()`）。
- **是否需连带改别的文件**：**否**。

---

### 3 · P3-3(a) —— `context-host-pre.js` 的 `pathsByKey` 单调增长

**当前锚点（复核）**

```js
// lib/context-host-pre.js:108
108:   const pathsByKey = new Map()          // ← 模块级(闭包级) Map,字符串键

// lib/context-host-pre.js:199
199:     pathsByKey.set(String(runtimeKey || ''), { ... })   // ← 唯一写点

// lib/context-host-pre.js:818-822   ← disposeRuntime 全文
818:   function disposeRuntime(runtime) {
819:     const st = states.get(runtime)
820:     if (st) st.disposed = true
821:     states.delete(runtime)
822:   }                                       // ← 无 pathsByKey 操作

// lib/context-host-pre.js:823-828
823:   function disposeAll(reason) {
824:     for (const pair of collectStates()) disposeRuntime(pair.runtime)
825:     volatileDrops.length = 0
826:     if (bridge) void bridge.dispose(reason)
827:     if (store) store.dispose(reason)
828:   }                                       // ← 注意:disposeAll 走 disposeRuntime,所以它现在也清不掉 pathsByKey

// lib/context-host-pre.js:830-841  ← 导出表(节选)
830:   return {
...
839:     disposeRuntime,
840:     disposeAll,
841:     // M6-3 接线点:按 memoryId+recordDigest 查当前 corpus 完整 provenance(...)
```

**是否仍成立**：✅ **仍成立，且措辞需修正一处**。

- **`pathsByKey` 全文件零 `delete`/`clear`** —— 本轮 grep `pathsByKey|disposeRuntime|disposeAll|disposeSession` 命中 14 处，逐条为：`:108` 声明、`:199` 写、`:316`/`:482`/`:683` 读、`:794` 读（debugView 投影）、`:818`/`:839` disposeRuntime、`:823`/`:824`/`:840` disposeAll、`:846` 读（`findProvenance` 遍历）。**没有任何 `delete`/`clear`。**
- **`disposeSession` 确实不存在于导出表**：`:830-841` 的返回对象里有 `disposeRuntime` / `disposeAll`，**无 `disposeSession`**。对照 `lib/activation-host-pre.js` 有真 `disposeSession`（triage 引 `:577`）⇒ **同一 bug 的两份实现只修了一份**，结论维持。
- **增长速率 = 每会话一条小对象**（key 为 `String(runtimeKey || '')`）。长驻宿主按历史会话数**单调增长**，无上限。
- ⚠️ **对 triage 措辞的一处纠正（重要）**：triage 说「只在 `disposeAll:818` 清空」——**这个说法现在也不准**。`disposeAll`（`:823-828`）的实现是**遍历调用 `disposeRuntime`**，而 `disposeRuntime` 不清 `pathsByKey` ⇒ **`disposeAll` 同样清不掉**。也就是说：**当前 `pathsByKey` 是一个「模块生命周期内永不释放」的集合**，连全量 dispose 都不清。这把严重度从「per-session 路径缺失」上调为「**连全量退出路径都漏**」。（triage 表中同时写「只在 disposeAll:818 清空」与「既无 delete 也无 clear」，两处自相矛盾；**本轮判定后者正确**。）

**最小改动**（1 行，`lib/context-host-pre.js:818-822` 内补一行）

```diff
   function disposeRuntime(runtime) {
     const st = states.get(runtime)
     if (st) st.disposed = true
     states.delete(runtime)
+    pathsByKey.delete(String(runtime.key || ''))
   }
```

**为什么 key 写法必须是 `String(runtime.key || '')`**：`:316`、`:482`、`:683` 三处读点全部写作 `pathsByKey.get(String(runtime.key || ''))`，`:794` 用 `[...pathsByKey.keys()]` 投影出 `capturedPathKeys`。**写入侧 `:199` 用的参数名是 `runtimeKey`，需确认调用方传的就是 `runtime.key`** —— 本轮已由三处读点反证（读写必须同键，否则现有功能早已失效）⇒ 用 `runtime.key` 与既有读点同口径，**这是唯一正确写法**。

**守卫形状**：**必须用真行为断言，源码文本断言不足**。

**建议套件**：`tests/smoke/smoke-test-capture-paths-pre.mjs` —— **该套件已直击 `pathsByKey`**：`:87` `ok(fake._calls.length === 0, 'B6 未就绪时零注册（不污染 pathsByKey）')`。它知道这个集合的语义，是天然归宿。（次选 `smoke-test-context-observer.mjs` 的 P3f 段，但那边的 `pathsByKey` 需经 `_statsForTest`/`debugView` 间接观测，不如前者直接。）

**断言写法（改坏必红，非真空）**

```js
// 前提：本套件已能构造 runtime → capturePaths 写入一条
// ① 先证明写入真的发生了(否则下面的 delete 断言会「对一个空集合通过」= 真空)
const before = hpDebugView().capturedPathKeys          // 走 debugView 的 :794 投影
if (!(before.length >= 1)) throw new Error('P3-3(a) 前置失败：pathsByKey 未被写入，测试自身无效')

// ② 核心断言：disposeRuntime 后该键必须消失
const key = String(rt.key || '')
hp.disposeRuntime(rt)
const after = hpDebugView().capturedPathKeys
if (after.includes(key)) throw new Error('P3-3(a) disposeRuntime 未清理 pathsByKey：' + key)

// ③ 反向对照：未 dispose 的兄弟 runtime 的键必须仍在 —— 防「改成 pathsByKey.clear() 一刀切」也绿
if (!after.includes(String(rtAlive.key || ''))) throw new Error('P3-3(a) dispose 误伤了未 dispose 的 runtime')
```

> **为什么必须有 ① 与 ③**：只写 ② 的话（a）集合本来就空 ⇒ 恒绿；（b）用 `pathsByKey.clear()` 实现 ⇒ 也绿但语义错误。①③ 两个前提把断言钉成「精确删除单个键」。`capturedPathKeys` 被 `:794` 截断到 8 条（`slice(0, 8)`）⇒ **测试内 runtime 数必须 ≤8**，否则 ② 可能因截断而假绿；**这是本守卫唯一的构造纪律**。

**风险标注**
- **是否热路径**：**否**。`disposeRuntime` 只在会话释放时调用一次。
- **是否牵动既有断言**：**需逐个确认 2 处**（这是本条唯一的连带面）：
  - `tests/smoke/smoke-test-m78-host-pre.mjs:111` `ok(cb.capturedPathKeys && cb.capturedPathKeys.length >= 1, ...)` —— ⚠️ **关键区分**：这里的 `cb` 是 `am2.contextBridge`（`:103` `const cb = am2.contextBridge`），即 **`context-host-pre.js` 的投影**（`:794`）。该断言在**未 dispose 的活跃段**执行（`:100-113`，`h.cleanup()` 在 `:114`）⇒ **本条改动（在 dispose 时删除）不影响它**。已核。
  - `tests/smoke/smoke-test-capture-paths-pre.mjs:87` —— 断言的是「未就绪时零注册」，与 dispose 无关 ⇒ 不影响。已核。
  - **全局风险**：若某处**在 dispose 之后**仍读 `pathsByKey` 并期望有值，改动会致其回归。已知读点 `:316`/`:482`/`:683`/`:846` 全都以 `|| null` / `|| {}` 兜底（`:316` `pathsByKey.get(...) || null`、`:482` `(pathsByKey.get(...) || {}).workspaceKey || ''`）⇒ **null-safety 已具备，改动安全**。
- **是否需连带改别的文件**：**否**。（`activation-host-pre.js` 的同款已修，无需动。）

---

### 4 · P3-12 —— 设置页保存 `config.json` 未接 `retryRename`

**当前锚点（复核）**

```js
// lib/config-io-pre.js:29-31  ← 现有 import(注意:无 fs-retry-pre)
29: import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
30: import { writeFile } from 'node:fs/promises'
31: import path from 'node:path'

// lib/config-io-pre.js:55-66   ← quarantineFilePreSync(第三处 renameSync,同步版,本工单不动)
55: export function quarantineFilePreSync(file, opts = {}) {
...
61:     renameSync(file, finalPath)

// lib/config-io-pre.js:72-84   ← writeTextAtomicPreSync(同步原子写,本工单不动)
72: export function writeTextAtomicPreSync(file, text) {
...
77:     renameSync(tmp, file)

// lib/config-io-pre.js:86-103  ← writeTextAtomicPre(异步原子写)★ 改这里
86: /**
87:  * **异步原子写**：tmp → rename。语义与同步版一致。
88:  *
89:  * 只把**可能较大**的正文写入交给异步 IO；rename 本身极快，保持同步调用。
90:  * 这样与既有 `persistConfigPre` 的异步口径对齐，不引入额外的 await 链。
91:  */
92: export async function writeTextAtomicPre(file, text) {
93:   const tmp = file + ATOMIC_TMP_SUFFIX_PRE_V1
94:   try {
95:     mkdirSync(path.dirname(file), { recursive: true })
96:     await writeFile(tmp, String(text), 'utf8')
97:     renameSync(tmp, file)                      // ← 问题行(裸 renameSync,无退避)
98:     return { ok: true, path: file }
99:   } catch (e) {
100:     try { rmSync(tmp, { force: true }) } catch (_) {}
101:     return { ok: false, error: String((e && e.message) || e) }
102:   }
103: }
```

**是否仍成立**：✅ **仍成立**。三处 `renameSync` 一处不少（`:61` / `:77` / `:97`），且 **`config-io-pre.js` 全文无 `retryRename` 引用、无 `fs-retry-pre.js` import**。
**竞态定义（复核 `lib/fs-retry-pre.js`）**：
- `:28` `export async function retryRename(from, to, opts = {})`
- `:18` `export const RENAME_RETRY_DELAYS = Object.freeze([0, 50, 150, 400, 1000])`
- `:19` `const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])`
- `:15` `import { promises as fsDefault } from 'node:fs'` ⇒ 内部用 **promise 版 `rename`**，**本身是 async、签名与 `await retryRename(tmp, file)` 直接兼容**。
- **无循环依赖**：`fs-retry-pre.js` 只 import `node:fs` / `node:timers/promises`（`:15-16`），**不 import 任何本仓模块** ⇒ `config-io-pre.js` 反向 import 它安全。
- **约束（triage 已指出，本轮确认成立）**：同步版 `writeTextAtomicPreSync`（`：72-84`）**不能**改成 `retryRename` —— 它是同步签名，塞 async 会破契约并让所有调用方拿到 Promise。受影响调用点已核：`lib/index.js:2053`、`:10841` 走 `writeTextAtomicPreSync`。**本工单只改 `:97`。**

**最小改动**（1 行 import + 1 行替换）

```diff
  import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
  import { writeFile } from 'node:fs/promises'
  import path from 'node:path'
+ import { retryRename } from './fs-retry-pre.js'
```

```diff
      await writeFile(tmp, String(text), 'utf8')
-     renameSync(tmp, file)
+     await retryRename(tmp, file)
      return { ok: true, path: file }
```

⚠️ **连带注意（必须一并处理）**：`:97` 改成 `await retryRename(...)` 后，**`renameSync` 的引用只剩 `:61` 与 `:77` 两处** ⇒ **`import { ... renameSync ... }` 不可删**（删了会 `ReferenceError`）。反向也成立：**不要**因为"只有三处"就把 `:61`/`:77` 一起改（`:61` 在 `quarantineFilePreSync`、`:77` 同步契约，两处都超范围）。

**守卫形状**：**用既有的故障注入形状，且必须证明重试真的发生了**。

**建议套件**：`tests/smoke/smoke-test-t8-configio-pre.mjs`（13,082 B，config-io 的专属套件）。故障注入手法参照 `tests/smoke/smoke-test-issue48.mjs`（18,673 B，`retryRename` 的原生长处）——`retryRename` 的 `opts.fs` / `opts.sleep`（`:29`/`:32`）就是**为该类注入测试预留的**。

**断言写法（改坏必红，非真空）**

```js
// 思路：注入一个「前 N 次 EPERM、第 N+1 次成功」的 fs.rename，直接测 retryRename 语义
// 但 writeTextAtomicPre 不接受注入 ⇒ 改用两条互补断言：
//
// ① 行为断言(真跑)：把目标路径指向一个「首次 rename 必 EPERM」的位置不可行 ⇒
//    改为验证 writeTextAtomicPre 在瞬时错误下最终成功。用 node:fs 的 mock 不可行(模块已绑定)，
//    因此本条降级为 ② + ③；这是本守卫的唯一妥协点，已在下方「局限」写明。
//
// ② 组装断言（非源码文本）：断言模块实际导出的实现走的是 await 链 ⇒
//    在临时目录里写一个大文本，并发 5 次同路径写入，断言 100% 返回 { ok: true }（裸 renameSync 在高并发下更易 EPERM）
const results = await Promise.all([...Array(5)].map((_, i) =>
  writeTextAtomicPre(target, 'x'.repeat(200000) + i)))
ok(results.every(r => r.ok === true), 'P3-12 并发原子写全成功（' + JSON.stringify(results.filter(r=>!r.ok)) + '）')
ok(readFileSync(target, 'utf8').startsWith('x'.repeat(100)), 'P3-12 目标文件可用')

// ③ **直接测 retryRename 语义**（这条才是「重试真的发生」的证明，与 ② 互补）
const calls = []
const flaky = { rename: async (f, t) => { calls.push(f); if (calls.length < 3) { const e = new Error('busy'); e.code = 'EBUSY'; throw e } } }
await retryRename('a', 'b', { fs: flaky, sleep: async () => {} })
ok(calls.length === 3, 'P3-12 retryRename 在 EBUSY 下重试到第 3 次才成功（实得 ' + calls.length + '）')

// ④ **接线断言**：证明 config-io-pre.js 真的把它接上了（防止「改了 retryRename 但忘了接线」）
const SRC = readFileSync('lib/config-io-pre.js', 'utf8')
ok(/import\s*\{[^}]*retryRename[^}]*\}\s*from\s*'\.\/fs-retry-pre\.js'/.test(SRC), 'P3-12 已 import retryRename')
ok(/await\s+retryRename\(tmp,\s*file\)/.test(SRC), 'P3-12 async 版已换 await retryRename')
ok(/renameSync\(tmp,\s*file\)/.test(SRC), 'P3-12 sync 版保持 renameSync（不可被误改）')
```

> **局限（诚实标注）**：③ 测的是 `retryRename` 自身语义，④ 测的是接线，**没有一条在真 EPERM 下端到端验证 `writeTextAtomicPre`**。`writeTextAtomicPre` 不接受 `opts.fs` 注入（`:92` 签名只有 `(file, text)`）⇒ 端到端注入需**先改生产签名**，超 P3 范围。**若求端到端，唯一无侵入办法**：在守卫里临时占用目标文件句柄（Windows 上 `openSync(target, 'r')` 不阻塞 rename；需用 `fs.open` + 独占标志）——**推断有效但本轮未实测**，故不写成必做项。⇒ ② 的高并发同路径写入是**可实测的替代**：裸 `renameSync` 在 Windows 并发下 EPERM 概率显著高于 `retryRename`，但**不是确定性红**，故 ② 只作辅助，**判据是 ③+④**。

**风险标注**
- **是否热路径**：**否**（配置保存是用户手动触发）；`retryRename` 最坏情形多等 `0+50+150+400+1000 = 1600ms`，但**仅在前序尝试失败时**才计时 ⇒ 正常路径**零延迟变化**（`delays[0] === 0`，第一次立即试）。
- **是否牵动既有断言**：**需核对 1 处**。`retryRename` 走 **`fs.promises.rename`** 而非 `fs.renameSync` ⇒ 调用从"同步"变"跨 microtask"。`writeTextAtomicPre` 本身是 `async`，调用方均已 `await`（已核 `lib/index.js:2033` `await writeTextAtomicPre(this._configPath, ...)`）⇒ **对调用方时序无影响**。但若某处依赖"`await writeTextAtomicPre` 返回后 rename 已同步完成"的**额外**假设（如立刻 `statSync` 目标），需注意——**本轮未发现此类调用方**（推断：低风险）。
- **是否需连带改别的文件**：**否**。triage 已列明剩余 6 处裸 `renameSync`（`index.js:9308`、`python-setup-pre.js:300`、`semantic-js-pre.js:514`、`skill-export-host-pre.js:119` 等）**按 triage 判定不属本条范围**，本工单**不做全仓替换**（避免制造「已统一」的错觉）。

---

### 5 · P3-14 —— 开发树 `artifacts/m7-live-pre/*` 路径当作生产候选

**当前锚点（复核，3 处 + 1 处注释）**

```js
// lib/semantic-js-pre.js:70-81   ← 候选 #1
70:
71: function defaultModelsDirCandidates(pluginDir) {
72:   // 用户目录优先(#15 后续/B 修复):~/.dsh/models/js-semantic/ 跨插件升级存活——
73:   // 包目录(lib/models)在 npm 更新时会被整体重装,下载的 130MB 模型曾被冲掉。
74:   // ★#86-3：统一口径
75:   const dshHome = resolveDshHomePre()
76:   return [
77:     path.join(dshHome, 'models', 'js-semantic'),
78:     path.join(pluginDir, 'models'),
79:     path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'models'),   // ← ★ 开发树路径
80:   ]
81: }

// lib/semantic-js-pre.js:83-97   ← 候选 #2
83: function defaultPeerDirCandidates(pluginDir) {
84:   // pluginDir = <pkg>/lib(2026-09-02 issue 复核修正:此前上溯层级错位 → peerPresent 恒 false)。
85:   // 静态候选仅作兜底,主路径是 resolvePeerTransformersDir 的真实解析:
86:   //   1) lib/node_modules —— issue 临时 junction 绕过位(向后兼容)
87:   //   2) <pkg>/node_modules —— 包内邻接位(lib 上 1 级再进 node_modules)
88:   //   3) lib 上 3 级直拼 @huggingface —— 标准布局即 <root>/node_modules(pnpm hoisted/npm 提升),
89:   //      pnpm isolated 下即虚拟存储包内位 .pnpm/<hash>/node_modules
90:   //   4) 开发树 artifacts      // ← ★ 注释条目
91:   return [
92:     path.join(pluginDir, 'node_modules', '@huggingface', 'transformers'),
93:     path.join(pluginDir, '..', 'node_modules', '@huggingface', 'transformers'),
94:     path.join(pluginDir, '..', '..', '..', '@huggingface', 'transformers'),
95:     path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'node_modules', '@huggingface', 'transformers'),  // ← ★ 开发树路径
96:   ]
97: }

// lib/semantic-js-pre.js:183   ← 候选 #3
183:     path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'models', E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx'),
```

**是否仍成立**：✅ **仍成立，且「会进发布包」已独立复核确认为真**。

三重证据（全部本轮实测）：
1. **会进发布包** —— `tools/release.mjs:234` 的转换表原文：
   ```
   234:       'recall-fusion-pre.js', 'semantic-decide-pre.js', 'semantic-js-pre.js',
   ```
   ⇒ `semantic-js-pre.js` 是**发布转换对象**，`-pre` 内容即发布内容。
2. **该目录确属「开发树专属、用户机恒不存在」** —— `.gitignore` 有两条专排除：
   ```
   .gitignore:19: artifacts/m7-live-pre/js-semantic-trial/node_modules/
   .gitignore:20: artifacts/m7-live-pre/js-semantic-trial/models/
   ```
   ⇒ `:95` 与 `:183` 指向的正是被排除的两个子目录，**npm 包里不可能有它们**。
3. **`pluginDir` 的语义确定** —— `:84` 注释自述 `pluginDir = <pkg>/lib` ⇒ `pluginDir/..` = 包根 ⇒ `包根/artifacts/m7-live-pre/...` 在用户机上**结构性不存在**（`package.json.files` 不含 `artifacts`；且 triage 已记 `docs` 也因 #106 被移出 `files`，说明该仓对此类「产物不该带什么」有明确口径）。

**性质定级（与 triage 一致）**：**不是功能缺陷，是"探测候选里多一条死路径"** —— 语义是 `existsSync` 判存在，路径不存在即跳过。⇒ **删掉后用户侧行为零变化**。

**最小改动**（推荐：env 闸而非直删）

新增 1 个模块级常量（放在 `:70` 之前，与既有风格一致）：

```js
// ★P3-14:开发树 artifacts 里的 js-semantic-trial 是纯维护者机器路径(.gitignore 已排除,
//   用户机上恒不存在),发布包不该把它当生产候选 ⇒ 默认不纳入,维护者用 env 显式开启。
const DEV_TREE_ENABLED = process.env.DAM_DEV_TREE === '1'
/** 开发树 artifacts 候选(仅维护者侧生效)。 */
function devTreeRoot(pluginDir) {
  return DEV_TREE_ENABLED ? path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial') : null
}
```

三处替换：

```diff
   return [
     path.join(dshHome, 'models', 'js-semantic'),
     path.join(pluginDir, 'models'),
-    path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'models'),
-  ]
+  ].concat(DEV_TREE_ENABLED ? [path.join(devTreeRoot(pluginDir), 'models')] : [])
 }
```

```diff
-  //   4) 开发树 artifacts
-  return [
+  //   4) 开发树 artifacts(★P3-14:仅 DAM_DEV_TREE=1 时纳入,该路径 .gitignore 排除、用户机恒不存在)
+  return [
     path.join(pluginDir, 'node_modules', '@huggingface', 'transformers'),
     path.join(pluginDir, '..', 'node_modules', '@huggingface', 'transformers'),
     path.join(pluginDir, '..', '..', '..', '@huggingface', 'transformers'),
-    path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'node_modules', '@huggingface', 'transformers'),
-  ]
+  ].concat(DEV_TREE_ENABLED ? [path.join(devTreeRoot(pluginDir), 'node_modules', '@huggingface', 'transformers')] : [])
 }
```

```diff
-    path.join(pluginDir, '..', 'artifacts', 'm7-live-pre', 'js-semantic-trial', 'models', E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx'),
+    ...(DEV_TREE_ENABLED ? [path.join(devTreeRoot(pluginDir), 'models', E5_MODELS_SUBDIR, 'onnx', 'model_quantized.onnx')] : []),
```

> ⚠️ **`:183` 的替换需先看该处所在数组的上下文**：本轮**已确认 `:183` 的行原文**，但未完整读该数组的其余成员与结尾形式 ⇒ **执行前必须先读 `:170-195` 才能定 `concat(...)` 的落点**（若该数组本身就在 `.concat(...)` 链或已有展开元素，改法需就势调整）。**这是本条唯一需施工者现场确认的点。**
> ➡️ **替代方案（更省事、更彻底）**：若维护者不再需要该候选，**直接删 3 行 + 注释 `:90`** 亦可，用户侧行为同样零变化。**env 闸的价值仅在于保住维护者离线调试能力** —— 这是一个**维护者便利性取舍**，不是技术必需。建议采 env 闸（保留能力）、删亦可接受。

**守卫形状**：**"发布转换后不含 `m7-live-pre`" 是可以用离线静态断言钉死的**（这条最稳）。

**建议套件**：新增 `tests/smoke/smoke-test-p3-release-hygiene-pre.mjs`（该仓已有 `smoke-test-issue111-docs-real-names-pre.mjs` 这类"文档/发布卫生"离线守卫，沿其形态）。

**断言写法（改坏必红，非真空）**

```js
// ① 源码断言：-pre 源本体内不得再出现生产候选形态的 m7-live-pre
const SRC = readFileSync('lib/semantic-js-pre.js', 'utf8')
const hits = [...SRC.matchAll(/path\.join\([^)]*m7-live-pre[^)]*\)/g)].map(m => m[0])
if (hits.length !== 1) throw new Error('P3-14 预期 m7-live-pre 只剩 1 处(devTreeRoot 内),实得 ' + hits.length + '\n' + hits.join('\n'))

// ② **更强的一条**：真跑发布转换，断言产物里没有 m7-live-pre
//    (直接复用 tools/release.mjs 的转换规则，或断言 release.mjs 的转换表 + 源文件内容)
const REL = readFileSync('tools/release.mjs', 'utf8')
ok(/semantic-js-pre\.js/.test(REL), 'P3-14 前置：semantic-js-pre.js 确在发布转换表内')

// ③ 反断言(防「假装修了」)：断言 DEV_TREE_ENABLED 默认 false 且真的被用于 gate
ok(/const DEV_TREE_ENABLED = process\.env\.DAM_DEV_TREE === '1'/.test(SRC), 'P3-14 开发树闸存在且默认关闭')

// ④ 行为断言：在无 DAM_DEV_TREE 的环境下，候选列表长度必须比有闸时少
delete process.env.DAM_DEV_TREE
const cands = /* import defaultModelsDirCandidates —— 注意该函数未导出，需经 createSemanticEngine 取 */
ok(!JSON.stringify(cands).includes('m7-live-pre'), 'P3-14 默认候选不含开发树路径')
```

> **⚠️ 命名导出可用性（诚实标注）**：`defaultModelsDirCandidates` / `defaultPeerDirCandidates` 是**模块内私有函数**（`function`，无 `export`）⇒ ④ 无法直接 import。**若要做 ④**，需经 `createSemanticEngine`/`resolvePeerTransformersDir` 等导出面间接取，**或**把 `devTreeRoot` 导出（新增导出会影响 P3-16 的"零引用导出"盘点口径 ⇒ **不建议**）。⇒ **落地建议：判据以 ①③ 为主（源码级，改坏必红），② 次之；④ 列为可选项。**

**风险标注**
- **是否热路径**：**否**。候选数组只在模型/peer 探测时构造，非每轮 recall。
- **是否牵动既有断言**：**需核对 1 类**。全仓对 `m7-live-pre` 的引用若被某守卫**断言存在**，会红 —— 本轮 `grep m7-live-pre` 的命中只落在 `lib/semantic-js-pre.js` 三处 + `lib/semantic-js.js` 三处（发布产物）+ `.gitignore` 两条 + triage 文档，**未发现任何 `tests/` 断言依赖它** ⇒ **低风险**（置信度：高，但建议施工后跑全量确认）。
- **是否需连带改别的文件**：**建议但不强制**：
  - `lib/semantic-js.js`（**发布产物**）—— 改它零运行时效果，**不需要改**；下次发版由 `tools/release.mjs` 自动重新生成 ⇒ 会自动带上本次修复。
  - **若选"直接删"方案**，同一处 `semantic-js.js` 会在下次发版时同步消失，无需手工介入。

---

### 6 · P3-9 —— 6 处裸 `diag`/`console.error` 未节流

**当前锚点（复核）—— 6 处全中，且 `index.js` 的 3 处行号与 triage 完全一致**

```js
// lib/index.js:6259  (recall 语义臂择优降级)
6259:         try { diag('recall 语义臂择优降级: ' + String((eBest && eBest.message) || eBest).slice(0, 120)) } catch (_) {}

// lib/index.js:6298  (evidence-agg 降级)
6298:         try { diag('evidence-agg 降级为中性(impMap 空): ' + String((eImp && eImp.message) || eImp).slice(0, 140)) } catch (_) {}

// lib/index.js:6311  (temporal-parse 降级)
6311:       } catch (eTr) { try { diag('temporal-parse 降级(无时间臂): ' + String((eTr && eTr.message) || eTr).slice(0, 140)) } catch (_) {} }

// lib/shadow-host-pre.js:228
228:         if (!paths) { console.error('[shadow-diag] no-paths'); stats.suppressed++; pushVolatile({ reason: 'no-paths-captured', contextVersion: seg.contextVersion }); return }

// lib/evidence-store-pre.js:143
143:       try { console.error('[evidence-store] write-failed: ' + this.stats.lastWriteError) } catch (_) {}
```

**是否仍成立**：✅ **仍成立（6/6）**。`index.js` 的三处与 triage 报告给的行号**逐字一致**（该文件虽在 triage 后改动过，但这三处未位移）⇒ 本条的锚点**不属漂移项**。

**节流函数（复核）—— 现成可用，签名与默认窗口已确认**

```js
// lib/index.js:863-872
863: const _diagLastAt = new Map()
864: function diagThrottled(key, msg, windowMs) {
865:   try {
866:     const w = Number(windowMs) > 0 ? Number(windowMs) : 300000
867:     const now = Date.now()
868:     if (now - (Number(_diagLastAt.get(key)) || 0) < w) return
869:     _diagLastAt.set(key, now)
870:   } catch (e) {}
871:   diag(msg)
872: }
```
⇒ **默认窗口 300000ms = 5 分钟**（不传 `windowMs` 即 5 分钟节流）。`diag` 本体在 `:928`。

**现有 `diagThrottled` 调用点（复核，确认"只覆盖 `restoreLastAgent` + hubIo"这一 triage 结论仍成立）**：`lib/index.js:7333` / `:7335` / `:7336` / `:7353` / `:7370` / `:7372`（全在 `restoreLastAgent` 内）+ `:9262`（`onError: (key, msg) => diagThrottled('hubIo:' + key, msg)`）。triage 引的 `:7299/7301/...` 已漂移到 `:7333/...`（**+34**），但**"无第 8 个调用点"的结论不变**。

**⭐ 关键发现：6 处里有 2 处跨文件，不能直接"换名字"**

`diagThrottled` 是 `lib/index.js` 的**模块私有函数**（`function`，无 `export`），而 `shadow-host-pre.js` / `evidence-store-pre.js` 是**独立模块**。本轮实测两文件的 diag 相关命中：

| 文件 | 命中 |
|---|---|
| `lib/shadow-host-pre.js` | **仅 `:228` 一行**（另有 `:152` 一条同族裸 `console.error('[shadow-audit] ...)`，见下） |
| `lib/evidence-store-pre.js` | **仅 `:143` 一行** |

⇒ **两文件均无 `onDiag` 回调、无 logger 注入、无 diag 通道**。构造签名也已核实：`lib/shadow-host-pre.js:43` `export function createShadowHost({ engine })`（**只解构 `engine`，无 logger 位**）；`lib/evidence-store-pre.js:98` `export class EvidenceEventStore`。

**⇒ 6 处拆成两组，改法不同：**

**组 1 · `lib/index.js` 三处（in-file，最简）** —— 直接换名 + 加 key：

```diff
-        try { diag('recall 语义臂择优降级: ' + String((eBest && eBest.message) || eBest).slice(0, 120)) } catch (_) {}
+        try { diagThrottled('recall:sem-degrade', 'recall 语义臂择优降级: ' + String((eBest && eBest.message) || eBest).slice(0, 120)) } catch (_) {}
```
```diff
-        try { diag('evidence-agg 降级为中性(impMap 空): ' + String((eImp && eImp.message) || eImp).slice(0, 140)) } catch (_) {}
+        try { diagThrottled('recall:imp-empty', 'evidence-agg 降级为中性(impMap 空): ' + String((eImp && eImp.message) || eImp).slice(0, 140)) } catch (_) {}
```
```diff
-      } catch (eTr) { try { diag('temporal-parse 降级(无时间臂): ' + String((eTr && eTr.message) || eTr).slice(0, 140)) } catch (_) {} }
+      } catch (eTr) { try { diagThrottled('recall:temporal-none', 'temporal-parse 降级(无时间臂): ' + String((eTr && eTr.message) || eTr).slice(0, 140)) } catch (_) {} }
```
**无新增 import**（同模块）。

**组 2 · `shadow-host-pre.js:228` + `evidence-store-pre.js:143`（跨文件）** —— 需先给两模块**注入一条节流 diag 通道**。**推荐做法：走 `opts` 注入，不改模块自身语义**：

```diff
  // lib/shadow-host-pre.js:43
- export function createShadowHost({ engine }) {
+ export function createShadowHost({ engine, onDiag = null }) {
```
```diff
  // lib/shadow-host-pre.js:228  (节流后再转出)
-         if (!paths) { console.error('[shadow-diag] no-paths'); stats.suppressed++; ... }
+         if (!paths) { reportDiag('shadow:no-paths', '[shadow-diag] no-paths'); stats.suppressed++; ... }
```
并在模块内加最小节流（**不依赖 index.js，保持模块自洽**）：
```js
  // lib/shadow-host-pre.js 内(闭包级)
  const _diagAt = new Map()
  function reportDiag(key, msg) {
    try {
      const now = Date.now()
      if (now - (Number(_diagAt.get(key)) || 0) < 300000) return
      _diagAt.set(key, now)
    } catch (_) {}
    if (typeof onDiag === 'function') { try { onDiag(key, msg) } catch (_) {} }
    else { try { console.error(msg) } catch (_) {} }   // 未注入时保持现有 console.error 行为(向后兼容)
  }
```
接线侧（`lib/index.js` 构造 `_shadowHost` 处）传 `onDiag: (key, msg) => diagThrottled(key, msg)`。同样处理 `evidence-store-pre.js:143`（该类是 `class`，走 `constructor(opts)` 或 `setDiag`）。

> **⚠️ 为什么不用 `console.error` + 外部节流**：直接改 `.length` 之类的正则替换会让两模块**失去自洽节流**（同一进程里若被实例化两次，节流表各自独立 ⇒ 仍会双写）。**在模块内持节流表**才是与 `index.js:863` 同源的语义。
> **⚠️ 保守备选（若不想动两模块签名）**：只做**组 1 的三处**（`index.js` in-file），把组 2 记为「需跨文件决策、单独立项」。**这仍解决 triage 点名的 recall 主路径 3 处**，且**零跨文件风险**。⇒ **两条路都合规，建议按批次容量选**：批次 A 做组 1（零风险），组 2 视是否愿意动两模块构造签名再定。

**守卫形状**：**源码文本断言即可（这类"调用点节流化"本就是形态约束）**，但要加**负向对照**防"改坏了却仍绿"。

**建议套件**：`tests/smoke/smoke-test-t9-diag-home-pre.mjs`（6,804 B —— 该套件已是"诊断面"专属，且**已在用对 `IDX` 源码做正则断言的手法**：triage 记 `:35` `assert(/_dshAutoMemoryRejectionStat/.test(IDX), ...)`）⇒ **天然归宿，新增断言即可**。

**断言写法（改坏必红，非真空）**

```js
const IDX = readFileSync('lib/index.js', 'utf8')
const SH  = readFileSync('lib/shadow-host-pre.js', 'utf8')
const EV  = readFileSync('lib/evidence-store-pre.js', 'utf8')

// ① 正断言：recall 三条走 diagThrottled，且**带 key**（不带 key 会退化成"所有 message 共享一个键"以外的错误用法）
ok(/diagThrottled\('recall:sem-degrade'/.test(IDX), 'P3-9 recall 语义臂降级已节流')
ok(/diagThrottled\('recall:imp-empty'/.test(IDX),  'P3-9 evidence-agg 降级已节流')
ok(/diagThrottled\('recall:temporal-none'/.test(IDX), 'P3-9 temporal-parse 降级已节流')

// ② **反断言（防"改回去"必红）**：这 3 条 message 不得再出现在裸 diag( 里
const naked = [...IDX.matchAll(/[^d]diag\('(recall 语义臂择优降级|evidence-agg 降级为中性|temporal-parse 降级)/g)]
ok(naked.length === 0, 'P3-9 recall 三条不得留有裸 diag（实得 ' + naked.length + '）')

// ③ 跨文件两处(若做了组 2)
ok(/reportDiag\('shadow:no-paths'/.test(SH), 'P3-9 shadow no-paths 已节流')
ok(!/console\.error\('\[shadow-diag\] no-paths'\)/.test(SH), 'P3-9 shadow 原裸 console.error 已消失')
ok(/reportDiag\('evidence:write-failed'/.test(EV), 'P3-9 evidence write-failed 已节流')
ok(!/console\.error\('\[evidence-store\] write-failed: '/.test(EV), 'P3-9 evidence 原裸 console.error 已消失')

// ④ **行为断言（真正的"非真空"证明）**：节流函数真的会压掉重复调用
//    用 index.js 内的 diagThrottled 不可直接 import ⇒ 断言其**可测语义**存在于源码且窗口 > 0
ok(/const w = Number\(windowMs\) > 0 \? Number\(windowMs\) : 300000/.test(IDX), 'P3-9 节流窗口默认 5 分钟（不可被改成 0）')
```

> **⚠️ 关于 ④ 的诚实标注**：`diagThrottled` 未导出 ⇒ **无法在守卫里做真行为调用**（同 P3-14 ④ 的困境）。⇒ **本条守卫是源码文本级的**（与 `smoke-test-t9-diag-home-pre.mjs` 的既有风格一致，属该套件已接受的证据形态）。**"改坏必红"由 ①②③ 的成对正/反断言保证**（改回去 ⇒ ②③ 红；改成不带 key ⇒ ① 红；把窗口改成 0 ⇒ ④ 红）。**这不是"执行零次迭代也通过"的真空断言——每条都是确定性的 `ok()`，不存在循环体为空而恒绿的情形。**

**风险标注**
- **是否热路径**：**是**（recall 每轮都跑）。但改动只是**把裸调用换成带节流的同义调用**：多一次 `Map.get`/`Map.set` + 一次数值比较，**无 IO、无分配（除首次）** ⇒ 性能影响不可测。
- **是否牵动既有断言**：**需核对 2 处**：
  - `tests/smoke/smoke-test-t9-diag-home-pre.mjs:35` / `:43` —— 断言对象是 `_dshAutoMemoryRejectionStat`（P3-7，**不在本工单范围**）⇒ **不冲突**。
  - 若组 2 改了 `createShadowHost({ engine })` 的签名 —— 需核对 `createShadowHostPre` 的**所有调用点**：本轮实测 `lib/index.js:38` 是 `import { createIndexSyncHostPre }`（**不同模块**），`createShadowHostPre` 的构造点在 `lib/index.js` 内（grep `_shadowHost = createShadowHostPre` **零命中** ⇒ 需施工者用 `createShadowHostPre(` 再 grep 一次确认调用形态）。**加 `onDiag = null` 默认值 ⇒ 对既有调用点向后兼容**（不传即走 `console.error` 原行为）。
- **是否需连带改别的文件**：**组 2 需改 3 个文件**（index.js 接线 + shadow-host-pre.js + evidence-store-pre.js）。**组 1 只改 1 个**。
- **⚠️ 范围外发现（建议单独立项，本工单不做）**：`lib/shadow-host-pre.js:152` `try { console.error('[shadow-audit] ' + lastAuditError) } catch (_) {}` —— 这是**第 7 处**同族未节流 `console.error`，triage 未点名。按"只改 6 个调用点、不做全仓替换"的纪律，**本工单不纳入**，但**应在白板留一条观察项**（`:152` 与 `:228` 同文件同性质，只修后者会让两行风格不一致）。

---

### 7 · P3-20② —— 设置端点对路径类键裸赋值

**当前锚点（复核）**

```js
// lib/index.js:11390-11410  ← /config 的 POST/PUT 分支全文
11390:           if (method === 'POST' || method === 'PUT') {
11391:             const body = await readJsonBody(req)
11392:             if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'invalid body' })
11393:             const allowed = Object.keys(DEFAULT_CONFIG)
11394:             const patch = {}
11395:             for (const key of allowed) if (body[key] !== undefined) {
11396:               // semanticEngineMode 枚举门:非法值直接丢弃(fail-closed,不落盘)
11397:               if (key === 'semanticEngineMode' && !['auto', 'lexical', 'js', 'python'].includes(body[key])) continue
11398:               // 群反馈第 4 条:排除来源必须是「非空字符串数组」—— 否则 {}/字符串/含非字符串元素的数组
11399:               // 会在注入侧被静默转成空排除集(配了却不起作用,且无从察觉) ⇒ 非法值一律丢弃。
11400:               if (key === 'injectExcludeSources') {
11401:                 if (!Array.isArray(body[key])) continue
11402:                 if (body[key].some((x) => typeof x !== 'string')) continue
11403:                 patch[key] = body[key].map((x) => x.trim()).filter(Boolean)
11404:                 continue
11405:               }
11406:               patch[key] = body[key]                      // ← ★ 其余键裸赋值
11407:             }
11408:             const saved = await engine.saveConfig(patch)
11409:             writeJson(res, 200, { config: saved.config, migrated: saved.migrated || '' })
11410:             return
```

**是否仍成立**：✅ **仍成立**。

- **只有 2 个键有类型/范围判据**：`semanticEngineMode`（`:11397` 枚举白名单）、`injectExcludeSources`（`:11400-11405` 数组 + 元素字符串 + trim/filter）。**其余键全部走 `:11406` 裸赋值**。
- **两个路径类键确实在键集内**：`lib/index.js:268` `userMemoryDir: '~/.dsh/memory',`、`lib/index.js:272` `memoryRoot: '~/.dsh/memory/workspaces',` —— 二者均在 `DEFAULT_CONFIG`（`:11393` `Object.keys(DEFAULT_CONFIG)`）内 ⇒ 一次 POST 即可改。**这是"记忆落点可被单次请求移走"的硬事实。**
- **影响面（复核同行）**：`memoryRoot` 被用于 `lib/index.js:2152`（`projectDirOf` 的根）、`:4434`、`:7207`（recall 源文件定位）；`userMemoryDir` 被用于 `:2185`。⇒ 改错会让后续 append/rewrite/recall **落点在记忆区之外**，且**无告警**。**用户可感知面成立。**
- **定级（与 triage 一致）**：**护栏缺失**，非提权 —— `:11390` 所在路由有 loopback 限制（对照同文件 `:11420` `if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })`）⇒ 与 GUI 同信任域。

**最小改动**（在 `:11405` 的 `injectExcludeSources` 块之后、`:11406` 之前插入一个分支）

```diff
               if (key === 'injectExcludeSources') {
                 if (!Array.isArray(body[key])) continue
                 if (body[key].some((x) => typeof x !== 'string')) continue
                 patch[key] = body[key].map((x) => x.trim()).filter(Boolean)
                 continue
               }
+              // ★P3-20②:路径类键 fail-closed 判据 —— 必须是非空字符串,且展开后必须落在 dshHome() 之下。
+              //   否则一次 POST 就能把后续 append/rewrite/recall 的落点移出记忆区(且无任何告警)。
+              if (key === 'memoryRoot' || key === 'userMemoryDir') {
+                const v = body[key]
+                if (typeof v !== 'string' || !v.trim()) continue            // 非空字符串
+                let abs = ''
+                try { abs = engine.expandUserPath(v) || '' } catch (_) { abs = '' }
+                if (!abs) continue
+                const home = path.resolve(dshHome())
+                const rel = path.relative(home, path.resolve(abs))
+                // 空 rel ⇒ 就是 dshHome 自身(拒绝); 以 .. 开头或是绝对路径 ⇒ 越界(拒绝)
+                if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
+                patch[key] = v
+                continue
+              }
               patch[key] = body[key]
```

**关键实现依据（本轮已核实）**
- `dshHome()` 是 `lib/index.js:846` 的**模块级函数** ⇒ 与 `:11393` 同一文件、同一作用域，**可直接调用，无需 import**。
- `engine.expandUserPath(p)` 是实例方法（`lib/index.js:2129-2134`），**已处理 `~` 展开**：
  ```
  2129:   expandUserPath(p) {
  2130:     if (typeof p !== 'string' || !p) return undefined
  2131:     if (p === '~') return homedir()
  2132:     if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homedir(), p.slice(2))
  2133:     return path.resolve(p)
  2134:   }
  ```
  ⇒ **必做**：默认值就是 `'~/.dsh/memory/workspaces'`，**不展开会被误判越界**。⚠️ **这正是实现该判据最容易踩的坑**（直接 `v.startsWith(dshHome)` 会让默认值过不了）。
- **判据必须用 `path.relative` 而非字符串前缀**：`dshHome()` 的兄弟目录（如 `~/.dsh/memory-backup`）以 `~/.dsh/memory` 为前缀 ⇒ 纯 `startsWith` 会**误放行**。`path.relative` + 拒绝 `..` 开头 / `isAbsolute(rel)` 是标准写法（**Windows 下盘符不同时 `path.relative` 返回绝对路径 ⇒ 第三个条件 `path.isAbsolute(rel)` 专为这种情况而设**，不能省）。
- `path` 在 `lib/index.js` 的作用域内可用（全文件大量 `path.join(dshHome(), ...)`，如 `:11679`）⇒ **无需 import**。

**守卫形状**：**必须用真端点调用**（该仓已有现成手法），且必须**成对正/反**。

**建议套件**：`tests/smoke/smoke-test-context-observer.mjs` —— **它已有可直接复用的 config 路由 POST 手法**（本轮已读）：
- `:381` `const configRoute = hp.registeredRoutes.find((r) => r.path === '/api/dsh-auto-memory-pre/config')`
- `:383` `const res = { writeHead() {}, end(b) { lastBody = JSON.parse(b) } }`
- `:384-388` `await configRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, method: 'POST', url: '...', [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify({ associativeMemoryEnabled: false })) })() } }, res)`
- `:389` `if (lastBody.config.associativeMemoryEnabled !== false) throw new Error('disable POST failed')`

（次选 `tests/smoke/smoke-test-m3b3-pre.mjs:47-54`，同款手法。**注意**：`smoke-test-context-observer.mjs` 的 `:39` 用 `memoryRoot: path.join(ws, '.memory-root')` 起 harness，**临时 DSH_HOME 隔离**，符合"真实记忆零接触"纪律。）

**断言写法（改坏必红，非真空）**

```js
const post = async (body) => {
  const res = { writeHead() {}, end(b) { lastBody = JSON.parse(b) } }
  await configRoute.handler({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    method: 'POST', url: '/api/dsh-auto-memory-pre/config',
    [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(body)) })() },
  }, res)
  return lastBody.config
}

// ① 基线：先读一次，证明端点真的通(防止后面"全被拒"也绿)
const before = (await getConfig()).memoryRoot
ok(typeof before === 'string' && before.length > 0, 'P3-20② 前置：初始 memoryRoot 可用（' + before + '）')

// ② 反断言：越界路径必须被丢弃（改坏必红的核心 —— 4 种攻击形态逐个打）
for (const bad of ['/etc/passwd', 'C:\\Windows\\Temp', '../../escape', '~/', '']) {
  const cfg = await post({ memoryRoot: bad })
  ok(cfg.memoryRoot === before, 'P3-20② memoryRoot 拒绝越界值 ' + JSON.stringify(bad) + '（实得 ' + cfg.memoryRoot + '）')
}
// 非字符串型
for (const bad of [123, null, [], {}, true]) {
  const cfg = await post({ memoryRoot: bad })
  ok(cfg.memoryRoot === before, 'P3-20② memoryRoot 拒绝非字符串 ' + JSON.stringify(bad))
}

// ③ **正断言（防"一刀切全拒"也绿）**：合法且落在 dshHome 之下的值必须被接受
const legal = path.join(process.env.DSH_HOME || '', 'memory', 'workspaces-alt')
const cfg2 = await post({ memoryRoot: legal })
ok(cfg2.memoryRoot === legal, 'P3-20② 合法 dshHome 内路径被接受（实得 ' + cfg2.memoryRoot + '）')
// 复原，避免污染后续断言
await post({ memoryRoot: before })

// ④ 两个键都要覆盖(userMemoryDir 同款；防"只改了 memoryRoot")
for (const bad of ['/tmp/x', '../../x']) {
  const cfg = await post({ userMemoryDir: bad })
  ok(cfg.userMemoryDir !== bad, 'P3-20② userMemoryDir 拒绝越界 ' + JSON.stringify(bad))
}

// ⑤ **防回归的负向对照**：非路径类键必须仍能自由改（证明判据没有误伤全键集）
const cfg3 = await post({ injectBudgetChars: 4321 })
ok(cfg3.injectBudgetChars === 4321, 'P3-20② 非路径键仍可正常写入（判据未误伤）')
```

> **为什么 ①③⑤ 不可省**：只写 ② 的话，"把 `:11406` 整行改成 `continue`"（所有键全拒）会让 ② 全绿而功能全废。①③⑤ 把"只挡路径类键的越界值"钉死。**①②③⑤ 每条都是确定性 `ok()`/`throw`，不存在零迭代真空通过。**

**风险标注**
- **是否热路径**：**否**（设置页手动保存）。判据只加 2 次字符串比较 + 1 次 `path.relative`（仅在改这两个键时进入该分支）。
- **是否牵动既有断言**：**需核对 1 类**。若有既有套件**通过 config 路由把 `memoryRoot` 改成临时目录**（测试隔离的常见做法），改动会使其被拒 ⇒ **红**。本轮实测：`smoke-test-context-observer.mjs:39`、`smoke-test-consolidate-isolation.mjs:12`、`smoke-test-m3b3-pre.mjs:23`、`smoke-test-f1-pre.mjs:22`、`smoke-test-m43-pre.mjs:53`、`smoke-test-graph-mode-pre.mjs:51` 等**都是在构造 harness 时直接传配置对象**（不走 HTTP 路由）⇒ **大概率不受影响**。⚠️ **但本轮未逐条确认这些套件是否另有"经由 HTTP 改 memoryRoot"的断言** ⇒ **施工后必须跑全量确认，并把该风险记入回归观察清单**（置信度：中高）。
  - **若确有冲突**：把判据从"必须在 `dshHome()` 之下"放宽为"必须与 `dshHome()` **同盘**且非空"，或为测试引入 env 旁路（`DAM_ALLOW_ROOT_OVERRIDE=1`）—— **但这会削弱护栏，不推荐**；优先改测试（改用直接构造配置）。
- **是否需连带改别的文件**：**否**（判据用到的 `dshHome()` 与 `engine.expandUserPath` 与 `path` 均在同文件可用）。

---

## 三、额外核查 · `lib/m7-index-sync-host-pre.js` 的 `enabledKeys` / `capturedPathKeys` 是否死集合

**结论：✅ 是死集合（从不写入）。** 证据如下。

### 3.1 该文件内全部命中（3 处，无第 4 处）

| 行 | 原文 | 性质 |
|---|---|---|
| `lib/m7-index-sync-host-pre.js:36` | `const enabledKeys = new Set()  // 显式 disable 的 key(同一 miv 内不再重试;miv 变化自动解除)` | **声明**（空集合） |
| `lib/m7-index-sync-host-pre.js:200` | `capturedPathKeys: [...enabledKeys].slice(0, MAX_PATH_KEYS),` | **读**（`debugView` 的投影） |
| `lib/m7-index-sync-host-pre.js:238` | `enabledKeys.clear()` | **清**（`dispose(reason)` 内） |

**关键判据：该文件内 `.add(` 命中数 = 0（实测 grep 返回「No matches found」）。**
⇒ 集合自 `:36` 创建起**从未被写入任何元素**，`:238` 的 `clear()` 是对空集合的空操作 ⇒ `:200` 的 `[...enabledKeys]` **恒为 `[]`** ⇒ **`capturedPathKeys` 恒 `[]`**。

补充证据：`:28` `const MAX_PATH_KEYS = 8`（投影上限 8，但因集合恒空而永不生效）；`:190-205` 的 `debugView()` 整体在 `if (!enabled())` 之后，`capturedPathKeys` 只是其中一个字段——**删掉它不影响 `debugView` 其余字段**。

### 3.2 全仓命中点清点（含 `tests/`、`tools/`，已按要求全量扫）

| 位置 | 是什么 | 是否构成「写入 `enabledKeys`」 |
|---|---|---|
| `lib/m7-index-sync-host-pre.js:36/200/238` | **pre 线真身**（上表） | 否（声明/读/清） |
| `lib/m7-index-sync-host.js:35/169/180` | **同名 plain 文件 = 发布构建产物**（与 pre 线同形） | 否（且改它零运行时效果） |
| `artifacts/_orig-m7-index-sync-host.js:36/193/231` | 上游原件备份 | 否 |
| `lib/context-host-pre.js:794` | **⚠️ 同名不同物**：`capturedPathKeys: [...pathsByKey.keys()].slice(0, 8)` —— 取自 `pathsByKey`，**这是活的、非空的那个**（与 P3-3(a) 同源） | 不相关 |
| `lib/context-host.js:644` | 上者的 plain 产物 | 不相关 |
| `tests/smoke/smoke-test-m78-host-pre.mjs:111` | `ok(cb.capturedPathKeys && cb.capturedPathKeys.length >= 1, ...)` —— `:103` `const cb = am2.contextBridge` ⇒ **断言的是上表 context-host 那个**，**不是** index-sync 的 | 不相关 |
| `tests/smoke/smoke-test-capture-paths-pre.mjs:87` | `ok(fake._calls.length === 0, 'B6 未就绪时零注册（不污染 pathsByKey）')` —— 提到 `pathsByKey`，**未涉及 `enabledKeys`** | 否 |
| `docs/internal/UPSTREAM-ISSUE-PR-TRIAGE-20260919.md:85` | CB-10 条目自述「`enabledKeys` 声明后**全仓无 `.add`**」 | 文档，非代码 |
| `docs/internal/TODO-NEXT-20260922.md:64/121` | #107 死集合待办 + D4 动作项 | 文档 |
| `docs/PYTHON-SIDECAR-CONTRACT.md:524/530` | **⚠️ 此文档描述的 `capturedPathKeys(≤8)` 属 `lib/context-host-pre.js` 的 live-parity 诊断**（原文点名 "lib/context-host-pre.js") ⇒ **不是** index-sync 那个 | 文档，指另一处 |
| `artifacts/_gh-reply-close-batch2.mjs:251`、`artifacts/_gh-batch2/issue-76.md:5/13`、`artifacts/_gh-batch2/INDEX.md:3` | 上游回帖草稿 / issue 原文副本 | 非运行时 |

**⇒ 全仓不存在任何 `enabledKeys.add(...)`、`enabledKeys = ...`（重新赋值）、也不存在把 `capturedPathKeys` 从别处回写的路径。**

### 3.3 结论与建议

**结论：是死集合（`enabledKeys` 从不写入；`capturedPathKeys` 投影恒 `[]`）。**

**建议：删除（而非保留）。理由三条：**

1. **零信息量**：恒空投影对一个"诊断盲区"问题毫无贡献 —— 它存在的全部效果是让 `/state` 面板上出现一个**永远显示 `[]` 的字段**，反而会误导排障者以为「没有采集到路径」是故障。
2. **语义自相矛盾**（本条已在 issue #76 的 CB-10 被点名，本轮复核成立）：`:36` 注释说它是「**显式 disable** 的 key」（写入语义：记录被禁用的键），但 `:200` 把它投影成 `capturedPathKeys`（读取语义：**采集到的**路径键）。**一个集合不可能同时是"禁用名单"和"采集清单"** ⇒ 字段名与注释本就不一致，说明它是半成品。
3. **删了安全**：唯一可能受影响的断言是 `smoke-test-m78-host-pre.mjs:111`，而**已核实它断言的是 `am2.contextBridge.capturedPathKeys`（活的、≥1）**，不是 `ih.capturedPathKeys` ⇒ **删 index-sync 的投影不会让该套件变红**。

**具体删除动作（3 行）**
```diff
-  const enabledKeys = new Set()  // 显式 disable 的 key(同一 miv 内不再重试;miv 变化自动解除)
```
```diff
-      capturedPathKeys: [...enabledKeys].slice(0, MAX_PATH_KEYS),
```
```diff
-    enabledKeys.clear()
```
连带可删：`:19` 文件头注释里的 `capturedPathKeys(≤8)、` 一项（**需施工时读 `:17-22` 确认原文**——本轮只确认了 `:19` 含该字样）。
⚠️ `MAX_PATH_KEYS`（`:28`）在删除后若变成唯一引用点为零的常量，一并删（**需施工时 grep 确认无其它引用**）。

**守卫形状**（"改坏必红"= 防止有人日后又加回一个死投影；**也防止有人把投影"修成"活的却接错数据源**）

**建议套件**：新增 `tests/smoke/smoke-test-p3-no-dead-projection-pre.mjs`（或并入 P3-14 建议的新卫生套件，两者都是"静态卫生"性质，**可合成一个 `smoke-test-p3-static-hygiene-pre.mjs`**）。

```js
const M7 = readFileSync('lib/m7-index-sync-host-pre.js', 'utf8')
// ① 死集合不得复活（若有人加回 enabledKeys，本条必红）
ok(!/enabledKeys/.test(M7), 'P3-m7 死集合 enabledKeys 已彻底移除')
// ② 投影不得复活
ok(!/capturedPathKeys/.test(M7), 'P3-m7 恒空投影 capturedPathKeys 已移除')
// ③ 反向对照：**同名的活投影必须仍在 context-host-pre.js**(防止"一刀切删两个"造成功能回退)
const CH = readFileSync('lib/context-host-pre.js', 'utf8')
ok(/capturedPathKeys: \[\.\.\.pathsByKey\.keys\(\)\]\.slice\(0, 8\)/.test(CH), 'P3-m7 context-host 的活投影仍在（未被误删）')
```

> **为什么 ③ 必写**：`capturedPathKeys` 在**两个文件里同名**。若守卫只写 ①②，施工者一个 `replace_all` 就会**连活的那个一起删**，导致 `smoke-test-m78-host-pre.mjs:111` 红——但那是**下游**才发现。③ 把"只删死的、留活的"钉死在本工单的守卫里。**三条均为确定性 `ok()`，不存在零迭代真空通过。**

**风险标注**
- **是否热路径**：**否**（`debugView` 只在 `/state` 面板被读时调用；`clear()` 只在 dispose 时）。
- **是否牵动既有断言**：**已核实不受影响**（见 3.3 第 3 点）。**唯一的连带面是 `docs/PYTHON-SIDECAR-CONTRACT.md:524/530`** —— 该处文档描述的是 `context-host-pre.js` 的那个（活的），**删 index-sync 的不会让文档失真**；但**若施工者误删了 context-host 的那个，文档立刻失真** ⇒ 这正是 ③ 的守卫价值。
- **是否需连带改别的文件**：**否**（`lib/m7-index-sync-host.js` 是发布产物，下次发版自动同步）。

---

## 四、批次与回归建议

### 4.1 文件 → 条目映射

| 文件 | 涉及条目 | 改动量（估） |
|---|---|---|
| `lib/index.js` | **P3-6**（1 行）、**P3-1②**（1 行）、**P3-9 组1**（3 行）、**P3-20②**（~8 行）、（若做 P3-9 组2 则 +1 行接线） | **~14 行** |
| `lib/context-host-pre.js` | **P3-3(a)**（1 行） | 1 行 |
| `lib/config-io-pre.js` | **P3-12**（1 import + 1 行） | 2 行 |
| `lib/semantic-js-pre.js` | **P3-14**（~6 行 + 3 处替换） | ~10 行 |
| `lib/shadow-host-pre.js` | **P3-9 组2**（1 签名 + ~8 行 helper + 1 行调用） | ~10 行 |
| `lib/evidence-store-pre.js` | **P3-9 组2**（同上） | ~10 行 |
| `lib/m7-index-sync-host-pre.js` | **额外核查**（删 3 行） | 3 行 |
| `docs/HANDBOOK.md` | P3-6 配套文档（1 句） | 文档 |

### 4.2 两条施工路线（择一）

**路线 α（保守，推荐）—— 2 次回归**
- **批次 A**（只动 `lib/index.js` 一个文件）：P3-6 + P3-1② + P3-9 组1 + P3-20② ⇒ **无跨文件风险**，一次全量回归。
- **批次 B**（4 个文件 + 1 删除）：P3-3(a) + P3-12 + P3-14 + P3-9 组2 + m7 死集合删除 ⇒ 一次全量回归。
- **理由**：跨文件改动（P3-9 组2 动两个模块签名、P3-20② 可能撞测试隔离）**归因成本最高**，单独一批能把"红是谁引起的"一次收敛。

**路线 β（快）—— 1 次回归**：7 条 + m7 删除全做完，跑一次全量。
- **前置条件**：认可「一条红需逐条二分」的代价。**不推荐**，因为 P3-20② 与 P3-9 组2 各有 1 个未完全排除的既有断言冲突面（见 §二 4.2 与 §二 6 的风险标注），一次全量出红时**无法快速区分是"改动错"还是"撞了既有断言"**。

### 4.3 回归观察清单（施工后必看）

1. **`smoke-test-context-observer.mjs`** —— 同时被 P3-1②（新增调用）与 P3-20②（新增 POST 断言）触碰，两处都写在同一个 `try/finally` 内 ⇒ **本套件是最高风险点**。
2. **`smoke-test-m78-host-pre.mjs:111`** —— `capturedPathKeys` 同名双投影，m7 删除的**误伤探测器**。
3. **`smoke-test-capture-paths-pre.mjs:87`** —— P3-3(a) 的直接相关套件。
4. **`smoke-test-t8-configio-pre.mjs`** / **`smoke-test-issue48.mjs`** —— P3-12 的相关套件。
5. **`smoke-test-t9-diag-home-pre.mjs`** —— P3-9 的断言落点（同时也是 P3-7 的落点，**P3-7 不在本工单，勿顺手动**）。
6. **`smoke-test-m3b3-pre.mjs` / `smoke-test-f1-pre.mjs` / `smoke-test-m43-pre.mjs` / `smoke-test-consolidate-isolation.mjs` / `smoke-test-graph-mode-pre.mjs`** —— 全部构造 `memoryRoot: path.join(ws, ...)` 的套件；**P3-20② 若被收紧，需确认它们不走 HTTP 改这个键**（本轮判定"构造期直传配置 ⇒ 不受影响"，置信度中高，**回归时重点确认**）。

### 4.4 三个必须现场确认的施工前提（本工单无法代劳）

| 编号 | 事项 | 为什么本工单不能定 |
|---|---|---|
| **C1** | `lib/semantic-js-pre.js:170-195` 的**数组上下文** | 本轮只确认了 `:183` 单行原文；`concat(...)` 的落点取决于该数组其余成员与结尾形态 |
| **C2** | `createShadowHostPre(` 的**全部调用点** | `createShadowHost({ engine, onDiag = null })` 加默认值向后兼容，但需确认调用方是否用位置参数或解构别名 |
| **C3** | `lib/m7-index-sync-host-pre.js:17-22` 的**文件头注释原文** + `MAX_PATH_KEYS` 的**其它引用** | 删投影后需判断该注释项与常量是否成为孤立引用 |

---

## 五、取证命令（便于 Lead 复核，全部只读）

```powershell
# 1) 7 条的当前锚点一次扫清(行号直接对照本工单)
Select-String -Path lib/index.js -Pattern "queueLength: q\.length|if \(!runtime \|\| !callId\)|recall 语义臂择优降级|evidence-agg 降级为中性|temporal-parse 降级|patch\[key\] = body\[key\]" | ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }

# 2) P3-9 跨文件两处 + 范围外第 7 处
Select-String -Path lib/shadow-host-pre.js,lib/evidence-store-pre.js -Pattern "console\.error\('\[(shadow-diag|shadow-audit|evidence-store)" | ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }

# 3) P3-3(a)：pathsByKey 全命中(证明无 delete/clear) + disposeSession 不存在
Select-String -Path lib/context-host-pre.js -Pattern "pathsByKey|disposeRuntime|disposeAll|disposeSession" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }

# 4) P3-12：三处 renameSync + 确认 retryRename 未接线
Select-String -Path lib/config-io-pre.js -Pattern "renameSync|retryRename|fs-retry-pre" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }

# 5) P3-14：三处开发树路径 + 发布转换表 + gitignore 排除
Select-String -Path lib/semantic-js-pre.js -Pattern "m7-live-pre" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
Select-String -Path tools/release.mjs -Pattern "semantic-js-pre" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
Select-String -Path .gitignore -Pattern "m7-live-pre" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }

# 6) m7 死集合：全仓命中 + 证明无 .add(
Select-String -Path lib/m7-index-sync-host-pre.js -Pattern "enabledKeys|capturedPathKeys|\.add\(" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
Select-String -Path lib/*.js,tests/smoke/*.mjs,tools/*.mjs -Pattern "enabledKeys" | ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }

# 7) P3-20②：确认两个路径键在 DEFAULT_CONFIG 内 + 只有 2 个键有判据
Select-String -Path lib/index.js -Pattern "^\s+(memoryRoot|userMemoryDir|injectExcludeSources|semanticEngineMode):" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }

# 8) 漂移基线(证明 index.js 在 triage 之后被改过)
Get-ChildItem lib/index.js,docs/internal/ISSUE117-TRIAGE-20260922.md | Select-Object Name,LastWriteTime
```

---

## 六、一页纸摘要（给 Lead）

| 条目 | 仍成立 | 锚点 | 最小改动 | 守卫落点 | 风险 | 批次 |
|---|---|---|---|---|---|---|
| P3-6 | ✅ | `index.js:11685` | `q.length` → `q` | 新 `smoke-test-heartbeat-queue-pre.mjs`（**可做真行为断言**） | 极低，**非热路径** | A |
| P3-1② | ✅ | `index.js:1631` | 补 `runtime.disposed` | `smoke-test-context-observer.mjs`（复用 P3f 段） | 低，**热路径但零开销** | A |
| P3-3(a) | ✅ | `context-host-pre.js:818-822` | 补 `pathsByKey.delete(...)` | `smoke-test-capture-paths-pre.mjs` | 低，**2 处断言已核实不受影响** | B |
| P3-12 | ✅ | `config-io-pre.js:97` | `renameSync` → `await retryRename` + import | `smoke-test-t8-configio-pre.mjs` | 低，**约束：只改 async 版** | B |
| P3-14 | ✅ | `semantic-js-pre.js:79/95/183` | env 闸（或直删） | 新 `smoke-test-p3-release-hygiene-pre.mjs` | 极低，**用户侧行为零变化** | B |
| P3-9 | ✅ | `index.js:6259/6298/6311` + `shadow:228` + `evidence:143` | 组1 直接换；**组2 需注入 diag 通道** | `smoke-test-t9-diag-home-pre.mjs` | 中，**跨文件（组2）** | A(+B) |
| P3-20② | ✅ | `index.js:11406` | 加路径类键 fail-closed 判据（**必须 `expandUserPath` 展开**） | `smoke-test-context-observer.mjs`（复用 config 路由手法） | 中，**可能撞测试隔离** | A |
| m7 死集合 | ✅ **是死集合** | `m7-index-sync-host-pre.js:36/200/238` | 删 3 行 | 新静态卫生守卫（含"活投影仍在"的反向对照） | 低，**同名双投影需防误伤** | B |

**净改动面：7 个 `lib/` 文件 + 1 个文档 + 4 个守卫套件（其中 2 个是净增、2 个是增断言）；总计约 50 行生产代码。**

**三条需用户/Lead 拍板的取舍（非技术阻塞）**
1. **P3-9 组2 做不做** —— 做则需改 `shadow-host-pre.js` / `evidence-store-pre.js` 的构造签名（跨文件）；不做则 recall 主路径三处已修、跨文件两处留观察项。
2. **P3-14 用 env 闸还是直删** —— env 闸保住维护者离线调试能力，直删更彻底。
3. **m7 死集合删还是留** —— 本轮建议删（零信息量 + 语义自相矛盾 + 已核实不撞断言）；若产品口径要保留"未来可能填充"的位置，则留但**必须在守卫里断言它恒空**，避免被当成真诊断字段读。



