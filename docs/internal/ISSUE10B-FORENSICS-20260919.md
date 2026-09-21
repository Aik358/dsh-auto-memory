# ⑩-b 记忆文件侧隐患 · 取证报告（2026-09-19）

> **两份只读子代理普查 + 主代理逐条复核的合并成果。**
> 子代理 A = M8 回写通路（`480e1420`）· 子代理 B = `MEMORY.md` 全部写入者普查（`88b6427e`）。
> **主代理对每条关键结论做了独立复核**，并纠正了子代理报告中的**三处错误**（见 §5）。
> 本报告不含修复建议 —— 修法由用户拍板后另立文档。

---

## 0. 一句话结论

> **`MEMORY.md` 这一份纯文本字节，被 20 条写入通路、3 条消费管线共用；而它们之间没有任何一层做联合把关。**
> 其中 **12 条写入通路「清洗门 × 事务校验」双零**，**3 条还是全自动无人值守**。
> 最危险的那条（M8 事实回写）**已经实际把脏数据写进过正文**——物证就在归档文件里。

---

## 1. 背景：三条消费管线（全部已代码核实）

`MEMORY.md` 不是普通文档，它同时喂三条**互不知情**的管线：

| # | 管线 | 读什么 | 依据 |
|---|---|---|---|
| ① | **注入上下文** | 整篇文本 → `systemPrompt` | `lib/index.js:5498-5499` |
| ② | **L0 摘要索引** | 按 `<!-- memory:mem_<32hex> -->` 锚点**切条** | `lib/l0-extract-pre.js:34` · `:322-343` |
| ③ | **语义语料** | 按锚点划**字节区间**算 `recordDigest` | `lib/memory-anchor-pre.js:258` · `lib/m4-corpus-pre.js:96/107` |

**三者的共同前提 = 文件字节结构与锚点标记的完整性。**
但 §2 会看到：**没有任何一条写入通路为这三条管线做联合把关。**

**语料侧的两级静默丢弃**（③）：

```js
// lib/m4-corpus-pre.js:95-96   文件级先拦 —— 跳过整个文件
const fileDigest = sha256Hex(buf)
if (fileDigest !== sc.fileDigest) { dropped.push({reason:'stale-source'}); continue }

// lib/m4-corpus-pre.js:107     记录级再拦 —— 单条丢弃
if (sha256Hex(body.subarray(r.byteStart, r.byteEnd)) !== r.recordDigest) {
  dropped.push({ reason: 'record-stale', memoryId: r.memoryId }); continue }
```

**留痕判定（关键）**：`dropped[]` **技术上有数组**，但 **无日志、无 `degrade` 台账、不抛错**，
只被 `storage-manage-pre.js:81-96 scanHealth` 归类后**在 GUI 存储页展示**。
⇒ **用户不主动打开存储页，就完全看不到**；而调用方拿到的是 **`res.ok === true`**。

---

## 2. 写入者全景（20 条，全部收敛到三个原语）

`p = await this.resolvePaths(agent)`；`notesPath = {projectDir}/MEMORY.md`、`userFile = {userDir}/MEMORY.md`。
两者共用同一套 `appendText` / `writeFull`。

