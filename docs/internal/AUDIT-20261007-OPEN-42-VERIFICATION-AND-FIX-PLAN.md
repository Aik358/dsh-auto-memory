# 上游 42 条开放报告全量核查与修复方案（2026-10-07）

> 本文件是**只读核查 + 落地方案**的交付物。**本批未修改任何产品代码**（`lib/` 逐字节未动）。
> 核查对象：`github.com/Aik358/dsh-auto-memory` 全部 **open** 条目 —— **33 个 issue + 9 个 PR = 42 条**，**评论全收**。

## 0. 结论速览

| 项 | 结论 |
|---|---|
| 开放条目 | **42**（33 issue + 9 PR）；仓库累计 276 条 |
| 采集完整度 | 42/42 全文（合计 174,141 B）；评论 11/11；PR 行内 review comments **0**（上游无人写行内评审） |
| 缺陷类 finding | **30 条成立**（含 5 条与历史已关闭条目的余留路径，报告者已如实声明不重开） |
| 非缺陷类 | **3 条**：重构建议 1（#241）、挂起决策项 2（#179 F03 / #201 F26） |
| 成立项是否已修 | **否**。已本地实证：30 条成立项在主线 8280500 == 我们 3.2.10 上**全部仍成立** |
| 修复候选 | **PR #262**（57 commits）与 **PR #279**（60 commits，含 #262 全部） |
| 候选验证 | **326 PASS / 3 FAIL / 0 TIMEOUT**；3 红经判据式归因 ⇒ **判据问题（跨套件残留），非产品缺陷** |
| **落地建议** | **不要整体 merge #279**；按 §6 分批**拆取**，先做 §5 的门禁修复 |

**一句话**：42 条里的 30 条真缺陷**全部真实存在且当前主线未修**；#279 提供了一份高质量修复候选（新增 14 个回归套件且单跑全绿、对 main 可干净合并），但**不能直接合进我们这棵树**（§4），且其打包改动会丢我们 3.2.10 的 12 条排除项（§5.2）。

---

## 1. 基线与取证方式

### 1.1 三条基线

| 名称 | SHA | 说明 |
|---|---|---|
| 上游主线 | `828050056cf053c53fb2c237706f6e89c7baef09` | = `origin/main`，即 **v3.2.10 发布提交** |
| 我们的开发树 | `8445cca8e673`（分支 `wip/20260926-teamwork`） | 发布源；profile 以 `link:` 挂载 |
| 审计者合成基线 | `d5f006a3d7a0abfc85f44ea165581a292c9ecdf5` | = 8280500 + 当时 7 个开放 PR head 的合成 |

### 1.2 本轮最重要的单条基线发现

**我们开发树的 `lib/`（190 个文件）与 `origin/main` 全部逐字节相同。** 取证：对 `lib/` 全量做「取出 blob → CRLF 归一 → sha256 前 16 位」比对，得 `identical=190 / diff=0 / onlyHead=0 / onlyMain=0`。

推论（后续全部结论的地基）：
1. 我们的树**就是** v3.2.10，不存在「本地已悄悄修好」的可能；
2. 审计者在 `8280500 / d5f006a3` 上复现的缺陷，**在我们的树上同样成立**，报告者定位的行号可直接用；
3. 任何修复都必须**新做**。

（顺带澄清两条噪声：`tools/` 我们比 main 多 192 个文件、`python/bench/` 多 26 个，是**开发树独有**的工程件，不是差异缺陷；`tests/` 仅 2 处差异。）

### 1.3 取证方式（每条都真跑，不读代码猜）

- **静态落点确认**：对每条 finding 在声明的文件/行号处 grep 实际源码（`git show HEAD:<file>`），确认缺陷构造在码；
- **修复树两阶段回归**：`D:\_dsh-audit-fix279` = `git worktree` @ `refs/pr/279`（对开发树**零侵入**）；
- **对照实验**：同一命令在旧树（`D:/dsh-auto-memory`）复跑，做红绿归属；
- **打包实证**：对已发布 3.2.10 tarball 与候选包各跑 `tar -tzf` / `npm pack --dry-run --json` 比对清单。

---

## 2. 逐条核查结论（42/42）

图例：**成立** = 缺陷在当前主线可确认；**挂起** = 需产品决策；**建议** = 非缺陷。

### 2.1 并发域（C01–C03，最严重）

