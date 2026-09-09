# 接续流程轴（Continuity Flow）

> 写于 2026-09-08，基于 **v2.2.6** 源码（含本次 G1/G3 改动）。
> 本文是**纵向时间轴**视角；[M-CM7-HANDOFF-LAYERED-RETRIEVAL.md](M-CM7-HANDOFF-LAYERED-RETRIEVAL.md) 是**横向分层**视角。两者互补。
> 目标：把从"水位上涨"到"新窗口推进"的全链路，逐阶段列出实现、参数、失败模式与不变量，作为后续改造与验收的共同基准。

---

## 0. 流程总览

| 阶段 | 名称 | 触发 | 实现入口 | 产物 |
|---|---|---|---|---|
| **S0** | 常态水位监测 | 每个 turn 的 pre-step | `checkWaterLevelAtStep()` `:1871` | 水位记录（`ratio` / `tokens` / `window`） |
| **S1** | 阈值判定与确认 | `ratio ≥ 0.75` 且轮次边界 | `:1892` | 确认卡 / 宿主兜底倒计时 |
| **S2** | 刷新仪式 | 确认通过或兜底到期 | `refreshRitualPrompt()` `:2049` | PLAN.md 重写 + 新账本 |
| **S3** | 材料组装 | 仪式完成或超时 | `buildContinueCarry()` `:2126` | `carryText` + 转写包 |
| **S4** | 建新会话 | 材料就绪 | `sessionController.create` | 新 sessionId + 工作区绑定 |
| **S5** | 状态沿用 | 会话创建后 | `selectModel` | provider / model / reasoningEffort |
| **S6** | 首轮注入 | 新会话首条 | `carryText` 作为 prompt | 新窗口上下文 |
| **S7** | 按需取回 | 推进中 | `memory_recall_pre` / `read` | 细节补充 |

---

## 1. 逐阶段详解

### S0 · 常态水位监测

| 项 | 值 |
|---|---|
| 实现 | `checkWaterLevelAtStep(agent, minGapMs = 5000)` `:1871` |
| 节流 | **5 秒**（`minGapMs = 5000`） |
| 测量点 | **pre-step**（`c4912f4` 修正） |
| 窗口来源 | 按**会话自身的模型**解析（`cc21f7f`），非默认模型；失败回退 `131072`，`waterLevelWindowTokens` 手动覆盖优先，60s 缓存 |
| 计量 | 官方 token-meter 公式（4 字符 ≈ 1 token + 每消息 4） |
| 输出 | `{ratio, tokens, window, source, model, threshold, at, live}` |
| 会话粒度 | per-session（`a257277` / `4f97af0`，session id 规范化带 `session-` 前缀） |

**为什么测量点必须是 pre-step**：官方自动压缩也在 pre-step 发生；若插件在 turn-stopping 才测，会被官方抢先（`c4912f4` 的核心修正）。

**失败模式**：窗口解析失败 → 回退 131072（水位虚高，可能误触发）；计量异常 → `ratio` 可能 >1（`482201f` 已改为上报真实比例，不再 clamp 到 150%）。

### S1 · 阈值判定与确认

| 参数 | 默认值 | 位置 |
|---|---|---|
| `waterLevelThreshold` | **0.75** | `:229` |
| `autoContinueThreshold` | **0.75** | `:237` |
| `autoContinueConfirmSeconds` | **35** | `:239` |
| `autoContinueCooldownMinutes` | **30** | `:245` |
| `autoContinueEnabled` | `true` | `:235` |

**触发条件**（`:1892-1893`）：
1. `autoContinueEnabled !== false`
2. `handoffEnabled !== false`
3. `wl.ratio >= autoContinueThreshold`（0.75）
4. **harness 权威 `running == false`**——轮次边界判定，取代旧"两轮水位持平"启发式

**0.75 的设计理由**：官方自动压缩阈值为 **80%**，0.75 留出余量抢在其之前（commit `ca75808`）。

**两条执行路径**：
- **浏览器路径**：轮询 `auto-continue-state`（`:6533`）显示确认卡，用户 35 秒内同意/拒绝。
- **宿主兜底路径**（`0107d73`，M-CM6-C）：浏览器被后台节流或关闭时，宿主侧心跳倒计时到期自动执行——建新会话不再依赖浏览器页面。

**失败模式**：冷却期内（30 分钟）不重复触发；确认超时按配置处理；host 未暴露 token 计数时退化为启发式估计。

### S2 · 刷新仪式（refreshRitual）

