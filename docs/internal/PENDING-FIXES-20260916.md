# 压缩后施工清单 · 送审前待改项（2026-09-16 归档）

> **用途**：本窗口上下文将满，本文件是压缩后新窗口的**唯一施工依据**。
> **纪律**：本清单一律以代码/git/API 硬证据为准，不采信卡片自述或记忆自述。
> **时序**：改完 → 全量回归 → 找 ChatGPT 验收 → 一起提交推送。

---

## ★ 施工完成回执（2026-09-16 本窗口执行）

**结果：全量回归 `PASS 104 / FAIL 0 / TIMEOUT 0（159.0s）`**（基线 96 ⇒ 净增 8 套件，零失败）。
工作区改动 **235 项**，仍**未 commit 未 push**（遵守 pre 线纪律）。

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | **issue #54** 写入侧保留语法过滤 + 可诊断性 | ✅ 已修 | 新增 `checkReservedSyntaxInContent()`（复用既有 `MARKER_OPEN`）；三处写入原语前置拦截；`conflict:` reason 带 `@行号`。套件 `smoke-test-issue54-pre.mjs` 12/12；变异 A/B 真失败（5 条 / 1 条） |
| 2 | **PR #53** DATE_RE 锚定（issue #51） | ✅ 已移植 | `ws-overview-rank.js` 改 `^(\d{4})-(\d{2})-(\d{2})$`（与 `index.js:578` 同源）。套件 `smoke-test-issue51.mjs` 29/29 |
| 3 | **PR #50** EPERM 退避 + 写入失败不降级（issue #48） | ✅ 已移植 | 新增 `lib/fs-retry-pre.js`（有界退避，无 unlink 回退）；`atomicReplace` 保留候选快照 + `recoveryPath`；`memory_log/note/user` 失败改为**抛出**（DSH 记 isError，不再假装成功）。套件 37/37；变异真失败（15 条） |
| 4 | **PR #46** welcomeTourEnabled 失效（issue #40） | ✅ 已移植 | 三个自动弹出分支全部过 `allowTour` 闸；配置未知不自动播放；✕ 直接关闭；焦点陷阱。套件 20/20；变异真失败（5 条） |
| 5 | **PR #44** 容量整理净增长（issue #38） | ✅ 已按根因修 | **在 pre 线源码上实测复现**（67→77→87 每轮 +10，8 轮单调 +80）。根因 A：`compactLegacyLayer` 无条件重序列化占位段 (文件头) ⇒ 引入 `synthetic` 标记 + `seqOf()`；根因 B：`replace` 误按旧文件额度计费 ⇒ 按动作分口径。套件 `smoke-test-issue38-pre.mjs` 12/12；变异真失败（6 条） |
| 6 | **PR #49** recall 256 截断（issue #45） | ✅ 已移植 | 移除 `l0Corpus.length = 256` 与 `semanticArm` 的记录预算截断；新增窗口受限提示（未命中≠从未记录）。套件 `smoke-test-issue45-recall-corpus.mjs` 45/45 + `smoke-test-p2-semantic-recall-pre.mjs` 15/15 |
| 7 | **PR #36** 技能晋升（issue #30） | ✅ 已移植 | 新增 `procedure-observation-pre.js` + `intent-clean-safe-pre.js`；去重口径由 **title 改指纹**（标题不是身份）；观察行显式 `observationOnly` 且晋升短接为 `observation-only`。套件 36/36 + m81 41/41 + m84 37/37。**并补齐 PR 自身缺失的根因断言**（同名碰撞链），变异真失败（4 条） |
| 8 | **issue #52** 子代理模型被旧 cfg 覆盖 | ✅ 已修 | `set()` 改**函数式更新** + 新增 `setMany()`；三个成对入口改原子更新。套件 `smoke-test-issue52-pre.mjs` 9/9；变异真失败（3 条） |
| 9 | **群反馈 #4 / P0-④d** 注入上限 + 可排除来源 | ✅ 已修 | 新增 `injectExcludeSources` 配置 + `filterExcludedSourcesPre()`（id/整层/目录前缀/精确路径四种口径）；在注入闸门**之前**挡下并渲染 `[降级]`；配置端点加类型门。套件 `smoke-test-p0-4d-inject-exclude-pre.mjs` 17/17；变异真失败（3 条）。**上限部分经查已存在**（冻结常量 `TIER_BUDGET_PRE_V1` + `injectBudgetChars`/`tier0BudgetShare`/`tier0MaxTokens`），非缺失项 |
| 10 | **PR #37** 自动接续（issue #35） | ⛔ **未移植（与用户裁定冲突，待裁定）** | pre 线已于 2026-09-14 按**用户裁定方案**修好：`hostAutoContinue()` 先 `sessionController.cancel()` 停旧回合，再仪式、再建新会话；套件 `smoke-test-autocont-host-pre.mjs` 钉死调用顺序 `cancel → prompt → create` 并覆盖降级路径。PR #37 的 `continuation-safety.js` 文件头明写 **"no cancel of source work"**、改用 idle 门 —— 与 `index.js:3222` 记录的用户裁定**直接相反**。**须用户裁决后再动** |
| 11 | **群反馈 #1** 接续互锁 | ✅ 已确认为已修 | 见 §5（四处带日期解耦 + 回归套件） |

