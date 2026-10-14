# Open issue remediation — 2026-10-14

Baseline: `Aik358/dsh-auto-memory@054942b54d15f46c4421c64d77c8de921e5042ab` (v3.3.3). Scope: all 22 open issues at inspection time. Code changes are a candidate for review; this document does not assert release or real-host acceptance.

| Issues | Candidate behavior / remaining condition |
|---|---|
| #356 | Increase floating panel background opacity to 96%; apply the same floor to translucent theme tokens. Actual macOS DSH acceptance remains external. |
| #357 | Add explicit original-report, public-source, negative-control and release-evidence requirements to the existing release checklist. Maintainer adoption remains a process decision. |
| #358 | Discover all `session_projcache*` storage domains, purge hash-named catalog files, keep domain-specific backups and diagnose zero matches. Host-side unavailable-child click rendering is outside this plugin; retain the issue for that acceptance item. |
| #359 | Retire only generated stale `SKILL.md`, remove only empty directories, preserve attached user resources. |
| #360 | Reset approval on controlled high-risk content changes, require reactivation, and gate every export. Keep the previous published version until its replacement is approved. |
| #361 | Facts commit under the same cross-process read/decision/write lock even within outer batches. This trades facts write coalescing for correctness; other snapshots still coalesce. |
| #362 | Feed reports final commit failures, preserves immediate fact errors and leaves failed deferred snapshots available for retry. |
| #363 | Migration admission is bound to a request entered before the window; global flights, marks and same-target queues confer no permission. |
| #364 | A missing supported-kind applier is retryable and prevents cursor advancement. No procedure/handoff approval gate is bypassed. Previously skipped remote events require an explicit server cursor/history replay; this candidate cannot reconstruct unavailable server history. |
| #365 | Feedback cursor advances only if the entire summary block is present in successfully delivered text, including partial-input batches. |
| #366 | Cancellation aborts pending fetch/body reads; requests have header/idle deadlines and retain hash validation. |
| #367 | All three action callbacks reject HTTP, business and JSON failures using one parser and preserve decision/reason codes. |
| #368 | Restore the versioned write-contract gate with a failing mutation control; refresh reviewed fingerprints, use writable temporary paths in issue48, and preserve frozen skin LF on Windows checkouts/archives. CI/release counts are not interchangeable. |
| #369 / #372 | All embedding config writers use one locked reread/atomic-write transaction, preserve malformed files, and initialize JS fields from the descriptor rather than the identity hash string. |
| #370 | A failed, truncated or invalid response body cannot acknowledge or dequeue a team send; business rejection remains a failure. |
| #371 | JS writer/corpus/evidence and Python agree: case folds only on Windows. Old derived sidecars/vector caches remain untouched; missing current identities rebuild from Markdown. Ambiguous old evidence is not relabeled. Case-sensitive filesystem isolation requires POSIX execution. |
| #373 | Sync and query both scopes present in the authorized snapshot; retain workspace/scope/version guards and reject foreign result IDs. |
| #374 | An incomplete source read preserves that entire prior L0 layer and reports failure; confirmed ENOENT can remove derived entries. |
| #375 | Use the issue's minimal alternative: automatic L0 maintenance returns `no-recall-consumer`, including persisted enabled configurations. Explicit `syncL0IndexPre` remains diagnostic only. Cold-start recall still uses the existing process pool; persistent vector consumption is not implemented or claimed. |
| #179 (Hold) | Preserve the maintainer's hold: workspace-key migration requires version timing, explicit ownership confirmation and rollback UX. No identity/bucket algorithm change is introduced. |
| #201 (Hold) | Preserve the maintainer's hold: token/chunk policy upgrade invalidates existing Python vectors and requires a scheduled rebuild and release notice. No vector policy version change is introduced. |

Keep held, partial and externally unverified items open. Tests run only against isolated fixtures; no personal memory or active DSH configuration is migrated by this candidate.
