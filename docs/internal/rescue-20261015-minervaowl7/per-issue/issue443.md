# #443 · JS 模型下载开始/取消请求失败被空 catch 吞掉，界面无错误回执

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:29:49Z
- **代码**：A23
- **正文字符**：3088
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A23 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   打开两个 JS 安装引导入口之一；点击开始下载或取消；apiPost 发生网络错误、非 2xx、业务 ok:false/error 或 JSON 读取失败。
   
   ## 入口 → 错误点 → 用户影响
   
   按钮 startDl/cancelDl → apiPost reject → then(refreshSemNow) 不执行 → catch(function(){}) 吞错误 → 不写错误/请求状态，也不刷新后端权威状态 → 点击可能无可见变化，用户无法确认是否开始/取消。
   
   ## 实际结果与期望结果
   
   **实际：** 源码确认两个入口均空 catch；没有浏览器点击复现。成功链已引用正确 refreshSemNow，不能再报 #89 已修复的自递归。
   
   **期望：** 开始/取消有请求中与失败提示；请求失败后核对权威任务状态，明确操作是否被确认，保留重试。
   
   ## 固定版本源码证据
   
   - [lib/client.js:3565–3574](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/client.js#L3565-L3574)
   - [lib/client.js:15329–15337](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/client.js#L15329-L15337)
   - [lib/client.js:18356–18364](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/client.js#L18356-L18364)
   
   关键短片段（固定版本原文）：
   
   ```js
               var startDl = function () {
                 apiPost(API.semanticDownload, { action: 'start', mirror: mirror }).then(refreshSemNow).catch(function () {})
               }
               var cancelDl = function () {
                 apiPost(API.semanticDownload, { action: 'cancel', mirror: mirror }).then(refreshSemNow).catch(function () {})
               }
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变化来自版本说明/启动配置回执改动）：
   
   - [lib/client.js:3577–3586（当前 main）](https://github.com/Aik358/dsh-a