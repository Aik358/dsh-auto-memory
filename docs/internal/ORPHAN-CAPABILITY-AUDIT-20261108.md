# 孤儿功能系统审计（只读）· 2026-11-08

> 对象：`D:/dsh-auto-memory`（分支 preview，dsh-auto-memory v3.4.0-alpha.6）
> 方法：静态 import 图 + 全仓引用扫描 + git 历史 + smoke 套件清单 + 加载机制穷举（ES import / 动态 import / require / Worker / child_process / 前端 `__ModuleLoader__` / HTTP 路由 / prompt 文本 / 构建期生成器）。
> 纪律：全程只读，未修改 lib/tests/tools/skins 任何文件，未跑生成器、未改配置。所有数字均为本轮实测，复算命令见 §5。

---

## 0 · 结论速览

1. **21 个「不可达」模块中，8 个属正常（3,244,646 B），13 个是真孤儿（187,668 B）。**真孤儿不是 Lead 基线的 3.4 MB —— 那 3.4 MB 里有 2,918,684 B 是前端入口 `client.js`，另有 310,595 B 是 EV4 构建期生成链（`ev4-adapter` + `ev4-prototype-blocks` + `ev4-blocks.generated`）。「建好了但没接线」的实际体量只有 187,668 B。
2. **13 个的成因分类：9 个「建好了没接线」、3 个「被替代 / 真源迁移」、1 个「连带死亡」。** 未接线 = acceptance / celebration-art / event-regroup×4 / rerank-host / state-commit / team-transport-http（后者属*有意延后*，且前端 `client.js:15734` 已把 http 选项 `disabled` 并标注「当前宿主尚未接线」，不算隐瞒）；被替代/迁移 = ledger-criteria（判据真源已并入 wb-contract）、upgrade-apply（向导改走子代理直接写盘）、upgrade-links（真源实际迁到 client.js 手写镜像）；连带死亡 = upgrade-draft（只被 upgrade-apply 的动态 import 引用）。
3. **P0 只有 1 项**：event-regroup 四件套（42,839 B，占真孤儿字节 22.8%）。它要替换的正是当前仍在跑的确定性聚类（`index.js:8598` `groupIntoCandidateEventsPre`）；而 `event-regroup.js:4-11` 模块头逐字批判该聚类「实测产出垃圾：一篇账本 = 一个事件，事件名直接取『目标段首行』」。**替代品已建好、旧实现仍在生产，与用户报的「事件碎片化」直接因果。**
4. **一个此前被误判为「误报」的孤儿在本轮重新成立**：`acceptance.js`（P5 发布验收门）。`docs/internal/ISSUE117-TRIAGE-20260922.md:39-40` 曾判它「孤儿模块 …随包发布却从未接线」，随后以「该文件在 pre 线不存在」判为误报 —— 现树上的 `acceptance.js` 就是 pre 线改名后的同一模块（`tools/release.mjs:398` 登记 `'acceptance-pre.js'`，改名管道产出裸名）。**孤儿条件从未消失，只是换了文件名。**
5. **模块可达 ≠ 能力可达**：`ledger-criteria.js` 是「被取代」而非「未建」，但它在自己文件里**又实现了一遍**同名判据（`:59`、`:106`），与生效的 `wb-contract.js` 构成第二份平行实现 —— 属「未来接错线就会静默换判据」的隐患，不是纯垃圾。

---

## 1 · 块 1：21 个不可达模块的逐个定性

### 1.1 汇总表

| # | 模块 | 字节 | 判定 | 决定性加载方式 / 反证 | 性质 |
|---|---|---|---|---|---|
| 1 | acceptance.js | 4,130 | **真孤儿** | `index.js` 命中 0；唯一 import 者是测试 | 建好了没接线 |
| 2 | celebration-art.js | 5,423 | **真孤儿** | 全仓仅命中自身头注释 1 次；测试 0 | 建好了没接线 |
| 3 | client.js | 2,918,684 | 正常 | `package.json` `exports["./client"]` + `dsh.client`；`__ModuleLoader__.load` | 前端入口 |
| 4 | continuation-maintenance.js | 2,962 | 正常 | `#!/usr/bin/env node`；测试用 `execFileSync(node, [该文件])` 调 | CLI 工具 |
| 5 | ev4-adapter.js | 32,815 | 正常 | `tools/gen-ev4-blocks.mjs:52` 动态 import | 构建期生成器输入 |
| 6 | ev4-blocks.generated.js | 149,939 | 正常 | 生成器输出 `:33`；`--check` 校验 `:22-24`；git 忽略 | 构建产物 |
| 7 | ev4-prototype-blocks.js | 127,841 | 正常 | `tools/gen-ev4-blocks.mjs:51` 动态 import | 构建期源 |
| 8 | event-regroup-apply.js | 10,334 | **真孤儿** | 仅 `upgrade-apply.js:48`（同族死岛）+ 1 个测试 | 建好了没接线 |
| 9 | event-regroup-propose.js | 9,274 | **真孤儿** | 仅 `event-regroup.js` 族内 + 1 个测试 | 建好了没接线 |
| 10 | event-regroup-scan.js | 11,745 | **真孤儿** | 仅族内 + 1 个测试 | 建好了没接线 |
| 11 | event-regroup.js | 11,486 | **真孤儿** | 仅被 produce/scan import + 1 个测试 | 建好了没接线 |
| 12 | ledger-criteria.js | 7,985 | **真孤儿** | `index.js:162` 从 `wb-contract.js` 导入同名判据 | 被替代品取代 |
| 13 | migration-optin-contract.js | 4,271 | 正常 | `tools/apply-migration-optin.mjs:30` import | CLI 工具链 |
| 14 | rerank-host.js | 8,715 | **真孤儿** | `index.js` `rerank` 命中 0；文档自认未接线 | 建好了没接线 |
| 15 | semantic-js-worker.js | 5,608 | 正常 | `semantic-js-process.js:88` `fork(new URL('./semantic-js-worker.js'))` | 子进程入口 |
| 16 | state-commit.js | 12,383 | **真孤儿** | `index.js` `buildStateCommit`/`commitConflict`/`expectedStateVersion` 全 0 | 建好了没接线 |
| 17 | team-transport-http.js | 21,853 | **真孤儿** | 头注释自述不接线；装配点 `index.js` `createHttpBackend` 0 命中 | 有意延后（前端已标注） |
| 18 | upgrade-apply.js | 48,039 | **真孤儿** | `index.js` 仅 1 处注释命中（`:5140`）；无 apply 路由 | 被替代（子代理直接写盘） |
| 19 | upgrade-draft.js | 34,443 | **真孤儿** | 仅 `upgrade-apply.js:134` 动态 import + 2 个测试 | 随主模块连带死亡 |
| 20 | upgrade-links.js | 1,858 | **真孤儿** | `index.js` 0；`client.js:8356` 手抄镜像 | 真源被前端镜像取代 |
| 21 | wasm-paths.js | 2,526 | 正常 | `semantic-js-worker.js:14` import | 子进程依赖 |

**字节核对**：正常 8 个合计 3,244,646 B；真孤儿 13 个合计 187,668 B；总计 3,432,314 B（= Lead 基线）。

### 1.2 真孤儿逐条判定依据

#### (1) acceptance.js — 4,130 B / 72 行 / 3 个导出

- **功能**（模块头 `:1-12`）：「P5 分档运行验收清单（2026-09-16, acceptance_pre_v1）」，`ACCEPTANCE_ITEMS_PRE_V1` + `createAcceptanceLedgerPre()`，三态 `pass|fail|not-run`，全必需项 pass 才 `release-ready`。纯数据结构 + 纯函数，零 IO。
- **无生产调用点**：`grep -c acceptance lib/index.js` = **0**；路由表（`index.js:449-559`，85 条）无对应路由；工具定义区无 `acceptance` 命中；prompt 文本 0 命中。
- **唯一消费者是测试**：`tests/smoke/smoke-test-p5-acceptance.mjs`（1 个套件）。
- **git**：仅 1 次提交 `c1c3a1d6`（v3.1.6，提交信息为「删净pre全量落地 … 上游清单旧名…」）—— 即 `*-pre.js` → 裸名的改名落地，**不是功能接线**。
- **历史证据（关键）**：`docs/internal/ISSUE117-TRIAGE-20260922.md:39` 原文：「`lib/acceptance.js`（71 行） | 孤儿模块：零 lib 侧引用，只被 `smoke-test-p5-acceptance-pre.mjs` 使用 ⇒ 一道发布门被随包发布却从未接线 | **✗ 误报（该文件在 pre 线不存在）**」。该「误报」结论成立的前提只是**文件名不同**（当时树上叫 `acceptance-pre.js`），本轮实测 `lib/acceptance.js` 存在且形态完全相同 ⇒ 孤儿判定重新成立。
- **本来该被谁调用**：发布/验收流程（`tools/release.mjs` 或 `memory_status`）—— 现状两处都没有读取点。
- **性质**：建好了没接线。

#### (2) celebration-art.js — 5,423 B / 104 行 / 5 个导出

- **功能**（`:1-10`）：「记忆整理完成」庆祝用立体字；用户 2026-10-25 第八轮裁定 v1 被否，v2 只保留一个立体词 `COMPLETE`。
- **无任何消费者**：全仓（lib/tools/tests/skins/docs）命中该基名 **1 次**，即它自己的头注释；`client.js` 中 `celebrat`/`celebration` 命中 **0** ⇒ 前端从未镜像该模块。
- **本来该被谁调用**：升级向导「整理完成」页（前端 done 态渲染）。实际前端没有该渲染分支。
- **git**：1 次提交 `49d99735`（v4 里程碑「…P5 镜像…」）—— 提交信息里的「P5 镜像」指的是前端镜像批次，但该模块本身没进镜像。
- **性质**：建好了没接线。

#### (8)-(11) event-regroup 四件套 — 42,839 B

| 模块 | 导出数 | 职责（模块头） |
|---|---|---|
| event-regroup.js | 8 | R1 纯函数层：事件名闸门 / 建议 / 守恒校验 |
| event-regroup-scan.js | 9 | R2 只读扫描 + AI 输入构造（含 `EVENT_BOUNDARY_RULES`，`:148`，7 条判据） |
| event-regroup-propose.js | 8 | R3 AI 输出解析 + 提案构造（fail-closed 防幻觉） |
| event-regroup-apply.js | 8 | R6 提案落盘 + 快照 + 回滚（唯一写用户数据的模块） |

