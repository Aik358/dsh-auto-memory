# RhineLab 双仓 → DeepSeek 风格 改造可行性报告

> 2026-09-20 · 结论先行，证据在后。
> 本地已跑起来：**`http://127.0.0.1:5173/lab/`**（后台作业 `pwsh-7`，你自己开浏览器看）
> 克隆位置：`artifacts/_repos/clone/blog-theme`（83.6 MB）、`artifacts/_repos/clone/RhineLabUI`（138.2 MB）

---

## 0. 先纠正一件事：这两个仓库确实是同一个东西

你说的没错，而且比「像」更彻底 —— **`blog-theme` 就是 `RhineLabUI` 的脱敏衍生版**：

| 证据 | 数值 |
|---|---|
| 两仓 `src/` 下**同名同路径**文件 | **49 个**（`scene.ts` / `main.ts` / `style.css` / `theme*.ts` / `decryption.ts` …） |
| 只在 RhineLabUI | 25 个（`workbench*`、`wallpaper*`、`archive-playground`、`startup`…）—— Wallpaper Engine 壁纸与桌面工作台分支 |
| 只在 blog-theme | 14 个（`article-reader*`、`boot-entry`、`boot-intro`、`auth-*`）—— 博客阅读器与身份认证 |
| LICENSE | 两仓均 MIT，`blog-theme` 保留 `Copyright (c) 2026 LBEILC` |
| 关系 | blog-theme 自述：「含 RhineLabUI 三维档案终端 `/lab/`（脱敏开源版）」 |

**含义**：只需研究一个。我选了 `blog-theme`，因为它 = RhineLabUI 全量三维核心 + 博客层，且自带完整 `DESIGN.md`（34 KB 视觉基准）。

---

## 1. 我已经把它跑起来了（不是读代码，是真跑）

```
cd artifacts/_repos/clone/blog-theme
npm ci --ignore-scripts     # 349 包，28 秒
npm run prepare:assets      # ← 关键，见「坑」
npm run dev:lab             # → http://127.0.0.1:5173/lab/
```

**实测状态**：

| 项 | 结果 |
|---|---|
| 开场画面 | ✅ 渲染正常（`RHINE LAB` / `SYNTHESIZE INFORMATION` / `ANALYSIS OS` / `ENTER SYSTEM ↗`） |
| WebGL | ✅ full WebGL2（`EXT_texture_compression_bptc`、`EXT_float_blend`、`EXT_disjoint_timer_query_webgl2` 等 12+ 扩展） |
| GLB 模型 | ✅ `200 /lab/assets/archive-cassette.glb`（3.57 MB） |
| 音频 | ✅ `motif.ogg` / `atmosphere.ogg` / `pulse.ogg` 全部 200 |
| 开场推进 | ⚠️ 无头环境下 `ENTER SYSTEM` 后不推进（需要真实用户手势，`navigator.userActivation.isActive` 守卫）；有真实浏览器无此问题 |

**踩到的坑（你重跑时会遇到）**：`dev:lab` 的 Vite `publicDir` 指向 `.generated/lab-public`，但 `dev:lab` 脚本**只生成内容、不同步资产** ⇒ 字体与 GLB 全 404、页面显示「CONNECTION INTERRUPTED / 三维档案资源未能载入」。**必须先跑一次 `npm run prepare:assets`**（同步 768 个文件）。

---

## 2. 我吃透了什么（决定「能不能改」的硬数字）

### 2.1 三维档案阵列的真实结构（`DESIGN.md` + 源码）

- **内容**：5 个策展主题 × 8 个槽位 = **40 份档案**，正文为「基于公开世界观资料的原创编目文章」，不是游戏原文
- **阵列**：`9 列 × 32 行 = 288 个位置`循环补位；逻辑坐标超 2048 时按内容周期整体平移（防浮点精度衰减）
- **卡片**：宽 5 / 高 3.7 / 行距 0.62 世界单位；通道中心距 5.2
- **相机**：`PerspectiveCamera(34°, 16/9, 5, 300)`，长焦压缩构图；31.48 秒处方位角 59° / 仰角 19°
- **后处理**：`ACESFilmicToneMapping` + SSAO + Bokeh 景深 + 屏幕级 SVG 颗粒/暗角/色差
- **★ 没有 bloom**（`UnrealBloomPass` 全仓 0 命中）—— 这点和「发光赛博」的直觉相反，它的质感来自「印刷品/胶片」

