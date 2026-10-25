
import sys
from PIL import Image
from collections import Counter
im = Image.open(sys.argv[1]).convert('RGB')
w,h = im.size
print('size', w, h)
def hx(xy): return '#%02X%02X%02X' % im.getpixel(xy)
pts = {
  '设置弹窗-左侧导航底':  (int(w*0.21), int(h*0.45)),
  '设置弹窗-内容区背景':  (int(w*0.45), int(h*0.62)),
  '设置弹窗-卡片蓝底':    (int(w*0.60), int(h*0.39)),
  '设置弹窗-卡片内部':    (int(w*0.45), int(h*0.46)),
  '设置弹窗-顶栏':        (int(w*0.46), int(h*0.13)),
  '页面-正文区背景':      (int(w*0.92), int(h*0.30)),
  '左侧栏-最深处':        (int(w*0.04), int(h*0.55)),
  '底部输入框':           (int(w*0.60), int(h*0.94)),
}
for k,(x,y) in pts.items(): print(f'{k:22s} ({x:4d},{y:4d}) = {hx((x,y))}')

print('\n=== 设置弹窗区域(宽 0.19-0.80, 高 0.20-0.85) Top10 主色 ===')
c = Counter()
for y in range(int(h*0.20), int(h*0.85), 3):
    for x in range(int(w*0.19), int(w*0.80), 3):
        c[im.getpixel((x,y))] += 1
for col,n in c.most_common(10):
    r,g,b = col
    tag = ''
    if b > r + 12: tag = '  ← 偏蓝'
    print('   #%02X%02X%02X  x%-6d%s' % (r,g,b,n,tag))
