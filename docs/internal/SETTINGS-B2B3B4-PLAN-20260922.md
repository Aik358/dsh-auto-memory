# 设置页 B2/B3/B4 施工工单 · 2026-09-22

> 本文件是**可执行工单**：按节照做即可改，每条结论带 `file:line`；无法确证的一律标「**推断**」。
> **只读取证**：本次未修改 `lib/` 下任何文件，未提交/推送，未重启任何进程。
> 前置文档：`docs/internal/SETTINGS-IA-PLAN-20260922.md`（9 分区 IA）、`docs/internal/SETTINGS-GAP-AUDIT-20260922.md`（缺口审计）。

---

## 0. 取证基线与纪律（先读，避免把行号当常量）

| 事实 | 值 | 取证方式 |
| --- | --- | --- |
| 宿主配置全集 | **101** 个一级键 | `lib/index.js` `DEFAULT_CONFIG`（`index.js:260-606`） |
| 设置页分区 | **9**，键序即导航顺序 | `sectionLabels` @ `client.js:6134-6144`；导航 `Object.keys(sectionLabels).map` @ `client.js:6151` |
| 分区渲染调用 | 9 处 `section('<key>', …)` | `engine` 6155 / `window` 6195 / `capacity` 6218 / `skills` 6233 / `handoff` 6250 / `auto` 6266 / `store` 6292 / `look` 6432 / `about` 6463 |
| 行渲染原语 | `field(label, control, hint)` @ `client.js:6077-6081`；`section(key,title,content)` @ `client.js:6145` | 直接读源码 |
| i18n 结构 | 单对象 `var I18N = { zh: {…}, en: {…} }`（`client.js:202` 起；`zh` 段 → `en` 段 → 闭括号 611-612）；回落函数 `t(key)` @ `client.js:723` | 读源码 + 机器解析 |
| 本次新增锚点纪律 | 所有插入点都用**唯一文本片段**锚定，不改任何既有 `data-dam-key` 字面量与 i18n 键名（对齐 `SETTINGS-IA-PLAN-20260922.md:121` 的零断言风险策略） | — |

> **行号漂移警告**：`lib/client.js` 仍可能被并发修改。**动手前必须重新取证行号**：用本文件给出的「唯一文本片段」定位，不要用行号直接跳转。
> **CRLF 陷阱**（用户已固化）：源码文本断言/补丁必须按 CRLF 处理，否则补丁自测会假红。

### 0.1 B1 已落地项（本工单的基线，不要重复施工）

`client.js` 中已带 `2026-09-22 补接线` 注释的行（**这批就是 B1**）：

| 键 | 现状行 | 备注 |
| --- | --- | --- |
| `tier0CatalogEnabled` | `client.js:6199` | 已接线 |
| `tier0MaxTokens` | `client.js:6200` | 已接线 |
| `rulesLayeringMode` | `client.js:6201` | 已接线（仍用 checkbox 表达 `self`/`off`） |
| `factRetentionMax` | `client.js:6222` | 已接线 |
| `memoryFileIndexEnabled` | `client.js:6229` | 已接线 |
| `procedureInjectEnabled` | `client.js:6243` | 已接线（设置页行） |
| `criteriaGate` | `client.js:6255` | 已接线 |
| `workspaceDiscoverMax` | `client.js:6430` | 已接线 |
| `pythonGpu` 删除 | `client.js:6400-6402` | 死键已删（注释留存） |
| 向导改键 `procedureInjectEnabled` | `client.js:5378` | 已改键（旧键 `procedurePromotionEnabled` 不再写入） |

---

# B2 · 文案人话化

## B2.0 取证方法（可复现）

1. **hint 全集**：`grep pattern="Hint: '|Hint:'" path=lib/client.js` → **178 命中**（含 zh+en 两套字典 + 少量非 hint 的同名行）。
2. **默认值真源**：逐键读 `lib/index.js` 的 `DEFAULT_CONFIG`（`index.js:260-606`）。
3. **对照口径**：只对**hint 文本中出现的数字/默认值描述**做逐条比对（不含「范围 20-480」这类值域描述，值域单独抽查）。
4. **i18n 缺键**：`t('…')` 字面量集合 vs `zh`/`en` 字典键集合（PowerShell 正则集差，见 §B2.5）。

## B2.1 三条已知可疑 hint —— 逐条核验（**三条全部成立**）

### C1 · `memoryHubEnabled`：「默认关」实为 **开**

| 项 | 证据 |
| --- | --- |
| 宿主定义 | `lib/index.js:575` — `memoryHubEnabled: true,`（同处注释：`2026-09-09 M8-3 经用户书面确认默认启用`） |
| zh 文案 | `lib/client.js:219` — `fMemoryHubHint: '总开关。开启后三层记忆(episodic 经历 / semantic 事实 / procedural 技能)开始运行;关闭则只保留已有记忆,不再沉淀新内容。默认关。'` |
| en 文案 | `lib/client.js:425` — `fMemoryHubHint: 'Master switch. On = … Off = keep existing memories but stop distilling new ones. Default off.'` |
| 前端渲染点 | `lib/client.js:6235`（`field(t('fMemoryHub'), …)`） |
| 实为多少 | **`true`（默认开）** |
| 危害 | 用户以为「关着的」，实际三层记忆一直在沉淀——**最影响信任的一类错** |

### C2 · `injectBudgetChars`：「默认 1600」实为 **8000**

| 项 | 证据 |
| --- | --- |
| 宿主定义 | `lib/index.js:290` — `injectBudgetChars: 8000,`（`index.js:283-289` 注释：`★2026-09-15（用户裁定）…默认 8000（原 2000）`） |
| zh 文案 | `lib/client.js:351` — `fBudgetHint: '记忆块总预算,超出部分截断。默认 1600(≈400-600 token/轮);…'` |
| en 文案 | `lib/client.js:553` — `fBudgetHint: 'Total budget for the memory block; excess is truncated. Default 1600 (~400-600 tokens/turn);…'` |
| 前端渲染点 | `lib/client.js:6197` |
| 实为多少 | **`8000`**（≈4000 token/轮；配合分级注入平均约 1300 token/轮） |
| 附注 | 同行的输入框兜底值也不是 8000：`client.js:6197` 的 `Number(e.target.value) \|\| 2400`（用户清空输入框会写 2400）——**B2 一并改成 8000** |
| 危害 | 用户按 1600 的认知调参，实际注入量是其 **5 倍** |

### C3 · `waterLevelWindowTokens`：「默认 65536」实为 **0（关闭）**

