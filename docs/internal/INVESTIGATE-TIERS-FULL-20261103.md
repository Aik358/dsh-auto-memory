# 四档全覆盖调查：user_full / user_slim / run_full / run_slim（P9 追加轮）

> 调查日期：2026-11-03 · **只读调查，未修改 `lib/` 任何文件**、未 commit / 未 push / 未改版本号。
> 上一份报告：`docs/internal/INVESTIGATE-USER-TIERS-20261103.md`（只覆盖 user 侧，本报告不覆盖它）。
> 证据目录：`artifacts/inject-tiers-full-20261103/`（四份生产形态文本 + 五份对照文本 + `metrics.json` + 两份两两矩阵 CSV + 可复算脚本）。
> 行号基准：`lib/index.js` **27,009 行 / 1,938,567 B / sha256(前16)=`28355507e0b5f2e0`**；行号较上一轮整体 +14 左右，本轮全部重测，并已对 64 条行号断言做机械校验（见附录 C）。

---

## 摘要（先给结论）

1. **枚举里是 8 个键（7 个功能性档 + 1 个 LEGACY 回退）**，不是「四档」。四档（user_full/user_slim/run_full/run_slim）只是其中 4 个。
2. **四档在生产全部可达，但「可达」分两种形态**：`user_full`/`run_full` 由**全帧渲染器** `renderMemoryDynamic` 产出；`user_slim`/`run_slim` **只以「精简帧」形态存在**（`renderSlimSnapshotPre`，2,219 / 1,999 字符）。
3. 因此**全帧渲染器里那一整套 `*_slim` 内容裁剪（规则摘要 4,189、白板核心节 1,884、不投画像）是生产死代码** —— 时序是「先渲染全帧（L21899）→ 再降级档位（L21925-21928）→ 再渲染精简帧（L21932）」。
4. **四档两两之间没有一对 sha256 相同**（8 对全查，见 §C8）。但**跨到 8 档时** `human_full` 与 `handoff_carry` **逐字节相同**（sha `e259f807…`，24,574 字符），点名于此。
5. **`user_slim` 与 `run_slim` 的差异只有 220 字符 / 3 行**（`[当前事件]` 68 + `[用户画像]` 88 + `[取全文]` 64）。两者共用同一渲染器，仅靠 `_slimNeedsHumanCtx = !(_slimTierPre === 'run_slim')`（L9957）分叉。
6. **`run_full` 的规则摘要渲染是坏的**：4,189 字符的 66 行摘要里，**5 行是 `- - ` 双横线、61 行是 `- ## 2026-09-22 …` 日期头泄漏**（`_renderRulesSlimInline` L11176 只做「取首句 + 截 60 字」，没有剥 `extractRulesLayerPre` 带出的 markdown 前缀）。
7. **run 侧没有自己的水位逻辑**：水位计算全仓仅 1 处（L22073-22086），授予口 L22384 要求 `isHuman` ⇒ run 侧永远不因水位拿到全帧。run 侧全帧触发只有「20 步门槛」与「F7 挂机补偿（默认关且已被 `_rqK` bug 打死）」。

---

## §A 四档矩阵

### A1 枚举与判定函数：共 8 个键，判定函数 5 个，其中 **3 个生产消费为 0**

| # | 键 | 值 | 定义行 | 设计语义（注释原文） |
|---|---|---|---|---|
| 1 | `LEGACY` | `legacy` | `L1800` | 「未判定档位时的回退值 —— 等同 P3 之前的全部行为」 |
| 2 | `HUMAN_FULL` | `human_full` | `L1802` | 「白板全文 + 规则全文 + 画像 + 日历 + semantic-recall」 |
| 3 | `HUMAN_SLIM` | `human_slim` | `L1804` | 「核心 3 节白板 + 事件卡 + 画像摘要 + semantic-recall」 |
| 4 | `RUN_FULL` | `run_full` | `L1806` | 「规则全文 + 核心 3 节白板（**不给画像** —— 无人消费）」 |
| 5 | `RUN_SLIM` | `run_slim` | `L1808` | 「规则标题+条数 + 不投白板」 |
| 6 | `POST_COMPACT` | `post_compact` | `L1810` | 「核心 3 节白板 + 规则全文 + 「刚才压缩了」提示」 |
| 7 | `HANDOFF_CARRY` | `handoff_carry` | `L1812` | 「白板全文 + 账本 + 指针」 |
| 8 | `HANG_COMPENSATE` | `hang_compensate` | `L1814` | 「同 F3 内容（完整版），仅触发时机不同」 |

> ⚠️ 枚举注释 R4-L1806 与 R6-L1810 已与实现漂移：`run_full` 实际给的是**规则摘要**（4,189）不是全文；`post_compact` 实际给的是**白板全文**不是核心 3 节（见 §A2/§C）。

**判定函数与消费点（严格统计：按 `\bname\s*\(` 计数并剔除纯注释命中）**

| 判定函数 | 定义 | 调用点 | 生产消费？ |
|---|---|---|---|
| `decideInjectTierPre` | `L1975-1984` | `L21847`（唯一一处，且 `isFull: true` **硬编码**） | ✅ 是（但永远只能产出 `*_FULL`；另有三处覆盖：`hang_compensate` L21853、`handoff_carry` L21858、`post_compact` L21891-21892） |
| `planSpecForTierPre` | `L1994-1999` | **无**（仅被自身内部的谓词调用） | ❌ **0**（整套 `planSpecForTierPre`/`isPlanFullTierPre`/`shouldInjectPlanPre` 簇只有测试在用） |
| `isRulesFullTierPre` | `L1863-1868` | `L11211`（**命中在注释里**） | ❌ **0**（生产用的是同函数内 L11217 的**内联副本** `_rulesFullTierInline`） |
| `isHumanTierPre` | `L1818` | **无** | ❌ **0** |
| `renderRulesSlimPre` | `L1929-1953` | **无** | ❌ **0**（生产用 L11176 的内联副本 `_renderRulesSlimInline`） |
| `renderOverview`/`decideWaterPctFirePre`/`parseWaterPctThresholdsPre`/`decideHangCompensatePre` | `L2051` / `L2001` / `L1904` | `L22086` / `L22073` / `L22368` | ✅ 是（水位与挂机判定纯函数本身是活的；但**授予分支被 `_rqK` bug 打死**，见 §B5） |

