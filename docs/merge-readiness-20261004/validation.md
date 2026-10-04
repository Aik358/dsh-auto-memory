# PR #210: integrate main and prepare formal review

Baseline: merge upstream f2f7cc1cbf2d3caf2d2a99f425dfd2b5dd028218 into a610c26c3c00ea3ac6f2dbc76dd68bd46ffe5146 without rebasing or force-pushing.

## Resolution decisions

- Two conflicted files. Preserve the PR's stronger cross-process counter reservations, permanent source latches, uncertain-create pending state and archive delta transactions; sequence reservations cannot be recycled. These replace main's same-process queue implementations of the same issue207 operations.
- Keep main's other automatic integrations, including PLAN CAS, team wiring, pending user memory, filtering, localWasmPaths and Python uninstall. Route count becomes 71; update the existing E3 fingerprint with its exact normalization and document the merge reason.
- G207 wiring now exercises real MemoryEngine allocations across independent instances, restart latches, archive peer retention/deletion and corrupt-state refusal. Queue utility tests and actual host-route checks remain. Retain the portable real-filesystem WASM fixture from #215; no WASM execution/model acceptance is claimed.
- Use the already verified #215 delayed import for the optional impact helper absent from main, so ordinary full smoke can start. Explicit impact mode remains strict.
- Preserve the frozen source's required LF with a narrow .gitattributes entry; no behavior assertion was relaxed. Replace P3's fragile 300-character source window with a complete devTreeRoot function-body check while retaining uniqueness and real path positive/negative checks.

## Evidence

- Node syntax, generator --check --strict SYNC-OK, diff check pass.
- Targeted G207: 34/0; issue207 durable state: 11/0 with one Windows file-symlink-permission SKIP; R26: 23/0.
- First isolated Windows full CI-parameter run: 261 PASS / 2 FAIL / 0 TIMEOUT (263 suites). The failures were frozen CRLF and P3's truncated source window. After correction, h43: 14/0 with both mutation controls intact; P3: 20/0. Every other suite passed in that run.
- Final remote complete CI and exact head bindings are recorded in the PR description and local artifacts/pr-readiness-20261004. Do not infer a final full-run PASS from the local split verification alone.
- Original user workspace tracked changes remain separate. This merge does not establish installed-model, physical device, live provider or installed DSH acceptance. Ready for review is a request for human review.

## PLAN migration correction (2026-10-05)

The independent delegate reproduced a main integration interaction: a real PLAN writer waiting on the native file lock could be acknowledged after migration while its new revision existed only in the inactive old root. Register admitted PLAN writes before their first await; root migration drains those writes before copying and rejects newly arriving PLAN writes until config publication. The original native lock and CAS remain. Recheck memoryRoot and projectMemoryDir inside the lock, and release the flight on every completion path.

Actual MemoryEngine/native-lock migration regression: 4 PASS. Existing PLAN CAS, two-process CAS and plan seed regressions pass; R26 23/0 with the exact updated source fingerprint. This coordinates participating operations on the same engine; it does not add a shared configuration transaction across separate engines/processes. Final complete CI evidence is recorded in the PR description and artifacts after the correction is pushed.
