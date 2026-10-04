# PR #213 review fixes — 2026-10-04

Baseline: `72a146994fd6ed20f38b73715edf6cfbcafa6fef`.

## Behavior

Every accepted settings-config read runs one hydration path for scoped drafts, dirty state, conflict feedback and prompt-section metadata. Ordering follows the latest successfully applied response; a failed newer broadcast cannot suppress a successful initial read. Beginning a save advances the applied-request barrier, rejecting reads from before that write. Current and frozen sources were updated and `lib/client.js` regenerated.

Root migration includes `PENDING-USER-MEMORY.md` and excludes writer locks, acquisition gates and temporary write files. The pending-file assertion executes through the real `MemoryEngine.saveConfig` migration. Controlled config-commit failure replaces a platform-dependent chmod assumption; Windows directory junctions exercise path escape and overlap checks.

The independent delegate review found that the initial suffix filter also excluded persistent `.tmp.` names and directories. The corrected filter applies only to regular files with `.lock`, `.lock.acquire`, plain `.tmp` or numeric temporary suffixes. Durable Markdown names and directories are retained. Both initial enumeration and final verification use entry types. The new regression failed on the previous head, then passed after correction through actual `MemoryEngine.saveConfig`; an artifact becoming a directory during migration also triggers rollback.

## Local verification

Windows, Node v24.15.0; temporary memory roots. Each command exited zero.

- `node tests/smoke/smoke-test.mjs`
- `node tests/smoke/smoke-test-api-paths.mjs`
- `node tests/smoke/smoke-test-settings-safety.mjs`
- `node tests/smoke/smoke-test-settings-sync.mjs`
- `node tests/smoke/smoke-test-settings-routes-safety.mjs`
- `node tests/smoke/smoke-test-settings-migration-names.mjs` — 2 PASS / 0 FAIL
- `node tests/smoke/smoke-test-iter5-skin.mjs`
- `node --check lib/index.js`
- `node --check lib/client.js`
- `node tools/build-iter5-skin.mjs --check`
- `git diff --check`

One file-symlink branch was explicitly SKIP because this Windows account lacks file-symlink permission. Directory junction and plain-file rejection assertions ran.

`node tests/browser/settings-safety.mjs`: React 18.3.1 + Chromium 153.0.8010.12, fixture host APIs, **18 workflow groups, zero page exceptions**. The added group covers current/frozen settings, both initial/broadcast response orders, successful/failed newer reads, retained input, dirty state and prompt metadata. See [browser evidence](browser-results.json) and the fresh [appearance capture](appearance-en-1280.png).

GitHub Actions status for the updated head is recorded in the PR description. Prior-head CI had 243 PASS / 3 FAIL / 0 TIMEOUT (policies, developer Python venv, skin assets). Browser fixture and local filesystem results do not establish full installed DSH, model/team-network, all-page keyboard or screen-reader acceptance.
