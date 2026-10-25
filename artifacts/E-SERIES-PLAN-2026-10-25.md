# E 系列执行计划 · 前端照搬原型（durable · 每步完成后就地更新）

> **本文件用途**：上下文压缩后的**唯一执行依据**。每次开工先读本文件；每完成一步更新对应行的状态与实测值。
> 建立于 2026-10-25 14:55，与 `handoff/PLAN.md`（项目全貌）互补：PLAN 讲「为什么/全貌」，本文讲「E 批每一步怎么验」。
> 设计真源：`artifacts/wb-event-preview/{index.html, VERIFY.md, extract/}`（**不得凭记忆自创**）。

---

## §0 · 一句话现状

后端线全部收口（六段判据 ①–⑤ ✅）。**前端线 E 批 7 步：E1 ✅ · E7 ✅ · E2 ✅ → E3 → E4 → E5 → E6。**

| 步 | 内容 | 状态 | 关键实测 |
|---|---|---|---|
| **E1** | 412 条 CSS 作用域化注入 | ✅ **完成** | 规则 412 === 原型 · 裸选择器 **0** · keyframes 全 `ev4-` · 套件 **78/0** |
| **E7** | 白板看板全屏铺满 | ✅ **完成** | 高度 24px(3%) → **800px(89%)** · composer 隐藏 · 切回对话恢复 · 21/0 |
| **E2** | 左轨时间轴 | ✅ **完成** | 刻度 === 事件数 · `ev4ShapeOf` 单独可测 · 空档负路径 · 56/0 |
| **E3** | 中栏：三态宽窄卡 + end-mark + 懒加载 + 过滤 + 倒序 | ✅ **完成**（语义层；DOM 层待 E5 接） | 分档 0/1⇒narrow·2/3⇒medium·4/9⇒wide · narrow 零 badge · 套件 **64/0** · eventcard 245/0 未受影响 |
| **E4** | 右栏取真数据（★真 bug） | ✅ **完成** | 三处互证闭链 → 拉 /event-detail；时序守卫 + 两种降级文案区分；真 HTTP mock server；**35/0** |
| **E5** | 顶栏 + 两栏可拖 | ✅ **完成** | 左 336→436 / 右 392→292 / clamp 180·560 / 双击复位 / 键盘±24 / 窄屏隐藏；真 Chrome **20/0**；字号 13→**14.2188px**；主题 rgb(10,13,20)↔rgb(244,246,249) |
| **E6** | 暗色 token | ✅ **完成** | token **38 个**（E1 时已抄入）· 暗色 **14.30:1**（手算）/ 16.11:1（真 Chrome）· 浅色 16.75:1 · 全局 6 采样点零污染 · 真 Chrome **31/0** |
| — | **E 批全量回归** | ✅ **482 PASS / 0 FAIL / 0 TIMEOUT（162.2s）** | Lead 独立复跑确认；verify-docs 20/77/163 · SYNC-OK |

---

## §1 · 全局纪律（每步都适用）

1. **串行**：7 步全改 `lib/client.js` 同一文件，**禁止并行写**。
2. **改生成区必须改源**：client.js 生成区 = `L12419–L14892`（LEGACY，内嵌 ITER5 `L12425–L14887`）+ `L14893–L18292`（外挂 ITER5）。落在区间内 ⇒ 改 `skins/iter5/{views,surfaces,ui,native-panel}.js` 或 `skins/legacy/iter5-325.js.frozen`（LF），再 `node tools/build-iter5-skin.mjs`。**EventView / EventCard 在区外**。
3. **每步固定六验**：`node --check` → 真 factory `client-loadable`（17/0）→ 本步新套件 → 既有套件 → `build-iter5-skin --check --strict` = SYNC-OK → 纯 CRLF / bareLF 0。
4. **判据必须真执行**：不接受「源码含某字符串」。能变红才算。
5. **必须带负路径**：每个正向断言配一条「不该发生时」的断言。
6. **变量重命名**：`--dam-*` 全局 token **不准动**；E 批只用 `.dam-ev4` 作用域。

---

## §2 · 每一步的详细规格与验收

### E3 · 中栏（三态宽窄卡 + end-mark + 懒加载条 + 搜索过滤 + 倒序贴底）

**照搬原型**：`renderCard`(L317-375) / `loadBar`(L380-422) / `updateLmBar`(L431-453) / `rebuildStream`(L455-488) / `loadEarlier`(L490-545) / `anchorToNewest`(L547) / `applyFilterVisibility`(L1227-1248) / `onQuery`(L1249) / `ticketOf`(L149)

**做什么**

| 子项 | 规格 |
|---|---|
| 三态卡 | `ticketOf`：检查点 ≤1 = `narrow`（padding 9px 12px、字号 `--fs-xs`、max-width 82%）；2–3 = `medium`（11/13、94%）；≥4 = `wide`（13/15、100%） |
| 卡内 badges | 状态 + 账本类型 + 置信 + `N 检查点` + `空档 Xh`（按原型 `.meta` 顺序） |
| wide 专属 | `summary` / 成果列表（最多 2 条 + 「还有 N 项成果」）/ SKILL 状态 / `rationale` |
| end-mark | `最新 · YYYY-MM-DD HH:MM · 共 N 个事件` |
| 懒加载条 | sticky 头常驻「已载 X / 总 Y」+「↑ 加载更早 N 个」/「已到最早」(disabled) + 「全量渲染（关懒加载）」开关 |
| 加载更早 | **先记视口内第一张卡 `getBoundingClientRect().top`，插入后按 drift 二次回补 `scrollTop`**（原型判据位移 <2px） |
| 搜索 | 输入即筛，**过滤态临时全量渲染**，清空回窗口模式；计数「命中 / 总数」 |
| 倒序 | 进场 `scrollTop = scrollHeight`（两帧 + 140ms 兜底）；用户滚动后不再强制 |

