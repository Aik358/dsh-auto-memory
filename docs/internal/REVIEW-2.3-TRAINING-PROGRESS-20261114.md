# 2.3 训练回报与训练门复核（2026-11-14）

> 性质：对已有隔离实验与教师报告的复核，不是新训练，不是生产接入。
> 证据：`RESULT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`、`RESULT-EVENT-ATTRIBUTION-TEACHER-TRAINING-20261113.md`、`artifacts/_event-attribution-teacher-20261113/results/training-gate.json`。

## 1. 确实有回报的四个部分

| 回报 | 实测证据 | 可复用价值 |
|---|---|---|
| 数据与切分修复 | 冻结 53 事件 / 940 检查点 / 3,755,866 B；新基准 999 视图 / 893 唯一源；重复族与 eventId 连通分量固定 split；独立探针 10 CAUGHT / 0 MISSED | 能继续复核、切分与对比，不把多视图当独立样本 |
| 教师候选生成 | 20 attempted / 20 succeeded / 20 schema 合法；含反假设与 unknowns | 可做候选池、批判者、人工复核提示，不是标签真源 |
| 独立来源证明 | 999 视图中 27 条完整原始指纹匹配，972 不可验证 | 为独立奖励提供证据；证明只覆盖文件内容，不等于归属正确 |
| 负路径与协议审计 | 未知/closed ID、proposal-only、缺来源、分裂与重复族检查已有 | 可作为训练前的协议门与困难样本来源 |

## 2. 尚未获得的关键回报

- **没有训练出模型**：E/F 小分类器、LoRA/E5/CNN、RL 全部 `not-run`。
- **没有可靠训练集**：双人复核/仲裁为 0，归属金标采纳为 0；仅 1 条独立协议奖励，不是通用 attach 数据集。
- **没有生产归属能力**：真实 attach/merge/archive 为 0；教师 20 条只代表结构合法，不代表准确率。
- **没有可用的旧金标捷径**：940 条历史检查点不自动成为训练金标；同源视图不可重复计权。模型复核还发现 protocolConflict 的弱金标为协议构造，不能继续当训练答案。

## 3. 当前训练门的实际读数

| 门 | 当前值 | 判定 |
|---|---:|---|
| 冻结数据 | 53 事件 / 940 检查点 | 有基础 |
| 教师提案 | 20 合法 | 可复核，不升金标 |
| 独立来源匹配 | 27；归属仍须复核 | 不是 27 条可用归属金标 |
| 独立协议奖励 | 1 | 只够协议样本，不是训练集 |
| 双人复核/仲裁 | 0 | **阻塞训练** |
| 采纳归属金标 | 0 | **阻塞训练** |
| E/F/RL | not-run | 不得声称已训练 |
| 模型复核（2026-11-16） | 20用例/6事件/16族；21/21流程验收 | 只产model-reviewed，不升格为训练金标 |

### 模型复核执行结果（2026-11-16 · Lead 已独立复跑）

- 20 个基础用例只覆盖 **6 个事件、16 个重复族**，不能视为 20 份独立证据。
- 93 份角色输出、解析失败 0；A/B 内容证据包 20/20 哈希一致，仅呈现顺序不同；模型为 `worldcodes.online/v1 · deepseek-v4.1-flash`，与教师轮 Kimi 不同。
- A/B 一致 19/20；与旧 benchmark 弱金标一致仅 10/20，**一致不等于正确**。
- 15/20 用例的可见候选在记录时刻之前已存有同文检查点；`protocolConflict` 5 例的标签是协议构造而非可验证归属。不能把有证据的 attach 记为模型错误。
- 困难负样本：8 探针 / 6 可证 / 3 通过 / 3 失败；去除同场景重复后净独立失败 2：`adv_06` 跨语言误并、`adv_07` 伞事件误 attach。
- `model-reviewed-v1`：19 条 model-reviewed、1 条 needs-human-review；`sourceVerified=0/20`、人工复核/仲裁/确认均 0；**不是训练金标**。
- Lead 独立复跑 `05-validate.mjs` 与 `08-acceptance.mjs`：21/21 PASS。该 PASS 证明记录与流程完整，不证明标签正确。
- 结果报告：`RESULT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md`；隔离目录：`artifacts/_event-attribution-review-20261116/`。
- 后续只修**隔离基线**：跨事件同文须显式标注并排除出冲突金标，不能删除真实历史；重做 `protocolConflict` 与 `originTimeReplay` 的独立归属复核。未启动训练、未写生产。

### 用户授权隔离挂机训练（2026-11-16）
用户允许模型直接构造训练标签、结合公开/合成事件库并挂机多轮训练。标签仍为 `model-reviewed` 实验数据，不冒充人工金标；任务书 `PROMPT-EVENT-ATTRIBUTION-LAB-20261116.md`，task-19由既有DeepSeek teammate执行。先构造与审计多源数据，再训练冻结C2轻量分类/排序器，在独立留出集验证误attach/误新建/跨语言/伞事件成本。生产与19387不动。


