# 【任务】index.json 写放大治理 —— 独立架构调查

你是独立架构调研 Agent。**只读调研 + 出方案，不改生产代码。**
工作目录：`D:/dsh-auto-memory`

---

# 第一部分：为什么会有这个任务（背景，必读）

## 1.1 触发点

批次 2 的 **2.5 第二步（白板自动重绘）** 被卡住。原本以为是个小改动（「事件写完后顺手重绘白板」），
实测发现：**每重绘一次要写 7.43 MB**，其中 99.36% 是一个叫 `handoff/index.json` 的文件。
细则预估「每轮多写 26 KB」，**实际差 280 倍**。功能因此搁置。

但继续查下去发现：**这根本不是 2.5 的问题，是 index.json 本身的架构问题。**
用户（本项目作者）的判断：

> 「这个既定设计明明就是有问题的，我觉得应该是既定架构的问题，它不是一个完整的系统性的内容。
> 比如说，它可以往外暴露 API，只要通过 API 来读写即可。它是一个非常脆弱的架构，
> 并且非常依赖于一些低效的代码和全量重建的代价，明明可以基于 diff，你非要完全重建。」

**本任务就是把这个判断变成一份可执行的技术方案。**

## 1.2 已经实测到的硬数字（可直接引用，不必重测，但鼓励复核）

### 单次 writePlanSnapshot 的写盘构成

| # | 写什么 | 代码位置 | 字节 | 占比 |
|---|---|---|---|---|
| 1 | 旧白板归档 | index.js:5290-5295 → plan-store.js:176-181 | 27,397 | 0.37% |
| 2 | 新白板正文 | index.js:5352 | 19,716 | **0.27%** |
| 3 | **sidecar index.json 整份重写** | index.js:5357 → :5439-5467 → :5473-5496 | **7,382,763** | **99.36%** |
| 4 | events.jsonl 追加一行 | index.js:5362 | ~120 | ~0% |
| | **合计** | | **7,429,996 B = 7.43 MB** | |

写盘**次数**：4 次内容写 = 6 次文件系统操作（正文与 index 各含 tmp 写 + rename）。

### index.json 的内部结构（实测拆分）

| 键 | 体积 | 占比 | 性质 |
|---|---|---|---|
| entries | 3,853,434 B | **52.2%** | **2,848 条**条目数组（真数据） |
| by_cue | 674,561 B | 9.1% | **7,336 个键**的倒排索引（**纯派生**） |
| by_tag | 177,489 B | 2.4% | 79 个键（**纯派生**） |
| sourceRevisions | 61,968 B | 0.8% | 596 个键 |
| versions | 2 B | ~0% | 空对象 |
| version / ws / rebuilt_at | 极小 | — | 元数据 |
| **文件总计** | **7,382,763 B** | | JSON.stringify(obj, null, 2) 缩进 2 空格 |

### 耗时实测

read 25 ms / JSON.parse 18 ms / stringify 41 ms = **84 ms**（不含写盘）；
报告另一次采样：rebuild 100 ms + stringify 87 ms + atomicWrite 56 ms = **243 ms**。

### 调用频次（本机今日真实数据）

memory_log 9 次 / 检查点 23 条 / 新建事件 2 个。
若 2.5 第二步按细则「四个写分支都挂」接线：约 **20 次/日 = 148.6 MB/日**。
一轮普通对话（1 log + 1 event）约 **14.9 MB**。

### 关键：受影响的**不只是**自动重绘

**每一次手动 memory_note(kind='plan', fromEvents:true)、每一次手写白板保存，都在付这 7.43 MB。**
这是**既有的、独立于 2.5 的性能缺陷**。

## 1.3 已知的代码事实（已读过，可直接用；行号以当前 HEAD 为准）

### 写入链（全量重写发生在这里）

```js
// lib/index.js:5229  async writePlanSnapshot(projectDir, content, opts)
//   :5357  const index = await this.writeSidecarEntryPre(projectDir, 'handoff/PLAN.md', written, '白板 PLAN', '')
//  lib/index.js:5439  async writeSidecarEntryPre(projectDir, relPath, text, title, ts)
//   :5446  const newEntries = buildSidecarEntriesPre({...})
//   :5451  let index = JSON.parse(await readFile(idxPath, 'utf8'))      // ← 读全量
//   :5459  index.entries = index.entries.filter(...)                     // ← 改内存
//   :5461-5464  for (const e of newEntries) { upsert }                   // ← 改内存
//   :5466  await this._writeSidecarIndexPre(projectDir, index)
//  lib/index.js:5473  async _writeSidecarIndexPre(projectDir, index)
//   :5476  const fresh = rebuildSidecarIndexPre(wsKey, entries.map(...)) // ← 全量重建
//   :5482  fresh.by_tag = buildByTagPre(entries)                        // ← 全量重建
//   :5483  fresh.by_cue = buildByCuePre(entries)                        // ← 全量重建
//   :5494  const saved = await writeTextAtomicPre(idxPath, JSON.stringify(fresh, null, 2))  // ← 全量序列化 + 整份原子写
```

