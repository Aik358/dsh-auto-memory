# Build the dark<->light wipe animation for the README New UI section.  v2
# Semantics: ONE invariant — left of divider = dark, right = light.
#   x = OUT_W  -> all dark      x = 0 -> all light
# Loop (no jumps anywhere; every transition is a 1-frame continuation):
#   dark hold -> sweep out (x: OUT_W -> 0, light grows from the right)
#   -> light hold -> sweep back (x: 0 -> OUT_W, dark grows from the left) -> loop
# Sweep 2.5 s each way, dark hold 1.4 s, light hold 1.8 s. Handle only during sweeps.
from PIL import Image, ImageDraw
import os

DARK = r"D:\Tencent Files\2977975799\nt_qq\nt_data\Pic\2026-09\Ori\f6c22093859e0611710d9aaaa22cee06.png"
LIGHT = r"D:\Tencent Files\2977975799\nt_qq\nt_data\Pic\2026-09\Ori\84da9549c9ef8b1ae47f09fdea23e063.png"
OUT = r"D:\dsh-auto-memory\docs\skin-figures\skin-theme-compare.gif"

W, H = 1199, 702
OUT_W = 780
SCALE = OUT_W / W
OUT_H = round(H * SCALE)

dark = Image.open(DARK).convert('RGB').crop((0, 0, W, H)).resize((OUT_W, OUT_H), Image.LANCZOS)
light = Image.open(LIGHT).convert('RGB').crop((0, 0, min(W, 1201), H)).resize((OUT_W, OUT_H), Image.LANCZOS)

ACCENT = (77, 107, 254)
LINE = (232, 239, 255)
FPS = 18
SWEEP_MS = 2500
DARK_HOLD_MS = 1400
LIGHT_HOLD_MS = 1800
SWEEP_N = round(SWEEP_MS / (1000 / FPS))  # frames per sweep

def ease(t):
    return t * t * (3 - 2 * t)

def compose(split_x, handle):
    im = Image.new('RGB', (OUT_W, OUT_H))
    im.paste(light, (0, 0))
    if split_x > 0:
        im.paste(dark.crop((0, 0, split_x, OUT_H)), (0, 0))
    if handle:
        d = ImageDraw.Draw(im)
        d.rectangle([split_x - 2, 0, split_x + 1, OUT_H], fill=LINE)
        cy = OUT_H // 2
        r = 16
        d.ellipse([split_x - 2 - r, cy - r, split_x - 2 + r, cy + r], fill=(255, 255, 255), outline=ACCENT, width=3)
        ax = split_x - 2
        d.polygon([(ax - 9, cy - 5), (ax - 3, cy), (ax - 9, cy + 5)], fill=ACCENT)
        d.polygon([(ax + 9, cy - 5), (ax + 3, cy), (ax + 9, cy + 5)], fill=ACCENT)
    return im

frames = []  # (image, duration_ms)

ref = compose(OUT_W // 3, True)
pal_img = ref.quantize(colors=255, method=Image.MEDIANCUT)

def to_p(im):
    return im.quantize(palette=pal_img, dither=Image.FLOYDSTEINBERG)

# 1) dark hold — no handle, pure screenshot
frames.append((to_p(compose(OUT_W, False)), DARK_HOLD_MS))
# 2) sweep out: x OUT_W -> 0 (light grows from the right), handle rides the edge
for i in range(1, SWEEP_N + 1):
    x = round(OUT_W - ease(i / SWEEP_N) * (OUT_W - 4))
    frames.append((to_p(compose(max(2, min(x, OUT_W - 2)), True)), 1000 // FPS))
# 3) light hold — no handle
frames.append((to_p(compose(0, False)), LIGHT_HOLD_MS))
# 4) sweep back: x 0 -> OUT_W (dark grows from the left), handle rides the edge
for i in range(1, SWEEP_N + 1):
    x = round(2 + ease(i / SWEEP_N) * (OUT_W - 4))
    frames.append((to_p(compose(max(2, min(x, OUT_W - 2)), True)), 1000 // FPS))
# loop wraps to frame 0 = all dark; last sweep frame ends at x=OUT_W = all dark -> seamless

frames[0][0].save(OUT, format='GIF', save_all=True, append_images=[f for f, _ in frames[1:]],
                  duration=[d for _, d in frames], loop=0, optimize=True)
total_s = sum(d for _, d in frames) / 1000
print('frames:', len(frames), 'loop: %.1fs' % total_s, 'size KB:', os.path.getsize(OUT) // 1024)
