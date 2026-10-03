# Shipped V3 UI implementation

This branch applies the approved information architecture to the shipped client.
It is based on PR #213 at `72a146994fd6ed20f38b73715edf6cfbcafa6fef`.
Upstream main was rechecked during implementation and advanced to
`04f9ae365ff0cd2a53818a41c16867c384c9f77e` (3.2.8). This branch integrates that
commit. PR #213 remains open and draft; its stricter settings persistence,
additive migration, scoped draft and asynchronous safety behavior is retained.
Review the final delta against current main. The PR includes the remaining #213
changes until that dependent PR is merged; they must not be discarded as duplicate
fixes when resolving the overlap with the 3.2.8 save serializer.

## Implementation

- Four primary destinations: workbench, memory, tasks and settings. Existing tab
  IDs remain compatible. Calendar, skills, recall, external sources, workspace
  relationships, statistics and maintenance retain secondary destinations.
- Common settings home and six purpose-based sections. Fields retain their
  original controls, configuration keys, APIs, storage contracts and defaults.
- Vertical rows, progressive help/default/key disclosure, visible destructive
  consequences and budget units, mobile section selector, dirty-only save bar.
- The original 359-entry index is preserved. The new main adds `localWasmPaths`,
  bringing the index to 360 entries and all 154 host configuration keys.
  Compatibility, semantic-file, layout and browser entries without individual
  form controls are explicitly identified in the directory, not given new
  fictional switches. Original labels remain searchable aliases.
- `skins/iter5/settings-source.js` is the single canonical control source used
  by the existing generator. Classic, frozen and variant settings delegate to
  one generated React root and one in-memory draft registry. No new runtime
  dependency or build system was introduced.
- Model/retrieval/semantic immediate actions keep their existing independent
  persistence boundaries. Backend implementation and defaults are unchanged.

## Validation

The final Node 22 CI-equivalent smoke command completed with **257 pass / 5 fail /
0 timeout**. Those five failures reproduce on pristine 3.2.8: missing local WASM
package assets, developer Python venv, and three tests reading documentation that
upstream removed. The pristine main also cannot start its official runner because
`smoke-impact.mjs` is missing. The branch loads that optional helper only for
`--impact` / `--impact-run`, allowing normal CI checks to execute. Those optional
flags still require the upstream helper. A PLAN CAS test now uses temporary
memory roots; its former real-home write failed in this sandbox.

Generator consistency, R2 refusal, idempotence, syntax, navigation mutations,
field parity, normalization and existing safety checks pass. Browser evidence
uses the shipped factory and React 18 components with declared fixture host APIs.
See [TEST_RESULTS.md](TEST_RESULTS.md) for the final browser result, screenshots,
commands, failure evidence and untested environments. See
[MIGRATION.md](MIGRATION.md) for every approved key and all 73 original entry/flow
mappings plus the new upstream operation.

Private prototype inputs are not included. No merge, release, deployment or
change to an installed DSH profile is part of this PR.
