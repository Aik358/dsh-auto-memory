# 前端照搬原型 · 差距实测与移植方案（E 批）· 2026-10-25

> 用户 2026-10-25 原话：「前端的视觉效果还是不完整…如果能够照搬 prototype 的 HTML 的表现方式就照搬，不要自创，可以加一些可调的元素，比如这两个栏可以调小或增大，或者页面可以左拉右拉。但是最好还是基于 prototype 来做，因为现在的白板看板非常不清晰，也看不出任何有用的信息」
>
> 本文所有数字均为**实测**（脚本见 §7），不是估计。

---

## §0 · 结论先说

**当前的「事件视图」不是原型的简化版，是另起一套。** 它和原型之间几乎没有共享的视觉资产：

| 量 | 原型 | 当前 `client.js` |
|---|---|---|
| CSS 规则 | **412 条 / 45,953 B / 655 行 / 14 个分节** | 事件视图**零专属 CSS**（全部写成 30 个内联 `style:{}` 对象） |
| class 选择器 | 176 个 | **176 个里被复用 0 个**（严格按 className 字面量比对） |
| 运行时函数 | 80 个（rail / card / detail / lanes / workflow / spring / theme / fs / lazy / 深链） | 事件视图 775 行，缺 9 项能力（§2） |
| 暗色 | `html[data-theme="dark"]{...}` 21 个 token 覆盖 | **无暗色分支**：`--dam-card-bg:#fff`、`--dam-text:#1f2937` 写死 |

**「非常不清晰」有可复算的原因**：`--dam-text: #1f2937` 压在本机暗色底 `#151b26` 上，对比度 = **1.18:1**（WCAG AA 要求 4.5:1）。用户截图里那些几乎看不见的浅灰文字就是这个值。原型暗色正文实测 **14.3:1**。

---

## §1 · 移植可行性已用 POC 验证（真 Chrome 真点击）

已产出可运行的照搬版：`artifacts/ev4-poc/index.html`（2,603,032 B，单文件，内嵌真实 185 事件语料）。

做法只有三条机械变换，**没有任何重写**：

1. **CSS 作用域化**：`:root{...}` → `.ev4-app{...}`；`html[data-theme=dark]` → `.ev4-app[data-theme=dark]`；`body.rail-open` → `.ev4-app.rail-open`；`*{box-sizing}` → `.ev4-app,.ev4-app *`。共 12 处替换，**剩 0 处全局选择器**。
2. **rem 因子化**：原型字号档位靠 `html{font-size:15/16/17.5px}`，作用域化后全局 `html` 不再生效 ⇒ 11 处 `rem` 改为 `calc(var(--ev4-root-fs) * N)`（N 为原 rem 数值，**不再除 16**）。
3. **JS 宿主绑定**：`document.documentElement.dataset.X` → `app.dataset.X`；`document.body.classList` → `app.classList`；localStorage 前缀 `wbEvt.` → `damEv4.`。共 5 处。
4. **数据入口**：`JSON.parse(#payload)` → `window.__EV4_DATA__`。

### POC 实测（headless Chrome + CDP，1600×1000）

| # | 能力 | 实测值 |
|---|---|---|
| 1 | 三栏骨架 | `336px 872px 392px`，rail 336 / detail 392 |
| 2 | 时间流初始窗口 | 卡片 **36** 张 / 时间轴刻度 **185** 个（懒加载只作用于卡片端） |
| 3 | 泳道/甘特 | 行 **127** / 段 **124** / 单点 **31** |
| 4 | 工作流线索 | 组 **37** / 行 **163**（主线折叠） |
| 5 | 右栏收起 | `grid→336px 1264px 0px`，右栏实测宽 **0px** |
| 6 | 主题三态 | dark bg `rgb(10,13,20)` → light bg `rgb(244,246,249)`，卡片 `rgb(251,252,254)` |
| 7 | 字号三档 | 卡片标题 **13px → 14.2188px**（与原型 VERIFY.md「16px档=13px / 17.5px档=14.2188px」**逐值一致**） |
| 8 | 懒加载 | 36 → **60**，「已载 60 / 185」 |
| 9 | 搜索过滤 | 输入「ZCode」→ 全量 185 中**可见 2**，计数「2 / 185」 |
| 10 | 深链 | `#evt-050` → `curId=evt-050`，选中 1 张卡 |
| 11 | 窄屏 480 | rail/detail 都变 `position:fixed`，无水平滚动 |
| 12 | **★新增：左栏可拖** | 拖动手柄 336 → **436**（+100px），落 localStorage |
| 13 | **★新增：双击复位** | 回 **336** |
| 14 | **★新增：键盘可达** | 分隔条 focus 后 ←→ 每次 24px |

