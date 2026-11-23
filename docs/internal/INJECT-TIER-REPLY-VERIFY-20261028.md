# 交叉检验回执 · 核验结论与修复记录

> 核验时间：2026-10-28 23:5x | 仓库 `D:\dsh-auto-memory`
> 被核验文档：`INJECT-TIER-DOUBLE-CHECK-REPLY-20261028.md`（第三方交叉检验回执）
> 核验方式：**逐条独立复现**（不采信回执结论，自己写反例脚本）

---

## §0 总判定

**回执的核心指控全部成立。我上一轮的工单确实漏了 3 个真缺陷。**

| # | 回执指控 | 我的核验 | 处理 |
|---|---|---|---|
| **P0-A** | `_compactSeqSeenPre` 缺首帧基线保护 ⇒ 重启误标 `post_compact` | ✅ **成立**（我独立复现：`pending=true`） | ✅ **已修** + 6 条用例 |
| **P0-B** | 强制完整版在 `stepSeq < gap` 时失效，机会永久丢失 | ✅ **成立**（条件只接了日志指纹，未接间距判定） | ✅ **已修** + 5 条用例 |
| **P1-C** | `isPlanFullTierPre` 与内联名单漂移 2 档 | ✅ **成立**（`post_compact` 刚被我漏改） | ✅ **已修** |
| 附加 1 | `run_slim` 完整帧未砍事件卡（违背用户逐字裁定） | ✅ **成立**（实测 cards=3,149） | ✅ **已修** |
| 附加 2 | `post_compact` 缺「刚才压缩了」提示（JSDoc 承诺但代码 0 处生成） | ✅ **成立** | ✅ **已修**（新增 109B must 段） |

**回归：PASS 531 / FAIL 0 / TIMEOUT 0**（R176，162.0s）

---

## §1 逐条核验（含我如何独立复现）

### 1.1 P0-A：首帧基线保护缺失 —— 成立，且**我原来的验证方法必然测不到**

**回执原话**：
> 「工单 §6 的变异验证只覆盖了「同一 `_stTier` 连续帧」，全部用例都预设 `_compactSeqSeenPre` 已有值。**没有任何一条用例从「全新 state」开始。**」

**这条批评完全正确。** 我的 5 条用例全部构造 `{ _compactSeqSeenPre: <某值> }` 出发。

**我自己的反例（独立编写，非采信回执）**：
```
全新 state（模拟重启/插件重载/新会话）+ 会话历史里已有压缩 seq=7
  修复前：tier=undefined / pending=true  ← 误标，白烧一次 24,617 字符
  修复后：tier=human_full / pending=false / seen=7  ← 只建基线
```

**关键佐证（回执指出，我复核确认）**：同仓 `checkWaterLevel` L6037-6040 **早就有同一保护**，注释记录过 2026-09-10 实机事故：
> 「否则每次 dsh web 重启都会把历史压缩当成刚发生 → 硬触发立刻 armed 并接续（17:50 重启后 0.7 分钟即 armed，而水位只有 48%）」

**同一信号、同一个坑，我在新判据里把已修好的保护丢了。**

**修法**：
```js
if (_stTier._compactSeqSeenPre === undefined) {
  _stTier._compactSeqSeenPre = _cseqNow   // 首次观测只建基线
} else if (_cseqNow > Number(_stTier._compactSeqSeenPre)) {
  ... 正常触发
}
```

**验证 6 条（含负路径）**：
```
PASS 首帧+历史有压缩 ⇒ human_full
PASS 首帧 ⇒ 不置 pending
PASS 首帧 ⇒ 建立基线(值=7)
PASS 基线7 + 新压缩seq8 ⇒ post_compact   ← 负路径：修复不能矫枉过正
PASS 无压缩+全新state ⇒ human_full
PASS 无压缩 ⇒ 基线=0
结果: PASS 6 / FAIL 0
```

---

### 1.2 P0-B：强制完整版失效 —— 成立，回执的机理分析正确

**回执原话**：
> 「`_lastFullStepSeq = 0` 之后，判定是 `(stepSeq - 0) < gap` 即 `stepSeq < 20`。宿主 `_stepSeq` 从 1 开始…刚开局/插件刚装 ⇒ 1–19 ⇒ 精简帧，**且 `_postCompactPending` 已消费为 false，机会永久丢失**。」

**我复核**：`_postCompactForceFull` 全仓 3 处，唯一消费是 L21489 的 `||`（日志指纹判断），**从未接到 L21507 的间距判定**。

⇒ 我的注释写着「后续 `(stepSeq - _lastFullStepSeq) < gap` 判定自然不成立」，**这个推理只在 `stepSeq >= gap` 时才成立，我漏了这个前提**。

**修法**：间距判定加显式短路
```js
} else if (!_postCompactForceFull && ((Number(st._stepSeq) || 0) - (Number(st._lastFullStepSeq) || 0) < gap)) {
```

