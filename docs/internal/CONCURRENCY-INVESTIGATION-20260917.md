# 语义引擎并发调查报告（2026-09-17）

> **触发**：用户报告「同时有两个模型在跑时，貌似会引起语义模型冲突，现在谁也没法注入了」。
> **方法**：静态读码 + 进程/产物实测 + 本会话自身注入快照取证。
> **纪律**：结论附代码行号证据；推断显式标注；未验证项单列。

---

## 0. 结论先行

1. **不是算力不足。** 语义 worker 在实测采样点 **CPU 增量为 0.00s / 3s**（在闲着），内存 3.4GB 稳定，16 逻辑核 / 31GB 物理内存。算力完全够跑多份。
2. **是并发状态管理缺陷**：引擎里有 **3 个"单槽"共享点**被设计成"全局只此一份"，两会话交替投递时**互相覆盖**。
3. **因此"谁也没法注入"是可解释的确定性后果**，不是玄学冲突。
4. **建议：不是"只开一个"，而是把这 3 个点位改成按会话分片**——工作量可控（估计半天到一天），改完可真正并行。若短期不想动，则**明确承认局限并要求单开**。

---

## 1. 活证据：本会话正在降级（此刻）

用户本轮对话注入快照里实际出现：

```
[降级] 语义索引未就绪（sync-in-progress）· 本轮降级为词法命中 + 常驻目录，未静默丢弃注入
[降级] 命中投影未复用（投影来自其它工作区）· 本轮不下探 Tier-1，仅常驻目录
[闸门] 本轮无语义命中（no-hit）→ 仅目录层，未下探 Tier-1/Tier-2
```

**第二行是本次调查的决定性线索**：「投影来自**其它工作区**」—— 说明引擎手里那份命中投影，
此刻属于**另一个会话的工作区**，不是当前这个。这正是单槽覆盖的直接表征。

---

## 2. 三个单槽共享点（根因，带行号）

### 2.1 `engine._tierGateHits` —— 命中投影单槽 ★主因

```js
// lib/activation-host-pre.js:157
engine._tierGateHits = {          // ← 整体覆盖，无 key，全局只此一份
  sessionId, agentId, workspaceKey, at, question,
  contextVersion, miv, observationId, requestKey,
  hits: [...].slice(0, 8),
}
```

- 写：`activation-host-pre.js:157`（每次激活投递都**整份覆盖**）
- 读：`index.js:4720` `const gh = this._tierGateHits || null`
- 复用门：`lib/tier-layer-inject-pre.js` 的 `selectReusableTierHitsPre` —— 逐项比对
  `sessionId/workspaceKey/miv/contextVersion` **四元组**，不匹配即判"不复用"

**行为**：A 会话投递 → 槽里是 A；B 会话投递 → 槽里变 B（覆盖 A）；A 下一轮来取 → 四元组不匹配
⇒ `[降级] 命中投影未复用（投影来自其它工作区）` ⇒ A **不下探 Tier-1**，只剩目录层。

> **推断（非结论）**：这解释了用户说的"谁也没法注入"。严格说是**语义命中层被饿死**，
> 目录层仍在注入（故本会话仍能读到记忆，只是没有 Tier-1 下探与语义命中）。

### 2.2 `mivCache` —— 语料版本缓存单槽

```js
// lib/activation-host-pre.js:88-111
let mivCache = ...                       // 模块内单变量
function currentMiv(workspaceKey) {
  ...
  mivCache = { wsRef: ws, miv: res.snapshot.memoryIndexVersion }   // :102 覆盖
  ...
  if (mivCache.wsRef === ws) return mivCache.miv                   // :108 只认最后一个 ws
  return null                                                      // :109 否则 null
}
function setMiv(workspaceKey, miv) { mivCache = { wsRef: ..., miv } }  // :111 覆盖
```

**行为**：两个工作区来回切 ⇒ 每次都要重建语料快照（缓存必然 miss），M7 索引同步被反复触发。

### 2.3 `lastIndexDegrade` —— 降级标注单槽（跨会话污染）

```js
// lib/context-host-pre.js:108
let lastIndexDegrade = null
// :360  任何会话的 index-not-ready 都写这里（带 sessionId 但读方不看）
lastIndexDegrade = { reason: indexNotReady, at: Date.now(), sessionId: ... }
// :361  并导出到 engine._lastIndexDegrade
```

```js
// lib/index.js:4740  读方只判 10 分钟时间窗，**不判会话**
const indexNotReady = dg && Date.now() - (Number(dg.at) || 0) < 10 * 60000 ? dg.reason : null
```

**行为**：B 会话遇到索引未就绪 ⇒ 写进全局槽 ⇒ **A 会话接下来 10 分钟的注入里
也会被标注"索引未就绪"**，哪怕 A 自己完全正常。这是**跨会话假降级**。

### 2.4 `engine._lastTierQuery` —— 本轮 query 单槽（第四个，补充确认）

```js
// lib/context-host-pre.js:554  整体覆盖
engine._lastTierQuery = { at: Date.now(), sessionId: ..., text: String(jsDecideQueryText).slice(0,1200) }
```

- 写：`context-host-pre.js:554`
- 读：`activation-host-pre.js:154-156` —— 有**会话比对**（`lq.sessionId === req.sessionId`）+ 120 秒窗，
  不匹配才退回 `req.triggerText`

**行为**：读取侧已有会话门，**危害低于 2.1**；但写入侧仍是无条件覆盖 ⇒ 当 A、B 交替投递时，
A 的 query 会先被 B 覆盖、读取侧再因会话不匹配而退回 `triggerText`（语义等而下之）。
**建议一并纳入方案 A 分片**。

---

