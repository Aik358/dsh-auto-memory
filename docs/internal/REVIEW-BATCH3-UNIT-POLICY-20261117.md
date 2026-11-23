# 批次3「自然内容单位投递」思路复核

日期：2026-11-17。复核对象：仓外参考交付 `C:/Users/JH Z/.codex/artifacts/batch3-semantic-unit-policy-20261117/`（方案 370 行 / 引擎 258 行 / 适配器 9,514B / 测试两份）。
性质：Lead 独立复核。不采信自报数字；三条缺口逐行回到仓库源码核对，参考测试由 Lead 本地复跑。

## 0. 结论

1. **思路成立，而且是当前 B3 真正缺的脊椎**：现有系统的预算是「字符标量」，选择发生在渲染内部、裁剪发生在渲染之后，最终计量只看段长 —— 于是「选中 3 个检查点」与「完整投递 3 个检查点」之间没有可审计的桥。把「选什么/几个（语义配额）→ 以什么形态投（表示）→ 最终装不装得下（传输）」拆成三层，是对症的。
2. **但它是 L1 契约 v2，不是 A/B 批内的实现细节**。ContentSpec 的 budgetPolicy、ProjectionCandidate 的字段、FM 的最终计量、回执协议都要改；14 段与候选契约是 L1 §4.4/§5.1 明文冻结的公共面，L1 自身写明「扩展段须先登记，不得静默新增公共面」。所以必须先冻结契约 v2，再写代码，不能把它塞进正在施工的 A/B 批。
3. **它只根治「预算/计量」这一根**，不根治「选谁」（当前事件优先于更新但无关事件、相关性）与「来源是否完整」（SR/RC 读取面）。把它当成 B3 全部根因会误判；把它当成预算层的正确根因是准确的。

一句话裁定：**采纳其内核与三层契约，按下面 P0/P1 修正后升 L1 v2；不作为补丁塞进现有批次。**

## 1. 三条缺口逐行复核

| 缺口 | GPT 声明 | 实测证据 | 结论 |
|---|---|---|---|
| 1. 选中 N ≠ 完整投 N | `event-render.js:301` | `buildCheckpointsBlockPre`：`maxCheckpoints` 只决定 `slice(-n)`（L302-303）；随后每条 `cutPre(rawText, CHECKPOINT_ITEM=300)`（L333）；块级 `CHECKPOINTS=1800` 超限时丢整条或 `forcedOne` 把最新一条再裁到剩余 room（L335-343）。外层 `renderT2Pre` 整卡再有 2400 上限。 | **成立**：三个「选中」的检查点，最终可能是 300 字残条。 |
| 2. FM 看不到检查点身份 | `event-view.js:464` | `buildEventCandidatesPre`：`capChars = min(传入, 300)`（L469-470）→ `renderLatestCheckpointPreviewsPre` → 用 preview 文本覆盖四段（L477-480）→ `renderT2Pre` 成整卡 → `makeEventCandidatePre(..., text, ...)`（L485）。到 FM 时只剩 `text`。 | **成立**：候选边界 = 字符串，检查点成员清单在到达 FM 前已丢失。 |
| 3. DTO 无单位/表示完整性 | `dto.js:259` | `makeProjectionCandidate` 字段仅 id/kind/bucket/priority/text/sourceIdentity/contentVersion（L260-271）；`freezeBudget` 单位仅 `['js-chars','utf8-bytes']`（L292-298）；`final-frame.js:160-168` `tokens: null`。 | **成立**：没有 unitType/moduleId/eventId/checkpointId/依赖/coverage。 |
| 4. 无 ID 检查点身份塌缩（GPT 写在方案 §2 但未列成独立缺口） | `event-view.js:144-152` | `sourceIdentity: id ? 'cp:'+id : 'cp:unknown'`；而 `event-store.js:1016-1031` 的普通检查点只有 `idemKey`，无 `id`，R4 分支才产生 checkpointId。 | **成立且更严重**：真实存量里多数普通检查点会变成 `cp:unknown`，单位计量在真实数据上直接失去身份。必须按方案 §5 的「idemKey → 快照身份（revision+index+digest）」三级兜底。 |

参考测试 Lead 独立复跑：`node --test semantic-unit-engine.test.mjs event-unit-adapter.test.mjs` ⇒ **tests 32 / pass 32 / fail 0**（257.889ms）。数字与 GPT 自报一致。

