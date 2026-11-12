# 事件归属判定器实验与训练门报告（2.3）

> 执行依据：docs/internal/PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md
> 实验目录：artifacts/_event-attribution-benchmark-20261112/
> 状态：**已完成隔离探针与独立审计；E/F 未运行，不交付训练模型，不接入生产。**

## 1. 结论

1. **C2 可保留为召回与冻结向量底座，但不能独立决定归属。**
2. 显式标识与确定性规则可覆盖有限场景；语义相似度、margin、当前融合和通用模型裁决都不足以自动 attach。
3. 真实高可信来源验证金标 **0**；940 条历史检查点不自动成为训练金标。
4. D 臂小样本显示明显 create-new 偏置；不能声称通用模型优于融合。
5. 本批 **没有训练 E 臂、没有 F 臂微调**，因为没有通过真实金标、候选、四态、协议和防泄漏门。
6. 只产出候选/复核提案；零真实 attach/merge/archive，生产配置和 lib 生产入口未改。

## 2. 冻结与隔离

| 项 | 实测值 |
|---|---|
| 开工 Git HEAD | 496c5dc3f22a8f088d6e9f5929eb8c1183569bd2 |
| 冻结事件 | 53 |
| 冻结检查点 | 940 |
| 冻结事件库字节 | 3,755,866 |
| 冻结 SHA-256 | 550751ddc6c0e9c2a2449148f5a2ec8cda4d77c9809c9463746a5673368f0df7 |
| 来源文件 | 1,989（含 1,988 Markdown） |
| 冻结位置 | data/frozen/event-store.json |
| 独立隔离根 | isolated/memoryRoot 与 isolated/userMemoryDir |

冻结入口通过真实 datadir/event-store 解析器定位。隔离根均为独立绝对路径。
冻结后真实事件库被其他并行工作更新；本批不将其回滚或覆盖。当前库不是本批输入。

## 3. 数据与证据边界

### 真实记录与视图

- 冻结事件 53：active 47、closed 6、paused 0；不伪造 paused 补齐分布。
- 940 个源检查点中，非空来源记录构造六类视图，v13 为 996 个视图 / 893 个唯一源对象。
- 视图包括：历史弱标签、显式 ID、来源路径复核、起源时间回放、冲突复核、closed 协议拒绝。
- **同一源对象跨视图不是独立样本；不得把视图数当成真实样本数。**
- 历史弱标签只回答历史覆盖/候选问题，不作为正确率金标。
- 来源路径关联、普通代码路径、提及 eventId、当前仓库 corroboration 均不自动升级为 source-linked 金标。

### 独立来源审计

940 条互斥分类：路径弱证据 66、冻结集未提供来源 160、无可用证据 714。
可采纳 source-linked 验证金标 0。详见 review/source-audit.md。
56 份含显式 eventId 的账本仍只列弱关联，未自动升金标。

### 切分和防泄漏

v13 独立审计：
- PASS：主 weak/direct 805 条 eventId 分组；对象级 LOO；未来事件、未来 updatedAt、普通未来证据、checkpointCount；24 个起源回放；清单一致性；case schema。
- FAIL：3 个重复族跨 dev/test（27 个 finding 行，不等于 27 个 family）；94 个 attach 缺强证据且未 needsReview；空正文/非法结构/越界 ID 数据切片 0。
- 102 个源对象跨 evaluation view，已单列；不是主 split 泄漏。
- 输入拒绝有独立函数级补验；不能用数据切片为 0 推断拒绝未实现。

检查器正反向探针 7 CAUGHT / 0 MISSED，报告在 review/split-review-v13.json。
该版本不是可直接用于生产训练的有效基准。

## 4. 实际模型与 A–D

### C2

实际执行 lib/semantic-js.js，不使用 mock 推理：
- multilingual-e5-small/q8；384 维；
- 最终特征文件 1,775 个去重输入，31,478,598 B；
- 冷启动 1,284.3412 ms，后接批量推理；无静默回退。

### A/B/C