**验收（每条必须能变红）**
1. 懒加载增量：36 → 60，卡片数同步，`已载 60 / 185`
2. **锚点位移 < 2px**（真 DOM 测，不是纯函数）
3. 过滤：输入关键词 ⇒ 可见数 === 现算命中数；清空 ⇒ 回 36
4. 贴底：`scrollTop + clientHeight >= scrollHeight - 5`；**负路径**：不可滚动容器返回 false
5. 到最早后按钮 `disabled` + 再滚 6 次加载次数不增
6. 三态卡：构造 1/2/4 检查点三种事件 ⇒ `narrow/medium/wide` 同时存在且宽度递增

---

### E4 · 右栏取真数据（★ 真 bug 修复，最要紧）

**真缺陷取证**（已实测，2026-10-25）
- 本机唯一事件 `evt_dfc30819` 有 **74 检查点 / 28 带 panels**
- `GET /event-list?all=1` 返回键：`id,name,summary,status,sections,updatedAt,checkpointCount,userPercept,agentTrace,sharedGround,commitments,panelDigest` —— **不含 checkpoints**（刻意设计，正文走 detail）
- 前端 `renderDetailPanePre` 却读 `e.checkpoints` ⇒ 恒 `[]` ⇒ **点开任何事件永远显示「该事件暂无检查点」**

**照搬原型**：`renderDetail`(L655-758) / `cpRow`(L619-653) / `renderPanels`(L597-618) / `countsOf`(L588)

**做什么**
1. 选中事件时 `apiGet(API.eventDetail, {id})` 拉完整事件（带缓存，避免重复拉）
2. 六格 panel 网格（state/log/dead/next/userPercept/commitment）—— 宿主 panels 只有 `{kind,text}`，**label 由 `PANEL_KIND_UI` 映射**；空值「（本期未填）」；条数在右上角；>3 条折叠「还有 N 条」
3. 检查点时间轴 `.dtl`（竖线 + 圆点），最上面一条 `.newest` 高亮
4. **检查点默认全折叠**，头部 = #序号 + 时间 + 来源 + 四格计数（现状 n / log n / 失败 n / 下一步 n）+ caret
5. 事件内 >2h 空档行「⏸ 搁置 X 小时 —— 起→止」
6. 「全部展开 / 全部折叠」+ 右上「空档 >2h N · 最长 Xh」
7. 四格 percept 概览（有值「N 条」，无值「本期未填」）
8. 来源清单 `.srcs`（最多 8 条 + 「还有 N 篇」）

**数据适配**：`ev4DetailShapeOf(detail)` 纯函数 —— 宿主 `{at(ms 数字), kind, text, sourceRef, panels[], idemKey}` → 原型 `{at(时间串), rel←sourceRef, ms←at, 四段数组从 panels 按 kind 拆}`。
**★注意 `panels[].kind`：宿主用 `deadend`，原型用 `dead`** —— 双向映射且写明注释（本仓纪律：命名不一致不得悄悄改一边）。

**验收**
1. 真事件 74 检查点 ⇒ `.cp` 节点 = **74**，默认 `.cp.closed` = **74**
2. 展开后该 cp 内 `.panel` 数 = 该 cp 的 panels 数（28 个带 panels 的逐一核）
3. **负路径**：`/event-detail` 404 ⇒ 降级文案出现且不白屏
4. **回归守卫**：`/event-list` 无 checkpoints 时**不得**再走「暂无检查点」分支

---

### E5 · 顶栏（视图药丸 + 字号三档 + 主题三态 + chips）+ ★两栏可拖

**照搬原型**：`prototype-body.html` 的 `.topbar` / `measurePill`(L1112) / `applyFontScale`(L1097) / `applyTheme`(L1069) / `cycleTheme`(L1086) / `syncViewChrome`(L1124)

| 子项 | 规格 |
|---|---|
| 视图切换 | `.vswitch` 滑动药丸（tabs-sliding），三档 stream/lanes/workflow，`localStorage damEv4.viewMode` |
| 字号 | `.fsctl` A- / A / A+（`--ev4-root-fs` 15/16/17.5），`damEv4.fontScale` |
| 主题 | `.themebtn` 三态 auto→light→dark；`dataset.theme` 永远是**可断言的** light|dark，`dataset.themeMode` 存原值 |
| chips | 文档 N / 事件 N / 检查点 N / 最大事件 N 点 / 单检查点占比 —— **数从 /event-list 现算，不写死 839/127** |
| **★两栏可拖** | 直接搬 `artifacts/ev4-poc/_build.mjs` 里的 `.ev4-grip` CSS + `mountGrips()`：左栏 180–560、右栏 240–1100；`pointerdown/move/up` + `setPointerCapture`；双击复位 336/392；键盘 ←→ ±24；`damEv4.railW`/`detailW` 持久化 |
| 窄屏 | <1024 隐藏分隔条（改抽屉） |

**验收**
1. 点 A+ 后 `getComputedStyle('.card .ttl').fontSize` 从 13px → **14.2188px**（**不是**查 `data-fs` 属性）
2. 主题切换后 body 计算背景 `rgb(10,13,20)` ↔ `rgb(244,246,249)`
3. 拖分隔条 rail 宽度 **+100px**、`localStorage` 写入、双击回 336、键盘 ←→ ±24
4. chips 数与 `/event-list` 现算一致
5. **负路径**：拖动到边界外 ⇒ 被 clamp 到 180/560，不出现 0 宽

---

### E6 · 暗色 token 修正（用户「看不清」的直接原因）

**真缺陷取证**
| 组合 | 对比度 | 门槛 |
|---|---|---|
| `#1f2937` on `#151b26`（当前） | **1.18 : 1** | 4.5 |
| `#1f2937` on `#0a0d14` | 1.32 : 1 | 4.5 |
| `#6b7280` on `#151b26` | 3.57 : 1 | 4.5 |
| 原型暗色 `#e6eaf1` on `#151b26` | **14.3 : 1** | 4.5 |

