# wb-sidecar.js — 白板/账本的**结构化旁挂索引**（看板数据源）

> **规模**：44,633 B / 955 行 / **30 个函数 / 27 个导出符号**
> **版本常量**：`WB_SIDECAR_VERSION = 'wb_sidecar_pre_v1'`
> **职责一句话**：把 Markdown 白板（PLAN.md）与账本（handoff/*.md）**确定性派生**成 `index.json`——一个可按 tag / cue / 版本链检索、并能渲染成看板泳道的结构索引。

---

## ★ 先澄清一个极易混淆的点（本卷独有）

**`wb-sidecar` 不是 Python sidecar。** 仓库里有两个名字都含 "sidecar" 的东西：

| 模块 | 是什么 | 有没有 Python |
|---|---|---|
| `wb-sidecar.js`（本卷） | **纯 JS 的 JSON 旁挂索引**，从 Markdown 派生 | ❌ **完全没有 Python 参与** |
| `python-sidecar-client.js` | 与 Python 进程通信的客户端 | ✅ 需要 Python |

⇒ **本模块与「JS/Python 双端语义引擎」那套铁律无关**——它是纯 JS、零外部依赖、零 LLM。
**但有一条精神同源的约束仍然适用**（见 `7）：**Python 装不装，本模块行为必须完全不变。**

---

## 1. 设计立场：Markdown 是真源，index.json 只是投影

文件头注释（第 1–19 行）把立场写得很明确（**这是全文最该先读的 6 行**）：

```js
/**
 * 设计:
 *  - index.json **完全可重建**: 从 PLAN.md + 账本白名单文件确定性派生
 *    (dsh-graph「events 是真源、文件是投影」的反向取舍——我们的 Markdown 文件是真源,
 *     sidecar 只是派生索引, 丢了自愈重建)。
 *  - 条目 id = WB-FORMAT-CONVENTION `2 锚点契约: mem_ + sha256(workspaceKey+'\0'+relPath+'\0'+title) 前 32 hex。
 *    **relPath 一律正斜杠、title 一律经 normalizeTitlePre** —— write 与 rebuild 两条路径必须算出同一 id
 *    (2026-09-16 修复 BUG-10: 此前 write 传 path.relative(反斜杠) + title 含 handoff- 前缀,
 *     rebuild 传正斜杠 + 去前缀, 同一条目两个 id, 破坏「完全可重建」)。
 *  - tag 提取 = 确定性词法: 行内 `tag:xxx` / `type:xxx` / `topic:xxx` 模式, 零 LLM。
 *  - 仅 boardMode='graph' 时被调用; legacy 模式下零文件写入。
 */
```

**四条立场逐条解读**：

1. **可重建**：sidecar 是**缓存**，删掉能自愈。⇒ teamwork 同步时**绝不要把 index.json 当权威数据同步**（那是派生数据 = 同步词汇里的 **S3 派生重算**）。
2. **id 是内容寻址**：`sha256(ws + '\0' + relPath + '\0' + title)` —— **不是**时间戳、**不是**自增号。这条设计**天然适合同步**（两端独立算出同一 id ⇒ 可去重）。
3. **零 LLM**：tag 提取是纯词法。⇒ 不产生模型调用成本，可放心在同步路径上高频调用。
4. **开关隔离**：`boardMode='graph'` 才写文件，legacy 模式**零写入**。⇒ 这是现成的**功能开关范式**。

---

## 2. BUG-10 的教训（已修，但必须理解，因为 team 版会放大它）

**症状**：同一条目在两条路径下算出**两个不同 id**。

| 路径 | relPath | title | ⇒ id |
|---|---|---|---|
| write（写入时） | `path.relative(...)` ⇒ **反斜杠** `handoff\PLAN.md` | 含 `handoff-` 前缀 | id-A |
| rebuild（重建时） | **正斜杠** `handoff/PLAN.md` | 去前缀 | id-B |

**后果**：id-A ≠ id-B ⇒ **"完全可重建"这条设计前提被打破**。

**修法**（两个归一化函数）：

```js
/** 路径归一：一律正斜杠、去首尾斜杠、折叠重复斜杠。（L57） */
export function normalizeRelPathPre(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
}