| 项 | 证据 |
| --- | --- |
| 宿主定义 | `lib/index.js:389` — `waterLevelWindowTokens: 0,`（注释：`0=自动——从 settings.yaml 的 agent-default-model 解析对应模型的 contextWindow`） |
| zh 文案 | `lib/client.js:375` — `fWaterWindowHint: '会话消息按官方公式(4 字符≈1 token)估算达到该值即视为上下文将满;0=关闭。默认 65536(128K 窗口的保守半量),按所用模型调整。'`（**自相矛盾**：同句既说「0=关闭」又说「默认 65536」） |
| en 文案 | `lib/client.js:577` — `fWaterWindowHint: '… 0 disables. Default 65536 — a conservative half of a 128K window.'` |
| 前端渲染点 | `lib/client.js:6257`（输入框兜底 `\|\| 0`，与真实默认一致） |
| 实为多少 | **`0`** |
| 危害 | 用户以为水位/交接链路在工作，实际该键为 0 ⇒ 水位判定按「自动探测窗口」走（不是关闭，而是**自动**）。⚠️ **纠正**：`index.js:389` 注释明确 `0=自动`（从 settings.yaml 解析），而前端文案写「0=关闭」——**前端文案本身是错的**，不是「默认值错」这么简单。见下方 B2.2 的 C3′ |
| 处置 | 文案必须同时改两处语义：①默认值 = 0；②`0` 的含义是「自动探测」而非「关闭」（B2.3 给建议文案） |

## B2.2 全量 hint 数字/默认值对照 —— **不一致共 5 条**（3 已知 + 2 新发现）

> 对照范围：`client.js` 中所有含数字/默认值描述的设置项 hint（zh 与 en 各自核；两套字典同错的按 1 条计，分开列出 en 行号）。

| # | 键 | hint 说的 | `DEFAULT_CONFIG` 实际 | 判定 | 证据（宿主 / zh / en / 渲染点） |
| --- | --- | --- | --- | --- | --- |
| **C1** | `memoryHubEnabled` | 默认**关** | **`true`** | ❌ 不一致 | `index.js:575` / `client.js:219` / `client.js:425` / 渲染 `client.js:6235` |
| **C2** | `injectBudgetChars` | 默认 **1600** | **`8000`** | ❌ 不一致 | `index.js:290` / `client.js:351` / `client.js:553` / 渲染 `client.js:6197` |
| **C3′** | `waterLevelWindowTokens` | 默认 **65536**，且「**0=关闭**」 | **`0`**，且 0 的真实语义 = **自动探测窗口** | ❌ 不一致（默认值 + 语义双错） | `index.js:389`（含 `0=自动` 注释）/ `client.js:375` / `client.js:577` / 渲染 `client.js:6257` |
| **C4**（新） | `handoffSwitchHint`（白板页开关组，非设置页行） | 「**两个开关出厂默认均为关闭**」 | `handoffEnabled = true`、`autoContinueEnabled = false` ⇒ **一开一关** | ❌ 不一致 | `index.js:360`（注释：`★2026-09-17（3.0.0 大版本，用户裁定「白板默认新版」）：默认由 false 改为 **true**`）/ `index.js:406` / `client.js:373` / `client.js:575` |
| **C5**（新） | `boardMode` 设置页 hint（about 区，行内文案非 i18n 字典） | 「默认**「旧版白板」**=一切行为不变」 | **`'graph'`** | ❌ 不一致 | `index.js:266`（`boardMode: 'graph'`，注释：`3.0.0 …默认由 'legacy' 改为 'graph'`）/ 按钮/hint @ `client.js:6466-6484`（hint 文本在 **6484**） |

**已复核为「一致」的关键项**（抽样，避免误改）：

| 键 | hint 说 | 实际 | 证据 |
| --- | --- | --- | --- |
| `associativeMemoryEnabled` | 默认关 | `false` | `index.js:491` / `client.js:216` |
| `memoryAnchorEnabled` | 默认关 | `false` | `index.js:337` / `client.js:217` |
| `noteCapacityChars` / `userCapacityChars` | 默认 24000 | `24000` | `index.js:329-330` / `client.js:353-354` |
| `tier0MaxTokens` | 默认 400 | `400` | `index.js:297` / `client.js:383` |
| `tier0CatalogEnabled` | 默认开 | `true` | `index.js:293` / `client.js:382` |
| `rulesLayeringMode` | 默认开 | `'self'`（语义=开） | `index.js:381` / `client.js:384` |
| `criteriaGate` | 默认开 | `true` | `index.js:387` / `client.js:385` |
| `procedureInjectEnabled` | 默认开 | `true` | `index.js:554` / `client.js:380` |
| `factRetentionMax` | 默认 1000 | `1000` | `index.js:582` / `client.js:381` |
| `workspaceDiscoverMax` | 默认 200 | `200` | `index.js:585` / `client.js:386` |
| `handoffPlanChars` / `handoffLedgerChars` | 默认 1200 / 800 | `1200` / `800` | `index.js:362,364` / `client.js:379,388` |
| `waterLevelThreshold` | 默认 0.75 | `0.75` | `index.js:397` / `client.js:378` |
| `snapshotMinGapRounds` | 默认 5 | `5` | `index.js:448` / `client.js:355` |
| `jsDecideExcerptChars` | 默认 40（范围 20-480） | `40` | `index.js:516` / `client.js:233` |
| `jsDecideDeltaExp` | 默认 0.01 | `0.01` | `index.js:512` / `client.js:229` |
| `externalInjectionChars` | 默认 1400 | `1400` | `index.js:471` / `client.js:359` |
| `autoConsolidateCooldownMinutes` / `DailyMax` / `MinChars` | 默认 30 / 8 / 240 | `30` / `8` / `240` | `index.js:341-345` / `client.js:360,366,367` |
| `awayMinutes` | 默认 60 | `60` | `index.js:423` / `client.js:361` |
| `unattendedMode` / `unattendedAuto` | 默认关 | `false` / `false` | `index.js:429,434` / `client.js:363,364` |
| `dayBoundaryMinutes` | 默认 450 | `450` | `index.js:463` / `client.js:251` |
| `projectMemoryDir` | 默认 `.dsh-memory` | `.dsh-memory` | `index.js:270` / `client.js:349` |
| `consolidateScheduleTime` / `Days`、`maintainScheduleTime` | 09:30 / 7 / 10:00 | 一致 | `index.js:349,351,355` / `client.js:390-393` |
| `waterLevelAutoHandoff`、`snapshotReinjectOnCompact`、`autoPopupEnabled`、`welcomeTourEnabled`、`reasoningObserverEnabled`、`contextBridgeObserveChildSessions`、`subagentGcEnabled` | 默认开 | `true` | `index.js:399,449,457,459,546,542,419` / `client.js:376,356,362,245,234,235,6262` |
| `autoContinueEnabled` | 出厂默认关 | `false` | `index.js:406` / `client.js:372` |
| `autoSummaryTimes` | 空=关闭 | `[]` | `index.js:461` / `client.js:368` |

