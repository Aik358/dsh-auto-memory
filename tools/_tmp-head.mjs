import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
const M = Buffer.from([0x28,0xb5,0x2f,0xfd])
const fp = process.argv[2]
const buf = readFileSync(fp); const st = []
for (let i=0;i+4<=buf.length;i++) if (buf[i]===M[0]&&buf[i+1]===M[1]&&buf[i+2]===M[2]&&buf[i+3]===M[3]) st.push(i)
let t=''; for (let k=0;k<st.length;k++){const e=k+1<st.length?st[k+1]:buf.length; try{t+=zstdDecompressSync(buf.subarray(st[k],e)).toString('utf8')}catch(_){}}
const evs=[]; for (const l of t.split('\n')) { if(!l.trim()) continue; try{evs.push(JSON.parse(l))}catch(_){} }
console.log('事件数=' + evs.length)
for (const e of evs.slice(0, 14)) {
  let extra=''
  if (e.data && e.data.header && e.data.header.config) extra=' model='+e.data.header.config.model+' maxTokens='+e.data.header.config.maxTokens
  if (e.data && e.data.title) extra+=' title='+JSON.stringify(e.data.title)
  if (e.data && e.data.message && e.data.message.role) extra+=' role='+e.data.message.role
  if (e.data && e.data.text) extra+=' text='+String(e.data.text).slice(0,80)
  console.log(e.seq + '  ' + e.type + extra)
}
