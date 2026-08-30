# M7 Activation Calibration 标签复核与定向扩充报告

> runId:`label-review-cal20260824-1954` · 日期:2026-08-24
> 上游:`artifacts/m7-live-pre/calibration-cal20260824-1855/`(Phase F 校准,verdict=`insufficient_gold_for_active`)
> 本轮性质:**只做语义标注、边界样本与人工复核材料**——零代码改动、零阈值调整、零开关操作。
> 状态:**active canary remains prohibited until human gold is imported.**

## 1. 三类标签的严格区分

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| existing silver labels(已复核) | **73** | `existing-labels-reviewed.jsonl`:逐条附 proposedAction/recallIntent/dialogueAct/echoRisk/taskNeed/scopeStatus/freshnessStatus/rationale/disagreement |
| new synthetic silver labels | **109**(56 组 counterfactual pairs) | `counterfactual-pairs.jsonl`:全部锚定真实 parent 记录,仅改变 query 表达与需求强度;`synthetic=true`,`isGold=false` |
| user-confirmed gold labels | **26**（第一批已导入；见 §9） | `gold-confirmed.jsonl`：A11 / P11 / S4，含 7 条对 agent 提案的覆盖与 2 条暂缓挂起 |

## 2. 既有 73 条复核结果

- **维持原判 71 条;修正 2 条**(`disagreementWithPreviousLabel=true`):
  - `cal-0036`(HarmonyOS 开发指引清单):prefetch → **suppress**。原判预设"外部项目知识可作背景 prefetch",但在 dsh-core 生产 scope 下目标(claude 来源)不可达也不应出现;expected 转入 forbidden(wrong-scope)。
  - `cal-0037`(PsychoPy 技术栈):同上,prefetch → **suppress**。
- **action 分布变化**:activate 31 / prefetch 16→14 / suppress 26→28。
- **新增维度标注**(全部 73 条):echoRisk 高 2(面条/天气回声)/中 1/低 3;dialogueAct question 39·request 15·planning 10·error-report 4·statement 2·acknowledgement 1·other 2;taskNeed required 31·optional 14·none 28;scopeStatus invalid 9。
- **remaining ambiguity**(3 项,需用户裁定):
  1. `cal-0020`:envelope 预算查询检索第一名为 ep_11f4f11b6beeabb2 而 gold 标 ep_9695c53761cd879c——可能并列正确,可用选择栏 E 改写目标集合;
  2. `cal-0029` 等 lq 继承样本:父记录属外部 codex 工作区,L2 无 scope IR 协议下标 activate 成立,生产 scoped 部署后应视为 wrong-scope;
  3. `cal-0007/0008/0039`:概览型/演进型问题的 activate-vs-prefetch 归类依赖使用习惯,建议由用户定调。

## 3. 边界人工复核队列(28 条,`boundary-review.md`)

按任务书十项优先级选出,覆盖:

| 优先级类别 | 样本 |
| --- | --- |
| 高分 suppress(回声陷阱本体) | cal-0009(0.651)、cal-0010(0.580) |
| 最高/最低 activate | cal-0003/0001/0024 ↔ cal-0005/0016/0068 |
| act/prefetch 边界 | cal-0007/0008/0039/0044 |
| recall vs 陈述对照 | cal-0001↔cal-0009、cal-0015 |
| correction/supersede | cal-0014、cal-0015、cal-0005 |
| wrong-workspace/stale | cal-0036/0037/0055/0058 |
| 中英跨语言召回 | cal-0002、cal-0031、cal-0035 |
| 目标不唯一 | cal-0066、cal-0045、cal-0008、cal-0020 |
| harmful 风险 | cal-0062、cal-0060、cal-0059、cal-0073 |

每行给出 query / 候选摘要 / 观测分 / 建议 / expected / forbidden / harm / 简短理由 / 用户选择栏(A/P/S/H/E)。**用户只需审这 28 条,不必看全量语料**;确认后置 `labelSource=human`、`isGold=true`,交回校准流程重算阈值。

## 4. Counterfactual pairs(56 组 / 109 条,`counterfactual-pairs.jsonl`)

