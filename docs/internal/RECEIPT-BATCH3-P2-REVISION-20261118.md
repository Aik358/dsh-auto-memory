# Batch 3 P2 修正复审回执

日期：2026-11-18。阶段：Lead 已确认 F1–F4；设置入口已归入「行为与维护」；F5 已落盘并复跑，待 Lead 核验。P3-0 另交只读测绘回执。

依据：[Lead 有条件退回复核](REVIEW-BATCH3-P2-CONDITIONAL-20261118.md)，SHA-256 `49f2b4ef52374365d333b2e85276b424f8785dab90380837b3a32f3c40f28874`，以及 [Lead 修正版复核和 F5](REVIEW-BATCH3-P2-REVISION-ACCEPT-20261118.md)。[原回执](RECEIPT-BATCH3-P2-20261118.md) 保留为历史记录。

## F1–F5 落盘

| 项 | 用户可见结果 | 源与产物位置（均为本轮最终行号） |
|---|---|---|
| F1 | 原设置的 15 个有效键继续可编辑和保存。原来一并恢复的两个历史键按 F5 改为只读。 | `lib/client.js:25815` classic、`:22533` v4、`:17950` Frozen 内嵌镜像（CRLF）；`skins/legacy/iter5-325.js.frozen:1234`（LF）。 |
| F2 | 策略页头、模块、预算与超额、触发页，以及保存成功状态均说明：策略用于预览、回执与诊断，其余真实投递仍走原设置。 | `skins/iter5/policy-settings.js:185`/`:383`/`:849`/`:853`（LF），`lib/client.js:20746` 起为生成产物（CRLF）。 |
| F3 | 三份设置模板保留服务端下发的 13 段开关和「全部恢复全开」。关闭写 `false`，重开移除该键，全部恢复写 `{}`。 | `lib/client.js:26142` classic、`:22906` v4、`:18341` Frozen 内嵌镜像（CRLF）；`skins/legacy/iter5-325.js.frozen:1625`（LF）。 |
| F4 | 完整／精简间隔缺省 `40 / 15`，显示与清空后保存的值一致；水位默认 `25`，显式 `25,50` 保留。 | `lib/client.js:26190`/`:26201` classic、`:22954`/`:22965` v4、`:18391`/`:18395` Frozen 内嵌镜像（CRLF）；`skins/legacy/iter5-325.js.frozen:1675`/`:1679`、`skins/iter5/settings-copy.js:32`（LF）。 |
| F5 | `externalInjectionChars` / `handoffPlanChars` 仅显示当前值与「当前无效（历史键）」；仅缺值时显示原缺省 `1400 / 1200`，显式 `0` 原样显示。没有输入、保存回调或新键。兼容页继续只读。 | `lib/client.js:26189`/`:26286` classic、`:22953`/`:23050` v4、`:18390`/`:18486` Frozen 镜像（CRLF）；`skins/legacy/iter5-325.js.frozen:1674`/`:1770`、`skins/iter5/settings-copy.js:31`/`:8`（LF）。手写客户端 `+8/-8`、Frozen 和文案各 `+2/-2`，生成产物另 `+6/-6`。 |

设置归位后的单一组件仍经三面 props 挂载，默认皮肤／v4 共享策略样式；默认仅展开「配置策略」入口，策略编辑器组内显示。F5 未改生成器或共享策略组件。策略保存仍只携带 `{ deliveryPolicy }`，预览只携带 `policy|tier|isHuman|isFull`；逐段开关继续走旧配置写 `promptSectionToggles`。

## 守卫与变异

