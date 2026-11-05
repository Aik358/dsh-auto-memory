# 注入档位体系 · 交叉检验结论（Double Check 回执）

> 检验：2026-10-28 | 仓库 `D:\dsh-auto-memory` | HEAD `6330616b` + 未提交改动
> 被检验文档：`docs/internal/INJECT-TIER-DOUBLE-CHECK-20261028.md`
> 手法：**不采信文档结论**，逐条抽真源码 `new Function` 执行 + 真引擎渲染矩阵 + 反例构造。

---

## §0 一句话结论

**工单 §2 的核心判断（v3 判据 `scanPressureSignalsPre().compactionSeq` 同步、无竞态、能当帧读）成立，§2.2 的竞态论证也成立。**
但工单自列「未覆盖」的状态遗漏**不是理论风险，是可复现的真缺陷**：插件重载/宿主重启/新会话首帧会把**历史里的旧压缩**当成刚发生，误标 `post_compact` 并白烧一次强制完整版。另外 `post_compact` 的「强制完整版」在**年轻会话里不成立**（`stepSeq < gap` 时仍被节流成精简帧），这直接推翻了 §3.1 修复的意图。

| 判定 | 数量 |
|---|---|
| 工单结论成立 | 5 项 |
| 部分成立 / 需修正 | 3 项 |
| **工单未发现的新缺陷** | **3 项（P0 级 1 项、P1 级 2 项）** |
| 历史欠条成立 | 4 / 5（欠条 1、2、4、5 成立；欠条 3 不成立） |

**全量回归：PASS 531 / FAIL 0**（我独立重跑，`--jobs=8`，161.3s，与工单 §0 一致；但工单写的是 530/1，**我的实跑是 531/0**）。

---

## §1 独立复跑结果（先对齐事实基线）

| 命令 | 工单声称 | 我实测 | 判定 |
|---|---|---|---|
| `node --check lib/index.js` | 通过 | 通过 | ✅ |
| `import('./lib/index.js')` | 未写 | `IMPORT_OK exports=40` | ✅ |
| 全量回归 | **PASS 530 / FAIL 1** | **PASS 531 / FAIL 0** | ⚠️ 工单数字偏保守（我这边 `v4-c4` 也过了） |
| `_verify-pc7.mjs` | PASS 5 / FAIL 0 | PASS 5 / FAIL 0（变异 A/B 必红、C 未红） | ✅ 完全一致 |
| `_verify-pc8.mjs` | PASS 2 / FAIL 0 | PASS 2 / FAIL 0 | ✅ |
| `_verify-pc6.mjs` | 同步、无竞态 | 同步、0ms | ✅ |
| `grep -c 'post_compact'` | 修复前 = 0 | **0** | ✅ |
| `grep -c 'compaction-detected'` | = 17 | **17** | ✅ |
| `_verify-pc2.mjs`（§6 ③ 引用） | 「期望 24,576」 | **文件不存在** | ❌ 工单引用了一个不存在的脚本 |
| `_verify-pc5.mjs`（未在 §6 列出） | — | **已过期，硬编码行号错位，直接 SyntaxError** | ❌ 遗留脏件 |

**指纹核对**：工单 § 头部写 `lib/index.js = 1,350,440 字符 / sha16 CE69098A2203786A`。我实测：
- LF 归一化后长度 **1,350,440**、sha16 **CE69098A2203786A** ✅ 完全吻合
- 但文件物理字节 **1,810,055**（CRLF 25,351 处），原始 sha16 = `DE0517A983D62FD4`

⇒ 工单口径是「LF 归一化后」，而仓库 `smoke-test-r26-cross-layer.mjs` 的 `eq(IX.length, R153_CHARS)` 用的**也是** `IX = readFileSync().replace(/\r\n/g,'\n')`（配套注释 L801 明写「归一化 LF 长度…NOT 文件字节数」）⇒ **两处口径一致，钉值正确**。R153_CHARS 已从 1349421 重钉到 1350440，Δ+1019，与本次 +36/-21 行的改动量级吻合。

---

## §2 检验项 1（工单重点）：`post_compact` 触发链

### 2.1 ✅ §2.2 竞态论证 —— 成立（我独立复核）

`checkWaterLevel` 确实是 `async`（L5871），且 `lastCompactionSeen` 的写入（L6039/6042）**确实在** `const winInfo = await this.resolveWaterWindow(...)`（L5928）**之后**。

