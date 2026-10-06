# R2：JS Policy Plumbing 实施蓝图（2026-08-26 用户批准启动）

> 状态：**规划阶段**——用户已确认 R2 启动（「既然现在基本都OK了，那我们就往R2往上走着」），
> 本文是设计基线。**尚未动代码**；待用户终裁范围/默认值后实施。
> 权威范围：docs/M7-ACTIVATION-V2-HANDOFF.md §第二轮（PII 三档硬过滤 / cross-workspace relay /
> append-only policy registry / 文件审批队列写回）；与第一轮（Python feature v2）不得混合。

## 0. 用户裁定（本轮核心，完整结构必须保留）

**「跨工作区 → 让用户选择是 A 还是 S」**
- 前半句 = 适用场景：跨工作区样本（命中当前工作区之外的记忆）。
- 后半句 = 处理方式：由用户开关决定 Activate 还是 Suppress（per-case）。
- 出处：heldout 批次 hd-048/049 rawChoice 原文「跨工作区让用户选择是A还是S。」（deferred）；
  label-review 批次 cal-0036/0037/0055/0058 = P（advisory，「反正做后注入是建议性的」）；
  hd-021/023 用户 override suppress→activate（宽松立场）。

## 0b. 用户对 R2 默认值的两条修订意见（2026-08-26，原文钉住，实施时必须遵守）

**① 隐私/PII 与 relay 的最终决定权在用户，不在默认值。**
「密钥、证件号这一类的数据，进不进语料库肯定还是要由用户来决断的。用户觉得自己的隐私可以进本地库，那就让他写进去；如果用户觉得不进本地库，那就不进。cross workspace relay 这个也是同理。」
→ 含义：PII 三档过滤的「high 剔除」不是硬规则，而是**每类敏感数据一个用户可决断的开关**（默认可给保守值，但用户可逐项放行/禁止进本地语料库）；relay 同理（off/advisory 只是初始值，最终由用户逐条/逐类决断）。R2 必须把「用户决断权」设计成显式可配置项，而非写死的策略。

**② append-only policy registry 需与分层记忆机制协调，并前瞻存储管理。**
「append-only policy registry，我觉得可能还要跟着我后面提到的记忆机制——即 3 层记忆、长期记忆（memory）等多次分层记忆的相关内容来协调。当然，我觉得在本项目中，这个记忆机制确实是可以实现 append only，但是同时，这个存储空间可能会有一定的挑战，所以后续的这些存储管理功能可能也需要去做一些工作。」
→ 含义：(a) registry 不能孤立设计——它与 M8/M9 的 3 层记忆（working/short-term/长期）/ 用户画像 / 长期记忆的分层体系耦合，未来这些层也要 append-only 留痕；(b) append-only 在本地可行，但**无限增长有存储成本**——R2 就要为「存储管理」（保留策略/合并/压缩/归档/迁移）预留机制，不能只做无限追加。R2 的 registry 设计需与分层记忆模型对齐，并含存储治理。

## 1. R2 四大件（按 HANDOFF 顺序）

### 1a. PII 三档硬过滤（index_sync / context_push 前置）
- 三档：`high`（凭据/密钥/证件号）/ `medium`（手机号/邮箱/地址）/ `low`（姓名/昵称）。
- **2026-08-26 修订（用户决断权）**：三档不是「high 一律剔除」的硬规则，而是**每档一个用户开关**：
  `allowInCorpus: true/false`（用户认为隐私可以进本地库就放行，否则不进）。默认给保守值（high=false /
  medium=false / low=true），但用户在设置里可逐档决断；放行后该档内容可进语料库，但 context_push 前
  仍带 piiClass 标记（advisory 注入时降级）。
- JS 权威层实现（index-sync-pre 投影前 / context-host 组装前）；Python 只读显式下发的 piiClass 字段，
  缺失即 fail closed（沿用现有 features.piiClass='unknown' 通道）。
- 分类器：冻结词典+正则（不引入模型），先覆盖 zh 常见模式；全部命中需过黄金样本验收。
- 边界：PII 决断只影响「自动唤起」，不拦截「显式 memory_recall」；用户手动检索自己的记忆不受限。

### 1b. cross-workspace relay（用户开关）
- 设置项（semantic 分组）：`crossWorkspaceRecall: 'off' | 'advisory'`（默认 off，用户可一键开；
  **2026-08-26 修订：最终决定权在用户——off/advisory 只是初始值，用户可逐条/逐类决断 A 或 S**）。
- 语义：off = 现状（当前工作区库内检索，跨工作区候选直接 dropped）；advisory = 跨工作区候选并入排名，
  但 **level 降为 hint 且标记 advisoryOnly**，注入用建议性语气，「仅供参考」不打断当前任务；命中跨工作区
  记忆时，决策行输出 `requiresCrossWorkspaceRelay: true`。
- 候选来源：Python dense_search 当前按 workspaceKey 过滤 → relay 开启时放宽为「当前工作区 ∪ 全工作区
  User 级记忆 ∪ 显式允许的 Workspace 级记忆」，但**注入侧仍由 JS 门控**（身份/PII/抑制名单）。
