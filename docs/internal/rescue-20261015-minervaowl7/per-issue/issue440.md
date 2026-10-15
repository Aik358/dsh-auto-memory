# #440 · AI 蒸馏成功分支绕过容量门，项目笔记满额仍追加

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:29:32Z
- **代码**：A20
- **正文字符**：3101
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A20 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   maintain 的归档已完成；AI 蒸馏返回非空合法 distillText；项目 note 已到容量上限，ensureBudget 应拒绝；进入成功摘要分支。
   
   ## 入口 → 错误点 → 用户影响
   
   maintain → distillText 真 → 直接 appendText(notesPath,heading+distillText) → append 原语只做角色/卫生/事务，无累计容量门 → 更新 notesText 并回复已写入；fallback 分支却调用 ensureBudget。
   
   ## 实际结果与期望结果
   
   **实际：** 已有真实 maintain 方法隔离探针：ensureBudget 设始终拒绝，成功蒸馏仍 append 一次，budgetCalls=0；无真实模型调用。
   
   **期望：** 成功摘要与 fallback 指针遵守同一容量合同；超额不追加、不伪报已写笔记，已验证归档保留且回执明确部分完成。
   
   ## 固定版本源码证据
   
   - [lib/index.js:13193–13198](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L13193-L13198)
   - [lib/index.js:13216–13234](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L13216-L13234)
   - [lib/index.js:8531–8560](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L8531-L8560)
   
   关键短片段（固定版本原文）：
   
   ```js
       // 3) 蒸馏结果写项目笔记;无 AI 时原样归档段保底
       let noteMsg = ''
       if (distillText) {
         const body = await this.appendText(p.notesPath, '\
## 30 天蒸馏(蒸馏于 ' + this.memToday() + ')\
' + distillText)
         this.state.notesText = body
         noteMsg = '\
蒸馏提炼已写入 ' + p.notesPath + ':\
' + truncateTail(distillText, 600)
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变化来自版本说明/启动配置回执改动）：
   
   - [lib/index.js:13193–13198（当前 main）](https://github.com/Aik358/dsh-auto-memory/