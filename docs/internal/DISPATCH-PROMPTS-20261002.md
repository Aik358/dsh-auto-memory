# 修复任务派发方案（3 段 prompt，串行执行）—— 2026-10-02

> **用途**：把三条修复线派发给执行 agent。本文档含三段可直接粘贴的 prompt。
> **依据文档**：`docs/internal/AUDIT-20261002-FULL-VERIFICATION-AND-FIX-PLAN.md`（后端审计线，39 issue+4 PR）、`docs/internal/FRONTEND-FIX-PLAN-20261002.md`（前端线：生成器 G0+缺陷 G1-G3）、issue #211 核查结论（见会话/记忆 issue211-injection-cadence）。

## 派发结构裁决

**3 段 prompt、串行 A→B→C**（同一 agent 依次执行或三个会话均可，顺序不可换）：

| 段 | 内容 | 为什么在这个位置 |
|---|---|---|
| A | 生成器加固（前端方案 §3 G0 全部 6 项） | 护栏先行：R2 落地后，B/C 段所有 client.js 重建才受保护；小而独立，先行风险最低 |
| B | 后端审计线（审计方案批次 A/B/C/E/G + PR #209 hunk 移植 + #208/#168 采纳 + #207 独立项） | PR hunks 自带的前端改动与后端**硬配对不可拆**，必须在 C 之前整体落位；此后 C 只需修 PR 没修/只修一半的 |
| C | 前端收尾（G1-1/#194 补齐/reflectAuto 闸/G3 清理）+ issue #211 修复项 | 依赖 B 的现状核对，避免重复修 |

**为什么不合成 1 个 prompt**：两条方案合计 50+ 项、改动面 100+ 文件，单会话上下文装不下；混在一批无法归因回滚。
**为什么不并行**：client.js / index.js 是共同改动面，并行必冲突；PR 硬配对约束要求同批落位。

## 默认排除项（用户未拍板，agent 不得自行实施）

1. **F03/#179 workspace-key 迁移整束**（存量用户记忆"看起来消失"+每轮告警的 UX 代价，~20 文件耦合）——在 Prompt B 排除行解除即可纳入。
2. **#201/F26 分块策略升级**（Python 档向量全量重建）——同上。
3. **docs/teamwork-impl 迁出主树**（543 文件的仓库结构变更）——等确认。
4. **injectBudgetChars 口径方向**：默认"文档向代码对齐（8000）"；若想反向（代码降到 2400），改 Prompt C 任务二第 1 条的方向句。

---

## Prompt A（第 1 段：生成器加固）

