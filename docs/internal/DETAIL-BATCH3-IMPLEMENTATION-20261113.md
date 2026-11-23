# 批次3模块化/API化实施细则

> 日期：2026-11-13（Asia/Hong_Kong）
> 性质：架构与接口施工细则；当前未授权生产实现或启用。
> 配套：`INVESTIGATION-BATCH3-MODULAR-API-20261113.md`
> 编号：以 `CONSTRUCTION-PLAN-20261108.md` 的 3.0-A 为准；`REPORT-3.0-INJECTION-PROGRESS-20261113.md` 中另一套 3.0.x 排列不得直接映射到本细则。

## 1. 编号映射

| 总表 3.0-A | 对应旧 S 项 | 内容 |
|---|---|---|
| 3.0.1 | S4/S5/S11 | 规则指针与完整读取 |
| 3.0.2 | S12/S1 | 完整规则与维护提醒 |
| 3.0.3 | S2 | 水位默认值一致 |
| 3.0.4 | S3/S9 | 总预算与最终计量 |
| 3.0.5 | S7/S8＋full 记账 | 定稿与通知可靠性 |
| 3.0.6 | S6 | 白板与账本裁剪闭环 |
| 3.0.7 | S10 | 真实回调与回归基础 |

`noticeRemoteEnabled` 只出现在进度报告的另一种编号叙述中，不属于上述 3.0-A 独立子项。当前 `fetchNotices()` 会在启动及每小时访问 `NOTICES_URL`，未找到该配置键的真实读取点；不得借本批次擅自新增或开启网络能力。其处置应另立规格，保留默认关闭边界。

## 2. 共同接口约束

所有新纯函数遵循：

- 输入不可变，输出可 JSON 序列化。
- 返回稳定身份、来源证明、错误码和降级信息。
- 不把 IO、模型、写入、删除、归档藏进 Projection/Envelope。
- `proposal-only` 不携带 apply 权限或归档令牌。
- 每项验收必须真 import/真构造/真调用、断言返回值或副作用，并包含负路径和隔离变异。
- 不修改真实记忆、生产配置、19387；不 commit/push；不自动 attach/merge/archive。

建议公共 DTO：

```text
SourceProof {
  sourceRef, bytes, rawSha256, normalizedSha256, revision
}

ProjectionCandidate {
  id, kind, bucket, priority, text,
  sourceIdentity, contentVersion
}

PreparedNotification {
  id, version, payload, commitToken
}

DeliveryReceipt {
  requestId, finalizedText, selectedNotificationIds,
  committed, skipped, errors
}
```

## 3. 3.0-A 逐项施工细则

### 3.0.1 规则指针与完整读取

**现状证据**

- `rules-layer.js:446–468` 只取首条实质行并限 200。
- `applyRuleEditPre` 支持 user/project 与分层 revision。
- `memory_rules` list 在 `lib/index.js:26101` 固定 `applyRuleEditPre(engine,'list',{})`，只取 user。
- `memory_read` 在 `lib/index.js:25895–25898` 有 8000 上限。

**目标 API**

```text
readRulesAggregatePre({userFile,notesPath})
→ {
  user:{path,revision,items},
  project:{path,revision,items},
  counts:{rule,note,retired,physicalEditable},
  errors:[]
}
```

- 每个 item 保留 layer、层内 index、完整多行 text、kind、status、source revision。
- 聚合读取不制造跨层统一编辑索引；编辑仍用原层内 index。
- 不把注入 rule 数、rule+note 数、物理可编辑行数混为一个数。
- 指针引用同一聚合结果，用户层与项目层都能按需取完整正文。
- 不以 GUI 项目层编辑为前置，不改变旧写入与跨层 CAS 拒绝。

**副作用/错误**

- 只读；区分缺文件、空文件、读取失败和非法结构。
- 不自动迁移、去重或删记忆。
- 读取失败不能静默产生空规则全集。

**验收**

- 超过 200 字且含多行限定的 user/project 各一条，按指针能取回全部正文。
- 两个 bullet 与单条多行规则分别断言，不能混用粒度。
- `revision(user) ≠ revision(project)`，相同文件内容也保持分层命名空间。
- 跨层 revision 更新仍拒绝且文件逐字节不变。
- 缺层、空层、unreadable 负路径分别可见。

**回滚**

- 删除聚合只读适配，恢复旧摘要渲染；不动 `applyRuleEditPre` 和旧文件。

### 3.0.2 完整规则与维护提醒

**目标 API**

