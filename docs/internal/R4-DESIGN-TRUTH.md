# R4 设计真源（机器可消费规格）· dsh-auto-memory

> **用途**：把老前端（`lib/client.js`）真实存在的配色 / 液态玻璃材质 / 双形态结构 / 动效刻度，提取成下游构建者可**直接抄**的规格，不再需要做设计判断。
> **来源**：task-5 施工单；四份设计真源文档 + `lib/client.js` 源码实测。
> **纪律**：每条结论带 `文件:行号` 锚点；无法从源码确认的显式标注「**推断**」并给依据；查不到写「源码未找到」。

## 0. 取证口径与源版本（**引用前先读**）

| 项 | 值 |
|---|---|
| 源文件 | `lib/client.js` |
| 字节数 | **689,407 B** |
| 字符数 | 600,159 |
| 行数 | **7,735 段**（`split(/\r?\n/)`）= 7,734 个 CRLF + 末尾空段；**非空行 7,631** |
| EOL | **纯 CRLF**（CRLF 7,734 / 裸 LF **0**） |
| SHA256 | **`8DC0B03D0D54B3EA55A325AFAC1D1083FD85367C647D8A89926A08532D073583`** |
| mtime | 2026-09-23 20:11:12 |
| 提取方式 | 只读探针脚本 `artifacts/_r4-probe{,2,3,4,5,6,7,8,9,10,11,12}.mjs`，输出留档 `artifacts/_r4-probe*-out.txt` |

**⚠️ 行号漂移必读**：`docs/internal/MOTION-SPEC-20260922.md` 的行号取证于 `client.js` **6,612 行**那一版（该文档 §0.0 已自述）；当前版本 **7,735 段**，两者相差 **+1,123 行**。
⇒ **本文件所有行号一律取自上述 SHA256 版本**；引用 MOTION-SPEC 的条目时，本文件给出**当前版本复核后的新行号**。
⇒ 跨版本引用请用**声明原文**检索，不要用行号。

**已知口径不可复现项（如实声明）**：施工单给出的 `ease`×62 无法从当前版本复现。实测三种口径：裸 `ease` 作 timing = **28**；`ease` 家族全部字样（含 token 名与 `release`/`please` 等无关词）= **130**；纯 `transition`/`animation` 简写里的裸 `ease` = **21**。详见 §D.4。

---

# A. 配色真源

## A.1 十六进制色值频次表（`lib/client.js` 全量实测）

扫描口径：`/#[0-9a-fA-F]{3,8}\b/g`，命中 **189 次 / 56 种**。

### A.1.1 主色族（`--dam-accent` 的五种兜底值 —— **同一语义从没定过一个值**）

| 色值 | 次数 | 语义角色 | 出现处（行号） |
|---|---|---|---|
| **`#4f7cff`** | **21** | 品牌蓝 / 强调色（**最常用兜底**） | 导航选中字色＋底 `:1641,:1642`；钉住态底 `:1716`；设置导航选中 `:1735`；图例点 `:1753`；侧栏按钮选中 `:1797`；spinner 边框 `:1801`；缩放提示 `:2265`；水位条默认色 `:4657`；关系图边 `:4875`；日历「重要不紧急」`:5175`；今日格边框/底 `:5263,:5264`；连接页关闭钮 `:6098`；连接页圆点 `:6099`；紧急度非紧急分支 `:6399`；QQ 群链接 `:7393` |
| **`#2456c4`** | **15** | 强调色**深色变体**（focus / 实底 / 渐变起点） | `:focus-visible` 描边 `:1707`；页签箭头 hover 底 `:1727`；**页签激活态实底色** `:1729`；向导进度条渐变 `:1946`；接续页卡片边框 `:3313,:3331`；进度条渐变 `:3353`；选中卡边框＋投影 `:3498,:3536`；左强调边 `:3545`；`:7125,:7135` |
| **`#3a6df0`** | **14** | **首启向导专用**强调色（`--dam-tour-*` 域） | 主按钮渐变 `:1955`；按钮 hover 投影 `:1956`；推荐徽标 `:1961`；开关组边框/底 `:1970`；开关实底 `:1976`；链接字色/底/边 `:1985,:1986,:1987,:1989,:1990` |
| **`#1d4ed8`** | **8** | **代码里真正传给 `--dam-accent` 的值** | `ACCENT_VALUES.deepseek = '#1d4ed8'` **`:839`**；保存条脏态按钮 `:1743`；日历格 hover 边框 `:1783`；关系图节点填充/描边 `:4880,:4886`；日历小时刻度线 `:5334` |
| `#6b98ff` | 1 | 兜底（仅 `range` 的 `accent-color`） | `:1746` |

> **关键事实**：`--dam-accent` 在源码里有 **5 种不同兜底值**（`#2456c4`×15 / `#3a6df0`×14 / `#4f7cff`×10 / `#1d4ed8`×7 / `#6b98ff`×1，合计 49 处 `var(--dam-accent, …)`）。
> ⇒ 这不是"配色丰富"，是**语义从未定过一个值**（与 `DESIGN-OVERHAUL-PRE-RESEARCH.md:122`「主题色的 5 个 fallback」一致，本轮复核仍成立）。
> ⇒ **下游唯一正确做法**：从 `:839` 的 `ACCENT_VALUES` 取真值 —— `deepseek: '#1d4ed8'` / `graphite: '#8b949e'` / `violet: '#9b8cff'`（`:839`），运行时由 `:5658` / `:5758` 写到 `--dam-accent`。

### A.1.2 语义色（成功 / 警告 / 危险 / 信息）—— **每个语义都有多值并存**

| 语义 | 值 | 次数 | 锚点 |
|---|---|---|---|
| 成功 | `#7fdcb0` | 4 | 判定徽章前景 `:3489,:3527`；`:3571`；进度 `:6355` |
| 成功 | `#3fa96a` | 3 | 向导 warn 组 `:2055`；`:2167`；调色板 `:4910` |
| 成功 | `#3aa675` | 3 | `:2415,:2426,:2476` |
| 成功 | `#2fa46a` | 1 | 判定底 `:3355` |
| 成功 | `#2f7d4f` | 1 | `:2055` |
| 警告 | `#e8c584` | 8 | `--dsw-alias-state-warn-primary` 兜底：`:3983,:3998,:4004,:4168,:4197,:4802`；判定底 `:3489,:3527` |
| 警告 | `#d4a94f` | 5 | 向导 warn 态 `:2056`；`:2169`；水位中档 `:4657`；调色板 `:4910`；日历未定时事件边 `:5341` |
| 警告 | `#e6a23c` | 4 | `:1789,:1790`（横幅）；`:5176`；`:5855` |
| 警告 | `#e0a53a` | 3 | `:2417,:2427,:2552` |
| 危险 | `#d64545` | 6 | 错误文案 `:1798`；日历「重要紧急」`:5174`；`:5493,:5494` |
| 危险 | `#c44a4a` | 3 | 判定底 `:3354`；`:6342`；`:7135` |
| 危险 | `#e5534b` | 1 | `--dsw-alias-state-error-primary` 兜底 `:6399` |
| 危险 | `#d66666` / `#e08a8a` / `#ff9c9c` / `#e8a1a1` | 2/2/1/1 | `:2416,:2428` / `:6342,:7135` / `:3550` / `:3573` |
| 中性 | `#666` | 8 | `--dsw-alias-label-secondary` 兜底（次级文字/底）`:1609,:1648,:1651,:1663,:1667,:1669,:1715,:1796` |

> ⇒ **禁止**把上表任一值当作"唯一语义色"。真源对语义色**未收敛**：warn 有 4 值、error 有 6 值、success 有 5 值。
> ⇒ **下游建议**（**推断**，依据 = 使用频次 + 令牌名）：warn = `#e8c584`（8 次，且是 `state-warn-primary` 的兜底）、error = `#d64545`（6 次，且是 `state-error-primary` 的兜底）、success = `#7fdcb0`（4 次）。**此建议未经用户拍板，构建者若要"统一语义色"须先向 Lead 报备。**

### A.1.3 文本灰阶 / 边框灰阶

| 值 | 次数 | 角色 | 锚点 |
|---|---|---|---|
| `#1f2328` | 4 | `--dsw-alias-label-primary` 兜底（正文主色） | `:1590,:1628,:1738,:1814` |
| `#7d8793` | 4 | 次级文字（loading） | `:1754,:1800,:4882,:4888` |
| `#c5cbd3` | 5 | `--dsw-alias-border-l1` 兜底（**分隔线/边框主色**） | `:1737,:1741,:1745,:1747,:3418` |
| `#68717d` | 2 | 次级文字 | `:1739,:1752` |
| `#b0b7c0` | 1 | 图例点（叶） | `:1755` |
| `#8b949e` | 3 | 石墨灰强调色 | `ACCENT_VALUES.graphite` `:839`；`:4879,:4880` |
| `#8a94a6` | 2 | 次级文字（日历未分类） | `:5177,:5178` |
| `#e8eaed` | 2 | 自动接续浮卡文字（**深色底上的浅字，唯一实例**） | `:6628,:6639` |
| `#f5f6f7` / `#ffffff` / `#fff` / `#000` | 1/1/11/1 | 纯白/纯黑 | `:1747` / `:1804` / 见 A.1.4 / `:1955` |

### A.1.4 图表调色板 / 装饰色

| 值 | 次数 | 角色 |
|---|---|---|
| `#5b8def` | 5 | **图表主色**：`PALETTE[0]` `:4910`；渐变 `:4949`；面积填充 `:4977`；折线 `:4978`；热力底 `:4993` |
| `#3fa96a`/`#c061c0`/`#4aa8b8`/`#8a8f98` | 各 1 | `PALETTE[1..5]` `:4910`（仅此一处定义） |
| `#d4c2ff` / `#b9ceff` / `#ffd9a1` | 3/2/2 | 判定徽章前景（紫/蓝/橙），`:3490,:3528` 等 |
| `#7ea4ff`/`#6f9bff`/`#4c8dff` | 1/2/1 | 进度条渐变第二色 `:1946,:3353,:2414` |

### A.1.5 ⚠️ 三处**假阳性**（不是颜色，勿抄）

`#310`×5（`:2208,:2213,:2677,:6840,:6866`）是 **React error #310**；`#124`×2（`:947,:957`）与 `#100`×1（`:6590`）是 **PR 编号**。`#d90`（`:3936`）是**真色值**（3 位 hex）。

### A.1.6 `rgba(255,255,255,…)` 的 alpha 阶梯（72 命中 / 35 种 alpha）

`0`(×5，渐变终点) `.03 .04 .05×2 .06×2 .07×2 .08 .09 .10×2 .1×2 .12×2 .13×3 .14×4 .16×5 .17 .18×2 .20 .22×6 .25 .35×4 .4 .42 .48 .5×2 .50 .52 .55 .56 .62 .65×4 .68 .72×2 .8 .86 .9×4 .92`
用途：**内部高光 / 描边 / 分隔**（不是背景底）。密集区 = `.13–.22`（面板高光与 tile 描边）。
`rgba(0,0,0,…)` 仅 11 次（外投影为主）。

## A.2 `ART-DIRECTION-DEEPSEEK-20260920.md` §1.1 / §1.2 可抄值

> 该文档取证方式自述为「直接抓取 deepseek.com 三份生产 CSS」（`:8`），**非推测**。以下是**官网**规范，**不是**本插件现值 —— 供 v3 若要"向官网靠"时取用。

**§1.1 品牌色（`:40-46`）**：`--ds-color-brand: #4d6bfe`（亮）/ `#6799fe`（暗）；`--ds-color-brand-deep: #3a65c2`；`--ds-color-brand-light-reverse: #73a3d2`；`--ds-color-brand-medium-reverse: #4176e6`。

**§1.1 背景层级（`:50-58`）**：`bg-page` 亮 `#f9f8f8` / 暗 `#0a0a0a`；`bg-overlay` 亮 `#fff` / 暗 `#262626`；`bg-dark` 亮 `#fff` / 暗 `#1a1615`；`surface-1` `hsla(0,0%,100%,.3)` / `.06`；`surface-2` `.2` / `.04`；`surface-3` `rgba(0,0,0,.03)` / `hsla(0,0%,100%,.02)`；`surface-5` `rgba(0,0,0,.05)` / `hsla(0,0%,100%,.12)`。
⇒ **关键结构（`:60`）：用「半透明白叠加」做层级，不用实色。**

**§1.1 文字（`:64-71`）**：`text-primary` 亮 `#1e232c` / 暗 `#fff`；`text-secondary` `rgba(0,0,0,.7)` / `hsla(0,0%,100%,.8)`；`text-description` `rgba(0,0,0,.65)` / `hsla(0,0%,100%,.56)`；`text-placeholder` `#8691a1` / `hsla(0,0%,100%,.3)`；`text-link-blue` `#234792`。

**§1.1 边框（`:75-81`，全部低透明度叠加）**：`subtle` `rgba(0,0,0,.06)` / `hsla(0,0%,100%,.08)`；`default` `rgba(0,0,0,.1)` / `.1`；`secondary` `rgba(9,45,78,.14)` / `.2`；`strong` `rgba(0,0,0,.2)` / `.24`；`divider` `rgba(0,0,0,.08)` / `.25`。

**§1.2 圆角阶梯（`:89-96`）**：sm `8px` / input `10px` / media `12px` / **panel `16px`** / **card `24px`** / pill `100px`。

**§1.2 玻璃（`:100-102`）**：`--ds-blur-glass: 12px`。

**§1.2 投影（`:106-108`）**：
- 亮：`0 0 0 1px #f1f5f9, 0 2px 4px rgba(0,0,0,.05), 0 12px 24px rgba(0,0,0,.05)`
- 暗：`hsla(0,0%,100%,.12) 0 1px 0 0 inset`（**暗色不用外阴影，用 1px 内发光**）

**§1.3 按钮 17 态（`:117-124`，可直接抄的交互语言）**：primary 亮 `#1a1615` / 暗 `#fff`；secondary `hsla(0,0%,100%,.4)` / `surface-1`，边框 `hsla(0,0%,100%,.6)` 或 `rgba(9,45,78,.18)`；ghost 全透明（hover 才出）；liquid 亮 `#fff` / 暗 `hsla(0,0%,100%,.4)`。**hover 规律（`:124`）：亮 `rgba(0,0,0,.04~.2)` / 暗 `hsla(0,0%,100%,.08~.6)` —— 靠透明度变化，不换色。**

