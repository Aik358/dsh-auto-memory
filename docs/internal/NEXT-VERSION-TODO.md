# 下一版待改（用户 2026-09-10 19:0x 指定）

> 来源：用户实机观察 —— 「自动接续又触发了，而且确实才刚过半，太浪费；你现在依靠那个 max output 来算，但官方压缩也是等到上下文真正占到 80% 才开始；新窗口依旧没有按正确序号排序。接续流程我已经关掉了，只要记着下一版怎么改就行。」
> 状态：**已记录，未开工**（当前 v2.4.1；用户已手动关闭自动接续以免浪费 token）。

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
