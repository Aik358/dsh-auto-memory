# 2.6 / 2.7 / 2.8 写入口污染 · 测绘报告（只读）

- **日期**：2026-11-10
- **任务书**：[PROMPT-SURVEY-2.6-2.7-2.8-20261110.md](D:/dsh-auto-memory/docs/internal/PROMPT-SURVEY-2.6-2.7-2.8-20261110.md)
- **状态**：测绘完成，**未动任何代码**（lib/、tests/、tools/、真实记忆数据零改动）
- **数据源**：artifacts/_attr-realistic-20261110/data/event-store.snapshot.json
- **快照指纹（实测复算）**：**3,216,982 B** / sha256 **2F081175037BEEF4FBB992B764237D74C7DAFBF631401190324D0202B5A522EB** —— 与任务书逐字相同
- **交叉校验**：真实 store（--D--dsh-auto-memory--/handoff/event-store.json）= **3,235,127 B** / sha16 **EE9F9FE59060A0F7**（比快照多 13,145 B / 6 检查点，仍在涨）
- **原始数据**：artifacts/_survey-268-20261110/data/metrics.json；脚本 artifacts/_survey-268-20261110/scripts/01..10-*.cjs

---

## 0. 数字复核（任务书要求：不许照抄，发现错就指出）

### 0.1 复核结论表

| # | 任务书写的 | 实测 | 判定 |
|---|---|---|---|
| 1 | 5 个巨型事件占 active 检查点 **540 / 651 = 82.9%** | **540 / 651 = 82.95%**；真实库 **545 / 656 = 83.08%** | ✅ 成立（逐字命中） |
| 2 | 整篇快照 **126 条**（账本 108 + 白板 18），占字符量 **32.0%**（333,620 / 1,042,600） | **可复算，但用了偏窄口径**：按「首行以 项目白板 或 交接账本 开头」= **126 条 / 333,620 字符 / 32.00%**，逐字命中。**按检查点 kind 口径**（kind ∈ {plan, handoff}）= **200 条 / 671,701 字符 / 64.43%** | ❌ **口径错误（低估约 1 倍）**，见 0.2 |
| 3 | 单个白板快照平均含 **17.1 行**事件表格 | 18 条含表格的 kind=plan 快照，**数据行合计 253、平均 14.1 行**（253/18）；把每条表格 2 行表头算进去 = **17.06 ≈ 17.1** | ⚠ **口径差异（表头是否计入）**，两种算法都对 |
| 4 | 失败标记 **13 条**（10-25 起 3 条 → 11-09 已 13 条） | **13 条** ✅；首条 2026-10-25T12:48:53，末条 2026-11-09T08:37:22 | ✅ 成立 |
| 5 | 失败触发源 plan-version-conflict **6 次** + 判据门 H1/H2 **7 次** | **plan-version-conflict 5 次** + plan-card-format 1 次 + handoff 判据门 **7 次**（H1×6 + H1/H2×1） | ⚠ **数值小错**：是「6 条 plan-write-failed」= 5 冲突 + 1 格式门，不是「6 次 version-conflict」 |
| 6 | 0.34 词袋门过门率（全库）仅 **2.1%** | 静态复算**上界** = **5.21%**（17/326）。真值只会更低（见 0.3） | ✅ 方向成立；2.1% 落在我算的上界之内，未被证伪 |
| 7 | 落在 5 大事件的 217 条 memory_log 过门率 **0.9%** | 静态上界 **3.23%**（7/217）。真值只会更低 | ✅ 同上 |
| 8 | 217 条 memory_log「它们不是门算出来的归属」 | ✅ 成立，但**归因需修正**：217 条**全部**带 idemKey 前缀 log:（= memory_log 指纹，217/217），其中 **143 条（65.9%）写于 2026-11-04 之前 —— 那时 #543 的门还不存在** | ⚠ **机制描述需订正**：多数不是「门放过了它们」，而是「当时根本没有门」 |
| 9 | 最后一条整篇快照 2026-11-09T09:29 | kind=plan 最后一条 = **2026-11-08T23:22:08**；kind=handoff 最后一条 = **2026-11-09T08:3x** | ⚠ 快照时点差（见 0.4） |
| 10 | #543 之后仍新增 **16 条**整篇快照、**5 条**失败标记 | 以 2026-11-05 为界：plan+handoff **20 条**；失败标记 **4 条** | ⚠ 快照时点差（见 0.4） |

### 0.2 为什么「126 条 / 32.0%」是错的（这条最重要）

两个数字**各自都是真的**，但用的是**同一个偏窄口径**，而这个口径本身会漏掉 58.7% 的条数 / 101.3% 的字符量：

| 口径 | 判据 | 条数 | 字符 | 占比 |
|---|---|---|---|---|
| **前缀口径**（任务书用的） | 检查点正文首行以「项目白板」或「交接账本」的 H1 标题开头 | 18 + 108 = **126** | **333,620** | **32.00%** |
| **kind 口径**（结构真值） | checkpoint.kind ∈ {plan, handoff} | 37 + 163 = **200** | **671,701** | **64.43%** |
| 差值 | — | **+74（+58.7%）** | **+338,081（+101.3%）** | **+32.4pp** |

**为什么前缀口径会漏**：交接账本的 H1 标题是 writeHandoffLedger **写 .md 文件时**才加的（lib/index.js:25197 只把它拼进 engine.state.latestHandoffText）；Phase 1 写进检查点的是**模型传进来的原始正文 writeH**，模型手写时通常直接从「## 任务状态」开始。白板旧版还有「项目全貌 · …」等前缀。

⇒ **任务书同一节里两个数字用了两个口径**：条数/字符用前缀口径，而「17.1 行」用的是 kind 口径。**本报告后续一律用 kind 口径（200 条 / 671,701 字符 / 64.43%）。**

> 交叉印证：同日的 [EVENT-CONTAMINATION-20261110.md](D:/dsh-auto-memory/docs/internal/EVENT-CONTAMINATION-20261110.md):160-165 已经自己算出「kind 口径全库 200 条 / 前缀口径 126 条，前缀口径少算 39%」，但它的摘要行（:18 / :148 / :475 / :529）仍只引用 126 条 / 32.0%。**这个偏窄数字正在被两份文档向下传播**，建议 2.7 立项时以 **200 / 64.43%** 为准。

### 0.3 词袋门过门率：我算的是上界，不是真值

生产实现 pickActiveEventByTopicPre（lib/event-write.js:197-265）**只跟一个候选比**：第 198 行 const best = resolveActiveEventPre(store)（updatedAt 最大的 active 事件），词袋只在 best 身上算。历史时点的「谁是 updatedAt 最大」**不可回放**（append-only、无逐检查点快照）⇒ 我的复算取「对全部 active 取最大比值」，是**上界**。

| 口径 | 全库 326 条 log | big5 内 217 条 |
|---|---|---|
| 静态上界（对全部 active 取 max） | **5.21%**（17/326） | **3.23%**（7/217） |
| 任务书给的（真值方向） | 2.1% | 0.9% |
| 比值分位 | p50 = 0.228 / p90 = 0.290 / max = 0.620 | — |

⇒ **2.1% / 0.9% 与上界不矛盾**（真值 ≤ 上界），方向成立。但要说清：「过门率极低」这条是**推断**；可复算的事实是「上界 5.21%，p90 只有 0.290，够不到 0.34」。

### 0.4 需要按日重算的口径

| 项 | 实测 |
|---|---|
| 全库 log 检查点 | at < 2026-11-04 = **218** / ≥ = **108**（共 326） |
| handoff+plan | at < 2026-11-04 = **152** / ≥ = **48**（共 200） |
| #543 之后新增整篇快照 | 以 2026-11-05 为界（#543 = commit e338473f，2026-11-05 17:20）：**at ≥ 11-05 的 plan+handoff = 20 条**（任务书写 16 条） |
| #543 之后新增失败标记 | **4 条**（11-06×2、11-08、11-09），任务书写 5 条 |
| kind=plan 最后一条 | **2026-11-08T23:22:08**（13,730 字符，47 行表格） |

> ⇒ **#543 之后（11-05 起）仍有 48 条 handoff/plan 检查点走零门归属** —— 这是 2.6 仍然活着的直接证据，比「新增 16 条」精确。

---

## 1. TL;DR（≤10 行）

