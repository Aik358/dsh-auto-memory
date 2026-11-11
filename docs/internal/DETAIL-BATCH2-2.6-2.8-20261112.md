# 批次 2 · 2.6 / 2.7 / 2.8 可执行施工细则（2026-11-12 · v3）

> **性质**：纯文档。**不改任何生产代码**、不做 2.3/2.4/D4、不碰真实记忆、不 commit。
> **读者**：接手的执行者。本文代码事实**全部由本文作者在当前工作树上实测**，行号为当前基线。
> **基线（当前工作树）**：`lib/index.js` **2,162,687 B / 29,759 行 / CRLF 29,758 / 裸 LF 0 / IX 1,608,289 / sha16 `39C81F8F96025886`**；`lib/event-write.js` **866 行**。
> **v3 修订**：Lead 第二轮复核的四点 + 第三轮两点已全部并入；§0.2 是逐条对照表（含 v1/v2 被否决项与 v3 改法）。**被否决的写法只出现在对照表里，正文不再执行。**

---

## 0. 前置纠偏

### 0.1 不再继承的四个旧快照

| 旧说法 | 当前实测 | 影响 |
|---|---|---|
| `memory_note` 有 17 / 19 个参数 | **23 个属性行 / 22 个不同键**（`expectedRevision` 定义了两次，见 U-1） | 按参数个数写的断言会错 |
| 没有 `documentId` ⇒ 一律走旧 `handoff-*.md` | **R4-on 不再走旧路径**：`documentId` / `maintenanceTopic` 确定性 id / 否则明确拒绝；只有 **R4-off** 才走旧账本 | 2.6/2.7 的写入分支前提变了 |
| 维护文档写入「无入口」 | 已有 `createDocument` / `upsertDocument`（CAS + WAL）+ `trustedMemoryRoot` 显式受控授权 | 可与 2.6/2.7 共用同一 CAS/WAL 语义 |
| 2.6 落点是 `event-write.js:696-762`「唯一入口」 | `appendHandoffCheckpointPre` 在 **`:696`**，但**不是**唯一入口：`mirrorPlanSectionsPre`（`:777`）另有路径，`memory_log` 是内联 IIFE | 只改一个函数会漏 |

### 0.2 v1 被否决的写法与 v2 的改法

| # | v1 的错误 | v2 改为 |
|---|---|---|
| 1 | 说「`appendEventNotePre` 只复用适配层即可」 | **错**：`event-write.js:737` 重建 `ckPayload`，`opts.panels` / `opts.revision` **不会透传**（实测两词在该文件 0 命中）。v2 §2.3 给出**受限扩展**的精确做法 + 不变量 |
| 2 | 「摘要失败 ⇒ 降级为全文」 | **错**：与 P-2 的缺项判据冲突，且等于静默恢复全文。v2 改为**一律显式报错**（§1.2 / §3.2） |
| 3 | 混用 `computeRevision` 与 `sha16` 两种口径 | v2 §1.2 明确 **sha16 必须是 `computeRevision` 的十六进制前 16 位**，四段复用既有字段 |
| 4 | 2.8 的 `PREKNOWN_CODES` 含 `criteria`/`mutation` 等 6 项、且未定 Phase 0 位置 | v2 §1.3 按**真实 13 条失败标记取证**收窄，并**按字段来源拆成 `PREKNOWN_CODES`（r.error）与 `PREKNOWN_GATES`（r.gate）两组**（单一数组比对 r.error 会让 7/13 永远命中不了）；Phase 0 固定在 Phase 1 **之前**；A1 新分支**不得重复第二套门** |
| 5 | 「必须新增 `planEventId`/`handoffEventId` 两个配置」 | v2 §1.1 改为**每工作区显式容器** 或 **待裁定 gate**，不写「必须 2 个」，并指出第二归属源风险 |
| 6 | `pointer-missing` 的 `recent` 用 `path.join` 自行拼 | v2 §1.4 要求**依赖注入 `fs` + `fileWithinRoots` 边界**，并加真执行验收 |
| 7 | U-1 混在正文里、U-3/U-6 未定却进了施工 | v2 把 U-1 独立成节（§6.1）、U-3/U-6 标 **gate（未定不得施工）**（§6.2） |

---

### 0.3 v2 → v3 的六处修订（Lead 二/三轮意见）

| # | v2 的问题 | v3 改法 | 位置 |
|---|---|---|---|
| 1 | 把摘要当 `ledgerText` 传下去，适配层会**重新解析**它 ⇒ 四段丢失 | 四段**只从原始全文** `parseLedgerSectionsPre(raw)` 解析；摘要**仅**用于 `checkpoint.text`；受限扩展增加 `opts.sectionsOverride` | §3.2 调用图 + §2.3 不变量 ⑦⑧ |
| 2 | §1.2「全空拒绝」与「部分空允许」自相矛盾 | 统一为：**允许 + 打 `missing=<段名>` 标记**（与今天兼容）；**严格缺段校验归 2.9**；解析前**先剥 eventId** | §1.2 |
| 3 | §2.3 顶层透传 `revision` 与「不新增检查点顶层字段」冲突 | **去掉 revision 顶层**，一律进 `panels: revision=…`；`panels.kind` 限定既有枚举 `state/log/deadend/next/goal` | §2.3 |
| 4 | `deps.readCheckpoints(eventId)` 未写进 deps 合同 | deps 合同固定为 `{ fs, handoffDir, roots, readCheckpoints(eventId, kind) }`，并在 §1.4 写明返回形状与过滤规则 | §1.4 |
| 5 | P-4 宣称「逐字节等于真源」 | `normalizeText` 会剥行尾空格 ⇒ **不可能逐字节**。改为**规范化等价**判定 drift + `rawsha256` 独立记录/校验；跨工具 CRLF 明确定义为 `pointer-line-ending-changed`（仅告警） | §1.4 |
| 6 | 声称「已有锁」但未核实 create 与 append 是否同一临界区 | 已实测二者**同一实现**（`event-store.js:601-604` 与 `:577-582`），并**额外**规定不得嵌套 + 加两进程真实竞争与死锁哨兵用例 | §2.4 + §3.1 B26-B1/B2 |

