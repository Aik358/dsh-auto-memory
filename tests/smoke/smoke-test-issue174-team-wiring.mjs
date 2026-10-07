import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import fs from 'node:fs'
import { createFactStorePre } from '../../lib/fact-store.js'
import { createHubIoPre } from '../../lib/hub-io.js'
import { Readable } from 'node:stream'
import { apply, API, MemoryEngine } from '../lib/audit-engine.mjs'
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-team-e2e-'))
const home = process.env.DSH_HOME, fetch = globalThis.fetch, timeout = globalThis.setTimeout, interval = globalThis.setInterval
const load = MemoryEngine.prototype.loadConfigSync
const handlers = new Map(['uncaughtException','unhandledRejection','exit'].map(k => [k,new Set(process.listeners(k))]))
let engine, cleanup, rejectPush = false, network = []
const timers = [], routes = []
let holdPush=null,holdPull=null,pullChanges=null
MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
process.env.DSH_HOME = root
try {
 await writeFile(path.join(root,'dsh-auto-memory.json'), JSON.stringify({ teamEnabled:true,teamServerUrl:'http://fake.invalid',teamId:'test-team',teamMemberId:'member-a',teamMemberName:'Alice',memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),globalBriefEnabled:false,externalSources:{} }))
 globalThis.setInterval = globalThis.setTimeout = (callback,ms) => { const t={callback,ms,unref(){}};timers.push(t);return t }
 globalThis.fetch = async (url,opts) => {
  assert.equal(new URL(url).hostname,'fake.invalid');network.push({url:String(url),opts})
  const hold=opts.method==='POST'?holdPush:holdPull
  if(hold)return new Promise(resolve=>{hold.signal=opts.signal;hold.resolve=()=>resolve(new Response(JSON.stringify(opts.method==='POST'?{ok:true}:{cursor:99,changes:[{kind:'fact',key:'late',payload:{scope:'Workspace',subject:'late response',predicate:'value',object:'forbidden',sourceKind:'explicit'}}]})));opts.signal.addEventListener('abort',()=>resolve(new Response('{}',{status:499})),{once:true})})
  if(opts.method==='GET'&&pullChanges)return new Response(JSON.stringify({cursor:43,changes:pullChanges}))
  return new Response(JSON.stringify(opts.method==='POST'?{ok:true}:{cursor:42,changes:[{kind:'fact',key:'f1',member:{id:'other'},payload:{text:'test'}}]}),{status:rejectPush?503:200})
 }
 apply({get:()=>undefined,credentials:{teamToken:'test-token'},on:()=>{},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}},effect:f=>{cleanup=f()}},{})
 for(const [k,prev]of handlers)for(const h of process.listeners(k))if(!prev.has(h))process.removeListener(k,h)
 globalThis.setInterval=interval;globalThis.setTimeout=timeout
 assert.ok(engine._teamPull);assert.ok(timers.includes(engine._teamPullTimer));assert.equal(timers.filter(t=>t===engine._teamPullTimer).length,1)
 // Real outbox -> sync -> auth -> fake wire. JSON is encoded once by auth.
 assert.equal(engine._teamOutbox.enqueue({kind:'fact',key:'one',payload:{text:'hello'}}).ok,true)
 await engine._teamSync.tick();assert.equal(engine._teamOutbox.size(),0)
 assert.equal(typeof JSON.parse(network.find(n=>n.opts.method==='POST').opts.body),'object')
 rejectPush=true;engine._teamOutbox.enqueue({kind:'fact',key:'failed',payload:{text:'keep'}});await engine._teamSync.tick();assert.equal(engine._teamOutbox.size(),1)
 rejectPush=false
 engine._factStore={upsert:()=>({ok:true,outcome:'added'})}
 engine._teamPullTimer.callback();await new Promise(r=>timeout(r,30));assert.equal(engine._teamPull.status().since,42,JSON.stringify({network,status:engine._teamPull.status(),config:engine.config.teamEnabled}))
 assert.ok(engine._teamInjectCandidates.length>0)
 const request=async(key,body,method=body?'POST':'GET')=>{
  let status,data;const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url:API[key],socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1'}})
  await routes.find(r=>r.path===API[key]).handler(req,{writeHead:s=>{status=s},end:b=>{data=JSON.parse(b)},setHeader(){}});return {status,data}
 }
 const before=network.length
 const state=await request('teamState');assert.equal(state.data.outbox.size,1);assert.equal(state.data.member.id,'member-a');assert.equal(state.data.pull.since,42);assert.equal(network.length,before)
 const paused=await request('teamControl',{action:'pause',paused:true});assert.equal(paused.status,200,JSON.stringify(paused))
 await engine._teamSync.tick();await engine._teamPull.pullOnce();assert.equal(network.length,before)
 assert.equal((await request('teamControl',{action:'reset-cursor'})).status,400)
 assert.equal(engine._teamPull.status().since,42)
 assert.equal((await request('teamControl',{action:'reset-cursor',confirm:true})).status,200)
 assert.equal(engine._teamPull.status().since,0);assert.equal(engine._teamOutbox.size(),1)
 assert.equal((await request('teamControl',null)).status,405)
 // Updating config cannot leave auth captured on the old object.
 engine.config={...engine.config,teamId:'changed',teamEnabled:true};await request('teamControl',{action:'pause',paused:false});await engine._teamSync.tick()
 assert.equal(network.at(-1).opts.headers['x-dam-team'],'changed')
 // Two real fact conflicts retain their IDs, both snapshots and provenance.
 const facts=createFactStorePre({io:{load:()=>null,save:()=>{}}});engine._factStore=facts
 const candidate=subject=>({scope:'Workspace',subject,predicate:'uses framework',object:'React',sourceKind:'explicit',provenance:['mem_'+'a'.repeat(32)]})
 for(const subject of ['project alpha','project beta'])assert.equal(facts.upsert(candidate(subject)).outcome,'created')
 pullChanges=['project alpha','project beta'].map(subject=>({kind:'fact',key:subject,member:{id:'other'},payload:{...candidate(subject),object:'Vue'}}))
 assert.equal((await engine._teamPull.pullOnce()).ok,true)
 const conflicts=(await request('teamConflicts')).data.conflicts;assert.equal(conflicts.length,2);assert.notEqual(conflicts[0].key,conflicts[1].key)
 assert.ok(conflicts.every(c=>c.local.object==='React'&&c.remote.object==='Vue'&&c.local.provenance.length))
 const client=await readFile(new URL('../../lib/client.js',import.meta.url),'utf8'),start=client.indexOf('    function teamFromState(st) {'),end=client.indexOf('// ===================== L3-team:end',start)
 const routeKeys={state:'teamState',attr:'teamAttribution',conflicts:'teamConflicts',debug:'teamSyncDebug'}
 const ui={API:{teamState:'state',teamAttribution:'attr',teamConflicts:'conflicts',teamSyncDebug:'debug'},apiGet:async key=>(await request(routeKeys[key])).data,Object,Array,Number,JSON,Promise}
 vm.createContext(ui);vm.runInContext(client.slice(start,end)+'\nthis.read=fetchTeamState;',ui);const shown=await ui.read()
 assert.equal(shown.team.conflictItems.length,2);assert.ok(shown.team.conflictItems.every(c=>c.local.includes('React')&&c.remote.includes('Vue')));assert.equal(shown.team.members[0].id,'member-a')
 assert.match(shown.team.debug.outbox.lastError,/send:/);assert.ok(shown.team.syncAt>0)
 // Formal host applier must atomically persist remote receipts with facts.
 const retryDir=path.join(root,'pull-receipts'),retryFile=path.join(retryDir,'facts.json')
 const retryIo=createHubIoPre({dir:retryDir,fsApi:{renameSync:(...args)=>fs.renameSync(...args)}})('facts.json')
 const retryFacts=createFactStorePre({io:retryIo});engine._factStore=retryFacts
 assert.equal(retryFacts.upsert(candidate('receipt fixture')).ok,true)
 pullChanges=[{kind:'fact',key:'receipt-conflict',revision:101,payload:{...candidate('receipt fixture'),object:'Vue'}},{kind:'fact',key:'receipt-create',revision:102,payload:candidate('receipt second')}]
 engine._teamPull.reset()
 const originalRename=fs.renameSync;let receiptWrites=0
 try{
  fs.renameSync=(from,to)=>{if(to===retryFile&&++receiptWrites===2)throw Object.assign(new Error('receipt second save denied'),{code:'EPERM'});return originalRename(from,to)}
  const first=await engine._teamPull.pullOnce();assert.equal(first.ok,false);assert.equal(first.since,0);assert.equal(retryFacts.snapshot().conflicts.length,1)
 }finally{fs.renameSync=originalRename}
 const recovered=await engine._teamPull.pullOnce();assert.equal(recovered.ok,true);assert.equal(recovered.since,43);assert.equal(retryFacts.snapshot().conflicts.length,1)
 assert.equal(retryFacts.snapshot().teamReceipts.length,2)
 const restartFacts=createFactStorePre({io:retryIo});assert(restartFacts.restore(retryIo.load()).ok);engine._factStore=restartFacts
 engine._teamPull.reset();const replay=await engine._teamPull.pullOnce();assert.equal(replay.applied,0);assert.equal(restartFacts.snapshot().conflicts.length,1)
 engine._factStore=facts
 // An HTTP ACK is not a durable dequeue. Inject a real fs.renameSync
 // failure at only the outbox target and observe formal sync/routes/UI.
 engine._teamMerge.clear();assert.equal((await ui.read()).team.phase,'synced')
 engine._teamOutbox.enqueue({kind:'fact',key:'durable-ack',payload:{text:'retain until disk commit'}})
 holdPush={};const commit=engine._teamSync.tick();await new Promise(r=>timeout(r,0));assert.ok(holdPush.resolve)
 engine._teamOutbox.enqueue({kind:'fact',key:'during-ack',payload:{text:'enqueued while first HTTP pending'}})
 const outboxFile=engine._teamOutbox.file,oldDisk=await readFile(outboxFile,'utf8'),rename=fs.renameSync
 let writeAttempts=0
 try {
  fs.renameSync=(from,to)=>{if(to===outboxFile){writeAttempts++;throw Object.assign(new Error('injected outbox rename denied'),{code:'EPERM'})}return rename(from,to)}
  holdPush.resolve();holdPush=null;const failedCommit=await commit;assert.equal(failedCommit.failed,1);assert.match(failedCommit.error,/outbox-persist-failed/)
 }finally{fs.renameSync=rename}
 assert.ok(writeAttempts>0);assert.equal(engine._teamOutbox.size(),2);assert.equal(await readFile(outboxFile,'utf8'),oldDisk)
 const failedState=await ui.read();assert.equal(failedState.team.phase,'offline');assert.match(failedState.team.error,/outbox-persist-failed/);assert.equal(failedState.team.queue,2);assert.equal(engine._teamSync.status().lastOk,null)
 const retried=await engine._teamSync.tick();assert.equal(retried.failed,0);assert.equal(engine._teamOutbox.size(),0);assert.equal(JSON.parse(await readFile(outboxFile,'utf8')).items.length,0)
 const recoveredState=await ui.read();assert.equal(recoveredState.team.phase,'synced');assert.equal(recoveredState.team.error,'');assert.match(recoveredState.team.debug.outbox.lastError,/injected outbox rename denied/)
 pullChanges=null
 // Responses outstanding at pause/close/dispose are invalidated. Already sent
 // requests may have remote effects; queued candidates stay on disk for recovery.
 const factSnapshot=()=>{const s=facts.snapshot();return JSON.stringify({facts:s.facts,conflicts:s.conflicts})}
 const retiredPull=engine._teamPullTimer,retiredSync=engine._teamSync
 const oldSyncTimers=timers.filter(t=>t.callback?.name==='onTickPre')
 for(const mode of ['pause','pause-resume','close','dispose']){
  engine._teamOutbox.clear();engine._teamOutbox.enqueue({kind:'fact',key:'held-first',payload:{text:'one'}});engine._teamOutbox.enqueue({kind:'fact',key:'held-second',payload:{text:'two'}})
  const file=engine._teamOutbox.file,disk=await readFile(file,'utf8'),snapshot=factSnapshot(),cursor=engine._teamPull.status().since
  holdPush={};holdPull={};const count=network.length,push=engine._teamSync.tick(),pull=engine._teamPull.pullOnce();await new Promise(r=>timeout(r,0));assert.ok(holdPush.resolve&&holdPull.resolve)
  if(mode.startsWith('pause')){await request('teamControl',{action:'pause',paused:true});if(mode==='pause-resume')await request('teamControl',{action:'pause',paused:false})}
  else if(mode==='close')engine.config={...engine.config,teamEnabled:false}
  else {cleanup();cleanup=null;assert.equal(holdPush.signal.aborted,true);assert.equal(holdPull.signal.aborted,true)}
  holdPush.resolve();holdPull.resolve();await Promise.all([push,pull]);assert.equal(network.length,count+2,'no second queued push after invalidation');assert.equal(engine._teamOutbox.size(),2);assert.equal(await readFile(file,'utf8'),disk);assert.equal(engine._teamPull.status().since,cursor);assert.equal(factSnapshot(),snapshot)
  holdPush=holdPull=null
  if(mode!=='dispose'){engine.config={...engine.config,teamEnabled:true};await request('teamControl',{action:'pause',paused:false})}
 }
 const stoppedAt=network.length;retiredPull.callback();for(const timer of oldSyncTimers)timer.callback();await retiredSync.tick();await new Promise(r=>timeout(r,0));assert.equal(network.length,stoppedAt);assert.equal(retiredSync.status().running,false)
 network=[];