| # | 调用点 | 触发 | 方式 | 清洗门 |
|---|---|---|---|---|
| 1 | `index.js:9773` | `memory_note_pre`(append) | 追加 | ✅ `sanitizeForWrite` |
| 2 | `index.js:9771` | `memory_note_pre`(replace) | 整体替换 | ✅ |
| 3 | `index.js:9811` | `memory_user_pre`(append) | 追加 | ✅ |
| 4 | `index.js:9809` | `memory_user_pre`(replace) | 整体替换 | ✅ |
| 5 | `index.js:7519` | **自动沉淀 note（每轮）** | 追加 | ❌ |
| 6 | `index.js:7529` | **自动沉淀 user（每轮）** | 追加 | ❌ |
| 7 | `index.js:7614` | `memory_consolidate_pre` | 追加 | ❌ |
| 8 | `index.js:7622` | 同上 | 追加 | ❌ |
| 9 | `index.js:7719` | `memory_maintain_pre` 蒸馏成功 | 追加 | ❌ |
| 10 | `index.js:7730` | **蒸馏失败保底（内联归档日志全文）** | 追加 | ❌ |
| 11 | `index.js:8141` | GUI 接入外部记忆 → user | 追加 | ❌ |
| 12 | `index.js:8146` | 同上 → project | 追加 | ❌ |
| 13 | `index.js:8183` | GUI 移除已接入内容 | 整体替换 | ❌ |
| 14 | **`index.js:8982`** | **`hubFlushTick`（30 分钟定时器）** | 追加 | ❌ |
| 15 | `index.js:5844` | `applyNoteStatusPre`（supersede/restore） | 整体替换 | ❌ |
| 16 | `index.js:4861` | `ensureBudget` → `compactLegacyLayer` | 整体替换 | ❌ |
| 17 | `index.js:4991` | `compactAnchoredLayer`（仅 anchor 模式） | 整体替换（**真事务**） | ❌ |
| 18 | `index.js:10773` | HTTP `API.note` | 追加 | ✅ |
| 19 | `storage-manage-pre.js:154` | GUI「修复 stale」（只重建 sidecar） | 不动正文 | — |
| 20 | `storage-manage-pre.js:202` | GUI「删除记忆」 | 整体替换（**真事务**） | — |

**旁证**：`index.js:7713` 写归档目录 · `index.js:4964` `writeFullRaw` 写 `notes-archived.md`
（`:4908` 注释明写「writeFullRaw 绕开 anchor 事务，归档不参与解析/索引」）。

### 2.1 清洗门只有 5 处接线

`sanitizeForWrite`（`index.js:8313-8337`，含 mojibake / stutter / raw-json / base64 / 重复行 / 空 六类判据）
**只接了 5 处**：`:9706`（log）· `:9736`（handoff/plan）· `:9759`（note）· `:9797`（user）· `:10768`（HTTP note）。

**其余 15 条直接写。** 其中「清洗 × 事务」双零者 **12 条**。

### 2.2 ★ 全自动无人值守的只有 3 条（这才是要害）

| 通路 | 频率 | 为什么危险 |
|---|---|---|
| **`index.js:8982` `hubFlushTick`** | **30 分钟定时器** + 启动 90 秒 | 门 `memoryHubEnabled` **出厂 true**（`index.js:518`）⇒ 用户不关就一定跑 |
| `index.js:7519` 自动沉淀 note | **每轮对话结束** | 正文来自 subagent 标签解析（`:7490-7506`） |
| `index.js:7529` 自动沉淀 user | **每轮对话结束** | 同上 |

---

## 3. 三个致命的结构性问题

### 3.1 ★ `stripAnchorLines` 的「一处收口」承诺**不成立**

```js
// lib/index.js:5746-5754
const store = this.docStore            // ← anchor 关闭时 = null
if (store) {
  // issue #54 配套(一处收口,覆盖全部调用方):**整行合法 anchor marker** 只应由写入原语自己生成。
  // …,那行 marker 会变成本文档的结构锚点 ⇒ 幻影记录(身份属于旧文档、却挂在本文档上)。
  const safeText = stripAnchorLines(...)   // ← 只有 store 存在才执行
  const r = await store.append(p, safeText)
  ...
}
// 关闭分支直接到这里 —— stripAnchorLines 从未执行
const existing = await this.readTextSafe(p)
await writeFile(p, body, 'utf8')       // 裸写
```

⇒ **注释声称「覆盖全部调用方」，但它在 `if (store)` 内部。**
对新装用户（`memoryAnchorEnabled` 出厂 false）**这句承诺完全失效** ——
`:7730` 这类「把另一文档原文当正文追加」的通路，会把源文件的 marker 行**原样**带进 `MEMORY.md`，成为**幻影锚点**。

### 3.2 ★ `reuse` / `occ` 的「保住旧 memoryId」机制是**死代码**

