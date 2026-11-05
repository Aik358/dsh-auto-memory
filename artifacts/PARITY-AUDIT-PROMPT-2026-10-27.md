# 任务：白板视图「产品 vs 原型」差距核对

你是独立的核对 Agent。目标：**用可复现的证据**判定产品白板视图与原型（prototype）的差距，产出一份差距清单。

**核心要求：不要只看源码，要看真实数据渲染出来的结果。** 允许使用 computer use / 无头浏览器 / CDP 截图。

---

## 0 · 三个标的物（绝对路径，直接可用）

| # | 标的 | 路径 |
|---|---|---|
| A | **原型**（三栏事件视图，2.6MB 单文件 HTML） | `D:/dsh-auto-memory/artifacts/wb-event-preview/index.html` |
| B | **原型的数据**（185 事件 / 839 检查点） | `D:/dsh-auto-memory/artifacts/wb-event-preview/events.json` |
| C | **产品的真实数据**（9 事件 / 303 检查点） | `C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json` |
| D | 产品的前端适配层 | `D:/dsh-auto-memory/lib/ev4-adapter.js` |
| E | 产品的原型运行时（内联在 client.js 里） | `D:/dsh-auto-memory/lib/client.js` 里搜 `EV4_PROTO_RUNTIME` |

> ⚠️ **不要修改任何文件**。只读 + 截图 + 出报告。

---

## 1 · 第一步：截图原型（拿到「应该长什么样」的基准）

原型是**纯静态文件**，不需要服务器：

```bash
cd D:/dsh-auto-memory
node tools/shot-url.mjs "file:///D:/dsh-auto-memory/artifacts/wb-event-preview/index.html" "artifacts/_parity/proto.png" 1920 1200 12000
```

**已知可用的截图工具**：`D:/dsh-auto-memory/tools/shot-url.mjs`（Chrome headless，参数：url out.png [宽] [高] [等待ms]）

**你要记录原型的关键视觉要素**（逐条数出来，不要泛泛说「三栏」）：
- 左栏（时间轴）：事件卡密度、日期分组方式、「空档 N.Nh」标记、底部统计条
- 中栏（事件流）：事件卡头部（状态徽章/类型/检查点计数）、四段文字、SKILL 状态、成果列表
- 右栏（详情）：四个 percept 栏（USERPERCEPT / AGENTTRACE / SHAREDGROUND / COMMITMENTS）、检查点展开列表、来源标签
- 顶部：三个视图切换（时间轴 / 泳道·甘特 / 工作流线索）、字号控制、统计（文档/事件/检查点/最大事件/单检查点占比）
- **配色与字体**：记下主色、卡片背景、边框、字体族

---

## 2 · 第二步：让产品数据走原型的渲染器（这是关键，不要跳过）

**为什么必须这么做**：产品 GUI 需要认证，无法直接截图。但**原型运行时已经内联在 client.js 里**（`EV4_PROTO_RUNTIME`），可以把它抽出来 + 喂产品数据，得到「产品真实数据在原型渲染器下的样子」。这比看源码精确。

做法：
1. 从 `lib/client.js` 提取 `EV4_PROTO_RUNTIME` 字符串（它是一段完整 IIFE，含 CSS + DOM 构建）
2. 用 `lib/ev4-adapter.js` 的 `adaptStoreToPrototypePayload(store, opts)` 把**产品真实数据** `event-store.json` 转成原型 payload
3. 把 payload 注入原型 HTML 的 `<script id="payload">`，生成一个临时 HTML
4. 用同一个 `shot-url.mjs` 截图
5. **和第一步的原型截图并排比对**

> 如果第 2 步跑不通，退化方案：直接对比 `adaptStoreToPrototypePayload` 的输出和 `events.json` 的**字段级差异**（我们已测得：事件 17/22、检查点 6/17），并明确标注「这是数据层比对，不是视觉比对」。

---

## 3 · 第三步：必须回答的核心问题（按此顺序）

### Q1 · 检查点四段是空的（最可能的主因，先验证）

