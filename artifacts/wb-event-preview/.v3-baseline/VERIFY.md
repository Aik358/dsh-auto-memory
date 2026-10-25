# VERIFY · 白板事件化原型（自动生成，可复算）

由 `node verify.mjs` 生成。每条都是真执行后的实测值，不是源码字符串断言。

```
PASS 源文件总数 = 837（handoff 578 + archive 259）｜v1 基线 833（575+258），语料自然增长 +4  =>  837 篇（v1=833，+4 源自 2026-10-23 12:26-12:27Z 续写）
PASS 顶层 578 / archive 259（v1：575/258）  =>  top=578 archive=259（v1 575/258）
PASS PLAN.md 另计（只读参考，不入事件）  =>  PLAN.md 9103 B sha256=d0e84be96a22a2ef
PASS events.json 覆盖文档数 = 837  =>  837 条目
PASS 无重复引用（每个 .md 恰好一次）  =>  uniq=837 / docs=837
PASS 无遗漏 / 无越界  =>  missing=0 extra=0
PASS 检查点 sha256 与现盘一致（837 篇逐篇）  =>  mismatch=0
PASS 检查点字节数与现盘一致  =>  mismatch=0
PASS 计划外账本兜底：不再 throw，归入「待归并」桶并计数  =>  planned=516 unplanned=1 bucket=1
PASS 「待归并」桶 confidence = low 且 rationale 写明待人工归并  =>  low / 新增账本，待人工归并（自动兜底，不参与语义聚类）
PASS 「待归并」桶覆盖的正是新增那篇账本  =>  handoff/handoff-20261023-202749.md
PASS 事件数在 60–300 区间（用户放宽后）  =>  127 个账本事件 + 57 个归桶节点
PASS 单事件检查点 ≤ 40  =>  最大 26
PASS 单检查点事件占比 < 60%  =>  24.4%（31/127）
PASS 四个 percept 字段全部存在且为数组  =>  missing=0
PASS 每个事件都有可审计 rationale（非空、>5 字）  =>  bad=0
PASS 每个检查点都有 log 原文引用（非空）  =>  empty=0/837
PASS log 引用不含看板 tag 前缀  =>  dirty=0
PASS log 引用确实来自原始 .md 正文（逐条回读校验）  =>  notFound=0
PASS 每个事件的 members[] 与检查点数一致  =>  bad=0
PASS confidence 取值合法（high/medium/low）  =>  high,medium,low
PASS 每个检查点 6 个 panel  =>  bad=0
PASS panel kind 六类齐全  =>  state,log,dead,next,userPercept,commitment
PASS HTML 无 http(s) 外链  =>  count=0
PASS HTML 无 <script src>  =>  count=0
PASS HTML 无 <link href>  =>  count=0
PASS HTML 无 <img src>  =>  count=0
PASS HTML 无 @import  =>  count=0
PASS build 幂等：index.html 两次 sha256 相同  =>  86db19739b87b44b
PASS build 幂等：events.json 两次 sha256 相同  =>  502aff05c32c6648
PASS 构建前后源文件 sha256 全量一致（837 篇）  =>  changed=0
PASS 源文件集合聚合指纹可复算  =>  8ffe09ada21242bfc53edc1c1746ae164448513edcec6c21621dde1a8689a34c
PASS headless Chrome 真渲染出 PNG（两次）  =>  222639B / 233732B
PASS 截图尺寸 = 1600x1000  =>  1600x1000 / 1600x1000
PASS 截图非空白（亮度方差 > 300 且非白像素 > 5%）  =>  var=603.63 nonWhite=7.973% colors=1857 | var=610.8 nonWhite=8.105% colors=1958
PASS 两次截图 sha256 不同（内容确为不同事件）  =>  ad75f9c4 vs 79f3a5b9
PASS [browser] 页面真渲染：时间流 184 张卡 + 184 个时间轴刻度  =>  {"ready":"complete","cards":184,"ticks":184,"panels":6}
PASS [browser] localStorage 无值时默认视图 = time stream  =>  {"mode":null,"active":"stream"}
PASS [browser] 切「泳道/甘特」后 localStorage.wbEvt.viewMode === "lanes"  =>  {"mode":"lanes","body":"lanes","rows":127,"segs":124,"dots":31}
PASS [browser] 泳道视图 127 行：31 个单检查点画点、124 段横条  =>  rows=127 dots=31 segs=124
PASS [browser] 切「工作流线索」后 wbEvt.viewMode === "workflow"  =>  {"mode":"workflow","groups":37,"closed":"(主线)","rows":163}
PASS [browser] 工作流按 lane 分组（37 组：主线 91 + 36 条标号线）、主线默认折叠、行数 163（事件可同属多条线）  =>  {"mode":"workflow","groups":37,"closed":"(主线)","rows":163}
PASS [browser] 切回时间流后 wbEvt.viewMode === "stream"  =>  stream
PASS [browser] 点「收起右栏」后 localStorage.wbEvt.detailOpen === "false"  =>  {"before":null,"after":"false"}
PASS [browser] 收起后 grid 变为 200px 1fr 0，右栏实测宽度 0px  =>  200px 1400px 0px / detailW=0
PASS [browser] 再展开：detailOpen === "true"，右栏占回余量（332px 起）  =>  {"open":"true","cols":"200px 332px 1068px","w":1068}
PASS [browser] 抽屉可中断：收起途中反向，最终仍回到展开且宽度连续（无 0↔满 跳变）  =>  midW=327 finalW=1068
PASS [browser] 检查点默认全部折叠（26/26 只留头部）  =>  {"total":26,"closed":26}
PASS [browser] 折叠态头部显示「现状 n · log n · 失败 n · 下一步 n」四格计数  =>  现状 7log 1失败 3下一步 7
PASS [browser] 折叠态 body 的 grid-template-rows 实测为 0fr（0 → 1fr 过渡）  =>  0px
PASS [browser] 点第 2 个检查点头部：该行展开、六格面板齐、行高从 0 变为非 0  =>  {"closed":25,"panels":6,"rows":"372.516px"}
PASS [browser] 再点一次同一头部：回到折叠（26/26）  =>  closed=26
PASS [browser] 空档标记：evt-018（40.9h）插出虚线「⏸ 搁置 40.9 小时 —— 起→止」  =>  ⏸ 搁置 40.9 小时 —— 2026-09-11 21:44 → 2026-09-13 14:38
PASS [browser] 负路径：无 >2h 空档的事件（evt-086）不出现任何空档标记  =>  {"gaps":0,"cps":2}
PASS [browser] 默认（开关关闭）真实列表 184 张卡、0 个 demo 节点  =>  {"demoCards":0,"demoTicks":0,"cards":184}
PASS [browser] 开启「并发演示（合成数据）」：4 张 demo 卡 + 4 个刻度、0 个真实节点  =>  {"demoCards":4,"demoTicks":4,"realNodes":0,"banner":"","tag":"合成数据"}
PASS [browser] demo 模式顶部有「合成数据」标识条  =>  {"banner":"","tag":"合成数据"}
PASS [browser] 合成 demo 泳道：4 行、6 对区间重叠（并发在图上可见）  =>  rows=4 overlapPairs=6
PASS [browser] 负路径：关掉 demo 后 demo 节点归零、真实 184 张卡回来  =>  {"demoNodes":0,"cards":184}
PASS [browser] 刷新后：视图=workflow、右栏=收起（均从 localStorage 恢复）  =>  {"mode":"workflow","groups":37,"off":true}
PASS [browser] 深链 #evt-091 命中并选中对应事件  =>  {"hash":"#evt-091","mode":"stream","selected":"evt-091","heading":"手动接续漂移修复 + 3.2.1 发版"}
PASS [browser] ↑↓ 键盘切换事件（ArrowDown：evt-091 → evt-092）  =>  after=evt-092
PASS [browser] reduced-motion 降级：切抽屉 120ms 内直接落位（无弹簧中间帧）  =>  {"before":1068,"after120ms":0}
PASS [browser] reduced-motion 降级：展开同样即时恢复  =>  w=1068
PASS [browser] 视图切换键盘可达：stream 上按 ArrowRight → lanes，且焦点与 localStorage 同步  =>  {"before":"stream","after":{"mode":"lanes","body":"lanes","focusView":"lanes","rows":127}}
PASS [browser] 四张交付截图均为 1600x1000  =>  1600x1000 / 1600x1000 / 1600x1000 / 1600x1000
PASS [browser] 四张交付截图非空白（亮度方差 > 300 且非白像素 > 5%）  =>  03-collapsed var=797.92 nw=8.912% | 04-lanes var=617.86 nw=7.938% | 05-gap var=579.7 nw=7.938% | 06-concurrent-demo var=388.21 nw=6.119%
PASS [browser] 四张截图 sha256 互不相同（确为四个不同界面态）  =>  231779 / 273720 / 229674 / 151156
PASS 合成 fixture 存在且 sha256 与 stats 记录一致  =>  3040 B sha256=3e94560665588738
PASS 合成 fixture 有 3–4 个虚构事件且全部 id 以 demo- 开头  =>  demo-alpha,demo-bravo,demo-charlie,demo-delta
PASS 负路径：真实事件列表里 0 个 demo id  =>  leakedId=0 realIds=184
PASS 负路径：真实事件里 0 个【合成】标题  =>  leaked=0
PASS 负路径：真实检查点 0 条来自 fixtures/concurrent-demo.json  =>  leaked=0 / rels=837
PASS 合成 fixture 的检查点时间真交错（每条线至少与另一条重叠）  =>  4 条线全部与其他线重叠
PASS 空档基线：20/127 事件含 >2h 空档、最大 40.9h（与任务卡实测一致）  =>  gapEvents=20 max=40.91h
PASS lane 提取：主线 91 个 + 36 条标号线 = 37 组  =>  main=91 groups=37 tagged=36
PASS P0 线 = 9 个事件 / 跨 8 个不同日期 / 跨度 39.3 天（任务卡口径：8 天/9 事件）  =>  P0 events=9 distinctDays=8 span=39.3d
PASS P1 线 = 9 个事件（任务卡口径），R4 线 = 3 个事件  =>  P1=9 R4=3
PASS 判据对照实验跑通（517 账本 × 三组判据；v1 为 516，+1 语料增长）  =>  n=517（v1=516）

TOTAL 79  PASS 79  FAIL 0
```