## 1. 共同骨架：四条成文协议（P-1 ~ P-4）

### 1.1 P-1 归属协议

```
输入：{ kind:'log'|'handoff'|'plan', content, eventId?, workspaceKey, store }
输出：{ ok:true, eventId, source:'explicit'|'container'|'created'|'fallback' }
      { ok:false, code:'event-id-unavailable'|'container-config-invalid' }

判定顺序（严格按序，命中即停）：
  ① 显式 eventId 且事件存在且 status ∈ {active, paused}        ⇒ source='explicit'
  ② 显式 eventId 但不存在 / 已 closed                            ⇒ 不静默改挂，返回 event-id-unavailable
  ③ 该工作区的显式容器事件（见下）                                ⇒ source='container'
  ④ 库内无任何 active 事件                                        ⇒ createEventForWorkPre ⇒ source='created'
  ⑤ 其余                                                          ⇒ resolveActiveEventPre 的 updatedAt 最大者 ⇒ source='fallback'
```

**明确禁止**（依据 SURVEY §2.2.3 实测）：
- ❌ 对 `kind ∈ {handoff, plan}` 使用 **L1 标识 / 强负证据 / 0.34 词袋门**。200 条全文检查点里 **18.5%（37/200）零标识**、有标识的 163 条里 **98 条（60.1%）与全部带标识事件零交集**、**31 条（19.0%）命中 >1 个事件**（max fanout 24）。搬过去 ⇒ **60%+ 的账本/白板各建一个新事件**。
- ❌ 用「最近文档」反推事件。

**容器事件：两种可选形态，二选一，不得同时启用**

| 形态 | 存放位置 | 优点 | 风险 |
|---|---|---|---|
| **A. 每工作区显式容器** | 工作区侧配置文件（与 `dsh-auto-memory.json` 同级的工作区级配置），键 `containerEventId`，作用域 = 单个 `workspaceKey` | 不污染全局配置；一个工作区一件事 | 需要定义工作区级配置的读写路径与迁移（**目前不存在**） |
| **B. 待裁定 gate** | 未定 | — | — |

**v2 的结论**：形态 A 需要新增「工作区级配置」这一层设施（当前仓只有全局 `config`），**成本未评估** ⇒ **列为 gate G-1，未裁定前 2.6 只实现 ①②④⑤ 四条，③ 留空**（即 `source` 永远不会是 `'container'`）。这样 2.6 可以独立验收，且**不引入第二归属源**。

> ⚠ **第二归属源风险（必须记）**：若同时存在「全局 `config.handoffEventId`」与「工作区级 `containerEventId`」，同一份检查点的归属将取决于读取顺序 ⇒ 必须**只能有一个真源**。v2 明确：**在 G-1 裁定前，一个都不加**。

### 1.2 P-2 正文协议

```
kind = 'log'      ⇒ text = 正文原文（不截断、不摘要）
kind = 'handoff'  ⇒ text = 摘要（长度上限见 G-2），四段写进既有 checkpoint 字段
kind = 'plan'     ⇒ text = 摘要；四段**允许全空**（plan 无账本四段标题是正常形态）
```

**摘要必须携带的 5 项**（全部落在**既有字段**，不新增检查点顶层字段、不建第二副本）：

| # | 项 | 落点（既有字段） | 缺失时 |
|---|---|---|---|
| 1 | 四段 `goal/state/dead/next` | `checkpoint.goal / .state / .dead / .next`（`event-write.js:731-736` 已在写） | **handoff 缺段 ⇒ 预检失败**（见下）；**plan 缺段 ⇒ 合法**，四段留空串 |
| 2 | 真源相对路径 | `checkpoint.sourceRef`（既有字段，`:737` 已写，值取 `opts.ledgerPath`） | `null`（不猜） |
| 3 | 内容指纹 `sha16` | `checkpoint.panels` 中 `{kind:'log', text:'sha16=<16hex>'}` | **失败**（不得缺） |
| 4 | `bytes` | 同上 `bytes=<n>` | **失败** |
| 5 | `revision` | 同上 `revision=sha256:<64hex>`（**仅当真源是 R4 维护文档时**） | 旧 `.md` 真源没有 R4 revision ⇒ **不写该键**（不是失败） |

**口径统一（v1 的混用已消除）**：

```
唯一口径：normalizeText() → 把第 7 行 revision: 置空 → sha256(整篇)
  · normalizeText（protocol.js:58-63）：剥 BOM、CRLF→LF、**剥行尾空格与 Tab**
  · computeRevision（protocol.js:91-96）：= sha256(normalized with revision line cleared)
  · sha16 := computeRevision(text) 的 hex 部分的**前 16 位**（不是另外算一遍原文字节）
```

❌ **禁止**：对**原始未归一化**文本直接 `sha256(...).slice(0,16)`。行尾空格或 CRLF 会让两者不一致，导致 P-4 回读误判 `pointer-drift`。

**失败语义（v1 的「摘要失败回退全文」已删除；缺段判定按既有兼容处理）**

**前置：先剥离 eventId 再验四段**

```
parseLedgerSectionsPre(原文) 之前必须先去标识：
  ① 从正文剥掉 `eventId=evt_xxxxxxxx` / `#evt_xxxxxxxx` / 行内 evt_ 标识（既有 L1 标识抽取的同源正则）
  ② 只用**剥离后**的正文解析四段
  ③ 为什么：标识行可能落在某个 `## 段落` 里，不剥会让该段的正文首行变成标识串；
     更关键的是——不下心把标识当正文内容判空/非空，会让「部分空」的判定随标识存在与否漂移。
