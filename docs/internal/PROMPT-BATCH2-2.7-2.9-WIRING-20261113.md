# DeepSeek 执行定稿：2.7 正文形态与 2.9 真实接线

> 日期：2026-11-13（Asia/Hong_Kong）
> 工作区/分支：`D:/dsh-auto-memory` / `preview`；基线 `3d3c4547`。
> 执行者：前两位既有 DeepSeek teammate，分别承担 task-17 / task-18；不使用 Kimi。
> 本定稿取代旧细则中“先写 Phase 1、以后再补真实指针”及“指纹仅放 panels”的冲突方案。

## 1. 用户裁定与范围

1. **G-1 定稿：不添加容器事件。** 不新增工作区级配置、containerEventId 或 source=container。显式 eventId、既有 active/paused 校验、created/fallback 规则不变。
2. **G-2 定稿：摘要上限 300 个 JS UTF-16 字符。** 该长度可容纳约 150 个常见汉字；它是字符数而非 UTF-8 字节数，不承诺恰好 150 字。超长可观测，不能静默丢失来源。
3. 2.7 改旧 `memory_note` 的 plan/handoff 检查点正文：从全文改为确定性摘要 + sourceRef + 完整 raw/normalized 指纹 + bytes + 四段。
4. 2.9 将已有规范化、四段解析、真实来源证明和覆盖评估接入旧 handoff 的真实写入/读回路径。
5. 不改 `memory_log` 正文，不改 R4-on 的 LedgerDocSystem WAL/CAS/create-only，不迁移或删除旧检查点，不开启生产，不重启/写入 19387，不做 2.3/2.4/SidecarStore/前端，不 commit/push。

## 2. 必须遵守的实际源码事实

- 旧 `appendHandoffCheckpointPre` 当前仍写 `text:ledgerText`，其 idemKey 基于完整正文；不可把摘要哈希当成完整意图身份。
- 真实 handoff 的文件名/最终标题/锚点只在 `writeHandoffLedger()` 成功并落盘后才存在；真实 PLAN 只有 `writePlanSnapshot()` 成功后才存在。
- `readEventCheckpointPre` 与 `readPointerPre` 已要求完整 `rawSha256` 与 `normalizedSha256`；`normalizedSha256` 此处是 `ledger-doc/protocol.js normalizeText` 口径。
- 2.9 的 `normalizedSha256` 是覆盖规范化口径；`documentNormalizedSha256` 才是上述指针口径。两者绝不能互换。
- `event-store.js` 会过滤未登记字段，故新字段必须在存储白名单中显式保留。
- 白板写盘已有 Phase 0、CAS/M1/用户区和 fromEvents 保护；不能为了摘要绕过它们。

## 3. 共同调用契约（task-17 / task-18 均按此实现）

### 3.1 task-17 新模块 `lib/handoff-checkpoint.js`

导出 `HANDOFF_CHECKPOINT_SUMMARY_CHARS = 300` 和纯函数：

```
buildHandoffCheckpointSummaryPre({ kind:'plan'|'handoff', text, quad })
→ { ok:true, kind, text:<至多300字符>, truncated:boolean,
    sectionsOverride:{goal,state,dead,next} }
```

- 摘要确定性、可复算；优先保留 goal/state/dead/next 的有效内容，可以带简短字段标签。
- 只从已落盘正文取得原始四段；绝不解析摘要回填四段。plan 无四段为合法。
- 输入不可变；空正文、非法 kind、非对象 quad 等负路径显式返回/抛出可判读错误。
- 不读盘、不推断 eventId、不调用模型、不写文件。

### 3.2 task-17 扩展 `appendHandoffCheckpointPre`

新可选参数只在摘要路径使用：

```
{
  ledgerText:<真源完整正文，供幂等身份使用>,
  summary:<buildHandoffCheckpointSummaryPre 的返回>,
  sourceProof:<task-18 经 buildHandoffSourceProofPre 从真实文件获得的证明>,
  sectionsOverride:<原始四段 goal/state/dead/next>,
  panels:[...],
  原有 kind/eventId/today/boundaryMinutes/四类感知
}
```

- 无 summary/sourceProof 的旧调用保持原文、四段、幂等与感知事务不变。
- 摘要路径的 `checkpoint.text=summary.text`；`sourceRef=proof.sourceRef`；`bytes=proof.bytes`；`rawSha256=proof.rawSha256`；`normalizedSha256=proof.documentNormalizedSha256`。
- 幂等身份仍含完整 ledgerText，不得只用 300 字符摘要。
- 原始四段必须显式映射到 goal/state/dead/next，不能被摘要解析结果覆盖。
- 新摘要路径返回值增加 `checkpointIndex`（真实落库后从所选事件读回）；旧调用无需添加。
- `event-store.js` 仅追加 rawSha256/normalizedSha256 的可选保留；bytes 已有保留。不得破坏既有 `sha256` 历史语义。

### 3.3 task-18 新模块 `lib/handoff-write.js`

导出：

```
appendStoredHandoffCheckpointPre({
  storePath, handoffDir, sourcePath, kind, eventId, today, boundaryMinutes,
  userPercept?, agentTrace?, sharedGround?, commitment?
}) → {
  ok:true, eventId, checkpointIndex, sourceProof, coverage?,
  deduped, summaryChars, sourceBytes
}
```

