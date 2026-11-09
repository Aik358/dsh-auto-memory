# 【任务】index.json 增量存储 · 生产接线（把已验收原型接入引擎）

你是实施 Agent。本任务是**生产代码改造**，不同于前几轮的只读调研。

工作目录：`D:/dsh-auto-memory`

---

# 一、起点：已完成的东西（不要重做）

## 1.1 原型已入库且已验收（commit `6639613d`）

位置：`prototypes/sidecar-store/`


**Lead 已独立复跑验证（不是采信报告自述）**：

```
node prototypes/sidecar-store/tests/run-contracts.mjs
  # tests 27 / # pass 27 / # fail 0 / # skipped 0 / EXIT=0
  （含真实 SIGKILL 恢复：appendAfterWrite / compactBeforeManifest / compactAfterManifest；
    含双进程并发 + 同版本竞争）

node prototypes/sidecar-store/examples/fixture.mjs   # EXIT=0
```

**实测性能**（`artifacts/_index-gov-20261109/out/prototype-fixture.json`）：

| 项 | 数值 |
|---|---|
| 单事务追加 | **33,568 B** × 7 次采样全部一致 |
| 原索引 | 7,382,763 B ⇒ **降 220 倍** |
| 中位写入 | **13.83 ms**（含共享锁+校验+fsync+内存发布）|
| 无变化追加 | **0 B**，seq 不变 |
| checkpoint 写期间变动 | `false`（`checkpointUntouchedDuringWrites:true`）|
| checkpoint 含 by_tag/by_cue | **否**（`indexMapsAbsentFromCheckpoint:true`）|
| 压实 | 216 ms / checkpoint 5,658,779 B |
| **SHA256 等价** | 真实 2,848 条样本导入后兼容导出，与原文件**逐字节一致** |
| | `76ac012a1ba5af429d5699109043de33ca3bb6bbb0757b0a2968ccfbdd06e719` |

## 1.2 架构调查报告：`docs/internal/ARCH-INDEX-JSON-20261109.md`（391 行）

必读。里面有关键结论：

1. **全量重建源于早期小规模假设与构造器复用，不是一致性的必然要求**
2. **原子 rename 只防半截 JSON，不防读改写丢更新**——沙盒实测双写者 **20/20 轮丢更新**，加共享锁后 **0/20**
   ⇒ **共享锁是必需，不是保险**
3. `by_tag` / `by_cue` / `versions` **均有消费者**（不能删，只能改持久化方式）
4. `sourceRevisions` 596 键中**仅 PLAN 键**被语义消费
5. **M1/archivedIds 来源是 Markdown 解析，不依赖 index 字段** ⇒ 治理 index 不动 M1
6. 当前索引来自 **PLAN + 687 份账本，未含 329 份归档**（默认重建未传 `includeArchive`，与部分注释不一致）

⚠ 该报告还纠正了 Lead 上一份 prompt 的错误（**已复核成立**）：
Lead 把 UTF-16 字符长度当成了 UTF-8 字节数。真实字节：
  `entries` = **5,559,319 B（占文件 75.3%）**，不是 3,853,434 / 52.2%。
  `by_cue` = 679,619 B / 9.2%；`by_tag` = 178,623 B / 2.4%；`sourceRevisions` = 61,968 B / 0.8%。
  **算体积一律用 `Buffer.byteLength(x,'utf8')` 或 `fs.statSync().size`，不要用 `.length`。**

## 1.3 原型的 API（已定型，可直接用）

```
SidecarStore.open({ directory, workspaceKey, ... })
  replaceSource(change, options) / replaceSources(changes, options) / removeSources(sources, options)
  getEntry(id) / findByTag(tag) / findByCue(cue) / listSource(source) / getSourceRevision(source)
  loadView() / readSnapshot() / rebuild(snapshot,{expectedState,...})
  importLegacy(snapshot) / exportLegacySnapshot() / compact() / getStatus() / close()

MarkdownSidecarAdapter: indexDocument / indexDocuments / rebuild / importLegacyFile
```

