# Auto Memory CLI/TUI 施工记录

工作树为 `D:/dam-cli-20261126`，分支为 `feat/auto-memory-cli`。2026-11-26 从 `f3b4fa2c48d5bfea072674f7c34899e13b2c9d94` 开工，原生 Goal 的范围为任务书第 1–8 节。

## 基线

- 本机 DSH 修复分支 HEAD 为 `3e2e895e65ed3644c26c3eb3051eb5ae5b9935d2`，父级是 Desktop 0.2.2-rc.5 对应的 `9c2670d3bce5275e0d1610272958121af87787bb`。已用安装版 Electron 44.7.0 / Node 24.21.0、真实 Cordis Loader、编译后的 Session Query 和 SQLite，在隔离数据上重跑已提交索引。更新中 HTTP 和模型工具都取到旧快照，发布后取到新快照，未知会话返回 400。编译 SQLite SHA-256 为 `e6155aa98e495e8920a918830a47dc25828a29bdb9694829027456edb871fc2a`。该回归装载真实宿主索引，并以独立 HTTP 装置调用插件处理器。
- 蒸馏重入 8 项回归通过，含派发卡住、超时归档、字节回读不符时保留活跃原文、关闭失败后的延迟清理。模型和子代理时序由可控测试装置提供。
- `v3.4.6` 对照使用 npm 实际安装包。归档 SHA-256 为 `37c6affd317581e2c88c1e1c73f3f93c2357839b90c81ff9d83027d22ae3b510`。源码起点 package.json 标注 3.4.4，加载身份同时显示包版本、构建指纹和实例代次。

## 已接入

- 版本化契约在 DSH 现有 HTTP carrier 内运行。默认同账号发现先做实例挑战验证，显式连接复用 DSH `/connect` 和 owner Peer。CLI/TUI 只运行客户端代码。旧 WebUI 路径锁保持 87 条，终端契约单独回归。请求绑定于已验证会话和明确项目目标。配置修订校验在原事务锁内执行，写操作可按请求 ID 核对回执。回执的保留边界为当前插件实例。
- `dam` 和客户端导出已接入开发清单与 release 清单。已用正式 release dry-run 生成候选包，隔离 Windows PowerShell 与 Git Bash 的 PATH 安装和启动均通过。正式候选完成真实 Desktop 装载、设置、检索、白板检查点、停机和重连。旧的同一个客户端也发现并调用了隔离服务新增的 `validation.echo`。发布守卫在实际挂载的变异实例报告该操作新增。
- 同一 Web 处理器的专项回归已通过。运行时清单回归经真 `apply()` 和隔离 HTTP 注册调用，验证逐操作 schema、鉴权、实例与会话、设置读回、CAS、重复请求、笔记与事件、工具参数和退出码。

