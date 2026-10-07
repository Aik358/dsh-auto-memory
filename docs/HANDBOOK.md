# dsh-auto-memory 接手与验证手册

核对日期：2026-10-06。基线与默认值见[源码速查](SOURCE-REFERENCE.md)。

## 五分钟接手

1. 在仓库根运行 `git status --short`、`git branch --show-current`、`git log -1`，记录已有改动。工作区不干净时在隔离 worktree 操作，保留用户素材。
2. 读[用户手册](USER-GUIDE.zh-CN.md)了解入口，读[白皮书](WHITEPAPER.md)了解存储与归属约束。
3. 用[源码速查](SOURCE-REFERENCE.md)核对默认值、工具、路由。旧论文、计划与验收仅说明原阶段事实。
4. 根目录存在 `.codegraph/` 时先用 `codegraph explore "符号或问题"` 定位，再按需读取源码；无索引时普通搜索，不自动创建索引。
5. 明确本次证据范围：静态源码、自动回归、真实宿主、人工验收分别记录。

## 结构与数据流

| 位置 | 职责 |
|---|---|
| `lib/index.js` | 宿主插件、MemoryEngine、路由、工具与编排 |
| `lib/client.js` | 浏览器 ESM bundle，使用宿主 React、远程连接和 UI 插槽 |
| `lib/*.js` | 存储、检索、证据、接续、上下文与团队模块 |
| `python/` | 可选 Python sidecar 与策略工件 |
| `skins/` | 皮肤 token、CSS 与资源 |
| `tests/smoke/` | 可执行 Node 回归；部分需额外本地工件或环境 |
| `tools/run-smoke.mjs` | 分套件子进程、超时与 PASS / FAIL / TIMEOUT 报告 |
| `tools/release.mjs` | 发布构建与历史命名转换，使用前核对源/目标目录 |
| `cordis.patch.yml` | Cordis profile bundle 插件行 |

模型工具与浏览器操作进入同一个宿主引擎。引擎读取配置和工作区身份，将记忆、索引与证据写到磁盘；检索经摘要/词法/可用语义与融合排序返回，按锚点读取原文。主动联想另受开关、身份、时效和投递门控制。语义依赖不可用时可降级，因此必须同时观察实际档位和降级记录。

## 安装与启动

用户安装步骤见根 [README](../README.zh-CN.md)。默认 web profile 在 `~/.dsh/profiles/web`；安装包后，将包名追加到该 profile 的 `package.json` → `dsh.profile.bundles`。本地开发可使用该 profile 支持的本地包链接，但要确认最终解析到本次检出目录。

```bash
dsh web --no-open
```

从终端读取监听地址；需要 UI 验证时打开该地址。停止使用该实例终端的 Ctrl+C。修改 bundle 注册或工具/注入声明后重启；不要把其它正在工作的宿主进程一起停止。

## 配置与磁盘位置

`lib/dsh-home.js` 的解析顺序是显式覆盖 → 非空 `DSH_HOME` → 系统 home 下 `.dsh` → 兼容兜底。下表展示默认位置，配置和迁移可改变它们；不能因为设置了 `DSH_HOME` 就假定所有已保存的记忆路径自动跟着迁移。

| 内容 | 默认位置 |
|---|---|
| 配置 | `<DSH_HOME>/dsh-auto-memory.json` |
| 诊断日志 | `<DSH_HOME>/dsh-auto-memory-diagnose.log`，与 memory 同级 |
| 用户记忆 | `~/.dsh/memory/MEMORY.md` |
| 工作区记忆 | `~/.dsh/memory/workspaces/<工作区键>/` |
| 白板与账本 | 工作区记忆下 `handoff/PLAN.md`、`handoff-*.md` |
| 中枢 | 默认 `~/.dsh/memory/hub/`，见 `lib/datadir.js` 的实际数据根 |
| 证据事件 | 默认 `~/.dsh/memory/evidence/events/YYYY-MM-DD.jsonl` |
| 降级台账 | memory 数据根下 `degrade/`，见 `lib/datadir.js` |