| # | ID | 标题 | 结论 | 静态落点（当前 HEAD 实证） |
|---|---|---|---|---|
| 248 | C01 | 笔记状态改写与默认整理缺快照 CAS，删除成功并发追加 | **成立** | `applyNoteStatusPre` 读快照后 `writeFull(notesPath, text)` 不传 `expectedDigest`；`compactLegacyLayer` 跨 await 后整篇覆盖 |
| 249 | C02 | 根目录迁移漏工具与后台写者，成功记忆留旧根不可见 | **成立** | `_saveConfigChecked` 只 drain `_settingsNoteFlights`/`_settingsPlanFlights`；`memory_log`/`memory_user`/沉淀/维护/UI note 未登记 flight |
| 250 | C03 | 通用技能库全快照覆盖另一进程成功写入 | **成立** | `procedure-store.observe → persistedResult → persist` 传完整内存 snapshot；`hub-io.save → atomicWrite` 无跨进程事务锁、无 fresh read、无 delta 合并 |

### 2.2 运行时/生命周期（RL-01–RL-03）

| # | ID | 标题 | 结论 | 静态落点 |
|---|---|---|---|---|
| 251 | RL-01 | apply 挂载失败后未回滚后台计时器并继续写心跳 | **成立** | 5 个 timer（60s feed / 90s boot / 1h notices / 5min retry / 15s heartbeat）在 `ctx.tools.register` 抛错前已建，未进 cleanup stack |
| 252 | RL-02 | client 卸载后全局轮询与 visibility/focus 监听未释放 | **成立** | `client.js:18416` `noticesTimer = setInterval(checkNotices, 3600*1000)` 与 `:18460` `awayPollTimer = setInterval(pollTimeState, 30000)` **无对应 clearInterval**；`removeEventListener('visibilitychange')`/`('focus')` 全仓 **0 处** |
| 253 | RL-03 | 会话销毁未调 Context Host 清理，旧路径快照保留 | **成立（P3）** | `SessionRuntimeStore.dispose` 只清 shadow/activation；`context-host.js:109 pathsByKey` 强引用 Map，生产销毁路径无 `disposeRuntime` |

### 2.3 维护性（MAINT-01/02）

| # | ID | 标题 | 结论 | 静态落点 |
|---|---|---|---|---|
| 254 | MAINT-01 | 日历多行备注保存成功后，下次操作删除备注续行 | **成立** | `parseCalendar`(9493) 逐行解析无续行分支；`renderCalendar`(9513) 拼单行；`calendarAdd`(9545) 只 `String().trim()`；`calendarDone`(9560)/`calendarRemove`(9574) 从解析结果重写整文件 |
| 255 | MAINT-02 | Shadow lexical 排名前截断 64 条，后置高分候选被排除 | **成立** | `lib/shadow-retrieval.js:563` `const hits = rawHits.slice(0, B.rawHits)` —— **在排序之前**（先截断后排序） |

### 2.4 发布/安全（BD-01、SEC-01–03）

| # | ID | 标题 | 结论 | 静态落点与实证 |
|---|---|---|---|---|
| 256 | BD-01 | release 构建必调未交付的 reconcile-upstream.mjs，干净检出无法 dry-run | **成立（P1）** | `origin/main:tools/release.mjs:301` 无条件 `execFileSync(... 'tools/reconcile-upstream.mjs' ...)`；而 **`origin/main` 未跟踪该文件**（`cat-file -e` ⇒ NO），被审计的 `pr247` 也没有。我们树有（开发树独有）⇒ 干净克隆/CI 必 `MODULE_NOT_FOUND` + `exit 1` |
| 257 | SEC-01 | 默认 Tier-0 目录绕过敏感段过滤，把凭据摘要写入自动 prompt | **成立（P1）** | `tier0CatalogEnabled: true`(585) 默认开；`buildTierLayerInjection`(7101-7115) 把 user/project/log/whiteboard/reflection 原文入 sources；`7532-7533` 把 `state.tier0LayerText` **无敏感过滤**拼进最终 prompt；而同方法常规正文路径 `7538/7587/7588` **明确调 `stripSensitiveSections`**（过滤条件见 `12899-12909`） |
| 258 | SEC-02 | 团队 viewer 的本机角色限制未接入配置写入与同步发送 | **成立**（本机 policy drift） | `saveConfig → withConfigLock → _saveConfigChecked` 全程不调团队角色门；`team-sync.makeSender` 只查成员是否存在，role 入 payload 但不用于发送前本机授权。**报告者已诚实补正**：HTTP 白名单确实挡住 `teamMemberRole` |
| 259 | SEC-03 | 迁移导出可包含根外文件 symlink 内容 | **成立（Linux 动态确认）** | `migrateExport`(8738) 用 `en.isDirectory()` 判 symlink，随后 `stat`(8761) 跟随目标、`readFile`(8764)，无 `lstat`/物理边界。**动态证据**：报告者在 Ubuntu/ext4 实跑，旧基线 exit 1，修复版 exit 0 |

