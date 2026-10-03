# M7-8 受控 Live Shadow 报告（2026-08-25 晚）

> 环境：用户 20:28 手动重启 3080（PID 5540，加载全部修复后代码）；三重门全开
> （pythonBackend/assoc/bridge/inbox/activationSource=python），决策模式
> shadow-candidate；embedding=bge-m3 fp32（fp32 口径与离线验收一致）。
> 发送方式：桌面自动化 #1–#6 + 用户手动 #7–#20，共 20 条脚本化请求，
> 覆盖中英回忆/混合/生活 echo/correction/wrong-scope/stale/tool-failure/计划/概览十类。

## 一、链路验证：全通 ✅

| 环节 | 证据 |
| --- | --- |
| lazy spawn | worker PID 10388（父进程=新 harness 5540），20:35:52 首流量启动 |
| index_sync | derived-corpus.json 20:36 更新；miv=idx_pre_bb0ef6047… 与向量文件**一致** |
| 编码+检索 | v1 候选影子每观测 8 候选，dense/fused 分数正常（top 0.63–0.73） |
| fv2 决策 | activation-shadow-v2.jsonl 基线 9 → **103 行（+94 观测）**，每条消息 ~4.7 个
  请求边界观测（agent 工具轮次各一次 pre-step push），policyVersions/configHash/goldDigest
  与冻结产物逐字段一致 |
| 安全性 | **零 Reference Tail、零 delivered、零 seen** —— shadow 契约完整保持 |

## 二、核心发现：stale 硬门语义过宽（94/94 全部 hard_gate_stale）

所有 94 个观测的 decision=suppress、reasonCodes=[hard_gate_stale]、features=null。

根因链：
1. fv2 的 stale 门实现为 `any(e.freshness=='stale' for e in payload.evidence)`；
2. 今天大量记忆文件被更新（本报告所属文档工作本身即是）→ anchored sourceVersion 升级
   → M5 evidence store 中历史证据相对新版本全部判 `freshness='stale'`；
3. 于是每个 context_push 都携带 ≥1 条 stale 证据 → 硬门全局触发 → fv2 在真实流量下
   退化为"常灭"。

对照：离线 held-out 验收（actPrecision 0.917）时 hardGates 全 False——该门在离线
从未被真实数据考验过；受控 shadow 的价值正在于抓到它。**shadow 模式正确兜住了
这个缺陷：零注入、零打扰。**

判定：这是 **over-broad gate 实现缺陷**（非数据问题、非策略阈值问题）。设计意图是
"候选引用的记忆已过期则不注入"，实现却变成"会话里存在任何过期证据即全局硬灭"。

## 三、修复（已实施，2026-08-25 深夜，用户直接授权）

采用方向 A 的最小侵入形式：**判定收窄在 worker 的门构造处**——stale/correction
仅当受影响 memoryId ∈ 当前 top-K 候选时触发硬门；决策核 `m7_activation_features_pre_v2.py`
与两份策略 JSON **零改动**（configHash 不变），golden parity 夹具零漂移。

验证：场景矩阵 7/7 PASS（相关 stale 触发硬门 / 无关 stale 放行 / 空证据放行 /
correction 对称 / 端到端 emit 路径恢复 / 相关 stale 仍压制）；m73 59/59、m79 20/20。
正式记录：`python/policies/decision-record-stale-gate-per-candidate-20260825.json`。

**生效条件**：需用户再次重启 3080 加载新 worker；然后复用同一份 20 条清单重跑受控
shadow，预期 stale 门行消失、明确回忆请求产生与离线重放一致的 emit/prefetch 决策。
后续夹具窗口应补入 stale 场景夹具。

## 四、当前状态结论

- M7-8 受控 shadow 第一步目的达成：**线上行为与离线的偏差点已精确定位并归档**。
- 在修复（需重启 3080 加载）落地前，M7 不满足进入 active canary 的条件（canary 要求 explicit lane 真实注入）。

## 五、第二轮（2026-08-25 晚）诊断与仪表

- 仪表：在 `_fv2_shadow_decide` 调试日志首行（CALLED 计费日志）增加 `nrefs`（payload.memoryRefs 长度，定位 explicit lane 的 candidateHit 供给）与 `nev`（payload.evidence 长度）及 workspace 末 16 字。单条消息即可定位断点。
- 离线复现整条 JS 链路（corpusSnap 104 条→ lexical kept 8/8→授权 8/8）全绿——memoryRefs 为空非算法问题，是运行时状态问题，需实测带仪表的 live 行判定。
- 产物：controlled-shadow-rows-20260825.json（94 行存档）、v1 候选影子 256 行、
  本报告。