1. **2.6 是活缺陷，但正确解法不是「把 #543 的门搬过来」**：门只适合单条日志，不适合整篇项目文档 —— 实测 200 条全文检查点里，**18.5% 零 L1 标识**（只能走词袋兜底）、**有标识的 163 条中 98 条与所有带标识事件零交集**（#543 的「强负证据」会直接判「新建事件」）、**31 条命中 >1 个事件**（max fanout 24，无法唯一归属）。⇒ 搬门会让 **60%+ 的账本/白板写入各建一个新事件**，碎片化更严重。
2. **2.6 的真解法是「项目级文档有专用归属通道」**：memory_note 目前**没有 eventId 参数**（17 个参数里没有，全文件 args.eventId 出现 0 次），所以模型无法显式纠偏。补这条通道 + 明确「白板/账本属于哪个容器事件」才是对症的。
3. **2.7 不是「没人读」**：全文检查点**有一个真实且巨大的消费者** —— memory_recall 语料。实测 event-recall.textOfEventPre 真跑，语料总量 **1,090,665 字符**，其中 plan/handoff 全文贡献 **674,162 = 61.81%**；非检查点部分只占 3.60%。⇒ 「降级」必须同时给出回读通道，否则召回直接失去 61.8% 语料。
4. **2.7 的结构证据成立**：200 条全文快照**内容 200/200 全不相同**（无精确重复），但 18 条白板快照是**同一份文档的 18 个历史版本**（表格行 253，最新一份 47 行 = 当前 47 个 active 事件）⇒ **单个检查点在定义上覆盖整个事件库**。
5. **2.7 与原型哲学确实相反**（任务书 §3.3 成立）：sidecar-store.js:41-45「Markdown remains the source」、markdown-adapter.js:7-10「Methods index text; they never create, edit or archive a Markdown source file」—— 而事件库把整篇正文当检查点正文存。
6. **2.8 的 idemKey 去重是有效的**（与任务书说法不同）：13 条失败标记只有 **5 个唯一 idemKey**，同 reason 的条目 idemKey 完全相同 ⇒ **不是「同因重犯不去重」，而是「同因 + 内容不同」才不去重**（idemKey = 前缀 + sha1(ledgerPath + NUL + 全文)，而 Phase 1/3 都不传 ledgerPath ⇒ 实际是**全文**的 sha）。
7. **2.8 可分三类**：①**可预期且应前置拦**（判据门 H1/H2×7、plan-card-format×1）；②**可预期但门在 Phase 2 才判**（plan-version-conflict×5，需要先读盘才知道冲突）；③**意外**（磁盘/权限/JSON 损坏）—— 只有第③类应留痕。
8. **三项的共同解法不是「再抽一个模块」，而是给写入口定一层 API**（任务书 §5.1③）：appendEventNote({kind, content, eventId?, scope})，调用方不碰 WAL 阶段、不碰检查点字段、不碰归属规则。
9. **顺序需调整**：2.6 的前置判定（「谁是容器事件」）必须先于 2.7 的存储形态，2.7 的「降级后回读」又必须先于 2.8 的「失败后回放」。⇒ **仍是 2.6→2.7→2.8，但 2.6 的范围要扩大**（见 §6）。
10. **本轮只读**：未改 lib/tests/tools/真实数据；快照 sha256 复核通过。

---

## 2. 2.6 测绘：写入口归属统一

### 2.1 代码事实

#### 2.1.1 resolveActiveEventPre 的完整实现（逐字，lib/event-write.js:110-131）

```
/**
 * ① resolveActiveEventPre —— 找当前活跃事件。
 *
 * 判据：status === 'active' 且 updatedAt 最大。并列时按 id 字典序取小（确定性）。
 * 为什么用 updatedAt 而不是 createdAt：用户要的是「我现在在做哪件事」，
 *   最近有动作的那件才是当前工作（可能建于很久以前但刚刚还在推进）。
 */
export function resolveActiveEventPre(store) {
  const evs = (store && Array.isArray(store.events)) ? store.events : []
  let best = null
  for (const ev of evs) {
    if (!ev || ev.status !== 'active') continue
    if (!best) { best = ev; continue }
    const a = Number(ev.updatedAt) || 0
    const b = Number(best.updatedAt) || 0
    if (a > b || (a === b && String(ev.id) < String(best.id))) best = ev
  }
  return best ? { id: best.id, event: best } : null
}
```

⇒ **任务书的初步判断证实为真**：只按 updatedAt 取最大、**零标识、零负证据、零词袋**、候选集为空。

#### 2.1.2 调用点全普查（lib/ 全量 grep，含行号与语义）

| 位置 | 调用方语义 | 是否走门 | 备注 |
|---|---|---|---|
| lib/event-write.js:198 | pickActiveEventByTopicPre 内部 const best = resolveActiveEventPre(store) | **是门的起点** | 只是拿「最新 active」当**唯一候选**，随后才跑 L1/负证据/词袋 |
| **lib/event-write.js:704** | **appendHandoffCheckpointPre（Phase 1 WAL + Phase 3 补偿）** | **❌ 零门** | let evId = String(opts.eventId or ''); if (!evId) { … const active = resolveActiveEventPre(store0) … } |
| **lib/event-write.js:800** | **mirrorPlanSectionsPre（plan 四段镜像）** | **❌ 零门** | 同样 if (!evId) { const active = resolveActiveEventPre(store0) }，但**实参传了 eventId: walEventId** ⇒ 只在 walEventId 为空时兜底 |
| lib/event-write.js:850 | 默认导出对象（再导出） | — | 非调用 |
| lib/index.js:37 | import 语句 | — | **⚠ 死导入**：index.js 全文再无 resolveActiveEventPre 调用（仅 :24579 / :24595 两处注释提到它） |
| lib/index.js:24579 / :24595 | 注释 | — | 见 2.1.3 |

**关键**：memory_log **已经不走** resolveActiveEventPre 了 —— #543 之后它改为**内联 IIFE**（lib/index.js:24511-24548 的 const _activeBest = evId ? { id: evId } : (function () {…})()），该 IIFE 自己算「updatedAt 最大的 active」再跑门。所以 :37 的 import 是**死导入**（可作为施工时顺手清理，但属**超出 2.6 落点**，单列 §7）。

#### 2.1.3 #543 到底修了什么（commit + 范围）

- **提交**：e338473f（2026-11-05 17:20，fix(core): alpha.6 后端修复批 — 跨区升级 P0-P6 / v1事件写兼容 / 团队传输安全 / 响应体上限），lib/event-write.js **+54 行** = 新增 pickActiveEventByTopicPre 及其注释。
- **为什么没 covering memory_note**（源码自述，lib/index.js:24595-24596 逐字）：

```
//   ★为什么不动 resolveActiveEventPre 本体：它还被 handoff(:536) 与 plan(:630) 复用，
//     改它等于顺手改账本与白板的归属语义，超出本 issue 范围。
```

- **实测订正**：注释里的 handoff(**536**) / plan(**630**) 是**行号**，已漂移到 **704 / 800**（差 168 / 170 行）。⇒ 「超出本 issue 范围」这个判断本身**成立**（改 resolveActiveEventPre 会同时改三条路径），但**登记缺失** —— 这三处从未进施工总表，直到 2026-11-10 才补入 2.6。

#### 2.1.4 memory_note 有没有显式 eventId 通道？

**没有。** 实测（scripts/06-params.cjs 真解析源码）：

| 工具 | 参数个数 | 有 eventId？ |
|---|---|---|
| memory_log | 6（note / date / kind / eventId / dryRun / workspace） | **✅ 有** |
| memory_event | 27 | **✅ 有** |
| **memory_note** | **17**（content / action / kind / expectedRevision / fromEvents / cardId / expectedCardRevision / supersedes / retract / retractReason / restore / archivedIds / userPercept / agentTrace / sharedGround / commitment / workspace） | **❌ 无** |

并且 memory_note 处理体内 args.eventId 出现 **0 次**（scripts/06-params.cjs 实测）。

⇒ **这是 2.6 的关键结构缺口**：memory_log 与 memory_event 都能让模型显式指定归属，**唯独 memory_note 不能** —— 而它恰恰是写整篇项目文档的那条路径。写错后模型**无法纠正**（Phase 3 还继承了错误归属：eventId: walEventId or undefined）。

#### 2.1.5 从 memory_note 到「检查点落在哪个事件」的完整分叉（2.6 交付要求①）

```
memory_note(kind=plan | handoff)
│
├─ [前置] args.kind ∈ {plan, handoff}                        lib/index.js:25104
├─ [门 H] sanitizeForWrite(content)                          :25105（长度/乱码，不改归属）
├─ [分支 P] kind==='plan' && fromEvents===true
│            → content = renderPlanFromEventsPre(_evs)        :24749-…（与归属无关）
│
├─ Phase 1  appendHandoffCheckpointPre(storePathEv1, {        lib/index.js:25144-25155
│              ledgerText: writeH, kind: plan|handoff, percept… })
│            └─ if (!opts.eventId) {                        ← ★ memory_note 永不传 eventId
│                 const store0 = await readStorePre(storePath)
│                 const active = resolveActiveEventPre(store0)   lib/event-write.js:704 ← ❌ 零门
│                 if (active) evId = active.id              ← ★ 归属在此确定，之后不可改
│                 else createEventForWorkPre(name=sections.goal.slice(0,80))   :709
│               }
│            └─ eventStorePre.append(storePath, evId, { checkpoint: ckPayload })   :750
│                 ckPayload.text = **writeH 全文**，:737 ← 这就是 2.7 的落点
│
│  ── 此时「事件里已有全文」；下面才写 .md ──
│
├─ Phase 2  writePlanSnapshot / writeHandoffLedger            :25163-25165
│            └─ 判据门 / CAS / M1 / 锚点门 在**这里**才判
│
├─ Phase 3  if (!r.ok) appendHandoffCheckpointPre({          :25167-25181
│              ledgerText: '【写入被门拦下】原因…',
│              kind: plan-write-failed | handoff-write-failed,
│              eventId: walEventId or undefined })           ← ★ 继承 Phase 1 的（可能错的）归属
│
└─ [成功侧] if (kind==='plan') mirrorPlanSectionsPre({planText: writeH, eventId: walEventId or undefined})  :25219
              └─ if (!evId) resolveActiveEventPre(store0)     lib/event-write.js:800 ← ❌ 零门（仅兜底）
```

