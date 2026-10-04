# CI failure fixes — 2026-10-04

## Causes and corrections

- PRs #210/#212/#213 were missing lib/policies and lib/assets/skin. Restore the 84 blobs from upstream f2f7cc1cbf2d3caf2d2a99f425dfd2b5dd028218. Their skin manifest is unchanged, and both runtime policy blobs match each branch's Python policy copy. Existing parity and real image-dimension assertions now pass. npm pack --dry-run confirms every referenced light/dark slot and both policy files are included.
- The Python chain suite assumed a developer-specific Windows venv and >100 MB installed model. Replace the portable chain with real Python child processes and temporary standard-library venvs. Assert missing executable attribution, actual timeout/retry, no retry for dependency errors, configured priority, missing/no-deps/ready selection, full failure records and deduplication. Tiny controlled import modules exercise selection only; they are not C3 dependencies or models.
- Preserve installed C2/C3 acceptance in smoke-test-py-runtime-live.mjs with repository-relative paths and DSH_TEST_PLUGIN_DIR. It remains strict when explicitly run and is excluded by the existing -live CI rule. It was not run here because the isolated worktrees lack models and the real C3 dependency environment.
- Pin CI Python 3.12 with setup-python; no model/dependency downloads are needed for portable regression. Required smoke checks are still enforced; no additional --exclude arguments were added.
- PR #215 WASM audit stripped the leading slash from Linux paths and assumed an uninstalled optional package. Use fileURLToPath with an actual temporary filesystem fixture containing a minimal WASM module. Cover local path selection, auto/off/missing assets/missing config and production wiring. DSH_TEST_TRANSFORMERS_DIST optionally supplies a real package directory and remains strict if invalid. This suite does not execute WASM or prove model inference.

## Local verification

Windows, Node v24.15.0, Python 3.12.10; temporary test data only.

- All four branches: policy parity 13 PASS / 0 FAIL; skin suite 68 PASS / 0 FAIL; portable Python chain PASS; live-suite syntax PASS; diff check PASS.
- PR #215: audit-g-207 34 PASS / 0 FAIL with the isolated fixture, and 34 PASS / 0 FAIL with DSH_TEST_TRANSFORMERS_DIST pointing to the actual locally installed transformers dist. Both runs validate path handling; neither executes WASM.
- Restored source blobs verified against the fixed upstream commit in all three affected branches.
- npm dry-run (#210): referenced slots and policies present; 717 files, 49,642,383 packed bytes. This is a content check, not publication.

Latest full CI results and commit identities are recorded in the PR descriptions. Green portable CI does not establish installed C2/C3 model, hardware, browser visual or live-provider acceptance.
