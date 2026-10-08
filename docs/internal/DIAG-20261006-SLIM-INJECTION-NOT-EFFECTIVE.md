# 诊断报告 · 为什么"精简注入"没有完全生效

**日期**：2026-10-06 ｜ **性质**：只读取证（未修改任何被跟踪文件）｜ **状态**：根因已确认，修法待用户拍板

---

## 0. 结论一句话

**分级注入的插件侧逻辑是对的；失效点在宿主侧。** 宿主把**两个 context 面拼接成一个字符串**做逐字节去重，而插件注册的第二个面（"记忆唤回"块）由独立通道按相关性投递、内容频繁变化 ⇒ 拼接串每次都不同 ⇒ 宿主认为"快照变了"⇒ **重新投递整份完整版**。

用户看到的"连续多次 4-5k 字"，**就是唤回块本身**（实测平均 3,836 B、最大 4,358 B），它一变就把 37 KB 的完整版一起拖下水。

---

## 1. 证据链

### 1.1 宿主去重机制：整串逐字节比较

`dsh-agent-loop/lib/index.js`（从 `app.asar` 解出，730 KB）：

\`\`\`js
// preStep() —— 每一步都跑
const sections = renderContextSections(assembly);
const context = this.runtimeContext.project(joinContextSections(sections), sections);
//                                                    ^^^^^^^^^^^^^^^^^^^ 所有面拼成一个字符串

// RuntimeContextProjection.project() —— 去重的唯一判据
project(current, sections) {
  if (this.retained === void 0 && current.length === 0) return;
  const snapshot = current.length === 0 ? CLEARED : current;
  if (this.retained?.text === snapshot) return;   // ← 逐字节不等就追加新 user/message
  return createUserMessage({ content: [{ type: "text", text: snapshot }], ... });
}
\`\`\`

**关键**：`joinContextSections(sections)` 把**全部** context 面拼接。任一面的任何一个字节变化，整串即不同。

### 1.2 插件注册了两个 context 面

| # | 名称 | order | 内容 | 变化频率 |
|---|---|---|---|---|
| ① | `dsh:auto-memory-pre` | `SECTION_ORDER` | 记忆快照（完整版 / 精简版） | 低（分级逻辑控制） |
| ② | `dsh:m6-reference-tail-pre` | `SECTION_ORDER + 1` | **记忆唤回块**（`[Retrieved memory reference …]`） | **高（每步按相关性投递）** |

`lib/index.js:14742` 注册 ①，`:15008` 注册 ②（`renderTailFor(agent)`）。

### 1.3 反证：插件侧渲染是逐字节稳定的

探针 `.diag-issues20261006/.tmp-render-stability.mjs`：真实 `MemoryEngine` + 真实 `renderMemoryDynamic(context)`，连续 6 次渲染 ——

\`\`\`
第1次渲染: 4164 字节 ... 第6次渲染: 4164 字节
★连续 6 次渲染逐字节稳定 = true
\`\`\`

⇒ **快照本身没问题**，问题在拼接进来的第二面。

### 1.4 真实投递量化（会话 `session-da9f94ab`，45.5 MB 转写，1758 条快照消息）

多帧 zstd 解压后逐条解析 `user/message`：

| 指标 | 数值 |
|---|---|
| 快照投递事件 | **1758**（完整版 1751 / 精简版 7） |
| 基础快照（唤回块之前）平均 | **37,326 B** |
| 基础快照**去重后版本数** | **485 / 1758** ← 稳定 |
| 唤回块非空 | **1063 / 1758** 次 |
| 唤回块平均 / 最大 | **3,836 B / 4,358 B** ← **用户看到的 "4-5k"** |
| 整体去重后版本数 | **1152**（vs 基础 485） |

**反事实测算**：若唤回块逐字节稳定 ⇒ 宿主可去重 **480 次**，只需投递 **1278** 次；实测投递 **1758** 次 ⇒ **多投 480 次（+27%），约 17.15 MB 无谓开销**。

### 1.5 日志侧吻合

`~/.dsh/dsh-auto-memory-diagnose.log`（284 条 `tiered inject` 判定）：

| 判定 | 次数 |
|---|---|
| 完整版（**快照未变·交宿主去重**） | **140** |
| 精简版（未获授） | 81 |
| 完整版（兜底） | 12 |
| 完整版（首次注入） | 10 |
| 精简版（冷启动） | 8 |
| 精简版（节流 N/5） | 15 |
| 完整版（真人在场 / 攒够精简） | 12 |
| 完整版（间距已满足 / 暂缓放行） | 4 |

最长**连续完整版 46 次**（2026-10-05 15:47 前）。140 次走的是 `lib/index.js:14986` 那个"例外分支"——它的**整个前提**就是"返回全文交给宿主 project() 去重，零额外投递"。

---

## 2. 为什么 2026-10-05 的修复没覆盖它

那次修的是**插件侧的判定逻辑**（四处）：日志段指纹正则前瞻、同 turn 每步都给完整版、真人轮被 runtime-context 压住、`snapshotMinGapRounds` 语义保真 —— **全部在 `renderMemoryDynamic` 函数内部**。

本失效点在**宿主侧的拼接去重**：插件代码里看不到 `joinContextSections`，因此代码注释写了错误假设——

> `lib/index.js:14984`：「此时返回全文交给宿主 project() 去重，**零额外投递**，比给精简版更省」

该假设在"只有单一面"时成立；有了唤回块这个第二面后**不成立**。这也是为什么插件侧越修越细，用户体感仍是"一直在灌"。

---

## 3. 修法方案（三选一，待拍板）

### 方案 A · 唤回块不再参与快照去重（推荐 · 治本）

给唤回块加"内容未变则返回 `''`"的节流（或把其投递改为真正的独立 message），使 `joinContextSections` 的结果在唤回内容不变时逐字节稳定。
- **代价**：需确认 `dsh:m6-reference-tail-pre` 面与唤回通道的既有契约（`activation-host.js:460 renderTailFor` 已有 `exactDigest` 校验，可复用）。
- **风险**：低；不影响插件侧分级逻辑。

### 方案 B · 插件侧放弃"交宿主去重"这一例外（最小改动）

`lib/index.js:14986` 的例外分支改为：**既然去重不可靠，就按分级判定给精简版**（不再依赖 `stT._snapFp === snap` 返回全文）。
- **代价**：与"同 turn 逐字节相同文本保持完整版"的既有取舍冲突；需重新评估 context-observer 的 prompt 稳定性契约。
- **风险**：中；改变已验收行为，需全量回归。

### 方案 C · 唤回块并入快照面

把唤回块从独立面移入 `dsh:auto-memory-pre`，由插件在快照层统一决定"是否值得重新投递"。
- **代价**：**推翻了 2026-09-15 用户裁定**（"唤回块是独立 context 面，与本文的精简/完整无关"，见 `lib/index.js:1099`、`:15016`）。
- **风险**：高（触及用户已裁定设计）。

---

## 4. 判据与验收钉子

1. **修前基线（可复算）**：本报告 §1.4 的 1758 / 485 / 480 / 27% / 17.15 MB。
2. **修后预期**：唤回内容不变时，`joinContextSections` 结果逐字节稳定 ⇒ 宿主 `project()` 返回 `undefined`（不追加）。
3. **探针**：`.diag-issues20261006/.tmp-quant3.mjs`（量化）、`.tmp-counterfactual.mjs`（反事实）、`.tmp-render-stability.mjs`（插件侧稳定性）、`.tmp-diff2.mjs`（相邻快照 diff）—— 四支均可直接复跑。
4. **负路径**：必须构造"唤回块变化 / 不变"两组，断言**只有不变组**被去重。

---

## 5. 附：本轮新增探针清单（均在 `.diag-issues20261006/`）

| 文件 | 用途 |
|---|---|
| `.tmp-tier-diag.mjs` / `.tmp-tier-diag2.mjs` | 解析诊断日志，统计 `tiered inject` 各判定分布 |
| `.tmp-asar2/3/4.mjs` + `.tmp-agent-loop.js` | 从 `app.asar` 解出宿主源码 |
| `.tmp-render-stability.mjs` | 真引擎连续渲染，断言逐字节稳定 |
| `.tmp-multiframe.mjs` / `.tmp-rc2.mjs` / `.tmp-quant3.mjs` | 多帧 zstd 解压会话，统计真实投递 |
| `.tmp-diff2.mjs` | 相邻两次快照 diff，定位变异来源 |
| `.tmp-counterfactual.mjs` | 反事实去重测算 |
