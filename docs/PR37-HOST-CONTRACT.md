# PR37：宿主契约、适用范围与待验边界

此文件记录本轮通过 GitHub 只读接口核对的源码事实与本地设计，不是完整宿主源码快照，也不是宿主验收报告。

## 固定版本

- 插件：`Aik358/dsh-auto-memory@a972ebfaed508f12096105b672ad68db06225491`。
- PR37 head：`Minervaowl7/dsh-auto-memory@51d9fb9901e910c6226a1032756c0b7f3675f5dd`；分支 `fix/issue35-autocontinue-idle-gate`。
- DSH：`deepseek-ai/deepseek-harness@0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`；默认分支 `master`。
- 本轮工作结束复核：上述 main、PR head、DSH master 均未移动。

## 阅读来源与使用方式

1. `packages/core/agent-loop/src/agent.ts`：公开 `status`、`whenIdle()`、`runMaintenance()`、Agent-owned `ctx`/`scope`。`idle` 包括 maintenance；因此不能仅检查 status 后长期 await。maintenance 能排斥执行，但允许新消息入队，退出 maintenance 后可自动唤醒。
2. `packages/core/agent-loop/src/inbox.ts`：`nextTurn`、`nextStep`；消息先 claim，再进入 pre-step。被拒绝的已 claim 输入必须显式保留，不能假定 reject 自动归队。
3. `packages/api/session-controller/src/index.ts`：公开 `create`、`prompt`、`cancel`、`inspect`、`selectModel`、`rename`。`prompt` 的第二个 AbortSignal 参数必传。
4. `packages/api/session-controller/src/commands.ts`：prompt 按 RPC requestId 查询已有用户消息/队列；查询与实际入队之间存在 await，所以不能假定宿主提供跨并发调用的原子 exactly-once。busy 包装并不自动证明没有发生投递。`cancel` 取消 active turn，但保留 pending inbox，不能清空旧会话。
5. `packages/api/session-controller/src/agent.ts`：`ensureSession` 使用显式 sessionId 的 creation/resume Promise map；相同 ID create/adopt，检查 cwd/preset。被动 inspection 通过 sessionQuery.observeSession 读取 header 和完整事件前缀。
6. `packages/core/session/src/index.ts`：公开 `seq` 是下一条事件序号；不能依赖不存在的公开 `session.events`。宿主 inspection 返回完整事件；实际 Session 持久化是缓冲机制，不等于每条事件 fsync。
7. `packages/core/agent-loop/src/tool-calls.ts`：真实执行上下文含 agent/callId/name；工具结果使用 `data.message.source.kind=tool` 和 `source.callId`，message.role=user，content 中 tool-result.toolCallId 关联原工具。
8. 插件 `lib/index.js`：`agentForSessionId()` 读取 `ctx.get('agents')`；`withAgent()` 绑定源 runtime；`memory_note` 路由实际写入 PLAN/handoff；PLAN writer 返回 final，handoff writer 需要补上 final。
9. 插件 `lib/memory-writer.js`：复用已有 `atomicReplace`，不另造通用持久化框架。Windows 覆盖 rename/fsync 的实际行为仍须宿主验证。

宿主源码根地址：
`https://github.com/deepseek-ai/deepseek-harness/tree/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`
插件源码根地址：
`https://github.com/Aik358/dsh-auto-memory/tree/a972ebfaed508f12096105b672ad68db06225491`

## 设计的保证范围

本地行为测试覆盖同一 DSH 进程内，同一 memory root + oldSessionId 的串行执行，以及 checkpoint 文件持久化后的插件重建。create 重试始终复用预留 ID；prompt 一旦提交而结果不明，只查回执，不盲目重发。所有入口都经过真实 idle、双空 inbox、身份和事件边界检查。

进入 submitting/delivered 后，旧会话变为只读交接源。新的输入被保留在旧 inbox，不调用模型、不暗中丢弃，也不假装已经转送目标。这是为消除“prompt 等待 admission 时旧会话突然入队”窗口而加的必要行为变化。用户需在目标会话继续。

没有断言以下能力：跨两个独立 DSH 进程共同写一个 DSH_HOME 的锁；强制断电下的 exactly-once；在 host 已启动旧 Agent 后才加载插件时仍保证启动阶段无执行窗口；存在未知 third-party pre-step 插件排序时一定工作。真实验收失败必须阻止 push。

未知的 submitting 可以永久保持 uncertain，等待真实回执或人工核查，不能按时间/defer 次数升级成执行。没有使用 cancel，也没有清空队列。

## 不能视作验收的内容

`tests/fixtures/dsh.mjs` 是根据上述源码构造的 fixture，不是真实 DSH，也未引入真实 Cordis。测试用事件数组仅是 fixture 的内部存储；生产 adapter 通过 `SessionController.inspect()` 读取事件。
