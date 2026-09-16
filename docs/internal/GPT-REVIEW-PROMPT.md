# GPT 全量测试任务书 · dsh-auto-memory「WB-GRAPH 白板线」改动审查

> 交付对象：一个具备文件读取与命令执行能力的 AI 审查者（GPT）。
> 你的角色：**独立第三方审查者**。不要相信作者的自述，一切以代码、配置、命令输出为准。
> 产出：一份可执行的缺陷报告 + 规划合规清单。**禁止修改任何代码/配置**（只读审查）。

---

## 0. 环境与边界（硬约束，务必遵守）

| 项 | 值 |
| --- | --- |
| 代码仓库（pre 开发线） | `D:\dsh-auto-memory` |
| 宿主插件主体 | `lib/index.js`（约 9800 行，单文件巨兽） |
| 浏览器半边 | `lib/client.js`（约 4700 行） |
| 用户配置文件（**只读，不要改**） | `C:\Users\JH Z\.dsh\dsh-auto-memory-pre.json` |
| 全量回归命令 | `cd D:\dsh-auto-memory && node tools/run-smoke.mjs` |
| 当前回归基线 | `PASS 95 / FAIL 0 / TIMEOUT 0 (145.4s)` |

**禁止事项**（违反即审查失败）：
1. 不要修改、创建、删除仓库内任何文件；不要改配置文件。
2. **不要重启、停止任何 dsh 进程**（该进程承载审查者本体，杀它会中断审查）。不要执行 `Stop-Process` / `taskkill` / 任何按进程名批量杀进程的命令。
3. 不要 `git commit` / `git push` / `npm publish`。
4. 不要为"验证"而写入用户真实记忆目录（`C:\Users\JH Z\.dsh\memory\...`）——如需文件系统测试，只用系统临时目录。
5. 允许：读文件、grep、跑测试命令、写临时脚本到系统临时目录后执行。

---

## 1. 项目背景（30 秒版）

`dsh-auto-memory` 是 DeepSeek Harness（DSH）的记忆插件。它有两条「白板线」形态：

- **旧版（legacy）**：白板 = `handoff/PLAN.md`（人可读全貌）+ `handoff/handoff-*.md`（四段式交接账本），纯 Markdown，无结构化索引。
- **新版（graph）**：引入 `boardMode` 开关，切换到 graph 档后应额外启用：① 结构化 sidecar 索引 `handoff/index.json`；② 两个遍历工具 `memory_expand_pre`（按 tag 正向展开）/ `memory_trace_pre`（按 id 反向回溯）；③ 预留接入第三方看板插件 `dsh-graph`（已 vendor 到 `vendor/dsh-graph/`，**尚未接线**）。

**本窗口（2026-09-16 凌晨）新交付**，全部在未提交的 pre 线：

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `lib/board-mode-pre.js` | 新增 | 总开关解析：`legacy`（默认）/`graph`，非法值 fail-closed 回 legacy |
| `lib/wb-sidecar-pre.js` | 新增 | sidecar 纯函数：条目 id 派生、tag 提取、index 重建、expand/trace |
| `lib/ledger-criteria-pre.js` | 新增 | P1 判据对账 + 从 `wb-contract-pre.js` 转发再导出（单一真源） |
| `lib/index.js` | 修改 | `DEFAULT_CONFIG.boardMode='legacy'`；两咽喉挂 `writeSidecarEntryPre`；新增 `rebuildSidecarIndexPre` / `expandWhiteboardByTagPre` / `traceWhiteboardByIdPre`；条件注册 2 个新工具 |
| `lib/client.js` | 修改 | 设置页双按钮 + 接续面板快捷按钮（同一配置键 `boardMode`） |
| `vendor/dsh-graph/` | 新增 | dsh-graph v0.11.0 搬运（MIT），含 `NOTICE-VENDOR.md` |
| `tests/smoke/smoke-test-p1-ledger-criteria-pre.mjs` | 新增 | 10 断言 |
| `tests/smoke/smoke-test-p23-wb-sidecar-pre.mjs` | 新增 | 10 断言 |
| `artifacts/_mutate-p23-sidecar.mjs` | 新增 | 变异演示脚本（3 例） |

**权威规划文档**（合规审查的唯一依据，请先读它们）：
1. `docs/internal/WB-GRAPH-INTEGRATION-PLAN.md` —— 逐项改动清单（P2-1…P2-6、P3-1…P3-3）、判据 schema（§2.2）、改动清单与工程量
2. `docs/internal/WB-FORMAT-CONVENTION.md` —— 格式契约（§2 锚点 id 契约、§3 索引派生、§4 写入门、§5 人机分区、§6 lint、§8 验收清单）
3. `docs/internal/WB-GRAPH-DECISIONS-20260914.md` —— 用户拍板记录（§E 为最新裁定）
4. `docs/internal/REVIEW-WB-GRAPH-SELF.md` —— **作者自审**（含作者已发现的疑点，请独立复核，不要照抄）
5. `docs/internal/REPORT-WB-GRAPH-NIGHTLY.md` —— 作者交付报告（**注意：其中的"交付总览"含未完成项，可能与实际不符**）

