# 批次 A · 件二 B3-CO 接线回执 · 2026-11-22

接线基线为已完成 B3-EV 的 4e69a3b1。旧提炼提示词对照为 decdeccf。手动 memory_consolidate 和定时固化均通过 consolidateMemory。仅更换提炼来源和新路径的结果解析，落盘仍经过既有过滤、容量检查、项目笔记和用户候选确认区。

## Phase 0 与接线

- decdeccf 的手工入口在 index.js:26913 附近，将 days 限在 1 到 30。定时入口在 index.js:17029，调用同一方法。旧方法在 index.js:19560，读取项目根最多 60 个日文件，按日倒序跳过空文件后收满 days 篇，每篇取尾部 2,500 字。
- consolidate 模块的 collectConsolidationSourcesPre 接受五类文件引用和同步读取函数。直接传 days 会按 UTC 日期门槛过滤日志。生产现在先按原有非空文件篇数选出日志，再把已读取的快照交给五源收集器，避免稀疏日志被错误排除。
- consolidation-production 读取日志、事件库、白板、账本和反思，区分空与读失败。事件用摘要、四段和结论，检测到空事件库时给空态。白板沿用项目 PLAN，账本优先使用已启用的维护文档，其余使用兼容读口选出的最新账本。反思沿用最近 30 篇的读取窗。对项目范围做物理路径验证。
- 新 prompt 沿用严格的 [PROJECT]/[USER] 输出格式，两份已有记忆各保留尾部 1,200 字。独立一行 (无) 或未知状态不触发任何记忆写入，正文中内联 (无) 不拦截有效条目。[USER] 仍进待确认区。
- useConsolidationSources 为内部回滚开关。false 时既有日志 prompt 与结果解析一起恢复。

| 文件 | EOL | 前 bytes / lines / sha16 | 后 bytes / lines / sha16 | 净增减 |
| --- | --- | --- | --- | --- |
| lib/index.js | CRLF | 2215391 / 30437 / ea9ccf442b66c764 | 2216718 / 30464 / 29a2aeaecf083c95 | 1327 B / 27 行 |
| lib/injection/consolidation-production.js | LF | 新增 | 9798 / 223 / 97bed5945cf08a6a | 9798 B / 223 行 |
| tests/smoke/smoke-test-560-subagent-timeout.mjs | LF | 11169 / 198 / aeaa51ba8df88f1e | 11411 / 200 / cc1f30989b392159 | 242 B / 2 行 |
| tests/smoke/smoke-test-r26-cross-layer.mjs | LF | 144975 / 1090 / af42b04125042ed0 | 145084 / 1091 / 1d56c01555b1e07b | 109 B / 1 行 |
| tests/smoke/smoke-test-batch3-closure-co.mjs | LF | 新增 | 9410 / 183 / 5c5da459698eb406 | 9410 B / 183 行 |

## B1–B5 生产引擎复算

| 判据 | 实测 |
| --- | --- |
| B1 | 真正传入 runSubagent 的 prompt 含 CASE-EVENT-DECISION、CASE-WHITEBOARD、CASE-LEDGER、CASE-REFLECTION，以及两篇非空日志。稀疏日志跨过一个空文件后仍保留，第三篇被排除 |
| B2 | 同一夹具 436 → 517 JS 字符，UTF-8 946 → 1,003 字节 |
| B3 | 五类来源均空，返回「五类来源没有可提炼的内容」；若事件库 JSON 损坏则返回「读取来源失败（events），没有可提炼的内容」。两种都零模型派发、零写入 |
| B4 | 隔离删除 events 读取，报缺失 CASE-EVENT-DECISION。隔离把篇数停止条件 >= 改为 >，报第三篇越过 days。两条 CAUGHT，原实现复验通过 |
| B5 | false 与 decdeccf 提示词的 UTF-8 Buffer 完全相等。SHA256 为 355896bc4137e7d26e42ec3c94a4a16154da1429a0c5349b060ca95facc59279 |
| 结果边界 | 独立 (无) 与未知状态零写入；包含内联 (无) 的有效条目只写项目笔记与 PENDING-USER-MEMORY.md |