## 2. 思路对在哪

- **三层分离的失效模式互不重叠**：配额超了=少选；表示不允许=省略；传输超了=整单元换表示或整单元省略。这三件事在现有系统里全部塌缩成「末尾切字符」，这正是「截成半条仍宣称完整」的根。
- **自然单位表与真实来源对得上**（Lead 抽查）：rules 子条 `parentId#n`（rules-layer.js:354-361）、tier0 `memId`（tier0-catalog.js:186）、calendar `cal_ID`、notification id+version（notification.js:69,125）、event-store `checkpointId/idemKey` —— 都不是凭空发明的单位。
- **三分账口径正确**：实体数（checkpointIdentities）/ 正文数（checkpoints）/ 指针数（references）分开计，指针不得冒充正文。回执从最终 retained IDs 重算，而不是从选择阶段累计（引擎 L235-253）。
- **纪律与本仓一致**：未知字段/单位/模式一律拒绝而非静默忽略；required 不静默降级；`globalFeasibility:'unknown'` 诚实声明「本贪心没找到」而不是宣称全局无解；输入深冻结、重复调用同输出。这些符合 CR-10 与不假绿纪律。

## 3. 必须修正的点

### P0-1 传输层在生产不能「可选」

参考 API 允许 `transport` 为空（「可以只按数量选择，不设额外字数配额」）。作为**引擎能力**可以；作为**生产默认**不行：

- L1 现契约 `budgetPolicy.cap` 允许 null=未定，且 `final-frame.js:171-175` 把 `50K / segmentLevel / frameLevel / compression / fullExit` 全部登记为「未定案，不得擅自定值」⇒ 生产当前**没有**已批准的整帧硬限。
- 若 v2 允许「不设传输上限」成为正常路径，结果就是「按数量选满 ⇒ 文本无界」，与整条注入瘦身线相悖；宿主/模型上下文边界只能靠失败发现。
- 正确表述：**字数不做分配货币，但必须做最终可行性闸门**。机制上 transport 必须存在；生产默认值未批准 ⇒ 只能以 `unresolved / observe-only` 显式标记使用，不得静默当成「无限制可用」。

### P0-2 human_full 不能被表示降级吞掉

`representation.fallback: ["summary","pointer","omit"]` 在 human_full 下会静默降级 —— 与上一轮 `REVIEW-BATCH3-HUMAN-TIER` 的 P0 同类错误。必须定 mode→representation 映射：

| 模式 | 允许表示 | 不允许 |
|---|---|---|
| human_full | `full` 或 `omit`（整单元/整包省略并进 omitted） | summary / preview / pointer 冒充正文 |
| human_slim / run_full | full / summary / preview / pointer | 把指针报成正文 |
| run_slim / legacy | full / summary / pointer | 全文冒充（无全文时给指针） |

### P0-3 「preview ≠ summary」缺一档

引擎只有 `full / preview / pointer` 三档，方案 §5 DTO 写的是 `full / summary / pointer`，用户回执要 `checkpointSummary`。三处不一致。必须四档：

| 表示 | 含义 | complete |
|---|---|---|
| full | 来源快照中的完整字段 | true |
| summary | 受信适配器提供的**语义摘要**（可读、有信息量） | false，但语义完整 |
| preview | head-tail 截断预览（明确标注） | false，且必须标 truncated |
| pointer | 来源位置 | false，只算 references |

否则回执无法区分「给了摘要」与「切了一半」。

### P0-4 整包原子性未实现

引擎明确不支持 `all-or-none bundle`。rules 模块、portrait 分类、plan 节、notification payload 都可能是整包语义。落地路径第 4 步无法用参考引擎收口。需要把 bundle 建模为「成员依赖闭包 + 组计数」的显式能力（不要求通用求解器）。

### P1-1 选择权归属未定 = 最大剩余风险

引擎只按调用方给的 `priority` 排序。方案 §7 写的 `explicit-id → current-event → relevance → recent` **没有在代码里**。若 EV 仍用 `updatedAt` 当 priority，单位化只改了账、没改选。必须明确：**selector 顺序策略归 PJ/SEL；EV 只提供事实与候选，不冒充相关性分数**。

### P1-2 回执必须绑定 sourceRevision / coverage

