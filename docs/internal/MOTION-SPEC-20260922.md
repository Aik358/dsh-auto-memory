# 动效规格 · dsh-auto-memory（2026-09-22）

> 交付物 1/2。配套补丁脚本：`.vision-tmp/patch-motion.cjs`（交付物 2/2）。
> 由 Lead 应用；本文档不改代码。

### 0.0 关于本文档里的 `:行号`（必读）

所有 `:NNNN` 行号取证于 **`lib/client.js` 591630 字节 / 6612 行 / SHA256 `7e3d783f…d043d9`** 那一版。

**在动效诊断与补丁执行期间，该文件被并发修改过**（591630 → 596031 字节 / 6676 行，另有他人同批改动）。因此：

- 行号**只能当"大致位置"读**，跨版本会漂移；
- 补丁脚本**一律用内容锚点定位**，不用行号 —— 这正是它能在漂移后的 596031 字节版本上 15 步全部命中（每步命中数 === 1）的原因；
- 要复核某一条结论，请用本文档给出的**选择器 / 声明原文**去搜，不要用行号。

## 0. 这份文档解决什么

用户原话：「你动画删了又加，感觉造成了一些矛盾。现在动画非常奇怪，我觉得你需要重做一下动画了，需要用 skill 的就必须用 skill」。

本规格的立场：**重做与统一，不删**。§3「刻意没动」清单与 §1「建议」同等重要——`无确凿证据不得删除既有动画或视觉表现` 是用户级硬规则，所以每条改动都必须带代码证据，每条不动的也必须带不动的理由。

数值来源与优先级（四个 skill 冲突时的仲裁顺序）：

| 来源 | 作用 | 本规格中的角色 |
|---|---|---|
| `transitions-motion` §1 token 表 | 时长/缓动/位移/缩放/模糊的**数值来源** | 所有建议值都写成 token 名 |
| `animate` 决策顺序 | 该不该动 → 目的 → 工具 → 属性 → 曲线时长 → 中断退出 | §3 每条"不动"的判断流程 |
| `emil-design-eng` | 时长/缓动/进出门控判据 | 开/关不对称、错开预算、`transition: all` 排查 |
| `apple-design` | spring、材质、可达性 | reduced-motion 闸门补齐、`transform-origin` 方向 |

### 0.1 项目自带的动效刻度（已存在，本次复用而非另起一套）

`lib/client.js:1341-1344` 已定义一套与 token 表同值的变量 —— 这本身就是"这批动画是按 token 表做的"的证据：

| 项目变量 | 值 | 对应 token | token 表中的用途 |
|---|---|---|---|
| `--dam-dur-quick` | `150ms` | `--duration-quick` | 弹窗/下拉**关闭**、文字切换、tooltip 出现 |
| `--dam-dur-fast` | `250ms` | `--duration-fast` | 图标切换、下拉/弹窗**打开**、标签滑动、**页面前进** |
| `--dam-dur-slow` | `400ms` | `--duration-slow` | 面板打开、骨架揭示 |
| `--dam-dur-stagger` | **本次新增** | `--duration-stagger` | 逐项错开偏移 `40ms` |
| `--dam-ease-out` | `cubic-bezier(.22, 1, .36, 1)` | `--ease-smooth-out` | **默认曲线**（开/关、页面前进、位移、尺寸） |
| `--dam-ease-inout` | `cubic-bezier(.65, 0, .35, 1)` | `--ease-in-out` | 图标切换、文字切换 |
| `--dam-ease-pop` | `cubic-bezier(.34, 1.36, .64, 1)` | `--ease-bounce` | 徽标弹出（**只用于进入**） |

### 0.2 一个必须先知道的作用域事实

这三个变量**只定义在 `[data-dam-page]` 里**（`lib/client.js:1341-1344`），而浮层 `[data-dam-panel]`（`:1299-1311`）不是 `[data-dam-page]` 的后代。

