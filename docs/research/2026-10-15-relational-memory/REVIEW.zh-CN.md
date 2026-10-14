# 面向持续人机交流的情境化主动记忆

## 宿主侧记忆使用政策的概念综述与研究议程

**Context-Conditioned Proactive Memory for Sustained Human–Agent Interaction: A Conceptual Review and Research Agenda for Host-Side Memory-Use Policies**

**文稿类型：** 概念综述与研究议程（叙述性／范围式文献综述，不宣称系统综述）  
**日期：** 2026-10-15  
**状态：** 下一阶段研究基线；本文提出待验证的理论与架构，不代表关系型记忆功能已实现或用户体验效果已得到本项目验证。

## 摘要

长期 Agent 的记忆价值取决于相关性，也取决于当前交互目的、用户授权和双方共同历史。对编码任务有用的内容可能是闲聊中的干扰；一段共同经历则可能不直接回答问题，却帮助理解当前表达。准确的记忆也可能被不合时宜地披露。因此，记忆系统需要分别回答：找到了什么，是否应该送入模型，如何要求使用，以及是否适合向用户提起。

本文综合长期对话记忆、情感主动检索、策略性记忆使用、关系型 Agent、人格一致性与记忆治理研究，提出“**情境化主动记忆使用**”框架。它区分用户事实、Agent 行动史、共同经历和关系约定，并把工作、助理、开放交流和情绪支持视为可并存、可切换的目的。投递、使用框架、显式披露、介入时机和存储生命周期分别控制、分别评测。该方向已有直接先行研究与基准；本文的贡献是面向宿主侧中间件的概念组织和验证议程，不主张优先性。

项目案例来自 dsh-auto-memory：8 月 19 日的报告定义了宿主侧主动联想的运行时边界，M7 实验为检索相关性与唤起必要性的分离提供了受限证据；这些结果尚未证明关系体验改善。本文据此提出六个研究问题、分层指标、固定候选的析因实验、端到端政策比较和纵向验证路线。核心命题是：**记忆应以当前交互中的适切用途为评价单位；找到、送达、使用、提及和被用户接受，需要各自的证据。**

**关键词：** 主动记忆；人机关系；关系型记忆；情境化召回；记忆披露；长期对话 Agent；记忆治理；主体连续性

### English abstract

Proactive memory is a decision about whether, how, and when remembered information should shape an interaction. This conceptual review examines long-term dialogue memory, strategic memory use, relational agents, reciprocal disclosure, persona consistency, and memory governance. Existing studies already address affective proactive retrieval and relationship-relevant outcomes; this paper makes no priority claim. It proposes a host-side, context-conditioned memory-use framework that separates retrieval, activation, response influence, explicit disclosure, and lifecycle governance. Task assistance, practical support, and open-ended exchange are treated as overlapping interaction purposes. The dsh-auto-memory project supplies a design lineage and bounded retrieval/activation evidence, while relational benefits remain untested in the project. The review develops falsifiable questions, controlled component-wise comparisons, and a longitudinal evaluation agenda connecting observable memory operations to task quality, perceived understanding, continuity, intrusiveness, and user control.

---

## 1. 问题从“记起来”走向“共同生活史如何参与回应”

用户没有要求时，系统能否自己找到相关记忆，是主动记忆的基础问题。但“主动”并不自动意味着“有帮助”。检索出来的内容可能只是话题相似；它可能过时、敏感、重复，或不适合被说出口。反过来，一段与当前字面话题不相似的共同经历，也可能帮助系统理解用户的表达方式、未说完的目标或当前情绪。

因此，需要把“记忆有用吗”改写成更精确的问题：**对谁、在什么交互目的下、以什么介入方式、在多大程度上有用？** 这里的“交互目的”不是单一标签。一次对话可以同时包含办事、协商、闲聊和情绪支持；目的可以在多轮中变化，系统也可能识别错误。合理的记忆策略必须能承认混合状态和不确定性，而不能把“工作”与“陪伴”固化为两个互斥人格。

本文使用“关系”指参与者在多轮交互中形成的可观察历史、期待、承诺、纠正和边界，不据此断言 Agent 有主观体验或意识。“主体连续性”在本文中也只指可检验的用户感知与行为连续性：例如，在更换底层模型后，用户是否仍能辨认出相同的记忆来源、互动约定与共同历史。它不是关于数值身份或意识连续性的形而上学结论。

这一问题可以由一个简单对照说明。同一条“上周用户因为过敏取消了徒步”的记录，在计划徒步时可能是直接有用的个人事实；在用户只是在谈代码时通常是无关的；在长期关系中，如果用户提到“又得改计划了”，它可能帮助理解语境，但也未必应被直接说出来。候选记忆相同，适宜动作却可能不同：静默调整建议、问一句是否还受过敏影响、显式提起旧事，或完全不使用。

这使研究目标从“增加召回率”转为一个多阶段决策问题：**召回什么、是否让它影响回答、如何影响、是否要告诉用户、以及用户能否检查和改变这个过程。**

本文的贡献是三项研究设计：把“记忆有用性”明确写成依赖交互目的的判断；把记忆送达、实际使用和对用户披露分开，避免以一项检索成绩代表整个过程；将这些决策放到可审计的宿主中间件中，提出跨情境、分组件的实验路线。这些贡献是概念组织和验证议程，后续实验应检验其增量价值。

## 2. 范围、综述方法与概念边界

### 2.1 综述范围

本文关注四个交叉领域：

1. 长期对话 Agent 的跨会话记忆、时间推理与记忆基准；
2. 社交聊天机器人和关系型 Agent 的长期交互、身份感、信任及用户披露；
3. 记忆在回应中的主动使用、显式回指、话题重启与披露策略；
4. 记忆治理、可解释性、隐私、纠错、过期和可控遗忘。

本文也考察可移植的模型外宿主中间件和具身 Agent 记忆作为系统边界与远期扩展。它不试图综述所有 Agent 记忆算法，也不以“人格”作为已经统一定义或能被单一指标测量的心理构念。

### 2.2 检索和选择说明

本文是**范围式、问题驱动的叙述综述**，不是 PRISMA 意义上的系统综述。检索与核对优先使用 ACL Anthology、ACM Digital Library、AAAI、PMLR、arXiv、作者／研究组页面，以及项目中可复核的原始报告；重点纳入长期记忆、关系体验、主动对话、用户回忆披露与评测工作。对 2026 年新近文献，记录版本、发表状态和研究类型，避免把预印本、架构案例和用户实验混为一谈。本文截至 2026-10-15；后续投稿前需按目标会议／期刊要求补做可复现的数据库检索、纳排标准和引用更新。

这一路径适合为下一阶段确定问题和研究议程，但不能支持“穷尽所有相关文献”或“证明没有先行工作”的结论。本文将每篇工作的研究对象、方法和证据边界分开描述。

### 2.3 术语：四类记忆与五个决策阶段

本文提出四类可交叉的记忆对象：

