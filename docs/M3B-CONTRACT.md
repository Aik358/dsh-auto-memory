# M3b 稳定 Anchor 与持久索引契约

> 状态：M3b-4 真实迁移已完成并 live verified（31/31 文件、176 anchored 记录、31 sidecar）；本文保留 M3b-0..3 的历史设计与实施记录
>
> 工作区：D:\dsh-auto-memory（preview 分支）
>
> 权威架构：docs/proactive-associative-memory-system-map.html（M-06）
>
> 前置状态：M0-R / T0 / M1 / M2 / P-A / M3a / M3b-1/2/3/4 均已 live verified；当前下一里程碑为 M4 Shadow Retrieval（审计-only、默认关闭）

## 1. 本阶段目标

M3b 在保持 Markdown 可读、可编辑、可恢复的前提下，为每个逻辑记忆记录加入稳定身份，并将 M3a 的临时只读索引升级为可跨重启维护的 sidecar 索引。

本阶段交付：

1. 稳定 memoryId 与 Markdown anchor。
2. 可由 Markdown anchor 重建的 per-file sidecar。
3. 跨重启 sourceVersion 状态。
4. 原子或可恢复的记忆写入事务。
5. 旧无 anchor Markdown 的 dry-run 迁移规划器。
6. 全部记忆写路径迁移清单与夹具测试。

本阶段不包含 M4-M7 的实现；真实 Markdown 迁移属于 M3b-4 的明确门控步骤，已在本文 §19 记录完成。M4 Shadow Retrieval 由 docs/M4-CONTRACT.md 单独规定。

## 2. 不可协商约束

1. memoryId 一经分配永久稳定，不由内容、digest、路径或行号派生。
2. Markdown 是人类可读权威投影；sidecar 是可重建派生物。
3. 行号只作 UI/debug locator；身份依赖 memoryId/anchorId。
4. sourceVersion + fileDigest + recordDigest 共同校验新鲜度。
5. 所有区间为原始 UTF-8 字节半开区间 [start,end)。
6. 关闭新功能时，现有 Markdown 输出必须逐字节保持旧行为。
7. 真实迁移前必须有备份、dry-run 计划和用户明确确认。
8. duplicate/malformed/conflicting anchor 必须 fail closed，不得静默重编号。
9. 保持 UTF-8 无 BOM，并保留原文件 LF/CRLF 风格。
10. preview 对外与持久化命名空间全部使用 _pre/-pre。
11. CALENDAR.md 暂不纳入 M3b anchor 体系。
12. 本阶段不得顺手启用检索、证据或注入。

## 3. 身份与 Anchor 格式

~~~text
memoryId = mem_<32 lowercase hex>
anchorId = memory:<memoryId>
marker   = <!-- memory:<memoryId> -->
~~~

推荐以 crypto.randomUUID() 首次分配并移除连字符：

~~~text
mem_7f8f6a45e27b45a09bcfd76f93acfd70
~~~

随机 ID 只在记录创建或迁移计划创建时分配一次。后续内容编辑、块移动、压缩或换行变化不得改变 ID。

Anchor marker 必须独占一行，固定放在逻辑记录内容之前。解析不依赖标题层级：一个 anchor 的内容从 marker 行结束后的首字节开始，到下一个合法 marker 的首字节或 EOF 为止。

推荐粒度：一次明确写入事务 = 一个 memoryId。

- memory_log_pre：一次调用的单条日志为一个记录。
- memory_note_pre / memory_user_pre append：一次调用为一个记录。
- 自动沉淀：一次 LOG / NOTE / USER 分组分别为一个记录，不把每个 bullet 单独编号。
- 一份 reflection 文件：一个记录。
- 一次外部链接导入 block：一个记录。
- 一次维护蒸馏结果：一个记录。
- 旧记录迁移：一个旧 heading block 对应一个 memoryId，不猜测拆分历史 bullet。

## 4. Locator 契约

