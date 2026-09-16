// Issue #48: real writer/parser/index modules + temporary filesystem. No DSH
// runtime is simulated here; the host adapter has a separate source-level test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { retryRename, RENAME_RETRY_DELAYS } from '../../lib/fs-retry.js'
import { atomicReplace, MemoryDocumentStore, memoryWriteLockKey, memoryWriteError } from '../../lib/memory-writer.js'
import { parseAnchors, planMigration } from '../../lib/memory-anchor.js'

const noSleep = async () => {}
const fast = { sleep: noSleep }
const digest = (b) => createHash('sha256').update(b).digest('hex')
const errorOf = (code) => Object.assign(new Error(code + ': injected filesystem error'), { code, errno: -1, syscall: 'rename' })
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-issue48-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const target = path.join(dir, 'MEMORY.md')
  await fs.writeFile(target, '# 原有记录\n旧内容\n')
  return { dir, target, before: await fs.readFile(target) }
}
async function failure(job) {
  try { await job } catch (e) { return e }
  assert.fail('expected a rejected promise')
}
function renameFault(target, count, code = 'EPERM', extra = {}) {
  let attempts = 0
  const errors = []
  const calls = []
  const api = { ...fs, ...extra, async rename(from, to) {
    calls.push({ from, to })
    if (to === target && ++attempts <= count) {
      const error = errorOf(code); errors.push(error); throw error
    }
    return fs.rename(from, to)
  } }
  return { api, errors, calls, get attempts() { return attempts } }
}
function store(api = fs, opts = {}) { return new MemoryDocumentStore({ fs: api, atomicOptions: fast, ...opts }) }

