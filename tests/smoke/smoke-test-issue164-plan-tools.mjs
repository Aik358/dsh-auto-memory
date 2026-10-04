import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {apply,MemoryEngine} from '../lib/audit-engine.mjs'
const root=await mkdtemp(path.join(os.tmpdir(),'dam-plan-tools-'))
const home=process.env.DSH_HOME,interval=globalThis.setInterval,timeout=globalThis.setTimeout,fetch=globalThis.fetch,load=MemoryEngine.prototype.loadConfigSync
const listeners=new Map(['uncaughtException','unhandledRejection','exit'].map(k=>[k,new Set(process.listeners(k))]))
const tools=[];let engine,cleanup
const agent={session:{id:'session-a',header:{cwd:path.join(root,'workspace')}}},exec={agent}
process.env.DSH_HOME=root;MemoryEngine.prototype.loadConfigSync=function(){engine=this;return load.call(this)}
try {
 await writeFile(path.join(root,'dsh-auto-memory.json'),JSON.stringify({criteriaGate:false,boardMode:'graph',memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),teamEnabled:false,globalBriefEnabled:false,externalSources:{}}))
 globalThis.setTimeout=globalThis.setInterval=()=>({unref(){}});globalThis.fetch=async()=>new Response('{}',{status:503})
 apply({get:key=>key==='agents'?{get:id=>id===agent.session.id?agent:null}:undefined,on:()=>{},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:t=>{tools.push(t);return()=>{}}},webServer:{register:()=>()=>{}},effect:f=>{cleanup=f()}},{})
 for(const[k,prev]of listeners)for(const l of process.listeners(k))if(!prev.has(l))process.removeListener(k,l)
 globalThis.setTimeout=timeout;globalThis.setInterval=interval
 const read=tools.find(t=>t.name==='memory_read'),note=tools.find(t=>t.name==='memory_note');assert.ok(read.parameters.properties.kind.enum.includes('plan'));assert.ok(note.parameters.properties.expectedRevision);assert.ok(note.parameters.properties.cardId)
 const missing=JSON.parse(await read.execute({kind:'plan'},exec));assert.equal(missing.content,'')
 const first=await note.execute({kind:'plan',content:'# Shared project\r\n## Knowledge\r\nInitial facts about project architecture and operation, not a session role.\r\n'},exec);assert.match(first,/已更新/)
 const snapshot=JSON.parse(await read.execute({kind:'plan'},exec));assert.match(snapshot.guidance,/职责指派/);assert.ok(snapshot.cards[0].id);assert.equal(snapshot.content,await readFile(snapshot.path,'utf8'))
 const changed=snapshot.cards[0].text.replace('Initial facts','Verified facts')
 const success=await note.execute({kind:'plan',content:changed,cardId:snapshot.cards[0].id,expectedCardRevision:snapshot.cards[0].revision},exec);assert.match(success,/已更新/);assert.match(success,/revision:/)
 const stale=await note.execute({kind:'plan',content:changed.replace('Verified','Stale'),cardId:snapshot.cards[0].id,expectedCardRevision:snapshot.cards[0].revision},exec);assert.match(stale,/冲突双方已保存/);assert.doesNotMatch(stale,/已更新/)
 const fresh=JSON.parse(await read.execute({kind:'plan'},exec));assert.match(fresh.content,/Verified facts/);assert.doesNotMatch(fresh.content,/Stale facts/)
 const recovered=await note.execute({kind:'plan',content:fresh.cards[0].text.replace('Verified','Reviewed'),cardId:fresh.cards[0].id,expectedCardRevision:fresh.cards[0].revision},exec);assert.match(recovered,/已更新/)
 const denied=await note.execute({kind:'plan',content:fresh.content},exec);assert.match(denied,/version-conflict/);assert.doesNotMatch(denied,/已更新/)
 // Production tools preserve mixed EOL and user bytes on exact read/write.
 const now=JSON.parse(await read.execute({kind:'plan'},exec))
 const mixed=now.content.replace('Reviewed facts','Mixed facts').replace('not a session role.\r\n','not a session role.\n<!--user-->\nUser  owned text\n<!--/user-->\n')
 const putMixed=await note.execute({kind:'plan',content:mixed,expectedRevision:now.revision},exec);assert.match(putMixed,/已更新/)
 const mixedRead=JSON.parse(await read.execute({kind:'plan'},exec));assert.equal(mixedRead.content,mixed)
 const roundtrip=await note.execute({kind:'plan',content:mixedRead.content,expectedRevision:mixedRead.revision},exec);assert.match(roundtrip,/已更新/);assert.equal(await readFile(mixedRead.path,'utf8'),mixed)
 const p=await engine.resolvePaths(agent)
 const panel=await engine.withAgent(agent,()=>engine.handoffPanelData('',agent.session.id))
 assert.ok(panel.planVersions.length);const archived=panel.planVersions.find(v=>v.name.includes('-')&&v.name.length>30);assert.ok(archived)
 const detail=await engine.withAgent(agent,()=>engine.handoffPanelData('archive/'+archived.name,agent.session.id));assert.ok(detail.text.length);assert.match(detail.text,/facts/)
 assert.equal((await engine.withAgent(agent,()=>engine.handoffPanelData('archive/../PLAN.md',agent.session.id))).error,'bad file name')
 const recalled=await engine.searchHandoffCorpus(['initial'],20,p);assert.ok(recalled.some(h=>h.where.includes('白板归档/PLAN-')))
 const recallTool=tools.find(t=>t.name==='memory_recall');assert.match(await recallTool.execute({query:'initial',scope:'handoff',limit:20},exec),/白板归档\/PLAN-/)
 // A version read from A must not authorize an empty/missing target, including B.
 const prior=JSON.parse(await read.execute({kind:'plan'},exec));await writeFile(prior.path,'')
 const empty=await note.execute({kind:'plan',content:prior.content,expectedRevision:prior.revision},exec);assert.match(empty,/version-conflict/);assert.equal(await readFile(prior.path,'utf8'),'')
 let index=await engine._loadSidecarIndexPre(p.projectDir);assert.ok(!index.entries.some(e=>e.source==='handoff/PLAN.md'))
 await rm(prior.path)
 const missingStale=await note.execute({kind:'plan',content:prior.content,expectedRevision:prior.revision},exec);assert.match(missingStale,/version-conflict/)
 index=await engine._loadSidecarIndexPre(p.projectDir);assert.ok(!index.entries.some(e=>e.source==='handoff/PLAN.md'))
 const other={agent:{session:{id:'session-b',header:{cwd:path.join(root,'other-workspace')}}}}
 const wrongTarget=await note.execute({kind:'plan',content:prior.content,expectedRevision:prior.revision},other);assert.match(wrongTarget,/version-conflict/)
 const firstInB=await note.execute({kind:'plan',content:'# Shared project\n## Knowledge\nFirst legitimate facts in newly bound workspace B.\n'},other);assert.match(firstInB,/已更新/)
 console.log('PASS #164: actual registered memory_read/memory_note schemas and read -> CRLF card update -> stale conflict -> fresh read -> explicit recovery flow')
}finally{
 globalThis.setTimeout=timeout;globalThis.setInterval=interval;globalThis.fetch=fetch;MemoryEngine.prototype.loadConfigSync=load;if(cleanup)cleanup()
 for(const[k,prev]of listeners)for(const l of process.listeners(k))if(!prev.has(l))process.removeListener(k,l)
 if(home===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=home;await rm(root,{recursive:true,force:true})
}