~~~ts
interface MemoryLocator {
  memoryId: string
  anchorId: string
  sourceFile: string
  sourceEpoch: string
  sourceVersion: number
  fileDigest: string
  anchorLine: number
  anchorByteStart: number
  anchorByteEnd: number
  lineStart: number
  lineEnd: number
  byteStart: number
  byteEnd: number
  recordDigest: string
}
~~~

byteStart/byteEnd 和 recordDigest 只覆盖记录内容，不包含 marker。

## 5. Anchor 解析

合法 marker：

~~~regex
^<!-- memory:(mem_[0-9a-f]{32}) -->\r?$
~~~

解析状态：anchored、legacy、orphan-anchor、duplicate-anchor、malformed-anchor、orphan-content。

duplicate、malformed 或冲突 ID 必须阻止写入和迁移。用户输入中出现保留 marker 语法时，写入闸门必须拒绝。

## 6. Sidecar

位置：

~~~text
<DSH_HOME>/memory/index-pre/files/<sha256(canonicalSourcePath)>.json
<DSH_HOME>/memory/index-pre/plans/<planId>.json
<DSH_HOME>/memory/index-pre/backups/<migrationId>/...
~~~

不得在 Markdown 同目录散落 JSON。

~~~json
{
  "schemaVersion": 1,
  "namespace": "dsh-auto-memory-pre",
  "sourceFile": "D:/.../MEMORY.md",
  "sourceEpoch": "uuid",
  "sourceVersion": 7,
  "fileDigest": "sha256-hex",
  "newline": "lf",
  "updatedAt": 0,
  "records": []
}
~~~

规则：

- digest 不变：保持 sourceVersion。
- digest 变化：sourceVersion + 1。
- sidecar 缺失：从 Markdown anchors 重建，新 sourceEpoch，sourceVersion=1。
- sidecar 损坏：隔离损坏文件，从 Markdown 重建，不修改 Markdown。
- sidecar 失败不能回滚已成功写入的 Markdown；标记 dirty，后续重建。
- 删除 sidecar 会开启新 epoch。

## 7. 只读迁移规划器

planner 只读 Markdown，输出计划，不修改真实文件。

~~~ts
interface MigrationPlan {
  schemaVersion: 1
  planId: string
  createdAt: number
  sourceFile: string
  expectedFileDigest: string
  newline: 'lf' | 'crlf'
  operations: Array<{
    kind: 'insert-anchor'
    atByte: number
    memoryId: string
    anchorId: string
    legacyLineStart: number
    legacyLineEnd: number
    legacyRecordDigest: string
  }>
  conflicts: Array<object>
}
~~~

要求：

- dry-run 不改 Markdown。
- plan 分配随机 ID 后先持久化；重跑同一 plan 复用相同 ID。
- 应用前重新校验 expectedFileDigest；变化则整个 plan stale。
- 非空 preamble 形成一个 legacy 记录。
- 每个旧 heading block 默认形成一个记录。
- 已有合法 anchor 不重新分配 ID。

真实迁移必须在 fixture/shadow-copy 测试通过、用户查看 diff、创建并校验备份、用户明确批准之后执行；该门控已在 M3b-4 完成。后续压缩恢复不再回到 M3b planner，当前转入 M4-1，详见 docs/M4-CONTRACT.md。

## 8. 专用写入事务

不要在通用 appendText/writeFull 中盲目插 anchor，因为它们也服务非记忆文件。

新增专用 API：

~~~text
appendMemoryRecord(file, record)
replaceMemoryDocument(file, replacement)
writeMemoryRecordFile(file, record)
removeMemoryRecords(file, ids)
rebuildMemorySidecar(file)
~~~

每个绝对文件维护独立串行 Promise 队列。

事务步骤：

1. 读取当前 bytes，记录 expectedFileDigest 与 newline 风格。
2. 解析并验证 anchors。
3. 生成新 bytes。
4. 校验无 BOM、anchor 唯一、可重建。
5. 同目录写临时文件并 fsync。
6. 创建/更新 backup。
7. 原子替换目标；Windows replace 必须专项测试。
8. 重读并校验 digest。
9. 重建并原子写 sidecar。
10. 更新当前 runtime 缓存。