test('rename succeeds immediately with no wait', async () => {
  let calls = 0
  await retryRename('source', 'target', { fs: { rename: async () => { calls++ } }, sleep: async () => assert.fail('unexpected sleep') })
  assert.equal(calls, 1)
})
for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(code + ' retries only the same rename, then succeeds', async () => {
    let calls = 0; const waits = []; const pairs = []
    const api = { async rename(...pair) { assert.equal(this, api); pairs.push(pair); if (++calls < 3) throw errorOf(code) } }
    await retryRename('a', 'b', { fs: api, sleep: async (ms) => waits.push(ms) })
    assert.equal(calls, 3); assert.deepEqual(waits, [50, 150]); assert.deepEqual(pairs, [['a','b'], ['a','b'], ['a','b']])
  })
}
for (const code of ['ENOENT', 'EXDEV', 'ENOTDIR', 'EINVAL', 'EIO']) {
  test(code + ' is not retried or replaced with another error', async () => {
    const original = errorOf(code); let calls = 0
    const e = await failure(retryRename('a', 'b', { fs: { async rename() { calls++; throw original } }, sleep: async () => assert.fail('unexpected wait') }))
    assert.equal(e, original); assert.equal(calls, 1)
  })
}
test('exhaustion is bounded at 5 attempts / 1600ms explicit waits', async () => {
  const errors = []; const waits = []
  const e = await failure(retryRename('a', 'b', { fs: { async rename() { const x = errorOf('EPERM'); errors.push(x); throw x } }, sleep: async (ms) => waits.push(ms) }))
  assert.equal(errors.length, 5); assert.equal(e, errors[4]); assert.deepEqual(waits, [50,150,400,1000])
  assert.equal(waits.reduce((a,b) => a+b, 0), 1600); assert.equal(Object.isFrozen(RENAME_RETRY_DELAYS), true)
})
test('retry schedule cannot be extended while a retry is running', async () => {
  const delays = [0, 1]; let calls = 0
  const e = await failure(retryRename('a', 'b', { delays, fs: { async rename() { calls++; delays.push(0); throw errorOf('EPERM') } }, sleep: noSleep }))
  assert.equal(e.code, 'EPERM'); assert.equal(calls, 2)
})
test('invalid retry schedules fail before IO', async () => {
  for (const delays of [[], [1], [0,-1], [0,NaN], [0,Infinity], 'bad']) {
    await assert.rejects(retryRename('a', 'b', { delays, fs: { rename: async () => assert.fail('unexpected IO') } }), TypeError)
  }
})
test('atomic replace closes/flushed temp before any rename and removes no target', async (t) => {
  const { dir, target } = await fixture(t); const events = []; let temp
  const api = { ...fs, async open(p, flags, mode) {
    temp = p; assert.equal(flags, 'wx'); assert.equal(mode, 0o600)
    const h = await fs.open(p, flags, mode)
    return {
      async writeFile(data) { events.push('write'); return h.writeFile(data) },
      async sync() { events.push('sync'); return h.sync() },
      async close() { events.push('close'); return h.close() },
    }
  }, async rename(a, b) { events.push('rename'); assert.deepEqual(events, ['write','sync','close','rename']); return fs.rename(a,b) },
  async unlink() { assert.fail('success must not unlink') } }
  await atomicReplace(target, '新内容\n', api, fast)
  assert.equal(path.dirname(temp), dir); assert.equal(path.extname(temp), '.tmp')
  assert.equal(await fs.readFile(target, 'utf8'), '新内容\n'); assert.deepEqual(await fs.readdir(dir), ['MEMORY.md'])
})
test('transient store append renders one ID and commits exactly one record', async (t) => {
  const { target } = await fixture(t); const fault = renameFault(target, 2); let ids = 0
  const s = store(fault.api, { idFactory: () => { ids++; return 'mem_' + '1'.repeat(32) } })
  const r = await s.append(target, '新增条目🙂')
  assert.equal(r.ok, true); assert.equal(ids, 1); assert.equal(fault.attempts, 3)
  const parsed = parseAnchors(await fs.readFile(target)); assert.equal(parsed.status, 'clean')
  assert.equal(parsed.records.filter((x) => x.kind === 'anchored').length, 1)
  assert.equal(new Set(fault.calls.map((x) => x.from)).size, 1)
})
test('terminal rename failure preserves full candidate and unchanged target', async (t) => {
  const { target, before } = await fixture(t); const fault = renameFault(target, Infinity)
  const e = await failure(atomicReplace(target, '完整候选快照\n', fault.api, fast))
  assert.equal(e, fault.errors.at(-1)); assert.equal(fault.attempts, 5)
  assert.equal(e.code, 'EPERM'); assert.equal(e.syscall, 'rename'); assert.equal(e.recoveryComplete, true)
  assert.match(path.basename(e.recoveryPath), /^\.dam-failed-/); assert.equal(path.extname(e.recoveryPath), '.tmp')
  assert.equal(await fs.readFile(e.recoveryPath, 'utf8'), '完整候选快照\n'); assert.deepEqual(await fs.readFile(target), before)
})
test('failed recovery rename leaves original .tmp instead of unlinking it', async (t) => {
  const { target, before } = await fixture(t); let primary = 0; let recovery = 0
  const api = { ...fs, async rename(a,b) { if (b === target) primary++; else recovery++; throw errorOf('EBUSY') }, async unlink() { assert.fail('candidate was deleted') } }
  const e = await failure(atomicReplace(target, 'retained fallback', api, fast))
  assert.equal(primary, 5); assert.equal(recovery, 1); assert.equal(e.recoveryComplete, true)
  assert.match(path.basename(e.recoveryPath), /^\.dam-pre-tmp-/)
  assert.equal(await fs.readFile(e.recoveryPath, 'utf8'), 'retained fallback'); assert.deepEqual(await fs.readFile(target), before)
})
test('missing temp is not advertised as successfully retained', async (t) => {
  const { target } = await fixture(t)
  const api = { ...fs, async rename(from) { await fs.unlink(from).catch(() => {}); throw errorOf('ENOENT') } }
  const e = await failure(atomicReplace(target, 'lost by external remover', api, fast))
  assert.equal(e.recoveryPath, undefined); assert.equal(e.recoveryComplete, false); assert.equal(e.recoveryUnavailable, true)
})
test('permanent rename error is immediate but full candidate still survives', async (t) => {
  const { target, before } = await fixture(t); const fault = renameFault(target, Infinity, 'EXDEV')
  const e = await failure(atomicReplace(target, 'candidate', fault.api, { sleep: () => assert.fail('must not wait') }))
  assert.equal(fault.attempts, 1); assert.equal(await fs.readFile(e.recoveryPath,'utf8'), 'candidate'); assert.deepEqual(await fs.readFile(target), before)
})
test('open collision never deletes a temp this call did not create', async (t) => {
  const { target, before } = await fixture(t); let foreign
  const api = { ...fs, async open(p) { foreign = p; await fs.writeFile(p,'foreign'); throw errorOf('EEXIST') }, async unlink() { assert.fail('deleted foreign temp') } }
  const e = await failure(atomicReplace(target,'candidate',api,fast))
  assert.equal(e.stage,'open'); assert.equal(e.recoveryComplete,false); assert.equal(await fs.readFile(foreign,'utf8'),'foreign')
  assert.deepEqual(await fs.readFile(target),before)
})
for (const stage of ['write', 'sync', 'close']) {
  test(stage + ' failure cleans incomplete candidate and does not rename target', async (t) => {
    const { dir, target, before } = await fixture(t); let closed = false
    const api = { ...fs, async open(p, flags, mode) {
      const h = await fs.open(p, flags, mode)
      return {
        async writeFile(data) { if (stage === 'write') { await h.writeFile('partial'); throw errorOf('ENOSPC') } return h.writeFile(data) },
        async sync() { if (stage === 'sync') throw errorOf('EIO'); return h.sync() },
        async close() { if (!closed) { closed=true; await h.close(); if (stage === 'close') throw errorOf('EIO') } },
      }
    }, async rename() { assert.fail('incomplete content was renamed') } }
    const e = await failure(atomicReplace(target, 'new content', api, fast))
    assert.equal(e.stage, stage); assert.equal(e.recoveryComplete, false); assert.equal(e.recoveryPath, undefined)
    assert.deepEqual(await fs.readFile(target),before); assert.deepEqual(await fs.readdir(dir), ['MEMORY.md'])
  })
}
test('cleanup failure reports partialPath, never a complete recovery snapshot', async (t) => {
  const { target } = await fixture(t)
  const api = { ...fs, async open(p,f,m) { const h=await fs.open(p,f,m); return { async writeFile() { await h.writeFile('partial'); throw errorOf('ENOSPC') }, async close() { await h.close() } } }, async unlink() { throw errorOf('EPERM') } }
  const e = await failure(atomicReplace(target, 'intended bytes', api, fast))
  assert.equal(e.code,'ENOSPC'); assert.equal(e.recoveryComplete,false); assert.equal(e.recoveryPath,undefined)
  assert.equal(await fs.readFile(e.partialPath,'utf8'),'partial'); assert.equal(e.cleanupCode,'EPERM')
})
test('frozen filesystem error keeps its original cause/code and recovery metadata', async (t) => {
  const { target } = await fixture(t); const original=Object.freeze(errorOf('EPERM'))
  const api={...fs, async rename(a,b) { if (b===target) throw original; return fs.rename(a,b) } }
  const e = await failure(atomicReplace(target,'candidate',api,fast))
  assert.equal(e.cause,original); assert.equal(e.code,'EPERM'); assert.equal(e.recoveryComplete,true)
})
test('80 appends across 8 stores sharing one backend do not lose/duplicate records', async (t) => {
  const { target } = await fixture(t); const tried=new Set()
  const api={...fs, async rename(a,b) { if (b===target && !tried.has(a)) { tried.add(a); throw errorOf('EPERM') } return fs.rename(a,b) } }
  const stores=Array.from({length:8},()=>store(api)); assert.equal(stores[0]._locks,stores[7]._locks)
  const out=await Promise.all(Array.from({length:80},(_,i)=>stores[i%8].append(target,'record-'+i)))
  assert.ok(out.every((r)=>r.ok)); const parsed=parseAnchors(await fs.readFile(target)); assert.equal(parsed.status,'clean')
  const anchored=parsed.records.filter((r)=>r.kind==='anchored'); assert.equal(anchored.length,80)
  assert.equal(new Set(anchored.map((r)=>r.memoryId)).size,80)
  const text=await fs.readFile(target,'utf8'); for(let i=0;i<80;i++) assert.equal(text.split('\n').filter((line)=>line==='record-'+i).length,1)
  await Promise.resolve(); assert.equal(stores[0]._locks.size,0)
})
test('failed transaction releases queue; later success never replays stale snapshot', async (t) => {
  const { target } = await fixture(t); const fault=renameFault(target,5)
  const a=store(fault.api), b=store(fault.api)
  const [r1,r2]=await Promise.all([a.append(target,'failed-first'),b.append(target,'success-second')])
  assert.equal(r1.ok,false); assert.equal(r1.errorCode,'MEMORY_WRITE_FAILED'); assert.equal(r1.fsCode,'EPERM'); assert.equal(r1.written,false)
  assert.equal(r2.ok,true); const current=await fs.readFile(target,'utf8'); const candidate=await fs.readFile(r1.recoveryPath,'utf8')
  assert.ok(!current.includes('failed-first')); assert.ok(current.includes('success-second'))
  assert.ok(candidate.includes('failed-first')); assert.ok(!candidate.includes('success-second'))
  await Promise.resolve(); assert.equal(a._locks.size,0)
})
test('different files are not globally serialized and rejection does not poison queues', async () => {
  const s=store(); let release
  const held=new Promise((r)=>{release=r}); const events=[]
  const first=s._queue('/issue48/a',async()=>{events.push('a'); await held; throw new Error('first failure')})
  const rejection=assert.rejects(first,/first failure/)
  await s._queue('/issue48/b',async()=>events.push('b'))
  assert.deepEqual(events,['a','b']); release(); await rejection
  await s._queue('/issue48/a',async()=>events.push('again')); assert.deepEqual(events,['a','b','again'])
})
test('Windows case/separator aliases share keys; POSIX case distinctions survive', () => {
  assert.equal(memoryWriteLockKey('C:\\Users\\Alice\\notes\\MEMORY.md','win32'), memoryWriteLockKey('c:/users/alice/notes/memory.md','win32'))
  assert.notEqual(memoryWriteLockKey('/notes/MEMORY.md','linux'), memoryWriteLockKey('/notes/memory.md','linux'))
})
test('injected independent fs backends keep separate queues', () => {
  assert.notEqual(store({...fs})._locks,store({...fs})._locks)
})
test('expectedDigest rejection and duplicate memory ID remain fail-closed', async (t) => {
  const { target, before }=await fixture(t);const s=store(); const id='mem_'+'a'.repeat(32)
  assert.equal((await s.append(target,'bad',{expectedDigest:'stale'})).reason,'conflict-external-edit')
  assert.deepEqual(await fs.readFile(target),before)
  assert.equal((await s.append(target,'one',{memoryId:id})).ok,true)
  assert.equal((await s.append(target,'two',{memoryId:id})).reason,'duplicate-id')
})
test('CRLF style survives append retries', async (t) => {
  const { target }=await fixture(t);await fs.writeFile(target,'# 旧记录\r\n内容\r\n')
  const s=store(renameFault(target,1).api);assert.equal((await s.append(target,'新一行\n新二行')).ok,true)
  const b=await fs.readFile(target,'utf8'); assert.ok(!/(?<!\r)\n/.test(b));assert.equal(parseAnchors(b).status,'clean')
})
test('sidecar transient failure is retried without additional version increments', async (t) => {
  const { dir,target }=await fixture(t);let failures=2
  const api={...fs, async rename(a,b) { if(b.endsWith('.json') && failures-->0) throw errorOf('EACCES');return fs.rename(a,b) } }
  const s=store(api,{sidecarDir:path.join(dir,'sidecar')})
  const a=await s.append(target,'one');const b=await s.append(target,'two')
  assert.equal(a.ok,true);assert.equal(a.dirty,false);assert.equal(b.ok,true);assert.equal(b.dirty,false)
  assert.equal(a.sidecar.sourceVersion,1);assert.equal(b.sidecar.sourceVersion,2);assert.equal(a.sidecar.sourceEpoch,b.sidecar.sourceEpoch)
  const sc=await s.readSidecar(target);assert.equal(sc.ok,true);assert.equal(sc.sidecar.records.length,2)
  assert.equal(sc.sidecar.fileDigest,digest(await fs.readFile(target)))
})
test('permanent sidecar failure is dirty success, with no retained derived snapshot', async (t) => {
  const { dir,target }=await fixture(t);let attempts=0
  const api={...fs,async rename(a,b) {if(b.endsWith('.json')){attempts++;throw errorOf('EPERM')}return fs.rename(a,b)}}
  const sidecarDir=path.join(dir,'sidecar');const s=store(api,{sidecarDir})
  const r=await s.append(target,'markdown saved');assert.equal(r.ok,true);assert.equal(r.written,true);assert.equal(r.dirty,true);assert.equal(attempts,5)
  assert.ok((await fs.readFile(target,'utf8')).includes('markdown saved'));assert.deepEqual(await fs.readdir(sidecarDir),[])
})
test('backup failure remains fail-closed before document rename', async (t) => {
  const { dir,target,before }=await fixture(t)
  const api={...fs,async copyFile(){throw errorOf('EIO')},async rename(){assert.fail('rename after failed backup')}}
  const r=await store(api,{backupDir:path.join(dir,'backup')}).append(target,'new')
  assert.equal(r.ok,false);assert.match(r.reason,/^backup-failed:/);assert.deepEqual(await fs.readFile(target),before)
})
test('replace / replaceSingle / applyPlan use same retry layer and preserve anchor semantics', async (t) => {
  const { target }=await fixture(t);const fault=renameFault(target,2);const s=store(fault.api)
  const first=await s.replace(target,'# replacement\nnew body\n');assert.equal(first.ok,true);assert.equal(fault.attempts,3)
  const second=await s.replaceSingle(target,'single record');assert.equal(second.ok,true)
  assert.equal(parseAnchors(await fs.readFile(target)).records.length,1)
  const another=path.join(path.dirname(target),'legacy.md');await fs.writeFile(another,'# legacy\ncontent\n')
  const plan=planMigration(another,await fs.readFile(another));assert.equal((await s.applyPlan(another,plan)).ok,true)
  assert.equal(parseAnchors(await fs.readFile(another)).records[0].kind,'anchored')
})
test('verify mismatch remains written=true rather than pretending nothing was committed', async (t) => {
  const { target }=await fixture(t)
  const api={...fs,async rename(a,b){await fs.rename(a,b);if(b===target)await fs.writeFile(b,'externally changed')}}
  const r=await store(api).append(target,'intended');assert.equal(r.ok,false);assert.equal(r.reason,'verify-mismatch');assert.equal(r.written,true)
  const e=memoryWriteError('append',r);assert.equal(e.code,'MEMORY_WRITE_VERIFY_FAILED');assert.equal(e.written,true);assert.match(e.message,/verify current document before retrying/)
})
test('engine error keeps fs code, recovery path and explicit snapshot warning', () => {
  const r={reason:'write-failed:EPERM',errorCode:'MEMORY_WRITE_FAILED',fsCode:'EPERM',written:false,recoveryPath:'C:\\notes\\.dam-failed.tmp',recoveryComplete:true}
  const e=memoryWriteError('append',r);assert.equal(e.code,'MEMORY_WRITE_FAILED');assert.equal(e.fsCode,'EPERM');assert.equal(e.recoveryPath,r.recoveryPath)
  assert.equal(e.written,false);assert.match(e.message,/candidate snapshot/);assert.ok(e.message.includes(JSON.stringify(r.recoveryPath)))
})