```

| 场景 | v2 行为 |
|---|---|
| handoff 四段**部分空**（1~3 段有值） | **允许**（既有兼容，今天 `parseLedgerSectionsPre` 空段返回空串）；同时**打标记** `panels: missing=goal,next`（列出缺的段名，**显式可观测**，不静默） |
| handoff 四段**全空** | **不拒绝写入**（既有兼容：今天也是这样落盘的），但必须打 `panels: missing=goal,state,dead,next` ⇒ **可观测**。**严格「缺段即拒写」的校验归 2.9**，2.7 不做 |
| plan 四段全空 | **合法**（plan 常态），摘要照写，**不打 missing** |
| sha16 / bytes 计算失败 | `{ok:false, code:'summary-failed'}` ⇒ **不落盘**（不静默存全文） |
| 摘要超长 | 截断到上限并记 `panels: truncated=1`（**显式标记**，不静默） |

> **为什么改成「允许 + 标 missing」而不是「拒绝」**：v2 前一版写「全空即拒绝落盘」，与同表「部分空允许」互相矛盾（全空只是部分空的特例），且会**改变既有写盘行为**（今天全空也照写）。按兼容优先：2.7 只做**正文形态降级**，不做**判据收紧**；「缺段即拒」是 2.9 的职权。

> 原则不变：**宁可拒绝写入，也不静默把全文塞回检查点** —— 该原则只适用于「指纹算不出」（`summary-failed`），不适用于「四段空」。

### 1.3 P-3 可预期失败前置协议

**PREKNOWN_CODES：按真实数据取证收窄**

取证：真实快照 `artifacts/_attr-realistic-20261110/data/event-store.snapshot.json`（3,216,982 B）里 `/-write-failed$/` 的检查点共 **13 条**，逐条解析失败原因：

**关键区分（v1 混为一谈，v2 拆开）**：Phase 3 的 reason 取自 `_failReason = String((r && (r.error \|\| r.gate)) \|\| '未知')…`（`lib/index.js:25646`）—— **先取 `error`，没有才取 `gate`**。所以失败标记里的「原因」文本其实来自**两个不同命名空间**：

| 命名空间 | 真实取值（源码实测） | 在 13 条里的条数 |
|---|---|---|
| `r.error`（错误码） | `plan-version-conflict` / `plan-card-format` | **5 / 1** |
| `r.gate`（门名） | `criteria`（源码 `:5975` `{ok:false, gate:'criteria', error: criteriaRefusalTextPre(crit)}`） | **7** |
| 合计 | — | **13** |

| 实际 reason 文本 | 条数 | 首次 | 末次 |
|---|---|---|---|
| `plan-card-format` | **1** | 2026-10-25T12:48:53Z | 同 |
| `plan-version-conflict` | **5** | 2026-10-27T08:12:09Z | 2026-11-08T23:22:08Z |
| `写入被判据门拦截（H1）…` / `（H1/H2）…` ⇒ gate=`criteria` | **6 + 1 = 7** | 2026-10-30T18:28:41Z | 2026-11-09T08:37:22Z |

⇒ **v2 白名单必须按「字段来源」分别写，不能混成一个字符串数组**：

```
const PREKNOWN_CODES = Object.freeze(['plan-version-conflict', 'plan-card-format'])   // 比对 r.error
const PREKNOWN_GATES = Object.freeze(['criteria'])                                  // 比对 r.gate
命中判据：PREKNOWN_CODES.includes(r.error) || PREKNOWN_GATES.includes(r.gate)
```

> 若只用单一数组 `['plan-version-conflict','plan-card-format','criteria']` 去比对 `r.error`，`criteria` **永远命中不了**（它是 gate 不是 error）⇒ 7/13 的失败仍会污染事件库。这正是 v1 的实质缺陷。

源码里另有 `gate: 'mutation'` 与 `gate: 'not-applicable'`，但**13 条真实失败里 0 条**，故**不进白名单**（未知 ⇒ 留痕）。

**v1 里被删掉的三项**：`mutation`（M1/M2/M3）、`plan-card-duplicate-id`、`plan-user-region-protected` —— **13 条真实失败里一条都没有**。它们是否可预期**未取证**，因此**不进白名单**（未知 ⇒ 走 Phase 3 留痕，保守姿态正确）。

**Phase 0 的位置（v1 未定，v2 固定）**

```
memory_note(kind=handoff|plan)：

  【A1 新分支】args.documentId 或 maintenanceTopic 且 DSH ledgerDocEnabled=true
      → 已有自己的拒绝序列（shape → start → readDocument → revision/CAS → changeSet → upsert）
      → **Phase 0 不得在此重复第二套门**（否则同一失败有两个判定源，且可能与 R4 语义冲突）

  【旧路径】R4-off，或 kind=plan
      Phase 0 预检（★ 必须在 Phase 1 之前）
         ├─ 命中 PREKNOWN_CODES ⇒ return 门禁回执，**事件检查点 +0**
         └─ 未命中 ⇒ Phase 1 → Phase 2 → Phase 3（未知失败仍留痕）
```

> **A1 与 2.8 的边界**：A1 已经用「可预期拒绝零事件副作用」实现了同一目标（A1W-13 六类拒绝零增量）。2.8 的实施范围**仅限旧路径（Phase 0 位置在 Phase 1 之前）**，**不得**触碰 A1 分支——否则就是「重复第二套门」。

### 1.4 P-4 指针回读协议

```
readPointerPre(deps, { sourceRef, expectedSha16 })
  deps = { fs, handoffDir, documentsDir?, roots }   ← **依赖注入，函数内不做任何 path.join 拼接**

成功 ⇒ { ok:true, text, bytes, sha16, physicalPath }
失败 ⇒ { ok:false, code:'pointer-missing'|'pointer-drift'|'pointer-unsafe'|'pointer-legacy', ... }
```

**路径安全（v1 的自行 `path.join` 已删除）**

```
① sourceRef 必须是**相对路径**且不含 '..'（拒绝绝对路径与穿越）
② 解析出的候选路径必须过 fileWithinRoots(candidate, deps.roots, { strict:true })
     · fileWithinRoots 语义（lib/file-boundary.js:88-103）：realpath 归一 + 每个根 realpath 后组件级 relative 四联；
       strict:true ⇒ 等于根本身也拒；根不可解析 ⇒ 该根不放行任何东西