- A：真实调用生产 pickActiveEventByTopicPre，覆盖 L1 标识与现有词袋兜底。
- B：C2 同 case 余弦召回，top-k/margin 单独报告，不把 margin 当四态判据。
- C：候选融合使用标识、来源指针、时间、状态、C2 特征；先排序再补强证据候选。
- 所有输出是 proposal-only DTO；未知 ID、closed 目标、非 attach 携带 ID、缺模型身份均拒绝。
- A/B/C 的 v3 是审计中的对照结果，不是已验证生产准确率；错误样本按真实行保存于 errors/abc-error-cases.json（799 行）。

### D 真实通用模型

调用身份：dshapi-kimi/kimi-k3.1-pro；实际隔离子代理 ID=6f1f23ad-2cb1-4efb-9f3e-7989d1c0ac56。
原始输出位于 cases/results/llm/，每个 case 含 raw/parsed/parseError；prompt 不注入 gold。

- 尝试 24；19 可按当前基准复核；5 个过时来源回放输入排除。
- 19 个 DTO 全部通过；只代表结构合规，不代表判断正确。
- 输出分布：attach-existing 4、create-new 15、ambiguous 0、not-applicable 0。
- 冲突组 0/6；closed 组 0/5；两组都偏新建。
- 弱标签组 3/6；起源回放 2/2（小样本且不是稳定分布）。
- 该调用未执行真实记忆写入、归并或归档。
- 这是一轮真实探针，不是泛化能力或稳定行为证明。

## 5. 协议负路径与降级

- 未知 eventId 拒绝；
- closed 候选拒绝；
- 多候选/多 ID 保留 ambiguous，不取 margin 自动挂；
- 非 attach 携带 ID 拒绝；
- 缺模型身份拒绝；
- proposal-only 必须保留；
- 输入空正文、缺 source/gold 拒绝；
- C2 不可用时 degraded.used=true，融合输出仍不能升级自动归属。

真执行 07-input-negative.mjs 为 6 PASS / 0 FAIL；旧失败版本保留。
这证明隔离校验函数行为，不证明生产已接入这些校验。

## 6. 训练门决定

| 门 | 本批结论 |
|---|---|
| 可复核金标 | **未通过** |
| 正确候选召回 | 仍需在闭合基准上重测 |
| 四态/负路径 | 协议函数已验；真实样本覆盖仍不足 |
| 防泄漏/清单 | 部分通过；重复族与标签边界 FAIL |
| C2 独立归属 | 不支持 |
| D 相对增益 | 不支持 |
| E 冻结向量小分类器 | **不运行** |
| F LoRA/CNN | **不运行，未评估** |

E 只有在真实复核金标、统一候选与四态覆盖、同 case 候选+模型比较和防泄漏门通过后才可训练。
本批不把历史 eventId 或弱标签装进分类器以制造“训练完成”。

## 7. 最小后续步骤

1. 只读取得或人工复核带独立事件 ID、准确来源 quoteLine/full sha 的样本；先双人复核四态。
2. 将真实文档 members/documentId/eventIds 关联写入隔离数据集，补足可验证来源样本。
3. 按文本族与 eventId 同时固定 split，去除跨 split 重复；每视图报告唯一源与复用。
4. 把输入拒绝函数接入同一 case schema/校验入口，保留独立协议负例集。
5. 重新跑同一 A/B/C/D 与分组留出；以难度切片和误挂/误新建为准，不只看总分。
6. 仅当 E 在分组留出上稳定超过 C/D 才训练；否则保持候选/提案与人工复核。

## 8. 复现入口

- `scripts/00-freeze.mjs`：真实根、指纹和隔离来源（真实数据只读）。
- `scripts/03-build-benchmark.mjs`：case、来源视图、对象 LOO、时间截断、同源清单。
- `scripts/04-embed-c2.mjs`：真实 C2 推理，不使用 mock。
- `scripts/05-run-abc.mjs`：A/B/C、候选与 proposal-only DTO。
- `scripts/06-protocol-test.mjs`：协议正反向。
- `scripts/07-input-negative.mjs`：输入和状态拒绝。
- `review/split-check.mjs`：独立检查器；支持 `SPLIT_REVIEW_OUT` 指定新报告路径。
- `results/training-gate.json`：训练停止门的机器可读结论。
- `results/llm-eval.json`：D 探针逐条证据。
- `results/delivery-validation-v1.json`：交付完整性 44 PASS / 0 FAIL；不证明基准或模型通过。

所有数据、代码、结果、错误与日志都保留在本实验目录；不发布、不提交本批文件。
