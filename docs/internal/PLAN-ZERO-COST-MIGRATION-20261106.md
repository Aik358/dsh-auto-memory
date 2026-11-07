# 零额度迁移（归档旧白板 · 仅迁移重要内容）· 实现方案

> 2026-11-06 · 分支 preview · **本文件只出方案，不含实现改动，未改 `lib/` 任何文件**
> 前置：`docs/internal/FEASIBILITY-ZERO-COST-MIGRATION-20261106.md`（26,264 B / 313 行，Lead 已逐条复核）
> 本文件把该报告的「待定/未验证」三项补成**实测值**，并给出可直接派工的施工方案。
> 纪律：耗时全部为本机实测（探针脚本见附录 B，可复算）；凡未实测者显式标注「推测，未验证」。

---

## 0 · 一页结论

| 问题 | 结论 |
|---|---|
| **推荐窗口** | **取消 20 篇上限 → 全量扫描 + 8 路限量并发**（`lib/index.js:5614`）。实测稀有词最坏 **76.3 ms**（现行 20 篇窗口 19.1 ms，仅 +57 ms）；真实查询 **11.8 ms**（现行 11.7 ms，无变化）。**不需要**轻量预筛，**不需要**分页。 |
| **机械搬运** | **不值得做**。322 篇归档共 **690 个不同标题**、其中 **358 个只出现 1 次**；「最新实况 / 当前目标 / 载体分工」三节命中率分别只有 **9 / 81 / 9** 篇；四段式（任务状态/目标/已试方案与失败原因/进度与下一步）**完整率 0/322 = 0.0%**。可切的正文只有 155 篇（48.1%），且切出来后**写不进新白板**（见 §3.3）。 |
| **前端落点** | `lib/client.js:9098` 与 `:9099` 之间插按钮，属性 `data-dam-wizard-archive-plan`。该行**不在生成区**（生成区为 `:16206–18712` 与 `:18718–22449`），可直接改；改完 `--check` 应仍 SYNC-OK（**当前已实测 SYNC-OK**）。 |
| **后端** | 新增 1 条路由 `POST /api/dsh-auto-memory/upgrade-archive-plan` + 1 个引擎方法 `archivePlanZeroCostPre(agent, opts)`。 |
| **状态机** | 只写 `planArchivedAt / planArchiveFile` 两个新字段，**永不写 `phase`、永不写 `declined`**；`phase==='running'` 时返回 **409**。 |
| **两处已知坑** | ① 文案**禁止**出现「memory_read(kind=archive) 能取回旧白板」（该通道指向 `projectDir/archive`，`lib/index.js:13035`）；② **`archivedIds` 必须取自 `parseWhiteboardPre().cardIds`**，取自 `planCardsPre()` 会漏 4 张卡 ⇒ 仍触发 M1 降级警示（见 §4.2，本文件新增的坑）。 |

---

## 1 · 实测：archive 实有多少篇

本机 `<projectDir>/handoff/archive/`（`C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/archive`）：

| 指标 | 实测值 |
|---|---|
| 目录内文件数 | **325**（全部 `.md`） |
| 匹配 `listHandoffLedgers` 正则（`lib/index.js:5521`） | **322** |
| 总体积 | **3,900,642 B（3.72 MB）** |
| 单篇最大 / 中位 | **62,874 B** / **7,528 B** |
| 名字时间戳跨度 | 最新 `PLAN-history-20260922-023742.md` · 最旧 `PLAN-20260908-001638.md` |
| 按天龄分桶（今天 2026-11-06） | ≤30d **121** · 31–90d **201** · >90d **0** |

> 与可行性报告一致：322 篇可召回，其余 3 个（`.bak`/`-b` 等）不匹配正则。

---

## 2 · 实测：扫描耗时（窗口 × 查询类型）

### 2.1 方法（可复算）

从 `lib/index.js` 用**花括号配平**抽出真实的 `listHandoffLedgers`（:5519）与 `searchHandoffCorpus`（:5551）函数体，注入 `readdir/path/stat/readFile` 与等价 `readTextSafe`，对本机真实 `handoff/` 目录执行。**唯一改动**是把 archive 循环里的常量 `20` 换成可传参 —— 即待评估的那个改动点本身。
`config.boardMode='legacy'` ⇒ 结构化臂跳过，只考词法臂（与 legacy 用户真实路径一致）。每档取 5 次中位数。

### 2.2 主表：串行（现行实现）逐窗口

| archive 窗口 | 稀有词（扫满窗口，最坏情况） | 真实词「白板」（首篇即满 limit，提前退出） |
|---|---|---|
| **0**（只看 PLAN+账本） | 7.7 ms | 8.0 ms |
| **20**（现行） | **19.1 ms** | **11.7 ms** |
| 60 | 42.0 ms | 12.6 ms |
| 120 | 79.6 ms | 11.6 ms |
| 322（全量，串行） | **184.8 ms** | 10.7 ms |

> 关键：**真实查询几乎不受窗口影响**（11–12 ms 全档持平），因为 `scan` 每篇命中即计，`hits.length >= limit` 会提前 break。**只有「本该命中却没命中 / 稀有词」才付全窗口成本**。

### 2.3 推荐实现：全量 + 8 路限量并发

