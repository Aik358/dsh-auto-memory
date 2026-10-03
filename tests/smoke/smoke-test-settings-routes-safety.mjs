// Execute the shipped route handlers with an actual MemoryEngine and filesystem.
// Request/response objects and an atomic-write fault are fixtures, not a browser.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {loadPrivateEngine} from '../lib/load-private-engine.mjs'
import {validateSettingsPatch,validateSettingsPaths} from '../../lib/settings-safety.js'
import {writeTextAtomicPreSync} from '../../lib/config-io.js'
const home=await fs.mkdtemp(path.join(tmpdir(),'dsh-settings-routes-'))
const previous=process.env.DSH_HOME;process.env.DSH_HOME=home
try{
 const {MemoryEngine,DEFAULT_CONFIG,sanitizeForWrite,tailHas,writeGateRefusalTextPre}=await loadPrivateEngine()
 const engine=new MemoryEngine();engine.refresh=async()=>{}
 await fs.writeFile(engine._configPath,JSON.stringify({...DEFAULT_CONFIG,memoryRoot:path.join(home,'memory','workspaces'),userMemoryDir:path.join(home,'memory')}))
 const source=await fs.readFile(new URL('../../lib/index.js',import.meta.url),'utf8')
 function handler(marker,extra={}){
  const route=source.indexOf(marker),start=source.indexOf('handler: ',route)+9,end=source.indexOf('\n      },',start)
  assert(route>=0 && end>start)
  const env={engine,DEFAULT_CONFIG,path,readFile:fs.readFile,sanitizeForWrite,tailHas,writeGateRefusalTextPre,validateSettingsPatch,validateSettingsPaths,dshHome:()=>home,isLoopbackRequest:()=>true,readJsonBody:async req=>req.body,writeJson:(res,status,body)=>{res.status=status;res.body=body},memoryDir:name=>path.join(home,'memory',name),writeTextAtomicPreSync,...extra}
  return new Function(...Object.keys(env),'return ('+source.slice(start,end)+'\n})')(...Object.values(env))
 }
 const configHandler=handler('      path: API.config,')
 async function call(fn,body){const res={};await fn({method:'POST',body},res);return res}
 const original=await fs.readFile(engine._configPath,'utf8')
 for(const [key,value] of [['memoryRoot','/outside/dsh'],['userMemoryDir',''],['workbenchRoot',home+'-escape'],['dayBoundaryMinutes',1440],['workbenchLoopShort',1],['autoSummaryTimes',['12:00','24:00']]]){
  const result=await call(configHandler,{[key]:value,locale:'ja'})
  assert.equal(result.status,400);assert(result.body.fields[key]);assert.equal(await fs.readFile(engine._configPath,'utf8'),original)
 }
 assert.equal((await call(configHandler,{autoSummaryTimes:[],dayBoundaryMinutes:0,workbenchLoopShort:2})).status,200)
 console.log('PASS actual /config handler: field-specific errors are all-or-nothing; zero midnight and empty off array accepted')
 const semanticPath=path.join(home,'memory','semantic','embedding-config.json')
 await fs.mkdir(path.dirname(semanticPath),{recursive:true})
 await fs.writeFile(semanticPath,JSON.stringify({activationEmitMode:'shadow',extra:'preserve'}))
 const failed=handler("      path: API['semantic-emit'],",{writeTextAtomicPreSync:()=>({ok:false,error:'injected atomic writer failure'})})
 const failure=await call(failed,{mode:'active'})
 assert.equal(failure.status,500);assert.match(failure.body.error,/atomic writer failure/)
 assert.equal(JSON.parse(await fs.readFile(semanticPath,'utf8')).activationEmitMode,'shadow')
 const semantic=handler("      path: API['semantic-emit'],")
 assert.equal((await call(semantic,{mode:'active'})).status,200)
 const saved=JSON.parse(await fs.readFile(semanticPath,'utf8'))
 assert.equal(saved.activationEmitMode,'active');assert.equal(saved.activationPolicy.mode,'active');assert.equal(saved.extra,'preserve')
 await fs.writeFile(semanticPath,'broken semantic config')
 assert.equal((await call(semantic,{mode:'shadow'})).status,500)
 assert.equal(await fs.readFile(semanticPath,'utf8'),'broken semantic config')
 console.log('PASS actual /semantic-emit handler: atomic failure never acknowledges success; gates align after commit; invalid existing JSON preserved')
 // Scoped notes use the selected session and strict disk reads, not another session's cache.
 const notesPath=path.join(home,'project-notes.md'),otherPath=path.join(home,'other-notes.md')
 await fs.writeFile(notesPath,'# Correct session notes\n');await fs.writeFile(otherPath,'# Other session data\n')
 engine.state.notesPath=otherPath;engine.state.notesText='cached unrelated data'
 engine.resolvePathsForSession=async sid=>({wsBound:sid==='valid-session',notesPath})
 const noteHandler=handler('      path: API.note,')
 assert.equal((await call(noteHandler,{content:'scoped write',sessionId:'unknown'})).status,400)
 assert.equal((await call(noteHandler,{content:'scoped write',sessionId:'valid-session',expectedNotesPath:otherPath})).status,409)
 const request={content:'a unique project note',sessionId:'valid-session',expectedNotesPath:notesPath}
 assert.equal((await call(noteHandler,request)).status,200)
 assert.match(await fs.readFile(notesPath,'utf8'),/Correct session notes/)
 assert.match(await fs.readFile(notesPath,'utf8'),/a unique project note/)
 assert.equal(await fs.readFile(otherPath,'utf8'),'# Other session data\n')
 assert.equal(engine.state.notesText,'cached unrelated data')
 assert.equal((await call(noteHandler,request)).status,400,'repeating the saved note is rejected using disk state')
 await fs.rm(notesPath);await fs.mkdir(notesPath)
 assert.equal((await call(noteHandler,{...request,content:'must not replace unreadable notes'})).status,500)
 assert((await fs.stat(notesPath)).isDirectory())
 console.log('PASS actual /note handler: scoped session, destination CAS, strict disk reads, duplicate refusal, write failure preserves destination')

}finally{
 if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous
 await fs.rm(home,{recursive:true,force:true})
}