| 类别 | 操作性含义 | 例子 | 关键治理问题 |
|---|---|---|---|
| **用户记忆**（user memory） | 关于用户的偏好、经历、事实、目标与明确要求 | 用户不吃某种食物；项目约束 | 来源、时效、纠错、敏感度、作用域 |
| **Agent 自传记忆**（agent autobiographical memory） | Agent 先前经历、可追溯的行动与曾作出的回应 | Agent 上次建议了方案 B，后来被证伪 | 必须区分真实交互记录与生成式虚构背景 |
| **共同／关系记忆**（shared / relational memory） | 双方共同参与、确认或共同修订的事件与理解 | 一起完成了某项目；用户纠正了某项长期误解 | 双方归属、不同视角、同意与删除权 |
| **关系约定**（relational commitments） | 明确承诺、互动边界、尚未解决的事项 | Agent 承诺下次先验证再建议；用户不希望主动提某话题 | 权威、履约状态、撤销与冲突处理 |

这是一种面向系统设计的分类，不要求每条记录归入唯一类别，也不把“自传记忆”等同于人类自传式记忆机制。它将“记得用户什么”“Agent 做过什么”“我们共同经历了什么”“双方约定了什么”分开，避免把关系简化成更密集的用户画像。尤其是 Agent 自传式记忆，必须标注它是历史交互证据还是生成性角色设定；两者在叙事上可能相似，在证据地位上不同。

在计算链路上，本文区分五个阶段：

1. **候选检索**：哪些记忆与当前上下文、目标或关系事件可能有关？
2. **激活／投递资格**：候选记忆是否允许并值得进入本次模型请求？
3. **模型可见暴露与使用**：记忆是否真的进入请求；回答是否忠实、适当地利用了它？
4. **用户可见披露**：回答是否显式回指、向用户确认或选择不提？
5. **记忆治理**：用户如何查看、纠错、限定用途、撤回或删除；系统如何记录后续反馈？

此外，投递策略、使用指示、披露许可、介入时机和存储生命周期是**彼此正交的控制维度**，不能混成一个动作分类。把这些阶段统称为“召回”，会使指标失去解释力。检索到不等于应该使用；策略准许投递不等于记忆实际进入请求；进入请求不等于回答忠实使用；用户觉得回答温暖也不等于记忆事实准确。

## 3. 8 月 19 日到 M7：本项目的技术基线与证据边界

### 3.1 8 月 19 日：把运行时主动性变成可判定机制

项目 2026 年 8 月 19 日的[基础报告](../../proactive-associative-memory-research-report.zh-CN.md)提出：记忆层位于模型和 Agent loop 外部，观察可见运行时上下文，不等待模型显式调用记忆工具，在下一次模型请求形成前生成受控记忆包。它将这一机制与工具式检索、每轮结束后的自动保存／召回区分，并讨论预算、来源、生命周期、会话隔离和治理。

这篇报告的作用是建立**设计基线和研究议程**。原稿明确说明它不代表所有设计已经落地，且创新表述应限于系统组合与运行时机制，不能未经系统检索宣称世界首创。本文承接这条线索，但更换了研究终点：除了“宿主如何让记忆在下一请求出现”，还要问“不同交往目的下，记忆何以参与回应，以及介入是否被用户接受”。

### 3.2 M7：检索相关性和唤起必要性不是同一指标

项目的检索选型研究将 BGE-M3、分块与词法／稠密／融合通道放入受控合成语料和作者来源的真实开发者记忆语料中比较。真实层包含 251 个 episode 和 40 条人工查询；例如 BGE-M3 para-512 的 R@5 为 0.925、MRR 为 0.793。该结果支持的是指定语料、查询集和配置下的检索表现，不能推导成陪伴体验或关系效应。报告其他部分还给出不同融合配置的成绩，故引用单个数字时必须注明通道、权重、语料和分割。

更直接的理论桥梁来自[激活策略研究](../../M7-ACTIVATION-V2-PAPER.md)：它把语义相关性定义为候选材料与当前话题的接近程度，把唤起必要性定义为现在注入是否能实质帮助当前任务且不打扰用户。报告以“回声陷阱”展示了高相似闲聊可被误判为激活，并使用同一记忆在不同意图下构造反事实标签。它的重要贡献不是证明陪伴 Agent 应该更频繁回忆，而是显示“像不像”与“现在该不该影响回答”应分别判断。

### 3.3 现有数字能说明什么，不能说明什么

该激活报告的 86 条人工金标来自单一作者／用户域，并存在同集选工作点带来的选择偏差。正文报告的保守工作点为 11 次 emit 全正确、precision 1.000、recall 0.289；文档摘要中另有早期工作点数字，发表前需按版本统一。后续[67 条离线留出评测](../../M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md)报告 12 次 emit 中 11 次正确（precision 0.917），但其中存在独立与重叠子集，危险样本缺失，主动通道当轮也按设计不 emit。此数字是冻结策略的离线评分，不是 67 次真实交付，更不是用户偏好胜率。

真实宿主的[受控 shadow 报告](../../M7-ACTIVATION-V2-CONTROLLED-SHADOW.md)记录 20 条脚本请求、94 个边界观测，初轮因过宽 stale 门导致 94/94 suppress；该报告后续记录了修复和进一步的生产候选供给／离线验收口径不一致。shadow 的目标是观察而不投递，记录中无 Reference Tail、无 delivered、无 seen。因此它证明了 shadow 能暴露集成缺陷与保护用户免受未经验证的注入，不能证明主动召回已提升真实回答。

[S3 架构文档](../../S3-TARGET-ARCHITECTURE.md)已把连续性、可问责性和分寸感列作拟人化的工程维度，并把分寸感指出为薄弱项。这是有价值的构念提案；目前的 user-ignored、误注入率等代理量尚未经过关系体验量表验证。新阶段应保留该洞察，但将可观测行为与用户主观体验分别测量。

这条证据链为新研究提供了基础，却没有预先决定结论。它支持的准确表述是：**项目已有宿主侧主动记忆的设计基线和检索／激活子系统证据；不同交互目的下的关系效果仍待实验。**

## 4. 相关研究：已有积木、交叠和边界

### 4.1 语言 Agent 架构与长期记忆基准

