# #444 · Python 重启后旧进程迟到 error 清空新进程引用，并误拒新请求

- **作者**：Minervaowl7
- **创建**：2026-10-14T15:29:56Z
- **代码**：A24
- **正文字符**：3217
- **留档来源**：会话转录 `session-2a0bcb89`（2026-10-15 抢救）
- **⚠️ 该 issue 在 GitHub 上已不可访问**（作者账号被封控）

---

## A24 · 问题与优先级
   
   建议优先级：**P2**。审计固定 SHA：`3d55c4552fc0662ce9f5ba03a62d5f98effb50f0`（PR #420 head）。该 head 与合并提交 `394fdbe22a9729ca577d6a251a6d723fd4d7f051` 的 tree 均为 `a995a6dcdd5ed0b144f5747fc12c3c995a59a505`。发布前 main 已更新为 `832e256205290a7f9f02024701d0466c4ae2a5cc`（v3.3.4）；已只读核对 [合并版至当前 main 的完整差异](https://github.com/Aik358/dsh-auto-memory/compare/394fdbe22a9729ca577d6a251a6d723fd4d7f051...832e256205290a7f9f02024701d0466c4ae2a5cc)，本项机制未被该更新修复。
   
   ## 现状、完整触发前提与事件时序
   
   客户端已启动 procA；调用 restart，旧引用清空但事件监听仍在；下一次请求启动 procB/新 epoch；procA 此后发出 error。旧 stdout/stderr data 也未检查当前进程身份。
   
   ## 入口 → 错误点 → 用户影响
   
   restart reject 旧请求并 kill A → ensureStarted 建 B → A.error handler 直接 child=null/epoch=null/rejectAll("unavailable") → 当前 B 被遗忘，B 在途请求被误拒。exit 有 child!==proc 防护，error/stdout/stderr 没有同等边界。
   
   ## 实际结果与期望结果
   
   **实际：** 已有真实 createPythonSidecarClient 源码+模拟进程事件探针：before started=true、epoch=wk_pre_…02；触发 A.error 后 started=false、epoch=null、newProcessKilled=false。B 并未被 kill，但状态不再追踪它。
   
   **期望：** 旧代事件仅记录该进程历史诊断，不写当前 buffer/stderr/epoch/child，不 reject 新代 pending；当前代真实错误仍按既有故障协议处理。
   
   ## 固定版本源码证据
   
   - [lib/python-sidecar-client.js:390–437](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/python-sidecar-client.js#L390-L437)
   - [lib/python-sidecar-client.js:646–658](https://github.com/Aik358/dsh-auto-memory/blob/3d55c4552fc0662ce9f5ba03a62d5f98effb50f0/lib/python-sidecar-client.js#L646-L658)
   
   关键短片段（固定版本原文）：
   
   ```js
       proc.on('error', () => {
         // spawn 失败(ENOENT 等):结构化失败,不计崩溃重启
         const wasChild = child
         child = null
         epoch = null
         void wasChild
         rejectAll('unavailable')
         noteFailure('unavailable')
       })
   ```
   
   当前 main 对应位置（问题逻辑与固定审计版一致，行号变化来自版本说明/启动配置回执改动）：
   
   - [lib/python-sidecar-client.js:390–437（当前 main）](https://github.com/Aik358/dsh-aut
"}],"isError":false,"id":"3f81b267-2a8d-40a4-9e02-b037f2c10362"}},"sourceEventSeqs":[3463],"surfaceOp":"append"}
{"type":"step/end","seq":3465,"time":1791992761420,"data":{"turn":26,"step":1}}
{"type":"step/start","seq":3466,"time":1791992761734,"data":{"turn":26,"step":2}}
{"type":"user/message","seq":3467,"time":1791992761735,"data":{"content":[{"type":"text","text":"Current runtime context. This snapshot supersedes earlier runtime-context snapshots.

Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.

Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`)."}],"source":{"kind":"runtime-context","form":"snapshot","sections":[{"name":"sandbox:policy","text":"Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations."},{"name":"approval:policy","text":"Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`)."}]},"role":"user","id":"804f4bc0-3bd4-479f-8688-44a9cdcf60df"},"surfaceOp":"append"}
{"type":"assistant/message","seq":3468,"time":1791992773357,"data":{"turn":26,"step":2,"message":{"role":"assistant","content":[{"type":"reasoning","text":"23 new issues (#422-#444), all from Minervaowl7, created 2026-10-14T15:26-15:29Z (i.e., right after my 3.3.4 release). The user wants me to reply saying we'll fix them this weekend.

Let me first do a quick triage — verify they're real (spot check a few key claims against current code), then post a single consolidated reply. Actually the user said "这个给他回复一下，周末就修" — reply to him, fix this weekend.

Best approach: post one consolidated comment. But where? These are 23 separate issues. Options:
1. Post one comment on each issue acknowledging (23 comments)
2. Post one summary comment... but where? There's no tracking issue.

Given #357 is the process issue, I could post there. But each issue needs its own acknowledgment so he knows each one is tracked.

Actually — the most useful thing: verify each claim quickly (at least spot-check), then post a per-issue brief acknowledgment + one consolidated plan comment on #357.

But time is limited. Let me be efficient: 
1. Quick verification pass — check a few claims against current code to make sure these are real (not stale)
2. Post per-issue acknowledgment comments (23)
3. Post a consolidated plan on #357

Let me first check if these are already known/fixed, and verify a sample. Let me look at the remaining bodies too (I only saw partial). Let me get the rest of the list #422-444.

Actually I have 23 issues: 422,423,424,425,426,427,428,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443,444. That's 23.

Let me verify a couple of the claims empirically since that's my strength — e.g., #430 (episodic-store shift both arrays) and #434 (wbEntryIdPre hash collision) and #427 (YAML quoting). These are quick source checks.

Let me do a fast verification of a sample, then reply.

Given the user wants a reply and says "周末就修" (fix this weekend), I should:
1. Acknowledge each issue (per-issue comment, brief, referencing priority + when)
2. Post a plan comment somewhere consolidated

Let me verify first — quick spot checks on several."},{"type":"text","text":"23 new issues (#422–#444) from Minervaowl7, filed right after my 3.3.4 release. Let me verify they're real before replying."},{"type":"tool-call","id":"call_00_5gcMYvaaBxMivtuRDo7M2728|item_5cd87cdc153942f1e83da6d0","name":"run_code","arguments":"{"code":"\
const fs = await import('node:fs');\
const D = 'D:\\\\dsh-auto-memory';\
const read = (p: string) => { try { return fs.readFileSync(D + '\\\\' + p, 'utf8') } catch { return '' } };\
\
console.log('=== A01 #422: pythonRuntimeCached TTL / cache publish guard ===');\
const idx = read('lib/index.js');\
const m1 = idx.match(/engine\\._pyRtCache\\s*=\\s*out[\\s\\S]{0,80}/);\
console.log('  ' + (m1 ? m1[0].replace(/\\
/g,' ').slice(0,120) : 'pattern not found'));\
\
console.log('\\