⇒ 浮层那组规则**取不到这些变量**，所以它一直写的是字面量（`.2s` / `.16s` / `cubic-bezier(.2,.9,.3,1.15)`）。补丁为此新增**一条联合作用域声明**（`[data-dam-panel], [data-dam-page]`），让浮层也能用 token；`[data-dam-page]` 里原有的那份定义**照原样保留**（不删、不搬，避免任何层叠行为变化）。

---

## 1. 现状 → 建议

「理由」一栏引用的是**用途**（token 表按用途匹配的原则），不是数值远近。

### 1.1 浮层 `[data-dam-panel]`（左下角浮层，440×560）

| 动效点 | 现状（file:line） | 建议 | 理由（用途） |
|---|---|---|---|
| 打开 | `dam-in .2s cubic-bezier(.2,.9,.3,1.15)` `:1308` | `dam-in var(--dam-dur-fast) var(--dam-ease-out)`；**曲线保留** | 意图=「弹窗打开」，token 为 `--duration-fast`；200ms 不在刻度上。过冲曲线**保留**（见 §3.1） |
| 关闭 | `dam-out .16s ease-in` `:1311` | `dam-out var(--dam-dur-quick) var(--dam-ease-out)` | 意图=「弹窗关闭」= `--duration-quick`(150ms)。**`ease-in` 起步最慢，恰是取消动作最不该用的曲线**（`animate` 的 Never Ship 清单明列）。原不符之处是曲线不是时长 |

### 1.2 会话页主体与卡片流 `[data-dam-page]`

| 动效点 | 现状（file:line） | 建议 | 理由（用途） |
|---|---|---|---|
| 主体直接子元素入场 | `dam-page-in` 250ms，**无 fill-mode** `:1391` | 保留 250ms `--dam-dur-fast` + `--dam-ease-out`，**补 `both`** | 意图=「页面前进」= 对称 250ms（token 表对称例外）。补 `both` 消除延迟期闪白（§2.2） |
| **卡片流容器**自身入场 | **额外**吃一条 `dam-page-in` `:1391` | **排除容器**：选择器改 `> :not([data-dam-flow])` | 「一个动作只有一个主角」。容器和它内部的卡片**同时**做 transform 入场 ⇒ 位移叠加、曲线打架（§2.1） |
| **卡片流的子元素**（含非卡片 section） | 由容器统一淡入（自己没有 `animation`） | `[data-dam-flow] > *` **接上同一条** `dam-card-in` 250ms + `both` | 容器不再入场后，若不给子元素补上，日志折叠块那类 section 会**失去淡入** = 删动画（违反用户级硬规则）。见 §5 步骤 [6] |
| 卡片入场 | `dam-card-in` **400ms**，**无 fill-mode** `:1399` | `dam-card-in var(--dam-dur-fast) var(--dam-ease-out) both` | 意图=「页面前进」，`--duration-fast` 250ms；400ms 是「面板打开」刻度，用在页签切换上会拖（`animate`：UI 动画 < 300ms）。`both` 是修 bug（§2.2） |
| 卡片错开 | `:nth-child(2..n+6)` 写死 `40ms…200ms` `:1401-1405` | `calc(var(--dam-dur-stagger) * 1..5)` | 意图=「逐项错开」= `--duration-stagger` 40ms，**数值不变，只是刻度化** |
| 卡片/横幅（非 flow 路径） | `dam-rise .34s cubic-bezier(.22,.8,.2,1)` `:1466` | `dam-rise var(--dam-dur-fast) var(--dam-ease-out)` | 340ms 不在 token 表上。同一张 `[data-dam-card]` 此前有 **250/340/400 三种时长**（§2.3），统一到 `--duration-fast` |
| 日历容器 | `dam-rise .34s …` `:1472` | 同上（共用 `dam-rise`，一次改完） | 同族，一起对齐 |

### 1.3 手风琴 `[data-dam-disclosure]`