### 倒排索引的构造（lib/wb-sidecar.js:510）

```js
export function buildByCuePre(entries) {
  const byCue = Object.create(null)
  for (const e of Array.isArray(entries) ? entries : []) {
    for (const c of Array.isArray(e.cues) ? e.cues : []) {
      if (!byCue[c]) byCue[c] = []
      if (!byCue[c].includes(e.id)) byCue[c].push(e.id)
    }
  }
  return byCue
}
```

**观察**：这是一个普通倒排 by_cue[cue] = [entryId...]。
增量维护 = 「从旧 entry 的 cues 摘掉该 id + 从新 entry 的 cues 加进去」，复杂度 O(该条目 cues 数)，
**没有任何技术理由需要 O(2848) 全量重建**。

### 原始设计意图（代码注释原文，index.js:5434）

```
*  index.json 完全可重建(真源=Markdown 文件本身); 任何错误 fail-soft(绝不影响主写入路径)
```

**「完全可重建」本是安全优点**（索引坏了不会丢数据，rebuildSidecarIndexPre() 能从 Markdown 全量重建），
但被**误用**成「所以每次写都全量重建也无所谓」。

### 历史事故（影响方案选择，必须遵守）

index.js:5485-5492 注释记录的实测事故：
> 旧实现是裸 writeFile(index.json, ...)，这份索引 235 KB，**写入过程不是原子的**：
> 面板/工具恰在此时读，读到的要么是零字节、要么是半截 JSON ⇒ JSON.parse 失败 ⇒
> 看板/白板**整块空白**，写完才恢复（用户实测：「白板不见了 → 过了一会儿又出现了」）。

**⇒ 任何增量方案必须保住「读侧永远读到完整 JSON」这个不变量。**

## 1.4 环境与规模

- 工作区：C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/
- 该工作区 archive/ 有 **329 份 PLAN 归档 / 4,097,500 B**（entries 因此涨到 2,848 条）
- **新用户工作区会小很多**，但按同比例放大 ⇒ 结论必须给出「随规模变化的曲线」，不能只针对本机
- Node 版本见 node -v；宿主是 Electron（ELECTRON_RUN_AS_NODE=1）

---

# 第二部分：要回答的四个问题

## 问题 1：为什么卡住？（把因果链说清楚）

不只是复述上面的数字。要回答：

1. **为什么当初会选择「全量重建」？** 找出代码里能证明动机的注释/commit。
   是**格式限制**（JSON 不好增量）？是**原子性**（整份 rename 保证不读半截）？
   是**简单**（先跑通再说）？还是**真有一致性要求**？给证据。
2. **哪些是「必须」、哪些是「选择」？** 逐项判定：
   - entries 全量序列化 —— 必须吗？
   - by_cue / by_tag 落盘 —— 必须吗？还是纯浪费？
   - rebuildSidecarIndexPre 每次都跑 —— 为什么不是只在启动/损坏时跑？
   - sourceRevisions 596 个键 —— 谁在消费？
3. **谁是真正的消费者？** 全仓普查：谁读 index.json？
   （面板？工具？graph 层？Tier-0 目录？语义检索？）逐个列出**读什么字段**。
   **没有消费者的字段就是可以砍的** —— 这一条要给出 grep 证据。

## 问题 2：发现了哪些困难？（风险清单，按严重度排序）

必须覆盖至少这些，可以补充：

1. **原子性 vs 增量**：JSONL 追加要不要 fsync？崩溃在半行怎么办？读侧要不要跳过残行？
2. **并发**：多个会话/多个 workspace 同时写同一个 index.json 会怎样？
   现有 withCalendarLock / withMemoryAdmissionScopePre 覆盖到了吗？
3. **派生索引的一致性**：by_cue 若改为内存维护，**进程重启后如何重建**？重建耗时是否可接受（现测 100 ms）？
4. **versions / sourceRevisions 的语义**：它们是不是也纯派生？能不能一起干掉？
5. **向后兼容**：存量用户磁盘上已有 7 MB 的 index.json，新代码怎么读旧格式？要不要迁移？迁移失败怎么办？
6. **回滚**：新方案出问题时怎么退回旧格式？
7. **archivedIds / M1 保护门**是否依赖 index.json 的某个字段？（若依赖，不能砍）

