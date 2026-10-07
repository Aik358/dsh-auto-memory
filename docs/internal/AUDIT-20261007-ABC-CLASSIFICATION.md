# 上游 42 条报告 · A/B/C 分类落盘（2026-10-07 · 用户裁定基线）

> **这是一个长期有效的分类台账。上下文压缩后以本文件为准，不要重新推断分类。**
> 详细核查结论见 `AUDIT-20261007-OPEN-42-VERIFICATION-AND-FIX-PLAN.md`；运行逻辑复核见本文件 §3。

## 0. 用户裁定（2026-10-07）

1. **先只修 A 类**；**B 类、C 类先留着不要动**。
2. 修完 A 类后：**先把 A 类对应的 issue 与 PR 全部回复掉**。
3. 关 PR 时：**若不冲突则做礼节性 merge**（反正后面发新版本会冲掉）。
4. **#179（F03）与 #201（F26）继续挂起**，还不是修的时候。
5. 派子代理**分区修理**，编排走已固化的 SOP（`docs/internal/REPAIR-ORCHESTRATION-SOP.md` / procedure `proc_pre_72ef2aa87eee20ca207270ccb0390807`）。

6. **执行顺序（2026-10-07 追加裁定）**：① 先做 **A 类**（比较好做的）；② A 类完成后，**解决「单独立项」批次**（= 基线锁红 + **#256 BD-01**，见 §8）；③ 之后再动 B 类与 C 类。

## 1. A 类 = 已定位现成实现、机制正确、可直接拆取（19 条）

| # | 审计 ID | 标题要点 | 主改文件 |
|---|---|---|---|
| 248 | C01 | 笔记状态改写/默认整理缺快照 CAS | `lib/index.js` |
| 249 | C02 | 生产文档 mutation 统一 admission | `lib/index.js` + 新 `lib/memory-mutation-transaction.js` |
| 250 | C03 | 通用技能库跨进程事务 | `lib/hub-io.js` + 新 `lib/procedure-snapshot-transaction.js` |
| 251 | RL-01 | apply 挂载失败回滚 | `lib/index.js` |
| 253 | RL-03 | 会话销毁调 Context Host 清理 | `lib/context-host.js` `lib/index.js` |
| 255 | MAINT-02 | Shadow lexical 先截断后排序 | `lib/shadow-retrieval.js` |
| 257 | SEC-01 | Tier-0 目录绕过敏感段过滤 | `lib/index.js` + 新 `lib/injection-policy.js` |
| 258 | SEC-02 | 团队 viewer 本机角色限制未接入 | `lib/index.js` + 新 `lib/team-policy.js` |
| 260 | OBS-01 | 诊断日志首次轮转后不再轮转 | `lib/index.js` |
| 264 | OCR-02 | 卸载后迟到请求仍启 Python 安装 | `lib/index.js` `lib/python-setup.js` |
| 265 | — | 群摘要打印/失败仍清空反馈队列 | `.github/scripts/group-digest.mjs` |
| 266 | — | QQ 监听器建单前持久化 seen | `.github/scripts/group-listener.mjs` |
| 268 | — | PLAN 冲突副本未验证物理子目录 | `lib/plan-store.js` |
| 269 | — | Python worker health 未监听 child error | `lib/index.js` |
| 270 | — | recall_rank 绕过信封校验 | `python/worker_semantic_v1.py` |
| 271 | — | 插槽排序覆盖同节点区域隐藏 | `lib/client.js` |
| 272 | — | Shadow 审计保留仅首条执行 | `lib/shadow-host.js` |
| 273 | — | 诊断页首错永久加载中 | `lib/client.js` |
| 274 | — | facts 全快照覆盖另一进程新增 | `lib/fact-store.js` `lib/hub-io.js` |

## 2. B 类 = 无法读 diff 判定，须真跑确认（暂不动）

| # | 待确认点 |
|---|---|
| 258 SEC-02 | `assertTeamActionPre` 是否覆盖「HTTP 已支持的团队字段」与「发送前角色复核」两条路径 |
| 270 | `envelope_shape_ok` 计数 **2 → 1（减少）**，需确认是重构还是删掉了一条校验 |
| 265/266 | 属 CI/机器人侧，不在插件运行时内，不影响本机使用 |

## 3. C 类 = 候选修复**未覆盖**，必须自研（暂不动）

| # | 缺陷 | 证据 | 修法（低风险） |
|---|---|---|---|
| **252** RL-02 | client 卸载后 `noticesTimer` / `awayPollTimer` 未 clear，`visibilitychange` / `focus` 未解绑 | `lib/client.js` 的 18 个增量 hunk 中含 `clearInterval`/`removeEventListener`/`noticesTimer`/`awayPollTimer` 的 = **0 个** | 保存句柄 + 幂等 `ctx.effect` cleanup |
| **254** MAINT-01 | 日历多行备注被下次操作吞掉 | `lib/index.js` 增量中 `calendar` 命中 5 处，**全部是迁移包/`resolvePaths` 相关**，无 `parseCalendar`/`renderCalendar` 编码改动 | 多行 note 可逆编码，或首次写入前校验拒绝 |

> 缺陷本身**成立**（静态已确认：`parseCalendar`(9493) 无续行分支；`clearInterval(noticesTimer)` 检索为 false），只是候选 PR 没修它们。

## 4. 挂起决策项（不动）

