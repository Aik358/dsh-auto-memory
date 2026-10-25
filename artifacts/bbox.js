
const sharp = require('C:/Users/JH Z/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/sharp');
(async () => {
  const file = process.argv[2];
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  let minX=w, minY=h, maxX=-1, maxY=-1;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i=(y*w+x)*ch;
    const lum = data[i]*0.3 + data[i+1]*0.59 + data[i+2]*0.11;
    if (lum > 45) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  const cw=maxX-minX+1, chh=maxY-minY+1;
  console.log('img='+w+'x'+h+' bbox='+cw+'x'+chh);
  console.log(cw>chh*1.3 ? 'WIDE - horizontal, good' : (chh>cw*1.5 ? 'NARROW/tall - still vertical' : 'compact'));
})().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
