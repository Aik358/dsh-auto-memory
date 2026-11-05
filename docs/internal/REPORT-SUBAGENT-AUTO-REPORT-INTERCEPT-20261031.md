# 子代理自动回报「拦截失效」问题报告

> 面向对象：负责修改「子代理派生 → 停止后自动回报主代理」这条链路的 Agent
> 生成时间：2026-10-31 · 仓库：`D:\dsh-auto-memory`（DeepSeek Harness 自动记忆插件）
> 本文所有结论均为**实测取证**，附文件行号，非推测。

---

## 一、问题现象（用户原话）

> 「比如 memory consolidate 等操作结束之后，记忆中枢还会自动接收到一条变化的信息，导致记忆中枢可能会出现一些未预期的行为。现在这个拦截好像失效了。」

具体表现：记忆中枢（挂机自跑、无人对话的工作台会话）会收到形如

```
Agent ca9dcea7-f3ff-45b2-b9cc-8bfbc09a5072 sent a message: [TOPIC] 情境化记忆四项修复…
```

的消息，并**触发一轮新的回复**（打断挂机节奏）。

---

## 二、根因（已确认，非推测）

### 2.1 这条消息不是子代理「主动发的」，是**宿主自动构造**的

asar 取证（`@deepseek-ai/dsh-subagent/continuation-messages`）：

```js
function agentMessageSource(sender) {
  return { kind: "agent-message", form: "relay", senderSessionId: sender.id }
}
export function createAgentMessage(sender, content) {
  return createUserMessage({
    content: [{ type: "text", text: "Agent " + sender.id + " sent a message: " }, ...content],
    source: agentMessageSource(sender),
  });
}
```

⇒ 这是**多 Agent 协作的通用机制**，任何 Team / subagent 场景都会产生。
⇒ **不经过子代理的模型决策**，所以「在子代理 prompt 里加禁止指令」这条路**结构上无效**（已实证）。

### 2.2 现有拦截机制「看起来完整，实际有一处断点」

仓库里已有两个相关模块：

| 模块 | 行数 | 作用 | 接线状态 |
|---|---|---|---|
| `lib/subagent-prompt-guard.js` | 80 | 给子代理 prompt 前置行为护栏 | **有接线**（`index.js:108` import，`_runSubagentOnce` 内调用） |
| `lib/hub-message-filter.js` | 129 | 记忆中枢侧的 agent-message 过滤器 | **⚠️ 只 import，无任何调用点** |

实测：`filterHubAgentMessagesPre` 全仓出现 **1 次**，就是 `lib/index.js:110` 那行 import。**没有第二个调用点**。

⇒ 这个模块是**死代码**。它导出的 `isAgentMessagePre` 倒是被另一处用了（见 2.3），但过滤主函数从未被调用。

### 2.3 真正的拦截在 `agent/pre-step` hook 里，但它是**另写的一份实现**

`lib/index.js:20728-20758`：

```js
let _hubReject = false
try {
  if (engine._hubMsgReject !== false) {
    const _rmsgs = (payload && Array.isArray(payload.messages)) ? payload.messages : []
    if (_rmsgs.length) {
      let _rcwd = String((agent.session.header && agent.session.header.cwd) || '')
      let _rwant = String(engine._workbenchCwd() || '')
      let _isHub = engine._pathKey(_rcwd) === engine._pathKey(_rwant)
      if (_isHub) {
        let _allAgentMsg = true
        for (const _m of _rmsgs) { if (!isAgentMessagePre(_m)) { _allAgentMsg = false; break } }
        if (_allAgentMsg) { _hubReject = true; /* diag */ }
      }
    }
  }
} catch (_) {}
if (_hubReject) {
  let _d = null;
  try { _d = await next() } catch (_) { _d = null }
  if (_d && typeof _d === 'object') return Object.assign({}, _d, { kind: 'reject', messages: [] })
  return _d
}
return next()
```

这段实现本身**设计正确**：返回 `kind:'reject'` 会让宿主**开不出新 step**（即「自动暂停回答」）。

