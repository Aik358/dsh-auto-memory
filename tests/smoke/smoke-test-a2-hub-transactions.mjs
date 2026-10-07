/**
 * smoke-test-a2-hub-transactions —— A2 / L-B（#250 C03 技能库跨进程事务 + #274 facts 全快照覆盖）
 * 的**真执行回归**。
 *
 * 判据纪律（CR-10）：每条都真 import → 真构造 → 真调用 → 断言**副作用**（磁盘字节），
 * 并且**跨进程**由真实子进程（`node <本文件> --worker`）产生 —— 单进程内存桩证明不了
 * 「另一个进程」这件事（本仓已知坑：run_code 内的 spawn 静默失效，故本套件一律走真实 node 进程）。
 *
 *   ① #250 陈旧写者不得吃掉另一进程的新增（合并不是覆盖）。
 *   ② #250 同一条目被两个进程各改一次 ⇒ **明确拒绝**（ok:false / procedure-conflict），
 *      且**冲突副本落盘可查**（<库目录>/conflicts/*.json 内含 base/local/onDisk 三方快照）。
 *   ③ #250 陈旧写者改自己的条目、别人新增别的条目 ⇒ 两边都保住。
 *   ④ #250 整库清空是跨进程 CAS：盘上变过 ⇒ 明确拒绝；先加载再清空 ⇒ 成功。
 *   ⑤ #250 库文件损坏 ⇒ 读**明确抛错**、写**明确拒写**且原始字节不变（旧实现返回空启动 ⇒ 空库覆盖）。
 *   ⑥ #274 进程 B（基于旧快照）写 ⇒ 进程 A 刚新增的 fact **不得消失**，两边都在盘上。
 *   ⑦ #274 无 transaction 的纯内存适配器：行为逐字节不变（不延迟、不多写）。
 *   ⑧ #274 写盘失败：返回 ok:false 且**盘上原始字节不变**（事务不落半成品）。
 *
 * 负路径（变异必红、还原复绿）：把 #250 的 commitDelta 接线与 #274 的 mutation 接线**真删**
 * 得到回退树（A2_SOURCE_ROOT 指向它），同一套断言必须以非零退出并报出对应 FAIL。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const ownRoot = fileURLToPath(new URL('../../', import.meta.url))
const root = process.env.A2_SOURCE_ROOT || ownRoot
const temp = fs.mkdtempSync(path.join(tmpdir(), 'a2-'))
let pass = 0, fail = 0
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra ? ' :: ' + extra : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href)
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function waitForFile(file, ms) {
  const t0 = Date.now()
  while (!fs.existsSync(file)) { if (Date.now() - t0 > ms) return false; await sleep(20) }
  return true
}

// ══════════════════════════════════════════════════════════════════════════
// 子进程 worker：真实另一个进程，读到「旧快照」后按信号继续
// ══════════════════════════════════════════════════════════════════════════
if (process.env.A2_WORKER === '1') {
  const spec = JSON.parse(process.env.A2_SPEC)
  const emit = (payload) => console.log('A2_RESULT ' + JSON.stringify(payload))
  const payload = { phase: 'done', results: [], loadError: null }
  try {
    if (spec.mode === 'facts') {
      const hub = await load('lib/hub-io.js')
      const { createFactStorePre } = await load('lib/fact-store.js')
      const health = hub.createHubIoHealthPre()
      const api = spec.fsFail
        ? { writeFileSync: (p, d, e) => { throw Object.assign(new Error('ENOSPC injected'), { code: 'ENOSPC' }) } }
        : undefined
      const hubIo = hub.createHubIoPre({ dir: spec.dir, health, ...(api ? { fsApi: api } : {}) })
      const store = createFactStorePre({ io: hubIo('facts.json'), now: () => spec.now || Date.now() })
      const disk = hubIo('facts.json').load()
      if (disk) store.restore(disk)
      if (spec.signalAfterLoad) fs.writeFileSync(spec.signalAfterLoad, 'loaded')
      if (spec.waitFor && !(await waitForFile(spec.waitFor, 30000))) emit({ ...payload, phase: 'wait-timeout' })
      for (const cand of (spec.facts || [])) {
        const r = store.upsert(cand) || {}
        payload.results.push({
          object: (r.fact && r.fact.object) || null, ok: r.ok, outcome: r.outcome,
          persisted: r.persisted, reason: r.reason || null, error: r.error || null,
        })
      }
    } else {
      const hub = await load('lib/hub-io.js')
      const io = hub.createScopedHubIoPre({
        globalDir: spec.dir, name: 'procedures.json',
        resolveWorkspace: () => ({ dir: spec.wsDir || '', key: spec.wsKey || '' }),
      })
      let snap = null
      try { snap = io.load() } catch (e) { payload.loadError = (e && e.code) || String((e && e.message) || e) }
      snap = snap || { schemaVersion: 1, procedures: [] }
      if (spec.signalAfterLoad) fs.writeFileSync(spec.signalAfterLoad, 'loaded')
      if (spec.waitFor && !(await waitForFile(spec.waitFor, 30000))) emit({ ...payload, phase: 'wait-timeout' })
      for (const op of (spec.ops || [])) {
        if (op.op === 'add') snap.procedures.push(op.row)
        else if (op.op === 'edit') {
          const hit = snap.procedures.find((p) => String(p && p.procedureId) === String(op.id))
          if (hit) Object.assign(hit, op.patch || {})
        } else if (op.op === 'reload') { try { snap = io.load() || snap } catch (e) { payload.loadError = (e && e.code) || String(e) } }
        else if (op.op === 'save') payload.results.push({ op: 'save', ...(io.save(snap) || {}) })
        else if (op.op === 'clear') payload.results.push({ op: 'clear', ...(io.clear() || {}) })
      }
      try { payload.loadIds = ((io.load() || {}).procedures || []).map((p) => String(p.procedureId)).sort() } catch (_) { payload.loadIds = null }
    }
  } catch (e) {
    payload.phase = 'threw'
    payload.error = String((e && e.stack) || e).slice(0, 800)
  }
  emit(payload)
  process.exit(0)
}

function spawnWorker(spec) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, A2_WORKER: '1', A2_SPEC: JSON.stringify(spec) }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = '', err = ''
  child.stdout.on('data', (d) => { out += String(d) })
  child.stderr.on('data', (d) => { err += String(d) })
  return { child, done: new Promise((res) => child.on('close', (code) => res({ code, out, err }))) }
}
function syncWorker(spec) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, A2_WORKER: '1', A2_SPEC: JSON.stringify(spec) }, encoding: 'utf8', timeout: 60000,
  })
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
}
const parseResult = (out) => {
  const line = String(out).split(/\r?\n/).find((l) => l.startsWith('A2_RESULT '))
  return line ? JSON.parse(line.slice('A2_RESULT '.length)) : null
}
const procIo = async (dir) => {
  const hub = await load('lib/hub-io.js')
  return hub.createScopedHubIoPre({ globalDir: dir, name: 'procedures.json', resolveWorkspace: () => ({ dir: '', key: '' }) })
}
const libFile = (dir) => path.join(dir, 'procedures.json')
const readLibIds = (dir) => {
  try { return (JSON.parse(fs.readFileSync(libFile(dir), 'utf8')).procedures || []).map((p) => String(p.procedureId)).sort() } catch (_) { return null }
}
const readLibRow = (dir, id) => {
  try { return (JSON.parse(fs.readFileSync(libFile(dir), 'utf8')).procedures || []).find((p) => String(p.procedureId) === id) || null } catch (_) { return null }
}
const SEED_ROW = (id, title) => ({ procedureId: id, title, stage: 'observed', scope: 'global', content: 'seed ' + id })
const FACTS = {
  a: { scope: 'Workspace', subject: 'alpha', predicate: 'uses', object: 'beta', sourceKind: 'explicit', provenance: ['src-a'], confidence: 0.9 },
  b: { scope: 'Workspace', subject: 'gamma', predicate: 'uses', object: 'delta', sourceKind: 'explicit', provenance: ['src-b'], confidence: 0.9 },
}
const readFacts = (dir) => {
  try { return (JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf8')).facts || []) } catch (_) { return null }
}

// ══ ① #250 陈旧写者不得吃掉另一进程的新增 ══
console.log('[A2] ① #250 任务库：另一进程的新增不得被旧快照覆盖')
{
  const dir = path.join(temp, 'lib1')
  const io0 = await procIo(dir)
  const seedRes = io0.save({ schemaVersion: 1, namespace: 'dsh-auto-memory-pre', procedures: [SEED_ROW('proc-r1', 'R1')] })
  ok(seedRes.ok === true, '① 种子库写入成功', JSON.stringify(seedRes.failures || seedRes.error))
  const loaded = path.join(temp, 'lib1.loaded'), go = path.join(temp, 'lib1.go')
  const s2 = spawnWorker({ mode: 'procedures', dir, signalAfterLoad: loaded, waitFor: go, ops: [{ op: 'add', row: SEED_ROW('proc-r3', 'R3') }, { op: 'save' }] })
  const arrived = await waitForFile(loaded, 20000)
  const s1 = syncWorker({ mode: 'procedures', dir, ops: [{ op: 'add', row: SEED_ROW('proc-r2', 'R2') }, { op: 'save' }] })
  const r1 = parseResult(s1.out)
  fs.writeFileSync(go, 'go')
  const r2 = parseResult((await s2.done).out)
  ok(arrived && r1 && r2, '① 两个子进程都跑完（含读后等待的陈旧写者）', 'arrived=' + arrived)
  ok(r1 && r1.results[0] && r1.results[0].ok === true, '① 进程 S1（先写）成功', JSON.stringify(r1 && r1.results[0]))
  ok(r2 && r2.results[0] && r2.results[0].ok === true, '① 进程 S2（陈旧写者）成功后写', JSON.stringify(r2 && r2.results[0]))
  const ids = readLibIds(dir)
  ok(JSON.stringify(ids) === JSON.stringify(['proc-r1', 'proc-r2', 'proc-r3']), '① 盘上三条都在（陈旧写者没有吃掉 S1 的新增）', JSON.stringify(ids))
}

// ══ ② #250 同一条目双方各改 ⇒ 明确拒绝 + 冲突副本落盘 ══
console.log('[A2] ② #250 同一条目并发改：明确拒绝并落冲突副本')
{
  const dir = path.join(temp, 'lib2')
  const io0 = await procIo(dir)
  io0.save({ schemaVersion: 1, namespace: 'dsh-auto-memory-pre', procedures: [SEED_ROW('proc-s1', 'v1')] })
  const loaded = path.join(temp, 'lib2.loaded'), go = path.join(temp, 'lib2.go')
  const s2 = spawnWorker({ mode: 'procedures', dir, signalAfterLoad: loaded, waitFor: go, ops: [{ op: 'edit', id: 'proc-s1', patch: { title: 'B' } }, { op: 'save' }] })
  const arrived = await waitForFile(loaded, 20000)
  const s1 = syncWorker({ mode: 'procedures', dir, ops: [{ op: 'edit', id: 'proc-s1', patch: { title: 'A' } }, { op: 'save' }] })
  const r1 = parseResult(s1.out)
  fs.writeFileSync(go, 'go')
  const r2 = parseResult((await s2.done).out)
  const s2save = r2 && r2.results[0]
  ok(arrived && r1 && r2, '② 两个子进程都跑完', 'arrived=' + arrived)
  const s1save = r1 && r1.results[0]
  const refuse = s2save && Array.isArray(s2save.failures) ? s2save.failures.find((f) => f.reason === 'procedure-conflict') : null
  ok(s1.code === 0 && s1save && s1save.ok === true, '② 进程 S1 改条目成功（盘上 = A）', JSON.stringify(s1save))
  ok(s2save && s2save.ok === false && !!(refuse || /procedure-conflict/.test(String(s2save.error))), '② 进程 S2 被**明确拒绝**（不是静默覆盖）', JSON.stringify(s2save))
  ok(readLibRow(dir, 'proc-s1').title === 'A', '② 盘上仍是先写者 A 的版本（拒绝者没落地）', JSON.stringify(readLibRow(dir, 'proc-s1')))
  const cdir = path.join(dir, 'conflicts')
  const files = fs.existsSync(cdir) ? fs.readdirSync(cdir) : []
  let copy = null
  try { copy = JSON.parse(fs.readFileSync(path.join(cdir, files[0]), 'utf8')) } catch (_) {}
  ok(files.length >= 1, '② 冲突副本落盘可查（<库目录>/conflicts/）', JSON.stringify(files))
  ok(!!copy && copy.procedureId === 'proc-s1' && !!copy.base && !!copy.local && !!copy.onDisk,
    '② 副本含三方快照 + 冲突条目 id（base/local/onDisk）', JSON.stringify(copy && Object.keys(copy)))
  ok(!!(refuse && refuse.conflictFile) && fs.existsSync(refuse.conflictFile), '② 拒绝结果回带副本路径且文件存在', String(refuse && refuse.conflictFile))
  ok(!!(refuse && refuse.procedureId === 'proc-s1'), '② 拒绝结果点名冲突条目（procedureId）', JSON.stringify(refuse))
}

// ══ ③ #250 陈旧写者改自己的条目 + 别人新增 ⇒ 两边都保住 ══
console.log('[A2] ③ #250 陈旧写者改自己条目：与别人新增互不吞并')
{
  const dir = path.join(temp, 'lib3')
  const io0 = await procIo(dir)
  io0.save({ schemaVersion: 1, namespace: 'dsh-auto-memory-pre', procedures: [SEED_ROW('proc-t1', 'v1')] })
  const loaded = path.join(temp, 'lib3.loaded'), go = path.join(temp, 'lib3.go')
  const s2 = spawnWorker({ mode: 'procedures', dir, signalAfterLoad: loaded, waitFor: go, ops: [{ op: 'edit', id: 'proc-t1', patch: { title: 'v2' } }, { op: 'save' }] })
  const arrived = await waitForFile(loaded, 20000)
  syncWorker({ mode: 'procedures', dir, ops: [{ op: 'add', row: SEED_ROW('proc-t2', 'T2') }, { op: 'save' }] })
  fs.writeFileSync(go, 'go')
  const r2 = parseResult((await s2.done).out)
  ok(arrived && r2 && r2.results[0] && r2.results[0].ok === true, '③ 陈旧写者的改动被接受', JSON.stringify(r2 && r2.results[0]))
  const ids = readLibIds(dir)
  ok(JSON.stringify(ids) === JSON.stringify(['proc-t1', 'proc-t2']), '③ 两条都在（新增与改动都保住了）', JSON.stringify(ids))
  ok(readLibRow(dir, 'proc-t1').title === 'v2', '③ 条目内容 = 陈旧写者的新版本', JSON.stringify(readLibRow(dir, 'proc-t1')))
}

// ══ ④ #250 整库清空是跨进程 CAS ══
console.log('[A2] ④ #250 清空是 CAS：盘上变过 ⇒ 拒绝；先加载再清 ⇒ 成功')
{
  const dir = path.join(temp, 'lib4')
  const io0 = await procIo(dir)
  io0.save({ schemaVersion: 1, namespace: 'dsh-auto-memory-pre', procedures: [SEED_ROW('proc-c1', 'C1')] })
  const loaded = path.join(temp, 'lib4.loaded'), go = path.join(temp, 'lib4.go')
  const s2 = spawnWorker({ mode: 'procedures', dir, signalAfterLoad: loaded, waitFor: go, ops: [{ op: 'clear' }] })
  const arrived = await waitForFile(loaded, 20000)
  syncWorker({ mode: 'procedures', dir, ops: [{ op: 'add', row: SEED_ROW('proc-c2', 'C2') }, { op: 'save' }] })
  fs.writeFileSync(go, 'go')
  const r2 = parseResult((await s2.done).out)
  const cleared = r2 && r2.results[0]
  ok(arrived && cleared && cleared.ok === false && cleared.reason === 'procedure-clear-conflict',
    '④ 陈旧清空被明确拒绝（procedure-clear-conflict）', JSON.stringify(cleared))
  const ids = readLibIds(dir)
  ok(JSON.stringify(ids) === JSON.stringify(['proc-c1', 'proc-c2']), '④ 拒绝后盘上条目一个没少', JSON.stringify(ids))
  const ioFresh = await procIo(dir)
  ioFresh.load()
  const cr = ioFresh.clear()
  ok(cr.ok === true && readLibIds(dir) === null, '④ 先加载再清空 ⇒ 成功且文件已删', JSON.stringify(cr))
}

// ══ ⑤ #250 损坏库：读明确抛错、写明确拒写、字节不变 ══
console.log('[A2] ⑤ #250 损坏库：拒绝读空启动 + 拒绝覆盖')
{
  const dir = path.join(temp, 'lib5')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(libFile(dir), '{ this is not json', 'utf8')
  const before = sha256(libFile(dir))
  const io = await procIo(dir)
  let code = null
  try { io.load() } catch (e) { code = e && e.code }
  ok(code === 'DAM-CORRUPT-LIBRARY', '⑤ 读损坏库 ⇒ 明确抛错（不再返回空启动）', String(code))
  const sr = io.save({ schemaVersion: 1, namespace: 'dsh-auto-memory-pre', procedures: [SEED_ROW('proc-x', 'X')] })
  ok(sr.ok === false, '⑤ 写损坏库 ⇒ 明确拒写', JSON.stringify(sr.failures || sr.error))
  ok(sha256(libFile(dir)) === before, '⑤ 拒写后原始字节逐字节不变', before)
}

// ══ ⑥ #274 陈旧进程写 facts ⇒ 另一进程新增不得消失 ══
console.log('[A2] ⑥ #274 facts：陈旧进程写入不得吃掉另一进程的新增')
{
  const dir = path.join(temp, 'facts1')
  fs.mkdirSync(dir, { recursive: true })
  const loaded = path.join(temp, 'facts1.loaded'), go = path.join(temp, 'facts1.go')
  const sB = spawnWorker({ mode: 'facts', dir, signalAfterLoad: loaded, waitFor: go, facts: [FACTS.b] })
  const arrived = await waitForFile(loaded, 20000)
  const sA = syncWorker({ mode: 'facts', dir, facts: [FACTS.a] })
  const rA = parseResult(sA.out)
  fs.writeFileSync(go, 'go')
  const rB = parseResult((await sB.done).out)
  ok(arrived && rA && rB, '⑥ 两个子进程都跑完', 'arrived=' + arrived)
  ok(rA.results[0] && rA.results[0].ok === true, '⑥ 进程 A 新增 fact 成功', JSON.stringify(rA && rA.results[0]))
  ok(rB.results[0] && rB.results[0].ok === true, '⑥ 进程 B（陈旧）写入成功', JSON.stringify(rB && rB.results[0]))
  const facts = readFacts(dir) || []
  const objs = facts.map((f) => String(f.object)).sort()
  ok(objs.includes('beta') && objs.includes('delta'), '⑥ A 的新增**没有**被 B 的旧快照吃掉（两条都在盘上）', JSON.stringify(objs))
  const aRow = facts.find((f) => String(f.object) === 'beta')
  ok(!!aRow && aRow.provenance && aRow.provenance.includes('src-a'), '⑥ A 的记录内容完整（provenance 未被改写）', JSON.stringify(aRow && aRow.provenance))
  ok(rB.results[0].persisted === true && readFacts(dir).length === 2, '⑥ B 的结果如实报 persisted 且盘上恰好两条', JSON.stringify(rB.results[0]))
}

// ══ ⑦ #274 无 transaction 的纯内存适配器：行为不变 ══
console.log('[A2] ⑦ #274 纯内存适配器（无 transaction）：行为逐字节不变')
{
  const { createFactStorePre } = await load('lib/fact-store.js')
  const calls = { saves: 0, clears: 0, last: null }
  const io = { save: (s) => { calls.saves++; calls.last = s }, load: () => null, clear: () => { calls.clears++ } }
  const store = createFactStorePre({ io, now: () => 5000 })
  const r = store.upsert(FACTS.a)
  ok(r.ok === true && r.persisted === true && r.outcome === 'created', '⑦ upsert 返回值形状不变（ok/persisted/outcome）', JSON.stringify({ ok: r.ok, persisted: r.persisted, outcome: r.outcome }))
  ok(calls.saves === 1 && calls.last && calls.last.facts.length === 1, '⑦ 同步落盘一次、快照为全量（未被延迟）', 'saves=' + calls.saves)
  ok(r.written === undefined && r.deferred === undefined, '⑦ 无事务适配器不引入新字段（written/deferred）', JSON.stringify(Object.keys(r)))
  const dr = store.dispose()
  ok(dr.ok === true && calls.saves === 2, '⑦ dispose 仍立即落盘', 'saves=' + calls.saves)
}

// ══ ⑦b #274 批内喂入：多行决策能看到本批前几行，批末仍只落一次 ══
console.log('[A2] ⑦b #274 批内多行：决策链连续、落盘一次')
{
  const dir = path.join(temp, 'facts3')
  fs.mkdirSync(dir, { recursive: true })
  const hub = await load('lib/hub-io.js')
  const { createFactStorePre } = await load('lib/fact-store.js')
  const factory = hub.createHubIoPre({ dir, health: hub.createHubIoHealthPre() })
  const store = createFactStorePre({ io: factory('facts.json'), now: () => 9000 })
  factory.beginBatch()
  const rA = store.upsert(FACTS.a)
  // 同一 subject+predicate、不同 object ⇒ 第 2 行必须是**冲突**（说明它看见了第 1 行）。
  const rB = store.upsert({ ...FACTS.a, object: 'gamma', provenance: ['src-b'] })
  const end = factory.endBatch()
  const disk = readFacts(dir) || []
  ok(rA.ok === true && rA.outcome === 'created', '⑦b 批内第 1 行入库', JSON.stringify({ ok: rA.ok, outcome: rA.outcome }))
  ok(rB.ok === true && rB.outcome === 'conflict-added', '⑦b 批内第 2 行看得见第 1 行（判为冲突，而非重复新建）', JSON.stringify({ ok: rB.ok, outcome: rB.outcome }))
  ok(end && end.written === 1, '⑦b 批末只落盘一次（written=1）', JSON.stringify(end))
  ok(disk.length === 1 && String(disk[0].object) === 'beta', '⑦b 盘上只有已入库那一条（冲突未落成第二条事实）', JSON.stringify(disk.map((f) => f.object)))
}

// ══ ⑧ #274 写盘失败：ok:false 且盘上原始字节不变 ══
console.log('[A2] ⑧ #274 落盘失败：返回失败且不落半成品')
{
  const dir = path.join(temp, 'facts2')
  fs.mkdirSync(dir, { recursive: true })
  const hub = await load('lib/hub-io.js')
  const { createFactStorePre } = await load('lib/fact-store.js')
  const good = hub.createHubIoPre({ dir, health: hub.createHubIoHealthPre() })
  const st0 = createFactStorePre({ io: good('facts.json'), now: () => 7000 })
  st0.upsert(FACTS.a)
  const before = sha256(path.join(dir, 'facts.json'))
  const failing = hub.createHubIoPre({
    dir, health: hub.createHubIoHealthPre(),
    fsApi: { writeFileSync: () => { throw Object.assign(new Error('ENOSPC injected'), { code: 'ENOSPC' }) } },
  })
  const store = createFactStorePre({ io: failing('facts.json'), now: () => 8000 })
  store.restore(failing('facts.json').load())
  const r = store.upsert(FACTS.b)
  ok(r.ok === false && r.persisted === false, '⑧ 写失败 ⇒ ok:false / persisted:false（不再报成功）', JSON.stringify({ ok: r.ok, persisted: r.persisted, reason: r.reason }))
  ok(sha256(path.join(dir, 'facts.json')) === before, '⑧ 盘上原始字节逐字节不变（无半成品）', before)
  const after = readFacts(dir) || []
  ok(after.length === 1 && String(after[0].object) === 'beta', '⑧ 磁盘仍是失败前那一条', JSON.stringify(after.map((f) => f.object)))
}

// ══ ⑩ #250 带 pending 的装载路径：本进程未落盘的改动与别人新增互不吞并 ══
console.log('[A2] ⑩ #250 load({pendingSnapshot})：pending 差分叠加到磁盘态')
{
  const dir = path.join(temp, 'lib10')
  const a = await procIo(dir)
  a.save({ schemaVersion: 1, namespace: 'dsh-auto-memory-pre', procedures: [SEED_ROW('proc-p1', 'v1')] })
  // 另一个写者（同进程、独立实例 = 独立「上次看到的版本」）新增 proc-p2
  const b = await procIo(dir)
  const bSnap = b.load() || { schemaVersion: 1, procedures: [] }
  bSnap.procedures.push(SEED_ROW('proc-p2', 'P2'))
  const bRes = b.save(bSnap)
  ok(bRes.ok === true, '⑩ 第二个写者新增成功', JSON.stringify(bRes.failures || bRes.error))
  const merged = a.load({ pendingSnapshot: { schemaVersion: 1, procedures: [SEED_ROW('proc-p1', 'v2')] } })
  const ids = (merged.procedures || []).map((p) => String(p.procedureId) + '@' + p.title).sort()
  ok(JSON.stringify(ids) === JSON.stringify(['proc-p1@v2', 'proc-p2@P2']),
    '⑩ pending 的改动生效、别人新增的那条同时保住', JSON.stringify(ids))
  // 负路径：本进程看到 p1 之后，**别人又改过 p1**，此时 pending 再改 p1 ⇒ 必须明确抛冲突，而不是拿一边覆盖
  const c1 = await procIo(dir)
  c1.load()
  const c2 = await procIo(dir)
  const c2Snap = c2.load()
  const row = (c2Snap.procedures || []).find((p) => String(p.procedureId) === 'proc-p1')
  row.title = '别改的版本'
  ok(c2.save(c2Snap).ok === true, '⑩ 第二个写者改掉 proc-p1（本进程 a 已看不到这次改动）', '')
  let conflict = null
  try {
    c1.load({ pendingSnapshot: { schemaVersion: 1, procedures: [SEED_ROW('proc-p1', '我改的版本')] } })
  } catch (e) { conflict = e && e.code }
  ok(conflict === 'DAM-PROCEDURE-CONFLICT', '⑩ 磁盘已被别人改过的行 ⇒ 明确抛冲突（不静默覆盖）', String(conflict))
  ok(readLibRow(dir, 'proc-p1').title === '别改的版本', '⑩ 冲突后盘上仍是磁盘方的版本（抛错路径一个字节没写）', JSON.stringify(readLibRow(dir, 'proc-p1')))
}

// ══════════════════════════════════════════════════════════════════════════
// ⑨ 负路径：回退树（真删两处接线）⇒ 关键断言必红
// ══════════════════════════════════════════════════════════════════════════
if (!process.env.A2_SOURCE_ROOT) {
  console.log('[A2] ⑨ 负路径：回退树（真删 #250/#274 接线）必须让断言变红')
  const negRoot = path.join(temp, 'a2-negative')
  await fsp.cp(path.join(ownRoot, 'lib'), path.join(negRoot, 'lib'), { recursive: true })
  const revert = (file, pairs) => {
    let text = fs.readFileSync(file, 'utf8')
    for (const [from, to] of pairs) {
      const hits = text.split(from).length - 1
      assert.equal(hits, 1, '回退锚点必须恰好命中 1 次: ' + file + ' :: ' + from.slice(0, 70))
      text = text.split(from).join(to)
    }
    fs.writeFileSync(file, text, 'utf8')
  }
  revert(path.join(negRoot, 'lib/hub-io.js'), [
    ['commitDelta(globalDir, Object.assign({}, snapshot, { procedures: globals }))', 'writeLibGuarded(globalDir, Object.assign({}, snapshot, { procedures: globals }))'],
    ['commitDelta(w.dir, Object.assign({}, snapshot, { procedures: mine }))', 'writeLibGuarded(w.dir, Object.assign({}, snapshot, { procedures: mine }))'],
  ])
  revert(path.join(negRoot, 'lib/fact-store.js'), [
    ['upsert: mutation(upsert), supersede: mutation(supersede)', 'upsert, supersede'],
    ['clear: mutation(clear, { cleared: false }),', 'clear,'],
  ])
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, A2_SOURCE_ROOT: negRoot }, encoding: 'utf8', timeout: 240000,
  })
  const out = String(child.stdout || '')
  const fails = out.split(/\r?\n/).filter((l) => /FAIL/.test(l))
  ok(child.status === 1, '⑨ 回退树：套件必须以非零退出（变异必红）', 'status=' + child.status)
  ok(fails.length >= 3, '⑨ 回退树：至少三条关键断言变红', 'fails=' + fails.length)
  ok(fails.some((l) => /① 盘上三条都在/.test(l)), '⑨ 回退树：#250 覆盖丢条被断言抓到', fails.join(' | ').slice(0, 240))
  ok(fails.some((l) => /② 进程 S2 被\*\*明确拒绝\*\*/.test(l)), '⑨ 回退树：#250 静默覆盖被断言抓到', '')
  ok(fails.some((l) => /⑥ A 的新增\*\*没有\*\*被 B 的旧快照吃掉/.test(l)), '⑨ 回退树：#274 陈旧快照吃掉新增被断言抓到', '')
  console.log('  [负路径] 回退树 status=' + child.status + '，红断言 ' + fails.length + ' 条')
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
try { fs.rmSync(temp, { recursive: true, force: true }) } catch (_) {}
process.exit(fail ? 1 : 0)