`checkWaterLevelAtStep`（L6255）确实是**同步非 async** 函数，内部是 `void this.checkWaterLevel(agent).then(...)`（L6267）—— **不 await、立即返回**。

⇒ 工单的「v2 有竞态」判断**完全正确**。若在 L20723 读 `rt.lastCompactionSeen`，读到的是上一帧的值。

**补充一条工单未提的更硬证据**：`checkWaterLevel` 在 `await` 之后还有第二条早退路径 `if (win <= 0) return`（L5944）和 `if (rt && rt.disposed) return`（L5946）。即便某次 `await` 立刻返回，只要窗口解析失败（新模型/配置缺失，工单 §4 欠条里也提到过这个场景），`lastCompactionSeen` **一次都不会更新**。⇒ v2 判据在「窗口未知」的会话里**永久失效**，比工单描述的竞态更严重。

### 2.2 ✅ §2.3 v3 实现 —— 同步、无 await、能当帧读（成立）

`scanPressureSignalsPre`（`lib/water-window.js:178`）我读了全文：纯函数、同步 for 循环、无 await、无 IO。`sessionEventsOf`（L18418）走 `session.events` 或 `session.snapshotEvents()`，也是同步。

**关于工单 §5-2 的自我质疑「`sessionEventsOf` 是否可能返回过期数组」**：不成立，但理由和工单不同。`snapshotEvents()` 的注释自述是「内部 `eventsSnapshot` 缓存，同一 log 追加前重复调用零重复开销；返回 frozen 数组」。关键点是**追加前**——宿主 append 后缓存失效，下次调用会拿到新数组。所以不存在「读到旧缓存」的问题。真正的不确定性是工单 §5-3（事件追加时机），见下条。

### 2.3 ⚠️ §5-3（宿主 `compaction/start` 的追加时机）—— **仍是未验证的开放问题，且工单低估了它的影响面**

我尝试找宿主 `.asar` 取证，环境里没有可解包的宿主包（`node_modules/@deepseek-ai` 只有 `cordis`/`cosmokit`），**无法静态确认**。

但**可以给出可判定的观察判据**（比工单的「下次压缩后 grep」更精确）：v3 判据读的是**事件流**，而压缩动作必然让事件流里多出 `compaction/start` 或 `compaction/summary`。宿主若在**压缩完成后**才写事件，则本帧读不到、**晚一帧生效**；若在**压缩开始时**写（`compaction/start` 的命名强烈暗示如此），则当帧生效。

⚠️ 无论哪种，**「晚一帧」都不致命**（下一帧仍会触发，因为有 `_compactSeqSeenPre` 基线去重）——唯一代价是「压缩后第一帧拿不到完整版」。这一点工单 §5-3 判断正确，我确认它**不构成阻塞**。

### 2.4 ❌ **新缺陷 P0-A：新判据缺「首次观测基线保护」⇒ 重启/新会话首帧误标 `post_compact`**

**这是工单 §2.5 末尾自问「还有哪些状态遗漏（会话切换、插件重载、`_stTier` 被 reset）」的直接答案 —— 不是理论风险，是确定复现。**

工单 §6 的变异验证只覆盖了「同一 `_stTier` 连续帧」，全部用例都预设 `_compactSeqSeenPre` 已有值。**没有任何一条用例从「全新 state」开始。**

#### 复现（抽真源码 L20723-20734 原文执行，非复刻）

```
=== 反例 A：插件重载 / 宿主重启 / 新会话 runtime —— 首帧基线未建立 ===
    首帧结果: tier=post_compact pending=true seen=7
  FAIL - 历史里已有压缩事件的会话，重启后首帧**不应**被判为 post_compact :: 实际 tier=post_compact
  FAIL - 也不应置 _postCompactPending（否则会白烧一次强制完整版） :: 实际 pending=true

=== 反例 D：C 会话（历史有压缩但首次观测）===
  FAIL - C 会话不应判 post_compact :: tier=post_compact

结果: PASS 4 / FAIL 3
```

#### 为什么这是真缺陷（三条独立佐证）

**① 同仓早已踩过并修过完全一样的坑。** `checkWaterLevel` L6036-6040 有明确的基线保护，注释逐字写着：

> 「首次观测该会话（含宿主刚重启、或插件刚挂到既有会话）只**建立基线**：把启动前就已经存在的 compaction/溢出记为「已见」。否则每次 dsh web 重启都会把历史压缩当成刚发生 → 硬触发立刻 armed 并接续（**2026-09-10 实机踩到：17:50 重启后 0.7 分钟即 armed，而水位只有 48%**）。」