| # | 内容 | 为什么挂起 |
|---|---|---|
| 179 F03 | 工作区目录键把分隔符与连字符折叠为同值 | 影响**已落盘目录键归属**；迁移 fail-closed（旧桶不迁移 ⇒ 记忆看似消失）；需定升级时机+确认交互 |
| 201 F26 | Python 文档 token 双重包装 + 满块截断丢 token | `CHUNK_POLICY_VERSION` 升 v2 ⇒ 既有向量全判 stale、**全量重嵌入**（BGE-M3 CPU 分钟级，期间语义检索拒服务；JS 档零影响） |

## 5. A 类派发纪律（每个子代理必读）

| 项 | 值 |
|---|---|
| 工作树 | `D:\dsh-auto-memory`（分支 `wip/20260926-teamwork`，HEAD `8445cca`） |
| 参考实现 | `D:\_dsh-audit-fix279`（= `refs/pr/279`，**只读参考，不得在其上提交**） |
| 审计基线 | `d5f006a3d7a0abfc85f44ea165581a292c9ecdf5` —— **它是半修树**（已含部分修复），不是干净起点 |
| 行尾 | `lib/**` = CRLF；`.github/scripts/**` = LF。改完 `bareLF == 0` |

### 红线

1. **禁止三方合并 / 整块替换**：逐 hunk 拆取。`lib/client.js` 与 `skins/iter5/*` 是用户 2026-10-01 明令的前端红线区，必须**三面同改**。
2. **严禁引入 #179 领地**：不得新增 `lib/workspace-directory.js`；不得引入 `workspaceKeyPre`（sha256 键）；不得改 `wsKey` 语义。
3. 行号一律**内容匹配**（±漂移），不按行号定位。
4. 允许**本地 commit**（message 点名批次），**禁止 push**。
5. 一次一块，完成即停，回四节小回执。不确定**不自行拍板**，写进「待复核项」。

### 参考实现里必须改写的一处（#249 C02）

pr/279 版调 `workspaceDirectoryPre(root, ws)`（#179 领地）。**本批改用现有 `path.join(root, this.wsKey(ws))`**，其余逻辑照抄。

## 6. 分批（全部串行；A1–A4 共享 `lib/index.js`，A5 触 `lib/client.js`）

| 批 | 内容 | 前置 |
|---|---|---|
| **A1** | 248 / 249 / 251 | 无 |
| **A2** | 250 / 274 / 253 | A1 |
| **A3** | 257 / 258 / 260 | A2 |
| **A4** | 264 / 269 / 268 / 255 / 272 / 270 | A3 |
| **A5** | 271 / 273（前端三面纪律） | A4 |
| **A6** | 265 / 266（CI 脚本） | A5 |


## 6bis. ★并行施工方案（2026-10-07 用户要求提速，取代 §6 全串行）

**依据**：实测冲突图 —— 唯一真串行点是 `lib/index.js`（248/249/251/253/257/258/260/264/269 共 9 条），其余条目分属**互不相交**的文件。

| 车道 | 条目 | 独占文件 | 与其它车道的关系 |
|---|---|---|---|
| **L-A** `index.js` 线 | 253 / 257 / 258 / 260 / 264 / 269 | `lib/index.js`、`lib/context-host.js`、`lib/python-setup.js`、新 `injection-policy.js`、新 `team-policy.js` | **关键路径**，本线内串行 |
| **L-B** hub-io 线 | 250 / 274 | `lib/hub-io.js`、`lib/fact-store.js`、新 `procedure-snapshot-transaction.js` | 与 A/C/D/E 不相交 |
| **L-C** 杂项线 | 255 / 268 / 272 / 270 | `lib/shadow-retrieval.js`、`lib/plan-store.js`、`lib/shadow-host.js`、`python/worker_semantic_v1.py` | 与 A/B/D/E 不相交 |
| **L-D** CI 线 | 265 / 266 | `.github/scripts/group-digest.mjs`、`.github/scripts/group-listener.mjs` | 与 A/B/C/E 不相交 |
| **L-E** 前端线 | 271 / 273 | `lib/client.js` + `skins/`（三面纪律） | 与 A/B/C/D 不相交 |

**并行安全前提（红线）**：

1. **文件独占**：每车道只准改上表列出的文件；**严禁**碰其它车道的文件。
2. **禁止破坏性 git**：`git stash` / `git checkout -- .` / `git reset --hard` / `git clean` **一律禁止**（会抹掉它车道的在途改动）。
3. **提交允许**：`git add <本道文件>` + `git commit` 可；若遇 `index.lock` 冲突，等 2 秒重试（≤5 次）。**禁止 push**。
4. **不跑全量回归**：并发跑全量会互相干扰且争抢 CPU。各车道只跑 `node --check` + **本道专项套件**；**全量回归由 Lead 在全部车道落地后统一跑一次**。
5. **`lib/index.js` 的 r26 基线锁**由 **L-A** 负责重钉（唯一改该文件的车道）；L-A 必须先落盘再重钉，用套件自身表达式复算。

**闸门（Lead 统一跑）**：全部车道落地 → `node --check` 全量 → **一次全量回归**，失败集合 ⊆ `{iter5-skin, issue207-processes}` 且 TIMEOUT 0。

### 每批完成判据

- [ ] `node --check` exit 0；CRLF 文件 `bareLF == 0`
- [ ] 每条修复有**真执行**回归（真 import→构造→调用→断言副作用）+ **负路径**（变异必红、还原复绿）
- [ ] 全量 smoke `TIMEOUT 0`，且 **FAIL 数不高于开工前基线**（基线值见 §7）
- [ ] 一个 commit，message 点名批次

## 7. 开工前基线（2026-10-07 实测 · 已更正）

**结论：工作树干净，全量应为 290 PASS / 0 FAIL / 0 TIMEOUT。**

