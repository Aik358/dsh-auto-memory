# 子代理完成报告与窗口接续 · 技术预研

> 状态:**只做预研,不出码**(用户 2026-09-10 指示「下一版再改」)。
> 研究范围:DSH live 版本 0.1.5-rc.1 的官方包源码,逐条带 `文件:行号`。
> 代码基准目录:`C:\Users\JH Z\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`
> 插件侧基准:`D:\dsh-auto-memory\lib\index.js`

---

## 0 结论摘要

1. **子代理完成后把报告投给"父",在 DSH 里是双重固定绑定,没有官方接口可以改投。**「re-parent / 改归属」在本版本不存在(`dsh-subagent` 的服务方法清单里没有任何写 `parentSession` 的方法)。
2. 想达成目标只有三条路:**①延后接续(避开问题)**、**②桥接转发(不改归属,改投递)**、**③双会话协同(交接材料声明 + 新会话自查)**。
3. 有一把**现成的官方钥匙**:DSH 的 Agent 句柄支持 `followup / steer / inject`,且 `ctx.get('agents').get(sessionId)` 按会话取句柄 —— 插件可以把任意消息投进**任意 live 会话并唤醒它**。转发路线就建立在这上面。
4. **另有一个比"投错窗口"更严重的隐患**:父会话不在 registry 时,结算通知**被静默丢弃**(`dsh-subagent:1249` 直接 `return`)。接续之后如果旧会话被销毁,在跑的子代理报告会**直接消失**——这条必须优先兜住。
5. 推荐顺序:**A 延后接续 → D 材料声明 → B 转发兜底 → C 可选**。

---

## 1 投递链:报告是怎么走到"父窗口"的

子代理分两类,**投递路径不同**。**本机默认走第二类**(`:1.2`)——`tool-subagent` 的 `backgroundMode` 在 standard/cordis preset 里是 `continuable`,所以用户看到的"报告"绝大多数是 **settlement notice**,不是 job 通知。

### 1.1 一次性后台子代理(走 job)

- `dsh-tool-subagent/lib/index.js:537` 起一个 `kind: "background"` 的 job(带 `run_in_background` 的工具调用走这条;插件自己的 `auto-memory-fold/consolidate/greet` 也都是 one-shot)。
- 完成通知由 **jobs 插件**发出:
  `dsh-tool-jobs/lib/index.js:206-227`
  ```js
  ctx.jobs.onJobDone((snapshot, owner) => {
    if (snapshot.reported || owner === void 0) return
    const message = createUserMessage({ content: [...], source: {...form: 'notice'} })
    if (delivery === 'wakeup' && owner.status === 'idle' && spent < wakeBudget) { owner.followup(message); return }
    owner.inject(message)
  })
  ```
  官方模板:有界唤醒 `maxConsecutiveWakes: 3` + 超预算降级为 `inject`(不唤醒)。