**这是同一条信号、同一个坑，v3 新判据把已经修好的保护丢掉了。**

**② `createRuntimeState()`（L2752）不初始化 `_compactSeqSeenPre`。** 全新 runtime ⇒ 该键 `undefined` ⇒ `Number(undefined) || 0` = 0 ⇒ `_cseqNow > 0` 恒真（只要会话历史里有过任何一次压缩）。

**③ 影响面不是「一次」，是「每次重启 × 每个历史会话」。** 这是持久化会话（`~/.dsh/sessions/.../session.jsonl.zstd`）——用户每次重启 dsh web，所有打开过压缩的长会话**首帧全部误标** `post_compact`，且 `_postCompactPending = true` 触发一次强制完整版（24,617 字符）。这与工单 §8「生产实测未验」形成恶性互补：**这个 bug 会让「post_compact 出现了」这个验证判据本身失真**——日志里看到 `post_compact 档`，很可能不是真压缩，而是重启。

#### 修法（与既有代码同构，3 行）

```js
try {
  const _evPC = sessionEventsOf(agent && agent.session) || []
  const _cseqNow = Number(scanPressureSignalsPre(_evPC).compactionSeq) || 0
  // ★首次观测（含重启/插件重载/新会话）只建立基线，不判压缩 —— 与 checkWaterLevel L6036 同源纪律
  if (_stTier._compactSeqSeenPre === undefined) {
    _stTier._compactSeqSeenPre = _cseqNow
  } else if (_cseqNow > Number(_stTier._compactSeqSeenPre)) {
    _stTier._compactSeqSeenPre = _cseqNow
    if (_tierGuess !== INJECT_TIERS.HANDOFF_CARRY) {
      _tierGuess = INJECT_TIERS.POST_COMPACT
      _stTier._postCompactPending = true
    }
  }
} catch (_ePC0) {}
```

**代价**：插件重载后若真的刚压缩过，那次不触发（可接受——重启后本来就会走首帧完整版路径）。

---

### 2.5 ❌ **新缺陷 P0-B：「压缩后强制完整版」在年轻会话里不成立**

工单 §3.1（缺陷报告 §16 修复 2）声称：

> 「直接把 `_lastFullStepSeq` 归零（等价于「间距已远」）… 后续 `(stepSeq - _lastFullStepSeq) < gap` 判定自然不成立 ⇒ 走「间距已满足」分支。」

**这个推理有前提漏洞：它只在 `stepSeq >= gap` 时成立。**

#### 复现（抽 L21443-21574 真源码块执行）

```js
// 场景 2：年轻会话 stepSeq=7 < gap=20 ⇒ 压缩后
    out=SLIM  diags=["tiered inject: → 完整版（★压缩后强制重建 · post_compact 档）",
                     "tiered inject: → 精简版(节流 1/20)"]
    消费后 _postCompactPending = false  _lastFullStepSeq = 0
  FAIL - ★压缩后强制完整版必须无条件成立（与 stepSeq 无关） :: 实际 SLIM
```

**注意 `_postCompactPending` 已被消费成 `false`** —— 这次机会**永久丢失**，不会重试。

#### 机理

`_lastFullStepSeq = 0` 之后，判定是 `(stepSeq - 0) < gap` 即 `stepSeq < 20`。宿主 `_stepSeq` 从 1 开始、**按模型请求**递增（L20884）。所以：

| 会话阶段 | `stepSeq` | 压缩后结果 |
|---|---|---|
| 刚开局 / 插件刚装 | 1–19 | ❌ **精简帧**（2,180 字符），机会丢失 |
| 正常长会话 | ≥20 | ✅ 完整帧 |

**讽刺的是**：真正会发生压缩的恰恰是长会话（`stepSeq` 早就 > 20）⇒ **生产中反而大概率不触发**。所以这是「逻辑不成立但生产不常显形」的缺陷 —— 属于工单 §3.1 自问「这是掩盖还是根治」的又一个例证。

#### 工单的验证为什么没抓到

`§6 ④ _verify-pc8.mjs` 只测了**档位判据**（`_tierGuess` 会不会变成 `post_compact`），**完全没测**「`_postCompactPending` 被消费后是否真的返回了完整帧」。这两件事在本仓是**分离的两段代码**（L20723 vs L21464），只测前者的套件对后者零覆盖。

⇒ 这正是本仓记忆里反复出现的「**恒真守卫**」家族第 N 例：断言了「标记被置位」，没断言「置位产生了预期输出」。

