# 【任务】R4 P4-4：团队基线携带维护文档（隔离往返 + 冲突负路径）

你是实现 Agent，工作目录 D:/dsh-auto-memory。用户已授权先把团队基线做完，随后由用户重启宿主做试验。

## 0. 范围与基线

- 只做 P4-4 的「维护文档随团队基线携带与恢复」；不做团队传输、权限、在线同步协议重构。
- 基线 HEAD ada1a29b。先读 docs/internal/PROTOCOL-R4-20261110.md §5 团队基线行、§8、§9.2；docs/internal/LEDGER-DOC-API-CONTRACT.md。
- 再读 lib/team-baseline.js 全文、lib/index.js 的 uploadBaselinePre/readBaselineOfferPre/applyBaselineOfferPre、buildBaselineWritePlanPre 及既有基线测试。
- 已有 LedgerDocReadSide、documentId/revision 校验与 file-boundary 可复用；必须真读当前源码，不照抄旧行号。
- 不新增配置键；不启用 R4 读侧；不改 memory_note/handoff 默认行为。文档存在即随用户显式基线动作携带，避免关闭读侧导致迁移丢材料。
- 不修改 lib/client.js、skins/、event-store.js/event-write.js；不跑全仓回归；不迁移/删除真实记忆。

## 1. 编解码与格式兼容

- 在 lib/team-baseline.js 增加对 `documents/<documentId>.md` 的可选支持；不携带 documents 时旧基线行为逐字不变。
- 优先做向后兼容的可选文件项，不为了新增文档强造全局 v2。若确需格式变化，旧 v1 基线仍须可读并报告理由。
- documentId 必须匹配 R4 协议，拒绝绝对路径、`..`、反斜杠/正斜杠混用、重复文档和非法命名；index.json、调试文件仍不得入包。
- 每份文档从正文重算 revision，与文档元数据核对；eventIds 与 documentId 必须合法。checksum 覆盖全部实际入包文件。
- pack/unpack 保持纯函数、零 IO、异常返回 `{ok:false,reason}`；保留既有 brotli 体积上限和解压前闸门。

## 2. 上传与源工作区读取

- uploadBaselinePre 沿既有工作区解析路径读取 handoff/documents/ 中全部合法维护文档；只读当前文件，不扫描 handoff-*.md 旧快照。
- 文档身份/内容/revision 不合法、物理路径越界、symlink/junction 越界时 fail-closed；不得静默丢文档后宣称基线完整。
- 返回结果带 documents 数量，便于试验核对；不改变 outbox 既有 kind/key/幂等行为。

## 3. 解包、应用与冲突

- 沿用现有 buildBaselineWritePlanPre 的「备份/写入/回滚同一写集合」，把 documents 纳入该计划；不得只写不回滚或只备份部分文件。
- 应用前按 documentId+revision 核对；目标存在不同 revision 时返回显式冲突，不得静默覆盖。只有调用方对该文档给出明确解决选择后才能覆盖；本地保留/远端覆盖均须可审计。
- 同 revision 同内容应幂等；重放不重复生成 -b/-c 文件。缺少目标或源文档不是删除授权。
- 冲突不能伪装成成功；部分成功必须逐文件列出。既有 event-store/PLAN/MEMORY 事务与回滚语义不变。
- 基线是当前维护态，不是旧快照备份，不用于 P6/P7 的删除恢复证明。

## 4. 验收（真执行 + 负路径 + 隔离变异）

新增 tests/smoke/smoke-test-r4-team-baseline.mjs（或合适的独立套件），至少覆盖：

1. 两份不同 documentId 的维护文档 pack→unpack→隔离 apply 后逐字节一致；documentId/revision/eventIds 读回一致。
2. 旧 v1 基线（无 documents）照常 pack/unpack/apply；不带 documents 时默认输出形状不变。
3. checksum 篡改、截断、非法 documentId、绝对路径、`..`、重复文档、非法 eventIds、revision 不匹配、越界 symlink/junction 全拒绝。
4. 目标同 revision 幂等；目标不同 revision 默认冲突且不写；显式选择后才按选择应用并保留审计；不得静默覆盖。
5. 应用中途失败只回滚已写文件，保留未写文件与备份；重试不产生重复文件。
6. 隔离变异至少覆盖：文档未进 checksum、revision 未校验、冲突被静默接受，均必须红、还原复绿。

必须真跑：新套件、smoke-test-team-baseline.mjs、smoke-test-issue488-baseline-bomb.mjs、smoke-test-baseline-rollback-547.mjs、smoke-test-r4-read-side.mjs、既有八套 R4、r26 与 verify-docs。
lib/index.js 是 >500 行 CRLF 文件，只能内容锚定 edit；收工报行/字节/导出/行尾/diff，r26 用套件自身管道重钉。配置键数量不变。

## 5. 交付

- lib/team-baseline.js 的必要扩展、lib/index.js 的最小接线、上述测试、docs/internal/R4-P4-4-RESULT-20261111.md。
- 报告含实现范围、源码物理量、实测计数、隔离变异、旧基线兼容证据和未验证边界。
- 给用户一份重启试验清单：怎样准备隔离工作区/基线、上传、应用、验证文档和 revision、冲突与默认关闭。
- 不做真实宿主端到端、不声称跨设备已验证、不接管生产 R4 写入、不迁移/删除。完成后 send_message 给 lead，等待 Lead 复核提交。