## 关键数字

| 项 | 值 |
| --- | --- |
| 源文档 | 837 篇（顶层 578 + archive 259） |
| 事件（四段账本） | 127 |
| 归桶节点（转写包 / 白板快照 / 说明） | 57 |
| 时间轴节点合计 | 184 |
| 检查点合计 | 837 |
| 最大事件检查点数 | 26 |
| 单检查点事件占比 | 24.4% |
| 三态卡分布（窄/中/宽，按检查点数自动） | 88 / 38 / 58 |
| 置信分布 | {"high":93,"medium":34} |
| 覆盖率 | 837 / 837 = 100% |
| index.html | 2547940 字节 |
| events.json | 3313599 字节 |
| 源文件聚合指纹 | `8ffe09ada21242bfc53edc1c1746ae164448513edcec6c21621dde1a8689a34c` |
| 首屏截图 | `shot-01-first-screen.png` · 222639 B · 1600x1000 · 亮度方差 603.63 · 非白像素 7.973% |
| 宽卡截图 | `shot-02-wide-event.png` · 233732 B · 非白像素 8.105% |
| 计划外账本（待归并桶） | 1 篇（handoff/handoff-20261023-202749.md） |
| 合成 fixture | `fixtures/concurrent-demo.json` · 3040 B · 4 个虚构事件 · sha256 `3e94560665588738` |
| PLAN.md（只读参考） | 9103 字节 · sha256 `d0e84be96a22a2ef2956c53c803b2168f8de49c7d239dc59c27613f9e4a01776` |