---

## 2. 你的任务

### 任务 A · 复核作者自审声称的 3 个致命 bug（首要，逐条给结论）

作者在 `REVIEW-WB-GRAPH-SELF.md` 中声称发现 3 个致命 bug。**请独立验证每一条，给出「确认 / 证伪 / 部分成立」+ 代码证据（文件:行号 + 关键代码片段）**：

**A1（作者称）：工具注册时机早于配置加载 ⇒ graph 档永不生效。**
作者证据链：`lib/index.js` 内 `const tools = [...]`（约 :8506）在 `apply()`（约 :7633）中同步构建；注册闸门读 `engine.config.boardMode`；而 `engine.config` 在构造时只有 `DEFAULT_CONFIG`（`boardMode: 'legacy'`），真配置需 `loadConfig()` 合并，`loadConfig()` 唯一自动触发点是 `resolvePaths()`（懒加载，首次工具调用才发生）。
**请验证**：① `apply()` 全段内是否真的没有 `await ... loadConfig()`；② `tools` 数组构建与 `ctx.tools.register` 的先后；③ 结论是否成立（graph 档下 2 个新工具是否真的注册不了）。
**重要**：请进一步判断——如果 A1 成立，那么**回归是否应该变红**？为什么 95 个套件仍然全绿？（提示：想清楚测试跑在哪个 boardMode 下、以及"锁"是否真的建全）

**A2（作者称）：P2/P3 取工作区路径的 API 用错。**
作者证据：新增方法用 `agent && agent.cwd ? agent.cwd : process.cwd()`；`agent.cwd` 在全仓仅这 2 处命中；既有权威写法是 `await this.resolvePaths(agent)`（返回 `{ws, projectDir, handoffDir, planPath, ...}`，见约 :1738-1790，全仓 20+ 处在用）。
**请验证**：① `agent` 对象在 DSH 插件上下文里究竟有哪些字段（可从 `lib/index.js` 既有用法归纳）；② `agent.cwd` 是否真不存在；③ 若成立，两个遍历工具的实际行为是什么（会去哪个目录找 `index.json`？会不会在错误目录创建文件？）。

**A3（作者称）：设置页按钮"改了不保存就刷新" ⇒ 用户点完等于没点。**
作者证据：设置页新按钮调用 `set('boardMode', m)` 后 `window.location.reload()`；`set()` 实现（`lib/client.js` 约 :4047）只做 `setCfg(next); setDirty(true)`（本地 state + 脏标记），真正写盘要靠"保存"按钮；而接续面板的按钮用的是 `saveConfigPatch(...)`（立即写盘）。
**请验证**：① 该 `set()` 语义是否属实；② 350ms reload 是否会丢脏数据；③ 用户配置文件里 `"boardMode": "graph"` 已存在（见 §3），据此反推用户实际点的是哪个按钮；④ 是否还有别的写入路径能让它落盘。

---

### 任务 B · 寻找作者**没有**发现的新缺陷（重点）

请特别审查以下高风险区域，逐项给结论（有问题 → 给复现步骤 + 期望/实际）：

**B1 · 新工具的参数与返回契约**
- `memory_expand_pre` / `memory_trace_pre` 的 `execute` 签名是否为 `(args, exec)`（对照既有工具，如 `memory_recall_pre` 等）；`exec.agent` 是否存在（A2 相关）。
- 工具返回值的结构是否与 DSH 工具协议一致（既有哪些工具返回什么？新工具是否会被前端正常渲染）。
- `defineTool` 的 `parameters` 字段是否符合既有约定（注意作者手写的 `limit` 用了 `type: 'integer'`——既有工具怎么写？不匹配会怎样）。

**B2 · sidecar 写入路径**
- `writeSidecarEntryPre` 的 fail-soft 是否正确（try/catch 是否覆盖全部可能抛错点；`mkdir`/`writeFile` 是否都在 try 内）。
- **并发安全**：读 `index.json` → 改内存 → 写回，三步非原子。若两次写入并发（或账本与 PLAN 同轮各写一次），是否会丢条目？既有代码库有没有已确立的原子写/串行化约定（本仓库历史上有 `state-commit-pre.js` 等并发修复，请查）？
- 写入的 `relPath` 用的是 `path.relative(projectDir, p)` —— 在 Windows 上会产生**反斜杠**相对路径（如 `handoff\handoff-xxx.md`），而 PLAN 那条却写死正斜杠 `'handoff/PLAN.md'`。这会不会导致同一个文件两条记录、或 id 不一致、或 `source` 字段跨平台不一致？