⇒ **同一语义存在两份以上实现**：模块级纯函数（测试专用）+ 函数体内联副本（生产）。`INJECT_TIERS` 枚举同样有内联副本 `_T`（`L11109-11114`）。这是本仓已固化的「恒真守卫」形态：套件全绿 ≠ 功能生效。

### A2 run_full / run_slim 的设计意图（三处权威来源逐条对照）

**① 用户设计纲要（2026-10-27 定稿，见 `docs/internal/INJECT-TIER-DEFECTS-20261028.md` §1）**

| 档位 | 触发时机 | 内容要求 |
|---|---|---|
| `user_full` | ①压缩后 ②水位跨 25% ③水位跨 50%（均为之后第一条 user 信息） | 全量投送，**不设上限或上限相对大** |
| `user_slim` | 其余 user 发声轮次 | **核心节**，专注当前事项；**不投规则全文** |
| `run_full` | **每 20 步一次** | 形式**与 `user_slim` 类似**：核心节 + 不投规则全文 |
| `run_slim` | **每 8 步一次（最克制）** | 只有功能指导相关内容；可承载记忆唤回 |

**② 代码注释（`L1780` 用户核心裁定逐字）**：「用户发声的完整版 / 用户发声的精简版 / 运行当中的完整版 / 运行当中的精简版 / 压缩后的完整提醒 / 交接的文档注入 —— 要分开考虑，不可混为一谈。」

**③ git log（`ad767a39` / `432829e7` / `6330616b`）**

- `ad767a39`（P3+P4 七档落地）：「白板按档位投递：F1/F6 全文 · F2/F3/F5/F7 核心 3 节 · F4 不投 · LEGACY 全文」；「规则段档位化：…仅 F4 走摘要，其余给全文」（**已被后续提交改写**）；「画像段档位化：F3/F4/LEGACY 不投画像」；「F7 挂机代位补偿…默认 false」。
- `432829e7`（三轮修复）：「human_slim / run_slim 生产不可达 … 修复：渲染精简帧前按真实形态降级为 `*_slim`」+「落实用户裁定『run_slim 最克制，事件卡与画像不该给』：run_slim 精简帧 2,180 → 1,999，事件卡/画像归零」。**本报告实测 `run_slim` = 1,999 字符，与该提交声明逐字吻合**。
- `6330616b`：「只有 human_full / handoff_carry / post_compact（规则 8,291 + 白板 8,000 预算）才爆 [桶上限]；run_full 白板预算仅 3,000 且规则段只占 4,142，桶有余量」——**这是 run_full 与 user_full 预算不同的直接来源**。

**⇒ run 侧与 user 侧的应然区别（合成三条）**：①**有没有人际语境**：画像 / semantic-recall / 日历只给真人档（`L11512` semantic 门、`L11561` 画像门）；②**白板预算**：真人全帧档 8,000，run_full 走瘦档 3,000（`L11305-11309`）；③**节奏**：run 侧只有 20 步 / 8 步节流，不参与水位与真人旁路。

### A3 实测：run 场景（挂机/自跑）四档文本

场景构造（可复算）：真引擎 + 真实记忆数据；`engine.config.unattendedMode = true`（`isUnattendedNow()` 的实现见 `L?`：`config.unattendedMode === true` 直接为真）；无真人消息事件、无 `_humanPending`。

| 文件 | 档位 | 形态 | 字符 | 字节 | 行 | sha256（前 16） | 段标题清单 |
|---|---|---|---|---|---|---|---|
| `U1-user_full.txt` | `human_full` | 全帧 | 24,574 | 48,119 | 315 | `e259f807d70ea1f5` | **21** 段（规则全文 8,683 / 画像 / semantic / 日志 / 用户级记忆 …） |
| `U2-user_slim.txt` | `human_slim` | **精简帧** | 2,219 | 4,717 | 18 | `a4eb29d1afe38033` | 9 段（检索指引 / 当前事件 / 画像 / 取全文 / 精简说明 / 结构说明 / 唤回） |
| `R1-run_full.txt` | `run_full` | 全帧 | 17,727 | 32,817 | 272 | `1ae27c152c581c39` | 14 段（规则**摘要** 4,189 / Tier-0 / 白板核心 / 账本 / 事件卡 …） |
| `R2-run_slim.txt` | `run_slim` | **精简帧** | 1,999 | 4,312 | 14 | `d393531b514ef082` | 6 段（检索指引 / 精简说明 / 结构说明 / 唤回 …，**无当前事件/画像**） |

段清单差异（实测标题，去重后）：

- **U1 独有**（相对 R1）：`[用户规约超预算线]`（150）、`[用户规约 — 跨项目通用 · 必须遵守]`（5,539/49 条）、`[项目规约 — 本项目必守]`（2,582/17 条）、`[长期关系记忆]`（915）、`[用户画像 · 从已采纳的人类反馈中提炼]`（615）、`[最近 1 天工作日志(尾部)]`（770）。
- **R1 独有**（相对 U1）：无新增逻辑段（R1 是 U1 的子集式裁剪：缺上述 6 段；规则段标题与形态不同——U1 是 `[用户规约…]`+`[项目规约…]` 全文，R1 是 `[规则 — 用户级硬性约束]` 摘要）。
- **U2 独有**（相对 R2）：`[当前事件]`（68）、`[用户画像]`（88）、`[取全文] memory_recall(...)`（64）——共 **220 字符**。
- **R2 独有**：无（R2 是 U2 删 3 行）。