| 实现 | 稀有词 | 真实词「白板」 | 只在第 201 篇命中的锚点 |
|---|---|---|---|
| 现行（窗口 20，串行） | 19.1 ms | 11.7 ms | **0 命中**（召回不到） |
| **推荐（全量，8 并发）** | **76.3 ms** | **11.8 ms** | **1 命中**（`白板归档/PLAN-20260927-055744.md`） |
| 全量串行（对照） | 184.8 ms | 10.7 ms | 1 命中 |

**并发度扫描（全量稀有词）**：c=4 → 39.7 ms · c=8 → 35.7 ms · c=16 → 38.8 ms · c=24 → 40.8 ms · c=32 → 36.9 ms
⇒ **4–32 之间基本平坦**，取 **8** 即可（不取更高是因为 `readTextSafe` 走 `stat+readFile` 两次系统调用，再高只增抖动）。

### 2.4 规模外推（1000 篇，复制真实归档而成）

| 实现 | 1000 篇 / 12.4 MB |
|---|---|
| 全量串行 | 347.1 ms |
| **全量 8 并发** | **132.8 ms** |
| 真实词（8 并发） | 114.6 ms |

⇒ 线性度良好（322→1000 篇，并发实现 76→133 ms）。**5000 篇时约 660 ms**（推算，未实测），届时再考虑「按名字取最新 N 篇」的降级。

### 2.5 轻量预筛：实测**不划算**，不推荐

| 预筛方案（对 322 篇） | 稀有词 | 真实词 |
|---|---|---|
| 仅读文件名（0 次 open） | 0.6 ms | 0.6 ms |
| 文件名 + 前 300 字节（`open+read 300B`） | 99.4 ms | 5.8 ms |
| 命中后读全文（即推荐实现） | 76.3 ms | 11.8 ms |

- **「只读文件名」完全无效**：归档文件名形如 `PLAN-<ts>-<uuid>.md`，不含任何正文词 ⇒ 命中率恒 0，用它预筛等于把召回砍回 0。
- **「文件名 + 前 200–300 字节」比重读全文还慢**（99.4 vs 76.3 ms）：每篇多付一次 `open()`（325 次 open/close 实测 **90.0 ms**，而 322 次全文 `readFile` 只要 **100.6 ms**）⇒ **省下的字节数抵不过多出来的系统调用**。
- 分项成本（322 篇，逐项实测）：`readdir` 0.5 ms · `stat×322` 96.9 ms · `open+close×322` 90.0 ms · `readFile×322` 100.6 ms · `readFile+逐行计分×322` 122.5 ms。

> **结论：轻量预筛在本仓语料上净亏。** 可行性报告 §C1 担心的「全量读会很慢」实测不成立 —— 慢的是**逐篇 open**，不是读字节。

### 2.6 推荐方案（定稿）

```
窗口：取消上限（Number.MAX_SAFE_INTEGER）  并发：8  预筛：不做  分页：不做
```

**必须一起改的 3 个实现细节**（否则引入新缺陷，见 §6.R3/R4）：

1. **结果排序要保住确定性**：并发后命中顺序不再等于「名字倒序」，必须在 `scan` 里带上该篇在 `_archList` 中的序号，收齐后按序号排序再 `slice(0, limit)`。否则「同样查询、同样语料、命中不同 8 条」= 不可复现。
2. **limit 截断要后置**：8 个 worker 共享 `hits`，最多可能超出 limit 7 条；`return hits.slice(0, limit)`。
3. **失败姿态不变**：`readTextSafe` 已是全 fail-soft（返回 `''`），单篇失败只少一条来源，绝不打断检索。
4. **并发写 `hits` 的竞态**：Node 单线程 + `await` 之间不抢占，`while` 里 `hits.length < limit` 的判据不会被撕裂；但**不要**改成 `Promise.all(map(...))`（那会一次性发起 322 个 open，§2.4 实测并发度 >16 无收益且抖动增大）。

---

## 3 · 机械搬运：值不值得做

### 3.1 段落标题的稳定性（322 篇全量普查）

```
不同标题总数：690       只出现 1 次的标题：358（51.9%）
```

| 标题 | 命中篇数 | 占比 |
|---|---|---|
| `这是什么` | 264 | 82.0% |
| `待办` | 87 | 27.0% |
| `当前目标` | 81 | 25.2% |
| `关键约束` | 49 | 15.2% |
| `项目全貌` | 40 | 12.4% |
| `当前状态` | 37 | 11.5% |
| `近期进展` | 14 | 4.3% |
| `最新实况` | **9** | **2.8%** |
| `载体分工` | **9** | **2.8%** |
| `任务状态` / `已试方案与失败原因` / `进度与下一步` | 0 / 20 / 23 | 0% / 6.2% / 7.1% |

- `lib/index.js:1894` 记的三节「最新实况 / 当前目标 / 载体分工」：**当前目标 81 篇可用，但最新实况与载体分工各只有 9 篇（2.8%）** ⇒ 这两节**不构成稳定结构**，只是少数几版白板的措辞。
- 四段式（`任务状态 / 目标 / 已试方案与失败原因 / 进度与下一步`）**完整率 = 0/322**。抽样看真实结构：`项目全貌 / 史实更正 / 当前目标 / 已试方案与失败原因 / 进度与下一步` —— 标题高度自由，每篇 1–29 个 `##`（中位数 7）。