### 2.4 真实根因（★2026-10-31 全面更正 —— 原「三个断点」全部证伪）

> **更正声明**：本节原列出「断点 A（`_hubMsgReject` 只读）/ B（`payload.messages` 不是投递批次）/ C（cwd 不一致）」，
> 三者在后续取证中**全部被证伪**。A 是设计如此（开关恒开的守卫，非缺陷）；B、C 均建立在
> 「拦截代码被执行过」这个错误前提上。真正的根因是下面两条，**都在更底层**。

#### 真根因 1（主因）：`agent` 声明在 `try` 块内，拦截段在块外读它 ⇒ `ReferenceError` 被静默吞掉

**缺陷形态**（AST 取证，`acorn` 独立复核）：

```js
// 修复前（伪码，保留真实缩进语义）
async function preStepHandler(payload, next) {
  try {
    const agent = payload && payload.agent   // ← 声明在 try 内（block-scoped）
    ...
  } catch (_) {}

  // ↓ 拦截段在 try **之外**，却读 `agent`
  const _rcwd = agent.session.header.cwd     // ← ReferenceError: agent is not defined
  const _isHub = _pathKey(_rcwd) === _pathKey(_workbenchCwd())
  if (_isHub) { ... }
}
```

**因果链（每一步都可实测）**：

1. 读 `agent.session.header.cwd` ⇒ **`ReferenceError: agent is not defined`**
2. 该表达式所在的语句**自身带 `catch (_) {}`**（与 `ReferenceError` 同一行）⇒ 异常被**完全静默吞掉**
3. ⇒ `_rcwd` 恒为 `''`
4. ⇒ `_isHub` 恒为 `false`（`'' !== workbenchCwd`）
5. ⇒ **整段拦截一次都没执行过**

**这解释了为什么「代码看起来在、日志却什么都没有」** —— 不是判据不成立，是**那段代码从未跑到**。

**修复与验证**：

| 项 | 值 |
|---|---|
| 修法 | `const agent = payload && payload.agent` 提到 handler **顶层**（缩进 4，try 深度 0） |
| 验证 | acorn AST 复核：`shell 内 L20811` 的 `agent` 解析到 **function-level binding**，不再是 try 块级 |
| 判据 | 该 `ReferenceError` 若再出现，拦截必须**显式报错**而不是静默吞 —— 见真根因 2 的守卫 |

#### 真根因 2（次因）：`subagent-settled` 从未进过拦截名单

用户报的「**操作结束之后还会收到一条变化信息**」，对应宿主 `createSettlementMessage` 产出的
`subagent-settled` 消息。实测该 kind **不在**拦截名单里 ⇒ 即使真根因 1 修好，这条仍然会漏进来。

| 项 | 值 |
|---|---|
| 缺陷 | `SUBAGENT_SETTLED_KIND_PRE` 存在（`lib/hub-message-filter.js`），但未加入 `HUB_NOISE_KINDS_PRE` 的拦截集合 |
| 症状 | 子代理每结束一次 ⇒ 主会话多收一条「Agent <name> 已完成」⇒ 用户感知为「变化信息」 |
| 修法 | 把 `subagent-settled` 并入拦截名单；`hub-message-filter.js` 现导出 `isHubNoiseMessagePre` 统一判定 |
| 守卫 | `tests/smoke/smoke-test-hub-reject-e2e.mjs`（对方 Agent 编写，本报告作者独立复跑 **9 PASS / 0 FAIL, exit 0**） |

#### 为什么原「三个断点」会全部判错（方法论教训）

| 原断点 | 错在哪 |
|---|---|
| A | 把「开关恒开」当缺陷。它本就是守卫（默认拦住），无配置项是**刻意的**，不是失效原因 |
| B | 建立在「代码执行过」的前提下。实际那段代码**从未执行**，讨论它读哪个字段毫无意义 |
| C | 同上。`_isHub` 恒 false 的原因不是 cwd 对不上，而是**取值语句先抛异常** |

**可复用判据**：报告「某段门控不生效」时，必须先证明**它被执行过**（打点/计数/断言副作用），
否则一切关于「判据写错」的推断都可能是在分析一段死代码。

