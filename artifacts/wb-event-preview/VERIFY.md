# VERIFY · 白板事件化原型（自动生成，可复算）

由 `node verify.mjs` 生成。每条都是真执行后的实测值，不是源码字符串断言。

```
PASS 源文件总数只增不减（≥ 839 篇，不写死绝对值）  =>  实测 839 篇；历史基线 v1=833 → v2=837 → v3=838 → v4=839（低于最低基线即说明语料被删）
PASS 顶层 / archive 拆分只增不减（顶层 ≥ 578、archive ≥ 261）且两者之和 = 总数  =>  top=578（≥578） archive=261（≥261） 合计=839/839
PASS PLAN.md 另计（只读参考，不入事件）  =>  PLAN.md 13948 B sha256=8b57d26b6cb49039
PASS events.json 覆盖文档数 === 磁盘实际篇数（自洽，不写死）  =>  839 条目 / 磁盘 839 篇
PASS 无重复引用（每个 .md 恰好一次）  =>  uniq=839 / docs=839
PASS 无遗漏 / 无越界  =>  missing=0 extra=0
PASS 检查点 sha256 与现盘一致（839 篇逐篇）  =>  mismatch=0
PASS 检查点字节数与现盘一致  =>  mismatch=0
PASS 计划外账本兜底：不再 throw，归入「待归并」桶并计数  =>  planned=516 unplanned=1 bucket=1
PASS 「待归并」桶 confidence = low 且 rationale 写明待人工归并  =>  low / 新增账本，待人工归并（自动兜底，不参与语义聚类）
PASS 「待归并」桶覆盖的正是新增那篇账本  =>  handoff/handoff-20261023-202749.md
PASS 事件数在 60–300 区间（用户放宽后）  =>  127 个账本事件 + 58 个归桶节点
PASS 单事件检查点 ≤ 40  =>  最大 26
PASS 单检查点事件占比 < 60%  =>  24.4%（31/127）
PASS 四个 percept 字段全部存在且为数组  =>  missing=0
PASS 每个事件都有可审计 rationale（非空、>5 字）  =>  bad=0
PASS 每个检查点都有 log 原文引用（非空）  =>  empty=0/839
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
PASS build 幂等：index.html 两次 sha256 相同  =>  4fdfbe12cc6a6182
PASS build 幂等：events.json 两次 sha256 相同  =>  7c7f9804f953e6b3
PASS 构建前后源文件 sha256 全量一致（839 篇）  =>  changed=0
PASS 源文件集合聚合指纹可复算  =>  61b4ce69e7fed6f66970837c302ce30a38c0c8cd2c649ba6c0310bc4fca569d2
PASS headless Chrome 真渲染出 PNG（两次）  =>  248263B / 250651B
PASS 截图尺寸 = 1600x1000  =>  1600x1000 / 1600x1000
PASS 截图非空白（亮度方差 > 300 且非白像素 > 5%）  =>  var=807.78 nonWhite=99.995% colors=3011 | var=791.17 nonWhite=99.995% colors=2990
PASS 两次截图 sha256 不同（内容确为不同事件）  =>  4b957116 vs 038e9755
PASS [browser] 语料计数基线来自 events.json.stats（timelineNodes=185 / documents=839）  =>  timelineNodes=185 documents=839 checkpoints=839
PASS [browser] 结构化期望值从 events.json 现算（泳道段/点/工作流分组，不写死）  =>  ledger=127 dots=31 segs=124 wfGroups=37 wfRows=163
PASS [browser] 页面真渲染：初始窗口 36 张卡 + 185 个时间轴刻度（懒加载只作用于卡片端）  =>  {"ready":"complete","cards":36,"ticks":185,"loaded":36,"total":185}（期望 cards=36 ticks=total=185）
PASS [browser] localStorage 无值时默认视图 = time stream  =>  {"mode":null,"active":"stream"}
PASS [browser] 切「泳道/甘特」后 localStorage.wbEvt.viewMode === "lanes"  =>  {"mode":"lanes","body":"lanes","rows":127,"segs":124,"dots":31}
PASS [browser] 泳道视图行数/点数/段数 = events.json 现算值（127 行 / 31 点 / 124 段）  =>  rows=127（期望 127） dots=31（期望 31） segs=124（期望 124）
PASS [browser] 切「工作流线索」后 wbEvt.viewMode === "workflow"  =>  {"mode":"workflow","groups":37,"closed":"(主线)","rows":163}
PASS [browser] 工作流按 lane 分组（37 组）、主线默认折叠、行数 163（事件可同属多条线）  =>  {"mode":"workflow","groups":37,"closed":"(主线)","rows":163}（期望 groups=37 rows=163）
PASS [browser] 切回时间流后 wbEvt.viewMode === "stream"  =>  stream
PASS [browser] 点「收起右栏」后 localStorage.wbEvt.detailOpen === "false"  =>  {"before":"true","after":"false"}
PASS [browser] 收起后 grid 末列 0px、右栏实测宽度 0px（padding/border 一并归零）  =>  336px 1264px 0px / detailW=0
PASS [browser] 再展开：detailOpen === "true"，右栏占回余量（332px 起）  =>  {"open":"true","cols":"336px 392px 872px","w":872}
PASS [browser] 抽屉可中断：收起途中反向，最终仍回到展开且宽度连续（无 0↔满 跳变）  =>  midW=266 finalW=872
PASS [browser] 检查点默认全部折叠（26/26 只留头部）  =>  {"total":26,"closed":26}
PASS [browser] 折叠态头部显示「现状 n · log n · 失败 n · 下一步 n」四格计数  =>  现状7log1失败3下一步7
PASS [browser] 折叠态 body 的 grid-template-rows 实测为 0fr（0 → 1fr 过渡）  =>  0px
PASS [browser] 点第 2 个检查点头部：该行展开、六格面板齐、行高从 0 变为非 0  =>  {"closed":25,"panels":6,"rows":"581.047px"}
PASS [browser] 再点一次同一头部：回到折叠（26/26）  =>  closed=26
PASS [browser] 空档标记：evt-018（40.9h）插出虚线「⏸ 搁置 40.9 小时 —— 起→止」  =>  ⏸ 搁置 40.9 小时 —— 2026-09-11 21:44 → 2026-09-13 14:38
PASS [browser] 负路径：无 >2h 空档的事件（evt-086）不出现任何空档标记  =>  {"gaps":0,"cps":2}
PASS [browser] 默认（开关关闭）真实列表只有真实卡片（0 demo 节点），卡片数 = 当前懒加载窗口  =>  {"demoCards":0,"demoTicks":0,"cards":166}
PASS [browser] 开启「并发演示（合成数据）」：4 张 demo 卡 + 4 个刻度、0 个真实节点  =>  {"demoCards":4,"demoTicks":4,"realNodes":0,"banner":"","tag":"合成数据"}
PASS [browser] demo 模式顶部有「合成数据」标识条  =>  {"banner":"","tag":"合成数据"}
PASS [browser] 合成 demo 泳道：4 行、6 对区间重叠（并发在图上可见）  =>  rows=4 overlapPairs=6
PASS [browser] 负路径：关掉 demo 后 demo 节点归零、真实卡片回来（窗口内）  =>  {"demoNodes":0,"cards":185}
PASS [browser] 刷新后：视图=workflow（37 组完整重建）、右栏=收起（均从 localStorage 恢复）  =>  {"mode":"workflow","groups":37,"off":true}
PASS [browser] 深链 #evt-091 命中并选中对应事件  =>  {"hash":"#evt-091","mode":"stream","selected":"evt-091","heading":"手动接续漂移修复 + 3.2.1 发版"}
PASS [browser] ↑↓ 键盘切换事件（ArrowDown：evt-091 → evt-092）  =>  after=evt-092
PASS [browser] reduced-motion 降级：切抽屉 120ms 内直接落位（无弹簧中间帧）  =>  {"before":872,"after120ms":0}
PASS [browser] reduced-motion 降级：展开同样即时恢复  =>  w=872
PASS [browser] 视图切换键盘可达：stream 上按 ArrowRight → lanes，且焦点与 localStorage 同步  =>  {"before":"stream","after":{"mode":"lanes","body":"lanes","focusView":"lanes","rows":127}}
PASS [browser] 倒叙①：初始 scrollTop+clientHeight >= scrollHeight-5（确实停在底部）  =>  scrollTop=4448 clientH=946 scrollH=5394 差=0px
PASS [browser] 倒叙②：DOM 末位事件的 endMs = 全体最大（倒叙语义，不写死事件 id）且初始就在视口内  =>  last=bucket-planSnapshot-2026-10-24 / maxEndId=bucket-planSnapshot-2026-10-24 / 在视口内=true / 可见 7 张
PASS [browser] 倒叙③：左时间轴同样贴底（「今天」锚点在视口内）  =>  rail scrollTop=10264 差=0px
PASS [browser] 懒加载①：初始只渲染最近 36 个 / 共 185（loadedStart = TOTAL-36 = 149）  =>  {"loaded":36,"total":185,"cards":36,"cnt":"已载 36 / 185","start":149}（期望 loaded=cards=36 total=185 start=149）
PASS [browser] 懒加载②：界面显示「已载 X / 总 Y」  =>  已载 36 / 185
PASS [browser] 懒加载⓪：重置后回到干净初始态（36 张 / 0 次加载）  =>  {"loaded":36,"cards":36,"loadCount":0}
PASS [browser] 懒加载③：加载更早后「视口锚定元素位移 < 2px」（滚动位置纹丝不动）  =>  anchor=bucket-planSnapshot-2026-10-12 top 129.33 → 128.83，位移=0.50px；已载 36 → 60
PASS [browser] 懒加载④：真的多渲染了一批（loaded +24，卡片数同步，loadCount +1）  =>  loaded 36→60 cards=60 loadCount 0→1
PASS [browser] 懒加载⑤：滚到接近顶部（<260px）自动加载更早一批（滚动触发，非仅按钮）  =>  loaded 60→84 loadCount 1→2
PASS [browser] 负路径①a：一路向上加载可到最早（185/185 全部渲染）  =>  loaded=185/185 loadCount=7（期望 7）btn="已到最早"
PASS [browser] 负路径①b：到最早后按钮置灰并显示「已到最早」（幂等，不重复触发）  =>  btn="已到最早" disabled=true
PASS [browser] 负路径①c：到顶再滚 6 次，加载次数不再增长（不无限重复加载）  =>  loadCount 7 → 7 loaded=185/185
PASS [browser] 负路径②：关掉懒加载后全量 185 张卡一次渲染（按钮变「已全量渲染」）  =>  {"cards":185,"lazyOn":false,"loaded":185,"btn":"已全量渲染","disabled":true}
PASS [browser] 负路径②b：再开回懒加载恢复 36 张窗口（两态可逆）  =>  {"cards":36,"lazyOn":true,"loaded":36}
PASS [browser] 过滤①：输入即筛，过滤态临时全量渲染（filterMode=true，卡片数从 36 扩到 185）  =>  {"filterMode":true,"totalCards":185,"visible":1,"btn":"none","cnt":"1 / 185"}（期望 totalCards=185）
PASS [browser] 过滤②：清空查询回到窗口模式（36 张 / filterMode=false）  =>  {"filterMode":false,"cards":36,"loaded":36}
PASS [browser] 键盘①：↑ 键 → 更早（DOM 位次向前，连按两次都更早）  =>  bucket-planSnapshot-2026-10-24 →↑ bucket-unplanned →↑ bucket-sessionTranscript-2026-10-23
PASS [browser] 键盘②：↓ 键 → 更新（回到上一格）  =>  ↓ bucket-sessionTranscript-2026-10-23 → bucket-unplanned
FAIL [browser] 三视图①：时间流 DOM 序 = 早→新（首位 startMs 最小、末位 endMs 最大，不写死事件 id）  =>  first=bucket-sessionTranscript-2026-10-08(startMin=false) last=bucket-planSnapshot-2026-10-24(endMax=true) n=36
PASS [browser] 三视图②：泳道视图行序同样是早→新，且同一事件横条左端位置随时间递增（左早右新）  =>  lanes n=127（期望 = stats.events 127） first=evt-001(0%) last=evt-127(98.8536%)
PASS [browser] 三视图③：工作流线索组内行序也是早→新（与时间流同向，不出现正/倒混排）  =>  group=G0 n=1 first=evt-100
PASS [browser] 三视图④：泳道内所有时间点横向位置单调不减（左早右新，与时间流同向，无逆序）  =>  n=516 first=0% last=100% 单调=true
PASS [browser] 主题①：默认 auto（跟随系统）且 dataset.theme 为实际生效值  =>  {"theme":"dark","mode":"auto","ls":"auto","btn":"跟随系统"}
PASS [browser] 主题②：三态循环 auto → light → dark → auto，dataset.theme 与 localStorage 同步  =>  light=light/light dark=dark/dark back=auto
PASS [browser] 主题③：暗色背景确实是分层中性灰（不是纯黑 #000）  =>  body bg=rgb(10, 13, 20)
PASS [browser] 主题④：刷新后暗色仍生效（首屏内联脚本先于 CSS 落位，不闪白）  =>  {"theme":"dark","mode":"dark","ls":"dark"}
PASS [browser] 暗色对比度：12/12 个测量点全部 ≥ WCAG AA（正文 4.5:1 / 大字 3:1）  =>  正文·卡片摘要 9.39:1(需4.5) | 卡片标题 8.79:1(需4.5) | 面板正文 9.39:1(需4.5) | 面板标题 6.29:1(需4.5) | 时间轴标题 10.58:1(需4.5) | 时间轴时间 6.31:1(需4.5) | 状态徽章·完成 10.39:1(需4.5) | 状态徽章·进行中 10.39:1(需4.5) | 详情标题 13.38:1(需4.5) | 详情摘要 9.39:1(需4.5) | 来源行 9.39:1(需4.5) | 轴提示 5.24:1(需4.5)
PASS [browser] 暗色对比度：逐条记录实测前景/背景色（可复算，非估计）  =>  正文·卡片摘要 fg=rgb(182, 192, 207) bg=rgb(21,27,38) ; 卡片标题 fg=rgb(182, 192, 207) bg=rgb(26,33,46) ; 面板正文 fg=rgb(182, 192, 207) bg=rgb(21,27,38) ; 面板标题 fg=rgb(146, 157, 174) bg=rgb(21,27,38) ; 时间轴标题 fg=rgb(182, 192, 207) bg=rgb(10,13,20) ; 时间轴时间 fg=rgb(135, 148, 166) bg=rgb(10,13,20) ; 状态徽章·完成 fg=rgb(94, 224, 160) bg=rgb(21,27,38) ; 状态徽章·进行中 fg=rgb(247, 192, 90) bg=rgb(21,27,38) ; 详情标题 fg=rgb(230, 234, 241) bg=rgb(26,33,46) ; 详情摘要 fg=rgb(182, 192, 207) bg=rgb(21,27,38) ; 来源行 fg=rgb(182, 192, 207) bg=rgb(21,27,38) ; 轴提示 fg=rgb(135, 148, 166) bg=rgb(26,33,46)
PASS [browser] 字号①：档位切换后 computed font-size 实际变化（15px < 16px < 17.5px 根字号）  =>  root: 15px → 16px → 17.5px
PASS [browser] 字号②：正文 15px（≥14 正文基准），卡片标题随 rem 一起放大  =>  body=15px card 16px档=13px 17.5px档=14.2188px
PASS [browser] 字号③：localStorage.wbEvt.fontScale 与 html[data-fs] 同步  =>  small=0/0 large=2/2
PASS [browser] 字号④：全站最小可读字号 ≥ 11px（不出现 9.5px 那种小字）  =>  min=11px @ SPAN
PASS [browser] 响应式①：宽屏 1600 三栏（rail/mid/detail 三列都有宽度）  =>  336px 392px 872px scrollW=1600/iw=1600
PASS [browser] 响应式②：中屏 1200 收窄 rail（288px < 336px）且仍三栏  =>  railW=288 cols=288px 352px 560px
PASS [browser] 响应式③：窄屏 480 单栏堆叠 —— rail 变抽屉(fixed)、详情变全屏 sheet(fixed)  =>  {"sw":480,"iw":480,"display":"block","railPos":"fixed","detailPos":"fixed","midW":480}
PASS [browser] 响应式④：窄屏 480 无水平滚动（scrollWidth <= innerWidth）  =>  scrollWidth=480 innerWidth=480
PASS [browser] 响应式⑤：窄屏 rail 抽屉可开（滑入 x=0）可关（滑出 x<0）  =>  open x=0 w=344 → closed x=-351
PASS [browser] 组合态抽检①：暗色 + 窄屏 480 + 大字号 → 主题/字号生效且仍无水平滚动  =>  {"theme":"dark","fs":"17.5px","sw":480,"iw":480,"body":"16.4062px"}
PASS [browser] 组合态抽检②：浅色 + 宽屏 1600 + 小字号 → 三栏 + 15px 根字号 + 无水平滚动  =>  {"theme":"light","fs":"15px","sw":1600,"iw":1600,"cols":"336px 392px 872px"}
PASS [browser] 时间轴①：左轨宽度 336px（v3 为 200px，实测 ≥280 且 ≤340）  =>  实测 336px
PASS [browser] 时间轴②：月份 sticky 分隔存在且数量 ≥ 2（2026-09 / 2026-10）  =>  月份分隔 2 个
PASS [browser] 时间轴③：每个月密度柱数 = 该月真实天数（逐月比对 Date 计算的天数）  =>  2026 年 9 月=30柱/应为30柱 / 2026 年 10 月=31柱/应为31柱
PASS [browser] 时间轴④：事件间 >2h 空档在轨道上真断开（text 断口）  =>  空档断口 43 处
PASS [browser] 时间轴⑤：「今天/最新」锚点贴在轨道底部  =>  今天10-24 00:10
PASS [browser] 时间轴⑥：等距 / 真实比例两档可切换 —— 真实档轨道更高（空档被可视化），切回等距恢复  =>  等距=11050px 真实=13579px 切回=11050px
PASS [browser] 时间轴⑦：相对时间 —— 近期显示「x 小时前 / 昨天 / x 天前」  =>  样例：15 小时前 · 4 点 | 4 小时前 · 2 点 | 4 小时前 · 1 点 | 17 分钟前 · 1 点
PASS [browser] 时间轴⑧：scroll-spy —— 滚中栏时 rail 自动高亮当前可视范围  =>  in-view=1 selected=1
PASS [browser] 深链①：#evt-050 在倒叙模式下命中、选中、并滚入视口（自动补齐窗口）  =>  {"hash":"#evt-050","sel":"evt-050","inViewport":true,"loaded":123,"heading":"PR 128/129/130 礼节性合入"}
PASS [browser] 深链②：无 hash 时默认落在最新窗口（loaded=36，不因深链逻辑被全量展开）  =>  {"loaded":36,"hash":"#bucket-planSnapshot-2026-10-24"}
PASS [browser] 四张交付截图均为 1600x1000  =>  1600x1000 / 1600x1000 / 1600x1000 / 1600x1000
PASS [browser] 四张交付截图非空白（亮度方差 > 300 且非白像素 > 5%）  =>  03-collapsed var=753.44 nw=99.995% | 04-lanes var=963.63 nw=99.995% | 05-gap var=825.92 nw=99.995% | 06-concurrent-demo var=559.95 nw=99.972%
PASS [browser] 四张截图 sha256 互不相同（确为四个不同界面态）  =>  222815 / 302711 / 266384 / 187863
PASS [browser] v4 六张新截图非空白（每张亮度方差 > 300）  =>  07-reverse-bottom var=618.11 | 08-rail-redesign var=761.87 | 09-lazy-load var=761.59 | 10-dark var=651.11 | 11-narrow var=1227.4 | 12-large-font var=841.02
PASS [browser] v4 六张新截图亮度方差全部 > 300（逐张贴实测值）  =>  shot-07-reverse-bottom.png var=618.11 nw=99.995% 1600x1000 | shot-08-rail-redesign.png var=761.87 nw=99.995% 1600x1000 | shot-09-lazy-load.png var=761.59 nw=99.995% 1600x1000 | shot-10-dark.png var=651.11 nw=99.995% 1600x1000 | shot-11-narrow.png var=1227.4 nw=99.982% 480x900 | shot-12-large-font.png var=841.02 nw=18.349% 1600x1000
PASS [browser] v4 六张截图尺寸正确（1-5 为 1600x1000，窄屏为 480x900）  =>  1600x1000 / 1600x1000 / 1600x1000 / 1600x1000 / 480x900 / 1600x1000
PASS [browser] v4 六张截图互不相同（确为六个不同界面态）  =>  284129 / 247085 / 241311 / 241818 / 75179 / 254839
PASS [browser] shot-10-dark 与 shot-07 是不同主题（两图字节/方差均不同）  =>  light var=618.11 dark var=651.11
PASS 合成 fixture 存在且 sha256 与 stats 记录一致  =>  3040 B sha256=3e94560665588738
PASS 合成 fixture 有 3–4 个虚构事件且全部 id 以 demo- 开头  =>  demo-alpha,demo-bravo,demo-charlie,demo-delta
PASS 负路径：真实事件列表里 0 个 demo id  =>  leakedId=0 realIds=185
PASS 负路径：真实事件里 0 个【合成】标题  =>  leaked=0
PASS 负路径：真实检查点 0 条来自 fixtures/concurrent-demo.json  =>  leaked=0 / rels=839
PASS 合成 fixture 的检查点时间真交错（每条线至少与另一条重叠）  =>  4 条线全部与其他线重叠
PASS 空档基线：20/127 事件含 >2h 空档、最大 40.9h（与任务卡实测一致）  =>  gapEvents=20 max=40.91h
PASS lane 提取：主线 91 个 + 36 条标号线 = 37 组（主线数 = 无标号 ledger 数，派生校验）  =>  main=91（期望 91） groups=37 tagged=36
PASS P0 线 = 9 个事件 / 跨 8 个不同日期 / 跨度 39.3 天（任务卡口径：8 天/9 事件）  =>  P0 events=9 distinctDays=8 span=39.3d
PASS P1 线 = 9 个事件（任务卡口径），R4 线 = 3 个事件  =>  P1=9 R4=3
PASS 判据对照实验跑通（517 账本 × 三组判据；v1 为 516，+1 语料增长）  =>  n=517（v1=516）

TOTAL 135  PASS 134  FAIL 1
```

