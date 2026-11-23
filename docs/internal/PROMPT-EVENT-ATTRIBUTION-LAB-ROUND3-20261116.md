# Prompt：2.3 第三轮——真实 train/dev、LOO 证据对齐与可迁移训练

> 日期：2026-11-16
> 工作区：`D:/dsh-auto-memory`
> 执行者：复用同一 DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`
> 用户已授权继续第三轮；仍属隔离监督训练实验，不是生产或 RL。

## 1. 已确认失败，禁止重复做无效优化

先读：
- `docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-20261116.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-ROUND2-20261116.md`
- `docs/internal/PROMPT-EVENT-ATTRIBUTION-LAB-ROUND2-20261116.md`
- `artifacts/_event-attribution-lab-round2-20261116/runs/run2-eval.json`
- `artifacts/_event-attribution-lab-round2-20261116/runs/run3-mutation.json`

首轮：484 样本/26 特征，真实留出 9/15=60%。
第二轮：合成 test 0.400→0.941，真实最高仍 9/15=60%；LOO/结构消融仅 −0.012，新增视野无贡献。首 300 字摘要分离度 −0.0135；全量检查点是自引用；jac3 偏移 1.345→7.676；historicalWeak 四臂 0/5。

**第三轮不得继续用 synthetic 指标调参或宣称改进。** 真实证据是唯一主线，合成集只能作补充。

## 2. 真实数据切分与证据视野

1. 只读使用教师轮真实冻结 benchmark（999 视图 / 893 唯一源；原 53 事件/940 检查点）。不得改原始快照。
2. 以真实记录（含 historicalWeak）构造 train/dev，保留真实测试/留出集继续隔离，不因分数不理想而把它并入训练。
3. 按原始事件 ID、重复族、来源任务与时间分组；每组不得跨 train/dev/test。
4. 区分旧弱标签与模型标签，不能把协议构造或同文跨事件自动当真值。
5. 记录真实记录正文/候选/来源/时间/状态的对齐视野：训练、验证、推理必须同口径。

## 3. 必须优先解决的问题

- 真实记录常为 1000–3000 字交接账本，而候选只有 name/summary+3 条摘录 ⇒ 训练/推理证据不对等。
- 首 300 字是账本标题，实测负贡献 ⇒ 不再把它作为主特征。
- 全量检查点包含记录自身 ⇒ 严格 leave-one-out，禁止 self-leak。
- jac3 被长语料分母稀释 ⇒ 不要只继续堆长度/词面重合。
- 保留误 attach、误新建、closed、跨语言、伞事件与无正确候选负路径。

允许对比：
- 相同证据视野下的真实训练 vs 合成补充；
- 语义/候选表示与确定性状态/时间特征；
- 真实 dev 选择的超参数，不用 test 选模型。

## 4. 实施、训练与评估

新目录：`artifacts/_event-attribution-lab-round3-20261116/`。
旧 lab/round2 只读；真实记忆、生产 lib/、19387 不动。

- 真加载冻结 C2 multilingual-e5-small/q8，记录加载/推理时间、维度、指纹。
- 默认继续冻结 C2 + 可复算轻量分类器/排序器，不默认 E5/LoRA/CNN/RL。
- 每轮保存配置、数据 manifest、split、模型身份、参数前后变化、日志、指标、SHA-256。
- 真实 train/dev 选择模型，真实 test 只作最终诊断；报告 false-attach、false-create、ambiguous、closed、跨语言、伞事件，按来源/类别分组。
- 必须包括不训练/零参数基线和严格变异，不能只报一个 trainAcc。
- 若真实样本不足以覆盖类别，必须如实写为“协议/迁移诊断”，不能虚构金标或只按多数类得分。

## 5. 停止与交付

出现下列任一情况停止并报告：真实分布无法对齐、候选证据无法由真实数据构造、训练/测试泄漏、真实错误不降、外部模型不可用或预算异常。

交付 `docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-ROUND3-20261116.md`，含真实训练/验证/测试对比、困难负样本、失败归因、可复现命令与未验边界。

不 commit/push、不装新依赖、不转换公开轨迹（本轮 B1 未解决）、不生产、不称 RL。