**主代理实测**：全仓 `planMigration` 只命中 **2 次**（`memory-anchor-pre.js:364` / `memory-anchor.js:327`），
**两处都是定义，`index.js` 零引用**；`applyPlan`（`memory-writer-pre.js:545`）同样零调用。

机制本身（若被接线）是对的：
```js
// lib/memory-anchor-pre.js:384-398   复用键 = 记录内容 digest + '#' + 出现序号
// 复用三条件全满足才复用：①调用方传 existingPlan ②sourceFile 相同 ③expectedFileDigest 整份字节一致
```
但**当前任何真实写入都走不到它** ⇒ 新 id 只能来自 `newMemoryId()`（`memory-anchor-pre.js:40`，纯随机 UUID）。

⇒ **「就地改文件会换一批新 id」不但是真的，而且没有任何机制能保住旧 id。**

### 3.3 ★ `sanitizeReservedSyntax` 会把回填的 marker **去功能化**

```js
// lib/index.js:8343
return String(text||'').replace(/<!-- memory:/g, '<!--memory:')
```
⇒ 任何经 `writeFull` 回填的 marker 都会变成**失效形式**，
于是 `renderReplace`（`memory-writer-pre.js:168-183`）把全文当 `legacy` 块 ⇒ **该文件全部条目重新分配 id**。

**这三条合起来说明**：**就地重排/整篇替换 `MEMORY.md` 永远是错的** ——
它必然导致 id 全换、证据链（`seen/read/cite`、`supersededBy`、白板锚点）全断。

## 4. M8 回写通路（`hubFlushTick`）—— 已引爆的那条

### 4.1 它是干什么的
M8 记忆中枢的**治理式回写出口**：把 hub 里已固化的 fact（confirmed / 未撤销 / 未过期 / 置信≥0.6）
渲染成 `## <主语>（M8 固化）` 段落，`appendText` 追加进 `MEMORY.md`，使其进注入面与语义语料。
**设计意图原文**（`index.js:8885-8886`）：
```
// 写回:P1④ 主闭环——hub.facts 中 confirmed/未过期/未撤销/置信≥0.6 的事实,每日限额
// 治理式写入 notesPath/userFile(autoConsolidate 同款 appendText 原子事务)→ 进 M7 语料。
```

### 4.2 怎么干的
| 环节 | 行号 |
|---|---|
| feed 60s / flush 30min / boot 90s | `:8992` / `:8993` / `:8996` |
| unref（不阻止进程退出） | `:8995` / `:8997` |
| disposer（**只 clear 两个 interval，漏了 boot**） | `:8999` |
| 开关门控（**关掉不写**） | `:8958` |
| 日期翻转清零 count | `:8962` |
| 每日上限 8 | `:8963-8964` |
| 取数（**无参**） | `:8965` |
| **写入格式** | `:8981` |
| 写入 | `:8982` |
| 失败 | `:8987` `catch (_) {}` |
| 状态落盘（**在 try 外，无条件**） | `:8989` |

### 4.3 ★ 已引爆：物证（主代理亲自复核）

| 证据 | 内容 |
|---|---|
| `archive/notes-archived.md:493-495` | `## DSH ������（M8 固化）` / `- has three modes：shadow ֻ��¼ …` / `- 来源：记忆中枢治理固化（confidence=0.92）` |
| 同文件 `:519-521` / `:684-686` / `:3168-3170` | 另 3 段，**均带 `（M8 固化）`** |
| `MEMORY.md.bak-20260917-G2` | 正文**曾有** `## Approval prompts are disabled（M8 固化）` ⇒ 证明当时确实在正文 |
| 格式唯一性 | `（confidence=` 全仓只在 `:8981` 出现 ⇒ 只能由本通路产生 |
| 锚点 | 每段带 `<!-- memory:mem_<32hex> -->` ⇒ 走 `appendText` 正经事务 |

**`count: 0` 的正确解释**：`index.js:8962` 按**记忆日**清零（日界 450 分钟）
⇒ `date:2026-09-19 / count:0` 只表示「**今天还没写**」，**不是**「历史没写」。

