# 设计契约 · 2026-10-08 · 长用户请求跨接续保全（#302）

> 状态：**方案待拍板**（本轮只出契约，未改任何代码）。
> 依据：`docs/internal/AUDIT-20261008-MINERVAOWL7-BATCH-VERIFICATION.md` 判定 #302 为 A（我方当前树缺陷成立）。
> 行号基准：开发树 HEAD = `b8b9afe`（`lib/index.js` 18,371+ 行，CRLF）。**本仓其他车道在并行改 `lib/index.js`，施工前必须重新定位行号**（本文件每条都附**可 grep 的锚点**，不只给行号）。

## 一、结论摘要

1. **缺陷成立且机制已复核**（真跑）：用户消息 >2000 字符时，目标段落被 `slimTranscriptPre` 的单条截断吃掉；实测 2,224 字符请求其目标位于索引 2,200 ⇒ `carryText` 内含不到、转写文件内也不含。
2. **「第 2 层近期线程恒不投递」是误判，此处撤回**：第 2 层确实投递（实测 carry 含「第2层」标记、`msgCount=4`）。真正的第二处丢失是第 2 层自身受**同一份** `PER_MSG=2000` 截断（`tail` 生成处 `m.text.slice(0, 700)` 用的是**已截断后**的 `msgs`）。⇒ 单条超过 2000 字符的请求在**所有**层都拿不到尾部。
3. **推荐方案＝新增「不截断用户请求原文」独立产物**（`handoffDir/prev-req-<hash>-<stamp>-s<contSeq>.md`，`wx` 拒绝覆盖），**只在存在被截断的用户消息时才写**，**写失败即中止本次接续**（在取消源回合之前），路径并入**永不截断**的导航区。
4. **短请求零影响**：无被截断的用户消息 ⇒ 不新增文件、不改 carry 一个字节（可逐字节断言）。
5. **对既有护栏的影响面已查清**：新文件名落进 `listPrevSessionTranscripts` 的宽正则（⇒ 进 scope=handoff 检索语料、进面板 versions 列表、进 `client.js` 文件名正则），且 `buildContinueCarry` 内 `readdir` 的 mtime 比对会因它而改变 `staleNote` 文案。**均已在 §4 列明并给出取舍**。

## 二、逐问回答

### Q1 产物形态

**位置：`p.handoffDir` 根目录（与转写同目录）。**
- 依据：`handoffDir` 由按**源会话身份**解析的 `resolvePathsForSession` 给出（`buildContinueCarry` 内 `const p = await this.resolvePathsForSession(...)`；`buildPrevSessionPack` 内同源），与转写包同一目录 ⇒ 新会话只需一个相对路径线索即可 read，且天然按工作区分桶（`.dsh/memory/workspaces/<ws>/handoff/`，见 `handoffDir: path.join(projectDir, 'handoff')`）。
- **不建子目录**（备选见下）：根目录与转写同级，避免再改白名单/清理/列举三处正则；子目录方案（`handoff/requests/`）会让 `readdir(dir)` 的列举族与 `archive/` 特例并存，收益不抵复杂度。

**命名：与 #291 已落地的转写命名同族**（#291 已实现，实测其形态为 `prev-session-<sha256(sid) 前 16 hex>-<YYYYMMDDHHmmssSSS>-s<contSeq>.md`，见 `buildPrevSessionPack` 内 `const sidHash = createHash(...)` 与 `const outPath = path.join(p.handoffDir, ...)`）：

```
prev-req-<sha256(sid).slice(0,16)>-<YYYYMMDDHHmmssSSS>-s<contSeq>.md
```

- 三段均为 `[\w-]`，与既有 lister 字符集一致；`sid` 用**完整身份摘要**而非截断（沿用 #291 口径）；并入**已持久预留**的 `contSeq`（同一来源多次生成可区分）；stamp 带日期+毫秒（跨日不撞）。
- **格式：带极薄 frontmatter 的纯文本 md**（不用 json：模型要直接 read 的是人话；不用复杂 md 结构：避免再引入解析器）。建议形态：

```markdown
# 用户请求原文（不截断）— <sid>
<!-- <prevSessionSidAnchorPre(sid, sha256)> -->
- 来源会话: <sid>
- 接续序号: #<contSeq>
- 记录范围: 最近 <N> 条**被截断**的用户消息（单条 >2000 字符），按时间顺序
- 说明: 本文件是**历史消息**原文，可能包含「刷新仪式」等已由宿主投递的条目；请用于核对未完成目标与约束，**不要重做已完成事项**。

## 1. 用户消息（<len> 字符，<ISO 时间戳或 (未知)>）

<原文，一字不截>
```

