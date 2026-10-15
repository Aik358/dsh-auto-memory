# #427 · 技能标题含冒号空格时 description 未做 YAML 引用，自检仍成功

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:27:41Z
- **代码**：A07
- **正文字符**：3048
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A07 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   合法技能标题/摘要包含 Deploy: verify 等 YAML 特殊标量；导出前置项目名、procedureId 和其他字段均有效。
   
   ## 入口 → 错误点 → 用户影响
   
   renderSkillMarkdownPre → summaryOfPre 文本仅替换换行 → 拼 description: 原始文本 → validateSkillMarkdownPre 仅正则检查 frontmatter/name/description 存在 → host 自检通过后写 SKILL.md。
   
   ## 实际结果与期望结果
   
   **实际：** 渲染探针产生 description: Deploy: verify；validate 返回 ok:true。未运行宿主 YAML 解析器，不能声称宿主已实际拒载；生成内容的 YAML plain-scalar 结构存在语法问题。
   
   **期望：** 任意接受的标题/摘要均导出为合法 YAML 字符串，并能经实际解析器读回同一 description；自检不得只检查字段字符串存在。
   
   ## 固定版本源码证据
   
   - [lib/skill-export.js:116–129](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/skill-export.js#L116-L129)
   - [lib/skill-export.js:223–238](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/skill-export.js#L223-L238)
   - [lib/skill-export-host.js:167–178](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/skill-export-host.js#L167-L178)
   
   关键短片段（固定版本原文）：
   
   ```js
     const L = []
     L.push('---')
     L.push('name: ' + skillDirNamePre(p))
     L.push('description: ' + summaryOfPre(p).replace(/\r?\
/g, ' '))
     L.push('---')
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变化来自版本说明/启动配置回执改动）：
   
   - [lib/skill-export.js:116–129（当前 main）](https://github.com/Aik358/dsh-auto-memory/blob/832e256205290a7f9f02024701d0466c4ae2a5cc/lib/skill-export.js#L116-L129)
   - [lib