⇒ run 侧的设计意图在**结构上确实实现了**（run_full = 核心节 + 规则摘要 + 无画像；run_slim = 只有功能指导）。但 run_full 的规则摘要**渲染质量是坏的**（§B5·缺陷 R-a）。
---

## §B 可达性（本轮最关键）

### B4 逐条检查：判定函数的返回值是否真的到达帧渲染器

`_injectTierPre` 全仓只有 **2 个读取点**（实测 grep，排除注释）：`L9953`（精简帧 `renderSlimSnapshotPre`）与 `L11117`（全帧 `renderMemoryDynamic`）；**2 个写入点**：`L21896`（乐观档）与 `L21928`（降级）。

生产请求的语句顺序（逐行摘录，可在 `lib/index.js` 直接核对）：

```
L21847  let _tierGuess = decideInjectTierPre({ isHuman: _isHumanNow, isFull: true })   // ★ isFull 硬编码 true
L21853  if (engine.isUnattendedNow && engine.isUnattendedNow() === true) _tierGuess = INJECT_TIERS.HANG_COMPENSATE
L21858  if (!_stTier.ws && _stTier.globalLedgerPath) _tierGuess = INJECT_TIERS.HANDOFF_CARRY
L21891  … 检测到 compactionSeq 增长 ⇒ _tierGuess = INJECT_TIERS.POST_COMPACT ; _postCompactPending = true   // L21891-21892
L21896  _stTier._injectTierPre = _tierGuess            // ← 写档位（此时只可能是 *_FULL / post_compact / handoff_carry / hang_compensate）
L21899  const snap = engine.renderMemoryDynamic(context) // ← ①全帧渲染：读到的就是上面那个「乐观档」
L21925  const _pt0 = _stD0._injectTierPre
L21928  _stD0._injectTierPre = _isH0 ? 'human_slim' : 'run_slim'  // ← 降级（仅对 4 个普通档生效）
L21932  const slimText = engine.config.snapshotTieredInject === false ? '' : engine.renderSlimSnapshotPre(wsHintPre, agent)  // ← ②精简帧渲染：读到降级后的 *_slim
```

**结论（逐档）**：

| 档位 | 是否到达帧渲染器 | 到达哪一个 | 证据 |
|---|---|---|---|
| `human_full` | ✅ | 全帧（L21899） | 决策走查第 1/3 行：`tier@snap=human_full`、返回帧=full |
| `run_full` | ✅ | 全帧（L21899） | 决策走查第 4 行：`tier@snap=run_full`、返回帧=full |
| `human_slim` | ✅（**仅精简帧**） | 精简帧（L21932） | 决策走查第 2 行：同 turn 第 2 步 `tier@slim=human_slim`、返回帧=slim |
| `run_slim` | ✅（**仅精简帧**） | 精简帧（L21932） | 决策走查第 5-8 行：`tier@slim=run_slim`、返回帧=slim |
| `post_compact` | ✅（设计可达） | 全帧 | 全帧文本多 109 字符 `[上下文已压缩]`（`L11152` 门控）；但 5 天生产 log 命中 **0 次** |
| `handoff_carry` | ✅（条件：`!ws && globalLedgerPath`，L21858） | 全帧 | 与 `human_full` **逐字节相同**（见 §C8） |
| `hang_compensate` | ⚠️ 标记可达、授予不可达 | 全帧 | 标记在 L21853（`unattendedMode=true` 即置）；但授予分支 L22405 依赖 `_rqK`（L22408），被 `_rqK` bug 打死（§B5） |
| `legacy` | ✅（缺档时回退） | 全帧（L11117 fail-open 到 `LEGACY`） | 实测 23,044 字符 / 285 行 |

### B5 不可达 / 半可达的具体行与推理链

**（a）`*_slim` 作为「全帧内容档」不可达 —— 具体行：`L21899` vs `L21925-21928`**

`snap`（全帧）在 `L21899` 就渲染完了，而降级发生在 `L21925-21928`。⇒ `renderMemoryDynamic` 内所有 `_tier === *_SLIM` 的分支在生产**永不成立**。这些死代码包括：

| 死分支 | 行 | 若生效会带来什么 | 实测（测试态强制塞档） |
|---|---|---|---|
| `_rulesFullTierInline` 为假 ⇒ 规则摘要 | `L11217` / `L11176` | 规则段 8,683 → 4,189 | `X1-human_slim-in-fullframe.txt` = 19,322 字符 |
| `_planSpec` 走核心节白名单 | `L11123-11134` | 白板 1,941 → 1,884 | 同上 |
| `_portraitOk` 为假 ⇒ 不投画像 | `L11561` | −615 | 同上 |
| `semantic-recall` 闸门 | `L11512` | −915 | 同上 |
| `recent-logs` 被桶上限挤掉 | `L11752`（`priority='low'`）/ `L11889`（`memRefLimit`） | −770 | `X1` 的 `dropped=[recent-logs]` |

⚠️ **对上一轮结论的修正（必须点名）**：上一份报告写「`human_slim` / `run_slim` 在帧渲染器不可达」。**本轮实测证明该表述需要精确化为**：它们在**精简帧渲染器**里是可达的（`human_slim`=2,219 / `run_slim`=1,999，且二者只差 220 字符）；**不可达的是它们作为「全帧内容档」的形态**。上一轮结论的方向（「档位降级发生在全帧渲染之后」）经本轮独立复核**依然成立**，但「不可达」的范围被本轮收窄。

**（b）`hang_compensate` 授予分支不可达 —— `_rqK` 作用域越界（本轮在 HEAD 重新核实，行号已漂移）**

