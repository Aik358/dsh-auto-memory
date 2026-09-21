# 长期记忆系统 · BUG 总清单（可执行版）

> 2026-09-21 · 对象 `D:\dsh-auto-memory`（pre 线）
> 来源：4 批审计报告 + 1 份子代理探针复核
> 状态标记：☐ 待修 · ◐ 修复中 · ☑ 已修（每条修完必须：跑新守卫 + 全量回归 + 逐字还原验证）
>
> ⚠️ 首批（A 批 9 条 + P2 若干）**已按用户「就可以开始改了」授权落地**，改动全在 pre 线工作区，未提交未推送。
> 验收证据见本文件末尾「§9 修复验收记录」。

---

## 一、修复批次总览

| 批 | 内容 | 风险 | 前置 |
|---|---|---|---|
| **A** | 9 条确定性 bug（无设计歧义） | 低 | 无 |
| **B** | 4 条需定形态 | 中 | 需用户选方案 |
| **C** | 3 条架构收敛 | 高（动面大） | 建议 A 批后 |
| **D** | 存量数据清理 | 中（碰数据） | 需备份 |
| **E** | 召回/注入链路（等子代理） | — | 子代理报告 |

---

## 二、A 批 · 确定性 bug（可直接修）

> **状态：A 批 9 条全部 ☑ 已修**（2026-09-22 落地，守卫套件 44/44，全量回归 PASS 149 / FAIL 0）。
> 逐条证据见 §9。

### ☑ A-1 清洗器漏网 `Reference: - HH:MM [kind:x]` 残片
- **位置**：`lib/intent-clean-safe-pre.js:146`（`RUNTIME_RESIDUE_RE`）
- **证据**：`node` 直跑真实串 **未命中、原样通过**；该串 09-20 仍写入 `facts.json`（`fact_pre_9a706422e`）
- **修法**：正则补 `Reference:\s*-\s*\d{1,2}:\d{2}\s*\[kind:` 前缀族
- **验收**：新守卫套件用**真实脏串**断言 `looksRuntimeResiduePre` 为 true；全量回归不降

### ☑ A-2 handoff 账本超 8000 字被**静默截断**
- **位置**：`lib/index.js:10134`（闸门）、`:10151-10153`（返回值不带 truncated）
- **证据**：`:8627` 超限是「截断 + `truncated:true`」返回 ok；note 分支 `:10184` **有**提示，handoff 分支**没有**（不对称即 bug）
- **影响**：账本被砍掉尾部「进度与下一步」（跨窗口续命材料），模型仍收到「已写入」
- **修法**：与 note 分支对齐，返回值拼 `gateH.truncated` 提示 + 实际长度

### ☑ A-3 factId 重复主键 ⇒ 新事实被永久跳过
- **位置**：`lib/fact-store-pre.js:209`（新建 push 无唯一性检查）、`:283`（supersede 只置 revoked）、`restore` 不去重
- **证据**：探针实测 `facts=2 / unique=1 / DUP ID=true`；受害者 `lib/index.js:9299` 用 `factId` 做写回去重键
- **修法**：`upsert` 新建前查同 id → 命中走「复活 + merge」；`restore` 按 `factId` 去重

### ☑ A-4 状态行写入破坏目标条目 CRLF
- **位置**：`lib/note-status-pre.js:144`（`split(/\r?\n/).join('\n')`）、`lib/note-status-apply-pre.js:88`
- **证据**：探针实测 CRLF 13→9、出现裸 LF；与文件头「逐字节保持原样」承诺相反
- **修法**：按 `detectNewline` 决定 join 分隔符（或按行切片原样重组）

### ☑ A-5 `procedureCorrectionCap` 的 `|| 0.3` 让「0」不可表达
- **位置**：`lib/index.js:9159`
- **证据**：**相邻两行**（`:9157/:9158`）已刻意改成有限性判据，本行漏改
- **修法**：`Number.isFinite(v) && v >= 0 ? v : 0.3`

### ☑ A-6 `validateProcedurePre` 不校验 `evidence` + `addEvidence` 抛错被吞
- **位置**：`lib/procedure-store-pre.js:71`（校验清单缺 evidence）、`:206`（直接 `p.evidence[...]++`）
- **影响**：缺键 → `NaN` 静默通过（算术得 NaN）；缺 evidence → TypeError 被 `index.js:7644` 空 catch 吞 ⇒ 「证据永不累积」无留痕
- **修法**：校验加 evidence 形状；`addEvidence` 首行 `p.evidence = p.evidence || {...}`

