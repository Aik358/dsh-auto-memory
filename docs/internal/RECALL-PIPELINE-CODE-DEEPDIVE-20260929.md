# 唤回管线代码级深读 + 四个演进方向的落点设计

日期：2026-09-29
性质：代码深读报告（配套 OFFICIAL-MEMORY-PRESTUDY-20260929.md 的规划篇；本篇全部结论带文件:行号）
方法：实读 index.js(15822 行) 唤回相关全部模块 + semantic-js/l0-extract/l0-index/l0-index-sync/shadow-retrieval/context-bridge/context-host/activation-host/activation-inbox/semantic-decide/memory-anchor/foldSessionLogEvents + worker_semantic_v1.py 检索核；真机验证 L0 落盘索引 12 文件/984 条/7.86MB/384 维。

---

## 一、现行唤回管线（实测代码图）

### 1.1 三条并行车道（真实接线）

```
[A] 注入车道（每轮无条件）    systemPrompt.context('dsh:auto-memory-pre')
    index.js:13479 → renderMemoryDynamic(:6826) → composeMemoryEnvelopePre 分项账本
    预算: injectBudgetChars(1600)+白板1200+账本800+Tier0目录(tier0BudgetShare 0.4)
    节流: 新turn强制完整版(:13537 turnBoundaryKeyPre) / 日志指纹+snapshotMinGapRounds(5)精简版(:13641)
    排序: must(规则/用户级/笔记/框架行) > normal > low(日志)
[B] 主动检索车道（模型调用）  memory_recall(:13801) → engine.recall(:7405)
    词法臂: 逐行 includes 计分(:7447)
    语义臂: l0Corpus → miv 哈希 → _semanticRankBest(:7545) = C3(python sidecar dense_search) 优先,
            失败回 C2(_jsSemanticRank:13154 → _jsSemantic.rank → semantic-js.js rank())
    融合:   RRF rankFusionRRFPre(:7621, k=60) + importance 加权(0.5+0.5*imp, :7621)
            + 时间臂 temporal-parse(:7596-7608)
    展示:   L0 摘要行含 [mem_id] ×分 #rank → expand="mem_xxx" 按锚点字节区间取原文(:7810)
[C] 主动唤回车道（系统判定）  context-host.onSegmentAccepted(:303)
    每个可接受 Segment → buildQueryPlan(window 8段/4096字) → lexicalSearch(BM25)
    + C2 稠密排名(_jsSemanticRank on buildObserveWindowText) → fuseD6Pre(0.7/0.3) → envelope(8 refs/64KB)
    → fv2 判定(_jsDecide:13234: LR意图头+Platt → explicit/proactive 车道, echo veto+margin+deltaExp 门)
    → emit(jsEmitMode≠shadow) → activationHost inbox packet → pre-step claim(:410) →
    Reference Tail 渲染面('dsh:m6-reference-tail-pre' :13681) 注入 4096B 预算四行块(:274 renderReferenceTail)
```

### 1.2 关键数据结构（改造时必须保持契约的）

- **锚点** `<!-- memory:mem_<32hex> -->`（l0-extract.js:35）；`parseAnchors(buf)`（memory-anchor.js:119）已产出 **`lineStart/lineEnd/byteStart/byteEnd/recordDigest`** —— 行区间元数据**现在就有**，不是要新建。
- **L0 条目**：`{id, l0(≤160字), source, chars, bodyChars, layer(user|project|log|reflection|whiteboard), status(current|superseded|retracted)}`（l0-extract.js:406）。
- **L0 落盘向量索引**：`~/.dsh/memory/semantic-pre/l0/l0-index-<wsHash12>-<layer>.json`，条目 `{id, vector[384], l0, source, l0Hash, updatedAt, layer, status}`，身份门 `engid_pre_*`（换引擎整文件作废全量重建），**真增量**：同 id l0Hash 复用 + 跨 id l0Hash 复用（l0-index.js:152-199）。真机 12 文件 984 条 7.86MB。
- **miv**：canonical sorted [id,L0] 元组 sha256 前 32 hex，`idx_pre_` 前缀（:7542）——语义引擎用 miv 变化判断索引是否需重建（semantic-js.js:330 `buildIndexIfStale`）。
- **CoT 缓冲**：`assistant/chunk` 的 `reasoning-delta` → runtime.reasoningBuf（4096 上限，≥512 字符或 ≥1500ms 冲刷成 kind='reasoning' Segment，index.js:2303-2335）。**它已经把思维链变成普通 Segment 参与检索**——「检测疑虑」的信号源已经进来了。
- **写入门/判据门**：sanitizeForWrite 六原因；criteriaGate 默认 true。

### 1.3 已有但**读侧未接**的能力（改造红利）

