# Auto Memory 终端设置、存储与迁移验收

2026-11-26 在 `feat/auto-memory-cli` 工作树运行，Git 起点为 `f3b4fa2c48d5bfea072674f7c34899e13b2c9d94`。实测 DSH Desktop `0.2.2-rc.5` 的内置 Host，装载 `3e2e895e65ed3644c26c3eb3051eb5ae5b9935d2` 的 Session Query 和 SQLite 编译模块。终端实报插件 `3.4.4`、构建 `dd464e19086d2ae2846b11e6046267b3db87e5b4f292716e9af5bd6ad30813d9`、契约 `1.0`、120 项操作及 `committedSearchVersion: 1`。本机发现与官方启动连接指向同一实例代次。

脚本为每轮创建临时 HOME、DSH_HOME、发现目录、两个实际注册的 DSH 工作区及各自会话。事件夹具走插件事件存储写入器，正文夹具是合成文件。CLI 从真实插件注册表发现并执行操作，对照同一 Host 上的 Web 路由，结束时通过 Desktop IPC 停止子进程并清理临时目录。依据 [实施任务书](PROMPT-CODEX-AUTO-MEMORY-CLI-TUI-20261126.md) · [覆盖矩阵](auto-memory-cli-coverage.json) · [Desktop 启动夹具](../../tests/live/auto-memory-cli-baseline.mjs)。

## 矩阵证据

| 矩阵行为 | 独立实测结果 |
| --- | --- |
| `memory.plan.mode` | 同一实例依次设置 `legacy → graph → event`。Web `/config` 与 CLI 回读相同值，CLI `status` 报告新修订。两端图看板在 `graph` 返回相同矩阵数据，另外两档分别返回 `legacy-mode`、`event-mode`。独立事件列表三档均读到同一个中文合成事件。相同请求 ID 和参数重放返回原回执。非法枚举、未批准、旧修订分别退出 `2`、`3`、`5`。 |
| `memory.handoff.auto.policy` | 启用 `0.01`、关闭 `1`、启用 `0.72`，每次比较终端状态与 Web `/auto-continue-state` 全部响应字段。阈值 `0` 和 `1.01` 退出 `2`，修订保持一致。Web 再写 `0.63`，终端下一次请求读到新值和新修订。 |
| `memory.external.switch` | 逐键启用项目约定、启用全局来源、关闭项目约定。每次对比写入回执、独立 CLI 回读与 Web `/config`，相邻键保留，未知来源键退出 `2`。CLI 和 Web 都列出已启用的冷会话项目来源和全局文件。 |
| `memory.storage.overview`、`memory.storage.scan` | 规范路径下，CLI 与 Web 扫描的来源、状态与计数一致。A、B 只枚举各自项目语料。扫描先识别 `sidecar-missing`，手改 A 后再识别 `stale-source`。正文及 sidecar 指纹证明扫描保留了过期现场。 |
| `memory.storage.repair` | 显式修复 A 命中 1 条，失效 4 个注册表，扫描转为 `ok`，落盘 sidecar 的 `fileDigest` 等于正文且正文逐字节保留。B 另造一份过期索引，省略 `items` 自动修 1 条，A 的 sidecar 指纹保持一致。A 混入 B 文件或 A 自己目录内的非语料文件时退出 `3`，A 原有待修项、两个项目的 sidecar 与相关正文均保留原指纹。 |
| `memory.storage.delete` | A 请求删除 B 文件或 A 的非语料文件均退出 `3`。集成工作树中旧摘要返回 `conflict-external-edit` 并退出 `5`，未知锚点返回 `not-found` 并退出 `4`。A 的正文、sidecar 指纹保持一致。匹配当前摘要时成功删除所选锚点，另一个锚点在正文和 sidecar 保留，B 正文保持原指纹。 |
| `memory.migrate.export`、`memory.migrate.upload` | 在真实终端导出压缩包。终端本机路径暂存与 Web 字节上传各生成一份暂存文件，两者与导出包的字节数和 SHA-256 相同。坏 JSON 返回 `pack-not-json` 并清理暂存文件，相对路径返回 `invalid-pack-name`，两者均退出 `2`。 |
| `memory.migrate.inspect`、`memory.migrate.import` | 同一个包预览 `keep` 和 `overwrite` 得到不同令牌，`keep` 的覆写项为 0。指定相同目标时 Web 和终端的覆写计划与令牌一致。将 B 的令牌用于 A，或在预览后修改 B 正文，均以 `preview-stale` 退出 `5`，A 与 B 的当时正文均保持原指纹。B 重新预览后，未批准退出 `3`，批准后写入 3 个文件。备份保存导入前编辑过的 B 正文，Web 文件入口和磁盘都读回与 A 相同的正文，A 的正文指纹保持一致。 |

## Web 修复与实测