```
【第 1 段/共 3 段：前端生成器加固（G0 批）】

仓库：D:\dsh-auto-memory（Windows + Git Bash）。分支 wip/20260926-teamwork，起点 HEAD=11b6dba（v3.2.7）。开工前确认 git status 干净；全程在本仓库内工作；允许 commit，禁止 push。输出与代码注释用中文，沿用仓库注释纪律（★日期 + 动作 + 归因）。

任务：执行 docs/internal/FRONTEND-FIX-PLAN-20261002.md 的 §3「批次 G0：生成器加固」全部 6 项（G0-1…G0-6）。动手前先通读该文档 §1（用户两条铁律 R1 同步即通过 / R2 失配即停机）、§2（行为矩阵）、§3。该文档是唯一权威；文中 file:line 以内容匹配为准（±2 行漂移）。

范围边界（严格）：
- 只允许改：tools/build-iter5-skin.mjs、tests/smoke/（新增 smoke-test-generator-idempotent.mjs、smoke-test-frozen-mirror.mjs 两套件 + 翻转 smoke-test-generator-guard.mjs 断言⑤）、skins/iter5/README.md，以及删除 tools/build-iter5-skin.mjs.stage1 与本地 *.bak debris。
- 禁止改 lib/client.js、skins/iter5/*.js、skins/legacy/*.frozen（本批没有任何需要重建的产物改动；结束时 --check 必须仍 SYNC-OK）。

硬性纪律：
1. G0-3 落地会翻转 smoke-test-generator-guard 的断言⑤（默认模式从"告警后照写"改为"exit 2 拒写"，并新增 --force 用例断言覆盖发生），同时改写生成器头部警告块与 :729 一带的旧裁定注释（注明 2026-10-02 用户改裁：R2 取代"默认只告警"）。这是用户明确指令，不得保留旧行为。
2. 运行生成器的合法形态只有 --check / --strict；G0-4 幂等测试需要真实跑一次生成器时，必须 backup/finally 恢复（照抄 smoke-test-generator-guard.mjs ④ 段的既有先例）。
3. G0-2 把约 25 处静默 replace 响亮化（replaceOnce/计数断言）+ 4 处锚点加 -1 检查（:54-55 frozen 切片、:161-162、:199-200）+ stripBlocks 的"BEGIN 有而 END 无"改 throw；错误文案统一格式：[G2] 源已变，生成器未同步：<变换点名>（期望 <N>，实际 <M>）——请同步 tools/build-iter5-skin.mjs 的该变换点。改完后故意弄失配一个变换点验证 exit 2 与文案，再恢复验证 SYNC-OK。
4. 预期现象：G0-2 落地后首跑若翻出存量失配，按错误文案逐个同步生成器本身（本批不涉及产物），严禁为转绿把断言改回静默。

收尾验收（全过才算完成）：
- node --check tools/build-iter5-skin.mjs
- node tools/build-iter5-skin.mjs --check → SYNC-OK
- node tests/smoke/smoke-test-generator-guard.mjs、smoke-test-generator-idempotent.mjs（新）、smoke-test-frozen-mirror.mjs（新）全绿
- node tools/run-smoke.mjs 全量无意外红

交付：逐项回执（G0-x → 结论 / 改动文件 / 验证输出摘要）+ 单个 commit，message：feat(build): 生成器 R1/R2 铁律落地（G0 批：变换点全响亮化 + orphanedLines 默认停机 + 幂等/镜像守卫）。
```

## Prompt B（第 2 段：后端审计修复线）

