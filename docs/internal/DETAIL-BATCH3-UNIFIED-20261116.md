# 批次3 统一施工大纲（语义代号版 · 2026-11-16）

> 性质：**架构与接口施工大纲**。本轮只做文档解耦，**不改生产代码、不启动 HOST**。
> 取代关系：本文**取代**两套 3.0.x 编号作为施工依据；旧编号**仅作溯源**，不得直接映射。
> 前置：`REPORT-BATCH3-NUMBERING-DECOUPLING-20261116.md`（编号冲突取证）、`REPORT-BATCH2-BATCH3-DEPENDENCIES-20261116.md`（依赖测绘）、`RESULT-BATCH2-IMPLEMENTATION-REVIEW-20261116.md`（第二批复核）。

---

## 0. 为什么必须换代号

同一串 `3.0.x` 在两份权威文档里指向**不同任务**：7 项中只有 **3.0.1 / 3.0.4** 语义对齐，**其余 5 项全部错位**。按编号施工必然做错项。

| 旧编号 | 施工细则口径 | 进度报告口径 | 是否对齐 |
|---|---|---|---|
| 3.0.1 | 规则指针与完整读取 | 规则指针与完整读取 | ✅ 对齐 |
| **3.0.2** | **完整规则与维护提醒** | **精简档位修正** | ❌ **错位** |
| **3.0.3** | **水位默认值一致** | **通知消费与定稿** | ❌ **错位** |
| 3.0.4 | 总预算与最终计量 | 最终预算与最终计量 | ✅ 对齐 |
| **3.0.5** | **定稿与通知可靠性** | **白板/账本裁剪与 true full** | ❌ **错位** |
| **3.0.6** | **白板与账本裁剪闭环** | **真实回调与消费证明** | ❌ **错位** |
| **3.0.7** | **真实回调与回归基础** | **联机通知与默认关闭** | ❌ **错位** |

---

## 1. 语义代号总表（**唯一施工口径**）

| 代号 | 名称 | 一句话职责 | 旧编号溯源（**仅供追溯，不用于映射**） |
|---|---|---|---|
| **B3-RC** | Rules Complete — 规则完整读取 | 用户层+项目层的**完整只读聚合**，含多行正文 | 细则 3.0.1；进度报告 3.0.1 |
| **B3-RP** | Rules Pointer — 规则指针与摘要 | 摘要档输出「一行指针」，`human_full` 给完整正文 | 细则 3.0.1/3.0.2；进度报告 3.0.1/3.0.2（**两口径混合**） |
| **B3-FM** | Final Metering — 最终帧预算与计量 | 最终段组装后再计量，账实一致、每请求记一次 | 细则 3.0.4；进度报告 3.0.4 |
| **B3-NT** | Notification — 通知与定稿 | prepare 不消费、只提交最终保留、幂等 | 细则 3.0.5；进度报告 3.0.2/3.0.3（**两口径混合**） |
| **B3-BD** | Board & Docs — 白板/账本投递 | 去 2000 预截断、按节选择、保尾部失败与下一步 | 细则 3.0.6；进度报告 3.0.5 |
| **B3-CB** | Callback — 真实回调与回归基础 | 修恒真断言、真执行工厂、真实 apply 回调 | 细则 3.0.7；进度报告 3.0.6 |
| **B3-EV** | Event Views — 事件消费侧 | 四段消费、检查点截断、事件展开定位（旧 3.1–3.4） | 总表 3.1–3.4 |

> **`noticeRemoteEnabled` 不属任何 B3 代号。** 它是独立规格，实测 `lib/` 内 **0 命中**（默认关闭边界保留）。进度报告把它列作「3.0.7」是编号事故的第二处，不得据此开网。

**另一处编号事故**：进度报告 3.0.3 内含「`_waterPctFired` 授予分支先于返回推进」，而水位本身在细则里是 3.0.3 —— 该缺陷属 **B3-NT**（记账时机），不属水位缺省值。同号跨两件事，是必须解耦的直接证据。

---

## 2. 依赖图