## 裁定留痕

~~~text
lib/event-render.js:80:// [DECISION D30B-13 | 2026-11-22 | user ruling] Share the exact legacy T1 truncation with event-view.
lib/index.js:10421:    // [DECISION D30B-13 | 2026-11-22 | user ruling] Switch cards, catalog and T1 together.
lib/index.js:10443:      // [DECISION D30B-10 | 2026-11-22 | user ruling] 不从更新时间推断当前任务。
lib/index.js:10463:      // [DECISION D30B-13 | 2026-11-22 | user ruling] T1 与卡片、目录同切换，两个读取端共用此结果。
lib/index.js:11048:        // [DECISION D30B-13 | 2026-11-22 | user ruling] 读共享 renderEventOneLineSummaryPre 投影；回滚时 refresh 提供旧 T1。
lib/index.js:12568:      // [DECISION D30B-13 | 2026-11-22 | user ruling] 与精简帧共用 renderEventOneLineSummaryPre 投影及同一回滚。
lib/injection/consolidation-production.js:172:  // [DECISION D30B-5 | 2026-11-22 | user ruling] 两份既有记忆都只取原有 1200 字尾部窗口。
lib/injection/event-view.js:47:// [DECISION D30B-13 | 2026-11-22 | user ruling] Preserve the legacy T1 output byte for byte.
lib/injection/event-view.js:241:  // [DECISION D30B-10 | 2026-11-22 | user ruling] Recency cannot mark an event as the current task.
tests/smoke/smoke-test-batch3-closure-ev.mjs:230:  // [DECISION D30B-13 | 2026-11-22 | user ruling] T1 新旧接口逐例比较文本与 UTF-8，覆盖旧消费端与回滚。
tests/smoke/smoke-test-batch3-closure-ev.mjs:256:      const decision = '[DECISION D30B-13 | 2026-11-22 | user ruling]'
~~~

- D30B-5 本件落在已有记忆参考读取处，两份 MEMORY 仅取尾部窗口。
- D30B-1、2、3、4 本件无落点。未改变最终投递预算、锁段、M6 或旧配置迁移。
- D30B-6、7、8、9 本件无落点。只读白板材料用于提炼，没有改投递的白板分节规则。
- D30B-10、11、12、13 本件无新增落点。无当前任务推断、档位、诊断预算或 T1 的修改。上面 D30B-10 与 D30B-13 来自 EV 提交。

## 回归

| 检查 | PASS / FAIL |
| --- | --- |
| closure-co | 8 / 0（8 条输出，含两条隔离变异捕获及还原） |
| closure-ev | 20 / 0 |
| batch3-consolidate | 66 / 0 |
| batch3-consolidation-boundaries | 1 / 0 |
| 560-subagent-timeout | 49 / 0 |
| subagent-timeout-560 | 36 / 0 |
| audit-g-consolidate-filter | 27 / 0 |
| le-261-schedule-failure | 57 / 0 |
| r26 | 26 / 0 |

- 560 的旧抽取探针最初 40/9，E0b 报「能定位 !text 报错段」失败。原因是错误文案块后面不再紧跟旧解析器的 includes。探针改为取该文案块的真实结束边界，同时拒绝 undefined 造成的假绿。生产两条错误文案保留，真引擎测试另有变异证据。
- r26 初次 24/2，套件报告实际 1,654,767 / 0961A35399610918，EV 登记为 1,653,539 / 1355F758DB6D182A。按实际重钉并复跑。语法和真 import 通过。verify-docs 实测 22 工具 / 87 路由 / 182 配置键，index 真 import 仍有 41 个导出。CRLF 感知的 diff --check 通过。

真实 DSH 宿主、真实模型输出、a11y、跨设备和全量回归本批未运行。生产引擎使用隔离文件输入与可控的模型响应，未写实际记忆。U3b 属于后续批次。
