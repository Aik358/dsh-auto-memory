# Batch 3 P3-A1 接线回执

2026-11-18。工作树基线 HEAD `96bfded8`（叠有已验收的 P1/P2）。唯一范围依据是 [P3-A 裁定](DECISIONS-BATCH3-P3A-SCOPE-20261118.md)；实测 11,426 B，SHA-256 `7a9cccf910c2ed631616f74f94c5806ceaf02bedc3a3a45434a460ff0359df6a`。**A1 已落盘，等待 Lead 复核。** 未开始 A2，未提交、推送或改版本。

## 阶段与结果

显式保存的策略接管动态总闸、full/slim 间隔、分级开关、水位和挂机阈值。生产仍按原来的授予条件决定帧节奏；未调用公共 CA 真人 full 旁路。无保存策略时直接走旧节奏分支，派生预算仅用于观察。`[]` 关闭水位；`25.5` 和显式双档均经真实回调验证。`postCompact` 等未接触发、模块开关、模块视图、单元表示、配额和模块级预算仍仅预览；已分页面标明状态。

同一动态面的最终文本（包括标题、分隔符及已拼入的尾注/标记）在新的 `finalizePre` 调用与两处复读出口做 UTF-16/UTF-8 计量。静态纪律、独立 M6 等其他宿主面不计入。硬顶超限整帧为空，有锁段时记录 `locked-content-does-not-fit`；普通超限记录 `transport-hard-limit-exceeded`。软预算记录目标超额，超过 allowance 后只尝试省略已组帧、可完整定位的原低优先级段；没有安全候选则记录 `transport-soft-allowance-exceeded` 并返回空。A1 没有生产的备用单元表示，未将预览的表示选项接入。整帧拒绝恢复水位/节奏的授予标记和一次性提示，仍保留真实的请求序号、水位回落、token 累积、压缩观察与拒绝收据。同请求同预算不会在重放时换成另一个输出。

`deliveryPolicy:null` 是删除命令。沿原事务原子写盘，成功才发布内存。读到遗留 null 视为缺失；启动逐键补齐和后续保存不会把它写回来。GET 回显 legacy 派生，旧 `/config` 写入仍被接受。实际策略保存依旧只写 `deliveryPolicy`。

## 改动清单与锚点

`lib/index.js` 以 A1 开工前副本比较，唯一命中的 CRLF 定点 hunk；无整文件替换。前端改 LF 共享源，`lib/client.js` 的变化由生成器产生。表中「净增」是与已验收 P2 快照直接核对的净行数。

