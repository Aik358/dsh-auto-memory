# 【外包任务书】R4 已实现能力的真实宿主综合验收（不只团队同步）

你是验收 Agent。工作目录：`D:/dsh-auto-memory`。

本任务是**真实宿主综合验收**，不是再跑一遍 Node smoke，也不只是团队同步测试。必须让真实插件代码在真实 DSH 宿主/浏览器/真实进程里运行，并给出可复核证据。

## 0. 结论边界与当前基线

- 实现提交：`10e66faf`；完成状态文档：`583eab17`。
- 必读：`docs/internal/PROTOCOL-R4-20261110.md` §2、§5、§9.2、§9.2A；`docs/internal/LEDGER-DOC-API-CONTRACT.md`；`docs/internal/R4-P4-4-RESULT-20261111.md` §5。
- 当前生产 GUI：`http://127.0.0.1:19387`，已重启。只读实测其配置含 `ledgerDocEnabled:false`，团队状态为 `enabled:false / configured:false`。
- **不得打开、修改或配置当前生产团队同步，不得使用当前生产 `DSH_HOME` 做写入试验。**
- 生产默认 R4 读侧仍关闭；本任务只能在独立 `DSH_HOME`、独立工作区、合成数据、独立端口中验收。
- 不修改 `lib/`、`tests/`、`tools/`、`skins/` 或产品文档来制造通过；发现缺陷只记录证据并报告。
- 不做真实记忆迁移/删除，不接管真实唯一接续来源，不跑全仓回归，不把本任务写成跨设备已验证。

## 1. 隔离环境（先证明隔离，再开始）

1. 在本仓内建立专用目录：`artifacts/_r4-host-verify-20261111/`。不要使用 `os.tmpdir()`；本机它可能返回 `undefined\temp`。
2. 使用宿主官方支持的 `DSH_HOME` 隔离方式启动**另一个**宿主实例和**另一个空闲端口**，加载当前 `D:/dsh-auto-memory/lib/` 的真实插件代码。
3. 启动命令必须从本机现有进程、官方 CLI 帮助或官方配置中核实并记录；**禁止凭猜启动命令**。不得停止或替换 `127.0.0.1:19387` 的现有进程。
4. 在报告中写明：隔离 `DSH_HOME`、测试工作区、实际 URL/端口、宿主 PID、插件加载来源；用截图/请求证明不是生产实例。不要记录密钥、token 或真实记忆正文。
5. 如果无法启动隔离宿主，立即停止并把阻塞写清楚；**不得退回用 Node 套件冒充真实宿主验收**。

## 2. 准备合成数据

- 只创建合成事件、合成日志、合成维护文档，不复制真实记忆正文。
- 准备至少两份不同 `documentId` 的合法维护文档，含不同标题、唯一标记词、合法 `eventIds` 和从正文重算一致的 `revision`。
- 准备两个隔离工作区 A/B，A 有当前维护文档，B 没有；不得让 B 通过最近 active 或全局账本兜底读到 A 的材料。
- 试验前记录整个生产记忆根和本仓 `lib/` 的只读指纹，试验结束复核未变。

## 3. 验收矩阵（全部要真执行）

### A. 宿主与统一门面

A1. 通过真实配置/状态接口或页面确认 `ledgerDocEnabled` 存在且默认 false；默认行为仍为 legacy 双读，不构造新写路径。
A2. 真实 import `lib/ledger-doc/index.js` 与 `lib/index.js`，构造 `LedgerDocSystem`，验证默认关闭无 I/O、无 wal；显式隔离启用后才创建真实 sink。
A3. 验证统一导出的 `LedgerDocumentStore`、`LockedLedgerDocumentStore`、`LedgerWal`、`EventStoreLedgerSink`、`LedgerDocReadSide`、`HandoffMaterialStamp` 可用；start/stop/reconcile 生命周期可调用。

### B. 文档、CAS、锁与 WAL

B1. 创建文档后，同一 `documentId` 连续更新不得增加文件数；同名首建冲突不覆盖；错误 `expectedRevision` 返回冲突且正文不变；同内容更新返回 noop。
B2. 两个真实进程对同文档同 revision 更新，至多一个成功，另一个 conflict；不同文档均可成功；kill 持锁进程后无半截文件。
B3. 对同一业务 opId 验证 `prepared/committed/failed` 三阶段各落一条真实检查点，`checkpointId=ckpt_<16hex>` 持久化且事件内唯一。
B4. 同阶段同载荷重放不新增 ID；异载荷返回 `op-payload-mismatch`；旧数字台账返回 `op-payload-unverifiable`；台账淘汰后能从检查点恢复判据。
B5. 子进程在 prepared 后被 kill，重启 start/reconcile 能补 committed；文档完整、无临时文件、检查点仍 append-only。
B6. 证明检查点携带 changeSet/revision/四段和引用，不再为每次成功写入复制未变全文。

