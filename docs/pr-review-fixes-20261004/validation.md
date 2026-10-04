# PR #212 review fixes — 2026-10-04

Baseline: `c9ea9925fed6d9865d109511f1b771237cc4bf33`.

## Behavior

Strict evidence-ledger reads reject any invalid durable JSONL row with `ledger-corrupt`, return no partial event list, and stop replay before appending or feeding procedure counters. Display queries retain their tolerant bad-line count. The regression corrupts a previously persisted event, restores a procedure snapshot, attempts replay, checks unchanged bytes and counters, repairs the row, and checks deduplication again.

The case-scope regression probes the temporary filesystem's case behavior. POSIX case preservation is asserted on every platform; actual read/cite/success ownership and global eligibility still run using two distinct native directories.

## Local verification

Windows, Node v24.15.0; temporary memory roots.

| Command | Result |
| --- | --- |
| `node tests/smoke/smoke-test-evidence-ledger-read-failure.mjs` | 4 PASS / 0 FAIL |
| `node tests/smoke/smoke-test-evidence-case-scope.mjs` | PASS ownership, global eligibility and cross-scope rejection; native case-only directory pair explicitly SKIP on this case-insensitive filesystem |
| `node tests/smoke/smoke-test-success-evidence-ownership.mjs` | 5 PASS / 0 FAIL |
| `node tests/smoke/smoke-test-procedure-session-upgrade.mjs` | 2 PASS / 0 FAIL |
| `node tests/smoke/smoke-test-m52.mjs` | 52 assertions PASS / 0 FAIL |
| `node tests/smoke/smoke-test-p9d-recent-evidence-ts.mjs` | PASS valid timestamp selection, strict corrupt-ledger refusal, tolerant display and repair recovery |
| `node --check lib/evidence-store.js` | PASS |
| `git diff --check` | PASS |

GitHub Actions status for the updated head is recorded in the PR description. Prior-head full CI had 270 PASS / 3 FAIL / 0 TIMEOUT (policies, developer Python venv, skin assets); these local checks do not establish full-suite equivalence or installed DSH acceptance.
