# 批次3系统化、模块化与API化独立调查

> 日期：2026-11-13（Asia/Hong_Kong）
> 工作目录：`D:/dsh-auto-memory`
> 性质：只读代码调查、真实模块调用与隔离探针；不修改生产代码、不训练模型、不启动生产接入。
> 交付形态：聊天正文，待 Lead 落盘并计算文档 SHA-256。
> 权威顺序：`CONSTRUCTION-PLAN-20261108.md` 的 3.0-A/3.0-B 当前订正优先于旧 S1–S12 编号和其他报告的旧子项编号。

## 1. 已完整阅读的权威文件

1. `docs/internal/PROMPT-BATCH3-MODULAR-API-INVESTIGATION-20261113.md`
2. `docs/internal/CONSTRUCTION-PLAN-20261108.md`
3. `docs/internal/CONSTRUCTION-GUIDELINE-INJECT-20261108.md`
4. `docs/internal/REPORT-3.0-INJECTION-PROGRESS-20261113.md`
5. `docs/internal/ARCH-SIDECARSTORE-PROTOTYPE-AND-SYSTEM-INTEGRATION-20261112.md`
6. `docs/internal/REVIEW-SIDECARSTORE-PROTOTYPE-20261113.md`
7. `docs/internal/PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`
8. `docs/internal/PROMPT-BATCH2-2.9-HANDOFF-COVERAGE-20261113.md`

另核对了 `lib/event-write.js`、`lib/event-pointer.js`、`lib/legacy-handoff-compat.js`、`lib/ledger-doc/coverage-audit.js`、真实宿主 `app.asar` 中的 `RuntimeContextProjection.project()` 与 `retained` 实现。

## 2. 调查基线与源码指纹

调查起点：

- 分支：`preview`
- HEAD：`346954a81df0a88ac6ca1e3cd8ebfe0acb9c7e7a`
- 工作树：存在其他执行者的未跟踪文件；本任务未清理、未修改这些文件。
- `lib/index.js`：2,169,154 B；29,834 个按 `
` 切分所得行；CRLF 29,833；裸 LF 0。
- 下列 SHA-256 为调查实测时的源码指纹；其他并行任务后续变更不包含在内。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `lib/index.js` | 2169154 | `ceb4c5fc42b596485aa0ca1e1df798d6024a1e4b8b9c0aefa1548196ae61cff4` |
| `lib/rules-layer.js` | 44899 | `cf946f54d7d2643fd966760d5a9fb690a78c11fbbb156411b916d4c74ea2bfa7` |
| `lib/memory-envelope.js` | 14987 | `5560410ef311c6a3fc7531d95e3ab9f740cf0de3f5be985ee0aedd589c052aff` |
| `lib/event-render.js` | 30769 | `221d12c898d32b5d500ca8bda0d3a251bece73fea45ba755bd20b3310763d4eb` |
| `lib/user-portrait.js` | 14254 | `fcbfe417b2aef1deaa71f7bacd8044c7eccbb04a1df237d2c3304b98cae47623` |
| `lib/global-brief.js` | 11999 | `487450f76203bafac7d7acf1a3721ae9be9a55ea4a099191993dcde8fbe9dc04` |
| `lib/wb-sidecar.js` | 70315 | `0b7e6670ee23f3326bb95aaefbb2f876a0382d7c0c0fa922c1b57bcdd43315cb` |
| `lib/plan-render.js` | 10687 | `844d4b0015282496e73db96b1dcdf84593c8a4ae861caa9a997a161629bad0b9` |
| `lib/plan-derived.js` | 15095 | `3b9e5eb5e5ce3b8aab027521f823550cd5d619d12a7e9861a9dba71a7dc1721f` |

除 `lib/index.js` 和 `lib/global-brief.js` 为 CRLF 外，上述其余模块为 LF。未改写行尾。

## 3. 实测证据与证据边界

### 3.1 真实执行结果