流程：
1. `sourcePath` 必须是由引擎真实写盘返回、位于可信 `handoffDir` 内的文件；PLAN 对应同一 handoffDir 下 `PLAN.md`。
2. 读取真实 UTF-8 字节；用 `buildHandoffSourceProofPre({documentText,sourceRef,expectDiskText:true},{handoffDir})` 取得证据，失败不得写检查点。
3. handoff 必须调用 `parseHandoffCoveragePre` 解析实际原文，并调用 task-17 的纯函数生成摘要；plan 走同一摘要/指针契约，不强套 handoff 完整性。
4. 调 task-17 扩展后的 `appendHandoffCheckpointPre`，传完整正文作身份、摘要作 text、真实证明和四段。
5. 用真实 eventId + checkpointIndex 读回同一事件里的同一检查点。handoff 调用 `assessHandoffCoveragePre`，给真实 event 对象、检查点选择器、legacyCheckpointKey（用既有 `computeLegacyCheckpointKey`）、真实来源与 handoffDir。
6. `coverage` 是内容覆盖诊断，不是删除/归档/自动认领许可。缺证据、漂移或不匹配须如实返回，不可改判 covered。

另导出 `assessStoredHandoffCheckpointPre({storePath,handoffDir,eventId,checkpointIndex|idemKey})`：只读真实事件库，使用既有 `selectEventCheckpointPre`，再调用 `assessHandoffCoveragePre`；不得猜最近事件、越界或改数据。

## 4. task-18 对共享入口的独占接线

只允许 `lib/index.js` 在旧 `memory_note` 路径做以下改动：

- 保留 R4-on 的现有分支原样；保留 plan 的 Phase 0 和 writePlanSnapshot 既有保护。
- 旧 handoff 在 `writeHandoffLedger` 成功后再调用 `appendStoredHandoffCheckpointPre`；旧 plan 在 `writePlanSnapshot` 成功后再调用同一函数。
- 因此摘要路径不得先执行旧 Phase 1 全文检查点。`walEventId` 必须取本次新 API 的真实 eventId，plan mirror 继续沿用。
- 文档写失败且没有任何摘要检查点写入时，不得再伪造“原内容已记入前一检查点”的 Phase 3 记录；如实报文档失败。
- 文档已写而摘要/事件写入失败时，明确区分“文档已落盘、事件未记”，不得回滚或删除文档，不得静默重试。
- 不改 `writeHandoffLedger` 的其他直接调用者；紧急/水位直调不新增未经批准的副作用。
- 不新增工具、路由、配置或前端；不改工具 schema 的枚举。

## 5. 写域

| 任务 | 独占写域 |
|---|---|
| task-17 | `lib/handoff-checkpoint.js`、`lib/event-write.js`、`lib/event-store.js`、`tests/smoke/smoke-test-batch2-2.7-checkpoint.mjs`、`docs/internal/RESULT-BATCH2-2.7-CHECKPOINT-20261113.md` |
| task-18 | `lib/handoff-write.js`、`lib/index.js`、`tests/smoke/smoke-test-batch2-2.9-wiring.mjs`、`tests/smoke/smoke-test-r26-cross-layer.mjs`、`docs/internal/RESULT-BATCH2-2.9-WIRING-20261113.md` |

除这些文件外不得改任何已跟踪文件；不得清理别人的未跟踪产物。既有测试若因“全文→摘要”的有意语义变化失败，记录并通知 Lead，不得自行删除旧断言。

## 6. 验收硬门

1. 真 import → 真构造/真调用 → 真实隔离文件与事件库读回 → 返回/副作用断言；源码含字符串只能作守卫。
2. 新 handoff/plan 的 `text.length ≤300`；四段来自真实原文；真实磁盘字节、raw SHA、指针 normalize SHA、bytes、sourceRef 逐项复算。
3. 用既有 `memory_recall(expand=evt + eventId + checkpointIndex/idemKey)` 或真实 `readEventCheckpointPre` 还原真实来源；旧全文检查点仍可读，缺指纹/漂移/缺失均不误判。
4. 幂等：相同真实意图重复调用不重复追加；同一路径但超出摘要部分的内容改变仍须产生新检查点。
5. 覆盖证明必须来自真实事件成员与选择器；closed 写入、未知事件、绝对/点段/根外/链接路径均拒绝。
6. 保留 R4-off 旧写盘/R4-on WAL/2.6 显式归属/2.8 plan 预检/2.5 默认关闭。专项与相邻回归通过；受影响的 `lib/index.js` r26 锁按套件自身 LF 管道复算并写归因。
7. 至少三类隔离变异：全文回填、四段从摘要错误派生、指纹或真实事件绑定绕过；必须实测 CAUGHT。变异只改隔离副本，不改共享工作树。
8. 不宣称生产 HOST、真实模型、全仓回归或生产开启已完成。交付物理量、PASS/FAIL、负路径与剩余边界。

## 7. 回滚与报告

- 回滚是恢复旧 plan/handoff 的写入/检查点顺序；已写摘要检查点不可删除或改写，原文仍在。
- task-17 / task-18 各自只读核对 git diff，报告文件、API、测试命令与数字；不 commit/push。
- Lead 在两线返回后检查最终 diff、补既有断言的语义迁移、独立复跑并决定后续 HOST；不直接开启生产。
