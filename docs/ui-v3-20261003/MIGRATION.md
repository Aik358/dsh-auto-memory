# Shipped V3 migration audit

The approved inventory contains 359 entries. The shipped index in
[`settings-schema.js`](../../skins/iter5/settings-schema.js) retains every key:
153 host configuration entries, 51 nested entries, 94 layout-file entries,
26 semantic-file entries, 20 browser preferences, 8 browser state entries,
4 runtime compatibility entries, 2 historical entries and 1 browser-state pattern.
The host list is checked against the actual `DEFAULT_CONFIG` declaration.
The canonical form retains 107 directly referenced host keys plus the existing
23 shared team controls; source and generated control parity are tested.
These counts overlap where a read-only mirror uses the same key. They are not
counts of new switches. File-only, internal and historical entries remain honest
directory entries. Model/provider/effort and prompt layer/section entries open
their real editors. Runtime prompt sections still come from the host.

Field ownership changes presentation only. The host JSON, semantic file, browser
preferences, layout files and their actual consumers keep their existing storage
boundaries. Unknown consumer scope remains marked in the index. Automatic
recording, stored snapshots, observation, retrieval and delivery remain separate;
daily consolidation limits and character/token units are shown explicitly.

The following 73 rows reconcile the approved entry/flow inventory. The source of
route truth is `MemoryTabBody`, `MEMORY_TABS`, the two `iter5PageForTab` functions,
their real component maps and `Iter5Destinations`. The navigation smoke guard
executes actual builders and the classic body dispatcher, checks exact sets and
rejects removed buttons or wrong bodies. Browser evidence additionally uses real
React route content. Preservation of a flow does not claim that every remote,
model-dependent or dangerous operation was exercised in a live DSH host.

