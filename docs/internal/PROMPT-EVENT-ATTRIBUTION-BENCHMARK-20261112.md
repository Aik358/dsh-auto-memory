# 执行 Agent 任务书：事件归属判定器基准与实验（2.3）

> 初建 2026-11-12（Asia/Hong_Kong）
> 工作目录：`D:/dsh-auto-memory`
> 性质：**只读取证 + 隔离实验/训练；不修改生产代码，不执行真实归并。**
> 目标：用当前事件库与现有日志/账本，建立能验证「这条记忆是否应该归入某个事件」的真实基准，并比较规则、候选召回、融合排序与通用模型裁决，决定是否需要一个可训练的小型判定器。

## 1. 任务背景与当前判定

召回模型不再重新海选。C2 multilingual-e5-small 可先作为**默认召回与语义特征底座**，但它不能独自决定归属。

`ATTR-REALISTIC-20261110.md` 用真实 630 查询复测：C2 top-1=21.7%、top-5=57.1%；早期 63 条精选查询上的 47.6% 与 fields 表示增益不能当生产预期。生产 `memory_log` 已有 L2 top-3/margin/dryRun 候选（`lib/index.js` 当前约 :25136–25208），但候选提示不等于归属判定器已完成。

当前主要缺口：
- 历史 checkpoint 所在的 eventId 不必然是正确归属，只能作弱标签。
- 大型台账事件、共享模板、时间连续性和同文重复记录是主要难点。
- `memory_note` 与 `memory_log` 尚未共享完整的候选/提案协议。
- 真实跨语言归属样本不足；少量受控翻译探针不能冒充真实效果。
- 尚无证据证明 LoRA/E5 微调、CNN 或专用分类头必要。

## 2. 研究问题

依次回答：

1. **正确候选是否进集合**：真实内容、L1 标识、来源与时间证据能否召回正确事件？
2. **候选之后能否判对**：通用语言模型或小分类器能否区分继续已有事件、新建事件和无法确定？
3. **最难样本是什么**：大型台账、同模板跨事件、暂停/关闭、无标识、同文异事、跨语言是否分别构成独立失败模式？
4. **是否需要训练**：融合规则 + C2 候选 + 通用模型裁决若已足够，就不训练；否则先比较冻结 embedding 上的小分类/排序器，再决定是否有必要微调。
5. **生产边界**：任何模型输出能否保持候选/提案而不自动 attach、merge、archive？答案必须保持是。

## 3. 数据范围与隔离

真实数据只能读，不得复制到生产写路径，不得移动、归并或删除原件。

优先来源：
- 当前工作区 `handoff/event-store.json` 的冻结副本；
- 该工作区每日日志、旧 handoff 账本、维护文档与 sourceRef 可验证来源；
- 已存在实验的快照、盲评与自监督包只作历史对照，不能替代本批基准。

开工时：
1. 记录当前 Git HEAD、冻结副本绝对路径、文件字节数和 SHA-256；实验前后源 SHA 不变。
2. 从工作区解析器定位真实根；不得硬编码一个旧事件数、旧碎片数或旧比例当本批事实。
3. 所有产物进入 `artifacts/_event-attribution-benchmark-20261112/`。数据、代码、结果、错误样本和运行日志分别归档。
4. 隔离环境使用独立绝对 `memoryRoot/userMemoryDir`；不得让 `~/...` 或 os.tmpdir 的异常路径回落到生产。
5. 不改 `lib/`、生产配置、宿主 19387；不接 2.4 的 `applyRegroupPre`；不启用生产自动归属。

## 4. 基准任务定义

### 4.1 输入来源与边界

分别标注来源，禁止混为一个分布：
- `memory_log`：真实日志/检查点文本；
- `memory_note(kind=handoff)`：旧账本或当前维护文档的内容片段；
- `memory_note(kind=plan)`：白板变化与事件状态摘要；
- 其他 event 工作：真实状态迁移、文档关联或明确事件引用的文本；
- 构造跨语言样本：单独 `synthetic-translation` 来源，绝不算真实分布。

`memory_event` 的显式 eventId、create/set/close 是已有协议，不得让归属器改写它。`memory_note(kind=note/user)` 若不在事件链中，应标 `not-applicable`，不能强行给它编一个事件归属。

### 4.2 判定标签