- **Windows 8.3 记忆目录。** 根因是工作区原始拼写直接参与目录名派生。现用物理工作区验证 8.3 别名并统一选择写入目标。新增工作区及已有长目录沿用长名，仅有短目录时继续写入原短目录。两份目录并存时以长目录为写入目标，同会话的旧短路径原文仍可精确读回，旧表单提交返回 409，异项目读取旧原文返回 403。四组实测均分别通过长短路径执行 `/state`、`/list`、终端扫描和笔记追加，并以正文及指纹确认未分流。并存场景保留两份旧正文。[项目目录解析](../../lib/index.js#L4582) · [旧路径原文校验](../../lib/index.js#L4634)。
- **冷会话发现项目来源。** 根因是扫描默认取尚未初始化的 `state.ws`，再回退至进程目录。现将已验证的工作区传给发现服务，列表、预览、接入状态和接入操作使用相同项目。两个未运行模型的会话分别回读自己的 `CLAUDE.md`，接入只写所在项目的源路径，移除后源文件保留。无绑定的显式会话预览返回 400，停用来源后预览返回 404。Edge 打开「记忆 → 接续 → 外部来源」后，验证实际预览请求带会话 ID、响应 200、项目正文渲染，页面夹具由 SessionStore 写入一条合成对话。[来源发现](../../lib/index.js#L20656) · [当前皮肤源](../../skins/iter5/views.js#L194) · [旧皮肤源](../../skins/legacy/iter5-325.js.frozen#L649)。

## 复跑与指纹

从 `D:/dam-cli-20261126` 运行，使用 Node 24 的 ESM loader hook 复用同仓 Desktop 装载和清理。可在命令后加隔离安装的插件目录，将本轮被测插件和 CLI 入口切到该候选。默认从当前工作树的 CLI 入口运行。

```powershell
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
$env:DAM_STORAGE_BROWSER_MODULE = 'C:/Users/JH Z/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright/index.mjs'
node tools/build-iter5-skin.mjs --check
node --check tests/live/auto-memory-terminal-storage.mjs
node tests/live/auto-memory-terminal-storage.mjs 'G:/dsh_desktop/DeepSeek Harness.exe'
$LASTEXITCODE
```

验收输出包含四个 `passed` 分段，`observedBugs: []` 和 `assertionFailure: false`。脚本退出 `0`。省略 `DAM_STORAGE_BROWSER_MODULE` 时运行 CLI 与 Web 路由对照。Windows 短路径断言需当前临时路径具有可用别名。生成器返回 `SYNC-OK`，外部来源并发接入冒烟通过，路径边界冒烟结果为 70 通过、0 失败。[复跑脚本](../../tests/live/auto-memory-terminal-storage.mjs)。

| 可重算对照 | 实测 SHA-256 |
| --- | --- |
| A 手改后、显式修复后及两次删除拒绝后的同一正文 | `1571189c16b2150116465431bd7788bbd925aafe5d59d8d0b8ccc038c60411da` |
| A 成功删除后正文和 sidecar 所报告的正文摘要 | `0b8e5cf32f0304ec573b94d4a6d55eeb9f11166a97a9a6247b73935c012901ef` |
| B 自动修复前后及 A 删除后正文 | `e92bcdf37fc1ff902b1382495283af097601557185966ecd12ccd5b93e615db6` |
| 迁移阶段 B 的预览后编辑版本及导入备份 | `c1dc360534065225e0b5ab3b54dc707e801743b8af1bf084e6f132a50c10e882` |
| A 导出来源、B 导入正文、Web 文件回读 | `c2873426d3a138b4b6c4be89cfed0f84d8b8f9f1291f63258550ed5233565ae6` |
| 该轮导出包与两个暂存文件，1003 字节 | `d2c789c14e3ba0aee9f50b49b8db9e40c5765f2a875b80aad4ff6385c1c27c5a` |

本轮覆盖 Edge 的项目来源详情和真实 Web 路由的长短路径表单载荷。真实模型水位触发、完整设置表单交互、旧迁移包显式授权、超大上传和导入途中故障留给相应验收。

## 候选全量冒烟发现的五项回归

同一隔离方式下，精确 Git 基线 `f3b4fa2c` 的五项套件均通过，修复前候选均复现失败。Windows `/home/u/proj` 一类无卷路径保留原目录键，8.3 归一化只处理带卷的 Windows 绝对路径。来源读取夹具补齐旧短路径分支并验证异项目仍为 403。交接守卫核对多行检索参数和去掉事件 ID 的负路径。项目目录守卫按方法边界取样。经典皮肤完整哈希只计入会话 ID 参数增加的 37 个字符，复算时去掉该参数即可逐字节还原基线。

修复后五项套件均退出 `0`，`generator-idempotent` 为 14 通过、`client-loadable` 为 34 通过。Iter5 返回 `SYNC-OK`，EV4 从源生成被 Git 忽略的本地副本后检查通过，生成过程保持 `lib/client.js` 字节不变。隔离 Desktop 和 Edge 再跑四个验收分段均通过，构建 ID 为 `0bfe7dd89ffdc8fa78a06f369815e876603be13a96cf14745e3e27198a1bc8c5`。