```
【第 2 段/共 3 段：后端审计修复线（审计批次 A/B/C/E/G + PR hunk 移植）】

仓库同第 1 段。前置：第 1 段（生成器 G0）已完成并 commit——本段要移植含 lib/client.js 的 PR hunks，需要 R2 护栏。开工前 git status 干净；先跑一遍 node tools/run-smoke.mjs 记录基线（已知环境性红仅限 py-runtime-chain 缺开发 venv 一类，出现其他红先查归因）。输出与注释用中文，沿用 ★日期注释纪律。

任务：执行 docs/internal/AUDIT-20261002-FULL-VERIFICATION-AND-FIX-PLAN.md。先通读 §2（全局前提：main↔wip 仅行尾差、前端归属、修复纪律）与 §4（PR 采纳总案）再动手。审计批次 D 不单独执行（由 PR hunks 覆盖 + 第 3 段收尾）。执行顺序：

1) §5 批次 A（9 项 P1 数据安全：#178/#171/#172/#183/#181/#182/#184/#173/#205）→ 批次 B（#174/#185/#170/#177）→ 批次 C（#201 排除后实做 14 项）→ 批次 E（#175/#176 测试修复）→ 批次 G（#167 自动沉淀 P0+P1 必做、P2/P3 可选；#207 的 4 个独立项：cont-seq.json / continued-sessions.json / 归档账本三处裸写改 writeTextAtomicPreSync+按路径串行队列、semantic-js-worker wasm 路径本地化+localWasmPaths 开关）。

2) §4 PR 采纳（与 1) 交织：凡 PR 已含的修复以移植代替重写）：
   - 基底 = .diag-audit-20261002/pr-209.diff（#209 ⊇ #206 严格超集，勿用 #206），按 §4-2 A 级清单逐 hunk 移植 + B 级中的团队 hunks（#174/#185，team-* 4 件 + index.js 团队段 + /team-control + client.js 团队层）+ #164 机制（lib/plan-store.js 整文件采纳）。
   - 明确排除（用户未拍板/方案剔除）：F03 workspace-key 整束（#179，等拍板）；#201/F26（等拍板）；C 级（docs/audit-20261002、docs/phase2-20261002 工作材料不入库；tests/lib/audit-engine.mjs 的 DAM_AUDIT_ENGINE_SOURCE 环境变量后门删除）；§4-4 的 #168 三处剔除（python-setup.js verifyArtifact 整块、smoke-test-graph-mode F1 泳道测试、p9d 负向守卫）。
   - #208 只取：tools/release.mjs 3 行（isDirectory continue）、lib/tier0-catalog.js hunk、smoke-test-issue170-*/smoke-test-issue177-* 测试；84 个资源文件块全部丢弃（wip 已有同 blob 文件）。#168 其余 hunk 可采纳。
   - EOL：PR 基于 main(LF)、本仓 CRLF——整文件检出+行尾归一或 git apply --ignore-whitespace，禁止裸 apply；index.js 的 hunk 逐个核对 before 上下文后落。
   - 硬配对（缺一即假修复）：迁移 previewToken 的三份前端拷贝、/global-brief sessionId 的三处前端取数（2 处在生成块内，落 skins 源重建）、/team-state 形状与前端映射（member 换 currentMember）、smoke-test-t0-2-version-gate 断言更新——随对应后端 hunk 同批落。
   - 冻结哈希重钉：smoke-test-iter5-skin:70 经典档快照哈希、r26 系计数按最终字节重算，注释归因「2026-10-02 审计修复批」，保持"守卫语义不变"声明惯例。
3) client.js 的改动只允许来自 PR hunks 及其硬配对；PR hunk 涉及生成块内产物的（如 F17 headroom、F21 pyOk、F09 sessionId、R01 previewToken 的生成块副本），按审计方案 §2-2 归属落对应 skins 源（skins/legacy/iter5-325.js.frozen 或 skins/iter5/*.js 或手写 SettingsPage）后重建，**禁止只改产物**；每批改完 node tools/build-iter5-skin.mjs --check 收口（SYNC-OK）。遇到 [G2]/[R2] 停机文案时，按 G0 批固化的纪律区分「源变了没同步（硬停，同步生成器）」与「已迁移过（replaceMigrated：断言迁移后形态仍在即放行）」。

硬性纪律：
- 改测试必须真阳性验证：先注入故障让旧断言红，再改断言，再跑绿（#175/#176 尤其；红→绿证据写进回执）。
- #199 红线：不得把 _readWorkbench() 改成返回 {}（null 语义是"未建"判据，用户明示）。
- #202 只取 provider 两行（CUDA→CPU 链），严禁携带同文件 F26 的 CHUNK_POLICY 改动；#187 必须连同 rehydrateProcedureScopes 的 authoritativeIds 一起上；#188 推荐改 catalogFor 对齐契约名（二选一，勿两侧同改）；#205 若不整包采纳 PR，按其最小子集（mkdir+失败回滚+writeTextAtomicPre）独立实现。
- 每个批次一个 commit，message 点名批次与 issue 号；决策项（F03/#201）未获用户拍板不得实施；不 push。
- 单会话上下文不足时：优先完成批次 A + PR A 级 hunk 移植，批次 C/E/G 顺延下一会话（顺序不变，接续时先写回执再继续）。

收尾验收：审计方案 §7 的第 1/2/4/5 项（全量 smoke、生成器 --check --strict、数据安全抽验、release --dry-run 后 staging 含 lib/assets 82 文件与 lib/policies 2 JSON）；§7 第 6 条发布说明只起草文本不发布。

交付：按 issue 号逐项回执（结论/改动文件/守卫与 smoke 结果），注明每项是"PR hunk 移植"还是"独立修复"；被排除项（F03/#201/C级/3 处剔除）单独列一节说明。

### B 段续跑清单（2026-10-03 首轮实况后追加；首轮已完成批次 A 9 项 + B 4 项 + #174/#184 前端 hunks + issue170/174/177 测试，HEAD 36ba201，全量 259/0）

```
【B 段续跑（接 26f98b5/2dd4332/8771baf/36ba201 之后）】

前置核对（先做，防漏项）：
- grep 确认以下各项是否已随 hunk 落地，未落的列入本轮清单：R01/R03/R04/R05（#82/#117/#92/#93：config 原子写+_configSaveChain、diag rotate 连续轮转、会话级 degrade 映射、逐候选 coverage）；F02 的 debugInfo 只读化（memoryIndexSnapshot({readOnly:true}) / _degradeViewSnapshot 不落台账）。