**三条结论**：
1. **归属只在 Phase 1 决定一次**，Phase 3 与 mirror 全部沿用 walEventId ⇒ **一次判错，失败标记与 sections 镜像一起错**。
2. **.md 写成功与否，完全不影响归属** —— Phase 1 已经落盘。
3. **fromEvents 渲染路径（2.5）不参与归属**，只改 content 内容。

### 2.2 2.6 的判断

#### 2.2.1 big5 的 217 条 log 到底是哪条路径选出来的？

**用 idemKey 前缀做路径指纹**（memory_log 的 idemKey = log: + date + : + hhmm + : + sha1(entry).slice(0,12)，lib/index.js:24573；其它通道的 idemKey 自由命名）：

| 口径 | 数值 |
|---|---|
| big5 内 log 检查点总数 | **217** |
| 其中 idemKey 前缀 = log: | **217（100%）** ⇒ **全部来自 memory_log** |
| 其中 at < 2026-11-04（#543 之前） | **143（65.9%）** |
| 其中 at ≥ 2026-11-04 | **74（34.1%）** |

⇒ **订正任务书的归因**：「过门率 0.9% ⇒ 它们不是门选出来的」在**结论上**成立，但**机制上**大部分不是「门算错了」，而是：

- **143 条（65.9%）写于门诞生之前** —— 那时 memory_log 直接走 resolveActiveEventPre（旧行为），**完全没有门**；
- 74 条写在门之后，其归属来源有 4 种可能（本测绘**无法逐条区分**，因为 append-only 不记录判定原因）：
  ① 模型显式传了 eventId（memory_log **有**这个参数）；
  ② 命中 L1 标识（多命中时取 updatedAt 最新 ⇒ 仍是磁铁）；
  ③ 命中「事件侧无实质内容时保持旧行为」兜底（event-write.js:259 if (!evTok.size) return best）；
  ④ 命中「日志无可用词时保持旧行为」兜底（:257 if (!noteTok.length) return best）。

- **⚠ 这是本报告最重要的一条口径修正**：把 0.9% 当作「门失效」的证据是**过度解读**；真正的证据是「**65.9% 的历史数据根本没有经过任何门**」。

#### 2.2.2 有没有「最近事件优先」的启发式？（代码证据）

**有，而且是两道**：
1. resolveActiveEventPre（lib/event-write.js:120-131）本身**就是**「最近更新优先」—— 文档注释逐字「最近有动作的那件才是当前工作」。
2. pickActiveEventByTopicPre 的候选集**只有 1 个**：const best = resolveActiveEventPre(store)（:198）—— 门的 L1/负证据/词袋**全部只在这个 best 上判**，不是全库搜索。所以即使判据设计正确，**它也只是「给最新事件投赞成票」**。

⇒ 2.6 的**结构性**问题：即使把门原样搬到 memory_note，**「磁铁」仍然是 updatedAt 最大的那个** —— 因为候选集只有它。

#### 2.2.3 门的候选复用点表（2.6 交付要求②）

| 判据 | 能否复用到 memory_note（plan/handoff） | 实测障碍 | 需要的适配 |
|---|---|---|---|
| L1 high-cardinality 标识 | **不能** | 200 条全文检查点中：**18.5%（37/200）零标识**；有标识的 163 条里 **98 条（60.1%）与所有带标识事件零交集**、**31 条（19.0%）命中 >1 个事件**（max fanout **24**） | 整篇项目文档天然引用全库标识，交集不具鉴别力 |
| 强负证据（零交集 ⇒ 新建） | **绝对不能** | 同上：98 条会被判「明确新建」⇒ **60%+ 的账本/白板各建一个新事件**，碎片化反而恶化 | 项目文档不该因「没提到某 issue」而被判为新事 |
| 0.34 词袋 | **不能** | 全文里既有全库词汇，比值天然偏高；且 big5 的 179 条（handoff+plan）本身就是**跨事件内容** | 同上 |
| 「无词兜底挂最近」 | 现状即是 | — | 这就是磁铁成因 |

> 数据来源：scripts/10-fanout.cjs（真 import 同源 idsOf 逻辑，对 47 个 active 事件逐条算 fanout）。

#### 2.2.4 风险清单：给 memory_note 装上同一套门会改变哪些可见行为

| # | 场景 | 现状 | 装门后 | 可见后果 |
|---|---|---|---|---|
| R1 | 项目白板（kind=plan）定时快照 | 挂到「最近更新的 active 事件」 | **约 60% 概率新建一个事件**（98/163 零交集） | 白板快照各自成事件 ⇒ 事件数暴涨、卡片变窄卡（kind 推断错还进不了泳道） |
| R2 | 交接账本（kind=handoff） | 同上 | 同上 | 每次交接一个新事件，接续时「最近一件事」变成「最后一篇账本」 |
| R3 | 一条日志同时提到 #543 与 #557（多命中） | 挂到 updatedAt 最新那个 | 同样挂到 updatedAt 最新那个（多命中取最新，:224-231） | **没变**，磁铁仍在 |
| R4 | mirrorPlanSectionsPre 兜底路径 | 零门 | 若一并改 | sections 镜像落到别的事件，白板当前态错位 |
| R5 | Phase 3 失败标记 | 继承 Phase 1 归属 | 继承 Phase 1（可能新建的）归属 | 失败标记散落到新事件，13 条 → 更多 |

#### 2.2.5 改动面：resolveActiveEventPre 被复用的那两处

| 调用点 | 注释写的旧行号 | 实测行号 | 漂移 | 改动面 |
|---|---|---|---|---|
| handoff（appendHandoffCheckpointPre） | :536 | **:704** | +168 | 1 处（只改这里 ⇒ 只影响 handoff/plan WAL） |
| plan（mirrorPlanSectionsPre） | :630 | **:800** | +170 | 1 处（且有 eventId 兜底，影响面更小） |

⇒ **「改 resolveActiveEventPre 本体」的风险今天仍然成立**（同时改两处 + 任何未来调用），但**「在两个调用点各自加判据」是局部改动**，风险可控。这正是 #543 当年选「不改本体」的同一个理由 —— 只是它把「改调用点」这一步留给了后人。

### 2.3 2.6 的明确建议：改哪里、不改哪里

| 决定 | 内容 | 理由 |
|---|---|---|
| **不改** resolveActiveEventPre 本体 | 保持 updatedAt 最大语义 | 它是 project 文档的**兜底通道**，语义本身没错；改它会同时动 handoff/plan 两处 |
| **不改** 把 0.34 门 / L1 门搬到 memory_note | — | §2.2.3 实测：搬过去 **60%+ 会新建事件**，比现状更糟 |
| **改 ①** 给 memory_note 补 eventId 参数（显式通道） | eventId?: string，透传给 Phase 1 的 appendHandoffCheckpointPre({ eventId })，并在 Phase 3 / mirror 沿用 | 与 memory_log / memory_event 对齐；模型可显式纠偏；**零判据、零猜测** |
| **改 ②** 明确「项目级文档的容器事件」协议（成文） | 例：config.planEventId / config.handoffEventId，或「kind=plan ⇒ 固定挂『项目白板』事件」；缺省时**回落到 current 行为**（不改变现状） | 项目文档**天然跨事件**，不该用「主题匹配」决定归属；这一条才是根因修复 |
| **改 ③** Phase 3 的归属不再静默继承 | Phase 3 若 walEventId 为空 ⇒ 显式记「未归属」而不是再猜一次 | 失败标记必须可追溯，不能再猜 |
| **可选** | 清理 lib/index.js:37 的死导入 | 属超范围，单列 §7 |

> **「为什么 #543 当年不敢」在今天是否仍成立**：**成立，但只对「改本体」成立**。今天的差别是：① 有了 1.4 的标识判据可以**局部**复用（不必改本体）；② 有了本报告的 fanout 实测（**证明门对整篇文档不可用**）⇒ 正确的做法不是「补门」，而是「补显式通道 + 定协议」。**若只按任务书原话「把 #543 的门接上」，会踩 R1/R2 两个新坑。**


---

## 3. 2.7 测绘：整篇正文不进检查点

> **依赖 2.6 的结论**：2.6 若定「项目级文档有专用容器事件」，2.7 的正文存储形态应一起定 —— 否则同一份文档要改两次写入路径。

### 3.1 代码事实

#### 3.1.1 Phase 1 WAL 到底把「什么」写进检查点

数据流（逐段，带行号）：

