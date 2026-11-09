# 【任务】事件聚类模型选型与调优 — 独立调研

你是一个独立调研 Agent。本任务**只读 + 实验**，不改生产代码。

## 工作目录
`D:/dsh-auto-memory`

## 必读背景（开工前先读，不要跳过）
1. `docs/internal/MAP-BATCH2-20261109.md` — 批次 2 测绘报告（为什么需要这件事）
2. 本文件全文 — 你的完整任务书

## 核心目标（一句话）
判断「用哪个 embedding 模型能让系统自动判断『这条新记忆该归到哪个事件』以及『哪些碎片该合并』」，
**优先 JS 原生方案**（绝大多数用户没有 Python/C3）。

## 三条硬纪律
1. **只读**：不得改 `lib/` 下任何生产文件；实验一律放 `artifacts/_regroup-model-eval-20261109/`
2. **真跑**：所有结论必须有本机实测数字，禁止用论文/榜单数字冒充；跑不出来的如实写「未测」
3. **可复算**：脚本 + 数据快照 + 固定种子，换台机器能跑出同样数字

---

# 任务书 v2 · 事件聚类方案的选型与调优（交给独立 Agent）

> 更新 2026-11-09（**v5**）| 性质：**只读调研 + 实验，不改生产代码**
> 上游：`docs/internal/MAP-BATCH2-20261109.md`、`docs/internal/CONSTRUCTION-PLAN-20261108.md`
> **版本演进**：v1 只测 C2 → v2 扩为 C2/C3/小模型三方 → v3 补入 C3 实际开发路径 → **v4 JS 原生优先成为主路径**（见 §0.5）→ **v5 用本机实测推翻了 3 条前提，并补齐方法论口径与判定门槛（见 §10，开工前必读）**。
>
> ⚠ **v5 最重要的一句**：§0.3 说「C3 int8 不需要 transformers」**是错的**（`m7_embedding_v1.py:270` 硬 import）；
> 但同时发现 **1024 维 bge-m3 int8 可以纯 JS 加载**（2930 ms / 1024 维 / L2=1.000000）。
> ⇒ 「1024 维只能靠 Python」这个前提不成立，实验 C 与 Q2 的写法必须改，详见 §10.1 / §10.6。

---

## 0. 已确认的事实（不要重复验证）

### 0.1 三档语义引擎的真实规格（代码事实）

| 档 | provider | 维度 | 模型 | 安装形态 | 本机状态 |
|---|---|---|---|---|---|
| **C1** | — | — | 无（词法） | 内置 | 可用 |
| **C2** | `xenova-e5-small-q8` | **384** | multilingual-e5-small q8 | **必装**（每个用户都有） | ✅ 已装 |
| **C3** | `bge-m3-onnx-int8-pre-v1` | **1024** | bge-m3 int8 | **选装**（高级功能） | ✅ **已装（开发路径）** |

代码依据：
- C2：`lib/embedding-config.js` `createJsEmbeddingConfigPre()` → `onnxFile: 'multilingual-e5-small/onnx/model_quantized.onnx'`
- C3：`lib/embedding-config.js` `createDefaultEmbeddingConfigPre(dshHome,'python')` → `provider:'bge-m3-onnx-int8-pre-v1'`, `dimension:1024`, `onnxFile:'model_int8.onnx'`，模型目录 `<dshHome>/python-engine/models/`
- C3 走 **Python sidecar**：`python/worker_semantic_v1.py`（84,744 B）+ `python/m7_embedding_v1.py`（16,902 B，含 `BgeM3Embedder` fp32 与 `BgeM3OnnxInt8Embedder` 两个实现）
- 档位解析：`lib/index.js:22154` `resolveSemanticTier()`，`semanticEngineMode==='python'` 才走 C3

### 0.1.1 C3 的实际安装位置（**开发路径，2026-11-09 实测**）

> ⚠ **重要**：C3 **已安装**，但不在产品默认路径 `~/.dsh/python-engine/models/`，
> 而在**开发者 bench 路径**。这是它此前被误判为「未安装」的原因。

| 项 | 值 |
|---|---|
| **实际路径** | `D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8/` |
| 与 C3 契约的对应 | `modelDir` = 上述目录；`onnxFile` = `'onnx/model_int8.onnx'`（见 `m7_embedding_v1.py:274`） |
| `onnx/model_int8.onnx` | ✅ **542.1 MB** |
| `tokenizer.json` | ✅ 16.3 MB |
| `config.json` / `tokenizer_config.json` / `special_tokens_map.json` | ✅ 齐全 |
| **config.json 关键字段** | `hidden_size = 1024`（与 C3 的 dimension 契约一致）、`model_type = "xlm-roberta"`、`architectures = ["XLMRobertaModel"]`、`max_position_embeddings = 8194`、`vocab_size = 250002` |
| git 状态 | 该目录在 `.gitignore` 中（`python/bench/models-xenova-bge-m3-int8/`）⇒ **不入库，需就地使用** |

**⇒ 结论：C3 可以在本机直接实测，无需下载。**

### 0.1.2 开发者 bench 路径下的**其他可用模型**（小模型选型的现成素材）

`D:/dsh-auto-memory/python/bench/models/` 下已有 5 个模型，**其中大部分可直接用于 Q3 对比**：

| 目录 | 体积 | 说明 |
|---|---|---|
| `qwen3-emb-0.6b/` | **1152 MB** | Qwen3-Embedding 0.6B（safetensors，非 ONNX） |
| `bge-reranker-v2-m3/` | 2187 MB | 重排模型，非 embedder（**仅作参考，不适用本任务**） |
| `multilingual-e5-large/` | 2157 MB | e5-large，C2 的放大版（**上界对照**，非小模型） |
| `qwen3-reranker-0.6b/` | 1152 MB | 重排模型（**不适用**） |
| `bge-m3/` | 0 MB | 只有 `sparse_linear.pt`，**不完整**（完整版见 0.1.1 的 int8 目录） |

