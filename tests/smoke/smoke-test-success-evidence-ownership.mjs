import assert from 'node:assert/strict'
import fs from 'node:fs'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {MemoryEngine,flushDiagnostics} from '../lib/audit-engine.mjs'
import {createContextHost} from '../../lib/context-host.js'
import {createAccessEvidencePre} from '../../lib/context-bridge.js'
import {EvidenceEventStore,sessionRefOf,workspaceRefOf} from '../../lib/evidence-store.js'
import {createProcedureStorePre} from '../../lib/procedure-store.js'
import {createEpisodicStorePre} from '../../lib/episodic-store.js'
import {createMemoryHubPre} from '../../lib/memory-hub.js'
import {buildSourceCatalog,CorpusRegistry,canonicalize} from '../../lib/m4-corpus.js'
const base=await mkdtemp(path.join(os.tmpdir(),'dam-success-owner-')),previous=process.env.DSH_HOME
const spin=async()=>{for(let i=0;i<40;i++)await Promise.resolve()}
let pass=0,fail=0
try{for(const scenario of ['session-feed','duplicate-feed','unrelated-turn','true-success','wrong-workspace']){
 const home=path.join(base,scenario);await mkdir(home);process.env.DSH_HOME=home
 const engine=new MemoryEngine();engine.configLoaded=true
 Object.assign(engine.config,{memoryRoot:path.join(home,'memory'),userMemoryDir:path.join(home,'user'),memoryAnchorEnabled:true,memoryHubEnabled:true,associativeMemoryEnabled:true,contextBridgeEnabled:true,contextSinkMode:'fake',pythonBackendEnabled:false,globalBriefEnabled:false,l0IndexEnabled:false,autoConsolidate:true,autoConsolidateMinChars:80,autoConsolidateDailyMax:50,episodicMinSegments:50})
 const ws=path.join(home,'ws'),agents=Object.fromEntries(['A','B','C'].map(id=>[id,{id,session:{id,header:{cwd:ws},events:[{type:'user/message',data:{message:{role:'user',content:[{type:'text',text:'Investigate and implement the requested deployment procedure with retained rollback artifacts. '.repeat(2)}]}}},{type:'assistant/message',data:{message:{role:'assistant',content:[{type:'text',text:'Completed the requested implementation and verified repeatable local build and rollback steps. '.repeat(2)}]}}}]}}]))
 await mkdir(ws,{recursive:true});const paths=await engine.resolvePaths(agents.A);assert.equal((await engine.docStore.append(paths.notesPath,'## Deployment\nDeploy using pnpm build; retain rollback artifacts and verify health.')).ok,true,'actual source document append')
 const corpus=new CorpusRegistry({sidecarDir:path.join(home,'memory/index/files')}).get(buildSourceCatalog({workspaceKey:ws,workspaceMemoryPath:paths.notesPath})).snapshot,rec=corpus.records[0]
 const saved=path.join(home,'procedures.json'),procs=createProcedureStorePre({io:{load:()=>null,save:s=>fs.writeFileSync(saved,JSON.stringify(s))}}),episodic=createEpisodicStorePre()
 const hub=engine._memoryHub=createMemoryHubPre({stores:{procedures:procs,episodic}})
 const judged=hub.ingestJudgement({kindCandidate:'procedure_candidate',sourceIds:[rec.memoryId],title:'Deploy safely',excerpt:'Build, retain rollback and verify health',successCriteria:['Healthy build']});assert.equal(judged.consumed,'procedure')
 const pid=procs.query()[0].procedureId;assert.deepEqual(procs.query()[0].sourceMemoryIds,[rec.memoryId],'source identity comes from actual judgement producer')
 const host=engine._contextHost=createContextHost({engine}),store=new EvidenceEventStore({root:path.join(home,'memory/evidence')})
 for(const a of Object.values(agents)){host.capturePaths(engine.runtimeFor(a).key,{ws,userDir:paths.userDir,notesPath:paths.notesPath})}
 const pending=[],append=host.appendEvidence;host.appendEvidence=list=>{const p=append(list);pending.push(p);return p}
 const drain=async()=>{await Promise.all(pending);await spin();await flushDiagnostics()}
 const makeRead=(sid,seq=1,workspace=ws)=>{const r=createAccessEvidencePre({...rec,kind:'read',workspaceKey:canonicalize(workspace),sessionId:sid,eventSeq:seq,nativeSeq:seq,contextVersion:1,ts:Date.now()});assert(r.ok,r.reason);return r.evidence}
 const procedure=()=>procs.query().find(p=>p.procedureId===pid)
 const consolidate=async(sid,turn)=>{
  const rt=engine.runtimeFor(agents[sid]);rt.lastConsolidateAt=0
  // Model boundary only: real consolidateTurn gating, episodic append, source selection and event persistence run.
  engine.runSubagent=async()=>'(无)'
  await engine.withAgent(agents[sid],()=>engine.consolidateTurn(turn,agents[sid]));await drain()
 }
 try{
  if(scenario==='session-feed'){
   engine.ingestEnvelope(engine.runtimeFor(agents.B),{channel:'session',eventType:'user/message',sourceKind:'user',payload:{text:'Unrelated B'},segment:{kind:'user',text:'Unrelated B'}})
   await host.appendEvidence([makeRead('A'),makeRead('C')]);await drain()
   const sessions=JSON.parse(fs.readFileSync(saved)).procedures[0]._sessions
   assert.deepEqual(new Set(sessions),new Set([sessionRefOf('A'),sessionRefOf('C')]),'each event owns its hashed session; latest segment B cannot substitute')
  }else if(scenario==='duplicate-feed'){
   const read=makeRead('A');await host.appendEvidence(read);await host.appendEvidence(read);await host.appendEvidence({...read,evidenceId:'invalid',memoryId:'broken'});await drain()
   assert.equal(procedure().evidence.read,1,'only newly durable valid evidence feeds counters');assert.equal(procedure().evidence.sessions,1)
  }else{
   await host.appendEvidence(makeRead('A',1,scenario==='wrong-workspace'?path.join(home,'different-workspace'):ws));await drain()
   if(scenario==='unrelated-turn'){
    await consolidate('B',1);await consolidate('C',1);assert.equal(engine._autoCallCount,2,'normal substantive consolidation ran')
    assert.equal(procedure().evidence.success,0,'B/C cannot award success for A read');assert.equal(procedure().evidence.sessions,1)
   }else if(scenario==='wrong-workspace'){
    await consolidate('A',1);assert.equal(procedure().evidence.success,0,'same session with different workspace is ineligible')
   }else{
    await consolidate('A',1);await consolidate('A',2)
    const restarted=engine._contextHost=createContextHost({engine});restarted.capturePaths(engine.runtimeFor(agents.A).key,{ws,userDir:paths.userDir,notesPath:paths.notesPath})
    try { await consolidate('A',3) } finally { restarted.disposeAll('test') }
    const success=store.loadEvents().events.filter(e=>e.kind==='success')
    assert.equal(success.length,1,'one durable success from one source read despite repeat consolidation');assert.equal(procedure().evidence.success,1,'counter and durable ledger agree')
    assert.equal(success[0].event.sessionRef,sessionRefOf('A'));assert.equal(success[0].workspaceRef,workspaceRefOf(canonicalize(ws)))
    assert.equal(success[0].source.recordDigest,rec.recordDigest);assert.equal(procedure().evidence.sessions,1)
   }
  }
  console.log('PASS '+scenario);pass++
 }catch(e){console.error('FAIL '+scenario+' '+e.stack);fail++}finally{await drain();host.disposeAll('test')}
}}finally{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(base,{recursive:true,force:true})}
console.log('PASS '+pass+' / FAIL '+fail);process.exitCode=fail?1:0
