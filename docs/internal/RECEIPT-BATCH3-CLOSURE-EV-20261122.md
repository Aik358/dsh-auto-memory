# 批次 A · 件一 B3-EV 接线回执 · 2026-11-22

基线为 decdeccf。D30B-13 裁定后，事件卡、目录和 T1 摘要共用 useEventView。打开时由 event-view 提供，关闭时由原渲染路径提供。固定输入下已核对回滚输出，接线验证使用临时 DSH_HOME、事件库文件和完整 MemoryEngine。

## Phase 0 和改动位置

| 基线生产调用 | 消费面 | 接线 |
| --- | --- | --- |
| index.js:10435 pickT2EventsPre、10436 renderT2Pre | eventCardsText → 完整帧 memoryReferences/event-cards | buildEventInjectionSnapshotPre，消费四段投影，检查点聚合沿用旧段预算，保留状态与 ID 标签 |
| index.js:10500 renderEventCatalogPre | eventCatalogText → 完整帧 memoryReferences/event-catalog 与预览 | 目录沿用可见状态、近期关闭窗口、配置字数与 #evt_ 标签，排除已展开事件 |
| index.js:10453 renderT1Pre | slimEventT1 → 精简帧和读取总览 | 原 event-view 无等价接口。增加 renderEventOneLineSummaryPre，复用 firstSentencePre、原 T1 上限与新导出的 cutPre |
| index.js:10988 附近（实际读取是基线 11033）及 12551 | 精简帧第一条、读取总览最近三条 | 两个读取端消费同一份 refresh 结果。关闭时两端都收到原摘要 |

旧 renderer 的 ID 标签函数也作为命名导出复用，保留合法 ID 的原校验。保留已有 eventMaxActiveInInject 默认 2，A4 用同一个既有键设为 5。完整帧仍由现有 renderer 定稿，当前事件源没有白板、账本的显式任务标记。

| 文件 | 前 bytes / lines / sha16 | 后 bytes / lines / sha16 | 净增减 |
| --- | --- | --- | --- |
| lib/event-render.js | 30769 / 524 / 221d12c898d32b5d | 30886 / 525 / f9452bc10b99743c | 117 B / 1 行 |
| lib/index.js | 2214107 / 30419 / ece9f30ce9ef8950 | 2215391 / 30437 / ea9ccf442b66c764 | 1284 B / 18 行 |
| lib/injection/event-view.js | 23745 / 500 / 8ecd7a33ab66929b | 25103 / 527 / f9d7bc6ab534e612 | 1358 B / 27 行 |
| tests/smoke/smoke-test-r26-cross-layer.mjs | 144866 / 1089 / 1843ce39ac9adc9e | 144975 / 1090 / af42b04125042ed0 | 109 B / 1 行 |
| tests/smoke/smoke-test-batch3-closure-ev.mjs | 新增 | 15243 / 285 / e8448704656976da | 15243 B / 285 行 |

index.js 保留 CRLF，其余交付源码和测试为 LF。r26 首次 24/2，套件实际报告 1,653,539 / 1355F758DB6D182A，旧锁为 1,652,400 / 8DFC4449DF6F5F1A。按套件输出重钉，长度和摘要两条判据均保留。A9 首次 17/1，探针把共用开关的注释也算成摘要调用点。改为匹配具体 API 的三个落点，并注入 T1 专用探针验证两个消费端。

## 生产引擎夹具证据

| 判据 | 实测 |
| --- | --- |
| A1 | 完整帧出现「失败与弯路：EV-FAILURE-REASON」及检查点「卡在哪：EV-CHECKPOINT-DEAD-REASON」 |
| A2 | 事件 ID 保留，空 deadend 的标题和正文均缺席 |
| A3 | 1,400 字检查点首尾各 20 字均出现，保持 300 字单项上限。完整帧 3,043 字，夹具限额 8,000 字 |
| A4 | 10 个 active 里展开展示 5 张完整卡片并验正文，全部 10 个 ID 出现在帧内 |
| A5 | 去掉检查点尾部、去掉 deadend 映射、将展开上限变为 1，3 条 CAUGHT，原版均恢复 PASS |
| A6 | 隔离切换为 false，完整帧、精简帧和读取总览均匹配基线 SHA256（下表） |
| A7 | 9 个输入的 JS 字符串与 UTF-8 逐例相等，覆盖 T1-SUMMARY-10.、空 summary、纯空白、多行、超长、空 name、代理对及中英文断句 |
| A8 | 限长改 120 与删除 name 兜底，2 条 CAUGHT，原版恢复 PASS |
| A9 | 切换启用时 T1-NEW-ROUTE-PROBE 到达两个读取端。关闭时两端均恢复 T1-SUMMARY-10.，三个迁移锚点如下 |