- **生产侧零入口**：`grep -c regroup lib/index.js` = **0**（大小写均试）。族内依赖链：`event-regroup-apply.js:48` 被 `upgrade-apply.js` import；`propose:15`/`scan:14` import R1。而 `upgrade-apply.js` 自身也是死岛（见下）⇒ 整族连根不可达。
- **测试 4 个套件全在**：`smoke-test-v5-p6-event-regroup` / `-r2-regroup-scan` / `-r3-regroup-propose` / `-r6-regroup-apply`。**测试在、生产调用不在 ⇒ 强证据「建好了没接线」**。
- **它本来该替换谁（本轮新证据）**：现行生产路径是 `index.js:8598` `const groups = groupIntoCandidateEventsPre(batchLedgers)`（来自 `event-plan.js:112`，`index.js:55` import），即「确定性聚类」。`event-regroup.js:4-11` 模块头逐字批判它：「旧版『把账本变成事件』用的是**纯确定性聚类**（目标段首行相同 / 6 小时内 2-gram 重合），实测产出垃圾：一篇账本 = 一个事件，事件名直接取『目标段首行』」。⇒ **替代链已建好（R1–R6），旧链仍在生产（`curateUnarchivedPre` 全流程）**。
- **落地口存在且唯一**：`curateUnarchivedPre`（`index.js:8581-8629`）与 `writeCuratedEventsPre`（`:8647`）就是应该切到 R2/R3（扫描+提案）与 R6（落盘）的位置。
- **性质**：建好了没接线（不是被替代 —— 方向相反）。

#### (12) ledger-criteria.js — 7,985 B / 143 行 / 10 个导出

- **功能**：WB-GRAPH P1 判据校验中间件核心（账本四段/H1–H4 + 白板判据）。
- **已被取代**：`index.js:162` 从 **`./wb-contract.js`** 导入 `checkHandoffCriteriaPre, checkPlanCriteriaPre`，两处咽喉 `index.js:5855-5856` 直接调它。`grep -c ledger-criteria lib/index.js` = **0**。
- **模块自述与实现矛盾（本轮发现）**：`:16-18` 注释写「P0 窗口的 wb-contract.js 已实现同名判据函数(H1-H4/S1-S4)，且 index.js 两咽喉已接线它 — 本模块勿重复造轮,统一转发保持单一真源」，但紧接着**自己又完整实现了一遍** `checkHandoffCriteriaPre`（`:59`）与 `checkPlanCriteriaPre`（`:106`），并以不同名字再导出 `wb-contract` 的版本（`:18`）。⇒ 实际形态是「平行第二实现」，不是转发壳。
- **风险**：两份判据各自演进即静默分叉；目前无人消费，故今日无行为差异，但任何「按模块名接线」的后续动作都会换掉判据。
- **性质**：被替代品取代（附带平行实现残留）。

#### (14) rerank-host.js — 8,715 B / 161 行 / 7 个导出

- **功能**（`:1-11`）：P4 精排多级档位 + 有界异步窗口（`RERANK_WINDOW_MS_PRE_V1`、`createRerankHostPre`，模型调用经 `opts.rerankFn` 注入）。
- **零接线**：`grep -ci rerank lib/index.js` = **0**。
- **文档已明确登记**：`docs/internal/FUTURE-ROADMAP-20261010.md:38`「`lib/rerank-host.js`（9 KB）**存在**，但 `lib/index.js` 中 `rerank|RERANK` 命中 = **0** ⇒ **定义存在但未接线**」；`:133`「它已就绪且**尚未接线**」。
- **本来该被谁调用**：召回链（`recall` / `smart-recall` 路由）在取得候选后做精排；缺的是 `rerankFn` 实现与注入点。
- **性质**：建好了没接线。

#### (16) state-commit.js — 12,383 B / 246 行 / 13 个导出

- **功能**（`:1-12`）：统一状态提交契约 `state_commit_pre_v1` —— miv（`memoryIndexVersionPre`）、`boardIdPre`、`buildStateCommitPre`、`commitConflictPre`、`commitReceiptPre`。
- **零接线**：`buildStateCommit` / `commitConflict` / `commitReceipt` / `expectedStateVersion` / `stateCommit` 在 `index.js` 全部 **0** 命中。
- **生产侧已另有实现**：`index.js:9991-10004` `tierCurrentMivPre()` 走 `m4-corpus.js` 的 `CorpusRegistry`，取 `snapshot.memoryIndexVersion`（`:10002`），与 state-commit 的元组哈希口径（`state-commit.js:104-126`）不是同一实现。⇒ 模块声称「三条硬规则（本模块是它们的唯一实现点）」与事实不符。
- **本来该被谁调用**：`memory_log`/`memory_note`/`memory_event` 的写回执与并发冲突判定（现在散在 `index.js` 各处）。
- **性质**：建好了没接线（契约未落地）。

#### (17) team-transport-http.js — 21,853 B / 450 行 / 1 个导出（`createHttpBackend`）

- **自述不接线**：`:14`「★本模块**尚未接线**：'lib/team-transport.js' 里 transport: "http" 目前仍是构造即抛」。
- **装配口为空**：`team-transport.js:593-597` `const factory = safeGet(options, 'createHttpBackend') ` → 缺则 `throw new Error('transport-not-implemented: http（T2 涉密内网通道未注入工厂；请在装配层传 options.createHttpBackend）')`。而 `grep -c createHttpBackend lib/index.js` = **0** ⇒ 该工厂从未注入。
- **用户侧已诚实标注**（不算隐瞒）：`client.js:15734` `h('option', { value: 'http', disabled: true }, 'http 服务端（当前宿主尚未接线，旧值保留）')`。
- **测试 3 个套件**（含 `smoke-test-team-transport-http.mjs`「只覆盖独立模块」）。
- **性质**：建好了没接线，但属**有意延后且已在 UI 标注** —— 定级应低于无声的未接线。

#### (18)-(19) upgrade-apply.js（48,039 B）+ upgrade-draft.js（34,443 B）

- **功能**：向导链路的**受控落盘端**。`upgrade-apply.js:1-10`：「把『子代理写好草案文件 → 引擎校验 → 落盘』这条受控通道的**落盘端**实现出来」；`applyUpgradeDraftPre()`（`:871`）含闸 8–10（渲染门/写盘/双跑），并复用 `event-regroup-apply.js:48` 的快照/回滚。`upgrade-draft.js` 是闸 1–7 校验器，被 `upgrade-apply.js:134` `await import('./upgrade-draft.js')` 动态载入（缺则内置兜底 `:239`）。
- **零接线**：`applyUpgradeDraft` / `upgradeDraft` / `upgrade-runs` / `validateUpgradeDraft` 在 `index.js` 全 **0**；`upgrade-apply` 唯一命中是 `index.js:5140` 的**注释**（「**不要**用 lib/upgrade-apply.js:501 那份（PLAN-<ts>.md，命名不一致）」）。
- **无对应路由**：路由表 `index.js:449-559` 中向导相关只有 `upgrade-status` / `upgrade-workspaces` / `upgrade-snooze` / `memory-upgrade` / `upgrade-archive-plan`，**没有 apply 端点**。
- **被谁取代**：现行落盘走「子代理直接写盘」——`startUpgradeJobPre`（`index.js:11617`）在 `:11676-11682` 注释里写明「工作区清单由程序算好并**前置**到提示词」（因 v5 首跑「子代理 55 次调用 0 写盘」），即整条链路是 **prompt 驱动的子代理写入**，不再经过 `applyUpgradeDraftPre` 的令牌/快照/闸 8–10。
- **后果（定性）**：设计里「第二个会写用户数据的模块」的**全部安全闸**（令牌制、快照先行、双跑一致性）在生产路径上不存在；写盘保护改由子代理纪律 + `upgradeGateVerdictPre` 承担。属**被替代**，代价是安全层缺失。
- **性质**：被替代品取代（与 event-regroup 的「未接线」不同：这里替代方向是真的换了实现）。

#### (20) upgrade-links.js — 1,858 B / 38 行 / 4 个导出

- **自述唯一真源**：`:1-10`「向导第 3 页的外部渠道链接**唯一来源**…URL 只出现在本文件；前端文案**不得**内联 URL…不得在 client.js 里另写一份」。
- **事实相反**：`index.js` 对 `UPGRADE_LINKS`/`usableUpgradeLinks` 命中 **0**；前端 `client.js:8356` 有一份手抄冻结镜像 `var UPGRADE_LINKS_PRE = Object.freeze({...})`（注释 `:8341`「链接/按钮文案：宿主 lib/upgrade-links.js 是唯一真源。client.js 是浏览器 __ModuleLoader__ …」），渲染在 `:9531/:9540/:9542`。
- **真实真源 = client.js 手写常量**；该模块退化为**测试对拍用的 oracle**（`smoke-test-upgrade-wizard-client.mjs:91` 逐键对拍、`smoke-test-hub-access.mjs:4` import）。
- **性质**：真源被前端镜像取代（单一真源纪律实际未成立：两份都要手改）。

### 1.3 正常模块的依据（不是孤儿）

| 模块 | 加载方式（决定性证据） |
|---|---|
| client.js | `package.json`：`"exports": {"./client": "./lib/client.js"}`；`"dsh": {"client": {"platform": "web"}}`；`cordis.patch.yml` 以 `dsh.bundle.patch` 插入 profile 行；文件内 `client.js:11` `window.__ModuleLoader__.load({` ⇒ 浏览器端 bundle，不走 Node 的 ESM 图。 |
| continuation-maintenance.js | `:1` `#!/usr/bin/env node`；`tests/smoke/smoke-test-issue207-routes.mjs:57` `execFileSync(process.execPath,[fileURLToPath(new URL('../../lib/continuation-maintenance.js',...))])`；`index.js:7123` 错误文案指示用户执行 `node lib/continuation-maintenance.js seed-counter --last N --confirmed-history-reviewed` ⇒ 人工恢复 CLI（`:1` 自述「Local, explicit recovery; no model/network/controller requests」）。 |
| ev4-adapter.js | `tools/gen-ev4-blocks.mjs:52` `await import(pathToFileURL(ADAPTER).href)`，`:56` 白名单函数 `toString()` 后内联进 `client.js` 生成区。`ev4-adapter.js:9-13` 自述为何必须走「ESM 源 → 生成器内联」。 |
| ev4-prototype-blocks.js | `tools/gen-ev4-blocks.mjs:51` 动态 import（12.6 万字符原型切片），`:54` 常量白名单序列化。 |
| ev4-blocks.generated.js | 生成器输出 `:33` `GEN_OUT`；`:22-24` `--check` 幂等校验；`tools/pre-regression-gate.mjs:88/:171` 登记为生成物与套件映射。**git 未跟踪且被忽略**（`git check-ignore` = true，命中 `.gitignore:55 lib/*.*.*`）⇒ 构建产物，随生成器重建。 |
| semantic-js-worker.js | `lib/semantic-js-process.js:88` `child = fork(new URL('./semantic-js-worker.js', import.meta.url), [], {...})`；模块头 `:1-5`「JS semantic inference process. **Never import this file into the DSH host**. A worker_thread shares native DLLs with its parent; a forked process does not.」 |
| wasm-paths.js | `lib/semantic-js-worker.js:14` `import { applyLocalWasmPathsPre } from './wasm-paths.js'` ⇒ 随子进程入口连带加载。 |
| migration-optin-contract.js | `tools/apply-migration-optin.mjs:30` `} from '../lib/migration-optin-contract.js'`（`:48` 还按路径拼真源）；`tests/smoke/smoke-test-migration-optin-compat.mjs:19` import。属 #449/#546 的契约层 + 探针工具链。 |

### 1.4 复核 Lead 基线的结果

