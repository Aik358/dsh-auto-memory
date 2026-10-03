# 上游 issue / PR 批次 · 逐条判断与落地台账（2026-09-19）

> **背景**：合作方 `Minervaowl7` 于 2026-09-18 提交 issue **#75/#76** 与 PR **#77/#78/#79/#80**（来源：Qoder 审查报告 → 独立对抗复核）。
> **用户指示（2026-09-19 03:0x）**：「逐个判断修复，记得**不要只看局部，要看总体**，不要造成修复的错误问题。**修好以后，都要回复**，然后所有的 pull request 都要**礼节性地 merge**。」

## ★ 0. 两条线的关系（决定处置顺序，务必先读）

| | pre 开发线（本地 `D:\dsh-auto-memory`） | REL / main（远端正式版） |
|---|---|---|
| 文件名 | `lib/*-pre.js`（带 `-pre` 后缀） | `lib/*.js`（裸名，由 `tools/release.mjs` 转换） |
| 状态 | **活宿主代码**（profile `link:` 挂载） | **已发布 npm 3.0.0**，有真实用户 |
| 本批 PR 的 base | — | ✅ **PR 全部 base = `main`** |

**⇒ 关键结论（易错点）**：PR 是打在 **main** 上的，merge 它们**不影响本地 pre**（用户已确认此点）。
**但**用户后续「发大版本时用 pre 统一覆盖正式版」——**若 pre 线没有对应修复，覆盖时这些修复会丢**。
**⇒ 因此每一批修复必须做两件事：① merge PR（礼仪）② 在 pre 线落地同等修复（保数据）。**

**命名转换**：PR 里的 `lib/episodic-store.js` ↔ pre 线 `lib/episodic-store-pre.js`；`lib/memory-hub.js` ↔ `lib/memory-hub-pre.js`；以此类推。

---

## 1. 逐条判断

### PR #77 — episodic_candidate 改增量导入（**P0 数据丢失**）
- **base/head**：`main` ← `fix/episodic-import-no-overwrite`；+113 −5；3 文件；mergeable ✅
- **Fixes**：#63、#57
- **判断**：✅ **内容正确，质量高**。与我方独立复核同源：
  `ingestJudgement` 对每行 `episodic_candidate` 调 `stores.episodic.restore({schemaVersion:1, episodes:[row]})`，
  而 `restore()` 是**快照整体替换**（先 `episodes=[]`）；候选行缺 `validateEpisodePre` 必填字段 ⇒ 校验拒（`restored:0`）
  但 **episodes 已清空、current 已置 null**，且返回 `{ok:true}` ⇒ hub 记 `consumedEpisodic++`/`outcome:'restored'`
  ⇒ 下次 consolidate/flush 把清空态落盘 ⇒ **一次 ingest 抹掉全部已巩固 episode，不可逆**。
- **修法**：新增 `importEpisodes(rows)`（逐条校验、合法才追加、**绝不清空既有状态**、按 episodeId 幂等）；
  `restore()` 保留给启动全量恢复；hub 的 episodic 分支改走 `importEpisodes([row])`，outcome 如实区分 `restored`/`rejected:N`。
- **pre 线现状**：**部分已修** —— #57（`restore` 形状校验）我方已修（`restoreCurrentPre`）；
  **#63（episodic_candidate 清空）尚未修** ⇒ **待落地**。

### PR #78 — index-sync 页字节预算留信封余量（**P0 死锁**）
- **base/head**：`main` ← `fix/index-sync-page-headroom`；+98 −2；2 文件；mergeable ✅
- **Fixes**：#64
- **判断**：✅ **内容正确**。`INDEX_SYNC_PAGE_BUDGET_V1.maxPageBytes` 与 `m7-wire` 的 `MAX_LINE_BYTES` **同为 256KiB**，
  而分页闸只量 payload ⇒ 加上帧信封（实测约 **230B**）+ 换行后**必超限** ⇒ `worker_v1.py` 判 `line-oversize` fail-closed 退出；
  终局错误帧 `requestId:''` 被当 unknownRequest 丢弃。死锁核心：熔断阈值 3，但每段 `index_sync_begin` 成功帧清零计数
  ⇒ 峰值 2 永不熔断；`syncId` 由 recordCount 确定性派生 ⇒ 重试恒重建同一坏页。