- **`owner` 是 spawn 时捕获的 Agent 句柄,不是 session id** —— 没有任何字符串层可以替换。
- job 的所有权围栏同样按 owner 走:`dsh-jobs/lib/index.js:51-55`(「access is fenced by the owner's session id」)、`dsh-jobs-local/lib/index.js:179-180`(`job.owner.id === session`)。

### 1.2 可续子代理(走 activation;**本机默认**)

- 结算投递:`dsh-subagent/lib/index.js:1244-1259`
  ```js
  notifySettlement(activation, terminal) {
    if (!activation.announced) return
    const parent = this.ctx.agents.get(activation.parentSession)   // ← 结算时按 session id 现取
    if (parent === void 0) return                                  // ← 父不在 ⇒ 静默丢弃
    const message = createSettlementMessage(activation.childId, terminal)
    if (this.closingTeardownFor(parent) !== undefined) { parent.inject(message); return }
    this.sendWaking(parent, message, parent.status === 'idle' ? 'queue' : 'steer')
  }
  ```
- 投递原语:`dsh-subagent/lib/index.js:873-885` —— 父自身是 resident 激活时走它的 inbox 并唤醒,否则退化为 `parent.steer(message)` / `parent.followup(message)`。
- 通知正文形态:`dsh-subagent/lib/index.js:641-681` —— 首行 `Background subagent <childId> finished...`,附「Its closing message:」+ 子代理最后一条消息;`source = { kind: 'subagent-settled', form: 'notice', senderSessionId: childId }`。

### 1.3 三处绑定 + 一处内存快照

| 绑定 | 位置 | 性质 |
|---|---|---|
| `child.header.parentSession` | 子会话 header(持久化) | 只用于**查询过滤**(`dsh-subagent:2073`、`2180`)与**授权校验**(`:862`、`:968`) |
| `activation.parentSession` | `dsh-subagent:1089` 建立激活时写入 | 内存快照;**通知投递读它**(`:1248`) |
| `job.owner` | job 记录 | 一次性后台子代理的投递目标 |

### 1.4 我们真正能用的投递面(关键)

`dsh-agent-loop/lib/index.js:773-797`:
```js
get status() { return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running' }
followup(input) { this.send(input, 'next-turn', true) }   // 排队 + 唤醒
steer(input)    { this.send(input, 'next-step', true) }   // 插到最近一步 + 唤醒
inject(input)   { this.send(input, 'next-step', false) }  // 只排队,不唤醒
```
配合 `ctx.get('agents').get(sessionId)`(Agent 注册表按会话 id 取),**插件可以往任意 live 会话投递并选择是否唤醒**。这是转发方案的全部基础;插件目前已经在用同一注册表(`lib/index.js:6693` `engine._subagents = ctx.get('subagents')`,`_lastAgent` 也来自 `ctx.get('agents')`)。

### 1.5 实机取证(本机 2026-09-10 18:31)

从 DSH 的会话投影缓存直接读出(路径:`~/.dsh/storages/session_projcache/sessions/<sessionId>.json` → `record.rows.*`):

**① 每个会话都有一行 `subagentCatalog`,内容就是它的直接子代理清单:**
```json
{"inheritedEventCount":0,"head":{"values":[
  {"version":0,"childId":"…","childCreatedAt":1789035230558,"mode":"one-shot","label":"auto-memory-fold"},
  {"version":0,"childId":"…","childCreatedAt":1789035713789,"mode":"continuable","label":"文档体系审计"}
]}}
```
本机实测:旧会话 `40727a84` 的 catalog 有 13 条(含本预研刚 spawn 的两个研究子代理,`childCreatedAt=1789036077798/99`),新会话 `9cc01f76` 的 catalog 有 5 条(含 18:21:53 spawn 的三条设计审计)。
→ **归属是按父会话分行的,一行不会串到另一行** —— 这正是问题所在,也说明"哪个孩子属于谁"随时可查、成本极低。

**② 接续之后两条会话同时 live**:18:31:38 与 18:31:28 两个时刻,`40727a84`(6.2MB)与 `9cc01f76`(1.4MB)的 `session.v3.jsonl.zstd` **都在持续写入**。
→ 旧会话并没有因为接续而退出,它仍然在跑回合、仍在收孩子的报告。这解释了用户看到的现象,也让"以旧父身份继续管孩子"(路线 C)在当前进程内成立。

**③ 由此得到一条更省事的数据源**:判定"某会话是否还有孩子在跑",不必非走 `listChildren`,用 `agents.get(childId)?.status === 'running'` 就行(`status` 语义见 §1.4),孩子的 id 从 `subagentCatalog` 投影行拿。`agents` 服务插件已经在用。
⚠️ 但 `subagentCatalog` 本身**没有 activity 字段**(`SA/lib/types/projection-types.d.ts:8-17`:只有 `{id, createdAt, mode, label}`),而且 `listChildren` 的 `activity` 走的是 Session store 口径(在内存= running),**只有浏览器面 `remoteExportList` 才会重新采样 Agent driver**(`SA/lib/index.js:74-83`)。所以要拿到真实"在跑"状态,host 侧应当自己 `agents.get(id)?.status` 复核。

### 1.6 可用的官方投递面(实现时会用到的原语清单)

| 原语 | 位置 | 语义 |
|---|---|---|
| `agent.followup(msg)` | `dsh-agent-loop:789` | 排到 next-turn **并唤醒**(空闲会话立刻开新回合) |
| `agent.steer(msg)` | `:792` | 插到 next-step **并唤醒** |
| `agent.inject(msg)` | `:795` | 插到 next-step **不唤醒**;空闲会话可能永远不醒,`cancel`/dispose 会丢弃 |
| `agent.status` | `:773` | `idle` / `running` |
| `ctx.get('agents').get(sessionId)` | Agent 注册表 | **只返回 live 的** Agent |
| `sessionController.resolveAgent(sessionId)` | host-only | 冷会话也能**现场拉起**再投递 |
| `sessionController.prompt({requestId, sessionId, mode:'queue'\|'steer', content})` | `SC/lib/index.js:773-774` | `queue`=新回合、`steer`=当前回合下一步;两者都不打断 |
| `ctx.on('subagent/end', info)` | `SA/lib/types/index.d.ts:94` | 子代理结束事件:`{runId, provider, id, stopReason, lastAssistantMessage?}` |
| `ctx.on('agent/turn-stopping')` | `AG/lib/types/runtime-types.d.ts:396` | 回合将关;listener 可 `agent.steer()` 让回合继续 |
| `ctx.on('agent/status')` | `:247` | `{agent, status}` 状态跃迁(可做"子代理由 running→idle"的触发) |

**两条硬边界**(必须记住):
- 子代理子会话(`header.origin === 'subagent'`)不能走 `sessionController.prompt`,一律 `session/agent-busy` + `use subagent delivery for this child session`。
- `sessionController` **没有** session 级 ACL:`dsh-authorization` 与越权无关;host 插件直调不需要 approval。换句话说,该做的闸门由插件自己把关(只对"已被接续过的旧会话"做转发)。

---

## 2 「能不能直接改投」— 逐条否证

| 设想的办法 | 结论 | 证据 |
|---|---|---|
| 官方有没有 re-parent / transfer 接口 | **没有**。服务方法清单只有 `list / listChildren / listDescendants / remoteExportList / prompt / interrupt / drainContinuableChildren / start / startContinuable / sendMessage` | `dsh-subagent:2981 / 2999 / 3015 / 3040 / 3082 / 2959` |
| 让新会话直接接管旧会话的子代理 | **被授权拒绝**:控制面按 `header.parentSession` 校验,跨父报 `subagent "X" belongs to another parent session` | `dsh-subagent:862`、`:968`、`:945` |
| 改子会话 header 的 `parentSession` | **不建议**:官方持久化格式字段 + 内存快照(activation)与 job.owner 各自独立,改一处不足以重定向 job 那条路,还会让 `authorizeLineage` 与新父不一致 | `:1001`、`:945`、`:968` |
| 反射式改 `activation.parentSession` / `job.owner` | 理论可行、**强烈不建议**:跨版本立即碎,且 `ancestry` 校验(`:863`、`:945`)按建立时的谱系判定,改完控制面全废 | 同上 |

**唯一"正解"是把投递改写在自己的层上** —— 见第 3 节 B。

---

## 3 四条可行路线

### A. 延后接续(治本,先做)

**原理**:问题的本质是「旧会话还有在跑的孩子,却被接续了」。把空闲判据从「回合边界」扩到「回合边界 **且** 无 running 直接子代理」。

- **接续时记名**(最小改动、收益最大):在 `hostAutoContinue` / 一键接续组装材料前,用 `listChildren(oldSid)` 取一次"未完成子代理清单",把**子代理 id + 标签 + 起始时间**写进交接材料(路线 D)。即使它们后来报告到了旧窗口,新会话也知道"有谁在外面跑、用哪个 id 去问"。
- 数据源:`ctx.get('subagents').listChildren(parentSessionId, signal)` → `resolveCandidateRows(...)` 按 `header.parentSession === parentSessionId && origin === 'subagent'` 过滤(`dsh-subagent:2073`);`remoteExportList` 额外给 `activity: running | inactive`(用 live Agent 注册表判定,`:74-83`)。
- ⚠️ **只有用旧会话 id 查得到这些孩子**:`listChildren(newSid)` 查不到(`:2073` 按 `header.parentSession` 过滤)——这也是"新会话无法接管"的同一个根因。
- 落点:插件 `lib/index.js:2143-2150` 的 `tickAutoContinue` → `awaitIdle` 分支,`busy` 判据追加「有 running 直接子代理」,沿用现有 `deferCount` 上限机制(最多 5 次 × 20s)。
- 必须带三条保险:①**硬上限**(例如最多推迟 5 分钟或 5 次),超时照常接续,避免长任务里永不接续;②**用户手动接续不受限**(一键接续直接走);③service 不可用时 **fail-open**(`subagent/projections-unavailable` 等错误照常接续)。
- 代价:约 10-15 行 + 一处 service 调用。风险:低。

### B. 桥接转发(真正把报告送进新窗口)

**原理**:不改变归属,插件自己把「结算事实」再投一份到新会话。

#### B-0 触发器:**官方有专门的事件,插件直接订阅即可**

`dsh-subagent/lib/types/index.d.ts:85,94` 提供两个事件:**`subagent/start`** 与 **`subagent/end`**;
`SubagentRunEndInfo = { runId, provider, id: SessionId, local, stopReason, lastAssistantMessage?: ContentBlock[] }`(`types.d.ts:93-110`),`stopReason ∈ {completed, aborted, error, 'max-tokens', refusal}`。

官方现成消费范例(实现 Claude Code 的 `SubagentStop` 钩子):
```js
// dsh-hooks-claude-code/lib/index.js:309-329
ctx.on("subagent/start", (info) => { const child = ctx.get("agents")?.get(info.id) ... })
ctx.on("subagent/end",   (info) => { const child = subagentChildren.get(info.runId) ?? ctx.get("agents")?.get(info.id) ... })
```
⇒ **转发只要在插件自己的 ctx 上 `ctx.on('subagent/end', info => ...)`**,payload 里已经带了子代理 id、结束原因与最后一条消息 —— 不需要枚举孩子、不需要轮询、不需要读日志。

⚠️ 但 **payload 里没有 parentId**,而且该事件是在 `notifySettlement` **之后**才 emit 的(`dsh-subagent:1239 → :1241`:看到事件时原通知已经入队)。所以"这条报告原本要发给谁"要在事件里自己解一次:
```js
ctx.on('subagent/end', (info) => {
  const child = ctx.get('agents')?.get(info.id)          // 官方范例就是这么取的
  const fromSid = child?.session?.header?.parentSession  // 子会话自己的 durable 头
  ... // 再用闩锁表把 fromSid 映射到 toSid
})
```
(官方另有一个反解范例:`dsh-sdk-jsonrpc-server/lib/index.js:35-37 subagentParentOf`。)

⚠️ **不要用"打补丁 steer/followup"的方式拦截**:当父本身是常驻可续子代理时,通知走的是父自己的 activation inbox(`dsh-subagent:874-881`),根本不经过 `agent.steer/followup` —— 补丁会漏。正确做法是**旁听**(`subagent/end` 或 `agent/inbox/inserted`),把文本**复制**一份给新会话。

**兜底触发器**(覆盖 `subagent/end` 看不到的路径,例如 job 通知未走 activation):插件今天已经在监听原始事件流 `ctx.on('session/event', ...)`(`lib/index.js:6826-6828`),并已在里面按 `event.type === 'user/message'` 分流、读 `source.kind` 与插件名(`:1182-1186`、`:6109-6110`)。两类通知最终都是父会话里的一条 `user/message`:
- 可续子代理:`source = { kind: 'subagent-settled', form: 'notice', senderSessionId: <childId> }`(`dsh-subagent:674-679`)
- job:`source = { kind: 'plugin', plugin: 'tool-jobs', form: 'notice' }`(`dsh-tool-jobs:213-218`)

#### B-1 投递目标

后继会话 id 从已接续闩锁文件 `~/.dsh/memory/auto-continue-done.json`(`{sessions:[{from,to,at}]}`)取 —— 现成数据,`from` 命中事件所属会话即可。

#### B-2 投递方式

```js
const agents = ctx.get('agents')
let target = agents?.get(toSid)                          // 只返回 live 的
if (!target) target = await ctx.sessionController?.resolveAgent(toSid)   // 冷会话现场拉起
target.status === 'idle' ? target.followup(msg) : target.inject(msg)
```
与官方 `sendWaking` 同款策略(`dsh-subagent:1255`):空闲则排队并唤醒,忙则只排队不打断。

⚠️ 三个必须避开的坑(均来自官方明文):
1. **不要用 `sessionController.prompt` 投给子代理子会话**:`header.origin === 'subagent'` 一律被拒为 `session/agent-busy`,reason `use subagent delivery for this child session`(`dsh-api-session-controller/lib/index.js:124-138`)。
2. **`requestId` 是幂等键**:撞车时服务**静默返回 `accepted:true` 但不投递**(`SC/lib/index.js:741`)。转发每次都要现铸新 id,否则报告会丢。
3. **必须自带唤醒预算**:照抄 `maxConsecutiveWakes` 思路,否则每个子代理结算都开一个模型回合(烧钱且噪音大);超预算降级为 `inject`。
   另:`prompt` 的兜底 catch 会把一切 admission 异常包成 `session/agent-busy` / `"prompt rejected"`,真因只在 `reason` —— 日志必须打 `reason`,否则失败不可见(这正是 2.4.0 修过的那条故障线)。

#### B-3 消息形态建议

```
【上游子代理结算 · 来自已被接续的会话 <oldSid8>】
Background subagent <childId> finished...(原文首行)
摘要:<...>
回读:job_output(<jobId>) / 该子会话 <childId> 末尾若干条
```

#### B-4 遗留问题

- 旧会话里的原通知**无法撤回**,会与新会话里的转发件并存(可接受;若嫌吵,可在旧会话侧做"已转发"标记,但这需要改官方渲染面,不做)。
- 转发件是 user 角色消息,新会话可能当真用户输入 —— 故正文必须显式标注来源(见 B-3)。
- 退避:同一 `senderSessionId` + 同一内容指纹去重,避免重复投递。

### C. 以旧父身份继续管那些子代理(可选)

插件是 host 侧、持有原始 service,可以直接:
```js
subagents.prompt({ parentSessionId: oldSid, childSessionId, mode: 'continuable', delivery: 'queue', requestId, content })
subagents.interrupt({ parentSessionId: oldSid, childSessionId, mode: 'continuable' })
```
前提:旧会话 agent 仍 live(否则 `subagent/parent-unavailable`,`dsh-subagent:3046`);子代理必须是 continuable(`subagent/not-resumable`)。**新会话自己不能管**(授权按 header.parentSession)。

用途:续问/收拢/中断"遗留孩子"。不是必须项。

### D. 交接材料声明 + 新会话可查(顺手做,零风险)

- 接续时把「旧会话在跑的子代理清单」(id + 标题 + 起始时间 + 是否 continuable)写进交接材料(carry),让新会话一开始就知道"还有哪些活在外面跑"。
- 插件再暴露一个**只读**查询面(HTTP 端点或给新会话用的工具),回答"旧会话的孩子现在什么状态、输出在哪"。
- 代价:小。把「完全看不见」变成「看得见、可回读」。

---

## 4 需要实机验证的点(改之前先测)

1. 接续之后,旧会话的 agent 是否仍 live(`ctx.get('agents').get(oldSid)`)?—— 决定 A 能否等待、B/C 能否读到孩子输出。**已初步取证:是**(18:31 两份 v3 日志同时在写,见 §1.5)。
2. `listChildren(oldSid)` 在本机能否返回(取决于 projections / sessionQuery 是否挂载),错误码分别是什么。
3. 一次性后台子代理的 job `snapshot` 里有没有可判别"这是子代理 job"的字段(`kind` / `label`),用于 B 的过滤。
4. **`subagent/end` 在插件 ctx 上的可见范围**:能否收到别的作用域下的子代理结束(官方 `dsh-hooks-claude-code` 用它实现全局 SubagentStop,倾向可以);payload **不含 parentId**,需自己从子会话 header 反解。
5. **`announced` 门**:通知只在 `activation.announced === true` 时发出,而它只在父**真的投递过消息**给子代理才置位(`dsh-subagent:1246`、`:1809/1929`)—— 存在"结算了但从不产生通知"的子代理,这类只能靠 A/D 兜。
6. **本机 `backgroundMode` 已确认为 `continuable`**(`dsh-agent-presets/presets/standard/agent.cordis.yml:181-187`),故 live 路径是 settlement notice;job 那条路只对显式 `run_in_background` 的 one-shot 生效。
7. 新会话被 `followup` 唤醒时的打扰程度(用户正在输入时是否该退化为 `inject` 只排队)。
8. 父会话销毁后通知是否真的丢弃(`:1249`)—— 若会丢,B 必须"落盘优先",否则报告永久消失。

---

## 5 明确不做的事

- ❌ 不改 DSH 内部对象(`activation.parentSession`、`job.owner`)。
- ❌ 不重写子会话 header 的 `parentSession`(官方持久化格式 + 校验,跨版本必碎)。
- ❌ 不改官方 UI 的 subagent 面板;所有改动留在插件自己的 layer。
- ❌ 不在本轮出码 —— 本文只是预研。

---

## 6 与现有插件的接口对照(落点清单)

| 需要的东西 | 现状 | 缺什么 |
|---|---|---|
| subagents service | `lib/index.js:117` 已 `inject: ['subagents']`,`:6693` 已缓存 `_subagents` | 直接用 `listChildren` / `remoteExportList`(尚未调用) |
| agents 注册表 | `_lastAgent` / `inheritPermission*` 已在用 | 把它当"投递口"用(`followup/inject`)是新增语义 |
| 接续映射表 | `~/.dsh/memory/auto-continue-done.json`(`from → to`) | 正好可作为 B 的判据来源 |
| job 完成事件 | 未订阅 | 新增 `ctx.jobs.onJobDone` 监听器 |
| 空闲判据 | `tickAutoContinue` 的 `awaitIdle`(`:2143-2150`) | 追加"无 running 子代理" |
| 交接材料 | `buildContinueCarry` | 追加"在外子代理清单"一节 |
