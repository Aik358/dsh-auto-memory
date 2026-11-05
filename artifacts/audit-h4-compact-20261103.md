# H4 压缩后首轮完整版 · 只读实测审计（2026-11-03）

- 审计基版：`lib/index.js` 1,946,567 B / sha256[0:16]=`f5999ea06ccbb53d` / 27,085 行 / 纯 CRLF（工作树，HEAD=`b989a5f9`，`git diff --stat HEAD` = 280 insertions / 14 deletions）
- `lib/water-window.js` 33,677 B
- 手段：源码抽取 + 真执行（`new Function` 载入**生产原文切片**，非重写）。档位块、消费块、幂等闸、决策段均按锚串从 `lib/index.js` 切出原样执行。
- 纪律：未写 lib/ tests/ docs/，未跑回归，未动 git。本文件是唯一落盘产物。

> ⚠️ 行号口径：任务书给的行号（21894-21902 / 22667-22678 / 22700 / 22644）属**更早基线**。本文件全部行号以 sha16 `f5999ea0` 版为准，附原文以便对位。

---

## 一、逐条回答

### Q1 `_compactSeqSeenPre` 基线建立时机 —— 结论：**设计如此，重启前后跨界的压缩永远检不到**

原文（`:21930-21938`）：

```js
if (_stTier._compactSeqSeenPre === undefined) {
  _stTier._compactSeqSeenPre = _cseqNow   // 只建基线
} else if (_cseqNow > Number(_stTier._compactSeqSeenPre)) {
  _stTier._compactSeqSeenPre = _cseqNow
  if (_tierGuess !== INJECT_TIERS.HANDOFF_CARRY) { _tierGuess = INJECT_TIERS.POST_COMPACT; _stTier._postCompactPending = true }
}
```

- 字段挂在 `engine.stateFor(agent)` = `runtimeFor(agent).state`（`:3252-3254` → `SessionRuntimeStore.get` `:2922`）。runtime 按 `identityOfAgent`（`:2903-2911`，优先 `session:<id>`）在 `_byIdentity` 里复用，**进程内跨 text() 帧、跨 turn 一直存在**；dsh web 重启后 `SessionRuntimeStore` 重建（`:3148 this.runtimes = new SessionRuntimeStore()`）⇒ 字段回到 undefined。
- **实测**（生产原文切片 + 真执行）：
  - 同一 runtime 内：帧A 基线 `seen=0` → 插入 `compaction/start(seq=20)` → 帧B `tier=post_compact, pending=false(已消费), seen=20` ⇒ 命中。
  - 重启（state 空、历史里已有 `compaction/start(seq=20)`）：首帧 `tier=run_full`，`_compactSeqSeenPre` 被写成 20，`_postCompactPending` 保持 undefined ⇒ **不误判**。
- **结论**：这是刻意设计（`:21923-21929` 注释记录了 2026-09-10 重启误判事故），代价是**跨重启边界的压缩永远检不到**——重启后首帧只建基线，而压缩若发生在重启之前，之后 `_cseqNow` 不再增长，条件永不成立。语义上可接受（刚重启的会话本来就该由首帧给予完整上下文），但用户若在"压缩完 → 重启 → 继续"这条路径上期待 post_compact，会永远等不到。

### Q2 `scanPressureSignalsPre().compactionSeq` 的真实语义 —— **事件 seq，不是计数**

原文（`lib/water-window.js:178-193`）：

```js
export function scanPressureSignalsPre(events) {
  const out = { reservedTokens: 0, overflow: null, compactionSeq: 0 }
  if (!Array.isArray(events) || !events.length) return out
  for (let i = events.length - 1; i >= 0; i--) {
    ...
    if (!out.compactionSeq && (t === 'compaction/start' || t === 'compaction/summary')) out.compactionSeq = seq
```

- **语义**：会话事件流里**最近一条** `compaction/start` 或 `compaction/summary` 事件的 `ev.seq`（事件序号）。无压缩历史 / 空数组 / 非数组 ⇒ 返回 `0`（实测：`scanPressureSignalsPre([])` = `{reservedTokens:0,overflow:null,compactionSeq:0}`；无压缩事件的历史同样为 `0`）。
- 反向扫描（`i--`）取到即停 ⇒ 取**最新**那条。因为 seq 单调递增，"最新 compaction 的 seq"也可当水位用。
- ⚠️ **一个前提被推翻**：真宿主一次压缩会 append **两条**候选事件 —— `compaction/start`（`dsh-compaction-basic/lib/index.js:469`）与 `compaction/summary`（同文件 `:634`），两者 seq 不同。而本扫描器**不区分**，任一条都算"新压缩" ⇒ **同一次压缩会推两次** `compactionSeq`（见 Q3-补）。