```text
B3-CB（回归基础）  ← 唯一无前置者，必须最先做
   │
   ├──> 公共契约层（DTO/profile）
   │        │
   │        ├──> B3-RC（规则完整读取）
   │        │        └──> B3-RP（指针/摘要切换：必须在 RC 可用之后）
   │        ├──> B3-FM（最终计量）
   │        │        └──> B3-EV（四段 / 检查点 / 展开均服从 FM 预算）
   │        ├──> B3-NT（通知定稿）
   │        └──> B3-BD（白板/账本投递）
   │                 └──> 与 2.5 输入契约对齐后联验
   └──> 3.0-B 边界明示 ──> 解锁 B3-FM 完整范围 / B3-BD full 视角 / B3-EV 段级规格
```

| 边 | 含义 | 类型 |
|---|---|---|
| B3-CB → 全部 | 没有可信验收基础，其余项的 PASS 不可信 | **硬依赖** |
| B3-RC → B3-RP | 先能完整读到，才谈摘要/指针切换 | **硬依赖**（细则 §9.3「读取先于指针切换」） |
| B3-FM → B3-EV | 3.2/3.3/3.4 不得另建平行预算 | **硬依赖** |
| B3-BD ↔ 2.5 | 3.0 负责「选择与投递」，2.5 负责「生成/更新」 | **接口对齐**，非阻塞 |
| 3.0-B → B3-FM/BD/EV | 边界未定则只能做「已定部分」 | **软阻塞** |

---

## 3. 公共 DTO / profile（先立契约，再动实现）

所有新纯函数共同约束：

- 输入不可变；输出可 JSON 序列化；不含函数/Map/循环引用。
- 返回**稳定身份 + 来源证明 + 错误码 + 降级信息**四件套。
- **不把 IO / 模型 / 写入 / 删除 / 归档藏进 Projection 或 Envelope**。
- `proposal-only` 不携带 apply 权限或归档令牌。
- 每项验收：真 import → 真构造 → 真调用 → 断言返回值或副作用；每项带负路径与隔离变异。

### 3.1 四个公共 DTO

```text
SourceProof {
  sourceRef, bytes, rawSha256, normalizedSha256, revision
}

ProjectionCandidate {
  id, kind, bucket, priority, text, sourceIdentity, contentVersion
}

PreparedNotification {
  id, version, payload, commitToken
}

DeliveryReceipt {
  requestId, finalizedText, selectedNotificationIds,
  committed, skipped, errors
}
```

### 3.2 profile（冻结，模型/口径变更须升版本号）

| 字段 | 作用 | 变更规则 |
|---|---|---|
| `schemaVersion` | DTO 形状版本 | 形状变更必升 |
| `promptVersion` | 提示词版本 | 提示词变更必升 |
| `inputNormalizationVersion` | 输入规范化版本 | 规范化规则变更必升 |
| `candidatePoolPolicy` | 候选池策略版本 | 截断/排序策略变更必升 |
| `budgetPolicy` | 预算策略（受 3.0-B） | **未定项不得写死** |

> 纪律：**不得隐式复用旧证据/旧结论**。任何变更必须让旧结果可被判为「不可比」，而不是静默混用。

### 3.3 一个必须先解决的前置事实（B3-CB 的输入）

**`parseWaterPctThresholdsPre` 是模块内部 `const`，未导出**（`lib/index.js:2153`；导出表 24 项中不含它）。
而施工细则要求「真调该函数断言返回值」——**当前做不到**。

⇒ B3-CB 必须二选一：**①加导出**（改导出数，需重钉计数锁）或 **②经导出符号间接验证**（如 `inject`/`apply` 的真实回调）。本大纲**不替实现者定案**，但这决定了 B3-RC/B3-RP 的验收形态。

---

## 4. 逐代号施工卡

### B3-RC · 规则完整读取

