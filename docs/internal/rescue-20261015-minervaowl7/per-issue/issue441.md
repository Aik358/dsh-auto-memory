# #441 · 清空召回统计落盘失败仍返回成功，重启恢复旧记录

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:29:37Z
- **代码**：A21
- **正文字符**：2951
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A21 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   已持久保存至少一条 recall event；用户显式清空；write/rename 注入拒写或临时 IO 故障；随后重新加载模块/重启。
   
   ## 入口 → 错误点 → 用户影响
   
   reset 先 state=empty、dirty=true → save catch 返回 false → route 忽略返回值，HTTP ok:true/reset:true → 当前内存显示空 → 磁盘旧记录未替换 → 重启 load 恢复旧事件。
   
   ## 实际结果与期望结果
   
   **实际：** 已有全模块+虚拟 IO 隔离输出 resetResult=false、inMemoryEvents=0、afterRestartEvents=1；路由静态确认仍 ok:true。
   
   **期望：** 持久清空失败不得宣告成功；内存与磁盘状态一致，或显式 pending 且用户可见。
   
   ## 固定版本源码证据
   
   - [lib/recall-stats.js:117–131](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/recall-stats.js#L117-L131)
   - [lib/recall-stats.js:252–256](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/recall-stats.js#L252-L256)
   - [lib/index.js:18703–18714](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L18703-L18714)
   
   关键短片段（固定版本原文）：
   
   ```js
           if (method === 'POST') {
             const url = new URL(req.url || '/', 'http://localhost')
             if (url.searchParams.get('reset') === '1') {
               engine._recallStats.reset()
               return writeJson(res, 200, { ok: true, reset: true })
             }
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变化来自版本说明/启动配置回执改动）：
   
   - [lib/recall-stats.js:117–131（当前 main）](https://github.com/Aik358/dsh-auto-memory/blob/832e256205290a7f9f02024701d0466c4ae2a5cc/lib/recall-st