# CoT+可见输出实时监听联通工程（M7.5 断言式单播 RFC）

> 状态：**§1-§3 已实施（2026-08-25 深夜）**——`assistant/chunk(chunk.type='reasoning-delta')`
> 经聚合缓冲接入 ContextObserver；pre-step 边界强制冲刷；purge 清零钩子。
> 开关 `reasoningObserverEnabled` 默认仍 false（契约红线），需配置显式开启。
> 待办：§5 弱特征在数据流通后实施。
> **设置页待办（用户要求）**：`reasoningObserverEnabled`（思维链监听，默认关）
> 与 `contextBridgeObserveChildSessions`（分支会话观测，默认关）必须纳入设置 UI——
> 随 G-02/设置页窗口实现；两者已通过配置文件手动开启（2026-08-26）。
> 实测教训：用户常用会话跨天续接后会被 harness 挂 parentSession 而判为 child，
> 全部 context push 被 child-session 门丢弃——开关即为此场景而设。
> 前提：用户明确目标为**监听模型思维链（CoT）+ 可见输出的滑动窗口**触发语义换机；
>          闭源模型的**概括式/无 CoT**同样纳入设计（后者退化为纯可见输出路径）。
> 教训：anchored-monitor 与 dsh-draw-gacha 在公开广播信道监听打架导致崩溃——
>        本工程**必须走断言式一对一订阅（单播），不使用任何公开广播/全局监听**。

## 0. 不变量与官方注入约定

- 点击断言经主 Agent 审定：pre-step 上下文注入为官方每轮边界的自然注入，
  走 `agent/pre-step` 的 `next(payload)` 透传；不做中间件式硬插。
- 缓存击穿红线（workbuddy/2026-08-16 诊断）：system prompt 任意位置变化会使
  DeepSeek 磁盘前缀缓存 miss——注入面必须保持稳定，仅在 pre-step 边界替换。
- 记忆内容层与检索计算层的 C1/C2/C3 分层按 HTML 权威图为准。

## 1. 信号源与双域监听（CoT + 可见输出）

| 域 | 事件/源 | 特点 | 缺失时 |
| --- | --- | --- | --- |
| CoT | `ctx.on('agent/reasoning', …)`（DSH 官方事件名以 types.d.ts 为准；若平台为 chunk 增量流，则等价为 `assistant/reasoning_chunk`/`reasoning_delta`） | 流式增量到达，含 `reasoningTokens/charCount/isComplete` 元信息；闭源模型为概括式短摘要或不发送 | 无则记 `hasReasoning=false`，不降可用性 |
| 可见输出 | `ctx.on('assistant/message' | 'assistant/chunk' chunk.text)` | 最终可见文本；闭源下是主信号源 | 同 CoT 缺失处理 |

监听范围：仅对本插件所服务的 `sessionId/agentId` 下的事件；不注册任何
`ctx.on('*')`、`EventBus`、`window.postMessage` 等全局钩子。

## 2. 断言式单播接线（防崩溃铁律）

1. **订阅即断言**：`ctx.on('agent/reasoning', handler)` 的 handler 内首行断言
   `handler.sessionId === runtime.sessionId`，不匹配直接返回（不写 ring、不推进
   contextVersion）。做到“一对一”，即使 DSH 内部分发走广播，也在插件内降为单播。
2. **幂等摄入（sequence 只增不减）**：复用 anchored-monitor 的稳态实现——
   `sequence <= lastSequence` 的重复/乱序块直接丢弃；窗口 `push(vec, ts)` 外不产生副作用。
3. **双信道隔离时钟**：reasoning 与 text 各自独立 `lastReasoningAt/lastTextAt`，
   不共享状态；互相不阻塞。
4. **不做全局广播，不写共享存储**：不往 `localStorage / file / global bus` 写中间态；
   仅写入本 runtime 的有界 ring（envelope 128 / Segment 64）。

## 3. 滑动窗口与防卡死（稳定态约束）

- 窗口：`ObserverRing`（有界 ring，已有实现复用），上限 64 segments / 32k chars；
  ContextBridge 侧复用 `windowSegments=8 / windowChars=4096` 的定长滑窗。
- 背压：reasoning 高频增量在 16ms 内合并一次（debounce），`OBSERVER_PREVIEW_MAX=240`
  截断预览；超限直接记 `truncated=true`，不做无限缓冲。
- 失败域隔离：所有 handler 包 `try {}`，异常仅 `observerDropped.ignored++`，不抛。

## 4. 数据流到 Python（联通点）

```
DSH 事件流 (单播断言)
  → ctx.on('agent/reasoning') + ctx.on('assistant/chunk')
    → ingestEnvelope(runtime, { channel:'agent', eventType:'agent/reasoning'|'assistant/chunk', payload:{text, reasoningTokens?} })
      → Segment(kind='reasoning'|'assistant', text=bounded)
        → ContextHost: window = segments.snapshot().slice(-maxSegments)
           → buildQueryPlan({ trigger, window }) 的语义由 window 全量文本决定（已天然包含 CoT+可见输出）
           → memoryRefs / aggregates 构造不变
           → buildContextPushEnvelopePre({ session,cursor,index,trigger,window,memoryRefs,evidence })
             → PythonContextSinkPre.push(envelope) → worker _fv2_shadow_decide
```

*注：触发语义不因 CoT 增量而每块 push，仅在 Segment 接受（contextVersion 递增）时
随正常 envelope 推送，天然防抖。*

## 5. 算法增强（弱信号，非硬门）

Python 侧新增可选特征组 `reasoningSignals = { hasReasoning, uncertaintyScore,
selfCorrection }`，词表复用 `ERR_TOKENS` 同款轻量匹配，缺失全 0。

仅影响 proactive lane 的预热门限：`uncertaintyScore` 高或命中 selfCorrection 时
`deltaPro` 放宽一档（0.05→0.03），永远不直接 emit，不进任何 hard gate。
契约 `Gate 不依赖 reasoning` 继续成立。

shadow 日志增加 `reasoningHints: { hasReasoning, len }` 计数域（≤8 字节），
用于后续攒"CoT 触发 vs 用户触发"对照对，再决定是否扩意图头为双输入。

## 6. 验收

- 重启 3080 → 发送 4 条验证消息（含 1 条触发模型长 CoT 的开放式回忆问）→
  检查 `fv2-debug.log` 新增 `reasoningSegs` 计数与 shadow 行的 reasoningHints；
  三档检索契约不变，仍满足 29 套件回归。
