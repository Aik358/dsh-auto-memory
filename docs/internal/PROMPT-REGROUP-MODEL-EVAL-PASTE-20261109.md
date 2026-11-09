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

> 更新 2026-11-09（**v4**）| 性质：**只读调研 + 实验，不改生产代码**
> 上游：`docs/internal/MAP-BATCH2-20261109.md`、`docs/internal/CONSTRUCTION-PLAN-20261108.md`
> **版本演进**：v1 只测 C2 → v2 扩为 C2/C3/小模型三方 → v3 补入 C3 实际开发路径 → **v4 JS 原生优先成为主路径**（见 §0.5）。

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

### 0.3 本机 Python 环境（C3 的前置）

```
python 3.14.6
onnxruntime 1.28.0   ✅ 已装
torch                ❌ 未装（C3 int8 路径不需要 torch，fp32 路径需要）
transformers         ❌ 未装（同上）
```

> **重要**：C3 的 int8 ONNX 路径只需 `onnxruntime`（已装），**不需要 torch/transformers**。
> **且模型已在本机**（见 §0.1.1）⇒ **C3 现在就可以直接实测，无任何前置缺口。**

---

## 0.5 【最高优先级】技术路线约束：JS 原生优先（用户裁定）

> 用户原话：「因为绝大多数用户是不装 C3，不建立 Python 环境，也不下载 torch 和 transformers 的，
> 所以我建议还是优先选择 JavaScript 原生支持的」

### 0.5.1 这条约束意味着什么

| 用户类型 | 占比（用户判断） | 具备什么 | 能跑什么 |
|---|---|---|---|
| **绝大多数** | 主体 | 只有 DSH + 插件 + C2（必装） | **只能跑 JS/ONNX 路径** |
| 少数进阶 | 很小 | 另装 C3（Python + 模型） | C2 + C3 |

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

### 0.5.3 但有 **3 处硬编码** 必须同步改（这是真正的成本）

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

| 候选 | 维度 | 参考体积 | ONNX 状态 | 备注 |
|---|---|---|---|---|
| **multilingual-e5-small**（=现 C2） | 384 | ~130 MB（q8 118 MB） | ✅ 已装 | **基线，必须参与对比** |
| **bge-small-zh-v1.5** | 512 | **~25–30 MB**（q8） | 有 `onnx-community/bge-small-zh-v1.5-ONNX`、`Xenova/bge-small-zh-v1.5` | **最贴合小模型目标**，中文强 |
| **bge-small-en-v1.5** | 384 | ~30 MB | ✅ 有 | 维度与 C2 相同（H1 不用改），但中文弱 |
| **jina-embeddings-v2-small-en** | 512 | ~30 MB | 有 Xenova 版 | 英文为主 |
| **gte-small** | 384 | ~30 MB | 有 Xenova 版 | 多语，维度同 C2 |
| **paraphrase-multilingual-MiniLM-L12-v2** | 384 | ~120 MB | 有 Xenova 版 | 维度同 C2，多语，体积不占优 |
| **all-MiniLM-L6-v2** | 384 | ~23 MB | ✅ 有 | **最小之一**，英文为主 |
| nomic-embed-text-v1.5 | 768 | ~140 MB | 有 | 体积不占优 |

> **务必逐项核实**：① 是否真有 ONNX 版（`onnx/model_quantized.onnx` 或 `model_int8.onnx`）；
> ② 是否被 transformers.js 官方支持（pipeline 能加载）；③ 中文能力实测（不要只看榜单）。

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
| **bge-m3 int8**（= C3） | 多语 | 1024 | 约 **600 MB** | 本机未装，需先下载才能测 |
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
  - 52 事件 / 47 active / 765 检查点。**先复制到实验目录再用，禁止改动原件。**
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

**C3 加载方式（若你安装了模型）**：

```python
# python/m7_embedding_v1.py 已实现两个 embedder
#   需要 onnxruntime（已装），int8 路径不需要 torch
import sys; sys.path.insert(0, 'D:/dsh-auto-memory/python')
import m7_embedding_v1 as emb
e = emb.build_embedder({'provider':'bge-m3-onnx-int8-pre-v1',
                        'modelDir':'<模型目录>',
                        'onnxFile':'model_int8.onnx',
                        'dimension':1024})
```