> **本次未发现第 6 条数字型不一致**。抽查方式：以 `grep pattern="默认" path=lib/client.js` 的命中行逐条对表；值域描述（如 `1-8`、`0.1-1.5`、`20-480`、`min/max` 属性）与 `client.js` 的 `min:`/`max:` 属性抽查一致（`6158,6159,6160,6169,6200,6204,6220,6237,6238,6239,6258,6430`）。

## B2.3 顺带发现的两类非数字文案缺陷（同批改，成本近零）

| # | 位置 | 现状 | 问题 | 建议 |
| --- | --- | --- | --- | --- |
| T1 | `client.js:373`（`handoffSwitchHint`，zh）+ `client.js:575`（en） | 「此处与「**设置 → 上下文**」读写同一对配置键」 | B1 已把该分区改名为**长会话接续**（`sectionLabels.handoff` @ `client.js:6139`）⇒ 旧分区名成了死指引 | 改为「设置 → 长会话接续」/ "Settings → Handoff & continuation" |
| T2 | `client.js:2204-2205`（看板页面内的 legacy 提示，zh/en 行内文案） | 「切到新版看板: 设置 → **自动记忆引擎** → 看板模式」 | 同上：`自动记忆引擎` 分区已被 B1 改名为**关于与诊断**（`boardMode` 行现在 about 区 @ `client.js:6466`），且实际路径是「关于与诊断 → 白板模式」 | 改为「设置 → 关于与诊断 → 白板模式」；en 同步 |
| T3 | `client.js:380`（`fProcInjectHint`） | 末尾常驻一句「设置页此前的旧键「技能固化与晋升」宿主已不再读取…」 | 迁移说明写在常驻提示里，新用户读不懂（IA 计划 §1.4 J6 同结论） | 移出到 `about` 区一行小字；行内提示只留「总闸」语义 |
| T4 | `client.js:364`（`fUnattendedAutoHint`）/ `566`（en） | 正文出现**配置键名** `unattendedAutoHours` | 把键名当用户可见文案（IA 计划 §1.4 J7）；B3 会真给它控件 | 控件落地后改为「见下方『免打扰时段』」 |
| T5 | `client.js:222`（`fProcSessionsHint`）/ `428`（en） | 「默认 3(**M-04 元代码**)」 | 内部里程碑编号泄漏 | 删括号，或改为「默认 3」 |

## B2.4 建议文案（人话版：**它控制什么 / 默认多少 / 调它会发生什么**）

> 规则：①先说「改了会怎样」；②「关掉」必须写清**失去什么**；③不出现 `Tier-0`、`H1-H4`、`M-04` 等内部术语（`M-04` 在 B2.3-T5 处理）。

### C1 · `memoryHubEnabled`

- **zh（建议）**：`总开关。开：把对话沉淀成三层记忆——「经历」记发生过什么、「事实」记结论、「技能」记重复成功的做法，并自动整理。关：只保留已有记忆，不再沉淀新内容（不会删除旧记忆）。默认开。`
- **en（建议）**：`Master switch. On = distill conversations into three layers (episodes / facts / skills) and keep organizing them. Off = keep existing memories but stop distilling anything new (nothing is deleted). Default on.`
- **只改值**：`client.js:219`（zh）、`client.js:425`（en）——**键名 `fMemoryHubHint` 不变**。

### C2 · `injectBudgetChars`

- **zh（建议）**：`每轮塞进对话的记忆总量上限（字符），超出部分截断。默认 8000（约 4000 token/轮；因为完整快照每 5 轮才发一次，平均约 1300 token/轮）。调高＝它记得更多但每轮更贵；调低＝省 token 但容易「忘事」。`
- **en（建议）**：`Per-turn cap on how much memory is injected (chars); the excess is truncated. Default 8000 (~4000 tokens/turn; a full snapshot is sent only every 5 turns, so the average is ~1300 tokens/turn). Higher = it remembers more but every turn costs more; lower = cheaper but forgetful.`
- **同时改**：`client.js:6197` 的兜底 `|| 2400` → `|| 8000`（清空输入框时的回落值应与真默认一致）。

### C3′ · `waterLevelWindowTokens`

- **zh（建议）**：`上下文窗口按多少 token 估算。默认 0＝自动：从 settings.yaml 里当前模型的 contextWindow 读真实窗口（读不到时回退 131072）。只有自动探测不准（自定义模型/中转）时才手填，例如 128K 模型填 65536 是保守值。`
- **en（建议）**：`Window size used for the water-level estimate, in tokens. Default 0 = auto: read the real contextWindow of the active model from settings.yaml (fallback 131072). Fill a number only when auto-detection is wrong (custom models / proxies); e.g. 65536 is a conservative value for a 128K model.`
- **依据**：`index.js:389` 注释（`0=自动`）；`index.js:388-389` 的解析链路在宿主侧。**不要在文案里再写「0=关闭」**（那是前端旧口径，与宿主不符）。
- **（推断）**：`writeWaterCard` 侧「窗口来源」标签已有 `waterAutoSrc`（`client.js:394`，zh = `自动检测`）⇒ 界面本来就会显示「自动检测」，与新文案一致。

### C4 · `handoffSwitchHint`

- **zh（建议）**：`两个开关出厂默认不同：白板默认开（3.0 起），自动接续默认关（测试期）。这里与「设置 → 长会话接续」是同一对配置键，任一处改动全局生效。`
- **en（建议）**：`Defaults differ: the whiteboard ships on (since 3.0), auto-continue ships off (still in testing). These are the same config keys as Settings → Handoff & continuation; changing either applies globally.`

### C5 · `boardMode` 设置页 hint（`client.js:6484` 行内）

- **zh（建议，只改最后一句语义）**：`…**默认「新版看板（dsh-graph）」**（3.0 起）。切换到任一档都需重启 dsh web 生效；点回旧版即完全回滚到逐字节旧行为。`
- **en（建议）**：`…**Default: "Graph board (dsh-graph)"** (since 3.0). Switching either way needs a dsh web restart; switching back to legacy rolls back completely.`

## B2.5 i18n 缺键核验 —— **zh / en 各缺 3 个键（不是 6 个）**

**方法**：PowerShell 读 `client.js` 原文 → 按 `var I18N = {` / `zh: {` / `en: {` / `function t(key)` 切出 zh 段与 en 段 → 正则提键 → 与全部 `t('literal')` 字面量求差集。跑了两套键正则（宽松 `(?:^|[\s{,])(id)\s*:` 与严格 `(?:[{,]\s*)(id)\s*:`），并逐键 grep 复核。