| 守卫/位置 | 本轮碰锁情况与正向证据 | 负路径及还原证据 |
|---|---|---|
| F1 `smoke-test-delivery-settings-ui.mjs:697`（LF） | classic 模板、v4、Frozen 源及内嵌镜像各实际操作 15 个有效控件，再执行保存；一次 `/config` POST 只含这 15 个键。 | 逐面禁用 `injectEnabled`，同一断言只报该键不可编辑；用原源码复绿。 |
| F2 `smoke-test-delivery-settings-ui.mjs:771`（LF） | 英中分别执行四处渲染和保存，验证成功状态含同一生效范围。 | 分别删除页头、任一子页或保存成功文案中的说明，同一断言在两语种报对应位置缺失；原源码复绿。 |
| F3 `smoke-test-t1-prompt-sections.mjs:133`、`:192`（LF） | 撤销退回版本的“只读才正确”判据；保留服务端 13/2 清单检查、写入入口与恢复按钮检查，实际操作 13 段、验证回显、重开与重置。 | 修复前 `49 PASS / 7 FAIL`。三份修复模板分别注入 `disabled: true`，同一断言报 `rules-section 开关必须可编辑`；原源码复绿为 `59/0`。 |
| F4 `smoke-test-delivery-settings-ui.mjs:817`、`smoke-test-gap-rounds-three-surface.mjs:102`、`smoke-test-v5-p1-inject-throttle.mjs:49`（LF） | 在三份模板和内嵌镜像上检查显示的数值及清空输入后的保存值；保留显式 `0/1`。三语文案和未配置、非法输入、调用点计数判据继续执行。 | 各面分别把两项显示值或保存回退改回 `20/8`，同一判据报 `displayed cadence fallback` 或 `posted cadence fallback`；原源码复绿。 |
| F5 `smoke-test-delivery-settings-ui.mjs:731`（LF） | 四份源码运行面分别检查保存值、显式零、缺省、英中标注及零请求；只读行不得包含输入或其他可编辑控件。 | 各面分别把两个键的文本改回真实可触发 `set(key, value)` 的输入，8 个变异分别报 `historical key is editable: <key>`；原源码通过。 |
| 设置归位 `smoke-test-delivery-settings-ui.mjs:849`、`:928`（LF） | 「行为与维护」挂载、七页签／折叠草稿，以及两套皮肤样式复用均通过。 | 错误分组、重复入口、移除 Frozen 策略样式均被同一守卫拦截。 |
| 经典区 `smoke-test-iter5-skin.mjs:683`（CRLF） | 原剥离管道复算 `classicLF` **1,552,208 字符**，SHA-256 `b979cb0351355a3cf9ce4297456ca597048bfc37b085f33c823127aefd07dedd`。只更新预期，完整 LF 归一化哈希比较保持不变。 | 旧锁 `50da6495…` 实跑不匹配；按套件 actual 重钉后退出 0。 |
| parity / frozen-mirror / r26 | 未改动本轮三套判据。parity 核对 classic 覆盖的 110 项都有其他面对应点；frozen-mirror 核对生成导入与镜像；r26 跑后端硬锁和跨层检查。r26 打印剥离生成区后的客户端指纹，不是客户端原文件三元组。 | 均按原判据复跑，结果见下。 |

变异在 VM 源码副本中执行；负路径复用正向判据，未替换落盘的生产文件。

## 三元组与同步

| 项 | 实测 |
|---|---|
| F5 前的 Lead 核验快照 | `lib/client.js` **27,060 行 / 3,018,587 B / 14 个 factory 导出**，纯 CRLF；SHA-256 `5c574cf276fac8e40ea1381ba9e86690d45365448c5d749ef3e1c64311d549b9`。`policy-settings.js` 877 行 / 63,968 B；Frozen 2,537 行 / 357,811 B；UI 20/0。开工时重新读取字节，全部与 Lead 数据一致。 |
| F5 后最终 `lib/client.js` | **27,060 行 / 3,017,717 B / 14 个 factory 导出**。全 CRLF，裸 LF 0。SHA-256 `f9a3119cb466fe1a5190baa367eb676e71f2b24ff91c46c5888ca8f18b11eeb9`。最小宿主真实 import 和 factory 运行，14 个导出逐名一致，零网络请求。 |
| F5 后 LF 源 | `policy-settings.js` 877 行 / 63,968 B，未改。Frozen 2,537 行 / 357,593 B，`settings-copy.js` 91 行 / 24,395 B，UI 守卫 950 行 / 54,405 B。 |
| 后端 | `verify-docs` 实测 22 工具 / 87 路由 / 182 配置键；`lib/index.js` 实际 import 41 个 ESM 导出。P1 六文件及 `final-frame.js` 的完整 SHA-256 与开工时相同。 |
| 编辑边界 | 唯一锚点按原 EOL 匹配。内存预检确认生成阶段只替换 F5 对应六行，其余字节不变。`node --check`、Frozen 源语法、生成器严格检查通过。HEAD 仍为 `96bfded8`；未提交、未推送、未改版本。 |