## v2 基线说明（为什么从 833 变 837）

| 项 | 值 |
| --- | --- |
| v1 基线 | 833 篇 = 顶层 575 + archive 258 |
| 当前基线 | **837 篇 = 顶层 578 + archive 259** |
| 增量 | +4 篇（1 篇四段账本 + 2 篇会话转写 + 1 篇白板快照归档） |
| 新增时间 | 2026-10-23 12:26:10Z / 12:27:34Z / 12:27:49Z |
| 归因 | **语料自然增长**，非改动引入。v1 之后本会话又续写了交接账本，handoff 目录随之变长 |

### 由此修掉的一个设计缺陷：plan 覆盖不足时不再 throw

v1 的 `assembleEvents()` 对「plan 覆盖数 == 账本数」做硬相等断言，语料一长就炸（本次实测报 `plan=516 ledgers=517`）。
v2 改成：

- **plan 里有的账本** → 进对应事件；
- **plan 里没有的账本** → 不 throw，自动进 `bucket-unplanned`「待归并」桶，`confidence: low`、`rationale: "新增账本，待人工归并"`，并在 `stats.unplannedLedgers` / `stats.unplannedSince` 里报数量与起始时间；
- **plan 指向的账本比现存的还多** → 仍然 throw（这才是真不一致）。