### Q3 同一请求内多帧（①帧被丢弃 / ②帧进模型）—— 结论：**②帧仍拿完整版，两条独立路径都成立**

(a) **幂等闸**（`:22186-22190`）：

```js
if (_rqK && !(_isHumanReq && !_humanDone)
    && stTop._reqTextKeyPre === _rqK && _hasDraft) {
  diag('tiered inject: → 原样复读（本请求已定稿·逐字节幂等）')
  return stTop._reqTextPre
}
```

`finalizePre`（`:21983`）对**任何**档位的输出都写 `_reqTextKeyPre/_reqTextPre`（`:21988-21995`）。①帧消费 pending 后走完整版出口 → `finalizePre(snap + …)` → ②帧同请求键命中闸 → **原样复读那份完整版**。实测：帧①=`完整`，帧②(sameReq)=`完整`，diag=`原样复读`。快照变化（日志追加一行）也照样复读正确答案，因为闸只比请求键不比内容。

(b) **保真分支**（`:22672`，绕过幂等闸时的第二道保险）：

```js
if (stG2 && stG2._stepGrantedFp && (_scopeSame || _seqSame)) {
```

四象限实测（人为清空 `_reqTextKeyPre` 绕过闸）：

| `_stepGrantedScope` 相同 | `_stepGrantedSeq` 已写 | 帧②结果 |
|---|---|---|
| 是 | 否 | **精简**（保真失效） |
| 是 | 是 | 完整（`保真优先〔seq=40〕`） |
| 否 | 否 | **精简** |
| 否 | 是 | 完整 |

- 但 `_stepGrantedSeq` 全仓**只有 1 个写入点** `:22609`（真人/水位/挂机授予分支），**post_compact 的两个授予出口都不写**：
  - `:22725-22732`（`_snapFp === undefined` 首次注入）：只写 `_stepGrantedFp/_stepGrantedScope/_lastFullStepSeq`
  - `:22795-22804`（间距已满足）：`:22802` 只写 `_stepGrantedFp/_stepGrantedScope`；`_lastFullStepSeq` 在 `:22804` 才写（同样**不写** `_stepGrantedSeq`）
- ⇒ 生产中 post_compact 帧②的保真**只靠 `_stepGrantedScope` 字符串**；一旦宿主在两帧间 append `step/start`（`:22656-22661` 注释已实证会发生），scope 变 ⇒ `_seqSame` 也因未武装而为 false ⇒ 保真失效 ⇒ 帧②落精简。实测该场景：`帧②=精简  diag=精简版被节流(距上次投递 < 8 个模型请求)`。
- **但这仍然不构成漏投**：幂等闸 (a) 在更前面且判据只看请求键，②帧只要 `_rqK` 未变就必命中。只有当 `_rqK` 在两帧之间漂移时才会掉到 (b)。`requestIdPre` 取"最近一个 `step/end` 的 seq"（`:10156-10176`），而 `step/end` 在本 step 跑完才 append ⇒ 两帧同键（`:10145-10152` 已论证），故 (a) 稳定命中。
- **H4 结论：不漏投**。残余风险是"保真兜底半失效（`_stepGrantedSeq` 未在 post_compact 出口武装）+ 同一次压缩推两次 seq"两者叠加时的**多投/节奏错乱**，不是压缩后拿不到完整版。

### Q3-补（推翻前提）**同一次压缩会触发两次 post_compact**

`dsh-compaction-basic/lib/index.js:469` `session.append("compaction/start", ...)` → `:634` `session.append("compaction/summary", ...)`，两条 seq 不同；`water-window.js:192` 两条都认。实测：基线 seen=101（start 后）→ 生产 `summary` 落地后 `seen=102`、`tier=post_compact`、pending 再置 true ⇒ **第二次强制重建**。功能上是"多给一次全貌"（不违背"压缩后要给完整版"），但会白烧一份 24k 级完整注入，且与本插件"节奏可控"的既定口径冲突。

### Q4 构造"刚压缩完"的最小可执行方案

只需伪造 **1 个 state 字段 + 1 条事件**（不需要造 runtime，也不需要 pending——它在档位块里自动置位）：

