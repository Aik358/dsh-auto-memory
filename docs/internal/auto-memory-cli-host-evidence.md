# Auto Memory 的 DSH Desktop 隔离验收

验收日期 2026-11-26。工作树 `D:/dam-cli-20261126`，分支 `feat/auto-memory-cli`，起点 `f3b4fa2c48d5bfea072674f7c34899e13b2c9d94`。对照使用下载解包的 `@a9i5k4/dsh-auto-memory@3.4.6`。测试从已安装的 `G:/dsh_desktop/DeepSeek Harness.exe` 启动产品自带的 Desktop Host 子进程。每轮单独创建 `DSH_HOME`、`profiles/desktop`、两份工作区及本机发现目录，走实际 Cordis bundle、会话 RPC、插件 HTTP 和清理 IPC。测试只处理合成数据。

## 宿主和原生连接

- 安装包的 launcher 与 bundled runtime 均报告 `0.2.2-rc.5`，运行时 Node `24.21.0`。主运行时摘要 `0881fbf610a9a8ef344a9e650f3a4c1b7724260a74eeaefaa9ec31355907374f`。
- Desktop Host 绑定 `127.0.0.1`，以 `--port 0` 获取端口。Node 父子 IPC `starting` 提供 run ID，`ready` 提供认证 URL 和启动图。Electron 主进程交换凭据，并通过其私有的 `dsh-app` 协议和 IPC 为渲染器转发请求。命令行可以用官方 `/connect` 接受明确提供的启动凭据，或让插件提供经验证的同账号发现。已检查的 Desktop 源码未显示提供给外部 CLI 的端口和启动凭据枚举入口。来源 [Desktop Host 启动](D:/dsh-committed-session-query-20261126/apps/desktop-host/src/index.ts:23) · [Electron 父进程管理](D:/dsh-committed-session-query-20261126/apps/desktop/src/host-process.ts:209) · [Desktop 主进程登录](D:/dsh-committed-session-query-20261126/apps/desktop/src/main.ts:548)。
- 匿名 `settings/describe` 返回 401。浏览器根路径交换返回 303 和 HttpOnly Cookie。`/connect?interactions=none` 返回 302、本机生命周期 WebSocket 位置和 HttpOnly API Cookie。API Cookie 直接成功调用 `settings/describe` 和 `terminal/v1`。这次测试执行的是 HTTP unary。来源 [非页面客户端连接指南](D:/dsh-committed-session-query-20261126/docs/upgrade-guide/v0.2.1-alpha.2/operator-connect/guide.zh.md) · [宿主认证实现](D:/dsh-committed-session-query-20261126/packages/client/connection/src/rpc-host.ts:128)。
- 插件画面资源用启动图公布的带版本 combo URL 加载，两个包均返回 JavaScript 200。插件启动日志为 22 个工具和 87 条既有路由。`terminal/v1` 有独立注册及认证，实际工作树接受官方 API Cookie 和同账号发现客户端。来源 [宿主客户端模块注册](D:/dsh-committed-session-query-20261126/packages/client/modules/src/index.ts:1262) · [终端契约注册](D:/dam-cli-20261126/lib/terminal/server.js)。

## 竖切和边界

| 竖切 | 真实操作和断言 |
| --- | --- |
| 状态和设置 | 对两个显式会话所属工作区读取 `/state`。用设置页的 `POST /config` 将 `autoPopupEnabled` 从 false 改为 true，同一进程从 `GET /config` 和 `GET /state` 回读。 |
| 检索和来源 | `POST /note` 写入项目 A，`POST /recall` 返回 1 条合成命中，`GET /file` 读回原文。项目 B 不返回该命中。不存在的会话返回 400，传入项目 B 的笔记路径作项目 A 的预期落点返回 409，笔记 SHA-256 保持一致。 |
| 独立白板看板 | 事件和检查点由被测包的事件存储写入器生成夹具。会话 A 通过 `/event-list` 和 `/event-detail` 读到 1 个检查点的四段、原文路径、引文、行号、字节数与 SHA-256。会话 B 查询同一事件返回 404。 |
| 载入和重连 | 通过 Desktop Host 的 `shutdown` IPC 取得 `shutdown-complete`，子进程退出码 0，旧监听返回 `ECONNREFUSED`。同一隔离 profile 启动后重新认证，得到不同 run ID 和端口，配置与事件仍可回读。 |

项目笔记及检查点的来源 SHA-256 均为 `9951bffbfc9273f1d2b61c08c6838cff895097b7ff2ce62dd9502cef1f0b2328`，引文在第 4 行。会话 ID 由真实 `workspace/create` 和 `session/create` 返回，用 `workspace.workspaceId` 绑定。会话与工作区的路径以宿主解析结果核对。