### 3.2 就算按白名单切片，能切出多少

按 `PLAN_CORE_SECTIONS`（`lib/index.js:1898`：最新实况/当前目标/载体分工 + v6 的 当前状态/近期进展/关键约束/待办）切片：

| 每篇命中的核心节数 | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 篇数 | **166** | 92 | 22 | 26 | 7 | 9 |

- **166 篇（51.6%）切不出任何东西**；
- 切出 ≥200 字符的：**155 篇（48.1%）**；
- 切出的总字符：合计约 **28 万字符**（原文 390 万），单篇最多 3,850 字符；
- 命中分布高度集中在**新近的 v6 白板**：`coreChars ≥ 3000` 的 8 篇全部是 2026-10-26 之后的 v6 形态（标题 `当前状态 / 近期进展（按时间倒序）/ 关键约束 / 待办`），而**最早的 4 篇 `PLAN-history-*` 与 166 篇零命中篇目，正是最需要「别丢」的老内容** —— 切片恰好覆盖了「本来就不缺」的那一端。

### 3.3 切出来也**写不进新白板**（决定性理由）

新白板是**事件渲染的**：`lib/plan-render.js:211 renderPlanFromEventsPre` 输出**固定四节**（`当前状态 / 近期进展 / 关键约束 / 待办`，`:35-40`），正文全部由 `event.sections{goal,doing,deadend,next}` 拼出。

要「把旧白板切片搬进新白板」只有两条路：

| 路 | 成本 | 后果 |
|---|---|---|
| **A. 把切片转成初始事件** | 需要为每片构造 `{name, summary, sections, checkpoints[]}`。**纯文本切片无法产出 `goal/doing/deadend/next` 四段** ⇒ 要么用规则硬猜（必然大量错填），要么调 LLM（**就不是零额度**） | 违反「零额度」承诺 |
| **B. 直接把切片写进 PLAN.md** | 便宜，但 `memory_note(kind=plan, fromEvents=true)`（`lib/index.js:23611-23626`）会用渲染结果**整体覆盖** `content` | **下一次模型整理白板就全丢** —— 等于给用户一个假的「已保留」 |

**判定：不值得做，不要做。**

复杂度不是「写个 slice 函数」那么简单：真要做对，需要「标题归一 + 四段映射 + 事件 id 生成 + M1 归档 id 对齐」，而收益只有 48% 的篇目、且这 48% 里可搬运的是**已经被归档、随时可召回的历史流水**，与用户真实诉求（「白板从零开始，只迁重要内容」）**方向相反**。

**替代方案（推荐写进按钮文案）**：不搬正文，只搬**索引** —— 归档文件名 + 首行标题已足以让 `memory_recall(scope='handoff')` 命中（§4.4 已实测），需要细节时按需读取。

---

## 4 · 完整实现方案

### 4.1 前端（`lib/client.js`）

**落点**：`lib/client.js:9095-9100` 的 `btnRow('actions', [...])`，插在 `:9098`（`data-dam-wizard-dryrun`）与 `:9099`（`data-dam-upgrade-start`）之间。

> 已核实该行**不在生成区**：`ITER5-GENERATED:BEGIN` 在 `:16206`、`:18718`，`END` 在 `:18712`、`:22449`。`:9095` 属手写 classic 区 ⇒ **改 `lib/client.js` 是合法的**，仍须跑 `--check`（当前实测 SYNC-OK，可作基线）。

**属性命名**（沿用 `data-dam-wizard-*` 族，全仓现有 40 处同名族）：

| 属性 | 用途 |
|---|---|
| `data-dam-wizard-archive-plan` | 按钮本体（新增，唯一必加） |
| `data-dam-wizard-archive-plan-state` | 按钮下方状态行（`idle \| busy \| done \| error`），便于测试与「已归档」回显 |

**文案（中文 / 英文，必须逐字采用，两个陷阱都写死在里面）**：

```
按钮：T('只归档白板（不花额度）', 'Archive the whiteboard only (free)')

确认后状态行：
T('已归档 · 白板已重置为骨架。旧白板原文在 handoff/archive/PLAN-<时间戳>-<uuid>.md，' +
  '用 memory_recall(scope="handoff") 还能搜到；面板「历史版本」只列最近 30 条。' +
  '想继续深度整理，随时点「开始整理 →」派子代理。',
  'Archived. The whiteboard was reset to a skeleton. The old file is at ' +
  'handoff/archive/PLAN-<timestamp>-<uuid>.md and stays searchable via memory_recall(scope="handoff"). ' +
  'The panel version list shows only the latest 30. You can still start the subagent migration anytime.')
```

⚠️ **文案两条硬禁令**（写进代码注释，交派工时逐字带上）：

1. **禁止**出现「`memory_read(kind='archive')` 取回旧白板」——该通道读的是 `projectDir/archive`（30 天前旧日志），与 `handoff/archive` **是不同目录**（`lib/index.js:13035 / :17659 / :17684`）。写了就是**错误承诺**。
2. **禁止**出现「归档后不再提示/不再需要整理」——归档不写 `declined`，向导会照常出现（这是刻意设计，见 §4.5）。

**点击行为**：

