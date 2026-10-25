
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w,h = im.size
print('size', w, h)
def hx(p): return '#%02X%02X%02X' % p
isBlue = lambda p: p[2] - p[0] > 14

# ① 浮窗区域竖向扫描（x=270 中线），看颜色随 Y 如何变化
print('\n=== 浮窗中线(x=270) 竖向取色 ===')
for y in range(15, 700, 25):
    p = im.getpixel((270,y))
    print('   y=%3d  %s  %s' % (y, hx(p), '← 偏蓝' if isBlue(p) else ''))

# ② 偏蓝像素分布（分区统计）
print('\n=== 偏蓝像素分区统计 ===')
for name,(x0,x1,y0,y1) in {
  '浮窗上半(15-350)': (45,500,15,350),
  '浮窗下半(350-700)': (45,500,350,700),
  '页面右上(900-1280,20-400)': (900,1280,20,400),
  '页面右下(900-1280,400-780)': (900,1280,400,780),
  '左侧栏(0-45)': (0,45,20,780),
}.items():
    tot=0; blue=0
    for y in range(y0,y1,4):
        for x in range(x0,x1,4):
            tot+=1
            if isBlue(im.getpixel((x,y))): blue+=1
    print('   %-26s 取样 %5d  偏蓝 %5d  (%.1f%%)' % (name, tot, blue, 100.0*blue/max(tot,1)))

# ③ 找出浮窗内所有"偏蓝 AND 不透明感强"的具体色值分布
from collections import Counter
c = Counter()
for y in range(15, 700, 3):
    for x in range(45, 500, 3):
        p = im.getpixel((x,y))
        if isBlue(p): c[p]+=1
print('\n=== 浮窗内偏蓝色 Top12 ===')
for col,n in c.most_common(12):
    print('   %s  x%-6d  (b-r=%d)' % (hx(col), n, col[2]-col[0]))

# ④ 面板顶部菜单条 vs 底部区域 精确取色
print('\n=== 关键点 ===')
for name,(x,y) in {'页签条':(150,147),'卡片内部':(200,230),'卡片底':(250,290),
                   '中部空白':(300,330),'下半空白':(300,560),'下半卡片':(250,520),
                   '面板最底':(300,690)}.items():
    print('   %-12s (%3d,%3d) = %s' % (name,x,y,hx(im.getpixel((x,y)))))
