# 批次3 P3-A 范围裁定（Lead · 2026-11-18）

性质：对 P2 修正回执（F5）与 P3-0 接线映射回执的验收与裁定。**批准 P3-A1 施工；P3-A2 暂不批准。**
本文件是 P3-A 的唯一范围依据。

## 0. 验收结论

| 项 | 结论 |
|---|---|
| P2 F5 | **关闭**。15 个有效旧键可编辑；两个死键只读静态行（值 + 当前无效标注），无输入/无写路径；UI 21/0，8 个变异全检出。**P2 通过。** |
| P2 回执 | 三元组与最终树一致（27,060 行 / 3,017,717 B / sha f9a3119c…；UI 20→21）。 |
| git diff --check | 默认 1,072 条为 CRLF 在 eol=lf 下的 CR 假红：git -c core.whitespace=cr-at-eol diff --check 退出 0，HEAD blob 本身 CRLF。接受，但回执须写明口径。 |
| P3-0 测绘 | **验收为测绘结论，不是写域授权。** 四档、11 生产者出口、2 锁段、旧键归属、候选锚点可用。 |
| 真实宿主 | 仍未验证，归 P3-B。 |

## 1. Lead 独立复核（本轮证据）

- 最终树：lib/client.js 27,060 行 / 3,017,717 B / sha256 f9a3119cb466fe1a… / 纯 CRLF（bareLF 0）/ 14 factory 导出；build-iter5-skin --check --strict = SYNC-OK。
- 计数：verify-docs 22 工具 / 87 路由 / 182 配置键；lib/index.js 导出 41；后端六文件 sha16 与 P1 一致。
- F5 负路径：UI 守卫真实挂载、取控件、调 onChange、断言只有一个 /config POST（15 键）；死键行断言无 input/select/button、无 set 写路径、读不写盘。
- **水位空数组缺陷已复现**：parseWaterThresholds([]) 返回 [25]（cadence.js:47-73 无空数组分支）⇒ policy 的「关闭」再走旧解析会重新打开 25%。
- **跨档表示缺陷已复现**：保存 human_slim 且 representation 为 preferred:summary / fallback:[pointer,omit] 后，resolvePolicy({tier:human_full}) 与 previewDelivery 抛 human_full allows only full or whole-unit omit（policy-v2.js:360-367 把差异并入目标档后再按目标档校验）。⇒ 一个合法设置会让另一档请求静默空帧/报错。
- **真人节奏冲突成立**：公共 CA 在 cadence.js:258-264 对任意真人轮授予 full；生产 index.js:24756 显式 _grantByHuman=false，抽取实跑连续四真人 FSSS。
- **账本 787 结论需补证**：我用 4 段长账本复现时，加权裁剪会把任务状态正文先裁空（type:state 消失），_finish 返回的是 3 段投影；短账本则返回投影。**结构上仍不应取「预算化原文」与「投递投影」的较短者**，但请给出 787 样例的精确 fixture 与真实闭包执行证据；若只在抽取缺依赖时出现，必须标注为探针假象而不是生产缺陷。

## 2. 边界裁定（对应 P3-0 的 C1–C10）