| 步 | 位置 | 逐字/语义 |
|---|---|---|
| ① 入参 | lib/index.js:25105-25108 | const gateH = sanitizeForWrite(content, { maxEntryChars: plan ? 200000 : 8000 }); const writeH = gateH.clean or content |
| ② 传参 | lib/index.js:25144-25147 | appendHandoffCheckpointPre(storePathEv1, { **ledgerText: writeH**, kind: plan/handoff, … }) —— **传的就是 .md 要写的那份正文，一字不加工** |
| ③ 记录 | lib/event-write.js:737 | const ckPayload = { kind, at: Date.now(), **text: ledgerText**, sourceRef: opts.ledgerPath ? String(...) : null, idemKey, ..._quad } |
| ④ 落盘 | lib/event-store.js:915 append → :750 eventStorePre.append | 整个 ckPayload 原样 append（checkpoint.text = 全文） |

**所以「整篇正文」= 模型传来的 content 原文（writeH），不是摘要、不是渲染中间态。** 上限：plan 200,000 字符 / handoff 8,000 字符（:25105）。

**实测体量（kind 口径，见 §0.2）**：

| 指标 | 值 |
|---|---|
| 全文快照（kind ∈ {plan, handoff}） | **200 条** |
| 字符合计 | **671,701** |
| 占全库检查点字符量 | **64.43%**（671,701 / 1,042,600） |
| plan 条数 / 平均字符 | 37 / **10,702** |
| handoff 条数 / 平均字符 | 163 / **1,692** |
| 单条最长 | **20,762** 字符（旧版白板快照） |
| 内容唯一性 | **200 / 200 全不同**（无精确重复） |

#### 3.1.2 全文的消费者普查（2.7 交付要求①：读了 / 没读 / 只在失败时读）

| 消费者 | 位置 | 读不读 checkpoint.text | 读到的效果 | 证据 |
|---|---|---|---|---|
| **memory_recall 语料（scope=events / all）** | lib/event-recall.js:56-61 | **✅ 读，且不截断** | 每条检查点 text 原样进检索语料，形如 - [kind] + 正文 | scripts/07-recall-corpus.cjs 真跑 |
| ↑ 实测占比 | — | — | 语料总量 **1,090,665 字符**，其中 plan/handoff 全文贡献 **674,162 = 61.81%**；其它检查点 34.59%；非检查点部分（name/summary/sections/percept）**3.60%** | 同上 |
| **注入面事件卡片（T2）** | lib/event-render.js:332 | **⚠ 条件读** | 四段（goal/state/dead/next）齐全时**完全不读 text**；四段全空才回落 text | 实测：handoff **152/163 有四段**（93.3%）、plan **36/37**（97.3%）⇒ 渲染侧**几乎从不读全文** |
| **白板渲染 fromEvents** | lib/plan-render.js:211-245 | **❌ 不读** | 只读 events 的 name/summary/sections/constraints | renderPlanFromEventsPre 入参是 events，不碰 checkpoints |
| **handoffPanelData / 事件详情** | lib/ev4-adapter.js:190/199 | **⚠ 只算长度与首行** | bytes = 字符数、quoteLine = 首个段落文本 —— **只显示「多少字节」，不显示正文** | ev4-adapter.js:190,199 |
| **接续包 carry** | lib/event-carry.js:43 | **❌ 不读** | 注释逐字「为什么从 sections.next 而不是 checkpoints：checkpoints 是历史流水，sections.next 才是…」 | event-carry.js:43 |
| **Phase 2 失败回放** | lib/index.js:25167-25181 | **❌ 没有任何回放代码** | 失败时只**追加一条失败标记**，不回读、不重放、不回滚 | 见 3.1.4 |
| **失败标记里的指引** | lib/index.js:25177-25178 | — | 文案逐字「原内容已作为前一检查点记入事件（**可经 memory_recall(scope="events") 取回**）」 ⇒ **恢复通道 = 人工/模型调 memory_recall**，不是自动回放 | 13 条标记全部含这句 |

**结论（回答任务书「若没人读，那它存在的意义是什么？」）**：

**有人读，而且是最重的那一个读者 —— memory_recall 语料（61.81%）。** 但它**不是 WAL 回放凭据**：

- Phase 2 失败时**没有任何自动回放**，恢复靠人/模型 memory_recall；
- 事件卡片渲染在四段齐全时**完全不读**它（93%+ 的情况）；
- 白板渲染、接续包**都不读**。

⇒ 它的真实角色是：**一次写入同时产生两份全文拷贝（一份进 .md、一份进事件库），后者顺带成了检索语料**。这是「意外收益 + 意外成本」的组合，不是单一的设计意图。


#### 3.1.3 三方证据：有意设计还是缺陷？

| 证据源 | 逐字 | 说明 |
|---|---|---|
| **注释（lib/event-write.js:759）** | 「★为什么删掉不丢信息：账本全文已完整保存在检查点的 text 字段里（**不是摘要**，实测 1,834 字）。」 | 明确把「保留全文」写成**优点**（这是 WAL 方向改动的辩护理由） |
| **注释（lib/index.js:25115-25135）** | 「★★v4-C1（2026-10-25 用户裁定）：**WAL 三步 —— 事件优先**。」+ 用户原话「把这个问题1的这个 memory note 还是要**追加在事件下**，反正都是以事件为中心了，这样能理得更清楚一点，只要保证这个语义唤回引擎能够触及到足够的唤回细节就行了。」 | 用户裁定的**目标是「让语义唤回引擎触及细节」** —— 它说的正是**检索**，与 3.1.2 测出的「61.81% 语料来自它」完全吻合 |
| **文档（artifacts/E-SERIES-PLAN-2026-10-25.md:265）** | C1 卡：「memory_note(plan/handoff) 改事件优先（WAL 三步…）」，**关键判据：调用后事件 checkpoints +1**（现状不变，只 set sections） | 验收判据只要求「+1 条」，**从未要求「只存摘要」** |
| **引入提交** | 49d99735（2026-10-25，v4 里程碑：事件记忆六批收口） | 与用户裁定同日 |

**判定：有意设计（A1 有意），但「存全文」不是用户裁定的字面要求。**

- 用户要求的是「让语义唤回引擎触及足够细节」；
- 实现选择了「全文进检查点」作为达成手段；
- **代价（64.43% 的库体积、82.9% 的集中度）当时没有评估** ⇒ 这是「有意 + 未评估代价」，不是「疏漏」，也**不是单纯缺陷**。

#### 3.1.4 降级后的回读通道在哪？（回答任务书 3.1.5）

**现状：不存在。** 具体缺失三件：

1. **检查点没有指向 .md 的可用指针**：sourceRef 在 Phase 1 **从不被传**（lib/index.js:25144-25155 的调用参数里没有 ledgerPath）⇒ 实测 **200 条全文检查点里 172 条 sourceRef 为 null（86%）**；有值的 28 条里 **byteMatch=0、diff=23、fileMissing=5**（因为 writeHandoffLedger 会给文件加时间戳后缀）。
2. **没有「按 eventId 取回原文」的 API**：eventStorePre.detail 会返回 checkpoints（含 text），但那是**内部原语**；且 list() 刻意不返回 checkpoints 正文（event-store.js:674 注释「刻意不返回完整 checkpoints：正文走 /event-detail」）。
3. **没有「摘要 ⇄ 全文」的双向映射**：降级后要还原，必须知道「这条摘要对应哪个 .md 文件的哪一版」—— 而 .md 是**每次追加新文件**（writeHandoffLedger 每次一篇），文件名带 handoffStamp() 时间戳，**与检查点的 at 无契约关联**。

#### 3.1.5 参照物：本仓索引层已经给出了正确范式（2.7 交付要求 §3.3）

| 文件:行号 | 逐字（实测复算） |
|---|---|
| **prototypes/sidecar-store/sidecar-store.js:41-45** | 「Public boundary for a derived whiteboard index. **No caller handles disk format, inverted maps, locks or generation publication. Markdown remains the source.** All writes require an explicit separate directory; there is no memory-root default.」 |
| **prototypes/sidecar-store/markdown-adapter.js:7-10** | 「Existing deterministic Markdown parsing sits here, outside persistence. **Methods index text; they never create, edit or archive a Markdown source file.**」 |

> **行号订正**：任务书写 sidecar-store「约 L43-48」、markdown-adapter「约 L9-13」；实测是 **L41-45** 与 **L7-10**（各差 2-3 行，属文件头 banner 行数差异）。

**⇒ 同一项目里两层设计哲学相反：**

| 层 | 真源 | 存储内容 | 是否存正文 |
|---|---|---|---|
| 白板索引层（sidecar，2026-11 新建） | **Markdown** | 条目 id / tag / cue / 摘要（派生索引） | **❌ 只索引，不存正文** |
| 事件库层（event-store，2026-10） | **事件库**（event-store.json） | 检查点（含 .md 全文） | **✅ 存整篇正文** |

**回答任务书的问题「事件库层为什么违背这条原则？是有意的（WAL 可回放）还是疏漏？」**

**答：是有意的，但「WAL 可回放」这个理由在代码里站不住** —— 见 3.1.2 / 3.1.4：Phase 2 失败时**没有任何回放代码**，恢复靠 memory_recall 人工取回。更准确的说法是：

> 事件库层把全文存进检查点，**真实收益是「检索语料」**（用户 2026-10-25 裁定原话就是「只要保证这个语义唤回引擎能够触及到足够的唤回细节就行了」），而「WAL 回放能力」是一个**从未实现、也从未被测过的附带声称**。

