Restore missing runtime resources and align anchored Tier-0 cards (#170, #177)

3.2.7's release filter treated top-level directory names as source filenames, deleting lib/assets and lib/policies. This restores the 82 asset files and two policy JSONs byte-for-byte from historical commit 5d45d84a, and applies file-extension/debug-copy filtering only to top-level files. Runtime subdirectories and legitimate dotted/binary asset names survive; the seven reported client debug copies remain excluded.

Tier-0 anchor groups now include their own immediately preceding heading and stop before the next card's heading. Existing unanchored and body-only anchor paths keep their behavior. Tests compare all 13 titles, conclusions and group boundaries across four document layers, LF/CRLF, final newline absence and single-card input.

The machine-specific runtime smoke is replaced by temporary, actual Python subprocess/venv and local fake-peer fixtures. Attribution, timeout, candidate selection, worker protocol and vector shape assertions remain executable offline. Actual installed-model dependency/semantic-quality acceptance remains in the separate opt-in py-runtime-chain-live suite; the fixtures do not certify C3, model quality or CUDA.

Validation: full Node22.23.3 CI-parameter serial run initially 246 PASS / 0 FAIL / 0 TIMEOUT (133.1s), plus the subsequently added actual registered HTTP resource route test passes for all six light/dark slots. Generator --check --strict passes. npm 3.2.6 tarball independently contains 82/2 assets/policies; 3.2.7 contains 0/0, with the reported 3.2.7 sha1 verified. Source npm pack selects 82/2; actual release copy-stage output retains all 84 files byte-for-byte.

Full release dry-run still fails closed at the already-missing tools/reconcile-upstream.mjs. No gate was bypassed, and no #168 cleanup was imported. Copy/filter phase and npm file selection are verified independently; this is not a claim of a successful complete release build. No release, deployment or publishing occurred.

This branch starts at upstream main 131ca794b9f0d07f78b19bf6feee3312939854ed and is independent of open PR #206. Refs #170 and #177.