```text
renderRulesForTierPre({rules,tier})
→ {text,counts,chars,mode}
```

- `human_full` 输出完整有效正文，不只首行，不逐条 200。
- note 保留中性前缀，不冒充硬规则。
- `snapshotSlimMaintain` 只在 `human_slim` 和既定 fail-open 语义中保留；`run_slim` 移除。
- 不复用包含 run_full/post_compact/handoff_carry/legacy 的“人际语境”名单。

**副作用/错误**

- 纯渲染零 IO；非法 tier 不擅自扩档，回退按已定兼容语义。
- 两份 MEMORY 的额外投递范围仍受 3.0-B，不在此项默认改成全量。

**验收**

- 多行、长规则、note、retired、跨语言均检查。
- human_slim 含维护块，run_slim 不含。
- 负路径：ruleSummaryPre 旧 200 截断或 run_slim 残留维护块，隔离变异必红。

**回滚**

- 恢复旧渲染与维护块位置；不删除维护正文。

### 3.0.3 水位默认值一致

**实测**

- `DEFAULT_CONFIG.fullInjectWaterPct='25,50'`
- `parseWaterPctThresholdsPre('bad') → [25,50]`
- `'off' → []`
- 手写前端与 `skins/legacy/iter5-325.js.frozen` 缺省/placeholder 均 `25,50`

**目标 API**

```text
resolveWaterThresholdsPre({configuredValue,source})
→ {thresholds,source,explicit,errors}
```

- 新缺省候选为 `[25]`，但生产修改须统一服务端、解析缺省、客户端生成源与最终产物。
- 显式 `off/0` 保留禁用；自定义 `25,50` 不得被静默强制覆盖。
- 旧配置迁移范围另行裁定。

**验收**

- 已投 25 后到 60：不再因 50 授 full。
- 未投 25 直接到 60：仍补投 25 一次。
- 压缩后按现有政策重置。
- 非法值、显式禁用、自定义值、保存/重启分别测。
- 不得只写“60% 永不 full”这种错误总判据。

**回滚**

- 回退代码默认与客户端同源值；不修改或回滚用户显式配置。

### 3.0.4 总预算与最终计量

**目标 API**

```text
composeFinalEnvelopePre({candidates,budgetPolicy})
→ {text,chars,segments,dropped,truncated,degradations,unresolved}
```

- `rules/memoryReferences/otherDynamic` 共享所选总额。
- 降级提示、标题、分隔符、通知、反思全部进段后再计量。
- 候选账与实际投递账分离；只按最终选帧每请求记一次。
- `chars.total === text.length === 分桶之和 === 最终段长度之和`。
- token 计量、50K 单位、full/压缩豁免、rules/must 超额、静态/M6/反思/诊断范围均保留 3.0-B。

**副作用/错误**

- 纯函数；`unresolved` 显式返回未决预算边界，不能默认只记录超额就声称硬上限。
- `must` 自身超额可见；普通段截断也可见。
- `observeInjection` 在最终返回处记录，不能记废弃 snap。

**验收**

- 两桶各自未超但合计超、rules 独超、must 独超、多条诊断、反思和授予标记。
- slim/复读缓存不继续记废弃 snap。
- 最终文本含降级尾巴时仍满足等式。
- 变异：恢复事后追加尾巴或错误候选记账必红。

**回滚**

- 撤去最终组装适配，恢复旧 envelope；不改既有预算配置键。

### 3.0.5 定稿与通知可靠性

**目标 API**

```text
prepareNotificationPre(scan)
→ {id,version,payload,commitToken}

finalizeInjectionPre({requestId,text,prepared})
→ {text,selectedNotificationIds}

commitNotificationPre({requestId,receipt})
→ {committed,errors}
```

**必须修复的现行为**

- `global-brief` 候选使用非法 `external` 桶，应改合法 `otherDynamic`。
- `briefDetectSyncPre` 在候选阶段写水位、snapshot/outbox。
- `renderPlanUpdateRequest` 取文本即清 `planUpdatePending`。
- `_recallJustDelivered` 在非空 tail 返回时置位，宿主最终消费仍未证。
- 水位/F7 full 提前返回需补公共 full 记账，不能顺手改触发配额。

**副作用/错误**

- prepare 零写。
- 只提交最终保留通知 id/version。
- 旧 commit 遇到新 version 必须拒绝，不能清新待办。
- EPERM 必须显式返回；失败可重试，不得静默。
- UI `/global-brief` 只读候选，不消费模型通知。
- finalize 只表示插件定稿，不等于宿主交付。