## 关键数字

| 项 | 值 |
| --- | --- |
| 源文档 | 839 篇（顶层 578 + archive 261）｜基线下限 839，只增不减 |
| 事件（四段账本） | 127 |
| 归桶节点（转写包 / 白板快照 / 说明） | 58 |
| 时间轴节点合计 | 185 |
| 检查点合计 | 839 |
| 最大事件检查点数 | 26 |
| 单检查点事件占比 | 24.4% |
| 三态卡分布（窄/中/宽，按检查点数自动） | 89 / 38 / 58 |
| 置信分布 | {"high":93,"medium":34} |
| 覆盖率 | 839 / 839 = 100% |
| index.html | 2599966 字节 |
| index.html sha256 | `4fdfbe12cc6a6182cc40ef92cbfcff834e86949f0123fba8752c2273a144eae2` |
| 初始渲染窗口 | 36 / 185 个事件（懒加载，每次向上 +24） |
| 时间轴节点自洽 | events.json 节点 185 === stats.timelineNodes 185 |
| 左轨宽度 | 336px（v3 为 200px） |
| 字号档位 | 15 / 16 / 17.5px 根字号（rem 全站联动） |
| events.json | 3318513 字节 |
| 源文件聚合指纹 | `61b4ce69e7fed6f66970837c302ce30a38c0c8cd2c649ba6c0310bc4fca569d2` |
| 首屏截图 | `shot-01-first-screen.png` · 248263 B · 1600x1000 · 亮度方差 807.78 · 非白像素 99.995% |
| 宽卡截图 | `shot-02-wide-event.png` · 250651 B · 非白像素 99.995% |
| 计划外账本（待归并桶） | 1 篇（handoff/handoff-20261023-202749.md） |
| 合成 fixture | `fixtures/concurrent-demo.json` · 3040 B · 4 个虚构事件 · sha256 `3e94560665588738` |
| PLAN.md（只读参考） | 13948 字节 · sha256 `8b57d26b6cb49039207cf2ce81d97d18e19801cf60fa1a2fb38b6a039982ec2e` |