CoALA 将语言 Agent 组织为模块化记忆、内部与外部动作空间，以及统一的决策过程，是描述记忆在 Agent 架构中位置的重要概念框架。[Sumers et al. (2024)](https://arxiv.org/abs/2309.02427)。它提供的是架构组织语言，而非专门的关系型记忆政策或关系体验指标。

Generative Agents 组合自然语言记忆流、反思和规划，在 Smallville 模拟中展示了记忆与规划组件对行为可信度的作用。[Park et al. (2023)](https://doi.org/10.1145/3586183.3606763)。它的重要性在于说明记忆不仅提供事实，也参与后续计划与社会行为；但主要研究对象是受控的模拟社会，不能等同于真实用户的长期人机关系。

MemoryBank 将长期记忆用于 SiliconFriend 伴侣场景，是早期直接把长时记忆与陪伴对话连接的工作。[Zhong et al. (2024)](https://doi.org/10.1609/AAAI.V38I17.29946)。它有助于说明用户画像、情绪线索与回应生成可以形成系统闭环；其研究问题和实现仍主要落在记忆方法及伴侣聊天系统，不等同于跨交互模式、模型无关、宿主侧的记忆政策。

LoCoMo 则以长程、多会话对话构造记忆基准，覆盖问答、事件总结和多模态对话生成，强调时间与因果关系仍构成长程记忆难点。它回答“Agent 能否从漫长历史中找出事实、事件和变化”，并不直接测量何时主动提起、用户是否觉得被理解、或某次披露是否适当。[Maharana et al. (2024)](https://aclanthology.org/2024.acl-long.747/)

THEANINE 将时间和因果链接纳入终身对话 Agent 的记忆管理，提出用时间线组织响应所需的事件演化；MapDia／ChMapData 研究历史记忆驱动的主动话题转移，试图在合适时机把对话带回相关的历史主题。[Ong et al. (2025)](https://aclanthology.org/2025.naacl-long.435/)；[Wu et al. (2025)](https://aclanthology.org/2025.conll-1.4/)。两者分别把“记忆如何随时间组织”和“记忆如何主动改变对话进程”向前推进，但任务／基准效度仍不同于长期关系的因果用户研究。

尤其需要校准新颖性的是 ACL 2026 的直接相邻工作。ENPMR-Bench 构造超过 1,800 段记忆增强对话，研究情感需求感知的主动记忆检索；情绪轨迹检索工作把情绪变化用于情感支持策略规划；StratMem-Bench 用 657 个虚拟角色情境区分必需、支持性和无关记忆，并测量合规、整合质量、主动丰富和条件无关率；KnowMe-Bench 则用长篇自传叙事与带证据的问题测量事实回忆、主观状态归因及原则层理解。[Fu et al. (2026)](https://aclanthology.org/2026.findings-acl.2080/)；[Wu, H. et al. (2026)](https://aclanthology.org/2026.findings-acl.2127/)；[Wu, Y. et al. (2026)](https://aclanthology.org/2026.acl-long.1491/)；[Wu, T. et al. (2026)](https://aclanthology.org/2026.acl-long.1394/)。

Memory-Driven Role-Playing 进一步把“未被直接提示也能选取、约束并执行角色记忆”拆成四阶段，并发布覆盖 12 个语言模型的双语评测；它与本文关注的策略性、非显式提示记忆使用尤其接近。[Wang et al. (2026)](https://aclanthology.org/2026.findings-acl.1175/)。MCMA 研究跨任务的结构化记忆管理和迁移，可作为记忆管理可迁移性的相邻工作。[Liang et al. (2026)](https://aclanthology.org/2026.findings-acl.1535/)。这些论文直接否定“当前没有情感主动记忆、角色记忆使用或陪伴型记忆评测”的宽泛说法。它们各有基准和能力测量价值；本文可继续追问的是，怎样将既有指标嵌入可审计的宿主运行时决策，并通过固定候选、随机化披露方式和多种交互目标来识别各机制对真实用户结果的因果贡献。

### 4.2 记忆的自然使用、回指与遗忘

SUI Corpus 研究关注如何将用户信息自然地融入对话，即使当前话题与该用户信息并不相似，同时保留语境适切性。[Tsunomori & Higashinaka (2024)](https://aclanthology.org/2024.lrec-main.811/)。它清楚指出一个关键难题：基于模板的个性化可能不自然，而只在话题相似时才使用记忆会错过跨主题的关系性回应。论文报告了主观评价和交互式系统测试，但没有因此解决长期、开放情境中什么时候应当主动使用记忆的全部问题。

Richards 与 Bransky 的 ForgetMeNot 研究让参与者与虚拟房产代理跨三次会话交互，比较任务和社交个人信息的回忆、部分遗忘、完全遗忘及错误回忆。[Richards & Bransky (2014)](https://doi.org/10.1016/j.ijhcs.2014.01.005)。研究报告回忆提升享受和可信度，错误回忆令人挫败，而部分或完全遗忘有时更自然。研究未发现任务内容与社交内容的显著差异，但作者提醒样本和参与者对社交问题的舒适度有限。它提示：**记忆质量不只是记得多少，准确忘记、自然不提和错误回忆的成本也必须评估。**

Cox、Lee 与 Ooi 的三周随机组间研究（N=169）比较不回指、逐字回指和改述回指。[Cox et al. (2023)](https://doi.org/10.1145/3623809.3623875)。逐字与改述回指被认为更智能、更有参与感，但逐字回指同时引发更多隐私顾虑；场景集中在牙线习惯对话。此结果直接说明“模型使用了记忆”还不够，表达形式本身就是独立的体验和风险变量。

### 4.3 关系型 Agent、真实长期关系与 RECALLbot

关系型 Agent 的研究早于大语言模型。Bickmore 与 Picard 将 relational agents 定义为意在建立和维持长期社会情感关系的计算系统，并讨论信任及任务效果。[Bickmore & Picard (2005)](https://doi.org/10.1145/1067860.1067867)。后续长期对话研究也显示关系形成有差异，用户自我披露、互动多样性、对深层需要的回应，以及应用变化和技术问题等意外中断都会影响关系过程。[Skjuve et al. (2022)](https://doi.org/10.1016/j.ijhcs.2022.102903)。它们提供了重要的理论和研究方法背景，但使用的技术形态与今天的宿主侧 LLM 记忆系统不同。

MemoryBank 与 Project Sue 等系统或架构案例说明，陪伴 Agent 的“自己是谁”与“记住了什么”逐渐成为明确的设计问题。[Zhong et al. (2024)](https://doi.org/10.1609/AAAI.V38I17.29946)；[Liu et al. (2026)](https://doi.org/10.5281/zenodo.22263743)；[Liu (2026)](https://doi.org/10.5281/zenodo.23276103)。它们的案例、愿景或工程观察应与有对照组的用户实验分开引用，不可把拟人叙事当成关系效应的实验数据。Project Sue 的 2026 年 10 月 DSH 后续工作也表明，持续状态、记忆治理和伴侣架构已经是紧邻的公开研究议题；此类预印本／工程报告仍需按其发表状态解释。

最需要正面讨论的是 RECALLbot（CHI 2026）。它将 Agent 的 Me Memory、共同构建的 We Memory、情境化的互惠披露策略和用户控制组合起来；研究对 40 名已积极使用社交聊天机器人的参与者进行了两周组间比较，报告社会身份感、自我披露和信任等结果改善。这是本领域直接、重要的先行实证，意味着“关系记忆和记忆披露此前无人研究”显然不能成立。

RECALLbot 的研究也提示下一阶段可以追问的问题：其系统将记忆构建与披露策略共同作为干预，因而不能简单把全部效果归因于单个记忆阶段；其目标用户和社交陪伴场景也限定了外推范围。[Jiang, Z. et al. (2026)](https://doi.org/10.1145/3772318.3790714)。新研究应沿着它已有的关系记忆与用户体验证据，进一步拆分“召回了什么”“如何考虑”“是否明说”“交互目标是什么”，并考察工作协作、个人助理、闲聊和情感支持之间的变化；重点放在宿主侧可移植政策、可审计治理以及将各机制因果分离的评测上。

### 4.4 人格一致性与具身记忆

个性化 Agent 与可移植记忆操作也已有相邻工作。PersonaAgent 将情景／语义记忆与跨任务个性化行动连接；Text2Mem 提出跨后端表达记忆写入、检索和生命周期管理的操作语言。[Zhang et al. (2026)](https://aclanthology.org/2026.findings-acl.1315/)；[Wang et al. (2026)](https://aclanthology.org/2026.findings-acl.100/)。因此，本文不把“个性化记忆”“跨任务适配”或“记忆可移植性”单独作为空白，研究对象是交互目的如何在宿主侧影响本轮记忆使用与披露，并可与已有系统和基准对照。

人格／角色一致性研究关注长程对话中的状态漂移、行为一致与角色忠实度。BRIDGE（ICML 2026）将可观察行为、潜在状态与记忆显式联结，并以角色基准报告人格一致性结果；ACL 2026 关于原创角色陪伴的短文则探索神经符号强化学习路径。[Jiang, Y. et al. (2026)](https://proceedings.mlr.press/v306/jiang26aw.html)；[Huang (2026)](https://aclanthology.org/2026.acl-short.44/)。StratMem-Bench 已为虚拟角色中的支持性记忆使用提供独立评测框架；PersonaAgent 则把情景／语义记忆接到跨任务个性化行动。[Wu, Y. et al. (2026)](https://aclanthology.org/2026.acl-long.1491/)；[Zhang et al. (2026)](https://aclanthology.org/2026.findings-acl.1315/)。MCMA 则把记忆管理作为可迁移的元认知能力，与任务执行分开训练和评估。[Liang et al. (2026)](https://aclanthology.org/2026.findings-acl.1535/)。这些研究与“同一主体如何跨长时互动保持连贯”相关，但人格一致性并不等价于关系质量：角色符合设定，不必然意味着用户感到被理解、信任或被适当地记住。

在具身方向，ABot-AgentOS 将多模态记忆置于机器人 Agent OS 中，连接对话、视觉观察、空间、时间和任务轨迹。[Tian et al. (2026)](https://arxiv.org/abs/2607.10350)。这为长期记忆与身体行动环境的结合提供了系统参照，但其记忆基准和任务完成结果不能直接代替人机关系研究。本文将具身智能视为外推方向：一旦 Agent 能感知并行动，记忆来源、主体责任和伤害范围都会变化，需专门研究。

### 4.5 综合：研究缺口是整合问题，不是“无人研究”

按研究对象与证据类型比较，最接近本文的工作各自覆盖如下问题：

| 先行研究 | 已覆盖的关键问题 | 本文进一步要求检验的部分 |
|---|---|---|
| RECALLbot（CHI 2026） | Me/We Memory、互惠披露与两周关系体验研究 | 将记忆构建、激活、使用框架和披露拆分；跨工作／助理／社交目的对照 |
| ENPMR-Bench、情绪轨迹检索 | 情感需求驱动的主动检索与支持策略 | 宿主请求边界的真实投递、用户控制和长期关系结果 |
| StratMem-Bench、MREval/MRBench | 虚拟角色的支持性记忆使用与角色知识执行 | 真实用户历史的来源／权限治理，以及用户体验与任务质量的联合检验 |
| KnowMe-Bench | 带证据的人物理解与高层推断 | “理解”何时应进入回答、何时应保持沉默、用户是否认可 |
| PersonaAgent、Text2Mem、MCMA | 跨任务个性化、可移植记忆操作、可迁移管理 | 情境化的本轮使用／披露政策及其分组件因果效应 |
| Project Sue、BRIDGE、ABot-AgentOS | 持续伴侣架构、角色一致性、具身多模态记忆 | 在现有文本宿主中的可审计政策与人类关系终点；具身研究需另行开展 |

以上研究共同表明，领域已经分别探索了：

- 长期对话中的事实、事件、时间和因果记忆；
- 从历史中主动召回信息或重启话题；
- 记忆回指如何影响自然度、智能感、信任与隐私；
- Agent 自身记忆、共同记忆和互惠披露；
- 长程角色一致性与具身系统中的多模态记忆；
- 情感需求驱动的主动检索、支持性记忆使用、人物理解与跨后端记忆操作。

因此，本文提出的可守研究空间不是补建一个“关系记忆空白领域”，而是这些路径的**交叉整合与评测拆分**：以模型外宿主中间件为控制点，统一表达交互目的、记忆范围和用户授权；将检索、激活、影响回应、显式披露和治理记录变成分立且可审计的决策；再同时测任务质量与关系体验，明确其收益、代价和边界。现有基准已测量情感需求检索、支持性记忆整合、人物理解、人格一致性和记忆操作；新议程应直接复用或对照这些构念，识别其离线能力分数与真实用户纵向体验之间的关系。

本文不主张这是唯一尚未解决的问题，也不以当前范围式综述证明整个领域不存在其他相同系统。更精确的贡献定位是：提出一套适用于项目下一阶段的研究问题、机制分解与可复算评测议程。

## 5. 情境化主动记忆使用框架

### 5.1 交互目的不是两套固定人格

第一版实验可以用“工作导向”与“关系／陪伴导向”构成清楚的对照，但长期框架不应把人和 Agent 固定在二元角色中。交互状态可表示为带置信度的向量，例如：任务推进、实际协助、开放交流、情绪支持、关系维护、共同回顾；多项可同时激活，并随对话变化。用户明确设置、当前表达、会话目标和历史互动可共同提供信号，但系统必须保留不确定与用户纠正路径。

针对最初“用户每说一句话就触发记忆”的构想，本文把它定义为**每轮可执行一次候选检查和使用裁决**。记忆库为空、用户关闭、权限不符、预算不足或没有适宜候选时，系统可返回“不介入”。是否每轮检查本身也应与模型按需调用、定期摘要注入和廉价前置门控对照，而不能预设为所有场景的最优解。

可暂用以下形式化表示作为讨论工具，而非已验证算法：

```text
context_t = {purpose distribution, current intent, relationship history,
             sensitivity, user preference, uncertainty}

memory_policy_t(memory_i, context_t)
  -> {delivery_eligibility, use_framing, disclosure_permission, timing}
```

策略不得将人格标签直接映射为“更亲密”或“召回更多”。用户许可、记忆敏感度、事实置信度、时效性和作用域是限制条件；交互目的只改变可接受的效用权衡，不会取消这些限制。

### 5.2 将“有帮助”拆成任务价值与关系价值

对候选记忆的价值至少包含两类：

- **任务价值**：是否提高目标完成、准确性、效率或连续工作能力；
- **关系价值**：是否让回应更贴合用户当前意图、体现共同历史的连续性、支持恰当的情感回应或兑现承诺。

成本也不止 token 和延迟：还有打断、重复、误认、错误回忆、过时信息、敏感披露、过度亲密、错误推断和用户控制感受损。可以把决策写成受约束的多目标选择，而不把一切压成单一“人格分数”：

```text
choose action a for memory m given context c
to improve task utility and/or relational utility,
subject to provenance, scope, consent, freshness, and safety constraints;
minimize interruption, disclosure, error, and cost.
```

权重可以配置或学习，但每个门控与拒绝原因应可检查。尤其需要防止系统把“关系更好”偷换成“用户更多自我披露”或“更信任 AI”：这些是可能的结果变量，不自动等于福祉或良好设计。

### 5.3 介入强度是多个可组合的策略轴

“介入强度”不能当作一条从静默到主动的单一刻度。为了给金标、实验和代码提供共同定义，至少要分别记录以下维度：

| 决策轴 | 策略选择 | 可观测记录 |
|---|---|---|
| **模型侧投递** | 不投递／带来源的历史参考／短背景提示 | 逐请求记录策略允许的 packet 与实际模型可见内容 |
| **使用框架** | 中性参考／请评估当前相关性，只在有帮助时使用 | 请求中的指示文本及其版本；不推断模型内部思维 |
| **显式披露许可** | 不主动提及／允许适当回忆／单独询问许可 | 策略条件与回答中实际出现的回忆、询问 |
| **介入时机** | 当前请求／延迟到未来边界 | 候选产生、计划使用和实际投递时间戳 |
| **存储生命周期** | 保留／更正／过期／用户删除 | 记忆状态变化、来源和用户操作记录 |

研究中需区分策略目标与观测结果。单条回答不能证明记忆曾“静默影响”模型；应通过随机化对照、相同输入的反事实生成与盲评，估计其是否改变回应及改变是否有益。本文所说的“请认真考虑记忆”指可观察的外部使用框架：要求模型评估候选证据与当前回应的关系，并只在有依据、确实有帮助时使用。它不声称能强制模型发生某种不可观察的内在思维，也不把隐藏推理文本作为效果指标。

### 5.4 共同记忆必须保持来源和多视角

关系记忆不是把用户画像加一栏“我们”。一条共同事件可能有双方不同的理解，也可能包含尚未解决的冲突。记录可保存：参与者、事件来源、双方确认状态、Agent 当时的行为与承诺、用户后续纠正、有效期、可用目的和披露级别。Agent 的推断应与用户确认的事实分开；旧承诺应记录完成、撤销或未完成状态。

长期一致性也不等于永不改变。用户偏好会变，Agent 的建议会错，关系边界可能经用户明确调整。高质量连续性应允许“可解释的更新”：保留旧记录的来源和时间，优先采用新确认信息，并在必要时承认过去理解与当前理解不同。

## 6. 研究命题与可证伪问题

本文提出六个研究问题。它们是下一阶段可以通过研究推翻或细化的命题，不是本项目已验证结论。

**RQ1：情境改变记忆效用吗？** 固定同一条记忆和同一轮话语，随机改变工作、助理、闲聊或情绪支持目标，目的与记忆可见性／使用许可之间是否存在交互效应？目的操弄需通过预试和事后理解检查。

**RQ2：检索、考虑与披露分别贡献什么？** 在检索结果相同的条件下，要求模型把记忆作为中性历史参考，与要求其评估记忆对当前回应的意义相比，是否会改变答案质量、记忆正确使用和用户感受？现有 StratMem-Bench 的支持性／无关记忆类别可作为离线能力对照；显式回指是否有额外收益或成本，则需与 Cox 等人的披露研究及 RECALLbot 的组合干预结果进行对照。

**RQ3：不同策略轴的适切性如何变化？** 模型侧投递形式、使用框架、显式披露许可、介入时机与存储生命周期，分别如何受记忆敏感度、时效、置信度及用户偏好影响？静默影响、自然回忆、询问、延迟和抑制不应被混作同一层级的类别。

**RQ4：关系记忆比用户事实画像增加了什么？** 在有共同事件、承诺、纠正与未解决话题时，关系记忆是否比仅有用户偏好／事实更能提升被理解感与连续性？这种提升是否伴随更高的误认、越界披露或信任风险？需与 KnowMe-Bench 的证据关联人物理解任务和 RECALLbot 的关系体验评估相衔接，同时区分基准生成分数与真实关系结果。

**RQ5：主体连续性感知能否跨模型保持？** 记忆、证据来源、关系约定和披露政策相同，底层模型更换时，用户对 Agent 连续性的评价是否稳定？哪些差异来自记忆、哪些来自模型表达风格？

**RQ6：治理如何影响接受度？** 查看来源、编辑、限制用途、删除及解释某条记忆为何被调用，能否提高用户对主动记忆的控制感与信任，同时不过度增加交互负担？

可检验的初步假设包括：

- **H1 情境效用假设：** 某些记忆在任务、助理和关系交流之间的有用性标注存在可复现的交互效应；若该效应达到预注册的实际意义阈值，则单一全局策略会在至少一类情境中造成可测的覆盖或伤害代价。
- **H2 分阶段收益假设：** 固定候选内容和披露许可后，“评估当前意义、仅在有帮助时使用”的框架可能改变忠实使用率、回应质量和用户评价；是否改善这些结果由对照试验判定，单纯出现任何可归因于记忆的输出变化不算收益。效果可能受当前目的调节，且不必增加显式回忆率。
- **H3 显式性成本假设：** 在候选记忆和使用框架相同的前提下，允许适当显式回忆的策略可能提升连续性感知，也可能增加侵入感；实际提及率、是否忠实和用户评价分别报告，不把未显式提及的回答直接解释为“静默影响”。
- **H4 关系记忆增量假设：** 与长度、相关度、时效和披露权限相匹配的用户事实记忆相比，共同经历和约定可能为纵向关系连续性带来增量价值；错误共同记忆也可能增加纠正成本。对照实验需匹配候选条件，分别估计价值和错误代价，不能只比较未匹配的记忆包。
- **H5 可治理性假设：** 对记忆来源和用途的用户控制会提升可接受度，尤其是在敏感、推断性或高不确定记忆上。

每条假设都可能被否定。例如，语境化记忆可能没有超出良好当前对话理解的额外收益；关系记忆可能不优于简单、准确的偏好记忆；或主动披露可能总体不如用户主动回顾。这些负结果仍会指导产品设计。

## 7. 评测：用四个层级回答四种不同问题

### 7.1 机制层：找到了正确候选吗？

报告 Recall@K、MRR 或候选覆盖率，并按记忆类型、交互目的、语言、时间跨度、作用域与敏感度分层。必须有错误近邻、过时信息、跨工作区同文、同一事实的更新版本和混合目的样本。该层不应把检索命中直接解释为有益。

### 7.2 决策层：该不该让它影响本轮？

以候选记忆为单位，标注本轮是否具备投递资格；将资格的 binary precision 定义为 TP/(TP+FP)、recall 定义为 TP/(TP+FN)，另报覆盖率与校准。它们回答资格判定是否与标注一致，不直接衡量是否改善回答。介入动作、使用框架和披露许可另行报告分类准确率或预先定义的效用／伤害结果。运行日志需分别记录策略是否允许、模型是否实际看见、回答是否忠实使用、回答是否显式提及。StratMem-Bench 已提供记忆合规、整合质量、主动丰富与条件无关性指标；ENPMR-Bench 已直接测情感需求驱动检索。因此，新基准应明确哪些指标是继承、复现或改造，重点新增宿主策略的可审计触发轨迹和跨交互目的的配对标注。按参与者和会话分组切分，避免同一生活事件的改写版同时进入训练与测试。

### 7.3 输出层：记忆使用和披露准确、合适吗？

区分：事实是否正确；来源是否忠实；回答是否依赖了未经支持的推断；回答相对随机化对照是否改善；是否显式披露；披露措辞是否自然；沉默／延迟策略是否得到适当执行。单条输出本身无法证明隐性的记忆影响；“静默使用”需在固定上下文与候选下比较有／无记忆或不同使用框架，并由盲评判断变化方向。可测不必要提及率、错误回忆率、过期信息使用率、敏感信息越界披露率、记忆重复率和记忆引发的答复偏离率。

### 7.4 人类结果层：用户实际体验改变了吗？

用预先定义并验证的量表和盲评测量：感知理解、回应贴合、自然性、关系连续性、感知社会身份、信任、侵入感、隐私担忧、用户控制感和偏好胜率。RECALLbot 等工作已测部分关系结果，本文不把这些构念本身包装成新发现；新实验应采用可比较的指标，并把体验分数与具体策略日志关联。把这些构念分开报告；不能用“人格感”一个总分代替。对任务场景可测任务成功率，对陪伴和开放交流场景不能假装有单一客观成功率。

需同时报告 token／延迟成本、用户每次被打扰次数、用户拒绝或修正率、后续误复现，以及是否有任何跨作用域泄漏。若策略让用户更多披露，须评估其是否来自用户主动选择，并审视隐私、安全和潜在依赖，而不能单独将“披露更深”当作正向目标。

## 8. 因果实验与研究路线

### 8.1 第一阶段：离线、配对、可复算的回应评测

构建情境化金标集：同一段当前话语和同一候选记忆配上不同交互目的与用户许可条件。目的标签作为随机化情境操弄；正式实验前由独立参与者预试情境是否可信，并在试验中检查其是否被理解为预定目的。标注人员回答的不只是“相关吗”，还包括“允许什么动作”“可能获得什么帮助”“会产生什么披露风险”。用户本人对偏好、敏感度和记忆正确性拥有优先确认权；独立评审负责盲评生成回答的正确使用与适切性。基准设计需与 ENPMR-Bench、StratMem-Bench、MREval/MRBench 和 KnowMe-Bench 的设置进行逐项映射，说明新增样本或任务在哪个方面提供增量，避免重复造出同名指标。

#### 固定候选：分别估计暴露、使用框架和披露许可

先固定模型、上下文、检索池与候选记忆。对有记忆条件采用“使用框架 × 披露策略”的 2×2 析因设计；另为四个组合各设一个空记忆包对照，保留同样的使用／披露指示。表中 A 汇总这四个匹配对照，因此估计记忆暴露效应时不会把提示措辞变化混入：

| 条件 | 可见记忆 | 使用框架 | 披露策略 | 识别目标 |
|---|---|---|---|---|
| A | 空记忆包 | 分别复用 B–E 的框架 | 保持对应披露策略 | 四个匹配的无记忆基线 |
| B | 相同候选 | 中性历史参考 | 不主动显式提及 | 记忆可见暴露的基准条件 |
| C | 相同候选 | 评估当前意义、只在有帮助时使用 | 不主动显式提及 | 与 B 对比，估计使用框架效应 |
| D | 相同候选 | 中性历史参考 | 允许适当显式提及 | 与 B 对比，估计披露许可效应 |
| E | 相同候选 | 评估当前意义、只在有帮助时使用 | 允许适当显式提及 | 与 C、D 对比，估计交互作用 |

“询问用户是否愿意回忆／使用该信息”应作为独立条件，因为它同时改变回应动作和用户交互负担，不能并入“允许显式提及”。实验采用随机分配，保持字面话语与候选记忆不变；回答评分者不知道条件。样本量由预注册主结果的功效分析确定。

#### 端到端：比较记忆政策，不误称单组件因果效应

另做一项端到端试验，比较自动宿主策略、用户主动请求和无记忆流程。此时触发方式会改变候选检索、用户意图和实际暴露，因此估计的是**整体流程差异**，不能与固定候选试验中的“使用框架效应”混为一谈。只有在同一输入与记忆候选可配对、且候选供给保持一致时，才可进一步估计相应的子组件差异。

#### 预先定义因果量与观测量

固定候选实验的因果结构可写为：

~~~text
randomized purpose C × assigned memory exposure Z_E
                    × assigned use framing Z_F
                    × assigned disclosure policy Z_D
                              -> model request -> answer -> outcome Y
~~~

端到端系统试验则增加 R（检索候选）和 A（投递资格），最终实际暴露记为 E、经盲评编码的忠实使用记为 U、实际显式提及记为 O。预注册并分别报告各项**随机分配条件的 ITT 效应**（按原始分组分析）：Z_E=memory 对 Z_E=no-memory 的差异；有记忆条件下 Z_F=consider 对 Z_F=neutral 的差异；固定 Z_E 与 Z_F 时允许显式披露与不主动提及的差异；以及随机分配自动、用户触发和无记忆流程之间的端到端差异。R/A/E/U/O 是流程中的不同状态或中介，不能通过只挑选“模型确实用了记忆”的输出，反过来声称策略的总体因果效应。策略分配、实际投递、回答忠实使用和实际提及率应分别报告。

### 8.2 第二阶段：真实用户纵向试验

离线盲评不能回答用户会不会长期接受主动记忆。后续可开展有限周期、多用户纵向试验，明确纳入与退出条件、风险处理和数据保留计划。允许用户查看、编辑、删除记忆，关闭特定情境的主动披露，并在任何时候撤回敏感信息的使用权。过程数据区分系统候选、真实模型可见注入、模型输出使用和用户主观感受。

优先观察转折场景：用户纠正、事实变化、旧承诺未履约、用户忽略、关系边界改变、工作转闲聊、闲聊转任务、同一记忆高频重复、低置信推断，以及用户主动请求遗忘。纵向结果既要报告平均趋势，也要保留个体差异和退出原因。

### 8.3 第三阶段：模型迁移与具身扩展

跨模型实验要固定记忆账本、作用域、证据和策略，分别测回答风格变化、事实忠实度、约定履行、用户的连续性感知与可接受性。换模型后用户是否觉得“还是同一个她”，是经验问题；不能仅凭记忆文件相同就宣称主体身份不变。

具身扩展则要把空间位置、感知来源、身体动作、行动结果、他人在场与环境变化纳入证据链。它不是简单加一类多模态 embedding：机器人记忆可能触发具有现实后果的行动，因而需要更强的来源验证、权限和安全门。现阶段文本对话实验只为此提供研究框架，不构成具身智能实证。

## 9. 架构议程：宿主侧成为可审计的记忆调度层

“调整权重”在工程上至少有三种含义：更改 embedding 模型参数、更改检索／重排的评分、更改激活与披露策略。下一阶段应先冻结底层模型和检索器，对策略权重、候选门槛及投递方式做可解释的实验；只有当表示能力成为可复现的瓶颈时，再考虑训练或替换模型。这样能把“更懂当前情境”与“模型换强了”两个因素分开。

本文建议将系统表达为“交互契约 × 记忆证据 × 介入动作”的组合：

```text
Runtime context + current user intent + declared interaction contract
    -> scoped candidate retrieval
    -> activation / utility / risk assessment
    -> policy tuple
       {delivery eligibility, use framing, disclosure permission, timing}
    -> response boundary injection with provenance and budget
    -> observed exposure / faithful use / explicit mention / user outcome
    -> correction, update, retention, or deletion
```

宿主中间件的研究价值在于将策略放在模型外：可以跨模型观察同一种输入输出事件，统一执行作用域、来源、预算和审计要求，并可在策略不确定时安全降级。它不保证模型一定遵循注入内容，也不拥有完整内部状态；其机制应通过请求边界、实际注入日志和外显回答验证。

系统可分为六个职责，而不意味着必须拆成六个服务：

1. **Context Observer**：观察用户消息、工具结果、助手可见回应及运行时事件；会话隔离、最小化采集。
2. **Interaction Context Estimator**：维护多目标、带置信度的交互目的，不把类别判断伪装为事实。
3. **Memory Store and Provenance**：存用户、Agent、共同经历及约定，保留来源、时间、确认状态、作用域、敏感度与更新关系。
4. **Recall and Use Policy**：分立执行候选检索、激活判断和介入动作选择；能解释为何使用、为何沉默。
5. **Injection Broker**：在宿主可修改的下一请求边界，按预算和权限生成记忆包；不把历史记录升级成更高权威的系统指令。
6. **Evidence and Governance Loop**：记录实际投递与用户反馈，支持查看、纠错、撤回、删除、遗忘和策略复核。

关系型提示可以要求模型“判断这些历史记录是否有助于当前回应，只在有依据且适当时使用”。它不应要求无条件套用画像、模仿人类内心独白或每轮都显式提起过去。提示层也不能替代权限、来源校验和事实纠正。

### 最小可推进的研究顺序

| 阶段 | 交付物 | 进入下一阶段的判据 |
|---|---|---|
| P0：构念与数据协议 | 将本文动作类别与既有基准逐项映射；明确事实／推断／角色设定和用户许可 | 标注者能理解并区分“相关、可使用、可披露”；分歧和未定义案例有记录 |
| P1：固定候选实验 | 同一批记忆与问题上的使用框架、披露方式对照，含负例 | 主要终点与最低覆盖量预先确定；效果和伤害均报告 |
| P2：宿主 shadow | 策略读同一运行时上下文，记录候选、动作、理由和预算 | 线上特征与离线口径一致；不借助测试标签构造线上不可得特征 |
| P3：有用户参与的试点 | 可查看、纠正、停用的实际投递和回应 | 能核对哪些记忆真正进入请求、如何被回答使用；严重越界有停用机制 |
| P4：纵向与跨模型 | 多用户、多情境、包含模型切换和事实更新的研究 | 报告不确定性、个体差异、退出与负结果；再决定产品默认策略 |

前两阶段已足以形成可复算的第一轮新研究；跨模型身份感和具身扩展应在这条证据链之后推进。文章的研究范围可以广，第一轮实现应保持可识别、可解释。

## 10. 风险、治理与失败判据

**记忆污染与错误归属。** 系统必须区分用户说过的内容、模型推断、工具验证结果和生成的角色背景。错误共同记忆会伤害信任，因为它不仅是“记错一条偏好”，还可能错误描述双方共同发生过什么。

**敏感披露与过度亲密。** 关系情境不构成披露许可。逐字回忆、把私人经历带入公共任务或用推断情绪替用户定性，都可能越界。需将显式提及、静默使用和完全不用分别授权或评估。

**被动画像与操纵风险。** 系统可能从反馈中学习“什么更容易获得用户回应”，但高互动率不等于更好的人际体验。优化目标不应把披露深度、依赖或持续使用量当作关系质量的替代指标。

**持续状态漂移。** 用户和 Agent 的状态都可能改变。长期记忆要允许更正、冲突保留和明确过期，不以“人格一致”为由固化过时画像或过期关系规则。

**注意力与延迟成本。** 每轮做候选检查并不等于每轮都进行高成本模型推理。可用本地过滤、延迟处理和显式预算作为工程方案，但系统应披露其真实延迟、 token 成本及失败回退，不能只报告 offline 质量。

**边界与退出。** 用户应能按记忆类型和情境查看、停用、限定和删除。研究需要明确如何处理原始记录、派生画像、检索索引和备份，避免界面上的“删除”只移除了一个显示条目。

一个成熟策略必须把失败设为可见结果：误提私密内容、旧事实冒充新事实、用户明确拒绝后继续召回、把用户的情绪归因当作确定事实、任务被关系化话语带偏，或模型迁移时丢失重要承诺。只统计成功案例会使主动记忆系统系统性高估自身。

## 11. 结论：从主动召回到关系中的记忆使用

8 月 19 日的基础报告为项目提出一个运行时问题：模型没有主动查找时，宿主如何观察上下文并在下一请求前送入记忆。M7 随后证明，在项目自己的开发者语料和金标中，检索相似度与唤起必要性不能混为一谈。下一阶段可以把问题推进到关系层：当 Agent 在工作、助理、开放交流和长期陪伴之间切换时，记忆为什么参与、应该以何种强度参与、以及什么时候应该不说。

这不是简单把“工作型”改成“人格型”，也不是把每一轮都注入更多个人信息。本文主张研究一套情境化记忆使用政策，把用户记忆、Agent 行动史、共同经历与关系约定纳入可追溯、可修正的证据结构，并分别测量候选检索、激活判断、回应使用、披露方式和用户体验。既有关系型记忆与披露研究，特别是 RECALLbot，已提供直接前例与经验基础；本项目的机会在于进一步考察跨交互目的的宿主侧策略、机制因果分离、用户治理以及模型更换下的感知连续性。

因此，本文的定位是一个**下一阶段的概念与研究基线**，而非效果宣言。相关领域在 2026 年已快速推进：主动情感检索、支持性记忆使用、人物理解、角色一致性与互惠记忆披露均已有研究或基准。项目不需要把自己放在“第一个提出关系记忆”的位置；更有价值的工作，是把这些线索统一到模型外、可审计的情境化记忆政策中，并用跨目的、分阶段、用户参与的实验检验其收益和伤害。

**记忆不只回答“她想起了什么”，还要回答“她为何此刻想起，以及为什么选择不说”。**

## 参考文献

为保持可读性，部分多作者条目采用首位作者加 et al. 的缩写；完整元数据以各条目的一手来源为准，核验记录见文献来源台账。

1. Bickmore, T. W., & Picard, R. W. (2005). [Establishing and Maintaining Long-Term Human-Computer Relationships](https://doi.org/10.1145/1067860.1067867). *ACM Transactions on Computer-Human Interaction, 12*(2), 293–327.
2. Cox, S. R., Lee, Y.-C., & Ooi, W. T. (2023). [Comparing How a Chatbot References User Utterances from Previous Chatting Sessions: An Investigation of Users’ Privacy Concerns and Perceptions](https://doi.org/10.1145/3623809.3623875). *Proceedings of the 11th International Conference on Human-Agent Interaction*, 105–114.
3. Fu, X., et al. (2026). [ENPMR-Bench: Benchmarking Proactive Memory Retrieval for Emotional Support Agents](https://aclanthology.org/2026.findings-acl.2080/). *Findings of ACL 2026*, 41910–41933.
4. Huang, Z. (2026). [Neuro-Symbolic Agentic Reinforcement Learning for Long-Term Original Character Companionship and Interaction](https://aclanthology.org/2026.acl-short.44/). *Proceedings of ACL 2026, Short Papers*, 530–539.
5. Jiang, Z., Zheng, C., Chen, H., & Chen, L. (2026). [RECALLbot: Designing Agentic Memory and Reciprocal Disclosure for Human–Chatbot Relationships](https://doi.org/10.1145/3772318.3790714). *Proceedings of the 2026 CHI Conference on Human Factors in Computing Systems*, Article 795.
6. Jiang, Y., Xu, B., Xie, J., & Sun, H. (2026). [BRIDGE: Triangular Fixed-Point Refinement for Long-Horizon Persona Consistency](https://proceedings.mlr.press/v306/jiang26aw.html). *Proceedings of the 43rd International Conference on Machine Learning*, PMLR 306, 53280–53307.
7. Liu, Z., Su, J., & Ren, H. (2026-09-03). [Project Sue: An Engineering Architecture for Persistent Persona and Relational Continuity in AI Companions](https://doi.org/10.5281/zenodo.22263743). Zenodo engineering report / preprint.
8. Liu, Z. (2026). [Project Sue DSH: A Brain–Body-Decoupled Architecture with Persistent State and Machine-Native Interoception for Long-Term LLM Companions](https://doi.org/10.5281/zenodo.23276103). Zenodo, 2026-10-10; preprint, not peer reviewed.
9. Maharana, A., Lee, D.-H., Tulyakov, S., Bansal, M., Barbieri, F., & Fang, Y. (2024). [Evaluating Very Long-Term Conversational Memory of LLM Agents](https://aclanthology.org/2024.acl-long.747/). *Proceedings of ACL 2024*, 13851–13870.
10. Ong, K. T.-i., Kim, N., Gwak, M., Chae, H., Kwon, T., Jo, Y., Hwang, S.-w., Lee, D., & Yeo, J. (2025). [Towards Lifelong Dialogue Agents via Timeline-based Memory Management](https://aclanthology.org/2025.naacl-long.435/). *Proceedings of NAACL-HLT 2025*, 8631–8661.
11. Park, J. S., O’Brien, J. C., Cai, C. J., Morris, M. R., Liang, P., & Bernstein, M. S. (2023). [Generative Agents: Interactive Simulacra of Human Behavior](https://doi.org/10.1145/3586183.3606763). *Proceedings of the 36th Annual ACM Symposium on User Interface Software and Technology*.
12. Richards, D., & Bransky, K. (2014). [ForgetMeNot: What and how users expect intelligent virtual agents to recall and forget personal conversational content](https://doi.org/10.1016/j.ijhcs.2014.01.005). *International Journal of Human-Computer Studies, 72*(5), 460–476.
13. Skjuve, M., Følstad, A., Fostervold, K. I., & Brandtzaeg, P. B. (2022). [A longitudinal study of human–chatbot relationships](https://doi.org/10.1016/j.ijhcs.2022.102903). *International Journal of Human-Computer Studies, 168*, 102903.
14. Sumers, T. R., Yao, S., Narasimhan, K., & Griffiths, T. L. (2024). [Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427). *Transactions on Machine Learning Research*.
15. Tian, J., et al. (2026). [ABot-AgentOS: A General Robotic Agent OS with Lifelong Multi-modal Memory](https://arxiv.org/abs/2607.10350). arXiv:2607.10350.
16. Tsunomori, Y., & Higashinaka, R. (2024). [I Remember You!: SUI Corpus for Remembering and Utilizing Users’ Information in Chat-oriented Dialogue Systems](https://aclanthology.org/2024.lrec-main.811/). *Proceedings of LREC-COLING 2024*, 9285–9295.
17. Wang, L., et al. (2026). [Text2Mem: A Unified Memory Operation Language for Memory Operating System](https://aclanthology.org/2026.findings-acl.100/). *Findings of ACL 2026*, 2105–2119.
18. Wu, B., Wang, W., Li, H., Deng, Y., Li, Y., Yu, J., & Wang, B. (2025). [Interpersonal Memory Matters: A New Task for Proactive Dialogue Utilizing Conversational History](https://aclanthology.org/2025.conll-1.4/). *Proceedings of CoNLL 2025*, 47–67.
19. Wu, T., et al. (2026). [KnowMe-Bench: Benchmarking Person Understanding for Lifelong Digital Companions](https://aclanthology.org/2026.acl-long.1394/). *Proceedings of ACL 2026, Long Papers*, 30214–30238.
20. Wu, Y., et al. (2026). [StratMem-Bench: Evaluating Strategic Memory Use in Virtual Character Conversation Beyond Factual Recall](https://aclanthology.org/2026.acl-long.1491/). *Proceedings of ACL 2026, Long Papers*, 32309–32328.
21. Zhang, W., et al. (2026). [PersonaAgent: Bridging Memory and Action for Personalized LLM Agents](https://aclanthology.org/2026.findings-acl.1315/). *Findings of ACL 2026*, 26421–26439.
22. Zhong, W., Guo, L., Gao, Q., Ye, H., & Wang, Y. (2024). [MemoryBank: Enhancing Large Language Models with Long-Term Memory](https://doi.org/10.1609/aaai.v38i17.29946). *Proceedings of the AAAI Conference on Artificial Intelligence, 38*(17), 19724–19731.
23. Wang, K., You, H., Zhang, Y., & Wang, Z. (2026). [Memory-Driven Role-Playing: Evaluation and Enhancement of Persona Knowledge Utilization in LLMs](https://aclanthology.org/2026.findings-acl.1175/). *Findings of ACL 2026*, 23475–23510.
24. Wu, H., Tian, Z., Huang, Z., Hu, T., Qiao, L., Gao, Y., Liu, F., & Li, D. (2026). [Emotion Trajectory-aware Retrieval for Markov-driven Emotion Anticipation in LLM-based Emotional Support Conversation](https://aclanthology.org/2026.findings-acl.2127/). *Findings of ACL 2026*, 42887–42905.
25. Liang, S., Cao, P., Zhao, J., Teng, W., Liao, X., Zhao, J., & Liu, K. (2026). [Learning How to Remember: A Meta-Cognitive Management Method for Structured and Transferable Agent Memory](https://aclanthology.org/2026.findings-acl.1535/). *Findings of ACL 2026*, 30733–30753.

详细元数据、核验来源与各研究的适用边界见[文献来源台账](SOURCE-LEDGER.md)。

### 项目内一手材料

- [面向异构大语言模型 Agent 的宿主侧主动联想记忆中间件：研究综述、原生 DSH 对照、架构设计与实施路线（2026-08-19）](../../proactive-associative-memory-research-report.zh-CN.md)
- [从语义相关到唤起必要：个人记忆系统激活策略的回声陷阱发现、度量与修正](../../M7-ACTIVATION-V2-PAPER.md)
- [多语言嵌入式检索选型研究](../../M7-RESEARCH-PAPER.md)
- [M7 Activation v2 独立离线留出评测](../../M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md)
- [M7-8 受控 Live Shadow 报告](../../M7-ACTIVATION-V2-CONTROLLED-SHADOW.md)
- [S3：目标架构——分层契约与拟人化定位](../../S3-TARGET-ARCHITECTURE.md)
- [五大开源 Agent 记忆系统全景对比（2026-09）](../../MEMORY-SYSTEMS-SURVEY-2026-09.md)

---

## 研究声明

本文是截至 2026-10-15 的概念综述与研究议程，采用范围式叙述性检索，未执行系统综述的完整数据库检索与筛选流程。项目自身的检索和激活结果均按原始评测范围解释；没有将其表述为关系体验或人格效果的实证。本文不声称 Agent 具有意识、主观情感或人类意义上的主体身份。
