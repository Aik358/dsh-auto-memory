# 记忆系统大修 · 施工总表

> 2026-11-08 · 基于 A/B/C/D 四线审计 + Lead 复核
> 用途：这张表是施工安排的**唯一入口**，每行可独立搬到你自己的任务板
> 细则版（每项的具体改法）留给子代理逐批绘制，见第九节

---

## ⚡ 接续须知（新对话从这里开始）

> 本区块是给「上下文已清空的新对话」看的。读完这一个区块就能开工，不必回溯前几百轮。

### 一句话现状

**文档已定稿，施工尚未开始。** 31 项任务分 7 批 + 1 条独立线，全部待执行；
批次 0 有一项**未解决的合并冲突**必须先处理（见下）。

### 环境快照（2026-11-08 09:40 实测）

| 项 | 值 |
|---|---|
| 分支 | `preview` |
| HEAD | `20f754b7`（完整 `20f754b755c6c5844e0d8de15862ab6c9c2cecc3`） |
| 领先 origin/preview | **22 提交**（全部未推） |
| 工作树变更 | **31 条**，其中 1 条是冲突态 |

**必须知道的 6 个脏文件**：

| 状态 | 文件 | 说明 |
|---|---|---|
| `UU` | [`lib/tier-layer-inject.js`](file:///D:/dsh-auto-memory/lib/tier-layer-inject.js) | **未解决的合并冲突** —— 不处理开工必撞 |
| `M` | [`lib/index.js`](file:///D:/dsh-auto-memory/lib/index.js) | #475 半成品（+10 行） |
| `M` | [`lib/tier0-catalog.js`](file:///D:/dsh-auto-memory/lib/tier0-catalog.js) | #475 半成品 |
| `M` | [`tests/smoke/smoke-test-tier0-catalog.mjs`](file:///D:/dsh-auto-memory/tests/smoke/smoke-test-tier0-catalog.mjs) | #475 半成品 |
| `M` | `.gitignore` | 审计期追加 924 B（可保留） |
| `??` | [`lib/tier0-usage.js`](file:///D:/dsh-auto-memory/lib/tier0-usage.js) | 未跟踪新文件 |

另有 **13 份** [`docs/internal/*.md`](file:///D:/dsh-auto-memory/docs/internal/) 未跟踪（本次审计产出，**建议先 commit 再开工**）
和 **9 个垃圾文件**（0 B，shell 引号 bug 残留，可直接删）。

### 立即行动（按裁定状态二选一）

**若 §十四 的三件裁定已给**：

```
1. 解决 UU 冲突：读 lib/tier-layer-inject.js 的冲突块，按裁定 1 处理
2. 完成或 stash #475 的 3 个 M 文件
3. commit 13 份审计文档 + 本文件（先落盘，避免丢失）
4. 开工批次 0（备份 + 基线），然后派批次 1、2 的细则子代理
```

**若裁定未给**：先问用户 §十四 那三件，不要自行决定。

### 三条红线（越过就会返工）

1. **不要先改代码再想判据** —— 每项都有一组「真执行 + 负路径 + 变异必红」的验收，没有这套判据的改动不算完成
2. **不要带着 UU 冲突开工** —— 任何回归都分不清是谁弄坏的
3. **不要一次派 6 个批次** —— 并行过多会互相干扰（本项目已踩过：孤儿总量虚高 18 倍）

### 本文件怎么读

| 你想知道 | 读哪节 |
|---|---|
| 现在做什么 | §接续须知（本节） |
| 每批做什么 | §批次 0 ～ §批次 6 |
| 每项的验收判据 | 各批次表格最后一列 + §八 |
| 参考哪份文档 | §十二 文档索引 |
| 哪些事不能做 | §十 本轮明确不做的事 + 本节三条红线 |
| 待用户裁定 | §十四 |
| 语义/模型方案 | §十一 + §十五 |

---

## 〇、总览

| 批次 | 主题 | 项数 | 性质 | 能否并行 | 风险 |
|---|---|---|---|---|---|
| 批次 0 | 前置与保护 | 4 | 准备 | 可并行 | 低 |
| **批次 1** | **止血（有增长性的问题）** | **6** | 止损 | 部分可并行 | 中 |
| 批次 2 | 碎片链条完整修复 | 5 | 结构 | 串行为主 | 中高 |
| 批次 3 | 记忆质量（consolidate + 四段消费） | 4 | 结构 | 部分可并行 | 中 |
| 批次 4 | 平行形态联动补全 | 5 | 结构 | 可并行 | 中 |
| 批次 5 | 铭文重写 | 1 | 提示词 | 串行（依赖 1-4） | 高 |
| 批次 6 | 清理 | 5 | 清理 | 可并行 | 低 |
| 独立线 | #475 PR 收尾 | 1 | 外部贡献 | 与主线并行 | 低 |

**合计 31 项。**

**必读参考细则：**

线	文件	规模
A	[EVENT-FRAGMENTATION-20261108.md](file:///D:/dsh-auto-memory/docs/internal/EVENT-FRAGMENTATION-20261108.md)	707 行 / 56,678 B
B	[PROMPT-AND-CONSOLIDATE-20261108.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-AND-CONSOLIDATE-20261108.md)	420 行 / 50,281 B
C	[ORPHAN-CAPABILITY-AUDIT-20261108.md](file:///D:/dsh-auto-memory/docs/internal/ORPHAN-CAPABILITY-AUDIT-20261108.md)	640 行 / 68,441 B
D	[MEMORY-LOGIC-GAPS-20261108.md](file:///D:/dsh-auto-memory/docs/internal/MEMORY-LOGIC-GAPS-20261108.md)	368 行 / 44,283 B
附	[CAPABILITY-GAP-VS-USER-LIST-20261108.md](file:///D:/dsh-auto-memory/docs/internal/CAPABILITY-GAP-VS-USER-LIST-20261108.md)	220 行 / 10,932 B
附	[DEADKEY-AUDIT-20261108.md](file:///D:/dsh-auto-memory/docs/internal/DEADKEY-AUDIT-20261108.md)	603 行 / 49,491 B
附	[USERFULL-EVENT-DESIGN-ASSESS-20261108.md](file:///D:/dsh-auto-memory/docs/internal/USERFULL-EVENT-DESIGN-ASSESS-20261108.md)	863 行 / 66,185 B
附   docs/internal/PLUGIN-HEALTH-REPORT-20261108.md   给用户看的说人话版
``` 

### 为什么是这个顺序

```
批次 0  没有基线和备份，后面动数据会不可逆
   ↓
批次 1  两个问题有增长性（facts.json 每天 +55MB、碎片每次写日志 +1）
        先止损，否则边修边涨
   ↓
批次 2  碎片链条必须整条修好（只修一环等于没修）
   ↓
批次 3  数据质量上去了，才谈得上「注入得更凝练」
   ↓
批次 4  形态之间通不通，决定模型能不能看到全貌
   ↓
批次 5  铭文是最后一层——只有数据、投递、联动都通了，清单才有意义
   ↓
批次 6  收尾清理，放在最后才不会有「清了又长回来」
```

---

## 批次 0 · 前置与保护（4 项）

**目标**：让后面所有改动都可回滚、可复算。

| # | 任务 | 落点 | 验收判据 | 依赖 |
|---|---|---|---|---|
| 0.1 | **备份 facts.json**（84 MB）到带时间戳的副本 | `~/.dsh/memory/hub/facts.json` | 副本字节数 == 原文件；原文件未被改 | — |
| 0.2 | **备份 event-store.json** | `WS/handoff/event-store.json` | 副本字节数 == 原文件 | — |
| 0.3 | **建立三元组基线**：index.js 的 (行数, 字节数, 导出数) 与 event-store 的 (事件数, 检查点数) | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js)` 等 | 基线写入文档，后续每批收工都对照 | — |
| 0.4 | **处置工作树未提交改动**：`#475` 4 个文件（M index.js / UU tier-layer-inject.js / M tier0-catalog.js / M smoke-test） | git 工作树 | 二选一：①完成并提交 ②stash 后开工、完工恢复。**开工前必须清干净** | — |

> **0.4 必须先做**。带着半成品开工，任何回归都分不清是谁弄坏的（本项目已踩过这个坑）。

---

## 批次 1 · 止血（6 项，两个增长性问题）

**目标**：停止每天 +55 MB、每次写日志 +1 个碎片。

### 1A · facts.json 冲突库（3 项，有增长性，最急）

| # | 任务 | 落点 | 验收判据 |
|---|---|---|---|
| 1.1 | **给 conflicts 加容量上限**：参照 facts 的 `pruneIfNeeded`，超上限时按 resolved 优先、再按时间淘汰 | `[lib/fact-store.js](file:///D:/dsh-auto-memory/lib/fact-store.js):726` 附近 | 构造 200 条冲突超上限 → 写入后总数 ≤ 上限；`facts` 与 `conflicts` 两个上限互不干扰 |
| 1.2 | **给处置原语接一个真实入口**（三选一，看你的偏好） | `[lib/fact-store.js](file:///D:/dsh-auto-memory/lib/fact-store.js):640-648` + 面板或工具 | 真调用 `resolve()` 一条 → `resolved:true` 计数 +1、`pendingConflicts` -1；面板可见 |
| 1.3 | **收紧冲突判定或加去重键** | `[lib/fact-store.js](file:///D:/dsh-auto-memory/lib/fact-store.js):131-137` | 同一 subject+predicate 反复出现但 object 相同 → **不再新增** conflict；构造重复输入断言条数不涨 |

> **1.1 与 1.2 可并行；1.3 独立**。
> **任一项单独做都不够**：只做 1.1 存量仍大；只做 1.2 仍每天新增；只做 1.3 存量 64,644 条还在。
> 建议 **1.1 + 1.3 同批**（止住增长），1.2 随后（清理存量）。

### 1B · 碎片链条止血（3 项）

| # | 任务 | 落点 | 验收判据 |
|---|---|---|---|
| 1.4 | **主题门换判据**：不再用「日志全文词集 vs 事件名」的比值，改用高基数标识（issue 号 / task 号 / commit 号 / PR 号），匹配不上再退回「最近 active 事件」 | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):24506` | ①真跑：构造「同 issue 号」的两条日志 → 第二条 append 到第一条事件（不新建）；②负路径：不同 issue 号 → 新建；③变异：把判据改回词袋比 → 断言必红 |
| 1.5 | **事件名截断 40 → 80** | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):24523`、`[lib/event-write.js](file:///D:/dsh-auto-memory/lib/event-write.js):593` | 新建事件名长度上限 == 80（契约值 `event-write.js:222`）；构造 60 字日志 → 名字完整不截断 |
| 1.6 | **注入面输出 evt id** | `[lib/event-render.js](file:///D:/dsh-auto-memory/lib/event-render.js)` | 真调用渲染 → 每个事件卡含 `evt_xxxxxxxx`；字符增量 ≈ +14/卡；构造 3 个事件 → 3 个 id 各不相同 |

> 1.4 / 1.5 / 1.6 **可并行**（三处不同文件、互不依赖）。
> **1.6 是解锁「清单化」的前提** —— 不加，铭文里 append/set/rename 三条永远是空要求。
---

## 批次 2 · 碎片链条完整修复（5 项）

**目标**：不只止血，让「一件事」真的能被认出来、能被合并回来。

| # | 任务 | 落点 | 验收判据 | 依赖 | 可并行 |
|---|---|---|---|---|---|
| 2.1 | **创建事件时填 goal 首段** | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):24520` 建事件处 | 新建事件 `sections.goal` 非空；构造 3 次新建 → 3 个 goal 都非空 | 1.4 | 可 |
| 2.2 | **kind 推断**：有 members 指向 docs → ledger；有 outcome+起止时间 → project；信号不足 → 保留 unknown | `[lib/event-store.js](file:///D:/dsh-auto-memory/lib/event-store.js):96-126` + `:255-269` | 真建 3 类事件 → kind 分别为 ledger/project/unknown；负路径：信号不足仍回落 unknown | 1.4 | 可 |
| 2.3 | **event-regroup 只读提案段接线**：用语义分组替换现行确定性聚类（**只产建议、不写盘**） | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):8581` + 启用 `event-regroup-{scan,propose}.js` | 真调用 dryRun → 草案含 confidence；**不写任何文件**（前后 event-store 字节数不变） | — | 可 |
| 2.4 | **存量碎片归并**（碰数据）：用 2.3 草案落盘，把 27 个碎片合并 | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):8647` + `event-regroup-apply.js` | 归并前后**检查点总数守恒**；事件数下降；`rollbackFromSnapshotPre` 真调用一次成功 | 2.3 + 0.2 | 串行 |
| 2.5 | **白板随事件自动重绘** | 事件写路径 + `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):24721` | 改一条事件 → PLAN.md diff 非空；负路径：无变化时 PLAN 字节不变 | — | 可 |

> **2.3 零风险**（只读不写盘），建议早做。**2.4 会改真实数据**，必须等 0.2 备份 + 2.3 验证通过。

---

## 批次 3 · 记忆质量（4 项）

**目标**：让写进去的东西真的被读到、被用上。

| # | 任务 | 落点 | 验收判据 | 可并行 |
|---|---|---|---|---|
| 3.1 | **consolidate 扩读取面**：除日志外读事件库、白板、账本、反思 | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):18789` | 真调用 → prompt 含事件摘要与白板内容；喂入字符量从 12.7% 提升到可复算新值 | 可 |
| 3.2 | **四段消费侧**：注入真正使用 `dead` 段（现 45/45 全空 = 从未被读） | `[lib/event-render.js](file:///D:/dsh-auto-memory/lib/event-render.js)` | 构造含 dead 的检查点 → 注入含卡点内容；负路径：dead 空时不输出 | 可 |
| 3.3 | **检查点截断策略**：300 字只露 21.6%，改为首 300 + 尾 100 或动态预算 | `[lib/event-render.js](file:///D:/dsh-auto-memory/lib/event-render.js):320` | 构造 1,400 字检查点 → 注入同时含开头与结尾特征串；总预算不超 1,800 | 可 |
| 3.4 | **事件可见性**：41 个 active 只展开 2 个 | 注入段 | 展开数可配且默认提升；构造 10 个 active → 注入含 5 个以上；预算仍 ≤ 8000 | 依赖 3.3 |

> 3.1 属写入侧，3.2/3.3/3.4 属投递侧，**可完全并行**。

---

## 批次 4 · 平行形态联动（5 项，可全并行）

| # | 任务 | 落点 | 验收判据 |
|---|---|---|---|
| 4.1 | **person store 接画像** | `[lib/user-portrait.js](file:///D:/dsh-auto-memory/lib/user-portrait.js)` | 写入 1 条 accepted → 注入画像段出现该内容；`grep person` 从 0 变有读取点 |
| 4.2 | **工作区技能库写入口**：cand 补 scope | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):25540` | 带 scope=workspace 真调 → 落 `WS/hub/procedures.json`（不再恒落 global）；负路径：不传仍落 global |
| 4.3 | **时段总结可回读**：kind 枚举加 summary | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):24934` | 真调 `memory_read(kind=summary)` → 返回最新一条；kind 非法仍报错 |
| 4.4 | **诊断面读对目录** | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):15864` | 面板体积读数 == `MEM/summaries` 实际字节 |
| 4.5 | **跨形态去重**：注入组装做内容指纹去重 | 28 处 `pushPart` | 构造「账本与检查点同文」→ 注入只含 1 份；负路径：内容不同两份都在 |

> 五项互不依赖，**可全并行**。

---

## 批次 5 · 铭文重写（1 项，必须最后）

| # | 任务 | 落点 | 验收判据 |
|---|---|---|---|
| 5.1 | **铭文改写成判断清单**：加跳过条件、加终止位、合并重复条目（事件更新与检查点同动作）、删缺前置数据的条目 | `[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):1537-1553` + `:1560` | ①每条能答是/否；②每条有跳过条件；③总长 ≤ 当前 1,489 字符；④更新 `:1534` 过期注释（420 → 实测）；⑤真跑一轮看模型是否按顺序执行 |

> **为什么放最后**：铭文要求「挂到已有事件」「重写四段」「加检查点」—— 这些依赖批次 1-4 先把数据与投递修通。
> 顺序反了，清单会变成「要求模型做但系统不支持」的空要求 —— **现在就是这个状态**。

---

## 批次 6 · 清理（5 项，可并行）

| # | 任务 | 落点 | 处置方式 |
|---|---|---|---|
| 6.1 | **13 个真孤儿模块** | `lib/` 187,668 B | event-regroup → 保留（见 2.3）；upgrade-apply/draft 82,482 B（安全层）→ **标注弃用 + 归档，不删**；ledger-criteria（第二份实现）→ **删**；其余 5 个逐个裁定 |
| 6.2 | **8 个「拨了没反应」配置键** | 前端控件 + `DEFAULT_CONFIG` | 逐个裁定：补实现 / 摘控件 / 标实验项。**用户能感知的优先** |
| 6.3 | **42 个零引用导出** | 各模块 | **只删确认不在模块内自用的**（173 个是自用，别动） |
| 6.4 | **17 个零消费枚举** | `board-mode.js:26` 等 | 加校验或删除；防「加第 4 个值不生效」 |
| 6.5 | **三处旧目录收尾** | `WS/summaries`、`WS/hub-pre`、`MEM/person` | 扫 `*-pre` 一次性补迁；`WS/summaries` 明示废弃 |

---

## 独立线 · #475 PR 收尾（1 项）

| # | 任务 | 状态 |
|---|---|---|
| X.1 | `#475`（lujfsd）四文件已落地未提交；`markTruncation` 注释溢出预算（tokens=31 > maxTokens=25） | 需你裁定：**挤占 1-2 条低优先级条目** 或 **拆独立小预算**。裁定后可与主线并行 |

> 不影响大修，可随时做。**但它的未提交改动会污染回归**，所以要么先收尾、要么先 stash（见 0.4）。
---

## 七、并行执行策略

### 依赖图

```
批次 0（4 项）── 全并行
      ↓
批次 1A（1.1 + 1.3）── 并行
批次 1B（1.4 / 1.5 / 1.6）── 并行
      ↓ 1.4 完成后
批次 2（2.1 / 2.2 / 2.3 / 2.5）── 并行
批次 4（4.1 ~ 4.5）──────── 并行   ← 可与 2 同时跑
      ↓
批次 3（3.1 独立；3.2~3.4 一组）── 并行
      ↓
2.4（碰真实数据，单独串行）
1.2（清理存量冲突，单独串行）
      ↓
批次 5（铭文，唯一串行点）
      ↓
批次 6（清理，全并行）
```

### 三条硬约束

| 约束 | 原因 |
|---|---|
| 同一文件同一时间只许一个执行者 | 本仓踩过：宣布独占但另一条线仍在改，diff 混成一份、锁替别人钉死 |
| 会碰数据的任务串行（2.4 / 1.2） | 事件库与 facts.json 是单一真源，并发写会互相覆盖 |
| 每批收工跑 impact-run | 不用全量（15 分钟），跑受影响子集约 2 分钟 |

### 每项收工的固定动作

```
1. node --check 目标文件
2. 真 import 一次（不是只看语法）
3. 跑该批验收判据（真执行 + 负路径 + 变异）
4. 跑 impact-run
5. 对照批次 0 的三元组基线，增量落在估算区间内
6. 写事件检查点 + 更新交接账本
```

---

## 八、验收总判据（每项都必须满足）

| 判据 | 说明 |
|---|---|
| 真执行 | 真 import → 真构造 → 真调用 → 断言返回值。禁止「源码含某字符串」当功能验收 |
| 负路径 | 每条断言配一条「不该发生」的对照（如：不该新建时必须不新建） |
| 变异必红 | 把实现改回旧行为 → 断言必须变红；还原 → 必须复绿。有无区分力只能靠变异实测 |
| 可复算物理量 | 给字节数 / 行数 / PASS 数 / 守恒关系，不给「已优化」这种话 |
| 不越界 | 改动只在任务书划定的落点；超范围先上报 |

---

## 九、细则绘制计划（下一步）

按你的要求：总表出来后，每个批次派子代理画细则。

| 批次 | 子代理要产出什么 |
|---|---|
| 批次 1 | 三个子项的精确改法（函数级 diff 描述 + 测试用例设计） |
| 批次 2 | 五项，其中 2.3 / 2.4 最关键（regroup 如何接线、如何保守恒） |
| 批次 3 | 四项（consolidate prompt 设计 + 渲染侧截断算法） |
| 批次 4 | 五项（联动点逐个） |
| 批次 5 | 铭文新版本全文（唯一需要「写出来」的） |
| 批次 6 | 逐项裁定表（删 / 留 / 改） |

**建议不要一次派 6 个**：本轮已证明并行过多会互相干扰（3.4 MB 孤儿虚高就是并线审计口径差）。
建议一次派 2 个：批次 1（止血，最急）+ 批次 2（碎片链条，最重要）。其余等前两个细则出来再派。

---

## 十、本轮明确不做的事

| 不做 | 原因 |
|---|---|
| 不调主题门 0.34 阈值 | 数学上不可能通过，调多少无效 |
| 不直接删 upgrade-apply / upgrade-draft | 涉及安全层（令牌/快照/闸），标注弃用 + 归档 |
| 不按「导出零引用」批量删代码 | 173 个是模块内自用 |
| 不动 client.js classic 区做三方合并 | 用户明确警告过社区 merge 污染 |
| 不在没备份时动 event-store / facts.json | 已列入批次 0 |
| 不把 84 MB 直接删掉了事 | 那是用户数据，先备份、再处置、再考虑瘦身 |

---

## 附：本表与四份审计的对应关系

| 批次 | 主要依据 |
|---|---|
| 1A | D-2 / P0-1（facts.conflicts 写而不用且无界增长）+ Lead 实测 64,644 条 / 83.85 MB / 每天 +55 MB |
| 1B | A-1（主题门）/ A-5（名字 40 字）/ B-1（缺 eventId） |
| 2 | A-3 / A-4 / A-7 / C-1 / D-5 |
| 3 | B-4 / B-9 / B-10 + R5 |
| 4 | D-1 / D-3 / D-4 / D-6 + P2-4 |
| 5 | B-2 / B-3 + R3 |
| 6 | C-2 ~ C-9 / B-7 / B-8 + 42 零引用 / 17 零消费 / P3-3 |

---

## 十一、语义分析系统（新增，待 E 线细则）

**用户裁定**：引入语义分析系统，不只做门控。

**Lead 已扫出的仓内基线**：

| 项目 | 实测 |
|---|---|
| 本地模型权重文件（onnx/gguf/safetensors/bin） | 0 个（模型不在仓，运行时下载或 Python 引擎装） |
| lib/ 下语义相关模块 | 15 个 / 约 250 KB |
| 最大三个 | shadow-retrieval.js 39,700 B；semantic-js.js 39,354 B；l0-extract.js 26,408 B |
| 推理栈线索 | JS 侧 Xenova/transformers（semantic-js.js 命中 4 次）+ onnxruntime；Python 侧 python-runtime / python-sidecar |
| 嵌入模型线索 | bge-m3（即用户说的 multilingual 模型） |

**推论**：仓内很可能已经有两套推理栈和现成嵌入能力，只是被用在检索上、没用在事件归并上。这条待 E 线核实。

### 新增任务（编号待 E 回来确定）

| # | 任务 | 落点 | 验收判据 | 依赖 |
|---|---|---|---|---|
| E-1 | 查清仓内语义能力全清单：15 个模块各自入口/输入输出/推理栈/是否在跑；确认「C2 检索」指哪个模块 | [lib/semantic-js.js](file:///D:/dsh-auto-memory/lib/semantic-js.js)、[lib/shadow-retrieval.js](file:///D:/dsh-auto-memory/lib/shadow-retrieval.js)、[lib/l0-extract.js](file:///D:/dsh-auto-memory/lib/l0-extract.js) 等 | 每模块给 file:line + 生产调用点（或判零调用） | — |
| E-2 | 事件归并的语义方案可行性：能否复用现有 embedding 做「新日志 vs N 个已有事件」相似度 | 主题门 [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js):24506 | 给冷启动成本（模型大小/是否已缓存/首次耗时）+ 单次推理延迟 | E-1 |
| E-3 | 方案对比与决策：复用 bge-m3 / 更小模型 / 纯规则，用真实 45 事件 27 碎片验证分簇 | — | 每方案给分簇结果、假合并数、延迟、离线可用性；若语义不比规则好必须如实说 | E-2 |

### 关键工程问题（必须先答）

| 问题 | 为什么重要 |
|---|---|
| 事件归并发生在写路径上（每次 memory_log 都触发） | 每次算 embedding 会给每个工具调用加延迟，需实测单次耗时 |
| 模型能否离线用 | 插件不应依赖联网下载（用户已裁定交付物不得依赖第三方插件，同理不应依赖网络） |
| 现有 l0-index 是否就是事件索引 | 若已有索引，语义归并可能只是换个查询方式，不必新建 |

### 与批次 1 的关系

**E-3 结论会决定 1.4（主题门换判据）怎么做：**

```
若语义方案延迟可接受 → 1.4 直接用语义相似度
若延迟不可接受   → 1.4 先用规则（已实测 27→20 零假合并），语义留作离线批处理
```

**⇒ 1.4 已解冻**：E 线实测证明「判定层用规则可行、语义判定不可行」，故 1.4 判定走规则；语义转作独立排序层 prototype（见 §十五）。

---

## 十二、文档索引（细化时连同任务一起交给执行者）

### 必读三份

| 文档 | 内容 |
|---|---|
| [DEEP-AUDIT-MASTER-20261108.md](file:///D:/dsh-auto-memory/docs/internal/DEEP-AUDIT-MASTER-20261108.md) | 20 条问题总表 + 8 族根因 |
| [PLUGIN-HEALTH-REPORT-20261108.md](file:///D:/dsh-auto-memory/docs/internal/PLUGIN-HEALTH-REPORT-20261108.md) | 说人话版，先读这个建立直觉 |
| [CONSTRUCTION-PLAN-20261108.md](file:///D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md) | 本文件（施工总表） |

### 分线报告（按批次对号入座）

| 文档 | 规模 | 覆盖 | 对应批次 |
|---|---|---|---|
| [EVENT-FRAGMENTATION-20261108.md](file:///D:/dsh-auto-memory/docs/internal/EVENT-FRAGMENTATION-20261108.md) | 707 行 / 56,678 B | 碎片 5 问、0.34 门数学分析、合并判据实测、名字 40 字溯源 | 批次 1B / 2 |
| [PROMPT-AND-CONSOLIDATE-20261108.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-AND-CONSOLIDATE-20261108.md) | 420 行 / 50,281 B | 铭文 17 段测绘、6 点清单可行性、consolidate 边界、8 死控件 | 批次 3 / 5 / 6.2 |
| [ORPHAN-CAPABILITY-AUDIT-20261108.md](file:///D:/dsh-auto-memory/docs/internal/ORPHAN-CAPABILITY-AUDIT-20261108.md) | 640 行 / 68,791 B | 21 模块定性、导出级死代码、枚举零消费、假阳性排查 | 批次 6.1 / 6.3 / 6.4 |
| [MEMORY-LOGIC-GAPS-20261108.md](file:///D:/dsh-auto-memory/docs/internal/MEMORY-LOGIC-GAPS-20261108.md) | 368 行 / 44,283 B | 生命周期 10 环节、联动矩阵、8 项缺失、P0-P3 分级 | 批次 4 / 6.5 |

### 专项

| 文档 | 覆盖 | 对应 |
|---|---|---|
| [SEMANTIC-CAPABILITY-20261108.md](file:///D:/dsh-auto-memory/docs/internal/SEMANTIC-CAPABILITY-20261108.md)（E 线调查中） | 仓内语义能力清单、归并方案对比 | 1.4 与 E-1~E-3 |
| [DEADKEY-AUDIT-20261108.md](file:///D:/dsh-auto-memory/docs/internal/DEADKEY-AUDIT-20261108.md) | 179 键死键普查（9 个确认） | 6.2 |
| [CAPABILITY-GAP-VS-USER-LIST-20261108.md](file:///D:/dsh-auto-memory/docs/internal/CAPABILITY-GAP-VS-USER-LIST-20261108.md) | 五层能力清单（21 工具 / 73 子命令 / 100 常量） | 5 |
| [USERFULL-EVENT-DESIGN-ASSESS-20261108.md](file:///D:/dsh-auto-memory/docs/internal/USERFULL-EVENT-DESIGN-ASSESS-20261108.md) | 注入层级实测（检查点重复度、文档指针） | 3 |
| [TIER0-AND-USERFULL-EVENT-DESIGN-20261108.md](file:///D:/dsh-auto-memory/docs/internal/TIER0-AND-USERFULL-EVENT-DESIGN-20261108.md) | Tier-0 目录与 userfull 事件设计 | 3 / 5 |
| [PR-MERGE-PIPELINE-20261108.md](file:///D:/dsh-auto-memory/docs/internal/PR-MERGE-PIPELINE-20261108.md) | 4 个 PR 合并流水线方案（contributor 目标） | 独立线 |

四份分线报告合计 2,135 行 / 219,683 B。
### 代码级落点（细化时直接打开）

| 关注点 | 文件与行 |
|---|---|
| 主题门（碎片根因） | [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 24470-24507，判定在 24506 |
| 事件创建与名字截断 | [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 24523；[lib/event-write.js](file:///D:/dsh-auto-memory/lib/event-write.js) 593；契约上限 event-write.js 222 |
| kind 默认值 | [lib/event-store.js](file:///D:/dsh-auto-memory/lib/event-store.js) 96-126 与 255-269 |
| 注入渲染（缺 evt id） | [lib/event-render.js](file:///D:/dsh-auto-memory/lib/event-render.js) 全文件 |
| 检查点渲染与预算 | [lib/event-render.js](file:///D:/dsh-auto-memory/lib/event-render.js) 288-345；T2_BUDGET 在 56 |
| 冲突判定与存储 | [lib/fact-store.js](file:///D:/dsh-auto-memory/lib/fact-store.js) 131-137、478-486、640-648、726 |
| 铭文 17 段 | [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 1537-1553 与 1560；过期注释 1534 |
| consolidate | [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 18789 与 18453 |
| 归组未接线 | [lib/event-regroup.js](file:///D:/dsh-auto-memory/lib/event-regroup.js) 8-13 与 148；生产聚类 [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 8598 |
| 白板重绘调用点 | [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 24721、[lib/upgrade-apply.js](file:///D:/dsh-auto-memory/lib/upgrade-apply.js) 456 与 473 |
| 技能库写入口缺 scope | [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 25540；回落 [lib/procedure-store.js](file:///D:/dsh-auto-memory/lib/procedure-store.js) 280 |
| 时段总结读侧缺失 | [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 24934 |
| 诊断读冻结目录 | [lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 15864 |
| 面板高度写死 | [lib/client.js](file:///D:/dsh-auto-memory/lib/client.js) 4464-4465 |

---

## 十三、总表状态

| 项 | 状态 |
|---|---|
| 全部 31 项 | 总表已定稿 |
| 1.4 主题门判据 | **已解冻**：判定用规则（E 线实测 27→20 零假合并），语义改作独立排序层（见 §十五） |
| 批次 1/2/3/4/6 细则 | 待派子代理绘制 |
| 批次 5 铭文 | 须等 1-4 落地 |
| 0.4 工作树 | 等裁定 |

---

## 十四、需要裁定的三件事

| 序号 | 问题 | 选项 |
|---|---|---|
| 1 | 工作树 #475 四个文件 | A 完成并提交；B stash 后开工、完工恢复 |
| 2 | markTruncation 注释超预算（31 大于 25） | A 挤占 1-2 条低优先级条目；B 拆独立小预算 |
| 3 | 冲突处置入口（1.2）放哪 | A 面板加待裁定列；B 加 memory 工具；C 写入时只留最新一条 |

裁定这三件后即可开工批次 0，并派批次 1 与 2 的细则。

### 模型实测（2026-11-08 07:26，覆盖原先「仓内 0 个权重」的说法）

**上一轮 Lead 说「仓内 0 个权重文件」是错的**：扫描只覆盖 lib/、tools/、docs/，漏了 python/ 与 ~/.dsh/models/。实际两个模型都在本机。

| 模型 | 位置 | 主权重 | 合计 | 用途 |
|---|---|---|---|---|
| multilingual-e5-small | ~/.dsh/models/js-semantic/multilingual-e5-small/ | onnx/model_quantized.onnx 112.8 MB | 约 130 MB（含 tokenizer 16.3 MB） | JS 侧 Xenova/transformers |
| bge-m3-onnx-int8 | D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8/ | onnx/model_int8.onnx 542.1 MB | 558.4 MB（含 tokenizer 16.3 MB） | Python 侧，dimension 1024 |

**当前生效配置**（~/.dsh/memory/semantic/embedding-config.json）：

```json
{
  "provider": "bge-m3-onnx-int8-pre-v1",
  "modelDir": "D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8",
  "dimension": 1024,
  "torchThreads": 16,
  "search": { "mode": "hybrid", "wDense": 0.7 },
  "activationPolicy": { "mode": "shadow", "tOn": 0.62, "tOff": 0.52, "cooldownObs": 3 },
  "activationEmitMode": "canary-explicit"
}
```

### 两个必须注意的事实

**① 产品默认值与本机配置不同（不是缺陷，但要区分）**

| 项 | 产品默认（代码写死） | 本机实际配置 |
|---|---|---|
| provider | bge-m3-onnx-int8-pre-v1 | 同 |
| modelDir | ~/.dsh/python-engine/models | D:/dsh-auto-memory/python/bench/...（仓内绝对路径） |

代码里 createDefaultEmbeddingConfigPre 给的是用户目录，本机配置指向仓内，说明这是开发期自定义，不是产品默认。
做验证时必须区分：按本机配置测会以为「模型在仓内」，但用户装机后不会有这个目录。

**② bge-m3 已被 .gitignore 忽略（符合预期）**

git check-ignore 命中 .gitignore 第 16 行 python/bench/models-xenova-bge-m3-int8/，558 MB 权重不入库，符合大模型不入仓惯例。
仓内有 [python/bench/download_models.py](file:///D:/dsh-auto-memory/python/bench/download_models.py) 负责取模型。

### 这对 E-3 方案对比的影响（重大）

原任务书假设「模型不在仓、需下载或安装」，与事实不符。真实前提是：

| 原假设 | 实际 |
|---|---|
| 需要下载模型 | 已有：e5-small 130 MB 已缓存、bge-m3 558 MB 已就位 |
| 冷启动成本未知 | 已缓存，冷启动只有加载耗时（需实测，不是下载耗时） |
| 引入模型是新增依赖 | 是复用已有资产，门槛显著低于原判断 |

**所以「是否引入语义模型」这个问题，实际是「是否把已有模型接到事件归并上」。**
成本考量从「下载几百 MB 加新依赖」降为「一次前向推理的延迟」。

---

## 十五、候选排序器 prototype（新待办 · 用户 2026-11-08 裁定）

### 15.1 用户裁定（逐字）

> 「我看了他的回复，但我认为在做候选排序器的时候，还是应该去做一个相应的模型。」
>
> 「到时候可以尝试做一个 prototype，把现有的数据打包，我额外用另一个 Agent 跑出结果，
> 你把它加入这个事件的待办表（就是刚才那个文件）里。」

**结论**：E 线（[`[SEMANTIC-CAPABILITY-20261108.md](file:///D:/dsh-auto-memory/docs/internal/SEMANTIC-CAPABILITY-20261108.md)`](file:///D:/dsh-auto-memory/docs/internal/SEMANTIC-CAPABILITY-20261108.md)）建议「不该现在引入模型」——
**这个结论被用户否掉了**。用户裁定：候选排序器仍应做成模型，而不是停在纯规则。

### 15.2 与 E 线结论的关系（不矛盾，是分层）

| 层 | 用什么 | 理由 |
|---|---|---|
| **判定层**（合并/不合并的最终决定） | **纯规则**（高基数标识） | E 线实测：规则 27→20 零假合并；语义阈值区间完全重叠（同组最小 0.9061 < 异组最大 0.9661），无任何阈值能给出 20 簇 |
| **排序层**（候选集里谁最可能） | **模型**（本次新增待办） | E 线实测：语义作排序器 top-3 命中 **7/7**、top-1 命中 **5/7** ⇒ 排序有效，判定无效 |

**⇒ 用户的裁定精确落在「排序层」**：判定仍走规则（因为语义判定实测不行），但排序交给模型。
这正好绕开了 E 线的反对理由（E 线反对的是「用语义阈值单独决定合并」）。

### 15.3 前置事实（已实测，打包时直接用）

| 项 | 值 |
|---|---|
| 事件库 | `WS/handoff/event-store.json`，46 事件 / 约 700 检查点 |
| 碎片数 | 27 条（规则可归成 20 簇，零假合并） |
| 无标识碎片 | 27 条里 **10 条** name 里没有任何 issue/task/commit 标识（规则对它们无能为力，正是模型的用武之地） |
| 现有最接近的能力 | [`lib/semantic-js.js`](file:///D:/dsh-auto-memory/lib/semantic-js.js)：Xenova/multilingual-e5-small q8，384 维，模型 135,392,183 B 本机已在盘 |
| 冷启动 / 单次 | 1,105–1,285 ms / **43.7 ms**（E 线实测） |
| 候选集当前大小 | **1**（[lib/index.js](file:///D:/dsh-auto-memory/lib/index.js) 只取 updatedAt 最新的那个 active 事件）—— 这是必须先修的第二个结构缺陷 |

### 15.4 数据包规格（Lead 负责打包）

**输出位置**：`artifacts/ranker-prototype/`（已在 .gitignore 的 `artifacts/_*` 之外，需确认不入库）

**文件清单**：

| 文件 | 内容 |
|---|---|
| `cases.jsonl` | 每行一个 case（碎片 + 全部候选事件 + 金标） |
| `events.json` | 候选事件池（id / name / summary / 最近 3 条检查点摘要） |
| `README.md` | 任务说明 + 判据 + 如何跑（给执行 Agent 看） |
| `evaluate.mjs` | 评分脚本（读模型输出 → 算命中率/假合并） |

**cases.jsonl 单行 schema**：

```json
{
  "caseId": "c001",
  "fragment": { "id": "evt_xxxxxxxx", "name": "<40 字>", "text": "<日志正文，截前 800 字>" },
  "candidates": [ { "id": "evt_yyyyyyyy", "name": "...", "summary": "...", "lastCheckpoints": ["...","..."] } ],
  "gold": ["evt_yyyyyyyy"],
  "goldSource": "rule-20-clusters | human",
  "hardness": "has-identifier | no-identifier"
}
```

**关键设计**：
1. `candidates` 给**全部**事件（不只 1 个）—— 否则模型没有排序空间，也复现不了「候选集=1」的缺陷
2. `hardness` 分两档：`has-identifier`（规则能解）与 `no-identifier`（规则无解，10 条）**分开统计**
3. `gold` 以规则 20 簇为基线，人工复核过的那部分标 `human`

### 15.5 执行 Agent 要做什么

**任务**：对每个 case，把 `candidates` 按「与 `fragment` 属于同一件事」的可能性**排序**，输出 top-3。

**输出格式**（`artifacts/ranker-prototype/results.jsonl`（待生成onl`）：

```json
{ "caseId": "c001", "ranking": ["evt_yyyyyyyy", "evt_zzzzzzzz", "evt_wwwwwwww"], "scores": [0.93, 0.71, 0.55] }
```

**允许的做法**（给执行 Agent 的自由度）：
- 复用仓内已有 e5-small（零下载）
- 换 bge-m3（更大更强，558 MB 已就位）
- 自己训一个小分类器（如果它能拿到 gold）
- 混合：规则先筛 + 模型重排

### 15.6 判据（怎么算这个 prototype 成功）

| 指标 | 基线（E 线实测纯规则） | prototype 目标 |
|---|---|---|
| **top-1 命中率** | 5/7（现有 C2 语义臂） | **> 5/7**，且 no-identifier 组要显著提升 |
| **top-3 命中率** | 7/7 | 保持 7/7 |
| **假合并数** | 0（规则） | **必须仍为 0** —— 排序可以错，但最终判定仍走规则，所以假合并不该由排序引入 |
| **单次延迟** | 43.7 ms | ≤ 50 ms（写路径可接受） |
| **离线可用** | 是 | 必须仍是（模型已在盘） |

**否决条件**：如果 no-identifier 组的 top-1 提升 < 2 条，则 prototype 不成立，回到纯规则。

### 15.7 分工与状态

| 步骤 | 谁 | 状态 |
|---|---|---|
| 1. 打包数据（cases.jsonl / events.json / README / evaluate.mjs） | Lead | **待做**（等指令） |
| 2. 跑模型出 results.jsonl | **用户另派的 Agent** | 等数据包 |
| 3. 评分并回填结论 | Lead | 等结果 |
| 4. 若成立 → 接入写路径（作为候选排序器，不接管判定） | Lead | 依赖 3 |

### 15.8 与批次的关系

**这项不进批次 1-6**，是独立探索项。理由：

```
批次 1 的 1.4（主题门换判据）先用规则止血 —— 因为有增长性，不能等 prototype
prototype 成功后，作为 1.4 的「排序层增强」叠加，不推翻 1.4 的规则判定
```

**⇒ 1.4 不再被 E-3 阻塞**（原表曾写「1.4 暂停等 E-3」）。改为：

| 原状态 | 新状态 |
|---|---|
| 1.4 暂停，等 E-3 语义方案结论 | **1.4 解冻**：判定用规则（E 线已实测可行），语义留作独立的排序层 prototype |

---

## 附二、新对话启动提示词（直接复制给新会话）

> 以下整段可直接粘贴。它让新会话自己按优先级读出上下文，而不是一次灌 219 KB。

````text
我在做 dsh-auto-memory 插件的记忆系统大修。上下文已清空，请从文档恢复状态。

第一步：完整读这一份，从「⚡ 接续须知」区块开始：
  D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md

第二步：按需读（不要一次读完）：
  - 要先建立直觉 → docs/internal/PLUGIN-HEALTH-REPORT-20261108.md（说人话版）
  - 要查 20 条问题全貌 → docs/internal/DEEP-AUDIT-MASTER-20261108.md
  - 具体做某一批时 → 按 §十二 的「文档索引」只下钻该批对应的那一两份

第三步：按 §接续须知 的「立即行动」执行。
  - 注意工作树有 UU 冲突（lib/tier-layer-inject.js），必须先处理
  - 三件待裁定事项见 §十四，未裁定的先问我

纪律（务必遵守）：
  1. 每一项的验收判据 = 该项表格最后一列 + §八 验收总判据
     （真执行 + 负路径 + 变异必红，禁止用「源码含某字符串」当功能验收）
  2. §十 列出的 6 件事明确不做
  3. 不要一次派 6 个批次，建议一次 2 个
  4. 每项收工按 §七 的「固定六步」走

开工前先告诉我：你读到的当前状态（分支/HEAD/脏文件）和你打算先做哪一项。
````

---

## 附三、本文件的维护约定

| 时机 | 做什么 |
|---|---|
| 每完成一项 | 在该项所在表格里把状态改成「✅ 已完成 + 提交哈希」 |
| 每批收工 | 更新 §接续须知 的「一句话现状」与环境快照（分支/HEAD/脏文件） |
| 判据变化 | 同批更新该项判据，并在 §附 的对应关系表里注明 |
| 新增任务 | 追加到对应批次，同步更新 §〇 总览的项数 |
| 裁定落定 | 从 §十四 移出，写入 §接续须知 的「立即行动」 |

**这份文件是施工的唯一入口。代码状态变化后，必须同步这里，否则新对话会按旧快照行动。**
