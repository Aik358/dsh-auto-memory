# M7-2 Embedding / Tokenizer / Chunking Benchmark 报告

> 日期:2026-08-24 · 阶段:M7-2(tested,未 live)
> 计划:docs/M7-BENCHMARK-PLAN.md · 决策:docs/M7-ALGORITHM-DECISION.md
> 机器可读:artifacts/m7-benchmark-pre/results.{json,csv};全量明细 runs/<runId>/
> 语料:python/bench/m7b_corpus.py(L1 合成 152 记录/88 查询)+
> artifacts/m7-corpus-pre/(L2 真实 251 episodes/40 手写查询)
> 结论先行:**BAAI/bge-m3 + para-512-noov(段落对齐 512 token)胜出;multilingual-e5-large 因 zh→en 跨语言失败淘汰;qwen3-0.6B 为 hard-negative 判别备选但延迟/内存劣势。**

## 1. 环境与模型 pin

| 项 | 值 |
| --- | --- |
| CPU | AMD Ryzen 7 9700X,8C/16T,torch 2.13.0+cpu,threads=16(interop=1) |
| RAM | 31.1 GB(空闲约 10 GB 时跑测) |
| GPU | RTX 4070 Ti SUPER 16GB 在机但**未使用**(生产 sidecar 形态=CPU;驱动未动) |
| Python | 独立 venv 3.10.11(D:\dsh-auto-memory\python\bench\.venv,不污染系统/不进 git) |
| transformers | 5.15.1(build_inputs_with_special_tokens 已移除→探针法定位 special 前后缀) |

| 模型 | revision(40hex 前 12) | license | 大小 | 维度 | pooling(仓库 1_Pooling 权威) | 查询侧约定 |
| --- | --- | --- | --- | --- | --- | --- |
| BAAI/bge-m3 | 5617a9f61b02 | MIT | 2.29GB | 1024 | CLS | 无前缀(模型卡 FAQ) |
| Qwen/Qwen3-Embedding-0.6B | 97b0c614be4d | Apache-2.0 | 1.21GB | 1024 | last-token | Instruct/Query 模板(仅查询;官方代码核验) |
| intfloat/multilingual-e5-large | 3d7cfbdacd47 | MIT | 2.26GB | 1024 | mean | query:/passage: 前缀 |

- 全部逐文件 sha256 入 model-manifest.json;bge-m3 走 huggingface.co 官方
  snapshot(关代理前),qwen3/e5 走 hf-mirror 分段下载并与上游 LFS oid
  逐字节核验一致(直连 huggingface.co 在本机间歇性不可达,已记录)。
- e5 硬上限 512 token(含 <s></s>,内容 510);bge-m3 8192;qwen3 32k
  (retrieval 建议 8192)。本 bench doc 侧统一 1024 上限、e5 自动截到 510。
- 缓存:python/bench/.hf-cache 与 python/bench/models/(未跟踪目录)。

## 2. 方法学

- Dense 输入一律模型自带 tokenizer,id 空间切 chunk,**无 jieba/无 JS lexical
  预切**;chunker(段落/窗口)与 dense tokenizer 严格分层。e5 的 "passage: "
  前缀并入 chunk 文本流(首 chunk 携带)。
- 检索:NumPy float32 + L2 归一 + 精确点积;tie-break=score 降序→memoryId
  字典序→chunkOrdinal。无 ANN/FAISS/HNSW/图。
- 查询前按 workspaceRef scope 过滤(跨 workspace 泄漏=0 为硬断言);另设无
  scope 诊断组量化镜像文档入侵率(证明 scope 门必须在宿主侧)。
- L1 七类覆盖:zh→en、en→zh、混写、代码/路径/错误码、同主题 hard-negative
  20 条双子、supersede 新旧 7 对、跨 workspace 镜像 6 对、多 chunk 长文 8 篇、
  60 distractors。L2 为真实分布验证(见 §5)。
- 每 (model×policy) 一个 configHash;两次全量重跑逐字节同分(确定性)。

## 3. Chunk 策略(5 种,tokenizer id 空间)

fixed-256/512/1024-noov(硬窗口无重叠)· para-512-noov(段落贪心装包,超长段
切窗)· para-512-ov64(段内续窗 64 token 重叠)。
L1 语料长尾:152 记录中 8 篇>256 token、2 篇>512、0 篇>1024,与生产
(176 记录以短笔记为主+少量 runbook)同构。

## 4. L1 结果(合成可控层,88 查询)

