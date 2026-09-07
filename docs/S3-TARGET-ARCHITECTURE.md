# S3：目标架构 —— 分层契约与拟人化定位

> 写于 2026-09-06。上位：[NEXT-MAJOR-VISION.md](NEXT-MAJOR-VISION.md)（愿景权威）、[S1-SCIENTIFIC-RIGOR.md](S1-SCIENTIFIC-RIGOR.md)、[S2-DEEP-ABSORPTION.md](S2-DEEP-ABSORPTION.md)。
> 本文回答四个定位问题：①全貌是否应为文件系统架构；②唤起算法是否有更优者；③认知科学分类如何替换；④MemOS / Second Me 与拟人化愿景的关系。

---

## 1. 分层契约

系统自顶向下分为六层，每层职责单一、依赖单向（上层依赖下层，下层不感知上层）。

| # | 层 | 职责 | 现状 | 借鉴来源 |
|---|---|---|---|---|
| L1 | **激活决策层** | 观察情境 → 判定 *whether to inject*（是否该打断、注入什么、注入多少） | **已落地且领先** | 原创 |
| L2 | **上下文分层** | 记忆的 L0/L1/L2 表示 + 固定边界注入 + 前缀缓存纪律 | 部分（注入形态三级，缺 L0/L1 表示与 token 账本） | OpenViking |
| L3 | **检索三引擎** | C1 BM25 保底 → C2 e5-small q8 → C3 bge-m3，多臂融合 | **已落地**（融合层待修，见 S2 问题 4） | — |
| L4 | **记忆命名空间** | `dsh://` URI 统一寻址，目录递归检索，先定位分组再下钻 | 部分（文件已分层，缺 URI 与 L0/L1 sidecar） | OpenViking |
| L5 | **巩固引擎** | 证据 → 观察的周期性综合；矛盾打时间标记而非覆盖 | 弱（有沉淀与蒸馏，缺认识论分层与矛盾语义） | Hindsight |
| L6 | **元记忆层** | 学习 *how to use* 检索所得，符号化规则库 ADD/MOD/DEL | 无 | MetaMem |

**关键判断**：L1 是本项目唯一的原创层，也是唯一在五个对标项目中**找不到对应物**的层。OpenViking / Hindsight / Mem0 / Zep 全部优化 *what to retrieve*（给定查询下的检索质量）；本项目优化 *whether to inject*（无显式查询时是否该打断）。这一层应保持独立演进，不因借鉴而被稀释。

---

## 2. L4：文件系统架构 —— 采纳，但**只需显式化，不必重构**

### 2.1 现状评估

本项目的存储**天然就是文件系统**：`~/.dsh/memory/MEMORY.md`、`workspaces/{ws}/MEMORY.md`、`YYYY-MM-DD.md`、`reflections/`、`handoff/`。与 OpenViking 的差距不在存储介质，而在三处**未显式化**：

| 缺失项 | 影响 | 改造成本 |
|---|---|---|
| **URI 命名空间** | 引用只能靠文件路径字符串；M-CM2 的 provenance 与 M5 cite 缺少稳定标识 | 低（纯约定 + 解析函数） |
| **L0/L1 sidecar** | 判断相关性必须读全文，无法先便宜筛选 | 中（写入时生成摘要） |
| **目录级 L0/L1** | 无法在读取前判断某工作区/时段是否值得下钻 | 中 |

### 2.2 采纳方案

```
dsh://user/prefs/{key}                    用户级规则与偏好
dsh://ws/{workspace}/notes/{topic}        项目笔记
dsh://ws/{workspace}/log/{YYYY-MM-DD}     每日日志
dsh://ws/{workspace}/reflect/{YYYY-MM-DD} 每日反思
dsh://ws/{workspace}/handoff/{ts}         交接账本（M-CM1）
dsh://ws/{workspace}/PLAN                 交接白板（M-CM1）
dsh://ws/{workspace}/skills/{id}          固化技能
```

配套三条纪律：
1. **URI 是引用标识，不是存储路径**——物理布局可变，URI 稳定。
2. **每条记忆的 L0（~100 tok）随写入生成**，L1（~2k）按需生成；L2 为原文。
3. **检索先定位目录（工作区 / 时段 / 类型），再逐层下钻**，保留浏览轨迹供审计。

