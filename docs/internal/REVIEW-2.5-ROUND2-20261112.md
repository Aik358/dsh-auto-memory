# 2.5 第二轮独立调查：身份、人工内容与锁内合并

> 来源：独立 Kimi subagent 38211389，2026-11-12；Lead 落盘。只读，未改文件/真实记忆/19387。

## 最小方案

保留 plan-render + writePlanSnapshot，增加纯函数 mergeDerivedPlanPre(existing, rendered)，并在 writePlanSnapshot 已取得 PLAN.lock、读到 latest existing 后调用；禁止锁外读旧白板再合并，否则人工编辑会被覆盖。开关独立、默认关，勿限 graph（legacy 也消费 PLAN）。只用现有 model/user 与 mem_ 锚点，不建平行状态。

## 身份

DETAIL 的 ordinal seed 不足：plan-render 仍优先按时间/ordinal排序，anchoredPlanPre 对新卡按标题+同名出现序造 id，不继承旧锚点。每个派生事件卡保存 eventId→memId 的可读绑定（放 model 区，不改对外 id 类型）；重绘先按 eventId 继承旧 memId，改名、时间变化、重排均不换锚点；新事件才由 anchoredPlanPre 分配。首次迁移不可仅凭同名猜绑旧卡：无绑定旧卡原样保留，明确迁移预览后才认领。graph 的 ## 四节锚点同样继承。

## 内容

仅替换已标记 model 的派生正文；其 user 备注段逐字节按 memId 回填。未认领旧卡、自有卡、独立 user 区原位置/字节/锚点保留，不得进 archivedIds。消失派生卡若含 user 区，整卡冻结保留；无备注且确认消失才可显式归档。归档不是保留，M1 目前可降级照写。渲染30k截断、绑定缺失/重复、user区未闭合均拒绝自动写，不靠事后警示。

## graph

splitSectionsPre 只切 ##，buildSectionCardsPre 主键=ws+relPath+节标题+同名序号，memId只是anchorId；验四节主键/anchorId稳定、正文和自有卡/备注进入 entries，by_tag/by_cue、expand/trace可见，sourceRevision=planRevision，增量sidecar与全量rebuild等价，失败返回sidecar-stale可观测且不伪报白板成功。

## legacy

真调 memory_read(kind=plan)、整篇写、单卡CAS编辑；planCardsPre涵盖##–####、parseWhiteboardPre/M1只认###+，分别核对集合/唯一性。改名/插入更晚事件/输入乱序/连续重绘后旧memId不变；revision按新正文取，旧revision必须冲突；人工卡、备注逐字节不变，第二次no-change字节+mtime不变。自动重绘失败须返回独立redraw状态，事件已成功不得报整体失败或静默。

## 区分力测试

夹具含两个同名事件、一个改名且时间后移事件、新增较早事件、旧自有卡、派生卡user备注、退出投影但有备注卡。旧实现（裸render+archivedIds）应丢备注/自有卡且换锚点，新实现全保留；先证明旧实现真失败。

隔离副本变异分别删eventId绑定、user回填、自有卡保留、锁内合并、sidecar刷新，逐项必红；再双写者人工备注与事件更新交错，最终两者都在。记录卡数/锚点数/字节数/revision/sidecar条目/PASS-FAIL，不能以源码字符串当验收。
