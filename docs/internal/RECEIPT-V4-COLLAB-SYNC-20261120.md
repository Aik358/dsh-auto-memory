# V4 协作分支同步回执

2026-11-20（Asia/Hong_Kong） · 批次 3 P3-A2

同步提交 `a97f65c57f6dc8a329109a612537509fcb430b9e` 的唯一父提交是 `3c8f384b5ec0f92989943e3ab4db6542b7e54872`。同步包含 U0/U1/U2/U3a，恢复协作 README 并更新施工总表。两份文档均标明 **U3b 未开工**。

本批用两个提交交付。同步提交保留任务书 §7 规定的 30 个路径，回执单独提交，以便记录同步提交的完整 SHA 和推送结果。

## 任务书 §7 验收

| # | 核验项 | 实测证据 |
|---:|---|---|
| 1 | 新提交及父提交 | `a97f65c5 chore(collab): 批次3 P3-A2 U0/U1/U2/U3a 落地 + 恢复 v4-collaboration 施工进度 README`。`git rev-list --parents -1 a97f65c57f6dc8a329109a612537509fcb430b9e` 返回 `a97f65c57f6dc8a329109a612537509fcb430b9e 3c8f384b5ec0f92989943e3ab4db6542b7e54872`。 |
| 2 | 文件白名单 | `30 files changed, 4391 insertions(+), 772 deletions(-)`。路径与 §4.2 的 28 个文件及两份进度文档逐项一致。28 个复制文件与主树源文件逐字节一致。 |
| 3 | README 体量 | `git show a97f65c57f6dc8a329109a612537509fcb430b9e:README.md` 为 **6,259 字符 / 11,250 B**，满足 5,000–9,000 字符。 |
| 4 | README 首行 | `# dsh-auto-memory · V4 协作分支` |
| 5 | README 进度和计数 | 包含 `2026-11-20`、`22 tools / 87 routes / 182 config keys`、`U3b` 与「未开工」。 |
| 6 | 客户端字节核对 | `lib/client.js` 与父提交逐字节相同。Git blob `c72ae49e83a65e63caffafc62a19b7207833b184`，文件内容 SHA-256 `9154599dd272c142dbb3be83bf3b7d0608ce90575c0091e443920f39f57aecd8`。 |
| 7 | `node tools/verify-docs.mjs` | **22 tools / 87 routes / 182 config keys**，全部一致，退出码 0。 |
| 8 | `smoke-test-r26-cross-layer.mjs` | **26 PASS / 0 FAIL**。`lib/index.js` 归一化长度 1,655,058，SHA16 `E13A88D0409EE3AA`。 |
| 9 | 单位策略三个 smoke 套件 | `smoke-test-batch3-unit-policy.mjs` **32/0**，`smoke-test-batch3-unit-adapters.mjs` **35/0**，`smoke-test-batch3-unit-shadow.mjs` **14/0**。U3a 变异 **6/6 CAUGHT**。 |
| 10 | 快进推送及远端核对 | `git push origin HEAD:refs/heads/v4-collaboration` 成功，输出 `3c8f384b..a97f65c5`。`git ls-remote --refs origin refs/heads/v4-collaboration` 返回 `a97f65c57f6dc8a329109a612537509fcb430b9e  refs/heads/v4-collaboration`，与同步提交一致。 |
| 11 | 主工作树状态 | `D:/dsh-auto-memory` 仍在 `preview`，HEAD `23646c04102f5471496bb4c7e069d3657b052684`。开工前与同步后 `git status --porcelain=v1 -z --untracked-files=all` 均为 167 条记录，原始输出 SHA-256 均为 `20181e4781dd299c9bb7a3825e3d403684e90fbd3d9f6d094342007910df9340`。 |

Lead 提供的全量回归基线为 **647 PASS / 0 FAIL / 0 TIMEOUT / 0 FLAKY（242.7s）**。同步时在独立工作树实跑的是上表第 7–9 项。

**未 force push**。**未触碰 main/preview**。**未动主工作树**。

## README 恢复记录

