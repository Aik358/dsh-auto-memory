# Prompt：2.3 候选召回 + pairwise 精排与主动学习小样本实验

> 日期：2026-11-16
> 工作区：`D:/dsh-auto-memory`
> 执行者：复用同一 DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`
> 用户已授权尝试开源方案；目标是验证真实迁移，不是继续四态调参。

## 1. 基线与真实边界

先读：
- `docs/internal/RESEARCH-EVENT-ATTRIBUTION-OPEN-SOURCE-20261116.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-EXTERNAL-EXPANDED-20261116.md`
- `artifacts/_event-attribution-external-expanded-20261116/`

上轮：520真实标注、1024包、153冻结留出，训练0.3137 vs cov12 0.3203，四态训练不优于零参。
候选池openRatio0.5126已修，模型标签非人审；heldout同标注器只说明拟合模型标签，不等于真实归属准确率。

## 2. 本轮任务定义

1. 先按真实记录与候选事件构造 pair：`(record, candidate, match:true|false)`。
2. 用 C2/规则/cov12 召回少量候选，再做 pairwise 精排或 case-level“是否存在可 attach 目标”。
3. 不直接恢复四态 softmax；不再以多数类或 synthetic 分数当效果。
4. 保持 open/closed 混合与记录时刻状态；严格 LOO，不能把 gold 全文复制进候选。
5. 困难负样本：相似但不同 issue/PR、时间相邻、跨语言、closed、无正确目标、伞事件。

## 3. 可迁移开源方案的用法

- BLINK：借两阶段候选检索+精排，不直接搬 Wikipedia 模型。
- dedupe：借记录消歧/主动学习，优先标注分歧最大/最容易误 attach 的样本。
- sentence-transformers：参考 pairwise/困难负样本与排序损失；先小样本，不自动下载或训练大模型。

## 4. 实验与验收

1. 只读复用已采集真实 GitHub 数据与指纹；新增请求须记录来源/许可/状态/指纹，不泄露 token。
2. 真实记录、候选、状态、时间与来源必须一致；按仓库/任务/事件/重复族隔离。
3. 先零参数/未训练基线，再真实 pairwise 精排或 case-level 模型；保存参数、配置、日志与指纹。
4. 先冻结模型再评估 heldout；不能用 heldout 反复选型。
5. 分别报告候选 top-k/误 attach/误新建/closed/跨语言/伞事件与 case-level 指标。
6. 主动学习只选最有分歧/最困难样本，不重复同族凑数；保留失败与解析错误。
7. 若真实迁移没有超过 cov12 或数据不足，停止并如实报告，不宣称改进。

## 5. 交付与限制

仅写：
- `artifacts/_event-attribution-pairwise-20261116/`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-PAIRWISE-20261116.md`

交付真实数据/来源/许可、pairwise 构造、LOO/候选分布、训练与冻结留出、困难样本、可复算命令与未验边界。
不 commit/push、不装依赖、不改生产 lib/真实记忆/19387、不称RL。
