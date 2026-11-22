# 批次 B · U3b 接线回执 · 2026-11-22

批次 A 基线 c6c32c21。deliveryPolicy.deliveryMode 是统一策略键。legacy 使用旧事件渲染，eventView 为缺省并沿用批次 A，units 采用单位选择和实际帧组装。

## C0、C0b、C1

三组参考摘要在第一处代码改动前采集，见 [施工前基线](./BASELINE-BATCH3-CLOSURE-U3B-20261122.md)。以下为最终工作树调用生产 MemoryEngine 的结果，逐例核验 JS 长度、UTF-8 字节数、SHA256。legacy 对齐 decdeccf，eventView 对齐 c6c32c21。省略模式及删除策略时同 eventView。

| 场景 | legacy | eventView | units |
| --- | --- | --- | --- |
| 空库 | 1e986f357071f597115c2b5bf8e7520404a7f1f858ac4f511e14598c7ada8c5e | 1e986f357071f597115c2b5bf8e7520404a7f1f858ac4f511e14598c7ada8c5e | 9b8b21b7d7678afe32673f149e96ed58afb89efa3fa38817d26f5a9b0875629b |
| 常规 | 5a7ba6eda7df8a21374871176cf743b74a1d3b22b51b47cc7add5072d6bd090f | e583dbaf2b7b80c959bbfe1c712d60bb260e6d878ceb51cb48ea7413d0dd83b8 | 0583a4b20b3d370ccbf3f92046c958b3a8c9a264e0abf118ffb38bf0ffb0b2dc |
| 满额 | 75583d005e623d1aa59f5f6f9af68ebad486dd47af9943acafcdaa759f5d749a | 30219e0b0f943b6e0206d22a0bf3391bc0334fae48c825e8a607d3173e34e50b | 73fc5fb11211c0fc67fafefecef8bf9dafb2aa5813ea8fb31718caa4aedf77ca |

C0b 的保存请求拒绝 bogus，磁盘字节不变。直接手写配置后，同步和异步加载都进入 eventView。debugInfo 返回 degradations 中的 invalid-delivery-mode。读取修复局限在内存。

## C2–C7

| 检查 | 生产引擎输出 |
| --- | --- |
| C2 | 配额为 3、1、5 时，帧内有 3、1、5 个不同的检查点正文 |
| C3 / C6 | 禁用事件内容在普通及超额场景都为 0。极小预算下两份锁段完整保留，回执报 budgetOvercommit |
| C4 | 同规则的全文帧 5,778 字节，指针帧 5,417 字节，指针包含 memory_rules op=list |
| C5 | 同家族只允许 2 个，真实帧保留 checkpoint 和 catalogEntry，事件正文成为被裁单位 |
| C7 | 精确 kind 家族匹配、绕过 disabled、绕过 eventView、指针替换成正文四种变异均 CAUGHT，恢复原版后 PASS |

六类结构化来源共用单位适配和选择。其余既有来源以所在模块片段作为 deliveryModule。生产入口在两种帧渲染时选择单位，预算计入静态纪律和当次附加提示。M6 独立核算。

## C8 隔离真实宿主

使用 u3b-e2e 独立 profile、DSH_HOME 和端口 19432。宿主向端口 19433 的本地 Anthropic Messages 协议夹具发出真实模型请求，逐轮检查新增的用户消息独立正文。

| 轮次 | 证据 | 检查点序号 |
| --- | --- | --- |
| units，配额 3 | provider-003.json | 1、2、3 |
| 真实设置页保存配额 1 | provider-004.json | 1 |
| 恢复 eventView | provider-005.json | 3、4、5，恢复 【事件】 卡片 |

根目录 artifacts/_u3b-host-20261122/evidence 内有 c8-evidence.json、ui-quota-1.png、host-rounds.png、host-redacted.log 和逐轮请求哈希。设置页可保存配额并保留已配置的 units。任务书 §1.4 禁改前端，现有页面没有模式选择器，模式启用和回滚使用既有配置 API。C8 宿主投递链和设置页配额实测通过，设置页直接切换模式这一子项无法在批准写域内完成。模型端为本地协议夹具。冷启动第一次请求早于异步事件刷新，事件从预热后的下一完整帧开始出现。

## 文件与守卫

