# #436 · EvidenceEventStore 多分片清理落入夹层，强制 sweep 后仍超过 32MiB

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:28:58Z
- **代码**：A16
- **正文字符**：2905
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A16 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   至少两个未过期分片；例如两个各 20MiB；总量 40MiB 超过 maxTotalBytes=32MiB，清理目标扣 2MiB 余量后为 30MiB；即使显式 force=true。
   
   ## 入口 → 错误点 → 用户影响
   
   sweepRetention 扫描排序并保留未过期 alive → while 要求删一片后总量仍>=target → 40-20=20<30，不删 → 裁剪仅 alive.length===1 才执行，当前为 2 → 清理返回 swept=true/after=40MiB。
   
   ## 实际结果与期望结果
   
   **实际：** 已有注入文件元数据的源码方法探针：before=after=40MiB，删除 0、裁剪 0。并非真实 40MiB 文件运行。
   
   **期望：** 每次实际 sweep 在无 IO 故障时总量收敛到目标或声明上限；任何分片组合都不能停在超限夹层。
   
   ## 固定版本源码证据
   
   - [lib/evidence-store.js:220–285](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/evidence-store.js#L220-L285)
   
   关键短片段（固定版本原文）：
   
   ```js
         if (total > target && alive.length) {
           // 先整文件删最老的:删到「再删一个就会低于 target」为止 —— 整删比回写便宜得多。
           while (alive.length > 1 && total - alive[0].size >= target) {
             const f = alive.shift()
             try { rmSync(f.fp, { force: true }); this.stats.sweptFiles++; total -= f.size } catch (_) { alive.unshift(f); break }
           }
           // 仍超限 ⇒ 只剩最新的一个分片可动:逐行回写裁剪到剩余额度,保住**最新的**事件。
           if (total > target && alive.length === 1) {
             const f = alive[0]
             const keepBudget = Math.max(0, target - (total - f.size))
             const cut = this._trimFileToBudgetPre(f.fp, keepBudget)
             if (cut && cut.removed > 0) { total -= cut.freedBytes; this.stats.sweptTrimmed = (this.stats.sweptTrimmed || 0) + 1 }