# Logo 生成 Master Prompt v3（学习 Office/Fluent 磨砂玻璃材质后的重写版）

> 2026-08-31 · v2 失败诊断 + Fluent/Spline 磨砂玻璃材质语言吸收后的重写。
> 用法同 v2：§1 母版整段复制跑 4-6 张换 seed → §2 挑定稿 → §3 拆层 → §4 动画预览。

## 0. v2 为什么失败（v3 已针对性修正）

| v2 产物病灶 | 根因 | v3 对策 |
|---|---|---|
| 霓虹描边发光片（赛博风） | 没写表面粗糙度 → 模型默认锐利镜面+描边 | 写死 **roughness 30-45% 的高斯糊高光**，明确禁止锐利霓虹轮廓 |
| 薄菱形片、像贴纸 | 没写厚度 → 平面化 | 写死 **厚边缘 slab（thickness 约为宽度 12%）+ 圆润倒角**，"solid chunk of glass" |
| 光柱喧宾夺主 | "Light beam" 被渲染成灯管 | 光柱降级为**背景柔光斑**，主光改为玻璃**背后**的点光（磨砂玻璃的生命线） |
| 磨砂感无从体现 | 纯深色空底，没有可透射的内容 | **玻璃后方放模糊的暖色几何形状**（Spline 教程核心技巧：磨砂必须背后有东西可透） |
| 整体蓝紫渐变太满 | 色彩故事写得太强 | 玻璃本体是**近无色的白玻璃+5-15% 极淡色 tint**，蓝紫只出现在背景透出物上 |

## 1. 母版生成 Prompt v3（整段复制）

```text
A premium 3D-rendered app icon on a square 1:1 canvas, in the exact material style of Microsoft Office / Microsoft 365 frosted-glass 3D icons and Fluent Design 3D illustrations: soft, calm, tactile, realistic studio product render, as if made in Blender with Cycles.

SUBJECT
Three identical horizontal frosted-glass slabs floating one above another in isometric space, stacked with three equal gaps like a plate rack. Each slab is a solid chunk of frosted glass — a rounded rectangle tile with generous rounded corners and visibly THICK edges (the edge thickness reads as about 12% of the tile width, like a thick sheet of acrylic), with softly rounded bevels on every edge. All three slabs share one orientation, tilted 20 degrees and rotated 30 degrees, perfectly parallel to each other. The stack is centered and spans about 65% of the canvas width.

MATERIAL — THIS IS THE MOST IMPORTANT PART
Real frosted acrylic glass, exactly like Microsoft's Fluent 3D icons: the glass body is nearly colorless and semi-transparent, like thick frosted acrylic — milky white with only a 10% faint cool-blue tint. Surfaces are matte-satin: specular highlights are SOFT and WIDE, diffused across the surface (surface roughness like brushed satin, never mirror-sharp). Edges catch a bright white Fresnel rim light, so the outline of each slab is a clean soft white edge — but never a glowing neon outline, never a bright colored stroke, just the natural bright edge of thick frosted glass seen against dark background. Looking through a slab you can faintly see blurred colored shapes behind it (gentle transmission blur).

WHAT IS BEHIND THE GLASS
Directly behind and slightly below the stack float a few large, softly blurred, out-of-focus geometric shapes in muted deep-blue and violet (#4D6BFE, #9B7EFF) — big soft glowing orbs and rounded blobs, heavily defocused like bokeh. They are BEHIND the glass so the frosted slabs visibly blur and soften them. These background shapes are dim and gentle, they never outshine the glass.

BACKGROUND
Deep dark navy #0B0F1A studio backdrop with a subtle soft falloff. A single soft point of light glows gently BEHIND the stack (backlight), pushing light through the glass so the frosted slabs glow faintly from within. No light beams, no light swords, no neon tubes anywhere.

LIGHTING & MOOD
Calm premium studio product lighting: one large soft area key light from the front-left creating wide elongated soft highlights, a backlight behind the glass, a gentle cool fill from the right. Shadows are soft, never pitch black. Elegant, tactile, quiet.

COMPOSITION RULES
Perfectly centered, generous empty margin of at least 15% on every side, nothing cropped, single focal point, clean.

STRICTLY AVOID
text, letters, numbers, watermarks, logos, people, hands, animals, neon glow outlines, colored edge strokes, laser beams, light swords, glowing wires, thin bright lines, sharp mirror reflections, chrome, rainbow gradients, oversaturated colors, flat 2D shapes, paper-thin planes, diamond/rhombus shapes, cluttered background, pure black background, cropped edges.
```

### 1b. 透明底替换行（模型支持 alpha 时替换 BACKGROUND 段整段）

```text
BACKGROUND
Fully transparent background with alpha channel; keep only the slabs and their soft backlight glow — but keep the defocused blue-violet bokeh shapes BEHIND the glass so the frosted transmission stays visible.
```

## 2. 出图实操

- 一字不改跑 4-6 张换 seed；判定：①面板是"厚板"不是"薄片" ②边缘是白色哑光不是霓虹 ③透过玻璃能看到糊掉的光斑 ④无光柱
- 若模型把玻璃画太透（能看清背后形状）→ 在 MATERIAL 段把 "10% faint cool-blue tint" 改成 "25% milky white frost"
- 若还出霓虹 → 在 STRICTLY AVOID 里把 "neon glow outlines" 提到句首并加 "the style must be matte frosted acrylic, NOT glowing energy"

## 3. 逐层拆分（同 v2 规则：同位同比例，交付不上来就给原图我键控切层）

```text
Layer 1 of 3 — Take this exact image and output ONLY the BOTTOM glass slab of the three, unchanged in position, size, orientation, material and lighting, on a fully transparent background. Remove the other two slabs and all background bokeh shapes. Keep the soft white edge light of this slab. PNG with alpha.
```

```text
Layer 2 of 3 — Take this exact image and output ONLY the MIDDLE glass slab of the three, unchanged in position, size, orientation, material and lighting, on a fully transparent background. Remove the other two slabs and all background bokeh shapes. Keep the soft white edge light of this slab. PNG with alpha.
```

```text
Layer 3 of 3 — Take this exact image and output ONLY the TOP glass slab of the three, unchanged in position, size, orientation, material and lighting, on a fully transparent background. Remove the other two slabs and all background bokeh shapes. Keep the soft white edge light of this slab. PNG with alpha.
```

```text
Bokeh layer — Take this exact image and output ONLY the blurred blue-violet bokeh shapes and the soft backlight glow from behind the glass stack, unchanged in position and softness, on a fully transparent background. Remove all three glass slabs entirely. PNG with alpha.
```

## 4. 动画预览（Midjourney/视频模型，只挑节奏）

```text
The three thick frosted glass slabs gently unfold and assemble into the floating stack one after another, soft backlight glowing through them, blurred bokeh shapes drifting slowly behind the glass, seamless slow loop, smooth easing, no camera movement.
```

## 5. 交付清单

定稿图 ×1 + 分层 PNG ×4（或仅定稿图，我键控切层）+ 动效节奏偏好 → 我接入向导头部。
