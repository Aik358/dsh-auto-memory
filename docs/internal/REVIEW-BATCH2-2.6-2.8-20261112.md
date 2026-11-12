# 2.6 / 2.7 / 2.8 v3 细则独立审查结论

> 来源：Kimi teammate r4-protocol 于 2026-11-12 直接聊天交付；Lead 整理落盘并复核关键源码锚点。
> 本次仅读源码，未改生产代码、未跑新功能验收。指纹：lib/index.js 2,162,687 B；lib/event-write.js 49,053 B；lib/event-store.js 76,795 B；lib/plan-store.js 14,819 B；lib/event-render.js 30,769 B。

## 总结

**方向可保留，但 v3 不能原样施工。** 主要问题是写入分支、回读、幂等、四段标记和 Phase 0 尚未闭合。

## 1. 阻断生产实施的缺陷与矛盾

### P0-1：显式归属没有贯通，A1 边界被写错

- v3 一处说不许给 appendHandoffCheckpointPre 新增可选字段，另一处又要求通过它新增 panels 与 sectionsOverride，见 event-write.js:696-750。
- memory_note 虽有 eventId，但旧 Phase 1、Phase 3、plan mirror 全部不传，见 lib/index.js:25515-25617、25648-25659、25691。
- R4-on 的 eventId 只用于首建；更新 eventIds 沿用文档既有绑定，见 lib/index.js:25562-25605。因此不能把 A1 显式归属写成已覆盖。
- v3 一处说 A1 已解决显式归属，另一处又要求 A1 凡 plan/handoff 都写 panels；但 A1 走 LedgerDocSystem/event-store-sink，不经过旧 appendHandoffCheckpointPre，见 lib/ledger-doc/event-store-sink.js:20-56、69-84。
- appendEventNotePre、event-write-api.js、readPointerPre 当前均不存在，不能把 v1 残留调用图当现状。

后果：2.6 不能靠一个统一门面完成；2.7 若不先界定旧路径/A1 写域，会漏改或改出第二套协议。

### P0-2：摘要与指纹的生成时序错误

- 旧 handoff 的真实路径和生成标题只有在 writeHandoffLedger() 返回后才能确定，见 lib/index.js:5493-5527。
- v3 却在 Phase 1 就要求写入真实 sourceRef、sha16 与 rawsha256。此时只有模型输入 writeH，没有最终落盘正文。
- planRevisionPre() 是 canonical-plan 文本 SHA-256，见 lib/plan-store.js:43-54；computeRevision() 是 LF 规范形 SHA-256，见 lib/ledger-doc/protocol.js:58-91；R4 revision 又排除文档头部的 revision 行，见 lib/ledger-doc/protocol.js:95-112。三者不可混称同一 revision。
- readPointerPre 按契约比较 normalizeText(...) 的 SHA-256，但 v3 又要求原文逐字节等于真源，而 normalize 会剥行尾空格，见 lib/ledger-doc/protocol.js:58-62。B27-03 与正文自相矛盾。

后果：指纹可能是输入哈希而非真源哈希；指针可能是假路径；回读校验可能只是比较两份内存字符串。

### P0-3：回读没有模型可达入口

- v3 只允许新增 readPointerPre 库函数，并禁止新增工具；memory_read 的枚举没有 handoff/document，见 lib/index.js:25785-25788。
- expandEventRecordPre() 只返回最近 5 条检查点、每条 text 截 300 字，见 lib/index.js:14970-14975。
- textOfEventPre() 仍只拼 checkpoint.text，见 lib/event-recall.js:45-61。
- panels 可在 event-render.js:357-365 显示，但事件列表并不保证携带 panels，见 lib/event-store.js:808-809。

后果：即使摘要成功落库，模型也可能无法取回全文。必须给出实际工具下钻入口，不能把库里存在 readPointerPre 当回读闭环。

### P0-4：Phase 0 依赖尚未产生的错误码

- 旧 Phase 2b/3 直到 writePlanSnapshot 或 writeHandoffLedger 返回后才知道 r.error/r.gate，见 lib/index.js:25632-25662。
- v3 却要求在 Phase 1 前比较 PREKNOWN_CODES(r.error) 与 PREKNOWN_GATES(r.gate)，此时没有 r。
- plan-store.js:247-249 只返回错误对象，没有 gate:'mutation' 字段；checkMutationPre 才返回 gate:'criteria'/'mutation'，见 lib/index.js:5964-6010。
- fromEvents、内部自动账本、水位紧急写入共享 memory_note 入口，不能无差别套用缺段允许。H1/H2 仍要求完整四段和每段有效内容，见 lib/wb-contract.js:540-573。

后果：照图施工会把已知门禁预检实现成凭字符串猜错误，或在自动接续中先写一条不完整事件记录。

### P1：四段、回读与幂等仍有契约缺口

