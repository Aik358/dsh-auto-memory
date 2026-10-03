# 会话文件可读性缺陷 · 分类与修复协议

- 建立：2026-09-14
- 触发：开启宿主会话内容检索（`session-query-sqlite`，`openAt: first-search`）后，索引器 fail-closed，51/191 个会话文件读不出来 → 检索形同未开。
- 结论先行：**51 个全部可救，但要分四组对症下药；"删行"这条路本身是错的（见 §2 硬规则 R2）**——ZCode 已修的 3 个会话正因此在我的读取路径下仍不可读。
- 本文件是执行手册：批准后按 §3 分组施工、按 §4 校验、按 §5 禁则避坑。

## 1 五十一 个的真实构成（2026-09-14 实测，精确口径）

| 组 | 文件数 | 报错原文 | 病灶 | 来源 |
|---|---|---|---|---|
| 甲 | 39 | `subagent/descriptor 0 uses unsupported descriptor version 2` | `subagent/descriptor` 的 `version` 声明为 2，冻结清单只收 v3 | 宿主 08-15~08-23 自己写的 |
| 乙 | 7 | `permission/preset 75436 data has unexpected member "origin"` | `permission/preset` 事件的 `data.origin`（值 `"selection"`）不在冻结成员表 | 宿主 08-22~08-24 自己写的 |
| 丙 | 3 | `released v2 row N has seq gap (expected N, got N+k)` | **ZCode 删重复事件**留下的 seq 缺口（删 6 / 4 / 2 条） | 2026-09-14 ZCode 修复引入 |
| 丁 | 1 | `assistant/message 190486 message content[0] name must be a non-empty string` | 模型吐了一个空名工具调用，宿主原样写盘（同一轮 `tool/result` 记录 `ToolNotFoundError / UNKNOWN_TOOL`） | 宿主 08-24 自己写的 |
| 丁 | 1 | `cannot safely transform unclassified message source` | `user/message` 的 `source.kind = "anchored-monitor"`（2 处，锚定监控插件的干预提示注入） | 锚定监控插件写的 |

合计 39 + 7 + 3 + 1 + 1 = 51。

**与被检对象无关的事实**：丁组两个文件**不是 ZCode 改的**——ZCode 自己的记忆（`~/.zcode/cli/memories/projects/dsh-auto-memory-…/memory/dsh-session-corruption-repair.md`）逐字写明它只实修了 3 个会话（`1ef5cee8` 删 6 条 / `a82b8e44` 删 4 条 / `9cc01f76` 删 2 条）= 本表丙组；且只有这 3 个目录里留有备份 `session.v3.jsonl.{broken,dup}-backup-*.zstd`（时间戳 2026-09-14 01:20–01:38）。丁组两个目录**无任何备份文件**，主文件 mtime 停在 `2026-08-20 00:44` / `2026-08-24 15:35`（原始写盘时间，未被触碰）。宿主全局包 `%APPDATA%\npm\node_modules\@deepseek-ai` 下 09-13 之后被修改的 `.js` **为 0 个** → 无静默打补丁。

## 2 硬规则（修复前必须内化，全部来自宿主源码实测）

- **R1 写读不对称**：写入侧对 `source.kind`、`name` 等字段**不做白名单校验**，读取/迁移侧**严格校验**。所以"宿主能写出来的，宿主自己可能读不回来"——丁组两例都是这个不对称的产物。
- **R2 `seq` 必须严格连续**：`dsh-session-format-v1-to-v2/lib/index.js:244` 判定 `event.seq !== eventCount` 即抛 `released v2 row N has seq gap (expected N, got N+k)`。`eventCount` 是**行序号**，所以**删掉任何一行都会让该文件永久不可读**（v0 原始行的 seq 不受此约束，此约束针对"已发布 v2 形态"的行——v3 文件同样要过这一关）。
- **R3 一帧一行**：追加式多帧 zstd，**第一帧必须恰好只有 session 头一行**。违反 → 官方 `assertZstdHeaderFrame` 在启动扫描（`WorkspaceRegistry.listStoredHeaders`）时报 `corrupt Zstandard session log`，**整个 dsh web 起不来**（ZCode v1 踩过，本次施工必须复用其教训）。
- **R4 `source.kind` 白名单共 15 项**（`dsh-session-format-v2-to-v3/lib/index.js:14-30`）：`user / plugin / model / tool / agent-instructions / session-reference / team-message / goal / skill-invocation / skill-catalog / coordinator / subagent-report / subagent-settled / webhook / agent-message`。
  - **在白名单内的**（实测，别再误判）：`goal`、`coordinator`、`skill-catalog`、`subagent-report`、`subagent-settled`。
  - **不在白名单内**：`anchored-monitor`、`fallback`、`provider`——但 `fallback`/`provider` 只出现在**不做 source 校验的事件类型**上（如 `session/end-seed`、`request/context`），全库 191 个文件里**真正会被拦下的只有 1 个文件、2 处**（`anchored-monitor`）。
