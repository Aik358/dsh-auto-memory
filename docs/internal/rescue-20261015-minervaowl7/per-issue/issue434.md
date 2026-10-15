# #434 · 白板不同章节同名卡片自动生成重复 ID，保存后单卡编辑恒冲突

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:28:48Z
- **代码**：A14
- **正文字符**：3673
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A14 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   一份未手工带锚点 PLAN：两个不同章节均有“### 下一步”；工作区与相对文件相同；正常全文保存后按其中一卡片 ID 做单卡编辑。
   
   ## 入口 → 错误点 → 用户影响
   
   writePlanSnapshot → anchoredPlanPre 对每个 heading 单独 applyAnchorsPre(ws,"handoff/PLAN.md",heading) → wbEntryIdPre 仅 hash ws/path/title → 两个同标题同 ID → writeTextAtomicPre 发布 → preparePlanPre 单卡更新发现同 ID 数量不是 1，报 plan-card-conflict。
   
   ## 实际结果与期望结果
   
   **实际：** 静态调用链确认两个合法重复标题被赋同 ID；单卡唯一性检查必定拒绝，不能靠重新读取 revision 解决重复身份。尚未运行本项。
   
   **期望：** 同名标题合法，新卡 ID 唯一且持久稳定；已有 ID 及改名/移动后的身份保留；重复显式 ID 应在落盘前明确拒绝。
   
   ## 固定版本源码证据
   
   - [lib/plan-store.js:40–62](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/plan-store.js#L40-L62)
   - [lib/wb-sidecar.js:78–83](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/wb-sidecar.js#L78-L83)
   - [lib/wb-sidecar.js:645–650](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/wb-sidecar.js#L645-L650)
   - [lib/plan-store.js:100–115](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/plan-store.js#L100-L115)
   - [lib/index.js:3772–3781](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L3772-L3781)
   
   关键短片段（固定版本原文）：
   
   ```js
   export function wbEntryIdPre(workspaceKey, relPath, title) {
     const h = createHash('sha256')
       .update(S