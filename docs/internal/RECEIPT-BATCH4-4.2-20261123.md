# 批次 4.2 · 工作区技能写入 · 2026-11-23

测绘发现底层适配器已支持双库读取、按 scope 写入和工作区切换。注册后的 `memory_procedure` 缺少 scope 字段，候选也没有 scope 和 workspaceRef。基线中带 `workspace`、显式 `global`、缺省和非法值的四次调用均返回写入通用库。

工具从调用会话解析工作区，在写入前核实归属。显式 `global` 和缺省继续使用通用库。非法 scope、无法识别会话或无法解析工作区时拒绝写入。同正文跨库独立保留，库内精确重复仍合并，查重和条目标识区分工作区。适配器识别已经持久化的其他工作区条目，未持久化的外库写入仍报告失败。

| 文件 | 行尾 | 改前字节 / 行 / SHA16 | 改后字节 / 行 / SHA16 |
| --- | --- | --- | --- |
| `lib/index.js` | CRLF | 2222196 / 30539 / `aeb895d86b34bbe0` | 2223505 / 30555 / `c7c5f8852edcf3a9` |
| `lib/hub-io.js` | LF | 50021 / 848 / `f923803111cb060e` | 50768 / 865 / `9ed96aff836d62cc` |
| `lib/procedure-observation.js` | LF | 8661 / 171 / `e61e93094fed2615` | 9075 / 179 / `6151dd3d9065b5a8` |
| `tests/smoke/smoke-test-batch4-procedure-scope.mjs` | LF | 新增 | 6833 / 124 / `9d87c4e7829f62b7` |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | LF | 145277 / 1093 / `6dfb4838570488e8` | 145358 / 1094 / `10f2555a8bbbb0b6` |

生产 `apply()` 注册后调用工具，专项 **8 PASS / 0 FAIL**。隔离根为 `C:/Users/JHZ~1/AppData/Local/Temp/dam-batch4-procedure-4qbSWS`。根内 `profile/memory/hub/procedures.json` 为 **1310 B**。根内 `profile/memory/workspaces/<workspaceKey>/hub/procedures.json` 在两个工作区分别为 **1534 B** 和 **1471 B**。两库同名同正文同时出现，其他工作区对当前读取不可见。非法 scope 和未识别工作区的负路径均保持三份文件字节一致。

隔离工作树的四处变异被捕获，恢复后复绿。套件检查强制回全局、只读单库、跨库误合并和会话绑定缺失。相邻套件 a28 21/0、a06 53/0、a2-hub-transactions 50/0、issue453 30/0、issue337-340 96/0、la-audit-fixes 56/0。主工作树诊断总结 3/0、issue162 26/0、EV 20/0、CO 8/0、U3b 10/0、delivery-policy-runtime 11/0。

r26 首次 24/2，仅两条指纹锁变化，用套件 actual `1661207 / CD8D89C846108CA8` 更新后 **26/0**。语法与导入通过，verify-docs 实测 22 工具 / 87 路由 / 182 配置键。真实 DSH 宿主、a11y 和模型轮未验证。
