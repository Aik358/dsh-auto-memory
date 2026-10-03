# 发布决策：语义增强的可选安装（Semantic Setup Option）

> 2026-08-25 用户裁定 · 归属：M7 live 之后的"最终发布"工程阶段 · 状态：已定方向，待排期

## 用户裁定的安装形态

"自动唤起"作为**可选功能**放进设置界面：

1. 设置中提供开关（默认关）；
2. 打开后进入安装向导：**用户自选安装/下载位置**，明确提示**约需 2GB 空间**
   （venv + torch CPU + BGE-M3 模型，见下方体积矩阵）；
3. 下载与自检（health/embedding 视图 ready）**全部跑通后才真正开启**该功能；
   任一步失败则保持关闭并回退纯 JS 词法链路（lexical_pre_v2，G8/H9 已断言
   Python 缺失时结果逐项不变）。

配套事实（已核实）：npm 包 `files=['lib','cordis.patch.yml']` 不含 python/；
`pythonBackendEnabled` 默认 false + assoc∧inbox∧pythonBackend 三重门；
SidecarClient spawn 失败 → circuit breaker → 结构化 unavailable → 词法回退。

## 体积方案矩阵（基于 docs/M7-EMBEDDING-BENCHMARK.md 实测）

| 方案 | 下载体积 | 质量(L2) | 延迟 | 结论 |
| --- | --- | --- | --- | --- |
| **bge-m3 fp32（现行冻结 D1）** | ~2.3GB | R@5 **0.925** / MRR 0.793，跨语言 20/20 | p50 129ms | 默认方案：效果冠军 |
| qwen3-emb-0.6B | ~1.2GB | R@5 0.825 / MRR 0.693 | p95≈500ms 压线，RSS 3.3–4.7GB | 不换：省一半盘却损质量且更吃内存 |
| multilingual-e5-large | ~2.3GB | 跨语言 0.60 已淘汰 | — | 否决先例 |
| bge-m3 int8/ONNX 量化 | ~0.6–0.9GB（估） | 未验证（通常损失 <1%，须实测） | 待测 | **post-live 评估项**：需 onnx 导出 + 全量 benchmark 重验 + policy/configHash 重冻结 |
| 小模型（<500MB 单/多语） | <0.5GB | 未测；e5 家族中文跨语有前科，风险高 | — | 仅在量化失败后再议 |
| 纯词法（不开语义增强） | 0GB | 即当前基础层 | 零 | 两级产品的下级，长期存在 |
| 云端 embedding API | 0GB | 取决于服务 | 网络 RTT | 违背本地记忆隐私前提，否决 |

## 结论

- 安装向导按 **~2.3GB** 如实标注；不为体积换掉效果冠军（qwen3 与 e5 的教训
  都在 benchmark 报告里）。
- "量化到 ~1GB 以内"列为 M7 live 后的独立评估项（含完整回归重验），若达标可
  在向导中作为"精简下载"选项提供，而非替换默认。
- 相关路线：M7 live → G-02 控制台 → M8/M9 → 本项 + 最终发布。

---

## 2026-08-25 补充：两项全网调研结论（已完成，待实测验证）

### A. bge-m3 量化版（Python 进阶层瘦身）——✅ 有现成产物，≤600MB 达成

| 项 | 结论 |
| --- | --- |
| **首选** | `Xenova/bge-m3` 的 `onnx/model_int8.onnx` = **542MB**（+tokenizer ≈563MB 总下载）。HF transformers.js 作者维护、76k 月下载、2026-02 仍在更新；quantize_config 确认为 ORT 标准 per_channel 动态 int8 |
| 质量证据 | 唯一用户反馈称 int8 与 fp32 打平（轶事级）；**全行业无公开 fp32-vs-int8 对照表** → 我们的 L2 R@5=0.925 基准复验即最终裁决；建议同时记录 fp32/int8 向量余弦均值（>0.99 绿灯） |
| 备选降级梯子 | GPUStack GGUF Q8_0 605MB → Xenova fp16 1081MB（略超线）→ optimum 自导出 avx512_vnni（⚠️ 社区教训：自导出曾掉 4–6 点，须核对 reduce_range/per_channel） |
| 关键风险 | CLS 池化必须自己切（`last_hidden_state[:,0]` + L2 归一）；GGUF 默认 mean 池化会静默毁掉检索质量；sparse/ColBERT 头不在任何 ONNX 导出里 |
| 否决项 | OpenVINO（无官方产物）、GGUF ≤Q6（零精度证据）、jina-v3（CC-BY-NC 非商用） |

执行路径：下 Xenova int8 → Python ORT/sentence-transformers 加载 → 复跑 L2 基准
→ 通过则以"精简下载"进安装向导。9700X（Zen4/5 AVX-512 VNNI）硬件适配。

### B. 纯 JS 标准语义层（普通版 npm 即用）——✅ 可行，载体 transformers.js