```
L22110  try {
L22111    const _rqK = String(engine.requestIdPre(agent) || '')     // ← 块级 const
L22137  } catch (_) {}                                            // ← try 在此结束
…
L22387  if (stH._reqHumanFullKey !== _rqK) {                       // ← 水位授予分支（块外引用）
L22388    stH._reqHumanFullKey = _rqK
L22392    stH._humanConsumedKey = _rqK
L22408  stH._reqHumanFullKey = _rqK                                // ← 挂机授予分支（块外引用）
```

⇒ `_rqK` 在 `L22111` 声明于 `L22110` 打开的 `try{}` 内、`L22137` 闭合后即失效；`L22387/22388/22392/22408` 四处引用必然抛 `ReferenceError`，分别被 `L22398`（水位）与 `L22414`（挂机）的空 catch 吞掉。
**本轮实测复核**：与 Lead 上轮的复核结论**一致，无矛盾**。证据链：①5 天生产 log（`~/.dsh/dsh-auto-memory-diagnose.log`，15,013 行）中 `水位阈值命中`=0、`挂机代位补偿`=0；②本轮决策走查中把 `unattendedMode=true` 且累计超阈值后，`_hangFire.fire` 恒 false / 分支未进入（因为 `decideHangCompensatePre` 之外的引用先抛错）。

**（c）run 侧「水位钩子」不存在（不是 bug，是门控设计）—— 具体行：`L22384`**

```
L22073  const _wpList = parseWaterPctThresholdsPre(_wpRaw)        // 唯一的水位阈值解析
L22086  _waterFire = decideWaterPctFirePre(_waterPctNow, _wpList, …)   // 唯一的水位判定
L22384  if (_waterFire.fire && isHuman) {                          // ← 授予口硬性要求「真人请求」
```

⇒ 全仓水位实现**只有一套**（不是两套各写一份），但它的**授予口被 `isHuman` 门控** ⇒ run 侧（非真人）永远不会因为「水位跨 25%/50%」拿到全帧。run 侧唯一拿到全帧的两条路：`fullGap`=20（`L21985` / `L22466`）与 `hang_compensate`（`L22358` 要求 `!isHuman && unattended`，默认 `hangCompensateEnabled:false`，且被 `_rqK` bug 打死）。

**（d）本轮新发现的 run 侧渲染缺陷（缺陷 R-a）：规则摘要渲染出畸形行**

`_renderRulesSlimInline`（`L11176-11198`）对每条规则只做「取首句 + 截 60 字 + 前缀 `- `」（`L11188-11195`），**没有剥离 `extractRulesLayerPre` 带出的 markdown 前缀**。实测 `R1-run_full.txt` 规则段（4,189 字符 / 66 条）：

- **5 行以 `- - ` 开头**（双横线），例：`- - 禁止把「两万字符级超长注释行」当作插入锚点：…`
- **61 行以 `- ## ` 开头**（日期标题泄漏），例：`- ## 2026-09-22 ## 2026-09-22 · 「多处闸门」类改动的半修风险…`
- 末尾标注「（共 66 条；本档只给摘要）」——**数字对，但内容形态是坏的**

同源问题：模块级 `renderRulesSlimPre`（`L1929-1953`）与内联副本（`L11176`）**行为等价，因此两处都有该缺陷**（不是抄漏，是原始实现即如此）。凡走摘要档的档位（`run_full`、以及测试态的 `human_slim`/`run_slim` 全帧形态）都受影响。

**（e）run_full 丢掉 `recent-logs`（缺陷 R-b）**

`R1` 的 envelope 账本 `dropped = [recent-logs]`（770 字符被整段丢）。原因链：`recent-logs` 以 `priority='low'` 入桶（**`L11752`** 行末的第五个实参），而 `whiteboard-plan`/`event-cards` 是 `must`；瘦档 `memRefLimit`（`L11889` = `sub*4 + catalogCost + planCap + ledgerCap + 400`，其中 `planCap` 取 3,000 而非 8,000）更小 ⇒ 桶超限时按「先丢 `low`」把它们整段丢。**run 侧正是「我这一轮在自跑、需要知道最近发生了什么」的场景，却先丢最近日志** —— 裁剪优先级与使用场景相反。
---

## §C 四档两两区分度

### C6 四份文本（同一份真实记忆数据、同一会话、同一时刻）

构造：真引擎 `MemoryEngine` + 本机真实记忆（用户记忆 27,102 / 项目笔记 23,945 / PLAN 11,134 / 最近账本 1,807 / 事件卡 2,615 / 画像 576 / 日历 2,667 / Tier-0 1,519 字符）。
`user_*` 用 `unattendedMode=false`（人在场）；`run_*` 用 `unattendedMode=true`（挂机自跑）。合入引擎的两个 runtime（**必须同时写 `stateFor(agent)` 与 `engine.state`**：渲染器读 `this.state`，只写一处会得到假结论 —— 本轮首次运行时即踩到此坑，已修正）。

### C7 6 对两两矩阵（**生产形态**：各自被帧选择器实际取用的那一份）

| 配对 | bytes A / B | 字符 A / B | 行重叠(A 侧) | 行重叠(B 侧) | Jaccard | 字符重叠(A 侧) | 体积比 B/A | **sha256 相同？** |
|---|---|---|---|---|---|---|---|---|
| `user_full` vs `user_slim` | 48,119 / 4,717 | 24,574 / 2,219 | 2.67% | 50.00% | 2.60% | 1.66% | 9.0% | ❌ |
| `user_full` vs `run_full` | 48,119 / 32,817 | 24,574 / 17,727 | 61.07% | 69.57% | 48.19% | 53.42% | 72.1% | ❌ |
| `user_full` vs `run_slim` | 48,119 / 4,312 | 24,574 / 1,999 | 2.67% | 63.64% | 2.63% | 1.66% | 8.1% | ❌ |
| `user_slim` vs `run_full` | 4,717 / 32,817 | 2,219 / 17,727 | 50.00% | 3.04% | 2.95% | 18.34% | 798.9% | ❌ |
| `user_slim` vs `run_slim` | 4,717 / 4,312 | 2,219 / 1,999 | **78.57%** | **100.00%** | **78.57%** | **90.00%** | 90.1% | ❌ |
| `run_full` vs `run_slim` | 32,817 / 4,312 | 17,727 / 1,999 | 3.04% | 63.64% | 2.99% | 2.30% | 11.3% | ❌ |

