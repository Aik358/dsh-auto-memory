import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {apply,MemoryEngine} from '../lib/audit-engine.mjs'
const root=await mkdtemp(path.join(os.tmpdir(),'dam-plan-tools-'))
const home=process.env.DSH_HOME,interval=globalThis.setInterval,timeout=globalThis.setTimeout,fetch=globalThis.fetch,load=MemoryEngine.prototype.loadConfigSync
const listeners=new Map(['uncaughtException','unhandledRejection','exit'].map(k=>[k,new Set(process.listeners(k))]))
const tools=[];let engine,cleanup
process.env.DSH_HOME=root;MemoryEngine.prototype.loadConfigSync=function(){engine=this;return load.call(this)}
try {
 await writeFile(path.join(root,'dsh-auto-memory.json'),JSON.stringify({criteriaGate:false,memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),teamEnabled:false,globalBriefEnabled:false,externalSources:{}}))
 globalThis.setTimeout=globalThis.setInterval=()=>({unref(){}});globalThis.fetch=async()=>new Response('{}',{status:503})
 apply({get:()=>undefined,on:()=>{},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:t=>{tools.push(t);return()=>{}}},webServer:{register:()=>()=>{}},effect:f=>{cleanup=f()}},{})
 for(const[k,prev]of listeners)for(const l of process.listeners(k))if(!prev.has(l))process.removeListener(k,l)
 globalThis.setTimeout=timeout;globalThis.setInterval=interval
 const read=tools.find(t=>t.name==='memory_read'),note=tools.find(t=>t.name==='memory_note');assert.ok(read.parameters.properties.kind.enum.includes('plan'));assert.ok(note.parameters.properties.expectedRevision);assert.ok(note.parameters.properties.cardId)
 const agent={session:{id:'session-a',header:{cwd:path.join(root,'workspace')}}},exec={agent}
 const missing=JSON.parse(await read.execute({kind:'plan'},exec));assert.equal(missing.content,'')
 const first=await note.execute({kind:'plan',content:'# Shared project\r\n## Knowledge\r\nInitial facts about project architecture and operation, not a session role.\r\n'},exec);assert.match(first,/已更新/)
 const snapshot=JSON.parse(await read.execute({kind:'plan'},exec));assert.match(snapshot.guidance,/职责指派/);assert.ok(snapshot.cards[0].id);assert.equal(snapshot.content,await readFile(snapshot.path,'utf8'))
 const changed=snapshot.cards[0].text.replace('Initial facts','Verified facts')
 const success=await note.execute({kind:'plan',content:changed,cardId:snapshot.cards[0].id,expectedCardRevision:snapshot.cards[0].revision},exec);assert.match(success,/已更新/);assert.match(success,/revision:/)
 const stale=await note.execute({kind:'plan',content:changed.replace('Verified','Stale'),cardId:snapshot.cards[0].id,expectedCardRevision:snapshot.cards[0].revision},exec);assert.match(stale,/冲突双方已保存/);assert.doesNotMatch(stale,/已更新/)
 const fresh=JSON.parse(await read.execute({kind:'plan'},exec));assert.match(fresh.content,/Verified facts/);assert.doesNotMatch(fresh.content,/Stale facts/)
 const recovered=await note.execute({kind:'plan',content:fresh.cards[0].text.replace('Verified','Reviewed'),cardId:fresh.cards[0].id,expectedCardRevision:fresh.cards[0].revision},exec);assert.match(recovered,/已更新/)
 const denied=await note.execute({kind:'plan',content:fresh.content},exec);assert.match(denied,/version-conflict/);assert.doesNotMatch(denied,/已更新/)
 console.log('PASS #164: actual registered memory_read/memory_note schemas and read -> CRLF card update -> stale conflict -> fresh read -> explicit recovery flow')
}finally{
 globalThis.setTimeout=timeout;globalThis.setInterval=interval;globalThis.fetch=fetch;MemoryEngine.prototype.loadConfigSync=load;if(cleanup)cleanup()
 for(const[k,prev]of listeners)for(const l of process.listeners(k))if(!prev.has(l))process.removeListener(k,l)
 if(home===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=home;await rm(root,{recursive:true,force:true})
}
