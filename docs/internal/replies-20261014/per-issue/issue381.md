已在**开发树**中逐块移植（下一版 3.3.4 包含本项）。

**你的实现**：`ae302dc`（Isolated regression passed）

**合并状态**：本项随 PR #420 并入公开 `main`（merge commit `394fdbe2`）。开发树与 `main` 历史分叉、行尾不同（开发树 CRLF / 仓库历史 LF），直接三方合并实测 **790 冲突** ⇒ 采用**三分桶整文件移植**（A=84 整取我方基线一致者、B=56 新增、C=2 人工判断，守恒 = 142）。本项在其中，**行尾未被翻转**。

**回归依据（你可在本机复算）**：
- `node tests/smoke/smoke-test-issue381-411-python-wizard.mjs` — 期望通过
- `node tests/smoke/smoke-test-issue381-python-timeout.mjs` — 期望通过

**本次移植后全量回归基线**：399 PASS / 1 FAIL / 0 TIMEOUT / 208.6s。唯一 FAIL `smoke-test-a1-mutation-admission` 为既有间歇缺陷（吸收前后失败率均 20–25%，已用独立 worktree 对照确认），与本项无关。

**本项是否被我改动**：无 —— 按你的实现原样保留