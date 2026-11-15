# Prompt：2.3 训练后续——候选证据视野、真实分布与公开轨迹转换

> 日期：2026-11-16；性质：首轮隔离训练已完成后的下一轮工程任务，不是生产接入。
> 执行者：负责 2.3 的 DeepSeek teammate；单写域。
> 目的：解决首轮已定位的跨源失败，而非继续盲目调参。

## 1. 必须读取的真实证据

- `docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-20261116.md`
- `artifacts/_event-attribution-lab-20261116/eval/final-summary.json`
- `artifacts/_event-attribution-lab-20261116/eval/transfer-diagnosis-v2.json`
- `artifacts/_event-attribution-lab-20261116/data/visible-leak-audit.json`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md`

首轮真实训练：484 样本、26 维、Adam 400 epochs，参数真更新 trainAcc 0.1245→0.7791。合成测试 0.867/0.933，真实留出 9/15=60%，误 attach 0、误新建 3、过度 ambiguous 2。18/26 特征在训练/真实集间偏移 >0.8σ。

## 2. 基线订正必须保留

- C2：上一轮将“存储层同文”误读成“可见证据泄漏”不成立。实测可见 excerpt 与记录正文 12-gram 包含度最高 0.350，0/20 达 0.60；逐字相同为 0。自泄漏过滤有效。
- C4：教师轮 dev 的 92 例全为 historicalWeak/attach-existing，不能用于模型选择。
- C5：首版 synthetic 生成器把正文逐字复制进候选，已改为同内容不同表述+长度对齐，修正后 0/1231。
- `protocolConflict` 的旧弱金标仍是协议构造，不能作训练答案；跨事件同文是存储事实，不等于泄漏或错误标签。

## 3. 第一轮：修候选证据视野与真实分布

在新隔离目录 `artifacts/_event-attribution-lab-round2-20261116/` 中实现，不改原 lab 原件：
1. 给候选检查点添加**首 300 字确定性摘要**，保留来源、时间、状态与原始证据，不用仅 3 条摘录。
2. 修正偏移最大的特征：`path_overlap`、`len_ratio_r`、`jac3`；分别测量训练/真实分布，不允许删去偏移来伪装通过。
3. 合成正文按真实分布采样长度、时间差、路径重叠度与多语言比例；同族/事件/来源隔离 split。
4. 保留误 attach、误新建、跨语言误并、伞事件误挂、closed、无正确候选等负路径。
5. 训练前后必须有真实参数更新；同指标若因新特征改善须保留对应证据；不将 15 例诊断外推为稳定模型效果。

## 4. 第二轮：公开轨迹小样本转换

只有第 3 节已有真实训练与留出结果后，再做公开轨迹转换：
- AgentLogs（cc-by-4.0）：https://huggingface.co/datasets/risenlab/agentlogs
- SWE-ZERO（apache-2.0）：https://huggingface.co/datasets/AlienKevin/SWE-ZERO-96K-trajectories

小样本/流式预览，不全量下载；保存 URL、revision、许可、访问时间、转换脚本指纹。公开轨迹没有本插件归属金标，须按任务/时间/工具动作/主题构造候选事件，再由独立上下文模型标归属；任务相同不自动等于事件相同。

公开数据与模型标签分别记录 `sourceKind=public-derived`、`labelOrigin=model-reviewed`；按原始任务/仓库/事件/重复族隔离，不与训练同族泄漏。未知许可不可默认重分发。

## 5. 验收与停止

- 真 import、真加载 C2、真训练、真评估；每组分别报告误 attach/误新建、ambiguous、closed、跨语言与伞事件。
- 保留困难负样本与分歧，不能为了分数删掉。
- 变异需有区分力；不得以“变异后不高于基线”这种恒偏向判据充数。报告首轮 M4 是强证据，其余小差异可能是噪声。
- 人工金标、真实 HOST、跨设备、生产启用仍单列未验；模型标签不冒充 human-reviewed。
- 失败、401/额度异常、预算异常或持续无改善时停止，不静默重试到满意答案。
- 产物只写新隔离目录与 `docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-ROUND2-20261116.md`；不 commit/push、不生产、不默认 RL/LoRA/大模型微调。
