import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MemoryEngine } from '../lib/audit-engine.mjs'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { createContextHost } from '../../lib/context-host.js'
import { createActivationHost } from '../../lib/activation-host.js'
import { makeFakeActivationRequestPre } from '../../lib/activation-inbox.js'
import { CorpusRegistry, buildSourceCatalog, canonicalize } from '../../lib/m4-corpus.js'
const root=await mkdtemp(path.join(os.tmpdir(),'dam-procedure-host-'))
const previous=process.env.DSH_HOME;process.env.DSH_HOME=root
let host,activation
try {
 const engine=new MemoryEngine();engine.configLoaded=true
 const ws=path.join(root,'CaseSensitive','Project'),agent={session:{id:'skill-session',header:{cwd:ws}}}
 Object.assign(engine.config,{memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),memoryAnchorEnabled:true,memoryHubEnabled:true,procedureInjectEnabled:true,associativeMemoryEnabled:true,contextBridgeEnabled:true,contextSinkMode:'null',jsDecideCooldownRounds:0,activationInboxEnabled:true,activationSource:'js'})
 engine.state.ws=ws
 const paths={ws,userDir:engine.userDirOf(),notesPath:path.join(engine.projectDirOf(ws),'MEMORY.md')}
 await engine.docStore.append(paths.notesPath,'## 部署\n如何部署项目：使用 pnpm build 之后检查输出。')
 const corpus=new CorpusRegistry({sidecarDir:path.join(root,'memory/index/files')}).get(buildSourceCatalog({workspaceKey:ws,workspaceMemoryPath:paths.notesPath})).snapshot
 assert.ok(corpus.records.length)
 const store=createProcedureStorePre({get workspaceRef(){return engine.wsKey(engine.state.ws)}})
 const procedure=store.observe({title:'部署技能',triggerPattern:'部署',steps:['pnpm build'],successCriteria:['构建成功'],scope:'workspace',workspaceRef:engine.wsKey(ws),sourceMemoryIds:[corpus.records[0].memoryId]}).procedure
 const snapshot=store.snapshot();snapshot.procedures[0].stage='active';store.restore(snapshot)
 engine._memoryHub={stores:{procedures:store}}
 let offered
 engine._activationHost={offerExternalActivation:r=>{offered=r}}
 // Deterministic local rank/decision isolate model and network side effects.
 engine._jsSemanticRank=async c=>({scores:new Map(c.records.map(r=>[r.memoryId,.95]))})
 engine._jsDecide=async()=>({ok:true,decision:'emit',features:{intentProb:.95}})
 engine.jsEmitMode=()=> 'emit'
 const runtime=engine.runtimeFor(agent);runtime.contextVersion=1
 host=createContextHost({engine});host.capturePaths(runtime.key,paths)
 host.onSegmentAccepted(runtime,{id:'seg_skill',digest:'a'.repeat(32),kind:'user',eventSeq:1,nativeSeq:1,contextVersion:1,ts:Date.now(),text:'如何部署项目？'},{payload:{}})
 for(let n=0;n<50&&!offered;n++)await new Promise(r=>setTimeout(r,10))
 assert.equal(offered?.skill?.procedureId,procedure.procedureId,'JS production host must preserve POSIX case in procedure scope identity')
 activation=createActivationHost({engine});activation.capturePaths(runtime.key,paths)
 const request=makeFakeActivationRequestPre({sessionId:agent.session.id,agentId:runtime.agentId||'local-agent',workspaceKey:canonicalize(ws),contextVersion:1,memoryIndexVersion:corpus.memoryIndexVersion,records:corpus.records,now:Date.now(),seed:'scope-case',ttlSteps:10})
 const result=activation.offerExternalActivation(request)
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(request.skill?.procedureId,procedure.procedureId,'Python candidate consumer must match the same real workspace key')
 console.log('PASS F04 actual JS/Python host consumers: case-sensitive POSIX workspace skill remains eligible')
} finally {host?.disposeAll('test');activation?.disposeAll('test');await rm(root,{recursive:true,force:true});if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous}
