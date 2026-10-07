import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createTeamOutbox } from '../../lib/team-outbox.js'
import fsSync from 'node:fs'
import { withConfigLockSync } from '../../lib/config-lock.js'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-audit-outbox-'))
try {
  const observer=createTeamOutbox({dir:root}); assert(observer.load().ok)
  const moduleUrl=new URL('../../lib/team-outbox.js',import.meta.url).href
  const child=path.join(root,'child.mjs')
  await fs.writeFile(child,`import {createTeamOutbox} from ${JSON.stringify(moduleUrl)};const q=createTeamOutbox({dir:process.argv[2]});const r=q.enqueue({kind:'handoff',key:'A',payload:{text:'synthetic A'}});if(!r.ok)throw Error(JSON.stringify(r));console.log(JSON.stringify(r));`)
  const a=JSON.parse(execFileSync(process.execPath,[child,root],{encoding:'utf8',windowsHide:true}))
  const b=observer.enqueue({kind:'handoff',key:'B',payload:{text:'synthetic B'}})
  const fresh=createTeamOutbox({dir:root}); assert(fresh.load().ok)
  assert(a.ok&&b.ok);assert.deepEqual(fresh.list().map(x=>x.key),['A','B'])
  const retainedAfterRestart=fresh.list().map(x=>x.key)
  // A different process enqueues while the network sender is outstanding.
  const flushed=await observer.flush(async item=>{
    if(item.key==='A') execFileSync(process.execPath,[child,root],{encoding:'utf8',windowsHide:true})
    if(item.key==='B') {
      const writer=createTeamOutbox({dir:root})
      assert(writer.enqueue({kind:'handoff',key:'C',payload:{text:'concurrent'}}).ok)
    }
  })
  assert.equal(flushed.sent,2)
  assert(fresh.load().ok); assert.deepEqual(fresh.list().map(x=>x.key),['C'])
  // A clear/re-enqueue of the same key is a new version, even at the same time.
  const replacing=createTeamOutbox({dir:root})
  await observer.flush(async item=>{
    assert(replacing.clear().ok)
    assert(replacing.enqueue({...item,payload:{text:'replacement'}}).ok)
  })
  assert(fresh.load().ok); assert.equal(fresh.list()[0].payload.text,'replacement')
  // Contention and publication failure must never report durable acceptance.
  const rename=fsSync.renameSync, disk=await fs.readFile(fresh.file,'utf8')
  withConfigLockSync(fresh.file,()=>assert.equal(observer.enqueue({kind:'handoff',key:'busy'}).ok,false),{reentrant:false})
  try {
    fsSync.renameSync=(from,to)=>{if(to===fresh.file) throw Object.assign(Error('injected rename failure'),{code:'EPERM'});return rename(from,to)}
    assert.equal(observer.enqueue({kind:'handoff',key:'failed'}).ok,false)
    assert.equal(observer.size(),1)
    const result=await observer.flush(async()=>{})
    assert.equal(result.persisted,false);assert.equal(observer.size(),1)
    assert.equal(await fs.readFile(fresh.file,'utf8'),disk)
  } finally { fsSync.renameSync=rename }
  assert.equal((await observer.flush(async()=>{})).sent,1)
  assert(fresh.load().ok);assert.equal(fresh.size(),0)
  await fs.writeFile(fresh.file,'{corrupt fixture')
  assert.equal(observer.enqueue({kind:'handoff',key:'refused'}).ok,false)
  assert.equal(await fs.readFile(fresh.file,'utf8'),'{corrupt fixture')
  assert(observer.clear().ok,'explicit clear must recover a corrupt queue under the same lock')
  assert.deepEqual(JSON.parse(await fs.readFile(fresh.file,'utf8')).items,[])
  console.log('PASS outbox: cross-process read/modify/write, concurrent flush merge, replacement version')
  console.log(JSON.stringify({case:'cross-process-outbox-retention',writerA:a.ok,writerB:b.ok,afterRestart:retainedAfterRestart,retained:'A'},null,2))
} finally {await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:40})}
