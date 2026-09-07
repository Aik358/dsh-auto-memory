# Logo 生成 Master Prompt（GPT-image-2 专用，v2 全自包含版）

> 2026-08-31 · 配合 LOGO-OVERVIEW.md 使用。模型没有项目上下文，本文件所有 prompt 自包含。
> 用法：§1 母版 prompt 整段复制 → 出 4–6 张选 1 → §3 逐层拆分 prompt → 交付。

## 1. 母版生成 Prompt（方向 C 玻璃层叠，整段复制）

```text
A premium 3D-rendered app icon illustration on a square 1:1 canvas, in the style of Apple's "Liquid Glass" design language and abstract macOS Big Sur-style wallpaper art, as if rendered in Blender with an Octane-quality renderer.

SUBJECT
Three identical thin rounded-square glass panels — like frosted glass tiles with fully rounded corners, each about 4% of its own width in thickness — floating in isometric space and stacked vertically with three equal gaps, forming a bottom, middle and top layer. All three panels share exactly the same orientation: tilted 15 degrees from horizontal and rotated 30 degrees around the vertical axis, so each reads as an elegant parallelogram, perfectly parallel to one another. The stack sits exactly in the center of the canvas and spans about 60% of the canvas width.

MATERIAL
Each panel is translucent frosted liquid glass: semi-transparent with a pale blue-white tint, softly blurring whatever is behind it, a crisp bright specular highlight running along its top edge, a delicate white rim light tracing the rounded corners, a faint blue-violet internal glow, and subtle refraction caustics where the beam passes through. The glass must stay see-through.

LIGHT BEAM
One vertical beam of light, about 8% of the canvas width, descends from the top edge of the canvas, passes through the center of all three panels, and gently illuminates them. The beam gradient runs from bright blue #4D6BFE at the top through violet #9B7EFF in the middle, fading out just below the bottom panel. Where the beam intersects each panel there is a brighter glowing hotspot, and tiny luminous dust particles drift around the stack near those hotspots.

BACKGROUND
Deep dark navy blue #0B0F1A, uniform, with a very subtle radial vignette that is slightly lighter directly behind the stack, and extremely faint film grain. Nothing else in the scene.

LIGHTING & MOOD
Soft studio product lighting keyed from the upper left, a gentle cool rim light from the right, calm, premium, futuristic yet elegant. The overall color story is cool blue-violet on dark navy.

COMPOSITION RULES
Perfectly centered, balanced, generous empty margins of at least 15% on every side, nothing cropped by the canvas edge, one single focal point.

STRICTLY AVOID
any text, letters, numbers, words, watermarks, signatures, logos, people, hands, animals, photographic real-world objects, clutter, extra shapes, rainbow color noise, harsh shadows, pure black background, vignette darker than the background color, borders or frames around the image, cropped elements.
```

### 1b. 备选：直接出透明底（模型支持 transparency 时用这行替换 BACKGROUND 段）

```text
BACKGROUND
Fully transparent background (alpha channel), no vignette, no grain, no environment — only the glass stack, the beam and the particles, so the image can be composited onto any dark UI.
```

## 2. 出图实操

- 一次跑 4–6 张，**prompt 一字不改**，只换 seed；选构图最正的一张做定稿
- 判定标准：三层平行无透视穿帮、光柱垂直居中、面板圆角完整、背景纯色无杂纹
- 尺寸选最大（≥1024×1024）；若能选质量档，选 highest

## 3. 逐层拆分 Prompt（定稿后，编辑/局部重绘模式逐条跑）

拆层原则：同一定稿图，每张只保留一层，位置与比例**必须与定稿完全一致**（后面 CSS 才能叠回原位）。

```text
Layer 1 of 3 — Take this exact image and output ONLY the BOTTOM glass panel of the three, unchanged in position, size, orientation, color and material, on a fully transparent background. Remove the other two panels, the light beam and all particles. Keep the beam's glow spots on this panel faintly visible. PNG with alpha.
```

```text
Layer 2 of 3 — Take this exact image and output ONLY the MIDDLE glass panel of the three, unchanged in position, size, orientation, color and material, on a fully transparent background. Remove the other two panels, the light beam and all particles. Keep the beam's glow spots on this panel faintly visible. PNG with alpha.
```

```text
Layer 3 of 3 — Take this exact image and output ONLY the TOP glass panel of the three, unchanged in position, size, orientation, color and material, on a fully transparent background. Remove the other two panels, the light beam and all particles. Keep the beam's glow spots on this panel faintly visible. PNG with alpha.
```

```text
Beam layer — Take this exact image and output ONLY the vertical blue-violet light beam (#4D6BFE → #9B7EFF) with its drifting glowing particles, unchanged in position and width, on a fully transparent background. Remove all three glass panels entirely. PNG with alpha.
```

拆层不干净（模型重画导致错位）就别硬拆：把**定稿深色底原图**直接给我，我用色相/亮度键控在本地切层，保证逐像素对位。

## 4. 动画预览 Prompt（Midjourney/视频模型，仅预览手感）

```text
The three glass panels gently unfold and assemble into the stack, one after another from top to bottom, then the light beam ignites downward through them with drifting particles, soft light sweep across the glass, seamless slow loop, smooth easing, no camera movement.
```

把预览视频发我并说明喜欢的节奏（比如"落下 0.4s/层、间隔 0.15s、光柱点亮 0.5s、循环停 2s"），我按同节奏用 CSS 复刻成无限循环动画。

## 5. 交付清单（回传给我）

1. 定稿静态图（1 张）
2. 分层 PNG ×4（3 层+光柱；或只给定稿图让我切）
3. 你认可的动效节奏描述（或 Midjourney 预览视频）
→ 我接入向导头部：entrance 逐层展开、loop 浮沉+高光扫过，emoji 兜底保留。