正式终端契约实测为 `1.0`。GUI 同轮的工作树清单有 108 项操作。官方 `/connect` 和本机发现指向同一个实例代次。匿名请求返回 401。仓库客户端调用 `status`、`settings.get`、`memory.recall`、`memory.source`、`board.events.list` 和 `board.events.detail`，以相同来源指纹核对两页数据。设置的审批、修订、幂等重试与回执通过，写入后旧 Web 路由即时读回。停机时发现记录清除，旧客户端报告断开，新客户端发现新代次。npm 3.4.6 的正式契约路由返回 404。工作树构建和能力数以每次脚本报告为准。

当前测试调用的是正式 Web 设置入口，项目笔记用正式写入入口，事件夹具用事件存储写入器。这几个断言不涉及模型生成检查点。安装包官方 Host 与修复编译件是两次运行，编译件出处为 `3e2e895e65ed3644c26c3eb3051eb5ae5b9935d2`，基于安装版源码 `9c2670d3bce5275e0d1610272958121af87787bb`。已提交索引、蒸馏回退沿用同轮独立证据。来源 [已提交索引联调回执](D:/dam-repair-proof-20261126/joint-codex-baseline.log) · [真实 Loader 复跑脚本](D:/dam-repair-proof-20261126/verify-compiled-host-and-plugin.mjs) · [蒸馏重入和回退测试](D:/dam-cli-20261126/tests/smoke/smoke-test-maintain-reentry.mjs)。

## 复跑

从 CLI 工作树运行。第三个参数可指定本机已装 Playwright 的 ESM 入口，检查同一 Desktop Host 的网页界面。省略时只跑后端和 CLI。可选环境变量 `DAM_BASELINE_PLUGIN_DIR` 指定从精确起点解包的 Git 归档，追加一轮历史插件对照。

~~~powershell
node tests/live/auto-memory-cli-baseline.mjs 'G:/dsh_desktop/DeepSeek Harness.exe' 'C:/Users/JH Z/AppData/Local/Temp/dam-cli-old-f1c4482dbbd542e6bac8b244401d2c0b/package' 'C:/Users/JH Z/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright/index.mjs'
~~~

脚本输出逐项 JSON 和校验失败退出码。它使用临时作用域换取凭据，输出保留状态码与摘要。

## 隔离浏览器双页验证

工作树、精确 Git 起点 `f3b4fa2c` 和 npm 3.4.6 均在 Edge 中通过。测试 iframe 内的白板事件和检查点展开，确认目标及下一步正文。随后从独立「记忆」页的「记忆库 → 检索」发起请求，断言请求的会话 ID 和命中内容，点「打开原文」，确认响应文件指向该项目笔记且 SHA-256 与 CLI 一致。

首次引导用产品的 `settings/mutate` 在隔离 profile 记录预览说明已读，使用官方 Cordis 设置关闭空 profile 的凭据引导，在页面上选择「稍后」和「本次不再提示」关闭插件的工作台、整理提示。空对话在 DSH 会隐藏页签，因此由隔离 Cordis 夹具通过真实 SessionStore 写入一条已完成的合成对话，不触发模型。浏览器设为中文、仪器皮肤、会话页布局。截图可通过 `DAM_GUI_ARTIFACT_DIR` 输出。验收使用 Desktop Host 的 Web 界面，Electron 外壳界面留待产品验收。

- 工作树 [展开白板检查点](<C:/Users/JH Z/AppData/Local/Temp/dam-cli-gui-eb462c4f35d64caeaf40819138d84153/worktree-board.png>) · [检索与原文](<C:/Users/JH Z/AppData/Local/Temp/dam-cli-gui-eb462c4f35d64caeaf40819138d84153/worktree-memory.png>)。
- npm 3.4.6 [展开白板检查点](<C:/Users/JH Z/AppData/Local/Temp/dam-cli-gui-eb462c4f35d64caeaf40819138d84153/npm-control-board.png>) · [检索与原文](<C:/Users/JH Z/AppData/Local/Temp/dam-cli-gui-eb462c4f35d64caeaf40819138d84153/npm-control-memory.png>)。
- Git 起点 [展开白板检查点](<C:/Users/JH Z/AppData/Local/Temp/dam-cli-gui-eb462c4f35d64caeaf40819138d84153/git-baseline-board.png>) · [检索与原文](<C:/Users/JH Z/AppData/Local/Temp/dam-cli-gui-eb462c4f35d64caeaf40819138d84153/git-baseline-memory.png>)。