引擎 `retained` 不带 digest；identityReport 旁挂且引擎未核验。没有它无法证明「投的是哪个版本的哪条检查点」。v2 回执的每个 retained 单元必须带 `sourceScope + revision + contentDigest + coverage`。

### P1-3 参考引擎是 O(n²) 热路径

`attempt()` 每次候选都全量 `render + quotaReports`。26 检查点 + 多模块的真实帧会到几十 ms 级；每帧注入都要跑。生产实现需增量记账或「先预估后提交」。

### P1-4 跨模块事件限制的语义要定清

参考实现禁止 `CROSS_MODULE_EVENT`。生产里同一事件可能被 events 模块与其他段同时引用。规则应为：**同一自然事件只在一个 deliveryModule 内投正文；目录/指针可跨模块但不计正文**，否则要么误拒合法内容，要么虚增 event 计数。

### P2 级

- 回执缺 `eligible`（候选总数），无法回答「为什么只选了 2 个」。
- legacy 适配必须 `legacyOpaque` + 只报 blob，不反解析猜单位（方案已写，需进契约硬条）。

## 4. 嫁接点：14 段就是现成的模块注册表

关键发现：**不需要从零建 registry**。L1 §4.4（L126-142）列出的 14 段，就是 `CONTENT_SPEC_SEGMENTS`；`CONTENT_SPEC_TO_PROMPT_SECTION` 映射已存在（projection.js:200-205 在用）。只需给每段挂 `unitTypes / enumerate / render / verifyCoverage`。

| deliveryModule | 现成来源 | 自然单位 | 现状 |
|---|---|---|---|
| rules | rules-layer 子条 parentId#n | rule / ruleModule(bundle) | RP 先合成 text |
| plan / handoff | plan-render / project-handoff | planSection / ledgerSection | BD 已按节解析，输出 text |
| events | event-store + event-view | event / checkpoint / catalogEntry | EV 合成 T2 文本 |
| portrait | user-portrait 分类配额 | portraitItem | PJ 聚合成一个 candidate（projection.js:244-247） |
| calendar | 10 条选择 | calendarEntry(cal_ID) | 无结构 |
| semantic | tier-layer-inject maxItems/maxBlocks | retrievalHit / evidenceBlock | 服务未就绪 |
| tier0 | tier0-catalog memId | catalogEntry / memoryRecord | 需 adapter |
| logs / reflection / diagnostic / maintenance | 旧渲染器 | documentSection / legacyOpaque | 显式 legacy |
| notification | NT id+version | notification | 已具备 |

## 5. 流水线修正

方案 §6 的 mermaid 让 PJ 出现两次（解析策略 + 再选择），会与已冻结的 PJ 定位（U4：ContentSpec/候选投影）冲突。改为：

```text
CA（何时投）
→ PJ.resolvePolicy（一次，输出不可变 resolvedPolicy）
→ SR/RC（按需读源）
→ 各模块 enumerate（输出带身份的 units）
→ B3-SU select（新增单元：唯一选择器）
→ 各模块 renderRepresentation（按选中表示渲染）
→ B3-FM finalize（最终装帧 + 多维复核 + 回执）
→ NT / commit
```

新增 **B3-SU**，不并入 PJ；FM 从「按段丢弃」升级为「按单元最终裁决」。这样现有 11 个模块的边界不被推翻，只是多一层。

## 6. 施工顺序重排

当前状态：A 批 r3 六补丁已落盘未提交（CA 真人旁路），17 项测试提案暂缓，B 批挂起。unit policy 改 L1，顺序必须改为：

| 阶段 | 内容 | 出口 |
|---|---|---|
| U0 契约 v2（先冻结，不写代码） | L1 §4.4/§5.1 加 DeliveryUnit、typed quota、四档表示、coverage、receipt、mode→表示映射、bundle；L2 加 B3-SU/U9；L3 测绘更新 | 契约评审通过 |
| U1 引擎内核生产化 | reference engine 落成 `lib/injection/unit-policy.js`（纯函数 select+finalize）；补 bundle、四档、eligible、sourceRevision、增量记账 | reference 20 项 + P0/P1 新增用例全绿 |
| U2 枚举器（双路径） | EV/RP/BD/portrait/calendar/rules 各出 adapter，输出 units 同时保留现有 text；旧套件保持绿 | 每 adapter 真 import→真调用 |
| U3 接线 | PJ 出 resolvedPolicy，SU 选择，模块渲染，FM finalize，lib/index.js 唯一入口薄接线 | 隔离行为验收 |
| U4 验收 | 四档×单位×表示×硬度矩阵 + 旧套件 + 隔离 HOST + 真实 HOST | 真实会话证据 |

