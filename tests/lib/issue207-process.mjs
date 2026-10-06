import { withSharedStateLock } from '../../lib/shared-state-lock.js'
import { MemoryEngine, flushDiagnostics } from './state-engine.mjs'
globalThis.fetch=async()=>{throw Error('external services forbidden in state child')}
const engine=new MemoryEngine(), prefix=process.argv[2], values=[]
if(process.argv[3])engine.contSeqFile=()=>process.argv[3]
if(prefix==='hold') await withSharedStateLock(engine.contSeqFile(), async()=>{console.log('HELD');await new Promise(()=>setInterval(()=>{},1000))})
for(let i=0;i<8;i++)values.push(await engine.allocContSeq(prefix))
const marked=await engine.markContinuedSession('shared-process-source',prefix)
await engine.saveArchiveLedger({[prefix]:100})
await flushDiagnostics()
console.log(JSON.stringify({values,marked}))
