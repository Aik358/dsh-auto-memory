# 2.8 第二轮独立调查：同源预检、并发与幂等

> 来源：独立 Kimi subagent 4003f680，2026-11-12；Lead 落盘。只读，未改文件/真实记忆，未跑实现验收。

## 结论

v3方向可保留，但不能按 PREKNOWN_CODES/GATES 比较尚未产生的 r。最小生产方案是「同源只读预检 + 原写盘终检」，不建第二套错误码门。

1. Phase0置于旧路径Phase1前（index.js:25605），输入固定为同一 writeH、archIds、expectedRevision/cardId/expectedCardRevision及调用模式。plan基于同一 existing 得到 prepared.incoming，再调同一 checkMutationPre({target,beforeText:existing,afterText:incoming,archivedIds,skipCriteria})。criteria、CAS/卡格式、重复id、用户区、M2/M3等确定性拒绝均事件+0；M1仍按现逻辑放行+警示，不能变硬拒。preparePlanPre的冲突分支会经 conflictPlanPre 写 conflicts（plan-store.js:182-211），故不能原样当只读预检；应抽共享无IO判据，或注入禁止副作用模式，正式writePlanSnapshot仍复用它。
2. 预检不是并发保证：保留 writePlanSnapshot 的 PLAN锁、latest!==existing外部编辑检查及全部原门（index.js:5357-5397,5461-5464）。预检后到锁内发生变化，由正式写入返回原错误并走Phase3，不能凭预检成功跳过终检。
3. handoff预检须按 writeHandoffLedger 同样生成 fullText 后检查；beforeText=''，mutation为not-applicable。criteriaGate=false不得被重新启用。fromEvents沿用渲染后content与合并archivedIds，旧卡显式归档不等于全局放松M1。水位接续当前直接writeHandoffLedger，不应被新增memory_note Phase0误拦；未来共用一个门面时须保留skipCriteria:true+警示降级，绝不绕过mutation。缺段允许不能套到普通memory_note，H1/H2仍有效。
4. 锁：createEventForWorkPre与append共用_storeWriteChains→acquireSharedStateLock(<store>+'.lock')，不可外层再持withEventStoreLockPre调用append/create，否则自等死锁。归属只读解析、必要create、最终append可串行进独立临界区；文档IO不得放进事件锁，也不承诺「读归属+建事件+append」原子。
5. 幂等：idemKey按eventId作用域查重；不要改成短摘要哈希，否则会吞掉同事件不同sourceRef/正文意图，也不能跨事件误去重。旧路径沿用ledgerPath+NUL+ledgerText及kind前缀。普通opId台账只有at（event-store.js:414-446），同opId不同载荷目前会错误dedup；若本批引入opId，必须登记完整append输入的canonical digest并拒绝op-payload-mismatch，不能只哈希摘要。R4已有operationDigest/payloadDigest，不改。
6. 回滚/边界：仅删除Phase0调用即恢复Phase1→2→3，未知IO/EPERM仍Phase3+1；不得删除既有事件或文档。若后续2.7改成document→checkpoint，文档成功而事件失败只能显式partial并重试，不能删append-only数据或自动回滚文档。G-1未裁定不加container/配置；R4/A1不加第二道Phase0；2.4继续冻结。

## 最低验收

criteria/CAS/mutation均事件+0，M1仍警示，未知EPERM+1；fromEvents与紧急接续行为不变；两进程写不丢、嵌套不死锁；同opId异载荷拒绝。只读源码与两份文档，未跑实现验收。