### 施工期间发现并修掉的**额外**缺陷（不在原清单内）

**issue #54 守卫暴露出一个既有的静默结构损坏**（由 `smoke-test-m3b3-pre.mjs` E7 抓出）：
`maintain()` 的"无 AI 蒸馏"回退分支把 `archive/` 里日志**原文**内联进 `MEMORY.md`，而原文首行是
**旧日志自己的 anchor marker** ⇒ 该 marker 变成 `MEMORY.md` 的结构锚点，产生一条**幻影记录**
（身份属于旧日志、却挂在笔记上）。修前之所以"没报错"，是因为整行合法 marker 能被 `parseAnchors`
当锚点吃下 —— 属**静默结构损坏**，比报错更危险。

- 修法：新增 `stripAnchorLines()`（只剥整行合法 marker，正文一字不动），并在 `appendText()` 的
  **写入边界统一收口**（一处覆盖全部调用方），而非逐调用点打补丁。
- 实测证据：未剥离 ⇒ `appendAnchoredRecord` 直接**拒绝**（fail-closed）；剥离后 ⇒ 锚点恰为 2 条
  合法记录、无幻影、`旧日志条目` 正文仍可读。
- 连带修正：`smoke-test-m3b2-pre.mjs` 的 D7 断言按 PR #50 语义更新（tmp 保留为恢复快照而非清理）；
  `smoke-test-p4-l0-response-pre.mjs` 的 import 正则放宽（允许同源附加导入）。

### 变异演示总账（全部真失败，非假绿）

| 套件 | 变异 | 结果 |
|---|---|---|
| issue#54 | 移除 append 守卫 / 移除 replaceSingle 守卫 | 5 条 / 1 条失败 ✅ |
| issue#48 | 退避重试只试 1 次 | 15 条失败 ✅ |
| issue#40 | 三处 `allowTour` 闸还原 | 5 条失败 ✅ |
| issue#38 | `seqOf` 退回无条件 `'## '+title` | 6 条失败 ✅ |
| issue#30 | 去重回退按 title 匹配 | 4 条失败 ✅ |
| issue#52 | `set()` 退回读闭包快照 | 3 条失败 ✅ |
| 反馈#4 | 排除过滤退化为不过滤 | 3 条失败 ✅ |

**还原纪律**：每次变异后按 SHA256 逐字节校验还原（`memory-writer-pre.js`、`fs-retry-pre.js`、
`client.js`、`index.js`、`procedure-store-pre.js`、`tier-layer-inject-pre.js` 均已核对一致）。

---

## 0. 当前基线（压缩前实测，供新窗口复核）