| 动效点 | 现状（file:line） | 建议 | 理由（用途） |
|---|---|---|---|
| 高度 | `max-height .32s cubic-bezier(.22,.8,.2,1)` `:1463` | `max-height var(--dam-dur-fast) var(--dam-ease-out)` | 意图=「手风琴展开」= token 表**对称例外 250ms**（该表明写「手风琴 250ms」）。320ms 不在刻度上 |
| 透明度 | `opacity .2s ease` `:1463` | `opacity var(--dam-dur-fast) var(--dam-ease-out)` | 对称例外要求「同长度同缓动，两边不许拆」；200ms 是第三个数，与 320/280 三个数同跑（§2.4） |
| 位移 | `transform .28s cubic-bezier(.22,.8,.2,1)` `:1463` | `transform var(--dam-dur-fast) var(--dam-ease-out)` | 同上，三数归一 |
| JS 卸载计时 | `setTimeout(…, 260)` `lib/client.js:2754` | **不动** | 原 CSS 是 320ms ⇒ JS 260ms **提前 60ms 拆 DOM**，收尾被硬切。CSS 收到 250ms 后，260ms 的余量 10ms 恰好够 ⇒ **改 CSS 就同时修好了这个错配**（§2.4） |

### 1.4 日历

| 动效点 | 现状（file:line） | 建议 | 理由（用途） |
|---|---|---|---|
| 事件入场 | `dam-event-in .25s cubic-bezier(.22,.8,.2,1)` `:1475` | `dam-event-in var(--dam-dur-fast) var(--dam-ease-out)` | 250ms 数值不变，换成 token 名 + 项目默认曲线 |
| 事件 hover | `transform .18s ease, filter .18s ease` `:1475` | `var(--dam-dur-quick) var(--dam-ease-out)` | 悬停**进**要「快而直接」（`--duration-fast` 以内 + smooth-out）；`ease` 是默认曲线，不是项目曲线 |
| 弹窗入场 | `dam-modal-in .26s cubic-bezier(.22,.8,.2,1)` `:1477` | `dam-modal-in var(--dam-dur-fast) var(--dam-ease-out)` | 意图=「弹窗打开」= `--duration-fast` 250ms |
| 日期格 hover 过渡 | `transform .18s ease, border-color .2s ease, background .2s ease, box-shadow .2s ease` `:1473` | `transform` 那条改 `var(--dam-dur-quick) var(--dam-ease-out)`；三个颜色属性**不动** | 悬停**进**要快而直接（`--duration-quick` + smooth-out）；配色类过渡没有对应 token（`emil-design-eng` 归为 `ease`），按"乱改比不改更糟"保持原样 |
| 日期格 hover 位移 | `translateY(-1px)` `:1474` | **不动** | 见 §3.6 |

### 1.5 页签与交互反馈

| 动效点 | 现状（file:line） | 建议 | 理由（用途） |
|---|---|---|---|
| 页签（**浮层内**） | `[data-dam-tab] { transition: color .25s ease, background .25s ease, opacity .25s ease, transform .25s ease }` `:1426` | 四条都改 `var(--dam-dur-quick) var(--dam-ease-out)` | 同一个控件此前**两种手感**：会话页内走 `[data-dam-page] [data-dam-tab]` 的 150ms smooth-out（`:1407`，特异性更高），浮层内走 `.25s ease`。悬停/按压要「快而直接」⇒ 统一到 `--duration-quick` |
| 页签条 | `transition: transform .42s …` + `will-change: transform` `:1425` | **不动** | 死声明，见 §3.3 |
| 页签/按钮按压 | `:active { transform: scale(.97) }` `:1410` | **不动** | §3.4 |
| 页签选中态 | `translateY(-1px)` `:1430` | **不动** | §3.5 |

### 1.6 可达性（`prefers-reduced-motion`）