这就是 v4「未归档事件窗格（D2）」的最小实现：语料每天长，不需要每次人工补 plan 才能出图。
本次实测：planned=516 / unplanned=1 / 待归并桶 1 个节点。

## v2 新增能力（全部通过真浏览器交互断言）

| # | 能力 | 实现要点 | 验收方式 |
| --- | --- | --- | --- |
| 1 | 右栏可收起 | `localStorage.wbEvt.detailOpen`；grid `200px 332px 1fr → 200px 1fr 0`；弹簧 damping 0.8 / response 0.3，可中断；reduced-motion 直接落位 | CDP 真点击 + 读 localStorage + computed grid + 右栏实测宽度 |
| 2 | 检查点可折叠 | 默认只留头部（#N + 时间 + 源文件 + 四格计数）；`grid-template-rows: 0fr → 1fr` | CDP 读 `gridTemplateRows` 实测 0px / 非 0px，并验证 26/26 → 25/26 → 26/26 |
| 3 | 三视图切换 | `localStorage.wbEvt.viewMode` = stream / lanes / workflow | CDP 逐个点击后断言 localStorage 与 DOM 行数 |
| 4 | 泳道 / 甘特 | 每事件一行横向时间条；历史数据 127 行 **0 对重叠**（真实反映流水账）；合成 fixture **6 对重叠**（并发可见）；事件内 >2h 空档画成断口，不掩盖 | CDP 数 `.lrow` / `.lseg` / `.lpt-single` 与区间重叠对数 |
| 5 | 工作流线索 | 按 title（无则 summary）提取 Pn/Rn/Gn/E线/F线，**集合成员关系**（一件事可同属多条线）；37 组 = 主线 91 + 36 条标号线，主线默认折叠 | CDP 断言 37 组、主线折叠态、163 行（= 91 + 36 条线各若干） |
| 6 | 空档标记 | 相邻检查点 >2h 插虚线「⏸ 搁置 X 小时 —— 起→止」 | CDP 断言 evt-018（40.9h）出现、evt-086（无空档）不出现 |
| 7 | 合成 fixture 分区 | `fixtures/concurrent-demo.json`，独立 `<script id="demo-payload">`，开关「并发演示（合成数据）」 | 负路径：真实 events.json 里 0 个 demo id / 0 个【合成】标题 / 0 条 demo 来源 |
| 8 | reduced-motion 降级 | 抽屉弹簧在 `prefers-reduced-motion: reduce` 下退化为即时落位；其余过渡统一 1ms | CDP 仿真该媒体特性后 120ms 内断言右栏宽度已归零 |
| 9 | 键盘可达 | 视图 tablist 支持 ArrowLeft/Right 切换并同步焦点与 localStorage；↑↓ 切事件 | CDP 真派发 keydown 后断言 viewMode / focus / DOM |

## 四张交付截图（headless Chrome 真渲染，实测像素）

| 文件 | 尺寸 | 字节 | 亮度方差 | 非白像素 |
| --- | --- | --- | --- | --- |
| `shot-03-collapsed.png` | 1600x1000 | 231779 | 797.92 | 8.912% |
| `shot-04-lanes.png` | 1600x1000 | 273720 | 617.86 | 7.938% |
| `shot-05-gap.png` | 1600x1000 | 229674 | 579.7 | 7.938% |
| `shot-06-concurrent-demo.png` | 1600x1000 | 151156 | 388.21 | 6.119% |

