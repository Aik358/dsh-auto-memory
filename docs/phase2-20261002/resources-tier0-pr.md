Draft PR body for `fix/resources-tier0-20261002`.

Restore runtime resources and anchored Tier-0 boundaries (#170, #177)

This branch is independent of PR #206 and starts at upstream main `131ca794b9f0d07f78b19bf6feee3312939854ed`. The final product/semantic-fixture commit is `394253233708c1b4066e12fa4f44dbb725d69d03`; final diagnostic-fixture commit is `ac0be33d22bad8d0f94e38f4366cc81075e599c5`.

3.2.7's release filter treated top-level directory names as source filenames and removed lib/assets and lib/policies. Restore 82 asset files and two policy JSONs byte-for-byte from historical commit 5d45d84a, and apply extension/debug-copy filtering only to top-level files. Legitimate runtime directories and dotted/binary asset names survive; the seven reported client debug copies remain excluded. PR #168 cleanup was not imported.

Tier-0 standalone anchor groups include their immediately preceding heading and stop before the next card's heading. Inline anchors retain their own boundaries, including multiple inline markers on one line and mixed inputs. Existing unanchored and body-only anchor behavior remains covered. The regression compares all 13 titles, conclusions and groups across four document layers, LF/CRLF and missing final newline.

Resource recovery, inline-anchor and interpreter-deduplication changes passed independent review. Actual registered HTTP GET tests cover all six light/dark slots. The machine-specific Python smoke now exercises real temporary Python subprocess/venv and local fake-peer fixtures; installed-model and semantic-quality acceptance remains in the separate opt-in py-runtime-chain-live suite. These fixtures do not certify C3, model quality, CUDA or the DSH desktop.

The semantic host recovery fixture published control JSON with a naked overwrite while the child polled it. A 25ms empty-file window mechanically reproduces the recovery-scores assertion failure with Unexpected end of JSON input. Publish complete staging files atomically instead; the regression deliberately leaves an incomplete staging file visible for 25ms while the reader continues seeing the previous complete control document. Recovery, scores and cooldown assertions remain intact and now include failure diagnostics. This fixture fix passed independent review; it does not modify the semantic engine. Historical remote failure records and limits of attribution remain in the final validation record.

Final test CI [36993388904](https://github.com/Minervaowl7/dsh-auto-memory/actions/runs/36993388904): **247 PASS / 0 FAIL / 0 TIMEOUT**, 136.6s. Earlier reviewed product CI [36989314839](https://github.com/Minervaowl7/dsh-auto-memory/actions/runs/36989314839): 247 PASS / 0 FAIL / 0 TIMEOUT. Final integration with PR #206 and the team/PLAN fixes: **263 PASS / 0 FAIL / 0 TIMEOUT**, 137.3s, Node22.23.3, isolated HOME/DSH_HOME and blocked external user services. Generator --check --strict and complete diff checks pass.

The diagnostic privacy test rejected any standalone 39, including valid timestamps. A fixed 09:51:39 clock reproduced four failures; matching the obsolete session-count claim rather than arbitrary numbers retains secret rejection and passes 26 checks. Only this test repair is added; upstream diagnostic expectations remain intact on this independent branch. Historical truncated CI logs do not establish this as the unique cause of every prior remote failure.

The actual release copy stage retains all 84 files byte-for-byte, and npm file selection is verified. Full release dry-run still fails closed at the existing missing tools/reconcile-upstream.mjs; no gate was bypassed. No release, deployment or publishing occurred.

Current source commits, review status, CI and remaining boundaries are recorded in [final-validation.md](final-validation.md). Refs #170 and #177.