**做什么**：**不碰全局 `--dam-*`**（会误伤设置页/团队页）。只加作用域覆盖：
```css
.dam-ev4[data-theme="dark"] { /* 原型 §2 那 21 个 token 原样抄 */ }
```
并在 EventView 根节点按宿主主题（`prefers-color-scheme` + 宿主 `data-dam-theme`/`data-deep`）设 `data-theme`。

原型 dark token（`extract/prototype.css` §2 L60-76）：
`--bg:#0a0d14 --bg2:#0c111a --card:#151b26 --card2:#1a212e --card3:#111722 --ink:#e6eaf1 --ink2:#b6c0cf --ink3:#929dae --muted:#8794a6 --line:#232b39` + 状态色（`done:#5ee0a0 / active:#f7c05a / paused:#b6a2ff`）+ shadow 全 none + edge rgba。

**验收**
1. 暗色下取 `.card .ttl` 的 color/bg，按 WCAG 公式算 **≥4.5:1**（贴比值 + 手算一例）
2. 浅色下同一元素仍 **≥4.5**（不得为暗色牺牲浅色）
3. 设置页/团队页的 `--dam-*` 数值注入前后**逐字不变**

---

## §3 · E 批收口总验收（全步完成后跑一次）

| # | 判据 | 目标 |
|---|---|---|
| 1 | 全量回归 `--jobs=8 --timeout=180000` | **0 FAIL / 0 TIMEOUT** |
| 2 | `verify-docs` | 工具 20 / 路由 77 / 配置键 163 全一致 |
| 3 | `build-iter5-skin --check --strict` | **SYNC-OK** |
| 4 | `client-loadable`（真 factory） | 17/0 |
| 5 | **真 Chrome 端到端**：白板页 | 输入框无、内容铺满、左轨有月份+密度柱、卡片有宽窄三态、右栏能看 74 条检查点、暗色文字 ≥4.5:1、两栏可拖 |
| 6 | 纯 CRLF | bareLF **0** |

## §4 · 已踩过的坑（别重犯）

| # | 坑 | 判据 |
|---|---|---|
| 1 | **按行解析 CSS** = 静默失效（同行多规则 ⇒ 389 条一条没变） | CSS 解析必须按字符流 |
| 2 | **括号配平 depth 从 0 起** = 吞掉全文（选择器 402 → 4） | 块 body 配平必须从 **1** 起 |
| 3 | **解析前不剥注释** = keyframes 漏改名 | 先 `stripComments` |
| 4 | **`split("body{")` 毁掉 `.rail-body{`** | 用选择器边界正则 + 「坏选择器 = 0」断言 |
| 5 | **`events.json` 含 `<!--`**，内联进 `<script>` 会吞掉后续 script | `.replace(/</g,'\\u003c')` |
| 6 | **`rem→calc()` 又除 16** ⇒ 13px 变 0.8125px | `calc(var(--ev4-root-fs) * 0.8125)` |
| 7 | **`build-iter5-skin` 的 R2 对「替换行」误报 orphan** | 确认源文件已改后用 `--force`（先备份 client.js） |
| 8 | **只查元素级泄漏**漏掉 380 条裸 class | 断言「最左 token 是否 `.dam-ev4`」 |
| 9 | **全屏只验前两层**（隐藏 + 打标），漏掉撑高 | 必须断言最终元素 `getBoundingClientRect().height` |
| 10 | **排查「改了没生效」**先看宿主进程启动时间 vs 源码 mtime | 模块缓存 ⇒ 未重启则改动不可见 |

## §5 · 参考文件

| 文件 | 用途 |
|---|---|
| `artifacts/wb-event-preview/extract/prototype.css` | 原型 CSS（655 行 / 412 规则），照搬对象 |
| `artifacts/wb-event-preview/extract/prototype.js` | 原型运行时（1,475 行 / 80 函数），照搬对象 |
| `artifacts/wb-event-preview/extract/prototype-body.html` | body 骨架 |
| `artifacts/wb-event-preview/VERIFY.md` | **135 条真执行断言**，验收口径真源 |
| `artifacts/ev4-poc/index.html` + `_build.mjs` + `_verify.mjs` | **已跑通的照搬版 POC**（14 项真 Chrome 断言）——两栏可拖的实现直接搬 |
| `artifacts/e1-closure/` | E1 的 float-check（4/0）+ composer-hide-check（10/0） |
| `artifacts/e7-fullpage/e7-verify.mjs` | E7 的 21 项真 Chrome 断言 |
| `tests/lib/css-scope.mjs` | `scopeCss` / `renameAnimationRefs` / `countSelectors` |
| `tests/lib/css-decl-scan.mjs` | 声明级色值扫描（token vs 裸用） |
| `V4-FRONTEND-PORT-PLAN-2026-10-25.md` | 差距实测 + 移植方案（E 批立项依据） |

## §6 · 更新日志

| 时间 | 变更 |
|---|---|
| 2026-10-25 14:55 | 建立本文档。E1 ✅ / E7 ✅ / E2 ✅ 已落盘；E3 起待做 |
| 2026-10-25 15:05 | E3 完成（64/0）。E4 进行中。累计：E1 78/0 · E7 21/0 · E2 56/0 · E3 64/0 |
| 2026-10-25 15:15 | **E4 完成（35/0）**。累计：E1 78 · E7 21 · E2 56 · E3 64 · E4 35。E5 进行中 |


---

## §7 · 注入面实测（2026-10-25 15:05，回答「其余记忆有没有暴露给提示词」）

用**真引擎**（`new MemoryEngine(config)` → `resolvePaths` → `refreshEventStatePre` → `renderMemoryDynamic`）跑出的实测值，不是读源码猜的：

