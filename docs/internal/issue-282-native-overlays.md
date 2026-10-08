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