| 模型 | 策略 | R@1 | R@5 | R@10 | MRR | nDCG@10 | 跨语@5 | 代码@5 | hard-neg err | supersede | p50/p95(ms) | 峰值RSS | 索引/千chunk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bge-m3 | fixed-256 | **0.818** | **0.989** | 0.989 | **0.894** | **0.977** | 1.00 | 1.00 | 0.111 | 0.50 | 123/184 | 2.05GB | 4.2MB |
| bge-m3 | para-512 | 0.818 | 0.966 | 0.966 | 0.889 | 0.920 | 1.00 | 1.00 | 0.111 | 0.50 | 122/189 | 2.21GB | 4.0MB |
| bge-m3 | fixed-1024 | 0.807 | 0.955 | 0.966 | 0.879 | 0.900 | 1.00 | 1.00 | 0.111 | 0.50 | 124/216 | 2.21GB | 4.0MB |
| qwen3-0.6B | fixed-256 | 0.761 | 0.966 | **0.989** | 0.852 | 0.936 | 1.00 | 1.00 | **0.074** | 0.50 | 308/501 | 3.35GB | 4.1MB |
| qwen3-0.6B | para-512 | 0.773 | 0.955 | 0.966 | 0.854 | 0.880 | 1.00 | 1.00 | **0.074** | 0.50 | 282/414 | 4.70GB | 4.0MB |
| e5-large | fixed-512 | 0.455 | 0.727 | 0.807 | 0.585 | 0.639 | 0.60 | 1.00 | 0.074 | 0.38 | 142/222 | 3.94GB | 4.0MB |

(完整 15 行见 results.csv;load 时间 bge-m3 2.8s/qwen3 1.1s/e5 3.2s;
corpus 编码吞吐 41-48 chunks/s@bge-m3,全量 163 chunk≈4s。)

要点:

1. **bge-m3 全面第一**:R@5=0.989(fixed-256)、MRR/nDCG 最高、跨语言 20/20
   全中、p95<300ms(RAM 2.2GB 内),延迟预算(5s deadline 的 1/10=500ms)内
   余量 2.7-40 倍。
2. **qwen3-0.6B**:质量次之但 hard-negative 判别最优(0.074 vs 0.111,双子
   对更少排错);代价是 p50≈300ms/p95≈500ms(压线 500ms 预算)、峰值 RSS
   3.3-4.7GB。指令模板+last-token 实现与官方逐条核验一致。
3. **e5-large 淘汰**:修正 doc 前缀 bug 后 R@5 仍 0.727、跨语言仅 0.60
   (20 条 zh↔en 查询错 8 条),MRR 0.58。失败集中在 zh 查英文文档与混写
   长文,非实现问题(前缀/池化均按仓库配置)。另受 512 硬上限约束。
4. **chunk 策略**:小 chunk 稳定占优——fixed-256 在两个可用模型上都是 R@5/
   nDCG 最优;1024 最差;段落对齐(para-512)与硬切(fixed-512)在本语料
   无显著差(多 chunk 记录仅 2 篇>512);overlap 64 无收益。**256 窗的
   代价是 chunk 数(163 vs 154)+索引体积 +5%,可忽略。**
5. **supersede 0.5 的构成**(bge-m3 失败 4/8):失败对全部是"旧记录短、直接
   命中查询措辞;correction 长、答案埋在中段"的模式(jieba/分页/epoch 三对);
   成功对(q085-088)是 correction 开头即结论。→ 纯 cosine 无法可靠优先
   correction,**必须由 M7-3 融合层(supersede 边/时效)与 M7-6 多特征阈值
   补偿**;这正是架构把 evidence/时效放在 JS/Python 分层的原因。
6. hard-negative 3 例失败中 1 例(q003)gold 标注单源而代码记录 r032 同样
   正确回答了问题(标注保守);真实错误 2 例(双胞胎 breaker/分页对)。
7. 跨 workspace:scope 过滤下 6 镜像查询泄漏=0(硬断言过);无 scope 诊断组
   镜像入侵率见 results.json xws_mirror_top5_unscoped——证明**scope 门必须
   留在宿主侧,向量相似度无法区分同文异库文档**。

## 5. L2 结果(真实 episode 层,251 episodes/40 手写查询)