| 项 | 值 |
|---|---|
| 仓库 | `D:\dsh-auto-memory`（pre 线，**未 commit 未 push**） |
| 工作区改动 | **204 项**（含本文档） |
| 窗口内 git 提交 | **0** |
| 全量回归 | `node tools/run-smoke.mjs` → **PASS 96 / FAIL 0 / TIMEOUT 0（143.3s）** |
| graph 套件 | `tests/smoke/smoke-test-graph-mode-pre.mjs` → **35 断言** |
| 三处工具数硬锁 | legacy=**14**（`smoke-test.mjs:67`、`smoke-test-m3b3-pre.mjs:43`、`smoke-test-context-observer.mjs:107`） |
| 本地 vs 远程 | 分叉：本地 `main` 领先 **122** 提交，`origin/main`(`794717d`) 领先 **60** 提交 |
| 已推送内容 | 仅 3 个文档：`README.md`、`README.zh-CN.md`、`docs/CONTRIBUTORS.html`（提交 `794717d`，零删除） |

**重要事实**：`CHANGELOG.md` **本地完好**（32KB，git 跟踪中，工作区干净），但**远程线上从来没有过**（分叉点 `89bd636` 与 `origin/main` 均无）。它是提交 `89641dc` 在**本地线**引入的。**文件没丢**，是两条历史线不同步造成的错觉。合并本地线时它会随之上线。

---

## 1. 群反馈 9 条 · 代码实测现状

来源：`docs/internal/TODO-GRAPH.html`（原文卡片 + points 已抽取核对）。
**判定口径**：已在代码中 grep 验证，非采信卡片状态。

| # | 反馈内容 | 卡片状态 | **代码实测** | 归档 |
|---|---|---|---|---|
| 1 | 接续/强制接续互锁失效；默认**不强制**接续（省成本） | P0-A 封存 3.1 | ✅ **已修（2026-09-14 解耦）** — 见 §5 调研结论 | **无需改**（卡片状态过时） |
| 2 | 设置里 subagent「模型+思考强度」**选不动** | P0-B 封存 3.1 | `subagentModel`/`reasoningEffort` 配置项**都在**；未查到 disabled 保护 | **要改** → 同 issue **#52**（无 PR） |
| 3 | 晋升开关：项目记忆→全局记忆可开可关 | P1-8 | `procedurePromotionEnabled` **存在** ✔ | 已有开关；晋升逻辑本身坏 → 见 #8 |
| 4 | 注入上限 + 可排除来源（"避免记忆问题一路走错"） | P0-4d **待开工** | 注入上限：`maxInjectChars`/`injectCap`/`snapshotMaxChars` **全 0 命中** ✘；排除来源：仅有 `superseded`，**无用户级排除** | **要改**（确未做） |
| 5 | 晋升物要**可读**（"我都不知道是啥技能"） | P1-8 | 归入 #8 | 见 #8 |
| 6 | 手机端首次指引**太大且关不掉** | P2-12 远期 | `welcomeTourEnabled` 开关**存在** | **要改** → 同 issue **#40**，有 PR **#46 未合并** |
| 7 | 日历太粗糙，**换开源方案** | P2-11 待调研 | 仍自研 `CALENDAR.md`；`fullcalendar`/`tui-calendar`/`calendar.js` **0 命中** | **本批不改**（新功能，撑大审查面） |
| 8 | 长时攻关也晋升 + skill 互相指路 | P1-8 封存 3.1 | `skillHandoff`/`breakthrough`/`longRunning` **全 0 命中** ✘ | **要改** → 同 issue **#30**，有 PR **#36 未合并** |
| 9 | webhook CI 安全收口（签名/限流/密钥） | P2-9 待确认 | `.github/cloud/qq-webhook/index.zip` **仍入库** | **本批不改**（运维项，与审查面无关） |

---

## 2. 未关闭 issue / PR 全景（15 条，2026-09-16 快照）

### 2.1 有 PR 且未合并（7 组）

