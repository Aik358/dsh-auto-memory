# 批次 3 P3-0 接线映射回执

2026-11-18。只读测绘，以 HEAD `96bfded8` 加当前未提交的 P1/P2 工作树为基线。依据 [PLAN §2、§6](PLAN-DELIVERY-SETTINGS-MODULE-20261117.md#6-迁移与兼容)、[R1–R8](DECISIONS-BATCH3-POLICY-RULINGS-20261117.md) 与 [Lead P2 复审](REVIEW-BATCH3-P2-REVISION-ACCEPT-20261118.md#下一步)。P2 F5 和回归另见[修正回执](RECEIPT-BATCH3-P2-REVISION-20261118.md)。本文的「拟接线」和行数估算仅用于审查，不是 P3-A 写域授权。

**现状：P1 已有 Policy 模型、旧键适配、存储、预览和诊断；P2 已有三面共用设置，普通投递仍没有接上策略。** `lib/index.js:23970` 的动态面 `dsh:auto-memory-pre` 内联控制节奏，在 `:24126`/`:24159` 分别构造完整、精简文本；普通投递只在 `:13684–13691` 读取 `deliveryPolicy` 的总开关与诊断参数来决定是否追加诊断。`:29121–29163` 的预览使用最后活跃运行态的缓存，不是该动态面的实际输出；`preview.js:218–221` 仍返回 `partial:true`。静态纪律 `dsh:auto-memory-pre-rules`（`:25116`）和 M6 的 `dsh:m6-reference-tail-pre`（`:25126`）是两个独立面。

基线：`lib/index.js` **30,309 行 / 2,205,192 B / 41 导出**，全 CRLF，SHA-256 `bf640e2484c263784c77c2e09038bf2a405825c68d6a0392f23858e2382ec00d`；`lib/client.js` **27,060 行 / 3,017,717 B / 14 factory 导出**，全 CRLF，SHA-256 `f9a3119cb466fe1a5190baa367eb676e71f2b24ff91c46c5888ca8f18b11eeb9`。PLAN SHA-256 `d6c5928257d7ed073eef0181973e4bf6882950d5b24346b2f7c89fe7bba34ec3`，R1–R8 SHA-256 `0eb2acf7b10c4a730194429efe9b98c2396ed252bcc2472a26424bc1125e1cd5`。P3-0 不改变生产代码、生成物、公开键/路由、版本与提交。

## 1. CA 节奏、受众与内容档

以下生产行号默认指 `lib/index.js`。`decideInjectTierPre`（`:2150–2159`）区分受众 `isHuman` 与帧授予 `isFull`；公共 CA 的 `tier=full/slim` 是节奏值。应将真实 `isHuman`、实际授予、特殊触发和最终内容档分别传递，通过现有 `resolvePolicy`（`policy-v2.js:337`）绑定本请求的策略，不能从 `tier` 字符串反猜受众或从是否有人发言推出授予。

| 来源/受众 | 实际授予 | 内容预设或兼容路径 |
|---|---|---|
| 真人普通请求 | full / slim | `human_full` / `human_slim`；真人水位、正常间隔、压缩与交接分别记原因。R5 要求真人 slim 可达。 |
| 运行请求 | full / slim | `run_full` / `run_slim`；`run_slim` 是提醒档。节流可以不刷新授予标记，原提醒文本仍可被宿主按整串去重。 |
| `post_compact` / `handoff_carry` | 特殊重建/未就绪兜底 | 解析为 `human_full` 加对应 override；`!ws && globalLedgerPath`（`:24085`）不能当作真实跨会话交接证据。 |
| `hang_compensate` | 实际达到挂机代位条件 | 解析为 `run_full` 加 override，仍要显式传 `isFull:true` 及真实 `isHuman`；resolver 的缺省推导没有把此档计为 `isFull`。 |
| `legacy` | 旧路径 | 保留兼容路径。P1 resolver 的 `legacyLocked` 固定兼容视图并以 `run_slim` 回显策略档，不能拿这个回显作旧产线重放。 |

| 旧控制或新开关 | 实际生产读取点与状态变化 | 拟接策略 / 无 policy 的回退 |
|---|---|---|
| `snapshotMinGapRounds` | `:24129` 外层分支、`:24212` full 步数、`:11053` 精简提示；`:24269–24274` 是模型请求序号，`0` 有不节流兜底。 | `triggers.fullGapRounds`，缺省 40。兼容保留旧解析、截整/钳位与 `0` 行为。 |
| `slimEveryRounds` | `:24130`、`:24214`，实际计数比较 `:24493–24502`；显式 `0/1` 在计数处都为 1。 | `triggers.slimEveryRounds`，缺省 15；不把 `slimAllowed:false` 直接翻成空文本。 |
| `fullInjectWaterPct` | `:24302–24316` 按 agent 观察、计算越线和回落重置；`:24634–24646` 要求水位与真人/pending 同时命中。`:24783` 普通 full 还可能提前记为已投。 | `triggers.waterPct` 规范数组，缺省 `[25]`，显式 `[25,50]`/自定义保留、`[]` 关闭，不能再走旧字符串解析。回退读取原键及 R8 迁移戳。预警 `waterLevelThreshold`（`:13351`）、压缩观察及接续阈值仍属原系统。 |
| `snapshotTieredInject` | `:24159` 控制准备精简文本；`:25085–25110` 可回落完整帧。 | `triggers.tieredInject`。这是分级开关，不是注入总开关。 |
| `snapshotReinjectOnCompact` | 只控制 `:12735` 的压缩提示；`:24113–24119` 首观测基线/增长置 pending，`:24930–24945` 强制重建不读此键。 | `triggers.postCompact` 已有 `always/off`。关闭授予与保留观察应分开；能否由此关闭重建，见 C3。无 policy 保留旧提示语义。 |
| `injectEnabled` | `:23984` 动态快照总闸。 | `policy.enabled`。保留静态纪律、M6 和检索/写入的独立边界。 |
| `hangCompensateEnabled` / `hangCompensateTokens` | `:24054` 只猜档，`:24595–24612` 累计输出 token、`:24655–24663` 达阈才实际授予/清零。旧 `0` 按 300000 回退。 | `triggers.hangCompensateEnabled/Tokens` 默认关/300000；只用实际授予选档，pending 真人不应被当作挂机受众。 |
| 真人 / 首帧 / 交接 | `:24756` `_grantByHuman=false`；`:24695`、`:24952` 以 `_snapFp===undefined` 判首帧。`:24085` 是 carry 兜底。 | `triggers.human/firstFrame/handoff` 已有字段，无等价旧键。需先确定真实交接信号及与强制重建的优先级；`handoffEnabled` 不等同于此触发。 |

请求级接线顺序：固定配置来源、agent 与 `requestIdPre` → 检查已确认定稿复读（`:24365–24372`）→ 观察压缩/水位/受众和当前授予事实 → 决定 `sourceTier`、布尔值和 `contentTier` → 只渲染选中的档 → 终稿判定 → 发布本请求记录和已接受的状态增量。应复用 `:24269` 的序号，不把首次读到的历史压缩当新事件，也不能让失败的帧先吃掉水位、pending 或精简步数。生产当前在不同分支边组帧边更新状态，这个提交边界需要由 P3-A 明确。

## 2. 模块、档位默认与语义单位

下表的四档值是 **P1 `PRESETS` 代码事实**（`lib/injection/policy-v2.js:109–134`），并非生产已执行或最终产品认可。每格是 `modules.<id>.enabled/view`；「关」仍有保留的默认视图。`representation` 决定选中单元的完整、摘要、预览或指针形态；`view` 决定模块的语义范围。配额 `quotas` 以注册表的单位按 delivery/event/module 计数；单段/总传输保护再按字符、字节度量。

| producer | `human_full` | `human_slim` | `run_full` | `run_slim` | 生产出口（`lib/index.js`）与拟接单位 |
|---|---|---|---|---|---|
| `rules` | full | pointer | pointer | pointer | 完整 `pushPart("rules", "rules-section", …)` `:12894`，RP `:12846`；精简 `:11035–11061`。按 `rule`/`ruleModule` 和规则级身份选；真人完整版保留有效完整规则。`maintenance` 是子段，依契约只放 `human_slim`；旧精简 `:11060` 无条件加，不能随意复制到其他档。 |
| `plan` | full | core | core | 关 | `memoryReferences/whiteboard-plan` `:13148`；读取门 `:12929`，BD 投影 `:13084–13146`。以 `planSection` 及源标题/身份选节，`core` 是选节而不是截字；`_isFullTier` `:12975` 是预算名单。 |
| `handoff` | full | sections | sections | 关 | `memoryReferences/handoff-ledger` `:13196`。`ledgerSection` 按 `type:*`；R1 的 `run_full` 只允许 goal/dead-end/progress、基准 800 字保护，需先选段后裁，不允许 `type:state` 回流。名单 `:13162` 独立于白板。 |
| `events` | cards+catalog | cards | cards | cards | `memoryReferences/event-cards`（priority `must`）`:13231`、`event-catalog`（normal）`:13256`；精简 T1 `:10961–10987`。用 `event`、每事件 `checkpoint`、`catalogEntry`，按 ID 去掉已展开目录。旧 `eventCardsText` 已经历 T2 检查点限数和截字（`lib/event-render.js:301,386–406`），预先裁好的 `buildEventCandidatesPre`（`event-view.js:451`）也不能证明 full。应从原始可用检查点出具身份和表示。 |
| `portrait` | full | short | 关 | 关 | `otherDynamic/user-portrait` `:13336`、生产刷新 `:10543–10552`；精简 `:10988–11020`。`portraitItem` 先过采纳/使用状态及规则去重；只拿 `userPortraitText` 无法回推条目身份，预览路由也没传 `portraitItems`。 |
| `semantic` | full | full | full | 关 | `otherDynamic/semantic-recall` `:13285–13310`，旧段由画像、共同经历、情感拼接且限制档位。`retrievalHit`/`evidenceBlock` 应由结构化召回 provider 出具；当前不能将该段宣称为已接入的语义检索，独立 M6 不自动纳入。 |
| `calendar` | current | current | current | 关 | `otherDynamic/calendar` `:13647`，`:13632–13635` 非无人值守，最多 10 条未来未完成。以 `calendarEntry` 计数；`full` 应用什么资格范围待定，纪律文案不算日历条目。 |
| `externalMemory` | full | 关 | 关 | 关 | `otherDynamic/external-memory` `:13625`、`external-sessions` `:13628`，provider 过滤 `:13605–13608`。目前内容是源/会话索引；能数 `source`，尚无已接的 `memoryRecord` 全文单元。与 Tier-0 命中过滤分开。 |
| `workspaceMap` | full | brief | brief | 关 | `otherDynamic/workspace-map` `:12897`，`:9752–9761` 取工作区名及日志日期。能数 `workspaceEntry`；`moduleReference` 要结构化来源。当前预览 full/brief 同一数组文本（`:29144`）。 |
| `recentLogs` | tail | 关 | 关 | 关 | `part(memoryReferences, recent-logs, …)` `:13553`，`:9496–9507` 每日单条预取 700 字尾，`:9664` 刷新。`logEntry`/`documentSection`；达成 full 需未截尾、仍满足天数的来源。`logs` 只作 alias，不增加一条候选。 |
| `reflection` | recent | 关 | 关 | 关 | `part(memoryReferences, reflection, …)` `:13556`，`:9712` 最近反思。产线是 `reflectionDigest` 的结果，以 `reflectionEntry`/`documentSection` 计；`:13967` 的一次性反思请求是独立行为。 |

`deliveryModule` 是 11 个 producer 均可用的计量单位：一个模块即使渲染多个文本段，仍按同一模块身份计一次。两段锁源 `user-memory`/`project-notes` 在 `:13594–13598` 经敏感内容过滤后按 `subEv` 取尾并以 `must` 加入；legacy、人类完整、carry、post_compact 才进入此分支。策略注册表两段都固定 `locked`，校验不接受删去锁源或对它们加 `enabled` 开关。在符合投递资格的情况下保住锁定身份和来源约束；每档投不投、完整表示及硬顶冲突见 C5。诊断是独立的 `modules.diagnostics`，预览/生产关闭时不读文件；生产现已在完整渲染路径可选注入，是否扩到原精简出口须明确计量范围，仍用现有只输出 code/count 的 provider。

`PROMPT_SECTION_KEYS_PRE_V1`（`:1654`）有 **13 键**，包括标注为 must 的 `plan-update-request`、`water-advisory`（`:1675–1678`，提示性分类，用户仍可关）；这两个也不是锁源。13 键、11 producer、2 锁源各有自己的身份。`pushPart` 按 `kind` 消费旧段开关；其他出口要逐个审计，不能用 `MODULE_REGISTRY` 替换 13 键，或把整个 M6、框架、欢迎、检索引导都解释成模块。`preview.js:59,121,196` 目前如实报告未执行语义配额、没有检查点覆盖，必须等对应来源和选择器验证后再去掉这类告警。

## 3. 预算与 transport

| 旧键 | 生产消费者 | 策略落点与需保留的边界 |
|---|---|---|
| `injectBudgetChars`（8000） | `:10707–10712` 给 Tier-0 派生字符及 token 估算；`:12592` 的证据分配；`:12970` 白板全档；`:13698,13720,13797–13802` 桶配置及总量观察。`lib/memory-envelope.js:228–235` 的 `over-budget-total` 仅记账。 | `transport.jsChars` 是适合用户设定整帧目标的位置，但 P1 `legacyToPolicy`（`:397–398`）把它定义为 hard，**不是旧行为的无损翻译**。无 policy 保留旧分配/超额账，显式 hard/soft 才按新语义；Tier-0 与旧桶预算不能跟着被隐式重新定义。 |
| `fullInjectSlimBudgetChars`（3000） | `:12968–12977` 白板瘦档预算，`:13715–13722` 同步桶预留；不是整份 slim 帧的全局限额。 | P1 目前只在 `compatibility.legacyKeys` 带值。应映射到指定档位的 `modules.plan.transport.jsChars` 或兼容分配；明确 0/下界语义和渲染/桶同源后才能切换。 |
| `handoffLedgerChars`（800） | `:13152` 单段预算，`:13722` 桶预留；旧读法 0/无效回退，最小 200。 | 已派生 `modules.handoff.transport.jsChars`（`policy-v2.js:404`）。按 R1 保留账本视图域；显式新值的 `0` 是否省略整单元与旧回退分开，不能静默替换成 800。 |
| `handoffPlanChars`（1200） | `:12967` 赋给未消费的 `_fullBudget`。 | 死键只读影子；无 transport 映射。F5 已撤掉编辑输入。 |

**现有计量点。** 完整线在 `:13774–13802` 先中和模板变量、执行通道区限制和 `composeMemoryEnvelopePre` 的桶裁剪，再在 `:13862` 追加注入型降级尾巴。精简线 `:10845` 直接组文本。回调出站另拼精简授予标记、一次性反思请求（例如 `:25021,25107`）；`renderReflectionRequest()` 会置位（`:13967` 起），不可在 dry-run 中调用。`:24166` 的 `finalizePre` 只记定稿缓存，不会复查预算。当前 `lib/injection/final-frame.js:54` 的公共合帧只在预览/事件帧路径使用；`compat` 计量，`hard` 只实现 `capChars`，且段对象未保留 `locked`，不能直接替换生产。P1 预览自管全局字符/字节与锁源（`preview.js:176–189`）。

**拟定稿边界。** 选中策略与单元后，再序列化所有属于本动态面的实际文字（包括标题、换行、分隔、降级尾巴、授予标记；反思/通知行为是否纳入本账见 C6），量对象就是将交给宿主的文本。每个模块先检查有类型的单位配额和该段 `transport`，最终合帧再用总 `transport` 检查。`jsChars` 为 UTF-16 code unit，`utf8Bytes` 为编码字节，token 保持 `null`；实际调用公共 FM 装 `中😀`、`a` 两段，加两字符分隔后为 **6 chars / 10 bytes / token 未计**。硬上限超额只能换被允许的完整表示、整单元移除或显式不可满足；软上限另外记录目标超额和明确 allowance，不能把 soft 当无限；超过 allowance 也必须调整或失败。

**单元边界。** 每个候选由来源形成稳定的 `moduleId/unit/unitId`、父单元、`sourceRevision` 和可用表示，先验证来源资格、依赖/成组保留，再按 `quotas[].{unit,scope,max,strength,overflowAllowance}` 选择。三个完整检查点就是三个受选的检查点 ID；目录、摘要、指针和截断不计入完整数，回执单列表示与覆盖。`human_full` 的完整检查点超限时只能免投整个单元或按明确降档条件重算；不能截字后继续标成 full。记录实际保留/省略 ID、计数、原因、失败及最终字节；预览使用同一选择与定稿核心，宿主 adapter 才能提交。公共 [Unit Policy 复核](REVIEW-BATCH3-UNIT-POLICY-20261117.md#6-施工顺序重排) 把有身份的枚举/选择列为 U0–U3；P3-A 若没有拿到这些依赖，只能分段接入并保留 `partial`/未接说明，不能去掉限制提示后宣称单位配额已启用。

## 4. 其余旧设置的归属

| PLAN §2 键群 | 当前读点与拟归属 |
|---|---|
| `promptSectionToggles` | `:12666–12673` 在完整出口按段关。P1 `policy-v2.js:400–402` 仅有六个映射：`rules-section→rules`、`whiteboard-plan→plan`、`handoff-ledger→handoff`、`calendar→calendar`、`external-memory→externalMemory`、`workspace-map→workspaceMap`。其余七项 `tier0-catalog`、`external-sessions`、`welcome-title/body`、`plan-update-request`、`water-advisory`、`handoff-pointer` 没有等价开关；例如 P1 关 `externalMemory` 是整模块，旧 `external-memory` 和 `external-sessions` 可各关。应保持 13 键及原入口，待逐段等价再替代。 |
| `injectExcludeSources` | 真实键为单数 `Exclude`（无 `d`）；`:10767` 和 `lib/tier-layer-inject.js:603,617` 过滤 Tier-0 目录和命中，`:29231–29234` 校验保存。P1 挂到 `modules.externalMemory.selection.excludeSources`（`policy-v2.js:411`），不是等价接线。先保留有效过滤；可提案给内部来源过滤独立字段，不能借禁用外部记忆撤掉它。`externalSources` 是另一组来源发现/读取开关（`:4516–4526`），保留。 |
| `handoffEnabled` | `:12929,13347` 渲染门；另有 `:5223,5265,8516,9677,20463` 的产物写读、接续/维护。Policy 只接 `modules.plan/handoff.enabled` 的投递部分；旧开关继续管独立行为。需要分离来源权限与渲染选择，不把 `triggers.handoff` 绑成同一闸。 |
| `handoffPlanSections` / `handoffPlanSectionMax` | `:13009–13010` 的 `_planSections` 未被主委托消费，实际是 `:13100 _ps.sections`；不能当已生效的设置。P1 有 `modules.plan.selection.sections`（`:410`），用于 core 的结构选节，接生产会新增行为。`handoffPlanSectionMax` 的生产单节上限见 `:2170,12981–12982,13102`（默认 2000，另有 legacy 特例）；v2 没有独立白板每节传输字段，模块总限额不等价。 |
| `eventMaxActiveInInject` / `eventCatalogChars` / `eventCatalogRecentClosedDays` | `:10419` 筛完整事件，`:10485` 目录字数，`:10492–10495` 关闭事件天数。P1 `policy-v2.js:406–408` 对应 `modules.events.quotas` 的 `event/delivery` 和 `selection.catalogChars/recentClosedDays`。把选择移到可识别来源上；旧 `maxActive=0` 会回默认 2，而新硬配额 0 可以明确不选。 |
| `fullInjectSemanticChars` / `recentDaysInjected` | `:13304` 为旧关系背景段预算（800，最小 200），映射 `modules.semantic.transport.jsChars`；`:9664` 日志读取天数（公开缺省 1，直接 0/无效回退到 3，再保证至少 1），映射 `modules.recentLogs.selection.recentDays`。保持旧读取窗口与新配额区别，不能以天数替代 `logEntry`。 |
| `tier0CatalogEnabled` / `tier0MaxTokens` / `tier0BudgetShare` | `:10694,10707–10712` 直接 gate/钳位，公开缺省 `true/600/0.25`，内部缺值各有回退。Tier-0 是内部段并已有独立 13 键开关，不在 11 producer；暂保留旧控件与消费，未来可做内部段高级策略，不能冒充 token 实测。 |
| `handoffPlanChars` / `externalInjectionChars` / `slimCheckpointCount` / `slimPlanChars` / `slimLedgerChars` | 前两项 F5 只读（死读 `:12967`、明确无效 `:13611–13616`）；`slimCheckpointCount` 仅定义，后二者已废弃。均不加入有效选择或预算，保留历史值；后二者不恢复 UI。 |
| `promptLayerOverrides` | `:10888,12596,13642,13875` 的精简、完整、日历、静态层文案，继续留在高级设置。 |
| `procedureInjectEnabled` / `globalBriefChars` / `teamInjectEnabled` | 默认 `true/1200/false`；规程（`lib/procedure-switch.js:26`、`lib/activation-host.js:339`、`lib/context-host.js:579`）、全局简报草稿（`:20593`）、团队入帧（`:13744` 与团队总闸）各保留真实入口，不迁入策略。 |
| `maxPacketItems` / `maxPacketChars` / `injectionCooldownSteps` / `softInjectionEnabled` | 公开默认 `2/800/3/false`，现树 `lib/` 仅定义和 Policy 影子枚举，无运行消费者。保留兼容键，不把它们当 M6、软注入的新生效控制或拿来代表 Policy 预算。 |

## 5. 策略优先、兼容影子和回滚

1. **读取**：显式有效 `deliveryPolicy` 优先；缺失或删除时用 `legacyToPolicy(config)` 在内存派生回显/兼容设置。当前适配器在 `policy-v2.js:385–419`；GET `/config`（`:29181–29188`）和预览（`:29130`）已用它，生产普通投递还没用。回退应当保住旧用户的实际行为；当前派生不是等价重放，可先让适配器提供内存视图并保留原渲染/预算路径，或先证明新的兼容路径等价。此选择见 C4。
2. **写入**：三面同一个 `saveConfigPatch({deliveryPolicy})`。配置事务 `:4408–4412` 先校验，经锁合并（`:4433`）原子写盘（`:4507`），成功后发布（`:4527`）。用户保存不改旧键；启动 R8 迁移独立（`:4199–4209`），先形成稳定基线再比磁盘前后。预览请求仍只有四个已定字段，不能接受浏览器传入来源正文、路径或会话 ID。
3. **旧控件退场**：先证明该语义在正常与精简出口都用新策略、旧值可逆、重复请求无重复消费，再按键转成只读影子。仅在显式 policy 生效时冻结已经完整替代的旧控件；未迁的 13 段、Tier-0、共享产物/其他子系统仍按真实消费者编辑。无 policy 时恢复原有效控件的生效路径。F5 死键无论哪种状态都只读。P2 的生效范围提示等到实际接线和验收通过再调整。
4. **回滚**：现在兼容页（`skins/iter5/policy-settings.js:786–823`）发 `{deliveryPolicy:null}`，引擎把 null 写入磁盘、运行时视为无 policy。PLAN §6 字面要删键；若批准物理删除，候选为在同一保存事务把该命令解释成删除磁盘属性，内存仍允许默认 null（`DEFAULT_CONFIG` `:1172`），且启动补齐及常规保存不可把 null 再写回。保持同一 POST 键/路由，不另造删除 API；验证保存、清除、重载、再保存及旧键字节/行为对照。已存 policy 的 `compatibility.legacyKeys` 是快照，当前回滚影子的值应由 `/config` 原始 `config` 提供。

## 6. 待 Lead 裁定的冲突

每项并列现有契约与不等价的实现证据。建议用于冻结 P3-A 口径，本轮没有据此改生产。

| 项 | 事实 A | 事实 B | 需要裁定的最小边界 |
|---|---|---|---|
| C1 真人旁路 | 公共 CA 保留 r3 旁路（`cadence.js:258–265`），`human-turn` 可绕过低/关闭/已消费水位及间隔；P1 `triggers.human` 缺省 `always`。 | 生产 `:24756` 显式 `_grantByHuman=false`；真执行生产抽取的 `tiered-branches.mjs:207` 为 **FSSS**。R5 要 `human_slim` 可达，用户也要求完整档在压缩交接/已越线真人等时机才投。 | 保住公共 CA 调用默认，给生产一个显式的独立真人 full 授予设定；actor、真人水位 AND 门和整帧降档各自独立。需定 `always/off` 的产线含义和默认；不得靠改报 `isHuman` 实现。 |
| C2 水位及节奏旧值 | R8 要缺省 `[25]`、双档可选、`off/0` 关闭、自定义保留；旧 parser 接收 `'25.5'`，gap 旧解析处理空值、截整与钳位。 | 纯函数实测 `'off'/'0' → [] → parseWaterThresholds([])=[25]`；`legacyToPolicy({fullInjectWaterPct:'25.5'})` 抛 `expected non-negative safe integer <= 100`。旧 gap `null/''` 缺省 40、`'2.5'→2`、`1500→1000`；v2 派生为 `0/40/1500`（`index.js:1745`、`policy-v2.js:379–392`）。旧普通 full 还可消费水位（`:24783`）。 | 确定旧合法配置的兼容/归一化策略，不改落盘旧值；显式 v2 `[]` 不再经过旧 parser。另定非真人 full 是否允许消耗「已越线待真人」的水位。 |
| C3 压缩/交接/首帧 | `policy-v2.js:243–252,394` 有 postCompact off、首帧/交接开关，且把旧 false 解释成 off。 | `:12735` 旧 false 仅关提示，`:24930–24945` 仍强制压缩重建；`:24085` carry 是未绑定工作区的代理信号。 | 指定关闭项控制的是提示还是授予，以及真实交接信号从哪来。适配器须保留压缩基线观察，不把被关闭的旧提示升级成禁止重建。 |
| C4 兼容及档位例外 | PLAN §6 说缺策略时派生；P1 以全局 hard 解释旧总预算、legacy 锁定 `run_slim`、挂机映射 `run_full`（`policy-v2.js:345–358,397–398`）。 | 旧总预算有仅观察用途；`:12975–12977`/`:13715–13722` 白板全档名单、`:13162` 账本名单、`:12846–12894` 规则名单各不同，legacy 与挂机档不是旧的同一种瘦档。 | 缺 policy 选择保留旧执行或先证明等价再统一；保持 `_isFullTier` 与桶镜像的对白板范围，不用一个 `isFull` 放宽所有模块；明确挂机的规则/账本 override。 |
| C5 锁段资格 | P1 registry 固定两锁源，预览策略开启就尝试全文（`preview.js:148–157`）。 | 生产仅四种来源档且先取尾（`:13594–13598`），旧 `pushPart` 对任意 `kind:false` 生效；真执行原闭包，手工塞 `user-memory/project-notes/frame-tail:false` 会关掉它们。 | 锁表示无用户开关，但仅既定档位可投，还是每档必投？建议按有资格的档锁定身份，不能隐式扩大低档；硬顶放不下须有明确结果。禁止用非白名单旧开关关闭新策略锁段、框架。 |
| C6 最终预算和提交 | 旧 envelope `must` 过限可保留并报告（`memory-envelope.js:209–235`）；静态纪律／M6 独立。旧回调在终稿前可能消费水位、pending、反思。 | v2 preview 独立做字符/字节与锁段不可满足（`preview.js:176–189`）；公共 FM `hard` 仅 `capChars`，普通 `locked:true` 段可被丢。现 `:24166` 不是计量器。 | 冻结整帧计费边界：静态/M6 是否独立、一次性反思和行为通知如何计；明确锁/结构不能装入时失败、降档与回执。区分候选、定稿、真实宿主交付的证据等级和允许提交点。 |
| C7 删除及旧写入 | PLAN §6 要单键保存、旧键只读影子、删除即回滚。 | P2 回滚持久化 `null`（`:4410,4433,4507`）；启动/常规保存有默认合并，`/config` 仍允许接收旧键（`:29231`）。`compatibility.legacyKeys` 是保存时快照。 | 裁定 null 等价删除还是磁盘真删；决定仅 UI 冻结或服务端也拒绝已被策略替代的旧键写入（旧客户端兼容）；不冻结仍有独立消费者的键。 |
| C8 四档与跨档编辑 | P1 单个 `presetId` 加与预设的差异，会跨档合并（`policy-v2.js:337–375`）；`presetOverrides` 只对 3 个特殊档开放。 | P1 `run_slim.events.enabled=true`，现生产提醒档不出卡（`:10961,13230`，完整动态目录还有独立门）；`run_full` 默认语义背景与当前生产的资格范围不同。实测 slim 可保存 `{preferred:'preview',fallback:['omit']}`，请求进 `human_full` 时抛 `human_full allows only full or whole-unit omit`。 | 确定 4 档的生产默认以及普通档编辑是全档共用还是分别保存；若允许档间继承，规定可继承字段与安全的迁移/拒绝路径。不能让一个合法设置导致另一档请求静默空帧。 |
| C9 13 段保留 | 13 段开关已恢复可写，P1 只把 6 项并入可配置模块；schema 没有通用 `sections` 字段。 | 精简直拼、团队/简报直接 `segs.push`、静态/M6 绕过 `pushPart`；`water-advisory` 的 UI must 标记与生产 normal 不同（`:13352`）；`plan-update-request` 在段闸之前已清 pending（`:14039`）。 | 逐段确定是内容模块、运行提醒还是独立行为。模块关闭和分区关闭同时存在时明确优先级及副作用；不能把旧 13 段开关整体只读。 |
| C10 账本和单位完整性 | R1 的 `run_full` 三段且基准 ≤800；R5 的真人完整版检查点必须 full 或整项省略。 | 真执行生产 `ledgerPart` 闭包：四段原文 1679、三段投影 1625，`:13171–13179` 取较短后实际 787 且含 `STATE-SHOULD-BE-OMITTED`。EV 的现有文本已经先限数或截断，P1 回执 `checkpointIds:null`。 | R1/R5 约束已定，P3-A 候选修复为先选结构段，再对已选内容加权。须明确 P3-A 是否获准引入 U1/U2 的依赖；否则先做节奏/已有来源等分段接线，保留未接披露。 |

## 7. 候选施工锚点与写域估算

行号取 P3-0 工作树。实测 156 处全文件锚点和 classic 3 处模板定位。「各 1」表示按保留缩进和行尾的完整行在扫描范围内命中一次；标明限域的锚点必须先固定宿主函数再定点。不把单独的 `try`、`if (gap > 0 && snap)` 或跨档重复 return 当作锚点。`lib/index.js` 有 30,309 个 CRLF、无裸 LF，另有一处行内 CR（`:26309`，HEAD 同样存在）；不做行尾清洗。增、删行按行内所列子范围估算，不应把互斥方案或共享节点累加为施工承诺。

| 文件:锚点行（EOL） | 实测定位、候选用途 | 估算增 / 删 |
|---|---|---:|
| `lib/index.js:201,23970,23984,24126`（CRLF） | import、动态面注册、总闸、完整渲染调用各 1；绑定请求级策略，缺键留兼容分支。 | +8–20 / −1–5 |
| `lib/index.js:24129,24130,24159,24212,24214,24302,24634,11053`（CRLF） | 外/内间隔、精简开关、水位输入/授予、精简提示各 1；接 `triggers`，保留请求序号 `:24269` 定位。 | +10–25 / −6–12 |
| `lib/index.js:12735,24054,24085,24113,24119,24595,24596,24655,24695,24756,24783,24930,24945,24952`（CRLF） | 压缩提醒、挂机/交接猜档、基线、pending、挂机值/授予、首帧、独立真人、水位记账、实际压缩消费各 1；C1–C3 裁定后选择相应 hunk。 | +15–45 / −7–22 |
| `lib/index.js:9553,10404,10690,10767`（CRLF） | `refresh`、事件刷新、Tier-0 构建、`excludeSources:` 读点各 1；保留旧缓存和来源过滤，另在拟接路径取结构化身份。`budgetChars` 在 `:10707`/`:13698` 去掉缩进后同文，必须分别限于各自方法。 | +35–85 / −5–20 |
| `lib/index.js:10845,10975,10990,11036,11046,11060`（CRLF） | 精简方法、T1/画像、规则计数/指针、维护尾行各 1；避免仅改完整线而使精简配置继续失效。 | +20–50 / −5–20 |
| `lib/index.js:12540,12669,12846,12894,12897,12929,12975,13009,13100,13148,13152,13162,13171,13179,13196`（CRLF） | 完整方法、段 gate、RP、规则和地图出口、白板门/预算/选节/出口、账本预算/名单/裁剪/出口各 1；按 §2 逐段更换输入，不改原函数整块。 | +40–90 / −15–55 |
| `lib/index.js:13231,13256,13306,13336,13553,13556,13594,13597,13598,13625,13628,13647,13684`（CRLF） | 事件、语义、画像、日志、反思、锁源、外部和日历出口，以及诊断既有 guard 各 1；无结构化来源的视图保持未接，不造假。诊断复用 provider，关闭零读。 | +35–95 / −8–30 |
| `lib/index.js:12925,13345,13348,13352,13677,13678,14039`（CRLF） | Tier-0、白板更新、交接指针、水位提醒、两段欢迎和 pending 消费各 1；只在 C9 裁定后处理段清单剩余路径。 | +10–30 / −3–12 |
| `lib/index.js:12592,12968,12970,13508,13715,13718,13722,13730,13774,13781,13797,13824,13862`（CRLF） | 证据、瘦白板、整帧参考及桶镜像、中和/通道、envelope/meta/尾巴各 1；原桶保留供回退。显式 policy 的 final-frame 不再把旧字符截片冒充完整单元。 | +20–55 / −5–23 |
| `lib/index.js:13967,24166,24369,24532,24646,24663,24837,24903,25021,25110`（CRLF） | 反思、定稿/cache、同请求复读，以及实际产生附加文本的入口；按完整行或各授予条件块定位。将最终计量移入出站前的共同调用，保留上游唯一请求键和宿主确认纪律。 | +30–85 / −10–42 |
| `lib/index.js:4060,4408,4424,4433,4507,4527,29231`（CRLF） | 默认合并、校验事务、durable 合并、原子写、发布、白名单各 1；仅按 C7 处理回滚/兼容写入。R8 metadata、公开 182 键仍原样。 | +5–18 / −1–5 |
| `lib/index.js:29121,29130,29186`（CRLF） | 预览路由、策略来源、GET 回显各 1。只改同一接口内的数据装配及确定来源标记；不增加路由或输入字段。 | +10–35 / −3–18 |
| `lib/injection/cadence.js:147,171,194,230,260,295`（LF） | 决策、受众、解析、压缩授予、r3 真人分支、定稿各 1。只有经批准为生产增加显式输入才动，保留 r3 默认行为；`dto.js` 现有 `isHuman` 足够，不预增导出。 | 0 / 0 或 +8–20 / −1–5 |
| `lib/injection/policy-v2.js:109,158,176,195,232,255,337,385,411`（LF） | 预设、transport/配额、模块字段、触发、顶层字段、resolver、适配、排除映射各 1。只修批准的兼容语义；若跨档独立配置需要扩 schema，单独评审。 | +20–70 / −4–20 |
| `lib/injection/render-rules.js:112`、`projection.js:142,172`、`project-handoff.js:158`（均 LF，后三者同目录） | RP、画像过滤、PJ、BD 定义各 1。保留现有调用面；新增原始单位枚举或对现有投影做边界修正，RP/BD 不在宿主复制。估算按文件。 | RP +10–30 / −2–10；PJ +25–65 / −10–30；BD +10–35 / −5–15 |
| `lib/injection/event-view.js:49,67,170,451`、`lib/event-render.js:301,386`（LF） | 原事件/检查点投影、选择、候选、旧卡片正文各 1。EV 增可核对单位输出；旧卡片渲染留兼容，若需参数透传才动后者。 | EV +25–75 / −5–25；旧渲染 0 / 0 或 +5–18 / −1–5 |
| `lib/injection/final-frame.js:39,54,79,91`、`preview.js:44,148,176`（LF，同目录） | 段转换/合帧/cap/protect、预览入口/锁段/合帧各 1。确定双单位同源与锁定策略，freeze 后再收敛重复仲裁；不能直接把预览包装切到生产。 | FM +25–70 / −10–35；preview +15–40 / −25–70 |
| 候选新建 `lib/injection/unit-policy.js`（LF，路径当前不存在） | 仅在 U0/U1 纳入授权后建文件，唯一的带单位选择器；纯输入/回执，宿主上游准备事实、下游提交。无旧锚，新增前确认路径仍不存在。 | +180–350 / 0（内核，不含来源缺项） |
| `skins/iter5/policy-settings.js:76,185,786,801,864`（LF） | 响应归一、生效提示、兼容页、回滚、单键保存各 1。接线和回滚通过后才改变可编辑显示，保留现有生成器注册和三面挂载。 | +5–20 / −2–10 |
| `lib/client.js:25504,25815,26142`（CRLF）、`skins/legacy/iter5-325.js.frozen:875,1234,1625`（LF） | classic 定义唯一；`field` 和 `toggles` 在 client 有 2 个全文件命中，各在 `SettingsPage(props)` 作用域内 1。Frozen 三锚各 1。组件不复制；F5 两只读行保留，v4 和 Frozen 镜像由生成器产生。 | classic +10–30 / −3–18；Frozen +10–30 / −3–18；生成差量待实测 |
| `tests/smoke/smoke-test-delivery-settings-backend.mjs:121,138`、`smoke-test-delivery-cadence-contract.mjs:157`、`smoke-test-tiered-branches.mjs:207`、`smoke-test-delivery-policy-v2.mjs:53,64`（LF，同目录） | 事务/预览、r3、水位和 FSSS、表示与锁源判据各 1。保留旧分支真实执行，增加显式 policy/删除回退/失败未消耗；以新断言揭示差异。 | 四文件分别 +25–70、+15–40、+12–35、+15–45 / 0 |
| `tests/smoke/smoke-test-delivery-settings-ui.mjs:697,731`、`smoke-test-t1-prompt-sections.mjs:133,192`（LF，同目录） | F1/F5、旧段交互各 1。并列验证「连接时影子」「缺策略可写」「死键恒只读」。需要变更原判据时注明适用分支和裁定；不删原兼容负路径。 | 分别 +18–55、+12–35 / −0–6 |
| `tests/smoke/smoke-test-iter5-skin.mjs:686`（CRLF）、`smoke-test-r26-cross-layer.mjs:1054`（LF，同目录） | classic SHA-256 锁和后端 LF 长度锁各 1；如果批准的产物改变，按各套件实际报出的长度和哈希重钉，保留整值比较。 | 仅撞锁后各 +2–6 / −1–4 |

继续保持 `lib/index.js` 41 导出、22 工具 / 87 路由 / 182 公开键和客户端 14 factory 导出。`tools/build-iter5-skin.mjs:207` 取 classic 源段，P3-A 不需要改生成器；`lib/memory-envelope.js`、静态纪律、M6 路由、P1 诊断 provider 默认无写域。未来真正要加结构化语义/外部全文或改宿主观测的文件锚点，需先确认有权威来源和批准的边界，本表没有假定已存在等价 provider。

## 8. 验证与未验证

只读探针验证了公共 CA 契约 **11/0**、抽取生产分支 **26/0**（连续真人 FSSS）、水位关闭与小数兼容负路径、合法 slim 表示跨档拒绝、R1 账本样例、最终计量字节。生成器复验原文 `SYNC-OK: sources × generator == lib/client.js`，F5 UI 守卫 **21/0**，`verify-docs` 为 **22/87/182**；P2 逐套件与 README 行尾证据见修正回执。探针是模块/生产闭包夹具，不是上线验证。

**未验证**：P3-A 尚未施工，生产 Policy 模块、单位配额、transport 与删除回滚均未宣称已生效；生产/预览最终字节等价也未验证。真实 DSH 宿主重启、三设置入口 a11y 树及截图、真实会话注入和全量回归留给 Lead 的 P3-B。未改版本、未提交、未推送。