外部编辑导致 digest 不匹配时禁止覆盖，必须重新读取或返回 conflict。

## 9. Replace 语义

memory_note_pre / memory_user_pre replace 是最高风险路径。

- 输入中保留的合法 anchor 保持原 ID。
- 未带 anchor 的新 block 分配新 ID。
- 原有但省略的 ID 视为删除。
- duplicate/malformed anchor 拒绝。
- 禁止依据相似文本、标题或 digest 猜测同一身份。
- 已有 anchor 文件的整篇 replace 默认先 dry-run reconcile，不能直接覆盖。

## 10. 全写路径清单

必须逐项迁移和测试：

- memory_log_pre
- memory_note_pre append / replace
- memory_user_pre append / replace
- memory_reflect_pre
- 自动沉淀 LOG / NOTE / USER
- compact/maintain 新摘要与 archive
- 外部记忆 import / remove
- GUI API.note 手动追加
- 反思自动生成路径

archive 移动应保留原 ID。compact/maintain 的新摘要分配新 ID并记录 sourceMemoryIds；不能复用被摘要记录的 ID。

不纳入 CALENDAR、greeting/cache/config/heartbeat/notices、Session JSONL、外部源原文件。

## 11. 配置

建议新增：

~~~text
memoryAnchorEnabled: false  // DEFAULT_CONFIG 默认值；2026-08-22 线上实例经用户批准为 true，见 §19
~~~

- false：全部旧 Markdown 写法逐字节不变，不创建 sidecar，不分配 ID。
- true：只对新写入使用 anchor-aware API，不自动迁移旧内容。
- 真实迁移只能通过显式 plan。
- 与 memoryFileIndexEnabled 的依赖关系必须固定并测试：建议开启 anchor 时自动启用只读索引；关闭 anchor 不强制关闭索引。

## 12. 实施阶段

### M3b-0：契约冻结

完成本文与进度回写，不改生产写路径。

### M3b-1：Parser + Sidecar + Dry-run Planner

扩展 memory-index-pre.js；实现 sidecar schema、重建、损坏降级、planner 和 fixture 测试。不接入真实写路径，不迁移真实文件。

### M3b-2：原子写入基础设施

实现 per-file queue、digest precondition、temp/backup/replace/recovery，并做并发/故障注入测试。开关仍为 false。

### M3b-3：全写路径接入

逐项迁移第 10 节清单，只用临时 DSH_HOME 与 shadow copy 测试，保持默认关闭逐字节回归。

### M3b-4：真实迁移与 Live Verification

生成真实 dry-run 计划和备份；用户批准后分批迁移；验证重启重建、读写和回滚。

## 13. 最小测试矩阵

1. ID 格式与全局唯一。
2. parse/render 幂等。
3. LF/CRLF、多字节、无尾换行、preamble。
4. duplicate/malformed/orphan anchor 拒绝。
5. 用户伪造 marker 被拒绝。
6. legacy plan 重跑 ID 稳定。
7. plan digest stale 拒绝。
8. sidecar 跨重启 sourceVersion 递增。
9. sidecar 删除/损坏后重建。
10. 内容编辑和 block 移动保留 ID。
11. 并发写同文件不丢失。
12. 外部编辑冲突不覆盖。
13. temp/rename/sidecar 写失败恢复。
14. replace 保留/新增/删除 ID。
15. archive 保留 ID，新摘要使用新 ID。
16. 全写路径 fixture 覆盖。
17. 默认关闭与当前基线逐字节一致。
18. 输出 UTF-8 无 BOM。
19. 真实记忆目录零污染。

## 14. 压缩后恢复指令（M3b 已收官；当前入口见 M4-CONTRACT §22）

新模型必须：

