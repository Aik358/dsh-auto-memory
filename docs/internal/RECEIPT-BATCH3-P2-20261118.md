# Batch 3 P2 Delivery Settings Receipt

Date: 2026-11-18  
Authority: `DECISIONS-BATCH3-P2-SCOPE-20261118.md` (SHA-256 `c93b2939f7845a4ef1436f71bb197f56948f93263f3f263f4af351c722fbe92e`).  
Status: implementation and repository-level verification complete. No commit, push, or version change.

## Scope And Result

Implemented one shared `Iter5PolicySettings` source, registered it in the iter5 generator, and mounted it through props in the classic SettingsPage template, generated v4 settings, and Frozen settings. The Frozen workbench now forwards `policySettings` when navigation selects Settings; its mount marker is reachable through `Legacy5Page -> Iter5Page -> Iter5Settings`.

The policy editor reads the `/config` response envelope directly, saves only `{ deliveryPolicy }`, sends only `policy|tier|isHuman|isFull` to the preview route, and uses `API.debug` only when the Diagnostics page opens. The diagnostics view projects only `logs.path`, `sizeText`, `lines`, and `exists`; it never requests or renders the diagnostic log body. The preview reports `partial` and all violations, including `unit-quotas-not-executed`.

The module page renders the dynamic 11-producer registry, two locked sources, and `recentLogs` with `logs` as its alias. View and representation remain separate controls. Legacy policy controls are disabled across the three settings implementations; dead historical keys are identified, `slimPlanChars` and `slimLedgerChars` have no editor, and the five ineffective keys remain read-only. The water fallback and placeholder are `25`; explicit `25,50` remains accepted.

The 13 prompt sections and two must markers are read from `/config` and shown as a read-only registry. P1 defines no write mapping for `modules.rules.selection.sections`; preview consumes only `modules.plan.selection.sections`. Adding checkboxes here would save values that do not affect delivery, so the UI states the limitation instead of presenting an inert editor.

## Changed Files

| File | P2 anchors | Current physical shape | Diff note |
|---|---|---|---|
| `lib/client.js` | API preview constant :3925; classic template :25540/:25944; v4 mount :22702; water fallback/placeholder :18417/:23005/:26250; settings slots :26932-26949 | CRLF; 27,105 lines / 3,020,831 bytes; public export surface remains 41 | `git diff` vs HEAD reports +985/-33; this includes P1 work already present before P2, so it is not a P2-only delta |
| `skins/iter5/policy-settings.js` | component :23; diagnostics API effect :149; module editor :523; Diagnostics :733; Compatibility :809; single-key adapter :879 | LF; 896 lines / 65,221 bytes | New shared implementation |
| `skins/iter5/surfaces.js` | host wrapper prop :420 | LF; 428 lines / 30,093 bytes | +1/-1 in worktree diff |
| `tools/build-iter5-skin.mjs` | props-aware SettingsPage slice :205-207; shared source input :521; Legacy5Page prop forwarding :560/:603 | LF; 960 lines / 84,861 bytes | +14/-9 in worktree diff; input includes the shared component |
| `skins/legacy/iter5-325.js.frozen` | Iter5Page forwarding :372; read-only field helper :1234; sole policy mount :1343; water fallback :1701 | LF; 2,545 lines / 358,868 bytes | +28/-11 in worktree diff |
| `skins/iter5/native-settings.css` | Policy settings styles :205-245 | LF; 258 lines / 33,448 bytes | +55 lines |
| `skins/iter5/settings-copy.js` | water threshold copy :71 | LF; 91 lines / 24,560 bytes | +1/-1 |
| `tests/smoke/smoke-test-delivery-settings-ui.mjs` | P2 mount, adapter, round-trip, invalid input, diagnostics, and legacy-readonly guards | LF; 582 lines / 33,403 bytes | New suite: 15 PASS / 0 FAIL |

Updated existing guard files: `smoke-test-frozen-mirror.mjs` (+3/-3), `smoke-test-settings-parity.mjs` (+2/-2), `smoke-test-iter5-skin.mjs` (+4/-1), `smoke-test-t1-prompt-sections.mjs` (+18/-10), `smoke-test-v5-p1-inject-throttle.mjs` (+4/-6), and `smoke-test-issue407-settings-expansion.mjs` (+3/-1). Their current EOLs are preserved: the iter5 skin test remains CRLF; the other listed tests are LF.

