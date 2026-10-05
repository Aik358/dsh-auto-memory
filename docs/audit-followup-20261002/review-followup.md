# Independent review follow-up after 54eede1

Four blocking findings were reproduced and repaired. Groups 1/4, migration review corrections, note ownership and deletion changes remain intact.

## Settings initialization and failed broadcasts

A remount with retained draft has an initial GET pending. A broadcast response arriving first previously replaced config with no recovered draft or prompt-section metadata; a failed broadcast made the later successful initial GET stale and left the component loading. Both current and legacy settings reproduce the defects (VM 0/4). Requests now capture a save epoch and monotonically increasing read sequence separately; the most recent successful applied read fences older responses, while a failed newer read does not invalidate an older in-flight success. Saves still invalidate all pre-save reads. Either successful path runs the same initialization/draft/metadata application, once per mount. Unsaved draft merging and saved-base protection remain.

Current and frozen sources plus generator and generated client are synchronized. Corrected VM 4/0, original request/save regression 8/0. Optional official React 19.2.0 and react-test-renderer 19.2.0 were installed only in /tmp/dam-react-review, with cache in /tmp. Whole-factory official hooks/act tests reproduce 54eede1 at 2/4 and pass corrected at 6/0, including failed broadcast fallback and save epoch. tests/manual/settings-real-react.mjs documents the pinned setup and requires DAM_REACT_ROOT; it cannot silently skip. No project dependency was added. This is official renderer/hook acceptance with controlled DOM and HTTP boundaries, not a browser or desktop test. Existing key/deprecation warnings are retained in the raw log; no renderer/hook failure is concealed.

## Case-sensitive procedure scope

Lowercase evidence workspace coordinates cannot recover a case-preserving POSIX procedure identity. Procedure feeding now captures procedureWorkspaceRef from the original bound paths before awaiting persistence. Generic appended events resolve their own session's captured runtime binding, never a global workspace or a hash rebuilt from the lowercase evidence key. Ambiguous/unbound identities fail closed for workspace procedures; global procedures remain eligible. Success consolidation captures its independently resolved bound paths before append. The existing lowercase durable evidence schema is unchanged.

Actual document/sidecar, tool-result read, ingest cite and substantive consolidation success tests use distinct Project/project owners with deliberately shared sourceMemoryIds. 54eede1 fails the first original-owner read assertion; corrected read/cite/success each feed only the correct local procedure, while the global procedure receives both owners' events. This preserves scope and negative-attribution repairs.

## Legacy session diversity

Two immutable fixtures were exported from the complete 54eede1 procedure store before this change: raw short A/B, and old 48-character truncated A/B. Restore/add normalize known short IDs (<24 characters, shorter than the oldest host truncation limit) to the same privacy hash as new evidence. Existing hashes converge with raw short aliases. Unknown prefixes of >=24 characters are retained in _legacySessions but do not count as independently proven sessions. Missing identity sets cannot substantiate a numeric diversity count; the old count is retained separately as _legacySessionCount. sessionIdentityVersion=2 marks normalized snapshots; schemaVersion=1 remains readable.

Unit fixture tests go 0/2 -> 2/0. Actual tool-read and consolidation-success tests with the old fixtures also go 0/2 -> 2/0, reload the newly written procedure snapshot, and then prove that genuinely new C increases diversity exactly once. Old A cannot fabricate a third identity or cross the promotion gate. Historical misattributed counters and stages cannot be fully reconstructed from lossy old snapshots; this migration does not claim to reverse old promotions, infer owners of unknown prefixes, or rebuild all historical statistics. Retained prefixes/counts are inspection data, not new proof of diversity.

## Strict ledger reads for deduplication

EvidenceEventStore.loadEvents retains tolerant display/query behavior by default. Its strict mode fails on directory/read errors and discards any partial event list; only an actually missing root directory is empty. persistEvidence uses strict reads before adding any event or procedure counter. Success selection also fails closed on strict read failure. The host returns an explicit evidence-ledger-unreadable result and records a diagnostic. Existing malformed-line parsing/skip policy is unchanged; no recovery of malformed historical records is claimed.

Directory EACCES, readable-prefix then EIO, and single-file EACCES tests create real durable bytes and reload a real procedure snapshot/new context host. Before correction 0/3; after 3/0. Rejected operations leave both ledger bytes and counters unchanged. Tests inject the node filesystem boundary with syncBuiltinESMExports, not a fake ledger result.

## Testing terminology and remaining limits

Complete-client.mjs defaults to a custom VM React/hooks/DOM harness; loading the whole factory alone does not make that a real renderer. The added manual test supplies official React and official renderer. Note form tests provide controlled props; parent snapshot-to-form wiring is source-reviewed. Host route tests invoke actual registered handlers with simulated req/res, not socket HTTP. Observation fencing logically discards results; it does not abort already-started rank/model execution. Evidence ledger and procedure snapshots still are not one cross-file atomic transaction.