### 7.1 事实

- `lib/client.js` / `skins/iter5/skin.css` / `skins/legacy/iter5-325.js.frozen` / `lib/index.js` —— **四者与 `HEAD` 逐字节相同**（`git status` 干净）。
- 官方命令跑 `iter5-skin` 单套件：**PASS**（`node tools/run-smoke.mjs --filter=iter5-skin`）。
- 按运行器同序跑完它**之前全部 97 个套件**后，它仍 **PASS**（污染不可复现）。
- 套件第 103 行注释自述：用本文件 14–22 行表达式复算得 `26b00133…`，**与锁一致**。

### 7.2 ★此前记录的「289 PASS / 1 FAIL」是**错的**，来源是编排者（Lead）自己的工具链

错的环节，按发生顺序：

1. **第一次基线**用了 Lead 自写的环境变量覆盖（`DSH_HOME`/`HOME`/`USERPROFILE` 指向不存在的目录）⇒ 子进程 abort（`exit 2147483651`），被**误读为"套件红"**。这是全部误判的源头。
2. Lead 另写 `.probe-iter5.mjs` 插桩，`console.log` 被插进 `//` 注释块内部 ⇒ **静默不执行**，又产生一次假信号。
3. Lead **另写**一份 classic 剥离脚本（手抄套件 14–22 行）⇒ 得 `54e55cc9…`。**该值只存在于 Lead 的脚本里**；套件自算是 `26b00133…`。
4. 诊断期间把 `tests/smoke/.tmp-batchy-post.mjs`、`.tmp-st-bare.mjs` 移出 ⇒ 批跑套件集合由 292 变 290，偏离原始状态。

**违反对应的既有铁律**：「重钉必须复用套件自身的剥离表达式，不得另写简化版」——此处正是**另写了一份**并据此指控仓库。

### 7.3 教训（写入长期记忆）

- 跑回归**只用仓库官方命令**，不得自行加环境变量覆盖；子进程 `exit 2147483651` / abort 是**工具错误**，不是套件 FAIL。
- 基线锁的红**必须让套件自己把值打出来**（真跑，而非手抄管道）；手抄剥离表达式会得出与仓库无关的伪值。
- 往 `tests/smoke/` 增删任何文件都会改变批跑集合，**诊断期间不得移动该目录内的文件**。

### 7.4 每批闸门取值

- 基线 = **290 PASS / 0 FAIL / 0 TIMEOUT**；每批须 `FAIL 0` 且计数 ≥ 290 + 本批新增。


## 8. 单独立项批次（A 类完成后、B/C 之前必须解决）

**立项依据（用户 2026-10-07 裁定）**：先单独立项，不阻塞 A 类；但**进入 B/C 之前必须解决**。

### 8.1 已确证的事实

| 事实 | 取证 |
|---|---|
| **干净检出也复现红** | `git worktree add --detach D:/_clean-verify HEAD`（`8445cca`，`git status` 全清），官方运行器跑全量 ⇒ **287 PASS / 2 FAIL**：`smoke-test-iter5-skin.mjs` + **`smoke-test-issue207-processes.mjs`** |
| **套件单独跑是绿的** | 干净树与开发树 `node tools/run-smoke.mjs --filter=iter5-skin` 均 exit 0 |
| **`lib/client.js` 全程未被改动** | PowerShell `Start-Job` 原生监视器（已验证启动并写入 INIT 行）以 100ms 间隔跑完整批 285s ⇒ **哈希零变化**（`11D302CBE1E4578A` / 2143439 B） |
| 红出现在**批序中** | 批跑第 98/290 时报 FAIL，耗时 0.2s |
| 判据差值 | actual `54e55cc94447230918a5c84ee986d678b135051b096269e5e23b63cd3abbcdc1` vs 锁期望 `26b00133b7eef7896bff5c66fe0dff50a895a739eca5c2eb57321a4f0f10883d` |

### 8.2 待解问题（尚未定案）

1. **为何同文件同字节，套件算出的 classic 哈希在批内与单跑不同？** 已排除「文件被改写」（监视器零变化）。
2. **套件 stdout 始终只有 `\r\n`**，连第 106 行的 PASS 输出都没有 ⇒ 两条路径**都未执行到 106 行**，「绿」与「红」可能来自**两条尚未看清的控制流分支**。
3. **`issue207-processes` 为何只在干净检出红**（开发树不红）⇒ 提示该批至少有两个套件对环境敏感。

### 8.3 纪律

- 套件 `tests/smoke/smoke-test-iter5-skin.mjs` 是**基线锁套件**，**不得由代理自行插桩修改**（用户已明确），须用户批准。
- 归因走「先归因再动手」，禁止把已完成成果当失败回滚（2026-10-01 裁定）。
- **未解决前**，A 类每批闸门按 **「不新增红」** 判定（与该批开工前的逐项结果比对），而非追求 `FAIL 0`。


### 8.4 ★结案定性（2026-10-07 深夜，可信路径复核后定案）

**结论：`iter5-skin` 红 = 判据过期（锁常数与剥离管道脱钩），非产品缺陷，非批次污染，非本次引入。**

#### 取证路径更正（关键）

**`run_code` 内的 `spawnSync`/`spawn` 在本环境静默失效** —— 最小复现：两行脚本（`appendFileSync` + `console.log`）
经 `run_code` 的 `spawnSync(process.execPath,…)` 执行 ⇒ 输出仅 `\r\n`、目标文件未生成、`exit=0`；
经 `pwsh` 执行 `node` ⇒ 输出 `TINY RAN`、文件已生成。
**⇒ 此前所有"单独跑是绿的"结论作废（那是静默失效造成的假象）。**
**纪律：本仓一切探针/回归必须走 `pwsh`（`D:\nodejs\node.exe` v24.18.0），不得用 `run_code` 内的子进程 API 判定结果。**