三条关键协议（务必遵守）：
- **一次事务可替换一个或多个 source**；每个 source 的 entries 是该文档**全部新条目**
- 同 ID 更新**保留原位置**，新 ID 追加；倒排顺序保持现有构造器口径
- `indexDocument` **只更新派生索引，不保存 Markdown 正文**

---

# 二、要接线的五个存储门（Lead 已定位到当前行号，仅供参考，以实际为准）

| # | 门 | 当前位置 | 现状 |
|---|---|---|---|
| 1 | `writeSidecarEntryPre` | `lib/index.js:5439` | 读整份 index → 改内存 → 交 2 |
| 2 | `_writeSidecarIndexPre` | `lib/index.js:5473` | `JSON.stringify` 整份 + 原子写 |
| 3 | `rebuildSidecarIndexPre` | `lib/index.js:5515` | 从 Markdown 全量重建后整份写 |
| 4 | `_loadSidecarIndexPre` | `lib/index.js:5557` | `JSON.parse` 整份 + revision 校验，失败则调 3 |
| 5 | `handoffPanelData` 的 `?file=index.json` 旁路 | `lib/index.js:8797` | 直接把 index.json 原文吐给面板 |

**顺序要求**：按 1→2→3→4→5 逐个替换，**每接一个门就要能独立回滚**。
不要「一把全换」，否则出问题时无法定位是哪一层的语义变了。

---

# 三、必须保住的不变量（违反即事故）


## 3.1 已有语义，一个都不能丢

- **正文写口不变**：`writePlanSnapshot` 的归档 / CAS / M1 / 用户区保护语义
- **CAS**：现有 `expectedRevision` 语义（`plan-store.js:247`）；原型侧有独立的 `expectedState`，
  **两者不要混用**，接线层负责把前者翻译成后者或反之，并写清映射关系
- **M1 保护门**：`checkMutationPre` 与 `archivedIds`（来源是 `parseWhiteboardPre().cardIds`，**不是** `planCardsPre().id`）
- **用户区保护**：`<!-- user -->` 段不得被覆盖

## 3.2 历史事故（必须防住）

> `index.js:5485-5492` 注释：旧实现裸 `writeFile(index.json)`，写入非原子，
> 面板恰在此时读 ⇒ 拿到半截 JSON ⇒ `JSON.parse` 失败 ⇒ **看板/白板整块空白**
> （用户实测：「白板不见了 → 过了一会儿又出现了」）

⇒ 读侧必须**永远**能拿到一致快照。原型的 journal + checkpoint 设计已解决，但接线时不能绕过它。

## 3.3 生命周期

- 把 store 纳入配置切根的 **admission / drain / invalidate** 生命周期
- **正文已提交但 sidecar 失败时，必须显式报告 stale**，不得静默
- **Markdown 被外部编辑后的新鲜度检测**要明确
- **迁移切换时须排除旧版本写者**

---

# 四、分期要求（每期独立可验收、可回滚）


## S1 · 接入但不切换（双写）

- 接 `writeSidecarEntryPre`：旧 JSON 照写，**同时**写新 store
- 加开关 `sidecarStoreMode`，取值 `'legacy' | 'shadow' | 'store'`，**默认 'legacy'**
- `'shadow'` 模式下读仍走旧 JSON，新 store 只写不读
- **验收**：跑一段时间后比对两边 `exportLegacySnapshot()` 与旧 JSON 的 SHA256 是否一致
  （原型已验证这个比对方法可行；见 `examples/fixture.mjs:16,25`）

## S2 · 读切换

- 开关切到 `'store'`，读走新 store
- **旧 JSON 降级为兼容导出**（`exportLegacySnapshot()`），**不要每次事务又全量写旧 JSON**
- 第 5 个门（面板 `?file=index.json` 旁路）改为返回最新兼容导出，而不是读磁盘旧文件

## S3 · 其余三个门

