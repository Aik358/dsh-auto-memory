# 源码速查

核对：2026-10-06，母仓库 `8280500` / v3.2.10。下表取自源码默认配置，用户保存配置可覆盖。

## 常用默认值

| 配置 | 默认值 |
|---|---|
| `boardMode` / `handoffEnabled` | `graph` / `true` |
| `memoryHubEnabled` / `workbenchEnabled` | `true` / `true` |
| `associativeMemoryEnabled` / `shadowRetrievalEnabled` | `false` / `true` |
| `contextBridgeEnabled` / `activationInboxEnabled` | `true` / `true` |
| `pythonBackendEnabled` / `procedurePromotionEnabled` | `false` / `false` |
| `semanticEngineMode` | `auto` |
| `autoContinueEnabled` / `autoContinueThreshold` | `false` / `0.75` |
| `waterLevelThresholdMode` / `waterLevelAutoMargin` | `auto` / `0.9` |
| `waterLevelThreshold` | `0.75`（固定模式或窗口解析失败时回退） |
| `userMemoryDir` | `~/.dsh/memory` |
| `memoryRoot` / `projectMemoryDir` | `~/.dsh/memory/workspaces` / `.dsh-memory` |

水位建议默认按官方压缩参数动态计算，与自动接续阈值独立。白板开启不等于自动接续开启；用户保存配置覆盖默认值。

完整 **155** 键直接查 [DEFAULT_CONFIG](../lib/index.js)，运行值取 `GET /api/dsh-auto-memory/config`，避免重复维护整张配置表。

## 工具与接口

源码声明 **19** 个工具；`memory_expand` / `memory_trace` 仅在 `boardMode=graph` 时注册。完整参数查 [defineTool 声明](../lib/index.js)。

普通插件注册 **71** 个唯一路径，前缀 `/api/dsh-auto-memory/`。完整路径查 [API](../lib/index.js)，方法、参数与写入门查 [路由 handler](../lib/index.js)。

| 常用接口 | 用途 |
|---|---|
| `config` / `state` / `debug` | 配置、状态、诊断 |
| `recall` / `smart-recall` / `recall-stats` | 检索与观测 |
| `memory-hub` / `activation-inbox` | 中枢与投递状态 |
| `auto-continue-state` / `handoff-continue` | 接续 |
| `migrate-export` / `migrate-inspect` / `migrate-import` | 导出、预演、导入 |

## 环境与命名

| 环境变量 | 真源 |
|---|---|
| `DSH_HOME` | [宿主数据根解析](../lib/dsh-home.js)，已保存的记忆目录可另外覆盖 |
| `DSH_AUTO_MEMORY_DEV` / `DSH_AUTO_MEMORY_REL` | [发布源/目标目录](../tools/release.mjs)，使用前核对路径 |

生效模块使用 `lib/*.js`；导出符号、协议及测试仍可保留 `Pre` / `_pre` / `-pre`，保持兼容身份。

[接手手册](HANDBOOK.md) · [文档目录](README.md)
