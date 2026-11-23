# Prompt：2.3 事件归属建议与异常提醒——生产接线施工任务书

> 日期：2026-11-16
> 工作区：`D:/dsh-auto-memory`
> 分支：`preview`
> 开工 HEAD：`52584425`
> 执行者：复用同一 DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`
> 用户裁定：可以开始 2.3。规划须细化后交 DeepSeek teammate 执行。
> 本批性质：**生产代码的本地实现与隔离验收**。不是发布、不是真实记忆迁移、不是 2.4 归并授权。

## 0. 先读权威文档，不能只按本任务书猜测

必须读取并遵守：
1. `docs/internal/CONSTRUCTION-PLAN-20261108.md` §2.3（约 218–250 行）与 §批次3、§5.1。
2. `docs/internal/DETAIL-BATCH2-20261108.md` §2.3（约 533–912 行）。
3. `docs/internal/DETAIL-BATCH3-IMPLEMENTATION-20261113.md` §8–§10。
4. `docs/internal/PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`，尤其四态、通用模型裁决与 proposal-only 边界。
5. `docs/internal/HANDOFF-SIDECAR-PRODUCTION-WIRING-POST-23-20261112.md` §1–§5；本批只冻结其所需的 2.3 profile/API，**不接 SidecarStore facade**。
6. `docs/internal/RESULT-EVENT-ATTRIBUTION-CLASSIFICATION-20261116.md`，尤其候选截断缺陷与多合理候选 0.5946。
7. `docs/internal/ANALYSIS-EVENT-ATTRIBUTION-SIGNALS-20261116.md`，时间只作约束/弱证据。

冲突时以最新用户裁定与当前代码为准；旧文档中的 C2 分数、margin 自动 attach 示例、阈值归并示例不得复制进生产。

## 1. 目标与边界

### 本批必须完成

- 冻结共享 `event-attribution/v1` 提案协议。
- `memory_log`：在未归属或疑似错误归属时，调用宿主既有模型能力进行复核，把建议/警告作为工具文本回执返回。
- `memory_note`：对采用显式事件归属的路径提供只读复核入口，返回提案而不写正文/账本/事件。
- 历史账本：用现有 R1/R2/R3 模块完成 AI 分类的**零写提案**，不接 apply、不发确认令牌。
- 真执行、负路径、隔离变异、相关回归、结果报告。

### 明确不做

- 不改变 1.4 的自动 attach/create 规则，不以模型输出重定目标。
- 不自动 attach / merge / archive，不接 `applyRegroupPre`、`writeCuratedEventsPre`、2.4。
- 不改 `lib/client.js`、皮肤、生成器或前端。
- 不接 SidecarStore facade、R4-on、生产迁移或真实记忆。
- 不新增工具数、HTTP 路由数或配置键（当前 22 / 86 / 181）。
- 不新增直接网络请求、第三方插件依赖、下载模型或安装依赖。
- 不重启/占用 19387，不 push、不发版、不称 RL。

## 2. 当前代码事实与基线

开工实测：
- `lib/index.js`：2,172,889 B；29,872 个 CRLF、裸 LF 0；全文 SHA-256 `f6bf9effec3bc4b576406037d99e88c04426d1b22aa5c5541a68bcbd6344531d`。
- `lib/event-write.js`：57,349 B；983 个裸 LF、CRLF 0；SHA-256 `839f5116189387abda7ce52b4818ac69aed2b0748c2e7f50a0709471b5643105`。
- 当前 `memory_log` 的 L2 位于 `lib/index.js:25138`，top-3/margin；dryRun 位于约 `:25217`。
- 当前 L2 触发主要是 `_attr.decision === 'create' || args.dryRun === true`，且 `!evId`；疑似错误的自动 attach 尚无通用模型复核。
- 当前 L2 候选池有 `_pool.slice(0, 32)`；不得把 top-K 当成无遗漏全集。
- `runSubagent(text,label,agent,timeoutMs,override)` 在 `lib/index.js:18125`，返回文本；内部复用宿主 subagent，空串代表不可用/失败。生产可调用 `this.runSubagent(...)`，不得新建网络通道。
- `event-regroup-propose.js` 提供 JSON 提取/严格校验；`event-regroup-scan.js` 提供扫描/prompt；`curateUnarchivedPre` 当前是确定性草案，与 `writeCuratedEventsPre` 分离。

动工前再次读取并记录：
1. `git status`、HEAD、目标文件 bytes/lines/line endings/SHA-256、真实 import 导出数。
2. 写入前重测同组指纹；不同即停机上报，不吞其他线改动。
3. 全仓检索受影响的基线锁/计数锁/抽取式夹具/锚点，尤其 r26、v4-event-attr-receipt、v4-h1b-memory-log、regroup R1/R2/R3、SUBAGENT 相关套件。
4. 禁止整文件 write `lib/index.js`；只用内容锚定小补丁。保持 CRLF，其他文件保持原行尾。

## 3. 系统化、模块化、API 化构筑约束

**不得把本批业务逻辑继续内联堆进 `lib/index.js`。** 新建独立模块目录 `lib/event-attribution/`，通过公共 API facade 接入现有工具。

建议模块边界（可按代码风格微调名称，但职责不得混写）：

| 模块 | 单一职责 | 禁止事项 |
|---|---|---|
| `contract.js` | schemaVersion、DTO、默认值、字段/枚举不变量 | 不读文件、不调模型 |
| `candidate-pool.js` | eligible 候选、LOO、证据视图、截断与 pool 元数据 | 不写事件库、不做归属判定 |
| `prompt.js` | 输入规范化、prompt/profile 构造与 promptSha256 | 不直接调用宿主 |
| `parser.js` | 严格 JSON 提取、四态校验、真实 eventId 白名单 | 不自行猜测或修补非法 ID |
| `reviewer.js` | 触发后的复核编排、模型结果与 pool/DTO 合并 | 不写文件、不渲染 UI |
| `receipt.js` | proposal → 简洁工具文本提醒 | 不改变原工具写入结果 |
| `host-model.js` | 宿主 runSubagent 适配、超时/空输出/错误归一化 | 不新建网络通道、不实现业务判定 |
| `regroup.js` | 现有 R1/R2/R3 的历史零写提案适配 | 不接 apply/confirmToken |
| `index.js` | 唯一公共 facade/导出，冻结 API 形状 | 不堆积实现细节 |

公共 API 建议为 `createEventAttributionService(ports)`，暴露 `review(input)`、`reviewExplicit(input)`、`proposeRegroup(input)`、`renderReceipt(proposal)`、`profile`。通过依赖注入提供 `modelPort`、`embeddingPort`、`clock` 等端口；领域核心不得依赖 `lib/index.js`、文件系统或宿主私有字段。

- `lib/index.js` 只做参数适配、调用公共 API 和追加原工具文本回执，不复制协议、解析、候选或模型判定逻辑。
- `memory_log`、`memory_note`、历史 regroup 共用同一 facade，不另造平行实现。
- API 必须能独立真 import、真构造、真调用；测试可用 fake ports，生产 host adapter 单独验证。
- 冻结 `EVENT_ATTRIBUTION_PROFILE_V1`：promptVersion、inputNormalizationVersion、eventRepresentationVersion、candidatePoolPolicy、host route、超时与预算；模型变更不得隐式复用旧证据/向量/结论。
- 新公共导出的数量与形状写入报告；`lib/index.js` 的既有导出数量不变。

## 4. 共享协议：event-attribution/v1

公共入口为 `lib/event-attribution/index.js`。领域模块负责构造输入、解析/校验模型输出、生成 proposal DTO 与回执文本，不得自行读写事件库或文件系统。

建议统一形状（可按代码风格微调字段名，但必须在报告中冻结）：

```js
{
  schemaVersion: 'event-attribution/v1',
  status: 'proposal-only',
  trigger: 'unassigned' | 'suspect-auto-attach' | 'explicit-review' | 'historical-regroup',
  decision: 'attach-existing' | 'create-new' | 'ambiguous' | 'not-applicable' | 'unavailable',
  selectedEventId: string | null,
  candidates: [{ eventId, score: number | null, margin: number | null, evidence: string[] }],
  rationale: string,
  counterHypothesis: string,
  warnings: [{ code, message, eventIds: string[] }],
  pool: {
    eligibleCount: number,
    visibleCount: number,
    omittedCount: number,
    truncated: boolean,
    coverage: 'complete' | 'partial' | 'none'
  },
  modelIdentity: {
    route: 'host-subagent',
    job: 'event-attr',
    promptVersion: string,
    promptSha256: string,
    requestedProvider: string | null,
    requestedModel: string | null,
    resolvedProvider: string | null,
    resolvedModel: string | null,
    embeddingIdentity: object | null
  }
}
```

约束：
- `selectedEventId` 只能是输入中真实存在、当时可候选的 ID；模型创造 ID、closed ID、越界 ID 一律拒绝。
- `score/margin` 只填真实计算值；语言模型没有给出可验证数值时为 null，禁止编造置信度。
- `ambiguous` 必须允许 `selectedEventId=null`，保留多个候选，不强行择一。
- `unavailable` 表示模型/解析/超时不可用，不等于 create-new。
- `modelIdentity` 区分请求配置与实际观测；`runSubagent` 不返回实际 provider/model 时，resolved 字段为 null，不得猜测。
- `memory_log`、`memory_note` 继续返回原有文本类型；由共享渲染器追加必要提醒，不能把原返回改成对象。

## 5. 触发条件：正常路径不额外烧模型

### 4.1 memory_log

按以下规则实现，必须逐项测试：

| 场景 | 是否模型复核 | 回执行为 |
|---|---|---|
| 显式 eventId 的真实写入 | 默认不调用 | 保持当前显式归属，不事后质疑用户 |
| 高置信单标识命中、无冲突 | 默认不调用 | 保持现有正常回执 |
| 未传 eventId，L1/词袋预判 create | 调用（可用时） | 模型可建议已有事件/支持新建/ambiguous/not-applicable；实际写入不被改写 |
| 预判 attach，但 reason=wordbag/legacy、标识多命中或证据冲突 | 调用（可用时） | 模型同意则保持安静；不同意或有风险则追加警告 |
| dryRun，包括显式 eventId | 调用（可用时） | 返回 proposal-only 建议，绝不写记忆或事件 |
| 模型不可用/超时/非法输出 | 不重复轰炸 | 降级为现有 L1/L2 回执并注明 unavailable；不阻塞真实写入 |

**重要**：模型复核可以在实际写入前计算，但它只是建议。真实写入仍走原路径；若模型不同意，回执必须说清“当前按既有规则已挂/已新建，模型建议复核另一个事件或不建议归属”，不得伪称已按模型修正。

### 4.2 memory_note

新增**可选、显式**的只读复核参数（建议 `attributionReview:true`；若现有参数体系已有等价物则复用）：

- 仅对 `kind=handoff` 或显式 `eventId` 的事件归属场景生效。
- `attributionReview:true` 时只返回提案与提醒，**不得写 MEMORY.md、账本、PLAN、维护文档或事件检查点**。
- 对 `kind=note/user/plan` 等非本事件链场景，明确 `not-applicable`，不得硬编事件。
- 不传该参数时，现有 `memory_note` 行为逐字保持；不增加默认模型调用。
- dry-run/review 的文件零写范围须明确为记忆文件与事件库；宿主 subagent 运行日志属于另一类可观测副作用，不得混称“整机零文件写入”。

## 6. 候选、证据与 LOO

1. 候选来自写入前快照，排除未来创建事件；closed 不可作为新写入目标，paused 只能带标记提案。
2. 候选证据优先 `name + summary + 最近 checkpoint.goal/state`，缺失回退 text；不得包含当前记录自身或后写入内容。
3. 保存来源/时间/状态/标识匹配与 L2 分数；时间只作硬约束与弱证据，不按“越近越好”加分。
4. 先建立所有 eligible 候选的清单，再构造模型输入。
5. 如因预算必须 top-K，必须记录 eligibleCount、visibleCount、omittedCount、truncated=true、coverage=partial，并降低可辩护结论等级；**不得静默截断**。
6. 离线/测试报告必须同时给 gold coverage；正确目标被裁掉时不得判模型失败，也不得让模型自信选择剩余项。
7. 模型失败时回退到现有词法/L2 提示，不回退到“随意新建”或“最近事件”。

## 7. 宿主模型调用与降级

- 生产仅复用 `this.runSubagent(prompt, 'auto-memory-event-attr', this._lastAgent, timeoutMs)` 或当前等价的既有调用。
- 不改 `CROSS_WS_ALLOWED_LABELS`，不授予跨工作区写权限。
- 解析模型文本时使用严格 JSON schema；可复用 `extractJsonPre` 的提取思路，但四态校验属于本协议，不能混用事件归并 schema。
- 空串、非法 JSON、未知字段、未知 eventId、超时、subagent 不可用均为 `unavailable` 或明确的 `ambiguous`；不能 fail-open 成自动 attach。
- 不在普通高置信路径加载模型；不因模型失败回滚已经成功的记忆写入。
- 捕获错误必须返回可观测状态，禁止空 catch 吞掉门控语义。

## 8. 历史账本零写提案

按 DETAIL-BATCH2 §2.3 与现有 R1/R2/R3：

1. 新增 `proposeRegroupPre` 或等价只读方法，产出：
   - suggestions：机械建议，带 confidence/rationale，AI 可全部推翻；
   - prompt：R2 的真实 AI 输入；
   - badNames：命名闸未通过项；
   - cost：可复算估算；
   - 调用模型时的严格 AI 提案。
2. dryRun 只预览 prompt，不启动子代理；实际 propose 可调用宿主模型，但不写盘。
3. 复用现有 HTTP 操作分支（若已有 op 可扩展），**不新增路由**。
4. 不调用 `writeCuratedEventsPre`、`applyRegroupPre`，不签发 `confirmToken`，不修改 `_curateToken`。
5. AI 返回的 members 必须属于本批，事件名过闸，账本覆盖/守恒校验通过；任一不合格 fail-closed。
6. 保留现有 `curateUnarchivedPre` 与人工确认写入路径的兼容行为，不把旧路径替换为自动归并。

## 9. 实施顺序

### P0：基线与协议测试先行
- 新增 `lib/event-attribution/index.js` 与新专项 smoke。
- 先写能证明旧缺陷的用例：疑似错误 attach 无复核、候选被截断、模型非法 ID、review 误写、propose 调 apply。
- 真 import → 真构造 → 真调用 → 断言返回值；静态源码断言只能标为守卫。

### P1：memory_log
- 完成共享 DTO、触发条件、宿主模型调用、降级与文本回执。
- 保留显式 eventId、L1、词袋、现有 L2、写入顺序与三态回执。
- 每改一处跑相关套件，不攒到最后。

### P2：memory_note 与历史零写提案
- 先 review-only，确保所有记忆/事件文件不变，再接历史 propose。
- 与 P1 共用协议，不另造平行返回格式。

### P3：回归、隔离 HOST（能力允许时）与报告
- 相关套件、r26 重钉、verify-docs、`--impact-run`。
- 只有隔离 DSH_HOME/profile 与真实 HOST 条件满足时才做真机；不得用生产 19387。
- 若未做真实 HOST，结果明确列“未验证”，不能拿 smoke 冒充。

## 10. 必测用例与变异

至少覆盖：
1. dryRun 未归属 → 模型建议已有事件；记忆/事件字节不变。
2. 真实写入预判 create、模型建议已有事件 → 原写入不被重定目标，回执含候选警告。
3. 低置信 attach、模型否决 → 不改既有写入，返回疑似错误归属提醒。
4. 模型同意 → 正常路径不增加多余警告。
5. 显式 eventId 真实写入 → 模型调用 0 次。
6. 多合理候选 → ambiguous，不强行 attach。
7. 模型返回未知/closed/未来 ID → fail-closed，不采纳。
8. 空输出、坏 JSON、超时、宿主不可用 → 明确降级，写入/预检不崩。
9. 候选被预算截断 → pool 明示 partial；gold coverage 在测试报告可复算。
10. memory_note review → 所有记忆/账本/PLAN/维护文档/事件不变。
11. 历史 propose → R1/R2/R3 真调用，apply/write/confirmToken 调用 0 次。
12. 既有 `memory_note(kind=note/user/plan)` 与 `memory_log` 显式/标识路径行为不变。

隔离变异至少抓：
- 删除 suspect-auto-attach 触发；
- 模型输出直接重定事件目标；
- review 变成真写；
- 静默候选截断；
- propose 调 apply 或发 token；
- 模型 unavailable 被当作 create-new。

变异只在内存抽取源码或隔离副本进行，不在共享工作区就地改生产文件。

## 11. 验证命令与计数纪律

按实际受影响面执行并保存输出：
- `node --check lib/event-attribution.js`
- `node --check lib/index.js`
- 真 import `lib/event-attribution/index.js` 与 `lib/index.js`，核对导出数与基线。
- 新专项、v4-event-attr-receipt、v4-h1b-memory-log、regroup R1/R2/R3、r26 及其他命中套件。
- `node tools/run-smoke.mjs --impact-run --jobs=8 --timeout=180000`
- `node tools/verify-docs.mjs`，工具/路由/配置仍 22/86/181。
- 大节点需要全量时再跑 `node tools/run-smoke.mjs --jobs=8 --timeout=180000`；未跑则如实写未跑，不冒称全量通过。

r26 或其他锁若因有意改动变红：先归因，再用套件自身表达式对当前源码真跑复算重钉；全仓检索同锁，禁止手填哈希或整批回滚。

## 12. 交付与写域

只写：
- `lib/event-attribution/`（公共 facade 与全部领域模块）
- `lib/index.js`
- 必要时 `lib/event-regroup.js` / `lib/event-regroup-scan.js` / `lib/event-regroup-propose.js`
- 必要的新增/受影响 `tests/smoke/*`
- `artifacts/_event-attribution-implementation-20261116/`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-IMPLEMENTATION-20261116.md`

不改本任务书、总表、NEXT-STEPS（Lead 负责）；不碰无关未跟踪产物。

报告必须分列：
- 实际改动文件、行数/字节/导出变化；
- 各触发路径与返回示例；
- 候选池/截断与 gold coverage；
- 真执行 PASS/FAIL、负路径、变异 CAUGHT/MISSED；
- r26/计数/行尾/指纹；
- 生产未做项、真实 HOST/跨语言/伞事件/多候选未验边界。

**不 commit/push，由 Lead 审查后统一本地提交。** 若发生阻断，保留成功部分与失败证据，不伪造完成。
