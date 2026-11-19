# Prompt：2.3 多源事件库、模型构造标签与挂机训练实验

> 版本：2026-11-16
> 工作区：`D:/dsh-auto-memory`
> 性质：用户已授权**隔离训练实验**与**挂机迭代**；不是生产接入、不是人工金标声明、不是 RL 默认授权。
> 目标：用模型构造可审计训练标签，结合真实/公开/合成事件库，训练并比较多轮冻结 C2 轻量归属分类/排序器。

## 0. 先回答：允许什么，不允许什么

- **允许**模型直接生成归属标签并用于训练；`model-reviewed` 是正式的数据来源标签，不再等待人工双人门才能做实验。
- **允许**多轮无人值守迭代，但每轮必须可恢复、可复算、可停止。
- **允许**公开轨迹和自行编写的事件库，但必须标 `sourceKind`、真实/构造分组与来源许可。
- **不允许**把教师/复核模型的输出冒充 human-reviewed；同一模型的多会话投票不自动证明正确。
- **不允许**生产 attach/merge/archive、真实记忆写入、19387 操作、自动发版或 push。

训练代码、输出、缓存和证据只能写新隔离目录：
`artifacts/_event-attribution-lab-20261116/`

## 1. 基线与身份

开工读取并保留 SHA：
- `docs/internal/PROMPT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md`
- `docs/internal/REVIEW-2.3-TRAINING-PROGRESS-20261114.md`
- `artifacts/_event-attribution-review-20261116/`
- `artifacts/_event-attribution-teacher-20261113/`

旧冻结事件库、benchmark、teacher/review 原始目录均只读，不覆盖。模型标签可作为训练输入，但须保留：
`labelOrigin: model-reviewed`、`modelIdentity`、`sourceKind`、`provenanceSha256`、`reviewStatus`、`labelVersion`。

不要复用旧自评循环的指标作为本批效果；旧 `_ranker-selfloop-20261109` 只作历史实现参考。

## 2. 多源事件库

### A. 本机冻结事件库（real-frozen）

只读转换本机既有快照，不复制密钥、tokens 或原始凭据。
保留真实事件/检查点/来源/时间关系；修正隔离基准的已知缺陷：
- `protocolConflict` 的标签是协议构造 ⇒ 不作为训练答案。
- 同文跨事件检查点显式标为 `sameTextCrossEvent`，不把它简单当错误；它是存储事实，需与目标标签分开。
- 不删除真实历史，不在报告中把“删除”当清理手段。

### B. 公开轨迹转换（public-derived）

