# dsh-auto-memory — DSH 自动记忆与人性化交互插件

<p align="center">
  <img width="820" alt="dsh-auto-memory 宣传图" src="docs/banner.jpg">
</p>

DSH Web GUI 的记忆插件：三层记忆（用户级 / 项目笔记 / 每日日志）自动注入与检索、每日反思、AI 时段问候与三级抽屉、每轮自动沉淀、智能检索、日历视图与设置页，支持继承其他 AI 工具的历史记忆。

> **快速安装**：`cd ~/.dsh/profiles/web` → `pnpm add @a9i5k4/dsh-auto-memory` → 在该目录 `package.json` 的 `dsh.profile.bundles` 里追加 `"@a9i5k4/dsh-auto-memory"` → 重启 **dsh web**（侧边栏出现「记忆」入口）。完整步骤见 [安装](#安装npm-一键)；没有 pnpm 可用 `npm install @a9i5k4/dsh-auto-memory`。

[English](README.md) | [中文版](README.zh-CN.md)

---

## 安装（NPM 一键）

> 前提：已安装 DeepSeek Harness（dsh）并至少启动过一次 `dsh web`。

在 **profile 目录**（`~/.dsh/profiles/web`）下执行：

```bash
cd ~/.dsh/profiles/web
pnpm add @a9i5k4/dsh-auto-memory
```

然后编辑该目录下的 `package.json`，在 `dsh.profile.bundles` 数组里追加：

```json
"@a9i5k4/dsh-auto-memory"
```

保存后**重启 dsh web**，插件即生效（侧边栏出现「记忆」入口）。

> 没有 pnpm？用 npm 也行：`npm install @a9i5k4/dsh-auto-memory`

## 更新（检查与升级）

插件就是普通的 npm 包，更新同样是在 profile 目录里一条命令：

```bash
cd ~/.dsh/profiles/web
pnpm up @a9i5k4/dsh-auto-memory   # 或: npm install @a9i5k4/dsh-auto-memory@latest
```

然后**重启 dsh web** 生效。

设置 → 自动记忆 页面有「检查更新」按钮，会拿你当前安装的版本和 npm registry 上的最新版对比（有新版时直接显示更新命令）。

---

## AI 时代安装（把这句话直接丢给 AI）

> 现在是 AI 时代，你可以直接把下面这句话复制给你的 AI 助手（DeepSeek / Claude / Codex 等），它会帮你完成安装：

```text
请在 DeepSeek Harness 的 web profile 目录 ~/.dsh/profiles/web 下安装 npm 包
@a9i5k4/dsh-auto-memory（执行 pnpm add @a9i5k4/dsh-auto-memory 或 npm install），
然后在 package.json 的 dsh.profile.bundles 数组追加 "@a9i5k4/dsh-auto-memory"，
最后重启 dsh web 使插件生效。
```

---

## 功能

### 三层记忆

| 层 | 位置 | 说明 |
|---|---|---|
| 用户级记忆 | `~/.dsh/memory/MEMORY.md` | 跨项目规则/偏好（用户明确要求时写） |
| 项目笔记 | `~/.dsh/memory/workspaces/{工作区}/MEMORY.md` | 项目长期约定、决策、架构要点（集中式） |
| 每日日志 | `~/.dsh/memory/workspaces/{工作区}/YYYY-MM-DD.md` | append-only 工作日志（集中式） |
| 反思 | `~/.dsh/memory/workspaces/{工作区}/reflections/YYYY-MM-DD.md` | 每日反思（后台结构化积累） |

> **集中式存储（WorkBuddy 式）**：所有工作区的记忆统一存放在一个根目录 `~/.dsh/memory/workspaces/` 下，每工作区一个子目录——任何模型、任何会话都能通过注入 + 跨工作区 `memory_recall` 读取。旧版分散在各工作区 `.dsh-memory/` 的记忆会在升级后首次运行时自动迁移（旧副本保留不删）。

- **自动注入（放在系统提示词末尾）**：每次组装系统提示词时注入 `<memory_system>` 块（用户规则 + 项目笔记 + 反思精华 + 最近 1 天日志尾部 + 外部记忆路径 + 未完成日历事项 + 写入纪律），并置于提示词**最末尾**——模型在回复前最后读到记忆纪律，遵循度更高
- **注入精简、细节按需（v0.1.24）**：注入保持轻量——只含最近 1 天日志、反思「成果回顾」精华、外部记忆绝对路径（不再整段注入）；需要完整日志/反思/记忆文件时用 `memory_read` 工具按需读取；**敏感段落（凭据/令牌/密钥）从注入中过滤**（文件保留，不进 prompt）
- **记忆操作可见**：更新/检索记忆时，AI 会在对话正文中明文说明（如"已把 X 记入今日日志""我查了记忆,发现…"），不藏在工具调用里

### 每轮自动沉淀 — 记忆自己写自己（v0.1.9）

每轮对话结束时自动评估本轮内容（经小型 subagent 判断+提炼），值得记的自动写入，无需你手动调 memory_log，也不依赖模型记得写：

- **今日日志**自动追加 `- 21:03 [自动沉淀] …` 条目
- **长期价值自动升格**：项目决策/架构 → 项目笔记（带 `## YYYY-MM-DD` 日期标题）；跨项目规则 → 用户级记忆
- **寒暄轮自动跳过**（内容门槛 `autoConsolidateMinChars`）；按 turn 去重，每轮只写一次；子代理轮次不参与
- **GUI 有 Agent 参与痕迹**：概览页显示"今日已自动沉淀 N 条要点（最近 HH:MM）"；面板打开即刷新、打开期间每 30 秒自动重拉、⟳ 按钮手动刷新
- **`memory_consolidate` 工具**：AI 读最近日志发散提炼，把有长期价值的决策/架构/用户偏好固化进 MEMORY.md（"做梦式"固化）
- 可在 `~/.dsh/dsh-auto-memory.json` 配置：`autoConsolidate`（默认开）、`autoConsolidateMinChars`（默认 240）、`autoConsolidateCooldownMinutes`（默认 30，22:00-08:00 自动翻倍）、`autoConsolidateDailyMax`（默认 8）——全部可在设置页「自动化」分组调整

### AI 时段问候与三级抽屉（概览页，v0.1.9）

打开记忆面板第一眼看到的是 **AI 生成**的生活化问候，不是模板、不是严肃的技术信息：

- **AI 写问候**：subagent 按当前时段（早上/上午/中午/下午/晚上）写一句温暖随口的问候，自然提起今天最重要的 1-2 件工作；每天每时段生成一次并缓存到 `.dsh-memory/greetings/`，不重复消耗 API
- **抽屉标题就是 AI 总结**："今日下午 / 今日晚上" 的大窗口标题替换为 AI 总结的原文（如"下午这段你干得真不少呢,最能看到成果的就是 dsh-auto-memory 这一条线…"）
- **三级抽屉结构**：
  - 第一层：时段抽屉，标题即 AI 总结
  - 第二层：拉开后是若干小抽屉——AI 归纳的每项工作（带细点数）
  - 第三层：展开某项工作，阅读其细点
- **总结有缓存**：结构化结果存 `.dsh-memory/summaries/`；打开面板读缓存（离线可看、不重复生成）；⟳ 刷新键或暂离超 1 小时回来才强制重新生成；每份总结显示生成时间
- **智能时机**：离开超过 1 小时（下班/暂离）再打开，自动显示"欢迎回来"并列出期间的完成事项
- **每日反思**：后台保留结构化反思（成果/教训/要点），前台只有轻松问候

### 智能检索（检索页，v0.1.9）

检索页在「检索」旁新增「**智能检索**」按钮：

- AI 把你的自然语言查询扩散成 3-6 个关键词（如"上次发布 npm 踩的坑" → 发布 / 踩坑 / GitHub / npm / 推送）
- 用这些关键词扫描三层记忆 + 反思
- AI 再**综合成一段自然语言回答**，注明每条信息来自哪份记忆（日志日期/项目笔记/用户级），**绝不编造记忆里没有的事实**
- 回答下方列出关键词与原始命中明细（来源 + 原文）

### 日历视图（四象限）

「日历」页签（液态玻璃风格月视图）：

- 月视图网格，今日高亮，点击任意日期添加事项
- **四象限色标**：重要紧急（红）/ 重要不紧急（蓝）/ 紧急不重要（橙）/ 不重要不紧急（灰）
- 点条目切换完成状态，再点删除；图例 + 星期头
- **跨对话持久**：数据存用户级 `~/.dsh/memory/CALENDAR.md`，所有工作区共享，重装 DSH 不丢
- **AI 主动维护**：AI 会从对话中提取 deadline、约定时间等自动写入日历（`calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`），并在正文转述；未完成事项注入每次会话的系统提示词

### Agent 工具

`memory_log` / `memory_note` / `memory_user` / `memory_recall` / `memory_external` / `memory_maintain` / `memory_status` / `memory_reflect` / `memory_consolidate` / `calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`

### 界面

- 侧边栏「记忆」入口 → 浮层面板（概览/日志/笔记/反思/接续/日历/检索）
- 设置页（设置 → 自动记忆）：存储位置、注入预算、反思风格、界面语言（中文 / English）、**界面字号（小/标准/大/特大，默认大）**——切换立即生效，无需保存
- **外部记忆继承**：接入其他 AI 工具（CodeBuddy / Claude Code / Codex / 项目约定文件）积累的记忆

---

## 界面截图

以下都是插件在 DSH Web GUI 中的真实运行截图（当前为中文界面；英文界面截图稍后补充）。

### 记忆面板概览 — 暂离问候、AI 总结等

<img width="480" alt="记忆面板概览" src="docs/screenshots/overview-zh.png">

### 接续 — 从其他 AI Agent 提取全局记忆与历史会话

<img width="480" alt="接续页签" src="docs/screenshots/connect-zh.png">

### 日历 — AI 根据上下文自动添加事项、切换状态、标记完成

<img width="480" alt="日历页签" src="docs/screenshots/calendar-zh.png">

### 工作区导图 — 自动生成的以工作区为中心的跨工作区记忆导图

<img width="480" alt="工作区记忆导图" src="docs/screenshots/workspace-map-zh.png">

### 设置 — 高度自定义，可操作绝大部分技术细节

<img width="480" alt="自动记忆设置" src="docs/screenshots/settings-zh.png">
<img width="480" alt="自动记忆设置(续)" src="docs/screenshots/settings-2-zh.png">

## 截图之外

- **每轮自动沉淀**：每轮对话结束由小代理自动评估，按主题分组写进今日日志（`## 主题（HH:MM）` + 要点列表）——常规工作不需要手动 memory_log。有长期价值的内容自动升格项目笔记 / 用户级记忆；寒暄轮跳过；AI 失败入队，每 5 分钟重试（15 秒心跳文件证明轮询存活）。
- **智能检索**：自然语言提问，AI 扩成关键词扫描全部记忆层，再综合成带出处的自然语言回答。
- **日历与当天时间轴（v0.1.24）**：点击日期打开 07:00-22:00 时间轴，事件按时间槽落位；支持地点/提醒/补充说明；AI 主动提取 deadline 用 `calendar_add` 写入、`calendar_done`/`calendar_remove` 维护。
- **工作区思维导图（v0.1.24）**：AI 生成工作区/主题/跨工作区关联图，支持拖动画布、滑块缩放、点击卡片看摘要。
- **记忆面板 UI（v0.1.24）**：液态玻璃面板 + 全站丝滑动效——模块箭头滚动条、抽屉展开/收起过渡、设置页浮动保存栏（未保存高亮）。
- **外部记忆管理（v0.1.24）**：按来源查看/接入/移除——已接入显示 ✓、按目标（笔记/用户级）独立删除；内容按需读取，不再整段注入。
- **日历提醒**：未完成事项注入之后每次会话的系统提示词——AI 不用你提醒就会主动提及。
- **一键更新**：设置页对比本地版本与 npm registry 最新版；registry 安装的用户可直接「一键更新」（后台自动跑 pnpm/npm），重启后生效。

---

## 配置

默认值（JSON 文件 `~/.dsh/dsh-auto-memory.json`）：

```json
{
  "userMemoryDir": "~/.dsh/memory",
  "projectMemoryDir": ".dsh-memory",
  "injectEnabled": true,
  "injectBudgetChars": 2400,
  "recentDaysInjected": 1,
  "reflectEnabled": true,
  "reflectStyle": "auto",
  "locale": "zh",
  "autoConsolidate": true,
  "autoConsolidateMinChars": 240,
  "autoConsolidateCooldownMinutes": 30,
  "autoConsolidateDailyMax": 8,
  "externalInjectionChars": 1400,
  "memoryRoot": "~/.dsh/memory/workspaces",
  "dayBoundaryMinutes": 450
}
```

可在 GUI（设置 → 自动记忆）中调整，包括界面语言（zh / en）、界面字号与日界。

### v0.1.9 加固（预算 / 日界 / 目录选择器）

- **每日写入预算 + 超限自动压缩**：用户级记忆 ≤4000 字/天、项目笔记 ≤3000 字/天（所有会话共享一天额度，日界重置）。超限不拒绝写入——框架先把「今天之前」的旧内容交给 AI 压缩（合并重复、删除过期、保留硬信息）腾出空间再写；AI 不可用时把最早段落归档到 `archived-user.md` / `archive/notes-archived.md`，信息不丢。压缩 10 分钟节流。
- **日界（凌晨的活儿归昨晚）**：`dayBoundaryMinutes`（默认 450 = 早上 7:30）。日界之前的活儿记入前一天日志，前一天的每日反思也要等过了日界才开始——凌晨不再一过午夜就催「昨天干了什么」。
- **系统原生文件夹选择器**：记忆根目录旁的「浏览…」按钮直接弹系统的文件夹选择器（经 DSH directory-picker 原生后端）；无原生选择器时自动回退内嵌浏览。更换根目录时自动把已有工作区记忆迁移到新位置（旧文件保留），所有路径变量在下一次刷新时跟随新配置。
- **30 天蒸馏**：`memory_maintain` 把 30 天前的旧日志交给 AI 提炼进项目笔记，原文保底归档到 `archive/`，并从活跃日志列表移除。
- **首轮注入保障**：`pre-step` 钩子在第一步放行前等待记忆状态刷新，模型从第一个 token 起就能看到记忆（此前异步加载可能让首轮注入为空）。
- **每步带时间戳的提醒**：注入的纪律块携带实时 `HH:MM:SS` 时间戳，每次组装提示词都刷新；另有 15 秒心跳文件证明后台轮询存活。

---

## 结构

- `lib/index.js` — Host 半：引擎、注入、工具、路由（零运行时依赖，仅 node 内置模块）
- `lib/client.js` — 浏览器半：记忆面板（含日历视图）+ 设置页（内置中英双语）
- `cordis.patch.yml` — 插件行（`auto-memory`）

---

## 限制

- 记忆文件为明文 Markdown；不存密钥，除非用户明确要求。
- `memory_recall` 的历史会话检索依赖部署的 session-query 索引，未启用时仅本地检索。
- 插件集变更需重启 dsh 生效。

---

## 发布信息

- GitHub: https://github.com/Aik358/dsh-auto-memory
- npm: `@a9i5k4/dsh-auto-memory`
- License: BSD-3-Clause
