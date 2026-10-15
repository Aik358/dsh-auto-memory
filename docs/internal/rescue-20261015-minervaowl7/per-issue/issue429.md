# #429 · 官方压缩模型策略缺省字段不继承所属预设，相同配置也误判歧义

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:27:54Z
- **代码**：A09
- **正文字符**：3218
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A09 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   scanned 含 preset 全局 ratio/headroom 和仅覆盖部分字段的精确 modelPolicies；另一个场景是两个 preset 的最终 ratio/headroom 完全相同。
   
   ## 入口 → 错误点 → 用户影响
   
   pickOfficialParamsPre → exact 只保存 src 与 pol，丢所属 preset 参数 → 缺省字段变 null → ratios/heads 各自回官方默认；歧义判断把 ratios 与 heads 拼成同一个 Set → 一个比例值和一个 token 数天然不同 → multi 时相同配置也报 ambiguous。
   
   ## 实际结果与期望结果
   
   **实际：** 已有隔离观测：partialPolicy 返回 ratio=0.8、headroomTokens=20000、source=modelPolicy:demo（缺省 headroom 未继承 preset）；两个相同策略返回 0.8/65536、candidates=2 却 ambiguous=true。
   
   **期望：** 逐字段顺序为 modelPolicy→所属 preset 全局值→官方默认；按归一化完整 (ratio,headroomTokens) 元组比较不同，数值一致不得报冲突。
   
   ## 固定版本源码证据
   
   - [lib/official-compaction.js:153–197](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/official-compaction.js#L153-L197)
   
   关键短片段（固定版本原文）：
   
   ```js
     const ratios = cand.map((c) => (typeof c.ratio === 'number' && c.ratio > 0 && c.ratio <= 1) ? c.ratio : OFFICIAL_DEFAULT_RATIO)
     const heads = cand.map((c) => (typeof c.headroomTokens === 'number' && c.headroomTokens >= 0) ? c.headroomTokens : OFFICIAL_DEFAULT_HEADROOM)
     const ratio = Math.min(...ratios)
     const headroomTokens = Math.min(...heads)
     const distinct = new Set(ratios.map((r) => String(r)).concat(heads.map((h) => String(h))))
     const multi = cand.length > 1
     const src = (ratios.length && heads.length)
       ? cand.filter((c) => (typeof c.ratio