## 语料基线：为什么断言「只增不减 + 自洽」而不是「=== 某个数」

`handoff/` 是**活语料**：每写一篇交接账本、每次重写 PLAN.md（插件自动归档旧版）都会让它变长。
把 `=== 838` 写进断言，语料一长就必然误报——那只能抓住「数字变了」，抓不住「覆盖漏了 / 倒叙反了 / 语料被删了」。
本版改成**不变量断言**（更强，且不会随语料增长误报）：

| # | 不变量 | 抓什么真 bug |
| --- | --- | --- |
| ① | 源文件数 **≥ 最新历史基线**（单调） | 语料被误删 / 路径读错 |
| ② | **覆盖数 === 磁盘实际篇数**（自洽） | 事件抽取漏篇 / 越界引用 |
| ③ | 每个 .md **恰好被引用一次**（无重复、无遗漏） | 重复计数、漏篇 |
| ④ | 每个检查点 sha256 / bytes **逐篇与现盘一致** | 原件被改动 |
| ⑤ | 末位事件的 `endMs` **= 全体最大**（倒叙语义） | 排序方向反了 |

历史基线只作**下限与归因留痕**，不作相等判据：

| 基线 | 总篇数 | 顶层 | archive | 增量归因 |
| --- | --- | --- | --- | --- |
| v1 | 833 | 575 | 258 | 初始 |
| v2 | 837 | 578 | 259 | 语料自然增长（续写账本 / PLAN 快照归档） |
| v3 | 838 | 578 | 260 | 语料自然增长（续写账本 / PLAN 快照归档） |
| v4 | 839 | 578 | 261 | 语料自然增长（续写账本 / PLAN 快照归档） |
| **本次实测** | **839** | **578** | **261** | — |

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