**§1.4 字体（`:130-136`）**：正文 `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`；品牌/标题 `Montserrat`；辅助 `DM Sans`。

**§4.1 首页骨架（`:305-314`，官网口径）**：底色亮 `#f9f8f8` / 暗 `#0a0a0a`（**建议主推暗色**，黑鲸调性）；主色 `#4d6bfe`（暗色下 `#6799fe`）；层级半透明叠加；卡片圆角 **24px** + 亮色三层阴影 / 暗色 1px 内发光；**面板圆角 16px + `backdrop-filter: blur(12px)`**；按钮 hover 只变透明度；正文系统字体栈；动效 60fps。

> ⚠️ **口径澄清（必须知道）**：官网 `--ds-blur-glass: 12px` 与插件面板现值 `blur(28px) saturate(1.55)`（`lib/client.js:1587`）**不是同一个数**。前者是官网规范，后者是本插件实现。**"液态玻璃"当前的真身是 28px，不是 12px。**

## A.3 主题状态实话：明暗双套现在是什么状态

**结论（源码实测，逐条）**：

| 检索项 | 命中 | 说明 |
|---|---|---|
| `dark` | **0** | 全文件无 dark 相关逻辑/类名 |
| `prefers-color-scheme` | **0** | **没有任何明暗自适应媒体查询** |
| `浅色` | 1 | `:893` —— 一条**更新日志文案**（讲落地页，"浅色为基准"），与插件面板无关 |
| `深色` | 1 | `:1981` —— 一条**代码注释**（讲 chip 体系"深色底"） |
| `theme` | 12 | 全部是 `accentTheme`（强调色，不是明暗主题）：`:837,:841,:843,:5658,:5758,:6938,:6939,:7336` + 文案 3 处 |
| `light` | 2 | `:899` 更新日志、`:970` 更新日志 —— 均非主题实现 |
| `--dsw-` 引用 | 140 次 / **16 个** `--dsw-alias-*` 名 | 宿主令牌（颜色/边框/底），见 A.4 |

**⇒ 明暗双套的实况**：
1. **插件面板没有自己的明暗主题开关，也不需要**：颜色/边框/底色 **100% 走宿主令牌 `--dsw-alias-*`**（`var(--dsw-…)` 共 135 处），由 DSH 宿主决定亮/暗，插件自动跟随。
2. **"明暗双套"是设计文档（ART-DIRECTION §1.1）里的官网规范，不是 client.js 的功能实现。** 那份文档规范的是**落地页/首页**，不是插件面板。
3. 面板里**唯一的"人为深色"**是自动接续浮卡：`:6628` 写死 `background: 'rgba(18,22,30,.93)'` + `color: '#e8eaed'` —— **硬编码深色，不随宿主主题变**（**推断**：这是为了让它在浅色宿主的对话流上也像一块"浮起的玻璃"，但它是全文件唯一不跟随主题的面板级元素）。
4. 用户设置里的"明暗"选项**不存在**；存在的是**强调色**三选一（`:7336`：DeepSeek 蓝 / 石墨灰 / 雾紫）+ **字号**四档（`:7331`）。

**⇒ 给 v3 的硬结论**：v2 演示稿自己造了一套 `data-theme="dark"/"light"` 双主题（见 §F），这在**老前端里没有对应物**。若 v3 要做双主题，那是**新增设计决策**，必须由 Lead/用户拍板，不能宣称"还原老前端"。

## A.4 宿主令牌清单（面板唯一的颜色真源，`--dsw-alias-*` 16 个）

| 令牌 | 引用次数 | 用途 | 兜底值 |
|---|---|---|---|
| `--dsw-alias-border-l1` | 37 | 边框/分隔线 | `rgba(128,128,128,.25/.3/.35)` 或 `#c5cbd3` |
| `--dsw-alias-label-secondary` | 15 | 次级文字/悬停底 | `#666` / `#68717d` / `#7d8793` / `#8a94a6` |
| `--dsw-alias-bg-layer-2` | 15 | 浮层底/卡片底 | `rgba(255,255,255,.86/.9/.92)` / `rgba(24,24,28,.97)` / `rgba(30,34,46,.9)` |
| `--dsw-alias-bg-layer-1` | 14 | 卡片底/输入底 | `rgba(128,128,128,.06/.08)` |
| `--dsw-alias-state-warn-primary` | 12 | 警告 | `#e8c584` / `#e6a23c` / `#d4a94f` |
| `--dsw-alias-brand-primary` | 11 | 品牌强调 | `#4f7cff` |
| `--dsw-alias-state-error-primary` | 8 | 危险 | `#d64545` / `#e5534b` |
| `--dsw-alias-label-primary` | — | 正文主色 | `#1f2328` |
| `--dsw-alias-label-dimmed` / `-tertiary` | — | 弱化文字 | — |
| `--dsw-alias-state-success-primary` | 2 | 成功 | — |
| `--dsw-alias-bg-layer-3` | 1 | 三级面 | — |
| `--dsw-alias-bg-mask-1` | 2 | 遮罩/投影 | `rgba(0,0,0,.18/.35)` |
| `--dsw-alias-text-warning` | 1 | 文字警告 | `#d90` |
| `--dsw-alias-border-l2` | — | 二级边框 | — |
| `--dsw-alias-`（裸前缀） | 1 | 注释里 | — |

**⚠️ 幽灵令牌警告**：`DESIGN-OVERHAUL-PRE-RESEARCH.md:120` 记录曾有 3 个上游不存在的令牌（`--dsw-alias-text-primary`×4 / `--dsw-alias-warn`×4 / `--dsw-alias-danger`×1）永远走 fallback。**本轮复核：当前版本已无这 3 个名字**（A.4 表 16 个名中不含）⇒ **该 9 处已被清理**（历史问题已修，勿再引旧文档当作现状）。

**💡 大面积使用 `color-mix()`**：`color-mix(` 命中 **119 处** —— 这是本项目的核心配色手法：**不写死颜色，用 `color-mix(in srgb, <token> N%, transparent)` 从令牌派生不同强度**。示例：`background: color-mix(in srgb, var(--dam-accent, #4f7cff) 12%, transparent)`（`:1642`）。**下游务必沿用这个手法**（而不是直接写 alpha 值），否则无法跟随宿主主题。

---

# B. 液态玻璃材质真源

## B.0 材质总量实测（`lib/client.js`）

| 检索项 | 命中 | 备注 |
|---|---|---|
| `backdrop-filter` | **20** | 含注释 2 处（`:5`、`:1574`），实现 18 处 |
| `backdropFilter`（JS 驼峰） | **6** | `:2654,:5356,:5371,:6091,:6628,:7039` |
| `blur(` | **37** | 含 `filter: blur(N)` 装饰与动画关键帧 13 处、`@supports` 探测 1 处 |
| `saturate(` | **20** | 全部与 `blur()` 成对（除 tour 背景仅 blur） |
| `rgba(255,255,255` | **72** | 高光/描边/内发光，见 A.1.6 |
| `rgba(0,0,0` | 11 | 外投影为主 |
| `box-shadow` | **18**（另有 `boxShadow` 11） | |
| `linear-gradient` | **18** | |
| `radial-gradient` | **10** | |
| `inset 0 1px` | **8** | 顶部 1px 内高光（"亮面"特征） |
| `hsla(` | **0** | 全文件不用 hsla（官网规范用 hsla —— 说明插件**没有**照抄官网色值语法） |
| `@supports` | **1** | 仅 `backdrop-filter` 能力探测（`:1803`） |
| `prefers-reduced-transparency` | **0** | **未实现**（见 B.6） |
| `mask-image` / `-webkit-mask` / `mask:` | **0** | **滚动边缘渐隐完全未实现**（见 B.6） |

## B.1 「液态玻璃」的**真身**：面板主材质（逐字可抄）

> 这是**全项目最重要的一条材质声明**，也是"液态玻璃"最权威的实现。源码注释在 `:1574` 明确写「视觉:液态玻璃(毛玻璃)—— backdrop-filter + DSH 主题令牌(--dsw-alias-*)」。

**锚点：`lib/client.js:1582-1591`**（`[data-dam-panel]` 主块，逐行原文）

```css
[data-dam-panel] {
  position: fixed; left: 16px; width: 440px; height: 560px; --dam-scale: 1;   /* :1582 */
  max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);              /* :1583 */
  display: flex; flex-direction: column; overflow: hidden; z-index: 3000; pointer-events: auto;  /* :1584 */
  border-radius: 16px; font: 13px/1.55 system-ui, "Segoe UI", sans-serif;    /* :1585 */
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgba(255,255,255,.86)) 58%, transparent);  /* :1586 */
  -webkit-backdrop-filter: blur(28px) saturate(1.55); backdrop-filter: blur(28px) saturate(1.55);        /* :1587 */
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 65%, transparent); /* :1588 */
  box-shadow: 0 24px 64px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.22); /* :1589 */
  color: var(--dsw-alias-label-primary, #1f2328);                             /* :1590 */
  animation: dam-in var(--dam-dur-fast) cubic-bezier(.2,.9,.3,1.15) both; transform-origin: left bottom; }  /* :1591 */
}
```

**参数拆解（可直接抄的 token）**

| 维度 | 值 | 锚点 |
|---|---|---|
| **容器** | `440 × 560` 固定，`max = calc(100vw/vh - 32px)` | `:1582,:1583` |
| **圆角** | `16px` | `:1585` |
| **背景 alpha** | 令牌 **58%**（`color-mix` 到 `transparent`） | `:1586` |
| **模糊** | **`blur(28px)`** | `:1587` |
| **饱和** | **`saturate(1.55)`**（无单位倍数，非 %） | `:1587` |
| **边框** | `1px solid` @ 令牌 **65%** alpha | `:1588` |
| **阴影** | **3 层**：外 `0 24px 64px rgba(0,0,0,.22)` + 外 `0 4px 16px rgba(0,0,0,.10)` + 内 `inset 0 1px 0 rgba(255,255,255,.22)` | `:1589` |
| **字体** | `13px/1.55 system-ui, "Segoe UI", sans-serif` | `:1585` |
| **入场** | `dam-in` + `250ms` + **过冲曲线 `cubic-bezier(.2,.9,.3,1.15)`** + `both`，`transform-origin: left bottom` | `:1591` |
| **顶部高光** | `::before` 覆盖 `inset 0 0 auto 0` 高 `64%`，`linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,255,255,0) 70%)`，圆角 `16px 16px 0 0` | `:1598,:1599` |
| **高光弱化态** | `[data-solid="true"]` 时降到 `.05` | `:1600` |
| **能力降级** | `@supports not (backdrop-filter…)` ⇒ 纯令牌底 `var(--dsw-alias-bg-layer-2, #ffffff)` | `:1803,:1804` |
| **可读性兜底** | JS：读 `--dsw-alias-bg-layer-2` 自身 alpha，**< 0.65** 时把背景顶到 **`rgba(r,g,b,0.96)`** 并加 `data-solid="true"` | `:5724-5733` |

**入场/退场关键帧（`:1592,:1593`）**：
```css
@keyframes dam-in  { from { opacity: 0; transform: scale(.92) translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes dam-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(.95) translateY(6px); } }
```
退场：`[data-dam-panel][data-closing="true"] { animation: dam-out var(--dam-dur-quick) var(--dam-ease-out) both; }`（`:1594`）。

## B.2 全量材质配方逐条清单（每处 backdrop-filter / blur 完整声明 + 行号）