- v3 的 eventId=<evt_xxx> 剥除规则要求行尾是 evt_xxx，但真实格式为 eventId=evt_23e2976e，解析前先剥 eventId 目前不会生效。
- event-render.js:331-333 是任一四段非空即优先使用四段，不是四段齐全才用。partial-empty 若只写 missing=next 到 panels，主渲染会掩盖它。
- eventStorePre.append() 只按 idemKey 查重，见 lib/event-store.js:1021-1035；opId 重放只存时间戳、不比较载荷，见 :400-427、:977-989。
- 将 idemKey 从全文哈希改成短摘要哈希会产生新碰撞域；未传 eventId 的两次相同内容也可能在不同事件分别落检查点。
- eventStorePre.list() 的无参路径返回 {events,touched}，不是裸数组；kind 也未在返回证据中定义。v3 的 readCheckpoints(eventId,kind) 缺少真实适配形状。
- fileWithinRoots 默认 strict:false 允许 target===root，见 lib/file-boundary.js:88-100。要求必须是 handoff 内文件时应使用 strict:true。

## 2. 逐项最小生产改动建议

### 2.6：先贯通显式归属，不搬 L1/词袋门

保留裁定：plan/handoff 不复制 memory_log 的 L1、强负证据和词袋门。

1. 在旧 memory_note 写入路径预解析 eventId：未传则保留现有 fallback，不能全局改成必须传；显式传入时，存在且 active/paused 才接受；closed/未知明确拒绝。
2. 同一次写入的 Phase 1、Phase 3、plan mirror 使用同一个已解析 walEventId，避免三条路径各自猜测。
3. 给 appendHandoffCheckpointPre 增加向后兼容的可选参数，返回真实 eventId；不改变既有未传参行为。
4. R4-on 分支保持 A1 原样，文档已有 eventIds 是其归属真源；显式 eventId 是否可重绑已有文档必须另行裁定，不能静默覆盖。
5. 如确需 appendEventNotePre，只做旧路径的薄协调函数，不复制事件锁或新建第二套 WAL。

入口：lib/index.js:25515-25617、25648-25691；lib/event-write.js:696-750。

回滚：删除显式参数透传，恢复旧 fallback；不改存量事件。

### 2.7：先取得真源，再写摘要；补齐下钻

1. 原始四段只从 parseLedgerSectionsPre(raw) 得出。
2. sectionsOverride 仅覆盖 goal/state/dead/next 四键，不能覆盖 kind、sourceRef、panels、idemKey 等字段。
3. panels 必须校验真实枚举 PANEL_KINDS=['state','log','deadend','next','userPercept','commitment']，见 lib/event-store.js:39；v3 的 goal 面板枚举错误。
4. 最小安全顺序：plan 先完成既有 CAS/M1/保护门并读取实际落盘正文；handoff 先由 writeHandoffLedger 返回真实路径和正文；再用真源计算 revision/rawsha、生成摘要，写检查点。即 prepare → document → checkpoint，不是原 Phase 1→2；若必须保留原顺序，必须引入两阶段元数据补记协议，不能修改 append-only 检查点。
5. 摘要算法、上限、去重键分开：完整意图包括 schema/kind/eventId/sourceRef/normalized sha/四段/变更区域，不能只取短摘要哈希。
6. 将受控指针下钻接入既有 memory_recall(expand=...) 或事件下钻；返回 revision、path、rawsha、四段和规范化校验结果。无合法 checkpointId 时不要伪造可全局寻址的 checkpoint token。

回滚：关闭摘要写入并恢复真源全文；已有摘要检查点不可修改或删除。

### 2.8：只在旧路径做同源 Phase 0 预检

1. Phase 0 直接调用现有纯函数/只读 CAS 判据，而不是比较未来的 r.error。
2. plan 预检覆盖 expectedRevision、M1/用户保护区、checkMutationPre 的 criteria/mutation 返回。
3. handoff 预检只覆盖已启用且可判定的 criteria；默认 criteriaGate=false 时不能强行启用。
4. fromEvents、水位紧急接续等自动路径要有独立模式：允许保留警告，但不得被 2.8 一刀切硬拒。
5. 未命中白名单的 IO/异常仍走 Phase 3；A1 不插入第二套 Phase 0。
6. 预检结果需与 Phase 2 同一输入，避免预检通过、正文被改、门禁绕过。

入口：lib/index.js:25632 之前、writePlanSnapshot 内现有 CAS/M1、checkMutationPre:5964-6010。

回滚：移除预检调用；保持 Phase 3 原实现。

## 3. 专项协议建议