| 文件 / 当前行 / EOL | A1 增删 | 内容与锚点 |
|---|---:|---|
| `lib/index.js:32,202,3393,4051,4067,4353,4399,4443`（CRLF） | 全文件 +160/−54 | 接运行时，稳态合并、保存及重载都保留删除。以现有 import、`_mergeConfigPre`、`_saveConfigChecked` 的完整行/上下文定位。 |
| `lib/index.js:11064,12682,13166,13848,24008,24164,24206,24266,24405,24716`（CRLF） | 同上 | 节奏提示、旧锁段闸、账本独立 profile、组帧边界、动态总闸和触发、准入/复读和拒绝恢复。保持 `_grantByHuman=false`、原 `_isFullTier`、桶镜像、Tier-0 和独立面。 |
| `lib/injection/policy-runtime.js:14,28,52,57`（LF） | +81/0 | 新文件，四个纯函数。不导出到插件入口；`effectiveTriggers` / `frameTransport` 可复用一次请求解析。 |
| `lib/injection/policy-v2.js:233,249,357,407`（LF） | +26/−3 | 水位接受 `(0,100]` 至多两位小数；跨档修正不合法的表示字段，不丢其他合法编辑；显式非法完整版仍拒绝。`compatibility.source=legacy` 的派生值不成为产线硬顶。 |
| `lib/injection/cadence.js:47`（LF） | +2/−2 | 空数组分支和相应契约说明；缺失/空串/非法仍默认，r3 不变。原末行无终结换行保留。 |
| `skins/iter5/policy-settings.js:195,210,667`（LF） | 净增 29 | 七页生效范围；小数水位输入、空列表、保存和删除回滚状态。保留「行为与维护」的共同挂载。 |
| `lib/client.js:20562`（CRLF） | 净增 29 | 生成器导入同一共享组件；经典区、Frozen 和 factory 导出守恒。 |
| `tests/smoke/smoke-test-delivery-policy-runtime.mjs:133,219,595`（LF） | +628/0 | 新增真实函数/宿主回调/配置事务夹具，包含 787 复算及 11 条负路径和变异。 |
| `tests/smoke/smoke-test-delivery-settings-ui.mjs:837`（LF） | 净增 108 | 生效范围、双语、水位、真实保存字段、回滚草稿，保留原 15+2 旧键守卫。 |
| `tests/smoke/smoke-test-batch3-bd-adapter.mjs:23,92,128`（LF） | +6/−5 | 抽取账本闭包真实注入已使用的结构解析和加权器；投影异常必须留降级且禁止原文输出。 |
| `tests/smoke/smoke-test-delivery-settings-backend.mjs:134`（LF） / `smoke-test-inj4-slim-throttle.mjs:199`（LF） | +2/−1、+3/−1 | R-F 以无自有属性替代旧 `===null`；节流守卫同时查两个生效入口及旧回退。 |
| `tests/smoke/smoke-test-r26-cross-layer.mjs:822,1065`（LF） | +5/−4 | 仅后端锁按套件自己报的 LF 长度 `1652166` 和 `AC3B9340F2E17995` 重钉。保留长度和 SHA16 两项严比。 |

## 三元组、生成与计数

| 项 | 最终实测 |
|---|---|
| `lib/index.js` | 30,415 行 / 2,214,027 B / 41 导出；30,415 个 CRLF、无裸 LF。SHA-256 `f71d8ece045989d3cd67b937a6b15914ab247f031e7f9b001daf27440ee71c6b`。原行内 CR 未清洗。 |
| `lib/client.js` | 27,089 行 / 3,019,831 B / 14 factory 导出；全 CRLF。SHA-256 `e21eef1b13aef580f5a6b5f2c3fa0dc3bd542f96ebf734a13d70f6fce19c1cfc`。真 import 与 factory 执行；r26 经典侧去生成区仍为 `21DD0F569DD42D00`。 |
| `policy-runtime.js` / `policy-v2.js` / `cadence.js` | 81 行 / 3,541 B、444 行 / 27,759 B、337 行 / 17,715 B；LF。SHA16 `129f5793af6f8656`、`7eeeb2fa3abf4c03`、`057745b2b1407451`。 |
| 其他 P1/既有注入文件 | `preview.js` `63fee8e41a4bb059`、`diagnostics.js` `0562599aa8c9c1a1`、`final-frame.js` `0468ce420cdcba17`、`dto.js` `5405094cc458c01b`、`project-handoff.js` `65b6eb2061932fa6`，与开工前一致。 |
| `verify-docs` + apply | **22 工具 / 87 路由 / 182 公开键**。插件入口 41、factory 14 同前。 |
| 生成器 | `node tools/build-iter5-skin.mjs --check --strict` 原文 `SYNC-OK: sources × generator == lib/client.js`。 |

对所改 JS/MJS 做了 `node --check`，用真实 import 和最小宿主 apply 验证入站/出站面。默认 `git diff --check` 退出 2：当前 `client` 985、`index` 268、两份 README 各 1，共 1,255 条 CR 行尾告警。加 `core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol` 执行同一检查退出 0、无尾随空白告警。保留文件行尾纪律，未改 Git 配置。

## 逐套件 PASS / FAIL