> **注意**：这些是 **safetensors / torch 格式**，不是 ONNX。本机 **未装 torch/transformers**，
> 因此 **只能实测 ONNX 的那一个（C3 int8）**；其余需先转 ONNX 或装 torch，成本较高。
> **建议**：Q3 的小模型探索仍以「下载/寻找 ONNX 版本」为主，bench 下的 safetensors 可作为**上界参考**（如 e5-large 的表现），不必强行跑通。



### 0.2 本机 C2 实测（2026-11-09，47 个真实 active 事件）

| 指标 | 实测值 |
|---|---|
| 维度 / 归一化 | 384 / L2=1.000000 |
| 冷启动 | **1068 ms**（child-process） |
| 32 事件批量嵌入 | 1914 ms |
| **32 事件分数极差** | **0.0286**（0.8928 ~ 0.8643） |
| **top1−top2 margin** | **0.0031 ~ 0.0140** |
| 5 条查询 top-1 命中 | **1 / 5** |
| 示例正确事件排名 | 第 **23 / 32** |

**结论（已成立）**：C2 在**同质领域语料**上没有判定所需的区分度。这也是现有代码把 L2 限制为「只排序、不判定」的原因。

### 0.3 本机 Python 环境（C3 的前置）——**v5 已修正，原文有误**

```
python 3.14.6
numpy                ✅ 已装
scipy                ✅ 已装
onnxruntime 1.28.0   ✅ 已装
sklearn              ❌ 未装（ARI/NMI 自己实现，或用 scipy）
tokenizers           ❌ 未装
transformers         ❌ 未装
torch                ❌ 未装
```

> ❌ **v4 的这句是错的**：「C3 的 int8 ONNX 路径只需 onnxruntime，不需要 torch/transformers」。
> 事实：`python/m7_embedding_v1.py:270` 在 `BgeM3OnnxInt8Embedder.__init__` 里**硬 import**
> `from transformers import AutoTokenizer`。本机实测直接抛
> `ModuleNotFoundError: No module named 'transformers'`（完整 traceback 见 §10.1 P1）。
> ⇒ **Python 侧 C3 在本机跑不通**；要跑通得 `pip install transformers`（连带 tokenizers /
> huggingface_hub / safetensors / pyyaml），这与「不得新增运行时依赖」的约束直接冲突。
>
> ✅ **替代路径（v5 实测可用）**：同一个 `onnx/model_int8.onnx` 可以**纯 JS** 加载，
> 见 §10.1 P3 与 §4 的「C3 加载方式（v5 修正）」。C3 仍然必须实测，但走 JS。

---

## 0.5 【最高优先级】技术路线约束：JS 原生优先（用户裁定）

> 用户原话：「因为绝大多数用户是不装 C3，不建立 Python 环境，也不下载 torch 和 transformers 的，
> 所以我建议还是优先选择 JavaScript 原生支持的」

### 0.5.1 这条约束意味着什么

| 用户类型 | 占比（用户判断） | 具备什么 | 能跑什么 |
|---|---|---|---|
| **绝大多数** | 主体 | 只有 DSH + 插件 + C2（必装） | **只能跑 JS/ONNX 路径** |
| 少数进阶 | 很小 | 另装 C3（Python + 模型） | C2 + C3 |

> ⚠ **v5 修正这张表的第三、四列**：C3 的 1024 维 int8 模型**可以纯 JS 加载**（§10.1 P3），
> 所以「少数进阶 = 装了 Python」这个等式不成立。正确的两档应该是：
> **① 只有 C2（118 MB）② 额外下载了 bge-m3（542 MB）** —— 差别是**磁盘与下载**，不是 Python。
> Q2 的降级链/提示文案必须按这个重写（§10.6 Q4）。

⇒ **任何新方案都不能把「装 Python / 装 torch / 装 C3」作为前置条件。**
⇒ C3 的结论只能用于回答「**给已经装了的人**能不能额外获益」，不能作为主路径。

### 0.5.2 好消息：JS 侧换模型的成本**远低于预期**（已实测）

我把现有 C2 的通路跑通了，关键在于：

```
lib/semantic-js-worker.js:79
  extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
lib/semantic-js-worker.js:16
  const MODEL = 'multilingual-e5-small'
```

这是 **HuggingFace transformers.js 的通用 pipeline**，不是 e5 专用代码。
**实测验证**：`pipeline('feature-extraction', 'multilingual-e5-small', { dtype:'q8' })`
从本地目录加载成功（846 ms），输出 Float32Array(384)。

⇒ **换模型 = 换 `localModelPath` + 换 `MODEL` 常量**，不需要新的运行时依赖。

### 0.5.3 但有 **5 处硬编码**（H1–H5）必须同步改（这是真正的成本）
> v5 注：v4 标题写「3 处」但下表列了 5 条，已改为 5。H1/H2/H3 是真阻塞（不改就抛错或降质），H4/H5 是容量与探测口径。

| # | 位置 | 内容 | 换其他模型时的后果 |
|---|---|---|---|
| **H1** | `semantic-js-worker.js:60` | `if (vector.length !== 384) throw` | **维度不是 384 的模型会直接抛错** —— bge-small-zh(512) / bge-m3(1024) 全部命中 |
| **H2** | `semantic-js-worker.js:58,80,89,93` | 强制加 `'query: '` / `'passage: '` 前缀 | e5 需要这个前缀；**bge 系、多数中文模型不需要**，加了可能反而降质 |
| **H3** | `semantic-js.js:326` | 探测固定路径 `multilingual-e5-small/onnx/model_quantized.onnx` | 换模型要改探测逻辑，否则「资产缺失」误判 |
| **H4** | `semantic-js.js:375` | `POOL_MAX` 注释按 384 维算内存（30MB） | 1024 维时同一条目数约 80MB，需重算 |
| **H5** | `embedding-config.js` `createJsEmbeddingConfigPre` | 固定 `onnxFile: 'multilingual-e5-small/onnx/model_quantized.onnx'` | 同上 |

