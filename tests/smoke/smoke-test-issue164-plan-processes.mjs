import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {MemoryEngine} from '../lib/audit-engine.mjs'
import {planCardsPre} from '../../lib/plan-store.js'
const root=await mkdtemp(path.join(os.tmpdir(),'dam-plan-process-')),file=path.join(root,'handoff','PLAN.md')
const previousHome=process.env.DSH_HOME;process.env.DSH_HOME=root
const engineUrl=new URL('../lib/audit-engine.mjs',import.meta.url).href
function run(card,body){return new Promise((resolve,reject)=>{const script=`import{MemoryEngine}from${JSON.stringify(engineUrl)};const e=new MemoryEngine();e.configLoaded=true;e.config.criteriaGate=false;const r=await e.writePlanSnapshot(${JSON.stringify(root)},${JSON.stringify(body)},{cardId:${JSON.stringify(card.id)},expectedCardRevision:${JSON.stringify(card.revision)}});console.log(JSON.stringify(r));`;const p=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,DSH_HOME:root},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',code=>{if(code)reject(new Error(err));else resolve(JSON.parse(out))})})}
try {
 const e=new MemoryEngine();e.configLoaded=true;e.config.criteriaGate=false
 assert.equal((await e.writePlanSnapshot(root,'# Shared\n## A\nOriginal card A factual contents sufficient to describe this project.\n## B\nOriginal card B factual contents sufficient to describe this project.\n')).ok,true)
 let cards=planCardsPre(await readFile(file,'utf8'))
 const first=await Promise.all([run(cards[0],cards[0].text.replace('Original','Updated')),run(cards[1],cards[1].text.replace('Original','Updated'))]);assert.ok(first.every(r=>r.ok));let combined=await readFile(file,'utf8');assert.match(combined,/Updated card A/);assert.match(combined,/Updated card B/)
 cards=planCardsPre(combined);const same=await Promise.all([run(cards[0],cards[0].text.replace('Updated','Candidate one')),run(cards[0],cards[0].text.replace('Updated','Candidate two'))]);assert.equal(same.filter(r=>r.ok).length,1);assert.equal(same.filter(r=>!r.ok).length,1)
 const conflict=JSON.parse(await readFile(same.find(r=>!r.ok).conflictPath,'utf8'));assert.match(conflict.current,/Candidate (one|two)/);assert.match(conflict.proposed,/Candidate (one|two)/);assert.notEqual(conflict.current.includes('Candidate one'),conflict.proposed.includes('Candidate one'))
 // Process death holding the transaction lock cannot corrupt PLAN. A fresh
 // process recovers only a verifiably dead same-host owner and uses current CAS.
 const lockUrl=new URL('../../lib/calendar-lock.js',import.meta.url).href
 const owner=spawn(process.execPath,['--input-type=module','-e',`import{withCalendarLock}from${JSON.stringify(lockUrl)};await withCalendarLock(${JSON.stringify(file)},async()=>{console.log('locked');await new Promise(r=>setTimeout(r,60000))});`],{stdio:['ignore','pipe','pipe']});await once(owner.stdout,'data');const before=await readFile(file,'utf8');owner.kill('SIGKILL');await once(owner,'exit');assert.equal(await readFile(file,'utf8'),before)
 const card=planCardsPre(before)[1];assert.equal((await run(card,card.text.replace('Updated','Recovered'))).ok,true);assert.match(await readFile(file,'utf8'),/Recovered card B/)
 console.log('PASS #164: two real processes preserve distinct cards, reject same-card stale CAS with both candidates, survive killed lock owner and recover after restart')
}finally{if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;await rm(root,{recursive:true,force:true})}