| 项 | 结论 |
| --- | --- |
| 运行时 | `@huggingface/transformers` v4（onnxruntime-node 预编译二进制，Windows x64 免编译直装；**锁版本**）。fastembed-js 上游已归档不用；tfjs USE 停滞不用；无需 ANN 库（几千条精确余弦毫秒级） |
| **主推模型** | `Xenova/multilingual-e5-small` q8 = **118MB**（总 ~130MB）：最成熟（15 万下载）、MIT。必须实现 e5 前缀约定 query:/passage:，max seq 512 ⚠️ 风险：e5 家族在我们 L1 测试有前科（large 版跨语言 0.60 被淘汰）——small 必须先过我们自己的 L2 基准 |
| **第一替补** | `Xenova/jina-embeddings-v2-base-zh` int8 = **161MB**：已发表 C-MTEB 强数字（T2Retrieval nDCG@10 80.6 / MMarco 78.0）、官方"中英混输无偏"设计、8192 ctx（长笔记友好） |
| 中间档（stretch） | `Xenova/bge-m3` int8 ≈560MB 可在**纯 JS** 跑与 Python 同源模型（dense-only）——可作高级用户的"免 Python 准 sidecar"或交叉验证工具 |
| 分发模式 | 首启按需拉取 + 本地缓存 = 业界标准（fastembed/transformers.js 先例一致），与我们已裁定的安装向导天然吻合；postinstall 静默下载是被社区视为恶习的做法，不做 |
| 待办 | **离线实测裁决**：用我们的 L2 语料对 e5-small-q8 / jina-v2-zh-int8 / bge-small-zh 各跑一遍 R@5/MRR/nDCG/negHit（复用 lexical-tuning 评测管线思路），数字说话后再定标准层选型；预期显著高于词法 0.20，能否过 0.5 未知 |

### 双轨（实为三级）产品形态定稿

1. **基础层**（0GB）：lexical BM25 词法检索——现状，人人可用；
2. **标准语义层**（~130MB，纯 Node）：transformers.js + 小模型 ONNX q8，
   npm 装完引导一次小下载即可启用；
3. **进阶层**（563MB 精简 / 2.3GB 完整，Python sidecar）：bge-m3 int8 或 fp32，
   安装向导可选，效果冠军。
层级间共享同一套 D6 hybrid 融合与激活策略接口；具体选型以 L2 离线实测为准。

---

## 2026-08-25 补充②：两级候选均已实测验证 ✅

### C. JS 标准语义层实测（transformers.js 3.7.6 + multilingual-e5-small q8）

环境：Windows x64 / Node 24 / onnxruntime-node 预编译二进制，模型本地离线加载。
评测：L2 真实语料（251 episodes / 40 手写查询，e5 query:/passage: 前缀约定，
mean pooling，512 token 截断）。产物在 artifacts/m7-live-pre/js-semantic-trial/。

| 层 | R@1 | R@5 | MRR | nDCG@10 | negHit@5 |
| --- | --- | --- | --- | --- | --- |
| 词法 BM25（基础层） | 0.05 | 0.20 | 0.129 | 0.140 | 0.075 |
| **JS e5-small q8（118MB）** | **0.60** | **0.850** | **0.703** | **0.760** | 0.225 |
| Python bge-m3 fp32（进阶层） | — | 0.925 | 0.793* | 0.837* | — |

\* fp32 行为 M7-2 生产口径（para-512 分块聚合）；JS 行为整篇截断口径，跨表对比仅供参考。
性能：模型加载 679ms；文档编码 21.8ms/条（全库 251 条 5.5s）；查询 3.8ms/条。
已知取舍：hard-negative 双子对的区分力弱于大模型（negHit5 0.225 vs 词法 0.075）。

### D. Python 进阶层 int8 精简版实测（Xenova/bge-m3 model_int8.onnx, 542MB）

同口径 head-to-head（整篇 512 截断协议，两侧同一代码路径；bge-m3 无前缀约定）：

| 后端 | R@1 | R@5 | MRR | nDCG@10 | negHit5 | 全量编码 |
| --- | --- | --- | --- | --- | --- | --- |
| **int8 (onnxruntime)** | 0.675 | **0.925** | 0.772 | 0.807 | 0.200 | **44s** |
| fp32 (torch) | 0.675 | **0.925** | 0.779 | 0.819 | 0.225 | 262s |

- **R@5 delta = 0.000**：检索质量与 fp32 完全持平；MRR/nDCG 差异为噪声级。
- 向量余弦 int8-vs-fp32 mean 0.9748（<0.99 但检索零损失，动态 int8 正常区间）。
- 编码提速 ~6×；查询延迟 p50 16ms / p95 19ms（batch=1，Zen4 CPU）。
- 产物：python/bench/models-xenova-bge-m3-int8/ + smoke_bge_m3_int8.py +
  l2_bench_int8_vs_fp32.py（bench venv 已加 onnxruntime 1.23.2）。

### E. npm 分发方案（用户裁定方向：国内国外统一源）