#### 修法

```js
// L21464 附近
if (st._postCompactPending === true) {
  st._postCompactPending = false
  st._lastFullStepSeq = 0
  // ★压缩后是「必须给全貌」的硬语义，不能靠「间距已远」间接实现（stepSeq < gap 时不成立）
  //   显式短路：把本轮视为已满足间距，绕过 (stepSeq - _lastFullStepSeq) < gap
  _postCompactForceFull = true
  ...
}
// 然后把这个短路真正接到判定上（当前 _postCompactForceFull 只用于 `||` 日志指纹判断，未接间距判定）
```

或者更简单：`st._snapFp = undefined`（等价于「从未注入过」⇒ 走首帧分支，无条件完整版）。

---

## §3 检验项 2-5（工单其余改动）

### 3.1 ⚠️ `planCap` 与白板预算耦合 —— 工单三道逻辑质疑的答案

**工单问 1「这只是抬高桶上限，还是消除了真实的预算冲突？」** —— **只是抬高桶上限，没有消除冲突**。

我用真引擎实测 `human_full`：

```
chars   = {"rules":8291,"memoryReferences":12465,"otherDynamic":3580,"total":24336}
limits  = {"memoryReferences":16699,"otherDynamic":null}
injectBudgetChars = 8000   实际 total = 24617
```

`limits.memoryReferences = sub*4 + catalogCost + planCap + ledgerCap + 400 = 16,699`，其中 `planCap = 8,000`。

⇒ **`planCap` 已占整个 `memoryReferences` 上限的 48%**。它确实大于白板实际产出（1,889）⇒ 白板不再被 drop（实测 `dropped=[]`，修好了）。**但这是把桶撑得比白板需要的大 4 倍来实现的**。

**工单问 3「两个变量是否应合并成单一真源？」** —— **应该，而且现在已经有可验证的漂移**。我用源码实抽比对：

```
=== 3. 白板预算名单（_isFullTier）vs 桶预留名单（_planCapFullIdx）===
    _isFullTier   : legacy=true human_full=true ... post_compact=true handoff_carry=true
    _planCapFullIdx: legacy=true human_full=true ... post_compact=true handoff_carry=true
  ok   - 两份名单必须一致
```

当前**恰好一致**，但这是「两份手写名单复制粘贴」的结果，不是结构保证。工单 §4 欠条 4 的判断成立。

**工单问 2「更正确的做法是不是让 `_planBudget` 反过来受 `planCap` 约束？」** —— **不建议**。`planCap` 是桶的**预留**（记账用），`_planBudget` 是渲染的**截断线**（实际产出）。让渲染反过来受记账约束，等于「按帽子的尺寸决定头的大小」，会让白板在瘦档也被压到不该有的程度。正解是**两者同源**（都已读 `injectBudgetChars` / `fullInjectSlimBudgetChars`），但 `planCap` 应取**白板的实际预算**而不是「全局注入预算」——当前 `planCap = injectBudgetChars = 8000` 而白板真实产出 1,889，**预留超配 4.2 倍**，直接吃掉 `memoryReferences` 的可用额度。这正是 `human_slim` / `run_full` 丢 `recent-logs` 的原因（见下条）。

### 3.2 ⚠️ `event-cards` 升 `must` 的副作用 —— **工单自己预料到了，我实测确认它已发生**

```
=== 丢段 / 截断（每档）===
human_slim        dropped=[recent-logs]  truncated=[]
run_full          dropped=[recent-logs]  truncated=[]
hang_compensate   dropped=[recent-logs]  truncated=[]
```

**工单 §3.2 问的反话「『当前在做什么』优先于『历史日志』是否成立？」——在当前实现下这个问题已经不是理论问题：三个档位每轮都在丢 `recent-logs`。**

`recent-logs` 的 priority 是 `low`（L11060 附近 `part(... 'low')`），而 `event-cards` 现在是 `must`。`memoryReferences` 超限时，`enforceLimit` 按优先级从低到高丢 ⇒ `recent-logs` 必然先死。

**工单 §3.1 的自问「若模型需要回溯旧事而 `memory_recall` 未被调用，是否造成缺失？」** —— 会。但**根因不是 `must` 升级本身，而是 `planCap` 超配**（见 3.1）：`planCap=8000` 把桶撑大后，桶里**真实的** `memoryReferences` 占用 = 12,465，超限 16,699 没有；但 `human_slim` 的总量只有 19,698 却仍丢段——说明是**瘦档的 `planCap=3000` + `sub` 挤压**所致。

