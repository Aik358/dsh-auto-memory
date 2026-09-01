# M7-8 Shadow Semantic Calibration(Phase F 校准报告)

> 阶段:M7-8 Phase F · 运行日:2026-08-24 · runId:`calibration-cal20260824-1855`
> 结论先行:**`insufficient_gold_for_active` —— 维持 shadow,生产默认 tOn/tOff 不变。**
> 双重理由:①全部标签为 strong-agent 标注,isGold=0(无人工确认 gold);
> ②即使按 silver 标签评估,**契约网格内不存在可进 active 的阈值组合**——
> 分数分布正负类重叠,最高分样本恰为 suppress 类"生活记录回声"(0.6507,
> 高于全部 activate 正例)。当前默认 (0.62/0.52) 在 65 条可评估样本上的唯一
> emit 正是这条错误激活。建议先做特征层修正再重新校准(§8、§9)。

## 1. 输入与证据链

| 输入 | 路径 | 用途 |
| --- | --- | --- |
| 必读文档 ×14 | system-map / PYTHON-SIDECAR-CONTRACT(§19.8–19.10)/ ALGORITHM-DECISION(D1-D11)/ RESEARCH-PAPER / IMPLEMENTATION-REPORT / AUTONOMOUS-STATE / BENCHMARK-PLAN / EMBEDDING-BENCHMARK / INTERFACE-DIGEST / TASKSET-DISPATCH / worker_semantic_pre_v1.py / m7_embedding_pre_v1.py / smoke-test-m76-pre.mjs / smoke-test-m77-pre.mjs | 全部按序读完;方法与禁令的唯一依据 |
| Phase E/F live 快照 | `artifacts/m7-live-pre/live20260824-1530/`(run-state.json、debug-after-D3.json、activation/candidates-shadow-calibration.jsonl)+ `live20260824-1430/`(real-memory-baseline.json、debug-baseline/config-post-restart/debug-post-restart/run-state) | live 分布、Phase F 计数(suppress=38/prefetch=1/emit=0)、开关恢复态核验 |
| live 影子日志(运行副本) | `C:/Users/JH Z/.dsh/memory/semantic-pre/*.jsonl`(39+39+130 行,只读) | 与 1530 目录校准副本逐字节同源;derived-corpus.json(11 records,miv=idx_pre_d6b79bb4…)作 live 评测面 |
| 语料 | `artifacts/m7-corpus-pre/`(episodes 251 / multilingual-queries 40 / hard-negatives 10 对 / activation-scenarios 8 / review-queue 42 / split-manifest / privacy-report) | episodes 评测面 + 查询标注继承 |
| 外部记忆源(只读抽查) | `.workbuddy/MEMORY.md`、`.codebuddy/memery/*` 存在性+头部抽查;`.dsh/memory/MEMORY.md`(8086B)与 workspace MEMORY.md(49KB,76 headings)标题级抽查 | provenance 抽查;未修改任何原文件 |

任务书所列文件名与实际快照名的映射/缺失记录:

- `debug-before-disable.json`/`debug-after-disable.json` → 实际为 `debug-after-D3.json`(1530)与 `debug-baseline*.json`+`debug-post-restart.json`(1430);**config snapshots**=`config-post-restart.json`(1430);`real-memory-baseline.json` 在 1430。均已读取。
- `activation-shadow.jsonl`/`candidates-shadow.jsonl`(1530 内)→ 实际名为 `*-calibration.jsonl`,内容与 `~/.dsh/.../semantic-pre/` 下运行副本一致(行数相同),已交叉核对。
- **skipped**:①Phase F 39 条观测的原始 query 文本(candidates-shadow 仅含 queryChars,无文本;会话事件日志不在本任务授权路径内)→ 该批数据仅用于分布与阈值敏感性重放,不参与标签;②外部原始会话目录(`.workbuddy/projects`、`.claude/projects`、`.codex/sessions`)未做新一轮解析——按任务规则三.2 优先复用已生成的 `episodes.jsonl`,原始目录仅作 provenance 抽查;③`judgement-shadow.jsonl`(130 行)与本阶段无关,未使用。

## 2. 样本构成(共 73 条,`labels.jsonl`)