timers.length=0;routes.length=0
 await writeFile(path.join(root,'dsh-auto-memory.json'),JSON.stringify({teamEnabled:false,memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),globalBriefEnabled:false}))
 globalThis.setInterval=globalThis.setTimeout=(callback,ms)=>{const t={callback,ms,unref(){}};timers.push(t);return t}
 apply({get:()=>undefined,on:()=>{},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}},effect:f=>{cleanup=f()}},{})
 assert.equal(engine._teamPull,undefined);assert.equal(engine._teamSync,undefined);assert.equal(engine._teamPullTimer,undefined);assert.equal(network.length,0)
 cleanup();cleanup=null;timers.length=0;routes.length=0
 await writeFile(path.join(root,'dsh-auto-memory.json'),JSON.stringify({teamEnabled:true,teamServerUrl:'http://fake.invalid',teamId:'test-team',teamMemberId:'member-a',memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),globalBriefEnabled:false}))
 apply({get:()=>undefined,credentials:{teamToken:'test-token'},on:()=>{},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}},effect:f=>{cleanup=f()}},{})
 assert.equal(engine._teamOutbox.size(),2);assert.ok(engine._teamPullTimer);assert.equal(timers.filter(t=>t===engine._teamPullTimer).length,1)
 retiredPull.callback();await retiredSync.tick();assert.equal(network.length,0)
 engine._teamPullTimer.callback();await new Promise(r=>timeout(r,0));assert.equal(network.filter(n=>n.opts.method==='GET').length,1)
 console.log('PASS #174: real host assembly, auth/object body, failed queue, scheduled pull/injection, GET read-only, pause/reset, live config and off gate')
} finally {
 globalThis.fetch=fetch;globalThis.setTimeout=timeout;globalThis.setInterval=interval;MemoryEngine.prototype.loadConfigSync=load
 if(cleanup)cleanup();for(const [k,prev]of handlers)for(const h of process.listeners(k))if(!prev.has(h))process.removeListener(k,h)
 if(home===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=home
 // ★2026-10-05：收尾清理重试——引擎 cleanup 后可能仍有 in-flight 原子写（tmp→rename）尚未落定，
 //   立即 rm 会撞 ENOTEMPTY（实测本套件 Windows 上偶发 ~35%）。全部断言已 PASS，纯属清理竞态。
 for(let i=0;i<10;i++){try{await rm(root,{recursive:true,force:true});break}catch(e){if(i===9)throw e;await new Promise(r=>setTimeout(r,100))}}
}