① `l0-index-sync.js` 每 5 分钟把 L0 摘要**连向量**落盘（l0IndexSyncTick :13045），但 **recall 的语义臂从不读这些文件**——它每次用当前 l0Corpus 现场构造 miv，索引引擎在内存里重建（semantic-js.js:329 buildIndexIfStale）。落盘索引目前只是「可诊断快照」，检索零收益。
② `shadow-retrieval.js` 的 BM25 词法核（lexical_pre_v2, k1=1.2 b=0.75，含 CJK 2-gram/哈工大停用词 507 词/短语边界匹配）**只服务于 [C] 车道**；[B] 车道 memory_recall 的词法臂仍是裸 `includes` 计分（:7447）——同仓两套词法，质量差距大。
③ `slimTranscriptPre`/`prevSessionL0Pre`/`prevSessionSidAnchorPre`（:1078-1146）：旧会话转写**已经有**瘦身+稳定锚+L0 行，接续时写进 handoff/prev-session-*.md，但**只进 scope='handoff' 词法检索，不进语义臂、无向量**。

---

## 二、演进方向 1：行级实时语义检索（正式回答"能不能不建索引实时找行"）

**判定：向量索引必须建，但 90% 零件已存在，且落盘索引管线现成只是没接读侧。**

### 改动落点（按文件）

1. **嵌入单元**：`l0-extract.js` 加 `buildLineChunksPre(text, srcPath)`（新导出，~80 行）——在 `parseMemoryItemsPre` 锚点切分之上，把超长条目 body 按 `## 节`/固定 512 字窗口二级切分；每块产出 `{id: 派生 mem_id（parentId+'#'+ordinal 的 sha256 32hex，保持 mem_ 契约可 expand）, l0: 块文本前 160 字, lineStart, lineEnd, parent: 条目 id}`。**锚点行区间直接取自 parseAnchors 既有字段，不新算**。
2. **落盘索引复用**：`l0-index-sync.js` 不动——它的 API 天然接受任意 layer 文本；给 L0_LAYERS 白名单（l0-extract.js:96）加 `'dialogue'` 或直接复用 `log` 层，文件名/身份门/增量复用（l0Hash）全部免费获得。
3. **读侧接线（核心缺口）**：`semantic-js.js` 引擎加第二个索引源——`rank()` 现在只认 corpusSnap.records 现场重建（:381），加 `rankCached(dir)`：直接 `readJson` l0-index-*.json，命中当前 miv 则跳过重建。**这是把 [B] 车道从"每次全量现场嵌入"变成"读盘增量"的最小改动**（引擎已有 `embedPassages` 独立出口，:413，无需动 tier 加载）。
4. **回显行号**：`recall` 的 L0 展示行（:7663）追加 `← file.md:L23-41`（数据来自 chunk 元数据）；`expandMemoryRecordPre`（:7810）已按 byteStart/byteEnd 切片，天然支持按块 expand。

### 为什么"纯查询实时嵌入"不可行（代码依据）

rank() 对 984 条现场重建 = 984 次 e5 前向（e5-small q8 单次 ~3-8ms）≈ 3-8s/查询，且 miv 每写一条就变 ⇒ 缓存永不命中。真机 7.86MB/984 条已证明落盘增量（l0Hash 复用）是唯一可扩展路径。

---

## 三、演进方向 2：对话归档向量化（第四条腿）

**判定：抽取器本体已存在 70%。**

### 改动落点

1. **抽取**：`foldSessionLogEvents`（:12146）已经把 session.jsonl.zstd 解析成 `msgs: [{role:'user'|'assistant'|'tool_call'|'tool_result', text, attachments}]`——它就是官方 `projectSessionConversation` 的插件侧等价物。**新增 `buildDialogueArchivePre(sid, msgs)`**（~40 行）：过滤 tool_*，逐轮产出 `### 轮 N（seq a-b）**用户**…**助手**…`，直接复用 `slimTranscriptPre` 的 perMsg/total 预算参数（:1078 已有 2000/60000 两级预算）。
2. **触发点**：接续路径 `buildPrevSessionPack`（:5126）已经解压全量事件并产出转写——在同一处顺手产出归档文件 `handoff/dialogues/<sid8>.md`（一个会话一次，有 mtime 幂等判断）；再给一个后台巡检（借 subagentGcSweep 的每日巡检时点，只读增量）回填历史会话。
3. **入库**：归档文件走 `pushL0('dialogues/<name>', …)`（:7510 同款）进检索语料；向量走第 1 方向的 l0-index-sync（dialogue 层）。
4. **回显**：命中行带 `dsh-session:<base64url(sid)>` URI（官方 0.2.0 协议）——**注入侧不用做任何新东西**，`renderReferenceTail` 的四行块 Reference 字段（:253）直接把这个 URI 当 refText 塞进去即可；宿主 0.2.0 的 session-reference 解析器会认它。
5. **预算红线沿用**：decodeZstdFramesHead 160 帧/4MB、>16MB 跳过（lexicalSessionScanFallback :3790-3792 实测安全参数）；descriptor v2 毒会话教训 = 单会话 try/catch 失败即跳，绝不毒化整批。

