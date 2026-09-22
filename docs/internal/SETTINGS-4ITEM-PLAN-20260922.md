# 设置工程 4 项 · 执行计划表（2026-09-22）

> 权威依据：用户本轮下达的两轨任务。轨一 = 设置工程（本文件 4 项）；轨二 = 「每轮注入必要性」调研（见文末 R1/R2）。
> 反压缩锚点：本文件是这 4 项的唯一进度表，上下文被压缩后按本表续做。

## 0. 根因定案（S1 · 已完成，证据确凿）

**一个根因，两个症状**：B1 分区重构把「触发按钮」与「被触发面板」切到了不同分区，而分区导航是**滚动式**（`jumpToSection` 只做 `scrollIntoView`，全部 `section(...)` 顺序平铺渲染）⇒ 面板确实渲染了，但渲染在当前视口**下方 6 个分区处**，用户看到的是「点了毫无反应」。

| 证据 | 位置 |
|---|---|
| 「⟳ 检测」按钮在 **engine 分区**（`semMode` 行内），`onClick` → `runDetect()` → `setDetOpen(true)` | `lib/client.js:6176` → `:6096` |
| 「🧩 安装向导」按钮也在 **engine 分区**，`onClick` → `setGuide('js'\|'python')` | `lib/client.js:6179` |
| 检测面板 `data-dam-detect-panel` 却挂在 **store 分区**内 | `lib/client.js:6292` `section('store', …)` → 面板 `:6329` |
| Python 向导 `h(PySetupWizard)`、JS/Python 引导卡同样在 **store 分区** | `lib/client.js:6331` / `:6332` |
| 分区导航非分页：`data-active` 只用于高亮，内容容器平铺全部 `section(...)` | `lib/client.js:6151` / `:6154` |
| 分区顺序：engine(1) … store(7) of 9 ⇒ 面板在引擎区下方 6 个分区 | `sectionLabels` = `engine/window/capacity/skills/handoff/auto/store/look/about` |
| 原设计意图就是「semMode 下拉旁」 | `lib/client.js:6293` 注释原文 |

**可移动块边界（补丁用）**：`6293–6407`（含注释头、`detOpen ? (function(){…})() : null,`、`guide === 'python' ? h(PySetupWizard) : null,`、`guide === 'js' || 'python' ? (function(){…})() : null,`）；`store` 分区自身内容从 `:6408` 的 `field(t('fUserDir')` 起。插入点 = engine 分区 `field(t('semMode'), …)` 之后（`:6181` 行末 `t('semModeHint')),`）。

## 1. 四项计划表

| # | 项 | 做法 | 验收 | 状态 |
|---|---|---|---|---|
| **S2** | 修好两个丢失的页面（阻塞项） | 把 `6293–6407` 整块**原样搬回** engine 分区 `semMode` 行下（纯移动，零行为改动）；再补 `revealPanelSoon()`（`block:'nearest'` 平滑滚动）挂在 `runDetect`、模式切换自动弹引导、🧩 按钮三处，保证「自动弹出」在任何滚动位置都可见 | 用户点「⟳ 检测」当场看到面板；点「🧩 安装向导」当场看到引导卡；缺失资产时切模式自动弹卡 | **已完成（纯移动，未加滚动网）** |
| **S3** | 永久守卫 | 新增 `tests/smoke/smoke-test-s2-settings-panels-pre.mjs`：①断言 `data-dam-detect-panel` / `PySetupWizard` / 引导卡的渲染文本**位于 `section('engine'` 区间内**（分区归属按源码顺序断言）；②断言渲染不依赖任何折叠开关（不含 `AnimatedDisclosure` / `collapsed`）；③断言三处 `revealPanelSoon` 调用存在；④断言块行数与搬移前守恒 | 守卫全绿且能在人为挪回 store 时变红 | **已完成（37 条断言，含 G5 反例自检 3/3 报违规）** |
| **S4** | 回归 | `node --check`（ESM ⇒ 用 `.mjs` 副本）+ 全量 `node tools/run-smoke.mjs --timeout=90000`（原基线 161 套件 / PASS 161 / 44.3–45.9s；本轮新增 1 条守卫 ⇒ **套件数 162**） | **PASS 162 / FAIL 0 / TIMEOUT 0（57.3s）** | **已完成** |
| **T1** | 注入分区开关 → 二级页面 | 一级只放**中性文案 + 入口**（「高级：逐段注入控制…」），二级页才是 13 个开关；**清单从宿主常量 `PROMPT_SECTION_KEYS_PRE_V1` 取**（宿主经 `/config` 应答体的 `promptSections` / `promptSectionMust` 下发，前端只提供文案、**不硬编码成员与顺序**）；明确写「不推荐修改」 | 守卫 `smoke-test-t1-prompt-sections-pre.mjs`（**54 断言**，含反例自检）断言两侧键集合相等、通路完整、分层正确 | **已完成** |
| **T2** | 每开关后果标注 | must 段（`plan-update-request` / `water-advisory`）在开关旁标注关闭后果（zh+en）；其余段用通用提示 | 守卫 G2e/G2f 断言两个 must 段各有中英后果文案 | **已完成** |
| **T3** | 即时回显 + 一键恢复 | 走既有 `set()` 写入路径（勾选即删键 → 回到出厂态；取消写 `false`）；「全部恢复全开」一键写空对象 | 守卫 G5a–G5e | **已完成** |
| **T4** | 设置页搜索（可选，最后） | 按分区关键词过滤导航 + 滚动定位，不改分区结构 | 输入关键词即可跳到对应分区 | 待做 |

## 2. 轨二 · 注入必要性调研（R1/R2）

前提（用户订正，**唯一权威前提**，不得再按旧假设造轮子）：
- 只要是人发的信息 ⇒ 必然首先发**全量** prompt；
- Agent 自跑期间 ⇒ **每 5 轮一次全量**（日志 `[dsh-auto-memory-pre] tiered inject: 新 turn 强制完整版（turn:41 · 无真人消息）`），其余轮次发**精简** prompt。

| # | 调研问题 | 产出要求 |
|---|---|---|
| **R1** | 每轮固定成本到底多少 | 逐项**实测**：注入骨架 + 规则段（6,214 字符 ≈ 3,107 token）+ Tier-0（实计 385 token）+ 白板（截断 1200）+ 账本（截断 800）；精简版 vs 完整版差额一律取 `envelopeMeta` 权威值，**禁止估算** |
| **R2** | 这个节奏该不该改 | 给出成本表 + 改动的连带代价，明确点名「改节奏会破掉哪些既有纪律」（如每轮维护白板的可行性、规则段永不裁剪的承诺） |

## 3. 纪律

- `lib/client.js` / `lib/index.js` 是**单写者**文件：Lead 落盘；补丁一律内容锚定 + 命中数断言 + 幂等标记只对**原始快照**判定 + `--dry` 必须走到**最后一条守恒断言** + 落盘前 `node --check`（ESM 用 `.mjs` 副本）。
- 本轮不动 `lib/index.js`（宿主侧 P10-A 的 13 键常量与 `pushPart` 闸门已就绪）；纯前端改动**不需要** `tools/release.mjs` 双表登记。
- 未经用户明确指令：不 commit / 不 push / 不 publish。
- **严禁重启 3080 宿主**：改完只告知用户自行重启。