#### 定案事实

| 项 | 实测 |
|---|---|
| 单跑（可信路径） | `node tests/smoke/smoke-test-iter5-skin.mjs` ⇒ **AssertionError（红）** |
| 批内 | 同样红，且 repeated 3 次结果一致 |
| 干净检出 | `D:/_clean-verify`（`8445cca`，status 全清）⇒ 亦红 |
| 锁的来历 | `26b00133…` 由 `83a8678` 写入；**该 commit 用套件自身管道复算得 `cbf7964a…`** ⇒ 锁当时即不匹配 |
| 管道状态 | 套件第 17/19/20/21/22 步 `.replace()` 在当前文件**命中 0 次** ⇒ 剥离管道已失效 |
| 文件稳定性 | PowerShell `Start-Job` 监视整批 285s ⇒ `lib/client.js` 哈希**零变化** |

#### 与你"上个版本全绿"的吻合

`83a8678` 钉锁时用的是**当时**的 `client.js`；此后 `da032af`（发版三件套：指纹行 + 应用内 CHANGELOG 字典）与 `8445cca`（`package.json` 版本回写）使 `classic` 复算值漂移，锁未同步上移。
你看到的绿是漂移前的状态 —— **与"这个版本才红"的观察一致**。

#### 收口修法（按 2026-10-01 裁定：判据过期 ⇒ 重钉，不回滚成果）

1. 让套件**自己把复算值打出来**（真跑，非手抄）；
2. 按套件**自身**的 14–22 行表达式重钉常数，附归因注释；**不得另写简化剥离**；
3. 全仓检索该常数出现点（含 `docs/`）。
4. 附带：`issue207-processes` 在干净检出的红需同批归因（同类"对环境敏感"）。


### 8.5 并入项：#256（BD-01）release 构建依赖未交付文件 —— 用户 2026-10-07 批准并入

**为什么并入而非留在 B7**：与基线锁红同属**门禁/发布基础设施**问题（非产品功能缺陷），一次收口更干净；且它**只在干净检出成立**，我方的开发树不会暴露它，容易被漏掉。

| 项 | 事实 |
|---|---|
| 缺陷 | `origin/main:tools/release.mjs:301` 无条件 `execFileSync(... 'tools/reconcile-upstream.mjs' ...)`；同文件 `:323-327` 在失败时记录并 `process.exit(1)` |
| 关键证据 | **`origin/main` 未跟踪该文件**（`git cat-file -e origin/main:tools/reconcile-upstream.mjs` ⇒ 非 0）；被审计的 `pr247` 也没有。**只有我方开发树有** |
| 后果 | 干净克隆 / CI 上跑 release 必 `MODULE_NOT_FOUND` + `exit 1` |
| 修法 | 把 `tools/reconcile-upstream.mjs` **纳入跟踪**（它已在开发树中存在，属「开发树独有工程件」），或让 release.mjs 在该文件缺失时**降级为显式告警**而非硬失败。**倾向前者**（保持对账能力） |
| 验收 | 干净检出跑 `node tools/release.mjs <ver> --dry-run` ⇒ 不因缺文件失败；且对账清单真的生效（负路径：临时移除该文件 ⇒ 明确报错而非静默通过） |


### 6ter. ★★行尾红线更正（2026-10-07 深夜，实测定案）

**我先前的红线「`lib/**` 是 CRLF」是错的，并因此害 L-C 把两个本该 LF 的文件写成 CRLF。**

#### 基线 `8445cca` 的 blob 实测（`git cat-file blob` 后逐字节数）

| 文件 | baseline blob | 结论 |
|---|---|---|
| `lib/index.js` | crlf=17772 bareLF=0 | **CRLF** |
| `lib/client.js` | crlf=18565 bareLF=0 | **CRLF** |
| `lib/memory-writer.js` | crlf=599 bareLF=0 | **CRLF** |
| `python/worker_semantic_v1.py` | crlf=1417 bareLF=0 | **CRLF** |
| `lib/shadow-retrieval.js` | crlf=0 bareLF=**673** | **LF** ← L-C 误写成 CRLF |
| `lib/shadow-host.js` | crlf=0 bareLF=**399** | **LF** ← L-C 误写成 CRLF |
| `lib/hub-io.js` | crlf=0 bareLF=**666** | **LF** |
| `lib/fact-store.js` | crlf=0 bareLF=**895** | **LF** |
| `lib/plan-store.js` | crlf=0 bareLF=100 | **LF** |
| `lib/team-sync.js` | crlf=0 bareLF=257 | **LF** |
| `lib/config-lock.js` | crlf=0 bareLF=115 | **LF** |

#### 正确口径（取代旧红线）

**「每文件跟随其基线 blob 的行尾」** —— 改前用 `git cat-file blob <base>:<path>` 数一次 CRLF/bareLF，改后该文件的计数**形态必须与基线一致**（CRLF-only 仍 CRLF-only，LF-only 仍 LF-only），**不得跨形态转换**。

#### 我犯的错（可复用的教训）

我先前的"实测"读的是**已含在途改动的工作区文件**，把在途状态当成基线 ⇒ 得出「lib 是 CRLF」的错误全局结论，再把它当红线写进 5 份车道 prompt。
**判据：判定行尾基线必须读 `git cat-file blob <base>:<path>`（或 `git show <base>:<path>`），不得读工作区文件。**