| 基线断言 | 本轮复核 | 结论 |
|---|---|---|
| 123 可达 / 21 不可达 / 3,432,314 B | 21 个文件字节逐个实测，合计 **3,432,314 B** | ✅ 一致 |
| `index.js` 有 44 处 `await import(...)` | `(await import( 命中 44`，literal 目标 44 处 | ✅ 一致 |
| 动态导入目标为 15 个白名单模块 | 实测 15 个唯一目标，与清单逐个相符（`node:fs/promises`×4、`node:path`×7、`./handoff-anchor.js`×1、`./l0-extract.js`×7、`./event-store.js`×1、`node:crypto`×3、`./note-status-apply.js`×2、`./recall-passages.js`×7、`./evidence-agg.js`×1、`./memory-importance.js`×1、`./temporal-parse.js`×1、`./recall-fusion.js`×1、`./plan-render.js`×1、`./skill-export-host.js`×2、`node:fs`×4） | ✅ 一致 |
| `new Worker(` 出现 0 次 | 实测 0 | ✅ 一致 |
| 123 可达 / 21 不可达 | 本轮纯静态图得 **116 / 28**；把 7 个**仅经 `await import()` 加载**的模块（`evidence-agg`、`memory-importance`、`note-status-apply`、`plan-render`、`recall-fusion`、`recall-passages`、`temporal-parse`）并入后 = **123 / 21** | ✅ 一致（口径：静态边 + 动态边） |
| `upgrade-apply.js` 在 index.js 仅 1 次命中且为注释 | 实测 `:5140` 注释 1 次 | ✅ 一致 |

---
## 2 · 块 2：导出级死代码

### 2.1 方法与口径（可复算）

- 扫描面：`lib/*.js`（144 个，含 `index.js` 与 `client.js`）+ `tests/**/*.mjs`（595）+ `tools/*.mjs|js`（130）+ `skins/*.js|frozen`。
- 计数方式：**整词匹配**（`(?<![A-Za-z0-9_$])NAME(?![A-Za-z0-9_$])`），**排除定义模块自身**，其余文件里出现即计 1 次（`X.foo` 命名空间访问也会被计入，因为 `foo` 以整词出现）。
- **不存在命名空间整体合并的漏计**：`lib/` 下 `import * as` **0 处**（实测）。
- 导出符号总数 **1,163**（1,142 具名 + 21 default），分布在 **138 个模块**；`index.js` / `client.js` / `ev4-blocks.generated.js` / `semantic-js-worker.js` / `continuation-maintenance.js` 无 ESM 导出（0 个）。
- 计数**不过滤注释**：注释里的同名出现会让符号显得"有人用" ⇒ 只会**低估**死代码、不会误杀。

### 2.2 四级分档（1,163 个导出）

| 档 | 定义 | 数量 | 占比 |
|---|---|---|---|
| **A · 全仓零引用** | 其他 lib 模块 + 测试 + 工具全 0 次，且**本模块内部也不用**（仅在定义行） | **42** | 3.6% |
| **B · 仅模块内自用** | 模块外 0 次，但模块内被调用/读取 ⇒ `export` 关键字冗余，代码本身在跑 | **173** | 14.9% |
| **C · 仅测试引用** | 生产 lib 0 次、工具 0 次，只有 `tests/**` import | **347** | 29.8% |
| **D · 生产有引用** | 至少一个其他 lib 模块读取 | **601** | 51.7% |

> A+B 合计 215 = 「模块外零引用」，即朴素的「导出零引用」口径；但其中 173 个是**活着**的（模块内自用）。**只有 A 档 42 个是真死**，这是本轮要纠正的判据：把 B 档当死代码删掉会直接删掉正在运行的逻辑。

### 2.3 A 档：42 个真·全仓零引用（按模块分组）

| 模块 | 模块可达 | 死符号（`file:line`） |
|---|---|---|
| config-io.js | 是 | `isNonEmptyFilePreSync`:201 |
| engine-identity.js | 是 | `describeEngineIdentityPre`:146 |
| event-store.js | 是 | `EVENT_STORE_SCHEMA_V1`:29、`quarantineLogSnapshotPre`:535 |
| evidence-agg.js | 是（动态 import） | `EVIDENCE_AGG_VERSION`:17 |
| fact-store.js | 是 | `UPSERT_OUTCOMES_PRE_V1`:68、`FACTNESS_CODES_PRE_V1`:145 |
| handoff-anchor.js | 是 | `HANDOFF_LEDGER_WEIGHT_VERSION`:15 |
| injection-policy.js | 是 | `sensitiveRecord`:27 |
| **ledger-criteria.js** | **否（真孤儿）** | `checkHandoffCriteriaContractPre`:18、`checkPlanCriteriaContractPre`:18 |
| m7-wire.js | 是 | `validateIndexAckPayloadPre`:207 |
| memory-envelope.js | 是 | `ENVELOPE_PRIORITIES_PRE_V1`:53 |
| memory-mutation.js | 是 | `validateProjectionPairPre`:232 |
| migrate-pack.js | 是 | `countOccurrencesPre`:129 |
| note-status-apply.js | 是（动态 import） | `NOTE_STATUS_MARKER_PRE_V1`:118 |
| procedure-store.js | 是 | `PROCEDURE_LEVELS_PRE_V1`:83、`PROCEDURE_MIN_SUCCESS_PRE_V1`:114 |
| procedure-switch.js | 是 | `usesLegacyProcedureSwitchPre`:35 |
| python-runtime.js | 是 | `PY_RUNTIME_VERSION`:23、`interpreterFileInfoPre`:190 |
| rules-edit.js | 是 | `previewRulesPre`:152、`isEmptyRulesPre`:158 |
| semantic-decide.js | 是 | `JS_ACTIVATION_DECIDE_VERSION`:18 |
| session-archive.js | 是 | `readProjcacheIndex`:442、`titleFromProjcache`:453、`readProjcacheFile`:469 |
| **state-commit.js** | **否（真孤儿）** | `COMMIT_REQUIRED_PRE_V1`:43 |
| team-attribution.js | 是 | `TEAM_ATTRIBUTION_SCHEMA`:211 |
| team-baseline.js | 是 | `TEAM_VERDICTS_PRE`:313 |
| team-board.js | 是 | `decidePlanPre`:38、`applyPlanChoicePre`:57 |
| team-identity.js | 是 | `ROLE_NAMES_PRE`:141、`ROLE_DEFAULT_PRE`:142 |
| team-project-map.js | 是 | `resolveLocalWorkspaceForProjectPre`:90 |
| team-sync.js | 是 | `TEAM_SYNC_DEFAULT_INTERVAL_MS_PRE`:37、`TEAM_SYNC_BASE_DELAY_MS_PRE`:38、`TEAM_SYNC_MAX_DELAY_MS_PRE`:39、`TEAM_SYNC_PUSH_PATH_PRE`:40 |
| tier-layer-inject.js | 是 | `isCurrentStatusPre`:126 |
| wb-contract.js | 是 | `WB_STATUSES_PRE_V1`:51、`describeWbReasonPre`:72 |

**分布**：39 个在**可达模块**里（真问题），3 个在孤儿模块里（双重死亡，随模块一起处置，优先级低）。

**可直接引用的 3 个样本**：

1. `session-archive.js:442/453/469` 三个 `readProjcache*` 函数全仓零引用 —— 是被 `indexSessionDirs`（`:390` 附近）取代后留下的旧投影读取器。
2. `team-sync.js:37-40` 四个常量（`TEAM_SYNC_DEFAULT_INTERVAL_MS_PRE` 等）零引用 —— 同名语义实际由配置项 `teamSyncIntervalMs` 走 `index.js`（`index.js:21021` 附近 `transport: engine.config.teamSyncTransport` 同区的 config 读取），即「常量被配置取代」。
3. `isCurrentStatusPre`（`tier-layer-inject.js:126`）是纯别名 `export const isCurrentStatusPre = isCurrentPre` —— 别名先建、从未接线；与 `docs/internal/INJECT-TIER-DOUBLE-CHECK-REPLY-20261028.md:277`「只有定义行，零消费」的历史记录一致。

### 2.4 B 档：173 个「仅模块内自用」（export 冗余，**不是死代码**）

按模块列出（`file:line`）：

