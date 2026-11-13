# task-18 · 2.9 真实接线结果（handoff-write）

> 日期：2026-11-13；工作区 D:/dsh-auto-memory；分支 preview；基线 1cbc0ce7
> 执行者：DeepSeek teammate f85e76fa-8c82-4853-9567-4934fd309d49（task-18）
> 状态：**未 commit / 未 push**；未开启生产；未触碰真实记忆与 19387

## 1. 交付物（按当前实际交付）

| 文件 | 字节 | 说明 |
|---|---|---|
| lib/handoff-write.js | 29,097 | 新增模块：真实落盘读取 → 可信 sourceProof → 摘要 → 检查点 → 读回 → 覆盖评估 |
| lib/index.js | 见 §7 | 独占接线：旧 memory_note 的 plan/handoff 走共享入口 |
| tests/smoke/smoke-test-batch2-2.9-wiring.mjs | 见 §7 | 专项套件，**PASS 90 / DONE 122**（含 32 条负路径 + 4 组隔离变异） |
| tests/smoke/smoke-test-r26-cross-layer.mjs | 见 §7 | 按本套件自身 LF 管道复算并重钉 |
| tests/smoke/smoke-test-v4-h2-h0-wiring.mjs | 见 §7 | H2-3/H2-7 判据迁移 + 新增 H2-9/H2-10 |
| tests/smoke/smoke-test-i332-write-contract.mjs | 见 §7 | 抽取壳补桩 + ⑨⑩ 顺序不变量迁移 |
| docs/internal/RESULT-BATCH2-2.9-WIRING-20261113.md | — | 本报告 |

task-17 的 lib/handoff-checkpoint.js（8,269 B）、event-write.js 摘要路径、event-store.js 指纹白名单**已交付并已被本模块实际调用**（Lead 独立复跑 30/0、4 变异 CAUGHT）。

## 2. 模块 API（已实现并真调用）

```
appendStoredHandoffCheckpointPre({
  storePath, handoffDir, sourcePath, kind, eventId, today, boundaryMinutes,
  identityText?, identityPath?,   // 幂等身份复刻旧口径
  userPercept?, agentTrace?, sharedGround?, commitment?
}) → { ok, schemaVersion, eventId, checkpointIndex, sourceProof, fingerprintScopes,
       coverage, pointerCoverage, coverageLimitation, pointerReadback,
       deduped, summaryChars, summaryTruncated, sourceBytes, sourceRef }

assessStoredHandoffCheckpointPre({ storePath, handoffDir, eventId, checkpointIndex|idemKey })
  → { ok, code, status?, eventId, checkpointIndex, sourceRef?, sourceProof?,
      fingerprintScopes?, coverage?, pointerCoverage? }

assessCurrentPointerCoveragePre({ checkpoint, event, eventId, checkpointIndex,
                                  source, sourceProof, sourceRef, expectedSummary, readback })
  → { ok, status, gates{identity,binding,provenance,quad,summary,recoverable},
      reasonCodes[], detail, eligibleFor*=false, eventClaimed=false, writesPerformed=false }

assertWritableEventTargetPre(storePath, eventId)
  → { ok, eventId, checked, status? }   // closed/未知/非法 ⇒ throw code=event-id-unavailable
```

## 3. 覆盖评估：摘要指针形态的明确结论（Lead 要求 ②）

**问题**：2.7 之后 checkpoint.text 是 <=300 字符摘要，**不是全文**。
原 assessHandoffCoveragePre 的 content 门把 text 当全文逐段比 ⇒ 对摘要形态必然 mismatch。
**不能靠改口把它说成 covered。**

**解法（两个结论并列，互不顶替）**：

| 判据 | 结论对象 | 对摘要检查点的结果 |
|---|---|---|
| assessHandoffCoveragePre（**原判定原样保留**） | 检查点正文 vs 真源全文 | 摘要形态如实 **非 covered**；对 legacy 全文检查点仍给原判定 |
| **assessCurrentPointerCoveragePre（本批新增）** | 检查点是否**如实指向**那份真源 | **covered**（六门全过） |

六门（全部可独立复算）：

| 门 | 判据 |
|---|---|
| identity | 真实事件存在、检查点确为该事件成员（下标或 idemKey）、legacy key 由真实字段推导且自洽 |
| binding | checkpoint.sourceRef == 真源 sourceRef |
| provenance | bytes / rawSha256 / normalizedSha256 **三项分别**对上真源真实值 |
| quad | 原始四段逐字段 == 真源解析结果 |
| summary | 检查点正文 == 同一纯函数对「同真源 + 同四段」的确定性输出 |
| recoverable | readEventCheckpointPre 从磁盘逐字节还原真源（verified） |

**指纹口径三条并列，禁止互换**（Lead 点名）：

| 字段 | 语义 | 消费者 |
|---|---|---|
| rawSha256 | **真源文件 UTF-8 字节**的 sha256 | provenance 门 |
| normalizedSha256 | 真源的 ledger-doc/protocol.normalizeText 口径 | readPointerPre / readEventCheckpointPre |
| documentNormalizedSha256 | 真源的覆盖规范化口径 | assessHandoffCoveragePre |
| **summaryTextRawSha256** | **摘要正文自身**的 sha256（仅此才算「正文指纹」） | detail.provenance / detail.summary |

并且：喂给 assessHandoffCoveragePre 前**剥离** rawSha256/normalizedSha256（它们不是正文指纹，
不剥离会产生 checkpoint-raw-fingerprint-mismatch 假红）。