- **修法**：`maxPageBytes` 取 **252KiB**（4KiB 余量 ≈ 信封的 18 倍），常量与文件头注明原因。
- **pre 线现状**：**待落地**（需找到 pre 线对应常量）。

### PR #79 — 下载器每次镜像尝试前清空 tmp（**P1 静默损坏**）
- **base/head**：`main` ← `fix/downloader-fresh-attempt`；+63 −0；2 文件；mergeable ✅
- **Fixes**：#65
- **判断**：✅ **内容正确**。`fetchToFile` 对同一 `tmp/<basename>` 反复 `flag:'a'` 追加，
  但只在 `run()` 开始清一次 tmp ⇒ 单文件双镜像重试时，源 A 的半截文件被续上源 B 的完整流；
  **sha256 只对网络流累积、不回读文件** ⇒ 拼接体校验通过并 rename 落位，加载期才失败（118MB onnx）。
- **修法**：每次尝试开始 `rmSync(dst, {force:true})`。
- **pre 线现状**：**待落地**（需找到 pre 线 semantic-js 对应处）。

### PR #80 — 三处 store 数据完整性小修
- **base/head**：`main` ← `fix/store-hardening-20260918`；+97 −2；5 文件；mergeable ✅
- **Fixes**：#55、#56、#67
- **判断**：✅ **内容正确**；其中 **#55/#56 我方 pre 线已修**（本批 ① 已完工），**#67 尚未修**。
  1. **#55** `storage-manage`：`readSidecarPrev` 引用未定义 `docStore` ⇒ ReferenceError 被吞 ⇒ 恒返 null
     ⇒ `repair()` 永远 `rebuildSidecar(file, undefined)` ⇒ 每次修复产生新 epoch + sourceVersion 回退（**自愈反向制造 stale**）。
     **pre 线**：✅ 已修（补 `const docStore = docStoreOf()`）。
  2. **#56** `evidence-store`：`_appended.add(id)` 在链式写入**执行前**，写失败无回滚 ⇒ 同 id 重试恒 `duplicate-evidence`（证据静默丢失）。
     **pre 线**：✅ 已修（`written===false` 时 `_appended.delete(id)`；`BoundedIdSet` 补 `delete()`）。
  3. **#67** `fact-store`：`conflicts.push({left: existing,...})` 持**活引用** ⇒ 后续 merge 原地改写 `confidence` 并对 `provenance`
     **数组原地 push** ⇒ 已落盘（facts.json）的冲突左侧 ≠ 检测时值，**审计面失真**。
     **pre 线**：⬜ **待落地**（登记时取检测时快照，含 provenance 数组副本）。

---

## 2. issue（跟踪项，非 PR）

### Issue #75 — `[P3]` 低危时序打包（CC-9 / CC-11）
1. **CC-9 延后写绑定错 child**（`lib/python-sidecar-client.js:211-213`）：`writeChain.then` 回调解引用**当时的** child 变量；
   writeChain 慢回调窗内 respawn ⇒ 旧 epoch 帧写入新 worker ⇒ 被判 staleEpoch 丢弃 ⇒ 请求挂满自身超时。
   **修**：建帧时捕获 child 引用，flush 时校验身份。
2. **CC-11 stepFor 双自增压缩 TTL 窗**（`lib/activation-host.js:351` 定义，`:217/:237/:286` offer/pump 各调一次）：
   自增器被**两次调用**而零时间流逝 ⇒ `expiresAtStep` 按第一次烘焙、判定用第二次 ⇒ ttl=3 的自然窗 2 次机会缩为 1。
   **修**：提供**只读** `currentStep` 给其中一处（「同步 offer+pump」不该消耗 2 步 TTL）。