**验收**

- 选 slim/旧缓存、通知关闭/裁掉/截断时不误消费。
- 第一次候选后未定稿，第二次仍可取到同一通知。
- 写盘失败保留通知并显式报错；修复后重试成功。
- 同请求输出一致且只记一次；跨请求 full 不漏 `_snapFp` 等公共记账。
- 反思另做最终追加兼容验收，不混称已证实的候选消费缺陷。

**回滚**

- 恢复旧检测/读取路径；已提交通知不删除、不伪造回滚历史。

### 3.0.6 白板与账本裁剪闭环

**实测**

- `sanitizeForInjection` 默认 `maxChars || 2000`。
- plan 2046 → 2000，`TAIL-NEXT` 丢失。
- ledger 2068 → 2000，`DEAD-TAIL/NEXT-TAIL` 丢失。

**目标 API**

```text
projectHandoffPre({planText,latestHandoffText,tier,policy})
→ {planPart,ledgerPart,sourceIdentity,degradations}
```

- 清洗不再默认 2000 预截断。
- 先按既定章节/四段选择，再按明确总策略裁剪。
- 保留后部失败原因与下一步。
- `planCap` 只是桶预留，不能冒充单段上限。
- 无命中章节不自动回退全文；full/slim 视角和预算仍待 3.0-B。

**验收**

- 长输入、多节、尾部唯一标记、中英混合和异常结构。
- 同 fingerprint 的 min/full 读取与内容路径一致。
- 最终正文包含所选章节与失败/下一步，不只数标题。
- legacy 数据格式的 2400/800 按目标实测，不当作既有不变量。
- 变异：恢复默认 2000 或先 cut 后选必红。

**回滚**

- 恢复旧 sanitize/weighted 路径；不改 PLAN.md、账本或 R4 文档。

### 3.0.7 真实回调与回归基础

**现存测试缺陷**

- `smoke-test-p6a-rules-layer.mjs` 的 shell 无 `renderMemoryDynamic`，完整版空结果仍可放行。
- `smoke-test-v4-h5-user-portrait.mjs` 只定义 `makeFn`，未调用工厂。

**目标测试面**

1. 修两处测试，使其真执行渲染并断言非空产品输出。
2. 真实 import/真实 `apply()`/真实 context 回调。
3. 同请求双调用、下一请求、压缩、水位、预算、通知未投不消费。
4. 每帧形态×档位×保留段。
5. 每条正路径有负路径，隔离变异必红。
6. 保留四个直接抽取动态渲染套件兼容或逐套迁移，不新增永久内联禁令。
7. 受影响回归、行尾检查、r26 漂移锁与指纹逐项归因。

**本次已证明**

- 隔离真实 apply 同请求两次均为 2813 字符，SHA-256：
  `d1793dc913dd6a57af030de3defa3111cc01666168173336d2a25c9dbcfc4c42`
- 新请求输出 2065 字符。
- 未调用宿主 `project()`、未检查 `retained`、未访问 19387。

**回滚**

- 回滚测试适配与实现单位；不通过删除失败断言或放宽空结果来“修绿”。

## 4. 3.1 consolidate 扩读取面

### API

```text
collectConsolidationSourcesPre({days,readers})
→ {logs,events,plan,handoff,reflections,proofs,warnings}

buildConsolidationPromptPre({sources,budgetPolicy})
→ {prompt,counts,truncation,sourceProofs}

applyConsolidationResultPre({parsed,writer,budget})
→ {written,skipped,errors}
```

### 当前事实

- 日志各尾部 2500，已有笔记/用户记忆各尾部 1200。
- 当前 prompt 无事件摘要、白板、账本、反思。
- `[PROJECT]` 经 `ensureBudget` 后 append 项目笔记。
- `[USER]` 仍只写 `PENDING-USER-MEMORY.md`，不能直接写全局用户级 MEMORY。
- 空日志、模型空正文、真实超时分别返回。

### 副作用/错误

- collect/build 零写入。
- 只有 apply 才能写，且写入仍由原工作流负责。
- 来源 unreadable 不得当空来源。
- prompt 裁剪必须保留 sourceRef 和省略信息。
- 模型解析失败不写。

### 验收

- 构造五类来源，prompt 含事件摘要和白板/账本/反思标记及可验证来源证明。
- 无日志、无事件、空文档、损坏文档分别测。
- 统计每类输入 JS 字符数、最终 prompt 字符数、被裁量；不沿用历史 12.7% 当当前事实。
- 模型 `(无)`、空正文、超时、解析异常均无新写入。
- `[USER]` 仍只进待确认区。
- 变异：删除事件/白板来源或把读取失败静默为空，必红。

