# 2.3 教师候选、可验证奖励与隔离训练报告（2026-11-13）

## 结论

本轮完成数据修复、真实教师候选、来源证明与独立审计；**未训练 E/F，未运行 RL，不接入生产。**
教师仅产提案与反假设，不是标签真源；奖励来自独立来源或人工复核，不把同一模型自答自评当作强化学习。

## 1. 数据与隔离

- 新目录：`artifacts/_event-attribution-teacher-20261113/`。
- 冻结事件库：53 事件、940 检查点、3,755,866 B，SHA-256 `550751ddc6c0e9c2a2449148f5a2ec8cda4d77c9809c9463746a5673368f0df7`。
- 冻结来源 1,989 文件，全部保留；当前仓库/真实记忆不改。
- 新基准 999 视图 / 893 唯一源；主 weak/direct 805；独立输入负例 3。
- 同源多视图 102 条单列，不能重复计权；协议/时间回放/合成负例不混作真实分布。

## 2. 数据修复与审计

- 真实重复族与 eventId 连通分量固定同一 split；独立复核事件/重复族无跨 split。
- 对象级 LOO、时刻前推、四态与负路径、schema、manifest 检查通过。
- 独立探针 10 CAUGHT / 0 MISSED，覆盖双复核、教师/奖励隔离、越界 ID、closed 和负路径。
- 结构检查通过不等于训练门通过；来源金标与人工复核仍未闭环。

## 3. 教师候选

- 实际模型：`dshapi-kimi/kimi-k3.1-pro`；子代理 `f8f8a1dc-4c99-49dd-bc6e-acef2e2b6ad4`。
- 20 attempted / 20 succeeded / 0 failed；239,631 ms。
- 20 个原始输出逐 case 保留，含 raw/parsed/parseError、反假设与 unknowns。
- 20/20 schema 合法，20/20 候选 ID 合法，全部 teacher-proposal-only。
- 决策分布：attach-existing 13、create-new 4、ambiguous 3；不是正确率，不是生产分布。
- 未把 gold 注入教师；未调用 attach/merge/archive 或 memory_* 写工具。

## 4. 独立来源与奖励

- 真调用 `buildHandoffSourceProofPre`，226 次来源尝试；15 次文件证明通过。
- 独立 `audit-source.mjs` 复核 999 个视图：27 条完整原始指纹匹配，972 条不可验证；归属复核仍需人工。
- 当前基准队列仅 1 条 closed 协议样本有独立来源证明；不是通用 attach 标签。
- 独立协议奖励 1；真实双人复核 0；归属金标采纳 0。
- 复核队列 853 条保留，包含 needs-review、冲突和来源不足项。
- 来源证明只证明文件内容，不证明事件归属；教师置信度、文字长度、自评不产生奖励。

## 5. 训练门

| 项 | 结果 |
|---|---|
| 可验证来源金标 | **0** |
| 双人独立复核/仲裁 | **0** |
| 教师候选 | 20 合法提案，不升金标 |
| 独立协议奖励 | 1，非通用训练集 |
| 冻结 C2 小分类器 | **未训练** |
| LoRA/E5/CNN | **未运行** |
| 真实 RL | **未运行** |
| 自动 attach/merge/archive | **0** |

停止条件：真实来源、四态与双人复核未闭环；不存在可用于可靠训练的偏好/分类数据。

## 6. 后续最小步骤

1. 用 review/verified-review-queue.json 与 review/review-queue-v4.json 组织双人复核，保留分歧与仲裁。
2. 将人工确认的记录标 human-reviewed，附 reviewer 身份、时间和独立证据；教师不得充当复核者。
3. 以独立来源奖励/真实标签重新运行同 case 候选、融合与通用模型对照；不把协议组混入准确率。
4. 只有来源/四态/防泄漏/协议/双人复核门同时通过，才评估冻结 C2 小分类器；否则继续停止训练。

## 7. 产物

- `teacher/manifest.json`、`teacher/raw/`、`teacher/validation.json`
- `rewards/rewards.json`、`rewards/teacher-candidate-rewards.json`
- `review/source-review-v7.json`、`review/split-review-v4.json`
- `review/verified-review-queue.json`、`review/review-queue-v4.json`
- `results/training-gate.json`
- `scripts/01-build-dataset.mjs`、`scripts/02-build-rewards.mjs`

未修改旧基准、生产 lib、真实记忆、19387、2.4、2.9、批次3或 SidecarStore 生产路径；未提交或发布。
