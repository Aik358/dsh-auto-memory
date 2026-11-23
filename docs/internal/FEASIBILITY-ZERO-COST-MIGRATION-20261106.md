# 零额度迁移（归档旧白板，仅迁移重要内容）· 可行性调查报告

> 2026-11-06 · 分支 preview · **本文件只出调查结论，未改任何代码**
> 对应需求：用户 5 条原话（①归档仍可召回 ②白板从零开始 ③保留反思/规约/用户约定 ④向导加按钮 ⑤随时仍可调子代理 upgrade）
> 纪律：每条结论带 file:line；凡未实测者显式标注「推测，未验证」

---

## 0 · 总判定

**整体可行**（5 条需求全部有实现落点），但有两处**必须先补的地基**才能叫「零额度」：

| # | 用户需求 | 判定 | 一句话依据 |
|---|---|---|---|
| ① 归档旧白板、仍能召回 | **可行，但当前召回面只有 20 篇窗口** | lib/index.js:5614 只扫 archive 下 **20 篇**白板归档；lib/index.js:13032 的 scope=archive **完全不看** handoff/archive |
| ② 白板从零开始 | **可行，已有现成兜底** | lib/index.js:4750 ensurePlanBoardPre + lib/index.js:4774 skeletonPlanTextPre，骨架必过 P-H1 |
| ③ 保留反思/规约/用户约定 | **可行，且它们本来就不走事件库** | lib/index.js:8773 反思、lib/index.js:12016-12017 用户级/项目笔记，全走**文件直读**；规约由 lib/rules-layer.js:574 只按锚点判 |
| ④ 向导加按钮 | **可行，落点明确** | lib/client.js:9095-9100 第 1 页 btnRow |
| ⑤ 随时仍可调出子代理 upgrade | **可行，且与归档无耦合（已读码确认）** | lib/team-baseline.js:472 phase 非 running 即可 start；lib/rules-layer.js:557-559 legacy 只统计 userText+notesText，不含 PLAN.md |

**「零额度」这个措辞需要修正**：归档动作本身是纯 IO（零 LLM），但「保留重要内容」若指「把每日日志也事件化」，那仍然要花额度。本报告的可行方案 = **白板零额度归档 + 其余文件形态内容原样保留**，不是「事件化但不花钱」。

---

## A · 现有能力盘点

### A1 · 白板归档能力：已完整存在，两套实现

**实现 ①（引擎写盘口，PLAN.md 每次重写都会先归档）**
- lib/index.js:4812  `async writePlanSnapshot(projectDir, content, opts)`
- lib/index.js:4873-4878：当 existing 非空且与 incoming 不同时，`archived = await archivePlanPre(archDir, PLAN- + handoffStamp(), existing)`
- lib/index.js:4892-4898：P7 老化 —— 标题命中 `/^## .*(历史|踩坑|流水线要点)/` 的节另存 `PLAN-history-<ts>.md`
- 底层 lib/plan-store.js:176-181 `archivePlanPre(dir, base, text)`：文件名 `base + - + randomUUID() + .md`，`flag:wx` 防覆盖
- `handoffStamp()` 定义 lib/index.js:1563-1566，格式 YYYYMMDD-HHMMSS（本地时区）

**实现 ②（升级 applier 专用，同语义另一份）**
- lib/upgrade-apply.js:501-516 `async function archivePlanPre(handoffDir, oldText, now)`
- lib/upgrade-apply.js:55-56 `export const PLAN_ARCHIVE_DIRNAME = archive`
- lib/upgrade-apply.js:778-793：调用点 —— 先读旧白板、算旧锚点数 → 归档 → **读回校验 sha256 一致 + 锚点数一致**，任一不符即 `failZone(plan-archive-failed)` 并整区回滚

**注意：两处 archivePlanPre 命名不同**
- plan-store.js:178 → `PLAN-<ts>-<uuid>.md`
- upgrade-apply.js:508 → `PLAN-<ts>.md`（`writeFile flag:wx`，同秒冲突加 -b/-c 后缀，见 upgrade-apply.js:506-515）

两者都能被 listHandoffLedgers 的正则匹配（见 A2），但**新增功能不要另写第三份归档函数** —— 直接调 plan-store.js:176 那份。

**归档产物落点**：`<projectDir>/handoff/archive/`（lib/datadir.js:206 `archiveDir()`；lib/datadir.js:134-148 LAYOUT 常量）。