/** 标题归一：去 markdown 井号、去 handoff- 前缀、压缩空白。（L67） */
export function normalizeTitlePre(t) {
  return String(t || '').replace(/^#+\s*/, '').replace(/^handoff-/, '').trim()
}
```

**★ 这条为什么对 teamwork 至关重要**：
Windows 与 Linux/macOS 的路径分隔符**天然不同**。若不做归一化，**同一份 PLAN.md 在 A 机（Windows）与 B 机（Linux）会算出两个 id** ⇒ 跨机同步时**每个条目都会被当成新条目重复一遍**。
⇒ **归一化不是"整洁性偏好"，是跨机收敛的硬前提。** 这条设计**已经做对了**，team 版**必须原样保留、不得绕过**。

---

## 3. 数据流（谁调它、它读什么、写什么）

本模块是**纯函数库**，自身不读文件——**调用方读文件后把正文喂给它**。

| 方向 | 内容 |
|---|---|
| **输入** | `(workspaceKey, docs[])` —— `docs` 是 `[{relPath, title, body}]`，由**调用方**从磁盘读出 |
| **内部** | 纯词法：切节 → 抽 tag/cue → 算 id → 建三张倒排（by_tag / by_cue / versions） |
| **输出** | `index.json` 内存对象（`rebuildSidecarIndexPre`）或单条 `Entry` |
| **写盘** | **本模块不写盘**。`index.json` 的落盘由调用方负责，且仅 `boardMode='graph'` 时发生 |
| **下游消费者** | ① 看板渲染（`buildKanbanPre` / `buildKanbanMatrixPre`）② Tier-0 目录（经 `sidecarEntryToCatalogItemPre`）③ P3 遍历工具（`expandByTagPre` / `traceByIdPre`） |

**关键推论**：
- 因为**不写盘 + 纯函数**，它**可以安全地在同步路径上高频调用**（无副作用、零 LLM、零网络）。
- 因为 **output 完全由 input 决定**，**两端只要 input 相同，output 必然逐字节相同** ⇒ 这是它成为"最适合同步的模块"的根因。

---

## 4. 逐段精读

| 行号 | 函数 | 作用 |
|---:|---|---|
| 24 | `sectionTagPre` | 章节标题 → tag（截断 24 字、去 `#` 前缀） |
| 35 | `extractTagsPre` | 从文本提取确定性 tag（`tag:` / `type:` / `topic:` + 标题降 tag），**零 LLM** |
| 57 | `normalizeRelPathPre` | **路径归一**（见 `2） |
| 67 | `normalizeTitlePre` | **标题归一**（见 `2） |
| 78 | `wbEntryIdPre` | **条目主键**：`mem_ + sha256(ws\0relPath\0title)[0:32]` |
| 97 | `wbRefPre` | **write / rebuild 的唯一引用构造口径**（注释原文如此） |
| 110 | `extractCuesPre` | 抽 cue（入口线索：路径 / 反引号代码 / 长数字串） |
| 123 | `sectionOfPre` | 反查某段文本所属小节标题 |
| 158 | `splitSectionsPre` | **把正文切成小节**（纯函数、零 IO） |
| 238 | `buildSectionCardsPre` | **小节级卡片**（看板数据源，纯函数、零 IO、确定性） |
| 302 | `buildSidecarEntryPre` | 单卡构造（**无 body 字段**）：`id/kind/source/section/tags/cues/preview/mtime` |
| 350 | `buildSidecarEntriesPre` | **两条路径的唯一分节出口**（见 `4.1） |
| 409 | `sidecarEntryToCatalogItemPre` | 条目 → Tier-0 目录条目（**只做字段映射，不复制逻辑**） |
| 425 / 437 / 453 | `buildByTagPre` / `buildByCuePre` / `buildVersionsPre` | 三张倒排索引 |
| 468 | `rebuildSidecarIndexPre` | **全量重建** index.json（纯函数，调用方读文件） |
| 512 / 551 | `expandByTagPre` / `traceByIdPre` | 白板结构化展开 / 回溯（P3 能力） |
| 571 | `criteriaWeightPre` | 判据加权（passed > warned > unknown） |
| 576 | `WB_ANCHOR_LINE_RE_PRE_V1` | 锚点行正则（与 L0 抽取同形） |
| 594 / 628 | `applyAnchorsPre` / `collectAnchorIdsPre` | 锚点应用与收集（`collectAnchorIdsPre` 注释明写用于 **lint / 一致性检查**） |
| 652 | `WB_KANBAN_LANES_PRE_V1` | **泳道定义（顺序即渲染顺序，已冻结）** |
| 669 / 706 | `laneOfEntryPre` / `buildKanbanPre` | **看板泳道归属（确定性，缺省 'misc'）/ 看板构建** |
| 853 / 867 | `ledgerDateOfPre` / `buildKanbanMatrixPre` | 账本日期（从 `handoff-YYYYMMDD-HHMMSS.md` 推；推不出返回 `''`）/ **看板矩阵** |

### 4.1 `buildSidecarEntriesPre`（第 334–408 行）——**本文件最重要的一段历史**

源码注释直接写下了根因（第 334–344 行），**逐字引用**：

> 背景（实测根因）：`buildSidecarEntryPre` 是**单卡**函数（契约返回单个对象、无 `body` 字段），
> 但 `writePlanSnapshot` 把**整篇 PLAN.md**（22 个 `##` 小节）交给它 ⇒ 整篇被压成 1 张卡、
> 其 id 与看板用的 22 张分节卡（id=各节锚点）**完全不相交**。

⇒ **这是典型的"两条路径各写一份判据"缺陷**：写入侧用单卡函数、看板侧用分节函数，**两者 id 空间不相交** ⇒ 写入的条目在面板上**永远看不见**（用户可见症状：**「白板只剩一行」**）。

**修法**（第 340–344 行）：本函数 = **两条路径的唯一分节出口**——
> 复用 `buildSectionCardsPre` 的既有切分口径，
> 走原单卡分支 ⇒ 账本类文档（四段式，恰好单节）行为**逐字节不变**，既有守卫不受影响。

**三条可复用的工程判据**：

1. **"同一份数据被两条路径投影"时，分节口径必须唯一。** 否则会出现"写得进去、看不见"的幽灵条目。
2. **修这类缺陷必须保证既有行为逐字节不变** —— 用"分节后只有 1 节"**自然退化**为原行为，而不是靠 `if (特别情况)` 打补丁。
3. **这是硬锁**：源码 L142 逐字记载「既有套件断言 `rebuildSidecarIndexPre('ws', 2 docs).entries.length === 2`，改动即回归」⇒ 任何改动这两个函数的行为都必须先复核该断言。

---

## 5. 对外接口（27 个导出符号）

| # | 行 | 符号 | 入参 | 返回 | 用途 |
|---:|---:|---|---|---|---|
| 1 | 21 | `WB_SIDECAR_VERSION` | — | `'wb_sidecar_pre_v1'` | **版本常量**——同步时须比对 |
| 2 | 35 | `extractTagsPre` | `(text)` | `string[]` | 确定性词法 tag 提取（零 LLM） |
| 3 | 57 | `normalizeRelPathPre` | `(relPath)` | `string` | **relPath 一律正斜杠**（BUG-10 的一半） |
| 4 | 67 | `normalizeTitlePre` | `(title)` | `string` | **title 一律规范化**（BUG-10 的另一半） |
| 5 | 78 | `wbEntryIdPre` | `(workspaceKey, relPath, title)` | `'mem_'+32hex` | **条目 id 唯一派生口径** |
| 6 | 97 | `wbRefPre` | `(relPathOrName, titleHint?)` | `{relPath, title}` | **write/rebuild 唯一引用构造口径** |
| 7 | 110 | `extractCuesPre` | `(text)` | `string[]` | 入口线索：路径 / 反引号代码 / 长数字串 |
| 8 | 158 | `splitSectionsPre` | `(text)` | `Array<{...}>` | 按 `##` / `###` 切小节 |
| 9 | 238 | `buildSectionCardsPre` | `(sections, ...)` | `Card[]` | 分节卡构造 |
| 10 | 302 | `buildSidecarEntryPre` | `(o)` | `object`｜`null` | **单卡**构建（无 `body` 字段） |
| 11 | 350 | `buildSidecarEntriesPre` | `(o)` | `object[]` | **多节自动分节**（≥1 条；两条路径唯一分节出口） |
| 12 | 409 | `sidecarEntryToCatalogItemPre` | `(entry)` | `object` | 条目 → Tier-0 目录项（**契约 `8 的桥**） |
| 13 | 425 | `buildByTagPre` | `(entries)` | `{tag: id[]}` | `by_tag` 倒排 |
| 14 | 437 | `buildByCuePre` | `(entries)` | `{cue: id[]}` | `by_cue` 倒排 |
| 15 | 453 | `buildVersionsPre` | `(entries)` | `object` | **版本链**（P5 墓碑的现成挂点） |
| 16 | 468 | `rebuildSidecarIndexPre` | `(workspaceKey, docs)` | `index.json 内容` | **全量重建**（纯函数，调用方读文件） |
| 17 | 512 | `expandByTagPre` | `(index, tag, limit?)` | `Entry[]` | 按 tag 展开（P3 遍历工具） |
| 18 | 551 | `traceByIdPre` | `(index, id)` | `{...}` | 按 id 回溯（cue / tag / 邻接 / 归档链） |
| 19 | 571 | `criteriaWeightPre` | `(criteria)` | `number` | 判据排序权重 |
| 20 | 576 | `WB_ANCHOR_LINE_RE_PRE_V1` | — | `RegExp` | 锚点行正则 |
| 21 | 594 | `applyAnchorsPre` | `(text, ...)` | `string` | 应用锚点 |
| 22 | 628 | `collectAnchorIdsPre` | `(text)` | `string[]` | 抽锚点 id（lint / 一致性检查） |
| 23 | 652 | `WB_KANBAN_LANES_PRE_V1` | — | 冻结数组 | **泳道定义（顺序即渲染顺序）** |
| 24 | 669 | `laneOfEntryPre` | `(entry)` | `string` | 条目 → 泳道 key（**确定性**，缺省 `'misc'`） |
| 25 | 706 | `buildKanbanPre` | `(index, opts?)` | `Kanban` | 看板投影（泳道卡片） |
| 26 | 853 | `ledgerDateOfPre` | `(source)` | `string` | 从 `handoff-YYYYMMDD-HHMMSS.md` 推日期；推不出返回 `''` |
| 27 | 867 | `buildKanbanMatrixPre` | `(...)` | `Matrix` | 看板矩阵 |

**★ 全部是纯函数**（除 `rebuildSidecarIndexPre` 由调用方落盘，且仅 `boardMode='graph'` 时）。
⇒ **可以放心地在同步路径上高频调用**：无副作用、零 LLM、零网络。

> **★ 一处勘误（本轮自查）**：我最初把 `WB_ANCHOR_LINE_RE_PRE_V1` 记为 **588**、`WB_KANBAN_LANES_PRE_V1` 记为 **665**。
> 复测源码实际定义在第 **576** 行与第 **652** 行（`export const` 所在行）。**上表已改为真值。**

---

## 6. 与团队化的关系（判定）

**判定：S3 派生重算（sidecar 完全可重建）+ S2（Markdown 真源可共享）。**

理由：L9-L10 明文 —— *"index.json **完全可重建** …… **Markdown 文件是真源，sidecar 只是派生索引，丢了自愈重建**"*。
⇒ **同步 `index.json` 毫无意义**（各端本地重建即可，成本是纯词法扫描，无模型调用）。
⇒ 团队化要共享的是**真源 Markdown**（PLAN.md / 账本），**不是 sidecar**。若同步 sidecar，反而引入"两端派生物不一致"的**新分叉面**。

---

## 7. teamwork 改造点（附可直接复制的代码）

### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| WS1 | L9-L10 架构 | index.json 本地可重建 | **明确不同步**（团队共享真源 Markdown） | 纪律 |
| WS2 | `wbEntryIdPre` L78 | 三要素哈希 | 团队**不得**掺入 `actorId` / `groupId` | 纪律（否则同一条目两端 id 不同） |
| WS3 | `buildSidecarEntriesPre` L350 | 多节自动分节 | 团队共享文档**沿用同一分节口径** | 兼容 |
| WS4 | L16 | 仅 `boardMode='graph'` 写入 | 团队侧读取**同样只读 graph 产物**；legacy 下零写入不变 | 纪律 |
| WS5 | 新增 `teamProjectionOfSidecarPre` | 无 | 导出**可共享的最小投影**（不含本机绝对路径） | 新增导出 |
| WS6 | 团队召回 | 无 | 团队文档进入索引须**复用 `rebuildSidecarIndexPre`**，不另写派生 | 接线 |
| WS7 | `ws` 来源（见下） | **可能是本机绝对路径** | 改为内容寻址 `teamProjectIdOf` | **必修**（跨机阻断点） |

---

### 改造点 1 ★：`index.json` 绝不入同步（S3 派生重算）

**现状**：`index.json` 是投影，可由 Markdown 完全重建。

**为什么不能同步**：
1. 它是**派生数据**，同步会造成"同一事实两份副本"（违反单一真源）；
2. 两端 Markdown 若因任何原因不同步，索引会与内容**不一致**；
3. `mtime` 字段是**本机时钟**，跨机必然冲突（且 mtime 冲突无意义）。

```js
// lib/teamwork-sync-scope.js（新增）
/**
 * index.json 是 Markdown 的派生投影（S3）：只同步真源，索引本地重建。
 * 依据：lib/wb-sidecar.js:1-19 的设计声明「index.json 完全可重建」。
 */
export const SIDECAR_DERIVED_SUFFIXES = ['/index.json']

export function isDerivedSidecarPath(relPath) {
  const p = String(relPath || '').replace(/\\/g, '/')
  return SIDECAR_DERIVED_SUFFIXES.some((s) => p.endsWith(s))
}

/** 同步过滤：派生文件一律不出站。 */
export function filterSyncable(relPaths) {
  return (relPaths || []).filter((p) => !isDerivedSidecarPath(p))
}
```

**★ 但要同步一个例外**：`WB_SIDECAR_VERSION` **必须**随协作元数据走——
若 A 机 v1、B 机 v2，两者重建出的索引结构不同。
⇒ **版本号进"能力协商"，不进"文件同步"。**

---

### 改造点 2 ★：id 是现成的内容寻址键——直接拿来当同步主键

**好消息**：`wbEntryIdPre` **本来就是内容寻址**（`sha256(ws + '\0' + relPath + '\0' + title)`），
⇒ **不需要**为同步另造 id 体系，**直接用**。

**但有一个坑必须处理**：id 里含 `workspaceKey`（`ws`）。

| 情形 | ws 取值 | 跨机结果 |
|---|---|---|
| 正常 | 内容寻址的工作区 id | ✅ 一致 |
| **危险** | **本机绝对路径**（`D:\dsh-auto-memory`） | ❌ **两端 id 全不同** |

⇒ **必须确认 `ws` 的来源**。若 `ws` 是绝对路径，**这就是跨机同步的第一号阻断点**。

```js
// lib/teamwork-project-id.js（新增）
import { createHash } from 'node:crypto'

/**
 * 团队项目库 id：内容寻址，跨机稳定。
 * 依据：lib/wb-sidecar.js:78 wbEntryIdPre 的 ws 参数必须跨机一致，
 *       否则同一条目在两端算出不同 mem_id ⇒ 同步时被视为两条。
 * 用 remoteUrl 优先（最能标识"同一个库"），无则退化到规范化包名。
 */
export function teamProjectIdOf({ remoteUrl, pkgName, fallbackLocalKey }) {
  const basis = String(remoteUrl || '').trim()
    ? 'url:' + normalizeRemote(remoteUrl)
    : pkgName
      ? 'pkg:' + String(pkgName).trim()
      : 'local:' + String(fallbackLocalKey || '').replace(/\\/g, '/')
  return 'tp_' + createHash('sha256').update(basis, 'utf8').digest('hex').slice(0, 32)
}

/** 去掉凭据、统一大小写与 .git 后缀，避免同一远端两个 id。 */
function normalizeRemote(u) {
  return String(u || '')
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^[^@/]*@/, '')
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
    .toLowerCase()
}
```

**验收判据**（同一远端的不同写法必须算出同一 id）：

```js
const a = teamProjectIdOf({ remoteUrl: 'https://github.com/me/repo.git' })
const b = teamProjectIdOf({ remoteUrl: 'git@github.com:me/repo' })
const c = teamProjectIdOf({ remoteUrl: 'https://user:tok@github.com/me/repo/' })
console.assert(a === b && b === c, '项目 id 未归一 → 跨机去重会失败')
```

---

### 改造点 3 ★：可共享的最小投影（**白名单式**，不含本机绝对路径）

位置：`wb-sidecar.js` 文件末尾追加。

```js
/**
 * 生成可安全共享的 sidecar 投影 —— **白名单式**，新增字段默认不外传。
 *
 * 为什么必须白名单：sidecar 条目的字段会随契约演进而增加（L6 就补过 by_tag/by_cue/versions）。
 *   若用"排除法"，下一次新增字段会**默认外传**，而其中可能含本机路径。
 *   本仓既有教训（memory-anchor 的 origin 不进 digest、evidence 的隐私投影）都是同一思路。
 *
 * 为什么不传 source（绝对路径）：团队各端根目录不同（dsh-home.js:86 的根口径），
 *   绝对路径既无法互认，也属隐私面。团队只需要 relPath + title 就能定位。
 *
 * ★ 铁律口径：本函数**不产生任何外部依赖**（纯 JS、零 IO），
 *   不使用本函数也不影响既有功能 —— 团队化是**加法**，不是替代。
 */