**验证 5 条（逐字抽源码条件执行）**：
```
PASS 压缩后 stepSeq=7  < gap=20 ⇒ 不节流
PASS 压缩后 stepSeq=1  < gap=20 ⇒ 不节流   ← 年轻会话场景
PASS 无压缩 stepSeq=7  < gap=20 ⇒ 节流     ← 负路径：不能把节流整体废掉
PASS 无压缩 stepSeq=25 ≥ gap=20 ⇒ 不节流
PASS 压缩后 stepSeq=100        ⇒ 不节流
```

**补充（回执第 162 行点出我的方法论盲区）**：
> 「`_verify-pc8.mjs` 只测了**档位判据**，**完全没测**「`_postCompactPending` 被消费后是否真的返回了完整帧」。这两件事在本仓是**分离的两段代码**（L20723 vs L21464）。」

⇒ 我另加端到端检查：「置 `_postCompactForceFull=true`」+「短路已接线」双断言。

---

### 1.3 P1-C：`isPlanFullTierPre` 漂移 —— 成立（这是我又一次「半修」）

**事实**：
```
模块级 isPlanFullTierPre: HUMAN_FULL | HANDOFF_CARRY | LEGACY            ← 缺 POST_COMPACT
内联 _planSpec.fullTier : HUMAN_FULL | HANDOFF_CARRY | POST_COMPACT      ← 有
```

**这就是回执说的「一次改全漏项」**：我给内联和 `isRulesFullTierPre` 都加了 `POST_COMPACT`，唯独漏了这个。

**为什么没被测出来**：生产走内联，而 `isPlanFullTierPre` / `planSpecForTierPre` / `shouldInjectPlanPre` / `isHumanTierPre` **整簇零生产消费**（只有测试用）⇒ 两套判据各测各的，漂移无人发现。

**修法**：补 `POST_COMPACT` + 在注释里写明「本函数与内联必须逐档一致」以及 `legacy` 的语义差异（内联把 LEGACY 单独分支，本函数的 `|| LEGACY` 实际不等价）。

---

### 1.4 附加 1：`run_slim` 完整帧未砍事件卡 —— 成立，**违背用户逐字裁定**

**用户原话**：「run_slim 应该是「最克制，只有功能指导」—— 那**事件卡和画像**就不该给」。

**事实**：我上一轮只在**精简帧**（`renderSlimSnapshotPre`）里砍了，**完整帧路径没砍** ⇒ 实测 `run_slim` 完整帧 cards=3,149。

**修法**：`if (!(_tier === _T.RUN_SLIM) && s.eventCardsText) pushPart(...)`

**验证**：`run_slim` 完整帧 cards = **0**，总字符 24,617 → 13,198。

---

### 1.5 附加 2：「刚才压缩了」提示 —— 成立，JSDoc 承诺但**代码 0 处生成**

**回执原话**：
> 「`post_compact` 与 `human_full` 输出逐字节相同（24,617），模型无法分辨这是「人说话」还是「刚压缩」。」

**我复核**：`grep '刚才压缩|上下文已压缩'` 全仓 2 处命中，**都是注释**（L1084 `fullInjectOnCompact`、L1766 `POST_COMPACT` JSDoc）。

⇒ 这是一个**纯语义缺口**：`post_compact` 档存在的唯一理由就是「压缩后重建 + 告知模型」，而告知部分从未实现。

**修法**：新增 `post-compact-notice` 段（`must`，位置在 frame-head 后）
```
post_compact  总=24,727  notice=109B   ← 有提示
human_full    总=24,617  notice=  0B   ← 无提示，符合预期
```

**同时必须登记 ZONE 注册表**（这一步我一开始漏了，被 `v4-b2` 守卫当场红）：
```
FAIL ★★所有注入段 kind 都已登记进 ZONE_BY_KIND_PRE_V1 => 未登记: post-compact-notice
```
归 `compliance`（不可裁剪）而非 `memory`：它是元信息，被裁掉就失去意义。

---

## §2 我对回执的**反驳**（不是全部接受）

### 2.1 回归数字：回执说 531/0，我当时是 530/1 —— 回执对

回执独立重跑得 531/0，我当时报 530/1（`v4-c4` libuv 退出竞态）。**这是并行假红，回执那轮没撞上。** 我接受回执的数字，但保留「该套件在 `--jobs=8` 下不稳定」的判断。

### 2.2 欠条 3（`contextVersion` 其余 22 处）：回执判「不成立」，我接受

我在工单里写「请复核其余 22 处是否还有同类误用」——回执逐点核了 7 处，判定全部合理（缓存失效 / segment 记录 / 事件透传），**并指出我自己已经在同一段里回答了这个问题**（「做缓存失效判据合理，做压缩信号错误」）。

⇒ **我的工单在这里过度自我怀疑，反而模糊了结论。** 接受回执判定。

但回执补充的风险点我采纳：`purgeObserverStorage`（L3248）的 `rt.contextVersion = 0` 是唯一归零路径，**应加注释锁死语义**，防止将来有人拿它当压缩信号（重蹈 v1 覆辙）。

