import { readFileSync } from 'node:fs'
import path from 'node:path'
const MEMDIR='C:/Users/JH Z/.dsh/memory'
const WSDIR=path.join(MEMDIR,'workspaces','--D--dsh-auto-memory--')
const read=(p)=>{try{return readFileSync(p,'utf8')}catch(e){return ''}}
const um=read(path.join(MEMDIR,'MEMORY.md')); const pn=read(path.join(WSDIR,'MEMORY.md'))
const ds=(t)=>t.match(/20\d\d-\d\d-\d\d/g)||[]
const sub=1596
for (const [n,t] of [['user-memory',um],['project-notes',pn]]) {
  const h=t.slice(0,sub), hd=ds(h), all=ds(t)
  console.log('== '+n+'  sub='+sub)
  console.log('   注入窗口日期 '+(hd[0]||'-')+' ~ '+(hd[hd.length-1]||'-')+' / 文件最新 '+(all[all.length-1]||'-'))
  console.log('   注入窗口内日期数 '+hd.length)
}
// 规则段覆盖（新窗口）
const { extractRulesLayerPre } = await import('file:///D:/dsh-auto-memory/lib/rules-layer.js')
const rl=extractRulesLayerPre({userText:um,notesText:pn,rulesLayeringMode:'self'})
const rules=(rl.rules||[]).map(r=>String(r.text||'').replace(/\s+/g,'')).filter(s=>s.length>=8)
const inR=(line)=>{const n=line.replace(/\s+/g,'').replace(/^[-*·]\s*/,'');if(n.length<8)return false;return rules.some(r=>r.includes(n)||n.includes(r))}
for (const [n,t] of [['user-memory',um],['project-notes',pn]]) {
  const head=t.slice(0,sub); const lines=head.split('\n').filter(l=>l.trim())
  let c=0,u=0,cn=0,un=0
  for(const l of lines){ if(inR(l)){c+=l.length+1;cn++} else {u+=l.length+1;un++} }
  console.log('== '+n+' 已覆盖 '+cn+' 行/'+c+' 字符 ('+(100*c/head.length).toFixed(1)+'%)  未覆盖 '+un+' 行/'+u+' 字符 ('+(100*u/head.length).toFixed(1)+'%)')
}
