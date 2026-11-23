# Prompt：2.3 归属分类：时间、生命周期与来源证据验证

> 日期：2026-11-16
> 工作区：`D:/dsh-auto-memory`
> 执行者：复用同一 DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`
> 用户授权将归属判定交给 DeepSeek teammates，检验是否能准确归类事件。

## 1. 目标

不只比较 cov12 分数，而是验证模型能否根据**时间、生命周期、来源与身份关系**判断记录属于哪个事件。

先读：
- `docs/internal/ANALYSIS-EVENT-ATTRIBUTION-SIGNALS-20261116.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-PAIRWISE-20261116.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-RECALL-MULTI-20261116.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-EXTERNAL-EXPANDED-20261116.md`

## 2. 任务与标签边界

1. 每条记录独立输入：正文、当时可见候选、来源/时间/状态/生命周期与关系链。
2. 输出候选归属或 `create-new / ambiguous / not-applicable`，附证据与反假设。
3. 时间只是约束与弱证据，不能简单“越近越好”。
4. 严格 LOO；候选不能含当前记录全文；历史状态按记录时刻，不用当前状态覆盖。
5. 模型标签为 `model-reviewed`，不是 human-reviewed；一致性/置信度不等于正确。

## 3. 必须覆盖的困难场景

- 并行工作但同时间；
- 跨日/中断恢复；
- 同文异事与真实来源相同；
- 同一事件不同阶段；
- closed/新建边界；
- 伞事件 vs 专属修复；
- 无正确候选、多个合理候选；
- 跨语言。

如果真实 GitHub 数据缺少跨语言/伞事件，使用真实冻结库或明确标注 synthetic-authored，不冒充真实覆盖。

## 4. 验证与指标

1. 保留真实 GitHub 数据与指纹；按仓库/任务/事件/重复族隔离。
2. 独立上下文模型判断，保存原始输出、解析错误、输入/输出指纹。
3. 比较 cov12、pairwise、时间/生命周期/来源特征与模型判断；分别报告误 attach/误新建/closed/ambiguous。
4. 真实留出必须隔离，不能用于反复选型；必要时独立仲裁。
5. 记录失败、超时、缺失字段和无法判断，不删除坏例。

## 5. 停止与交付

若真实迁移不改善、证据不足或样本不足，停止并如实报告；不把新方案名当效果。

仅写：
- `artifacts/_event-attribution-classification-20261116/`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-CLASSIFICATION-20261116.md`

交付判定记录、证据分层、困难负样本、split/LOO、真实留出、指标与未验边界。
不 commit/push、不装依赖、不改生产 lib/真实记忆/19387、不称RL。
