import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { MemoryEngine } from '../lib/audit-engine.mjs'
import { LedgerDocumentStore } from '../../lib/ledger-doc/document-store.js'
import { LedgerDocReadSide } from '../../lib/ledger-doc/read-side.js'
import { packBaselinePre, unpackBaselinePre, baselineChecksumPre } from '../../lib/team-baseline.js'
import { eventStorePre } from '../../lib/event-store.js'
import { writeTextAtomicPreSync } from '../../lib/config-io.js'

let pass=0,fail=0
const failures=[]
const evidence=[]
const root=path.resolve('artifacts','_r4-p4-4-fixtures')
process.env.DSH_HOME=path.join(root,'isolated-home')
await fs.rm(process.env.DSH_HOME,{recursive:true,force:true})
const ids=['synthetic-baseline-a-261111-0001','synthetic-baseline-b-261111-0002']
const eventId='evt_a1b2c3d4'
async function test(name,action){try{await action();pass++;console.log('  ok   - '+name)}catch(error){fail++;failures.push({name,error:error.message});console.log('  FAIL - '+name+' :: '+error.stack)}}
async function fixture(name,documents=true){
 const dir=path.join(root,name),handoffDir=path.join(dir,'handoff'),eventsPath=path.join(handoffDir,'event-store.json')
 await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(handoffDir,{recursive:true})
 await eventStorePre.create(eventsPath,{id:eventId,name:'Synthetic baseline'})
 if(documents){
  const store=new LedgerDocumentStore(path.join(handoffDir,'documents'),{eventsPath,now:()=> '2026-11-11T12:00:00.000Z'})
  for(const [index,id] of ids.entries()){
   const created=await store.createDocument({documentId:id,title:'Baseline '+index,eventIds:[eventId],content:'document '+index})
   assert.equal(created.ok,true,JSON.stringify(created))
  }
 }
 await fs.writeFile(path.join(handoffDir,'PLAN.md'),'# synthetic plan')
 await fs.writeFile(path.join(dir,'MEMORY.md'),'# synthetic project')
 await fs.writeFile(path.join(dir,'MEMORY.user.md'),'# synthetic user')
 const paths={handoffDir,notesPath:path.join(dir,'MEMORY.md'),userFile:path.join(dir,'MEMORY.user.md')}
 const engine=Object.create(MemoryEngine.prototype)
 Object.assign(engine,{paths,_teamIdentity:{id:'synthetic',name:'Synthetic'},_teamPaused:false,
  saveConfig:async()=>{},refreshEventStatePre:async()=>{},
  _teamOutbox:{items:[],enqueue(item){this.items.push(item);return{ok:true,updated:true,size:1}}},
 })
 return{dir,handoffDir,eventsPath,engine}
}
async function upload(f){const result=await f.engine.uploadBaselinePre({});assert.equal(result.ok,true,JSON.stringify(result));return result}
async function apply(f,options={}){
 const item=f.engine._teamOutbox.items.at(-1),home=path.join(root,'isolated-home')
 await fs.mkdir(path.join(home,'memory','team'),{recursive:true})
 await fs.writeFile(path.join(home,'memory','team','baseline-offer.json'),JSON.stringify({...item.payload,body:item.body}))
 return f.engine.applyBaselineOfferPre({expectedChecksum:item.payload.checksum,...options})
}
async function readDocs(f){return new LedgerDocReadSide({handoffDir:f.handoffDir}).list()}
function docFile(f,id){return path.join(f.handoffDir,'documents',id+'.md')}
function filesFor(f){const files={'event-store.json':'{"events":[]}'};for(const id of ids)files['documents/'+id+'.md']=String.raw`# Synthetic
<!-- r4-ledger-doc-v1 -->
documentId: ${id}
eventIds: evt_a1b2c3d4
createdAt: 2026-11-11T12:00:00.000Z
updatedAt: 2026-11-11T12:00:00.000Z
revision: ${'sha256:'+'0'.repeat(64)}

body
`;return files}
function forgedPayload(inner){const text=JSON.stringify(inner),body=zlib.brotliCompressSync(Buffer.from(text)).toString('base64');return{v:1,enc:'br+base64',body,checksum:inner.checksum,rawBytes:Buffer.byteLength(text),packedBytes:body.length,files:Object.keys(inner.files)}}
console.log('=== Optional documents and legacy compatibility ===')
const source=await fixture('source'),target=await fixture('target',false)
let uploaded
await test('P4-4-01 upload reads two valid documents and apply restores exact bytes and identity',async()=>{
 uploaded=await upload(source);assert.equal(uploaded.documents,2)
 const packet={...source.engine._teamOutbox.items[0],body:source.engine._teamOutbox.items[0].payload.body};assert.equal(packet.kind,'baseline');assert.equal(packet.key,'baseline:current')
 const unpacked=unpackBaselinePre(packet.payload);assert.equal(unpacked.ok,true);assert.equal(unpacked.meta.documents.length,2)
 target.engine._teamOutbox.items.push(packet)
 const result=await apply(target);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.documents,2)
 for(const id of ids){const expected=await fs.readFile(docFile(source,id));assert.ok(expected.equals(await fs.readFile(docFile(target,id))))
 const local=await new LedgerDocReadSide({handoffDir:target.handoffDir})._read(id);assert.equal(local.documentId,id);assert.equal(local.eventIds.join(','),eventId);assert.equal(local.revision,unpacked.meta.documents.find(x=>x.documentId===id).revision)}
 evidence.push({kind:'roundtrip',documents:result.documents,checksum:result.checksum})
})
await test('P4-4-02 same revision replay is idempotent without -b/-c files',async()=>{
 const result=await apply(target);assert.equal(result.ok,true,JSON.stringify(result))
 assert.equal(result.applied.some(name=>name.startsWith('documents/')),false)
 assert.deepEqual((await fs.readdir(path.join(target.handoffDir,'documents'))).sort(),ids.map(id=>id+'.md').sort())
})
await test('P4-4-03 v1 without documents retains codec and apply shape',async()=>{
 const legacy=packBaselinePre({files:{'event-store.json':'{"events":[]}','PLAN.md':'# legacy'}})
 assert.equal(legacy.ok,true);assert.equal('documents'in legacy.payload,false)
 const old=unpackBaselinePre(legacy.payload);assert.equal(old.ok,true);assert.equal('documents'in old.meta,false)
 const destination=await fixture('legacy-target',false);destination.engine._teamOutbox.items.push({kind:'baseline',key:'baseline:current',payload:legacy.payload,body:legacy.payload.body})
 const result=await apply(destination);assert.equal(result.ok,true,JSON.stringify(result));assert.equal('documents'in result,false)
 assert.equal(await fs.readFile(path.join(destination.handoffDir,'PLAN.md'),'utf8'),'# legacy')
})
console.log('')
console.log('=== Input, identity, revision and physical boundary negatives ===')
await test('P4-4-04 checksum and truncated payloads are rejected',async()=>{
 const packet=source.engine._teamOutbox.items[0]
 assert.equal(unpackBaselinePre({...packet.payload,checksum:'0'.repeat(64)}).ok,false)
 assert.equal(unpackBaselinePre({...packet.payload,body:packet.payload.body.slice(0,20)}).ok,false)
 const valid=unpackBaselinePre(packet.payload);assert.equal(valid.ok,true)
})
await test('P4-4-05 illegal IDs, paths, duplicate documents, associations and revisions are rejected',async()=>{
 const original=await fs.readFile(docFile(source,ids[0]),'utf8')
 const paths=['documents//absolute.md','documents/../escape.md','documents/a/b.md','documents/UPPER.md','documents\\evil.md']
 for(const name of paths){const result=packBaselinePre({files:{'event-store.json':'{"events":[]}',[name]:original}});assert.equal(result.ok,false,name)}
 const duplicated=packBaselinePre({files:{'event-store.json':'{"events":[]}'},documents:[{documentId:ids[0],text:original},{documentId:ids[0],text:original}]})
 assert.equal(duplicated.reason,'duplicate-document')
 assert.equal(packBaselinePre({files:{'event-store.json':'{"events":[]}',['documents/'+ids[0]+'.md']:original.replace(eventId,'evt_not_valid')}}).ok,false)
 assert.equal(packBaselinePre({files:{'event-store.json':'{"events":[]}',['documents/'+ids[0]+'.md']:original.replace(/^revision: .*$/m,'revision: sha256:'+'1'.repeat(64))}}).ok,false)
 const debug=packBaselinePre({files:{'event-store.json':'{"events":[]}','index.json':'{}','debug.md':'debug'}});assert.equal(debug.ok,true);assert.equal(debug.payload.files.includes('index.json'),false)
})
await test('P4-4-06 source symlink/junction and bad revision fail closed before upload',async()=>{
 const escaped=await fixture('escaped')
 await fs.rm(path.join(escaped.handoffDir,'documents'),{recursive:true,force:true})
 await fs.symlink(source.handoffDir,path.join(escaped.handoffDir,'documents'),'junction')
 const result=await escaped.engine.uploadBaselinePre({})
 assert.equal(result.ok,false);assert.match(result.reason,/document-upload-failed/)
 assert.equal(escaped.engine._teamOutbox.items.length,0)
 const invalid=await fixture('invalid-revision')
 await fs.writeFile(docFile(invalid,ids[0]),(await fs.readFile(docFile(invalid,ids[0]),'utf8')).replace(/^revision: .*$/m,'revision: sha256:'+'0'.repeat(64)))
 const rejected=await invalid.engine.uploadBaselinePre({});assert.equal(rejected.ok,false);assert.equal(invalid.engine._teamOutbox.items.length,0)
 const linkedFile=await fixture('symlink-file')
 await fs.rm(docFile(linkedFile,ids[0]),{force:true})
 await fs.symlink(docFile(source,ids[0]),docFile(linkedFile,ids[0]))
 const linkResult=await linkedFile.engine.uploadBaselinePre({})
 assert.equal(linkResult.ok,false);assert.equal(linkedFile.engine._teamOutbox.items.length,0)
})
await test('P4-4-06b target documents junction is rejected before any write',async()=>{
 const linked=await fixture('target-junction',false)
 const outside=path.join(root,'outside-target');await fs.mkdir(outside,{recursive:true})
 await fs.symlink(outside,path.join(linked.handoffDir,'documents'),'junction')
 linked.engine._teamOutbox.items.push({...source.engine._teamOutbox.items[0],body:source.engine._teamOutbox.items[0].payload.body})
 const result=await apply(linked)
 assert.equal(result.ok,false);assert.equal(result.reason,'document-path-invalid')
 assert.equal((await fs.readdir(outside)).length,0)
})
console.log('')
console.log('=== Conflict choices and transaction rollback ===')
await test('P4-4-07 conflict defaults to no write; explicit local and remote choices are audited',async()=>{
 const first=await fs.readFile(docFile(target,ids[0]),'utf8');assert.ok(first.length>0)
 const store=new LedgerDocumentStore(path.join(target.handoffDir,'documents'),{eventsPath:target.eventsPath,now:()=> '2026-11-11T12:02:00.000Z'})
 const local=await store.updateDocument({documentId:ids[0],eventIds:[eventId],expectedRevision:(await new LedgerDocReadSide({handoffDir:target.handoffDir})._read(ids[0])).revision,changeSet:[{regionId:'content',beforeText:'document 0',afterText:'local'}]})
 assert.equal(local.ok,true,JSON.stringify(local))
 const conflict=await apply(target);assert.equal(conflict.ok,false);assert.equal(conflict.reason,'document-conflict')
 assert.equal((await new LedgerDocReadSide({handoffDir:target.handoffDir})._read(ids[0])).content,'local')
 const keep=await apply(target,{documentResolutions:{[ids[0]]:'local'}});assert.equal(keep.ok,true,JSON.stringify(keep))
 assert.equal(keep.documentsAudit.find(x=>x.documentId===ids[0]).action,'keep-local')
 assert.equal((await new LedgerDocReadSide({handoffDir:target.handoffDir})._read(ids[0])).content,'local')
 const remote=await apply(target,{documentResolutions:{[ids[0]]:'remote'}});assert.equal(remote.ok,true,JSON.stringify(remote))
 assert.equal(remote.documentsAudit.find(x=>x.documentId===ids[0]).action,'overwrite-remote')
 assert.ok((await fs.readFile(docFile(source,ids[0]))).equals(await fs.readFile(docFile(target,ids[0]))))
})
await test('P4-4-08 mid-write failure rolls back only applied files and preserves backup/unwritten files',async()=>{
 const destination=await fixture('rollback-target',false)
 destination.engine._teamOutbox.items.push({...source.engine._teamOutbox.items[0],body:source.engine._teamOutbox.items[0].payload.body})
 const originalEvent=await fs.readFile(destination.eventsPath)
 const result=await apply(destination,{writeTextAtomicPreSync:(target,text)=>target.endsWith(ids[1]+'.md')?{ok:false,error:'synthetic-write-failed'}:writeTextAtomicPreSync(target,text)});assert.equal(result.ok,false,JSON.stringify(result))
 assert.deepEqual(result.applied,['MEMORY.project.md','MEMORY.user.md','PLAN.md','documents/'+ids[0]+'.md'])
 assert.equal(result.failedItems[0].name,'documents/'+ids[1]+'.md')
 assert.deepEqual(result.rolledBack,['MEMORY.project.md','MEMORY.user.md','PLAN.md','documents/'+ids[0]+'.md'])
 assert.ok(originalEvent.equals(await fs.readFile(destination.eventsPath)))
 assert.equal(await fs.stat(docFile(destination,ids[0])).then(()=>true,()=>false),false)
 assert.ok(result.backup)
 const backup=path.join(result.backup,'event-store.json');assert.ok((await fs.readFile(backup)).equals(originalEvent))
 const retry=await apply(destination);assert.equal(retry.ok,true,JSON.stringify(retry))
 assert.deepEqual((await fs.readdir(path.join(destination.handoffDir,'documents'))).sort(),ids.map(id=>id+'.md').sort())
})
console.log('')
console.log('=== Isolated mutations ===')
const mutationRoot=path.resolve('artifacts','_r4-p4-4-mutation')
const cleanCodec=await fs.readFile('lib/team-baseline.js','utf8')
const cleanPlanner=await fs.readFile('lib/ledger-doc/baseline-documents.js','utf8')
const variants=[
 {name:'documents-not-in-checksum',file:'team-baseline.js',source:cleanCodec.replace('const names = Object.keys(files).sort()',"const names = Object.keys(files).filter((name) => !name.startsWith('documents/')).sort()"),kind:'checksum'},
 {name:'revision-not-checked',file:'team-baseline.js',source:cleanCodec.replace('if (fields.revision !== revision)', 'if (false)'),kind:'revision'},
 {name:'conflict-silently-accepted',file:'baseline-documents.js',source:cleanPlanner.replace('if (conflicts.length)', 'if (false)'),kind:'conflict'},
]
for(const variant of variants){
 const dir=path.join(mutationRoot,variant.name),lib=path.join(dir,'lib')
 await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(path.join(lib,'ledger-doc'),{recursive:true})
 await fs.writeFile(path.join(lib,'team-baseline.js'),variant.file==='team-baseline.js'?variant.source:cleanCodec)
 await fs.copyFile('lib/ledger-doc/protocol.js',path.join(lib,'ledger-doc','protocol.js'))
 await fs.copyFile('lib/ledger-doc/baseline-documents.js',path.join(lib,'ledger-doc','baseline-documents.js'))
 await fs.copyFile('lib/ledger-doc/read-side.js',path.join(lib,'ledger-doc','read-side.js'))
 await fs.copyFile('lib/file-boundary.js',path.join(lib,'file-boundary.js'))
 const codec=await import(pathToFileURL(path.join(lib,'team-baseline.js')).href)
 const planner=await import(pathToFileURL(path.join(lib,'ledger-doc','baseline-documents.js')).href)
 let caught=false,detail
 try{
  if(variant.kind==='checksum'){
   const packet=codec.packBaselinePre({files:{'event-store.json':'{"events":[]}',['documents/'+ids[0]+'.md']:await fs.readFile(docFile(source,ids[0]),'utf8')}})
   assert.equal(packet.ok,true,JSON.stringify(packet))
   const inner=JSON.parse(zlib.brotliDecompressSync(Buffer.from(packet.payload.body,'base64')).toString('utf8'))
   inner.files['documents/'+ids[0]+'.md']=inner.files['documents/'+ids[0]+'.md'].replace(/\n/g,String.fromCharCode(13,10))
   const result=codec.unpackBaselinePre(forgedPayload(inner));detail=JSON.stringify({result,computed:codec.baselineChecksumPre(inner.files),original:inner.checksum});assert.equal(result.ok,false,'tampered document was accepted without checksum coverage: '+detail)
  }else if(variant.kind==='revision'){
   const text=await fs.readFile(docFile(source,ids[0]),'utf8');const bad=text.replace(/^revision: .*$/m,'revision: sha256:'+'0'.repeat(64))
   const result=codec.packBaselinePre({files:{'event-store.json':'{"events":[]}',['documents/'+ids[0]+'.md']:bad}});assert.equal(result.ok,false,'invalid revision accepted')
  }else{
   const local=await new LedgerDocReadSide({handoffDir:target.handoffDir})._read(ids[0])
   const result=await planner.planBaselineDocumentsPre({files:{'event-store.json':'{}',['documents/'+ids[0]+'.md']:await fs.readFile(docFile(source,ids[0]),'utf8')},handoffDir:target.handoffDir})
   assert.equal(result.ok,true);assert.equal(result.reason,'document-conflict')
   assert.equal(local.documentId,ids[0])
  }
 }catch(error){caught=true;detail=error.message}
 await test('MUT-'+variant.name+' becomes red',()=>assert.equal(caught,true,detail||'MISSED'))
 evidence.push({kind:'mutation',name:variant.name,result:caught?'CAUGHT':'MISSED',detail})
}
await test('MUT-restored clean codec and conflict planner remain green',async()=>{
 const packet=packBaselinePre({files:{'event-store.json':'{"events":[]}',['documents/'+ids[0]+'.md']:await fs.readFile(docFile(source,ids[0]),'utf8')}})
 assert.equal(unpackBaselinePre(packet.payload).ok,true)
 const bad=(await fs.readFile(docFile(source,ids[0]),'utf8')).replace(/^revision: .*$/m,'revision: sha256:'+'0'.repeat(64))
 assert.equal(packBaselinePre({files:{'event-store.json':'{}',['documents/'+ids[0]+'.md']:bad}}).ok,false)
 const restored=await fixture('restore-conflict')
 const restoredStore=new LedgerDocumentStore(path.join(restored.handoffDir,'documents'),{eventsPath:restored.eventsPath,now:()=> '2026-11-11T12:05:00.000Z'})
 const restoredRead=await new LedgerDocReadSide({handoffDir:restored.handoffDir})._read(ids[0])
 const changed=await restoredStore.updateDocument({documentId:ids[0],eventIds:[eventId],expectedRevision:restoredRead.revision,changeSet:[{regionId:'content',beforeText:'document 0',afterText:'restored local'}]})
 assert.equal(changed.ok,true,JSON.stringify(changed))
 const conflict=await (await import('../../lib/ledger-doc/baseline-documents.js')).planBaselineDocumentsPre({files:{'event-store.json':'{}',['documents/'+ids[0]+'.md']:await fs.readFile(docFile(source,ids[0]),'utf8')},handoffDir:restored.handoffDir})
 assert.equal(conflict.ok,false)
})
evidence.push({kind:'restored',result:'GREEN'})
await test('P4-4-09 new files use LF without mixed endings',async()=>{
 for(const file of ['lib/ledger-doc/baseline-documents.js','tests/smoke/smoke-test-r4-team-baseline.mjs']){
  const bytes=await fs.readFile(file),text=bytes.toString('latin1'),crlf=String.fromCharCode(13,10)
  assert.equal(text.includes(crlf)&&text.split(crlf).join('').includes(String.fromCharCode(10)),false,file)
  evidence.push({kind:'file',file,bytes:bytes.length})
 }
})
await fs.writeFile(path.join(root,'test-results.json'),JSON.stringify({pass,fail,failures,evidence},null,2)+String.fromCharCode(10))
console.log('SUMMARY PASS '+pass+' / FAIL '+fail)
console.log('MUTATION CAUGHT '+evidence.filter(x=>x.result==='CAUGHT').length+' / MISSED '+evidence.filter(x=>x.result==='MISSED').length)
console.log('RESTORED '+(evidence.find(x=>x.kind==='restored')?.result||'MISSING'))
process.exitCode=fail===0?0:1
