# 03 · 共享记忆库与双宿主共存设计（DSH × ZCode）

> 研究线 C 交付物｜任务板 `task-3`｜作者：coexist-store｜日期：2026-10-22
>
> **口径**：本文第一阶段为**只读取证**，未修改任何代码/配置/测试，未运行构建与回归。下文所有行号基于工作树 `D:\dsh-auto-memory`（HEAD `4464474`，工作区有 21 个未提交文件，行号以当前工作树文本为准）。凡未独立核验的内容一律标注「**待验证**」或「**推断**」，不写空承诺。
>
> **范围**：`lib/datadir.js`、`lib/dsh-home.js`、三套锁、`memory-writer`、`memory-mutation-transaction`、索引/引擎指纹四件套、`lib/index.js` 的自动行为与配置事务；以及 ZCode 侧共存所需的目录映射、锁协议、单写者租约、幂等去重、索引共享、配置分层、风险矩阵与验收用例。

---

## 0. 一页结论（先看这个）

1. **路径同一性是共存的一号风险，且已被实测证据坐实**：DSH 的文档锁实际落在 `<文档>.lock.lock`（不是注释里写的 `.lock`），因为 `lib/memory-writer.js:478` 传入了 `filePath + '.lock'`，而 `lib/shared-state-lock.js:173/94` 会在传入路径后**再拼一次** `.lock`。任何「照文档实现 `.lock`」的 ZCode 侧实现**都不会与 DSH 互斥**。
2. **锁算法本身可直接复用**：`shared-state-lock` / `config-lock` / `calendar-lock` 是同一算法（`wx` 认领 + owner `{pid,host}` + `ESRCH` 判死 + `ino/dev` 复核 + `.acquire` 门 + 30s 宽限回收），跨语言逐字复刻即可互斥，前提是**锁文件路径逐字节相同**。
3. **存在明确的「无保护」写路径**：`writeFullRaw` 对非 CALENDAR 文件是裸 `writeFile`（`lib/index.js:8923`）、心跳文件是读-合并-写且**不取任何锁**（`lib/index.js:21054-21074`）、`recall-stats.json` 用固定名 `.tmp`（`lib/recall-stats.js:123`）、`workspaces-summary.json` 同理。这些在双宿主下是最先出问题的一批。
4. **推荐形态**：**一个真源（沿用 `~/.dsh/memory`）+ 两个宿主视图 + 单写者租约（leader）+ 其余实例只读/代理降级**。不引入中立根，不迁移存量。
5. **推荐降级**：**A 形态（leader 暴露本机 HTTP，客户端代理写）为主，B 形态（只读文件共享）为兜底**；判据见 §6.7。

> **证据等级约定**：本文每个结论都标注来源（文件:行号）。**源码直读**为「已核实」；**由源码行为推导但未实跑**为「推断」；**只来自二手信息**为「待验证」。§8 是完整的未验证清单，请勿把推断当结论引用。

---

## 1. 取证一：记忆根与 DSH_HOME 的解析与回落链

### 1.1 DSH_HOME（唯一口径）

`lib/dsh-home.js` 是**唯一**解析口径（文件头 1-46 行记录了历史上 7 处各自解析、口径互不相同的事故）。解析顺序（`resolveDshHomePre`，:86-105）：

| 序 | 来源 | 代码 |
|---|---|---|
| ① | 显式 override（测试注入 / engine 级配置） | :88-90 |
| ② | `process.env.DSH_HOME`（trim 后非空） | :92-94 |
| ③ | `os.homedir() + '/.dsh'` | :97-101（`homeBasePre` :64-78 先 homedir） |
| ④ | `USERPROFILE || HOME` + `/.dsh`（仅当 homedir 抛错） | :73-76 |
| ⑤ | 全失败 ⇒ `'.dsh'`（相对路径，永不返回空串） | :104 |

另一入口 `resolveDshHomeForEnginePre(engine)`（:114-142）优先级为：`engine.__dshHomeOverride` > `DSH_HOME` > `engine.__homedirFn() + '/.dsh'` > 默认链。**注意 :116-121 的教训**：曾把 `__homedirFn` 提到 env 之前，导致用 `DSH_HOME` 注入的测试被真实 homedir 覆盖，证据写进真实用户目录。

**共存含义**：ZCode 侧必须复刻这条**完全相同的**回落链，并且**只读 `DSH_HOME`**（不要读 ZCode 自己的 `ZCODE_HOME`）。否则两个宿主会算出不同 `memory/` 根 —— 这是所有后续设计的前提。DSH 不缓存该值（:45 注释），因此运行期可被改；ZCode 侧同理不要缓存。

### 1.2 记忆子目录收口（`lib/datadir.js`）

`memoryDir(name, homeFn)`（:64-101）= `<home>/memory/<name>`，带一次 `<name>-pre` → `<name>` 的**逐文件增量补齐**迁移（:44-62），纪律三条（:13-16）：**不 move 只增量、fail toward duplication never loss、失败不登记缓存**（#312，:71-74/:94）。

调用点（`memoryDir()` 命名空间清单，实测 grep）：

| name | 落点 | 调用点 |
|---|---|---|
| `workspaces` | `~/.dsh/memory/workspaces` | `lib/index.js:3512/3724/6958/10947` |
| `index` | `~/.dsh/memory/index`（sidecar `files/`） | :7905/:8835/:16141/:16226/:16626；`activation-host.js:47`；`context-host.js:149`；`shadow-host.js:71` |
| `semantic` | `~/.dsh/memory/semantic` | :16036/:16244/:16412/:19809/:19897；`context-host.js:842` |
| `hub` | `~/.dsh/memory/hub` | :16044 |
| `evidence` | `~/.dsh/memory/evidence` | :9284/:19840；`context-host.js:195/202/872` |
| `degrade` | `~/.dsh/memory/degrade/latest.json` | :10437 |
| `retrieval` | `~/.dsh/memory/retrieval/audit` | `shadow-host.js:158` |

### 1.3 记忆根实际是「多根」，不是一个根

| 根 | 默认值 | 来源 | 覆盖方式 |
|---|---|---|---|
| 用户级根 | `~/.dsh/memory` | `DEFAULT_CONFIG.userMemoryDir`（`lib/index.js:563`） | 配置项 `userMemoryDir`（`userDirOf()` :3601-3603） |
| 工作区根 | `~/.dsh/memory/workspaces` | `DEFAULT_CONFIG.memoryRoot`（:567） | 配置项 `memoryRoot`；`projectDirOf` :3503-3516 |
| 工作区目录名 | `--<路径把 [\\/:*?"<>|] 换成 ->--` | `wsKey(ws)` :3497-3500 | 不可配置（#179 领地） |
| 项目目录名 | `.dsh-memory` | `DEFAULT_CONFIG.projectMemoryDir`（:565） | 配置项；**绝对路径时直接用它**（:3511） |
| 配置文件 | `<DSH_HOME>/dsh-auto-memory.json` | `this._configPath` :2370 | — |
| 会话/投影 | `<DSH_HOME>/sessions`、`<DSH_HOME>/storages` | :4724/:11453/:12769 | DSH 宿主私有 |

实测本机配置（`~/.dsh/dsh-auto-memory.json`）：`memoryRoot=~/.dsh/memory/workspaces`、`userMemoryDir=~/.dsh/memory`、`projectMemoryDir=.dsh-memory`，与出厂默认一致；`workspaces/` 下实测 **770 个**工作区目录（含大量测试残留如 `--C--Users-JHZ~1-AppData-Local-Temp-...--`）。

`resolvePaths(agent)`（:3605-3656）把上述根拼成 12 条具体路径（:3640-3654）：`ws / userDir / userFile / calendarPath / projectDir / notesPath / logPath / reflectDir / handoffDir / planPath / greetDir / greetPath`。工作区解析优先级：`session.header.cwd` > `sessionWorkspaceFallback(sid)`（registry 反查 → 持久化会话头 :3662-3691）> `state.ws || process.cwd()`。

**共存含义**：ZCode 侧要么复用 DSH 的 `resolvePaths` 结果（通过 HTTP 或共享进程），要么**逐字复刻 wsKey + 目录映射**。绝不能用 ZCode 原生的 `<slug>-<hash>` 目录名冒充（本机 ZCode 原生根实测为 `~/.zcode/cli/memories/projects/dsh-auto-memory-4412cd98b2e33c51/memory/`，含 `MEMORY.md` 与 40+ 篇主题 md）。**同一 workspace 若两宿主各用一套目录名 ⇒ 立刻分脑。**

### 1.4 路径同一性的三层风险（一号风险的具体形态）