| 实测面 | 结果 | 已证明 | 不证明 |
|---|---:|---|---|
| 隔离真实 `lib/index.js apply()` | 7 PASS / 0 FAIL | 真构造 22 工具、86 路由、2 context；绝对临时记忆根；同请求双调用一致；新请求重新计算；规则跨层 CAS 拒绝；`memory_read` 8000 上限 | 宿主 `project/retained` 最终消费、生产投递 |
| `SidecarStore` 隔离 API | 7 PASS / 0 FAIL | 真 open/replace/getStatus/readSnapshot/CAS/closed/detached values；同 operationId 幂等且第二次 0 B；`INDEX_REVISION_CONFLICT` | 生产接入、Electron、掉电、跨设备 |
| `consolidateMemory` 原方法体调用 | 4 PASS / 0 FAIL | 当前只读日志与两份记忆；无日志早退；超时错误可区分 | 真实模型质量、真实子代理端到端 |
| 2.9 旧写入/来源证明/水位 | 5 PASS / 0 FAIL | handoff 四段落盘、全文检查点、idemKey 去重、完整 raw/normalized SHA、越界拒绝、水位 `[25,50]` 与 `off→[]` | 2.9 新独立核心的完成状态、生产接线 |
| 通知与裁剪探针 | 6 PASS / 0 FAIL | 首次基线无通知；候选后第二次为空；写盘 EPERM 被吞；plan/ledger 默认 2000 预截断 | 所有通知类型的全路径证明 |
| Prototype 合同 runner | 27/27，0 skipped | Node/Windows 原型合同通过 | 生产可接入、所有旧版本形态、B1–B4 已闭环 |
| 既有 `p6a-rules-layer` | 123 PASS / 0 FAIL | 既有规则套件当前结果 | 其中完整版空输出放行已构成最终验收 |
| 既有 `v4-h5-user-portrait` | 39 PASS / 0 FAIL | 画像纯函数当前结果 | `makeFn` 工厂被真正调用 |
| 既有 `v6-b3-quad-render` | 42 PASS / 0 FAIL | 四段渲染及既有变异 | 首尾保留 |
| 既有 `t0-3-budget-ledger` | 96 PASS / 0 FAIL | Envelope 自身不变式 | 最终 `renderMemoryDynamic` 尾巴也计入账本 |

未把这些数字合并成“全绿总分”。本任务没有全量回归、真实模型训练、生产验收或 HOST 最终消费证明。

### 3.2 探针自身错误及处置

- 初版规则夹具混用了“两个 bullet”与“单条规则后续行”，已拆分；不能把两个 bullet 被拆成两条误判为任意多行都能完整保留。
- 初版 `memory_rules` 探针误按 JSON 解析；真实工具返回文本，不是 JSON。该错误属于探针，不属于产品错误。
- 初版方法抽取包装有语法错误；已改为只执行原方法体，不改被测逻辑。
- 首次简报只建立基线，没有通知属正常；随后才构造真实 mtime/size 变化。
- 初版白板夹具不足 2000 字，已加长后重跑。
- 早期探针把画像去重参数写成 `rulesTexts`；真实参数名是 `excludeIfInRules`，文档以下均按真实声明。

## 4. 2.3、2.9、Prototype 与批次3的真实依赖

### 4.1 2.3 与 SidecarStore 不直接耦合

当前 Prototype 的存储、CAS、共享锁、checkpoint/journal 和 `MarkdownSidecarAdapter` 不调用 2.3 模型。

**结论：**

- 模型训练不是存储/CAS/锁测试的前置条件。
- SidecarStore 也不替代 2.3 的候选召回、融合排序或人审协议。
- 2.3 的产物只能是候选、分数、margin、解释和 `status:"proposal-only"`。
- 禁止由模型输出直接触发 `attach`、`merge`、`archive` 或 `event-regroup-apply`。
- 1.4 的显式 eventId/L1 标识规则仍是自动归属边界，不能由高余弦越过。

需要冻结的是**接口和表示语义**，而不是让存储依赖训练：

- `model/weight identity`
- `dimension`
- `dtype`
- `pooling`
- `query prefix / passage prefix`
- `input representation version`
- `tokenizer/model path`

这些字段必须进入 embedding identity 和向量缓存分区，避免同一向量被不同 profile 复用而造成语义漂移。

### 4.2 2.9 是来源规范化与覆盖证明，不是归属判定

旧真实接口：