- `rebuildSidecarIndexPre` / `_loadSidecarIndexPre` 改走 store
- 存量用户迁移：写 `importLegacy` 的一次性迁移路径 + 失败回滚

## S4 · 清理

- 压实策略（原型目前**没有自动压实**与旧代/orphan GC）
- 旧代码路径删除与文档同步

---

# 五、硬纪律（违反即返工）


1. **先备份再动手**：`lib/index.js` 2.1 MB / 29,263 行，改前先 `Copy-Item lib/index.js lib/index.js.bak-<ts>`
2. **>500 行文件禁止整文件 write 覆盖**，只用定点 edit（内容锚定替换）；
   确需重写必须先 read 完整文件再写，且写后断言行数差 = 预期增量
3. **三元组基线**：改前记 `(行数, 字节数, 导出符号数)`，收工时导出数必须等于基线（除非明确增删，须说明）
4. **CRLF 守恒**：`lib/index.js` 全 CRLF（29,262 = 行数−1），改完必须仍是纯 CRLF，不得混入裸 LF
5. **真执行验收**：新模块必须真 import→真构造→真调用→断言返回值；
   禁止以「源码含某字符串」充当功能验收
6. **每条验收带负路径**，且必须有区分力（构造「旧实现非 null / 新实现 null」的输入）
7. **变异验证**：删掉关键判据，断言必须变红；还原后必须复绿。变异副本放**被检模块同目录**，不要就地改生产文件
8. **物理量**：每步给可复算数字（字节 / sha / PASS 数），不接受「应该更快」
9. **不许动 2.5**：本任务只治理 index.json。原自动重绘方案的 expectedRevision / no-change 判断 /
   M1 归档语义 / memory_log 覆盖，是**另一条独立工作线**，见 §七

---

# 六、本机坑（已踩过，别再踩）


- `os.tmpdir()` 在本环境返回 `undefined\temp`（相对路径陷阱）⇒ 临时文件放工作区内
- Windows 上写 `lib/index.js` 可能撞 `UNKNOWN: unknown error, open`（宿主占用）⇒ 重试；
  **每次写后必须复核「去掉插入块后与 HEAD 逐字节相等」**
- 用 `split` 校验锚点会误判「已写入」为「锚点异常」（旧锚点被替换后自然消失）——报错不等于失败，须回头核文件实际状态
- `--impact-run` 在本工作树**不可用**：把未跟踪的 `tools/_run-smoke-mut536-*.mjs` 当受管改动 ⇒ 依赖边 0 套件 ⇒ exit=2。改用显式套件清单
- 改完**必须请用户重启宿主**再真机验证（宿主内存里是旧模块）；不重启测的是旧代码

---

# 七、明确不在本任务范围（做之前先问）


- **2.5 第二步（白板自动重绘）**：即使 index 治理完成，原方案仍有四处未修——
  `expectedRevision:{}` 恒撞 CAS、最终锚定正文的 no-change 判断恒不成立、
  M1 归档语义需 `archiveIds=parseWhiteboardPre().cardIds`、memory_log 根本不经那四个写分支。
  **治理完成 ≠ 可以开 2.5。**
- 批次 2.3（语义引擎）与 2.4（存量归并）
- 前端/看板 UI

---

# 八、交付物


1. 生产代码改动（按 S1→S4 分期，每期一个 commit，可独立回滚）
2. 每期的实测报告：改了什么 / 物理量 / 验收命令与输出 / 负路径与变异验证结果
3. 一份 `docs/internal/WIRING-INDEX-STORE-20261109.md`：记录五门替换顺序、开关语义、
   迁移与回滚步骤、以及「哪些旧行为被有意改变」
4. 诚实清单：哪些验证过、哪些没验证（尤其 Electron 运行时、真实掉电、生产迁移回滚）

---

# 九、一句话目标


> **把 `index.json` 从「每次改一份 PLAN 就整份重写 7.38 MB」变成「增量追加 ~33 KB」，
> 且读侧永远拿到一致快照、CAS/M1/用户区/归档语义一个不丢、每一步可独立回滚。**