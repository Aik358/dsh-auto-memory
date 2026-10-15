# #423 · 团队 viewer 的 GET 下行被统一写权限门阻断

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:26:53Z
- **代码**：A03
- **正文字符**：2783
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A03 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   teamEnabled=true；本机显式登记 viewer；read-team 允许而 write-own-memory 禁止；执行 pull（GET）或后台下行调度。
   
   ## 入口 → 错误点 → 用户影响
   
   团队初始化把 _teamFetch 包成 gatedFetch → pull.fetchJson 用 _teamFetch(p,{method:"GET"}) → 包装不区分动作，始终 _assertTeamActionPre("write-own-memory") → GET 出口未被调用 → fetchJson 返回错误，下行不能完成。
   
   ## 实际结果与期望结果
   
   **实际：** 已有隔离探针中 viewer 读权限允许，但 pull 的 mock fetch 调用数为 0，被本机写门拒绝。
   
   **期望：** viewer 能执行已授权的只读下行；上传和队列发送仍拒绝，拒绝发送的条目保留在队列。
   
   ## 固定版本源码证据
   
   - [lib/index.js:14848–14868](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L14848-L14868)
   - [lib/index.js:15004–15017](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L15004-L15017)
   
   关键短片段（固定版本原文）：
   
   ```js
           const rawFetch = engine._teamFetch
           if (typeof rawFetch === 'function') {
             const gatedFetch = async (...args) => {
               engine._assertTeamActionPre('write-own-memory')
               return await rawFetch(...args)
             }
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变化来自版本说明/启动配置回执改动）：
   
   - [lib/index.js:14848–14868（当前 main）](https://github.com/Aik358/dsh-auto-memory/blob/832e256205290a7f9f02024701d0466c4ae2a5cc/lib/index.js#L14848-L14868)
   - [lib/index.js:15004–15017（当前 main）](https://github.com/Aik358/dsh-auto-memory/blob/832e256205290a7f9f02024701d0466c4ae2a5cc/lib/index