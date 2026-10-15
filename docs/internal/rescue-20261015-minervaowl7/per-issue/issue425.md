# #425 · 迁移导入新增子路径可穿过目标内已有目录链接写到记忆根外

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:27:07Z
- **代码**：A05
- **正文字符**：3389
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A05 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   targetDir/linked 已为指向根外现存目录的 symlink/junction；包里 files 包含 linked/new.md，不含 .. 或绝对路径；根外 new.md 不存在；正常预览并确认导入。
   
   ## 入口 → 错误点 → 用户影响
   
   _readExistingWorkspaceFiles 用 lstat 将 linked 记 unsupported 且不遍历 → planImportPre 只查完整 linked/new.md 键，视为 addition → join(targetDir,rel) → mkdir 父目录沿已有目录链接 → lstat 最终 new.md 得 ENOENT → writeTextAtomicPre 沿祖先链接落盘；文件锁未验证祖先物理归属。
   
   ## 实际结果与期望结果
   
   **实际：** 静态推导上述合法包路径会被规划为新增，并进入可创建根外文件的路径；没有操作系统级运行结果。最终文件不存在检查只能防同名占用，不能约束父目录。
   
   **期望：** 写入、备份与冲突材料都在已准入物理根内；无法验证祖先归属时拒绝该写入，不产生根外文件。
   
   ## 固定版本源码证据
   
   - [lib/index.js:9418–9441](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L9418-L9441)
   - [lib/migrate-pack.js:288–311](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/migrate-pack.js#L288-L311)
   - [lib/index.js:9687–9732](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L9687-L9732)
   
   关键短片段（固定版本原文）：
   
   ```js
         const additions = new Set(plan.additions.map(item => item.path))
         for (const [rel, text] of Object.entries(plan.writeFiles)) {
           if (typeof existing[rel] === 'string' && existing[rel] === text) continue // 内容相同 ⇒ 宿主识别并跳过实际写入
           const abs = path.join(targetDir, rel)
           await mkdir(path.dirname(abs), { recursive: true })
           const rec