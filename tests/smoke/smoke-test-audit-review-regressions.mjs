import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MemoryEngine } from '../lib/audit-engine.mjs'
import { withCalendarLock } from '../../lib/calendar-lock.js'
import { createScopedHubIoPre } from '../../lib/hub-io.js'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { buildPackPre, validatePackPre, rewritePackForTargetPre } from '../../lib/migrate-pack.js'
import { legacyWorkspaceKey } from '../../lib/workspace-key.js'
import { canonicalize, CorpusRegistry, buildSourceCatalog } from '../../lib/m4-corpus.js'
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-review-'))
const previous = process.env.DSH_HOME; process.env.DSH_HOME = root
try {
 const engine = new MemoryEngine(); engine.configLoaded = true
 Object.assign(engine.config, { memoryRoot: path.join(root,'memory'), userMemoryDir: path.join(root,'user'), memoryAnchorEnabled:true, externalSources: { 'project-conventions': true } })
 engine._configPath = path.join(root,'config.json');engine.refresh = async () => {}
 await mkdir(engine.userDirOf(), {recursive:true}); await writeFile(path.join(engine.userDirOf(),'CALENDAR.md'),'## 2026-10-02\n- [ ] --:-- | 未分类 | 本机记录')
 await writeFile(engine._configPath,JSON.stringify(engine.config))
 // Concurrent unrelated config patches preserve both fields on disk and in memory.
 await Promise.all([engine.saveConfig({ greetingEnabled: false }),engine.saveConfig({ autoConsolidate:false })])
 let saved = JSON.parse(await readFile(engine._configPath,'utf8'))
 assert.equal(saved.greetingEnabled,false);assert.equal(saved.autoConsolidate,false)
 // Same physical directory through a symlink must not acquire its own lock twice.
 if (process.platform !== 'win32') {
  const link = path.join(root,'user-alias');await symlink(engine.userDirOf(),link,'dir')
  await engine.saveConfig({userMemoryDir:link}); assert.equal(engine.config.userMemoryDir,link)
 }
 // Import resolved before a config move waits on the old lock, then retries the current path.
 let release, entered;const ready = new Promise(r=>{entered=r})
 const oldUser=engine.userDirOf(), nextUser=path.join(root,'next-user')
 const held=withCalendarLock(path.join(oldUser,'CALENDAR.md'),async()=>{entered();await new Promise(r=>{release=r})})
 await ready
 const moving=engine.saveConfig({userMemoryDir:nextUser})
 await new Promise(r=>setTimeout(r,20))
 const importing=engine._applyUserFilesPre({userFiles:{'CALENDAR.md':'## 2026-10-02\n- [ ] --:-- | 未分类 | 导入记录'}})
 release();await held;await moving; const imported=await importing
 assert.equal(imported.skipped.length,0)
 assert.ok(engine.parseCalendar(await readFile(path.join(nextUser,'CALENDAR.md'),'utf8')).some(r=>r.title==='导入记录'))
 // Historical pack really uses the old flattened slug; the format/checksum stay v1.
 const from=path.join(root,'Old-Project'),to=path.join(root,'new','project'),slug=legacyWorkspaceKey(from)
 const pack=buildPackPre({ws:from,files:{'MEMORY.md':`root=${from}\nsidecar=/memory/${slug}/hub`},now:1}).pack
 pack.source.slug=slug;assert.equal(validatePackPre(pack).ok,true)
 const rewrite=rewritePackForTargetPre(pack,{targetWs:to});assert.ok(rewrite.files['MEMORY.md'].includes(engine.wsKey(to)))
 assert.ok(!rewrite.files['MEMORY.md'].includes(slug));assert.deepEqual(rewritePackForTargetPre(pack,{targetWs:from}).files,pack.files)
 pack.source.slug='../../forged';assert.ok(validatePackPre(pack).errors.includes('invalid-source-slug'))
 // Existing destination without migration proof never suppresses ownership warning.
 const ws=path.join(root,'existing'),legacy=path.join(engine.config.memoryRoot,legacyWorkspaceKey(ws)),target=engine.projectDirOf(ws)
 await mkdir(legacy,{recursive:true});await mkdir(target,{recursive:true})
 await writeFile(path.join(legacy,'.workspace-owner.json'),JSON.stringify({workspace:ws}))
 await writeFile(path.join(legacy,'MEMORY.md'),'old intact');await writeFile(path.join(target,'MEMORY.md'),'new intact')
 await engine.migrateLegacy(ws,target);assert.match(engine.state.workspaceMigrationWarning,/旧数据尚未迁移/)
 assert.equal(await readFile(path.join(legacy,'MEMORY.md'),'utf8'),'old intact');assert.equal(await readFile(path.join(target,'MEMORY.md'),'utf8'),'new intact')
 // Real scoped IO: successful scope transfer must override stale in-memory scope.
 let current=path.join(root,'Project-A'), fail=false
 engine.state.ws=current
 const io=createScopedHubIoPre({globalDir:path.join(root,'hub-global'),resolveWorkspace:()=>({dir:path.join(engine.projectDirOf(current),'hub'),key:engine.wsKey(current)})})
 const store=createProcedureStorePre({io:{load:()=>io.load(),save:s=>{if(fail)throw new Error('disk fault');return io.save(s)}},get workspaceRef(){return engine.wsKey(current)}})
 const row=store.observe({title:'test skill',triggerPattern:'test',steps:['step'],successCriteria:['pass'],sourceMemoryIds:[],scope:'global',workspaceRef:''}).procedure
 engine._memoryHub={stores:{procedures:store}};engine._scopedProcedureIo=io
 assert.equal(io.migrate([{procedureId:row.procedureId,scope:'workspace',workspaceRef:engine.wsKey(current)}]).ok,true)
 engine.rehydrateProcedureScopes({authoritativeIds:[row.procedureId]})
 assert.equal(store.get(row.procedureId).scope,'workspace')
 // A failed disable remains in memory across A→B→A, then persists when IO recovers.
 fail=true;store.deprecate(row.procedureId,'disabled after write failure')
 current=path.join(root,'Project-B');engine.state.ws=current;engine.rehydrateProcedureScopes();assert.equal(store.query().length,0)
 current=path.join(root,'Project-A');engine.state.ws=current;engine.rehydrateProcedureScopes()
 assert.equal(store.get(row.procedureId).stage,'deprecated');fail=false;store.touch(row.procedureId)
 assert.equal(io.load().procedures.find(p=>p.procedureId===row.procedureId).stage,'deprecated')
 const restarted=createProcedureStorePre({io});restarted.restore(io.load());assert.equal(restarted.get(row.procedureId).stage,'deprecated')
 // Nonempty production corpus + actual Tier projection, including Windows casing.
 for (const workspace of [current,'D:\\Project-A']) {
  const agent={session:{id:'tier-'+workspace,header:{cwd:workspace}}}
  await engine.withAgent(agent,async()=>{
   engine.state.ws=workspace;engine.state.notesPath=path.join(root,'tier-notes.md');engine.state.notesText='## 流程\n项目使用可复现的构建流程。'
   await engine.docStore.append(engine.state.notesPath,engine.state.notesText)
   engine.state.notesText=await readFile(engine.state.notesPath,'utf8')
   const corpus=new CorpusRegistry({sidecarDir:path.join(root,'memory/index/files')}).get(buildSourceCatalog({workspaceKey:canonicalize(workspace),workspaceMemoryPath:engine.state.notesPath})).snapshot
   assert.ok(corpus.records.length>0)
   engine._tierGateHitsBySession=new Map([[agent.session.id,{at:Date.now(),sessionId:agent.session.id,workspaceKey:canonicalize(workspace),contextVersion:engine.runtimeFor(agent).contextVersion,miv:corpus.memoryIndexVersion,observationId:'obs-proof',question:'如何构建',hits:[{memoryId:corpus.records[0].memoryId,score:.9,excerpt:'构建流程',layer:'project'}]}]])
   engine.buildTierLayerInjection(agent);assert.equal(engine.state.tier0Meta.reuse.ok,true,JSON.stringify(engine.state.tier0Meta))
  })
 }
 // External scans/cache partition by actual engine identity, even while A scan is in flight.
 const a=path.join(root,'external-A'),b=path.join(root,'external-B')
 await mkdir(a);await mkdir(b);await writeFile(path.join(a,'CLAUDE.md'),'only A');await writeFile(path.join(b,'CLAUDE.md'),'only B')
 engine.state.ws=a;const scanA=engine.external.discover(true);engine.state.ws=b;const scanB=engine.external.discover(true)
 const [ca,cb]=await Promise.all([scanA,scanB]);assert.ok(ca.some(s=>s.content.includes('only A')));assert.ok(!cb.some(s=>s.content.includes('only A')))
 assert.ok(cb.some(s=>s.content.includes('only B')));assert.equal(engine.external.cache,cb)
 engine.state.ws=a;assert.equal(await engine.external.discover(false),ca)
 Object.assign(engine.config,{globalBriefEnabled:true,globalBriefWatchMemory:false,globalBriefWatchDocs:false,globalBriefWatchExternal:true})
 engine.external.briefDetectSyncPre();engine.state.ws=b;engine.external.briefDetectSyncPre()
 assert.ok(Object.keys(engine._briefWatermarks.get(engine.wsKey(b))).some(p=>p.startsWith(b)))
 assert.ok(!Object.keys(engine._briefWatermarks.get(engine.wsKey(b))).some(p=>p.startsWith(a)))
 assert.ok(!JSON.stringify(engine._briefSnapshots.get(engine.wsKey(b))).includes(a))
 // A quota reached on the first line must not read a second multi-MiB line.
 const jsonl=path.join(root,'quota.jsonl')
 await writeFile(jsonl,JSON.stringify({type:'user',content:[{type:'text',text:'first'}]})+'\n'+JSON.stringify({type:'user',content:[{type:'text',text:'x'.repeat(2*1024*1024)}]}))
 const originalStream=fs.createReadStream;let stream
 try {
  fs.createReadStream=(...args)=>{stream=originalStream(...args);return stream};syncBuiltinESMExports()
  assert.match(await engine.external.extractSessionText(jsonl,1,10000),/first/)
  await new Promise(r=>setImmediate(r));assert.ok(stream.bytesRead<256*1024,'quota consumes at most bounded stream read-ahead, not the giant next line')
 } finally {fs.createReadStream=originalStream;syncBuiltinESMExports()}
 // Real sidecar write supports legal prototype-name tag and cue values.
 const rich={id:'mem_prototype',source:'PLAN.md',title:'keys',tags:['constructor','toString','__proto__'],cues:['constructor','toString','__proto__'],preview:'body',kind:'plan'}
 const index=await engine._writeSidecarIndexPre(root,{entries:[rich]})
 for(const k of rich.tags){assert.deepEqual(index.by_tag[k],[rich.id]);assert.deepEqual(index.by_cue[k],[rich.id])}
 console.log('PASS review regressions: config serialization/alias, calendar move/import, legacy pack/destination, transfer/failed-save preservation, Tier production reuse, external workspace cache, prototype cues')
} finally {await rm(root,{recursive:true,force:true});if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous}
// The real apply() registers the debug route; mount DebugCenter through that transport.
const { apply, API } = await import('../lib/audit-engine.mjs')
const ui = await readFile(new URL('../../lib/client.js',import.meta.url),'utf8')
const root2=await mkdtemp(path.join(os.tmpdir(),'dam-debug-route-'))
const priorHome=process.env.DSH_HOME;process.env.DSH_HOME=root2
const originals={};for(const name of ['refresh','checkUpdate','fetchNotices']){originals[name]=MemoryEngine.prototype[name];MemoryEngine.prototype[name]=async()=>name==='fetchNotices'?[]:{}}
const interval=globalThis.setInterval,timeout=globalThis.setTimeout
let cleanup;const routes=[]
const handlers=new Map(['uncaughtException','unhandledRejection','exit'].map(name=>[name,new Set(process.listeners(name))]))
try {
 globalThis.setInterval=globalThis.setTimeout=()=>({unref(){}})
 apply({get:()=>undefined,on:()=>{},systemPrompt:{context:()=>()=>{},section:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}},effect:f=>{cleanup=f()}},{})
 globalThis.setInterval=interval;globalThis.setTimeout=timeout
 for(const [event,previous] of handlers)for(const listener of process.listeners(event))if(!previous.has(listener))process.removeListener(event,listener)
 for(const [key,value] of Object.entries(originals))MemoryEngine.prototype[key]=value
 const {flushDiagnostics}=await import('../lib/audit-engine.mjs');await flushDiagnostics()
 async function tree(dir){const files={};for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())Object.assign(files,await tree(f));else files[f]=await readFile(f,'utf8')}return files}
 const before=await tree(root2);const calls=[]
 const transport=async(url,opts={})=>{
  const route=routes.find(r=>r.path===url);assert.ok(route,'real registered route '+url)
  let status,data
  await route.handler({method:opts.method||'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1'}},{writeHead:s=>{status=s},end:raw=>{data=JSON.parse(raw)},setHeader:()=>{}})
  calls.push({url,status});return{status,json:async()=>data}
 }
 const a=ui.indexOf('    function DebugCenter() {'),b=ui.indexOf('\n    function ',a+30)
 new Function('useState','useEffect','h','t','API','fetch','apiGet',ui.slice(a,b)+'\nreturn DebugCenter()')(x=>[x,()=>{}],f=>f(),()=>null,x=>x,API,transport,transport)
 for(let n=0;n<30&&calls.length===0;n++)await new Promise(r=>setTimeout(r,10))
 assert.deepEqual(calls,[{url:API.debug,status:200}]);assert.deepEqual(await tree(root2),before)
 console.log('PASS real DebugCenter → registered debug GET: 200, filesystem unchanged, no business probes')
} finally {
 globalThis.setInterval=interval;globalThis.setTimeout=timeout
 for(const [event,previous] of handlers)for(const listener of process.listeners(event))if(!previous.has(listener))process.removeListener(event,listener)
 for(const [key,value] of Object.entries(originals))MemoryEngine.prototype[key]=value
 cleanup?.();await rm(root2,{recursive:true,force:true});if(priorHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=priorHome
}