| 模块 | 数量 | 符号 |
|---|---|---|
| activation-host.js | 2 | CAPABILITY_SNAPSHOT_PRE_V1:28, detectPacketCapabilityPre:31 |
| activation-inbox.js | 3 | PACKET_SCHEMA_VERSION:24, PACKET_ID_PREFIX:25, validateActivationSkillPre:210 |
| celebration-art.js（孤儿） | 4 | word3dPre:52, CELEBRATION_WORD:74, renderCelebrationArtPre:80, CELEBRATION_OTHER_LANG_GUIDE:96 |
| config-io.js | 1 | CORRUPT_QUARANTINE_PREFIX_PRE_V1:59 |
| context-bridge.js | 6 | OBSERVATION_PREFIX:29, EVIDENCE_PREFIX:30, ACK_REASONS_PRE_V1:48, CITATION_MEMORY_ID_PATTERN_PRE_V1:51, normalizeReadText:187, isSuperseded:511 |
| context-sink-python.js | 1 | PYTHON_CONTEXT_SINK_KIND_PRE:12 |
| continuation-state.js | 2 | parseLegacySessions:121, validateSourceRecord:130 |
| dsh-home.js | 2 | DSH_HOME_DIRNAME_PRE_V1:55, DSH_HOME_FALLBACK_PRE_V1:58 |
| engine-identity.js | 3 | ENGINE_IDENTITY_VERSION:28, ENGINE_IDENTITY_PREFIX:31, weightsDigestOfFilePre:111 |
| episodic-store.js | 6 | EPISODIC_POLICY_VERSION:29, EPISODE_ID_PREFIX:30, EPISODE_ID_RE:31, EPISODE_RETENTION_PRE_V1:37, EPISODE_MIN_SEGMENTS_PRE_V1:40, EPISODE_OUTCOMES_PRE_V1:43 |
| event-carry.js | 1 | EVENT_CARRY_VERSION:17 |
| event-regroup-scan.js（孤儿） | 1 | LEDGER_EXCERPT_CHARS:23 |
| event-render.js | 1 | TRUNC_MARK:26 |
| event-store.js | 3 | EVENT_STATUSES:41, APPLIED_OPS_CAP_PRE:354, quarantineLogPre:533 |
| event-write.js | 3 | EVENT_WRITE_STORE_FILENAME:28, DAY_VIEW_KINDS:31, hhmmOfPre:105 |
| evidence-store.js | 1 | parseDurableEventLine:89 |
| fact-store.js | 12 | FACT_POLICY_VERSION:42, FACT_ID_PREFIX:45, FACT_SCOPES_PRE_V1:51, FACT_SOURCE_CLASSES_PRE_V1:60, FACT_SOURCE_KINDS_PRE_V1:65, FACT_TTL_DEFAULT_PRE_V1:73, FACT_MIN_STATEMENT_CHARS_PRE_V1:142, FACTNESS_MESSAGES_PRE_V1:150, looksFactStatementPre:251, factStatementTextPre:263, looksFactCandidatePre:284, defaultEpistemicStatusPre:308 |
| greeting.js | 1 | WELCOME_TITLE_RAW:31 |
| hub-access.js | 1 | WS_CASE_SENSITIVE_DEFAULT:33 |
| index-sync.js | 1 | toSemanticRecordPre:42 |
| l0-index-sync.js | 4 | L0_INDEX_SYNC_VERSION:40, L0_INDEX_FILE_PREFIX:43, L0_INDEX_WS_HASH_CHARS:46, workspaceKeyShortHashPre:51 |
| l0-index.js | 1 | L0_INDEX_DEFAULT_STATUS:38 |
| ledger-criteria.js（孤儿） | 1 | PLAN_MAX_CHARS_PRE_V1:31 |
| m7-index-sync-host.js | 1 | M7_INDEX_SYNC_HOST_POLICY_VERSION:29 |
| m7-wire.js | 1 | sha256Canonical:73 |
| memory-anchor.js | 1 | SIDECAR_SCHEMA_VERSION:24 |
| memory-envelope.js | 1 | ENVELOPE_BUCKET_TEXT_PRE_V1:58 |
| memory-hub.js | 2 | MEMORY_HUB_POLICY_VERSION:29, KIND_TO_LAYER_PRE_V1:74 |
| memory-mutation.js | 1 | describeMutationReasonPre:47 |
| memory-writer.js | 1 | toBuf:937 |
| migrate-pack.js | 3 | MIGRATE_PACK_MAX_FILES_PRE:42, dedupeStringsPre:619, basenamePre:632 |
| migration-optin-contract.js（正常/工具链） | 2 | OPTIN_HELPER_BEGIN:81, OPTIN_HELPER_END:82 |
| note-status-apply.js | 1 | locateRecordBodyPre:36 |
| official-compaction.js | 3 | stripYamlCommentPre:32, parseScalarLinePre:42, coerceScalarPre:51 |
| plan-render.js | 1 | PLAN_STATUS_LABEL:25 |
| procedure-snapshot-transaction.js | 3 | PROCEDURE_CONFLICT_DIR_PRE_V1:29, emptyProcedureSnapshotPre:32, writeProcedureConflictCopyPre:96 |
| procedure-store.js | 6 | PROCEDURE_POLICY_VERSION:65, PROCEDURE_ID_RE:67, PROCEDURE_ARCHIVE_AFTER_DAYS_PRE_V1:77, PROCEDURE_RISKS_PRE_V1:80, PROCEDURE_SCOPES_PRE_V1:95, PROCEDURE_ACTIVE_LEVEL_PRE_V1:117 |
| recall-stats.js | 1 | RECALL_CHANNELS_PRE:28 |
| rerank-host.js（孤儿） | 1 | RERANK_CACHE_MAX_PRE_V1:32 |
| rules-edit.js | 3 | RULE_DATE_SECTION_RE_PRE_V1:37, RULE_ITEM_RE_PRE_V1:40, RULE_ITEM_MAX_CHARS_PRE_V1:43 |
| rules-layer.js | 4 | RULE_NOTE_PREFIX_PRE_V1:233, splitRuleItemsPre:246, RULE_TRUNC_POINTER_PRE_V1:403, truncateRuleLinePre:425 |
| semantic-js.js | 3 | JS_SEMANTIC_ENGINE_VERSION:22, JS_SEMANTIC_DL_VERSION:23, SEMANTIC_DL_MIRRORS_PRE_V1:592 |
| session-archive.js | 9 | AUTO_ARCHIVE_DAYS_MAX:34, AUTO_DELETE_DAYS_MAX:35, DEFAULT_AUTO_CONFIG:44, validateDays:57, descendantsOf:146, canonicalSessionId:244, dirSize:252, isInside:271, relativeWithin:276 |
| shadow-host.js | 1 | truncateAuditEvent:31 |
| shadow-retrieval.js | 7 | STOPWORDS_HIT_PRE_V2:24, INDEX_PREFIX:27, RETRIEVAL_PREFIX:28, CANDIDATE_PREFIX:29, DROP_REASONS:85, isStopWord:216, logDateFromSourceRef:426 |
| skill-export-host.js | 1 | SKILL_EXPORT_PREFIX_PRE_V1:24 |
| skin-center.js | 4 | SKIN_SCHEMA_VERSION:33, SKIN_SOURCE_LAYERS:36, isPublicToken:52, isAcceptableTokenValue:60 |
| state-commit.js（孤儿） | 1 | COMMIT_REASONS_PRE_V1:46 |
| storage-manage.js | 3 | STORAGE_MANAGE_VERSION_PRE_V1:23, REPAIRABLE_REASONS_PRE_V1:31, ABSENT_REASONS_PRE_V1:33 |
| subagent-gc.js | 1 | DEFAULT_KEEP_MS:36 |
| team-baseline.js | 1 | TEAM_BASELINE_OPTIONAL_PRE:48 |
| team-board.js | 4 | PLAN_CHOICE_LOCAL:25, PLAN_CHOICE_REMOTE:26, PLAN_CHOICE_MANUAL:27, TEAM_BOARD_MAX_DRAFT_PRE:28 |
| team-calendar.js | 4 | TRACK_LOCAL:23, TRACK_TEAM:24, readTrackPre:34, writeTrackPre:56 |
| team-derived.js | 2 | TEAM_DERIVED_DEFAULT_DEBOUNCE_MS:23, TEAM_DERIVED_DEFAULT_MAX_WAIT_MS:24 |
| team-identity.js | 1 | CAPABILITY_MATRIX_PRE:136 |
| team-inject.js | 4 | TEAM_INJECT_DEFAULT_PRIORITY:24, TEAM_INJECT_MAX_SEGMENTS_PRE:25, remainingPre:45, pickTeamSegmentsPre:65 |
| team-merge.js | 7 | TEAM_MERGE_MAX_CONFLICTS_PRE:24, MERGE_NOOP:26, MERGE_TAKE_REMOTE:27, MERGE_KEEP_LOCAL:28, MERGE_CONFLICT:29, decideKeyPre:52, mergeThreeWayPre:73 |
| team-outbox.js | 2 | TEAM_OUTBOX_MAX_ITEMS_PRE:70, TEAM_OUTBOX_TMP_SUFFIX_PRE:72 |
| team-project-map.js | 2 | normalizeRemoteUrl:36, projectIdOf:59 |
| team-sync.js | 1 | teamUpgradeDecisionPre:172 |
| tier-layer-inject.js | 1 | SKIP_REASON_TEXT_PRE_V1:363 |
| tier0-usage.js | 1 | tier0KeyPre:27 |
| upgrade-apply.js（孤儿） | 6 | UPGRADE_APPLY_SCHEMA:52, PLAN_FILENAME:54, PLAN_ARCHIVE_DIRNAME:56, DRAFT_EVENT_FIELDS:59, sha256FilePre:88, resetValidatorCachePre:127 |
| upgrade-estimate.js | 1 | OPENCODE_USABLE_RATIO:47 |
| upgrade-pending.js | 1 | PENDING_TOOLS:52 |
| wb-contract.js | 3 | WB_REASONS_PRE_V1:54, CRITERIA_GATE_VERSION:506, CRITERIA_LIMITS_PRE_V1:517 |
| wb-sidecar.js | 5 | extractCuesPre:137, stripTypeMarkLinesPre:282, sectionSemanticTitlePre:290, buildVersionsPre:526, criteriaWeightPre:644 |

> 典型样本：`event-store.js:41` `EVENT_STATUSES` 只在 `event-store.js:211` `if (!EVENT_STATUSES.includes(ev.status))` 用到 —— 这是**正确用法**，只是没必要 export。`hub-access.js:33` `WS_CASE_SENSITIVE_DEFAULT` 同样在 `:46`/`:86` 自用。

### 2.5 C 档：347 个「仅测试引用」（92 个模块，完整计数表）

| 模块 (符号数) | 模块 (符号数) | 模块 (符号数) | 模块 (符号数) |
|---|---|---|---|
| `activation-inbox.js` (12) | `degrade.js` (12) | `state-commit.js` (11) | `tier-layer-inject.js` (11) |
| `context-bridge.js` (9) | `rules-layer.js` (9) | `upgrade-apply.js` (9) | `datadir.js` (7) |
| `event-regroup-propose.js` (7) | `event-regroup-scan.js` (7) | `injection-zones.js` (7) | `tier0-catalog.js` (7) |
| `upgrade-pending.js` (7) | `wb-contract.js` (7) | `engine-identity.js` (6) | `event-render.js` (6) |
| `event-store.js` (6) | `fact-store.js` (6) | `l0-extract.js` (6) | `rerank-host.js` (6) |
| `skill-export-host.js` (6) | `upgrade-estimate.js` (6) | `ledger-criteria.js` (5) | `memory-writer.js` (5) |
| `plan-render.js` (5) | `python-runtime.js` (5) | `team-baseline.js` (5) | `team-transport.js` (5) |
| `event-regroup-apply.js` (4) | `global-brief.js` (4) | `memory-envelope.js` (4) | `migrate-pack.js` (4) |
| `procedure-store.js` (4) | `shadow-retrieval.js` (4) | `upgrade-links.js` (4) | `acceptance.js` (3) |
| `config-io.js` (3) | `consolidate-filter.js` (3) | `diagnostic-error.js` (3) | `event-carry.js` (3) |
| `event-plan.js` (3) | `event-regroup.js` (3) | `evidence-store.js` (3) | `greeting.js` (3) |
| `l0-index.js` (3) | `m7-wire.js` (3) | `memory-importance.js` (3) | `memory-mutation-transaction.js` (3) |
| `memory-mutation.js` (3) | `note-status.js` (3) | `procedure-observation.js` (3) | `skill-export.js` (3) |
| `team-sync.js` (3) | `team-upgrade-driver.js` (3) | `user-portrait.js` (3) | `water-window.js` (3) |
| `wb-sidecar.js` (3) | `board-mode.js` (2) | `embedding-config.js` (2) | `episodic-store.js` (2) |
| `event-write.js` (2) | `hub-io.js` (2) | `intent-clean.js` (2) | `layout-config.js` (2) |
| `memory-anchor.js` (2) | `memory-hub.js` (2) | `official-compaction.js` (2) | `plan-store.js` (2) |
| `python-sidecar-client.js` (2) | `recall-fusion.js` (2) | `semantic-js.js` (2) | `session-archive.js` (2) |
| `skin-center.js` (2) | `subagent-gc.js` (2) | `upgrade-draft.js` (2) | `context-host.js` (1) |
| `dsh-home.js` (1) | `engine-switch.js` (1) | `evidence-agg.js` (1) | `fs-retry.js` (1) |
| `hub-access.js` (1) | `index-sync.js` (1) | `intent-clean-safe.js` (1) | `l0-index-sync.js` (1) |
| `m4-corpus.js` (1) | `migration-optin-contract.js` (1) | `migration-prompt.js` (1) | `recall-stats.js` (1) |
| `semantic-decide.js` (1) | `team-outbox.js` (1) | `team-pull.js` (1) | `wasm-paths.js` (1) |

**合计 347 个符号 / 92 个模块**（逐模块求和 = 347，与总档位一致）。

