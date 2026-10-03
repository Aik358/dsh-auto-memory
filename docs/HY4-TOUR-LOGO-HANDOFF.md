# HY4 移交：欢迎向导 Logo 动态化 + 排版优化 + CHANGELOG 开场序列

> 移交时间：2026-08-31 · 分支 preview · 最新提交 b18ec38 · 回归 38/38
> 接收方：HY4（无图像输出能力，全部用 HTML/CSS/JS 在 lib/client.js 里实现）
> 设计美学已定稿，**不要改风格方向**，只做实现与打磨。

## 0. 目标（三件事）

1. **向导 Logo 动态化**：把首启欢迎向导顶部的"emoji+圆圈"占位，升级为**纯 CSS 绘制的三层磨砂玻璃板堆叠 Logo**（动态 UI），并给每个向导步骤做差异化的动画变体。
2. **向导排版打磨**：标题/正文/开关卡/按钮的层级、间距、字重、对齐整体优化。
3. **CHANGELOG 开场序列**：更新弹窗打开时先播放一段 Logo 动画——**出现（组装）→ 展开 → 消散 → CHANGELOG 内容浮现**——然后才显示更新文字。

## 1. 视觉基准（必读）

**参考图（你可以直接用 Read 工具查看）**：
`C:\Users\JH Z\.zcode\cli\image-cache\sess_0b2cadc8-5721-45df-aa42-141f25c2f627\image-29f869ddd0141834297e324a8c0b2176.png`

若读不到，文字描述如下——这是定稿美学，所有实现以它为准：

- **主体**：三片圆角方形磨砂玻璃板，等距垂直堆叠（像三层托盘），等轴测视角（绕 Z 轴约 45°+俯视约 55°，即 `rotateX(~55deg) rotateZ(~45deg)` 的观感）
- **玻璃质感**：近无色的乳白磨砂玻璃，半透明（能微透背后），**边缘可见的厚度**（顶边一条亮白 Fresnel 边光，底边稍暗形成厚度感），圆角很大（约为边长 22%），边光干净但不发光——是"厚亚克力板的自然白边"，绝无霓虹描边
- **背后**：三四团**失焦的蓝紫 bokeh 光斑**（#4D6BFE 蓝、#9B7EFF 紫，大的柔圆，blur 很重），左上/右/下各一团——透过玻璃能隐约看到糊掉的光斑（这是"磨砂"成立的关键）
- **背景**：深藏青 #0B0F1A（在向导里即卡片深色底），中央微亮
- **整体**：安静、高级、有触感；高光是**糊开的宽光**（matte satin），不是镜面锐线

色板令牌（向导 CSS 已有，直接用）：`--dam-accent #2456C4→#7EA4FF`、面板深底 `rgba(24,26,32,.9)`、白色高光系 `rgba(255,255,255,.x)`。

## 2. 现状代码定位（全部在 lib/client.js）

- **向导步骤数据**：`var TOUR_STEPS = [`（约 2388 行起）——每步 `{ core: '🫧' /*emoji*/, kicker, title, text, toggles?/dl?/externalScan?/final? }`
- **向导渲染**：`DialogHost()` 内 `dialogState.kind === 'welcomeTour'` 分支；orb 结构：
  - `[data-dam-tour-orb-wrap]`（150×150, perspective）→ `[data-dam-tour-orb]`（形变圆球,要被替换）→ `[data-dam-tour-orb-core]`（emoji,要被替换/重定位）
- **向导 CSS**：顶部 `var CSS = [` 数组中 `[data-dam-tour-*]` 段（搜索 `dam-tour-orb`）；已有可复用动画：`@property --dam-orb-a`（conic 高光扫过角度）、`dam-orb-float`（浮沉）、`dam-tour-swap`（切页滑入）
- **更新弹窗**：DialogHost 内 `dialogState.kind === 'update'` 分支（CHANGELOG 卡片）；小卡样式变量 `overlay/box/head/sub` 同函数内
- **引擎步/外部扫描/开关**：已实现且实测通过，**逻辑不要动**，只可调样式

## 3. 任务 A：CSS 三层玻璃板 Logo（核心交付）

在 orb 容器里用纯 CSS 绘制（无图片、无 emoji 主体）：

**结构建议**（可自行优化，保持 `data-dam-tour-orb-wrap` 外层标签与 150×150 尺寸）：
```
orb-wrap（perspective 容器,背景放射微光）
  ├─ bokeh ×3-4（position:absolute, radial-gradient 圆斑, filter:blur(18px), 各自缓慢漂移动画）
  └─ slab-stage（transform-style:preserve-3d; rotateX(55deg) rotateZ(45deg)）
       ├─ slab ×3（86×86 圆角方块,各 translateZ 间距 ~22px）
```