任务 0（最优先）：#164 收口——plan-store.js 已入库但 index.js 零接线（死模块状态，不允许跨会话悬着）：移植 index.js 四处接线 hunk（12/13/72/74：memory_read(kind=plan) 返回 revision、memory_note 版本参数透传、writePlanSnapshot 进 withCalendarLock+preparePlanPre CAS、骨架 createOnly）+ 移植 PR 的 3 个测试套件（smoke-test-issue164-plan-cas / -plan-processes / -plan-tools）并跑绿。

任务 1：批次 C 14 项（#201 排除），凡 PR 已含的以 hunk 移植代替重写（F09/F10/F11/F12/F13/F14/F15/F16/F17/F22/F23/F25/F27/F28/F29 ↔ #186/#187/#188/#189/#190/#191/#192/#193/#198/#199/#200/#202/#203/#204）；F17 的 client 三份 onChange 与 #186 的前端 sessionId 属硬配对，落 skins 源重建；#190 必带 t0-2 断言更新；#188 二选一（推荐 catalogFor 对齐契约名）；#202 只取 provider 两行。

任务 2：批次 E（#175/#176）——真阳性验证（旧断言注入故障必红 → 改 → 绿，证据入回执）。

任务 3：批次 G（#167 P0+P1 必做 P2/P3 可选；#207 四项：cont-seq/接续闩/归档账本三处裸写改 writeTextAtomicPreSync+按路径串行队列、semantic-js-worker wasm 本地化+localWasmPaths 开关）。

收尾：node tools/build-iter5-skin.mjs --check --strict；node tools/run-smoke.mjs 全量（基线 259）；冻结哈希若再变按归因惯例重钉；按 issue 号回执。
```
```

## 分会话执行版（2026-10-03 第二次修订）——取代融合版

> 融合版实测上下文跑道不足（执行 agent 自测每轮注入 ~15k token，任务 1 中途回退）。裁定：**按任务块拆 6 个会话**，每会话 = 通用头 + 对应任务块，完成即 commit + 更新交接账本，全部跑完后派发者一次性复核。
>
> **重要事实修正（2026-10-03 派发者复核）**：执行 agent 声称"pr-209.diff 不含 #164 的版本参数 schema 与返回值 revision"——**不实**。实测 pr-209.diff 含 22 处 `expectedRevision`（memory_note 工具 schema、GUIDANCE、plan-import 冲突检查均在）。#164 收口必须**严格 hunk 移植**（在 pr-209.diff 里 grep expectedRevision 定位全部相关 hunks，不止 12/13/72/74，还包括 schema/GUIDANCE 区），其手写补齐是 CRLF 回归的疑似根源（PR 实现字节级保真、其自带 CRLF 测试在 PR CI 绿；手写路径规整了行尾）。

### 通用头（每个会话开头粘贴）

```
【修复线分会话 · 通用头】
仓库：D:\dsh-auto-memory（Windows + Git Bash），分支 wip/20260926-teamwork。开工先读交接账本 handoff/handoff-20261003-031820.md 的重放清单与两条关键发现；确认 git status 干净、HEAD 与账本一致。允许 commit，禁止 push。★日期注释纪律。
本会话只做下面一个任务块，完成即停：阶段闸门（--check + 全量 smoke 全绿）→ commit（message 点名任务块）→ 更新交接账本（进度/下一步/重放清单）→ 输出小回执（逐项结论/改动文件/验证证据/不确定项）。不确定的事记回执，不自行拍板。
通用纪律：PR 已含的以 hunk 移植代替重写，EOL 禁止裸 apply；[G2]/[R2] 停机区分「未同步=硬停」vs「已迁移=replaceMigrated」；改测试真阳性验证；决策红线 F03/#201/teamwork-impl/预算方向不动；#199 红线不动；冻结哈希重钉带归因注释。
```

### 六个会话的任务块