候选来源：
- [AgentLogs](https://huggingface.co/datasets/risenlab/agentlogs)
- [SWE-ZERO 轨迹](https://huggingface.co/datasets/AlienKevin/SWE-ZERO-96K-trajectories)

先取**小样本/流式预览**，不全量下载。记录来源 URL、仓库/数据 revision、许可证、访问时间、转换脚本指纹；未知许可不得默认允许重分发。

公开轨迹原本**没有本插件的事件归属标签**。转换必须：
1. 按任务、时间、工具动作与主题构造候选事件及记录正文。
2. 把“任务相同”与“事件相同”分开；不能用同仓库、同主题直接冒充 attach 金标。
3. 交给独立上下文的归属模型生成标签，输出依据、反假设与 unknowns。
4. 公开数据与模型标签分别标 `sourceKind=public-derived`、`labelOrigin=model-reviewed`。
5. 转换后按原始任务/仓库/事件/重复族隔离 split，不能近重复跨集合。

### C. 自行编写事件库（synthetic-authored）

可让模型编写真实感事件库，但必须有生成规则，不得随机拼词：
- 每库有若干主线/子任务/阶段、时间线、候选事件、记录正文与允许的来源。
- 标签须由**独立上下文的归属模型**依据同一证据包给出；生成者不得兼任标签裁判。
- 必须包含误 attach、误新建、无正确候选、多候选、closed、同文异事、跨语言、伞事件与时间相邻场景。
- 输出 `sourceKind=synthetic-authored`；合成量不计入真实事件量，模板同族不重复计权。

## 3. 模型构造标签协议

1. 冻结候选/证据包后再调用模型；保存输入指纹、模型 provider/model、日期、原始输出与解析错误。
2. 标签四态：`attach-existing` / `create-new` / `ambiguous` / `not-applicable`。
3. 标签者只依据当时允许的候选/正文/时间/来源/协议判断；不读隐藏测试集、未来答案或训练结果。
4. 独立 A/B 与仲裁可复用前次模型复核 Prompt；模型身份不同须如实记录。
5. 一致、置信度与多数投票只用于筛选/分层，**不能替代独立证据**。
6. 将分歧、缺证据、跨语言误并、伞事件误 attach 和 closed 留作困难样本；不要静默丢弃坏例。

## 4. 数据切分与独立评估

按 `eventId` 连通分量 + 重复族 + 来源库 + 公开原始任务分组；同一组不得跨 train/dev/test。

至少保留：
- 本机冻结真实留出集；
- 未参与模型构造的真实协议/困难负样本；
- 公开任务留出集；
- 跨语言与无正确候选组。

旧 benchmark 弱金标只作历史对照，不能继续当训练目标。报告按组给：
- false-attach / false-create；
- ambiguous 的代价与覆盖；
- closed / not-applicable；
- 跨语言误并、伞事件误 attach；
- macro-F1、各组召回/精确率、混淆矩阵。

**样本数不是模型效果。** 不因训练损失下降或同一模型复答一致就宣称效果提升。

## 5. 第一版训练实现

默认使用**冻结 C2 multilingual-e5-small/q8 向量**作为底座，训练轻量分类器/排序器。优先级：正确区分候选、控制误 attach、控制误新建，不以总分掩盖危险错误。

本机实测当前 Python 有 `numpy`、**没有 scikit-learn**；先在隔离脚本中探测真实可用库：
- 可用则选择轻量 softmax/逻辑回归、centroid/ridge 或小型 MLP。
- 不可用时，用现有 numpy 写可复算的实现，**不要为赶进度偷偷改生产依赖**。
- 若确需安装新训练框架，先列成本并等用户授权。
- 不自动下载/更新大模型，不默认跑 E5/LoRA/CNN。

每轮保存：代码/配置/数据 manifest/随机种子/模型身份/初始与最终参数/指标/训练日志/字节数/SHA-256。实现真正的参数更新与前后指标，不以固定答案或常数冒充训练。

## 6. 挂机循环

每轮：
1. 冻结本轮数据 manifest、split 与标签来源。
2. 训练轻量模型，保存 checkpoint 与配置。
3. 在未参与构造的留出集评估；记录误 attach/误新建等分组成本。
4. 对失败样本做独立复核；必要时生成新的困难负样本，但不得把测试答案直接喂训练。
5. 与上一轮比较，决定继续或停止。

停止条件：
- 到达用户批准的轮数/时间/费用/调用预算；
- 连续若干轮没有真实改善，或主要错误未下降；
- 数据/证据/指纹/泄漏检查失败；
- 外部模型持续不可用、401/额度耗尽或预算异常。

禁止：
- 通过改测试标签或指标定义让结果变绿；
- 把测试集/同族复制进训练；
- 失败时静默重试直到得到想要的答案；
- 自动把最佳模型接入生产；
- 用监督蒸馏或分类训练冒称 RL。

若要称 RL，必须另有独立外部奖励、多动作与实际策略/权重更新；默认本任务是**监督训练/蒸馏实验**。

## 7. 交付与停止报告

交付：
- `docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-20261116.md`
- 隔离目录中的数据 manifest、来源/许可、训练脚本、日志、checkpoint、split 与评估报告。
- 模型标签、模型身份、训练前后指标、误 attach/误新建和困难样本逐项结果。
- 当前仍然未通过的人工门、真实 HOST、跨设备与生产启用单列。

**允许启动挂机实验，但只在新隔离目录写产物；用户没另行授权前不得 commit/push、不得启用生产。**