**B3 · 条目 id 与锚点契约一致性**
- `wbEntryIdPre(workspaceKey, relPath, title)` 是否真的符合 `WB-FORMAT-CONVENTION.md` §2 的锚点契约（读文档原文对照：拼接顺序、分隔符、哈希算法、取前多少位）。
- `workspaceKey` 传入的是 `path.basename(projectDir)`（因为 `this.wsDirKey` 不存在，见 A 之外的 BUG-4）——这与 `resolvePaths()` 的 `ws` / `wsKey(ws)` 口径是否一致？会不会导致**同一工作区在不同入口算出不同 id**？
- `title` 参数：账本传的是 `'交接账本 ' + basename`，PLAN 传 `'白板 PLAN'`——与实际文件里的标题行是否一致？不一致会导致什么？

**B4 · tag 提取的鲁棒性**
- `extractTagsPre` 的正则 `/(^|\s)((?:tag|type|topic):[\w\u4e00-\u9fff-]{2,24})/g`：`\w` 在 JS 里是 `[A-Za-z0-9_]`，中文靠显式区间。请构造边界用例（标签紧贴标点、行首、全角冒号、长度超限、大小写、重复）看是否漏提/误提。
- 章节标题降 tag 用 `'sec:' + 标题.slice(0,24)` —— 若标题含 `:` 或空格，与 expand 的精确匹配是否会失配？

**B5 · legacy 档"字节级不变"是否成立**
- 作者声称默认档旧行为完全不变。请**实际验证**：检查所有新代码路径是否都被 `graphEnabled` 闸门罩住（含 `writeSidecarEntryPre`、两个工具的注册、`rebuildSidecarIndexPre` 的调用者）。
- 特别注意：新增的 `import`（`board-mode-pre.js` / `wb-sidecar-pre.js`）是否引入了任何**模块级副作用**（读文件、建目录、注册监听、改全局）。
- 特别注意：`DEFAULT_CONFIG` 新增字段，是否会影响配置序列化/比对/指纹（本仓库有"同输入同字节"的注入契约与配置指纹，请查有无受影响）。

**B6 · 测试有效性（是否存在假绿）**
- `tests/smoke/smoke-test-p23-wb-sidecar-pre.mjs`：作者在其中一条断言里把 `src.includes(...)` 改成了正则行首锚定 `/^\s*defineTool\(/`，理由是 includes 会被注释里的同名字符串骗过。请检查**其余断言**是否还有同类"被注释/字符串骗过"的假绿风险。
- 该套件是否真的会在实现被破坏时变红？请**实际做一次变异测试**：挑 2–3 处实现（例如把 `expandByTagPre` 的过滤条件改成恒真、把闸门去掉、把 tag 前缀去掉），改到**临时副本**上验证测试变红（**注意：不要改动仓库原文件**——请复制整个仓库到临时目录后再变异，或仅在临时目录操作；若无法安全变异，就静态论证并说明局限）。
- 三处工具数硬锁（`tests/smoke/smoke-test.mjs:67`、`smoke-test-m3b3-pre.mjs:43`、`smoke-test-context-observer.mjs:107`）当前都断言 `!== 14`。请判断：这是"锁对了"还是"锁没建全"？在 A1 成立的前提下，graph 档下这三个套件会怎样？

**B7 · dsh-graph vendor 的完整性与合规**
- `vendor/dsh-graph/` 是否包含运行所需的全部文件（对照 `dsh-graph-host/package.json` 的 `files` 字段与 `main`/`exports`）。
- MIT 许可文件是否保留、`NOTICE-VENDOR.md` 的记述是否准确（对照 `dsh-graph-host/LICENSE`）。
- vendor 目录是否残留 `.git`、绝对路径、构建产物缺失等搬运事故。
- 该 vendor 与主插件的命名空间是否有冲突（工具名前缀、REST 路径、client 槽位、存储目录）。

---

### 任务 C · 规划合规审查（"什么没有按照规划完成"）

逐项对照 `docs/internal/WB-GRAPH-INTEGRATION-PLAN.md` §5 改动清单与 `WB-GRAPH-DECISIONS-20260914.md` §E 拍板，做出**完成 / 部分完成 / 未完成**三态判定，每项附证据：