### Q2 写入时机与失败语义

**写入时机：`buildPrevSessionPack` 内、转写包 `writeFile(outPath, …, { flag: 'wx' })` **成功之后**、`return` 之前** —— 即紧贴现有 `wx` 写块（`const outPath = ...` / `try { … await writeFile(outPath, body.join(NL), { encoding: 'utf8', flag: 'wx' }) } catch (eW) { … }`）。

理由是三条硬约束：
1. **必须在「取消源回合」之前**：取消源回合发生在**调用侧** —— `hostAutoContinue` 内先 `const prepared = await this.buildContinueCarry(oldSid)`（这一步已经跑完整条 carry，含本产物），随后才 `await sc.cancel({ sessionId: oldSid })`。⇒ **把产物放在 carry 链内，顺序天然满足**；若放到 `sc.cancel` 之后的阶段，就会先破坏用户现场再发现写失败。
2. **不能是「写失败也继续」**（本仓既有 fail-soft 惯例在这里要反过来）：转写包失败时 `buildPrevSessionPack` 的既有语义是 `catch (e) { … return null }`（fail-soft，接续照走），而 `buildContinueCarry` 外层 `catch (e) { return { ok:false, error } }` ⇒ 只有**带 `statePersistence` 标记**的错误才会穿透成「接续中止」。本产物若静默 fail-soft，就退化成「报告里那条缺陷换了个位置继续存在」。
3. **与既有 rollback 的衔接**：现有 `catch (eW)` 里已有 `if (contSeq) { try { this.rollbackContSeq(p.ws, contSeq) } catch (eR) {} }` 再 `throw eW`。**新产物的写失败要走同一条 catch**（即：把两次 `writeFile` 放在**同一个 `try`** 内，或复制同一段 catch 语义），从而：
   - `contSeq` 的预留**不回退高水位**（允许空洞、永不回收 —— 2026-10-05 批次 W 用户裁定，注释在 `catch (eW)` 内）；
   - 错误**必须带 `statePersistence` 标记**上抛，才能穿过 `buildPrevSessionPack` 的 fail-soft catch 与 `buildContinueCarry` 的 catch，最终让 `hostAutoContinue` 在建会话/取消源回合**之前**就失败；
   - ⚠️ **实测提醒（本仓坑）**：全局变量 `let statePersistence = false` 声明存在、并且有 `stateError()` 工厂（`buildContinueCarry` 内 `if (… .ok) throw stateError('source workspace unavailable')` 一类即为范式）——**不要新建第二套标记**，照抄既有 `stateError()` 用法。

**写入顺序建议**：先写请求原文、再写转写包？—— **不建议**。保持「先转写、后原文」的理由：转写是既有主产物（其成功/失败口径与 `contSeq` 的分配已绑定），新产物作为**附加**产物在其后写，失败面最窄；两者同在 try 内时先后次序对「失败即中止」的语义等价。

**备选（不推荐）**：写成「失败仅 diag、不中止接续」，把降级事实回传到 `lastOk`/返回体。代价：`lastOk` 目前没有「材料不完整」字段（现字段见 `st.lastOk = { sessionId, fromSid, model, reasoningEffort, workspaceId, permissionPreset, refreshRitual, stopped, notifiedOld }`），新增字段会牵动前端渲染与 `#290`（回执语义）车道 ⇒ 与本批其他车道的改面冲突。

### Q3 读取路径

**放进导航区 `navParts`（永不截断）。**