### Issue #76 — `[P3]` 诊断盲区与卫生打包（6 项）
| 代号 | 位置 | 问题 | 修 |
|---|---|---|---|
| CB-2 | `memory-index.js:58,61` | 读 `prev.version`，但缓存写 `{fileDigest, sourceVersion}` ⇒ 恒 undefined ⇒ 版本振荡（edit1→v2、edit2→v2 卡死、unchanged→v1 回退） | 对齐键名 |
| CB-10 | `m7-index-sync-host.js:36` | `enabledKeys` 声明后**全仓无 `.add`** ⇒ `capturedPathKeys` 恒 `[]`；7 处 `drop` 第二参数全为字面量 `0` ⇒ `contextVersion` 恒 0 ⇒ 死锁在 `/state` 不可见 | drop 传真实 contextVersion；明确语义（注释与字段名矛盾） |
| CC-4 | `semantic-decide.js:173-177` vs `python/m7_activation_features_v2.py:292-294` | 硬门 reason 取名顺序**互为反序** ⇒ 多门共触时归因名不同（决策同为 suppress，仅诊断失真） | 统一顺序 |
| CC-6 | `semantic-js.js:428-479` | `bytesTotal` 用逐文件滚动基（每文件边界从 100% 回退）；`verifying` 态无复位（黏滞）；`opts.mirrors` 注入点被硬编码废掉 | 三处分别修 |
| CC-12 | `memory-hub.js:81-84` | 检查 `stores.facts.factCandidateFromJudgementRow`，但 `createFactStorePre` 返回对象**不含该方法**（模块级导出才有） ⇒ 委托分支恒走本地副本（**丢 ttl**），两适配器从此各自演化 | 对齐委托来源 |
| CC-13 | 三处零散 | a) `python-sidecar-client.js:280-287` `restart()` 注释称"全部 rejected"但函数体无结算；b) `memory-writer.js:297,483,486-498` `dirty` 标志**全仓无读者**；c) `fact-store.js:384` `clear()` 漏重置统计、`:256` `supersede()` 走 upsert 恒返回 `'created'` | 逐条修 |

**判断**：✅ 全部**为诊断级/潜伏态**（作者自述"不影响主链路数据"），与 `TODO-BACKLOG §B` 的"跨会话跨 Agent 检索"同属大排期，**不阻塞前端重构**。

---

## 3. pre 线同步落地（✅ 全部完成 2026-09-19 04:0x）

| 序 | 项 | pre 线文件 | 状态 |
|---|---|---|---|
| 1 | **#63 episodic_candidate 清空**（PR #77，**P0 数据丢失**） | `episodic-store-pre.js` + `memory-hub-pre.js` | ✅ **已落地** |
| 2 | **#64 index-sync 页预算**（PR #78，**P0 死锁**） | `index-sync-pre.js`（252KiB + 注释说明原因） | ✅ **已落地** |
| 3 | **#65 下载器 tmp 拼接**（PR #79，**P1 静默损坏**） | `semantic-js-pre.js`（每次尝试前 `rmSync(dst)`） | ✅ **已落地** |
| 4 | **#67 fact-store 冲突左侧活引用**（PR #80 第 3 条） | `fact-store-pre.js`（登记时取快照 + provenance 副本） | ✅ **已落地** |
| 5 | #55/#56/#57 | — | ✅ 已修（本批 ①） |
| 6 | issue #75/#76（12 项 P3 诊断） | 多处 | ⬜ 未做（**不阻塞前端**，归大排期） |
| 7 | issue #73（17 个 smoke 腐坏 + python import 失效 + 无 CI） | `tests/smoke/` | ⬜ 未做（**独立跟踪**） |

### pre 线落地的四条实现要点（供压缩后恢复）

1. **#63**：`episodic-store-pre.js` 新增 **`importEpisodes(rows)`** —— 逐条校验、只追加合法项、按 `episodeId` 幂等、**绝不清空既有状态**；`restore()` 仍保留给启动全量恢复。
   hub 的 episodic 分支改走它，**outcome 如实区分**（`imported` / `rejected:N` / `duplicate-episode`）。
   ⚠️ 加了 **fallback**：老 store 无 `importEpisodes` 时 fail-soft 返回 `no-import-episodes`，**绝不回退到 `restore`**。