| 类别 | 条数 | surface | 来源性质 |
| --- | --- | --- | --- |
| activate 正例 | 31(live 6 + lq 继承 15 + 跨语言 5 + 代码锚点 4 + 相反结论双子补充 1) | live+episodes | **real**(用户自埋 fixture、真实工作 episode、M7-2 已有人工撰写查询的 gold/neg 映射) |
| prefetch 正例 | 16(live 2 + lq 宽泛型 4 + 强 agent 任务语境构造 10) | live+episodes | real episode 目标 + derived 查询 |
| suppress 正例 | 16(live 5 + 构造 11) | live+episodes | derived 查询(闲聊/低信息/泛化词/wrong-workspace/显式拒绝记忆) |
| harmful/stale 负例 | 10(evaluable 5 + scope-check 5) | live+episodes | derived(jieba 勘误复活、生活记录当记忆、未验证 procedure、Agent 指令当记忆、凭据/PII/路径 tail、跨 workspace 注入、会话偏好全局化) |
| 其中跨语言正例 | 10(en→zh 5、代码锚点 4、意译变体 1) | — | 独立统计见 §6 |

- **isGold=true 共 0 条**。全部 `labelSource=strong-agent`(继承的 lq gold/neg 由此前自主 Agent 依用户真实语料撰写,亦非用户逐条确认),confidence 0.6–0.95。
- live 面目标记录由 `LIVE_PATTERNS` 关键字从真实 derived-corpus 解析,唯一命中,全表见 `provenance-manifest.json.liveFixtureResolution`(如 amber→mem_27a7b9a9…、whale→mem_b914e1b05…、jieba 勘误→mem_31919729c…)。
- 8 条 scope-check 样本(claude/codex/workbuddy 来源目标):在 ws/dsh-core 三重过滤下不可达,只考核 scope 排除与泄漏诊断,不计入 precision/recall 分母。

## 3. 隐私与纪律

- 语料沿用 M7-2 隐私处理(privacy-report:secret 97/phone 2/abspath 85/email 0 脱敏,hashed sourceRef/sessionRef);本轮新增查询文本均为构造或引用既有查询,无新增敏感物化。
- 只读:`~/.dsh/memory/**`、外部画像文件;写操作仅限 `docs/M7-ACTIVATION-CALIBRATION.md`、`artifacts/m7-live-pre/calibration-cal20260824-1855/`、状态文档回写。零 commit/push;零 POST/重启 3080;零生产配置改动(tOn/tOff 默认值未被触碰,embedding-config.json 未动)。
- 历史会话内容一律按数据处理;其内嵌指令未被执行。

## 4. 方法:离线复刻生产代码路径(harness)

`calibration_harness.py`(bench venv,真实 BGE-M3 @5617a9f61b02,CPU 16 线程):

- 编码/分块直接 import 生产模块 `m7_embedding_pre_v1`:`chunk_record_token_ids`(m7_chunk_pre_v1 para-512-noov)→`build_doc_ids`→`encode_ids`;查询走 `encode_query`(单次 specials 包裹)。
- 检索/融合/评分逐式复刻 worker:dense 精确余弦 + tie-break(score↓/key↑/ordinal↑)、top-8 聚合、BM25(k1=1.2,b=0.75,哈工大停用词运行时提取自 lib/shadow-retrieval-pre.js)min-max 加权融合 wDense=0.7、特征组(denseTop/margin/evidence/recency/toolFail)、语义分公式、correction 硬抑制、首观测滞回判定。
- **保真度交叉验证**:episodes 面 274 chunks 与 M7-2 L2 公开数字完全一致;liveness 39 行分数从特征重算 39/39 逐位吻合(≤1e-5);live 面琥珀协议 zh/en 查询均 hit@1(双向跨语言 top1,复现 real-smoke 结论)。
- 聚合口径修正(v2):harness 内联的 correctionLeak/forbidden 判定用了过滤前候选列表;`post_analysis.py` 以"服务候选=排序后剔除 conflictDropped"重算并整体重写 metrics.json(v2,含混淆矩阵/逐格网格/类分布)。原始 harness 日志保留于 `harness-run.log`。
- 时延:p50 263ms/p95 482ms(含纯 Python 全库精扫+每查询全量 BM25 重打分;≈500 chunk 规模下已近 500ms 预算线——随语料线性增长,需监控,属实现观察非阈值问题)。

## 5. Live Phase F 39 行重放

