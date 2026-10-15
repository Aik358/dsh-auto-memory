# #435 · 存储索引修复成功未使常驻语料缓存失效，恢复记忆仍无法召回

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:28:54Z
- **代码**：A15
- **正文字符**：3950
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A15 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   首次读取因 sidecar 缺失/损坏得到可缓存的空/不完整 records；正文 size/mtime 不变；存储管理 repair 成功重建 sidecar；同进程后续召回复用 CorpusRegistry。
   
   ## 入口 → 错误点 → 用户影响
   
   CorpusRegistry.get 按 workspaceKey 缓存，以正文 size:mtime 识别变化 → repair 仅 rebuildSidecar → 路由直接返回，无消费者 invalidate → 下一次 get changed=[] 返回旧 snapshot → 新修复记录不可用。
   
   ## 实际结果与期望结果
   
   **实际：** 已有 exact class 隔离探针：修复前后 loader 仅调用 1 次；第二次仍返回空 records。生产 repair 路由静态确认无 invalidate。
   
   **期望：** 正文不变的索引修复后，下一次召回应重载派生数据；来源集合变化也不能继续返回旧 snapshot。
   
   ## 固定版本源码证据
   
   - [lib/m4-corpus.js:153–182](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/m4-corpus.js#L153-L182)
   - [lib/storage-manage.js:141–161](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/storage-manage.js#L141-L161)
   - [lib/index.js:18372–18383](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L18372-L18383)
   - [lib/index.js:15720–15725](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L15720-L15725)
   
   关键短片段（固定版本原文）：
   
   ```js
       for (const s of catalog.sources) {
         const fp = sourceFingerprint(s.file)
         fingerprints.set(s.canonicalFile, fp)
         const prevFp = cached && cached.fingerprints.get(s.canonicalFile)
         if (prevFp !== fp) changed.push(s)
       }
       if (cached