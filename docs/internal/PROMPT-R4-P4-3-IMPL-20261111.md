# 【任务】R4 P4-3：外部变更简报 + 存量归并只读扫描

你是实现 Agent，工作目录 D:/dsh-auto-memory。用户已授权按流程实施。

## 0. 基线与边界

- 基线 HEAD 897f20be（P4-2 已提交；视觉验收由另一线处理）。先读 PROTOCOL-R4-20261110.md §5、§9.2、§9.2A、§11；当前 global-brief、event-unarchived、renderMemoryDynamic、scanLegacyLedgersForRegroupPre 的真实源码。
- 只做 P4-3：外部变更简报与存量归并**只读扫描**。不做 apply/批准/令牌/快照/物理删除，不迁移真实记忆，不接管生产，不跑全仓回归。
- 默认 ledgerDocEnabled=false 与其他工作区行为不变；不新增配置键或第二真源；不改 P4-2 前端文件，避免与截图线冲突。
- 不处理 P5 的生产接管/旧提示词改造；那属于后续独立批次。

## 1. 外部变更简报

- R4 开启且文档存在时，在既有动态简报装配中以**当前维护文档 revision + documentId + 路径**反映最新状态。
- 外部进程真实改文档后，刷新必须看到新 revision；同进程 committed 由现有 MaterialInvalidationBus 失效通道处理，不误报外部变更。
- 其他进程 mtime 变化但内容相同不算外部变更；内容变化才算。可复用既有 stamp v2/fingerprint 机制，不另造平行状态源。
- 只输出有界元数据/聚合信息，不注入整篇维护文档正文；readErrors 明确可见，不能伪装无变化。
- 无文档/无变化/无绑定路径不输出简报段；默认关闭与其他工作区零新增输出。

## 2. 存量归并只读扫描

- 沿用 event-unarchived 的既有只读扫描与去重入口；将 handoff/documents/*.md 从「待归组的 legacy handoff-*.md 快照」中排除，维护文档是当前维护态，不是待归组旧快照。
- 旧 handoff-*.md 候选仍按原规则扫描；维护文档头部按 R4 protocol 读取，不按旧 `---\n` 分隔。
- 候选清单有界、路径去重、非法 documentId/路径/越界 symlink 拒绝并记录 readErrors；不得静默变成空清单。
- 本批只扫描/返回/简报，不创建事件、不归并、不归档、不移动/删除文件。

## 3. 验收

1. 真 import/构造/调用：外部进程改内容后 revision 与简报同步；同进程 committed 不误报；mtime-only 同内容不误报；无绑定/无变化/默认关闭/其他工作区零新增输出。
2. 扫描含真实维护文档时不再列为 legacy 待归组；旧快照仍保留；非法 ID/越界/readErrors 有区分；输入/输出路径物理边界成立。
3. 隔离变异至少覆盖：简报 revision 不更新、mtime-only 误报、维护文档误列待归组；必须红、还原复绿。
4. 真跑新/改套件、global-brief/event-unarchived/event-view/continuation 相关套件、八套 R4、r26、verify-docs；不引用不存在的套件。
5. 独立真实 DSH_HOME/工作区/端口验证：外部进程改文档后刷新简报与 event-unarchived；证明维护文档不是待归组旧快照、旧快照仍可扫描、默认关闭不变。
6. 交付 docs/internal/R4-P4-3-RESULT-20261111.md：范围、实测、变异、HOST 证据、未覆盖边界。若本批无可见 UI 改动，明确写「无新增前端视觉面」，不要编造 UI 截图。

## 4. 不提交

完成后 send_message 给 lead，由 Lead 复核完整 diff 并统一提交。