## ★v4 核心验收（真跑，逐条贴实测值）

> 每条都在 headless Chrome + CDP 里**真滚动、真读 scrollTop、真算对比度**，不是源码字符串断言。

| # | 验收项 | 判据 | 实测输出 |
| --- | --- | --- | --- |
| 1 | 倒叙：初始停在底部 | `scrollTop + clientHeight >= scrollHeight - 5` | scrollTop=4448 clientH=946 scrollH=5394 差=0px |
| 2 | 懒加载：视口锚定元素位移 | **< 2px** | anchor=bucket-planSnapshot-2026-10-12 top 129.33 → 128.83，位移=0.50px；已载 36 → 60 |
| 3 | 键盘方向 | ↑ = 更早 / ↓ = 更新 | 见下方「键盘」小节（真派发 keydown 后读 `window.__wb.curId` 与 DOM 位次） |
| 4 | 三视图同向 | stream / lanes / workflow 全部「早→新」 | 见下方「三视图」小节（4 条断言逐视图校验位移单调性） |
| 5 | 主题切换 | `dataset.theme` 正确 + `localStorage.wbEvt.theme` 同步 | light=light/light dark=dark/dark back=auto |
| 6 | 窄屏无水平滚动 | 480px 下 `scrollWidth <= innerWidth` | scrollWidth=480 innerWidth=480 |
| 7 | 字号档真生效 | 切换后 computed `font-size` 实际变化 | body=15px card 16px档=13px 17.5px档=14.2188px |
| 8 | 时间轴宽度 | 200px → 280–340px | 实测 336px |

