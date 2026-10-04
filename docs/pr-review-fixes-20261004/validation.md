# PR #215 review fixes — 2026-10-04

Baseline: `e70f00b9ebd99689c571ce7547ba35a09c352016`.

## Behavior

Every accepted settings-config read runs one hydration path for scoped drafts, dirty state, conflict feedback and prompt-section metadata. Ordering follows the latest successfully applied response; a failed newer broadcast cannot suppress a successful initial read. Beginning a save advances the applied-request barrier, rejecting reads from before that write. The generator was updated and `lib/client.js` regenerated.

Root migration excludes `.lock`, `.lock.acquire`, `.tmp`, `.tmp-*` and `.tmp.*` writer artifacts. The regression holds the real source PLAN lock during migration, then acquires the target lock and writes successfully. User-root migration copies `PENDING-USER-MEMORY.md`, preserves the source and retains an existing target candidate file.

The V3 inventory reader normalizes CRLF. Controlled config-commit failure replaces a platform-dependent chmod assumption; Windows directory junctions exercise path escape and overlap checks.

## Local verification

Windows, Node v24.15.0; temporary memory roots. Each command exited zero.

- `node tests/smoke/smoke-test.mjs`
- `node tests/smoke/smoke-test-api-paths.mjs`
- `node tests/smoke/smoke-test-settings-safety.mjs`
- `node tests/smoke/smoke-test-settings-sync.mjs`
- `node tests/smoke/smoke-test-settings-routes-safety.mjs`
- `node tests/smoke/smoke-test-settings-parity.mjs`
- `node tests/smoke/smoke-test-ui-v3.mjs` — 360 unique entries / 154 config fields
- `node tests/smoke/smoke-test-generator-guard.mjs` — 24 PASS / 0 FAIL
- `node tests/smoke/smoke-test-generator-idempotent.mjs` — 14 PASS / 0 FAIL
- `node tests/smoke/smoke-test-settings-migration-boundaries.mjs` — 2 PASS / 0 FAIL
- `node --check lib/index.js`
- `node --check lib/client.js`
- `node tools/build-iter5-skin.mjs --check` — SYNC-OK
- `git diff --check`

One file-symlink branch was explicitly SKIP because this Windows account lacks file-symlink permission. Directory junction and plain-file rejection assertions ran.

`node tests/browser/settings-safety.mjs`: React 18.3.1 + Chromium 153.0.8010.12, fixture host APIs, **25 workflow groups, zero page exceptions**. The added group covers current/frozen/classic settings, both initial/broadcast response orders, successful/failed newer reads, retained input, dirty state and prompt metadata. Existing routing, translated search, skin switching, pending-save and identity matrices also passed. See [browser evidence](browser-results.json) and the fresh [appearance capture](appearance-1440.png).

GitHub Actions status for the updated head is recorded in the PR description. Prior-head CI had 260 PASS / 2 FAIL / 0 TIMEOUT (transformers WASM assets, developer Python venv). Browser fixture and local filesystem results do not establish full installed DSH, model/team-network, physical-device or screen-reader acceptance.
