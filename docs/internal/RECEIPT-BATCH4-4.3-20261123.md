# 批次 4.3 · 时段总结回读 · 2026-11-23

测绘核实 `summarizePeriod()` 聚合多个工作区，缓存落在 `globalPaths().summariesDir`。落盘字段只有 `summary`、`works`、`generatedAt`、`cached`。按 D4-1，`memory_read(kind="summary")` 回读最新的已生成全局总结，并标注 `scope:"global"`。

`lib/summary-read.js` 导出 `readLatestPeriodSummary`。候选按有效的 `generatedAt` 降序，单条记录的时间无效时使用 mtime，仍同分按文件名降序。返回来源绝对路径、时间及其依据、字节数和原始全文。目录不存在与没有候选给出不同的空态原因。候选无法读取或解码时返回 `unreadable` 及来源路径。损坏候选无法参与时间排序，因此即使目录有其他可读记录，也报告该错误。

| 文件 | 行尾 | 改前字节 / LF 分隔符数 / SHA16 | 改后字节 / LF 分隔符数 / SHA16 |
| --- | --- | --- | --- |
| `lib/index.js` | CRLF | 2223915 / 30558 / `6813e3df094f2b24` | 2224298 / 30561 / `904b200fe376c046` |
| `lib/summary-read.js` | LF | 新增 | 2717 / 72 / `889f70ddba0608a7` |
| `tests/smoke/smoke-test-batch4-summary-read.mjs` | LF | 新增 | 8692 / 163 / `af6dd0242cfa027d` |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | LF | 145421 / 1095 / `b42282cf44536ad3` | 145480 / 1096 / `4950ccc125b04ff0` |
| `docs/USER-GUIDE.zh-CN.md` | CRLF | 45565 / 516 / `9ef0b993e6d95c51` | 45750 / 516 / `67012f1f519bfc17` |
| `docs/USER-GUIDE.en.md` | LF | 48683 / 515 / `0f6cea9ba7851bca` | 48850 / 515 / `7c8c123e82b2326e` |

真实 `apply()` 注册后调用工具，专项 **7 PASS / 0 FAIL**。反向 mtime 夹具和跨工作区调用均返回 `2026-11-23-下午.json` 的 203 字节全文。磁盘和回执正文的 SHA256 都是 `b8bad76415ca4259c2cee96f3af46bad33f55ae6ce8ba7948cba54baf07f6bb7`。mTime 兜底与文件名平局、空目录、非法 kind、坏 JSON、非法 UTF-8 和错误数据形状均有独立断言。

将排序主键换成 mtime、把坏 JSON 归入空态、从注册枚举移除 `summary` 三处隔离变异均 CAUGHT，恢复后复绿。隔离分支另实跑归档 30/0、项目总览 24/0、#164 工具真调用及诊断总结 3/0。r26 首次 24/2，仅长度及指纹锁变化，按 actual `1661952 / 787D00D18BFA2E21` 更新后 26/0。语法、真 import 和 verify-docs 通过，工具 22 / 路由 87 / 配置键 182。

真实 DSH 宿主、a11y、真实模型轮未验证。
