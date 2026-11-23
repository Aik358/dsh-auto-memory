# Codex 任务书 · 批次3 收尾三件：B3-EV 接线 → B3-CO 接线 → U3b on 接管

日期：2026-11-22 ｜ 执行者：外部代码线（GPT/Codex）｜ 验收者：Lead 独立复核（不采信自报）
基线提交：`decdeccf`（HEAD，全量 646 PASS / 0 FAIL / 1 TIMEOUT(负载) / 1 FLAKY）

---

## 0. 分两批交付（不是一批，也不是三批）

三件都在 `lib/index.js` 有接线点 ⇒ **同文件必须串行**，不许并行改。

| 批次 | 内容 | 提交方式 | 验收方式 |
|---|---|---|---|
| **批次 A**（本轮交付） | 件一 B3-EV 接线 → 件二 B3-CO 接线 | **2 个独立 commit** | **合并验收**：件一 6 条 + 件二 5 条 + A 批共同出口（§6） |
| **批次 B**（A 通过后另起） | 件三 U3b on 接管 | 1 个独立 commit | 单独验收 + 真实宿主逐轮对比 |

**为什么这么切（三条硬理由）**：

1. **U3b 的 `off` 逐字节等价判据必须有唯一基线。** 若 EV/CO 与 U3b 同批落地，「改动前」指哪个版本就说不清——要么对两版各留一份 digest、要么放弃这条最关键的判据。**这是决定性理由。**
2. **U3b 要真实宿主逐轮对比**（隔离 `DSH_HOME` + 独立 profile + 空闲端口，慢且贵）。与 EV/CO 混批时，宿主上看到的偏差无法归因到「provider 换了」还是「组装换了」。
3. **EV/CO 是「提供内容」，不改变最终帧的组装规则**；U3b 是「改变组装规则」。前者可合并验证，后者必须单独隔离。

**为什么不是三批**：EV 与 CO 的消费面完全不相交（一个管事件段表示，一个管 consolidate 写侧提炼），验收判据不重叠，合并交付不产生归因歧义；拆成三批每批都要重跑 r26 + verify-docs + 定向集，多一轮开销却换不到任何隔离收益。

顺序按依赖：

1. **B3-EV 先接**：它产出「按单位表示的事件内容」（四段 / 检查点 / 目录 / 来源指针）。U3b 的组装要消费它，EV 不先落地，U3b 就只能继续消费旧的 `event-render.js` 文本。
2. **B3-CO 后接**：consolidate 是独立消费者（写侧提炼），与投递组装不共享状态，但同文件 ⇒ 排在 EV 之后、U3b 之前。
3. **U3b 最后接**（批次 B）：唯一会改变真实注入帧的一步，必须建立在 EV 已提供单位化内容之上，且必须带 `off` 回滚。

---

## 1. 全局硬约束（违反即返工）

1. **模块化/API 化**：不得把业务逻辑堆进 `lib/index.js`。组装/选择/表示的可复用逻辑放 `lib/injection/*` 或新独立模块，`index.js` 只做薄接线。判据：单函数新增超 ~40 行必须抽出去。
2. **不新增顶层配置键**（保持 182）。U3b 的开关挂在已存在的 `deliveryPolicy` 对象内做**嵌套字段**（如 `deliveryPolicy.unitPolicyMode`），因为 `verify-docs` 只数 DEFAULT_CONFIG 顶层键；**不要**新增 `unitPolicyMode` 顶层键。
3. **不新增 HTTP 路由**（保持 87）、**不改工具数**（22）。
4. **不跑生成器、不碰 `skins/`、不改 `lib/client.js`**。本批是后端接线；前端展示不变。
5. **`off` 必须逐字节等价**：`unitPolicyMode !== "on"` 时，最终注入帧与改动前**逐字节相同**（用 digest 证明，不是口头保证）。
6. 每件都必须：真调用 + 负路径 + 隔离变异（红→还原→绿）。不许用「源码含某字符串」当功能证据。
7. 边界**已全部裁定**（见 §5 的 D30B-1…12）：按裁定实现，**不许自行扩大**；每个受裁定影响的落点必须按 §9 加留痕注释（`DECISION D30B-<n> | 2026-11-22 | user ruling`）。

---

## 2. 件一 · B3-EV 生产接线（新事件视图替换旧渲染）

