# #520 结论验证报告（2026-11-03）

> 本轮只做调查与验证，未改 `lib/` 任何代码。每条结论标证据等级：
> **[R]** 真 import→真调用实测 ｜ **[C]** 代码核对（行号可查）｜ **[D]** 磁盘/会话数据实测 ｜ **[?]** 未证清

## 1 · D2（legacy 判据）—— 原表述有错，已修正

### 1.1 原表述与错误

v2 规划里我写「`current` 永远不会写盘 ⇒ 弹窗在任何情况下都关不掉」。**这句是错的。**

- **[R]** `renderStatusLinePre('current')` → `""`（该函数确实不产 current 行）
- 但 **[C]** `lib/memory-writer.js:145-146` 在 `appendAnchoredRecord()` 里硬写了
  `const STATUS_LINE = '<!-- dsh-status: current -->'`，注释自述「2026-10-27 F1(a) 拍板：新写入的条目自动带状态行」。
- 且 **[D]** 本机用户级 MEMORY.md 实测 **77 条锚点 / 77 条 status**（102/102 含项目笔记），全部日期段（含 2026-09-22）都有。

### 1.2 修正后的结论（有证据）

**[R]** 真调用 `detectLegacyFormatPre`（lib/rules-layer.js:515）：

| 输入 | legacy | 关键 counts |
|---|---|---|
| 本工作区真实文件（userText + notesText + 14 事件 + 28 日志） | **false** | anchors 102 / statuses 102 |
| 合成：有锚点 + 14 事件 + 8 日志 + **0 status**（报告人形态） | **true** | anchors 2 / statuses 0，reasons=`no-status` |
| 合成：全新空库 | false | 全 0（hasContent 短路） |
| 合成：纯存量库 + 仅 1 条 current | **false** | statuses 1 |

**[C]** 判据实现：`legacy = !anchors || !statuses`；`events` 只写进 reasons（`no-events`），**不参与判定**。

**[C]** 有没有「给存量已锚定条目补 status」的路径？**没有**：
- `applyMigrationPlan()`（锚点迁移应用器）只插锚点：`insertMarkers()` → `markerBuf()` 仅产 `<!-- memory:mem_x -->`，**不含 status 行**；
- `memory_user`（用户级写入）走 `engine.appendText / writeFull` 裸文本，不经 memory-writer ⇒ 不产 status；
- 全 lib 中 `dsh-status: current` 的写入点只有 `memory-writer.js:146` 一处。

### 1.3 D2 成立，但表述必须这样写

> `legacy` 依赖 `statuses > 0`；status 行只随**新记录追加**产生，**没有给存量已锚定条目回填 status 的路径**。
> 升级/迁移流程（v7 提示词）只写事件库与白板、**不写 MEMORY.md** ⇒ 不产生 status 行。
> ⇒ **对「已有锚点但 0 status」的库（正是 #520 报告人 78 条的形态），整理成功也不会清掉 legacy。**

**[C]** 反面证据（说明为什么本机是 false）：`lib/index.js:11568` 的注释断言「整理成功后必然写出锚点+status」——
**这是一句未经验证的假设**（与本次实测的「无回填路径」矛盾），属「修复标记≠已修」同族：注释把结论写全，代码没兑现。

### 1.4 「77 条 status 从哪来」—— 已查清

- **[C]** `engine.appendText()`（`lib/index.js`）→ `this.docStore.append(p, safeText, opts)`
  → `MemoryDocumentStore.append()`（`memory-writer.js:824`）→ `appendAnchoredRecord()` → **写 STATUS_LINE**。
  ⇒ **任何走 `appendText` 追加到 MEMORY.md 的记录都会自带 `dsh-status: current`**。
- **[C]** `memory_user(action='replace')` 走 `engine.writeFull` → `renderReplace` → `markerBuf`（**不含 status**）
  ⇒ 整篇替换反而会**丢** status。
- **[D]** 与备份对照一致：10-27 备份 `user-MEMORY.md` 77 锚点 / 0 status ⇒ 之后经 `appendText` 反复追加/重建，
  现为 77 / 77。

### 1.5 于是 D2 的**完整**表述（定稿）

`legacy = !anchors || !statuses`，其中：
1. status 行随**任意一次 `appendText` 追加**出现（含自动沉淀写用户记忆、memory_note 追加笔记）；
2. **升级/迁移流程不写 MEMORY.md**（v7 提示词只写事件库 + 白板）⇒ **迁移不会产生 status**；
3. **没有专门的回填路径**（`applyMigrationPlan` 只插锚点；`memory_user replace` 反而不产 status）。

⇒ 精确结论：
- **「有锚点 + 0 status」的库（报告人形态）：整理成功后 `legacy` 仍为 true ⇒ 弹窗不退 = 真死循环。**
- 该库**只在之后碰巧追加过一条笔记/用户记忆时**才会自愈（statuses 变 1）——不是迁移带来的，是运气。
- 对已有一条 status 的库：`legacy` 为 false，不需要修。

