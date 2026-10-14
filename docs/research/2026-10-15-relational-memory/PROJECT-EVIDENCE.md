# Project evidence ledger for the relational-memory review

**Prepared:** 2026-10-15  
**Purpose:** Fact-check appendix for the proposed conceptual/literature review on context-conditioned proactive memory in sustained human–agent interaction. This file separates project design claims, measured subsystem results, live-runtime evidence, and untested relational hypotheses. It is not the article's external literature review.

**Scope:** This is an audit of the cited historical research reports, not a fresh runtime test of the current release. The August 2026 shadow observations must not be presented as a claim that the October 2026 product still has the same defects.

## Executive assessment

The repository gives a credible technical foundation for a next-stage research program: it distinguishes retrieval relevance from activation eligibility, contains a measured “echo trap” failure case, has a reproducible retrieval benchmark, and has a frozen activation policy evaluated on author-adjudicated data. The repository does **not** yet demonstrate that proactive recall improves felt understanding, relational continuity, user preference, or perceived agent identity. Nor does the available live-shadow evidence demonstrate an end-to-end relational-memory intervention: the recorded shadow run delivered no memory tail, and subsequent online diagnostics found a production candidate-hit mismatch with the offline evaluation.

The new review can therefore make a strong foundational contribution by defining the problem, proposing an architecture and an evaluation agenda, and positioning the project as a testable research program. It should describe existing experiments as **retrieval/activation subsystem evidence**, not as evidence that the agent has acquired a personality or that users experience a stronger relationship.

The handoff's stronger product hypothesis—every user utterance should trigger a recall check, with a personality-oriented policy deciding how the memory is considered—should be stated as a **next-stage policy proposal**. The current repository evidence shows shadow observations, offline policy scoring, and host plumbing; it does not establish that every utterance currently causes a successful end-to-end retrieval-and-use cycle, nor that a memory is always made model-visible.

## Evidence grades and project sources

Use the following distinctions throughout the article:

| Grade | Meaning | Appropriate wording |
|---|---|---|
| Design proposal | An architecture, metric, or roadmap is specified in a project document. | “The report proposes…” |
| Offline subsystem result | A fixed corpus/query set was scored or replayed without measuring a live user experience. | “In this offline benchmark…” |
| Live shadow observation | The host observed real or scripted requests while withholding model-visible delivery. | “The shadow run observed…” |
| Delivered intervention | A memory was actually shown to the model, and resulting answers/user outcomes were measured. | Use only when the logs and study actually establish delivery and outcome. |
| Relational outcome | Human participants assessed continuity, felt understanding, appropriateness, preference, or related constructs. | No such project result was located in the reviewed corpus. |

“Held-out” should always be qualified by the exact split, overlap, memory corpus, and evaluation path. “Zero harmful injections” should always include how many harmful examples were present and whether anything was delivered to a model.

## What the project has established

### 1. The August 19 report established a research and architecture baseline

The report explicitly labels itself a **design baseline**, not a claim that all proposed features were implemented (`docs/proactive-associative-memory-research-report.zh-CN.md:5-10`). It defines the host-side mechanism as runtime-context observation, retrieval without a model-issued memory request, and controlled insertion before a subsequent model request (`…research-report.zh-CN.md:22-37`). It also distinguishes explicit tool search, automated post-turn work, and host observation plus next-request injection (`…:39-45`).

The report correctly treats an already-issued model request as a hard boundary and proposes next-step injection, post-tool-result injection, and high-risk stream interruption as different intervention points (`…:47-55`). Its target components—ContextObserver, SessionRuntime, AssociationEngine, InjectionBroker, ProviderCapabilityAdapter, EvidenceUpdater, and MemoryStore—remain a **proposed architecture** in that report (`…:302-329`). Its evaluation measures and ablations are likewise proposed, not results (`…:548-582`).

This is a sound foundation for the next paper's technical lineage: the August report asks **how memory can enter the next model request without an explicit model retrieval call**. The next paper can ask **how the purpose and relationship context should govern selection, use, and disclosure of that memory**.

### 2. The retrieval experiment measured a retrieval subsystem, not relationship quality

