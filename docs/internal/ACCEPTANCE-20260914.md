# 验收报告 · ZCode 交班对账

> 验收时间：2026-09-14 02:2x–02:5x（本地）｜验收方：DSH 主对话（**只做取证与复核，未改任何产品代码**）
> 验收对象：ZCode 交付的三任务 + 10 项追加需求 + 交班材料（对账单见对话与 `TODO-BACKLOG.md`）
> 口径：**能独立复核的写实测值；不能复核的明确标注"不可独立复核"**，不用转述充证据。

## 一、基线复核（实测）

| 项 | 报告值 | 实测（命令/位置） | 判定 |
| --- | --- | --- | --- |
| npm latest | 2.5.2 | `npm view @a9i5k4/dsh-auto-memory version --registry=https://registry.npmjs.org` → `2.5.2`；`dist-tags.latest=2.5.2` | ✅ |
| GitHub main = tag | `55c3deb` | REL 线 `D:\dsh_debug\_publish_dsh-auto-memory` HEAD = `55c3deb`，tag `v2.5.0/v2.5.1/v2.5.2` 齐 | ✅ |
| REL 工作树 | （未提） | 唯一未跟踪 = `.github/cloud/qq-webhook/index.zip`（发版纪律要求排除构建产物，正常） | ✅ |
| pre 线 HEAD | `747aa68` | **实测 `1c06c46`** —— 多出 4 个提交，全是 `docs/`：官方 discussion #5732 评论稿 3 版 + dshapi 中转反馈稿（**非 ZCode 线，是本机 DSH 会话产出**） | ⚠️ 偏差，已更正 |
| 冒烟套件 | 71 全绿 | 首次全量 **70/71**（`m73` 假红，见三）→ 夹具加固后 **71/71 全绿**，125s | ✅（修复后） |
| 静态检查 | — | `node --check lib/index.js`、`lib/client.js` 均 0；两文件首三字节非 `EF BB BF` | ✅ |

## 二、10 项追加需求逐项取证（全部落到源码/文件，可独立复核）

| # | 需求 | 取证点 | 判定 |
| --- | --- | --- | --- |
| 1 | PR #29 合并移植 | `lib/index.js:47` import `decodeZstdFramesHead`；调用点 `:1626`（巡检扫描）、`:1927`（`waterWindowForSession` 同防） | ✅ |
| 2 | procedure 链路审计 + 缺口记录 | 结论落在 `TODO-BACKLOG.md` §A 末条（数据层从未产出 active procedure、`renderChecklist` 无子代理出口、`memory_recall` 无 procedures scope）——**没有独立审计文件** | ⚠️ 审计在、未单独成文 |
| 3 | 白板整合预研 + 看板化评估 | `WB-GRAPH-RESEARCH-BRIEF.md`(7.7KB) / `-LOCAL.md`(21.2KB) / `-EXTERNAL.md`(33.2KB) / `WB-GRAPH-INTEGRATION-PLAN.md`(39.1KB)，四份齐 | ✅ |
| 4 | 云函数定时自触发 | `.github/cloud/qq-webhook/index.js:366-368` timer 分支；`triggerName=digest_dispatch`；`TIMER_MIN_GAP_HOURS=10` 防重 | ✅ |
| 5 | @ 答疑限额 env 化 | `index.js:47-50` `AI_MAX_PER_HOUR`（0/缺省=不限）/`AI_QUOTA_HOURS`（默认 1h）；配额落 gist | ✅ |
| 6 | 日报去重（prompt + 确定性双层） | `group-digest.mjs:91-93` 30 分钟 schedule 去重；`:400` prompt 规则「不得新增重复条目」；`:417` 解析失败兜底按标题前 8 字去重 | ✅ |
| 7 | 未解决事项跨期跟踪 + 自动销账 | `group-digest.mjs:327-331`（open/resolved/stale，14 天归档）、`:400` `resolved_titles` 规则、`:234` 日报渲染「✅ 已解决并移出」 | ✅ |
| 8 | 反馈文件钉死 | 提交 `9f594db`「反馈文件钉死文件名（修复第一个文件换人/清空即删文件）」，code 侧仍在 | ✅ |
| 9 | 思维链截断修复 | `index.js:232-249` `max_tokens: 1600` + 三层过滤（`reasoning_content` → `</think>` 切段 → 行首思考特征词剥除） | ✅ |
| 10 | mention id 变更失聪修复 | `index.js:308-310` 学习改为**取最新见到的 mention** 为准；`:479` diag 暴露 `mentionLearned` | ✅ |

另：源码 `VERSION = 'webhook-gist-20260913n'`（`index.js:56`）——与"线上 n 版"的自述一致。

## 三、本轮发现并修复的问题（1 项真问题 + 1 条教训）

**① `smoke-test-m73-pre.mjs` 负载敏感假红（真问题，已修）**

- 现象：全量连跑 FAIL；单跑第 1 次也 FAIL，第 2 次绿 → 非确定。失败点在 N8「模型缺失 → enabled/ready」：`h.frame.payload` 为 undefined 抛 `TypeError`。
- 根因：夹具 `requestTimeoutMs: 8000`，连跑时 python worker 冷启动超过窗口 → `health()` 返回**无 frame** 的失败响应（属夹具鲁棒性，不是产品缺陷）。
- 修法：新增 `healthReady(c, attempts=8, gapMs=400)` 有界轮询，**只对"无 frame"重试**；9 处 `c.health()` 全部改走它。断言（`embedding.enabled/ready/error`）一字未改 —— worker 真起不来时轮询耗尽、拿最后一个无 frame 响应、断言照常失败，**不掩蔽真故障**。
- 验证：单跑 3/3 绿（`pass=59 fail=0`）；全量 71/71 绿。

