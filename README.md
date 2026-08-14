# dsh-auto-memory — DSH Auto Memory Plugin / DSH 自动记忆插件

An auto-memory plugin for the DeepSeek Harness Web GUI: three-layer memory (user-level / project notes / daily logs) with automatic injection and retrieval, daily reflections, AI period greetings with three-level drawers, auto-consolidation after every turn, smart search, a calendar view and settings page, and inheritance of memories from other AI tools.

DSH Web GUI 的记忆插件：三层记忆自动注入与检索、每日反思、AI 时段问候与三级抽屉、每轮自动沉淀、智能检索、日历视图与设置页，支持继承其他 AI 工具的历史记忆。

[**English**](README.md) | [中文版](README.zh-CN.md)

---

## Features

### Three-layer Memory

| Layer | Location | Description |
|---|---|---|
| User-level memory | `~/.dsh/memory/MEMORY.md` | Cross-project rules & preferences |
| Project notes | `~/.dsh/memory/workspaces/{workspace}/MEMORY.md` | Project conventions & decisions (centralized) |
| Daily logs | `~/.dsh/memory/workspaces/{workspace}/YYYY-MM-DD.md` | Append-only work log (centralized) |
| Reflections | `~/.dsh/memory/workspaces/{workspace}/reflections/YYYY-MM-DD.md` | Daily reflection (structured, kept in background) |

> **Centralized storage (WorkBuddy-style)**: all workspace memories live under one root — `~/.dsh/memory/workspaces/`, one subdirectory per workspace (readable by any model in any session via injection + cross-workspace `memory_recall`). Legacy per-workspace `.dsh-memory/` folders are auto-migrated on first run after upgrade (the old copies are kept, not deleted).

- **Auto injection (at the end of the system prompt)**: every prompt gets a `<memory_system>` block (user rules + project notes + recent reflections + recent N days of log tails + pending calendar items + writing discipline); it is placed at the very end of the system prompt so the model reads the memory discipline right before replying
- **Visible memory ops**: when the AI updates or searches memory, it says so in plain text in the chat reply (e.g. "Logged X to today's journal", "I checked memory and found..."), not hidden inside tool calls

### Auto-Consolidation — memory writes itself after every turn (v0.1.9)

Every finished conversation turn is automatically evaluated (via a small subagent) and anything worth keeping is written for you — no reliance on the model remembering to log:

- **Today's log** gets entries like `- 21:03 [自动沉淀] …` — no manual `memory_log` needed for routine work
- **Long-term value is promoted**: project decisions/architecture → project notes (with a `## YYYY-MM-DD` heading); cross-project rules → user-level memory
- **Small talk is skipped** (content threshold `autoConsolidateMinChars`), each turn is deduplicated by turn number, subagent turns are ignored
- **Agent traces in the GUI**: the overview shows "Auto-consolidated N points today (latest HH:MM)"; the panel refreshes on open, every 30s while open, and via the ⟳ button
- **`memory_consolidate` tool**: read recent logs and distill long-term decisions / architecture / user preferences into MEMORY.md on demand ("dream-like" consolidation)
- Configurable in `~/.dsh/dsh-auto-memory.json`: `autoConsolidate` (default true), `autoConsolidateMinChars` (default 60)

### AI Greetings & Three-level Drawers (Overview page, v0.1.9)

The first thing you see when opening the memory panel is an **AI-generated** period greeting, not a template and not technical info:

- **AI-written greeting**: a subagent writes a warm, casual greeting for the current period (morning / forenoon / noon / afternoon / evening), mentioning your most important work of the day; generated once per period per day and cached in `.dsh-memory/greetings/` — no repeated API cost
- **Drawer titles are the AI summaries**: the "Today afternoon / Today evening" window titles are replaced with the AI's casual summary text itself
- **Three-level drawer structure**:
  - Level 1: period drawer, titled with the AI summary
  - Level 2: inside it, small drawers — one per work item the AI distilled (with a point count)
  - Level 3: expand a work item to read its detail points
- **Summaries are cached**: structured results live in `.dsh-memory/summaries/`; opening the panel reads the cache (offline-friendly, no regeneration); the ⟳ refresh button or returning after >1h away forces a fresh generation; every summary shows its generation time
- **Smart timing**: if you were away for more than 1 hour and come back, the greeting says "Welcome back" with what was finished meanwhile
- **Daily reflection stays in background**: structured reflections (results / lessons / next steps) are kept, while the front page only shows a light greeting