**⇒ 任务要求：换模型不是「改一行」，而是「改一处常量 + 维度改为参数化 + 前缀改为按模型配置」。**
请给出**参数化方案**（模型名 / 维度 / 前缀 / onnx 路径 四元组放进配置），而不是硬改常量。

### 0.5.4 JS 原生候选池（**必须全部走 ONNX + transformers.js 可加载**）

优先在 `huggingface.co/models?library=transformers.js` 里找，或 `onnx-community/*-ONNX` 组织下的模型。

> **v5 已抓取 HF 仓库树**（`/api/models/<id>/tree/main?recursive=true`，2026-11-09），实际字节数如下。
> 复算脚本：`artifacts/_regroup-model-eval-20261109/scripts/00-probe-hf-onnx.mjs`，
> 落盘 `artifacts/_regroup-model-eval-20261109/out/hf-onnx-inventory.json`。
> **「参考体积」不要再用 README 的模糊说法，用下表字节数。**

| 候选 | 维度 | q8 实际字节 | tokenizer.json | ONNX 状态 | 备注 |
|---|---|---|---|---|---|
| **multilingual-e5-small**（=现 C2） | 384 | **118,308,185 B（112.8 MiB）** 单文件，本机已装 | 17,082,730 B | ✅ 已装 | **基线，必须参与对比** |
| **bge-small-zh-v1.5** | 512 | **`Xenova/bge-small-zh-v1.5` 22.9 MiB 单文件（优选）**；`onnx-community/…-ONNX` 168,002 B + `.onnx_data` 23,774,208 B（拆片） | 0.4 / 16.3 MiB | ✅ 两处都有 | **最贴合小模型目标**，中文强 |
| **bge-small-en-v1.5** | 384 | `onnx-community` 413,666 B + `.onnx_data` 33,393,408 B（拆片） | 0.5 MiB | ✅ 有 | 维度同 C2（H1 不用改），中文弱 |
| **all-MiniLM-L6-v2** | 384 | **21.9 MiB 单文件**（`Xenova/all-MiniLM-L6-v2`） | 0.7 MiB | ✅ 有 | **最小之一**，license=apache-2.0 |
| **gte-small** | 384 | 32.4 MiB 单文件 | 0.7 MiB | ✅ 有 | 多语，维度同 C2 |
| **jina-embeddings-v2-small-en** | 512 | 31.2 MiB 单文件 | 0.7 MiB | ✅ 有 | 英文为主 |
| paraphrase-multilingual-MiniLM-L12-v2 | 384 | 112.8 MiB 单文件 | 16.3 MiB | ✅ 有 | **无体积优势**（与 C2 同级） |
| **bge-m3 int8**（=C3） | 1024 | **542.1 MiB（568,456,694 B）**，本机在 `python/bench/models-xenova-bge-m3-int8/` | 16.3 MiB | ✅ 已装 | `onnx-community/bge-m3-ONNX` license=**mit** |
| nomic-embed-text-v1.5 | 768 | 未抓（不在本批优先） | — | 待查 | 体积不占优 |

> ⚠ **v5 新增两个选型陷阱（都会让 Agent 白跑一轮）**：
> 1. **`onnx-community/*-ONNX` 新仓库普遍用 external data 拆片**：`onnx/model.onnx` 只有几百 KB，
>    权重在同目录 `model.onnx_data` 里；`Xenova/*` 是**单文件**。只按文件名取 `.onnx` 时可能取不到
>    `.onnx_data` ⇒ 加载失败。**把「单文件 ONNX」作为硬条件优先；拆片版必须真加载过才可采信。**
> 2. **license 字段大量为 null**（本次 8 个仓库里 5 个查不到 `cardData.license`）。null ≠ 可自由分发，
>    必须去 README / LICENSE 人工确认后再写进报告。
>
> **务必逐项核实**：① 是否真有 ONNX（给**字节数**，不是「有」）；
> ② 是否被 transformers.js 真加载过（**跑一次**，不能只看 README）；
> ③ 中文能力**本机实测**；④ 单文件还是拆片；⑤ license 原文。

### 0.5.5 一个隐藏优势：维度相同 = 改动最小

若最终选中的模型维度**恰好是 384**（如 `bge-small-en-v1.5` / `gte-small` / `all-MiniLM-L6-v2`），
则 **H1（维度校验）与 H4（内存估算）都不用改**，只需要：
- 换 `MODEL` 常量
- 换 `localModelPath` / `onnxFile`
- **确认是否需要 query/passage 前缀**（H2）

⇒ **请把「维度 384」作为选型的加分项明确列出**，这会显著降低落地成本。

---

## 1. 核心问题（三问，按顺序回答）

### Q1 · C3（bge-m3 1024 维）能否解决 C2 解决不了的区分度问题？

维度从 384 → 1024 是否带来足够的 margin 提升？**必须实测，不得推理。**

### Q2 · 如果 C3 更好，它应该做成什么形态？

C3 是**选装**（用户主动下载 ~600MB+）。它只能被用作**高级功能**，不能成为必装路径。请给出：
- 何时启用（配置开关？检测到已安装自动启用？）
- 降级链（C3 不可用 → C2 → C1）
- 用户可见的提示措辞

### Q3 【**主路径**】有没有**体积更小、且 JS 原生可用**的模型能胜任「事件聚类」？

> ⚠ **这一问是主路径**（见 §0.5）。绝大多数用户不装 C3、不建 Python 环境、不装 torch。
> Q1 的 C3 只服务少数进阶用户，**不能作为落地方案**。

要求（全部为硬条件）：
- **JS 原生可加载**：走 `@huggingface/transformers` 的 `pipeline('feature-extraction', ...)`，**不得引入 Python/torch**
- **有 ONNX 版**：优先 `onnx-community/*-ONNX` 或 `Xenova/*`（`model_quantized.onnx` 或 `model_int8.onnx`）
- **体积显著小于 C2**（C2 q8 ≈ 118 MB），目标 **≤ 50 MB**，最好 ≤ 20 MB
- 中文/中英混合可用
- 许可允许随插件分发或由插件下载（记录 license）
- **维度 384 是加分项**（见 §0.5.5，可省掉两处硬编码改动）

