> **给使用者的说明**：**时间检索臂（第一优先的新功能）**。复制时从 `你是 DSH 环境里的执行 Agent` 开始到文件末尾（自包含，无需 `_COMMON.md`）。
> ⚠️ Agent 不能重启 dsh web（会截断对话），改完只做静态验证；重启与 live 验证由你执行。
> 依赖：**P12 段先完成**（两者都改 `lib/index.js`，须串行投喂、逐段验收）。

---

你是 DSH 环境里的执行 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。你可以执行命令、读写文件。**不能重启 dsh web，也不要尝试。**

# 任务：给记忆检索加「时间臂」（支持"上周 / 三天前 / 上个月"一类时间查询）

## 0. 背景与目标

- 当前 `recall()`（`lib\index.js:3301`）只有**词法臂**（BM25）与**语义臂**（C2 打 L0），没有时间维度。
- 目标：当查询里出现中文时间表达（"上周""三天前""上个月底""最近一周"等）时，解析出时间范围，并作为一个**软性第三臂**参与排序——**只提升命中时间范围内的记忆，不硬过滤**。
- **关键约束：查询里没有时间表达时，行为必须与现状完全一致（零行为变更）。**

## 1. 必读文件（绝对路径，先读完再动手）

- `D:\dsh-auto-memory\lib\index.js` —— `recall()` 的 L0 分支（约 3355-3420），看 `l0Corpus` / `label` / `rankFusionRRFPre` 的实际调用形态
- `D:\dsh-auto-memory\lib\recall-fusion-pre.js` —— P8 的 `rankFusionRRFPre(pairs, opts)`，需**向后兼容地**加第三个可选臂
- `D:\dsh-auto-memory\lib\l0-extract-pre.js` —— `buildL0IndexPre` 返回结构（`id`/`l0`/…）
- `D:\dsh-auto-memory\lib\fact-store-pre.js` —— M8-1 的时间三价字段（`occurredAt`/`mentionedAt`/`ingestedAt`，仅参考，本段 Phase 1 不接入 facts）
- 参考范式：`git show 48fa943 -- lib/context-host-pre.js`（时间戳口径的写法）

## 2. 范围（Phase 1，刻意收窄）

**只做**：
1. 时间表达解析（纯函数）
2. 候选时间戳抽取（从 L0 候选的 `label` 里的日志文件名 `YYYY-MM-DD.md`）
3. 作为第三臂接入 `rankFusionRRFPre`（软提升，非硬过滤）

**不做**（留 Phase 2，本段禁止碰）：
- facts 的 `occurredAt/mentionedAt/ingestedAt` 接入
- sessions 范围的时间检索
- "上个月底 / 年初 / Q3" 这类复合/季度表达

## 3. 具体实现要求

### 3.1 新增 `lib\temporal-parse-pre.js`（纯函数，零 IO，注入 `now`）

导出 `parseTemporalQueryPre(text, opts = {})`：
- 输入：查询文本 + `opts.now`（毫秒时间戳，**注入**以保证确定性；缺省用 `Date.now()` 并说明测试里必须注入）
- 返回：`null`（未识别到时间表达）或 `{ startMs, endMs, matched }`
- **必须支持**（确定性实现，禁止 LLM、禁止第三方日期库）：

| 表达 | 含义 |
|---|---|
| 今天 / 昨天 / 前天 / 大前天 | 对应自然日 00:00–24:00 |
| 本周 / 上周 / 上上周 | 周一 00:00 起整周 |
| 本月 / 上个月 | 自然月 |
| 今年 / 去年 | 自然年 |
| 最近 N 天 / N 周 / N 个月 | 从 now 往前 N 个自然周期 |
| N 天前 / N 周前 / N 个月前 | 定位到那个自然日/周/月（不一定是整段，可按日/周/月起止） |

- 边界：中文数字与阿拉伯数字都要认（"三天前"="3 天前"）；`N` 上限 366。
- 确定性：同输入同 `now` 逐字节相同输出。
- 时区：统一用 `Asia/Shanghai`（本地），用 `new Date()` 的本地时间方法即可，但**必须显式说明时区假设**。

### 3.2 候选时间戳抽取

- L0 候选的 `label` 形如日志文件名（如 `2026-09-09.md`，**以实际 grep 到的为准**）→ 从文件名正则抽取 `YYYY-MM-DD` → 当日 00:00（本地）作为该候选的 `dateMs`。
- 非日志来源（`MEMORY.md`、`~userfile`、无日期名的 reflections）→ `dateMs = null` → 时间臂对该候选**不参与**（中性）。

### 3.3 `rankFusionRRFPre` 向后兼容地加第三臂

