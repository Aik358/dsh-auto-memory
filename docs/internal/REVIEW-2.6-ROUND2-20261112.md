# 2.6 第二轮独立调查：旧路径显式归属

> 来源：独立 Kimi subagent 0cdf4bc6，2026-11-12；Lead 落盘。只读；未改文件/真实记忆，未执行新测试。

## 一、先纠正审查结论

REVIEW 的「旧Phase1/Phase3/plan mirror全部不传eventId」不准确。现状是：Phase1确实漏传args.eventId（index.js:25613-25624）；但Phase3已传walEventId（:25648-25653），plan mirror也已传（:25691），walEventId来自Phase1返回值（:25625）。appendHandoffCheckpointPre本就有可选eventId（event-write.js:696-712）。故不是三条独立丢归属，而是入口漏传导致后两者继承错误目标。v3的统一门面方案应缩小。

## 二、最小生产改动（仅旧路径）

1. event-write.js：显式eventId分支先用readStorePre按id直查，仅active/paused通过；closed、未知、非法均抛带code=event-id-unavailable的错误，在文档写入前失败，绝不fallback。无eventId保持原样：最新updatedAt active；无active（含只有paused/closed）才createEventForWorkPre；不引入L1/词袋/容器，不改memory_log。
2. index.js：Phase1仅加eventId: args.eventId，并更新参数说明「R4首建之外，也可指定旧handoff/plan归属」。Phase3/mirror不改，继续用同一个返回walEventId。
3. event-store.js无需改：append已拒unknown/closed、允许paused，并保留锁内最终状态闸门；预读不包外层锁，避免与create/append嵌套。无需appendEventNotePre、event-write-api.js、新工具/配置。

## 三、边界与单次写入

显式active/paused成功只新增1条checkpoint、不新建事件；plan mirror仅set sections，不再加checkpoint。文档失败仍按旧Phase3额外写1条失败补偿，2.8另处理，不能在2.6宣称所有失败+0。fromEvents仍读取全部事件并稳定定序/归档旧卡，显式eventId只决定plan投影归属，不过滤来源、不重绑各事件。kind=note不接事件。

A1独立：R4-on handoff走LedgerDocSystem/WAL/sink，不走旧append；首建eventId与更新文档eventIds均校验active/paused，更新沿用_cur.eventIds，额外args.eventId目前不参与更新；changeSet改绑已有event-ids-conflict约束。保持ledger-doc/*不动，重绑回执另行裁定。R4-on无documentId/maintenanceTopic拒绝；R4-off+documentId拒绝，maintenanceTopic仍无效；plan无论R4开关均走旧路径。

## 四、真实正负测试（隔离临时记忆根，真engine/tool+真event-store）

正：显式active与paused各写handoff，指定事件+1、其他事件+0、新建0；plan验证一条plan checkpoint及同事件sections mirror；无eventId覆盖最新active、仅paused/closed时created，固定时钟比较旧契约。

负：closed/未知/非法id均回event-id-unavailable，事件/检查点+0、PLAN/账本字节不变；真实stale revision触发Phase3，确认原plan与plan-write-failed同属显式id。A1真实create/update/CAS/changeSet冲突保持原回执且无旧全文checkpoint。隔离副本删除Phase1透传、删掉paused放行、把显式无效id改fallback，测试必须分别变红；不得仅做源码字符串断言。

## 回滚

撤Phase1透传、参数说明及显式预检即可恢复旧fallback；不迁移、重写或删除已追加检查点，A1零回滚。
