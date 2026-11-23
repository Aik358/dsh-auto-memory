# SidecarStore 原型与系统接入说明

本文解释当前 prototype 的设计、数据流和 2.3 模型接入后的生产边界。它是架构说明，不是直接执行任务书；执行步骤见 `HANDOFF-SIDECAR-PRODUCTION-WIRING-POST-23-20261112.md`。

## 1. 为什么需要这个原型

当前 `handoff/index.json` 同时保存 entries、by_tag、by_cue、versions 和 sourceRevisions。一个 source 变化时，生产代码会读整份 JSON，修改少数 entries，再重建派生索引并整份原子写回。

实测固定工作区：2,848 entries，旧文件 **7,382,763 B**。原子 rename 解决了“读到半截 JSON”，但没有解决多个写者读同一基线后互相覆盖的问题。调查中强制交错双写者，20/20 轮均能复现丢更新，且双方都返回成功。

原型把问题拆成四层：

```text
Markdown 真源 / 生产写入口
             │
             ▼
MarkdownSidecarAdapter   文档解析、source revision、entry 派生
             │
             ▼
SidecarStore             API、CAS、幂等、状态发布、兼容视图
             │
       ┌─────┴─────┐
       ▼           ▼
IndexState     JournalStorage
内存 entries   checkpoint + JSONL + shared lock + 恢复/压实
倒排/版本      codec checksum/schema
```

生产业务只接 `SidecarStore` 的 API，不处理 JSONL、manifest、checkpoint、锁文件或倒排 Map。

## 2. 原型模块职责

### `IndexState`

纯内存、零文件 IO。维护：

- `entries: Map<id, entry>`
- `source -> entry ids`
- `byTag: Map<tag, Set<id>>`
- `byCue: Map<cue, Set<id>>`
- `versions`
- `sourceRevisions`
- source parser versions、generation seq 对应的状态

source 替换先做完整预检，再摘除旧 source 的 posting，加入新 entries。已有 id 保留原顺序，新 id 追加；不允许把已有 id 迁移到另一 source。未知 entry 字段保留。

`loadView()` 才构造旧消费者需要的八字段对象：

```text
version
ws
rebuilt_at
entries
by_tag
by_cue
versions
sourceRevisions
```

checkpoint 只保存基础 entries、versions、source revisions 和 parser metadata，不保存 by_tag/by_cue；恢复时重新构建内存倒排。

### `SidecarStore`

这是业务 API 边界：

```text
open({ directory, workspaceKey, durable, parserVersion, ... })
replaceSource(change, options)
replaceSources(changes, options)
removeSources(sources, options)
loadView()
readSnapshot()
getEntry / findByTag / findByCue / listSource
getSourceRevision(source)
importLegacy(snapshot)
rebuild(snapshot, { expectedState })
exportLegacySnapshot()
compact()
getStatus()
close()
```

关键输入：

```js
{
  source: 'handoff/PLAN.md',
  sourceRevision: 'opaque-source-revision',
  expectedRevision: null, // 缺省=不做 CAS；null=必须不存在；字符串=必须相等
  entries: [/* 该 source 的全部新 entries */],
  parserVersion: 'wb-parser-v1'
}
```

关键语义：

- 同 source、同 revision、同 parser version、同 entries：no-op，0 B 追加。
- stale revision：`INDEX_REVISION_CONFLICT`，不部分提交。
- 同 ID 跨 source：`INDEX_ENTRY_CONFLICT`。
- 同 operationId 同输入：在保留窗口内返回 `alreadyApplied`。
- 同 operationId 不同输入：`INDEX_OPERATION_CONFLICT`。
- source 删除保留 tombstone revision，防旧写复活。
- 输入在入队时复制校验，调用方之后修改原对象不会污染事务。

`replaceSource/replaceSources` 是 source 全量替换，不是单条 entry delta；生产调用必须传该完整 Markdown source 的全部 entries。同一 source 在一个事务中只能出现一次。Adapter 的 title、ts、kind、mtime、criteria、status 需要先归一化再进入 parser identity，否则省略默认值与显式默认值可能产生相同 entries 却额外追加一次日志。

### `MarkdownSidecarAdapter`

复用当前 `wb-sidecar.js`、`plan-store.js` 的确定性逻辑：

- PLAN 使用 `planRevisionPre` 的 canonical revision。
- 其他文档使用正文摘要，并把标题、时间、kind、mtime、criteria、status 等派生输入指纹化到 parser version。
- `indexDocument()` 只写派生索引，不写 Markdown 正文。
- `rebuild(documents)` 是显式全量操作，必须用 `readSnapshot()` 得到的 generation/seq 做全局 CAS。

### `JournalStorage`

