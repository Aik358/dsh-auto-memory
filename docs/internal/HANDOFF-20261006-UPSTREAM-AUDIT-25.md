# HANDOFF 2026-10-06 —— 上游 25 条新报告核查线（移交 DeepSeek harness 自查）

> 自包含，可整份粘给任何 harness。读者 = 接手核查的模型（及其子代理）。
> 任务：完成剩余 16 项上游报告的**只读核查**（老规矩），再把 25 项总裁决组装成终稿 AUDIT 文档，交给施工 Agent 修复（用户原话：「按照老要求写成文档，我让别的Agent去改」）。
> 本文件含：铁律（§2）、基线（§3）、材料清单（§4）、已完成 9 项结论（§5 + 附录 A/B 逐字报告）、待办 16 项任务卡（§6）、产出格式与终稿组装规范（§7）。

---

## 0. 一句话现状

- 2026-10-06 从上游 `Aik358/dsh-auto-memory` 拉取 open 全量 **30 条**；排除已知 5 条（#179/#201 = 决策项挂起不动；#210/#212/#213 = 已采纳、实现为批次 W/X/Z 入库），**新增 25 条 = 18 issue + 7 PR**（作者：Minervaowl7 ×22、KouzakiUmi ×2、msilita ×1）。
- 上一会话（ZCode）完成 **2/6 线 = 9/25 项**：路径安全线 4/4 成立；前端 UI 线 3 成立 + 1 诉求合理 + PR#239 审查通过（结论在 §5，逐字报告在附录 A/B，复现探针已留盘）。
- 剩余 **4 线 16 项**因子代理并发上限反复被打断、零产出。你的任务 = §6 四条线。

## 1. 交付物与验收

1. 16 项逐项裁决（成立 / 部分成立 / 误报 / 诉求合理），每项含 claims 表、file:line 证据、成因机理、触发条件、后果、修复建议、验证方法。
2. 终稿 `docs/internal/AUDIT-20261006-UPSTREAM-25-VERIFICATION-AND-FIX-PLAN.md`（结构规范 §7），面向**施工 Agent**：自包含、可直接照单施工、含批次划分与守卫注意事项。

## 2. 铁律（先读，违反即报废）

1. **绝对只读**。不得修改/新建任何被 git 跟踪的文件；**严禁 `git checkout` / `restore` / `reset` / `stash` / `commit` / `push` / `pull` / `rebase`**。
   ⚠️ 2026-10-05 刚发生过 `git checkout -- lib/client.js` 抹掉整条前端批次 Y 工作的事故（抢救记录见 `docs/internal/HANDOFF-20261005-BATCH-Y-RECOVERY.md`）。核查线与施工线、批次 Y 线共用这棵工作树，任何 git 状态变更都是事故。
2. 临时探针只允许写 `.diag-issues20261006/` 目录（命名 `.tmp-<线>-*.mjs/.cjs`），跑完不删（后续核查要复用）。
3. **严禁运行 `tools/build-iter5-skin.mjs`（前端生成器）与 `tools/run-smoke.mjs` 全量回归**。需要测试证据时单跑特定 `node tests/smoke/<file>.mjs`。
4. 大文件纪律：`lib/client.js` ≈2.1MB 禁止整读（rg -n 定位后局部 Read）；`lib/index.js` ≈1.1 万行先 rg 后局部读。
5. 凭据纪律：如需重拉 GitHub 数据，token 只进环境变量（取法见 §4），不落盘、不进 argv、不进任何文档。
6. 子代理如再遇并发上限：**改串行或 ≤2 并发**，或直接单线自查；每条 shell 命令自带 timeout，禁交互式/挂起命令，长活分段推进、随时可交卷。

## 3. 基线事实

- **已发布版 = v3.2.9**（GitHub main = e260677，tag v3.2.9，npm latest=3.2.9）。报告者观察基线大概率是 3.2.9 或更早。
- **当前树 = 分支 `wip/20260926-teamwork`，HEAD = e3498c6**（工作树对跟踪文件干净）= v3.2.9 +：
  - **批次 W**（c5a3810，PR#210 拆取）：`lib/shared-state-lock.js` 共享状态锁、接续号 lock-wrapped 冷扫、档案账本锁内合并、create 闸；`lib/continuation-state.js`、`lib/continuation-maintenance.js`。
  - **批次 X**（fd81716，PR#212 拆取）：删除 CAS（expectedDigest 无条件）、note 路由 sessionId+expectedNotesPath 必绑 + 409 目漂移、`rewriteJsonPathsPre` 逐行 JSON 校验、procedure/evidence 归属 scope 化 + persist-before-count + ledger 严格读（30s 指纹缓存）、导入安全。
  - **批次 Z**（d22dd96 + 4f6079d，PR#213 拆取）：`lib/settings-safety.js`（saveConfig 严格读、损坏 400、`validateSettingsPaths` 祖先 realpath 逃逸防护、`migrateSettingsTree` dev/ino+sha256 属主、迁移重试安全）、note/PLAN 迁移协调。
  - **批次 Y（前端，检查点未完成）**：`lib/client.js` 手写区已部分写入（跨皮肤共享草稿 memoryNoteDrafts / 共享操作通道 submitMemoryOperation + useMemoryOperation / 面板关闭脏确认 / refreshSem 代次 / prepareSettingsPatch 归一化 injectExcludeSources+autoSummaryTimes 两键 / TeamSecretInput / 字典修正），**生成块未重生成**（悬 1 个 orphan 待裁决，见 10-05 handoff §6.1 F2）。前端缺陷判定 = 现位 client.js + `skins/iter5/` 源对照，并注明批次 Y 是否已覆盖。
