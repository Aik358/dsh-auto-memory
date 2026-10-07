import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createContextHost } from '../../lib/context-host.js'
import { createActivationHost } from '../../lib/activation-host.js'
import { canonicalize } from '../../lib/m4-corpus.js'
import { buildSidecar } from '../../lib/memory-anchor.js'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-audit-skill-'))
Object.assign(process.env, { HOME: root, USERPROFILE: root, DSH_HOME: root })
const { MemoryEngine } = await loadIsolatedEngine(root)
const owner = new MemoryEngine().wsKey(root)
const settle = async () => { for(let i=0;i<30;i++) await new Promise(r=>setImmediate(r)) }
try {
  const notes = path.join(root,'MEMORY.md'), mid='mem_'+'1'.repeat(32)
  const content='<!-- memory:'+mid+' -->\n## alpha\nalpha fixture text\n'
  await fs.writeFile(notes,content)
  const side=buildSidecar({sourceFile:notes,content}); assert(side.ok)
  const sideDir=path.join(root,'memory/index/files'); await fs.mkdir(sideDir,{recursive:true})
  await fs.writeFile(path.join(sideDir,createHash('sha256').update(canonicalize(notes)).digest('hex')+'.json'),JSON.stringify(side.sidecar))
  const store=createProcedureStorePre({workspaceRef:owner})
  const observed=store.observe({title:'alpha skill',steps:['fixture checklist'],successCriteria:['fixture success'],origin:'user',scope:'workspace',workspaceRef:owner,sourceMemoryIds:[mid]})
  assert(observed.ok)
  const snap=store.snapshot(); snap.procedures[0].stage='active'; assert(store.restore(snap).ok)
  assert.equal(store.query().length,1)
  let queryRef=null, actives=null, offer=null
  const procedures={activeProcedures(q){queryRef=q.workspaceRef; const a=store.activeProcedures(q);actives=a.length;return a},renderChecklist:store.renderChecklist,touch:store.touch}
  const segment={id:'seg-fixture',digest:'d'.repeat(64),kind:'user',text:'alpha',eventSeq:1,contextVersion:1,ts:Date.now()}
  const runtime={key:'session:fixture',sessionId:'fixture',agentId:'agent-fixture',contextVersion:1,disposed:false,segments:{snapshot:()=>[segment]},agent:{session:{header:{}}}}
  const engine={wsKey:ws=>new MemoryEngine().wsKey(ws),__dshHomeOverride:root,config:{associativeMemoryEnabled:true,contextBridgeEnabled:true,pythonBackendEnabled:false,contextSinkMode:'null',activationInboxEnabled:true,memoryHubEnabled:true},runtimes:{values:()=>[runtime]},_memoryHub:{stores:{procedures}},_jsSemanticRank:async snapshot=>({scores:new Map(snapshot.records.map(r=>[r.memoryId,0.99]))}),_jsDecide:async()=>({ok:true,decision:'emit',lane:'fixture',reasonCodes:[],features:{intentProb:1}}),jsEmitMode:()=> 'active',_activationHost:{offerExternalActivation(act){offer=act;return {ok:true}}}}
  const host=createContextHost({engine}); host.capturePaths(runtime.key,{ws:root,notesPath:notes})
  host.onSegmentAccepted(runtime,segment,{payload:{}}); await settle()
  try {
    assert(offer, 'actual context must offer a live recall')
    assert.equal(actives,1);assert(offer.skill);assert.equal(queryRef,owner)
    engine.config.activationSource='js'
    const activation=createActivationHost({engine})
    try {
      activation.capturePaths(runtime.key,{ws:root,notesPath:notes})
      const request={...offer,skill:undefined}
      activation.offerExternalActivation(request)
      assert(request.skill,'candidate-based activation host must attach the same workspace skill')
      assert.equal(queryRef,owner)
      const other={...runtime,key:'session:other',sessionId:'other'}
      engine.runtimes.values=()=>[runtime,other]
      const otherRoot=path.join(root,'other-workspace')
      activation.capturePaths(other.key,{ws:otherRoot,notesPath:notes})
      const foreign={...offer,sessionId:other.sessionId,workspaceKey:canonicalize(otherRoot),skill:undefined}
      activation.offerExternalActivation(foreign)
      assert.equal(foreign.skill,undefined,'another workspace cannot attach the first workspace skill')
    } finally { activation.disposeAll('test-end') }
    console.log('PASS context host: actual workspace procedure owner resolves and skill is offered')
    console.log(JSON.stringify({case:'workspace-skill-scope',owner,queryRef,panelCount:store.query().length,explicitCount:actives,offeredRecall:true,offeredSkill:!!offer.skill},null,2))
  } finally { host.disposeAll('audit-end');store.dispose() }
} finally { await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:40}) }
