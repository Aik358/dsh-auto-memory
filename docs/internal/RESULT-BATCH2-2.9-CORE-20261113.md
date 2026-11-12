# 批次 2 / 2.9 独立核心结果：handoff 规范化、覆盖证明与 sourceRef

> 日期：2026-11-13（Asia/Hong_Kong）
> 范围：task-14 独立实现与隔离验收，**不是生产接线或真实记忆清理**。
> 工作树复核：`1d03c8f3`（并行工作线继续前进；本批没有 commit/push）。

## 1. 交付与结论

仅新增以下四个任务书允许的文件：

- `lib/handoff-normalize.js`：确定性规范化、四段解析、额外节/备注/锚点/未知字段证据。
- `lib/handoff-coverage.js`：真实来源证明、四段与全文覆盖评估、只读权限边界。
- `tests/smoke/smoke-test-batch2-2.9-handoff-coverage.mjs`：真实 import/调用、负路径、隔离事件库与三个变异。
- 本结果文档。

最终实测：**39 PASS / 0 FAIL；3/3 变异 CAUGHT / 0 MISSED**。运行器 `--filter=batch2-2.9-handoff-coverage --jobs=1 --timeout=120000`：**PASS 1 / FAIL 0 / TIMEOUT 0**。这不是全仓回归或生产 HOST 验证。

## 2. 可消费 API

| API | 输入/输出要点 | 权限边界 |
|---|---|---|
| `normalizeHandoffContentPre(input, options)` | 返回 `normalizedContent`、`normalizedBytes`、`normalizedSha256`、`rawBytes`、`rawSha256`、行数和逐项诊断。 | 纯函数；不改输入或存储。 |
| `parseHandoffCoveragePre(input, options)` | 返回 `quad/normalizedQuad/quadPresence`、完整性、`sections/regionDigests`、额外节、用户/模型备注、锚点、未知字段和声明事件 ID。 | 完整性不等于覆盖；额外 H2 不会被并入前一四段。 |
| `buildHandoffSourceProofPre(input, options)` | 必须给绝对 `handoffDir`；读取 trusted root 内真实文件，返回相对 `sourceRef`、`rawSha256`、`normalizedSha256`、`bytes`、起止行、`quoteLine` 与物理路径。 | 根外、绝对路径、点段、根/文件符号链接、archive、无效 UTF-8 拒绝；不写源文件。 |
| `assessHandoffCoveragePre(input, options)` | 对照真实文档、检查点全文/四段、事件成员和来源证据，返回 `covered/partial/mismatched/needs-review/ineligible`、原因、五项 gate 与 `sourceProof`。 | 不查询/猜测最近 active；`eventClaimed:false`，删除/归档/归并资格均 false。 |

`options.intent:'write'` 只表示调用方的写入意图；closed 目标在该模式下返回 `event-target-closed`，API 自身仍不执行写入。真实事件绑定必须存在于所选事件检查点，或由选择器对应的派生键成员匹配；不能靠同名 `eventId` 自动认领。

## 3. 指纹、空值与证据语义

### 3.1 两种 normalized SHA-256 不得混用

1. **rawSha256**：对磁盘原始 UTF-8 字节计算；CRLF/LF 不同则 raw 不同。
2. **normalizedSha256**（2.9）：`r4-handoff-coverage-normalize-v1`，复用既有 ledger 格式规范化，保留实质内容。
3. **documentNormalizedSha256**：现有 `normalizeText` 口径，供 `readPointerPre` / `event-drilldown` 消费；它不是 2.9 的覆盖 hash。

允许等价：UTF-8 BOM、CRLF/CR→LF、行尾水平空白、最外层空行、生成的账本 H1、既有协议元数据。**不允许**把实质文字、行内空白、Markdown 强调或额外节标题的改动当格式差异。

空值按任务书与当前存储语义处理：

- 空 `dead` 和 `dead:[]` 都表示未记录失败，不等于“显式无失败”。
- “无已确认失败”与空串/空数组不折叠；非空数组或对象不会被当作文本。
- 缺段、空 goal/state/next、重复节、未闭合备注、未知字段均进入明确的非覆盖/复核路径。
- 只有 text 而无完整四段与完整指纹不能判 `covered`；当前指针不能反证旧版全文。

`legacyCheckpointKey` 使用既有 `computeLegacyCheckpointKey` 的字段投影重算，包含 eventId、真实选择器、at/kind/text/sourceRef/idemKey/quad；辅助键本身不递归进入哈希。

## 4. 实测结果与物理量

### 4.1 专项功能路径