| 项 | 建议 |
|---|---|
| G-1 | 未裁定前不实现容器配置。保留显式 eventId、旧 fallback 和 source 回执，不增加第二归属真源。 |
| G-2 | 未裁定前不启用摘要生产写入。先冻结确定性算法、长度单位、边界内容和降级策略，不能只留一个 LIMIT。 |
| 锁/并发 | 沿用 event-store.js:585-604 的 acquireSharedStateLock(storePath+'.lock')。append/create 已同临界区，禁止外层再持事件锁调用 append。跨进程另测文档归属，不要求读取事件再 append 成为一个原子事务。 |
| 幂等/恢复 | idemKey 必须覆盖完整检查点意图；同 opId 不同载荷应报 op-payload-mismatch。A1 的 opId+operationDigest 不能直接套到旧 handoff，因为旧路径目前没有该身份。 |
| sectionsOverride | 只覆盖四段；原始全文解析优先于摘要解析。缺段提示应在四段文本中明确可见，不能只写可能被裁剪的 panels。 |
| rawsha | rawsha 只说明原始字节/文本指纹；revision/normalized sha 只说明规范等价。两者都保留，不得拿 rawsha 证明 canonical 等价，也不得拿 normalize 后的相同宣称逐字节相同。 |
| R4/A1 | 保留既有 LedgerDocSystem WAL、CAS、sink 和零副作用拒绝序列。2.6–2.8 首轮仅改旧路径；若要统一 panels/revision，另列 A1 兼容验收，不在本批顺带改。 |
| 保护不变量 | append-only、plan CAS/M1、用户保护区、fromEvents 顺序、紧急接续降级、R4-off 行为不得借本批削弱。2.3/2.4 和真实归并不动。 |

## 4. 必须有区分力的测试与负路径

| 测试 | 必断言 |
|---|---|
| 显式归属 | active/paused 接受；closed/未知拒绝且事件 +0、文档不变；Phase 1、Phase 3、mirror 同属一个 eventId；A1 更新不暗改 eventIds。 |
| 无 eventId 兼容 | 旧调用形状下检查点字段与改前一致；未传 eventId 不变成强制拒绝。 |
| 四段 | 原始全文 goal/state/dead/next 与最终检查点逐值一致；含 eventId 时正确剥离；全空/部分空都符合裁定模式。 |
| partial-empty 可见性 | missing=next 等缺段在真实 render/expand 返回中可见；删除 panels 的变异必须让测试失败。 |
| 真源指纹 | 同语义 LF/CRLF 规范等价但 rawsha 不同；改行尾空格只影响 rawsha；改一个正文字符两个语义指纹均变。 |
| 指针边界 | 真源不存在、严格越界、junction 越界、root 自身均拒绝；读错误不得静默返回旧摘要。 |
| 真实回读 | 通过实际工具调用从摘要下钻到真源；不是只 import readPointerPre；取回内容与落盘正文按既定口径一致。 |
| 幂等 | 同内容重复写只 +1；短摘要相同但正文不同不吞写；同 opId 不同 payload 拒绝；分属不同事件的重放不被错误去重。 |
| Phase 0 | criteria(gate) 与 plan-version-conflict 均事件 +0；EPERM 等未知错误仍 Phase 3 +1；自动接续按既有降级契约写。 |
| 锁 | 两真实进程各 25 次写入，成功数与检查点数一致；嵌套调用不进入死锁；kill 后按现有死主锁协议恢复。 |
| A1 边界 | 非法 documentId、缺 revision、create-only 冲突仍走原返回；无新增旧 handoff 全文检查点，无双 Phase 0。 |

必须隔离变异验证：删除 sectionsOverride、四段从摘要解析、去掉 rawsha 校验、去掉 strict:true 路径边界、把 Phase 0 挪回 Phase 1 后、删掉 GATES 分支，均应让对应测试真实变红。

## 5. 必须裁定项与未验证边界

### 必须裁定，不能由实现者自定

1. G-1：是否新增工作区容器事件；未裁定不得实现。
2. G-2：摘要算法、上限及超限行为；未裁定不得启用摘要写入。
3. A1 更新重绑：显式 eventId 是否允许改变既有文档 eventIds，默认应拒绝或忽略并明确回执。
4. 缺段严格化：与 2.9 的边界，尤其是自动账本和紧急接续；当前 H1/H2 不能被 v3 的部分空允许静默改写。
5. 旧 handoff 顺序调整：是否接受先写真源、后写检查点这一明确语义变化；若不接受，需另定两阶段元数据协议。

### 本次未验证

- 未执行新实现、跨进程故障注入、真实工具回读、真实宿主或真实模型测试。
- 未跑全仓回归；本审查不构成 PASS。
- 未核实生产实时统计；126/200、61.81%、13 条、523/687 等均属历史快照，不作为当前生产数字。
- 未改 expectedRevision 重复定义问题；它是独立修复项，不应混入本批。
- 未操作 event-regroup-apply、2.3/2.4、真实迁移归并或任何真实记忆。

## Lead 执行建议

先将本审查中的 P0 项回写为 v4 细则，再按 2.6→2.7→2.8 串行施工；不要按 v3 的「一行回滚、统一门面、A1 不动即全覆盖」表述直接开工。

交付说明：r4-protocol 遵照用户指示直接聊天交付，未调用 write/edit，未创建或修改文件；本文件由 Lead 落盘。