**实测（本工作区）**：handoff/archive/ 共 325 个 .md，其中 322 个匹配归档正则；全部是 PLAN-* 类型。

---

### A2 · 归档能否被召回：能，但**两个通道的覆盖面差异极大**（需求①的核心风险）

#### 通道 1：memory_recall(scope=handoff) → searchHandoffCorpus → 能召回，但只有最近 20 篇

- 路由：lib/index.js:12819-12825  `if (scope === handoff) { const hits2 = await this.searchHandoffCorpus(terms, limit, p) ... }`
- 白板归档扫描点：lib/index.js:5614-5617
  `for (const n of await this.listHandoffLedgers(path.join(p.handoffDir, archive), 20)) { ... await scan(白板归档/ + n, ...) }`
- 名单函数：lib/index.js:5519-5523，正则 `/^(?:handoff-\d{8}-\d{6}(-[a-z])?|PLAN-(?:history-)?\d{8}-\d{6}(?:-[a-z]|-[0-9a-f]{8}-...)?)\.md$/`

**实测（真执行，非静态断言）**：用 `new Function` 抽出 searchHandoffCorpus + listHandoffLedgers + listPrevSessionTranscripts 真实体，注入 path/readdir 与 readTextSafe，对本机真实工作区执行：
- 取 archive 中一行**当前 PLAN.md 里不存在**的文本作 query ⇒ **命中**，返回
  `{"where":"白板归档/PLAN-history-20260922-023742.md","matches":["- **设置页 B1（9 分区骨架）已落地并全量绿**…"]}`
- ⇒ **归档后确实还能召回**，需求①在「最近 20 篇」范围内成立。

**但窗口缺口是实测的**：
- `listHandoffLedgers(archive, 20)` 只取字典序倒序前 20（lib/index.js:5521 `.sort().reverse().slice(0, limit)`）
- 本机 archive 里可匹配 322 篇 ⇒ **302 篇（93.8%）落在窗口外**
- 窗口内的 20 篇还包含 4 个 PLAN-history-*（字典序 P-H > P-2，排在最前）

**结论**：归档后**不是永久可召回**，是「最近 20 篇可召回」。若不改这个常量，用户归档后过一段时间（>20 次白板重写）就再也搜不到。**需求①要真正成立，必须把 lib/index.js:5614 的 20 改成按需/更大窗口，或给归档单独开检索通道。**

#### 通道 2：memory_read(kind=archive) / memory_recall(scope=archive) → 完全不覆盖 handoff/archive

- lib/index.js:17657-17673 `listArchivePre`：`const dir = path.join(p.projectDir, archive)`
- lib/index.js:17682-17712 `readArchivePre`：同样 `path.join(p.projectDir, archive)`，且强制裸文件名 + .md
- lib/index.js:13032-13062 `scope === archive` 分支：`const dirA = path.join(pA.projectDir, archive)`