**我的判断**：`event-cards` 升 `must` 是**正确的设计决策**（用户裁定「user_full 尽量完整投递内容」，事件卡是「当前在做什么」= 最高时效性），但**必须配套**解决 `planCap` 超配，否则等于「用低频段的死换高频段的活」。

### 3.3 ✅ `run_slim` 砍白板 vs 砍事件卡 —— 工单的反问答案是「当前实现正确」

工单问「砍白板是否比砍事件卡更合理？（当前实现砍了白板，保留事件卡）」

**我判定：当前实现正确，工单的反问方向是错的。** 理由：

- `run_slim` = 「最克制，只有功能指导」（用户逐字）。**白板 1,825 字符是「项目全貌」，事件卡 3,149 字符是「当前在做什么」**。
- 但用户 P0-3 原话是「那**事件卡和画像**就不该给，这是 human_slim 和 run_full 该干的事」—— 明确点名**事件卡**该砍。
- 实测 `run_slim` 的**完整帧**里 `event-cards = 3,149`（未砍），只砍了白板。**这与用户裁定矛盾。**
- `renderSlimSnapshotPre`（精简帧）里 `run_slim` 确实砍了事件卡+画像（1,999 vs 2,180，实测吻合），**但完整帧没砍**。

⇒ **这是漏做，不是反问。** 用户说的「run_slim 不该给事件卡」在完整帧路径上**未实现**。

### 3.4 ✅ `hang_compensate` 不投画像 —— 成立，我实测确认

```
hang_compensate     18303    4142   1825    3149         0         0
```

画像 = 0 ✅。且与 `semantic-recall` 名单一致性我做了机器比对：

```
=== 4. 画像名单 vs semantic 名单 ===
  ok   - 画像与 semantic 名单一致（P2-5 已改正向，一处改全）
```

**8 档逐档一致**，改法正确（一次改全，没有留半修）。

---

## §4 历史欠条逐条判定

### 欠条 1：`decideInjectTierPre` 3/5 优先级是死代码 —— ✅ **成立（比工单说的更严重）**

我用源码实测非注释提及数：

```
isHumanTierPre         总提及=  1 非注释行= 1 行号=1775
isPlanFullTierPre      总提及=  2 非注释行= 2 行号=1778,1938
shouldInjectPlanPre    总提及=  2 非注释行= 2 行号=1781,1937
isRulesFullTierPre     总提及=  3 非注释行= 1 行号=1804
planSpecForTierPre     总提及=  3 非注释行= 1 行号=1935
```

- `isHumanTierPre`：**只有定义行，零消费**（模块内也没有）
- `isPlanFullTierPre` / `shouldInjectPlanPre`：只在 `planSpecForTierPre` 内部被调，而 `planSpecForTierPre` **本身零生产消费**
- **整个簇是死的**（只有测试在用）

`decideInjectTierPre` 的唯一调用点确实是 L20694，只传 2 个参数 ⇒ `isCarry`/`postCompact`/`hangComp` 三个分支**在整个生产路径上永不可达**。

#### ⚠️ 我发现的**第 6 条欠条**（工单 §7 明确要求找）

**`isPlanFullTierPre` 与生产内联 `_planSpec.fullTier` 已经语义漂移了 2 个档位：**

```
=== 1. 模块级 isPlanFullTierPre vs 内联 _planSpec.fullTier ===
    模块级: legacy=true  human_full=true  human_slim=false run_full=false run_slim=false post_compact=false handoff_carry=true  hang_compensate=false
    内联  : legacy=false human_full=true  human_slim=false run_full=false run_slim=false post_compact=true  handoff_carry=true  hang_compensate=false
  FAIL - ★模块级 isPlanFullTierPre 必须与生产内联 _planSpec.fullTier 逐档一致 :: 漂移档位: legacy,post_compact
```

**两个方向都错**：
- `legacy`：模块级说「全文」，内联说「不是全文」（内联把 LEGACY 单独走了 `_T.LEGACY` 分支，因为 legacy 要按 `_legacySlim` 强制白名单）
- `post_compact`：本轮把 `post_compact` 加进了内联的 `fullTier`（L10446）和 `isRulesFullTierPre`（L1804），**但漏了 `isPlanFullTierPre`（L1778）** —— 典型的「一次改全」漏项。