| 层 | 分发方式 | 说明 |
| --- | --- | --- |
| JS 语义层模型（118MB 单文件） | **首选：独立 npm 资产包**（如 `@deepseek-ai/dsh-auto-memory-model-e5small-q8`） | npmmirror 自动同步 → 国内 `npm i` 即得，无需任何运行时下载；插件以 `env.localModelPath` 指 node_modules 内路径离线加载。npm 大资产包有成熟先例（@imgly/*-data 等） |
| 同上兜底 | HF CDN 直连 / jsdelivr / GitHub Releases 多通道 | transformers.js 原生首启拉取路径；向导中作"在线获取"备选 |
| bge-m3 int8（542MB） | GitHub Releases / 对象存储多通道，向导内让用户选线路 | 单 tarball 过大不宜进 npm；沿用已裁定的安装向导（选位置→提示体积→跑通才开） |

### 三层最终状态（2026-08-25 用户最终裁定）

| 层 | 体积 | R@5(同口径) | 裁定 |
| --- | --- | --- | --- |
| 词法 BM25 | 0GB | 0.20 | 基础回退层（lexical_pre_v3 调优窗口另计） |
| **JS e5-small q8** | ~130MB | 0.85 | **默认语义层**：npm 安装后首次打开时引导一次性下载并自检启用 |
| Python bge-m3 **int8** | ~563MB | 0.925（=fp32） | 进阶层唯一形态（安装向导可选）；**fp32 2.3GB 暂不使用** |

裁定要点：①标准层走 npm 资产包分发，用户打开功能时同步下载一次即可长期离线使用；
②Python 端只预备 int8 量化版（实测与 fp32 检索持平且快 6×），fp32 全量下载暂缓；
③工程接线时机由主 Agent 排期——检索路由属 R1 收口冻结区，建议受控 live shadow
完成后再切默认，避免污染对照基线。


---

## 2026-08-25 补充③：主 Agent 产品与工程规范（纠正版已采纳，固化）

> 主 Agent 首轮曾误将 C1 定位为默认路径，经用户纠正后以下述规范为准：
> **C2=默认主路径，C1=永久保底（仅模型未下载/加载失败/离线/低资源时的可用性保障），C3=高级可选**。

### F. 产品行为规范（首启序列）

1. 插件首次启动先以 C1 运行，页面与对话立即可用；
2. 自动弹出一次 C2 安装向导（说明 ~130MB、用途、缓存位置、隐私边界）——弹窗必须出现，
   但下载须用户明确确认：「立即安装」/「稍后」双选；稍后继续 C1 并在设置保留入口；
3. 确认后后台下载资产 → **SHA-256 + 版本 + 维度 + 最小推理自检** → 通过则自动设为
   默认语义层并后台构建向量索引；
4. 建库期间继续使用 C1 不阻塞对话；C2 ready 后**原子切换**；
5. 断点续传；失败显示原因并继续使用 C1；
6. C3 只在「高级语义引擎」设置中出现，不自动下载、不自动覆盖 C2。

### G. 设置页规范

- 折叠组「语义检索引擎」：状态机 `未下载/下载中/校验中/建库中/就绪/损坏/更新可用`；
  展示模型版本、资产大小、缓存位置、最近校验时间、向量数量、索引版本；
  操作按钮 `安装/暂停/继续/重新校验/重建索引/卸载`。
- 追加项（2026-08-25）：`reasoningObserverEnabled`（模型思维链监听，默认关、需显式开启）
  与三级模式选择并列进入设置 UI；详见 docs/COT-WATCH-RFC.md。
- **模式选择（segmented control，默认 auto 而非裸 C2）**：
  `自动（推荐）`=C2 ready 则 C2 否则 C1｜`仅词法`=始终 C1｜`内置语义`=C2 失败回退 C1｜
  `高级 Python`=C3 失败先回退 C2 再回退 C1。

### H. 三层统一候选契约（在原字段上扩展）

`memoryId/anchorId/scope/sourceRef/sourceVersion/fileDigest/recordDigest/score/
method/rank` + 新增 **`engineTier`（C1|C2|C3）与 `modelIdentity`**。
切换比较键：`provider+model+revision+dimension+normalization+configHash`
不一致即 stale 重建。**C2/C3 的向量、索引、配置分别存放**——退出高级模式不得破坏 C2。

### I. 下载与更新安全清单

固定资产清单（模型 revision/许可/SHA-256）；临时文件下载校验后原子替换；
禁止执行模型包内脚本（只加载固定 ONNX/权重/tokenizer）；更新失败保留旧健康版本；
UI 显示实际下载源（直连/镜像）；卸载只删 derived 资产，不碰 Markdown/MemoryId/evidence。

### J. 排期裁定（主 Agent 确认）

M7 Feature v2 收尾不被 C2 打断；正式接入候选排序等 M7 live。发布工程窗口内部顺序：
`C2 Asset Manager + Download Wizard → C2 embedding/index adapter → fallback/router
(C2↔C1↔C3) → G-02 可视化与设置页`。允许并行预研：资产管理器与假模型适配器
（fake model adapter，不影响激活算法归因）。
