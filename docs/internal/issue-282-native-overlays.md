# Legacy/classic native overlay verification

Baseline: upstream `39a882da593639d522b94298c30c1311a0432bc6` (v3.2.11).

The current notice/welcome and continuation components render in legacy/classic,
but their frozen stylesheet lacks the corresponding layout. The repair appends
`skins/iter5/legacy-native-overlays.css` to the generated legacy shared stylesheet.
It leaves the frozen page, palette, and three variant stylesheets intact.

## Browser component checks

`tools/qa/verify-native-overlays.mjs` loads the complete shipped client bundle,
React/ReactDOM 18.3.1, and fixture API responses in an isolated Chromium context.
Test exports are inserted in memory; product components and CSS are unchanged.

Install development-only dependencies in an isolated directory, then run from
the repository root (set `CHROME_PATH` if Chrome is installed elsewhere):

```powershell
npm install --prefix artifacts/issue282 --no-save --ignore-scripts react@18.3.1 react-dom@18.3.1 playwright-core
node tools/qa/verify-native-overlays.mjs --deps=artifacts/issue282
```

Chromium 154.0.8037.98: **100/100 passed** (five skins × two themes × two
viewports × success/confirmation/progress/notice/welcome). Viewports: 1280×900
and 390×844. Assertions cover computed fixed positioning, flex headers, theme
boundaries, surface/button rectangles, readable backgrounds, close/reopen, and
agree/reject request payloads. Legacy/classic also cover long scrollable notices
and success dismissal across polling followed by a new success identity.

Before rebuilding, run the same script with `--negative`: the original bundle
produces **40 legacy/classic failures and 60 passing variant controls**. This
negative mode is specifically for the original baseline, not the repaired bundle.

## Isolated DSH host checks

`tools/qa/verify-native-overlays-host.mjs` runs against an isolated `dsh web`
profile with this checkout registered in `dsh.profile.bundles`. Set DSH_HOME,
USERPROFILE and HOME to a fresh temporary directory before starting the host.
Set `ISSUE282_HOST_URL` to that host's authenticated localhost URL, then run:

```powershell
node tools/qa/verify-native-overlays-host.mjs --deps=artifacts/issue282
```

**40/40 passed**, no page errors: legacy/classic × light/dark × desktop/narrow
× all five states, using the production ModuleLoader and shell.overlay slots.
Plugin APIs are intercepted with fixture responses; unrelated startup dialogs
are cleared through an in-memory test export. No models, notifications or real
memory/session data are used. This verifies host layout/interaction integration;
it does not assert live continuation execution or human visual acceptance.

Component matrix screenshots: [legacy desktop](../screenshots/issue-282/legacy-desktop.png) and
[classic narrow dark](../screenshots/issue-282/classic-narrow-dark.png).

## Automated checks and inherited gates

Entry syntax, core smoke, water-window, 17 focused skin/generator/continuation/API
suites, generator `--check`, and npm package dry run pass. The package includes
the compatibility source and excludes local artifacts.

Two validation-only baseline corrections preserve existing assertions:

- The original baseline's classic fingerprint was already `8ccf60c2…`, rather
  than the stale `bd574416…` lock. Recomputing with the existing test's exact
  stripping pipeline confirms baseline and repaired classic bytes are identical.
- A1's mutation fixture hard-coded CRLF anchors and failed on Linux before its
  negative control ran. Normalize line endings and require exactly one anchor;
  the existing positive and mutation-negative assertions remain enabled.

The repair has no functional dependency on #283/#284. It shares the skin
generator and generated client with other UI fixes, so regeneration should use
their combined canonical sources when integrating them.

## 2026-10-08 combined-client fixture correction

The six narrow variant confirmation failures were initial-visibility assertions,
not unreachable actions. With the complete combined client at `ebfc6416`, the
390×844 card is bounded at y=16–828 and scrolls internally. The agree button
initially ends at y=864.09; scrolling 37px exposes its complete rectangle at
y=781.30–827.09, with a successful pointer hit and decision request. No CSS,
component structure, generated bundle or fingerprint change is needed.

The fixture now supplies a stable, valid success timestamp, and a new identity
for layout reopens. It still asserts that the same dismissed success stays
closed across polling; clients with persistent consumption additionally prove
closure across remount before a new identity appears. Host fixtures also use
valid timestamps. The tested surfaces and handlers retain their production
module scope; only test exports are inserted into the complete client in memory.

Action checks require real wheel scrolling and Tab navigation, complete button
rectangles inside both the viewport and card, minimum height, and pointer
hit-testing. Long notice and reason strings remain intact. `--initial-geometry`
retains the former assertion for comparison: the combined client still produces
exactly six failures. A client mutation replacing `overflow:auto` with
`overflow:clip` is rejected by the long-content regression.

Current verification uses isolated Chromium **153.0.8010.12**, React 18.3.1:

- Independent PR client: 100/100 states plus 40 long-notice/skin-switch checks.
- Complete combined client: 100/100 states plus 100 long-notice, long-reason
  agree/reject/close-reopen and skin-switch checks; no page errors.
- Nine focused smoke suites pass. Combined hard-confirm, success-lifecycle,
  priority and polling-order fixtures pass in a separate local source copy.
- Canonical generator `--check` reports `SYNC-OK`; runtime and fingerprint
  files remain byte-for-byte unchanged.

To check another complete combined client without modifying this PR, run:

```powershell
node tools/qa/verify-native-overlays.mjs --deps=<dependency-directory> --client=<complete-client.js> --output=<evidence-directory> --require-reason --require-consumption
```

Set DSH_HOME, HOME and USERPROFILE to an isolated directory and CHROME_PATH to
the test browser. The fixture blocks unexpected browser network requests.
The installed Chrome 154 rejected isolated debugging startup in this run;
the earlier 154 component and 40-case host results above are historical evidence.
This follow-up does not revalidate a DSH host, real continuation execution or
human acceptance.
