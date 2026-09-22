# 新用户引导改版方案（2026-09-22 · 待用户拍板）

> 依据：`docs/internal/ONBOARDING-AUDIT-20260922.md`（只读审计，368 行）+ 本轮 Lead 侧代码取证
> 状态：**仅方案，未改任何源码**（用户要求「先出个方案就行」）

## 0. 现状（硬证据，全部本轮复核）

| 项 | 位置 | 说明 |
|---|---|---|
| 引导步骤定义 | `lib/client.js:5853-5919` | `TOUR_STEPS` 数组，**9 步**：WELCOME / CORE / SNAPSHOT / EXPERIENCE / DAILY ASSISTANT / EXTERNAL / RETRIEVAL / ACTIVATION / READY(final) |
| 末页渲染 | `lib/client.js:6084-6096` | `step.final ? h('div', null, …)` → `data-dam-tour-chips` + `data-dam-tour-where` 两块 |
| 完成/关闭 | `L5988-6004` `finishTour` / `L6007` `closeOrRemind` | 完成后打开 update 卡 |
| **版本内联** | **`L5997` `var latestKey = '2.1.0'`**；`L6001` 兜底 `CHANGELOG['2.1.0']` | **硬编码**，不会跟随版本 |
| 对照（已动态） | `L7252` `var bigKey = (CHANGELOG[d.current] ? d.current : '2.1.0')` | 同一需求在另一处**已经**做对了 |
| CHANGELOG | `L808` 起，**37 个版本键**，定义序**最新在前**（`keys[0]` = `'3.1.1'`） | 有现成 `cmpVersion()` 可用（`L1298` 已在用） |
| 赞助页（已存在） | `docs/CONTRIBUTORS.html`（26.3 KB） | README 中英均已挂同一链接 |

## 1. A 类 · 让开关说真话（最高优先，必须先定）

> 这三条不改，新用户第一次做选择就可能被误导 —— 尤其第 1 条：**界面翻面了、行为没变**。

| # | 键 | 症状（硬证据） | 两个选项 |
|---|---|---|---|
| **A1** | `injectEnabled` | 向导 `client.js:5868` 与设置页 `:6921` 都写它；键在 `DEFAULT_CONFIG`（`index.js:334`）⇒ 能落盘、能翻面、能读回；但排除 `procedureInjectEnabled` 后**全 `lib/` 零读取点** ⇒ **关掉后记忆照旧每轮注入** | **(a) 接线**：把真实注入门（`snapshotMinGapRounds` / `snapshotReinjectOnCompact` / `promptSectionToggles`）与它对齐——做成「总闸 + 细分」两层；**(b) 删键**：删 `DEFAULT_CONFIG` 键 + 删向导与设置页 2 个控件。**推荐 (a)**：用户主权是既有产品立场（P10-A 注入分区开关就是为这个加的） |
| **A2** | `hubMechanicalProcedureFeedEnabled` | 功能**通**（`index.js:9904` → `memory-hub-pre.js:56`），但全 `client.js` **只有向导 1 处**（`:5913`）；设置页 `section('skills')`（`:6958-6974`）**漏了控件** ⇒ 向导关掉后**无处回改** | 设置页补一行控件（与 `procedureInjectEnabled` 同节，`:6966-6968` 有先例注释）。**无争议，建议直接做** |
| **A3** | `softInjectionEnabled` | `index.js:606` 声明，全库**零读取点**、设置页**零控件** ⇒ 不可达死配置 | 删键，或标注为保留字段并加注释说明 |

## 2. B 类 · 过时文案 13 条（6 必改 + 7 建议）

> 全部在 `lib/client.js`。**中英双语都要改**（每条都有 zh/en 两处）。

**必改 6 条**

| # | 位置 | 原文问题 | 应改为 |
|---|---|---|---|
| B1 | `:5896` | 向导「思维链监听」写「**默认关**」，真值 **`true`**（`index.js:612`）——**方向反了**，且涉敏感 CoT | 「默认开；内容比可见输出更敏感，建议按需关闭」 |
| B2 | `:5907` | 说技能晋升审批在「**记忆中枢**」页，实际审批队列在「**唤起回顾**」页（`:3675`）；且该开关只做注入/唤起，**不控晋升** | 拆清：「开关在 X，审批在唤起回顾页」；不要把两个机制耦成一句 |
| B3 | `:237` | `planDisabled` 指向「设置 → **自动化**」，`handoffEnabled` 实际在「**长会话接续**」（`:6976`/`:6713`） | 改为「长会话接续」 |
| B4 | `:3905`/`:3921` | 指向已**不存在**的分区名「设置 → 自动记忆引擎」，实名「**语义记忆总开关**」（`:6709`） | 改为实际分区名 |
| B5/B6 | `:5868` + `:6921` | = A1 的两个控件（文案与行为一致性问题） | 随 A1 决策一起处理 |

**建议 7 条**：Python 体积三个口径不一致（563MB / 539MB / 568,456,694B≈542MiB，`:6083` 等）；JS 同屏 130MB vs 129MB；`EXT_SOURCE_KEYS` 8 项 vs 实际 13 源（`:5942`，当前无消费者，属隐患）；孤儿 i18n 键 `secSemantic`；等。