## 问题 3：需要调查哪些？（必须给出可复算的实测）

**每一条都要给命令/脚本 + 数字，不接受「应该会更快」。**

1. **消费者普查**：全仓 grep index.json / readSidecarIndexPre / by_cue / by_tag / sourceRevisions / versions，
   列出每个命中点的**文件:行号 + 读了哪个字段 + 读来干什么**。
2. **字段活跃度矩阵**：对上面 8 个顶层键，逐个标注「有消费者 / 无消费者 / 仅写不读」。
3. **规模曲线**：构造 100 / 500 / 1000 / 2000 / 2848 / 5000 entries 的合成 index，
   测 stringify / parse / 落盘 / 读取 各自耗时与字节。**给表 + 拟合曲线**。
4. **方案原型实测**：至少做 **2 个**可跑的 PoC（在 artifacts/_index-gov-20261109/ 下，**不动生产文件**）：
   - PoC-A：JSONL append-only + 内存构建倒排（测：单次追加耗时/字节、启动重建耗时）
   - PoC-B：你自选的其它方案（SQLite / 分段 JSON / 双文件 entries+invert 分离 等）
   每个 PoC 都要测：**单次写字节数、单次写耗时、读取耗时、启动重建耗时、崩溃半行容忍**。
5. **对比矩阵**：对至少 3 个方案（现状 / L1 短路 / L2 换格式 / L3 SQLite 或你的方案），
   给出维度：单次写字节 / 写耗时 / 读耗时 / 启动成本 / 迁移成本 / 原子性 / 并发安全 / 改动面（多少文件、多少消费者）。
6. **迁移可行性**：存量 7 MB index.json → 新格式的迁移脚本思路 + 估算耗时 + 失败回滚路径。

## 问题 4：出什么结果？（交付物格式）

**交付一个文件**：docs/internal/ARCH-INDEX-JSON-20261109.md，必须包含：

1. **TL;DR（不超过 10 行）**：结论 + 推荐方案 + 预期收益（给数字）
2. **因果链**：为什么今天会变成全量重建（时间线 + 代码证据）
3. **字段活跃度表**：8 个顶层键 × 「有/无消费者 + 证据行号」
4. **方案对比矩阵**（至少 3 方案 × 至少 8 维度）
5. **推荐方案**：明确到「改哪几个文件、改什么、多少行量级」
6. **PoC 实测数据**（表格 + 原始日志放 artifacts/_index-gov-20261109/out/）
7. **迁移与回滚方案**
8. **风险清单**（按严重度排序 + 每条给缓解措施）
9. **分阶段落地建议**：S1/S2/S3...，每阶段有独立验收判据与「做不下去就停」的止损点
10. **诚实边界**：哪些结论是实测、哪些是推理、哪些没验证

---

# 第三部分：硬纪律（违反即返工）

1. **只读**：不得改 lib/ / tests/ / tools/ 下任何文件。所有实验产物放 artifacts/_index-gov-20261109/。
2. **真跑**：所有数字必须本机实测，**禁止用「应该会快很多」这类表述**。跑不出来的如实写「未测」。
3. **可复算**：脚本 + 固定数据 + 随机种子，换台机器能跑出同样数字。原始输出落盘。
4. **禁止编造消费者**：说某字段「有人在读」必须给 文件:行号；说「没人读」必须给 grep 空结果。
5. **区分实测与推理**：报告里每条结论标注 [实测] 或 [推理]。
6. **不要照抄本文件**：本文件给的数字是**起点**，你要复核并指出错的地方（若发现本文件有错，明确写出）。
7. **本机坑（已踩过，别再踩）**：
   - os.tmpdir() 在本环境返回 undefined\temp（相对路径陷阱），临时文件请放工作区内
   - Windows 上写文件可能撞 UNKNOWN: unknown error, open（宿主占用），重试即可
   - index.json 目前 7.38 MB，**不要整文件复制多次**浪费磁盘；用流式或复用

---

# 第四部分：一句话目标

> **回答「index.json 能不能从「每次全量重写 7.4 MB」变成「增量写几十 KB」，如果能，怎么做、代价多大、风险在哪、分几步走」。**

如果结论是「不能」或「不值得」，也要给出**证据充分的否定结论** + 替代方案（例如：保留全量但把频次压到极低 / 接受现状但把 index 拆小）。