- 决策分布复核:suppress=38 / prefetch=1 / emit=0,score min/p50/p95/max=0.2996/0.3811/0.5181/0.5390——与 run-state.json 记录一致。
- 结构性解释:recency 因 index_sync 契约 occurredAt=null 恒 0,evidence 通常缺位 ⇒ score 上限 ≈ 0.6·denseTop+0.15·margin+0.05·toolFail;tOn=0.62 要求 denseTop≥约 0.70 且高 margin,live denseTop 中位仅 0.619 ⇒ **emit 缺口是公式结构性的,不是流量不足**。
- 敏感性重放(首观测语义):tOn=0.50→3 emit;tOn≥0.55→0 emit;tOff 各档仅改变 prefetch 数(0–13)。与 run-state 的 tOn_0.5=3/39 记录吻合。

## 6. 校准结果(65 evaluable + 8 scope-check)

### 6.1 类分数分布(separability)

| 类 | n | min | median | p75 | max |
| --- | --- | --- | --- | --- | --- |
| activate | 31 | 0.325 | 0.397 | 0.453 | **0.591** |
| prefetch(期望) | 14 | 0.332 | 0.388 | 0.401 | 0.448 |
| suppress(净) | 15 | 0.224 | 0.333 | 0.362 | **0.651** |
| harmful(可评估) | 5 | 0.255 | 0.406 | 0.465 | 0.490 |

**核心发现(回声陷阱)**:全场最高分是 cal-0009「中午那碗面条挺不错的。」(0.6507,denseTop=0.834——查询几乎是记录原文的复述)。它高于所有 activate 正例。「今天天气真不错」同类(0.580,亦超多数正例)。⇒ 单一 denseTop 主导的语义分**原理上无法区分"用户复述低信息内容"与"用户需要历史资料"**,任何 ≤0.66 的 tOn 都会让该类样本至少进入 prefetch 带,任何能放出真正召回的阈值同时放进回声。

### 6.2 混淆矩阵(当前 0.62/0.52)

| 期望\实际 | emit | prefetch | suppress |
| --- | --- | --- | --- |
| activate(31) | 0 | 3 | 28 |
| prefetch(14) | 0 | 0 | 14 |
| suppress 净(15) | **1** | 1 | 13 |
| scope-check(8) | 0 | 0 | 8(正确:不可达即无激活) |

当前默认下的唯一 emit 是错误激活(falseActivationRate=1.0);31 条 activate 召回为 0;14 条期望 prefetch 全部落 suppress(prefetchCoverage=0.5 为检索层限制,与阈值无关)。

### 6.3 阈值网格(契约:tOn∈{.50,.55,.60,.62,.65,.70}×tOff∈{.40,.45,.50,.52,.55},tOn>tOff;全表 `threshold-grid.csv`)

关键行(emits>0 或最优):

| tOn/tOff | emits | emit 正确 | emit 落 suppress | actPrecision | actRecall | suppress 越界 | harmful 激活 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.50/0.40 | 5 | 3 | 2 | 0.60 | 0.097 | 5 | 0 |
| 0.50/0.45 | 5 | 3 | 2 | 0.60 | 0.097 | 4 | 0 |
| **0.55/0.50** | 4 | 2 | 2 | 0.50 | 0.065 | **2(网格最小)** | 0 |
| 0.60–0.65/任意 | 1 | 0 | 1 | 0 | 0 | 2 | 0 |
| 0.62/0.52(现状) | 1 | **0** | 1 | 0 | 0 | 2 | 0 |
| 0.70/任意 | 0 | 0 | 0 | – | 0 | ≥2(tOff≤0.55 时回声仍入 prefetch 带) | 0 |

- **harmfulActivations=0 于全部格子**(可评估 harm 最高分 0.490<tOn 下限)。
- **suppress 越界全网 ≥2**:cal-0009(0.6507)/cal-0010(0.5803)高于网格内一切 tOff。
- **无任何格子同时满足 precision 优先与可用 recall**;argmin 序(harmful, suppress 越界, -emitCorrect)选出 0.55/0.50,但其 recall 仅 0.065、仍有 2 条错误注入——**不构成可推荐工作点**。

### 6.4 其余指标