### 4.4 六道过滤 —— 全是结构性，没有一道内容卫生
| # | 条件 | 行号 | 挡不住什么 |
|---|---|---|---|
| ① | `!fact.revoked` | `:8970` | 从未被撤销的脏事实 |
| ② | 未被 `flushed` 标记 | `:8970` | （标记本身有问题，见 4.5） |
| ③ | `ttl` 未过期 | `:8971` | **`ttl:0` = 永不过期**（`fact-store-pre.js:60`）⇒ 全放行 |
| ④ | `confidence < 0.6` 拒绝 | `:8972` | **`confidence: null` 直接放行**（`typeof null !== 'number'`）⇒ 实测 3 条 null 全过 |
| ⑤ | `subj` 非空且不以 `mem_` 开头 | `:8973-8974` | **U+FFFD / 运行时信封 / 超长 / 含换行** |
| ⑥ | `!cur.includes(subj)` | `:8980` | 子串误命中 |

### 4.5 ★ 五个失败模式（要害）
1. **脏 subject/object 原样落地** —— `:8981` 对 `predicate`/`object` **连 `.trim()` 都没有**；
   **换行未归一化** ⇒ 一条 fact 可**伪造 `## ` 标题**，并被 `compactLegacyLayer`（`:4796` `^##\s+(.+)$`）当独立段落搬运。
2. **失败静默** —— `catch (_) {}`（`:8987`）吞异常，而 `hubFlushSave()`（`:8989`）**无条件执行** ⇒ 失败照写 flush-state。
   **无 diag、无 degrade 台账**（对照 `:5853` note-status 路径**有** `_degradePre.record`）。
3. **`flushed` 与 `count` 不自洽** —— `:8980` 的「已在正文」分支**只置标记、不 `count++`**；
   且判定用 **子串**（短主语易误命中）；且该标记**永久生效**（`:8962` 只清 count 不清 flushed）。
4. **`flushed` 永不清理** ⇒ 实际语义是「**生命周期总量 8 条**」而非「每日 8 条」；且**归档后永不重写**（单向）。
5. **`hubFlushSave` 写失败静默吞**（`:8895`）⇒ 重启后 `flushed` 回退 ⇒ **已写过的会被再写一遍**（正文出现两个同名段落）。

### 4.6 门控与并发
- **开关门控彻底**（关掉不写），**但定时器无条件创建**、关掉后仍每 30min 空转；
  **`hubBootTimer` 未纳入 disposer**（`:8999`）。
- **无重入保护**（`:8993` `void` 无 in-flight 标志）；
  `MEMORY.md` 不撕裂靠 docStore `_queue`（`memory-writer-pre.js:345-352/506`），
  但 **`flush-state.json` 是裸 `writeFileSync`，无锁、无 tmp+rename**（`:8895`）。

### 4.7 ★ 可观察性：失败完全不可见
- 成功有 `diag`（`:8986`）→ `~/.dsh/dsh-auto-memory-pre-diagnose.log`
- **失败零留痕**
- `memory-hub-pre.js:192-220 overview()` **不含 flush 字段** ⇒ **前端面板看不到「写了但没成功」**

---

## 5. ★ 主代理对子代理报告的三处纠正

> **纪律**：子代理结论不得直接采信，须主代理独立复核。

### 纠正 1：B 报告「默认配置下一条都不走事务」—— **对用户本机不成立**

B 的推理链是对的（`memoryAnchorEnabled` 出厂 `false` ⇒ `docStore` getter `return null` ⇒ 裸写），
但**用户的实际配置不是默认值**：

| 项 | 出厂默认 | **用户实际** | 依据 |
|---|---|---|---|
| `memoryAnchorEnabled` | `false`（`index.js:307`） | **`true`** | `~/.dsh/dsh-auto-memory-pre.json` |
| `memoryHubEnabled` | `true`（`index.js:518`） | `true` | 同上 |
| `~/.dsh/memory/index-pre/files` | 关时不创建 | **存在，102 个 sidecar** | 只在该开关 true 时创建（`:5737`） |