## 五、第二轮实测（2026-08-26 凌晨）：四连断点全部打通 ✅

经三轮重启迭代，逐环修复并验证：

| 断点 | 根因 | 修复 | 验证 |
| --- | --- | --- | --- |
| stale 硬门 any() 过宽 | 会话证据流一条 stale 全局硬灭 | per-candidate 收窄 | hard_gate_stale 归零 ✅ |
| CoT 被 ContextObserver 丢弃 | assistant/chunk(reasoning-delta) 落入 ignored 分支 | 聚合缓冲+pre-step 冲刷+kind 白名单准入（权重 0.5） | 接线完成 ✅ |
| 会话跨天续接被标 child → push 全弃 | parentSession 判定误伤日常续接会话 | contextBridgeObserveChildSessions 开关（已开） | observe 日志确认 ✅ |
| 用户消息被判 plugin-generated | 续接会话的消息带 harness 来源标记 | 抑制收窄为仅拦本插件自家注入 | drop 归零 ✅ |

**nrefs=8 / nev=3 / ws=/dsh-auto-memory** —— memoryRefs 断供根因即 child-session+
plugin-generated 双重抑制，均已解除；JS→Python 管道 sent=35、accepted 正常。

## 六、新发现的策略层议题（待主 Agent 裁定，未擅自改动）

**candidateHit 生产定义与验收口径脱节**：验收时 candidateHit=expected∈dense-topK
（真值注入）；生产实现为 JS 词法 memoryRefs ∩ Python dense top-K。实测 12/12 观测
hit=False——两路召回在小语料+改述查询下几乎零交集（词法路与语义路天然分歧，
echo 类反而 dense 更高，§7.1 已证不可用绝对分数替代）。后果：explicit lane 的
emit 条件在生产结构性难以满足。

候选方向已离线实证（candidatehit_variant_study.py / _replay.py，63 main-set golds）：

| 口径 | emit | TP | precision | recall | emitOnSup |
| --- | --- | --- | --- | --- | --- |
| baseline（oracle hit，验收口径） | 12 | 11 | 0.917 | 0.478 | 0 |
| A) 补充词法臂命中（raw BM25≥8/12/20 三档） | 13 | 11 | **0.846↓** | 0.478 | 0 |
| A+B) A + 高意图无命中降级 prefetch | 同 A | — | — | — | prefetch 无可见效果 |

**实证结论**：放宽 candidateHit（方向 a）只多出 1 次 emit 且为误报（precision
0.917→0.846），recall 零收益——两路召回分歧处的新增"命中"不是 activate 目标。
方向 b 无损但也无指标收益（prefetch 本就无模型可见效果），可作为体验优化随窗口采纳。

**推荐裁定：c（维持双路共识高精度门槛）+ 顺带采纳 b**。生产 emit 结构性难达的
真正根源是检索召回债（denseTop 整体偏低、ep_* 目标排不进 top-8），正解在检索层与
M8 任务信号，而非放松激活门。M7 保持 shadow 至受控 shadow 全绿后议 canary。


## 七、C2 全链路独立验收（2026-08-26）：纯 JS 档通过 ✅

问题：C2（transformers.js + multilingual-e5-small q8）脱离 Python 后，能否独立完成
"CoT/文字 → 记忆拟合 + 唤起必要性判断"？实测方法：C2 语义检索出 top-8 候选后，
喂给**冻结的 fv2 决策核**（与 C3 验收逐字节同源），63 主集人工金标重放。

| 层 | 检索 R@5 | 决策 precision | recall | emitOnSuppress |
| --- | --- | --- | --- | --- |
| C1 词法 BM25 | 0.200 | — | — | — |
| **C2 JS e5-small q8（130MB）** | **0.609**（zh 0.706） | **1.000（4/4）** | 0.174 | 0 |
| C3 Python bge-m3 int8（563MB） | 0.925 | 0.917（11/12） | 0.478 | 0 |

结论：
1. **唤起必要性判断：C2 精度满分**——4 次 emit 全部正确、零误报、零 S 类泄漏；
   冻结策略在纯 JS 管道上行为与设计一致（保守但可信）。
2. **记忆拟合能力**：R@5 0.609 显著优于词法 0.20，为 C3 的 66%；英文偏弱
   （0.333）是已知取舍，中文主场景达标。
3. recall 缺口由两层弥补：用户可随时升级 C3；M8 会话级任务信号（repetition/
   toolFailures）补 proactive 召回。
4. 工件：js-retrieval-candidates.jsonl / js_pipeline_replay.py /
   js-pipeline-replay-metrics.json（feature-v2-heldout 与 js-semantic-trial 目录）。

**C2 作为默认档的判定成立。**
