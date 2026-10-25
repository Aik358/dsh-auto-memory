
import { readFileSync } from 'node:fs'
import path from 'node:path'
const ROOT='D:/dsh-auto-memory'
const SRC=readFileSync(path.join(ROOT,'lib','index.js'),'utf8')
function grab(n){const L=SRC.split('\n');let li=L.findIndex(l=>{const t=l.trim();return t.startsWith('const '+n+' ')||t.startsWith('const '+n+'=')||t.startsWith('function '+n+'(')||t.startsWith('var '+n+' ')||t.startsWith('export const '+n)});if(li<0)throw new Error('nf '+n);let b='',d=0,s=false;for(;li<L.length;li++){b+=L[li]+'\n';for(const c of L[li]){if(c==='('||c==='{'){d++;s=true}else if(c===')'||c==='}')d--}if(s&&d<=0)break;if(!s&&/ = \//.test(L[li]))break}return b}

const MEMDIR='C:/Users/JH Z/.dsh/memory'
const WSDIR=path.join(MEMDIR,'workspaces','--D--dsh-auto-memory--')
const read=(p)=>{try{return readFileSync(p,'utf8')}catch(e){return ''}}
const userText=read(path.join(MEMDIR,'MEMORY.md'))
const notesText=read(path.join(WSDIR,'MEMORY.md'))

const { extractRulesLayerPre, renderRulesSectionPre } = await import('file:///D:/dsh-auto-memory/lib/rules-layer.js')
const rlBoth = extractRulesLayerPre({ userText, notesText, rulesLayeringMode:'self' })
const rlUser = extractRulesLayerPre({ userText, notesText:'', rulesLayeringMode:'self' })
const rsBoth = renderRulesSectionPre(rlBoth, {})
const rsUser = renderRulesSectionPre(rlUser, {})

console.log('规则段（user+notes）= ' + rsBoth.chars + ' 字符 / 规则 ' + (rlBoth.rules||[]).length + ' 条')
console.log('规则段（仅 user）  = ' + rsUser.chars + ' 字符 / 规则 ' + (rlUser.rules||[]).length + ' 条')
console.log('  ⇒ 项目笔记贡献 ' + ((rlBoth.rules||[]).length - (rlUser.rules||[]).length) + ' 条 / ' + (rsBoth.chars - rsUser.chars) + ' 字符')
console.log('')

// 注入侧：user-memory 段 = truncateHead(stripSensitiveSections(sanitize(userText)), sub)
// 实测 sub：injectBudgetChars=8000, catalogCost=867+2=869 ⇒ sub=floor((8000-500-869)/4)=1657
const sub = Math.floor((8000-500-(867+2))/4)
console.log('sub（每段证据层预算）= ' + sub)
const umInjected = userText.slice(0, sub)
const pnInjected = notesText.slice(0, sub)
console.log('user-memory 实注 = ' + umInjected.length + ' / 原文件 ' + userText.length + ' ⇒ 注入率 ' + (100*umInjected.length/userText.length).toFixed(1) + '%')
console.log('project-notes 实注 = ' + pnInjected.length + ' / 原文件 ' + notesText.length + ' ⇒ 注入率 ' + (100*pnInjected.length/notesText.length).toFixed(1) + '%')
console.log('')

// 重叠：注入的 user-memory 文本里，有多少行也出现在规则段里
const norm = (s) => s.replace(/\s+/g,'').replace(/^-/,'')
const rulesNorm = norm(rsBoth.text)
let dupChars = 0, dupLines = 0, totalLines = 0
for (const raw of umInjected.split('\n')) {
  const t = raw.trim()
  if (!t) continue
  totalLines++
  const n = norm(t)
  if (n.length >= 6 && rulesNorm.includes(n)) { dupChars += raw.length; dupLines++ }
}
console.log('★ user-memory 注入段：' + totalLines + ' 行中 ' + dupLines + ' 行（' + dupChars + ' 字符）与规则段重复')
console.log('   重复字符占该段 ' + (100*dupChars/umInjected.length).toFixed(1) + '%')
let dupChars2 = 0, dupLines2 = 0, totalLines2 = 0
for (const raw of pnInjected.split('\n')) {
  const t = raw.trim()
  if (!t) continue
  totalLines2++
  const n = norm(t)
  if (n.length >= 6 && rulesNorm.includes(n)) { dupChars2 += raw.length; dupLines2++ }
}
console.log('★ project-notes 注入段：' + totalLines2 + ' 行中 ' + dupLines2 + ' 行（' + dupChars2 + ' 字符）与规则段重复')
console.log('   重复字符占该段 ' + (100*dupChars2/pnInjected.length).toFixed(1) + '%')
console.log('')
console.log('⇒ 三段合计重复 ' + (dupChars+dupChars2) + ' 字符 / 完整版 17,347 ⇒ ' + (100*(dupChars+dupChars2)/17347).toFixed(1) + '%')

// head 与 rules 的语义冲突（原文取证）
console.log('')
const head = (SRC.match(/snapshotHead: '([^']*)'/)||[])[1]||''
console.log('snapshotHead 含「只是背景事实与规则参考」=', head.includes('只是背景事实与规则参考'))
console.log('snapshotRulesGuide 含「以本节为准」=', SRC.includes('凡与其它内容冲突，以本节为准'))
