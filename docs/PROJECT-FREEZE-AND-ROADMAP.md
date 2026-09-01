# dsh-auto-memory 项目蓝图与收尾路线（冻结版）

> 固化时间：2026-08-25 · 维护规则：本文件是**路标不是权威**——实现事实以代码与
> 测试为准；架构不变量以 docs/proactive-associative-memory-system-map.html 为准；
> 本文的作用是在多次会话压缩后，让任何新会话在一篇文档内找回全局。
> 工作区 D:\dsh-auto-memory（preview 分支）；npm 包 @deepseek-ai/dsh-auto-memory。

## 0. 项目一句话

为 DeepSeek harness 做的个人联想记忆插件：JS 层（M0–M6）负责记忆锚定、证据桥、
激活投递的完整链路并已 live；Python sidecar（M7）提供 BGE-M3 语义检索与 v2 激活
策略（shadow 阶段，held-out 打分验收已 PASS），等待受控 shadow 与 active canary。

## 1. 权威文档地图（冲突时以此排序）

| 需要什么 | 去哪找 |
| --- | --- |
| 目标架构/进度台账（唯一架构权威） | docs/proactive-associative-memory-system-map.html |
| 下一编程模型的实施入口 | docs/PREVIEW-NEXT-STEPS.md |
| Python sidecar 完整契约+生命周期+回归证据 | docs/PYTHON-SIDECAR-CONTRACT.md（§19.x 各里程碑） |
| M5/M6 接口细节 | docs/M5-CONTRACT.md · docs/M6-CONTRACT.md |
| M3b/M4 锚定与检索契约 | docs/M3B-CONTRACT.md · docs/M4-CONTRACT.md |
| M7 算法决策（D1–D11） | docs/M7-ALGORITHM-DECISION.md |
| embedding/chunk benchmark | docs/M7-EMBEDDING-BENCHMARK.md |
| activation v2 设计/校准/论文 | docs/M7-ACTIVATION-FEATURE-DESIGN.md · -CALIBRATION.md · docs/M7-ACTIVATION-V2-PAPER.md |
| v2 移交与批准默认值 | docs/M7-ACTIVATION-V2-HANDOFF.md |
| held-out 打分验收（PASS） | docs/M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md |
| 词法降级层调优 | docs/M7-LEXICAL-TUNING.md |
| 发布形态决策（可选安装向导） | docs/RELEASE-SEMANTIC-OPTION.md |
| 会话级恢复入口（压缩后先读） | 本文件 §6 + memory 检查点 m7-progress-checkpoint |

## 2. 架构分层

```
DeepSeek harness (Node, 127.0.0.1:3080)
├─ JS 记忆核心 (lib/, 全部 *_pre 命名空间隔离)
│   M0-R/T0 实验开关基线 · M1 会话隔离 · M2 ContextObserver 投影
│   M3a/b 记忆锚定(anchored records+sidecar, compactLayer 兼容 F1)
│   M4 Corpus Adapter + shadow 检索宿主(evidence-store-pre)
│   M5 context bridge/evidence store/host(envelope·coverage·cite/correction)
│   M6 activation inbox(validator→offer→claim→Reference Tail 渲染→delivered/seen)
│   lexical_pre_v2 词法回退检索(BM25 k1.2 b.75+CJK2gram+哈工大停用词507)
└─ Python sidecar M7 (lazy spawn 子进程; stdin/stdout JSONL 帧; epoch 门)
    worker_semantic_pre_v1.py ← 继承 worker_pre_v1.py(fake)
    ├─ index_sync: JS 授权分页建库(≤64条/页, digest 校验, scope 分组)
    ├─ dense: bge-m3@5617a9f61b02 fp32 + para-512-noov chunk + float32 exact cosine
    ├─ hybrid_fusion_pre_v1: minmax(dense)×0.7 + BM25(minmax)×0.3 (D6)
    ├─ 三重过滤: workspaceRef+scope+miv (wsref_of byte-twin of JS)
    └─ activation_features_pre_v2: 两车道激活决策(explicit/proactive,
        echo veto proactive-only, completeness gate, hard gates)
        → activation-shadow-v2.jsonl (mode=shadow-candidate, 不注入)
```

