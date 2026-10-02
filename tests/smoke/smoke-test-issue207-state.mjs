import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import fs from 'node:fs'
import { zstdCompressSync } from 'node:zlib'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { MemoryEngine } from '../lib/state-engine.mjs'
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-state207-'))
process.env.DSH_HOME = home
process.env.HOME = home
const engine = () => Object.assign(new MemoryEngine(), { config: { handoffEnabled: false, autoContinueEnabled: false } })
after(() => fs.rmSync(home, { recursive: true, force: true }))
const fault = async (job) => {
  const write = fs.writeFileSync, rename = fs.renameSync
  const deny = () => { throw Object.assign(new Error('isolated state write denied'), { code: 'EPERM' }) }
  fs.writeFileSync = deny; fs.renameSync = deny; syncBuiltinESMExports()
  try { return await job() } finally { fs.writeFileSync = write; fs.renameSync = rename; syncBuiltinESMExports() }
}
test('allocation refuses success if its reservation cannot persist', async () => {
 const e = engine();fs.mkdirSync(path.dirname(e.contSeqFile()), { recursive: true });fs.writeFileSync(e.contSeqFile(), JSON.stringify({last: 12, byWorkspace: {a:12}}))
 await fault(async () => { await assert.rejects(e.allocContSeq('a')); await assert.rejects(e.allocContSeq('a')) })
 assert.equal(JSON.parse(fs.readFileSync(e.contSeqFile())).last, 12)
})
test('failed latch commit cannot return true or poison memory membership', async () => {
 const e=engine();await fault(async () => { await assert.rejects(async () => e.markContinuedSession('failure-source','next')) })
 assert.equal(e.isContinuedSession('failure-source'), false)
})
test('restart retains every source beyond the old 200-record cap', async () => {
 const e=engine();for(let i=0;i<205;i++) await e.markContinuedSession('source-'+i,'next-'+i)
 const restarted=engine();assert.equal(restarted.isContinuedSession('source-0'),true);assert.equal(restarted.isContinuedSession('source-204'),true)
})
test('archive write refusal is observable and preserves previous disk bytes', async () => {
 const e=engine(), file=path.join(home,'auto-memory-archive-ledger.json');fs.writeFileSync(file,'{"old":123}')
 await fault(async () => { await assert.rejects(async () => e.saveArchiveLedger({new:456})) })
 assert.equal(fs.readFileSync(file,'utf8'),'{"old":123}')
})

