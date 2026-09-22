# Repository audit — 2026-09-22

Baseline: `Aik358/dsh-auto-memory` v3.1.3, commit `9e14f32f28f86293b64d7a9a953eb81cf62ba11c`.
Exact archive verification: reconstructed Git tree `41409f006c01e13991adda65ca59d2509253838c` matches upstream.

## Scope and method

- Inventory of all 581 tracked files; static analysis of all 244 original JavaScript/module files, including 75 non-test files. All five Python runtime files parsed successfully.
- Whole-repository import/reachability and unused-binding scan using the TypeScript compiler API. Diagnostics were reviewed, not treated as proof that every unused name should be deleted.
- Deep behavioral checks of filesystem probes, subagent session selection, replay, host/browser teardown, React hook order, model downloads and atomic publication.
- All 168 original smoke suites considered. Two explicitly live/network suites were skipped; the remaining 166 ran with a separate temporary HOME/USERPROFILE/DSH_HOME per suite. Three new suites add 27 regression checks.
- Private host/browser/download functions are exposed only in temporary copies or VM test contexts. Production exports and package metadata are unchanged.
- This is not a claim of exhaustive manual review of every line, or proof that no bugs remain. No real Windows, DSH/React browser, external model download or real model inference acceptance run was performed.

## Confirmed fixes

| ID | Area | Reproduced failure | Fix |
|---|---|---|---|
| A1 | syncDirProbe | Missing unlink binding makes writable directories appear unwritable and leaves probe files. Timestamp-based names also overwrite a pre-existing matching file. | Import unlink; use random UUID plus exclusive creation. Test success, concurrent probes, sentinel preservation and missing directories. |
| A2 | subagent GC | Missing readdirSync is swallowed, so newer session names are ignored. An old v3 file can make an actively updated v4 session look recyclable. Plain JSONL is not decoded. | Use the existing asynchronous readdir binding, recognize legacy/future JSONL names, exclude backup/corrupt files, select latest mtime, decode plaintext and zstd separately. |
| A3 | shadow replay | replayFromFile calls undefined replay instead of imported replayCore. | Delegate to replayCore; compare real wrapper output to the pure core. |
| A4 | graph overflow | More than 14 cards in a lane evaluate an undefined zh variable and throw. | Resolve locale inside wbLayout; test Chinese and English overflow nodes. |
| A5 | Kanban drawer | useCardFull runs only when the drawer is open, changing the hook sequence between renders. | Call the hook unconditionally; verify closed/open/closed hook sequence in a deterministic React harness. |
| A6 | host disposal | The reference-tail prompt registration has a disposer but is absent from the teardown collection. | Include disposeTailSurface in the real disposal list. |
| A7 | browser disposal | Notice/away timers, delayed semantic detection, visibility listener, locale subscription and registered surfaces outlive the plugin. | Register cleanup with ctx.effect. Harness verifies timers, visibility listener and all seven registered surfaces are released. In-flight HTTP request cancellation is not claimed. |
| A8 | download integrity | verifyArtifact exists but is never called; a truncated 100 MiB model and invalid tokenizer JSON can reach ready. SHA path also lacks createReadStream. | Verify actual temporary files before publication, enforce declared model bytes, nonempty tokenizer files and parseable JSON; import createReadStream. No invented model SHA256: absent manifest hash remains explicitly size-only. |
| A9 | atomic publication | writeFileSyncSafe removes the previous target before rename, losing it when promotion fails. | Reuse bounded retryRename without a delete-first fallback. Failed publication preserves the predecessor. |
| A10 | HTTP resume | A 206 response with the wrong Content-Range can be appended to a saved prefix. | Reject absent/mismatched ranges, discard corrupt temporary state, preserve the formal file. Cancel ignored-Range response bodies before retrying. |

## Dead code cleanup

43 declarations removed: 32 unused import bindings, six unreferenced private functions, and five private constants. Relative-module evaluation is retained when removing the last import binding. No exported API or entire module was removed.

| File | Removed declarations |
|---|---|
| `lib/activation-host.js` | `buildReferenceTailPacketPre`, `TAIL_MARKER_LINE_V1`, `createActivationInboxPre`, `loadCorpusSnapshot`, `setMiv`, `mivFor` |
| `lib/activation-inbox-state.js` | `ACTIVATION_POLICY_VERSION`, `DELIVERY_STATES_V1`, `OFFER_REASONS` |
| `lib/client.js` | `wbCleanTitle`, `graphKeywords` |
| `lib/context-host.js` | `loadCorpusSnapshot` |
| `lib/fact-store.js` | `factFlatPre` |
| `lib/index.js` | `deriveArmsHealthPre`, `decodeZstdFrames`, `findOfficialContextWindowPre`, `toMutationProjectionPre`, `WB_MARKERS_V1`, `WB_CONTRACT_VERSION`, `WB_SIDECAR_VERSION`, `collectAnchorIdsPre`, `normalizeRelPathPre`, `normalizeTitlePre`, `splitSectionsPre`, `ledgerDateOfPre`, `WB_KANBAN_LANES_V1`, `REFERENCE_SECTION_GUIDE_V1`, `verifyMemoryRecord`, `memoryCoverage` |
| `lib/memory-hub.js` | `createHash` |
| `lib/memory-writer.js` | `MARKER_OPEN` |
| `lib/procedure-store.js` | `defaultProcedureId` |
| `lib/semantic-decide.js` | `WS_RUN` |
| `lib/semantic-js.js` | `fileURLToPath`, `homedir` |
| `lib/shadow-host.js` | `writeFileSync`, `existsSync`, `homedir`, `createHash`, `loadCorpusSnapshot`, `sha256Hex`, `first32` |
| `lib/shadow-retrieval.js` | `CJK_RE` |