磁盘布局：

```text
manifest.json
checkpoint-<generation>.json
journal-<generation>.jsonl
manifest.json.lock
manifest.json.lock.acquire
```

每条 journal 记录包含 schema、generation、seq、operationId、requestHash、parserVersion、rebuiltAt、changes、checksum。

读写协议：

1. 对 canonical manifest 取仓内 `shared-state-lock`。
2. 读 manifest、checkpoint 和已消费 offset 之后的 journal suffix。
3. 校验 checksum、workspace、generation、连续 seq。
4. 只有没有终止换行的尾部残片可以在锁内截断；中段坏行和 seq 缺口拒绝。
5. 完整事务写入 journal，按配置 `sync()`，再发布内存状态。
6. 失败后清理内存 cursor，下一次调用从已提交 checkpoint/log 恢复。

压实目前是简单安全版本：全程持锁，生成包含最新 seq=N 的新 checkpoint，创建空 journal，最后原子替换 manifest；下一条事务使用 N+1。旧代保留，不做 GC。

## 3. 旧格式兼容与迁移

旧 `index.json` 不是新 store 的常态写目标，只是迁移输入和兼容导出。

迁移顺序：

1. 在旧 writer 已停止或明确 quiesce 后读取旧 JSON。
2. 校验 workspace、schema、entry id、source、字段类型和派生一致性。
3. 导入新 checkpoint，保留原 `sourceRevisions`、versions 和未知 entry 字段。
4. 用新 API 导出一次兼容 JSON，与原文件做 SHA/八字段/顺序对照。
5. 原旧文件保留为回滚证据；正常事务不再更新它。
6. `?file=index.json` 改为返回最新 `exportLegacySnapshot()`，不再直接读旧物理文件。

legacy `sourceRevisions` 可能缺键或为空字符串。空 revision 不能直接作为新 `SourceChange.sourceRevision`；迁移层必须生成新 revision，或明确拒绝 rebuild。`versions` 是兼容 opaque metadata，不应直接当文件路径使用。旧 legacy 文件导入入口还必须限制为批准的 regular file，不能把任意用户路径直接透传给 `importLegacyFile`。

回滚不能只恢复迁移前的 7 MB 备份，因为新版本运行后可能已经有新 source 事务。正确流程是：停止新 writer → 在同一锁内追完日志 → 从最新 store 导出 v1 → 校验 Markdown source revision → 原子写回旧格式 → 再启动旧版本。

新格式损坏不能自动创建空库。必须保留坏代证据，按明确 source 范围从 Markdown 重建，或停止并报告需要人工恢复。

## 4. 生产接入边界

当前生产接入点集中在 `lib/index.js`：

| 接入点 | 原职责 | 接入后的职责 |
|---|---|---|
| `writeSidecarEntryPre` | 读改写 index.json | 委托 source transaction |
| `_writeSidecarIndexPre` | 全量派生 + atomic JSON | 兼容 facade，不再整份持久化 |
| `rebuildSidecarIndexPre` | Markdown 全量恢复 | 只做显式恢复/迁移/损坏修复 |
| `_loadSidecarIndexPre` | 读 JSON、PLAN revision 检查 | 从 store 取得八字段 view |
| `handoffPanelData(?file=index.json)` | 原文直读旁路 | 返回最新兼容导出 |

store service 应按 canonical projectDir 缓存，配置根切换时显式 close/invalidate/reopen。它必须接入已有 `_settingsMigrationActive`、mutation admission 和 drain；不能因为 store 使用 manifest 路径，就假定自动继承 PLAN.md 的 admission scope。

配置迁移期间：

- 已受理写可以完成并被 drain。
- 窗口开启后的新 sidecar 写必须拒绝或明确延迟。
- 不要在 sidecar 写路径里拿 config lock，避免与 `saveConfig` drain 互等。
- dispose 必须等待已有 store 操作，不得留下未处理 Promise rejection。

## 5. 与 2.3 模型接入的关系

2.3 模型负责事件候选、语义分数和提案；SidecarStore 负责白板派生索引。两者不共享持久化格式，也不互相替代。Prototype 的存储/CAS/锁逻辑本身不调用2.3模型；依赖2.3冻结的是候选/文档语义、身份与profile接口，而不是等待训练后才能测试存储。

2.3 接入完成后，必须把以下 profile 元数据纳入 embedding identity 和向量缓存分区：

```text
model / weight identity
dimension
dtype
pooling
query prefix / passage prefix
input representation version
tokenizer/model path
```

事件候选可使用 `goal + state`、缺失时回退 `checkpoint.text` 作待验证表示，但**真实归属以 `ATTR-REALISTIC-20261110.md` 为准**。630 真实查询复测为 C2 top-1=21.7%、top-5=57.1%，早期 63 精选查询上的 fields 增益已证伪；不能据下表判断当前生产能力。新归属基准见 `PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`。