默认 `git diff --check` **退出 2**：当前从告警行实际计得 1,072 条（client 956、index 114、两份 README 各 1），另有一条 Git 的 CRLF 未来转换提示，不计入告警。`lib/client.js` 和 `lib/index.js` 的 HEAD blob 与工作区均含全 CRLF，属性为 `text=auto eol=lf`。对 Lead 点名的 `README.md:688`、`README.zh-CN.md:684` 逐字节检查，两处尾部均为 `7c 0d 0a`（`|` 后直接 CRLF），分隔符后没有 `20` 或 `09`，因此无需清理真实尾随空白，两份 README 保持原样。带 `cr-at-eol` 复跑 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` **退出 0、零空白告警**；保留行尾约定，无 Git 配置改动。

`node tools/build-iter5-skin.mjs --check --strict` 原文：

```text
SYNC-OK: sources × generator == lib/client.js
iter5 bundle source is up to date
```

## 逐套件复跑

从仓库根目录执行 `node tests/smoke/smoke-test-<套件>.mjs`。未输出统一计数的套件下表按实际独立 PASS 输出组记账，汇总行不重计。

| Lead 指定套件 | PASS | FAIL | 退出码 |
|---|---:|---:|---:|
| `t1-prompt-sections` | 59 | 0 | 0 |
| `delivery-settings-ui` | 21 | 0 | 0 |
| `v5-p2-water-pct` | 47 | 0 | 0 |
| `settings-parity` | 7 组，3 面各 110 项 | 0 | 0 |
| `frozen-mirror` | 37 | 0 | 0 |
| `iter5-skin` | 26 组 | 0 | 0 |
| `client-loadable` | 34 | 0 | 0 |
| `i335-settings-entry` | 32 | 0 | 0 |
| `settings-sync` | 4 组 | 0 | 0 |
| `s2-settings-panels` | 39 | 0 | 0 |
| `batch-y-frontend` | 73 条断言 | 0 | 0 |
| `r26-cross-layer` | 26 | 0 | 0 |

另跑 `gap-rounds-three-surface` 56/0、`v5-p1-inject-throttle` 32/0；两者退出码均为 0。

## 失败与处理

1. F5 新守卫先在旧界面报 `classic: historical key is editable: externalInjectionChars`。将输入改为只读文本后，出现 `classic: missing historical label for externalInjectionChars`：最小宿主设置了夹具配置的 `locale`，却未调用实际 `applyLocalePref`，运行仍为中文。夹具显式调用宿主语言逻辑，分别检查英中标注，守卫复绿。没有放宽 F5 判据。
2. 按六行产物预检结果，由生成器替换旧控件／文案产物；严格同步为 `SYNC-OK`。经典区旧哈希 `50da6495…` 随真实模板改动报不等，按套件 actual 重钉后保留完整比较。

## 未验证与待裁定

- 真实 DSH 宿主三个入口的截图、a11y 树及真实会话注入：**未验证**，交 P3-B。前一轮隔离浏览器截图不属于真宿主证据。classic `SettingsPage(props)` 是生成模板；尚未证明它是独立的运行时入口。
- 普通投递仍使用旧配置。模块、预算、触发还未接入真实注入。窄窗页签、重复横幅与两个保存动作的提示是 Lead 留给 P3 的非阻塞项。P3-0 的接线候选见 [只读测绘回执](RECEIPT-BATCH3-P3-0-WIRING-MAP-20261118.md)。
