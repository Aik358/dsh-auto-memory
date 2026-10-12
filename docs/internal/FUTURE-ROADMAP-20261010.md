# dsh-auto-memory 未来规划总览（2026-10-10 · **勘误重写版**）

> **⚠️ 本文档是重写版，修正了同日首版的一处实质错误**：首版把大量**已完工的施工/交接文档**（`ROADMAP.md`、`SEMANTIC-ARCHITECTURE-SPEC.md`、`P3-IMMEDIATE-7-WORKORDER`、`NEXT-VERSION-TODO`、`COT-WATCH-RFC` 等）当成「前瞻」写了进来。**用户指出后经代码取证更正**。
> **本文只写「真的还没做」的事**；已完工的文档**不进本文**，只在 §5 列为「历史归档索引」。
> **判据（本仓纪律）**：**「文件存在」≠「机制在跑」**。凡列「待办」，必须**实测代码接线数**为证；凡列「已落地」，同样给证据。

---

## 0. 判定方法（可复算）

对每个条目，在 `lib/index.js` 数**真实接线命中数**，并检查是否有专项模块：

| 判据 | 含义 |
|---|---|
| 接线命中数 = 0 且有专项文件 | **定义存在但未接线** ⇒ 待办 |
| 接线命中数 > 0 | **已在主线运行** ⇒ 已落地，**不属未来规划** |
| 无文件、无接线 | 未开工 ⇒ 待办 |

> 本方法直接套用了本仓既有铁律：**「定义存在 ≠ 机制在跑」——同时数定义处与调用点，调用点 0 = 未接线**。

---

## 1. ★真正的未来待办（全部有取证）

### 1.1 用户 2026-10-10 新提四项方向（**最新，未批准开工**）

| # | 方向 | 要点 | 状态 |
|---|---|---|---|
| **U-1** | **用户画像注入 / secondary me** | 现有 user/规则文档**偏技术**、缺「me」维度；需在**长上下文开头 + 周期**提醒用户画像与偏好；机制 = **动态调整式注入**（首次给完整画像，注意力稀释后再注入） | 未立项 |
| **U-2** | **发送时刻的 OpenViking 式向量检索 + 语义唤回** | 点发送即刻用**用户原文**做向量检索并直接告知 AI；★用户自评**公关主打**。落点 = 用 OpenViking `find()` 语义（不做意图分析、单查询、低延迟）替代当前**意图门控** | 未立项 |
| **U-3** | **兼容性与生态互操作** | 插件目前「自成一派」；希望兼容 **OpenViking 与其他记忆插件**、适配**外部 RAG/记忆库**、**官方记忆上线后适配**。★核心亮点「实时语义唤回」**不因兼容降级** ⇒ 兼容层必须是**旁路** | 未立项 |
| **U-4** | **ConvMemory 轻量重排器** | 见 §3 | 未立项 |

> 注意：**U-3 与本仓既有的 `OFFICIAL-MEMORY-PRESTUDY` 部分重叠**，但**该预研的结论尚未实施为代码**（见 §1.2），故 U-3 仍是真待办。

### 1.2 精排（Rerank）——**唯一「有文件但没接线」的真待办**

**取证**：`lib/rerank-host.js`（9 KB）**存在**，但 `lib/index.js` 中 `rerank|RERANK` 命中 = **0** ⇒ **定义存在但未接线**（本仓铁律的典型案例）。

**该模块自带的实测留痕**：
- bge-reranker-v2-m3：**P95 37.4 秒**（50 对/题，RSS 3.84 GB）
- qwen3-reranker-0.6b：**P95 8.8 秒**（10 对/题，RSS 4.95 GB）
- 收益真实：**recall@1 0.739 → 0.898**
- **真实缺口 = GPU 版 torch（现 `torch 2.13.0+cpu`）+ 快档量化产物**
- ⇒ 现以 `off`/`fast`/`enthusiast` 三档 **fail-closed**（`resolveRerankTierPre` 对 fast/enthusiast 恒返 `active:false, reason:tier-not-provisioned`）

**待办实质**：**接线**（注入 `opts.rerankFn`）+ 解决算力缺口。`rerank-host.js` 的档位/有界窗口（60 s）/LRU 缓存（16 条）**已就绪**，工作主要在**接线与模型侧**。

