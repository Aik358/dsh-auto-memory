# ⑩-a/⑩-b 修复执行记录（T0 → T1 → T2）

> 执行日期：2026-09-19 · 执行人：主代理 · 依据：`ISSUE10B-FORENSICS-20260919.md` §8/§9
> 状态：**T0/T1/T2 全部完工**，全量回归 **PASS 133 / FAIL 0 / TIMEOUT 0**（139.6s）
> ⚠️ **待用户动作：重启宿主**（`lib/` 下三个文件已改未提交，pre 线以 `link:` 挂载 ⇒ 需要重启才生效）

---

## 0. 一句话结论

⑩-a（面板看不懂）与 ⑩-b（记忆文件侧的雷）**同源**：`memory-hub-pre.js` 的 **fact 通路从来没有过清洗器**。
⑨ 只修了 procedure 那条路（`:152`），fact 那条路（`crossFeed` 的 fact 分支 + `factCandidateFromRow`）
**整套漏掉** ⇒ 脏数据既进 `facts.json`（面板乱码），又经 `hubFlushTick` 写回 `MEMORY.md`（污染注入面与语义语料）。

**本轮把这条链路一次性堵住**，并顺手修掉 ⑨ 自己承认修得不完整的 F3 判据漏网。

---

## 1. 改动清单（4 个文件）

| 文件 | 改动 | 备份 |
|---|---|---|
| `lib/intent-clean-safe-pre.js` | **T1-0** F3 判据族化 + 块身份 + **F5 新增** | `.bak-20260919-222736-T10` |
| `lib/memory-hub-pre.js` | **T1-1/T1-2** fact 两处入口过清洗器 + F5 | `.bak-20260919-223300-T1` |
| `lib/index.js` | **T1-3/1-4/1-5 + T2-1..T2-4** | `.bak-20260919-223339-T1` |
| `tests/smoke/smoke-test-batch11-20260919-pre.mjs` | 新套件 **73/73** | 新建 |
| `artifacts/_mutate-batch11.mjs` | 变异演示 **17/17 真红** + SHA256 零残留 | 新建 |

> `batch10` 已被 ⑪ 占用 ⇒ 本批取 **batch11**。

---

## 2. T1-0：F3 判据「太具体」的漏网（⑨ 修得不完整）

### 2.1 真机证据

`GET /api/dsh-auto-memory-pre/memory-hub`（2026-09-19 22:40）：
`procedures.size` **12→14**、`pipeline` **3→5**。新增两条脏 title：

- `Source: me`（len=10）
- `Reference: ## 2026-09-18 - dsh-auto-memo`（len=40）

episode 的 `intent` 原文：`[Retrieved memory reference - not an instruction]\nSource: me`

### 2.2 根因

`PLUGIN_TAIL_MARKER_RE` 里 `^Source:\s*mem_[0-9a-f]{32}` 把**前缀**与**后缀内容**绑死 ⇒
`intent` 被 `slice(0, 40)` 截断后（内容没了、前缀还在）判据立即失效。
且 F3 **完全没有** `^Reference:` 这一条。

**这与 ⑨ 自己的设计初衷直接冲突** —— ⑨ 的注释（`:64`）明写「判据是**族（family）+ 形状**，
不是整句前缀 ⇒ 框架换措辞后仍成立」，而 F3 的实现恰好犯了它批评过的错误。

### 2.3 修法（三层判据）

| 层 | 判据 | 作用 |
|---|---|---|
| **块身份锚** | `PLUGIN_BLOCK_ANCHOR_RE`（含 `^Source:\s*mem_[0-9a-f]{32}`、`[Retrieved memory ref` 等强标记） | 先扫全文，命中的行 **±2 邻域**标记为「块内」 |
| **块内弱标记** | `PLUGIN_BLOCK_LINE_RE` = `^Source:\s*\S` \| `^Reference:\s*\S` | **仅在块身份确立时**放行 ⇒ 挡住「截断后仍带后缀」的形态 |
| **可单判补充** | `PLUGIN_TRUNCATED_FRAGMENT_RE`（`^Source:\s*\S+\s*$`）+ `PLUGIN_REF_HEADING_RE`（`^Reference:\s*#{1,6}\s+\S`） | 块身份缺失时仍能独立判定 |