⇒ **用户本机一直开着 anchor 事务层**；B 的「默认裸写」结论只对新装用户成立。
**但这不改变 B 的核心价值** —— §3.1（`stripAnchorLines` 承诺不成立）与 §2.2（3 条全自动零防线）依然成立，
且对**新用户**（出厂配置）风险更高。

### 纠正 2：`reuse`/`occ` 是死代码 —— **B 对，且比它说的更绝对**
主代理实测：`planMigration` 全仓 **2 次命中，都是定义**，`index.js` 零引用。
⇒ **没有任何机制能保住旧 `memoryId`**。

### 纠正 3：`sanitizeReservedSyntax` 的去功能化 —— **B 对，且它强化了「就地改文件必然错」**
`:8343` 会把回填的 `<!-- memory:` 改成 `<!--memory:`（失效形式）
⇒ 整篇替换必然让全文变 `legacy` 块 ⇒ **全部条目重新分配 id**。

---

## 6. 综合判定：风险排序

| 排序 | 通路 | 理由 |
|---|---|---|
| **★★★** | **`index.js:8982` `hubFlushTick`** | ①全自动高频（30min，门出厂 true）②清洗×校验双空 ③**脏源结构性**（主语取自记忆文件字节 `:8943`←`m4-corpus-pre.js:118` ⇒ **脏数据自我放大**）④失败静默 ⑤**已实际引爆（§4.3）** |
| ★★ | `index.js:7519` / `:7529` 自动沉淀 | 每轮对话结束触发，无清洗门 |
| ★ | `index.js:7730` 蒸馏保底 | 内联**归档日志全文**，无清洗门；但受定时+AI失败双条件限制 |

### ★ 最关键的一条：**「自我放大回路」**
```
记忆文件字节 → m4-corpus-pre.js:118 取 text → index.js:8943 作 fact.subject
                                    ↓
                         hubFlushTick:8982 写回 MEMORY.md
                                    ↓
                         （若脏）再次成为语料来源 → 再固化 → 再写回
```
⇒ **脏数据不只是「落盘」，它会自己繁殖。**

---

## 7. 取证边界
- 子代理 A 未读 `~/.dsh/dsh-auto-memory-pre-diagnose.log` ⇒ 「哪一次 compaction 归档的」为**推断**。
- 本报告全部结论均附 `文件:行号`；主代理已复核 §3.1 / §3.2 / §3.3 / §4.3 / §5 纠正 1。
- **两份子代理报告全程只读**，未修改/创建/删除任何文件，未派生下级代理。

---

## 8. ★ 修复方案（待用户拍板）

### 8.0 先判紧急度（诚实评估，不夸大）

**急性事故已经发生完毕**——4 条脏 fact 已写入、已被归档，**没有正在持续流血**。
**但慢性暴露仍然存在**，理由是：
- `count` 每日清零（`:8962`）、`flushed` 永不清零 ⇒ 实际语义是「**每天最多 8 条新 fact，每条一生只写一次**」
- ⇒ **每个记忆日仍有最多 8 次脏写入机会**
- 且脏源**是持续产生的**：`hubFeedTick`（60s）从 `judgement-shadow.jsonl` 取数，
  主语来自 `rec.heading || rec.text`（`:8943`），而 `rec.text` 来自**记忆文件字节**（`m4-corpus-pre.js:118`）

⇒ **判定：中高优先，不是「立刻停机」级别，但应在进入前端前修完**（与用户既定节奏一致）。

### 8.1 关键洞察：⑩-a 的修法**就是** ⑩-b 的主要止血手段

**两条问题同源**：
```
episode.intent（可能脏）
   ├─→ crossFeed procedure 分支  ✅ 已清洗（⑨ 修的）
   └─→ crossFeed fact 分支        ❌ 未清洗 ──→ facts.json 变脏
                                                   ├─→ ⑩-a 前端面板看不懂
                                                   └─→ hubFlushTick 写进 MEMORY.md ──→ ⑩-b 三管线污染
```
⇒ **给 fact 通路补上清洗器，同时解决 ⑩-a 与 ⑩-b 的脏源**。这是最高性价比的一刀。