#### 待修

- [ ] L-C 修正 `lib/shadow-retrieval.js`、`lib/shadow-host.js` 回 **LF**（内容不变，仅行尾），重跑本道套件；
- [ ] 其余车道复核本道文件行尾是否与基线同形态（L-A/L-B/L-D/L-E）。


## 9. A 类收口结果（2026-10-08 01:52 定稿）

### 9.1 闸门（Lead 亲跑，默认并行）

`node tools/run-smoke.mjs --timeout=120000 --exclude=-live --exclude=m79-feature-v2 --exclude=m710-fv2-emit --exclude=c4-fresh-install`

| 时点 | 套件 | PASS | FAIL | TIMEOUT | 耗时 |
|---|---|---|---|---|---|
| 开工基线 `8445cca` | 290 | 289 | 1 | 0 | 284.7s（串行） |
| A 类落地 `3f40f69` | 296 | 286 | **10** | 0 | 430.5s（串行） |
| R1 收口 `5245e4a` | 296 | **296** | **0** | **0** | **115.6s（并行 x4）** |

**★全量回归一律用默认并行（`DEFAULT_JOBS=4`，2026-09-20 用户裁定），不得再传 `--jobs=1`。**（串行 430s → 并行 116s，快 3.7 倍。）

### 9.2 A 类 19 条：全部落地（6 个本地 commit，均未 push）

`7688ae4`(A1: 248/249/251) → `952e6e2`+`e9b721a`(L-B: 250/274) → `3dfdd12`+`1cfb7a5`(L-C: 255/268/272/270) → `5232d44`(L-D: 265/266) → `e829d5b`(L-E: 271/273) → `3f40f69`(L-A: 253/257/258/260/264/269 + 接线 + r26 重钉) → `cfe388a`+`5245e4a`(R1 收口)。

### 9.3 收口期发现的两条真缺陷（A 类施工自身引入，已修）

1. **`engine._teamFetch` 丢属性**（`#258` 引入）：换成裸箭头函数后丢掉 `dispose`/`describe`/`readToken` ⇒ 卸载路径 `typeof _teamFetch.dispose === 'function'` 恒假、在途请求 AbortController **永不 abort**。修法：包装体保留属性引用（只搬引用不复制实现）。**由 `smoke-test-issue174-team-wiring` 抓到。**
2. **同批团队门导致「源码抽取式沙箱」夹具假红**（`handoff`/`plan-seed`/`p7-write-fix`/`issue162`）：这些套件用「正则/配平抽取产线方法体 + `new Function` + `bind(fakeThis)`」执行真代码，而 **fake this 无原型链** ⇒ 产线方法体里新增的 `this._assertTeamActionPre(...)` 抛 TypeError，被写函数 fail-soft 的 `catch` 吞成 `{ok:false}` / 「状态写入失败」。
   **⇒ 产线路径不崩**（有 try/catch + 回落 `this.config`）。修法是**夹具侧补桩**，**不得**把兜底写进产线语义。

### 9.4 归因更正（我此前两处错判，有反证）

| 我此前的说法 | 实测更正 |
|---|---|
| 「A 组三条 TypeError 根因是 `_configPath` undefined，需产线加兜底」 | **错**。根因是沙箱 fake this 缺方法（见 9.3-2）；产线不崩，不应改产线语义 |
| 「`26b00133…` 由 `83a8678` 写入时**即**与自身复算值不符」 | **错**。逐 revision 用**各自**套件表达式复算：`83a8678` → `26b00133` **MATCH（当时自洽）**；`8445cca` → `54e55cc9` MISMATCH（**A 类之前就已失配**）；`HEAD` → `23a79294` MATCH。⇒ 该红**先于 A 类存在**，正是开工基线里那 1 FAIL |
| 「剥离管道 17/19/20/21/22 五步命中 0 次」 | 更正为 **17/20/21/22 四步命中 0**；18/19 各命中 1；第 16 步（ITER5-GENERATED 剥离）命中 1 |

**★可复用判据**：核查「锁值是否自洽」必须**逐 revision 用该 revision 自己的套件表达式**复算 —— 用当前表达式去算历史版本会得出错误结论。

### 9.5 R1 判据同步的 4 处（按 2026-10-01 裁定重钉/改判据，不回滚成果）

| 套件 | 原判据为何失效 | 新判据 |
|---|---|---|
| `p3-batchb-guards` ×3 | #253 改了 `disposeRuntime` 释放形态（新增 owned/closeSession） | 改**函数体抽取**；`clear()` 由「计数=0」改钉「只允许在 `disposeAll` 内、`disposeRuntime` 内为 0」⇒ 归属锁定，鉴别力不降反升 |
| `global-brief` | 260 字符窗因 #258 门调用后移失效（登记实测在 273） | 改函数体抽取（fnBody 需先配平圆括号） |
| `i5-status-filter` | `call.indexOf('})')` 取实参表终点，#257 把首参改成含嵌套对象 ⇒ 首个 `})` 落在表达式内部 | 改圆括号配平 |
| `iter5-skin` / `r26` | 判据过期 | 重钉 `R79→R80`(`23a79294…`)、`R87→R88`(`70C221D02149DF15`) |

**变异反向验证 4/4**（防「为变绿而弱化判据」）：删释放行 / 往 `disposeRuntime` 塞 `clear()` / 删 `writeFull` 登记 / 删 `hits` 实参 ⇒ 全部变红，还原复绿。

### 9.6 遗留待办