### 2.2 开场是一段**逐帧复刻**，不是随便做的动效

- 参考片 **1920×1080 / 25fps**，复刻区间 6.76–27.00 秒
- 品牌三行在 **278 / 280 / 282 帧**错峰滑入（**帧级编排**）
- **五个文件专门做开场时间轴**：`boot-motion.ts` + `boot.ts` + `boot-tracks.ts` + `boot-orbit-tracks.ts` + `boot-logo-tracks.ts`
- 「将逐字输入、停顿、清空、闪切**固定到原片帧点**，空间位置使用连续插值」
- 字体：原片是授权字体，本站未获授权 ⇒ `__RHINE_NOVECENTO__` **恒为 false**，开场品牌字样走**描边图形**兜底

### 2.3 动效体系（可直接抄的）

- 全仓 CSS 只有 **3 处 `cubic-bezier`** —— 他们几乎不用 CSS 补间，动效在 TS 里手写
- 两条主曲线：`cubic-bezier(0.16,1,0.3,1)` 1.6s（大位移）、`cubic-bezier(0.22,1,0.36,1)` 1.3s（面板）
- **帧率无关的指数收敛**（值得直接抄）：
  ```ts
  THREE.MathUtils.lerp(value, target, 1 - Math.exp(-dt * 14))
  ```
  天然支持打断/接续，比 CSS transition 可控
- `steps(1)` 全仓**仅 1 处**：`blink 0.8s steps(1) infinite` 光标硬切

---

## 3. 三档分类：什么能改 / 不好改 / 不能改

### 🟢 第一档：能改，而且成本低

| 项 | 为什么好改 | 预计工作量 |
|---|---|---|
| **文案与语言层** | 文案全在 `main.ts` 内联 HTML + `content/posts/*.md`（Markdown 单一来源） | 小 |
| **品牌字样** | `src/brand.ts` 是单一标志路径；`boot-lettering-art.json` 是描边图形数据 | 小 |
| **★ 色板（HTML/CSS 层）** | 见下方「关键发现」——但**必须成体系地做**，不是改几个变量 | **中** |
| **博客部分** | Astro 构建期生成静态 HTML；**禁用 JS / WebGL 仍可阅读** | 小 |
| **内容注入** | 列表 / 摘要 / RSS / sitemap / 搜索索引 / 三维卡片**全部由同一份 Markdown 派生** | 小 |
| **动效时长与曲线** | 集中在 `ui-transitions.ts` + `DESIGN.md` 有完整时长表 | 小 |
| **开场跳过** | 已有 `?review=1&scene=archive`（DEV 直通）与 `replayBoot()`，可扩展成正式入口 | 小 |

### 🟡 第二档：不好改 —— 需要改造，不是配置

| 项 | 难点 | 原因（硬证据） |
|---|---|---|
| **★★ 换 DeepSeek 主色（三维部分）** | **全仓只有 32 个 CSS 自定义属性，且有 294 个硬编码 hex + 35 个 rgba/hsl** | 那 32 个变量还只是 `--rn-blur` / `--rn-edge-fade`（滚动数字用），**根本不存在主题 token 体系**。改色要逐文件改字面量 |
| **三维材质色** | 分散在 4 个文件：`scene.ts`(26) / `theme-material.ts`(13) / `internal-optics.ts`(5) / `archive-lighting.ts`(6) | 其中 `theme-material.ts` 已经**做过一次完整的亮↔暗反相**，可照它的**方法论**做，但不能照它的颜色值做 |
| **★ 暖灰 → DeepSeek 暗色** | 这不只是换色：**光照明暗关系要重标定** | 现在是「暖灰底 + 纯黑字 + 琥珀点缀」，曝光 1.00 / 环境强度 0.52 / 暖白主光 1.7 / 主光位置 (-8,14,4)。DeepSeek 是极暗底 + 亮字，灯光、雾色、地面反射率、AO 半径全都要重算 |
| **字体** | 现在是 **MiSans**（小米开源，允许免费商用+网页内嵌），761 个 woff2 分片 / **25.2 MB** | 换 DeepSeek 官网字体需确认授权；MiSans 分片做法（cn-font-split 按 `unicode-range`）可复用 |
| **开场动效** | 帧级编排与品牌字样描边绑死 | 改品牌名 → `boot-lettering-art.json`（33 KB 描边数据）要重新生成；三行 278/280/282 帧错峰要重排 |
| **音频** | `audio.ts` 20 KB + 3 个 ogg | 授权范围要单独核（`public/audio/README.md`） |

