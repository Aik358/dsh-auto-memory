# #439 · 预算丢弃的联想记忆仍生成 seen，投递引用与证据数量不一致

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:29:27Z
- **代码**：A19
- **正文字符**：3834
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A19 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   启用联想投递；8 个合法候选，每条约 480 ASCII 字符；默认 4096 字节包预算触发整条丢弃；contextHost 有全部候选对应 provenance；投递 ack 成功。
   
   ## 入口 → 错误点 → 用户影响
   
   buildReferenceTailPacketPre 保存全部 references → renderReferenceTail 预算筛选，仅 5 块文本 → packet.references 仍 8 → renderTailFor 重渲染并 markDelivered → createSeenEvidences 遍历全部 packet.references → 8 条 seen，而实际仅 5 条展示。
   
   ## 实际结果与期望结果
   
   **实际：** 已有真实模块隔离观测 references=8、渲染=5、budget dropped=3；静态宿主链确认 ack 后按 8 个引用创建证据。
   
   **期望：** seen 只描述实际渲染并确认投递的引用；offered 候选与 delivered 引用应分开，展示计数、digest、清理和证据同源。
   
   ## 固定版本源码证据
   
   - [lib/activation-inbox.js:274–303](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/activation-inbox.js#L274-L303)
   - [lib/activation-inbox.js:373–425](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/activation-inbox.js#L373-L425)
   - [lib/activation-host.js:460–510](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/activation-host.js#L460-L510)
   
   关键短片段（固定版本原文）：
   
   ```js
     async function createSeenEvidences(runtime, packet) {
       try {
         const ch = engine._contextHost
         const identity = identityFor(runtime)
         if (!ch || !identity) { stats.seenSkippedNoProv += packet.references.length; return }
         const evidences = []
         for (const ref of packet.references) {
           const prov