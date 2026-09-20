# dsh-auto-memory 3.0 宣传图 · 单发完整 Prompt

> **用法**：整段粘进生图工具，一次出图。
> **推荐参数**：`gpt-image-2.5` / quality `high` / size `1536x1024`（16:9 横版）
> 若要竖版封面用 `1024x1536`，把构图描述里的「left / right」换成「top / bottom」。

---

## Prompt（直接复制）

```
A polished product banner illustration for a developer tool, 16:9 widescreen, dark cinematic anime aesthetic.

LAYOUT: Split composition. Left 55% is a clean information panel with crisp typography. Right 45% is a full-body anime character with floating holographic elements. A soft vertical light seam separates the two halves.

BACKGROUND: Deep navy-to-near-black gradient, from #12203f at the upper left to #050810 at the lower right. Subtle floating grid of thin cyan lines, faint bokeh particles, and a soft cyan glow behind the character. A few translucent glass panels drift in the background with very low opacity. Clean, premium, technical — not cluttered.

CHARACTER (right side, occupying right 45%, full body from head to knees): A gentle anime girl with long flowing light-blue hair and a small gold star hair clip. Large expressive blue eyes with soft highlights, warm closed-mouth smile, looking slightly toward the viewer. She wears a white blouse with puffy sleeves, a dark navy vest with gold trim and small gold buttons, a large navy bow at the collar with a round blue gemstone brooch, and a navy pleated skirt with a gold chain and gem pendant at the waist. She holds a large open dark-navy hardcover book in both hands; the book's cover is embossed with gold filigree and displays the English text "MEMORY LOG" in clean gold serif capitals. In her raised right hand she holds a dark fountain pen with a gold nib. Around her float 6 to 8 glowing translucent blue glass memory cards, each with a delicate gold corner frame and a small sparkle icon. Soft rim light from the left catches her hair and shoulders; cool cyan bounce light from the cards. Clean crisp line art, cel shading, soft painterly highlights, high detail on hair strands and fabric folds.

LEFT PANEL TOP — main title block:
Large bold Chinese title text, two lines, white with a subtle cyan glow:
"无问自忆"
"记忆不断线"
Below it, smaller light-blue English subtitle in a clean sans-serif:
"She remembers, unbidden."
Below that, one line of small gray-blue Chinese text:
"跨窗口 · 跨会话 · 跨工具"

LEFT PANEL MIDDLE — a 2x2 grid of four rounded glass capability cards, each with a thin cyan border, a small line-art icon in the upper left, and Chinese text:
Card 1 icon: a small closed book. Title "自动记忆" in white bold, body text "每轮自动沉淀，寒暄轮跳过" in small gray-blue.
Card 2 icon: a shield with a checkmark. Title "写入闸门" in white bold, body text "乱码与凭据进不了提示词" in small gray-blue.
Card 3 icon: a clipboard with a pen. Title "交接账本" in white bold, body text "换窗口不丢上下文" in small gray-blue.
Card 4 icon: three stacked horizontal layers. Title "三层记忆" in white bold, body text "硬规矩 / 笔记 / 日志" in small gray-blue.

LEFT PANEL LOWER — a dark rounded terminal bar with a thin cyan border, containing monospace text in cyan-green:
"pnpm add @a9i5k4/dsh-auto-memory@latest"
To its right, a small rounded pill button with the Chinese text "复制".

LEFT PANEL BOTTOM — a horizontal row of small rounded info chips with thin borders, each containing short Chinese text:
"17 模型工具"  "49 路由"  "98 配置键"  "12 面板页签"  "零运行时依赖"

TOP RIGHT CORNER — a small glowing version badge, rounded pill shape with a cyan border and cyan text: "v3.0.0"

BOTTOM LEFT CORNER — small gray text: "BSD-3-Clause  ·  Windows / macOS / Linux"

STYLE: Premium dark UI illustration, deep blue and cyan palette with small warm gold accents, glassmorphism, soft glow, high contrast between text and background. Typography must be sharp, correctly spelled, well-kerned, and perfectly legible. All Chinese characters must be accurate and correct. Cinematic lighting, clean composition, professional key visual quality, no watermark, no signature, no border frame.
```

---

## 出图后必做：文字准确性自检

AI 生图的**中文长文本**仍可能出错（缺笔画、错字、糊字）。逐项核对：

- [ ] 主标题「无问自忆」「记忆不断线」——**这两行最重要**，错一个字就重出
- [ ] 英文副标题 `She remembers, unbidden.`
- [ ] 四张卡片标题：自动记忆 / 写入闸门 / 交接账本 / 三层记忆
- [ ] 卡片小字（错字可接受，糊字不行 —— 小字允许后期覆盖）
- [ ] 命令 `pnpm add @a9i5k4/dsh-auto-memory@latest`（**必须逐字符对**）
- [ ] 五个 chip：17 模型工具 / 49 路由 / 98 配置键 / 12 面板页签 / 零运行时依赖
- [ ] 版本号 `v3.0.0`（不是 0.1.35、不是 3.0.1）
- [ ] 书封 `MEMORY LOG`
- [ ] 左下 `BSD-3-Clause`

**修图策略**（按性价比排序）：
1. **重出**：主标题或命令出错 → 直接重跑，改 prompt 里对应那行
2. **局部重绘（inpainting）**：只有某一小块错 → 用图生图 + 蒙版只遮那一块
3. **HTML 后期覆盖**：只有卡片小字或 chip 糊 → 用 HTML 渲染同位置的文字层叠上去（此时 AI 已经画好了光影氛围，只为修字）

---

## 内容依据（写 prompt 时的事实来源）

全部经代码自核，**不要改动这些数字**：

| 项 | 值 |
|---|---|
| 版本 | **3.0.0**（2026-09-17 发布） |
| 模型工具 | **17** |
| HTTP 路由 | **49** |
| 配置键 | **98**（60 可写） |
| 面板页签 | **12** |
| 运行时依赖 | **0** |
| 许可 | BSD-3-Clause |

**3.0.0 真正的新东西**（宣传图该讲的）：
1. **底层重建收官** —— 检索、注入、容量、并发四条底层全部重建
2. **白板/看板从实验升为出厂形态**（`handoffEnabled` 默认 `true`、`boardMode` 默认 `graph`）
3. **语义索引永久不就绪的真因修复** —— 累计 22,945 行 `index-not-ready` 降级日志；根因是 Python worker 的同步槽被一次未完成的同步永久占住；修复给出两条「可证已死」接管出口
4. **多工作区/多会话适配** —— 修掉引擎里 4 处「单槽」变量，同时跑两个会话时不再互相覆盖

---

## 负面提示（若工具支持 negative prompt）

```
low quality, blurry, blurry text, garbled characters, wrong Chinese characters, misspelled text,
extra fingers, deformed hands, watermark, signature, logo, border frame, cluttered background,
neon overload, oversaturated, flat lighting, 3d render, photorealism, western cartoon style
```
