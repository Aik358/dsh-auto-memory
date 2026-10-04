# PR #213 merge interaction repair

## Reproduced defect

At merge head `05fd9b64ca8f6c3aaae5d5f5cdc0d51ea65c3111`, a real
`MemoryEngine.writePlanSnapshot` admitted before a settings migration could wait
on the native `PLAN.md.lock`. `saveConfig` copied the old PLAN and switched
`memoryRoot` before that writer completed. Once the native lock was released,
the writer returned success but its new revision existed only in the preserved
old root. The active root still contained the old revision.

An isolated reproduction using each branch's committed source also observed this
sequence at PR #210 `f4105b87ca7f7c76cffbc784f0e956a21cd646a9` and PR #215
`f518edd3e949e2ef368bfc0a874da3cc9ea4006f`.

## Repair and scope

PLAN writers register a flight synchronously before the first await, including
canonical-path resolution and waiting on the existing native lock. Settings root
migration closes admission and drains the admitted note and PLAN flights before
copying. New PLAN writers during migration return `settings-migration-active`.
The native lock callback also rechecks the captured `memoryRoot` and
`projectMemoryDir`; a changed binding returns `settings-root-changed`. Every
admitted writer releases its flight in `finally`. Invalid path arguments fail
before registration.

The existing cross-process PLAN lock, card/full-document CAS, protected user
regions, atomic commit, conflict evidence and archive behavior are retained.
The migration admission/drain barrier coordinates this engine's writers; this
change does not claim a root-wide migration transaction across independent
engines or processes.

## Local isolated verification

- `node tests/smoke/smoke-test-settings-plan-migration.mjs`: four PASS cases with
  the actual MemoryEngine, native PLAN lock, temporary filesystem, durable
  configuration and PLAN revisions. The active root contains the acknowledged
  queued revision; new writers are rejected during migration; changed root
  bindings are rejected; failed writes and invalid arguments leave no flights.
- Existing settings safety, migration name and sync suites: PASS. Windows file
  symlink validation remains an explicit permission-dependent SKIP; directory
  junction and canonical-overlap cases passed.
- Existing issue164 PLAN CAS and two-process suites: PASS, including distinct
  card updates, stale conflicts, killed owner recovery, user bytes and CRLF.
- Existing plan-seed 27/0, handoff 59/0, P7 write 43/0 and R26 23/0: PASS.
- Existing audit-G-207 34/0, team-wiring suite and diagnostic-integrity 28/0: PASS.
  WASM coverage is filesystem path resolution and environment wiring; no WASM
  execution or remote team service acceptance is claimed.
- `node --check lib/index.js` and
  `node tools/build-iter5-skin.mjs --check --strict`: PASS / SYNC-OK.

Before this incremental repair, the merge's recorded full local smoke run was
262 PASS / 0 FAIL / 0 TIMEOUT. The incremental checks above are separate from
that run. A new full local/remote CI result for the repaired commit is not claimed
here. All added regressions use temporary roots; no personal memory or live
provider is used.