## 已安装候选、运行时变异和修复版 Session Query

从当前工作树执行 `npm pack` 并隔离安装，用生成的 `dam.cmd` 完成原候选和变异副本两轮真实 Desktop Host 验收。候选压缩包 SHA-256 为 `fa4c423af810024a0fe1cbb905b0722ee9b41a86d31e073413f92b2df3589faf`。两轮共用的 `dam.cmd` SHA-256 为 `19e4f1474ca7c1ec81935a9d3c3a75f4c9e1b9d9c0b40dea9ab47a5378b4958f`，CLI 入口 SHA-256 为 `ae0cb11a5e172b9e20c81788e7032804718f062352c2860f82584185a3f5cab1`。

- 原候选的 `doctor`、`memory recall` 和 `board event` 通过。插件运行身份为 `a61c2e608818d10d902b2bb85770bb14e18cd75f1bf3946daacc7f591ca4ce07`。
- 临时副本新增 `validation.echo` 和真实处理器。相同 CLI 用 `api list` 发现操作，通过 `api describe` 读到请求 schema，通过 `api call` 回读中文字符串、标签数组和服务端执行标记。原候选上的 `api describe` 返回退出码 4。变异版收到非法数组元素时返回 2。变异版运行身份为 `9df6336126fbdfaeced9af84bc764eba1fa9c91b4bdf8c99560b28bbe5d6f55c`。
- 现有 CI 套件经 `tools/run-smoke.mjs --filter=terminal-contract --jobs=1 --retry=0` 对原候选返回 0，对变异副本返回 1，并报 `added validation.echo`。隔离套件给 Windows 清理加重试，防止待完成的诊断文件写入造成 `ENOTEMPTY` 并覆盖契约断言。
- 同一次产物运行使用 `3e2e895e65ed3644c26c3eb3051eb5ae5b9935d2` 的编译件。Electron 使用 `--import` 将 Session Query 接口和 SQLite 实现解析到本地编译件。其他宿主依赖来自官方安装包 ASAR。两轮通过 `dam.cmd` 断言 `status.searchIndex.committedSearchVersion === 1`。接口包 SHA-256 为 `cd479b998f66e04639ec3e626fca706ce4f8aad40b75e983e549043ae9d0185b`，SQLite 包为 `e6155aa98e495e8920a918830a47dc25828a29bdb9694829027456edb871fc2a`。

给隔离安装的候选指定其 `node_modules` 目录和安装生成的启动器。

~~~powershell
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
$damCandidateModules = 'D:/path/to/isolated-install/node_modules'
node tests/live/auto-memory-cli-baseline.mjs --mutated 'G:/dsh_desktop/DeepSeek Harness.exe' (Join-Path $damCandidateModules '@a9i5k4/dsh-auto-memory') (Join-Path $damCandidateModules '.bin/dam.cmd')
~~~

## Desktop 后台维护和归档回读

`--maintain` 模式使用独立的临时 Desktop profile，两份真实会话及一份 104 字节旧日志。旧日志含 CRLF、中文、emoji 和行尾空格。定时维护与定时整理在该 profile 关闭，记忆工作台保持启用。该 profile 使用空的凭据目录，尚未授权创建工作台。工作台探测返回 `ready=false` 和 `no-state`，插件诊断记录实际蒸馏调用因工作台未就绪而停在调度前，任务回执明确报告「AI 蒸馏不可用」并完成原文归档。模型执行和超时边界由独立的蒸馏回归覆盖。

- 真实 `jobs.maintain.start` 缺少确认时 CLI 返回 3，原日志字节一致。确认后返回 `running` 和作业 ID。用相同请求 ID 重放取得同一作业，`api receipt` 返回写入回执。
- 同会话 `jobs get` 轮询至 `finished`，其他工作区会话读相同作业返回退出码 4，错误码 `job-not-found`。这次作业 ID 为 `565e2cba-8f9c-4817-a70d-3a52786dea6a`，脚本退出 0。
- 直接比对 `archive/2000-01-01.md` 的全部字节并检查原活跃文件已移除。以同一实例调用 `memory read` 列归档、读归档全文，再用 `memory source` 逐字节读回及 `memory recall` 在归档范围检索。原日志、归档文件与来源接口三者 SHA-256 均为 `e49851cd47b57d5b7ecb2e53b740585b34d49e6c8f334067ec3760d6ea90be80`。CLI 同轮确认 `committedSearchVersion=1`。