## 4. 与用户临时需求的衔接

需求到达后先确定：四态与标签定义、允许使用的候选/来源证据、双复核人与仲裁方式、困难负样本范围、期望模型形态和验收门。默认优先冻结 C2 向量的小分类/排序器，不先训练大模型。

后续步骤：
1. 用 `review/verified-review-queue.json` 与 `review/review-queue-v4.json` 组织双人独立复核；教师不兼任两位复核者。
2. 记录 `human-reviewed`、reviewer、时间、独立证据、labelVersion、分歧及仲裁。
3. 对同 case 重新比较确定性融合与通用模型，分别报告误 attach、误新建、跨语言和 closed；协议组不混入准确率。
4. 数据、四态、独立奖励、双人复核、协议和防泄漏同时通过后，才评估冻结 C2 小分类器。
5. 若采用监督分类/蒸馏就如实命名；若要称 RL，必须有多动作、独立外部奖励和实际策略/权重更新。

## 5. 结论

**2.3 已从“无可用实验基础”推进到“有可复核数据、教师提案和来源证据”，这是实质回报；但尚未跨过训练门。下一步是独立复核与真实标签闭环，不是立刻训练或上线。**

### 首轮真实监督训练（2026-11-16 · Lead 已独立复跑）

用户授权模型构造训练标签与隔离训练后，task-19已真实完成：484样本/26特征，numpy Adam400ep，trainAcc0.1245→0.7791；synthetic test0.867/0.933，真实留出9/15=60%。真实误attach0、误新建3、过度ambiguous2；18/26特征偏移。下一轮先修候选证据视野与真实分布，再做公开轨迹转换。

C2订正：可见证据包同文泄漏不成立，最高12-gram包含度0.350、0/20达阈值；上一轮把存储层同文误读为可见泄漏。C4：旧dev92例全attach-existing单类，不可选模。人工金标/真实HOST/公开轨迹未闭环；不称RL、不启用生产。

### 第二轮真实训练复核（2026-11-16）

第二轮已完成并由Lead按权威管道复跑：A=8/15，B-model=7/15，B-provable=9/15，真实最佳仍与首轮持平；M1去LOO与M2去结构仅−0.012噪声，说明新特征未被利用。首300字摘要分离度−0.0135、全量检查点自引用、jac3偏移7.676未修；S5 closed从14/14错改善为12/12对。公开轨迹许可已核实但无parquet解码能力，未安装依赖。下一轮应停止synthetic调参，切真实train/dev并解决historicalWeak证据不对等。

### 第三轮已收口（2026-11-16）

真实可训练独立事件仅19个，split单类；候选级零参数cov12 test0.725，训练LR0.325，dev0.875过拟合。监督训练不再继续，cov12仅作实验候选，不直接生产。公开轨迹B1阻塞、人工金标/HOST未验。Lead已核对落盘train-eval.json，完整run_code复跑两次120s超时，不宣称完整复跑通过。

### 外部语料跨域验证已启动（2026-11-16）

用户要求引入其他语料验证，task-22复用同一DeepSeek teammate。优先真实GitHub issue/PR/commit，再SWE-bench/MEnvData；先跨域验证cov12/候选排序，不直接恢复监督训练，不装依赖、不生产。任务书：`PROMPT-EVENT-ATTRIBUTION-CROSSDOMAIN-20261116.md`。

### 外部跨域验证已收口（2026-11-16）

真实GitHub跨域结果由Lead复跑一致：T3 comment→issue125例，cov12严格LOO=0.288 vs 随机0.016，按仓库一致；T1含自身0.966 vs LOO0.023，量化自引用虚高。支持弱信号迁移，不支持恢复监督训练；无四态标签、Parquet B1阻塞、真实HOST未验，不直接生产。

### 外部四态训练已启动（2026-11-16）

用户授权接入外部数据，task-23复用同一DeepSeek teammate。外部真实事件+独立模型四态标注(model-reviewed)+严格LOO+外部留出训练；不冒充人工金标、不装依赖、不生产。任务书：`PROMPT-EVENT-ATTRIBUTION-EXTERNAL-TRAIN-20261116.md`。

### 外部四态训练已复核（2026-11-16）

task-23由Lead独立复跑一致：dev0.372 vs majority0.314/cov12 0.235，首次超零参；M5打乱标签0.059。仍不是可靠模型：候选池3157全closed、dev51例、heldout51未评估、模型标签非人审。下一轮优先重采含open候选，再决定扩大训练。

### 外部候选池重采与500+扩展已启动（2026-11-16）

用户授权可自行决定是否扩大标注到500+，task-24复用同一DeepSeek teammate。先修候选池全closed偏置，再按真实独立事件扩展；冻结模型后独立标注heldout评估，不凑数、不装依赖、不生产。任务书：`PROMPT-EVENT-ATTRIBUTION-EXTERNAL-EXPANDED-20261116.md`。