| 层 | 风险 | 证据 | 后果 |
|---|---|---|---|
| ① 锁后缀 | DSH 文档锁实际是 `.lock.lock`；注释（`lib/memory-writer.js:453`「锁文件位置 = `<文档路径>.lock`」）与实现不符 | `:478` 传 `+'.lock'`；`shared-state-lock.js:173` 再 `+`.lock`；同理 `lib/index.js:8824`（`_withDocumentLockPre`） | ZCode 实现 `.lock` ⇒ **不互斥**，双写覆盖 |
| ② 大小写/别名 | `canonicalSharedStatePath`（:8-19）= realpath(最深存在祖先)+拼回缺失后缀，**不做小写归一**；POSIX 上两套拼写=两把锁 | :8-19 / :217-228 | Linux/macOS 上 `/A/B` 与 `/a/b` 可能分裂（Windows NTFS 默认不区分，风险低） |
| ③ 根漂移 | `DSH_HOME` 运行期可改、`memoryRoot/userMemoryDir` 可被设置页迁移（`saveConfig` 迁移窗口 :3402/:3423-3434） | 见 §5 | 迁移窗口内客户端仍写旧根 ⇒ 内容落在非活动根 |

---

## 2. 取证二：跨进程锁实现（逐字段）

### 2.1 `lib/shared-state-lock.js` —— 主原语（async + sync 两份，协议同形）

| 项 | 实现 | 行号 |
|---|---|---|
| canonical | `path.resolve` → 逐级 `realpath` 到最深存在祖先 → `path.join` 拼回缺失后缀 | async :8-19；sync :217-228 |
| 符号链接拒绝 | 对目标本身 `lstat().isSymbolicLink()` ⇒ 抛 `state-file-symlink refused` | :91；sync :164-168 |
| 锁文件 | `<canonical>.lock` | :94 / :173 |
| 门文件 | `<canonical>.lock.acquire` | :94 / :173 |
| 认领 | `openSync(file,'wx')` + 写 `{"pid":process.pid,"host":os.hostname()}`；写失败 close+unlink+throw | :85-89 / :231-235 |
| 死主判定 | 同主机 + 正整数 pid + `process.kill(pid,0)` 抛 `ESRCH` | :23-26 |
| 死锁回收 | 读 owner → 判死 → `statSync` 前后 `ino/dev` 一致 → unlink | :27-36 |
| 门回收 | ①元数据可解析且判死 ⇒ 立即回收；②不可解析 ⇒ 需超 `GATE_STALE_MS_PRE=30000`；stat 前后 ino/dev 复核 | :38-84 |
| 重试 | 失败后 `delay(20)`；刚回收门则立即重试 | :128 |
| 超时 | 默认 `timeoutMs=10000`，deadline 在**任何**重试之前判 | :90 / :126 |
| 同步版等待 | `Atomics.wait` 真睡眠（不烧 CPU），默认 `pollMs=20` | :162/:238-246 |
| 释放 | `closeSync(handle)` + `unlinkSync(lock)`；sync 版额外做幂等 `released` 标记 | :131 / :207-213 |
| **同进程重入** | **不支持**。同一进程对同一路径第二次取锁会 `EEXIST` → `removeDead` 判「活主」不删 → 自等至超时 | 无 owner 归属表 |

历史缺陷（写进设计约束的）：#341 门不可回收导致「锁可回收、门不可回收」，崩溃一次后写入被永久堵死（:41-66）；#306-fix 若在 job 前插入**异步**取锁会破坏 `_queue` 的「不同文件不全局串行化」契约，实测红 6/10（:139-158）。

### 2.2 `lib/config-lock.js` —— 配置事务边界

同算法（`wx` + owner + ESRCH + 门回收，直接复用 `reclaimDeadGate`，:7-12），差异：

- **支持同进程重入**：`AsyncLocalStorage` 承载 token 栈，`owned(file)` 命中 ⇒ 直接 `job()`（:108-118/:120-128）。
- **同步版绝不阻塞**：取不到锁抛 `CONFIG_LOCK_BUSY`（:126），由启动迁移延后处理。
- **异步版轮询 20ms 至 `timeoutMs=10000`**（:130-141）。
- 目录不可用 ⇒ **跳过加锁**把错误交回真实写盘路径（:96-106 的 B-1 偏差说明）。
- 提供**无锁读入口** `readConfigSnapshot`（:145-151），供迁移窗口内部读盘用（避免自死锁）。

### 2.3 `lib/calendar-lock.js` —— 薄壳

仅 7 行：`export { canonicalSharedStatePath as canonicalCalendarPath, withSharedStateLock as withCalendarLock }`（:7）。**日历锁 = 共享锁 = PLAN 锁**，同一个文件同一算法。调用点：`lib/index.js:3865`（PLAN，锁 `planPath`）、:9973（日历导入合并，锁目标文件）、:10176（迁移导入逐文件）、:10844（日历事务 `_calendarTransactionPre`）。

### 2.4 `lib/path-write-queue.js` —— 进程内，不是跨进程

52 行，纯进程内：按路径一条 promise 链（:24-27），落盘走 `writeTextAtomicPreSync`（:35）。文件头自己写明「不另起第三套语义重叠的锁」（:9-13）。

**实测重要事实**：`_pathWriteQueuePre()`（`lib/index.js:5489-5492`）**全仓零消费者** —— grep 只有定义与构造，没有 `.write(/`.run(` 调用。接续计数器实际走 `writeStateJson`（`continuation-state.js:64-83`，tmp+fsync+rename）+ `withSharedStateLock`（`allocContSeq` :5569-5585）。⇒ **该模块当前是死代码**（待验证：是否在其它分支/测试中被使用，测试确有 `smoke-test-audit-g-207.mjs:17` 直接 import 该工厂做单测）。设计上不应把它当作跨进程保护。

### 2.5 `lib/memory-writer.js` —— 文档事务（唯一真正的「记忆写」跨进程锁）

- 跨进程锁：`_withDocLock`（:460-489），**同步** `acquireSharedStateLockSync(String(filePath) + '.lock')`（:478）⇒ 实际锁文件 `<doc>.lock.lock`，门 `<doc>.lock.lock.acquire`。
- 覆盖范围：`_queue`（:524-594）把「admission → 别名钉定 → 跨进程锁 → `_readState` → 渲染 → `_commit` → 回读校验 → sidecar」整段纳入（:555-588）。
- 进程内队列键 = **物理父目录 canonical + 文件名**（`_queueKeyOf` :505-514，win32 小写），这是 #325 修的「别名两条队列并行 → 同步取锁阻塞事件循环等持锁者」自锁形态（:534-544）。
- 提交：`_commit`（:723-787）= BOM 拒绝 → backup → `atomicReplace`（tmp `wx` + fsync + 有界 rename 重试 :241-302）→ rename 前复核别名与 `expectedDigest` → 回读摘要校验 → sidecar（失败标 dirty 但不回滚正文）。`retryRename` 刻度为 `[0,50,150,400,1000]`、只重试 `EPERM/EACCES/EBUSY`（`lib/fs-retry.js:18-19`）。
- 失败形态：`fail-closed`（拿不到锁不写，返回 `lock-unavailable`，:479-487），recovery 快照 `.dam-failed-*.tmp`（:275-287）。
- **注意**：`_withDocLock` 的同步取锁在竞争时会 `Atomics.wait` 阻塞整个事件循环（:154-158 明确承认）。双宿主竞争加剧后，这条会成为**性能/假死**风险（推断）。

### 2.6 `lib/memory-mutation-transaction.js` —— admission 边界，不是互斥锁

它做三件事，全部是**同进程内**判定 + 一次**磁盘配置只读复核**：

1. 受理时刻捕获 `migrationActive` / 目标根（`captureMemoryMutationPre` :134-172）；
2. 窗口内新写抛 `SETTINGS_MIGRATION_ACTIVE`（409，:230-236/:245-276）；
3. 提交时两道根复核：内存 `engine.config`（`assertDurableRootUnchangedPre` :279-292）+ **磁盘配置**（`assertDurableDiskRootUnchangedPre` :309-334，专为 #345「另一进程 saveConfig 只改盘」而加）。

⇒ 它解决的是「根变了还谎报成功」，**不提供互斥**。双宿主下它能把「写进非活动根」变成显式 409，但**不能防止两宿主同时写同一个字**。

### 2.7 写路径保护矩阵（哪些有跨进程保护，哪些 LWW）

| 写路径 | 机制 | 跨进程？ | 结论 |
|---|---|---|---|
| 记忆文档 append/replace（anchor 档 `docStore`） | `_queue` + `<doc>.lock.lock` + `expectedDigest` | ✅ | 有保护（但锁后缀坑见 §1.4） |
| 记忆文档 raw 档（`memoryAnchorEnabled=false`，`rawDocStore`） | 同上 `replaceRaw/appendRaw`（:790-831） | ✅ | 有保护（本机实测 `memoryAnchorEnabled=true`，走 anchor 档） |
| PLAN.md 重写 / 单卡编辑 | `withCalendarLock(planPath)` + `expectedRevision` CAS（`lib/index.js:3865` 起） | ✅（`.lock` 单后缀） | 有保护，但 revision 语义见 §3.3 |
| CALENDAR.md | `_calendarTransactionPre` → `withCalendarLock(calendarPath)`（:10840-10854），写走 `writeFullRaw` → `writeTextAtomicPre`（:8920-8922） | ✅ | 有保护 |
| 交接账本 / 反思 / 归档（`writeFullRaw` 非 CALENDAR 支） | **裸 `writeFile`**（:8923） | ❌ | **无保护**（LWW + 无原子性） |
| 今日日志 append | `appendText` → `docStore.append` / `rawDocStore.appendRaw` | ✅ | 有保护 |
| 用户级 `MEMORY.md` 条目级增删改 | `rules-edit` 经 `writeFull` + `expectedDigest`（:9045 一带） | ✅ | 有保护 |
| `hub/facts.json` | `withConfigLockSync` 内「重读→决策→提交」（`hub-io.js:174-188/:200`） | ✅ | 有保护（事务门） |
| `hub/procedures.json`（双库） | `withConfigLockSync` 按排序路径逐库取锁 + 基线差分 + 冲突拒绝 `DAM-PROCEDURE-CONFLICT`（`hub-io.js:323-365`） | ✅ | 有保护（非 LWW） |
| `hub/episodes.json` | `atomicWrite` 但**不取锁**（`hub-io.js:193-206` 只对 facts 加锁） | ❌ | **LWW** |
| `recall-stats.json` | 固定名 `<file>.tmp` + rename（`recall-stats.js:117-132`），无锁 | ❌ | **LWW + 固定 tmp 名并发互踩** |
| `workspaces-summary.json` | `writeTextAtomicPre`（:10193），无锁 | ❌ | LWW（有原子性） |
| `polling-heartbeat.json` | `readFile` → 合并 → **裸 `writeFile`**（:21054/:21064），无锁 | ❌ | **LWW（会互相抹掉 instances）** |
| `workbench.json` | `writeTextAtomicPre`（:11635），无锁；但写入带 `host` 身份 | ⚠️ | 原子但 LWW；靠 host-conflict 语义兜 |
| `cont-seq.json` / `auto-continue-done.d/*` | `withSharedStateLock` + `writeStateJson`（:5569-5585；`continuation-state.js:133-180`） | ✅ | 有保护 |
| `team/outbox.json` | 同步共享路径锁 + 锁内重读合并（`team-outbox.js:139-161/:446-451`） | ✅ | 有保护（fail-closed #342） |
| `team/pull-cursor.json` | `writeTextAtomicPreSync`（:15854），**不取锁** | ❌ | LWW |
| `semantic/*.jsonl`（Python worker） | worker 侧 tmp+rename 保尾截断（`python/worker_semantic_v1.py:495-516/:826-847`） | ⚠️ | 单写者（worker）才有意义；双 worker ⇒ 互相截断 |
| `degrade/latest.json` | `persistDegradeLedgerPre`（:10437-10439） | ❌ | LWW |
| 配置文件 `dsh-auto-memory.json` | `withConfigLock` + 串行链 + 迁移窗口 + 原子写（:3340-3352/:3450） | ✅ | 有保护 |

---

## 3. 取证三：索引、缓存、引擎指纹

### 3.1 `lib/index-sync.js` —— 索引同步**协议层**（无状态）

- 单页预算 `{maxRecordsPerPage:64, maxPageBytes:252KiB}`（:31），留 4KiB 余量给 256KiB 帧上限（:19-30 记录了一次「builder 接受、线上必超限」的死锁事故）。
- `buildIndexSyncPlansPre`（:69-144）：按 `scope`（`Workspace`→`User` 固定序）分组；`syncId` 由 `(workspaceRef, scope, memoryIndexVersion, recordCount)` **确定性派生**（`m7-wire.js` 的 `buildSyncIdPre`）；page/final digest 均为 sha256 canonical。
- **它是纯函数 + 无落盘**；跨宿主能否安全重建：**能**，因为 syncId 确定性、重复同步幂等（`m7-index-sync-host.js:11`「每个 (wsRef,scope,miv,epoch) 最多成功同步一次」）。但**并发同步会把两套 vectors 交错写入同一 worker**（推断：worker 侧未做并发保护，见 §3.4）。

### 3.2 `lib/l0-index-sync.js` + `lib/l0-index.js` —— L0 索引

- 文件名：`l0-index-<workspaceKey 短哈希 12 hex>-<layer>.json`（:56-60），按层各一份（:9-24 解释了为何不能合并）。
- 目录：`<dshHome>/memory/semantic/l0`（`lib/index.js:16412`）。
- **引擎身份门**（`lib/l0-index.js:87-115`）：文件里的 `engineIdentity` 与当前不一致 ⇒ 整文件 `engine-mismatch`、`entries:[]` ⇒ 调用方走**全量重建**；旧文件无该字段 ⇒ 按当前引擎接受（兼容）。
- 增量：两层引用（同 id 同 hash / 跨 id 同 hash），`embedded` 统计真实送进 embedder 的条数（:140-190）。
- **重要现状**：`l0IndexSyncTick = () => ({ ok:false, reason:'no-recall-consumer' })`（`lib/index.js:16439-16441`）—— 持久 L0 向量**当前无召回消费者**，只在显式诊断 `syncL0IndexPre` 时写盘。⇒ 双宿主争 L0 索引的**实际风险低**（但一旦启用召回就上升）。

### 3.3 `lib/l0-index-sync.js` 之外的 sidecar 缓存与 revision

- sidecar 路径：`<sidecarDir>/<sha256(canonicalSourcePath)>.json`（`lib/memory-writer.js:664-670`）；canonical = resolve + 正斜杠 + 小写（`canonicalSourcePath`，`lib/file-boundary.js:59`）。
- sidecar 内容：`sourceVersion`（digest 变则 +1）、`sourceEpoch`（无 prev 时新 UUID）、per-record 的字节区间（`memory-anchor.js:253-295`）。
- **revision**：白板的 `revision` 是 `sha256(body)`（`lib/wb-sidecar.js:1189/:1221/:1367`）—— 内容哈希，不是单调版本号。⇒ 两宿主基于不同快照做「单卡编辑 + expectedRevision」时，后到者必然 CAS 失败（这是**好事**：fail-closed），但用户会连续看到冲突。
- **跨宿主安全重建 sidecar**：可以（sidecar 是派生数据，`_writeSidecar` 显式 `preserveOnFailure:false`，:676-679；`storage-manage` 有 `scanHealth`/`rebuildSidecar` 自愈）。但重建期间若另一宿主正在写正文，会拿到 stale digest ⇒ `dropped/stale` 分类（`m4-corpus.js:85-141`）。

### 3.4 `lib/jsonl-tail-cursor.js` —— **进程内**游标（双宿主会重复消费）

- 纯内存指纹集合（:31-74），`take()` 首次只登记不交付（:50-56）。
- 消费点：`hubFeedTick` 每 60s 读 `semantic/judgement-shadow.jsonl`（`lib/index.js:16244-16258`），喂 `hub.ingestJudgement`。
- **双宿主各自持有一份游标** ⇒ 两个进程都会把同一批新行各喂一次 ⇒ `procedures.observe` 重复计数（:16251-16252 注释自己就写了「重启后把环里旧判据再吃一遍 ⇒ 重复计数」）。缓解：`jsonl-tail-cursor` 的指纹只看**内容**，但两个进程的 seen 集合互不可见。
- **结论**：这是「必须单写者」的**硬理由之一** —— 不是性能问题，是**数据正确性**问题。

### 3.5 `lib/consolidate-filter.js` —— 纯函数，零风险

`filterPointsPre`（:30-48）四类确定性过滤（空壳/过程叙述/过短/重复），`MIN_POINT_CHARS=8`（:22）；`userGatePre`（:61-64）只做「过滤+放行判定」，不写盘。⇒ **可跨宿主共享实现**（逐字复刻或用同一份 JS），不构成冲突面。

### 3.6 `lib/hub-io.js` / `lib/memory-hub.js`

- 三店落点 `~/.dsh/memory/hub/`（`lib/index.js:16044`）；procedures 双库：通用库 = hubDir，工作区库 = `workspaces/<wsKey>/hub`（:16065-16081）。
- facts 走 `transaction(job)`：锁内 `readDiskSnapshot` → store 决策 → 提交（`hub-io.js:174-188`）；批内（`beginBatch`）时以「本批待写快照 or 磁盘」为新鲜基准（:176-178）。
- procedures 冲突：`mergeProcedureSnapshotWithConflictCopyPre` + `DAM-PROCEDURE-CONFLICT` + 冲突副本落盘（:26-31），**不是 LWW**。
- `memory-hub.js` 本身**纯内存编排**（:4-26），无 IO。⇒ 双宿主各持一份内存态，落盘时靠 hub-io 的锁/差分兜。**风险点**：episodes.json 不取锁（§2.7）⇒ 双宿主互相覆盖 episode 段。

### 3.7 `lib/engine-identity.js` / `lib/embedding-config.js`

- 宽身份 **9 字段**：`provider, model, weightsDigest, tokenizer, precision, dim, pooling, normalized, inputVersion`（:34-44）；身份 = `engid_pre_<sha256(canonical JSON)[:32]>`（:69-72）；非法身份一律不匹配（fail closed，:79-83）。
- 两级引用：`aliasKey = engineIdentity|chunkId`（:90-92）、`vectorKey = engineIdentity|sha256(exactEncoderInput)`（:100-102）⇒ 换引擎不会串用向量。
- `weightsDigestOfFilePre` 是 `size:mtime:name` 的**指纹而非摘要**（:104-115，作者自己标注了这点）⇒ **跨宿主/跨机器不可比**（同一份权重在不同机器 mtime 不同）。⇒ 若两宿主各自计算权重指纹，会得到**不同 engineIdentity**，导致索引互相判 mismatch 反复重建（**这是双宿主最容易踩的坑之一**）。
- `embedding-config.js`：`configOk` 只认 `provider==='bge-m3-onnx-int8-pre-v1' && modelDir`（:12-20）；`updateEmbeddingConfigPre` 在 `withConfigLockSync` 内读改写、`createOnly` 命中已存在则返回 `__unchangedByCreateOnly`（:45-64，含一次真实缺陷说明）。

### 3.8 版本不一致会怎样（三档降级）

| 不一致 | 判据 | 行为 |
|---|---|---|
| sidecar schema/版本 | `l0-index.js:103-106` `schemaVersion`/`l0IndexVersion` 前缀 | 整文件不可用 ⇒ 重建 |
| 引擎身份 | `engineIdentity != file.engineIdentity`（:110-115） | `engine-mismatch` ⇒ 全量重建，绝不混排 |
| 语料 miv | `memoryIndexVersion(sources)`（`shadow-retrieval.js:145-162`） | 与投递时 miv 不同 ⇒ fail closed 不复用候选（`lib/index.js:7895-7899`） |
| 插件版本 | `configVersion()` 读 `package.json`（:7047-7055） | 仅用于 notices/诊断，**不参与数据格式判定** |

---

## 4. 取证四：`lib/index.js` 的自动行为（哪些会「双跑」）

### 4.1 定时器清单（实测）

| 计时器 | 周期 | 行号 | 双宿主后果 |
|---|---|---|---|
| 心跳 + tickTime + subagentGcSweep + tickAutoContinue + sessionArchiveSweep + wbRotateTick | **15s** | :21098 | **全部双跑** |
| 待重试沉淀队列 | 5min | :21077-21095 | 双跑（各自队列） |
| hubFeedTick（judgement 喂数）+ boot 一次性 | 60s + 90s | :16302/:16306 | 双跑 ⇒ 重复计数（§3.4） |
| team pull（仅 teamEnabled） | `teamSyncIntervalMs` 默认 5s（下限 5s） | :15886-15888 | 双跑 ⇒ 重复拉取（游标 LWW） |
| notices 刷新 | 3600s | :17282 | 无害 |
| JS 模型下载轮询 | 1s（临时） | :16352 | 双下载竞争 |

### 4.2 turn-stopping 自动沉淀的去重口径（三层，全部**进程内**）

`ctx.on('agent/turn-stopping')`（:17307-17345）→ `setTimeout(600ms)` → `engine.consolidateTurn(turn, agent)`（:17341）。

`consolidateTurn`（:13173-13431）的门禁顺序：

1. `runtime.consolidating` 忙 ⇒ skip（:13180）
2. `autoConsolidate===false` ⇒ skip（:13182）
3. 子代理会话 ⇒ skip（`isSubAgentSession`，:13187）
4. **每日上限** `_autoCallCount >= autoConsolidateDailyMax(默认8)`（:13196）
5. **冷却** `autoConsolidateCooldownMinutes(默认30)`，22:00-08:00 翻倍（:13191-13197）
6. **按 turn 去重**：`runtime.lastTurn === turn` ⇒ skip（:13198-13200）
7. 内容门槛 `autoConsolidateMinChars(默认240)`（:13213）

**去重口径结论**：**只有 turn 级、且状态存在进程内存（`runtime.lastTurn`）**。没有 session 级键、没有内容哈希键、没有持久化。⇒ **双宿主对同一 session/turn 各跑一次是必然的**（两个进程各自的 runtime 表的 `lastTurn` 互不可见），且两侧都在同一台机器上看到同一个会话文件时，**同一轮会被固化两次**。

另外：`consolidateTurn` 的写入是 3 条 `appendText`（log :13380 / notes :13387 / PENDING-USER-MEMORY :13407），`[USER]` 一律进 pending（#167 P0，#13395-13400）。**日志段标题是 `\n## <topic>（HH:MM）\n- 要点...`**（:13379-13380）—— 没有机器可读的幂等标记，事后无法去重。

### 4.3 心跳 / polling-lease（Lead 补充点 1 的核对结论）

`writeHeartbeat`（:21018-21076）：

- 路径 `<DSH_HOME>/memory/polling-heartbeat.json`（:21024）
- 自实例 `{pid, startedAt, heartbeatAt, uptimeMs, qLen}`（:21037-21043）
- **多实例感知**：读旧文件 `instances[]`（:21052-21056）→ 剔除「同 pid 且 startedAt 差 <1s」（`SAME_INSTANCE_MS=1000`，:21050/:21060）与「>90s 无心跳」（`ACTIVE_MS=90000`，:21058/:21061）→ 追加自己 → 按 startedAt 排序（:21063）
- 顶层保留旧单值字段（`pid/heartbeatAt/uptimeMs/queueLength/lastConsolidatedAt/todayCount`）+ `instances[]` + `instanceCount`（:21064-21074）
- **关键缺陷**：整个「读→合并→写」**不取任何锁**，且 `writeFile` 非原子（:21054 读 / :21064 写）。两宿主同 15s 节拍内交叉 ⇒ **会互相覆盖 instances，用户看到 `instanceCount` 在 1↔2 之间跳**（这正是 #330-③ 修之前的现象，代码注释 :21027-21032 记录了「旧写法只写自己的 pid ⇒ 文件在两个 pid 之间交替」）。
- 消费方：`debugInfo` 读它做诊断（:10526-10531）。

**设计结论（采纳 Lead 意见）**：单写者租约**复用同一文件格式与同一 `ACTIVE_MS=90s` 口径**，**不新造第二套存活判据**；但必须把它从「无锁 LWW」升级为「锁内合并」或迁到独立 `lease.json`（见 §6.3）。

### 4.4 子代理 GC / 自动接续 / 定时任务

- `subagentGcSweep(force)`（:13106-13154）：日级节流靠 `this._subagentGcDay === today`（**进程内存**，:13110-13111）；扫 `<DSH_HOME>/sessions`（:13112），回收插件一次性子代理会话到 `subagent-gc-backup`（:13123），并清 `storages/session_projcache`（:13124）。⇒ **双宿主双跑**：两个进程同日都会扫，且 `_gcCooldown` 也是进程内（:13119）⇒ 同一批目录被两个进程同时 `rename`，后者必失败（有 fail-soft，但会刷 diag）。
- `tickAutoContinue`（:5700-5725）：靠 `this._autoContState`（**进程内存**）+ `continuedSessionsFile` 持久闩（`<DSH_HOME>/memory/auto-continue-done.json`，:5447）。接续预留走 `acquireSharedStateLock(...+'.active')`（:5754）⇒ **接续动作本身是跨进程互斥的**（这是现有代码里少见的正确点）。但 `arm` 状态是进程内的 ⇒ 两宿主可能各自 arm、各自倒数。
- 定时固化/蒸馏：`scheduleGatePre`/`scheduleOkPre` 的台账 `_scheduleLedger` 是**模块级内存对象**（:2275），`_consolidateScheduleDone` / `_maintainScheduleDone` 也是进程字段（:11058/:11088）⇒ **双宿主各自「成功才写 Done」** ⇒ 同日各跑一次（各耗一次 subagent 额度）。
- 团队同步：`createTeamOutbox`（`<DSH_HOME>/memory/team/outbox.json`，:15729-15737）+ `createTeamSync`（单飞靠进程内 `inFlight`，`team-sync.js:183-244`）⇒ **outbox 本身有跨进程锁**（可安全共享），但 **flush 是双跑的** ⇒ 同一条变更会被两个宿主各发一次（服务端按 `kind+key` 幂等兜底，at-least-once 语义下可接受，但会产生重复网络请求与重复`sent`计数）。
- workbench：`workbench.json` 带 `host` 身份（:11633-11634）；第二宿主抢同一持久会话会得到 `session/writer-held` ⇒ 显式 `host-conflict`（:12019-12033），需用户同意才「本机接管」。**这是 DSH 现有的、可直接复用的单实例保护范式**。

---

## 5. 取证五：配置保存事务

`saveConfig(patch)`（:3340-3352）：

1. 入**实例级**串行链 `_configSaveChain`（:3349-3350，注释明确「全引擎只有这一套队列」）；
2. 进 `withConfigLock(this._configPath)`（:3348）—— **跨进程** 锁（`<configPath>.lock`，单后缀）；
3. `_saveConfigChecked`（:3355-3486）：
   - 严格读 `readSettingsForSave`（损坏 ⇒ 抛，不重置，:3358）
   - 字段校验 `validateSettingsPatch` + 路径校验 `validateSettingsPaths`（symlink/realpath 归属，:3361）
   - 团队权限门（:3373-3375）
   - `semanticEngineMode` 联动（:3380-3385）
   - **根变更 = 迁移窗口**：`changingRoots`/`changingBindings`（:3395-3402）→ `_settingsMigrationActive=true`
   - drain 在途写：note/PLAN flights（:3407）+ 通用 mutation flights（:3424-3434，**未收敛则抛 `SETTINGS_MIGRATION_PENDING_WRITES` 且不发布新根 = fail-closed**）
   - `migrateSettingsTree`（`settings-safety.js:92-187`，所有权日志 + dev/ino + sha256 回执 + 可回滚）
   - 原子写（:3450）成功后才发布内存 config（:3470）
   - 失败 ⇒ 逆序回滚迁移（:3452-3455）

**两宿主是否互相覆盖？** 不会丢字段（整份 patch 是读-合并-写，且锁内重读），但：

- **后写者的 patch 会覆盖同名字段**（预期语义）；
- **另一进程启动期的容量迁移**若不加锁会整份回退（`_persistConfigMergePre` :3335-3338 的注释已说明，现走 `persistConfigPre` → `withConfigLock`）；
- **危险窗口**：进程 A 持有 `engine.config`（内存）而进程 B 改了磁盘 ⇒ A 的后续 `loadConfig` 才看到，期间 A 的 admission 用**磁盘复核**兜（`assertDurableDiskRootUnchangedPre`）—— 但**只覆盖三个根键**，其它键（如 `autoConsolidateDailyMax`）仍可能短暂不一致（推断，无害）。

---

## 6. 设计

### 6.1 设计项 1：记忆根目录

**方案 A（推荐）：沿用 `~/.dsh/memory` + `memoryDir('workspaces')/...` 作唯一真源，不搬家。**

- 目录布局（唯一真源）：
  ```
  <DSH_HOME>/memory/
    MEMORY.md  CALENDAR.md  PENDING-USER-MEMORY.md     # 用户级（跨工作区）
    workspaces/<wsKey>/MEMORY.md  <YYYY-MM-DD>.md  reflections/  handoff/  greetings/  hub/
    index/files/  index/plans/  index/backups/          # sidecar 派生缓存
    semantic/  (l0/ embedding-config.json engine-switch-state.json *.jsonl)
    hub/  evidence/events/  degrade/  retrieval/audit/  global-brief/
    team/  (outbox.json pull-cursor.json)
    workbench.json  polling-heartbeat.json  recall-stats.json  workspaces-summary.json
    cont-seq.json  auto-continue-done.json  auto-continue-done.d/
    archive/  archived-user.md  datadir-migration.log
  <DSH_HOME>/dsh-auto-memory.json                      # DSH 宿主配置（ZCode 只读）
  <DSH_HOME>/auto-memory-archive-ledger.json           # 归档账本（在 DSH_HOME 根，不在 memory/ 下）
  <DSH_HOME>/python-engine/  models/js-semantic/        # 引擎资产（**绝不共享**）
  ```
- ZCode **原生目录不动**：`~/.zcode/cli/memories/projects/<slug>-<hash>/memory/`（本机实测存在）继续归 ZCode 自己用；与 DSH 真源之间做**单向导出/只读视图**，**禁止双写**。理由：ZCode 的目录名是 `slug+hash`（有损、不可逆），DSH 的是 `wsKey`（可读、可逆部分），两套命名无法对齐；一旦双向写必然分脑。

**方案 B（备选，不推荐现在做）：中立根 `~/.auto-memory` + 指针/兼容层。**

- 形态：`~/.auto-memory/<storeVersion>/{user,workspaces,index,...}`；`~/.dsh/memory` 变成 junction/symlink 或只读镜像；两宿主都读中立根。
- 优点：语义干净、未来可接第三个宿主；缺点（**决定性的**）：
  1. 存量 770 个工作区目录 + 用户级文件必须整体搬迁，而 DSH 的迁移机制（`migrateSettingsTree`）只服务「配置根变更」，不覆盖「真源换基座」；
  2. Windows junction/符号链接会撞上 DSH 自己的**符号链接拒绝**判据（`shared-state-lock.js:91`、`config-lock.js:19`、`settings-safety.js:150`「Migration refuses symlinks」）⇒ 中立根一旦用 symlink 指过去，所有写入 fail-closed；
  3. 回滚成本高（双份 770 目录）。
- 结论：**B 只在「用户明确愿意做一次性迁移且接受回滚风险」时启用**；A 是默认。

**迁移步骤（A 方案下，实际是「不迁移」，只做加固）**：

| 步 | 动作 | 判据 | 回滚 |
|---|---|---|---|
| M0 | 只读盘点：`<DSH_HOME>/memory` 与 `workspaces/*` 的文件数/大小/sha256 清单落 `artifacts/_zcode-port/store-inventory.json` | 清单 sha 可复算 | 无副作用 |
| M1 | 写 `memory/.store-version`（`{schemaVersion:1, storeId, createdAt, hosts:{dsh:"...", zcode:"..."}, roots:{...}}`）——**只增不删**，旧宿主忽略未知文件 | 两宿主都能读到同一 `storeId` | 删除该文件即回到现状 |
| M2 | ZCode 侧实现 `resolveStoreRoot()`：`DSH_HOME` 同链 + 校验 `.store-version` 的 `roots.userMemoryDir/memoryRoot` 与自身解析一致，不一致则**拒绝启动写路径**（只读降级） | 不一致时**必须报错**，不得静默用错根 | 配置回退 |
| M3 | 只读并行运行 1 周（ZCode 只读、DSH 读写），比对两侧看到的文件 mtime/摘要一致率 100% | 一致性报告 | 停 ZCode 即可 |
| M4 | 开启双写（B 方案才有搬迁）——A 方案**不适用** | — | — |

> 若用户最终选 B：迁移 = `migrateSettingsTree(from=<DSH_HOME>/memory, to=~/.auto-memory/store-v1)`（复用其所有权日志/回执/回滚，见 `settings-safety.js:92-187`），但**必须先把 symlink 拒绝逻辑对「根本身是 junction」放行**，否则第一步就 fail-closed。**该改动超出本文档范围，列为未验证待设计项。**

### 6.2 设计项 2：统一锁协议（ZCode 端复用同一套原语）

**必须二进制兼容的锁文件格式**（ZCode 侧逐字实现）：

```json
{"pid":12345,"host":"JH-Z-PC"}
```

- 单行 JSON，无 BOM，字段名与顺序固定 `pid,host`；写入用 `openSync(path,'wx')` 独占创建后 `writeFileSync`（**先创建后写**，中间存在「文件已存在但内容为空」的窗口 → 这也是 30s 宽限的来源）。
- 锁文件 = `<canonical>.lock`；门 = `<canonical>.lock.acquire`。**canonical 规则必须逐字相同**：`path.resolve` → 逐级 `realpath` 到最深存在祖先 → `path.join(realpath(ancestor), ...missingSuffix)`。
- 死主判定：`host === os.hostname()` **且** `Number.isInteger(pid) && pid>0` **且** `process.kill(pid,0)` 抛 `ESRCH`。异主机/活主一律不动。
- 回收前必须 `stat` 前后 `ino/dev` 一致（防误删新锁）。
- 门回收：元数据可解析 ⇒ 按死主判据；不可解析 ⇒ 年龄 > `30000ms` 才回收。
- 超时与轮询：默认 10s / 20ms；同步版用 `Atomics.wait`（ZCode 若在异步运行时里做，用 sleep 即可，只要**不忙等**）。
- 符号链接：目标本身是 symlink ⇒ 拒绝。

**锁文件命名归一（必须先解决的兼容性问题）**

| 调用方 | 传入 acquire 的路径 | 实际锁文件 | 实际门 |
|---|---|---|---|
| `memory-writer._withDocLock` (`memory-writer.js:478`) | `<doc> + '.lock'` | `<doc>.lock.lock` | `<doc>.lock.lock.acquire` |
| `engine._withDocumentLockPre` (`index.js:8824`) | `<doc> + '.lock'` | `<doc>.lock.lock` | 同上 |
| `withCalendarLock(planPath/calendarPath)` | `<doc>` | `<doc>.lock` | `<doc>.lock.acquire` |
| `withConfigLock(configPath)` | `<config>` | `<config>.lock` | `.lock.acquire` |
| `continuation-state` (`:134/142/153/161/173`) | `<stateFile>` | `<state>.lock` | `.lock.acquire` |
| `team-outbox` (`:139-141`) | `<file>`（内部 `canonicalLockTargetPre`） | `<file>.lock` | `.lock.acquire` |
| `hub-io facts` (`:182/:200`) | `<facts.json>` | `<facts>.lock` | `.lock.acquire` |
| `hub-io procedures` (`:363`) | `<procedures.json>` | `<procedures>.lock` | `.lock.acquire` |

⇒ **两种命名并存**。推荐处置（按代价排序）：

1. **短期（共存 v1，零改动）**：ZCode 端**照抄事实**：写记忆文档时锁 `.lock.lock`，写 PLAN/CALENDAR/配置/状态时锁 `.lock`。逐条对齐上表。
2. **中期（DSH v3.3.x 内修）**：把 `memory-writer.js:478` 与 `index.js:8824` 改为传入文件路径本身（去掉调用方的 `+'.lock'`），使实际锁 = `.lock`，并**兼容期双锁**（先锁 `.lock`，再尝试 `.lock.lock`，两者都拿到才写；释放逆序），保证与旧版本/未升级 ZCode 仍互斥。
3. 该修正必须配**跨进程回归**（两进程并发 append 400 条），不能只做静态守卫。

**需要覆盖的写路径与锁粒度（ZCode 必须实现的最小集）**

| 优先级 | 写路径 | 锁目标 | 粒度 |
|---|---|---|---|
| P0 | 记忆文档 append / replace（日志、笔记、用户级、白板单卡） | 文档文件 | 文件级（读改写全事务） |
| P0 | PLAN.md 重写 | `planPath` | 文件级 + `expectedRevision` |
| P0 | CALENDAR.md 事务 | `calendarPath` | 文件级 |
| P0 | `dsh-auto-memory.json` 保存 | 配置文件 | 文件级（读改写全事务） |
| P0 | `cont-seq.json` / `auto-continue-done.d/*` | 状态文件 | 文件级 |
| P1 | `hub/facts.json` | facts 文件 | 文件级（事务门） |
| P1 | `hub/procedures.json`（通用+工作区） | 两个文件**按排序**依次取 | 多文件有序锁（死锁免疫） |
| P1 | `team/outbox.json` | outbox 文件 | 文件级 + 锁内重读合并 |
| P2 | 交接账本/反思（`writeFullRaw` 非 CALENDAR） | 文档文件 | **当前裸写，需先补锁**（DSH 侧改动） |

### 6.3 设计项 3：单写者租约（leader lease）

**只允许一个实例执行的清单**（依据 §4）：

1. turn-stopping 自动沉淀（`consolidateTurn`）
2. `hubFeedTick`（judgement 喂数，含进程内游标）
3. 语义引擎 / Python worker（venv、模型、worker 进程、index sync）
4. 子代理 GC（`subagentGcSweep`）
5. 自动接续（`armAutoContinue`/`tickAutoContinue`/`hostAutoContinue`）
6. 团队同步 flush + pull（outbox 共享、flush 单写）
7. 定时蒸馏 / 定时固化 / 自动总结（`scheduleGatePre` 家族）
8. 索引维护（sidecar 重建、L0 sync、engine-switch 状态机）
9. workbench 轮换（`_wbRotateTick`）
10. 会话归档/删除巡检（`sessionArchiveSweep`）

**租约文件**：`<DSH_HOME>/memory/lease.json`（**不复用 polling-heartbeat.json 的读写路径**，理由：后者是诊断面且无锁；但**复用其 `ACTIVE_MS=90s` 与 `{pid,startedAt}` 身份口径**，避免第二套存活判据）。

```json
{
  "schemaVersion": 1,
  "leaseId": "lease_<uuid>",
  "role": "leader",
  "host": { "kind": "dsh", "hostname": "JH-Z-PC", "pid": 12345, "startedAt": 1750000000000, "instanceId": "inst_<8hex>" },
  "epoch": 7,
  "acquiredAt": 1750000000123,
  "renewedAt": 1750000045123,
  "ttlMs": 45000,
  "renewIntervalMs": 15000,
  "stealAfterMs": 135000
}
```

- **心跳**：每 15s（与 DSH 现有心跳同节拍）在 `withSharedStateLock('<...>/memory/lease.json')` 内「重读 → 校验自己仍是 leader → 更新 `renewedAt`/递增 `epoch` → 原子写」。
- **有效期 TTL**：45s = 3× 心跳；**抢占阈值** `stealAfterMs` = 135s = 3×TTL（给 GC 暂停/满负载留余量）。
- **抢占**：候选者发现 `now - renewedAt > stealAfterMs`（或 owner pid 在本机且 `ESRCH`）⇒ 在锁内重读确认 → 写自己的 lease（`epoch+1`）→ 广播（写 `memory/hosts/<hostId>.json` 的 `role`）。
- **优雅交接**：SIGTERM/插件 dispose 时在锁内写 `{role:"released", releasedAt, handedTo?:<hostId>, epoch}`；对端看到 `role==='released'` 立即抢，不必等 stealAfter。
- **降级者**：`role==='client'`，只做只读动作（注入、检索、面板查看），写动作走代理（§6.7 A）或直接拒绝并提示。
- **关键实现要求**：租约**必须**用 `withSharedStateLock` 保护「重读-判定-写入」全程，否则两实例同时抢会双 leader（这是 `team-outbox` #307 已经踩过的同型坑：`team-outbox.js:38-44`「原子 rename 只保证读到完整字节，不防旧快照覆盖」）。

**心跳复核建议**：把 `polling-heartbeat.json` 的写路径也纳入同一把锁（或改 `writeTextAtomicPre`），否则 `instances[]` 会丢条目，用户无法判断「到底有几个宿主在跑」。

### 6.4 设计项 4：幂等去重（两宿主对同一 session/turn 都可能触发）

**幂等键**：

```
idemKey = sha256( "consolidate/v1\u0000" + hostKind + "\u0000" + sessionId + "\u0000" + turn
                 + "\u0000" + sha256(userText) + "\u0000" + sha256(assistantText)
                 + "\u0000" + consolidatorVersion )
```

（`consolidatorVersion` = 插件版本 + prompt 版本常量；内容哈希保证「同 turn 但内容不同」不会误判为同一件事。）

**认领协议（跨进程原子）**：

1. 写前 `openSync('<DSH_HOME>/memory/consolidation-ledger/<idemKey>.json','wx')`；
2. 抢到 ⇒ 写 `{status:"writing", host, pid, at, turn, sessionId, points:<N>}`，然后执行写入；
3. 写完 ⇒ 改写 `{status:"done", written:<N>, at}`（原子替换）；
4. 失败 ⇒ `{status:"failed", error, at}`，允许 TTL（如 10min）后由任何一方重试；
5. 抢不到 ⇒ 读其 `status`：`writing` 且 `now-at < 10min` ⇒ **让行**（不重复写）；`done` ⇒ 让行；`failed`/过期 ⇒ 重试抢占（用 `withSharedStateLock` 串行化「重读-改状态-写」）。

**谁负责写**：**只由 leader 写**。客户端在本地检测到新 turn 时，把 `{sessionId, turn, userText, assistantText}` 投递到 `memory/consolidation-inbox/<idemKey>.json`（同样是 `wx` 认领，天然去重），leader 的 15s 心跳顺带扫 inbox。这样「谁负责写」= 租约持有者，不依赖两边时钟或内容比较。

**补充的人可读标记**：日志段标题追加 `<!-- dsh-am:idem=<前16hex> -->`（与现有 `## 主题（HH:MM）` 格式并存），使事后可审计、可人工去重（现有实现无此标记，见 §4.2）。

### 6.5 设计项 5：索引与缓存的共享策略

| 数据 | 策略 | 理由 |
|---|---|---|
| `index/files/*.json`（sidecar） | **共享**，单写者重建；读者按 `fileDigest` 校验，失败走 `dropped` 分类 | 派生数据，可重建；§3.8 三档判据已 fail-closed |
| `index/plans/`、`index/backups/` | 共享（只增） | 无冲突 |
| `semantic/l0/*.json` | **共享**（按 `workspaceKey`+layer 天然分区）；引擎身份门保证不混排 | §3.2 |
| `semantic/*.jsonl`（shadow/judgement/activation） | **只由 leader 的 Python worker 写**；客户端只读 | worker 是单写者，双开必然互相截断（保尾丢弃） |
| `semantic/embedding-config.json` | 共享 + `config-lock`；`createOnly` 语义不动 | §3.7 |
| `semantic/engine-switch-state.json` | **只由 leader 写**（状态机唯一所有者，`engine-switch.js:2-22`） | 双写会让 phase 回退 |
| 向量缓存（进程内） | **不共享**（各进程独立），靠 `engineIdentity+vectorKey` 对齐 | 内存态 |
| `recall-stats.json` | 共享但需加锁（当前 LWW，§2.7）；否则计数丢失 | 统计可丢但不可错乱 |
| `workspaces-summary.json` | 共享，LWW 可接受（缓存） | 可重建 |
| `hub/episodes.json` | **需加锁**（当前无锁） | 双写互相覆盖 |

**版本不一致降级（三层）**：

1. `engineIdentity` 不一致 ⇒ **索引整文件判不可用 → 全量重建 → 重建期间检索降级为词法**（现有机制，§3.8）。
2. `miv` 不一致 ⇒ **不复用投递时的候选**（fail closed），本次走词法/下一轮再试。
3. `schemaVersion`/`l0IndexVersion` 不一致 ⇒ 整文件不可用，重建。
4. 插件版本不一致（如 DSH v3.3.15 vs ZCode 侧移植版落后）⇒ **数据格式层不允许"向后兼容假设"**：在 `.store-version` 里写 `schemaVersion`，写入方在 `schemaVersion` 高于自己支持的上限时 **拒绝写**（只读），避免用旧代码写出新格式。

### 6.6 设计项 6：配置分层

**三层文件（共享核心 / 宿主私有 / 运行时）**：

```
<DSH_HOME>/memory/config/core.json        # 共享核心（只有 leader 可写）
<DSH_HOME>/memory/config/hosts/<hostId>.json  # 宿主私有（各写各的）
<DSH_HOME>/memory/config/lease.json       # 运行时（见 §6.3，实际路径 memory/lease.json）
```

- **core.json**（共享，白名单键）：`memoryRoot, userMemoryDir, projectMemoryDir, noteCapacityChars, userCapacityChars, autoConsolidate*, autoConsolidateMinChars/Cooldown/DailyMax, consolidateSchedule*, maintainSchedule*, memoryHubEnabled, l0IndexEnabled, embeddingCacheV2Enabled, memoryAnchorEnabled, criteriaGate, handoffEnabled, boardMode`。
- **hosts/<hostId>.json**（私有）：`kind(dsh|zcode), instanceId, panelAllowedHosts, skin*, layout-config, subagentModel/Provider/Effort, waterLevel*, autoContinue*, unattendedMode, externalSources, team*`（团队凭据绝不进 core）。
- **优先级**：`core` < `hosts/<id>` < 环境变量（`DSH_AUTO_MEMORY_ALLOWED_HOSTS` 等）< 命令行/一次性 override。
- **兼容层（关键）**：现有 `<DSH_HOME>/dsh-auto-memory.json` **保留不动**，视为 DSH 的 host 私有配置 + core 的旧载体。读取顺序：先读旧文件（保持逐字节兼容），再叠加 `config/core.json`（若有）。**不做一次性迁移**（迁移会撞上 `migrateSettingsTree` 的根变更窗口，风险大于收益）。
- **写者约束**：`core.json` 只有 leader 写（客户端改核心设置 ⇒ 代理到 leader）；`hosts/<id>.json` 各宿主独立 `withConfigLock`。
- **共享核心的写必须沿用 DSH 的 `saveConfig` 事务**（锁 + 校验 + 迁移窗口 + 原子写 + 回滚），不要在 ZCode 侧重造一套。

### 6.7 设计项 7：降级形态选型（Lead 补充点 4）

**形态 A：leader 暴露本机 HTTP，客户端代理写。**

- 现状基础：DSH 面板已有 **73 条** `/api/dsh-auto-memory/*` 路由（实测 `lib/index.js:347-429` 的 API 常量 73 键；`routes` 数组内 `kind:'exact'` 73 项，逐一带 `isLoopbackRequest` 守卫，共 73 处）。覆盖面包括 `state/file/recall/config/note/rules-apply/calendar/team-*/memory-hub/storage-manage/workbench/migrate-*`。
  > 注：Lead 提到的「26 条 loopback HTTP 路由」与本次实测 73 不符；`path: API.*` 直接写法的确是 26 处，其余 47 处是 `path: API['xxx']` 形式。**口径差异已记录，不采信任一为「错」**（见 §8 未验证项）。
- 写接口可行性：`API.note`（:20604）已要求 `sessionId + expectedNotesPath`；`memory_log/memory_note/memory_user` 走工具层；**没有通用的「写任意记忆文件」路由** ⇒ ZCode 若走 A，需要 leader 侧新增 1-2 条受控写路由（或复用 `migrate-import`）。
- 判据（选 A 当且仅当）：① ZCode 需要**写**共享记忆；② leader 与客户端**同机**（回环可达）；③ 能接受「leader 不在 ⇒ 写能力整体不可用」。

**形态 B：直接共享文件，只读。**

- 可行性：`state`、`file`、`recall`、`workspaces` 都可纯读实现；读取不需要锁（写侧原子 rename 保证读到完整版本）。
- 判据（选 B 当且仅当）：① 只需要注入/检索/查看；② 无法保证 leader 在线；③ 希望零新增接口。

**推荐组合**：**A 为主（写）+ B 兜底（读）**。落地顺序：B 先上（零风险，纯读），A 作为 v2。**不要**做「两宿主都直写文件 + 只靠锁协调」—— 除非 §6.3 租约 + §6.2 锁协议 + §6.4 幂等三者全部落地，否则双写等价于数据赌博。

### 6.8 风险矩阵（两宿主同 workspace 同时运行）

| # | 冲突场景 | 后果 | 对策 | 验证方法 |
|---|---|---|---|---|
| R1 | **锁文件路径不一致**（`.lock` vs `.lock.lock`） | 两宿主各拿各的锁 ⇒ 并发读改写 ⇒ **后写覆盖先写，记录消失** | 按 §6.2 表逐条对齐；中期修 DSH 双后缀并兼容期双锁 | 两进程各 append 200 条 ⇒ 断言 400 条全在；负路径：故意只锁 `.lock` ⇒ 断言丢条目（用例 A2/A6） |
| R2 | 日志 append（同日 `<date>.md`） | 若锁失效 ⇒ 丢条目；若两宿主都触发沉淀 ⇒ **同轮重复条目** | 锁（R1）+ 幂等键（§6.4）+ 只 leader 写 | 同一 turn 在两宿主各触发一次 ⇒ 断言日志只多 1 段 |
| R3 | 笔记原子写整篇（`MEMORY.md` replace） | 无 `expectedDigest` 时整篇覆盖，丢他人新增 | `replace`/`append`/`replaceSingle`/`applyPlan` 四路**默认**带 `state.fileDigest`（#321 全路径普查，`memory-writer.js:828`/`:849`/`:862`/`:876`）⇒ 冲突显式拒绝；调用方重试必须重读 | 构造「A 读旧 → B 写 → A 提交」⇒ 断言 A 得到 `conflict-external-edit` 且 B 内容仍在 |
| R4 | 白板 revision（`PLAN.md` 单卡编辑） | 后到者 CAS 失败，用户看到连续冲突；若绕过 CAS ⇒ 丢卡 | 保持 `expectedRevision`（sha256 of body）严格；客户端冲突时**重读再合并**，不自动重试覆盖 | 两宿主同时改不同卡 ⇒ 一成功一失败；断言失败方无任何字节落地 |
| R5 | 规则文件（用户级 `MEMORY.md` 的 `[规则]` 段，每轮无条件注入） | 条目级增删改被覆盖 ⇒ 过时规则继续注入 / 新规则丢失 | `memory_rules` 的 `expect` 内容锚定（工具契约，`lib/index.js:18558`「删改需带 expect」）+ 落盘走 `writeFull` 带 digest（:9045） | 两宿主各 remove 不同条目 ⇒ 断言两条都删除成功；负路径：并发 remove 同一条目 ⇒ 一次成功一次「expect 不符」 |
| R6 | 日历（`CALENDAR.md`） | 整篇重渲染覆盖他人新增 | `withCalendarLock` + `_calendarTransactionPre` 锁内重解析 | 两宿主各加 10 条 ⇒ 断言 20 条全在 |
| R7 | 团队同步 outbox / pull-cursor | outbox 有锁（安全）；**pull-cursor 无锁 LWW** ⇒ 游标回退 ⇒ 重复拉取（历史上导致过 12GB 事故，:15840-15843） | pull-cursor 纳入 `withSharedStateLock`；pull 单写 | 两宿主各写游标 ⇒ 断言磁盘为较大值；负路径：无锁并发写 ⇒ 断言出现回退 |
| R8 | 索引重建（sidecar / l0 / semantic） | 双重建互相判 stale ⇒ 反复重建；worst case 写入不完整索引 | 只 leader 重建；读者按 `fileDigest/miv/engineIdentity` fail-closed | 双宿主同时触发 repair ⇒ 断言只有 leader 写、读者读到的 snapshot 摘要一致 |
| R9 | Python 引擎双开（venv/模型/worker） | `<userDir>/python-engine/.venv` 并发安装互相破坏；两 worker 抢同一 `semantic/` 目录保尾截断 | **绝不共享**；python-engine 目录按宿主隔离（ZCode 用自己的 `~/.zcode/.../python-engine`）；或只 leader 起 worker，客户端走 A 代理 | 两宿主各起 worker ⇒ 断言 `semantic/*.jsonl` 行数不减少（保尾语义）；负路径：故意双 worker ⇒ 断言出现行数下降 |
| R10 | 端口/临时目录/锁文件路径 | 端口冲突（`dsh web` 固定 35117）；临时文件被覆盖 | 端口由各自宿主决定；临时名必须 `pid+seq`（`config-io.js:38-56` 的教训）；`undefined\temp` 坑见用户级记忆 | 两宿主并发写同一配置 ⇒ 断言无 `ENOENT rename`（固定 tmp 名会踩） |
| R11 | 心跳 `polling-heartbeat.json` | 无锁 LWW ⇒ `instances[]` 丢条目，用户误判只有 1 个宿主 | 锁内合并 或 改原子写；租约复用同口径 | 两宿主同 15s 窗口写 ⇒ 断言 `instanceCount===2` 稳定 1 分钟 |
| R12 | workbench 会话归属 | 第二宿主抢持久会话 ⇒ `writer-held` ⇒ `host-conflict` | 复用现有 `host-conflict` + 用户同意接管（:12019-12033） | 双宿主启动 ⇒ 断言第二者 `reason='host-conflict'` 且未经同意不建会话 |
| R13 | 子代理 GC 双跑 | 同一目录被两进程同时 `rename` ⇒ 后者失败刷 diag | 只 leader 跑 | 断言同日 `subagent gc sweep` 日志只出现一次 |
| R14 | 自动接续双跑 | 两宿主各自 arm ⇒ 双接续 / 抢同一 source | 接续预留已有跨进程锁（:5754）；arm 状态纳入租约（只 leader arm） | 两宿主同水位 ⇒ 断言只产生 1 个新会话 |
| R15 | 定时蒸馏/固化双跑 | 各耗一次 subagent 额度；可能双写笔记 | 只 leader；`_scheduleLedger` 持久化到 `memory/schedule-ledger.json`（当前是内存） | 断言当日 `consolidate` 记账只 1 条 |
| R16 | 配置保存互相覆盖 | 整份 patch 读写，锁内重读 ⇒ 不丢字段；但同键 LWW | 沿用 DSH `saveConfig`；`core.json` 只 leader 写 | 两宿主各改不同键 ⇒ 两键都在；负路径：绕过锁整份写 ⇒ 断言丢键 |
| R17 | 设置根迁移窗口（`memoryRoot` 变更） | 窗口内客户端写旧根 ⇒ 409 或内容落旧根 | 复用 `SETTINGS_MIGRATION_ACTIVE`/`SETTINGS_ROOT_CHANGED`；客户端收到 409 必须**保存草稿并重试**，不得静默丢弃 | 迁移期间客户端写 ⇒ 断言 409 且文件数不变 |
| R18 | 引擎切换状态机双写 | phase 回退/进度错乱 | `engine-switch-state.json` 只 leader 写 | 断言切换期间磁盘 `generation` 单调不减 |
| R19 | `hub/episodes.json` 无锁 | 双写互相覆盖 episode 段 | 纳入 `withConfigLockSync`（与 facts 同款） | 两宿主各 append 一条 ⇒ 断言 2 条都在 |
| R20 | 皮肤/layout 等纯前端配置 | 无数据风险，但会互相覆盖显示偏好 | 放 `hosts/<hostId>.json`（私有），不进 core | 断言两宿主各自的 skin 配置独立 |

### 6.9 共存验收用例（每条含负路径）

> 全部用例要求**真执行**：启两个进程、真写盘、真读回、复算摘要。不接受「源码含某字符串」式守卫。

| ID | 用例 | 正路径断言 | 负路径（必须红） |
|---|---|---|---|
| A1 | 并发 append | 两进程各 append 200 条到同日日志 ⇒ 读回 400 条，且每日志行 sha256 可复算 | 去掉文档锁（或让 ZCode 只锁 `.lock`）⇒ 读回 <400 条 |
| A2 | 跨进程文档事务 | A 读旧 → B 提交 → A 提交 ⇒ A 得 `conflict-external-edit`，B 内容仍在 | 去掉 `expectedDigest` ⇒ A 覆盖 B（断言 B 内容消失） |
| A3 | 索引与文件一致 | 对每个 sidecar：`fileDigest` 与正文 sha256 一致；`miv` 可从 sources 复算 | 手工改正文不改 sidecar ⇒ `scanHealth` 必须报 `stale-source`（不得报 ok） |
| A4 | 无双跑（租约） | 两进程同时启动 ⇒ 恰好 1 个 `role==='leader'`；kill -9 leader ⇒ 135s 内另一进程接管，且此前 135s 内**无第二 leader** | 绕过锁直接写 lease ⇒ 构造双 leader，断言检测器报警（证明判据有效） |
| A5 | 锁格式二进制兼容 | ZCode 侧实现对同一文件取锁 ⇒ DSH 侧取锁超时（证明互斥） | ZCode 用 `.lock` 锁记忆文档 ⇒ DSH 仍能拿到 `.lock.lock` ⇒ 断言**不互斥**（记录为已知缺口，不修则不得发布双写） |
| A6 | 幂等去重 | 两宿主对同 session/turn 各触发一次 ⇒ 日志只多 1 段，`consolidation-ledger/<idemKey>.json` 只有 1 个 `done` | 去掉 idemKey（改随机 id）⇒ 日志多 2 段 |
| A7 | 引擎身份降级 | 写入 `engineIdentity=A` 的 L0 索引，用 `engineIdentity=B` 读 ⇒ `engine-mismatch`，随即全量重建，**不混排** | 关掉身份门（`embeddingCacheV2Enabled=false`）⇒ 断言出现跨引擎向量混排（证明身份门有效） |
| A8 | 配置双写 | 两宿主各改不同键 ⇒ 两键都在，其余键不丢 | 绕过 `withConfigLock` 整份写 ⇒ 断言丢键（证明锁有效） |
| A9 | 心跳多实例 | 两宿主运行 ⇒ `instanceCount===2` 连续 1 分钟稳定 | 无条件 LWW 写 ⇒ 采样 20 次出现 `instanceCount===1`（证明需加锁） |
| A10 | workbench 归属 | 双宿主 ⇒ 第二者 `reason='host-conflict'`，且无用户同意时不新建会话 | 伪造 host 身份 ⇒ 断言被 `epochToken` 归属门拒绝 |
| A11 | 迁移窗口 | 迁移期间客户端写 ⇒ 409 + 文件数不变；迁移后重试成功 | 关掉 admission ⇒ 写入旧根（断言新根缺该条） |
| A12 | python 引擎隔离 | 两宿主各用自己 venv ⇒ 两侧 `import transformers, onnxruntime, numpy` 均 ok | 共享同一 venv 并发安装 ⇒ 断言一侧 `deps` 探测失败（证明必须隔离） |
| A13 | 索引不重复消费 | 两宿主共享 `judgement-shadow.jsonl` ⇒ 只 leader 消费，`procedures.observe` 计数增量 = 行数 | 两宿主都消费 ⇒ 计数增量 = 2×行数 |

---

## 7. 落地路线（建议，不含代码改动）

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0（只读共存） | ZCode 实现 B 形态只读：按 §1.1 解析 `DSH_HOME`、(`.store-version`)、复用 `wsKey`；读注入/检索/面板 | A3、A9（只读侧不改心跳） |
| P1（锁对齐） | ZCode 实现 `shared-state-lock` 同算法 + §6.2 命名表；先只做 `P0` 写路径（文档/PLAN/CALENDAR/配置/状态） | A1、A2、A5、A8、A11 |
| P2（租约） | 落地 `lease.json` + 心跳 + 抢占 + 交接；把 §6.3 的 10 项任务全部收进 leader | A4、A13、R13/R14/R15 对应断言 |
| P3（幂等） | `consolidation-ledger` + inbox + 人可读 idem 标记 | A6、R2 |
| P4（写代理） | A 形态：leader 新增 1-2 条受控写路由，客户端代理 | 端到端：客户端改设置/写笔记 ⇒ 落盘在 leader 侧 |
| P5（清理） | 修 `.lock.lock` 双后缀（兼容期双锁）、给 `episodes.json`/`pull-cursor`/`recall-stats` 补锁、心跳改锁内合并 | A5 负路径转绿 |

---

## 8. 未验证 / 待验证清单（如实标注）

1. **ZCode 侧无常驻定时器、只有 hooks + MCP server 进程** —— 引自 Lead 的补充，**未独立核验**（本机只确认了 `~/.zcode/cli/` 目录结构与 `config.json` 的 plugins 段）。若成立，则「ZCode 侧不会双跑定时任务」只需 leader 覆盖 DSH 内部任务；若不成立，需按 §4.1 全量对照。
2. **73 vs 26 路由数** —— 本次实测：API 常量 73 键、`routes` 内 `kind:'exact'` 73 项、`isLoopbackRequest(req, panelAllowedHosts)` 守卫 73 处（`lib/index.js:19046` 起）。`path: API.*` 直写形式 26 处。Lead 的「26 条」可能是历史口径或另一份文档的口径，**不做单方裁定**。
3. **`.lock.lock` 是否为有意设计** —— 从注释（`memory-writer.js:453` 明确写 `.lock`）与两处调用点都传 `+'.lock'` 看，**推断为无意的双拼**，但我没有 git blame 证据（时间盒内不展开）。无论是否有意，**共存必须按实际行为对齐**。
4. **Python worker 是否支持并发/多实例** —— 只读了目录与写盘方式（保尾截断），**未验证** worker 是否有 pid/单例锁。按「双开必然互相截断」保守设计。
5. **ZCode 原生记忆目录是否可配置** —— 只实测到本机存在 `~/.zcode/cli/memories/projects/<slug>-<hash>/memory/`；**是否可改根、是否有 API** 未验证（属线 A 范围）。
6. **DSH 路由是否有「通用写任意记忆文件」的端点** —— 本次只确认 `note`/`file`/`migrate-import`/`config` 等，**未逐个通读 73 个 handler**；A 形态可能需要新增路由，成本未估。
7. **`_pathWriteQueuePre()` 是否确为死代码** —— grep 只有定义与构造，无 `.write(/`.run(` 调用；**待验证**是否有动态调用/外部消费者。
8. **心跳 90s / 租约 45s 的取值** —— 依现有 `ACTIVE_MS=90000` 与 15s 节拍推导（TTL=3×心跳、steal=3×TTL），**未经真机压测**；GC 暂停长的机器需上调。
9. **`weightsDigestOfFilePre` 跨宿主一致性** —— 该函数用 `size:mtime:name`，同一份权重在两台机器/两次下载都会不同 ⇒ 推断会导致 `engineIdentity` 不一致 ⇒ 索引反复重建。**未实测**；若成立，需让 ZCode 侧**复用 leader 计算的 engineIdentity**（而非自己算）。

---

## 附录 A：关键行号索引（便于复核）

```
lib/dsh-home.js            86-105  resolveDshHomePre 回落链
lib/dsh-home.js            114-142 resolveDshHomeForEnginePre
lib/datadir.js             64-101  memoryDir（<home>/memory/<name>）
lib/shared-state-lock.js   8-19    canonical；85-89 claim；23-26 isDead；27-36 removeDead
lib/shared-state-lock.js   38-84   reclaimDeadGate（GATE_STALE_MS=30000）
lib/shared-state-lock.js   90-132  async acquire；162-214 sync acquire（Atomics.wait）
lib/config-lock.js         120-141 withConfigLockSync / withConfigLock（owned() 重入）
lib/config-lock.js         145-151 readConfigSnapshot（无锁读）
lib/calendar-lock.js       7       薄壳 re-export
lib/path-write-queue.js    19-51   进程内按路径串行（非跨进程）
lib/memory-writer.js       460-489 _withDocLock（String(filePath)+'.lock' → 实际 .lock.lock）
lib/memory-writer.js       453     注释声称 .lock（与实际不符）
lib/memory-writer.js       524-594 _queue（admission+别名+跨进程锁+全事务）
lib/memory-writer.js       723-787 _commit（backup→atomicReplace→回读→sidecar）
lib/memory-writer.js       664-670 sidecarPath = sha256(canonicalSourcePath)
lib/memory-mutation-transaction.js 134-172/245-276/309-334  admission + 两道根复核
lib/index-sync.js          31/69-144/150-178  索引协议
lib/l0-index-sync.js       56-60/73-202       L0 索引文件名与同步
lib/l0-index.js            87-115/140-190     引擎身份门 + 增量复用
lib/jsonl-tail-cursor.js   31-74              进程内内容指纹游标
lib/consolidate-filter.js  30-64              纯函数过滤
lib/hub-io.js              174-188/193-206/323-365  facts 事务 / episodes 无锁 / procedures 有序多锁
lib/engine-identity.js     34-44/69-72/100-115     宽身份 9 字段 / 两级键 / 权重指纹
lib/embedding-config.js    12-20/45-64        配置读 / createOnly
lib/index.js               563/565/567         DEFAULT_CONFIG 三个根
lib/index.js               2370                _configPath
lib/index.js               3497-3516           wsKey / projectDirOf
lib/index.js               3601-3656           userDirOf / resolvePaths（12 条路径）
lib/index.js               8923                裸 writeFile（writeFullRaw 非 CALENDAR）
lib/index.js               8824                _withDocumentLockPre（同样双后缀）
lib/index.js               13173-13431         consolidateTurn（去重口径全在这里）
lib/index.js               13106-13154         subagentGcSweep
lib/index.js               16244-16258          hubFeedTick + 游标
lib/index.js               16412/16439-16441    l0IndexDir / l0IndexSyncTick 无消费者
lib/index.js               17307-17345         turn-stopping 钩子
lib/index.js               21018-21076         writeHeartbeat（多实例 + 无锁 LWW）
lib/index.js               21098               15s 心跳串联 6 个后台动作
lib/index.js               3340-3352/3355-3486 saveConfig / _saveConfigChecked
lib/index.js               12019-12033         workbench host-conflict
```

## 附录 B：ZCode 目录映射表（一个真源 + 两个视图）

| 真源（DSH，唯一可写） | ZCode 视图 | 方式 | 绝不共享 |
|---|---|---|---|
| `<DSH_HOME>/memory/MEMORY.md` | ZCode 项目记忆 `MEMORY.md`（**只导出**） | 单向导出（幂等，按 mem_id 跳过已有） | 双写 → 分脑 |
| `<DSH_HOME>/memory/CALENDAR.md` | 导出视图 | 单向导出 | 双写 |
| `<DSH_HOME>/memory/workspaces/<wsKey>/**` | 只读挂载 | `wsKey` 逐字复用 | ZCode 自算 slug/hash |
| `<DSH_HOME>/memory/index/**` | 只读 | sidecar 派生 | 客户端重建 |
| `<DSH_HOME>/memory/semantic/**` | 只读 | 同上 | 双 worker 写 |
| `<DSH_HOME>/memory/hub/**` | 只读 | 同上 | 双写 |
| `<DSH_HOME>/memory/team/**` | 只读（如需团队） | outbox 锁共享，flush 单写 | 双 flush |
| `<DSH_HOME>/memory/polling-heartbeat.json` | 只读（诊断） | — | 双写（除非加锁） |
| `<DSH_HOME>/memory/workbench.json` | **不读不写** | — | 任何共享 |
| `<DSH_HOME>/dsh-auto-memory.json` | 只读（看配置） | — | ZCode 写 |
| `<DSH_HOME>/sessions/`、`storages/`、`subagent-gc-backup/` | **不读不写** | — | 任何共享 |
| `<DSH_HOME>/python-engine/`、`models/js-semantic/` | ZCode **自己的** `<ZCODE_HOME>/python-engine/` | 物理隔离 | 共享 venv/模型 |
| `<DSH_HOME>/memory/skins/`、`layout-config.json` | 各自私有（进 `hosts/<id>.json`） | — | 共享 |
| `~/.zcode/cli/memories/projects/<slug>-<hash>/memory/` | ZCode 原生（保留） | 仅当单源真源缺失时作「导入源」 | 当共享库 |
