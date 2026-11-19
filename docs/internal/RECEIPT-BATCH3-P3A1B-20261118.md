# Batch 3 P3-A1b 交付回执

2026-11-18。A1b 已落盘并完成本轮自检，供 Lead 复核。基线 HEAD 为 `96bfded8`，叠加已验收的 P3-A1 工作树。裁定 [DECISIONS-BATCH3-P3A1-REVIEW-20261118.md](DECISIONS-BATCH3-P3A1-REVIEW-20261118.md) 实测 7,587 B，SHA-256 为 `1d672fe5d80d661d2afd9fe6b6dc3bfa73ad2635a6ba51565cbeb2f3ae3dc61f`。

## 文件、行尾和改动量

增删行相对 A1b 开工文件。前端从开工副本复算，未跟踪的 UI 测试据本轮补丁在内存复算。源文件定点编辑的原锚点均以对应 EOL 精确匹配一次。下表行号对应最终树，客户端生成区由生成器写入。

| 文件与定位 | EOL | 增 / 删 | 核对内容 |
|---|---|---:|---|
| `skins/iter5/policy-settings.js:27,41,49,57,66,185,220,476,973` | LF | +97 / −5 | 七键清单、已保存判定、只读值和入口、清理接管草稿、发布保存成功回执。 |
| `lib/client.js:17933,17967,20622,20780,21568,22690,22711,25986,25996,26016,26102,26487` | CRLF | +213 / −21 | Classic 手写设置模板和通用保存过滤。v4 共享实现、生成的 v4 模板与 Frozen 镜像由生成器更新。旧设置通用保存排除 `deliveryPolicy`。 |
| `skins/legacy/iter5-325.js.frozen:925,1217,1240,1251,1351,1681,1725,1786` | LF | +39 / −5 | Frozen 透传既有共享组件所需回调，冻结旧行并清理七键草稿。 |
| `lib/injection/policy-runtime.js:2,14,20` | LF | +8 / −27 | `effectiveTriggers` 只读取已保存策略，删除独立的旧键解析和兜底。 |
| `tests/smoke/smoke-test-delivery-settings-ui.mjs:595,1148,1290,1422,1496,1544` | LF | +530 / −24 | 执行生成后 factory、比对真实后端读点、七键四态、同一 factory 两入口延迟读和变异。1,058 → 1,564 行，最终 87,890 B。 |
| `tests/smoke/smoke-test-delivery-policy-runtime.mjs:339,365,398` | LF | +40 / −9 | 检查只读已保存策略，无策略进入真实旧生产解析，增加回退变异。 |
| `tests/smoke/smoke-test-batch3-cadence-projection.mjs:41,95,197,215,234,317` | LF | +59 / −28 | 真人水位夹具、白板核心节和日历表示按当前契约构造。保留末行无换行。 |
| `tests/smoke/smoke-test-batch3-final-frame.mjs:223,235,253` | LF | +60 / −17 | 用真实通知正文定稿和提交，补齐版本、哈希、保留名单与失败重试判据。 |
| `tests/smoke/smoke-test-iter5-skin.mjs:686` | CRLF | +3 / −1 | 原剥离表达式取 Classic 实际哈希，保留完整哈希断言。 |

`lib/index.js` 实测 30,415 行 / 2,214,027 B / 41 导出，SHA-256 `f71d8ece045989d3cd67b937a6b15914ab247f031e7f9b001daf27440ee71c6b`，与 A1 验收值逐字节一致。`cadence.js`、`policy-v2.js`、`final-frame.js`、`dto.js`、`project-handoff.js`、`preview.js`、`diagnostics.js` 的 SHA-256 前 16 位分别为 `057745b2b1407451`、`7eeeb2fa3abf4c03`、`0468ce420cdcba17`、`5405094cc458c01b`、`65b6eb2061932fa6`、`63fee8e41a4bb059`、`0562599aa8c9c1a1`，均与 A1 通过值一致。A1b 工作树 HEAD 仍为 `96bfded8`，版本文件无差异。

## 七键归属与四态

前端三面共用 `ITER5_POLICY_MANAGED_LEGACY_KEYS`。读取 `/config` 的 `config` 对象，以自有的非 `null` 策略字段判定已保存状态。外层 `deliveryPolicy` 在无记录时也含派生策略，因此只用于展示有效策略。显式保存的有效策略即使沿用 `compatibility.source='legacy'` 也会冻结旧行。

| 旧控件 | 保存策略接管字段 | `lib/index.js` 生产证据 |
|---|---|---|
| `injectEnabled` | `enabled` | 24011 |
| `snapshotMinGapRounds` | `triggers.fullGapRounds` | 11064、24175、24314 |
| `slimEveryRounds` | `triggers.slimEveryRounds` | 24176、24316 |
| `fullInjectWaterPct` | `triggers.waterPct` | 24404、24405 |
| `snapshotTieredInject` | `triggers.tieredInject` | 24205 |
| `hangCompensateEnabled` | `triggers.hangCompensateEnabled` | 24087、24699 |
| `hangCompensateTokens` | `triggers.hangCompensateTokens` | 24700 |