### 2.4 误伤边界（必须守住）

- `Source: mem_xxx 这个格式对不对？` → **保留**（非法 id + 后续整句 ⇒ 非截断残片）
- `帮我看看 [Retrieved memory reference] 这个标记是干嘛的` → **保留**（讨论标记本身的真人句）
- `Reference: 这段话引用自哪里？` → **保留**（Reference 后非 markdown 标题）

---

## 3. T1-1/T1-2：fact 通路补清洗器（⑩-a 与 ⑩-b 的**共同根因**）

| 入口 | 原实现 | 现实现 |
|---|---|---|
| `crossFeed` fact 分支 | `String(ep.intent).slice(0,30)` **未清洗** | 取 raw → F5 判定 → `stripRuntimeIntentPre` → 空值回退 `'episode'` |
| `factCandidateFromRow` | `String(row.subject)` **未清洗** | 三字段同样处理；object 命中 F5 则置 `null` |

**真机三条脏 fact 的实际字段值**（本套件 [6] 组逐字使用）：

| factId | 脏形态 |
|---|---|
| `fact_pre_ac4920327df6601f25200d66e52df71f` | subject 含 **22 个 U+FFFD** |
| `fact_pre_a9380f5bca22011e33547a45542c61a3` | object 内嵌 `Current DSH file policy: …` |
| `fact_pre_dda6cc1f36176f5ea000c6f681ea6818` | object 内嵌 `Approval prompts are disabled …` |

---

## 4. ★ F5：行内残留（**新套件自己抓出来的缺口**）

### 4.1 发现过程

新套件首轮跑出 **1 条真 FAIL**：[6] 组 `真机 fact[1]` 未通过。追查发现：

```
object = "现在是什么情况？ Current DSH file policy: danger-full-access. The DS"
         └─真人话─┘ └──────────── 运行时信封 ────────────┘
```

### 4.2 为什么清洗器处理不了它

`stripRuntimeIntentPre` 是**按行判断**的 —— 删掉这样的整行会**连带丢掉真人话**，
所以它必须保留 ⇒ **「清洗后是否变化」这条判据对行内混合天然无效**。

### 4.3 修法：新增 F5 判据（不做清洗，只做判定）

`RUNTIME_RESIDUE_RE` 匹配**行内任意位置**的运行时标记短语：
`Current DSH file policy` | `Current runtime context` | `Approval prompts are disabled in this session` |
`[Retrieved memory ref` | `Verify against the current user request` | `If a reference hints at what you need` |
`Reason: fv2 lane=` | `Score: N.N (rank N/N)`

`looksRuntimeResiduePre(text)` → 布尔。**命中即判脏并丢弃该字段**（不做「清洗后照写」——
这符合本仓纪律：fail-soft 必须留痕，静默改写等于悄悄改数据并丢失诊断事实）。

**接入三处**：`crossFeed` fact 分支 · `factCandidateFromRow` · `hubFlushTick` 的 `dirty` 判定。

> **F5 与 F1/F2 的区别**：F1/F2 判「**整行是**信封」，F5 判「**行内夹带**信封」。

---

## 5. T1-3/T1-4/T1-5：hubFlushTick 内容卫生门

⑩-b 取证结论：该通路 **6 道过滤全是「结构性」**（`state.flushed` / `count<8` / `subj` 非空 …），
**没有一道内容卫生** ⇒ 脏 fact 实测已写入正文并归档
（`archive/notes-archived.md:493` 的 `## DSH ������（M8 固化）`）。

| 项 | 原实现 | 现实现 |
|---|---|---|
| **T1-3** 卫生门 | 无 | `cSubj/cObj/cPred` 过清洗器 **+ F5 三项** ⇒ `dirty` 则 `mark flushed` + `diag` + `_degradePre.record('hub-flush',…)` + `continue` |
| **T1-4** 换行归一化 | 无 | `subj1/pred1/obj1 = ….replace(/\s*[\r\n]+\s*/g, ' ').trim()`，且**拼接确实用归一化变量** |
| **T1-5** 失败留痕 | `catch (_) {}` **全吞** | `catch (eFlush)` + `diag('hub flush FAIL: …')` + `_degradePre.record('hub-flush','append-failed:…')` |

