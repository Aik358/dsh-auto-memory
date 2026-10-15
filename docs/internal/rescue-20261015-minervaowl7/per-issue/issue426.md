# #426 · 高风险技能编辑撤销批准后，activate 可重新激活且召回误称已确认

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:27:13Z
- **代码**：A06
- **正文字符**：4298
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A06 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   已批准并 active 的高风险技能；update 修改 steps/preconditions/checks/rollback/successCriteria 中至少一项；批准被重置且 stage 降为 validated；随后调用 activate，无新的 approve。
   
   ## 入口 → 错误点 → 用户影响
   
   update → approved=false、approvals=[]、stage=validated → activate 只检查 validated，设 active → activeProcedures 只按 stage 返回 → renderChecklist 高风险分支输出“已确认可参考”。导出另有 requiresApproval 门，实际执行提示仍要求用户确认。
   
   ## 实际结果与期望结果
   
   **实际：** 已有真实源码函数探针可将 approved=false 的 validated 技能重新变成 active，进入 active 查询与“已确认”提示。
   
   **期望：** requiresApproval && !approved 的技能不得 activate，不应进入可用 active 召回或使用已确认措辞；approve 当前受控内容后才可激活。
   
   ## 固定版本源码证据
   
   - [lib/procedure-store.js:824–850](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/procedure-store.js#L824-L850)
   - [lib/procedure-store.js:631–640](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/procedure-store.js#L631-L640)
   - [lib/procedure-store.js:890–891](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/procedure-store.js#L890-L891)
   - [lib/procedure-store.js:920–927](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/procedure-store.js#L920-L927)
   - [lib/skill-export-host.js:156–159](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/skill-export-h