⇒ **这是 2.7 最强的立项依据**：不是外部批评（「正文太大」），而是**内部既有共识**（索引层注释）+ **自己的裁定原话**（要的是检索细节，不是存全文）。**两层哲学的冲突是可裁决的** —— 索引层的原则可以直接搬过来当事件库的判据。

### 3.2 2.7 的判断与方案对比

#### 3.2.1 两方案对比（2.7 交付要求②）

| 维度 | (a) 改存「摘要 + 指针」 | (b) 写成功后降级为指针 |
|---|---|---|
| 改动面 | **中**：Phase 1 只写摘要（text 改 300 字摘要 + 指针字段）；渲染/召回侧不用改 | **大**：Phase 1 仍写全文 → Phase 2 成功后**再写一次**替换成摘要。但 event-store.js:914 明写「append：仅允许追加 checkpoints…」+ 检查点 append-only（upgrade-apply.js:368 是全库唯一整体替换，且是迁移专用）⇒ **要新增「检查点内字段替换」能力 = 动 append-only 契约** |
| 回读能力 | **好**：写入时就有指针（文件名 + 版本），可随时还原 | **差**：降级后才有指针，降级前窗口期没有 |
| 失败回放能力 | **中**：Phase 2 失败时事件里只有摘要 + 指针，全文已不在事件里 | **最好**：Phase 1 写全文 ⇒ 失败时事件里有全文可救（**这是 (b) 的独特优势**） |
| 迁移代价 | **中**：存量 200 条要不要裁？**建议不裁**（见 §7） | **大**：存量同样要处理 + 每写一次多一次写盘（当前 26 KB/plan 快照 ⇒ 写放大 ×2） |
| 与 append-only 契约 | **不冲突** | **冲突**（需新增可替换语义） |
| 与 2.6 的耦合 | 低（只需 eventId 通道） | 高（失败标记归属也要跟着变） |
| 语义正确性 | **同一份正文只存一份**（.md 是真源，事件存指针） | 短暂存两份，成功后收敛为一份 |

**推荐：(a) 改存「摘要 + 指针」。** 理由三条：

1. **与索引层哲学一致**（§3.1.5）：Markdown remains the source + never create/edit/archive a Markdown source file ⇒ 事件库应只存**指向**，不存正文。
2. **不破 append-only 契约**（本仓最硬纪律之一：event-store.js:914 注释 + 全库唯一替换点在迁移路径）。
3. **(b) 的「失败时保全文」优势可以用更低成本拿到**：Phase 2 **失败时**单独追加一条带全文的「救援检查点」（kind 保持 plan-write-failed），而**成功路径只写摘要**。这样：
   - 成功路径：库体积占比 **64.43% → 预计 < 6%**（摘要 300 字符 × 200 条 ≈ 60,000 字符 = 5.8%）；
   - 失败路径：仍保留全文（13 条 × 平均 1,600 字符 ≈ 21,000 字符，可忽略）。

#### 3.2.2 「降级后回读路径」的具体设计（2.7 交付要求③）

**现有字段够不够 —— 不够，但可以只用现有字段承载（不新增事件顶层字段）**：

| 需要的信息 | 现有字段 | 缺口 |
|---|---|---|
| 哪个文件的哪一版 | sourceRef（现有，string） | **Phase 1 从不传它**（§3.1.4-1）；且 writeHandoffLedger 的文件名带时间戳，Phase 1 时**还不知道最终文件名**（Phase 2 才生成） |
| 内容指纹（防指针漂移） | 无 | 需要校验「这份 .md 还是不是当初那份」 |
| 摘要本身 | checkpoint.text | 可复用（改成 300 字内摘要） |

⇒ **最小改动**：Phase 1 写摘要时用现有 sourceRef + panels 承载指针与指纹（**不新增事件顶层字段，也不新增检查点顶层字段**）：

```
// 建议形态（不落地，仅设计）
{
  kind: 'plan',
  at: Date.now(),
  text: summarizePre(writeH, 300),        // ← 摘要（不是全文）
  sourceRef: 'handoff/PLAN.md',           // ← 真源路径（plan 固定；handoff 见下）
  panels: [
    { kind: 'log', text: 'full=' + byteLen + ' sha256=' + sha16 + ' stamp=' + stamp },
  ],
  idemKey: 'plan:' + sha1Hex12(writeH),   // ← 保持现状（防重）
  ..._quad
}
```

**handoff 的指针怎么拿**：Phase 1 在 Phase 2 **之前**，拿不到最终文件名 ⇒ 两个选项：
- **选项 H1（推荐）**：Phase 1 的 sourceRef 写**目录 + 时间戳占位**（如 handoff/handoff-20261110-091500.md），并把同一时间戳传给 Phase 2 的 writeHandoffLedger 作为文件名依据 ⇒ 指针与文件名同源；
- **选项 H2**：Phase 1 的 sourceRef 留空，Phase 2 成功后**补一条**「指针补充」检查点（kind=pointer）—— 缺点：多一条检查点、且失败时无指针。

**回读通道（三步，全部落在既有原语上）**：

1. **解析指针** → sourceRef（handoff/PLAN.md 或 handoff/handoff-YYYYMMDD-HHMMSS.md）。
2. **读文件** → engine.readTextSafe(path.join(p.handoffDir, sourceRef))。
3. **校验** → 比对 panels 里的 sha16；不一致 ⇒ **明确报「指针漂移」**（不静默返回别的版本）。

**失败怎么办（三种，必须逐个给出口）**：

| 失败 | 处置 |
|---|---|
| 文件不存在（被手工删/迁移丢） | 返回 {ok:false, code:'pointer-missing', sourceRef}，并列出「该事件最近 3 条同 kind 检查点」供人工比对 |
| 文件在但 sha 不匹配 | 返回 {ok:false, code:'pointer-drift'} + 当前 sha16 + 期望 sha16 ⇒ **不自动返回错版本** |
| 存量 200 条无指针的老检查点 | **不回填、不裁**（append-only）；回读时若「text 超 2,000 字符且无 sourceRef」⇒ 按「老形态」原样返回 text（**保持今天的召回行为**） |

> **关键设计原则**：**降级只对新写入生效，存量一律不动**。这样 2.7 上线当天：召回语料占比从 61.81% 慢慢下降（新写入变短），而**任何一个历史全文都还能被召回** —— 零信息损失、零迁移风险、可灰度。

#### 3.2.3 一条顺带测出的硬约束（影响 2.7 的验收判据）

event-recall.textOfEventPre 是**对称实现**（index.js 内联版 + event-recall.js 模块版，:66-70 注释要求逐字相同，并由套件 smoke-test-task34-textofevent-parity 守卫）。**2.7 若改 checkpoint.text 的语义（全文 → 摘要），两份实现都不需要改**（它们只读 text，不关心长短）⇒ **2.7 的改动面比预想小**。但要注意：recallPassagesPre 的段落切分按行，摘要变短会让「同一事件的可检索表面」变小 ⇒ **需要一次召回质量回归**（见 §7 未测项）。

---

## 4. 2.8 测绘：失败标记不进事件

> **依赖 2.6 / 2.7 的结论**：失败标记的归属问题（2.6）与「全文是否进检查点」（2.7）都会改变 Phase 3 的形态。

### 4.1 代码事实

#### 4.1.1 完整触发条件：什么情况下会走到 Phase 3？

只有一条路（lib/index.js:25163-25186）：

```
// Phase 2：再写 .md
const r = args.kind === 'plan'
  ? await engine.writePlanSnapshot(p.projectDir, writeH, {...})
  : await engine.writeHandoffLedger(p.projectDir, writeH)
// Phase 3：补偿 —— .md 被门拦下 ⇒ 事件侧追加失败标记并如实报错
if (!r || !r.ok) { … appendHandoffCheckpointPre(…, kind: '-write-failed') … }
```

⇒ **触发条件 = !r 或 !r.ok**。r 的来源穷举：

| 来源 | 可能的 r.ok=false 原因 | 实测条数 |
|---|---|---|
| writePlanSnapshot（lib/index.js:5224-5360） | plan-version-conflict（CAS）、plan-card-format、plan-card-duplicate-id、mutation 门（M1/M2/M3）、criteria 门、plan-user-region-protected、plan-write-failed（磁盘） | plan 系 **6** |
| writeHandoffLedger（交接分支） | criteria 门（H1/H2 四段标题）、磁盘写失败 | handoff 系 **7** |

#### 4.1.2 idemKey 怎么算的？为什么「同因重犯不去重」？

代码（lib/event-write.js:713-737）：

```
const keySrc = String(opts.ledgerPath || '') + '\u0000' + ledgerText          // :713
…
const idemKindPrefix = ckKind === 'handoff' ? 'handoff:' : (ckKind + ':')     // :721
const ckPayload = { …, idemKey: idemKindPrefix + sha1Hex12(keySrc), … }       // :737
```

**关键**：Phase 3 的调用（lib/index.js:25176-25181）**没有传 ledgerPath** ⇒ keySrc = 空串 + 分隔符 + 失败标记正文。

⇒ **失败标记的 idemKey = plan-write-failed: + sha1Hex12(失败标记正文)**。而失败标记正文（:25177-25178）**只含「哪类写入失败 + 门名 + 错误码前缀」**（注释 :25171-25173 逐字：「补偿文本**不得含易变字段**（如 conflictPath 每次可能不同）…只保留稳定语义」）。