### 8.2 分三层（T0 止血 / T1 根因 / T2 加固）

#### T0 · 立即止血（不改 host 代码）
| 动作 | 说明 |
|---|---|
| **T0-1** | 备份 `facts.json` + `flush-state.json`（**只备份，不动**） |
| **T0-2** | 记录当前脏条目 id，作为 T1 完成后的验收基线 |
| **T0-3** | **不关 `memoryHubEnabled`** —— 那会连 procedure 晋升一起停，代价远大于收益 |

> **为什么不直接清 `facts.json`**：`fact-store-pre.js` **没有按 id 删除的方法**（导出全集见 §中），
> 唯一的 `revokeBySource` 需先删来源记忆/episode（副作用过大）；
> 且宿主内存持副本、`dispose()` 会回写 ⇒ **直接改盘会被回滚**（⑨ 已踩过）。

#### T1 · 根因修复（改 `lib/`，改动小、收益最高）
| # | 改动 | 位置 | 效果 |
|---|---|---|---|
| **T1-1** | `crossFeed` **fact 分支**补 `stripRuntimeIntentPre`（清洗 `subject`/`object`） | `memory-hub-pre.js:166-174` | **断源**（⑩-a 根因） |
| **T1-2** | `factCandidateFromRow()` 补清洗 | `memory-hub-pre.js:249-265` | 断源（第二条 fact 入口） |
| **T1-3** | `hubFlushTick` **写入前加内容卫生门**：`subject`/`object` 过清洗器；脏则 **skip + 留痕** | `index.js:8975-8987` | **即使脏 fact 已存在也写不出去**（⑩-b 止血） |
| **T1-4** | 换行归一化：`subject`/`object`/`predicate` 去 `\r\n` | `index.js:8981` | 堵「伪造 `## ` 标题」 |
| **T1-5** | 失败留痕：`catch` 内补 `diag` + `_degradePre.record`（对照 `:5853` 既有做法） | `index.js:8987` | 「写了但没成功」可见 |

#### T2 · 结构加固（改 `lib/`，中等）
| # | 改动 | 位置 |
|---|---|---|
| **T2-1** | `flushed` 与 `count` 自洽：`cur.includes(subj)` 分支也 `count++`；并把「子串判定」改为更严的判据 | `index.js:8980` |
| **T2-2** | `hubBootTimer` 纳入 disposer（`:8999` 补 `clearTimeout`） | `index.js:8999` |
| **T2-3** | `flush-state.json` 改原子写（tmp + rename，与 `hubIo` 同款） | `index.js:8895` |
| **T2-4** | 加 in-flight 标志防重入 | `index.js:8993` |

#### T3 · 系统性收口（**最大收益，也最大改动** —— 建议单独立项）
| # | 改动 | 说明 |
|---|---|---|
| **T3-1** | **把 `sanitizeForWrite` 从 5 个调用点下沉到写入原语层**（`appendText` / `writeFull` 内部） | 一处收口 ⇒ **20 条通路全部受保护**，不再依赖调用方自觉 |
| **T3-2** | `m4-corpus-pre.js` 的 `dropped[]` 补 `degrade` 台账 | 让「静默丢出语义语料」变得可见 |
| **T3-3** | `overview()` 暴露 flush 状态（`count`/`lastFlush`/失败数） | 前端面板可诊断 |

> **T3-1 是「治本」**：本报告的核心结论是「20 条通路没有统一契约」，
> 而 T1/T2 都是**逐条补**。只有把卫生门下沉到原语层，才能让**将来新增的写入者**自动受保护。
> **但它的改动面最大、回归风险最高，建议单独一批、单独验收。**