**路径口径陷阱**：这里说的 archive 是 **projectDir 下的 /archive**（本机 = `.../--D--dsh-auto-memory--/archive/`，放的是 30 天前旧日志 + notes-archived.md），而白板归档在 **projectDir/handoff/archive/**。两者是**不同目录**。
- 实测本机：`.../archive/` 里是 42 个 YYYY-MM-DD.md + notes-archived.md（1,169,419 B）；`handoff/archive/` 才是 325 个 PLAN-*.md。
- ⇒ **memory_read(kind=archive) 永远读不到旧白板**。如果按钮文案写「归档后可用 memory_read(kind=archive) 取回」，那是**错误承诺**。

---

### A3 · 每日反思 / 项目规约 / 用户约定 三类内容：全部是文件形态，不经事件库

| 类别 | 载体文件 | 载入点 | 注入点 |
|---|---|---|---|
| 每日反思 | `<projectDir>/reflections/YYYY-MM-DD.md` | lib/index.js:8773-8779（listReflections(reflectDir,1) 取最新，readTextSafe 直读） | lib/index.js:11974-11976 `part(memoryReferences, reflection, ... reflectionDigest(...))` |
| 用户级约定（跨项目规约） | `<userDir>/MEMORY.md` | lib/index.js:8743-8746 `readTextSafe(p.userFile)` → state.userText | lib/index.js:12016 `part(..., user-memory, ... s.userText ..., must, tail)` |
| 项目规约 | `<projectDir>/MEMORY.md` | lib/index.js:8743-8746 `readTextSafe(p.notesPath)` → state.notesText | lib/index.js:12017 `part(..., project-notes, ... s.notesText ..., must, tail)`；另 lib/index.js:11202-11226 经 extractRulesLayerPre 提出规则层单独注入 |

**关键点**：三者都是 refresh() 里的**纯文件读取**，与 event-store.json **零耦合**。事件库为空/不存在时它们照常注入。
- 规约提取 lib/rules-layer.js:225 `extractRulesLayerPre`，输入只有 `{userText, notesText, rulesLayeringMode}`（lib/index.js:11204-11208），**不读事件**。

---

## B · 需求可行性分项

### B1（需求③）不经过子代理，这些内容也能被新版本正确加载吗？—— 能

- 反思：lib/index.js:8773-8779 读 + lib/index.js:11974 投，**与迁移无关**。
- 用户约定：lib/index.js:8746 读 + lib/index.js:12016 投，且 priority=must（lib/index.js:11978-11981 注释明写「任何额度不足都不得先牺牲它们」）。
- 项目规约：lib/index.js:8746 读 + lib/index.js:12017 投 must；规则层 lib/index.js:11202-11226。

⇒ **需求③天然成立**，无需任何迁移动作。唯一注意：这些段的**档位门控**在 lib/index.js:12013-12014（_EVIDENCE_LAYER_TIERS = LEGACY | HUMAN_FULL | HANDOFF_CARRY | POST_COMPACT）—— run_full / human_slim 两档**不投** user-memory / project-notes（lib/index.js:11995-12012 用户裁定 H11）。这不是迁移带来的限制，是既有档位设计。

### B2（需求②）把旧 PLAN.md 归档后，会不会因为「找不到白板」报错/降级？—— 不会，兜底完整

三条兜底：

1. **注入侧零字节跳过**：lib/index.js:11459 判 (cfg.handoffEnabled !== false && (s.planText || s.latestHandoffText) && _planSpec.inject) ⇒ planText 为空则整段不 push（零字节纪律，同族见 lib/index.js:11740）。
2. **全局账本指针兜底**：lib/index.js:11766-11768 —— 当 !s.planText && !s.latestHandoffText && s.globalLedgerPath 时 pushPart(otherDynamic, handoff-pointer)，注入「全局最近交接账本: <绝对路径>」。
3. **白板骨架自动首建**：lib/index.js:4750-4771 ensurePlanBoardPre(projectDir)
   - lib/index.js:4763 已有内容则 return { ok: true, skipped: exists }
   - lib/index.js:4764 writePlanSnapshot(projectDir, this.skeletonPlanTextPre(), { createOnly: true })
   - createOnly 语义在 lib/plan-store.js:214：opts.createOnly && current 时直接返回 skipped:exists，不写盘
   - 骨架正文 lib/index.js:4774-4789：含「## 这是什么」（type:state）+「## 进度与下一步」（type:progress），必过 P-H1（lib/wb-contract.js:647-661；阈值 sectionMinChars:20 见 lib/wb-contract.js:517-522）
   - 触发点：lib/index.js:21755（agent/turn-stopping 里调用 engine.ensurePlanBoardForAgentPre(agent)）⇒ **下一轮结束就自动重建骨架**

⇒ **「白板从零开始」= 归档后下一轮自动长出骨架**，用户看到的是占位白板（标题「# 项目全貌（自动建立 · 待模型重写）」），不是空面板、不报错。

**但「从零」有个副作用**：骨架一旦写下，s.planText 非空 ⇒ 注入侧「全局账本指针」兜底（lib/index.js:11766）不再触发。可接受（骨架比指针更明确），但要在按钮说明里讲清。

### B3（需求⑤）归档动作会不会写状态导致向导之后无法再启动？—— 不会（前提是只加字段、不写 phase）

**现状（可复用的安全基线）**：
- 状态文件：lib/index.js:10299-10310 upgradeStatePathPre → <userDir>/upgrade-state.json
- 读：lib/index.js:10318-10329（fail-soft，损坏返回空对象）
- 写：lib/index.js:10337-10351，**read-modify-write**（lib/index.js:10341-10342），不会冲掉 declined
- 启动判门：lib/index.js:10891-10947 startUpgradeJobPre
  - lib/index.js:10903 判 this._disposed / lib/index.js:10904 判 this._subagents
  - lib/index.js:10914-10927 交给 judgeUpgradeJobRecoveryPre（定义 lib/team-baseline.js:468-500）
  - lib/index.js:10940-10946 写 phase=running, jobId, epoch 等
- **恢复判据**：lib/team-baseline.js:472 —— phase !== running 时直接 return { verdict:idle, action:start }
  ⇒ **除 running 外的任何 phase（含 done / failed / 自定义值）都判 idle 并允许 start**。
  ⇒ 归档动作**只要不写 phase=running，就绝不会挡住后续启动**。
- 前端 canUpgrade：lib/index.js:26923-26925 = legacy === true && 未 snooze && phase !== running；lib/index.js:26918-26922 注释明确「done 但 legacy 仍 true ⇒ 允许重跑」（#520 修过的迁移死锁）。

⇒ **结论：归档动作应写一个独立字段（如 planArchivedAt / zeroCostMigratedAt），不碰 phase。这样需求⑤ 100% 成立。**

**legacy 判据不会被归档影响**（关键澄清，已读码确认）：
- lib/rules-layer.js:574 structuralLegacy = !anchors
- anchors 来源 lib/rules-layer.js:557-559：userText + notesText 里的 memory:mem_<32hex> 锚点计数 —— **只统计 userText 与 notesText，不含 PLAN.md**
- ⇒ **归档清空 PLAN.md 不会把 legacy 从 true 翻成 false**，向导入口照常存在。
- 反过来的既有情况：若 MEMORY.md 有锚点而白板没有 ⇒ legacy=false ⇒ 向导本来就不弹（现状既有行为，不是本次引入）。

---

## C · 风险与坑

### C1 · 归档后再召回，注入面会不会膨胀？—— 不会，白板注入只读 PLAN.md

- 注入源：lib/index.js:8752-8756 —— this.state.planText = planTxt || （readTextSafe(p.planPath)，只读 PLAN.md 一个文件）
- 归档目录**不在任何注入源里**：全仓无 handoff/archive 的注入读路径
- 白板段预算：lib/index.js:11497-11512
  - 完整档 _fullTierBudget = max(injectBudgetChars 默认 8000, _slimBudget)（lib/index.js:11500）
  - 瘦档 _slimBudget = max(fullInjectSlimBudgetChars 默认 3000, 200)（lib/index.js:11498）
  - legacy 强制截流：lib/index.js:11509 _planBudget = min(base, 2400)；lib/index.js:11510-11511 单节上限压到 800
- 剥注释：lib/index.js:11519-11520 用 replace(/<!--[\s\S]*?-->/g, 空串) 剥掉全部 HTML 注释
- 按节白名单：lib/index.js:11565-11606 _truncatePlanBySectionsInline + lib/index.js:11605 truncatePlanByPriority 兜底；lib/index.js:11596 保证「裁剪后绝不比原文更长」
- ⇒ **归档只会让注入面变小**（旧白板 → 骨架），不会膨胀。

**真正的膨胀风险在另一侧**：若为「仍可召回」把 lib/index.js:5614 的 20 改大，searchHandoffCorpus 会**每篇整文件读入**（lib/index.js:5581 readTextSafe(filePath) 全文）。本机 322 篇 PLAN 归档，需评估耗时。建议改为「按文件名/时间先过滤再读正文」，或单独开 scope。**推测，未验证**（未实测放大窗口后的耗时）。

### C2 · 「归档了但用户以为丢了」的可观测性问题 —— 确实存在

现状：
- 面板侧有版本列表：lib/index.js:8300-8307 扫 handoff/archive 里匹配正则的 PLAN-*；lib/index.js:8362 planVersions: versions.slice(0, 30) ⇒ **旧白板最多只显示 30 条**，本机 325 篇 ⇒ 面板上也看不全。
- lib/index.js:8301 readdir(...).catch(() => []) ⇒ 目录不存在时不报错、静默空列表。
- **没有任何「你已归档 N 篇旧白板」的显式提示**。

⇒ 需要补的 UI 告知（需求④的说明文本必须覆盖）：
1. 归档**落点路径**（handoff/archive/PLAN-<ts>.md，绝对路径可复制）
2. **能怎么找回**（必须写对：memory_recall 的 scope=handoff 或直接读文件；**不能**写 memory_read(kind=archive)，见 A2 通道 2）
3. 「最近 20 篇可召回」这一限制（若不修 lib/index.js:5614）
4. 面板「历史版本」只列 30 条

### C3 · 归档动作会触发 M1 丢卡保护 —— 会降级警示，需显式传 archivedIds

- 门本体：lib/index.js:5434-5515 checkMutationPre
- M1 判据：lib/memory-mutation.js:100-111 —— unarchived = disappeared.filter(id 不在 archived 里)
- 降级：lib/index.js:5490-5500 —— 只有「仅 M1 不合格」才降级为警示照写（res.m1Downgraded=true）；M2/M3 任一不合格仍硬拒（lib/index.js:5486、lib/memory-mutation.js:114-157）
- archivedIds 入口：lib/index.js:4867 → lib/index.js:23640-23641 → lib/index.js:23691 writePlanSnapshot(..., { archivedIds: archIds, ... })

⇒ **归档式清零必须显式传 archivedIds = 旧白板全部卡 id**，否则走「丢卡警示」路径（虽照写，但会往模型侧吐一段「白板丢卡警示」文案，观感很差）。

### C4 · 两个 archivePlanPre 同名不同实现 —— 新增代码必须选对

见 A1。lib/plan-store.js:176（PLAN-<ts>-<uuid>.md）vs lib/upgrade-apply.js:501（PLAN-<ts>.md + -b/-c 后缀）。若新代码 import 错一个，归档文件命名会与既有 322 篇不一致，**可能导致 listHandoffLedgers 匹配不上而失去召回**（两者当前都能匹配，但将来改正则时会漏）。

### C5 · memory_read(kind=archive) 的目录指向会误导实现者

见 A2 通道 2。lib/index.js:17659 / 17684 / 13035 三处都是 path.join(p.projectDir, archive)。若实现者以为它涵盖 handoff/archive，会写出「归档了但读不到」的功能。

### C6 · 已排除的伪风险：legacy 判据翻转

- 初判担心「归档清空白板锚点 ⇒ legacy 翻 false ⇒ 按钮消失」。
- 读码后**排除**：lib/rules-layer.js:557-559 的 anchors 只从 userText + notesText 统计，PLAN.md 不参与。
- ⇒ 归档 PLAN.md 与 legacy 判定**无耦合**。

### C7 · lib/index.js:5614 的 20 篇窗口 —— 需求①的唯一致命缺口

已在 A2 实测（322 篇里 302 篇在窗口外）。这是本报告**唯一建议「必须先修才能宣传需求①」**的一项。

---

## D · 实现落点建议（只给方案，不写代码）

### D1 · 按钮加在哪

**唯一推荐落点**：lib/client.js:9095-9100 —— 向导第 1 页 renderPage1 的 btnRow(actions, [...])，现有 4 个按钮：
- lib/client.js:9096 稍后（data-dam-upgrade-snooze）
- lib/client.js:9097 本次不再提示（data-dam-wizard-dismiss）
- lib/client.js:9098 先只看体量（data-dam-wizard-dryrun）
- lib/client.js:9099 开始整理 →（data-dam-upgrade-start）

新增按钮插在 lib/client.js:9098 与 :9099 之间，属性建议 data-dam-wizard-archive-plan（沿用既有 data-dam-wizard-* 命名族）。

**为什么必须是这一页**：第 1 页是唯一同时展示「检测到 N 条记忆 / M 篇日志 / K 个事件」与「不整理会怎样」的页面（lib/client.js:9074-9093），用户在这里才有足够信息判断「我只想归档白板」。

**备选（不建议首选）**：lib/client.js:8691-8702 UpgradeDetectEntryPre 是常驻检测入口，出现在 6 处（lib/client.js:17981 / 20568 / 21605 / 23540 / 23695 / 24812）。它是「进向导」的壳，不承载业务按钮。

**前端工程纪律（本仓硬约束）**：
- lib/client.js 由 tools/build-iter5-skin.mjs 生成，有 R2 保护门。改完必须跑生成器，不能只改 lib/client.js。
- 改完必须跑 node tools/build-iter5-skin.mjs --check + 真执行 factory 的运行时守卫（项目规约「静态守卫不足以证明能加载」）。
- tests/smoke/smoke-test-upgrade-wizard-client.mjs:295-311 用 findAll 逐属性计数断言（R1–R4）。新增属性不会打破既有断言，但**需新增 R 条目覆盖新按钮**。

### D2 · 后端需要新增什么

**新增 1 条路由**（建议 POST /api/dsh-auto-memory/upgrade-archive-plan）：
- 注册位置：lib/index.js:27007 附近（API[memory-upgrade] 的 handler 之后），沿用 kind:exact
- API 常量表：lib/index.js:501-509（现已有 upgrade-status / upgrade-workspaces / upgrade-snooze / memory-upgrade 四条）；同时 lib/client.js:3971-3975 需镜像同键（守卫套件逐键对拍）
- 鉴权：照抄 lib/index.js:26981 isLoopbackRequest 检查

**新增 1 个引擎方法**（建议 archivePlanZeroCostPre(agent, opts)，与 writePlanSnapshot 同族，落在 lib/index.js:4812 附近）：

    ① resolvePaths(agent) 拿 projectDir / handoffDir / planPath
    ② readPlanPre(planPath)（lib/plan-store.js:55-63）；空则 skipped:no-plan
    ③ planCardsPre(oldPlan)（lib/plan-store.js:68）取全部 card id
    ④ archivePlanPre(handoffDir/archive, PLAN- + handoffStamp(), oldPlan)
       ★必须用 lib/plan-store.js:176 那份，与既有 322 篇命名一致
    ⑤ 读回校验 sha256(oldText) === sha256(readback)（照抄 lib/upgrade-apply.js:782-784）
    ⑥ writePlanSnapshot(projectDir, skeletonPlanTextPre(), { archivedIds: 全部旧 card id })
       ★带 archivedIds 才不会触发 M1 降级警示（lib/index.js:4867 / lib/memory-mutation.js:101）
    ⑦ writeUpgradeStatePre(agent, { planArchivedAt: Date.now(), planArchiveFile: rel })
       ★只加新字段，绝不写 phase（lib/index.js:10341 read-modify-write 保证不冲掉其他键）
    ⑧ 返回 { ok, archivedPlan:{file,sha256,cards}, recreated:skeleton, bytes }

**可选新增**：若决定同时「把日志摘要抽成事件」（这才会花额度），不要放在本路由里 —— 那违反「零额度」承诺。

**不建议复用 upgrade-apply.js 的 applier**：它要求 zone.events 草案 + 闸 1–7 校验（lib/upgrade-apply.js:11-13），而零额度路径**根本没有事件草案**。

### D3 · 与现有「子代理迁移」状态机如何共存

**核心原则：两条线共享同一个 upgrade-state.json，靠「互斥字段 + 不写 phase」共存。**

| 关注点 | 子代理线 | 零额度线 | 共存规则 |
|---|---|---|---|
| 状态文件 | <userDir>/upgrade-state.json（lib/index.js:10299） | 同 | 共用；写入一律走 writeUpgradeStatePre（lib/index.js:10337，read-modify-write） |
| 关键字段 | phase / jobId / epoch / startedAt / perWorkspace / runId / scope / agentOptions（lib/index.js:10940-10946） | **只新增** planArchivedAt / planArchiveFile，不写 phase | 零额度线**永不写 phase** |
| 是否在跑 | phase=running 且同世代在飞（lib/team-baseline.js:486-496） | 无「在跑」概念（同步 IO，毫秒级） | 零额度线**不需要**任何 running 标记 |
| 再次启动 | judgeUpgradeJobRecoveryPre：phase !== running ⇒ action:start（lib/team-baseline.js:472-473） | 不涉及 | 归档后 phase 原样保留 ⇒ **upgrade 按钮照常可点** |
| 前端 canUpgrade | legacy===true && 未 snooze && phase!==running（lib/index.js:26923-26925） | 不改 legacy / 不改 snooze / 不改 phase | **互不干扰** |
| legacy 判据 | !anchors on userText+notesText（lib/rules-layer.js:574 + :557-559） | 归档 PLAN.md **不影响** | 确认无耦合（见 C6） |
| 按钮可见性 | UpgradeWizardEntry 只在 canUpgrade 或 running 或 legacy 时显示（lib/client.js:8675）；UpgradeDetectEntryPre **常驻**（lib/client.js:8691-8702） | 归档后 legacy 仍 true ⇒ 入口仍在 | 需求⑤成立 |

**建议的互斥加固（可选但推荐）**：
1. 零额度路由入口加 phase=running 时返回 409 —— 避免「子代理正在写白板时被归档覆盖」。判据直接读 readUpgradeStatePre 的 phase（lib/index.js:10318），**不要**自己另判（同一语义只允许一份判据）。
2. 归档完成后**不要**把 declined 置 true（lib/index.js:26998）—— 那会让弹窗 3 天内不再出现，与需求⑤「随时可调出」冲突。
3. 归档成功后向导**不自动关闭**，留在第 1 页并把状态刷新为「已归档 · 白板已重置」+ 给「仍然派子代理整理」按钮 —— 这就是需求④「做好说明」+ 需求⑤的联合落点。

---

## E · 结论与建议施工顺序

**整体判定：可行。** 5 条需求全部有落点，且有 3 条（②③⑤）**当前代码已天然满足**，不需要任何改动。

**必须补的（按优先级）**：
1. **P0**：lib/index.js:5614 的归档召回窗口（20 篇）—— 不修则需求①只是「最近 20 篇可召回」，宣传「归档仍可检索」属于**过度承诺**。
2. **P0**：按钮说明文本中**禁止**出现「memory_read(kind=archive) 能读旧白板」—— 该通道指向的是另一个目录（lib/index.js:17659）。
3. **P1**：新后端方法必须传 archivedIds（lib/index.js:4867），否则走 M1 降级警示路径（lib/index.js:5490-5500）。
4. **P1**：新后端方法必须用 lib/plan-store.js:176 的 archivePlanPre，不要用 lib/upgrade-apply.js:501 那份（命名不一致）。
5. **P2**：零额度路由加 phase=running 互斥门（同一判据复用 readUpgradeStatePre）。

**不需要改的**（已验证既有逻辑足够）：
- 白板从零兜底（lib/index.js:4750-4789 + lib/index.js:21755 自动首建）
- 反思/规约/用户约定的加载（lib/index.js:8743-8779 + :11974 + :12016-12017）
- 向导重复打开（judgeUpgradeJobRecoveryPre lib/team-baseline.js:472 + canUpgrade lib/index.js:26923）

---

## F · 未验证项（如实列出）

1. **放大 lib/index.js:5614 窗口后的检索耗时**：未实测。本机 322 篇 PLAN 归档、单篇最大 11KB，全量全文读取可能达数百毫秒到数秒。**推测，未验证**。
2. **归档后面板「历史版本」的 30 条上限**（lib/index.js:8362）是否够用：未评估 UI 影响。
3. **handoff/archive 里 322 篇总体积与 searchHandoffCorpus 的 scan 节流关系**：未实测（lib/index.js:5581 每篇全文 readTextSafe）。
4. **零额度归档对 index.json（sidecar）的影响**：lib/index.js:5139 提到 sidecar 路径，但归档是否会触发重建未读码确认。**推测，未验证**。
5. **前端新增按钮对 smoke-test-upgrade-wizard-client.mjs R1–R44 的实际影响**：只读了 lib/client.js:291-323 与 :385-390 的对应断言段，未跑该套件。

---

## 附录 · 本次调查的实测记录（可复算）

- 仓库：D:/dsh-auto-memory，分支 preview
- handoff/archive/ 文件数：**325 个 .md**；匹配 listHandoffLedgers 正则：**322 篇**；窗口内（limit=20）：**20 篇**；窗口外：**302 篇（93.8%）**
- 真实召回实测：抽出 searchHandoffCorpus + listHandoffLedgers + listPrevSessionTranscripts 函数体，注入 path / readdir，对本机工作区执行
  - query "446 条 rc" → 命中「白板 PLAN.md」
  - query（archive-only 文本「- **设置页 B1（9 分区骨架）已落地并全量绿**…」）→ 命中「白板归档/PLAN-history-20260922-023742.md」；该文本**不在**当前 PLAN.md 中（已断言 includes === false）
- projectDir/archive/（≠ handoff/archive）：42 个日期 .md + notes-archived.md（1,169,419 B）—— 与白板归档**无交集**
- 窗口内 20 篇构成（字典序倒序）：4 个 PLAN-history-* + 16 个 PLAN-<ts>-<uuid>.md