### 回滚

- 撤去新 source collector，恢复日志-only prompt；不重写或删除既有笔记。

## 5. 3.2 四段消费

### API

```text
projectEventSectionsPre({sections})
→ [{key,title,text}]
```

- 事件头字段：`goal/doing/deadend/next`。
- 检查点字段：`goal/state/dead/next`。
- 字段为空不输出；不得把 checkpoint 四段映射错到事件头。
- 失败/卡点必须进入最终帧，不只存不用。

### 验收

- 四段各自存在、全部为空、部分为空、长文本、跨语言。
- deadend/dead 含失败原因时最终 T2 可见。
- 空字段不出现空标题。
- 与 3.0 的档位、组装、最终计量联验。
- 变异：删除 deadend/dead 映射或回退只读 text，必红。

### 回滚

- 恢复旧渲染映射，不改事件存储 schema。

## 6. 3.3 检查点截断策略

### API

```text
renderCheckpointPreviewPre({checkpoint,budget,sourceRef})
→ {text,head,tail,truncated,sourceIdentity}
```

- 保留开头与结尾，或按 goal/state/dead/next 的内容动态分配。
- 截断标记计费，sourceRef 保留下钻路径。
- 段级预算目标沿用总表的 1800 约束；单项 300 只是当前实现，不能当成已批准最终规格。
- 最终仍受 T2=2400 与 3.0 总预算约束。

### 验收

- 1400 字检查点开头和结尾特征均可达。
- 只有 text、四段、四段全空、多检查点、多语言、代理对边界。
- 最新检查点优先，最旧多余如实计数。
- 段级与 T2/整帧预算同时满足。
- 变异：恢复 `cutPre(rawText,300)` 单向头截，必红。

### 回滚

- 恢复旧预览；检查点原文不变，不自动改写历史。

## 7. 3.4 事件展开与定位

### API

```text
selectEventProjectionPre({
  events,
  activeLimit:eventMaxActiveInInject,
  catalogChars,
  finalBudget
})
→ {cards:[{id,t2}],catalog:{text,included,dropped},counts}
```

- `pickT2EventsPre` 默认 active 2；配置是 `eventMaxActiveInInject`，不能写死新值。
- 目录排除已展开事件，默认生产 `withId:true,applyVisibility:true`。
- 保留“含5个以上 active 展开”的调查目标，但不得擅自增加预算或宣称现值已实现。
- 原 ≤8000 必须明确是段级还是整帧；最终以 3.0 计量为准，不扩大额度。

### 验收

- 固定 10 active，短 id/长名称/多语言/缺 id/重复 id 分开测。
- T2 卡与目录都含合法 evt id 和正文；非法/缺 id 不伪造。
- 当前短夹具可 10 条全列，但 T2 只展开2；长目录 dropped 如实计数。
- active/paused/closed/archived 各自可见性；归档仍可由 recall 检索。
- 与 3.3 和最终整帧预算同时满足。

### 回滚

- 恢复旧 active 数与目录选择，不改 event store 状态。

## 8. 2.3/2.9/Prototype 接口契约

| 接口 | 调用什么 | 返回什么 | 谁负责写入 | 何时不执行 |
|---|---|---|---|---|
| 2.3 候选 | 归属召回/融合/模型裁决 | candidates、score、margin、rationale、modelIdentity、`proposal-only` | 实验产物由隔离实验写；生产不得自动 attach/merge/archive | 金标不足、候选冲突、closed/越界 id、无证据、生产未授权 |
| 2.9 规范化/证明 | normalize/parse/buildProof/assess | 规范正文、区域摘要、raw/normalized SHA、sourceRef、covered/partial/mismatched/needs-review/ineligible | 旧 handoff 由 `appendHandoffCheckpointPre`；R4 由 LedgerDocSystem；新核心由另一任务 | 无来源证据、根外/symlink、closed 目标、无法证明覆盖、禁止自动删 |
| Prototype SourceChange | deriveDocument/replaceSource(s) | changed/seq/generation/bytesWritten/alreadyApplied；稳定 INDEX_* | SidecarStore 只写派生索引 | 2.3 profile/API未冻结、B1–B4未闭合、R4/审计/迁移/drain未验、生产未授权 |
| R4 维护文档 | 显式 documentId/createDocument/expectedRevision/changeSet | revision、prepared/committed/failed、document 内容 | LedgerDocSystem/WAL，非 SidecarStore | 身份猜测、CAS 失败、未授权迁移/删除 |
| `events.jsonl` | `appendSidecarEventPre` | append-only 审计行 | 生产 facade | 不能用 Prototype journal 替代或静默丢弃 |
| 旧 legacy 读取 | `readLegacyLedger/readLatestLegacyLedger` | 原文、sha256、mtime、排序和错误状态 | 只读；显式 legacy 写仍走旧保护链 | 不混入 R4 documents，不拿当前 PLAN 冒充历史 |