These tracked-file diff counts are against HEAD and include any earlier uncommitted Batch 3/P1 work. The workspace was already dirty when P2 continued; unrelated user changes were not reverted. P2 did not edit `lib/index.js` or `lib/injection/*`.

## Counters And EOL

`node tools/verify-docs.mjs` reports 22 tools, 87 routes, and 182 public config keys. Importing `lib/index.js` reports 41 exports. `lib/client.js` remains entirely CRLF (27,105 CRLF, zero bare LF); Frozen and all `skins/iter5` sources remain LF. `node tools/build-iter5-skin.mjs --check --strict` ends with:

```text
SYNC-OK: sources × generator == lib/client.js
iter5 bundle source is up to date
```

## Guard Map

The old skill's 43/177 count was stale. A current scan found 647 files in `tests/smoke`, 183 files matching the client-source reader search, and 19 files matching settings/policy/Frozen/style/water anchors. The directly relevant guard locks and disposition are:

| File:line | Locked invariant | Collision | Disposition |
|---|---|---|---|
| `tools/build-iter5-skin.mjs:205-207,521,560,603` | Unique SettingsPage slice, shared policy source included, generated Legacy5Page receives the descriptor | Yes: props signature and new source input | Generator anchors updated; strict build and generator-guard/idempotent suites pass |
| `skins/iter5/surfaces.js:420`; `lib/client.js:26932-26949` | Same host wrapper registered at three DSH slots; wrong plugin package returns null | Yes: wrapper now supplies the shared descriptor | Kept one host adapter; i335 and runtime plugin-detail negative path pass |
| `skins/legacy/iter5-325.js.frozen:372,1343` | Frozen settings page has exactly one shared mount and receives the host prop | Yes: actual page navigation previously dropped the prop | Added one page-to-settings prop forward; guard mutation removes it and goes red |
| `tests/smoke/smoke-test-settings-parity.mjs:23` | Classic source key set must be a subset of generated/frozen settings | Yes: `SettingsPage()` changed to `SettingsPage(props)` | Anchor updated; parity remains 110 keys across settings implementations |
| `tests/smoke/smoke-test-frozen-mirror.mjs:96,117,210` | Three signatures, set-key coverage, and shared set expressions | Yes: Settings signature changed; old expressions remain as disabled compatibility values | Signature anchor updated; 37 PASS / 0 FAIL; separate P2 guard verifies controls are disabled |
| `tests/smoke/smoke-test-iter5-skin.mjs:686` | LF-normalized classic source hash detects unreviewed hand-written drift | Yes: classic template gained policy mount and readonly treatment | Recomputed from this suite's exact stripping expression and re-pinned to `3604ce1d06dcfda5f30c437919ed4793af90a3b0b5689b1babace88e0c8e95ba` (1,554,818 chars); suite passes |
| `tests/smoke/smoke-test-t1-prompt-sections.mjs:90-131` | Server owns 13 section keys and two must markers; no client duplicate | Yes: old controls changed from editable to readonly | Rebased hook signature and replaced obsolete set/reset expectations with dynamic-list/read-only/negative assertions; 53 PASS / 0 FAIL |
| `tests/smoke/smoke-test-v5-p1-inject-throttle.mjs:49-79` | Cadence and water defaults agree with approved P1/R8 behavior | Yes: pre-P1 expectations were 20 and `25,50` | Updated expectations to full cadence 40 and water `'25'`; explicit `'25,50'` is retained by the dedicated water suite; 32 PASS / 0 FAIL |
| `tests/smoke/smoke-test-v5-p2-water-pct.mjs:153-163` | Three water controls and one shared copy source; parser and explicit threshold behavior | No structural collision; default string changed per R8 | Exact fallback, placeholder, copy, and mutant assertions added in P2 UI guard; 47 PASS / 0 FAIL |
| `tests/smoke/smoke-test-issue407-settings-expansion.mjs:5,20` | Isolated host wrapper execution, focus and expansion behavior | Yes: wrapper calls the new adapter factory | Added a fixture adapter stub; suite passes |
| `tests/smoke/smoke-test-a23-download-error-receipt.mjs:11-13,74,118`; `smoke-test-a25-procedure-correction-zero.mjs:11-13,120-129,208-210` | True factory execution and existing settings behavior across source/variants/Frozen | No behavior regression found | Both suites pass (31/0 and 115/0) |
| `tests/smoke/smoke-test-delivery-policy-v2.mjs:33-60,106-179`; `smoke-test-delivery-settings-backend.mjs:121-188` | Policy validation, unknown view/unit, negative/fractional numbers, hard allowance, alias, single-key disk save and deterministic preview | No backend changes in P2 | 22 PASS / 0 FAIL; backend 13 tests pass |
| `tests/smoke/smoke-test-l3-team.mjs:26,292-309`; `smoke-test-m9-capacity-default.mjs:21,47-50` | Shared team settings keys/CSS and capacity defaults | No collision | Pass; 0 failures in both suites |
| `tests/smoke/smoke-test-py-runtime-probe.mjs:32-33,115`; `smoke-test-r23-skin-center.mjs:56-57,103,121`; `smoke-test-r26-cross-layer.mjs:22-23,1037-1083` | Three settings copies, skin CSS safety, cross-layer client fingerprint | No relevant invariant changed | All three suites pass |
| `tests/smoke/smoke-test-s2-settings-panels.mjs:32`; `smoke-test-embed-incremental.mjs:29-30,154-185`; `smoke-test-issue52.mjs:27` | Settings panel surfaces, source extraction, update helper behavior | No collision | All pass |
| `tests/smoke/smoke-test-delivery-settings-ui.mjs:211-581` | P2 mount, one-key save, round-trip, invalid edits, separate view/representation, locked rows, alias, diagnostics, water, partial receipts, registry source, three slots, readonly legacy controls | New suite covers gaps parity cannot see | 15 PASS / 0 FAIL, with mutation negatives |

