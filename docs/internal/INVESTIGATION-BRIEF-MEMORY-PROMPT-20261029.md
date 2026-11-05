# 调查任务书 · dsh-auto-memory 记忆提示词与事件渲染链路

> 交给：独立第三方 Agent（无本会话上下文）
> 仓库：`D:\dsh-auto-memory`（Windows，DSH 记忆插件）
> 生成：2026-10-29 00:0x

---

## §0 你要做什么（一句话）

**用户的原话是「提示词出了大问题」。** 我已定位并修好**一个**直接原因（检查点四段丢失），
但用户判断这是**系统性问题**，需要你**全面调查整个记忆提示词体系与事件渲染链路**，找出所有同类断点。

**不要只复验我的修复。要独立找出我没发现的问题。**

---

## §1 用户看到的现象（第一手证据）

### 1.1 截图描述

白板「事件视图」里，某个事件的检查点列表：

```
○ ▶ #1  2026-10-27 22:06   [目标·GOAL1] [现状·STATE7] [失败·DEAD1] [下一步·NEXT1]   ← 有徽章
○ ▶ #2  2026-10-27 22:06                                                    ← 空白
○ ▶ #3  2026-10-28 22:22                                                    ← 空白
○ ▶ #4  2026-10-28 22:22                                                    ← 空白
○ ▶ #5  2026-10-28 22:46                                                    ← 空白
○ ▶ #6  2026-10-28 22:46                                                    ← 空白
○ ▶ #7  2026-10-28 23:14                                                    ← 空白
○ ▶ #8  2026-10-28 23:14                                                    ← 空白
○ ▶ #9  2026-10-28 23:52                                                    ← 空白
○ ▶ #10 2026-10-28 23:52   （当前选中）                                      ← 空白
```

底部还显示：**「本事件来源 · 0 篇原始账本」**

**用户的两个疑问**：
1. 「怎么从 27 号后面就没有新的事件」
2. 「新增的东西也渲染不出来了」
3. 「这写的逻辑有问题吗」

### 1.2 关于第 1 问的事实澄清

**不是没有新事件，而是新事件没有「四段」可渲染。** 事件确实只有 11 个，但那个事件下有 10 个检查点（#1~#10 就是同一条事件的 10 个检查点，不是 10 个事件）。

---

## §2 我已确认的根因（请**独立验证**，不要采信）

### 2.1 直接原因：检查点四段 `goal/state/dead/next` 落盘时全为 `''`

**实测数据**（`~/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json`）：

事件 `evt_761ad9ff`（白板事件视图前端映射层修复）的 10 个检查点：

| # | 时间 | kind | text 长度 | goal | state | dead | next |
|---|---|---|---|---|---|---|---|
| 1 | 10-27 22:06 | progress | 282 | **38** | **176** | **186** | **83** |
| 2 | 10-27 22:06 | handoff | 1466 | 0 | 0 | 0 | 0 |
| 3 | 10-28 22:22 | log | 247 | 0 | 0 | 0 | 0 |
| 4 | 10-28 22:22 | handoff | 829 | 0 | 0 | 0 | 0 |
| 5 | 10-28 22:46 | log | 328 | 0 | 0 | 0 | 0 |
| 6 | 10-28 22:46 | handoff | 992 | 0 | 0 | 0 | 0 |
| 7 | 10-28 23:14 | log | 330 | 0 | 0 | 0 | 0 |
| 8 | 10-28 23:14 | handoff | 920 | 0 | 0 | 0 | 0 |
| 9 | 10-28 23:52 | log | 301 | 0 | 0 | 0 | 0 |
| 10 | 10-28 23:52 | handoff | 941 | 0 | 0 | 0 | 0 |

**9 / 10 四段全空**，而 `text` 都有内容（247~1466 字符）—— 内容没丢，只是没进四段字段。

### 2.2 前端为什么渲染成空白

`lib/ev4-adapter.js` `adaptCheckpointPre()`（L162-173）：