The M7 retrieval report describes two different evaluation layers: a controlled synthetic stress set of 152 records/88 queries and an author-derived real-corpus set of 251 episodes/40 manually written queries (`docs/M7-RESEARCH-PAPER.md:76-108`). In its reported L2 setting, BGE-M3 achieved R@5=0.925 and MRR=0.793; other configurations, including weighted dense/lexical fusion and model-sparse fusion, have their own metrics and must be named precisely (`…M7-RESEARCH-PAPER.md:11-18, 134-170, 193-230`).

These results support statements about retrieval quality under those corpora, query construction, and evaluation rules. They do not measure whether the user felt understood, whether an answer appropriately used a memory, whether explicit mention was welcome, or whether a continuing relationship was perceived. The L2 material is project/author-derived, not a multi-participant relational study (`…:96-108`).

The same report also supplies a useful design lesson: semantic similarity cannot enforce workspace boundaries; the report found cross-workspace mirrors entering top-5 without a scope gate and zero leaks with the gate in that experiment (`…:167-170`). This is a retrieval/governance result, not evidence of interpersonal appropriateness.

### 3. The activation experiment established a dataset-specific similarity/necessity distinction

The activation paper defines retrieval relevance as topical relatedness and activation eligibility as whether injecting a candidate now would materially help without disturbing the user (`docs/M7-ACTIVATION-V2-PAPER.md:31-46`). It reports an “echo trap”: a high-similarity restatement can be a suppress case, and reports that the top suppress score exceeded the strongest activate score in its 86 author-adjudicated examples (`…:132-136`). Its human-labelled set is described as three batches totaling 86 items, with A/P/S counts of 38/29/19 (`…:70-79`).

For the final corrected decision order and operating point, the paper's §5.3 and §5.8 report 11 emits, all correct, precision 1.000 and recall 0.289, with a wide Wilson interval for precision and an explicit warning that work-point selection occurred on the same 86-item set (`…:154-158, 182-195`). This supports a bounded claim: **on this author-specific labelled set, a conservative policy separated activation eligibility from similarity better than the earlier single-score threshold, especially for the tested echo cases.**

It does not support a claim that users experienced better relational understanding. The paper itself lists single-user external validity, threshold selection on the same gold set, retrieval-hit debt, and the lack of direct gold for repetition as limitations (`…:190-198`). The paper says the default production behavior was not touched and live shadow was still required (`…:267-273`).

### 4. The 67-item held-out report is offline score replay, not a user study or live delivery trial

The held-out report says the frozen artifacts were replayed, without retuning, over 67 human-reviewed items using a BGE-M3 + BM25/D6 path (`docs/M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md:3-10`). It reports 12 predicted emits, 11 correct (precision 0.917; pair-cluster bootstrap 95% CI [0.727, 1.0]), and no suppress-class emits (`…:11-26`).

Three qualifications are essential:

1. The report states that the held-out batch had **no harmful examples** and no dedicated correction/stale/PII cases; zero harmful emits therefore cannot be presented as demonstrated performance on harmful cases (`…:15-23`).
2. The report says the proactive lane emitted zero by design in round one, so this set does not establish the effectiveness of proactive delivery in that lane (`…:46-62`).
3. Its own table separates 44 “independent” from 19 “overlapping” examples; quote the split rather than calling all 67 fully independent (`…:48-62`).

The held-out artifact also records that four synthetic anchor memories had been cleaned from the live corpus and were reconstructed from vector excerpts and workspace logs before the replay (`…:38-44`). That provenance should accompany any claim about what retrieval corpus was tested.

### 5. Live shadow verifies plumbing and failure discovery, not user-facing efficacy

The controlled live-shadow report records 20 scripted requests and 94 request-boundary observations. It explicitly says there were zero Reference Tails, zero deliveries, and zero “seen” events (`docs/M7-ACTIVATION-V2-CONTROLLED-SHADOW.md:1-19`). In the first pass, all 94 decisions were suppressed by an over-broad stale gate; the report identifies this as an implementation defect and says the shadow contract prevented injection (`…:21-37`).

After wiring fixes, the report identifies a second evaluation/deployment mismatch: offline `candidateHit` used an expected-target oracle, while production required an intersection of JS lexical `memoryRefs` and Python dense top-K. The 12/12 observed requests failed that production intersection (`…:66-87`). Its offline variant study says widening the lexical route added an erroneous emit and reduced precision from 0.917 to 0.846 (`…:88-103`).

This is valuable engineering evidence about safe shadowing and the difference between offline and production decision paths. It is not evidence that the proposed policy improved delivered answers, because the cited run withheld delivery and exposed candidate supply problems.