| 文件 | EOL | 前 bytes / lines / sha16 | 后 bytes / lines / sha16 | 净增减 |
| --- | --- | --- | --- | --- |
| lib/index.js | CRLF | 2216718 / 30464 / 29a2aeaecf083c95 | 2221997 / 30535 / 1d5628cfb1fc5dd3 | 5279 B / 71 行 |
| lib/injection/policy-v2.js | LF | 28042 / 452 / e055339f894cbbee | 28445 / 457 / d0e4a0b93e0b5601 | 403 B / 5 行 |
| lib/injection/policy-runtime.js | LF | 2666 / 62 / 42ed3bd533b59206 | 3499 / 78 / 864f24aee92eb7da | 833 B / 16 行 |
| lib/injection/unit-shadow.js | LF | 12426 / 294 / 78b3bcb9acfa441c | 12461 / 294 / 123a7259629613f4 | 35 B / 0 行 |
| lib/injection/unit-delivery.js | LF | 新增 | 21693 / 439 / 615cf995de6ac1d8 | 21693 B / 439 行 |
| tests/smoke/smoke-test-batch3-closure-ev.mjs | LF | 15243 / 285 / e8448704656976da | 15085 / 283 / 935997f12a53cdaf | -158 B / -2 行 |
| tests/smoke/smoke-test-batch3-closure-u3b.mjs | LF | 新增 | 17839 / 329 / 0f28a46959658690 | 17839 B / 329 行 |
| tests/smoke/smoke-test-delivery-policy-runtime.mjs | LF | 38124 / 659 / 41cb4928979dbbf4 | 38149 / 659 / c6a776c94b2d49a0 | 25 B / 0 行 |
| tests/smoke/smoke-test-r26-cross-layer.mjs | LF | 145084 / 1091 / 1d56c01555b1e07b | 145189 / 1092 / 9f142e9357d441c8 | 105 B / 1 行 |

| 套件 | PASS / FAIL |
| --- | --- |
| batch3-closure-u3b | 10 / 0 |
| batch3-closure-ev | 20 / 0 |
| batch3-closure-co | 8 / 0 |
| batch3-contract | 99 / 0 |
| batch3-unit-adapters | 35 / 0 |
| batch3-unit-policy | 32 / 0 |
| batch3-unit-shadow | 14 / 0，另 6 处变异捕获 |
| delivery-policy-runtime | 11 / 0 |
| delivery-settings-backend | 13 / 0 |
| delivery-settings-ui | 25 / 0 |
| r26-cross-layer | 26 / 0 |

语法及真 import 通过。verify-docs 22 工具 / 87 路由 / 182 配置键。index 导出 41。两项 A1 测试初次因 transport 路由锚点变化报 expected one production anchor，更新锚点后维持原功能判据。r26 首次 24/2，按 actual 把 LF 长度和 SHA16 双锁更新为 1,659,893 / B7EA2D44AC5558E7。U3b 首次专项的 ENOENT 来自测试提前销毁临时目录，统一注册顺序后通过。规则指针夹具隔离了锁段中的相同文本再做负路径判断。

## 裁定定位

D30B-1 至 D30B-3 位于组装预算、M6 独立旁路和锁段保留。D30B-4 位于兼容预算读取，D30B-5 位于原尾部窗口。D30B-6 至 D30B-9 位于白板分节、顺序及空态。D30B-10 至 D30B-12 位于事件可见性、特殊档和诊断处理。D30B-13 延续批次 A 的 T1 三处标记。D30B-14 位于策略枚举、运行时加载、事件投影、组装入口及基线比对。

