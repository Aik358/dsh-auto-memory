# 2.7 第二轮独立调查：真源、指纹、回读与幂等

> 来源：独立 Kimi subagent a4501cf1，2026-11-12；Lead 落盘。源码已复核；建议与未验分列。

## 源码证明

1. 旧路径 Phase 1 先 append writeH（index.js:25605-25631），文档到 Phase 2 才写（25632-25637）。handoff 的真实 path 在 writeHandoffLedger 内生成，正文还会加标题/锚点（5487-5520）；r.clean 不是最终全文。故 v3 在 Phase 1 算真实 sourceRef/rawsha 不成立。
2. planRevisionPre 是 canonical-plan SHA256（plan-store.js:43-54）；ledger computeRevision 是 normalizeText 后且清 revision 行（protocol.js:58-62,91-96）。normalizeText 会改 BOM/行尾/行尾空白，不能证明逐字节一致。
3. appendHandoffCheckpointPre 从 ledgerText 重解四段，ckPayload 不透传 panels/override（event-write.js:696-750）；idemKey 仅 kind+path+text（713-737）。旧 opId 台账只存时间，不比载荷（event-store.js:414-440,996-1008）；R4 另有 digest 校验，不应混用。
4. 任一四段非空即屏蔽 checkpoint.text；panels 总预算 150 字（event-render.js:331-365）。memory_recall expand(evt) 只给最近 5 条、各 300 字（index.js:14970-14975）；memory_read 无 handoff/document 枚举（25785-25788）。event-recall 仍拼全部 cp.text（45-61），只缩短存储不会排除 handoff 的 RAG。

## 最小生产建议

1. 建议单独裁定改为「先真源、后摘要」，但**仅限 2.7 新摘要路径且须先独立裁定顺序；2.6 旧全文路径不连带改序**。同一预解析 eventId 下，文档成功→重新读实际落盘 Buffer→算指纹/解析四段→生成摘要→append。文档成、checkpoint 败必须返回 documentCommitted+eventId+sourceRef+rawsha，并提供同一幂等键的 checkpoint-only 补记；不得重跑文档写或宣称回滚。坚持原顺序就须另设 prepared/committed 补记链，非最小改动。
2. rawsha256=sha256(实际 Buffer)，bytes=Buffer.length；normalizedSha256=sha256(normalizeText(解码文本))。回读以当前 normalizedSha vs 写入时 expected normalizedSha 判 drift；normalized 同而 raw 异是格式变化，不是内容 drift。不要写 normalizeText(回读)===normalizeText(真源)（同一对象自比）。plan revision、R4 revision 另字段，三者不混称。可复用现有 sha256/bytes/rel 承载 raw 指纹，避免新顶层字段。
3. sourceRef 只取真实 r.path 相对受信 handoff 根的 rel（plan 为 handoff/PLAN.md）；读取用 fileWithinRoots strict:true，拒绝对路径、..、根自身及 junction 逃逸。PLAN 会被后续合法覆盖，旧摘要只能明确 drift，不能冒充可取历史全文。
4. sectionsOverride 仅接受 goal/state/dead/next 四键；parse 结果的 doing→state、deadend→dead 仅映射一次，缺省仍走旧解析。不得覆盖 kind/sourceRef/panels/idemKey。缺段标记须由 expand/渲染确定可见，不能只塞 150 字 panels，也不能伪造四段原文。
5. 不新增工具：扩展 memory_recall(expand) 为 eventId+checkpointIndex（或 idemKey）选择器，输出该选择器，取到具体 cp 后 readPointerPre；普通旧 cp 没有 checkpointId，禁止伪造全局 ckpt token。A1 继续复用现有关联文档读取。按 handoff 不进 RAG 裁定，须同步过滤 event-recall.js 与 index.js 内联 textOfEventPre，plan 语义不擅自扩大。
6. idemKey 用完整 canonicalJSON 的 SHA256，覆盖 schema/eventId/kind/sourceRef/raw+normalized 指纹/四段/summary 算法版本与实际摘要/panels/四类感知/constraint 及变更区域；**不含时间戳/随机路径**，不能只哈希截短摘要。若启用 opId，同 opId 异 payload 必须 op-payload-mismatch。

## G-2 硬边界

G-2 未裁定前不得生产启用摘要、不得以占位 LIMIT 验收。必须先裁定确定性算法及版本、上限与长度单位、必留内容、超限截断或拒绝、失败/重试语义。此前只做**无副作用下钻与全文兼容实现**，不得切换 cp 正文。写入顺序、A1 重绑、缺段严格化均是独立裁定项，不得借 G-2 放行。

## 未验

仅静态只读；未执行新实现、真实工具下钻、故障/竞争、真实宿主或模型测试；未改文件或真实记忆。