```
onArchivePlan:
  if (busy || String((st||{}).phase||'') === 'running') return      // 前端先拦，后端仍 409 兜底
  setBusy(true); setArchiveState('busy')
  apiPost(API.upgradeArchivePlan, { ws: wsNow })
    .then(r => { setArchiveState('done'); loadStatus() })            // 重新拉 upgrade-status，刷新 canUpgrade/phase
    .catch(e => { setArchiveState('error'); setErr(...) })
    .finally(() => setBusy(false))
```

- **按钮 disabled 条件**：`busy || phase === 'running'`（与 `:9099` 的「开始整理」同口径，避免两条线同时动白板）。
- **不关闭向导、不跳页**：成功后留在第 1 页并回显状态行 —— 这同时满足需求④「说明」与需求⑤「随时仍可派子代理」。
- **客户端 API 表镜像**：`lib/client.js:3971-3975` 增 `upgradeArchivePlan: ROUTE_PREFIX + '/upgrade-archive-plan'`。
  ⚠️ 加了客户端键 ⇒ 该路径**不再是宿主独有** ⇒ **不要**加进 `tests/smoke/smoke-test-api-paths.mjs:26 HOST_ONLY_WHITELIST`（否则 A2 必红，与 P2b 三条通路踩过的是同一个坑，见 `:54-59`）。

### 4.2 后端

#### 4.2.1 路由

**API 常量**：`lib/index.js:501-509` 增
`'upgrade-archive-plan': '/api/dsh-auto-memory/upgrade-archive-plan'`

**注册**：`lib/index.js:27004`（`upgrade-snooze` handler 之后、`memory-upgrade` 之前），`kind: 'exact'`。
鉴权与解析照抄 `lib/index.js:26981-26993` 与 `:27012-27020`：

```
handler(req, res):
  ① !isLoopbackRequest(req, panelAllowedHosts) ⇒ 403 forbiddenPanelPayloadPre
  ② method !== 'POST' ⇒ 405
  ③ body = await readJsonBody(req)
  ④ wsIn = body.ws；_rp = wsIn ? {sid, pa:{ws:wsIn, wsBound:true}} : await engine.resolvePathsForRequestPre(body.sessionId)
  ⑤ _rp.pa.wsBound === false ⇒ 400 { error:'workspace unavailable for this session', sessionId }
  ⑥ _agent = engine.agentForSessionId(_rp.sid) || engine._workbenchParent || engine._lastAgent || undefined
  ⑦ r = await engine.archivePlanZeroCostPre(_agent, { ws: _rp.pa.ws })
  ⑧ 按 r.code 映射状态码（见下表）
```

| `r.code` | HTTP | 说明 |
|---|---|---|
| （`r.ok === true`） | **200** | 成功，回 `{ok, archivedPlan:{file,sha256,cards,bytes}, recreated:{bytes,cards}, skipped?}` |
| `plan-archive-in-progress` | **409** | `phase === 'running'`（子代理正在写白板） |
| `no-workspace` | 400 | 解析不出工作区 |
| `no-plan` | 200 + `skipped:'no-plan'` | 白板本来就没有内容（不是错误；无副作用） |
| `plan-archive-verify-failed` | 500 | 归档读回 sha256 不一致 ⇒ **已中止，白板未动** |
| `plan-archive-recreate-failed` | 500 | 骨架写入被门拒 ⇒ 附 `gate` |
| 其他异常 | 500 | `{ error: message }` |

#### 4.2.2 引擎方法

**签名**：

```js
/**
 * 零额度归档：把当前 PLAN.md 全文归档到 handoff/archive/，然后把白板重置为骨架。
 * 零 LLM 调用、零网络、同步 IO（实测全程 8.6 ms）。
 * @returns {Promise<{ok:boolean, code?:string, archivedPlan?:{file,rel,sha256,cards,bytes},
 *                     recreated?:{bytes,cards}, skipped?:string, error?:string, gate?:string}>}
 */
async archivePlanZeroCostPre(agent, opts = {})
```

**内部步骤（逐条带落点，可照抄）**：