| 段 | state 预计算 | 是否真进注入文本 | 实测 |
|---|---|---|---|
| **event-cards**（事件卡片） | 1,780 字 | ✅ **是** | `[事件卡片 — 当前在做什么…]` 出现 |
| **user-portrait**（用户画像） | 138 字（2 条 preference，均 `stage=accepted`） | ✅ **是** | `[用户画像 — 从已采纳的人类反馈中提炼…]` 出现 |
| **event-catalog**（T0 事件目录） | 27 字 | ❌ **否（死数据）** | L8606 算出来、L8637 清空，`renderMemoryDynamic` 里 **0 处 push** |
| **greeting**（问候） | 15 字 | 🟡 条件式 | 走 `welcome-body`，需 `awayMinutes>60` 且有 `lastActiveAt` |
| `userPercept` 检查点级 | 0 条 | — | 全部 74 检查点都没填 `userPercept` |
| `agentTrace` / `sharedGround` / `commitments` | **0 / 0 / 0** | — | 三个 percept 全空，只有 `userPercept` 有 2 条 |

**两个真缺口（已登记，待修）**
1. **`event-catalog` 是死数据**：算了不注入。要么接上（T0 常驻目录，≤400 字），要么删掉省算力。
2. **`user-portrait` 未登记进 `ZONE_BY_KIND_PRE_V1`**：靠 fail-safe 落到 `memory` 区（可被淘汰序丢），而 `event-cards` 是显式登记过的。**同语义两套待遇** —— 应按 `event-cards` 一样显式登记。

**区 III（通道区）只有 300 字符**，`water-advisory` 是 `must` 且独占 273–278 ⇒ 任何 normal 段同场必被丢。这是既有待办（PLAN §待办 4）。

---

## §8 · 写入方向的架构不一致（2026-10-25 实测，待裁定）

| 工具 | 写入顺序 | 定性 |
|---|---|---|
| `memory_log` | **事件优先**：L19315 建/追加事件 → L19347 派生日 md | ✅ 符合「以事件为根本」 |
| `memory_note(kind=plan/handoff)` | **文件优先**：L19417 `writePlanSnapshot`/`writeHandoffLedger` → L19444 之后才 `mirrorPlanSectionsPre` 镜像进事件 | ⚠️ **例外** |

后果：`kind=plan` 的 PLAN.md 是**主写**，事件里只是镜像。若镜像失败，只能靠 `eventWarn` 提示，PLAN.md 仍是唯一真源 —— 与「日志 → 事件，箭头 = 替换」的方向**相反**。
待裁定：是否把 plan/handoff 也改成事件优先（事件写成功后再投影出 .md）。


---

## §9 · 注入面两个缺口的裁决（2026-10-25 15:20）

### B2 ✅ 完成（15/0 + 变异红）
- `ZONE_BY_KIND_PRE_V1` 补 `'user-portrait': 'memory'`
- 新增结构性断言：**从源码抽全部注入段 kind（`pushPart` 20 处 + `part` 4 处 = 24 个）**，与登记表 24 键做差集 ⇒ **必须为空**
- **★踩到的坑**：只扫 `pushPart` 会把 `project-notes / recent-logs / reflection / user-memory` 这 4 个**合法段**误判成「多登记的僵尸键」⇒ 假红。**判据必须两套都扫。**
- 变异：删掉 `event-cards` 登记 ⇒ 13 PASS / 2 FAIL ⇒ 必红

### B1 裁决：**路 A + excludeIds + 剩余为空则零字节**
- **否决了「`included > picks.length`」**：3 个 active 时 `included=3 > picks=2` 会注入，但目录里那 2 行与卡片**完全重复**，只有第 3 行是新信息 ⇒ 判据应是「排除已展开后还剩什么」，不是「数量比较」
- `renderEventCatalogPre` 加 `opts.excludeIds`（默认 []）；`refreshEventStatePre` 传 `picks.map(e=>e.id)`
- **bucket 用 `memoryReferences`**（不是 `otherDynamic`）—— 区 III 硬上限 300、`water-advisory` must 独占 273–278，塞进去必被丢
- 段标题改为 `[其他事件 — 本工作区还有这些（未展开；当前进行中的见下方事件卡片）]`（「全部事件」在排除后不准确）；截断时补 `（共 N 个，下列 M 个）`，不静默截断
- 6 条验收（含零字节负路径 / 不重复 / 真引擎端到端 / zone 显式登记 / 2 条变异）

### 由此确立的两条通用判据
1. **「目录 + 详情」类双段注入，判据是「信息不重复」不是「数量更多」** —— 用 `excludeIds` 做集合差，不用长度比较。
2. **新增注入段时必须同时问三件事**：①进了哪个 zone（区 III 只有 300）②bucket 是 `memoryReferences` 还是 `otherDynamic` ③在 `ZONE_BY_KIND_PRE_V1` 里**显式登记**了没有（靠 fail-safe 等于没登记）。


---

## §10 · 用户第三轮裁定 → C 批（2026-10-25 15:25）

用户看完注入面实测汇报后，给了三条裁定。**这是 v4 的「情境化主动记忆」核心，不是补丁。**

### 用户原话
1. 「把问题1的这个 memory note 还是要**追加在事件下**，反正都是以事件为中心了，这样能理得更清楚一点，只要保证这个语义唤回引擎能够触及到足够的唤回细节就行了。**这个引擎还需要训练**」
2. 「问题二，这些功能一定要**暴露提示词内**，让模型可以**及时或者按需调用**，我认为**完整版和精简版都需要**，这个是我目前研究的这个面向持续人机交流的情境化主动记忆它的**精髓之一**」
3. 「问题3其实很简单，就是因为**刚做完，估计还没来得及收集足够多的资料**，把相关的内容都**接入到 prompt 里面**，让模型能够按需调用就可以了，这个也是精简版、完整版都需要」
4. 「那缺口你找得很对，**可以继续**」

### C 批四张卡
| 卡 | 内容 | 关键判据 |
|---|---|---|
| **C1** | `memory_note(plan/handoff)` 改**事件优先**（WAL 三步：先 append checkpoint → 再写 .md 保留 CAS/M1 → 失败补 `plan-write-failed`） | 调用后事件 **checkpoints +1**（现状 **不变**，只 set sections） |
| **C2** | 精简版注入补「当前事件（T1 一行 21 字）+ 画像（≤160 字）+ 按需入口」 | 精简版 **≤1,600 字**（现 1,280）；**完整版逐字不变** |
| **C3** | 事件召回语料补四类 percept（`textOfEventPre` 现在**完全没有**） | 用 percept 里的独有词 query ⇒ `scope='events'` **必须命中**（现必 miss） |
| **C4** | `memory_event` 工具描述补「何时填哪类 percept」 | 「只有 accepted/used 进画像」**必须印在描述里**；总增 ≤600 字符 |