export function teamProjectionOfSidecarPre(entries, opts) {
  const list = Array.isArray(entries) ? entries : []
  const cap = Number.isFinite(opts && opts.limit) ? Number(opts.limit) : 2000
  const out = []
  for (const e of list) {
    if (out.length >= cap) break
    if (!e || !e.id) continue
    out.push({
      id: String(e.id),
      // relPath 已是正斜杠（normalizeRelPathPre L57）⇒ 跨平台安全
      relPath: String(e.relPath || ''),
      title: String(e.title || ''),
      // tag / cue 都是确定性词法产物（extractTagsPre L35 / extractCuesPre L110），可安全外传
      tags: (Array.isArray(e.tags) ? e.tags : []).slice(0, 32).map(String),
      cues: (Array.isArray(e.cues) ? e.cues : []).slice(0, 32).map(String),
      // 泳道由 laneOfEntryPre L669 确定性派生 ⇒ 两端算出来必然一致
      lane: String(e.lane || ''),
      // 明确不含：source（绝对路径）、mtime（本机时钟）、任何 fs 相关字段
    })
  }
  return out
}
```

---

### 改造点 4 ★：P5 墓碑——本模块**已经实现了一半**

**发现**：`buildVersionsPre`（L453）已经在建**版本链**。

⇒ 与同步原语 **P5（墓碑）** 天然对接：**删除/撤回不需要真删，在版本链里追加一个墓碑节点即可**。

```js
// lib/wb-sidecar.js 的 teamwork 增量（追加，不改既有函数）
/**
 * 在既有版本链之上追加墓碑节点。
 * 复用 buildVersionsPre 的既有结构，只新增一条记录，不改变原字段语义。
 */