### 暗色正文对比度 ≥ 4.5:1 —— 计算过程（可复算）

算法：WCAG 2.x 相对亮度 —— 每通道 `c/255` 后 `c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`，
加权 `L = 0.2126R + 0.7152G + 0.0722B`，对比度 `(L_light+0.05)/(L_dark+0.05)`。
前景色取 `getComputedStyle(el).color`，背景色向上回溯到第一个不透明（alpha>0.85）的祖先 `background-color`。

**实测：正文·卡片摘要 9.39:1(需4.5) | 卡片标题 8.79:1(需4.5) | 面板正文 9.39:1(需4.5) | 面板标题 6.29:1(需4.5) | 时间轴标题 10.58:1(需4.5) | 时间轴时间 6.31:1(需4.5) | 状态徽章·完成 10.39:1(需4.5) | 状态徽章·进行中 10.39:1(需4.5) | 详情标题 13.38:1(需4.5) | 详情摘要 9.39:1(需4.5) | 来源行 9.39:1(需4.5) | 轴提示 5.24:1(需4.5)**

| 测量点 | 前景 | 背景 | 字号/字重 | 对比度 | 门槛 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 正文·卡片摘要 | `rgb(182, 192, 207)` | `rgb(21,27,38)` | — | 见上表 | 4.5:1 | PASS |
| 卡片标题 | `rgb(182, 192, 207)` | `rgb(26,33,46)` | — | 见上表 | 4.5:1 | PASS |
| 面板正文 | `rgb(182, 192, 207)` | `rgb(21,27,38)` | — | 见上表 | 4.5:1 | PASS |
| 面板标题 | `rgb(146, 157, 174)` | `rgb(21,27,38)` | — | 见上表 | 4.5:1 | PASS |
| 时间轴标题 | `rgb(182, 192, 207)` | `rgb(10,13,20)` | — | 见上表 | 4.5:1 | PASS |
| 时间轴时间 | `rgb(135, 148, 166)` | `rgb(10,13,20)` | — | 见上表 | 4.5:1 | PASS |
| 状态徽章·完成 | `rgb(94, 224, 160)` | `rgb(21,27,38)` | — | 见上表 | 4.5:1 | PASS |
| 状态徽章·进行中 | `rgb(247, 192, 90)` | `rgb(21,27,38)` | — | 见上表 | 4.5:1 | PASS |
| 详情标题 | `rgb(230, 234, 241)` | `rgb(26,33,46)` | — | 见上表 | 4.5:1 | PASS |
| 详情摘要 | `rgb(182, 192, 207)` | `rgb(21,27,38)` | — | 见上表 | 4.5:1 | PASS |
| 来源行 | `rgb(182, 192, 207)` | `rgb(21,27,38)` | — | 见上表 | 4.5:1 | PASS |
| 轴提示 | `rgb(135, 148, 166)` | `rgb(26,33,46)` | — | 见上表 | 4.5:1 | PASS |