下列数字只保留为旧实验过程，不能作为当前归属性能：

| 组合 | top-1 | ARI |
|---|---:|---:|
| C2 + fields | 47.6% | 0.409 |
| C3 + fields | 50.8% | 0.443 |
| 任务门槛 | 70% | 0.60 |

因此 2.3 生产结果只能进入候选/提案接口；2.4 `event-regroup-apply` 仍保持显式确认，不自动归档 active 事件，不自动把相同文本当作同一事件。

## 6. 风险和接入时的判断

| 风险 | 原型状态 | 生产接入要求 |
|---|---|---|
| 多进程丢更新 | 原型 27 项测试覆盖 | 用真实生产 writer/reader 再测一次 |
| 半截日志 | 只允许尾残片恢复 | 不放宽为“跳过任意坏行” |
| 外部 Markdown 修改 | PLAN revision 有守卫 | ledger source 也要明确 stale 策略 |
| 配置根迁移 | 原型未接 production admission | 接入 `_saveConfigChecked` drain/拒新写 |
| 旧格式兼容 | fixture SHA 完全一致 | 旧测试改为行为断言，保留导出能力 |
| Electron | 未测 | 在真实宿主跑 targeted smoke |
| 掉电 | 未测 | 不在发布说明里承诺 |
| 压实代文件 | 旧代保留、无 GC | 先明确保留上限和清理策略 |
| 2.3 自动归属 | 明确不支持 | 只返回候选/提案 |

原型尚有接入前补测项：同 operationId 在 `appendAfterWrite` 强杀后的重试、operation history 淘汰、缺失或 symlink 数据文件、orphan generation、锁超时、`durable:false`、读/写/压实并发，以及热 reader 前缀篡改后的冷重开检测。这些不是已知的生产缺陷结论，而是原型测试没有覆盖的边界。

JournalStorage 的恢复读会用 `r+` 打开 journal，因为它可能在独占锁内截掉残尾；生产运行账户必须有该目录的写权限。`durable:true` 只同步文件，不代表父目录刷盘或真实掉电安全。

解析器 fail-soft 返回空 entries 时，生产 adapter 不能把它当合法空文档 tombstone；应保留旧索引并标记 stale。checkpoint 中未知 `view.version`、shared-lock timeout、排队 close、启动恢复尾部观测也要在 service 层定义明确策略。Journal 不自动 compact 或 GC，必须配置阈值和旧代清理。

## 7. 完成判据

完整系统接线完成前，必须同时满足：

- 2.3 profile/API/identity 已冻结。
- SidecarStore 五个生产接入门已收口，业务不再直接读写旧 JSON。
- 正常 source 更新不产生整份兼容 JSON 写盘。
- 旧数据可导入、导出、恢复和回滚。
- 多进程、CAS、幂等、迁移窗口、dispose、外部 source 修改都有行为测试。
- 八字段视图、entry 顺序、倒排顺序和 versions 兼容。
- 2.3 仍保持候选/提案，2.4 自动 apply 未启用。
- 报告清楚列出实测、推理、未测边界和回滚路径。

## 7A. 独立评审追加的接入阻断（2026-11-13）

`REVIEW-SIDECARSTORE-PROTOTYPE-20261113.md` 已通过源码与隔离 API 验证：非空旧 versions 增量丢失、公开 `parserVersion` 在类型声明与运行时两侧均缺、迁移缺批准根/regular-file 边界、共享锁超时未映射公开错误。以上均是接入前阻断项，不是现网已损坏证明。

B1–B4的隔离修复已由 `RESULT-SIDECARSTORE-BLOCKERS-20261113.md` 和Lead复跑确认：37/37、0 skipped、6 CAUGHT/0 MISSED；非空versions使用synthetic fixture。真实fixture仍为versions=0；生产facade、R4文档、`events.jsonl` 审计、迁移/回滚及HOST验收仍须单独完成，不能据此宣称可生产接入。

## 8. 当前已知事实

- 原型测试：**27/27 通过**。
- 固定真实样本：2,848 entries；旧索引 SHA-256：`76ac012a1ba5af429d5699109043de33ca3bb6bbb0757b0a2968ccfbdd06e719`。
- 最新 fixture 运行：PLAN source 事务 `33,568 B`，中位 `13.8257 ms`，checkpoint 约 `5,658,779 B`。
- 正常写不改 checkpoint/manifest；无变化写入 0 B。
- 这些数字来自 Node/Windows 原型沙盒，不代表 Electron、真实掉电或完整生产写入链。