### 2.0 迁移边界裁定（2026-11-22 Lead · 事故回执后追加）

**停手是正确的**：执行者实测发现新模块缺少旧 `T1` 一行摘要的等价接口；直接替换会丢掉「精简投递 `[当前事件]`」与「`[最近事件]`（≤3 条）」里的摘要内容。生产代码未改、CO 未接线，符合 §8。

**裁定：选 B —— 先补齐等价 T1 API，再一起迁移。** 不做「保留旧 T1、只迁卡片与目录」的部分迁移。

**理由（三条，均可复核）**：

1. **等价是机械可证的，不是产品决策。** 旧实现只有三行（`lib/event-render.js:139`）：取 `ev.summary` → 折叠换行与首尾空白 → `firstSentencePre(..., RENDER_LIMITS.T1)`；首句为空则 `cutPre(ev.name, RENDER_LIMITS.T1)` 兜底。`T1 = 140`（`:23`），`firstSentencePre` **已导出**（`:104`）。不需要新语义，只需把同一组原语搬进新模块。
2. **部分迁移会留下两套渲染栈**：卡片/目录走新模块、T1 仍走旧模块，U3b 接管时得同时养两条路径 —— 正是本批要清掉的债。
3. **同帧不一致风险**：卡片与 T1 行都源自 `ev.summary`；若新模块用自己的归一化，同一帧里 T1 行与卡片摘要可能不一致，用户能直接看到。

**等价定义（实现者不得重新设计）**：语义 = 「summary 去掉换行、折叠空白后取首句，限长 140；首句为空则用 name 截断到 140 兜底」，与旧 `renderT1Pre` **逐字节相同**。判据以 **A7 差分对比** 为准（同夹具集并行跑两实现、逐例字符串完全相等），不许用文字描述替代差分证明。

**实施约束**：

- 新增 API 放 `lib/injection/event-view.js`（如 `renderEventOneLineSummaryPre`），**必须复用** `firstSentencePre` 与 `RENDER_LIMITS.T1`；`cutPre` 现为模块私有（`event-render.js:80` 无 `export`），需**加导出**（纯增量、不改行为）并在回执说明。
- 覆盖三个生产调用点：`index.js:10453`（`slimEventT1` 预计算）、`index.js:10988`（另一档位直接调用）、`index.js:12551`（`[最近事件] ≤3 条`）。三处都改，不许只改一处。
- 全过程受同一个 `useEventView` 开关约束：`false` ⇒ 全部走旧实现，**不许出现「一半新一半旧」的运行时状态**。
- **做不到逐字节等价就停手回报**，不许用「近似」或「语义等价」替代。

**现状事实**（施工前先自行复核）：`lib/index.js` 只 import `./event-render.js`（`renderEventCatalogPre` / `pickT2EventsPre` / `renderT2Pre` / `renderT1Pre`）；`lib/injection/event-view.js` 已有模块实现（`projectEventSectionsPre` / `projectCheckpointSectionsPre` 等），**生产零调用**。

**要做的**：

1. Phase 0 测绘：列出 `event-render.js` 当前每条生产调用点（函数名 + 真实行号 + 产出文本用于哪些段），并列出 `event-view.js` 的导出面能否一对一覆盖；**不能覆盖的点必须列出来**，不要猜。
2. 接线：让生产事件段改为消费 `event-view.js` 的投影结果（四段 goal/doing/deadend/next；检查点 goal/state/dead/next），保留旧函数的**回滚路径**（如 `if (!useEventView) return 旧实现(...)`）。
3. 3.2 四段消费侧：失败/卡点（`deadend` / `dead`）必须真的进入最终投递帧；字段为空不输出该段。
4. 3.3 检查点截断：**保首尾**（或按内容动态分配），段级预算 ≤ 现有上限，且与整帧预算同时满足。构造 1400 字检查点 → 开头与结尾特征均可达。
5. 3.4 事件可见性：固定 10 个 active 事件夹具 → 保留「含 5 个以上」的展开目标，同时验证 id 与正文都在。

**验收（每条要贴实测输出）**：