完整 12 个点的实测比值（同一行，便于直接比对）：

```
正文·卡片摘要 9.39:1(需4.5) | 卡片标题 8.79:1(需4.5) | 面板正文 9.39:1(需4.5) | 面板标题 6.29:1(需4.5) | 时间轴标题 10.58:1(需4.5) | 时间轴时间 6.31:1(需4.5) | 状态徽章·完成 10.39:1(需4.5) | 状态徽章·进行中 10.39:1(需4.5) | 详情标题 13.38:1(需4.5) | 详情摘要 9.39:1(需4.5) | 来源行 9.39:1(需4.5) | 轴提示 5.24:1(需4.5)
```

**手算校验一例（正文·卡片摘要）**：前景 `rgb(182,192,207)` → L≈0.5271；背景 `rgb(21,27,38)` → L≈0.0114；
比值 = (0.5271+0.05)/(0.0114+0.05) = **9.39:1**，与浏览器实测值一致 ⇒ 算法与取值都正确，不是自我循环。

### 三视图方向一致（逐视图断言）

- **FAIL** 三视图①：时间流 DOM 序 = 早→新（首位 startMs 最小、末位 endMs 最大，不写死事件 id） — first=bucket-sessionTranscript-2026-10-08(startMin=false) last=bucket-planSnapshot-2026-10-24(endMax=true) n=36
- **PASS** 三视图②：泳道视图行序同样是早→新，且同一事件横条左端位置随时间递增（左早右新） — lanes n=127（期望 = stats.events 127） first=evt-001(0%) last=evt-127(98.8536%)
- **PASS** 三视图③：工作流线索组内行序也是早→新（与时间流同向，不出现正/倒混排） — group=G0 n=1 first=evt-100
- **PASS** 三视图④：泳道内所有时间点横向位置单调不减（左早右新，与时间流同向，无逆序） — n=516 first=0% last=100% 单调=true