③ 不过 ⇒ pointer-unsafe（**不尝试第二路径**，不回落到 handoffDir 根）
④ 文件读取一律走 deps.fs（注入），便于测试替身与只读沙箱
```

**`pointer-missing` 的 `recent`（v1 未给依赖，v2 固定）**

```
readPointerPre 的 recent 分支：
  · 数据来源 = 调用方传入的 deps.readCheckpoints(eventId)（**注入**），不在本函数里读事件库文件
  · 过滤：kind 相同、sourceRef 非空、按 at 倒序取前 3 条
  · 每条**只回元数据**：{ at, kind, sourceRef, sha16 } —— **不回正文**（避免把无指针内容当全文返回）
```

**口径（Lead 第三轮校正）**：`normalizeText` 会 **剥 BOM、CRLF→LF、剥行尾空格与 Tab** ⇒ 回读**不可能**与原 raw 文本逐字节相同。所以：

```
判定口径（唯一）：
  normalizedEqual = normalizeText(回读text) === normalizeText(真源text)      ← 内容等价，不是逐字节
  原文指纹        = rawsha256 = sha256(**真源原始字节，未归一化**)          ← 独立记录，独立校验

两个值都在 panels 里，各管一件事：
  panels: sha16=<computeRevision 口径的 16 位>     ← 与 revision 同源，用于 R4 文档一致性
  panels: rawsha256=<原始字节的 64 位>             ← 用于「文件有没有被跨工具改过」
  panels: bytes=<原始字节数>                       ← 归一化前后都可能不等，必须标原始
```

**跨工具 / 跨平台 CRLF 必须写明**：

| 场景 | 表现 | 判定 |
|---|---|---|
| 编辑器把 LF 存成 CRLF（或反之） | `normalizeText` 后**完全相同**，`rawsha256` **不同** | `normalizedEqual=true` + `rawsha256` 不匹配 ⇒ **报 `pointer-line-ending-changed`（新 code，仅告警级别，不判 drift）** |
| 编辑器剥掉行尾空格 | 同上 | 同上 |
| 内容真被改（增删字/改词） | `normalizeText` 后**不同** | 报 `pointer-drift`（**真失败**） |

> 结论：`pointer-drift` 只能用**规范化等价**判定；`rawsha256` 只用于区分「只是行尾/空白变了」还是「内容真变了」。**不得**用 `rawsha256` 判 drift —— 否则一次 CRLF 转换就会被误判成篡改。

**五种结果（含两个新增 code）**


| code | 判据 | 处置 |
|---|---|---|
| `pointer-missing` | `fileWithinRoots` 通过但文件 ENOENT | 返回 `recent`（最多 3 条元数据）+ `sourceRef`；**不返回空串冒充成功** |
| `pointer-drift` | `normalizeText(回读) !== normalizeText(真源)`（**内容真变了**） | 回显 expected/actual 的 `sha16` 与 `rawsha256`；**不返回别的版本** |
| `pointer-unsafe` | `sourceRef` 绝对路径 / 含 `..` / 越界 | 直接拒，**不做任何 IO** |
| `pointer-legacy` | 无 `sourceRef` 的存量检查点 | 原样返回其 `text`（保持今天的召回行为），**不回填** |
| `pointer-line-ending-changed` | `normalizedEqual=true` 但 `rawsha256` 不等（跨工具 CRLF / 剥行尾空格） | **仅告警**，不判 drift；回读照常返回（内容等价） |

### 1.5 四条协议的可执行断言

| 协议 | 断言 | 类型 |
|---|---|---|
| P-1 | plan/handoff 的 `eventId` ∈ {explicit, container, created, fallback} 之一；**G-1 未裁定前不得出现 'container'** | 行为 |
| P-2 | 新写入的 plan/handoff 检查点 `text.length ≤ 上限`；`panels` 必含 `sha16=`/`bytes=` | 物理量 |
| P-2（可观测） | handoff 四段**全空或部分空** ⇒ 照常落盘，但 `panels` 必含 `missing=<缺失段名列表>`；plan 全空**不打** missing | 物理量 |
| P-3 | 命中 `PREKNOWN_CODES` ⇒ 事件库**字节数与检查点数双零增量** | 物理量 |
| P-4 | 降级后 `readPointerPre` 返回 text 与真源**规范化等价**（`normalizeText(回读) === normalizeText(真源)`），且**原始字节的 sha256 单独记录在 `panels: rawsha256=`** 并据此校验；**不得**宣称与原 raw 文本逐字节相同 | 行为 |

---

## 2. `appendEventNotePre` —— 真实 API 合同

### 2.1 参数

| 参数 | 类型 | 必填 | 缺省 | 说明 |
|---|---|---|---|---|
| `storePath` | string | ✅ | — | 事件库绝对路径 |
| `kind` | `'log'\|'handoff'\|'plan'` | ✅ | — | 决定 P-2 正文策略 |
| `content` | string | ✅ | — | **全文**（内部按 P-2 决定存全文还是摘要） |
| `eventId` | string | ❌ | `undefined` | 显式归属 |
| `sourcePath` | string | ❌ | `null` | 真源相对路径（P-2 的 `sourceRef`） |
| `ledgerPath` | string | ❌ | `null` | **仅兼容**：透传给 `appendHandoffCheckpointPre` 的 idemKey 源串 |
| `percept` | object | ❌ | `{}` | `{userPercept, agentTrace, sharedGround, commitment}` |
| `idemKey` | string | ❌ | `kind + ':' + sha1Hex12(content)` | 幂等键 |
| `today` / `boundaryMinutes` | string / number | ❌ | `undefined` | 透传给建事件 |

### 2.2 返回形状

```
成功：{ ok:true, eventId, checkpoint:{ mode:'full'|'summary', kind, text, sourceRef, idemKey, id, at },
        deduped:boolean, attribution:{source}, sections:{goal,doing,deadend,next} }
失败：{ ok:false, code:'content-empty'|'summary-failed'|'event-id-unavailable'
                    |'attribution-failed'|'append-failed', cause?, eventId? }
