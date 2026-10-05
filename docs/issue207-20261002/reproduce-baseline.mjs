import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {syncBuiltinESMExports} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {MemoryEngine,flushDiagnostics} from '../../tests/lib/state-engine.mjs'
if(!process.env.DAM_STATE_ENGINE_SOURCE || createHash('sha256').update(fs.readFileSync(process.env.DAM_STATE_ENGINE_SOURCE)).digest('hex') !== '57dd707d681e5b86d71764499b242c9d23c78222eaa310a0550eddc092d95b65') throw Error('Provide the exact 131ca794 lib/index.js baseline via DAM_STATE_ENGINE_SOURCE')
const home=fs.mkdtempSync(path.join(os.tmpdir(),'dam-207-repro-'));process.env.HOME=home;process.env.DSH_HOME=home
const e=new MemoryEngine();e.config.handoffEnabled=false
fs.mkdirSync(path.dirname(e.contSeqFile()),{recursive:true});fs.writeFileSync(e.contSeqFile(),'{"last":12,"byWorkspace":{"a":12}}')
const ledger=path.join(home,'auto-memory-archive-ledger.json');fs.writeFileSync(ledger,'{"old":123}')
const write=fs.writeFileSync;let seq,latch,latchMemory,archiveError=false
fs.writeFileSync=()=>{throw Object.assign(Error('isolated write refused'),{code:'EPERM'})};syncBuiltinESMExports()
try{seq=[await e.allocContSeq('a'),await e.allocContSeq('a')];latch=e.markContinuedSession('source-failed','next');latchMemory=e.isContinuedSession('source-failed');try{e.saveArchiveLedger({new:456})}catch{archiveError=true}}
finally{fs.writeFileSync=write;syncBuiltinESMExports()}
const latchDisk=fs.existsSync(e.continuedSessionsFile())
for(let i=0;i<205;i++)e.markContinuedSession('source-'+i,'next-'+i)
const restarted=new MemoryEngine()
console.log(JSON.stringify({baseline:'131ca794b9f0d07f78b19bf6feee3312939854ed',failedSerialAllocationResults:seq,counterDiskLast:JSON.parse(fs.readFileSync(e.contSeqFile())).last,failedLatchReportedSuccess:latch,failedLatchMemoryMembership:latchMemory,failedLatchDiskExists:latchDisk,archiveWriteFailureThrew:archiveError,archiveDisk:JSON.parse(fs.readFileSync(ledger)),continuedDiskCount:JSON.parse(fs.readFileSync(e.continuedSessionsFile())).sessions.length,restartedContainsFirstSource:restarted.isContinuedSession('source-0'),restartedContainsLastSource:restarted.isContinuedSession('source-204')},null,2))
await flushDiagnostics();fs.rmSync(home,{recursive:true,force:true})