| Issue | PR | 内容 | 本地是否已有修复 | 归档 |
|---|---|---|---|---|
| #38 | **#44** | 笔记容量整理净增长（每轮 +10 字符 → 最终所有写入被永久拒绝） | ❌ 无 | **P0 必合** |
| #40 | **#46** | `welcomeTourEnabled=false` 无效，向导仍自动弹；移动端浮层吞点击 | ❌ 无 | **P0 必合** |
| #45 | **#49** | `memory_recall` 够不到 ~5 天前记录（256 条 L0 预算挤出） | ❌ 无 | **P0 必合** |
| #48 | **#50** | `atomicReplace` 缺 EPERM 退避重试，Windows 并发子代理下硬失败 | ❌ 无（本地 `EPERM` grep **0 命中**） | **P0 必合** |
| #51 | **#53** | `ws-overview-rank` DATE_RE 未锚定，恢复候选误计活跃度 | ❌ 无（本地 `DATE_RE = /\d{4}-\d{2}-\d{2}/` **仍非锚定**） | **P0 必合** |
| #30 | **#36** | **技能固化永远无法晋升**（episode 候选未如实标记） | ❌ 无 | **P0 必合**（对应群反馈 #8） |
| #35 | **#37** | 自动接续 `agree` 路径绕过回合活跃防护，新旧会话并行 | ❌ 无 | **P0 必合** |

### 2.2 无 PR（需自修）

| Issue | 内容 | 归档 |
|---|---|---|
| **#52** | 子代理模型选择被旧 cfg 覆盖：已删除模型无法切换/清空 | **P0 自修**（对应群反馈 #2） |
| **#54** | **[P0] 写入侧缺保留语法过滤：单条含 `MARKER_OPEN` 的正文使整个记忆文件永久拒写** | **P0 自修**（用户新提，见 §3） |

### 2.3 已关闭（背景）

#43（channel test）、#42（gh_api 多 token 验收）——测试条目，忽略。

---

## 3. issue #54 详析（用户 09-16 15:39 新提）★

**标题**：`[P0] 写入侧缺少保留语法过滤：单条含 MARKER_OPEN 的正文会使整个记忆文件永久拒写`

**一句话**：`appendAnchoredRecord()` 只校验**文件已有内容**是否干净，**从不校验本次要写入的正文**。

**根因（带行号）**：
- `lib/memory-writer-pre.js:95-111` — `appendAnchoredRecord(content, {memoryId, text})`
  - `text` 的唯一检查是 `!text.trim()`（第 96 行）
  - `parseAnchors(buf)` 解析的是 **`buf`（既有文件）**，不是 `text`
  - 末段 `body = toEol(text, ...)` 仅做行尾转换，随后 `'<!-- memory:' + id + ' -->'` **原样拼接落盘**
- `MARKER_OPEN` 常量**只出现在** `lib/memory-anchor-pre.js:177/182`（读取路径），**写入路径零引用**
- `parseAnchors` 判定（`memory-anchor-pre.js:177-186`）：`includes(MARKER_OPEN)` → 判 `orphan-content` **fail closed**

**后果**：一次误写 → 从**下一次写入起**该文件**全部写入被永久拒绝**（`conflict:orphan-content`，size/mtime 不再变化）。不是丢一条，是**该 workspace 项目笔记写入能力整体中断**。

**为什么"转义"救不了**：`parseAnchors` **无转义机制**（不认反引号/代码块/HTML 实体）；反引号包裹不匹配 `MARKER_RE` 但 `.includes()` 照样命中 ⇒ 仍判冲突。

**用户给的修复建议**：
- **P0** 所有落盘路径（`appendAnchoredRecord()` / `renderReplace()` 等）对入参 `text`/`replacement` 做 `MARKER_OPEN` 检测。二选一，**建议先做 (a)**：
  - (a) **拒绝并明确报错** `reason: 'reserved-syntax-in-content'`（与既有 fail-closed 语义一致）
  - (b) 提供显式 `sanitizeContent(text)` 辅助，由调用方主动调用
  - **禁止静默改写**（会导致落盘内容与用户原文不一致且无感知）