export function appendTombstonePre(index, entryId, kind, reason, clock) {
  const idx = index && typeof index === 'object' ? index : {}
  const versions = idx.versions || (idx.versions = {})
  const chain = versions[entryId] || (versions[entryId] = [])
  chain.push({
    id: entryId,
    kind: kind === 'retracted' ? 'retracted' : kind === 'superseded' ? 'superseded' : 'deleted',
    reason: String(reason || '').slice(0, 200),
    deletedAt: Number((clock && clock.wall) || Date.now()),
    device: String((clock && clock.device) || ''),
    seq: Number((clock && clock.seq) || 0),
  })
  return idx
}

/**
 * 与远端墓碑链合并（P5）：同一 id 取 deletedAt 较大者，其余全部保留。
 * 判据：交换输入顺序结果必须一致（见 04 卷附录 A.5 第 3 条）。
 */
export function mergeTombstonesPre(mine, theirs) {
  const out = new Map()
  for (const t of [...(mine || []), ...(theirs || [])]) {
    if (!t || !t.id) continue
    const prev = out.get(t.id)
    if (!prev || (Number(t.deletedAt) || 0) > (Number(prev.deletedAt) || 0)) out.set(t.id, t)
  }
  return [...out.values()]
}
```

**★ 与既有契约的一致性**：本插件的既有裁定是 **「`superseded` = 返回但标记，不剔除、不降权」**。
⇒ `mergeTombstonesPre` **只记录墓碑、绝不删除条目** —— 与那条裁定**完全一致**。

---

## 8. 铁律适配：Python 装不装，本模块行为必须不变

**先说清**：本模块**不含任何 Python 调用**（全文 0 处 `python` / 0 处 `spawn`），**唯一 import 是 `node:crypto`（L19）**（已实测确认）。
⇒ 它**天然满足**"Python 不影响 JS 端"这条铁律——**不是"已解耦"，是"从来没有耦合过"**。

### 铁律达标自检（本文件）

| 铁律条款 | 本模块实际状况 | 证据 |
|---|---|---|
| ① 不得"选一个"同时开关另一个 | **无任何开关**涉及 Python | 全文无相关配置读取 |
| ② 一个的存在不得成为另一个生效的前提 | **零仓内依赖**，Python 缺失时全功能照常 | L19 唯一 import |
| ③ 表述须为"两套可互换实现"，不得写成主从/兜底/降级 | **本文件无任何 JS/Python 主从表述** | "sidecar" 全部指本地索引，`★ 术语辨析表已列明 |