| 动效点 | 现状（file:line） | 建议 | 理由（用途） |
|---|---|---|---|
| 减动效闸门 | 两处（`:1415-1418`、`:1468-1471`）共覆盖 8 个选择器 | **补第二道闸门**覆盖其余全部动效 | 每个动效都要有闸门是 token 表 §2 的硬要求。**现有漏网**：浮层 `dam-in/dam-out`、日历容器/事件/弹窗、日历格 hover、`[data-dam-btn]` hover、页签选中 `translateY`、折叠标题与箭头、左侧栏按钮、保存条、页签箭头 |
| token 作用域 | 只在 `[data-dam-page]` | 新增 `[data-dam-panel], [data-dam-page]` 联合声明 | §0.2：浮层取不到变量 ⇒ 无法用 token |

---

## 2. 为什么现在的动画显得矛盾（根因）

三条独立缺陷叠加。**每一条都有代码证据**，不是推断；推断部分已单独标注。

### 2.1 嵌套双重入场：容器与卡片同时在动（主因）

证据链：

1. `MemoryPageView` 渲染 `h('div', { 'data-dam-page': '' }, …, h('div', { 'data-dam-body': '' }, body))` —— `lib/client.js:4769`、`:4799`。
2. `body` 来自 `MemoryTabBody(tab, nonce)`（`:4762`）；其中 6 个页签分支的返回值是 `h('div', { 'data-dam-flow': '' }, rows)` —— `:3258`、`:3545`、`:3635`、`:4064`、`:4121`、`:4150`。
   ⇒ **`[data-dam-flow]` 是 `[data-dam-body]` 的直接子元素**。
3. 于是它同时命中两条规则：
   - `[data-dam-page] [data-dam-body] > *` → `dam-page-in`，250ms，`translateY(6px)`（`:1391-1392`）
   - 它内部的 `[data-dam-flow] > [data-dam-card]` → `dam-card-in`，400ms + 错开，`translateY(8px) scale(.988)`（`:1398-1405`）

两者都是 **transform 入场**，且都从 t=0 开始。卡片的实际屏幕位移 = 容器位移 + 自身位移：**t=0 时是 6+8 = 14px**。而两条曲线的时长不同（250 vs 400ms）、错开的卡片还要再加 40~200ms ⇒ 容器早在 250ms 就停稳，卡片还在动到 450~600ms。**任何一帧都不是静止的**，读起来就是"画面在抖/糊"。

`apple-design` §7 的判据：一条路径上只该有一个运动来源；`transitions-motion` §2 的「一个动作只有一个主角」是同一句话。修复=把入场责任**只留给卡片**。

### 2.2 `dam-card-in` 漏写 `animation-fill-mode` ⇒ 延迟期闪白（最刺眼，也最可能是用户说"非常奇怪"的直接来源）

`lib/client.js:1399`：

```
'  animation: dam-card-in var(--dam-dur-slow) var(--dam-ease-out); }',
```

没有 `both`。而 `:1401-1405` 给第 2~6 张卡片加了 `animation-delay: 40/80/120/160/200ms`。

`animation-fill-mode` 默认值是 `none`，含义是**延迟期内动画对元素样式不产生任何影响** ⇒ 延迟期的卡片按正常样式渲染 = `opacity: 1; transform: none`，也就是**完全可见**；延迟一到，才跳到 `from { opacity: 0; translateY(8px) scale(.988) }` 再淡入。

**结果：第 1 张（无延迟）正常淡入；第 2~6 张"先闪一下 → 突然消失 → 再淡入"。** 每次切页签重播一次。

**这不是有意设计**——同一个文件里 `dam-rise` 就写了 `both`（`:1466`、`:1472`），三个 `animation:` 里只有这两条新加的漏了。同一族写法不一致，属漏写。

### 2.3 同一类元素三种入场时长（"矛盾"的字面来源）

CSS 选择器特异性 + 位置，让同一张 `[data-dam-card]` 走三条不同规则：

