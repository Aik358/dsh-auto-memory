已在**开发树**中逐块移植（下一版 3.3.4 包含本项）。

**你的实现**：`8311ce0`（写入契约检查器 + 负路径用例）—— 逻辑按原样保留。

**⚠️ 本项我做了改动，请重点复核**：

你新增的 `tools/check-write-contract.mjs` 与开发树**既有的同名文件**（#332 吸收：检查 `ok`/`committed`/`indexStale`/`revision`/`error` 契约 + 4 条变异反向对照）**是同名异物**。

**先更正我自己一个误判**：我原以为取你的会让开发树 `smoke-test-i332-write-contract.mjs` 必红。**实测是我错了** —— 你的输出 `写入契约检查通过: 35 host writer calls` 同样匹配该套件的正则 `/写入契约检查通过/`（不带 `✓` 前缀），**不会变红**。

但真实风险更隐蔽：覆盖后 #332 那套契约检查会**静默消失**，而 i332 第 ⑧ 条只验「文件存在 + 退出码 0 + 自报通过」，**识别不了换了工具** ⇒ 绿着但能力下降。

**处置（重命名共存，两套都在）**：
- 你的工具 → `tools/check-write-contract-await.mjs`
- `tests/smoke/smoke-test-issue368-write-contract-negative.mjs` 第 9 行改指新名
- 开发树既有的 `tools/check-write-contract.mjs` 保留原名

**实测双绿**：
- `node tests/smoke/smoke-test-issue368-write-contract-negative.mjs` → `PASS #368 missing awaits fail the versioned write-contract gate`
- `node tests/smoke/smoke-test-i332-write-contract.mjs` → 23 PASS / 0 FAIL

**建议**：新增工具文件时避开既有同名（`check-write-contract*` 已被 #332 占用）。改名共存能让「覆盖后静默退化」这类问题不可能发生。

**全量回归基线**：399 PASS / 1 FAIL / 0 TIMEOUT / 208.6s（唯一 FAIL 为既有间歇缺陷，与本项无关）。