| 项 | 内容 |
|---|---|
| 现状（实测） | `rules-layer.js:396 firstLine(max=200)`、`:446 ruleSummaryPre(max=200)` 仍在；`lib/index.js:26307` `memory_rules list` **只取 user 层**；目标 API `readRulesAggregatePre` **0 命中** |
| 目标 API | `readRulesAggregatePre({userFile,notesPath}) → {user:{path,revision,items}, project:{…}, counts:{rule,note,retired,physicalEditable}, errors:[]}` |
| 关键约束 | 每 item 保留 layer / 层内 index / **完整多行 text** / kind / status / source revision；**不造跨层统一编辑索引**；编辑仍用原层 index |
| 副作用 | **纯只读**；区分「缺文件 / 空文件 / 读取失败 / 非法结构」四种，**读取失败不得静默变空全集** |
| 验收 | ①>200 字且多行限定的 user/project 各一条，按指针取回**全部正文**；②两个 bullet 与单条多行**分别断言**（粒度不得混用）；③`revision(user) ≠ revision(project)`（同内容也保持分层命名空间）；④跨层 revision 更新仍拒绝且文件**逐字节不变**；⑤缺层/空层/unreadable 三种负路径各自可见 |
| 隔离变异 | 恢复 200 截断 ⇒ 必红；把两层混成一个 revision ⇒ 必红 |
| 回滚 | 删除聚合只读适配，恢复旧摘要渲染；**不动** `applyRuleEditPre` 与旧文件 |

### B3-RP · 规则指针与摘要

| 项 | 内容 |
|---|---|
| 目标 API | `renderRulesForTierPre({rules, tier}) → {text, counts, chars, mode}` |
| 关键约束 | `human_full` 输出**完整有效正文**（不只首行、不逐条 200）；note 保留**中性前缀**不冒充硬规则；`snapshotSlimMaintain` 只在 `human_slim` 与既定 fail-open 语义保留，`run_slim` 移除；**不复用**含 run_full/post_compact/handoff_carry/legacy 的「人际语境」名单 |
| 前置 | **B3-RC 必须先可用**（细则 §9.3） |
| 验收 | 多行/长规则/note/retired/跨语言；`human_slim` 含维护块、`run_slim` 不含；负路径：旧 200 截断或 run_slim 残留维护块 ⇒ 变异必红 |
| 回滚 | 恢复旧渲染与维护块位置；**不删除**维护正文 |

### B3-FM · 最终帧预算与计量

| 项 | 内容 |
|---|---|
| 现状（实测） | `composeMemoryEnvelopePre` 4 处；`composeFinalEnvelopePre` **0 命中**；`observeInjection` 仅 **1 处** |
| 目标 API | `composeFinalEnvelopePre({candidates,budgetPolicy}) → {text,chars,segments,dropped,truncated,degradations,unresolved}` |
| 关键约束 | `rules`/`memoryReferences`/`otherDynamic` **共享同一总额**；降级提示/标题/分隔符/通知/反思**全部进段后再计量**；候选账与实际投递账**分离**；只按最终选帧**每请求记一次**；恒等式 `chars.total === text.length === 分桶之和 === 最终段长度之和` |
| 错误面 | `unresolved` 必须显式返回未决预算边界，**不能默认只记超额就宣称硬上限**；`must` 自身超额可见；普通段截断也可见 |
| **阻塞** | **受 3.0-B1/B2 强约束**（50K 单位、full/压缩豁免、rules/must 超额、静态/M6/反思/诊断计费范围、8000 迁移）⇒ **只可做骨架与已定部分** |
| 验收 | 两桶各自未超但合计超 / rules 独超 / must 独超 / 多条诊断 / 反思与授予标记；slim 与复读缓存**不继续记废弃 snap**；最终文本含降级尾巴时**仍满足等式**；变异：恢复事后追加尾巴或错误候选记账 ⇒ 必红 |
| 回滚 | 撤去最终组装适配，恢复旧 envelope；**不改既有预算配置键** |

### B3-NT · 通知与定稿

| 项 | 内容 |
|---|---|
| 现状（实测） | `planUpdatePending` 在 `lib/index.js:13834` 注释「一次性：取了就清」；`briefDetectSyncPre` 在 `:13552` **候选阶段即调用** |
| 目标 API | `prepareNotificationPre(scan) → {id,version,payload,commitToken}`；`finalizeInjectionPre({requestId,text,prepared}) → {text,selectedNotificationIds}`；`commitNotificationPre({requestId,receipt}) → {committed,errors}` |
| 必须修的现行为 | ①`global-brief` 候选用**非法桶名 `external`**，应改合法 `otherDynamic`；②`briefDetectSyncPre` 在**候选阶段**写水位/snapshot/outbox；③`renderPlanUpdateRequest` **取文本即清** `planUpdatePending`；④`_recallJustDelivered` 在非空 tail 返回时置位；⑤水位/F7 full 提前返回需补**公共 full 记账**，但**不得顺手改触发配额** |
| 关键约束 | **prepare 零写**；只提交**最终保留**的通知 id/version；旧 commit 遇新 version **必须拒绝**；EPERM **显式返回**、可重试、不得静默；UI `/global-brief` **只读候选**、不消费模型通知；finalize 只表示**插件定稿**，不等于宿主交付 |
| 验收 | 选 slim/旧缓存、通知关闭/被裁掉/被截断时**不误消费**；第一次候选后未定稿，第二次**仍可取到同一通知**；写盘失败**保留通知并显式报错**，修复后重试成功；同请求输出一致且**只记一次**；跨请求 full 不漏 `_snapFp` 等公共记账；**反思另做最终追加兼容验收，不得混称已证实的候选消费缺陷** |
| 回滚 | 恢复旧检测/读取路径；**已提交通知不删除、不伪造回滚历史** |