```text
appendHandoffCheckpointPre(storePath, {
  ledgerText, ledgerPath, eventId?, kind?, today?, boundaryMinutes?
})
→ { ok:true, eventId, deduped, sections:{goal,doing,deadend,next} }
```

实测行为：

- `sections.doing → checkpoint.state`
- `sections.deadend → checkpoint.dead`
- `sections.goal/next` 同名映射
- `checkpoint.text` 仍保存完整账本正文
- 相同 `ledgerPath + ledgerText` 的重复调用 `deduped:true`，只落一个检查点
- 显式 eventId 必须存在且状态为 active/paused；不可用时报 `event-id-unavailable`
- 无 eventId 时仍走 `resolveActiveEventPre`，没有则创建

来源证明：

```text
readPointerPre({handoffDir}, {
  sourceRef,
  expectedRawSha256?,
  expectedNormalizedSha256?
})
```

返回正文、bytes、rawSha256、normalizedSha256、sha16 和等价结果。

边界：

- `sourceRef` 必须相对可信 handoff 根。
- 根外、绝对路径、symlink、非法 UTF-8 均不能成为来源证明。
- 缺 sourceRef 为 `pointer-legacy`，不能据此证明覆盖。
- 缺完整 64 hex 为 `pointer-unverified`。
- sha16 只作展示，不能证明内容等价。
- normalized 相同但 raw 不同会显式暴露行尾差异。
- 覆盖证明只回答“内容是否被覆盖”，不授予删除、归档、自动认领权限。
- pre-WAL 和无法证明覆盖的存量禁止自动删除。
- log 不强套四段；handoff 才按上述字段处理。

2.9 独立核心文件由另一任务负责。本调查未修改、未执行其独立新文件，也不把其存在视为生产接线完成。

### 4.3 Prototype 只负责派生索引持久化

真实数据流：

```text
Markdown 真源
  → MarkdownSidecarAdapter.deriveDocument()
  → SourceChange{source,sourceRevision,expectedRevision,entries,parserVersion}
  → SidecarStore.replaceSource/replaceSources()
  → IndexState + JournalStorage
  → 八字段兼容 view / readSnapshot / exportLegacySnapshot
```

它不决定事件归属、注入档位或预算，也不应写 Markdown 正文。

实测隔离事务：

- 第一次 `replaceSource`：`changed:true, seq:1, bytesWritten:583`
- 相同 operationId 重试：`changed:false, alreadyApplied:true, originalSeq:1, bytesWritten:0`
- 八字段 view：`version/ws/rebuilt_at/entries/by_tag/by_cue/versions/sourceRevisions`
- stale CAS：`INDEX_REVISION_CONFLICT`，source revision 保持 `r1`
- close 后读：`INDEX_CLOSED`
- 修改返回对象的 tags 不污染内部条目或倒排
- 迁移不存在文件时仍得到原生 `ENOENT`，不是 `SidecarStoreError`

**B2 必须按真实接口订正：**

- `index.d.ts:72` 的 `parserVersion` 位于 `StoreStatus`，该字段合理。
- `SidecarStore` 类本身没有公开 `readonly parserVersion` 声明。
- 实测时运行时 `typeof store.parserVersion === 'undefined'`，`getStatus().parserVersion === 'wb-parser-v1'`。
- 因此不是“StoreStatus 字段声明错误”，而是“Store 公开只读属性在声明和运行时两侧均缺失；应保留 getStatus 兼容并明确是否补 getter”。

**B1 在实测时仍成立：**

非空 `versions:{id:['handoff/old.md']}` 在普通 `replaceSource` 后变成 `{}`。这不是现网已损坏证明，但属于接入前必须关闭的阻断。

B3/B4 仍按独立评审处理：

- `importLegacyFile` 缺批准根、regular-file 和稳定公开错误映射。
- 共享锁超时发生在 `withSharedStateLock` 包装回调之外，需要统一公开错误、cause、清理和后续队列语义。

task-15 的后续结果不追溯混入上述历史实测。生产接入须由 Lead 以最新代码重新复核；27/27 或任何后续原型分数都不等于生产放行。

## 5. 当前真实共同管线

