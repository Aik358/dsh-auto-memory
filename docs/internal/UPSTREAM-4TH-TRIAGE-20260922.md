# 上游 issue/PR 第四批核验（2026-09-22）· 逐条对照「本次审计是否已解决」

> 对象：GitHub `Aik358/dsh-auto-memory` 的 **12 个 open issue（#106–#117）+ 10 个 open PR（#118–#127）**
> 方法：**不看上游自述**，逐条回到 pre 线 `D:\dsh-auto-memory` 取代码证据（文件是否存在 / 表达式是否仍在 / 摘要是否一致）
> 前提纪律：这批 PR 全部针对 **main 线**且**尚未合并**；而本插件宿主只 import `-pre.js` 版 ⇒ **「PR 合并 ≠ 修复落地 pre 线」**，必须逐条独立核验。

## 一、结论总表

| 上游 | pre 线实测证据 | 判定 | 处置 |
|---|---|---|---|
| **#113/#114/#115/#116** webhook 公网面四条默认不安全（P1 安全） | `.github/cloud/qq-webhook/index.js` 与 `index.zip` 均在，默认值未改 | **未修** | ⇒ task-6 `sec-webhook` |
| **#107** 侧车挂死无人收尸 | `lib/python-sidecar-client.js`、`lib/m7-wire.js`、`lib/m7-index-sync-host.js` 均在 | **未修** | ⇒ task-7 `sidecar-medic` |
| **#108** 侧车 stderr 内容被丢弃 | 同上（`stderrTail` 只暴露字节数） | **未修** | ⇒ task-7 同批 |
| **#109** 双份冻结策略无一致性锁 | `lib/policies` 与 `python/policies` 各有 5 份同名文件，**摘要两两相同**（当前巧合一致）但全仓无任何测试引用这两个目录 | **未修**（一致 ≠ 有锁） | Lead 待做 |
| **#110** 快照逐行全量写盘 + 写失败静默 + facts 无保留上限 | `lib/index.js` 的 `hubIo.save` **仍是 `try{…}catch(_){}`**；`lib/fact-store-pre.js` **无 `maxFacts`/`retention`/`prune`** | **半修**（A-8 只让 store 层返回失败；io 层、批量、上限三件均未做） | Lead + 待 fact-guard 释放写域 |
| **#111** 运维手册指向不存在的路径/前缀 | `docs/*.md` **79 行**命中（HANDBOOK 25、两份 USER-GUIDE 各 8） | **未修** | ⇒ task-8 `docs-hermetic` |
| **#112** 冒烟套件读真实 `~/.dsh`，回归不可判定 | 三个点名套件均在；`smoke-test-m81-fact-metadata-pre.mjs:155` 仍有家目录手拼 | **未修** | ⇒ task-8 同批 |
| **#106** 打包 88% 非运行时 + 6 个 tracked `.bak` | `git ls-files \| grep .bak` = **0**（pre 已无 tracked 备份）；但 `package.json` 的 `files` 仍含 `docs`（20 MB 进包） | **部分已修** | Lead 待做（负向排除） |
| **#117** v3.0.1 全仓只读审计遗留清单（22 项 P3） | 逐条未核 | **待 triage** | Lead 待做 |

## 二、本轮已派出的并行修复

| 任务 | 负责人 | 写域 | 对应上游 |
|---|---|---|---|
| task-6 | `sec-webhook` | `.github/cloud/qq-webhook/{index.js,index.zip}` + 新守卫 | #113–116 |
| task-7 | `sidecar-medic` | `lib/python-sidecar-client.js`、`lib/m7-wire.js`、`lib/m7-index-sync-host.js` + 新守卫 | #107/#108 |
| task-8 | `docs-hermetic` | `docs/HANDBOOK.md`、两份 USER-GUIDE、三个非隔离套件 + 两个新守卫 | #111/#112 |

三者的任务卡里都写入了两条用户方针：**①模型友好**（不得因安全/诊断加固而改变记忆行为或阻断模型通路）、**②原因要人能看懂**，并要求回报里逐条说明满足方式。

## 三、Lead 自领的剩余项

1. **#110 剩余三件**：`hubIo.save` 失败必须外显（`[降级]` + 计数进 `debugView`）+ feed 批量化（一批一次落盘）+ `facts` 保留上限（等 `fact-guard` 交还 `lib/fact-store-pre.js` 写域后再动，避免并发写冲突）。
2. **#109**：加跨目录一致性守卫（改一份不同步另一份必须红）+ `loadAndVerifyPolicy()` 对「另一份存在且摘要不同」记一条 `[降级]`（对齐「不静默」契约）。
3. **#106**：`package.json` 的 `files` 加负向排除（把 docs 从发布产物中剔出；`.bak` 已在 pre 线干净）。
4. **#117**：22 项 P3 清单逐条 triage（与本仓 A/B/C/D/E 批可能有重叠，需去重后决定取舍）。