1. 先读 docs/proactive-associative-memory-system-map.html。
2. 再读 docs/M3B-CONTRACT.md。
3. 运行 git status --short --branch，保留全部未提交和未跟踪文件。
4. M3b-1/2/3/4 已完成并 live；当前不要修改 M3 生产路径，转入 docs/M4-CONTRACT.md 的 M4-1。
5. 按 docs/M4-CONTRACT.md §20 只实施 M4-1 纯模块与 fixtures：C-03 Gate、RetrievalContextSnapshot validator、tokenizer/QueryPlan、候选评分/排序/去重/预算和 pure replay。
6. 新持久化命名空间使用 _pre/-pre。
7. 运行全量 10 项既有回归与 M4-1 新增测试、node --check、git diff --check 和 BOM 扫描。
8. 回写 system-map progressLedger、docs/M4-CONTRACT.md 实施状态与 docs/PREVIEW-NEXT-STEPS.md。
9. 不 commit、不 push、不发布、不启动替代 GUI。

## 15. 实施状态（M3b-1 完成，2026-08-22）

状态：**M3b-1 Parser + Sidecar + Dry-run Planner 已完成并通过测试**；M3b-2/3/4 未开始；真实 Markdown 未迁移、未接入真实写路径。

| 条目 | 状态 |
| --- | --- |
| lib/memory-anchor-pre.js（新模块，零依赖，纯只读） | 已交付 |
| parseAnchors：anchored/legacy 分类 + preamble 按 heading 切块；orphan-anchor / duplicate-anchor / malformed-anchor / orphan-content 一律 conflict（fail closed）；BOM 输入容忍并标记 | 已交付 |
| buildSidecar / parseSidecar：digest 不变保版本、变化 +1、无 prev 新 epoch（UUID）；8 字段 + 记录级校验，损坏返回具体 reason | 已交付 |
| planMigration：planId 确定性（sha256(sourceFile+digest)）；复用键 digest#出现序号（同 digest 块独立 ID 不塌缩）；digest 变化整份 stale 拒绝；conflict 即 aborted | 已交付 |
| tests/m3b1-fixtures/ 6 个 fixture（anchored/legacy/conflict/malformed/crlf/multibyte） | 已交付 |
| smoke-test-m3b1-pre.mjs：C1-C9 + C6.5 + C18（共 11 组断言），hard-fail guard，零磁盘写入 | exit 0 |
| 全量回归：既有 7 项测试 + 新 M3B1 共 8 项 | 全部 exit 0 |
| node --check 4 个 lib 文件 / git diff --check / BOM 扫描 | 0 通过 / 干净 / 无 BOM |

自审修订记录：

1. splitByteLines 不返回行号（行号=下标+1）→ 模块显式补齐 lineNumber 字段。
2. preamble 语义确认：heading 块并入跟随散文本为**一个** legacy 块（契约 §7「非空 preamble 形成一个记录」）。
3. existingPlan 复用按 digest 映射在「两个 legacy 块内容相同」时会塌缩成重复 ID → 改为 digest#出现序号 复合键，重跑按文件顺序稳定复用且 ID 保持互异（C6.5 回归）。

下一步：**M3b-2 原子写入基础设施**（per-file 串行队列、digest precondition、temp/backup/replace/recovery、并发与故障注入测试；memoryAnchorEnabled 仍保持 false）。

## 16. 架构审查结论（M3b-1 复审，2026-08-22）

对照 docs/proactive-associative-memory-system-map.html M-06 模块 Meta code 与 §3-§7 逐条核对后的结论。

**审查通过项**：

1. M-06 MemoryLocator（HTML 976-980 行）是 §4 locator 的子集，字段名/字节语义完全一致；coverage() 语义与 M3a 相同（stale ≠ coverage=0）。
2. project() 流程（M-06 982-989 行）逐项对应：allocateMemoryId→newMemoryId、stableAnchor→ANCHOR_PREFIX+MARKER_RE、atomicWrite→M3b-2 待办、sidecar.index→buildSidecar、memoryFileIndex.rebuild→M3b-2 anchor-aware rebuild 待办。
3. 命名空间：sidecar namespace="dsh-auto-memory-pre"、路径 index-pre/ 与契约 §6 一致；无 _dev/裸名。
4. 解析分类与 fail closed 语义按 §5；BOM 输入容忍并标记；CRLF/LF/mixed 检测；多字节字节区间与 M3a 同算法。

**审查发现并修复（2 项）**：