其中**孤儿模块**的 C 档：`ledger-criteria.js`(5)、`state-commit.js`(11)、`upgrade-apply.js`(9)、`event-regroup-propose`(7)、`event-regroup-scan`(7)、`event-regroup-apply`(4)、`event-regroup`(3)、`rerank-host.js`(6)、`upgrade-links.js`(4)、`acceptance.js`(3)、`upgrade-draft.js`(2)、`wasm-paths`(1)、`team-transport-http`(1) —— 这些是「双重死亡」（模块不可达 + 导出只被测试用），随手删模块即可，不能作为「生产缺能力」的证据。

> **判读**：C 档不是死代码，而是「**生产只用了该模块的一部分导出，其余导出只为测试而存在**」。占比 29.8%（347/1163）是本仓 `export` 面过宽的直接量度；它同时说明 **smoke 覆盖的是模块契约、不是生产路径** —— 与块 1「测试在、生产调用不在」是同一结构性问题的两面。

### 2.6 工具链单列（仅 `tools/` 引用：8 个符号 / 5 个模块）

| 模块 | 符号 |
|---|---|
| event-store.js | `LEGACY_UPGRADE_FIELDS_PRE`、`upgradeLegacyEventFieldsPre` |
| team-attribution.js | `createTeamAttribution`、`TEAM_ATTRIBUTION_FILE` |
| team-merge.js | `createTeamMerge` |
| team-pull.js | `TEAM_PULL_KINDS_PRE` |
| wb-sidecar.js | `normalizeRelPathPre`、`buildSidecarEntriesPre` |

（8 个符号分布在 5 个模块，全部可达；属工具链专用导出，不构成清理项。）

---
## 3 · 块 3：枚举常量的消费点

### 3.1 口径与实测数字

- 定义式：`Object.freeze([ ... ])`（含多行定义），扫描 `lib/*.js` 全部 144 个模块，排除 `client.js`（浏览器 bundle，无 ESM 常量）与 `ev4-blocks.generated.js`（生成物）。
- **实测 107 个常量**（含 `index.js` 内 5 个模块级常量；不含 `index.js` 则为 102），**合计 1,184 个顶层元素**；其中 88 个 `export`、19 个内部常量。多行定义 38 个。
- **与 Lead 基线（100 个 / 610 值）不一致，如实记录**：本轮无法在该口径下复现 100/610。两个最近似的复现口径为：
  - 排除两个超大词表（`STOPWORDS_HIT_PRE_V2` 507 词、`DROP_REASONS` 48 词）后 = **677** 值；
  - 仅统计「单行定义」= **69 个常量 / 786 值**。
  ⇒ 结论层面不受影响（零消费清单以实测为准），但**数值以本报告为准，Lead 的 100/610 应视为口径不同**。
- 读取点判定：整词匹配，**排除定义行自身及多行定义的整个 span**、**排除纯注释行**、**排除行尾 `//` 注释后的部分**；统计同文件内与跨文件两类。
  - 注意：`index.js` 明确计入（它是最主要消费者），`client.js` 也计入。

### 3.2 完整清单（107 个）

| 定义位置 | 常量名 | 值数 | export | 读取点 | 同文件/跨文件 | 模块可达 |
|---|---|---|---|---|---|---|
| `acceptance.js:16` | `ACCEPTANCE_ITEMS_PRE_V1` | 7 | 是 | 3 | 3 / 0 | **孤儿** |
| `activation-inbox-state.js:21` | `OFFER_REASONS` | 10 | 否 | 0 | 0 / 0 | 可达 |
| `activation-inbox.js:54` | `ACTIVATION_LEVELS_PRE_V1` | 6 | 是 | 2 | 2 / 0 | 可达 |
| `activation-inbox.js:56` | `DELIVERY_STATES_PRE_V1` | 5 | 是 | 2 | 1 / 1 | 可达 |
| `board-mode.js:26` | `BOARD_MODES_PRE_V1` | 3 | 是 | 0 | 0 / 0 | 可达 |
| `config-io.js:120` | `RENAME_RETRY_DELAYS_PRE_V1` | 5 | 否 | 2 | 2 / 0 | 可达 |
| `context-bridge.js:45` | `ACCESS_KINDS_PRE_V1` | 6 | 是 | 1 | 1 / 0 | 可达 |
| `context-bridge.js:48` | `ACK_REASONS_PRE_V1` | 6 | 是 | 1 | 1 / 0 | 可达 |
| `context-bridge.js:54` | `CORRECTION_LEXICON_PRE_V1` | 17 | 是 | 3 | 1 / 2 | 可达 |
| `degrade.js:49` | `ARM_STATES_PRE_V1` | 5 | 是 | 1 | 1 / 0 | 可达 |
| `degrade.js:52` | `DEGRADE_KINDS_PRE_V1` | 4 | 是 | 0 | 0 / 0 | 可达 |
| `degrade.js:91` | `SESSION_SEARCH_POSTURES_PRE_V1` | 6 | 是 | 2 | 0 / 2 | 可达 |
| `degrade.js:96` | `SESSION_SEARCH_EXPECTED_POSTURES_PRE_V1` | 4 | 是 | 1 | 1 / 0 | 可达 |
| `degrade.js:231` | `DEGRADE_PERSIST_REASONS_PRE_V1` | 6 | 是 | 0 | 0 / 0 | 可达 |
| `degrade.js:331` | `QUOTA_VERDICTS_PRE_V1` | 4 | 是 | 0 | 0 / 0 | 可达 |
| `engine-identity.js:34` | `ENGINE_IDENTITY_FIELDS` | 10 | 是 | 1 | 1 / 0 | 可达 |
| `episodic-store.js:43` | `EPISODE_OUTCOMES_PRE_V1` | 4 | 是 | 1 | 1 / 0 | 可达 |
| `ev4-prototype-blocks.js:51` | `EV4_PROTO_PART_ORDER` | 6 | 是 | 2 | 0 / 2 | **孤儿** |
| `event-plan.js:18` | `LEDGER_SECTIONS` | 4 | 是 | 2 | 2 / 0 | 可达 |
| `event-regroup-scan.js:148` | `EVENT_BOUNDARY_RULES` | 7 | 是 | 2 | 2 / 0 | **孤儿** |
| `event-render.js:21` | `CHECKPOINT_QUAD_KEYS` | 4 | 否 | 1 | 1 / 0 | 可达 |
| `event-store.js:31` | `EVENT_KINDS` | 6 | 是 | 6 | 3 / 3 | 可达 |
| `event-store.js:33` | `EVENT_CONFIDENCES` | 4 | 是 | 6 | 3 / 3 | 可达 |
| `event-store.js:35` | `CHECKPOINT_QUAD_FIELDS` | 4 | 是 | 1 | 1 / 0 | 可达 |
| `event-store.js:38` | `PANEL_KINDS` | 6 | 是 | 2 | 2 / 0 | 可达 |
| `event-store.js:40` | `PERCEPT_STAGES` | 5 | 是 | 2 | 2 / 0 | 可达 |
| `event-store.js:41` | `EVENT_STATUSES` | 3 | 是 | 1 | 1 / 0 | 可达 |
| `event-store.js:43` | `EVENT_TOP_FIELDS` | 26 | 是 | 2 | 2 / 0 | 可达 |
| `event-store.js:79` | `PERCEPT_KEYS_PRE_V1` | 4 | 否 | 1 | 1 / 0 | 可达 |
| `event-store.js:294` | `LEGACY_UPGRADE_FIELDS_PRE` | 10 | 是 | 1 | 1 / 0 | 可达 |
| `event-write.js:31` | `DAY_VIEW_KINDS` | 1 | 是 | 2 | 2 / 0 | 可达 |
| `fact-store.js:51` | `FACT_SCOPES_PRE_V1` | 2 | 是 | 2 | 2 / 0 | 可达 |
| `fact-store.js:54` | `FACT_EPISTEMIC_STATUSES_PRE_V1` | 3 | 是 | 2 | 2 / 0 | 可达 |
| `fact-store.js:57` | `FACT_TRENDS_PRE_V1` | 5 | 是 | 2 | 2 / 0 | 可达 |
| `fact-store.js:60` | `FACT_SOURCE_CLASSES_PRE_V1` | 5 | 是 | 1 | 1 / 0 | 可达 |
| `fact-store.js:65` | `FACT_SOURCE_KINDS_PRE_V1` | 2 | 是 | 1 | 1 / 0 | 可达 |
| `fact-store.js:68` | `UPSERT_OUTCOMES_PRE_V1` | 6 | 是 | 0 | 0 / 0 | 可达 |
| `fact-store.js:145` | `FACTNESS_CODES_PRE_V1` | 5 | 是 | 0 | 0 / 0 | 可达 |
| `fs-retry.js:18` | `RENAME_RETRY_DELAYS` | 5 | 是 | 1 | 1 / 0 | 可达 |
| `handoff-anchor.js:18` | `HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1` | 4 | 是 | 3 | 1 / 2 | 可达 |
| `hub-message-filter.js:73` | `HUB_NOISE_KINDS_PRE` | 2 | 是 | 2 | 1 / 1 | 可达 |
| `index.js:210` | `CROSS_WS_ALLOWED_LABELS` | 1 | 否 | 1 | 1 / 0 | 可达 |
| `index.js:215` | `CONTINUE_CREATE_FALLBACK_ALLOWED_CODES` | 1 | 否 | 1 | 1 / 0 | 可达 |
| `index.js:1600` | `PROMPT_SECTION_KEYS_PRE_V1` | 14 | 是 | 1 | 1 / 0 | 可达 |
| `index.js:1621` | `PROMPT_SECTION_MUST_PRE_V1` | 3 | 是 | 1 | 1 / 0 | 可达 |
| `index.js:2815` | `SUBAGENT_EFFORT_WHITELIST` | 4 | 否 | 2 | 2 / 0 | 可达 |
| `injection-zones.js:26` | `ZONES_PRE_V1` | 3 | 是 | 2 | 2 / 0 | 可达 |
| `l0-extract.js:68` | `DEGENERATE_HEADING_RES` | 8 | 否 | 1 | 1 / 0 | 可达 |
| `l0-extract.js:101` | `L0_LAYERS` | 5 | 是 | 5 | 1 / 4 | 可达 |
| `l0-extract.js:104` | `L0_STATUSES` | 3 | 是 | 4 | 2 / 2 | 可达 |
| `l0-extract.js:168` | `L0_LAYER_DISPLAY_ORDER_PRE_V1` | 5 | 是 | 1 | 1 / 0 | 可达 |
| `layout-config.js:20` | `LAYOUT_REGIONS` | 7 | 是 | 4 | 4 / 0 | 可达 |
| `layout-config.js:23` | `LAYOUT_SLOTS` | 18 | 是 | 4 | 4 / 0 | 可达 |
| `layout-config.js:29` | `LAYOUT_BLOCK_KINDS` | 10 | 是 | 3 | 3 / 0 | 可达 |
| `layout-config.js:34` | `AUTHOR_SURFACE_KEYS` | 5 | 是 | 0 | 0 / 0 | 可达 |
| `ledger-criteria.js:23` | `HANDOFF_SECTIONS_PRE_V1` | 4 | 是 | 1 | 1 / 0 | **孤儿** |
| `ledger-criteria.js:26` | `CRITERIA_PLACEHOLDERS_PRE_V1` | 7 | 是 | 4 | 1 / 3 | **孤儿** |
| `m7-wire.js:34` | `JS_FRAME_TYPES_PRE_V1` | 8 | 是 | 2 | 2 / 0 | 可达 |
| `m7-wire.js:39` | `PY_FRAME_TYPES_PRE_V1` | 6 | 是 | 4 | 2 / 2 | 可达 |
| `memory-envelope.js:40` | `ENVELOPE_BUCKETS_PRE_V1` | 3 | 是 | 3 | 3 / 0 | 可达 |
| `memory-envelope.js:53` | `ENVELOPE_PRIORITIES_PRE_V1` | 3 | 是 | 0 | 0 / 0 | 可达 |
| `note-status.js:52` | `NOTE_STATUSES_PRE_V1` | 3 | 是 | 2 | 0 / 2 | 可达 |
| `procedure-store.js:71` | `PROCEDURE_STAGES_PRE_V1` | 4 | 是 | 1 | 1 / 0 | 可达 |
| `procedure-store.js:80` | `PROCEDURE_RISKS_PRE_V1` | 3 | 是 | 3 | 3 / 0 | 可达 |
| `procedure-store.js:83` | `PROCEDURE_LEVELS_PRE_V1` | 6 | 是 | 0 | 0 / 0 | 可达 |
| `procedure-store.js:95` | `PROCEDURE_SCOPES_PRE_V1` | 2 | 是 | 3 | 3 / 0 | 可达 |
| `procedure-store.js:773` | `PROCEDURE_UPDATABLE_FIELDS_PRE_V1` | 7 | 否 | 1 | 1 / 0 | 可达 |
| `procedure-store.js:775` | `PROCEDURE_PROTECTED_FIELDS_PRE_V1` | 20 | 否 | 1 | 1 / 0 | 可达 |
| `procedure-store.js:776` | `PROCEDURE_LINE_FIELDS_PRE_V1` | 5 | 否 | 1 | 1 / 0 | 可达 |
| `recall-fusion.js:35` | `FUSION_LAYER_ORDER_PRE_V1` | 5 | 是 | 2 | 2 / 0 | 可达 |
| `rules-layer.js:53` | `LOG_KINDS_PRE_V1` | 4 | 是 | 2 | 0 / 2 | 可达 |
| `rules-layer.js:59` | `RULE_MARKERS_PRE_V1` | 6 | 是 | 1 | 1 / 0 | 可达 |
| `rules-layer.js:64` | `RULE_CONSTRAINT_WORDS_PRE_V1` | 10 | 是 | 1 | 1 / 0 | 可达 |
| `rules-layer.js:73` | `RULE_DESCRIPTION_MARKERS_PRE_V1` | 10 | 是 | 1 | 1 / 0 | 可达 |
| `semantic-js.js:577` | `E5_SMALL_Q8_FILES_PRE_V1` | 5 | 否 | 2 | 2 / 0 | 可达 |
| `shadow-retrieval.js:24` | `STOPWORDS_HIT_PRE_V2` | 507 | 是 | 1 | 1 / 0 | 可达 |
| `shadow-retrieval.js:85` | `DROP_REASONS` | 48 | 是 | 1 | 1 / 0 | 可达 |
| `skill-export.js:43` | `SKILL_NOTICE_ANCHORS_PRE_V1` | 5 | 是 | 1 | 1 / 0 | 可达 |
| `skin-assets.js:64` | `SKIN_ASSET_KEYS` | 6 | 是 | 4 | 0 / 4 | 可达 |
| `skin-center.js:16` | `SKIN_TOKEN_KEYS` | 42 | 是 | 1 | 1 / 0 | 可达 |
| `skin-center.js:36` | `SKIN_SOURCE_LAYERS` | 3 | 是 | 2 | 2 / 0 | 可达 |
| `state-commit.js:38` | `MEMORY_STATUS_PRE` | 3 | 是 | 0 | 0 / 0 | **孤儿** |
| `state-commit.js:39` | `TASK_STATE_PRE` | 3 | 是 | 0 | 0 / 0 | **孤儿** |
| `state-commit.js:40` | `ARCHIVE_STATE_PRE` | 2 | 是 | 0 | 0 / 0 | **孤儿** |
| `state-commit.js:43` | `COMMIT_REQUIRED_PRE_V1` | 4 | 是 | 0 | 0 / 0 | **孤儿** |
| `storage-manage.js:31` | `REPAIRABLE_REASONS_PRE_V1` | 4 | 是 | 1 | 1 / 0 | 可达 |
| `storage-manage.js:33` | `ABSENT_REASONS_PRE_V1` | 1 | 是 | 1 | 1 / 0 | 可达 |
| `team-baseline.js:40` | `TEAM_BASELINE_REQUIRED_PRE` | 1 | 是 | 3 | 3 / 0 | 可达 |
| `team-baseline.js:48` | `TEAM_BASELINE_OPTIONAL_PRE` | 3 | 是 | 1 | 1 / 0 | 可达 |
| `team-baseline.js:313` | `TEAM_VERDICTS_PRE` | 3 | 是 | 0 | 0 / 0 | 可达 |
| `team-upgrade-driver.js:38` | `TEAM_UPGRADE_PHASES_PRE` | 6 | 是 | 4 | 2 / 2 | 可达 |
| `team-upgrade-driver.js:43` | `TEAM_UPGRADE_REQUIRED_CAPS_PRE` | 5 | 是 | 1 | 1 / 0 | 可达 |
| `tier-layer-inject.js:69` | `TIER_LAYER_ORDER_PRE_V1` | 5 | 是 | 2 | 2 / 0 | 可达 |
| `tier0-catalog.js:86` | `KNOWN_LAYERS` | 5 | 否 | 8 | 8 / 0 | 可达 |
| `tier0-catalog.js:89` | `SOURCE_SPECS` | 4 | 否 | 1 | 1 / 0 | 可达 |
| `upgrade-apply.js:59` | `DRAFT_EVENT_FIELDS` | 23 | 是 | 2 | 2 / 0 | **孤儿** |
| `upgrade-draft.js:106` | `TOP_KEYS` | 4 | 否 | 1 | 1 / 0 | **孤儿** |
| `upgrade-draft.js:108` | `EVENT_KEYS` | 12 | 否 | 1 | 1 / 0 | **孤儿** |
| `upgrade-draft.js:113` | `SECTION_KEYS` | 4 | 否 | 4 | 4 / 0 | **孤儿** |
| `upgrade-draft.js:115` | `CHECKPOINT_KEYS` | 13 | 否 | 1 | 1 / 0 | **孤儿** |
| `upgrade-draft.js:120` | `SELFCHECK_KEYS` | 3 | 否 | 2 | 2 / 0 | **孤儿** |
| `upgrade-estimate.js:36` | `UPGRADE_EFFORT_CHOICES` | 4 | 是 | 0 | 0 / 0 | 可达 |
| `upgrade-pending.js:52` | `PENDING_TOOLS` | 3 | 是 | 3 | 3 / 0 | 可达 |
| `user-portrait.js:49` | `PORTRAIT_STAGES` | 2 | 是 | 2 | 2 / 0 | 可达 |
| `user-portrait.js:65` | `PORTRAIT_KIND_BYPASS` | 1 | 是 | 1 | 1 / 0 | 可达 |
| `wb-contract.js:51` | `WB_STATUSES_PRE_V1` | 3 | 是 | 0 | 0 / 0 | 可达 |
| `wb-contract.js:514` | `CRITERIA_PLACEHOLDERS_PRE_V1` | 7 | 是 | 4 | 2 / 2 | 可达 |