### B3-BD · 白板/账本投递

| 项 | 内容 |
|---|---|
| 现状（实测） | `#506` **已修但只覆盖** `user-memory`/`project-notes`（`lib/index.js:13403/13404` 传 `SANITIZE_NO_CAP`）；**plan `:12906` / ledger `:13000` 仍用 `sanitizeForInjection` 缺省 2000** ⇒ 细则所述「plan 2046→2000、`TAIL-NEXT` 丢失」**缺陷仍在** |
| 目标 API | `projectHandoffPre({planText,latestHandoffText,tier,policy}) → {planPart,ledgerPart,sourceIdentity,degradations}` |
| 关键约束 | 清洗**不再默认 2000 预截断**；先按既定章节/四段选择，**再**按明确总策略裁剪；**保住后部失败原因与下一步**；`planCap` 只是**桶预留**，不能冒充单段上限；无命中章节**不自动回退全文** |
| 阻塞 | **full/slim 视角受 3.0-B3 约束**（章节/排序/必保正文/无命中兜底/当前任务可靠来源）⇒ 只可做「去预截断」 |
| 验收 | 长输入/多节/尾部唯一标记/中英混合/异常结构；同 fingerprint 的 min/full 读取与内容路径一致；最终正文**包含所选章节与失败/下一步**（不只数标题）；legacy 数据格式的 2400/800 按**目标实测**、不当作既有不变量；变异：恢复默认 2000 或先 cut 后选 ⇒ 必红 |
| 回滚 | 恢复旧 sanitize/weighted 路径；**不改** PLAN.md、账本或 R4 文档 |

### B3-CB · 真实回调与回归基础（**必须最先做**）

| 项 | 内容 |
|---|---|
| 现存假绿（**本文档写作时已实测 4 处**） | ①`smoke-test-p6a-rules-layer.mjs:311/337/339`：shell 只返回 `{renderSlimSnapshotPre}` ⇒ `shell.renderMemoryDynamic` 恒 `undefined` ⇒ 条件含 `fullOut === ''` ⇒ **恒真**；②`smoke-test-v4-h5-user-portrait.mjs:151/161`：`makeFn` 定义后**全文 0 次调用**，只断言 `typeof === 'function'`；③`smoke-test-batch2-2.9-wiring.mjs:103` 末尾 `|| true`；④`…:179` `linkTested \|\| true`（隔离变异 M2 换 `(false) \|\| true` **仍 PASS** ⇒ 恒真确证） |
| 目标测试面 | ①修上述 4 处，使其**真执行**并断言**非空产品输出**；②真 import / 真 `apply()` / 真 context 回调；③同请求双调用、下一请求、压缩、水位、预算、通知未投不消费；④**每帧形态 × 档位 × 保留段**；⑤每条正路径配负路径 + 隔离变异必红；⑥保留四个「直接抽取动态渲染」套件的兼容性**或逐套迁移**，不新增永久内联禁令；⑦受影响回归、行尾检查、r26 漂移锁与指纹逐项归因 |
| **前置事实** | `parseWaterPctThresholdsPre` **未导出**（`:2153` 内部 `const`）⇒ 若要求「真调它」必须先加导出（**改导出数需重钉计数锁**）或改走 `inject`/`apply` 间接验证。**实现者不得默默二选一**，须先报。 |
| 回滚 | 回滚测试适配与实现单位；**不得通过删除失败断言或放宽空结果来「修绿」** |

### B3-EV · 事件消费侧（旧 3.1–3.4）