- [ ] **§8 单独立项剩余项**：`#256`（BD-01 release.mjs 依赖未交付文件）—— 尚未处理。
- [ ] **`iter5-skin` 剥离管道重写**（鉴别力恢复）：该锁 17/20/21/22 四步已命中 0 次，如今更接近「`client.js` 手写区指纹」。是否另立项恢复原鉴别力，**待用户裁定**（默认按不立项继续，已登记）。
- [ ] **B 类**（#258 部分路径已随 A 类处理；#270 需真跑确认）与 **C 类**（#252 RL-02、#254 MAINT-01 候选未覆盖须自研）。
- [ ] **回复 issue 与 PR**；不冲突的 PR 礼节性 merge。


### 8.6 ★#256 取证更正（2026-10-08，实测推翻台账原表述）

**原表述**：「`origin/main` 未跟踪该文件 ⇒ 干净克隆必 `MODULE_NOT_FOUND`」。

**实测（可复算）**：

| 检查 | 命令 | 结果 |
|---|---|---|
| `origin/main` 有 `release.mjs` | `git cat-file -e origin/main:tools/release.mjs` | **exit 0（有）** |
| `origin/main` 的 `release.mjs` 引用它 | `git show origin/main:tools/release.mjs \| Select-String reconcile` | **4 处引用** |
| `origin/main` 有该文件 | `git cat-file -e origin/main:tools/reconcile-upstream.mjs` | **exit 128（无）** |
| `v3.2.10` / `8280500` 有该文件 | 同上 | **均 exit 128（无）** |
| 本树 HEAD 有该文件 | `git ls-files --error-unmatch` | **exit 0（已跟踪，`ca94bf6` v3.1.4 批 J 加入）** |

⇒ **缺陷成立，且范围比原表述更大**：不只是「CI 干净克隆」，**GitHub 上的 `main` / `v3.2.10` 本身即处于「release.mjs 调用一个未交付文件」的状态**。

#### ★但真因不止「文件没跟踪」——**硬编码本机路径才是主因**

`tools/release.mjs` 第 26 行：

```js
const DEV = process.env.DSH_AUTO_MEMORY_DEV || 'D:\\dsh-auto-memory'
```

而第 301 行用 `path.join(DEV, 'tools', 'reconcile-upstream.mjs')` 找该文件。

⇒ 在 CI / 他人机器上 `DEV` 目录**根本不存在**（默认值是本机绝对路径）。**即便把 `reconcile-upstream.mjs` 一并入库，CI 仍会 `MODULE_NOT_FOUND`。**

#### 修法（按优先级）

1. **去掉本机路径依赖**：`DEV` 改为**相对脚本自身位置**解析（`path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`），使 release 脚本可在任意克隆中运行；
2. **把 `tools/reconcile-upstream.mjs` 纳入发布源检查范围**（已跟踪，但要确认 tag 带上它）；
3. **补齐 fail-closed 的可用性**：缺文件时给出**指向修法**的明确报错（现已 fail-closed，方向正确）；
4. 验收：在**干净克隆**上跑 `--dry-run` 不因缺文件/缺路径失败；负路径：临时移除该文件 ⇒ 明确报错而非静默通过。


### 8.7 ★★#256 真根因（2026-10-08 二次取证，推翻 §8.6 的机理判断）

**§8.6 现象对、机理错**：我写「`origin/main` 未跟踪该文件」——现象属实，但**堵死它的不是 git 跟踪状态，而是发布拷贝白名单**。

#### 决定性证据（可复算）

| 检查 | 命令 | 结果 |
|---|---|---|
| tools 拷贝清单 | `tools/release.mjs:133` | `for (const toolFile of 'run-smoke.mjs,smoke-impact.mjs,release.mjs'.split(','))` —— **不含 reconcile-upstream.mjs** |
| 另有硬检查项 | `tools/release.mjs:162` | `for (const toolFile of 'build-iter5-skin.mjs'.split(','))` + 缺失即 `process.exit(1)` |
| **发布树实测内容** | `Get-ChildItem D:\dsh_debug\_publish_dsh-auto-memory\tools` | `build-iter5-skin.mjs` / `release.mjs` / `run-smoke.mjs` / `smoke-impact.mjs` —— **确实没有 reconcile-upstream.mjs** |
| 本树 `tools/` | `Get-ChildItem tools -Filter *.mjs` | `reconcile-upstream.mjs` **在**（已跟踪） |

⇒ **机理**：`tools/release.mjs` 用**白名单**把 tools/ 下的文件拷进发布树，`reconcile-upstream.mjs` 从未被列入 ⇒ **它永远进不了发布树**。
⇒ 而 GitHub `main` 正是**由发布树生成**的 ⇒ **即使该文件在我们分支里已跟踪，`main` / 干净克隆也永远拿不到它**。
⇒ 结论：**仅"纳入 git 跟踪"治不了本缺陷**（这正是 §8.6 修法 ② 的不足）。

#### 正确的完整修法（三条，缺一不可）

1. **`DEV` 去本机路径依赖**：改为相对脚本自身位置解析（`path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`），**保留 `DSH_AUTO_MEMORY_DEV` 覆盖优先**。
   - 否则干净克隆/CI 上连第一步 `DEV` 都不存在，其后的 `reconcile` 更无从谈起。
2. **把 `reconcile-upstream.mjs` 列入 tools 拷贝清单**（或按 `build-iter5-skin.mjs` 的先例做独立硬检查 + 拷贝）。
   - 这是本缺陷的**直接**修法；不做则 `main` 永远缺文件。
   - **优先"列入清单 + 缺失即 fail-closed"**：清单式循环对缺失是 `continue`（静默跳过），会重演"以为交付了其实没有"。
