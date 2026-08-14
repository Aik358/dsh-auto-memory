# dsh-auto-memory — DSH Auto Memory Plugin / DSH 自动记忆插件

An auto-memory plugin for the DeepSeek Harness Web GUI: three-layer memory (user-level / project notes / daily logs) with automatic injection and retrieval, daily reflections, smart period greetings, a calendar view and settings page, and inheritance of memories from other AI tools.

DSH Web GUI 的记忆插件：三层记忆自动注入与检索、每日反思、智能时段问候、日历视图与设置页，支持继承其他 AI 工具的历史记忆。

[**English**](README.md) | [中文版](README.zh-CN.md)

---

## Features

### Three-layer Memory

| Layer | Location | Description |
|---|---|---|
| User-level memory | `~/.dsh/memory/MEMORY.md` | Cross-project rules & preferences |
| Project notes | `{workspace}/.dsh-memory/MEMORY.md` | Project conventions & decisions |
| Daily logs | `{workspace}/.dsh-memory/YYYY-MM-DD.md` | Append-only work log |
| Reflections | `{workspace}/.dsh-memory/reflections/YYYY-MM-DD.md` | Daily reflection (structured, kept in background) |

- **Auto injection**: injects a `<memory_system>` block into every system prompt (user rules + project notes + recent reflections + recent N days of log tails + pending calendar items + writing discipline)
- **Visible memory ops**: when the AI updates or searches memory, it says so in plain text in the chat reply (e.g. "Logged X to today's journal", "I checked memory and found..."), not hidden inside tool calls

### Smart Period Greetings (Overview page)

The first thing you see when opening the memory panel is a friendly period greeting, not technical info:

- **Multiple times a day**: morning shows "yesterday summary + early morning", forenoon shows the morning's work, noon/afternoon/evening follow suit
- **Smart timing**: if you were away for more than 1 hour (off work / stepped away) and come back, it automatically shows "Welcome back" with what was finished meanwhile
- **Drawer layout**: the outer layer stays casual and greeting-like; each period is a drawer — tap to expand the professional details
- **Daily reflection stays in background**: structured reflections (results / lessons / next steps) are kept, while the front page only shows a light greeting

### Calendar View (Four Quadrants)

New 「Calendar」tab (liquid-glass monthly view):

- Monthly grid, today highlighted, click any date to add an item
- **Four-quadrant colors**: Urgent & Important (red) / Important (blue) / Urgent (orange) / Neither (gray)
- Click an item to toggle done, click again to delete; legend + weekday header
- **Cross-conversation persistence**: data lives at user level `~/.dsh/memory/CALENDAR.md`, shared across workspaces, survives DSH reinstall
- **AI-maintained**: the AI extracts deadlines and appointments from conversations and writes them to the calendar automatically (`calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`), restating it in plain text; pending items are injected into every session's system prompt

### Agent Tools

`memory_log` / `memory_note` / `memory_user` / `memory_recall` / `memory_external` / `memory_maintain` / `memory_status` / `memory_reflect` / `calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`

### UI

- Sidebar 「Memory」entry → floating panel (Overview / Logs / Notes / Reflections / Connect / Calendar / Search)
- Settings page (Settings → Auto Memory): storage paths, injection budget, reflection style, **UI language (中文 / English)**
- **External memory inheritance**: import memories accumulated by other AI tools (CodeBuddy / Claude Code / Codex / project convention files)

---

## Installation (one command)

> Prerequisite: install [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) and start `dsh web` at least once.

Run in the **profile directory** (`~/.dsh/profiles/web`):

```bash
cd ~/.dsh/profiles/web
pnpm add @a9i5k4/dsh-auto-memory
```

Then edit `package.json` in that directory and append to the `dsh.profile.bundles` array:

```json
"@a9i5k4/dsh-auto-memory"
```

Restart **dsh web** to activate (the 「Memory」entry appears in the sidebar).

> No pnpm? Use npm: `npm install @a9i5k4/dsh-auto-memory`

---

## AI-Era Installation (copy-paste for your AI)

> It's the AI era — just copy the sentence below to your AI assistant (DeepSeek / Claude / Codex etc.) and it will do the installation for you.

```text
Install the npm package @a9i5k4/dsh-auto-memory in the DeepSeek Harness web profile
directory ~/.dsh/profiles/web (run "pnpm add @a9i5k4/dsh-auto-memory" or "npm install @a9i5k4/dsh-auto-memory"),
append "@a9i5k4/dsh-auto-memory" to the dsh.profile.bundles array in package.json,
then restart dsh web to activate the plugin.
```

---

## Configuration

Defaults (JSON file `~/.dsh/dsh-auto-memory.json`):

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

Adjustable in the GUI (Settings → Auto Memory), including the UI language (zh / en).

---

## Structure

- `lib/index.js` — Host half: engine, injection, tools, routes (zero runtime deps, Node built-ins only)
- `lib/client.js` — Browser half: memory panel (with calendar view) + settings page (built-in zh/en i18n)
- `cordis.patch.yml` — Plugin row (`auto-memory`)

---

## Limitations

- Memory files are plain-text Markdown; no secrets stored unless explicitly requested.
- `memory_recall` session search depends on the deployed session-query index; without it, only local search works.
- Plugin-set changes require a dsh restart.

---

## Release Info

- GitHub: https://github.com/Aik358/dsh-auto-memory
- npm: `@a9i5k4/dsh-auto-memory`
- License: BSD-3-Clause
