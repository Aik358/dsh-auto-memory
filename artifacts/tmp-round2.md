===== ISSUE #152: [Bug] 增量嵌入开关保存后不生效：动态 getter 被构造时常量化 =====
## 问题

基线：上游 `main@e64271f`（3.2.5），Windows / Node 24；本问题无需 PR #150。

关闭设置 `semanticEmbedIncremental` 并保存后，引擎仍沿用增量嵌入。宿主在 `lib/index.js` 用 getter 提供动态配置，但 `lib/semantic-js.js` 在构造时执行 `const incremental = opts.incremental !== false`，以后重建一直读这个常量。

## 最小复现

给 `createJsSemanticEnginePre` 传入可切换的 getter 和计数 embedder：

1. getter=true，构建 2 条记录。
2. getter=false，追加第 3 条并更新 `memoryIndexVersion`。
3. 预期：关闭增量后全量嵌入 3 条；实际：只嵌入新增的 1 条。

新增行为回归的修复前输出：

```text
FAIL E2 saved true-to-false getter change re-embeds all 3 records
结果: 27 PASS / 1 FAIL
```

复现使用确定性的注入 embedder，无网络、无真实模型调用。现有测试只检查 getter 接线的源码字符串以及构造时直接传 false，没有覆盖构造后修改配置。

## 建议与验收

在每次索引重建开始时读取 getter，将该轮值固定在重建事务内，避免异步嵌入期间改变配置使同一轮混用策略。新增 true→false→true 行为回归，确认关闭后全量嵌入、重新开启后只嵌新输入。


===== ISSUE #153: [Bug] #144 回退残留：新版 profile 解析失败，provider 与子代理实现名混用 =====
## 问题

基线：上游 `main@e64271f`（3.2.5），Windows / Node 24。属于已关闭 #144 的回退分支残留；无需 PR #150。

首轮子代理遇到 `UNKNOWN_MODEL` 后，默认模型回退有两个独立断点：

1. `readSettingsTextPre()` 已读取新版 profile 的 `cordis.patch.yml`，但 `_runSubagentOnce` 的正则仍要求 `agent-default-model:`，不识别 `- id: agent-default-model`。解析不到模型后重新抛错，开启 30 分钟熔断。
2. 即使旧 block 布局能解析，回退也把 LLM provider 放进 `subagents.start()` 的“子代理实现名”参数，并在 `agentOptions` 里保留原来的错误 provider，仅换 model。主路径已经区分两个命名空间，回退分支尚未同步。

## 最小复现

执行生产 `_runSubagentOnce`，用内存中的宿主替身模拟首次 UNKNOWN_MODEL；无网络、无真实模型调用。

新版设置：

```yaml
- id: agent-default-model
  name: agent-default-model
  config:
    provider: valid-provider
    model: valid-model
```

实际只有一次 start、返回空文本，熔断原因为 UNKNOWN_MODEL。旧布局能解析时，第二次实际参数为：

```text
start('valid-provider', {
  agentOptions: { provider: 'broken-provider', model: 'valid-model' }
})
```

预期保留原注册实现（如 spawn），成对使用默认 provider/model，并保留该任务的思考强度。

## 建议与验收

共用支持新版列表项和旧版 block 的默认路由解析器；在条目边界停止，不从下一个插件借 model。回退的 start 实现名保持不变，同时替换 agentOptions 的 provider/model。

新增行为测试覆盖两种布局、非 spawn 实现、思考强度保留、默认路由缺失及不完整条目。修复前：新版回退、旧版回退、非 spawn 回退及旧条目跨边界取值共 4 项失败。


===== ISSUE #154: [Bug] 自动接续双重创建失败后无工作区创建，将源材料投递到默认工作区 =====
## 问题

基线：上游 `main@e64271f`（3.2.5），Windows / Node 24；无需 PR #150。

`hostAutoContinue()` 中，按源 `workspaceId` 创建失败后改用源 `cwd`。如果再次失败，第三次仅传 `agentPreset`，丢失工作区约束。宿主可能在默认工作区建立会话，随后插件仍投递源工作区材料、标记源会话已接续并通知成功。

这会重新出现“A 区接续到 B 区”，触发点位于创建失败的回退路径；与 #134 的旧材料归属问题不同。

