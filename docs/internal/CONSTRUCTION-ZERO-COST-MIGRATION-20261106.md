# 施工文档 · 零额度迁移（归档旧白板，不花额度）

> 日期：2026-11-06 · 分支 preview · 状态：**待施工**
> 前置方案：`docs/internal/PLAN-ZERO-COST-MIGRATION-20261106.md`（450 行，实测 34,420 B）
> 可行性报告：`docs/internal/FEASIBILITY-ZERO-COST-MIGRATION-20261106.md`（314 行，26,264 B，sha256 前16位 `ff3de7df0bdb9785`，**施工期间不得改动**）

---

## 0 · 一句话说清这件事

用户不想花 API 额度迁移旧记忆库，但要保留可检索性。做法：

**把旧白板 PLAN.md 归档到 `handoff/archive/`，白板清零（下一轮自动长骨架），每日反思/项目规约/用户约定原地不动。**

> **不存在「清空事件库」这一步** —— 旧白板是纯文本流水账，本来就没有事件（用户原话：「旧白板本来就是流水账，没有事件的概念」）。

---

## ⚠️ 最高优先级：S1 是整件事成立的前提

**如果只做一件事，就做 S1。**

现状：`lib/index.js:5614` 召回时只扫归档目录**最近 20 篇**，而本机实有 **325 文件 / 322 匹配**。
⇒ **302 篇（93.8%）归档后根本 recall 不到**。

**这意味着：不修 S1，「归档仍可检索」就是一句假话。**
用户会遇到：归档了、以为还在、结果搜不到 —— 这比不归档更糟。

**S1 独立于其他所有步骤**，不依赖 S2–S6，可以单独先做、单独验收、单独发版。

---

## 1 · 施工顺序与依赖

| 步 | 内容 | 依赖 | 优先级 |
|---|---|---|---|
| **S1** | `lib/index.js:5614` 窗口改全量 + 8 并发 | **无** | **P0 最高** |
| S2 | `lib/index.js:501` API 常量 + `:27004` 路由 | 无 | P1 |
| S3 | `archivePlanZeroCostPre` 引擎方法（十步） | S2 | P1 |
| S4 | `lib/client.js:3974` API 镜像 + `:9098` 按钮 + 状态行 | 无（可与 S2/S3 并行） | P1 |
| S5 | `tests/smoke/smoke-test-zero-cost-archive.mjs` | S3 + S4 | P1 |
| S6 | `--impact-run` 依赖边 | S1–S5 | P2 |

**S1 与 S2–S4 无依赖，可并行派工。**

---

## 2 · S1 详细施工（最重要）

### 改什么
`lib/index.js:5614` 当前：
```js
for (const n of await this.listHandoffLedgers(path.join(p.handoffDir, 'archive'), 20)) {
```

### 怎么改
1. **取消 20 篇上限**（传 `Infinity` 或改为不传数量限制）
2. **8 路限量并发**读全文（原为串行 `await scan(...)`）
3. **结果按原序号排序**（并发会乱序，不排序会导致同一查询两次结果不同）
4. **循环内 `slice(0, limit)`**（8 worker 最多超 7 条）

### 实测依据（必须先看，避免它以为要多写）
| 窗口 | 稀有词（扫满） | 真实词（提前 break） |
|---|---|---|
| 20（现行） | 19.1 ms | 11.7 ms |
| 322 串行 | 184.8 ms | 10.7 ms |
| **322 + 8 并发（目标）** | **76.3 ms** | **11.8 ms** |

**关键理解**：真实查询几乎不受窗口影响（全档 11–12ms），因为命中后 `break`。
只有「本该命中却没命中」才付全窗口成本。所以**多付 57ms 换回 302 篇不漏召回，值得**。

### ❌ 不要做的事（已实测否决，别自作聪明）
| 想法 | 为什么不做 |
|---|---|
| 「先读前 200–300 字预筛再读全文」 | **实测 99.4ms，比直接全量读 76.3ms 还慢**。因为 322 次 `open/close` 要 90.0ms，省下的字节抵不过多出的系统调用 |
| 「只读文件名判断」 | 0.6ms 很快，但归档名是 `PLAN-<ts>-<uuid>.md`，不含正文词 ⇒ 命中率恒 0，等于把召回砍回 0 |
| 「改成分页」 | 需求是「归档后仍能搜到」，分页解决不了单次查询覆盖不全的问题 |

### S1 验收
- **P10**：只在第 201 篇才命中的锚点 `mem_7e4d53d5fc9c82`，改前 0 命中、改后命中 `PLAN-20260927-055744.md`
- **N8（变异，必须有）**：把实现改回 `slice(0, 20)` ⇒ 上述锚点**必须变回 0 命中**；还原必须重新命中
- `smoke-test-handoff` 的 G5 绿
- `smoke-test-issue164-plan-tools` 绿

---

## 3 · S2/S3 后端施工要点

### S2：API 常量 + 路由
- 常量加在 `lib/index.js:501` 附近
- 路由加在 `:27004`，`kind: 'exact'`，**照抄 `:26981-26993` 的 loopback/ws 解析写法**（不要自创）

### S3：`archivePlanZeroCostPre(agent, opts)` 十步
详见前置方案 §4.2.2。三个**必须遵守**的点：

**① `archivedIds` 必须取 `parseWhiteboardPre().cardIds`**
```
本机实测：parseWhiteboardPre().cardIds = 14
         planCardsPre().length       = 18   ← 多 4 张
M1 保护门用的是前者（lib/index.js:5462-5464）
```
传错 ⇒ M1 fail ⇒ 往模型侧吐「⚠ 白板丢卡警示」。**这是本轮新增的坑，可行性报告里没有。**

