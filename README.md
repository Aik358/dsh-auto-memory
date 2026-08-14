# dsh-auto-memory — DSH Auto Memory Plugin / DSH 自动记忆插件

An auto-memory plugin for the DeepSeek Harness Web GUI: three-layer memory (user-level / project notes / daily logs) with automatic injection and retrieval, daily reflections, a visual panel and settings page, plus inheritance of memories from other AI tools.

DSH Web GUI 的记忆插件：三层记忆（用户级 / 项目笔记 / 每日日志）自动注入与检索、每日反思、可视化面板与设置页，支持继承其他 AI 工具的历史记忆。

---

## ✨ Features / 功能

| Layer / 层 | Location / 位置 | Description / 说明 |
|---|---|---|
| User-level memory / 用户级记忆 | `~/.dsh/memory/MEMORY.md` | Cross-project rules & preferences / 跨项目规则/偏好 |
| Project notes / 项目笔记 | `{workspace}/.dsh-memory/MEMORY.md` | Project conventions & decisions / 项目长期约定、决策 |
| Daily logs / 每日日志 | `{workspace}/.dsh-memory/YYYY-MM-DD.md` | Append-only work log / 每日工作日志 |
| Reflections / 反思 | `{workspace}/.dsh-memory/reflections/YYYY-MM-DD.md` | Daily reflection, auto-prompted / 每日反思（自动提示生成） |

- **Auto injection / 自动注入**: injects a `<memory_system>` block into every system prompt (user rules + project notes + recent reflections + recent N days of log tails + writing discipline)
- **Daily reflection / 每日反思**: when yesterday has logs but no reflection, the agent is asked to present one at session start
- **Agent tools / Agent 工具**: `memory_log` / `memory_note` / `memory_user` / `memory_recall` / `memory_external` / `memory_maintain` / `memory_status` / `memory_reflect`
- **GUI**: sidebar 「记忆」entry → floating panel (Overview / Logs / Notes / Reflections / Connect / Search); Settings page (Settings → Auto Memory)
- **External memory inheritance / 外部记忆继承**: import memories accumulated by other AI tools (CodeBuddy / Claude Code / Codex / project convention files)

---

## 🚀 Installation (one command) / 安装（NPM 一键）

> Prerequisite: install [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) and start `dsh web` at least once.
> 前提：已安装 DeepSeek Harness（dsh）并至少启动过一次 `dsh web`。

Run in the **profile directory** (`~/.dsh/profiles/web`):
在 **profile 目录**（`~/.dsh/profiles/web`）下执行：

```bash
cd ~/.dsh/profiles/web
pnpm add @a9i5k4/dsh-auto-memory
```

Then edit `package.json` in that directory and append to the `dsh.profile.bundles` array:
然后编辑该目录下的 `package.json`，在 `dsh.profile.bundles` 数组里追加：

```json
"@a9i5k4/dsh-auto-memory"
```

Restart **dsh web** to activate (the 「记忆」entry appears in the sidebar).
保存后**重启 dsh web**，插件即生效（侧边栏出现「记忆」入口）。

> No pnpm? Use npm: `npm install @a9i5k4/dsh-auto-memory`
> 没有 pnpm？用 npm 也行：`npm install @a9i5k4/dsh-auto-memory`

---

## 🤖 AI-Era Installation (copy-paste for your AI) / AI 时代安装（把这句话直接丢给 AI）

> It's the AI era — just copy the sentence below to your AI assistant (DeepSeek / Claude / Codex etc.) and it will do the installation for you.
> 现在是 AI 时代，你可以直接把下面这句话复制给你的 AI 助手（DeepSeek / Claude / Codex 等），它会帮你完成安装：

```text
Install the npm package @a9i5k4/dsh-auto-memory in the DeepSeek Harness web profile
directory ~/.dsh/profiles/web (run "pnpm add @a9i5k4/dsh-auto-memory" or "npm install @a9i5k4/dsh-auto-memory"),
append "@a9i5k4/dsh-auto-memory" to the dsh.profile.bundles array in package.json,
then restart dsh web to activate the plugin.

请在 DeepSeek Harness 的 web profile 目录 ~/.dsh/profiles/web 下安装 npm 包
@a9i5k4/dsh-auto-memory（执行 pnpm add @a9i5k4/dsh-auto-memory 或 npm install），
然后在 package.json 的 dsh.profile.bundles 数组追加 "@a9i5k4/dsh-auto-memory"，
最后重启 dsh web 使插件生效。
```

---

## ⚙️ Configuration / 配置

Defaults (JSON file `~/.dsh/dsh-auto-memory.json`):
默认值（JSON 文件 `~/.dsh/dsh-auto-memory.json`）：

```json
{
  "userMemoryDir": "~/.dsh/memory",
  "projectMemoryDir": ".dsh-memory",
  "injectEnabled": true,
  "injectBudgetChars": 2400,
  "recentDaysInjected": 3,
  "reflectEnabled": true,
  "reflectStyle": "auto"
}
```

Adjustable in the GUI (Settings → Auto Memory). / 可在 GUI（设置 → 自动记忆）中调整。

---

## 📁 Structure / 结构

- `lib/index.js` — Host half: engine, injection, tools, routes (zero runtime deps, Node built-ins only) / Host 半：引擎、注入、工具、路由（零运行时依赖）
- `lib/client.js` — Browser half: memory panel + settings page / 浏览器半：记忆面板 + 设置页
- `cordis.patch.yml` — Plugin row (`auto-memory`)

---

## ⚠️ Limitations / 限制

- Memory files are plain-text Markdown; no secrets stored unless explicitly requested. / 记忆文件为明文 Markdown；不存密钥，除非用户明确要求。
- `memory_recall` session search depends on the deployed session-query index; without it, only local search works. / `memory_recall` 的历史会话检索依赖部署的 session-query 索引，未启用时仅本地检索。
- Plugin-set changes require a dsh restart. / 插件集变更需重启 dsh 生效。

---

## 📦 Release Info / 发布信息

- GitHub: https://github.com/Aik358/dsh-auto-memory
- npm: `@a9i5k4/dsh-auto-memory`
- License: BSD-3-Clause