### 3.3 零消费清单（17 个 / 16.0%）

| 定义位置 | 常量名 | 值数 | 模块可达 | 判读 |
|---|---|---|---|---|
| `activation-inbox-state.js:21` | `OFFER_REASONS` | 10 | 可达 | **真问题（可达模块里的死枚举）** |
| `board-mode.js:26` | `BOARD_MODES_PRE_V1` | 3 | 可达 | **真问题（可达模块里的死枚举）** |
| `degrade.js:52` | `DEGRADE_KINDS_PRE_V1` | 4 | 可达 | **真问题（可达模块里的死枚举）** |
| `degrade.js:231` | `DEGRADE_PERSIST_REASONS_PRE_V1` | 6 | 可达 | **真问题（可达模块里的死枚举）** |
| `degrade.js:331` | `QUOTA_VERDICTS_PRE_V1` | 4 | 可达 | **真问题（可达模块里的死枚举）** |
| `fact-store.js:68` | `UPSERT_OUTCOMES_PRE_V1` | 6 | 可达 | **真问题（可达模块里的死枚举）** |
| `fact-store.js:145` | `FACTNESS_CODES_PRE_V1` | 5 | 可达 | **真问题（可达模块里的死枚举）** |
| `layout-config.js:34` | `AUTHOR_SURFACE_KEYS` | 5 | 可达 | **真问题（可达模块里的死枚举）** |
| `memory-envelope.js:53` | `ENVELOPE_PRIORITIES_PRE_V1` | 3 | 可达 | **真问题（可达模块里的死枚举）** |
| `procedure-store.js:83` | `PROCEDURE_LEVELS_PRE_V1` | 6 | 可达 | **真问题（可达模块里的死枚举）** |
| `state-commit.js:38` | `MEMORY_STATUS_PRE` | 3 | **孤儿** | 双重死亡（随模块处置） |
| `state-commit.js:39` | `TASK_STATE_PRE` | 3 | **孤儿** | 双重死亡（随模块处置） |
| `state-commit.js:40` | `ARCHIVE_STATE_PRE` | 2 | **孤儿** | 双重死亡（随模块处置） |
| `state-commit.js:43` | `COMMIT_REQUIRED_PRE_V1` | 4 | **孤儿** | 双重死亡（随模块处置） |
| `team-baseline.js:313` | `TEAM_VERDICTS_PRE` | 3 | 可达 | **真问题（可达模块里的死枚举）** |
| `upgrade-estimate.js:36` | `UPGRADE_EFFORT_CHOICES` | 4 | 可达 | **真问题（可达模块里的死枚举）** |
| `wb-contract.js:51` | `WB_STATUSES_PRE_V1` | 3 | 可达 | **真问题（可达模块里的死枚举）** |

**分布**：**13 个在可达模块里**（真问题），**4 个在孤儿模块 `state-commit.js` 里**（双重死亡，优先级低）。

**最值得注意的 3 个（可达模块 + 语义重要）**：

1. `board-mode.js:26` `BOARD_MODES_PRE_V1 = Object.freeze(['legacy','graph','event'])` —— 白板三档模式清单**零读取**。档位判定 `resolveBoardModePre` 用 if 链手工枚举（`board-mode.js:29-40`），**非法值确实会回落 `legacy` 并置 `source:'fallback'`** —— 即「兜底存在，但与常量脱钩」：新增第 4 档时只改常量不会生效，且 `BOARD_MODES_PRE_V1` 也无法用于「校验用户输入并在 UI 上报错」。
2. `wb-contract.js:51` `WB_STATUSES_PRE_V1 = Object.freeze(['current','superseded','retracted'])` —— 白板状态三值零读取。写侧接受任意 `status` 字符串，无枚举校验。
3. `memory-envelope.js:53` `ENVELOPE_PRIORITIES_PRE_V1 = Object.freeze(['low','normal','must'])` —— 信封优先级三档零读取，与同文件 `:40` 的 `ENVELOPE_BUCKETS_PRE_V1`（3 个读点）形成对照：同一模块里一个在跑、一个没接线。