| 会话 | 任务块 | 要点 |
|---|---|---|
| 1 | #164 收口 | **严格 hunk 移植**：在 pr-209.diff grep `expectedRevision`（22 处）定位全部 hunks（12/13/72/74 + schema/GUIDANCE 区）；3 个测试套件跑绿（CRLF 断言必须过——若手写路径仍规整行尾即为移植不完整）。上会话的回退维持，重放其账本。 |
| 2 | 批次 C（14 项 + 补漏） | 含 R01（_configSaveChain，任务 0 已证 0 命中）、#187（authoritativeIds，0 命中）；R02（migrationPreviewToken 3 处）与 memoryIndexSnapshot readOnly 先做**语义验证**（不止计数）；对应 F09/F10/F11/F12/F13/F14/F15/F16/F17/F22/F23/F25/F27/F28/F29；#190 必带 t0-2、#202 只取两行、#188 推荐 catalogFor、F17/#186 前端硬配对落 skins 源重建。 |
| 3 | 批次 E（#175/#176） | 真阳性红→绿证据入回执。 |
| 4 | 批次 G（#167 P0+P1 + #207 四项） | 原子写扫荡 + wasm 本地化。 |
| 5 | 前端收尾（任务 5a-5d 原文） | 批次 D 前端 hunks（F18/F19/F20/F21）+ G1-1 + G1-2 六键 + G3 死壳摘除；先核对任务 2 已落的前端 hunks。 |
| 6 | issue #211 修复项 | 注入口径统一、Python 体积披露/卸载路径、npm/仓库卫生；产出「已修复项清单」。 |

六个会话全部完成后，把六份小回执一并交派发者复核（复核顺序：待复核项裁决 → 关键 hunk 抽验 → 全量+--check --strict+release --dry-run 复跑 → 排除项核对）。

---

## 融合版单次派发（2026-10-03 定稿；⚠️ 实测跑道不足已按上节拆分会话，保留作任务块细则来源）

> 取代上节"B 段续跑清单"与下节"Prompt C"的任务划分（Prompt C 的归属规则 §2-2 引用仍有效）。设计要点：①阶段闸门（每任务块全绿才进下一块）；②批次 D 的前端 PR hunks（F18/F19/F20/F21）首轮未移植，融合版显式指派在任务 5a；③#164 收口为任务 1 最优先；④最终交一份总回执（含"待复核裁定"节），供派发者一次性复核。