```js
if (!panels.length) {
  const QUAD_PANEL = [
    { key: 'goal',  kind: 'state', label: '目标 · GOAL' },
    { key: 'state', kind: 'log',   label: '现状 · STATE' },
    { key: 'dead',  kind: 'dead',  label: '失败 · DEAD' },
    { key: 'next',  kind: 'next',  label: '下一步 · NEXT' },
  ]
  for (const qp of QUAD_PANEL) {
    const items = quadLinesPre(c[qp.key])
    if (items.length) panels.push({...})   // ← 四段为空 ⇒ 一条 panel 都不 push
  }
}
```

**⇒ 四段空 ⇒ panels 空 ⇒ 该行只剩时间戳，正文空白。**

**关键设计问题（请调查）**：这里**没有回落到 `text` 的逻辑**。而 `text` 明明有 247~1466 字符内容。**这是否是设计缺陷？**

### 2.3 为什么四段会空 —— 两条写入路径都断

#### 路径 A：`memory_note(kind=handoff)` → `appendHandoffCheckpointPre`

`lib/event-write.js` L401-438（**我已修**）：

```js
export async function appendHandoffCheckpointPre(storePath, opts = {}) {
  const ledgerText = String(opts.ledgerText == null ? '' : opts.ledgerText)
  const sections = parseLedgerSectionsPre(ledgerText)   // ← 已解析出 {goal, doing, deadend, next}
  ...
  // ★修复前：只传 5 个字段，sections 完全没用！
  const ckPayload = { kind, at, text: ledgerText, sourceRef, idemKey }
  ...
}
```

**修复后**新增：
```js
const _quad = {
  goal:  String(sections.goal || ''),
  state: String(sections.doing || ''),      // 字段名映射：doing → state
  dead:  String(sections.deadend || ''),    //              deadend → dead
  next:  String(sections.next || ''),
}
const ckPayload = { ..., ..._quad }
```

#### 路径 B：`memory_log` → `appendCheckpointPre`

`lib/index.js` L21799（**仍未修，且我认为无法修**）：

```js
const ap = await appendCheckpointPre(storePath, evId, {
  kind: 'log', at: Date.now(), text: entry,
  panels: [{ kind: 'log', text: entry }], idemKey,
  // ← 没有四段
})
```

**`memory_log` 的入参只有 `note/date/kind`，结构上无法提供四段。**
⇒ 它写入的 `log` 检查点四段必然为空（#3/#5/#7/#9 就是这样）。

**请判断**：这应该 ①让 `memory_log` 支持四段 ②让它不写事件检查点（只写日志）③前端回落 `text` ④其它。

---

## §3 已完成的修复（请验证，不要重做）

| # | 文件 | 改动 | 验证 |
|---|---|---|---|
| 1 | `lib/event-write.js` L401+ | `appendHandoffCheckpointPre` 透传四段（含 doing→state / deadend→dead 映射） | 端到端 PASS 4/0 |
| 2 | `lib/event-write.js` L170+ | `appendCheckpointPre` 支持四段透传（否则调用方传了也丢） | 同上 |

**端到端验证脚本**：`artifacts/_verify-quad.mjs`
```
=== parseLedgerSectionsPre 解析 ===
goal=「让检查点四段非空。」 doing=「正在验证四段落盘链路。」 ...

=== 真调用 appendHandoffCheckpointPre → 落盘 ===
PASS goal  = "让检查点四段非空。"
PASS state = "正在验证四段落盘链路。"
PASS dead  = "原实现只传 6 个字段 ⇒ 四段丢失。"
PASS next  = "验证 appendHandoffCheckpointPre 输出。"
结果: PASS —— 四段已落盘
```

**⚠️ 但你验证时要注意**：这个修复只对**新写入**生效。**磁盘上已有的 9 个空四段检查点不会自动回填** —— 请调查是否应该做数据修复，以及如何做才安全（append-only 纪律 vs 回填）。

---

## §4 你要调查的方向（这是任务主体）