| 参数 | 默认值 | 位置 |
|---|---|---|
| `autoContinueRefreshRitual` | `true` | `:241` |
| `autoContinueRefreshTimeoutSeconds` | **90** | `:243` |

**执行方式**：`client` 通过 `remote.session.prompt` 把指令发回**旧会话**（`:2047`）。

**旧 AI 被要求做的事**（`:2050-2054`，本轮内只做这两件）：
1. `memory_note_pre(kind=plan, …)` 重写 PLAN.md（项目白板最新全貌）
2. `memory_note_pre(kind=handoff, …)` 写一篇四段式账本
   - 四段：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步`
   - 每段 ≤5 行；下一步必须是**可直接执行的第一步**，带文件路径或命令
3. 完成后只回复「已刷新」

**超时**：90 秒未完成 → **fail-soft**，用现有材料继续接续。

**已知缺陷**（见 M-CM7 §3.4）：
- 账本标题重复（追加写入时重复写 `# 交接账本` 标题，实测 6 个中 3 个）
- 段内异质：「已试方案与失败原因」实际混入**成功解法**；「进度与下一步」混入已完成项与元指令
- 白板退化为日志，无老化

### S3 · 材料组装（buildContinueCarry）

**实现**：`index.js:2126-2192`。降级链：工作区白板/账本 → 全局最近账本（`findLatestGlobalHandoff`）→ 无材料则 `ok:false`。

**四层材料**（`:2159`）：

| 层 | 内容 | 截断 |
|---|---|---|
| 第0层 | 指令 + 白板 PLAN.md | `slice(0, 3000)` |
| 第1层 | 交接账本（四段式，最新） | `slice(0, 8000)` |
| 第2层 | 近期线程（最近 20 条） | 单条上限 700 字，保留角色与工具标记 |
| 第3层 | 完整转写（按需 read） | 不内联，给路径 + 指引 |

**总预算**：`carryText.slice(0, 18000)`（`:2183`）。

**旧会话上下文包**（`buildPrevSessionPack()` `:2062`，M-CM6-B v2）：
- 定位 `~/.dsh/sessions/<ws>/<sid>/session.jsonl[.zstd]`
- **多帧 zstd 全量解压**（`zstdDecodeAllFrames`，单帧 API 只解 header）
- 提取 `cwd` / `agentPreset` / `provider` / `model` / `reasoningEffort`（取自 `request/header` 的 `data.header.config`，与官方投影同源；`request/context` 仅回退）
- 转写落盘 `handoff/prev-session-*.md`
- **fail-soft**：任何环节失败返回部分字段

**新鲜度标注**：白板与账本 mtime 比较，白板更旧时提示「以账本为准」（`:2152`）。

**接续序号**：统计 `handoff/` 中已有 `prev-session-*.md` 数量 +1（`:2179`）。

### S4 · 建新会话

- `sessionController.create`，传 **`workspaceId`**（`resolveWorkspaceIdForSession`，`:2156`）——官方只有 `workspaceId` 分支会 `attachSession`；这是 `b99576b` 的关键修正
- 会话标题编号：`接续#N · {wsBase}`（`bffe105`），便于区分新旧会话

**已知坑**（`f475321`）：`session.create` 返回**裸 SessionId 字符串**而非对象，需健壮解析（string / sessionId / id / value / `{ok,value}`）。

### S5 · 状态沿用

- `selectModel` 恢复 `provider` / `model` / `reasoningEffort`（`b99576b`）
- `create` 传 `agentPreset`（`bffe105`）
- 前置条件：`session/prompt` 需带 `clientTimeZone`（IANA，经 `Intl` 获取），否则 host 拒绝（`6a94794`）
- 插件全局配置（无人值守 / 水位 / 交接）自动继承

**注意**：`agentPreset` 有 `code → ptc` 改名的历史包袱，旧会话需用户级兼容预设（`:2174` 已提示）。

### S6 · 首轮注入

`carryText` 作为新会话首条 prompt。

**指令文案（本次 G1 改动，`:2158`）**：

| | 文案 |
|---|---|
| 改前 | 请**先读完**下面的交接材料恢复上下文，然后直接继续推进… |
| 改后 | **材料已分层，请按需取用而非通读**：先看第0层白板建立全局图景，再视需要看第1层账本（含已试方案与失败原因）与第2层近期线程；**第3层完整转写仅在前三层不足以推进时才 read**。恢复上下文后直接继续推进… |

**第3层指引（本次 G3 改动，`:2168`）**：

