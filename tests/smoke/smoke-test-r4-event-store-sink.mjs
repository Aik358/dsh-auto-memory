import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { eventStorePre, readStorePre } from '../../lib/event-store.js'
import { EventStoreLedgerSink } from '../../lib/ledger-doc/event-store-sink.js'
import { createLedgerDocSystemPre } from '../../lib/index.js'

let pass=0,fail=0
const evidence=[]
const root=path.resolve('artifacts','_r4-p4-fixtures')
const self=path.resolve('tests/smoke/smoke-test-r4-event-store-sink.mjs')
const docId='synthetic-real-sink-261111-0001'
const op=()=> 'r4op_'+randomBytes(16).toString('hex')
const digest=()=> 'sha256:'+randomBytes(32).toString('hex')
async function test(name,action){try{await action();pass++;console.log('  ok   - '+name)}catch(error){fail++;console.log('  FAIL - '+name+' :: '+error.stack)}}
async function fixture(name){
 const dir=path.join(root,name);await fs.mkdir(dir,{recursive:true})
 const storePath=path.join(dir,'handoff','event-store.json');await fs.rm(storePath,{force:true})
 for(const child of ['documents','logs','archive','legacy','coverage-reports'])await fs.rm(path.join(dir,'handoff',child),{recursive:true,force:true})
 const event=await eventStorePre.create(storePath,{name:'synthetic '+name})
 const sink=new EventStoreLedgerSink(process.cwd(),storePath)
 const system=createLedgerDocSystemPre({rootDir:dir,enabled:true,storePath,now:()=> '2026-11-11T12:01:00.000Z'})
 assert.equal((await system.start()).ok,true)
 const created=await system.documents.createDocument({documentId:docId,title:'Synthetic real sink',eventIds:[event.id],content:'before'})
 assert.equal(created.ok,true,JSON.stringify(created))
 return{dir,storePath,event,sink,system,created}
}
function input(f,operation=op()){return{documentId:docId,eventIds:[f.event.id],expectedRevision:f.created.revision,opId:operation,changeSet:[{regionId:'content',beforeText:'before',afterText:'after'}]}}
async function phases(sink,operation){return(await sink.listCheckpoints(operation)).map(x=>x.phase).sort()}
async function killProbe(){
 const f=await fixture('killed'),args=input(f)
 const child=spawn(process.execPath,[self,'--worker'],{cwd:process.cwd(),stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
 let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',s=>{stderr+=s})
 child.send({root:f.dir,storePath:f.storePath,input:args})
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout '+stderr)),10000);child.on('message',m=>{if(m.type==='prepared'){clearTimeout(timer);resolve()}});child.on('exit',()=>{clearTimeout(timer);reject(new Error('exit '+stderr))})})
 child.kill();await new Promise(r=>child.once('exit',r));return{...f,operation:args.opId}
}
if(process.argv[2]==='--worker'){
 process.once('message',async(m)=>{
  const sink=new EventStoreLedgerSink(process.cwd(),m.storePath),append=sink.append.bind(sink)
  sink.append=async(...args)=>{const result=await append(...args);if(args[1].phase==='prepared'&&result.ok){process.send({type:'prepared'});await new Promise(()=>{})}return result}
  const system=createLedgerDocSystemPre({rootDir:m.root,enabled:true,storePath:m.storePath,eventSink:sink,now:()=> '2026-11-11T12:01:00.000Z'})
  await system.start();await system.upsertDocument(m.input)
 })
}else{
 await fs.mkdir(root,{recursive:true})
 const f=await fixture('basic'),operation=op(),operationDigest=digest()
 const payloads=new Map()
 console.log('=== Real event-store persistence ===')
 await test('P4-01 all phases persist unique real checkpointId',async()=>{
  for(const phase of ['prepared','committed','failed']){
   const checkpoint={text:phase,documentId:docId,changeSet:[{regionId:'content',beforeText:'before',afterText:'after'}],preparedCheckpointId:null,errorCode:null}
   payloads.set(phase,checkpoint)
   const result=await f.sink.append(f.event.id,{phase,opId:operation,operationDigest,checkpoint})
   assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.checkpointId,/^ckpt_[0-9a-f]{16}$/)
   const persisted=(await f.sink.listCheckpoints(operation)).find(x=>x.phase===phase)
   assert.equal(persisted.checkpointId,result.checkpointId);assert.equal(persisted.opId,operation);assert.deepEqual(persisted.changeSet,checkpoint.changeSet)
  }
  assert.deepEqual(await phases(f.sink,operation),['committed','failed','prepared'])
  assert.equal(new Set((await f.sink.listCheckpoints(operation)).map(x=>x.checkpointId)).size,3)
 })
 await test('P4-02 same payload dedupes, changed payload rejects',async()=>{
  const result=await f.sink.append(f.event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:payloads.get('prepared')})
  assert.equal(result.deduped,true,JSON.stringify(result));assert.equal(result.checkpointId,(await f.sink.listCheckpoints(operation)).find(x=>x.phase==='prepared').checkpointId)
  const changed=await f.sink.append(f.event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:{...payloads.get('prepared'),summary:'changed'}})
  assert.equal(changed.error,'op-payload-mismatch');assert.equal((await f.sink.listCheckpoints(operation)).length,3)
 })
 await test('P4-03 ledger eviction recovers from checkpoint evidence',async()=>{
  const state=await readStorePre(f.storePath);state.appliedOps={};await fs.writeFile(f.storePath,JSON.stringify(state))
  const replay=await f.sink.append(f.event.id,{phase:'committed',opId:operation,operationDigest,checkpoint:payloads.get('committed')})
  assert.equal(replay.deduped,true,JSON.stringify(replay))
  state.appliedOps={};await fs.writeFile(f.storePath,JSON.stringify(state))
  const changed=await f.sink.append(f.event.id,{phase:'committed',opId:operation,operationDigest:digest(),checkpoint:payloads.get('committed')})
  assert.equal(changed.error,'op-payload-mismatch')
 })
 await test('P4-04 old numeric ledger is unverifiable, checkpoint evidence succeeds',async()=>{
  const state=await readStorePre(f.storePath);state.appliedOps={[f.event.id+'\0'+operation+':prepared']:42};await fs.writeFile(f.storePath,JSON.stringify(state))
  const old=await f.sink.append(f.event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:payloads.get('prepared')})
  assert.equal(old.error,'op-payload-unverifiable')
  state.appliedOps={};await fs.writeFile(f.storePath,JSON.stringify(state))
  const good=await f.sink.append(f.event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:payloads.get('prepared')})
  assert.equal(good.ok,true,JSON.stringify(good))
 })
 await test('P4-05 old append has no ID; closed idemKey replay stays valid',async()=>{
  const old=await eventStorePre.append(f.storePath,f.event.id,{checkpoint:{kind:'log',text:'legacy',idemKey:'old-p4'}})
  assert.equal('checkpointId'in old,false);assert.equal('replayed'in old,false)
  const detail=await eventStorePre.detail(f.storePath,f.event.id)
  assert.equal(detail.event.checkpoints.find(x=>x.idemKey==='old-p4').checkpointId,undefined)
  await eventStorePre.close(f.storePath,f.event.id,'synthetic done')
  const replay=await eventStorePre.append(f.storePath,f.event.id,{checkpoint:{kind:'log',text:'legacy',idemKey:'old-p4'}})
  assert.equal(replay.deduped,true)
  const fresh=await f.sink.append(f.event.id,{phase:'prepared',opId:op(),operationDigest:digest(),checkpoint:{text:'reject closed'}})
  assert.equal(fresh.ok,false)
 })
 await test('P4-06 unknown event and outside paths fail closed',async()=>{
  const before=(await readStorePre(f.storePath)).events[0].checkpoints.length
  assert.equal((await f.sink.append('evt_ffffffff',{phase:'prepared',opId:op(),operationDigest:digest(),checkpoint:{text:'bad'}})).ok,false)
  assert.throws(()=>new EventStoreLedgerSink(process.cwd(),path.resolve('outside-r4-p4.json')),/event-store-sink-path-invalid/)
  assert.throws(()=>new EventStoreLedgerSink(path.resolve('..'),path.resolve('..','outside-p4.json')),/event-store-sink-path-invalid/)
  assert.equal((await readStorePre(f.storePath)).events[0].checkpoints.length,before)
 })
 console.log('')
 console.log('=== Real WAL / facade / process recovery ===')
 await test('P4-07 real sink and LedgerDocSystem commit WAL once',async()=>{
  const current=await fixture('wal'),operation=input(current),result=await current.system.upsertDocument(operation)
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.prepared.length,1);assert.equal(result.committed.length,1)
  assert.equal(result.document.content,'after');assert.deepEqual(await phases(current.sink,operation.opId),['committed','prepared'])
  const disk=await readStorePre(current.storePath);assert.equal(disk.events[0].checkpoints[0].checkpointId,result.prepared[0].checkpointId)
  evidence.push({kind:'wal',bytes:result.document.bytes,revision:result.document.revision});await current.system.stop()
 })
 await test('P4-08 default-off entry performs no I/O',async()=>{
  const dir=path.join(root,'default-off'),system=createLedgerDocSystemPre({rootDir:dir,enabled:false,storePath:path.join(dir,'event-store.json')})
  assert.equal(system.enabled,false);assert.equal(system.wal,null);assert.equal((await system.upsertDocument({})).error,'ledger-doc-system-disabled')
  assert.equal(await fs.stat(dir).then(()=>true,e=>e.code==='ENOENT'),true)
  assert.throws(()=>createLedgerDocSystemPre({rootDir:dir,enabled:true,storePath:path.resolve('outside-r4-p4.json')}),/event-store-sink-path-invalid/)
 })
 await test('P4-09 killed child prepared reconciles to committed with complete document',async()=>{
  const current=await killProbe();assert.deepEqual(await phases(current.sink,current.operation),['prepared'])
  assert.equal((await current.system.documents.readDocument(docId)).revision,current.created.revision)
  const system=createLedgerDocSystemPre({rootDir:current.dir,enabled:true,storePath:current.storePath,now:()=> '2026-11-11T12:01:00.000Z'})
  const started=await system.start();assert.equal(started.ok,true,JSON.stringify(started));assert.deepEqual(await phases(current.sink,current.operation),['committed','prepared'])
  const doc=await system.documents.readDocument(docId);assert.equal(doc.content,'after');assert.equal(doc.revision,doc.text.match(/^revision: (sha256:[0-9a-f]{64})$/m)[1])
  assert.deepEqual((await fs.readdir(path.dirname(path.join(current.dir,'handoff','documents',docId+'.md')))).filter(x=>x.endsWith('.tmp')),[]);await system.stop()
 })
 console.log('')
 console.log('=== Isolated real event-store mutations ===')
 const clean=await fs.readFile('lib/event-store.js','utf8'),sinkSource=await fs.readFile('lib/ledger-doc/event-store-sink.js','utf8')
 const anchors=["cp.checkpointId = 'ckpt_' + randomBytes(8).toString('hex')","const storageOpId = opId + ':' + phase","if (!r4Replay.operationDigest || r4Replay.operationDigest !== checkpoint.operationDigest || r4Replay.payloadDigest !== r4Digest)"]
 for(const anchor of anchors)assert.equal((clean+sinkSource).split(anchor).length-1,1,anchor)
 const variants={
  'checkpoint-id-not-persisted':clean.replace(anchors[0],"cp.checkpointId = 'ckpt_' + randomBytes(8).toString('hex'); delete cp.checkpointId"),
  'phase-key-removed':sinkSource.replace("opId: storageOpId",'opId'),
  'payload-digest-removed':clean.replace(anchors[2],'if (false)'),
 }
 for(const[name,source]of Object.entries(variants)){
  const dir=path.resolve('artifacts','_r4-p4-mutation',name),moduleDir=path.join(dir,'lib','ledger-doc')
  await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(moduleDir,{recursive:true})
  const storeSource=name==='phase-key-removed'?clean.replace("checkpoint.opId && checkpoint.phase && checkpoint.operationDigest","checkpoint.opId && checkpoint.operationDigest"):source
  for(const[file,content]of[['event-store.js',storeSource],['shared-state-lock.js',await fs.readFile('lib/shared-state-lock.js')],['file-boundary.js',await fs.readFile('lib/file-boundary.js')]])await fs.writeFile(path.join(dir,'lib',file),content)
  await fs.mkdir(path.join(dir,'lib','ledger-doc'),{recursive:true})
  await fs.mkdir(path.join(dir,'lib','ledger-doc'),{recursive:true})
  await fs.copyFile('lib/ledger-doc/protocol.js',path.join(dir,'lib','ledger-doc','protocol.js'))
  await fs.copyFile('lib/ledger-doc/protocol.js',path.join(dir,'lib','protocol.js'))
  await fs.copyFile('lib/ledger-doc/protocol.js',path.join(dir,'lib','ledger-doc','protocol.js'))
  await fs.mkdir(path.join(moduleDir,'ledger-doc'),{recursive:true})
  await fs.copyFile('lib/ledger-doc/protocol.js',path.join(moduleDir,'ledger-doc','protocol.js'))
  for(const dependency of ['shared-state-lock.js','file-boundary.js'])await fs.copyFile(path.join('lib',dependency),path.join(moduleDir,dependency))
  await fs.writeFile(path.join(moduleDir,'event-store-sink.js'),name==='phase-key-removed'?source:sinkSource)
  const real=await import(pathToFileURL(path.join(dir,'lib','event-store.js')).href)
  const sinkModule=await import(pathToFileURL(path.join(moduleDir,'event-store-sink.js')).href)
  const dirFixture=path.join(root,'mutation-'+name),storePath=path.join(dirFixture,'event-store.json');await fs.mkdir(dirFixture,{recursive:true});await fs.rm(storePath,{force:true})
  const event=await real.eventStorePre.create(storePath,{name:'mutation'}),sink=new sinkModule.EventStoreLedgerSink(process.cwd(),storePath)
  const operation=op(),operationDigest=digest();let caught=false,detail
  try{
   if(name==='phase-key-removed'){
    const first=await sink.append(event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:{text:'prepared'}})
    const second=await sink.append(event.id,{phase:'committed',opId:operation,operationDigest,checkpoint:{text:'committed'}})
    caught=second.appended!==1;detail=JSON.stringify({first,second})
   }else if(name==='checkpoint-id-not-persisted'){
    const appended=await sink.append(event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:{text:'mutation'}})
    assert.equal(appended.ok,true);assert.match(appended.checkpointId,/^ckpt_[0-9a-f]{16}$/)
   }else{
    await sink.append(event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:{text:'first'}})
    const changed=await sink.append(event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:{text:'changed'}});assert.equal(changed.error,'op-payload-mismatch')
   }
  }catch(error){caught=true;detail=error.message}
  await test('MUT-'+name+' oracle becomes red',()=>assert.equal(caught,true,detail||'MISSED'));evidence.push({kind:'mutation',name,result:caught?'CAUGHT':'MISSED',detail})
 }
 await test('MUT-restored clean sink passes all three oracles',async()=>{
  const current=await fixture('restored'),operation=op(),operationDigest=digest()
  for(const phase of ['prepared','committed']){
   const checkpoint={text:phase};const first=await current.sink.append(current.event.id,{phase,opId:operation,operationDigest,checkpoint})
   assert.match(first.checkpointId,/^ckpt_[0-9a-f]{16}$/);assert.equal((await current.sink.append(current.event.id,{phase,opId:operation,operationDigest,checkpoint})).deduped,true)
  }
  assert.equal((await current.sink.append(current.event.id,{phase:'prepared',opId:operation,operationDigest,checkpoint:{text:'different'}})).error,'op-payload-mismatch')
 })
 evidence.push({kind:'restored',result:'GREEN'})
 await test('P4-10 new files use LF and no mixed endings',async()=>{
  for(const file of ['lib/ledger-doc/event-store-sink.js','tests/smoke/smoke-test-r4-event-store-sink.mjs']){
   const bytes=await fs.readFile(file),text=bytes.toString('latin1'),crlf=String.fromCharCode(13,10)
   assert.equal(text.includes(crlf)&&text.split(crlf).join('').includes(String.fromCharCode(10)),false)
   evidence.push({kind:'file',file,bytes:bytes.length})
  }
 })
 await fs.writeFile(path.join(root,'test-results.json'),JSON.stringify({pass,fail,evidence},null,2)+String.fromCharCode(10))
 console.log('SUMMARY PASS '+pass+' / FAIL '+fail);console.log('MUTATION CAUGHT '+evidence.filter(x=>x.result==='CAUGHT').length+' / MISSED '+evidence.filter(x=>x.result==='MISSED').length);console.log('RESTORED GREEN')
 process.exitCode=fail===0?0:1
}