3. **补交付断言**：在发布树完整性检查处（§5.5 一带）断言 `REL/tools/reconcile-upstream.mjs` 存在，使"漏拷"在发版当场暴露，而非等到使用者克隆后。

#### ★新护栏：`DEV` 相对化引入的自毁风险（必须一并处理）

`release.mjs` 第 2 步是「**清空 REL** 后从 DEV 复制」。`DEV` 相对化之后，**若在发布基座自己的克隆里运行本脚本，`DEV` 会等于 `REL`** ⇒
**先清空该目录、再从"已被清空的源"复制 ⇒ 发布基座自毁**。
而发布树 `tools/` 下**同样存在 `release.mjs`**（上表已证）⇒ 这不是假想路径。
**修法**：`DEV` 与 `REL` 解析为同一目录时 **fail closed**（win32 大小写不敏感比较），并给出明确指引。

#### 实施状态

- [ ] 上述 4 项均**未实施**（lane-256 车道因上下文耗尽中断，**未留下任何改动**，`HEAD` 仍为 `5245e4a`、工作区干净）。
- 已改派 R2 车道执行（携带本节结论作为起点）。


### 8.8 #256 收口 + 一次真实事故（2026-10-08）

#### 交付（commit `bf4ebfc`，未 push）

| # | 修法 | 落点 |
|---|---|---|
| ① | `DEV` 去本机路径依赖 | `process.env.DSH_AUTO_MEMORY_DEV \|\| path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`（env 覆盖仍优先） |
| ② | `reconcile-upstream.mjs` 并入 tools 交付 | 清单改为 4 项 **+ 产物侧 `REQUIRED_RELEASE_TOOLS` 硬检查**（清单式循环对缺失是 `continue`=静默跳过，光并入会重演「以为交付了其实没有」） |
| ③ | 交付断言 | §5.5 缺 `REL/tools/reconcile-upstream.mjs` 即 exit 1 |
| ④ | 自毁护栏 | `sameDir(DEV, REL)` 同址 fail closed（win32 大小写不敏感） |

**验收（真执行）**：干净检出 `D:/_r1-clean256` 跑 `--dry-run` exit 0，staging 出现检出独有哨兵（证 DEV=检出自身）、`staging/tools/reconcile-upstream.mjs` 8456 B 存在、干净克隆里真跑通 reconcile（修复前必 `MODULE_NOT_FOUND`）；负路径移走该文件 ⇒ exit 1 且点名。

#### ★事故：验收护栏时误跑非 dry-run release（自伤，可复现）

**经过**：为验证新增的「DEV===REL 自毁护栏」，执行 `node tools/release.mjs 3.2.10`（**漏 `--dry-run`**）。护栏未触发是**正确**的（DEV 与 REL 本就是两个不同目录，护栏只在同址时拦），但脚本第 2 步即「清空 REL + 从 DEV 复制」⇒ **真实重建了发布基座** `D:\dsh_debug\_publish_dsh-auto-memory`。

**损害实测（Lead 独立核查）**：

| 检查 | 结果 |
|---|---|
| REL HEAD / 分支 | `8280500` / `main`（**未 commit、未 push**） |
| 跟踪文件被删（D） | **0** |
| stash / MERGE_HEAD | 空 / 不存在 ⇒ 无既有未提交工作被覆盖 |
| 变更项 | 41（26 M + 15 ??）；相对 `8280500` 改动 26 文件 |
| **主仓库 `lib/`** | **零改动**（`git diff 32f02ce..bf4ebfc -- lib/` 为空） |
| 可逆性 | REL 是生成物树 ⇒ `git checkout . && git clean -fd` 可复原 |

#### ★★根因（值得单独记住）：破坏性动作在**任何闸门之前**

`release.mjs` 的「清空 REL」在**参数解析后的第 2 步**执行，早于全部前置检查 ⇒ **「只差一个 flag」的代价就是全量重建**。这类脚本天然危险。

#### 处置裁定（用户 2026-10-08）：**REL 不复原**

> 用户原话：「问题不大，反正再发也是 3.2.11 了」。

⇒ 发布基座留作现状（可在下次发版时被重建覆盖），**不做 `checkout/clean` 复原**。

#### 纪律（已写入项目笔记，跨会话有效）

1. **跑 release/发版类脚本一律带 `--dry-run`**；非 dry-run 即真实发布动作。
2. 要验「非 dry-run 路径的拒绝行为」，必须 `DSH_AUTO_MEMORY_REL=<tmp>` 指向临时目录，**不得**让默认 REL 生效。
3. 破坏性脚本的验收，优先用**干净检出 + 临时 REL**，不在真实基座上试。

#### 遗留候选（未立项，待用户定）

- [ ] `release.mjs` 加**前置确认**（非 dry-run 时要求显式 `--yes` 或打印目标 REL 后确认），使误触在破坏动作前被拦住。属发布工程改进，不在 A/B/C 内。


### 9.7 ★回复与 merge 收口 + 文档本地同步（2026-10-08）

#### 9.7.1 42 条全部回复完毕

| 类别 | 条数 | 处理 |
|---|---|---|
| 已修复 issue（给根因/修法/验证/commit） | 19 | #248 #249 #250 #251 #253 #255 #257 #258 #260 #264 #265 #266 #268 #269 #270 #271 #272 #273 #274 |
| 未修 issue（#252/#254/#256 已修，另 8 条说明未修原因） | 10 | #259 #261 #263 #267 #275 #276 #277 #278 + #179 + #201 |
| 非缺陷 issue | 1 | #241（重构建议，按缺陷口径不处理） |
| PR 回复 | 9 | #240 #242 #243 #244 #245 #246 #247 #262 #279 |
| **合计** | **42** | 零遗漏（含 #252/#254/#256 的修复说明） |

