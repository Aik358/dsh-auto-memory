# Native status-dialog geometry — issue #283

Verified 2026-10-08 on upstream `39a882da593639d522b94298c30c1311a0432bc6`,
Windows, Node 24.15.0, Chrome 154.0.8037.98, React/ReactDOM 18.3.1.

The production `DialogHost` status card has `data-native-dialog` but no
`data-iter5` ancestor. Its width must include its padding and border.
The fix adds `box-sizing:border-box` to the existing native-dialog rule in
`skins/iter5/native-secondary.css` and regenerates `lib/client.js`.
The generated bundle differs from the baseline only by that declaration.

## Browser component verification

`tests/browser/status-dialog-box-sizing.mjs` loads the complete production
bundle through its module loader, exposing only a mount seam in memory. It mounts
the real `Iter5Surface` / `DialogHost`, uses inert local API fixtures, blocks
external requests, and launches a fresh Chrome profile with isolated home paths.
No component or product CSS is replaced for the passing measurements.

All instrument/editorial/water × light/dark × 1280×900/390×844 combinations
were measured with `getComputedStyle` and `getBoundingClientRect` for both
integrated and missing-runtime/model states (24 renders). All fixed widths,
centering, visible actions, close/reopen and snooze-close checks passed without
page errors. Reverting only box-sizing to content-box reproduced the inflated
width in all 12 combinations. The baseline bundle independently reproduced
the same inflation for all 24 renders.

| Viewport | Before outer width / left..right | After outer width / left..right |
|---|---|---|
| 1280×900 | 690px / 320..1010px | 640px / 320..960px |
| 390×844 | 396px / 16..412px | 358px / 16..374px |

![Desktop before](../screenshots/issue-283/desktop-before.png)
![Desktop after](../screenshots/issue-283/desktop-after.png)
![390px dark water before](../screenshots/issue-283/narrow-before.png)
![390px dark water after](../screenshots/issue-283/narrow-after.png)

Reproduce from the repository root:

```powershell
npm install --prefix .tmp-issue283 --no-save react@18.3.1 react-dom@18.3.1 playwright-core
node tests/browser/status-dialog-box-sizing.mjs
```

Set `CHROME_PATH` for another installed Chromium. To reproduce the baseline,
set `ISSUE283_CLIENT` to the baseline bundle and add `--expect-overflow`.
Measurements and screenshots are written under ignored `.tmp-issue283/`.

## Automated checks and limits

- Entry syntax checks and `node tools/build-iter5-skin.mjs --check`: PASS.
- `node tools/run-smoke.mjs --jobs=1 --filter=skin`: 9 PASS, 1 FAIL.
- The failed `smoke-test-iter5-skin.mjs` classic fingerprint is already stale
  on the original baseline: actual `8ccf60c25db7f2a64e70a98c4b13dd953c0bd1961ce5ac20385e21066a6d5bf7`,
  expected `bd574416f6fa6a1f2483c7751472482944d6db60b4159570b3444498df887df8`.
  Both values are unchanged by this generated-CSS-only fix; the assertion is retained.
- This is real-browser component validation. Live DSH host validation and human
  acceptance have not been performed; no merge, release or deployment is claimed.