The same report compares C2 JS and C3 Python **offline replays** on a 63-item main set; C2 has R@5=0.609 and 4/4 emit precision, while C3 has R@5=0.925 and 11/12 precision (`…:105-127`). These figures must not be described as live relational effects.

### 6. S3 gives the project a useful construct proposal, but its dimensions are not validated measures

S3 frames the project's anthropomorphic positioning as a second-person “agent that remembers you,” then proposes three engineerable dimensions: continuity, accountability, and appropriateness (`docs/S3-TARGET-ARCHITECTURE.md:95-125`). It self-assesses continuity and accountability as strong and appropriateness as medium/weak, with candidate proxies such as task recovery after window changes, evidence-chain coverage, user-ignore rate, and erroneous injection rate (`…:115-125`).

These are valuable **construct proposals and engineering proxies**. The repository does not show psychometric validation, a participant study, or evidence that these proxies predict felt understanding or perceived identity. The new article should call them proposed dimensions, and should operationalize and validate the human-facing constructs instead of treating S3's current labels as empirical findings.

## Repository and public-facing claims that need careful scope

The README describes a product narrative in which the host watches context and injects memories before a response, and it highlights 67 held-out items with 0.917 activation precision (`README.md:209-238, 297-333`). Those statements describe the product and offline subsystem results. They should not be used as proof of delivered benefit: the activation report names `shadow-candidate` mode, and the controlled shadow report records zero delivered/seen events (`docs/M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md:5-9`; `docs/M7-ACTIVATION-V2-CONTROLLED-SHADOW.md:11-19`).

The README also calls out a 0.925 Python tier; the retrieval paper reports multiple configurations, including a 0.975 fusion result. These may refer to different configurations, but the metric must be attached to a fully specified model/channel/corpus combination before use (`README.md:317-333`; `docs/M7-RESEARCH-PAPER.md:11-18, 193-230`). Similarly, README calls the JS tier approximately 130 MB while the activation paper's historical tier table gives 118 MB; this likely reflects different size accounting or document vintages and should be reconciled before presenting one canonical size (`README.md:317-333`; `docs/M7-ACTIVATION-V2-PAPER.md:208-218`).

The September systems survey explicitly says it combines a video summary—using the platform's AI summary—with repository READMEs as of 2026-09-06 (`docs/MEMORY-SYSTEMS-SURVEY-2026-09.md:1-5`). It is a useful landscape note, but not a systematic literature review and not a stable authority for current project status, benchmark claims, or novelty. The handoff's related-work list is likewise a set of literature leads, not proof that the proposed research gap is empty (`docs/internal/RESEARCH-HANDOFF-20261015.md:14-37`). Recheck primary papers, dated versions, and project artifacts before publishing any state-of-the-art or “missing field” claim.

## Metric and version ledger

Do not merge the following numbers into a single “activation accuracy” result:

| Evidence artifact | Evaluation scope | Reported result | Correct interpretation |
|---|---|---|---|
| `M7-ACTIVATION-V2-PAPER.md` §5.2 table | 54 evaluable examples for historical paths; final row separately reports 86-item endpoint | Historical v3a: P=.833/R=.682; v2c final: P=1.000/R=.289 | Different work points, versions, and denominators. The conservative final point is not the same operating point as v3a. |
| Same paper abstract vs §5.3/§5.8 | 86-item development/calibration gold | Abstract says P=.818/R=.237; §5.3–5.8 says corrected endpoint P=1.000/R=.289 | The abstract appears stale relative to the later corrected endpoint. Resolve this before publication; do not quote the abstract as the final endpoint. |
| `M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md` | 67 human-reviewed items, mixed independent/overlapping categories, offline frozen-policy replay | 11/12=.917 precision; 0 S emits; 0 harmful emits but no harmful items; proactive lane emits 0 | Offline replay only; do not claim harmful-case validation, proactive-lane success, or user-experience improvement. |
| `M7-ACTIVATION-V2-CONTROLLED-SHADOW.md` | 20 scripted requests → 94 boundary observations; first pass hard-gated; no delivery | 0 Reference Tail / delivered / seen; 94/94 stale-gated in first pass | Live plumbing and failure diagnostic, not a delivered intervention. |
| Same controlled-shadow report, C2/C3 | 63-item main-set offline replay | C2 R@5=.609, P=1.000 (4/4), R=.174; C3 R@5=.925, P=.917 (11/12), R=.478 | Different pipeline/configuration and stated denominator than the 67-item report; preserve artifact and split labels. |
| `M7-RESEARCH-PAPER.md` | L1 synthetic 152/88; L2 251 episodes/40 queries | BGE-M3 L2 R@5=.925/MRR=.793; other fusion arms differ | Retrieval-system performance only, under the stated corpus and query set. |