| 卡片所在位置 | 命中的规则（特异性） | 生效时长 |
|---|---|---|
| `[data-dam-body]` 直接子元素 | `[data-dam-page] [data-dam-body] > *`（0,2,0）`:1391` | **250ms** |
| `[data-dam-flow]` 直接子元素 | `[data-dam-page] [data-dam-flow] > [data-dam-card]`（0,3,1）`:1398` | **400ms + 延迟** |
| 更深一层（如包在 `[data-dam-section]` 内，日志卡片正是如此） | `[data-dam-card]`（0,1,0）`:1466` | **340ms** |

三层特异性把"同一族卡片"切成三种节奏。这是三个批次各自加规则、从未对齐的结果，也是"删了又加造成矛盾"的机制性解释。

### 2.4 手风琴：三个数同跑 + JS 提前 60ms 拆 DOM

- `:1463` 一条 `transition` 里有 **三个不同时长**：`max-height .32s` / `opacity .2s` / `transform .28s`。token 表把"手风琴"明确列为**对称例外**（同长度同缓动，两边不许拆）。
- `:2754` 关闭时 `setTimeout(…, 260)` 后 `setShown(false)` 把节点从 DOM 移除，而 CSS 的 `max-height` 过渡是 **320ms** ⇒ **在还剩 60ms（19%）时整块被拆掉**，收尾被硬切。这是"关得不利落"的成因。
- 另：`:1464` 的展开终态是 `max-height: 1800px`，而实际内容通常只有几百 px ⇒ 感知高度在前 1/6 就基本走完，后半段等于空转，读起来像"弹一下然后不动"。
  `transitions-motion` 的手风琴配方用 `grid-template-rows: 0fr ↔ 1fr` 正是为了消掉这个错配。**但改它需要在 DOM 里加一层 inner 包装**（配方有 `.t-acc-panel-inner`），改动面超出"动效参数"范畴 ⇒ **本批不动结构，只对齐时长**（记入 §4 待办）。

### 2.5 次要项（一并记录，已在 §1 修掉）

- 浮层关闭用 `ease-in`（`:1311`）—— 起步最慢，取消动作最不该用。
- 页签在浮层/会话页两种手感（`:1426` vs `:1407`）。
- 减动效闸门漏 10 处（§1.6）。

---

## 3. 刻意没动的动效（逐条给不动的理由）

`transitions-motion` §4 的原话是「这一点比建议本身更重要——**乱改比不改更糟**」。判据用的是 §1 token 表的「**用途匹配不上任何 token，就不要动它**」。

### 3.1 浮层打开的过冲曲线 `cubic-bezier(.2,.9,.3,1.15)`（`:1308`）

**用途**：弹窗/浮层的**进入**。token 表 §2 明写「过冲曲线只属于『进入』……**永远不要给关闭加回弹**」。这条正是进入，曲线合法（形态接近 `--ease-bounce` `cubic-bezier(.34,1.36,.64,1)`）。
⇒ **曲线保留**，只把不在刻度上的 `200ms` 换成 `--dam-dur-fast`。`transform-origin: left bottom` 也保留——浮层常驻左下角，原点就该在左下方（`apple-design` §7「锚定到来源」；只有模态框才该居中）。

### 3.2 手风琴的 JS 卸载计时 `setTimeout(…, 260)`（`lib/client.js:2754`）

**用途**：等 CSS 过渡跑完再拆 DOM。原来是错配（260 < 320ms），但**改 CSS 到 250ms 后 260ms 就是正确值**（余量 10ms）。
⇒ **不动**。在这里改 JS 反而会把"修 CSS 顺带修好"变成两处都要维护。

### 3.3 页签条的 `transition: transform .42s` + `will-change: transform`（`:1425`）

**证据（已核实为死声明）**：全文件只有 3 处提到 `data-dam-tab-strip` —— CSS 定义（`:1425`）、减动效闸门（`:1468`）、JS 创建该 div（`:4714`）。滚动是**父容器原生滚动**驱动的：`vp.scrollTo({ left, behavior: 'smooth' })`（`:4704-4705`）与 `vp.scrollBy(…)`（`:4710`），**从来没有代码写过这个 div 的 `transform`**。
⇒ 这条 `transition` 目前的视觉效果是 **0**（没有任何东西改变它的 transform）。