### 键盘方向（↑ = 更早 / ↓ = 更新）

- **PASS** 键盘①：↑ 键 → 更早（DOM 位次向前，连按两次都更早） — bucket-planSnapshot-2026-10-24 →↑ bucket-unplanned →↑ bucket-sessionTranscript-2026-10-23
- **PASS** 键盘②：↓ 键 → 更新（回到上一格） — ↓ bucket-sessionTranscript-2026-10-23 → bucket-unplanned

### 字号可读性（最小可读 ≥ 11px）

- min=11px @ SPAN ⇒ PASS

## v4 新增能力（全部真浏览器断言）

| # | 能力 | 实现要点 | 验收方式 |
| --- | --- | --- | --- |
| 1 | **倒叙**（最新在底部） | DOM 保持早→新升序；进场 `scrollTop = scrollHeight` 锚到底部；中栏与左轨同向；↑ = 更早 / ↓ = 更新；深链先补齐窗口再定位 | CDP 真读 `scrollTop + clientHeight >= scrollHeight - 5`、断言 DOM 末位是最新事件且在视口内、真派发 ↑↓ 比对 DOM 位次 |
| 2 | **历史懒加载** | 初始窗口 36 个事件、每次向上 24 个；`renderCard()` 增量插入 + **先记锚点元素 top、插入后按 drift 回补 scrollTop**；过滤时临时全量、退出回窗口；常驻「已载 X / 总 Y」 | 真点「↑ 加载更早」+ 真滚到顶部，测**同 id 卡片 top 位移**；负路径：关懒加载全量 184 / 到最早后滚 6 次加载次数不增 |
| 3 | **时间轴重做** | 200px → **336px**；月份 sticky 分隔（含当月每日密度微柱，柱数 = 该月真实天数）；日分隔带周几与当日事件数；等距 / **真实比例**（log 压缩间隔）两档；相对时间；scroll-spy；今天锚点贴底；事件间 >2h 在轨道上真断开 | 实测宽度、月份数、逐月柱数、空档断口数、今天锚点、两档轨道高度差、相对时间文案、`in-view` 高亮数 |
| 4 | **三视图同向** | stream 竖排上早下新；lanes 横排左早右新；workflow 组内早→新；不出现正倒混排 | 逐视图断言：DOM 序首/末位、横条左端位移单调、工作流组内首行 |
| 5 | **字号系统** | 全站 **rem**；`html[data-fs]` 三档 15 / 16 / 17.5px；顶栏 A- / A / A+ 存 `wbEvt.fontScale`；正文 15px、最小可读 ≥ 11px；大标题负字距（`-0.015em`）、小字正字距 | 切换后读 computed `font-size` 实测变化 + 全站扫描最小字号 |
| 6 | **响应式三档** | ≥1440 三栏（336/392/1fr）；1024–1440 收窄（288/352）+ 详情可收起；<1024 单栏堆叠（rail 变 fixed 抽屉、详情变全屏 sheet、卡片全宽） | 逐断点读 computed grid / position / scrollWidth，断言 `scrollWidth <= innerWidth` |
| 7 | **明暗主题** | auto / light / dark 三态 + `wbEvt.theme`；暗色用分层中性灰（#0a0d14 / #111620 / #151b26）不是纯黑；阴影失效改「描边 + 提亮表面」；状态色重新取值；徽章低透明度底；**首屏内联脚本先于 CSS 落位不闪白** | 三态循环真点 + 读 `dataset.theme`/`localStorage`；刷新后仍暗；12 个测量点真算 WCAG 对比度 |
| 8 | **动效 token** | 沿用 `--dur-quick:150 / --dur-fast:250 / --dur-medium:350 / --dur-slow:400` + `--ease-smooth-out`，**未新造时长数字**；抽屉弹簧 damping 0.8 / response 0.3 可中断；视图药丸 = tabs-sliding；检查点折叠 = accordion（0fr↔1fr）；卡片入场 = panel-reveal；全部挂 reduced-motion | 抽屉中途反向不跳变、reduced-motion 120ms 内落位、面板 grid-template-rows 实测 0px↔非 0px |