| 套件 | 结果 |
|---|---|
| `delivery-policy-runtime` | 11/0，使用开工前 `index.js` 副本加强对比亦 11/0。 |
| `delivery-cadence-contract` / `delivery-policy-v2` / `delivery-diagnostics` | 11/0、22/0、19/0。 |
| `delivery-settings-backend` / `delivery-settings-ui` | 13/0、22/0。 |
| `tiered-branches` / `inj4-slim-throttle` / `inj5-step-cadence` | 26/0、15/0、15/0。 |
| `batch3-bd-adapter` / `batch3-ca-adapter` / `batch3-rp-adapter` / `batch3-cb` / `batch3-contract` | 64/0、39/0、53/0、23/0、99/0。 |
| `t1-prompt-sections` / `v5-p2-water-pct` / `gap-rounds-three-surface` | 59/0、47/0、56/0。 |
| `frozen-mirror` / `client-loadable` / `i335-settings-entry` / `iter5-skin` / `settings-parity` | 37/0、34/0、32/0、26/0、110 键 × 3 面均通过。 |
| `r26-cross-layer` | 重钉前 24/2，仅两个后端锁；按 actual 重钉后 26/0。 |
| `run-smoke --filter=delivery` / `--filter=inj` | 套件数 7/0、9/0，含上面列出的部分套件。 |
| `run-smoke --filter=batch3` | 套件数 14/2。下列两项保持原判据与红态。 |
| `batch3-cadence-projection` | **84/13**。用 SHA-256 `d7300d76…` 的精确开工前 `cadence.js` 同测，13 个失败项逐条相同。 |
| `batch3-final-frame` | **80/4，随后异常退出 1**。`smoke-test-batch3-final-frame.mjs:248`: `TypeError: Cannot read properties of undefined (reading 'versions')`。仅加载套件实际调用且 A1 未动的 FM/BD/NT 及 DTO/错误依赖，复现相同结果；[A 批 r2 复审](REVIEW-BATCH3-A-R2-20261117.md) 已记录第 69 行同一失败。未计作通过，也未改旧断言。 |

## 负路径、变异和 787 字复算

| 新套件项 | 真执行判据与必红变异 |
|---|---|
| 01 | 真实渲染器、HEAD 与本树各跑连续四真人，FSSS 且每帧逐字节等同。把 `_grantByHuman=false` 换成真人即 full 时断言失败。 |
| 02 | `[]` 关闭不被旧默认重开，`[25,50]`、`[25.5]` 按值触发；旧 `'25.5'` 适配成功，超过两位小数的 Policy 值被拒。将空数组回读 `[25]`，真实回调断言失败。 |
| 03 | 保存 slim summary 后解析/预览完整版成功，目标用 `full/omit`，显式 `human_full+summary` 拒绝。恢复旧跨档直接合并，命中 `human_full allows only full or whole-unit omit`。 |
| 04 | 真实闭包、新旧加权器调用与实际渲染验证标签、长短输入和畸形降级。把 `_finish` 参数改为原文，重现 `slim leaked a task-state unit`。 |
| 05 | 用实际回调检查保存值相对旧键优先，缺省 40/15/[25]、显式 0、挂机和分级分别断言；让 full gap 重读旧键，帧轨迹失败。 |
| 06、07 | 字符和字节的各自硬顶、尾部一起计量、零部分输出；旧 false 关不掉两锁段；锁段超限无截片。绕过定稿计量或还原旧段开关，原断言必红。 |
| 08 | 软目标超额、允许带内放行、超 allowance 的完整段省略或显式失败均出收据。绕过计量后，allowance 超额判据报红。 |
| 09 | 真 `/config` 保存、删除、GET、重载、再次保存，磁盘/内存皆无键，旧键仍接收；写回 null 的变异由磁盘 JSON 判据捕获。 |
| 10 | 有策略用新总闸，缺策略用旧闸，legacy 派生硬限不执行；静态与 M6 独立。强行读旧总闸的变异报红。 |
| 11 | 24% 先给完整帧；26% 真人请求被 0 硬顶拒绝、同请求复读仍空、水位未消费；放宽顶后下一真人补投，才记 25% 已投。禁用恢复分支时 `a rejected full frame must leave the water threshold pending`，原码复跑绿。 |
| UI | 真实 factory 读取七页状态、双语文案、单键保存、删除回滚、旧控件。水位精度和空列表三种变异、英中各 11 个生效范围/状态变异、回滚草稿不重载变异均被捕获。 |