### 关键实测数据（C2/C3 的依据）
| 段 | 完整版 | 精简版 |
|---|---|---|
| event-cards（T2） | ✅ 1,780 字 | ❌ **0** |
| user-portrait | ✅ 138 字 | ❌ **0** |
| 精简版总字数 | — | **1,280（其中 0 字是事件/画像）** |
| `scope='events'` 召回语料 | 有 name/summary/sections/checkpoints/outcome | ❌ **无 percept 四类** |

### 由此确立的判据
- **「以事件为中心」必须体现在写入顺序上**，不只是数据存在：文件主写 + 事件镜像 = 方向反了。
- **「暴露提示词」不等于「完整版有」**：精简版占绝大多数轮次，精简版没有 = 模型绝大多数时候看不到。
- **「召回引擎触及不到」比「没填」更严重**：数据填了但语料不含 ⇒ 永远搜不到，且没有任何报错。
- **工具描述是「教模型怎么用」的唯一通路**：只罗列参数名 ⇒ 实测 `userPercept` 2 条、其余三类 **0 条**。**不是不愿填，是不知道填什么。**


---

## §11 · E 批收口与「三红」裁决（2026-10-25 15:40）

### E 批六步全部交付
| 步 | 套件 | 关键实测 |
|---|---|---|
| E1 | 78/0 | 412 规则 · 裸选择器 **0** · keyframes 全 `ev4-` |
| E7 | 21/0 真 Chrome | 白板页高度 **3% → 89%** |
| E2 | 56/0 | 刻度=事件数 · 断口=现算 >2h |
| E3 | 64/0 | narrow 零 badge / medium 2 / wide 4 |
| E4 | 35/0 | 74 检查点真渲染（修「暂无检查点」真 bug） |
| E5 | 15/0 + 20/0 真 Chrome | 左 336→436 / 右 392→292 / clamp / 双击 / 键盘±24 |
| E6 | 19/0 + 31/0 真 Chrome | 暗色 **14.30:1** · 浅色 16.75:1 · 全局零污染 |

### wb-ui-v4 自查出的两个**真缺陷**（只有全量回归能抓）
1. **`var STYLE_ID` 被 E1 整块覆盖丢失** ⇒ `ensureStyle()` 未定义引用 ⇒ **8 个既有套件红**。
   `node --check` 全绿、所有静态守卫全绿 —— **判据：插入代码块必须以「块尾完整行」为锚并逐行抄回原内容。**
2. **误加 `data-dam-block`**（E3 加 `card`、E5 加 `actions`）⇒ 布局语义块 10→12 ⇒ `r10` 三条红。
   修法：E3 去掉（纯视觉层不进布局系统）；E5 **承载 `actions`**（HEAD 的 actions 挂旧 viewgroup，D14 退场后必须由事件视图接手，否则掉一个）。

### 9 红裁决（**逐条实测，不采信「非我」自述**）
| 套件 | 归属 | 根因 | 处置 |
|---|---|---|---|
| bc-audit-fixes / h2-h0 / h2-note / ws-network | **wb-ui-v4 真缺陷** | `var STYLE_ID` 被覆盖 | ✅ 已修 |
| m70 / m73 / m76 / m78 / m79 / r26 | **并发噪声** | `--jobs=8` 浏览器/端口竞争，单跑全绿 | 不处理 |
| `i332-write-contract` | **判据过期** | 抽取壳 `new Function` 注入表没跟 C1 同步（缺 appendHandoffCheckpointPre / eventStorePathOfPre / diagThrottled / exec） | 派 wb-event-builder：产品侧删两处冗余 resolvePaths + 测试侧补桩 + **2 条新断言**（WAL 顺序 / Phase1 失败即中止） |
| `recall-stats` S4j | **判据过期 + E1 带入** | region 用**位置切片** `slice(min(iStats,iCss), max+8000)` ⇒ 长度 ~496KB，吞进整个 EV4_CSS ⇒ 抓到 `animation:ev4-lm-spin 800ms`（**E1 照搬的原型值**） | 派 wb-ui-v4：①800ms 改 `--ev4-dur-spin` token（真 Chrome 断言 animationDuration=0.8s）②region 改**内容锚定** + 长度 <60,000 断言 |
| `v4-batchA-wiring` | **判据过期** | `目录含全部事件（T0 不分状态）` —— B1 后语义变了（catalog 排除卡片已展开的） | 派 wb-event-builder：改**双向断言**（含 closed + **不含** active）+ 归因注释 |

### 由此确立的三条判据
1. **「位置切片」是脆弱判据**：`indexOf(A)` 到 `indexOf(B)+N` 会在有人往中间插内容时**静默扩大**。区域型断言必须**内容锚定 + 长度上界**（超了红）。
2. **源码抽取式测试加新依赖必须同步补桩，且桩不得返回假值** —— `()=>{}` 会让断言永远绿（与 vm 抽取同一类问题）。
3. **「非我」不能采信自述，必须逐条实测**：本次 3 条里 1 条确属别人线但根因是抽取壳（不是产品 bug），2 条是判据过期。**归因错了就会去改错的地方。**


---

## §12 · C 批验收 + 「假绿」检出（2026-10-25 15:55）

### C 批落盘状态（Lead 自查，不只看队友自报）
| 卡 | 源码落点 | 状态 |
|---|---|---|
| C1 | `Phase 1/2/3` 注释 + `plan-write-failed` + 「失败即中止」文案 | ✅ 在盘 |
| C2 | `[当前事件]` / `[用户画像]` / `[取全文]` 三段 + `state.slimEventT1` 预计算 | ✅ **假绿已修复**（真引擎 1,515 字，三段真实出现） |
| C3 | `textOfEventPre` 内四类标签（人类侧观察 / Agent 轨迹 / 共识 / 约定） | ✅ 在盘 |
| C4 | 工具描述五 stage + 三 kind + 「只有 accepted/used 进画像」 | ✅ 在盘 |

