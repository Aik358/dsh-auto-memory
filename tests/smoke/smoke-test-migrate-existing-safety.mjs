// Complete production apply + migration routes; filesystem and home are isolated.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { test } from 'node:test'
const root=await fsp.mkdtemp(path.join(os.tmpdir(),'dam-migrate-safety-'))
const cwd=process.cwd(), env={HOME:process.env.HOME,DSH_HOME:process.env.DSH_HOME}
process.chdir(root);process.env.HOME=root;process.env.DSH_HOME=path.join(root,'home')
await fsp.mkdir(process.env.DSH_HOME,{recursive:true})
await fsp.writeFile(path.join(process.env.DSH_HOME,'dsh-auto-memory.json'),JSON.stringify({memoryRoot:path.join(root,'memory'),userMemoryDir:path.join(root,'user'),globalBriefEnabled:false,l0IndexEnabled:false,externalSources:{},autoConsolidate:false,greetingEnabled:false,pythonBackendEnabled:false}))
const {apply,MemoryEngine,API,flushDiagnostics}=await import('../lib/audit-engine.mjs')
const {buildPackPre}=await import('../../lib/migrate-pack.js')
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
const request=async(key,body)=>{let status,data;const route=routes.find(r=>r.path===API[key]);assert.ok(route);await route.handler({method:'POST',url:API[key],socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1',origin:'http://127.0.0.1'},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body))}},{setHeader(){},writeHead:s=>status=s,end:s=>data=JSON.parse(s)});assert.equal(status,200);return data}
let sequence=0
const fixture=async(files,incoming)=>{const ws=path.join(root,'ws-'+(++sequence));await fsp.mkdir(ws);const dir=engine.projectDirOf(ws);await fsp.mkdir(dir,{recursive:true});for(const [name,text]of Object.entries(files)){await fsp.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fsp.writeFile(path.join(dir,name),text)}const packPath=path.join(root,'pack-'+sequence);await fsp.writeFile(packPath,JSON.stringify(buildPackPre({ws,files:incoming}).pack));return {ws,dir,packPath}}
const inspect=async(f,onConflict)=>request('migrate-inspect',{packPath:f.packPath,targetWs:f.ws,onConflict})
const importPack=async(f,onConflict,previewToken)=>request('migrate-import',{packPath:f.packPath,targetWs:f.ws,onConflict,previewToken})
const large='original\n'+'x'.repeat(9*1024*1024)
try{
 apply({get:()=>undefined,on:()=>()=>{},effect:f=>cleanup=f(),systemPrompt:{section:()=>()=>{},context:()=>()=>{}},tools:{register:()=>()=>{}},webServer:{register:r=>{routes.push(r);return()=>{}}}},{})
 Object.assign(globalThis,timers);await drain()
 await test('real export accepts a 9MiB file and default reimport preserves a different local version',async()=>{
  const f=await fixture({'MEMORY.md':large},{'MEMORY.md':'unused fixture pack'})
  const exported=await request('migrate-export',{ws:f.ws,outPath:path.join(root,'exported.dam-pack'),compress:false});assert.equal(exported.ok,true);assert.equal(exported.stats.fileCount,1)
  f.packPath=exported.path;const local='local owner\n'+large
  await fsp.writeFile(path.join(f.dir,'MEMORY.md'),local)
  const view=await inspect(f);const result=await importPack(f,undefined,view.previewToken);assert.equal(result.ok,true)
  assert.equal(await fsp.readFile(path.join(f.dir,'MEMORY.md'),'utf8'),local);assert.equal(await fsp.readFile(path.join(result.backup,'MEMORY.md'),'utf8'),local)
 })
 await test('formal import writes correct Windows owner and procedure path values',async()=>{
  const ws='D:\\temp\\new',source='/home/u/project',packPath=path.join(root,'json-pack')
  const raw=JSON.stringify({workspace:source,steps:[source+'/task'],literal:'tab\t and newline\n'})
  await fsp.writeFile(packPath,JSON.stringify(buildPackPre({ws:source,files:{'.workspace-owner.json':raw,'hub/procedures.json':raw,'history.jsonl':raw+'\n'}}).pack))
  const f={ws,packPath,dir:engine.projectDirOf(ws)},view=await inspect(f)
  assert.equal(view.ok,true);const result=await importPack(f,undefined,view.previewToken);assert.equal(result.ok,true)
  for(const name of ['.workspace-owner.json','hub/procedures.json','history.jsonl']){const value=JSON.parse(await fsp.readFile(path.join(f.dir,name),'utf8'));assert.equal(value.workspace,ws);assert.deepEqual(value.steps,[ws+'/task']);assert.equal(value.literal,'tab\t and newline\n')}
 })
 await test('default keep preserves both 9MiB files and creates a complete backup',async()=>{
  // Keep the legacy pack key so this still exercises legacy-to-current key
  // rewriting. JSONL inputs must be valid for the existing token rewrite.
  const incomingHistory=JSON.stringify({text:'incoming history'})+'\n'
  assert.deepEqual(JSON.parse(incomingHistory),{text:'incoming history'})
  const f=await fixture({'MEMORY.md':large,'history.jsonl':large},{'MEMORY.md':'incoming','history.jsonl':incomingHistory})
  const view=await inspect(f);assert.equal(view.ok,true)
  const result=await importPack(f,undefined,view.previewToken);assert.equal(result.ok,true)
  for(const name of ['MEMORY.md','history.jsonl'])assert.equal(await fsp.readFile(path.join(f.dir,name),'utf8'),large)
  assert.ok(result.backup);for(const name of ['MEMORY.md','history.jsonl'])assert.equal(await fsp.readFile(path.join(result.backup,name),'utf8'),large)
 })
 await test('rename reserves large backup names and preserves all originals',async()=>{
  const f=await fixture({'MEMORY.md':large,'MEMORY.from-pack.md':large},{'MEMORY.md':'incoming'})
  const view=await inspect(f,'rename');const result=await importPack(f,'rename',view.previewToken);assert.equal(result.ok,true)
  assert.equal(await fsp.readFile(path.join(f.dir,'MEMORY.md'),'utf8'),large);assert.equal(await fsp.readFile(path.join(f.dir,'MEMORY.from-pack.md'),'utf8'),large)
  assert.equal(await fsp.readFile(path.join(f.dir,'MEMORY.from-pack-2.md'),'utf8'),'incoming')
 })
 await test('same-size large-file changes invalidate the preview token',async()=>{
  const f=await fixture({'MEMORY.md':large},{'MEMORY.md':'incoming'})
  const view=await inspect(f);await fsp.writeFile(path.join(f.dir,'MEMORY.md'),'modified\n'+large.slice(9))
  const result=await importPack(f,undefined,view.previewToken);assert.equal(result.ok,false);assert.equal(result.error,'preview-stale')
 })
 await test('explicit overwrite of a large file keeps its full backup',async()=>{
  const f=await fixture({'MEMORY.md':large},{'MEMORY.md':'explicit replacement'})
  const view=await inspect(f,'overwrite');assert.equal(view.plan.overwrites[0].oldBytes,Buffer.byteLength(large))
  const result=await importPack(f,'overwrite',view.previewToken);assert.equal(result.ok,true)
  assert.equal(await fsp.readFile(path.join(f.dir,'MEMORY.md'),'utf8'),'explicit replacement')
  assert.equal(await fsp.readFile(path.join(result.backup,'MEMORY.md'),'utf8'),large)
 })
 await test('unreadable existing file is rejected, never interpreted as absent',async()=>{
  const f=await fixture({'MEMORY.md':'preserve'},{'MEMORY.md':'incoming'}),read=fsp.readFile
  const preview=await inspect(f)
  fsp.readFile=async(file,...args)=>{if(String(file)===path.join(f.dir,'MEMORY.md'))throw Object.assign(Error('injected permission denial'),{code:'EACCES'});return read(file,...args)};syncBuiltinESMExports()
  try{const view=await inspect(f);assert.equal(view.ok,false);assert.match(JSON.stringify(view),/EACCES|permission|unreadable/);const result=await importPack(f,undefined,preview.previewToken);assert.equal(result.ok,false);assert.equal(result.error,'target-inspection-failed')}finally{fsp.readFile=read;syncBuiltinESMExports()}
  assert.equal(await fsp.readFile(path.join(f.dir,'MEMORY.md'),'utf8'),'preserve')
 })
 await test('addition created after inventory cannot be overwritten at commit',async()=>{
  const f=await fixture({'MEMORY.md':'local'},{'fresh.md':'incoming'}),copy=engine.copyDir
  const view=await inspect(f)
  engine.copyDir=async function(...args){await copy.apply(this,args);await fsp.writeFile(path.join(f.dir,'fresh.md'),'concurrent owner')}
  // 批次 X 适配:本树弃用 PR 的 wx 临时件+link()(网络盘 EPERM 风险),additions 走
  // lstat 确认空闲 → 原子写;并发占用在 commit 时以 target-changed fail closed 拒绝。
  try{const result=await importPack(f,undefined,view.previewToken);assert.equal(result.ok,false);assert.equal(result.error,'write-failed');assert.match(result.detail,/target-changed/)}finally{engine.copyDir=copy}
  assert.equal(await fsp.readFile(path.join(f.dir,'fresh.md'),'utf8'),'concurrent owner')
 })
 await test('a rename reservation appearing after preview invalidates its token',async()=>{
  const f=await fixture({'MEMORY.md':'local'},{'MEMORY.md':'incoming'}),view=await inspect(f,'rename')
  await fsp.writeFile(path.join(f.dir,'MEMORY.from-pack.md'),large)
  const result=await importPack(f,'rename',view.previewToken);assert.equal(result.ok,false);assert.equal(result.error,'preview-stale')
  assert.equal(await fsp.readFile(path.join(f.dir,'MEMORY.from-pack.md'),'utf8'),large)
 })
 await test('large PLAN overwrite uses its descriptor revision and keeps a complete backup',async()=>{
  const f=await fixture({'handoff/PLAN.md':large},{'handoff/PLAN.md':'## revised PLAN\n'})
  const view=await inspect(f,'overwrite'),result=await importPack(f,'overwrite',view.previewToken)
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(await fsp.readFile(path.join(f.dir,'handoff/PLAN.md'),'utf8'),'## revised PLAN\n')
  assert.equal(await fsp.readFile(path.join(result.backup,'handoff/PLAN.md'),'utf8'),large)
 })
 await test('large PLAN changed after planning emits a real revision conflict',async()=>{
  const f=await fixture({'handoff/PLAN.md':large},{'handoff/PLAN.md':'## proposed\n'}),copy=engine.copyDir,view=await inspect(f,'overwrite')
  const target=path.join(f.dir,'handoff/PLAN.md'),changed=large+'\nexternal edit\n'
  engine.copyDir=async function(src,...args){await copy.call(this,src,...args);if(src===f.dir)await fsp.writeFile(target,changed)}
  try{const result=await importPack(f,'overwrite',view.previewToken);assert.equal(result.ok,false);assert.match(result.detail,/plan-import-preview-conflict/);assert.equal(result.written.length,0)}finally{engine.copyDir=copy}
  assert.equal(await fsp.readFile(target,'utf8'),changed)
  const dir=path.join(f.dir,'handoff/conflicts'),files=await fsp.readdir(dir);assert.equal(files.length,1)
  const conflict=JSON.parse(await fsp.readFile(path.join(dir,files[0]),'utf8'));assert.equal(conflict.current,changed);assert.equal(conflict.proposed,'## proposed\n');assert.match(conflict.expectedRevision,/^[a-f0-9]{64}$/)
 })
 // 批次 X 适配:本树 additions 不用 wx 临时件+link(),无 temp-cleanup 清理面,
 // PR 对应用例(临时件清理失败仍记 committed)随之不适用,予以剔除。
 await test('committed overwrite remains reported when lock release fails',async()=>{
  const f=await fixture({'MEMORY.md':'original'}, {'MEMORY.md':'committed replacement'}),view=await inspect(f,'overwrite'),unlink=fs.unlinkSync
  // 批次 X 适配:Windows 下 shared-state-lock 的 canonicalSharedStatePath 会把临时目录的
  // 8.3 短名展开成长路径,按全路径匹配注入会脱靶 ⇒ 改按唯一后缀匹配;lock 残留由外层
  // root 清理兜底,finally 的定向 unlink 允许 ENOENT(短路径上本就不存在)。
  fs.unlinkSync=function(file,...args){const s=String(file);if(s.endsWith('MEMORY.md.lock')&&!s.endsWith('.acquire'))throw Object.assign(Error('injected lock release failure'),{code:'EPERM'});return unlink(file,...args)};syncBuiltinESMExports()
  try{const result=await importPack(f,'overwrite',view.previewToken);assert.equal(result.ok,false);assert.equal(result.written.length,1);assert.equal(result.written[0].path,'MEMORY.md');assert.equal(result.cleanupErrors[0].stage,'lock-release')}finally{fs.unlinkSync=unlink;syncBuiltinESMExports();await fsp.rm(path.join(f.dir,'MEMORY.md.lock'),{force:true})}
  assert.equal(await fsp.readFile(path.join(f.dir,'MEMORY.md'),'utf8'),'committed replacement')
 })
}finally{
 await drain();if(cleanup)cleanup();await flushDiagnostics()
 for(const [key,value]of Object.entries(methods))MemoryEngine.prototype[key]=value
 Object.assign(globalThis,timers);globalThis.fetch=oldFetch
 for(const [k,prev]of listeners)for(const h of process.listeners(k))if(!prev.has(h))process.removeListener(k,h)
 process.chdir(cwd);for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value}
 await fsp.rm(root,{recursive:true,force:true})
}