确切位置与预算：
- 组装函数：`export function assembleCarryPre({ head = [], nav = [], bulk = [], budget = 18000 })`（`lib/index.js`，锚点 `export function assembleCarryPre`）。契约：`nav` **永不截断、配额先扣**（`const fixed = headText.length + navText.length + …`；`const room = Math.max(0, Number(budget) - fixed)`）。
- 导航区在 `buildContinueCarry` 内的落点：`const navParts = []` 声明处，实际 push 在 `navParts.push(guide.join(NL))`（guide 内已有一条「旧会话(…的完整对话转写已写入: <path>」，锚点 `guide.push('- 旧会话(' + pack.sessionId + ')'`）。**新行紧挨该行之后 push**，语义上同属「去哪儿取」。
- 调用点：`const carry = assembleCarryPre({ head: headParts, nav: navParts, bulk: bulkParts, budget: 18000 })`。

**对预算的影响（实测）**：
- 真跑（真 MemoryEngine + 隔离临时 DSH_HOME/工作区/会话文件）：`carryText.length = 1599`，`carryTruncated = false`；导航区起点 `indexOf('【第3层') = 323` ⇒ **nav 段约 1,276 字符**（含 head 之后）。
- 新增一行形如 `- 用户请求原文（不截断，最近 N 条超长消息）: <abs path>（约 NN,NNN 字符）` ⇒ **约 110–160 字符**（路径长度随工作区名浮动；`%LOCALAPPDATA%` 下实测临时工作区路径约 70 字符）。
- 影响：nav 增长 <0.15×预算；**由于 nav 永不截断且先扣**，该增量从 `room` 里扣走 ⇒ 极端满载时 bulk 少放约 160 字符。可忽略但**必须写进判据**（见 §5 判据 2：bulk 截断口径不得因此从 `truncated:false` 翻成 `true`）。
- 施工期护栏：**导航区新增行不得使用会撑爆配平/解析的字符**（本仓既有教训：某些抽取式守卫按花括号配平取函数体）。本行是纯字符串拼接、无花括号，安全。

### Q4 清理与生命周期

**（a）既有正则核对（逐条实测）**：

| 正则/枚举点 | 锚点 | 对新名 `prev-req-<16hex>-<stamp>-s<N>.md` 的判定 | 后果 |
|---|---|---|---|
| `listHandoffLedgers` | `/^(?:handoff-\d{8}-\d{6}(-[a-z])?|PLAN-(?:history-)?\d{8}-\d{6}…)\.md$/` | **不匹配**（实测 `ledgerLister=false`） | 无误识别，账本/白板血缘不受污染 |
| `listPrevSessionTranscripts` | `/^prev-session-[\w-]+\.md$/` | **不匹配**（`prev-req-` 不以 `prev-session-` 开头） | 不会被当作旧会话转写 |
| `handoffPanelData` 的 versions 枚举 | `const names = await readdir(handoffDir)` + `/^prev-session-[\w-]+\.md$/`（锚点 `for (const n of names)` 附近的 `versions.push`） | **不匹配** | 面板「转写列表」不含它 |
| `handoffPanelData` 的 ledgers 枚举 | `readdir(handoffDir)` + `/^handoff-\d{8}-\d{6}(-[a-z])?\.md$/` | 不匹配 | — |
| `fileQ` 只读白名单 | `/^(?:PLAN\.md|handoff-…|archive/PLAN-…|index\.json|events\.jsonl)$/` | **不匹配** | 面板不能直接打开它（**刻意**：不扩白名单＝不加新读口子；模型用 read 工具绝对路径读） |
| `listPrevSessionTranscripts` 若改名为 `prev-session-…` 形态 | 同上 | 匹配 | **会**进 scope=handoff 检索语料 + 面板列表（见下 (b)） |

**（b）推荐命名 `prev-req-*` 的取舍（诚实列出两头）**：
- ✅ 不撞任何既有正则；不进检索语料（避免把用户原始长文本灌进 `scope='handoff'` 语料，稀释账本/白板命中）。
- ⚠️ **但它同样不进 `searchHandoffCorpus` 的词法臂**：该臂是**显式枚举**的（`await scan('白板 PLAN.md', …)`、`listPrevSessionTranscripts(p.handoffDir, 8)`、`listHandoffLedgers(p.handoffDir, 12)`、`listHandoffLedgers(archive, 20)`；锚点 `await scan('白板 PLAN.md'`）⇒ 新产物默认**不可被检索到**。本方案**接受**这一点：它是「按需 read 的逃生通道」，检索入口是导航区那一行；不扩语料是本批的**最小改面**选择。
- 备选：并入 `prev-session-` 前缀（改名 `prev-session-req-…`）⇒ 自动进检索语料与面板列表，但会**顶掉转写列表的 8 篇配额**（`slice(0, limit)` 按名字倒序）并稀释检索命中。**不推荐**。

**（c）生命周期（现状＝没有清理器，这是事实，不是建议）**：
- 实测 grep：`lib/` 内**没有任何针对 `handoff/prev-session-*` 的清理/轮转/保留期实现**。唯一的 GC 是 `subagentGcSweep`，它作用于 `~/.dsh/sessions` 下的**会话目录**（配置 `subagentGcEnabled` / `subagentGcKeepDays`，锚点 `async subagentGcSweep(force)`），**不触碰 `handoffDir`**。
- ⇒ 新产物与既有转写包**同生命周期**：**只增不删**。这是既有事实，本方案**不新增清理器**（新增删除逻辑＝新增风险面，且会牵动白板/账本归档语义）。
- **可见代价（须写进 CHANGELOG）**：每次**含超长用户消息**的接续新增一份原文（大小≈该消息长度之和，典型 10–100 KB 量级；上限可控，见 Q5）。无可读上限 ⇒ 长期运行会缓慢增长；已有先例（转写包同为只增）。
- 备选（待用户拍板，本轮不实施）：按天保留最近 N 份（N 默认 20，写入时顺手删更早的 `prev-req-*`）——纯本地、无跨进程锁，但引入删除语义。

### Q5 边界

**触发条件（推荐）**：`存在任一 role==='user' 且 text.length > PER_MSG(2000) 的消息` ⇒ 才写。
- 全部保留（不去重、不选最近的 N 条）：文档与实现都最简单，且「哪条含目标」无法可靠判定；成本由「只在超长时触发」+「上限」共同兜住。
- **上限（推荐）**：单文件 ≤ 512 KB；超出部分**按时间从旧到新累计截断**并在文件头如实标注 `已省略更早的 M 条（共 XX 字符）`。理由：本仓对同类外部输入已有「有界 + 如实告知」惯例（`sanitizeReservedSyntax` 系）、以及「不得沉默截断」（`assembleCarryPre` 的 notice 就是这条纪律的产物）。
- **短请求行为守恒（硬要求）**：无超长用户消息时——**不写文件**、**carry 逐字节不变**（判据见 §5）。
- 与开关的关系（用户级硬约束「单一开关不得顺带改变其他功能行为」）：本产物属**接续材料**，只在接续路径存在时产生 ⇒ **不新增配置开关**；`handoffEnabled=false` 时既有行为是「转写包属会话层材料、与白板无关、恒可用」（`buildContinueCarry` 内注释明示两层解耦）⇒ 新产物**沿用同一口径**（照旧可用）。

### Q6 可验收的判据（供施工车道直接用）

> 范式照抄本仓既有真执行套件：真 `MemoryEngine` + 隔离 `DSH_HOME`/工作区/会话文件（`state-engine.mjs` 加载器），断言**返回值与真实落盘**，不用源码字符串断言。

**P1（正路径·核心）**：构造单条 2,224 字符用户消息、目标串位于索引 2,200 ⇒ 断言 ①`pack.userRequestPath` 非空且文件存在；②文件内容 `includes(GOAL) === true`；③`carryText.includes(GOAL) === false`（证明 carry 仍不含，产物是补充而非替代）；④carry 的导航区含该**绝对路径**。
**P2（守恒·短请求）**：同夹具但消息 1,200 字符（<2000）⇒ 断言 ①**不新增**任何 `prev-req-*` 文件（目录计数量化：写入前后 `readdir(handoffDir).length` 相等）；②`carryText` 与「未接线基线」**逐字节相同**（sha256 相等）。
**P3（失败语义·负路径）**：把 `handoffDir` 预置为**同名目录**或对目标路径设只读（Windows 取不可写目录）⇒ 断言 ①`buildContinueCarry` 返回 `ok:false`（**不得**静默返回部分材料）；②源回合**未被取消**（以替身 `sc.cancel` 调用计数断言 = 0，替身由 `hostAutoContinue` 的 `_sessionController` 注入）；③`contSeq` **未回退**（高水位单调：`allocContSeq` 前后读回值不回退），且不跳号复用。
**P4（命名唯一性）**：同一来源、同一毫秒、不同 `contSeq` 连续两次生成 ⇒ 断言两个 `userRequestPath` 不同、且旧文件内容未被覆盖（先读旧文件 mtime+内容前后比对）。
**P5（正则边界·防误识别）**：把生成的 basename 分别喂给三处判据 ⇒ 断言对 `listHandoffLedgers` 与 `listPrevSessionTranscripts`、`fileQ` 白名单**均为 false**（若施工时改了命名，此条必须同步改口径）。

**负路径变异（必红）**：把新产物的写入整段注释掉（或把 `wx` 改回普通覆盖写）⇒ P1 必红、P4 必红；还原后复绿。**变异锚串必须先断言恰命中 1 次**（本仓纪律）。

## 三、推荐方案 vs 备选

| 维度 | **推荐** | 备选 A（不推荐） | 备选 B（可议） |
|---|---|---|---|
| 载体 | 新增 `handoffDir/prev-req-*.md`（纯文本 md + 极薄头） | 把 `PER_MSG` 抬到 6000–8000 | 扩 `searchHandoffCorpus` 语料臂纳入新产物 |
| 行为影响 | 只增产物 + nav 一行 | **改变所有接续的摘要形状**（第 2/3 层一起变长），且仍有上限 ⇒ 更长请求照样丢 | 检索可命中原文 |
| 与本批其他车道 | 只碰 `buildPrevSessionPack`/`buildContinueCarry`/`assembleCarryPre` 调用点 | 碰 `slimTranscriptPre` 默认值（被多支套件锁） | 碰检索排序 |
| 结论 | **推荐** | 拒绝：治标且污染既有字节口径 | 先不做；若后续需要检索原文，再单独立项 |

备选 C（**部分采纳**）：`PER_MSG` 只对「最后一条用户消息」放宽到 4000（现状 2000 对多数真实长请求仍会丢）。**本轮不建议**：属「同一截断族」的第二处改动，会与转写/近期线程的既有字节口径冲突，且与本推荐方案功能重叠。

## 四、风险与回滚点

| # | 风险 | 证据/机制 | 缓解 | 回滚点 |
|---|---|---|---|---|
| R1 | 写失败把「本可成功的接续」变成失败 | 新产物在 carry 链内 ⇒ 失败上抛即中止 | 只在**存在超长用户消息**时才写（短请求不触碰新代码路径） | 把新写入块整段摘除即可恢复旧行为（单块、无跨文件耦合） |
| R2 | `contSeq` 语义被搅动 | 现有 `catch (eW)` 已含 `rollbackContSeq` + 注释「预留不回退」 | **复用同一 catch**，不新增回退逻辑 | 同上 |
| R3 | 文件名落进某个既有正则 | 实测三处正则均不匹配 `prev-req-*`；但 `listPrevSessionTranscripts` 是**宽**正则，未来若改名会意外命中 | 命名固定 + P5 判据钉住 | 改前缀即可，无需迁移（旧文件无害） |
| R4 | 导航区增长挤压 bulk | `assembleCarryPre` 先扣 nav（实测 `room = budget - fixed`） | 预算实测 18,000、增量 ~160 字符；P2 断言 carry 逐字节守恒（短请求） | 缩短新增行文案 |
| R5 | 产物只增不删导致磁盘增长 | 实测 `lib/` 无 handoff 清理器；`subagentGcSweep` 只管会话目录 | 单文件 ≤512 KB；文档化「只增」事实 | 后续可选按天保留 N 份 |
| R6 | 与并行车道撞改 `lib/index.js` | 本仓多车道同时在改同一文件 | 施工前重新 grep 锚点；本道改动集中在 `buildPrevSessionPack` + `buildContinueCarry` 两个函数体，改面窄 | 逐块摘除 |

## 五、待定（缺什么）

1. **`statePersistence` 的错误工厂确切名字与用法**：本方案按既有注释与用法写「照抄 `stateError()`」，但**未逐字核对**该函数签名与 `statePersistence` 赋值点在当前 HEAD 的行号（另一车道正在改 `lib/index.js`）⇒ 施工第一步须先 grep `statePersistence` / `stateError(` 定位并照抄；不确认就动手属猜测。
2. **「多久算过期、保留几份」无用户裁定**：本方案推荐「不清理（与转写同生命周期）+ 单文件 512 KB 上限」，是否加「按天保留 N 份」**待拍板**。
3. **是否要把原文纳入 `scope='handoff'` 检索语料**：推荐「否」（最小改面）；若用户希望「以后能检索到原始请求」，需另立一项并同时评估语料稀释与配额挤占（备选 B）。
4. **桌面端到端未做**：本契约的所有量化结论均来自「真 `MemoryEngine` + 隔离环境」的 Node 侧真跑，未过 DSH 桌面宿主（与前几批同口径）。

## 六、复算命令（本轮取证，可复跑）

- 缺陷复现（超长请求丢失）：真 `MemoryEngine` + 临时 `DSH_HOME`/工作区/`sessions/project/<sid>/session.jsonl`（单条 2,224 字符、目标在索引 2,200）⇒ `carryText.length=1599`、`goalInCarry=false`、转写内 `goalInTranscript=false`。
- 分层核对：4 条历史消息 + 1 条超长请求 ⇒ `layers = 第0层/第1层/第2层/第3层 全 true`、`msgCount=4`、`rawTailLen=1117`、`rawHasGoalTail=false`（证明第 2 层**有投递**、但尾部被 2000 截断）。
- 命名边界：三个候选名分别过三处正则 ⇒ `prev-req-*` 三处全 false；`prev-session-*` 命中 `listPrevSessionTranscripts`（true）、另两处 false。
- 清理器存在性：`grep` `lib/` 全量 ⇒ 无 `handoff` 目录清理/轮转实现；唯一 GC 为 `subagentGcSweep`（作用域 `~/.dsh/sessions`）。
- 导航区构成：`assembleCarryPre` 契约与实测（nav 起点 323、carry 1,599、`truncated=false`）。