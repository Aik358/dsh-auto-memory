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
try {
 const run=(prefix,dir,file)=>new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[fileURLToPath(new URL('../lib/issue207-process.mjs',import.meta.url)),prefix,...(file?[file]:[])],{env:{...process.env,HOME:dir,DSH_HOME:dir},stdio:['ignore','pipe','pipe']});let out='',err=''
  p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.on('error',reject);p.on('exit',code=>{if(code!==0)reject(Error(err||out));else resolve(JSON.parse(out.trim().split('\n').at(-1)))})
 })
 const results=await Promise.all([run('p1',home),run('p2',alias),run('p3',home)])
 assert.deepEqual(results.flatMap(r=>r.values).sort((a,b)=>a-b),Array.from({length:24},(_,i)=>88+i))
 assert.equal(results.filter(r=>r.marked).length,1)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home,'auto-memory-archive-ledger.json'))),{p1:100,p2:100,p3:100})
 assert.equal(JSON.parse(fs.readFileSync(path.join(home,'memory','cont-seq.json'))).last,111)
 const restarted=await run('restart',home);assert.equal(restarted.values[0],112);assert.equal(restarted.marked,false)
 const held=spawn(process.execPath,[fileURLToPath(new URL('../lib/issue207-process.mjs',import.meta.url)),'hold'],{env:{...process.env,HOME:home,DSH_HOME:home},stdio:['ignore','pipe','pipe']})
 await new Promise((resolve,reject)=>{held.stdout.on('data',b=>{if(String(b).includes('HELD'))resolve()});held.on('error',reject);held.on('exit',code=>reject(Error('owner exited before hold '+code)))})
 const closed=new Promise(resolve=>held.once('exit',resolve));held.kill('SIGKILL');await closed
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
  // ★★2026-10-25 修（并行干扰根治 · 全量回归实测抓到）：**rmSync 与子进程退出存在竞态**。
  //   实测报错：`ENOTEMPTY: Directory not empty: ...dam-207-process-j4nqR2`。
  //   根因：本套件在 finally 里删 root，而最后一批 `spawn` 的子进程**可能还在退出过程中**
  //   （Windows 上进程句柄释放滞后于 `exit` 事件），它们持有的临时文件/目录尚未释放 ⇒ 目录非空。
  //   单跑 5 次全绿、全量并行时概率红 ⇒ 典型的**清理竞态**，不是被测功能缺陷。
  //
  //   ★修法：`maxRetries` + `retryDelay`（Node 官方为此提供的内置重试，专治 Windows EPERM/ENOTEMPTY）；
  //     再不行则**降级为「尽力清理、不 fail」** —— 清理失败不该让一个功能全绿的套件变红。
  //   ★为什么不上 `force:true` 之外的更强手段：`force` 只忽略「不存在」，不忽略「非空」。
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch (eClean) {
    // 尽力清理；不因清理竞态判失败（临时目录在 .dsh-smoke-tmp/ 下，runner 会统一回收）
    console.log('[warn] 临时目录清理未完成（' + String((eClean && eClean.code) || eClean) + '），已跳过：' + root)
  }
}