**所以任务书的「idemKey 含全文 sha ⇒ 同因重犯不去重」需要订正**：

- **不是**含「原全文」的 sha —— 含的是**失败标记正文**的 sha；
- **同因重犯会去重** —— 实测 13 条 → **只有 5 个唯一 idemKey**，且**同 reason 的条目 idemKey 完全相同**（见 4.1.3 表）；
- 真正导致「13 条」的原因不是「去重失效」，而是 **5 类不同原因各写一次，且跨事件分散**（同一原因在不同事件上各一条）。

#### 4.1.3 13 条逐条归因（4.1 交付要求③）

| # | at | kind | 挂在哪个事件 | 原因（逐字摘要） | 唯一 idemKey |
|---|---|---|---|---|---|
| 1 | 2026-10-25T12:48:53 | plan-write-failed | evt_89786878（项目白板） | plan-card-format | K1 |
| 2 | 2026-10-27T08:12:09 | plan-write-failed | evt_89786878 | plan-version-conflict | K2 |
| 3 | 2026-10-29T06:10:18 | plan-write-failed | evt_761ad9ff | plan-version-conflict | K2 |
| 4 | 2026-10-30T18:28:41 | handoff-write-failed | evt_761ad9ff | 判据门 H1（四段标题缺失） | K3 |
| 5 | 2026-10-31T13:42:29 | handoff-write-failed | evt_882dee05 | 判据门 H1 | K3 |
| 6 | 2026-11-02T05:55:37 | plan-write-failed | evt_4d65008f | plan-version-conflict | K2 |
| 7 | 2026-11-02T12:35:55 | handoff-write-failed | evt_4d65008f | 判据门 H1 | K3 |
| 8 | 2026-11-03T03:59:57 | handoff-write-failed | evt_4d65008f | 判据门 H1/H2 | K4 |
| 9 | 2026-11-03T14:52:56 | handoff-write-failed | evt_4d65008f | 判据门 H1（目标标题错） | K5 |
| 10 | 2026-11-06T18:15:34 | handoff-write-failed | evt_8180305e | 判据门 H1 | K3 |
| 11 | 2026-11-06T18:17:52 | plan-write-failed | evt_8180305e | plan-version-conflict | K2 |
| 12 | 2026-11-08T23:22:08 | plan-write-failed | evt_23e2976e | plan-version-conflict | K2 |
| 13 | 2026-11-09T08:37:22 | handoff-write-failed | evt_23e2976e | 判据门 H1 | K3 |

**统计（实测复算）**：

| 口径 | 值 |
|---|---|
| 总条数 | **13** |
| 唯一 idemKey | **5**（K1..K5） |
| 按 kind | plan-write-failed **6** / handoff-write-failed **7** |
| 按原因 | plan-version-conflict **5** / plan-card-format **1** / 判据门 H1×6 / H1/H2×1 |
| 分布事件数 | **6 个不同事件**（evt_89786878 / evt_761ad9ff / evt_882dee05 / evt_4d65008f / evt_8180305e / evt_23e2976e） |
| at < 2026-11-05（#543 前） | **9** / ≥ = **4** |

> **订正任务书**：「13 条（10-25 起 3 条 → 11-09 已 13 条）」✅；「plan-version-conflict 6 次」❌ 实为 **5 次**（+ plan-card-format 1 次 = plan 系共 6 条）；「判据门 H1/H2 7 次」✅。

#### 4.1.4 已有方案：DESIGN-MEMORY-TOOL-CONTRACT-20261029.md §2.2 的 P0-1

**已读（:79-111），可直接采用，且已有实测支撑**：

```
### 2.2 P0-1：WAL 半渡态（真缺陷，必须前置）
现状（lib/index.js L21953-22010）：
Phase 1  appendHandoffCheckpointPre(...)   ← 先写事件，零内容校验
Phase 2  writeHandoffLedger(...)           ← 再过判据门，不合格 ok:false
Phase 3  失败 → 追加 kind='handoff-write-failed' 补偿检查点
方案：Phase 0 前置预检（纯函数，零 IO）
```

该文档给出三张「已逐个实测验证」的约束表（:108-111）：① 判据门是纯函数（wb-contract.js 只 import node:crypto 与 handoff-anchor.js）；② 前置判定与 Phase 2 判定**7 个用例零翻转**；③（原文续）。

⇒ **本报告结论：P0-1 方案可直接采用，不需要重新设计。** 2.8 的增量只有两点：

1. **区分「可预期」与「意外」**（见 4.2.1）—— P0-1 覆盖前者，后者仍需留痕；
2. **现存的 6 条 plan 系失败里，5 条是 plan-version-conflict** —— 这类**前置预检救不了**（冲突要读盘+比对 revision 才知道），需要另一种处置（见 4.2.1 第②类）。

### 4.2 2.8 的判断

#### 4.2.1 「可预期 vs 意外」分类判据（4.2 交付要求③）

**判据（三条，按顺序判）**：

| # | 判据 | 可预期 | 意外 |
|---|---|---|---|
| **① 纯函数可判** | 失败原因能由「入参文本 + 当前配置」**在不读盘的情况下**判定（判据门 H1/H2、plan-card-format、格式校验） | **✅** → **写盘前拦** | ✗ |
| **② 读盘可判且可复现** | 需要读盘但**结果确定**（plan-version-conflict：读 PLAN.md 算 revision 与 expectedRevision 比） | **✅** → **写盘前拦**（Phase 0 多一次读盘） | ✗ |
| **③ 其余** | 磁盘错误、权限、JSON 损坏、进程被杀、并发写冲突（短时间内 revision 变了两次） | ✗ | **✅ → 留痕** |

⇒ **判定表**：

| 失败类 | 归类 | 处置 |
|---|---|---|
| 判据门 H1/H2（7 条） | **① 可预期** | **Phase 0 前置拦**（P0-1 方案，零 IO） |
| plan-card-format（1 条） | **① 可预期** | **Phase 0 前置拦**（checkPlanCriteriaPre 同族） |
| plan-version-conflict（5 条） | **② 可预期·需读盘** | **Phase 0 预检**（读 PLAN.md 算 revision；不一致**直接返回可执行指引**，不写事件） |
| plan-card-duplicate-id / plan-user-region-protected / M2/M3 | ② 可预期·需读盘 | 同上（都是一次读盘可判） |
| 磁盘 ENOSPC / EACCES / JSON 解析失败 / 进程中断 | **③ 意外** | **保留 Phase 3 留痕**（这是真正需要证据的场景） |

#### 4.2.2 Phase 0 预检的具体落点（4.2 交付要求②）

**落点**：lib/index.js **:25115 之前**（即 WAL 三步注释块开始之前、const writeH 之后）。伪代码（不落地）：

```
// ── Phase 0：预检（纯函数 + 一次读盘，全部在 Phase 1 之前）──
//   目的：把「可预期失败」挡在事件库之外 —— 现状是「坏正文先入库、事后补失败标记」，
//   而检查点 append-only ⇒ 那个坏正文**永久留在事件库里**。
const pre = args.kind === 'plan'
  ? await engine.precheckPlanWritePre(p.projectDir, writeH, { expectedRevision: args.expectedRevision })
  : await engine.precheckHandoffWritePre(writeH)
if (!pre.ok) {
  // 分两类返回：① 纯判据失败 ⇒ 给「怎么改」；② revision 冲突 ⇒ 给「重新 read 再改」
  return 'memory_note: ' + pre.text     // ← 一次都不写（事件/文件都不动）
}
// ── Phase 1/2/3 保持原样 ──
```

**Phase 0 必须满足的三条（沿用 P0-1 的实测结论）**：

1. **纯函数优先**：H1/H2 判据门、card-format 都是纯函数（wb-contract.js 零 IO）；
2. **读盘只读一次、且与 Phase 2 用同一份口径**（P0-1 实测「7 个用例零翻转」的前提是「用 fullText 口径构造」）；
3. **预检失败不得改变任何状态**（不写事件、不写 .md、不动 state）。

#### 4.2.3 现存 13 条怎么处置（4.2 交付要求④，注意 append-only）

| 选项 | 内容 | 评价 |
|---|---|---|
| **A. 保留**（推荐） | 13 条原样留在事件里，不迁移、不删除 | 符合 append-only 契约（event-store.js:914）；**它们是有价值的历史证据**（记录了 5 类真实失败）；体积极小（13 条 ≈ 1,441 字符，占库 0.0138%） |
| B. 迁移 | 移到某个「写入失败台账」事件 | **违反 append-only**（检查点不能跨事件搬），且要新写迁移原语 ⇒ **不建议** |
| C. 清理 | 删掉 | **违反 append-only + 丢证据** ⇒ **禁止** |
| **D. 附录（推荐与 A 并行）** | 在 2.8 施工文档里附一张「历史失败台账」表（本报告 §4.1.3 即是） | 零代码改动，可追溯性反而更强 |

⇒ **建议 A + D**：库里保留、文档里立台账、**以后不再新增可预期失败**。

#### 4.2.4 负路径：真正的意外失败仍须留痕

