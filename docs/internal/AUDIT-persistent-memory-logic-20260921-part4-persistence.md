# 长期记忆系统 逻辑审计报告 · 第 4 批：持久层、并发与写入闸门（子代理复核 + Lead 核实）

> 审计日期：2026-09-21 · 对象 `D:\dsh-auto-memory`（pre 线）
> 取证方式：子代理构造性探针（内存 IO，只读不落盘）+ Lead 逐条回读源码核实
> **只诊断，未改任何代码。**

---

## 0. 本批新增（前三批未覆盖的领域：持久化 / 并发 / 写入闸门 / 工具去重）

前三批集中在 procedure 审批（第 1）、事实写入与清洗（第 2）、`-pre` 双份（第 3）。
本批补齐**持久层语义**与**多写入通路的去重契约**，其中 2 条为 P0/P1 且**用户可直接感知**。

---

## 1. P0（1 条）

### P0-1 `memory_note` 的 handoff 分支会**静默截断交接账本**

- 位置：`lib/index.js:10134`（闸门）、`:10151-10153`（返回值）；阈值定义 `lib/index.js:8625-8628`
- 代码：
  ```js
  // :10134  handoff 上限 8000 字
  const gateH = sanitizeForWrite(content, { maxEntryChars: args.kind === 'plan' ? 200000 : 8000 })
  // :8625  超限不是拒绝，而是「截断 + truncated 标志」
  if (raw.length > maxEntry) {
    return { ok: true, clean: sanitizeReservedSyntax(raw.slice(0, maxEntry)), truncated: true }
  }
  // :10151  返回值**不透出** gateH.truncated
  return (args.kind === 'plan' ? '白板 PLAN.md 已更新…' : '交接账本已写入: ' + r.path) + '\n请在本轮回复正文向用户转述本次更新要点。'
  ```
- **对照证据（不对称即 bug）**：同文件的 note 分支 `lib/index.js:10184` 会拼
  `(gate.truncated ? '\n(内容超长,已截断到 …)' : '')`。handoff 分支接住了 `gateH` 却**从不外显**标志。
- 影响：交接账本是**跨窗口续命材料**，其四段结构固定为
  「任务状态 / 目标 / 已试方案与失败原因 / **进度与下一步**」——**截断正好砍掉最后一段「进度与下一步」**，
  而模型看到的返回是「已写入」，**无任何异常信号**。
- 现实触发概率：**高**。当前活跃账本已是 76KB 级（历史记录），远超 8000 字上限 ⇒ 属常态触发而非边角。
- 修法建议（二选一）：
  A. 与 note 分支对齐，返回值拼 `gateH.truncated` 提示 + 实际写入长度；
  B. handoff 采用「超限即拒绝」，强制模型分段写（更安全：续命材料不允许无声缩水）。

---

## 2. P1（5 条）

### P1-1 factId 是「元组哈希」+ 撤销不删记录 ⇒ 持久层重复主键，且新事实被永久跳过

- 位置：`lib/fact-store-pre.js:149`（id 派生）、`:209`（新建 push）、`:283`（supersede 只置位）；受害者 `lib/index.js:9299`
- 代码：
  ```js
  // :209 新建：id 由元组派生，push 前无唯一性检查
  factId: idFn(c.scope, c.subject, c.predicate, c.object),
  facts.push(fv.fact)
  // :283 supersede：旧记录只置 revoked，不删除
  existing.revoked = true; existing.revokedAt = nowFn()
  ```
- 探针实测（构造性，内存 IO）：
  ```
  create v1            -> created  fact_pre_5239480606855d0894f4bec417d82a6e
  revokeBySource       -> {"revoked":1,"factIds":["…2a6e"]}
  re-upsert SAME tuple -> created  同一 factId
  facts = 2   unique = 1   DUP ID = true
  ```
- 影响链（**这是用户可感知的**）：
  `facts.json` 出现两条同 id 记录（一条 revoked、一条 live），`restore()` 不去重；
  而 `lib/index.js:9299` 的写回去重键正是 `factId`：
  ```js
  if (!fact || fact.revoked || hubFlushState.flushed[fact.factId]) continue
  ```
  ⇒ 旧记录若已写回并被标记 `flushed`，**重新成立的新事实会被当作"已处理"永久静默跳过**，永不写回 `MEMORY.md`。
- 修法建议：`upsert` 新建前查 `facts.some(f => f.factId === id)`，命中则走「复活 + merge」；
  或把 `revokedAt`/epoch 并入 id 派生；`restore()` 按 `factId` 去重。

### P1-2 状态行写入破坏目标条目的 CRLF（与文档承诺相反）

- 位置：`lib/note-status-pre.js:144`、`lib/note-status-apply-pre.js:88`
- 代码：
  ```js
  return s.split(/\r?\n/).filter((ln) => parseStatusLinePre(ln) === null).join('\n')  // 切分吃 \r\n，拼回只用 \n
  const bodyClean = stripStatusLinePre(seg)   // 作用于目标条目正文
  ```