| # | 用途 | 完整声明 | 锚点 |
|---|---|---|---|
| 1 | **面板主材质** | `bg = 令牌58%` · `blur(28px) saturate(1.55)` · `border 1px 令牌65%` · `shadow 3层` · `radius 16px` | `:1582-1591` |
| 2 | 卡片内高光 | 无 blur；`inset 0 1px 0 rgba(255,255,255,.22)`（面板第 3 层阴影内含） | `:1589` |
| 3 | **保存条（sticky）** | `bg = 令牌74%`；**`blur(16px) saturate(1.4)`**；`border-top 1px 令牌38%`；`radius 0 0 14px 14px`；`transition: background .25s ease` | `:1741` |
| 4 | 能力降级 | `@supports not(...)` ⇒ `bg = var(--dsw-alias-bg-layer-2, #ffffff)` | `:1803,:1804` |
| 5 | **向导遮罩** | `radial-gradient(ellipse at 50% 42%, rgba(20,30,60,.30), rgba(6,10,22,.44))` + **`blur(5px)`** + `dam-tour-fade .28s ease both` | `:1807` |
| 6 | **向导主卡** | 宽 `min(620px, 100vw-48px)`；`radius 22px`；`bg = 令牌60%`；**`blur(30px) saturate(1.6)`**；`border 1px rgba(255,255,255,.5)`；**4 层阴影** `0 32px 90px rgba(8,14,38,.5), 0 6px 24px rgba(8,14,38,.28), inset 0 1px 0 rgba(255,255,255,.5), inset 0 -1px 0 rgba(255,255,255,.14)`；`font 13.5px/1.6` | `:1809-1814` |
| 7 | 向导顶部光 | `::before` 高 `55%`，`linear-gradient(168deg, rgba(255,255,255,.20), rgba(255,255,255,0) 58%)` | `:1817,:1818` |
| 8 | 向导游标光 | `radial-gradient(300px circle at var(--dam-mx) var(--dam-my), rgba(255,255,255,.16), transparent 62%)` + `mix-blend-mode: screen` | `:1819,:1820` |
| 9 | 向导关闭钮 | `border 1px rgba(255,255,255,.35)`；`bg rgba(255,255,255,.10)`；hover `.22`；`opacity .7→1` | `:1821-1823` |
| 10 | 向导光斑 | `filter: blur(16px)`（装饰，非 backdrop） | `:1829` |
| 11 | **三层玻璃板（Logo）** | `88×88`，**`radius 23px`**，`bg linear-gradient(135deg, rgba(255,255,255,.17), rgba(255,255,255,.06))`，`border 1.5px rgba(255,255,255,.52)`，`box-shadow inset 0 1px 0 rgba(255,255,255,.62), inset 0 0 26px rgba(255,255,255,.13)`，**`blur(6px) saturate(1.35)`**，`dam-slab-drop .62s cubic-bezier(.2,.9,.3,1.15) both` | `:1843-1848` |
| 12 | 板背面 | `::before` `translateZ(-7px)`，`bg linear-gradient(135deg, rgba(255,255,255,.09), rgba(255,255,255,.03))`，`border 1px rgba(255,255,255,.18)`，`shadow 0 0 0 1px rgba(255,255,255,.04)` | `:1849-1851` |
| 13 | 板扫光 | `::after` `conic-gradient(from var(--dam-orb-a,0deg), transparent 0deg, rgba(255,255,255,.42) 24deg, transparent 72deg, transparent 252deg, rgba(255,255,255,.22) 288deg, transparent 336deg)` + `filter: blur(2px)` + `mix-blend-mode: screen` + `dam-orb-shine 6.5s linear infinite` | `:1852-1854` |
| 14 | 三层 Z 轴 | top `translateZ(var(--dam-slab-z)*1)` delay `0s`；mid `translateZ(0)` delay `.16s`；bot `translateZ(*-1)` delay `.32s`；`--dam-slab-z: 22px` | `:1826,:1855-1858` |
| 15 | **核心方块** | `36×36`，`radius 12px`，`bg linear-gradient(135deg, rgba(255,255,255,.22), rgba(255,255,255,.08))`，`border 1px rgba(255,255,255,.50)`，`shadow inset 0 1px 0 rgba(255,255,255,.55), 0 8px 18px rgba(18,34,90,.28)`，**`blur(5px)`** | `:1865-1869` |
| 16 | **彩色玻璃 Squircle 底牌** | `92×92`，**`radius 27px`**，`bg linear-gradient(145deg, rgba(255,255,255,.35) 0%, rgba(var(--tile-rgb),.52) 42%, rgba(var(--tile-rgb-2),.34) 100%)`，`border 1.5px rgba(255,255,255,.65)`，`shadow inset 0 2px 0 rgba(255,255,255,.68), inset 0 -14px 26px rgba(17,32,88,.18), 0 20px 38px rgba(var(--tile-rgb),.25)`，**`blur(12px) saturate(1.5)`** | `:1874,:1875` |
| 17 | 底牌高光 | `::before` `filter: blur(4px)`；`:1876`；`::after` 1.5px | `:1876` |
| 18 | 与面板同源 | `[data-dam-art] .ap` 同 145deg 梯度，`border 1.4px rgba(255,255,255,.72)` | `:1894` |
| 19 | 自动接续浮卡（JS） | `bg 'rgba(18,22,30,.93)'`（**硬编码深色**）+ `color '#e8eaed'` + `radius 12px` + `border 1px rgba(128,128,128,.35)` + `shadow 0 10px 30px rgba(0,0,0,.35)` + **`blur(10px)`** | `:6628` |
| 20 | 接续弹层（JS） | `bg 令牌` + **`blur(16px)`** + `border 1px 令牌` + `radius 10px` + `shadow 0 12px 40px 令牌` | `:2654-2657` |
| 21 | **日历弹层（JS）** | `bg = 令牌78%` + **`blur(20px) saturate(1.4)`** + `radius 16px` + `padding 16px` | `:5356` |
| 22 | 日历弹层内容（JS） | `bg = 令牌70%` + **`blur(20px) saturate(1.4)`** | `:5370,:5371` |
| 23 | 诊断卡（JS） | `bg = 令牌55%` + **`blur(14px) saturate(1.3)`** + `border 1px 令牌60%` + `radius 10px` | `:7039` |
| 24 | 关闭/确认面板（JS） | **`blur(14px) saturate(1.3)`** + `border 1px 令牌45%` + `shadow 0 8px 28px rgba(0,0,0,.18)` | `:6091-6093` |

**⇒ 玻璃"档位"实测（按 blur px 排序）**：`5px`(×2) · `6px` · `10px` · `12px` · `14px`(×2) · `16px`(×3) · `20px`(×2) · `28px` · `30px` ⇒ **9 档并存**（与 `DESIGN-OVERHAUL-PRE-RESEARCH.md:134`「毛玻璃 8 套配方，5/6/10/12/14/16/20/28/30px 九档并存」**完全一致，本轮复核仍成立**）。
**`saturate` 实测**：`1.3`(×2) · `1.35` · `1.4`(×2) · `1.5` · `1.55` · `1.6` ⇒ **6 档**。

## B.3 已定的材质规范（从两份设计文档摘出）

**`DESIGN-OVERHAUL-PRE-RESEARCH.md` §2.2（`:73`）** —— 把面板材质定义为「**面板「液态玻璃」**」这一**独立设计语言**：
> `backdrop-filter: blur(28px) saturate(1.55)`、`border-radius: 16px`、渐变高光、圆角卡片层叠 | `client.js:951-971`
> （注：该文档行号取证于 4,541 行版本；**当前版本对应 `:1582-1600`**。）

**§2.6（`:134`）** 量化：「毛玻璃 **8 套配方**，5/6/10/12/14/16/20/28/30px 九档并存」。
**§4.1（`:179`）** 曾提议「**去掉液态玻璃层叠**：`backdrop-filter` 从"每张卡一层"降为"面板底板一层"，圆角收敛到 3 档，去渐变高光」。
**§4.1（`:180`）** 三层职责划分结论：「颜色/边框必须 100% 继承 `--dsw-*`；间距/圆角/字号/行高/阴影/层级/**玻璃强度**必须自建 `--dam-*`，且只留这一套真值；向导美术隔离到 `--dam-tour-*`」。

> ⚠️ **重要澄清（对 `DESIGN-OVERHAUL-PRE-RESEARCH.md:179`）**：该"去玻璃"建议是 **2026-09-10 的预研建议，用户从未采纳执行**。证据：当前 `client.js` 仍有 **18 处** backdrop-filter 实现、面板仍是 `blur(28px) saturate(1.55)`（`:1587`），且 2026-09-20 的 `ART-DIRECTION-DEEPSEEK-20260920.md:23,:227` 把"禁玻璃"明确列为**已作废的 v1 禁令**。
> ⇒ **"去玻璃"是死提案。当前方针恰恰相反：液态玻璃是产品的核心美学主张，必须保留并统一。**
> ⇒ **但"收敛档位"仍然有效**：9 档 blur 收敛到 3 档（面板 / 浮层 / 内嵌）是可用建议，与"保留液态玻璃"不冲突。

**`ART-DIRECTION-DEEPSEEK-20260920.md`** —— 玻璃是**官网常规项**（`:227`）：v1 禁玻璃 → v2「**`blur(12px)` 常规用**」；§4.1（`:311`）面板规格 = **圆角 16px + `backdrop-filter: blur(12px)`**；§1.5（`:158`）背景层 60fps 用 `backdrop-filter` + 合成器属性，GPU 合成零 JS。

## B.4 对标 `apple-design` §12「Materials & depth」（绝对路径原文核对）

原文位置：`C:\Users\JH Z\.agents\skills\apple-design\SKILL.md:179-197`。六条判据逐条对账：

| # | 规范原文（§12） | 现有实现符合度 | 证据 |
|---|---|---|---|
| 1 | 「Build nav/toolbars/sheets as translucent layers (`backdrop-filter: blur()` + semi-transparent bg) with content scrolling underneath — not opaque bars」 | ✅ **符合** | 面板/保存条/日历弹层全是"半透明 + blur + 内容在下面滚"（`:1586,:1587,:1741,:5356`） |
| 2 | 「**Material weight encodes hierarchy**：darker/heavier = structural regions (sidebars)；lighter = interactive elements。**Never stack a light translucent surface on another** — legibility collapses」 | ⚠️ **部分违反** | 面板（58% alpha + 28px blur）**内部**又叠了卡片（`:1758` 令牌 40%）、保存条（`:1741` 令牌 74% + 16px blur）、日历弹层（`:5356` 令牌 78% + 20px blur）、`panelStyle`×2（`:7039` 令牌 55% + 14px blur）⇒ **至少 4 层亮面叠亮面**，正是该条警告的场景。**面板还额外有 `::before` 64% 高光层（`:1598`）** |
| 3 | 「**Bigger surfaces should read as thicker**：stronger blur + deeper shadow than small chips」 | ✅ **符合，且成体系** | 面板 28px + 3 层阴影（`:1587,:1589`）＞ 向导卡 30px + 4 层阴影（`:1811,:1813`，更大更厚）＞ 保存条 16px（`:1741`）＞ 小玻璃板 6px（`:1847`）＞ 核心方块 5px（`:1869`） |
| 4 | 「**Dim to focus, separate to keep flow**：modal 配 scrim + 推后；非阻塞面板用 translucency + offset **不带 scrim**」 | ✅ **符合** | 浮层**无遮罩**（`:1582` 直接 fixed 定位，无 scrim）；向导是模态**有遮罩**（`:1806` `[data-dam-tour-backdrop]` + `radial-gradient` + `blur(5px)`） |
| 5 | 「**Vibrancy keeps text legible** over changing backgrounds：不要用扁平灰字 —— 用更高对比、稍重字重、轻微字距」 | ⚠️ **部分违反** | 面板正文用令牌（`:1590`）跟随主题 ✅；但全项目**降透明度当次级文字**是主流手法：`opacity: .75`(`:1714`)、`.68`(`:1725`)、`.58`(`:1734`)、`.55`(`:1757,:1799`)、`.5`(`:1794`)、`.8`(`:1793`)、`.7`、`.92` —— **大量 `<1` opacity 叠加在本身就是半透明的玻璃上**，正是该条警告的"文字可读性塌陷"。**尚无 `letter-spacing` 补偿**（源码未找到相关字距声明）。有 1 处专门兜底（`:5724-5733` 的 alpha<0.65 提升到 .96）—— 方向正确但只覆盖面板顶层 |
| 6 | 「**Scroll edge effects, not hard dividers**：不要用 1px 边框做 sticky 头，改用渐隐 mask」 | ❌ **完全未实现** | **`mask-image` / `-webkit-mask` / `mask:` 命中 0**；实际用的是 `border-bottom: 1px solid`（面板头 `:1603`、页头 `:1630`、页签条 `:1717`、页签/正文分隔），以及 `border-right: 1px solid`（`:1637` 侧栏）、`border-top: 1px solid`（`:1741` 保存条）。统计：`border-bottom: 1px solid` **7** 处、`border: 1px solid` **13** 处 |
| 7 | 「**Materialize, don't just fade**：glass 面进出要 blur radius 与 scale 一起动 | ⚠️ **部分符合** | 有 scale：`dam-in` `scale(.92) translateY(10px)`（`:1592`）、`dam-out` `scale(.95)`（`:1593`）。**但没有 blur radius 动画**（`filter` 只出现在 `dam-stat-num`/`dam-stat-reveal` 的 `blur(2px)` 文字入场 `:1689,:1690`，以及 `dam-update-intro` 的 `blur(6px)` `:2008`）——**面板进出不"材质化"** |

**⇒ B.4 结论**：现有实现在**"大面更厚"（#3）与"模态/非模态区分"（#4）**两条上做对了；在**"亮面不叠亮面"（#2）、"vibrancy 保可读"（#5）、"滚动渐隐而非硬分割线"（#6）、"材质化而非纯淡入"（#7）**四条上不足。

**§14 可达性（`SKILL.md:207-224`）对账**：`prefers-reduced-motion` 有 3 处闸门（`:1710,:1767,:1773`）✅；**`prefers-reduced-transparency` 命中 0** ❌（规范明确要求 translucent 面在该信号下"变实、去 blur"）；**`prefers-contrast` 命中 0** ❌。

## B.5 ★ 可直接抄的材质 token 表（三档收敛建议）

**收敛原则**（依 `DESIGN-OVERHAUL-PRE-RESEARCH.md:180` 的职责划分 + 本轮实测的"大面更厚"规律）：**面板 = 结构面（厚）/ 浮层 = 内容面（中）/ 内嵌 = 元素面（薄）**。现有 9 档 blur / 6 档 saturate 收敛到 **3 档**，且**每一档只允许在一处定义**。

```css
/* ===== 液态玻璃三档材质（v3 直接抄） ===== */
/* 档 1 —— 结构面（面板底板、会话页底）：现有真值，逐字保留 */
--dam-glass-structural-bg:    color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgba(255,255,255,.86)) 58%, transparent);
--dam-glass-structural-blur:  blur(28px) saturate(1.55);
--dam-glass-structural-border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.35)) 65%, transparent);
--dam-glass-structural-shadow: 0 24px 64px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.22);
--dam-glass-structural-radius: 16px;

/* 档 2 —— 浮层/覆盖层（日历弹层、接续弹层、sticky 保存条、诊断卡） */
--dam-glass-overlay-bg:    color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgba(255,255,255,.9)) 74%, transparent);
--dam-glass-overlay-blur:  blur(20px) saturate(1.4);
--dam-glass-overlay-border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.3)) 45%, transparent);
--dam-glass-overlay-shadow: 0 8px 28px rgba(0,0,0,.18);
--dam-glass-overlay-radius: 14px;