~~~powershell
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
node D:/dam-cli-20261126/tests/live/auto-memory-cli-baseline.mjs --maintain 'G:/dsh_desktop/DeepSeek Harness.exe' 'D:/dam-cli-20261126'
~~~

也可将最后的工作树参数替换为隔离安装的包目录，再追加该安装生成的 `dam.cmd` 路径。

## 含 Cloud Code 的隔离候选 3.4.4

本节记录接入 Cloud Code 时的归档复验，归档 SHA-256 为 `5f7660d7c9a3631113d91ad6ac5513e79ac99c67354229c2fe9c718632876378`，构建 ID 为 `0bfe7dd89ffdc8fa78a06f369815e876603be13a96cf14745e3e27198a1bc8c5`。

- 隔离安装包的真实 Desktop TUI 复验使用 `DAM_TUI_INSTALLED_ENTRY` 启动包内 CLI，实际按键通过 Windows ConPTY 在 120×29 和 53×24 完成状态、记忆、白板、检查点来源、检索、设置修订与回执、跨范围拒绝、断线和重选。该测试宿主通过工作树加载插件。已对照候选安装目录，`lib/index.js` 与 `lib/terminal/tui.js` 均逐字节等于工作树文件，且 Desktop 实际构建 ID 与归档候选一致。
- 最终 npm 安装包 CLI 在真实 Desktop Host 上完成设置、项目别名、存储扫描和修复、CAS 删除、迁移包暂存/检查/导入、过期预览与跨目标令牌拒绝。结果见 `D:/dam-cli-delivery-20261126/verified/terminal-storage.log`。迁移仍待旧格式授权及进程中途失败覆盖。
- 同一包在 Linux WSL 原生 npm 安装与 DSH Web `0.2.2-rc.5` 上完成项目笔记写入、回执、检索、原文、白板修订及双实例显式固定。输出见 `D:/dam-cli-delivery-20261126/verified/linux.jsonl`。
- Cloud Teahouse Cloud Code `0.2.0` 通过独立 `cloud-code` 模式读取同一插件。目标项目绑定成功，跨项目 CLI 和 hook 被拒绝，恢复会话重新收到项目上下文。输出见 `D:/dam-cli-delivery-20261126/verified/cloud-code.jsonl`，扩展能力缺口见 [Kimi 与 Cloud Code 验收](auto-memory-kimi.md)。
- 后台维护在真实 Desktop 上分别以 loopback 模型摘要和真实 30 秒模型超时运行。两轮均归档原有 104 字节文件，归档 SHA-256 为 `e49851cd47b57d5b7ecb2e53b740585b34d49e6c8f334067ec3760d6ea90be80`；超时没有把合成摘要写入笔记。输出见 `D:/dam-cli-delivery-20261126/verified/maintenance-model.jsonl` 和 `maintenance-timeout.jsonl`。

Windows TUI 复跑命令如下。

~~~powershell
$env:DAM_TUI_INSTALLED_ENTRY = 'D:/dam-cli-delivery-20261126/verified/win/node_modules/@a9i5k4/dsh-auto-memory/lib/terminal/cli.js'
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
$env:PYTHONPATH = 'D:/dam-cli-delivery-20261126/pty-deps'
node tests/live/auto-memory-tui-desktop.mjs 'G:/dsh_desktop/DeepSeek Harness.exe' 'D:/dam-cli-delivery-20261126/control-3.4.6/package'
~~~

## 含 OpenCode 的隔离候选 3.4.4

归档 `D:/dam-cli-delivery-20261126/verified/expanded/a9i5k4-dsh-auto-memory-3.4.4.tgz` 的 SHA-256 为 `6ef6a6ca25eb9e0dcbcfea138ab4715af0c210d0e13a42a0a0fd33564f0da03e`。Windows 与 Linux 加载的构建 ID 均为 `dd70b6137235b4b4df099bf6d809707e517abd9f1aabb21ab4b01d9634085d64`。

