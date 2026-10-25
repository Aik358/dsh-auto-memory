
import { readFileSync } from 'node:fs'
import path from 'node:path'
const MEMDIR='C:/Users/JH Z/.dsh/memory'
const WSDIR=path.join(MEMDIR,'workspaces','--D--dsh-auto-memory--')
const read=(p)=>{try{return readFileSync(p,'utf8')}catch(e){return ''}}
const userText=read(path.join(MEMDIR,'MEMORY.md'))
const notesText=read(path.join(WSDIR,'MEMORY.md'))

const isoDates = (t) => (t.match(/20\d\d-\d\d-\d\d/g)||[])
const uniq = (a)=>Array.from(new Set(a))

for (const [name, txt, cap] of [['user-memory', userText, 1657], ['project-notes', notesText, 1657]]) {
  const ds = isoDates(txt)
  const head = txt.slice(0, cap)
  const dsHead = isoDates(head)
  console.log('== ' + name)
  console.log('   文件 ' + txt.length + ' 字符；日期戳 ' + ds.length + ' 个，范围 ' + ds[0] + ' → ' + ds[ds.length-1])
  console.log('   注入前 ' + cap + ' 字符（头部）里日期 ' + dsHead.length + ' 个，范围 ' + (dsHead[0]||'无') + ' → ' + (dsHead[dsHead.length-1]||'无'))
  // 最新 2000 字符的日期范围
  const tail = txt.slice(-3000)
  const dsTail = isoDates(tail)
  console.log('   文件末尾 3000 字符里日期范围 ' + (dsTail[0]||'无') + ' → ' + (dsTail[dsTail.length-1]||'无'))
  console.log('   注入段最后一个日期 = ' + (dsHead[dsHead.length-1]||'无') + '；文件最后一个日期 = ' + (ds[ds.length-1]||'无'))
  // 头部 30 行 / 末尾 30 行首行对比
  const hl = head.split('\n').filter(l=>l.trim()).slice(0,3)
  const tl = txt.split('\n').filter(l=>l.trim()).slice(-3)
  console.log('   注入段（头部）前 3 行: ' + JSON.stringify(hl.map(s=>s.slice(0,50))))
  console.log('   文件末尾 3 行:        ' + JSON.stringify(tl.map(s=>s.slice(0,50))))
  console.log('')
}

// 头部锚点区块：MEMORY.md 的结构（### 段 + <!-- memory:mem_xxx -->）
const blocks = userText.split(/\n(?=### )/).map(b=>({title:(b.match(/^### (.+)/)||[])[1]||'(前言)', len:b.length}))
console.log('用户级 MEMORY.md 顶层 ### 块 ' + blocks.length + ' 个：')
for (const b of blocks.slice(0,6)) console.log('   ' + b.len.toString().padStart(6) + '  ' + b.title)
console.log('   ...')
for (const b of blocks.slice(-4)) console.log('   ' + b.len.toString().padStart(6) + '  ' + b.title)