### 🔴 第三档：不能改（或不该改）

| 项 | 原因 |
|---|---|
| **★ 模型文件（GLB / Blender）** | **MIT 不覆盖**。`art/archive-cassette.blend`、`archive-assembly.glb` 是原作者建模产物，改/分发要单独看授权。仓方自己写明：「MIT 仅适用于仓库声明有权授权的程序代码、建模脚本及配套技术文档，**不自动覆盖**游戏名称、标志、设定、原作视觉、Blender/GLB 模型、图像、动图或原片短音」 |
| **原片素材** | `reference/` 对照页 + `docs/media/*.gif`（6.28 MB / 5.69 MB 两个 GIF 是全仓最大文件）**只作本地验证，不得进产品** |
| **游戏品牌** | 「Rhine Lab」「莱茵生命」是《明日方舟》品牌，**必须全部替换**。这正是我们要做的 |
| **授权字体** | Novecento Sans Wide / MyFonts webfont —— 仓方已主动降级为 `false`，我们沿用这个决定 |
| **档案正文** | 40 篇是「基于公开世界观资料的原创编目文章」，**不能冒充游戏内原始档案**。我们的版本必须是自己的内容 |

---

## 4. 落款等内容层面的整体计划（你要的「整体计划」）

这是**必须整体替换**的部分，不是填几个空。

### 4.1 需要换掉的「身份层」清单

| 位置 | 现在是什么 | 要换成 | 在哪改 |
|---|---|---|---|
| **左上品牌三行** | `RHINE LAB` / `SYNTHESIZE INFORMATION` / `ANALYSIS OS` | `DSH` / `AUTO MEMORY` / `MEMORY OS`（待定稿） | `src/brand.ts` + `boot-lettering-art.json` |
| **开场身份段** | `ID CONFIRMED : JOYCE MOORE` / `REQUEST RECEIVED` / `START PROCESSING...` | `ID CONFIRMED : <用户名>` / `MEMORY LAYER ONLINE` 等 | `boot-intro.ts` |
| **开场欢迎段** | `WELCOME TO RHINE LAB.LLC.` / `INTERNAL DATABASE` | `WELCOME TO DSH` / `MEMORY DATABASE` | `boot-intro.ts` |
| **底部状态栏** | `SESSION AUTHORIZED` / `JOYCE MOORE` / `REINITIALIZE ↗` | `MEMORY ACTIVE` / `<用户名>` / `重播` | `main.ts:81` |
| **检索 / 收藏 / 设置** | `ARCHIVE INDEX` / `SAVED 00` | `记忆索引` / `已收藏` | `main.ts` 内联段 |
| **卡片标签** | `FILE NUMBER: X-001` | 保留形式，改前缀（如 `MEM-001`） | `main.ts` |
| **五列主题名** | 工程研究 / 生命科学 / 机构档案 / 能量研究 / 特别项目 | 改成本插件自己的五类（如 事实库 / 情节库 / 技能库 / 规则 / 日志） | `content/lab-collections.json` |
| **页脚** | 无（模板已清空备案号） | `dsh-auto-memory — DSH 记忆插件` + 许可声明 | `apps/blog/src/layouts/BaseLayout.astro` |
| **角色 / 插画层** | 无（纯产品，没有角色） | 你的鲸鱼娘（**本地已有键控好的线描 PNG**） | 新增 |
| **HTML `<title>` / meta** | `example.com` 占位 | 正式站名与 origin | `astro.config.mjs` + `BaseLayout.astro` |

### 4.2 「落款」三层结构建议

```
① 品牌层（左上三行 + 开场描边图形）  →  必须重做描边数据，工作量最大
② 身份层（ID / WELCOME / SESSION）   →  纯文案替换，工作量小
③ 法务层（页脚署名 / LICENSE / 第三方声明）→  必须新增，工作量小但不可省
```

### 4.3 法务层必须新增的内容

