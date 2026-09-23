# 跨会话 / 跨 Agent 语义检索：路径决策（2026-09-14 预研，待拍板）

> 背景：本机把 DSH 的内容检索打开后，发现它被上游两个缺陷挡住（详见 `ACCEPTANCE-20260914.md` 附录与下文§3）。
> 由此暴露出一件更要紧的事：**本插件承诺的"跨会话检索"其实一直依赖 DSH 的可选特性**，而"跨 Agent 记忆检索"根本没有实现。
> 本文只做决策，不动工。状态约定：✅ 已核实 / ⚠️ 有缺口 / 🎯 待拍板。

## 1. 现状取证（全部带行号，可复核）

| 通路 | 现状 | 取证 |
| --- | --- | --- |
| 本地记忆（每日日志 / 反思 / `MEMORY.md` / 用户级） | ✅ 可用：词法臂 + 语义臂（python dense 优先，失败回退 `_jsSemanticRank`）+ 时间臂 + 重要性加权 + L0/expand 两档 | `lib/index.js:3935-4050`（`recall`）、`:4019-4021`（语义臂择优） |
| 交接白板语料（PLAN + 账本 + archive） | ✅ 可用 | `:3946-3951`、`searchHandoffCorpus` |
| **跨 DSH 会话历史** | ⚠️ **完全外挂在 DSH 的 opt-in 特性上**：①DSH 出厂 `openAt: never` → 用户不做 DSH 侧配置就永久失败；②插件自注入的 guidance 却指示模型用 `memory_recall(scope='sessions')`；③即便开了，老装机（含 v0 + `subagent/descriptor` v2 的老日志）会被上游 fail-closed 整条挡死 | 插件 `:3953-3960`（catch 后把上游错误原文回给模型）；guidance `:2737`、`:2812-2816`；上游：`dsh-base/cordis.patch.yml:121-133`、`dsh-session-format-v0-to-v1/lib/index.js:1584-1587`、`dsh-session-query-sqlite/lib/index.js:724-739` |
| **外部 Agent 记忆文档**（Claude Code `CLAUDE.md`、WorkBuddy/CodeBuddy 画像、ZCode 项目记忆、TRAE/Cursor 规则） | ⚠️ **只被注入上下文，不进检索语料**：`discover()` 抓到 `content`（截 200KB），但 `recall(scope='all')` 的语料只由 handoff + 日志 + 反思 + 项目/用户记忆构成，**从不包含外部源** | `discover()` `:5822-5902`；`recall` 语料装配 `:3983-4002` |
| **外部 Agent 历史会话**（Claude Code / Codex / WorkBuddy / ZCode / Kimi） | ⚠️ 注释自述「**会话源只带文件索引**」「只注入路径不注内容」→ 只能进上下文摘要，不能检索 | `pushSessions()` `:5849-5863`、`:5880-5893` |

**一句话**：插件目前只有"自己的记忆"是可检索的；**别人的记忆（其他 Agent）与自己的历史会话，都不在检索面内**。

## 2. 对"本插件用户"的影响（回答 §研究其他用户）

- **没人会因为本插件踩到上游那个缺陷**：DSH 内容检索是 opt-in，本插件从不替用户打开它 → 用户侧默认是"服务在、但永远拒绝"，插件把上游原话当错误信息回给模型。
- **但用户会踩到本插件自己的缺口**：插件在每轮注入的面板/接续 guidance 里**明确让模型去用 `scope='sessions'`**（`:2737`、`:2812-2816`），而这条路径默认不可用 → 模型照做就报错，用户体验是"说好的历史检索，用了就说不可用"。**这是产品缺陷，不是用户环境问题。**
- **另一个副作用**：`discover()` 白扫了外部源（读文件、算尺寸），结果只用于"注入摘要"；用户在向导里勾选的那些来源，**勾选后其实检索不到**——卖点与能力不一致（与 §C 冷启动那批"幻觉 ON"同类）。

## 3. 为什么不能把宝押在 DSH 的 sessionQuery 上