- Windows 从安装目录的 CLI 入口运行宽窄 ConPTY，验收记忆、白板、历史检查点与当前来源、设置回执、跨范围拒绝以及断线重连。记录为 `verified/expanded/terminal-desktop.log`。
- 真实 Desktop 的设置迁移复制两份项目笔记和一份用户摘要，验证源和目标 SHA-256 相同，Web 和 CLI 即时读回新根，未批准不创建目录，旧修订退出 5。两份独立项目的事件和未归档账本按两条一页，与 Web 请求逐页一致，另测结案筛选、全量和未登记会话。记录为 `verified/expanded/terminal-storage.log` 和 `verified/expanded/board-pagination.log`。
- 同一归档在独立 Ubuntu 配置中原生 npm 安装，通过官方 DSH Web `0.2.2-rc.5` 验证写读回、白板修订、同 profile 双实例选择与显式固定。记录为 `verified/expanded/linux.jsonl`。
- OpenCode `1.19.6` 的真实宿主通过 MCP 检索并读取 DSH 合成笔记，宿主拒绝和跨目录拒绝已验证。Antigravity `1.5.18` 通过官方严格校验，归档内桥接对真实 DSH 验证 hooks、只读检索和跨目录拒绝。Antigravity 的隔离 ACP 握手通过，创建会话时要求认证。记录为 `verified/expanded/opencode.jsonl`、`verified/expanded/antigravity-bridge.jsonl`。配置及复跑见 [外部宿主适配](auto-memory-external-hosts.md)。

## 日历、团队设置和 OpenCode 注入候选

归档 `D:/dam-cli-delivery-20261126/verified/calendar-team/a9i5k4-dsh-auto-memory-3.4.4.tgz` 的 SHA-256 为 `c0029b5c1abda95af54c2f3ea78562ea330e54b25fa89b03b4b7489b767a3557`。实测构建 ID 为 `996e464599a5f08864342c56d387032a1f736e754d531baeb2e305f0627806f8`。

- 安装版 ConPTY 验证日历月份、日期、条目详情与操作入口，白板事件按 `d` 查看相关路径。其余证据包括宽窄窗口、回执、来源与重连。见 `verified/calendar-team/terminal-desktop.log`。
- 两个团队隔离 profile 验证管理员临时暂停、持久暂停、恢复拒绝和 Web 读回，以及只读成员修改团队配置退出 3 且文件不变。见 `verified/calendar-team/team-desktop.log`。
- OpenCode `1.19.6` 实测同包原生插件在新会话和恢复会话注入项目上下文。拒绝后的模型请求仍能收到宿主注入，MCP 工具保持禁用。Antigravity 的严格校验及独立桥接通过。见 `verified/calendar-team/opencode.jsonl` 与 `verified/calendar-team/antigravity-bridge.jsonl`。
- 安装版 CLI 在隔离副本调用新注册的 `validation.echo`，发版守卫报告该操作新增。正常蒸馏及 30 秒归档回退、官方 Linux DSH Web 安装与双实例选择均复跑通过。见 `verified/calendar-team/mutated.log`、`maintain-model.log`、`maintain-timeout.log` 和 `linux.jsonl`。

## 接续的真实宿主验证

安装候选通过手动接续，同一工作区的新会话收到该项目交接材料，权限继承回执为 `workspace-write`，已批准请求重放返回同一后继。随后在工作树用同一 Desktop 复验自动水位和执行中取消。回环模型模拟 35,000 输入 token，真实宿主计算水位并进入 120 秒确认倒计时，CLI 在创建前取消。执行中取消使挂起的刷新请求断开，预留被释放。跨项目读不到选中会话的执行、结果和取消记录，不能取消当前执行。重复取消返回相同结果。见 `verified/calendar-team/continuation-desktop.log` 和 `continuation-worktree.log`。

```powershell
$env:DAM_STORAGE_CONTINUATION_ONLY = '1'
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
node tests/live/auto-memory-terminal-storage.mjs 'G:/dsh_desktop/DeepSeek Harness.exe'
```

## 集成候选 3.4.4

归档 `D:/dam-cli-delivery-20261126/verified/integrated/a9i5k4-dsh-auto-memory-3.4.4.tgz` 的 SHA-256 为 `c58e87a019e834164b3f2b8fab734cf0f972340bd7054d46502d8dbb0f918a46`。Windows Desktop 与 Ubuntu WSL 的 Linux DSH Web 加载构建 ID 为 `581050de12b96b6dc89c16e1195cc782b13a4fdb3a162d67d7246c70cc7948e5`。公开契约为 1.0，共 122 项操作。下列日志路径相对于 `D:/dam-cli-delivery-20261126/verified/integrated`。