| 标签 | 含义 | 禁止误用 |
|---|---|---|
| `attach-existing` | 内容属于一个已存在且可候选的事件 | 不是相似就归属；必须有事件 ID 与证据 |
| `create-new` | 没有既有事件适合，应该新建 | 不能因模型不认识的候选就乱建 |
| `ambiguous` | 多个事件都可能/信息不足，需要人或模型继续判断 | 不得强取 top-1，不得写入 |
| `not-applicable` | 此记录不需要事件归属，或目标已关闭/不可用 | 不能自动改成最近 active |

候选 ID 来自冻结快照中的真实事件。closed 事件不是新写入的可候选目标；paused 的提案须显式标注，不得自动当 active。历史标签与当前协议冲突时保留原文并进入复核，不得自动改库。

### 4.3 金标与证据等级

事件库里“历史曾归入 X”仅是 `historical-weak`。每条记录额外保存：
- `explicit-user`：用户/作者显式指定的真实 eventId；
- `source-linked`：可验证的 sourceRef、文档 eventIds 或来源成员关系；
- `human-reviewed`：人工看正文与候选后确认；
- `rule-supported`：标识、时间、来源、状态组成可复算证据；
- `model-proposed`：仅模型建议，不能升为金标。

同一标签多来源时全部记录。冲突证据不静默择一，标 `needs-review` 并保留双方。测试集优先采用 explicit-user/source-linked + 人工复核；weak 标签只可进入单独的历史弱标签对照组。

## 5. 数据结构

### 5.1 Case schema

```json
{
  "schemaVersion": "event-attribution-benchmark-v1",
  "caseId": "case_...",
  "workspaceKey": "隔离数据集内稳定工作区标识",
  "source": { "tool": "memory_log", "kind": "log", "at": 0, "text": "...", "sourceRef": "...", "language": "mixed", "construction": "real" },
  "candidates": [{ "eventId": "evt_...", "name": "...", "summary": "...", "status": "active", "checkpointCount": 0 }],
  "gold": { "decision": "attach-existing", "eventIds": ["evt_..."], "needsReview": false },
  "evidence": [{ "kind": "human-reviewed", "ref": "...", "note": "..." }],
  "slice": { "size": "large-ledger", "identifier": "present", "language": "mixed" },
  "split": "dev|test|cross-lingual",
  "labelVersion": "人工复核轮次/规则版本"
}
```

`candidates` 必须来自该时刻可见快照，不能引用未来才创建的事件。事件表示不得包含待判 checkpoint 本身；对象级 LOO，不只按可能重复的 at 剔除。

### 5.2 输出 DTO

```json
{
  "decision": "attach-existing|create-new|ambiguous|not-applicable",
  "eventId": "evt_...|null",
  "candidates": [{ "eventId": "evt_...", "score": 0, "evidence": ["semantic", "identifier", "source", "temporal"] }],
  "margin": 0,
  "confidence": "high|medium|low",
  "rationale": "可审计的判据/证据",
  "status": "proposal-only",
  "modelIdentity": "真实引擎 identity",
  "degraded": { "used": false, "reason": "" }
}
```

分数必须按模型与特征分别定义；margin 不得跨模型当固定阈值。DTO 没有任何自动写入权限，不含 apply 令牌。

## 6. 分层、切分与困难负样本

### 6.1 必覆盖切片

- 有/无 issue、task、PR、commit、evt 标识；
- 小事件、11–30 检查点、大型台账事件；
- 继续既有工作、真正的新任务、同主题不同任务；
- 多候选、候选池无正确答案、暂停/关闭事件；
- 同文/同模板的跨事件记录、相同系统错误但不同工作线；
- 中英文同语、中文→英文事件、英文→中文事件、中英混合；
- 缺 goal/state、缺 sourceRef、长正文、无正文和非法结构负路径。

不为凑数生成伪真实样本；构造样本保留来源与生成器版本。

### 6.2 防泄漏切分

- 主 holdout 按 eventId 分组切分，同一事件不跨训练/测试。
- 另设时间前推集：只能使用 case 时刻以前的候选与检查点。
- 跨语言翻译对按原始事件分组，原句和译句不得分跨两侧。
- 去重检查包含正文规范化、近重复和同模板内容；重复族只能在一个 split。
- 发布 split 规则、随机种子、事件数、case 数、标签分布；缺样本的桶报告 0，不伪造。

## 7. 实验臂