### Inconsistencies and denominator questions to resolve

1. **Activation paper abstract is stale or inconsistent.** Its abstract reports P=.818/R=.237 (`M7-ACTIVATION-V2-PAPER.md:15-18`), while the corrected-order result and final endpoint report P=1.000/R=.289 (`…:154-158, 182-184`). Before publication, either update the abstract or clearly state that it refers to an earlier work point.
2. **Held-out partition counts do not arithmetically reconcile as written.** The report says 69 reviewed minus 2 deferred equals 67; it then says the main set is 63 after subtracting 4 cross-workspace items, but separately reports the cross-workspace layer as n=6 (`M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md:25-36`). The table's 57 zh + 6 en = 63 appears to describe the main set, while subgroup counts list 44 independent + 19 overlapping = 63, leaving the four cross-workspace cases unclear. Confirm whether subsets overlap or whether one count is stale; do not reproduce “67” as a fully reconciled partition until resolved.
3. **Recall denominator varies across reports.** The 67-item report gives layer recalls and subgroup recalls; the 63-item C2/C3 variant study reports C3 recall .478. Since 11/27=.407 but 11/23=.478, the .478 value appears to use a different eligible-activate denominator or a different main set. Publish the exact TP / eligible-positive denominator for every recall figure.
4. **The 86-item headline mixes a tuned development set with held-out results in some summaries.** The activation paper cautions that the 86-item work point was selected on the same gold set; the 67-item replay is a separate frozen-policy artifact with its own composition and overlap qualifications. Keep these rows separate.
5. **Corpus configuration is not named consistently in short summaries.** The README's Python R@5=.925 and the M7 paper's higher fusion result R@5=.975 can both be true under different retrieval configurations. State model, dense/sparse/lexical channels, fusion weights, corpus version, and split alongside each number.
6. **Memory-size claims differ by vintage/accounting.** README says the JS tier is about 130 MB; the activation paper's earlier table says 118 MB. Identify whether the values are compressed download, installed footprint, or an earlier artifact before using them as a comparison.

## Proposed research questions grounded in this evidence

The repository supports asking these questions; it has not answered them yet:

1. **Context-conditioned value:** Does the utility of a memory change with interaction purpose (task execution, practical assistance, open-ended conversation, emotional support), even when the query and candidate memory are held constant?
2. **Recall versus use:** Holding the retrieved memory constant, does asking the model to consider its relevance to the ongoing relationship improve response quality or felt understanding compared with a neutral “historical reference” framing?
3. **Intervention level:** Which action is appropriate—silent adaptation, brief contextual hint, explicit mention, a user-confirmation question, delayed recall, or suppression—and how does this vary with context, sensitivity, confidence, and user preference?
4. **Relational continuity:** Do shared episodes, commitments, corrections, and unresolved topics improve perceived continuity across sessions beyond a profile of user facts alone?
5. **Mode transitions:** Can the policy respond appropriately when work and relational purposes coexist or change mid-conversation, rather than assuming a manually selected binary “work/personality” mode?
6. **Portability and identity perception:** When the underlying model changes but memory, policy, and interaction history remain, what aspects of continuity remain stable in users' judgments? Use “perceived continuity” rather than asserting that the same metaphysical agent persists.
7. **Governance and trust:** Do provenance, correction, consent controls, and visible explanations change acceptance of proactive memory, especially for sensitive or uncertain memories?

## Suggested experiment program

### A. Establish constructs before claiming “personality” effects

Treat S3's continuity, accountability, and appropriateness as candidate dimensions. Define observable behavior and human-reported constructs separately. Candidate behavioral measures include correct memory use, unsupported-memory use, source fidelity, unsolicited mention rate, unnecessary disclosure, ignored-memory recurrence, successful correction, and response deviation from the user's present intent. Candidate human judgments include felt understanding, continuity, naturalness, intrusiveness, trust, and pairwise preference. Validate the questionnaire items with participants; do not assume a proxy such as recall rate or user-ignore rate is itself a validated relational scale.

