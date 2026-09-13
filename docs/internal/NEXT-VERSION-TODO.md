# 下一版待改（用户 2026-09-10 19:0x 指定）

> 来源：用户实机观察 —— 「自动接续又触发了，而且确实才刚过半，太浪费；你现在依靠那个 max output 来算，但官方压缩也是等到上下文真正占到 80% 才开始；新窗口依旧没有按正确序号排序。接续流程我已经关掉了，只要记着下一版怎么改就行。」
> 状态：**✅ 三项已于 v2.5.0（2026-09-13）落地**：①分母=官方声明窗口（reserve 退出分母，新增预测性硬墙 estTokens+reserve>判定窗）②cont-seq.json 持久计数器（全局单调/失败回滚/标题扫描兜底，smoke-test-contseq-pre.mjs）③docs/prompts/RELEASE-AGENT.md 等四份任务书 + RELEASE-PROCESS.md 角色分工。`autoContinueEnabled` 出厂默认仍为 false，是否翻回待用户实机验证后定夺。

---

## 改点 1 · 水位判据口径：不要把「预留输出」当成分母

### 现状（取证到行）
| 位置 | 事实 |
| --- | --- |
| `lib/index.js:1884-1886` | `win = sessModel.contextWindow`（官方声明窗口，本机 deepseek-flash = 1,048,576） |
| `lib/index.js:1899` | `reserve = sessModel.maxTokens`（该路由预留输出，实测 384,000） |
| `lib/index.js:1900` | `effectiveWin = (reserve > 0 && reserve < win*0.9) ? win - reserve : win` → 本机 **664,576** |
| `lib/index.js:1967` | `waterLevelRing = estTokens / win`（声明窗口口径） |
| `lib/index.js:1971` | `waterLevelWall = max(0, hardWin − reserve)`（距硬墙余量） |
| 触发判据 | 走**可用额度口径**（`estTokens / effectiveWin`）：实测阈值落在 ≈46 万 token，而**官方压缩要等到约 80% ≈ 83.9 万**才动手 → **早触发约 45%** |

### 根因
把「单次请求的最大可用额度」（`win − reserve`）当成了水位分母。它确实是**单请求硬失败**的边界，但不是**官方压缩**的坐标系 —— 于是水位数被系统性放大，接续在"刚过半"时就触发。

### 下一版改法（两条线并行，别只改一半）
1. **正常接续触发线与官方压缩同坐标系**：分母改用**官方声明窗口 `win`**（或 provider 自报硬限 `hardWin`，取能得到的最小可信值），阈值默认 **0.75–0.78**（略早于官方 0.80，好在压缩丢细节之前完成一次干净交接）。
2. **保留硬墙保护，但降级为"真会失败才触发"**：仅当 `estTokens + reserve > min(win, hardWin)`（下一次请求就会被拒）时才硬触发。**不要把 reserve 从分母里扣掉** —— reserve 只用于"距硬墙余量"展示与这条硬判据。
3. **展示与判据解耦**：面板继续显示双口径（本会话水位 / 官方小圈读数 / 距硬墙余量），但**触发只认第 1 条的坐标**；`CONTEXT_WINDOW_EXCEEDED` 与 compaction 事件继续作硬触发（不变）。
4. 迁移注意：老配置里已落盘的 `autoContinueThreshold`（0.75）在新坐标系下语义等价于"窗口的 75% ≈ 78.6 万"，正好落在合理位置；**不需要强制迁移**，但要在设置页 hint 里改口径说明（"按官方窗口计，官方在 80% 压缩"）。

### 验收
- 本机 deepseek-flash 路由：阈值 0.75 时，触发点 ≈ 78.6 万 token（而非 46 万）；`waterLevelRing` 与触发比例**同分母**。
- 单请求硬失败保护仍在：构造一条 `estTokens + reserve > win` 的场景，应走硬触发而不是等到比例线。
- 回归：`water-window-pre` / `water-hard-trigger` / `autocont-host` / `water-step` 四个套件全绿（含新增"不得把 reserve 计入分母"的反向锁）。

---

## 改点 2 · 接续序号（新窗口没按正确序号）

### 现状（取证到行）
| 位置 | 事实 |
| --- | --- |
| `lib/index.js:2646-2648` | `contSeq = (handoff 目录里 /^prev-session-.*\.md$/ 的文件数) + 1` |
| `lib/index.js:2533` | 转写包落盘名：`prev-session-<sid8>-<stamp>.md` |
| `lib/index.js:2182-2187` | 宿主兜底路径补的 `sc.rename({sessionId, title: '接续 #' + contSeq + ' · ' + wsBase})`（2026-09-10 才补，此前只有浏览器路径有） |

### 疑似根因（下版按序排除）
1. **计数来源不稳**：序号来自**文件枚举**，而包是"接续时/之后"才落盘的 → 落盘失败、被清理、或写到**别的工作区的 handoffDir**（`p.handoffDir` 是按工作区解析的）时，计数不递增或**跨工作区重复**。
2. **取数时机**：`contSeq` 在 `buildContinueCarry` 里算，若该次 carry 复用了缓存/旧 pack，`contSeq` 可能为空 → `if (d.contSeq ...)` 不成立 → **不 rename**，标题退回自动生成的"接续上一会话的任务。材料已…"（此现象早前出现过一次）。
3. **路径覆盖不全**：三条入口（面板一键接续 / 宿主兜底接续 / 重启后接续）是否都拿到了 `contSeq` 并成功 rename，需逐一核对 diag 日志。