### 1.3 3.3 两条候选（**需一次性迁移**）

> 源文档：`docs/internal/ROADMAP-3.3-CANDIDATES.md`（2026-10-08，**真前瞻**）

**进 3.3 主题的判据**：满足「**需要一次用户可感知的一次性迁移**」——捆绑发布让用户**只经历一次**迁移窗口。

| 候选 | 内容 | 迁移代价 |
|---|---|---|
| **C-01 · #201** | **语义向量策略 v2（Python 侧）**：① `build_doc_ids` + `encode_ids` **双重 `[CLS]/[SEP]` 包装** ⇒ 向量语义偏移；② 512 正文分块**尾部 token 永久丢失** | `CHUNK_POLICY_VERSION` 升 v2 ⇒ **既有全部向量判 stale**、**全量重嵌入**（BGE-M3 CPU 分钟级）、期间**语义检索拒服务**。**JS 档（lexical）零影响** |
| **C-02 · #179** | **工作区目录键物理身份化**：`wsKey` 把分隔符与连字符折叠同值 ⇒ `C:\work\a-b` 与 `C:\work\a\b` **同一目录键**，两工作区共用一份记忆 | 改键 = **换目录名** ⇒ 旧目录不自动认领，**用户会看到「记忆全没了」** ⇒ 必须做旧键迁移 + 碰撞提示 |

**⚖️ 三条前置决策（阻塞开工，未拍板）**：
1. **C-01 重嵌入**走**阻塞式**还是**后台渐进式**？（建议渐进式：把窗口从「分钟级不可用」降到「降级服务」）
2. **C-02 迁移交互**走**静默搬迁**还是**提示确认**？碰撞如何告知？
3. 3.3 是否还收纳其它破坏性改动？（当前仅 C-01/C-02 满足判据）

### 1.4 拆包（可维护性）

> 源文档：`docs/internal/RESEARCH-20261008-PLUGIN-SPLIT-FEASIBILITY.md` + `docs/internal/RESEARCH-20261008-PLUGIN-SPLIT-STRATEGY.md`（**真前瞻**，AST 精确）

**一句话结论**：正确第一刀**不是「按功能域切」**，而是「**先把 165 个方法的基础层抽成共享依赖**」。

| 做法 | 抽取放大率 |
|---|---|
| 不抽基础层直接切域 | **9.8x–18.8x** |
| 先抽基础层 | **2.7x–5.2x** |

⇒ **3.6–5.0 倍差距**。结构真相：`MemoryEngine` = **L2206→L12909（10,704 行 / 265 成员）**；依赖拓扑是 **DAG 而非纠缠团**；**引擎没有自然的方法级切分点**。

**五步策略**：第 0 步非侵入准备（零风险可立即做）→ 第 1 步抽纯基础层（杠杆最大）→ 第 2 步 `config` 端口化 → 第 3 步按干净簇分包 → 第 4 步半面拆分 → 第 5 步剩余 188 方法大簇（高风险最后做）。

**⏳ 待用户拍板**：拆包策略 **A/B/C/D**（用户仍未定）。

### 1.5 官方记忆兼容（**等官方发布**）

> 源文档：`docs/internal/OFFICIAL-MEMORY-PRESTUDY-20260929.md`（**真前瞻**，性质「预研报告·供拍板·未动任何代码」）

- **证据**：`@deepseek-ai/dsh` 0.2.0-rc.2 依赖 **82 个官方包 / 287 包名逐一核对** ⇒ **无 memory/recall 包** ⇒ **官方尚未发布**。
- **三形态预测**：A MCP memory server（~60%）/ B 宿主 `ctx.memory` 接缝（~30%）/ C 纯云端（~10%）。
- **关键结论**：官方大概率做「模型主动查」或「官方决定注入什么」⇒ **本插件核心差异化（写入前主动唤回 + 语义判定 fv2 + 预算仲裁）三形态下都不被覆盖**。
- **⑤ 已定案**：**不需为官方记忆另建索引文件**；正确姿势是**车道对齐而非数据对齐**（官方在场时事实层降频/停注，保留官方不覆盖的**过程层** procedure / handoff / 白板 / PLAN；写入侧可选镜像；锚点兼容）。
- **待办实质**：**等官方发布** + 届时按上述预案实施。**现在无法动工。**

