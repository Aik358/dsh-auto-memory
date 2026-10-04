# Issue #162：诊断测试的运行时钟假红

本轮基线为 PR #213 head `25822056457d2d0abcde2fef9c9d445e5d59c688`，最终 UI 代码 `f30c92fb162daa914595b6d0cc1f5cc14f7ff915`。仅在已有修复分支本地修改测试、留证和提交；没有修改生产代码、推送、改 PR 或触发额外 Actions。

父线程提供的 upstream 与 fork 运行分别为 242/4/0 和 243/3/0；额外差异是 issue162 套件 25/26，两个 tree 相同。上游原始完整失败断言没有取得；下述固定时钟实验直接证明了本地因果，与上游运行时间和失败差额一致，但不能替代原运行的 TAP 取证。

## 复现与因果

Node 22.23.3；固定运行设置 TZ=UTC，测试专用 preload 固定 Date 并令 process.uptime()=0，使 debugInfo 推导的 startTime 精确。复现完成前未修改生产或测试源。

| 时钟 | 修复前 | 修复后 |
| --- | --- | --- |
| 2026-10-03 11:39:17 UTC | 25 通过 / 1 失败 | 27 通过 / 0 失败 |
| 2026-10-03 11:17:39 UTC | 25 通过 / 1 失败 | 27 通过 / 0 失败 |
| 2026-10-03 11:34:47 UTC | 26 通过 / 0 失败 | 27 通过 / 0 失败 |
| 真实时钟（无 preload） | 本轮未再测旧代码 | 27 通过 / 0 失败 |

两次红均为 `real debugInfo/persistence/dashboard path exposes failures and persistence failure stays observable` 的 `absentSecrets(tree)`（旧行 373）。生产 debugInfo 的 `startTime = Date.now() - process.uptime() * 1000` 被 DebugCenter 转为 locale 时钟后，拼入 `children` 字符串。失败的实际渲染值为 `31558 / 11:39:17 AM` 和 `31551 / 11:17:39 AM`。全树独立数字 `\b39\b` 守卫命中合法时钟；此前的 ISO `at`/`updatedAt` 归一化没有覆盖这个普通 children 字符串。原命令退出码分别为 1、1、0。

## 最小改动与范围

给诊断投影测试增加 dashboardFixture，验证 debugInfo PID/启动时间是合法数值后，浅拷贝并将这两个运行环境显示输入固定为 PID 162 和 2026-09-30 00:00 UTC。原 debugInfo 对象、台账、其他 host 字段和业务诊断字段保持完整。未改 DebugCenter、debugInfo、脱敏实现或 absentSecrets 规则，也没有增加 locale 时钟或其他字段的豁免。

新增一个回归测试（26→27）：含 39 的分钟/秒和 PID 39 使用固定显示 fixture；确认不修改原对象；children 和其他 host 字段中的 `39 old sessions`、独立 `39`、Bearer 假凭据、URLSECRET、PERSONAL、私人正文、user:pass、descriptor v2 和 v0→v1 仍然拒绝。PID/startTime 输入若为假凭据字符串也拒绝，不会被 fixture 静默替换。

范围限制：该套件不验收生产运行时钟/PID的格式或正确性；固定 fixture 的目的正是排除这些与诊断完整性无关的环境变量。生产数值输入类型被校验。本轮没有扩大已知 ISO 字段之外的归一化范围。

## 验证与留证

修复后上述四次直接执行都退出 0、27/27。测试文件和 preload 的 node --check、git diff --check 通过。没有重跑全量 smoke、浏览器、Python 或 Windows/完整宿主验收；不能把上轮 243/3/0 称为本轮全量结果。

可复跑固定时钟（替换时间可覆盖另一组和控制组）：

```bash
TZ=UTC ISSUE162_FIXED_NOW=2026-10-03T11:39:17.000Z \
  node --import ./tests/lib/issue162-fixed-clock.mjs --test --test-reporter=tap \
  tests/smoke/smoke-test-issue162-diagnostic-integrity.mjs
```

真实时钟：

```bash
node --test --test-reporter=tap tests/smoke/smoke-test-issue162-diagnostic-integrity.mjs
```

完整原始 TAP（包括失败的完整渲染树、断言与 stack）和 SHA256 汇总在 `artifacts/ui-settings-20261003/issue162-clock/`。复现 preload 在 `tests/lib/issue162-fixed-clock.mjs`，仅通过显式 --import 启用；常规 smoke 不加载它。