| 结果 | 值 |
| --- | --- |
| `t('…')` 字面量键（去重） | **455** |
| zh 字典键（宽松法） | 494（含少量英文散文里的 `Word:` 假阳性） |
| en 字典键（宽松法） | 547（同上） |
| **zh 缺且被 `t()` 使用** | **`detecting`、`scan`、`style`**（3 个） |
| **en 缺且被 `t()` 使用** | **`detecting`、`scan`、`style`**（3 个，与 zh 同集） |
| 仅 zh 有、en 无 | `fDeltaExp`、`fDeltaPro`（2 个 —— 未观察到 `t()` 使用 ⇒ 暂列低优先，不阻塞） |

**逐键证据（三键均「无定义、有使用」，故 `t()` 会原样回显英文键名）：**

| 键 | zh 定义 | en 定义 | 使用点 |
| --- | --- | --- | --- |
| `detecting` | ❌ 无 | ❌ 无 | `client.js:2995`（`t('pyWizTitle'), ' — ', t('detecting')`，Python 向导加载态） |
| `scan` | ❌ 无 | ❌ 无 | `client.js:3701`（`act('scan')` 按钮文案，重新扫描） |
| `style` | ❌ 无 | ❌ 无 | `client.js:6428`（`t('style' + id.charAt(0).toUpperCase() + id.slice(1))` 的**动态前缀**；`t('style')` 本身是拼接产物，不是直接调用）⇒ **本条性质属「推断」**：`style` 出现在字面量集合只因正则匹配到 `'style'` 字符串片段；实际渲染走 `styleLife` / `styleProfessional` 等键 |

> **与 IA 计划的差异（必须修正）**：`SETTINGS-IA-PLAN-20260922.md:27` 记「zh/en 各缺 6 个（`detecting`、`hubWhyHasCorrection`、`hubWhyDiversity`、`hubWhySuccess`、`hubWhyCorrectionRate`、`hubEvLine`）」。本次实测：**后 5 个键在两套字典中都已存在**（zh `client.js:294-297,307`；en `client.js:497-500,509`）⇒ 那 5 条已在 B1 期间补齐；**当前真缺口 = 3 个，且与设置页无关**（Python 向导 + 记忆面板扫描按钮）。
> **补法**：zh/en 各补 `detecting`（`检测中…` / `Detecting…`）、`scan`（`重新扫描` / `Rescan`）。`style` 见上（先核 `style*` 系列是否齐备再决定是否补）。

### B2 施工清单（按顺序，逐条可独立验证）

1. `client.js:219` + `425`：C1 文案。
2. `client.js:351` + `553`：C2 文案；`client.js:6197` 兜底值 2400 → 8000。
3. `client.js:375` + `577`：C3′ 文案（默认 0＝自动）。
4. `client.js:373` + `575`：C4 文案（一开一关 + 分区名）。
5. `client.js:6484`：C5 默认档描述。
6. `client.js:2204-2205`：T2 分区名；`client.js:380` T3 迁移说明外移；`client.js:364`+`566` T4；`client.js:222`+`428` T5。
7. zh/en 各补 2 个 i18n 键（`detecting`、`scan`）。
8. **验收**：`grep -c "默认关。" ` 全库无「默认关」残留在 `memoryHubEnabled` 行；`grep "默认 1600"`、`grep "默认 65536"` 零命中；`node --check lib/client.js` 通过（该文件是模块包装，语法检查即可，不跑全量回归）。

---

# B3 · 补缺失设置项（32 条逐项）

## B3.0 现状复核（**重要：P0 已全部落地，不要再做一遍**）

按 GAP-AUDIT §1.3/§3 的分级逐条复核当前 `client.js`（检索方式：`grep pattern="<键名>" path=lib/client.js`，逐个命中行人工判定「是设置行 / 是文案提及 / 是只读引用 / 零命中」）：

| 分级 | 条数 | 已落地 | 仍缺 | 说明 |
| --- | --- | --- | --- | --- |
| **P0** | 5（表 A）+ 2（方向 B） | **7 / 7** | **0** | 见 §B3.1 |
| **P1** | 11 | **2**（`factRetentionMax`、`workspaceDiscoverMax`） | **9** | 见 §B3.2 |
| **P2** | 16 | **1**（`memoryFileIndexEnabled`） | **15** | 见 §B3.3 |

> **P0 复核证据（B1 已完成，本工单只做验收）**：

| # | 键 | 落地证据 | 建议动作 |
| --- | --- | --- | --- |
| P0-1 | `procedureInjectEnabled` | 设置行 `client.js:6243`（带 `'data-dam-key': 'procedureInjectEnabled'`，注释「设置页缺口审计 P0-1」）；宿主真源 `index.js:554`，解析口径 `lib/procedure-switch-pre.js`（GAP-AUDIT §2 第 2 行引用） | **验收**：开关翻面即时回显 + 保存后 `/config` 落盘 |
| P0-2 | `procedurePromotionEnabled` 向导改键 | 向导 toggle 已改为 `key: 'procedureInjectEnabled'` @ `client.js:5378`（注释「★2026-09-22 改键(设置页缺口审计 P0-2)」） | **补文案**：该行的 `name/sub` 仍是「技能固化与注入 / Skill crystallization」「重复流程固化为 checklist 自动附上；跨会话验证后晋升」——**说的是晋升，实际管注入/唤起**（`index.js:547-553` 注释），与本键真实语义不符 ⇒ 建议改为「技能注入与主动唤起 / Inject & activate skills」+「关=技能既不注入上下文，也不参与主动唤起；写入与晋升不受影响。」 |
| P0-3 | `tier0CatalogEnabled` | 设置行 `client.js:6199` | 验收 |
| P0-4 | `tier0MaxTokens` | 设置行 `client.js:6200` | 验收（提示当前写「默认 400」，与 `index.js:297` 一致；**未写硬上限 800**，可选补充） |
| P0-5 | `criteriaGate` | 设置行 `client.js:6255` | 验收 |
| P0-6 | `rulesLayeringMode` | 设置行 `client.js:6201` | 验收（值为 `self`/`off` 字符串，界面仍是 checkbox，本轮不改逻辑） |
| P0-7 | `pythonGpu` 死键 | **已删除**：`client.js:6400-6402` 的注释「★2026-09-22 删死键(设置页缺口审计 P0-7)… /config 会静默丢弃、宿主 lib/ 零读取 ⇒ 写入无任何效果」 | **采纳「删除」而非「补宿主消费点」**，理由见 §B3.4 |

