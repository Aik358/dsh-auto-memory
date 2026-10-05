# Fix settings persistence, scoped drafts and runtime control feedback

Changing skins or closing the classic memory panel could discard unsaved notes, and a late save response could erase text entered after submission. Settings also acknowledged invalid directories and failed semantic writes as successful; interrupted root migration could publish incomplete destinations and skip missing files on retry.

Keep note and calendar drafts and pending submission outcomes scoped to the current session/workspace, protect close/cancel paths, and clear only the submitted draft across remounts. Compare render-time operation identity/status at subscription to recover missed completions without clearing a new draft on replay. Guard effective-water reads by generation and session identity. Validate directory/time/integer fields with explicit errors, serialize configuration saves, and publish a new root only after verified additive migration. Preserve existing target data and old sources; migrate only durable user-memory files and subdirectories. Resolve canonical overlap before mkdir, track owned copies durably and roll them back on migration/config failure. Coordinate local note routes with root changes, and serialize their duplicate checks with append.

Retain the four engine/memory/appearance/behavior groups and existing pale-blue appearance. Move models/effort to automation and exclusions to memory, show effective watermark/window/gate values and dependent controls, align margin editing with the existing runtime range 0.3..1, remove only the obsolete slim-plan/ledger controls, and explain pending/immediate/restart states. Fix provider/model identity, the About heading, and secret masking. HTTP/folder remain unavailable in this host; stored values are preserved. Runtime defaults, compatible configuration keys, package version and transport implementation remain unchanged.

Validation:

- Node 22 CI smoke: 243 pass / 3 inherited failures / 0 timeout (246 suites); clean main is 241 pass / the same 3 failures / 0 timeout (244 suites). Full command exits 1 because inherited failures remain.
- New actual-engine/filesystem and shipped-handler regressions cover migration/copy/read/write failures, retries, existing data, corrupt JSON, scoped note paths, duplicates and validation boundaries.
- Chromium + React 18, fixture APIs: 17 evidence groups pass with no browser exceptions, including request disorder, draft remount/close/reopen, identity changes, secret handling, two-instance semantic synchronization, 24 pending-remount success/failure/A/B scenarios across note/calendar implementations, 24 additional controlled render/commit-to-subscription completion scenarios (and same-text new-draft protection), all three settings water-read races, and current Settings zh/en/ja navigation with appearance-only 390/1280 layout/focus checks.
- Fixed inherited diagnostic-test flakiness when ISO timestamps contain 39 seconds; the fixed-time regression still checks secret and stale-prose rejection.
- Source-generation check, JS syntax checks and package dry run pass.

Migration journal recovery after process crashes and after post-config-commit cleanup failures is untested; no crash-consistency claim.

Remaining acceptance limits: missing baseline policies/images, Python developer venv and GoldenParity fixtures; no full DSH/model/team-network/Windows acceptance, all-page layout or full keyboard acceptance, or global/cross-process write transaction. See `REVIEW.md`, `TEST_RESULTS.md`, and `artifacts/ui-settings-20261003` for evidence and exact scope.

Local preparation only. Nothing has been pushed, published, merged, deployed or released.
