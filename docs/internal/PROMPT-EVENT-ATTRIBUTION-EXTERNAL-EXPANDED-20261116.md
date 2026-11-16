# Prompt：2.3 外部候选池重采、500+ 标注与冻结留出评估

> 日期：2026-11-16
> 工作区：`D:/dsh-auto-memory`
> 执行者：复用同一 DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`
> 用户授权：可自行决定是否扩大标注到 500+。Lead决定：先修候选池，再按真实独立事件扩展，不凑数。

## 1. 上轮真实结果与瓶颈

先读 `docs/internal/RESULT-EVENT-ATTRIBUTION-EXTERNAL-TRAIN-20261116.md`：
- trained dev 0.372 vs majority 0.314 / cov12 0.235，首次超零参；
- 候选池 3,157 个候选 100% closed issue，导致 not-applicable 偏易；
- 129 标签、0 解析失败，191 包 → train81/dev59/heldout51；
- heldout 51 未评估，模型标签非人工金标，dev 差距约3例不稳健。

**优先级：重采候选池 > 扩大标注 > 再训练。** 不直接继续调参。

## 2. 候选池重采（必须先做）

1. 采集 GitHub issue 时去掉 `is:closed` 限制，真实保留 open 与 closed，记录采集时状态与记录时刻状态。
2. 复用已有原始数据与指纹；新增请求必须保存 URL/status/bytes/sha256/剩余配额，不泄露 token。
3. 每个 case 候选池必须混合 open/closed，记录 openRatio；报告 candidate 状态分布，禁止再次 100% closed。
4. 评论/创建记录的时刻决定当时能否 attach；不用当前 open/closed 覆盖历史状态。
5. 严格 LOO，不能将记录自身复制进 gold 候选；保留同仓库不同 issue/PR、时间相邻、相似术语、跨语言与无正确目标。

## 3. 500+ 扩展规则

- 目标为 **500+ 个真实、独立、可标注记录包**，不是重复模板或同族样本。
- 若原两仓库不足，可扩展到其他公开仓库或时间范围；保存许可、revision、原始响应指纹。
- 新 heldout 记录不得参与训练/调参/选型，保留独立标注后再评估。
- 若真实不足，不伪造 500+，报告实际数与原因。
- 分批标注并支持断点续跑；失败/超时如实记录，不静默重试到满意答案。

## 4. 独立标注与模型冻结

1. 标注者使用独立新上下文，不能看 gold/split/训练结果/另一角色答案。
2. 四态：attach-existing/create-new/ambiguous/not-applicable；输出证据、反假设、unknowns。
3. 保存 provider/model、labelOrigin=model-reviewed、sourceKind=public-derived、原始输出与指纹。
4. 人工金标仍 0；模型一致不自动正确，closed/open 状态事实与模型判断分开。
5. 训练配置/参数确定后**先冻结模型**，再给 heldout 独立标注并评估；不得用 heldout 反复选型。

## 5. 训练与验收

- 冻结 C2 + 可复算轻量分类/排序器；比较零参数 cov12、多数类、训练模型、严格变异。
- 分组报告 attach/create/ambiguous/not-applicable、误 attach/误新建、closed/open、跨语言、伞事件。
- 比较上轮 0.372 vs 0.314 仅作历史，不把不同候选池的分数直接当提升。
- 外部真实 heldout 必须单列，若不能评估则如实说明；不把模型标签冒充 human-reviewed。
- 样本不足、标签无区分度、真实迁移不改善或预算异常时停止，不用 synthetic 分数替代。

## 6. 交付

仅写：
- `artifacts/_event-attribution-external-expanded-20261116/`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-EXTERNAL-EXPANDED-20261116.md`

交付候选池分布、500+实际标注量（或不足原因）、独立 heldout、训练/变异、可复算脚本/指纹与未验边界。
不 commit/push、不装依赖、不改生产 lib/真实记忆/19387、不称RL。