```js
// 已实测通过（生产原文切片 + 真执行，输出 tier=post_compact / pending=true / 完整版）
const st = {
  _compactSeqSeenPre: 100,          // ① 基线：必须显式给，否则首帧只建基线（Q1）
  _stepSeq: 40, _lastFullStepSeq: 25,
  _snapFp: "<此前那份快照>", _snapLogFp: "x", _snapRound: 5, _snapLastRound: 5,
}
const events = [
  { seq: 10,  type: "turn/start",       data: { turn: 1 } },
  { seq: 101, type: "compaction/start", data: { compactionId: "c-forged" } },  // ② seq 必须 > 基线
]
// engine 需提供：stateFor / runtimeFor / config / turnBoundaryKeyPre / humanTurnObservedPre /
//               humanTurnSeqPre / requestIdPre / renderReflectionRequest
// 执行顺序：先跑档位块(:21920-21939) → 再跑决策段(:21971-22849)
// 断言：tier === "post_compact" && st._postCompactPending === true
//       决策段返回以 "<memory_system>" 开头且含 "[白板 PLAN.md]"（=完整版），diag 含 "★压缩后强制重建"
```

要点：
1. `_compactSeqSeenPre` **必须显式设**成小于待插入 compaction seq 的值；留 undefined 会被当"首次观测"只建基线。
2. 只需 `compaction/start` 一条；`compaction/summary` 可选（加了会再触发一次，见 Q3-补）。
3. `_postCompactPending` **不要手工设**——档位块自己置位；手工设会掩盖"置位链路是否通"这条验收。
4. 若要复现"②帧复读"，还需 `requestIdPre` 在两帧返回同一个值（生产靠最近 `step/end` seq）。

---

## 二、H4 判定

**部分通（卡在 K1 与 K2）**

- **已通**：置位链路 `:21930-21938`（真执行命中 `post_compact`）、消费链路 `:22703-22713`、短路 `:22736` 使节流分支对压缩帧不可达、兜底出口 `:22846-22847` 给完整版。压缩帧**必得完整版**，②帧经幂等闸也**必得完整版**。用户裁定"压缩之后的首轮是要给完整版的"**在代码层已满足**。
- **卡点 K1（跨重启，设计取舍而非缺陷）**：压缩若发生在 dsh web 重启之前，重启后永不再检（Q1）。当前代码另有 `_snapFp === undefined` 首次注入给完整版（`:22725`）可作为事实兜底，故对用户可见性影响有限——但这个兜底只在**该 runtime 从未投递过快照**时成立；重启后已投递过一次的会话再压缩，就真无感。
- **卡点 K2（真缺陷 · 低危）**：`_stepGrantedSeq` 在 post_compact 的两个授予出口（`:22732`、`:22802`）均未写入，全仓仅 `:22609` 写。⇒ 保真分支 (:22672) 的 `_seqSame` 对压缩帧恒假，只能靠 `_scopeSame`。叠加"同一次压缩推两次 seq"（Q3-补），会出现**多投一次完整版**。这是"多投"不是"漏投"，与记忆条目 `mem_c74e89f5`（"剩余风险是多投，不是漏投"）一致。

## 三、推翻/补充的前提

| # | 任务书前提 | 实测结论 |
|---|---|---|
| 1 | 行号 21894-21902 / 22667-22678 / 22700 / 22644 | **漂移**：现版为 `:21930-21938` / `:22703-22714` / `:22736` / `:22351` 与 `:22680`（两个平级 `if (gap > 0 && snap)`） |
| 2 | "`compactionSeq` 是压缩信号" | 补充：它是**事件 seq 水位**，且 `compaction/start` 与 `compaction/summary` **都算** ⇒ 同一次压缩推两次 |
| 3 | "压缩后必然走完整版 ⇒ P0-B 修复有效可证" | 成立，但**证明力来自幂等闸 (:22186)，不是保真分支 (:22672)**；后者对压缩帧因 `_stepGrantedSeq` 未武装而恒假 |
| 4 | "②帧还能拿到完整版吗（H4 核心风险）" | **能**，两条路径：(a) 幂等闸（主，稳定）(b) 保真分支（辅，压缩帧失效） |
| 5 | "gap>0 使节流不可达" | 成立（`:22736` 的 `!_postCompactForceFull` 短路），但注意 `:22351` 与 `:22680` 是**平级**语句，消费点在 `:22680` 块内 |
| 6 | 未提及 | 新增：`_postCompactPending` 唯一置位 `:21936`、唯一消费 `:22703-22704`（消费即 false、**无重试**）；消费点位于 `:22680` 块内，若 `gap` 显式设 0 则该块整体跳过 ⇒ pending **残留到下一帧**（此时 `gap>0` 不成立也无害，但状态会悬空） |

## 四、附：本次未验证项

- 未在真宿主跑（无法安全触发真实压缩）；全部结论来自源码切片 + 真执行，属"生产代码真执行"，非"端到端实机"。
- 未跑回归（任务纪律要求）。