- A1 真调用：构造含 deadend 的四段事件 → 最终帧含失败原因正文（真渲染出的字符串，不是源码断言）。
- A2 负路径：`deadend` 为空 → 帧内不出现该段标题/占位。
- A3 检查点保首尾：1400 字检查点 → 断言首 20 字与尾 20 字都出现在帧内。
- A4 10 active 夹具 → 帧内事件数 ≥5，且 id 全部可检索到。
- A5 隔离变异 ≥3：删「保首尾」的第二段保留、把 `deadend` 从映射表移除、把事件数上限调成 1 —— 三条都必须变红。
- A6 回滚：`useEventView=false`（或等效开关）⇒ 帧逐字节等于改动前 digest。
- **A7 T1 差分等价（新增，硬判据）**：同一夹具集并行跑旧 `renderT1Pre` 与新 `renderEventOneLineSummaryPre`，**逐例字符串完全相等**；夹具覆盖 ① 常规 summary（含既有复现用例 `T1-SUMMARY-10.`）② summary 空 ⇒ name 兜底 ③ summary 纯空白/多行 ⇒ 归一化后仍相等 ④ summary 超 140 ⇒ 截断与省略号一致 ⑤ name 也空 ⇒ 两边都是空串。任一例不等即失败。
- **A8 T1 变异（新增）**：新 API 限长从 `RENDER_LIMITS.T1`(140) 改成 120 ⇒ A7 必须变红；删掉 name 兜底 ⇒ 第②类夹具必须变红。
- **A9 三调用点覆盖（新增）**：`grep -n "renderEventOneLineSummaryPre" lib/` 必须命中 `index.js` 三处（10453 / 10988 / 12551 附近），少一处即失败。

---

## 3. 件二 · B3-CO 生产接线（consolidate 五源）

**现状事实**：`lib/index.js` 全文**没有** import `./injection/consolidation.js`；生产 `memory_consolidate` 仍以每日日志为主要提炼输入。

**要做的**：

1. Phase 0 测绘：定位生产 consolidate 的真实入口（读哪个目录、拼什么 prompt、days 过滤在哪）、`consolidation.js` 的导出面与它要求的输入形状；记录两者差在哪。
2. 接线：生产 consolidate 的 prompt 组装改为经 `consolidation.js` 的五源读取（日志 / 事件库 / 白板 / 账本 / 反思），保持 `days` 语义与「独立(无)/未知状态不写」的既有规则。
3. 保留旧路径作为回滚（默认走新路径，但 `off` 时逐字节等价）。

**验收**：

- B1 真调用：造 1 条事件 + 1 份白板 + 1 份账本 + 1 篇反思 → 组装出的 consolidate prompt **包含**这四类内容（断言具体片段，不是「非空」）。
- B2 可复算量：给出改动前后「喂入 consolidate 的字符数」实测对比（旧 x → 新 y），不是估算。
- B3 负路径：五源全空 → 显式空态/明确失败，不得抛未捕获异常、不得伪造内容。
- B4 隔离变异 ≥2：把事件源从五源里删掉、把 days 过滤边界改错 —— 都必须变红。
- B5 回滚：旧路径开关下，prompt 逐字节等于改动前。

---

## 4. 件三 · U3b：on 接管（唯一改真实注入帧的一步）

**目标**：让设置页里的「模块开关 / 视图 / 表示 / 单位配额」真正决定实际投递正文，而不是只影响预览。

**要做的**：

1. **开关（统一，D30B-14）**：新增嵌套字段 `deliveryPolicy.deliveryMode`，三态 `legacy | eventView | units`，**缺省 = `eventView`**（= 批次 A 之后的现状，零行为变化）。
   - `legacy`：卡片/目录/T1 走旧 `event-render.js`，组装走旧字符预算（= `decdeccf` 之前的行为）。
   - `eventView`：卡片/目录/T1 走新 `event-view.js`，组装仍走旧字符预算（= 当前 HEAD，批次 A 行为）。
   - `units`：新事件投影 + **按单位组装**（U3b 目标行为）。
   - 这是**唯一**开关：`lib/index.js:10422` 的 `const useEventView = true` 必须改为从该策略派生（`deliveryMode !== 'legacy'`），不允许同时存在「编译期常量 + 运行期键」两套 off 语义。
   - 必改 `lib/injection/policy-v2.js` 的严格白名单与枚举校验（`validatePolicy` 对未知字段抛 `DeliveryPolicyError`）；**不改** `resolvePolicy()`（它是逐帧 tier 解析，不是配置策略）。配置保存路径见 `lib/index.js:4425`（保存时已 `validatePolicy`），加载入口 `lib/injection/policy-runtime.js:10`。
   - 非法值：保存时**拒绝**；已存储的非法值在加载时回落 `eventView` 并留 degradation 记录，不得抛未捕获异常。
   - **不加顶层配置键**（`deliveryPolicy` 已存在，顶层计数仍 182）。