## 四、纪律备忘（本批新增）

- **上游 PR 全在 main 线，pre 线必须独立落地**：本仓 26 对 `-pre`/非 `-pre` 文件的漂移让「合并 PR」与「修复生效」是两件事，核验必须落到 pre 树的具体文件与表达式。
- **一致性不等于有锁**：`lib/policies` 与 `python/policies` 当前摘要相同，但没有任何测试或运行时校验比对两者 ⇒ 重标定只改一份就会静默分叉。判定「问题是否存在」看的是**有没有防线**，不是**当前是否碰巧一致**。

## 五、第五批（收尾批）实况 — 2026-09-22

上游真实规模经 API 复核为 **12 个 open issue（#106–#117）+ 11 个 open PR（#101、#118–#127）**；此外还有 **4 条更早的 open issue（#102–#105）** 是本轮新核出来的，其中 **#103 / #104 / #105 均为 P1**。

### 5.1 GitHub 侧执行结果（硬事实）

| 动作 | 对象 | 结果 |
|---|---|---|
| 礼节性 merge | #101、#118、#119、#120、#121、#122、#123、#125、#126 | **9 个已 merged**（`merge_method=merge`，commit 标题注明「courtesy merge, contributor credit」） |
| 合并失败 | **#124**（#110 的 PR）、**#127**（#112 的 PR） | `mergeable_state=dirty` → `Pull Request has merge conflicts`；API `update-branch` 被拒（`user doesn't have permission to update head repository`，分支在 fork 上）。**已在两个 PR 下留言说明 + 致谢 + 给出 rebase 提示，不关闭、不置否。** |
| issue 自动关闭 | #103–#116 中带 `Closes` 的 12 条 | 随 PR 合并**自动关闭**（#110 / #112 因对应 PR 未合并而**仍开启**） |
| issue 手写状态评论 | #102、#110、#112、#117 | 4 条均已回帖，写明「pre 线独立落地到哪一步 / 尚未做什么 / 为什么保持开启」，避免读者把「合了 PR」误读成「问题已解决」 |

**当前上游剩余**：open issue = **#102、#110、#112、#117**；open PR = **#124、#127**。

### 5.2 pre 线独立落地进度（与会话内实现一一对应）

| 上游 | pre 线状态 | 证据 |
|---|---|---|
| #107 / #108 | ☑ 已落 | `lib/python-sidecar-client-pre.js` 352→629 行；守卫 `tests/smoke/smoke-test-sidecar-watchdog-pre.mjs` 65/0；红证明 3/3 |
| #109 | ☑ 已落（一致性锁） | `tests/smoke/smoke-test-issue109-policy-parity-pre.mjs` 15/0（同名策略工件逐字节比对 + python 侧独有文件必须叫 `decision-record-*`） |
| #110 | ◐ 半落 | ☑ io 失败可见（`lib/hub-io-pre.js` + 守卫 52/0、变异 2/2）；☑ 拒收不再记 consumed；⬜ feed 批量化、⬜ facts 保留上限 |
| #111 / #112 | ◐ 进行中 | 文档对齐 + 三套件 hermetic（task-8 `docs-hermetic` 正在收尾） |
| #113–#116 | ☑ 已落 | `.github/cloud/qq-webhook/index.js` + `index.zip` 重建；守卫 66/0；变异 5/5 |
| #106 | ☑ 已落 | `package.json` `files`：移除 `docs`（20 MB）并新增 `!**/*.bak*` / `!**/*.tmp` 负向排除 |
| #102 | ⬜ 未修 | P2；会改变注入面的改动，须先有守卫再落 |
| #117 | ⬜ 未 triage | 22 项 P3；需与 A/B 批去重后逐条给「已覆盖 / 待修 / 不改」三分类 |

### 5.3 本批新增的纪律

- **`update-branch` 需要 head 仓库推送权限**：fork 来的 PR，维护者无法用 API 推到分支 ⇒ PR 冲突只能作者 rebase，或维护者本地手工解决。礼节性 merge 因此**不保证 100% 可完成**，必须在收尾报告里如实说明，不能写成「全部合并」。
- **合并会连锁关 issue**：带 `Closes #NNN` 的 PR 一旦 merge，对应 issue 会被自动关闭 ⇒ 「未修完的 issue 必须在此前回帖说明」，否则会出现「issue 已关闭但问题仍在」的假象。本批对 #110 / #112 的处置就是据此定的（PR 受阻 ⇒ issue 保持开启）。