1. 出厂 `openAt: never`（opt-in），插件不能替用户改 DSH 配置（也不该）。
2. 打开了也可能整条失败：**任一个读不动的老会话 → 全部检索失败**（fail-closed，无容错开关；配置面只有 9 个参数，无 tolerate/skip）。
3. 上游对"老数据"是硬拒：v0 日志里的 `subagent/descriptor` v2 被编解码器拒绝，**且 `next`(0.1.5-rc.2) 两处代码一字未改**（本次下 tarball 比对确认）→ 短期内修不了。
4. 社区已有同族报告：[#4811 单个坏会话让全局会话检索不可用](https://github.com/deepseek-ai/deepseek-harness/discussions/4811)、[#4910 各持久化格式硬拒非当前版本、零迁移路径](https://github.com/deepseek-ai/deepseek-harness/discussions/4910)、[#5694 Failed to load history](https://github.com/deepseek-ai/deepseek-harness/discussions/5694)。
5. 那篇官方设计注记本身就写着会话内容检索是 [opt-in 特性](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-08-13-session-content-search-opt-in.zh.md) —— 依赖它等于把核心卖点寄托在别人的开关上。

## 4. 三条可选路径

### 路径 A（推荐）：插件自建"统一检索面"，DSH sessionQuery 降级为可选加速
把检索语料**收归插件自己**，一句话：**凡是本机读得到的记忆与历史，都进同一个索引，读写自有容错**。

- **语料来源（全部本地、全部自解析）**：
  1. 现有本地记忆 + 白板账本（已可用，不动）
  2. **DSH 会话日志**：用插件自带解码器头帧解码（`decodeZstdFramesHead`，已存在且被 PR#29 加固过）抽出消息文本 → 切块入库
  3. **外部 Agent 记忆文档**：把 `discover()` 已抓到的 `content` 真正入库（Claude Code / WorkBuddy / CodeBuddy / ZCode / TRAE / Cursor）
  4. **外部 Agent 历史会话**：为每个工具写**容错适配器**（Claude Code `~/.claude/projects/**.jsonl`、Codex `~/.codex/sessions`、WorkBuddy、ZCode rollout、Kimi），单文件解析失败只跳过该文件
- **检索**：并入现有 `recall()` 管线（词法 + 语义臂 + L0/expand + 来源标注），`scope='sessions'` 变成"插件原生"：**有 sessionQuery 就用它做补充，没有/失败就用自建索引**，永不把上游错误原文抛给模型
- **零依赖可用性**：不装 130MB 引擎也能跑（词法 + `_jsSemanticRank`）；装了 python/BGE 档则自动升级召回
- **容错纪律（直接照抄上游的教训）**：逐文件 try/catch + 跳过 + 计数上报；**任何单点失败不得让整条检索失败**
- **成本控制**：增量索引（mtime+size 指纹）、头帧解码上限、条数/字节预算、按龄裁剪、静态节流（不在热路径上建索引）
- **隐私**：索引只落本机 `~/.dsh/memory/`；新增开关（默认开但可关 + 工作区排除名单）；不索引 `reasoning` 原文（沿用现有 `reasoningObserverEnabled` 的既有边界）

**代价**：这是"下一版的主要工作量"（我估 P0 约 1 个版本、P1 再 1 个版本）；要新增索引存储与迁移；要维护各工具格式适配器。

### 路径 B（最省事）：只改进"提示与降级"，能力仍依赖 DSH
- 插件检测 sessionQuery 是否可用：不可用就**不再在 guidance 里推荐 `scope='sessions'`**，改推荐 `scope='handoff'`；可用但失败就给可操作的诊断（而不是原样回上游错误）
- 顺手：把 `discover()` 抓到的外部 `content` 并入 `recall(scope='all')` 语料（这一小块很便宜，能立刻兑现"外部记忆可检索"的一半承诺）
- **代价**：跨会话检索对绝大多数用户仍然没有；跨 Agent 的**会话**仍不可检索

### 路径 C（折中·分两步）：先自建 DSH 会话索引（P0），再纳外部 Agent（P1）
= 路径 A 的分期版，先只解决"插件自己承诺的那一条"（DSH 历史会话），验证容错与成本模型；外部 Agent 会话/文档作 P1。
**代价**：与 A 相同，只是风险前移、可早一版上线。

## 5. 拍板点（请逐条给结论）

1. **主路径**：A / B / C 选哪个？（我建议 **C**：先把插件自己承诺的能力做实，再扩到外部 Agent）
2. **范围**：外部 Agent 要覆盖到哪些？Claude Code / Codex / WorkBuddy / ZCode / Kimi / TRAE-Cursor 规则——**全要**还是先挑常用的两三个？
3. **零依赖底线**：是否接受"不装 130MB 引擎时用词法+JS 语义臂（召回弱一些但 0 下载）"作为默认？
4. **隐私边界**：会话索引默认**开**（可关 + 工作区排除名单）还是默认**关**（向导里一键开）？
5. **上游报告**：要不要我把本次这个具体案例（v0 + descriptor v2 + fail-closed）整理成一份 issue/discussion 稿（可并入已有的 #5732 系列）？
6. **落地节奏**：P0 现在开工，还是等大排期（界面/文档）先定？

## 6. 与既有待办的关系

- 本条**并入** `TODO-BACKLOG.md` §C（冷启动闭环）与 §A 末条（procedure 记忆机制整体重构）的同一类问题：**能力与承诺不一致**。若拍板走 C，我会在 §B 新增一节"跨会话/跨 Agent 检索"并排在下一版。
- DSH 侧那个上游缺陷**不阻塞**本路径：插件自建索引不依赖它；它只影响"DSH 侧边栏搜索"这一项，按 §5.5 单独上报即可。
