# site/ — dsh-auto-memory 首页（DeepSeek 官网体系 v2）

> 2026-09-20 · ZCode 线按交接 §4-C 构建；**美术方向 v2**，权威文档
> `docs/internal/ART-DIRECTION-DEEPSEEK-20260920.md`（作废 v1 线框稿）。
> 旧首页 `docs/landing/index.html`（1745 行单文件）**已废弃**，本目录是替代品；
> 旧文件暂留至新站通过 GitHub Pages 上线、README 入口切换后再删（避免 README 链接断链）。

## 形态：纯静态、零依赖、零构建

整套页面只有 `index.html` + `assets/site.css` + `assets/site.js`（+ 截图资产）。
官网体系的主力技术（半透明 surface 叠加 / `backdrop-filter` / CSS 合成器属性动效）全部原生可实现；
不引框架 = 首屏动效预算（≤400KB 原始 / ≤250KB gzip，实测 **gzip ≈16KB**）天然满足、
GitHub Pages 无需构建工作流、本地双击 `index.html` 即可打开。

## v2 设计系统落地（对照 ART-DIRECTION-DEEPSEEK-20260920 自查）

| 自查项 | 落地 |
|---|---|
| ① 主色 = 品牌蓝 `#4d6bfe` | ✅ kicker / 按钮 / 链接 / 选中态全用品牌蓝（暗色提亮 `#6799fe`）；信号橙已全部移除 |
| ② 玻璃 `blur(12px)` + 圆角 | ✅ 顶栏 / Hero 图版 / 档案终端 / 侧栏 / CAUTION 均 `backdrop-filter: blur(12px)`；圆角 8/10/12/16/24/100 六档（卡片 24、面板 16） |
| ③ 分层帧率 | ✅ 背景层 60fps（环境光晕 / 图示自绘 / 数据流 / 波浪，只用 transform+opacity 合成器属性）；角色层 24fps（自绘 steps(24)）/ 12fps（呼吸 steps(18×2)、眨眼硬切、解密线 12fps 手拍） |
| 底色 | ✅ 暗色主推 `#0a0a0a`（黑鲸调性）；亮色令牌已备（`#f9f8f8`）可后补切换 |
| 层级 | ✅ 半透明白叠加 surface-1..5（hsla 0,0%,100%,.02–.12），无实色分区线；暗色投影 = 1px 内发光 |
| 角色 | ✅ 抽象线描：单色 1–1.5px 淡色线，剪影 > 五官（仅两只瞳孔点蓝）；识别特征 = 呆毛 + 头鳍 + 鲸尾 + 白米饭碗；发丝渐变蓝高光（#2B4A8B→#6799fe） |
| 版权 | ✅ 页脚署名：角色设定「明月」原作者 商山无行 · CC BY-NC-SA 4.0（非商业衍生 + 同协议共享）；商业化前须重评 |

## combine：素材库与官网取材（2026-09-20 实地取证）

| 来源 | 抄什么 | 落在哪 |
|---|---|---|
| **DeepSeek 官网**（实地截图 + `artifacts/_ds-css/` 三份生产 CSS） | 色板令牌 / 圆角与模糊阶梯 / 按钮态（hover 只变透明度）/ 半透明层级 | 全站令牌（`site.css` `:root` 映射表） |
| **DeepSeek Harness 页**（实地截图） | 黑鲸调性、深蓝夜色 | 品牌定位（我们属黑鲸层）+ 环境光晕配色 |
| **RhineLabUI**（565★，MIT 限代码） | 档案阵列（方向键列/行循环 + 选中抬起 + 波浪）、对角解密线合拢、逐字 boot 终端、滚动数字 | SHEET 05 档案终端（canvas 2D 线框化，零 WebGL）；暗色系与 RhineLabUI 调性天然契合 |
| **rhinelab-blog-theme** | 「静态可读层 + 三维增强层」双入口哲学（无 JS 仍可读） | noscript 兜底 + reveal 降级 + 纯 HTML 内容层 |
| **arknights-motion-library**（MIT 限自写代码，游戏素材不可用——已核实） | 播放器/数据分离、状态机动画 | `site.js` 的 24fps 序列帧播放器契约（`data-dam-anim` 挂载位，Astra 帧到货即插） |

## 文件

```
site/
├── index.html          # 结构 + 内联 SVG（鲸鱼娘抽象线稿 / 数据流 / 记忆结构）
├── assets/site.css     # v2 令牌（官网体系）+ 玻璃 + 分层帧率 + 降级 + 响应式
├── assets/site.js      # 双语 · 进视口门控 · 档案终端 canvas 引擎 · 序列帧播放器契约
├── assets/img/         # 三张界面截图（v2.x 摄制，前端重构后重拍）
├── preview/            # 验收截图（本轮 8 张）
└── README.md           # 本文件
```

## GitHub Pages 部署（待用户在 Settings 里开一次）

**推荐 · Actions 构建**：Settings → Pages → Source 选 **GitHub Actions**，然后加
`.github/workflows/deploy-pages.yml`（`.github/` 按交接边界暂不由 ZCode 线落盘，YAML 存档于此，点头即提交）：

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

备选 · 零配置分支：Settings → Pages → Deploy from a branch → `gh-pages` / `(root)`，
由本地脚本把 `site/` 推成孤儿分支（需要一次 push 授权）。

上线后把 `README.md` / `README.zh-CN.md` 顶部 landing 链接从 htmlpreview 代理改为 Pages 直链，
并删除 `docs/landing/index.html`。