### 2.5 观测性（OBS-01/02）

| # | ID | 标题 | 结论 | 静态落点 |
|---|---|---|---|---|
| 260 | OBS-01 | 诊断日志首次轮转后不再轮转，长期运行突破上限 | **成立** | `let _diagRotated = false`(1590)；`if (!_diagRotated) { _diagRotated = rotateDiagLogIfNeeded() }`(1597) ⇒ 首次成功置 true 后**永久跳过**大小检查 |
| 261 | OBS-02 | 定时固化/维护异常被静默吞掉，当日完成标记阻止再次执行 | **成立** | `9712/9715` `_consolidateScheduleDone` 与 `9727/9730` `_maintainScheduleDone` **先置 Done 再 detached 调用**，异常被空 catch 吞；诊断投影无失败回执 |

### 2.6 OCR 信任域（#263/#264）

| # | 标题 | 结论 | 静态落点 |
|---|---|---|---|
| 263 | 记忆准入后目录别名重定向，成功追加写到外部物理目标 | **成立（P1）** | 准入/文件锁通过后，`MemoryDocumentStore._queue` 仍持 **lexical filePath**；readFile→backup→tmp→rename→verify 各阶段重新解析目录别名 |
| 264 | 插件卸载后迟到请求体仍启动 Python venv/pip 安装 | **成立（P1）** | 路由直接登记原始 handler；handler 等 `readJsonBody` 期间卸载已设 `engine._disposed=true`，但**移除 route registration 无法撤回已进入 handler 的请求**；Python setup 未绑定宿主生命周期 |

### 2.7 回归/守卫类（#265–#278）

| # | 标题 | 结论 | 静态落点 |
|---|---|---|---|
| 265 | 群摘要在打印模式或投递失败时仍清空反馈队列 | **成立** | `group-digest.mjs:147` 在 `collect()` 内即 PATCH 清空；而 `NO_SEND` 判定在 **:450**、投递在 **:454-462** ⇒ 打印模式/503 前已清空 |
| 266 | QQ 反馈监听器在建单成功前持久化 seen | **成立** | `group-listener.mjs:87` `seen.add(id); saveSeen()` 在 **:106 建 issue 之前**；失败分支只回 QQ 提示，seen 已持久化 ⇒ 重启后不再重试 |
| 267 | 并发闸门释放测试被任意 release 函数放行 | **成立** | `relFn` 只要求字段名存在 + 全文件出现任意 release 赋值，未绑定「释放器 ↔ 当前字段」 |
| 268 | PLAN 版本冲突副本未验证物理子目录，可写到记忆根之外 | **成立（P1）** | `plan-store.js conflictPlanPre` 用 `path.join(path.dirname(file),'conflicts')` 直接 mkdir/writeFile，无 `physicalChildTarget` 验证 |
| 269 | Python worker health 探测未监听子进程异步 error | **成立（P1）** | `_probeWorkerHealthOnce`(14795) `cpSpawn` 后仅挂 stdout/stderr `data`，**无 child `error` 监听** ⇒ 默认致命策略下终止宿主 |
| 270 | recall_rank 绕过信封结构校验，畸形帧使 sidecar 退出 | **成立** | `worker_semantic_v1.py:1369-1370` `obj_type_ok = ... type == 'recall_rank'`；`if not isinstance(obj,dict) or not (obj_type_ok or base.envelope_shape_ok(obj))` ⇒ 扩展类型**同时绕过其余字段校验** |
| 271 | 插槽排序会覆盖同节点的区域隐藏 | **成立** | `client.js:4553-4554`：`if (it && it.hidden === true) el.style.display='none' else { el.style.display='' }` ⇒ 插槽层仅收到顺序配置时也清空 display |
| 272 | Shadow 审计保留仅在首条事件执行 | **成立** | `shadow-host.js auditSwept` 一次性闩永久挡住后续 retention sweep |
| 273 | 诊断页首次请求失败后永久显示加载中 | **成立** | DebugCenter 首挂只 refresh 一次；catch 存 probes/清 busy 但 data 仍 null → `!data` 早退只渲染 loading；刷新按钮在早退之后 ⇒ 不可达 |
| 274 | facts 全快照持久化覆盖另一进程成功新增 | **成立** | `fact-store.js:732` `io.save(snapshot({includeRevoked:true}))` 整份保存，写事务内不重读、不合并 |
| 275 | 内置 CSS token 守卫用 OR 汇总 fallback | **成立** | 解析器只在「首次出现或当前带 fallback」时更新 Map ⇒ 等价记录「任一引用有 fallback」，混合引用时漏检 |
| 276 | 三面设置 parity 选中冻结块 marker | **成立** | `indexOf('    // ITER5-GENERATED:BEGIN')` **非行锚**，四空格子串命中 legacy 六空格 marker 的后四空格 ⇒ 当前变体切片选错对象 |
| 277 | 撤销优先淘汰夹具在 revoke 前已淘汰目标 | **成立** | 夹具在上限 2 下插第三条即淘汰值1，`revokeBySource('src-old')` 返回 `revoked=0`，断言只验普通年龄淘汰 |
| 278 | 自动接续成功提示关闭后被 3 秒轮询反复重新显示 | **成立** | `client.js:17087-17090` 只要 `lastOk` 在 10min 窗口内就再次 `setAcSt`；`dismissAcSt`(17138) 只清当前显示态，不记「已关闭的 lastOk 身份」 |