| # | 动作 | 依据 / 注意 |
|---|---|---|
| ① | `const p = await this.resolvePaths(agent)`；`projectDir / handoffDir / planPath` | `lib/index.js:4527-4578`，返回含三者的对象 |
| ② | `const st = await this.readUpgradeStatePre(agent)`；`if (st.phase === 'running') return { ok:false, code:'plan-archive-in-progress' }` | `:10318`。**判据只此一处**，不另判（同语义禁止两份判据） |
| ③ | `const oldPlan = await readPlanPre(p.planPath)`；`if (!oldPlan.trim()) return { ok:true, skipped:'no-plan' }` | `lib/plan-store.js:55-63`（UTF-8 校验 + ENOENT→`''`） |
| ④ | **取卡 id —— 必须用 `parseWhiteboardPre`**：<br>`const projB = parseWhiteboardPre(oldPlan, { kind:'plan' })`<br>`const oldIds = projB.cardIds`<br>`const protB = extractProtectedRegionsPre(projB)` | ⚠️ **本文件新增的坑**：`planCardsPre(oldPlan)` 对当前 PLAN.md 给 **18 条**，`parseWhiteboardPre(oldPlan).cardIds` 只给 **14 条**（实测）。M1 用的正是后者（`lib/index.js:5462-5464`）⇒ **传 `planCardsPre` 的 id 会漏 4 张，仍触发降级警示** |
| ⑤ | `const archDir = path.join(p.handoffDir, 'archive')`<br>`const file = await archivePlanPre(archDir, 'PLAN-' + handoffStamp(), oldPlan)` | ⚠️ **必须用 `lib/plan-store.js:176` 这一份**（`PLAN-<ts>-<uuid8-4-4-4-12>.md`），**不要**用 `lib/upgrade-apply.js:501` 那份（`PLAN-<ts>.md`，命名不一致，将来改正则会漏召回） |
| ⑥ | 读回校验：`const back = await readPlanPre(file)`；`sha256(back) !== sha256(oldPlan)` ⇒ `return { ok:false, code:'plan-archive-verify-failed' }`（**此时白板未动**） | 照抄 `lib/upgrade-apply.js:782-784` 的读回校验姿态 |
| ⑦ | `const skel = this.skeletonPlanTextPre()`<br>`const w = await this.writePlanSnapshot(projectDir, skel, { archivedIds: oldIds })` | ⚠️ **`archivedIds` 必传**（`lib/index.js:4867` → `lib/memory-mutation.js:101`）。实测：传全 ⇒ M1/M2/M3 全 pass、`m1Downgraded=false`；不传 ⇒ M1 fail、`unarchived=14`、走降级警示。骨架 `checkPlanCriteriaPre` 实测 `ok:true`（477 B / 2 节），必过 P-H1 |
| ⑧ | `if (!w.ok)` ⇒ `return { ok:false, code:'plan-archive-recreate-failed', gate:w.gate, error:w.error }`<br>（**归档文件保留**，白板回退为旧内容 —— 这是可接受的失败姿态：多一份归档，不丢内容） | `writePlanSnapshot` 失败不写盘（`:4934-4936` 的 CAS + `writeTextAtomicPre`） |
| ⑨ | `await this.writeUpgradeStatePre(agent, { planArchivedAt: Date.now(), planArchiveFile: 'handoff/archive/' + path.basename(file) })` | `:10337`，read-modify-write，**不冲掉 `declined`/`phase`**。**只加这两个字段** |
| ⑩ | `return { ok:true, archivedPlan:{ file, rel, sha256, cards: oldIds.length, bytes: Buffer.byteLength(oldPlan) }, recreated:{ bytes: skel.length, cards: 0 } }` | 返回值即验收物理量来源 |

**不得做的事（写进方法头注释）**：
- ❌ 不写 `phase`（任何值）—— 写了会挡住后续 `memory_upgrade` 启动（`lib/team-baseline.js:472` 只在 `phase==='running'` 时拒启动，但写 `running` 就永久卡住）。
- ❌ 不写 `declined` —— 会让弹窗 3 天不出现（`lib/index.js:26923-26925`），与需求⑤冲突。
- ❌ 不调用 `upgrade-apply.js` 的 applier —— 它要求 `zone.events` 草案 + 闸 1–7（`lib/upgrade-apply.js:11-13`），零额度路径**没有事件草案**。
- ❌ 不碰事件库（`event-store.json`）—— 需求③的四类内容（反思/规约/用户约定）本来就不走事件库（`lib/index.js:8743-8779`），动它只会制造风险。

### 4.3 验收判据（可复算，每条带负路径）

> 全部为**真执行**判据（CR-10）：不得以「源码含某字符串」充当功能验收。

#### 正路径（必须给出具体物理量）

| # | 判据 | 期望值（本机基线，可复算） |
|---|---|---|
| **P1** | 归档前 `PLAN.md` 字节 / 卡数 | **21,004 B** / `parseWhiteboardPre` 卡 **14** 张 |
| **P2** | 归档后 `handoff/archive/` 文件数 | 322 → **323**（+1） |
| **P3** | 新归档文件名匹配 `listHandoffLedgers` 正则 | `true`（实测形如 `PLAN-20261106-200442-52f24c78-....md`） |
| **P4** | 新归档内容 sha256 === 归档前 PLAN.md sha256 | 相等；字节 21,004 |
| **P5** | 归档后 `PLAN.md` 字节 / 卡数 | **477 B** / **0** 张（骨架逐字同 `skeletonPlanTextPre`） |
| **P6** | `writePlanSnapshot` 返回 `m1Downgraded` | **`false`**（且 `warn === ''`） |
| **P7** | `upgrade-state.json` 后置字段 | `planArchivedAt` 为 number、`planArchiveFile` 指向真实存在的文件；`phase` 与调用前**逐字相同**；`declined` **仍为 false** |
| **P8** | 归档后 `upgrade-status.canUpgrade` | **仍为 `true`**（legacy 由 `MEMORY.md` 锚点决定，`lib/rules-layer.js:557-559` 不含 PLAN.md） |
| **P9** | 归档后下一轮 `ensurePlanBoardPre` | `skipped:'exists'`（骨架已存在，不被覆盖） |
| **P10** | 召回窗口改动后：只在第 201 篇命中的锚点文本 | 旧实现 **0 命中** → 新实现 **1 命中**（`白板归档/PLAN-20260927-055744.md`） |

#### 负路径（缺一条即视为未验收）