备份前读取 `/api/dsh-auto-memory/config` 与 `/state` 的实际路径；备份实际数据和配置。原文、锚点、sidecar 与目录身份相互关联，不能只复制一份摘要后删除原始目录。导入先预演，再核对冲突策略与备份位置。

默认开关和水位模式见[源码速查](SOURCE-REFERENCE.md)；实际值查 `/config` 与 `/state`。

## 自动检查

仓库没有 npm build/test/lint 脚本。下面的语法和打包检查不启动宿主：

```bash
node --check lib/index.js
node --check lib/client.js
npm pack --dry-run
```

回归在独立 home 运行。PowerShell 示例（仅改变本进程环境，结束后恢复）：

```powershell
$previousDshHome = $env:DSH_HOME
$testHome = Join-Path ([IO.Path]::GetTempPath()) ('dsh-doc-check-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testHome | Out-Null
try {
  $env:DSH_HOME = $testHome
  node tools/run-smoke.mjs --filter=smoke-test.mjs --jobs=1
  node tools/run-smoke.mjs --filter=api-paths --jobs=1
  node tools/run-smoke.mjs --filter=water-window --jobs=1
  # 需要全量时：node tools/run-smoke.mjs --timeout=90000
} finally {
  $env:DSH_HOME = $previousDshHome
}
```

保留临时 home 用于失败定位，确认具体绝对目录后再清理。运行器默认四路并行，单套件默认超时 60 秒；重负载可使用 90 秒。不能因某个 Node 进程退出 0 就判定通过，要核对运行器汇总和异常输出。Python 及外部资产套件的先决条件在对应测试与 CI workflow 中；不要假报未执行项 PASS。

## 5. 接口速查

### 5.1 主要端点（普通插件共 **71** 条）

普通接口前缀为 `/api/dsh-auto-memory/`；[源码速查](SOURCE-REFERENCE.md)指向完整 API 声明。

HTTP 方法、字段及写入门以对应 handler 为准；只读核对可先取 `/state` 与 `/config`。

`GET /api/dsh-auto-memory/debug` 的 `maintenanceTasks` 提供本进程最近一次固化和维护回执，包括任务键、尝试时间、运行状态、确认写入数和脱敏错误。`failed` 表示未确认写入，`partial` 表示已有写入后仍存在失败。定时任务每天只自动尝试一次，避免重复模型调用或重复部分写入；排除故障后，可显式使用 `memory_consolidate` 或 `memory_maintain` 恢复。相同会话和工作区的恢复回执带 `recoveryOf`。回执随进程重启清空，开始和终结状态也写入既有诊断日志。

## 真实宿主验证

使用隔离 profile / home 和测试素材，记录代码身份、监听地址与实际加载路径。

1. 启动后核对插件加载、`GET /api/dsh-auto-memory/state` 与诊断日志。
2. 写入一条测试记忆，检索并按锚点展开；重启后确认原文与证据仍可读。
3. 改设置前后对比配置返回值、UI 和磁盘状态，核对实际语义档位和降级原因。
4. 在真实宿主打开、关闭、重新打开面板；UI 改动需要截图、计算样式与 `getBoundingClientRect()` 验证尺寸和位置。
5. 涉及接续时核对工作区、会话、模型和材料身份；创建会话成功不等于接续任务已完成。

## 故障定位

| 现象 | 先核对 |
|---|---|
| 侧栏没有入口 | profile bundles、包解析路径、宿主是否重启、客户端模块加载异常 |
| 配置没有生效 | 是否保存、`/config` 是否回写、是否改了另一个 home、该项是否需要重启 |
| 检索为空或质量下降 | 实际目录、工作区身份、查询范围、语义状态与降级台账 |
| 自动接续不触发 | 开关、独立阈值、官方计量、会话 running 状态、冷却与拒绝记录 |
| 面板消失 | 真实视口中的几何、CSS 定位、遮挡及关闭后重开；DOM 存在不足以判断可见 |
| 评测语义档降为词法 | 模型依赖、资产校验、实际 engine；失败时停止该实验，不把降级结果当语义成绩 |

返回[文档目录](README.md)。