### 外部扩大标注与冻结留出已复核（2026-11-16）

task-24由Lead独立复跑一致：520标注、1,024包、候选池openRatio0.5126、冻结留出153；训练0.3137 vs cov12 0.3203，四态多分类不优于零参。标签model-reviewed非人审，heldout同标注器只衡量拟合，不等于真实归属准确率。停止继续加量/调参，后续另评case-level或混合，不直接生产。

### 开源训练方案已核对（2026-11-16）

BLINK(MIT)为候选检索+交叉编码器精排；dedupe(MIT)为记录消歧+主动学习；sentence-transformers提供pairwise/困难负样本/排序损失。下一轮优先case-level或pairwise匹配、候选召回精排、主动学习；不再继续四态调参。报告：`RESEARCH-EVENT-ATTRIBUTION-OPEN-SOURCE-20261116.md`。

### 候选精排与主动学习已启动（2026-11-16）

用户同意尝试开源方案，task-25复用同一DeepSeek teammate。真实pair、候选召回+精排/主动学习、严格LOO与冻结留出；不恢复四态调参，不装依赖、不生产。任务书：`PROMPT-EVENT-ATTRIBUTION-PAIRWISE-20261116.md`。

### 候选精排首个正向结果已复核（2026-11-16）

task-25由Lead独立复跑一致：heldout80例cov12=0.5125、召回+pairwise精排0.5625（+5pp），召回@5=0.70为硬上限。候选精排比四态分类更适合当前数据，但不是可靠模型；未加载预训练模型、跨语言/伞事件未验、标签非人审、不生产。

### 多方向召回实验已启动（2026-11-16）

用户授权多方向尝试，task-26复用同一DeepSeek teammate。比较cov12/放宽K/语义召回/召回+精排/主动学习，严格LOO与真实留出；可用本机冻结C2，不装依赖、不生产。任务书：`PROMPT-EVENT-ATTRIBUTION-RECALL-MULTI-20261116.md`。

### 多方向召回已复核（2026-11-16）

task-26由Lead独立复跑一致：C2真加载384维/770文本13.346s/禁网；语义0.25、融合0.5125，cov12+rerank@5=0.5625仍最优，K10=0.5375。语义相似不是归属证据；下一步case-level是否存在可attach目标，不直接生产。

### 归属信号分层已补充（2026-11-16）

用户提出时间权重，已整理硬约束/来源/生命周期/时间结构/关系链；时间仅作约束与弱证据，不能简单越近越好。后续按时间/生命周期/来源消融，严格LOO与真实留出，不直接生产。报告：`ANALYSIS-EVENT-ATTRIBUTION-SIGNALS-20261116.md`。

### 归属分类验证已启动（2026-11-16）

用户授权将归属判定交给DeepSeek teammates，task-27复用同一DeepSeek teammate。验证时间/生命周期/来源/身份关系能否准确归类事件，覆盖困难场景、严格LOO与真实留出；模型标签非人审，不生产。任务书：`PROMPT-EVENT-ATTRIBUTION-CLASSIFICATION-20261116.md`。

### 归属分类验证已复核（2026-11-16）

task-27由Lead独立复跑 `s3-eval.py` 一致：339例总体0.8348，排除19例closed-boundary循环论证后279/320=0.8719，attach目标定位0.9665。候选截断曾使gold仅91/333可见，是装置缺陷；任何top-K必须报gold覆盖率。多合理候选0.5946仍未解；跨语言/伞事件无真实样本、模型标签非人审，生产未启用。

### 模块化/API化归属提醒接线已启动（2026-11-16）

用户确认2.3是向模型返回判断与异常提醒，不是自动写入；task-28复用同一DeepSeek teammate。按 `PROMPT-EVENT-ATTRIBUTION-IMPLEMENTATION-20261116.md` 建立独立模块与公共API facade，接入memory_log/memory_note/历史零写提案；`lib/index.js`仅薄接线，不接2.4或Sidecar facade，真实HOST另验。

### 第三轮已启动（2026-11-16）

用户同意停止synthetic调参，task-21复用同一DeepSeek teammate。按真实事件/重复族/来源切train/dev，严格LOO与候选证据对齐，保留真实test；不装依赖、不公开轨迹转换、不生产。任务书：`PROMPT-EVENT-ATTRIBUTION-LAB-ROUND3-20261116.md`。

### 模型执行复核的补充（2026-11-16）
模型可承担双盲复核、仲裁和困难负样本构造；同一模型必须使用不同独立上下文，不能自产自证。输出为 `model-reviewed`，不等同双人复核或 `human-reviewed` 金标。若放宽人工门，须单独验收模型标签的可靠性，不能自动训练。执行 Prompt：`PROMPT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md`。