- `terminal-desktop.log` 和 `screens` 记录安装版在 120×29 和 53×24 对两页、历史检查点和当前原文、相关路径、设置回执及断线重连的验收。白板实测状态泳道、工作流和当前及归档画布卡片。分组与重叠统计按当前游标页计算。
- `storage.jsonl`、`continuation.jsonl` 和 `delivery.jsonl` 记录设置根迁移、两项目扫描与反思、事件和未归档账本分页、手动接续和权限继承、水位倒计时与执行中取消。对照组验证跨项目隔离，回环模型生成的问候和全局摘要由 Web 读回同一缓存。
- `hub-upgrade.jsonl` 记录技能激活、置顶、取消置顶和废弃。两项目验证升级的 `current`、`subset`、`all`、运行中去重和固定失败原因码。
- `linux.jsonl`、`maintain-timeout.jsonl` 和 `mutated.jsonl` 记录 Ubuntu WSL 原生安装与同 profile 双实例选择、真实 30 秒蒸馏回退的原文回读、同一 CLI 动态发现新增操作以及发版守卫拒绝该变更。
- `opencode-auto-compaction.log` 记录 OpenCode 1.19.6 新建与恢复、上下文注入、实际只读检索、宿主工具禁用、单次批准及拒绝、手动和自动压缩、压缩后注入及跨目录拒绝。13 次模型请求由本机回环合成响应。早一轮手动压缩记录保留在 `opencode-permission-compaction.log`。
- `settings-browser-roundtrip.log` 记录 Edge 修改自动弹窗开关、取消并还原、保存并更新修订、CLI 读回，再由 CLI 把该字段写回并由 Edge 刷新确认。同一进程期间无需重启。候选与 npm 3.4.6 对照均完成两页浏览及重连。带草稿的设置截图位于 `screens/web/worktree-settings-draft.png`。
- `../calendar-team/calendar-browser-roundtrip.log` 的候选使用相同构建 ID。Edge 切换月份和日期，新增带优先级和地点的事项。安装版 CLI 按 ID 完成和删除后，Web 读取服务即时返回相同状态。
- `storage-conpty.log` 记录 120×29 终端的索引健康、确认修复、按文件摘要删除和回执查询。另一项目的原文件指纹保持一致。相关画面位于 `screens/wide-desktop-storage-repair.png` 和 `screens/wide-desktop-storage-delete.png`。
- `continuation-automatic.log` 记录 10 秒倒计时到期后由真实 Desktop 自行创建后继会话并投递当前项目的交接文档。另一个项目无接续记录。

```powershell
$env:DAM_GUI_INSTALLED_PLUGIN_DIR = 'D:/dam-cli-delivery-20261126/verified/integrated/win/node_modules/@a9i5k4/dsh-auto-memory'
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
$env:DAM_GUI_CHECK_SETTINGS = '1'
node tests/live/auto-memory-cli-baseline.mjs 'G:/dsh_desktop/DeepSeek Harness.exe' 'D:/dam-cli-delivery-20261126/control-3.4.6/package' 'C:/Users/JH Z/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright/index.mjs'
```

## 压缩回调修复候选 3.4.4

归档 `D:/dam-cli-delivery-20261126/verified/compact-refresh/a9i5k4-dsh-auto-memory-3.4.4.tgz` 的 SHA-256 为 `d320055244c0d753215e3479fc7dccd7facca176275101783d444d0b3e1e85f0`，加载构建 ID 为 `7be1e8f8332c87fcee4ff95fdfbcea6123622780b7598e936bca3a89c1da8266`。公开契约为 1.0，共 122 项操作。

- `release.log` 记录正式预演、运行时契约守卫和 10 项契约用例。Windows 隔离 npm 安装后 `dam.cmd --version --json` 返回 `3.4.4`。
- `terminal-desktop.log` 及 `screens` 记录 Windows Desktop 120×29 和 53×24 的两页交互、白板分组和画布卡片、当前原文和历史检查点、设置、跨项目拒绝和重连，以及安装 CLI 的 `board checkpoint` 与 `board source`。
- `linux.jsonl` 记录 Ubuntu WSL 原生 npm 安装、真实 DSH Web 读写、回执、白板修订及同 profile 双实例固定。
- `zcode.log` 记录手动压缩回调触发记忆交付，下一轮模型读回绑定项目上下文，同一压缩回调重放获 `duplicate`。
- `codex-auto-context.log` 记录手动和自动压缩事件，以及自动压缩后模型再次收到项目记忆。`opencode.log` 记录已安装包上的工具批准与拒绝、手动和自动压缩及压缩后上下文。
- `web-settings-calendar.log` 记录同一设置修订的两个不同批准请求只有一个成功，另一个返回 409。运行中的安装版 `dam status --watch --json` 读到 Web 写入的新设置修订及相同作用域。Edge 设置和日历往返均复跑通过。
- `registry-update.log` 记录拒绝无确认的更新、安装 npm 3.4.6、写入完成回执、重启后加载 3.4.6、旧契约诊断及原文指纹验证。更新测试使用隔离 profile 与独立 npm 配置。可用以下命令在该候选上重跑。

