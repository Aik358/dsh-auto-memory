
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
const { composeTieredInjectionPre } = await import('file:///D:/dsh-auto-memory/lib/tier-layer-inject.js')

const MEMDIR='C:/Users/JH Z/.dsh/memory'
const WSDIR=path.join(MEMDIR,'workspaces','--D--dsh-auto-memory--')
const read=(p)=>{try{return readFileSync(p,'utf8')}catch(e){return ''}}
const userText=read(path.join(MEMDIR,'MEMORY.md'))
const notesText=read(path.join(WSDIR,'MEMORY.md'))
const logText=read(path.join(WSDIR,'2026-10-24.md'))
const planText=read(path.join(WSDIR,'handoff','PLAN.md'))
const refl=read(path.join(WSDIR,'reflections','2026-10-23.md'))
const latestReflection = refl || ''

// 与 buildTierLayerInjection 同参（去除封顶后的真实口径）
const cfg = { injectBudgetChars:8000, tier0BudgetShare:0.25, tier0MaxTokens:400 }
const budgetChars = 8000
const share = 0.25
const maxTotalChars = Math.max(200, Math.floor(budgetChars*share))
const cfgTokens = 400
const B0 = 800
const maxTokens = Math.min(cfgTokens, B0, Math.max(120, Math.ceil(maxTotalChars/2)))

const sources = []
const add=(layer,text,p)=>{const t=text==null?'':String(text); if(t.trim()) sources.push({layer,text:t,path:p||'',sourceRef:layer+':'+path.basename(p||'MEMORY.md')})}
add('user', userText, path.join(MEMDIR,'MEMORY.md'))
add('project', notesText, path.join(WSDIR,'MEMORY.md'))
add('log', logText, path.join(WSDIR,'2026-10-24.md'))
add('whiteboard', planText, path.join(WSDIR,'handoff','PLAN.md'))
add('reflection', latestReflection, '')

const res = composeTieredInjectionPre({ sources, maxTokens, maxTotalChars, hits:[], question:'', indexNotReady:null, semanticArm:'unavailable', excludeSources:[], extraDegradations:[] })
const text = res.text || ''
console.log('真实 Tier-0 目录文本 = ' + text.length + ' 字符')
console.log('  tier0Tokens = ' + res.tier0Tokens + ' / maxTokens ' + maxTokens + ' / maxTotalChars ' + maxTotalChars)
console.log('  perLayer = ' + JSON.stringify(res.tier0 && res.tier0.quota ? res.tier0.quota.perLayer : null))
console.log('  items = ' + (res.tier0?res.tier0.items:0) + ' candidates=' + (res.tier0?res.tier0.candidates:0) + ' dropped=' + (res.tier0?res.tier0.dropped:0))
console.log('  degradations = ' + JSON.stringify(res.degradations))
console.log('')
console.log('---- 前 500 字 ----')
console.log(text.slice(0,500))
console.log('')
console.log('---- 后 300 字 ----')
console.log(text.slice(-300))
