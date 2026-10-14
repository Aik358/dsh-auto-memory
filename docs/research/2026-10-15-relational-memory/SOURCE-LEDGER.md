# Relational-memory review — verified source ledger

**Prepared:** 2026-10-15  
**Purpose:** primary-source inventory for the forthcoming review on context-conditioned, host-side memory use in long-term conversational agents. This ledger records what was verified and what each source can—and cannot—support. It is not the article draft.

## How to read this ledger

- **Verified** means the title, authors, date and core claims were checked against an official publisher, repository or DOI landing page on 2026-10-15.
- “Evidence” is paraphrased. The article should quote only short, copyright-compliant excerpts if needed.
- User-experience outcomes, model capability scores, and engineering traces are different evidence classes. They should not be collapsed into a single claim such as “personality.”

## Directly relevant relational-memory and disclosure studies

### RECALLbot (CHI 2026)

**Citation**  
Jiang, Zhaojun; Zheng, Chunyuan; Chen, Hongyi; Chen, Liuqing. 2026. “RECALLbot: Designing Agentic Memory and Reciprocal Disclosure for Human–Chatbot Relationships.” *Proceedings of the 2026 CHI Conference on Human Factors in Computing Systems*, 1–20. DOI: [10.1145/3772318.3790714](https://doi.org/10.1145/3772318.3790714).  
**Verification:** Crossref metadata; DOI/ACM record; Semantic Scholar record carrying the abstract. Crossref gives publication date 2026-04-13 and the four-author list.

**Short primary-source excerpt (7 words):** “In a two-week between-subjects study (N = 40)” (official ACM abstract, DOI page). This is the only verbatim excerpt from the paper included here.

**What it contributes:** An LLM social chatbot with two memory constructs—agent-oriented “Me Memory” and jointly formed “We Memory”—plus adaptive reciprocal-disclosure strategies and user controls. The abstract reports a two-week between-subjects study (*N* = 40) against a baseline without the agentic-memory/reciprocal-disclosure strategy; outcomes included perceived social identity, frequency/depth of self-disclosure and trust.

**Why it matters here:** It is direct evidence that memory construction and how a chatbot discloses memory can affect relationship-relevant user outcomes. It occupies the relational-memory space before this project’s proposed review; the review must cite it and avoid a “first relational memory” claim.

**Scope and limits (our methodological reading of the reported design):** The intervention bundles memory construction and disclosure, so the study does not isolate retrieval, activation, memory content, or disclosure style as separate causal components. The sample consists of existing social-chatbot users and the setting is a companion chatbot; this is not evidence for a model-agnostic host-side middleware, cross-provider portability, or work-versus-social mode switching. The “Me/We” memories also include generated persona/background and dialogue-derived material; they are not equivalent to a rigorously provenance-tagged autobiographical memory store.

### ForgetMeNot (IJHCS 2014)

**Citation**  
Richards, Deborah; Bransky, Karla. 2014. “ForgetMeNot: What and how users expect intelligent virtual agents to recall and forget personal conversational content.” *International Journal of Human-Computer Studies* 72(5): 460–476. DOI: [10.1016/j.ijhcs.2014.01.005](https://doi.org/10.1016/j.ijhcs.2014.01.005).  
**Verification:** [Elsevier ScienceDirect article/abstract](https://www.sciencedirect.com/science/article/pii/S1071581914000147) and Crossref metadata.

**What it contributes:** Early controlled work using a virtual real-estate agent over three sessions, with social and task-related personal information. The publisher’s highlights report that recall increased enjoyment, believability and trust, while partial/complete forgetting felt more natural than incorrect recall.

**Why it matters here:** It supports separating memory availability from socially appropriate recall and treating forgetting/restraint as a positive behavior. It is a useful precedent for an “appropriateness” or “restraint accuracy” metric.

**Scope and limits:** Pre-generative IVA technology and a small, specific task setting; do not generalize its effect sizes to modern LLM companions. The paper does not provide a host-side activation policy or a cross-context causal test.

### Referencing prior utterances and privacy (HAI 2023)

**Citation**  
Cox, Samuel Rhys; Lee, Yi-Chieh; Ooi, Wei Tsang. 2023. “Comparing How a Chatbot References User Utterances from Previous Chatting Sessions: An Investigation of Users’ Privacy Concerns and Perceptions.” *Proceedings of the 11th ACM International Conference on Human-Agent Interaction*, 105–114. DOI: [10.1145/3623809.3623875](https://doi.org/10.1145/3623809.3623875).  
**Verification:** Crossref/ACM DOI metadata and an [author-shared full paper](https://www.researchgate.net/publication/373016729_Comparing_How_a_Chatbot_References_User_Utterances_from_Previous_Chatting_Sessions_An_Investigation_of_Users%27_Privacy_Concerns_and_Perceptions).

**What it contributes:** A three-week, between-subjects study (*N* = 169) comparing no callback, paraphrased callback and verbatim callback to prior user utterances in a dental-flossing chatbot, with follow-up interviews (*N* = 15). Callbacks improved perceived intelligence/engagement, while verbatim recall raised privacy concerns.

**Why it matters here:** It directly motivates a separation between (1) retrieving a memory, (2) deciding that it should affect the answer and (3) choosing whether/how explicitly to disclose it.

**Scope and limits:** Health-adjacent, scripted chatbot context; results do not establish a general disclosure policy for companions or coding agents. The study is about reference form, not a full memory-activation architecture.

## Long-term memory, proactive dialogue and benchmark foundations

### ENPMR-Bench / emotional-need-aware proactive retrieval (Findings ACL 2026)

**Citation**  
Fu, Xing; Hu, Yulin; Ji, Mengtong; Li, Haozhen; Sun, Yixin; Zhao, Weixiang; Zhao, Yanyan; Qin, Bing. 2026. “ENPMR-Bench: Benchmarking Proactive Memory Retrieval for Emotional Support Agents.” *Findings of ACL 2026*, 41910–41933. DOI: [10.18653/v1/2026.findings-acl.2080](https://aclanthology.org/2026.findings-acl.2080/).  
**Verification:** ACL Anthology official page, citation metadata and abstract.

**What it contributes:** A benchmark of **Emotional Need-aware Proactive Memory Retrieval**, with more than 1,800 memory-augmented dialogues and a structured mapping between inferred emotional needs and supportive memory types. Its official abstract reports shortcomings for embedding- and LLM-based retrieval and an empathy gap relative to gold memory conditions.

**Why it matters here:** It is a direct prior art for both proactive retrieval and affective/relational memory evaluation. The proposed review must not claim that those topics have no benchmark or that proactive relational retrieval is itself novel.

**Scope and limits:** Emotional-support benchmark and synthetic/curated evaluation conditions, not an end-to-end, cross-provider host-side deployment or a longitudinal user relationship trial. “Empathy score” should not be equated with durable trust or agent identity.

### StratMem-Bench / strategic memory use (ACL 2026)

**Citation**  
Wu, Yerong; Wu, Tianxing; Zhu, Minghao; Sha, Hangyu; Wang, Haofen. 2026. “StratMem-Bench: Evaluating Strategic Memory Use in Virtual Character Conversation Beyond Factual Recall.” *Proceedings of ACL 2026 (Volume 1: Long Papers)*, 32309–32328. DOI: [10.18653/v1/2026.acl-long.1491](https://aclanthology.org/2026.acl-long.1491/).  
**Verification:** ACL Anthology official page, citation metadata and abstract.

**What it contributes:** A 657-instance benchmark with required, supportive and irrelevant memories. It defines Strict Memory Compliance, Memory Integration Quality, Proactive Enrichment Score and Conditional Irrelevance Rate; reported results show models cope with required/irrelevant memories better than nuanced supportive-memory use.

**Why it matters here:** It is perhaps the closest evaluation precedent for the user’s core intuition that “memory should be considered even when it is not a literal answer fact.” It also supports evaluating both use and restraint.

**Scope and limits:** Virtual-character response benchmark, not a causal multi-week user trial or a host-side runtime policy. The article may adapt or contrast its categories, but cannot claim to invent strategic-memory evaluation from scratch.

### KnowMe-Bench / person understanding (ACL 2026)

**Citation**  
Wu, Tingyu; Chen, Zhisheng; Weng, Ziyan; Wang, Shuhe; Zhang, Shuo; Hu, Sen; Wu, Silin; Lan, Qizhen; Wang, Huacan; Chen, Ronghao. 2026. “KnowMe-Bench: Benchmarking Person Understanding for Lifelong Digital Companions.” *Proceedings of ACL 2026 (Volume 1: Long Papers)*, 30214–30238. DOI: [10.18653/v1/2026.acl-long.1394](https://aclanthology.org/2026.acl-long.1394/).  
**Verification:** ACL Anthology official page, citation metadata and abstract.

**What it contributes:** A benchmark built from long autobiographical narratives, with time-anchored, evidence-linked questions for factual recall, subjective-state attribution and principle-level reasoning. Its official abstract reports that retrieval augmentation mainly improves factual accuracy, leaving temporal explanations and higher-level inferences difficult.

**Why it matters here:** Strong grounding for the distinction between “can retrieve user facts” and “can understand the person behind a request.”

**Scope and limits:** Narrative benchmark, not direct observation of real user–agent relationships or an intervention on when to reveal memories. “Person understanding” is still a benchmark construct, not proof of an agent’s personhood.

### Memory-Driven Role-Playing / MREval and MRBench (Findings ACL 2026)

**Citation**  
Wang, Kai; You, Haoyang; Zhang, Yang; Wang, Zhongjie. 2026. “Memory-Driven Role-Playing: Evaluation and Enhancement of Persona Knowledge Utilization in LLMs.” *Findings of ACL 2026*, 23475–23510. DOI: [10.18653/v1/2026.findings-acl.1175](https://aclanthology.org/2026.findings-acl.1175/).  
**Verification:** ACL Anthology official page, citation metadata and abstract.

**What it contributes:** Treats persona knowledge as a memory store that must be retrieved and applied from dialogue context without an explicit cue. It introduces MREval (Anchoring, Selecting, Bounding, Enacting), MRPrompt and the bilingual MRBench, evaluating 12 LLMs. This directly overlaps the proposal to measure whether a model brings relevant history into an in-character response without being asked.

**Scope and limits:** The target is faithful *role-playing against designated persona knowledge*, not a provenance-governed history of a real user–agent relationship or a longitudinal user trial. Reported model/benchmark gains cannot establish perceived identity continuity, trust or social benefit. Do not claim the first staged evaluation of memory-driven character responses.

### Emotion-trajectory-aware retrieval (Findings ACL 2026)

**Citation**  
Wu, Hongyan; Tian, Zhiliang; Huang, Zhen; Hu, Tengyue; Qiao, Linbo; Gao, Yifu; Liu, Feng; Li, Dongsheng. 2026. “Emotion Trajectory-aware Retrieval for Markov-driven Emotion Anticipation in LLM-based Emotional Support Conversation.” *Findings of ACL 2026*, 42887–42905. DOI: [10.18653/v1/2026.findings-acl.2127](https://aclanthology.org/2026.findings-acl.2127/).  
**Verification:** ACL Anthology official page, citation metadata and abstract.

**What it contributes:** A dynamic emotion-memory and hierarchical-retrieval framework that matches both semantic content and emotion trajectories; Markov-chain anticipation then informs emotional-support strategy planning, with evaluation on two datasets and two models. It is prior art for selecting memories using affective trajectory rather than a single-turn topical match.

**Scope and limits:** Evaluates emotional-support strategy/model performance, not host-side personal-memory activation across work/social purposes or durable relationship experience. Historical *examples* used for strategy anticipation should not automatically be equated with a consented autobiographical memory of the current user.

### MCMA / transferable memory abstraction (Findings ACL 2026)

**Citation**  
Liang, Sirui; Cao, Pengfei; Zhao, Jian; Teng, Wenhao; Liao, Xiangwen; Zhao, Jun; Liu, Kang. 2026. “Learning How to Remember: A Meta-Cognitive Management Method for Structured and Transferable Agent Memory.” *Findings of ACL 2026*, 30733–30753. DOI: [10.18653/v1/2026.findings-acl.1535](https://aclanthology.org/2026.findings-acl.1535/).  
**Verification:** ACL Anthology official page, citation metadata and abstract.

**What it contributes:** MCMA separates task execution from memory management via a trained memory copilot, which chooses abstraction level and reuse; it evaluates task success, out-of-distribution generalization and transfer on ALFWorld, ScienceWorld and BabyAI. It is a direct precedent for transferable *memory-management capability* rather than a fixed memory representation.

**Scope and limits:** Transfer occurs through a learned copilot and task-similarity abstraction; this is not evidence of a portable, externally governed host policy, cross-model social identity continuity, or user-facing relational benefit. It supports the “transfer” landscape, not a claim that MCMA studies privacy governance.

### LoCoMo / very long-term conversational memory (ACL 2024)

**Citation**  
Maharana, Adyasha; Lee, Dong-Ho; Tulyakov, Sergey; Bansal, Mohit; Barbieri, Francesco; Fang, Yuwei. 2024. “Evaluating Very Long-Term Conversational Memory of LLM Agents.” *Proceedings of ACL 2024 (Volume 1: Long Papers)*, 13851–13870. DOI: [10.18653/v1/2024.acl-long.747](https://aclanthology.org/2024.acl-long.747/).  
**Verification:** ACL Anthology official page and metadata.

**What it contributes:** LoCoMo, human-verified multi-session conversations (about 600 turns, up to 32 sessions) grounded in personas and temporal event graphs, with QA, event-summary and multimodal-generation evaluations. The paper shows that long-context and RAG methods improve results but still struggle with long-range temporal/causal reasoning.

**Why it matters here:** A capability baseline for temporal and causal memory. It can support the claim that “can retrieve/answer from long history” is necessary but insufficient for relationally appropriate use.

**Scope and limits:** Primarily a dataset/benchmark paper; it does not test relationship outcomes, explicit disclosure, user trust or a host-side policy.

### Timeline-based lifelong dialogue (NAACL 2025)

**Citation**  
Ong, Kai Tzu-iunn; Kim, Namyoung; Gwak, Minju; Chae, Hyungjoo; Kwon, Taeyoon; Jo, Yohan; Hwang, Seung-won; Lee, Dongha; Yeo, Jinyoung. 2025. “Towards Lifelong Dialogue Agents via Timeline-based Memory Management.” *Proceedings of NAACL-HLT 2025*, 8631–8661. DOI: [10.18653/v1/2025.naacl-long.435](https://aclanthology.org/2025.naacl-long.435/).  
**Verification:** ACL Anthology and Crossref metadata.

**What it contributes:** Timeline-based management for temporally and causally linked memories, with a long-term dialogue benchmark and an argument that stale memories should help explain user change rather than be treated as interchangeable facts.

**Why it matters here:** Supports temporal versioning and change-aware memory as prerequisites for a stable relationship model.

**Scope and limits:** Evaluation is primarily computational; there is no controlled social-companion study showing that timeline management improves perceived continuity or appropriateness.

### Interpersonal Memory Matters (CoNLL 2025)

**Citation**  
Wu, Bowen; Wang, Wenqing; Li, Haoran; Deng, Yunhan; Li, Ying; Yu, Jingsong; Wang, Baoxun. 2025. “Interpersonal Memory Matters: A New Task for Proactive Dialogue Utilizing Conversational History.” *Proceedings of CoNLL 2025*, 47–67. DOI: [10.18653/v1/2025.conll-1.4](https://aclanthology.org/2025.conll-1.4/).  
**Verification:** ACL Anthology and Crossref metadata.

**What it contributes:** A benchmark/task for proactive topic shifts grounded in interpersonal conversational history, with automatic and human evaluations.

**Why it matters here:** Directly supports the idea that conversational history can trigger useful proactive behavior even when the user’s current wording is not a direct semantic match.

**Scope and limits:** Benchmark/task contribution, not a longitudinal relationship experiment; no causal evidence that its proactive behavior improves trust, social identity or “personality.”

### User-information use in chat-oriented dialogue (LREC-COLING 2024)

**Citation**  
Tsunomori, Yuiko; Higashinaka, Ryuichiro. 2024. “I Remember You!: SUI Corpus for Remembering and Utilizing Users’ Information in Chat-oriented Dialogue Systems.” *Proceedings of LREC-COLING 2024*, 9285–9295. [ACL Anthology page](https://aclanthology.org/2024.lrec-main.811/).  
**Verification:** ACL Anthology official page; DOI metadata was not returned by Crossref in this check, so cite the Anthology URL rather than inventing a DOI.

**What it contributes:** Corpus/task material for using user facts when the present topic differs, while preserving contextual fit; useful for studying topical mismatch versus response usefulness.

**Scope and limits:** Corpus and generation evaluation; not evidence of a persistent relationship, user-controlled memory governance or causal social outcomes.

### MemoryBank (AAAI 2024)

**Citation**  
Zhong, Wanjun; Guo, Lianghong; Gao, Qiqi; Ye, He; Wang, Yanlin. 2024. “MemoryBank: Enhancing Large Language Models with Long-Term Memory.” *Proceedings of the AAAI Conference on Artificial Intelligence* 38(17): 19724–19731. DOI: [10.1609/AAAI.V38I17.29946](https://doi.org/10.1609/AAAI.V38I17.29946).  
**Verification:** AAAI DOI/Crossref metadata.

**What it contributes:** A long-term memory mechanism demonstrated in companion-style dialogue, including a system that uses retrieved history to support continuity and empathy/personality-oriented interaction.

**Scope and limits:** Mainly a memory-system design/evaluation paper; companion claims should not be treated as a controlled proof that any particular memory policy creates a stable interpersonal identity.

## Relational-agent and longitudinal social-chatbot foundations

### Long-term human-computer relationships (TOCHI 2005)

**Citation**  
Bickmore, Timothy W.; Picard, Rosalind W. 2005. “Establishing and Maintaining Long-Term Human-Computer Relationships.” *ACM Transactions on Computer-Human Interaction* 12(2): 293–327. DOI: [10.1145/1067860.1067867](https://doi.org/10.1145/1067860.1067867).  
**Verification:** ACM DOI/Crossref metadata.

**What it contributes:** Foundational relational-agent framing: socio-emotional behaviors, continuity and relationship maintenance as explicit design objectives rather than accidental by-products.

**Scope and limits:** Predates modern LLM memory and does not specify current retrieval/activation mechanisms. Use as conceptual grounding, not as evidence for modern host-side middleware.

### Longitudinal human–chatbot relationships (IJHCS 2022)

**Citation**  
Skjuve, Marita; Følstad, Asbjørn; Fostervold, Knut Inge; Brandtzaeg, Petter Bae. 2022. “A longitudinal study of human–chatbot relationships.” *International Journal of Human-Computer Studies* 168: 102903. DOI: [10.1016/j.ijhcs.2022.102903](https://doi.org/10.1016/j.ijhcs.2022.102903).  
**Verification:** [Elsevier ScienceDirect article/abstract](https://www.sciencedirect.com/science/article/pii/S1071581922001252) and Crossref metadata.

**What it contributes:** A 12-week qualitative follow-up of 25 Replika users. Interaction variety, self-disclosure and support for deeper needs helped relationship formation; unpredictable events and technical difficulties could hinder it or lead to termination.

**Scope and limits:** Replika study, not memory-policy manipulation; qualitative relationship findings cannot identify which specific memory mechanism caused an outcome.

### Psychosocial outcomes of extended chatbot use (2025 preprint)

**Citation**  
Fang, Cathy Mengying; Liu, Auren R.; Danry, Valdemar; Lee, Eunhae; Chan, Samantha W. T.; Pataranutaporn, Pat; Maes, Pattie; Phang, Jason; Lampe, Michael; Ahmad, Lama; Agarwal, Sandhini. 2025. “How AI and Human Behaviors Shape Psychosocial Effects of Extended Chatbot Use: A Longitudinal Randomized Controlled Study.” [arXiv:2503.17473](https://arxiv.org/abs/2503.17473); [MIT Media Lab project publication page](https://www.media.mit.edu/publications/how-ai-and-human-behaviors-shape-psychosocial-effects-of-chatbot-use-a-longitudinal-controlled-study/).  
**Verification:** Authors’ arXiv record and MIT Media Lab publication page; the latter describes a four-week randomized experiment, *N* = 981, with text/voice and conversation-type conditions.

**What it contributes:** A larger human-outcome comparison that measures loneliness, real-world social interaction, emotional dependence and problematic use rather than only satisfaction/trust. The MIT summary reports no significant randomized-condition effects and an association between heavier voluntary use and worse outcomes; that association must not be treated as proof that use caused harm.

**Why it matters here:** If the proposed middleware pursues stronger perceived relationship/identity, it should evaluate unintended dependence and human-social substitution as separate outcomes, not assume higher attachment is always beneficial.

**Scope and limits:** Not an intervention on memory retrieval or disclosure. Different preprint versions have slightly different titles/abstract emphasis, so cite a specified version or the official MIT summary when describing results.

## Systems adjacent to the proposed host-side policy

### PersonaAgent / memory-to-action personalization (Findings ACL 2026)

**Citation**  
Zhang, Weizhi; Zhang, Xinyang; Zhang, Chenwei; Yang, Liangwei; Shang, Jingbo; Wei, Zhepei; Zou, Henry Peng; Huang, Zijie; Wang, Zhengyang; Gao, Yifan; Pan, Xiaoman; Xiong, Lian; Liu, Jingguo; Yu, Philip S.; Li, Xian. 2026. “PersonaAgent: Bridging Memory and Action for Personalized LLM Agents.” *Findings of ACL 2026*, 26421–26439. DOI: [10.18653/v1/2026.findings-acl.1315](https://aclanthology.org/2026.findings-acl.1315/).  
**Verification:** ACL Anthology official page, citation metadata and abstract.

**What it contributes:** Episodic and semantic memory plus personalized actions, mediated by a user-specific persona prompt, with test-time preference alignment. This is prior art for adapting an agent to users across varied tasks.

**Scope and limits:** Framework centers on memory-to-action/prompt alignment, not an externally audited per-turn host-side decision over retrieval, activation and disclosure. Its task results are not evidence that relational continuity improves.

### Text2Mem / portable memory operations (Findings ACL 2026)

**Citation**  
Wang, Leo; Yang, Lihai; Chen, Boyu; Xu, Kerun; Zou, Gongyi; Tang, Bo; Xiong, Feiyu; Chen, Siheng; Li, Zhiyu. 2026. “Text2Mem: A Unified Memory Operation Language for Memory Operating System.” *Findings of ACL 2026*, 2105–2119. DOI: [10.18653/v1/2026.findings-acl.100](https://aclanthology.org/2026.findings-acl.100/).  
**Verification:** ACL Anthology official page, citation metadata and abstract.

**What it contributes:** Schema-based executable operations for encoding, storage, retrieval, promotion and lifecycle control, with multiple backends and a benchmark outline. It already establishes a portability/governance line of work.

**Scope and limits:** Addresses how memory operations are represented/executed, not which remembered content should silently or explicitly influence an answer in a specific relationship context. Do not claim that portable memory control or governance is unstudied.

### Project Sue (Zenodo, 2026-09-03)

**Citation**  
Liu, Zhehong; Su, Jingwen; Ren, Hao. 2026-09-03. “Project Sue: An Engineering Architecture for Persistent Persona and Relational Continuity in AI Companions.” Zenodo. DOI: [10.5281/zenodo.22263743](https://doi.org/10.5281/zenodo.22263743).  
**Verification:** Zenodo record API and attached bilingual Markdown/PDF. The abstract explicitly describes identity/persona, long-term memory, temporal heartbeat, dynamic state, environmental perception, action/non-action selection, self-revision and a longitudinal running instance.

**What it contributes:** An engineering architecture and case study for persistent companion operation, including proactive restraint, deferred sharing, relational continuity and policy evolution.

**Scope and limits:** It is an engineering case/reference architecture, not a controlled multi-user experiment. The record explicitly says its proposed metrics are future instruments and reports no completed benchmark or causal ablation. Do not use it as proof that companion memory improves user outcomes.

### Project Sue DSH (Zenodo, 2026-10-10)

**Citation**  
Liu, Zhehong. 2026-10-10. “Project Sue DSH: A Brain–Body-Decoupled Architecture with Persistent State and Machine-Native Interoception for Long-Term LLM Companions.” Zenodo. DOI: [10.5281/zenodo.23276103](https://doi.org/10.5281/zenodo.23276103).  
**Verification:** Zenodo record API and attached Chinese/English Markdown/PDF. The record states that the manuscript is not peer reviewed.

**What it contributes:** Extends the companion architecture toward persistent peripheral state, autobiography, lifecycle management and machine-native interoception.

**Scope and limits:** Longitudinal engineering case study, not causal evidence; do not conflate “persistent state” or “interoception” with phenomenal consciousness or relational-memory efficacy.

### Neuro-Symbolic Agentic RL for OC companionship (ACL 2026)

**Citation**  
Huang, Zhenhan. 2026. “Neuro-Symbolic Agentic Reinforcement Learning for Long-Term Original Character Companionship and Interaction.” *Proceedings of ACL 2026 (Volume 2: Short Papers)*, 530–539. DOI: [10.18653/v1/2026.acl-short.44](https://aclanthology.org/2026.acl-short.44/).  
**Verification:** ACL Anthology official page. The handoff’s abbreviated title is not exact; use the title above.

**What it contributes:** Models OC-companion interaction as a POMDP and decomposes Router, Memory and Persona policies; trains them with closed-loop RLAIF and verifiable rewards. The paper reports a trade-off between SFT’s persona generation and NSARL’s structural/workflow logic.

**Scope and limits:** Training method tied to a particular agent/model setup; not model-external middleware and not evidence for a portable host-side activation policy.

### ABot-AgentOS (arXiv:2607.10350)

**Citation**  
Tian, Jiayi; Liu, Shiao; Xu, Yuting; Lu, Jia; Guan, Zihao; Han, Honglin; Yang, Di; Gu, Minqi; Qian, Yifei; Zhang, Tianlin; Zhu, Yanqing; Ye, Zeqian; Yang, Menglin; Wang, Fei; Hu, Xu; Li, Xiuxian; Zhang, Wei; Su, Shihui; Ji, Yiyan; Wang, Jingbo; Feng, Ziteng; Liu, Jiaheng; Zhang, Zhaoxiang; Wu, Xiaolong; Tang, Zixiao; Gu, Zhining; Cai, Yang; Zheng, Linbo; Ma, Jingjing; Yin, Mingyang; Chu, Zedong; Tang, Wenbin; Xu, Mu. 2026. “ABot-AgentOS: A General Robotic Agent OS with Lifelong Multi-modal Memory.” arXiv:2607.10350. [arXiv page](https://arxiv.org/abs/2607.10350).

**What it contributes:** Robotic Agent OS with Universal Multi-modal Graph Memory, source-grounded typed nodes/edges, embodied benchmark tasks and failure-driven self-evolution. The abstract reports gains on LoCoMo and embodied/memory benchmarks.

**Scope and limits:** Memory is one module inside an embodied OS; the problem is robotic execution and multimodal memory rather than a host-side social/relational memory-use policy. Benchmark gains do not establish relational continuity or user-perceived personality.

### BRIDGE (ICML 2026)

**Citation**  
Jiang, Yinghui; Xu, Bocheng; Xie, Jianye; Sun, Haotong. 2026. “BRIDGE: Triangular Fixed-Point Refinement for Long-Horizon Persona Consistency.” *Proceedings of the 43rd International Conference on Machine Learning*, PMLR 306: 53280–53307. [PMLR page](https://proceedings.mlr.press/v306/jiang26aw.html).

**What it contributes:** Couples observable, latent and memory states before decoding, with a fixed-point refinement and persona-consistency evaluation on PersonaGym and CoSER. It is a strong precedent for treating memory/persona consistency as a measurable technical objective.

**Scope and limits:** Model-training/refinement method; not an external middleware and not a study of explicit memory disclosure, user governance or work/social context switching.

## Additional conceptual anchor

### Autobiographical memory and current goals (Psychological Review 2000)

**Citation**  
Conway, Martin A.; Pleydell-Pearce, Christopher W. 2000. “The construction of autobiographical memories in the self-memory system.” *Psychological Review* 107(2): 261–288. DOI: [10.1037/0033-295X.107.2.261](https://doi.org/10.1037/0033-295X.107.2.261).

**Use:** A conceptual analogy for cue- and goal-sensitive autobiographical retrieval. It can motivate context-conditioned recall, but the review must explicitly state that a cognitive theory is not evidence that an LLM or host middleware has a human self-memory system.

## Defensible gap statement after this scan

The literature now contains separate pieces: long-range retrieval benchmarks; affective proactive retrieval (ENPMR-Bench); strategic memory-use evaluation (StratMem-Bench); person-understanding evaluation (KnowMe-Bench); timeline and proactive-history mechanisms; studies of explicit callback style, privacy and forgetting; relational-agent theory; longitudinal companion studies; and at least one direct “agentic memory + reciprocal disclosure” intervention. The defensible gap for this project is their **integration as an externally auditable, model-agnostic host-side policy** that separates:

1. candidate retrieval;
2. activation/use decision;
3. degree of contextual consideration;
4. silent influence versus explicit disclosure;
5. user correction, provenance and deletion; and
6. mode/relationship-conditioned evaluation across task work and social/assistant exchange.

The proposed review should therefore claim an **integration, operationalization and evaluation agenda**, not a wholly new paradigm, the first relational-memory system, or the first benchmark for companion memory. Its distinctive evaluation opportunity is a **cross-context, component-wise causal design** linking host-side policy decisions to both task outcomes and human relational outcomes.

## Entries from the handoff that were verified or corrected

| Handoff entry | Status | Correction / use |
|---|---|---|
| Project Sue (2026-09-03) | **Verified** | Zenodo DOI 10.5281/zenodo.22263743; use exact title and case-study limits above. |
| ACL 2026 NSARL | **Verified, title corrected** | Exact title is “Neuro-Symbolic Agentic Reinforcement Learning for Long-Term Original Character Companionship and Interaction”; author Zhenhan Huang; ACL ID 2026.acl-short.44. |
| ABot-AgentOS | **Verified** | arXiv:2607.10350; use the full title and emphasize embodied Agent OS scope. |
| BRIDGE | **Verified** | PMLR v306, pp. 53280–53307; exact title “BRIDGE: Triangular Fixed-Point Refinement for Long-Horizon Persona Consistency.” |
| `sanctum-mind`, `ai-continuity-framework` | **Not independently verified in this pass** | Treat as engineering artifacts only after a direct repository/version audit; do not cite as peer-reviewed evidence. |

