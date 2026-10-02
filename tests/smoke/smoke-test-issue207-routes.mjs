import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply, API, MemoryEngine, flushDiagnostics } from '../lib/state-engine.mjs'
import { continuedSourceFile } from '../../lib/continuation-state.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dam-207-routes-')),workspace=path.join(root,'workspace')
const oldEnv={HOME:process.env.HOME,DSH_HOME:process.env.DSH_HOME},routes=[],listeners=new Map(['uncaughtException','unhandledRejection','exit'].map(k=>[k,new Set(process.listeners(k))]))
const interval=globalThis.setInterval,timeout=globalThis.setTimeout,fetch=globalThis.fetch,load=MemoryEngine.prototype.loadConfigSync,rename=fs.renameSync
let engine,cleanup,creates=0,denyCounter=false,denyFinal=false,failDelivery=false
process.env.HOME=root;process.env.DSH_HOME=root
fs.mkdirSync(workspace,{recursive:true})
fs.writeFileSync(path.join(root,'dsh-auto-memory.json'),JSON.stringify({memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),handoffEnabled:false,autoContinueEnabled:true,teamEnabled:false,externalSources:{}}))
function session(sid) {
 const dir=path.join(root,'sessions','project',sid);fs.mkdirSync(dir,{recursive:true})
 fs.writeFileSync(path.join(dir,'session.jsonl'),[JSON.stringify({cwd:workspace,agentPreset:'default'}),JSON.stringify({type:'user/message',data:{message:{role:'user',content:[{type:'text',text:'continue isolated task'}]}}})].join('\n')+'\n')
}
function call(p,body) {
 const route=routes.find(r=>r.path===p);assert(route)
 let status,value;const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1'},url:p})
 return route.handler(req,{writeHead:s=>status=s,end:text=>value=JSON.parse(text)}).then(()=>({status,value}))
}
try {
 globalThis.setInterval=globalThis.setTimeout=()=>({unref(){}});globalThis.fetch=async()=>({ok:false,status:503,json:async()=>({})})
 MemoryEngine.prototype.loadConfigSync=function(){engine=this;return load.call(this)}
 apply({get:()=>undefined,on:()=>()=>{},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}},effect:f=>cleanup=f()},{})
 globalThis.setInterval=interval;globalThis.setTimeout=timeout;MemoryEngine.prototype.loadConfigSync=load
 assert(engine);engine.configLoaded=true
 const controller={create:async()=>({sessionId:'new-'+(++creates)}),cancel:async()=>{},rename:async()=>{},prompt:async req=>{if(req.sessionId.startsWith('new-')){if(failDelivery)throw Error('delivery result unknown');denyFinal=true}}}
 const setup=e=>{e.config={...engine.config};e.configLoaded=true;e._sessionController=controller;e.inheritPermissionForContinue=async()=>({ok:false,reason:'isolated permission service'})}
 setup(engine)
 fs.renameSync=(from,to)=>{if((denyCounter&&to===engine.contSeqFile())||(denyFinal&&to.includes('auto-continue-done.d')&&to.endsWith('.json')))throw Object.assign(new Error('isolated commit denied'),{code:'EPERM'});return rename(from,to)};syncBuiltinESMExports()
 session('session-route-source');denyCounter=true
 const refused=await call(API['handoff-continue'],{fromSessionId:'session-route-source'});assert.equal(refused.value.ok,false);assert.match(refused.value.error,/persist failed/)
 const normalRefused=await engine.decideAutoContinue('manual',null,'session-route-source');assert.equal(normalRefused.ok,false);assert.equal(creates,0)
 denyCounter=false
 const carried=await Promise.all([call(API['handoff-continue'],{fromSessionId:'session-route-source'}),call(API['handoff-continue'],{fromSessionId:'session-route-source'})])
 assert(carried.every(r=>r.status===200&&r.value.ok));assert.equal(new Set(carried.map(r=>r.value.contSeq)).size,2)
 // Actual controller delivery succeeds, but durable completion commit is denied.
 const failed=await engine.decideAutoContinue('manual',null,'session-route-source')
 assert.equal(failed.ok,false);assert.equal(failed.continuationPending,true);assert.equal(failed.sessionId,'new-1');assert.equal(creates,1)
 const marker=continuedSourceFile(engine.continuedSessionsFile(),'route-source');assert.equal(JSON.parse(fs.readFileSync(marker)).status,'pending');assert.equal(JSON.parse(fs.readFileSync(marker)).to,'new-1')
 const restarted=new MemoryEngine();setup(restarted);assert.equal(restarted.isContinuedSession('session-route-source'),true)
 const restartBlocked=await restarted.decideAutoContinue('manual',null,'session-route-source');assert.equal(restartBlocked.ok,false);assert.equal(restartBlocked.continuationPending,true);assert.equal(restartBlocked.sessionId,'new-1');assert.equal(creates,1)
 denyFinal=false
 // Explicit retry of the local completion only; no second remote delivery.
 const pending=JSON.parse(fs.readFileSync(marker));assert.equal(await restarted.markContinuedSession('session-route-source','new-1',pending.token),true)
 assert.equal(JSON.parse(fs.readFileSync(marker)).status,'done');assert.equal(new MemoryEngine().isContinuedSession('session-route-source'),true)
 // Two genuine engines may both prepare, but only one reserves the same source.
 session('session-multi-source');const other=new MemoryEngine();setup(other)
 controller.prompt=async()=>{};
 const both=await Promise.all([engine.decideAutoContinue('manual',null,'session-multi-source'),other.decideAutoContinue('manual',null,'session-multi-source')])
 assert.equal(both.filter(r=>r.ok).length,1);assert.equal(creates,2)
 // Unknown delivery errors retain a durable pending source across restart.
 session('session-unknown-source');controller.prompt=async req=>{if(req.sessionId.startsWith('new-'))throw Error('delivery result unknown')}
 const unknown=await engine.decideAutoContinue('manual',null,'session-unknown-source');assert.equal(unknown.ok,false);assert.equal(unknown.continuationPending,true);assert.equal(new MemoryEngine().isContinuedSession('session-unknown-source'),true)
 session('session-pre-effect-source');controller.create=async()=>{throw Error('create rejected before delivery')};controller.prompt=async()=>{}
 const early=await engine.decideAutoContinue('manual',null,'session-pre-effect-source');assert.equal(early.ok,false);assert.equal(new MemoryEngine().isContinuedSession('session-pre-effect-source'),false)
 controller.create=async()=>({sessionId:'new-'+(++creates)});assert.equal((await engine.decideAutoContinue('manual',null,'session-pre-effect-source')).ok,true)
 session('session-auto-source');engine._autoContState={};engine.armAutoContinue({session:{id:'session-auto-source',header:{cwd:workspace}}},{ratio:.99,modelKnown:true})
 assert.equal(engine._autoContState.armed.sessionId,'session-auto-source');engine._autoContState.armed.expiresAt=Date.now()-1
 const beforeAuto=creates;await engine.tickAutoContinue();assert.equal(creates,beforeAuto+1);assert.equal(engine.isContinuedSession('session-auto-source'),true);assert.equal(engine._autoContState.executing,false)
 console.log('PASS formal legacy routes and real host: reservation refusal, concurrent numbering, post-delivery persist fault, restart, multi-engine source and ambiguous delivery')
}finally{
 fs.renameSync=rename;syncBuiltinESMExports();MemoryEngine.prototype.loadConfigSync=load;globalThis.setInterval=interval;globalThis.setTimeout=timeout;globalThis.fetch=fetch
 try{cleanup?.()}catch{}
 for(const [k,old]of listeners)for(const fn of process.listeners(k))if(!old.has(fn))process.removeListener(k,fn)
 await flushDiagnostics();
 for(const[k,v]of Object.entries(oldEnv))if(v===undefined)delete process.env[k];else process.env[k]=v
 fs.rmSync(root,{recursive:true,force:true})
}
