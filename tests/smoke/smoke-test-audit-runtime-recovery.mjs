import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'
import { MemoryDocumentStore } from '../../lib/memory-writer.js'
import { CorpusRegistry, buildSourceCatalog, loadCorpusSnapshot } from '../../lib/m4-corpus.js'
import { createStorageManagerPre } from '../../lib/storage-manage.js'
const root = await fs.mkdtemp(path.join(os.tmpdir(),'dsh-audit-oct7-'))
Object.assign(process.env,{DSH_HOME:root,HOME:root,USERPROFILE:root})
const {MemoryEngine} = await loadIsolatedEngine(root)
const results = []
try {
  // Actual engine entry + actual asynchronous generation lookup; no provider call.
  for (const [label,pauseAt] of [['smart-kw',1],['consolidate',1],['consolidate',2]]) {
    const engine = new MemoryEngine()
    engine._workbenchReady = true
    engine._workbenchParent = {session:{id:'fixture'},ctx:{get:()=>null}}
    let enter, release, reads = 0, starts = 0
    const barrier = new Promise(resolve => { release=resolve })
    const entered = new Promise(resolve => { enter=resolve })
    engine._readWorkbench = async () => {
      if(++reads===pauseAt) { enter(); await barrier }
      return {sessionId:'fixture',epoch:engine._workbenchEpoch(Date.now()),gen:{}}
    }
    engine.wbOwnerOf = () => 'current'
    engine._wbTokenOf = () => ''
    engine.bumpGenFor = async () => ({ok:true})
    engine._subagents = {list:()=>['spawn'],start:async () => {
      starts++; return {result:Promise.resolve({output:[{type:'text',text:'synthetic output'}]})}
    }}
    const pending = engine.runSubagent('synthetic audit prompt',label,undefined,1000)
    await entered; engine._disposed=true; release()
    const value = await pending
    assert.equal(starts,0);assert.equal(engine._subagentInflight || 0,0);assert.equal(Object.keys(engine._subagentPromptFlight).length,0)
    assert.equal(value,'')
    results.push({case:'start-after-dispose',label,starts,value,disposed:engine._disposed})
  }
  // Repair is the actual manager and writer, using real files and a live registry.
  const notes = path.join(root,'notes','MEMORY.md'), sidecarDir=path.join(root,'index')
  await fs.mkdir(path.dirname(notes),{recursive:true})
  await fs.writeFile(notes,'<!-- memory:mem_'+'1'.repeat(32)+' -->\n## fixture\nfixture decision\n')
  const catalog=buildSourceCatalog({workspaceKey:root,workspaceMemoryPath:notes})
  const registry=new CorpusRegistry({sidecarDir})
  const first=registry.get(catalog)
  const docStore=new MemoryDocumentStore({sidecarDir})
  const manager=createStorageManagerPre({docStore,io:{sidecarDir},pathsOf:()=>({workspaceKey:root,workspaceMemoryPath:notes})})
  const repaired=await manager.repair([{file:notes}])
  const second=registry.get(catalog), fresh=loadCorpusSnapshot(catalog,{sidecarDir})
  assert.equal(first.snapshot.records.length,0)
  assert.equal(repaired.repaired,1)
  assert.equal(second.fromCache,false)
  assert.equal(second.snapshot.records.length,1)
  assert.equal(fresh.snapshot.records.length,1)
  results.push({case:'repair-cache',repair:repaired.repaired,cached:second.snapshot.records.length,fresh:fresh.snapshot.records.length,fromCache:second.fromCache})
  const afterRemoval = new CorpusRegistry({sidecarDir})
  afterRemoval.get(catalog)
  const removed=afterRemoval.get({...catalog,sources:[]})
  assert.equal(removed.snapshot.records.length,0);assert.equal(removed.fromCache,false)
  results.push({case:'removed-source-cache',requested:0,actual:removed.snapshot.records.length})
  console.log('PASS runtime: no provider start after disposal; actual sidecar repair and source removal reload')
  console.log(JSON.stringify(results,null,2))
} finally { await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:40}) }