```powershell
node tests/live/auto-memory-cli-baseline.mjs --update-install 'G:/dsh_desktop/DeepSeek Harness.exe' 'D:/dam-cli-delivery-20261126/verified/compact-refresh/win/node_modules/@a9i5k4/dsh-auto-memory' 3.4.6
```

## 独立工作区浏览候选 3.4.4

归档 `D:/dam-cli-delivery-20261126/verified/workspace-browser/a9i5k4-dsh-auto-memory-3.4.4.tgz` 的 SHA-256 为 `dee8451f8c559df57f1017f13925b91ec81b501ac64ef2ee28b148529abb842d`，两端加载构建 ID 为 `79656e7ef28c4dc78b9c040ed6ca496841c9750293da1f3ccbc02002c63f5afa`。

- `desktop.log` 验证未建立会话的工作区可以打开记忆清单、原文、检索、事件及设置。浏览器在同项目与异项目之间切换页签时，已指定会话的 CLI 写入继续使用原目标。Windows 宽窄 ConPTY、设置并发写、watch、设置和日历双向回读及重连均通过。
- `activity.log` 验证真实 DSH 回合活跃时，安装版 TUI 的工作区列表显示绿点与「处理中」。在两个项目间来回浏览都能打开对应项目的记忆。画面为 `screens/wide-workspaces-active.png`。
- 工作树的 `../terminal-scope/background-recall-fixture.log` 验证窄屏无色下的后台检索，可在等待时查看另一个工作区的白板，回到原作用域取回检索结果。
- `linux.jsonl` 验证 Ubuntu WSL 原生 npm 安装和 DSH Web 工作区、修订与双实例固定。`codex.log`、`zcode.log`、`opencode.log` 记录同一构建的外部宿主复验。

```powershell
$damPackage = 'D:/dam-cli-delivery-20261126/verified/workspace-browser/win/node_modules/@a9i5k4/dsh-auto-memory'
$env:DAM_STORAGE_DELIVERY_ONLY = '1'
$env:DAM_STORAGE_ACTIVITY_CONPTY = '1'
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
$env:PYTHONPATH = 'D:/dam-cli-delivery-20261126/pty-deps'
node tests/live/auto-memory-terminal-storage.mjs 'G:/dsh_desktop/DeepSeek Harness.exe' $damPackage
```

## 最终作用域和后台活动实现候选

归档 `D:/dam-cli-delivery-20261126/verified/workspace-final-v2/a9i5k4-dsh-auto-memory-3.4.4.tgz` 的 SHA-256 为 `716ac03c3c2314f8cba903b1d5290ba2ebff03aad63472250801e20c80042edb`，加载构建 ID 为 `b0c7a7033f0fcb2acfbaf93a69816ab92c82c4a01c0ed127bdad742cfd01eae4`。

此安装包复验了空会话工作区读与跨区拒绝、宽窄终端、Edge 页签切换和作用域保持、设置并发和 watch、白板全范围分组、日历、剪贴板、存储修复与删除、工作区活动标记、运行中后台检索和终端读回。HTTP 团队同步后端在隔离真实 Desktop 中验证 503 失败入队、恢复后重试、幂等键和队列排空。版本未知时，宿主保持同步暂停并拒绝恢复，回执显示 `peer-version-unknown`。Codex、ZCode、OpenCode 与 Ubuntu WSL 均使用该安装包复验。

## 最终安装包 3.4.4

归档 `D:/dam-cli-delivery-20261126/verified/workspace-final-v9/a9i5k4-dsh-auto-memory-3.4.4.tgz` 的 SHA-256 为 `f3fae9cf07dac36e97f2c26241b6a39769e1314e1d3488d03dc34647b6eb5cbb`，加载构建 ID 为 `1fe8323b3646a8bf8bf8308aeb8440a2c983076ac085d583ed39e077b97d9862`。公开契约 1.0，含 123 项操作。发布 dry-run 完成后，Windows npm 隔离安装和 `dam.cmd --version --json` 均通过。

