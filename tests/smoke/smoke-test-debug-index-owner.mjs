// Complete production apply/refresh/routes, with deterministic IO-entry barriers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dam-debug-owner-'))
const oldEnv={HOME:process.env.HOME,DSH_HOME:process.env.DSH_HOME}
process.env.HOME=root;process.env.DSH_HOME=path.join(root,'home')
fs.mkdirSync(process.env.DSH_HOME,{recursive:true})
const memoryRoot=path.join(root,'memory'),user=path.join(root,'user')
fs.writeFileSync(path.join(process.env.DSH_HOME,'dsh-auto-memory.json'),JSON.stringify({memoryRoot,userMemoryDir:user,memoryFileIndexEnabled:true,l0IndexEnabled:false,externalSources:{},greetingEnabled:false,autoConsolidate:false,pythonBackendEnabled:false}))
const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('external request prohibited')}
const {MemoryEngine,apply,API,flushDiagnostics}=await import('../lib/audit-engine.mjs')
const original={};const tickets=[],events=new Map(),routes=[],registry={list:()=>[]};let engine,cleanup
const listeners=new Map(['uncaughtException','unhandledRejection','exit'].map(k=>[k,new Set(process.listeners(k))]))
const timers={setInterval:globalThis.setInterval,setTimeout:globalThis.setTimeout}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const announced=[]
for(const key of ['loadConfigSync','refresh','_doRefresh','checkUpdate','fetchNotices'])original[key]=MemoryEngine.prototype[key]
MemoryEngine.prototype.loadConfigSync=function(){engine=this;return original.loadConfigSync.call(this)}
MemoryEngine.prototype.checkUpdate=async()=>({});MemoryEngine.prototype.fetchNotices=async()=>[]
MemoryEngine.prototype.refresh=function(agent){
 const ticket={agent,entered:deferred(),release:deferred()};tickets.push(ticket)
 ticket.result=original.refresh.call(this,agent)
 for(const notify of announced.splice(0))notify()
 return ticket.result
}
MemoryEngine.prototype._doRefresh=async function(agent){
 const ticket=tickets.find(t=>t.agent===agent&&!t.started);assert.ok(ticket);ticket.started=true;ticket.entered.resolve()
 await ticket.release.promise
 return original._doRefresh.call(this,agent)
}
const request=async(method,url,body,owner)=>{
 const route=routes.find(r=>r.path===url);assert.ok(route)
 let status,data
 const run=()=>route.handler({method,url,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1',origin:'http://127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body||{}))}},
  {writeHead:s=>status=s,end:s=>data=JSON.parse(s),setHeader(){}})
 if(owner)await engine._runtimeContext.run(engine.peekRuntime(owner),run);else await run()
 return {status,data}
}
const start=async agent=>{
 const before=tickets.length
 assert.equal(events.get('agent/session-start')({agent,source:'fresh'}),undefined,'lifecycle event is fire-and-forget')
 const ticket=tickets[before];assert.ok(ticket);await ticket.entered.promise;return ticket
}
const finish=async ticket=>{ticket.release.resolve();await ticket.result;await flushDiagnostics()}
const snapshot=dir=>Object.fromEntries(fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{
 const file=path.join(dir,e.name);return e.isDirectory()?Object.entries(snapshot(file)):[[file,fs.readFileSync(file).toString('base64')]]
}))
let checks=0;const failures=[]
const check=async(name,ws,owner)=>{
 await flushDiagnostics();const before=snapshot(root),count=engine.runtimes.values().length
 const loaded=engine.configLoaded;engine.configLoaded=false
 const saved={},called=[]
 for(const key of ['loadConfig','loadConfigSync','resolvePaths','migrateLegacy','saveConfig','refresh','runtimeFor']){
  saved[key]=engine[key];engine[key]=()=>{called.push(key);throw Error('diagnostic invoked '+key)}
 }
 const writes=[],native={},nativeAsync={}
 for(const key of ['writeFileSync','appendFileSync','renameSync','mkdirSync','unlinkSync']){
  native[key]=fs[key];fs[key]=(...args)=>{writes.push(key);return native[key](...args)}
 }
 for(const key of ['writeFile','appendFile','rename','mkdir','unlink','copyFile']){nativeAsync[key]=fsp[key];fsp[key]=(...args)=>{writes.push(key);return nativeAsync[key](...args)}}
 syncBuiltinESMExports()
 try{
  const view=await request('GET',API.debug,null,owner)
  assert.equal(view.status,200);assert.deepEqual(called,[]);assert.deepEqual(writes,[])
  assert.equal(engine.runtimes.values().length,count);assert.deepEqual(snapshot(root),before)
  const index=view.data.associativeMemory.memoryIndex;assert.equal(index.enabled,true);assert(index.files.length>0)
  for(const f of index.files)assert.equal(f.ownerWs,ws,name+' owner: '+f.sourceFile)
  assert(index.files.some(f=>f.sourceFile===path.join(engine.projectDirOf(ws),'MEMORY.md')),name+' uses owner project file')
  checks++;console.log('PASS '+name)
 }catch(e){failures.push(name+': '+e.message);console.error('FAIL '+name+': '+e.message)}
 finally{
  for(const [key,value]of Object.entries(saved))engine[key]=value
  for(const [key,value]of Object.entries(native))fs[key]=value
  for(const [key,value]of Object.entries(nativeAsync))fsp[key]=value
  syncBuiltinESMExports();engine.configLoaded=loaded
 }
}
try{
 globalThis.setInterval=globalThis.setTimeout=()=>({unref(){}})
 apply({get:name=>name==='workspaceRegistry'?registry:undefined,on:(name,fn)=>{events.set(name,fn);return()=>{}},effect:fn=>cleanup=fn(),systemPrompt:{section:()=>()=>{},context:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}}},{})
 Object.assign(globalThis,timers)
 const startup=tickets[0];await startup.entered.promise
 const make=(id)=>({id,session:{id:'session-'+id,header:{id:'session-'+id,cwd:path.join(root,id)},events:[]}})
 const a=make('a'),b=make('b')
 for(const agent of [a,b]){
  fs.mkdirSync(agent.session.header.cwd,{recursive:true})
  const dir=engine.projectDirOf(agent.session.header.cwd);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'MEMORY.md'),'## '+agent.id+'\n- owner '+agent.id+'\n')
 }
 fs.mkdirSync(user,{recursive:true});fs.writeFileSync(path.join(user,'MEMORY.md'),'## shared\n- fixture\n')
 const ta=await start(a),tb=await start(b)
 await finish(ta);assert.equal(engine.state.ws,a.session.header.cwd);assert.equal(engine._lastAgent,b)
 assert.ok(!engine.peekRuntime(b).state.ws,'B has not published a workspace')
 await check('B pending while A has mirrored',b.session.header.cwd)
 await finish(tb);await check('B completed',b.session.header.cwd)
 const ta2=await start(a),tb2=await start(b)
 await finish(tb2);await finish(ta2)
 assert.equal(engine.state.ws,a.session.header.cwd,'forced late A mirror');assert.equal(engine._lastAgent,b)
 await check('B completed before A; both truly finished',b.session.header.cwd)
 await finish(startup);assert.equal(engine.state.ws,a.session.header.cwd)
 await check('startup default refresh finishes last',b.session.header.cwd)
 const before=tickets.length,registered=deferred();announced.push(registered.resolve)
 const config=request('POST',API.config,{memoryFileIndexEnabled:true})
 await registered.promise;const configTicket=tickets[before];await configTicket.entered.promise
 const ta3=await start(a),tb3=await start(b);await finish(tb3);await finish(ta3)
 await check('configuration default refresh still pending',b.session.header.cwd)
 await finish(configTicket);assert.equal((await config).status,200)
 await check('configuration default refresh finishes last',b.session.header.cwd)
 await check('ALS owner A overrides last agent B',a.session.header.cwd,a)
 delete b.session.header.cwd
 await check('existing B runtime binds owner without header cwd',path.join(root,'b'))
 const locked=path.join(root,'locked-b');fs.mkdirSync(engine.projectDirOf(locked),{recursive:true});fs.writeFileSync(path.join(engine.projectDirOf(locked),'MEMORY.md'),'## locked\n- fixture\n')
 engine.peekRuntime(b).wsLocked=locked;engine.config.unattendedMode=true
 await check('unattended owner retains its existing workspace lock',locked)
 engine.config.unattendedMode=false
 await check('manual mode ignores the old unattended lock',path.join(root,'b'))
 const c=make('c'),cwd=c.session.header.cwd;fs.mkdirSync(cwd,{recursive:true});fs.mkdirSync(engine.projectDirOf(cwd),{recursive:true});fs.writeFileSync(path.join(engine.projectDirOf(cwd),'MEMORY.md'),'## C\n- fixture\n');delete c.session.header.cwd
 registry.list=()=>[{path:cwd,sessionIds:[c.session.id]}];await start(c)
 await check('pending headerless owner resolves existing registry binding readonly',cwd)
 console.log('debug owner barriers: '+checks+' PASS / '+failures.length+' FAIL')
 assert.deepEqual(failures,[])
}finally{
 for(const t of tickets)t.release.resolve()
 await Promise.allSettled(tickets.map(t=>t.result));await flushDiagnostics()
 if(cleanup)cleanup();Object.assign(globalThis,timers);globalThis.fetch=oldFetch
 for(const [key,value]of Object.entries(original))MemoryEngine.prototype[key]=value
 for(const [event,prior]of listeners)for(const listener of process.listeners(event))if(!prior.has(listener))process.removeListener(event,listener)
 fs.rmSync(root,{recursive:true,force:true})
 for(const [key,value]of Object.entries(oldEnv))if(value===undefined)delete process.env[key];else process.env[key]=value
}