```
【融合批：B 段收尾（#164 收口 + 批次 C/E/G）+ C 段（前端收尾 + issue #211）——单次派发，完成交总回执】

仓库：D:\dsh-auto-memory（Windows + Git Bash），分支 wip/20260926-teamwork，接 HEAD 36ba201（基线全量 259/0；G0 护栏 R1/R2 已在位）。允许 commit，禁止 push。输出与注释中文，沿用 ★日期注释纪律。

必读（动手前）：docs/internal/AUDIT-20261002-FULL-VERIFICATION-AND-FIX-PLAN.md §2/§4/§5；docs/internal/FRONTEND-FIX-PLAN-20261002.md §2-2/§4/§6；本文与其冲突处以本文为准。行号一律内容匹配。

总纪律（贯穿全批）：
1. 阶段闸门：每个任务块完成 → （涉产物时）node tools/build-iter5-skin.mjs --check → node tools/run-smoke.mjs（可用 --impact-run 快筛，但每块收尾至少一次全量）→ 全绿才进下一块。
2. 逐 hunk 移植优先于重写；PR 已含的修复禁止重写。EOL 按审计方案 §2-1，禁止裸 apply。
3. 遇 [G2]/[R2] 停机：区分「源变了没同步（硬停，同步生成器）」vs「已迁移过（replaceMigrated）」。
4. 改测试必须真阳性验证（旧断言注入故障红 → 改 → 绿，证据入回执）。
5. 决策红线：F03（#179 整束）、#201/F26、docs/teamwork-impl 迁移、injectBudgetChars 方向（维持文档向代码对齐 8000）——未获拍板不得实施；#199 红线（_readWorkbench 返回 null 语义不得改）。
6. 冻结哈希重钉：按最终字节重算 + 归因注释「2026-10-02/03 修复批」，保持"守卫语义不变"声明。
7. 不确定的事不自行拍板：记入总回执末尾「待复核裁定」节。

任务 0：前置核对（防漏项，先 grep 再动手）
- R01/R02/R03/R04/R05（#82/#160/#117/#92/#93：config 原子写+_configSaveChain、迁移 previewToken fail-closed 与 client 三份拷贝、diag rotate 连续轮转、会话级 degrade 映射、逐候选 coverage）与 F02 的 debugInfo 只读化（memoryIndexSnapshot({readOnly:true}) / _degradeViewSnapshot 不落台账）是否已随首轮 hunk 落地；未落的列入任务 2 清单。

任务 1：#164 收口（最优先；plan-store.js 已入库但 index.js 零接线=死模块，不允许跨批悬着）
- 移植 index.js 四处接线 hunk（12/13/72/74：memory_read(kind=plan) 返回 revision+逐卡 revision、memory_note 版本参数透传、writePlanSnapshot 进 withCalendarLock+preparePlanPre CAS、骨架 createOnly）。
- 移植 PR 的 3 个测试套件（smoke-test-issue164-plan-cas / -plan-processes / -plan-tools）并跑绿。
- commit：fix(audit-B2): #164 PLAN 版本保护接线收口

任务 2：批次 C（14 项，#201 排除；凡 PR 已含的以 hunk 移植代替重写）
- 对应关系：F09↔#186、F10↔#187、F11↔#188、F12↔#189、F13↔#190、F14↔#191、F15↔#192、F16/F17↔#193、F22↔#198、F23↔#199、F25↔#200、F27↔#202、F28↔#203、F29↔#204。
- 专项纪律：#190 必带 smoke-test-t0-2 断言更新；#188 二选一（推荐 catalogFor 对齐契约名，勿两侧同改）；#202 只取 provider 两行（严禁携带 F26 的 CHUNK_POLICY 改动）；#187 连同 rehydrateProcedureScopes 的 authoritativeIds 一起上；F17 的 client 三份 onChange 与 #186 的前端 sessionId 属硬配对，落对应 skins 源（frozen / iter5 / 手写 SettingsPage）后重建，禁止只改产物。
- 任务 0 核出未落的 R01/R02/R03/R04/R05/F02 一并在此补齐。
- commit：fix(audit-C): 批次C 14 项（#186…#204，PR hunk 移植为主）

任务 3：批次 E（#175/#176 测试修复）
- #175 采 \b39\s*(?:个?旧会话|old sessions\b) 收窄（敏感标记全保留）；#176 三处（h43 变异A补 setter 调用、r34 的 h||12 改 h??12 + 夹具自证断言、p3 helper 改 async/await 汇总后置）。
- commit：test(audit-E): #175/#176 测试修复（附红→绿证据）

任务 4：批次 G
- #167 P0+P1 必做（[USER] 写全局前加门槛/待确认区 + 解析层确定性过滤），P2/P3 可选；#207 四项（cont-seq.json / continued-sessions.json / 归档账本三处裸写改 writeTextAtomicPreSync+按路径串行队列；semantic-js-worker wasm 路径本地化 + localWasmPaths 开关）。
- commit：fix(audit-G): 自动沉淀门槛 + #207 独立项（原子写扫荡 + wasm 本地化）

任务 5：C 段前端收尾（先核对：#174/#184 前端已落勿重做；F17/F19/#186 前端若任务 2 已落只核对）
- 5a 移植批次 D 的 PR 前端 hunks（首轮未落，本批显式指派）：F19↔#195（wb-sidecar 三处卡片加 revision + useCardFull 键改/失败不缓存/上限 256）、F20↔#196（style-choice.js 加 dam-skin-changed 事件 + 两挂载根订阅 + 三处 onSwitch 无害化，源+产物成对）、F21↔#197（pyOk verified-ok 四处成组：frozen 改源 + 重建覆盖 + 手写直改）、F18↔#194（hubScopeCounts 单键 hunk）。
- 5b G1-1 normalizeGapRounds（P1）：定义上提工厂层【手写】+ frozen fSnapGap 同步【源】+ 重建；0/正整数/空串/非法值四类输入三面验收；新增守卫"damSkinCssText 函数体内不得有 function 定义"（并入 frozen-mirror）；**完成后删除 frozen-mirror 套件 KNOWN_DRIFT 的对应豁免条目**（三面一致时套件会自动红要求删）。
- 5c G1-2 补差：I18N.ja 其余六键（hubEvLine/hubScopeReasons/hubWhyCorrectionRate/hubWhyDiversity/hubWhyHasCorrection/hubWhySuccess）还原为真函数字面量（严禁 new Function）+ t() 加 __fn 兜底【手写】；i18n-really 补 7 键断言。
- 5d G3 清理：死壳族摘除（先把生成器 DamSkinV4Page→Iter5Page 变换点退化为"断言已无 DamSkinV4Page 引用"再摘壳，否则 R2 拦——预期行为）；renderTeamSettings15 及配套常量删除；StatsTab 缩进统一。
- commit：fix(frontend): 前端收尾（批次D hunks + #169/#194 补齐 + 死壳摘除）

任务 6：issue #211 修复项
- injectBudgetChars 口径统一（文档向代码对齐 8000）：README JSON 样例与 "defaults to a 2,400-char budget" 正文改 8000 + 补 3.2.6 收窄节奏说明（完整版=真人 turn 首次或无人 3×3≈9 步；精简版不承载内容本体）；client 三处 onChange fallback（内容定位 set('injectBudgetChars', … || 2400)）改 || 8000（手写直改 + frozen 改源 + 重建）。
- Python 合计体积披露：pyWiz 系列 zh/en/ja 三语文案补"venv 约 280–400MB + 模型约 539MB ≈ 850MB；可随时在设置中卸载回收"【源】。
- Python 卸载路径：engine 方法 + 路由（删除 <userDir>/python-engine 整目录，存在性检查/错误上抛/禁用态可用）+ 前端二次确认按钮【源】+ README 手动命令（删除 ~/.dsh/python-engine）。
- npm/仓库卫生：package.json files 移除 "docs"（node tools/release.mjs --dry-run 或 npm pack --dry-run 验证 docs 消失、lib/assets 82 文件与 lib/policies 2 JSON 在位）；.gitignore 增补 *.bak-*、*.bakchk、*.stage1（勿 ignore .frozen）；git rm 三个已入库文件：lib/procedure-store-pre.js.bak1-20260923135625、tests/smoke/smoke-test-r15-left-rail.mjs.bakchk、.github/cloud/qq-webhook/index.zip。teamwork-impl 迁移不做。
- commit：fix(211): 注入口径统一 + Python 体积披露/卸载路径 + npm/仓库卫生

最终收尾（全批完成闸门，逐条给出输出）：
- node tools/build-iter5-skin.mjs --check --strict
- node --check lib/client.js
- node tools/run-smoke.mjs 全量（预期 ≥259+新增，全绿）
- node tools/release.mjs --dry-run：staging 含 lib/assets 82 文件与 lib/policies 2 JSON、不含 docs

交付：一份总回执，按任务块 0-6 分节，每项（issue 号/F 号 → 结论 / 改动文件 / 验证证据）；末尾固定三节：
① 「待复核裁定」——所有不确定处与自行判断（hunk 取舍边界、出处标注等），供派发者复活后复核；
② 「排除项确认」——F03/#201/teamwork-impl/预算方向未动的声明；
③ 「真机抽验清单」——给用户的手测点（三种皮肤设置输入四类值、ja 中枢页、调试中心零业务 POST、团队面板四按钮、Python 三态读数、headroom 存 0、PLAN 双窗口冲突路径、卸载按钮、白板展开卡重试）+ 「issue #211 已修复项」清单（供直接回复 issue）。
```