⇒ **结论：本模块是铁律的正面样本，无"需按铁律解耦"的改造点。**
⇒ **唯一要注意的不是代码，而是术语**：若后续有人把 `wb-sidecar` 与 Python sidecar 混为一谈，会在**无需联动的地方引入联动**（如"Python 不在就不写 sidecar"）—— 这正是要防的。

### 但一条精神同源的纪律要写死进团队版

```js
// lib/teamwork-capability.js（新增）
/**
 * 能力协商（Capability Negotiation）——不是"降级链"。
 *
 * 反例（严禁这样写）：
 *   if (!pythonAvailable) { derivedIndex = null; }   // ❌ 让一方成为另一方的前提
 */
export function capabilitiesOf({ pythonAvailable, boardMode, sidecarVersion }) {
  return {
    jsEngine: true,                                  // ★ 恒为 true，无条件
    pythonEngine: !!pythonAvailable,                 // 仅"是否装了"这一事实
    boardMode: boardMode === 'graph' ? 'graph' : 'legacy',
    sidecarVersion: String(sidecarVersion || ''),
  }
}

/** 派生索引是否可用：只看 boardMode，与 Python 无关。 */
export function derivedIndexEnabled(caps) {
  return !!(caps && caps.boardMode === 'graph')      // ← 刻意不读 pythonEngine
}
```