- **P1** 可诊断性：当前错误不带行号/文件路径；而 `parseAnchors` 的 conflict 对象**其实已带 `line`/`byteStart`/`byteEnd`**（`memory-anchor-pre.js:184`），只是被 `memory-writer-pre.js:68/102` 的 `.map(c => c.type)` **丢掉了**。修：错误信息保留行号 + 文件路径。
- **P2**（可选）区分"本次写入引入的冲突"vs"文件本来就有冲突"（当前同一错误，误导调用方）。

**用户说"一次代码复用就可以做到"** ⇒ 指 **写入侧复用已有的 `MARKER_OPEN` 常量 + 检测**（该常量已在 `memory-anchor-pre.js` 导出/存在，写入路径 import 即可），成本极低。

**验收方法**：修复后，写入含保留串的正文应当 ① 立即返回明确错误（方案 a）或落盘已安全改写（方案 b）；② 后续良性写入不受影响。

**应急 SOP（若已逃逸）**：备份 `MEMORY.md.bak-<yyyyMMdd-HHmmss>` → Node 脚本定位「含 MARKER_OPEN 但不匹配 MARKER_RE」的行 → **仅改写该行措辞**（逐行核对，行数不变）→ 一次良性写入验证恢复。

---

## 4. 送审范围裁定（压缩后按此执行）

### 4.1 本批必改（P0，共 11 项）

**A. 合并外部 PR（7 个）**：#44、#46、#49、#50、#53、#36、#37
> 均为 Minervaowl7 提交，其上一批 #31-#34 已合并入 `origin/main`，质量可信。彼此有关联（#44↔#38 同一处容量逻辑），**建议全合而非挑选**。

**B. 自修（3 项）**：
1. **issue #54**（写入侧保留语法过滤 + P1 可诊断性）★ 用户明示"一次代码复用"
2. **issue #52**（子代理模型选择被旧 cfg 覆盖）— 群反馈 #2
3. **群反馈 #4**（注入上限 + 可排除来源，P0-4d「待开工」确未做）

**C. 已完成，无需再动（1 项）**：
4. **群反馈 #1**（接续互锁）— ✅ **已修（2026-09-14 解耦）**，见 §5 调研结论

### 4.2 本批**不改**（明确排除）

| 项 | 理由 |
|---|---|
| 群反馈 #7 日历换开源 | 卡片状态"待调研"，属**新功能**，会撑大审查面 |
| 群反馈 #9 webhook CI 收口 | 运维项，与 3.0 审查面无关 |
| **subagent 智能调度**（用户提的"智能判断是否使用子代理施行"） | **未实现的新功能**（`shouldSpawn`/`judgeSubagent`/`needSubagent` grep **全 0 命中**）。现有子代理能力是"被动调用"（时段总结/问候/自动沉淀），**不存在调度判断**。塞进本批会让审查面从 3 件事膨胀到 12 件事 ⇒ **单独排一批** |

> **必须向用户说明的一点**：用户希望"验证重构后长期系统是否做到去除 harness 记忆争议点"（① 重复多次项目如发版能否被识别为模式 ② 重大攻关/有价值套件 skill 化 + 智能调度子代理）。
> **修 issue/PR 不经过"长期记忆系统"这条路，两者没有验证关系**——修 bug 是修 bug。
> 真实验证点应落在：
> - ①/②：`lib/procedure-store-pre.js` 的 `sessionDiversity≥3 && successCount≥2` 晋升门槛 + `observed/candidate/validated` 三级 + `/memory-hub` 审批队列。**但该能力现在是坏的**（issue #30）⇒ 修 #30/#36 后**才具备验证前提**。
> - ③：**根本没实现**，不是"重构后没做好"。

---

## 5. 群反馈 #1 调研结论（已修，无需再动）★

**用户裁定**：「我觉得应该是修好了。」→ **调研证实用户判断正确。**

### 5.1 一个误导性信号（我上次的取证错误，须记住）

`git log -S "forceContinue"` **全历史零命中** —— 该字样**从未在代码里存在过**。
"强制接续"是群里描述症状的**口语说法**，不是配置键名。
⇒ **凭"某字样消失"判定功能被移除是错的。** 判"是否修好"必须找**行为断言**：
解耦注释 + 判定函数收口 + 回归套件，而不是找字样。