- 与 hd-048/049 的呼应：开启后这类「跨工作区但用户想知道的」从 suppress 变为可选注入；per-case
  仍可走精修面板 A/P/S 覆盖。

### 1c. append-only policy registry（**2026-08-26 修订：与分层记忆协调 + 前瞻存储管理**）
- 位置：`~/.dsh/memory/policies-registry/` 或沿用 `python/policies/` 的 append-only 模式（决策记录已有
  先例：decision-record-*.json）。每条记录：parentPolicyVersion + diff + goldDigest + runId + createdAt +
  生效范围。目标是任何策略变更可追溯、可回滚。
- **与 M8/M9 分层记忆协调**：registry 不能孤立设计——未来 3 层记忆（working/short-term/长期记忆）、
  用户画像、长期记忆都会有自己的策略与生命周期；registry 的 schema 需预留「分层/来源」维度，
  使各层记忆的策略变更共享同一 append-only 留痕机制（parent 链可跨层追溯）。
- **存储治理（用户明确要求前瞻）**：append-only 在本地可行，但无限增长有存储成本。R2 需为存储管理
  预留机制：保留策略（按层/按类型 TTL 或体积上限）、可重建派生物标记（如聚合/索引可重建，原始事件
  可归档）、压缩/合并（对可归并的决策记录做有损合并，保留 diff 摘要与 goldDigest）、归档/迁移（旧记录
  移冷存）。**明确不删原始策略变更**（append-only 语义），但通过归档/合并控制热体积。

### 1d. 文件审批队列写回
- 已有基础：`POST /api/dsh-auto-memory-pre/review-feedback` append 到
  `~/.dsh/memory/semantic-pre/review-queue.jsonl`（append-only，A/P/S/H/E 落盘）。
- R2 补：审批队列消费端——用户确认某条后写回「策略覆盖」（per-memoryId 允许/禁止自动唤起），
  写入 append-only 覆盖表；fv2 决策读覆盖表（JS 前置层），与现有抑制名单同路径。
- **与用户决断权一致**：覆盖表即用户逐条决断的落点；relay/PII 的逐档决断也落这里。

### 1e. 项目文档总览（用户可读的功能/指导入口；2026-08-26 用户要求）

- **需求原文**：「这个项目已经越来越复杂了，结束后一定要在设置里加上项目文档的内容，让用户能够看到所有的功能和指导。」
- 形态：设置页新增「项目文档/关于」入口（区别于现有 settings 分组的只读说明），以可滚动、可搜索的卡片/章节列出**全部功能与指导**——当前生效的检索档位/资产状态、M0-M7 各里程碑做什么、语义引擎安装与切换、跨工作区与 PII 决断开关、精修面板 A/P/S/H/E 用法、R2/未来分层记忆路线、常见问题与安全说明（记忆不出电脑等）。
- 内容源：从 docs/ 下的权威文档（PROJECT-FREEZE-AND-ROADMAP、各 M*-CONTRACT、R2 蓝图等）提取**面向用户的语言**（非实现细节），维护成一份随插件发布的 `docs-user` 数据（结构化为 section:title/content 便于 client.js 渲染）。
- 时机：**发布工程窗口**实现（与 npm 资产包、安装向导一起），但需求本身现在定稿；R2 实施时一并规划数据源与渲染接入点。

## 2. 依赖与顺序

1. 1a（PII 过滤）必须最先——它是 relay 的合法性前提（跨工作区先保证不带 PII）。
2. 1b（relay）依赖 1a + 现有 workspaceRef 过滤链改造。
3. 1c（registry）是发布工程地基，可与 1a 并行。
4. 1d（审批写回）依赖 1b 的 advisory 通道 + 精修面板（已有）。

**不动的**：M5/M6 validator/Reference Tail/seen；fv2 阈值策略工件（configHash 不变）；
worker 的 requiresRelayFlag 由 JS 下发真实值替代硬编码 False。

## 3. 验收要点（R2 完成门）
- PII：构造三档黄金样本，index_sync 前后断言 high 被剔除、medium 被标记、low 可入候选。
- relay：开/关两态下，跨工作区候选的决策行 requiresCrossWorkspaceRelay 与 level/advisoryOnly 符合预期；
  开关一键生效（设置页）。
- registry：变更记录 append-only、可追溯 parent+diff+goldDigest。
- 审批写回：review-queue 消费 → 覆盖表 → fv2 决策读覆盖表（一条 A 覆盖生效）。

## 4. 待用户终裁
- ~~PII 三档分类器~~ → **已定**：冻结词典+正则（零模型成本）。
- ~~relay 默认值~~ → **已定方向**：off 为安全初始值，但最终决定权在用户（逐档/逐条可决断）。
- ~~registry 位置~~ → 倾向沿用 python/policies 的 append-only 模式；与分层记忆协调后定。
- ~~审批写回粒度~~ → 倾向 per-memoryId；与用户逐条决断一致。
- **新增待定**：PII/relay 的用户决断开关放设置页哪个分组；存储治理的保留/归档阈值初始值。