Other guards run because the shared CSS/host wrapper is adjacent to their locks: settings sync, generator idempotence/guard, client factory, skin slot dispatch, gap-rounds, Minervaowl CSS appearance/negative, skin-pluggable, and H1 shared-sheet dispatch. Each exited 0. `git diff --check` exited 0; Git emitted only the existing CRLF-normalization warning for `smoke-test-iter5-skin.mjs`.

## First Failures And Repairs

1. The first strict build reported `Embedded iter5 skin is stale`. A no-flag rebuild then stopped under R2 with orphan lines because the client bundle still held the old generated prompt controls and CSS. Those lines were compared with the changed policy/Frozen/CSS sources; only then was `--force` used to regenerate. The same guarded sequence followed later source edits (17, 12, 10, and 1 stale generated lines). Final strict check is green.
2. `smoke-test-frozen-mirror.mjs` and `smoke-test-settings-parity.mjs` initially failed because they anchored the obsolete `function SettingsPage()` signature. They now anchor `SettingsPage(props)` and retain their key/expression checks.
3. The first P2 UI harness run exposed that Frozen `Iter5Page` dropped `policySettings` before rendering its settings component. Added the Frozen props forward at line 372 and a removal mutant; it is now covered.
4. The generated v4 readonly note initially referenced `legacyNote` before the SettingsPage source declared it, causing `ReferenceError: legacyNote is not defined`. The source helper and generator output were aligned, and the true factory/UI tests pass.
5. Existing T1/v5 P1 tests still expected editable prompt section toggles, full cadence 20, and water default `'25,50'`. These expectations conflict with the approved P1/R8 interface. They were rewritten to test readonly server-sourced sections, cadence 40, default `'25'`, and explicit `'25,50'` support; their negative checks remain active.

## Open Scope Facts And Unverified Items

- P1 does not consume `modules.rules.selection.sections`; only `modules.plan.selection.sections` is connected to preview. The 13-section registry is therefore read-only in P2. Making those sections editable requires an explicit P1 API/policy mapping decision.
- `SettingsPage(props)` is the generator source template. A current search finds its definition and generator slice anchor but no direct call site in `lib/client.js`; the live settings slots use `Iter5HostSettings`. The approved classic template mount is present, but an independently reachable classic runtime face has not been proven here.
- Real DSH host screenshots and host a11y-tree inspection are **not verified**. Repository VM/factory and component-tree tests are not a substitute for that host check.
- The three tier-0 legacy controls are explicitly readonly because `legacyToPolicy()` preserves them in compatibility metadata but does not map them into Policy v2 execution.