截图 9 张：`poc-01-stream` / `02-workflow` / `03-lanes` / `04-detail` / `05-detail-collapsed` / `06-light` / `07-filter` / `08-narrow` / `09-grip-wide-rail`。

---

## §2 · 当前实现缺的 9 项（逐项可复算）

| # | 原型能力 | 当前状态 | 取证 |
|---|---|---|---|
| 1 | **左轨时间轴**（月份 sticky + 日密度柱 + 事件间 >2h 轨道断开 + 今天锚点 + scroll-spy） | **完全没有** | `rail-axis` / `msep` / `mdens` / `rail-today` 在 `client.js` 中 0 次 |
| 2 | **三态宽窄卡**（narrow ≤1 点 / medium 2–3 / wide ≥4） | 没有，全是一个尺寸 | `ticketOf` 0 次 |
| 3 | **顶栏**（视图药丸滑动 + 字号档 + 主题三态 + 统计 chips） | 只有 3 个裸按钮 | `vswitch`/`fsctl`/`themebtn`/`chips` 0 次 |
| 4 | **暗色主题** | **缺**，且当前浅色 token 直接把暗底文字打到 1.18:1 | `--dam-card-bg:#fff` 写死；`prefers-color-scheme` 在 CSS 分节里 0 次 |
| 5 | **搜索/过滤** | 没有 | `data-dam-search` 只在未接线的看板工具栏里 |
| 6 | **全部展开 / 全部折叠** | 没有 | `全部展开` 0 次 |
| 7 | **「最新 · 时间 · 共 N 个事件」end-mark** | 没有 | `end-mark` 0 次 |
| 8 | **★右栏内容**（六格 panels + 检查点时间轴 + 空档行） | **恒空** | `API.eventDetail` 调用 **0 次**：`/event-list` 不返回 `checkpoints`，右栏却从 list 形状里读 `checkpoints` ⇒ 永远走「该事件暂无检查点」分支 |
| 9 | **深链 `#evt-xxx`** | 没有 | `location.hash` 0 次 |

### §2.8 是「功能缺陷」不是「视觉问题」

本机真实数据：唯一事件 `evt_dfc30819` 有 **74 个检查点 / 28 个带 panels**。
- `GET /event-list?all=1` 返回键：`id,name,summary,status,sections,updatedAt,checkpointCount,userPercept,agentTrace,sharedGround,commitments,panelDigest` —— **无 checkpoints**。
- 前端 `renderDetailPanePre` 读的是 `e.checkpoints` ⇒ 恒 `[]` ⇒ 用户点开任何事件都看到「该事件暂无检查点」。
- 用户截图右栏显示「**该事件暂无检查点**」，与这条完全吻合。

---

## §3 · 移植方案（E 批，5 个可独立验收的步骤）

原则：**照搬原型，不自创**。唯一新增是用户点名的「两栏可调」+ 键盘可达。

| 步 | 内容 | 产出判据 | 风险 |
|---|---|---|---|
| **E1** | 作用域化 CSS 注入：`EV4_CSS`（原型 655 行，`:root`→`.dam-ev4`）+ 三栏骨架 `.dam-ev4 .layout` | 412 条规则全在；0 处全局选择器；真 Chrome 三栏实测 336/872/392 | 低（纯新增 CSS，不动既有 `--dam-*`） |
| **E2** | 左轨时间轴（照搬 `renderRail` 的 8 个子结构） | 刻度数 = 事件数；月份分隔数 = 数据月份数；空档断口数 = `>2h` 对数（负路径：无空档则 0） | 中（滚动/spy 需 DOM） |
| **E3** | 中栏：三态卡 + end-mark + 懒加载条 + 搜索过滤 + 倒序贴底 | 36→60 增量；过滤后可见数 = 真命中数；贴底差 ≤5px | 中 |
| **E4** | **右栏取真数据**：选中 → `apiGet(API.eventDetail,{id})` → 六格 panels + 检查点时间轴（默认全折叠）+ 空档行 + 全部展开/折叠 | 74 检查点全渲染；默认 `closed=74`；展开后 `panels>0` | **高（这是真 bug 修复）** |
| **E5** | 顶栏：视图药丸 + 字号三档 + 主题三态 + chips；**新增两条可拖分隔条** | 字号 16→17.5 实测变化；主题 bg 实测换色；拖动 +100px 生效且持久化 | 中 |
| **E6** | 暗色 token 修正：`.dam-ev4[data-theme=dark]` 覆盖原型那 21 个 token，**不碰全局 `--dam-*`** | 暗色正文对比度 ≥4.5:1（原型实测 14.3:1）；浅色不受影响 | 低 |