### Smart Search (Search tab, v0.1.9)

The Search tab adds a **Smart search** button next to the keyword search:

- The AI expands your natural-language query into 3-6 keywords (e.g. "last time publishing npm hit a snag" → 发布 / 踩坑 / GitHub / npm / 推送)
- Scans all three memory layers plus reflections with those keywords
- The AI then composes a **conversational answer** in natural language, citing where each fact came from (log date / project note / user-level memory) — it never fabricates facts not present in memory
- Raw keyword hits with their sources are listed under the answer

### Calendar View (Four Quadrants)

「Calendar」tab (liquid-glass monthly view):

- Monthly grid, today highlighted, click any date to add an item
- **Four-quadrant colors**: Urgent & Important (red) / Important (blue) / Urgent (orange) / Neither (gray)
- Click an item to toggle done, click again to delete; legend + weekday header
- **Cross-conversation persistence**: data lives at user level `~/.dsh/memory/CALENDAR.md`, shared across workspaces, survives DSH reinstall
- **AI-maintained**: the AI extracts deadlines and appointments from conversations and writes them to the calendar automatically (`calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`), restating it in plain text; pending items are injected into every session's system prompt

### Agent Tools

`memory_log` / `memory_note` / `memory_user` / `memory_recall` / `memory_external` / `memory_maintain` / `memory_status` / `memory_reflect` / `memory_consolidate` / `calendar_add` / `calendar_list` / `calendar_done` / `calendar_remove`

### UI

- Sidebar 「Memory」entry → floating panel (Overview / Logs / Notes / Reflections / Connect / Calendar / Search)
- Settings page (Settings → Auto Memory): storage paths, injection budget, reflection style, UI language (中文 / English), **panel font size (Small / Normal / Large / Extra large, default Large)** — applies immediately, no save needed
- **External memory inheritance**: import memories accumulated by other AI tools (CodeBuddy / Claude Code / Codex / project convention files)

---

## Demos

### 1. Auto-consolidation in action

You finish a conversation turn — no memory commands needed. The moment the turn ends, the plugin writes a topic-grouped entry into today's log:

```
── Chat ──────────────────────────────────────────────────

  You: 我把抽屉的 bug 修好了,顺便加了字号功能,设置页可以调,默认大号。

  AI: 已把 X 记入今日日志。 (回复末尾加粗转述,记忆操作对用户可见)

── Turn ends → auto-consolidation writes to .dsh-memory/2026-08-14.md ──

## 修复抽屉bug与字号功能（22:30）
- 修复了抽屉 bug
- 新增界面字号功能(设置页,默认大号)
```

Long-term decisions are promoted to project notes with a `## YYYY-MM-DD` heading automatically. If the AI call fails, the entry is queued and retried by the 5-minute polling loop.

### 2. AI greeting & three-level drawers

Click the 「Memory」 button — the floating panel opens with an AI-written greeting, cross-workspace summaries, and drawers titled by the AI summaries themselves:

```
┌──────────────────────────────────────────────────────┐
│ 自动记忆                          ⤾   ⟳   ✕         │
├──────────────────────────────────────────────────────┤
│ 概览 │ 日志 │ 笔记 │ 反思 │ 接续 │ 日历 │ 检索 │ 工作区 │
├──────────────────────────────────────────────────────┤
│ 晚上好 · 晚上                                         │
│                                                      │
│ 晚上好,这一晚上你收获满满呀。把 Ark9Tools 扩展框架整个   │
│ 捋了一遍,冒烟测试 18 项全过,还一口气把 dsh-auto-memory  │
│ 推到 0.1.9…                                          │
│                                                      │
│ ┌ 工作区总结(跨工作区) ────────────────────────────┐  │
│ │ dsh_debug · 8-10 ~ 8-14                        │  │
│ │ 主要在做 dsh-auto-memory 插件,逐步发布 v0.1.x…  │  │
│ │ · 8-14: v0.1.9 系列功能落地                    │  │
│ │ · 8-13: 中文乱码与 no-branches 修复             │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ▼ 下午把 dsh-auto-memory 完整发布出去了…               │
│ 今日下午 · 10 条日志 · 生成于 21:28                    │
│    ▸ 发布与收尾 (3 项)                                │
│    ▸ 修复发布过程中的坑 (2 项)                         │
│                                                      │
│ ▼ 晚上搭建了扩展框架…                                 │
│ 今日晚上 · 7 条日志 · 生成于 21:28                     │
│    ▸ EventBus 与服务容器 (4 项)                       │
└──────────────────────────────────────────────────────┘
```