### 1.6 其它待决

| # | 事项 | 状态 |
|---|---|---|
| Q-7 | 跨版本 `stateSchemaVersion` 协商（3.2.14/3.2.2 混装） | 待定（#330 评论已说明） |
| Q-8 | `.diag-i304/`、`.diag-split/` 清理 | 待定 |

---

## 2. 已定案的裁定（**不再讨论 · 保持现状**）

| # | 裁定 | 源 |
|---|---|---|
| D-1 | **语义增强 = 设置内可选安装向导**（~2.3 GB 如实标注，跑通才开） | `RELEASE-SEMANTIC-OPTION.md` |
| D-2 | **规则段瘦身 / `[降级]` 段治理 / 唤回并面** ⇒ 三项**不做** | `DESIGN-20261006-INJECTION-ASYMMETRY-FIX.md` |
| D-3 | **唤回块无法脱离 context 面独立投递** ⇒ 不得朝此方向设计 | 2026-10-06 定案 |
| D-4 | **不做** #241 分步整理（无功能收益、动两个三万行核心文件、触碰红线） | `ROADMAP-3.3-CANDIDATES.md` §三 |
| D-5 | **礼節性 merge 为可选项**（对 base=main mergeable=true 的 PR 可 merge 记 credit） | 2026-10-09 裁定 |
| D-6 | 官方记忆**不另建索引文件**（见 §1.5⑤） | `OFFICIAL-MEMORY-PRESTUDY` |

---

## 3. ConvMemory 调研（2026-10-10 实测核实 · 未立项）

**用户线索**：大型重排 ~2 s，ConvMemory **28.6 ms**、质量保住 **98%**；接在向量检索之后；记忆库与向量检索都不用换；`pip install convmemory`。

**外部事实核实（实测，非转述）**：ConvMemory **真实存在**，HF 上 **6 个模型**：

| 模型 | 关键文件 | 体积 |
|---|---|---|
| `ConvMemory-LoCoMo-MPNet`（v1） | `model.pt` | **13.9 MB**（PyTorch pickle） |
| `ConvMemory-v2-Evidence-Reranker` | `cross_encoder/model.safetensors` | **86.7 MB** |
| `ConvMemory-v3-Validity-Context` | 同上 | **703.5 MB** |
| **`ConvMemory-ZH-DualSpace-GTE`** | triplet safetensors | **1,164.9 MB** ★**中文专用** |

**两条关键限制（v2 模型卡原文）**：
1. Base = `cross-encoder/ms-marco-MiniLM-L-6-v2`；候选池 = v1 top-10。
2. **「preserves the exact ConvMemory v1 top-10 candidate set and only reorders that protected prefix」**、**「cannot recover a gold memory that v1 failed to retrieve into top-10」** ⇒ **只改顺序、不提升召回**。

**JS 端限制（用户猜测属实，已定位）**：本仓 JS 侧走 **Transformers.js + ONNX**（已冻结 `multilingual-e5-small/onnx/model_quantized.onnx` 118 MB）⇒ **JS 只能吃 ONNX**；ConvMemory 官方只发 `.pt`/`.safetensors` ⇒ **必须自行转 ONNX**。**Python 路已具备**（`python/worker_semantic_v1.py` 等）⇒ **Python 侧接入是最短路径**。

**集成落点**：**正是 §1.2 的 `lib/rerank-host.js`** —— 它已就绪且**尚未接线**，注释明示「模型调用经 `opts.rerankFn` 注入」。⇒ **ConvMemory 可作为该模块的第一个真实 `rerankFn` 实现。**

**立项前必须完成**：① **数字须本机复算**（用户给的是宣传文案）；② 它**不提升召回**；③ **中文优先**评估 `ZH-DualSpace-GTE`；④ JS 路线需自转 ONNX 且模型随作者迭代 ⇒ **额外维护面**；⑤ 许可证 `mit` 商用需复核。

---

## 4. 五大开源记忆系统（**参考，非待办**）

> 源文档：`docs/MEMORY-SYSTEMS-SURVEY-2026-09.md`（仓库状态截至 2026-09-06）