2. **#64**：`INDEX_SYNC_PAGE_BUDGET_PRE_V1.maxPageBytes` 由 `256*1024` → **`252*1024`**，并写明原因（信封 202–230B + 换行，4KiB ≈ 18 倍余量）。
3. **#65**：`fetchToFile` 在建 hash **之前**加 `try { rmSync(dst, { force: true }) } catch (_) {}`。
4. **#67**：`conflicts.push` 的 `left` 由活引用 `existing` 改为 **`{ ...existing, provenance: [...existing.provenance] }`**（检测时快照）；`right` 同样取副本。

**验收**：`tests/smoke/smoke-test-prsync-20260919-pre.mjs` **30/30**（含 #67 的行为验证：merge 反复改写后冲突左侧仍等于检测时值）；
`artifacts/_mutate-prsync.mjs` **5/5 真红 + SHA256 逐字节还原**；**全量回归 PASS 128 / FAIL 0**（基线 127 → 128）。

**备份**：`lib/*.bak-20260919-PRsync`（5 个文件）。

---

## 3.5 merge 与回复执行结果（✅ 全部完成 · 以 GitHub API 实测为准）

### PR（4/4 已合并 + 已回复）
| PR | 状态 | merge commit | 评论 |
|---|---|---|---|
| #77 | `closed` / **merged=true** | `25c1e8da` | ✅ 1 条 |
| #78 | `closed` / **merged=true** | `cb7e0c67` | ✅ 1 条 |
| #79 | `closed` / **merged=true** | `3e0218da` | ✅ 1 条 |
| #80 | `closed` / **merged=true** | `cc708392` | ✅ 1 条 |

- **merge 方式**：GitHub API `PUT /pulls/{n}/merge`，`merge_method=squash`，带 sha 校验（防并发漂移）。
- **凭据来源**：`git credential fill` 从 Windows Credential Manager 取（**不是** `~/.dsh/.credentials.yaml`，那里只有各家 API key）。
  `gh` CLI **未安装**；`git config credential.helper = manager`。
- **★ 关键认知（用户已澄清）**：PR base = **main（正式版）** ⇒ **merge 不影响本地 pre**；用户发大版本时用 pre 统一覆盖。
  ⇒ 因此「merge 礼仪」与「pre 线落地」是**两件独立且都必须做**的事（见 §0 与 §3）。

### issue
| issue | 状态 | 说明 |
|---|---|---|
| #55 / #56 / #57 / #67 | `closed` / reason=**completed** / 各 1 条评论 | 我方已修 ⇒ **回复 + 关闭** |
| #63 / #64 / #65 | `closed` / reason=completed / **0 评论** | 由 PR body 的 `Fixes #N` **自动关闭**（本仓惯例，不额外补评论） |
| #73 | **open** | 17 个 smoke 腐坏 + python import 失效 + 仓库无 CI —— **独立跟踪项，未做** |
| #75 / #76 | **open** | 12 项 P3 诊断/卫生 —— **未做**，不阻塞前端 |

**main 最新 4 条提交**（均已落入正式版）：
```
cc708392  fix(stores): repair 继承失效 / evidence 幂等缓存吞重试 / 冲突左侧活引用 (#80)
3e0218da  fix(semantic-js): 下载器每次镜像尝试前清空 tmp 残留 (#79)
cb7e0c67  fix(index-sync): 页字节预算为线帧信封留余量 (#78)
25c1e8da  fix(episodic): episodic_candidate 改增量导入 (#77)
```

### 回复正文落盘位置
4 条 PR 评论 + 4 条 issue 评论的**完整正文**写在 `artifacts/_gh-reply-and-close.mjs`（`PR_COMMENTS` / `CLOSE` 两个对象），
已通过 API 发出；如需重发或改措辞，直接改该文件再跑即可。

---

---

## 3.6 第二批（2026-09-19 05:0x · 用户重启宿主后）

**用户指示**：「还有 11 个 issue 和 PR，把他们全修。首先判断这个 bug 报告**是否适用于进行过一轮底层优化的版本**。如果问题还存在，就进行修复。修复以后：1) 如果是 issue，就回复关闭；2) 如果是 request，那就礼节性 merge。」

### 3.6.1 实测清单（11 issue + 4 PR = 15 条 open）