## 聚类判据（本版采用）

**人判语义聚类**：逐篇读四段后由模型决定「哪些检查点属于同一件事」，机械相似度只作对照与审计，不作主判据（用户 2026-10-23 裁定：阈值让 LLM 自己决定）。

- 每个事件带 `members[]`（= checkpoints[].rel）、`rationale`（一句话理由）、`confidence`（high/medium/low）。
- low 置信不自动接受，前端标「待人工」。本版没有 low：{"high":93,"medium":34}。

### 对照 A：目标段字符 2-gram Jaccard + 单链聚类（任务卡里的旧基线）

| 阈值 | 簇数 | 单篇簇占比 | 最大簇 |
| --- | --- | --- | --- |
| 0.30 | 394 | 84.8% | 20 |
| 0.40 | 424 | 87.7% | 15 |
| 0.50 | 457 | 91.7% | 12 |
| 0.60 | 475 | 94.5% | 11 |

这就是任务卡里说的「不可接受」结果：阈值 0.5 时 **456 簇、91.7% 单篇**，等于没聚。
（与任务卡给的已知基线 458 簇 / 91.5% 相差 2 簇，因为我的 2-gram 切法与清洗规则略有不同。）

### 对照 B：TF-IDF 加权（目标 4 / 状态 2 / 失败 1 / 下一步 1）+ 增量聚类（24h 窗口）

| 阈值 | 簇数 | 单篇簇占比 | 最大簇 |
| --- | --- | --- | --- |
| 0.20 | 337 | 69.4% | 14 |
| 0.25 | 372 | 75% | 12 |
| 0.30 | 394 | 78.9% | 7 |
| 0.35 | 420 | 83.3% | 5 |
| 0.40 | 438 | 85.8% | 5 |
| 0.50 | 464 | 91.4% | 7 |
| 0.60 | 492 | 95.7% | 5 |

加权 TF-IDF 比裸 2-gram 好（同一阈值下簇更少、最大簇更小），但**仍然拿不到可用结果**：
想要 100 上下的事件数，阈值要低到 0.20 才勉强 335 簇、69% 单篇——即 2/3 的账本仍是孤儿。

### 对照 C：纯时间分段（相邻账本间隔 > G 小时即切）

| G | 事件数 |
| --- | --- |
| 1h | 123 |
| 2h | 74 |
| 4h | 51 |
| 6h | 44 |
| 12h | 29 |
| 24h | 14 |

纯时间分段在 **G=1h 时得到 122 个事件**，与本版人判结果（127）量级接近。
这说明：**账本本来就是「一次会话一口气写一批」的**，时间连续性是很强的先验；
但也说明只靠时间会把「同一天上午做 A、下午做 B」强行并成一件——所以本版用时间做骨架、用人判做边界。

### 对照：本版事件内部的相邻对目标相似度

```
{"pairs":389,"p10":0,"p50":0.097,"p90":0.583,"max":1,"ge030":110,"ge050":57}
```

即使在同一事件内，相邻检查点的目标段 2-gram Jaccard 中位数也只有 0.097，p90=0.583。
这证明「用字符 n-gram 设阈值」本身不是合适的判据——不是阈值调得不好，是信号被账本里的日期/序号/圈码稀释了。

## 交付物

- `index.html` — 单文件零依赖，双击可开（2547940 字节）
- `events.json` — 事件数组，含每个事件的来源账本清单与 percept 结构
- `build.mjs` — 生成脚本（幂等）
- `event-plan.tsv` — 人判分组表（from/to/confidence/title/rationale），可直接审阅与修改
- `judge-sweep.mjs` — 判据对照实验（三组机械判据的真跑扫描，VERIFY 里的表就是它输出的）
- `verify.mjs` — 本自检器
- `pixel-stats.py` — 截图像素统计（判空白用）
- `shot-01-first-screen.png` / `shot-02-wide-event.png` — headless Chrome 真渲染截图

## 复算方式

```
cd artifacts/wb-event-preview
node build.mjs     # 重新生成 index.html / events.json（幂等）
node verify.mjs    # 全量自检，退出码 0 = 全绿
```