| # | 负路径 | 必须观察到 |
|---|---|---|
| **N1** | **不传 `archivedIds`**（变异：删掉 ⑦ 的 `archivedIds` 参数） | `m1Downgraded === true` 且 `warn` 含「⚠ 【白板丢卡警示 · 已照写】…14 张…」。**还原后必须回到 P6**（`false`）。若变异后仍 `false` ⇒ 说明该参数根本没生效，判据失守 |
| **N2** | `upgrade-state.json` 预置 `phase:'running'`，再 POST | HTTP **409**；且 `PLAN.md` sha256 **未变**、`handoff/archive/` 文件数 **未变**（证明没有半写） |
| **N3** | "读回校验"变异：让 `readPlanPre(file)` 返回被篡改内容 | 返回 `code:'plan-archive-verify-failed'`；`PLAN.md` sha256 **未变**、`handoff/archive/` **未新增**（或新增但白板未动）—— 证明校验不是装饰 |
| **N4** | 对**空白板**调用（先把 PLAN.md 清成 0 字节） | 返回 `ok:true, skipped:'no-plan'`；`handoff/archive/` **不新增文件**；`planArchivedAt` **不写入** |
| **N5** | 非 loopback 请求 | HTTP **403**，`forbiddenPanelPayloadPre` 载荷 |
| **N6** | 归档完成后读 `upgrade-status` | `declined === false` 且 `snoozeRemainingMs === 0` ⇒ **弹窗不被静默关掉**（需求⑤） |
| **N7** | 前端文案负断言 | 渲染文本 **不含** `memory_read`、**不含** `kind=archive`、**不含** `kind='archive'`、**不含**「不再提示」 |
| **N8** | 召回窗口变异：把并发实现改回 `slice(0, 20)` | P10 的锚点文本必须**变回 0 命中**（证明窗口改动真的生效，不是恒真） |

**验收脚本建议落点**：`tests/smoke/smoke-test-zero-cost-archive.mjs`（新文件）。
- 语言级：真 `import` 引擎 → 在 `mkdtempSync` 的临时 `projectDir`（造 3 篇假 PLAN 归档 + 1 篇 PLAN.md）上**真调用** `archivePlanZeroCostPre`，断言上面 P1–P9 / N1–N4 的返回值与文件系统副作用。
- ⚠️ 禁止在**真实** `workspaces/--D--dsh-auto-memory--` 上跑本套件（会把真实白板归档掉）。所有路径必须来自 `mkdtemp`。
- 前端：在 `tests/smoke/smoke-test-upgrade-wizard-client.mjs` 追加
  - **R48** `findAll(tree, n => hasAttr(n, 'data-dam-wizard-archive-plan')).length === 1`
  - **R49** 渲染文本含「不花额度」与「handoff/archive」
  - **R50**（负）渲染文本不含 `memory_read` / `kind=archive`
  - **R51** `ST_FIX` 注入 `phase:'running'` ⇒ 该按钮 `disabled === true`
  - **R52**（负）注入未定义标识符 ⇒ 必须精确报 `ReferenceError`（沿用套件既有 N0/N1 手法，证明判据非恒真）

#### 必跑的守卫（改完立即跑，不能只跑新套件）

1. `node --check lib/index.js && node --check lib/client.js`
2. `node tools/build-iter5-skin.mjs --check` ⇒ 必须 **SYNC-OK**（改点不在生成区，理论上不变；变了说明误改了生成区）
3. `node tests/smoke/smoke-test-api-paths.mjs`（A1–A4 四条锁）
4. `node tests/smoke/smoke-test-upgrade-wizard-client.mjs`（R0–R52）
5. `node tests/smoke/smoke-test-handoff.mjs`（G5 语料检索，窗口改动的主回归）
6. `node tests/smoke/smoke-test-issue164-plan-tools.mjs`（`:39` 断言召回能命中 `白板归档/PLAN-`）
7. `--impact-run` 跑依赖边（不要为一次改动跑全量）

### 4.4 状态机：零额度线与子代理线共存

| 关注点 | 子代理线 | 零额度线 | 共存规则 |
|---|---|---|---|
| 状态文件 | `<userDir>/upgrade-state.json`（`:10299`） | 同 | 共用；写一律走 `writeUpgradeStatePre`（`:10337`，read-modify-write） |
| 写入字段 | `phase / jobId / epoch / startedAt / perWorkspace / runId / scope / agentOptions` | **只加** `planArchivedAt / planArchiveFile` | 零额度线**永不写 phase** |
| 互斥 | `phase==='running'` 时才在飞 | 无「在跑」概念（同步 IO，实测 **8.6 ms**） | 零额度线入口**只读** phase 判 409，不写 |
| 归档后能否再派子代理 | `judgeUpgradeJobRecoveryPre`：`phase !== 'running'` ⇒ `action:'start'`（`lib/team-baseline.js:472`） | 不改 phase | ✅ 随时可点 |
| `canUpgrade` | `legacy && !snoozed && phase!=='running'`（`:26923-26925`） | 不改 legacy / snooze / phase | ✅ 不受影响 |
| `legacy` 判据 | `!anchors`，anchors 只数 `userText+notesText`（`lib/rules-layer.js:557-559, 574`） | 归档 PLAN.md **不参与** | ✅ 无耦合（可行性报告 C6 已排除） |
| 归档后弹窗 | 照常出现 | — | 这是**刻意**：需求⑤要求随时可调 |