> 对照说明：这 3 个都是「**枚举定义与校验脱节**」而非「功能缺失」——值本身被硬编码在各分支里，所以今天行为正确；风险是**新增第 4 个模式/状态时只改常量、以为生效**。属 P2 清理，不是 P0。

### 3.4 与块 1/块 2 的交叉（双重死亡）

- 孤儿模块里的零消费常量 **4 个**（`state-commit.js` 的 `MEMORY_STATUS_PRE`/`TASK_STATE_PRE`/`ARCHIVE_STATE_PRE`/`COMMIT_REQUIRED_PRE_V1`）—— 模块整体不可达，随模块一起删除/归档即可，**不单独立项**。
- 同时出现在块 2 的 A 档（全仓零引用导出）与本块零消费清单的常量：`UPSERT_OUTCOMES_PRE_V1`、`FACTNESS_CODES_PRE_V1`、`ENVELOPE_PRIORITIES_PRE_V1`、`PROCEDURE_LEVELS_PRE_V1`、`TEAM_VERDICTS_PRE`、`WB_STATUSES_PRE_V1`、`COMMIT_REQUIRED_PRE_V1` —— **7 个符号双重死亡**（导出零引用 + 常量零读取）。

---
## 4 · 块 4：严重程度分级与修法建议

### 4.1 分级总表

| 编号 | 项 | 级别 | 影响面 | 修复成本量级 | 建议动作 | 落点 |
|---|---|---|---|---|---|---|
| **P0-1** | event-regroup 四件套（42,839 B） | **P0** | **用户可感**：事件碎片化——一篇账本=一个事件、事件名取目标段首行、kind 恒 unknown、四段常空 | **需补触发条件**（接线 + 分批/令牌/人审） | **接线**（分两段：先读后写） | `index.js:8581 curateUnarchivedPre` → R2 `scanAllWorkspacesPre`/`buildRegroupPromptPre`；`index.js:8647 writeCuratedEventsPre` → R6 `applyRegroupPre`；替换 `index.js:8598 groupIntoCandidateEventsPre` |
| **P1-1** | rerank-host.js（8,715 B） | P1 | 召回排序：无精排 ⇒ recall@1 停在词法/语义融合层，用户感知为"答非所问"但不致命 | **需补触发条件**（`opts.rerankFn` 实现 + 算力） | **标注保留 + 排期接线**（当前无 rerank 模型可注入） | 注入点在召回链（`recall`/`smart-recall` 路由取到候选之后），模块已就绪，只缺 `rerankFn` |
| **P1-2** | upgrade-apply + upgrade-draft（82,482 B） | P1 | **数据安全层缺位**：设计里的令牌制/快照先行/闸 8–10 在生产路径上不存在，改由"子代理直接写盘 + 落地后证据核对"承担 | **需重新设计**（与现行子代理路线二选一，或补 apply 端点 + 令牌） | **标注弃用 + 归档**；不得直接删除（未来要做受控落盘时的现成实现） | 头注释加"已被 startUpgradeJobPre 子代理路线取代（`index.js:11617`）"；路由表 `index.js:449-559` 无 apply 端点 |
| **P1-3** | team-transport-http.js（21,853 B） | P1 | T2「涉密内网自建服务端」通道不可用；前端已 `disabled` 并标注，用户能看见"不可用" | **接一行**（装配层注入 `createHttpBackend`） | **接线**（成本最低、收益明确）或维持"诚实标注" | `index.js` 装配处传 `options.createHttpBackend`；`team-transport.js:593-597` 已写好 fail-closed 分支 |
| **P2-1** | 42 个全仓零引用导出（39 个在可达模块） | P2 | 无运行时影响；增加阅读成本与误接线风险 | 接一行（删 `export` 或删符号） | **删除/去 export** | 见 §2.3 清单 |
| **P2-2** | 13 个可达模块里的零消费枚举常量 | P2 | 无运行时影响；枚举与校验脱节 ⇒ 未来加值不生效 | 接一行（补校验分支）或删除 | **补校验**（推荐）或删除 | `board-mode.js:26`、`wb-contract.js:51`、`memory-envelope.js:53` 等，见 §3.3 |
| **P2-3** | 347 个「仅测试引用」导出（92 模块） | P2 | 无运行时影响；是"测试覆盖模块契约、不覆盖生产路径"的量度 | 需分批（逐模块判定是否真需要 export） | **分批收敛**（先动 P3 模块，再动可达模块） | 见 §2.5 |
| **P2-4** | upgrade-links.js 双真源（1,858 B） | P2 | 改一处漏一处：宿主模块 vs `client.js:8356` 手抄镜像 | 接一行（改由宿主路由下发）或明确"client.js 为唯一真源" | **二选一定真源**（建议：保留 client.js 手写常量，删除宿主模块或降级为测试夹具） | `client.js:8356`/`:9531-9542`、`tests/smoke/smoke-test-upgrade-wizard-client.mjs:91` |
| **P3-1** | celebration-art.js（5,423 B） | P3 | 无（前端从无该渲染分支，`client.js` `celebrat` 0 命中） | 删除即完成 | **删除或归档** | 若要做"整理完成庆祝"，需同批改前端，届时再取回 |
| **P3-2** | ledger-criteria.js（7,985 B） | P3 | 无运行时影响；但它是**第二份判据实现**，未来接线会静默换判据 | 删除即完成（先确认无引用） | **删除**（判据真源保留 `wb-contract.js`） | `index.js:162` 已 import `wb-contract` 的同名函数 |
| **P3-3** | state-commit.js（12,383 B） | P3 | 无（生产用 `m4-corpus` 的 `CorpusRegistry` 算 miv，口径不同） | 删除/归档即完成 | **归档**（"统一状态提交契约"若要做需重新设计） | `index.js:9991-10004` `tierCurrentMivPre` |
| **P3-4** | acceptance.js（4,130 B） | P3 | 无（发布门从未被读） | 接一行（release 流程读它）或删除 | **接线**（价值=发布纪律可执行）**或删除**；二者择一，不要留着 | `tools/release.mjs`（现无引用） |

### 4.2 P0-1 的修复方案（不写实现，只给落点与判据）

两段式，**先读后写**可显著降低风险：

1. **第一段（只读，零风险）**：`curateUnarchivedPre` 出草案时，并行跑 R2 `scanAllWorkspacesPre` + `buildRegroupPromptPre`，把 AI 输入的 prompt **附在 dryRun 预览里**（不改变现有 `groupIntoCandidateEventsPre` 的产出）。判据：dryRun 返回体新增字段、现有字段逐字节不变、`smoke-test-v5-p6-r2-regroup-scan` 仍绿。
2. **第二段（写，需要令牌）**：`writeCuratedEventsPre` 的落盘改走 R6 `applyRegroupPre`（令牌/快照/回滚/不物理删除四件套已实现），把 `groupIntoCandidateEventsPre` 降级为**离线兜底**（AI 不可用时）。判据：`proposalTokenPre` 校验生效、失败可 `rollbackFromSnapshotPre`、旧事件标 `archived` 而非删除。

**不建议**先删 `groupIntoCandidateEventsPre`：它是当前唯一在跑的实现，先接新链再降级旧链。

### 4.3 一句话优先级

**接 event-regroup 的 R2→R3（只读提案）是投入产出最高的一步**：它不改写盘路径、复用现成 4 个 smoke 套件，且直接对准用户报的「事件碎片化」；R6 的落盘接线可放到第二步，因为它会触碰用户数据。

---

## 5 · 复算命令清单（附期望读数）

> 全部在 `D:/dsh-auto-memory` 下执行；Windows PowerShell 语法。

**命令 1 · 21 个模块字节合计**
```powershell
node -e "const fs=require('fs');const M='acceptance.js celebration-art.js client.js continuation-maintenance.js ev4-adapter.js ev4-blocks.generated.js ev4-prototype-blocks.js event-regroup-apply.js event-regroup-propose.js event-regroup-scan.js event-regroup.js ledger-criteria.js migration-optin-contract.js rerank-host.js semantic-js-worker.js state-commit.js team-transport-http.js upgrade-apply.js upgrade-draft.js upgrade-links.js wasm-paths.js'.split(' ');console.log(M.length, M.reduce((a,x)=>a+fs.statSync('lib/'+x).size,0))"
```
期望：`21 3432314`。

**命令 2 · 动态 import 与 Worker 计数（基线复核）**
```powershell
node -e "const t=require('fs').readFileSync('lib/index.js','utf8');console.log((t.match(/awaits+imports*(/g)||[]).length,(t.match(/news+Workers*(/g)||[]).length)"
```
期望：`44 0`。

**命令 3 · 可达/不可达（静态边 + 动态边）**
```powershell
node -e "const fs=require('fs');const L=fs.readdirSync('lib').filter(f=>f.endsWith('.js'));const S={};L.forEach(f=>S[f]=fs.readFileSync('lib/'+f,'utf8'));const E={};L.forEach(f=>{const s=new Set();for(const m of S[f].matchAll(/from\s+['\"]\.\/([A-Za-z0-9._-]+\.js)['\"]/g))s.add(m[1]);E[f]=[...s].filter(x=>S[x])});const R=new Set(['index.js']);const Q=['index.js'];while(Q.length){const c=Q.shift();for(const n of E[c]||[])if(!R.has(n)){R.add(n);Q.push(n)}}const D=new Set([...S['index.js'].matchAll(/await\s+import\(\s*['\"]\.\/([A-Za-z0-9._-]+\.js)['\"]/g)].map(m=>m[1]));console.log('static',R.size,L.length-R.size);console.log('with-dynamic',new Set([...R,...D]).size,L.length-new Set([...R,...D]).size)"
```
期望：`static 116 28` / `with-dynamic 123 21`。

**命令 4 · 导出分档（A 真死 / B 仅自用 / C 仅测试）**
```powershell
node -e "const fs=require('fs');const L=fs.readdirSync('lib').filter(f=>f.endsWith('.js'));const S={};L.forEach(f=>S[f]=fs.readFileSync('lib/'+f,'utf8'));let n=0;L.forEach(f=>{const re=/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)|^export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;let m;while((m=re.exec(S[f])))n++});console.log('export-function/const symbols',n)"
```
期望：`export-function/const symbols 1142`（该命令只数 `export function`/`export const` 两类 = **具名导出 1,142 个**；加上 21 个 `export default` 正好 **1,163**，与 §2.1 总数对得上。A/B/C 三档的 42/173/347 需用「整词计数 + 排除定义文件」的完整脚本，口径见 §2.1）。
> 为免复算歧义：本报告 §2 的 1,163 / 42 / 173 / 347 由同一支"整词计数 + 定义文件排除"脚本产出，脚本口径已写在 §2.1（判定规则），此处不再粘贴 40 行长脚本。