用户说「提示词出了大问题」。我判断问题不止于四段。请按以下方向**系统排查**。

### 方向 1：提示词与实现是否一致（最高优先级）

**已知实例（我发现的）**：
1. `INJECT_TIERS.POST_COMPACT` 的 JSDoc 写「核心 3 节白板 + 规则全文 + 「刚才压缩了」提示」——
   但实际早已升为**全文**（不是核心 3 节），且「刚才压缩了」提示**代码里从未生成**（本轮才补上）。
2. `fullInjectOnCompact` 的注释写「显式告知模型『刚才压缩了』」—— 该配置项**零消费**（死键）。
3. `refreshWaterLevel` 这个函数名在注释里被引用，但**全仓不存在**（真名 `checkWaterLevelAtStep`）。

**请做**：全仓扫描 `lib/index.js` 里所有**给模型看的提示词常量**（`GUIDANCE` / `snapshot*` / `*_PROMPT` / 静态纪律段等），逐条与**实际实现**对照，列出所有「提示词承诺了但代码没做」或「代码做了但提示词说错」的项。

**已知的可疑点（请核实）**：
- `snapshotSlimMaintain` / 静态纪律里关于「检查点必填四段」的要求 —— 但**两条自动写入路径都不填**（路径 A 已修、路径 B 结构上做不到）。**这是否就是用户说的「提示词大问题」？**
- 提示词说「每次变动都要重写事件四段 sections」—— 但 `sections`（事件头）与 `checkpoint.goal/state/dead/next`（检查点级）是**两套不同的四段**。提示词有没有把它们讲清楚？模型/自动写入有没有混淆？

### 方向 2：还有多少「字段在传递链路上被静默丢弃」

四段丢失不是孤例。**同一个链路（工具入参 → 归一化 → 落盘 → 投影 → 前端）有 5 层，每层都可能丢字段。**

**请逐层审计**：
```
第1层  工具 schema 声明  (lib/index.js L22444 memory_event 的 checkpoint 定义)
第2层  工具入口传参      (L22474 eventStorePre.append({ checkpoint: args.checkpoint }))
第3层  落盘归一化        (event-store.js L560-585 的 cp 构造；含四段/percept/溯源字段)
第4层  投影下发          (event-store.js L480 checkpointQuad 投影；只带 6 字段)
第5层  前端消费          (ev4-adapter.js adaptCheckpointPre → panels)
```

**已知可疑点**：
- 第4层投影 `checkpointQuad` **只带 at/sourceRef/goal/state/dead/next**，注释说「不带 text（974 KB，占大头）」。
  ⇒ **但这意味着前端拿不到 `text`，一旦四段为空就完全无内容可显示**。这是不是设计缺陷？
- 除 `checkpointQuad` 外，`quota`/`quoteRef`/`quoteLine`/`rel`/`bytes`/`sha256` 这些**溯源字段**在投影层是否也被丢了？
- 四类感知（`userPercept`/`agentTrace`/`sharedGround`/`commitment`）在检查点级 vs 事件级，投影是否完整？

### 方向 3：事件渲染链路（白板）

**用户看到「本事件来源 · 0 篇原始账本」** —— 请查这个数字是哪里算的，为什么是 0。

已知历史：`event-store.list()` 的 7 键投影不含 `members`，曾导致「本事件来源恒 0 篇」，后来加了 `withMembers` 开关（默认 false）。
**请核实**：白板事件视图这条路径是否真的开了 `withMembers: true`？

另请检查白板渲染的其他段：
- `plan-render.js` 的 4 节（当前状态/近期进展/关键约束/待办）是否与事件数据一致
- 事件卡片的「目标/进行中/失败/下一步」取自 `event.sections`，而检查点四段是另一套 —— **两者是否被混淆**

### 方向 4：提示词是否引导模型做了错的事