### ☑ A-7 episodic `current` 不按 sessionRef 隔离
- **位置**：`lib/episodic-store-pre.js:130`（只在空时取 sessionRef）、`:227/:235`
- **证据**：探针实测 `sessionRef=session-A` 但 `intent` 含 session-B 内容、`provenance=["seg:1","seg:1"]`
- **影响**：★ **第二条「晋升不了」成因** —— `distinctSessions` 被系统性低估 ⇒ 统计门永不达标
- **修法**：`append` 检测 sessionRef 变化时先 `consolidate()` 再开新 `current`；provenance 用 `sessionRef:eventSeq`

### ☑ A-8 三个 store 的 `persist()` 吞掉落盘失败
- **位置**：`lib/fact-store-pre.js:367`、`lib/episodic-store-pre.js:357`、`lib/procedure-store-pre.js:491`
- **影响**：与 A-3 同后果（`flushed` 标记已推进但盘上没写）⇒ 该条永不重写
- **修法**：`persist()` 返回结果并向上透传（至少 `diag`）

### ☑ A-9 前端晋升按钮条件 ≠ 真实门限（自毁式误导）
- **位置**：`lib/client.js:3385`（`!p.observationOnly` 就显示按钮）
- **影响**：对着结构上不可能晋升的条目反复点，只见一行灰字 ⇒ 用户感受「批准不了」
- **修法**：改为依赖已有的只读投影 `p.promotion.decision === 'promote'`；`keep` 时显示原因

---

## 三、B 批 · 需用户定形态

- **☐ B-1 高风险条目「批准」通路缺失**（`index.js:9152` 未传 `opts.approve`；路由白名单 `:10900` 无 approve 动作）⇒ `approved` 无任何代码能置真。
  方案：A 路由加 `action:'approve'` + store 加 `approve()` 原语（最小、语义清晰）／B 设置页批量批准／C 其它。**建议 A。**
- **☐ B-2 `procedurePromotionEnabled` 语义错配**（默认 false，实为**技能注入总闸**，`context-host-pre.js:537`）。
  方案：拆成 `procedureInjectEnabled`(默认 true) + `procedureAutoPromoteEnabled`(默认 false)／或改默认值 + 改文案。
- **☐ B-3 事实性判据缺失**（对话发言直接当 fact subject，实测 3/10）。
  方案：A 收紧入口（要求陈述形态）／B 打标低置信 + 前端折叠。
- **☐ B-4 M8-1 认识论字段零落地**（10/10 缺 `epistemicStatus`）。修法：写入侧补默认值（inference→observation，explicit→fact）。

---

## 四、C 批 · 架构收敛（动面大，建议 A 批之后）

- **☐ C-1** `promote()` 与 `evaluatePromotion()` 双份门限（**已在「授权」维度不一致**）⇒ 合一
- **☐ C-2** 清洗逻辑散在三处（`memory-hub-pre.js:186/:288`、`index.js:9313`）⇒ 抽唯一 `sanitizeFactFieldPre`
- **☐ C-3** 26 对 `-pre`/非 `-pre` 全部漂移 + 旧世界自洽（12 文件 13 条 import 边）⇒ 删/隔离
  - ⚠️ **删前必做**：核对 `tests/` + `tools/` 对非 `-pre` 文件的引用（尚未做）

---

## 五、D 批 · 数据（需先备份）

- **☐ D-1** 存量脏数据：`facts.json` 10 条中 3 条结构性垃圾（编码损坏/信封/漏网残片）
  - 建议：**只标记不删**（`quarantined:true`），交用户裁决
- **☐ D-2** `~/.dsh/memory/hub/`（395 B 空壳）与 `hub-pre/`（39 KB）并存 ⇒ 改名隔离

---

## 六、E 批 · 召回/注入链路（第 5 批已补齐）

### ★☐ E-1【最高优先级】违反「JS/Python 两引擎独立、严禁联动」铁律（3 处硬耦合）
- **这是用户 2026-09-10 明确拍过板的铁律被代码违反**，非设计意见分歧。
- 位置：`index.js:2051-2061`（选一档顺带改写 `activationSource`/`contextSinkMode`/`pythonBackendEnabled` 三处）
  · `:9575` + `:9602`（两臂互斥，一方存在决定另一方是否生效）
  · `:9430`（Python 档 L0 索引仍写死 JS 引擎 `embedPassages`）
- 后果：纯 Python 用户（未装 JS 模型）**L0 索引长期静默失效**。
- ⚠️ **需用户先定形态**：「严格独立、无隐式回退」vs「允许自动回退」是产品决策。