**为什么不删**：删它对本轮"动画奇怪"的问题**没有任何贡献**，却存在两类风险——(a) 未来可能有人把滚动改回 transform 驱动，删了就得重加；(b) 用户级硬规则要求"不得删除既有动画或视觉表现"，而这条属于"无视觉表现"的边缘情况，不值得为它承担争议成本。
⇒ **保留原样**。同时把发现写进补丁的注释（`// 死声明`），供后续单独决策。**若将来要动**：`will-change` 常驻在一个永久挂载的元素上会一直保留一个合成层，属纯开销，这才是它的唯一实际代价。

### 3.4 页签/按钮按压 `:active { transform: scale(.97) }`（`:1410`）

**用途**：按压反馈。取值落在 `emil-design-eng`「Buttons must feel responsive」与 `apple-design` §1（响应必须在 pointer-down、即时）的区间内（0.95–0.98），且已是 `--dam-dur-quick`。
⇒ **不动**。

### 3.5 页签选中态 `translateY(-1px)`（`:1430`）

**用途**：选中态的**静态**视觉表达（"选中项抬起一点"），不是过渡动画。token 表的距离刻度 `--distance-micro 4px` 以下是留给文字切换的，没有 1px 级别的"静态偏移"token。
⇒ **用途匹配不上任何 token ⇒ 不动**。

### 3.6 日历日期格 hover `translateY(-1px)`（`:1473-1474`）

同 §3.5：1px 是静态微位移而非过渡刻度，用途匹配不上 token。
⇒ **不动**。（其 `transition` 里的 `.18s ease` 已按 §1.4 对齐到 `--dam-dur-quick`，位移值本身不变。）

### 3.7 卡片入场的 `scale(.988)`（`dam-card-in` 的 `from`，`:1400`）

token 表的缩放入口全部是**表面**（弹窗 `--scale-large 0.96`、下拉 `--scale-medium 0.97`、tooltip `--scale-small 0.98`）——那类"从一个触发器长出来的面"。
一张 380px 宽的网格卡片不是表面，**用途匹配不上任何 `--scale-*` token** ⇒ 按判据 **不动**。（它确实会迫使合成器对卡片文字重新栅格化，但那是可优化项不是本轮问题，删它属未经确认的减法。）

### 3.8 加载旋转 `dam-spin`（`:1492-1493`）

**用途**：加载指示，恒定运动。token 表 `--ease-linear` 的用途正是「加载旋转」，`linear` + `infinite` 正确。
⇒ **不动**。（`emil-design-eng` 提到"转得更快的指示器让加载显得更快"，但改转速会偏离"统一到 token"的目标，且没有 token 值支撑。）

### 3.9 首启引导向导整套（`data-dam-tour-*`、`dam-bokeh-*`、`dam-slab-*`、`dam-tile-*`、`dam-art-*`、`dam-stage-float`、`dam-page-flip`、`dam-radar-spin` 等，`:1496-1630`）

**用户明确要求不要动**。且按 `animate` 的频率分层，这些是「Rare / first-time（onboarding, celebration）」——**"the delight budget lives here"**，`--duration-very-slow 500ms` 及更长（`.55s`/`.62s`/`1.7s`）的预算正属于这一层。
⇒ **完全不动**。

### 3.10 看板自身的 zoom 与列宽（`data-dam-graph` 及其 SVG 尺寸，`:1448-1451`）

**用户明确要求不要动**。且它由 JS 几何状态驱动（可拖动/缩放），属直接操控（`apple-design` §2 1:1 tracking）而非入场动效。
⇒ **完全不动**。

### 3.11 更新揭幕 `dam-update-intro` / `dam-update-content-in`（`:1675-1689`）

