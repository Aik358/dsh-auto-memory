import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply, API, MemoryEngine } from '../lib/audit-engine.mjs'
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-team-e2e-'))
const home = process.env.DSH_HOME, fetch = globalThis.fetch, timeout = globalThis.setTimeout, interval = globalThis.setInterval
const load = MemoryEngine.prototype.loadConfigSync
const handlers = new Map(['uncaughtException','unhandledRejection','exit'].map(k => [k,new Set(process.listeners(k))]))
let engine, cleanup, rejectPush = false, network = []
const timers = [], routes = []
MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
process.env.DSH_HOME = root
try {
 await writeFile(path.join(root,'dsh-auto-memory.json'), JSON.stringify({ teamEnabled:true,teamServerUrl:'http://fake.invalid',teamId:'test-team',teamMemberId:'member-a',teamMemberName:'Alice',memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),globalBriefEnabled:false,externalSources:{} }))
 globalThis.setInterval = globalThis.setTimeout = (callback,ms) => { const t={callback,ms,unref(){}};timers.push(t);return t }
 globalThis.fetch = async (url,opts) => {
  assert.equal(new URL(url).hostname,'fake.invalid');network.push({url:String(url),opts})
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
 cleanup();cleanup=null;network=[];timers.length=0;routes.length=0
 await writeFile(path.join(root,'dsh-auto-memory.json'),JSON.stringify({teamEnabled:false,memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),globalBriefEnabled:false}))
 globalThis.setInterval=globalThis.setTimeout=(callback,ms)=>{const t={callback,ms,unref(){}};timers.push(t);return t}
 apply({get:()=>undefined,on:()=>{},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}},effect:f=>{cleanup=f()}},{})
 assert.equal(engine._teamPull,undefined);assert.equal(engine._teamSync,undefined);assert.equal(engine._teamPullTimer,undefined);assert.equal(network.length,0)
 console.log('PASS #174: real host assembly, auth/object body, failed queue, scheduled pull/injection, GET read-only, pause/reset, live config and off gate')
} finally {
 globalThis.fetch=fetch;globalThis.setTimeout=timeout;globalThis.setInterval=interval;MemoryEngine.prototype.loadConfigSync=load
 if(cleanup)cleanup();for(const [k,prev]of handlers)for(const h of process.listeners(k))if(!prev.has(h))process.removeListener(k,h)
 if(home===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=home
 await rm(root,{recursive:true,force:true})
}