`smoke-test-delivery-settings-ui.mjs:1148` 从真实动态回调抽取总闸和六个旧键回退读点，跟踪水位的局部别名。六个策略触发字段同时与真实 `effectiveTriggers` 的返回键比较。最终将结果与 factory 中的唯一冻结常量严格比较。往名单加键、漏键、单独改变后端旧水位读点三项内存变异均被同一守卫检出。

| 场景 | Classic / v4 / Frozen 实测 |
|---|---|
| 有有效保存策略 | 七键都显示服务器旧值和「已由投递策略接管」，没有可编辑输入。先前捕获的处理器也没有调用旧键 `set()`。可进入策略页，兼容页复用既有删除确认。13 段及其他原有可编辑控件仍按旧设置工作。 |
| 删除策略 | 成功回执更新父页，七键恢复编辑。删除只发送 `{ deliveryPolicy: null }`。A1 已验收的事务运行测试继续确认该字段从后端内存和磁盘移除。 |
| 从未保存或遗留 `null` | 两种输入均可编辑七键，服务器返回的派生策略不触发冻结。 |
| 负向变异 | 强制冻结、接受过期 GET、让先前处理器调用 `set()` 均报红。失败的 POST 不切换接管状态。 |

额外实测了同一 factory 的两个设置入口。A 保存后，B 的 GET 暂停期间也依据成功回执立即冻结。B 既存草稿仅能提交未接管的 `injectBudgetChars`。A 删除后 B 立即解冻，Classic 已发出的旧保存 GET 晚到也无法重新提交已删除的策略。移除回执广播或撤掉 Classic 的 `deliveryPolicy` 过滤均复现错误，恢复后 UI 为 **25 PASS / 0 FAIL**。实现通过既有 `saveConfigPatch` 成功回调同步服务器配置，原有刷新照常执行。

## 运行时旧路径与两套红态归因

`effectiveTriggers(config, resolved)` 从 `savedPolicy` 取触发器并复制 `waterPct` 数组。缺失、`null` 和 `source:'legacy'` 返回 `null`，显式非法策略抛 `invalid-delivery-policy`。`resolveRuntimePolicy` 仍可派生供展示的 `legacy` 策略。生产调用拥有已解析的 `saved` 源才进入新读取，未保存时由旧解析提供 40 / 15 / `[25]`。真实生产回调保持连续四个真人请求 `FSSS`。重引旧键回退或让生产忽略已保存的完整帧间隔，两个变异分别被第 05 项检出。

| 套件 | 开工 | 最终 | 根因与修复 |
|---|---:|---:|---|
| `batch3-cadence-projection` | 84 / 13 | **103 / 0** | 9 条水位断言沿用缺真实人声信号的夹具。有效真人信号使显式 `25,50` 在已达 25、现达 51 时授予 `water-50`，`abc` 回到 `water-25`，自定义 70 授予 `water-custom`。白板 3 条需要有标题的正文及显式 `planCoreSections`，日历 1 条需要 `representations.current` 才能到达超限分支。 |
| `batch3-final-frame` | 80 / 4 后退出 1 | **101 / 0** | 旧定稿传 `"最终文本"` 或 `"T"`，没有实际 `payload`。所选通知与版本为空，首次提交与重放均无记录，访问 `store.mem['r-1'].versions` 抛错。新夹具使用 `prepareNotificationPre` 生成的实际正文和两个版本，直接核对选中、幂等、旧版拒绝、写失败和重试。 |

CA/PJ 的 A1 开工夹具以 `96bfded8` 的测试为基底，补回已批准的 26% 和 51% 两条真人正例，内存复跑为 84 / 13。夹具 SHA-256 为 `d3b0f3b200497bdb8ff631a162e51b22e291abceca100078b937a6eb074495c0`。第一条旧失败是 `FAIL ★★[CA] **显式** '25,50' + waterPct=51 + 已投25 ⇒ water-50（显式双档不被缺省逻辑吞掉）`。不带真人信号时函数解释为「没有本请求真人信号；不因水位授予完整帧」。修正夹具同时加入非真人 99% 无授予、真人 `[]` 无授予、复位后再次授予等反例。11 个变异覆盖真人门、显式阈值 25、非法阈值兜底、已投标记、复位、跨阈值最高值、自定义 70、核心白板选节、白板 `none`、通道上限和日历表示。每个变异触发对应断言，原模块复跑为 103 / 0。