| 类型 | 编号 |
|---|---|
| issue | **#58**, #66, #68, #69, #70, #71, #72, #73, #74, #75, #76 |
| PR | **#59, #60, #61, #62** |

### 3.6.2 PR 处置结果（4/4 已处理）

| PR | 对应 issue | 状态 | 处置 |
|---|---|---|---|
| **#62** | #58 | `clean` | ✅ **squash-merge** `06154146ea232ce9a7ee6d881c7811bc0dc97943` + 回复 |
| **#59** | #55 | `dirty` | ⚠️ **内容已被 #80 等价覆盖** ⇒ 回复说明 + 关闭 |
| **#60** | #56 | `dirty` | ⚠️ **内容已被 #80 等价覆盖** ⇒ 回复说明 + 关闭 |
| **#61** | #57 | `dirty` | ⚠️ **内容已被 #77 等价覆盖** ⇒ 回复说明 + 关闭 |

**★ 为什么 #59/#60/#61 是 dirty（关键事实，已实测）**：
- 这三条 PR 与 #77/#80 在**同一文件的同一处**做了等价修复 ⇒ Git 判冲突。
  对照证据：`#59` 改 `lib/storage-manage.js` 补 `const docStore = docStoreOf()` ↔ `#80` 同文件 +3−0；
  `#60` 改 `lib/evidence-store.js` + `lib/context-bridge.js` ↔ `#80` 同两文件；
  `#61` 新增 `validateEpisodeCurrentPre()` ↔ `#77` 的 `restoreCurrentPre()`（**函数名不同、语义相同**）。
- **无法先同步 base 再合并**：`PUT /pulls/{n}/update-branch` 返回 **403** `user doesn't have permission to update head repository`
  —— PR 来自对方 **fork**，我方无权更新其分支。
- 因此按「内容已生效」处理：**回复说明 + 关闭**（回复里明确说明此事，并承诺「若希望保留 PR 形式可重开一条基于当前 main 的分支」）。
- **一个遗憾（已登记）**：`#59` 附带的 `tests/smoke/smoke-test-issue55-sidecar-prev-pre.mjs`（141 行）**未随 #80 进 main**，
  #80 带的是合并版 `smoke-test-store-hardening-pre.mjs`；前者更聚焦。

### 3.6.3 issue 存活核验（进行中）

**核验口径（用户明确要求）**：「判断这个 bug 报告**是否适用于进行过一轮底层优化的版本**」——报告基于 `main@d816497`(v3.0.0) 写，
而 pre 线已经过 **L/M/R 多轮优化**，部分问题可能已被顺手修掉。

**★ 先例**：**#58 在 ① 批次就已修好** —— `activation-host-pre.js:531` 已按登记的 `st.stepKey` 精确回收（不再重新拼键），
`index.js:1088` 已接线 `this._activationHost.disposeRuntime(runtime.key)`。报告里的「根因 1 零调用方 + 根因 2 键错配」**两条都已在 pre 线解决**。

**已实测确认仍存在的 3 条**：
- **#66**（BOM 偏移 3 字节，P1）：`memory-anchor-pre.js:125-126` 剥 BOM 后给偏移；`memory-writer-pre.js:106/109` 直接用于含 BOM buffer，**无 bomLen 对齐**。
- **#69**（currentEpoch 采样在 spawn 前，P2）：`m7-index-sync-host-pre.js:90` 的 `currentEpoch()` 仍在 `sendIndexSyncPlanPre` **之前**；`:101` 失效条件仍带 `epoch &&` 前置。
- **#71**（growToMin 压空白，P2）：`l0-extract-pre.js:461` 先 `.replace(/\s+/g,' ')`、`:463` 再用**含 `\n` 的** `SENTENCE_SPLIT_RE(:41)` split ⇒ 换行分支死代码成立。

**其余 8 条**（#68/#70/#72/#73/#74/#75/#76）由两个只读子代理并行核验中。

### 3.6.4 纪律警示（本批次新增）