| # | Existing entry or operation | Shipped destination and retained contract |
|---|---|---|
| 1 | Modern `home` | Workbench → overview; original home component |
| 2 | Modern `library` | Memory → browse/search; original memory component |
| 3 | Modern `handoff` | Tasks → task/whiteboard; original continuation component |
| 4 | Modern `calendar` | Tasks → calendar; original calendar editor |
| 5 | Modern `skills` | Memory → skills/approval; original gated actions |
| 6 | Modern `recall` | Memory → recall review; original evidence and feedback |
| 7 | Modern `mindmap` | Memory → workspace relationships; original graph |
| 8 | Modern `storage` | Settings → data maintenance → maintenance center |
| 9 | Modern `settings` | Common and six purpose sections; shared settings root |
| 10 | Modern `team` | Secondary Team destination; original team workflows |
| 11 | Modern `stats` | Workbench → statistics/calls; original channels |
| 12 | Classic `overview` | Workbench → overview; `OverviewTab` |
| 13 | Classic `logs` | Memory → logs; `Iter5History` |
| 14 | Classic `refine` | Memory → recall feedback; `RefineTab` |
| 15 | Classic `hub` | Memory → memory hub; `MemoryHubTab` |
| 16 | Classic `storage` | Settings → maintenance center; `StorageTab` |
| 17 | Classic `notes` | Memory → notes; `NotesTab` |
| 18 | Classic `plan` | Tasks → whiteboard; `PlanTab` |
| 19 | Classic `reflections` | Memory → reflections; `ReflectionsTab` |
| 20 | Classic `team` | Secondary Team destination; `TeamTab` |
| 21 | Classic `connect` | Memory → external sources; `ConnectTab` |
| 22 | Classic `calendar` | Tasks → calendar; `CalendarTab` |
| 23 | Classic `search` | Memory → search; `SearchTab` |
| 24 | Classic `workspaces` | Memory → relationships; `WorkspaceTab` |
| 25 | Classic `stats` | Workbench → statistics/calls; `StatsTab` |
| 26 | Memory child `browse` | Memory → browse; original reader and append editor |
| 27 | Memory child `logs` | Memory → logs; existing date-based history |
| 28 | Memory child `reflections` | Memory → reflections; existing history |
| 29 | Memory child `search` | Memory → search; original search component |
| 30 | Continuation child `task` | Tasks → current task/continuation |
| 31 | Continuation child `board` | Tasks → whiteboard; existing graph/legacy policy |
| 32 | Continuation child `external` | Memory → external sources; `connect` maps to `external` in both skins |
| 33 | Host `settings.section` | Shared root with `host` draft scope; stable portal container |
| 34 | Sidebar footer launcher | Opens the shared memory controller |
| 35 | `shell.overlay` panel | Same classic navigation/body or existing quick panel |
| 36 | `shell.overlay` dialogs | Existing dialog host; scoped note/calendar drafts |
| 37 | `shell.overlay` autocont | Existing continuation confirmation/countdown |
| 38 | Conversation memory view | Same `MemoryPageView` and skin dispatcher |
| 39 | Conversation whiteboard board | Existing `KanbanView` host slot |
| 40 | Conversation whiteboard canvas | Existing experimental graph slot; default remains hidden |
| 41 | Former engine settings | Fields split by actual metadata; lookup and setup stay together |
| 42 | Former window settings | Find/use snapshots; water and handoff controls move to continuity |
| 43 | Former capacity settings | Record consolidation; maintenance retention/capacity |
| 44 | Former skills settings | Record accumulation, find/use delivery, advanced governance |
| 45 | Former handoff settings | Continue/remind; reclamation in maintenance |
| 46 | Former auto settings | Record schedules, continuity reminders, maintenance lifecycle, advanced models |
| 47 | Former store settings | Maintenance paths, record reflections, find/use external context |
| 48 | Former look settings | Appearance, find/use source exclusions, advanced shared resources |
| 49 | Former team settings | Advanced team connection; shared 23-control renderer |
| 50 | Former skin settings | Appearance → existing skin center |
| 51 | Former about settings | Advanced → version/update/config actions |
| 52 | Add/edit/undo/delete notes/rules | Existing memory detail/editor; identity, CAS, backups and confirmation retained |
| 53 | Logs/reflections/manual reflection | Existing history/detail and explicit reflection action |
| 54 | Corpus refinement/recall feedback | Recall review and original feedback handlers |
| 55 | Skill list/promote/approve/retire | Skills/approval; original gated action nodes |
| 56 | External source list/detail/toggles | External sources; original discovery and index semantics |
| 57 | External view/link/import/bulk/remove | Original source actions; remove preserves original source files |
| 58 | Whiteboard cards/ledgers/archive | Tasks → whiteboard/continuation; versions and origin retained |
| 59 | Create continuation/confirm/countdown | Original task actions and cross-page confirmation card |
| 60 | Calendar add/edit/reminder/time slot | Tasks → calendar; seven-field scoped draft and submission guard |
| 61 | Capacity/corpus/file-item cleanup | Maintenance center; original destructive confirmation |
| 62 | Export/check/conflict/import migration | Original migration wizard; additive policy, stale-preview guard and source preservation |
| 63 | Browse/native directory selection | Maintenance paths; caller-specific field and request generations |
| 64 | Archive/delete inspection/reclaim | Maintenance lifecycle; original immediate action and force semantics |
| 65 | Detect/download/install/mirror/GPU/rebuild | Find/use → engine advanced setup; true readiness/fallback retained |
| 66 | Model drawer/manual/provider/effort | Advanced → model editor; joint provider/model identity and lane overrides |
| 67 | Thirteen prompt sections/layer editor/exclusions | Find/use advanced; host-supplied sections and raw saved draft |
| 68 | Welcome/setup/update announcements | Appearance welcome actions and existing setup/update dialogs |
| 69 | Skin shelf/install/assets/preview | Appearance → existing skin center; valid family/theme contracts |
| 70 | Team create/join/test/leave | Secondary Team workflows; existing network/secret boundary |
| 71 | Team conflict/member/ownership/review/audit | Existing dedicated team screens and permission boundaries |
| 72 | Statistics detail/reset | Workbench → statistics/calls; separate channels and reset confirmation |
| 73 | Version check/update/open configuration | Advanced → original maintenance actions and restart requirements |

Classic workbench settings use `workbench` draft scope, matching both skin
families. The genuine host settings surface retains `host`. The form owns its
scoped structural V3 stylesheet; legacy and classic continue to receive their
frozen palette sheet through the existing shared-style dispatcher. The fixture
does not globally inject variant CSS into those entries.
