# Prompt：2.3 外部事件四态标注与隔离训练验证

> 日期：2026-11-16
> 工作区：`D:/dsh-auto-memory`
> 用户已授权接入外部数据，目标是补足本地真实数据不足并检验能否得到较可靠模型。
> 执行者：复用同一 DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`。

## 1. 基线与授权

先读：
- `docs/internal/RESULT-EVENT-ATTRIBUTION-CROSSDOMAIN-20261116.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-ROUND3-20261116.md`
- `artifacts/_event-attribution-crossdomain-20261116/`

已有真实 GitHub 数据：300 PR / 100 issue / 185 评论；T3 comment→issue 的 cov12 严格 LOO=0.288 vs 随机0.016；T1含自身0.966 vs LOO0.023。支持弱信号，不支持直接训练。

用户允许接入外部数据并继续实验；**四态标签可由独立上下文模型生成，标 model-reviewed，不冒充 human-reviewed。** 不装新依赖，不改生产/真实记忆/19387，不称RL。

## 2. 外部真实事件构造

1. 复用已采集的 GitHub issue/PR/comment 原始数据与指纹，优先不重复消耗 API。
2. 按真实项目任务构造事件与候选：issue/PR/review/commit/时间线/状态。
3. 记录正文使用当时可见内容，候选不能复制记录全文；严格 leave-one-out。
4. 困难负候选必须包含：同仓库不同 issue/PR、时间相邻、相似术语、跨语言、closed、无正确目标、伞事件。
5. 保留来源 URL、仓库/对象 revision、许可、响应指纹；不泄露凭据。

## 3. 独立模型四态标注

1. 使用独立新上下文，输入同一证据包，不让标注者看到训练结果、教师答案、隐藏测试标签或另一角色结论。
2. 四态：`attach-existing` / `create-new` / `ambiguous` / `not-applicable`。
3. 输出 eventId（若适用）、证据、反假设、unknowns、原始响应与解析失败。
4. 保存模型 provider/model、请求指纹、labelOrigin=model-reviewed、sourceKind=public-derived。
5. 不让同一生成者兼任标签者与最终裁判；必要时独立仲裁。
6. 标签一致性不自动等于正确，按事件/仓库/重复族隔离，不能用投票替代证据。

## 4. 训练与外部留出

只有真实事件/标签/LOO/切分通过后才训练；不为了跑模型伪造类别。
- 按仓库/原始任务/事件/重复族分组，train/dev/test 不共享。
- 保留未参与标注或训练的外部真实留出集；本机旧test不混入训练。
- 默认冻结 C2 + 可复算轻量分类/排序器，不默认LoRA/E5/CNN/RL。
- 比较零参数cov12、训练模型与严格变异；真实记录参数更新与指标。
- 分组报告四态、误attach/误新建/closed/跨语言/伞事件；候选级与case-level分开，不把检索分数当归属准确率。

## 5. 停止与交付

若标签无区分度、样本不足、真实迁移未改善或外部不可用，停止并如实报告，不以 synthetic 分数替代。

仅写：
- `artifacts/_event-attribution-external-train-20261116/`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-EXTERNAL-TRAIN-20261116.md`

交付数据来源/许可、标注身份/原始输出、LOO/负样本/split、训练参数、外部留出与困难失败、复算命令与未验边界。不commit/push、不装依赖、不生产。