**用途**：版本更新的**一次性**揭幕（1.7s 编排：logo 展开 → 内容揭示 → 模糊淡出）。频率=每次发版一次 ⇒ rarity 最高的一档，`both` 已写对，且没有与其它动效嵌套。
⇒ **不动**。

### 3.12 `[data-dam-tab][data-active]`、`[data-dam-fold]` 的箭头旋转、`[data-dam-savebar]` 等的过渡

`dam-fold-caret` 的 `transform` 旋转（`:1369-1370`）已是 `var(--dam-dur-fast) var(--dam-ease-inout)`，**用途=图标切换 → `--ease-in-out` 正是 token 表给它的曲线**，已正确。
⇒ **不动**（只把它们纳入 §1.6 的 reduced-motion 闸门）。

---

## 4. 自检、验收与遗留待办

### 4.1 硬验收（补丁脚本自动执行）

| 检查 | 判据 |
|---|---|
| `node --check lib\client.js` | 退出码 **0** |
| bare LF 计数 | **0**（本仓纯 CRLF） |
| 锚点命中数 | 每条 **=== 1**，不为 1 在写盘**前** throw |
| `replaceBlock` 自检 | 锚点原文每一行要么逐字仍在、要么在 `INTENDED_CHANGES` 里显式声明被有意改写的理由 |
| 候选文件 | 先写 `.vision-tmp/_cand.js` 并 `node --check`，通过才写 `lib\client.js` |
| 幂等 | 第二次执行检测到已应用的标记（`--dam-dur-stagger`）⇒ **明确拒绝**，不写盘 |
| SHA256 | 打印前后值，便于回滚比对 |
| 全量回归 | `node tools/run-smoke.mjs` → **FAIL 0 / TIMEOUT 0**；基线（补丁前实测）= PASS 157 / FAIL 0 / TIMEOUT 0 |

### 4.2 需要**人眼**确认的项（脚本证明不了）

`animate` 的 Output 纪律要求点出"代码里判断不了、只能靠感觉核对"的部分：

1. **延迟期闪白是否真的消失**（§2.2）——调 DevTools 的 Animations 面板，把播放速度降到 10%，看第 2~6 张卡片在 40~200ms 区间是"一直半透明"还是"先实心再跳空"。这是本轮最该验的一条。
2. **嵌套感是否消失**（§2.1）——慢放看切页签瞬间：应当只有卡片在动，`[data-dam-flow]` 容器本身**不动**。
3. **手风琴收尾是否还硬切**（§2.4）——连点开合，看闭合末段有没有"啪一下消失"。
4. **手感复核**——按 `emil-design-eng`「Review your work the next day」，第二天用新鲜眼睛再看一遍。

### 4.3 遗留待办（本批**故意不做**，需单独拍板）

| 待办 | 为什么本批不做 | 建议的下一步 |
|---|---|---|
| 手风琴改 `grid-template-rows: 0fr ↔ 1fr` | 需要在 DOM 加一层 inner 包装（配方 `.t-acc-panel-inner`），改动面从"参数"变成"结构 + JS"，超出动效参数批的边界 | 单独一批：改 `AnimatedDisclosure`（`lib/client.js:2739-2760`）的返回结构 + 三条 CSS；同时消掉 `max-height: 1800px` 的空转 |
| `[data-dam-tab-strip]` 的死声明清理 | 见 §3.3 | 单独确认"滚动是否永远走原生"后再删 |
| 卡片入场去掉 `scale(.988)` | 见 §3.7（用途匹配不上 token） | 若确认要优化合成开销，另开一批 |
| `[data-dam-disclosure][data-phase="open"] { max-height: 1800px }` 换成按内容测高 | 同上（结构改动） | 与手风琴那批一起做 |

---

## 5. 补丁脚本 ↔ 规格 对应表

`.vision-tmp/patch-motion.cjs` 的执行步骤（编号与脚本输出一致）：