### ★C3 实测通过（真引擎，不是断言字符串）
```
engine.recall('长候选清单', 5, agent, 'events')
⇒ [记忆检索|events] "长候选清单":
   == 事件命中（1/1 个）==
   · [evt_dfc30819] v4 底层改造… [进行]
     附: 观察 2 · 轨迹 0 · 共识 0 · 约定 0
     - [stage=accepted kind=preference] 反对在 system prompt 中注入长候选清单…
⇒ 命中 ✅（该词只在 userPercept 里，sections 与 checkpoints 都没有）
负路径：'zzz不存在词汇qqq' ⇒ 未命中 ✅
```
**这是「召回引擎能触及 percept 细节」的直接证据。**

### ★★C2 假绿（本次最重要的检出）
| 项 | 结果 |
|---|---|
| C2 套件 | **21 PASS / 0 FAIL** |
| 真引擎实测 | 精简版 1,486 字，**`[当前事件]` 根本不存在** |
| 根因 | C2 读 `s.events`；`refreshEventStatePre` **从不写 `state.events`**（只写 8 个 event* 字段）⇒ 真跑恒 `[]` |
| 为什么套件绿 | 套件手工塞了 `engine.state.events = [mkEv(...)]` ⇒ **桩造了产品代码永远不会产出的字段** |

### ★「绿但假的」完整谱系（五条，2026-10-25 定稿）
| # | 形态 | 判据 | 出处 |
|---|---|---|---|
| 1 | 返回 `ok:true` 但没写盘 | 有 `dryRun`/`wrote:false` 语义必须另写真写断言 | H10 |
| 2 | 断言对象是源码字符串 | 恒真守卫，必须真执行被测函数 | CR-10 |
| 3 | **假状态桩**：手工塞产品不会产出的字段 | **测试输入必须由被测代码自己产出** | **C2（`state.events`）** |
| 4 | **探针未命中**：patch/插桩没生效却被当成有效观测 | **凡 patch/插桩式观测，必须同时断言「插桩被命中」** | **C1（C1-3a0）** |
| 5 | 两段式只测后段 | 凡「预计算 → 渲染」必须走**完整链路**（refresh → render） | C2 |

**共同点：五者都不让测试红，只让测试失去鉴别力。**
**统一自检问句（两个方向都要问）**：「如果被测代码错了，这条会红吗？如果桩/探针坏了，这条会红吗？」

**配套要求**：每个新功能至少一条**真引擎端到端断言**；并补**元断言**禁止废弃读取路径（如「C2 源码不得再出现 `s.events`」）。


---

## §13 · 收口（2026-10-25 16:20）—— 三批全部完成，Lead 独立复核

### 最终物理量（Lead 亲自实测，不采信自报）
| 文件 | 字节 | 行尾 | sha16 |
|---|---|---|---|
| `lib/index.js` | **1,601,061** | CRLF 22,710 / **bareLF 0** | `05aaab25739fabc5`（归一化 `E04A79739D70EF91` / 1,210,508 字符） |
| `lib/client.js` | **2,485,657** | CRLF 21,975 / **bareLF 0** | `0c1a7f1e7e18fa87` |
| `lib/event-write.js` | 27,352 | 纯 LF | `132ddcc29db45c39` |
| `lib/event-render.js` | 21,467 | 纯 LF | `b9023175d0e6ee21` |
| `lib/injection-zones.js` | 10,062 | 纯 LF | `18c274b2857ee1a9` |

### 四项终检（Lead 独立跑）
| 项 | 结果 |
|---|---|
| **全量回归** `--jobs=8 --timeout=180000` | **PASS 482 / FAIL 0 / TIMEOUT 0（162.2s）** |
| **verify-docs** | **EXIT=0** — 工具 20 / 路由 77 / 配置键 163 全部一致；十二页签断言全绿 |
| **build-iter5-skin --check --strict** | **SYNC-OK** |
| **r26-cross-layer** | **PASS 26 / FAIL 0**（R138：`E04A79739D70EF91` / 1,210,508） |

### 三批交付汇总
| 批 | 卡 | 结果 |
|---|---|---|
| **E（前端照搬原型）** | E1/E7/E2/E3/E4/E5/E6 | 全完成：78+21+56+64+35+(15+20)+(19+31) 条 |
| **B（注入面缺口）** | B1/B2 | 29/0 · 15/0（B1 三档真引擎场景：1 active 零增长 / +2 closed +193 / 3 active 只列第 3 个） |
| **C（用户三条裁定）** | C1/C2/C3/C4 | C1 22/0 · C2 37/0 · C3 32/0 · C4 38/0 |

### 判据过期修复（3 条，全部实测归因）
| 套件 | 根因 | 修法 |
|---|---|---|
| `recall-stats` S4j | region **位置切片** `slice(+8000)` 被 E1 的 45KB CSS 撑到 496KB，抓到 `animation:ev4-lm-spin 800ms`（原型照搬值） | 800ms → `--ev4-dur-spin` token（真 Chrome `0.8s` 不变）+ region 改**内容锚定**（15,131 字符）+ 长度闸 <60,000 |
| `i332` | 抽取壳 `new Function` 注入表没跟 C1 同步（缺 4 符号） | 产品侧删 3 处冗余 `resolvePaths`（复用分支开头 `p`）+ 测试补桩 + **2 条新断言**（WAL 顺序 / Phase1 失败即中止） |
| `v4-batchA-wiring` | B1 后 catalog 排除卡片已展开事件，旧断言「目录含全部事件」过期 | 改**双向断言**（含 closed + **不含** active） |