**明确不做**：不为对齐而重写存储层。现有 Markdown 文件布局已经正确，只需在其上加寻址与摘要两层。

---

## 3. L5：认知科学分类 —— 从"内容分类"转向"认识论分类"

### 3.1 现行分类（episodic / semantic / procedural）的缺陷

该分类源自 Tulving (1972) 的经典三分，本身并非"饱受批评"，但其为**描述性分类（taxonomy of content）**——回答"记忆是什么"，而非**功能性分类**——不回答"如何存取、如何巩固"。三个工程后果：

1. **边界模糊**：「用户决定采用 PostgreSQL」既可归 semantic（事实）又可归 episodic（事件），分类无法判定。
2. **不指导存取策略**：三类之间没有不同的读写语义，分类退化为标签。
3. **不定义转化条件**：episodic → semantic 的迁移条件未形式化，只能靠启发式。

### 3.2 Hindsight 的分类为何更优

Hindsight 的 `world / experience / observation` 是**认识论分类（epistemic classification）**——按**可推导性与可变性**划分，而非按内容：

| 类别 | 认识论地位 | 工程语义 |
|---|---|---|
| `world` / `experience` | **证据**（不可推导） | append-only，强写入门禁，永不自动删除 |
| `observation` | **推断**（可由证据重算） | 允许 consolidation 重写/删除，可重算 |

此分类**直接映射工程策略**：证据只增不改；推断可重算。这是功能性分类的核心价值——分类本身携带了操作语义。

### 3.3 建议：正交三维取代单一三分类

保留存储层分层（用户级/项目/日志/反思，即作用域），在其上叠加两个正交维度：

| 维度 | 取值 | 来源 | 作用 |
|---|---|---|---|
| **作用域** scope | `user` / `workspace` / `session` | 已有 | 决定隔离与共享 |
| **认识论地位** status | `fact`（证据）/ `observation`（推断）/ `directive`（行为指令） | Hindsight | 决定可写性、可删性、可重算性 |
| **稳定性** stability | `volatile` / `stable` / `superseded` | Hindsight trend + 现有 supersede | 决定注入优先级与蒸馏策略 |

**关于 procedural（技能）**：它不是第三类记忆，而是 `directive`（行为指令）——Hindsight 亦将技能归入 mental model / directive 而非独立记忆类型。**此归并保留本项目的技能固化特色，同时消除分类歧义**：技能 = 由重复成功证据推导出的行为指令，`status=directive`、`stability=stable`，跨会话验证数即其证明强度。

**迁移策略**：三维为**增量元数据**，不改动现有文件布局。先给新写入打标，存量按规则回填（日志→`fact`+`volatile`，项目笔记→`observation`+`stable`，技能→`directive`+`stable`）。

---

## 4. 拟人化愿景：定位与参照

### 4.1 本项目的拟人化是"第二人称"，与 Second Me 根本不同

| | Second Me | 本项目 |
|---|---|---|
| 人称 | **第一人称**——AI 成为"你"（数字分身、身份复制） | **第二人称**——AI 是"记得你的同事" |
| 技术路线 | 参数化（SFT + DPO 把个人知识训进权重） | 外置结构化记忆 + 情境唤起 |
| 结局 | **已停摆 11 个月**（见 S1 §4） | 活跃 |

**结论**：Second Me 的**愿景**（拟人化身份）成立，失败在**技术路线**（参数化微调不可增量、不可调试、成本收益失衡）。本项目的"她"与之共享愿景动机，但走了相反且正确的技术路线——**不应因 Second Me 失败而否定拟人化方向本身。**

### 4.2 MemOS 对应基础设施愿景，不对应拟人化

MemOS 的隐喻是**操作系统**（记忆作为一等系统资源），属工程治理视角。其对本项目的价值仅在两点：
- **MemCube 的治理属性**（provenance / 版本 / 过期 / 访问权限）——直接支撑 README「她怎么让你放心」的可审计承诺；
- **MemScheduler 的生命周期调度**——与稳定性维度（`volatile/stable/superseded`）的自动迁移相关。

**不取**：MemOS 的参数化记忆（LoRA 至今仍为 placeholder，见 S1 §1.2）。