**每片 slab 的质感要点**（对照参考图逐条）：
- 主体：`linear-gradient(135deg, rgba(255,255,255,.16), rgba(255,255,255,.05))` + 大圆角（radius ~26%）+ `backdrop-filter: blur(6px)`（透出 bokeh 的关键）
- 厚度：`::before` 同形状在 Z 轴负方向偏移 6-8px（或多层 box-shadow 叠出侧壁），颜色比顶面暗一档的乳白
- Fresnel 边光：`border: 1.5px solid rgba(255,255,255,.55)` + `inset 0 1px 0 rgba(255,255,255,.65)`（顶缘最亮）
- 磨砂内部：`inset 0 0 24px rgba(255,255,255,.14)`（奶白雾感）；**严禁** box-shadow 用饱和蓝紫发光
- 投影：整 stage 下方 `0 24px 48px rgba(4,8,20,.45)` 柔影

**动画**：
- **入场**（每次切步触发，替换现有 `dam-tour-swap` 对 body 的作用——orb 保持常驻,只做轻微重排）：三片板自上而下依次落下（translateY(-26px)+scale(.85)+opacity 0 → 归位），间隔 160ms，`cubic-bezier(.2,.9,.3,1.15)` 回弹；bokeh 随后 0.4s 淡入
- **循环**：整 stage 缓慢浮沉 ±5px（4.5s ease-in-out infinite，三片相位微错开产生"呼吸层叠"）；复用 conic 高光扫过（把现有 `--dam-orb-a` 机制搬到最上片 slab 的 `::after`）
- **每步差异化**（简单方案即可）：`TOUR_STEPS[].core` 的 emoji 不再当主体，改为**小的玻璃徽章**吸附在堆叠体右上/中央（像 app 角标），徽章随步切换 + 一次 pop 入场；或让各步的 bokeh 色相/数量微变——两种都行，你选一种做统一
- **降级**：`@media (prefers-reduced-motion: reduce)` 全部动画静止只保留静态构图；emoji 兜底（CSS 不可用时）不需要——CSS 必然可用

## 4. 任务 B：向导排版打磨（审美权限在你，约束如下）

- 目标：标题-正文字阶更清晰（title 21px→可调）、开关卡与正文间距、kicker 字距、按钮行呼吸感
- 保持：整体 620px 中央悬浮窗、液态玻璃语言、`data-dam-*` 属性名（校验/测试引用）、中文两行内不换行破相
- 逐屏检查：开关步（最多 2 卡）、外部扫描步（7 卡滚动,注意 max-height 与滚动条样式）、完成步（徽章+五行指引,注意左对齐块与居中标题的过渡）

## 5. 任务 C：CHANGELOG 开场序列

更新弹窗（`kind === 'update'`）打开时的四段动画，全部在现有小卡内实现（可在卡顶部临时扩一个 ~150px 的舞台区）：

1. **出现/组装**（0-0.7s）：任务 A 的三层玻璃板 Logo 缩小版在此依次落下组装
2. **展开**（0.7-1.1s）：三片板短暂散开（间距拉大 + 轻微旋转）再收回——"揭示"感
3. **消散**（1.1-1.5s）：整体 blur+scale(1.06)+opacity → 0，舞台区高度收合
4. **内容浮现**（1.4s 起）：CHANGELOG 标题与文字淡入上移

实现要求：
- 用 CSS animation-delay 编排单次时间线；**点击任意处立即跳到内容**（加 `data-skip` 类终止动画）；总时长 ≤1.8s
- 内容 DOM 始终在（无障碍/防闪烁），只是视觉上延迟显示
- 首次（`first` kind）与 `notice` 卡**不加**此序列，只有 update 卡要
- 性能：动画元素控制在 ~10 个节点内；结束后移除 will-change

## 6. 红线（违反任何一条都算失败）

1. `lib/client.js` 之外的文件一律不动（除非你发现必要,先在 PR 说明）
2. 不改任何后端/配置键/`data-dam-*` 现有属性名与函数名（`TOUR_STEPS` 各字段 key 保留,`core` 字段可改语义但保留字段）
3. 不动：fv2 决策核、M5/M6 validator、后端路由、38 个 smoke-test*.mjs 的期望
4. 每?完成一步：`node --check lib/client.js` 必须过；最终跑全量 `for t in smoke-test*.mjs; do node "$t" >/dev/null 2>&1 || echo FAIL $t; done` 必须 0 FAIL（38 套件,偶尔 m53 串行抖动,单跑复确认即可）
5. commit 已授权（用户明确要求），push 仍需确认；小步提交（A/B/C 各一个 commit）
6. 3080 由用户自己管理——**不要启停 3080**，改完代码告诉用户刷新页面即可（client bundle 按请求读盘）
7. 你的环境没有真实用户的 ~/.dsh 数据依赖——不要读写 `~/.dsh`（测试套件自己隔离）

## 7. 验收标准（用户视角）

- 打开欢迎向导：顶部是会动的三层玻璃板 Logo（不是 emoji+圆圈），切步时板层重排+徽章切换,观感贴近参考图
- 整个向导排版比现在更精致（对照实机截图自查）
- 触发更新弹窗：先看到 Logo 组装→展开→消散,然后 CHANGELOG 浮现,点击可跳过
- 38/38 回归全绿,语法检查通过,2-3 个 commit 落库

——以上。完成后向用户汇报改了哪些区块与动画时序即可。
