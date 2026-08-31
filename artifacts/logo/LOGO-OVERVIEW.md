# dsh-auto-memory Logo 设计导航（管线第一步：概览）

> 2026-08-31 · 服务对象：GPT-image-2 生成 → Midjourney/视频模型动画化 → 向导头部呈现优化
> 用途位置：首启欢迎向导顶部的玻璃球位（现 150×150,当前是 emoji 占位）；后续可延伸到 README/面板 header。
> 品牌锚点：DeepSeek 蓝 #4D6BFE / 插件强调色 #2456C4→#7EA4FF 渐变 / 液态玻璃材质（与向导卡片同语言）/ 三层记忆店。

## 0. 交付物规格（对后三步都生效）

| 项 | 要求 |
|---|---|
| 静态图（GPT-image-2 产出） | 1:1，≥1024px，居中主体，**纯深色底（#0B0F1A）或透明**，无文字、无水印、无边框 |
| 动画化交付（最终给前端的） | **首选：3–5 张分层透明 PNG**（每一"条/层"一张，我方 CSS 逐层展开）；次选 SVG；视频（WebM/MP4 透明底）仅作预览，不入网页 |
| 尺寸 | 前端展示 150×150（@2x 300×300 出图），主场景深色底 |
| 严禁 | 文字/字母 logo（会与"自动记忆"面板标题打架）、照片写实质感、多于 5 层 |

**为什么分层 PNG 而不是视频**：CSS 逐层 transform 动画 = 无限循环、背景透明、跟随亮暗主题、体积几 KB；视频循环会有接缝且透明底编码体积大。Midjourney/视频模型用于**预览动效方向**，定稿后按分层出图。

## 1. 四个设计方向（按与"分条展开"动画语言的契合度排序）

### 方向 C（首推）：玻璃层叠 · "记忆三层"
**概念**：三片倾斜的液态玻璃薄层（对应 情节/事实/技能 三层记忆店），等距平行悬浮，一道蓝紫光柱穿透三层——"记忆被分层存放、被光唤起"。最像 Office 全家桶的花瓣展开：三层依次从上方落下/滑入，最终叠成等距层叠体。
- GPT-image-2 prompt：
  > Isometric illustration of three floating translucent glass panels stacked with equal spacing, tilted at 15 degrees, made of frosted liquid glass with soft refraction, a vertical beam of blue-to-violet light (#4D6BFE to #9B7EFF) passing through all three layers, tiny glowing particles along the beam, deep dark navy background #0B0F1A, soft studio lighting, subtle inner glow on panel edges, minimalist, centered composition, no text, 1:1
- 分层拆法：底层 / 中层 / 顶层 / 光柱+粒子 = 4 张透明 PNG
- 动效（CSS）：三层依次 translateY(-40px)→0 + opacity 0→1（间隔 180ms，ease-out-back），光柱最后 scaleX(0→1) 点亮，循环间隔 2.5s

### 方向 A（备选·最简）：记忆涟漪 · 玻璃球+三环
**概念**：一颗液态玻璃球，三圈涟漪环从球心向外扩散（"唤起是一波回忆"）。动画最简单：球先 pop，三环依次 expand+fade。
- GPT-image-2 prompt：
  > A single translucent liquid glass sphere floating in center, iridescent blue-violet tint (#4D6BFE), three concentric ripple rings of light emanating outward from the sphere, soft specular highlights, deep dark navy background #0B0F1A, minimalist, no text, centered, 1:1
- 分层拆法：球 / 环1 / 环2 / 环3 = 4 张；动效：环依次 scale(0.4→1.6)+opacity(1→0)，球体缓慢浮沉

### 方向 B（识别度最高）：联想星图 · 节点连线
**概念**：5 颗小玻璃节点，光线依次点亮连成星座，中心节点最大——"联想=节点间的连线"，唯一把"联想"画出来的方向。
- GPT-image-2 prompt：
  > A constellation of five small translucent glass orbs connected by thin glowing lines forming an abstract neural graph, the central orb larger and brighter, blue-violet gradient light (#4D6BFE to #9B7EFF), deep dark navy background #0B0F1A, minimalist vector-style illustration, soft glow, no text, centered, 1:1
- 分层拆法：中心球 / 外围 4 球（或 1+1+1+1 分批）/ 连线层 = 3–5 张；动效：球依次 pop，连线用描边生长（CSS/SVG stroke-dashoffset）

### 方向 D（呼应母品牌）：深海鲸尾 · 水珠化忆
**概念**：玻璃鲸尾扬起，尾尖一滴水珠上升成记忆球——呼应 DeepSeek 深海鲸的母品牌隐喻，"从深海捞回记忆"。动画叙事最强但分层最复杂。
- GPT-image-2 prompt：
  > A translucent liquid glass whale tail fluke emerging from darkness, a single glowing water droplet rising from the tail tip transforming into a small luminous sphere, deep sea blue-violet palette (#4D6BFE), dark navy background #0B0F1A, elegant, minimalist, no text, centered, 1:1
- 分层拆法：鲸尾 / 水珠轨迹 / 记忆球 = 3 张；动效：尾扬→水珠沿弧线上升（CSS offset-path）→球 pop

## 2. 动画化管线（第 3 步怎么走）

1. GPT-image-2 出**定稿静态图**（按上面 prompt，多跑几张选 1）
2. 让图像模型（或 GPT-image-2 的编辑模式）**逐层拆分**：prompt 模板
   > Same illustration, but output ONLY the [第 N 层: 描述] as a separate image on a fully transparent background, same position and scale as the original, PNG, no other elements
   拆不干净时丢给我：单张定稿 + 深色底，我可以做亮度/色相键控切层
3. **Midjourney/视频模型**：把定稿图喂 image-to-video，prompt 写
   > The glass layers gently unfold and assemble, smooth looping motion, soft light sweep
   ——只用来**预览动效手感**，选定节奏（快/慢/回弹）后告诉我参数，前端 CSS 按同节奏复刻
4. 交付给我：定稿图 + 分层 PNG（或单图让我切）+ 你认可的动效节奏

## 3. 前端呈现优化（第 4 步,我来做）

- 资产落位 `lib/assets/tour-logo/`（layer1..N.png），向导 orb 容器改为分层叠加
- CSS 动画按你定的节奏复刻（entrance = Office 式逐层展开,loop = 缓慢浮沉+高光扫过,沿用现有 specular 体系）
- emoji 兜底保留（资产缺失/加载失败时回落 🫧）
- 同步替换项（可选）：面板 header 小图标、README 顶部、CHANGELOG 发布卡

## 4. 我的推荐

**主推 C（玻璃层叠）**：三层记忆店的语义最贴插件本体；"逐层展开"与 Office 花瓣动画同构，正好满足"分条展开"；分层拆图最容易（几何形状规则）。**A 作为快速兜底**（今天就能用纯 CSS 画出来不带图片资产）。若你想要识别度独特的，选 B。