```text
resolvePaths / refresh / readTextSafe
  → state.userText/notesText/logText/planText/latestHandoffText
  → refreshEventStatePre()
      readStoreForInjectPre()
      → pickT2EventsPre() → renderT2Pre()
      → renderEventCatalogPre()
      → buildUserPortraitPre()
  → renderMemoryDynamic(context)
      extractRulesLayerPre()/renderRulesSectionPre()
      → 内联 tier、规则摘要、白板章节选择
      → sanitizeForInjection() 默认 2000 预截断
      → weightedTrimHandoffLedgerPre()
      → team/global-brief 候选
      → composeMemoryEnvelopePre()
      → state.envelopeMeta / _recallStats.observeInjection()
      → 末尾另拼降级行
  → renderSlimSnapshotPre()
  → context text() 选帧/节流/授予
  → finalizePre() 按 requestIdPre 缓存最终文本
  → 宿主 project()/retained（本次未做最终提交证明）
```

M6 Reference Tail 是另一个 context 注册面。返回非空 tail 时设置 `_recallJustDelivered=true`，但插件非空返回不等于宿主已把消息提交给模型。

consolidate 是独立链：

```text
listDailyLogs(projectDir,60)
  → 最近 days 个非空日志，各 truncateTail(...,2500)
  → notesText/userText 各 truncateTail(...,1200)
  → runSubagent()
  → [PROJECT] ensureBudget + appendText(notesPath)
  → [USER] appendText(PENDING-USER-MEMORY.md)
```

当前没有事件库、白板、账本、反思的结构化来源进入该 prompt。

## 6. 现有模块接口与缺陷矩阵

| 模块 | 输入/输出与副作用 | 当前错误或边界 | 可复用方式与回滚 |
|---|---|---|---|
| `rules-layer.js` | 输入 `userText/notesText/rulesLayeringMode`；输出 rules/candidates/references/retired/counts/chars；渲染输出 text/chars/groups/warn。纯函数零 IO | `ruleSummaryPre` 取首条实质行且默认 200；非法 mode fail-soft；有锚点前内容按既有兼容语义不自动扩范围 | 保留抽取、分类、状态和两层分组；全文改由明确 Reader 提供。回滚只撤该单位，不改旧编辑协议 |
| `applyRuleEditPre` | `layer=user/project` 选文件；list 返回 path/layer/revision/items/preview；update/remove 支持 index/expect/revision；写 `writeFull(expectedDigest)` | 错误统一 `{ok:false,error}`；跨层 revision 实测拒绝；工具 list 固定调 `{}` 因此只取 user；`memory_read` 有 8000 上限 | 新聚合只读 API 不改变旧单层写入、索引或 CAS |
| `memory-envelope.js` | segments{bucket,kind,text,priority}+limits+budgetChars → text/chars/limits/segments/dropped/truncated/degradations/ok；零 IO | `budgetChars` 只产生 `over-budget-total`，不是总硬门；unknown bucket 归 otherDynamic；rules 忽略限额；非法限额回退 null | 保留分项账本；最终尾巴作为 segments 参与同一计量，不再事后追加 |
| `event-render.js` | T0≤80、T1≤140、T2≤2400、catalog≤400；T2 active 默认2；纯函数 | 检查点单项先头截 300；1400 字输入尾部标记不可达；四段 `doing/deadend` 与检查点 `state/dead` 不同名；空字段不输出 | 保留身份和分段预算；改首尾/动态预览并保留 sourceRef。回滚到旧 renderT2Pre |
| `user-portrait.js` | events + `excludeIfInRules/maxChars` → text/counts/dropped/truncated/excludedByRules；零 IO | accepted/used 才入画像，authorResponse 旁路；600 总限、5/3/3/3 配额；早返回 counts 不含 authorResponse | 保留结构化 userPercept 来源；不从自由文本推断画像；4.1 person store 另验 |
| `global-brief.js` | `diffBriefPre` 输入 previous/entries/isSelfWrite/limit，返回 changed/next/counts；`buildDraftPre/renderBriefPre` 输出候选文本。模块纯函数，引擎负责 IO | 首次只建基线；候选阶段即写水位、snapshot/outbox；EPERM 静默；`/global-brief` UI 也调用同一检测函数 | 拆 prepare/commit；以 diff.next+文档 revision 作版本票；UI 只读 prepare，不消费模型通知 |
| `wb-sidecar.js` | workspaceKey+规范化 relPath/title/ordinal → `mem_<32hex>`；build entries/byTag/byCue/versions/sourceRevisions；纯派生逻辑 | ordinal=0 保旧身份，>0 才加维度；生产 index.json 读改整写，原子 rename 不解决协作写者丢更新 | 身份与解析复用；持久化另由 Prototype 评估，不把 index 当事实真源 |
| `plan-render.js` | events → 当前状态/近期进展/关键约束/待办 + eventIds；不读 checkpoints；recent≤30、字段≤600、全文≤30000 | active 才进当前状态和待办；paused/closed 可进近期；空 sections 显示未填；末尾总截断 | 保留固定四节和 eventIds；3.0-B 另定 full/slim 视角 |
| `plan-derived.js` | existing+rendered+eventIds/workspaceKey → merged text/revision/bytes/bindings/archivedIds 等；纯函数，调用方持 PLAN.lock | 非法 binding、重复 id、重复 eventId、截断、缺 eventIds 等返回 `derived-*`；catch 返回 `derived-merge-threw` | 只继承同 eventId 的 memId，不按同名认领；用户区/自定义卡保留；失败不写盘 |
| `lib/index.js` | 生产状态装配、内联档位、候选渲染、request 定稿、真实 apply、读写 IO | 内联与模块函数重复；sanitize 预截断；尾巴后计；候选通知预消费；生产精简帧手工设档不等同真实生产帧 | Facade 只做依赖注入和旧契约兼容，不再复制政策；共享 `lib/index.js` 单写者串行 |