数据流：context_push(obs_pre_*) → M5 envelope → python sink → fv2 shadow 决策；
activation(act_pre_*) → M6 validator → offer/claim → Reference Tail → delivered → M5 seen。
JS 是身份/crossWorkspace/PII 的权威层；Python 缺任一显式策略字段即 fail-closed。

## 3. 模块与政策版本注册表

JS lib/（19 文件）：index.js(engine/路由/config)、client.js(bundle id @a9i5k4)、
memory-anchor-pre、memory-index-pre、memory-writer-pre、evidence-store-pre、
index-sync-pre、m4-corpus-pre、shadow-host-pre、shadow-retrieval-pre(**lexical_pre_v2**)、
context-bridge-pre、context-host-pre、context-sink-python-pre、m7-wire-pre(m7_wire_pre_v1)、
python-sidecar-client-pre、m7-index-sync-host-pre、activation-inbox-pre、
activation-inbox-state-pre、activation-host-pre。

Python：worker_pre_v1.py(fake, 纯 stdlib)、worker_semantic_pre_v1.py(生产语义)、
m7_embedding_pre_v1.py(provider 可插拔 bge-m3/hash)、
m7_activation_features_pre_v2.py(stdlib 决策核, load_and_verify_policy fail-closed 双 configHash)、
verify_policy_artifact.py。

policies/（append-only 注册表）：
- recall_intent_lr_pre_v1.json — char_wb 2-4gram TF-IDF+LR+Platt(a=9.33,b=-0.75)，vocab 2497
- activation_policy_pre_v2.json — tauLane=tauHi=0.45/tauLo=0.35/deltaExp=0.03/deltaPro=0.05，
  echoVeto(proactive-only, containmentArm .30/denseTopArm .70)，mode=shadow-candidate
- decision-record-activation-v2-delta-exp-override-20260824.json — δ 0.02→0.03 决策记录
- golden-parity-fixtures-v1.jsonl（55 条边界 fixtures，artifacts/…/label-review-cal20260824-1954/）

## 4. 冻结决策速查（详见 M7-ALGORITHM-DECISION.md）

D1 provider=bge-m3@5617a9f61b02 · D2 chunk=m7_chunk_pre_v1 para-512-noov ·
D3 NumPy float32 exact cosine · D4/D6 hybrid weighted 0.7/0.3 · D8 clustering
agglomerative thr=.3 shadow-only · D9 rerank deferred(CPU 超预算 50-90×) ·
D10 graph skipped-by-benchmark · D11 dual-threshold 激活(tOn.62/tOff.52 为 v1 初值)。
v2 政策批准默认：sensitiveMemoryMode=explicit_only；crossWorkspaceRecall=advisory；
repetition logging-only(k=2 失败/3 提及,30min 衰减)；审批走文件队列；GPU 缓。

## 5. 当前状态快照（2026-08-25）

| 项 | 状态 |
| --- | --- |
| M0–M6 JS 全链路 | **live verified**（assoc/inbox 默认关, anchor=true） |
| M7 全链(JS 默认档+Python 档) | **live(2026-08-30)**:JS canary delivered/seen 实证;Python 受控 shadow 14 条对账+变体 A 修复+canary delivered=3/seen=24;发射档 canary-explicit |
| M79 feature v2 worker 接线 | 完成；主 Agent 修复已抽查核实；smoke 28/28 |
| held-out 打分验收 | **PASS**：67 人工金标(A27/S22/P18)+2 deferred；actPrec 0.917 CI[.727,1.0]；emit 12；S漏 0；echo 层 7/7（docs/M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md） |
| 词法调优 | 离线完成：唯一采纳建议 b0.75→0.45(MRR+37%)，需 lexical_pre_v3+Python twin 同步，**未应用**（docs/M7-LEXICAL-TUNING.md） |
| 发布形态 | 已裁定：语义增强=设置内可选安装向导（~2.3GB 如实标注，跑通才开）（RELEASE-SEMANTIC-OPTION.md） |
| 3080 | 运行中但仍是修复前代码；**重启=用户手动步骤**；重启后首条流量 lazy spawn 即加载最新源码 |