## Prompt C（原第 3 段——⚠️ 已被融合版取代，保留作归属规则与验收细节参考）

```
【第 3 段/共 3 段：前端收尾 + issue #211 修复项】

仓库同前。前置：第 1、2 段已完成并 commit。开工前先核对第 2 段移植后的 client.js 现状：#195/#196/#197/#184 前端/#186 前端若已由 PR hunks 修复，一律不得重复修；全部行号以内容匹配为准。输出与注释用中文，沿用 ★日期注释纪律。

任务一：docs/internal/FRONTEND-FIX-PLAN-20261002.md 前端收尾（先读 §2-2 三种归属：【手写】直改 /【源】改源重建 /【成组】多副本一次改全）：
1. §4 G1-1（normalizeGapRounds，P1）：定义（damSkinCssText 函数体内）上提到工厂层【手写】；frozen 的 fSnapGap 旧口径同步为 normalizeGapRounds(e.target.value, 5)【源】；重建一次；按 0/正整数/空串/非法值四类输入在三种皮肤面验收；新增守卫"damSkinCssText 函数体内不得有 function 定义"（并入 frozen-mirror 套件）。**完成后必须删除 frozen-mirror 套件里 KNOWN_DRIFT 的对应豁免条目**（该套件设计为三面一致时自动红并点名要求删除——G0 批已登记 frozen 侧 snapshotMinGapRounds 旧口径这一条，正是本项）。
2. §4 G1-2（I18N.ja 七键）：第 2 段的 PR hunk 只修了 hubScopeCounts 一个键——把其余六个 __fn 条目（hubEvLine/hubScopeReasons/hubWhyCorrectionRate/hubWhyDiversity/hubWhyHasCorrection/hubWhySuccess）还原为真函数字面量（严禁 new Function/eval），并在 t() 加 __fn 跳过兜底【手写】；i18n-really 套件补 7 键 typeof==='function' 断言。
3. §4 G1-3 后端半：**已由 B 段首轮落地**（reflectAuto"已有反思不覆盖"闸已在 lib/index.js，★2026-10-02 审计修复批注释）——只核对勿重做；B 段续跑若已落地 F17 前端三份 onChange 与 #186 前端 sessionId，同样只核对。
4. §6 G3 清理：死壳族摘除（DamSkinV4Page/Screen/Home/Welcome/Settings、DAM_SKIN_V4_PAGES、DAM_SKIN_V4_HOSTED 全族 + TOUR_STEPS 的 window 暴露）——先把生成器的 DamSkinV4Page→Iter5Page 变换点退化为"断言已无 DamSkinV4Page 引用"再摘壳，否则 R2 会拦（预期行为，按文案同步生成器）；renderTeamSettings15 及其配套常量删除；StatsTab 的 0 缩进统一。每步：改源/生成器 → 重建 → --check → 全量 smoke。

任务二：issue #211 修复项（正文存于 .diag-issue211.json）：
1. injectBudgetChars 口径统一（方向=文档向代码对齐 8000）：README JSON 样例行与"defaults to a 2,400-char budget"正文改为 8000，并补一段 3.2.6 收窄后的实际节奏说明（完整版=真人 turn 首次或无人 3×3≈9 步一次；精简版不承载内容本体）；client.js 三处 onChange fallback（内容定位 set('injectBudgetChars', Number(e.target.value) || 2400)）改 || 8000（归属：手写 SettingsPage 直改 + frozen 改源 + 重建覆盖两个生成块）。
2. Python 合计体积披露：安装向导文案（pyWiz 系列 zh/en/ja 三语）补一句"venv 约 280–400MB + 模型约 539MB，合计约 850MB；可随时在设置中卸载回收"【源】改源重建。
3. Python 卸载路径：后端 engine 方法 + 路由（删除 <userDir>/python-engine 整目录——venv 与 models，含存在性检查、错误上抛、禁用状态下也可用）；前端在 Python 安装/语义设置区加带二次确认的卸载按钮【源】；README 记载手动命令（删除 ~/.dsh/python-engine 目录）。
4. npm/仓库卫生：package.json files 移除 "docs"（运行时零依赖已核实，仅代码注释引用文档路径）；用 node tools/release.mjs --dry-run 或 npm pack --dry-run 验证包内容（docs 消失、lib/assets 82 文件与 lib/policies 2 JSON 必须仍在）；.gitignore 增补 *.bak-*、*.bakchk、*.stage1（不要 ignore .frozen——那是生成源）；git rm 三个已入库文件：lib/procedure-store-pre.js.bak1-20260923135625、tests/smoke/smoke-test-r15-left-rail.mjs.bakchk、.github/cloud/qq-webhook/index.zip。docs/teamwork-impl 迁出主树本段不做（等用户确认）。

纪律：每完成一项跑守卫五件套（FRONTEND-FIX-PLAN §7：--check / node --check lib/client.js / iter5-skin / settings-parity / settings-sync，涉主题加 h43）；哈希重钉带归因注释；任务一、任务二各一个 commit；不 push。

交付：回执 + 全量 smoke 结果 + 一份"issue #211 已修复项"清单（哪条修了、哪个 commit、如何验证），供用户回复 issue 使用。
```
