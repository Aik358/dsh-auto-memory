import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {syncBuiltinESMExports} from 'node:module'
import {EvidenceEventStore} from '../../lib/evidence-store.js'
import {createAccessEvidencePre} from '../../lib/context-bridge.js'
import {createContextHost} from '../../lib/context-host.js'
import {createProcedureStorePre} from '../../lib/procedure-store.js'
const root=await fsp.mkdtemp(path.join(os.tmpdir(),'dam-evidence-read-')),old=process.env.DSH_HOME
let pass=0,fail=0
try{for(const mode of ['directory','file','partial','corrupt']){
 const home=path.join(root,mode);await fsp.mkdir(home);process.env.DSH_HOME=home
 const mid='mem_'+'a'.repeat(32),procs=createProcedureStorePre(),pid=procs.observe({title:'Build',steps:['Build'],sourceMemoryIds:[mid]}).procedure.procedureId
 const engine={config:{memoryHubEnabled:true,associativeMemoryEnabled:true,contextBridgeEnabled:true},_memoryHub:{stores:{procedures:procs}}}
 const ev=createAccessEvidencePre({kind:'read',memoryId:mid,anchorId:'anc_'+'a'.repeat(32),scope:'Workspace',workspaceKey:path.join(home,'ws'),sessionId:'A',eventSeq:1,nativeSeq:1,contextVersion:1,ts:Date.now(),sourceRef:'workspace:MEMORY.md',sourceEpoch:'src_'+'a'.repeat(32),sourceVersion:1,fileDigest:'a'.repeat(64),recordDigest:'b'.repeat(64)});assert(ev.ok,ev.reason)
 const first=createContextHost({engine});await first.appendEvidence(ev.evidence);first.disposeAll('test')
 // Genuine procedure snapshot reload, with a new context/evidence store cache.
 const restored=createProcedureStorePre();assert(restored.restore(JSON.parse(JSON.stringify(procs.snapshot()))).ok);engine._memoryHub.stores.procedures=restored
 const host=createContextHost({engine}),eventsDir=path.join(home,'memory/evidence/events'),file=path.join(eventsDir,(await fsp.readdir(eventsDir))[0]),before=await fsp.readFile(file,'utf8')
 if(mode==='partial')await fsp.writeFile(path.join(eventsDir,'0000-prefix.jsonl'),before)
 if(mode==='corrupt')await fsp.writeFile(file,before.trim().slice(0,-1)+'\n')
 const preservedBytes=await fsp.readFile(file,'utf8')
 const read=fs.readFileSync,readdir=fs.readdirSync
 try{
  fs.readFileSync=function(p,...args){if(mode!=='corrupt'&&String(p)===file){const e=Error('controlled ledger IO failure');e.code=mode==='partial'?'EIO':'EACCES';throw e}return read.call(this,p,...args)}
  fs.readdirSync=function(p,...args){if(mode==='directory'&&String(p)===eventsDir){const e=Error('controlled ledger directory failure');e.code='EACCES';throw e}return readdir.call(this,p,...args)};syncBuiltinESMExports()
  const display=new EvidenceEventStore({root:path.join(home,'memory/evidence')}).loadEvents();assert(Array.isArray(display.events),'display keeps tolerant query semantics')
  if(mode==='corrupt'){
   assert.equal(display.badLines,1)
   const strict=new EvidenceEventStore({eventsDir}).loadEvents({strict:true})
   assert.equal(strict.ok,false);assert.equal(strict.reason,'ledger-corrupt');assert.deepEqual(strict.events,[])
  }
  const r=await host.appendEvidence(ev.evidence)
  assert.equal(r?.ok,false,'unreadable dedup ledger must reject append');assert.equal(r.reason,'evidence-ledger-unreadable')
  assert.equal(restored.query()[0].evidence.read,1,'failed restart dedup does not increment existing counter')
  assert.equal(await fsp.readFile(file,'utf8'),preservedBytes,'rejection leaves durable bytes unchanged')
  if(mode==='corrupt'){
   await fsp.writeFile(file,before)
   await host.appendEvidence(ev.evidence)
   assert.equal(restored.query()[0].evidence.read,1,'repair then replay still deduplicates the original event')
   assert.equal(await fsp.readFile(file,'utf8'),before)
  }
  console.log('PASS '+mode+' read failure');pass++
 }catch(e){console.error('FAIL '+mode+' '+e.stack);fail++}finally{fs.readFileSync=read;fs.readdirSync=readdir;syncBuiltinESMExports();host.disposeAll('test')}
}}finally{if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;await fsp.rm(root,{recursive:true,force:true})}
console.log('PASS '+pass+' / FAIL '+fail);process.exitCode=fail?1:0