```

入参非法（`storePath` 缺失 / `kind` 不在枚举 / `content` 非字符串）**才抛** —— 与 `appendHandoffCheckpointPre:697-699` 风格一致。

### 2.3 与 `appendHandoffCheckpointPre` 的接线（**含受限扩展，v1 的「只复用即可」已作废**）

**实测事实（这决定了必须扩展）**：

```
event-write.js:737
  const ckPayload = { kind, at, text: ledgerText, sourceRef: opts.ledgerPath ? ... : null,
                      idemKey, ..._quad }
⇒ 只取 opts.ledgerPath 一个可选输入；opts.panels / opts.revision **全部被丢弃**（该文件 0 命中）
```

所以**只调它、不扩展**的话，P-2 的 `panels`（sha16/bytes/revision）**必然丢失**。

**受限扩展（唯一允许的改动）**

```
在 appendHandoffCheckpointPre 的 ckPayload 构造处，追加**两个**可选透传（都不传 ⇒ 逐字节同今天）：
  panels: Array.isArray(opts.panels) ? opts.panels.map(sanitizePanelPre).filter(Boolean) : undefined
  ⇒ **只加 panels**。**不加** `revision` 顶层字段（理由见下）。

  为什么去掉 revision 顶层：
    · 它与本文 §2.5「不新增检查点顶层字段」直接冲突（同一份文档里自相矛盾）
    · revision 只是「这份 .md 当时的 R4 版本号」，属于**指针信息**，不是检查点语义
    · ⇒ 一律放进 panels：`panels: revision=sha256:<64hex>`，由 P-4 回读时读取
    · 顶层 `checkpoint` 形状因此**与今天完全一致**（kind/at/text/sourceRef/panels/idemKey + 四段）

sanitizePanelPre(p)：
  · p 必须是 { kind, text } 形状，text 为非空字符串
  · **kind 只允许既有枚举**：'state' | 'log' | 'deadend' | 'next' | 'goal'
    （依据：event-render.js:362 `const pKind = String(pn.kind || 'log')` —— 它只是**显示标签**，
     源码并不校验；正因如此**本层必须自己收口**，否则任意标签会污染面板泳道归类）
  · 不合规 ⇒ 丢弃该 panel 并记 diag（**不抛**，不影响落盘）

不变量（必须逐条守住，且每条配断言）：
  ① text 仍是 opts.ledgerText（本扩展不改变 text 的取值路径）
  ② idemKey 仍由 keySrc + kind 前缀生成（:713 / :721）⇒ 幂等行为不变
  ③ 四段 _quad（:731-736）保持；panels 只**追加**，不覆盖四段
  ④ 四类感知仍在同一 eventStorePre.append 事务内（:745-750）⇒ 原子性不变
  ⑤ 既有 6 个调用点（不传 panels）行为**逐字节相同**
  ⑥ 检查点**顶层键集合**与今天完全一致（本扩展只往 panels 里塞东西）
  ⑦ 新增可选的 `opts.sectionsOverride`（见 §3.2 的四段通道）：提供时 _quad 直接用它、**不再 parse ledgerText**；不提供时逐字节同今天
  ⑧ 允许的透传因此是 **2 个**（`panels` + `sectionsOverride`），**仍不加任何检查点顶层字段**
```

**明确禁止**：
- ❌ 在 `appendEventNotePre` 里自己拼 `ckPayload` 再调 `eventStorePre.append`（会绕过 `:751-760` 那段「handoff 只追加检查点、不镜像 sections」的真缺陷修复）。
- ❌ 复制 `appendHandoffCheckpointPre` 的任何保护逻辑（幂等、四段、percept 事务）。

### 2.4 锁 / 并发 / 失败时序

**实测核查（不是声称）**：

| 观察点 | 实测 |
|---|---|
| `createEventForWorkPre`（`event-write.js:285`） | `return withEventStoreLockPre(storePath, () => createEventForWorkUnlockedPre(...))` |
| `eventStorePre.append`（`event-store.js:942`） | `return mutatePre(storePath, …)` |
| `mutatePre`（`event-store.js:601-604`） | `withStoreChainPre(storePath, () => withStoreFileLockPre(storePath, () => mutateUnlockedPre(...)))` |
| `withEventStoreLockPre`（`event-store.js:577-582`） | `withStoreChainPre(storePath, () => withStoreFileLockPre(storePath, run))` |
| ⇒ 结论 | **是同一个临界区实现**（同一 `_storeWriteChains` Map、同一 `acquireSharedStateLock(<storePath>+'.lock')`），**且顺序相同**（先进程内链、后跨进程文件锁） |

> 这一点有源码注释佐证：`event-store.js:602` 逐字写「★#492：与 withEventStoreLockPre **同一条** 链+锁顺序（两处判据必须一致，否则半修）」。

**但「实现相同」≠「不会死锁」** —— 嵌套调用必须单独验证：

```
若 appendEventNotePre 的实现是：
  withStoreChainPre(...) { 内部再调 createEventForWorkPre }   ← 嵌套 withStoreChainPre 同一 key
会**自己等自己**：内层排到外层 tail 之后，外层又在等内层 ⇒ 死锁（直到跨进程锁超时）。

本细则的合同要求：
  · appendEventNotePre **不得**自己再包一层 withEventStoreLockPre/withStoreChainPre
  · 归属解析（需要读 store）用 **readStorePre（只读，不持链）**
  · 建事件用 createEventForWorkPre（它自己持一次链），**解析与建事件不得嵌套在同一链内**
  · 最终落盘用 appendHandoffCheckpointPre → eventStorePre.append（它自己持一次链）
  ⇒ 一次 appendEventNotePre 调用最多**串行**进 2 次临界区（建事件 1 次 + 落盘 1 次），**不嵌套**