| | 文案 |
|---|---|
| 改前 | **接续前先用 read 工具读取该转写文件**，以完全理解旧会话的讨论、结论与未竟事项 |
| 改后 | 完整转写已归档，**不必在接续前通读**：仅在第0-2层不足以推进时再 read；优先用 `memory_recall_pre(scope='sessions', query='关键词')` 定位片段，避免整篇读入 |

**改动意图**：分层此前被"全读"指令架空——模型被要求通读就不会选择性取用。改后分层才真正生效。

### S7 · 按需取回

- `memory_recall_pre(scope='sessions' | 'handoff' | 'all', query=…)`：轻量直返，带 provenance 与预算截断
- `read`：完整转写（仅在前述不足时）
- `memory_recall_pre` 亦可跨 WorkBuddy / CodeBuddy / Claude Code / Codex / ZCode / Kimi Code / TRAE 检索

---

## 2. 关键不变量（Invariants）

改造接续通路时，以下五条**不得破坏**：

| # | 不变量 | 依据 |
|---|---|---|
| **I1** | **前缀缓存字节级稳定**：只动动态快照层，静态纪律层字节不碰 | 项目核心约束 |
| **I2** | **不替 host 决定压缩**：只在 host 允许时点助产，开新窗是 host 领地 | M-CM-PLAN §5，与 Codex `new_context` 同边界 |
| **I3** | **凭证永不进提示词**：所有写入过 `sanitizeForWrite`，注入前 `stripSensitiveSections` | README 承诺 |
| **I4** | **绝不阻塞接续**：任何新增环节必须 fail-soft，缺失即回退 | S2/S3 均已有降级链 |
| **I5** | **水位测量在 pre-step**：不得退回 turn-stopping，否则被官方压缩抢跑 | `c4912f4` |

**对 M-CM7 的含义**：锚点 sidecar（G2′）若在 S2 同轮产出，不违反 I4（缺失回退四层平铺）；若改为异步产出，则需额外确认 S3 组装时不会因等待而阻塞。

---

## 3. 时序与预算约束

| 约束 | 值 | 说明 |
|---|---|---|
| 水位阈值 | 0.75 | 官方压缩 0.80，留 0.05 余量 |
| 确认倒计时 | 35 s | 无人操作 = 挂机 → 自动接续兜底 |
| 刷新仪式超时 | 90 s | 超时用现有材料继续 |
| 接续冷却 | 30 min | 防止连续触发 |
| 水位检查节流 | 5 s | pre-step 不重复测 |
| 材料总预算 | 18000 字符 | `carryText` |

**关键时序链**：`水位 ≥0.75（pre-step） → 确认/兜底（≤35s） → 刷新仪式（≤90s） → 组装 → 建会话`。
**必须整体早于官方 80% 压缩点**，否则助产失效——这是 0.75 而非 0.79 的原因。

---

## 4. 已知缺陷与改造落点

| # | 缺陷 | 阶段 | 改造 | 状态 |
|---|---|---|---|---|
| 1 | 指令要求"先读完"，分层被架空 | S6 | G1 | ✅ 已改 |
| 2 | "接续前必须先 read 转写"，强制全量读 | S6 | G3 | ✅ 已改 |
| 3 | 各层与总预算为**位置截断**，高权重段可能被整体截掉 | S3 | G4 / G5 | 待做 |
| 4 | 无锚点索引，模型不知有哪些可下钻项 | S3/S6 | G2′ | 待做（纯解析方案已作废） |
| 5 | 账本**标题重复** | S2 | G2″ | 待做 |
| 6 | 白板退化为日志，无老化 | S2 | G2″ | 待做 |
| 7 | 段内异质，按段加权必错配 | S2/S3 | G2′（条目级） | 待做 |
| 8 | 纯函数核心未抽出，缺 fixture 锁定 | S3 | G6 | 待做 |

---

## 5. 验收基线（本次改动后）

| 检查 | 结果 |
|---|---|
| `node --check lib/index.js` | ✅ 通过 |
| `smoke-test-continue-chain-pre` | ✅ **58 passed, 0 failed** |
| `smoke-test-handoff-pre` | ✅ **pass=51 fail=0** |
| BOM | 无 |
| 行尾 | CRLF 保持 |

**待补**：行为级断言——G1/G3 属文案改动，现有 smoke 无文案断言（已确认无依赖），建议后续为"carryText 不含强制全读措辞"补一条守卫断言，防止回退。

---

## 6. 一句话

**这条流程轴的本质是：在 host 划定的压缩边界之前（0.75 < 0.80），用一次受控的"写—组装—注入"把上下文搬过窗口边界；分层是搬运的形态，而"按需取用"才是搬运能否省钱的关键。**
