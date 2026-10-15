# #442 · 外部来源关闭期间旧扫描仍可发布，禁用来源继续缓存与检索

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:29:43Z
- **代码**：A22
- **正文字符**：4278
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A22 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   外部来源开启；discover 正在等待某来源 stat/read；此时保存配置关闭该来源；保存触发强制刷新但旧扫描仍在途；随后释放旧 IO。
   
   ## 入口 → 错误点 → 用户影响
   
   pushMd 在 await 前 enabled(id) 通过 → 配置关闭并 refresh/discover(true) → bucket.scanning 直接返回旧 Promise → 旧任务 await 返回后无 generation/enable 复核 → bucket.cache=旧 srcs → search 与同步注入 cache 读取不再按当前配置过滤。
   
   ## 实际结果与期望结果
   
   **实际：** 已有真实源码类+虚拟 IO 交错观测 enabledNow=false，cachedSources=["workbuddy-user"]，searchHits 仍含 WorkBuddy 用户记忆/fixture unique。同步注入链读取这些来源路径，其他摘要入口也消费 discover 结果。
   
   **期望：** 关闭来源立即从缓存读入口排除；旧扫描不得发布新配置的可用结果；强制刷新必须服务当前配置。
   
   ## 固定版本源码证据
   
   - [lib/index.js:3359–3374](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L3359-L3374)
   - [lib/index.js:7093–7097](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L7093-L7097)
   - [lib/index.js:13712–13739](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L13712-L13739)
   - [lib/index.js:13791–13796](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L13791-L13796)
   - [lib/index.js:13832–13866](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/index.js#L13832-L13866)
   - [lib/index.js:8156–8168](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba