# dsh-auto-memory — DSH 自动记忆插件

DSH Web GUI 的记忆插件：三层记忆（用户级 / 项目笔记 / 每日日志）自动注入与检索、每日反思、可视化面板与设置页，支持继承其他 AI 工具的历史记忆。

## ✨ 功能

| 层 | 位置 | 说明 |
|---|---|---|
| 用户级记忆 | `~/.dsh/memory/MEMORY.md` | 跨项目规则/偏好（用户明确要求时写） |
| 项目笔记 | `{工作区}/.dsh-memory/MEMORY.md` | 项目长期约定、决策、架构要点 |
| 每日日志 | `{工作区}/.dsh-memory/YYYY-MM-DD.md` | append-only 工作日志 |
| 反思 | `{工作区}/.dsh-memory/reflections/YYYY-MM-DD.md` | 每日反思（自动提示生成） |

- **自动注入**：每次组装系统提示词时注入 `<memory_system>` 块（用户规则 + 项目笔记 + 最近反思 + 最近 N 天日志尾部 + 写入纪律）
- **每日反思**：检测到"昨天有日志但未生成反思"时，会话首轮自动请求 agent 生成昨日反思
- **Agent 工具**：`memory_log` / `memory_note` / `memory_user` / `memory_recall` / `memory_external` / `memory_maintain` / `memory_status` / `memory_reflect`
- **GUI**：侧边栏「记忆」入口 → 浮层面板（概览/日志/笔记/反思/接续/检索）；设置页（设置 → 自动记忆）
- **外部记忆继承**：接入其他 AI 工具（CodeBuddy / Claude Code / Codex / 项目约定文件）积累的记忆

## 🚀 安装（NPM 一键）

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

## 🤖 AI 时代安装（把这句话直接丢给 AI）

> 现在是 AI 时代，你可以直接把下面这句话复制给你的 AI 助手（DeepSeek / Claude / Codex 等），它会帮你完成安装：

```
请在 DeepSeek Harness 的 web profile 目录 ~/.dsh/profiles/web 下安装 npm 包
@a9i5k4/dsh-auto-memory（执行 pnpm add @a9i5k4/dsh-auto-memory 或 npm install），
然后在 package.json 的 dsh.profile.bundles 数组追加 "@a9i5k4/dsh-auto-memory"，
最后重启 dsh web 使插件生效。
```

## ⚙️ 配置

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

可在 GUI（设置 → 自动记忆）中调整。

## 📁 结构

- `lib/index.js` — Host 半：引擎、注入、工具、路由（零运行时依赖，仅 node 内置模块）
- `lib/client.js` — 浏览器半：记忆面板 + 设置页
- `cordis.patch.yml` — 插件行（`auto-memory`）

## ⚠️ 限制

- 记忆文件为明文 Markdown；不存密钥，除非用户明确要求。
- `memory_recall` 的历史会话检索依赖部署的 session-query 索引，未启用时仅本地检索。
- 插件集变更需重启 dsh 生效。

## 📦 发布信息

- GitHub: https://github.com/Aik358/dsh-auto-memory
- npm: `@a9i5k4/dsh-auto-memory`
- License: BSD-3-Clause
