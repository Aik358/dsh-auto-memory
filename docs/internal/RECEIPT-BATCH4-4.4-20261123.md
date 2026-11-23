# 批次 4.4 · 诊断读取时段总结体积 · 2026-11-23

基线 `2275a99a`。测绘时，`lib/index.js:9312` 将总结目录解析为 `userDirOf()/summaries`，`:16968` 用该路径读取缓存，`:17025` 写入同一文件。默认记忆根下实测有 `summaries`，直接文件 123 个、合计 365,605 字节。同级无 `summaries-pre`。旧诊断的 `:16643` 指向 `projectDir/summaries`，且其 `stat.size` 只度量目录项。

诊断现在复用 `globalPaths().summariesDir` 和现有 `dirSize()`。递归统计有效目录内的文件大小，跳过符号链接，防止把相邻目录计入。主路径不存在时保留 `{exists:false}`。会话归档继续使用原来的 `dirSize` 默认行为。

| 文件 | 行尾 | 改前字节 / 行数 / SHA16 | 改后字节 / 行数 / SHA16 |
| --- | --- | --- | --- |
| `lib/index.js:16447` | CRLF | 2221997 / 30535 / `1d5628cfb1fc5dd3` | 2222196 / 30539 / `aeb895d86b34bbe0` |
| `lib/session-archive.js:252` | LF | 19542 / 494 / `8dea7b0b780777dc` | 19716 / 496 / `3b2e9374297255e1` |
| `tests/smoke/smoke-test-batch4-summary-diagnostics.mjs` | LF | 新增 | 3935 / 81 / `5f94ad3a790328c4` |
| `tests/smoke/smoke-test-issue162-diagnostic-integrity.mjs` | LF | 36143 / 609 / `fb807e42ad58d74d` | 36235 / 610 / `f56cc44df8ab7a36` |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | LF | 145189 / 1092 / `9f142e9357d441c8` | 145277 / 1093 / `6dfb4838570488e8` |

专项真 import 后调用生产 `apply()` 和已登记的 `GET /debug` 处理器。原版在合法文件夹具返回 `{exists:false}`。修正后得到 HTTP 200，`memoryFiles.summariesDir` 为 `{"exists":true,"size":171,"mtime":1795381486782.388}`。171 等于三个文件的 `17 + 41 + 113` 字节。移走主目录后返回 `{"exists":false}`，相邻旧目录仍有 509 字节。将统计入口变异到 `summaries-pre` 时命中断言。恢复后复绿。

| 验收 | 结果 |
| --- | --- |
| summary diagnostics | 3 PASS / 0 FAIL，1 条变异 CAUGHT |
| issue162-diagnostic-integrity | 26 PASS / 0 FAIL |
| batch3-closure-ev / co / u3b | 20 / 8 / 10 项通过，各 0 FAIL |
| delivery-policy-runtime | 11 PASS / 0 FAIL |
| r26 | 26 PASS / 0 FAIL。首次仅长度和 SHA16 锁红，使用套件 actual `1660088 / F1A9B66D38DBF136` 更新 |
| 语法、真 import、verify-docs | 退出 0，`IMPORT-OK`，22 工具 / 87 路由 / 182 配置键 |

issue162 首次报 `this.globalPaths is not a function`。抽取式夹具补入真实 `globalPaths`、`lstat` 和 `dirSize`，原断言保持。

本项验证到生产处理器与隔离文件系统。真实 DSH 宿主、a11y 和模型轮未验证。