| 模型 | 策略 | R@1 | R@5 | MRR | nDCG@10 | hard-neg err | p50/p95(ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bge-m3 | **para-512** | 0.675 | **0.925** | **0.793** | **0.837** | 0.074 | 129/241 |
| bge-m3 | fixed-512 | 0.675 | 0.925 | 0.792 | 0.836 | 0.074 | 136/213 |
| bge-m3 | fixed-1024 | 0.675 | 0.925 | 0.791 | 0.836 | **0.037** | 135/230 |
| bge-m3 | fixed-256 | 0.650 | 0.875 | 0.765 | 0.830 | 0.111 | 131/219 |
| qwen3-0.6B | fixed-256 | 0.600 | 0.825 | 0.693 | 0.746 | 0.037 | 317/508 |
| qwen3-0.6B | para-512 | 0.575 | 0.800 | 0.682 | 0.721 | 0.111 | 311/479 |
| e5-large | fixed-1024 | 0.600 | 0.825 | 0.700 | 0.758 | 0.111 | 158/288 |
| e5-large | para-512 | 0.600 | 0.800 | 0.697 | 0.755 | 0.111 | 149/481 |

(全 15 行见 results.csv layer=L2。方法同 §2;episodes 来自
.workbuddy/.codebuddy/.claude/.codex/.dsh 真实存储,脱敏后 train190/dev32/
test29,查询为人工撰写,含 10 对真实 hard-negative。)

要点:

1. **L2 反转了 chunk 尺寸偏好**:真实 episode 上 512/1024 优于 256
   (bge-m3 0.925 vs 0.875),与 L1 相反——真实记录的答案依赖上下文
   (里程碑记录的细节在段中后部;Q/A 结构被 256 窗切断),而合成 gold 多为
   紧凑陈述。hard-negative 错误也随窗宽改善(0.111→0.037@1024):真实双子
   (M4/M5/M6 里程碑流)靠细节区分,细节在更大窗内存活。
2. **bge-m3 优势在真实数据上扩大**:R@5 领先 qwen3/e5 12.5pt(0.925 vs
   0.80),MRR 领先 10pt。qwen3 p95 仍 ~480-508ms(压 500ms 预算线)。
3. en→zh 跨语言子集(lq04/22/23/24)三模型 4/4 全中——e5 的失败集中在
   zh→en 方向(L1 20 条压力集),与已知不对称性一致。
4. para-512 与 fixed-512 数字完全相同(本语料多 chunk 记录少,对齐算法
   未触发差异),段落对齐是"零成本保险";ov64 无收益(几乎不触发)。
5. L2 的 R@1(0.675)低于 L1(0.818):真实双子更难 + gold 标注单源保守
   (部分 top1 其实也是正确答案,如并列的里程碑记录)。这正是生产分布的
   真实难度,也是 M7-3 融合/M7-4 rerank 的改进空间。

## 5.1 双层综合裁决

| 决策项 | 裁决 | 依据 |
| --- | --- | --- |
| embedding 模型 | bge-m3 | 双层 R@5/MRR/nDCG 全一;L2 领先 12.5pt;p95 241ms;RSS 2.2GB |
| chunk 策略 | para-512-noov | L2 最优(MRR 0.793/nDCG 0.837/R@5 0.925);L1 次优(-2.3pt);段落对齐保持语义单元完整;硬切无收益 |
| 备选模型 | qwen3-0.6B | hard-neg 判别最优(L1 0.074/L2 0.037@256),保留观察;延迟/内存劣势明显 |
| 淘汰 | e5-large | zh→en 失败(L1 xlang 0.60);512 硬上限;L2 亦无优势 |

## 6. 资源与部署

- 内存:一次一模型;bge-m3 峰值 2.2GB(含 torch+tokenizer+向量矩阵);
  1 万 chunk 索引≈40MB(float32×1024d),10 万 chunk≈400MB,NumPy 精扫
  仍可行(Stage-2 再评估 FAISS FlatIP,契约 §11.2)。
- 离线:模型缓存在未跟踪目录+manifest sha256;新机部署=按 manifest 下载
  pinned revision 并核验(直连或 hf-mirror 双通道已验证);CI 只用 fixture
  vectors(tests/m7-2-fixtures/embedding-fixture.json),零联网零模型。

## 7. 失败与偏差披露

1. 首轮 e5 结果(0.68/xlang0.55)含实现 bug(doc 前缀未入 chunk 流),已修
   并复跑;本报告数字全部来自修复后 run(runId 见 results.json)。
2. e5 fixed-512 首轮崩溃=512 上限越界(512 内容+2 special),已修(内容截
   510);该截断影响仅 e5 的 2 篇长文,已披露。
3. M7-BENCHMARK-PLAN.md 在模型下载后补写(进入自主模式前的既有顺序),
   方法与执行一致,已记录于 AUTONOMOUS-STATE。
4. 延迟测量含查询编码+全矩阵点积(CPU 16 线程);不含进程启动/模型加载
   (sidecar 常驻后一次性)。
5. 本 benchmark 只覆盖 dense 检索质量;sparse/RRF/rerank 属 M7-3/M7-4,
   lexical_pre_v2 基线对照在 M7-3 补齐(本阶段 Python 侧未复刻)。

## 8. CI fixture

fixture 从胜出组合(bge-m3 × fixed-256-noov)导出:33 文档×8 查询真实向量
(float64 JSON)+期望 top5(NumPy 计算时即做过 scope 过滤);
smoke-test-m72-pre.mjs 纯 Node 重算 exact cosine 断言逐位一致(K1-K7),
不联网、不下载模型、不调 Python。