旧 final-frame 四个失败分别是通知身份、版本、首次提交 `committed=0`、重放 `skipped=0`。第 248 行抛出 `TypeError: Cannot read properties of undefined (reading 'versions')`。通知正文缺失、显式保留名单排除、旧候选无正文等反例仍验证不提交。绕过正文、保留名单、缺正文降级、版本或哈希检查的五个内存变异均报红，原模块复跑为 101 / 0。

## 计数、生成与本轮复跑

| 取证 | 最终实测 |
|---|---|
| 客户端三元组 | 27,281 行 / 3,033,480 B / 14 个 factory 导出。27,281 个 CRLF，0 个裸 LF。SHA-256 `895f88adcc7c58a1939557b6a6fd90f34f95719f401c14ed333c4af7863d736c`。A1 基线为 27,089 行 / 3,019,831 B / 14 导出。前后真实 factory 的导出名称逐项一致。 |
| 公开计数 | `verify-docs` 与最小宿主 apply 实测 22 工具 / 87 路由 / 182 配置键。真实 import 为插件 41 个、运行时模块 4 个导出。 |
| 生成同步 | `node tools/build-iter5-skin.mjs --check --strict` 打印 `SYNC-OK: sources × generator == lib/client.js`。 |
| Classic 锁 | 最终 LF 1,555,333 字符，SHA-256 `19743d1e11d31e3a67c6b6f974b324a9a01deab01f596a9fe6976c6106de59b5`。旧锁为 1,552,208 字符和 `b979cb0351355a3cf9ce4297456ca597048bfc37b085f33c823127aefd07dedd`。两值均用套件原剥离表达式复算。 |
| r26 | 26 / 0。A1 已钉的后端 LF `1652166` 与 SHA16 `AC3B9340F2E17995` 仍由现有断言通过，本轮 r26 文件与开工副本逐字节一致。 |
| 语法与行尾 | 8 个改动 JS/MJS `node --check` 退出 0，Frozen 用 `vm.Script` 真解析。默认 `git diff --check` 退出 2，报 `client` 1,184、`index` 268、两份 README 各 1 条。用 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 退出 0，无空白告警。Git 另提示 `iter5-skin` 测试的 CRLF 在将来写入 Git 时会规范化。 |

| 逐套件 | PASS / FAIL |
|---|---:|
| `delivery-policy-runtime` | 11 / 0 |
| `delivery-settings-ui` | 25 / 0 |
| `batch3-cadence-projection` | 103 / 0 |
| `batch3-final-frame` | 101 / 0 |
| `delivery-cadence-contract` | 11 / 0 |
| `delivery-policy-v2` | 22 / 0 |
| `delivery-settings-backend` | 13 / 0 |
| `delivery-diagnostics` | 19 / 0 |
| `tiered-branches` | 26 / 0 |
| `batch3-ca-adapter` | 39 / 0 |
| `batch3-contract` | 99 / 0 |
| `iter5-skin` | 26 / 0 |
| `r26-cross-layer` | 26 / 0 |
| `gap-rounds-three-surface` | 56 / 0 |
| `frozen-mirror` | 37 / 0 |
| `client-loadable` | 34 / 0 |
| `v5-p2-water-pct` | 47 / 0 |
| `i335-settings-entry` | 32 / 0 |
| `t1-prompt-sections` | 59 / 0 |
| `settings-parity` | 112 键 × 3 面，退出 0 |
| `run-smoke --filter=batch3` | 16 / 0 套件，0 超时 |
| `run-smoke --filter=delivery` | 7 / 0 套件，0 超时 |
| `run-smoke --filter=inj` | 9 / 0 套件，0 超时 |

Parity 从 110 增至 112，新增的是 A1b 为支持接管冻结补上的 `hangCompensateEnabled` 与 `hangCompensateTokens` 两个旧控件。三面均命中 `hasControl` 的 `cfg.X` 读绑定和 `set('X', …)` 写调用。112 是源码覆盖口径，实际可编辑状态由 UI 执行守卫验证。按该套件判据复算开工快照和最终树，覆盖只新增这两键，v4 和 Frozen 均无缺失。

## 初次失败和处理

- 设置只通过刷新 GET 同步时，v4 / Frozen 持有旧草稿可发出 `{"snapshotMinGapRounds":38}`，服务器旧值原为 37。用成功回执立即更新所有已挂载的策略面，作废较早的 GET 并剔除接管键。Classic 删除后旧保存闭包还可能带回 `deliveryPolicy`，其通用 patch 现在排除策略键。
- 双入口测试第一次复跑时，旧变异锚点依赖「应用回执」与「重置草稿」相邻。将锚点定位到实际草稿重置语句，复跑同一回滚行为断言。
- 共享源更新后，生成器报 `Embedded iter5 skin is stale`。先只读预演，比较生成块外字节和 Frozen 镜像，核实变化来自定点源修改。首次重建归并冻结模板，最后一次重建确认会替换 v4 块内 8 行同一共享实现的旧内容后才用 `--force`。随后用 `--check --strict` 确认同步。
- Classic 锁首次报实际哈希 `19743d1e…` 与预期 `b979cb03…` 不符。源头是授权的旧控件冻结和策略键过滤。按该套件原表达式复算长度和 SHA-256 后更新预期。