**这解释了为什么工单 §3.1 的修复没有连带失效**：因为生产走内联，测试走模块级，**两套判据各测各的，漂移无人发现**。工单 §4 欠条 1 说的「同一语义两份判据」，在 `isPlanFullTierPre` 这里是**第 2 处**（工单只数了 `decideInjectTierPre`）。

**方案 A 还是 B 的裁定：** 工单倾 B（删死分支），我**同意 B，但理由不同**：
- A（三覆盖并入入参）会新增参数传递路径，而 L20694 附近的 `_isHumanNow` / `isUnattendedNow()` 都是**幂等但非零成本**的调用（`isUnattendedNow` 要读文件时间戳）；并入函数会让它们**每帧多调一次**。
- B（删死分支 + 改注释）改动面 = 1 个函数体 + 1 行注释，且**与现状行为完全一致**（死分支本来就不执行）。
- **但 B 必须连带做**：删 `isPlanFullTierPre` / `shouldInjectPlanPre` / `planSpecForTierPre` 整簇，或把它们改成「从内联名单派生」（单一真源）。否则漂移只会继续。

### 欠条 2：`refreshWaterLevel` 不存在 —— ✅ **成立**

```
$ grep -c "refreshWaterLevel" lib/index.js
1
```
唯一命中就是 L20914 那条注释本身。真名是 `checkWaterLevelAtStep`（L6255）。**纯注释 bug，零行为影响。**

### 欠条 3：`contextVersion` 其余 22 处引用是否同类误用 —— ❌ **不成立（工单担心过头）**

我逐点核了工单列的 7 处：

| 位置 | 用途 | 判定 |
|---|---|---|
| L9158 / 9483 / 9534 / 9537 | 缓存/复用判据（`projectionCv` vs `currentCv`） | ✅ **合理**——`contextVersion` 语义正是「检索上下文变了没」，做缓存失效判据**就是它的设计用途** |
| L13589 / 13611 | segment 记录（写入 seg 时带 cv） | ✅ **合理**——记录「这条 segment 属于哪个上下文版本」 |
| L16268 | event 记录（转发宿主事件的 cv） | ✅ **合理**——同上是数据透传，不参与判定 |

**工单原本写「关键：它的语义是「observer 产生有效 Segment 时递增」，与「上下文是否压缩」正交。做缓存失效判据合理，做压缩信号错误。」——这个判断本身是对的，而且它自己已经回答了。22 处里没有第二处误用。**

⚠️ 但我要指出工单**漏了一个真正的风险点**：`purgeObserverStorage`（L3248）会把 `rt.contextVersion = 0`。这是**唯一的归零路径**，触发条件是「`associativeMemoryEnabled` true→false」。如果哪天有人拿它当「压缩发生」的信号，会重蹈 v1 的覆辙。建议在这行加注释锁死语义。

### 欠条 4：`planCap` / `_planBudget` 语义重叠 —— ✅ **成立**（详见 §3.1）

「修 bug 的方式是让两者相等——这更像掩盖而非根治」**判断正确**。实测 `planCap=8000` 而白板产出 1,889，**超配 4.2 倍**。

### 欠条 5：`snapshotReinjectOnCompact` 开关被架空 —— ✅ **成立，且我发现了第二个同类死键**

```
=== fullInjectOnCompact  总提及=0  非注释=1
   1085: fullInjectOnCompact: true,           ← 死键，零消费
=== snapshotReinjectOnCompact  总提及=0  非注释=1
   1047: snapshotReinjectOnCompact: true,     ← 死键，零消费
```

- `snapshotReinjectOnCompact`：工单已指出被架空（`_postCompactPending` 不看它）。**确认：`lib/index.js` 里只剩 DEFAULT_CONFIG 一处，渲染/判定路径零读取。** 但**前端 3 处仍在渲染这个开关**（`lib/client.js:15795 / 19355 / 22483`）+ 三语文案 ⇒ 用户拨动开关**完全无效果**。
- **★新发现 `fullInjectOnCompact`**：注释逐字写「★F5：上下文压缩后是否注入完整版（并显式告知模型「刚才压缩了，记忆在这里随时可拉」）」，但**全仓零消费**（`lib/client.js` 也没有）。这是**比欠条 5 更彻底的死键** —— 连前端都没接线。

**而且它暴露了一个语义缺口**：注释承诺「显式告知模型『刚才压缩了』」，但 `post_compact` 档**渲染输出里没有任何压缩提示文本**（我在 `renderMemoryDynamic` 内逐行扫过，`POST_COMPACT` 只出现在 6 处名单判断里，**没有一处产生「刚才压缩了」的文案**）。⇒ **`post_compact` 与 `human_full` 的输出逐字节相同（24,617），模型无法分辨这是「人说话」还是「刚压缩」。**