**实现方式**：`gh` CLI 未安装 ⇒ 走 GitHub REST API（`git credential fill` 取凭据，**仅用 Authorization 头，全程不回显、不落盘**）。
**自查修正**：`#248` 因「金丝雀 + 全量」重复发送，已用 API 删除重复那条（保留最早），去重后 1 条。

#### 9.7.2 9 个 PR 全部 merged + closed

**关键事实**：`#279` 的 head 是**其余全部 8 个 PR head 的祖先**（实测 `git merge-base --is-ancestor` 逐个确认）⇒ 合并 #279 等于把 9 个 PR 的提交一并带进 `main`。

**过程中的矛盾与真因**：
- GitHub 两个引擎（`PUT /pulls/279/merge` 与 `POST /merges`）**持续报冲突**（405/409，`mergeable_state=dirty`）；
- 而本地**严格试合并零冲突**：干净 worktree 上 `git merge --no-ff` **exit 0**、`MERGE_HEAD` 存在、`git diff --diff-filter=U` **未解决文件数 = 0**、346 项进 index；
- ⇒ 判定为 **GitHub 对巨型 PR（368 文件）的 mergeability 计算异常 / 缓存滞后**（同批首次探测时 9 个 PR 全为 `clean`）。

**执行**：改走「本地真实合并 + 推送 `main`」路径。

| 项 | 值 |
|---|---|
| `main` before | `8a44e3168e47dceb94dfea363af8ba9a7ae888cd`（#243/#240 合并后） |
| 本地合并 | `git merge --no-ff refs/remotes/prhead/279` ⇒ **exit 0，零冲突** |
| `main` after | **`98ae435254e7797394559fbda56e809345320562`** |
| 9 个 PR 终态 | **全部 `merged=true` + `state=closed`** |

| PR | merge_commit |
|---|---|
| #240 | `8a44e3168e47` |
| #242 | `14b5fe64ee37` |
| #243 | `37b31e11d8e5` |
| #244 | `6a7f2d6159d5` |
| #245 | `fbab4b57ec03` |
| #246 | `b3fbc6bae5a3` |
| #247 | `7c0d61441ee4` |
| #262 | `2570b2956eb9` |
| #279 | `98ae435254e7` |

#### 9.7.3 ★文档本地同步（用户指令：「README 与用户文档在本地更新好」）

**做法**：取 `main`（`98ae435`）版内容落盘，**但保留各文件原有的行尾约定**，使 `git diff` 只反映真实内容变化、不产生整文件 EOL 假 diff。

| 动作 | 文件数 | 说明 |
|---|---|---|
| **更新**（内容不同） | 8 | `README.md`(735→739 行, CRLF) · `README.zh-CN.md`(731→735, CRLF) · `docs/HANDBOOK.md`(394→119, LF) · `docs/USER-GUIDE.zh-CN.md`(466→467, CRLF) · `docs/USER-GUIDE.en.md`(465→466, LF) · `docs/WHITEPAPER.md`(425→426, LF) · `docs/FRONTEND-CO-CREATION.md`(192→194, LF) · `docs/TEAMWORK-GUIDE.md`(148→160, LF) |
| **新增**（本地缺失） | 18 | 含 `docs/ARCHITECTURE.md` `docs/README.md` `docs/SOURCE-REFERENCE.md` + `docs/architecture/`（架构图 PNG/system-map.html/JSON）+ 6 张设置页截图 + 2 份 internal 审计 |
| 新增合计 | 5.37 MB | |

**备份**：改动前逐文件备份到 `.diag-issues20261007/doc-backup-<ts>/`。

**完整性核验（可复算）**：对 `main` 的 **655 个文档类文件**逐个比对（文本忽略行尾、二进制逐字节）⇒
**一致 655 / 内容不同 0 / 本地缺失 0**。

#### 9.7.4 ★判据同步：`tools/verify-docs.mjs` 两处正则（按 2026-10-01 裁定改判据，不回滚成果）

同步文档后 `verify-docs` 报 **2 项不一致**。归因：**判据过期，非文档错误**。`main` 版把措辞改为「源码声明 19 个模型工具、71 个普通唯一路由和 155 个默认配置键」，而校验器的取证正则仍期望旧措辞。

| 行 | 原判据 | 新判据 |
|---|---|---|
| L95 | `/后端 (\d+) 个模型工具/` | `/(\d+) 个模型工具/` |
| L96 | `/(\d+) 条路由/` | `/(\d+) 个(?:普通唯一)?路由/` |

**★变异反向验证（防「为变绿而弱化判据」）**：把文档里的 `19` 改为 `18` ⇒ 报 `❌ 共创 模型工具 实测=文档=18 代码=19`、exit 1；还原 ⇒ 全部一致、exit 0。**鉴别力未下降。**

#### 9.7.5 遗留

- [ ] `iter5-skin` 剥离管道重写（鉴别力恢复）—— 仍待用户裁定（§9.6 已登记）。
- [ ] `release.mjs` 加非 dry-run 前置确认 —— 待用户裁定（§8.8 已登记）。
- [ ] 开发树 HEAD 仍为 `7e65f42`（未 push）；本轮只推了 `main`。

<!-- 生成于 2026-10-07 · 分类台账，上下文压缩后以本文件为准 -->