## 7. 已证缺陷与明确不成立项

### 已证

1. **规则全文并不完整**：`renderRulesSectionPre` 经 `ruleSummaryPre` 只取首条实质行并默认 200；两个 bullet 另行拆分是另一套合法粒度，不能混为完整多行正文。
2. **两层完整读取未闭环**：底层支持 user/project，工具 list 却只调默认 user；`memory_read` 另有 8000 截断。
3. **水位真源不一致**：服务端默认、解析缺省、手写前端、生成源均为 `25,50`。解析实测非法值回退 `[25,50]`，`off` 为 `[]`。
4. **总硬预算不存在**：Envelope 只执行两个分项限额和总超额诊断；`must` 也不是全局免截，普通段仍可能截断。
5. **最终账与最终文本不同**：降级尾巴在 envelope 外拼接，envelopeMeta 不包含该尾巴和后续授予/反思文本。
6. **通知候选预消费**：真实方法体第一次返回 243 字简报，第二次 0 字，水位已写；EPERM 被吞且水位未推进。
7. **plan/ledger 预截断**：2046/2068 字输入均先变 2000，plan 的 `TAIL-NEXT`、ledger 的 `DEAD-TAIL/NEXT-TAIL` 在选择前不可达。
8. **consolidate 读取面不足**：prompt 只有日志、已有项目笔记和用户级记忆尾部，没有事件/白板/账本/反思来源包。
9. **检查点单向截断**：1400 字检查点保留 HEAD，TAIL 丢失；最终 T2 长度 413。
10. **Prototype 接入阻断**：B1 非空 versions 丢失；B2 需按上述订正；B3 原生 ENOENT；B4 锁超时公开错误边界仍需按最新源码复核。

### 明确不成立或不能据此宣称

- “所有规则换行都丢失”不成立；多 bullet 会拆为多条，问题是单条规则正文与完整读取协议。
- “10 个 active 在 400 字目录必被截断”不成立；短名称/短 id 夹具可 10 条全列，但 T2 只展开2，长名称仍可能丢。
- “budgetChars 是总硬上限”不成立。
- “插件 finalize 等于宿主交付成功”不成立。
- “Prototype 无模型调用 ⇒ 2.3 必须先训练完成”不成立。
- “R4 WAL 完成 ⇒ 旧 `memory_note` 的 2.6–2.8 全部完成”不成立。
- “2.9 四段存在 ⇒ 规范化、覆盖证明、sourceRef 已闭环”不成立。
- “文件存在或源码含某函数 ⇒ 真实调用链有效”不成立。

