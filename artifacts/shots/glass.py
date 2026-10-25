
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w,h = im.size
print('size',w,h)
def hx(p): return '#%02X%02X%02X' % p
# 面板内部 vs 面板外的页面：比较"背景透出度"（方差=能否看到背后内容）
import statistics
def region_stats(x0,x1,y0,y1,label):
    px=[im.getpixel((x,y)) for y in range(y0,y1,2) for x in range(x0,x1,2)]
    rs=[p[0] for p in px]; gs=[p[1] for p in px]; bs=[p[2] for p in px]
    mean=(sum(rs)/len(rs), sum(gs)/len(gs), sum(bs)/len(bs))
    sd=(statistics.pstdev(rs), statistics.pstdev(gs), statistics.pstdev(bs))
    print('  %-24s 均值=(%3.0f,%3.0f,%3.0f) %s  标准差=(%.1f,%.1f,%.1f)' % (
        label, mean[0],mean[1],mean[2], hx(tuple(int(v) for v in mean)), sd[0],sd[1],sd[2]))
    return sd
print('\n=== 透出度对比（低标准差=均匀纯色=没有玻璃；高标准差=能透出背后内容=有玻璃）===')
s_in  = region_stats(60,440,200,320,'面板内(概览卡片区)')
s_out = region_stats(560,860,200,420,'面板外的页面正文区')
s_low = region_stats(60,440,430,640,'面板内下半(空白区)')
print('\n  判据：面板内标准差 %.2f vs 页面 %.2f' % (s_in[0], s_out[0]))
print('  若面板内标准差 < 8 且无明显纹理 ⇒ 背后内容没透出来 ⇒ backdrop-filter 未生效/被隔离')