~~~text
lib/event-render.js:80:// [DECISION D30B-13 | 2026-11-22 | user ruling] Share the exact legacy T1 truncation with event-view.
lib/index.js:10422:    // [DECISION D30B-13 | 2026-11-22 | user ruling] Switch cards, catalog and T1 together.
lib/index.js:10423:    // [DECISION D30B-14 | 2026-11-22 | user ruling] All three event projections follow the saved delivery mode.
lib/index.js:10447:      // [DECISION D30B-10 | 2026-11-22 | user ruling] 不从更新时间推断当前任务。
lib/index.js:10467:      // [DECISION D30B-13 | 2026-11-22 | user ruling] T1 与卡片、目录同切换，两个读取端共用此结果。
lib/index.js:11060:        // [DECISION D30B-13 | 2026-11-22 | user ruling] 读共享 renderEventOneLineSummaryPre 投影；回滚时 refresh 提供旧 T1。
lib/index.js:12589:      // [DECISION D30B-13 | 2026-11-22 | user ruling] 与精简帧共用 renderEventOneLineSummaryPre 投影及同一回滚。
lib/index.js:12656:      // [DECISION D30B-4 | 2026-11-22 | user ruling] Existing character setting is an in-memory fallback, without migration.
lib/index.js:12658:      // [DECISION D30B-2 | 2026-11-22 | user ruling] Budget includes the independently registered static discipline.
lib/index.js:13730:    // [DECISION D30B-5 | 2026-11-22 | user ruling] Units keeps the existing MEMORY tail window.
lib/index.js:13909:    // [DECISION D30B-14 | 2026-11-22 | user ruling] Only units replaces the character assembly.
lib/index.js:25396:  // [DECISION D30B-2 | 2026-11-22 | user ruling] M6 保留独立的 4096 字节预算，不进入 units 整帧账本。
lib/injection/consolidation-production.js:172:  // [DECISION D30B-5 | 2026-11-22 | user ruling] 两份既有记忆都只取原有 1200 字尾部窗口。
lib/injection/event-view.js:47:// [DECISION D30B-13 | 2026-11-22 | user ruling] Preserve the legacy T1 output byte for byte.
lib/injection/event-view.js:241:  // [DECISION D30B-10 | 2026-11-22 | user ruling] Recency cannot mark an event as the current task.
lib/injection/policy-runtime.js:6:// [DECISION D30B-14 | 2026-11-22 | user ruling] Repair a manually edited invalid mode in memory only.
lib/injection/policy-v2.js:70:// [DECISION D30B-14 | 2026-11-22 | user ruling] One saved delivery mode, defaulting to the Batch A event view.
lib/injection/unit-delivery.js:106:  // [DECISION D30B-10 | 2026-11-22 | user ruling] Event recency controls visibility only.
lib/injection/unit-delivery.js:153:  // [DECISION D30B-11 | 2026-11-22 | user ruling] Handoff/compensation preserve host planSpec tier semantics.
lib/injection/unit-delivery.js:156:  // [DECISION D30B-7 | 2026-11-22 | user ruling] Include the explicit goal/progress/dead-end sections in core.
lib/injection/unit-delivery.js:159:  // [DECISION D30B-6 | 2026-11-22 | user ruling] Keep the plan source order and existing core section names.
lib/injection/unit-delivery.js:160:  // [DECISION D30B-8 | 2026-11-22 | user ruling] Keep the existing per-section and plan total caps.
lib/injection/unit-delivery.js:179:  // [DECISION D30B-9 | 2026-11-22 | user ruling] An unmatched plan produces a receipt entry and no original body.
lib/injection/unit-delivery.js:204:  // [DECISION D30B-11 | 2026-11-22 | user ruling] Preserve the host's full ledger for handoff and compensation.
lib/injection/unit-delivery.js:407:  // [DECISION D30B-1 | 2026-11-22 | user ruling] There is one frame limit across full and compact tiers.
lib/injection/unit-delivery.js:409:  // [DECISION D30B-2 | 2026-11-22 | user ruling] Charge static discipline and its separator here. M6 has its own budget.
lib/injection/unit-delivery.js:425:  // [DECISION D30B-3 | 2026-11-22 | user ruling] Locked MEMORY windows survive budget overcommit.
lib/injection/unit-delivery.js:431:  // [DECISION D30B-12 | 2026-11-22 | user ruling] Diagnostics stay optional and use the provider's bounded output.
tests/smoke/smoke-test-batch3-closure-ev.mjs:229:  // [DECISION D30B-13 | 2026-11-22 | user ruling] T1 新旧接口逐例比较文本与 UTF-8，覆盖旧消费端与回滚。
tests/smoke/smoke-test-batch3-closure-ev.mjs:255:      const decision = '[DECISION D30B-13 | 2026-11-22 | user ruling]'
tests/smoke/smoke-test-batch3-closure-u3b.mjs:43:// [DECISION D30B-14 | 2026-11-22 | user ruling] These digest inputs and outputs were frozen before the first batch-B code edit.
~~~

全库回归、外部真实模型响应和跨设备未验证。真实设置页出现并保存配额，跨面 a11y 未验证。
