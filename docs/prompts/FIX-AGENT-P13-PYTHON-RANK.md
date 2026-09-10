> **投喂方式**：发版后投喂。复制时从 `你是 DSH 环境里的执行 Agent` 开始到文件末尾（自包含，无需 `_COMMON.md`）。
> ⚠️ 改 `python/worker_semantic_pre_v1.py` + `lib/index.js` +（可能）`lib/python-sidecar-client-pre.js`，**不能重启 dsh web**（会截断对话），改完只做静态验证。

---

你是 DSH 环境里的执行 Agent。工作目录：`D:\dsh-auto-memory`（Node.js + Python 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：给 recall 接 C3（Python BGE-M3）语义臂

## 0. 背景（已核实，先自行复现）

- 当前 recall 的语义臂只走 `lib/index.js:6077` 的 `engine._jsSemanticRank`，首行 `if ((await engine.resolveSemanticTier()) !== 'c2') return null` → **C3（python）档下语义臂恒空**，recall 只剩词法。
- **但 Python 侧早已实现 dense 检索**：`python/worker_semantic_pre_v1.py` 里已有
  - `dense_search(self, query_text, workspace_key, scope, miv, top_k=...)`（约 `:406`）：对 `self.vectors[(ws_ref, scope)]` 做余弦检索，内置三重过滤（workspaceRef + scope + miv 全匹配）
  - `hybrid_rank(...)`（约 `:468`）：dense+lexical 融合（**本任务不用它，recall 已有自己的 rank-space RRF**）
- 索引粒度：Python 按 **memoryId**（`mem_xxx`）建索引（chunk 带 `memoryId`），与 recall 的 L0 候选 `id` **同 ID 空间** ⇒ dense 分数可直接映射。
- 档位解析 `resolveSemanticTier()`（`lib/index.js:6058`）：`lexical→c1`；`python→c3`（int8 模型文件存在才 c3，否则 c1）；`auto/js→C2 资产就绪 c2 否则 c1`。

## 1. 目标

在 C3 档下，让 recall 用 Python 的 `dense_search` 结果作为语义臂；`auto` 档择优（python 可用则 c3，否则 c2）；任何失败 fail-soft 回退 C2 → 词法。**不碰 C2 默认路径、不影响首启 JS 自动下载。**

## 2. 实施步骤

### B1 · Python worker 新增命令 `recall_rank`

在 `python/worker_semantic_pre_v1.py` 新增 handler（沿用既有 handler 命名与协议框架）：
- 入参：`{cmd:'recall_rank', workspaceKey, scope, miv, query, topK?}`
- 实现：调 `self.dense_search(query, workspaceKey, scope, miv, top_k=topK or <默认 20>)`
- 返回：`{scores:[{memoryId, score}], miv}`；embedder 未就绪 / 无 vectors / encode 失败 → 返回 `{scores:[], miv}`（**不抛**）
- 复用三重过滤，不新造；不写回、不改索引

### B2 · JS 侧 `engine._pySemanticRank`

在 `lib/index.js` 新增 `engine._pySemanticRank = async (corpusSnap, queryText) => {...}`：
- 前提：`(await engine.resolveSemanticTier()) === 'c3'`
- 经 sidecar 调 `recall_rank`（先 grep 确认 sidecar 的实际调用方法名，如 `request`/`push`/`command`，**以代码为准**）
- 返回 `{scores: Map<memoryId, number>}`；sidecar 抛错/超时/空 → 返回 `null`

### B3 · recall 择优接线 + 守卫放宽

- 新增择优函数（或扩展 `_jsSemanticRank`）：`c3 → _pySemanticRank`；`c2 → _jsSemantic.rank`；`auto → 先 c3（可用则用之）否则 c2`；`lexical → null`
- recall L0 分支（`lib/index.js` 约 3355-3420）改用择优函数取 dense 臂；`null` → 仅词法（现状）
- 保留既有 `_jsSemanticRank` 行为不变（**不要删**，激活路径仍在用）

## 3. 改动边界

- ✅ 允许修改：`python/worker_semantic_pre_v1.py`（新增 handler）、`lib/index.js`（新增 `_pySemanticRank` + 择优 + recall 接线）
- ✅ 允许修改（若确需）：`lib/python-sidecar-client-pre.js`（仅当现有调用方法不满足时，最小扩展）
- ❌ **禁止修改**：`lib/shadow-retrieval-pre.js`、`lib/semantic-js-pre.js`、`lib/recall-fusion-pre.js`、`lib/l0-extract-pre.js`、`lib/evidence-agg-pre.js`、`lib/memory-importance-pre.js`
- ❌ 禁止：改 `resolveSemanticTier` 的档位判定语义；改 `dense_search` 的三重过滤；改 C2 路径；引入第三方依赖

## 4. 验收标准

1. `dense_search` 已能返回 `{memoryId, score}` 列表（用真实/桩数据验证，若 `self.embedder` 未加载则验证 fail-soft 分支）
2. `_pySemanticRank`：tier=c3 时经 sidecar 返回 scores Map；sidecar 异常返回 null
3. recall：c3 档下含语义臂、结果带语义分；auto 档 python 可用则用 python、否则 c2；lexical 档无语义臂
4. fail-soft：python 不可用/超时 → 回退 C2（资产就绪）→ 词法，**不报错不阻塞**
5. 确定性/回归：非 c3 档下 recall 行为与现状一致；`rankFusionRRFPre` 无 `temp` 时逐字节不变
6. 既有基线不降：m4 / p8 14 / p4 34 / evidence-agg 14 / memory-importance 18 / p9a 26 / p9d 13 / temporal 51 / handoff 51 / continue-chain 58

## 5. 停止条件

- sidecar 的调用方法无法定位（grep 不到任何 request/push/command 出口）→ 停止回报
- `dense_search` 签名与本 prompt 描述不符 → 停止回报

```
停止原因：<描述>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 6. 完成后自检（静态，不重启）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory
node --check lib/index.js
python -c "import ast; ast.parse(open('python/worker_semantic_pre_v1.py',encoding='utf-8').read())"   # 语法
# 相关 smoke（python 侧无单测则说明用桩验证，勿删既有）
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs               # 14
node tests/smoke/smoke-test-p4-l0-response-pre.mjs              # 34
node tests/smoke/smoke-test-temporal-parse-pre.mjs 2>/dev/null  # 51（若存在）
node tests/smoke/smoke-test-handoff-pre.mjs                     # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs              # 58
git status --short
git diff --stat
```

## 7. 回报必须包含

1. sidecar 实际调用方法名 + 行号
2. 每处改动：`文件:行号 — 原内容 → 新内容`
3. c3 / auto / lexical 三档的召回行为对照（能跑则跑，跑不了用桩/静态说明并标注「未实证」）
4. fail-soft 路径说明
5. 回滚：`git checkout` 相应文件
6. 自检原始输出

---

> 背景：`docs/STATUS-BOARD.md` §8（时间臂之后）；诊断见 `docs/prompts/M8-2-ADJUDICATION.md` §6.4 及今日工作日志 §11。
