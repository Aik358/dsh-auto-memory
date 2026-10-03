import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {MemoryEngine,flushDiagnostics} from '../lib/audit-engine.mjs'
import {createContextHost} from '../../lib/context-host.js'
import {createActivationHost} from '../../lib/activation-host.js'
import {createProcedureStorePre} from '../../lib/procedure-store.js'
const base=await mkdtemp(path.join(os.tmpdir(),'dam-context-generation-')),previous=process.env.DSH_HOME
const spin=async()=>{for(let i=0;i<50;i++)await Promise.resolve()}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
let pass=0,fail=0
try{for(const scenario of ['rank-order','decide-order','skill-await','same-generation']){
 const home=path.join(base,scenario);await mkdir(home);process.env.DSH_HOME=home
 const engine=new MemoryEngine();engine.configLoaded=true
 Object.assign(engine.config,{memoryRoot:path.join(home,'memory'),userMemoryDir:path.join(home,'user'),memoryAnchorEnabled:true,memoryHubEnabled:true,procedureInjectEnabled:true,associativeMemoryEnabled:true,contextBridgeEnabled:true,contextSinkMode:'fake',pythonBackendEnabled:false,activationInboxEnabled:true,activationSource:'js',jsDecideCooldownRounds:1})
 const ws=path.join(home,'ws'),agent={id:'local-agent',session:{id:'A',header:{cwd:ws}}},runtime=engine.runtimeFor(agent),paths={ws,userDir:engine.userDirOf(),notesPath:path.join(engine.projectDirOf(ws),'MEMORY.md')}
 await engine.docStore.append(paths.notesPath,'## deployment\nDeploy project using pnpm build and retain rollback artifacts.')
 const procs=createProcedureStorePre({workspaceRef:engine.wsKey(ws)}),proc=procs.observe({title:'Deploy',steps:['pnpm build'],scope:'workspace',workspaceRef:engine.wsKey(ws)}).procedure
 const snapshot=procs.snapshot();snapshot.procedures[0].stage='active';procs.restore(snapshot);engine._memoryHub={stores:{procedures:procs}}
 const host=engine._contextHost=createContextHost({engine}),activation=engine._activationHost=createActivationHost({engine})
 host.capturePaths(runtime.key,paths);activation.capturePaths(runtime.key,paths)
 const offered=[],ranked=[],decided=[],waitRank=[],waitDecide=[],skill=deferred();const offer=activation.offerExternalActivation
 activation.offerExternalActivation=act=>{const result=offer(act);offered.push({act,result});return result}
 engine.jsEmitMode=()=> 'emit'
 engine._jsSemanticRank=(corpus,query)=>{
  const scores=new Map(corpus.records.map(r=>[r.memoryId,.95])),isSkill=corpus.records[0]?.memoryId===proc.procedureId
  ranked.push({query,isSkill});if(isSkill&&scenario==='skill-await')return skill.promise.then(()=>({scores}))
  if(!isSkill&&scenario==='rank-order'){const d=deferred();waitRank.push(()=>d.resolve({scores}));return d.promise}
  return Promise.resolve({scores})
 }
 engine._jsDecide=(query,rank,frame)=>{
  decided.push({query,frame});const value={ok:true,decision:'emit',features:{intentProb:.95}}
  if(scenario==='decide-order'){const d=deferred();waitDecide.push(()=>d.resolve(value));return d.promise}
  return Promise.resolve(value)
 }
 const ingest=text=>engine.ingestEnvelope(runtime,{channel:'session',eventType:'user/message',sourceKind:'user',payload:{text},nativeSeq:runtime.eventCursor+1,segment:{kind:'user',text}})
 try{
  ingest('Deploy request A')
  if(scenario==='rank-order'){
   // No microtask between accepted segments: rank A must still receive A's captured query.
   ingest('Unrelated request B');await spin();assert.equal(waitRank.length,2)
   waitRank[1]();await spin();waitRank[0]();await spin()
   assert(!ranked[0].query.includes('Unrelated request B'),'A query is captured before the deferred rank')
   assert.equal(decided.length,1,'stale rank cannot build/push/decide an upgraded frame')
   assert.equal(decided[0].frame.cursor.contextVersion,2)
   assert.equal(decided[0].frame.trigger.contextVersion,2)
   assert.equal(offered.length,1);assert.equal(offered[0].act.contextVersion,2)
  }else if(scenario==='decide-order'){
   await spin();assert.equal(waitDecide.length,1);ingest('Unrelated request B');await spin();assert.equal(waitDecide.length,2)
   waitDecide[0]();await spin();assert.equal(offered.length,0,'stale decide cannot offer or consume cooldown')
   waitDecide[1]();await spin();assert.equal(offered.length,1);assert.equal(offered[0].act.contextVersion,2)
  }else if(scenario==='skill-await'){
   await spin();assert(ranked.some(r=>r.isSkill));ingest('Unrelated request B');await spin()
   assert.equal(decided.length,2,'stale pending skill cannot consume cooldown for current B')
   skill.resolve();await spin();assert.equal(offered.length,1,'stale result after second skill await must drop');assert.equal(offered[0].act.contextVersion,2)
  }else{
   await spin();assert.equal(offered.length,1);assert.equal(offered[0].result.ok,true,JSON.stringify(offered[0].result))
   // Ordinary eager pump remains usable after a later segment, until naturally composed.
   ingest('Subsequent segment');await spin();const text=activation.renderTailFor(agent);assert(text.length>0,'same-generation eager claimed packet remains renderable')
   await spin();assert.equal(activation.debugView().stats.delivered,1)
  }
  console.log('PASS '+scenario);pass++
 }catch(e){console.error('FAIL '+scenario+' '+e.stack);fail++}finally{skill.resolve();for(const f of waitRank)f();for(const f of waitDecide)f();await spin();host.disposeAll('test');activation.disposeAll('test');await flushDiagnostics()}
}}finally{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;await rm(base,{recursive:true,force:true})}
console.log('PASS '+pass+' / FAIL '+fail);process.exitCode=fail?1:0