**② 教训（写进本项目纪律）**：`replace_all` 会命中**同一次编辑新加入的代码块** —— 本次把辅助函数内部的 `c.health()` 也替换成了 `healthReady(c)`，造成自递归、3 连红。替换后必须核对命中计数（预期 9 实得 10 即报警）并 `node --check`。

## 四、不可独立复核项（如实标注，不作为验收结论）

- **线上云函数部署版本**：函数 URL 与 `ROUTE_TOKEN` 不在仓库（符合凭据纪律），只能由用户/群内实测确认；本报告只证明**源码 = n 版**。
- **群内实战验证（"没毛病了"）**：外部证据，仓库侧无法复核。
- **两个外部时间点**：今早 11:40 定时触发器首跑、下期日报应把「工作区切换问题」按 v2.5.2 自动销账 —— 时间未到（现 2026-09-14 02:5x），不可验。

## 五、结论

1. **ZCode 三问三答的 ①发版 ②`?report=N` 排查 ③群反馈调研**：仓库侧证据充分，成立；本机 DSH 侧对 71 套件的独立复跑同样通过（修复夹具后）。
2. **10 项追加需求**：9 项源码取证完全成立；第 2 项（procedure 审计）结论存在但未单独成文。
3. **报告偏差 2 处**（均已修正到文档）：
   - `pre` 线 HEAD 不是 `747aa68` 而是 `1c06c46`（+4 个 docs 提交，与本机 DSH 会话的 harness bug 上报有关）。
   - 白板 `PLAN.md` 当时写着"下一版深改三点仍未动"，**与事实相反**（水位口径 / 接续序号 / 流程外包三项已于 v2.5.0 落地并发布）——白板已重写。
4. **真正剩余的待办**只分三类：①**阻塞在用户的决策**（大排期 6 拍板点 + 3 样输入；procedure 机制整体重构）②**待外部时间点**（定时班首跑、下期日报销账）③**可排期的存量项**（`TODO-BACKLOG` §C 冷启动 5 项 / §D 分发门面 / §E 文档体系 —— 已复核仍成立，但非当前焦点）。

---

### 附：本机"会话语义检索"不可用的根因与处置（2026-09-14 追查，已实施待重启生效）

**现象**：`memory_recall(scope='sessions')` 报 `session search is disabled: this deployment configures the session-query index with openAt "never"`。

**根因（逐层取证；不是"没装"，是"从没打开"）**：

1. 抛错点在 `@deepseek-ai/dsh-session-query-sqlite/lib/index.js:594-595`：`openAt === 'never'` 时在任何 SQLite 动作之前直接抛 `SESSION_QUERY_SEARCH_DISABLED`。
2. `never` 是**随包默认**，写在 `@deepseek-ai/dsh-base/cordis.patch.yml:121-133`（该行注释原文：「Full-text session search is **opt-in**. `openAt: never` …」），配置为 `path: ':memory:'` + `openAt: never`。
3. 同一段注释**给出了开启方式**：「Deployments enabling content search override `openAt` to `first-search` or `startup` in a later patch layer (**profile cordis.patch.yml** or a `--patch` overlay), typically with a durable `path`。」
4. 本机用户层 `~/.dsh/profiles/web/cordis.patch.yml`（最后应用）原只有 3 条 `disabled: true`，**从未覆盖过这一行** → 检索一直是关的。**更正**：先前报告写「值来自 launcher 默认、属 DSH 侧改动」不准确 —— 值是 dsh-base bundle 的随包默认，而覆盖层正是**用户可改**的 profile patch。
5. 插件侧无额外开关：`lib/index.js:1804-1807` 直接调 `sq.searchSessions(...)`，没有自己的门闸 —— 唯一阻塞就是上面这一行。

**处置（已落盘）**：在 `~/.dsh/profiles/web/cordis.patch.yml` 追加 id 定向覆盖（原件已备份为同目录 `cordis.patch.yml.bak-20260914-search`）：

```yaml
- id: session-query-sqlite
  config:
    path: 'C:/Users/JH Z/.dsh/profiles/web/session-query.db'
    openAt: first-search
```

关键约束：patch 对目标行是**整块 `config` 替换而非合并** → `path` 必须一并重述（`path` 是 `z.string().required()`，省略即配置非法）；`path` 取 **profile 私有**路径，避免与其它 profile/进程争用同一索引文件（该索引每路径单进程持有）。

**校验证据（不启动宿主，`dsh --profile web --dump-config`）**：退出码 0；合成结果该行 `name` 仍由 base 层给出、仅 `config` 被替换；全树 `openAt` **只出现 1 次** = `first-search`；`- id: session-query-sqlite` 恰 1 条（无重复行）；后端为 **`node:sqlite`（Node v24.18.0 内置，`require('node:sqlite')` 实测可用，不需原生模块）**；目标目录尚无 db 文件（首次检索时创建，属预期）；文件首 3 字节非 `EF BB BF`。

**生效条件**：宿主只在启动时读该文件 → **需用户自行重启 dsh web**；重启后首次检索即建索引（`first-search`）。副作用：Web 侧边栏搜索从"只匹配标题/工作区名"升级为内容检索。

**与它无关但一直可用**：插件的跨工作区记忆检索（日志/笔记/反思）与 `handoff/` 分层转写材料 —— 本次验收全程用的是后者。