## 临时物清理

先执行 `rg` 引用搜索、`git ls-files -- <path>` 及 `git cat-file -e HEAD:<path>`。精确路径命中只用于历史记录，其他 `cases` 命中是各评测自己的目录。下表三个目标及子文件均不在索引，HEAD 检查退出 128。用 PowerShell 原路径搬移至 `C:/Users/JH Z/AppData/Local/Temp/dsh-a1b-cleanup-6f138c203eca4209916ef8e54a3ce183`。原路径均不存在，备份合计 5,454 B，搬移前后逐个核对 SHA-256。

| 原路径 | 大小 | SHA-256 |
|---|---:|---|
| `artifacts/._p1i.mjs.99768.f278208c-a61a-42a6-8020-5c2395acb1b8.tmpdir/_p1i.mjs.tmp` | 2,158 B | `6426dd3dbf4027156e038e81812da7d6cd4ee48d10cc04336dfa852371a0f013` |
| `artifacts/probe_classiclf.mjs` | 1,733 B | `68c928e08ad6b7dd3c6f49602eab0620a0dec2fd49bec8b6270f377f1c920598` |
| `cases/case.schema.json` | 1,563 B | `137f9b7ed3b6e23424e02e171e82f08d35c83bf5b81b25cb64b2bf7daf77593e` |

## A1b2 修正 p6a 两处过期判据

按 [Lead 复核裁定](DECISIONS-BATCH3-P3A1B-REVIEW-20261118.md) 执行。文件实测 6,861 B，SHA-256 `0bdbe832d70c959becb81ba518d2b43e134b8ea3caac7391bd943a68706b7402`。本轮写入仅涉及 p6a 套件和此回执。开工执行 `node tests/smoke/smoke-test-p6a-rules-layer.mjs` 得 **123 PASS / 2 FAIL**，退出 1。两条报错原文如下。

```text
  RED  - 注入调用方取精简版，且开关可一键回退
  RED  - ★规则段排在所有参考内容之前（实测位置：19072 < 58269 / 7325）
```

| 判据 | 根因与修正 | 负路径与变异结果 |
|---|---|---|
| F1 精简文本门控（测试第 187 行） | 旧正则只匹配 `snapshotTieredInject`。现在从生产动态回调抽取保存策略读取和 `slimText` 表达式，用真实 `resolveRuntimePolicy` 与 `effectiveTriggers` 执行。将两种保存策略值分别与相反的旧值配对。有保存策略时 `false` 输出空文本，`true` 输出精简文本。没有保存策略时分别验证旧开关关闭和开启。 | 在内存中令门控忽略保存策略，`false` 错误地返回精简文本。同样在整套测试中分别屏蔽 saved 来源（**129/2**）和去掉旧键回退（**128/3**）。保存策略的开关断言及无策略的旧键关闭断言分别报红。 |
| F2 规则与参考内容的顺序（测试第 420 行） | 旧段名搜索先命中 R-E 锁段保护条件。现从 `renderMemoryDynamic` 切片屏蔽注释，按实际 `part` 和 `pushPart` 的 bucket、kind 找调用。实测规则 push 在所有 10 个 `memoryReferences` 调用之前，保留日志、项目笔记和 Tier-0 目录的存在与顺序检查。 | 将规则 push 移到最后一个参考调用之后。原顺序断言与 Tier-0 断言均报红，整套变异 **128/3**，退出 1。 |

三类变异只替换内存源码，磁盘产品源码未写入。恢复原始加载后，p6a 打印 `[p6a-rules-layer-pre] pass=131 fail=0`，退出 0。`node --check` 与本轮 p6a 的 `git diff --check` 均退出 0。测试从 460 行 / 36,657 B 增至 496 行 / 39,123 B，保留 LF，最终 SHA-256 `e45d50da139fa25ee5d4ddc51991d0c39201a372ed3a6d5474abb3909ff3bfc4`。

| 本轮复跑 | PASS / FAIL |
|---|---:|
| `p6a-rules-layer` | 131 / 0 |
| `delivery-settings-ui` | 25 / 0 |
| `delivery-policy-runtime` | 11 / 0 |
| `r26-cross-layer` | 26 / 0 |

## 未验证项与待裁定事项

真实 DSH 宿主重启、三设置入口真实 a11y 树与截图、真实会话注入、全仓 `--jobs=8 --timeout=180000` 回归尚未验证，属于 P3-B。A1b 写域内未发现需要额外裁定的互斥事实。模块、单元与事件的接管归 A2。