### 8.3 建议执行顺序
```
T0（备份，10 分钟）
  ↓
T1-1 / T1-2（断源，最优先 —— 同时修 ⑩-a）
  ↓
T1-3 / T1-4 / T1-5（hubFlushTick 加固）
  ↓
新套件 + 变异演示 + 全量回归
  ↓
T2（结构加固，可与 T1 合并一批）
  ↓
T3（系统性收口）—— 建议单独立项，或并入前端后的重构
```

### 8.4 验收标准（可自动化）
1. `facts.json` 中 U+FFFD 计数 = 0
2. `facts.json` 中命中 `/Current DSH file policy|Approval prompts are disabled|Current runtime context|Retrieved memory ref/i` = 0
3. 新套件：`crossFeed` 走 fact 时脏 intent **不落库**
4. 新套件：`hubFlushTick` 遇到脏 fact **不写入 + 留痕**
5. 变异演示真红（去掉任一新加的清洗调用 ⇒ 断言变红）
6. 全量回归 **0 失败**

### 8.5 风险与回退
- **T1/T2 风险：低-中**。均为**前置检查/留痕**性质，不改变既有成功路径的行为。
- **回退**：每项改动独立可回退；改前备份（本仓既定纪律）。
- **不碰**：不改 `MEMORY.md` 任何字节、不改锚点、不动事务层语义。

## 9. ★★ 用户拍板（2026-09-19，**已定案，压缩后照此执行**）

| # | 议题 | **用户裁定** |
|---|---|---|
| 1 | **开工时点** | **先压缩上下文，再开工** |
| 2 | **存量 3 条脏 fact** | **路 C —— 靠卫生门堵住**（不改数据） |
| 3 | **T3 系统性收口** | **单独立项，前端之前做** |

### 9.1 由此确定的执行序（压缩后按此开工）

```
【第 0 步】等用户压缩上下文
   ↓
【第 1 步】T0 备份（10 分钟，不改代码）
   · 备份 ~/.dsh/memory/hub-pre/facts.json
   · 备份 ~/.dsh/memory/hub-pre/flush-state.json
   · 记录当前脏条目 id 作为验收基线
   · ⚠️ 只备份，绝不改盘（宿主内存持副本，dispose() 会回写）
   ↓
【第 2 步】T1-0 ★ ⑨ 漏网修复（**2026-09-19 22:40 追加，必须先做**）
   · lib/intent-clean-safe-pre.js:73  PLUGIN_TAIL_MARKER_RE 改「前缀即判据」
       现状（过严）：^Source:\s*mem_[0-9a-f]{32}   ← 被 slice(0,40) 截断即漏
       改为（前缀族）：^Source:\s*\S                 ← 去掉 mem_<32hex> 约束
       新增：        ^Reference:\s*\S               ← F3 目前完全没有这一条
   · ⚠️ 必须同时守住误伤边界（⑨ 套件 [4] 组口径）：`^` 行首锚定必须保留，
        且要求后面跟非空内容（`\S`），否则会吞掉正文里的普通 `Source:`
   · 取证见 docs/internal/ISSUE9-RESIDUAL-FORENSICS-20260919.md
   ↓
【第 3 步】T1 根因修复（⑩-a 与 ⑩-b 同源，一批做完）
   T1-1  lib/memory-hub-pre.js:166-174  crossFeed fact 分支补 stripRuntimeIntentPre
   T1-2  lib/memory-hub-pre.js:249-265  factCandidateFromRow 补清洗
   T1-3  lib/index.js:8975-8987         hubFlushTick 加内容卫生门（脏则 skip + 留痕）
   T1-4  lib/index.js:8981              换行归一化（防伪造 ## 标题）
   T1-5  lib/index.js:8987              失败留痕（diag + _degradePre.record）
   ↓
【第 4 步】T2 结构加固（同批）
   T2-1  index.js:8980   flushed 与 count 自洽（含改掉子串判定）
   T2-2  index.js:8999   hubBootTimer 纳入 disposer
   T2-3  index.js:8895   flush-state.json 改原子写（tmp + rename）
   T2-4  index.js:8993   加 in-flight 标志防重入
   ↓
【第 5 步】收尾（本仓既定纪律，缺一不可）
   备份 → 改 → node --check → 新套件（先看它红）→ 变异演示（确认真红）
   → 还原（SHA256 逐字节一致）→ 全量回归（0 失败）→ 记录
   ↓
【第 6 步】告知用户重启宿主（agent 绝不碰 3080）
   ↓
【第 7 步】T3 系统性收口 —— 单独立项，**在前端之前**做
   把 sanitizeForWrite 从 5 个调用点下沉到写入原语层
   （appendText / writeFull 内部）⇒ 20 条通路全部自动受保护
   + `overview()` 回传 `reasonCodes`（前端 R2 的前置依赖）
```