/* 档 3 —— 内嵌元素（卡片、输入、徽章、小方块）→ 建议不再单独 blur */
--dam-glass-inset-bg:    color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent);
--dam-glass-inset-border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(128,128,128,.22)) 60%, transparent);
--dam-glass-inset-radius: 9px;
/* 档 3 的 blur：默认 none（避免"亮面叠亮面"，对标 apple-design §12 #2） */
```

**映射表（现有 18 处实现 → 三档）**

| 档 | 现有实现（行号） | blur 归并 | 备注 |
|---|---|---|---|
| **结构面** | 面板 `:1587`(28px)、向导主卡 `:1811`(30px) | `28px` | 向导卡 30→28（差 2px，视觉不可辨）；向导卡保留其 4 层阴影（更大更厚，符合 §12 #3） |
| **浮层** | 保存条 `:1741`(16px)、日历弹层 `:5356,:5371`(20px)、接续弹层 `:2654`(16px)、诊断卡 `:7039`(14px)、确认面板 `:6091`(14px) | `20px` | 14/16→20 上台；或全部→`16px`（两种收敛都可接受，**选一，不要混**） |
| **内嵌元素** | 彩色底牌 `:1875`(12px)、三层玻璃板 `:1847`(6px)、核心方块 `:1869`(5px)、向导遮罩 `:1807`(5px)、自动接续浮卡 `:6628`(10px) | **`none`** | 这些小面本身就在玻璃上，再 blur 会叠层。**保留其 `inset 0 1px` 顶部高光与 `linear-gradient` 底**即可保住"玻璃感"，同时消除 §12 #2 的违规 |

**必须同时补的两条（现在缺）**

```css
/* 1. 减透明度（apple-design §14 硬要求，现在 0 命中） */
@media (prefers-reduced-transparency: reduce) {
  [data-dam-panel], [data-dam-savebar], [data-dam-calendar-modal] {
    background: var(--dsw-alias-bg-layer-2, #fff);
    backdrop-filter: none; -webkit-backdrop-filter: none; }
}
/* 2. 滚动边缘渐隐（apple-design §12 「Scroll edge effects, not hard dividers」，现在 0 命中） */
@supports (mask-image: linear-gradient(#000, transparent)) {
  [data-dam-body] { mask-image: linear-gradient(#000 calc(100% - 16px), transparent); }
}
```

## B.6 材质小节结论（给 v3 构建者的一句话）

**"液态玻璃"= 面板 `blur(28px) saturate(1.55)` + 令牌 58% 半透明底 + 16px 圆角 + 3 层阴影（含 1px 内高光）+ 顶部 64% 高度白渐变高光 + 左下原点的过冲入场。** 少任何一项都会明显"不像"。**不要**照抄官网的 `blur(12px)`（那是官网数字，不是本插件）。

---

# C. 双形态结构真源（**用户批评 #1 的正面回答**）

## C.1 三态枚举与计数（源码实测）

| 检索项 | 命中 | 说明 |
|---|---|---|
| `data-dam-panel` | **21** | 行号：`1578,1580,1582,1594,1595,1596,1597,1598,1600,1601,1602,1604,1605,1606,1617,1774,1804,5762,5797,7331,7426` |
| `data-dam-page` | **62** | 出现 62 次，落在 **53 行**上：**CSS 字符串字面量行 46 行（共 55 次）** + **JS/DOM 行 7 行（共 7 次）**；多命中的 7 行 = `:1644`(×3) `:1702`(×2) `:1705`(×2) `:1711`(×2) `:1712`(×2) `:1713`(×2) `:1776`(×3) |
| `panelPos` | **11**（9 行） | `:54`(×1) `:59`(×1) `:184`(×2) `:186`(×1) `:187`(×1) `:5648`(×1) `:5701`(×1) `:7334`(×1) `:7674`(×2) |
| `setPanelPos` | **4** | `:141`(注释) `:185`(定义) `:5651`(浮层开关) `:7334`(设置页 select) |
| `bottom-left` | **8** | `:46,:53,:671,:1292,:5650,:5751,:7335` + 1 |
| `'both'` | **9** | 见 C.2 |
| `registerSurfaces` | **4** | `:5795`(注释) `:7652`(定义) `:7720,:7726`(调用) |
| `refreshSurfaces` | 6 | `:140,:7469,:7673,:7717`(定义),`:7718-7720` |
| 浮层尺寸 `440` | **10** | `:61`（`DEFAULT_W`）+ `:1582`（CSS）+ `:1620`/`:2065`/`:2360`/`:2400`/`:2401`/`:2699`/`:7683`（注释）+ `:6628`（接续浮卡 maxWidth） |
| 浮层尺寸 `560` | **3** | `:62`（`DEFAULT_H`）+ `:1582`（CSS）+ `:2652`（接续弹层 `min(560px, 42vw)`） |

## C.2 三态定义与逐处行为（`panelPos` 全部 9 个出现点）

**真源定义锚点 `lib/client.js:46-60`（逐行原文）**
```js
46| // 承载面(2026-09-21 用户拍板 · 二次修正):'bottom-left'(默认,左下角浮层) | 'page'(会话页) | 'both'(两者共存)。
47| // ★修正原因(用户实测反馈原话):「它现在是浮在整个页面上方的,而不是和对话轨迹、上下文、白板看板在一起,作为一个单独的一页」。
48| //   根因:首版把「顶部」做成 shell.overlay 覆盖条 —— 宿主只给插件 4 个槽位(sidebar/main/rightbar/shell.overlay),
49| //   浮层永远只能"盖"在界面上,做不出"并列的一页";要成为并列页必须走 conversation.view
50| //   (官方「对话轨迹」dsh-client-ui-trajectory 与本插件「白板看板」都用它注册)。
51| // 两种承载面共享同一份内容/页签/数据(见下面的 panelTab 共享状态);本机偏好,仅 localStorage。
52| var POS_KEY = 'dsh-auto-memory.panel.pos'
53| var PANEL_POS_VALUES = { 'bottom-left': 1, page: 1, both: 1 }
54| var panelPos = 'both'                                                    // ← 代码默认值
55| try {
56|   var savedPos = localStorage.getItem(POS_KEY)
57|   // 兼容上一版:旧值 'top'(覆盖条形态)已废弃 ⇒ 自动迁移为 'page'(会话页形态),用户不必手动重选
58|   if (savedPos === 'top') savedPos = 'page'
59|   if (PANEL_POS_VALUES[savedPos]) panelPos = savedPos
60| } catch (ePos) {}
```

> ⚠️ **一处必须指出的口径矛盾**：注释 `:46` 写「`'bottom-left'`（**默认**）」，但代码 `:54` 的初始化值是 **`'both'`**（且 `:186` 的非法值回退也是 `'both'`）。
> ⇒ **行为真源 = `'both'`，注释文字过时**。i18n 文案 `:407` 也未声称默认值。**下游以 `:54` 为准。**

| 出现点 | 代码 | 行为 |
|---|---|---|
| **`:184`** | `panelPos: function () { return panelPos },` | 读取器（`controller.panelPos()`）；被 `:5648,:5701,:7334,:7674` 消费 |
| **`:185-195`** | `setPanelPos(v)` 定义 | ① 校验并入枚举，非法值 → `'both'`（`:186`）② 写 `localStorage`（`:187`）③ **调 `surfacesRefreshHook()` 即时增删「记忆」会话页签**（`:189`）④ **若面板关着就 `controller.open()`**（`:193`）—— 因位置改在设置页，面板关着整块渲染 `null`，用户看不到变化（`:190-192` 原文）⑤ 否则 `emit()`（`:194`） |
| **`:5648`** | `var floatOn = controller.panelPos() === 'both'` | **会话页页头「浮层开关」的当前态**：仅 `both` 档视为"浮层已开" |
| **`:5651`** | `var onFloatToggle = function () { controller.setPanelPos(floatOn ? 'page' : 'both') }` | **★ 修自毁按钮后的安全实现**：`both ⇄ page` 互切，**两个方向都不注销本页签**（对比原文 `:5666-5668`：「原实现在 page 档点一下即把本页签注销 ⇒ 用户实测『上面的东西连按钮一起消失』」） |
| **`:5701`** | `var pos = controller.panelPos()`（`MemoryPanel` 内） | 浮层组件据此决定渲染哪个节点 |
| **`:7334`** | 设置页 `field(t('fPanelPos'), h('select', {value: controller.panelPos(), onChange: e => controller.setPanelPos(e.target.value)}), …)` | 三选项 UI（`:7335`：`bottom-left` / `page` / `both`） |
| **`:7674`** | `if (controller.panelPos() === 'page' \|\| controller.panelPos() === 'both') {` | **★ 关键注册条件**：仅 `page`/`both` 档注册 `conversation.view` 的「记忆」会话页（`:7675-7680`）；`bottom-left` 档**不注册** |

**三态行为总结表**

| 档位 | 浮层 `[data-dam-panel]` | 会话页（`conversation.view`） | 渲染判定锚点 |
|---|---|---|---|
| **`bottom-left`** | ✅ 渲染（可拖拽/缩放/钉住，440×560） | ❌ **不注册**（页签不存在） | 浮层：`:5751` `if (pos === 'bottom-left' \|\| pos === 'both')`；页签：`:7674` 条件不满足 |
| **`page`** | ❌ 不渲染 | ✅ 注册「记忆」页（`id: 'auto-memory-pre-panel'`, `order: 78`） | `:5751` 不满足；`:7674` 满足 |
| **`both`**（代码默认） | ✅ 渲染 | ✅ 注册 | 两者都满足；`nodes.length === 1` 时直接返回，2 个节点时包 `[data-dam-panel-host]`（`:5797`） |

**共享状态机制（"两边同步"的实现，`:135-139`）**：`panelTab` 是**模块级变量**（`:138` `var panelTab = 'overview'`），`setPanelTab` 只 `emit()`（`:139`）。两个承载面都订阅 `emit()` ⇒ 切页签两侧同步。代码注释 `:136-137` 明确：「浮层与「记忆」会话页读同一个模块级变量 ⇒ 两处切页互相同步……不用两份 `useState`，从根上杜绝状态漂移」。

**注册/注销机制（`:7717-7726`）**：`refreshSurfaces()` 先释放全部 `surfaceDisposers`（`:7718-7719`）再 `registerSurfaces()`（`:7720`）；`setSurfacesRefreshHook(refreshSurfaces)`（`:7723`）把它挂到模块作用域，供 `setPanelPos` 调用（`:189`）。故**切档即时生效，不必重启或重进会话**（`:142` 注释）。

**槽位注册全清单（`:7654-7712`）**
| 行号 | 槽位 | id | order | 承载组件 |
|---|---|---|---|---|
| `:7655` | `sidebar.footer.action` | `auto-memory-pre` | 5 | `SidebarButton`（侧栏「记忆」入口） |
| `:7658` | `shell.overlay` | `auto-memory-pre` | 5 | **`MemoryPanel`（浮层）** |
| `:7661` | `shell.overlay` | `auto-memory-pre-dialogs` | 6 | `DialogHost`（弹窗宿主） |
| `:7664` | `shell.overlay` | `auto-memory-pre-autocont` | 7 | `AutoContinueHost`（自动接续浮卡） |
| `:7667` | `settings.section` | `auto-memory-pre` | 25 | `SettingsPage` |
| `:7676-7679` | **`conversation.view`** | `auto-memory-pre-panel` | **78** | **`MemoryPageView`（记忆会话页）← 受 `panelPos` 门控** |
| `:7687-7690` | `conversation.view` | `auto-memory-pre-kanban` | 80 | `KanbanView`（白板看板，**无条件注册**） |
| `:7706-7711` | `conversation.view` | `auto-memory-pre-graph` | 81 | `WhiteboardGraphView`（**默认关闭**，`WBG_ENABLED` 由 `localStorage['dam-wbg-enabled']==='1'` 控制，`:7702-7704`） |

## C.3 `PANEL-PAGE-MIGRATION-DIRECTION.md` 全文要点（62 行，2026-09-21 用户亲自拍板）

> 该文档状态自述「**方向已定，未实施**」（`:3`）。**但它的一部分已经被实现**（见 §C.3.1 对账）—— 引用时务必注意"文档写的是方向，代码里已完成若干项"。

**§1 问题定性（`:8-15`）**
| # | 现象 | 根因（带代码证据） |
|---|---|---|
| **A** | 点页头「切换浮层」后**上面的东西消失、连按钮一起消失** | 按钮执行 `controller.setPanelPos('bottom-left')`；而会话页签仅在 `panelPos === 'page' \|\| 'both'` 时注册（registerSurfaces 内）⇒ 点一下即把当前页签注销 ⇒ **自毁按钮**（`:12`） |
| **B** | 整体「看着奇怪、有拉伸」 | 把为 **440px 浮层**设计的界面（12 个横向滚动页签 + 单列纵向堆叠 + 小字距）**原样**铺到 **1400px+** 整页，**没有任何大屏版式**。「这不是比例问题，是版式缺失」（`:13`） |

用户原话（`:15`）：「你把一套通过小窗口表达的资源扔到了大窗口上，但未做任何优化」「我觉你在上方整页的情况之下，要大改这个 UI」。

**§2 已拍板方向（`:17-20`）**
- **骨架**：**左侧固定侧栏导航 + 右侧多列栅格内容区**（不再用顶部横向滚动页签）。
- **范围**：**全部 12 个 tab 都做大屏版式**（概览 / 日志 / 精修 / 记忆中枢 / 存储 / 笔记 / 白板 / 反思 / 连接 / 日历 / 搜索 / 工作区）。

**§3 目标结构 ASCII 图（`:24-37`，逐字）**
```
┌──────────────┬─────────────────────────────────────────────┐
│ 记忆 (verBadge)│  页头：当前分区标题 + 说明 + [刷新]           │
│──────────────│─────────────────────────────────────────────│
│ ▸ 概览        │                                             │
│ ▸ 日志        │   内容区：多列栅格（卡片/统计并排）           │
│ ▸ 精修        │   正文限制最大阅读宽度，避免长行              │
│ ▸ 记忆中枢    │                                             │
│ ▸ 存储        │                                             │
│ …（12 项）    │                                             │
│               │                                             │
│ [收起为浮层]  │  ← 非自毁：只挪动承载面，不注销当前页         │
└──────────────┴─────────────────────────────────────────────┘
```

**§3.1 五条硬性要求（`:39-47`，逐条）**
1. **删掉自毁按钮**：页头不得再有会注销本页的操作。若保留「切到浮层」入口，必须改为*先保证页签不消失*（例如「打开浮层并保持页签」，或直接移除、改由设置页切换）。
2. **浮层与小页各用一套版式**：窄容器（浮层）继续用现有紧凑布局；宽容器（会话页）走新的大屏布局。两者共享**数据与状态**，**不再共享同一份版式**。
3. **响应式断点**：侧栏在窄窗（< ~900px）应折叠为图标条或顶部横条，避免页签被压扁。
4. **去掉浮层专属控件**：拖拽手柄 / 关闭 / 钉住对大页无意义，不应出现在页头。
5. **动效**：等用户提供的 design skill 到位后统一做（切换分区、卡片入场、栅格重排）。

**§4 前置项（`:49-52`）**：页头自毁按钮属**独立 bug**，可分可合，建议随本项一起改；大屏适配**不得**顺带改动记忆引擎逻辑（用户硬规则：单一开关/改动不得顺带改变其他功能行为）。

**§5 待办清单（`:54-62`，7 项，原文勾选状态全部为未勾）**
1. 收到 design skill 后，按 skill 规范产出大屏视觉稿与动效规格
2. 左侧侧栏组件 + 分区路由（复用现有 `panelTab` 共享状态）
3. 12 个 tab 逐个改为宽容器版式（多列栅格）
4. 移除自毁按钮，改为安全入口
5. 窄窗断点适配
6. 守卫测试：新增/改写 `tests/smoke/smoke-test-panel-position-pre.mjs` 断言（禁自毁按钮 + 大页独立版式）
7. 全量回归 + 截图验收（用官方 CUA 截图对比）

### C.3.1 ★ 文档方向 vs 代码现状 对账（**本轮新增，重要**）

| §3.1 要求 | 代码现状 | 证据 |
|---|---|---|
| 1. 删掉自毁按钮 | ✅ **已实现**（改为 `page ⇄ both` 互切，两向都不注销） | `:5647`(注释) `:5651` `:5666-5668` |
| 2. 浮层/整页各用一套版式 | ✅ **已实现** | 浮层走 `TabScroller`（横向页签，`:5788`）；会话页走左侧侧栏（`:5677-5683`） |
| 3. 窄窗 <900px 折叠为横条 | ✅ **已实现** | `@media (max-width: 900px)` `:1655`：`[data-dam-page-main] { flex-direction: column }`（`:1656`）+ `[data-dam-page-nav] { width: auto; flex-direction: row; overflow-x: auto }`（`:1657`） |
| 4. 去掉浮层专属控件 | ✅ **已实现**（大页页头只有「刷新」+「浮层开关」，无拖拽/关闭/钉住） | `:5661-5673`（对比浮层 `:5770-5790` 有 `✕`/`⟳`/`⤾`/Pin/`[data-dam-resize]`） |
| 5. 动效统一 | ✅ **已实现**（MOTION-SPEC 已落地，见 §D） | `:1580-1581` token 联合作用域；`:1696-1700` stagger |
| §5-6 守卫测试 | **未核实**（本轮只读 `lib/`、`docs/`，未读 `tests/`） | — |

> ⇒ **结论：`PANEL-PAGE-MIGRATION-DIRECTION.md` 的 §3.1 五条已在代码中落地**，文档本身未同步更新（仍是「未实施」）。**v3 构建者不要以为这是"待做项"——它已经做完了，v2 演示稿没体现是"没抄"，不是"没得抄"。**

## C.4 浮层与整页的几何参数（逐项实测）

### C.4.1 浮层（`bottom-left` / `both` 档）

| 项 | 值 | 锚点 |
|---|---|---|
| 常量 | `DEFAULT_W = 440` / `DEFAULT_H = 560` / `DEFAULT_GAP = 16` | `:61,:62,:63` |
| CSS 硬写 | `position: fixed; left: 16px; width: 440px; height: 560px` | `:1582` |
| 上限 | `max-width: calc(100vw - 32px)` / `max-height: calc(100vh - 32px)` | `:1583` |
| **缩放下限（实测）** | `width ≥ 300` / `height ≥ 240` | `:105` `Math.max(300, …)` / `:106` `Math.max(240, …)` |
| 默认位置 | `left = DEFAULT_GAP`；`top = max(16, vh-560-16)`，若侧栏「记忆」按钮存在则 `min(top, r.top-560-12)`（**锚定在按钮正上方**） | `:72-87` |
| 让位逻辑 | 与入口按钮重叠时自动上移到 `r.top - height - 12` | `:89-100` |
| 持久化 | `localStorage['dsh-auto-memory.panel.geom']` | `:45,:116,:121` |
| 圆角 / 模糊 | `16px` / `blur(28px) saturate(1.55)` | `:1585,:1587` |
| 拖拽 | `startPointerDrag`（`:5527` 定义），拖拽句柄排除 `[data-dam-btn],[data-dam-tab],[data-dam-input],[data-dam-select],textarea` | `:5742-5747` |
| 缩放句柄 | `[data-dam-resize]` `22×22`，`cursor: nwse-resize` | `:1607-1610` |

### C.4.2 整页 / 会话页（`page` / `both` 档）

| 项 | 值 | 锚点 |
|---|---|---|
| 容器 | `display:flex; flex-direction: column; width:100%; height:100%` | `:1618` |
| 字号台阶 | `--dam-scale` = 用户档 × 视口台阶：`≥1400px` ×**1.06**；`≥1800px` ×**1.12** | `:1619,:1671,:1672` |
| 阅读宽度上限 | `--dam-measure: 1440px` | `:1620` |
| 水平内边距 | `--dam-pad-x: clamp(16px, 1.6vw + 6px, 44px)` | `:1621` |
| 垂直内边距 | `--dam-pad-y: clamp(14px, .8vw + 6px, 26px)` | `:1622` |
| 栅格间距 | `--dam-gap: clamp(10px, .5vw + 6px, 18px)` | `:1623` |
| **正文居中约束** | `padding-inline: max(var(--dam-pad-x), calc((100% - var(--dam-measure)) / 2))` | `:1661` |
| 主区布局 | `[data-dam-page-main] { display: flex; flex: 1 }` | `:1635` |
| **左侧侧栏** | `[data-dam-page-nav] { flex: 0 0 auto; width: 170px; overflow: auto; padding: 10px 8px; flex-direction: column; gap: 2px; border-right: 1px solid … }` | `:1636,:1637` |
| 侧栏按钮 | `padding: 7px 10px; border-radius: 8px; font-size: calc(12.5px × var(--dam-scale)); opacity: .68` | `:1638,:1639` |
| 选中态 | `opacity:1; font-weight:650; color: 强调色; background: color-mix(强调色 12%, transparent)` | `:1641,:1642` |
| 内容列 | `[data-dam-page-content] { flex: 1; min-width: 0; display: flex; flex-direction: column }` | `:1643` |
| **多列栅格** | `[data-dam-page] [data-dam-flow] { display: grid; gap: var(--dam-gap); align-items: start; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)) }` | `:1678,:1679` |
| 栅格子项缺省 | `grid-column: 1 / -1`（非卡片整行） | `:1680` |
| 卡片进列 | `grid-column: auto`（仅 `[data-dam-card]` 进列） | `:1687` |
| 窄窗断点 | **`900px`** → `flex-direction: column`，侧栏变横条 | `:1655-1658` |
| 滚动条 | `scrollbar-width: thin`；`::-webkit-scrollbar { width/height: 10px }`；thumb `border: 3px solid transparent; background-clip: content-box; border-radius: 8px` | `:1662,:1664,:1666,:1667` |

## C.5 ★ 两套版式差异表（**v3 直接照抄**）

| 维度 | 浮层（`bottom-left` / `both`） | 整页（`page` / `both` 的会话页） | 锚点 |
|---|---|---|---|
| **容器尺寸** | **440×560 固定**（可拖拽 300×240 起、可缩放，位置存 localStorage） | **100%×100%**（宿主给宽，`--dam-measure: 1440px` 限阅读宽） | `:61,:62,:1582,:1618,:1620` |
| **导航形态** | **顶部横向滚动页签**（`TabScroller`，含 `‹ ›` 箭头，`:4710` 用 `scrollBy` 驱动） | **左侧固定侧栏**（`170px` 竖列，`<900px` 降级为顶部横条） | `:5788` vs `:5677,:1636,:1657` |
| **内容列数** | **1 列**（纵向堆叠） | **多列栅格**：`repeat(auto-fit, minmax(min(100%, 380px), 1fr))`（1400px 宽约 3 列；1200px 约 2–3 列） | `:1678,:1679` |
| **字号** | `--dam-scale: 1`（仅用户档位 `0.9/1/1.15/1.3`） | `--dam-scale` = **用户档 × 视口台阶**（`≥1400`×1.06 / `≥1800`×1.12） | `:1582,:1596-1597` vs `:1619,:1671,:1672` |
| **内边距** | `[data-dam-body] { padding: 16px }`（固定） | `clamp()` 三档：`--dam-pad-x/y` + 正文居中 `padding-inline` | `:1731` vs `:1621,:1622,:1660,:1661` |
| **字距** | **无字距声明**（源码未找到 `letter-spacing`） | **同样无**（源码未找到） | — |
| **该有的控件** | 关闭 `✕` / 刷新 `⟳` / 复位 `⤾` / **钉住 Pin** / **拖拽** / **缩放句柄** | 刷新 `⟳` / **浮层开关**（`page ⇄ both`） | `:5770-5790` vs `:5661-5673` |
| **不该有的控件** | —（浮层专属控件就是这些） | **拖拽 / 关闭 / 钉住 / 缩放句柄一律不得出现**（PANEL-PAGE §3.1 第 4 条；代码已遵守） | `:5661-5673`（无这些） |
| **数据与状态** | ✅ **两者共享** `panelTab`（模块级变量）+ 同一 `nonce` 刷新机制 | ✅ 同左 | `:135-139,:5689-5691` |
| **页头** | `[data-dam-panel] header`（`cursor: grab`，`:1602`） | `[data-dam-page-head]`（无 grab，`:1629`） | `:1602` vs `:1629` |
| **下拉/设置栅格** | `[data-dam-settings] { grid-template-columns: 92px minmax(0,1fr); gap: 18px }`（窄：导航 92px） | 同一条规则（页面内用法相同） | `:1732` |

**12 个页签清单（`MEMORY_TABS()`，`:5621-5623`，逐字）**
```
overview(概览) · logs(日志) · refine(唤起回顾) · hub(记忆中枢) · storage(存储管理) ·
notes(笔记) · plan(白板) · reflections(反思) · connect(接续) · calendar(日历) ·
search(检索) · workspaces(工作区) · stats(统计)
```
> ⚠️ 实测是 **13 项**（多出 `stats`，`:5618` `if (tab === 'stats') return h(StatsTab)`；`:5622` 数组含 13 个元素），而 PANEL-PAGE 文档与 i18n 里都写「12 个 tab」（`:19,:20`；`:5625` 注释亦写 12）。**v3 按 13 项做**（依据 `:5622` 数组长度）。

**关键区分：`data-dam-flow` 是"哪些页签支持分列"的开关（`:1676` 注释逐字）**
> 「★卡片流分列(大屏核心收益):只对打了 `[data-dam-flow]` 标记的页签生效;非卡片子元素一律整行占据 ⇒ 不打标记的页签 = 逐字节旧行为, 打了标记也只有卡片进列。」
`[data-dam-flow]` 共 **31** 处命中；打标页签（返回 `h('div', {'data-dam-flow': ''}, rows)`）：`:3258,3545,3635,3637,4018,4064,4121,4150,4254-4256,4699,4756,4785,5163,5515` 等。

---

# D. 动效 token 真源

## D.1 项目自带 token（**当前版本行号已复核**）

**真源锚点 `lib/client.js:1580-1581`（MOTION-SPEC §0.1 记的 `:1341-1344` 是旧版行号）**
```css
/* :1580 */ [data-dam-panel], [data-dam-page] { --dam-dur-quick: 150ms; --dam-dur-fast: 250ms; --dam-dur-slow: 400ms; --dam-dur-stagger: 40ms;
/* :1581 */   --dam-ease-out: cubic-bezier(.22, 1, .36, 1); --dam-ease-inout: cubic-bezier(.65, 0, .35, 1); --dam-ease-pop: cubic-bezier(.34, 1.36, .64, 1); }
```

| 项目变量 | 值 | 对应 token（MOTION-SPEC §0.1 表） | token 表用途 |
|---|---|---|---|
| `--dam-dur-quick` | **150ms** | `--duration-quick` | 弹窗/下拉**关闭**、文字切换、tooltip 出现 |
| `--dam-dur-fast` | **250ms** | `--duration-fast` | 图标切换、下拉/弹窗**打开**、标签滑动、**页面前进** |
| `--dam-dur-slow` | **400ms** | `--duration-slow` | 面板打开、骨架揭示 |
| `--dam-dur-stagger` | **40ms** | `--duration-stagger` | 逐项错开偏移 |
| `--dam-ease-out` | `cubic-bezier(.22, 1, .36, 1)` | `--ease-smooth-out` | **默认曲线** |
| `--dam-ease-inout` | `cubic-bezier(.65, 0, .35, 1)` | `--ease-in-out` | 图标切换、文字切换 |
| `--dam-ease-pop` | `cubic-bezier(.34, 1.36, .64, 1)` | `--ease-bounce` | 徽标弹出（**只用于进入**） |

**余量声明（实测）**：`var(--dam-dur-*)` 引用 **40 处**；`var(--dam-ease-*)` 引用 **33 处**（其中 `--dam-ease-out` 33、`--dam-ease-inout` 4、`--dam-ease-pop` 2 —— 含重复计数）。

**⚠️ `--dam-ease-linear` 是一个"只被用一次的孤立 token"**：
- **定义处：源码未找到**（全文件只有 1 次出现，且是**使用**不是定义）。
- 唯一使用点 `:5054`：`animation: 'dam-stat-pulse var(--dam-dur-slow) var(--dam-ease-linear) infinite'`
- ⇒ 该变量**从未定义**，浏览器回退到 `animation` 缺省缓动（即 `ease`）。**这是源码里的一处真实缺陷**（**推断**：作者本意应为 `linear`，写作 token 名但从未在 token 块里登记）。
- ⇒ **下游照抄时不要复制这个写法**：加载类恒动直接用 `linear`（如 `:1801` 的 `dam-spin .8s linear infinite` 就是正确写法）。

## D.2 作用域事实（MOTION-SPEC §0.2，**已落地**）

**MOTION-SPEC §0.2 原文（`:45-49`）**：「这三个变量**只定义在 `[data-dam-page]` 里**，而浮层 `[data-dam-panel]` 不是 `[data-dam-page]` 的后代。⇒ 浮层那组规则**取不到这些变量**，所以它一直写的是字面量（`.2s` / `.16s` / `cubic-bezier(.2,.9,.3,1.15)`）。补丁为此新增**一条联合作用域声明**（`[data-dam-panel], [data-dam-page]`），让浮层也能用 token；`[data-dam-page]` 里原有的那份定义**照原样保留**（不删、不搬，避免任何层叠行为变化）。」

**✅ 当前代码核对（已落地）**
| 位置 | 内容 | 锚点 |
|---|---|---|
| **联合声明（补丁 [1]）** | `[data-dam-panel], [data-dam-page] { --dam-dur-quick: 150ms; … --dam-ease-pop: …; }` | **`:1580-1581`**（注释在 `:1577-1579`，逐字说明理由） |
| 页面侧原定义（保留） | `[data-dam-page] { … --dam-dur-quick/fast/slow … --dam-ease-out/inout/pop … }` | `:1624-1627` |
| 浮层打开（补丁 [3]） | `animation: dam-in var(--dam-dur-fast) cubic-bezier(.2,.9,.3,1.15) both`（**曲线保留**，时长从 200ms 刻度化） | `:1591` |
| 浮层关闭（补丁 [2]） | `animation: dam-out var(--dam-dur-quick) var(--dam-ease-out) both`（**`ease-in` 已消除**） | `:1594` |

⇒ **浮层现在也能用 token**；`data-dam-panel` 的 token 声明与 `data-dam-page` 各一份（`:1580` 与 `:1624-1627`）。

## D.3 §1「现状 → 建议」全部条目（MOTION-SPEC §1，**逐条核对当前代码**）

> MOTION-SPEC §1 共 **24 行表格**（§6 自述：§1.1=2、§1.2=7、§1.3=4、§1.4=5、§1.5=4、§1.6=2），其中「建议改动」19 条、「不动」交叉引用 5 条。以下**逐条给出当前代码状态**（旧行号 → 新行号）。

### §1.1 浮层（2 条）
| 动效点 | 旧锚点 | **新锚点** | 现状 | 判定 |
|---|---|---|---|---|
| 打开 | `:1308` | **`:1591`** | `dam-in var(--dam-dur-fast) cubic-bezier(.2,.9,.3,1.15) both` | ✅ 已改（曲线保留；注释 `:1577-1579` 说明刻度来源） |
| 关闭 | `:1311` | **`:1594`** | `dam-out var(--dam-dur-quick) var(--dam-ease-out) both` | ✅ 已改（`ease-in` → `smooth-out`） |

### §1.2 会话页主体与卡片流（7 条）
| 动效点 | 旧锚点 | **新锚点** | 现状 |
|---|---|---|---|
| 主体直接子元素入场 | `:1391` | **`:1674`** | `[data-dam-body] > :not([data-dam-flow]) { animation: dam-page-in var(--dam-dur-fast) var(--dam-ease-out) both; }` ✅（已排除容器 + 补 `both`） |
| **卡片流容器排除** | `:1391` | **`:1674,:1678`** | ✅ 容器改用 `:not([data-dam-flow])`，且容器自身退化为纯 grid（`:1678`） |
| **卡片流子元素接上入场** | — | **`:1680`** | `[data-dam-flow] > * { grid-column: 1 / -1; min-width: 0; animation: dam-card-in var(--dam-dur-fast) var(--dam-ease-out) both; }` ✅（补丁 [6]，保住非卡片 section 的淡入） |
| 卡片入场 | `:1399` | **`:1688`** | `dam-card-in var(--dam-dur-fast) var(--dam-ease-out) both` ✅（400→250ms，补 `both`） |
| 卡片错开 | `:1401-1405` | **`:1696-1700`** | `:nth-child(2..5)` = `calc(var(--dam-dur-stagger) * 1..4)`；`:nth-child(n+6)` = `* 5` ✅（40/80/120/160/200ms 数值不变，只刻度化） |
| 卡片/横幅非 flow 路径 | `:1466` | **`:1765`** | `[data-dam-card], [data-dam-banner] { animation: dam-rise var(--dam-dur-fast) var(--dam-ease-out) both; }` ✅（340→250ms） |
| 日历容器 | `:1472` | **`:1781`** | `[data-dam-calendar] { animation: dam-rise var(--dam-dur-fast) var(--dam-ease-out) both; }` ✅ |

### §1.3 手风琴（4 条）
| 动效点 | 旧锚点 | **新锚点** | 现状 |
|---|---|---|---|
| 高度 / 透明度 / 位移（三数归一） | `:1463` | **`:1762`** | `transition: max-height var(--dam-dur-fast) var(--dam-ease-out), opacity var(--dam-dur-fast) var(--dam-ease-out), transform var(--dam-dur-fast) var(--dam-ease-out);` ✅ 三数已归一 250ms |
| JS 卸载计时 | `:2754` | **`:3130`** | `timer = setTimeout(function () { setShown(false); setPhase('closed') }, 260)` ⇒ **260ms 不动**（CSS 已收到 250ms，余量 10ms 正确） ✅ 见 §D.5 |

### §1.4 日历（5 条）
| 动效点 | 旧锚点 | **新锚点** | 现状 |
|---|---|---|---|
| 事件入场 | `:1475` | **`:1784`** | `dam-event-in var(--dam-dur-fast) var(--dam-ease-out) both` ✅ |
| 事件 hover | `:1475` | **`:1784`** | `transition: transform var(--dam-dur-quick) var(--dam-ease-out), filter var(--dam-dur-quick) var(--dam-ease-out)` ✅（`.18s ease` → 150ms 项目曲线） |
| 弹窗入场 | `:1477` | **`:1786`** | `dam-modal-in var(--dam-dur-fast) var(--dam-ease-out) both` ✅（260→250ms） |
| 日期格 hover 过渡 | `:1473` | **`:1782`** | `transition: transform var(--dam-dur-quick) var(--dam-ease-out), border-color .2s ease, background .2s ease, box-shadow .2s ease` ✅（只动 transform 那条，颜色属性**按判据不动**） |
| 日期格 hover 位移 | `:1474` | **`:1783`** | `transform: translateY(-1px)` ✅ 保持不动（§3.6） |

### §1.5 页签与交互反馈（4 条）
| 动效点 | 旧锚点 | **新锚点** | 现状 |
|---|---|---|---|
| 页签（浮层内） | `:1426` | **`:1725`** | `transition: color var(--dam-dur-quick) var(--dam-ease-out), background …, opacity …, transform …` ✅ 四条统一 150ms |
| 页签条（死声明） | `:1425` | **`:1724`** | `transition: transform .42s cubic-bezier(.22,.8,.2,1); will-change: transform;` **未动** ✅（取证注释写在 `:1720-1723`，写明「死声明」+ 保留理由） |
| 页签/按钮按压 | `:1410` | **`:1705`** | `[data-dam-btn]:active, [data-dam-tab]:active { transform: scale(.97) }` ✅ 不动（§3.4） |
| 页签选中态 | `:1430` | **`:1729`** | `transform: translateY(-1px)` ✅ 不动（§3.5） |

### §1.6 可达性（2 条）
| 动效点 | 现状 | **新锚点** | 判定 |
|---|---|---|---|
| 第二道 reduced-motion 闸门 | 覆盖浮层/日历三件/页签交互/折叠头/侧栏/保存条 | **`:1773-1780`** | ✅ 已补（注释 `:1771-1772` 逐字说明漏了哪些） |
| token 联合作用域 | — | **`:1580-1581`** | ✅ 已补 |

**闸门总覆盖**：`prefers-reduced-motion` **3 处**（`:1710` 新增动效、`:1767` 原有、`:1773` 第二道补丁）；合计覆盖选择器：`:1711`(2 个) `:1712`(2) `:1713`(2) `:1767`(7) `:1768`(3) `:1769`(1) `:1770`(1) `:1774-1776`(11) `:1778-1780`(6) ≈ **35 个选择器**。

## D.4 §2「根因」（四条，MOTION-SPEC §2）—— 现状核对

**§2.1 嵌套双重入场（容器与卡片同时在动，主因）** —— 证据链：`MemoryPageView` 渲染 `h('div', {'data-dam-page':''}, …, h('div', {'data-dam-body':''}, body))`（旧 `:4769,:4799` → **新 `:5653-5683`**，`data-dam-page` 在 `:5654`、`data-dam-body` 在 `:5683`）；6 个页签分支返回 `h('div', {'data-dam-flow':''}, rows)`（新锚点 **`:3258,3545,3635,3637,4018,4064,4121,4150,4255,4699,4756,4785,5163,5515`**）。
⇒ **已修**：`dam-page-in` 规则加 `:not([data-dam-flow])`（`:1674`），容器不再入场；入场责任移交 `[data-dam-flow] > *`（`:1680`）。

**§2.2 `dam-card-in` 漏写 `animation-fill-mode` ⇒ 延迟期闪白（最刺眼）** —— ✅ **已修**：`:1688` 与 `:1680` 均写 `both`。证据：`animation-fill-mode` 显式写法仅 1 处（其余走简写 `both`），**简写含 `both` 的 animation 行共 11 条**。
> 复核口径：`animation:` 命中 54 行；其中**既无 `both` 又无 `infinite`** 的仅 **5** 行（`:1711,:1770,:1777,:1779,:2007`），**全部是 `animation: none !important` 的闸门/跳过态**，无一是真动画。⇒ 「漏写 fill-mode」类缺陷已清零。

**§2.3 同一类元素三种入场时长（"矛盾"的字面来源）** —— 旧三层特异性：`[data-dam-body] > *` 250ms（`:1391`）/ `[data-dam-flow] > [data-dam-card]` 400ms+延迟（`:1398`）/ `[data-dam-card]` 340ms（`:1466`）。
⇒ **已修**：三者现均为 `var(--dam-dur-fast)`（250ms），分别见 `:1674` / `:1688` / `:1765`。

**§2.4 手风琴：三个数同跑 + JS 提前 60ms 拆 DOM** —— ✅ **已修**：三数归一（`:1762`），JS 仍 260ms 且现为正确值（`:3130`）。
> **附注（MOTION-SPEC §2.4 提到的"空转"仍在）**：`:1763` `[data-dam-disclosure][data-phase="open"] { opacity: 1; max-height: 1800px; … }` —— 终态仍写死 `1800px`。MOTION-SPEC §4.3 已列为"单独一批"的遗留待办（需在 DOM 加 inner 包装以改 `grid-template-rows: 0fr ↔ 1fr`）。**v3 若照抄，请保留 1800px 或按 §4.3 的建议单独立项。**

**§2.5 次要项（三条）**：浮层关闭 `ease-in` ✅已修（`:1594`）；页签两种手感 ✅已统一（`:1725`）；减动效闸门漏 10 处 ✅已补（`:1773-1780`）。

## D.5 §3「刻意没动的动效」（12 条，逐条理由）

| 条 | 内容 | 旧锚点 | **新锚点** | 不动的理由（原文要点） |
|---|---|---|---|---|
| §3.1 | 浮层打开过冲曲线 `cubic-bezier(.2,.9,.3,1.15)` | `:1308` | **`:1591`** | 用途=弹窗**进入**，token 表明写「过冲曲线只属于进入……永远不要给关闭加回弹」；形态接近 `--ease-bounce`。**曲线保留，只换时长**；`transform-origin: left bottom` 亦保留（浮层常驻左下角，`apple-design` §7「锚定到来源」） |
| §3.2 | 手风琴 JS 卸载计时 `setTimeout(…, 260)` | `:2754` | **`:3130`** | 原 CSS 320ms ⇒ 260ms 合理；改 CSS 到 250ms 后**余量 10ms 恰好够** ⇒ 改 JS 反而把"修 CSS 顺带修好"变成两处维护 |
| §3.3 | 页签条 `transition: transform .42s` + `will-change` | `:1425` | **`:1724`** | **已核实为死声明**（全文件仅 3 处提到 `data-dam-tab-strip`：CSS `:1724`、闸门 `:1767`、创建 `:5597`；滚动由父容器原生 `scrollTo/scrollBy` 驱动）。删它对问题零贡献，却可能挡住未来改回 transform 驱动；**用户级硬规则**要求不得删既有动画 |
| §3.4 | 按压 `:active { transform: scale(.97) }` | `:1410` | **`:1705`** | 用途=按压反馈，落在 0.95–0.98 区间，且已是 `--dam-dur-quick`；符合「pointer-down 即时响应」 |
| §3.5 | 页签选中态 `translateY(-1px)` | `:1430` | **`:1729`** | 用途=选中态**静态**视觉（"抬起一点"），不是过渡；token 距离刻度 `--distance-micro 4px` 以下无 1px 级"静态偏移"token ⇒ 用途匹配不上 |
| §3.6 | 日历日期格 hover `translateY(-1px)` | `:1473-1474` | **`:1782-1783`** | 同 §3.5 |
| §3.7 | 卡片入场 `scale(.988)` | `:1400` | **`:1695`** | token 表缩放入口全部是**表面**（弹窗 .96/下拉 .97/tooltip .98）；380px 网格卡片不是表面 ⇒ 用途匹配不上 |
| §3.8 | 加载旋转 `dam-spin` | `:1492-1493` | **`:1801-1802`** | 用途=加载指示，`linear` + `infinite` 正确 |
| §3.9 | 首启向导整套（`data-dam-tour-*`、`dam-bokeh-*`、`dam-slab-*`、`dam-tile-*`、`dam-art-*`、`dam-stage-float`、`dam-page-flip`、`dam-radar-spin` 等） | `:1496-1630` | **`:1805-2012`** | **用户明确要求不要动**；按 `animate` 频率分层属「Rare / first-time」，`--duration-very-slow 500ms` 及更长（`.55s/.62s/1.7s`）预算正属于这一层 |
| §3.10 | 看板 zoom 与列宽（`data-dam-graph` 及 SVG 尺寸） | `:1448-1451` | **`:1747` 等** | **用户明确要求不要动**；由 JS 几何状态驱动（可拖动/缩放），属直接操控而非入场动效 |
| §3.11 | 更新揭幕 `dam-update-intro` / `dam-update-content-in` | `:1675-1689` | **`:1998-2011`** | 用途=发版**一次性**揭幕（1.7s 编排），频率=每次发版一次 ⇒ rarity 最高，`both` 已写对，无嵌套 |
| §3.12 | `[data-dam-tab][data-active]`、`[data-dam-fold]` 箭头旋转、`[data-dam-savebar]` 等过渡 | `:1369-1370` | **`:1652`**（`dam-fold-caret` 用 `var(--dam-dur-fast) var(--dam-ease-inout)`） | **已正确**：用途=图标切换 ⇒ `--ease-in-out` 正是 token 表给它的曲线 ⇒ 不动，只纳入 reduced-motion 闸门 |

## D.6 现状统计（**逐项区分"可复现"与"口径差异"**）

| 指标 | 施工单给值 | **本轮实测** | 说明 |
|---|---|---|---|
| `@keyframes` | 46 | **46** ✅ | 名称全表见下 |
| `transition:` | 29 | **29** ✅ | |
| `animation:` | 54 | **54** ✅ | |
| `transition: all` | 2 | **2** ✅ | `:1948`（tour-dot `.35s cubic-bezier(.4,0,.2,1)`）、`:1954`（tour-btn `.22s ease`）—— **均在向导域** |
| `prefers-reduced-motion` | 3 | **3** ✅ | `:1710,:1767,:1773` |
| `ease`（裸） | 62 | **28**（timing 口径）/ 130（含 `release`/`please` 等字串） | ⚠️ **不可复现，见下** |
| `ease-out` | 34 | **34** ✅ | |
| `linear` | 24 | **24** ✅ | 其中 `linear-gradient` **18** ⇒ **真·linear 缓动仅 6 处** |
| `ease-in-out` | 19 | **19** ✅ | |
| `cubic-bezier(` | — | **18** | 去重后 **12 种** |

**⚠️ `ease`×62 的口径不可复现 —— 如实说明**
三种候选口径实测值：**(a)** 裸 `ease` 作 timing（字母边界，排除 `-out`/`-in-out`）= **28**；**(b)** 全文件含 `ease` 的**任意字串** = **130**（含 `release`×24、`minimumReleaseAge`×6、`releases`×4、`releasePointerCapture`×4、`--dam-ease-out`×33、`please`×1、`increase`×1）；**(c)** 仅在 `transition`/`animation` **简写内部**的裸 `ease` = **21**。
⇒ 62 **无法由任一自然口径得出**。**推断**：该数字来自**旧版本**（MOTION-SPEC 取证时 `client.js` 为 6,612 行）或不同统计工具的去重方式。**下游若需"裸 ease 有多少"，请用 (a)=28 这个口径**，并注意其中 21 处落在真实简写里、7 处落在别处（如 `transition: all .22s ease` 之类可被 (c) 覆盖的部分）。

**缓动分布（仅在 `transition`/`animation` 简写内统计，实测）**
| 缓动 | 次数 |
|---|---|
| `ease-out` | **25** |
| `ease`（裸） | **21** |
| `ease-in-out` | **19** |
| `linear` | **5** |
| `ease-in` | **2** |
| `cubic-bezier(.2,.9,.3,1.15)` | 2 |
| `cubic-bezier(.4,0,.2,1)` | 2 |
| `cubic-bezier(.2,.8,.2,1)` | 2 |
| 各 1 次 | `cubic-bezier(.22,.8,.2,1)`、`(.2,.9,.3,1.16)`、`(.2,.9,.3,1.25)`、`(.2,.9,.3,1.18)`、`(.2,.9,.3,1.22)`、`(.2,.8,.3,1)` |

**`cubic-bezier` 去重全表（12 种，含出现处）**
| 曲线 | 次数 | 出现处 |
|---|---|---|
| `cubic-bezier(.22,1,.36,1)` | 2 | token 定义 `:1581`（另 `:1625`） |
| `cubic-bezier(.65,0,.35,1)` | 2 | token 定义 `:1581`（另 `:1626`） |
| `cubic-bezier(.34,1.36,.64,1)` | 2 | token 定义 `:1581`（另 `:1627`） |
| `cubic-bezier(.2,.9,.3,1.15)` | 2 | 面板入场 `:1591`；玻璃板 `:1848` |
| `cubic-bezier(.4,0,.2,1)` | 2 | 向导点 `:1948`；开关滑块 `:1975` |
| `cubic-bezier(.2,.8,.2,1)` | 2 | 更新揭幕 `:1998,:2011` |
| `cubic-bezier(.22,.8,.2,1)` | 1 | 页签条死声明 `:1724` |
| `cubic-bezier(.2,.9,.3,1.16)` | 1 | 向导弹入 `:1815` |
| `cubic-bezier(.2,.9,.3,1.18)` | 1 | 底牌入场 `:1875` |
| `cubic-bezier(.2,.9,.3,1.22)` | 1 | 见 tour 域 |
| `cubic-bezier(.2,.9,.3,1.25)` | 1 | 核心方块 `:1870` |
| `cubic-bezier(.2,.8,.3,1)` | 1 | 向导换步 `:1936` |

> ⇒ **"过冲曲线家族"实测有 7 个变体**（1.15/1.16/1.18/1.22/1.25 + token 的 1.36 + 无过冲的 .2,.8,.2,1）—— 这是"乱"的量化证据，也是收敛点。

**`@keyframes` 全表（46 个，名称逐字）**
```
dam-in dam-out dam-page-in dam-stat-num dam-stat-reveal dam-stat-grow dam-stat-pop dam-stat-pulse
dam-stat-arc dam-card-in dam-rise dam-event-in dam-modal-in dam-spin dam-tour-fade dam-tour-pop
dam-bokeh-in dam-bokeh-drift dam-stage-float dam-slab-drop dam-orb-shine dam-core-pop dam-tile-enter
dam-tile-breathe dam-art-enter dam-art-float dam-bubble-breathe dam-seed-orbit dam-plate-hover
dam-drop dam-pulse dam-bell-sway dam-clapper dam-page-flip dam-link-a dam-link-b dam-glint dam-prism
dam-core-breathe dam-orbit dam-radar-spin dam-spark-rise dam-tour-swap dam-update-intro
dam-update-content-in dam-update-logo-expand
```
**分域**：核心面板/会话页 **12 个**（`dam-in`/`dam-out`/`dam-page-in`/`dam-card-in`/`dam-rise`/`dam-event-in`/`dam-modal-in`/`dam-spin` + 7 个 `dam-stat-*` 中的统计类）；**向导域 28 个**（`dam-tour-*`/`dam-bokeh-*`/`dam-slab-*`/`dam-tile-*`/`dam-art-*`/`dam-stage-float`/`dam-orb-shine`/`dam-core-pop`/`dam-*breathe`/`dam-seed-orbit`/`dam-plate-hover`/`dam-drop`/`dam-pulse`/`dam-bell-*`/`dam-clapper`/`dam-page-flip`/`dam-link-*`/`dam-glint`/`dam-prism`/`dam-orbit`/`dam-radar-spin`/`dam-spark-rise`/`dam-tour-swap`）；**更新域 3 个**（`dam-update-*`）。
⇒ 与 `DESIGN-OVERHAUL-PRE-RESEARCH.md:144`「`@keyframes` 的 **32/38** 服务首启向导与更新卡」一致（当前 46 个中 **31 个**属向导+更新域，**15 个**服务核心面板/会话页/统计）。

---

# E. 可直接抄的 token 汇总表（v3 单页速查）

## E.1 颜色（**唯一真源 = `--dsw-alias-*`；禁止写死 hex**）

```css
/* 面板根节点：两个承载面都挂 --dam-accent */
[data-dam-panel], [data-dam-page] {
  --dam-accent: #1d4ed8;     /* 真源 :839 ACCENT_VALUES；可选 graphite #8b949e / violet #9b8cff */
  --dam-scale:  1;           /* 浮层写 1；页面写 var(--dam-user-scale, 1) */
}
/* 页面额外（:1619-1623） */
[data-dam-page] {
  --dam-scale: var(--dam-user-scale, 1);   /* :1619 —— 用户档由 JS 写 --dam-user-scale（:5657） */
  --dam-measure: 1440px;                    /* :1620 */
  --dam-pad-x: clamp(16px, 1.6vw + 6px, 44px);   /* :1621 */
  --dam-pad-y: clamp(14px, .8vw + 6px, 26px);    /* :1622 */
  --dam-gap:   clamp(10px, .5vw + 6px, 18px);    /* :1623 */
}
/* 用户档取值（:836 FONT_SCALE_VALUES）：sm .9 / md 1 / lg 1.15 / xl 1.3 —— 默认 'lg'（:809） */
```

| 语义 | 抄这个 | 锚点 |
|---|---|---|
| 品牌强调 | `var(--dam-accent, var(--dsw-alias-brand-primary, #4f7cff))` | `:1641` |
| 强调派生（底色） | `color-mix(in srgb, var(--dam-accent, #4f7cff) 12%, transparent)` | `:1642` |
| 强调派生（悬停/选中） | `color-mix(… var(--dam-accent, #4f7cff) 16%, transparent)` | `:1727,:1797` |
| 强调派生（钉住/实心） | `color-mix(… var(--dam-accent, #4f7cff) 24%, transparent)` | `:1716` |
| 正文 | `var(--dsw-alias-label-primary, #1f2328)` | `:1590,:1628` |
| 次级文字 | `var(--dsw-alias-label-secondary, #666)` | `:1609,:1796` |
| 边框/分隔 | `var(--dsw-alias-border-l1, rgba(128,128,128,.25))` | `:1603` |
| 卡片底 L1 | `color-mix(in srgb, var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)) 40%, transparent)` | `:1759` |
| 浮层底 L2 | `color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgba(255,255,255,.86)) 58%, transparent)` | `:1586` |
| 危险 | `var(--dsw-alias-state-error-primary, #d64545)` | `:1798` |
| 警告 | `var(--dsw-alias-state-warn-primary, #e8c584)` | `:3983` |
| 成功 | `var(--dsw-alias-state-success-primary, …)`（源码仅 2 处引用，**无统一兜底值**） | 见 A.1.2 |
| 遮罩 | `var(--dsw-alias-bg-mask-1, rgba(0,0,0,.18))` | `:2459` |

**hover 规律（照抄官网口径，`ART-DIRECTION:124`）**：靠**透明度**变化，不换色。

## E.2 材质（三档，见 §B.5 完整 CSS）

| 档 | 用途 | bg alpha | blur | saturate | border | shadow |
|---|---|---|---|---|---|---|
| **结构面** | 面板 / 会话页底 | 令牌 **58%** | **28px** | **1.55** | 1px 令牌 65% | `0 24px 64px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.22)` |
| **浮层** | 日历弹层 / 保存条 / 接续弹层 / 诊断卡 | 令牌 **74%** | **20px** | **1.4** | 1px 令牌 45% | `0 8px 28px rgba(0,0,0,.18)` |
| **内嵌元素** | 卡片 / 输入 / 小块 | 令牌 40% | **none** | — | 1px 令牌 60% | — |

**圆角三档（收敛自现有 24 种）**：面板/大面 `16px` · 中件 `14px` · 内嵌 `8–10px` · 胶囊 `99px` · 圆形 `50%`。

## E.3 动效（**与 MOTION-SPEC §0.1 同源，直接抄**）

```css
[data-dam-panel], [data-dam-page] {
  --dam-dur-quick: 150ms;    /* 关闭 / 悬停 / 文字切换 */
  --dam-dur-fast:  250ms;    /* 打开 / 页面前进 / 手风琴（对称例外） */
  --dam-dur-slow:  400ms;    /* 面板打开 / 骨架揭示 */
  --dam-dur-stagger: 40ms;   /* 逐项错开 */
  --dam-ease-out:    cubic-bezier(.22, 1, .36, 1);    /* 默认 */
  --dam-ease-inout:  cubic-bezier(.65, 0, .35, 1);    /* 图标/文字切换 */
  --dam-ease-pop:    cubic-bezier(.34, 1.36, .64, 1); /* 仅进入 */
}
```
**用途匹配表（照此选，不要自创）**

| 场景 | 时长 | 曲线 |
|---|---|---|
| 页面前进 / 卡片入场 | `--dam-dur-fast` | `--dam-ease-out` |
| 弹窗·浮层打开 | `--dam-dur-fast` | `--dam-ease-out`（**或**过冲 `cubic-bezier(.2,.9,.3,1.15)`，仅进入） |
| 弹窗·浮层关闭 | `--dam-dur-quick` | `--dam-ease-out`（**禁 `ease-in`、禁过冲**） |
| 悬停 / 按压 | `--dam-dur-quick` | `--dam-ease-out` |
| 图标 / 文字切换 | `--dam-dur-fast` | `--dam-ease-inout` |
| 手风琴开合 | `--dam-dur-fast`（对称，两端同长同曲线） | `--dam-ease-out` |
| 逐项错开 | `calc(--dam-dur-stagger * n)`，n=1..5 | 随入场 |
| 加载旋转 | 不限（`.8s` 现例） | `linear` + `infinite` |
| 骨架 / 统计揭示 | `--dam-dur-slow` | `--dam-ease-out` |

**入场位移刻度（照抄，勿自创）**：页面主体 `translateY(6px)`（`:1675`）· 卡片 `translateY(8px) scale(.988)`（`:1695`）· 卡片/横幅 `translateY(7px) scale(.988)`（`:1766`）· 弹窗 `translateY(10px) scale(.98)`（`:1788`）· 浮层 `scale(.92) translateY(10px)`（`:1592`）· 事件 `translateX(-5px)`（`:1787`）· 手风琴 `translateY(-5px) scale(.985)`（`:1762`）。

**闸门（必须两条都写）**
```css
@media (prefers-reduced-motion: reduce) { /* 覆盖全部动效：animation:none !important; transition:none !important; */ }
@media (prefers-reduced-transparency: reduce) { /* 本插件未实现，建议补：去 blur、底做实 */ }
```

## E.4 结构（两形态骨架）

```
浮层 [data-dam-panel]                     会话页 [data-dam-page]
position: fixed; left:16px; 440×560        width/height 100%
border-radius: 16px                        --dam-measure: 1440px（正文居中限宽）
z-index: 3000                              ├─ [data-dam-page-head]   标题 + [刷新] + [浮层开关]
├─ header  标题 + ✕ ⟳ ⤾ Pin                 └─ [data-dam-page-main]  display:flex
├─ [data-dam-tabs-wrap] → TabScroller                ├─ [data-dam-page-nav]    170px 左侧竖列
│    （横向滚动页签，‹ › 箭头）                       └─ [data-dam-page-content]
├─ [data-dam-body]（单列，padding 16px）                  └─ [data-dam-body]（多列 grid）
└─ [data-dam-resize] 22×22                                                 └─ [data-dam-flow] grid
                                                                              ├─ [data-dam-card] → grid-column: auto
共享：panelTab（模块级）+ nonce 刷新          └─ 其它子元素 → grid-column: 1 / -1
```

---

# F. v2 缺什么（逐条对照，带 v2 命中数证据）

> **对照物**：`docs/ui-demo/v2/index.html`（**251,288 B / 3,588 行** / sha256 `c59c40b0…` 见交接账本）。
> **对照基准**：本文件 §A–§E（= `lib/client.js` 真源）+ `R3-V2-SPEC.md` §5 视觉约束。

## F.1 总判定：v2 **没有读**四份真源，配色与材质是"自创"的

**v2 自己的注释（`:12-15`）声称**：
```
:12  色板真源：R3-V2-SPEC §5.1（20 值，不得另创）
:13  信息架构真源：R3-V2-SPEC §2（Lead 拍板）
:14  机制真源：docs/internal/R3-MECHANISM-MAP.md（lib/client.js 行号锚点）
:15  缺口依据：docs/internal/R3-DEMO-GAP-AUDIT.md（P0 六项）
```
⇒ **声称的四份真源里，没有一份是设计真源**（没有 `ART-DIRECTION-DEEPSEEK-20260920.md`、没有 `PANEL-PAGE-MIGRATION-DIRECTION.md`、没有 `MOTION-SPEC-20260922.md`、没有 `DESIGN-OVERHAUL-PRE-RESEARCH.md`）。**这就是根因的书面证据。**

**更严重的一条（本轮新发现）**：`R3-V2-SPEC.md:113` 写「§5.1 色板（**沿用现有真源**，不得另创）」，但它列出的 20 个值**在 `lib/client.js` 里几乎全部不存在**：

| R3-V2-SPEC §5.1 值 | 在 `lib/client.js` 的命中 |
|---|---|
| `#0a0d14` `#141828` `#0f1320` `#05070d` `#e8ecf3` `#b8c0d0` `#3b82f6` `#60a5fa` `#93c5fd` `#eef2f7` `#e2e8f0` `#0f172a` `#334155` `#2563eb` `#8b93a5` | **全部 0** |
| `#ffffff` | 1 |
| `#2fa46a` | 1 |
| `#d4a94f` | 5 |
| `#c44a4a` | 3 |
| `#4f7cff` | 21 |

⇒ **结论（硬）**：R3-V2-SPEC §5.1 的色板**不是**从 `lib/client.js` 提取的（**推断**：其深色 5 值 `#0a0d14/#141828/#0f1320/#05070d` 与 `docs/landing/index.html` 的浅色系不对应，但 `#eef2f7`/`#3b82f6`/`#2563eb`/`#0a0d14` 在 landing 里各有 2–3 次命中 ⇒ **该色板来自落地页 `docs/landing/index.html`，被误当作"现有真源"**）。**该"不得另创"在事实层面失败了**：拿落地页的色板冒充插件色板。
⇒ **v3 必须换用**：§A 的 `--dsw-alias-*` 令牌体系 + §E.1 的抄法。

## F.2 逐条缺口表（带 v2 命中数）

| # | 真源要求 | v2 命中数 | 判定 | 说明 |
|---|---|---|---|---|
| **1** | **`data-dam-panel`（浮层承载面）** | **0** | ❌ **完全缺失** | v2 全文无任何 `data-dam-panel`。用户的「悬窗形式」在演示稿里**根本不存在** |
| **2** | **`data-dam-page`（整页承载面）** | **0** | ❌ **完全缺失** | 同上。两个承载面**一个都没有** |
| **3** | `panelPos` 三态逻辑 | **1**（`:2671` 一行说明文字） | ⚠️ 仅"讲到"未"做出" | v2 在设置页里**描述了**三档（`:2603-2609`「承载面」单选：两者都有 / 只用浮层 / 只用并列页），但**没有任何一处真的呈现浮层或整页两种版式** |
| **4** | `bottom-left` 浮层定位 | 1（同 `:2671` 文案） | ❌ 未实现 | 无固定左下角浮层 |
| **5** | **浮层 440×560 几何** | **0** | ❌ 未实现 | v2 里 `440` 只出现在引用 `client.js:440` 的技术注释（`:1360`）；`560` 出现在 `max-width: min(560px, 92vw)` 的 toast（`:601`）——**都与浮层无关** |
| **6** | **液态玻璃材质** | `backdrop-filter` **0** / `backdropFilter` **0** / `blur(` **0** | ❌ **完全缺失（最严重）** | v2 全文**没有任何一处毛玻璃**。用户的「液态玻璃的美学形式」在 v2 里是**零** |
| **7** | `saturate()` | **1**（`:186` `filter:saturate(.45)` —— **是"禁用态降饱和"，方向相反**） | ❌ 无一处 saturate 增强 |
| **8** | **`--dsw-*` / `--dam-*` 令牌** | **两者均 0** | ❌ 自建了一套 `--bg/--fg/--accent/--line…`（v2 `:17-61`） | v2 的 token 名（`--accent` `--bg-elev` `--line-2` `--r-lg` 等，见 v2 `:17-44`）**与项目真源无一处同名** ⇒ 下游无法复用 |
| **9** | 面板 3 层阴影（含 1px 内高光） | `box-shadow` 7 处，`inset 0 1px` **0** | ❌ 无"玻璃内高光" | v2 的阴影是普通卡片投影（`:35` `--shadow: 0 14px 38px rgba(0,0,0,.46)`），**没有 `inset 0 1px 0 rgba(255,255,255,.22)` 这种玻璃特征** |
| **10** | 顶部渐变高光（`linear-gradient(180deg, rgba(255,255,255,.13), transparent 70%)`） | `linear-gradient` 9 处，**无一处是玻璃高光** | ❌ 缺失 | v2 的渐变用在按钮/进度条 |
| **11** | `@keyframes` 46 个 | **1**（`:171` `scrIn`） | ⚠️ 严重缩水 | 真源 15 个服务核心面板（`dam-in/out/page-in/card-in/rise/event-in/modal-in/spin` + `dam-stat-*`），v2 只做了 1 个 |
| **12** | `animation:` 54 处 | **2** | ⚠️ 严重缩水 | 用户批评「动画也有点差」的直接对应 |
| **13** | `transition` 值 | 24–25（`transition:` 24 / `transition` 字串 25） | ⚠️ 数量接近但**规格不符** | 见 #14 |
| **14** | **动效 token 刻度** | `--dam-dur-quick`/`--dam-ease-out` **各 0**；v2 自建 `--dur-quick:150ms` / `--dur-fast:250ms` / `--ease:cubic-bezier(.2,.8,.2,1)`（v2 `:37-39`） | ⚠️ **数值部分对、曲线不同** | v2 用 `cubic-bezier(.2,.8,.2,1)`，真源默认曲线是 `cubic-bezier(.22,1,.36,1)`（`--dam-ease-out`）。**且缺 `--dam-dur-slow: 400ms` 与 `--dam-dur-stagger: 40ms` 两档** |
| **15** | 错开（stagger 40ms） | **0** | ❌ 缺失 | 无 `animation-delay` 阶梯 |
| **16** | `prefers-reduced-motion` 闸门 | **2**（`:631` CSS 媒体查询 + `:3159` JS matchMedia） | ✅ **达标（唯一达标项）** | |
| **17** | `prefers-reduced-transparency` | **0** | ❌ 缺失（真源也缺，故非 v2 独有问题） | |
| **18** | **多列栅格（真源 `repeat(auto-fit, minmax(min(100%,380px),1fr))`）** | v2 用**固定列数**：`.cols-2/3/4`（`:197-199`）、`.split`（`:298`）、`.flow-grid`（`:315`）、`.sum-row`（`:318`）、`.settings-grid`（`:495`）等 25 处 `grid-template-columns` | ⚠️ **形态接近但机制不同** | 真源是**响应式 auto-fit**，v2 是**断点手写列数**（`:611-626` 三档 `@media`）⇒ 换宽度会跳变而非流式 |
| **19** | 左侧固定侧栏导航（170px，竖列，选中态强调色底） | v2 有 `.app { grid-template-columns: 246px minmax(0,1fr) }`（`:93`）+ `.nav-item` 选中 `background:var(--accent-soft)`（`:122`） | ✅ **形态对**（宽度 246 ≠ 170，属设计选择） | 但 v2 侧栏是**应用级导航**（4 入口），**不是"会话页内的 13 分区导航"** ⇒ 会话页版式的核心结构仍缺 |
| **20** | 浮层专属控件（✕ ⟳ ⤾ Pin 拖拽 缩放） | v2 `resize` 仅 1 处（textarea `:523`）；无 drag/pin | ❌ 缺失 | 「悬窗形式」应有控件全缺 |
| **21** | 整页**不该有**浮层控件 | v2 本就没有 ✅ | ✅ 因祸得福 | |
| **22** | 深色为底 + 明暗双套 | v2 有 `data-theme="dark"` 默认 + `html[data-theme="light"]`（`:46`）| ⚠️ **方向对但非真源** | 真源**没有**插件侧明暗开关（见 §A.3）⇒ v2 的双主题是新增设计，**不能标为"还原"** |
| **23** | 零外部依赖 | `http(s)://` **0** / `<link>` **0** / `<script src>` **0** | ✅ 达标 | 符合 R3-V2-SPEC §5.2 |
| **24** | 交互可点 | `<button>` 102 / `<input>` 19 | ✅ 达标 | |

## F.3 v2 的三个"最贵"缺口（给 v3 的施工优先级）

1. **液态玻璃 = 0 命中**（#6/#7/#9/#10）⇒ 这是用户「没有体现出美学观念……这种高级的感觉」的**唯一直接原因**。修法：抄 §B.5 的三档材质 + §E.2。**最低成本**：至少给"面板/浮层/弹窗"三类容器加上 `backdrop-filter: blur(28px) saturate(1.55)` + 令牌 58% 底 + 3 层阴影 + 顶部渐变高光。
2. **双形态 = 0 命中**（#1/#2/#5/#20）⇒ 用户「我这个记忆窗格是有两个方向的」**在 v2 里完全没有视觉证据**。修法：同页并列两块画布 —— 左「悬窗」（440×560 居中/左下，含 ✕⟳⤾Pin+拖拽缩放，单列 + 顶部横向页签）／右「整页」（100% 宽，左侧 170px 竖向侧栏 + 多列 auto-fit 栅格，页头只有标题+刷新+浮层开关）。
3. **动画只有 2 条 `animation:` / 1 个 `@keyframes`**（#11/#12/#15）⇒ 用户「动画也有点差」的直接对应。修法：抄 §E.3 的刻度 + §D.6 的核心 12 个 `@keyframes`；**错开（40ms×n）必须做**，它是"卡片流高级感"的主来源（`:1696-1700`）。

## F.4 断言的边界（诚实声明）

- 本节的 v2 数据全部来自对 `docs/ui-demo/v2/index.html` 的**静态文本扫描**（正则计数）。
- **未做**渲染取证（headless Chrome 读 `getComputedStyle` + 截图）——那是项目既有纪律要求的验收方式，**本任务范围是"真源提取"，不含 v2 验收**。若需 v2 的实际渲染效果判断，应另行启动渲染探针。
- v2 的 sha256 未在本轮复算（交接账本记为 `c59c40b0…`，本次仅实测字节数 251,288 与行数 3,588，**与账本一致**）。

---

# G. 附：本文件的锚点自检

**注**：下表数字由脚本机械统计（正则 `(?<![\w:]):\d{1,5}` 于本文档全文），统计口径是"行内的 `:行号` token 数"，含 `:NNNN` 与 `:NNNN-NNNN` 两种写法。

| 节 | 带锚点行数 | `:行号` token 数 | 主要锚点来源 |
|---|---|---|---|
| §0 取证口径 | 1 | 1 | SHA256 / 行数自述 |
| **§A 配色** | 53 | **179** | `lib/client.js` 色值分布 + 令牌清单 |
| **§B 材质** | 71 | **133** | 24 条配方 + 令牌解读 |
| **§C 双形态** | 87 | **205** | panelPos 9 处 + 槽位 8 + 几何 20 + 版式差异表 |
| **§D 动效** | 68 | **147** | token 7 + §1 逐条 22 + §3 12 + 统计 |
| §E token 汇总 | 21 | **32** | 汇编自 A–D |
| §F v2 缺口 | 19 | **29** | 混合（`lib/client.js` 与 v2 演示稿两侧） |
| §G 本表 | 0 | 0 | — |
| **合计** | **320** | **725** | |

**四节各自锚点数（施工单要求项）**：**A = 179 · B = 133 · C = 205 · D = 147**（`:行号` token 口径）。

**本文件自身元数据**
| 项 | 值 |
|---|---|
| 路径 | `docs/internal/R4-DESIGN-TRUTH.md` |
| 字节数 / 行数 | **≈93 KB / ≈982 行**（LF；新建文件，非仓内 CRLF 存量文件） |
| 权威哈希与终稿字节数 | **见 task-5 完成报告**——本表位于文件内部，任何自引用数值都会随写盘改变（哈希无法自引用，字节数亦随之漂移） |
| 仓库状态 | 未跟踪新文件；`git status --porcelain` 无 `M` 条目 ⇒ `lib/`、`docs/ui-demo/`、`tests/`、`tools/` **零改动**（已实测确认） |

**写盘口径**：本文件为唯一交付物；未修改 `lib/`、`docs/ui-demo/`、`tests/`、`tools/` 任何文件；提取用探针脚本 12 个写在 `artifacts/_r4-probe{,2..12}.mjs`（**只读**，输出留档 `artifacts/_r4-probe*-out.txt`，可删）。

**未查清 / 未做的事（诚实清单）**
1. **`ease`×62 的口径不可复现**（§D.6）——三种自然口径实测 28 / 21 / 130，均非 62。已如实标注为"可能来自旧版本"。
2. **`--dam-ease-linear` 定义处**——源码未找到（仅 1 处使用，`:5054`）。已判定为源码缺陷并给出修法建议。
3. **`tests/` 目录未读**——`PANEL-PAGE` §5-6 要求的"守卫测试是否已新增"**未核实**（本任务范围为只读 `lib/` 与 `docs/`）。
4. **未做渲染取证**——所有结论来自静态文本扫描（正则计数 + 行内容 dump）；项目既有纪律要求"视觉/样式改动须 headless Chrome 读 `getComputedStyle` + 截图取证"，**本任务不涉及改动**，故未执行；若 v3 或验收需要实际渲染数据，应另开渲染探针。
5. **官网 12px 玻璃值与本插件 28px 的取舍**——已指出两者不同并给出建议（保留 28px），但**"是否向官网 12px 靠拢"属设计决策，未经用户拍板**，本文件不越权决定。
6. **`R3-V2-SPEC.md §5.1` 色板的真实来源**——已证明其 20 值中 15 个在 `lib/client.js` 命中为 0、4 个在 `docs/landing/index.html` 命中 2–3 次，据此**推断**其来源为落地页；**未做进一步溯源**（未查该规格书的生成过程）。
7. **`docs/ui-demo/v2/index.html` 的 sha256 未复算**——交接账本记 `c59c40b0…`，本轮仅实测字节数（251,288 B）与行数（3,588 行），**两者与账本一致**。

