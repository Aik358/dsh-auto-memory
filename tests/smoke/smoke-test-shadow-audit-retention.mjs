import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { pathToFileURL,fileURLToPath } from 'node:url'
const repo=process.env.AUDIT_TEST_REPO||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'), root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ocr-shadow-isolated-'))
Object.assign(process.env,{HOME:root,USERPROFILE:root,DSH_HOME:root})
const {createShadowHost}=await import(pathToFileURL(path.join(repo,'lib/shadow-host.js')).href)
const engine={config:{associativeMemoryEnabled:true,shadowRetrievalEnabled:true,memoryAnchorEnabled:true},runtimes:new Map()}
const host=createShadowHost({engine,onDiag:()=>{}})
const ws=path.join(root,'workspace');await fs.mkdir(ws);const memory=path.join(ws,'MEMORY.md')
await fs.writeFile(memory,'<!-- memory:mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n## 项目架构\n- 之前确定项目使用 Node 架构，配置和设计均已记录。\n')
async function event(n){
 const now=Date.now(),seg={id:'seg-'+n,digest:'a'.repeat(64),kind:'user',eventSeq:n,contextVersion:n,ts:now,text:'请回忆之前的项目架构配置与设计记录，上次采用了什么方案？',eventType:'session/message'}
 const rt={key:'session:'+n,sessionId:'synthetic-session-'+n,agentId:'synthetic-agent',contextVersion:n,disposed:false,agent:{session:{header:{}}},segments:{snapshot:()=>[seg]}}
 engine.runtimes.set(rt.key,rt);host.capturePaths(rt.key,{ws,userDir:root,notesPath:memory})
 host.onSegmentAccepted(rt,seg,{sessionId:rt.sessionId,payload:{}})
 for(let i=0;i<100;i++){if(host.debugView().auditWritten>=n)return;await new Promise(r=>setTimeout(r,10))}
 throw new Error('fixture did not generate durable audit:'+JSON.stringify(host.debugView()))
}
try{
 await event(1)
 const dir=host.debugView().auditDirPath, names=await fs.readdir(dir), f=path.join(dir,names[0])
 const line=await fs.readFile(f,'utf8'),cap=32*1024*1024
 // Seed valid synthetic events just below the declared retention limit, then
 // exercise a normal second production append on the already-running host.
 const copies=Math.floor((cap-50)/Buffer.byteLength(line)),seed=line.repeat(copies)
 await fs.writeFile(f,seed)
 const before=(await fs.stat(f)).size
 await event(2)
 const after=(await fs.stat(f)).size
 assert(after<=cap);assert.equal(host.debugView().auditWritten,2);assert((await fs.readFile(f,'utf8')).length>0)
 const expired=path.join(dir,'2000-01-01.jsonl');await fs.writeFile(expired,line);const old=new Date(Date.now()-15*86400000);await fs.utimes(expired,old,old);await event(3);assert.equal(await fs.stat(expired).catch(()=>null),null);assert.equal(host.debugView().auditWritten,3);assert.equal(await fs.readFile(memory,'utf8'),'<!-- memory:mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n## 项目架构\n- 之前确定项目使用 Node 架构，配置和设计均已记录。\n')
 console.log(JSON.stringify({mode:'public createShadowHost/capturePaths/onSegmentAccepted, two isolated synthetic runtimes',beforeBytes:before,afterBytes:after,declaredCapBytes:cap,auditWritten:host.debugView().auditWritten,overCap:false,ageRetention:true,originalMarkdownPreserved:true},null,2))
}finally{host.disposeAll('fixture-finished');await fs.rm(root,{recursive:true,force:true})}