| 系统 | 最值得借鉴 | 周期 |
|---|---|---|
| **MemOS 2.0** | 自然语言反馈修正记忆 ⇒ `memory_correct` 工具 | 短期 |
| **OpenViking** | **L0 快速相关性判断**；目录递归检索 + 轨迹可观测 | 短期/中期 |
| **Hindsight** | **Reflect 驱动记忆重组**；Mental Models 版本化 | 短期/中期 |
| **Second Me** | 参数级记忆（LoRA）——「成为你」，与我们是**互补**；⚠️ 已一年未活跃 | 长期 |
| **MetaMem** | **元记忆**：不只记什么，还记「怎么用记忆」 | 中期 |

---

## 5. 历史归档索引（**已完工 · 不是前瞻**）

> 以下文档**首版被我误列为前瞻**，经代码取证确认**已落地**。列此仅供查阅，**不再作为未来规划**。

| 文档 | 真实状态（取证） | 证据 |
|---|---|---|
| `docs/ROADMAP.md`（分层语义唤回） | ✅ **已落地** | `l0-extract.js` / `l0-index.js` / `l0-index-sync.js` **存在**，`index.js` 接线 **30 处** |
| Tier-0 常驻目录 | ✅ **已落地** | `tier0-catalog.js` 存在，接线 **49 处** |
| `GLOBAL-BRIEF-PRESTUDY-20260930.md`（全局简报） | ✅ **已落地**（★**该文档自称「未动任何代码」= 文档过期**） | `lib/global-brief.js` 存在，接线 **34 处** |
| `PROCEDURAL-MEMORY-AND-APPROVAL-DESIGN`（程序性记忆） | ✅ **已落地** | `procedure-store.js` 等，接线 6 处 |
| `COT-WATCH-RFC.md`（CoT 监听） | ✅ **§1-§3 已实施**（文档自述） | `reasoning-delta` 在 `index.js` |
| `NEXT-VERSION-TODO.md`（水位/序号） | ✅ **三项已于 v2.5.0 落地**（文档自述） | 水位/接续接线 **140 处** |
| `SEMANTIC-ARCHITECTURE-SPEC.md` | ✅ **已落地**（文内 ✅×25） | `semantic-*.js` 四个模块存在 |
| `M8-PATHWAY-REVIEW-20260923.md` | ✅ **只读复盘+工单**（非前瞻） | 文内自述「不含任何代码改动」 |
| `P3-IMMEDIATE-7-WORKORDER-20260922.md` | ✅ **只读调查产出**（非前瞻） | 文内自述「只读调查产出」，✅×23 |
| `PREVIEW-NEXT-STEPS.md` | ✅ **历史交接**（2026-08-23） | — |
| `PROJECT-FREEZE-AND-ROADMAP.md` | ✅ **冻结蓝图 · 历史快照**（2026-08-25） | — |
| `NEXT-MAJOR-VISION.md` | ⚠️ **愿景文档**（非施工单） | 自述「写给未来失忆的自己」；★改 README 前必读 |
| `MASTER-PLAN-3.0.md` | ⚠️ 自述「**待施工设计、代码尚未改动**」 | 但其内容多已由后续批次落地 ⇒ **需逐条复核** |
| `MEMORY-MUTATION-AND-INDEX-DESIGN.md` | ⚠️ 自述「只做方案设计，不动工，待拍板」 | 可能仍有未落地部分 |
| `RAG-KARPATHY-PROGRAM.md` | ⚠️ 多数已落地（✅×17） | 需逐条复核 |

---

## 6. 阅读顺序（新会话照此）

1. **本文**（真待办清单）
2. `ROADMAP-3.3-CANDIDATES.md`（**最近的前瞻 + 3 个待拍板**）
3. `RESEARCH-20261008-PLUGIN-SPLIT-FEASIBILITY.md` + `RESEARCH-20261008-PLUGIN-SPLIT-STRATEGY.md`（拆包）
4. 按需跳 §1 各条源文档
5. **白板**（不在本仓）：`~/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/PLAN.md`

---

<!-- 2026-10-10 勘误重写版 · 修正首版「把已完工文档当前瞻」的错误 · 全部状态经代码接线数取证 · 未改任何代码 -->