| 子项 | 现状（实测） | 目标 API | 阻塞 |
|---|---|---|---|
| **3.1 → B3-EV-1** consolidate 扩读取面 | `collectConsolidationSourcesPre` / `buildConsolidationPromptPre` / `applyConsolidationResultPre` **均 0 命中** | 同名三函数 | 受 B3-FM 最终契约 |
| **3.2 → B3-EV-2** 四段消费 | `event-render.js:331 CHECKPOINT_QUAD_KEYS` 四段映射**已存在**（v6 已修「只存不用」）；`projectEventSectionsPre` 0 命中 | `projectEventSectionsPre({sections}) → [{key,title,text}]` | 无（主体已实现，**施工前须重测**） |
| **3.3 → B3-EV-3** 检查点截断 | `event-render.js:333 cutPre(rawText, CHECKPOINT_ITEM)` 且 `:75 CHECKPOINT_ITEM=300` ⇒ **单向头截未改** | `renderCheckpointPreviewPre({checkpoint,budget,sourceRef}) → {text,head,tail,truncated,sourceIdentity}` | **受 3.0-B6**（段级规格；现有 300 不等于已批准最终值） |
| **3.4 → B3-EV-4** 事件展开与定位 | `pickT2EventsPre` 有；`eventMaxActiveInInject` 3 处（未写死）；`selectEventProjectionPre` 0 命中 | `selectEventProjectionPre({events,activeLimit,catalogChars,finalBudget}) → {cards,catalog,counts}` | **受 3.0-B7**（≤8000 是段级还是整帧） |

**B3-EV 共同验收纪律**：四段/检查点/展开**不得另建平行预算**，最终仍受 B3-FM 与 T2=2400 约束。

---

## 5. 可并行 / 必须串行

| 类别 | 项 | 依据 |
|---|---|---|
| **必须最先、单独** | **B3-CB** | 无它则其余 PASS 不可信 |
| **可并行（不同文件）** | B3-RC/B3-RP（`rules-layer.js`）｜ B3-FM（`memory-envelope.js`）｜ B3-EV（`event-render.js`） | 各自独立模块 |
| **必须串行（同文件）** | 任何需改 `lib/index.js` 的接线（B3-NT、B3-BD、B3-CB 接线） | **`lib/index.js` 单写者** |
| **契约先行** | 公共 DTO/profile 必须早于 B3-RC/FM/NT/BD/EV 的实现 | 避免各写一套 |
| **共享同一最终契约** | B3-EV 三项 ← B3-FM | 不得平行预算 |

---

## 6. 3.0-B 未决边界（**实现者不得自行定案**）

