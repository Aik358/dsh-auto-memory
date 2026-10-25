import sys, json
from PIL import Image
p = sys.argv[1]
im = Image.open(p).convert('RGB')
w, h = im.size
raw = im.tobytes()
px = [tuple(raw[i:i+3]) for i in range(0, len(raw), 3)]
n = len(px)
lum = [(r*299 + g*587 + b*114)//1000 for (r,g,b) in px]
mean = sum(lum)/n
var = sum((x-mean)**2 for x in lum)/n
uniq = len(set(px))
nw = sum(1 for l in lum if l < 245)
print(json.dumps({'w': w, 'h': h, 'n': n, 'mean': round(mean, 2), 'variance': round(var, 2), 'uniqueColors': uniq, 'nonWhite': nw, 'nonWhitePct': round(100*nw/n, 3)}))