| # | 裁定 |
|---|---|
| R-A 真人节奏（C1） | **生产授予权威不变。** P3-A 不调用 CA 的真人 full 旁路，不把 isHuman 当作授予理由；_grantByHuman=false、FSSS 行为与 HEAD 逐字节一致。isHuman 只用于选择内容档（human_full / human_slim）与水位门。**R5 的 human_slim 最终可达性由 U3 帧配额方案负责，P3-A 不得宣称已解决。** 公共 CA 的 r3 旁路保持默认不动。 |
| R-B 水位（C2） | 保存策略存在时，生产**直接读 policy.triggers.waterPct 数组**；[] = 关闭，绝不回退成 25；[25]/[25,50]/自定义按数组生效。旧键回退仍走旧解析。修 parseWaterThresholds：显式空数组 [] → []（关闭）；undefined/null/空串/全非法 → 默认 [25]（旧文档口径不变）。**禁止把 policy 数组序列化成旧字符串再解析。** 另：合法旧值 25.5 目前令 legacyToPolicy 抛错，须无损兼容（放宽 policy waterPct 为 (0,100] 且 ≤2 位小数，与旧解析一致），加正向/负向用例。 |
| R-C 压缩/交接（C3） | P3-A **不接 policy.triggers.postCompact**：旧 snapshotReinjectOnCompact 只关提示、压缩后仍强制重建，语义不等价，保留旧行为；policy 字段维持预览参考并在 UI 标注未接。真实交接信号（!ws && globalLedgerPath）不得被当作跨会话证据，另案。 |
| R-D 旧配置回退（C4） | 无保存策略时**逐字节保持 HEAD 旧执行**：_isFullTier 名单、桶镜像、Tier-0、白板预算都不动。legacyToPolicy 派生的 transport 是**观察值**，A1 生产**忽略**它（不把旧 injectBudgetChars 硬解释成整帧硬顶）；只有磁盘上显式保存的 deliveryPolicy 才启用 policy.transport。 |
| R-E 锁段与硬顶（C5/C6） | 锁段资格沿用现行四档（human_full / post_compact / handoff_carry / legacy 分支），任何旧开关不得关闭锁段；policy hard 超限时锁段不得截断，整帧**显式失败**（本轮不注入 + degradation locked-content-does-not-fit），不得静默部分注入。soft 先记目标超额，超 allowance 后按允许的完整表示降级，再整单元省略。整帧计量边界 = 动态注入面最终交给宿主的文本（含标题、分隔、降级尾注）；静态纪律、M6、独立反思/通知回调不计入 A1。 |
| R-F 回滚（C7） | 回滚 = **从磁盘与内存物理删除 deliveryPolicy**，不是写 null。读侧把遗留 null 视为缺失（兼容）。旧键写入在 A1 仍被接受（旧客户端兼容），仅 UI 冻结；compatibility.legacyKeys 保持快照语义。 |
| R-G 四档与跨档（C8） | 修 resolvePolicy：跨内容档解析时，把 overrides 的差异并入目标档后，**逐字段校验并按目标档合法值回落**（尤其 representation；目标档不允许 summary/preview 时回落到目标档预设的 full/omit），不得因另一档的合法设置让本档请求报错或空帧。负路径：显式 human_full 预设 + summary 仍必须拒绝。四档预设默认值 A1 不改；run_slim.events.enabled=true 与生产提醒档不出卡不等价，A1 不接模块。 |
| R-H 13 段（C9） | 13 个 promptSectionToggles 维持**唯一可编辑权威**；P1 的 6 项模块映射不是等价开关。A1 不接模块 enabled，因此不存在两个开关同时生效的问题；A2 必须逐段定义「内容模块 / 运行提醒 / 独立行为」及优先级。 |
| R-I 账本（C10） | **选择权归结构段。** slim 档输出不得包含 type:state：先按 profile 选段，再对**已选内容**做加权预算；投影失败/结构不可解析时不得回落到「原文预算化」（那会带回未选段），改为显式 degradation（可空段），并记录原因。run_full 全部 fixture（含请补的 787 样例、超长/超短/畸形账本）都断言无 type:state。 |
| R-J 写域（§7） | P3-0 §7 的锚点表是**候选清单**，不是授权。A1 只批准 §3 列出的写域；§7 中模块/单位/事件/画像/语义/外部记忆相关锚点一律留给 A2。 |

## 3. P3-A1 批准范围（可立即开工）

目标：让**节奏、水位、总开关、整帧硬顶、账本三段、回滚删除**真实生效；模块选择/表示/配额仍为预览，不得宣称已生效。

**新建**：lib/injection/policy-runtime.js（LF、纯函数）：
- resolveRuntimePolicy(config) → { policy, source: saved|legacy|none }（saved = 磁盘有效 deliveryPolicy；legacy 派生仅供观察）。
- effectiveTriggers(config) → { fullGapRounds, slimEveryRounds, waterPct, tieredInject, hangCompensateEnabled, hangCompensateTokens }；saved 优先、legacy 回退、缺省 40/15/[25]；**waterPct 保持数组，[] 为关闭**。
- frameTransport(config) → saved 时才返回 hard/soft 规则，legacy 返回 null。
- measureFrame(text, transport) → { jsChars, utf8Bytes, ok, excess, violations }（UTF-16 code unit + UTF-8 字节；token 不计）。