工单 §5-4 自问「`post_compact` == `human_full` 对不对？」，这里给出**反证**：不只是「可能要多给」，而是**语义上缺了一整块** —— 用户裁定里的「压缩后提醒」在实现里根本不存在。

**裁定：接线还是删配置？** 我建议**接线**（不是删）：
- 用户在设计纲要里明确要求「压缩后提醒」是 F5 的一部分（`INJECT_TIERS.POST_COMPACT` 的 JSDoc L1766 逐字写「核心 3 节白板 + 规则全文 + 「刚才压缩了」提示」）
- 但现在连 **JSDoc 本身也过时了**（写「核心 3 节」，实际已升为全文）
- 最小接线：`_postCompactPending` 消费时往 `segs` 里 push 一段 `must` 级的「[上下文已压缩] 刚才的对话历史已被压缩…」，并让 `snapshotReinjectOnCompact === false` 时跳过标记
- 若确认不做，则应**同时删** `fullInjectOnCompact` 和 `snapshotReinjectOnCompact` 两个键 + 前端 3 处 UI + 3 语文案

---

## §5 工单 §5「我可能错在哪」逐条裁决

| # | 工单自我质疑 | 我的裁决 | 依据 |
|---|---|---|---|
| 1 | `contextVersion` 永不回退 | ✅ **成立** | 全仓只有 L3370 `+1` 和 L3260 `=0`（且后者只在关闭 observer 时）；`lib/` 其它文件无写入 |
| 2 | `scanPressureSignalsPre` 同步无竞态 | ✅ **成立**（但 `sessionEventsOf` 的理由与工单不同） | 见 §2.2；`snapshotEvents()` 缓存是「追加前」复用，不是陈旧值 |
| 3 | 压缩当帧能读到事件 | ⚠️ **无法静态验证，但不阻塞** | 见 §2.3；晚一帧不致命（有基线去重） |
| 4 | `post_compact` == `human_full` | ❌ **工单问错了方向** | 见 §4 欠条 5：「刚才压缩了」提示根本不存在，不是「要不要更多」 |
| 5 | 变异 C 用状态机已补足 | ❌ **不成立 —— 这是本轮最大盲区** | 见 §2.4：**全新 state（重启/新会话）零覆盖**，且实测红 3 条 |

---

## §6 我找到的三个新缺陷（工单完全没有）

### P0-A：`_compactSeqSeenPre` 缺首帧基线保护（**必现、高频**）

- **触发**：任何重启 / 插件重载 / 新会话 runtime + 会话历史里有压缩事件
- **症状**：首帧误标 `post_compact` + `_postCompactPending=true` ⇒ 白烧一次 24,617 字符强制完整版
- **铁证**：`checkWaterLevel` L6036-6040 有同款保护，注释记录过 2026-09-10 实机事故
- **后果的元影响**：污染工单 §8 的验证判据 —— 「日志里看到 post_compact」不再能证明修复生效
- **修法**：3 行，见 §2.4

### P0-B：`post_compact` 强制完整版在 `stepSeq < gap` 时失效（**必现、低频**）

- **触发**：会话模型请求数 < `snapshotMinGapRounds`（默认 20）时发生压缩
- **症状**：返回精简帧 2,180 字符，且 `_postCompactPending` 已消费为 `false` ⇒ **机会永久丢失**
- **铁证**：反例执行输出 `out=SLIM`，`_postCompactPending=false`
- **为什么生产少显形**：压缩通常发生在长会话（`stepSeq > 20`）
- **修法**：`_postCompactForceFull` 要真正接到间距判定，或直接 `st._snapFp = undefined`。见 §2.5

### P1-C：`isPlanFullTierPre` 与内联名单漂移 2 档（`legacy` / `post_compact`）

- **触发**：任何人调用模块级 `planSpecForTierPre('post_compact')`
- **症状**：返回「7 节白名单」而非「全文」⇒ 与生产内联行为不一致
- **当前影响**：**零**（模块级零生产消费）。但它是「未来接线的定时炸弹」
- **同族**：`isHumanTierPre` 全仓零消费；`planSpecForTierPre` 零消费
- **修法**：删整簇，或改成从单一真源派生

### 附带：两条纯死配置

