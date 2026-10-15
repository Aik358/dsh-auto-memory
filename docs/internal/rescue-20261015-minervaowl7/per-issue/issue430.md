# #430 · 会话片段超过 64 条时同时 shift 两个摘要数组，仍保留的用户目标消失

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:28:00Z
- **代码**：A10
- **正文字符**：3156
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A10 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   同一会话累计 65 条混合角色片段；最旧淘汰项只有 assistantText，用户目标在后续片段中仍被保留。
   
   ## 入口 → 错误点 → 用户影响
   
   append 分别按非空 ut/at push userTexts/assistantTexts → segments 满 64 淘汰最旧 → 无条件同时 shift 两个摘要数组 → 被保留用户片段对应 userTexts 也被删 → consolidate 的 intent/entities/unresolved 使用 userTexts，与 segments 不一致。
   
   ## 实际结果与期望结果
   
   **实际：** 已有模块隔离输出 segments=64，goalInSegments=true，userTexts=[]，assistantCount=63；用户目标原文仍在 segments 但摘要侧不再可见。
   
   **期望：** 文本派生数组应精确对应现存 segments；淘汰纯助手段不得删除仍保留的用户目标，反向也一样。
   
   ## 固定版本源码证据
   
   - [lib/episodic-store.js:166–193](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/episodic-store.js#L166-L193)
   - [lib/episodic-store.js:196–220](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/episodic-store.js#L196-L220)
   - [lib/episodic-store.js:245–274](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/episodic-store.js#L245-L274)
   
   关键短片段（固定版本原文）：
   
   ```js
       // 超 cap:丢最旧段(保留最近上下文)
       while (current.segments.length > cfg.segmentCap) {
         current.segments.shift()
         if (current.userTexts.length) current.userTexts.shift()
         if (current.assistantTexts.length) current.assistantTexts.shift()
       }
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变化来自版本说明/启动配置回执改动）：
   
   - [lib/episodic-store.js:166–193（当前 main）](https://github.com/Aik358/dsh-auto-me