- 探针实测（构造 CRLF 文档，对首条 retract）：
  ```
  CRLF before/after = 13 / 9      bare LF 数 = 1
  target record bytes = "## 2026-09-19\n- l1\n- l2\r\n<!-- dsh-status: retracted … -->\r\n\r\n"
  ```
- 影响：每次 `supersedes/retract/restore` 都把目标条目行尾改掉，与「除状态行外逐字节保持原样」的承诺相反；
  本仓文件**全 CRLF** ⇒ `recordDigest` 漂移、GUI diff 放大、sidecar `sourceVersion` 无谓递增。
- 修法建议：`stripStatusLinePre` 按 `detectNewline` 结果决定 join 分隔符（或改为「按行切片后原样重组」）。

### P1-3 episodic 的 `current` 缓冲**不按 sessionRef 隔离** ⇒ 跨会话段被并进同一 episode

- 位置：`lib/episodic-store-pre.js:130`（`current` 只在空时取 sessionRef）、`:227`、`:235`；宿主调用 `lib/index.js:7609`
- 代码：
  ```js
  if (!current) {
    current = { sessionRef: String(s.sessionRef || 'unknown'), startedAt: nowFn(), ... }
  }
  provenance: current.segments.map((s) => 'seg:' + String(s.eventSeq)),
  ```
- 探针实测：
  ```
  consolidate ok = true   sessionRef = session-A
  provenance = ["seg:1","seg:1"]
  intent = "A 的第一件事"        // 第二段来自 session-B，也被并入
  ```
- 影响：episode 的 `sessionRef`/`intent` 归属虚假；`provenance` 段号重复。
  **更关键**：`promote()` 依赖的 `distinctSessions` 被系统性低估 ⇒ 技能永远卡在 `diversity-below-3`
  ——**这与第 1 批 P1-1（模型条目 sess 恒 0）叠加，构成"永远晋升不了"的第二条独立成因。**
  宿主侧 `_hubEpBuffer` 是 engine 级共享计数（`lib/index.js:7619`），多 runtime 并存时必然交错。
- 修法建议：`append` 检测 `s.sessionRef !== current.sessionRef` 时先 `consolidate()` 再开新 `current`；
  `provenance` 用 `sessionRef + ':' + eventSeq`。

### P1-4 三个 store 的 `persist()` 吞掉所有落盘失败 ⇒ 内存与磁盘静默分叉

- 位置：`lib/fact-store-pre.js:367`、`lib/episodic-store-pre.js:357`、`lib/procedure-store-pre.js:491`（`clear()`/`dispose()` 同款）
- 代码：`try { io.save(snapshot()) } catch (_) {}`（三处同形）
- 影响：宿主 `hubIo.save` 是 `mkdirSync + writeFileSync(tmp) + renameSync`（`lib/index.js:9142`），
  磁盘满 / 权限 / 杀软占用时抛错被吞；调用方看到 `ok:true`，而 `flush-state.json` 的 `flushed` 标记**已推进**
  ⇒ 该条事实再也不会重写（与 P1-1 是**同一后果的两个入口**）。
  对照：`memory-writer-pre.js` 同场景会返回结构化失败并附 `recoveryPath`。
- 修法建议：`persist()` 返回结果并向上透传（至少记 `diag` / `_degradePre.record`）；
  `hubFlushState.flushed` 只在 `save` 确认成功后落盘。

### P1-5 工具级去重判据极弱，且旁路完全不过它

- 位置：`lib/index.js:8649`（`tailHas` 实现）、`:10104`/`:10162`/`:10201`（调用）；旁路 `:9353`
- 代码：
  ```js
  var first = String(incoming).trim().split('\n')[0].trim().slice(0, 60)
  var tail = String(existing).trim().split('\n').slice(-60)
  for (...) if (tail[i].indexOf(first) !== -1) return true
  ```
- 问题：只比对「首行前 60 字」× 「最后 60 行内的子串包含」。换个开头、或间隔超 60 行即判为「不重复」。
  而 `hubFlushTick` 写回走 `appendText`（`:9353`），**完全绕过 `tailHas`**，只做 `cur.includes(subj)`（`:9336`）。
- 影响：同一事实可被继承（自动沉淀 → `memory_note` → hub 写回）多次写入。
  已知历史症状正是「正文出现两个同名 `（M8 固化）` 段落」（`lib/index.js:9216` 注释自述）。
- 修法建议：去重键下沉到 `appendText`（锚定线用 recordDigest、legacy 线用规范化行哈希），
  而不是每个入口各自实现。

---

## 3. P2（8 条，摘要）

