# V3 implementation validation

The shipped code integrates upstream `f2f7cc1cbf2d3caf2d2a99f425dfd2b5dd028218`
(3.2.8) and retains the unmerged safety work from draft PR #213 at
`72a146994fd6ed20f38b73715edf6cfbcafa6fef`. Private prototype files are excluded.

## Final automated checks

Node 22.23.3, Linux, the same suite selection and serial execution as
`.github/workflows/tests.yml`:

```sh
node tools/run-smoke.mjs --jobs=1 --timeout=90000 \
  --exclude=-live --exclude=m79-feature-v2 \
  --exclude=m710-fv2-emit --exclude=c4-fresh-install
```

Result: **260 passed / 2 failed / 0 timed out**, 262 executed suites.
`DSH_HOME` pointed at an isolated test directory; no installed DSH profile was
used. Both failed suites remain failures; no assertions or CI exclusions were
changed to hide them.

| Suite | Final result and cause | Comparison with current pristine main |
|---|---|---|
| `audit-g-207` | Fails: checkout has no `node_modules/@huggingface/transformers/dist` WASM assets; 30 assertions pass, 4 asset-dependent assertions fail | Same failure |
| `py-runtime-chain` | Fails: the developer Python venv is absent; earlier chain/probe assertions pass | Same failure |
| `doc-code-consistency` | Pass | Pass after upstream restored the specification |
| `issue111-docs-real-names` | Pass | Pass after upstream restored the handbook |
| `r26-cross-layer` | Pass | Pass after upstream restored its reference document |

The earlier 3.2.7 result was 243/3/0. After the 3.2.8 release but before its
documentation restoration, this implementation was 257/5/0. Neither is the
final baseline. The current pristine main's official runner fails at startup
because `tools/smoke-impact.mjs` is missing. This branch dynamically imports
that helper only when the optional impact flags are selected; normal CI can run.
`--impact` and `--impact-run` still require the missing upstream helper.
The five affected suites above were also run directly on untouched `a63495e`;
the following commits through `f2f7cc1` change only README/funding/sponsor assets.
The documentation suites pass again after that integration.
Their results are recorded in the artifacts.

Generator `--check` returns `SYNC-OK`; syntax and `git diff --check` pass.
Generator refusal and mutation checks pass (24 assertions), as does generator
idempotence (14 assertions). Field parity, exact navigation, negative route
mutations, scoped persistence, raw strings, normalization, additive migration,
CAS and error handling are covered by the executed smoke suites. The PLAN CAS
test now sets temporary memory roots rather than writing to the real home.

The independent read-only review reported no remaining blocker in field/entry
mapping, shared styles, route preservation or the settings identity fix. The
identity fix is commit `8e0f881dd6f9a2b6ade0169eb827541e5600d1b2`; subsequent
upstream integration retains that code. Final visual corrections remove the
duplicate classic Settings link and give the narrow floating settings form a
bounded scrolling field area with an independent save bar and bounded, scrollable
notices. Classic primary and
secondary navigation now have explicit desktop/mobile groups.

## Actual React / Chromium checks

`DSH_BROWSER_TOOLS` supplies React 18.3.1, ReactDOM and Playwright outside the
repository. Chromium 151.0.7922.173 runs the shipped `lib/client.js` factory and
real components. Fixture host APIs supply declared response shapes, controlled
failures and delayed completions; they are not included in production.

```sh
DSH_BROWSER_TOOLS=/path/to/browser-tools node tests/browser/settings-safety.mjs
```

**24 workflow groups pass, with zero browser exceptions.** Coverage includes:

- Raw comma/newline drafts, normal save and Cancel, save failure and retry,
  remount recovery, provider/model identity, masked secrets and transport fields.
- Directory picker generations, external lookup disorder, settings and semantic
  GET disorder, immediate model setup, broadcasts between simultaneous forms.
- Note and calendar pending operations across classic/current/frozen components,
  successful and failed completion, preserved newer input and confirmed discard.
  A controlled hook seam exercises the render-to-subscription gap explicitly.
- All 360 searchable source-backed entries using ArrowDown and Enter; Escape;
  current and original labels from Common in Chinese, English and Japanese;
  real nested prompt and model/provider/effort editors.
- All seven settings destinations at 1440×1000 and 390×844, mobile section
  selection, dependency gates, explicit units/consequences and dirty-only save.
  Mobile composite action rows retain one column and usable button widths.
- Actual four-primary navigation and retained secondary content for current,
  frozen and classic pages. Five real skin selections use their own production
  stylesheet path; fixture styles provide only the shared host base.
- Real host and classic workbench draft scope isolation through remount, Cancel,
  save and broadcast. Actual workbench and floating panel stay mounted for
  session/workspace A→B→A, success/failure of delayed saves and delayed old GETs;
  fixture remount counters do not change during those identity transitions.
  The fixture calls the real geometry clamp on synthetic viewport resize, since
  host `apply()` and its resize subscription are outside this fixture.
  The recovered-draft floating form keeps a visible first recording control and
  a scrolling field area above its save bar.

Screenshots are captured after shipped entrance animations settle and inspected
visually. This caught narrow welcome buttons and floating-form crowding that
horizontal-overflow checks alone missed. Screenshot values are fixture values,
including deliberate drafts, not recommended defaults or live host metrics.

## Inspectable evidence

- [Smoke output](../../artifacts/ui-v3-20261003/final-smoke-node22.log),
  [browser output](../../artifacts/ui-v3-20261003/browser.log),
  [structured browser result](../../artifacts/ui-v3-20261003/browser-results.json).
- [Original inventory reconciliation](../../artifacts/ui-v3-20261003/inventory-audit.json):
  359 approved entries retained, no changed approved defaults, one new upstream
  key (`localWasmPaths`), 360 entries / 154 host configuration keys in total.
- [Latest pristine-main checks](../../artifacts/ui-v3-20261003/baseline-latest-results.json).
- All seven section screenshots use `v3-{section}-{1440,390}.png` in the
  [artifact directory](../../artifacts/ui-v3-20261003).
  Representative [common desktop](../../artifacts/ui-v3-20261003/v3-common-1440.png),
  [record mobile](../../artifacts/ui-v3-20261003/v3-record-390.png),
  [appearance mobile](../../artifacts/ui-v3-20261003/v3-appearance-390.png).
- Actual dispatcher screenshots use `actual-{skin}-record-{1440,390}.png` for
  classic, legacy, instrument, editorial and water. The actual floating panel
  uses [desktop](../../artifacts/ui-v3-20261003/actual-classic-panel-record-1440.png)
  and [mobile](../../artifacts/ui-v3-20261003/actual-classic-panel-record-390.png).

## Limits

This is actual shipped-component coverage with fixture APIs, not an end-to-end
installed DSH acceptance. Live model requests/downloads, actual native directory
selection, OS reminders, remote team infrastructure and destructive maintenance
were not exercised against user data. Windows/Mica, physical mobile devices,
screen readers and other browser engines were not tested. CI-excluded live,
feature-v2 and fresh-install suites were not run in this final command. The two
environment failures and the optional missing impact helper remain unresolved.