> **为什么脏 fact 处理成 skip 而不是「清洗后照写」**：本仓纪律是 fail-soft 必须留痕、
> 不得静默改写。清洗后照写等于悄悄改数据，并丢失「曾出现脏 fact」这一诊断事实。

---

## 6. T2：四项结构加固

| 项 | 问题 | 修法 |
|---|---|---|
| **T2-1** | 「已在正文」分支只 `flushed=true` **从不 `count++`**，且完全静默 | 补 `diag('hub flush skip(already-in-body): …')`；**保留「不写正文不计额度」的语义**（这是正确行为，问题只在于原先完全静默） |
| **T2-2** | disposer 只 clear 两个 interval，**漏 `hubBootTimer`** | 补 `clearTimeout(hubBootTimer)` ⇒ dispose 后不再有回调 |
| **T2-3** | `flush-state.json` 裸 `writeFileSync`，无锁无 tmp+rename | 改 **tmp + `renameSync`** 原子替换 |
| **T2-4** | `setInterval(() => { void hubFlushTick() })` **无重入保护** | 加 `hubFlushInFlight` 标志 + `try/finally` 复位；定时器改走 `hubFlushTickGuarded` |

> **T2-3 的真实危害**：写坏后 `hubFlushLoad` 静默吞异常 ⇒ `flushed` 回退到旧值
> ⇒ **已写过的 fact 会被再写一遍**（正文出现两个同名 `（M8 固化）` 段落）。

---

## 7. ★ 变异演示：从「假绿 8 条」到「17/17 全真红」

**这是本轮最有价值的方法论发现。**

### 7.1 首轮结果：**8 条假绿**

| 假绿项 | 根因 | 处置 |
|---|---|---|
| T1-0c/0d 块身份 | **断言太弱**：原用例的每行都被其他判据命中 ⇒ 该路径实际未被覆盖 | **造真正需要块身份的用例**：`Source: mem_<截断> / Wo`（F3 与残片判据都不匹配） |
| T1-1 crossFeed | **漏测**：原套件只测了 T1-2 | 补源码级断言（完整表达式） |
| T1-4/T1-5/T2-3/T2-4 | **断言的是字面量存在，不是完整表达式** | 全部改为断言完整表达式 |
| T2-3 锚点不唯一 | 全仓 `renameSync` **有两处** ⇒ 锚点命中邻近代码 | **限定在 `hubFlushSave` 函数体内**断言 |
| F5a | 锚点串与实际代码不符 | 读实际代码取准锚点 |

### 7.2 过程中发现的两个次生问题

1. **`looksRuntimeResiduePre` 漏写 `export`** ⇒ `SyntaxError: does not provide an export named …`。
   教训：新增导出必须跑一次真实 import 验证，`node --check` **查不出**这个。
2. **T1-5 的首个变异体是无效变异**：写成 `catch (eFlush) { if (true) {} else {` ——
   `if (true)` 之后仍执行原分支，**语义没变** ⇒ 假绿是**变异体写错**，不是断言太弱。
   处置：改用 `lineContains/lineTo` **整行替换**（新增能力），把留痕真正删掉。

### 7.3 最终结果

```
真红 17 / 假绿或锚点丢失 0  （共 17）
SHA256 还原校验：clean / hub / idx 三文件**逐字节一致**（零残留）
```

---

## 8. 验收证据

| 项 | 结果 |
|---|---|
| `node --check` 三文件 | OK |
| 行尾 | 全部 **CRLF**（`index.js` 11115/11115 · `memory-hub-pre.js` 349/349 · `intent-clean-safe-pre.js` 230/230） |
| 新套件 `smoke-test-batch11` | **PASS 73 / FAIL 0** |
| 既有契约守卫 `batch9`（⑨） | **33/33** |
| 既有契约守卫 `batch10`（⑪） | **57/57** |
| 既有契约守卫 `r5-envelope-structural` | **36/36** |
| 变异演示 | **17/17 真红** + SHA256 零残留 |
| **全量回归** | **PASS 133 / FAIL 0 / TIMEOUT 0（139.6s）** |

