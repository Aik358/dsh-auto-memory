# dsh-auto-memory · V4 协作分支

> 本 README 仅供 **v4-collaboration** 分支使用，描述当前开发进度与协作入口。
> 不替换 main、release、alpha 或 preview 的 README，也不代表这些分支已合入本分支的改动。
> 当前为开发中快照，不是正式发布、稳定版承诺或默认启用的新协议。

## 目标

V4 的总体方向是 **系统化、模块化、API 化**：

- **系统化**：以事件组织记忆，明确写入、归属、读取、注入、恢复与可观测性的完整链路。
- **模块化**：让既有白板、旧账本、通用写入与 sidecar 保持职责清晰，避免复制保护逻辑或建立平行真相源。
- **API 化**：以明确的参数、revision、CAS、锁、WAL、错误码与回执代替隐式约定。

这个分支用于公开当前进度、接收探索与实现协作。请先读文档、声明写域，再开始实现；不要直接覆盖当前工作。

## 当前进度（2026-11-20）

### 批次 1 · 已完成收口

1.1–1.3 与 1B（1.4–1.6）已实现并提交；包括冲突库迁出与裁定、事件显式标识、写后回执与归属链路。详见施工总表的历史提交记录。

### 批次 2 · 8 项已实现，2.4 存量归并冻结

| 范围 | 当前状态 |
|---|---|
| 2.1 / 2.2 | 已实现新建事件填目标首段与检查点 kind 推断（`4f2b5d23`）。 |
| 2.3 | 归属建议与异常提醒已接入只读复核与历史提案（`34331658`）。可靠性训练和真实宿主验收仍待完成。 |
| 2.4 | 存量归并冻结，待隔离工程验收、备份恢复验证与最小批次授权。 |
| 2.5 | 已实现事件写入成功后重绘白板，以及锁内合并（`2b09cb33`）。开关默认关闭。 |
| 2.6–2.8 | 显式事件归属、摘要及来源指针、写入预检已实现并通过隔离验收。 |
| 2.9 | 规范化、空值语义、覆盖证明与来源指针 API 已交付。`memory_note` 的旧 plan/handoff 写入已接入共享入口并通过隔离验收（`9cca3b14`）。 |

G-1/G-2 已定稿。不新增容器事件，检查点摘要上限为 300 个 UTF-16 码元。批次 2 逐项真实宿主验收与生产启用仍有待办。[规格裁定](docs/internal/PROMPT-BATCH2-2.7-2.9-WIRING-20261113.md) · [实施复核](docs/internal/RESULT-BATCH2-IMPLEMENTATION-REVIEW-20261116.md)

### R4 独立线 · 维护文档与旧数据兼容

P0–P4 已完成；P5 关键可执行证据已补齐；P6/P7 **A1 保留原件**的约定范围已完成验收，尚未正式发布。

- 既有维护文档更新：显式 `documentId + expectedRevision + changeSet`，使用 CAS 与 R4 WAL。
- 显式首建：真实 `eventId` 绑定与 create-only；已有文档不覆盖。
- R4-on 无文档身份：通过显式 `maintenanceTopic` 推导稳定身份；缺身份明确拒绝，不再新增旧时间戳快照。
- R4-off 保留旧路径；旧账本读取薄转发至独立兼容接口，不复制 CAS、锁、sidecar 或保护门。
- 受控真实根授权与越界负路径已覆盖；生产仍默认关闭，未迁移或删除真实记忆。
- **808 篇只读盘点、30 篇备份/恢复抽样**，不是全量恢复或生产迁移证明。

A1 受影响回归：**20 套 / 382 PASS / 0 FAIL**，文档校验通过。该数字不是全仓回归，也不代表真实模型已按新协议行动。

### 批次 3 · 主体已交付，生产接线分阶段推进

批次 3 的 `B3-XX` 公共实现及回调验收基础已交付。`23646c04` 收口了 P1 策略接口、P2 设置页和 P3-A1 的首批生产接线。P3-A2 负责让设置中的模块开关、视图、表示和单位配额进入实际组帧。该阶段已验收到 U3a 的影子观测。[模块契约](docs/internal/DETAIL-BATCH3-SYSTEMIC-REBUILD-CONTRACT-20261116.md)

