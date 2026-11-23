# 【任务】R4 P4-2：legacy / graph / iter5 面板与已打开文档 revision 更新

你是实现 Agent，工作目录 D:/dsh-auto-memory。用户已授权按流程实施。

## 0. 基线与硬边界

- 基线 HEAD 1252bef8；验收后四项修复已提交 6d9573bb。默认 `ledgerDocEnabled:false`，legacy 双读不变。
- 先读 PROTOCOL-R4-20261110.md §5 读侧矩阵、§9.2 P4、§9.2A；LEDGER-DOC-API-CONTRACT.md；当前 `handoffPanelData`、classic `PlanTab`、`Iter5Handoff` 的真实源码，禁止照抄旧行号。
- 只做 P4-2，不做 P4-3 简报/归并扫描，不接管生产写入、不迁移/删除、不跑全仓回归。
- 不做三方 merge 或整块替换式前端重构；`lib/client.js`、`skins/legacy/iter5-325.js.frozen` 只允许内容锚定的小范围修改。
- 所有真实写入只在 artifacts 隔离夹具/隔离 DSH_HOME；不修改生产配置或真实记忆。

## 1. 先做前端守卫锁测绘（不得跳过）

1. 用 glob 列出 tests/smoke/*.mjs，grep `client.js|CLI_SRC|lib/client`，再按 PlanTab、ledger、handoff、fileQ、Iter5Handoff、data.ledgers、chosen 二次筛选。
2. 产出四列表：`文件:行号 → 锁的内容/类型 → 本批是否撞锁 → 对策`。区分计数锁、精确正则锁、结构不变量锁；不能只报套件名。
3. 读相关守卫头部事故说明，保留原本防事故的不变量。需要改判据时同批说明演进原因，禁止删除守卫。
4. 记录 client.js / frozen / 相关测试的 `(行数, 字节数, 导出符号数)` 基线与行尾；大文件禁止整文件 write。

## 2. 后端：handoff-state / fileQ 读维护文档

- 在现有 `/handoff-state` 数据面（不新增平行真源）增加独立 `maintenanceDocuments` 清单，仅 R4 开启时返回；包含 documentId、revision、显式 eventIds、相对路径 `documents/<documentId>.md`。
- legacy 和 graph 都可读；不得混进旧 `ledgers` 数组让前端误判成 handoff-*.md。
- `fileQ` 在 R4 开启时允许合法 `documents/<documentId>.md`，复用 protocol 的 documentId 校验与现有物理根包含检查；拒绝非法 ID、绝对路径、`..`、越界 symlink/junction。
- 返回当前正文、documentId、revision；从磁盘重算 revision，不信任缓存；读失败与未命中分开。
- 默认关闭时清单、fileQ 和返回形状保持旧行为；关闭后恢复 legacy 双读，不删除文档。

## 3. classic PlanTab：独立分组与 revision 失效

- 在现有交接材料 UI 增加独立「维护文档」分组，按 documentId 稳定选择，不按 mtime 猜当前文档。
- 已打开文档记录 `{documentId, revision}`；当宿主返回同 documentId 的 revision 改变时，必须重新获取当前正文并更新显示；revision 未变不得重复拉取。
- 切换会话、nonce/reloadKey、返回列表、失败重试都遵守工作区绑定；防止旧请求覆盖新会话/新 revision（request identity/epoch guard）。
- 不把旧 handoff-*.md 与维护文档混为同一文件；旧条目保持原行为。

## 4. iter5 Iter5Handoff：同源实现 + 重建

- 在 `skins/legacy/iter5-325.js.frozen` 的生成区做同语义小范围修改：独立分组、documentId/revision 选择、revision 改变时重取当前内容、request identity 防串写。
- 修改后必须运行仓内 `build-iter5-skin` 重建真实产物；R2 门若拒写，逐条核对「只存在于 client.js」的行，确认都是待替换旧实现才按既定流程处理，禁止直接当垃圾丢弃。
- 中英 i18n 同步；禁止社区 merge 式重构；不删除既有动画/视觉表现。
- 保持 classic/frozen 的 CRLF 性质；记录重建前后物理量。

## 5. 验收（真执行 + 负路径 + 真浏览器）

1. 后端真执行：legacy/graph 清单含 documentId/revision/eventIds；合法 fileQ 读到当前正文；非法 ID、路径、symlink 全拒；默认关闭行为不变。
2. 前端真执行 factory（不是 node --check/静态字符串）：classic 与 iter5 的文档选择、revision 变化重取、revision 不变不重取、旧请求不覆盖新会话。
3. 隔离变异至少覆盖：fileQ 白名单缺失、revision 失效重取缺失、request identity 缺失；均必须红、还原复绿。
4. 独立真实 DSH_HOME/工作区/端口/浏览器验证：R4 开启时两类 UI 都能看到并打开维护文档；外部进程修改同一文档后，宿主刷新使已打开内容指当前 revision；非法 fileQ 拒绝；关闭后恢复 legacy。保存截图与请求证据。
5. 真跑新/改套件、受影响 graph/PlanTab/iter5/continuation 套件、八套 R4、r26、iter5 classic 相关锁、verify-docs。所有锁用被检套件自己的管道复算，禁止手填。
6. 交付 docs/internal/R4-P4-2-RESULT-20261111.md：守卫测绘表、修改范围、真执行/真浏览器证据、变异、回归、未验证边界。

## 6. 不提交

实现与验收完成后 send_message 给 lead，由 Lead 复核完整 diff、运行关键套件并统一提交。