## 最小复现

调用生产 `hostAutoContinue`，将 sessionController.create 替换为：携带 workspaceId/cwd 时抛错，无工作区参数时返回默认 B 的会话。三次实际参数：

```text
{ workspaceId: 'workspace-A', agentPreset: 'code' }
{ cwd: 'C:/fixture-A', agentPreset: 'code' }
{ agentPreset: 'code' }
```

实际：返回 `ok:true`，A 的 carryText 被投递到默认 B，源会话被标记为已接续。

新增行为守卫在修复前 4 项失败：应明确失败、不得第三次无工作区创建、不得投递材料或成功通知、不得给源会话落成功闩锁。原有 `workspaceId` 失败而源 cwd 成功的回归继续保留。

## 建议与验收

保留 `workspaceId → 源 cwd` 的兼容回退；两者都失败时返回真实错误，禁止无工作区创建并继续交接。失败后不落“已接续”标记，允许之后重试。

复现只使用内存中的宿主服务替身；没有创建真实 DSH 会话或读取个人记忆。


===== PR #155: fix: 修复默认模型回退、接续工作区保护与增量开关 =====
## Summary

修复设置保存后增量开关不生效、UNKNOWN_MODEL 回退失败，以及接续创建失败后丢失源工作区这 4 个后端问题。

```text
索引重建 → 读取本轮增量开关
默认模型回退 → 共用 profile/block 解析器 → 保持子代理实现，成对替换 provider/model
接续创建 → workspaceId → 源 cwd → 显式失败
```

仅修改两个生产模块及相应回归测试。基于上游 main `e64271f`，不依赖 PR #150，未修改客户端、皮肤或打包逻辑。

Fixes #152
Fixes #153
Fixes #154

## Evidence

- **Before:** 新增行为回归在未修复 main 上翻红：增量开关 1 项；模型回退核心 4 项；接续失败路径 4 项。
  **After:** 增量 28/28、模型回退及水位共用解析 10 个场景、接续 106/106 断言通过。覆盖新版 profile、旧版 block、非 spawn 实现、思考强度保留、不完整路由及相邻条目隔离；保留 workspaceId 失败后源 cwd 成功的路径。
- 模型与宿主服务用内存替身，未调用真实模型或创建真实 DSH 会话。Windows / Node 24；完整 smoke 使用隔离 USERPROFILE/HOME/DSH_HOME，并遵循 CI 原有排除项。
- 整批 smoke：228 PASS / 1 FAIL / 0 TIMEOUT，167 秒。唯一失败是未改动的 `issue113-116-webhook-guards` 进程以 Windows 原生退出码 3221226505 结束；同一环境单项复验 1 PASS / 0 FAIL。没有把这次复验写成整批零失败；Ubuntu / Node 22 结果以本 PR CI 为准。
- 上游现有 i18n 测试依赖 Acorn；Windows 验证时仅在仓库外临时提供该测试依赖，未修改包依赖或相关测试。
- 入口语法与 `git diff --check` 通过；源码摘要守卫按经审查的新宿主基线更新，并统一 LF/CRLF 摘要口径。
- **Ubuntu / Node 22 CI：** [本 PR](https://github.com/Aik358/dsh-auto-memory/actions/runs/36673082436) 为 222 PASS / 7 FAIL / 0 TIMEOUT，本次所有改动测试均通过。[上游 main 同一基线](https://github.com/Aik358/dsh-auto-memory/actions/runs/36665830081) 有 8 项失败：本 PR 修正了摘要的行尾差异，剩余 7 项失败全部来自主干既有的 Acorn 依赖、CRLF fixture 和客户端源码抽取兼容问题，相关文件与客户端均未修改。PR #150 已包含这些兼容修复，本 PR 按范围约束不带入它们；没有隐藏或排除这些失败项。

## Merge Danger

**Door:** two-way

无存量数据或配置迁移，撤回提交即可恢复原行为。

**Blast Radius:** runtime

影响语义索引重建、默认模型路由与水位解析、宿主自动接续。源工作区创建失败后明确报错，不再无工作区创建并投递源材料。

-- head=eec01d5f base=e64271fd files=7 +/-=223 commits=1 state=unstable