---

## 2. 候选模型（初筛，需你验证与补充）

> 以下是我基于公开资料的初筛，**全部未经本机实测**，请逐一核实参数量/维度/ONNX 可用性。

| 候选 | 方向 | 维度 | 参考体积 | 备注 |
|---|---|---|---|---|
| **bge-small-zh-v1.5** | 中文专用 | 512 | 24M 参数，q8 量化后约 **25–30 MB** | 体积最符合「小模型」目标，中文强；需确认 ONNX 版存在 |
| **bge-m3 int8**（= C3） | 多语 | 1024 | **568,456,694 B（542.1 MiB）** | **本机已装**（`python/bench/models-xenova-bge-m3-int8/`，见 §0.1.1）；`onnx-community/bge-m3-ONNX` license=mit |
| **jina-embeddings-v5-text-small** | 多语 | 待查 | 待查 | 新模型，需核实许可 |
| **Qwen3-Embedding 小尺寸** | 多语 | 待查 | 待查 | 尺寸档较多，需核实最小档 |
| **KaLM-embedding-multilingual-mini** | 多语 | 待查 | 待查 | 有 ONNX 版线索 |
| **vtx-embed-7M** | 极小 | 待查 | **~7M 参数** | 体积极小，质量存疑，作为下界参考 |

**你必须做的**：对每个候选给出「参数量 / 维度 / 量化后实际字节数 / 许可 / 是否有 ONNX / 中文能力证据」，做成表。

---

## 3. 约束（硬性，违反即返工）

| # | 约束 |
|---|---|
| 1 | **不得修改 `lib/` 下任何生产文件**。实验一律在 `artifacts/_regroup-model-eval-20261109/` |
| 2 | 不得新增**运行时**依赖。可选模型必须走已装的 `onnxruntime`（Python）或 `@huggingface/transformers`（JS） |
| 3 | 不得调用外部 API、不得联网（模型下载除外，但需记录来源与 sha256） |
| 4 | 所有实验**可复算**：脚本 + 固定数据快照 + 随机种子 |
| 5 | 数据集**必须**是真实事件库，不得自造理想样本 |
| 6 | 报告必须给**物理量**（数值/字节/耗时），禁止「效果不错」这种表述 |
| 7 | **C3 必须实测**（模型在 §0.1.1 的开发路径，已确认可用）；任何模型都不得用论文数字冒充本机实测 |

---

## 4. 数据（已就绪）

- 事件库：`C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json`
  - 52 事件 / 47 active / 5 closed；检查点**全库 765 / active 内 651**。
    **报告里必须写清分母是 765 还是 651**（v4 只给了 765，容易和「47 个 active 事件」混算）。
  - 快照实测：**3,216,982 B / sha256 `2F081175037BEEF4FBB992B764237D74C7DAFBF631401190324D0202B5A522EB`**
    （2026-11-09 20:11:07）。**先复制到实验目录再用，禁止改动原件。**
  - 碎片口径：`kind=unknown & status=active & checkpoints≤2` ⇒ **23 个**（2.4 的真实处理对象）
- 账本：同目录 `handoff/handoff-YYYYMMDD-HHMMSS.md`（685 篇）
- C2 模型：`C:/Users/JH Z/.dsh/models/js-semantic/multilingual-e5-small/`（已装）
- **C3 模型（已装，开发路径）**：`D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8/`
  - `onnx/model_int8.onnx` 542.1 MB / `tokenizer.json` 16.3 MB / config 等齐全
  - ⚠ 该目录在 `.gitignore` 中，**不得提交或移动**，就地读取
- C3 产品默认路径 `~/.dsh/python-engine/models/` **不存在**（用户未走产品安装流程）——这是它此前被误判为「未安装」的原因

**C2 加载方式（实测可用，照抄）**：

```js
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('D:/dsh-auto-memory/lib/semantic-js.js').href)
const eng = mod.createJsSemanticEnginePre({ pluginDir: 'D:/dsh-auto-memory/lib' })
const v  = await eng.embedQuery('文本')         // Float32Array(384)
const vs = await eng.embedPassages(['a','b'])   // Float32Array[]
```

> `pluginDir` 必传，否则 `resolveDshHomePre()` 取不到值会抛 `ERR_INVALID_ARG_TYPE`。

**C3 加载方式（v5 修正：Python 侧在本机不可用，走 JS）**：

```js
// ✅ 实测可用（2026-11-09）：同一份 onnx/model_int8.onnx，纯 JS，零 Python
//   ⚠ 必须用 node 构建，否则 env.useFS=false → fetch 读本地文件 → TypeError: fetch failed
import { pathToFileURL } from 'node:url'
const tf = await import(pathToFileURL(
  'D:/dsh-auto-memory/node_modules/@huggingface/transformers/dist/transformers.node.mjs').href)
const { pipeline, env } = tf.pipeline ? tf : tf.default
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = 'D:/dsh-auto-memory/python/bench'   // 模型 id 就填目录名
const ext = await pipeline('feature-extraction', 'models-xenova-bge-m3-int8', { dtype: 'int8' })
const r = await ext('文本', { pooling: 'cls', normalize: true, truncation: true, max_length: 512 })
// 实测：load 2930 ms；pooling 'cls' → dim 1024，L2 = 1.000000，单条 ~28 ms
```

> **为什么不用 Python**：`python/m7_embedding_v1.py:270` 在 int8 构造器里 `from transformers import AutoTokenizer`，
> 本机 `transformers` 未装 ⇒ `ModuleNotFoundError`（§10.1 P1）。
> **另外 v4 给的函数名 `build_embedder` 是错的**，实际导出名是 `load_embedder`（`:355`），
> 即使装好 transformers 也要改这一处（§10.1 P2）。

