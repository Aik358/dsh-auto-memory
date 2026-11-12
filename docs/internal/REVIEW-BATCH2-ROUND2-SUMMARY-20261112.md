# 批次2第二轮调查汇总（2026-11-12）

> 四条独立 Kimi subagent 调查已完成，Lead 已落盘；生产代码未改，未跑实现验收。

## 推荐生产顺序

### 1. 2.6（可先实施的最小独立项）

只给旧 memory_note Phase 1 透传 args.eventId，并在 appendHandoffCheckpointPre 的显式分支预检 active/paused。Phase 3 与 plan mirror 已经传 walEventId，不需要统一门面。无 eventId 保留原 fallback；A1 保持独立。报告见 REVIEW-2.6-ROUND2-20261112.md。

### 2. 2.5（独立模块+单一写域串行实施）

自动重绘默认关闭；事件事务成功后触发，不挂 refreshEventStatePre 刷新链。先在 writePlanSnapshot 的 PLAN 锁内合并：eventId→旧锚点、model 派生区、user 备注与自有卡保留，再复用现有 CAS/M1/sidecar。归档不是保留。报告见 REVIEW-2.5-ROUND2-20261112.md 与 DETAIL-2.5-IMPLEMENTATION-20261112.md。

### 3. 2.7（先做全文模式，不提前做摘要）

G-2 未裁定前不生产启用摘要。先做无副作用下钻与全文兼容实现；未来若启用摘要，仅限 2.7 新路径，先独立裁定 document→checkpoint 顺序，再从真实落盘 Buffer 计算 rawsha/normalizedSha；2.6 旧全文路径不连带改序。真实 sourceRef、真实工具下钻、sectionsOverride 与完整幂等键。handoff 退出 RAG 需同步过滤 event-recall 与 index 内联实现。报告见 REVIEW-2.7-ROUND2-20261112.md。

### 4. 2.8（同源预检，终检不省）

不比较未来 r；抽共享无 IO 判据做预检，正式写盘仍走原锁/CAS/门。M1 仍是警示，不误变硬拒；fromEvents/紧急接续保持原契约。R4/A1 不加第二套 Phase0。报告见 REVIEW-2.8-ROUND2-20261112.md。

## 必须用户裁定

- G-1 容器事件、G-2 摘要算法/上限/超限/失败语义；
- A1 更新是否允许重绑 eventIds；
- 旧 handoff 是否改为先写真源后写检查点；
- 缺段与 2.9 的边界，以及人工自有卡的长期保留/迁移协议。

## 并行纪律

大并发仅用于调查、独立模块、隔离测试；lib/index.js 的共享入口由 Lead 串行修改。真实记忆、19387、2.4 归并均不动。2.6 的最小性不等于跨批可同时改同一文件。