精确样例来自 `smoke-test-delivery-policy-runtime.mjs:133`，预算 800 UTF-16 字符，无末尾换行：

```js
const ledger787 = [
  '# 交接', '## 目标 [type:goal]', 'G'.repeat(919),
  '## 任务状态 [type:state]', 'STATE-SHOULD-BE-OMITTED',
  '## 已试方案与失败原因 [type:dead-end]', 'D'.repeat(300), 'FAILURE-END',
  '## 进度与下一步 [type:progress]', 'N'.repeat(313), 'NEXT-STEP',
].join('\n');
```

原始文本 1,679 字符，三段投影 1,625；抽取开工前真实 `ledgerPart` 配真实 `projectHandoffPre` 和 `weightedTrimHandoffLedgerPre`，旧 `_finish` 选 787 字符，含 `type:state` 和状态标记。真实依赖齐全，**不是缺依赖探针假象**。新闭包回传 731 字符、793 UTF-8 字节，保留 `FAILURE-END` / `NEXT-STEP`，无状态段；生产 `run_full` 同样过实际段回执复核，`run_slim` 真实提醒面没有账本段。另测内联标签、独立标签、短账本、超长账本，以及只有状态文本的畸形账本（省略且记录 `handoff-ledger-no-eligible-sections`）。

## 首次失败与处理

1. `assert(run.includes('失败原因-END') && run.includes('下一步-END'))`：真实账本把 `type` 放在标题末尾。识别内联标签并恢复加权器认识的 Markdown 标题；同时，BD 抽取守卫首次 61/3，补注入真实结构解析器和加权器后 64/0，三段检查未放宽。
2. `undefined` 对 `null`：旧 P1 断言仍要求回滚后内存保留 null；R-F 改为同时断言内存和磁盘无自有键，后端 13/0。`RED - T7-a：slimGap 从配置读取（节流判据入口在位）`：旧模式只认旧键读法，扩为真正的内外节流优先级及回退，原行为用例全保留，15/0。
3. 生成严格保护拦住共享组件的旧产物；在临时副本核对变更仅在该组件区、其余字节含 Frozen 一致后运行生成器重建，再用 strict check 得 `SYNC-OK`。r26 按最终实际打印的 `AC3B9340F2E17995` 和 `1652166` 更新，26/0。
4. 新负路径暴露硬顶拒绝早于定稿但晚于旧授予分支：请求输出空且误消费水位。对受限保存策略恢复被拒帧的授予与一次性提示状态，保留观察值；变异关掉恢复后必红，水位重试复绿。

## 需 Lead 确认与未验证

- **旧控件冻结。** [R-F](DECISIONS-BATCH3-P3A-SCOPE-20261118.md) 写「旧键写入在 A1 仍被接受，仅 UI 冻结」；同一文件 §3 的前端批准点只列共享策略页的分页标注，Classic 和 Frozen 的旧设置模板不是该写域。本轮保持共享兼容页只读、原旧控件可写，并标明保存策略的优先级；冻结哪些旧控件、是否只在已有保存策略时冻结，需要明确写域与状态规则。13 段可编辑权威未变。
- **软预算备用表示。** R-E 规定在有允许的完整表示时先降级；A1/A2 边界规定单元表示与配额仍仅预览。A1 使用已存在的整段边界和显式失败；不得承诺用户设置的表示链已在生产运行。结构化备用表示和逐单元选择留 A2/U3。
- **未验证**：真实 DSH 宿主重启、a11y、截图、真实会话注入及全量回归，交 P3-B。旧 CA/PJ、FM/NT 的两个既有红套件不在 A1 修复范围；真实宿主收到哪些帧以及 U3 的 `human_slim` 最终可达性均未宣称已验。