| # | 边界 | 阻塞谁 | 已定部分 |
|---|---|---|---|
| **B1** | 预算范围与豁免 | **B3-FM** | 现有预算键要生效、**不新增配置键**；未定：50K 单位、full/压缩豁免、rules/must 超额、静态/M6/反思/诊断计费、8000 迁移 |
| **B2** | 两份 MEMORY 投递范围 | **B3-FM**、B3-RC 输出量 | 规则全文不能仅首行；现为尾部窗口**不得称全量**；未定：尾部/全量/非规则投影 |
| **B3** | 白板 full/slim 视角 | **B3-BD** full 部分 | 移除预截断可做；未定：章节/排序/必保正文/无命中兜底/**当前任务可靠来源** |
| **B4** | 特殊档公共修复边界 | B3-BD、B3-RP | `handoff_carry/hang_compensate` 保留、**禁未调查就删/合并/改触发**；未定：R1/R3 修复是否同步改两档输出 |
| **B5** | 水位缺省切换与迁移 | B3-CB、B3-NT | 50% 默认关、25% 保留、显式 `off/0` 保留、自定义不被静默覆盖；未定：**旧配置迁移范围** |
| **B6** | 检查点段级规格 | **B3-EV-3** | 现有 `CHECKPOINT_ITEM=300` 非最终值；未定：段级目标（总表 1800 约束）、保头保尾 or 按四段动态分配 |
| **B7** | 事件展开 ≤8000 口径 | **B3-EV-4** | 不擅自扩大额度；未定：**段级**还是**整帧** |
| **B8** | `noticeRemoteEnabled` / 联网通知 | 无（不属 B3） | **默认关闭**；实测 `lib/` **0 命中**；须另立规格 |

---

## 7. 与第 1 / 2 / 4 / 5 批的接口

| 批次项 | 与 B3 的关系 | 是否前置 |
|---|---|---|
| **1.2 冲突处置入口** | 当前总体主线；B3 不切换其施工进度，也不擅自实现语义处置 | ❌ 否 |
| **1.4 归属判据** | B3 不改变自动归属边界 | ❌ 否 |
| **1.6** | 事件目录 id 注入点；与 B3-EV-4 目录相关 | ❌ 否 |
| **2.3 归属建议** | 已完成（`34331658`）；B3 不依赖其训练；**已复核无功能性冲突**（task-31） | ❌ 否 |
| **2.4 存量归并** | **仍冻结**；B3 任何单位不得触碰写原语 | ❌ 否（且**红线**） |
| **2.5 白板重绘** | B3-BD 负责「选择与投递」，2.5 负责「生成/更新」；**先对齐输入结构**，不把「等重绘完成」设为所有小修前置 | ❌ 否（接口对齐） |
| **2.6/2.7/2.8/2.9** | 2.9 摘要/指针可作 B3-NT 数据来源；**B3 不改其写入口** | ❌ 否 |
| **4.1 person store 接画像** | 4.1 负责来源接通，B3 负责「画像在哪些帧/档位出现」，**各自验收再联验** | ❌ 否 |
| **4.5 跨形态去重** | 4.5 定内容身份，B3-FM 定预算；**共用 `lib/index.js` 须串行** | ❌ 否 |
| **5.1 铭文重写** | **必须最后**；B3 只落实既有维护块的**投递位置**，**不提前重写其内容** | ❌ 否（反向依赖） |

---

## 8. 建议施工顺序（6 个可独立交付单位）

| 序 | 单位 | 含 | 3.0-B 阻塞 | 可独立验收 |
|---|---|---|---|---|
| 1 | **U1 验收基础** | B3-CB 全部（4 处假绿 + 真回调面） | 无 | ✅ |
| 2 | **U2 公共契约** | 4 个 DTO + profile + 计量骨架 | 无 | ✅ |
| 3 | **U3 可独立小修** | B3-NT 的桶名与 prepare 不消费 + B3-BD 去 2000 预截断 | 无 | ✅ |
| 4 | **U4 读取先于指针** | B3-RC 聚合读取 → 旧 CAS 安全后 → B3-RP 摘要切换 | 无 | ✅ |
| 5 | **U5 定稿/通知/最终计量** | B3-NT 完整 + B3-FM | **B1/B2** | ❌ 部分 |
| 6 | **U6 事件消费侧** | B3-EV 四项 | **B3/B6/B7** | ❌ 部分 |

**U1–U4 可立即排期**（无 3.0-B 阻塞）。若只做一件事：**U1**。

---

## 9. 每单位回滚总表

| 单位 | 回滚动作 | 不得做 |
|---|---|---|
| B3-RC | 移除聚合只读适配，恢复原读取 | 删除或迁移真源 |
| B3-RP | 恢复摘要/指针旧适配 | 改旧层内 index / expect / revision |
| B3-FM | 恢复旧 compose | 只改 `total` 数字掩盖文本不计量 |
| B3-NT | 停用新 prepare/commit facade | 删除已提交水位、伪造新提交 |
| B3-BD | 恢复旧 sanitize/weighted 路径 | 改 PLAN.md/账本/R4 文档 |
| B3-CB | 回滚测试适配与实现单位 | 用空输出、未调用工厂或源码字符串冒充验收 |
| B3-EV | 恢复原 T2/检查点预览/展开数 | 改检查点原文或事件 schema |

---

## 10. 本大纲的边界

1. **只做文档解耦**：未改 `lib/`、未改前端、未启动 HOST、未装依赖。
2. **未验证任何实现**：文中「现状（实测）」均来自 task-30/31 的只读测绘与复核，**不是本轮新跑**；B3 任何单位的 PASS 都需在 U1 之后重跑。
3. **未替用户定 3.0-B 八项边界**（§6 全部保持未决）。
4. **旧编号仅供溯源**：本文任何处都不以旧 3.0.x 作为施工指令；出现处均标注「编号事故」。
5. 不 push / 不发版 / 不迁移 / 不删除。