> 基线为 132；+1 = 本批新增的 `batch11`。

---

## 9. 本轮没有做的事（明确边界）

1. **没有碰 `MEMORY.md` 任何字节** —— 存量 3 条脏 fact 按用户拍板走**路 C（靠卫生门堵住，不改数据）**。
2. **没有直接改 `hub-pre/*.json`** —— ⑨ 的教训：宿主内存持有副本，`dispose()` 会无条件回写 ⇒ 改盘会被回滚。
3. **没有动 T3** —— 用户已拍板「T3 系统性收口单独立项，前端之前做」。
   本轮只在**三个已知入口**设防（fact 两处 + hubFlushTick）；T3 要解决的是
   「把 `sanitizeForWrite` 下沉到写原语 ⇒ 20 条写入路径自动受保护」，那是另一个战场。
4. **没有重启宿主**（用户硬性规则）。

---

## 10. 遗留与本轮新增的待办

| 项 | 说明 |
|---|---|
| **待用户重启宿主** | `lib/` 三文件已改未生效 |
| **T3 立项** | 20 条写入路径 × 3 个消费方，无联合门禁 |
| **前端可读性** | 用户追加：「procedure memory / skill 的内容、**晋升的原因**都要在前端更好地表示」⇒ 已登记进 `PRE-FRONTEND-CHECKLIST-20260919.md` §4（R2 需 host 侧改动：`overview()` 目前只投影 `procedureId/title/stage/riskLevel/evidence/pinned/observationOnly`） |

---

## 11. T3 执行记录（2026-09-19 · 第 2 批）

### 11.1 ★ T3-1 原方案被实测推翻（两处数据破坏风险）

⑩-b 报告的 T3-1 写的是「把 `sanitizeForWrite` 下沉到 `appendText`/`writeFull` ⇒ 20 条通路全受保护」。**取证发现不能照做**：

| 风险 | 证据 |
|---|---|
| **① 体量截断** | `sanitizeForWrite` 超 `maxEntryChars`（默认 **8000**）时**不拒绝而是 `slice(0,8000)` 静默截断**（`:8327-8329`）。而 `writeFull` 承担「原文保底归档」（`:7723`，注释即写「绝不丢信息」）与「归档日志原文内联」（`:7733`）；实测真实日志 **77805 / 52394 / 43224** 字符 ⇒ 下沉后这些会被砍到 8000。 |
| **② `RAW_JSON_MARK` 大面积误伤** | 该正则含**裸词 `updatedAt`**。实测扫描 **541 个真实记忆文件：124 个命中**（多数是正常提到 `updatedAt` 的正文）。它是**入口级**判据（针对「AI 调写入工具时传外部画像 raw JSON」），不适合审「整篇文档 / 任意追加」。 |

### 11.2 T3-1 实际落地（用户拍板：**新开一个，不拆既有函数**）

**新增 `hygieneGateForPrimitive(text)`**（`index.js`，独立于 `sanitizeForWrite`）：
- **只做卫生**：`mojibake` / `stutter` / `base64` / `duplicate-lines` —— **无体量上限、不截断、不改写正文**（返回体只有 `{ok, reason?}`，无 `clean`/`truncated`）。
- **刻意不含 `RAW_JSON_MARK`**（理由见 11.1②）。
- **只挂 `appendText` 一处**，**不挂 `writeFull`**（它写整篇文档，命中面过大；且 `:7723` 是保底归档，绝不能因误伤而失败）。
- **fail-soft**：内部异常一律视为放行 —— 新守卫绝不成为新失败源。
- **拒绝时抛出** `memoryWriteError('hygiene', {reason})`，与写入原语既有契约一致（调用方已有 try/catch 兜底）。

**`sanitizeForWrite` 一个字节未改**，现有 6 个入口继续用它（`WRITE_GATE_REASON` 的 `raw-json` 文案也保留）。

