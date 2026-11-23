# 2.3 训练效果不佳后的开源方案与下一轮建议

> 日期：2026-11-16
> 性质：基于真实训练结果与公开文档的方案报告；不修改生产、不训练、不安装依赖。

## 1. 已有证据决定的方向

- 本地 19 个真实事件、单类 split，监督训练失败；
- 外部 520 标注 + 153 冻结留出，训练四态 0.3137 vs cov12 0.3203；
- 外部标签为 model-reviewed，非人工金标；同标注器评估只说明拟合模型标签，不等于真实归属准确率；
- 跨域真实 comment→issue：cov12 严格 LOO 0.288 vs 随机0.016，说明候选排序有弱信号，但四态分类没有证明有效。

⇒ **不能继续用更多同类样本或调参来掩盖任务定义问题。**

## 2. 可迁移的开源方案

### A. BLINK：候选检索 + 精排

- 仓库：[facebookresearch/BLINK](https://github.com/facebookresearch/BLINK)，MIT。
- 官方 README 明确：bi-encoder 先召回候选，cross-encoder 将 mention/context 与 entity text 联合输入后精排。
- 对本项目的启发：先用 C2/覆盖率召回少量候选，再让语义模型比较“记录 + 候选证据”，而不是把四态当单一 softmax。
- 不直接搬 Wikipedia 实体或旧 BERT 模型；只借两阶段任务分解与评估思想。

### B. dedupe：记录消歧 + 主动学习

- 仓库：[dedupeio/dedupe](https://github.com/dedupeio/dedupe)，MIT；文档明确面向 record linkage / entity resolution。
- 适合“该记录与哪个事件相关”，不是只按 issue 四态分类。
- 主动学习优先标注最有分歧/最有信息量的记录，比无差别扩大到 500+ 更有价值。
- 需要真实 pair 标签；当前外部模型标签只能作弱标签，不能冒充人审。

### C. sentence-transformers：pairwise / 困难负样本 / 排序损失

- 官方 [CrossEncoder losses](https://raw.githubusercontent.com/UKPLab/sentence-transformers/master/docs/package_reference/cross_encoder/losses.md) 提供 CrossEntropy、BinaryCrossEntropy、RankNet、ListNet、MultipleNegativesRanking 等。
- 对本项目的启发：训练“记录-候选是否匹配”的 pairwise 分数，困难负样本用于区分相似但错误事件。
- 先小样本验证；不自动下载/训练大模型，不默认 E5/LoRA/RL。

## 3. 下一轮建议

1. **先改任务定义**：优先 case-level“是否存在可 attach 目标”或候选 pairwise 匹配，不再把四态多分类当唯一目标。
2. **保留两阶段**：C2/规则/cov12 召回候选，语义模型精排；候选池仍须 open/closed 混合与严格 LOO。
3. **主动学习**：先标模型分歧、近邻相似、closed/新建边界的样本，不把同一事件模板重复计权。
4. **独立真实评估**：外部留出须保持独立；模型标注只能是 model-reviewed，不能冒充真实归属金标。
5. **停止无效线**：继续四态监督调参或扩大同类标注目前没有证据支持。

## 4. 本机可行性与边界

- 当前已有冻结 C2、真实/合成数据与可复算 numpy 训练脚本，可先复用。
- 真实训练框架依赖未验证；不自动安装 pyarrow/fastparquet 或新训练库。
- 本报告只是方案与文档证据，未接入生产、未启动新训练。
