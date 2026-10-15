# #422 · Python 健康缓存过期后，显式召回无法发布新探测结果而持续降级

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:26:37Z
- **代码**：A01
- **正文字符**：3131
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A01 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   同一有效配置身份；先做完整健康检测，使 _pyRtCache.worker 和 _pyWorkerVerdict 有值；随后闲置超过 10 分钟；不重启、不手动重新完整检测；再执行显式 Python/auto 召回。
   
   ## 入口 → 错误点 → 用户影响
   
   显式召回 → preparePythonRecallPre → pythonRuntimeCached 因 TTL 返回 null → probePythonRuntime({interpreterOnly:true}) → 不执行 worker health，产生无 worker 的新 runtime → 提交保护拒绝覆盖旧带 worker 的缓存 → prepare 再读缓存仍为 null，或对象身份不一致 → 返回 false，Python 臂不能进入后续索引/召回。
   
   ## 实际结果与期望结果
   
   **实际：** 过期强结果继续占据 _pyRtCache；本次新解释器探测结果不能成为当前缓存。返回条件 current===runtime 无法满足，后续同形显式召回持续退回兜底。这里的“持续”限定上述状态未被完整重测/失效/重启解除期间。
   
   **期望：** 过期的 worker 健康结论不应阻止新鲜解释器结果发布；当前身份、代次和资产有效时，显式召回应能继续，或有界升级健康检测后继续。
   
   ## 固定版本源码证据
   
   - [lib/index.js:16008–16039](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L16008-L16039)
   - [lib/index.js:16052–16088](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L16052-L16088)
   
   关键短片段（固定版本原文）：
   
   ```js
         if (generation === (engine._pyRtGeneration || 0) && latestIdentity === identity) {
           if (!(engine._pyRtCache && engine._pyRtCache.identity === identity && engine._pyRtCache.worker && !out.worker)) {
             engine._pyRtCache = out
             engine._pyRtCacheAt = Date.now()
           }
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变化来自版本说明/启动配置回执改动）：
   
   - [lib/index.js:16008–16039（当前 main）](https://github.com/Aik358/dsh-auto-me