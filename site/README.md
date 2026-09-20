# site/ — dsh-auto-memory 首页（线框稿 · 从 0 重建）

> 2026-09-20 · ZCode 线按 `docs/internal/HANDOFF-TO-ZCODE-20260920.md` §4-C 构建。
> 旧首页 `docs/landing/index.html`（1745 行单文件）**已废弃**，本目录是替代品；
> 旧文件暂留至新站通过 GitHub Pages 上线、README 入口切换后再删（避免 README 链接断链）。

## 形态决策（为什么不是 Astro）

- **纯静态、零依赖、零构建**：整套页面只有 `index.html` + `assets/site.css` + `assets/site.js`。
  美术规格（`docs/internal/ART-DIRECTION-WIREFRAME.md` §4.2）的主力技术就是
  **SVG `stroke-dashoffset` 自绘 + CSS `steps()` 逐帧**，全部原生可实现；
  不引框架 = 首屏动效预算（≤400KB 原始 / ≤250KB gzip）天然满足、GitHub Pages 无需构建工作流、
  本地双击 `index.html` 即可打开。

## combine：三个素材库 + DeepSeek 官网的实际取材（2026-09-20 实地取证）

| 来源 | 抄什么 | 落在哪 |
|---|---|---|
| **RhineLabUI**（565★，MIT 限代码） | 档案阵列（方向键列/行循环 + 选中抬起 + 波浪）、对角解密线合拢、逐字 boot 终端、滚动数字 | SHEET 05 档案终端（canvas 2D 线框化实现，零 WebGL） |
| **rhinelab-blog-theme** | 「静态可读层 + 三维增强层」双入口哲学（无 JS 仍可读全文） | noscript 兜底 + reveal 降级 + `<figure>` 纯 HTML 内容层 |
| **arknights-motion-library** | 播放器/数据分离、状态机动画；MIT 只覆盖自写代码、游戏素材不可用（已核实 LICENSE） | `site.js` 的 24fps 序列帧播放器契约（`data-dam-anim` 挂载位，Astra 帧到货即插） |
| **deepseek.com 官网**（实地截图采样） | 浅蓝云底族 #F1F6FB/#D9E3F2/#EEF3FA + 品牌蓝 #4B7DE6 | Hero 舞台 = 「夜访窗 PLATE 00」的对照色温参考 |
| **deepseek.com/harness**（实地截图采样） | 夜蓝族 #2A4F80/#1B375A/#28374C、白标题、终端卡 | **夜访窗**（纯色平涂 #182742，无渐变/无玻璃）+ 调色板图例新增「夜蓝（DSH harness）」 |
| **docs/banner.jpg**（角色资产） | 蓝发蓝眼动漫少女、手中书本 + 记忆卡匣道具 | Hero 角色定妆线稿（SVG，蓝只出现在发丝/瞳孔，符合 §2.1 铁律） |

**取舍说明**：整体美学以 `ART-DIRECTION-WIREFRAME.md` 为准（纸/墨/信号橙 ≤5%/禁止渐变投影玻璃圆角）；
官方「夜蓝」只出现在 Hero 的访问窗面板与角色蓝色里——它是「她住的那扇窗」，与其余暖纸图纸形成
「冷蓝窗口 × 暖纸图纸」的搭配，对应 harness 官页（宿主）与插件页（本页）的关系。
RhineLab 的深色霓虹/玻璃**不引入**（与线框稿禁止项冲突，交接 §6.4 已预判此冲突并以线框稿为骨架）。
- **combine 三个素材库取「做法与观感」**（§6.4 的取舍）：
  - 骨架 = 线框稿规格（纸/墨/信号橙 ≤5%、四档线宽、禁止渐变/投影/玻璃/圆角卡片）——**整体不转深色霓虹**；
  - RhineLab 系的「档案终端」范式 → 转译为**工程图纸语言**：SHEET 编号 + 图签栏（footer title block）
    + FIG 图注 + 尺寸标注 + 45° 剖面线（归档/压缩区）+ CAUTION 黄条；
  - arknights-motion-library 的思路 → 24fps 落地为 CSS `steps(24/36)` 逐帧节奏
    （自绘 1.5s=36 步、呼吸 1.5s×2=72 帧、眨眼 6 帧、数据流 24 步/秒）。
- **角色位**：按 §5 交付契约画成「带尺寸标注的待装件 A-01」占位（画布 1200×1200、锚点 (600,1080)、
  角色高 ≈900、头顶安全区 120 全部标注在图上）。Astra 序列帧到货后，替换 `#stageSvg` 中的
  `<g class="breathe">` 为序列帧播放器（`data-dam-anim="hero"` 语义位），占位件方案退为降级首帧。

## 已实现的规格硬指标

- 色板：仅纸 `#F4F1EB` / 次纸 `#ECE8DF` / 墨 `#17171A` / 灰阶 `#5A5A60`·`#9B9BA0` /
  信号橙 `#E9470C`（≤5%）/ 警示黄 `#E8C584`（仅 CAUTION 条）；蓝 `#2B4A8B`·`#2B6FD8` **只出现在角色色标图例里**。
- 线宽四档：0.75（网格/标注）/ 1（结构）/ 1.5（轮廓）/ 2.5（CTA 焦点）。
- 动效：首屏仅 2 个（Hero 自绘 + 呼吸占位）；**全部动效进视口才启动**（IntersectionObserver），
  数据流离开视口自动暂停；`prefers-reduced-motion: reduce` 一律降级为静态终帧。
- 首屏零位图；三张界面截图为懒加载（折叠线以下）。
- 双语：中文为母本，`data-en` 切换（localStorage 记忆），无框架。

## GitHub Pages 部署（待用户在 Settings 里开一次）

两种方案，**推荐 A**：

- **方案 A · Actions 构建（推荐）**：仓库 Settings → Pages → Source 选 **GitHub Actions**，
  然后加 `.github/workflows/deploy-pages.yml`（内容见下）。`.github/` 按交接边界暂不由 ZCode 线直接落盘，
  YAML 先存档于此，等用户点头再提交：

  ```yaml
  name: deploy-pages
  on:
    push:
      branches: [main]
      paths: ["site/**"]
    workflow_dispatch:
  permissions:
    pages: write
    id-token: write
  concurrency:
    group: pages
    cancel-in-progress: true
  jobs:
    deploy:
      runs-on: ubuntu-latest
      environment:
        name: github-pages
        url: ${{ steps.deployment.outputs.page_url }}
      steps:
        - uses: actions/checkout@v4
        - uses: actions/configure-pages@v5
        - uses: actions/upload-pages-artifact@v3
          with:
            path: site
        - id: deployment
          uses: actions/deploy-pages@v4
  ```

- **方案 B · 零配置分支**：Settings → Pages → Deploy from a branch → 选 `gh-pages` / `(root)`，
  由本地脚本把 `site/` 推成孤儿分支（需要一次 push 授权）。

上线后把 `README.md` / `README.zh-CN.md` 顶部 landing 链接从 htmlpreview 代理改为 Pages 直链，
并删除 `docs/landing/index.html`。

## 文件

```
site/
├── index.html          # 结构 + 内联 SVG（FIG.00 舞台 / FIG.01 数据流 / FIG.02 记忆结构）
├── assets/site.css     # 令牌 + 线宽层级 + 24fps 动效 + 降级 + 响应式
├── assets/site.js      # 双语切换 · IntersectionObserver 门控 · 复制命令
├── assets/img/         # 三张界面截图（v2.x 摄制，前端重构后重拍）
└── README.md           # 本文件
```