### ★「绿但假的」五条谱系（本批最大方法论产出）
| # | 形态 | 判据 |
|---|---|---|
| 1 | 返回 `ok:true` 但没写盘 | 有 `dryRun`/`wrote:false` 必须另写真写断言 |
| 2 | 断言对象是源码字符串 | 恒真守卫，必须真执行被测函数 |
| 3 | **假状态桩**：手工塞产品不会产出的字段（C2 的 `state.events`） | 测试输入必须由被测代码自己产出 |
| 4 | **探针未命中**：patch/插桩没生效却被当成有效观测（C1-3a0） | 凡插桩式观测必须同时断言「插桩被命中」 |
| 5 | 两段式只测后段 | 凡「预计算 → 渲染」必须走**完整链路** |

**统一自检问句（两个方向）**：「如果被测代码错了，这条会红吗？如果桩/探针坏了，这条会红吗？」

### 下一步
**H3 规约卡**（用户裁定三动作之③，唯一剩余主线）：单独批次、先只读备份 `lib/rules-edit.js` + `~/.dsh/memory/MEMORY.md` + `listRuleItemsPre` 基线条目数。

---

## §14 · ★★实测复核：为什么前端「还是难看、缺东西、输入框没隐藏」（2026-10-25 16:45）

用户截图 + 实测定位，**推翻 E 批「6/6 全绿」的结论**。E 批套件全绿是真的，但**它们测的是「代码里有没有这个函数/这个类名字符串」，不是「DOM 上有没有这个类」**。

### 根因 A：CSS 照搬了原型类名，DOM 用的是另一套自造类名 —— 两者对不上

| 事实 | 实测数字 |
|---|---|
| `EV4_CSS` 里作用域化的**原型类名** | **99 个**（`.card` / `.topbar` / `.chips` / `.dtl` / `.srcs` / `.lgrid` / `.wfbody` …） |
| 渲染代码里**真的用到**的原型类名 | **32 个**（且多为 `b-done` / `vswitch` / `tick` 这类小项） |
| **完全没在 DOM 里出现**的原型类名 | **67 个**（含 `.topbar` `.brand` `.controls` `.chips` `.chip` `.rail-top` `.rail-h` `.rail-body` `.axis` `.mid-top` `.mid-h` `.toolbar` `.legend` `.lm-*` `.dtl` `.cp-h` `.cp-counts` `.dtools` `.dbtn` `.dstats` `.srcs` `.foot` `.lgrid` `.axis-*` `.lrow` `.ltrack` `.lseg` `.wfbody` `.wfrow` …） |

**⇒ 412 条规则里绝大多数永远不可能命中。** 这就是「照搬了 CSS 但看起来还是不像原型」的直接原因。

### 根因 B：中栏卡片仍是旧 EventCard，`renderEv4CardPre` 是死代码

```
EventCard（L6602）实测：
  className 出现次数 = 0          ← 一个类名都没有
  内联 style 对象   = 11 个        ← 全靠 inline style
renderEv4CardPre（L7329，照搬原型 renderCard，class 用 .card/.ttl/.meta/.badge/.sec/.why）
  定义 1 处 · 调用 0 处            ← 死代码
```

`renderStreamViewPre` 里是 `h(EventCard, ...)`。**原型卡片的所有视觉（三档宽窄、badge、成果列表、why）一条都没生效。**

### 根因 C：E3 的三档 ticket 打了标记但没有任何 CSS

```
className: "evt-card-wrap ticket-" + tm.ticket     ← DOM 上有
CSS 里 ticket-narrow / ticket-medium / ticket-wide  ← 0 条规则
```

⇒ 分档逻辑写对了、断言也过了，但**视觉上三档完全一样**。

### 根因 D：`data-dam-page` 祖先缺失 → 58 条 CSS 规则全失效（含 E7 的高度链）

```
CSS 里 [data-dam-page] 开头的规则 = 58 条
全仓 'data-dam-page' 赋值处    = 1 处（L18964，只属于经典记忆页 MemoryPageView）
白板页 surface（L21856）      = h(Iter5Surface,{kind:'page'}, h(EventView,...))  ← 没有 data-dam-page
```

⇒ 包括 E7 加的那 4 条 `[data-dam-page] [data-dam-fullpage-host] {...}` **全部不生效**。这也是「内容没撑满」的真实原因之一。

### 根因 E：输入框没隐藏 —— 多个 page surface 抢同一个全局布尔属性

```
conversation.view 注册了 2 个 kind:'page' 的 surface：
  order 78  MemoryPageView（记忆页）
  order 80  EventView（白板看板）
两者各自跑同一段 IntersectionObserver：
  可见   → body.setAttribute('data-dam-fullpage','true')
  不可见 → body.removeAttribute('data-dam-fullpage')
⇒ last-writer-wins：从「记忆」切到「白板看板」时，
   记忆页的 IO 回报 isIntersecting=false ⇒ mark(false)，
   会把白板页刚打上的 true 摘掉（回调顺序无保证）。
⇒ 输入框保持可见。
```

**这是真缺陷**：全局布尔属性被 N 个观察者各自覆写，没有引用计数。

### 根因 F（待复现）：右栏 event-not-found

实测 `/event-detail?id=evt_dfc30819` 与 `?id=evt_89786878` **都返回 200 ok**。截图里 404 ⇒ 前端请求了一个**不在库里的 id**。需浏览器 devtools Network 里看那条 URL 的 `id=`。

### ⇒ E 批结论修正

| 之前 | 实际 |
|---|---|
| 「E 批 6/6 全绿」 | **套件全绿 ≠ 视觉落地**。E2–E5 的断言测的是「纯函数返回什么」「字符串在不在源码里」，**没有一条断言「DOM 上有没有 .card 这个类」** |
| 「照搬原型」 | 只照搬了 **CSS**，**DOM 结构没照搬** —— 这是「照搬原型」的**第三次**同类事故（第一次 176 class 复用 0；第二次 380 裸选择器；这次 99 类里 67 个 DOM 里根本不存在） |

### 新判据（写死）