---

## 四、演进方向 3：疑虑检测唤醒（轮后自纠）

**判定：数据通路已全通，只缺一个判定器。**

### 现有通路（无需新建任何观察器）

`reasoning-delta` → reasoningBuf → 冲刷为 `kind='reasoning'` Segment（:2303）→ context-host 已对 `seg.kind==='reasoning'` 触发 `_jsDecide`（:450 条件里明确列了 reasoning）——**"监测 CoT"这半边现在就在跑**，jsDecideShadowLog 每条决策落盘。缺的只是"疑虑词典/分类器"这一路特征。

### 改动落点

1. **特征器**：`semantic-decide.js` 加 `hesitationScorePre(text)`（纯函数 ~50 行）：词表（hmm/um/等一下/不对/重来/似乎/不确定/其实…+ERR_TOKENS 复用 :24）+ 模式（自问自答 `？.{0,20}(让我|先)`、重复修正 `不对.{0,30}应该是`）；口径对齐 normalizeText（:64 Python 对齐版）。挂进 fv2 features 新字段 `hesit`，由 `_jsDecide`（index.js:13234）在 features 组装处（:13265）填入。
2. **轮后钩子**：`assistant/message` 的 ingestEnvelope（:2225）处——seg.kind='assistant' 本来就触发 _jsDecide；改造点只是：**decision=emit 但 emitMode=shadow 时不再静默丢弃，改为写 `rt.hesitCarry = {at, memoryIds}`**（runtime 态，轻量）；下一轮 pre-step（:13416）读 `rt.hesitCarry` 新鲜（<10min）则把对应 memoryIds 以 'must' 段塞进 renderMemoryDynamic 的 envelope（pushPart 一行）并清位。**零新协议、零新事件、改动三个函数**。
3. **误触防线**：`AI_MAX_PER_HOUR` 同款冷却直接复用 `jsDecideCooldownRounds`（:457）；词表保守起步（宁漏勿误，同 l0-extract isDegenerateHeading 的「宁可漏判」纪律 :82）。
4. **回显哪一行**：hesitation 命中的候选来自 rank.scores → _records 里就有 lineStart/lineEnd（方向 1 接上后）——Reason 行加 `Loc: file:L23-41` 即可。

### 流式 CoT 中断注入不可行的代码证据

agent/pre-step 只在 step 放行前跑（:13416），Reference Tail 只渲染 claimed packet（activation-host:448），两者都无法在 assistant 流式期间触发；宿主侧 session/event 也是 post-commit（:13467 注释「post-commit append feed」）。⇒ 任何"打断"都到不了模型当前请求，只能影响下一请求——轮后自纠是工程上唯一落点。

---

## 五、演进方向 4：官方记忆在场时的分工（代码级探测）

```js
// 探测（ctx 可用时,init 处 :13302 同款）:
engine._officialMemory = !!(ctx.get('memory') || ctx.get('memoryService'))
// 分工点在 renderMemoryDynamic 的 must 段(:6969-6970):
// 官方在场 → user-memory/project-notes 降为 normal + 注入行改"事实层由官方记忆提供,过程层见下"
// procedure/handoff/PLAN/tier0 段保持原样
```
写侧镜像等官方接口定型再做（现在没有可调用的官方写入面）。改动范围：**一个函数、一个配置键**（`officialMemoryDegradeFacts`，默认 false）。

---

## 六、落地顺序建议（按依赖，不是按价值）

1. **D1 行级切块 + 落盘索引读侧接线**（二§2.1-2.4）——后面三件全依赖它。
2. **D2 对话归档**（三§3.1-3.4）——依赖 D1 的索引通道。
3. **D3 疑虑自纠**（四§4.1-4.4）——可与 D2 并行，独立于索引也能跑（候选来自现有 rank）。
4. **D4 官方分工**——等官方包出现，前置改动半小时。

### 契约红线（动代码前必读）

- `smoke-test-three-layer-pre` 以**源码字面量**锁定 import 形态（:7485-7494 三处单独 import 不可合并）。
- `_jsDecide` 的 features 与 Python worker 逐字段对齐（semantic-decide.js 头注）——加 `hesit` 字段必须 Python 侧同步，否则破坏孪生对齐（:13241 注释的血泪史）。
- L0 索引文件有 `engineIdentity` 门（engid_pre_*）——改嵌入输入文本（切块变了）必须 bump 身份描述符，旧索引才会正确作废。
- pushPart 只收 4 参，第 5 参静默丢失（:6931 教训）。
- 兜底块「无状态时输出与旧版逐字节相同」纪律贯穿 l0-extract/l0-index——新字段只在有值时附加（:443-447 同款）。