| 臂 | 内容 | 要回答什么 |
|---|---|---|
| A | 现有 L1/来源/词法规则 | 无模型基线；强证据的覆盖与误挂 |
| B | 当前 C2 top-3/margin + 候选表示 | 候选召回的真实下限 |
| C | B + 标识、时间、来源、状态、台账去模板与候选融合 | 非神经网络融合有多少真实收益 |
| D | C 的候选交给通用语言模型裁决，含 uncertain | 模型是否能区分归属/新建/不确定 |
| E | 冻结 C2 embedding + 可复算特征的小分类/排序器 | 小型训练是否有增益，不是默认要做 |
| F（条件） | E5 局部/适配器微调 | 仅 E 有增益且仍不足时另行评估；不是本任务默认步骤 |

C/D/E 必须与 A/B 同 case 比较。每个学习器记录模型身份、训练特征版本、随机种子、训练/验证/测试边界与推理耗时。不得将 sklearn/自评分器阈值调优写成 LoRA 或基础模型微调。

## 8. 通用模型裁决 Prompt 基准模板

以下模板交给真实通用模型执行；候选与证据由结构化输入注入。它是评价对象，不是直接落盘工具。

```text
你是事件归属裁决器。任务不是按文本相似度猜测，而是判断这条新记录与候选事件是否属于同一工作目标。
输入包含：记录来源/时间/正文、候选事件的 name/summary/状态/允许的证据片段、标识与来源匹配、候选排序分数、候选时间关系。
只输出符合给定 schema 的 JSON：
- attach-existing：证据支持一个真实候选，返回其 eventId 和证据；
- create-new：现有候选都不适合，返回 eventId=null；
- ambiguous：多个候选或证据不足，eventId=null，保留候选；
- not-applicable：该记录不需归属或目标不可用。
不得创造 eventId，不得因相同错误文本/模板头直接合并，不得使用正文之外的隐藏历史，不得执行写入、归档、合并。
输出 rationale 必须引用已给证据；无法给出证据就降为 ambiguous。
```

运行真实模型时记录实际 provider/model 标识、提示词版本、原始输出、解析错误与重试，不把一次结果写成稳定模型行为。

## 9. 指标与验收

分别报 micro、macro（按事件）、按切片、按语言、按来源、按事件规模：

- attach 的准确率、误挂率、候选 top-3/top-5 覆盖；
- create-new 的准确率与“把应归属误新建”比例；
- ambiguous 的覆盖率/选择风险曲线；
- not-applicable、closed、越界 ID 的拒绝率；
- 多候选冲突与同文异事的错误数；
- 跨语言相对同语表现，构造样本与真实样本分开；
- 延迟、向量复用、内存/磁盘与降级成功率；
- 隔离实验前后真实源文件 SHA-256 不变。

不设“2.3 必须自动归属”的反向目标。即使候选覆盖不足，也允许只交付候选提示与提案。任何自动 attach/merge/archive 的放行均需另行明确裁定。

### 通过/停止条件

- 基准自身：输入、标签、切分、来源证据均可追溯；负样本有区分力；无未来信息泄漏；零真实写入。
- 候选/裁决可用：在同一真实 holdout 上优于 A/B，并在关键切片报告中展示增益来源，不能只报一个总分。
- 小分类器：相对 C/D 有稳定收益且可按 identity 重建/失效，才进入候选实现讨论。
- 微调/CNN：无 A–E 证据不得直接开工。
- 生产：基准通过不等于 HOST 验证通过，不自动改配置、不迁移、不发布。

## 10. 交付物

1. `docs/internal/RESULT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`：方法、数据量、指标、错误分析、采纳/否决与未测边界。
2. `artifacts/_event-attribution-benchmark-20261112/`：冻结清单、case schema、split manifest、运行脚本、原始输出、错误样本与日志。
3. 每个主方法给出真实调用/真实模型证据；没有真实模型或人工标注的部分明确标未验证。
4. 给出最小下一批实现建议与回滚边界；不得修改 2.4 或 SidecarStore 的生产路径。

## 11. 停止条件与纪律

- 源文件发生变化、真实根不可确定、隔离路径越界：停止，不拿不完整数据冒充完整基准。
- 发现标签错误：保留冲突，重新标注或剔除该 case，不修改历史事件库。
- 英文/跨语言真实数据不存在：写 0，使用独立构造组，不声称真实准确率。
- 数据不足：停止训练，不交低证据分类器。
- 不用源码字符串当功能验收；每条能力有真实调用、负路径与可复算物理量。
- 不覆盖或清理其他实验/未跟踪文件；不删共享 artifacts 目录。
- 本任务书只授权隔离研究，不授权生产接入、2.4、SidecarStore 接线、生产开关、发布或 push。
