# 执行 Agent 任务书：2.9 检查点规范化、覆盖证明与 sourceRef（独立核心）

> 初建 2026-11-13（Asia/Hong_Kong）
> 工作目录：`D:/dsh-auto-memory`
> 基线：`496c5dc3`（文档提交；源码 2.5–2.8 位于 `8848e336`）
> 性质：**独立模块化实现 + 隔离验收；不是生产接线。**
> 执行者：现有 Kimi Teammate `handoff-ledger`。

## 1. 目标与并行边界

2.3 的归属判定器训练可并行，2.9 不等待其完成。2.9 只把 `memory_note(kind=handoff)` 的规范化内容、来源证据与覆盖判断抽成独立、可测试的 API。

本任务**不改**：
- `lib/index.js`、`lib/event-write.js` 或任何共享生产入口；
- `lib/legacy-handoff-compat.js`、`lib/event-pointer.js`、既有 ledger-doc 生产模块；
- 2.3 模型、候选协议、2.4、SidecarStore 或生产配置；
- 真实记忆、真实事件库、19387。

最终接线由 Lead 单独执行。若有 API 不兼容或文档冲突，停止并上报，不自行改语义。

## 2. 权威文档

- `docs/internal/PROTOCOL-R4-20261110.md` §4–7、§9.2；
- `docs/internal/PLAN-LEDGER-R4-20261110.md` §1–4；
- `docs/internal/CONSTRUCTION-PLAN-20261108.md` 2.9 行；
- `lib/event-write.js:696–743` 现有 `parseLedgerSectionsPre`；
- `lib/event-pointer.js` 的 trusted root、raw/normalized SHA-256 与 `sourceRef` 安全读取；
- `lib/legacy-handoff-compat.js` 的既有兼容语义；
- `lib/ledger-doc/coverage-audit.js` 的 regionDigests 与覆盖审计。

注意：旧文档中的空值措辞（如要求“无”）与后续检查点协议的空串语义不一致时，按当前 `event-store.js` 的 `goal/state/deadend/next` 字段与 `empty→[]` 协议处理，不在本任务里改变存储 schema。

## 3. 文件写域

可新建/独占：
- `lib/handoff-coverage.js`；
- `lib/handoff-normalize.js`（仅在确实拆分纯函数时才新建，避免为拆而拆）；
- `tests/smoke/smoke-test-batch2-2.9-handoff-coverage.mjs`；
- `docs/internal/RESULT-BATCH2-2.9-CORE-20261113.md`。

若上述目标已存在，先读并按实际内容协调；不整文件覆盖 >500 行文件。

## 4. API 要求

模块导出少量明确 API，不创建平行状态源：

1. `normalizeHandoffContentPre(input, options)`：确定性规范化 CRLF/LF、换行、空行及明确允许的 Markdown 差异；不把任意改写/空白删除判为等价。返回规范化正文、变更诊断与规范化 SHA-256。
2. `parseHandoffCoveragePre(input, options)`：解析 goal/state/deadend/next，保留额外二级节、用户/模型备注、锚点和未知字段的证据；输出完整性与区域摘要，不把“非空”当覆盖。
3. `buildHandoffSourceProofPre(input, options)`：生成 sourceRef（相对可信根）、rawSha256、normalizedSha256、行号、bytes 的证据 DTO；复用/对齐既有指针协议。
4. `assessHandoffCoveragePre(input, options)`：对照 checkpoint 四段、真实文档全文与来源证据，返回 `covered | partial | mismatched | needs-review | ineligible` 与原因。只证明内容覆盖，不授予删除、归档或自动认领权限。
5. 可选 `serializeHandoffSectionsPre` 仅用于规范化序列化/往返测试；不得直接写真源。

返回结构必须真实可消费；不用“模块存在/源码有字符串”作为功能证据。

## 5. 必须真实验收的路径

- CRLF/LF、末尾换行和受控格式差异的规范化一致性；
- 四段齐全且正文/额外节/用户备注/锚点保留；
- 缺段、空值、只有 text、额外节、长正文；
- 正文相同但指纹不同、指纹相同但正文漂移、非法 sourceRef、根外/符号链接越界；
- 无证据不得自动认领；closed 目标不可写；显式 eventId 与本 API 分离；
- sourceRef 指向当前 trusted handoff 目录，保留完整 64 hex 与行号；
- API 重复调用确定性；输入不可变；JSON 字段稳定；
- 真 import → 真调用 → 断言返回值/副作用；每项有负路径和物理量（字节数、SHA-256、PASS 数）。

## 6. 隔离与变异

所有实验使用绝对隔离根；测试不会调用 apply/merge/archive，不写生产记忆或 19387。至少做“规范化漏掉实质差异”“sourceRef 越界被放行”“缺段仍判 covered”三个副本变异，必须在同一模块目录内做安全副本或复制所需依赖，不能在共享生产文件就地改。

## 7. 交付

1. 独立模块和专项测试；
2. `RESULT-BATCH2-2.9-CORE-20261113.md`：真实导出/调用、指标、错误路径、变异、指纹和剩余边界；
3. 不 git commit/push，不写生产记忆；向 Lead 回报文件、API 和集成建议；
4. 若遇到“空值/额外节/来源指纹”语义冲突，列出实际证据并停止该语义，不自行选定。