```python
# ❌ 本机跑不通，仅作记录（缺 transformers）。若将来装好依赖，正确写法是：
import sys; sys.path.insert(0, 'D:/dsh-auto-memory/python')
import m7_embedding_v1 as emb
e = emb.load_embedder({'provider':'bge-m3-onnx-int8-pre-v1',
                      'modelDir':'D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8',
                      'onnxFile':'onnx/model_int8.onnx',
                      'dimension':1024})
```

### 4.1 关键：没有标注怎么办

事件库**没有**「哪些碎片该合并」的 ground truth。你必须**自己构造标注**，方法：

- **正样本对**：同一事件内的两条检查点（确定同属一件事）
- **负样本对**：两个不同事件各取一条（确定不同事）
- **难点样本**：跨事件但同主题的对（如 task-37 / task-38 两条记录）——**这批最能区分模型好坏**
- 标注规模建议：正 / 负 / 难点 各 ≥ 100 对，全部来自真实数据

> **v5 补充三条口径（不补则标注不可用）**：
> 1. **难点样本要有客观生成规则**，不能手工挑。本机已用「跨事件对里词面 Jaccard 最高的 100 对」生成
>    （`01-build-dataset.mjs`；实测 Jaccard 区间 **0.258–1.000**，存在**词面完全重合却确属两个事件**的极端对）。
> 2. **归属查询必须 LOO**：查询检查点要从事件表示里剔除，见 §10.4 ①。
> 3. **聚类可直接用现成 GT**：把「检查点属于哪个事件」当分组真值，k 取真实事件数；无需人工标注。
>    但报告里要写明「这是 checkpoint 级 GT，不等于"碎片该不该合"的人工判断」，两者口径不同，别混报。

---

## 5. 必做实验（每项给结论）

### 实验 A · C2 基线（已有数字，可复核）

复现 §0.2 的数字，作为后续对比的基线。**只需验证，不需重新探索。**

### 实验 B · 分数矩阵诊断（**决定性，优先级最高**）

对 C2 建 **47×47 事件相似度矩阵**（v5：active 现在是 47；32 只是生产候选池上限 `_pool.slice(0,32)`，
**两个数都要给**：47×47 完整矩阵 + 32×32 生产形态子集），并额外建 **651×651 检查点矩阵**做块结构判定。

回答三个问题，每条都要给数字：

1. **是否存在块结构**（v5 可操作定义见 §10.4 ④）：
   - 主判据：same-event 对 vs cross-event 对余弦的 **AUC**（GT = 事件 id，651 条检查点）
   - 辅判据：47×47 上 same-idKind 对 vs cross-idKind 对（仅旁证；idKind = L1 标识种类，不掺主题猜测）
2. **若 AUC 高但 top-1 排序错** ⇒ 表示层/阈值问题，调优有救（应改用相对排序 + margin）
3. **若 AUC ≈ 0.5 且一片均匀高分** ⇒ 模型容量问题，C2 这条路到头

**这一条决定后面所有实验的方向，必须先做。**

> ⚠ v4 只写「同族事件分数明显更高」，**「同族」没有定义 ⇒ 无法判真假**。
> 必须用 §10.4 ④ 的 checkpoint-GT AUC，或至少给出「同族」的机械定义。

### 实验 C · C3 对比（**模型已在本机，走 JS 加载，不走 Python**）

> **v5 改写**：v4 给的 Python 路径在本机必定失败（缺 `transformers`），照抄只会浪费一轮。
> 用 §4 的「C3 加载方式（v5 修正）」那段 JS 代码，**同一份 `onnx/model_int8.onnx`**，
> `dtype:'int8'` + `pooling:'cls'`。已实测：load 2930 ms / 1024 维 / L2=1.000000 / 28 ms 单条。

必须测：
- 同任务、同数据（与实验 A **完全同一批 47 事件表示 + 同一批查询字符串**，见 §10.4 输入冻结），
  测 **margin / top-1 / top-5 / 难点样本准确率**
- **实际磁盘体积**：`model_int8.onnx` = **568,456,694 B（542.1 MiB）** + `tokenizer.json` 16,082,821 B ≈ **558 MB**
  （注意：不要写「~600MB」，写实测字节）
- **冷启动耗时**（含 `import` 与 pipeline 构建，分开计时）、**单次嵌入耗时**、**批量嵌入 47 事件耗时**
- 与 C2 做**配对比较**：同一批查询，统计「C3 对、C2 错」与「C2 错、C3 对」的条数（McNemar 式 2×2 表）
- **维度验证**：确认 1024 维且 L2 归一化（JS 侧直接算范数，不要假设）
- **pooling 必须给 cls**：bge-m3 用 CLS；误用 `mean` 会得到不同向量（本机实测 mean 耗时 85 ms vs cls 28 ms，
  两者都归一化到 1.0，**但向量不同** ⇒ 报告里要写清用的是哪个）

> ⚠ 该模型目录在 `.gitignore` 中，**不要提交、不要移动**，就地读取即可。
> ⚠ 542 MB 的模型加载慢，冷启动务必**单独计时并预热一次后再测热查询**。

### 实验 D · JS 原生小模型选型（**Q3 主路径，优先级仅次于实验 B**）

**这一项是最终能否落地的关键。** 做法：

1. 从 §0.5.4 候选池出发，**逐个核实**：
   - HF 仓库是否存在 ONNX 版（给链接 + 实际文件字节数）
   - 是否被 transformers.js 支持（**真加载一次**，不能只看 README）
   - 许可（Apache-2.0 / MIT / 其他）
2. **能跑的真跑**：用与 C2 完全相同的通路
   ```js
   const { pipeline, env } = (await import('@huggingface/transformers')).default
   env.allowRemoteModels = false
   env.allowLocalModels = true
   env.localModelPath = '<实验目录>'
   const ext = await pipeline('feature-extraction', '<模型名>', { dtype: 'q8' })
   const v = await ext('<文本>', { pooling: 'mean', normalize: true, truncation: true })
   ```
   > 已实测该通路可用（846 ms 加载 `multilingual-e5-small`，输出 Float32Array(384)）。
   > 若模型需要 query/passage 前缀，**分别测「加前缀」与「不加前缀」两种**，报告差异。