设计原则:同一真实记忆在不同对话意图下应得不同 action——**不发明新用户事实**,只改表达与需求程度。分组:

| 类别 | 组数×条数 | 代表例(同一 parent) |
| --- | --- | --- |
| explicit recall vs semantic echo | 12 组 ×26 | 午饭:A"之前午饭吃了什么?"→activate ∥ B"今天这碗面挺好吃。"→suppress;BGE-M3:A"为什么选它?"→activate ∥ B"看起来不错。"→suppress ∥ C"准备评估新模型。"→prefetch |
| task failure/repeat vs normal planning | 8 组 ×16 | stale-context 再现→activate ∥ "之后留意 contextVersion"→prefetch;"又失败,之前确认的方式是什么?"→activate |
| old fact vs correction/supersede | 8 组 ×16 | jieba 勘误对(问现状→返回新权威=activate;坚持旧法→harmful suppress);发布策略新旧两版 |
| 同主题不同 workspace | 8 组 ×16 | 同一 query 在 ws/dsh-core→suppress(forbidden=外部记录) vs 源工作区 scope→activate(workspaceScope 字段区分,可直接供未来 scoped harness 使用) |
| zh/en/mixed 变体 | 8 组 ×17 | 琥珀协议 zh/en/mixed 三连;validator 双语对 |
| 代码/路径/错误码/包名锚点 | 6 组 ×6 | ev_pre_ cov=0.035、finish_reason=network_error、pkt_pre_ a602f2aa、503 Endpoint、finalDigest、obs_pre_ 幂等 |
| 低信息/闲聊/acknowledgement 对照 | 6 组 ×12 | "好的,继续。"→suppress ∥ "好的,继续说 inbox 门序。"→activate;"谢谢!"∥"谢谢。另外确认下 BM25 的 b 值。" |

- action 分布:activate 65 / suppress 35 / prefetch 9(harmful 8);语言:zh 94 / mixed 9 / en 6。
- split 按 pairId 哈希分组:train 92 / dev 10 / test 7,**同组绝不跨 split**。
- 全部 expected/forbidden 指向经存在性校验的真实 `mem_*`/`ep_*` id;parentWorkspace/scopeCaveat 字段显式标明外部工作区归属。

## 5. 质量检查(`validation-report.json`:problemCount=0)

通过项:id 唯一性 · memoryId 格式与 corpus 存在性 · expected∩forbidden=∅ · pair 不跨 split · 敏感模式扫描(token/手机号/绝对路径/app_secret 零命中) · system/runtime 提示标记零泄漏 · 近重复查重(跨 workspace 对照组的同文异 scope 为设计意图,已按 workspaceScope 维度放行并记录)。

## 6. 需要用户确认的最小集合

1. **28 条边界样本**(`boundary-review.md` + `gold-import-template.jsonl`)——这是导入 gold 的唯一入口;其中第 1、2 行(面条/天气回声)与 2 条"(改)"行(cal-0036/0037 的 prefetch→suppress 修正)优先。
2. **3 项 remaining ambiguity**(§2):cal-0020 并列 gold、外部工作区继承样本的 scope 口径、概览型问题归类偏好。

## 7. 结论与停止声明

- 语料判定:用于发现问题/设计激活特征**够用**;第一次人工校准在补入本轮成对场景后**基本够**;宣称生产阈值稳定**还不够**(需 gold 导入+特征层修正后的真实流量回归,见校准文档 §8)。
- 本轮未做且不做:阈值/权重调整、threshold grid 生产决策、active 切换、Python worker/JS Host/M6 修改、3080 重启、真实 MEMORY.md/Anchor/AccessEvidence/Procedure 写入、AI 标签转 gold、按目标分布强行平衡、"模型觉得相关"替代 taskNeed 判断。
- **active canary remains prohibited until human gold is imported.**

## 8. 复核进展（2026-08-24 晚更新）

**第一批人工裁决已导入**（`boundary-review.xlsx` → `apply_decisions.py` → `gold-confirmed.jsonl` + `user-decisions-applied.json`）：