**补充矩阵（全帧渲染器内强制塞四档，用于暴露「内容档差异是否真的存在」）**

| 配对 | 字符 A / B | 行重叠(A) | Jaccard | 字符重叠(A) | sha 相同？ |
|---|---|---|---|---|---|
| `human_full` vs `human_slim` | 24,574 / 19,322 | 69.85% | 55.12% | 59.23% | ❌ |
| `human_full` vs `run_full` | 24,574 / 17,727 | 61.07% | 48.19% | 53.42% | ❌ |
| `human_full` vs `run_slim` | 24,574 / 13,070 | 37.79% | 29.91% | 35.21% | ❌ |
| `human_slim` vs `run_full` | 19,322 / 17,727 | **90.91%** | **90.91%** | **89.97%** | ❌ |
| `human_slim` vs `run_slim` | 19,322 / 13,070 | 65.61% | 65.10% | 62.48% | ❌ |
| `run_full` vs `run_slim` | 17,727 / 13,070 | 72.17% | 71.55% | 68.10% | ❌ |

> 注：补充矩阵只作**对照**——它证明「四档的内容差异在代码里确实存在（59%–90% 重叠而非 100%）」，但这些形态在生产**永远不会出现**（§B5(a)）。

### C8 sha256 一致性检查（判据：不同语义档之间不得逐字节相同）

**四档内部：6 对全部 sha256 不同 ⇒ 判据 PASS。**

**扩到 8 档（含 LEGACY / post_compact / handoff_carry）后：发现 1 对逐字节相同 —— 必须点名。**

| 配对 | 字符 | sha256 | 结论 |
|---|---|---|---|
| **`human_full` vs `handoff_carry`** | 24,574 / 24,574 | **`e259f807…` 完全相同** | ❌ **逐字节相同（缺陷）** |
| `human_full` vs `post_compact` | 24,574 / 24,684 | 不同（差 110 字符 = `[上下文已压缩]` 提示 109 + 1 换行） | ⚠️ 仅靠一句提示区分，行重叠 100% |
| `human_full` vs `legacy` | 24,574 / 23,044 | 不同（legacy 缺 semantic-recall 915 + 画像 615） | ✅ 可区分（行重叠 91.6%） |

**为什么 `human_full` 与 `handoff_carry` 会逐字节相同？（按要求给出原因，不用「代码复用同一渲染器」一句带过）**

三条判据把这两档**归进同一分支**，且 `handoff_carry` **没有任何独占段**：

1. 规则段：`_rulesFullTierInline`（`L11217-11222`）同时包含 `HUMAN_FULL` 与 `HANDOFF_CARRY` ⇒ 两者都投规则全文；
2. 白板：`_planSpec` 的 `fullTier`（`L11129`）同样同时包含两者 ⇒ 都投白板全文、同 8,000 预算；
3. 画像 / semantic-recall：`_portraitOk`（`L11561`）与 semantic 门（`L11512`）名单同样同时包含两者 ⇒ 两段都给；
4. **`handoff_carry` 的设计承诺「+ 指针」只在 `!s.planText && !s.latestHandoffText && s.globalLedgerPath` 时产出**（`pushPart('otherDynamic','handoff-pointer',…)` 在 **`L11575`**；`L1541` 只是可关清单里的键名登记）——而在**有白板且有账本**的工作区（本机就是），该条件恒假 ⇒ 指针段**零字节**。

⇒ 结论：**不是判定函数写错落到同一分支，而是两条判据名单刻意把两者合并，加上独占段有前置条件（本机不满足）⇒ 结构性必然逐字节相同。** 任何「交接接续」档在白板/账本齐备的工作区都是 `human_full` 的复制品。

### C9 四档体积与成本（可复算）

| 档位 | 生产形态 | 字符 | 字节 | 说明 |
|---|---|---|---|---|
| `user_full` | 全帧 | **24,574** | 48,119 | +281 降级行（envelope 账本口径 24,293） |
| `user_slim` | 精简帧 | **2,219** | 4,717 | 含 `[当前事件]`68 + `[用户画像]`88 + `[取全文]`64 |
| `run_full` | 全帧 | **17,727** | 32,817 | 规则摘要 4,189 / 无画像 / 无 semantic / **丢 `recent-logs`** |
| `run_slim` | 精简帧 | **1,999** | 4,312 | 与 `user_slim` 差 **220 字符**（那 3 行） |

**节奏实测（同一装置跑满 100 个模型请求）**

| 场景 | 全帧次数 | 精简帧 | 全帧出现的步 | 与设计对照 |
|---|---|---|---|---|
| **run（挂机自跑）100 请求** | **5** | 95（其中 35 步被 `slimEveryRounds=8` 节流） | 步 1 / 21 / 41 / 61 / 81 | ✅ 与「每 20 步一次」**完全一致** |
| **human（10 个真人 turn × 每 turn 5 步 = 50 请求）** | **10** | 40（全部被节流） | 步 1 / 6 / 11 / 16 / 21 / 26 / 31 / 36 / 41 / 46 = **每个 turn 首步** | ❌ 与用户意图「只在首轮/压缩后/25%/50%」**不符** |

成本换算（同一份数据）：run 侧 100 请求 = 5×17,727 + 95×1,999 = **278,540** 字符；human 侧 50 请求 = 10×24,574 + 40×2,219 = **334,500** 字符；若按用户意图（50 请求只 1 次全帧）= 24,574 + 49×2,219 = **133,305** ⇒ **2.51×**。

---

## §D 与用户意图的差距