Tap any small drawer (▸) to read its detail points. Greetings and summaries are cached per period — reopening the panel costs no API calls; the ⟳ button forces fresh generation.

### 3. Smart search

Type a natural-language question in the Search tab and hit 「智能检索」:

```
┌──────────────────────────────────────────────────────┐
│ 检索: [上次发布 npm 包踩了什么坑       ] [检索] [智能检索]│
├──────────────────────────────────────────────────────┤
│ ┌ 智能回答 ───────────────────────────────────────┐  │
│ │ 上次发布踩了三个坑:GitHub 中文 description 乱码  │  │
│ │ (PowerShell GBK,改用 Node fetch);第一次 push    │  │
│ │ 实际没成功(凭据管理器拦截,需 -c credential.helper=);│ │
│ │ npm 2FA 需要 Automation 令牌。以上来自           │  │
│ │ 2026-08-14 日志。                               │  │
│ └────────────────────────────────────────────────┘  │
│ 关键词: 发布 / 踩坑 / GitHub / npm / 推送             │
│ · [2026-08-14.md] 发布完成:①GitHub 仓库已建…         │
│ · [reflections/2026-08-14.md] 成果回顾:…             │
└──────────────────────────────────────────────────────┘
```

The AI expands your query into 3-6 keywords, scans all memory layers, then composes a conversational answer citing its sources — never fabricating facts.

### 4. AI-maintained calendar

Mention a deadline in chat — the AI writes it into the calendar and says so in plain text:

```
── Chat ──────────────────────────────────────────────────

  You: 周五 10 点要交周报,别忘了。

  AI: 已把『2026-08-15 10:00 交周报』记入日历(重要不紧急)。

── Calendar tab · 2026 年 8 月 ──────────────────────────

         一   二   三   四   五   六   日
                     11   12   13   14  [15]
                                      ● 交周报
```

Pending items are injected into every future session's system prompt until completed — the AI reminds you without being asked.

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

## Updating (check & upgrade)

The plugin is a normal npm package, so updating is one command in the same profile directory:

```bash
cd ~/.dsh/profiles/web
pnpm up @a9i5k4/dsh-auto-memory   # or: npm install @a9i5k4/dsh-auto-memory@latest
```

Then restart **dsh web**.

The Settings → Auto Memory page has a **Check for updates** button that compares your installed version with the latest one on the npm registry (it shows the update command when a newer version exists).

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
  "locale": "zh",
  "autoConsolidate": true,
  "autoConsolidateMinChars": 60,
  "memoryRoot": "~/.dsh/memory/workspaces",
  "dayBoundaryMinutes": 450
}
```

Adjustable in the GUI (Settings → Auto Memory), including the UI language (zh / en), the panel font size and the day boundary.

### v0.1.9 hardening (budget / boundary / picker)

- **Daily write budget with auto-compaction**: user memory ≤ 4000 chars/day, project notes ≤ 3000 chars/day (shared across sessions, reset at the day boundary). Going over the budget never rejects the write — the framework compacts the pre-today sections with an AI pass (merge duplicates, drop stale entries, keep hard facts) and then writes; if AI is unavailable, the oldest sections are archived to `archived-user.md` / `archive/notes-archived.md` (nothing is lost). Compaction is throttled to once per 10 minutes.
- **Day boundary (late-night belongs to yesterday)**: `dayBoundaryMinutes` (default 450 = 07:30). Work logged before the boundary is appended to the previous day's log, and the daily reflection for the previous day starts only after the boundary — no more "it's 00:30, tell me what you did yesterday" right after midnight.
- **Native OS folder picker**: the "Browse…" button next to the memory root opens the real system folder picker (via the DSH directory-picker native backend); falls back to the in-app browser when no native picker is available. Changing the root auto-migrates existing workspace memory folders to the new location (old files are kept) and all path variables follow the new config on the next refresh.
- **30-day distillation**: `memory_maintain` distills logs older than 30 days with an AI pass into the project notes, archives the originals under `archive/`, and removes them from the active log list.
- **First-turn injection guarantee**: a `pre-step` hook awaits the memory state refresh before the first step, so the model sees memory from the very first token (previously the async load could leave the first turn empty).
- **Per-step reminder with timestamp**: the injected discipline block carries a live `HH:MM:SS` timestamp that refreshes on every prompt assembly, and a 15-second heartbeat file proves the background loop is alive.

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