```

| 环节 | 机制 | 依据 |
|---|---|---|
| 同 storePath 并发 | 既有串行链（create 与 append **同一实现**，已实测） | 不新增锁 |
| 跨进程 | `withStoreFileLockPre` → `acquireSharedStateLock(<storePath>+'.lock', {timeoutMs})` | 不新增锁 |
| 嵌套 | **禁止**（见上）；由 B26-B1 死锁用例守 | 本细则新增约束 |
| P-1 失败 | 不写，return `attribution-failed` / `event-id-unavailable` | 零副作用 |
| P-2 指纹失败 | 不写，return `summary-failed` | 不回落全文 |
| 落盘失败 | 异常由调用方捕获并如实回报 | 与现有 Phase 1 catch 一致 |

> ⚠ 若实施时发现「一次调用需要同时建事件 + 落盘且必须在同一临界区内」，**先停下来报告**，不要自行加锁 —— 那会引入第二套锁语义。

### 2.5 配置 / 工具 / 路由（**默认不加**）

| 项 | 结论 | 理由 |
|---|---|---|
| 新配置项 | **G-1 裁定前一个都不加** | 见 §1.1；加了就形成第二归属源 |
| 新工具 | ❌ 不加 | `memory_note`/`memory_log`/`memory_event` 已覆盖 |
| 新 HTTP 路由 | ❌ 不加 | `hostRoute` 现状为 `null`，本文不改 |
| 新事件顶层字段 | ❌ 不加 | `EVENT_TOP_FIELDS` 是 26 字段 fail-closed 契约 |
| 新检查点顶层字段 | ❌ 不加 | 复用 `panels` + 既有四段 |

---

## 3. 分项施工细则（串行，**共同骨架 ≠ 一次实现三项**）

### 3.0 顺序

```
本文（P-1~P-4 + appendEventNotePre 合同）评审通过
   ↓ 2.6（归属）—— 独立验收
   ↓ 2.7（摘要+指针）—— 独立验收
   ↓ 2.8（失败前置，仅旧路径）—— 独立验收
   ↓ 2.3（只读提案）启动；2.4 保持冻结
