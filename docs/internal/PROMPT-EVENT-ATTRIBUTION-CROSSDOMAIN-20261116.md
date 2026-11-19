# Prompt：2.3 外部真实语料的跨域归属验证

> 日期：2026-11-16
> 工作区：`D:/dsh-auto-memory`
> 执行者：复用同一 DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`
> 用户授权：引入其他语料验证，突破本地真实事件不足。先做**跨域验证**，不直接恢复监督训练或生产接入。

## 1. 已证明的本地瓶颈

先读 `docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-ROUND3-20261116.md` 及 `runs/train-eval.json`：
- 真实可训练独立事件仅 19 个；每个 split 单类；
- cov12 零参数 test 0.725，训练 LR 0.325，dev 0.875 过拟合；
- 监督训练已停止，不是模型继续调参的问题。

本轮问题：外部真实语料能否提供**独立验证域**，帮助区分“本地过拟合”与“候选排序无效”。

## 2. 数据来源优先级

### A. 真实 GitHub 项目历史（优先）

选 1–2 个公开仓库的小样本：issue、关联 PR、review、commit、时间线。
必须保存 API URL、仓库/对象 revision、许可、时间、原始响应指纹与脱敏策略；不读/写私有仓库，不泄露 token。

用途：
- 将 issue/PR/commit 组成候选事件；
- 在记录时刻只使用当时可见内容；
- 用真实的关联关系与文本证据评估候选排序；
- 构造相邻时间、同仓库不同 issue/PR、相似术语但不同任务的负候选。

### B. SWE-bench

官方入口：https://www.swebench.com/SWE-bench/guides/datasets/
先取 Lite/Verified 小样本，不全量下载。记录真实 issue/PR、base_commit、patch、仓库、许可与数据 revision。
**它是代码修复基准，不是本插件归属金标。** 同仓库、同主题不自动意味着同事件；只能按其真实关联与独立协议构造候选验证。

### C. MEnvData-SWE-Trajectory

https://huggingface.co/datasets/ernie-research/MEnvData-SWE-Trajectory
公开 agent 轨迹可补充过程记录，但轨迹可能为模型生成，须标 `sourceKind=public-derived`、真实/合成分离，不冒充真实事件库。
若缺 Parquet 解码能力，**不擅自安装依赖**；优先使用 API 元数据、JSON/JSONL 或可读取的小样本，缺能力则如实阻塞，不把只读文件当转换完成。

## 3. 跨域验证，不先训练

1. 每个外部任务独立成域，按仓库/原始任务/事件/重复族隔离，不能与本地 train/test 混合计权。
2. 采用与本地推理一致的严格 LOO 证据视野；不能把 issue/PR/commit 的全文复制到 gold 候选让它字符串命中。
3. 比较 `cov12`、零参数基线与必要的语义候选排序，记录 top-1/top-k、误 attach、误新建、closed、跨语言与无正确候选。
4. 外部数据不自动证明本插件四态标签；任务定义不同的指标必须分开报告。
5. 如外部结果支持，才另立真实 train/dev 试验；没有证据则不恢复监督训练。
6. 不把 cov12 直接接入生产，不因外部分数好就宣称本插件准确率提升。

## 4. 交付

仅写：
- `artifacts/_event-attribution-crossdomain-20261116/`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-CROSSDOMAIN-20261116.md`

交付来源/许可、下载/解析证据、事件构造规则、LOO 与负候选、跨域指标、可复算脚本/指纹、无法转换项。
不 commit/push、不装依赖、不改生产 lib/真实记忆/19387、不称 RL。