## 9. 串行接入顺序与并行边界

1. **先建 3.0.7 验收基础**：固定语料、请求键、时序，证明旧缺陷会被抓。
2. **独立小修**：合法桶名、维护提醒范围、水位默认真源；各自负路径和回滚。
3. **读取先于指针切换**：两层完整读取与旧 CAS 安全后，再改实际摘要输出。
4. **定稿、通知、最终计量共同验收**：prepare 不消费；最终保留通知提交；最终文本只记一次。
5. **3.0-B 明确后再放大内容**：完整规则、白板/账本去预截断、最终总预算同规格联验。
6. **3.1–3.4 使用同一最终契约**：来源、四段、检查点、展开不得另建平行预算。
7. **SidecarStore 独立后续**：2.3 profile/API 冻结、原型阻断关闭后，由专项 facade 串行接入。
8. **共享文件单写者**：`lib/index.js`、`lib/event-write.js` 由 Lead 串行；2.9 独立核心不越权接入。
9. **每个单位独立回滚**：不改其他并行工作，不清理无关工作树，不删除用户数据。

## 10. 3.0-B 与未验边界

以下不得由实现者自行定案：

- 50K 的单位与计费范围。
- full/压缩重建是否豁免。
- rules/must 超额处理。
- 静态纪律、M6、反思、诊断是否进入总预算。
- 现有 `injectBudgetChars=8000` 与最终政策及旧配置迁移。
- 两份 MEMORY 是继续尾部窗口、全量，还是非规则资料投影。
- 白板 full/slim 的章节、排序、必保正文、无命中回退和当前任务来源。
- `handoff_carry/hang_compensate` 的公共修复边界；不得删除、合并或改触发/计数。
- `noticeRemoteEnabled` 及联网通知的默认关闭和最终处置。
- HOST `project/retained` 最终投递、真实模型轮次、Electron、掉电、跨设备、生产启用。

## 11. 每模块回滚总表

| 模块 | 回滚动作 | 不得做的事 |
|---|---|---|
| Sources | 移除新只读适配，恢复原读取 | 删除或迁移真源 |
| Rules | 恢复摘要/指针适配 | 改旧层内 index、expect、revision |
| Projection | 恢复原 tier 渲染 | 擅改特殊档或真实配置 |
| Envelope | 恢复旧 compose | 只改 total 数字掩盖文本不计量 |
| Notification | 停用新 prepare/commit facade | 删除已提交水位或伪造新提交 |
| consolidate | 恢复日志-only prompt | 回滚/删除既有笔记 |
| event-render | 恢复原 T2/检查点预览 | 改检查点原文或事件 schema |
| SidecarStore | 停 writer→锁内追平→最新导出 v1→校验 revision→原子写回 | 只恢复迁移前旧备份 |
| 测试 | 恢复真实有效断言 | 用空输出、未调用工厂或源码字符串冒充功能验收 |

## 12. 当前交付状态

- 调查与细则已完成，未生产施工。
- 未修改 `lib/`、`prototypes/`、2.9 独立文件、生产配置或真实记忆。
- 未启动或访问 19387，未 commit/push。
- 本文档及配套调查当前由聊天交付，需 Lead 落盘并计算两份 SHA-256。
- 不能据此宣称 3.0、2.9、Prototype、HOST 或生产验收完成。

## Lead 落盘补注（2026-11-13）

本细则按聊天原文落盘，不代表生产实现。独立后续已验收并提交：
- 2.9独立核心：`RESULT-BATCH2-2.9-CORE-20261113.md`，787a41b8；生产未接线。
- Prototype B1–B4：`RESULT-SIDECARSTORE-BLOCKERS-20261113.md`，1d03c8f3；37/37/0 skipped，6变异捕获。
- 3.0-A/B继续以总表为准，实际HOST/生产启用仍待后续专项验收。