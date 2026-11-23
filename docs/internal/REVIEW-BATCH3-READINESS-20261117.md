# 批次3开工闸门复核（Lead · 2026-11-17）

> 基线：be9a2466 + 本轮文档修订。
> 结论：B3-CB可以开工；业务模块不宜立即全面并行施工。
> 推荐：阶段串行、同一阶段适度并行、共享入口串行接线。

## 1. 当前是否可以直接开工

可以开工的对象是：
- 修三处已知恒真/假绿断言；
- 建立真实import/构造/apply/context验收面；
- 冻结公共DTO/profile与依赖注入边界。

还不能把整套批次3直接并行展开，原因不是文档不全，而是若干共享输入和状态边界必须在对应阶段先闭合。

## 2. 新旧修改面覆盖

| 修改面 | 新契约 | 覆盖结论 |
|---|---|---|
| 规则完整读取/指针 | SR/RC/RP | 已覆盖；补候选规则、owner/session与readFile注入 |
| 帧节奏 | CA | 已覆盖首帧、真人/运行、间隔、水位、压缩与特殊档 |
| 内容投影 | PJ | 已覆盖；ContentSpec补calendar/externalMemory/workspaceMap/recentLogs/reflection/diagnostic/maintenance与现有段 |
| 白板/账本 | BD | 已覆盖按节、尾部、2000预截断与2.5边界 |
| 最终计量 | FM | 已覆盖尾巴、通知、反思、候选/实际分账与最终账实一致 |
| 通知/交付 | NT/CB | 已覆盖prepare/finalize/commit、版本幂等、宿主未交付与运行时作用域 |
| 事件视图 | EV | 已覆盖四段、检查点、展开、目录去重、members/rel/quoteRef/sourceRef |
| consolidate | CO | 已覆盖五类来源、写入分离、USER待确认与失败不写 |
| Prototype/R4 | 非目标边界 | 已覆盖派生索引/CAS/幂等、默认关闭与生产未验 |
| 2.3/2.5–2.9/4.1/4.5/5.1 | 跨批接口 | 已覆盖消费、来源与最后实施边界 |

覆盖是“任务与契约覆盖”，不是“目标API已实现”或“生产通过”。

## 3. 开工前本轮补出的缺口

1. RC API原先只有userFile/notesPath，未覆盖candidatePath/ownerSessionId/sessionKey/readFile；已补。
2. ContentSpec原先漏calendar/externalMemory/workspaceMap/recentLogs/reflection/diagnostic/maintenance等段；已补。
3. NT原先未明确运行时作用域与共享状态写入；已要求runtimeScope/sessionId及现有队列/锁/CAS/原子替换，Prototype不得作跨文件事务。
4. CO同型路径未显式提及maintain/autoSummary；已要求审查但不扩写未授权路径。
5. L2并行边界过于概括；已明确“纯实现可并行、共享入口串行、共享契约不得并行修改”。

## 4. 推荐并行与串行表

| 阶段 | 可并行 | 必须串行/等待 |
|---|---|---|
| B3-CB | 三处测试修复、隔离变异装置 | 生产契约不能因测试改造而提前改变 |
| 公共契约 | DTO纯构造/校验、facade构造 | 公共字段与版本由Lead统一收口 |
| SR/RC | 全来源读取与规则聚合可在不同写域并行 | 共享来源身份、reader注入与旧CAS验收统一 |
| CA/PJ | cadence纯函数、ContentSpec纯策略可并行 | 两者共同决定帧输入，完成后联验 |
| RP | 规则纯呈现可独立实现 | 必须等RC读取与PJ策略可用 |
| NT/BD/FM | 通知、白板选择、计量可在独立文件先实现 | 最终帧、共享状态与lib/index.js接线必须串行 |
| EV | 四段/检查点/目录纯函数可并行 | 服从FM，事件真实投影与指针联验 |
| CO | 只读收集可在SR后独立实现 | 写入由现有工作流串行，不能并行写全局记忆 |

## 5. 最终开工建议

不是一步一步地把所有代码串行写完，也不是所有模块同时开工。

采用：
1. CB先行；
2. 公共契约统一收口；
3. 每个阶段内，在契约已冻结、写域不重叠时并行纯实现；
4. 共享状态、共享契约与lib/index.js始终单写者；
5. 每单位独立验收与提交，再做下一阶段；
6. 真实HOST/生产启用另行验收。

当前文档已可作为B3-CB的开工依据。若CB通过，再按L2分阶段派发后续模块，不在本报告中宣称功能完成。