---

## 三、复现与验证方法（交给下游 Agent）

### 3.1 第一步永远是「证明它被执行过」（★原版这里是判 A/B/C，方向就是错的）

> 原版让人按 A/B/C 分支排查，但 **A/B/C 已在 2026-10-31 全部证伪**。
> 真正该先做的是：**确认那段门控有没有被执行**。没被执行时，分析它读哪个字段、cwd 对不对，全是分析死代码。

**判据顺序（必须按这个顺序，不可跳步）**：

| 步骤 | 怎么测 | 若不成立说明什么 |
|---|---|---|
| ① 是否进入 | 在 `if (_isHub)` **之前**打一条 diag（不依赖任何变量） | 连这条都没有 ⇒ hook 没进来 / 更上游已 early return |
| ② 取值语句是否抛 | 把 `agent.session.header.cwd` 包 try 并**把异常打出来**（不要空 catch） | 真根因 1 的形态：`ReferenceError: agent is not defined` |
| ③ `_rcwd` 是否为空 | 打 `_rcwd` 实际值 | 恒空 ⇒ 大概率是 ② |
| ④ `_isHub` | 打 `_isHub` 与两侧归一值 | false 且 ③ 空 ⇒ 仍归因到 ② |
| ⑤ 消息形状 | 打 `_rmsgs.length` 与 `source.kind` 实际值 | 到这里才轮到讨论「读哪个字段」 |

**原文的三个分支现在应读作**：

| 旧判读 | 现在的正确解读 |
|---|---|
| 没有 diag 输出 ⇒ 查 hook 注册顺序 | ✅ 保留，这仍是第一优先 |
| `isHub=false` ⇒ 断点 C（改 cwd） | ❌ 已证伪。先查 ② 是否抛了 `ReferenceError` |
| `msgs=0` ⇒ 断点 B（改读 decision.messages） | ⚠️ 只有在 ①–④ 都正常时才成立，且**不是**本次根因 |
| `allAgentMsg=true` 但依然触发 | ✅ 保留，见 3.3 |

### 3.2 用纯函数单测先排除「判定逻辑本身」

`lib/hub-message-filter.js` 的三个导出都是**纯函数、零 IO**，可以直接构造真实形状断言（本次已实测通过）：

```js
isAgentMessagePre({ source: { kind: 'agent-message', form: 'relay', senderSessionId: 'x' } })  // → true  ✅
isAgentMessagePre({ source: 'agent-message' })                                                  // → true  ✅
isAgentMessagePre({ role: 'user', content: 'hi' })                                             // → false ✅
isAgentMessagePre({ source: { kind: 'agent' } })                                                // → false ✅

isHubSessionPre({ sessionCwd: '', workbenchCwd: '' })        // → false（双空保守） ✅
isHubSessionPre({ sessionCwd: 'D:/a', workbenchCwd: '' })    // → false ✅
isHubSessionPre({ sessionCwd: 'D:/a', workbenchCwd: 'D:/a' })// → true  ✅
```

⇒ **判定函数没问题，问题在「喂给它的数据」或「接线」。**

### 3.3 验证 `reject` 是否真能拦住 step

宿主文档原文（`dsh-agent-loop` pre-step 调度）：

```js
ctx.on("agent/pre-step", async ({agent,messages,step,signal}, next) => {
    const decision = await next();
    if (decision.kind === "reject" || step===1 && decision.messages.length===0) return decision;
    return { ...decision, messages: entered };
});
```

⇒ `kind:'reject'` 会被原样返回 ⇒ **这一步不开 ⇒ 不触发新回复**。机制本身可用。

---

## 四、建议的修复方向（按优先级）

### 推荐方案（★已按真实根因重排优先级）

**P0（必须先做，否则后面全部无意义）**

1. **把 `const agent` 提到 handler 顶层**，并给取值语句**去掉空 catch**（改成把异常写进 diag）。
   这是真根因 1 —— 不做这一步，拦截段永远不执行。
2. **把 `subagent-settled` 并入拦截名单**（真根因 2），否则「子代理结束后的那条变化信息」仍会漏。