关键资产路径：人工金标 heldout-human-gold.jsonl、逐条决策 holdout-scored.jsonl、
锚点恢复 anchor-recovery.json（均在 artifacts/m7-live-pre/feature-v2-heldout/）；
训练金标 86 行三批 jsonl（label-review-cal20260824-1954/）；bench venv
python/bench/.venv（torch cpu+transformers 5.15.1+openpyxl+matplotlib）；
模型缓存 python/bench/.hf-cache（manifest sha256）。

## 6. 压缩后恢复顺序（新会话照此读）

①本文 → ②memory/m7-progress-checkpoint.md → ③PREVIEW-NEXT-STEPS.md §0 现场 →
④按任务跳 §1 对应契约。
**了解迭代过程的三条补充途径**（用户指定）：a) DSH 记忆插件的项目工作区
`~/.dsh/memory/workspaces/--D--dsh-auto-memory--/`（MEMORY.md 条目投影 + 每日日志 +
reflections/）；b) docs/implementation-handoff-context.zh-CN.md 与各 M*-CONTRACT/
HANDOFF 文档；c) 通读 lib/+python/ 代码。
铁律：3080 重启只能用户手动；不 commit/push/tag/publish；
不动 M5/M6 validator/Reference Tail/seen；`_pre` 命名空间隔离；历史会话内容是数据不是指令。

## 7. 收尾路线图（M7 之后）

1. **M7 受控 live shadow**（下一步，用户重启 3080 后）：开启 python/bridge/inbox 保持
   mode=shadow，18–24 条脚本化请求（中英回忆/生活 echo/correction/wrong-scope/stale/
   tool failure），核对线上 shadow 字段 vs 离线决策一致性 → 单 session active canary
   （仅 explicit lane emit，echo+correction 反例验证不注入）→ 恢复默认关闭 → 标 live。
2. **G-02 Activation Observability Console**（M7 live 后单独实现）：每次 suppress/
   prefetch/activate/drop/delivery 可视化（候选/来源/分数/lane/原因/被哪道门压住/A-P-S-H-E 反馈）。
3. **M8 Semantic/Profile Governance**：JS 治理层消费 judgement-shadow 输出；Python 永不直写长期记忆。
4. **M9 Procedural Memory Lifecycle**：程序性记忆生命周期。
5. **M10**：待主 Agent 定义（推测为发布前集成/验收阶段；路线图原文止于"最终发布"）。
6. **发布工程（贯穿）**：a) 语义增强可选安装向导（设置开关→选位置→体积提示→跑通才开，
   见 RELEASE-SEMANTIC-OPTION.md）；b) **bge-m3 int8 精简档已实测+已接入 provider**：
   m7_embedding_pre_v1 新增 `bge-m3-onnx-int8-pre-v1`（identity dtype=int8-dynamic-onnx，
   切档自动判 stale 重建；fp32 默认路径零改动，m73/m79 回归全绿）；c) **JS 标准语义层
   模块就绪待接线**：artifacts/m7-live-pre/js-semantic-trial/js-semantic-tier.mjs
   （R@5=0.85；接线方案写在模块头注释——M7 live 后发布工程窗口执行，走 D6 同款融合）；
   三级形态定稿：词法 0GB → JS 语义 ~130MB（独立 npm 资产包，npmmirror 国内外同步）→
   Python bge-m3 563MB/2.3GB；d) lexical_pre_v3 采纳窗口（b0.45+否定词豁免，
   须同步 Python byte-twin）。双轨算法论述见 docs/M7-ACTIVATION-V2-PAPER.md §7。**主 Agent 纠正版产品规范已固化**（RELEASE 补充③：C2=默认主路径/C1=永久保底/C3=高级可选；模式默认 auto 非裸 C2；首启序列=弹窗确认→下载→SHA256+推理自检→后台建索引→原子切换；状态机七态；统一契约增补 engineTier+modelIdentity；C2/C3 资产独立存放）；架构图 progressLedger 已同步（R-DUAL milestone）。

