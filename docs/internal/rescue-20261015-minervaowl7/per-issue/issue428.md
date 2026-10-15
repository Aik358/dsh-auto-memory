# #428 · 会话切换模型后，事件扫描可把旧模型窗口嫁接到新模型

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:27:47Z
- **代码**：A08
- **正文字符**：3003
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A08 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   同一会话先有旧 large 模型 request/context，contextWindow=1000000；后出现新 small 的 request/header，config.maxTokens=8192，但此新事件不带 contextWindow；按倒序扫描事件。
   
   ## 入口 → 错误点 → 用户影响
   
   findSessionModelPre 倒序 → 先取最新 model/provider/maxTokens → 仍缺 contextWindow，继续向前 → 取旧模型 contextWindow → 输出 small/1000000/8192；即使上层窗口缓存已经失效，也会得到错误的新扫描结果。
   
   ## 实际结果与期望结果
   
   **实际：** 已有源码函数隔离探针输出 model=small、contextWindow=1000000；旧模型大窗口和新模型身份被拼在一起。
   
   **期望：** provider/model/window/output budget 必须来自同一请求或同一有效模型边界；新模型没有窗口则返回未知，再按新路由配置查询，不能借旧模型值。
   
   ## 固定版本源码证据
   
   - [lib/water-window.js:92–114](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/water-window.js#L92-L114)
   
   关键短片段（固定版本原文）：
   
   ```js
       const provider = String(cfg.provider || d.provider || '')
       const model = String(cfg.model || d.model || '')
       const cw = Number(d.contextWindow) || 0
       const mt = Number(cfg.maxTokens) || 0
       if (!out.model && model) { out.model = model; out.provider = provider }
       if (!out.contextWindow && cw > 0) out.contextWindow = cw
       // maxTokens = 路由为**本次请求预留的输出预算**,provider 会把它计入 "requested tokens"(实测:
       // 消息 666,044 + 预留 384,000 = 1,050,044 > 上限 1,048,576 → 400 CONTEXT_WINDOW_EXCEEDED)。
       if (!out.maxTokens && mt > 0) out.maxTokens = mt
       if (out.model && out.contextWindow && out.maxTokens) break
     }
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变