1. **sidecar records 缺 per-record 文件级身份**：records 现携带 sourceVersion+fileDigest（构建时文件快照），与 M3a 记录的"文件任何位置变化 ⇒ 全部 locator stale"语义对齐，堵住 M3b-2 写入事务绕过文件级校验的回退路径。
2. **sidecar records 缺 marker 字节区间**：anchorByteStart/anchorByteEnd（marker 行自身区间）补入，使 sidecar 满足 §4 locator 字段完整性；parseSidecar 同步校验（记录级共 11 字段）。

**审查确认的衔接项（M3b-2 必须覆盖，非 M3b-1 缺陷）**：

1. **renderBlock 未实现**：M-06 project() 的 Markdown 渲染（marker + 内容块、空行分隔、CRLF 保持）是 M3b-2 首项，与 parseAnchors 成对保证 render(parse(x)) 幂等（矩阵第 2 条）。
2. **M3a buildIndex 的 anchor 感知**：anchor 化后 marker 行会被 M3a buildIndex 并入前一块（marker 非 heading）。M-06 明确 memoryFileIndex.rebuild 基于 anchor 区间；M3b-2 需让 buildIndex 识别 marker 行作为块边界（或提供 anchor-aware 变体），保持与 sidecar records 字节区间一致。
3. **buildSidecar sourceEpoch 注入语义**：无 prev 时默认新 UUID epoch；调用方可显式注入（如掌上端恢复已知 epoch 时）；契约"重建=新 epoch"仍为默认。
4. **path 规范**：planId 依赖 sourceFile 字符串，调用方必须传稳定的规范化绝对路径（统一分隔符/大小写），否则同文件不同写法会得到不同 planId（不会错配 ID，仅计划标识变化）。

**复审后状态**：C1-C9 + C6.5 + C18 全部断言通过（含新增的记录级 11 字段校验与 mixed/lf 换行断言）；全量 8 项测试 exit 0；node --check / git diff --check / BOM 扫描干净。

**复审轮 2（2026-08-22，用户要求继续加固）**：

发现并修复 3 项：

1. **超限防御缺失（真实缺陷）**：M3a 有 INDEX_MAX_FILE_BYTES（>5MB 跳过），M3b-1 三入口（parseAnchors/buildSidecar/planMigration）全部裸跑，超大记忆文件会同步全量解析+哈希阻塞，且与 M3a skipped 语义不一致。修复：parseAnchors 超限返回 status:'oversized'（新解析状态，§5 之外属输入级防御）、records/conflicts 为空、不做任何哈希；buildSidecar 返回 ok:false reason:'oversized'；planMigration aborted:true + oversized:true + expectedFileDigest:''（跳过文件哈希，planId 仅由 sourceFile 派生）。上限内文件行为不变。
2. **parseSidecar 读取端 BOM 容忍**：外部工具写 JSON 常带 BOM，JSON.parse 会直接失败；读取端现剥离 \uFEFF 再解析（写入端仍从不产出 BOM，与用户 BOM 纪律一致：读入容忍、写出干净）。
3. **测试补强**：C3 增加 mixed/lf 换行检测断言与 anchored×CRLF 组合用例（既有 crlf fixture 只覆盖 legacy）；C9 增加 BOM 前缀 sidecar 解析断言（含解析结果一致性）；新增 C10 超限防御断言（三入口一致 + 正常文件不受影响）。断言总数升至 13 组。

复审轮 2 后状态：C1-C10 + C6.5 + C18 全部通过；全量 8 项测试 exit 0；node --check / git diff --check / BOM 复查干净；未触及真实记忆与写路径。

## 17. 实施状态（M3b-2 完成，2026-08-22）

状态：**M3b-2 原子写入基础设施已完成并通过测试**；M3b-3（全写路径接入）未开始；memoryAnchorEnabled 仍默认 false，真实写路径未接、真实 Markdown 未迁移。

| 条目 | 状态 |
| --- | --- |
| lib/memory-writer-pre.js（新模块，fs 可注入） | 已交付 |
| applyMigrationPlan：digest 匹配/aborted/冲突/ID 唯一/升序/非行首/超限 校验矩阵，已迁移文件重放拒绝（stale-plan / not-legacy-start 双路径） | 已交付 |
| appendAnchoredRecord：尾部 marker+空行+内容渲染，换行风格沿用文件，duplicate-id 拒绝，追加不位移既有块 | 已交付 |
| renderReplace（§9）：kept/added/removed/foreign/conflict/清空全语义；解析规则——anchored 之后的无 marker 文本属于该记录内容，新块须在 preamble 或两 anchored 之间 | 已交付 |
| atomicReplace：同目录 tmp + fsync + rename；失败清理 tmp；Windows 覆盖实测 | 已交付 |
| MemoryDocumentStore：per-file 串行队列、digest precondition、backup（失败中止）、sidecar 自动续 prev（digest 变 → version+1、epoch 保持；sidecar 缺失/损坏 → 新 epoch）、sidecar 写失败 dirty 不回滚 | 已交付 |
| 防御修正：idFactory 重试上限 100（恒定注入不挂死，aborted id-exhausted）；_commit 自动读已落盘 sidecar 作 prev（否则 version 恒 1） | 已交付 |
| memory-anchor-pre.js 新增 buildAnchoredIndex（M-06 rebuild 的 anchor 语义）：镜像 parseAnchors 区间、marker 不在内容内、文件级 stale、超限 skipped、冲突文件不产投影 | 已交付 |
| smoke-test-m3b2-pre.mjs D1-D10（幂等/校验矩阵/§9 replace/并发/故障注入/sidecar 生命周期/anchor index/超限贯穿） | exit 0 |
| 全量回归：既有 8 项 + 新 M3B2 共 9 项 | 全部 exit 0（6.6s） |
| node --check 5 lib / git diff --check / BOM | 0 通过 / 干净 / 无 BOM |

自审中发现的问题（修复闭环）：恒定 idFactory 死循环（模块加重试上限 + D2 回归断言）；store 每事务 sidecar 版本恒为 1（_commit 自动续 prev 修复，D4 断言 version=2 通过）；§9 解析语义边界（anchored 后无 marker 文本不独立成块，D3 用例结构修正并文档化）。

**M3b-2 复审轮（2026-08-22，用户要求全流程检验后再进 M3b-3）**：

逐行重读 memory-writer-pre.js + 对照契约 §8 步骤清单/§13 矩阵/M-06 后发现并修复 6 项：

1. **契约 §8 步骤 8 缺失（真实缺陷）**：_commit 重读了文件但未比较 digest 是否等于预期写入内容。补齐：不一致返回 {ok:false, reason:'verify-mismatch', written:true}（D13 故障注入锁定）。
2. **空记录可写入（真实缺陷）**：appendAnchoredRecord('') 会产出"marker 无内容"文档 → 文件进入 orphan-anchor conflict 态、后续全部写入被拒。入口拒绝：reason:'empty-record'（D12 锁定：不建文件、零副作用）。
3. **backup 同毫秒覆盖**：备份名仅时间戳，队列快速连写会覆盖上一份备份 → 名字加随机段。
4. **_locks Map 无界增长**：长期运行每个写过文件的 key 永久留存 → 队列空闲即回收条目（新任务自动重建链）。
5. **BOM 现有文件 append 行为未定义未测**：现版 _commit bom-rejected 拒绝（fail closed，符合 §10 无 BOM），D11 锁定：拒绝且字节零改动。
6. **矩阵 3 写入侧缺口**：CRLF 文件 append 渲染无显式断言 → 补（marker/内容 \r\n、preamble legacy 保留、parse 回读 crlf clean）。

结构性检查：lib/index.js 对 memory-writer-pre/MemoryDocumentStore **零引用**（grep 证实）——writer 未接入引擎即默认关闭的结构性证明；detectNewline 未使用 import 清理。

复审轮后状态：smoke-test-m3b2-pre.mjs D1-D13 exit 0；全量 9 项测试 6.6s 全部 exit 0；node --check 5 lib / git diff --check / BOM 复查干净；真实记忆与真实写路径零接触。