### 11.3 ★ 顺带修复一个既有数据丢失 bug（必须修，否则新门会引爆它）

`maintain()` 第 4 步的删除循环**遍历的是 `oldLogs` 而不是 `archived`**：

```
[归档] catch (e) { console.error(...) }      ← 失败只记日志，archived 里没有它
[删除] for (const log of oldLogs) rm(...)    ← ★ 归档失败的也照样删
```

上方注释虽写「原文已在 archive/ 保底」，但那两段代码并不保证这件事。**加了卫生门之后，脏日志会让归档失败并被删 ⇒ 永久丢失。**
**修法**：删除以 `archived` 为准（`if (archived.indexOf(log.name) === -1) { kept.push(...); continue }`）。

### 11.4 验收证据（T3-1）

| 项 | 结果 |
|---|---|
| `node --check` | OK · 全 CRLF |
| **真实 `import` 验证** | OK（`node --check` 查不出 export 缺失） |
| **探针 `artifacts/_probe-t3.mjs`** | **13/13 全绿**（含 3 条反向保证：大文本放行 · `sanitizeForWrite` 仍截断 · 仍拦 raw-json） |
| **误伤扫描 `artifacts/_scan-t3-falsepos.mjs`** | 541 文件：判据收窄前「整文件被拒 **129**」→ 收窄后 **5**（1 mojibake + 4 stutter，**均为真脏**） |

### 11.5 ★ T3-2 判定为「不做」（原报告判断有误）

⑩-b 报告称 `m4-corpus-pre.js` 的 `dropped[]` 需「补 degrade 台账，让静默丢弃可见」。**取证推翻了「静默」**：

| 消费者 | 位置 | 实际行为 |
|---|---|---|
| **审计持久化** | `shadow-host-pre.js:346-351` | 映射进 `appendAuditDurable(ev)`（`stage/reason/memoryId/sourceRef` + counts） |
| **自动自愈** | `storage-manage-pre.js:82-95` | 按 `reason` 分类为 `stale`/`unrepairable`/`ok`，`REPAIRABLE_REASONS_PRE_V1` 命中即 rebuild sidecar |

⇒ `dropped[]` **已被两处真实消费**，不是静默丢弃。且这两处**都没走 degrade 台账**，因为 `dropped` 属**常规观测**而非预期外失败 —— 补 `degrade.record` 会**违反** R4 批确立的纪律（「常规观测走并列通道，绝不 record，否则『有没有降级』永远非空」）。

**结论：T3-2 不是遗漏，是设计。不做。**

### 11.6 探针两次「假失败」的教训（可复用）

初版探针两条 FAIL，**都是夹具写错，不是代码错**：

1. `'abc'.repeat(12)`（无分隔符连写）**不该**命中 `hasStutter` —— 其词规则是 `(\w{2,})(?:[^\w]+\1){3,}`，**要求重复之间有分隔符**（覆盖 `"Run. Run. Run. Run."`）。
2. `'x'.repeat(200)` 想测「大文本不被截断」，却**先命中 `BASE64_LINE`**（`^[A-Za-z0-9+/]{200,}={0,2}$`）⇒ 在长度检查**之前**就返回 `base64`。换含空格/中文的长文本才走对路径。

**通用教训**：写判据探针时，**夹具必须避开其他判据的命中面**，否则测的不是你想测的分支（这是「假红」的常见来源，与 `⑩` 批的「假绿」互为镜像）。

### 11.7 ★ T3-3 撞用户硬规则 · 已停手待拍板

**目标**：`overview()` 暴露 flush 状态 + `reasonCodes` 投影（前端 R2「让人读懂晋升原因」的前置依赖）。

**取证发现的雷**：`procedure-store-pre.js` 的 `promote()` **不是纯函数，有真实副作用**：

| 行 | 副作用 |
|---|---|
| `:295` / `:297` | `stats.approvalAsked++` |
| `:303` | **`p.stage = 'validated'`**（改状态） |
| `:305` | `stats.validated++` |
| `:306` | **`void persist()`**（写盘） |