## B3.1 `pythonGpu` 处置结论（问答：删除还是补消费点？）

- **结论：删除（已执行），不补宿主消费点。**
- **证据链**：①宿主侧零读取——`grep pattern="pythonGpu" path=lib` 仅命中 `client.js`（GAP-AUDIT §5.3 第 6 条：`lib/*.js` 0 命中）；②写盘必被丢弃——`/config` 白名单 = `Object.keys(DEFAULT_CONFIG)`（`index.js:11342`，GAP-AUDIT §4.1 复核）；③GPU 偏好已有真实通路（走 `embedding-config.json`，GAP-AUDIT §2 第 1 行引 `python-setup-pre.js:215`；**该行号本次未复核，引述时标「转引 GAP-AUDIT」**）。
- **为什么不该「补消费点」**：GPU 偏好属于**语义引擎安装态**（`embedding-config.json` 那条通路已有消费者），把它复制进 `DEFAULT_CONFIG` 会造成**同一语义两处真源**，与仓库既有纪律（「两套可互换、不联动」）冲突。⇒ 保持删除。

## B3.2 P1 · 9 条待施工（含锚点、控件、label/hint）

> **控件写法约定**（与 B1 既有行保持一致，避免风格漂移）：
> - checkbox：`h('input', { type: 'checkbox', 'data-dam-key': '<键>', checked: <表达式>, onChange: function (e) { set('<键>', e.target.checked) } })`
> - 数字：`h('input', { 'data-dam-input': '', type: 'number', min: <min>, value: cfg.<键> === undefined ? <默认> : cfg.<键>, onChange: function (e) { set('<键>', <带钳制的 Number(...)>) } })`
> - `data-dam-key` **只加在新行**（老行不受影响）；新建键若要被测试断言引用，需同时登记（本批无既有断言依赖）。
> - **新增 i18n 键**：每条给 zh/en 两版；键名建议 `f<X>` / `f<X>Hint`（沿用既有命名），**不要复用旧键名**（`tests/smoke/smoke-test-panel-position-pre.mjs:77` 锁了 5 个 i18n 键，改名即打红）。

### P1-1 · `tier0BudgetShare`

| 项 | 内容 |
| --- | --- |
| 默认值 | `0.25`（`index.js:300`） |
| 语义 / 消费点 | 目录层最多吃掉注入预算的比例；与 `tier0MaxTokens` **取小生效**。消费点 `index.js:5282`（`const shareN = Number(cfg.tier0BudgetShare)`），上游注释 `index.js:5263`、`index.js:5687` |
| 建议分区 | `window`（记忆窗口（注入什么）） |
| 控件 | 数字输入，`min: 0.05, max: 0.5, step: 0.05` |
| **插入锚点** | 在 **`client.js:6200`**（`fTier0Max` 行）**之后**插入。锚定片段（唯一）：`t('fTier0MaxHint')` |
| label zh | `目录层占注入预算比例` |
| label en | `Catalog share of injection budget` |
| hint zh | `目录层最多能吃掉总注入预算的百分之几（0.05–0.5）。与上面的「目录层 token 上限」取小生效：目录越大，日志/笔记这类证据段越短。默认 0.25。` |
| hint en | `Max share of the total injection budget the catalog may use (0.05–0.5). It takes the minimum with the token cap above: a bigger catalog leaves less room for evidence (logs / notes). Default 0.25.` |

### P1-2 / P1-3 · `slimPlanChars`（400）+ `slimLedgerChars`（300）

| 项 | 内容 |
| --- | --- |
| 默认值 | `400` / `300`（`index.js:370-371`） |
| 语义 / 消费点 | **精简版注入**里给白板 / 账本的字符额度（完整版是 `handoffPlanChars` 1200 / `handoffLedgerChars` 800）。消费点 `index.js:5456`、`index.js:5458`（`Math.max(Number(cfg.slimPlanChars) \|\| 400, 100)`），设计注释 `index.js:365-369`、`index.js:5452` |
| 建议分区 | `handoff`（长会话接续）→ **高级折叠组**（见 B4） |
| 控件 | 数字输入 ×2，`min: 100` |
| **插入锚点** | 在 **`client.js:6260`**（`fWaterAuto` 行）**之后**插入（即 `subagentGc` 两行之前）。锚定片段（唯一）：`t('fWaterAutoHint')` |
| label zh | `高级：精简版·白板额度（字符）` / `高级：精简版·账本额度（字符）` |
| label en | `Advanced: slim plan budget (chars)` / `Advanced: slim ledger budget (chars)` |
| hint zh | `完整快照每 5 轮才发一次，中间几轮发「精简版」——这两项管精简版里白板/账本能占多少字。默认 400 / 300（刻意小于完整版的 1200 / 800）。精简版的目的只是让模型「看到它长什么样、以及它已经旧了」，全文走 memory_read 或面板。` |
| hint en | `A full snapshot is sent only every 5 turns; between them a slim version is sent. These two cap how many chars the plan / ledger get there. Default 400 / 300 (deliberately smaller than the full 1200 / 800). The slim version only shows what it looks like and that it is stale — read the full text via memory_read or the panel.` |

### P1-4 · `autoContinueThreshold`

| 项 | 内容 |
| --- | --- |
| 默认值 | `0.75`（`index.js:408`，常量 `DEFAULT_AUTO_CONTINUE_THRESHOLD` @ `index.js:258`） |
| 语义 / 消费点 | 自动接续的水位阈值（**与 `waterLevelThreshold` 是两个独立键**，`index.js:253-258` 注释强调不得复用常量）。消费点 `index.js:3492`、`index.js:3678` |
| 前端现状 | **设置页无行**；接续浮层有输入框（`client.js:4041`，`autoSave({ autoContinueThreshold: v })`，范围 0.5–0.95）、读取 `client.js:3952/5747` |
| 建议分区 | `handoff`，**紧邻** `autoContinueEnabled` 下方 |
| 控件 | 数字输入，`min: 0.5, max: 0.95, step: 0.05`（与浮层一致，范围不要写成 0.1–1.5） |
| **插入锚点** | 在 **`client.js:6252`**（`fAutoContinue` 行）**之后**插入。锚定片段（唯一）：`t('fAutoContinueHint')` |
| label zh | `接续水位阈值` |
| label en | `Auto-continue threshold` |
| hint zh | `上下文占到官方声明窗口的百分之多少就该提示接续。默认 0.75——官方自动压缩阈值是 80%，留 5% 余量才来得及走完交接。与接续浮层是同一个配置键，两处双向同步。` |
| hint en | `How full the official declared window must be before the continue prompt appears. Default 0.75 — official compaction starts at 80%, so a 5% margin is needed to finish the handoff. Same config key as the continue panel; both stay in sync.` |
| 附注（推断） | 浮层输入框的合法区间是 0.5–0.95（`client.js:4041`），而 `index.js:407` 注释写 `(0.5-0.95)` ⇒ 设置页沿用该区间最安全 |