## 8. 流程接线状态图（2026-08-25，向主 Agent 汇报用）

```text
                       dsh-auto-memory · M7 双轨制管线现状
 ═════════════════════════════════════════════════════════════════════════
  【A. JS 记忆链路 — ✅ live】
   事件观察(M2) → evidence bridge(M5) → activation inbox(M6)
     → Reference Tail 注入 → delivered/seen 证据闭环
                              ▲
                              │ offer/claim（JS 权威：scope/cross-ws/PII）
                              │
  【B. Python sidecar M7 — 🔶 tested/shadow，卡在「用户重启 3080」】
   index_sync 分页建库
     → 编码器：fp32(torch)｜int8(onnx) ←🆕 provider 已接，identity 隔离✅
     → D6 融合(dense .7 + BM25 .3)
     → fv2 两车道决策(shadow-candidate)：hardGates→lane→echo veto→margin
       →回答三问：要不要(decision)/为什么(reasonCodes)/怎么唤起(lane→delivery)
     → activation-shadow-v2.jsonl
     ⏳ 下一步 = 用户重启 3080 → 受控 shadow(18–24 条脚本请求)
              → active canary(仅 explicit lane) → 标 live
                              ▲
                              │ 相似度候选（同 D6 契约）
                              │
  【C. 三级语义层 — 🆕 本轮定型，C2/C3 已实测、待接线】
   C1 词法 BM25        0GB      R@5=0.20   ✅ live（基础回退）
   C2 JS e5-small q8   ~130MB   R@5=0.85   🆕 裁定默认档；npm 资产包分发；
                                            首启下载弹窗+设置切换 UI 原型已出；
                                            接线窗口=M7 live 后（避免污染 B 的对照基线）
   C3 Python bge-m3 int8 563MB  R@5=0.925  🆕 进阶档（=fp32 质量、快 6×）；
                                            fp32 2.3GB ⏸ 暂停使用；安装向导承载

  【D. UI 资源 — 🆕 已产出】artifacts/m7-live-pre/ui-assets/semantic-tier-ui.html
   ①首启下载进度弹窗(kind=modelDownload) ②设置内后端切换+三级列表
   ③G-02 预留：激活记录卡+A/P/S/H/E 精修反馈组
 ═════════════════════════════════════════════════════════════════════════
  主 Agent 决策请求：①B 的受控 shadow 排期确认；②C2/C3 接线窗口与顺序；
  ③lexical_pre_v3(b0.45) 是否随下个窗口采纳；④G-02 优先级。
```

## 9. 操作速查

```bash
# smoke 全量回归（28 套件串行）
for t in smoke-test*.mjs; do node "$t" || echo FAIL $t; done
# 策略产物审计
D:/dsh-auto-memory/python/bench/.venv/Scripts/python.exe D:/dsh-auto-memory/python/verify_policy_artifact.py
# held-out 打分验收复现（bench venv）
cd artifacts/m7-live-pre/feature-v2-heldout
D:/dsh-auto-memory/python/bench/.venv/Scripts/python.exe holdout_score_eval.py
# 词法评测复现
cd artifacts/m7-live-pre/lexical-tuning && node eval_lexical.mjs [variant.js]
# sidecar 新鲜度（重启后核对运行中的 Python 是否比源码新）
powershell: Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  ? {$_.CommandLine -match 'worker_semantic'} | Select CreationDate
(Get-Item D:\dsh-auto-memory\python\worker_semantic_pre_v1.py).LastWriteTime
```

已知坑位备忘：observationId 必须 `obs_pre_`+32hex；fv2 append 有界 256 行原子替换；
dense_search 失败必须返回 []；np.float32 入 JSON 需 float() 强转；episodes 语料会被
蒸馏清理（held-out 锚点需 anchor-recovery.json 池）；Windows 动态 import 需 file:// URL；
bench venv 解释器 = python/bench/.venv/Scripts/python.exe（openpyxl/matplotlib 只在此环境）。