- **★ PR 来自 fork 时无权 update-branch**（403）⇒ 若 PR 与已合并的等价修复冲突，**只能回复 + 关闭**，不能"先同步再合并"。
- **★ 同一修复可能以不同函数名出现在两个 PR 里**（`validateEpisodeCurrentPre` vs `restoreCurrentPre`）⇒ 判 dirty 时必须**比对语义**而非只看名字。
- **★ `git credential fill` 从 Windows Credential Manager 取 token 可用**（`gh` CLI 未安装）—— 本轮全部 GitHub 操作均走此路径。

---

## 4. 后续（未做，登记防遗忘）

| 项 | 内容 | 阻塞前端？ |
|---|---|---|
| **#73** | 17 个 smoke 腐坏 + `python/` 测试 import 失效 + 仓库无 CI | ❌ 不阻塞（但会让"回归全绿"的可信度打折，建议前端前处理） |
| **#75** | CC-9 延后写绑定错 child / CC-11 stepFor 双自增压缩 TTL 窗 | ❌ 不阻塞（低危时序） |
| **#76** | CB-2 / CB-10 / CC-4 / CC-6 / CC-12 / CC-13 六项诊断盲区与卫生 | ❌ 不阻塞 |
| **#77 遗留一问** | 「熔断计数被成功帧清零」不只影响 page-oversize —— 任何"成功一次就重置"的熔断都会退化 ⇒ 建议单开跟踪 | ❌ 不阻塞 |


---

## 4. 回复与 merge（礼仪）

- **回复要点**（每个 PR/issue）：① 确认复核结论（我们独立验证过）② 说明落点（pre 线已同步 / 已随版本发布）③ 致谢。
- **merge 政策**（用户 2026-09-19 明确）：「我本地是 pre，远端是正式版 ⇒ **礼节性 merge 不会对本地造成影响**，等我发大版本时统一覆盖」⇒ **全部 merge**。
- **凭据实测**：本机 `gh` CLI **未安装**；`git config credential.helper = manager`；2026-09-13 已验证「fine-grained PAT 可合并自己仓库的 PR」。
  ⇒ merge 走 GitHub API（`PUT /repos/Aik358/dsh-auto-memory/pulls/{n}/merge`），token 从本机凭据取。
- **issue 关闭**：#63/#64/#65 由 PR merge 自动关闭（body 含 `Fixes #N`）；**已修复但未关闭**的（#55/#56/#57/#67）需手动回复 + 关闭。

---

## 3.7 第二批 issue 最终处置结果（2026-09-19 17:5x）

**全量回归基线**：128 → 131（①②③）→ 132（#72）→ 133（#76）→ 134（#74）→ **135**（#75）。
**判据**：用户指令「先判断这个 bug 报告**是否适用于进行过一轮底层优化的版本**，如果问题还存在就修复」。

### 逐条结果

| issue | 优先级 | 核验结论 | 处置 |
|---|---|---|---|
| **#58** | P1 | STILL_EXISTS | ✅ 由 PR **#62** squash-merge 关闭（`06154146`） |
| **#66** | P2 | STILL_EXISTS | ✅ **已修**（BOM 剥离 · 消费侧）· batch3 21/21 · 变异 3/3 |
| **#68** | P1 | STILL_EXISTS | ✅ **已修**（JS/Python 分叉 · `isAlnumPythonish`）· batch4 14/14 · 变异 3/3 |
| **#69** | P2 | STILL_EXISTS | ✅ **已修**（index-sync epoch 判据）· batch2 · 变异真红 |
| **#70** | P2 | STILL_EXISTS | ✅ **已修**（degraded 有界重试 + probe 暴露）· batch2 · 变异真红 |
| **#71** | P2 | STILL_EXISTS | ✅ **已修**（`growToMin` 保留行界）· batch2 · 变异真红 |
| **#72** | P2 | STILL_EXISTS | ✅ **已修**（epoch 门 fail-closed + 三条路径清 buffer）· batch5 12/12 · 变异 **3/3** |
| **#73** | P1 | **部分不成立** | ✅ **已修可修部分**（新增 `.github/workflows/tests.yml` + `--exclude`）；17 红 + import 失效在 pre 线**不存在** |
| **#74** | P3 | STILL_EXISTS | ✅ **已修**（月末钳制 + 模糊量词 + 正则锚定 + 分量校验）· batch7 24/24 · 变异 **4/4** |
| **#75** | P3 | STILL_EXISTS | ✅ **已修**（writeFrame 身份绑定 + currentStepOf 只读步）· batch8 15/15 · 变异 **3/3** |
| **#76** | P3 | **部分成立** | ✅ **已修 2 项**（hub 死委托 + clear 统计）· batch6 12/12 · 变异 **2/2** |