## 3. 设计正确的部分（不需要改）

| 组件 | 作用域 | 判定 |
|---|---|---|
| `readyCache` / `inFlight`（`m7-index-sync-host-pre.js:34-35`） | `Map`，key = `wsRef\|scope` | ✅ **多槽**，天然支持多工作区 |
| `context-host` 的 `states`（`:95`） | `WeakMap`：runtime → state | ✅ per-runtime |
| worker 侧索引（`python/worker_pre_v1.py:137`） | `self.derived = {}`，key = `(workspaceRef, scope)` | ✅ **多份**，支持多工作区 |
| `engine.state`（`index.js:1023-1028`） | `AsyncLocalStorage` + per-runtime，default runtime 仅镜像路径字段 | ✅ per-runtime（:4118-4131 已标注 mirror 语义） |

**结论**：架构**本来就是奔着多工作区设计的**，"谁也没法注入"是三处**遗漏分片**的实现细节，
不是架构性错误。这是"可以扩展"，不是"必须推倒"。

---

## 4. 算力账（实测）

| 项 | 实测值 | 判定 |
|---|---|---|
| CPU | 16 逻辑核 | 充裕 |
| 物理内存 | 31.1 GB | 充裕 |
| **可用内存** | **5.4 GB** | ⚠️ **偏紧**（worker 独占 3.4GB） |
| GPU | RTX 4070 Ti SUPER（报 4GB VRAM） | 可用（一期未启用 GPU 精排） |
| python worker | 1 个逻辑 worker（父 5MB + 子 3392MB，00:49 启动） | **单例，模型常驻** |
| worker CPU | **3 秒采样增量 0.00s** | **在闲着 → 不是算力瓶颈** |
| node 进程 | 6 个（最大 811MB） | 正常 |

**结论**：跑两个会话的**推理/嵌入算力足够**；真正的稀缺资源是**内存（可用 5.4GB）**。
若有两个"朋友圈"（两套独立 DSH_HOME 各起 worker），每个 worker 再加 ~3.4GB ⇒ **会触顶**。
但**同一 DSH 内两个会话共享一个 worker**，内存不翻倍 ⇒ **这才是正确姿势**。

---

## 5. 关联已知问题

`docs/internal/TODO-GRAPH.html` 的 **P0-4e** 卡片（状态：**已实测复现**，未修）已记录同源问题：

> 索引同步防抖：持续写入会让语义索引永远不就绪（实测卡死 20 分钟）
> 成因：语料身份是整份哈希（miv），最近每轮都在写记忆 ⇒ 语料一直变 ⇒ 新 miv 的全量重嵌还没跑完，
> 下一轮又变 ⇒ 重建永远追不上

**本次调查补充**：并发会话会**放大**该效应 —— 因为 §2.2 的 `mivCache` 单槽使两工作区互相踢缓存，
miv 变化频率进一步上升 ⇒ 更容易永久不就绪。**修 #2.2 是修 P0-4e 的前置条件。**

另：`debounce` / `防抖` / `coalesce` 在 `m7-index-sync-host-pre.js` 与 `context-host-pre.js`
中 grep **命中 0** ⇒ 防抖确实未实现（与 P0-4e 卡片一致）。

---

## 6. 建议（三条路，按推荐度）

### 方案 A（推荐）：分片化三处单槽 —— "可扩展"
把 `_tierGateHits` / `mivCache` / `lastIndexDegrade` 从单变量改成 `Map<sessionKey, value>`：

| 点位 | 改法 | 风险 |
|---|---|---|
| `_tierGateHits` | `Map<sessionId, projection>` + 读取时按当前 sessionId 取 | 低（读取点仅 `index.js:4720` 一处） |
| `mivCache` | `Map<wsRef, miv>` | 低（局部函数，两处写） |
| `lastIndexDegrade` | `Map<sessionId, degrade>` + 读方按会话取 | 低（读方一处） |
| `_lastTierQuery` | `Map<sessionId, query>`（与上同理，顺带修） | 低 |

**收益**：真正支持"两个朋友圈并行"，且顺带缓解 P0-4e。
**代价**：约半天到一天（含回归 + 变异演示）。
**约束**：必须加"按会话隔离"的回归套件——否则改完只是把覆盖点从一个地方挪到另一个地方。

### 方案 B（保守）：承认局限，单开
在设置页加显式提示：「本插件当前不支持多会话并行注入（语义命中层会被互相覆盖）、
若需长时攻关请只用单会话」+ 在降级标注里写清原因。
**代价**：近乎零；**缺点**：把架构缺陷固化成产品限制。

### 方案 C（不推荐）：两套独立 DSH_HOME
各自起 worker ⇒ **内存翻倍（+3.4GB×2）**，而可用内存只有 5.4GB ⇒ 会触顶。
且两套记忆库互相不可见，违背"记忆是跨会话资产"的初衷。

---

## 7. 未验证项（诚实清单）

1. **未做双会话实测**：结论基于读码 + 单会话降级快照推断，**没有真起两个会话复现**。
   若要坐实，需：开第二个会话 → 两会话交替投递 → 观察 `_tierGateHits` 是否被覆盖
   （可在诊断面板看 `indexDegrade` / 投影 sessionId）。
2. **未测内存峰值**：可用 5.4GB 是瞬时值；两个会话 + 重嵌同时发生时的峰值未采样。
3. **P0-4e 是否就是用户此次症状的主因**：未分离验证（可能与 §2.1 叠加）。
4. ~~`_lastTierQuery` 也是单槽，本次未展开分析~~ → **已补充确认**（见 §2.4），
   读取侧有会话门故危害较低，但写入侧仍无条件覆盖，建议一并分片。