### 2.8 历史挂起/决策项（本轮新增证据）

| # | 标题 | 结论 | 本轮新增证据 |
|---|---|---|---|
| **179** | [P1][F03] 工作区目录键把分隔符与连字符折叠为同一值 | **成立，维持挂起** | 报告者 2026-10-07 在 `d5f006a3` 补动态复现：两个真实工作区 `workspaces/foo-bar` 与 `workspaces/foo/bar` ⇒ `projectDirOf` 相同、`notesPath`/`planPath` 指向**同一物理文件**、A 写 B 读。迁移是 fail-closed（存量用户旧桶保留 ⇒ 「记忆看起来消失」），属产品决策 |
| **201** | [P2][F26] Python 文档 token 双重包装与满块截断丢 token | **成立，维持挂起** | 报告者补实测 `build_vectors`：文档输入长度 514、**4 个特殊 token**（首尾各 2）而查询仅 2 个；`丢失正文 ID: [520,521]`。修复代价：`CHUNK_POLICY_VERSION` 升 v2 ⇒ 既有向量全判 stale、**全量重嵌入**（BGE-M3 CPU 分钟级，重建前语义检索拒服务；JS 档零影响） |
| **241** | refactor: 分步整理记忆写入、会话管理和前端请求 | **建议（非缺陷）** | 维护成本改进建议。其评论含三个可直接吸收的观察：①迁移等待未覆盖其他写入口（与 #249 同源）②接续流程状态散落 ③**测试字面断言锁住了 `import` 写法**，重构必连带改测试 |

> #179/#201 是仅存两条**老条目**（2026-10-03 起我方已标记挂起），本轮报告者都补了新证据且都维持「问题仍存在」。

---

## 3. 9 个开放 PR 的处置结论

| PR | 作者 | 内容 | 对 main | 处置建议 |
|---|---|---|---|---|
| **240** | Minervaowl7 | 前端：展开设置透底 + 旧皮肤残留（+619/-149, 25 files） | clean | **拆取**（三面纪律，见 §5.3） |
| **242** | Minervaowl7 | docs：接手手册 393→116 行 | clean | **可合**（文档） |
| **243** | qiqqqqq517 | pack：排除 5 个不可达资产目录（27.42→14.36 MB） | clean | **可合**，需吸收本仓既有排除项（§5.2） |
| **244** | Minervaowl7 | pack：承接 #243 再去旧图与生成源（-3.98 MB） | clean | **可合**，同上 |
| **245** | Minervaowl7 | docs：删 192 个素材文件（-87.69 MB） | clean | **可合**（确认素材可回溯） |
| **246** | Minervaowl7 | docs：架构图 + 修前端指纹检查 | clean | **可合** |
| **247** | Minervaowl7 | 跨进程笔记丢失 / 宿主异常退出 / 语义资源卸载（+429/-106） | clean | **拆取**（与 #248/#251/#253 直接相关） |
| **262** | Minervaowl7 | 全仓审计修复（57 commits, +22807/-1706, 355 files） | clean | **拆取**（#279 的子集） |
| **279** | Minervaowl7 | 同步可靠性 + 运行时边界（60 commits, 368 files） | clean | **拆取**（含 #262 全部） |

**PR 声明抽查（已复算）**：