2. `on` 时装配改为**按单位**：用 `unit-policy.js`（选择器）+ `unit-adapters.js`（六源 adapter）+ `bindUnits` 产出 `Unit` 列表，按 policy 的 view/representation/quota 决定每段内容；生成的 `deliveryModule` 进入最终帧。
3. `deliveryModule` 实产：三个模块的指针单位（规则维护块、白板后段、账本后段）必须真的以 pointer 形态出现，而不是被整段塞入。
4. 预算：沿用 A2 裁定 —— `budget` 是**整帧总额**，锁段（S8）优先，非锁段成本 ≤ `budget − lockedCost`；超限时按既定顺序降级（`budgetOvercommit` 分支，且**先判 `enabled`**，即 D1 的修复不得回退）。
5. 事件家族配额：`scope:"event"` 是家族桶，`checkpoint` / `catalogEntry` 必须共用同一配额（A6/F13 的 `quotaMatchesForUnitKind`，不得回退成精确 unitKind 匹配）。
6. 回滚：`off` ⇒ 逐字节等价（见 §1.5）。

**验收（本件最严，Lead 会逐条复跑）**：

- **C0 三态开关（新增，硬判据）**：`legacy` 帧 digest == `decdeccf` 树上的基线；`eventView` 帧 digest == 批次 A HEAD（`c6c32c21`）基线（3 组场景：空库/常规/满额）；`units` 帧 digest != `eventView`（否则说明没生效）。三份 digest 对照表逐行给出。
- C1 **eventView 等价**（原 off 等价的改名）：`deliveryMode=eventView` 时，3 组场景的帧 digest **逐字节等于批次 A 基线**；这个基线在**本批动第一行代码之前**先取，写进回执。
- **C0b 非法值（新增）**：保存 `deliveryMode="bogus"` ⇒ 被 `validatePolicy` 拒绝；手工写盘非法值后加载 ⇒ 回落 `eventView` 且回执/debugInfo 可见 degradation，不崩。
- C2 **on 真生效**：把某模块 `checkpoint` 配额从 3 改成 1，最终帧内该模块检查点数真的从 3 变 1；再改成 5 ⇒ 变 5。**这是本批的核心证据**，不许用预览回执代替。
- C3 **模块关闭**：`enabled:false` 的模块内容在 `on` 帧中**零出现**；且 overcommit 场景下不得泄漏（D1 回归）。
- C4 **视图生效**：`full` vs `pointer` 两种视图下同一单元产出不同形态（完整正文 vs 指针），断言两者字节数差异 + 指针形态含可回读路径。
- C5 **配额家族**：`scope:"event"` 配额为 2 时，1 个 event + 1 个 checkpoint + 1 个 catalogEntry ⇒ 只投 2 个（不是 3 个），且不出现 `@unbounded` 绕过。
- C6 **预算超限**：构造超预算场景 ⇒ 非锁段被降级/省略，锁段完整，回执含 `budgetOvercommit`。
- C7 **隔离变异 ≥4**：①配额比较改回精确 unitKind（D2 回归必须红）②overcommit 分支去掉 enabled 判断（D1 必须红）③`off` 分支被绕过（C1 必须红）④pointer 生成退化为全文（C4 必须红）。
- C8 **真实宿主逐轮对比（必做）**：隔离 `DSH_HOME` + 独立 profile + 空闲端口；在设置页把策略改为 `on` 并保存 → 下一轮真实模型消息中可见按单位组装的正文；把模块配额改小 → 下一轮检查点数变化；切回 `off` → 帧回到改动前形态。给出宿主日志与截图/文本证据。

---

## 5. 已裁定边界（D30B-1…12 · 2026-11-22 用户裁定）

权威文件：`docs/internal/DECISIONS-BATCH3-30B-BOUNDARIES-20261122.md`（时间戳 2026-11-22 15:50 Asia/Hong_Kong）。3.0-B 四项边界**已全部定案**，不再有「未定」状态。你按上表实现即可；**不得**把任何一项当未定而保留 `unresolved` 或自行扩大口径。