- **R5 校验只发生在 5 类事件**（同文件 `:98-108`）：`user/message`（看 `data.source`）、`assistant/message` 与 `tool/result`（看 `data.message.source`）、`agent/inbox/spliced`（看 `data.inserted[].source`）、`session/title-llm-request`（看 `data.messages[].source`）。其余事件的 `source` 不受约束——排查时不要扩大口径。
- **R6 `sourceEventSeqs` 引用会随 seq 重编号失效**：丙组 3 个文件分别含 5 / 199 / 3 处带 `sourceEventSeqs` 的事件（类型 `tool/result`、`system/message`）。**重编号 seq 必须同步重映射这些引用**，否则会造出指向错位的新语义错误。

## 3 分组处方

- **甲组（39）**：`subagent/descriptor` 的 `version: 2 → 3`。声明式升级，不改语义、不动 seq。已在副本上验证通过（39/39）。
- **乙组（7）**：删除 `permission/preset` 事件 `data` 内的 `origin` 成员（值为 `"selection"`）。不动 seq、不动行数。已在副本上验证通过（7/7）。
- **丙组（3）**：**不要再用删行的方式**。两条路线，择一：
  - 路线 P（推荐）：从同目录 `*.dup-backup-*.zstd` / `*.broken-backup-*.zstd` **恢复原始行**，再按"语义去重 + 全量重编号 + `sourceEventSeqs` 重映射"重写；
  - 路线 Q（省事）：在当前（已去重的）文件上**只做连续化**：把每行 `seq` 重写为行序号 1..N，并用同一映射改写所有 `sourceEventSeqs` 数组。
  - 两条路线都必须同时满足 R2 + R3 + R6。
- **丁组-空工具名（1）**：把 `assistant/message.content[0].name` 与配对 `tool/call.data.name` 的空串填为占位名（建议 `"(unnamed)"`，与同轮 `ToolNotFoundError / UNKNOWN_TOOL` 的既有语义自洽）。**只改这一处 2 个字段**；不要删这一对事件（删了就撞 R2）。
- **丁组-未登记 kind（1）**：`source.kind: "anchored-monitor" → "plugin"`，保留同对象的 `form: "hint"`。`assertSource` 只对 `kind === "agent-message"` 做成员白名单校验，其余 kind 允许附加成员，因此改 kind 值即可，无需增删字段。
- **治本（防复发）**：锚定监控插件的干预注入改用白名单 kind（`"plugin"`，`form: "hint"`）。否则**每一次 L1/L2 干预都会让那个会话日后变成不可迁移/不可索引的文件**——这才是"检索越用越容易死"的机制性来源。
- **上游可报**：①写读不对称（写入接受空 `name`、任意 `kind`，读取 fail-closed 拒绝）；②`subagent/descriptor` 冻结清单只收 v3、`permission/preset` 成员表与宿主自己的写入侧不一致；③索引器 fail-closed 应对畸形文件"跳过 + 计数 + 报告"，而不是整体不可用（LightRAG 的反例已记在 `CROSS-SESSION-SEARCH-RESEARCH.md`）。

## 4 施工流程（每个文件独立走完，任一步失败即跳过并计数）

1. 同目录备份：`session.<ver>.jsonl.<原因>-backup-<ts>.zstd`（沿用 ZCode 命名，便于人眼识别）。
2. 解码 → 按 §3 分组施改 → **逐行压缩**（一帧 = 一行 + 换行）拼接写回。
3. 写前模拟官方校验路径：①首帧恰好一行且 `type === "session"` ②`seq` 与行序号严格一致 ③`call` / `result` 配对平衡 ④`sourceEventSeqs` 无悬挂引用 ⑤无非法 `source.kind` ⑥无空 `name`。
4. 用真实读取路径复测该文件（`createRestore` + `recovery: 'strict'`）→ 必须成功。
5. 全库复测：191 个文件全部通过 → **用户重启 dsh web**（内存里持着脏事件流与索引）。
6. 重启后观察 `session-query.db` 是否建索引、检索是否返回 `[记忆检索|sessions]` 块。

## 5 禁则

- **禁删行**（R2）。含"把重复事件删掉"这类在别的系统里正确的做法。
- **禁批量修 27 个"跨 turn 复用同一 tool_call_id"的老会话**——它们相隔数万条、一直正常跑，批量"去重"会误删正常历史（ZCode 已明确警告，本次复核同意）。
- **禁一次修完不留副本**。丙组正是"改了但没留可对照的原始行"的反面教材（备份是 ZCode 自己额外留的，属运气好）。
- **禁在未做 §4③ 校验的情况下写盘**（R3：不重启发现不了，一旦违反宿主直接起不来）。
- **禁把本协议用于语义内容的改写**：只改坐标/声明类字段（`seq`、`version`、成员表、`kind` 登记值、空 `name` 占位），不改任何消息正文。