### 5.2 三处带日期、带根因的解耦（真修复）

| # | 位置 | 修的内容 | 注释原文要点 |
|---|---|---|---|
| 1 | `lib/index.js:2562` | **关白板 ⇒ 自动接续被静默关掉** | 旧实现 `if (handoffEnabled === false) return` ⇒ 水位永不测量 ⇒ `waterLevelModelKnown` 永不写入 ⇒ `shouldArmAutoContinuePre` 的 fail-closed 闸永远拒绝 arm ⇒「**关白板会把自动接续一并静默关掉（实证：确认卡永不出现）**」。改为**测量与白板解耦**（测量只读，产物另由 `handoffEnabled` 把关） |
| 2 | `lib/index.js:2740` | **反向耦合**：白板关 + 水位越阈 ⇒ 照样写账本并覆盖快照 | 「测量放行后，这条**产物**写入必须由 `handoffEnabled` 单独把关，否则『白板关 + 水位越阈』会照样写交接账本并覆盖 `latestHandoffText`（反向耦合）」 |
| 3 | `lib/index.js:3189` | **卡片可用性**被白板连累 | 「旧实现的 `&& handoffEnabled !== false` 是**同一处耦合的第二份副本**（白板关 ⇒ 卡片报 disabled）」⇒ 改为只判 `autoContinueEnabled` |
| 4 | `lib/index.js:5218` | 完整复盘（设计说明） | 「**不是记错，是开关耦合的缺陷**：改前 `autoContinueEnabled` 只管接续资格与 GUI 卡片可用性；而水位自动账本写入只判 `handoffEnabled`/`waterLevelAutoHandoff`，**从不看接续开关**。症状即『不跳窗口、却照样写账本并覆盖 `latestHandoffText`』」+ 语义依据：`waterLevelAutoHandoff` 唯一目的是给自动接续备料，接续关了 ⇒ 没人来接 ⇒ 账本无用且污染快照 |

### 5.3 当前三开关语义（已解耦）

```
handoffEnabled        = false   # 白板：只管产物（写/读 PLAN + 账本）
autoContinueEnabled   = false   # 接续：只管资格 + 卡片可用性
waterLevelAutoHandoff = true    # 水位账本：受 handoffChainEnabledPre() 统一把关
```

判定**同源**：`handoffChainEnabledPre()`（`lib/index.js:5234`）统一收口，
注释明写「与置位点、写入点同源，**避免三处条件漂移**」。

### 5.4 有回归套件锁住（非口头承诺）

```
tests/smoke/smoke-test-switch-decouple-pre.mjs      24.0KB  ← 专门锁"开关解耦"
tests/smoke/smoke-test-autocont-host-pre.mjs        35.1KB
tests/smoke/smoke-test-water-hard-trigger-pre.mjs   12.9KB
tests/smoke/smoke-test-water-step-pre.mjs            6.3KB
tests/smoke/smoke-test-water-window-pre.mjs         16.2KB
```

**结论**：群反馈 #1 **已修**，`TODO-GRAPH.html` 的 P0-A 卡片状态「封存（3.1）」**已过时**，
可在下次回写看板时更新为「已解耦（2026-09-14）」。**本批不动此项。**

---

## 6. 施工顺序（**已于 2026-09-16 执行完毕**）

```
第 1 步  合并远程 60 提交 → 本地（解决 CHANGELOG 缺失 + 拿到已合并的 #31/#32/#33/#34）
         ⚠️ 不可逆操作 —— **本轮未执行**（等用户裁定；不阻塞其余施工）
第 2 步  合并 7 个外部 PR  → ✅ 已移植 6 个；#37 因与用户裁定冲突**挂起待裁**
第 3 步  自修 3 项（#54 ★ / #52 / 群反馈 #4）→ ✅ 全部完成
第 4 步  群反馈 #1 —— ✅ 已确认为已修（2026-09-14 解耦），跳过（见 §5）
第 5 步  全量回归 + 定向变异演示 → ✅ **PASS 104 / FAIL 0 / TIMEOUT 0（159.0s）**，7 组变异全部真失败
第 6 步  → 交 ChatGPT 验收（任务书：docs/internal/GPT-ACCEPTANCE-PROMPT-20260916.md，
         按本批新增内容更新「声称交付」章节）—— **待执行**
第 7 步  按验收结论修完 → 一起提交推送 —— **待执行（需用户明确同意）**
```

