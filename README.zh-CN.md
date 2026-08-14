# dsh-auto-memory — DSH 自动记忆插件

DSH Web GUI 的记忆插件：三层记忆（用户级 / 项目笔记 / 每日日志）自动注入与检索、每日反思、智能时段问候、日历视图与设置页，支持继承其他 AI 工具的历史记忆。

[English](README.md) | [中文版](README.zh-CN.md)

---

## 功能

### 三层记忆

| 层 | 位置 | 说明 |
|---|---|---|
| 用户级记忆 | `~/.dsh/memory/MEMORY.md` | 跨项目规则/偏好（用户明确要求时写） |
| 项目笔记 | `{工作区}/.dsh-memory/MEMORY.md` | 项目长期约定、决策、架构要点 |
| 每日日志 | `{工作区}/.dsh-memory/YYYY-MM-DD.md` | append-only 工作日志 |
| 反思 | `{工作区}/.dsh-memory/reflections/YYYY-MM-DD.md` | 每日反思（后台结构化积累） |

- **自动注入**：每次组装系统提示词时注入 `<memory_system>` 块（用户规则 + 项目笔记 + 最近反思 + 最近 N 天日志尾部 + 未完成日历事项 + 写入纪律）
- **记忆操作可见**：更新/检索记忆时，AI 会在对话正文中明文说明（如"已把 X 记入今日日志""我查了记忆,发现…"），不藏在工具调用里

### 智能时段问候（概览页）

打开记忆面板第一眼看到的是生活化的时段问候，而不是严肃的技术信息：

- **一天多次**：早晨显示"昨天摘要 + 今天早晨"、上午显示上午的工作、中午/下午/晚上依次类推
- **智能时机**：离开超过 1 小时（下班/暂离）再打开，自动显示"欢迎回来"并列出期间的完成事项
- **抽屉式展开**：外层保持生活化问候风格；每个时段做成抽屉，点开才显示专业的工作明细
- **每日反思**：后台保留结构化反思（成果/教训/要点），前台只有轻松问候

### 日历视图（四象限）

新增「日历」页签（液态玻璃风格月视图）：

- 月视图网格，今日高亮，点击任意日期添加事项
- **四象限色标**：重要紧急（红）/ 重要不紧急（蓝）/ 紧急不重要（橙）/ 不重要不紧急（灰）
- 点条目切换完成状态，再点删除；图例 + 星期头
- **跨对话持久**：数据存用户级 `~/.dsh/memory/CALENDAR.md`，所有工作区共享，重装 DSH 不丢
- **AI 主动维护**：AI 会从对话中提取 deadline、约定时间等自动写入日历（`calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`），并在正文转述；未完成事项注入每次会话的系统提示词

### Agent 工具

`memory_log` / `memory_note` / `memory_user` / `memory_recall` / `memory_external` / `memory_maintain` / `memory_status` / `memory_reflect` / `calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`

### 界面

- 侧边栏「记忆」入口 → 浮层面板（概览/日志/笔记/反思/接续/日历/检索）
- 设置页（设置 → 自动记忆）：存储位置、注入预算、反思风格、**界面语言（中文 / English）**
- **外部记忆继承**：接入其他 AI 工具（CodeBuddy / Claude Code / Codex / 项目约定文件）积累的记忆

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

## 配置

默认值（JSON 文件 `~/.dsh/dsh-auto-memory.json`）：

```json
{
  "userMemoryDir": "~/.dsh/memory",
  "projectMemoryDir": ".dsh-memory",
  "injectEnabled": true,
  "injectBudgetChars": 2400,
  "recentDaysInjected": 3,
  "reflectEnabled": true,
  "reflectStyle": "auto",
  "locale": "zh"
}
```

可在 GUI（设置 → 自动记忆）中调整，包括界面语言（zh / en）。

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