## 附录 A 施工口径的通俗说明（拍板用，一页纸）

**共同前提**：现在宿主开了会话内容检索，但它一遇到读不懂的文件就**整库罢工**（fail-closed），所以 51 个坏文件在 = 检索等于没开。下面四件事可任选组合，但至少要有一件，检索才会活。

| 口径 | 一句话 | 具体动什么 | 得到什么 | 代价 |
|---|---|---|---|---|
| **C 就地修复** | 把 51 个文件"治好"，让宿主自己读得回来 | 用 Node 脚本改每个文件里的 1~2 个坐标类字段，**每个文件先备份**，写回保持"一帧一行" | 51 段历史回到宿主正规坐标系：能在会话列表看到、能被检索、能被插件 `scope='sessions'` 搜到 | 动到历史文件（有备份可整体还原）；丙组 3 个要做 seq 重编号，风险最高的一步 |
| **B 索引器打补丁** | 让索引器"遇到读不懂的就跳过并记账"，别整体罢工 | 改宿主包 `dsh-session-query-sqlite` 里那处 fail-closed 逻辑（先备份，留一个可重打的脚本） | 检索立刻可用，且以后宿主再写出畸形会话也不会一票压死全库 | 改的是 `node_modules` 里的宿主代码：**dsh 升级会被覆盖**，需要重打；属于本地补丁，非官方 |
| **A 隔离** | 把 51 个文件"搬出去"，宿主看不见就不会罢工 | 移动到 `~/.dsh/sessions-quarantine/`（文件内容一个字不改） | 最保守、可秒级回退、检索可用 | 那 51 段历史**连会话列表里都消失**（不只是搜不到）；22.6MB 那个最长的会话一起缺席 |
| **D 导出留档** | 先转成 Markdown 存一份，再隔离 | 解码 → 生成可读文本进插件自己的 memory 目录 | 内容仍可被插件的词法+语义检索搜到 | 脱离宿主的工具调用结构；且这是"另存一份"，不是修好原件 |
| **E 只上报** | 本机不动，等官方修 | 写三份上游报告（issues 已关，只能发 discussion，需你浏览器粘贴） | 无本地风险 | 期间会话检索一直不可用；且上游何时修不可控 |

**推荐 = C + B**：C 让历史回到可检索状态（治标且是唯一能"救回历史"的路），B 做保险（因为宿主会继续写出同类畸形会话——写读不对称还没修）。若你只想要"今天就恢复"，**只 B 是最快最保守**；若你只关心"别弄坏东西"，**只 A 最安全**。三者不互斥：可以先 A 让检索立刻可用，改天再逐组做 C。

**施工纪律（无论选哪个）**：每个文件独立走完并留备份；写盘前跑启动级契约校验（首帧恰好一行）；全库复测通过后**由你重启 dsh web**（这一步绝不代做）。

### 附录 B 丁组那 2 个文件的问题，是什么意思

丁组 = 只有 2 个文件需要**改字段值**（其余 49 个只动声明/成员表，不碰语义字段）：

- `session-cc245cf1-…`（22.6MB，最长的一个）：里面有 **1 处空工具名**——当时模型吐了一个没有名字的工具调用，宿主照原样存了（同一轮的返回记为 `ToolNotFoundError / UNKNOWN_TOOL`，即"调了个不存在的工具"）。宿主的读取器现在拒绝空名字。修法二选一：①把那个空名字填成占位符 `"(unnamed)"`（与"未知工具"的既有语义自洽，只改 1 个字段的 2 个位置）；②不修，把它划归 A 组隔离掉。
- `session-fc931245-…`（13.6MB）：里面有 **2 处** `source.kind = "anchored-monitor"`——是**锚定监控插件**注入干预提示时写下的标记，宿主白名单不认这个值。修法二选一：①把 `"anchored-monitor"` 改成白名单里的 `"plugin"`（同时保留它已有的 `form:"hint"`，语义不丢）；②不修，隔离。

**为什么要专门问你**：我们之前立过一条规矩——**历史只能"标记+追加"，不能就地改写**。①就属于"就地改写"，虽然是坐标类字段、虽然消息正文一个字不动、虽然有备份可整体还原，但它确实动了历史。所以这一步需要你点头；你若不同意，丁组这 2 个（都是最长的会话）退出检索即可。

**治本项与它们同源**：只要锚定监控继续用 `anchored-monitor` 这个 kind 注入，**每次干预都会再产出一个日后不可索引的会话**——所以推荐顺手把它改成 `"plugin"`（这是改插件的未来行为，不改历史）。

两者**正交，都要做，但顺序不能反**：ZCode 解决的是"会话活不过来"（重复 `tool_call_id` → 每次发消息都 400 + UI 卡加载）；本协议解决的是"会话活过来了但读不回来"（不可迁移 → 不可索引 → 检索死）。ZCode 的 3 个副本文件的**可读性**需要按丙组补做，其"备份优先"与"一帧一行"两条经验必须继承。
