# #424 · 技能明确弃用后只更新状态，已有导出 SKILL.md 未退休

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:27:00Z
- **代码**：A04
- **正文字符**：3851
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A04 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   技能曾成功 active 并导出到插件自有 mem-skill-* 目录；之后用户明确 deprecate，或命中自动弃用；导出文件未被手动移走。
   
   ## 入口 → 错误点 → 用户影响
   
   deprecate → stage=deprecated 和 JSON 持久化 → review 路由直接返回；导出清扫只在新 exportSkillForPre 成功后执行，且排除当前导出目录 → 明确弃用没有调用退休导出流程 → SKILL.md 继续存在。
   
   ## 实际结果与期望结果
   
   **实际：** 源码链路没有撤下已导出的发现文件。宿主是否继续发现/缓存该 SKILL.md 尚未实测，应作为验收项，不能称宿主动态复现。
   
   **期望：** 明确弃用后插件自有导出不再处于宿主可发现的活动状态；保留用户资源和用户修改，逐项报告退休失败。
   
   ## 固定版本源码证据
   
   - [lib/procedure-store.js:715–723](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/procedure-store.js#L715-L723)
   - [lib/procedure-store.js:374–397](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/procedure-store.js#L374-L397)
   - [lib/index.js:18331–18351](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L18331-L18351)
   - [lib/skill-export-host.js:88–136](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/skill-export-host.js#L88-L136)
   - [lib/skill-export-host.js:203–235](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/skill-export-host.js#L203-L235)
   
   关键短片段（固定版本原文）：
   
   ```js
     function deprecate(procedureId, reason = 'user-disabled') {
       const p = procedures.find((x) => x.procedureId === procedureId)
       if (!p) return {