### P1-5 · `autoContinueRefreshRitual`

| 项 | 内容 |
| --- | --- |
| 默认值 | `true`（`index.js:412`） |
| 语义 / 消费点 | 接续前先让旧 Agent 刷新 PLAN + 账本。消费点 `index.js:3886`（`=== false` 直接 disabled）、`index.js:4406`（`refresh: this.config.autoContinueRefreshRitual === false \|\| !sid`） |
| 前端现状 | 只读：`client.js:3891`（`var ritual = !(cfg && cfg.autoContinueRefreshRitual === false) && …`）⇒ **无写入口** |
| 建议分区 | `handoff` → 高级折叠组 |
| 控件 | checkbox |
| **插入锚点** | 同 P1-2/3（`t('fWaterAutoHint')` @ `client.js:6260` 之后） |
| label zh / en | `高级：接续前先刷新交接材料` / `Advanced: refresh handoff material before continuing` |
| hint zh | `开（默认）：接续前先让旧会话刷一遍白板与账本，再用最新材料组装交接，材料更准但多一步等待。关：直接用现有材料接续（更快，材料可能旧）。` |
| hint en | `On (default): refresh the whiteboard and ledger in the old session before assembling the handoff — more accurate, one extra wait. Off: continue straight from existing material (faster, possibly stale).` |

### P1-6 · `unattendedAutoHours`

| 项 | 内容 |
| --- | --- |
| 默认值 | `['22:00-08:00']`（`index.js:437`） |
| 语义 / 消费点 | 免打扰（自动托管）时段，**支持跨午夜**；空数组 = 不按时间自动。消费点 `index.js:4810`（`Array.isArray(this.config.unattendedAutoHours)`），判据注释 `index.js:4801` |
| 前端现状 | **零控件，仅文案提及**：`client.js:364`（zh hint 明说「可在配置中调 unattendedAutoHours」）、`client.js:566`（en） |
| 建议分区 | `auto`（自动化与免打扰），**紧邻** `unattendedAuto` 下方 |
| 控件 | 文本输入（逗号分隔），写入时转数组 |
| **插入锚点** | 在 **`client.js:6283`**（`fUnattendedAuto` 行）**之后**插入。锚定片段（唯一）：`t('fUnattendedAutoHint')` |
| label zh / en | `免打扰时段` / `Do-not-disturb window` |
| hint zh | `上面的「到点自动」按这段时间判断，默认 22:00-08:00；支持跨午夜，可用逗号写多段（如 12:00-13:30,22:00-08:00）。留空 = 不按时间自动，只在检测到托管任务时才进入。手动开关优先于自动。` |
| hint en | `The off-hours window used by auto-unattended above; default 22:00-08:00. Midnight-crossing is supported; separate multiple windows with commas (e.g. 12:00-13:30,22:00-08:00). Empty = no time-based trigger (hosted tasks only). The manual toggle wins over auto.` |
| 取值口径 | 写盘值必须是字符串数组：`set('unattendedAutoHours', String(v\|\|'').split(',').map(trim).filter(Boolean))`（与 `autoSummaryTimes` @ `client.js:6285` 同写法） |

### P1-7 · `snapshotTieredInject`

| 项 | 内容 |
| --- | --- |
| 默认值 | `true`（`index.js:443`） |
| 语义 / 消费点 | 分级注入：完整快照每 N 轮一次，其间各轮给精简版；`false` = 回退旧行为（节流期间**不注入**精简版）。消费点 `index.js:10120`（`engine.config.snapshotTieredInject === false ? '' : engine.renderSlimSnapshotPre(wsHintPre)`），设计注释 `index.js:438-442`、`index.js:10181` |
| 建议分区 | `window` → 高级折叠组（与 `snapshotMinGapRounds` / `snapshotReinjectOnCompact` 同族） |
| 控件 | checkbox |
| **插入锚点** | 在 **`client.js:6205`**（`fReinjectOnCompact` 行）**之后**插入。锚定片段（唯一）：`t('fReinjectOnCompactHint')` |
| label zh / en | `高级：分级注入（完整/精简）` / `Advanced: tiered injection (full / slim)` |
| hint zh | `开（默认）：完整快照每 N 轮一次，中间几轮给「精简版」（规则 + 记忆目录 + 日程），保证规矩与索引一直在线。关：回退旧行为——节流期间什么都不注入，那几轮模型看不到规矩与记忆索引。` |
| hint en | `On (default): a full snapshot every N turns, a slim one (rules + memory catalog + agenda) in between, so rules and the index never go missing. Off: legacy behaviour — nothing is injected during throttled turns, so the model sees neither rules nor catalog.` |

### P1-8 · `pythonBackendExecutable`

| 项 | 内容 |
| --- | --- |
| 默认值 | `''`（留空 = `python`，PATH 解析；`index.js:526`） |
| 语义 / 消费点 | 高级 Python 引擎的解释器路径。消费点 **惰性 getter**：`index.js:9904`（`command: () => String(engine.config.pythonBackendExecutable \|\| '').trim() \|\| 'python'`） |
| 建议分区 | `engine` → 高级折叠组「高级：语义实验臂」（见 B4） |
| 控件 | 文本输入（占位符 `python`） |
| **插入锚点** | 在 **`client.js:6181`**（`t('semModeHint')` 所在 semMode 行）**之后**插入。锚定片段（唯一）：`t('semModeHint')` |
| label zh / en | `高级：Python 解释器（留空=python）` / `Advanced: Python executable (empty = python)` |
| hint zh | `只有「用哪套检索」选 Python 时才有意义。留空按 PATH 找 python；conda / venv 环境请填绝对路径。内置 JS 引擎不受影响。` |
| hint en | `Only relevant when "which engine" is set to Python. Empty resolves python from PATH; for conda / venv give an absolute path. The built-in JS engine is unaffected.` |
| 生效时机（推断） | 消费点是惰性函数（每次 spawn 前取），**推断无需重启**；实施时按 B4 标注口径处理 |

### P1-9 · `externalSources` 的 5 个新源（子键组）