- **#243 的死资产声明成立**：我独立复核 `lib/skin-assets.js` 的 `SKIN_ASSETS` 只登记 `slots/` 与 `slots-dark/`（9 个文件名），**完全不出现** `backgrounds|elements/|icons/|refs/`；全仓对这四个前缀的引用**全部集中在 `artifacts/pr146-native-ui/asset-provenance-scan.txt` 那份 MISSING 清单里**，无任何代码引用。
- **#243 的打包数字成立**：已发布 3.2.10 tarball 中这 5 个目录共 **68 个文件**（backgrounds 6 + backgrounds-dark 6 + elements 28 + icons 24 + refs 4），`lib/assets/` 合计 82 个 ⇒ 与 PR 声明的 164 文件/14.36 MB 量级一致。
- **#279 的回归数字**：我复跑得 326 PASS / 3 FAIL（§4.2），与其自述 329 的差异来自排除套件与机器负载；FAIL 归因见 §4.3，**非其产品缺陷**。

---

## 4. 修复候选落地可行性（**核心结论：不能整体 merge**）

### 4.1 试合并实测：68 个冲突，含 5 个核心模块 add/add

在独立工作树上执行 `git merge --no-commit --no-ff 8445cca8`（把我们的开发树合入 pr/279）：

冲突文件数 **68**，其中：`lib/index.js`、`lib/client.js`、`lib/context-host.js`、`lib/hub-io.js`、`lib/memory-writer.js`、`lib/m4-corpus.js`、`lib/activation-host.js`、`lib/python-setup.js`、`lib/team-outbox.js`、`lib/config-lock.js`(add/add)、`lib/file-boundary.js`(add/add)、`lib/plan-store.js`(add/add)、`lib/shared-state-lock.js`(add/add)、`lib/global-brief.js`(add/add)、`python/m7_embedding_v1.py`、`python/worker_semantic_v1.py`、`skins/iter5/style-choice.js`、`skins/iter5/surfaces.js`、`skins/legacy/iter5-325.js.frozen`(add/add)、`tests/lib/*`、`tests/smoke/*`、`.gitattributes`、`.gitignore`、`README.md`、`README.zh-CN.md`、`docs/*`、`package.json`。

**冲突根源**：我们与上游的**共同祖先停在 `e951d9eb`**，此后双方各自演进（我们走了 v3.2.1→3.2.10 一整段）。对 **`main` 而言 #279 是 clean 的**（`mergeable=true / clean`）—— 冲突是**我们这棵树造成的**，不是 PR 的问题。

**后果**：`lib/index.js` 冲突 ⇒ 手工解冲突 = 在三万行级文件上做归并，**正是本仓 2026-10-01 红线禁止的操作**。

### 4.2 修复候选实测

在 `D:\_dsh-audit-fix279`（= pr/279，对开发树零侵入）实跑与旧树**同一命令**：

| 树 | 结果 |
|---|---|
| 修复树 pr/279 | **326 PASS / 3 FAIL / 0 TIMEOUT**（329 套件） |
| 旧树 v3.2.10 | **289 PASS / 1 FAIL / 0 TIMEOUT**（290 套件） |

（比 PR 自述少 3 个套件，因我按本仓习惯排除了 `-live / m79-feature-v2 / m710-fv2-emit / c4-fresh-install`。）

**修复树新增的 14 个回归套件，逐个单跑全部 PASS**；连同相关既有套件共 **22/22 PASS**。

**新锁值经复核自洽**：pr/279 内 `iter5-skin` 期望 `1a7a3e66…`、`r26 E3` 期望 `3595370533BC2CD7`，二者**与 pr/279 自身源码一致**（PR 也改了三面），不是过期锁。

### 4.3 3 个红的判据式归因 → **判据问题，非产品缺陷**

| 红 | 真实报错 | 判据 | 结论 |
|---|---|---|---|
| `hub-feed-transaction` | `TypeError: Cannot read properties of null (reading 'procedures')` @`:45` = `engine._scopedProcedureIo.load()` 返 null | 该套件造**具名 junction**（`fs.symlinkSync(workspace, alias, 'junction')`）验 #179 物理身份恢复 | **环境/权限依赖**：junction 在 temp 目录可用性不稳。**单独跑 PASS** |
| `memory-writer-process-lock` | `AssertionError: worker waiting for snapshot` @`:49` | 跨**真实进程**同步（child 等父写快照） | **进程间时序竞争**，负载下不稳。**单独跑 PASS** |
| `reflect` | `Error: reflect test polluted real user memory: --C--Users-JHZ~1-…-dam-test-ISBPN6--` | 断言「真实记忆目录里不得出现测试工作区」 | 残留目录 mtime = **2026-09-23T07:59:50Z**（**14 天前的历史留档**，非本批产生）。它是**断言对象写错了**——应比对「本次运行新增」而非「存在」。**单独跑 PASS** |