**lib/index.js 薄接线（仅限以下点，其余不动）**：
1. 动态注入总闸：saved policy enabled=false ⇒ 不产生动态注入（静态纪律/M6/检索写入不受影响）。
2. 节奏读取：snapshotMinGapRounds、slimEveryRounds、fullInjectWaterPct、snapshotTieredInject、hangCompensateEnabled/Tokens 在有 saved policy 时改读 effectiveTriggers；无 saved policy 走旧键原路径。**不接 postCompact。**
3. 整帧 transport：saved policy 时在最终动态文本出口计量并执行 R-E；legacy 派生时直接跳过。
4. 账本 _finish：改为「选段 → 对选中内容预算」，slim 输出无 type:state；失败显式 degradation。
5. 保存/回滚：deliveryPolicy === null ⇒ 物理删除键（durable + 内存），读侧 null 视为缺失。

**lib/injection/policy-v2.js（LF）**：
- resolvePolicy 跨档回落（R-G）。
- legacyToPolicy 水位无损兼容（25.5 等），并明确 legacy transport 为观察值（可用 compatibility.source 判定；不改公开键）。

**lib/injection/cadence.js（LF）**：只改 parseWaterThresholds 的显式 [] 分支与（如需）小数接受度，不动 r3 真人旁路、不动 tier 判定。

**前端（经生成器）**：skins/iter5/policy-settings.js 的生效范围标注改为**分页**：预设与节奏/触发/诊断 = 已接入；模块/表示/配额 = 未接入（A2）；预算页 = 「整帧硬顶已接入、模块级预算未接」。不得再显示全局「全部未接入」。

**测试（新增 + 修订）**：smoke-test-delivery-policy-runtime.mjs（真 import/真调用 + 负路径 + 变异）：触发器优先与回退、water [] 关闭不得重开 25、25.5 无损、hard 超限显式失败、soft allowance、锁段不可截断、legacy 派生 transport 被忽略、rollback 物理删除、跨档回落与负面拒绝、生产抽取 FSSS 不变、ledger 全 fixture 无 type:state。

## 4. P3-A2（本轮不批准）

- U0/U1：lib/injection/unit-policy.js 契约与选择器内核；U2：EV/RP/BD/portrait/calendar/rules 的结构化单位 adapter；U3：模块 enabled/view/representation/quotas 生产接线。
- 需先出 U0 契约评审与 U1 用例，再单独任务书；不得在 A1 里夹带模块接线。

## 5. A1 验收（Lead 自己复跑，不采信自报）

1. build-iter5-skin --check --strict = SYNC-OK；22/87/182/41/14 不变；除批准的 policy-v2/cadence 外，P1 模块指纹不变。
2. 触发器：saved 覆盖 legacy；无 saved 时抽取生产分支与 HEAD 逐字节同行为；4 连续真人仍 FSSS；water [] 关闭后不出现 25 触发；25.5 从旧值派生不抛错。
3. 硬顶：构造超限帧 ⇒ 零注入 + 明确 degradation；锁段超限 ⇒ 显式失败；soft 超 allowance ⇒ 降级/失败可观测；legacy 派生 transport 不生效。
4. 账本：run_full/run_slim 全 fixture 无 type:state；787 样例（请附 fixture）通过。
5. 回滚：保存 null 后磁盘 JSON 无 deliveryPolicy 键、GET 返回 legacy 派生；前端回滚可见。
6. 跨档：saved human_slim(summary) 下 human_full 预览/解析成功且表示回落目标档合法值；显式 human_full+summary 仍拒绝。
7. 每条关键判据带负路径与至少一条变异（必红 → 还原复绿）；未验证项单列。
8. 不 commit/push/改版本；真实宿主留给 P3-B。

## 6. 已知不在 A1 的项（须在 UI/文档明示，不得隐含）

- 模块开/关、模块表示、单位配额、语义/外部/事件结构化来源：**仍未接入真实注入**，仅预览。
- postCompact、injectExcludeSources 映射、13 段与模块的优先级：A2。
- human_slim 的最终可达性证明（R5）：U3。
- 真实宿主 a11y/截图/真实会话注入：P3-B。