> **★ 为什么 T1-0 必须放在最前**：⑨ 的漏网**正在持续产生新脏数据**（实测 22:40 已从 3 条涨到 5 条），
> 而 T1-1/T1-3 只挡 fact 那条路，**挡不住 procedure 这条**。不先修 F3，等于一边修一边漏。

### 9.2 存量 3 条脏 fact 的处置（路 C，已定）

**不改数据。** 依赖 T1-3 的内容卫生门：
- 脏 fact 一旦命中清洗器判据 ⇒ `hubFlushTick` **直接 skip**，永远写不出去
- 面板乱码由 **T1-1/T1-2 的清洗器**从源头解决（新 fact 不再脏）
- **补充事实（降低紧迫性）**：`flushed` 4 条全为 `true` 且**永不清零**
  ⇒ 这 4 条**事实上已经不会再被写入**，路 C 属于「补一道保险」而非「抢救」

### 9.3 `hubFlushTick` 卫生门的具体判据（T1-3 实现要点）

复用 `lib/intent-clean-safe-pre.js` 的 `stripRuntimeIntentPre()`——**与 ⑨ 同源**，一次覆盖两类脏：
- **F3**：召回块 / 运行时信封尾部标记族
- **F4**：`looksEncodingCorruptedPre`（U+FFFD ≥ 3）

**行为约定**：
```
对 fact.subject / fact.object 各自过 stripRuntimeIntentPre
  ├─ 清洗后仍非空 且 与原文等价  → 正常写入（走原路径）
  ├─ 清洗后为空                  → skip + 留痕（记 degrade）
  └─ 清洗后与原文不同（= 有脏）  → skip + 留痕（**不静默改写后再写**，
                                    避免「悄悄改用户数据」的语义歧义）
```
> **为什么「有脏就 skip」而不是「清洗后照写」**：本仓既有纪律是
> 「**fail-soft 必须留痕、不得静默改写**」。清洗后照写等于**静默修改数据**，
> 与 T1-1/T1-2 的「源头断供」在语义上重复，却在诊断上丢失了「曾经有过脏 fact」这一事实。

### 9.4 验收标准（可自动化，压缩后直接照用）
1. `facts.json` 中 U+FFFD 计数 = 0
2. `facts.json` 中命中 `/Current DSH file policy|Approval prompts are disabled|Current runtime context|Retrieved memory ref/i` = 0
3. 新套件：`crossFeed` 走 fact 时脏 intent **不落库**
4. 新套件：`hubFlushTick` 遇脏 fact **不写入 + 有留痕**
5. 变异演示真红（去掉任一新加的清洗调用 ⇒ 断言必须变红）
6. 全量回归 **0 失败**

### 9.5 铁律（压缩后务必遵守）
- **不碰 `MEMORY.md` 任何字节**：不改锚点、不改排版、不整篇替换
  （依据 §3.1/§3.2/§3.3：就地改文件必然导致 id 全换、证据链全断）
- **不直接改 `hub-pre/*.json`**：宿主内存持副本，`dispose()` 会整份回写覆盖（⑨ 已踩过）
- **不关 `memoryHubEnabled`**：那会连 procedure 晋升一起停，代价远大于收益
- **agent 绝不碰 3080**：改完只告知用户自行重启
- **改前必备份**；`lib/*.js` 是 **CRLF**，用 `edit` 后须验行尾