**这是最可能藏大问题的地方。** 当前注入提示词（`GUIDANCE` 等）包含大量强指令，例如：
- 「检查点必须带溯源（quoteRef/quoteLine/rel/bytes/sha256）」
- 「每次变动都要重写四段 sections」
- 「写记忆时顺带产出对应 percept」

**请调查**：
1. 这些要求**模型实际能不能做到**？工具入参是否支持？（例：`memory_log` 不支持四段）
2. 提示词**总量**是否过大？实测注入面 24,617 字符（`post_compact` 档），其中规则段 8,291 字符。**这是否挤占了模型注意力？**
3. 提示词里是否有**互相矛盾**的指令？
4. 提示词里的**历史欠条**（过时表述）有多少条？

---

## §5 已知的历史欠条（我审计出的，请核实并找更多）

| # | 欠条 | 位置 | 状态 |
|---|---|---|---|
| 1 | `decideInjectTierPre` 声明 5 级优先级，3/5 是死代码（唯一调用点只传 2 参） | `L1916-1925` | 未修 |
| 2 | 注释引用不存在的 `refreshWaterLevel` | `L20914` | 未修 |
| 3 | `contextVersion` 被误用作压缩信号（已删该判据，但其余 22 处引用需复核） | 多处 | 部分 |
| 4 | `planCap` 与 `_planBudget` 语义重叠，planCap 超配 4.2 倍 | `L11149` | 未修 |
| 5 | `snapshotReinjectOnCompact` / `fullInjectOnCompact` 两条死配置 | `L1047/L1085` | 未修 |
| 6 | `isPlanFullTierPre` 与内联 `_planSpec.fullTier` 曾漂移 2 档（已补 POST_COMPACT，`legacy` 差异仍在） | `L1778` vs `L10446` | 部分 |

**请找第 7、8、9… 条。**

---

## §6 环境与工具（怎么跑）

```bash
cd /d/dsh-auto-memory

# 1. 语法/导入
node --check lib/index.js && node --check lib/event-write.js
node -e "import('./lib/event-write.js').then(m=>console.log('OK',Object.keys(m).length))"

# 2. 完整回归（约 162-220 秒，必须后台跑）
node tools/run-smoke.mjs --jobs=8 --timeout=180000

# 3. 本轮修复的端到端验证
node artifacts/_verify-quad.mjs        # 期望 PASS —— 四段已落盘

# 4. 直接看真实数据
node -e "const fs=require('fs');const p=process.env.HOME+'/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));for(const ev of j.events){const cps=ev.checkpoints||[];const empty=cps.filter(c=>!['goal','state','dead','next'].some(k=>String(c[k]||'').trim())).length;console.log(ev.id+' | '+cps.length+' cps | 四段全空 '+empty);}"
```

**关键文件**：

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 主引擎（1.35MB，工具定义、注入渲染、pre-step） |
| `lib/event-write.js` | 事件写入（`appendCheckpointPre` / `appendHandoffCheckpointPre` / `parseLedgerSectionsPre`） |
| `lib/event-store.js` | 事件存储 + 投影（`checkpointQuad` 在 L480） |
| `lib/ev4-adapter.js` | 前端适配（`adaptCheckpointPre` 在 L126） |
| `lib/event-render.js` | 事件渲染 |
| `lib/plan-render.js` | 白板渲染 |
| `lib/injection-zones.js` | 注入段 ZONE 注册表 |

---

## §7 交付要求

**请输出一份调查报告，包含**：

1. **§2 的独立验证结论** —— 我说的根因对不对？数字能否复现？
2. **§4 四个方向的调查结果** —— 每个方向列出：发现的问题 / 证据（文件:行号 + 实测输出）/ 严重度 / 建议修法
3. **新的历史欠条清单** —— 第 7 条起
4. **对「提示词大问题」这个判断的答复** —— 用户说的到底是什么问题？我的修复够不够？
5. **优先级排序** —— 哪些必须立刻修，哪些可以排期

**纪律要求**（这是本仓的硬规约）：