> 用户 2026-11-03 意图（逐字要点）：**full 只在【首轮 / 压缩后 / 25% 水位 / 50% 水位】注入且不设上限，其余时候 slim。**

### D9 user 侧 / run 侧分别判定

**user 侧（5 条判据）**

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| 1 | full **只在首轮** | ❌ **不满足** | `_grantByHuman = _reqHumanNow \|\| (isHuman && firstOfTurn)`（`L22465`）⇒ 每个带真人消息的请求都授予；实测 10 个真人 turn → **10 次全帧**（步 1/6/11/…） |
| 2 | full **只在压缩后** | ⚠️ **机制存在，但未验证可达** | `post_compact` 链路完整（`scanPressureSignalsPre` → `L21891-21892` 置档、`L22627` 强制放行、`L11152` 提示段）；**5 天生产 log 命中 0 次** ⇒ 无法证实（不是「已验证可用」） |
| 3 | full **只在 25% 水位** | ❌ **不满足（钩子死）** | 阈值解析 `L22073`、判定 `L22086` 都在；授予口 `L22384` 依赖 `_rqK`（`L22387/22388`）⇒ 抛 `ReferenceError` 被 `L22398` 空 catch 吞掉 ⇒ 生产 0 命中 |
| 4 | full **只在 50% 水位** | ❌ **不满足（同上，同一分支同一 bug）** | 25% 与 50% 共用 `decideWaterPctFirePre` 的阈值列表，未分段实现 |
| 5 | full **不设上限** | ❌ **不满足（部分）** | 规则段**确无上限**（`rules` 桶在 envelope 中豁免，实测 8,683 全文）；但 `user-memory` 被 `sub=1,473` 硬截（注入 1,529 / 源 27,102 = **5.64%**）、`project-notes` 6.39%、白板 8,000 上限、semantic 800 |
| 6 | 其余时候 **slim** | ⚠️ **形式上满足、语义上不满足** | 精简帧确实在其余请求下发（形式），但帧内**用户侧内容为 0**（无规则/无用户记忆/无 Tier-0），只有 `[当前事件]`+`[用户画像]` 共 156 字符 ⇒ 不是「用户的精简版」，是「没有用户记忆」 |

⇒ **user 侧：1 条部分满足（规则段无上限）、2 条形式满足但语义打折（slim 存在、压缩机制存在）、3 条不满足（每轮 full、25%、50%）。**

**run 侧（4 条判据，按 2026-10-27 设计纲要而非 2026-11-03 用户口述——口述只讲 user 侧）**

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| 1 | `run_full` **每 20 步一次** | ✅ **满足** | 实测步 1/21/41/61/81（100 请求 5 次）；门槛 `fullGapStep`（`L21985`）与授予 `L22466` |
| 2 | `run_full` = **核心节 + 不投规则全文** | ✅ 满足（结构），⚠️ 渲染畸形 | 规则段 4,189（摘要）/ 白板核心节 1,884 / 无画像 / 无 semantic；但摘要 66 行里 5 行 `- - `、61 行 `- ## ` 日期头泄漏（§B5(d)） |
| 3 | `run_slim` **每 8 步一次、最克制** | ✅ **满足** | `slimGapStep`=8（`L21987`）；`run_slim` 帧 1,999 字符、**无事件卡/无画像**（`_slimNeedsHumanCtx = !(_slimTierPre === 'run_slim')`，`L9957`）——与 `432829e7` 提交声明「2,180 → 1,999」逐字吻合 |
| 4 | run 侧**只在上述时机**注入（无额外触发） | ✅ 满足 | run 侧全帧只有 20 步门槛 + `hang_compensate`（默认 `hangCompensateEnabled:false`，`L1035` 附近 DEFAULT_CONFIG；且授予分支被 `_rqK` 打死） |

⇒ **run 侧：4 条全部满足（其中 1 条带渲染缺陷），是本次调查中唯一「实现与设计基本一致」的部分。**

### D10 run 侧是否有自己的水位逻辑？——**没有；是同一套实现 + 真人门控**

- **水位阈值解析**：全仓仅 `L22073` 一处（`parseWaterPctThresholdsPre(cfg.fullInjectWaterPct)`，默认 `'25,50'`）。
- **水位判定**：全仓仅 `L22086` 一处（`decideWaterPctFirePre`）。
- **授予口**：`L22384` `if (_waterFire.fire && isHuman)` —— 硬性要求真人；run 侧（`isHuman=false`）**永不进入**。

⇒ 不存在「两套各写一份」的水位逻辑。但**存在另一形态的多处判定**：档位名单在同一函数里被手抄 4 遍（`_planSpec.fullTier` `L11129`、`_rulesFullTierInline` `L11217`、`_isFullTier` `L11313`、`_planCapFullIdx` `L11881`），模块级谓词（`isRulesFullTierPre` `L1863`、`planSpecForTierPre` `L1994`、`isHumanTierPre` `L1818`）**生产消费为 0**（§A1）。

`run` 侧**独有**的门槛只有一条：`hangCompensateTokens`（默认 300,000 累计输出 token），且 `hangCompensateEnabled` 默认 `false`、授予分支被 `_rqK` bug 打死 ⇒ **run 侧实际上只有步数门槛一种触发**。
---

## §E 改造建议（只出方案，未改代码）

### E1 档位层（结构与判据收敛）

