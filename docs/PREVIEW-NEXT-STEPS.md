# dsh-auto-memory 预览版 · 下一步构建计划（2026-08-21 交接）

> 用途：上下文压缩后续接使用。本文件 + 项目笔记 MEMORY.md 可完整恢复现场。
> 工作区：D:\dsh-auto-memory（preview 分支）

## 0. 当前已完成基线（不要再重做）

- commit：`f00ad23`（preview 分支）—— v0.1.29 全部功能 + M0/M1 会话隔离 + `_dev→_pre` 标识。
- 关键结构（已落地）：
  - `SessionRuntimeStore`（WeakMap+Map）+ `AsyncLocalStorage` + `withAgent/currentRuntime/stateFor/aggregateAutoStats`
  - state/autoStats 是 getter → 107 处 `this.state.X` 自动 per-session（勿再引入 `this.state =` 赋值）
  - context.text 必须 `engine.withAgent(agent, ...)` 包裹（否则读 default runtime 为空）
  - turn-stopping 不猜 `_lastAgent`；GUI 路由允许 `_lastAgent` fallback
  - consolidate 锁/冷却/去重/重试队列 per-runtime（`runtime.lastConsolidateAt`），每日额度仍全局
  - `recordRuntimeEvent` 挂在 session-start/pre-step/turn-stopping
  - debugInfo 新增 `associativeMemory.runtimes`
  - 7 实验开关 + 4 预算参数在 DEFAULT_CONFIG（全默认 false）
- 测试全绿：smoke / reflect / external / isolation / consolidate-isolation（前 3 个 exit=1 是尾部 restoreLastAgent/rmSync 噪音，断言通过）。
- 重要纪律：
  - 用户个人文件（app.js、*.html、cc-switch-src/ 等 D 盘根目录未跟踪文件）**绝不 add/commit/改动**
  - 全文件保持 UTF-8 无 BOM；不发布 npm/GitHub/tag（除非用户明确要求）
  - 架构文档在 docs/（system-map/meta-code/architecture/研究报告/handoff），均已 `_pre` 化

## 1. 下一步构建物（按依赖顺序）

### P-A 预览版可用化（立即，无代码或小改）
1. 本地加载预览版：把 `~/.dsh/profiles/web/node_modules` 下 dsh-auto-memory 的 symlink 改指向 `D:\dsh-auto-memory`（或复制 preview 到独立目录安装），重启 DSH web 后 GUI 验收：面板、设置（autoPopup 开关、暂离）、工作区总览（zstd 修复生效）、外部记忆、日历。
2. 写 `tools/release-pre.mjs`：仿 release.mjs 反向——`_pre→正式`（工具名去 `_pre`、auto-memory-pre→auto-memory、`(pre)`/预览版 清理、package.json 转 @a9i5k4 身份），供将来正式发布预览版时用（现在不用发布）。

### P-B M2 ContextObserver（结构化事件观察）★ 首选
- 目标：把 hook 事件（session-start/pre-step/turn-stopping/tools-result）切成 `ContextSegment`（kind/text/contextVersion），维护 per-runtime context ring。
- 入口：已有 `recordRuntimeEvent`（生成 envelope + cursor + contextVersion）。在其之上加：segment 生成 + `runtime.segments` ring（容量/顺序）。
- 验收：事件可回放；contextVersion 单调递增；过期异步结果可丢弃；A/B 隔离不破坏。

### P-C M3 Markdown Anchor + MemoryFileIndex（稳定身份）
- 目标：memoryId/anchorId 稳定身份（架构图要求；行号仅 UI locator）。
- 做法：对 MEMORY.md/日志/反思建索引：anchor（## 标题/日期行）+ sourceVersion + recordDigest；```memoryId = workspace+anchor+digest```。
- 验收：同一记录多次读取得到相同 memoryId；sourceVersion 变化后 digest 变。

### P-D M4 Shadow Retrieval（默认关）
- 目标：关键词/实体/范围/时间衰减候选排序，**只记录命中日志、不注入**。
- 入口：`shadowRetrievalEnabled` 开关（已有）；给 engine 加 shadowRecall()，结果进 debug/审计，不改 prompt。
- 验收：开关关闭时零行为差异；打开后命中日志可见。

### P-E M5 Access Evidence Graph
- 目标：read 工具返回 coverage；seen/read/cite/reuse/success/correction 证据图；memory_access telemetry（衔接用户提过的"前端统计 read 次数"想法）。
- 入口：memory_read_pre / 工具结果 hook。

### P-F M6 InjectionBroker + pre-step Soft Injection（最后一个大块）
- 目标：MemoryPacket 生成与注入（maxPacketItems/Chars/packetTtlSteps/injectionCooldownSteps 已备）；activationLevel 渐进（index→hint→excerpt→checklist→resource→full，Proteus 启发）。
- 注入面：优先原生 context（不偏离 Native 通道）或 Agent Inbox next-step（架构图 planned）；softInjectionEnabled 默认关。
- 验收：A/B 无串线；packet 可解释（why/what/source/cost/expiry）；可审计可回滚。

### M7+ 远期（逐个里程碑，全默认关）
- M7 Python sidecar（embedding/图/rerank，需环境）；M8 Semantic/Profile candidate；M9 Procedure promotion（跨 session 成功证据门）；M10 reasoning adapter；M11 流式中断实验。

## 2. 用户曾提的 4 个想法挂靠位置
1. 每条记忆稳定索引 → P-C（memoryId/anchorId）
2. read citation 计数上报 → P-E（memory_access telemetry）
3. 犹豫指数上升注入 procedure skills → M6 的介入强度（认知状态只调强度、不触发检索）后续 M9
4. Google Proteus 渐进记忆激活 → M6 的 activationLevel 六级（仅概念启发，不宣称复现）

## 3. 每步通用验收
- `node --check lib/index.js`；跑 5 测试（smoke/reflect/external/isolation/consolidate-isolation）不回归
- 无 BOM；不碰用户文件；不 push/publish；默认关新功能
- 完成后按 handoff §383 汇报格式交差