| 键 | 位置 | 消费 |
|---|---|---|
| `snapshotReinjectOnCompact` | L1047 | **0**（前端却渲染了 3 处 UI） |
| `fullInjectOnCompact` | L1085 | **0**（连前端都没接线） |

---

## §7 我独立确认「成立」的部分（避免只报坏消息）

这些是工单做对了、我逐条复核通过的：

1. **v3 判据的选择正确**：同步纯函数、无 await、无竞态。`_verify-pc6/pc7/pc8` 三个脚本我原样重跑，数字全对。
2. **变异验证方法论正确**：变异 A（去 `>`）必红 2 条、变异 B（删 CARRY 保护）必红 1 条、变异 C 单帧逃逸 → 用状态机补测。**这套方法本身是本轮最有价值的产出**，即使用例集合不全。
3. **`_postCompactPending` 优于 `lastCompactionSeen`**：避免跨函数时序耦合，方向对。
4. **P2-5 画像改正向名单**：8 档逐档机器比对一致，无半修。
5. **`planCap` 与 `_planBudgetBase` 同源**：确实消除了「白板被 drop 成 0」的症状（实测 `dropped=[]`）。
6. **全量回归 531/0**：我独立重跑确认，比工单声称的 530/1 更好。
7. **R153_CHARS 重钉 1350440**：我算的 LF 归一化长度 + sha16 与工单头部**逐位吻合**。

---

## §8 复现命令（可直接跑）

```bash
cd /d/dsh-auto-memory

# ① 语法 / 导入
node --check lib/index.js && node -e "import('./lib/index.js').then(m=>console.log('IMPORT_OK',Object.keys(m).length))"

# ② 全量回归（约 162 秒）
node tools/run-smoke.mjs --jobs=8 --timeout=180000      # 实测 PASS 531 / FAIL 0

# ③ 工单原有验证（全部可复现）
node artifacts/_verify-pc6.mjs    # 同步信号
node artifacts/_verify-pc7.mjs    # PASS 5 / FAIL 0（变异 A/B 必红、C 未红）
node artifacts/_verify-pc8.mjs    # 状态机 PASS 2 / FAIL 0

# ④ 本轮新增的三组反例（证明工单遗漏）
node .verify-tmp/v1-matrix.mjs    # 8 档渲染矩阵 + 丢段
node .verify-tmp/v2-state.mjs     # ★P0-A：应 PASS 6 / FAIL 0，现状 PASS 4 / FAIL 3
node .verify-tmp/v3-forcefull.mjs # ★P0-B：应 3/0，现状 0/3
node .verify-tmp/v4-drift.mjs     # ★P1-C：应 4/0，现状 3/1

# ⑤ 生产日志
grep -c 'post_compact'        ~/.dsh/dsh-auto-memory-diagnose.log   # 0（修复前）
grep -c 'compaction-detected' ~/.dsh/dsh-auto-memory-diagnose.log   # 17（真信号活着）
```

**注意**：`.verify-tmp/` 是我本轮新建的临时验证目录（未提交），不属于产品代码。

---

## §9 建议的处理顺序

| # | 项 | 优先级 | 理由 |
|---|---|---|---|
| 1 | **P0-A 首帧基线保护** | **必须** | 高频、误判污染验证判据、有现成同源修法 |
| 2 | **P0-B 强制完整版接通间距短路** | **必须** | 语义不成立（`_postCompactPending` 白丢） |
| 3 | 补「刚才压缩了」提示段 | 高 | 用户设计纲要明确要求，当前**完全缺失** |
| 4 | `planCap` 改取白板实际预算（非 `injectBudgetChars`） | 高 | 超配 4.2 倍，挤压 `recent-logs` |
| 5 | `run_slim` 完整帧砍事件卡 | 中 | 用户逐字裁定未落实 |
| 6 | 删/改 `isPlanFullTierPre` 簇 | 中 | 已漂移 2 档，未来接线会踩 |
| 7 | `fullInjectOnCompact` / `snapshotReinjectOnCompact` 接线或删除 | 中 | 前端 3 处 UI 空转 |
| 8 | L20914 注释改正 | 低 | 纯文案 |

**给工单作者的元评价**：§2 的核心判断（v3 判据正确）是**对的**，竞态论证也**扎实**。真正的盲区在**验证方法的覆盖度**——所有用例都从「已有基线值的 state」出发，因此天然测不到「首帧建基线」这条路径；所有断言都停在「标记被置位」，因此测不到「置位后输出是否真的变了」。这两个盲区都不是知识问题，是**测试夹具的起点选择**问题。
