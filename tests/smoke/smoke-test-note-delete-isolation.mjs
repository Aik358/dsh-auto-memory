import { createHash } from 'node:crypto'
// Complete production apply + migration routes; filesystem and home are isolated.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
const root=await fsp.mkdtemp(path.join(os.tmpdir(),'dam-write-isolation-'))
const cwd=process.cwd(), env={HOME:process.env.HOME,DSH_HOME:process.env.DSH_HOME}
process.chdir(root);process.env.HOME=root;process.env.DSH_HOME=path.join(root,'home')
await fsp.mkdir(process.env.DSH_HOME,{recursive:true})
await fsp.writeFile(path.join(process.env.DSH_HOME,'dsh-auto-memory.json'),JSON.stringify({memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),globalBriefEnabled:false,l0IndexEnabled:false,externalSources:{},autoConsolidate:false,greetingEnabled:false,pythonBackendEnabled:false,memoryAnchorEnabled:true}))
const {apply,MemoryEngine,API,flushDiagnostics}=await import('../lib/audit-engine.mjs')
const {createFactStorePre}=await import('../../lib/fact-store.js')
const oldFetch=globalThis.fetch, timers={setTimeout:globalThis.setTimeout,setInterval:globalThis.setInterval}
const methods={loadConfigSync:MemoryEngine.prototype.loadConfigSync,refresh:MemoryEngine.prototype.refresh,checkUpdate:MemoryEngine.prototype.checkUpdate,fetchNotices:MemoryEngine.prototype.fetchNotices}
const listeners=new Map(['uncaughtException','unhandledRejection','exit'].map(k=>[k,new Set(process.listeners(k))]))
let engine,cleanup;const pending=[],routes=[]
MemoryEngine.prototype.loadConfigSync=function(){engine=this;return methods.loadConfigSync.call(this)}
MemoryEngine.prototype.refresh=function(...args){const p=methods.refresh.apply(this,args);pending.push(p);return p}
MemoryEngine.prototype.checkUpdate=async()=>({});MemoryEngine.prototype.fetchNotices=async()=>[]
globalThis.fetch=async()=>{throw Error('external request prohibited')}
globalThis.setTimeout=globalThis.setInterval=()=>({unref(){}})
const drain=async()=>{let n=0;while(n<pending.length){const batch=pending.slice(n);n=pending.length;await Promise.all(batch)}await flushDiagnostics()}
const agents=new Map(),events=new Map()
const request=async(key,body,query='')=>{let status,data;const route=routes.find(r=>r.path===API[key]);assert.ok(route);await route.handler({method:body?'POST':'GET',url:API[key]+query,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1',origin:'http://127.0.0.1'},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body))}},{setHeader(){},writeHead:s=>status=s,end:s=>data=JSON.parse(s)});return {status,data}}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
try {
 apply({get:key=>key==='agents'?{get:sid=>agents.get(sid)}:undefined,on:(key,fn)=>{events.set(key,fn);return()=>{}},effect:f=>cleanup=f(),systemPrompt:{section:()=>()=>{},context:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}}},{})
 Object.assign(globalThis,timers);await drain()
 const a={session:{id:'A',header:{cwd:path.join(root,'A')}},id:'A'},b={session:{id:'B',header:{cwd:path.join(root,'B')}},id:'B'}
 for(const agent of [a,b]){agents.set(agent.session.id,agent);await fsp.mkdir(agent.session.header.cwd);await fsp.mkdir(engine.projectDirOf(agent.session.header.cwd),{recursive:true})}
 const pa=await engine.resolvePaths(a),pb=await engine.resolvePaths(b)
 const activate=async agent=>{events.get('agent/session-start')({agent,source:'fresh'});await drain()}
 await activate(a);const displayed=(await request('state',null,'?ws='+encodeURIComponent(pa.ws))).data;assert.equal(displayed.notesPath,pa.notesPath)
 await activate(b);assert.equal(engine.state.ws,pb.ws)
 await test('A form remains bound to A after a real B background refresh mirrors B',async()=>{
  const before=await fsp.readFile(pb.notesPath,'utf8').catch(()=>''),r=await request('note',{content:'A isolated decision',sessionId:'A',expectedNotesPath:displayed.notesPath})
  assert.equal(r.status,200,JSON.stringify(r));assert.match(await fsp.readFile(pa.notesPath,'utf8'),/A isolated decision/);assert.equal(await fsp.readFile(pb.notesPath,'utf8').catch(()=>''),before)
 })
 await test('unknown session, mismatched destination and missing binding are rejected',async()=>{
  for(const body of [{content:'unknown decision',sessionId:'unknown',expectedNotesPath:pa.notesPath},{content:'mismatched decision',sessionId:'A',expectedNotesPath:pb.notesPath},{content:'unbound decision'}]){
   const r=await request('note',body);assert([400,409].includes(r.status),JSON.stringify(r))
  }
 })
 await test('deduplication reads A disk instead of a different runtime cache',async()=>{
  await engine.appendText(pa.notesPath,'actual duplicate phrase');await activate(b)
  const r=await request('note',{content:'actual duplicate phrase',sessionId:'A',expectedNotesPath:pa.notesPath});assert.equal(r.status,400);assert.match(r.data.error,/重复|duplicate/)
 })
 await activate(a)
 const ds=engine.docStore,ids=['a','b','c'].map(x=>'mem_'+x.repeat(32)),original=ids.map((id,i)=>'<!-- memory:'+id+' -->\n\nentry '+String.fromCharCode(65+i)+'\n').join('\n')
 const facts=createFactStorePre({io:{load:()=>null,save(){}}});engine._memoryHub={stores:{facts}}
 const purge=engine._activationHost.purgeMemory,purged=[];engine._activationHost.purgeMemory=function(id){purged.push(id);return purge.call(this,id)}
 const seed=async()=>{await ds.replaceRaw(pa.notesPath,original);purged.length=0;for(const [i,id]of ids.entries())facts.upsert({scope:'Workspace',subject:'project '+i,predicate:'uses framework',object:'React',sourceKind:'explicit',provenance:[id]})}
 const holdReads=count=>{const io=ds.fs,entered=deferred(),release=deferred();let seen=0;ds.fs={...io,async readFile(file,...args){const buf=await io.readFile(file,...args);if(String(file)===pa.notesPath&&++seen<=count){if(seen===count)entered.resolve();await release.promise}return buf}};return {entered,release,restore:()=>ds.fs=io}}
 await test('version-bound delete/delete cannot revive a removed anchor or cascade a rejected delete',async()=>{
  await seed();const expectedDigest=createHash('sha256').update(await fsp.readFile(pa.notesPath)).digest('hex');const hold=holdReads(2)
  try {const first=request('storage-manage',{action:'delete',filePath:pa.notesPath,memoryId:ids[0],expectedDigest}),second=request('storage-manage',{action:'delete',filePath:pa.notesPath,memoryId:ids[1],expectedDigest});await hold.entered.promise;hold.release.resolve();const results=await Promise.all([first,second]);assert(results.every(r=>r.status===200));assert.equal(results.filter(r=>r.data.ok).length,1);assert.equal(results.find(r=>!r.data.ok).data.reason,'conflict-external-edit');const winner=results.find(r=>r.data.ok).data.memoryId,text=await fsp.readFile(pa.notesPath,'utf8');assert(!text.includes(winner));assert.deepEqual(purged,[winner]);assert.equal(facts.snapshot({includeRevoked:true}).facts.find(f=>f.provenance.includes(winner)).revoked,true)}
  finally{hold.release.resolve();hold.restore()}
 })
 await test('version-bound delete/GUI append preserves the new record and rejects stale deletion',async()=>{
  await seed();const expectedDigest=createHash('sha256').update(await fsp.readFile(pa.notesPath)).digest('hex');const hold=holdReads(1)
  try{const deletion=request('storage-manage',{action:'delete',filePath:pa.notesPath,memoryId:ids[0],expectedDigest});await hold.entered.promise;const append=await request('note',{content:'new concurrent decision',sessionId:'A',expectedNotesPath:pa.notesPath});assert.equal(append.status,200,JSON.stringify(append));hold.release.resolve();const result=await deletion;assert.equal(result.data.ok,false);assert.equal(result.data.reason,'conflict-external-edit');const text=await fsp.readFile(pa.notesPath,'utf8');assert(text.includes(ids[0]));assert(text.includes('new concurrent decision'));assert.deepEqual(purged,[])}finally{hold.release.resolve();hold.restore()}
 })
}finally{
 await drain();if(cleanup)cleanup();await flushDiagnostics()
 for(const [key,value]of Object.entries(methods))MemoryEngine.prototype[key]=value
 Object.assign(globalThis,timers);globalThis.fetch=oldFetch
 for(const [k,prev]of listeners)for(const h of process.listeners(k))if(!prev.has(h))process.removeListener(k,h)
 process.chdir(cwd);for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value}
 await fsp.rm(root,{recursive:true,force:true})
}
