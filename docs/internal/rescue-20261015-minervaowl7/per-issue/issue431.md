# #431 · 撤回或被取代记忆通过 Tier-0 原文目录重新标为 current 注入

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:28:07Z
- **代码**：A11
- **正文字符**：3786
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A11 · 问题与优先级
   
   建议优先级：**P1**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   原文仍保留有 retracted/superseded 状态的合法锚点记录（保留历史）；该文件进入 user/project/log/whiteboard/reflection 的 Tier-0 来源；即使 hits 已过滤或为空，也生成常驻目录。
   
   ## 入口 → 错误点 → 用户影响
   
   宿主从原文构建 sources → composeTieredInjectionPre 对 hits 进行 current 过滤 → catalog 从 sources 单独抽取 → buildRecordPre 未解析记录状态，直接 status=current → Tier-0 常驻目录进入 prompt。
   
   ## 实际结果与期望结果
   
   **实际：** 已有源码函数探针确认撤回内容仍抽成 status=current。宿主静态接线证明这一目录参与注入；不需要 Tier-1 命中。
   
   **期望：** 历史保留内容不应作为当前事实注入；正常 prompt 应滤除非 current，若显式审计历史展示则真实标注状态、原因和替代关系。
   
   ## 固定版本源码证据
   
   - [lib/tier0-catalog.js:303–344](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/tier0-catalog.js#L303-L344)
   - [lib/index.js:7662–7673](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L7662-L7673)
   - [lib/index.js:7730–7739](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L7730-L7739)
   - [lib/tier-layer-inject.js:497–520](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/tier-layer-inject.js#L497-L520)
   
   关键短片段（固定版本原文）：
   
   ```js
   /** 单个单元 → 一条目录项；无实质内容返回 null。 */
   function buildRecordPre(layer, unitLines, ctx, cfg) {
     const lines = unitLines.map(clean).filter(Boolean)
     if (!lines.length) return null
     let title = pickHeadingTitle(lines, cfg.titleChars)
     const c