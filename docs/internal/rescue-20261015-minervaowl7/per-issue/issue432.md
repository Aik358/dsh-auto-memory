# #432 · “不让 AI 使用的来源”只过滤 hits，Tier-0 原文目录绕过排除

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:28:13Z
- **代码**：A12
- **正文字符**：4045
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A12 · 问题与优先级
   
   建议优先级：**P1**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   injectExcludeSources 包含 project，或具体路径/目录/记忆 ID；相应原文仍是 sources；hits 为空或已经被过滤。
   
   ## 入口 → 错误点 → 用户影响
   
   配置经宿主传 excludeSources → filterExcludedSourcesPre 只处理 gateHits0.kept → catalog 仍 buildTier0CatalogFromTextPre(o.sources) → 目录标题/摘要保留被排除来源 → 常驻目录进入注入。
   
   ## 实际结果与期望结果
   
   **实际：** 已有真实源码模块隔离观测 excludeSources=["project"]、hits=[]，Tier-0 仍有 project 正文摘要。
   
   **期望：** 明确排除应覆盖每条注入通道：Tier-0、Tier-1、Tier-2；排除内容不能影响下探判定、配额或注入文本。
   
   ## 固定版本源码证据
   
   - [lib/tier-layer-inject.js:117–180](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/tier-layer-inject.js#L117-L180)
   - [lib/tier-layer-inject.js:497–520](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/tier-layer-inject.js#L497-L520)
   - [lib/index.js:7730–7739](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L7730-L7739)
   - [lib/tier0-catalog.js:324–344](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/tier0-catalog.js#L324-L344)
   
   关键短片段（固定版本原文）：
   
   ```js
     const gateHits0 = filterCurrentHitsPre(o.hits)
     // 群反馈第 4 条：用户显式排除的来源（坏记忆不再反复灌入）。与 I5 同层、同在闸门之前 ——
     // 被排除项不得再影响下探决策，否则"排除了却仍然下探/占预算"等于没排除。
     const exHits = filterExcludedSourcesPre(gateHits0.kept, o.excludeSources)
     const gateHits = { ...gateHits0, kept: exHits.kept }