### ☐ E-2 RRF divisor 把秩贡献压成常数（排序实质退化）
- `recall-fusion-pre.js:19-22`（k=divisor=60）、`:131-132`。rank1 vs rank100 只差 **1.7%**，
  与文件头 `:50-53` 自述矛盾 ⇒ 融合序退化为「命中臂数 + memoryId 序」。
- ⚠️ 未确认是否有意设计；其常量一致性守卫套件**未在 `tests/` 定位到**。

### ☐ E-3 注入总预算不是硬门
- `index.js:5713`（只当报告值）→ `:5733`；`:5724-5725`（`otherDynamic` 默认无限）；
  `memory-envelope-pre.js:229-236`（超额标 `inject:false` 后被过滤 ⇒ 模型看不到）。

### ☐ E-4 两套 token 口径，水位用低估的那套
- `index.js:3676-3683`（÷4，被 `:3094` 水位用）vs `tier0-catalog-pre.js:135-144`（÷2）；
  而 `tier-layer-inject-pre.js:643-644` 自称「全链路只有一个口径」。⚠️ 幅度为**推断**。

### ☐ E-5 融合路径静默吞错 + importance 违反契约
- `index.js:6299` 空 catch（对照 `:6216`/`:6254` 都留痕）；
  `:6289` importance 在入融合前乘到 dense，违反 `recall-fusion-pre.js:15` 的「禁止 score-space 加权」。

### ☐ E-6 其余 P2（5 条）
融合输出未按 memoryId 去重（`:6285`/`:6298`）· `semanticArm` 恒 true 使降级分支永不触发（`:5289`）·
`extBudget` dead config（`:5672`）· 预算注释三方漂移（`:298`/`:5646`/`:5222`）·
`memory-importance-pre.js:21-23` 自述未接线但已接线。

### ☐ E-7 静默吞错清单（建议统一走 diag + degradeSink）
无留痕：`:6370`（外部记忆）、`:6378`（历史会话）、`:6381`（跨工作区）、`:6458`（语义节）、
`:5445`、`:10063/:10071/:10085`；未 await：`:9476`（catch 也空）、`:4707`、
`context-host-pre.js:706`（**对照 `:660` 是 await** ⇒ 竞态）。

---

## 七、P2 清理项（随手修）

> **本轮已收：P2-2 / P2-3 / P2-5 / P2-7 / P2-11（☑）**；其余仍 ☐ 待排期。
> P2-11 修复过程中同源带出「episodic.append 完全不落盘」，一并修掉（见 §9）。

| # | 项 | 位置 | 状态 |
|---|---|---|---|
| P2-1 | `stats.superseded` 死计数器 / `'superseded'` 结果码不可达 | `fact-store-pre.js:141/:272` | ☐ |
| P2-2 | 查询返回浅拷贝，数组字段共享引用 | `fact-store-pre.js:306/:318`、`procedure-store-pre.js:421` | ☑ |
| P2-3 | `candidate` 死状态 + `stats.candidates` 死统计 | `procedure-store-pre.js:41/:133` | ☑ |
| P2-4 | `applyAutomaticTransitions`（90 天老化）零调用 | `procedure-store-pre.js:241` | ☐ |
| P2-5 | `promote()` 拒绝也返回 `ok:true` | `procedure-store-pre.js:301-311` | ☑ |
| P2-6 | `restore()` 静默跳过无计数 | 三 store | ☐ |
| P2-7 | `renderChecklist` 硬截 2000 字（尾部静默消失） | `procedure-store-pre.js:454` | ☑ |
| P2-8 | `procedureCandidateFromRow` 步骤压成单行 | `memory-hub-pre.js:326` | ☐ |
| P2-9 | `hubFlushTick` 里 `currentRuntime()` 可能 null | `index.js:9332` | ☐ |
| P2-10 | `tailHas` 判据极弱 + 旁路绕过 | `index.js:8649`、`:9353` | ☐ |
| P2-11 | `episodic.append` 不落盘、`consolidate` 不去重 | `episodic-store-pre.js:125/:241` | ☑ |

---

## 八、修复纪律（每条都必须做到）

1. **先备份**：`Copy-Item lib/x.js lib/x.js.bak-<ts>`
2. **改前读、改后核**：`edit` 后确认命中次数 + `node --check`
3. **守卫先行**：能写断言的 bug 先写 RED，再修成 GREEN
4. **逐字还原验证**：变异测试后必须 SHA256 一致
5. **全量回归**：`node tools/run-smoke.mjs`（基线 PASS 148 / FAIL 0）
6. **不提交不推送**（pre 线纪律）；宿主由用户重启