### C. 六个读侧

在**隔离配置中**显式开启 `ledgerDocEnabled`，逐项验证：

C1. **动态注入**：当前维护文档进入注入；同进程 committed 后立即可读新 revision；另一进程写入后刷新读到新 revision。
C2. **跨工作区接续**：carry 沿源会话路径返回 A 的 documentId/revision；B 的改动不得串入；无源工作区明确失败，不做全局账本顶替。
C3. **scope=all / scope=handoff**：唯一标记词能命中；同一正文在一次结果中最多一份；L0/full 下钻内容与 revision 一致。
C4. **语义检索**：chunk 身份为 documentId+sectionId+revision；正文变化后旧 chunk 失效，不同时返回新旧 chunk。
C5. **事件下钻**：只通过 members/检查点的显式绑定读当前文档；无绑定多文档返回选择需求，不猜最近文档。
C6. **材料指纹**：同名同 mtime 正文改变必须改变 stamp；不改内容时稳定；A 改 B 不变；读取失败进入 readErrors。
C7. 非法 ID、绝对路径、`..`、越界 symlink/junction 全部 fail-closed；读失败与无命中分开返回。
C8. 关闭开关后恢复 legacy 双读；不删除文档、不成为唯一接续来源。

### D. 历史查询与只读审计

D1. 用指定 `[from,to)`、eventId/kinds、includeQuad 查询；超过 5 条检查点时分页后全集完整，边界日记录不多不少。
D2. 移除全部旧账本文件后仍能由事件检查点和日志回答历史；事件库损坏返回 readErrors，不能返回「无记录」。
D3. 对合成账本运行 coverageAudit：每个输入恰一份报告，源 SHA 前后一致，报告可读回；`eligibleForPhysicalDelete=false`。

### E. 团队基线（本任务的一部分，不是全部）

E1. 在隔离团队配置/outbox 中执行用户显式上传，返回 `documents:2`；outbox 仍为 `kind:'baseline'`、`key:'baseline:current'`。
E2. pack→unpack→隔离 apply 后两份文档逐字节一致，documentId/eventIds/revision 一致；checksum 覆盖实际入包文档。
E3. 旧 v1 无 documents 的基线照常解包/应用；默认形状不因新功能改变。
E4. 同 revision 重放幂等，不产生 `-b/-c`；目标不同 revision 默认 `document-conflict` 且字节不变。
E5. 分别显式选择 local/remote，核对实际写入与 documentsAudit；不得静默覆盖。
E6. 第二篇 writer 故障时，只回滚已写文件，未写文件和备份保留；重试不生成重复文件。
E7. checksum 篡改、截断、非法 ID/路径、重复文档、非法 eventIds、revision 不匹配、源/目标 symlink 越界均拒绝。
E8. 验证 R4 读侧关闭时，文档仍可因用户显式基线动作被携带；不得触发后台自动覆盖。

## 4. 必须包含的负路径与反向对照

- 每个「必须拒绝」都要配一个合法输入「必须成功」，避免把环境/夹具问题误报为产品正确。
- 至少对 revision 校验、工作区绑定、committed 失效通知、documents checksum、冲突默认拒绝做隔离变异；变异在专用副本中，不在共享 `lib/` 就地改后还原。
- 记录每个变异的 CAUGHT/MISSED 和还原复绿证据；没有区分力的变异不算通过。

## 5. 明确不在本轮范围

- **P4-2（legacy/graph/iter5 面板）和 P4-3（外部变更简报/存量归并扫描）尚未实现，不得写成已通过。**
- 不做真实生产 R4 写入接管、真实唯一接续来源切换、真实跨设备/在线团队同步。
- 不做 P6 真实存量迁移、恢复演练或 P7 物理删除；现有 `eligibleForPhysicalDelete=false` 不得被改成可删。
- 不跑全仓回归；本任务是指定真实宿主验收，不能用局部结果宣称全仓无回归。

## 6. 交付物与汇报格式

1. `docs/internal/R4-HOST-VERIFY-RESULT-20261111.md`：逐项 PASS / FAIL / BLOCKED / NOT-IMPLEMENTED，不合并成虚假总分。
2. `artifacts/_r4-host-verify-20261111/`：合成夹具、隔离配置、启动命令、无敏感信息的请求/响应、浏览器截图、进程与磁盘证据、变异结果。
3. 每项给出：真实操作、期望、实际、证据路径、是否为真实宿主、是否只是单元/隔离测试。
4. 发现缺陷时保留最小复现步骤、实际错误码、涉及文件与必要的源码位置；**不得先修代码再报**。
5. 最后单列：已实现且宿主验证通过、实现但宿主验证失败、尚未实现、仍禁止的行为、生产环境未做的事。

完成标准不是「页面能打开」或「Node 套件全绿」，而是上述已实现能力在**独立真实宿主**中被逐项证实，且生产配置与真实记忆未受影响。