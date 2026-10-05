# Follow-up group 5: settings response ownership

Base 3a5d6cbbccee2c09523cd11edcb3d7881d91d98d. Complete shipped-client factory tests reproduce both variants' stale busy subscription, a pre-save C0 GET overwriting saved C1, and reversed GET completion. Baseline: 2 PASS / 6 FAIL (unsaved-draft merge already worked). Corrected: 8 PASS / 0 FAIL.

Both generated Iter5 settings variants now use initialized refs for synchronous busy state and configuration generation. Starting/finishing a save invalidates outstanding GETs, including the initial request. Each config read captures its request generation; only the latest request for a live matching identity can update base/UI or initial-load errors. The broadcast subscription checks the busy ref rather than the hoisted undefined busy variable. Existing unsaved-draft merging is retained. Save state includes the immediate engine-mode save path through the same setBusy wrapper.

The source of the current variant is tools/build-iter5-skin.mjs (including d2Subscribe); the legacy variant is skins/legacy/iter5-325.js.frozen. lib/client.js is regenerated from both. --check --strict and the existing Iter5 skin suite pass. The test uses real component handlers, hooks and saveConfigPatch/controller broadcasts from the entire client factory, with deferred HTTP responses; it is not a browser DOM acceptance claim. No external service was called.