**M3b-3 就绪确认**：写入事务层契约完备（渲染/原子替换/队列/precondition/backup/sidecar/故障注入接口），可以开始第 10 节清单的全写路径接入；仍受约束——仅临时 DSH_HOME 与 shadow copy 测试、memoryAnchorEnabled 保持 false 时默认行为逐字节不变、真实迁移需用户明确批准。

## 18. 实施状态（M3b-3 完成，2026-08-22）

状态：**M3b-3 全写路径接入已完成并通过测试**；memoryAnchorEnabled 默认 false 时全部旧 Markdown 写法逐字节不变（E2/E9 锁定）；真实 Markdown 未迁移（M3b-4 需用户明确批准）。

| 条目 | 状态 |
| --- | --- |
| DEFAULT_CONFIG.memoryAnchorEnabled=false + config POST 热切换 | 已交付 |
| appendText 分流（15 个调用点一次覆盖：log/note/user 工具、自动沉淀 LOG/NOTE/USER、maintain 归档说明、外部 import、GUI note） | 已交付 |
| writeFull 分流 §9 replace（note/user replace、maintain 压缩替换、external remove 清洗）+ **writeFullRaw**（CALENDAR.md ×3 显式绕过,契约 §2.11） | 已交付 |
| writeFullSingle + store.replaceSingle（单记录整篇替换）：reflection 一文件一记录(契约 §3 粒度),文本含保留 marker 语法即拒 | 已交付 |
| docStore lazy getter（仅开启时创建;sidecar 落盘 DSH_HOME/memory/index-pre/files） | 已交付 |
| smoke-test-m3b3-pre.mjs E1-E9（默认配置/关闭回归/开启 append+sidecar version=2/§9 replace/reflect/calendar 排除/maintain archive 保留原 ID/切换混合兼容/真实零污染) | exit 0 |
| 全量回归 10 项 | 全部 exit 0(7.5s) |

**意外收获——修复一个生产级既有 bug**：DATE_RE=/^\d{4}-\d{2}-\d{2}$/ 无捕获组,而 maintain 用 DATE_RE.exec(log.date) 取 m[1..3] → 恒 undefined → Invalid Date → **maintain 此前从来选不中任何旧日志**(恒返回"没有超过 N 天的日志")。修复为捕获组版本 /^(\\d{4})-(\\d{2})-(\\d{2})$/（唯一 exec 使用点在 maintain;test() 调用零影响）。E7 锁定:构造前天日志跑 maintain(1) → archive 移动保留原 marker ID、活跃日志移除。

**实现注记**：
1. reflection 走 writeFullSingle 单记录模式;note/user replace 保持 §9 多块语义(按 heading 块切分分配 ID)。
2. compact/maintain 的 removed IDs(sourceMemoryIds) 本阶段仅在返回值/审计输出,持久化格式留 M3b-4 与用户确认。
3. anchor 分流失败(conflict/duplicate 等)向上抛错由工具层返回错误信息(fail closed),不降级旧路径静默覆盖。
4. E7 曾被测试夹具缺 mem_ 前缀的非法 marker 触发 malformed fail closed —— 恰好反向验证了写入闸门防御有效。

下一步：**M3b-4 真实迁移与 Live Verification**（生成真实 dry-run 迁移计划与备份;用户查看 diff 并明确批准后分批迁移;验证重启重建/读写/回滚）。

## 19. 实施状态（M3b-4 真实迁移完成并 live，2026-08-22）

状态：**31 个真实记忆文件全部迁移完成并 live 验证通过**；memoryAnchorEnabled=true 已在线上开启；autoConsolidate 已恢复；备份保留可回滚。