| 项 | 内容 |
| --- | --- |
| 默认值 | 全部 `true`（`index.js:483-487`：`zcode-memory` / `zcode-sessions` / `kimi-global` / `kimi-sessions` / `trae-rules`；主键定义 `index.js:473-488`，共 **13** 个源） |
| 语义 / 消费点 | 逐源开关（链接模式：只注入路径指针、不注入内容）。消费点 `index.js:8245`（`const map = this.engine.config.externalSources \|\| {}`）、`index.js:4748`（`if (this.config.externalSources) void this.external.discover(true)`） |
| 前端现状 | 设置页**完全没有**「外部记忆源」分组；记忆面板扫描行可逐源勾选（`client.js:5441-5453`，走 `saveConfigPatch({ externalSources: cur })`）；**向导能勾的写死 8 个**：`EXT_SOURCE_KEYS` @ `client.js:5413`（缺 zcode×2 / kimi×2 / trae×1 共 5 键） |
| 建议分区 | `store`（存储与外部记忆）——比 GAP-AUDIT 建议的「外观」更贴 IA（本区已是「记忆存在哪、要不要接别的 AI 工具的记忆」） |
| 控件 | 折叠组内 13 个 checkbox（每源一行标签 + 说明） |
| **插入锚点** | 在 **`client.js:6430`**（`fWsDiscover` 行）**之后**、`section('store', …)` 收尾（`client.js:6431`）之前插入。锚定片段（唯一）：`t('fWsDiscoverHint')` |
| 分组标题 zh / en | `外部记忆源（只存路径指针，不复制内容）` / `External memory sources (path pointers only)` |
| 逐源 label | 直接用源 id 的人类可读名（workbuddy-user=WorkBuddy 用户记忆 / workbuddy-profile=WorkBuddy 云端画像 / codebuddy-memory=CodeBuddy 记忆 / claude-global=Claude Code 全局记忆 / project-conventions=项目约定文件 / workbuddy-sessions / claude-sessions / codex-sessions / zcode-memory=ZCode 记忆 / zcode-sessions=ZCode 会话 / kimi-global=Kimi Code 记忆 / kimi-sessions=Kimi Code 会话 / trae-rules=TRAE 规则） |
| hint zh | `关掉某个源后，它不再被扫描、也不会随会话注入（已写入本地记忆的内容不受影响）。协议约定：只存源文件的绝对路径指针，不复制内容——对方内容变了，指针不会过期。` |
| hint en | `Turning a source off stops scanning and injecting it (already-imported content is untouched). Only an absolute path pointer to the source file is stored — never a copy — so it never goes stale when the other tool rewrites it.` |
| **同步改动（必须）** | `client.js:5413` 的 `EXT_SOURCE_KEYS` 由 8 项扩到 **13 项**，否则向导的「全选/全不选」会漏掉这 5 个源（`client.js:5428` 用它整组写 patch） |

## B3.3 P2 · 15 条（1 条已落地）+ 高级折叠分组方案

> **先说一条与 GAP-AUDIT 结论不同的判断（有证据）**：GAP-AUDIT 给 `maxPacketItems` / `maxPacketChars` / `packetTtlSteps` / `injectionCooldownSteps` / `softInjectionEnabled` / `streamingInterruptionEnabled` 都建议了 UI。本次全库复核：**这 6 个键在整个 `lib/` 下只有 `DEFAULT_CONFIG` 定义行，没有任何读取方**（`grep pattern="softInjectionEnabled|streamingInterruptionEnabled|maxPacketItems|maxPacketChars|packetTtlSteps|injectionCooldownSteps" path=lib` → 命中仅 `index.js:540,597,599,601,603,605`，即 6 个定义行本身；`.js` 孪生文件 `lib/*.js` 同样零命中）。
> ⇒ **不给它们做控件**，改在 `about` 区一行只读说明（与 `SETTINGS-IA-PLAN-20260922.md:74` 的判断一致：给不生效的开关加界面 = 制造假控制）。
> **同时纠正 IA 计划的另一处**：`shadowRetrievalEnabled` / `contextBridgeEnabled` **不是死键**——前者消费于 `shadow-host-pre.js:58,199`，后者消费于 `context-host-pre.js:129,134,300` 与 `m7-index-sync-host-pre.js:54`（IA 计划 §1.2 把这两条列为「仅定义无读取」，**以本次证据为准**）。

### P2 明细表

| # | 键 | 默认 | 消费点（证据） | 分区 | 控件 | 处置 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `memoryFileIndexEnabled` | `false` | `index.js:1444` | `capacity` | checkbox | **已落地** `client.js:6229` |
| 2 | `l0IndexEnabled` | `true` | `index.js:9586`、`index.js:9608`（`!== true` 才零 IO） | `engine` | checkbox | 高级组 G3 |
| 3 | `autoContinueConfirmSeconds` | `35` | `index.js:3504` | `handoff` | 数字 min 5 | 高级组 G1 |
| 4 | `autoContinueRefreshTimeoutSeconds` | `90` | `index.js:3928` | `handoff` | 数字 min 10 | 高级组 G1 |
| 5 | `autoContinueCooldownMinutes` | `30` | `index.js:3495` | `handoff` | 数字 min 1 | 高级组 G1 |
| 6 | `shadowRetrievalEnabled` | `false` | `shadow-host-pre.js:58`、`:199` | `engine` | checkbox | 高级组 G3（需先开 `associativeMemoryEnabled`） |
| 7 | `contextBridgeEnabled` | `false` | `context-host-pre.js:129/134/300`、`m7-index-sync-host-pre.js:54` | `engine` | checkbox | 高级组 G3 |
| 8 | `activationInboxEnabled` | `false` | `activation-host-pre.js:63`、`:68` | `engine` | checkbox | 高级组 G3 |
| 9 | `pythonBackendWorkerPath` | `''` | `index.js:9905` | `engine` | 文本 | 高级组 G3 |
| 10 | `softInjectionEnabled` | `false` | **无消费点** | `about` | — | **只读说明**（不给控件） |
| 11 | `streamingInterruptionEnabled` | `false` | **无消费点** | `about` | — | 只读说明 |
| 12 | `maxPacketItems` | `2` | **无消费点** | `about` | — | 只读说明 |
| 13 | `maxPacketChars` | `800` | **无消费点** | `about` | — | 只读说明 |
| 14 | `packetTtlSteps` | `2` | **无消费点** | `about` | — | 只读说明 |
| 15 | `injectionCooldownSteps` | `3` | **无消费点** | `about` | — | 只读说明 |
| 16 | `capacityDefaultsVersion` | `24` | `index.js:1941-1955`（`upgradeCapacityDefaultsPre()` 迁移守卫，只升一次） | `about` | — | **不渲染控件**；about 区一行小字说明 |

### P2 高级折叠分组方案（**4 组**）