**三红共同性质**：**单独跑全 PASS，进批就红** ⇒ 典型「批内残留 + 共享真实资源」判据问题（本仓既有判据：红旗先做归属实验再下结论）。**不构成对 pr/279 产品代码的否决**，但**必须修**（§5.5），否则会反噬我们自己的门禁。

### 4.4 破坏性评估（相对 **main**）

以 `git diff --name-status origin/main refs/pr/279` 计：

- **`lib/` 删除 0 / `python/` 0 / `skins/` 0 / `locale/` 0 / `package.json` 0 / `README.md` 0** ✔
- 删除 **192 个**，**全部**在 `docs/teamwork-impl/`（`concept/_dark-test/` 试验图、`_shots/` 旧截图）
- 新增 75 个（含 `.gitattributes`、`docs/ARCHITECTURE.md`、6 个新 `lib/*.js` 模块）
- 修改 101 个（其中 22 个 `lib/` 文件）

> ⚠️ **一处自我更正**：我一度把「相对我们开发树删除 1084 个文件」当作 merge 的后果 —— **那是错的**。`git diff --name-only A B` 列的是**两棵树的差异**，不等于 merge 会删文件；真实试合并（§4.1）里 `tools/`、`python/bench/`、`artifacts/` **全部保留**。**判 merge 破坏性必须真试合并，不能读 `diff --name-status`。**

### 4.5 结论

**不要整体 merge #279（或 #262）。** 三条理由：
1. **68 冲突**，其中 `lib/index.js`/`lib/client.js`/`file-boundary.js` 等核心文件冲突 ⇒ 手工解冲突即污染性归并（用户红线）；
2. 它**丢掉我们 3.2.10 的全部 12 条 `files` 排除项**（§5.2），直接采用会把约 200 个文档/素材重新打进包；
3. 它自身带 3 个会在批内变红的判据问题（§5.5，非产品缺陷但会反噬门禁）。

**推荐姿势**：以 #279 为**修复参考实现**，按 §6 分批**拆取 hunk / 新文件**落到我们树上，每批走「串行子代理 + Lead 亲自闸门」的既有 SOP。

---

## 5. 落地前必须处理的 5 项

### 5.1 `skins/iter5` 与 `skins/legacy` 被排除：**已定性，无运行时回归**

| | 我们 HEAD（3.2.10） | pr/279 |
|---|---|---|
| `files` | `[lib, python, locale, skins, icon.svg, cordis.patch.yml]` + 12 条排除 | 同上，**但新增 `!skins/iter5` 与 `!skins/legacy`**，并删掉那 12 条 |

**实测（`npm pack --dry-run --json`）**：pr/279 包内 `skins/` 仅 **5** 条（`classic/theme.json`、`README.md`、`v4/{README.md,skin.css,theme.json}`）；已发布 3.2.10 为 **30** 条（含全部 `skins/iter5/*.css` 与 `skins/legacy/iter5-325.js.frozen`）。

**运行时可依赖性判定（已取证）**：`lib/skin-center.js` 的 `SKIN_DIRS` 定义内置层与 `user: 'memory/skins'`；`lib/index.js:1372 readSkinCenterPre` 读 `path.join(dshHome(), SKIN_DIRS.user)` —— **内置皮肤在代码内嵌，装包后不读 `skins/iter5/`**。⇒ 排除 `skins/iter5`/`skins/legacy` **不破坏运行时**（它们是**生成源/开发件**）。

**它顺带排除的 4 张图，逐一核过**：

| 被排除 | 是否当前登记的 slot 资产 | 后果 |
|---|---|---|
| `slots/hero.welcome.png` | `'hero.welcome'` 的 `file` 已是 `slots/hero.native-folio-v1.png` | 旧版图，无 |
| `slots/hero.welcome-memory-v2.png` | 未登记 | 无 |
| `slots/empty.library.png` | `'empty.library'` 的 `file` 已是 `slots/empty.native-document-v1.png` | 旧版图，无 |
| `slots-dark/hero.welcome.webp` | `'hero.welcome'` 的 `fileDark` 已是 `slots/hero.native-folio-dark-v1.png` | 旧版图，无 |