依赖：E1 → (E2/E3/E5 并行) → E4 → E6。

---

## §3.5 · 移植过程踩到的两个「静默白屏」坑（都会让人以为是自己写错了）

| # | 现象 | 根因 | 判据 |
|---|---|---|---|
| 1 | 页面只有静态骨架，**0 张卡片、0 个刻度、`window.__wb` 为 undefined** | `events.json` 里含 **1 处 `<!--` 字面量**（PLAN 锚点注释）。原样内联进 `<script>` 会让 HTML 解析器进入 **script-data-escaped** 态，**吞掉后面的 `<script>` 开始标签** ⇒ 整段运行时脚本降级成文本节点。**`node --check` 全绿、脚本语法完全正确**，所以看不出问题 | 内联 JSON 必须 `.replace(/</g, '\\u003c')`；构建自检里断言 0 处未转义 |
| 2 | 字号档位「点了没反应」，实测 `13px → 0.8125px` | `rem → calc()` 转换时**把已经是 rem 单位的数值又除了一次 16** | 改成 `calc(var(--ev4-root-fs) * 0.8125)`；自检断言 `--ev4-root-fs` 有定义且有 >5 处使用 |

第 1 条尤其值得记：它让「照搬原型」看起来像「原型的代码跑不起来」，实际只是数据里一段注释文本。

## §4 · 与现有实现的关系（不推倒重来）

- **保留** `EventCard`/`EventView` 的**数据通路**（`/event-list` + `/event-unarchived`）与既有 `data-dam-*` 锚点（套件依赖它们）。
- **替换** 渲染层：内联 `style:{}` → 原型 class。每步都保留 `data-dam-*` 锚点，避免 245 条断言集体失效。
- **禁止**整块替换 `client.js`（用户 2026-10-01 硬规则）。
- `iter5` 生成区（L11655–L14128）**不在本次改动范围内** —— 事件视图全在生成区之外（L5328–L6102）。

---

## §5 · 新增的可调元素（用户点名）

| 元素 | 交互 | 实现 |
|---|---|---|
| 左栏 | 中栏 分隔条 | 拖动改 `--rail-w`；双击复位 336；键盘 ←→ ±24px | `.ev4-grip--rail`，`pointerdown/move/up` + `setPointerCapture` |
| 中栏 | 右栏 分隔条 | 拖动改 `--detail-w`；双击复位 392 | `.ev4-grip--detail` |
| 持久化 | `damEv4.railW` / `damEv4.detailW` | localStorage，非法值回落默认 |
| 边界 | rail 180–560 / detail 240–1100 | `clamp()`，**防拖成 0 宽不可恢复** |
| 窄屏 | <1024 隐藏分隔条（改为抽屉） | `@media` |

---

## §6 · 验收判据（每条都要能变红）

1. **规则数**：`EV4_CSS` 里 `{` 计数 = 412 ± 0（原型实测），`:root` / `html{` / `body{` 出现 0 次。
2. **真渲染**：headless Chrome 打开后 `document.querySelectorAll('.dam-ev4 .card').length` = 36（初始窗口）。
3. **右栏真数据**（E4 核心）：选中有 74 检查点的事件 ⇒ `.cp` 节点数 = 74，默认 `.cp.closed` = 74；**负路径**：`/event-detail` 404 时降级文案出现且不白屏。
4. **对比度**：暗色下取 `.card .ttl` 的 color/bg，按 WCAG 公式算 ≥4.5:1。
5. **字号**：点 A+ 后 `getComputedStyle(`.card .ttl`).fontSize` 从 16px 变 17.5px（**不是**「源码里有 data-fs」）。
6. **可调栏**：模拟 pointerdown/move/up 后 rail 宽度 +100px；localStorage 写入；双击回 336。
7. **既有套件不倒**：`v4-h4-eventcard-percept` 245 条、`r10-block-consume-b` 10 种 block 覆盖、`client-loadable` 17 条全绿。

---

## §7 · 复算方式

```bash
# POC 重建（作用域化 + 可调栏 + rem 因子化）
node artifacts/ev4-poc/_build.mjs
# POC 真浏览器 14 项验收（headless Chrome + CDP，零第三方依赖）
node artifacts/ev4-poc/_verify.mjs
```

原型抽取物：`artifacts/wb-event-preview/extract/{prototype.css,prototype.js,prototype-body.html}`（未做任何人工改写）。