**covered 不是许可**：eligibleForPhysicalDelete / Archive / Merge 恒 false，eventClaimed / writesPerformed 恒 false。

## 4. 负路径（每条都有真断言，非解释）

| # | 篡改 | 期望 | 实测 |
|---|---|---|---|
| N0 | 未篡改（对照） | covered | PASS（证明负路径有区分力） |
| N1-N3 | 四段漂移 | 非 covered + pointer-quad-drift + quad 门关 | PASS |
| N4-N5 | sourceRef 不一致 | 非 covered + pointer-source-ref-mismatch | PASS |
| N6-N7 | rawSha256 改一位 | 非 covered + pointer-raw-sha256-mismatch | PASS |
| N8 | bytes 漂移 | 非 covered | PASS |
| **N9** | **摘要哈希冒充真源哈希** | **非 covered**（口径不可混用的硬判据） | PASS |
| N10-N11 | eventId 绑定错误 | 非 covered + pointer-identity-unverified | PASS |
| N12 | 指针不可回读 | 非 covered | PASS |
| N13-N14 | 摘要非确定性复算结果 | 非 covered + pointer-summary-mismatch | PASS |
| N15-N18 | 正/负两侧 | 均不授予删除/归档/认领、零写入 | PASS |

## 5. 接缝状态（全部已接通）

| 依赖 | 状态 |
|---|---|
| lib/handoff-checkpoint.js（task-17） | **已交付**，被本模块 import 并真调用 |
| appendHandoffCheckpointPre summary 路径 | **已实现**（text=摘要、四项溯源、idemKey 用完整正文、返回真实 checkpointIndex） |
| event-store 检查点白名单 rawSha256/normalizedSha256 | **已保留** |
| lib/index.js 共享入口接线 | **已完成**（Phase 0 归属预检 → 文档落盘 → Phase 1' 记检查点 → Phase 3 半完成） |

## 6. 相邻回归（全部真跑）

| 套件 | 结果 |
|---|---|
| smoke-test-batch2-2.9-wiring | **PASS 90 / DONE 122**（4 变异 CAUGHT） |
| smoke-test-v4-h2-h0-wiring | **17 PASS / 0 FAIL** |
| smoke-test-i332-write-contract | **30 PASS / 0 FAIL** |
| smoke-test-r26-cross-layer | **26 PASS / 0 FAIL** |
| smoke-test-batch2-2.7-checkpoint / 2.7-pointer / 2.7-drilldown / 2.9-handoff-coverage / 2.8-preflight / 2.5-redraw-integration | 全绿 |
| smoke-test-batch2-2.6-note-integration | **22 PASS / 0 FAIL**（Lead 修正旧顺序夹具后实测） |
| smoke-test-batch2-2.8-integration | **17 PASS / 0 FAIL**（Lead 修正旧顺序夹具后实测） |

### 6.1 Lead 集成裁决与复验

两条旧断言都假设「文档失败时已有成功正文检查点」，与 2.9 的真源优先顺序冲突。
**采纳的不是一律事件 +0**：显式事件中的失败留痕保留，但不伪造成功正文；no-op 去重继续有效。

- `2.6-note-integration` 现断言只有 `plan-write-failed`、没有伪造 `plan`；实测 **22/0**。
- `2.8-integration` 现断言 no-op 后总数不增，mock 的意外失败保留 `plan-write-failed`；实测 **17/0**。
- 以上套件均为真工具入口与真实隔离文件/事件库调用，不是删除失败留痕或放宽覆盖门。

## 7. 物理量与锁

```
lib/handoff-write.js                 29,097 B / 527 行 / 纯 LF / sha256 D62CCE5748C8087D…
lib/index.js                         2,172,889 B / 29,872 行（纯 CRLF，bare LF=0）/ sha256 F6BF9EFFEC3BC4B5…
  IX（LF 归一化）= 1,616,211  sha16 C1BC1369686A2BCC  路由 86  导出 23 守恒
tests/smoke/smoke-test-batch2-2.9-wiring.mjs      26,905 B / 432 行 / 纯 LF / sha256 4F6E33E140C16588…
tests/smoke/smoke-test-r26-cross-layer.mjs       145,657 B / 1,081 行 / 纯 LF / sha256 31E23EE14172F445…
tests/smoke/smoke-test-v4-h2-h0-wiring.mjs       8,506 B / 98 行 / 纯 LF / sha256 80788B151DC02034…
tests/smoke/smoke-test-i332-write-contract.mjs   16,927 B / 245 CRLF（纯 CRLF）/ sha256 FFE28B0F98CC9968…
docs/internal/RESULT-BATCH2-2.9-WIRING-20261113.md  8,4xx B / pure LF
r26 锁：1,613,855/686CF32DEA5B0521 -> 1,616,211/C1BC1369686A2BCC（本套件自身管道复算）
```

## 8. 未验证边界（诚实清单）

- 真实 HOST / 真实模型 / 全仓回归 / 生产启用 **均未验证**。
- task-17 的 300 字符摘要上限由 task-17 专项覆盖（Lead 复跑 30/0），本报告不重复声称。
- R4-on（LedgerDocSystem WAL/CAS/create-only）**零改动**，其既有分支原样保留。
- 2.6/2.8 两条夹具已由 Lead 按真实顺序迁移并复验（见 §6.1）。
