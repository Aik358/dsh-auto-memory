import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {MemoryEngine,flushDiagnostics} from '../lib/audit-engine.mjs'
import {createContextHost} from '../../lib/context-host.js'
import {createProcedureStorePre} from '../../lib/procedure-store.js'
import {createEpisodicStorePre} from '../../lib/episodic-store.js'
import {createMemoryHubPre} from '../../lib/memory-hub.js'
const root=await fsp.mkdtemp(path.join(os.tmpdir(),'dam-upgrade-host-')),old=process.env.DSH_HOME
let pass=0,fail=0
const spin=async()=>{for(let n=0;n<60;n++)await Promise.resolve();await flushDiagnostics()}
try{for(const mode of ['raw','truncated']){
 const home=path.join(root,mode);await fsp.mkdir(home);process.env.DSH_HOME=home
 const engine=new MemoryEngine();engine.configLoaded=true;Object.assign(engine.config,{memoryRoot:path.join(home,'memory'),userMemoryDir:path.join(home,'user'),memoryAnchorEnabled:true,memoryHubEnabled:true,associativeMemoryEnabled:true,contextBridgeEnabled:true,contextSinkMode:'fake',globalBriefEnabled:false,l0IndexEnabled:false,autoConsolidate:true,autoConsolidateMinChars:80,autoConsolidateDailyMax:20,episodicMinSegments:50})
 const ws=path.join(home,'Project');await fsp.mkdir(ws)
 const agents=[mode==='raw'?'A':'A'.repeat(64),'C'].map(id=>({id,session:{id,header:{cwd:ws},events:[{type:'user/message',data:{message:{role:'user',content:[{type:'text',text:'Perform a deployment with retained artifacts and repeatable health checks. '.repeat(2)}]}}},{type:'assistant/message',data:{message:{role:'assistant',content:[{type:'text',text:'Completed deployment and checked rollback artifacts and reproducible health checks. '.repeat(2)}]}}}]}}))
 const p=await engine.resolvePaths(agents[0]),mid='mem_'+'a'.repeat(32);assert((await engine.docStore.replaceRaw(p.notesPath,'<!-- memory:'+mid+' -->\n\n## Deployment\nBuild and verify health.')).ok)
 const snapshotFile=path.join(home,'procedures.json'),io={load:()=>null,save:s=>fs.writeFileSync(snapshotFile,JSON.stringify(s))},data=JSON.parse(await fsp.readFile(new URL('../fixtures/audit-followup/procedure-session-'+mode+'.json',import.meta.url),'utf8'))
 let procs=createProcedureStorePre({io});assert(procs.restore(data).ok);const pid=procs.query()[0].procedureId
 engine._memoryHub=createMemoryHubPre({stores:{procedures:procs,episodic:createEpisodicStorePre()}})
 let host=engine._contextHost=createContextHost({engine});for(const a of agents)host.capturePaths(engine.runtimeFor(a).key,p)
 engine.runSubagent=async()=>'(无)'
 const actualReadSuccess=async(index,seq)=>{const a=agents[index],rt=engine.runtimeFor(a);host.onToolResult(rt,{sessionId:rt.sessionId,eventSeq:seq,nativeSeq:seq,timestamp:Date.now(),payload:{ok:true,resultPreview:await fsp.readFile(p.notesPath,'utf8')}});await spin();await engine.withAgent(a,()=>engine.consolidateTurn(1,a));await spin()}
 try{
  await actualReadSuccess(0,10);assert.equal(procs.query()[0].evidence.sessions,2,'old A read/success must not manufacture third identity');assert.equal(procs.promote(pid).promoted,false)
  assert.equal(procs.query()[0].evidence.success,2,'actual new success adds one to historical count')
  host.disposeAll('reload');procs=createProcedureStorePre({io});assert(procs.restore(JSON.parse(await fsp.readFile(snapshotFile,'utf8'))).ok);engine._memoryHub.stores.procedures=procs
  host=engine._contextHost=createContextHost({engine});for(const a of agents)host.capturePaths(engine.runtimeFor(a).key,p)
  await actualReadSuccess(1,20);assert.equal(procs.query()[0].evidence.sessions,3,'genuinely new C verified after actual snapshot reload');assert.equal(procs.query()[0].sessionIdentityVersion,2)
  console.log('PASS '+mode+' actual read/success upgrade and snapshot reload');pass++
 }catch(e){console.error('FAIL '+mode+' '+e.stack);fail++}finally{host.disposeAll('test');await flushDiagnostics()}
}}finally{if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;await fsp.rm(root,{recursive:true,force:true})}
console.log('PASS '+pass+' / FAIL '+fail);process.exitCode=fail?1:0