| 步 | 动作 | 对应规格 | 锚点（内容锚定，全部命中数 === 1） |
|---|---|---|---|
| [1] | 新增 token 联合作用域声明 | §0.2、§1.6 | `var CSS = [` 之后插入 |
| [2] | 浮层关闭曲线 | §1.1 | `[data-dam-panel][data-closing="true"] { animation: dam-out .16s ease-in both; }` |
| [3] | 浮层打开刻度化 | §1.1 | 同上块内的 `animation: dam-in .2s …` 行 |
| [4] | 主体入场排除 flow 容器 + 补 `both` | §1.2、§2.1、§2.2 | `[data-dam-page] [data-dam-body] > * { animation: dam-page-in …` |
| [5] | 卡片流入场 250ms + `both` + token 错开（8 行块替换） | §1.2、§2.2、§2.3 | `[data-dam-page] [data-dam-flow] > [data-dam-card] { grid-column: auto;` … `:nth-child(n+6)` |
| [6] | **把入场责任从容器移交给流内子元素**（`[data-dam-flow] > *` 接上同一入场） | §1.2、§2.1 | `[data-dam-page] [data-dam-flow] > * { grid-column: 1 / -1; min-width: 0; }` |
| [7] | `dam-rise` 刻度统一（卡片/横幅） | §1.2、§2.3 | `[data-dam-card], [data-dam-banner] { animation: dam-rise .34s …` |
| [8] | `dam-rise` 刻度统一（日历容器） | §1.2、§2.3 | `[data-dam-calendar] { animation: dam-rise .34s …` |
| [9] | 手风琴三数归一 250ms | §1.3、§2.4 | `[data-dam-disclosure] { overflow: hidden; opacity: 0; max-height: 0; …` |
| [10] | 日历事件入场 + hover 150ms | §1.4 | `[data-dam-calendar-event] { animation: dam-event-in .25s …` |
| [11] | 日历日期格 hover 过渡（只动 `transform` 那条） | §1.4、§3.6 | `[data-dam-calendar] [data-dam-calendar-day] { transition: transform .18s ease, …` |
| [12] | 日历弹窗 260ms → 250ms | §1.4 | `[data-dam-calendar-modal] { animation: dam-modal-in .26s …` |
| [13] | 页签统一 150ms | §1.5 | `transition: color .25s ease, background .25s ease, opacity .25s ease, transform .25s ease;` |
| [14] | 补第二道 reduced-motion 闸门 | §1.6、§3.9、§3.10 | `[data-dam-update-content] { opacity: 1 !important; … } }` 之后插入 |
| [15] | 死声明注释 | §3.3 | `[data-dam-tab-strip] { display: flex; …` 之前插入注释 |

> **[6] 为什么必须有**：容器不再入场之后，`[data-dam-flow]` 内部的**非卡片子元素**（日志折叠块等 `[data-dam-section]`）会跟着一起失去淡入 —— 那就变成"删动画"了。
> 这一步把入场**从容器下移到它的直接子元素**（卡片与非卡片都吃到，同一 250ms 刻度；卡片另有 40ms 错开），
> 既消掉嵌套叠加，又**保住原有视觉覆盖**。这条遵守用户级硬规则「不得删除既有动画或视觉表现」。

## 6. 条目计数（自查）

| 范围 | 条数 | 说明 |
|---|---|---|
| §1 各表合计 | **24 行** | §1.1=2、§1.2=7、§1.3=4、§1.4=5、§1.5=4、§1.6=2 |
| ↳ 其中「建议改动」 | **19 条** | §1.1=2、§1.2=7、§1.3=3、§1.4=4、§1.5=1、§1.6=2 |
| ↳ 其中「不动」交叉引用 | 5 条 | 指向 §3.2/§3.3/§3.4/§3.5/§3.6，不重复计数 |
| §3 刻意不动 | **12 条** | §3.1–§3.12（§3.12 内含 2 项已正确、无需改的） |
| **去重后动效点合计** | **31 个** | = 19 建议改动 + 12 刻意不动 |

（完）