**判据**：`derivedIndexEnabled` 的函数体**不得出现 `pythonEngine`**。可做成静态守卫：

```js
// tests/smoke/smoke-test-teamwork-sidecar-independence.mjs（建议新增）
import fs from 'node:fs'
const src = fs.readFileSync('lib/teamwork-capability.js', 'utf8')
const i = src.indexOf('function derivedIndexEnabled')
const fn = src.slice(i, src.indexOf('}', i) + 1)
if (/pythonEngine/.test(fn)) {
  throw new Error('铁律违规：派生索引开关读了 pythonEngine（两引擎被联动）')
}
console.log('sidecar independence OK')
```

---

## 9. 风险与守卫

| # | 风险 | 触发条件 | 影响 | 缓解 / 现有守卫 |
|---|---|---|---|---|
| R1 | `ws` 取自本机绝对路径 | 未做内容寻址 | **两端 id 全不同 ⇒ 同步时条目翻倍** | 改造点 2 的 `teamProjectIdOf`；**必修项** |
| R2 | **write 与 rebuild 算出不同 id** | 任一侧改了路径/标题规范化 | **"完全可重建"当场失效**（BUG-10 的失败模式） | L11-L14 契约 + `wbRefPre`（L97，*"write 与 rebuild 的唯一构造口径"*）；**唯一入口**原则 |
| R3 | **id 掺入团队身份**（actorId/groupId） | 为"区分来源"改 `wbEntryIdPre` | 同一条目在 A/B 端两个 id ⇒ 团队索引无法归并 | WS2 纪律；回归断言"仅改 actorId 时 id 不变" |
| R4 | **整篇 PLAN 被压成 1 张卡** | 单卡函数被多节文档复用 | 用户可见的**「白板只剩一行」**；索引与看板 id 集合不相交 | L334-L344 的修复 + `buildSidecarEntriesPre`（L350）为**两条路径唯一分节出口** |
| R5 | **分节改动波及单节文档** | 顺手把分节逻辑套到账本 | 账本（四段式，恰好单节）行为变化 ⇒ 既有守卫红 | L343-L344 **向后兼容铁律**；回归须断言"单节文档逐字节不变" |
| R6 | **侧车被纳入团队同步** | 同步框架"顺手"同步 `index.json` | 两端派生物不一致 ⇒ 新分叉面（且它**本可重建**，纯属浪费） | 改造点 1；白名单须显式排除 `index.json` |
| R7 | **投影泄露本机绝对路径** | 用"排除法"构造共享投影 | 路径不可互认 + 隐私泄露 | 改造点 3 白名单（只出 id/relPath/title/tags/cues/lane，**不含 source/mtime**） |
| R8 | **legacy 模式产生写入** | 团队化新增调用未过 `boardMode` 门 | 违反 L16 *"legacy 模式下零文件写入"* | WS4 纪律；回归覆盖 legacy 负路径 |
| R9 | **tag/cue 提取被换成 LLM** | 为"更准"引入模型 | 破坏 L15 *"零 LLM"* 的确定性 ⇒ 两端 tag 集合不一致 | L15 明文纪律；`extractTagsPre` / `extractCuesPre` 保持纯词法 |
| R10 | **两端 `WB_SIDECAR_VERSION` 不同** | 版本升级不同步 | 索引结构不兼容、静默错读 | 版本进能力协商；**版本不等时不合并索引，各自重建** |
| R11 | `mtime` 参与同步判定 | 图省事用 mtime 判新 | 跨机时钟漂移导致误判 | **mtime 一律视为本机字段，不出站** |
| R12 | 墓碑合并被写成"保留较旧" | 比较方向写反 | 撤回被覆盖、错误复活 | `mergeTombstonesPre` **取 deletedAt 较大者**；配交换律测试 |