**唯一新增互斥**：`phase==='running'` ⇒ 409。判据直接复用 `readUpgradeStatePre`（`:10318`），**不另写一份**。

**归档后不做什么**（逐条对照需求）：
- 不置 `declined` ⇒ 弹窗照常（需求⑤）
- 不关向导 ⇒ 用户能继续点「开始整理 →」（需求⑤）
- 不写 `phase:'done'` ⇒ 不会让 `canUpgrade` 假性变 false（`:26918-26922` 已修过的迁移死锁，别重新引入）

### 4.5 召回窗口改动（与归档按钮同批还是分开）

**建议同批，但作为独立提交/独立回归点**：

- 改动只有一处（`lib/index.js:5614` 那个 for 循环），**不依赖**归档功能；分开提交便于回滚。
- 但**不能只改归档不改窗口**：不修窗口，用户点了「只归档白板」后，旧白板里 93.8% 的内容永远搜不到（322 篇里 302 篇在窗口外）——「归档仍可检索」就是**过度承诺**。
- 实测支撑：P10 已证明窗口 20 时第 201 篇的锚点文本**召回不到**，全量后**能召回**。

---

## 5 · 风险清单（可能引入的新问题）

| # | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| **R1** | **归档后模型看不见旧白板**，误以为项目没做过任何事 | 归档后骨架是「待模型重写」 | 文案明写「原文在 handoff/archive/，可 memory_recall 找回」；骨架文本本身已含「请用 memory_note(kind=plan) 重写」（`lib/index.js:4782`） |
| **R2** | **归档文件被误认为「已迁移」**，用户以为整理过了 | 用户只看文件名 `PLAN-<ts>.md` | 状态行显式区分「归档 ≠ 整理」；`upgrade-status.phase` 保持不变，面板仍显示「待整理」 |
| **R3** | **并发扫描破坏结果确定性** | 8 worker 共享 `hits` | 带序号排序后再 `slice`（§2.6 第 1 条）。**不做则同查询不同结果** |
| **R4** | **并发后 `limit` 被突破**（最多超 7 条） | 8 worker 同时 push | `return hits.slice(0, limit)` |
| **R5** | 8 路并发在**网络盘 / 慢盘**上放大延迟 | 用户把 `memoryRoot` 放在 NAS | 并发度设为**模块级常量**（如 `ARCH_SCAN_CONCURRENCY = 8`），便于日后按配置降为 1；且 `readTextSafe` 已 fail-soft，慢只慢不崩 |
| **R6** | **N1 类半修**：实现者漏传 `archivedIds`，功能「能用」但每次归档都往模型侧吐「⚠ 白板丢卡警示」 | 忘记传参 | 验收 N1 强制变异；且 `archivedIds` 必须取自 `parseWhiteboardPre`（**不是** `planCardsPre`，§4.2 步骤④）—— 这是本文件相对可行性报告**新增的坑**，不可照抄旧方案的 `planCardsPre` |
| **R7** | **M2 用户区保护**：若用户白板里有 `<!-- user -->` 区，骨架无该区 ⇒ M2 fail ⇒ **硬拒**（M2 不降级，`lib/memory-mutation.js:130-157`） | 白板含 user 区 | 实测本机当前 PLAN.md **无** user 区、322 篇归档里 **0 篇**有。但代码必须处理：若 `projB` 有受保护区域 ⇒ **早退** `code:'plan-has-user-region'` + 明确文案（「白板含你的手写区，未归档；请先手动移走」），**不要静默丢用户区** |
| **R8** | **settings 迁移竞态**：归档过程中配置根被改 | 用户在归档瞬间改 `memoryRoot` | `writePlanSnapshot` 自带 `settings-migration-active` / `settings-root-changed` 双检（`:4821, :4834`），归档方法只需把 `w.ok===false` 原样透出 |
| **R9** | **重复点击**产生多份归档 | 用户连点 | 前端 `busy` 拦 + 后端幂等性说明：第二次调用时 PLAN.md 已是骨架（477 B）⇒ 会把骨架再归档一份。**建议后端加保护**：若 `oldPlan` 与 `skeletonPlanTextPre()` **逐字相同** ⇒ `return { ok:true, skipped:'already-skeleton' }` |
| **R10** | **API 表漂移**：只加宿主键没加客户端键（或反之） | 漏改一侧 | `smoke-test-api-paths` A1/A2/A4 会红。注意 A2 方向：加了客户端键 ⇒ **不要**进白名单 |
| **R11** | **生成器覆盖**：有人把按钮改进生成区 | 落点选错 | 改点 `:9098` 在生成区**外**（生成区 `:16206+`）；改完必须 `--check` SYNC-OK |
| **R12** | **历史版本 30 条上限**（`:8362`）让用户看不到新归档 | 归档后去面板翻 | 文案已写明「面板只列最近 30 条」；不本次修（属另一条线） |
| **R13** | 归档后 `planVersions` 列表把新归档排在最前，用户以为白板内容变了 | — | 可接受；文件名带秒级时间戳 |
| **R14** | **假验收**：拿「源码含 `archivedIds` 字样」当验收 | 图省事 | 验收纪律：N1 必须变异后观察 `m1Downgraded` 翻转，不允许静态断言 |