## 2 · D1（跨区写无通道）—— 代码链成立，运行时未直证

| 断言 | 等级 | 证据 |
|---|---|---|
| 前端 `memoryUpgrade` 只传 ws、不传 sessionId | **[C]** | `lib/client.js:7524` `apiPost(API.memoryUpgrade, { action: 'start', ws: wsFor })` |
| 后端 agent 解析顺序：调用方 sid → `_workbenchParent` → `_lastAgent` | **[C]** | `lib/index.js:26334-26339` |
| sid 为空时 `agentForSessionId('')` 必空 | **[C]** | `_agentBySessionId` = `ctx.get('agents').get(sid)`（`index.js:15410`），注册表按 sessionId 索引 ⇒ `''` 取不到 |
| `runSubagent` 内 parent = `_workbenchParent || agent || _lastAgent` | **[C]** | `index.js:16346` |
| 写工具按会话头 cwd 解析落点 | **[C]** | `index.js:4383` `ws = agent.session.header.cwd` |
| 带 sid 也仍落中枢 | **[D]** | 报告人两次实测（无 sid / 有 sid）子代理会话头 cwd 均为中枢 |
| 我机 22 个子代理会话 cwd 全为中枢 | **[D]** | 解 zstd 会话头，2026-10-27 窗口 22/22 |

**未直证**：我无法在本机起一次真实 upgrade 观察落点（需 DSH 宿主内跑）。⇒ D1 结论 = **代码链 + 对方实测**，不是我自己跑出来的。

## 3 · 写工具的 `workspace` 幻影逃逸口 —— 成立

- **[C]** 三个工具（memory_log / memory_note / memory_event）的入参 schema **均未声明 `workspace`**（逐个读过 schema 块）。
- **[C]** 全 lib 中 `args.workspace` 只出现 3 次，**全部是守卫条件本身**；守卫之后仍是 `const p = await engine.resolvePaths(exec.agent)`，
  **没有任何按 `args.workspace` 重定向落点的代码**。
- ⇒ 传它只能**跳过守卫**，不改写哪儿 ⇒ 比 #503 修前更隐蔽的污染面。这条成立。

## 4 · 「本机 upgrade 能整理所有工作区」—— 结论成立（非子代理所为）

| 证据 | 等级 | 数值 |
|---|---|---|
| 批量写入时间粒度 | **[D]** | 15 事件跨 2 个库，`03:12:19.988`→`03:12:20.034`（**46 ms**），ordinal 按库续号 ⇒ 代码循环 |
| 那条 job 自述 | **[D]** | `upgrade-state.json` summary：「**复核**已完成…我并没有重复写入事件，只做了读盘核验」 |
| 窗口内子代理会话 | **[D]** | 22/22 `cwd=…aik_auto_memory_use`，无一带 upgrade 提示词 |
| 引擎层可跨区写 | **[C]** | `event-store.writeStorePre(storePath)` 接受显式路径；`event-regroup-apply.js`（★R6 同日）按 storePath 写任意库 |
| 写入来源不可审计 | **[D]** | 15 条批量事件 `origin/createdBy/idemTag` 全被 drop（`extra=[]`） |

## 5 · 结论汇总

| 原结论 | 判定 |
|---|---|
| D1 跨区写无通道，子代理只能写中枢 | **成立**（代码链 + 对方实测；我未跑通运行时） |
| D2 legacy 使弹窗恒不消失 | **降级为条件成立**：对「有锚点 + 0 status」的库成立（迁移不写 MEMORY.md）；对已有 status 的库不成立 |
| 「`current` 永不写盘」 | **推翻**（`memory-writer.js:146` 为新记录写 current） |
| `args.workspace` 是幻影逃逸口 | **成立**（未声明 + 不重定向 + 仅跳守卫） |
| 本机跨区现象非子代理所为 | **成立**（46ms 批量写 + job 自述 + 22/22 会话 cwd） |
| 事件库不记录写入来源 | **成立**（15/15 事件无 origin/createdBy） |

## 6 · 动工前必须先补的一件事

1. **[R] 补运行时证据**：在 DSH 宿主内真起一次 upgrade，抓子代理会话头 cwd 与目标库 sha 前后值
   （D1 现在只有代码链 + 对方实测，我本人没跑通）。

## 7 · 本次调查中推翻/修正自己的两处

1. **「`current` 永不写盘」→ 错**：`memory-writer.js:146` 为新追加记录写 current。
2. **「加回填、或补 current 写入端」→ 不需要**：真正的缺口是「迁移不写 MEMORY.md」+
   「`legacy` 把 statuses 当结构缺陷」。修法仍以 `legacy = !anchors` 为主，但**理由要换成**
   「statuses 不是格式新旧判据」，而不是「current 没有写入端」。