- 规范化：CRLF/LF/CR、末尾换行、BOM、受控格式一致；实质文字、行内空白和强调变化保持不同 hash。
- 解析：四段、额外节、用户/模型备注、锚点、行号、区域 SHA；缺段、空值、重复节、text-only、未知字段与长正文均实测。
- 长正文夹具：**120,303 B**，未截断；未闭合用户备注进入复核。
- sourceRef：trusted root 真实读取、CRLF raw/覆盖指纹差异、非法/根外/嵌套 junction/文件 symlink/根 symlink 全部负路径。
- 覆盖：全文/四段/绑定/指纹/来源证明五门；raw 不同但规范化相同、hash 相同但正文漂移、备注/锚点缺失均不能误判。
- 事件：真实隔离事件库 append→detail→选择→关闭→拒绝新增；关闭后库字节完全不变。
- 输入对象未改；重复纯函数结果与字段稳定。

### 4.2 文件指纹

| 文件 | 字节 | 行数 | SHA-256 |
|---|---:|---:|---|
| `lib/handoff-normalize.js` | 16,103 | 352 | `4af8e2dc543a88d13e5252412c1a7dde60732b871680e69fed4c1732da1bf270` |
| `lib/handoff-coverage.js` | 26,910 | 447 | `ab64e86cad4df12be7ccf5976d5390a0613f3b61e98c3ccfcdbf8d43b9d724bc` |
| `tests/smoke/smoke-test-batch2-2.9-handoff-coverage.mjs` | 41,415 | 650 | `41473fcdcb460dd9f42b154bb2b0bf5dbcd5c1f0f7a0d018ba1a02e5e7c452aa` |

以上三个文件均无 BOM、无 CRLF 与裸 LF 混用。

合成来源夹具：262 B / 13 行；raw `bab1d6c9b99ddd615e6c82ebee528adc359a29a9c5d13047e872c55297c2faa1`；2.9 normalized `1dfd781b504a4375eaf217e54e149342b4c932cbcc0249b7ed172faff5dcca2f`。真实报告见 `artifacts/_batch2-2.9-handoff-coverage/coverage-report.json`。

### 4.3 变异与相邻回归

| 变异（只改隔离副本） | 干净实现 | 变异体实测 |
|---|---|---|
| 规范化删除实质文字 | 两正文 normalized hash 不同 | 两正文 normalized hash 相同 ⇒ CAUGHT |
| sourceRef/物理根边界放行 | `source-ref-invalid`，verified false | 真读取隔离根外 `outside.md` 且 verified true ⇒ CAUGHT |
| 缺段结构保护放行 | `needs-review`，`missing-section:dead` | 其它证据相同时错误 `covered` ⇒ CAUGHT |

每个变异都在所需模块的隔离目录中，先断言目标锚点恰命中一次，再以独立 Node 进程比较干净/变异行为。没有就地修改共享生产文件。

相邻回归均 `--jobs=1 --timeout=120000`：

- `batch2-2.7-pointer`：PASS 1 / FAIL 0 / TIMEOUT 0。
- `batch2-2.6-attribution`：PASS 1 / FAIL 0 / TIMEOUT 0。
- `r4-coverage-audit`：PASS 1 / FAIL 0 / TIMEOUT 0。

## 5. 未触碰与剩余边界

受保护文件工作区 SHA-256 与开工记录一致：

- `lib/index.js` `ceb4c5fc42b596485aa0ca1e1df798d6024a1e4b8b9c0aefa1548196ae61cff4`
- `lib/event-write.js` `1b36d74268ab57b5cf21dfebee8c492c1a9e36999408c877271bcfaebd06946a`
- `lib/event-pointer.js` `49a762babbce8b8ea4674623a702523dccc781b84769473ad69746d72892ef12`
- `lib/legacy-handoff-compat.js` `7fea40d76f11fe421d59cae482b9598327ac80955ad422be9705135b298bb1f6`
- `lib/ledger-doc/coverage-audit.js` `181c412c3ced6c041f590e6d756bc7c2bc7c77dd28e9de336c2a7799294ac981`

未改共享生产入口、既有兼容/指针/ledger-doc、2.3/2.4/SidecarStore/生产配置；未访问真实记忆、真实事件库或 19387；未 apply/merge/archive/删除真实文件；未 commit/push。工作树存在其它并行线的未跟踪产物，本报告不宣称拥有或清理它们。

**尚未完成**：生产接线、真实存量审计、真实记忆读写/删除、全仓回归、真实 HOST/生产启用。Lead 应串行接线并显式传递真实事件对象、检查点选择器、trusted `handoffDir` 和两种 normalized hash；不得把本 API 的 `covered` 直接当成删除或归档许可。