### 下一版改法
1. **序号改持久计数器**：`handoff/cont-seq.json`（键 = workspaceId，值 = 已发出的最大序号），取数即 `++`；若文件缺失则回退为"从现有 `接续 #N` 标题/`prev-session-*` 包名里解析最大值 + 1"（兼容老数据）。
2. **rename 兜底**：把 `contSeq` 为空的情况改为"用持久计数器兜底值"而不是跳过；rename 失败写 diag（现状只有 catch 里一条 diag，需确认两条入口都写）。
3. **会话列表排序依据**：若侧栏排序仍不按序号，检查是否需要在 rename 后同步排序字段（sequence/title 排序键），不要只改标题。
4. **落盘顺序**：确认"写包 → 算序号"还是"算序号 → 写包"，把序号分配与包落盘做成**同一次事务的顺序**（先分配序号、再写包、失败回滚计数器）。

### 验收
- 连续接续 3 次：标题依次为 `接续 #N`、`#N+1`、`#N+2`；换到另一个工作区接续**不重复**已有序号。
- 三条入口各测一次，diag 里都能看到 rename 成功记录。
- 新增 smoke：计数器持久化 + 跨工作区不重复 + 包落盘失败时不跳号。

---

## 关联现状（改这两个点之前要知道）

- 用户**已手动关闭自动接续**（`autoContinueEnabled = false`）以免浪费 token；改完需用户自行开启并重启 dsh web 验证。
- `v2.4.1` 已含「已接续闩锁」（`~/.dsh/memory/auto-continue-done.json`），本次"又触发"是在**该闩锁之前就已 arm 的会话**上发生的，不代表闩锁失效；下版验证时要区分"闩锁没拦住"与"口径太早"。
- 相关 diag：`~/.dsh/dsh-auto-memory-pre-diagnose.log`（`auto-continue armed / deferred / deadline reached / rejected at edge / host-executed` 全在这条线上）。

---

## 改点 3 · 固定流程外包给子代理（主对话只做决策）

> 用户 2026-09-10 提出：「这种固定流程（尤其是已经多次固化成 skill 的），比如发版本，不应该由主对话来处理，主对话太耗上下文了，应该丢给一个 sub agent，思考强度不用特别高。他做完了或者出错了就扔回主对话，让主对话决定怎么解决。」

### 目标形态
- **主对话只做三件事**：①开闸前确认前置门（脏树范围核实 + 全量回归结果）②收到回报后判定放行/中止 ③失败时决定处置方向。**不逐步执行流程**。
- **子代理执行**：按检查表全跑，**出错即停**，回报一个结构化结论：
  `{ ok, version, pre_sha, rel_sha, tag, npm_latest, failed_step, error_tail(≤20 行) }`
- **凭据不进提示词**：子代理自行从 `--D--dsh_debug--/MEMORY.md` 读（该处明确「只存本地，严禁写入任何会上传 GitHub/npm 的文件」）。

### 落地形态（下版做）
1. **`docs/prompts/RELEASE-AGENT.md`** —— 给子代理的完整任务书：照 `docs/internal/RELEASE-PROCESS.md` 逐条展开 + 回报格式 + 出错即停规则 + 禁止事项（无 PAT 不得 push、未过闸门不得发布、除版本标识与 CHANGELOG 外不得改文件）。
2. **`RELEASE-PROCESS.md` 顶部加「角色分工」段**：主对话=决策者 / 子代理=执行者，并写明「主对话不得逐步执行本清单」。
3. **同类流程一并外包**：全量回归、docs 双语对账、子代理痕迹巡检，各写一份任务书（`docs/prompts/*-AGENT.md`）。

### 已知约束（先记下来，免得下版踩）
- **当前工具面无法给 `subagent` 指定思考强度**：`subagent` 只接受 `description/prompt/run_in_background`，`workflow` 的 `agent()` 会**显式拒绝** `effort`/`agentType`。要真压到 low/off 只有两条路：①在 DSH 侧给该路由/预设配默认推理强度；②**由插件自己 spawn** —— 插件已有 `subagentReasoningEffort: off|low|high|max`，经 `ctx.subagents.start({ agentOptions })` 下发。
- **子代理看不到主对话**：任务书必须自包含（路径、命令、判据、回报格式全写死）。
- **不得并发**：同一工作区的写盘流程（尤其发版）必须串行。
- 子代理同样受「不重启宿主」约束：需要重启才生效的事只能回报给用户，不能自己动手。

### 验收
- 主对话跑一次发版：其上下文增量只含「开闸判断 + 子代理回报 + 三处复核」三块；
- 故意造一次失败（如抽掉 CHANGELOG 的 `## [<ver>]` 小节）：子代理回报 `failed_step=5.05` 且 `error_tail` 含闸门原文，主对话据此给处置；
- 子代理输出里不出现凭据明文（除命令行本身；不落盘、不入 git）。
