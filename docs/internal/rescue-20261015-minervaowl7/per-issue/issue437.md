# #437 · Python 向量构建异常仍确认 accepted，JS 缓存 ready 后同版本不再重试

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:29:04Z
- **代码**：A17
- **正文字符**：4539
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A17 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   语料 index commit 成功 accepted=true；embedder 存在，但 build_vectors 因临时异常失败；worker epoch、正文 miv 和引擎 generation 不变；随后再召回。
   
   ## 入口 → 错误点 → 用户影响
   
   SemanticWorker.handle_index_commit 调父类接收语料 → 尝试 build_vectors catch 仅 diag → 原 accepted 帧仍返回 → JS sendIndexSync 成功 → readyCache 写 miv/epoch → 后续 ensureIndexReady 命中 ready 跳同步 → dense_search 无匹配 vectors 仅返回 []，不会建向量 → Python 臂持续空结果，回退 JS/词法。
   
   ## 实际结果与期望结果
   
   **实际：** 跨语言静态链确认 corpus accepted 被当作 semantic ready；临时构建失败未形成可重试状态。没有运行 Python 复现。
   
   **期望：** 语料接收成功与向量就绪分别回执；构建失败不能被缓存为语义就绪，同版本下一次允许有界重试并展示原因。
   
   ## 固定版本源码证据
   
   - [python/worker_semantic_v1.py:851–865](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/python/worker_semantic_v1.py#L851-L865)
   - [python/worker_semantic_v1.py:410–448](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/python/worker_semantic_v1.py#L410-L448)
   - [python/worker_semantic_v1.py:1017–1036](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/python/worker_semantic_v1.py#L1017-L1036)
   - [lib/m7-index-sync-host.js:95–126](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/m7-index-sync-host.js#L95-L126)
   - [lib/m7-index-sync-host.js:148–160](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98