> **「照搬原型」必须双向核对：①CSS 里的每个原型类，DOM 里必须有元素带它；②DOM 里每个 class，CSS 里必须有规则。**
> 只有单向（有 CSS 无 DOM / 有 DOM 无 CSS）都算没做。
> 断言形态：从 `EV4_CSS` 抽类名集合 A，从渲染函数抽 className 集合 B，**A ⊆ B**（或明确列出「保留未用」白名单并说明原因）。

### 修复计划（E8）

| # | 修什么 | 判据 |
|---|---|---|
| E8-1 | `data-dam-page` 挂到白板页 surface 根（或把 58 条规则改挂 `.dam-ev4`） | 白板页 58 条规则命中数 > 0；E7 高度链生效（`getBoundingClientRect().height ≥ 视口 80%`） |
| E8-2 | 中栏换 `renderEv4CardPre`（照搬原型的卡片），EventCard 降级为 fallback | DOM 上 `.card` 数 === 事件数；`.ttl`/`.meta`/`.badge` 都有 |
| E8-3 | E3 三档补 CSS（`.ticket-narrow/medium/wide` 的 max-width/padding/字号） | 三档卡片 `getBoundingClientRect().width` 递增 |
| E8-4 | 顶栏补 `.topbar/.brand/.controls/.chips/.chip` 的 DOM | 那些类在 DOM 上真实存在 |
| E8-5 | 右栏换原型 `.detail/.dtl/.cp/.panels/.srcs` 结构 | `.dtl` 节点数 === 检查点数 |
| E8-6 | fullpage 标记改**引用计数**（Set of visible page els） | 从记忆页切白板页后 `data-dam-fullpage` 仍为 true；切回对话页为 false |
| E8-7 | **双向类名核对套件**（A ⊆ B + B ⊆ A），变异必红 | 删一条 `.card` 规则 ⇒ 必红；DOM 用未定义类 ⇒ 必红 |

---

## §15 · E8 口径裁决（2026-10-25 17:00）

### ★撤回：Lead 的「67 个孤儿」是错的

静态扫源码算类名的**三个缺陷叠加**：
1. 只取 `.dam-ev4` 后第一个类名 ⇒ `.card.narrow` 只取 `card`，`narrow` 丢了
2. 只在某个行区间找 `className` ⇒ 区间外全漏
3. **没处理拼接类名** ⇒ `className: 'badge ' + b.cls` 只算到 `badge`，`b-done`/`b-high` 全漏

按更全静态口径重算：CSS 里其实 **173 个**类名（不是 99），DOM 字面量 41 个 ⇒ 差 2 倍以上。

**裁决：以「真 DOM 口径」为唯一真值**（渲染后 `querySelectorAll` + computed style 是否命中）。**孤儿数 = 21**，其中 10 个是构造页不全。

**新判据**：**类名双向核对必须在真 DOM 上跑，不许静态扫源码**；静态扫描只能用于单点守卫，不能用于集合差集。

### 11 个死规则的**四分类**（不是一律白名单）

| 批 | 类 | 性质 | 处置 |
|---|---|---|---|
| 一 | `.dtoggle` / `.hi` / `.empty` / `.demo-rail` | 功能已存在，只缺 className | **补 DOM**（顺带删 inline style，净减代码）|
| 二 | `.lane-today` / `.navbtn` | **真功能缺失** | 进功能待办，**不许白名单** |
| 三 | `.demo-switch` / `.demo-banner` / `.demo-tag` / `.demo-stat` | 本插件不需要（演示模式专属）| **删规则**，不是豁免 |
| 四 | `.layout` / `.col` | 结构等价（另一套 class 实现同样视觉）| 可豁免，但**必须给真 Chrome 三项对比证据** |

**核心判据：白名单是放「本期没做但有计划」的，不是放「我们根本不需要的」。后者必须删，否则永远躺在豁免名单里伪装成技术债。**

**白名单三硬约束**：①数量锁定 `assert(size === 11)` ②逐条带 `kind`（`feature-todo`/`struct-equiv`/`to-delete`）+ 理由 ③每条必须在 artifacts 有对应记录。**`kind: to-delete` 出现在白名单 ⇒ 断言必红。**

### E8 已完成（队友实测）

| 项 | 结果 |
|---|---|
| E8-6 fullpage 引用计数 | ✅ `EV4_VISIBLE_PAGES` Set，6 处 |
| E8-1 `data-dam-page` | ✅ `kind==='page'` 才带 |
| E8-2 中栏换 `renderEv4CardPre` | ✅ EventCard 降级 fallback |
| E8-3 ticket 三档 | ✅ **查明不需要新增 CSS** —— 三档规则一直都在，只是 `renderEv4CardPre` 调用 0 处；接上后自动生效 |

**真 Chrome 17/0 实测**：`[data-dam-page]` 0→1 · EventView 高度 153px(15%)→**1000px(100%)** · `.card` 1→**3** · `.meta/.badge` 0→2/2 · `.summary/.sec/.why` 0→1/1/1 · 三档 padding **9/12 · 11/13 · 13/15**（原型值）· 三档宽度 **1311 < 1503 < 1599 严格递增** · 变异 1（`deleteRule` 真删）padding→0 必红 · 变异 2（加 `.nonexistent-xyz`）B 方向必红。

### 一个可复用的坑

**变异「删 CSS 规则」不能用「后插一张删掉规则的样式表」** —— CSSOM 后插入只能覆盖不能删除，padding 不会变、变异假绿。必须 `document.styleSheets[0].deleteRule(i)`。

### 剩余

| 项 | 状态 |
|---|---|
| E8-4 顶栏结构（`.topbar/.brand/.controls/.chips/.chip`） | ⏳ 队友手上 |
| E8-5 右栏结构（`.detail/.dtl/.cp/.panels/.srcs`） | ⏳ 队友手上 |
| 第一批 4 个补 DOM | ⏳ |
| `.layout/.col` 等价证明 | ⏳ |
| 第三批删规则 | ⏳ |
| E8-7 双向核对套件（真 DOM + 白名单三约束） | ⏳ |
| 既有 11 套件 + factory + SYNC + 两字节锁重钉 | ⏳ |