3. 同任务同数据对比：**margin / top-1 / top-5 / 难点准确率 / 体积 / 冷启动 / 单次嵌入耗时**
4. 同时记录**改造工作量**：需要改 §0.5.3 的哪几处硬编码（H1–H5）

**输出一张选型表**，按「**体积 × 效果 × 改造工作量**」三维排序，标出帕累托前沿。
**必须给出 1 个推荐型号**，或明确说明「无一合格」。

### 实验 E · 任务形态重估：聚类 vs 二分类

**关键洞察**：我们要的其实不是「从 200 个里挑 1 个」，而是两类问题：

- **二分类**：「这两条是不是同一件事？」（简单得多）
- **聚类**：「这些碎片里哪些该合并成一坨？」

请分别测：

- 二分类：在最优阈值下的 precision / recall / F1，**并给 best-F1 对应的阈值本身 + ROC-AUC**
  （不给阈值等于没给方案，deploy 时阈值是产品参数）
- 聚类：给定真实分组数 k（= 47），测 ARI / NMI；另给「层次聚类在 oracle k 处切」的 ARI
- **两种数据集口径都要报**：① 651 条全量（真实分布，被大事件主导）② 每事件最多 6 条的平衡集（对比更敏感）

> 很可能出现「排序很差但二分类可用」或「二分类可用但聚类不行」——**必须分开报**。
>
> **v5 追加（重要）**：必须报「二分类最优阈值」与「聚类用的距离阈值」**是否一致**。
> 若二分类要 0.88、聚类要 0.92，这两件事就不能共用一个配置项，接口必须分开 ——
> 这直接影响 2.3 的接线形态，是本任务最该带回去的结论之一。

### 实验 F · 与现有规则的对照

同一批数据，比较四种方法：

| 方法 | 来源 |
|---|---|
| L1 标识层 | `lib/index.js:24631`（正则 issue/task/pr/sha/evt） |
| 词袋 0.34 | `lib/index.js:24709` |
| C2 余弦 | 本机 E5 |
| C3 / 小模型 | 实验 C / D |

给出**「哪个场景该用哪个」**的决策表。

---

## 6. 必须给的产出

1. **报告** `docs/internal/REGROUP-MODEL-EVAL-REPORT-<date>.md`
   - 每实验：假设 / 方法 / 数据 / 结果表 / 结论
   - 全部可复算物理量
2. **可复现脚本** `artifacts/_regroup-model-eval-<date>/*.{mjs,py}`
3. **三个明确结论**（每个都要选一个，不许模糊）：
   - **Q1**：C3 能否解决？→ ✅能（给 margin/准确率） / 🟡部分（给边界） / ❌不能（给证据）
   - **Q2**：C3 的产品形态 → 具体到「开关名 / 触发条件 / 降级链 / 提示文案」
   - **Q3**：小模型选型 → 给出**推荐型号 + 体积 + 实测效果**，或「无合格候选」
4. **一张决策表**：什么条件下用哪个模型/方法

---

## 7. 已知的坑（省你时间）

| 坑 | 现象 | 解法 |
|---|---|---|
| `pluginDir` 不传 | `ERR_INVALID_ARG_TYPE: path must be string` | 必传 `{ pluginDir }` |
| C2 首次调用慢 | 1068 ms（子进程加载 onnx） | 先预热一次再计时 |
| C3「看起来没装」 | `~/.dsh/python-engine/models/` 不存在 | **实际在开发路径** `python/bench/models-xenova-bge-m3-int8/`，见 §0.1.1 |
| torch 未装 | `ModuleNotFoundError: No module named 'torch'` | **int8 ONNX 路径不需要 torch**，别被误导 |
| 分数绝对值 | E5 中文短文本余弦普遍 0.85+ | 只能同一次查询内部比相对排序 |
| 事件表示 | 只用 name 会漏细节，用全部 checkpoints 会淹没信号 | 实验 B 之后会知道该用哪种 |
| 无 ground truth | 事件库没有「该合并成几组」的标注 | 按 §4.1 自建标注，**难点样本必须包含** |

---

## 8. 完成标准

- [ ] 实验 B 的 **47×47** 事件矩阵（v5：不是 32×32，因为 active 现在是 47；32 只是生产候选池上限
      `_pool.slice(0,32)`，两个数给哪个都要写清）——**没有它不许下任何结论**
- [ ] 实验 B 的**块结构 AUC**（same-event 对 vs cross-event 对，GT=事件 id，见 §10.4 第 4 条）
- [ ] A–F 全部完成，每项有数据表
- [ ] Q1/Q2/Q3 三个结论各选一个，附理由；**每项都必须对照 §10.5 的判定门槛**说明落在「可用/边缘/不可用」哪一档
- [ ] **Q4 也要回答**（v5 新增，见 §10.6）
- [ ] **JS 原生候选选型表**（含字节数/维度/license/单文件或拆片/ONNX 实测加载/是否需要前缀/改造工作量）
- [ ] **至少 1 个 JS 原生模型真跑通**（不能只有 C3 的结论）
- [ ] 参数化方案：模型名 / 维度 / 前缀 / pooling / onnx 路径 五元组如何配置（改 H1–H5）
- [ ] 决策表：场景 → 方法
- [ ] 脚本可复现（含固定种子、快照 sha256、脚本入口）
- [ ] 报告中**没有任何**未附物理量的形容词结论
- [ ] **C3 必须实测**（v5：走 JS 路径，见 §4）。若仍跑不通，须贴**完整报错**，
      并明确写「C3 = 未测」而不是拿 bge-m3 的论文数字顶上
- [ ] 每个模型都要有一行「跑通 / 报错原文」，**不许出现"应该可以"**

---

## 9. 与主线的关系（避免越界）