| 输出 | JS 字符 / UTF-8 字节 | decdeccf 和回滚共同 SHA256 |
| --- | --- | --- |
| 完整帧 | 2,879 / 5,062 | 47f2ea95cca20a7f5ad469566d878737c69efd185029c3c38f142f4901f25077 |
| 精简帧 | 2,131 / 4,494 | ecc483b3f12f98294edbf251585ec7f98343a5440fac174222fd450a466c1090 |
| 读取总览 | 57 / 68 | 21116465b071b5079e113eacc8a8e1f2b51a3169b1ce9bafdab6bdc0446be791 |

三个 T1 落点的 rg 输出：

~~~text
10463:      const summarizeEvent = useEventView ? eventView.renderEventOneLineSummaryPre : renderT1Pre
11047:        // [DECISION D30B-13 | 2026-11-22 | user ruling] 读共享 renderEventOneLineSummaryPre 投影；回滚时 refresh 提供旧 T1。
12567:      // [DECISION D30B-13 | 2026-11-22 | user ruling] 与精简帧共用 renderEventOneLineSummaryPre 投影及同一回滚。
~~~

## 裁定留痕

~~~text
lib/event-render.js:80:// [DECISION D30B-13 | 2026-11-22 | user ruling] Share the exact legacy T1 truncation with event-view.
lib/index.js:10420:    // [DECISION D30B-13 | 2026-11-22 | user ruling] Switch cards, catalog and T1 together.
lib/index.js:10442:      // [DECISION D30B-10 | 2026-11-22 | user ruling] 不从更新时间推断当前任务。
lib/index.js:10462:      // [DECISION D30B-13 | 2026-11-22 | user ruling] T1 与卡片、目录同切换，两个读取端共用此结果。
lib/index.js:11047:        // [DECISION D30B-13 | 2026-11-22 | user ruling] 读共享 renderEventOneLineSummaryPre 投影；回滚时 refresh 提供旧 T1。
lib/index.js:12567:      // [DECISION D30B-13 | 2026-11-22 | user ruling] 与精简帧共用 renderEventOneLineSummaryPre 投影及同一回滚。
lib/injection/event-view.js:47:// [DECISION D30B-13 | 2026-11-22 | user ruling] Preserve the legacy T1 output byte for byte.
lib/injection/event-view.js:241:  // [DECISION D30B-10 | 2026-11-22 | user ruling] Recency cannot mark an event as the current task.
tests/smoke/smoke-test-batch3-closure-ev.mjs:230:  // [DECISION D30B-13 | 2026-11-22 | user ruling] T1 新旧接口逐例比较文本与 UTF-8，覆盖旧消费端与回滚。
tests/smoke/smoke-test-batch3-closure-ev.mjs:256:      const decision = '[DECISION D30B-13 | 2026-11-22 | user ruling]'
~~~

- D30B-10 落在 event-view 任务标签选择与 index 接线。没有白板、账本显式标记时，卡片只标最近更新。
- D30B-13 落在旧截断原语、新摘要 API、统一切换、两处摘要消费及差分试验。
- D30B-1、2、3、4 本件无落点。整帧定稿、预算、两段 must 和旧配置迁移不在 EV 接线范围。
- D30B-5 本件无落点。没有改两份 MEMORY 的读取。
- D30B-6、7、8、9 本件无落点。没有改白板分节或预算。
- D30B-11、12 本件无落点。没有改档位映射和诊断计费。

## 回归

| 检查 | PASS / FAIL |
| --- | --- |
| closure-ev | 20 / 0 |
| batch3-events | 86 / 0 |
| batch3-event-frame | 1 / 0 |
| v4-b1-event-catalog | 30 / 0 |
| v4-c2-slim-events | 39 / 0 |
| v4-event-attr-receipt | 68 / 0 |
| v4-event-render-plan | 56 / 0 |
| v5-p6-r5-catalog-visibility | 24 / 0 |
| batch3-unit-shadow | 14 / 0，另 6 个变异捕获 |
| r26 | 26 / 0 |

语法及真 import 通过。verify-docs 实测 22 工具 / 87 路由 / 182 配置键。client.js SHA16 仍为 4ded8a3c935801c2。CRLF 感知的 diff --check 通过。

真实宿主逐轮注入、a11y、跨设备验证本件未运行。