| 版本 | Git blob | 字符数 | UTF-8 字节数 |
|---|---|---:|---:|
| `3c8f384b` 中的产品 README | `255ee3d7787894c18f8a27208e103203f0862fb9` | 65,088 | 66,105 |
| `792224ea` 中的协作 README | `71eb55ee5236c294d6470589f66cb296802749ee` | 5,175 | 9,965 |
| `a97f65c5` 中的协作 README | `ccc4da7cd3056771234c7b36936552036b5892ac` | 6,259 | 11,250 |

字符数按 Git blob 解码后的 UTF-16 单元计数。恢复源按 CRLF 计为 5,295 字符。保留原版小节、更新批次进度与链接，计数行保留 `verify-docs.mjs` 识别的 `39 user capabilities` 前缀。施工总表更新顶部版本行，并在「接续须知」中补充 P3-A2 当前状态及 U3b 的边界。

## 同步提交文件清单

字节数取自同步提交的 Git blob。`A` 为新增，`M` 为修改。

| 改动 | 路径 | 字节数 |
|---|---|---:|
| M | `README.md` | 11,250 |
| M | `docs/internal/CONSTRUCTION-PLAN-20261108.md` | 115,231 |
| A | `docs/internal/PROMPT-CODEX-U1-1-UNIT-POLICY-FIX-20261120.md` | 5,333 |
| A | `docs/internal/PROMPT-CODEX-U1-2-UNIT-POLICY-FIX-20261120.md` | 2,915 |
| A | `docs/internal/PROMPT-CODEX-U1-UNIT-POLICY-20261120.md` | 11,471 |
| A | `docs/internal/PROMPT-CODEX-U12-U2-ADAPTERS-20261120.md` | 7,945 |
| A | `docs/internal/PROMPT-CODEX-U2-1-QUOTA-FAMILY-20261120.md` | 5,352 |
| A | `docs/internal/PROMPT-CODEX-U3A-2-SHADOW-RECEIPT-20261120.md` | 7,758 |
| A | `docs/internal/PROMPT-CODEX-U3A-3-REAL-IDENTITY-20261120.md` | 5,568 |
| A | `docs/internal/PROMPT-CODEX-U3A-SHADOW-WIRING-20261120.md` | 7,316 |
| A | `docs/internal/RECEIPT-BATCH3-U1-1-UNIT-POLICY-20261120.md` | 5,063 |
| A | `docs/internal/RECEIPT-BATCH3-U1-UNIT-POLICY-20261120.md` | 7,951 |
| A | `docs/internal/RECEIPT-BATCH3-U12-U2-ADAPTERS-20261120.md` | 9,882 |
| A | `docs/internal/RECEIPT-BATCH3-U2-1-QUOTA-FAMILY-20261120.md` | 6,231 |
| A | `docs/internal/RECEIPT-BATCH3-U3A-2-SHADOW-RECEIPT-20261120.md` | 7,904 |
| A | `docs/internal/RECEIPT-BATCH3-U3A-3-REAL-IDENTITY-20261120.md` | 5,867 |
| A | `docs/internal/RECEIPT-BATCH3-U3A-SHADOW-20261120.md` | 10,518 |
| A | `docs/internal/RECEIPT-HOST-E2E-546-OPTIN-20261120.md` | 5,810 |
| A | `docs/internal/REVIEW-BATCH3-P3A2-U0-CONTRACT-20261120.md` | 20,105 |
| A | `docs/internal/RULING-BATCH3-U3A-SOURCES-20261120.md` | 4,947 |
| A | `docs/internal/TASKPACK-HOST-E2E-546-OPTIN-20261120.md` | 4,577 |
| M | `lib/index.js` | 2,216,970 |
| M | `lib/injection/policy-v2.js` | 28,042 |
| A | `lib/injection/unit-adapters.js` | 18,419 |
| A | `lib/injection/unit-policy.js` | 12,047 |
| A | `lib/injection/unit-shadow.js` | 12,426 |
| A | `tests/smoke/smoke-test-batch3-unit-adapters.mjs` | 14,443 |
| A | `tests/smoke/smoke-test-batch3-unit-policy.mjs` | 20,180 |
| A | `tests/smoke/smoke-test-batch3-unit-shadow.mjs` | 23,640 |
| M | `tests/smoke/smoke-test-r26-cross-layer.mjs` | 144,779 |

## 未验证项

未截图核验 GitHub 页面渲染。README 首行、进度与链接目标已在独立工作树核对。