## 8. 目标模块/API建议

### 8.1 Sources/Readers

```text
readInjectionSourcesPre({paths,state,policyVersion})
→ {rules,events,plan,handoff,reflections,logs,proofs,warnings}
```

- 只读；返回来源身份、相对路径、bytes、raw/normalized SHA、revision。
- 区分 missing / empty / unreadable / invalid，不能一律转空。
- 不改变 event store、PLAN、记忆或配置。

### 8.2 Projection/Policy

```text
projectInjectionPre({sources,tier,frame,config})
→ {candidates, notifications, policyVersion}
```

- candidate 带 `id/kind/bucket/priority/text/sourceIdentity/contentVersion`。
- 每段可有自己的档位名单，禁止为统一名单改变语义。
- full/slim 视角、无命中回退、特殊档边界仍待 3.0-B，不能在此擅定。
- 画像只使用 accepted/used 与 authorResponse 结构化来源。

### 8.3 Envelope/Budget

```text
composeFinalEnvelopePre({candidates,tier,budgetPolicy})
→ {text,chars,segments,dropped,truncated,degradations,unresolved}
```

- 标题、分隔符、降级尾巴、通知、反思均先成为段，再统一计量。
- 分别记录 JS `String.length`、UTF-8 bytes；token 口径未定时不得冒充 token 实测。
- `budgetPolicy.unresolved` 显式保留 3.0-B，不写死 50K 或 full 豁免。

### 8.4 Notification/Delivery

```text
prepareNotificationPre(scanResult)
→ {id,version,payload,commitToken}

finalizeInjectionPre({requestId,text,prepared})
→ {text,finalizeReceipt,selectedNotificationIds}

commitNotificationPre({requestId,finalizeReceipt})
→ {committed,skipped,errors}
```

- prepare 不写水位、不清待办、不调用 outbox。
- 只提交最终保留通知的 id/version。
- 旧 commit 不得清掉新待办；写盘失败必须显式返回并可重试。
- UI 观察只读 prepare，不消费模型通知。
- `finalize` 只代表插件定稿，不代表宿主已提交。

### 8.5 Adapters/Facade

- `lib/index.js` 保留旧生产 API、apply 注册、resolvePaths、锁、CAS 和写入权限。
- 政策移入共享模块，不能继续复制内联/模块双份逻辑。
- 既有四个直接抽取动态渲染套件逐个兼容或迁移；不新增“永久内联禁令”。

### 8.6 SidecarStore

- 输入 SourceChange、MutationOptions；输出 changed/seq/generation/bytesWritten/alreadyApplied。
- 只写派生索引，不决定归属、档位、预算，不写 Markdown。
- 错误使用稳定 `INDEX_*`；CAS/非法参数/关闭/锁/损坏分别处理。
- 生产回滚先停新 writer，锁内追平日志，从最新 store 导出兼容 v1，校验 Markdown revision 后原子写回，不能只恢复迁移前旧备份。

## 9. 风险与停止条件

1. 源码指纹或 HEAD 变化：停止并把基线与当前值分开，不能把旧实测冒充当前实测。
2. 3.0-B 未裁定：不得实施总预算单位、full 豁免、两份 MEMORY 范围、特殊档和无命中回退。
3. 通知版本不一致：停止 commit，不得清除新待办。
4. 读取失败：不得把 unreadable 当空文档或合法 tombstone。
5. Prototype 阻断未关闭：不得生产接线、迁移/删除真源、启用 2.4。
6. 宿主 project/retained 未验：不得宣称真实消费闭环。
7. 需要访问生产记忆、生产配置或 19387：超出本任务边界，停止。
8. 回滚必须按交付单位执行；禁止把整批成果或其他并行工作一并回滚。

## Lead 落盘补注（2026-11-13）

以上为原调查的历史基线与接口方案。独立后续结果不追溯写入上述实测：
- 2.9独立核心已提交787a41b8；39/0、3变异捕获及相邻回归已通过，生产接线/HOST未验。
- SidecarStore B1–B4已提交1d03c8f3；37/37/0 skipped、6变异捕获，生产facade/HOST仍未验。
- 3.0-A/B保持总表现行口径，本调查不等于实现完成。