**⇒ 判定**：#279 排除的 4 张图**均非当前登记的 slot 资产**，故**其打包改动本身无运行时回归**；真正要处理的是 §5.2 的并集问题。

### 5.2 `package.json` 的 `files` 必须取并集，不能整段替换

两套 `files` 是不同策略：
- **我们（3.2.10）**：白名单 `[lib, python, locale, skins, icon.svg, cordis.patch.yml]` + 12 条针对性排除（挡 `docs/internal`、`ui-demo-*`、`ui-redesign-*`、`teamwork-impl/concept`、`_shots`、`skin-figures/*.gif`、`**/*.bak*`、`**/*.tmp`、`lib/*.*.*` 等）；
- **pr/279**：删掉上述排除，改为目录排除（`lib/assets/skin/{backgrounds,backgrounds-dark,elements,icons,refs}`、`skins/iter5`、`skins/legacy`）+ 4 张具体图，保留 `!lib/*.*.*`。

**并集方案**：保留我们的 12 条，**追加** #243/#244 的 5 条资产目录排除 + 4 张旧图排除；`skins/iter5`/`skins/legacy` **本版继续随包**（3.2.10 已如此发布，无必要变更）。
**验收**：`npm pack --dry-run --json` ⇒ 包内 `lib/assets/skin/{backgrounds,backgrounds-dark,elements,icons,refs}` 条目数为 **0**，且 `SKIN_ASSETS` 登记的全部资产**逐个仍在包内**（清单须由脚本**从 `lib/skin-assets.js` 源码派生**，不手抄）。

### 5.3 本仓纪律检查（拆取时逐条过）

| 红线 | 对 #279 的影响 |
|---|---|
| **前端禁止社区 merge 式重构**（2026-10-01 用户警告） | #279 改 `lib/client.js` + `skins/iter5/{style-choice,surfaces}.js` + `skins/legacy/iter5-325.js.frozen`（三面）⇒ **必须拆取 + 三面同改，不得整块替换** |
| **三面同改纪律** | `settings-parity` 校验三面字段数；只改一面必红 |
| **计数锁/守卫常量改动须全仓检索** | #279 改了 `iter5-skin` 与 `r26 E3` 期望值 ⇒ 需全仓（含 `docs/`、`tools/`、推广素材）检索后重钉；重钉必须**复用套件自身的剥离表达式**，不得另写简化版 |
| **默认值变更固定形态** | 若涉及配置默认值 ⇒ 必须走「新增档位键 + 版本守卫键 + 迁移函数挂 `_loadConfigSyncLocked`」，不能直改默认值 |
| **生成器硬护栏** | 新增 6 个 `lib/*.js` 模块需同步 `tools/build-iter5-skin.mjs` 的 `replaceMigrated` 语义 |
| **`.gitattributes` / `.gitignore` 改动** | #279 顶掉了我们 `.gitattributes` 里的 m3b1 CRLF 夹具契约与 `skins/legacy/*.frozen` 规则、以及 `.gitignore` 的 issue #166/#211 结构性规则 ⇒ **必须并集，不能整文件替换** |

### 5.4 需要用户拍板的 2 个决策项

1. **#179（F03）工作区目录键迁移**：方案已明确（sha256 v2 + `owner` 标记迁移），但迁移 fail-closed ⇒ 存量用户升级后**旧桶保留不迁移**，会出现「记忆看起来消失 + 每轮迁移提示」，直到逐桶确认归属。**需你定：升级时机 + 确认交互。** 报告者本轮补的动态证据很硬（两个合法路径 ⇒ 同一物理文件，A 写 B 读），风险随用户量上升；#279 已给出实现（`lib/workspace-directory.js` + UI 展示 `legacyDir`/恢复方法）可作参考。
2. **#201（F26）Python 文档 token 包装**：`CHUNK_POLICY_VERSION` 升 v2 ⇒ 既有向量全判 stale、**全量重嵌入**（BGE-M3 CPU 可达分钟级，重建前语义检索拒服务；JS 档零影响）。**需你定：发布说明口径 + 是否接受一次性重嵌入成本。**

### 5.5 修掉 #279 的 3 个判据问题（否则会反噬我们的门禁）

1. `hub-feed-transaction`：把 junction 可用性做成**前置断言 + skip 说明**，或改用可注入的物理目标解析，避免依赖 OS junction；
2. `memory-writer-process-lock`：把「child 等父写快照」从**墙钟等待**改成**有界可重试轮询 + 明确失败信息**；
3. `reflect`：污染断言从「真实记忆目录**存在**测试工作区」改为「**本次运行前快照 vs 运行后快照的差集**」；并顺手清掉那份 2026-09-23 的历史残留目录。