---

## 九、修复验收记录（2026-09-22）

### 9.1 验收结论

| 项 | 结果 |
|---|---|
| 新守卫套件 `smoke-test-bugfix-a-persistent-memory-pre.mjs` | **PASS 44 / FAIL 0** |
| 全量回归 `node tools/run-smoke.mjs` | **PASS 149 / FAIL 0 / TIMEOUT 0**（49s；基线 148 套 → 本轮新增 1 套） |
| `node --check` 全部改动文件 | 8/8 OK |
| 断言非空性（新守卫不得是空断言） | 对 `git HEAD` 逐条跑 → 期望 RED 的两条实测均 RED |
| 备份 | `lib/*.js.bak-2026092*-bugfixA` / `.bak-*` 共 7 份，SHA256 已记录 |

### 9.2 改动文件

`lib/intent-clean-safe-pre.js`(A-1) · `lib/index.js`(A-2/A-5) · `lib/note-status-pre.js`(A-4) ·
`lib/client.js`(A-9) · `lib/procedure-store-pre.js`(A-6/P2-3/P2-5/P2-7) ·
`lib/fact-store-pre.js`(A-3/P2-2) · `lib/episodic-store-pre.js`(A-7/A-8/P2-2/P2-11)、
新增 `tests/smoke/smoke-test-bugfix-a-persistent-memory-pre.mjs`。

### 9.3 两个方法论修正（本轮踩到，值得记）

1. **CRLF 让「去注释」失效 ⇒ 负向断言假红/假绿。** 本仓文件是 CRLF，`split('\n')` 后行尾残留 `\r`，
   `/\/\/.*$/` 因 `.` 不吃 `\r`、`$` 只匹配串尾而**完全失效** ⇒ 注释里引用的旧代码会被当成真代码。
   修法：`split(/\r?\n/)`。P2-3 断言正是被它误报过。
2. **断言要按「代码形态」写，不能按「想象中的形态」写。** P2-3 原断言查字符串 `stats.candidates`，
   而真实形态是对象字面量的键 `candidates: 0` —— 该断言从未守卫到真东西（HEAD 已证）。
   改为标识符级 `\bcandidates\b` 后，对 HEAD 为 RED、对当前为 GREEN。

### 9.4 需要顺带修的旧断言（A-9 改条件形状后的连带影响，3 处已修）

- `smoke-test-t4-procedure-model-write-pre.mjs`（`promoted:` 追加后断言命中位置失效）
- `smoke-test-r1r6-readability-pre.mjs` R6-2（相邻字面量配对失效）
- `smoke-test-issue30-procedure-promotion-pre.mjs`（同上）
三处一律**改为按意图断言并保留原契约**（如「观察型不得有晋升按钮」拆成两步验），不是删断言。

### 9.5 队友（store-fixer）自报残留 —— 本轮**未做**，转下批决策项

| # | 残留 | 判定 |
|---|---|---|
| R-1 | `dispose()` 返回值由 `undefined` → `{ok,persisted}` | **已核销**：唯一调用方 `memory-hub-pre.js:273` 在 try/catch 内忽略返回值 ⇒ 无翻面风险 |
| R-2 | `getLastPersistError()` 已暴露但**无消费方** | 真缺口 ⇒ 记 P2-12（需宿主接 diag，属 A/B 之外的接线） |
| R-3 | `append` 改为逐段落盘 = IO 放大 | 需节流策略（新决策），记 P2-13 |
| R-4 | 会话切换时单段缓冲被 `too-short` 丢弃 | 既有语义，触发面变大 ⇒ 记 P2-14 |
| R-5 | `provenance` 由 `seg:N` → `sessionRef:N`，盘上旧数据混存 | 无消费方断言旧格式（已 grep）；记 P2-15 待迁移 |
| R-6 | P2-1 只覆盖 `supersede()`，`resolveConflict(choice='right')` 未补计数 | 口径仍不一致 ⇒ 记 P2-16 |
| R-7 | `stats.revoked` 是累计事件计数、复活不回减 | 口径说明已进注释，展示层需按同口径 |

### 9.6 下一步

- **B 批（4 条）需用户定形态** —— 尤其 B-1「高风险条目批准通路」与 B-2「`procedurePromotionEnabled` 拆开关」；
  后者同时命中用户既有硬规则「单一开关不得顺带改变其他功能的行为」。
- 大屏适配按 `PANEL-PAGE-MIGRATION-DIRECTION.md` 执行（用户已拍板骨架，等本轮收口后开始）。
- 宿主由用户自行重启（本轮只改文件）。