| # | 建议 | 落点 | 可复算判据 |
|---|---|---|---|
| E-1 | **先修 `_rqK` 作用域**（P0，一行）：把 `const _rqK` 从 `L22111` 的 `try{}`（`L22110` 开 / `L22137` 闭）提到该 try **之外**，与函数其余局部变量同层 | `L22111` | 真抽解决策段：真人 + 水位 26% + 同 turn 非首帧 ⇒ 输出全帧且 `_waterPctFired===25`；负路径：把声明移回块内 ⇒ 必须红 |
| E-2 | **给 `handoff_carry` 一个独占段**，否则它与 `human_full` 结构性同构（当前 `handoff-pointer` 只在「无白板且无账本」时出，`L1541` 条件） | `_planSpec`（`L11123`）/`_rulesFullTierInline`（`L11217`）/`_portraitOk`（`L11561`）名单 + pointer 条件（`L11575` 的 `!s.planText && !s.latestHandoffText`） | 断言 `sha256(human_full) !== sha256(handoff_carry)`；负路径：把 pointer 条件改回原样 ⇒ 必须红 |
| E-3 | **判据收敛**：删或接线 `isRulesFullTierPre`（`L1863`）/`planSpecForTierPre`（`L1994`）/`isHumanTierPre`（`L1818`）/`renderRulesSlimPre`（`L1929`）四个**生产 0 消费**的模块级函数，改由同一张表派生；同一函数内四处手抄名单（`L11129`/`L11217`/`L11313`/`L11881`）合并为 1 个 `_fullTierOf(tier)` | 上述行 | 变异：改表中任一档 ⇒ 产出必须变化（证非恒真守卫）；当前形态下改模块级函数产出**不变** ⇒ 现状可被此断言判定为缺陷 |
| E-4 | **`_slim` 内容档要么接线、要么删**：`renderMemoryDynamic` 里 `*_SLIM` 分支（规则摘要/核心节/不投画像，共 5 处：`L11129` `L11176`/`L11217` `L11512` `L11561` `L11887`）在本仓生产永不执行。二选一：①让「用户 slim」走全帧渲染器（保住核心节语义）；②删除死分支并把「slim」明确为「精简帧」 | 同左 | 若选①：真人 turn 的第 2 步及以后应产出 19,322 字符级的「核心节」帧（而非 2,219）；若选②：`_slim` 分支应从源码消失 |

### E2 run 侧（结构基本正确，只修渲染质量）

| # | 建议 | 落点 | 判据 |
|---|---|---|---|
| E-5 | **修规则摘要的 markdown 泄漏**（缺陷 R-a）：在 `_renderRulesSlimInline`（`L11176`）与模块级 `renderRulesSlimPre`（`L1929`）**两处同改**，先剥 `^-+\s*` 与 `^#{1,6}\s*` 与行首日期分隔符再取首句；**尾部完整性断言**：`renderRulesSlimPre` 输出行数 = 规则条数 + 2 | `L11176` / `L1929` | 断言 `run_full` 规则段中 `^- - ` 与 `^- #{1,6} ` 行数 **均为 0**；负路径：只改一处 ⇒ 另一处必须仍能检出（变异必红） |
| E-6 | **`run_full` 不应先丢 `recent-logs`**（缺陷 R-b）：把 `L11752` 的 `'low'` 改 `'normal'`，或把瘦档 `memRefLimit`（`L11889`）提到能容纳 `recent-logs` | `L11752`（优先级）/ `L11889`（memRefLimit） | 断言 `run_full` 的 `envelope.dropped` **不含** `recent-logs`；同时断言 `run_slim` 仍不含日志（保持最克制） |
| E-7 | **`run_slim` 与 `user_slim` 共用 220 字符差异应显式化**：目前靠 `_slimNeedsHumanCtx`（`L9957`）一处硬编码字符串比较 `'run_slim'`；若将来新增档位（如 `hang_compensate` 的精简形态）会静默落入「需要人际语境」分支（fail-open 视为需要）——建议改为**正向白名单**并加断言 | `L9957` | 断言：`run_slim` 帧不含 `[当前事件]`/`[用户画像]`/`[取全文]`；`human_slim` 帧**必须**含这三项；负路径：档位名拼错 ⇒ 断言红 |
| E-8 | **run 侧的水位（若用户要）必须新增一条独立触发，而不是复用 user 侧**：现水位授予口 `L22384` 硬性要求 `isHuman`，run 侧结构上无法触发。若要让「挂机跑到 25%/50% 也给全帧」，需新增 `_waterFire.fire && !isHuman` 的独立旁路（与 F7 的分工需重新定义，否则与 `hangCompensate` 语义重叠） | `L22384` / `L22358` | 断言：`unattended + 水位 26% + !isHuman` ⇒ 全帧；且与 `hangCompensate` 不双投（互斥断言） |

### E3 建议顺序（依赖）

`E-1（_rqK，P0）→ E-2（handoff_carry 独占段）→ E-5（规则摘要畸形，run 侧用户可见）→ E-6（recent-logs）→ E-4（slim 内容档定位）→ E-3（判据收敛）→ E-7 → E-8（若用户要 run 侧水位）`。

E-5 是本轮**唯一「run 侧用户可直接看到」的内容缺陷**，与 E-1 互不依赖，可并行。

---

## §F 与上一轮结论的关系（矛盾点显式说明）

| 上一轮结论 | 本轮复核 | 处置 |
|---|---|---|
| 「`human_slim` / `run_slim` 在帧渲染器不可达」 | **需精确化**：作为「精简帧标签」可达（`human_slim` 2,219 / `run_slim` 1,999，实测决议走查 tier@slim 命中）；**不可达的是「全帧内容档」形态** | 上一轮表述范围过宽，本轮收窄；方向（降级在全帧渲染之后）不变 |
| 「`_rqK` 作用域越界 ⇒ 水位/挂机授予死」 | **成立，无矛盾**（HEAD 行号漂移为 `L22111` 声明 / `L22387,22388,22392,22408` 引用 / `L22110-22137` try 块） | 维持 |
| 「`human_full` ≡ `handoff_carry` 逐字节相同」 | **成立，无矛盾**（本轮重新渲染：两者 sha256 均 `e259f807…`，24,574 字符） | 维持，并在 §C8 补上原因链 |
| 「全帧 24,393 字符 / 精简帧 2,219」 | **数值漂移**：本轮全帧 24,574（真实记忆内容增长：账本 1,205→1,807、事件卡 2,402→2,615 等），精简帧仍 2,219 | 属生产数据漂移，非结论矛盾；本报告统一采用本轮实测值 |
| 「任务书判据：>80% 重叠即区分度不足」 | 本轮判据改为「不同语义档不得逐字节相同」⇒ 四档 6 对**全过**；扩到 8 档仅 `human_full ≡ handoff_carry` 一对不过 | 维持新判据 |