### 4.3 拟人化的三个可工程化维度

README 的叙事（"她"、问候、骑自行车、交接）需有技术支撑才不沦为包装。建议形式化为三维度并各自设可测指标：

| 维度 | 内涵 | 现状 | 可测指标 |
|---|---|---|---|
| **连续性** Continuity | 跨窗口 / 跨会话 / 跨工具不断线 | 强（M-CM + 外部继承） | 窗口切换后任务恢复成功率 |
| **可问责性** Accountability | 每条记忆有出处，可查可改可删 | 强（evidence 链 + 唤起回顾五档） | 唤起决策的可解释覆盖率 |
| **分寸感** Appropriateness | 知道**何时不该说话** | 中（有 cooldown / user-ignored，未形成学习闭环） | 用户忽略率、误注入率 |

**第三项是最能拉开拟人化差距、且当前最薄弱的一项。** 现有 `user-ignored` drop reason 已记录用户忽略行为，这是**现成的负反馈信号**，可支撑分寸感的学习闭环（见 §5.2）。

---

## 5. L1 唤起算法：横向定位与补强

### 5.1 结论：方向上没有更优者，但缺一个维度

现有对标（OpenViking / Hindsight / Mem0 / Zep / MemOS）**全部为查询驱动的被动检索**，无一家实现"无查询、情境驱动、开口前注入"。本项目的唤起方向在公开项目中无更优替代。

与最接近的学术工作对比——*Generative Agents* (Park et al., 2023) 的 memory stream 采用三维评分：

$$\text{score} = \alpha \cdot \text{recency} + \beta \cdot \text{importance} + \gamma \cdot \text{relevance}$$

对照本项目 `shadow-retrieval-pre.js`：

| 维度 | 本项目 | 差距 |
|---|---|---|
| relevance（相关性） | 强（BM25 + 语义 + 短语 + 标题覆盖） | — |
| recency（新近度） | **弱**——仅 `workspace-log` 计算（S2 问题 3） | 需扩至全记忆层 |
| **importance（重要性）** | **缺失** | 需新增 |

**importance 是最值得补的一维**：它不随查询变化，是记忆自身的属性（用户显式 pin、跨会话复现次数、被引用次数、是否承载决策），天然适合作为**绝对量**参与门控——恰好可缓解 S2 问题 4 中"分数丧失绝对性"的困境。

### 5.2 补强项（按 ROI）

1. **引入 importance 维度**：`importance = f(pinned, 跨会话复现数, 被引用数, 是否决策)`，作为绝对量参与门控，与相对融合分解耦（呼应 S2 问题 4 解法）。
2. **负反馈学习闭环**：`user-ignored` / `emitOnSuppress` 等 drop reason 已是标注数据，可驱动门控权重的离线再标定（沿用 M7 的 held-out + 配对 bootstrap 口径）。
3. **唤起的节律**：人类记忆唤起有间隔效应；现有 `cooldownSegments` 是固定冷却，可考虑按记忆的 stability 动态调整（stable 记忆冷却更长，volatile 更短）。

---

## 6. L6 元记忆层：MetaMem 的接入方式

**定位澄清**：MetaMem **不优化检索本身**，它优化的是"检索结果被如何使用"。对本项目的价值在注入之后，而非检索之前。

**轻量落地**（无需完整训练循环）：

1. 以自然语言规则库形式初始化（可手工撰写 10–20 条，例如「冲突时优先最新」「汇总数值优先用显式结论而非分段累加」）。
2. 每次唤起后，若发生可观测失败（误注入、用户忽略、证据冲突未处理），触发一次自反思，产出 `ADD / MOD / DEL` 提案。
3. 用既有 67 条人工金标 held-out 做提案过滤与效果验证——**这与 M7 的评估通路天然复用**，边际成本极低。
4. 规则库设容量上限（MetaMem 论文指出过度训练会积累冗余规则并损伤泛化，S1 §5 已记录）。

---

## 7. 一句话

**文件系统是骨架（L2/L4），巩固是代谢（L5），元记忆是反射（L6），而唤起决策（L1）是这套系统唯一的"性格"所在——前者都可借鉴，后者只能自己长。**