A 批仍有效的条目：F08 identity-first、F13 finalize 检查最终文本、F14 硬限不可满足须显式失败、F19 `cap < head.length` 旁路 —— 这四条在 U1 的「无 slice + 整单元降级 + 显式失败」里被自然吸收，不必再单独打补丁。CA 真人旁路与 `isHuman` 输出仍是 U3 前置。

## 7. 验收判据增补（在 32 项之外）

1. **无 mid-unit slice**：任何输出路径禁止对 full 表示做字符裁剪；传输超限只能整单元换表示或整单元省略，并列出 omittedUnitIds。
2. **human_full 负路径**：human_full 下，回执的正文计数里不允许出现 summary/preview/pointer 的检查点。
3. **四档表示分账**：同一 unitId 的 full/summary/preview/pointer 分别计数，且互不冒充。
4. **传输闸门**：给定 cap，最终文本长度（含标题/分隔/省略说明）≤ cap，retained 计数与文本一致；不允许「先选后裁」。
5. **计数交集**：模块 4 / 事件 2 / 每事件 3 / 全帧软目标 5 允许超额 1 ⇒ 实际 ≤6，四个约束同时报告 actual/max/satisfied。
6. **身份三级**：普通 idemKey、R4 checkpointId、无 ID 快照身份都能产出稳定 unitId；跨快照不误当永久 ID；`cp:unknown` 不得出现。
7. **确定性/幂等**：同请求重复调用 byte-equal；preview 不消费状态；被裁通知不 commit。
8. **legacy 诚实**：旧聚合文本 `legacyOpaque` + blob 计数，不反解析。
9. **单一策略源**：只有一个 policyVersion；不新增 DEFAULT_CONFIG 顶层键绕过 181 键锁。

## 8. 与 human_full / human_slim 的衔接

上一轮悬置的 P0-2 在这里变成策略层问题：

- CA 必须输出 `isHuman`（P0-1，未收口）；PJ mode resolver 用 isHuman × isFull 生成生产八档 → resolvedPolicy。
- `human_full` 的表示策略 = 只允许 full|omit；`human_slim` = full|summary|pointer。
- 于是 `human_slim` 是否可达由 **策略** 决定，不再依赖 CA 里「真人旁路优先于 fullGap」的分支顺序。这同时解决了「真人永远 full 导致 human_slim 死路」的结构性矛盾：真人可以进入 human_slim，当且仅当帧配额/传输闸门判定为 slim，且此时允许摘要/指针。

需要用户确认的语义只有一句：**真人档是否允许在整帧放不下时降为 slim（给出摘要/指针），还是必须整单元省略以保住 full？** 建议前者（与生产四象限一致）；后者会把 human_slim 变成 full 的失败态。

## 9. 不采纳 / 暂缓

- 不引入通用求解器/回溯；先可解释贪心 + 显式 shortfall，但必须报告 search-limit，不能把「贪心没找到」写成全局无解。
- 不在 Policy v2 写任何生产默认数字（模块 4 / 事件 2 / 检查点 3 只是样例）。
- 不启 token 硬政策（无 tokenizer，`tokens:null` 必须拒绝 token 硬约束）。
- 不直接把参考引擎搬进 lib/：它缺 bundle、四档表示、coverage、eligible、增量记账，且 API 字段名（metric/scope/enforcement）与 L1 契约（unit/scope/strength）不一致，需统一后再落。

## 10. 若批准，给 GPT 的下一轮边界

只做 **U0 契约草案 + U1 内核补全**，不碰生产接线：

1. 输出 L1 §4.4/§5.1 的 v2 增补草案（diff 形式，标明新增/修改/不动）。
2. 在参考引擎上补四档表示、bundle、eligible、sourceRevision、增量记账，并给出新增用例清单。
3. 明确 mode→representation 映射表与 human_full 负路径用例。
4. 不写任何生产默认数字，不改仓库源码。

U2/U3 等 U0 冻结后另派。