## 8 · 追加取证：upgrade 历史对话（2026-11-03 用户提示后补做）

### 8.1 先修正我自己的取证方法（上一轮"找不到"是错的）

- **[C]** DSH 会话文件 `session.v4.jsonl.zstd` 是 **多帧 zstd 拼接**（每轮一帧，实测单文件 266 帧）。
  `zlib.zstdDecompressSync()` **只解第一帧** ⇒ 只拿到 269 字节的 session header，正文全丢。
  ⇒ 之前两轮"扫描 808 个会话，命中 0"的结论**作废**。
- **[D]** 改为按 `0x28B52FFD` 魔数切帧逐帧解压后：中枢 231 个会话文件里 **172 个命中**迁移提示词特征。

### 8.2 找到了那次 upgrade 的执行者与做法

| 会话 | 时间 | 事实 |
|---|---|---|
| `61a042ff…` | 2026-10-27 03:16 | 跨区写入的执行者——时间正落在 `03:12:19.988` 那批 15 事件的窗口内 |
| `d30ae92d…` | 2026-10-27 00:36 | 中枢自身迁移（19 次真 `memory_event` 调用） |
| `693ca6fc…` | 2026-10-26 04:39 | 10-26 那轮迁移 |
| `4e9ff0e6 / ab1b0a63 / 1b68e8d8 / 67bf796f` | 10-27 | 带 `WORKSPACE-MANIFEST` 的后续核查/渲染轮 |

**它怎么写到别的工作区的（决定性证据）**：
子代理**自己写了一套 python 迁移工具**，落在 `~/.dsh/aik_auto_memory_use/.dsh-memory/migration-2026-10-27/`
（盘上仍在：`apply.py` 9,344 B、`spec.py` 29,498 B、`v2.py` 2,636 B、`final-plan.json` 5,387 B），
然后用 `win_bash` 执行：

```python
import apply as A
from spec import SPEC
for wsid, cfg in SPEC.items():
    wsdir = os.path.join(A.ROOT, wsid); plan = os.path.join(wsdir, "handoff", "PLAN.md")
    store = json.load(open(os.path.join(wsdir, "handoff", "event-store.json"), encoding='utf-8'))
    new = A.render_plan(wsid, cfg, store, old)
    open(plan + ".tmp", "w", encoding="utf-8").write(new); os.replace(plan + ".tmp", plan)
```

⇒ **它不是用 `memory_event`/`memory_note` 写的，而是用 bash+python 直接 `json.load`/`json.dump`
遍历 `SPEC` 里每个工作区、直接改写 `event-store.json` 与 `PLAN.md`，绕开了 `resolvePaths(agent)` 的会话绑定。**

这同时解释了先前所有"异常"：
- 15 事件跨 2 库 **46 ms** 写完（python 循环，非工具调用）；
- 子代理会话头 `cwd` 仍是中枢（会话没换，只是脚本换路径）；
- 事件 `origin/createdBy` 全丢（不走 `writeStorePre` 的规范化路径）；
- `upgrade-state.json` 那条 job 自述"只做读盘核验"（写是脚本干的，不是那次 job 的 tool 调用）。

### 8.3 对 D1 的意义：从"代码推断"升级为"历史实证"

| 命题 | 之前 | 现在 |
|---|---|---|
| 工具层 `memory_event`/`memory_note` 只能写会话绑定工作区 | [C] 代码链 | **[D] 20+ 个迁移会话里，19/19 次 `memory_event` 调用参数无 workspace；跨区写全部由 bash 脚本完成** |
| 本机能"整理所有工作区"不是工具能力 | [D] 间接（时间粒度+自述） | **[D] 直接（找到执行脚本与调用点）** |

### 8.4 v7 提示词的一个真实漏洞

- **[C]** 现提示词把 `win_bash` 定义为「**只读**输入」「只用来**读**」，但**边界❌清单里没有一条禁止用 bash 写盘**。
- ⇒ 后果分两支：**守纪律的模型 → 只能用写工具 → 只能写中枢 → #520 死循环**；
  **不守纪律的模型 → 走 bash 直写 → 能跨区成事，但无校验、无锁、无来源。**
- 10-27 那次属后者。**这正是 #520 报告人（alpha.3、照提示词守纪律）必失败、而我机历史成功的原因。**

### 8.5 对 B 级方案的直接影响（两条新增要求）

1. **提供受控跨区通道**（中枢特权 + manifest 白名单）——否则模型只能继续"私搭脚本"，这条路不可审计；
2. **P6 必须显式禁止 bash 直写记忆库**（`event-store.json` / `MEMORY.md` / `PLAN.md`），
   否则旧行为会与新通道并存，再造一次"无来源写入"。