**命令 5 · 枚举常量计数**
```powershell
node -e "const fs=require('fs');const L=fs.readdirSync('lib').filter(f=>f.endsWith('.js')&&f!=='client.js'&&f!=='ev4-blocks.generated.js');let c=0;L.forEach(f=>{const t=fs.readFileSync('lib/'+f,'utf8');const m=t.match(/const\s+[A-Za-z0-9_$]+\s*=\s*Object\.freeze\(\s*\[/g);if(m)c+=m.length});console.log('freeze-array constants',c)"
```
期望：`freeze-array constants 107`。

**命令 6 · 生产侧零引用（三个 P0/P1 关键词）**
```powershell
'reggroup','upgrade-apply','rerank','acceptance','createHttpBackend' | ForEach-Object { $p=$_; $n=(Select-String -Path lib/index.js -Pattern $p -CaseSensitive:$false | Measure-Object).Count; "$p = $n" }
```
期望：`reggroup = 0` / `upgrade-apply = 1`（注释 `index.js:5140`）/ `rerank = 0` / `acceptance = 0` / `createHttpBackend = 0`。

**命令 7 · event-regroup 的 4 个 smoke 套件确实存在**
```powershell
Get-ChildItem tests -Recurse -Filter *.mjs | Select-String -Pattern 'event-regroup-' | Select-Object -ExpandProperty Path -Unique
```
期望：4 个文件（`smoke-test-v5-p6-event-regroup` / `-r2-regroup-scan` / `-r3-regroup-propose` / `-r6-regroup-apply`）。

---

## 6 · 假阳性排查记录（每个「判孤儿」结论排除了哪些加载方式）

### 6.1 全局性排除（对所有 21 个模块一次性生效）

| 加载方式 | 检查事实 | 结论 |
|---|---|---|
| **ESM 静态 import** | 从 `lib/index.js` 出发的 import 图：**静态 116 可达 / 28 不可达**；28 个不可达里有 7 个由动态 import 拉回 ⇒ **21 个真不可达**（= Lead 清单，逐名相符） | 21 个清单模块均**不在**静态边里 |
| **动态 `import()`** | `index.js` 有 **44 处** `await import(...)`，全部为**字面量**目标，15 个唯一目标已逐个列出（`node:fs/promises`/`node:path`/`node:fs`/`node:crypto` + 11 个相对模块）；全 `lib/` 无「变量拼路径」的 `import()`（唯一非字面量出现在 `index.js:14138` 的**注释**里） | 21 个模块**零命中** |
| **`require()`** | `lib/` 下除 `client.js`（CJS factory，仅 require react/react-dom）外，**`require(` 命中 0** | 无 CJS 加载路径 |
| **`new Worker`** | `lib/index.js` 中 `new Worker(` = **0**；全 `lib/` 亦为 0 | 无 Worker 线程入口 |
| **`child_process`** | 全 `lib/` 的 fork/spawn/execFile 只有三处：`semantic-js-process.js:88` `fork(new URL('./semantic-js-worker.js'))`、`python-sidecar-client.js:653` `spawn(command,args)`（Python 解释器，非本仓模块）、`python-setup.js`/`python-runtime.js` 的 `execFile`（同上） | 仅 `semantic-js-worker.js` 由 fork 加载（已判正常） |
| **前端 `__ModuleLoader__`** | `client.js:11` `window.__ModuleLoader__.load({`；`package.json` `exports["./client"]` + `dsh.client.platform=web`；`cordis.patch.yml` 以 `dsh.bundle.patch` 插入 profile 行 | 仅 `client.js` 属此类；其余模块**无浏览器入口**（`celebrat`/`celebration` 在 client.js 0 命中） |
| **HTTP 路由注册** | `index.js:449-559` 共 **85 条**路由（`API` 表）逐条核对：向导相关只有 `upgrade-status`/`upgrade-workspaces`/`upgrade-snooze`/`memory-upgrade`/`upgrade-archive-plan`，**无 apply/regroup/acceptance/rerank 端点** | 未接线模块**无 HTTP 入口** |
| **prompt 文本提及** | 全 `index.js` 的 `startUpgradeJobPre` 提示词块（`:11676-11830`）只前置工作区清单；模块名（`upgrade-apply`/`reggroup`/`acceptance`/`rerank`）在提示词里 **0 命中** | 不存在"提示词让模型去用某模块"的隐式接线 |
| **构建期生成器** | `tools/gen-ev4-blocks.mjs:51-52` 动态 import `ev4-prototype-blocks.js` + `ev4-adapter.js`；输出 `lib/ev4-blocks.generated.js`（`:33`）并内联进 `client.js` | 只有 EV4 三件套属此类（判正常） |
| **CLI 工具链** | `continuation-maintenance.js`（`#!/usr/bin/env node` + 测试 execFileSync 调用 + `index.js:7123` 错误文案指引用户执行）；`migration-optin-contract.js`（`tools/apply-migration-optin.mjs:30` import） | 2 个属此类（判正常） |

### 6.2 逐个「判孤儿」的排除项（13 个）

| 模块 | 已排除的加载方式 | 仍成立的证据 |
|---|---|---|
| acceptance.js | ES import / 动态 import / require / Worker / fork / ModuleLoader / HTTP 路由 / prompt / 生成器 / CLI | 全仓仅测试 1 个套件 import；`index.js` 0 命中 |
| celebration-art.js | 同上（含 `client.js` 全文搜 `celebrat`/`celebration` = 0） | 全仓命中仅自身头注释 1 行；测试 0 |
| event-regroup.js / -scan / -propose / -apply | 同上 | 族内引用 + 4 个 smoke 套件；`index.js` 0 命中；生产聚类仍走 `event-plan.js:112` |
| ledger-criteria.js | 同上 | `index.js:162` 从 `wb-contract.js` 导入同名判据（不是本模块） |
| rerank-host.js | 同上 | `index.js` `rerank` 0；`FUTURE-ROADMAP-20261010.md:38` 同结论 |
| state-commit.js | 同上 | `buildStateCommit`/`commitConflict`/`expectedStateVersion` 全 0；生产 miv 走 `m4-corpus` |
| team-transport-http.js | 同上（装配注入点 `createHttpBackend` 在 `index.js` = 0） | 模块头自述不接线；`team-transport.js:597` 构造即抛；前端 `disabled` |
| upgrade-apply.js / upgrade-draft.js | 同上 + **动态 import 互引已计入**（`upgrade-apply.js:134` → `upgrade-draft`，但两者同属死岛） | `index.js` 仅注释 1 处；无 apply 路由 |
| upgrade-links.js | 同上 | `client.js:8356` 是**手抄镜像**（`UPGRADE_LINKS_PRE`），不是 import ⇒ 宿主模块零消费 |

### 6.3 三条容易误判的边界（本轮特别核对）

1. **「被兄弟模块 import」≠ 已接线**：`event-regroup-apply.js` 被 `upgrade-apply.js:48` import，但后者自己也是死岛 ⇒ 整族连根不可达。判孤儿必须看**根可达性**，不是看"有没有人 import 我"。
2. **「测试 import」≠ 已接线**：13 个真孤儿全部有 smoke 套件（`acceptance`/`event-regroup×4`/`ledger-criteria`/`rerank-host`/`state-commit`/`team-transport-http`/`upgrade-apply`/`upgrade-draft`/`upgrade-links`，共 15 个套件）。这正是任务书所说的「测试在但生产调用不在 ⇒ 强证据」。
3. **「同名前缀的旧文件名」会造出假误报**：docs 里大量 `acceptance-pre.js`/`ledger-criteria-pre.js` 的旧名已不存在（`tools/release.mjs:393-412` 的改名登记表把它们改成裸名）。按旧名 grep 会得 0 命中并**误判"文件不存在 ⇒ 误报"**（`ISSUE117-TRIAGE-20260922.md:39` 就踩了这个坑）。

---

## 7 · 未验证 / 边界

1. **全程未运行任何套件、未启动宿主、未跑生成器**（只读纪律）。所有「未接线」结论都是静态事实（引用点计数、路由表、git 历史），**不是**运行时观测。若要升级为"运行时确认"，需重启宿主后观测：`/api/dsh-auto-memory/event-curate` 的草案是否仍走确定性聚类、`teamSyncTransport=http` 是否抛 `transport-not-implemented`。
2. **名字计数的误差方向是单向的**：整词计数会把「同名但语义不同的符号」算作引用 ⇒ 只会**低估**死代码。因此 A 档 42 个（全仓零出现）是**强结论**，B/C 档的判定是**弱结论**（需逐条复核才能动手删）。
3. **未扫描 `artifacts/` 全量**（18,055 个文件、含 `_p01c/_cmp` 等 EPERM 目录）。工作区内散落大量 `.d-cur*.js`、`.tmp-*.js`、`.pr355-client.js` 等**副本**，它们不是加载入口（不在 `package.json exports`、不被 `lib/` import），故未计入引用；若把它们算进去会人为抬高"引用数"，方向上是保守的。
4. **`client.js` 内的内联副本未做等价性验证**：`ev4-adapter`/`ev4-prototype-blocks` 的函数体是生成器 `toString()` 内联进 `client.js` 的，本轮**未跑** `node tools/gen-ev4-blocks.mjs --check`（纪律禁止跑生成器），因此"生成物与源一致"沿用既有 `smoke-test-v4-ev4-gen-blocks` 的结论，未独立复核。
5. **Lead 的两条基线未复现，已如实记录**：常量数 100/610（本轮 107/1,184，口径差异见 §3.1）；静态可达 123（本轮静态 116 / 静态+动态 123，见 §1.4）。
6. **`docs/HANDOFF-CRITERIA.md:4` 等文档仍写旧名 `ledger-criteria-pre.js`**，属文档滞后，不在本报告修复范围（未改任何文档）。
7. **P0-1 的"因果"是机制推断，不是实测**：`event-regroup.js:4-11` 自述旧聚类「产出垃圾」，与用户报的"事件碎片化"方向一致；但本轮**未做 A/B 实测**（接线前后的事件数/四段填充率对比）。要做因果证据，需按 §4.2 第一段只读接入后，用同一批账本对比草案质量。

8. **路由计数与文档不一致（未深究）**：本轮实测 `index.js:449-559` 的 `API` 表有 **85 个路径键**，且 `kind: 'exact'` 的路由对象也是 **85 个**；而 `docs/` 里多处记「71 条路由」（如 verify-docs 的口径）。两者不一致的原因未查（可能为统计口径差异，属工具链问题，不影响本报告的孤儿判定 —— 判定依据是「有没有 apply/regroup/acceptance/rerank 端点」，85 与 71 两个口径下结论相同）。

9. **审计窗口内有并行改动（未影响本报告读数）**：`git status` 显示工作树同时存在他方改动（`M lib/index.js`、`M lib/tier0-catalog.js`、`UU lib/tier-layer-inject.js`、`?? lib/tier0-usage.js`、`M tests/smoke/smoke-test-tier0-catalog.mjs`），**均非本轮产生**（本轮只新增本文件）。已复核 `lib/index.js` 全程字节/行数未变（审计开始与结束均为 2,077,967 B / 28,769 行），`tier-layer-inject.js:126` 的 `isCurrentStatusPre` 仍在原位、无冲突标记 ⇒ 本报告的 `file:line` 对"审计时的工作树"成立；若他方改动落盘，行号可能漂移，复算时以 §5 的命令重跑而非直接引用行号。
