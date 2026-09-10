# dsh-auto-memory User Guide

> She remembers, unbidden: memory never waits for your command — the right memory surfaces on its own; every entry has provenance — checkable, editable, deletable.
> Applies to version **2.2.7+** · Changelog: in-plugin **Settings → Appearance → View changelog**.
> 中文版：[USER-GUIDE.zh-CN.md](./USER-GUIDE.zh-CN.md)

---

## Contents

1. [Install & entry points](#1-install--entry-points)
2. [First launch](#2-first-launch)
3. [The twelve memory-panel tabs](#3-the-twelve-memory-panel-tabs)
4. [Settings, group by group](#4-settings-group-by-group)
   - [4.1 Semantic engine](#41-semantic-engine)
   - [4.2 Memory Hub](#42-memory-hub)
   - [4.3 Appearance](#43-appearance)
   - [4.4 Storage](#44-storage)
   - [4.5 Memory window](#45-memory-window)
   - [4.6 Automation](#46-automation)
   - [4.7 Context management](#47-context-management)
   - [4.8 Maintenance](#48-maintenance)
5. [Retrieval deep dive: what one query actually does](#5-retrieval-deep-dive)
6. [Proactive recall deep dive: how memory surfaces unbidden](#6-proactive-recall-deep-dive)
7. [Evidence chain & memory importance](#7-evidence-chain--memory-importance)
8. [Context management deep dive](#8-context-management-deep-dive)
9. [Memory Hub deep dive](#9-memory-hub-deep-dive)
10. [Memory tools (available in conversation)](#10-memory-tools)
11. [Troubleshooting](#11-troubleshooting)
12. [Data locations & rollback](#12-data-locations--rollback)

---

## 1. Install & entry points

- Install into the DSH web profile directory (`~/.dsh/profiles/web`): `pnpm add @a9i5k4/dsh-auto-memory`, then append `"@a9i5k4/dsh-auto-memory"` to the `dsh.profile.bundles` array in that directory's `package.json` (or one-click from the DSH plugin marketplace).
- **You must restart dsh web after installing**: the injection surface (manifest) loads at startup. Same after changing host code.
- After a browser-side update, **hard-refresh** (Ctrl+Shift+R) to load the new client.js.
- pnpm v11 blocks packages published <24h ago (`minimumReleaseAge`): set `minimumReleaseAge: 0` in `pnpm-workspace.yaml` or pin an explicit version for same-day updates.
- Entry: the **Memory** button at the bottom of the sidebar → the memory panel.
- Panel title bar: a **pin** (line-drawn icon, matching ⟳ ⤾ ✕; click to pin so clicking outside won't collapse the panel; click again to unpin; pinned state persists), **⤾** reset position, **⟳** refresh, **✕** close. Unpinned, clicking outside or pressing Esc collapses it.
- The version number in the panel title and in Settings → "Check for updates" both show the **installed** version.
- A **floating pin** (line-drawn quick-access icon) also lives in the sidebar for one-click access to memory actions from anywhere.
- Since DSH 0.1.2-rc.1 the Web UI sits behind a token gate (new token every restart; the `?token=…` URL in the startup log is your address). This plugin's HTTP endpoints are loopback-only and unaffected by the gate.
- All data stays on your machine: `~/.dsh/memory/` (memory files), `~/.dsh/dsh-auto-memory-pre.json` (config; `dsh-auto-memory.json` in release builds).

## 2. First launch

- First launch auto-plays the **welcome tour**: every feature explained and toggled on the spot; the semantic engine's detect / download / self-test run inline in one pass. Replay: Settings → Appearance → replay tour; changelog: Settings → Appearance → view changelog (major-version changelogs open with an animation; click anywhere to skip).
- The tour offers to download the **built-in semantic model** (~130MB, multilingual-e5-small, runs locally and offline — memory never leaves the machine). Skipping it is fine; recall degrades to lexical ranking.
- Adjust everything later in Settings. **Changes persist when you hit save** (save bar at the bottom; the save button lights up when dirty). Only injection-surface / tool-list / CoT-observer changes need a host restart; the rest apply immediately or next turn.
- The plugin ships a **notice center**: the publisher pushes major-bug alerts and upgrade advice in-band, no release required.

---

## 3. The twelve memory-panel tabs

> Tab order: **Overview / Logs / Recall review / Memory Hub / Storage / Notes / Whiteboard / Reflections / Connect / Calendar / Search / Workspaces** (narrow panels fold into the › overflow menu).

| Tab | What's inside |
|---|---|
| **Overview** | Time-of-day greeting, today's work (log entries grouped by day), yesterday's reflection digest, cross-workspace summary, and **one-click reflect** (generate a reflection from recent logs immediately). After an absence past the threshold, the "welcome back" lands here too |
| **Logs** | Full daily work logs, folded by date; auto-consolidated entries appear in real time |
| **Recall review** | The **audit desk** for proactive recall: every recall decision (envelope) listed one by one — when, why triggered, what was injected, with what result. Grade each on five levels: **A** correct activation / **P** good prefetch / **S** should have been suppressed / **H** harmful / **E** content needs editing; grades feed the review queue and distill into policy hints |
| **Memory Hub** | The three long-term memory layers: **Skills** (with approval queue: promote / activate / deprecate / pin), **Facts**, **Episodes** — see §9 |
| **Storage** | Memory file browser & stats; **Scan dirty tokens** one-click checkup of user memory / notes / logs / reflections (GBK mojibake / raw JSON / overlong lines / base64 / duplicate blocks — four heuristics, **locations only, never content**) |
| **Notes** | Project long-term notes (MEMORY.md): view & append |
| **Whiteboard** | Handoff home: PLAN.md snapshot (with **version history**), the **handoff ledger timeline**, the **water-level card**, the **auto-continue card** (toggle / threshold / confirm dialog), and **one-click continue to a new session**. Shows guidance when the whiteboard is disabled |
| **Reflections** | Daily reflections (results / lessons / next steps) |
| **Connect** | External memory intake (WorkBuddy / CodeBuddy / Claude Code / Codex / project conventions …): scan per source, import per source, remove per source; **path pointers only, content never copied** |
| **Calendar** | 07:00–22:00 timeline day view: deadlines & promises the AI extracted from conversation land here; unfinished items keep being injected into later sessions until done |
| **Search** | **Full-text search** (instant) + **smart search** (an AI expands your natural-language question into keywords, scans every memory layer, and answers conversationally with sources) |
| **Workspaces** | The memory mind map: workspaces at the center, memory topics as branches, dashed lines for cross-workspace shares; draggable, zoomable, click a card for details |

---

## 4. Settings, group by group

> Settings nav order: **Semantic engine → Memory Hub → Appearance → Storage → Memory window → Automation → Context management → Maintenance**.
> Defaults below are the shipped values; items marked `(restart)` need a dsh web restart.

### 4.1 Semantic engine

The control room of proactive recall. On, the plugin watches context, runs semantic retrieval, and injects memory into conversation at the right moments.

| Setting | Default | How to tune |
|---|---|---|
| Enable engine (`associativeMemoryEnabled`) | off | Master switch. Off = the whole engine idles — no retrieval, no decision, no injection, no recall records; stored memories are kept. Turn off if you're token-shy or want zero surprises |
| Emit mode (`activationEmitMode`) | `shadow` | **shadow** = record decisions only, inject nothing (calibration; safest); **canary-explicit** = inject only on confident explicit recall (recommended daily); **active** = inject on every decision. JS/Python share one source. The current emit mode shows beside it |
| Recall cooldown (`jsDecideCooldownRounds`) | 1 | No re-decision for N rounds after an injection, to save tokens; **0 = no cooldown** (legal) |
| Margin threshold (`jsDecideDeltaExp`) | 0.01 | Gap between top-1 and top-2 candidates must exceed this to inject (e5's cosine distribution is tight: 0.01; bge-m3 calibrates to 0.03). Smaller = more eager, larger = more conservative; 0 = no filter |
| Candidate scheme (`jsDecideCandidateScheme`) | `balanced` | balanced = 3 refs × 40 chars; dense = 6 × 20 (more candidates, wider association); custom = your own count (1–8) and length |
| Injected excerpt length (`jsDecideExcerptChars`) | 40 | Reference-line content cap. 40 = keyword-level (cheap; the model fetches full text via `memory_read_pre`); range 20–480 |
| Retrieval mode (`semanticEngineMode`) | `auto` | **auto** = built-in semantics when ready, lexical fallback; **lexical** only; **js** = built-in e5-small (~130MB); **python** = advanced BGE-M3 int8 (~563MB). See §5. The **⟳ detect** button next to it health-checks the environment and pops the install guide when assets are missing |
| CoT observer (`reasoningObserverEnabled`) | on | Include the model's chain of thought in live observation `(restart)` — closed-source models' summarizing CoT counts too; an important signal for "remembering while doing" |
| Branch-session observation (`contextBridgeObserveChildSessions`) | on | Sessions that continue across days are marked as branches and observed too |
| Recall thresholds (calibration) | fixed | tauHi 0.45 · tauLo 0.35 (read-only; owned by the calibrated policy JSON) |

### 4.2 Memory Hub

The orchestrator of three-layer distillation: **episodic / semantic (facts) / procedural (skills)**.

| Setting | Default | How to tune |
|---|---|---|
| Enable (`memoryHubEnabled`) | **on** | Master switch. On = three layers run; off = keep existing memories, stop distilling new ones |
| Min segments per episode (`episodicMinSegments`) | 2 | An episode needs ≥N conversation segments to consolidate; too few = noise, too many = small chats dropped |
| Episode retention (`episodicRetention`) | 256 | Oldest evicted beyond the cap |
| Min sessions to promote a skill (`procedureMinSessions`) | 3 | A workflow must appear in ≥N independent sessions before promotion is considered |
| Min successes (`procedureMinSuccess`) | 2 | Must succeed ≥N times — one success proves nothing |
| Correction tolerance (`procedureCorrectionCap`) | 0.3 | Corrections/errors above 30% of total evidence keep the workflow a candidate, never promoted |
| High-risk needs approval (`procedureHighRiskApproval`) | on | SSH/deploy/delete-class skills need your explicit approval to promote, and **never** auto-run on similarity |
| Skill injection form (`procedureActiveLevel`) | `checklist` | checklist = full steps + success criteria; excerpt = summary; hint = "refer to this". High-risk auto-downgrades to hint |

### 4.3 Appearance

| Setting | Default | Notes |
|---|---|---|
| Welcome tour (`welcomeTourEnabled`) | on | Auto-plays on first launch; replay tour / view changelog beside it |
| Language (`locale`) | follow system | 中文 / English / follow system |
| Font size (`fontScale`) | standard | sm/std/lg/xl; panel text size, **applies immediately, local only** |
| Accent (`accentTheme`) | DeepSeek blue | DeepSeek blue / graphite / violet; calendar & status colors stay semantic |
| Graph density (`graphDensity`) | relaxed | Node spacing and count in the workspace mind map |

### 4.4 Storage

| Setting | Default | Notes |
|---|---|---|
| User memory dir (`userMemoryDir`) | `~/.dsh/memory` | Cross-project rules; supports `~`; needs write permission |
| Project memory dir (`projectMemoryDir`) | `.dsh-memory` | Name relative to each workspace |
| Memory root (`memoryRoot`) | `~/.dsh/memory/workspaces` | Centralized store: every workspace gets a subdirectory; legacy scattered memories auto-migrate; "Browse" to relocate |

### 4.5 Memory window

The static injection face: the `<memory_system>` block composed into every turn.

| Setting | Default | How to tune |
|---|---|---|
| Inject memory context (`injectEnabled`) | on | Off = no injection at all |
| Injection budget (`injectBudgetChars`) | 1600 | Total char budget for the memory block, truncated beyond. Too much distraction → lower; not remembering enough → raise |
| Recent log days (`recentDaysInjected`) | 1 | Last N days of log tails participate in injection |
| External memory budget (`externalInjectionChars`) | 1400 | Cap for other-AI-tool memories |
| Snapshot min gap rounds (`snapshotMinGapRounds`) | 5 | Re-inject a changed snapshot at most every N rounds, to keep history from bloating; 0 = try every turn (content-change rules still apply) |
| Re-inject after compaction (`snapshotReinjectOnCompact`) | on | Force an immediate re-injection after context compaction/truncation, rebuilding memory background |
| Custom injection prompts (`promptLayerOverrides`) | empty | Layer-by-layer prompt overrides (niche), supports `{date}` `{ws}` `{budget}` `{n}`; one-click restore defaults |

### 4.6 Automation

| Setting | Default | How to tune |
|---|---|---|
| Auto-consolidate (`autoConsolidate`) | on | After each turn a subagent evaluates and files long-term-valuable content into today's log by topic — **you never "remember to log"** |
| Min chars (`autoConsolidateMinChars`) | 240 | Turns shorter than this count as small talk and are skipped |
| Cooldown minutes (`autoConsolidateCooldownMinutes`) | 30 | Min gap between consolidations; auto-doubled at night (22:00–08:00). Note: 0 falls back to 30 (0 does not mean "off") |
| Daily cap (`autoConsolidateDailyMax`) | 8 | After the cap, no more for the day |
| Auto-open panel (`autoPopupEnabled`) | on | Pop the panel and greet on return from absence; off = manual only |
| Unattended mode (`unattendedMode`) | off | For batch/overnight runs: no welcome-back, no niceties or behavioral directives, no calendar pings — facts only; tokens go to the work |
| Auto-unattended overnight (`unattendedAuto`) | off | During the window (default 22:00–08:00, tunable `unattendedAutoHours`) or when a hosted task is detected, enter unattended automatically |
| Away threshold (`awayMinutes`) | 60 | Absent longer = away; returning triggers a welcome; 0 = disable |
| Auto summary times (`autoSummaryTimes`) | empty | Comma-separated HH:MM list; a period summary runs and pops at each; empty = off |
| Day boundary (`dayBoundaryMinutes`) | 450 | Early-morning work counts to the previous day: 450 = 07:30, 480 = 08:00, 0 = midnight |
| Daily reflection (`reflectEnabled`) | on | If yesterday has a log, the day's first session presents the reflection |
| Reflection style (`reflectStyle`) | auto | casual / professional / auto |
| Scheduled dream-consolidation (`consolidateScheduleEnabled`) | on | Daily at the set time, read recent logs and distill long-term points into notes/user memory |
| Time / lookback days | 09:30 / 7 | Host must be online at the moment |
| Scheduled 30-day distill (`maintainScheduleEnabled`) | on | Daily at the set time, distill logs older than 30 days into notes and archive originals; zero-cost skip when nothing is old |
| Distill time | 10:00 | Offset from the consolidation time |
| Subagent model (`subagentModel/Provider`) | follow routing | Model for summaries/greetings/consolidation subagents; empty = follow default |

### 4.7 Context management

| Setting | Default | How to tune |
|---|---|---|
| Handoff whiteboard (`handoffEnabled`) | off | **PLAN.md snapshot + four-part handoff ledger**: written by the model at milestones, injected first in the dynamic snapshot, live in the Whiteboard tab — context that survives windows. Recommended on |
| Plan budget (`handoffPlanChars`) | 1200 | Hard truncation for injecting PLAN.md; full text via `memory_read_pre` or the Whiteboard tab |
| Ledger budget (`handoffLedgerChars`) | 800 | Injection budget for the latest ledger; internally truncated by section weight (failure reasons .35 ＞ next step .30 ＞ goals .20 ＞ state .15, trimmed from the lightest section first) |
| Water-level window override (`waterLevelWindowTokens`) | 0 = auto | 0 = auto: official routed capacity first, then settings.yaml for the active model. **Keep 0 unless you have an exotic model** |
| Advisory threshold (`waterLevelThreshold`) | 0.75 | Past the threshold: inject the handoff advisory and backfill the ledger. **0.75, not 0.8**: the host's own compaction fires at 80%; sitting right under 80% means the host compresses before the handoff finishes — the 5% margin (~50K tokens on a 1M window) is the room to complete it |
| Water-level advisory (`waterLevelAdvisory`) | on | Inject the "write the ledger / refresh the plan / open a new window" advisory past the threshold; silent in unattended mode |
| Auto skeleton ledger (`waterLevelAutoHandoff`) | on | Past the threshold, auto-write one system skeleton ledger per session, so handoff material exists even if the model ignores the advisory |
| Subagent GC (`subagentGcEnabled`) | on | One-shot subagents (consolidation/summaries/greetings/distill) get their session traces **moved** to `~/.dsh/subagent-gc-backup/` on completion (move, not delete — fully reversible); keeps the session list fast |
| Fallback keep days (`subagentGcKeepDays`) | 3 | Daily sweep recycles traces older than this (e.g. after a crash); 0 = rely on end-of-task removal only |

> The auto-continue toggle and threshold live **not in Settings** but in the **auto-continue card** on the panel's Whiteboard tab (see §8.4).

### 4.8 Maintenance

| Item | Notes |
|---|---|
| Version / check for updates | Compares with the npm registry; registry installs get one-click updates. Local dev links show the update command `cd ~/.dsh/profiles/web && pnpm up @a9i5k4/dsh-auto-memory` |
| Diagnostics log | `~/.dsh/dsh-auto-memory-pre-diagnose.log` (subagent circuit-breaking, consolidation skips, GC, recall degradation — all in here) |
| Community | QQ group feedback — faster than GitHub issues (link in README) |

---

## 5. Retrieval deep dive

One `memory_recall_pre` call (or the panel's Search tab) runs a **multi-arm fused** pipeline:

### 5.1 The four arms

| Arm | What it does | Notes |
|---|---|---|
| **Lexical** | Keyword containment / BM25-style scoring | Zero dependencies, always available; **raw-text details that never make it into L0 summaries — error codes, variable names — are found here**; also covers the handoff corpus and full-line hits |
| **Semantic** | Vector cosine similarity | Recalls memories that **share no lexical overlap but match in meaning** — query "credential problem for publishing" hits a log that says "npm ENEEDAUTH". Tier C2 = e5-small (built-in JS), tier C3 = BGE-M3 (Python sidecar); the Python tier also carries a lexical fallback arm — if the semantic service misbehaves, queries fall back automatically and never come up empty |
| **Temporal** | Chinese time-expression parsing | When the query contains 「昨天 / 前天 / 上周 / 上上周 / 上个月 / 今年 / 最近 N 天 / N 天前」-style expressions, they parse into a `[start, end)` window and **entries whose dated logs fall inside get a soft ranking boost**. Boost only, never a hard filter; **queries without time expressions behave byte-identically to a build without the arm** |
| **Evidence weighting** | Memory usage history | Each memory's six evidence event types (§7) aggregate into an importance ∈ [0,1] used as a weighting factor on the semantic arm; memories you've corrected sink |

### 5.2 Fusion & the layered L0 response

- Arm rankings merge via **RRF (rank-space reciprocal-rank fusion, k=60)** — ranks only, never raw scores, so any arm's absence never perturbs the rest.
- Query terms first pass through **QueryPlan assembly** (8-segment / 4096-char window budget, ≤32 terms); terms are kept **in weight-descending order** (user/trigger 1.0 ＞ recent-user 0.8 ＞ tool-result 0.6 ＞ reasoning 0.5 ＞ tool-call 0.4 ＞ assistant 0.2), so budget cuts bite the low-weight words and the high-weight question words are never dropped.
- The default response is an **L0 summary list**: ~93 characters each (6.78:1 compression), with `id`, score, and match reason (`lexical×N` / `semantic×x.xx`) — one retrieval costs about a tenth of the tokens.
- Need the full text of one? Pass its id as `expand="mem_xxx"` (or use `memory_read_pre`) — an anchor-based **byte-range** lookup returns exactly that entry, never a mix-up.
- Scope: `all` (default: handoff corpus + cross-workspace + external + session history) / `handoff` (whiteboard corpus only — check here when resuming long tasks) / `sessions` (session history only).
- Query for something that doesn't exist: an empty or weak-hit response, no error, no blocking (fail-soft).

### 5.3 Choosing a retrieval mode

- **auto (recommended)**: built-in semantics when ready, lexical fallback — zero fuss.
- **lexical**: forced lexical, 0GB.
- **js**: e5-small q8 (~130MB); if the model isn't downloaded you'll see "lexical fallback" — hit **⟳ detect** and follow the download guide.
- **python**: BGE-M3 int8 (~563MB), highest recall quality; one-click install wizard (detect Python 3.9–3.12 → create an isolated venv at `~/.dsh/python-engine/` → install transformers + onnxruntime + torch → resumable model download with automatic mirror fallback). Model and venv live in your user directory — **plugin upgrades never touch them**.

Undecided? **auto + canary-explicit** balances recall quality with restraint. "Lexical fallback" anywhere means the semantic assets aren't ready yet.

---

## 6. Proactive recall deep dive

Proactive recall = the host **never waits for the model to search**. While the conversation flows, it watches continuously, decides on its own "what should resurface", and injects before the next turn is assembled. The model "forgetting to look" no longer means the memory doesn't exist.

Five steps:

1. **Observe**: user messages, chain of thought, assistant output, tool results all flow into a sliding window (CoT observer toggleable).
2. **Prefetch**: for each observed segment, assemble a QueryPlan → lexical search → semantic ranking → candidate memories.
3. **Decide (fv2)**: are the candidates strong, is the intent a recall, is the content complete, does it echo a recent injection (echo veto), is the cooldown over — concluding **prefetch** (hold ready) / **emit** (inject) / **suppress**. The JS tier decides with built-in policy artifacts; the Python tier's sidecar decides (both share the same policy source).
4. **Emit gate**: a positive decision still passes the "emit mode" gate — shadow records everything and injects nothing; canary-explicit lets only explicit recalls through; active lets all through.
5. **Inject**: hits enter the next turn as a **Reference Tail** — injection happens at a fixed boundary, so **the prefix cache never goes cold and tokens never pay twice for a memory**. Injected content is template-variable-neutralized and declared as "background facts, not style examples".

Every decision lands in the **Recall review** tab for A/P/S/H/E grading. Every injection also writes a `seen` evidence event (§7); opening the full text adds `read`; citing it in a reply adds `cite`.

---

## 7. Evidence chain & memory importance

Every memory keeps an auditable usage dossier — six event types, filed daily under `~/.dsh/memory/evidence-pre/events/YYYY-MM-DD.jsonl`:

| Event | Meaning |
|---|---|
| `seen` | Injected / surfaced |
| `read` | The model opened the full text |
| `cite` | Quoted in a reply |
| `reuse` | Reused across sessions |
| `success` | The associated task completed |
| `correction` | You corrected it ("no, you misremembered") — **attributed to the most recently cited/read memory**, pulling its importance down |

The six types aggregate into that memory's **importance ∈ [0,1]** (neutral by default, negative for corrections, positive for success/cites), used as the semantic arm's weighting factor: memories that are used, cited, and reliable float up more easily; corrected ones sink. Any failure reading evidence never blocks retrieval — importance just degrades to neutral.

---

## 8. Context management deep dive

### 8.1 The water-level card

Panel → Whiteboard, top: **used tokens / window tokens · percent**, with two labeled sources:

- **Metering**: `official meter (usage)` = same source as the chat box's context ring (current context occupancy); heuristic estimate as fallback.
- **Window**: `official routed capacity` (most authoritative) → `auto-detected: provider/model` (looks up settings.yaml for **the model this session is actually using**) → `fallback default` (conservative 128K; seeing this label means the window wasn't recognized — fill `waterLevelWindowTokens` manually).
- The card is **per-session**: switch sessions and it follows; a brand-new session shows "not yet measured".
- Percentages display **honestly** (over 100% shows the real number); the progress bar caps at 100%.

### 8.2 The handoff whiteboard

- **PLAN.md**: a whole-project snapshot (overview / current state / conventions / next steps), rewritten by the model at real milestones, old versions auto-archived and browsable in **version history**.
- **Four-part handoff ledger**: task state / goals / approaches tried and why they failed / progress & next step — the next step must be an executable first move. The ledger truncates by section weight on injection (failure reasons heaviest), so the costliest lessons always make it into the injected material.

### 8.3 One-click continue (manual)

Whiteboard tab → "**Continue to a new session**":

1. `Refresh ritual`: the old agent refreshes the PLAN and ledger first (configurable off; 90s timeout backstop).
2. `Assemble handoff materials (incl. full transcript)`.
3. `Create new session` (**inheriting** the old workspace, model, thinking tier and preset; titled `Continue #N · <workspace>`).

The new session's first message is **layered handoff material**:

| Layer | Content |
|---|---|
| 0 | Directive + PLAN.md excerpt (build the global picture) |
| 1 | Latest handoff ledger (four parts, incl. dead ends and why) |
| 2 | Recent threads (last 20 × 700 chars, roles and tool markers kept) |
| 3 | Full transcript (path given, **read on demand**, never pasted whole) |

The material says "fetch on demand, don't read through" — the new session continues the work without re-reading the old one end to end.

### 8.4 Auto-continue (buttonless, recommended)

Whiteboard tab → auto-continue card: toggle (default on) + threshold (default 0.75, synced with the water-level threshold).

- **Trigger**: water level ≥ threshold **and** the harness's authoritative `running` bit turns `false` at a turn boundary (the session is truly idle). Long tool calls don't false-trigger.
- **Host backstop**: past the threshold, the countdown runs host-side — page backgrounded, tab closed, or nobody at the keyboard, the host itself completes "refresh plan/ledger → create session → inherit model & workspace → inject materials" when the countdown ends.
- **Confirm dialog, three branches**: Agree = continue now; Reject = skip this boundary (won't re-prompt on it); **35 s of silence** = treated as away, auto-continue.
- After a trigger, a 30-minute cooldown prevents repeats.
- Unattended: Settings → Automation → auto-unattended overnight skips the dialog and continues directly.

### 8.5 Subagent trace GC

DSH creates a persistent session directory per subagent; this plugin's consolidation/summaries/greetings/distills are all one-shot subagents, and thousands of leftovers slow the session list. GC (default on) **moves** sessions with `origin=subagent`, label prefixed `auto-memory-`, one-shot mode, into `~/.dsh/subagent-gc-backup/` (never deletes; fully reversible); continuable subagents are always kept. Manual preview/apply: `node tools/subagent-gc.mjs` / `--apply`.

---

## 9. Memory Hub deep dive

Three long-term layers (orchestrator policyVersion `memory_hub_pre_v1`):

- **Episodes**: conversation flows accumulate per segment; at `episodicMinSegments` they consolidate into one episode; the most recent 256 are kept.
- **Facts**: subject–predicate–object conclusions (e.g. "DSH emit tiers · has three modes · …"), with conflict detection (`pendingConflicts`).
- **Skills**: workflows seen repeatedly and succeeding repeatedly crystallize into skills; injected as checklist/excerpt/hint per `procedureActiveLevel`; **auto-archive after 90 idle days, pinnable when important, kept warm when frequently used**.

Promotion passes four gates: appears in ≥3 independent sessions, succeeds ≥2 times, correction ratio ≤30%, and high-risk skills need your manual approval (the approval queue lives in the Memory Hub tab). Insufficient evidence — including success evidence — stays a candidate forever.

---

## 10. Memory tools

Available to the AI in conversation (14 in total; you don't need to memorize them):

| Tool | Purpose |
|---|---|
| `memory_recall_pre` | Retrieve memory: local memory (all workspaces' logs / notes / reflections / whiteboard) + cross-workspace + external + session history. Returns an L0 summary list by default; `expand` for full text; `scope=handoff/sessions` shortcuts |
| `memory_read_pre` | Read a specific memory / day's log / reflection / notes on demand |
| `memory_note_pre` | Write project notes / handoff ledger / rewrite the PLAN whiteboard (`kind=plan/handoff`) |
| `memory_log_pre` | Append today's log (append-only) |
| `memory_user_pre` | Cross-project long-term rules |
| `memory_reflect_pre` | Save a daily reflection |
| `memory_consolidate_pre` | Dream-style consolidation: read recent logs, distill long-term points |
| `memory_maintain_pre` | 30-day distill: distill old logs into notes, archive originals — not a character lost |
| `memory_status_pre` | Memory system status overview |
| `memory_external_pre` | External memory source management (scan / connect / remove other AI tools' memories) |
| `calendar_add_pre` / `calendar_list_pre` / `calendar_done_pre` / `calendar_remove_pre` | Calendar — the AI extracts deadlines from conversation proactively; unfinished items keep reminding |

All three write tools (log/note/user) pass the **write gate**: GBK mojibake, stutter degeneration, consecutive duplicate lines, external-AI persona JSON signatures, base64 residue — all rejected with a human-readable reason; appends ≤8,000 chars, rewrites ≤200,000; appends are deduped against the last ~60 lines. **Credential/secret sections never enter prompts.**

---

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| Semantic query comes back empty | ① Check the retrieval mode & `⟳ detect`: js/python assets not ready shows "lexical fallback" — follow the guide ② On the Python tier, confirm the sidecar is running (sidecar lines in the diagnostics log); since 2.2.7 the Python tier carries a lexical fallback arm, so a broken semantic service degrades to lexical instead of coming up empty ③ auto drops to whatever works |
| Water level looks wrong (e.g. 150%) | ① Confirm the **host was restarted** (host code doesn't hot-reload) ② Window parsing is fixed and sources are labeled; percentages are honest, progress bar caps at 100% ③ "fallback default" label = model missing from settings.yaml; fill `waterLevelWindowTokens` |
| Auto-continue doesn't fire | ① Toggle on the Whiteboard card ② Water level reached the threshold? ③ Session truly idle (`running` false)? ④ Inside the 30-min cooldown? ⑤ Host restarted? (host backstop needs the new injection surface) |
| One-click continue errors "harness did not provide remote.session" | Restart dsh web; if it persists, plugin version ≥ 2.2.2 required |
| Setting changed but nothing happened | Did you click the save bar (button lights up when dirty)? Items marked `(restart)` need a restart; browser-side updates need Ctrl+Shift+R |
| Consolidation too often / too rare | Tune `autoConsolidateCooldownMinutes` (auto-doubled at night; 0 counts as 30) and the daily cap |
| Session list getting slow | Keep subagent GC on (Settings → Context management); run `node tools/subagent-gc.mjs --apply` once; backups in `~/.dsh/subagent-gc-backup/` roll back wholesale |
| Recall review shows only prefetch, never injection | The emit gate is on shadow (record only) — switch to canary-explicit or active; or lower the margin threshold |
| Mojibake / duplicates in memory | The write gate guards new entries; for existing ones use Storage → "Scan dirty tokens" (locations only) and clean by position (back up first) |
| pnpm blocks a same-day update | pnpm v11 `minimumReleaseAge` blocks <24h packages: set `minimumReleaseAge: 0` or pin the version |
| Web UI asks for a token | DSH 0.1.2-rc.1 security gate; the token is in the `dsh web` startup-log URL and rotates each restart |
| Sidebar Memory button vanished | Likely a conflict with another sidebar-injecting plugin; disable the suspect in plugin management |
| Feedback / grab logs | `~/.dsh/dsh-auto-memory-pre-diagnose.log`; QQ group in README |

---

## 12. Data locations & rollback

| Content | Path |
|---|---|
| Plugin config | `~/.dsh/dsh-auto-memory-pre.json` (`dsh-auto-memory.json` in release builds) |
| User-level memory | `~/.dsh/memory/MEMORY.md` |
| Workspace memory | `~/.dsh/memory/workspaces/<workspace>/` (MEMORY.md, daily logs, handoff/, reflections/, summaries/) |
| Whiteboard & ledgers | `~/.dsh/memory/workspaces/<workspace>/handoff/` (PLAN.md + handoff-*.md) |
| Memory Hub layers | `~/.dsh/memory/hub-pre/` (episodes / facts / procedures .json, atomic writes) |
| Evidence events | `~/.dsh/memory/evidence-pre/events/YYYY-MM-DD.jsonl` (six types, per day) |
| Semantic-engine data | `~/.dsh/memory/semantic-pre/` (embedding-config.json, decision shadow logs, vector cache) |
| Models / venv | `~/.dsh/models/js-semantic/` (C2 model) · `~/.dsh/python-engine/` (C3 venv + model; plugin upgrades never touch these) |
| Subagent trace backups | `~/.dsh/subagent-gc-backup/` (move back into `~/.dsh/sessions/` to roll back) |
| Diagnostics log | `~/.dsh/dsh-auto-memory-pre-diagnose.log` |

---

*BSD-3-Clause · Repo: github.com/Aik358/dsh-auto-memory · Screenshots & story: [README](../README.md) · 中文文档：[USER-GUIDE.zh-CN.md](./USER-GUIDE.zh-CN.md)*