- `desktop-installed-package.log` 验证 Desktop 从该 npm 安装目录加载 Auto Memory，并在 120×29、53×24 ConPTY 和 Edge 中测试两页、白板全范围分组、游标翻页、历史来源、目录剪贴板、设置草稿/取消/并发/watch 往返、日历及浏览器切换会话时保持终端目标。
- `sessionless-workspace.log` 验证没有任何对话的已登记工作区可以读取清单、项目概览、原文、memory_read、memory_recall、事件、详情和存储健康，并经批准对当前项目执行笔记追加。跨项目事件读取被拒绝。2026-11-27 的 `sessionless-write-final.log` 在最终归档安装目录上补验 `memory.read`、确认后的 `memory.note`、request ID 对应的 `finished` 宿主回执和原路径读回。
- `activity.log` 验证真实模型回合执行中，TUI 切换查看其他工作区仍保持读写目标隔离。工作区选择器用绿点和「处理中」标记原项目。窄屏无色模式保留文字状态提示，并可返回打开异步完成的检索结果。
- `team-remote.log` 用 Desktop 中实际装载的包连接本机 HTTP 协议服务，记录 503 后 outbox 保留、恢复后同幂等键重试并排空，`team.sync.diagnostics` 和 `team.sync.debug` 显示传输故障。未知对端版本时拒绝恢复并保持暂停。
- `linux.jsonl` 验证该归档在 Ubuntu WSL 原生 npm 安装及 DSH Web 0.2.2-rc.5 加载。
- `codex.log`、`zcode.log` 和 `opencode.log` 验证本归档的会话上下文、只读工具、权限与压缩回调。测试模型只使用本机 loopback 合成响应。
- `tui-event-lifecycle-acceptance-final.log` 使用最终归档安装目录启动真实 DSH Desktop ConPTY，完成 120×29、53×24 白板导航及事件创建、修改、检查点追加、改名、结案和 revision 回读。`screens/event-actions/wide-final-package-event-lifecycle.png` 保存最终详情画面。
- `external-user-final.log` 在同一最终包和真实 Desktop 上验证 `memory.external.import` 的 `target=user`、重复导入跳过、两个隔离工作区读到共享用户记忆；`memory.external.remove` 的 `target=user` 仅删除用户级引用，不改项目笔记，不删除源 `CLAUDE.md`，重复移除保持安全。
- `memory-actions-final.log` 在同一最终包和真实 Desktop 上验证笔记替换的确认、目标和 revision 守卫，撤回与替代读回，PLAN 展开和来源追踪，日志预检不落盘，以及事件和记忆命中范围隔离。

## 最终安装包 v10

归档 `D:/dam-cli-delivery-20261126/verified/workspace-final-v10/a9i5k4-dsh-auto-memory-3.4.4.tgz` 的 SHA-256 为 `b7d02e7f3aaec4a7f9a4e584e4273713d54069e194dddc6cc6f809a4a5f26d01`，加载构建 ID 为 `d7858175a04c517fdc90937cf6537213fa57f506ef02d6a053acaeeaffe47c59`。公开契约 1.0，共 124 项。

- `memory-actions-final.log` 验证 v10 安装包的笔记 CAS、展开、预检、事件范围、PLAN 展开/追踪、撤回、替代、恢复和 `archivedIds`。
- `tui-restoration-lifecycle.log` 验证 v10 的 120×29、53×24 ConPTY 白板导航、事件生命周期、note restore 的两次确认、revision 和来源读回，以及停机重连。
- `codex.log`、`zcode.log`、`opencode.log` 和 `claude.log` 均来自 v10 安装包，验证绑定目录、工具结果、权限拒绝、注入和压缩后上下文。
- `install-check.log` 记录隔离 npm 安装的 `dam.cmd --version --json`。npm registry latest 为 3.4.6，本机 npm 未认证，因此没有执行 npm 发布。

最终归档 sessionless 写入回归可在隔离临时 profile 复跑：

```powershell
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
node tests/live/auto-memory-cli-baseline.mjs --candidate 'G:/dsh_desktop/DeepSeek Harness.exe' 'D:/dam-cli-delivery-20261126/verified/workspace-final-v10/win/node_modules/@a9i5k4/dsh-auto-memory'
$env:DAM_STORAGE_EXTERNAL_USER_ONLY = '1'
node tests/live/auto-memory-terminal-storage.mjs 'G:/dsh_desktop/DeepSeek Harness.exe' 'D:/dam-cli-delivery-20261126/verified/workspace-final-v10/win/node_modules/@a9i5k4/dsh-auto-memory'
Remove-Item Env:DAM_STORAGE_EXTERNAL_USER_ONLY
$env:DAM_STORAGE_MEMORY_ACTIONS_ONLY = '1'
node tests/live/auto-memory-terminal-storage.mjs 'G:/dsh_desktop/DeepSeek Harness.exe' 'D:/dam-cli-delivery-20261126/verified/workspace-final-v10/win/node_modules/@a9i5k4/dsh-auto-memory'
Remove-Item Env:DAM_STORAGE_MEMORY_ACTIONS_ONLY
Remove-Item Env:DAM_SESSION_QUERY_BUILD_DIR
```