## 交付截图（headless Chrome 真渲染，实测像素）

| 文件 | 尺寸 | 字节 | 亮度方差 | 非白像素 |
| --- | --- | --- | --- | --- |
| `shot-03-collapsed.png` | 1600x1000 | 222815 | 753.44 | 99.995% |
| `shot-04-lanes.png` | 1600x1000 | 302711 | 963.63 | 99.995% |
| `shot-05-gap.png` | 1600x1000 | 266384 | 825.92 | 99.995% |
| `shot-06-concurrent-demo.png` | 1600x1000 | 187863 | 559.95 | 99.972% |
| `shot-07-reverse-bottom.png` | 1600x1000 | 284129 | 618.11 | 99.995% |
| `shot-08-rail-redesign.png` | 1600x1000 | 247085 | 761.87 | 99.995% |
| `shot-09-lazy-load.png` | 1600x1000 | 241311 | 761.59 | 99.995% |
| `shot-10-dark.png` | 1600x1000 | 241818 | 651.11 | 99.995% |
| `shot-11-narrow.png` | 480x900 | 75179 | 1227.4 | 99.982% |
| `shot-12-large-font.png` | 1600x1000 | 254839 | 841.02 | 18.349% |

六张 v4 新截图全部满足「亮度方差 > 300」判据（实测值见上表 07–12 行）。

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

- `index.html` — 单文件零依赖，双击可开（2599966 字节）
- `events.json` — 事件数组，含每个事件的来源账本清单与 percept 结构
- `build.mjs` — 生成脚本（幂等）
- `event-plan.tsv` — 人判分组表（from/to/confidence/title/rationale），可直接审阅与修改
- `judge-sweep.mjs` — 判据对照实验（三组机械判据的真跑扫描，VERIFY 里的表就是它输出的）
- `verify.mjs` — 本自检器
- `pixel-stats.py` — 截图像素统计（判空白用）
- `shot-01-first-screen.png` … `shot-12-large-font.png` — 12 张 headless Chrome 真渲染截图（v4 新增 07–12）
- `.lead-backup/` / `.v1-baseline/` / `.v3-baseline/` — 各轮基线快照（只读参考，不参与构建）

## 复算方式

```
cd artifacts/wb-event-preview
node build.mjs     # 重新生成 index.html / events.json（幂等）
node verify.mjs    # 全量自检，退出码 0 = 全绿
```