const json = file => JSON.parse(fs.readFileSync(file,'utf8'))
async function renameFault(target, job) {
 const rename=fs.renameSync
 fs.renameSync=(from,to)=>{ if (target(to)) throw Object.assign(new Error('isolated atomic rename denied'),{code:'EPERM'});return rename(from,to) };syncBuiltinESMExports()
 try { return await job() } finally { fs.renameSync=rename;syncBuiltinESMExports() }
}
test('actual atomic commit failure, corrupt bytes and denied reads fail closed, then recover', async () => {
 const e=engine(),file=e.contSeqFile();fs.writeFileSync(file,'{"last":30,"byWorkspace":{}}');const old=fs.readFileSync(file)
 await renameFault(to=>to===file,async()=>assert.rejects(e.allocContSeq('atomic'),/persist failed/))
 assert.deepEqual(fs.readFileSync(file),old);assert.equal(await e.allocContSeq('atomic'),31)
 for(const invalid of [Buffer.from('{broken'),Buffer.from([0xff]),Buffer.from('{"last":-1}')]) {
  fs.writeFileSync(file,invalid);await assert.rejects(e.allocContSeq('bad'),/read failed/);assert.deepEqual(fs.readFileSync(file),invalid)
 }
 fs.writeFileSync(file,old)
 const read=fs.readFileSync;fs.readFileSync=(p,...args)=>{if(p===file)throw Object.assign(new Error('read denied'),{code:'EACCES'});return read(p,...args)};syncBuiltinESMExports()
 try{await assert.rejects(e.allocContSeq('denied'),/read failed/)}finally{fs.readFileSync=read;syncBuiltinESMExports()}
 assert.deepEqual(fs.readFileSync(file),old)
 assert.equal(fs.readdirSync(path.dirname(file)).filter(n=>n.startsWith('cont-seq.json.')&&n.endsWith('.tmp')).length,0)
})
test('cold scan holds cross-instance lock and rollback never lowers reserved high-water', async () => {
 const e=engine(),other=engine();fs.rmSync(e.contSeqFile(),{force:true})
 let release,entered;const ready=new Promise(r=>entered=r),barrier=new Promise(r=>release=r)
 e.scanMaxContSeq=async()=>{entered();await barrier;return 40}
 other.scanMaxContSeq=async()=>{throw Error('second cold scan must not run')}
 const first=e.allocContSeq('cold-a');await ready;const second=other.allocContSeq('cold-b');release()
 assert.deepEqual(await Promise.all([first,second]),[41,42])
 assert.equal(e.rollbackContSeq('cold-a',41),false);assert.equal(other.rollbackContSeq('cold-b',42),false)
 assert.equal(json(e.contSeqFile()).last,42);assert.equal(await engine().allocContSeq('restart'),43)
})
test('legacy latch array/object migration is lossless and corruption is not empty state', async () => {
 const e=engine(),file=e.continuedSessionsFile()
 for(const legacy of [['session-legacy-a'],{sessions:[{from:'session-legacy-a',to:'old',at:1}]}]) {
  fs.writeFileSync(file,JSON.stringify(legacy));const old=fs.readFileSync(file)
  assert.equal(e.isContinuedSession('session-legacy-a'),true);assert.equal(await e.markContinuedSession('legacy-a','again'),false)
  assert.equal(await e.markContinuedSession('legacy-new','next'),true);assert.deepEqual(fs.readFileSync(file),old)
  // Both formats retained; remove only this test's modern record before next iteration.
  fs.rmSync((await import('../../lib/continuation-state.js')).continuedSourceFile(file,'legacy-new'))
 }
 fs.writeFileSync(file,'{broken');assert.throws(()=>e.isContinuedSession('source-0'),/read failed/)
 await assert.rejects(e.markContinuedSession('corrupt-legacy','next'),/read failed/)
 assert.equal(fs.readFileSync(file,'utf8'),'{broken');fs.rmSync(file)
})
test('archive deltas from independent engines merge under lock and explicit deletions preserve peers', async () => {
 const a=engine(),b=engine(),file=path.join(home,'auto-memory-archive-ledger.json');fs.writeFileSync(file,'{}')
 await Promise.all([a.saveArchiveLedger({a:100}),b.saveArchiveLedger({b:200})]);assert.deepEqual(json(file),{a:100,b:200})
 await Promise.all([a.saveArchiveLedger({c:300},['a']),b.saveArchiveLedger({d:400})]);assert.deepEqual(json(file),{b:200,c:300,d:400})
 const old=fs.readFileSync(file);await renameFault(to=>to===file,async()=>assert.rejects(a.saveArchiveLedger({e:500}),/persist failed/));assert.deepEqual(fs.readFileSync(file),old)
 fs.writeFileSync(file,'{broken');await assert.rejects(a.saveArchiveLedger({f:600}),/read failed/);assert.equal(fs.readFileSync(file,'utf8'),'{broken');fs.writeFileSync(file,'{}')
})
test('real archive sweep reports ledger commit failure and never deletes unknown archive ages', async () => {
 const e=engine(),sid='session-aaaaaaaa-1111-4111-8111-111111111111',ws=path.join(home,'sessions','hub'),dir=path.join(ws,sid)
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'session.jsonl'),'{"cwd":"hub"}\n')
 const registry={archivedSessionIds:new Set(),archiveSession:async id=>registry.archivedSessionIds.add(id)}
 e._ctxRef={get:key=>key==='workspaceRegistry'?registry:null};e.config={sessionArchiveEnabled:true,autoArchiveEnabled:true,autoArchiveDays:1,autoDeleteEnabled:true,autoDeleteDays:1}
 e._hubProjectDirs=()=>new Set([ws]);e.workbenchSessionIds=()=>[];e.sessionLastActivityAt=()=>Date.now()-10*86400000
 const file=path.join(home,'auto-memory-archive-ledger.json');fs.writeFileSync(file,'{}')
 const report=await renameFault(to=>to===file,()=>e.sessionArchiveSweep(true))
 assert.equal(report.ok,false);assert.deepEqual(report.archived,[sid]);assert.equal(report.errors[0].op,'archive-ledger');assert.deepEqual(json(file),{});assert(fs.existsSync(dir))
 const unknown=await e.sessionArchiveSweep(true);assert.deepEqual(unknown.deleted,[]);assert(fs.existsSync(dir))
 fs.rmSync(ws,{recursive:true})
})

test('cold migration checks all history and rejects incomplete compressed evidence', async () => {
 const e=engine(),sessions=path.join(home,'sessions','history');fs.rmSync(e.contSeqFile(),{force:true})
 for(let i=0;i<125;i++) {
  const dir=path.join(sessions,'session-'+i);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'session.jsonl')
  fs.writeFileSync(file,JSON.stringify({title:i===0?'接续 #250':'ordinary'})+'\n');fs.utimesSync(file,i===0?new Date(0):new Date(),i===0?new Date(0):new Date())
 }
 assert.equal(await e.allocContSeq('oldest'),251)
 fs.rmSync(sessions,{recursive:true});fs.rmSync(e.contSeqFile())
 const zip=path.join(sessions,'session-compressed','session.v4.jsonl.zstd');fs.mkdirSync(path.dirname(zip),{recursive:true})
 const valid=Buffer.concat([zstdCompressSync(Buffer.from('{"title":"接续 #270"}\n')),zstdCompressSync(Buffer.from('{"title":"Cont.#280"}\n'))])
 fs.writeFileSync(zip,Buffer.concat([valid,Buffer.from([0x28,0xb5])]))
 await assert.rejects(e.allocContSeq('badzip'),/incomplete/);assert.equal(fs.existsSync(e.contSeqFile()),false)
 fs.writeFileSync(zip,valid);assert.equal(await e.allocContSeq('zip'),281)
})