- **禁止只做静态断言**（「源码里存在某字符串」不算验收）—— 必须真执行并给可复算物理量（字节数/PASS 数/字符数）
- **每条结论必须带负路径** —— 证明「不这么改就会错」
- **不许采信本任务书的结论** —— 我列的都是「待验证假设」，不是事实
- **改动前先归因**：基线锁/守卫变红时，先判是真缺陷还是判据过期，不许整批回滚
- **禁止 `git add -A`**，如需提交必须逐个文件列名

---

## §8 我的自评（供你判断我的可信度）

这轮排查我**修错过两次**，如实记录：

1. **v1**：用 `contextVersion` 回退判「压缩发生」—— 该字段全仓只递增、永不回退 ⇒ 判据恒假，从未生效。
2. **v2**：改用 `rt.lastCompactionSeen` —— 但 `checkWaterLevel` 是 async，写入在 `await` 之后，调用方 `void .then()` 不等待 ⇒ **竞态**，当帧读不到。
3. **v3**：改用 `scanPressureSignalsPre(events)`（同步纯函数）才正确。

**并且我上一轮的交叉检验还漏了 3 个真缺陷**（首帧基线保护缺失、强制完整版被间距节流、名单漂移 2 档）。

⇒ **我的判断不可全信。请独立验证每一条。**

我的系统性弱点（已被第三方指出）：
- **验证起点单一**：只测「已有状态」，不测「初始 undefined 状态」
- **断言层级单一**：只测「标记被置位」，不测「置位产生的输出」

---

## §9 补充：我已定位的第 2 个独立缺陷（「本事件来源 · 0 篇」）

截图底部还显示 **「本事件来源 · 0 篇原始账本」**。这不只是显示问题。

**实测**：
```
事件 evt_761ad9ff 的 members 字段 = []   （空数组，不是投影丢失）
```

**⇒ 数据本身就是空的**，不是前端投影漏字段（投影层 `withMembers` 开关正常）。

**请调查**：
1. 谁应该在什么时候写 `members`？为什么这个事件从没写过？
2. `checkpoints` 有 10 条、`sourceRef` 全为 null —— **检查点写入时根本没带 sourceRef**（两条自动路径都不传）。
   而 `members` 的语义是「这件事由哪几篇原始账本归组而来」⇒ 没有 sourceRef 就没有 members ⇒ 恒 0。
3. **这是不是与四段丢失同一个根因？**（都是「写入路径不传字段」）
4. 是否应该在 `appendHandoffCheckpointPre` 里顺带把 `ledgerPath` 写进 `members`？

**这条可能比四段更严重**：`members` = 溯源证据，全空意味着**事件无法审计**（这正是提示词里「检查点必须带溯源」要求的东西）。

---

## §10 一条重要的方法论提醒（给你的）

**这两条缺陷有同一个形状**：

```
上游有数据 / 能拿到数据  →  传递链路中某层「只取部分字段」  →  下游空
```

- 四段：`parseLedgerSectionsPre` **已经解析出** sections，但 `ckPayload` 只取 5 个字段 ⇒ 丢
- members：`opts.ledgerPath` **已经传入**，但检查点只存 `sourceRef` 且调用方不传 ⇒ 丢

**⇒ 请把所有「有数据但没往下传」的位置都找出来。** 这类缺陷的共同特征是：
- 单测全绿（因为单测只断言「函数能跑」或「上游解析正确」）
- 生产静默（不报错、不抛异常，只是字段是空字符串）
- 前端表现成「空白」而不是「错误」

**这正是用户说的「提示词出了大问题」的可能真相**：提示词要求模型产出四段/溯源，但**写入链路根本不收这些字段** ⇒ 模型照做了、数据也解析了、最后全丢。

---

## §11 追加修复（写文档后我又修了两处，请一并验证）

### 11.1 前端回退：存量数据不会再空白

**问题**：§3 那两个修复只对**新写入**生效。磁盘上已有 9 个空四段检查点**不会回填**（append-only），用户看到的空白行依然在。

**修法（两层）**：