| 范围 | 当前状态 |
|---|---|
| P1 / P2 / P3-A1 · 投递策略主体 | 策略接口、三面设置和预览已交付。保存策略后，动态投递总开关、节奏、水位和整帧限制会影响实际投递。诊断和精简账本选段已接入。删除策略可恢复旧设置。[A1 范围](docs/internal/DECISIONS-BATCH3-P3A-SCOPE-20261118.md) |
| B3 公共模块接线 | 水位解析、动态规则呈现、白板及账本投影已有生产调用。统一来源读取、通知最终提交和公共组帧器仍待接入。 |
| P3-B · 隔离宿主验收 | 已核验三个设置入口、保存策略、七个旧控件的条件冻结和删除 API 回滚。页面最终删除确认仅部分验证，真实模型轮待验。[宿主回执](docs/internal/RECEIPT-BATCH3-A1C-P3B-20261118.md) |
| #546 · 迁移 opt-in | 设置生成源上的移植已完成，宿主接线套件 40/0。隔离宿主 E1–E6 通过，覆盖显式授权、预览、换包重置和字节对比。导入请求为 0。[端到端回执](docs/internal/RECEIPT-HOST-E2E-546-OPTIN-20261120.md) |
| P3-A2 · U0 契约 | 已交付 **v1.3**，含 A1–A7 七条裁定：diagnostics 不进 Unit 模型 / budget=总额且 S8 优先 / F13 quota-bypass / overcommit 先判 enabled / 配额按 scope 家族共享 / ruleModule 归属 / 用真实身份 |
| P3-A2 · U1 选择器 | 已交付 lib/injection/unit-policy.js：**32 PASS / 0 FAIL**，变异 12/12 CAUGHT；F3 同模块重复 (unit,scope) 判非法 |
| P3-A2 · U2 六处 adapter | 已交付 lib/injection/unit-adapters.js：**35 PASS / 0 FAIL**，变异 5/5 CAUGHT；分层为 RawUnit → bindUnits → Unit，adapter 零 IO、不读 policy |
| P3-A2 · U3a 影子观测 | 已交付 lib/injection/unit-shadow.js：**14 PASS / 0 FAIL**，变异 6/6 CAUGHT；仅在 policy.modules.diagnostics.enabled 时计算，回执经 POST /preview 与 debugInfo() **只读**暴露，注入正文零变化；影子使用真实身份，身份塌缩会如实报 duplicate-id |
| P3-A2 · U3b | **未开工**。模块开关、视图、表示和单位配额接管实际投递，生成 `deliveryModule`，并在真实宿主上逐轮对比。 |
| **B3-CO** · 记忆提炼扩充来源（原 3.1） | 日志、事件、白板、账本、反思五类来源的读取、提示组装与结果应用已实现，模块测试 66/0。生产 `memory_consolidate` 仍以每日日志为主要提炼输入。[实施结果](docs/internal/RESULT-BATCH3-CO-20261117.md) |
| **B3-EV** · 事件视图（原 3.2–3.4） | 四段投影、检查点预览保首尾、事件卡片与目录、来源指针已实现，模块测试 86/0。生产事件投递仍使用 `event-render.js`，尚未接入新的事件视图 API。[实施结果](docs/internal/RESULT-BATCH3-EV-20261117.md) |

### SidecarStore 原型 · 接入阻断已关闭，生产 facade 未做

B1–B4 原型层阻断已修复（`1d03c8f3`）：保留 opaque versions、补只读 `parserVersion`、批准根 regular-file 迁移、锁与路径错误映射。
Lead 独立复跑 **37 PASS / 0 FAIL / 0 skipped**，隔离变异 **6 CAUGHT / 0 MISSED**。
这是 Node/Windows 原型层结果，**不等于生产可接入**：facade、R4 生命周期、`events.jsonl` 审计、掉电/跨 OS 均未验。

## 开发者可探索与认领的内容

优先欢迎 **4.0 及以后**的方案探索、接口细化与隔离实现：

| 方向 | 可探索内容 | 约束 / 依赖 |
|---|---|---|
| 4.1 画像来源 | person store 到用户画像的真实读取与写入链路 | 与 3.0 的投递档位和预算契约对齐；不只增加存储文件 |
| 4.2 工作区技能库 | `scope=workspace` 的入口、归属与写入落点 | 缺省行为保持兼容；验证工作区与全局库边界 |
| 4.3 时段总结回读 | `memory_read` 的合法 kind、读取来源与错误语义 | 非法 kind 必须拒绝；先核对现有数据契约 |
| 4.4 诊断目录 | 诊断面与实际 summaries 目录的一致性 | 真实读取与字节数可复算；不修改用户数据 |
| 4.5 跨形态去重 | 注入组装的身份、指纹与保留策略 | 与 3.0 最终组装联验；内容不同不得误去重 |
| 5.1 铭文重写 | 把维护清单变为可判定、可跳过的流程 | 在依赖的数据与投递能力稳定后实施；先出方案 |
| 批次 6 清理 | 孤儿模块、零引用导出、未消费枚举与旧目录的逐项审计 | 按调用图与真实消费取证；不按零引用批量删除 |
| 语义与排序 | 语义对齐、候选排序与离线评估 | 只作候选排序/辅助判断；不把相似度当自动归并授权 |

可先做 **只读测绘、协议/API 方案、隔离测试与可回滚原型**。每项应说明输入输出、归属、失败语义、锁与并发、回滚、验收物理量；不能仅因文件存在就宣称已接线。

## 文档入口