**关键经验（写给下一个窗口）**：外部 PR 打的是**发布线布局**（`lib/memory-writer.js` 等裸名），
而 pre 线运行的是 `-pre.js` 具名模块 ⇒ **`git apply` 必然失败**。正确姿势是：
① `git fetch origin pull/<n>/head` 取分支实体；② 读 PR 的**意图与根因**；
③ 在 pre 线**按根因重写**（保留 pre 线已有的加固，如 `isCurrentPre` 状态闸、`compactAnchoredLayer` 重做）；
④ 落 PR 自带测试并把 `import` 路径改到 `-pre` 模块、把发布线命名（`memory_recall`/`idx_`/`proc_`/`hub`）
改回 pre 线命名（`memory_recall_pre`/`idx_pre_`/`proc_pre_`/`hub-pre`）；
⑤ **不要假设 PR 的测试是充分的** —— #36 的用例没覆盖它自己的根因（同名碰撞链），必须补断言。

---

## 7. 硬约束（贯穿全程）

1. **禁止无差别杀 node 进程**（DSH harness 与插件宿主都在 node 上，2026-09-14 出过事故）。
2. **`dsh web` 宿主由用户自行重启**，agent 只改文件并说明需重启；严禁 `Stop-Process`/`Start-Process`。
3. **无 BOM**（任何文件写完须校验前 3 字节 ≠ `EF BB BF`）。
4. **大文件分块写**，一次工具调用不写超大内容。
5. **改前备份**（`*.bak-YYYYMMDD-<tag>`）；**变异演示基线必须是当前版本备份**（旧备份曾整体回滚改造）。
6. **代码留在 pre 线**，未经用户明确同意不 commit/push/publish。
7. 结论必须附代码/日志证据；推断显式标注为推断。
8. **先核 evidence 再采信**：卡片状态、记忆自述、他人交接声明一律以硬证据为准。

---

## 8. 关键路径索引

| 用途 | 路径 |
|---|---|
| 全量回归 | `D:\dsh-auto-memory\tools\run-smoke.mjs` |
| graph 端到端套件 | `D:\dsh-auto-memory\tests\smoke\smoke-test-graph-mode-pre.mjs`（35 断言） |
| issue #54 根因文件 | `D:\dsh-auto-memory\lib\memory-writer-pre.js`（:95-111、:68/:102） |
| issue #54 检测常量 | `D:\dsh-auto-memory\lib\memory-anchor-pre.js`（:27-29 常量、:177-186 判定、:184 带行号） |
| 技能晋升逻辑 | `D:\dsh-auto-memory\lib\procedure-store-pre.js`（:251 `promote()`、:54 门槛） |
| 群反馈原始卡片 | `D:\dsh-auto-memory\docs\internal\TODO-GRAPH.html`（P0-A/P0-B/P0-4d/P1-8/P2-9/P2-11/P2-12） |
| 送审任务书 | `D:\dsh-auto-memory\docs\internal\GPT-ACCEPTANCE-PROMPT-20260916.md` |
| 本次全量粗检审计 | `D:\dsh-auto-memory\docs\internal\AUDIT-WB-GRAPH-FULL-20260916.md` |
| 施工方自审（3 致命+6 高/中危） | `D:\dsh-auto-memory\docs\internal\REVIEW-WB-GRAPH-SELF.md` |
| 3.0 蓝本 | `D:\dsh-auto-memory\docs\internal\MASTER-PLAN-3.0.md` |

---

**归档时间**：2026-09-16 21:20 · **归档人**：施工方（本窗口 agent）
**数据来源**：GitHub API 实时查询（`state=all`，15 条未关闭）+ `TODO-GRAPH.html` 卡片抽取 + 代码 grep 实测
