# 执行 Agent 任务书：批次3系统化、模块化与API化独立调查

> 日期：2026-11-13（Asia/Hong_Kong）
> 工作目录：`D:/dsh-auto-memory`
> 性质：**只读代码调查 + 架构/接口任务书，不修改生产代码，不训练模型，不启动生产接入。**
> 目的：把批次3（3.0–3.4）从“多个局部缺陷修补”组织成可复用、可验证、可单独交付的模块与API体系，并明确2.3与Prototype的真实依赖。

## 1. 必读权威资料

- `docs/internal/CONSTRUCTION-PLAN-20261108.md`：批次3、3.0-A/B/C、并行与验收纪律。
- `docs/internal/CONSTRUCTION-GUIDELINE-INJECT-20261108.md`：S1–S12、用户裁定、历史规格；须以总表后续订正为准。
- `docs/internal/REPORT-3.0-INJECTION-PROGRESS-20261113.md`：当前代码逐项差距。
- `docs/internal/ARCH-SIDECARSTORE-PROTOTYPE-AND-SYSTEM-INTEGRATION-20261112.md`：Prototype层与2.3关系。
- `docs/internal/REVIEW-SIDECARSTORE-PROTOTYPE-20261113.md`：原型阻断和未测边界。
- `docs/internal/PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`：归属候选的proposal-only边界。
- `docs/internal/PROMPT-BATCH2-2.9-HANDOFF-COVERAGE-20261113.md`：2.9正在进行的独立写域。

## 2. 必须回答的架构问题

### 2.1 Prototype对2.3的依赖到底是什么

区分：
- 2.3模型训练与SidecarStore底层存储/CAS/锁是否直接耦合；
- 哪些候选/文档/事件身份字段由2.3冻结；
- 哪些profile/pooling/prefix/identity需统一，避免重复向量和表示语义漂移；
- 哪些Proposal只供人审，禁止自动attach/merge/archive；
- 哪些依赖是接口冻结/文档协调，而不是训练完成或SidecarStore直接调用模型。

### 2.2 批次3的共同管线

测绘真实调用路径，不只读模块名：

```text
memory/event/文档/规则来源
  → 数据读取/规范化/来源证明
  → 候选内容与档位策略
  → 分段、身份、预算与裁剪
  → 最终通知/定稿/计量
  → context回调与宿主project/retained消费证明
```

每个箭头给出当前文件、函数、参数、返回值和真实调用者；标注无读取点、死参数、候选预消费、全文预截断、多套同源逻辑。

### 2.3 现有模块应如何复用

至少实测：
- `rules-layer.js`：用户/项目层规则、分类、读取、expect/revision与完整正文；
- `memory-envelope.js`：桶/段/优先级/计量/降级；
- `event-render.js`：T0/T1/T2、四段、检查点和目录展开；
- `user-portrait.js`：accepted/used画像规则与来源；
- `global-brief.js`：通知候选与提交边界；
- `wb-sidecar.js`/`plan-render.js`/`plan-derived.js`：白板身份/章节/派生关系；
- `lib/index.js` 中渲染器、context回调和consolidate工作流的真实接线；
- 现有测试抽取源码执行与生产模块执行之间的差异。

## 3. 目标模块/API建议

不得先把建议当实现。输出每个模块的：职责、输入、输出、副作用、错误、身份、兼容策略、测试与回滚。

建议分层：
1. **Sources/Readers**：记忆、事件、规则、账本、反思和真实文档读取；来源身份与指纹可验证。
2. **Projection/Policy**：选择档位、规则范围、画像、四段/检查点/事件展开策略。
3. **Envelope/Budget**：统一段身份、桶、优先级、预算、最终长度/token计量和可解释降级。
4. **Notification/Delivery**：prepare/commit分离、最终保留通知、同请求幂等、宿主交付证明。
5. **Adapters/Facade**：`lib/index.js` 只做依赖注入和已有生产契约兼容，不继续复制局部判定。
6. **SidecarStore**：独立派生索引持久化，不在此层决定归属/档位/预算。

避免把每个小函数单独拆成文件；模块边界应按职责和可独立测试性，而不是按7个子项机械建7个孤立模块。

## 4. 每个3.x子项的调查内容

| 子项 | 独立可验证内容 | 与共同管线关系 |
|---|---|---|
| 3.0.1 规则指针/全文 | 用户+项目读取、层内索引、完整多行正文、旧编辑协议 | 由Reader与规则政策提供 |
| 3.0.2 完整规则/维护提醒 | human_full完整有效正文、human_slim保留、run_slim移除 | 由档位政策提供 |
| 3.0.3 水位默认关闭 | 默认/解析/客户端真源、25%负路径、现有显式配置保留 | 不改配置迁移权限 |
| 3.0.4 总预算/最终计量 | 分桶、尾巴、最终total、复读/未投不误记 | Envelope/Delivery核心 |
| 3.0.5 定稿/通知可靠 | prepare/commit、旧commit不清新待办、写盘失败可重试 | Delivery核心 |
| 3.0.6 白板/账本裁剪 | 去除错误预截断、后部失败/下一步保留、内容身份与预算 | Projection/Envelope |
| 3.0.7 真实回调 | 真import/调用、同请求双调用、真实宿主project/retained | 最终验收而非仅单元测试 |
| 3.1 consolidate扩读取面 | 日志+事件+白板+账本+反思来源/预算与prompt构造 | 数据来源独立，工作流写入须分离 |
| 3.2 四段消费 | 失败/卡点进入最终帧；字段空不输出 | Projection策略 |
| 3.3 检查点截断 | 首尾/动态内容、段级与总预算 | Projection/Envelope |
| 3.4 事件展开 | active数量、id/正文、总预算 | Projection策略 |

## 5. 调查方法与验收

- 开工记录HEAD、工作树、源码行尾与文件指纹；按函数/字段定位，不依赖旧行号。
- 用真实模块导入/调用验证数据形状；外部依赖返回值先查声明或权威调用点。
- 对旧报告做版本标注；已提交后的HEAD不可当旧缺陷的对照物。
- 隔离构造正常/空/超长/失败/跨语言/多事件场景；不触碰真实记忆或19387。
- 明确已证缺陷、待裁定边界、未测范围和错误探针；不把存在文件或源码字符串当完成功能。
- 输出可复算PASS/字节数/sha与运行日志；本任务没有训练或生产验收结果时必须明确写未验。
- 不修改`lib/`、`prototypes/`、2.9文件、生产配置或真实记忆；不commit/push。

## 6. 交付物

1. `docs/internal/INVESTIGATION-BATCH3-MODULAR-API-20261113.md`：现状图、接口矩阵、模块化建议、依赖/并行边界、风险与停止条件。
2. `docs/internal/DETAIL-BATCH3-IMPLEMENTATION-20261113.md`：按3.0–3.4列出模块/API/验收/文件边界和串行接入顺序。
3. 每个建议给实际代码/调用点证据；不需要重写已定版3.0范围或替用户裁定3.0-B。
4. 所有与2.9、2.3和Prototype的接口都写“调用什么/返回什么/谁负责写入/何时不执行”。