## 3. C 类 · 末页加两个小按钮（用户指定）

**位置**：`step.final` 块内、`data-dam-tour-where` **之后**（`L6096` 与 `L6097` dots 之间）——**不动现有节点**，只追加一个兄弟块。

**结构（新增，~14 行）**

```js
step.final ? h('div', null,
  h('div', { 'data-dam-tour-chips': '' }, /* ← 原样保留，一字不动 */ ),
  h('div', { 'data-dam-tour-where': '' }, /* ← 原样保留，一字不动 */ ),
  // ↓ 新增：赞助/贡献入口（两个小按钮 + 一句短注）
  h('div', { 'data-dam-tour-links': '' },
    h('a', { href: 'https://htmlpreview.github.io/?https://github.com/Aik358/dsh-auto-memory/blob/main/docs/CONTRIBUTORS.html',
             target: '_blank', rel: 'noopener noreferrer', 'data-dam-tour-link': '' },
      locale === 'zh' ? '贡献者与赞助' : 'Contributors & Sponsors'),
    h('a', { href: 'https://api.dshapi.icu/register?aff=HJU27P7JL39N',
             target: '_blank', rel: 'noopener noreferrer', 'data-dam-tour-link': '' },
      locale === 'zh' ? 'DSH API 中转站' : 'DSH API relay'),
    h('div', { 'data-dam-tour-links-note': '' },
      locale === 'zh' ? '感谢为本项目出力的贡献者与基础设施赞助方。' : 'Thanks to our contributors and infrastructure sponsors.'))) : null
```

**视觉约束（「不夸张、不破坏结构」）**
- 复用现有 design token：`--dsw-alias-border-l1` 描边、`brand-primary` 12% 透明底（与向导 `close` 按钮 `:5997` 同一套），**新加 CSS ≤ 6 行**
- 字号 `calc(10.5px * var(--dam-scale))`，两个按钮**并排**、`inline-flex` + `gap: 6px`，**不占整行、不加图片**
- 注解一行 `opacity:.6`，≤ 22 字
- 文案**走 inline `locale` 三元**（与 `TOUR_STEPS` 全体现有写法一致），**不新增 i18n 键** ⇒ 零 i18n 表改动、零回归风险

**一个待确认**：`aff=HJU27P7JL39N` 是**你的推广参数**，会写进源码并可被任何人看到。若不想公开，可只挂 `https://api.dshapi.icu/`（无 aff）。**默认按你给的原文带 aff。**

## 4. D 类 · 收紧「版本内联」硬编码（用户指定）

**现状**：`finishTour` 里 `var latestKey = '2.1.0'`（`L5997`）—— 不管装的是哪版，关掉向导后**永远弹 2.1.0 的大更新卡**。

**改法（3 行）**：把 `'2.1.0'` 换成从 CHANGELOG 动态取最大版本（同文件 `L7252` 已有正确先例）：

```js
var latestKey = Object.keys(CHANGELOG).reduce(function (a, b) { return cmpVersion(b, a) > 0 ? b : a }, '2.1.0')
openDialog({ kind: 'update', versions: [{ version: latestKey, items: CHANGELOG[latestKey] }], currentVersion: cur })
```

**要点**
- 兜底仍是 `'2.1.0'` ⇒ CHANGELOG 万一为空也不崩（沿用现约定）
- `cmpVersion()` 已在同文件 `L1298` 使用，**不引入新函数**
- 同步把 `L6001` 的 catch 分支兜底改成同一 `latestKey`
- **行为变化**：3.1.2 发布后，新装用户关掉向导看到的是 **3.1.2 的更新说明**（而不是 2.1.0 的老卡）—— 这正是你要的「自动内联到最新版本」
- ⚠️ 顺带说明：`L7250` 附近那段「更新说明卡」逻辑**已经是动态**的，本次只修 `finishTour` 这一处，**不动那处**

## 5. 实施顺序（拍板后执行）

1. **A1 决策**（接线 or 删键）← **需要你先定**，这是唯一有产品含义的分叉
2. A2/A3 + B 类文案 + C 类按钮 + D 类动态版本 —— 可**一个补丁批次**做完（都是 `lib/client.js`，同一个文件单写者）
3. `node --check` 语法闸门 → 全量回归（基线 **168 套件**）
4. 新增守卫：断言 ①末页含两个链接且 `href` 与 README 一致 ②`finishTour` 里**不再有**字面量 `'2.1.0'` 作为 `latestKey` ③向导里不再出现已不存在的分区名（防文案再次腐化）
5. 最后一项是**宿主未重启**提醒：本批只改 `client.js`（浏览器侧），**理论上刷新页面即可生效、无需重启宿主** —— 与改 `index.js` 的那些批次不同

## 6. 未纳入本方案（如需请明说）

- 引导**步数**是否增删（现状 9 步；C 类是「追加」，不是「加一步」）
- 引导**视觉/动画**改造（用户既有规则：无确凿证据不得删动画；本方案不碰）
- `welcomeTourEnabled` 语义（现有「首启自动播 / 关闭后仅手动」两态正常，未发现问题）