**P1（结构改善，非阻塞）**：把判定挪到 `decision.messages` 上，并复用 `hub-message-filter.js`

```js
ctx.on('agent/pre-step', async (payload, next) => {
  const decision = await next();
  if (!decision || typeof decision !== 'object') return decision;
  // ★改用 decision.messages（宿主真正投递的那批），而不是 payload.messages
  const r = filterHubAgentMessagesPre({
    messages: decision.messages,
    sessionCwd: agent.session.header.cwd,
    workbenchCwd: engine._workbenchCwd(),
    pathKey: (x) => engine._pathKey(x),
  });
  // r.removed>0 且 r.kept===0 ⇒ 整批都是噪音 ⇒ reject（不开新 step）
  if (r.ok && r.removed > 0 && r.kept === 0) return { ...decision, kind: 'reject', messages: [] };
  return decision;
});
```

**为什么这样更好**：

1. **一处判据**：现在 `hub-message-filter.js` 与 `index.js:20728` 是两份实现，语义重复（违反仓库「同一语义多处判据必须一次改全」的纪律）。合并到一处。
2. **用对数据源**：`decision.messages` 才是宿主真正投递的（注释已实证 `payload.messages` 那条路踩过坑）。
3. **保留原不变量**：非记忆中枢零副作用、夹带真人消息绝不 reject、全拦也要 `next()` 过。

### 配套建议

| # | 建议 | 理由 |
|---|---|---|
| 1 | 新增配置键 `hubRejectAgentMessages`（默认 true）并接进设置页 | `_hubMsgReject` 目前**无人赋值**，用户无法关掉/排查 |
| 2 | 加一条**可回放**的 diag：记录 `cwd / isHub / 消息条数 / 判定结果` | 本次排查最大的困难就是「完全没有观测点」 |
| 3 | 给 `filterHubAgentMessagesPre` 补接线测试 | 它现在**零调用点**，却能通过任何「文件存在」类断言 —— 典型死代码长绿 |
| 4 | 保留 `subagent-prompt-guard.js`，但**在头部注释里明确它拦不住自动回报** | 该注释已写（第 47-50 行），但容易被下一个人误读为「护栏=拦截」 |

---

## 五、边界（明确不要做的事）

1. **不要动 `subagent-prompt-guard.js` 的现有措辞**：用户 2026-10-28 明确裁定「从提示词上出手就可以」，且该护栏对「子代理额外主动调 send_message」仍有效（虽然拦不住宿主自动回报）。
2. **不要拦其他工作区**：用户原话「就仅仅在这里拦截掉这个自动回报，不要动别的，就不要影响别的工作区的正常逻辑行为」。
3. **不要删 `hub-message-filter.js`**：它的纯函数实现是对的（本次已实测 7 项判定全对），应**接线复用**而非重写。
4. **不要用正文前缀（`Agent xxx sent a message:`）做判定**：正文可被改写，`source.kind` 才是宿主写入的结构化字段。

---

## 六、涉及文件清单

| 文件 | 行数/字节 | 角色 |
|---|---|---|
| `lib/hub-message-filter.js` | 129 行 / 4,543 B | 纯函数过滤器（**当前死代码，需接线**） |
| `lib/subagent-prompt-guard.js` | 80 行 | prompt 护栏（已接线，但拦不住自动回报） |
| `lib/index.js:110` | — | 唯一 import 点 |
| `lib/index.js:20728-20758` | 31 行 | 现有拦截实现（读 `payload.messages`，疑似数据源错） |
| `lib/index.js:20710-20722` | 13 行 | 记录「`payload.messages` 那条路已实证无效」的注释 |

---

## 七、一句话总结

> 拦截的**设计是对的、纯函数也是对的**，但它有**两份实现**：一份在 `hub-message-filter.js`（写了从没调用），一份在 `index.js:20728`（调用了但读的可能不是宿主真正投递的那批消息）。
> 先把观测点加上（3.1 的两行 diag），确认是「cwd 判定」还是「消息数据源」的问题，再按第四节合并成一处。