- **Windows 路径别名事实**（路径类报告实证必读）：realpathSync JS 版不展开 8.3 短名、native 版展开；Node24 native 无 `\\?\` 前缀；junction 创建无需特权；本机 `TEMP` 环境变量本身就是 8.3 短拼写。v3.2.9 已含 `_canonPath`（lib/index.js:9653 附近，realpathSync.native 优先）。
- 判定口径：**裁决基准 = 当前 wip 树**；缺陷若已被批次 W/X/Z 修复 → 标「已修待发布」并检查彻底性；若只存在于某 PR 分支 → 标「PR 自身缺陷」（先例：PR#213 自带 frozen migPickInto ReferenceError）。

## 4. 材料清单（全部在盘，路径相对仓库根）

| 材料 | 位置 | 说明 |
|---|---|---|
| 30 条 open 全文+评论 | `.diag-issues20261006/item-<N>.md` | 2026-10-06 抓取，含 body + 全部评论 + 作者/时间 |
| 清单原始 JSON | `.diag-issues20261006/open-list.json` | state=open 全量 |
| 7 条 PR diff 快照 | `.diag-issues20261006/diff-{215,217,221,224,230,237,239}.patch` | 对各自 merge-base |
| PR 本地 refs | `pr-210 pr-212 pr-213 pr-215 pr-217 pr-221 pr-224 pr-230 pr-237 pr-239` | 已 fetch；查看用 `git show pr-<N>:<path>` / `git diff`，**严禁 checkout** |
| 抓取脚本 | `.tmp-fetch-issues.mjs`（仓库根） | 重拉用法：`TOKEN=$(printf "protocol=https\nhost=github.com\nusername=Aik358\n\n" \| git credential fill 2>/dev/null \| grep '^password=' \| cut -d= -f2-) node .tmp-fetch-issues.mjs` |
| 已留探针（可复跑） | `.diag-issues20261006/.tmp-v2-228-file-route.mjs`、`.tmp-v2-229-skin-name.mjs`、`.tmp-v2-236-corpus.mjs`、`.tmp-v2-233-settings.mjs`、`.tmp-v4-226-probe.mjs`、`.tmp-v4-238-notes-test.mjs` | 附录 A/B 的实证夹具 |
| 格式参照 | `docs/internal/AUDIT-20261005-PR210-212-213-VERIFICATION-AND-FIX-PLAN.md` | 上一轮同类文档 |

## 5. 已完成核查 9/25 —— 结论速览

### 线 V2 路径安全（4/4 成立，逐字报告=附录 A）

| 项 | 裁决 | 一句话成因 | 关键锚点 |
|---|---|---|---|
| #228 | 成立 | `isUnderMemoryTree` 纯词法前缀判定，树内 junction 越界读返回 200（探针实证 OUTSIDE-SECRET）；loopback+Origin 门禁内 | lib/index.js:12105-12111（守卫）、:16583-16602（/file 路由）；v3.2.9 同病（e260677:11857/:16255） |
| #229 | 成立 | 皮肤安装名正则 `/^[\w.-]{1,64}$/` 接受 `.`/`..`，`name:".."` 实证安装 ok 且覆盖 `<home>/memory/README.md`（renameSync 无条件覆盖）；且 URL 归一化让恶意仓库根放三文件即可配齐 | lib/index.js:15590-15612；v3.2.9 :15253 |
| #236 | 成立 | `lib/m4-corpus.js:66` `real.startsWith(declaredRoot)` 缺分隔符边界，「相邻同前缀」目录 symlink 越界正文进入语料快照（端到端实证）；**PR #224 提交 0838487 已含修复 hunk（diff-224.patch:24757），待移植** | lib/m4-corpus.js:59-68；消费方 shadow-host.js:71,307 / activation-host.js:47,105 |
| #233 | 成立 | **批次 Z 新引入的可用性回退**：settings-safety.js:49 在 realpath 判断前用未归一拼写做 inside 判定 → DSH_HOME 别名（junction/8.3 短名）下合法目标被 400 误拒（探针 8 案矩阵）；**PR #224 同提交含修复 hunk** | lib/settings-safety.js:39-60；修法=canonicalDirectory 式双侧归一 |

V2 总纲：四项同根 = 「词法路径运算 vs 物理文件系统别名」；统一修法 = 包含判定前根与目标双侧 realpath（最深存在祖先+缺失后缀回拼）+ `path.relative` 四联判定，弃 `startsWith`。

### 线 V4 前端 UI（3 成立 + 1 诉求合理 + PR#239 通过，逐字报告=附录 B）

| 项 | 裁决 | 一句话成因 | 关键锚点 |
|---|---|---|---|
| #238 | 成立（现位仍可触发，探针实证） | 梦幻皮肤把 `[data-dam-panel]` 误标记为 composer，后注入 `position:relative` 压过无 `!important` 的 `fixed`（client.js:3531）；浮窗 inline 无 position、无 role=dialog | 浮窗 :16074-16081、面板 div :16082-16091；修复=PR#239 四行（inline `position:'fixed'` + `role:'dialog'`+aria-label），**落手写区、无需重跑生成器**；⚠️ iter5-skin 哈希锁撞车：PR 的 R78=133aee25 vs wip 批次 Y 的 R78=a0460128 → 合并后重钉 R79 |
| PR#239 | **修复正确，建议采纳（拆取）** | 四行核心修复正确充分；其 CI 附带改动里发现**现位 wip 仍存在的真缺陷：`tools/release.mjs:132` 拷贝清单缺 `smoke-impact.mjs` → 发布包 run-smoke 一跑即 ERR_MODULE_NOT_FOUND**（上游 e260677 的 run-smoke.mjs:37 import 它但该文件在 e260677 不存在） | 采纳项：①浮窗四行；②release.mjs 一行；③可顺带收其 `tests/smoke/smoke-test-run-smoke.mjs`；其余测试文件 PR 基于旧代，只能摘语义不能整文件套用 |
| #226 | 成立（探针实证） | apply 注册进程级 `uncaughtException`/`unhandledRejection`（有意设计防连带杀死宿主），但卸载不注销（:17351-17363 无 removeListener；探针实测 dispose 后监听仍 1+1）→ 卸载后无关致命异常被吞、exit 0 → smoke 假绿（run-smoke 按退出码判，:242/:285） | lib/index.js:13361、:13376-13383；修法优先 `uncaughtExceptionMonitor` + dispose removeListener；PR#239 的套件级兜底只是缓解 |
| #222 | 成立（**批次 Z 引入的回归**） | `_saveConfigChecked` 用展开后**字符串**比较判迁移（:2883/:2892-2894），别名（物理同根）进迁移后撞 `migrateSettingsTree` 的 realpath 重叠拒绝（settings-safety.js:82-85）→ 保存被拒 | 修法=迁移前 from/to 用 canonicalDirectory 归一，物理同根⇒跳过迁移照常提交；不动 settings-safety 原语契约（smoke-test-settings-safety.mjs:165-173 固化的是原语层） |
| #223 | 诉求合理（FR 非 bug） | 侧栏「记忆(pre)」按钮 :18448-18450 无条件注册，无开关；boardMode 出厂默认即 graph（3.0.0 起） | 方案 A=localStorage 本地开关（5 行）；方案 B=正式配置键+三面同步（中等成本）；建议批次 Y 转正后排期，且 graph 默认隐藏需用户裁定 |

### 跨项早发现（终稿必须收录）

1. **`tools/release.mjs:132` 拷贝清单缺 `smoke-impact.mjs`** —— 现位 wip 发布出去的包 run-smoke 必坏。一行修，独立于一切批次，最高优先顺手修。
2. PR #224 含 #236/#233 的修复提交 0838487（两处 hunk 均经探针验证有效）——若 #224 不整盘采纳，这两处 hunk 是移植候选。
3. #233 与 #222 都是**批次 Z 引入的 fail-closed 回退**（可用性），与 #228/#236 的 fail-open 逃逸同根，修复应统一口径（双侧 realpath 归一 + relative 判定）。

## 6. 待核查 16 项 —— 四条线任务卡

> 每线产出按 §7 模板。共通背景见 §2/§3；每项先读 `.diag-issues20261006/item-<N>.md`。实证优先；判定基准=当前 wip 树。

### 线 A：技能 / 工具 / 接续（6 项）

| 项 | 内容 | 搜索起点与判定要点 |
|---|---|---|
| #227 P1 | 技能候选写盘失败仍返回 ok，memory_procedure 回复已写入 | rg -n "memory_procedure\|procedure" lib/index.js；lib/procedure-store.js（批次 X 改过 persist-before-count）；验证写盘失败时返回值/持久化一致性 |
| #231 P1 | 技能归属迁移回滚将损坏 procedures.json 原件覆盖为空库 | rg -n "procedures\|rollback" lib/procedure-store.js lib/index.js；数据损毁级：回滚路径是否以空库覆盖原件、备份去向、损坏源文件处理；务必实证或给精确代码链 |
| #232 P2 | 团队作者索引启动解包字段错误，下一次写入覆盖历史 | rg -n "authors\|author" 团队/procedure 相关；启动解包字段名 vs 写入字段名一致性；覆盖路径 |
| #234 P2 | 自动导出技能以宿主 cwd 标注适用项目，忽略调用会话项目 | rg 技能导出逻辑；process.cwd() vs resolvePathsForSession/会话工作区口径；给应改位置 |
| #216 P1 | defineTool 不透传 items → Gemini/Vertex 每轮 HTTP 400；armAutoContinue 对子代理会话 arm → 接续卡反复报红 | claim1：rg -n "defineTool" lib/，查统一包装的字段白名单是否漏 `items`（对照宿主对 Gemini/Vertex 的 schema 校验）；claim2：rg -n "armAutoContinue" lib/index.js，查子代理会话判定（parent/origin/kind）是否存在；批次 W 动过接续三段式（reserve→setTarget(rawId)→finish） |
| PR#217 | 上条修复 PR（8 文件 +364/-2；diff-217.patch） | 修复方式正确性（透传=全量还是字段补丁；子代理判据稳不稳）、与批次 W 冲突、自身缺陷、采纳建议 |

### 线 B：配置 / 并发 / 笔记（5 项）

| 项 | 内容 | 搜索起点与判定要点 |
|---|---|---|
| #218 P2 | 多进程配置读改写丢更新，保存均返回成功 | 对照批次 W `lib/shared-state-lock.js` 覆盖范围与批次 Z `_saveConfigChecked` 串行队列：哪些入口仍有 RMW 竞态窗口；给剩余窗口清单 |
| #220 P2 | V3 设置清空 headroom 输入误存 0 | 「V3」=PR#215 的 V3 设置 UI（先读 item-215.md）；rg -n "headroom" lib/；批次 Y `prepareSettingsPatch` 只归一了 injectExcludeSources/autoSummaryTimes 两键——headroom 空串该不该同类处理（不提交 vs 误存 0） |
| #225 P1 | 笔记压缩用旧快照覆盖等待期间已成功追加的记录 | rg -n "compact" lib/index.js；数据丢失级：读快照→等待→写回窗口时序；批次 X note 路由改动是否已修 |
| PR#221 | serialize shared config transactions and generate prompt defaults（22 文件 +882/-160；diff-221.patch） | 主张属实性、修复正确性、与批次 W/Z 冲突/重复、自身缺陷、采纳建议 |
| PR#230 | preserve concurrent memory writes and host failure semantics（20 文件 +795/-213，msilita；diff-230.patch） | 同上；注意与 #225 对应关系及与批次 X 重叠 |

### 线 C：Python 档 / 路径别名（2 项）

| 项 | 内容 | 搜索起点与判定要点 |
|---|---|---|
| #235 P2 | Python 下载向导接受不完整模型和非法 tokenizer 并报告 ready | rg -n "wizard\|download\|tokenizer\|ready" lib/index.js lib/python-runtime.js 与 worker 脚本；验证就绪判定是否真校验文件大小/完整性/tokenizer 词表，还是只查存在；历史教训：合法降级码与没配 Python 曾无法区分 |
| PR#237 | 兼容 DeepCode 路径别名和移动端设置 UI（29 文件 +1163/-163；diff-237.patch） | ①别名兼容手段 vs `_canonPath` 口径一致性；②移动端 UI 改动落点（手写区? skins/iter5 源?）与批次 Y 冲突面；③与批次 Z validateSettingsPaths 互补/冲突（注意 §5 V2 对 #233 的结论——别名误拒已有探针矩阵可复用）；④自身缺陷抽查；⑤采纳建议 |

### 线 D：巨型 PR + 组合失配（3 项）

| 项 | 内容 | 审查要点 |
|---|---|---|
| PR#215 | Refactor settings and navigation around approved V3 UI（KouzakiUmi，152 文件 +20611/-6666；diff-215.patch） | 四问法：①主张的动机对应我们哪些真实缺口；②实质改动面（client.js 手写区? 皮肤源? 新文件?）与批次 Y 冲突风险；③自身缺陷抽查；④采纳建议。先 --stat 排权重，火力集中 lib/ 非 client.js 实质改动 |
| PR#224 | integrate audited PRs and close twelve confirmed failures（296 文件 +27555/-7242；diff-224.patch） | 列出声称的 twelve failures，逐条对照批次 W/X/Z 已修内容判冗余/真增量；lib/ 实质差异逐文件裁决；已知其含 #236/#233 修复（0838487，已验证有效）；给全盘/拆取/不采纳建议 |
| #219 | 开放 PR 组合后提示默认值漂移及九项 smoke 契约失配 | 读 item-219.md 拿「默认值漂移」+「九项失配」具体清单；逐条验证：失配在哪个 PR 组合下发生、现树是否同样失配（可单跑相关 tests/smoke/<file>.mjs）、每条给处置建议 |

## 7. 产出格式与终稿组装规范

### 7.1 每项产出模板

```
### #N <标题> [ISSUE/PR，作者]
- 裁决：成立 / 部分成立 / 误报 / 诉求合理（X/Y claim 成立）
- claims 表：C1 <claim> — 裁决；成因 file:line + 一句话机理
- 证据：探针输出（贴关键行）/ 代码引用链
- 触发条件与后果：
- 修复建议：具体到函数/文件 + 验证方法（冒烟测试设计）
- 与在途工作关系：已修待发布（W/X/Z）/ 批次 Y 覆盖 / PR 自身缺陷 / 无重叠
- （PR 项）采纳建议：全盘 / 拆取（列清单）/ 不采纳 + 理由
```

### 7.2 终稿结构（AUDIT-20261006-UPSTREAM-25-VERIFICATION-AND-FIX-PLAN.md）

1. **§0 总览表**：25 项 ×（裁决 / 定级认可与否 / 修复批次号 / 依赖关系），开头给裁决计数。
2. **§1 方法与基线**：引本 handoff §2/§3。
3. **§2 逐项裁决**：25 项按 §7.1 模板；已完成的 9 项从附录 A/B 提炼，新 16 项用核查产出。
4. **§3 修复批次方案**（给施工 Agent，原则）：
   - 后端先行（lib/ 纯后端批），前端批**必须在批次 Y 转正（F2 裁决+重生成+全绿）之后错峰**，避免两条前端线互踩；
   - 同根统一修：路径四项（#228/#229/#236/#233）+ #222 建议一个「双侧 realpath 归一 + relative 四联判定」的公共工具一次修完（注意 #233/#222 是批次 Z 回退，修时保住其安全语义：越界/嵌套仍拒）；
   - PR 拆取优先于全盘（先例：#210/#212/#213）；PR#224 的 0838487 两 hunk、PR#239 的四行+release.mjs 一行是已验证移植候选；
   - 每批全量回归 `node tools/run-smoke.mjs`；改 lib/index.js 必重钉 r26 E3 哈希锁；改 client.js 手写区必重钉 iter5-skin 哈希锁（当前 R78=a0460128，任何前端改动→R79 并续写归因链）。
5. **§4 风险与依赖**：#238 修复与批次 Y 同在 MemoryPanel 函数（:15987 起）——文本相邻，合并需手工调和；#226 修复是行为契约变更（当年 EPIPE 事故的三层独立防护仍在，放宽默认退出抑制的代价可控但需发版说明）；#223 若做方案 B 需动 iter5 设置源，与批次 Y 刚改过的 settings-copy/views 错峰。
6. **§5 附录**：指向本 handoff 的附录 A/B 与 `.diag-issues20261006/` 探针。

## 8. 快速核对清单（接手后按序）

- [ ] 读 §2 铁律 + §3 基线；`git log --oneline -1` 确认 HEAD=e3498c6（若已前进，先看新提交是什么再动手）
- [ ] `git branch --list 'pr-*'` 确认 10 个 PR refs 在位（缺了用 §4 脚本重拉）
- [ ] 线 A → 线 B → 线 C → 线 D（或按子代理容量并行 ≤2）
- [ ] 汇总裁决，组装终稿 AUDIT-20261006（§7.2）
- [ ] 交施工 Agent；本核查线全程零写入、零 git 状态变更

---

## 附录 A：V2 路径安全线核查报告（逐字，2026-10-06）

（探针：`.diag-issues20261006/.tmp-v2-228-file-route.mjs`、`.tmp-v2-229-skin-name.mjs`、`.tmp-v2-236-corpus.mjs`、`.tmp-v2-233-settings.mjs`；实机 Windows 11 / Node 24.18.0，junction 与文件 symlink 均实际创建成功）

### A-1 #228 [P2] 本地文件接口仅检查字面路径，junction 可越过记忆目录边界 —— **成立**

| # | claim | 裁决 | 依据 |
|---|---|---|---|
| 1.1 | isUnderMemoryTree 只做 path.resolve + 字符串前缀 | 成立 | lib/index.js:12105-12111，`resolved.startsWith(root + path.sep)`，零 IO，不解析链接 |
| 1.2 | 实际读接口随后跟随文件系统链接 | 成立 | 路由 lib/index.js:16583-16602（API.file）：守卫通过后调 engine.readTextSafe（:6140-6147），stat+readFile 均跟随 symlink/junction |
| 1.3 | 记忆树内 junction 指向树外 → 请求返回树外内容（HTTP 200） | 成立 | 探针 [1]：guard=true，读到 `OUTSIDE-SECRET-228` |
| 1.4 | 该接口仍受 loopback/Origin 门禁，非匿名远程任意读 | 成立 | lib/index.js:16587 isLoopbackRequest（:12073-12085） |

证据：v3.2.9（e260677:lib/index.js:11857/:16255）同样存在 ⇒ 已发布缺陷，wip 未修。探针输出：[1] guard(junction escape)=true、读到树外内容；[2] 树外字面路径正确拒；[3] `../` 拼写正确拒；[4] 树内 junction 正确放行；[5] root=别名拼写、目标=物理拼写 → 误拒（fail-closed 侧，与 #233 同族）；[6] 文件级 symlink 同样绕过。

触发：能在记忆树内落盘 junction/symlink 的本地进程（Windows junction 无需特权）→ GET /api/dsh-auto-memory/file?path=...。后果：守卫声明的记忆目录边界对树内链接完全失效。同族面：handoffPanelData 的 fileQ（:5885-5891）不挡 handoffDir 内预植 junction；skinAsset 路由（:15565）的 skinAbsPathOfPre（:12063-12070）同为纯词法——同类加固应一并覆盖。

修复：isUnderMemoryTree 改双侧物理归一（最深存在祖先 realpath + 缺失后缀回拼，可复用 settings-safety.js:64-75 canonicalDirectory 或 _canonPath），包含判定改 path.relative 四联式。验证：越界 junction→403；树内 junction、合法 root 别名→200；树外字面与 `../`→403。

### A-2 #229 [P2] 皮肤安装名称允许点路径，可覆盖皮肤根目录外固定文件 —— **成立**

claims：2.1 名称正则 `/^[\w.-]{1,64}$/` 接受 `.`/`..`（lib/index.js:15592，探针 test 均 true）；2.2 `path.join(dshHome(), SKIN_DIRS.user, name)` 把 `..` 解析到 `~/.dsh/memory`（:15593 + lib/skin-center.js:40）；2.3 安装 `name:".."` 返回 200/ok:true，theme.json、skin.css、README.md 写到皮肤根之外；2.4 固定文件名集合 `['theme.json','skin.css','README.md']`（:15594），名称无 `/` 不可注入任意名；2.5 **可覆盖**（比报告更强）：预置 victim README.md 内容被覆盖（:15606 renameSync 无条件覆盖）。

探针：[1] install("..") → `{status:200,ok:true,files:[三文件]}`，destDir=`<home>/memory`，victim 内容变 MALICIOUS；[2] install(".") → skins 根被塞三散文件；[3] 正常名不受影响。另证：URL 归一化使 `.../contents/skins/../theme.json` → 仓库根 theme.json，恶意仓库根放三文件即可配齐下载。v3.2.9（e260677:15253）同病。

后果：越界写 + 同名固定文件数据破坏 + 目录污染；memory 核心文件（MEMORY.md 等）不在固定名集合，不构成任意文件覆盖。修复：①名称正则首字符限 `[A-Za-z0-9_]` 且显式拒纯点；②落点包含校验 path.relative 四联式（`rel===''` 也拒，封 `.`）；③写盘前 destDir realpath 再验一次（防预植 junction 落点）。

### A-3 #236 [P2] 语料路径守卫接受相邻同前缀目录的越界符号链接 —— **成立**（本树未修；PR #224 有待移植修复）

claims：3.1 lib/m4-corpus.js:66 `real.startsWith(declaredRoot)` 缺目录段边界，workspace-other 通过 workspace 前缀（探针 [1] ok:true）；3.2 前提=本地符号链接+植入后按当前内容重建 sidecar（fileDigest :96 比对），全程本地；3.3 canonicalScopeGuard ok:true 且 loadCorpusSnapshot 返回越界正文记录（探针 [4] 端到端实证 `OUT-OF-TREE-CORPUS-236` 进入快照）；3.4 修复已随 PR #224 提交 0838487 交付待审（diff-224.patch:24757 hunk 探针 [5] 验证对该夹具有效），**未进入本 wip 树**（lib/m4-corpus.js 末次触达 26f98b5 批次 A）。

探针矩阵：[1] 相邻同前缀 ok:true（缺口精确定位）；[2] 不同前缀正确拒 cross-workspace；[3] 树内链接正确放行；[4] 端到端越界正文进入快照。v3.2.9（e260677 m4-corpus.js:66）同病。消费方：shadow-host.js:71,307（检索注入）、activation-host.js:47,105、storage-manage.js:82——越界正文可检索、可注入。附带：canonicalize（:26-27）无条件小写，POSIX 大小写不同的相邻目录在 sourceFile 比对处合并（Windows 无影响，移植时可一并裁决）。

修复：移植 diff-224 的 canonicalScopeGuard hunk（双侧 realpathSync + path.relative 四联判定）；最小修复只动包含判定即可封口。

### A-4 #233 [P2] 设置路径校验拒绝 DSH_HOME 内有效的物理目录别名 —— **成立**（批次 Z 引入的可用性回退；PR #224 有待移植修复）

claims：4.1 settings-safety.js:49 在 realpath 判断前用未归一 home/target 做词法 inside 判定（realHome 首次使用在 :56）；4.2 workbenchRoot=物理拼写被拒 `Directory must be inside DSH_HOME`（探针 [A]）；4.3 memoryRoot、userMemoryDir 同循环同闸门同病（:43）；4.4 运行时 b69995d 已给 _workbenchCwd 加 _canonPath 归一，但 expandUserPath（:2930-2935）仍是词法 → 保存闸与运行时口径分裂。**v3.2.9 无此文件（批次 Z d22dd96 自 PR#213 移植引入），故为 wip 新引入回退而非已发布缺陷。**

探针 8 案矩阵：[A] 物理 target+别名 home → 误拒；[B] 别名拼写 → 过；[C] 缺失后缀同样误拒；[D] 出向 junction 正确拒（:54-56 分支有效）；[E][F] 树外/home 根按设计拒；[G] `../` 拼写物理在 home 内 → 误拒（修后应收）；[H] **8.3 同族误拒**——本机 TEMP 环境变量本身就是 8.3 短拼写（JHZ~1），dshHome() 原样返回环境拼写，_canonPath native 展开 ⇒ 「DSH_HOME 位于 TEMP 下 + 用户粘贴长拼写」就是现成触发场景。

后果：fail-closed 可用性回退（非安全洞）；真实越界仍被 :54-56 拦截。修复：移植 diff-224 settings-safety hunk——删 :49 词法闸（保留 isAbsolute），改「最深存在祖先 realpath → realTarget 回拼 → inside(realHome, realTarget)」；修后与 migrateSettingsTree 已用的 canonicalDirectory（:83-84）口径一致；diff-224 自带测试（:33899-33913）覆盖 Linux symlink 与 junction、home 根自身拒绝。

---

## 附录 B：V4 前端 UI 线核查报告（逐字，2026-10-06）

（探针：`.diag-issues20261006/.tmp-v4-226-probe.mjs`、`.tmp-v4-238-notes-test.mjs`）

### B-1 #238 点击「笔记」后记忆浮窗消失 + PR #239 审查

| # | claim | 裁决 | 证据 |
|---|---|---|---|
| 1 | 梦幻皮肤把 NotesTab textarea 圆角祖先（整个 [data-dam-panel]）误标记为 composer，用后注入的 `[data-dsh-dream-skin-composer]{position:relative}` 覆盖无 !important 的 fixed，浮窗移出视口 | 成立（采信报告者三重证据：两版 commit/行号引证、真机 CSS 对照、合成复现；机理自洽） | 基础规则 wip lib/client.js:3531（position:fixed 无 !important）；3.2.9 同款 e260677:3449 |
| 2 | 缺陷在当前 wip 树仍可触发 | 成立（已实证） | 浮窗 floatStyle :16074-16081 无 position:'fixed'；面板 div :16082-16091 无 role:'dialog'。把 PR#239 自带回测提取为探针跑 wip client.js，恰在 `floating panel owns its fixed positioning` 处 FAIL |
| 3 | 批次 Y 对应代码是否在现位 | 手写区已部分写入 | memoryNoteDrafts/submitMemoryOperation/useMemoryOperation/TeamSecretInput/prepareSettingsPatch 共 40 处命中（:3409、:7388 等）；批次 Y 面板关闭脏确认与 #238 修复同在 MemoryPanel（:15987 起）一个函数内 |
| 4 | skins/iter5 源文件状态 | 无需源同步 | 浮窗渲染代码在手写区（ITER5-GENERATED:END :15892，MemoryPanel :15987）；skins/iter5/* 只有 data-dam-panel 的 CSS，无浮窗元素创建代码 |
| 5 | 浮窗是三套皮肤共享单点 | 成立 | classic/legacy(frozen)/变体共用同一 MemoryPanel（挂载点 :18452）；frozen 里 data-dam-panel 仅在 CSS 字符串 → 修一处全覆盖 |

**PR #239 审查：修复正确，建议采纳，但与 wip 合并需手工调和。**
- 核心修复（+4 行）正确充分：①浮窗 inline position:'fixed'（inline 压过皮肤后注入的普通特异性规则，该规则无 !important）；②role:'dialog'+aria-label（非模态，未设 aria-modal）——正中 dream skin composer 候选排除条件 `[role=dialog]`，源头阻止误标记。与拖拽 inline left/top（:16075-16076）一致；client.js 内两处 closest('[role=dialog]')（:11025、:13528）属工作台 slot 不受影响。真机（DSH web + dream 9.29.0）×3 回归与 docs/qa 完整。
- CI 附带改动核实：上游 e260677 的 tools/run-smoke.mjs:37 import ./smoke-impact.mjs 而该文件在 e260677 不存在（git cat-file 证实）→ 上游 main runner 出厂即坏；PR 恢复该模块并修 tools/release.mjs:132 拷贝清单。**「发布漏拷贝」缺陷在现位 wip 依然存在**（wip 有 smoke-impact.mjs 文件但 release.mjs:132 清单仍是 `'run-smoke.mjs,release.mjs'`）→ 建议单独摘入这一行修 + 顺带收其新增 tests/smoke/smoke-test-run-smoke.mjs。
- 测试文件重叠度：py-runtime-chain 逐字节相同；audit-g-207（58 行 diff）、consolidate-isolation（236 行）、iter5-skin、p3-batchb-guards、py-runtime-live、smoke-impact.mjs（63 行）、tests.yml、.gitattributes 均与 wip 有差异——PR 基于旧代测试文件，只能摘语义不能整文件套用。
- 与批次 Y 冲突点两处：①smoke-test-iter5-skin.mjs 哈希锁撞车（PR 的 R78=133aee25（+#238 四行）vs wip R78=a0460128（批次 Y））→ 合并后重算重钉 R79（含归因注释）；②MemoryPanel 函数内批次 Y close 脏确认与 PR 浮窗属性行相邻，git 层面可能文本冲突、语义无矛盾。修复落手写区，**无需重跑生成器**。PR 自身无新缺陷。

触发：安装 dsh-dream-skin（≤v10.5.0 均在）+ 开浮窗 + 切「笔记」→ 浮窗 rectTop≈941 vs 视口 821（闪退、打不开），DOM 仍在。验证：探针修后应转绿（position==='fixed' + role==='dialog'）；真机按 PR 的 tools/qa/verify-notes-floating-window.ps1 断言 getBoundingClientRect 在视口内。

### B-2 #226 全局异常监听吞掉宿主致命异常、卸载不注销、smoke 假绿 —— **成立（P1 定级合理）**

| # | claim | 裁决 | 证据 |
|---|---|---|---|
| 1 | apply 注册进程级 uncaughtException/unhandledRejection，只记录不保宿主退出语义 | 成立 | lib/index.js:13361（uncaughtException 仅 damSafeDiag）、:13376-13383（unhandledRejection 记录+计数）；:13354 注释自认「挂 uncaughtException 监听即抑制 Node 默认致命退出」——2026-09-14 有意设计（防插件异常连带杀死 dsh web），但作用域是整个宿主进程、无法区分错误归属 |
| 2 | 卸载未移除监听 | 成立（已实证） | 卸载路径 ctx.effect(() => () => {...}) :17351-17363 清定时器/disposers 但无 removeListener；全文件无任何 removeListener。探针实测：apply 后监听 1+1，dispose 后仍 1+1 |
| 3 | 卸载后无关致命异常被吞、进程 exit 0 | 成立（已实证） | 探针（Node v24.18）：dispose 后 setImmediate 抛无关 Error → 仅打印一行日志，进程存活至主动 exit(0) |
| 4 | 未改动 run-smoke.mjs → PASS 1 / FAIL 0（假绿） | 成立（机理实证） | run-smoke 按子进程退出码判 PASS（tools/run-smoke.mjs:242,285）；其文件头 :24-27 自己记载了这条失效路径。34 个 smoke 套件调用 apply() 均处暴露面 |

危害主要在回归门禁完整性（异步断言失败/意外异常被吞成 exit 0）。成因=「插件 fail-soft 不拖垮宿主」的有意设计 + 无归属判定 + 无生命周期注销 + 套件普遍依赖退出码。
修复：①观察改 `process.on('uncaughtExceptionMonitor')`（记录不抑制，保默认退出语义）+ 插件自有可恢复调用点局部 try/catch、自有定时器/Promise 全带 catch；②最小改良：至少 :17351 dispose 链里 removeListener 并复位两个 guard 标志。产品权衡：当年 EPIPE 自激事故已由 damSafeDiag（:13318-13335）+ damSwallowStreamErrors（:13338）+ 重入闸三层独立防护，抑制默认退出已非必要依赖，放宽代价可控，但属行为契约变更，建议发版说明。验证：探针复跑 dispose 后监听数 0、无关致命异常 exit 非零；run-smoke 对含故意致命异常的套件报 FAIL。PR#239 在 consolidate 套件加的 uncaughtException→exit(1) 是单套件缓解非源修复。

### B-3 #222 「V3」保存同一物理目录别名被误判为迁移并拒绝 —— **成立（现位 wip，批次 Z 引入的回归；P2 合理）**

「V3」语境：指 PR#215 的 V3 设置 UI；报告基线=上游 f2f7cc1+开放 PR 组合。核心保存/迁移语义已随批次 Z 进入现位 wip ⇒ 是现行 wip 行为，非「仅 PR 分支缺陷」。

| # | claim | 裁决 | 证据 |
|---|---|---|---|
| 1 | _saveConfigChecked 用展开后字符串路径比较判迁移 | 成立（现位 wip） | lib/index.js:2883（changingRoots 用 expandUserPath(...) !== ...）、:2892-2894（from !== to 即调迁移）；expandUserPath（:2930-2935）无 realpath |
| 2 | 迁移模块按 realpath 判同目录而拒绝 | 成立 | lib/settings-safety.js:82-85：canonicalDirectory（:64-75）归一后 source===target → throw 'Migration source and target must not overlap.'；save 层包装成 userMemoryDir: migration failed...（:2899） |
| 3 | 只需更新绑定却被整体拒绝 | 成立 | 别名场景：字符串不同→进迁移→realpath 归一相等→拒；配置原样保留（无数据丢失，但别名绑定无法建立） |
| 4 | PR#212 的保存实现按物理路径去重、允许该变化 | 核实属实 | git show pr-212:lib/calendar-lock.js:7-11 canonicalCalendarPath |
| 5 | 相对旧行为是回归 | 成立 | 批次 Z 前（d22dd96~1 的 _saveConfigPre）同样字符串比较触发迁移，但迁移是 copyDir+EXCL——同物理目录时全部 retained 不会拒；migrateSettingsTree+重叠拒绝由 d22dd96（批次 Z）引入 |

触发：任意 saveConfig 把 userMemoryDir/memoryRoot 改为「字符串不同、物理同根」路径（校验层对 DSH_HOME 内部别名放行）。后果：保存被拒（fields 错误），无数据损坏。修复：_saveConfigChecked 迁移前 from/to 用 canonicalDirectory（可从 settings-safety.js 导出）归一，物理同根⇒跳过迁移、照常原子写提交新绑定；:2883 changingRoots 同口径归一（避免纯绑定变化空开迁移窗口 409）；保留包含/嵌套场景重叠拒绝。契约兼容：smoke-test-settings-safety.mjs:165-173 固化的是迁移原语 overlap 拒绝（含相等），修 save 层不动原语；:88-95 用例是真不同目录+注入故障，无别名相等拒绝用例 → 不会被打破。验证：Windows junction / Linux symlink 各一例——saveConfig({userMemoryDir: alias}) 应成功、migrated 无复制计数、MEMORY.md/CALENDAR.md 字节不变、无 .dsh-settings-migration.json 残留；负例（嵌套别名）仍拒。纯后端，与批次 Y/PR#239 无交叠。

### B-4 #223 「新版看板」(boardMode=graph) 下取消侧栏「记忆 (pre)」按钮 —— 诉求合理（feature request，非 bug）

| # | claim | 裁决 | 证据 |
|---|---|---|---|
| 1 | 按钮注册在 sidebar.footer.action，id=auto-memory-pre | 属实 | lib/client.js:18448-18450（label=t('memory')+' (pre)'，order 5）；SidebarButton（:6170-6179）唯一行为 controller.toggle()（:177） |
| 2 | 已有开关可用？ | 无 | 注册无条件；客户端注册路径不读 boardMode；无 entry/sidebar 配置键；panelPos='page' 时按钮仍显示（点击无浮层效果，既有小瑕疵） |
| 3 | 诉求合理性 | 合理 | 纯 UI 偏好；隐藏后经典承载面仍有「记忆」会话页（:18469）与设置区入口；注意 boardMode 自 3.0.0 起出厂默认就是 'graph'（lib/index.js:508）→ graph 用户=几乎全部用户 |

实现成本（改动点全在手写区，需重钉 iter5-skin 哈希锁）：机制现成——挂载根已有 apiGet(API.config)（:18215，现读 locale/autoPopupEnabled）；refreshSurfaces()/setSurfacesRefreshHook（:18511/:18517）已提供条件变更即重注册通道（语言切换在用）。
- 方案 A（不加新配置键，最小）：registerSurfaces() 对 sidebar.footer.action 组加条件——①直接绑 boardMode==='graph'（约 5-10 行，但等于对所有 graph（默认档）用户砍掉 bottom-left 档用户唯一浮层入口，需产品裁定）；②localStorage 本地开关（约 5 行 + README 一句，立即给报告者 relief，缺点不可发现）。
- 方案 B（推荐转正式 feature）：新配置键（如 sidebarEntryEnabled，默认 true）+ 设置页开关。成本中等：DEFAULT_CONFIG 1 行 + :18215 读取与 :18448 条件化 + 设置控件三面同步（经典手写 SettingsPage + iter5 生成源 settings-copy.js/views.js + frozen）+ 三语字典 + settings-parity 键扩位 + 哈希锁重钉。
- 若要 graph 默认隐藏又不改默认行为，可做三态键（graph 且键为 'auto' 时隐藏）。建议批次 Y 转正后排期（方案 B 动 iter5 设置源，批次 Y 刚改过 settings-copy/views）。

---

*本 handoff 由 ZCode 会话于 2026-10-06 写就；上游数据抓取时间 2026-10-06；核查基线 HEAD=e3498c6（wip/20260926-teamwork）。*