- **本任务不改任何生产代码**，只出报告与建议
- 批次 2 的 2.1 / 2.2 / 2.5 由 Lead 另行推进，**不依赖本任务**
- 本任务结论影响：**2.3（regroup 接线形态）** 与 **1.4 的 L2 是否升级**
- 若结论是「C3 可用」⇒ 2.3 做成「C3 优先、C2 降级」的可选高级功能
- 若结论是「小模型可用」⇒ 2.3 用内置小模型，**不增加用户前置成本**
- 若结论是「都不行」⇒ 2.3 退回规则聚类，并明确记录为什么

---

## 10. 【v5 增补】实测推翻的前提 + 口径补丁（2026-11-09 本机，开工前必读）

> 本节全部数字来自本机实测，复算脚本在 `artifacts/_regroup-model-eval-20261109/scripts/`。
> 写这一节的原因：v4 有 3 条前提是**错的**，照着写会白跑一轮；另外有 5 处口径不统一，
> 会让不同模型的数字**不可比**。这两类问题都不是"再努力一点"能补救的。

### 10.1 三条被推翻的前提（附完整报错 / 可复算命令）

**P1 · 「C3 int8 不需要 transformers」是错的 —— Python 侧 C3 在本机跑不通**

`python/m7_embedding_v1.py:270` 逐字：

```python
class BgeM3OnnxInt8Embedder:
    def __init__(self, config):
        ...
        from transformers import AutoTokenizer        # ← 硬依赖，不是 torch 的问题
```

实测（`scripts/00-probe-c3-python.py`）：

```
File "D:\dsh-auto-memory\python\m7_embedding_v1.py", line 270, in __init__
    from transformers import AutoTokenizer
ModuleNotFoundError: No module named 'transformers'
```

⇒ 要跑通得 `pip install transformers`（连带 `tokenizers` / `huggingface_hub` / `safetensors` / `pyyaml`），
与 §3 约束 2「不得新增运行时依赖」**直接冲突**。⇒ **Python 侧不测，改测 JS（见 P3）。**

**P2 · v4 给的函数名 `build_embedder` 不存在**

```
AttributeError: module 'm7_embedding_v1' has no attribute 'build_embedder'. Did you mean: 'load_embedder'?
```

实际导出名 `load_embedder`（`:355`）。即使 P1 被解决，这一处也要改。

**P3 · 1024 维 bge-m3 int8 可以纯 JS 加载（本轮最重要的发现）**

```js
// dist/transformers.node.mjs + dtype:'int8' + pooling:'cls'
→ load 2930 ms；dim 1024；L2 = 1.000000；单条 28 ms
```

⇒ **「1024 维只能靠装 Python」这个隐含前提不成立。**
⇒ 后果有两个，都必须写进报告：
① 实验 C 可以真跑（不需要 Python），C3 的结论不再是「未测」；
② Q2 的产品形态假设要重写 —— C3 不再等于「装 Python」，而是「下载 542 MB 模型」（见 §10.6 Q4）。

### 10.2 一条必踩的坑：import 错了构建

| 入口 | `env.useFS` | 读本地文件的方式 | 结果 |
|---|---|---|---|
| `dist/transformers.js`（web 构建） | **false** | `fetch(file://…)` | ❌ `Unable to load from local path "...": "TypeError: fetch failed"` |
| `dist/transformers.node.mjs`（`exports.node.import`） | **true** | `fs` | ✅ 正常 |

报错原文（用 web 构建时）：

```
Unable to load from local path "D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8/tokenizer.json": "TypeError: fetch failed"
Error: `env.allowRemoteModels=false` and file was not found locally at ".../tokenizer.json".
```

> 产品代码走 `createRequire(...).resolve('@huggingface/transformers')`，天然解析到 node 构建 ⇒ 产品里不会犯这个错。
> **但手工实验最容易在这翻车**，而且报错信息完全指向不存在的「文件没下载」，极具误导性。

### 10.3 数据口径（比 §4 更精确，别再让分子分母打架）

| 项 | 实测值 | 备注 |
|---|---|---|
| 快照文件 | 3,216,982 B | `handoff/event-store.json` 的复制件 |
| 快照 sha256 | `2F081175037BEEF4FBB992B764237D74C7DAFBF631401190324D0202B5A522EB` | 换机器必须一致 |
| 事件 | 52（**active 47** / closed 5） | 47 是实验主体 |
| 检查点 | 全库 **765** / active 内 **651** | 写报告必须标清 |
| 碎片 | **23**（`kind=unknown & active & cp≤2`） | 2.4 的真实对象 |
| C2 资产 | `model_quantized.onnx` **118,308,185 B** + tokenizer 17,082,730 B | 已装 |
| C3 资产 | `model_int8.onnx` **568,456,694 B** + tokenizer 16,082,821 B | 已装（.gitignore） |
| **C2 实测** | 冷启 **1151 ms** / **6.6 ms** 每条 / 384 维 | 本轮复测（v4 写 1068 ms，同量级） |
| **C3-JS 实测** | load **2930 ms** / **28 ms** 每条（cls）/ 1024 维 | 本轮实测 |

**碎片分布**（决定「聚类」任务的真实形态）：47 个 active 里 651 条检查点，
但前 5 个事件就占了 540 条（199 / 160 / 63 / 61 / 57）；碎片 23 个合计只有 **31 条**检查点。
⇒ **任何"平衡采样"都会显著改变任务难度，必须在报告里公开采样口径。**

### 10.4 方法论补丁（不补这 5 条，模型之间的数字不可比）

**① 归属任务必须 LOO（leave-one-checkpoint-out）**
事件表示里含「最近 3 条检查点」。若拿同一事件的检查点当查询，**答案就写在题干里** ⇒ top-1 虚高。
口径：把查询的那条从事件表示里剔除后再嵌。报告里要写明「LOO 表示」。

**② 输入冻结（v5 定死，不许再"实验 B 之后决定"）**
生产口径已定：`String(name) + ' ' + String(summary) + ' ' + 最近3条检查点文本`，`.slice(0, 480)`
（`lib/index.js:24771-24774`）。**所有模型吃同一批字符串**（建议先落一份 `texts[]`，各模型只索引它）。
一个模型用全量检查点、另一个只用 name，得出的「谁更好」没有意义。