### Deliberately retained

- `verifyArtifact`, `replayCore`, `disposeTailSurface` and timer handles were not deleted merely because they were unused: they exposed missing wiring and now have consumers.
- `currentRunningInfo` remains because the existing continue-chain suite explicitly extracts and tests that compatibility helper. React hook calls and public signatures were not removed on the basis of unused return values or parameters.
- `acceptance.js`, `ledger-criteria.js`, `rerank-host.js` and `state-commit.js` have no path from the two package runtime entry points in the scanned import graph, but have explicit test consumers. They are not classified as safe-to-delete whole modules.
- Remaining unused-name diagnostics are a triage list, not 51 confirmed bugs. `_subagents` is injected by apply; similar dynamic properties and JSDoc type names are not undefined-runtime-name bugs.

## Validation

| Check | Original baseline | Patched |
|---|---|---|
| Existing 168 suites (including two explicit skips; 90 s for long auto-continue suite) | 145 pass / 21 fail / 2 skip | 145 pass / 21 fail / 2 skip |
| New runtime suite | 4 pass / 9 fail | 13 pass / 0 fail |
| New browser suite | 0 pass / 5 fail | 5 pass / 0 fail |
| New download suite | 2 pass / 7 fail | 9 pass / 0 fail |
| All 171 suites after patch | — | 148 pass / 21 fail / 2 skip; no timeouts |
| JavaScript syntax (75 non-test files) | — | 75 pass |
| Python runtime AST parsing | — | 5 pass |
| Python feature unit test | Blocked by missing m7_activation_features_pre_v2 module in published tree | Unchanged; not reported as passing |

The first baseline used 20 s per suite and timed out auto-continue. At 90 s both original and patched versions finish successfully in approximately 30 s; this is a test-budget correction, not a claimed performance fix.
The v3.1.3 GC guard previously checked a source-string fragment and passed despite the swallowed ReferenceError. That one assertion now runs the actual scanner against an isolated future-format session file. Other original tests were not weakened or removed.

### Existing failure list (unchanged)

- `smoke-test-board-index-atomic-pre.mjs`
- `smoke-test-c4-fresh-install-pre.mjs`
- `smoke-test-graph-mode-pre.mjs`
- `smoke-test-i5-status-filter-pre.mjs`
- `smoke-test-issue110-hub-io-pre.mjs`
- `smoke-test-issue111-docs-real-names-pre.mjs`
- `smoke-test-m3b1-pre.mjs`
- `smoke-test-m53-pre.mjs`
- `smoke-test-m63-pre.mjs`
- `smoke-test-m710-fv2-emit-pre.mjs`
- `smoke-test-m72-pre.mjs`
- `smoke-test-m79-feature-v2-pre.mjs`
- `smoke-test-p4-l0-response-pre.mjs`
- `smoke-test-p9-rules-lifecycle-pre.mjs`
- `smoke-test-p9d-recent-evidence-ts-pre.mjs`
- `smoke-test-t0-3-budget-ledger-pre.mjs`
- `smoke-test-t0-8-mutation-gate-pre.mjs`
- `smoke-test-t7bcd-pre.mjs`
- `smoke-test-t7e-toolname-pre.mjs`
- `smoke-test-three-layer-pre.mjs`
- `smoke-test-water-window-pre.mjs`

These failures include published/pre-name drift, absent release tooling, external sidecar/model fixtures and an LF/CRLF fixture mismatch. PR #128 addresses the existing smoke-runner/CI and a set of those test defects. This patch does not pretend that the repository-wide suite is green.

## Outstanding risks and scope exclusions

1. PR #129 already owns migration path rewriting and backup-name allocation. This branch does not modify migrate-pack.js and does not duplicate those commits.
2. Migration userFiles (including CALENDAR.md) remain outside packChecksumPre(files). Old-pack compatibility and a versioned checksum scope need an explicit follow-up; no format change is hidden in this patch.
3. A model hash is not frozen in MODEL_SPEC. Exact file size, JSON parsing and a reusable SHA256 verification path do not authenticate the identity of a model when no trusted digest is supplied.
4. Restart-time model/config readiness still uses existence-based probes in parts of python-setup. Download-time validation added here does not amount to full revalidation of previously installed/custom model sets.
5. Runtime state-commit/rerank/acceptance integration and broader cancellation semantics require design-level decisions. Test-only helpers should not be promoted into hot paths just to make a reachability report look clean.
6. Changes must be ported to the maintainer's actual pre/build source of truth, otherwise a later generated release may overwrite the fixes. This audit verifies the public release tree, not an inaccessible private development tree.

## Reproduce the targeted checks

```sh
node tests/smoke/smoke-test-audit-runtime-pre.mjs
node tests/smoke/smoke-test-audit-client-pre.mjs
node tests/smoke/smoke-test-audit-download-integrity-pre.mjs
node tests/smoke/smoke-test-v313-guide-sessname-pre.mjs
node tests/smoke/smoke-test-continue-chain-pre.mjs
node tests/smoke/smoke-test-issue103-105-portfix-pre.mjs
```

Only temporary test directories and mocked fetch responses are used by the new regressions. Sparse model files prove byte-count and publication behavior, not ONNX executability.
