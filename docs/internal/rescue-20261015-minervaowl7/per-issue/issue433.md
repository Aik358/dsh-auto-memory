# #433 · 注入统计读取不存在的 segment.text，已注入段字符数被记为 0

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:28:44Z
- **代码**：A13
- **正文字符**：3293
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A13 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   renderMemoryDynamic 已构造非空 envelope；_recallStats 可用；segments 是 memory-envelope 的投影对象 {bucket,kind,chars}。
   
   ## 入口 → 错误点 → 用户影响
   
   build envelope 保留段文本并计算 chars → 返回 segments 仅含 bucket/kind/chars → 宿主 map 读取 (sg.text||"").length → observeInjection 接受 0 → 面板/持久统计与实际注入账本不一致。
   
   ## 实际结果与期望结果
   
   **实际：** 已有精确映射隔离观测：segments=[{bucket:"memoryReferences",kind:"notes",chars:6}]；实际 memoryReferences=6,total=6；observed=[{name:"notes",chars:0,layer:"memoryReferences"}]。
   
   **期望：** 已注入段按 envelope 的最终 chars 记账；dropped 单独标注未注入，不能混为有正文已送达条目。
   
   ## 固定版本源码证据
   
   - [lib/memory-envelope.js:233–246](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/memory-envelope.js#L233-L246)
   - [lib/index.js:8248–8258](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L8248-L8258)
   - [lib/recall-stats.js:259–277](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/recall-stats.js#L259-L277)
   
   关键短片段（固定版本原文）：
   
   ```js
         if (this._recallStats && envelope && Array.isArray(envelope.segments)) {
           const segList = envelope.segments.map((sg) => ({
             name: sg.kind, chars: (sg.text || '').length, layer: sg.bucket,
           }))
           const droppedList = (envelope.dropped || []).map((x) => ({
             name: x.kind + '(dropped)', cha