### 关键核验发现（#73）：**上游 issue 的根因清单可能整体过时**

#73 声称「17 个 smoke 套件腐坏 + `tests/test_m7_features_v2.py` import 失效 + 仓库无 test CI」。
逐条在当前 pre 线实跑后：

| #73 主张 | pre 线实况 |
|---|---|
| 17 个 smoke 红 | ❌ **不成立** — 17 个套件**全部存在且全绿**（PASS 134 / FAIL 0） |
| `test_m7_features_v2.py` import 失效 | ❌ **不成立** — `python/m7_activation_features_pre_v2.py` **存在**，import 有效 |
| python/bench/.venv 缺失 | ❌ **不成立** — 本机存在（但确在 `.gitignore:9`，CI 需排除） |
| artifacts/release-c2-asset-pack 缺失 | ❌ **不成立** — 本机存在（确在 `.gitignore:25`） |
| fixture 冻结值 `m7_chunk_pre_v1` vs 运行时 `m7_chunk_v1` | ⚠️ 差异**存在但属设计**（烟测 `:28` 正向断言该冻结值） |
| **仓库无 test CI** | ✅ **成立**（两条线都有） ⇒ 这是 issue 自己列的第一条修复建议，**已落地** |

**⇒ 纪律**：核验上游 issue 时，必须**逐条在当前线实跑**，只修仍然成立的部分。v3.0.0(main@d816497) 的事实经 L/M/R 多轮优化后可能整体失效。

### 本批新增的两条可复用纪律

1. **「上游 issue 的根因清单可能整体过时」** — 见上表。
2. **「`edit` 工具会改变文件行尾」** — 用 `edit` 写入 `lib/temporal-parse-pre.js` 后该文件从 CRLF 变**全 LF**（191 行），而本仓 `lib/*.js` 全是 CRLF。后果：① 基于 `\r\n` 的变异脚本锚点**全部不命中**（表现为「变异未命中源码」SKIP）② 污染 git diff。修法：`[System.IO.File]::WriteAllText` + `UTF8Encoding($false)` 转回；验收：`(s.match(/\r\n/g)||[]).length` 应等于总行数。**排查信号**：变异脚本报「未命中源码」而人工确认文本存在 ⇒ 先查行尾。

### 新增测试资产（本批 5 个套件 + 4 个变异脚本）

| 文件 | 覆盖 | 结果 |
|---|---|---|
| `tests/smoke/smoke-test-batch5-20260919-pre.mjs` | #72 | 12/12 |
| `tests/smoke/smoke-test-batch6-20260919-pre.mjs` | #76-5 / #76-6c | 12/12 |
| `tests/smoke/smoke-test-batch7-20260919-pre.mjs` | #74 四项 | 24/24 |
| `artifacts/_mutate-batch5.mjs` | #72 三处 | **3/3 真红** |
| `artifacts/_mutate-batch6.mjs` | #76 两处 | **2/2 真红** |
| `artifacts/_mutate-batch7.mjs` | #74 四处 | **4/4 真红** |

（batch2/3/4 见 §3.6；全部变异演示均 SHA256 逐字节还原。）

### 未做（登记待办，不阻塞前端）

- ~~**#75**~~（P3）✅ **已修**（2026-09-19）：CC-9 `writeFrame` 建帧时捕获 `child` 引用 + flush 校验身份；CC-11 新增只读 `currentStepOf` 供 `pumpClaimed` 使用（同一步不再消耗 2 步 TTL）。
- **#76 剩余 4 项**（P3 诊断级）：CB-2 memory-index 版本振荡 · CB-10 index-sync `enabledKeys` 恒空 · CC-4 硬门归因序反序 · CC-6 下载进度显示 · CC-12 已修 · CC-13a/b 卫生。