**② 归档函数必须用 `lib/plan-store.js:176` 那份**
产出 `PLAN-<ts>-<uuid>.md`。**不要**用 `lib/upgrade-apply.js:501` 那份（`PLAN-<ts>.md`，命名与既有 322 篇不一致）。

**③ 状态机：只写 `planArchivedAt` / `planArchiveFile`**
- **永不写 `phase`**、**永不写 `declined`**
- `phase === 'running'` ⇒ 返回 **409** 互斥
- 归档后 `canUpgrade` 仍为 true（legacy 只看 MEMORY.md 锚点，`rules-layer.js:557-559`，PLAN.md 不参与）

---

## 4 · S4 前端施工要点

### 落点
- `lib/client.js:3974` 加 API 镜像键
- `lib/client.js:9098` 与 `:9099` 之间插入按钮
- 属性：`data-dam-wizard-archive-plan` + `data-dam-wizard-archive-plan-state`

> **落点已核实**：`:9098` 在生成区**之外**（生成区 16206/18712、18718/22449），可直接改。

### 文案（写死，不得改）
- 必须出现「**不花额度**」
- 必须说明归档到 `handoff/archive/`、**可用 `memory_recall(scope="handoff")` 搜到**

### ⛔ 两条硬禁令
| 禁令 | 理由 |
|---|---|
| **不得写 `memory_read(kind=archive)` 能取回旧白板** | 它指向 `projectDir/archive`（30 天前旧日志，`index.js:13035`），**不是** `handoff/archive`。两个目录同名不同处，用户照着做会找不到 |
| **不得写「归档后不再提示」** | 与需求⑤冲突：用户要能随时回设置页再调向导 |

### 前端纪律
`lib/client.js` 由 `tools/build-iter5-skin.mjs` 生成 + R2 保护门。改完**必须**：
1. 跑生成器
2. `--check --strict` 得 SYNC-OK
3. 真执行 factory 的运行时守卫（静态断言不够，见项目规约）

---

## 5 · S5 验收套件（正负路径都要）

### 正路径要出**物理量**（不接受「看起来对了」）
```
归档前：PLAN.md 21,004 B / 14 卡
归档后：PLAN.md 477 B / 0 卡
archive 目录：322 → 323
归档文件 sha256 与归档前 PLAN.md 逐字节一致
```

### 负路径必做（缺一不可）
| 编号 | 操作 | 期望 |
|---|---|---|
| **N1** | 删掉 `archivedIds` 参数 | `m1Downgraded` 必须翻成 `true`；**还原后必须翻回 `false`**（否则判据失守） |
| **N2** | 预置 `phase='running'` | 返回 409，且 PLAN.md sha256 未变、archive 未新增 |
| **N3** | 篡改读回内容 | `plan-archive-verify-failed`，且白板未动 |
| **N4** | 空白板（无 PLAN.md） | `skipped:'no-plan'`，不新增归档、不写 `planArchivedAt` |
| **N8** | 见 S1 | 第 201 篇锚点必须变回 0 命中 |

### 必跑套件
```
node --check lib/index.js
node --check lib/client.js
node tools/build-iter5-skin.mjs --check --strict
node tests/smoke/smoke-test-api-paths.mjs
node tests/smoke/smoke-test-upgrade-wizard-client.mjs   # 追加 R48–R52
node tests/smoke/smoke-test-handoff.mjs                  # G5
node tests/smoke/smoke-test-issue164-plan-tools.mjs
node tools/run-smoke.mjs --impact-run
```

---

## 6 · 全局纪律（违反任何一条即打回）

1. **禁止静态断言充当验收**：不能因为「源码里有 `archivedIds` 字样」就算通过。N1 必须真删参数、真观察 `m1Downgraded` 翻转。
2. **禁止取 `git HEAD` 当未修复对照**（本仓实证：修复一提交 HEAD 就变已修版 ⇒ 把「修复成功」误报成「回归失败」）。要对照就固化到 `b989a5f9` 这类发布点哈希。
3. **不要碰 `lib/client.js` 的生成区**（`ITER5-GENERATED:BEGIN/END`）。
4. **不要改 FEASIBILITY 那份文档**（sha256 前16位 `ff3de7df0bdb9785`，是本次施工的取证基准）。
5. **CRLF 保持**：`lib/client.js` 是 CRLF 文件，改完行尾不能翻面。
6. **每步独立可回滚**：S1 单独一个 commit，S2–S5 一个，S6 只跑不改。

---

## 7 · 已知未验证项（如实列出，不要假装已验）

- 6 个必跑套件的**实际执行结果**（改动尚未发生，方案阶段未跑）
- 5000 篇归档外推约 660ms（**推算值，非实测**）
- graph 档全链路耗时未单独实测
- 面板「历史版本」30 条上限（`index.js:8362`）：归档后新归档排最前，属可接受；本次不修

---

## 8 · 交付回执要求

完成后 `send_message` 给 lead，必须包含：
1. **S1 变异验证的实际输出**（N8：改回 slice(0,20) ⇒ 0 命中；还原 ⇒ 命中）
2. N1 的 `m1Downgraded` 翻转实测（true ↔ false）
3. 归档前后物理量（21,004 B/14 卡 → 477 B/0 卡；archive 322→323）
4. 7 个必跑命令的**真实退出码**（直接取，不经管道）
5. 文件指纹（bytes + sha256[:16]）
6. 每步实际耗时