### B. Use a controlled factorial comparison

The canonical study design is now in [the review, Section 8](REVIEW.zh-CN.md). Hold the candidate memory, model, and literal utterance constant; randomize context-purpose conditions and cross **use framing** (neutral versus assess/use-if-helpful) with **disclosure permission** (avoid unsolicited explicit mention versus allow appropriate explicit mention). Match each of these four cells with an empty-memory control that retains the same instructions. Permission-seeking is a separate arm. Randomized policy assignment, actual model-visible exposure, faithful answer use, and actual disclosure must be logged and reported separately.

Compare automatic triggering, user-requested retrieval, and no-memory flows in a separate end-to-end trial. These flows can change intent, candidate supply, and exposure, so their total effects must not be described as the isolated causal effect of recall or prompt framing. “Ask the model to consider relevance” is an externally controlled instruction; it does not establish hidden internal reasoning. Evaluate answers, policy events, user outcomes, and harms.

Use randomized or counterbalanced within-participant assignment, blinded response ratings where feasible, multiple users and at least more than one underlying model, and conversation-level holdout. Determine sample size from a preregistered primary outcome and power analysis rather than choosing a convenient count. Report participant-level and item-level uncertainty, not just pooled accuracy.

### C. Build context-sensitive gold labels

The same memory/query pair should be adjudicated in more than one context. The echo-trap work already uses counterfactual pairs as a useful method (`docs/M7-ACTIVATION-V2-PAPER.md:81-95`), but the new labels must include interaction purpose, sensitivity/consent, user-stated preference, and acceptable intervention level. Have the user or participant supply the preference ground truth; use independent raters for response appropriateness, with adjudication rules fixed before test evaluation. Split by participant, conversation, and memory provenance to avoid leaking near-duplicate episodes.

### D. Report separate metrics for each stage

Keep at least four stages distinct:

1. **Retrieval:** was an appropriate candidate available in top-K?
2. **Activation:** should this candidate influence the current response?
3. **Use and disclosure:** was it used accurately, and was it appropriate to mention explicitly?
4. **Human outcome:** did the response improve the preregistered user-facing measure without increasing intrusion or privacy violations?

Report precision/recall with numerator and denominator; coverage; correct use; unsupported or stale use; harmful and unnecessary mention rates; silent-helpful-use rate; intervention-level distribution; task success where a task has an objective; latency/token overhead; and participant-rated outcomes. A suppress decision can be correct even when a relevant memory exists, and an accurate retrieval can still be inappropriate to disclose.

### E. Add longitudinal and governance phases

After an offline response-rating study, run a bounded longitudinal pilot with user control over memory review, correction, deletion, sensitive-memory modes, and per-context opt-in. Observe repeated interactions, not only one-shot examples. Test conflict, correction, forgotten or superseded facts, low-confidence inferences, explicit user requests, echoes, emotional transitions, and work-to-conversation switches. Keep active delivery gated until the online candidate path matches the offline path and harmful-case coverage exists.

## Recommended claim boundaries for the article and news post

The full review can confidently say:

- The project has a host-side proactive-memory design lineage and subsystem experiments on multilingual retrieval and activation gating.
- Its author-specific activation experiments show why semantic similarity alone is insufficient and motivate separating “what is related” from “what should influence this response.”
- The repository proposes continuity, accountability, and appropriateness as engineering dimensions, with appropriateness explicitly identified as the least mature.
- The proposed next phase is to test context-conditioned memory selection, use, and disclosure against user-facing relational outcomes.

It should **not** say, without a new study:

- proactive memory has been shown to make an agent feel more human, more caring, or more like the same person;
- the project has demonstrated relational benefit, a “soul,” consciousness, or a validated personality construct;
- the offline 0.917 or 1.000 precision figures are production effectiveness, end-to-end answer quality, or user preference;
- harmful-memory safety has been validated by a batch containing no harmful cases;
- the research field has no comparable work, based only on the September survey or the handoff's lead list.

For the public news item, the forward-looking message can be vivid while remaining accurate: the project is moving from **“can the system retrieve a relevant memory?”** toward **“when should a continuing agent let a memory shape its response, and when should it keep that memory to itself?”** Present this as a research question and experimental program, not an already demonstrated capability.
