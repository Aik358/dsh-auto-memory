# Banner 系列生图手册（GPT-image-2 图生图 · 以现有动漫人物为锚）

> 2026-09-01 · 用法：现有 `docs/banner.jpg` 为主参考图。每页一次会话：
> **第 1 条=角色锁定 prompt（每页必发）→ 第 2 条=该页场景 prompt**。
> 图片和文字一起喂（GPT-image-2 支持参考图输入）；每页跑 2-3 张挑 1。
> 统一规格：2560×1440 横版（网站 banner 裁切余量）；文字只允许 tagline 一行或无文字。

## 0. 角色锁定 prompt（每页第一条，保持人物一致性）

```text
Reference image: an anime-style illustration of a cheerful girl with long flowing deep-blue hair, blue eyes, wearing a white sailor-collar blouse with a dark blue trumpet skirt and ribbon, surrounded by floating watercolor-style magical books, notes and constellation cards in blue and violet tones, painted in a soft watercolor + digital hybrid style.

Keep this EXACT character design in my next request: same face, same long deep-blue hairstyle, same outfit colors (white blouse + dark blue skirt + ribbon), same soft watercolor art style with glowing blue-violet magical particles. Do not change her identity, outfit or the art style.
```

## 1. P2 三层记忆体系（主题：她托起三层光）

**装扮/动作设计**：校服外加一件半透明蓝纱披肩（呼应磨砂玻璃材质），双手向上摊开，掌上悬浮**三片磨砂玻璃圆角方板**（底→顶，间距相等，微倾斜），光柱从顶部穿过三板；表情专注而温柔。

```text
Now create a wide 2560x1440 hero illustration: the same girl, now wearing an additional translucent frosted-glass-blue shawl over her sailor outfit, holding both hands up with palms open. Above her hands float THREE frosted rounded-square glass panels stacked with equal gaps, slightly tilted, glowing softly; a vertical beam of blue-violet light (#4D6BFE to #9B7EFF) passes down through all three panels. Deep dark navy background (#0B0F1A) with soft bokeh particles. Same watercolor digital hybrid art style. Leave the left 40% of the canvas relatively empty and dark for text overlay. Minimal or no text.
```

## 2. P3 欢迎向导（主题：六枚图标环绕）

**装扮/动作**：原校服，单手轻点身前一张**悬浮的深色玻璃卡片**（模拟向导界面），周围环绕六枚小的发光彩色玻璃圆角图标（青/金/绿/紫/天青/珊瑚），呈弧形排开；她回头对观者微笑。

```text
Now create a wide 2560x1440 illustration: the same girl in her sailor outfit, tapping a floating dark glass card in front of her like a welcome screen; around her, SIX small glowing rounded-square glass icons in different colors (cyan, amber, green, violet, sky-blue, coral) arc across the scene like an app dock. She looks back at the viewer with a confident smile. Deep dark navy background, soft bokeh, same watercolor style. Left 40% kept darker for text overlay. Minimal or no text.
```

## 3. P4 唤起与固化（主题：对话流凝成技能卡）

**装扮/动作**：校服+手里一支发光钢笔（原图同款道具），面前一条纵向**对话气泡流**（3-4 个半透明气泡从上往下飘），最下方的气泡正在被她的笔"点化"成一张**实体的技能卡片**（发光、带勾选框纹样）；传达"对话被记住并固化成流程"。

```text
Now create a wide 2560x1440 illustration: the same girl holding the same glowing pen from the reference. In front of her, a vertical stream of translucent chat bubbles floats downward; the lowest bubble is being transformed by her pen into a solid glowing skill card with subtle checkbox lines on it — "conversation crystallizing into a skill". Magical particles trail from the pen tip. Deep dark navy background, same watercolor style. Left 40% dark for text. Minimal or no text.
```

## 4. P5 无人值守（主题：月夜守航）

**装扮/动作**：同一角色加一条**深蓝斗篷**（夜班值班感），坐在一张悬浮玻璃控制台前（玻璃屏幕上有柔和的进度波形），姿态放松但警觉；窗外一弯新月+时钟指针指向 22:00；整体光线更暗、更安静，唯独屏幕与她的眼睛有光。

```text
Now create a wide 2560x1440 illustration: the same girl now wearing a deep-blue cape over her outfit, sitting relaxed but alert at a floating frosted-glass console showing soft progress waves on its screen. Behind her a large window shows a crescent moon and a clock pointing to 10 PM. The scene is darker and quieter than usual — only the screen and her eyes glow. Conveys "unattended night batch, zero small talk, everything stable". Deep dark navy background, same watercolor style. Left 40% dark for text. Minimal or no text.
```

## 5. P6 外部记忆继承（主题：四路光桥）

**装扮/动作**：校服，张开双臂，身前悬浮一颗**大的玻璃记忆核心**（多层球体），四条柔和光桥从画面四角伸向核心（四个角各一个抽象的外来记忆体：书/芯片/纸鹤/信封剪影），光桥上有微粒流向核心——"别的 AI 的记忆也在喂她"。

```text
Now create a wide 2560x1440 illustration: the same girl with arms gently open, a large multi-layered glass memory orb floating in front of her. Four soft light bridges reach toward the orb from the four corners of the canvas, each corner holding an abstract silhouette of an external memory token (a book, a memory chip, a paper crane, an envelope); glowing particles flow along the bridges into the orb. Conveys "memories from other AI tools flow into her". Deep dark navy background, same watercolor style. Center composition. Minimal or no text.
```

## 6. 通用修图指令（哪张不满意时的微调 prompt）

```text
Keep everything in this image, only change: [具体一点,例如 "make the three glass panels larger and slightly more transparent" / "reduce the number of particles" / "shift the lighting warmer"]。
Everything else — character, pose, background, style — stays exactly the same.
```

## 7. 验收标准（每页过三关再定稿）

1. **角色一致性**：脸/发型/配色与原图并排对比看不出"换了个人"
2. **左 40% 文字区**：叠白色标题后可读（深底+低细节）
3. **风格统一**：六页并排像同一个系列的六集，不是六个画师的稿
