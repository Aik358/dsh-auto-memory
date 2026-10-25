
import { readFileSync } from 'node:fs'
import path from 'node:path'
const MEMDIR='C:/Users/JH Z/.dsh/memory'
const WSDIR=path.join(MEMDIR,'workspaces','--D--dsh-auto-memory--')
const read=(p)=>{try{return readFileSync(p,'utf8')}catch(e){return ''}}
const um=read(path.join(MEMDIR,'MEMORY.md'))
const pn=read(path.join(WSDIR,'MEMORY.md'))

// 把文件切成「块」：以 ## 或 ### 开头的行为界
function blocks(txt){
  const lines = txt.split('\n')
  const out = []
  let cur = { title:'(前言)', level:0, len:0 }
  for (const l of lines) {
    const m = l.match(/^(#{2,4}) (.+)/)
    if (m) { out.push(cur); cur = { title:m[2].slice(0,40), level:m[1].length, len:0 } }
    cur.len += l.length + 1
  }
  out.push(cur)
  return out.filter(b=>b.len>0)
}
for (const [name, txt] of [['user-memory', um], ['project-notes', pn]]) {
  const bs = blocks(txt)
  const dated = bs.filter(b=>/^20\d\d-\d\d-\d\d/.test(b.title) || /^\d{4}-\d{2}-\d{2}$/.test(b.title))
  const conv = bs.filter(b=>!/^20\d\d-/.test(b.title))
  const sum = (a)=>a.reduce((s,b)=>s+b.len,0)
  console.log('== '+name+'  '+txt.length+' 字符 · '+bs.length+' 块')
  console.log('   日期流水块 ' + dated.length + ' 个 = ' + sum(dated) + ' 字符 (' + (100*sum(dated)/txt.length).toFixed(1) + '%)  ← 应进事件')
  console.log('   约定/专题块 ' + conv.length + ' 个 = ' + sum(conv) + ' 字符 (' + (100*sum(conv)/txt.length).toFixed(1) + '%)  ← 应进规约')
  console.log('')
}
console.log('两文件合计 = ' + (um.length+pn.length) + ' 字符')