- [施工总表](docs/internal/CONSTRUCTION-PLAN-20261108.md)：项目唯一施工入口，记录各批次实际状态、依赖、写域和当前边界。
- [R4 协议](docs/internal/PROTOCOL-R4-20261110.md)：维护文档身份、revision、CAS、WAL、读侧与故障语义；A1 最新验收以 §9.2B 和结果报告为准。
- [R4 P6/P7 A1 结果](docs/internal/R4-P6P7-A1-RESULT-20261112.md)：维护文档写入、默认退出、兼容读取、受控根授权、备份/恢复及未验边界；历史段以 §14/§15 更新为准。
- [R4 P5 证据归集](docs/internal/R4-P5-RESULT-20261112.md)：跨进程、默认关闭、历史观测与隔离宿主的既有证据。
- [R4 P5 实现结果](docs/internal/R4-P5-IMPL-RESULT-20261112.md)：P5 新增实现、验证和实际缺口记录。
- [旧账本兼容接口](docs/internal/R4-LEGACY-COMPAT-API-20261112.md)：旧快照读/枚举/适配与受控旧写的边界，不退役公共基础设施。
- [2.6/2.7/2.8 测绘](docs/internal/SURVEY-2.6-2.7-2.8-20261110.md)：问题规模、调用链与约束的调查依据；具体实现须服从下一份细则与施工门。
- [2.6/2.7/2.8 可执行细则](docs/internal/DETAIL-BATCH2-2.6-2.8-20261112.md)：三项串行实现的 API 合同、失败语义、测试、负路径、并发、验收与回滚。
- [2.9 独立核心结果](docs/internal/RESULT-BATCH2-2.9-CORE-20261113.md)：四个 handoff API、空值语义、来源证明与五门评估；生产接线未做。
- [3.0 进度报告](docs/internal/REPORT-3.0-INJECTION-PROGRESS-20261113.md)：定版规范与当前代码逐项对照。
- [批次 3 独立调查](docs/internal/INVESTIGATION-BATCH3-MODULAR-API-20261113.md)：真实管线、模块接口矩阵、已证缺陷与不成立项。
- [批次 3 施工细则](docs/internal/DETAIL-BATCH3-IMPLEMENTATION-20261113.md)：3.0–3.4 的 API、验收、回滚与串行接入顺序。
- [2.3 归属实验与训练门](docs/internal/RESULT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md)：隔离 C2/D 结果与停训判据。
- [SidecarStore 原型评审](docs/internal/REVIEW-SIDECARSTORE-PROTOTYPE-20261113.md) 与 [阻断修复结果](docs/internal/RESULT-SIDECARSTORE-BLOCKERS-20261113.md)。
- [P3-A2 U0 契约（含 A1–A7 裁定）](docs/internal/REVIEW-BATCH3-P3A2-U0-CONTRACT-20261120.md)
- [U3a 三个阻塞问题的裁定](docs/internal/RULING-BATCH3-U3A-SOURCES-20261120.md)
- [U1 回执](docs/internal/RECEIPT-BATCH3-U1-UNIT-POLICY-20261120.md) · [U2 回执](docs/internal/RECEIPT-BATCH3-U12-U2-ADAPTERS-20261120.md) · [U3a-3 回执](docs/internal/RECEIPT-BATCH3-U3A-3-REAL-IDENTITY-20261120.md)

## 协作方式与同步

1. 开工前先同步本分支，阅读总表与对应细则；在 Issue 中写明范围、假设与预期写域。
2. 认领 **4.0 以后**的探索/实现时，先提交方案或最小隔离验证；不要与当前批次 2/R4 的共享文件写入冲突。
3. 以本分支为基线开个人工作分支，提 PR 回 **v4-collaboration**；未经评审不合入发布分支。
4. 每次交付给真执行、负路径、文件字节数/指纹、受影响测试与回滚边界；不把源码字符串断言当功能证明。
5. 不提交真实记忆、凭据、日志、隔离宿主、模型权重、临时产物或真实数据快照。
6. 生产环境默认关闭新路径；不自行开启、迁移、归并或删除真实记忆。

本分支的提交与文档会随开发进度更新；历史报告中的状态以最新施工总表、对应报告的修订段和当前提交为准。

## 产品与既有界面资料

- [现有产品白皮书](docs/WHITEPAPER.md)：稳定能力边界与现有产品规模；分支内 R4 改动不是已发布产品功能。
- [前端共创说明](docs/FRONTEND-CO-CREATION.md)：既有界面与共创协作边界；前端改造需独立评审。
- [皮肤与面板说明](docs/SKIN-GUIDE.md)：现有 Twelve tabs / 十二个页签界面说明；本分支未增加前端页签。

当前产品计数校验：**39 user capabilities / 22 tools / 87 routes / 182 config keys**（`tools/verify-docs.mjs` 实测）。这是当前基线的可复算快照，不是新增功能承诺。

本次同步的验证基线（2026-11-20，Lead 本机复跑）：全量回归 **647 PASS / 0 FAIL / 0 TIMEOUT / 0 FLAKY**（--jobs=8 --timeout=180000，242.7s）；r26 跨层锁 **26/0**（lib/index.js 归一化 1,655,058 / SHA16 E13A88D0409EE3AA）。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