| 边界 | 已定裁定（含编号） | 与本批接线的关系 |
|---|---|---|
| ① 预算范围与豁免 | **D30B-1** full/压缩重建**不豁免**整帧预算；**D30B-2** 静态纪律**并入**、M6 唤回尾 4096B **独立**；**D30B-3** must 段保留 + 回执标 `budgetOvercommit`（只挤非锁段）；**D30B-4** 旧 `8000` 只读影子、**不主动迁移** | 直接决定 §4 的预算算法与回执字段 |
| ② 两份 MEMORY 投递范围 | **D30B-5** 继续**尾部窗口**（不是全量；不另造第二份来源） | §4 装配时两份记忆仍按尾部窗口取 |
| ③ 白板 full/slim 视角 | **D30B-6** 顺序沿用 `planSpec`，不重排；**D30B-7** 必保 `goal`+`type:progress`+`type:dead-end`；**D30B-8** 上限沿用、**不新增限额键**；**D30B-9** 无命中 ⇒ 显式 degradation，不回退全文；**D30B-10** 「当前任务」只认白板/账本显式标记 | 白板段选择与预算按此实现 |
| ④ 特殊档公共修复边界 | **D30B-11** `handoff_carry`/`hang_compensate` **不改变输出**（仍 full + 核心节）；**D30B-12** 诊断计费沿用 R4 | 档位映射表保持不动 |

---

## 6. 每件改动后的必跑项

```powershell
node --check lib/index.js
node -e "import('./lib/index.js').then(()=>console.log('IMPORT-OK'))"
node tools/verify-docs.mjs            # 必须 22 tools / 87 routes / 182 config keys
node tests/smoke/smoke-test-r26-cross-layer.mjs   # 改 lib/index.js 必须重钉，保持 26/0
```

重钉规则：**用守卫自己报出的 actual**（归一化长度 + SHA16），不许手算。

---

## 7. 交付与回执

1. **批次 A = 2 个独立 commit（件一、件二），批次 B = 1 个 commit（件三）**。每个 commit 都要：每文件 `(bytes, lines, sha16)` 改前/改后 + 净增减对照。
2. 每件验收的逐条真实输出（PASS 数、变异 CAUGHT/MISSED、digest 值、实测字符数、宿主日志片段）。
3. **D30B 留痕清单**：附 `grep -rn "DECISION D30B-" lib/ tests/` 的完整输出（带行号），逐条说明该行对应哪条裁定、为什么落在这里；某裁定在本批无落点时要显式写「D30B-x 本批无落点，原因…」。
4. **未验证项单列**（真实宿主哪些场景没跑、a11y、跨设备等），不得用「已修复/全绿」掩盖。
5. 回执落盘 `docs/internal/RECEIPT-BATCH3-CLOSURE-<件号>-<日期>.md`，**不要 push**。

---

## 8. 必须停手回报的情况

- Phase 0 发现某条前提不成立（例如 `event-view.js` 的导出面覆盖不了 `event-render.js` 的某个生产点）。
- 发现任何未定边界会成为实现的必要条件（例如 U3b 必须决定「M6 4096B 是否进全局预算」才能算账）。
- `off` 无法做到逐字节等价（说明现有路径已被别的批次改动，需先定位来源）。
- 真实宿主上 `on` 导致插件报错或加载失败。

---

## 9. 代码留痕（强制 · 逐条可 grep）

用户明确要求：**实现时必须留下时间戳与裁定编号**，否则视为交付不完整。

1. 每个受 §5 裁定影响的实现点，加一行固定格式注释：

```js
// [DECISION D30B-3 | 2026-11-22 | user ruling] must 段超额：保留 must，只挤非锁段，回执标 budgetOvercommit。
```

2. 三要素缺一不可：`D30B-<编号>` + 日期 `2026-11-22` + `user ruling`。
3. **同一裁定在多处落点就标多处**，不许只在第一个文件标。
4. 不做伪造：纯技术选择没有对应裁定，就写普通注释说明理由，**不得**借用 D30B 编号。
5. 回执必须附 `grep -rn "DECISION D30B-" lib/ tests/` 的**完整输出（带行号）**，并逐条说明该行对应哪条裁定、为什么落在这里。
6. 若某条裁定在本批**没有**落点（例如 D30B-10 只在白板选择处生效而本批不碰白板），回执里要显式写「D30B-x 本批无落点，原因：…」，不许静默省略。