⇒ 若在 `overview()` 里对每条 procedure 跑 `promote()` 来取 `reasonCodes`，**「打开记忆中枢面板」这个只读动作会让所有够格的技能真的晋升并写盘**。

**正解**：另写一个**纯只读的判定投影**（复算门限 → 返回 `reasonCodes`，不改状态、不写盘、不动 stats），供 `overview()` 调用。

**为什么停手**：这要动 `lib/procedure-store-pre.js` —— 命中用户硬规则
> 「涉及 procedure 记忆引擎（含清洗器）的改动，不得自行实施，必须等用户就整体方案拍板」。

**★ 新增可复用纪律**：给只读投影（面板/概览）复用会改状态的判定函数 = **点一下面板就等于执行一次晋升**。复用任何判定函数前，必须先查它有没有副作用（改状态 / 写盘 / 改统计）。

### 11.8 ★ 本条日志的端到端实证（`RAW_JSON_MARK` 误伤，非纸面推断）

写 `11.1②` 这条记忆时，**日志写入被入口闸门以 `raw-json` 拒绝了一次** —— 原因仅仅是正文里**提到了那个字段名**（`u`…`A`，即 `updatedAt`）。

⇒ `11.1②` 那个「541 文件 / 124 命中」的静态扫描结论，由此获得了**端到端**验证：该判据确实会把「正常提及该词」的内容误判为外部画像 raw JSON。**这也是 `hygieneGateForPrimitive` 刻意不含它的直接理由。**


---

## §12 T4 完工 —— procedure memory 的**模型直写通路**（2026-09-19 用户拍板）

### 12.1 用户原话与根因

用户：「原来之前一直都没做模型生成的过程吗？这太恐怖了。赶紧把这个模型生成的过程做了。另外，这个 semantic 和 episodic memory 的部分是不是也没有接入模型啊？」

**取证结论（三条线全部无模型入口，附代码证据）**：
- `defineTool` 全仓仅 16 个，**零** `memory_fact*` / `memory_episode*` / `memory_procedure*`。
- procedural 线唯一来源 = `memory-hub-pre.js:142-189` `crossFeed()`，把每个"成功 episode"机械切成候选；
  而 episode 的 `actions` 恒为 `['user','user','user']`（`episodes.json` 实测行）⇒
  产出 14 条里 **13 条 evidence 全 0 / successCriteria 全 0 / steps 是 "步骤1: user" 占位符**。
- **清洗器无法解决**：`['user','user','user']` 里本就不含流程信息 —— 这是**结构性天花板**，不是清洗不足。
- episodic：`index.js:7382` `hub.stores.episodic.append({...})` 在自动沉淀路径内，**100% 宿主自动**，无工具。
- fact：仅 `upsert(cand)`(`fact-store-pre.js:169`) + `ingestJudgementRows`(`:456`)，模型无直接路径。

### 12.2 改动（两文件）

**`lib/procedure-store-pre.js`** —— `promote(procedureId, extraEvidence, opts)` 新增第三参：
- `opts.authorizedBy === 'model'` ⇒ **跳过两条统计证据门**（`minSessionDiversity` / `minSuccessCount`）。
- **为什么必须跳**：这两条门是给机械生成的观察行用的防污染护栏（靠"反复出现"累积证据）；
  而模型主动写出的真技能（带 steps + successCriteria）**天生零历史证据**，不放行则永远卡 `diversity-below-3`。
- **授权仍不能突破的结构门**（护栏保留）：`deprecated` 短路 / `isObservationOnlyPre` 短路 /
  `no-success-criteria` / `correction-rate` / `has-correction`。
- **留痕**：晋升成功写 `p.authorizedBy`，`reasonCodes` 追加 `model-authorized`（可审计、前端可展示）。
- **向后兼容**：`opts` 缺省 `{}` ⇒ `authorizedBy` 为空串 ⇒ **未授权时行为逐字节不变**（T4-1 锁定）。

