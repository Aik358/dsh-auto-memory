import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {MemoryEngine,flushDiagnostics} from '../lib/audit-engine.mjs'
import {createContextHost} from '../../lib/context-host.js'
import {createProcedureStorePre} from '../../lib/procedure-store.js'
import {createEpisodicStorePre} from '../../lib/episodic-store.js'
import {createMemoryHubPre,procedureCandidateFromRow} from '../../lib/memory-hub.js'
import {EvidenceEventStore,sessionRefOf} from '../../lib/evidence-store.js'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'dam-evidence-case-')),old=process.env.DSH_HOME;process.env.DSH_HOME=root
let host
const spin=async()=>{for(let n=0;n<60;n++)await Promise.resolve();await flushDiagnostics()}
try{
 const engine=new MemoryEngine();engine.configLoaded=true;Object.assign(engine.config,{memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),memoryAnchorEnabled:true,memoryHubEnabled:true,associativeMemoryEnabled:true,contextBridgeEnabled:true,contextSinkMode:'fake',globalBriefEnabled:false,l0IndexEnabled:false,autoConsolidate:true,autoConsolidateMinChars:80,autoConsolidateDailyMax:20,episodicMinSegments:50})
 assert.notEqual(engine.wsKey('/fixture/Project'),engine.wsKey('/fixture/project'),'POSIX owner keys preserve case on every platform')
 await fs.writeFile(path.join(root,'.CaseProbe'),'case probe')
 const caseInsensitive=await fs.access(path.join(root,'.caseprobe')).then(()=>true,()=>false)
 const workspaceNames=caseInsensitive?['Project-A','Project-B']:['Project','project']
 const mid='mem_'+'a'.repeat(32),text='<!-- memory:'+mid+' -->\n\n## Deployment\nBuild and retain rollback artifacts; verify the deployment health.'
 const agents=workspaceNames.map((name,i)=>({id:'agent'+i,session:{id:'session'+i,header:{cwd:path.join(root,name)},events:[{type:'user/message',data:{message:{role:'user',content:[{type:'text',text:'Perform the requested deployment with build health checks and rollback artifacts. '.repeat(2)}]}}},{type:'assistant/message',data:{message:{role:'assistant',content:[{type:'text',text:'Deployment procedure completed and verified with reproducible build and health checks. '.repeat(2)}]}}}]}}))
 const paths=[];for(const a of agents){await fs.mkdir(a.session.header.cwd);const p=await engine.resolvePaths(a);paths.push(p);assert.equal((await engine.docStore.replaceRaw(p.notesPath,text)).ok,true)}
 assert.notEqual(engine.wsKey(paths[0].ws),engine.wsKey(paths[1].ws),'physical workspace owner keys differ')
 const procs=createProcedureStorePre(),episodic=createEpisodicStorePre(),hub=engine._memoryHub=createMemoryHubPre({stores:{procedures:procs,episodic}})
 const row={kindCandidate:'procedure_candidate',sourceIds:[mid],title:'Global build',excerpt:'Build and check health',successCriteria:['Healthy']};assert.equal(hub.ingestJudgement(row).consumed,'procedure')
 const global=procs.query()[0],local=paths.map((p,i)=>procs.observe({...procedureCandidateFromRow({...row,title:'Local build '+i}),scope:'workspace',workspaceRef:engine.wsKey(p.ws)}).procedure)
 host=engine._contextHost=createContextHost({engine});for(let i=0;i<agents.length;i++)host.capturePaths(engine.runtimeFor(agents[i]).key,paths[i])
 engine.runSubagent=async()=>'(无)'
 for(let i=0;i<agents.length;i++){
  const rt=engine.runtimeFor(agents[i]);host.onToolResult(rt,{sessionId:rt.sessionId,eventSeq:10+i,nativeSeq:10+i,timestamp:Date.now(),payload:{ok:true,resultPreview:await fs.readFile(paths[i].notesPath,'utf8')}});await spin()
  engine.ingestEnvelope(rt,{channel:'session',eventType:'user/message',sourceKind:'user',nativeSeq:20+i,payload:{text:mid},segment:{kind:'user',text:'Use '+mid+' for deployment'}});await spin()
  await engine.withAgent(agents[i],()=>engine.consolidateTurn(1,agents[i]));await spin()
  const own=procs.query().find(p=>p.procedureId===local[i].procedureId),other=procs.query().find(p=>p.procedureId===local[1-i].procedureId)
  assert.equal(own.evidence.read,1,'actual read keeps original workspace owner '+i);assert.equal(own.evidence.cite,1,'actual cite keeps owner '+i);assert.equal(own.evidence.success,1,'actual success keeps owner '+i)
  assert.equal(other.evidence.read,i?1:0,'cross-scope read rejected');assert.equal(other.evidence.cite,i?1:0);assert.equal(other.evidence.success,i?1:0)
 }
 const common=procs.query().find(p=>p.procedureId===global.procedureId);assert.equal(common.evidence.read,2);assert.equal(common.evidence.cite,2);assert.equal(common.evidence.success,2);assert.equal(common.evidence.sessions,2)
 const events=new EvidenceEventStore({root:path.join(root,'memory/evidence')}).loadEvents().events;for(const a of agents)for(const kind of ['read','cite','success'])assert(events.some(e=>e.kind===kind&&e.event.sessionRef===sessionRefOf(a.session.id)))
 console.log('PASS actual read/cite/success ownership, global eligibility and cross-scope rejection')
 if(caseInsensitive)console.log('SKIP native case-only directory pair: filesystem is case-insensitive; POSIX key case preservation verified directly')
 else console.log('PASS native case-only directory pair preserves separate evidence owners')
}finally{host?.disposeAll('test');await flushDiagnostics();if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;await fs.rm(root,{recursive:true,force:true})}
