# 交接账本 / 白板 判据表（P0-1）

> 规格源：`docs/internal/WB-GRAPH-INTEGRATION-PLAN.md` §2.2（判据定义表）、§2.3（硬/软分层理由）、§2.4（校验时机）。
> 实现：`lib/ledger-criteria-pre.js`（纯函数、零 IO、fail closed）+ `lib/index.js` 的 `writeHandoffLedger` / `writePlanSnapshot` 入口。
> 本文档是**人与模型共读的判据原文**：模型写账本/白板前应自检，人类维护时应以本文为唯一口径。

## 1. 为什么需要判据

白板（`handoff/PLAN.md`）与交接账本（`handoff/handoff-*.md`）是**跨会话续命的唯一材料源**。它们一旦写坏，
下游全部退化：权重化截断失效、注入端解析 null、接续会话拿到垃圾上下文。所以判据集中在**写入这一个门**上设防
（不引入 dsh-graph 的状态机；白板是单对话进度快照，七阶段迁移图是为多目标管理设计的）。

## 2. 判据定义表

### 2.1 交接账本（ledger）—— 四段式硬判据

| ID | 范围 | 判据 | 层级 | 校验方式 | 拒绝后果 |
| --- | --- | --- | --- | --- | --- |
| **H1** | 全篇 | 四段标题**齐全且逐字匹配**：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步` | **硬·拒绝** | `parseHandoffLedgerPre()`（`lib/handoff-anchor-pre.js`）返回非 null，且四标题集合与权重表相等 | 拒绝写入，返回缺失段清单 |
| **H2** | 全篇 | 各段 body **非空**（不得只有标题） | **硬·拒绝** | 逐段 trim 后长度 > 0 | 拒绝写入，指出空段 |
| **H3** | 全篇 | **无占位符行**：段 body 不得只含 `(待补充)` / `TODO` / `同上` / `略` / `N/A` | **硬·拒绝** | 占位符黑名单集合匹配（借 dsh-graph `CRITERIA_PLACEHOLDERS` 技巧） | 拒绝写入 |
| H4 | 全篇 | 无未闭合代码围栏 | 软·警告 | 围栏计数为偶 | 通过，记 warning |
| P-H1 | 「进度与下一步」段 | 至少一行可执行下一步（含文件路径或命令） | 软·警告 | 正则 | 通过，记 warning |
| P-S1 | 全篇 | 含至少一处前瞻内容（`下一步\|待办\|计划\|todo`） | 软·警告 | 正则 | 通过，记 warning |

### 2.2 白板（PLAN）

| ID | 判据 | 层级 |
| --- | --- | --- |
| P-H1 | 非空正文（不得为空文件） | **硬·拒绝** |
| P-H2 | 含至少一个 `##` 级标题 | **硬·拒绝** |
| P-S1 | 含「下一步 / 当前状态 / 待办」之类进展线索 | 软·警告 |

## 3. 硬 / 软分层的理由

- **硬判据只拦「结构性损坏」**：段落缺失、段落全空、占位符——这些会让下游解析直接失败或产出误导性上下文。
- **软判据只记录不拦**：文案质量、前瞻性、详细程度是**判断问题**，机器判不准；拦了会误伤正常写入（fail closed 的代价必须可控）。
- **fail closed**：判据函数本身抛异常时按「拒绝」处理，而不是放行——写坏材料的代价 > 少写一次的代价。

## 4. 校验时机（两层）

1. **写入前（代码校验，强制）**：`writeHandoffLedger` / `writePlanSnapshot` 入口处调用，硬判据不过 → 返回
   `{ok:false, gate:'criteria', report}`，附**可执行改写指引**（缺哪些段 / 哪段空 / 占位符行原文）。
2. **写入后（事件，确认）**：校验通过或带软警告的事实作为**确认事件**追加到 `handoff/events.jsonl`
   （`criteria.passed` / `criteria.warned`），供刷新仪式轮询、GUI 面板与图重建消费。

> **登记 ≠ 合格**：写入成功只代表「写进去了」，判据事件才代表「写合格了」。两者分离，防止模型用一次敷衍写入骗过仪式等待。

## 5. 正例

```markdown
# 交接账本 · 2026-09-16 14:30

## 任务状态
- 已完成 13 项修复，全量回归 PASS 96 / FAIL 0 / TIMEOUT 0。

## 目标
- 补 P2/P3 的输入端与检索端，默认仍走旧白板。

## 已试方案与失败原因
- 方案：在 `apply()` 内 `await loadConfig()` → 失败原因：cordis 不 await apply 返回值，工具注册落进微任务。
- 方案：把闸门写成 `this.wbGraphGatePre()` → 失败原因：抽取式沙箱里 `this` 是裸对象，原型方法不可达。

## 进度与下一步
- 下一步：跑 `node tools/run-smoke.mjs` 确认 FAIL 0。
```

## 6. 反例

```markdown
# 交接账本

## 任务状态
(待补充)

## 目标

## 进度与下一步
同上
```

**为什么被拒**：缺「已试方案与失败原因」段（H1 不过）；「任务状态」只含占位符（H3 不过）；「目标」段为空（H2 不过）。

## 7. 引用关系

| 位置 | 作用 |
| --- | --- |
| `lib/ledger-criteria-pre.js` | 判据实现（纯函数、零 IO、fail closed） |
| `lib/handoff-anchor-pre.js`（权重表 + `parseHandoffLedgerPre`） | 段解析与权重化截断的真源 |
| `lib/index.js` → `writeHandoffLedger` / `writePlanSnapshot` | 写入咽喉（校验插入点） |
| `handoff/events.jsonl` | 判据确认事件（append-only） |
| `docs/internal/WB-FORMAT-CONVENTION.md` | tag 语法、条目 id（`mem_<32hex>`）、锚点行的格式约定 |