---

## 6 · 施工顺序（可直接派工）

| 步 | 内容 | 验收 |
|---|---|---|
| **S1** | `lib/index.js:5614` 窗口改动（全量 + 8 并发 + 序号排序 + slice） | P10 / N8；`smoke-test-handoff` G5 绿；`smoke-test-issue164` 绿 |
| **S2** | `lib/index.js:501` API 常量 + `:27004` 路由 | `smoke-test-api-paths` 4/4 |
| **S3** | `archivePlanZeroCostPre` 引擎方法（§4.2.2 十步） | 新套件 P1–P9 + N1–N4 全绿 |
| **S4** | `lib/client.js:3974` API 镜像 + `:9098` 按钮 + 状态行 | R48–R52 + 生成器 SYNC-OK |
| **S5** | `tests/smoke/smoke-test-zero-cost-archive.mjs` | 自身 PASS，且 N1/N8 变异必红 |
| **S6** | `--impact-run` 依赖边 | FAIL 0 |

**依赖关系**：S1 与 S2–S4 **无依赖**，可并行；S3 依赖 S2（路由）；S5 依赖 S3/S4。

---

## 附录 A · 关键落点速查（全部已读码核实）

| 用途 | 位置 |
|---|---|
| 召回窗口（**要改**） | `lib/index.js:5614` |
| 每篇全文读取（性能点） | `lib/index.js:5581` |
| 名单函数 + 正则 | `lib/index.js:5519-5523` |
| 召回路由 scope=handoff | `lib/index.js:12820` |
| 白板归档统计 | `lib/index.js:5320` |
| `archivePlanPre`（**要用这个**） | `lib/plan-store.js:176` |
| `archivePlanPre`（**不要用**） | `lib/upgrade-apply.js:501` |
| 骨架兜底 | `lib/index.js:4750 / :4774` |
| 骨架自动首建触发点 | `lib/index.js:21755` |
| M1/M2/M3 门 | `lib/index.js:5434-5515` · `lib/memory-mutation.js:100-157` |
| `archivedIds` 透传链 | `lib/index.js:4867 → :23640-23641 → :23691` |
| 升级状态读/写 | `lib/index.js:10318 / :10337` |
| 恢复判据（start 门） | `lib/team-baseline.js:472` |
| `canUpgrade` | `lib/index.js:26923-26925` |
| 向导第 1 页按钮 | `lib/client.js:9095-9100` |
| 客户端 API 表 | `lib/client.js:3971-3975` |
| 宿主 API 表 | `lib/index.js:501-509` |
| `memory_read(kind=archive)` 指向 | `lib/index.js:13035 / :17659 / :17684`（**都不是** handoff/archive） |
| 事件渲染白板 | `lib/plan-render.js:211`（固定四节 `:35-40`） |
| `legacy` 判据 | `lib/rules-layer.js:557-559, 574` |
| 生成区边界 | `lib/client.js:16206 / 18712 / 18718 / 22449` |
| API 白名单 | `tests/smoke/smoke-test-api-paths.mjs:26-60` |

## 附录 B · 实测探针（可复算，只读，均在 `artifacts/_lead-integ/`）

| 脚本 | 产出 |
|---|---|
| `probe-zero-cost-window.mjs` | 清点 + 逐窗口耗时（真实 `searchHandoffCorpus`） |
| `probe-zero-cost-cost2.mjs` | 逐项成本拆解（readdir/stat/open/readHead/readFull） |
| `probe-zero-cost-cost3.mjs` | 天龄分桶 + 并发度 + 冷热对照 |
| `probe-zero-cost-final.mjs` | 串行 vs 并发定稿表 + 命中位置分布 |
| `probe-zero-cost-headings.mjs` | 690 个不同标题普查 |
| `probe-zero-cost-capture.mjs` | 切片可回收字符量 |
| `probe-zero-cost-scale.mjs` | 1000 篇外推 + 召回保持性 |
| `probe-zero-cost-recommend2.mjs` | 推荐实现（全量 + 8 并发）定稿耗时与命中 |
| `probe-zero-cost-e2e.mjs` | 归档全流程分段耗时（**临时副本**上执行） |
| `probe-zero-cost-name.mjs` | 归档命名 vs 召回正则一致性 |
| `probe-zero-cost-verify2.mjs` | 骨架过判据门 + M1 传/不传 archivedIds + 卡 id 口径差异 |

## 附录 C · 未验证项（如实列出）

1. `--impact-run` 与 6 个必跑套件的**实际执行结果**：本文件未跑（只读阶段，且改动尚未发生）。**推测，未验证**。
2. 5000 篇归档时的耗时：按 322→1000 的线性度外推约 **660 ms**（并发 8）。**推算，未实测**。
3. `boardMode='graph'` 时结构化臂与新增并发的交互：本方案只动词法臂的 archive 循环，结构化臂不受影响。**未单独实测 graph 档全链路耗时**。
4. 面板「历史版本」30 条上限（`:8362`）的 UI 影响：未评估，本次不改。
5. `archivePlanZeroCostPre` 在**真实引擎实例**（非临时目录）上的端到端表现：需等实现后跑 §4.3 的 P1–P10。