| 组 | 落点分区 | 组名（zh / en） | 组内键清单 |
| --- | --- | --- | --- |
| **G1** | `handoff` | `高级：接续细节` / `Advanced: continuation details` | `autoContinueConfirmSeconds`、`autoContinueCooldownMinutes`、`autoContinueRefreshTimeoutSeconds`（**并入同组的 P1 键**：`slimPlanChars`、`slimLedgerChars`、`autoContinueRefreshRitual`） |
| **G3** | `engine` | `高级：语义实验臂` / `Advanced: experimental semantic arms` | `l0IndexEnabled`、`shadowRetrievalEnabled`、`contextBridgeEnabled`、`activationInboxEnabled`、`pythonBackendWorkerPath`（**并入同组的 P1 键**：`pythonBackendExecutable`） |
| **G4** | `about` | `已停用的历史开关（改了不生效）` / `Retired switches (no effect)` | `softInjectionEnabled`、`streamingInterruptionEnabled`、`maxPacketItems`、`maxPacketChars`、`packetTtlSteps`、`injectionCooldownSteps` —— **只列键名 + 一句说明，不给控件** |
| **G5** | `about` | `内部迁移标记` / `Internal migration marker` | `capacityDefaultsVersion` —— 纯文本行（说明容量默认值 2026-09-18 由 12000 上调到 24000，老配置只自动抬一次） |

> **`window` 区的高级组**（`snapshotTieredInject`，P1）建议并入该区既有的三项快照行之后，**不单开组**——该区已有 3 个同族键，单独折叠反而割裂。
> **G4 的推荐文案**（`about` 区，非控件）：
> zh：`以下历史开关已停用：softInjectionEnabled、streamingInterruptionEnabled、maxPacketItems、maxPacketChars、packetTtlSteps、injectionCooldownSteps。它们仍存在于配置文件但宿主已无任何读取方，改了不起作用。`
> en：`Retired switches: softInjectionEnabled, streamingInterruptionEnabled, maxPacketItems, maxPacketChars, packetTtlSteps, injectionCooldownSteps. They still exist in the config file but nothing reads them — changing them has no effect.`

### 附加项（GAP-AUDIT §1.4 提到，仍有缺口，一并补）

| 键 | 默认 | 消费点 | 分区 | 控件 | 锚点 | label（zh / en） | hint（zh / en） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hubMechanicalProcedureFeedEnabled` | `false`（`index.js:571`） | 语义见 `index.js:561-571` 注释（机械推进 procedure 线；**本次未逐行复核消费点，标「推断」**） | `skills` | checkbox | 在 `client.js:6243`（`fProcInject` 行）之后，锚定片段 `t('fProcInjectHint')` | `机械流程切片（不推荐）` / `Mechanical flow slicing (not recommended)` | `开：把「看到过一件事」的意图机械截断成技能名与步骤（无模型介入），产出的条目可读性差、审批时看不懂。关（默认）：只保留模型自己写的技能与人工写入。` / `On: mechanically truncates episode intents into "skills" with no model involvement — the result reads badly in the approval list. Off (default): only model-authored and manual entries.` |
| `procedurePromotionEnabled`（旧键） | `false`（`index.js:560`） | **不再给写入口**（`index.js:555-559`：保留为读取回退别名，新键缺省时按它取值） | — | — | — | — | **不要给它做控件**（GAP-AUDIT §2 第 2 行的结构性不可达问题）；向导行的文案修正在 §B3.0 P0-2 |

## B3.4 插入锚点汇总（**打补丁专用**：唯一文本片段 + 期望命中数）

> 用法：每条补丁 = 「内容锚定（唯一片段）+ 命中数断言（`expect 1`）+ 前后 SHA256」。**不要用行号打补丁**（行号会漂移）。
> 断言写法参照仓库既有习惯：命中数 != 期望值 ⇒ 直接失败，不做容错替换。

| 锚点编号 | 落点 | 唯一文本片段（在 `client.js` 中应恰好出现 1 次） | 期望命中数 | 插入内容 |
| --- | --- | --- | --- | --- |
| A1 | `window` 区，`fTier0Max` 行后 | `t('fTier0MaxHint')` | 1 | `tier0BudgetShare` 新行 |
| A2 | `window` 区，`fReinjectOnCompact` 行后 | `t('fReinjectOnCompactHint')` | 1 | `snapshotTieredInject` 新行（高级组 G-window） |
| A3 | `handoff` 区，`fAutoContinue` 行后 | `t('fAutoContinueHint')` | 1 | `autoContinueThreshold` 新行 |
| A4 | `handoff` 区，`fWaterAuto` 行后 | `t('fWaterAutoHint')` | 1 | G1 组头 + `slimPlanChars` / `slimLedgerChars` / `autoContinueRefreshRitual` / `autoContinueConfirmSeconds` / `autoContinueCooldownMinutes` / `autoContinueRefreshTimeoutSeconds` |
| A5 | `auto` 区，`fUnattendedAuto` 行后 | `t('fUnattendedAutoHint')` | 1 | `unattendedAutoHours` 新行 |
| A6 | `engine` 区，`semMode` 行后 | `t('semModeHint')` | 1 | G3 组头 + `pythonBackendExecutable` / `pythonBackendWorkerPath` / `l0IndexEnabled` / `shadowRetrievalEnabled` / `contextBridgeEnabled` / `activationInboxEnabled` |
| A7 | `skills` 区，`fProcInject` 行后 | `t('fProcInjectHint')` | 1 | `hubMechanicalProcedureFeedEnabled` 新行 |
| A8 | `store` 区，`fWsDiscover` 行后 | `t('fWsDiscoverHint')` | 1 | 「外部记忆源」折叠分组（13 个 checkbox） |
| A9 | `about` 区，`fVersion` 行前 | `t('fVersion')` | **2**（`client.js:6485` 与 i18n 定义行同片段）⇒ 用更长片段：`field(t('fVersion'), h('div', { 'data-dam-row': '' },` | 1 | G4 只读说明 + G5 只读说明 |
| A10 | `store` 区，`section('store'` 收尾前 | `field(t('fWsDiscover')` | 1 | 与 A8 二选一（A8 更精确） |

> **A9 的坑（必须用长片段）**：`t('fVersion')` 在 `client.js` 里出现 2 次（i18n 字典定义 `fVersion: '插件版本'` 与渲染 `field(t('fVersion')`）。**只匹配短片段会打错位置**——这正是「命中数断言必须写死」的价值。
> **A3/A4 的相对顺序**：先插 A3（`autoContinueEnabled` 紧跟阈值），再插 A4（`fWaterAuto` 之后）——两者锚点不同，顺序无关，但**都必须在同一批内做完**，否则 G1 组头会与 P1 行分离。

<!-- APPEND-ANCHOR -->