| 条目 | 结果 |
| --- | --- |
| 正式迁移工具 tools/migrate-m3b4.mjs（--plan/--apply/--status 分阶段,digest precondition,ID 持久化复用） | 已交付 |
| migrationId=mig_20260822141900_0695b3:备份 34 文件(index-pre/backups/)、计划 32+ 份(plans/) | 已落盘 |
| 迁移覆盖:用户级 MEMORY.md(23 记录)+5 个工作区全部日志/笔记/反思(reflections 走 single-record 单记录粒度) | applied=31/31 |
| 竞态防护实战:personal_issue 今日日志 plan 后被写入 → stale-plan 正确拒绝 → 重规划后应用 | 防御验证通过 |
| 全局验证:真实记忆 .md 全部 parse clean、anchored=176、sidecar=31 份且 live 写入持续更新(version 递增/fresh=true) | 通过 |
| live 切换:config POST memoryAnchorEnabled=true;首条真实 log 走 anchor 事务追加成功(records=4,fresh) | 通过 |
| 内容卫生前置:项目笔记/日志的字面保留语法示例改写为豁免形式;sanitizeForWrite 新增 sanitizeReservedSyntax(字面 `<!- - memory:` 清洗为 `<!--memory:`),E2.5 回归锁定 | 通过 |

**迁移过程发现与处理**：
1. 自动沉淀活体污染:对话中的字面保留语法被沉淀进记忆 → 清理现有污染 + sanitizeReservedSyntax 引擎卫生(E2.5)+ 需重启生效。
2. 活体竞态:plan 后文件被写入 → stale-plan 拒绝(digest precondition 设计生效)→ 重规划再应用。
3. E9 断言演进:index-pre 由「测试不得创建」变为「M3b-4 正当产物」,零污染断言改为真实 config 字节不变 + 无测试工作区泄漏。

**回滚方案**:备份在 index-pre/backups/mig_20260822141900_0695b3/(原样字节);恢复 = 复制回原路径 + 关闭 memoryAnchorEnabled + 删除 sidecar 目录。

**M3 整体完成**。M3b-4 收尾时的下一步为 M4 Shadow Retrieval；当前 M4-0 已冻结，实施范围为 M4-1，见 docs/M4-CONTRACT.md。

## 20. compactLayer × anchor 兼容修复（F1 结构修复，2026-08-23，用户批准）

**根因**（详见当日诊断）：compactLayer 按 `## ` 切段对 marker 行零感知——记录的 marker 行被切给前一段落尾部（错位一行）；fallback 归档把携带外来 marker 的段经 appendText 写入归档文件 → 归档 EOF 出现悬挂 marker（实测 notes-archived.md orphan-anchor@L5）→ 后续归档 appendText 被 docStore fail closed 抛 `conflict:orphan-anchor` 冒泡为工具错误；主文件因 store.replace 候选预检从未变脏，表现为间歇失败假自愈。AI 压缩分支当时失败的诱因是 subagentModel 路由坏（opencode-go-free 无 deepseek-v4-flash）。

**修复（F1 记录级操作）**：index.js 新增 `compactAnchoredLayer(store,filePath,layer,today,paths)` 并在 compactLayer 入口分流——docStore 存在时走记录级：

1. 读盘 parseAnchors，status!=='clean' 即 fail closed 不压缩。
2. 今天（标题日期=插件今天）记录无条件保留；其余按字节配额从最新往回保留（user 4000/note 3000）。
3. 被移除记录**整条原文**（marker+标题+正文）写入归档文件，归档经 writeFullRaw 绕开 anchor 事务（归档非检索语料，不再产生 marker 污染）。
4. 重组=有序块字节拷贝（legacy/preamble/tail 与 gap 原样保留），经 store.replace 原子执行：候选预检→被移除 id 自动删除→保留 id/版本不变、sidecar FRESH。**永不字符切片**。
5. 目标文件无 sidecar 时返回 'not-anchored' 回退旧文本路径（anchor 关闭行为逐字节不变，G4 锁定）。

测试 smoke-test-f1-pre.mjs G1-G4 共 **20 断言 exit 0**：超预算触发压缩/今天记录无条件保留/最旧两条整条移除且归档逐字节包含（marker+日期标题+正文）/归档不含今天记录/主文件 clean+sidecar FRESH+保留 id 稳定+被移除 id 删除/腾位后继续写入成功/无 BOM/anchor 关闭旧路径回归。全量回归 **20 项** 23.3s 全部 exit 0。d §20。