```

### 3.1 2.6 —— 写入口归属统一

**允许写域**：`lib/event-write.js`（新增 `pickAttributionPre`；**不改** `appendHandoffCheckpointPre` 签名）、`lib/index.js`（仅 `memory_note` handoff 分支的 Phase 1 调用处、`memory_log` 内联 IIFE，每处 ≤20 行）、`lib/event-write-api.js`（新建）、`tests/smoke/smoke-test-b2-26-*.mjs`（新建）、`docs/internal/*`。

**禁止写域**：`resolveActiveEventPre`（`:120-131`）、`mirrorPlanSectionsPre`（`:777`）、`lib/client.js`、`lib/ledger-doc/*`、`CONSTRUCTION-PLAN`、`PROTOCOL`、**A1 的 `documentId`/`maintenanceTopic` 分支**。

**调用图**

```
【改前】memory_log 内联 IIFE → resolveActiveEventPre(:120)
        memory_note Phase 1 → appendHandoffCheckpointPre(:696) → evId 空 → resolveActiveEventPre(:704)
        memory_note mirror  → mirrorPlanSectionsPre(:777) → !evId → resolveActiveEventPre(:800)
【改后】三条路径 → pickAttributionPre(P-1) → appendEventNotePre（唯一写入口）
                    显式 eventId ⇒ 直接透传，不再任何判定
```

**测试**

| # | 用例 | 判据 |
|---|---|---|
| B26-01 | 显式 eventId 指向 active ⇒ 挂它，`source='explicit'` | 真调用 |
| B26-02 | 显式 eventId 指向 closed ⇒ `event-id-unavailable`，**零落盘** | 字节不变 |
| B26-03 | 库内无 active ⇒ 新建，`source='created'`，事件数 +1 | 真调用 |
| B26-04 | 有 active 且无显式 id ⇒ `source='fallback'`，与今天行为**逐字节相同** | 对比基线 |
| B26-05（**有区分力负路径**） | 写一条与任何事件**零交集**的账本 ⇒ 仍 fallback/created，**绝不新建第 2 个事件** | 事件数不因内容不相关而增加 |
| B26-06 | G-1 未裁定 ⇒ **不存在** `source='container'` 分支（源码 + 行为双断言） | 行为 |
| B26-B1（**死锁守卫**） | 若实现里出现「链内再调 createEventForWorkPre」⇒ 本用例必须**超时失败**（预期不会发生；本用例是防回归的哨兵） | 真执行，带 10s 超时 |
| B26-B2（**两进程真实竞争**） | 两个 node 子进程同时对**同一 storePath** 各写 20 条检查点 ⇒ 总条数 = 40，**零丢失**、无 `EVENT_STORE_BUSY` 泄漏 | 真跨进程（`child_process.fork`），不是同进程 Promise 竞争 |
| B26-M1 | 删掉 ③④⑤ 只留 ⑤ ⇒ B26-03 必红 | 隔离变异 |
| B26-M2 | 把 L1 门塞进 plan/handoff ⇒ B26-05 必红 | 隔离变异 |

**验收物理量**：① 事件总数 = 改前 N + 1（仅 B26-03）；② 200 条历史检查点归属**逐条不变**；③ 不相关文本用例新事件增量 = 0；④ 受影响套件全绿（§3.4）。

**回滚**：新增函数 + 三个单行调用点；删调用即回滚，**无数据迁移**。

### 3.2 2.7 —— 摘要 + 指针

**允许写域**：`lib/event-write.js`（§2.3 的受限扩展 + 新增 `readPointerPre`）、`lib/event-write-api.js`（P-2/P-4）、新建 `tests/smoke/smoke-test-b2-27-*.mjs`。

**禁止写域**：`event-recall.js` 的 `textOfEventPre`（与 index.js 内联版是**对称实现**，由 `smoke-test-task34-textofevent-parity` 守卫）、`lib/index.js` 召回侧。

**调用图**

```
appendEventNotePre(kind=plan|handoff)
  ├─ raw = content                     ← **原始全文，先留一份**
  ├─ raw = stripEventIdPre(raw)        ← 先剥 eventId 标识（见 §1.2）
  ├─ sections = parseLedgerSectionsPre(raw)   ★ 四段**只从原始全文解析**
  │      └ 为什么：appendHandoffCheckpointPre:700 会**再解析一次**它收到的 ledgerText。
  │        若把「摘要」传进去，摘要里没有 `## 任务状态` 这些标题 ⇒ 四段恒空 ⇒ 白板只剩空行。
  │        ⇒ **摘要只用于 checkpoint.text，四段走独立通道**（见下方「四段怎么进检查点」）。
  ├─ missing = 四段里为空的段名列表（plan 不计算）
  ├─ summary = summarizePre(raw, LIMIT)       → 仅作为 ledgerText 传给下游
  ├─ sha16   = computeRevision(raw).slice(7,23)
  ├─ rawsha256 = sha256(原始字节，未归一化)
  └─ appendHandoffCheckpointPre({ ledgerText: summary, kind, eventId,
                                   panels:[sha16,rawsha256,bytes,revision?,missing?] })

⚠ 四段怎么进检查点（本细则必须说清，否则实施会踩坑）：
  现状 appendHandoffCheckpointPre 的 _quad 来自 parseLedgerSectionsPre(ledgerText)。
  传摘要 ⇒ 四段丢失。所以**受限扩展必须再加一条**：
    允许 opts.sectionsOverride = {goal,doing,deadend,next}（可选）
    · 提供时：_quad 直接用它，**不再 parseLedgerSectionsPre(ledgerText)**
    · 不提供时：行为与今天逐字节相同（仍 parse ledgerText）
    · 这是 §2.3 受限扩展的**第 2 个字段**（第 1 个是 panels），同样受 6 条不变量约束
回读：readPointerPre(deps, {...})
```

**测试**

| # | 用例 | 判据 |
|---|---|---|
| B27-01 | 写 plan ⇒ `text.length ≤ LIMIT`，`panels` 含 sha16/bytes | 物理量 |
| B27-02 | 写 handoff（四段齐）⇒ 同上，且四段落在 `.goal/.state/.dead/.next` | 字段落点 |
| B27-03 | `readPointerPre` 还原 == 真源**逐字节** | 字节比对 |
| B27-03b（**四段来源**） | 写 handoff 时四段必须来自**原始全文**的 `parseLedgerSectionsPre(原文)`，**不得**来自摘要再解析。断言：摘要里故意不含 `## 待补标题` ⇒ 落盘后 `.next` 仍等于原文本的 next 段（若错误地从摘要解析，会得到空串 ⇒ 用例必红） | 字段落点 + 区分力 |
| B27-04 | 真源改 1 字节 ⇒ `pointer-drift`（**且用同一 computeRevision 口径**） | 负路径 |
| B27-05 | 真源删 ⇒ `pointer-missing` + `recent` 3 条**元数据**（不含正文） | 负路径 |
| B27-06 | `sourceRef` 为绝对路径 / 含 `..` ⇒ `pointer-unsafe`，**零 IO** | 负路径 |
| B27-06b（**行尾**） | 手工把真源 LF 改成 CRLF ⇒ 回读 `normalizedEqual=true`、`pointer-line-ending-changed`（**不是** drift），且回读 text 与真源的 `normalizeText` 结果相同 | 负路径（跨工具 CRLF） |
| B27-06c（**原文指纹**） | `panels.rawsha256` 必须等于**真源原始字节**的 sha256（未归一化）；改一个行尾空格 ⇒ rawsha256 变、sha16 不变 | 物理量 |
| B27-07 | 存量无 `sourceRef` 的老检查点（**真库抽 10 条**）⇒ `pointer-legacy` 原样返回 text | 存量不动 |
| B27-08 | handoff 四段全空/部分空 ⇒ **照常落盘**，`panels` 必含 `missing=<段名>`；plan 全空**不打** missing | 物理量（v3 改正：不再拒绝写入） |
| B27-09 | 幂等：同 content 连写 2 次 ⇒ 第 2 次 `deduped=true`，检查点数 +1 不是 +2 | 真执行幂等 |
| B27-10 | 不传 panels 的既有 6 个调用点 ⇒ 检查点**逐字节与今天相同** | 兼容 |
| B27-M1 | 把「传摘要」改回「传全文」⇒ B27-01 必红 | 隔离变异 |
| B27-M2 | 去掉 sha16 校验 ⇒ B27-04 必红 | 隔离变异 |
| B27-M3 | 去掉 fileWithinRoots ⇒ B27-06 必红 | 隔离变异 |

**验收物理量**：① 新写入 plan/handoff 字符量 Δ ≤ LIMIT/条（改前均值 671,701/200 ≈ 3,358）；② 全库 plan+handoff 占比 64.43% ⇒ 趋近个位数；③ 存量 200 条 sha256 **逐条不变**；④ parity 套件绿。

**回滚**：`ledgerText: 摘要` → `ledgerText: 全文`，一行；存量未动 ⇒ 无数据回滚。

### 3.3 2.8 —— 失败标记不进事件（**仅旧路径**）

**允许写域**：`lib/index.js` 的**旧路径**（R4-off 或 kind=plan）Phase 1 **之前**插入 Phase 0（判定用 `PREKNOWN_CODES`(error) **或** `PREKNOWN_GATES`(gate)）；`lib/event-write-api.js` 的两个白名单常量；新建 `tests/smoke/smoke-test-b2-28-*.mjs`。

**禁止**：A1 的 `documentId`/`maintenanceTopic` 分支（它已自带零副作用拒绝序列）。

**调用图**

```
【旧路径，改前】Phase 1 → Phase 2 → if(!r.ok) Phase 3（13 条，只增不减）
【旧路径，改后】Phase 0 预检
               ├─ 命中 PREKNOWN_CODES ⇒ return（事件检查点 +0）
               └─ 未命中 ⇒ Phase 1 → Phase 2 → Phase 3（未知失败仍留痕）
【A1 分支】不动（已有自己的拒绝序列）
```

**测试**

| # | 用例 | 判据 |
|---|---|---|
| B28-01 | 造 `plan-version-conflict` ⇒ 检查点 **+0**，回执含门名 | 物理量 |
| B28-02 | 造 `criteria`（gate，H1）⇒ 同上；**若只写 `PREKNOWN_CODES` 而不写 `PREKNOWN_GATES`，本用例必红** | 物理量 + 区分力 |
| B28-03 | 造 `plan-card-format` ⇒ 同上 | 物理量 |
| B28-04 | 造**未知**失败（磁盘 EPERM）⇒ **仍走 Phase 3**，检查点 +1 | 负路径（保守） |
| B28-05 | 同一可预期失败重试 3 次 ⇒ 检查点仍 +0 | 不累积 |
| B28-06 | A1 分支传非法 documentId ⇒ 行为与改前**逐字节相同**（未被 Phase 0 二次拦截） | 边界 |
| B28-M1 | 白名单改黑名单 ⇒ B28-04 必红 | 隔离变异 |
| B28-M3 | 删掉 `PREKNOWN_GATES`（只留 `PREKNOWN_CODES`）⇒ B28-02 必红（证明拆分必要） | 隔离变异 |
| B28-M2 | 把 Phase 0 移到 Phase 1 之后 ⇒ B28-01 必红 | 隔离变异 |

**验收物理量**：命中白名单 ⇒ 事件库字节数与检查点数**双零增量**；未知失败 ⇒ +1（同今天）。

**回滚**：删 Phase 0 块。

### 3.4 三项各自要跑的回归

| 套件 | 理由 |
|---|---|
| `smoke-test-r26-cross-layer` | 改 `lib/index.js` 必须重钉锁（用套件自身 IX+sha16 管道） |
| `smoke-test-task34-textofevent-parity` | 2.7 改 text 语义，对称实现须仍一致 |
| `smoke-test-r4-p5-concurrency` | 2.6 改归属后并发写不丢 |
| `smoke-test-r4-p5-off-write` | R4-off 零副作用仍成立 |
| `smoke-test-r4-p6-a1-write`（24 条） | A1 断言不得回退 |
| `smoke-test-r4-p6-a1-compat`（12 条） | 兼容读取契约不得变 |
| `smoke-test-r4-wal` / `r4-ledger-doc` / `r4-history-query` | 2.7 指纹与 revision 同源 |

---

## 4. 与 2.9 的交界面（不扩范围）

| 项 | 2.6/2.7 的边界 | 2.9 才做 |
|---|---|---|
| 四段解析 | **复用** `parseLedgerSectionsPre`（`:652`），不改契约 | 内容规范化、空值语义 |
| 覆盖证明 | 只写 `panels` 指纹（P-2） | 覆盖证明 + sourceRef 严格校验 |
| log 类 | **不强套四段** | 同上 |
| 存量 | **一律不动**（pre-WAL 523 篇禁止自动删） | 同上 |

---

## 5. 2.3 / 2.4 / D4

| 项 | 状态 | 条件 |
|---|---|---|
| **2.3**（只读提案） | 未启动 | 2.6/2.7/2.8 **各自独立验收**后；须冻结快照、草案含 `confidence`、**零写盘**（前后 event-store 字节不变）、可复算 |
| **2.4**（真实归并） | **继续冻结** | `applyRegroupPre` 只判 `status==='active'`、不判是否属于本次归并对象 ⇒ 会把 47 个 active 全量归档。须先修 + 0.2 备份 + 2.3 通过 + 用户明确批准 |
| **D4** | 不在本任务 | — |

---

## 6. 未决项（**未定不得进入施工**）

### 6.1 U-1（独立处理，不混入 2.6/2.7/2.8）

`memory_note` 的 `parameters.properties` 里 `expectedRevision` **定义了两次**：

| 行 | 所属语义 | 描述 |
|---|---|---|
| `lib/index.js` ≈25350 | 白板卡片 CAS | 「plan 整篇重写必填：memory_read(kind=plan) 返回的 revision…」 |
| `lib/index.js` ≈25387 | 维护文档 CAS | 「**配合 documentId** 的维护文档 CAS…」 |

JS 对象字面量**后者覆盖前者** ⇒ 白板 `expectedRevision` 的提示词**已失效**。

**处置**：这是**独立的小修复**（合并为一条同时覆盖两种语义的描述，或拆名）。**不属于 2.6/2.7/2.8**，本细则不修，**也不得**被 2.6/2.7/2.8 的执行者顺手改（会污染锁与回归基线）。

### 6.2 Gate（**未裁定前相关条款不施工**）

| gate | 事项 | 未定影响 |
|---|---|---|
| **G-1** | 容器事件形态：工作区级显式容器（需新增工作区级配置设施）还是别的 | **2.6 的 P-1 ③ 不实现**；`source='container'` 永不出现；2.6 仍可独立验收 |
| **G-2** | 摘要长度上限（SURVEY 建议 300，任务书只说「显著下降」） | 2.7 的 `LIMIT` 用占位常量；**验收物理量按 LIMIT 表达**，裁定后只改常量 |

### 6.3 其他未决（不阻塞，但须记录）

| # | 事项 | 现状 |
|---|---|---|
| U-2 | SURVEY 的「126 条/32.0%」（首行前缀口径）与「200 条/64.43%」（kind 口径）并存 | 本文**一律用 kind 口径**；旧文档订正**不在本任务** |
| U-4 | `pickActiveEventByTopicPre`（`:197`）候选集只有 1 个 ⇒ 门只对「最近事件」投票 | 本文**不碰该函数**，用 P-1 的显式通道绕开；长期去留待裁定 |
| U-5 | 200 条存量全文检查点 | 本文取「一律不动」；若改用回填，必须另有备份与回滚方案 |

---

## 7. 一句话结论

**2.6 是补显式通道 + 立归属协议（并明确禁止把 L1/词袋门搬到 plan/handoff）；2.7 是「摘要 + 指针 + 指纹」且**失败一律报错、不静默回落全文**；2.8 是按真实 13 条失败取证收窄到 3 类、并把 Phase 0 放在 Phase 1 之前且**只作用于旧路径**。三项共用 `appendEventNotePre`（含 `appendHandoffCheckpointPre` 的**受限扩展**）+ P-1~P-4，但必须串行、各自独立验收；G-1/G-2 未裁定前相关条款不施工。**