**`lib/index.js`** —— 两处：
1. 新增 `defineTool('memory_procedure_pre', ...)`（**工具数 16→17**）：
   - `action: 'write' | 'activate'`；`write` → `observe()` 进审批列表；
     `activate` → `observe` → `promote(授权=model)` → `activate` → **自动导出 SKILL.md**。
   - `steps`/`successCriteria`/… 用**字符串分行**接收（`defineTool` 不支持 array schema）；
     行首 `1. `/`- `/`* ` 自动剥离（模型输出格式不稳定的兜底）。
   - 无 `successCriteria` 时**显式警告**（该条目结构上无法晋升）。
2. `renderMemoryStatic()` 内新增注入语：技能库直写引导（用户原话「如果有值得介入 procedure memory 的东西，
   那就接入写进审批列表」），含判据「下次我遇到类似场景，会不会想照做」。

### 12.3 四处工具数硬锁联动（16→17 / legacy 14→15）

加工具**必然**打破数量断言，逐处更新并注明原因：
`tests/smoke/smoke-test.mjs:67` · `smoke-test-m3b3-pre.mjs:43` · `smoke-test-context-observer.mjs:107` ·
`smoke-test-graph-mode-pre.mjs`（A1 graph 17 / **D1 legacy 15** / D2 非法档 15）·
`smoke-test-p23-wb-sidecar-pre.mjs:127-138`（M9 正则 `!== 16` → `!== 17`）。
★ 另在 `index.js` 工具定义处补「工具数 16→17」联动注释（M9 会检查该注释在场）。
★ D1 新增反向断言：`memory_procedure_pre` **不受 boardMode 闸门管** ⇒ legacy 档也必须在场。

### 12.4 验收（全部实跑，非纸面）

| 项目 | 结果 |
|---|---|
| `node tests/smoke/smoke-test-t4-procedure-model-write-pre.mjs` | **36/36 通过** |
| 变异①`if (!authorizedBy)` → `if (true)` | **27 通过 / 9 失败**（真红：授权失效被抓） |
| 变异②删除 `observationOnly` 短路 | **34 通过 / 2 失败**（真红：授权越结构门被抓） |
| 变异后恢复 | SHA256 `F140D7E5AE681EDE14F382D416B930C6A4E1D5389BDCE0B8B9AA36E9122C589` **逐字节一致，零残留** |
| 全量回归 | **PASS 134 / FAIL 0 / TIMEOUT 0（138.1s）**（基线 133 → 134，+T4 套件） |

### 12.5 三条踩坑（新增，可复用）

1. **`addEvidence(pid, ev)` 的签名是 `ev.kind`**，不是 `{correction:1}` / `{success:true}` ——
   传错**静默返回 `bad-evidence` 且不生效**（不是抛错）⇒ 夹具造出的"有纠正记录"根本不存在 ⇒ **假红**。
   本套件**连续踩了三次同一坑**（correction / sessions / success 三处）。教训：造证据类夹具必须**加自检断言**
   （`ae.ok === true` / `evidence.sessions >= 3`），否则测试在测空气。
2. **加工具会连带打破多处"数量硬锁"** —— 本次共 5 个文件 6 处（含一处正则 `!==\s*16`）。
   纪律：新增/删除工具后必须全仓 grep 工具数断言，逐处更新并**写明原因**，不能只改数字。
3. **`memory_procedure_pre` 必须无条件注册** —— 它不属白板 P3 闸门；若误放进 `graphEnabled` 分支内，
   legacy 档就没有模型写入口（本项目 BUG-15 正是"defineTool 写在数组外"的同型缺陷）。
   D1 已加反向断言守住这一点。

### 12.6 边界与未做

- **未禁用** `crossFeed()` 的机械 procedure 分支 —— 那会改 `memory-hub-pre.js`，
  触及用户「procedure 引擎改动须先拍板」硬规则，**待用户裁定**。
- `T3-3`（`overview()` 补投影 / 只读 `evaluatePromotion`）仍待用户 A/B/C 选择。
- 观察线信封残留（`memory-hub-pre.js:152` 只用 `stripRuntimeIntentPre`，缺 F5 同款 `looksRuntimeResiduePre`）
  未修，属同一批 procedure 引擎议题。
- **⚠️ 待用户重启宿主**：`lib/index.js` + `lib/procedure-store-pre.js` 已改未生效。