| 编号 | 规划要求（摘要） | 请判定 |
| --- | --- | --- |
| P2-1 | 两咽喉落盘 sidecar：每账本同名 `.json` + 汇总 `index.json`；含 tag/cue 映射与 `criteria.passed/warned` 事件追加 | ? |
| P2-2 | `rebuildHandoffIndex()` 从 PLAN + 账本白名单确定性重建 | ? |
| P2-3 | 结构化检索升级 + `recall` scope 路由与 scope 枚举扩展 | ? |
| P2-4 | 注入端导航层加 tag 摘要行（保持"同输入同字节"） | ? |
| P2-5 | GUI `handoffPanelData` 增加 tag/段视图；fileQ 白名单放行 `.json` | ? |
| P2-6 | 条目锚点（`<!-- memory:mem_... -->`）写入 | ? |
| P3-1 | 注册 `memory_expand_pre`/`memory_trace_pre`；**index.json 缺失时 fail-soft 回落 `searchHandoffCorpus`** | ? |
| P3-2 | 唤醒逻辑：`buildContinueCarry` 第 3 层 guide 加"可用遍历工具重建"提示 | ? |
| P3-3 | **三处工具数硬锁同步 14→16（标注为必须项）** | ? |
| A2 | sidecar 放 `memoryRoot/<ws>/handoff/` 旁挂 | ? |
| A6 | 水位骨架硬判据失败时"照写 + 警示行" | ? |
| B7 | 跳过试点直接实装 | ? |
| B4 | 搬 dsh-graph 接管看板层（**用户核心诉求：可视化看到立项至今全流程**） | ? |

**特别要求**：作者交付报告 `REPORT-WB-GRAPH-NIGHTLY.md` 的"交付总览"表把这些都列成了 ✅ 或有备注。请明确指出**哪些是作者高报/漏报的**，并给出该文档与实际代码的差异清单。

---

### 任务 D · 端到端可用性判定

综合以上，回答三个问题（要给证据，不要给结论词）：

1. **如果把 `boardMode` 设成 `graph` 并重启 dsh web，用户会看到什么变化？**（逐项：配置文件、注册的工具、磁盘新文件、GUI 显示）
2. **这些变化里，哪些是用户真正想要的"可视化看到全流程"？**（对照用户原话：「让用户可以实时、可视化地看到项目从立项到现在的所有流程、弯路、版本更迭等事无巨细的信息；同时也可以让 AI 看到，作为接续的重要参考之一」）
3. **要达成该目标，还缺哪些步骤？**（请按依赖顺序列出，并标注哪些步骤涉及修改用户配置文件、哪些需要重启宿主）

---

## 3. 已知环境事实（供你交叉验证，不要盲信）

- 用户配置文件 `C:\Users\JH Z\.dsh\dsh-auto-memory-pre.json` 中当前存在 `"boardMode": "graph"` 与 `"handoffEnabled": true`。
- 全量回归当前为 `PASS 95 / FAIL 0 / TIMEOUT 0`。
- 用户报告症状：**"切换白板形态后什么都没发生，还是旧版的"**。
- 作者口头解释（待你验证）："需要重启 dsh web 才生效"。
- 本机 DSH 安装位置：`C:\Users\JH Z\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\`（可读，用于核对插件加载与 patch 机制）。

---

## 4. 产出格式（严格遵循）

```markdown
# 审查报告 · dsh-auto-memory WB-GRAPH 白板线

## 结论摘要
- 致命缺陷 N 个 / 高危 M 个 / 中低 K 个 / 规划未完成项 J 个
- 一句话结论：<这套改动当前能否达到用户目标？为什么>

## A. 作者自审 3 条复核
### A1 工具注册时机
- 判定：确认 / 证伪 / 部分成立
- 证据：<文件:行号 + 代码片段>
- 补充发现：<例如"回归为什么没红">

### A2 路径 API
### A3 设置页保存

## B. 新发现缺陷（按严重度降序）
### [致命] 标题
- 位置：<文件:行号>
- 证据：<代码/命令输出>
- 复现步骤：
- 期望 vs 实际：
- 修法建议（可给方向，不要改代码）：

## C. 规划合规清单
| 编号 | 判定 | 证据 | 与作者报告是否一致 |
（逐行填，不一致的必须点名）

## D. 测试有效性评估
- 假绿风险点：
- 变异验证结果（做了哪些、结果如何；未做则说明局限）：

## E. 端到端可用性判定
（回答任务 D 的三问）

## F. 修复优先级建议
1. <第一优先：为什么>
2. ...
```

---

## 5. 审查纪律（重要）

1. **每条结论必须有可复核证据**（文件:行号、命令、输出片段）。无证据的推测必须显式标注「推断」。
2. **区分「确认」与「推断」**——不要把推断写成结论。
3. **主动证伪**：对作者自审的每条声称，先尝试反驳它。
4. **不修改任何文件**；若做了变异测试，必须在临时目录进行并说明。
5. 若发现作者报告（`REPORT-WB-GRAPH-NIGHTLY.md`）存在高报，请**明确指出具体条目**——这比多找一个普通 bug 更重要。
6. 报告用中文；代码/路径/命令保留原文。