**③ 前缀 / pooling / dtype 是按模型配置的，不是全局**
| 模型族 | pooling | 前缀 | dtype |
|---|---|---|---|
| multilingual-e5-small | `mean` | `query: ` / `passage: ` **必需** | q8 |
| bge 系（zh / en / m3） | **`cls`** | 无（bge-zh 的检索指令前缀单独测一档） | q8 / int8 |
| MiniLM / gte-small | `mean` | 无 | q8 |

> 本机实测：bge-m3 用 `mean` 与 `cls` 都归一化到 1.0，但**向量不同**（耗时 85 ms vs 28 ms）。
> 报告必须写明用哪个，否则复算不复现。

**④ 「块结构」要给可操作定义，不能只贴一张矩阵**
v4 说「同族事件分数明显更高」——「同族」没定义，无法判真假。可操作版：
- 用 **checkpoint 级 GT**（同一事件 = 同块），算 same-event 对 vs cross-event 对的余弦 **AUC**；
- AUC ≈ 0.5 ⇒ **无块结构**（模型容量/表示问题，调阈值无救）；
- AUC ≥ 0.75 但绝对分数挤在 0.85+ ⇒ **有块结构、只是绝对阈值不可用** ⇒ 应该用「相对排序 + margin」而非固定阈值；
- 47×47 事件矩阵只作描述性附录（min/p5/median/p95/max + top1−top2 margin 分布）。

**⑤ 分批 + 超时 + 每批落盘**
725 条文本逐条 `await` 串行会跑很久（C3 28 ms×725 ≈ 20 s，C2 走子进程 IPC 更慢），
一旦被打断就全丢。做法：**先 5 条冒烟确认通路（30 s 内）→ 再分批（64 条/批）→ 每批 flush 到 json**。
模型文件的 sha256、加载耗时、批耗时都要落盘，报告直接引用。

### 10.5 判定门槛（v5 新增：不设门槛 ⇒ 结论可以随便写）

| 用途 | 指标 | ✅ 可用 | 🟡 边缘 | ❌ 不可用 |
|---|---|---|---|---|
| 归属（47 选 1） | top-1 | ≥ 0.70 | 0.40–0.70 | < 0.40 |
| 归属 | top1−top2 margin 中位 | ≥ 0.05 | 0.01–0.05 | < 0.01 |
| 二分类（该不该合） | best-F1 | ≥ 0.85 | 0.70–0.85 | < 0.70 |
| 聚类 | ARI（k=真值） | ≥ 0.60 | 0.30–0.60 | < 0.30 |

> 门槛是我按「2.4 的误并不可逆」这一风险定的人为阈值，**不是行业标准**，报告里要照抄这句。
> 每个指标后面必须跟数据集口径（如「top-1 0.63 @ 651 全量 / LOO 表示」）。
> **达到「可用」才允许写"能胜任"；落在「边缘」必须同时给出失效条件。**

### 10.6 Q4（v5 新增，因 P3 而必须回答）

既然 1024 维 bge-m3 int8 能**纯 JS** 加载（2930 ms / 28 ms 每条 / 542 MB 磁盘 / license=mit），那：

1. **Python sidecar 剩下的唯一必要性是什么？**（候选答案：fp32 provider、其他 python 工具链复用、已有资产不浪费）
   —— 请给出「若只有 JS 路径，会损失什么」的具体清单，别再假设 C3 = 必须装 Python。
2. **542 MB（C3）vs 118 MB（现 C2）vs 22.9 MB（bge-small-zh q8）**：可接受的下载体积阈值是多少？
   这是产品决策，但报告必须把三个数字并列摆出并给出建议值。
3. 若采纳「JS 直载 bge-m3」⇒ C3 的定位从**「选装 Python」变成「选装大模型」**，
   §Q2 的降级链（C3→C2→C1）与用户提示文案都要按这个重写：
   提示里不能再出现「安装 Python」，只能说「下载 XX MB 增强模型」。

### 10.7 三条仍然有效的硬约束（不因 v5 放松）

1. **只读 `lib/`**；实验全部落 `artifacts/_regroup-model-eval-20261109/`
2. **不许用论文/榜单数字**；跑不通就写「未测」+ 贴完整报错
3. 数据集必须来自真实事件库快照（sha256 已固定，见 §10.3）

### 10.8 建议的执行顺序（带冒烟闸门）

```
第 0 步  冒烟（≤1 分钟）：C2 产品通路 1 条 + transformers.node.mjs 1 条 + C3 int8 1 条
         └─ 三条都出向量才继续；任一失败先修通路，别急着跑全量

第 1 步  实验 B（决定性）：47×47 事件矩阵 + 651 检查点的 same/cross AUC
         └─ 这一步决定后面还要不要调阈值

第 2 步  实验 A：C2 基线（LOO 表示、冻结输入）
第 3 步  实验 D：小模型（先 bge-small-zh 22.9 MiB 单文件，跑通再扩）
第 4 步  实验 C：C3（JS 路径，cls pooling）
第 5 步  实验 E/F：二分类 / 聚类 / 与 L1 + 词袋规则对照
         └─ E 必须与 B 分开报，不许用「排序差但二分类可用」一句话含糊过去

每步结束：把中间结果 flush 到 out/，报告引用物理量
```

### 10.9 本节的可复算入口

| 脚本 | 作用 |
|---|---|
| `scripts/00-probe-c3-python.py` | 复现 P1/P2 的两条报错 |
| `scripts/00-probe-hf-onnx.mjs` | 抓 HF 仓库树，输出每个 ONNX 的真实字节数 + license |
| `scripts/01-build-dataset.mjs` | 从快照构造数据集（固定种子 20261109，落 `data/dataset.json`） |
| `scripts/02-embed.mjs` | 统一嵌入器（`--engine product` 走产品通路 / `--engine pipeline` 走 transformers.node） |
