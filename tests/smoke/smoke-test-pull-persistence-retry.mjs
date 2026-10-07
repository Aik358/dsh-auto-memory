import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createHubIoPre } from '../../lib/hub-io.js'
import { createFactStorePre } from '../../lib/fact-store.js'
import { createTeamPuller } from '../../lib/team-pull.js'
import { createTeamMerge } from '../../lib/team-merge.js'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-audit-pull-'))
try {
  const io=createHubIoPre({dir:root})('facts.json')
  const store=createFactStorePre({io})
  const blocked=path.join(root,'facts.json'); await fs.mkdir(blocked)
  const requests=[], changes=[{kind:'fact',key:'fact-fixture',payload:{scope:'Workspace',subject:'fixture project',predicate:'uses',object:'synthetic compiler',sourceKind:'explicit',provenance:['mem_'+'1'.repeat(32)]}}]
  const center=createTeamMerge()
  const puller=createTeamPuller({engine:{config:{teamEnabled:true}},conflictCenter:center,appliers:{fact:p=>store.upsert(p)},fetchJson:async url=>{requests.push(url);return {ok:true,data:{cursor:1,changes:url.endsWith('since=0')?changes:[]}}}})
  const first=await puller.pullOnce()
  assert.equal(first.rejected,1); assert.equal(first.since,0); assert.equal(first.ok,false); assert.equal(store.size,0)
  await fs.rmdir(blocked)
  const second=await puller.pullOnce();assert.equal(second.total,1);assert.equal(second.applied,1);assert.equal(second.since,1);assert.equal(store.size,1)
  assert.equal(await fs.stat(blocked).then(()=>true,()=>false),true)
  const restarted=createFactStorePre({io}); assert(restarted.restore(io.load()).ok); assert.equal(restarted.size,1)
  const permanent=createTeamPuller({engine:{config:{teamEnabled:true}},appliers:{fact:()=>({ok:false,reason:'invalid:subject'})},fetchJson:async()=>({ok:true,data:{cursor:2,changes}})})
  assert.equal((await permanent.pullOnce()).since,2,'terminal validation refusal advances')
  for(const result of [{ok:true,persisted:false},{ok:false,reason:'disposed'},null]) {
    const retry=createTeamPuller({engine:{config:{teamEnabled:true}},appliers:{fact:()=>result},fetchJson:async()=>({ok:true,data:{cursor:2,changes}})})
    const r=await retry.pullOnce(); assert.equal(r.ok,false);assert.equal(r.since,0)
  }
  console.log('PASS pull: actual disk failure/recovery/restart, terminal validation, transient retries')
  console.log(JSON.stringify({case:'pull-persistence-failure-cursor',first,requests,afterRecovery:second,rejected:center.rejected(),localFacts:store.size},null,2))
} finally {await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:40})}
