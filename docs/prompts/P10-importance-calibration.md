> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。
> 依赖：**P9 排查结论出来之后**（写入侧覆盖率决定 importance 的实际分布，先定标可能白做）。
> ⚠️ 本段**不阻塞发版**（属参数标定），但要求把权重做成**可配置项**，以便发版后无需改码即可调。

## 【P10】importance 效应定标（权重系数可调 + 翻转率实测）

**背景（实读代码 + 真实数据，2026-09-09 核实）**：
- M8-2b 在 `recall()` 的 L0 分支对 dense 臂加权：`dense: c.sem * (0.5 + 0.5 * importance)`（`lib/index.js` L0 段，行号以实际 grep 为准）。
- 真实数据：1268 事件 → 148 个 memoryId，importance ∈ **[0.30, 0.65]** → factor ∈ **[0.65, 0.825]**。
- **摆幅仅 1.27×**：只有 dense 分差小于约 **27%** 的候选对才可能被 importance 翻转。偏保守，**是否真能改变排序从未实测过**。

**目标**：① 把固定系数改为可配置；② 用真实查询测出翻转率，给出标定建议。

**涉及功能模块**：`lib/index.js`（dense 臂表达式 + 配置项读取）；量测脚本（临时，用完即删）。

**验收标准**：
1. 系数改为 `0.5 + w × importance`，**`w` 必须可配置**（设置项或配置键），**默认值 0.5**（与当前行为等价，零行为变更）
2. 配置缺失/非法 → 回退默认 0.5，fail-soft
3. **提供翻转率实测**：至少 10 条真实查询（覆盖主题性 / 错误码 / 文件名 / 时间类），对比 **w=0（关闭）vs w=0.5（默认）vs w=1（最大）** 三档下 top-10 的 `id` 序列，给出：
   - 每档相对 w=0 的 **排序变化条数** 与 **Kendall τ**（或简单的"位置变动数"）
   - 至少 1 个「importance 确实翻转了顺序」的具体样例（含 id、sem、importance、factor、前后位次）
4. 若 w=0.5 下翻转率显著偏低（建议阈值：<10% 查询发生任何 top-10 变化），在回报中给出**推荐 w 值**及依据；**不要擅自改默认值**
5. 不破坏 rank-space：importance 仍只作用于 dense 臂输入值，`lib/recall-fusion-pre.js` 一字不改
6. 基线不降：p8 14 / p4 34 / evidence-agg 14 / memory-importance 18；新增断言覆盖 w 缺省与非法值

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`lib/memory-importance-pre.js`、`lib/recall-fusion-pre.js`
- 关键词：`impMap`、`computeImportancePre`、`dense:`、`rankFusionRRFPre`、`l0Top`、`0.5 + 0.5`
- **必须先确认**：① 项目**既有配置项如何读取与落盘**（是否 `settings.yaml` / `config` 对象 / 环境变量）——**必须复用既有机制，不得自造一套** ② `diag()` 是否可用于输出量测结果 ③ dense 臂表达式的当前准确行号

**改动边界**：
- ✅ 允许修改：`lib/index.js` 中 dense 臂那一行 + 配置项读取（最小 diff）
- ✅ 允许新增：临时量测脚本（**用完即删**）；如需固化量测，另建 `tools/` 脚本并说明
- ❌ **禁止修改**：`lib/recall-fusion-pre.js`、`lib/memory-importance-pre.js`、`lib/evidence-agg-pre.js`、`lib/semantic-js-pre.js`
- ❌ 禁止：擅自改默认 `w`；把 importance 变成唯一排序依据；改 RRF 公式

**集成位置正确性（回报必写）**：配置项键名、默认值、读取位置行号；下游影响（哪些查询排序会变）。

**停止条件**：若项目**没有统一配置读取机制**（配置项均为硬编码），**立即停止回报**，由用户决定配置落点，不得自行引入配置文件或新依赖。

**回滚**：`git checkout lib/index.js`（或把 `w` 设为 0 即等价关闭加权）。

**自检清单**：按 `_COMMON.md` §5 执行（本段重点：`node --check lib/index.js` + p8 ≥14 + w 缺省/非法值断言）。

**⚠️ 接线类任务额外要求（见 `_COMMON.md` §7）**：本段为参数标定，回报中必须给出「**加权在生产路径真实生效**」的证据——不得只报告纯函数测试通过。