### 4.1 关键：没有标注怎么办

事件库**没有**「哪些碎片该合并」的 ground truth。你必须**自己构造标注**，方法：

- **正样本对**：同一事件内的两条检查点（确定同属一件事）
- **负样本对**：两个不同事件各取一条（确定不同事）
- **难点样本**：跨事件但同主题的对（如 task-37 / task-38 两条记录）——**这批最能区分模型好坏**
- 标注规模建议：正 / 负 / 难点 各 ≥ 100 对，全部来自真实数据

---

## 5. 必做实验（每项给结论）

### 实验 A · C2 基线（已有数字，可复核）

复现 §0.2 的数字，作为后续对比的基线。**只需验证，不需重新探索。**

### 实验 B · 分数矩阵诊断（**决定性，优先级最高**）

对 C2 建 **32×32 事件相似度矩阵**，回答：

- 矩阵**是否存在块结构**（同族事件分数明显更高）？
- 若**有块结构但 top-1 排序错** ⇒ 表示层问题，调优有救
- 若**一片均匀高分** ⇒ 模型容量问题，C2 这条路到头

**这一条决定后面所有实验的方向，必须先做。**

### 实验 C · C3 对比（**模型已在本机，直接实测，不需要下载**）

**加载路径（照抄）**：

```python
import sys; sys.path.insert(0, 'D:/dsh-auto-memory/python')
import m7_embedding_v1 as emb
e = emb.build_embedder({
    'provider': 'bge-m3-onnx-int8-pre-v1',
    'modelDir': 'D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8',
    'onnxFile': 'onnx/model_int8.onnx',
    'dimension': 1024,
})
# e.embed_passages([...]) / e.embed_query(...) —— 具体方法名以 m7_embedding_v1.py 为准
```

必须测：
- 同任务、同数据（与实验 A 完全相同的 47 事件 / 同一批查询），测 **margin / top-1 / top-5 / 难点样本准确率**
- **实际体积**：542.1 MB（ONNX）+ 16.3 MB（tokenizer）≈ **558 MB**
- **冷启动耗时**、**单次嵌入耗时**、**批量嵌入 32 事件耗时**
- 与 C2 做**配对比较**：同一批查询，统计「C3 对、C2 错」与「C2 对、C3 错」的条数
- **维度验证**：确认实际输出为 1024 维且已 L2 归一化（`np.linalg.norm`）

> ⚠ 该目录在 `.gitignore` 中，**不要提交、不要移动**，就地读取即可。
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

- 二分类：在最优阈值下的 precision / recall / F1
- 聚类：给定真实分组数，测 ARI / NMI

> 很可能出现「排序很差但二分类可用」或「二分类可用但聚类不行」——**必须分开报**。

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

- [ ] 实验 B 的 32×32 矩阵（数值表或图）——**没有它不许下任何结论**
- [ ] A–F 全部完成，每项有数据表
- [ ] Q1/Q2/Q3 三个结论各选一个，附理由
- [ ] **JS 原生候选选型表**（含体积/维度/许可/ONNX 实测加载/是否需要前缀/改造工作量）
- [ ] **至少 1 个 JS 原生模型真跑通**（不能只有 C3 的结论）
- [ ] 参数化方案：模型名 / 维度 / 前缀 / onnx 路径 四元组如何配置（改 H1–H5）
- [ ] 决策表：场景 → 方法
- [ ] 脚本可复现
- [ ] 报告中**没有任何**未附物理量的形容词结论
- [ ] **C3 必须实测**（模型已在 §0.1.1 路径，无理由跳过）；若因环境原因跑不通，须贴出完整报错

---

## 9. 与主线的关系（避免越界）

- **本任务不改任何生产代码**，只出报告与建议
- 批次 2 的 2.1 / 2.2 / 2.5 由 Lead 另行推进，**不依赖本任务**
- 本任务结论影响：**2.3（regroup 接线形态）** 与 **1.4 的 L2 是否升级**
- 若结论是「C3 可用」⇒ 2.3 做成「C3 优先、C2 降级」的可选高级功能
- 若结论是「小模型可用」⇒ 2.3 用内置小模型，**不增加用户前置成本**
- 若结论是「都不行」⇒ 2.3 退回规则聚类，并明确记录为什么
