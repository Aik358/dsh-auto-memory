
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
const WSDIR='C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff'
const read=(p)=>{try{return readFileSync(p,'utf8')}catch(e){return ''}}
const leds=readdirSync(WSDIR).filter(n=>/^handoff-\d{8}-\d{6}(-[a-z])?\.md$/.test(n))
  .map(n=>({n,mt:statSync(path.join(WSDIR,n)).mtimeMs})).sort((a,b)=>b.mt-a.mt)
const latest=leds[0]
const txt=read(path.join(WSDIR,latest.n))
console.log('最新账本 = '+latest.n+'  ('+txt.length+' 字符)')
console.log('')
// 分段
const secs=[]
for (const m of txt.matchAll(/^## (.+)$/gm)) secs.push({title:m[1],start:m.index})
for (let i=0;i<secs.length;i++){secs[i].end = i+1<secs.length?secs[i+1].start:txt.length}
console.log('四段实际长度：')
for (const s of secs) console.log('   '+(s.end-s.start).toString().padStart(5)+'  '+s.title)
console.log('')
// 现行为：truncateHead(txt, 800) → 取头部
const head=txt.slice(0,800)
console.log('=== 现行为 truncateLinesBounded(txt, 800) 实际覆盖到 ===')
for (const s of secs) {
  const hit = head.includes(s.title)
  console.log('   ['+(hit?'✓ 覆盖到':'✗ 丢失')+'] '+s.title)
}
console.log('   注入尾部 60 字: '+JSON.stringify(head.slice(-60)))
console.log('')
// 加权截断
const { weightedTrimHandoffLedgerPre } = await import('file:///D:/dsh-auto-memory/lib/handoff-anchor.js')
const w = weightedTrimHandoffLedgerPre(txt, 800)
console.log('=== 接续链已在用的 weightedTrimHandoffLedgerPre(txt, 800) ===')
console.log('   长度 = '+(w?w.length:'null'))
if (w) {
  for (const s of secs) console.log('   ['+(w.includes(s.title)?'✓ 覆盖到':'✗ 丢失')+'] '+s.title)
  console.log('   注入尾部 60 字: '+JSON.stringify(w.slice(-60)))
}
console.log('')
console.log('⇒ 结论：同一份账本、同一份 800 预算，两条路径覆盖的段落不同。')