---

## 6. 建议施工顺序（拆取，非 merge）

> 按本仓既有 SOP：**串行子代理 + Lead 亲自闸门**（`docs/internal/REPAIR-ORCHESTRATION-SOP.md`），每批一个 commit。

| 批 | 内容 | 来源 | 为何这个顺序 |
|---|---|---|---|
| **B0** | 修 §5.5 三个判据问题；`package.json files` 取并集（§5.2） | #279 + 本文件 | 先把门禁修干净，后续批次的红才可信 |
| **B1** | 并发域：C01(#248) / C02(#249) / C03(#250) + #274 | #279 `memory-mutation-transaction.js` / `procedure-snapshot-transaction.js` / `workspace-directory.js` | P1 且互相耦合 |
| **B2** | 安全域：SEC-01(#257) / SEC-02(#258) / SEC-03(#259) / OCR(#263#264) | #279 `injection-policy.js` / `team-policy.js` | P1，独立文件，风险可控 |
| **B3** | 生命周期：RL-01(#251) / RL-02(#252) / RL-03(#253) / #269 | #279 的 apply cleanup stack + client `ctx.effect` | 与 #226 同族，一起收口 |
| **B4** | 观测+维护：OBS-01(#260) / OBS-02(#261) / MAINT-01(#254) / MAINT-02(#255) / #268 / #270 / #272 | #279 | P2/P3 |
| **B5** | **前端线（单独走三面纪律）**：#271 / #273 / #278 + PR#240 | #279/#240 | 必须过 `--check --strict` + 真执行 factory 的运行时守卫 |
| **B6** | 守卫修复：#267 / #275 / #276 / #277 | #279 | 纯测试判据，风险最低 |
| **B7** | 发布工程：BD-01(#256) | 需自备 `tools/reconcile-upstream.mjs`（我们树有） | 影响发版闸门 |
| **B8** | 决策项 #179 / #201 | 待拍板 | 不阻塞前 8 批 |

**每批完成判据**（沿用 SOP）：① `node tools/build-iter5-skin.mjs --check --strict` SYNC-OK（涉前端批）② `node --check` 全绿 ③ 全量 smoke `FAIL 0 / TIMEOUT 0` 且计数 ≥ 基线 + 本批新增 ④ `git log -1` 验 commit message 点名该批 ⑤ 关键落点 grep 抽验「修复在码」。

---

## 7. 本轮取证的可复算清单

| 结论 | 复算方式 |
|---|---|
| `lib/` 190 文件与 main 逐字节相同 | 对 `lib/` 全量 `git show <ref>:<file>` → CRLF 归一 → sha256 逐文件比对；得 `identical=190 / diff=0` |
| #256 成立 | `git cat-file -e origin/main:tools/reconcile-upstream.mjs` ⇒ **NO**；而 `origin/main:tools/release.mjs:301` 调它 |
| #252 成立 | `git show HEAD:lib/client.js` 内 `clearInterval(noticesTimer)` / `clearInterval(awayPollTimer)` / `removeEventListener('visibilitychange')` 检索均为 **false** |
| #257 成立 | `7532-7533` 无过滤推 `tier0LayerText`；`7538/7587/7588` 同方法**有** `stripSensitiveSections` |
| #243 死资产 | `SKIN_ASSETS` 只含 `slots/`+`slots-dark/`；四前缀引用**只在 `artifacts/` 的 MISSING 清单**；tarball 里 5 目录共 68 文件 |
| 修复树 326/3/0 | `D:\_dsh-audit-fix279` + `node tools/run-smoke.mjs --jobs=1 --timeout=90000 --exclude=-live --exclude=m79-feature-v2 --exclude=m710-fv2-emit --exclude=c4-fresh-install` |
| 3 红 = 判据问题 | 同上套件**单独跑**全 PASS；`reflect` 残留目录 `mtime=2026-09-23T07:59:50Z` |
| 68 冲突 | 在 `refs/pr/279` 工作树上 `git merge --no-commit --no-ff 8445cca8` |

**原始素材**：`.diag-issues20261007/`（`raw.json` 330 KB 全量正文+评论、`list-all.json` 276 条索引、`fix-smoke-serial.log` / `clean-fix.log` / `clean-old.log` 回归日志、`attribution.json`）。诊断目录为 untracked，不入库。

---

<!-- 生成于 2026-10-07 · 只读核查，未改动任何产品代码 -->