**判据的可执行形态**（写进 Phase 0 的实现注释，而不是靠人判断）：

```
// Phase 0 只拦「**我们明确知道该怎么办**的失败」。
// 不在名单内的异常一律继续走 Phase 1→2→3：
//   · 任何 throws（IO / JSON / 权限 / 进程信号）
//   · 任何 code 不在 PREKNOWN_CODES 里的 r.ok=false
// ⇒ 即：**Phase 0 是白名单**（已知可拦），不是黑名单（未知放行）。
const PREKNOWN_CODES = new Set([
  'plan-version-conflict', 'plan-card-format', 'plan-card-duplicate-id',
  'plan-user-region-protected', 'criteria', 'mutation',
])
```

**为什么必须是白名单**：黑名单（「除 X 之外都留痕」）一旦有新失败码上线，就会被**静默归入「意外」** ⇒ 继续污染事件库。白名单的失败姿态是**保守**的（未知 ⇒ 留痕），与「宁可留证据」一致。

### 4.3 2.8 与 2.6 / 2.7 的交叉影响（必须一起定）

| 交叉点 | 影响 |
|---|---|
| **2.6 改了归属** | Phase 3 的 eventId: walEventId 会落到「新建的项目容器事件」而不是磁铁 ⇒ **失败标记的分布也会变**（从 6 个事件变成集中 1-2 个） |
| **2.7 改存摘要** | 失败标记的 idemKey 本来就是「失败标记正文 sha」；而**救援检查点仍带全文** ⇒ 失败路径体积不变、成功路径大降 |
| **2.8 加了 Phase 0** | Phase 1 的执行次数大幅下降（可预期失败不再进 Phase 1）⇒ 2.7 的「全文入库再失败」场景减少 **7/13 = 53.8%** |
| **三者合起来** | 事件库增长速率 = （每轮 1 条 log）+（每次 handoff/plan 1 条**摘要**）+（**仅意外失败**才 1 条全文/标记）⇒ 按当前节奏，**全文占比从 64.43% 降到个位数** |


---

## 5. 架构借鉴评估（按任务书 §五，逐条给「采用 / 不采用 / 部分采用」+ 理由）

### 5.0 先确认边界（实测复算，与任务书一致）

任务书说「原型代码里 event-store / eventStore / resolveActiveEvent / appendCheckpoint 全部 0 次命中」。**实测复核**：

| 关键词 | prototypes/sidecar-store/ 命中 |
|---|---|
| event-store / eventStore | **0** |
| resolveActiveEvent | **0** |
| appendCheckpoint | **0** |
| checkpoint（作为原型自身的压实检查点） | 若干（journal 压缩用，与事件库无关） |

⇒ **确认：原型管的是 handoff/index.json（白板索引），不是事件库**。下面三条都按「借鉴架构思路、不搬代码」评估。

### 5.1 ① 模块化

**原型做了什么**：5 个文件拆「存储 / 状态 / 编解码 / 适配器 / 入口」，每个只做一件事（sidecar-store.js 是 public boundary、markdown-adapter.js 只做解析、journal-storage.js 管持久化、codec.js 管序列化与哈希、index-state.js 管变更归一）。

**现状对照**：WAL 逻辑挤在 **event-write.js（866 行）+ index.js（29,263 行）** 两处；写入口有 4 条（memory_log 内联 / memory_note Phase 1 / memory_note Phase 3 / mirrorPlanSectionsPre），**各自拼检查点字段**。

**评估：部分采用（只抽 1 个模块，不抽 5 个）**

| 建议 | 抽不抽 | 理由 |
|---|---|---|
| 抽「事件写入口」模块（如 lib/event-write-api.js） | **✅ 抽（推荐）** | 三项的改动都落在「写入口」这一点：2.6 是归属、2.7 是正文形态、2.8 是失败前置。**不抽的话，同一条 Phase 1 要改三次** |
| 抽「存储」模块 | ❌ 不抽 | 已有 event-store.js（1,081 行）承担，再抽是重复 |
| 抽「编解码」 | ❌ 不抽 | 事件库是纯 JSON（schema/events/updatedAt），无编解码层；硬抽是过度设计 |
| 抽「适配器」 | ❌ 不抽 | 白板/账本两种适配器差异极小（都是 markdown），抽出来只有 2 个实现，收益 < 成本 |

**不抽的理由必须写清**：原型拆 5 个文件的前提是**它有 5 种真实变化方向**（存储后端可换、格式版本可升、适配器多源）；本仓事件库是**单一 JSON + 单一写入口族**，拆 5 个只会增加跳转成本。**唯一值得抽的是「写入口 API」** —— 因为三项全在它上面。

### 5.2 ② 系统化（成文协议）

**原型有什么**：expectedState CAS、replaceSources 的「一次事务可替换一个或多个 source」、同 ID 更新保留原位置、删除保留墓碑 —— 都是**写进注释且被 codec/state 层强制的协议**。

**现状**：WAL 的协议**散在注释里**（lib/index.js:25115-25135 的 20 行注释 + event-write.js:685-762 的 30 行注释），**没有一处成文、没有一处被校验**。

**评估：采用（必须成文，这是三项的前置）**

**需要先成文的协议（4 条，按优先级）**：

| # | 协议 | 内容 | 现在有吗 |
|---|---|---|---|
| **P-1** | **归属协议** | 「什么文档归到哪个事件」：plan/handoff 是**项目级文档**，归属顺序 =（a）显式 eventId >（b）配置的容器事件 >（c）最近 active 兜底；**不得**用主题匹配 | ❌ 只有「最近 active」 |
| **P-2** | **正文协议** | 「检查点里存什么」：log 类存正文；plan/handoff 类存**摘要 + 指针 + 指纹**；正文真源是 .md | ❌ 存全文（64.43%） |
| **P-3** | **失败协议** | 「什么算可预期失败」：白名单 PREKNOWN_CODES；白名单内 **Phase 0 拦**，白名单外 **Phase 3 留痕** | ❌ 一律留痕 |
| **P-4** | **指针回读协议** | 「摘要怎么还原成全文」：sourceRef + panels 指纹；三种失败（missing/drift/legacy）各有明确 code | ❌ 无 |

> **判据**：这 4 条协议**必须写进施工文档或模块头注释**，并且**每条配一个可执行断言**（否则又变成「散在注释里的约定」）。例：P-1 配「plan 快照的 eventId 必须是容器事件 id」；P-2 配「plan 检查点 text.length ≤ 400」；P-3 配「PREKNOWN_CODES 命中时事件库检查点数 +0」；P-4 配「降级后回读 == 原文」。

### 5.3 ③ API 化（对外少量语义化 API）

**原型有什么**：SidecarStore.open({directory, workspaceKey, parserVersion}) + replaceSources / loadView / findByTag / close —— **调用方不碰磁盘格式**（sidecar-store.js:41-45 逐字：「No caller handles disk format, inverted maps, locks or generation publication」）。

**现状**：写入口是「各调用方自己拼检查点字段再写」：

- memory_log：内联 IIFE 自己算归属 + 自己拼 {kind:'log', at, text, panels, idemKey}（lib/index.js:24573-24589）
- memory_note Phase 1：自己拼 {ledgerText, kind, userPercept…}（:25144-25155）
- memory_note Phase 3：自己拼失败标记正文（:25176-25181）
- mirrorPlanSectionsPre：自己解析四段（event-write.js:783-793）
- curate / apply：又是一套

**评估：采用（这是三项的共同解法 —— 任务书 §5.1③ 的猜测成立）**

**推荐 API 形态（1 个函数 + 1 个入参对象，覆盖 4 条调用路径）**：

```
// lib/event-write-api.js（新模块，约 120 行；只做编排，实现仍调既有原语）
/**
 * 事件检查点的唯一写入口。
 * 调用方不关心：WAL 分几阶段 / 检查点字段叫什么 / 归属怎么判 / 失败怎么留痕。
 *
 * @param {object} p
 * @param {'log'|'handoff'|'plan'} p.kind        内容形态
 * @param {string} p.content                    正文（全文，函数内部决定存全文还是摘要）
 * @param {string} [p.eventId]                  显式归属（缺失时按 P-1 协议解析）
 * @param {string} [p.sourcePath]               真源路径（用于 2.7 的指针）
 * @param {object} [p.percept]                  userPercept/agentTrace/sharedGround/commitment
 * @param {string} [p.idemKey]                  幂等键（缺省由 kind + content 推导）
 * @returns {Promise<{ok:boolean, eventId:string, checkpoint:{mode:'full'|'summary'}, deduped:boolean}>}
 */
export async function appendEventNotePre(storePath, p) { … }
```

**为什么这一个 API 能覆盖三项**：

| 项 | 落在 API 的哪一处 |
|---|---|
| 2.6 归属 | p.eventId + 内部 P-1 协议（不再由每个调用方自己 resolveActiveEventPre） |
| 2.7 正文 | 内部按 p.kind 决定 mode（full / summary）+ 写指针（调用方只传 content + sourcePath） |
| 2.8 失败 | API 内部保证「Phase 0 失败 ⇒ 不写事件；意外失败 ⇒ 写标记」，调用方**不再管 Phase 1/3** |