| # | 缺陷 | 位置 | 要点 |
|---|---|---|---|
| 1 | `procedureCorrectionCap` 的 `|| 0.3` 让「0」不可表达 | `index.js:9159` | 填 0（最严格）被静默改回 0.3；相邻两行已刻意用有限性判据，此处漏改 |
| 2 | `stats.superseded` 死计数器、`'superseded'` 结果码不可达 | `fact-store-pre.js:141/:272/:55` | `supersede()` 只加 `revoked++`；枚举与实现漂移 |
| 3 | 查询返回浅拷贝，数组字段与库内对象共享引用 | `fact-store-pre.js:306/:318/:375`、`procedure-store-pre.js:421/:424/:428` | `provenance`/`steps`/`sourceMemoryIds` 同引用，调用方一次 push 改脏已入账记录 |
| 4 | `validateProcedurePre` 不校验 `evidence`；`addEvidence` 对缺字段抛错 | `procedure-store-pre.js:71/:206` | 抛错被 `index.js:7644` 外层空 catch 吞掉 ⇒ 表现为「证据永不累积」无留痕（与第 1 批 P1-6 同源，此处补出**后果**） |
| 5 | episodic `append` 不落盘、`consolidate` 不做 id 去重 | `episodic-store-pre.js:125/:241` | 进程强杀丢最多 `minSegments-1` 轮缓冲；同 id 副本可能 |
| 6 | `procedureCandidateFromRow` 把步骤压成单行、标题硬截断 | `memory-hub-pre.js:326/:329/:331` | judgement 行的多步流程进库后只剩一行摘要；此后带真 steps 的同名候选被判为「不同身份」另开一行 ⇒ 库里长期留空壳行 |
| 7 | `renderChecklist` 硬截 2000 字 | `procedure-store-pre.js:454` | 步骤多的技能注入时**尾部（检查/完成标准/回滚）静默消失**，且注入面无从判断是否被砍 |
| 8 | `hubFlushTick` 里 `currentRuntime()` 可能为 null | `index.js:9332` | 无活动 runtime 时抛 TypeError，被 `:9371` 空 catch 吞掉，整轮写回中止且无留痕 |

---

## 4. 写入通路全景（问题「到底有几条写入通路」的直接答案）

共 **6 条**持久化写入通路，全部落到同一批 `.dsh-memory/` 文件或 `hub-pre/*.json`：

| # | 通路 | 位置 | 去重机制 |
|---|---|---|---|
| 1 | **模型工具**（17 个） | `index.js:10091` 起 | `sanitizeForWrite` + `tailHas` |
| 2 | **自动沉淀**（`consolidateTurn`） | `index.js:7668-7789` | ★ **不过 `tailHas`** |
| 3 | **记忆中枢喂数**（`hubFeedTick`） | `index.js:9245-9284` | fact 去重键 `(scope,subject,predicate)`；object 不同 ⇒ 登记为冲突集而非合并 |
| 4 | **episode 举一反三**（`crossFeed`） | `memory-hub-pre.js:145-198` | 指纹匹配（procedure）/ 元组（fact） |
| 5 | **M8 治理式写回**（`hubFlushTick`） | `index.js:9285-9372` | ★ `flushed[factId]`（**P1-1 的受害者**）+ `cur.includes(subj)`；**绕过 `tailHas`** |
| 6 | **loopback 路由与维护动作** | `index.js:10888-10937`、`:7950-7967`、`:5001-5029` 等 | 各自实现 |

⇒ **同一事实被重复写入是可能的**：通路 2/5 绕过 `tailHas`，通路 1 的判据本身极弱（P1-5），
通路 3 的 fact 去重只看三元组（换 object 即新增）。

---

## 5. 未能确认（子代理与 Lead 共同标注）

1. **重复 factId 在真实安装中的发生率**——需一份「曾被 `revokeBySource` 撤销、随后同元组重现」的 `facts.json`；目前只有构造性探针。
2. **多 runtime 交错导致 episodic 混合的实际频率**——机制已证（探针），缺真实并发 `episodes.json`。
3. **REL 发布物是否真的不残留陈旧裸文件**——读了 `tools/release.mjs:283-307` 覆盖逻辑与 `:313-326` 自检，
   **未跑构建**（只读约束），故「REL 树无裸版同名文件」属**代码推断而非实测**。
   补充：`release.mjs:313-326` 的自检只检查「DEV 是否有未登记的 `-pre.js`」，**不检查陈旧裸文件重复**。
4. **`memoryAnchorEnabled` 默认 false 下写入闸的真实生效范围**——`docStore` 为 null 时全部走裸 `writeFile`
   （`appendText` 的 else 分支 `:5956-5958`），该分支**无备份、无 digest 校验、无队列串行**；未确认现役用户是否已开启 anchor。
5. 未运行项目测试套件（只读审计）。

---

## 6. 本批对总体的修正：为什么「晋升不了」有两个独立成因

第 1 批给出的是**审批链路**成因（批准通路缺失 + 手点 vs 模型授权不对称 + 注入总闸默认关）。
本批发现**第二条独立成因在数据层**：

> `episodic.current` 不按 session 隔离（P1-3）⇒ `provenance` 段号重复、`sessionRef` 归属虚假
> ⇒ `promote()` 依赖的 `distinctSessions` **系统性低估** ⇒ 即便修好审批链路，统计门仍可能永远不达标。

⇒ **修复顺序必须把 P1-3 与第 1 批的 P1-1（`sourceMemoryIds` 恒空）放在同一批**，
否则"统计门永远不通过"会以另一种形式残留。