### 2.3 `planCap` 的修法方向：回执反对我的「两者同源」——我接受，但暂不改

回执论证：
> 「`planCap` 是桶的**预留**（记账用），`_planBudget` 是渲染的**截断线**（实际产出）。让渲染反过来受记账约束，等于「按帽子的尺寸决定头的大小」。」

**这个反驳成立。** 但回执也指出当前 `planCap = injectBudgetChars = 8000` 而白板实际产出 1,889，**超配 4.2 倍**，直接挤占 `memoryReferences` 可用额度。

⇒ **本轮暂不改**（属独立预算重构，需单独批次 + 完整预算账本回归），已记入待办。**理由是有实证的**：改了会动 `memRefLimit`，影响所有档位的丢段行为，风险高于本轮范围。

### 2.4 回执的元评价，我接受

> 「真正的盲区在**验证方法的覆盖度**——所有用例都从「已有基线值的 state」出发…所有断言都停在「标记被置位」，因此测不到「置位后输出是否真的变了」。这两个盲区都不是知识问题，是**测试夹具的起点选择**问题。」

**这是准确诊断。** 我的验证方法论有两个系统性缺陷：
1. **起点单一**：只测「已有状态」，不测「初始状态」
2. **断言层级单一**：只测「标记」，不测「标记产生的输出」

---

## §3 本轮修复清单（5 项全部有反例验证）

| # | 缺陷 | 修法 | 验证 |
|---|---|---|---|
| P0-A | 首帧无基线保护 | `=== undefined` 分支只建基线 | PASS 6/0 |
| P0-B | 强制完整版被间距节流 | 间距判定加 `!_postCompactForceFull` | PASS 5/0 |
| P1-C | 模块级名单漂移 | 补 `POST_COMPACT` | 静态+运行双验 |
| 附加1 | `run_slim` 完整帧投事件卡 | 按档位门控 | cards 3,149 → 0 |
| 附加2 | 缺「刚才压缩了」提示 | 新增 `post-compact-notice`（must） | notice 0 → 109B |

**附带修复的判据过期**（非产品缺陷）：
- `smoke-test-v5-p3` B-5：`post_compact` 已升全文，判据从 `Array.isArray(sections)` 改为 `sections === null`，并加 B-5b 防回退断言
- `smoke-test-r26` R153_CHARS 重钉：1,350,440 → 1,353,227（Δ+2,787）

---

## §4 仍待处理（未修，已记录理由）

| # | 项 | 为什么本轮不修 |
|---|---|---|
| 1 | `planCap` 超配 4.2 倍（回执 §3.1） | 属独立预算重构，会动 `memRefLimit` 影响所有档位丢段行为，需单独批次 + 预算账本回归 |
| 2 | `decideInjectTierPre` 死分支（欠条 1） | 方案 B（删死分支）需连带处理 `isPlanFullTierPre` 整簇，改动面超出本轮 |
| 3 | 两条死配置 `snapshotReinjectOnCompact` / `fullInjectOnCompact` | 接线 vs 删配置需产品决策（前端 3 处 UI + 三语文案连带） |
| 4 | `purgeObserverStorage` 的 `contextVersion = 0` 加注释 | 低风险改动，但属注释类，可并入下一批 |
| 5 | `post_compact` 生产实测 | 需等下次真实压缩（且 P0-A 修好后，日志里的 `post_compact` 才可信） |
| 6 | `docs/WHITEPAPER.md` L271-284 过时 | 文档同步批次 |

---

## §5 复现命令

```bash
cd /d/dsh-auto-memory

# 全量回归
node tools/run-smoke.mjs --jobs=8 --timeout=180000   # PASS 531 / FAIL 0

# 本轮 5 项修复的综合验证
node artifacts/_verify-all.mjs      # PASS 9 / FAIL 0

# P0-A 反例（首帧基线）
node artifacts/_repro-p0a.mjs       # PASS 6 / FAIL 0

# P0-B 验证（间距短路）
node artifacts/_verify-p0b.mjs      # PASS 5 / FAIL 0

# 端到端（含 notice 段）
node artifacts/_e2e-p0b.mjs
```

---

## §6 元结论

**回执的质量高于我的工单。** 它做到了三点我做不到的：
1. **不从「已有状态」出发**：所有反例都从全新 state 开始，这是 P0-A 能被发现的唯一路径
2. **不满足于「标记被置位」**：追到输出层（`_postCompactPending` 消费后是否真返回完整帧），这是 P0-B 的发现路径
3. **对我的自我质疑做反向裁决**：欠条 3 判我不成立、`planCap` 修法判我方向错——**而不是顺着我的框架走**

**我的教训（已固化为方法论）**：
> 有状态判据的验证必须覆盖三个起点：**初始（undefined）/ 已有值 / 重置后**。
> 判据验证必须追到**输出层**，不能停在标记层。
