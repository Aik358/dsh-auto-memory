# 批次 5 收口回执

2026-11-23 · `preview` · 施工基线 `37f20223`。A 独立提交 `9b2ec568`，B 由包含本回执的后续提交交付。

## A · 铭文

按方案 B 将审批稿的 ⑦ 拆回归档层。服务端和客户端的模板按求值后的文本逐字比较。

| 层 | UTF-16 字符数 |
| --- | ---: |
| 主段 `snapshotInscription` | 1,601 |
| 归档 `snapshotInscriptionArchive`（含前导 LF） | 117 |
| 拼接模板 | 1,718 |
| 代入 2026-11-23 | 1,722 |
| 加完整帧的前导 LF | **1,723** |

正文 SHA256 为 `5fe771981bdaeff85699bee121115098c2c917bddfa657385c00ddaa8d38cd5a`。完整帧为 2,733 B，SHA256 为 `2ef1fe966bce77ca52df0f6e497af5d90bda8f2fcb0159c42e33c920d346984d`。1,900 字符上限余 177，⑦ 只出现一次。

## B · 运行档开关

`runTierInjectEnabled` 是独立的顶层布尔键。缺键按 `false`，已有 `true` 重载保留。打开「接续与维护 → 投递策略 → 预设与节奏」，也可直接搜索「无人值守投递」。开关即时保存。POST 只提交该设置，服务器拒绝字符串 `'false'`、`null` 和 `0`（HTTP 400，磁盘 JSON 逐字节未变）。

后端专项加载真实生产回调和渲染器。三种模式各执行五个普通非真人请求并重复渲染最后一个请求。显式开启与 A 完成后的源码基线 `9b2ec568` 先对原始输出做逐字节比较，表中 SHA256 前 16 位仅对回执中的随机夹具目录作了归一化。

| 模式 | 默认关闭时运行档候选渲染次数 | 关闭时每个铭文 | 开启时五帧字节数 | 基线与开启 SHA256 前 16 位 |
| --- | ---: | ---: | --- | --- |
| `legacy` | 0 | 2,733 B | 3,748 / 4,415 / 4,415 / 4,415 / 3,748 | `037cf1245e125680` |
| `eventView` | 0 | 2,733 B | 3,748 / 4,415 / 4,415 / 4,415 / 3,748 | `037cf1245e125680` |
| `units` | 0 | 2,733 B | 3,748 / 2,026 / 2,026 / 2,026 / 3,748 | `574eced19f5d8d98` |

| 保留档 | 关闭时输出 | 与基线逐字节比较 | SHA256 前 16 位 |
| --- | ---: | --- | --- |
| `human_full` | 3,843 B | 相同 | `c7eb0bd591d5b22e` |
| `human_slim` | 4,417 B | 相同 | `cbca9b8fd3c7d987` |
| `post_compact` | 4,106 B | 相同，同一请求重复渲染也相同 | `a197a0a9f50af3ad` |
| `handoff_carry` | 3,847 B | 相同 | `7742f9dccf2a6b8b` |

同一请求开关由开到关时，丢弃普通运行档的定稿和节奏复读文本。再打开会按当前内容计算。压缩重建、交接和已授予的挂机补偿仍可复读。两个回调报告同一批挂机输出 token 时只计一次，满阈值的独立补偿只授予一次。真人 turn 内的后续工具步沿用既有真人识别。

字符模式的独立铭文复用已有 transport 准入并报告超限。`units` 复用整帧组装器，将独立静态纪律计入预算。2,733 B 铭文与 150 B 静态夹具在 2,800 B 硬顶下整段省略，在同一目标另加 100 B 软额度时完整通过。动态投递总闸仍优先。

静态纪律与 M6 记忆唤回各走独立的注册入口。`context-host.js:567` 的候选元数据有 `ttlSteps: 3` 和 180 秒的 `expiresAt`。已烘焙的 packet 实际按 `expiresAtStep` 判断是否过期，真实投递后的墙钟冷却由 `activationDeliveryCooldownMinutes` 单独控制。关闭冷却用 `null`，开启时默认 3 分钟，可选 1–5 分钟。没有固定每三分钟主动发送的定时器。