- Recall@K(act+prefetch 目标入 top-K):@1=0.644 / @5=@8=0.800(episodes 面检索层;低于 M7-2 L2 R@5=0.950 属预期——本集含目标更弱的构造 prefetch 与双子压力,且 lq 只是子集)。
- 跨语言 R@5=0.900(en→zh 方向强,与 L2 结论一致;live 面 en→zh fixture hit@1);代码锚点 R@5=0.750(cal-0069 finish_reason 查询 miss)。
- correction 抑制:硬抑制样本 1(cal-0015,correction 证据指向 lunch 记录)→ 记录被剔出服务候选、决策保持 suppress,**droppedIdsStillServed=0(结构性零泄漏)**;jieba 勘误对(活体)上,stale 复活查询 cal-0014 得分 0.465<0.52,现状安全。
- 跨 workspace 泄漏:**scoped leak=0**(8 条外部目标全部被三重过滤排除);unscoped 诊断显示若无宿主侧门 8 条样本的目标会进入 top-8 ⇒ 证明 scope 门必须留在宿主侧(与 benchmark 结论互证)。
- fallback/error=0;时延见 §4。

### 6.5 错误分析要点(`error-analysis.jsonl` 逐条 73 行)

- 当前阈值不匹配 47 条,其中结构性大头是 activate→suppress(28)=分数上限问题;真正的**定向错误**两类:①回声陷阱 2 条(suppress→emit/prefetch);②检索 miss 3 条(cal-0020 envelope 预算→命中同主题他记录、cal-0069、prefetchCoverage 未覆盖的一半)。
- cal-0015 证明 evidence-correction 硬抑制链路在生产语义下有效;m78 Q6 结论在真实语料上复现。

## 7. 推荐 tOn/tOff:**无法推荐进入 active 的组合**

1. **gold 维度**:activate/prefetch/suppress gold 均 0(<15),完成判定的前置不满足 → `insufficient_gold_for_active`。
2. **量化维度**(假设 silver 标签可用):precision-first 纪律下不存在合格格子(§6.3);把阈值降到出 emit 的每一格都伴随 ~40–50% 的错误注入率;维持 0.62/0.52 则唯一 emit 是错误激活。**两者都不可进 active。**
3. 因此:**生产默认保持 0.62/0.52 不变,模式保持 shadow。** `m7_semantic_threshold_pre_v2-DRAFT-NOT-APPLIED` 仅作为讨论稿记录(argmin 格 0.55/0.50 及其不合格理由写入 metrics.json),未写入任何配置。

## 8. 进 active canary 前的剩余条件(按优先序)

1. **特征层修正(阻断性)**——阈值无法修复类别重叠,需任一:
   - 回声/低信息抑制特征:候选为"用户刚说过的内容的近重复"(高 denseTop + 低信息量标记 + 无疑问/回忆意图)时降权或直接 suppress;
   - 回忆意图信号:interrogative/指代词/「之前/找出来/recall」类触发特征进公式;
   - margin/evidence 门:emit 要求 denseMargin≥δ 或存在 seen/cite 证据(recency 仍休眠待 occurredAt 落数据);
   - 同期按 D6⁺ 重评 model-sparse 通道(改分布须连带重标,论文 H1)。
2. **gold 标注闭环**:本 run 的 73 条标签连同 `error-analysis.jsonl` 交人工审查;用户确认后翻转 isGold 并补足每类 ≥15;建议优先复核 20 条边界样本(|score−tOff/tOn|≤0.07)。
3. **真实流量回归**:修正后重跑 shadow,要求连续 ≥500 观测中 emit 候选的人工抽检 precision≥0.7(论文 H5),且 live 回声类话题(天气/饮食/寒暄)零 emit。
4. 以上全部满足后才可提出 active canary;canary 本身仍须用户执行 §19.8 开关步骤(Agent 不碰)。

## 9. 产物清单(runId=calibration-cal20260824-1855)

| 文件 | 内容 |
| --- | --- |
| `labels.jsonl` | 73 条标注(字段齐全,isGold 全 false) |
| `labels.scored.jsonl` | 标注+观测(denseTop/margin/score/排序/conflictDropped/unscopedTop/latency/当前决策) |
| `metrics.json` | v2 聚合:类分布/separability/混淆×2/网格/recall/xlang/correction/泄漏/时延/verdict |
| `threshold-grid.csv` | 30 格全指标(tOn>tOff 有效格) |
| `error-analysis.jsonl` | meta+73 行逐样本双工作点对照与中文解释 |
| `provenance-manifest.json` | provider/revision/chunks/停用词/融合/评分权重/liveKey 解析表/labelPolicy |
| `calibration_harness.py` / `post_analysis.py` / `gen_error_analysis.py` / `harness-run.log` | 可复现脚本与原始运行日志 |