- **26 条翻转 human gold**：A11 / P11 / S4。回声双煞（cal-0009/0010）确认 suppress。
- **对 agent 提案的 7 条覆盖**（全部忠实记录）：cal-0044 prefetch→**activate**；cal-0036/0037/0055/0058 suppress→**prefetch**（跨工作区内容按"建议性联想"处理，标签带 `requiresCrossWorkspaceRelay` 标记——其 gold 生效以议题③a 的联想设置落地为前提，当前 scoped 检索验证不到，重算时单列）；cal-0060/0059 harmful→**false**（用户口径：advisory 参考/AI 自行决定、用户明示时 procedure 照办——转化为议题②中"advisory-only 呈现面"的设计要求）。
- **2 条挂起**（cal-0062 手机号 / cal-0073 API token）：不设字母、附理由"由用户设置决定直接提醒还是仅记忆库可查；不提醒会否丧失记忆系统意义"→ 并入主 Agent 议题③b 敏感度三档，档位定案前不设 gold。
- cal-0008 批注"P(可考虑a)"按 P 落盘、备注保留。

**配额状态**：距每类 ≥15 差 S×11 / A×4 / P×4。已生成第二批快速确认表 `cf-review.xlsx`（32 条 counterfactual 预筛样本：S15 / A11 / P6，同一真实记忆在不同意图下的最小对照），并已用生产 embedder 对全部 109 条 counterfactual 完成预打分（`cf-scored.jsonl`，向量缓存在 `vec-cache/`）——第二批填完后合并重算是即时的。

**预期终点**：两批合计 gold ≈ A22 / P17 / S19，届时首次具备 gold 支撑的 precision/recall 与阈值网格（含真 gold 维度的 echo-trap 分离检验）。

## 9. 真 Gold 阈值分析结果（2026-08-24 深夜，`metrics-gold.json` / `threshold-grid-gold.csv`）

两批合计 human gold **58 条（A22 / P19 / S17），每类 ≥15 达标**；4 条跨工作区 relay 样本单列、2 条敏感度挂起。对 54 条可评估 gold 的首份真指标：

- **当前阈值（0.62/0.52）下的 2 次 emit 全部是错误激活，且都来自面条回声家族**：cal-0009「中午那碗面条挺不错的。」(0.6507) 与 cf-002 同句变体 (0.6254)。回声陷阱从 silver 推断升级为 **human-gold 实证**。
- 混淆矩阵（当前）：S→{emit 2, prefetch 2, suppress 13}；A→{prefetch 5, suppress 17}；P→{suppress 15}。actPrecision=0，actRecall=0，sViolations=4，harmfulEmit=0。
- **分离度在用户精炼标签下依旧不成立**：maxSuppress 0.6507 > maxActivate 0.5914；高于最弱 activate-gold 的 suppress-gold 至少 8 条（两条面条回声 + jieba 复活 + 若干低信息组）。
- 契约网格内最优格（argmin 有害→S 越界→正确量）仍为 0.55/0.50：8 emit 中 4 正确（precision 0.50 / recall 0.182）、S 越界仍 4——**没有任何格子同时满足 precision 优先与可用召回，维持 shadow 的结论现在有人工 gold 支撑**。
- 检索层：gold 目标 Recall@5=@8=0.75。
- 正式判定措辞更新：~~`insufficient_gold_for_active`~~ → **`gold_quota_met_but_score_not_separable`（gold 配额已满足；语义分不可分）**——进 active 的剩余条件收敛为校准文档 §8 的特征层修正（回声抑制/意图信号/margin-evidence 门）+ 修正后重标定。

## 10. 交接状态

- 主 Agent 三议题（自进化路径 / 审批工作流 / 个性化设置：跨工作区联想开关 + 敏感度三档）已入长期记忆，汇报时随附。
- 待办归属：cf-008/014 等"P 化评价句"与 cal-0036/0037/0055/0058 的 relay gold 共同构成议题③a 的验收用例；cal-0062/0073 构成议题③b 的验收用例；cal-0059/0060 的 advisory 口径转化为议题②的 advisory-only 呈现面需求。
- 本轮全程零生产改动、零开关操作、零 commit；active canary 在特征层修正并重标定通过前保持禁止。