## 隔离宿主

DSH Web（端口 19437，隔离 profile `settings-search`）完整验证默认未勾选、开启并落盘、刷新后保持勾选、再手动关闭并落盘。之后恢复隔离配置并释放端口。DOM 的可访问名称为「无人值守投递」，勾选状态可在下面的快照核对。

- [设置往返记录](../../output/playwright/batch5-b3/verified.json)
- [默认关闭截图](../../output/playwright/batch5-b3/07-default.png) · [DOM](../../output/playwright/batch5-b3/07-default.yml)
- [保存开启截图](../../output/playwright/batch5-b3/08-enabled.png) · [DOM](../../output/playwright/batch5-b3/08-enabled.yml)
- [重载保持截图](../../output/playwright/batch5-b3/09-reloaded.png) · [DOM](../../output/playwright/batch5-b3/09-reloaded.yml)
- [手动关回的 DOM](../../output/playwright/batch5-b3/10-disabled.yml)

截图为设置行裁切图，边缘有少量遮挡。自动审批以 `blocked by policy` 拒绝了为补拍而重启隔离宿主。真实模型的投递前后对照未运行。宿主图和 DOM 证据保存在本地输出目录。

## 验收与判据更新

| 检查 | PASS / FAIL |
| --- | ---: |
| G4 Whiteboard | 11 / 0 |
| r26 Cross Layer | 26 / 0 |
| Delivery Settings UI（含保存、失败重试、搜索和三面工厂执行） | 32 / 0 |
| Iter5 Skin | 28 / 0 |
| Batch Y Frontend | 75 / 0 |
| V5 P6 R4 Scope Filter | 57 / 0 |
| Delivery Policy Runtime（含本批专项） | 17 / 0 |
| Delivery Settings Backend | 13 / 0 |
| Delivery Policy V2 | 22 / 0 |
| Batch 3 U3b | 19 / 0 |
| V4 C2 Inscription / V4 P1 Exposure | 27 / 0、45 / 0 |
| V5 P4 Content Tier / V5 P3 Tier Content | 54 / 0、51 / 0 |
| P6A Rules Layer | 133 / 0 |
| Client Loadable | 34 / 0 |
| Settings Parity | 三面各 113 键 |
| Context Observer | M2 套件通过（含恢复、重放和隔离） |

`verify-docs` 实测 22 工具、87 路由、183 设置键。严格生成器检查输出 `SYNC-OK: sources × generator == lib/client.js`。Node 语法检查通过，服务端真实 import 有 41 个导出，浏览器 factory 在最小宿主内真实执行，14 个导出键和 A 基线相同。服务端 `lib/index.js` 为 30,609 行、2,227,586 B、CRLF。客户端 `lib/client.js` 为 27,709 行、3,073,352 B、CRLF。前端生成源为 LF。

首次差分分别复现了压缩重建被同请求后一次渲染覆盖、重复回调使 60 token 提前跨过 100 token 阈值，以及 `units` 仍放行超硬顶的整段铭文。保留区别特殊帧的定稿标记、按请求采样及共用预算后，这些断言复绿。禁用后再开启仍可从节奏状态读到旧正文的断言也先红，清掉这一复读来源后复绿。

P6A 源码抽取首次报 `ReferenceError: skipRunSnapshot is not defined`。夹具向生产表达式提供这项运行状态，保留策略优先及旧键回退断言，新增删除运行档门控后必红的变异。U3b 字节锁通过在其旧场景还原历史铭文继续验证，Context Observer 的旧场景显式开启运行档，以维持原测试意图。两份旧铭文测试统一为已裁定的 1,900 完整渲染字符上限。r26 首报实际 `1,665,509 / 969B3A6FFC4F390C`，据此重钉并复绿。
