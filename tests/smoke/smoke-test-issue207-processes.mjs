import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dam-207-process-')),home=path.join(root,'home'),alias=path.join(root,'alias')
fs.mkdirSync(path.join(home,'sessions','workspace','session-history'),{recursive:true})
fs.writeFileSync(path.join(home,'sessions','workspace','session-history','session.jsonl'),'{"title":"接续 #87"}\n')
fs.symlinkSync(home,alias,process.platform==='win32'?'junction':'dir')
const flights = []
let held, heldClosed
try {
 const run=(prefix,dir,file)=>{
  const flight=new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[fileURLToPath(new URL('../lib/issue207-process.mjs',import.meta.url)),prefix,...(file?[file]:[])],{env:{...process.env,HOME:dir,DSH_HOME:dir},stdio:['ignore','pipe','pipe']});let out='',err=''
  p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.on('error',reject);p.on('close',code=>{if(code!==0)reject(Error(err||out));else resolve(JSON.parse(out.trim().split('\n').at(-1)))})
  })
  flights.push(flight)
  return flight
 }
 const results=await Promise.all([run('p1',home),run('p2',alias),run('p3',home)])
 assert.deepEqual(results.flatMap(r=>r.values).sort((a,b)=>a-b),Array.from({length:24},(_,i)=>88+i))
 assert.equal(results.filter(r=>r.marked).length,1)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'auto-memory-archive-ledger.json'))),{p1:100,p2:100,p3:100})
 assert.equal(JSON.parse(fs.readFileSync(path.join(home,'memory','cont-seq.json'))).last,111)
 const restarted=await run('restart',home);assert.equal(restarted.values[0],112);assert.equal(restarted.marked,false)
 held=spawn(process.execPath,[fileURLToPath(new URL('../lib/issue207-process.mjs',import.meta.url)),'hold'],{env:{...process.env,HOME:home,DSH_HOME:home},stdio:['ignore','pipe','pipe']})
 heldClosed=new Promise(resolve=>held.once('close',resolve))
 await new Promise((resolve,reject)=>{held.stdout.on('data',b=>{if(String(b).includes('HELD'))resolve()});held.on('error',reject);held.on('exit',code=>reject(Error('owner exited before hold '+code)))})
 held.kill('SIGKILL');await heldClosed
 const recovered=await run('recovered',home);assert.equal(recovered.values[0],120)
 const fileAlias=path.join(root,'counter-alias.json'),target=path.join(home,'memory','cont-seq.json')
 let fileAliasAvailable=true
 try { fs.symlinkSync(target,fileAlias) }
 catch(e) { if(process.platform==='win32'&&e.code==='EPERM')fileAliasAvailable=false;else throw e }
 if (fileAliasAvailable) {
 const concurrent=await Promise.allSettled([run('direct-file',home),run('alias-file',home,fileAlias)])
 assert.equal(concurrent[0].value.values[0],128);assert.equal(concurrent[1].status,'rejected');assert.match(concurrent[1].reason.message,/state-file-symlink/);assert(fs.lstatSync(fileAlias).isSymbolicLink())
 const afterAlias=await run('after-alias',home);assert.equal(afterAlias.values[0],136)
 } else console.log('SKIP leaf file-alias checks: Windows file-symlink permission unavailable; directory-junction/concurrency/restart checks executed')
 console.log('PASS real four-process allocation, alias locking, one-source latch, archive delta merge, restart and dead-lock-owner recovery')
}finally{
 // Promise.all rejects on the first failed child, while sibling processes may
 // still own locks/write diagnostics. Drain real producers before Temp removal;
 // waiting for close also drains their output and preserves the original error.
 if(held&&held.exitCode===null)held.kill('SIGKILL')
 if(heldClosed)await heldClosed
 await Promise.allSettled(flights)
 fs.rmSync(root,{recursive:true,force:true})
}