**既有守卫（本文件相关）**：
- *"既有套件断言 `rebuildSidecarIndexPre('ws', 2 docs).entries.length === 2`，改动即回归"* —— **源码 L142 逐字记载**。
  ⇒ 这是**硬锁**：任何改动 `rebuildSidecarIndexPre` / `buildSidecarEntriesPre` 的行为都必须先复核该断言。
- L343-L344 的向后兼容铁律（单节文档行为逐字节不变）对应一组账本类用例。
- `collectAnchorIdsPre`（L628）在注释里明写用于 *"lint / 一致性检查"* ⇒ 锚点一致性有检查通道。

**建议补的三条守卫**：
1. **零仓内依赖守卫**：静态断言 `wb-sidecar.js` 的 import 只有 `node:crypto`（L19）——把"JS 端自足、不依赖 Python"钉成可验证事实。**当前无此守卫**。
2. **Python 缺失行为不变**：在无 Python 环境下跑本模块全部导出，断言输出与有 Python 时**逐字节相同** ⇒ 比文档声明更可靠的硬证据。
3. **单节文档逐字节不变**：`buildSidecarEntriesPre`（L350）对"无 `##` / 仅一个 `##`"输入的输出，与 `buildSidecarEntryPre`（L302）单卡输出数组形态**完全一致**。

---

## 10. 一句话总结

`wb-sidecar` 是**本仓最适合同步的模块**——
**内容寻址 id**（`wbEntryIdPre`）、**纯函数零 IO**、**零 LLM**、**已有版本链**（`buildVersionsPre`）四条优点全部现成。
**唯一必须先修的**是 **`ws` 的来源**（R1）：只要 `ws` 是机器绝对路径，
前面所有优点都会被"两端 id 全不同"**一次性抹平**。
