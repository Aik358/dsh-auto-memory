import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
const ROOT='D:/dsh-auto-memory'
const SRC=readFileSync(path.join(ROOT,'lib','index.js'),'utf8')
function extractFn(h){const s=SRC.indexOf(h);let d=0,e=-1;for(let i=s+h.length-1;i<SRC.length;i++){if(SRC[i]==='{')d++;else if(SRC[i]==='}'){d--;if(d===0){e=i;break}}}return SRC.slice(s,e+1)}
function grab(n){const L=SRC.split('\n');let li=L.findIndex(l=>{const t=l.trim();return t.startsWith('const '+n+' ')||t.startsWith('const '+n+'=')||t.startsWith('function '+n+'(')||t.startsWith('var '+n+' ')||t.startsWith('export const '+n)});if(li<0)throw new Error('nf '+n);let b='',d=0,s=false;for(;li<L.length;li++){b+=L[li]+'\n';for(const c of L[li]){if(c==='('||c==='{'){d++;s=true}else if(c===')'||c==='}')d--}if(s&&d<=0)break;if(!s&&/ = \//.test(L[li]))break}return b}
const MEMDIR='C:/Users/JH Z/.dsh/memory'
const WSDIR=path.join(MEMDIR,'workspaces','--D--dsh-auto-memory--')
const read=(p)=>{try{return readFileSync(p,'utf8')}catch(e){return ''}}
const userText=read(path.join(MEMDIR,'MEMORY.md'))
const notesText=read(path.join(WSDIR,'MEMORY.md'))
const planText=read(path.join(WSDIR,'handoff','PLAN.md'))
const todayLog=read(path.join(WSDIR,'2026-10-24.md'))
const leds=readdirSync(path.join(WSDIR,'handoff')).filter(n=>/^handoff-\d{8}-\d{6}(-[a-z])?\.md$/.test(n)).map(n=>({n,mt:statSync(path.join(WSDIR,'handoff',n)).mtimeMs})).sort((a,b)=>b.mt-a.mt)
const latestHandoffText = leds.length?read(path.join(WSDIR,'handoff',leds[0].n)):''

// 真实 tier0
const { composeTieredInjectionPre } = await import('file:///D:/dsh-auto-memory/lib/tier-layer-inject.js')
const ts=[]
const add=(l,t,p)=>{const s=t==null?'':String(t); if(s.trim()) ts.push({layer:l,text:s,path:p||'',sourceRef:l+':'+path.basename(p||'MEMORY.md')})}
add('user',userText,path.join(MEMDIR,'MEMORY.md')); add('project',notesText,path.join(WSDIR,'MEMORY.md'))
add('log',todayLog,path.join(WSDIR,'2026-10-24.md')); add('whiteboard',planText,path.join(WSDIR,'handoff','PLAN.md'))
const tr=composeTieredInjectionPre({sources:ts,maxTokens:400,maxTotalChars:2000,hits:[],question:'',indexNotReady:null,semanticArm:'unavailable',excludeSources:[],extraDegradations:[]})
const REAL_TIER0 = tr.text || ''
console.log('真实 tier0LayerText = ' + REAL_TIER0.length)

const { extractRulesLayerPre, renderRulesSectionPre } = await import('file:///D:/dsh-auto-memory/lib/rules-layer.js')
const rl=extractRulesLayerPre({userText,notesText,rulesLayeringMode:'self'}); const rs=renderRulesSectionPre(rl,{})
const injCode=readFileSync(path.join(ROOT,'lib','injection-policy.js'),'utf8').replace(/^export /gm,'')
const envCode=readFileSync(path.join(ROOT,'lib','memory-envelope.js'),'utf8').replace(/^export /gm,'')
const helpers=['pad','DEFAULT_PROMPT_LAYERS','neutralizePromptTemplateVars','truncateHead','truncateLinesBounded','sanitizeForInjection','scrubJunkLines','reflectionDigest','mojibakeDensity','MOJIBAKE_RE','detectStutter','hasStutter','BASE64_LINE','todayStr'].map(grab).join('\n')
const stub='\nconst RULES_SECTION_TITLE_PRE_V1="";const RULES_SECTION_GUIDE_PRE_V1="";'
 +'\nconst __RS='+JSON.stringify({text:rs.text,chars:rs.chars})+';'
 +'\nfunction extractRulesLayerPre(){return {enabled:true,rules:[]}};function renderRulesSectionPre(){return {text:__RS.text,chars:__RS.chars}};'
 +'\nconst DEFAULT_WATER_LEVEL_THRESHOLD=0.75;const DEFAULT_AUTO_CONTINUE_THRESHOLD=0.75;'
let dyn=extractFn('renderMemoryDynamic(context) {')
const dynP=dyn.replace('const envelope = composeMemoryEnvelopePre({','const envelope = __spy({')
const extra='\nconst __S={last:null};function __spy(i){const e=composeMemoryEnvelopePre(i);__S.last=e;return e}\n'
const sb=new Function(helpers+'\n'+injCode+'\n'+envCode+stub+extra+'\nreturn {'+dynP+', __S};')()
const fn=sb['renderMemoryDynamic'], S=sb['__S']
const fake={ state:{ ws:'D:/dsh-auto-memory', recentLogs:[{date:'2026-10-24',text:todayLog.split('\n').slice(-40).join(' | ')}],
  latestReflection:'', latestReflectionDate:'', userText, notesText, planText, latestHandoffText,
  workspaceMap:['aik_auto_memory_use','personal_issue'], calendarText:'', tier0LayerText:REAL_TIER0 },
  config:{ injectBudgetChars:8000, handoffEnabled:true, handoffPlanChars:1200, handoffLedgerChars:800, dayBoundaryMinutes:450, autoConsolidate:true, promptLayerOverrides:{}, rulesLayeringMode:'self' },
  memToday:()=>'2026-10-24', parseCalendar:()=>[], runtimes:{values:()=>[]}, isUnattendedNow:()=>false, external:{cache:[]}, _recallStats:null }
const out=fn.call(fake,{})
const env=S.last
const PROMPT=new Set(['rules-section','frame-inscription','frame-head','frame-meta','frame-tail'])
let p=0,m=0
console.log('')
console.log('★ 完整版（真实 tier0）= ' + out.length + ' 字符')
for (const s of (env.segments||[]).slice().sort((a,b)=>b.chars-a.chars)) {
  const cls=PROMPT.has(s.kind)?'P':'M'
  if(cls==='P')p+=s.chars; else m+=s.chars
  console.log('  ['+cls+'] '+s.kind.padEnd(20)+String(s.chars).padStart(6)+'  '+(100*s.chars/out.length).toFixed(1)+'%')
}
console.log('  P='+p+' ('+(100*p/out.length).toFixed(1)+'%)  M='+m+' ('+(100*m/out.length).toFixed(1)+'%)')
console.log('  分项='+JSON.stringify(env.chars))
console.log('  memRefLimit 推算='+(Math.floor((8000-500-(REAL_TIER0.length+2))/4)*4 + (REAL_TIER0.length+2) + 1200 + 800 + 400))
