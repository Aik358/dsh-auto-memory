
import { readFileSync } from 'node:fs'
import path from 'node:path'
const WSDIR='C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff'
const read=(p)=>{try{return readFileSync(p,'utf8')}catch(e){return ''}}
const plan=read(path.join(WSDIR,'PLAN.md'))
console.log('PLAN.md = '+plan.length+' 字符')
const secs=[]
for (const m of plan.matchAll(/^## (.+)$/gm)) secs.push({title:m[1].slice(0,40),start:m.index})
for (let i=0;i<secs.length;i++) secs[i].end = i+1<secs.length?secs[i+1].start:plan.length
const head=plan.slice(0,1200)
console.log('截断窗口 1,200（handoffPlanChars 默认）')
let lost=0
for (const s of secs) { const hit=head.includes(s.title); if(!hit) lost++; console.log('   ['+(hit?'✓':'✗ 丢失')+'] '+s.title) }
console.log('   ⇒ 丢 '+lost+'/'+secs.length+' 个 ## 节')
// 找 "下一步" 关键词
console.log('   头部含「下一步」=', head.includes('下一步'), ' 全文含 =', plan.includes('下一步'))
console.log('   头部尾部 60 字: '+JSON.stringify(head.slice(-60)))