- 现状 `pairs = [{ memoryId, dense, lex }]`。改为**可选**支持 `temp` 字段：
  - `temp` 为数字（1 = 命中范围 / 0 = 未命中 / 缺失 = 无时间臂）
  - 当**所有** pair 都缺 `temp`（或全相等）→ 行为与现状**逐字节一致**
  - 否则 `temp` 作为第三路 rank-space 臂（`1/(k + rank/divisor)`，k/divisor 复用现有常量）与 dense/lex 同权融合
- **禁止 score-space 加权**（Hindsight #3956 教训）；只做 rank-space。
- 用测试锁死：`无 temp 输入 → 输出与当前版本逐项相等`（回归证明）。

### 3.4 `recall()` 接入

- 在 L0 分支：`const tr = parseTemporalQueryPre(query, { now: Date.now() })`
- 若 `tr` 非空：为每个候选算 `temp`（dateMs ∈ [startMs,endMs] → 1，否则 0；dateMs null → 不给 temp 字段）；把 `temp` 一并传入 `rankFusionRRFPre`
- 若 `tr` 为空：**不传 temp**，走现状路径（零变更）
- 非 L0 分支（旧调用方式）**完全不变**

## 4. 改动边界

- ✅ 允许新增：`lib\temporal-parse-pre.js`、`tests\smoke\smoke-test-temporal-parse-pre.mjs`
- ✅ 允许修改：`lib\recall-fusion-pre.js`（**仅向后兼容地加 `temp` 可选臂，不改既有 dense/lex 语义**）、`lib\index.js` 的 `recall()` L0 分支（最小 diff）
- ❌ **禁止修改**：`lib\shadow-retrieval-pre.js`、`lib\context-host-pre.js`、`lib\l0-extract-pre.js`、`lib\memory-importance-pre.js`、`lib\evidence-agg-pre.js`
- ❌ 禁止：硬过滤（时间臂只提升不删除）；把 facts 时间字段接入；改 `recall()` 签名；引入第三方日期/分词依赖

## 5. 验收标准

1. `parseTemporalQueryPre` 对 §3.1 表内每种表达返回正确的 `[startMs,endMs]`（fixture 锁死，含"三天前"="3 天前"）
2. 未识别 → `null`；`now` 注入下确定性
3. `rankFusionRRFPre`：无 `temp` 输入输出与当前版本逐项相等（**回归证明**）；有 `temp` 时命中范围的候选排序上升
4. `recall()`：查询含时间表达 → 命中该时间范围的日志条目排序提升；不含时间表达 → 与现状一致
5. 新增断言覆盖 1-4；既有基线不降：m4 / p8 14 / p4 34 / evidence-agg 14 / memory-importance 18 / p9a 26 / p9d 13 / handoff 51 / continue-chain 58
6. 回报附一个**真实数据示例**：用一条含"上周"的查询，展示时间臂接入前后 top-5 的 `id` 序列变化

## 6. 停止条件

- 若 `recall()` L0 分支的 `label` 不含可抽取的日期（例如日志文件名不是 `YYYY-MM-DD.md`）→ 停止回报，说明实际格式；
- 若 `rankFusionRRFPre` 的 `pairs` 形状与本节描述不符 → 停止回报。

```
停止原因：<描述>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 7. 完成后自检（静态，不重启）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory
node --check lib/temporal-parse-pre.js
node --check lib/recall-fusion-pre.js
node --check lib/index.js

node tests/smoke/smoke-test-temporal-parse-pre.mjs              # 新增
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs               # 14
node tests/smoke/smoke-test-p4-l0-response-pre.mjs              # 34
node tests/smoke/smoke-test-m4-pre.mjs                          # 全绿
node tests/smoke/smoke-test-evidence-agg-pre.mjs                # 14
node tests/smoke/smoke-test-memory-importance-pre.mjs           # 18
node tests/smoke/smoke-test-p9a-correction-attribution-pre.mjs  # 26
node tests/smoke/smoke-test-p9d-recent-evidence-ts-pre.mjs      # 13
node tests/smoke/smoke-test-handoff-pre.mjs                     # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs              # 58

git status --short
git diff --stat
```

## 8. 回报必须包含

1. 每个新/改文件：`文件:行号 — 原内容 → 新内容`
2. `parseTemporalQueryPre` 覆盖表 + fixture 结果
3. `rankFusionRRFPre` 无 `temp` 时的回归证明（逐项相等）
4. 时间臂接入前后 top-5 的 `id` 序列变化（真实数据示例）
5. 时区假设说明
6. 静态结论 + **重启后 live 验证项**：用一条含时间表达的查询实测召回是否按时间提升
7. 回滚：`git checkout` 相应文件 + 删除新增文件

## 硬约束（全程）

- 搜索优先；最小 diff；零新依赖；不改既有 API 签名；不删既有断言
- 时间臂是**软提升**，绝不硬过滤
- **不尝试重启 dsh web**

---

> 背景：`D:\dsh-auto-memory\docs\STATUS-BOARD.md` §8（时间检索臂为近期优先）。