**已知事实**（请独立复核，不要直接采信）：
- 产品 303 个检查点里，**只有 1 个**填了 `goal/state/dead/next`（0.3%）
- 其余全是旧格式 `{at, kind, text, sourceRef, panels, idemKey}`，**没有四段**
- 原型 839 个检查点**全部有四段**（`goal/state/dead/next` 都得有内容）

**请验证**：
- 原型的事件卡/详情面板里，四段文字占多大的视觉比重？（量出来：占卡片高度的百分之几）
- 产品数据走适配层后，检查点四段在 payload 里是什么？空数组？undefined？
- **结论**：白板「看起来像流水账」是不是主要原因就是「检查点没有四段」？

### Q2 · 事件级缺失的 5 个字段影响什么

产品缺 `title / date / start / end / sourceCount`。请逐条判断：
- `title` 缺 → 原型用什么代替？（产品用的是 `name`，适配层映射了吗？）
- `date/start/end` 缺 → 时间轴分组、日期标签会不会显示 undefined / 1970？
- `sourceCount` 缺 → 「来源 N 篇」那个标签会不会消失？

### Q3 · 视觉层差距（截图逐项比对）

用第一步和第二步的两张截图，**逐项**填这张表（不要写「大致相同」）：

| 项 | 原型 | 产品 | 差距等级(严重/中/轻/无) |
|---|---|---|---|
| 三栏布局比例 |  |  |  |
| 左栏时间轴密度 |  |  |  |
| 空档标记（空档 N.Nh） |  |  |  |
| 事件卡头部徽章 |  |  |  |
| 四段文字展示 |  |  |  |
| 右栏四个 percept 栏 |  |  |  |
| 检查点展开列表 |  |  |  |
| 顶部统计条 |  |  |  |
| 配色/字体 |  |  |  |

### Q4 · 适配层有没有静默丢弃

读 `lib/ev4-adapter.js`，找出**所有**「读不到就填空」的地方（如 `members: []`、`skills: []`、`outcomes: []`）。逐条判断：产品数据里这个字段**到底有没有**？如果有但适配层丢了，那就是 bug。

---

## 4 · 交付物

### 4.1 报告文件
写到 `D:/dsh-auto-memory/artifacts/PARITY-AUDIT-<YYYYMMDD>.md`，结构：

```markdown
# 白板视图 产品 vs 原型 差距核对

## 结论（三句话）
1. 主因是 …
2. 次因是 …
3. 修复优先级 …

## 一、视觉比对（截图）
<并排贴两张图 / 或引用路径>

## 二、数据层差距（可复算）
| 层 | 原型 | 产品 | 缺失 |

## 三、逐项差距清单
| # | 差距 | 等级 | 根因 | 修复建议 | 预计工作量 |

## 四、可复现命令
<把你跑过的命令逐条贴出，让别人能复现>
```

### 4.2 三张截图（必须落盘）
- `artifacts/_parity/proto.png` —— 原型基准
- `artifacts/_parity/prod-via-proto.png` —— 产品数据走原型渲染器
- `artifacts/_parity/prod-actual.png` —— 如果你能拿到产品 GUI 的真实截图（需认证则可跳过，但要说明）

---

## 5 · 纪律（违反即结果作废）

1. **不许说「大致一致」「基本符合」** —— 每一条差距都要有**截图或数字**支撑。
2. **不许只看源码下结论** —— 视觉问题必须看渲染结果。
3. **区分「数据缺」和「渲染缺」** —— 这两者的修复方式完全不同（前者补数据，后者改代码）。每一条差距必须标注它属于哪一类。
4. **不许改产品代码** —— 只出报告。
5. **可以质疑任务描述** —— 如果上面「已知事实」有错，直接指出并给证据。

---

## 6 · 环境

- Windows，Chrome 在 `C:/Program Files/Google/Chrome/Application/chrome.exe`
- Node 可用；无需 npm install
- 截图工具：`D:/dsh-auto-memory/tools/shot-url.mjs`
- 如果需要起本地服务器：`python -m http.server` 或 `npx serve`（注意别占用 24597，那是 DSH 的端口）
