Restore missing runtime resources and align anchored Tier-0 cards (#170, #177)

3.2.7's release filter treated top-level directory names as source filenames, deleting lib/assets and lib/policies. This restores the 82 asset files and two policy JSONs byte-for-byte from historical commit 5d45d84a, and applies file-extension/debug-copy filtering only to top-level files. Runtime subdirectories and legitimate dotted/binary asset names survive; the seven reported client debug copies remain excluded.

Tier-0 anchor groups now include their own immediately preceding heading and stop before the next card's heading. Existing unanchored and body-only anchor paths keep their behavior. Tests compare all 13 titles, conclusions and group boundaries across four document layers, LF/CRLF, final newline absence and single-card input.

The machine-specific runtime smoke is replaced by temporary, actual Python subprocess/venv and local fake-peer fixtures. Attribution, timeout, candidate selection, worker protocol and vector shape assertions remain executable offline. Actual installed-model dependency/semantic-quality acceptance remains in the separate opt-in py-runtime-chain-live suite; the fixtures do not certify C3, model quality or CUDA.

Validation: full Node22.23.3 CI-parameter serial run initially 246 PASS / 0 FAIL / 0 TIMEOUT (133.1s), plus the subsequently added actual registered HTTP resource route test passes for all six light/dark slots. Generator --check --strict passes. npm 3.2.6 tarball independently contains 82/2 assets/policies; 3.2.7 contains 0/0, with the reported 3.2.7 sha1 verified. Source npm pack selects 82/2; actual release copy-stage output retains all 84 files byte-for-byte.

Full release dry-run still fails closed at the already-missing tools/reconcile-upstream.mjs. No gate was bypassed, and no #168 cleanup was imported. Copy/filter phase and npm file selection are verified independently; this is not a claim of a successful complete release build. No release, deployment or publishing occurred.

This branch starts at upstream main 131ca794b9f0d07f78b19bf6feee3312939854ed and is independent of open PR #206. Refs #170 and #177.

复审追加：同一行多个 inline 锚点和混合输入确实复现标题边界误吞；仅独占合法标记行吸收前标题。配置解释器与开发 venv 同路径时按去重优先级验收。远端 fc25e1d run 36981307760 为 246 PASS / 1 FAIL / 0 TIMEOUT，issue162 内部 23/2；对应 Node 22.23.3 原生单跑和隔离单跑、独立 main 各 25/0，尚未得到两个失败断言。失败输出限额改为每流64KiB，并完整打印该有界输出，以便后续 CI 给出可定位证据；不能据单跑结果把首轮 CI 记为通过。

最新产品提交 `c9550e1def9c10aeea0e0e3fff524490c8219939` 已核对 fork 远端；对应 [CI 36983550483](https://github.com/Minervaowl7/dsh-auto-memory/actions/runs/36983550483) 完整结果为 **247 PASS / 0 FAIL / 0 TIMEOUT**（137.6 秒）。这一轮通过不改写首轮 fc25e1d 的失败记录；首轮两个断言的具体原因仍未恢复。与 PR #206 和团队/PLAN 产品提交 f8c0f45 的临时合成工作树 754b4c0 未推送，Node22.23.3、相同 CI 参数、临时 HOME 与外部服务隔离的完整回归为 **262 PASS / 0 FAIL / 0 TIMEOUT**（138.1 秒）。
