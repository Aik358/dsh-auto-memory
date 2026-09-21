# -*- coding: utf-8 -*-
"""量取旧宣传图的构图分区与主色，作为 3.0 版 banner 的对齐依据。
用法: python tools/probe-banner.py"""
import sys
from PIL import Image

def avg(img, box):
    r = img.crop(box).convert('RGB').resize((1, 1), Image.LANCZOS)
    return r.getpixel((0, 0))

for path in sys.argv[1:] or [
    'docs/screenshots/promo/promo-1-hero.png',
    'docs/screenshots/promo/promo-0-banner-v2.png',
]:
    im = Image.open(path)
    W, H = im.size
    print(f'── {path}')
    print(f'   尺寸 {W}x{H}  模式 {im.mode}')
    # 四象限均值
    for name, box in [
        ('左上', (0, 0, W // 2, H // 2)),
        ('右上', (W // 2, 0, W, H // 2)),
        ('左下', (0, H // 2, W // 2, H)),
        ('右下', (W // 2, H // 2, W, H)),
    ]:
        print(f'   {name} 均值 rgb{avg(im, box)}')
    # 关键锚点像素
    for name, xy in [('左上角', (2, 2)), ('正中', (W // 2, H // 2)), ('右下角', (W - 3, H - 3))]:
        print(f'   {name} {im.convert("RGB").getpixel(xy)}')
    # 检测左侧信息卡边界（扫一行找亮度突变）
    row = H // 3
    px = im.convert('RGB')
    edges = []
    prev = px.getpixel((0, row))
    for x in range(1, W):
        cur = px.getpixel((x, row))
        d = sum(abs(a - b) for a, b in zip(cur, prev))
        if d > 60:
            edges.append(x)
        prev = cur
    print(f'   y={row} 行的强边缘 x 坐标: {edges[:14]}')