1. **投影层** `lib/event-store.js` `projectEventForListPre` 的 `checkpointQuad`：
   ```js
   // 四段全空时补一个正文摘要（只在原本就显示为空的行上增加 payload）
   if (!_q.goal && !_q.state && !_q.dead && !_q.next) {
     const _t = String(q.text || '').trim()
     if (_t) _q.fallbackText = _t.split(/\r?\n/)[0].slice(0, 120)
   }
   ```

2. **前端** `lib/ev4-adapter.js` `adaptCheckpointPre`：四段合成不出 panels 时，用 `fallbackText` 补一条 `label: "正文"` 的 panel。

**为什么不冒充四段**：label 用「正文」而不是 GOAL/STATE/DEAD/NEXT —— 这段内容不是四段中任何一段，硬塞会误导读的人。

**验证** `artifacts/_verify-fallback.mjs`（PASS 3/3）：
```
PASS  四段空+有fallbackText ⇒ 渲染「正文」一行
PASS  四段空且无fallbackText ⇒ 仍为空(不伪造)
PASS  四段非空 ⇒ 3 条 GOAL/STATE/NEXT，不掺「正文」
```

### 11.2 基线锁重钉（附归因，非盲目改判据）

改 `ev4-adapter.js` 后 `gen-ev4-blocks` 重新生成 `lib/client.js` 生成区 ⇒ `smoke-test-iter5-skin` 的经典区 sha256 锁红。

**归因（可复算）**：
- `git diff lib/client.js` = **12 行**：①生成区头部 sha16 行 ②fallback 逻辑 11 行
- `build-iter5-skin --check --strict` = **SYNC-OK**（生成区与源一致、手写区未被触碰）
- ⇒ **有意演进，非意外污染** ⇒ 按实测重钉 `2f4f7d49…` → `0316e09b…`

---

## §12 最终回归状态

```
PASS 529 / FAIL 2 / TIMEOUT 0   (163.1s, --jobs=8)
FAILED: smoke-test-v4-e8-double-check.mjs, smoke-test-v4-c4-tool-description.mjs
```

**两个失败均已单跑证明是并行假红**：
```
smoke-test-v4-e8-double-check.mjs   EXIT=0
smoke-test-v4-c4-tool-description.mjs EXIT=0
```

这两个套件在本仓历史上反复出现于 `--jobs=8` 失败集（libuv `UV_HANDLE_CLOSING` 退出竞态 / 共享临时目录）。
**但请你也独立验证这一点，不要采信我** —— 如果它们在你那里也稳定通过，那就是并行假红；如果稳定失败，说明我漏了真回归。

---

## §13 本轮全部改动清单（10 个文件）

| 文件 | 改动 | 性质 |
|---|---|---|
| `lib/event-write.js` | `appendHandoffCheckpointPre` 透传四段；`appendCheckpointPre` 支持四段 | **真缺陷修复** |
| `lib/event-store.js` | `checkpointQuad` 四段全空时补 `fallbackText` | **真缺陷修复** |
| `lib/ev4-adapter.js` | 四段空时回落「正文」panel | **真缺陷修复** |
| `lib/client.js` | 生成区（由 gen-ev4-blocks 产出，非手改） | 生成产物 |
| `lib/index.js` | （本轮早期）post_compact 首帧基线 + 强制完整版短路 + run_slim 砍事件卡 + 压缩提示段 | 前序批次 |
| `lib/injection-zones.js` | 登记 `post-compact-notice` | 前序批次 |
| `tests/smoke/smoke-test-iter5-skin.mjs` | 重钉经典区 sha256（附归因） | 判据重钉 |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | 重钉 `R153_CHARS` | 判据重钉 |
| `tests/smoke/smoke-test-v5-p3-tier-content.mjs` | B-5 判据更新（post_compact 已升全文） | 判据过期 |
| `artifacts/e8-visual/e8-7-double-check.json` | 生成产物 | 生成产物 |

**全部未提交**，等用户指令。