## 复跑

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
$run = Start-Process -FilePath 'G:/dsh_desktop/DeepSeek Harness.exe' -ArgumentList @(
  'D:/dam-repair-proof-20261126/verify-compiled-host-and-plugin.mjs',
  'G:/dsh_desktop/resources/app.asar/dsh',
  'D:/dam-cli-20261126'
) -RedirectStandardOutput ([IO.Path]::GetTempFileName()) -WindowStyle Hidden -Wait -PassThru
Get-Content -LiteralPath $run.StartInfo.RedirectStandardOutput
Remove-Item Env:ELECTRON_RUN_AS_NODE
node tests/smoke/smoke-test-maintain-reentry.mjs
node tests/smoke/smoke-test-terminal-contract.mjs
node tests/smoke/smoke-test-api-paths.mjs
node tools/run-smoke.mjs --filter=batch3 --jobs=3 --timeout=30000
node tools/inventory-auto-memory.mjs --check
```

直接执行 Electron GUI 二进制时 PowerShell 可能不等待输出，重跑时保留重定向文件和退出码。配置、会话、模型输入、浏览器和终端验证均使用隔离资料。真实 Desktop Host 和外部宿主各线证据记录在本目录的验收文件。

## 恢复点

- 最终同包候选为 `D:/dam-cli-delivery-20261126/verified/workspace-final-v10/a9i5k4-dsh-auto-memory-3.4.4.tgz`，SHA-256 `b7d02e7f3aaec4a7f9a4e584e4273713d54069e194dddc6cc6f809a4a5f26d01`，加载构建 ID `d7858175a04c517fdc90937cf6537213fa57f506ef02d6a053acaeeaffe47c59`。公开契约 1.0，共 124 项。已完成隔离 npm 安装、真实 DSH Desktop、ConPTY、Codex、ZCode、OpenCode 和 Claude 验收，详见 [宿主回执](auto-memory-cli-host-evidence.md)。
- 2026-11-27 在最终归档的安装目录上复跑隔离 Desktop 基线，日志 `D:/dam-cli-delivery-20261126/verified/workspace-final-v9/sessionless-write-final.log`。已登记但无会话的工作区通过 `memory.read` 读取原文，经 CLI 确认执行 `memory.note`，按显式 request ID 读到 `finished` 回执，且原文件路径及内容匹配。相同运行还通过匿名拒绝、正式 `/connect`、修订/CAS、设置并发冲突、Web 写入被 CLI watch 观察、索引 `committedSearchVersion=1`、停机与重连。
- v10 ConPTY 复跑 `D:/dam-cli-delivery-20261126/verified/workspace-final-v10/tui-restoration-lifecycle.log` 已通过。120×29 与 53×24 导航验收后，独立 ConPTY 完成事件 `create → set → append → rename → close`，以及 note `retract → restore`，核对最终 revision、状态、检查点、outcome 和原文读回。
- 最终归档用户级来源复跑 `D:/dam-cli-delivery-20261126/verified/workspace-final-v9/external-user-final.log` 已通过。批准的 `claude-global` 接入写入用户文件，重复请求不复制链接，A/B 工作区读到同一用户级状态；限定移除保留来源文件且不改变项目笔记。`memory.external.import.user` 和 `memory.external.remove.user` 的完整待验项已关闭，其他来源格式仍保留待验。
- v10 记忆专项 `D:/dam-cli-delivery-20261126/verified/workspace-final-v10/memory-actions-final.log` 已通过。真实 Desktop 验收笔记替换 CAS 与拒绝路径、条目展开的跨项目隔离、事件检索的工作区范围、日志归属预检、PLAN 标签展开与来源追踪、撤回、替代、恢复和 `archivedIds`。
- 当前 v10 候选为 `D:/dam-cli-delivery-20261126/verified/workspace-final-v10/a9i5k4-dsh-auto-memory-3.4.4.tgz`，SHA-256 `b7d02e7f3aaec4a7f9a4e584e4273713d54069e194dddc6cc6f809a4a5f26d01`，构建 ID `d7858175a04c517fdc90937cf6537213fa57f506ef02d6a053acaeeaffe47c59`，公开契约 1.0，共 124 项。该包已隔离 npm 安装并通过 `dam.cmd --version --json`、真实 DSH Desktop TUI、恢复和 archivedIds、Codex、ZCode、OpenCode、Claude 宿主复跑。`memory.note.invalidate` 的 restore/archivedIds 待验已关闭。
- npm registry 的 latest 是 3.4.6，当前本机 `npm whoami` 返回 `ENEEDAUTH`。npm 发布保持可选状态，未执行发布。GitHub 推送在最终工作树审查后执行。
- CLI 工作区浏览是独立于对话的明确产品决策。用户可以自由切换已登记工作区查看记忆、事件和设置。浏览器页签变化不改 CLI 目标。会话级写入保留显式会话目标，工作区级授权操作可在无对话工作区确认执行。宿主回合、插件任务和终端请求在来源工作区显示绿点及「处理中」，无色模式仍显示文字状态。
- Codex 0.171.0、ZCode 0.18.0、OpenCode 1.19.6、Claude Code 2.1.152、Kimi Code 2.8.0 和 Cloud Teahouse Cloud Code 0.2.0 已按各自已证实的扩展面保存隔离宿主记录；Antigravity CLI 1.5.18 已验证 ACP 握手和真实 DSH 桥接，但真实模型会话未获认证。具体能力、限制和复跑入口见 [宿主适配验收](auto-memory-external-hosts.md) 与 [Kimi 和 Cloud Code 验收](auto-memory-kimi.md)。
- 最后一次全量 smoke 共 669 套，653 PASS、12 FAIL、1 TIMEOUT、3 FLAKY，日志为 `D:/dam-cli-delivery-20261126/regression/final-package-123/full-smoke.log`。终端与 EV4 影响集分别 4/4、5/5 通过，`r26-cross-layer` 26/26，`task31-p0p2` 31/31。全量结果与后续定向通过分开记录，不能用影响集通过覆盖全量失败项。
- 当前矩阵有 188 个行为映射、124 项公开操作、0 项未映射、29 行部分覆盖提示，另有 34 项操作仍保留 `acceptance.pending`。剩余项集中在宿主目录选择、设置草稿跨页恢复、迁移旧包和中途失败、全局技能作用域、状态/提醒/降级投影、事件图形入口、宿主导航及其他来源导入。逐项状态和真实证据见 [覆盖矩阵](auto-memory-cli-coverage.json)。