---

## 附录 A：证据文件清单

| 文件 | 内容 |
|---|---|
| `probe-tiers-full.mjs` | 可复算装置：真引擎 + 真实记忆；复刻生产请求顺序；落盘四档 + 对照档 + 两两矩阵 + 节奏统计 |
| `metrics.json` | 全部物理量：config / stateChars / reachabilityWalk / production / inFrameForms / segments / totals / sectionTitles / cadence / productionPairs / inframePairs / rows |
| `pairwise-production.csv` | 6 对生产形态两两矩阵（13 列，含 sha） |
| `pairwise-inframefull.csv` | 6 对全帧形态两两矩阵（对照） |
| `U1-user_full.txt` / `U2-user_slim.txt` / `R1-run_full.txt` / `R2-run_slim.txt` | 四份生产形态注入文本 |
| `X1-human_slim-in-fullframe.txt` / `X2-run_slim-in-fullframe.txt` / `X3-post_compact.txt` / `X4-handoff_carry.txt` / `X5-legacy.txt` | 五份对照文本 |

## 附录 B：未验证项（如实标注，不猜）

1. **`post_compact` 是否真能触发**：机制完整但 5 天生产 log 命中 0 次。无法区分「真没发生压缩」与「判据失效」⇒ **未验证**。
2. **`hang_compensate` 授予是否只被 `_rqK` 单因打死**：本轮实测其分支内部引用 `_rqK` 必然抛错；但 `hangCompensateEnabled` 默认 `false`，无法在默认配置下观察到「修好 `_rqK` 后是否真的会授予」⇒ 修好后需单独验收。
3. **`handoff_carry` 在「无白板且无账本」工作区的形态**：本机不满足该前置条件，`handoff-pointer` 段从未产出 ⇒ 该形态**未实测**。
4. **宿主是否真的投递了本装置算出的帧**：本装置只到「渲染返回值」；`MASTER-PLAN-3.0.md §7` 的 U6（宿主最终 messages 确认）仍不具备 ⇒ 投递层**未验证**。

## 附录 C：行号断言的机械校验（本轮自检）

对本报告引用的 **64 条 file:line** 逐条做「该行是否包含预期片段」的机械校验（脚本：读 `lib/index.js` → `split('\n')` → 断言 `L[n-1].includes(fragment)`），结果：**64 条中 63 条一次命中，1 条（`L21891` 的 `_postCompactPending`）实际在 `L21892`——已在本报告中改为 `L21891-21892` 并复验通过**。

复核提示：`lib/index.js` 在本轮调查期间被其他并行工作改动过（10:23Z 前后 size 1,937,527 → 1,938,567），**行号会继续漂移**；复算时请以「预期片段」定位，不要硬编行号。

---

## 附：本报告物理量

| 项 | 值 |
|---|---|
| 报告路径 | `docs/internal/INVESTIGATE-TIERS-FULL-20261103.md` |
| **bytes**（正文，不含本附节） | **36877** |
| **行数**（正文） | **362** |
| **sha256**（正文） | `d62a83fa1092967ea8be1d3e9ada0604a7acecc3d1a411c61862686e01f5fdfd` |

证据目录 `artifacts/inject-tiers-full-20261103/`：

| 文件 | bytes | sha256（前 32 位） |
|---|---|---|
| `R1-run_full.txt` | 32817 | `1ae27c152c581c396ad26789f18a4d02…` |
| `R2-run_slim.txt` | 4312 | `d393531b514ef082f1cef51a0d2eac04…` |
| `U1-user_full.txt` | 48119 | `e259f807d70ea1f59018a006b8ca21b5…` |
| `U2-user_slim.txt` | 4717 | `a4eb29d1afe38033c423588338bba551…` |
| `X1-human_slim-in-fullframe.txt` | 36425 | `92cc4f9ff55a8a8c51f7c6ea87a0be80…` |
| `X2-run_slim-in-fullframe.txt` | 23868 | `9726a4eecaefcd61bf2a3f19354a2179…` |
| `X3-post_compact.txt` | 48379 | `19369eafa0a6e575dae4ef1151f542e0…` |
| `X4-handoff_carry.txt` | 48119 | `e259f807d70ea1f59018a006b8ca21b5…` |
| `X5-legacy.txt` | 44638 | `6d4839e2e169319315a91caf3f2e1e40…` |
| `_t1.mjs` | 1398 | `ef29a19132cc262eb59edd1c4a3d2b29…` |
| `metrics.json` | 22884 | `6c88142ae8290f3aeb9d3cf37da6ee92…` |
| `pairwise-inframefull.csv` | 1258 | `96343285fabb3e3abd3a3ec89894632b…` |
| `pairwise-production.csv` | 1349 | `c9066d696fda5ff4dd511ef6553e8bac…` |
| `probe-tiers-full.mjs` | 17203 | `3f391d88065d43bfb3555e7c8c67d8dc…` |

- **未修改 `lib/` 任何文件**（本轮全部 `lib` 行号均由只读 read/grep 取得；`lib/index.js` 的 mtime 变化来自并行线的编辑，非本轮）；未 commit / 未 push / 未改版本号。
- 复算：`node artifacts/inject-tiers-full-20261103/probe-tiers-full.mjs`（真引擎 + 真实记忆数据，实测 EXIT=0）。**同一份真实数据下连续两次运行：9 份文本的 chars / bytes / sha256 全部逐字节一致**（已实测）；跨会话 sha256 会随真实记忆内容变化。
