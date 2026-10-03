# V3 UI implementation — review candidate

This branch applies the approved information architecture to the shipped client.
It is based on PR #213 at `72a146994fd6ed20f38b73715edf6cfbcafa6fef`.
Upstream main was verified at `131ca794b9f0d07f78b19bf6feee3312939854ed`
(package 3.2.7). PR #213 was still open and draft when implementation began.
Review the UI delta against that commit; the eventual main-based PR depends on
#213 and retains its persistence, migration, draft and asynchronous safety fixes.

## Implementation

- Four primary destinations: workbench, memory, tasks and settings. Existing tab
  IDs remain compatible. Calendar, skills, recall, external sources, workspace
  relationships, statistics and maintenance retain secondary destinations.
- Common settings home and six purpose-based sections. Fields retain their
  original controls, configuration keys, APIs, storage contracts and defaults.
- Vertical rows, progressive help/default/key disclosure, visible destructive
  consequences and budget units, mobile section selector, dirty-only save bar.
- The 359-entry source-backed index includes all 153 host configuration keys.
  Compatibility, semantic-file, layout and browser entries without individual
  form controls are explicitly identified in the directory, not given new
  fictional switches. Original labels remain searchable aliases.
- `skins/iter5/settings-source.js` is the single canonical control source used
  by the existing generator. Classic, frozen and variant settings delegate to
  one generated React root and one in-memory draft registry. No new runtime
  dependency or build system was introduced.
- Model/retrieval/semantic immediate actions keep their existing independent
  persistence boundaries. Backend implementation and defaults are unchanged.

## Validation status at first review candidate

Syntax and generator consistency passed. The existing real React 18 / Chromium
fixture-host suite passed its 17 safety groups after adapting section navigation.
The generated component smoke harness also passed. New V3 coverage is being
completed for all 359 search keys, all settings sections, four-entry routing and
1440 / 390 screenshots; this candidate is not a claim of final acceptance.

The initial full Node 22 check was 227 pass / 19 fail / 0 timeout. Three failures
match the verified baseline: missing `lib/policies`, developer Python venv and
six skin assets. The other failures were older static guards expecting copied
settings bodies or the previous settings layout. These guards now inspect the
shared shipped implementation and delegation seams; targeted reruns are being
completed before the final full check. No baseline failure is suppressed.

Browser checks use the actual shipped factory and React components with fixture
host APIs. They do not constitute full DSH, real model execution, Windows,
screen-reader or real-device acceptance. Private prototype inputs are not
included in this repository. No merge, release or deployment is part of this PR.