| 项 | 内容 |
|---|---|
| **上游署名** | `Copyright (c) 2026 LBEILC` + MIT（**必须保留**，这是使用条件） |
| **本插件许可** | BSD-3-Clause（`@a9i5k4/dsh-auto-memory` 现行许可） |
| **角色署名** | 鲸鱼娘设定原作者 **CC BY-NC-SA 4.0** —— ⚠️ **注意**：CC BY-NC-SA 是**非商业 + 相同方式共享**，与 MIT/BSD 的商用宽松条款**冲突**，混在一个产物里必须分列声明 |
| **字体声明** | MiSans 许可（若沿用）+ 代码字体 JetBrains Maple Mono OFL-1.1 |
| **素材排除声明** | 明确写：本产物**未包含**上游的 GLB 模型、Blender 工程、原片素材、游戏品牌 |
| **免责声明** | 与 DeepSeek 官方无隶属关系 |

---

## 5. 需要你决断的（按影响面排序）

| # | 问题 | 我的建议 |
|---|---|---|
| **1** | **要不要走这条路线？** 即：真拿这个 TS/Three.js 项目改造成我们的首页 | 见下方「诚实评估」——**技术上可行，但这是一次重写级工程，不是「换个配色」** |
| **2** | **首页的形态**：整站就是这个三维档案终端？还是「普通首页 + `/lab/` 这个三维终端作为亮点页」？ | 推荐后者 —— 上游自己就是这么设计的（博客静态可读 + `/lab/` 三维增强），**风险最低** |
| **3** | **40 份档案的内容从哪来** | 我们有现成素材：12 项能力 + 6 项功能清单 + 架构文档。刚好能填满 5×8 |
| **4** | **鲸鱼娘要不要进这个三维场景** | 可以 —— 但三维里的角色需要**模型**，不是线描 PNG。要么用 2D 图层叠在 canvas 上，要么不做角色层 |
| **5** | **配色改造的彻底程度** | 三个档次：(a) 只改 CSS 层（HTML 覆盖层 + 排版）—— 1 天；(b) CSS + 走一遍材质反相方法论 —— 3–5 天；(c) 连灯光/雾/AO 重标定 —— 1–2 周 |

---

## 6. 诚实评估（我必须说的）

**「只要把风格换成 DeepSeek 官网的风格就可以」——这句话低估了一件事。**

这个项目的视觉**不是皮肤，是结构**：

- 它的「高级感」来自**暖灰 + 极低饱和 + 两点琥珀**（`settings.jpg` 里开关才有一点橄榄绿）。**全画面 95% 是无彩暖灰**。
- DeepSeek 官网是**极暗底 + 高对比 + 品牌蓝点缀**。
- 两者是**反相关系**，不是「换个主色」的关系。

所以「换风格」的真实含义是一次**光影重标定**：雾色、地面反射、环境强度、曝光、AO、材质透光率、玻璃吸收色……**全部相关**。仓方自己做过一遍亮↔暗（`theme-material.ts`），有方法论可循，但那是他们的暗色（石墨 + 烟灰），**不是 DeepSeek 的暗色**。

**好消息**：这套东西的**结构语言**（细线、紧凑排字、编号、分隔线、逐帧编排、指数收敛、静态可读层 + 三维增强层的双入口哲学）是**可以直接搬**的 —— 这些与配色正交，抄的是「怎么组织信息」，不是「怎么上色」。

**所以我的建议是**：把它当**结构范本**用，而不是当**皮肤**用。先确定「我们要的是哪种形态」（问题 #2），再决定改造深度。

---

## 附：本轮新增/变更的文件

| 文件 | 说明 |
|---|---|
| `artifacts/_repos/clone/blog-theme/` | 已克隆 + 已 `npm ci` + 已 `prepare:assets` |
| `artifacts/_repos/clone/RhineLabUI/` | 已克隆（只读参考） |
| `tools/shot-url.mjs` | URL 截图（支持软件 WebGL） |
| `artifacts/_repos/clone/blog-theme/pw-probe.mjs` | Playwright 控制台/网络/WebGL 能力探针 |
| `artifacts/_repos/clone/blog-theme/rl-walk.mjs` | 走完开场流程截图 |
| `artifacts/_repos/clone/blog-theme/rl-diag.mjs` | 资源加载失败定位 |
| `artifacts/_repos/clone/blog-theme/rl-shot.mjs` | 开场 + 档案阵列分阶段截图 |
| `artifacts/_rl-*.png` | 本轮截图证据 |
