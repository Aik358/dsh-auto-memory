# 记忆系统大修 · 批次 1（止血）· 施工细则

> **日期**：2026-11-08（Asia/Hong_Kong）
> **上游文档**：[CONSTRUCTION-PLAN-20261108.md](file:///D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md) 第 148-174 行（批次 1 全节）+ 第 344-349 行（与审计的对应关系）
> **审计依据**：[MEMORY-LOGIC-GAPS-20261108.md](file:///D:/dsh-auto-memory/docs/internal/MEMORY-LOGIC-GAPS-20261108.md) D-2 / P0-1 · [EVENT-FRAGMENTATION-20261108.md](file:///D:/dsh-auto-memory/docs/internal/EVENT-FRAGMENTATION-20261108.md) A-1 / A-5 · [PROMPT-AND-CONSOLIDATE-20261108.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-AND-CONSOLIDATE-20261108.md) B-1
> **本文件状态**：**细则待用户确认，未开工**。本文件不含任何已落地的代码改动，只给施工流程与程序设计。
> **落点边界**：本批只允许改 `lib/fact-store.js`、`lib/index.js`、`lib/event-write.js`、`lib/event-render.js`、`lib/memory-hub.js`（1.2 若走方案 B/D 才涉及）、`lib/client.js`（仅 1.2 面板方案）、`tests/smoke/` 新增套件。越界项已单列在「建议扩范围」一节。

---

## 0. 实测基线（2026-11-08 09:50-10:27 实测，非估计）

### 0.1 代码三元组（行数口径：LF 计行，与 [BATCH0-BASELINE-20261108.md](file:///D:/dsh-auto-memory/docs/internal/BATCH0-BASELINE-20261108.md) 的 PowerShell `Measure-Object -Line` 口径**不同**，见 0.3 订正）

| 文件 | 字节数 | LF 行数 | 非空行 | `export` 行数 | sha256 前 16 位 |
|---|---|---|---|---|---|
| `lib/fact-store.js` | 59,547 | 1,038 | 970 | 23 | `0F33753FE2E8CCE5` |
| `lib/event-write.js` | 42,659 | 749 | 721 | 20 | `D93369FBD2169DE9` |
| `lib/event-render.js` | 29,034 | 502 | 480 | 16 | `4FDD23BBC7D15DF9` |
| `lib/index.js` | 2,082,057 | 28,809 | 28,252 | 26 | `36BE3335AED3128E` |
| `lib/event-store.js` | 70,215 | 1,081 | 1,036 | 27 | `A1534113FA15747F` |
| `lib/memory-hub.js` | 31,440 | 500 | 479 | 6 | `2876226632E49A82` |

> 收工对照：**行数/字节数增量必须落在各项「工时与依赖」给出的区间内；`export` 行数除 1.6 外必须逐字等于上表**（1.6 若新增 `renderT0Pre` 的 id 开关常量导出，须在回执单列）。

### 0.2 数据面（本批唯一碰真实用户数据的两项是 1.1 / 1.3 的回归验证，均在**临时库**上做，见各项第 6 块）

| 对象 | 实测值 | 时点 |
|---|---|---|
| `C:/Users/JH Z/.dsh/memory/hub/facts.json` | **89,929,359 B** | 10:26:38 |
| 其中 `conflicts` 段 | **89,183,490 B**（占 99.36%） | 10:17 |
| `conflicts` 条数 | **65,918** | 10:17 |
| `resolved:true` / `resolved:false` | **0 / 65,918** | 10:17 |
| 单条冲突平均字节 | **1,352.9 B** | 10:17 |
| `facts` 条数 / 段字节 | **1,000 / 476,193 B** | 10:17 |
| `conflicts` 按 (scope,subject,predicate,left.object,right.object) 去重后 | **354 个键 / 473,924 B**（重复倍数 **186.21×**） | 10:17 |
| `event-store.json` | 3,026,981 B / 50 事件（active 46 / closed 4）/ 708 检查点 | 10:15 |

> 总表原写「约 70.89 MB / 64,531 条 / 84.8 MB」，实测已漂移为 **89.18 MB 冲突段 / 65,918 条 / 89.93 MB 全文件**（本文件写作期间仍在增长：09:50 的 89,357,510 B → 10:26 的 89,929,359 B，**36 分钟 +571,849 B**）。本文件一律用实测值。

### 0.3 一处必须订正的基线口径（否则本批收工会误判）

`BATCH0-BASELINE-20261108.md:31` 记 `lib/index.js` 行数 **28,254**。实测同一文件三种口径：

| 口径 | 值 |
|---|---|
| `split("\n").length - 1`（LF 计数） | **28,809** |
| 有字符的行（去掉 557 行纯空白行） | **28,252** |
| 非空行（`trim() !== ""`） | **28,252** |
| 纯空行（`""`） | 1（文件末尾） |

⇒ 28,254 与任何一种口径都差 2 行，属于 PowerShell `Measure-Object -Line` 对空白行的计数细节差异，**不是漂移**。本批收工一律用 **`split("\n").length - 1` = 28,809** 作基线，并在回执写明口径。

### 0.4 本批要动的既有事实（已逐个核过调用点）

| 事实 | 证据 |
|---|---|
| `conflicts` 无任何上限 | `lib/fact-store.js:478` 的 `conflicts.push({...})` 后**没有任何 prune 调用**；`pruneIfNeeded`（`:726`）只操作 `facts` 数组 |
| 处置原语零调用方 | `conflictsList` / `pendingConflicts` / `resolveConflict`（`:640-665`）在 `lib/` 内只有 `memory-hub.js:297` 一处读 `pendingConflicts()`；`resolveConflict` **全仓零调用方**（grep `resolveConflict` 仅命中定义与导出） |
| 面板只读 `.length` | `lib/client.js:12979-12981`、`:18962-18964`、`:22596-22598` 三处同源，只取 `facts.pendingConflicts.length` 渲染一行数字，**不消费任何具体条目** |
| 面板载荷随冲突数线性膨胀 | `memory-hub.js:297` 直接把 `pendingConflicts()` 全量塞进 `overview()`；模拟 `JSON.stringify({facts:{pendingConflicts:全部}})` = **88,995,846 B**，`JSON.stringify` 本身 **197 ms** |
| 冲突去重键天然存在 | 65,918 条按 5 元组去重后只剩 **354 条**，重复倍数 186.21× |
---

### 0.5 测试夹具说明（本细则所有用例共用的两个 helper）

本细则的用例全部遵守两条硬纪律：**① 真 import 真调用；② 绝不碰 `~/.dsh/memory/**`**。两个 helper：

```js
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** 临时 event-store 路径（每个用例一个，用完删）。★命名必须落在 tests/ 的临时区或 os.tmpdir()，
 *  不得落在 ~/.dsh/memory/** —— 那是真实用户数据。 */
const mkTempStore = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "batch1-"));
  return path.join(dir, "event-store.json");
};

/** 断言器（与既有套件同形：pass/fail 计数 + 失败即 process.exitCode = 1） */
let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log("  ✓ " + m + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + m + (extra ? "  [" + extra + "]" : "")); }
};
process.on("exit", () => { if (fail > 0) process.exitCode = 1; });
```

> **为什么 `ok()` 要带 `extra`**：本仓纪律要求「可复算物理量」，每条断言必须把**实测值**打出来，不能只打绿/红。上面这个 helper 强制每条断言带读数。

> **为什么 `process.on("exit")` 里兜底置 exitCode**：拦截「尾部抛异常但套件已跑到末尾 `process.exit(0)`」的假绿（本仓既有纪律）。


---
## 1A · facts.json 冲突库

### 1.1 给 conflicts 加容量上限

#### ① 现状实测

**落点漂移核对**：总表写 lib/fact-store.js:726 附近（pruneIfNeeded），**实测 pruneIfNeeded 仍从 :726 起**，未漂移。

现有的淘汰函数只覆盖 facts，且**完全不知道 conflicts 的存在**（lib/fact-store.js:726-762，节选逐字）：

```js
726|   function pruneIfNeeded() {
727|     const maxFacts = retentionLimit()
728|     if (!(maxFacts > 0) || facts.length <= maxFacts) return { pruned: 0 }
729|     const over = facts.length - maxFacts
730|     const rank = (f) => (isImportantFact(f) ? 2 : 0) + (f.revoked === true ? 0 : 1) // 0 先删 → 3 最后删
731|     const at = (f, k) => Number(f && f[k]) || 0
732|     // ★关键：同一毫秒写入的多条事实 confirmedAt **会完全相等**（实测：一个 tick 内 upsert 的
733|     //   三条 confirmedAt 全是同一个值）⇒ 只靠时间戳无法区分新旧，必须再用**数组下标**兜底。
734|     //   facts 数组本身就是按写入顺序追加的（最旧在前），因此下标升序 = 由旧到新。
748|     const doomed = new Set(ordered.slice(0, over).map((f) => f.factId))
754|     facts = facts.filter((f) => !doomed.has(f.factId))
```

而**每次落盘都会把全量 conflicts 重新序列化一遍** —— 这就是「每天 +55 MB」的机制（:764-771 + :790-795，逐字）：

```js
764|   function persist() {
765|     try {
766|       pruneIfNeeded() // ★#110：落盘前先按上限有序淘汰（只在超限时动手）
770|       if (deferredPersistDepth) { batchDirty = true; return { ok: true, deferred: true } }
771|       io.save(snapshot({ includeRevoked: true }))
779|   }
780|   function snapshot(opts = {}) {
790|       conflicts: conflicts.map((c) => ({
791|         ...c,
792|         left: c.left ? cloneFact(c.left) : c.left,
793|         right: c.right ? cloneFact(c.right) : c.right,
794|       })),
```

冲突对象本身很大（实测**单条平均 1,352.9 B**：left 平均 636.4 B + right 平均 483.3 B + conflictId 68.6 B + 其余字段），因为 left/right 各是一个**完整的 fact 快照**（:481-482 的 { ...existing, provenance: [...] } 展开）。

#### ② 改法（函数级 diff）

**新增模块级常量 + 上限读取器**（放在 retentionLimit 之后、isImportantFact 之前；签名不变，纯新增）：

```js
/**
 * conflicts 保留上限（★1A-1.1）。
 *
 * ★为什么是**模块常量**而不是新配置键：配置键总数有 179 的连环锁
 *   （tools/verify-docs.mjs 逐个比对 4 份文档 + 2 份 README 的设置键数，实测 21 工具 / 85 路由 / 179 键），
 *   加一个键要同批改 6 处文档；而这是**内部保留策略**、不是用户可调策略。
 *   与 event-render.js:53-54 的 T2_BUDGET「不做配置键」是同一条判据。
 * ★为什么是 500：实测本机 65,918 条冲突按
 *   (scope,subject,predicate,left.object,right.object) 去重后只有 **354 个键**，
 *   ⇒ 500 足以容纳真实数据里的全部「不同矛盾」，超出的都是重复检测产物。
 */
export const CONFLICT_RETENTION_DEFAULT_PRE_V1 = 500

const conflictLimit = () => {
  const raw = Number(opts.config && opts.config.maxConflicts)
  return (Number.isFinite(raw) && raw >= 1) ? Math.floor(raw) : CONFLICT_RETENTION_DEFAULT_PRE_V1
}
```

**新增淘汰函数**（放在 pruneIfNeeded 之后、persist 之前；只操作 conflicts，不碰 facts）：

```js
let lastConflictPrune = null

/**
 * conflicts 有序淘汰（★1A-1.1）。只在**超出上限**时动手，且只删到刚好回到上限。
 *
 * 淘汰顺序（与 #110 的 facts 口径同构，但语义不同）：
 *   ① 已解决（resolved:true）优先清掉 —— 与用户 #110 裁定的「撤销的优先清掉」同一条理由
 *   ② 未解决的按 detectedAt 最旧优先
 *   ③ detectedAt 打平时按**数组下标**（写入顺序）兜底 ——
 *      理由同 facts 侧 :732-736：同一 tick 内 push 的多条 detectedAt 会完全相等
 *      （conflictId 里拼的 now 也是同一个值，本机实测同毫秒成组存在）
 */
function pruneConflictsIfNeeded() {
  const max = conflictLimit()
  if (!(max > 0) || conflicts.length <= max) return { pruned: 0 }
  const over = conflicts.length - max
  const seq = new Map()
  for (let i = 0; i < conflicts.length; i++) seq.set(String(conflicts[i] && conflicts[i].conflictId), i)
  const ordered = conflicts.slice().sort((a, b) => {
    const dr = (a.resolved === true ? 0 : 1) - (b.resolved === true ? 0 : 1) // 已解决先进淘汰队列
    if (dr !== 0) return dr
    const ta = Number(a.detectedAt) || 0
    const tb = Number(b.detectedAt) || 0
    if (ta !== tb) return ta - tb
    return (seq.get(String(a.conflictId)) || 0) - (seq.get(String(b.conflictId)) || 0)
  })
  const doomed = new Set(ordered.slice(0, over).map((c) => String(c.conflictId)))
  const oldest = ordered.slice(0, over).reduce((m, c) => {
    const t = Number(c.detectedAt) || 0
    return (m === 0 || (t > 0 && t < m)) ? t : m
  }, 0)
  const resolvedDropped = ordered.slice(0, over).filter((c) => c.resolved === true).length
  conflicts = conflicts.filter((c) => !doomed.has(String(c.conflictId)))
  stats.conflictPruned = (stats.conflictPruned || 0) + doomed.size
  lastConflictPrune = {
    pruned: doomed.size, resolvedDropped, limit: max, over,
    oldestAt: oldest || null, at: nowFn(),
  }
  return { pruned: doomed.size }
}
```

**接线（唯一一处改动，persist 内）**：

```diff
   function persist() {
     try {
       pruneIfNeeded()             // ★#110：落盘前先按上限有序淘汰（只在超限时动手）
+      pruneConflictsIfNeeded()    // ★1A-1.1：conflicts 独立淘汰，与 facts 互不干扰
       // ★#274：批内只记「脏」，真正的落盘由 batch() 在**同一把锁内**提交一次。
       if (deferredPersistDepth) { batchDirty = true; return { ok: true, deferred: true } }
       io.save(snapshot({ includeRevoked: true }))
```

**暴露诊断面**（加进 :955-984 的返回对象，与 getLastPrune / retentionLimit 并列）：

```js
    /** ★1A-1.1：最近一次 conflicts 淘汰详情，或 null。{pruned,resolvedDropped,limit,over,oldestAt,at}。 */
    getLastConflictPrune: () => (lastConflictPrune ? { ...lastConflictPrune } : null),
    /** 当前生效的 conflicts 保留上限（<=0 表示不限）。 */
    conflictRetentionLimit: conflictLimit,
```

**签名变化**：无。pruneIfNeeded / persist / snapshot 的签名一字不动，只在 persist 体内加一行调用；createFactStorePre(opts) 的 opts.config 新增**可选**读键 maxConflicts（旧调用点不传即回落 500，行为等价于「上限存在且默认 500」）。

**预期物理量**（按实测真实数据复算，不是估计）：把现有 65,918 条按上述规则淘汰到 500 条后，JSON.stringify 结果 **682,873 B**，即 conflicts 段从 **89,183,490 B → 682,873 B**（**−88,500,617 B，−99.23%**）；facts.json 全文件同步从 89.9 MB 级降到约 **1.16 MB** 级（476,193 B facts + 682,873 B conflicts + 其余）。

#### ③ 与既有机制的关系

| 受影响的既有机制 | 影响 | 证据 / 处置 |
|---|---|---|
| pruneIfNeeded（facts 侧） | **不动**。两个函数并列调用，各自只操作自己的数组 | pruneConflictsIfNeeded 内无任何 facts 引用 |
| persist() 整体重写 | 仍然整体重写，但**重写的字节数降到 1/75 量级**（89.9 MB → 1.16 MB）。本批**不**改增量写（那是 P0-1③，不在本批落点内） | 实测 1,352.9 B/条 × 500 上限 |
| snapshot() | 不改。淘汰发生在 snapshot() **之前**（persist 内、io.save 前） | 顺序即正确性，见失败模式 F2 |
| batch() / deferredPersistDepth | 无影响：批内 persist 提前 return，淘汰被推迟到批末那一次 persist，正好只跑一次 | :770 |
| mutation() 事务包装 | 无影响：io.transaction 门内会 restore(fresh) → 重放 → batch() → persist()，淘汰在批末生效 | :882-931 |
| restore() | 无影响：restore 只**读**盘上数据、不做淘汰（:831 直接 map）⇒ 首次 load 后内存里仍是 65,918 条，直到下一次 persist 才收敛 | 见失败模式 F4 |
| memory-hub.js:296-297 面板 overview | 随上限一起变好：conflictCount 从 65,918 → ≤500，pendingConflicts 载荷从 **88,995,846 B** 降到 ≤ 682,873 B（面板只读 .length，语义不变） | client.js:12979 三处 |
| 注入面 28 个 pushPart | **零影响**：冲突从不进注入面（实测零读者） | 审计 P0-1 已确认 |
| 检索面 5 个 scope | **零影响**：同上 | — |
| 既有 smoke 套件 | 需改 0 个、需新增 1 个。逐条核过：smoke-test-followup-110-102.mjs:79 断言 s.size === 3 只针对 facts；smoke-test-issue110-hub-batch-entry.mjs:108 只测批；smoke-test-a2-hub-transactions.mjs 只测事务；**无任何套件断言 conflicts.length 的绝对值** | 在 tests/ 内 grep conflictCount / conflicts.length = 0 命中 |

#### ④ 失败模式（每条都在测试里有对应断言）

| # | 怎么错 | 测试里怎么被发现 |
|---|---|---|
| **F1** | 排序只用 detectedAt，同毫秒成组时「留谁不留谁」由数组顺序决定，而数组顺序受 restore 去重后的重排影响 ⇒ 可能删掉刚产生的冲突、留下 46 天前的 | 用例 A1-b：构造 3 条 detectedAt **完全相同**的冲突 + 上限 2 ⇒ 断言保留的是后写入的两条（conflictId 序号大），且 getLastConflictPrune().oldestAt 有意义 |
| **F2** | 把 pruneConflictsIfNeeded() 放在 snapshot() **之后**（或塞进 io.save 的参数表达式）⇒ 淘汰对本次落盘无效，字节数一点不降，而内存条数却降了 ⇒ 内存与磁盘分叉 | 用例 A1-c：io stub 记录最后一次 save 的入参，断言 saved.conflicts.length ≤ 上限 **且** store.conflictCount ≤ 上限，两者必须同时成立 |
| **F3** | 淘汰函数抛错（例如 conflictId 缺失导致 seq.get 全 undefined）⇒ persist 的 try/catch 把它吞成 {ok:false,error}，**连带 facts 也写不进去**（同一个 try 块） | 用例 A1-d：喂一个 conflictId 为 undefined 的脏冲突，断言 persist() 返回 ok:true（不因冲突脏数据阻断 facts 落盘），且 getLastPersistError() 为 null |
| **F4** | 首次 load 后不做淘汰 ⇒ 进程刚起来那一刻内存里仍是 65,918 条，面板第一次 GET 就吐 89 MB | 用例 A1-e：restore 一个 600 条的 baseline 后**立即**断言 conflictCount === 600（如实反映 restore 不淘汰），再调一次 persist() 后断言 conflictCount ≤ 500（证明收敛点是落盘前） |
| **F5** | 上限设为 ≤0 时被当成「默认 500」而不是「不限」⇒ 用户想关掉上限却关不掉 | 用例 A1-f：maxConflicts: 0 ⇒ conflictRetentionLimit() === 0，且写入 10 条后 conflictCount === 10（不限）；maxConflicts 为字符串 oops ⇒ 回落 500 |

> **F3 说明**：这条是本改法**唯一改变既有失败语义**的地方。现状 persist() 的 try 覆盖整个函数体，新增的淘汰如果抛错会让 facts 也写不进去 —— 这正是要测的。若改成 try { pruneConflictsIfNeeded() } catch (_) {} 就违反本仓「门控类判定分支禁止空 catch」纪律；推荐做法是让 pruneConflictsIfNeeded 自身对脏数据免疫（用 String(c.conflictId) 取键、seq 缺失时回落到 0），即 F3 的修法。

#### ⑤ 验收用例设计

**新增套件**：tests/smoke/smoke-test-batch1-conflict-cap.mjs（smoke-test-* 前缀；_ 开头才算脚手架）。

*真执行层*（真 import → 真构造 → 真调用 → 断言返回值/副作用）：

```js
import { createFactStorePre, CONFLICT_RETENTION_DEFAULT_PRE_V1 } from "../../lib/fact-store.js";

const memIo = () => { const box = { last: null }; return { box, save(s) { box.last = s }, load() { return null }, clear() {} } };
/** 造一条真冲突：同 scope+subject+predicate、不同 object ⇒ isFactConflict 为真 */
const mkConflict = (store, i, obj) => store.upsert({
  scope: "User", subject: "项目构建工具", predicate: "是", object: obj,
  sourceKind: "explicit", sourceClass: "user-memory", confidence: 0.9, provenance: ["src-" + i],
});

// A1-a 超上限收敛 + 两个上限互不干扰（核心判据）
{
  const io = memIo();
  const s = createFactStorePre({ config: { get maxFacts() { return 3 }, maxConflicts: 5 }, io });
  mkConflict(s, 0, "esbuild");                                  // 第 1 条 fact（左）
  for (let i = 1; i <= 10; i++) mkConflict(s, i, "vite-" + i);   // 每次都撞左 ⇒ 10 条冲突
  ok(s.conflictCount <= 5, "A1-a1 conflicts 收敛到上限", s.conflictCount + "/5");
  ok(s.size <= 3, "A1-a2 facts 自己的上限仍生效（互不干扰）", s.size + "/3");
  ok(io.box.last.conflicts.length <= 5, "A1-a3 ★落盘快照里的 conflicts 也 ≤ 上限（淘汰发生在 snapshot 之前）", io.box.last.conflicts.length);
  ok(io.box.last.conflicts.length === s.conflictCount, "A1-a4 内存与磁盘条数一致（不分叉）");
}
```

*负路径层*（「旧实现通过、新实现必须拒绝」的输入）：

```js
// A1-g 负路径：把上限关掉后**必须能涨到超过 500** —— 若实现把上限写死成常量，这条会红
{
  const s = createFactStorePre({ config: { maxConflicts: 0 }, io: memIo() });
  mkConflict(s, 0, "左");
  for (let i = 1; i <= 520; i++) mkConflict(s, i, "右" + i);
  ok(s.conflictCount === 520, "A1-g ★maxConflicts=0 ⇒ 不限，520 条全部保留（证明上限真读配置、不是硬编码）", s.conflictCount);
}
// A1-h 负路径：上限 = 1 时，**未解决**的必须留下、**已解决**的必须先走
{
  const s = createFactStorePre({ config: { maxConflicts: 1 }, io: memIo() });
  mkConflict(s, 0, "左"); mkConflict(s, 1, "右1");
  const id = s.conflictsList()[0].conflictId;
  s.resolveConflict(id, "left");                    // 先让 oldest 变成 resolved
  mkConflict(s, 2, "右2");                          // 再挤一条
  const rest = s.conflictsList();
  ok(rest.length === 1, "A1-h1 收敛到 1", rest.length);
  ok(rest[0].resolved !== true, "A1-h2 ★淘汰的是已解决那条，未解决的留下（次序判据有区分力）", JSON.stringify(rest[0].resolved));
}
```

*变异必红*（把实现改回旧形态，断言必须变红）：

| 变异 | 改法 | 哪条断言必红 |
|---|---|---|
| **M1** | 删掉 persist() 里新增的那一行 pruneConflictsIfNeeded()（= 回到旧实现） | A1-a1（≤5 变 11）、A1-a3、A1-h1 三条同时红 |
| **M2** | 把 pruneConflictsIfNeeded() 移到 io.save(snapshot(...)) **之后** | A1-a3 红（落盘快照仍是 11 条）而 A1-a1 仍绿 ⇒ 精确指向「顺序错」而非「函数没写」 |
| **M3** | 把排序里的 resolved 判据删掉（只按 detectedAt） | A1-h2 红（淘汰了未解决的那条） |
| **M4** | 把 conflictLimit() 改成直接 return 500（忽略配置） | A1-g 红（520 被砍到 500）、A1-f 红 |
| **M5** | 把 seq 下标兜底删掉（只留 detectedAt） | A1-b 红（同毫秒三条里留下的是任意一条，不是最新的） |

#### ⑥ 风险与回滚（碰真实用户数据）

**会碰 C:/Users/JH Z/.dsh/memory/hub/facts.json**：persist() 的第一次调用就会把盘上 65,918 条冲突永久淘汰到 500 条。这是**不可逆的数据删除**。

前置条件（缺一不可）：
1. **批次 0.1 备份已在位**：C:/Users/JH Z/.dsh/memory/hub/backups/facts.json.bak-20261108-095108（88,972,380 B，sha16 = A07827338BEBC6EC，见 [BATCH0-BASELINE-20261108.md](file:///D:/dsh-auto-memory/docs/internal/BATCH0-BASELINE-20261108.md):15）。
2. 首次真机运行**前**再打一份带当前时间戳的备份（09:51 的备份之后盘上又涨了约 1 MB）：Copy-Item 到 backups/facts.json.bak-<YYYYMMDD-HHMMSS>，并核字节数相等 + sha256 相等。
3. 首次真机运行**只做一次**，运行后立即复算：conflicts 段字节数、条数、resolved:true 计数。

回滚步骤（任一步失败即执行）：

```
1) 停宿主（或至少停掉 hub 的所有写路径），确保没有进程持有 facts.json。
2) Copy-Item "<hub>/backups/facts.json.bak-<最近一份>" "<hub>/facts.json" -Force
3) 复算：按审计 P0-1 ③ 的读数复跑（bytes / conflicts 条数 / unresolved 数），必须与备份时点逐字相等。
4) 回滚代码：git checkout -- lib/fact-store.js（本项只改这一个文件）。
5) 复跑 smoke-test-batch1-conflict-cap.mjs，必须全绿（证明回滚后的树与基线一致）。
```

> **回滚不可逆的部分**：facts.json 恢复后，进程内已淘汰的内存态要用 restore() 重放，**不能热改**；必须先停进程再换文件。

#### ⑦ 工时与依赖

| 项 | 估算 |
|---|---|
| 改动行数 | lib/fact-store.js **+62 / −1**（常量 1 + 注释 8 + conflictLimit 5 + pruneConflictsIfNeeded 30 + persist 内 1 行 + 返回对象 4 + lastConflictPrune 声明 1）；export 数 **23 → 24**（新增 CONFLICT_RETENTION_DEFAULT_PRE_V1） |
| 新增测试 | smoke-test-batch1-conflict-cap.mjs **约 12 条断言**（A1-a1..a4 / a-b / a-c / a-d / a-e / a-f / a-g / a-h1 / a-h2） |
| 既有套件改动 | **0** |
| 前置依赖 | **批次 0.1（备份）必须已完成**；本项不依赖批次 1 的其他任何项，可与 1.3 并行 |
| 收工三元组对照 | lib/fact-store.js 应从 **59,547 B / 1,038 行 / 23 export** 变为约 **62.1 KB / 1,100 行 / 24 export**，增量落在此区间即正常；越界先 diff |


---

### 1.2 给处置原语接一个真实入口（**待用户裁定项**）

#### ① 现状实测

**落点漂移核对**：总表写 lib/fact-store.js:640-648，**实测三个原语在 :640-665**，起点未漂移、终点从 648 延到 665（因为 resolveConflict 有 20 行）。总表原写 640-648，实测 640-665。

```js
640|   function conflictsList() {
641|     return conflicts.map((c) => ({ ...c }))
642|   }
643|   function pendingConflicts() {
644|     return conflicts.filter((c) => !c.resolved).map((c) => ({ ...c }))
645|   }
646|   function resolveConflict(conflictId, choice) {
647|     // choice: 'left' 保留左(已有), 'right' 采用右(新候选)。解析后冲突标记 resolved。
648|     const c = conflicts.find((x) => x.conflictId === conflictId)
649|     if (!c) return { ok: false, reason: 'not-found' }
650|     if (c.resolved) return { ok: false, reason: 'already-resolved' }
651|     if (choice === 'left') {
652|       // 保留现有: 丢弃右候选(不落库)
653|       c.resolved = true; c.resolvedAt = nowFn(); c.choice = 'left'
654|     } else if (choice === 'right') {
655|       // 采用新候选: 旧 revoked, 新落库
656|       const old = findSubjectPredicate(c.scope, c.subject, c.predicate)
657|       if (old) { old.revoked = true; old.revokedAt = nowFn(); stats.revoked++ }
658|       upsert(c.right)
659|       c.resolved = true; c.resolvedAt = nowFn(); c.choice = 'right'
660|     } else {
661|       return { ok: false, reason: 'invalid-choice' }
662|     }
663|     void persist()
664|     return { ok: true, conflict: { ...c } }
665|   }
```

**读者分布（实测，非 grep 推断）**：

| 面 | 有没有读者 | 证据 |
|---|---|---|
| 注入面 28 个 pushPart | **无** | 冲突从不进注入 |
| 检索面 5 个 scope | **无** | — |
| 面板 | **只有 1 个数字** | lib/client.js:12979-12981 / :18962-18964 / :22596-22598 三处同源，只取 facts.pendingConflicts.length |
| resolveConflict | **全仓零调用方** | grep resolveConflict 只命中 lib/fact-store.js 的定义行与 :958 的导出行 |

**面板载荷问题（本项的关键实测）**：memory-hub.js:297 把 pendingConflicts() **全量**塞进 overview：

```js
296|       facts: stores.facts ? {
297|         size: stores.facts.size, conflictCount: stores.facts.conflictCount,
298|         pendingConflicts: stores.facts.pendingConflicts ? stores.facts.pendingConflicts() : [],
299|         recent: stores.facts.query ? stores.facts.query().slice(-5) : [],
```

实测：模拟这一行的序列化产物 = **88,995,846 B**，JSON.stringify 本身耗时 **197 ms**。而客户端只要 .length。⇒ **无论 1.2 选哪个方案，这一行都必须同批修**（见下方「共同前置」）。

#### ② 改法（函数级 diff）· 含三方案成本/收益对比与推荐

**共同前置（三个方案都要做，不计入方案成本）**：把 memory-hub.js:297 从「全量 pendingConflicts」改成「只给计数 + 前 20 条摘要」：

```js
         size: stores.facts.size, conflictCount: stores.facts.conflictCount,
-        pendingConflicts: stores.facts.pendingConflicts ? stores.facts.pendingConflicts() : [],
+        // ★1.2 共同前置：面板只渲染 .length（client.js:12979 三处），
+        //   全量下发 89 MB / 197 ms 的 JSON 是纯浪费。改成「计数 + 前 20 条摘要」。
+        //   摘要只保留面板与待裁定列真正要显示的四项，不带 left/right 全量快照。
+        pendingConflictCount: stores.facts.pendingConflicts ? stores.facts.pendingConflicts().length : 0,
+        pendingConflicts: stores.facts.pendingConflicts
+          ? stores.facts.pendingConflicts().slice(0, 20).map((c) => ({
+              conflictId: c.conflictId, scope: c.scope, subject: c.subject, predicate: c.predicate,
+              leftObject: c.left ? c.left.object : null, rightObject: c.right ? c.right.object : null,
+              detectedAt: c.detectedAt,
+            }))
+          : [],
         recent: stores.facts.query ? stores.facts.query().slice(-5) : [],
```

> **兼容性**：客户端三处只读 .length，改成 20 条后 .length 会从 65,918 变 20 —— **必须同批把三处改读 pendingConflictCount**，否则面板数字从 65,918 掉到 20，用户会以为冲突被清空了。这是本项最容易漏的一处。

| 维度 | **方案 A**：面板「待裁定」列 | **方案 B**：新增 memory_* 工具 | **方案 C**：只写最新（自动 resolve） | **方案 D（细则新增）**：面板列 + 工具**共用同一后端动作** |
|---|---|---|---|---|
| 改动文件 | lib/memory-hub.js（共同前置）+ lib/index.js（memory-hub 路由加 action）+ lib/client.js（面板加一列 + 三处长度改读） | lib/index.js（新增 defineTool）+ lib/memory-hub.js（共同前置） | lib/fact-store.js（检测处直接不 push，改为就地 resolve）+ lib/memory-hub.js | 全部：memory-hub.js + index.js 路由 + index.js 工具 + client.js |
| 新增行数（估） | 路由 ~18 / 面板 ~55 / 前置 ~12 | 工具 ~35 / 前置 ~12 | store ~15 / 前置 ~12 | 路由 ~18 / 工具 ~35 / 面板 ~55 / 前置 ~12 |
| 新增测试断言 | ~10（路由真调 + 面板渲染守卫 + 负路径） | ~9（工具真调 + 参数校验 + 负路径） | ~8（同 object 不新增 + 负路径） | ~14 |
| **谁能触发** | **只有人**（点面板） | 只有模型（模型得先看到冲突才发现要处置） | **无人**（自动） | 人 + 模型 |
| 是否解决「零调用方」 | 是（人有了入口） | 是（模型有了入口） | 是（不需要调用方） | 是 |
| 处置粒度 | 逐条（可 left/right 分别选） | 逐条 | 全自动、无粒度 | 逐条 |
| 与 1.3 的关系 | **正交**（1.3 治增长，本项治存量） | 正交 | **与 1.3 重叠**（都把「同 object 反复出现」压掉），选了 C 就基本不需要 1.3 | 正交 |
| 风险 | 低（只读面板 + 单条写） | **中**：模型误调会把 65,918 条逐条 resolve，且 resolve('right') 会 upsert 并 revoke 旧 fact（:655-658）⇒ **可能批量改写 facts** | **高且静默**：自动丢弃一侧 = 永久丢数据，用户无法复核 | 中（等同 B 的风险，但人能先看到） |
| 面板可见性判据 | 天然满足（总表验收就是这么写的） | 不满足（要另加面板展示） | 不适用 | 满足 |
| 与「模型不需要知道冲突」的关系 | 一致 | **不一致**：模型会开始「处理冲突」，而 65,918 条里只有 354 个真不同的矛盾 | 一致 | 基本一致（工具只给人用时可加权限门） |

**推荐：方案 A（面板「待裁定」列），把工具那半（D）留到批次 3 之后。**

理由（三条，都可判据化）：

1. **总表的验收判据本身就是面板口径**（「面板可见」）。选 B 要额外造一套「面板可见」的证明，等于多一层间接。选 A 时验收判据与实现是同一件事，**不容易假绿**。
2. **B 的失败代价不对称**：resolveConflict('right') 会 revoke 现役 fact 并 upsert 新 fact（:655-658）。模型在 65,918 条待裁定里误调 100 次，就是 100 次 facts 静默改写 —— 而本仓铁律是「误判代价不对称时选不可逆性最低的一侧」。**人逐条点**天然有 throttling（点 100 次的成本远高于模型调 100 次工具）。
3. **C 与 1.3 重叠且不可逆**：1.3 已经把「同 subject+predicate 且 object 相同 ⇒ 不新增」治住了，C 再自动丢弃一侧属于重复治理，且**永久丢数据**。C 唯一的价值（不需要调用方）已被「1.3 把增长压到 0」覆盖。

> ⚠️ 若用户选 B 或 D 的工具那半，**必须先加一道门**：工具只允许一次处理 1 条、且 choice 为 right 时回执里必须回显将被 revoke 的 factId 与旧 object（照抄 :656-658 的实际后果），否则模型无法在回执里自检。

**方案 A 的实现要点（推荐路径）**：

「后端：memory-hub 路由加一个 action」（lib/index.js:27079 之后，与 render / crossfeed 并列）：

```js
             if (action === 'render') return writeJson(res, 200, { checklists: hub.renderChecklists() })
             if (action === 'crossfeed') return writeJson(res, 200, hub.crossFeed(String((body && body.sessionRef) || '')))
+            // ★1.2-A（面板「待裁定」列）：把 resolveConflict 接上真实入口。
+            //   · 只走 store 的既有原语，不新造第二套处置逻辑（本仓「判据只有一份」纪律）；
+            //   · choice 只接受 left / right，其余由 store 自己返回 invalid-choice（不在这里另判）；
+            //   · loopback 门已在上方 :27063，本分支不重复。
+            if (action === 'resolve-conflict') {
+              const fstore = hub.stores && hub.stores.facts
+              if (!fstore || typeof fstore.resolveConflict !== 'function') {
+                return writeJson(res, 200, { ok: false, reason: 'no-fact-store' })
+              }
+              const cid = String((body && body.conflictId) || '')
+              if (!cid) return writeJson(res, 400, { error: 'conflictId required' })
+              const r = fstore.resolveConflict(cid, String((body && body.choice) || ''))
+              try { diag('hub resolve-conflict ' + cid.slice(0, 24) + ' ' + JSON.stringify({ ok: r && r.ok })) } catch (_) {}
+              return writeJson(res, 200, r)
+            }
```

「前端：三处长度改读计数 + 加「待裁定」列」——

```js
// client.js:12979 / :18962 / :22596 三处同源，逐处改：
-      if (facts && facts.pendingConflicts && facts.pendingConflicts.length) {
-        rows.push(h('div', {...}, t('hubConflicts') + ': ' + facts.pendingConflicts.length))
+      // ★1.2 共同前置配套：改读计数（明细只下发 20 条，直接读 .length 会显示成 20）
+      var pendN = Number(facts && facts.pendingConflictCount) || 0
+      if (pendN > 0) {
+        rows.push(h('div', {'data-dam-slot': 'hint', 'data-dam-hint': ''}, t('hubConflicts') + ': ' + pendN))
+        // 「待裁定」列：逐条给两个按钮，走 POST /memory-hub {action:'resolve-conflict'}
+        var pendList = (facts.pendingConflicts || [])
+        rows.push(h(Card, { title: t('hubConflictsPending') + ' (' + pendN + ')' },
+          pendList.length ? pendList.map(function (c) {
+            return h('div', { 'data-dam-content': '', key: c.conflictId, style: { padding: '4px 0', display: 'flex', gap: '8px', alignItems: 'center' } },
+              h('span', { style: { flex: '1', minWidth: '0', overflowWrap: 'anywhere' } },
+                c.subject + ' · ' + c.predicate + ' → ' + String(c.leftObject) + ' ⟷ ' + String(c.rightObject)),
+              h('button', { 'data-dam-btn': 'keep-left', onClick: function () { hubResolveConflictPre(c.conflictId, 'left') } }, t('hubKeepLeft')),
+              h('button', { 'data-dam-btn': 'take-right', onClick: function () { hubResolveConflictPre(c.conflictId, 'right') } }, t('hubTakeRight')))
+          }) : h('div', { 'data-dam-content': '' }, t('hubConflictsEmpty'))))
+      }
```

> **必须同时确认的两件事**：① hubResolveConflictPre 是**新增函数**，要照 client.js 现有的 memory-hub POST 范式写；② i18n 三个新键 hubConflictsPending / hubKeepLeft / hubTakeRight 要进 client.js 手写区的中英两份文案表，**不要**碰 skins/legacy/iter5-325.js.frozen（生成区，改完必须跑 build-iter5-skin）。

#### ③ 与既有机制的关系

| 受影响的既有机制 | 影响 | 处置 |
|---|---|---|
| memory-hub.js:297 overview | **必改**（共同前置）：面板载荷从 89 MB 降到约 27 KB | 见上 |
| client.js:12979 / :18962 / :22596 | **必改三处**（同一段代码在三个渲染路径里复制了三份） | 三处必须同批改，只改一处会出现「一个页签显示 65,918、另一个显示 20」 |
| resolveConflict 本体（:646-665） | **不改**。它已经是对的：not-found / already-resolved / invalid-choice 三态齐备 | 本项只接线，不动判据 |
| resolveConflict 的 mutation 包装（:958） | 无影响：走 io.transaction 时会重放、批末提交 | — |
| ROUTES / API 映射（index.js:527） | **不改**：沿用既有 memory-hub 路由，只加一个 action 分支 | 路由数仍 85 |
| 工具数（verify-docs 锁 21） | **方案 A 不变**；方案 B/D 会变 22 ⇒ 要同批改多份文档 | 选 A 则零成本 |
| 既有 smoke 套件 | 实测 grep pendingConflicts 于 tests/ = **0 命中** ⇒ 无需改任何既有套件 | — |

#### ④ 失败模式

| # | 怎么错 | 测试里怎么被发现 |
|---|---|---|
| **F1** | 后端加了 action 但前端仍读 pendingConflicts.length ⇒ 明细只下发 20 条后，面板数字从 65,918 变 20 | 用例 B1-b：overview 返回 pendingConflictCount=500 / pendingConflicts 长度 20，真跑三处渲染函数，断言显示的是 500 不是 20 |
| **F2** | 只改了 client.js 三处中的一两处 ⇒ 不同页签数字互相矛盾 | 用例 B1-c：对三处渲染入口逐一真调，断言三处输出的计数完全一致 |
| **F3** | resolve-conflict 路由漏掉 loopback 门（复制时漏） ⇒ 任意网页都能触发 facts 改写 | 用例 B1-d：非 loopback 请求 ⇒ 403。既有 :27063 已有门，本条是**回归守卫**（防复制时漏掉） |
| **F4** | choice 传大写 RIGHT ⇒ store 返回 invalid-choice，前端却当成成功、按钮变灰 | 用例 B1-e：POST {choice:'RIGHT'} ⇒ 响应 ok:false + reason invalid-choice，且 pendingConflictCount **不变** |
| **F5** | resolve 成功后没刷新面板 ⇒ 用户点了没反应 | 用例 B1-f：真调 resolve 后重新 GET overview，断言 pendingConflictCount 减 1（与总表验收「-1」对齐） |

#### ⑤ 验收用例设计

*真执行层*（后端，可直接跑，不需要浏览器）：

```js
import { createFactStorePre } from "../../lib/fact-store.js";

// B1-a 真调 resolve() 一条 ⇒ resolved:true +1、pending -1（总表原判据）
{
  const box = { last: null }
  const s = createFactStorePre({ config: { maxConflicts: 100 }, io: { save(x) { box.last = x }, load() { return null }, clear() {} } })
  const cand = (obj, src) => ({ scope: "User", subject: "端口", predicate: "是", object: obj, sourceKind: "explicit", sourceClass: "user-memory", confidence: 0.9, provenance: [src] })
  s.upsert(cand("3080", "a"))
  s.upsert(cand("8080", "b"))
  ok(s.conflictCount === 1 && s.pendingConflicts().length === 1, "B1-a0 前置：1 条待裁定")
  const id = s.pendingConflicts()[0].conflictId
  const r = s.resolveConflict(id, "left")
  ok(r.ok === true && r.conflict.resolved === true, "B1-a1 resolve('left') 真返回 resolved:true", JSON.stringify(r.conflict && r.conflict.choice))
  ok(s.conflictsList().filter((c) => c.resolved === true).length === 1, "B1-a2 ★resolved:true 计数 +1", s.conflictsList().filter((c) => c.resolved === true).length)
  ok(s.pendingConflicts().length === 0, "B1-a3 ★pendingConflicts -1", s.pendingConflicts().length)
  ok(box.last.conflicts.find((c) => c.conflictId === id).resolved === true, "B1-a4 resolved 已落盘（不是只改内存）")
}
```

*负路径层*：

```js
// B1-g 负路径：**已解决**的再 resolve 必须被拒（去掉 already-resolved 判据就会重复 revoke）
{
  const s = createFactStorePre({ io: { save() {}, load() { return null }, clear() {} } })
  const cand = (obj, src) => ({ scope: "User", subject: "k", predicate: "p", object: obj, sourceKind: "explicit", sourceClass: "user-memory", confidence: 0.9, provenance: [src] })
  s.upsert(cand("v1", "a")); s.upsert(cand("v2", "b"))
  const id = s.pendingConflicts()[0].conflictId
  s.resolveConflict(id, "left")
  const r2 = s.resolveConflict(id, "left")
  ok(r2.ok === false && r2.reason === "already-resolved", "B1-g 第二次 resolve ⇒ already-resolved（幂等拒绝，不重复动 facts）", r2.reason)
}
// B1-h 负路径：不存在的 id ⇒ not-found（不静默成功）
{
  const s = createFactStorePre({ io: { save() {}, load() { return null }, clear() {} } })
  const r = s.resolveConflict("evt_does_not_exist", "left")
  ok(r.ok === false && r.reason === "not-found", "B1-h 不存在的 conflictId ⇒ not-found", r.reason)
}
```

*变异必红*：

| 变异 | 改法 | 哪条断言必红 |
|---|---|---|
| **M1** | overview 改回全量 pendingConflicts（删掉共同前置） | B1-b 红（面板渲染出 65,918 条明细，序列化字节回到 89 MB 量级） |
| **M2** | 三处 client.js 只改一处 | B1-c 红（三处计数不一致） |
| **M3** | 非法 choice 也置 resolved | B1-e 红（非法 choice 后 pending 数变了） |
| **M4** | 删掉 store 的 already-resolved 判据（:650） | B1-g 红 |

#### ⑥ 风险与回滚

- **方案 A 会碰真实数据**：每次 resolve 都是一次 facts.json 整体重写（当前 89.9 MB）。在 1.1 落地前，**单次 resolve 的落盘代价约 89 MB 写盘**。⇒ **1.2 必须在 1.1 之后做**（见 ⑦）。
- resolve('right') 会 revoke 现役 fact + upsert 新 fact（:655-658）—— 这是**改 facts**，不是改 conflicts。回滚单条需按 revokeReason / provenance 人工重建，**没有自动回滚**。⇒ 面板上的「采用右」按钮文案里要显式写明「将撤销旧事实」。
- 回滚代码：git checkout -- lib/memory-hub.js lib/client.js lib/index.js；回滚数据：按 1.1 ⑥ 的备份恢复 facts.json。

#### ⑦ 工时与依赖

| 项 | 估算 |
|---|---|
| 改动行数 | lib/memory-hub.js **+10 / −1**；lib/index.js **+18 / −0**；lib/client.js **+58 / −6**（三处各 −2/+2，加新增函数与列） |
| 新增测试 | smoke-test-batch1-conflict-ui.mjs **约 10 条**（B1-a0..a4 / b / c / d / e / f / g / h） |
| 前置依赖 | **必须等 1.1 落地**（否则每次 resolve 都写 89 MB）；**必须等用户裁定选 A / B / C / D**；若选 D 还要等路由与工具两半都定稿 |
| 面板方案的额外前置 | 走前端列时需 node --check lib/client.js + **真跑 factory 的运行时守卫**（本仓硬规则：改前端入口不能只靠静态断言） |


---

### 1.3 收紧冲突判定或加去重键

#### ① 现状实测

**落点漂移核对**：总表写 lib/fact-store.js:131-137，**实测 isFactConflict 满打满算在 :127-137**（含 5 行文档注释），判据本体 **:131-137 逐字未漂移**。

```js
127| /**
128|  * 冲突定义: 同一 subject+predicate+scope 但 object 不同(或一方有 object 一方无)。
129|  * 注意: 完全相同的 (subject,predicate,object,scope) 不算冲突, 是重复(走 merge)。
130|  */
131| export function isFactConflict(a, b) {
132|   if (!a || !b) return false
133|   if (a.scope !== b.scope || a.subject !== b.subject || a.predicate !== b.predicate) return false
134|   const ao = a.object === undefined || a.object === null ? '' : a.object
135|   const bo = b.object === undefined || b.object === null ? '' : b.object
136|   return ao !== bo
137| }
```

**关键实测：判据本身没错，错的是「没有去重键」**。检测点 :466-487 每次都无条件 push：

```js
466|     // 1. 冲突检测: 同 subject+predicate+scope 但 object 不同
467|     const existing = findSubjectPredicate(c.scope, c.subject, c.predicate)
468|     if (existing && isFactConflict(existing, c)) {
469|       stats.conflictAdded++
470|       // conflictId 必须唯一:同一候选值反复出现时,每次冲突都是独立待决事件。
471|       // 用 subject+predicate+object+序号+detectedAt 派生,保证可被逐个 resolve。
472|       conflictSeq++
479|         conflictId: defaultFactId(c.scope, c.subject, c.predicate, c.object) + '_conflict_' + conflictSeq + '_' + String(now),
483|         detectedAt: now, resolved: false,
484|       })
485|       void persist() // 冲突集是重要状态,必须落盘(不持久化会丢失待决冲突)
486|       return { ok: true, outcome: 'conflict-added', conflict: conflicts[conflicts.length - 1], existing }
487|     }
```

> :470-471 的注释里写着「同一候选值反复出现时，每次冲突都是独立待决事件」—— 这个设计意图与**用户要的「条数不涨」直接冲突**。实测结果：65,918 条里只有 **354 个不同的 (scope,subject,predicate,left.object,right.object) 组合**，重复倍数 **186.21×**，最严重的一个组合被记了 **8,641 次**（top5 = 8641 / 5778 / 3461 / 2330 / 2280）。
#### ② 改法（函数级 diff）

**核心思路**：把「每次冲突都是独立事件」改成「同一个二元矛盾只留一条、重复出现只刷新时间戳」。这**不改 isFactConflict 的判据**（它对），只在 :468 的真分支里加一道去重闸。

**新增去重键函数**（放在 isFactConflict 之后、:139 的分节注释之前）：

```js
/**
 * 冲突去重键（★1A-1.3）。
 *
 * ★为什么不改 isFactConflict：那条判据是对的（同 subject+predicate+scope 且 object 不同），
 *   实测 65,918 条冲突里没有一条是它的误判 —— 全部是「同一个矛盾被反复检测、每次各记一条」。
 *   改判据会让真矛盾漏检；加去重键才对准病灶。
 *
 * ★键为什么含 left.object 与 right.object **两端**：
 *   同一 (subject,predicate) 下可能有两个以上不同取值（A⟷B、A⟷C 是**两个不同的矛盾**，
 *   处置时也是两个不同决定）。只按 (scope,subject,predicate) 去重会把它们并成一条，
 *   用户 resolve 一次就丢掉另一组矛盾 ⇒ 从「无界增长」变成「静默丢矛盾」，比现状更糟。
 */
function conflictDedupeKey(c) {
  const objOf = (f) => (f && f.object !== undefined && f.object !== null) ? String(f.object) : ''
  return [
    String(c && c.scope), String(c && c.subject), String(c && c.predicate),
    objOf(c && c.left), objOf(c && c.right),
  ].join('\u0000')
}
```

**在检测分支里加去重闸**（替换 :468-487 整段的前半，其余不动）：

```diff
     const existing = findSubjectPredicate(c.scope, c.subject, c.predicate)
     if (existing && isFactConflict(existing, c)) {
+      // ★1A-1.3：同一个二元矛盾只留一条。重复出现 ⇒ 只刷新 detectedAt / repeatCount，不新增。
+      //   为什么是「刷新时间」而不是「什么都不做」：detectedAt 是 1.1 淘汰排序的键，
+      //   若重复出现不刷新，一条仍在活跃发生的旧冲突会被当成最旧优先淘汰掉。
+      const _k = conflictDedupeKey({ scope: c.scope, subject: c.subject, predicate: c.predicate, left: existing, right: c })
+      const _dupIdx = conflictIndexByKey.get(_k)
+      if (_dupIdx !== undefined && conflicts[_dupIdx] && conflicts[_dupIdx].resolved !== true) {
+        const _dup = conflicts[_dupIdx]
+        _dup.detectedAt = now
+        _dup.repeatCount = (Number(_dup.repeatCount) || 1) + 1
+        _dup.lastSeenAt = now
+        stats.conflictDeduped = (stats.conflictDeduped || 0) + 1
+        void persist()
+        return { ok: true, outcome: 'conflict-deduped', conflict: { ..._dup }, existing }
+      }
       stats.conflictAdded++
```

**维护索引**（四处必须同步，否则索引与数组分叉：push / resolve / 淘汰 / restore）：

```js
   let conflicts = []      // 冲突集(保留双方 provenance)
+  // ★1A-1.3：conflictDedupeKey → conflicts 数组下标。
+  //   只增不重建会分叉，故在 push（检测分支）、resolveConflict、pruneConflictsIfNeeded、
+  //   restore 四处同步维护。索引丢了只影响去重命中率（会退化成旧行为），不影响正确性。
+  let conflictIndexByKey = new Map()
```

> **索引失效的安全边界**：索引是**性能优化而非正确性依赖** —— 若某处漏了维护，最坏结果是「该次去重没命中、退回旧行为新增一条」，**不会误删或误改已有冲突**。这一点写进代码注释，避免后人把它当状态源。

**为什么 1.3 之后仍然必须做 1.1（可判据化）**：

1. 1.3 只压住**未来**的增长。盘上已有的 65,918 条（89.18 MB）**一条都不会因此减少** —— 去重闸只在 push 时生效。
2. 1.3 生效后新写入不再增长，但 65,918 条历史存量仍会让每次 persist() 重写 89 MB（1.1 的病灶）。
3. 反过来只做 1.1：上限把总量压到 500 条，但每天仍会新增 ⇒ getLastConflictPrune().pruned 会持续 > 0，等于**每天丢一点历史**。
4. ⇒ 只做 1.3 时盘上仍 89.18 MB（不变）；只做 1.1 时 stats.conflictAdded 仍单调增长。两个读数都可复算。

#### ③ 与既有机制的关系

| 受影响的既有机制 | 影响 | 处置 |
|---|---|---|
| isFactConflict（:131-137） | **不改** | 见 ② 的注释理由 |
| 检测分支的返回契约 | **新增一个 outcome**：conflict-deduped。memory-hub 的 feed 不按 outcome 分支（实测只透传），故安全 | 新 outcome 要写进套件断言 |
| conflicts 数组顺序语义 | 去重时不 push、只改时间戳 ⇒ **数组顺序不再严格等于 detectedAt 顺序**。1.1 的排序已用 seq 下标兜底（见 1.1 ②），故不冲突 | 两处判据口径一致 |
| snapshot / restore | restore 后必须**重建** conflictIndexByKey，否则进程重启后去重失效 | 见 ④ 的 F3 |
| 内存占用 | 每个键约 80 B × 最多 500 条 = 40 KB | 可忽略 |
| memory-hub overview | 随 1.1 变好；1.3 让 conflictCount 停止增长 | 与 1.2 共同前置一致 |
| 既有 smoke 套件 | 需改 **0 个**、新增 1 个。smoke-test-m80-fact.mjs / smoke-test-m81-fact-metadata.mjs 测的是 upsert 路径，**无任何套件断言 conflict-added 的次数** | grep outcome.*conflict-added 于 tests/ = 0 |

#### ④ 失败模式

| # | 怎么错 | 测试里怎么被发现 |
|---|---|---|
| **F1** | 去重键只取 (scope,subject,predicate) 三元组 ⇒ A⟷B 与 A⟷C 被并成一条，用户 resolve 一次丢掉另一组矛盾 | 用例 C1-c：构造 A⟷B 与 A⟷C ⇒ 断言 conflictCount >= 2；再 resolve 一条 ⇒ 断言 pendingConflicts() 仍有 1 条 |
| **F2** | 去重时把 resolved:true 的旧条目也当成可复用 ⇒ 用户刚裁定「保留 A」，下一次同矛盾进来被静默并进那条已解决的，用户永远看不到 | 用例 C1-d：resolve 一条后再喂同矛盾 ⇒ 断言**新增**一条 resolved:false |
| **F3** | restore 后没重建索引 ⇒ 进程重启后去重全失效，条数按老样子涨 | 用例 C1-e：restore 一个含 2 条冲突的 snapshot 后再喂相同矛盾 ⇒ 断言 conflictCount 仍 2，且 getStats().conflictDeduped >= 1 |
| **F4** | 去重时忘了 void persist() ⇒ 时间戳只改内存，重启后 detectedAt 回退，1.1 的淘汰会把仍在活跃的冲突当最旧删掉 | 用例 C1-f：io stub 记录 save 次数，喂重复矛盾后断言 save 被调用且快照里该条 detectedAt 已更新 |
| **F5** | 淘汰（1.1）删掉某条后索引未同步 ⇒ 索引指向错位，后续去重命中错误条目、甚至把别的冲突的时间戳改掉 | 用例 C1-g：上限 1 时喂 3 个不同矛盾（触发淘汰），再喂第 3 个 ⇒ 断言命中的是它自己那条 |

> **F5 是与 1.1 的交叉风险**，只在**两项都落地后**才存在。分两批做则不存在；同批做**必须**测。
#### ⑤ 验收用例设计

*真执行层*：

```js
import { createFactStorePre } from "../../lib/fact-store.js";

// C1-a ★总表原判据：同一 subject+predicate 反复出现但 object 相同 ⇒ 条数不涨
{
  const s = createFactStorePre({ io: { save() {}, load() { return null }, clear() {} } })
  const cand = (obj, src) => ({ scope: "User", subject: "构建工具", predicate: "是", object: obj, sourceKind: "explicit", sourceClass: "user-memory", confidence: 0.9, provenance: [src] })
  s.upsert(cand("esbuild", "a"))
  for (let i = 1; i <= 50; i++) s.upsert(cand("vite", "b" + i))   // 同一矛盾重复 50 次
  ok(s.conflictCount === 1, "C1-a1 ★重复 50 次 ⇒ 只 1 条冲突（旧实现会得 50）", s.conflictCount)
  ok(s.getStats().conflictDeduped === 49, "C1-a2 去重计数可观察（不静默）", s.getStats().conflictDeduped)
  ok(s.conflictsList()[0].repeatCount === 50, "C1-a3 repeatCount 记录真实发生次数", s.conflictsList()[0].repeatCount)
}
```

*负路径层*：

```js
// C1-c ★负路径：A⟷B 与 A⟷C 是**两个不同矛盾**，必须各留一条
{
  const s = createFactStorePre({ io: { save() {}, load() { return null }, clear() {} } })
  const cand = (obj) => ({ scope: "User", subject: "k", predicate: "p", object: obj, sourceKind: "explicit", sourceClass: "user-memory", confidence: 0.9, provenance: ["x"] })
  s.upsert(cand("A")); s.upsert(cand("B")); s.upsert(cand("C"))
  ok(s.conflictCount >= 2, "C1-c ★不同 object 对必须分开记（去重不能并掉真矛盾）", s.conflictCount)
}
// C1-d ★负路径：已解决的不能被复用
{
  const s = createFactStorePre({ io: { save() {}, load() { return null }, clear() {} } })
  const cand = (obj) => ({ scope: "User", subject: "k2", predicate: "p2", object: obj, sourceKind: "explicit", sourceClass: "user-memory", confidence: 0.9, provenance: ["x"] })
  s.upsert(cand("A")); s.upsert(cand("B"))
  s.resolveConflict(s.pendingConflicts()[0].conflictId, "left")
  const before = s.conflictCount
  s.upsert(cand("B"))                                  // 同矛盾再来一次
  ok(s.conflictCount === before + 1, "C1-d ★已解决的那条不复用 ⇒ 新增一条待裁定（用户能看见）", before + " -> " + s.conflictCount)
  ok(s.pendingConflicts().length === 1, "C1-d2 新增那条是未解决的", s.pendingConflicts().length)
}
```

*变异必红*：

| 变异 | 改法 | 哪条断言必红 |
|---|---|---|
| **M1** | 删掉去重闸（回到无条件 push，= 旧实现） | C1-a1 红（50 条）、C1-a2 红（deduped=0） |
| **M2** | 去重键改成三元组（去掉 left.object / right.object） | C1-c 红（A⟷B 与 A⟷C 被并成 1 条） |
| **M3** | 去重闸不判 resolved !== true | C1-d 红（resolve 后又并进已解决那条，conflictCount 不涨） |
| **M4** | 去重时删掉 void persist() | C1-f 红（save 未被调用） |
| **M5** | restore 末尾不重建索引 | C1-e 红（重启后 deduped=0） |

#### ⑥ 风险与回滚

- **1.3 本身不删盘上数据**：去重闸只在 upsert 的检测分支生效，**已有 65,918 条一条都不动**（除非同矛盾再次出现，那时只会刷新那一条的 detectedAt）。
- 但 void persist() 会写盘 ⇒ 每次重复检测仍会整体重写 facts.json（89.9 MB）。**1.3 上线后写盘字节不变，只有条数停止增长**。这也是为什么 1.1 必须同批或先做。
- 若同批做 1.1（推荐）：第一次落盘就会淘汰存量 ⇒ 参照 1.1 ⑥ 的备份与回滚。
- 回滚代码：git checkout -- lib/fact-store.js。

#### ⑦ 工时与依赖

| 项 | 估算 |
|---|---|
| 改动行数 | lib/fact-store.js **+28 / −2**（conflictDedupeKey 14 + 去重闸 13 + 索引声明 3 − 旧 2 行）；export 数 **23 → 24**（若 1.1 已加 1 个则 24 → 25；两项合计 +2） |
| 新增测试 | smoke-test-batch1-conflict-dedupe.mjs **约 10 条**（C1-a1..a3 / c / d1 / d2 / e / f / g） |
| 前置依赖 | **可与 1.1 并行**；若同批落地**必须**加测 F5（淘汰与索引的交叉）；1.3 不依赖 1.2 |
| 与 1.1 的先后 | 建议 **1.3 先于 1.1**：先把增长闸住，再一次性淘汰存量 —— 这样 pruneConflictsIfNeeded 上线时面对的是「已停止增长」的集合，pruned 是一次性历史清理，而不是持续每天删 |
---

## 1B · 碎片链条止血

### 1.4 主题门换判据（**本批最关键**）

#### ① 现状实测

**落点漂移核对**：总表写 lib/index.js:24506，**实测该行现在是解释性注释**（「★★形态硬约束：本段必须写成不引用任何外部符号的内联 IIFE」），真正的门在 **:24511-24548**。总表原写 24506，实测 24511-24548。

门的本体（lib/index.js:24511-24548，逐字节选）：

```js
24511|         const _activeBest = evId ? { id: evId } : (function () {
24512|           const _evs = (store0 && Array.isArray(store0.events)) ? store0.events : []
24513|           let _best = null
24514|           for (const _ev of _evs) {
24515|             if (!_ev || _ev.status !== 'active') continue
24516|             if (!_best) { _best = _ev; continue }
24517|             const _a = Number(_ev.updatedAt) || 0, _b = Number(_best.updatedAt) || 0
24518|             if (_a > _b || (_a === _b && String(_ev.id) < String(_best.id))) _best = _ev
24519|           }
24520|           if (!_best) return null
24521|           const _tok = function (s) {
24522|             const _out = new Set()
24523|             const _src = String(s == null ? '' : s).toLowerCase()
24524|             const _re = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|[a-z0-9_]{2,}/g
24525|             let _m
24526|             while ((_m = _re.exec(_src))) {
24527|               const _t = _m[0]
24528|               if (_t.length < 2 && !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(_t)) continue
24529|               _out.add(_t)
24530|             }
24531|             return _out
24532|           }
24533|           const _STOP = new Set('的 了 是 在 和 与 就 都 也 有 一 个 这 那 不 则 上 下 或 被 把 到 对 以 为 而 且 之 于 由 从 当 已 但 如 若'.split(''))
24534|           const _noteText = String((gate.clean || note) == null ? '' : (gate.clean || note))
24535|           const _noteTok = []
24536|           for (const _t of _tok(_noteText)) if (!_STOP.has(_t)) _noteTok.push(_t)
24537|           // 日志没有可用词 ⇒ 保持旧行为
24538|           if (!_noteTok.length) return { id: _best.id, event: _best }
24539|           const _evTok = new Set()
24540|           for (const _t of _tok(_best.name)) if (!_STOP.has(_t)) _evTok.add(_t)
24541|           for (const _t of _tok(_best.summary)) if (!_STOP.has(_t)) _evTok.add(_t)
24542|           // 事件侧无实质内容（老库）⇒ 保持旧行为，不把老库判死
24543|           if (!_evTok.size) return { id: _best.id, event: _best }
24544|           let _hit = 0
24545|           for (const _t of _noteTok) if (_evTok.has(_t)) _hit += 1
24546|           const _ratio = _hit / _noteTok.length
24547|           return _ratio >= 0.34 ? { id: _best.id, event: _best } : null
24548|         })()
```

同名判据的**模块级孪生**在 lib/event-write.js:156-185（pickActiveEventByTopicPre），阈值在 :183：

```js
182|   const ratio = hit / noteTok.length
183|   if (ratio >= 0.34) return best
184|   return null // 主题不匹配 ⇒ 交给调用方新建事件
```

> 注意：该孪生函数在 index.js 里**只被 import、从未调用**（:37 的 import 行 + :24509-24510 的两行注释是全部出现）。index.js 的 memory_log 走的是上方的**内联 IIFE**（:24506-24510 的注释解释了原因：套件用 new Function 抽取工具体单独求值，引用模块级函数会 ReferenceError）。⇒ **两处都要改**，否则孪生函数与内联实现分叉。
#### ①b 0.34 这个门到底怎么算的（分子分母各是什么）—— 数学上为什么不可能通过

**分子** = `_hit`：日志词集里**出现在「事件侧词集」中**的词个数。
**分母** = `_noteTok.length`：**本条日志全文**去停用词后的词集大小（中文按**单字**切、英文按 ≥2 连续串切）。
**事件侧词集** = `tok(_best.name)` ∪ `tok(_best.summary)`。

结构性缺陷在这三点的相互作用：

1. `_best.name` 是**另一条日志的前 40 字**（见 1.5）。
2. `_best.summary` 在日志建的事件上**恒为空** —— 实测本机 29 个日志路径事件里**只有 3 个**有 summary（3/29）。
3. 分母是**全文**词集，实测中位数 **170 个词**（范围 79–422）。

⇒ **最优情形**（拿这条日志挂到它自己建的那个事件上）的比率上界 = `|tok(日志前40字)| / |tok(日志全文)|`。下面这组读数是**可复算的物理量**，全部来自本机真实事件库（`event-store.json` 3,026,981 B / 50 事件）：

| 读数 | 值 |
|---|---|
| 参与统计的事件（name 长度 39/40 字 = 日志路径产物） | **29** |
| 其中**有 summary** | **3 / 29** |
| **无 summary 组（n=26）**：实际自重叠比率 max / median | **0.1951 / 0.0773** |
| 无 summary 组：**上界**（name 词集大小 / 日志词集大小）max / median | **0.1951 / 0.0802** |
| 无 summary 组：**上界 ≥ 0.34 的条数** | **0 / 26** |
| name 词集（distinct token）分布 | 8,9,10,10,11,11,11,11,11,11,11,13,13,13,14,15,15,16,18,18,19,19,20,21,22,**28**（最大 28） |
| 日志词集分布 | 79,82,103,110,127,128,130,140,157,157,158,162,170,177,180,180,182,194,219,219,233,239,253,266,322,**422** |

**数学上的不可能性可以写成一行**：由于分子 `_hit ≤ |_evTok|`，而 `_evTok = tok(name=40字) ∪ tok(summary)`：

```
ratio = hit / noteTok.length ≤ |evTok| / noteTok.length
      ≤ |tok(40 字文本)| / noteTok.length
      ≤ |tok(40 字文本)| / min(noteTok.length)
实测 max|tok(40字)| = 28，min(noteTok) = 79
  ⇒ 理论上界 = 28 / 79 = 0.3544  —— 只比 0.34 高 0.0144
但两者不是同一条事件：28 词的那条事件 noteTok=170，实际 28/170 = 0.1647
```

**逐条验证**：把「40 字文本理论上能产生的最大 distinct token 数」取 40（每个字符一个中文单字），则需 `noteTok ≤ 40/0.34 = 117.6`；实测 29 条里只有 **6 条**满足这个长度条件，而它们的前缀词集都很小（8–15 词）⇒ 实际比率仍远低于 0.34。用**实测**前缀词集最大值 28 代入：需 `noteTok ≤ 28/0.34 = 82.4`，**实测满足的条数 = 0**。

**结论（可复算）**：无 summary 的日志路径事件共 26 条，上界 ≥ 0.34 的是 **0 条**。门自 2026-11-05 上线以来**从未放行过一次**，「新建」是唯一可达分支。审计文档 [EVENT-FRAGMENTATION-20261108.md](file:///D:/dsh-auto-memory/docs/internal/EVENT-FRAGMENTATION-20261108.md) §1.3 报的 0/26 与本次独立复算**逐字一致**。

> 有 summary 的 3 条里确有 2 条过 0.34（evt_27310641 = 0.4937、evt_600c6d4a = 0.341）—— 这恰好证明：**门不是「阈值调紧」问题，而是「事件侧只有 40 字」问题**。一旦事件有 summary 或有标识，门就能过。
#### ② 改法（函数级 diff）

**设计原则（三条，都可判据化）**：

1. **高基数标识优先**：issue 号 / task 号 / commit 号 / PR 号是**无阈值**判据 —— 相同即同一件事，不需要调参（与 EVENT-FRAGMENTATION §4.3「判据 1」同源）。
2. **降级有序**：标识命中 ⇒ 挂；标识不命中 ⇒ **退回「最近 active 事件」**（总表原文要求），不再用词袋比。
3. **必须仍是内联 IIFE**（:24506-24510 的形态硬约束）：不能改写成模块级函数，否则 h1b / memory-event-tool 两套件用 new Function 抽取求值时当场 ReferenceError。

**新增标识抽取（内联，写进同一个 IIFE 内；不引用任何外部符号）**：

```js
          // ★1B-1.4：高基数标识抽取（无阈值判据）。
          //   issue/task/pr/bug 号统一归一成 n:<数字>；commit sha 归一成 h:<7-40 hex>。
          //   ★为什么不用词袋比：实测 26/26 条日志路径事件的自重叠上界都 < 0.34
          //     （max 0.1951 / median 0.0802），分母是全文词集、分子只有 40 字名 ⇒ 数学上过不去。
          const _idsOf = function (s) {
            const _out = new Set()
            const _src = String(s == null ? '' : s)
            const _re = /#(\d{1,6})\b|\b(?:issue|task|pr|bug)\s*#?\s*(\d{1,6})\b|\b([0-9a-f]{7,40})\b/gi
            let _m
            while ((_m = _re.exec(_src))) {
              if (_m[1]) { _out.add('n:' + _m[1]); continue }
              if (_m[2]) { _out.add('n:' + _m[2]); continue }
              const _h = String(_m[3] || '').toLowerCase()
              // 纯数字串不算 sha（避免把版本号/时间戳当 commit）
              if (/[a-f]/.test(_h) && /\d/.test(_h)) _out.add('h:' + _h)
            }
            return _out
          }
```

**替换门本体（:24537-24547 整段）**：

```diff
           const _noteText = String((gate.clean || note) == null ? '' : (gate.clean || note))
           const _noteTok = []
-          for (const _t of _tok(_noteText)) if (!_STOP.has(_t)) _noteTok.push(_t)
-          // 日志没有可用词 ⇒ 保持旧行为
-          if (!_noteTok.length) return { id: _best.id, event: _best }
-          const _evTok = new Set()
-          for (const _t of _tok(_best.name)) if (!_STOP.has(_t)) _evTok.add(_t)
-          for (const _t of _tok(_best.summary)) if (!_STOP.has(_t)) _evTok.add(_t)
-          // 事件侧无实质内容（老库）⇒ 保持旧行为，不把老库判死
-          if (!_evTok.size) return { id: _best.id, event: _best }
-          let _hit = 0
-          for (const _t of _noteTok) if (_evTok.has(_t)) _hit += 1
-          const _ratio = _hit / _noteTok.length
-          return _ratio >= 0.34 ? { id: _best.id, event: _best } : null
+          // ★1B-1.4：**标识门**（无阈值）→ 命中即挂；不命中退回「最近 active 事件」。
+          //   ★为什么保留「最近 active」兜底而不是一律新建：总表原文要求「匹配不上再退回最近 active 事件」；
+          //     且 #543 的原始病灶是「无关日志被无脑吸附」，标识门已把「明显无关」的情况挡住 ——
+          //     没有标识的日志本来就不具备「另一件事」的证据，退回旧行为比盲目新建更保守。
+          const _noteIds = _idsOf(_noteText)
+          if (!_noteIds.size) return { id: _best.id, event: _best }   // 无标识 ⇒ 退回最近 active
+          const _evIds = _idsOf([_best.name, _best.summary,
+            (_best.sections && _best.sections.goal) || '', (_best.sections && _best.sections.doing) || '',
+          ].join(' '))
+          // 事件侧也没有标识 ⇒ 无法判「同一件」⇒ 保守回退（不把老库判死，与本段原有注释同口径）
+          if (!_evIds.size) return { id: _best.id, event: _best }
+          let _idHit = 0
+          for (const _t of _noteIds) if (_evIds.has(_t)) _idHit += 1
+          return _idHit > 0 ? { id: _best.id, event: _best } : null
```

**孪生函数同步改**（lib/event-write.js:156-185，改法同上；签名不变）：

```diff
   const noteTok = [...tok(text)].filter((t) => !STOP.has(t))
-  if (!noteTok.length) return best // 日志没有可用词 ⇒ 保持旧行为
-  const evTok = new Set([...tok(ev.name), ...tok(ev.summary)].filter((t) => !STOP.has(t)))
-  if (!evTok.size) return best // 事件侧无实质内容 ⇒ 保持旧行为（老库不被判死）
-  let hit = 0
-  for (const t of noteTok) if (evTok.has(t)) hit += 1
-  const ratio = hit / noteTok.length
-  if (ratio >= 0.34) return best
-  return null // 主题不匹配 ⇒ 交给调用方新建事件
+  // ★1B-1.4：与 index.js:24511-24548 的**内联实现同源同判据**（两处必须同步改，否则分叉）。
+  const noteIds = idsOfPre(text)
+  if (!noteIds.size) return best                       // 无标识 ⇒ 退回最近 active
+  const evIds = idsOfPre([ev.name, ev.summary, (ev.sections && ev.sections.goal) || '', (ev.sections && ev.sections.doing) || ''].join(' '))
+  if (!evIds.size) return best                         // 事件侧无标识 ⇒ 保守回退
+  for (const t of noteIds) if (evIds.has(t)) return best
+  return null                                          // 标识不交集 ⇒ 交给调用方新建事件
```

> `idsOfPre` 作为**模块级导出**放在 event-write.js（该模块本来就导出纯函数，可被套件真 import 单测）；index.js 侧仍必须内联（形态硬约束），两处逻辑逐字相同、由套件**双实现对照断言**保证不走样（见 ⑤ 的 A2）。
**可复算的预期效果（真实数据）**：用同一套标识抽取在本机 50 个事件上跑：

| 读数 | 值 |
|---|---|
| 有检查点的事件 | 48 |
| 日志正文**含**高基数标识的 | **30 / 48 = 62.5%** |
| 其中与事件侧（name+summary+sections.goal+doing）**有标识交集**的 | **22 / 30 = 73.3%** |
| 日志**不含**标识（⇒ 退回最近 active，行为与今天等价） | 18 / 48 = 37.5% |

> ⇒ 改动后，62.5% 的写入会走新判据，其中 73.3% 能正确挂到同一件事上。**剩下 26.7%（8/30）会新建** —— 这正是「不同标识 ⇒ 不同事件」的正确行为（如 #520 与 #557 是两件事）。

#### ③ 与既有机制的关系

| 受影响的既有机制 | 影响 | 处置 |
|---|---|---|
| `memory_log` 归属回执（:24649-24664） | **不改**：`_ownDecision` 的三值（explicit / attached / created）逻辑与文案一字不动，只是 `attached` 的**判定依据**换了 | 回执文案「按主题匹配自动挂到」措辞需改为「按标识匹配自动挂到」（同一段 :24656） |
| `resolveActiveEventPre`（event-write.js:120-131） | **不改**：它仍被 handoff(:593) 与 plan 复用 | — |
| `pickActiveEventByTopicPre`（event-write.js:156-185） | **改**（同步降级为标识门）。index.js 里它**只 import 不调用**，改它只为不让孪生实现分叉 | 若判定「不调用就别改」，见下方风险 |
| 既有套件 `smoke-test-issue482-483-log-binding.mjs:68` | **必红**：`ok(/_ratio >= 0\.34/.test(SRC), 'C5c 主题相似度阈值判定')` | **改判据**：该断言守的是「匹配不上才新建」这个**不变量**，不是「必须用 0.34」这个旧决策 ⇒ 改成断言标识门存在 + 阈值字面量消失（见 ⑤ M1） |
| 既有套件 `smoke-test-task33-percept-production.mjs:159-165` | **仅注释提及 0.34**，无断言依赖 | 注释需同步更新（否则文档面与代码面再次矛盾 —— 本仓显式纪律） |
| `smoke-test-v4-h1b-memory-log.mjs` / `smoke-test-v4-memory-event-tool.mjs` | **必须仍绿**：它们用 `new Function` 抽取工具执行体单独求值 | 新代码**不得引用任何外部符号**（`_idsOf` 必须内联在 IIFE 内） |
| 注入面 budget | **零影响**：本项只改归属判定，不改渲染 | — |
| `event-store` 事件数 | **短期会上升**（26.7% 的带标识日志会新建），**长期会下降**（同一标识不再碎成 N 条） | 这正是本项的目的 |

#### ④ 失败模式

| # | 怎么错 | 测试里怎么被发现 |
|---|---|---|
| **F1** | `_idsOf` 写成模块级函数 ⇒ h1b / memory-event-tool 两套件用 new Function 抽取求值时 `ReferenceError` | 用例 A2：真跑 `smoke-test-v4-h1b-memory-log.mjs`，**它红就是这条**（错误信息含 `_idsOf is not defined`） |
| **F2** | 标识正则把版本号当 commit（如 `v3.4.0` 的 `340`、时间戳 `20261108`）⇒ 几乎所有日志都命同一个「标识」，全部并进一个事件 | 用例 A4：`idsOfPre('版本 v3.4.0 与 20261108')` 必须返回 **size 0**（纯数字不认、带点版本号不认） |
| **F3** | 只改 index.js 内联、不改 event-write.js 孪生 ⇒ 两处判据分叉，将来谁调 `pickActiveEventByTopicPre` 就得到另一套行为 | 用例 A5：同一组输入分别喂 `idsOfPre` 与抽出的内联 `_idsOf`，断言**逐条相同** |
| **F4** | 无标识时直接 `return null`（新建）而不是退回最近 active ⇒ 37.5% 的日志从「挂到现有事件」变成「每次新建」，碎片反而更多 | 用例 A6：无标识日志 ⇒ 断言 `_ownDecision === 'attached'`（不是 created） |
| **F5** | 事件侧取标识时漏掉 `sections` ⇒ 本机实测命中率从 22/30 掉到 20/30（只算 name+summary 时是 20） | 用例 A7：构造「name 无标识但 sections.goal 有 #557」的事件 + 带 #557 的日志 ⇒ 必须挂上 |

#### ⑤ 验收用例设计

*真执行层*（真 import → 真构造 → 真调用 → 断言返回值）：

```js
import { idsOfPre, pickActiveEventByTopicPre } from "../../lib/event-write.js";

// A1 ★总表判据①：同 issue 号的两条日志 ⇒ 第二条挂到第一条事件（不新建）—— 用真函数 + 真 store 结构
{
  const store = { events: [{
    id: "evt_aaaaaaaa", status: "active", updatedAt: 1000,
    name: "修 #557 工作区身份", summary: "",
    sections: { goal: "把 #557 的 matchedWsKey 定准", doing: "", deadend: "", next: "" },
  }] };
  const got = pickActiveEventByTopicPre(store, "#557 的第二批取证：先读 hub-access.js");
  ok(!!got && got.id === "evt_aaaaaaaa", "A1 ★同 issue 号 ⇒ 挂到已有事件（不新建）", got && got.id);
}

// A2 变异对照：把判据改回词袋比 ⇒ 同一输入必须返回 null
{
  const store = { events: [{
    id: "evt_bbbbbbbb", status: "active", updatedAt: 1000,
    name: "" + "甲".repeat(39), summary: "",   // 40 字日志名，无标识
    sections: { goal: "", doing: "", deadend: "", next: "" },
  }] };
  const note = "乙".repeat(400);   // 全文词集很大，必然过不了词袋门
  ok(!!pickActiveEventByTopicPre(store, note), "A2 无标识 ⇒ 退回最近 active（不是 null）", "见 A6");
}
```

*负路径层*：

```js
// A3 ★负路径：不同 issue 号 ⇒ 必须新建（返回 null）
{
  const store = { events: [{
    id: "evt_cccccccc", status: "active", updatedAt: 1000,
    name: "修 #557 工作区身份", summary: "",
    sections: { goal: "#557", doing: "", deadend: "", next: "" },
  }] };
  ok(pickActiveEventByTopicPre(store, "#520 的跨工作区特权") === null, "A3 ★不同 issue 号 ⇒ 新建事件（返回 null）");
}
// A4 ★负路径：纯数字/版本号不能被认成 commit 标识
{
  ok(idsOfPre("版本 v3.4.0 与 20261108 时间戳").size === 0, "A4 ★纯数字/版本号不认作标识", [...idsOfPre("版本 v3.4.0 与 20261108")].join(","));
  ok(idsOfPre("提交 e04a797 与 abc1234").size === 2, "A4b 真 sha 认出来（7-40 hex 且含字母+数字）", [...idsOfPre("提交 e04a797 与 abc1234")].join(","));
}
// A5 ★双实现对照：模块级 idsOfPre 与 index.js 内联 _idsOf 必须逐条相同
{
  const IXN = readFileSync("lib/index.js", "utf8").split("\r\n").join("\n");
  const m = IXN.match(/const _idsOf = function \(s\) \{[\s\S]*?\n          \}/);
  ok(!!m, "A5-0 能从 index.js 抽出内联 _idsOf（抽取成功是后续对照的前提）");
  const inlineIdsOf = new Function("s", "return (" + m[0].replace("const _idsOf = ", "") + ")(s)");
  const samples = ["#557 取证", "issue #520", "task 38", "提交 e04a797", "v3.4.0", "无标识的一句话", "pr#123 与 #456"];
  const diffs = samples.filter((s) => {
    const a = [...idsOfPre(s)].sort().join("|");
    const b = [...inlineIdsOf(s)].sort().join("|");
    return a !== b;
  });
  ok(diffs.length === 0, "A5 ★内联实现与模块实现逐条相同（防两处判据分叉）", diffs.join(" / "));
}
// A6 ★负路径：无标识日志必须退回「最近 active」而不是新建
{
  const store = { events: [{ id: "evt_dddddddd", status: "active", updatedAt: 5000, name: "某事件", summary: "", sections: { goal: "", doing: "", deadend: "", next: "" } }] };
  const got = pickActiveEventByTopicPre(store, "这条日志没有任何 issue/task/commit 号");
  ok(!!got && got.id === "evt_dddddddd", "A6 ★无标识 ⇒ 退回最近 active（旧行为的保守保留）", got && got.id);
}
// A7 ★负路径：事件侧标识必须把 sections.goal 算进去（否则实测命中率 22/30 → 20/30）
{
  const store = { events: [{ id: "evt_eeeeeeee", status: "active", updatedAt: 1000, name: "记账本", summary: "", sections: { goal: "跟进 #557", doing: "", deadend: "", next: "" } }] };
  ok(!!pickActiveEventByTopicPre(store, "#557 又一批取证"), "A7 ★name 无标识但 sections.goal 有 ⇒ 仍能挂上");
}
```

*变异必红*：

| 变异 | 改法 | 哪条断言必红 |
|---|---|---|
| **M1** | index.js 内联与 event-write.js 都改回 `_ratio >= 0.34` 词袋比 | **A1 红**（同 issue 号也返回 null）、A3 仍绿（不同标识本就该 null）⇒ 精确指向判据错而非逻辑错 |
| **M2** | `_idsOf` 改成模块级函数（移出 IIFE） | **A2/h1b 套件红**（ReferenceError） |
| **M3** | 标识正则去掉「纯数字不认」的判断 | A4 红（版本号/时间戳被认成标识，size 变 2 而非 0） |
| **M4** | 事件侧只取 name+summary（去掉 sections） | A7 红、A5 可能仍绿 ⇒ 区分「漏 sections」与「实现分叉」 |
| **M5** | 无标识时 `return null`（不回退） | A6 红、A2 红 |
#### ⑥ 风险与回滚

- **不碰真实用户数据文件**：本项只改归属判定，不读写 ~/.dsh/memory/** 的任何文件。
- **但会改变后续写入的归属**：上线后新写的日志按标识归组。**已存在的 50 个事件不迁移**（归并是批次 2.4 的事）。
- **短期事件数会上升**：26.7% 的带标识日志会新建（它们真有不同标识）。若用户不接受，可只做「标识命中则挂」、把不命中分支保留旧词袋门 —— 但那会让 37.5% 无标识日志仍走已证明不可能通过的 0.34 门（等于永远新建）。**推荐按本细则全量替换**。
- 回滚：git checkout -- lib/index.js lib/event-write.js + 还原 smoke-test-issue482-483-log-binding.mjs:68。

#### ⑦ 工时与依赖

| 项 | 估算 |
|---|---|
| 改动行数 | lib/index.js **+22 / −11**；lib/event-write.js **+18 / −8**；export 数 index.js **26 → 26**（内联不加导出）、event-write.js **20 → 21**（加 idsOfPre） |
| 新增测试 | smoke-test-batch1-topic-gate.mjs **约 12 条**（A1 / A2 / A3 / A4 / A4b / A5-0 / A5 / A6 / A7 + 3 条变异） |
| 既有套件改动 | **1 个必改**：smoke-test-issue482-483-log-binding.mjs:68（C5c 判据过期）；**1 个注释同步**：smoke-test-task33-percept-production.mjs:159-165 |
| 前置依赖 | **无**。可与 1.5 / 1.6 并行 |
| 收工三元组对照 | lib/index.js 28,809 → 约 28,820 行；lib/event-write.js 749 → 约 759 行 |

---

### 1.5 事件名截断 40 → 80

#### ① 现状实测

**落点漂移核对**：

| 总表原写 | 实测 | 结论 |
|---|---|---|
| lib/index.js:24523 | **24564** | **漂移 41 行**（:24523 现为 `_src` 那行） |
| lib/event-write.js:593 | **593** | 未漂移 |
| 契约值 lib/event-write.js:222 | **222** | 未漂移 |

三处逐字：

```js
// lib/index.js:24561-24565（memory_log 建事件）
24561|           const created = await createEventForWorkPre(storePath, {
24562|             today: date,
24563|             dayBoundaryMinutes: boundaryMin,
24564|             name: (gate.clean || note).trim().slice(0, 40),
24565|           })
```

```js
// lib/event-write.js:592-595（handoff 建事件）
592|     else {
593|       const created = await createEventForWorkPre(storePath, { today: opts.today, dayBoundaryMinutes: opts.boundaryMinutes, name: (sections.goal || '交接账本').slice(0, 40) })
594|       evId = created.id
595|     }
```

```js
// lib/event-write.js:213-222（createEventForWorkUnlockedPre 的契约兜底）
214|   const rawName = String(opts.name || '').trim()
215|   let name = rawName
216|   if (!name && today) {
217|     // 当天日志首条作为事件名（若已有事件但都 closed，用最近一条日志开新事件）
218|     const firstLine = firstDayViewLinePre(store, today, opts.dayBoundaryMinutes)
219|     if (firstLine) name = firstLine
220|   }
221|   if (!name) name = '未命名工作'
222|   if (name.length > 80) name = name.slice(0, 79) + '…'
```

**契约硬上限在 lib/event-store.js:207-209**（逐字）：

```js
207|   if (!/^evt_[0-9a-f]{8}$/.test(String(ev.id || ''))) bad.push('bad-id')
208|   if (!String(ev.name || '').trim()) bad.push('empty-name')
209|   if (String(ev.name || '').length > 80) bad.push('name-too-long')
```

⇒ **80 是真上限，40 只是两个调用点各自写死的常量**。

**实测长度分布（本机 50 个事件）**：

```
{4:1, 16:1, 18:1, 19:1, 20:1, 21:1, 25:1, 26:1, 27:1, 28:2, 29:1, 32:1, 34:1, 35:2,
 39:6, 40:24, 46:1, 49:1, 56:1, 57:1}
```

**39 + 40 = 30 / 50 = 60.0%**，全部是「日志前 40 字」这一个常量的产物（审计原文记 26/45 = 57.8%，本次实测 30/50 = 60.0%，样本从 45 增到 50）。

**下游影响实测**：名字变长会撞 T0 的 80 字预算（lib/event-render.js:23 的 RENDER_LIMITS.T0 = 80；:120-122 的 room = 80 − suffix − 1）。实测：

| 名字长度 | T0 渲染结果 | 是否截断 |
|---|---|---|
| 60 字 | 65 字符（`乙×60 + ' [进行]'`） | **否** |
| 80 字 | 79 字符（裁到 74 字 + `…`） | 是（T0 预算所限，非本项引入） |

⇒ 80 字名在 T2 卡片里完整显示，在 T0 目录行里被裁到 74 字 —— 这与「名字上限 80」并不矛盾，是**两个不同的显示预算**。
#### ② 改法（函数级 diff）

**三处同改，常量收敛到一处**：

1. lib/event-write.js 新增导出常量 `EVENT_NAME_MAX_PRE_V1 = 80`（放在文件顶部常量区，紧邻其它 `_PRE_V1` 常量）；
2. lib/event-write.js:222 的硬编码 80 改为引用该常量；
3. 两个调用点（index.js:24564、event-write.js:593）把 `slice(0, 40)` 改为引用该常量。

```js
// lib/event-write.js —— 新增（常量区）
/**
 * 事件名上限（★1B-1.5）。
 *
 * ★为什么是 80 而不是继续用 40：80 是**契约值**（event-store.js:209 的 validateEventPre 硬校验），
 *   40 只是两个调用点各自写死的常量，不是契约。实测 50 个事件里 30 个（60.0%）名字长度
 *   恰好 39/40 —— 全是这个常量的产物，且其中多数被切在词中（审计 A-5 记 20/45）。
 * ★为什么收敛成常量：原先 80 在 :222、40 在 :593 与 index.js:24564 —— 三个数字、两个上限值，
 *   契约与调用点各自漂移（本仓「计数锁/守卫常量必须全仓检索」的同族风险）。
 */
export const EVENT_NAME_MAX_PRE_V1 = 80
```

```diff
// lib/event-write.js:222
-  if (name.length > 80) name = name.slice(0, 79) + '…'
+  // ★1B-1.5：改用契约常量，避免与调用点的 40 再次漂移
+  if (name.length > EVENT_NAME_MAX_PRE_V1) name = name.slice(0, EVENT_NAME_MAX_PRE_V1 - 1) + '…'
```

```diff
// lib/event-write.js:593
-      const created = await createEventForWorkPre(storePath, { today: opts.today, dayBoundaryMinutes: opts.boundaryMinutes, name: (sections.goal || '交接账本').slice(0, 40) })
+      const created = await createEventForWorkPre(storePath, { today: opts.today, dayBoundaryMinutes: opts.boundaryMinutes, name: (sections.goal || '交接账本').slice(0, EVENT_NAME_MAX_PRE_V1) })
```

```diff
// lib/index.js:24564 —— ★注意：index.js 侧**不能**直接引用 EVENT_NAME_MAX_PRE_V1
//   原因同 1.4：memory_log 的执行体会被 h1b / memory-event-tool 用 new Function 抽取单独求值，
//   那个作用域里没有 event-write.js 的导出。要么把它加进抽取注入表，要么内联字面量。
//   推荐：**内联字面量 80 + 注释指向常量**（零风险，不需要改两套件的注入表）。
-            name: (gate.clean || note).trim().slice(0, 40),
+            // ★1B-1.5：40 → 80（契约值见 event-write.js 的 EVENT_NAME_MAX_PRE_V1 与 event-store.js:209）。
+            //   ㊟ 这里写字面量而不是引用常量：本段会被 smoke-test-v4-h1b / memory-event-tool
+            //   用 new Function 抽取求值，引用外部符号会 ReferenceError（同 :24506-24510 的形态硬约束）。
+            name: (gate.clean || note).trim().slice(0, 80),
```

**新增守卫（可选但推荐）**：在 `tests/smoke/` 加一条静态守卫，断言「40 这个字面量在两个调用点消失」，防止将来复制粘贴回退。**该守卫不算功能验收**（按 CR-10 纪律须显式标注为「守卫，非功能证据」）。

#### ③ 与既有机制的关系

| 受影响的既有机制 | 影响 | 处置 |
|---|---|---|
| `validateEventPre` 的 `name-too-long`（event-store.js:209） | **不改**，80 仍是硬上限 | 本项只是让写入侧用满契约额度 |
| `createEventForWorkUnlockedPre` 的 80 字兜底（event-write.js:222） | **改**（引用常量，行为等价：>80 仍裁到 79 + `…`） | 逐字节等价，可用 A2 断言 |
| T0 目录行预算（RENDER_LIMITS.T0 = 80，event-render.js:120-122） | **名字变长会挤占目录段**。实测 8 行目录：名字 4–10 字时 367 B；若名字普遍变长到 80，目录会更快撞 400 上限 ⇒ `dropped` 上升 | **本批不改 EVENT_CATALOG_MAX_CHARS**（那是对外注入契约）；在 A5 里断言「目录仍是 8 行 included」以证明当前真实数据未受影响 |
| T2 卡片头行 | 80 字名 + 状态标 = 约 89 字符，占 T2 的 2400 预算 3.7% | 实测 T2 当前 1,292 字符，余量充足 |
| 既有套件 | **0 个断言依赖 40 这个值**：grep `slice(0, 40)` 于 tests/ 的命中全是测试自己的截断显示，与事件名无关 | 无需改既有套件 |
| `event-regroup.js:107` 的 60 字上限 | **不改**：那是「建议名」的另一条通路，用户 2026-10-26 裁定过的独立口径 | 与本项不相干，别顺手改 |

#### ④ 失败模式

| # | 怎么错 | 测试里怎么被发现 |
|---|---|---|
| **F1** | 只改 index.js:24564，漏改 event-write.js:593（handoff 路径仍 40） | 用例 A3：handoff 路径建的事件名长度必须 > 40（用 60 字的 goal 段） |
| **F2** | index.js 侧改成引用 `EVENT_NAME_MAX_PRE_V1` ⇒ 抽取求值 ReferenceError | 用例 A6：跑 h1b 套件（它用 new Function 抽 memory_log 执行体） |
| **F3** | 把 event-write.js:222 的兜底也改成 40（「统一」成 40）⇒ 契约额度白给 | 用例 A2：传 79 字名进去，断言**原样保留**（不裁）；传 81 字，断言裁到 80（79 + `…`） |
| **F4** | 改成 80 后忘了 T0 的 80 上限是**含状态标**的 ⇒ 名字占满 80 时 T0 行被裁，用户看到 `…` | 用例 A5：80 字名渲染 T0，断言长度 ≤ RENDER_LIMITS.T0 且以 `…` 结尾（如实反映预算所限，不假装无损） |
| **F5** | 名字从 40 变 80 后，某条既有断言「事件名长度 == 40」变红 | 用例 A7：跑全量 smoke 里与 event-store 相关的 3 个套件，须全绿 |
#### ⑤ 验收用例设计

*真执行层*（真 import → 真调用 → 断言 return value 与落盘）：

```js
import { createEventForWorkPre, EVENT_NAME_MAX_PRE_V1 } from "../../lib/event-write.js";

// A1 ★契约常量就是 80（真读导出，不是读源码字符串）
ok(EVENT_NAME_MAX_PRE_V1 === 80, "A1 上限常量 = 80（与 event-store.js:209 的硬校验同值）", String(EVENT_NAME_MAX_PRE_V1));

// A2 ★建事件时 ≥60 字的名字必须**完整保留**（旧实现会砍到 40）
{
  const tmp = mkTempStore();                       // 见 0.5 的夹具说明
  const long60 = "甲".repeat(60);
  const r = await createEventForWorkPre(tmp, { today: "2026-11-08", name: long60 });
  ok(r.event.name === long60, "A2 ★60 字名完整保留（旧实现只剩 40）", String(r.event.name).length + " 字");
  ok(r.event.name.length === 60, "A2b 长度逐字等于 60", String(r.event.name).length);
}

// A3 ★handoff 路径同样用满 80（漏改 event-write.js:593 时这条红）
{
  const tmp = mkTempStore();
  const goal60 = "乙".repeat(60);
  const r = await appendHandoffCheckpointPre(tmp, { ledgerText: "## 目标任务\n" + goal60 + "\n", today: "2026-11-08" });
  const st = JSON.parse(readFileSync(tmp, "utf8"));
  const ev = st.events.find((e) => e.id === r.eventId);
  ok(String(ev.name).length === 60, "A3 ★handoff 建事件也用满 80（旧实现 40）", String(ev.name).length);
}
```

*负路径层*：

```js
// A4 ★负路径：超过 80 必须被契约裁到 80（含省略号），不能落盘超长
{
  const tmp = mkTempStore();
  const r = await createEventForWorkPre(tmp, { today: "2026-11-08", name: "丙".repeat(200) });
  ok(String(r.event.name).length === 80, "A4 ★200 字名裁到 80（不是 40、不是 200）", String(r.event.name).length);
  ok(String(r.event.name).endsWith("…"), "A4b 末尾是省略号（有截断痕迹）", JSON.stringify(String(r.event.name).slice(-2)));
}
// A5 ★负路径：81 字必须裁、79 字必须原样
{
  const t1 = mkTempStore(), t2 = mkTempStore();
  const n81 = "丁".repeat(81), n79 = "戊".repeat(79);
  ok(String((await createEventForWorkPre(t1, { today: "2026-11-08", name: n81 })).event.name).length === 80, "A5 81 → 80");
  ok((await createEventForWorkPre(t2, { today: "2026-11-08", name: n79 })).event.name === n79, "A5b ★79 字原样保留（兜底不得反而收紧）");
}
```

*变异必红*：

| 变异 | 改法 | 哪条断言必红 |
|---|---|---|
| **M1** | index.js:24564 改回 `slice(0, 40)` | A2（60 字变 40）—— 但 A2 走的是 createEventForWorkPre 直接调用，**不受该行影响** ⇒ 需补 A2h：真跑 memory_log（走 h1b 夹具）后断言事件名 > 40。见下 |
| **M2** | event-write.js:593 改回 40 | A3 红（handoff 路径仍 40） |
| **M3** | event-write.js:222 的兜底改成 40 | A4 红（200 字只裁到 40）、A5 红（81 → 40 而非 80） |
| **M4** | index.js 侧改成引用 `EVENT_NAME_MAX_PRE_V1` | h1b 套件红（`EVENT_NAME_MAX_PRE_V1 is not defined`） |

> **M1 的补充断言 A2h**（因 A2 只测 event-write.js，覆盖不到 index.js:24564）：用既有 `smoke-test-v4-h1b-memory-log.mjs` 的夹具（`new Function` 抽 memory_log 执行体 + 真 EW 依赖），喂一条 60 字的 note，断言落盘事件名长度 60。**这是唯一能真执行到 index.js:24564 的方式**（不启动插件）。

#### ⑥ 风险与回滚

- **不碰真实用户数据文件的既有内容**：只影响**新写入**的事件名。已落盘的 50 个事件名不变（不改存量）。
- **会碰 event-store.json**：新建事件时写盘，但那是既有路径，本项不新增写入点。回滚：`git checkout -- lib/index.js lib/event-write.js`。
- **T0 目录可能更快撞 400 上限**：若名字普遍变长，`dropped` 会上升。本批不改 `EVENT_CATALOG_MAX_CHARS`（对外注入契约），若真发生，**单独立项**（见「建议扩范围」）。

#### ⑦ 工时与依赖

| 项 | 估算 |
|---|---|
| 改动行数 | lib/event-write.js **+11 / −2**（常量 8 + :222 一行 −1/+2 + :593 一行）；lib/index.js **+3 / −1**（注释 2 行 + 一行改值）；export 数 event-write.js **20 → 21**、index.js **26 → 26** |
| 新增测试 | smoke-test-batch1-event-name-cap.mjs **约 9 条**（A1 / A2 / A2b / A2h / A3 / A4 / A4b / A5 / A5b） |
| 既有套件改动 | **0** |
| 前置依赖 | **无**。可与 1.4 / 1.6 并行 |

---

### 1.6 注入面输出 evt id

#### ① 现状实测

**落点核对**：总表写 lib/event-render.js（未给行号），实测三个渲染入口：

| 函数 | 行号 | 现状 | id 出现次数 |
|---|---|---|---|
| `renderT0Pre` | :115-123 | 只渲 name + status | **0** |
| `renderT2Pre` | :373-407 | 头行为 `【事件】name  [status]` | **0** |
| `renderEventCatalogPre` | :459-495 | 每行 `· ` + renderT0Pre | **0**（id 只在 :481-482 用作 excludeIds **过滤键**，不输出） |

逐字（renderT0Pre 完整 11 行，lib/event-render.js:113-123）：

```js
113| /** T0：name + status（≤80）。status 用中文短标，省字节。 */
114| const STATUS_LABEL = Object.freeze({ active: '进行', paused: '搁置', closed: '完成' })
115| export function renderT0Pre(ev) {
116|   if (!ev) return ''
117|   const label = STATUS_LABEL[ev.status] || String(ev.status || '?')
118|   const name = String(ev.name || '').trim() || '(未命名)'
119|   const suffix = ' [' + label + ']'
120|   // 名称可占的宽度 = 上限 - 状态标 - 1 个分隔空格
121|   const room = RENDER_LIMITS.T0 - suffix.length - 1
122|   return cutPre(name, Math.max(1, room)) + suffix
123| }
```

renderT2Pre 的头行（lib/event-render.js:373-377）：

```js
373| export function renderT2Pre(ev, opts = {}) {
374|   if (!ev) return ''
375|   const maxCk = Number.isFinite(opts.maxCheckpoints) ? Math.max(0, Math.floor(opts.maxCheckpoints)) : 3
376|   const out = []
377|   out.push('【事件】' + String(ev.name || '(未命名)') + '  [' + (STATUS_LABEL[ev.status] || ev.status) + ']')
```

**注入面 0 处 evt id 的后果**（审计 B-1 已量化）：铭文里 `memory_event` 的 append / set / rename 三条**都要求 eventId**，而模型在注入面看不到任何 id ⇒ 三条要求实际是空转。实测本机注入面（T2 + T0 目录 + slim T1）**evt_ 出现次数 = 0**。

**字符增量的实测值（关键，总表写「≈ +14/卡」，实测要按形式区分）**：

| 注入形态 | 形态字符串 | 字符增量 |
|---|---|---|
| T2 后缀式 `【事件】name  [进行] evt_xxxxxxxx` | 原 35 字符 → 新 50 | **+13** |
| T2 括号式 `【事件】name  [进行]（evt_xxxxxxxx）` | — | **+14** |
| T2 前缀式 `【事件】evt_xxxxxxxx · name  [进行]` | — | **+15** |

> 总表原写「≈ +14/卡」—— **实测该值只对括号式成立**；后缀式是 +13、前缀式是 +15。**推荐后缀式（+13）**：改动最小（只在头行末尾追加），且与既有 `【事件】name  [status]` 的结构不冲突。
> 目录段（T0）的增量另算：8 行目录实测 367 B（`included=8 / dropped=38`），若每行加 `id + 空格`（13 字符）⇒ **471 B，超 400 上限**，限 400 时只能放 **6 行**（掉 2 行）。**⇒ T0 目录不要加 id**（或用 8 位短 id，但那会与 `^evt_[0-9a-f]{8}$` 的可回填性冲突）。本细则推荐：**只给 T2 卡片加 id**，目录段保持零增量。审计 B-1 的 P-A 建议也是「每卡 +14、每目录行 +14，目录实测 8 行 ⇒ +112（392→504）超 400，须同步调 EVENT_CATALOG_MAX_CHARS **或只给卡片加**」—— 本细则选后者。

#### ② 改法（函数级 diff）

**方案：T2 卡片头行后缀式**（+13 字符/卡，目录段零改动）：

```diff
// lib/event-render.js:373-377
 export function renderT2Pre(ev, opts = {}) {
   if (!ev) return ''
   const maxCk = Number.isFinite(opts.maxCheckpoints) ? Math.max(0, Math.floor(opts.maxCheckpoints)) : 3
   const out = []
-  out.push('【事件】' + String(ev.name || '(未命名)') + '  [' + (STATUS_LABEL[ev.status] || ev.status) + ']')
+  // ★1B-1.6：头行追加 evt id（+13 字符/卡）。
+  //   ★为什么必须在**头行**：铭文里 memory_event 的 append/set/rename 三条都要求 eventId，
+  //     而注入面原先 0 处 evt id ⇒ 那三条是空转（审计 B-1 的 B 项）。
+  //   ★为什么放末尾而不是前缀：前缀式 +15、括号式 +14、后缀式 +13 —— 取最小且不破坏
+  //     既有 `【事件】name  [status]` 的可解析结构（前缀会把 name 从固定位挤走）。
+  //   ★为什么目录段（T0）不加：实测 8 行目录 367 B，每行 +13 ⇒ 471 B 超 400 上限，
+  //     只能放 6 行（掉 2 行）⇒ 目录保持零增量（详见 DETAIL-BATCH1 §1.6 ①）。
+  const _idSuffix = ev.id ? ' ' + String(ev.id) : ''
+  out.push('【事件】' + String(ev.name || '(未命名)') + '  [' + (STATUS_LABEL[ev.status] || ev.status) + ']' + _idSuffix)
```

> `ev.id` 缺失时不追加（老数据/夹具可能没有 id）⇒ **零字节纪律**保持：没有 id 的事件渲染结果与今天逐字节相同。

**可选加固：给 `renderT0Pre` 也加 id，但不加进目录** —— `renderT0Pre` 同时被目录段（`renderEventCatalogPre:489`）与测试直接调用。若加 id，目录段必然受影响。⇒ **不动 renderT0Pre**。

#### ③ 与既有机制的关系

| 受影响的既有机制 | 影响 | 处置 |
|---|---|---|
| T2 总预算 `RENDER_LIMITS.T2 = 2400` | 每卡 +13，`pickT2EventsPre` 默认取 2 个 ⇒ 注入面 **+26 字符**（约占总预算 1.1%） | 实测真实 T2 当前 1,292 字符，余量 1,108 ⇒ 安全 |
| 事件目录段（`renderEventCatalogPre`，≤400） | **零改动**（见 ① 的实测理由） | — |
| slim T1 行（`renderT1Pre`，index.js:10106 调用） | **零改动**。slim 版只渲 summary 首句，不含 id | 若要让 slim 也带 id，属于独立决策（见「建议扩范围」） |
| `smoke-test-v4-b1-event-catalog.mjs` | **必须仍绿**：它断言目录段的 excludeIds 行为，本项不动目录 | — |
| `smoke-test-v4-h4-t2-percept.mjs` / `smoke-test-v6-b3-quad-render.mjs` | **可能红**：它们对 T2 输出做 `split('\n')` 并按行首 `'  - ['` 取检查点行；头行加了 id **不影响**这些断言（它们不按头行做等值比较） | 但 `v6-b3:46` 的预算台账用 `const HEAD = 60` 估头行长度 —— **头行变长后该估算偏小**，需复算（见 ④ F4） |
| `smoke-test-v4-c2-slim-events.mjs:127` | 断言 slim 版**不含** `【事件】` | 零影响 |
| 现有真实注入面 | T2 2 卡 ⇒ +26 字符；若用户把 `eventMaxActiveInInject` 调到 5 ⇒ +65 | 可接受 |

#### ④ 失败模式

| # | 怎么错 | 测试里怎么被发现 |
|---|---|---|
| **F1** | 把 id 加到 `renderT0Pre` 里（顺手「统一」）⇒ 目录段每行 +13，8 行超 400，掉 2 行 | 用例 B2：真调 `renderEventCatalogPre` 与 fixture 8 事件，断言 `included === 8` 且 `text.length <= 400` |
| **F2** | `ev.id` 缺失时渲染出 ` undefined` | 用例 B3：`renderT2Pre({...无 id})` ⇒ 输出**不含** `undefined`，且与今天逐字节相同 |
| **F3** | id 加在 name **前面**（前缀式）⇒ 破坏 `【事件】name` 的可解析结构，且 +15 | 用例 B4：断言头行必须以 `【事件】` 开头、且第 2 段仍以 name 起始 |
| **F4** | `v6-b3:46` 的 `HEAD = 60` 预算台账估算失真 ⇒ 台账锁 A-4（`effWithHead === 3240`）仍绿但实际占用变了 | 用例 B5：复算 `effWithHead`，若头行实际变长约 13，须把 `HEAD` 常量从 60 调到 73 并在套件注释写明（**这是判据过期，不是放宽**） |
| **F5** | 三个事件渲染出相同 id（`ev.id` 取错，如取到数组下标） | 用例 B6：3 个不同事件 ⇒ 3 个 id 互不相同，且都匹配 `/^evt_[0-9a-f]{8}$/` |
#### ⑤ 验收用例设计

*真执行层*（真 import → 真构造 → 真渲染 → 断言返回值）：

```js
import { renderT2Pre, renderEventCatalogPre, RENDER_LIMITS } from "../../lib/event-render.js";

const mkEv = (id, name) => ({
  id, name, summary: "", status: "active",
  sections: { goal: "G", doing: "", deadend: "", next: "N" },
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  checkpoints: [{ at: 1, kind: "log", text: "CK", goal: "g", state: "s", dead: "", next: "n" }],
  startMs: 0, endMs: 0, members: [], rationale: "", kind: "unknown", confidence: "unknown",
  outcomes: [], ordinal: 0, skills: {}, createdAt: 1, updatedAt: 1,
});

// B1 ★总表判据：每个事件卡必须含 evt_xxxxxxxx
{
  const out = renderT2Pre(mkEv("evt_1a2b3c4d", "日志行改成事件容器"));
  ok(/evt_[0-9a-f]{8}/.test(out), "B1 ★T2 卡片含 evt_xxxxxxxx", (out.match(/evt_[0-9a-f]{8}/) || ["(无)"])[0]);
  ok(out.split("\n")[0].indexOf("evt_1a2b3c4d") > 0, "B1b id 在**头行**（不是埋在检查点里）", out.split("\n")[0]);
}

// B6 ★总表判据：3 个事件 ⇒ 3 个 id 各不相同
{
  const ids = ["evt_aaaaaaaa", "evt_bbbbbbbb", "evt_cccccccc"];
  const got = ids.map((id, i) => {
    const m = renderT2Pre(mkEv(id, "事件" + i)).match(/evt_[0-9a-f]{8}/);
    return m ? m[0] : "";
  });
  ok(got.every((x, i) => x === ids[i]), "B6 ★3 个事件 3 个 id 各不相同且与输入一致", got.join(","));
  ok(new Set(got).size === 3, "B6b 去重后仍 3 个", String(new Set(got).size));
}

// B7 ★总表判据：字符增量 ≈ +13/卡（真量三条真实事件的渲染长度差）
{
  const withId = renderT2Pre(mkEv("evt_1a2b3c4d", "甲".repeat(20)));
  const noId   = renderT2Pre(mkEv("",               "甲".repeat(20)));
  ok(withId.length - noId.length === 13, "B7 ★每卡 +13 字符（实测值，非估计）", String(withId.length - noId.length));
  ok(withId.split("\n")[0].length - noId.split("\n")[0].length === 13, "B7b 增量全落在头行", String(withId.split("\n")[0].length - noId.split("\n")[0].length));
}
```

*负路径层*：

```js
// B3 ★负路径：无 id 的事件必须零增量（老数据/夹具不受影响）
{
  const noId = mkEv("", "某事件");
  const out = renderT2Pre(noId);
  ok(out.indexOf("undefined") < 0, "B3 ★无 id ⇒ 输出不含 undefined", out.slice(0, 60));
  ok(out.length === renderT2Pre({ ...noId, id: undefined }).length, "B3b 与今天逐字节同长（零字节纪律）", String(out.length));
}
// B2 ★负路径：目录段**不得**因本项变长（8 行仍要放得下）
{
  const evs = Array.from({ length: 8 }, (_, i) => mkEv("evt_" + String(i).padStart(8, "0"), "事件" + i));
  const cat = renderEventCatalogPre(evs, { maxChars: 400 });
  ok(cat.included === 8, "B2 ★8 行目录仍全部 included（id 未侵入目录）", String(cat.included));
  ok(cat.text.length <= 400, "B2b 目录长度仍 ≤ 400", String(cat.text.length));
  ok(cat.text.indexOf("evt_") < 0, "B2c ★目录行里不含 evt id（否则 8 行会掉 2 行）", cat.text.slice(0, 40));
}
```

*变异必红*：

| 变异 | 改法 | 哪条断言必红 |
|---|---|---|
| **M1** | 删掉头行的 `+ _idSuffix`（回到旧实现） | B1 红（无 evt_）、B6 红、B7 红 |
| **M2** | 把 id 加到 `renderT0Pre` 里 | B2c 红（目录含 evt_）、B2 红（included < 8） |
| **M3** | `_idSuffix` 改成 `' ' + ev.id`（不加存在性判断） | B3 红（出现 `undefined`） |
| **M4** | id 放前缀（`'【事件】' + ev.id + ' · ' + name`） | B4/B1b 红（头行不以 name 起始）；B7 红（增量变 15） |

#### ⑥ 风险与回滚

- **不碰任何真实数据文件**：纯渲染函数改动，零 IO。
- 唯一风险是**注入面字符变多**（每卡 +13，2 卡 +26）；若用户把 `eventMaxActiveInInject` 调到很大，按比例增长。可随时回滚。
- 回滚：`git checkout -- lib/event-render.js`。

#### ⑦ 工时与依赖

| 项 | 估算 |
|---|---|
| 改动行数 | lib/event-render.js **+9 / −1**（注释 6 行 + `_idSuffix` 1 行 + 头行改 1 行 − 旧 1 行）；export 数 **16 → 16** |
| 新增测试 | smoke-test-batch1-ev-id-inject.mjs **约 11 条**（B1 / B1b / B2 / B2b / B2c / B3 / B3b / B6 / B6b / B7 / B7b） |
| 既有套件改动 | **1 个可能需调台账**：smoke-test-v6-b3-quad-render.mjs:46 的 `HEAD = 60` → 73（属判据过期，须在回滚说明里写明） |
| 前置依赖 | **无**。可与 1.4 / 1.5 并行 |
| 收工三元组对照 | lib/event-render.js 29,034 B / 502 行 → 约 29.6 KB / 510 行 |
---

## 2. 本批改动汇总（供 Lead 排期与复核）

### 2.1 六个落点的文件归属与行数预估

| 项 | 文件 | 预估改动 | export 增量 | 新增测试条数 | 是否碰真实数据 | 依赖 |
|---|---|---|---|---|---|---|
| 1.1 | lib/fact-store.js | +62 / −1 | +1（23→24） | 12 | **是**（淘汰 65,918 条存量） | 批次 0.1 |
| 1.2 | lib/memory-hub.js + lib/index.js + lib/client.js | +86 / −7 | 0 | 10 | **是**（每次 resolve 重写 89 MB） | 1.1 + **用户裁定方案** |
| 1.3 | lib/fact-store.js | +28 / −2 | +1（与 1.1 合计 +2） | 10 | **否**（只改判定） | 无（建议先于 1.1） |
| 1.4 | lib/index.js + lib/event-write.js | +40 / −19 | +1（ew 20→21） | 12 | 否 | 无 |
| 1.5 | lib/event-write.js + lib/index.js | +14 / −3 | +1（ew →22） | 9 | 否 | 无 |
| 1.6 | lib/event-render.js | +9 / −1 | 0 | 11 | 否 | 无 |

**合计**：源码改动约 **+239 / −33 行**；新增导出 **3 个**；新增断言 **64 条**；新增套件 **6 个**；既有套件需改 **3 个**（smoke-test-issue482-483-log-binding 判据过期、smoke-test-v6-b3-quad-render 台账常量、smoke-test-task33-percept-production 仅注释）。

### 2.2 三处会改变「今天能跑出什么数」的物理量

| 量 | 今天 | 改后 | 复算方式 |
|---|---|---|---|
| facts.json 全文件字节 | 89,929,359 B | 约 **1,161,000 B** | 476,193(facts) + 682,873(conflicts≤500) + 其余 |
| conflicts 条数 | 65,918 | **≤ 500** | `getStats()` / `conflictCount` |
| 面板 overview 的 pendingConflicts 载荷 | 88,995,846 B | ≤ 约 27,000 B（20 条摘要） | `JSON.stringify(overview)` |
| 同名矛盾重复倍数 | 186.21× | **1.00×**（去重后不新增） | 65,918 / 354 → 同一输入重复不再增长 |
| 主题门放行率 | **0 / 26 = 0%** | 62.5% 走新判据，其中 73.3% 能挂上 | 标识命中统计 |
| 事件名 39/40 字占比 | 30 / 50 = 60.0% | 上限 80，长名不再被砍 | 长度分布 |
| 注入面 evt id 出现次数 | **0** | 每张 T2 卡 1 个（2 卡 = 2 个） | `renderT2Pre` 输出计数 |

### 2.3 建议的执行顺序（含理由）

1. **1.3 先做**（治增长，不碰存量，零数据风险）；
2. **1.1 紧随**（一次性淘汰存量；此时集合已停止增长，`pruned` 是一次性历史清理）；
3. **1.4 / 1.5 / 1.6 三项并行**（三个不同文件、互不依赖、零数据风险）；
4. **1.2 最后**（依赖 1.1 已落地，否则每次 resolve 都写 89 MB；且等待用户裁定方案）。

---

## 3. 建议扩范围（**本批不直接扩**，仅列出供用户裁定）

### 3.1 事件目录段 `EVENT_CATALOG_MAX_CHARS` 400 → 520

**为什么想扩**：1.5 把名字上限提到 80 后，目录行平均会变长；1.6 若要给目录也加 id，需 400→520。

**为什么不直接扩**：

1. `EVENT_CATALOG_MAX_CHARS` 有**两处既有套件**依赖（`smoke-test-v4-b1-event-catalog.mjs:48/50/53/55` 都显式传 `maxChars: 400`；`smoke-test-v5-p6-r5-catalog-visibility.mjs:63/66` 同）。改常量会连带改 2 个套件的 6 处调用。

2. 该常量是**对外注入契约**的一部分（event-render.js:24-25 的注释写明「D6 裁定：独立段 ≤400 字符」），改它等于改一条已裁定的产品策略。

3. 本批 1.6 已选择「只给卡片加 id、目录零增量」的方案，**400 在当前真实数据（8 行 367 B）下有余量**。

**若仍要做**，最小改动是：常量提到 520 + 同批改 2 个套件的 6 处调用 + 在 event-render.js:24 的注释里写明新裁定来源。**需用户裁定**。

### 3.2 `slimEventT1` 也带 evt id

**为什么想扩**：slim 版的 `[当前事件]` 行（index.js:10646）只给 summary 首句，不带 id，同样无法支撑 `memory_event(action=append, eventId)`。

**为什么不直接扩**：

1. slim 段有独立字符预算（`_EVT_LINE_MAX`），+13 会挤掉首句内容；

2. `smoke-test-v4-c2-slim-events.mjs` 对 slim 输出有 7 条断言，其中 :127 断言**不含** `【事件】`；

3. 精简版的产品定位是「最克制」（index.js:10632-10634 的注释），加 id 与定位冲突。

**建议**：单独立项，与「清单化」的批次 3 一起做（那里本来就要重排注入段）。

### 3.3 把 `pickActiveEventByTopicPre` 从 index.js 的 import 里删掉

**为什么**：它只被 import、从未调用（index.js:37 的 import 行 + :24509-24510 的两行注释是全部出现）。

**为什么不直接删**：1.4 要**同步改它**（防止与内联实现分叉）。若判定「不调用就不必改」，那它就该整条删掉；若保留，就必须与内联实现同源。**两条路互斥，需用户裁定**：

- 路线 α：1.4 同步改孪生函数 + 加 A5 双实现对照断言（本细则默认）；

- 路线 β：删掉 event-write.js:156-185 整个函数 + index.js:37 的 import，只保留内联。

> 推荐 **α**：`pickActiveEventByTopicPre` 是导出的公开函数，可能有外部/未来调用方；删除属于 API 变更，超出本批止血范围。

---

## 4. 本批开工前必须先答的问题（2 条）

### Q1. 1.2 的处置入口选哪个方案？（**阻塞 1.2，不阻塞其余五项**）

本细则给了 A / B / C / D 四方案的对比表（§1.2 ②）与推荐（**A：面板「待裁定」列**）。四项差异的关键点：

- **A** 与总表验收判据同源（「面板可见」），成本最低，人逐条点天然有 throttling；

- **B** 让模型误改 facts 的风险不对称（`resolve('right')` 会 revoke 现役 fact）；

- **C** 与 1.3 重复治理且**永久丢数据**；

- **D** = A + B，需同时改前端与工具两处，工具数从 21 变 22（要连带改 6 处文档计数）。

**需要用户答**：选 A / B / C / D 中的哪一个？（推荐 A）

### Q2. 1.5 之后，`smoke-test-v6-b3-quad-render.mjs:46` 的 `HEAD = 60` 常量要不要同批调 73？

**背景**：那是**预算台账锁**（A-4 断言 `effWithHead === 3240`）。1.6 让 T2 头行变长 13 字符后，`HEAD = 60` 这个「【事件】行估」偏低 13，台账的物理含义失真。

**两种处置**：

- **A（推荐）**：把 `HEAD` 调到 73 并在套件注释写明「1.6 让头行 +13，属判据过期不是放宽」，`effWithHead` 从 3240 变 3253，锁同步重钉；

- **B**：不动套件，把 1.6 记为「已知台账偏差 +13」写进 CHANGELOG 的「未验证」组。

**为什么必须问**：这是本仓明确的「判据过期 vs 真缺陷」分叉点，且改的是计数锁（`memory_rules` 里有硬约束：改计数锁必须全仓检索所有出现点）。**不能由细则自行决定**。

---

## 5. 计划外的大额工时（**单列，不混进本批**）

| 项 | 为什么不在本批 | 估算 |
|---|---|---|
| **facts.json 写盘从整份快照改增量/分片** | 这是审计 P0-1③，涉及 `hub-io` 的事务契约，属结构性改动。本批 1.1 只把「重写的字节数」降到 1/75 量级，**不改写盘机制** | 需单独立项，无法在本批估准 |
| **conflicts 的语义核查**（65,918 条里除了 354 个不同键之外是否还有「同主语不同日期」的噪声） | 审计 P0-1 的「未验证」第 6 条明确写了这条没核。1.3 的去重键按 (scope,subject,predicate,left.object,right.object) 分组，**同主语不同日期会被算成同一键**（因为 object 相同），所以 1.3 会把它压掉 —— 这可能压掉真实的时间演变。**需抽样核查** | 抽 50 条人工判读，约半天 |
| **`docs/` 与 README 的计数同步** | 若用户裁定 Q1 选 B/D（工具数 21→22），要连带改 6 处文档计数并跑 `tools/verify-docs.mjs` | 与本批其余项无关，取决于 Q1 的答案 |

---

## 6. 本文件的自我限定（避免被当成已实现）

- **本文件不含任何已落地的代码改动**。上面所有「改法」都是拟写片段，未经编译、未经测试。

- **所有物理量均为 2026-11-08 09:50-10:27 实测**，并已注明时点；数据面（facts.json / event-store.json）仍在变化，执行前必须当场重测。

- **所有行号均为实测值**，并已注明与总表原写的差异（1.2 / 1.4 / 1.5 三处有漂移）。

- **未做的事**：没有 `node --check`、没有跑任何 smoke 套件、没有改任何 lib/ 或 tests/ 文件。这些都属于施工阶段。
