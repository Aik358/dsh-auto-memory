# 官方反馈定稿（子代理报告路由）

> 目标仓库:`deepseek-ai/deepseek-harness`(Discussions · 分类 **General**)
> 发帖入口:https://github.com/deepseek-ai/deepseek-harness/discussions/new?category=general
> 说明:第三方插件 dsh-auto-memory 为**非官方**项目,帖内已按社区规则标注。

---

## 标题

```
[Bug Report] 会话接续后，后台子代理的完成报告仍投递给旧会话；父会话不在册时通知被静默丢弃
```

## 正文

```markdown
## 环境
- `@deepseek-ai/dsh` **0.1.5-rc.1**，Windows 11，web profile
- preset：`standard`（`agent.cordis.yml` 里 `backgroundMode: continuable`，所以后台子代理默认走 continuable 路径）
- 场景：用第三方插件（非官方，我自己维护的 dsh-auto-memory）实现**会话接续**——上下文水位到阈值时新建会话 B、把交接材料注入 B，旧会话 A 仍然 live。

## 现象
1. 会话 A 派出的后台子代理结束后，报告落在 **A** 里；接续出来的会话 **B 收不到**任何东西——用户在 B 里等结果，永远等不到。
2. 更严重：如果 A 已经被 dispose，这条报告**彻底消失**——没有任何日志、告警或替代投递，表现为“子代理跑了但什么都没回来”。

## 最小复现
1. 在会话 A 里让 agent 起一个后台子代理（`subagent` 工具，默认 `run_in_background`）
2. 在子代理结束**之前**，把工作搬到会话 B（接续、或手工直接开新会话继续都一样）
3. 子代理结束后回到 A：报告在 A；B 里什么都没有
4. 若先关掉 A 再等子代理结束：两边都收不到，也没有任何提示

## 代码定位（0.1.5-rc.1，`@deepseek-ai/dsh-subagent/lib/index.js`）
- **运行时绑定**：`activation.parentSession = parent.id`（:1087-1098）在 spawn / cold-resume 时写死为**字符串**；durable 侧 `SessionHeader.parentSession` 也是 readonly（`dsh-session/lib/types/types.d.ts:71`）。
- **结算投递**：`notifySettlement()`（:1244-1259）
  \`\`\`js
  const parent = this.ctx.agents.get(activation.parentSession)
  if (parent === void 0) return                       // ← 静默丢弃，无日志
  const message = createSettlementMessage(activation.childId, terminal)
  this.sendWaking(parent, message, parent.status === "idle" ? "queue" : "steer")
  \`\`\`
- **契约里没有 re-parent**：`SubagentRuntime` 的公开方法是 `start / startContinuable / sendMessage / interrupt / listChildren / listDescendants / remoteExportList / prompt / interruptByParent / drainContinuableChildren / drainContinuableDescendants / registerProvider / getProvider / list`，**没有 transfer / reassign / attach / rebind**。
- **新会话接不过去**：`sendMessage` → coldResume → `authorizeLineage` 直接抛 `UNAUTHORIZED`（“belongs to another parent session”）。
- **查询侧同父过滤**：`listChildren(newSessionId)` 查不到旧子代理（:2073 按 `record.header.parentSession === parentSessionId` 过滤），只有拿旧 id 才查得到。

## 影响
- 任何“会话迁移 / 接续 / 交接”类工作流（插件或人工）都会丢上下文；上下文满得越快，这个操作越常规（我们这边 30 分钟一满）。
- 静默丢弃让问题不可见：没有日志行可查，用户只能看到“子代理没回话”。
- 长跑子代理尤其致命：它们往往正是最需要投递结果的那批。

## 建议（任意一条都能覆盖）
1. 给一个**显式的转发口子**：例如 `subagents.reassign(childId, newParentSessionId)`，或在 `notifySettlement` 前提供可挂载的 hook，让宿主/插件把结算通知投到指定会话；
2. 或至少把“父不在册”从静默 `return` 改为**可见**：`logger.warn` 一行，并考虑把 `lastAssistantMessage` 落到子会话持久文件、在 catalog 里标出来；
3. 或让 `listChildren` / `remoteExportList` 支持按**根会话树 / 工作区**查询（现在只有“直系父 id”这一条路），这样接续后的新会话至少能自己发现并读取还在外面跑的子代理。

## 我们目前的绕过方案（仅供参考，不要求官方照做）
- 接续前用旧会话 id 调 `listChildren`，把未完成子代理清单写进交接材料；
- 插件旁听 `subagent/end` / `session/event`，收到结算通知就把文本**复制**投给新会话（`agents.get(newId)` → `followup` / `inject`）。
- 局限：这只是“复制”，旧会话仍会收到原件；而且依赖旧会话在结算时仍 live，否则连复制都没有素材。

（我是 dsh-auto-memory 插件作者，上面提到的插件是**第三方、非官方**项目。）
```

---

## 微信群短文案（约 200 字，可直接粘）

```
【DSH 0.1.5-rc.1 · Bug 反馈】子代理完成报告在会话接续后会投错窗口

现象：会话 A 派出的后台子代理结束后，报告落在 A；用新会话 B 接着干活时 B 什么都收不到。
更麻烦的是，如果 A 已关闭，报告会**静默消失**（无日志无告警），看起来就像“子代理跑了但没回话”。
定位到 dsh-subagent 的 notifySettlement：父会话 id 在 spawn 时写死，结束时按它现查注册表，查不到直接 return。
插件的落点：dsh-subagent/lib/index.js:1244-1259（静默丢弃在 :1249）。

已在官方 Discussions 提了详细报告（含最小复现、代码定位与三条建议）：
<在此粘贴讨论链接>

希望官方能给一个结算通知的转发/重定向口子，或至少让“父会话不在册”这件事可见。
```
