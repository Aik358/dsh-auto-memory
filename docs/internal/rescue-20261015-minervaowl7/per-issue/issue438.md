# #438 · 迁移包校验和漏掉 userFiles，日历内容损坏仍通过完整性检查

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:29:09Z
- **代码**：A18
- **正文字符**：3783
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A18 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   有效 dam-pack-v1 含普通 files 和 userFiles.CALENDAR.md；仅日历文本改变一个字符，files 与 checksum 不变；再次 inspect/validate 后正常确认导入。
   
   ## 入口 → 错误点 → 用户影响
   
   buildPackPre 将日历存 userFiles，但 checksum=packChecksumPre(files) → validatePackPre 对 userFiles 仅检查路径和 string → got 仍只取 pack.files → 校验通过 → _applyUserFilesPre 合并已变动日历。
   
   ## 实际结果与期望结果
   
   **实际：** 静态证明日历内容未参与摘要，单字符损坏不影响比较结果。未实际调用函数或导入。预览 token 覆盖完整 pack，不存在同样遗漏。
   
   **期望：** 完整性摘要应覆盖所有实际导入内容与影响解释/重写的元数据；内容损坏应在规划与写入前拒绝，明确旧格式覆盖范围。
   
   ## 固定版本源码证据
   
   - [lib/migrate-pack.js:136–145](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/migrate-pack.js#L136-L145)
   - [lib/migrate-pack.js:174–195](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/migrate-pack.js#L174-L195)
   - [lib/migrate-pack.js:203–235](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/migrate-pack.js#L203-L235)
   - [lib/index.js:9500–9516](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L9500-L9516)
   - [lib/index.js:9570–9595](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L9570-L9595)
   
   关键短片段（固定版本原文）：
   
   ```js
     if (!errors.length) {
       const want = pack.checksum && pack.checksum.value
       const got = packChecksumPre(pack.f