⇒ **采纳，但有一个前提**：**不要在 2.6 就一次性把 4 条路径全搬进新 API**。建议顺序：

1. 2.6 先让 API 承接 memory_note 两条（Phase 1 + Phase 3）；
2. 2.7 在 API 内部加 mode 分支；
3. 2.8 在 API 内部加 Phase 0；
4. memory_log 的内联版**最后**搬（它是抽取式测试的靶子，动了要同批改 h1b 套件的形参表）。

### 5.4 明确不可借用（复核任务书 §5.2，逐条确认）

| 原型有的 | 为什么这里用不上 | 复核结论 |
|---|---|---|
| expectedState CAS | 2.6 要解决「归属判错」，不是「并发写冲突」 | ✅ 同意。且事件库已有 withStoreChainPre + withStoreFileLockPre（event-store.js:487 / :472） |
| journal 增量追尾 + 压实 | 2.7 要解决「内容不该进检查点」，不是「写得慢/写得大」 | ✅ 同意。且压实前提是「有日志可合并」，事件库是 append-only 事件，压实 = 改历史 |
| by_tag / by_cue 倒排 | 与事件库无关 | ✅ 同意（那是白板索引的检索维度） |
| importLegacy 旧格式迁移 | 2.7 若选降级为指针，需要的是**回读通道**，不是格式迁移 | ✅ 同意 |
| withSharedStateLock | 仅当 2.6 改动后两条写路径可能并发时才用得上，需先判定是否真并发 | ⚠ **部分需要**：memory_note Phase 1 与 Phase 3 **已经是同一个 storePath 的两次 append**，由 event-store 的链 + 文件锁串行化 ⇒ **不需要新锁**。只有把 Phase 1 拆成「写摘要 + 写指针」两次时才需要保证两次在同一事务 —— 那时应复用 mutatePre（一次事务写两条）而**不是**新锁 |

---

## 6. 三项的施工顺序与依赖（基于测绘结论重排）

### 6.1 原顺序 2.6 → 2.7 → 2.8 是否仍成立？

**成立，但 2.6 的范围要扩大**（多一条：先立「归属协议 + 写入口 API」骨架）。

| 顺序 | 项 | 为什么必须在这个位置 |
|---|---|---|
| **0** | **立协议 + API 骨架**（§5.2 的 P-1/P-2/P-3/P-4 成文 + lib/event-write-api.js 空壳） | 三项全都改 Phase 1 那一段；不先定骨架，就要改三次同一处 |
| **1** | **2.6** 归属统一（memory_note 补 eventId + 容器事件协议） | 归属决定「检查点落在谁身上」；2.7 的摘要/指针、2.8 的失败标记都依赖它 |
| **2** | **2.7** 正文形态（摘要 + 指针 + 回读） | 依赖 2.6 的 eventId（失败救援要挂对事件）；2.7 改完后 2.8 的「救援检查点」才有正确归属 |
| **3** | **2.8** 失败前置（Phase 0 白名单） | 依赖 2.6 + 2.7。**放最后**因为它会减少 Phase 1 的执行次数 —— 若先做 2.8，2.7 的收益会被「少测一批真实失败路径」掩盖 |

### 6.2 依赖图（含跨批次）

```
[前置] 2.1 / 2.2（已完成 2026-11-09）
   ├ 2.1 建事件带 goal 首段 —— 2.6 的「容器事件」需要 goal 才能被认出
   └ 2.2 kind 推断 —— 2.6 的容器事件会是 kind = ledger / planSnapshot
        ↓
[前置] 写入口 API 骨架（新增，来自 §5.3）
        ↓
  2.6 归属统一 ──→ 2.7 正文形态 ──→ 2.8 失败前置
        ↓                ↓                ↓
   （可选）memory_log 内联版迁移（最后，需同批改 h1b 套件形参表）
```

### 6.3 每项的验收判据（可复算，供施工时直接抄）

| 项 | 判据 | 复算方式 |
|---|---|---|
| **2.6** | ① memory_note 参数表含 eventId（17 → 18 个）；② 真调 memory_note(kind=plan, eventId=X) ⇒ 检查点落在 X（读盘断言）；③ **负路径**：不传 eventId 时行为与旧版逐字节相同（同一夹具两次写入，落到的 eventId 相同） | 真 import + 真调 + 读 event-store.json |
| **2.7** | ① 新建 plan 检查点的 text.length ≤ 400（现平均 10,702）；② sourceRef 非空率 100%（现 14%）；③ **回读**：降级后取回内容 == 磁盘 .md（逐字节）；④ **负路径**：指针缺失 / 漂移各返回明确 code，不返回错版本；⑤ 召回不塌：同一 query 的命中事件集合在改造前后 ≥ 95% 重合 | 真 import event-recall 对比；真读 .md 比对 |
| **2.8** | ① 13 条历史标记**一条不少**（读盘计数 13）；② 构造 H1 缺标题的 handoff ⇒ 事件库检查点数 **+0**（Phase 0 拦住）；③ 构造意外失败（如只读目录）⇒ 检查点数 **+1**（留痕）；④ PREKNOWN_CODES 之外的 code ⇒ 留痕 | 沙箱真跑 3 组 |

---

## 7. 风险与未测（诚实清单）

### 7.1 未测项（本报告**没有**验证的）

| # | 未测 | 为什么没测 | 影响 |
|---|---|---|---|
| U1 | **plan-version-conflict 的 5 次是否真的「可预检」** | 需要知道每次失败时 PLAN.md 的 revision 与 expectedRevision 当时的值 —— append-only 没有记录 | 若某次是「并发窗口内两次改」⇒ 属意外，不该前置拦。**需施工时按新逻辑灰度观察** |
| U2 | **2.7 摘要后召回质量是否下降** | 需要真实 query 集 + 打分器跑 A/B；本报告只测了「语料体积构成」 | 摘要把语料从 1,090,665 降到约 476,503（−56.3%）⇒ **可能损失召回**。**必须在施工时做 A/B** |
| U3 | **原型的同 ID 更新保留原位置能否用于 2.7 的指针更新** | 原型管白板索引，事件库无「位置」概念 | 无影响（已判不采用） |
| U4 | **写入口 API 抽出来后 h1b 套件的抽取管道是否还成立** | 取决于 API 是否保留 new Function 可求值的字面形态 | 需要施工首日就验证，否则会「先抽后炸」 |
| U5 | **#543 之后 74 条 log 检查点各自的真实归属路径** | append-only 不记录判定原因（见 2.2.1） | 只能给 4 种可能，**不能定量** |
| U6 | **sourceRef 有值的 28 条为何 byteMatch=0** | 需要核对历史文件名与内容（时间戳后缀不可逆推） | 只影响「指针能不能复用现有 sourceRef」的判断，已按「不复用、新写指针」处置 |

### 7.2 风险

| # | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| R1 | **按任务书原话「把 #543 的门接上 memory_note」会制造碎片** | 直接搬 L1 / 负证据 / 词袋 | 本报告 §2.2.3 用 fanout 实测挡掉（98/163 零交集 ⇒ 60.1% 会新建） |
| R2 | **2.7 降级导致召回塌方** | 只改写入、不做回读 + 不做 A/B | 「降级只对新写入生效、存量不动」+ 施工时 A/B 召回 |
| R3 | **2.8 的 Phase 0 变成黑名单** | 写成「除 X 外都拦」或反之 | 强制白名单 PREKNOWN_CODES + 一条「未知 code ⇒ 留痕」的断言 |
| R4 | **改 memory_log 内联版会打红 h1b 套件** | 在内联 IIFE 里引用任何模块级符号 | memory_log 的迁移**放最后**，且同批改套件形参表（本仓已踩过：lib/index.js:24506-24510 注释逐字记录） |
| R5 | **多 agent 并行改 event-write.js** | 2.6/2.7/2.8 若分给三个人同时改同一文件 | 按 §6.1 顺序串行；或用 API 骨架先隔离（每人改 API 内部不同函数） |

### 7.3 本报告的自我约束声明

- **只读**：未改 lib/ / tests/ / tools/ / 真实记忆数据；脚本在 artifacts/_survey-268-20261110/scripts/，产物在 artifacts/_survey-268-20261110/data/。
- **数据源**：任务书指定快照（sha256 已复算 = 2F081175…）；真实 store 仅作交叉校验（只读）。
- **本机坑**：未使用 os.tmpdir()（该沙箱返回 undefined 加 temp 的相对路径陷阱）；全部用工作区内相对路径。
- **行号**：全部为本轮实测；与任务书不一致处已在 §0.1 / §2.1.3 / §3.1.5 逐条标注漂移量。
- **未照抄**：任务书 §1.3 的 10 个数字逐条复核，3 处口径差异 + 1 处错误已列（§0.1）。

---

## 8. 一句话结论

**2.6 不是「补一个门」，是「补一条显式通道 + 立一份归属协议」；2.7 不是「没人读的冗余」，是「占召回语料 61.81% 的双份全文」——降级必须配回读；2.8 的 idemKey 去重其实有效，真正要修的是「可预期失败不该进事件库」。三项的共同解法不是再抽 5 个模块，而是给写入口定一层 API + 四条成文协议。**

