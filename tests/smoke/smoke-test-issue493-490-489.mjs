#!/usr/bin/env node
/**
 * smoke-test-issue493-490-489.mjs —— 批次 E 三缺陷 ★真 import → 真构造 → 真调用 → 断言返回值。
 *
 * 覆盖（每条都带**负路径/变异**，见文件末尾 §变异）：
 *  #493 异步 applier 未被等待
 *    ① async applier 返回 {ok:false} ⇒ 必须被识别为失败、**游标不前进**
 *    ② applier 永不 resolve ⇒ 超时后游标不动、pullOnce 正常返回（不挂死）
 *    ③ 同步 applier 返回 {ok:true} ⇒ 仍正常 applied（旧契约不破）
 *    ④ 病态 thenable（await 后仍是 thenable）⇒ 拒绝，不当成功
 *  #490 no-event-store 在 team-pull 侧的止血
 *    ⑤ async applier 回 {ok:false, reason:'no-event-store'} ⇒ deferred/游标不动
 *    ⑥ 同批混合（一条成功 + 一条 no-event-store）⇒ 游标仍不动、成功那条照常计 applied
 *  #489 事件增量共用 eventId 队列键
 *    ⑦ create → append(A) → append(B) 连续入队 ⇒ 队列 **3 条**
 *    ⑧ 同一操作重复入队 ⇒ 去重为 1 条（幂等保留）
 *    ⑨ fact（完整快照）同键新负载 ⇒ 仍**原位替换**（既有语义不许被改坏）
 *    ⑩ 三条增量经真 flush 发出 ⇒ 发送器收到 3 条且顺序为 create/append/append
 *    ⑪ 落盘后重新 load ⇒ 3 条仍在（操作身份从 payload 重算，不加磁盘字段）
 */
import assert from 'node:assert'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const PULL_URL = pathToFileURL(path.join(ROOT, 'lib', 'team-pull.js')).href
const OUTBOX_URL = pathToFileURL(path.join(ROOT, 'lib', 'team-outbox.js')).href

const { createTeamPuller } = await import(PULL_URL)
const { createTeamOutbox } = await import(OUTBOX_URL)

// ★临时目录必须落在系统临时区（DSH run_code 沙箱里 os.tmpdir() 可能返回相对串 ⇒ 判绝对路径）
const baseTmp = (function () {
  const t = os.tmpdir()
  return (t && path.isAbsolute(t)) ? t : fs.mkdtempSync(path.join(ROOT, '.tmp-493-'))
})()
const TMP = mkdtempSync(path.join(baseTmp, 'issue493-'))

let pass = 0
let fail = 0
const failures = []
function ok(name, fn) {
  try { fn(); pass++ } catch (e) {
    fail++
    failures.push(name + ' :: ' + String((e && e.message) || e).slice(0, 240))
    console.log('FAIL - ' + name + ' :: ' + String((e && e.message) || e).slice(0, 240))
  }
}
function okAsync(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { pass++ },
    (e) => {
      fail++
      failures.push(name + ' :: ' + String((e && e.message) || e).slice(0, 240))
      console.log('FAIL - ' + name + ' :: ' + String((e && e.message) || e).slice(0, 240))
    },
  )
}

const mkEngine = () => ({ config: { teamEnabled: true, teamId: 't1', teamProjectId: 'p1' }, _teamEpoch: 0, _teamPaused: false, _teamDisposed: false })
const mkFetch = (changes, cursor) => async () => ({ ok: true, data: { cursor: cursor, changes: changes } })

// ══════════════════════════════════════════════════════════════════
// #493 ①：async applier 返回 {ok:false} ⇒ 不 applied、游标不前进
// ══════════════════════════════════════════════════════════════════
await okAsync('#493 async applier 返回 {ok:false} ⇒ 拒收、游标不前进', async () => {
  const engine = mkEngine()
  let cursorSaved = null
  const puller = createTeamPuller({
    engine,
    fetchJson: mkFetch([{ kind: 'event', key: 'evt_1', payload: { op: 'create', eventId: 'evt_1' } }], 'c_100'),
    appliers: { event: async () => { await new Promise((r) => setTimeout(r, 5)); return { ok: false, reason: 'boom' } } },
    saveCursor: (c) => { cursorSaved = c; return { ok: true } },
  })
  const r = await puller.pullOnce()
  assert.equal(r.applied, 0, 'applied 必须为 0（异步失败不许计成功），实得 ' + r.applied)
  assert.equal(r.ok, false, 'promise 必须不是 ok:true，实得 ' + JSON.stringify(r))
  assert.equal(cursorSaved, null, '游标不得落盘推进，实得 ' + JSON.stringify(cursorSaved))
  assert.ok((r.deferred || 0) + (r.rejected || 0) === 1, '该条必须被计为 deferred 或 rejected，实得 ' + JSON.stringify(r))
})

// ══════════════════════════════════════════════════════════════════
// #493 ②：applier 永不 resolve ⇒ 超时安全网（游标不动、不挂死）
// ══════════════════════════════════════════════════════════════════
await okAsync('#493 applier 永不 resolve ⇒ 超时后游标不动且 pullOnce 正常返回', async () => {
  const engine = mkEngine()
  let cursorSaved = null
  const t0 = Date.now()
  const puller = createTeamPuller({
    engine,
    fetchJson: mkFetch([{ kind: 'event', key: 'evt_hang', payload: {} }], 'c_200'),
    appliers: { event: () => new Promise(() => {}) },   // 永不落定
    applierTimeoutMs: 80,
    saveCursor: (c) => { cursorSaved = c; return { ok: true } },
  })
  const r = await puller.pullOnce()
  const cost = Date.now() - t0
  assert.ok(cost < 3000, 'pullOnce 必须在超时后返回而不是挂死，实耗 ' + cost + 'ms')
  assert.equal(r.ok, false, '超时必须判负，实得 ' + JSON.stringify(r))
  assert.equal(r.applied, 0, 'applied 必须 0，实得 ' + r.applied)
  assert.ok(r.deferred === 1, '超时归入 deferred（临时、可重放），实得 ' + JSON.stringify(r))
  assert.deepEqual(r.deferredCodes, ['applier-timeout'], 'deferredCodes 必须带 applier-timeout，实得 ' + JSON.stringify(r.deferredCodes))
  assert.equal(cursorSaved, null, '游标不得推进，实得 ' + JSON.stringify(cursorSaved))
  assert.ok(cursorSaved === null && r.since === 0, 'since 必须停在 0，实得 ' + r.since)
})

// ══════════════════════════════════════════════════════════════════
// #493 ③：同步 applier 返回 {ok:true} ⇒ 仍正常 applied（旧契约不破）
// ══════════════════════════════════════════════════════════════════
await okAsync('#493 同步 applier {ok:true} ⇒ 正常 applied 且游标前进', async () => {
  const engine = mkEngine()
  let cursorSaved = null
  let sawPayload = null
  const puller = createTeamPuller({
    engine,
    fetchJson: mkFetch([{ kind: 'fact', key: 'F1', payload: { v: 7 } }], 'c_300'),
    appliers: { fact: (payload) => { sawPayload = payload; return { ok: true, outcome: 'applied' } } },
    saveCursor: (c) => { cursorSaved = c; return { ok: true } },
  })
  const r = await puller.pullOnce()
  assert.equal(r.ok, true, '同步成功必须 ok:true，实得 ' + JSON.stringify(r))
  assert.equal(r.applied, 1, 'applied 必须 1，实得 ' + r.applied)
  assert.deepEqual(sawPayload, { v: 7 }, 'payload 必须原样送到 applier，实得 ' + JSON.stringify(sawPayload))
  assert.equal(cursorSaved, 'c_300', '游标必须前进到 c_300，实得 ' + JSON.stringify(cursorSaved))
})

// ══════════════════════════════════════════════════════════════════
// #493 ④：病态 thenable（await 之后仍是 thenable）⇒ 拒绝
// ══════════════════════════════════════════════════════════════════
await okAsync('#493 async applier 抛 EACCES ⇒ 仍按既有判据归为临时失败（try/catch 分类未被改坏）', async () => {
  const engine = mkEngine()
  let cursorSaved = null
  const puller = createTeamPuller({
    engine,
    fetchJson: mkFetch([{ kind: 'event', key: 'evt_eacces', payload: {} }], 'c_400'),
    appliers: {
      event: async () => {
        await new Promise((r) => setTimeout(r, 2))
        const e = new Error('EACCES: permission denied')
        e.code = 'EACCES'
        throw e
      },
    },
    saveCursor: (c) => { cursorSaved = c; return { ok: true } },
  })
  const r = await puller.pullOnce()
  assert.equal(r.ok, false, '必须 ok:false，实得 ' + JSON.stringify(r))
  assert.equal(r.applied, 0, 'applied 必须 0，实得 ' + r.applied)
  assert.equal(r.deferred, 1, 'EACCES 必须归 deferred（临时），实得 ' + JSON.stringify(r))
  assert.deepEqual(r.deferredCodes, ['EACCES'], 'deferredCodes 必须带 EACCES，实得 ' + JSON.stringify(r.deferredCodes))
  assert.equal(cursorSaved, null, '临时失败不得推进游标，实得 ' + JSON.stringify(cursorSaved))
})

// ══════════════════════════════════════════════════════════════════
// #490 ⑤：async applier 回 {ok:false, reason:'no-event-store'} ⇒ 游标不动
// ══════════════════════════════════════════════════════════════════
await okAsync('#490 async applier 回 no-event-store ⇒ 不计 applied、游标不动', async () => {
  const engine = mkEngine()
  let cursorSaved = null
  const puller = createTeamPuller({
    engine,
    fetchJson: mkFetch([{ kind: 'event', key: 'evt_490', payload: { op: 'create', eventId: 'evt_490' } }], 'c_500'),
    appliers: { event: async () => ({ ok: false, reason: 'no-event-store' }) },
    saveCursor: (c) => { cursorSaved = c; return { ok: true } },
  })
  const r = await puller.pullOnce()
  assert.equal(r.applied, 0, 'no-event-store 必须不计 applied，实得 ' + r.applied)
  assert.equal(r.ok, false, '必须 ok:false（可重放），实得 ' + JSON.stringify(r))
  assert.equal(cursorSaved, null, '游标必须停在原处（否则这些事件永不重投），实得 ' + JSON.stringify(cursorSaved))
})

// ══════════════════════════════════════════════════════════════════
// #490 ⑥：同批混合（成功 + no-event-store）⇒ 游标仍不动、成功那条照常 applied
// ══════════════════════════════════════════════════════════════════
await okAsync('#490 混合批（1 成功 + 1 no-event-store）⇒ 游标不动、applied=1', async () => {
  const engine = mkEngine()
  let cursorSaved = null
  const puller = createTeamPuller({
    engine,
    fetchJson: mkFetch([
      { kind: 'fact', key: 'F9', payload: { v: 1 } },
      { kind: 'event', key: 'evt_x', payload: { op: 'create', eventId: 'evt_x' } },
    ], 'c_600'),
    appliers: {
      fact: () => ({ ok: true }),
      event: async () => ({ ok: false, reason: 'no-event-store' }),
    },
    saveCursor: (c) => { cursorSaved = c; return { ok: true } },
  })
  const r = await puller.pullOnce()
  assert.equal(r.applied, 1, '成功那条必须计 applied，实得 ' + r.applied)
  assert.equal(r.ok, false, '有失败项必须 ok:false，实得 ' + JSON.stringify(r))
  assert.equal(cursorSaved, null, '整批不前进（否则失败那条永不重放），实得 ' + JSON.stringify(cursorSaved))
  assert.ok(r.deferred >= 1, '失败那条必须 deferred，实得 ' + JSON.stringify(r))
})

// ══════════════════════════════════════════════════════════════════
// #489 ⑦：create → append(A) → append(B) ⇒ 队列 3 条
// ══════════════════════════════════════════════════════════════════
const obDir = path.join(TMP, 'ob1')
ok('#489 同事件连续 3 条增量 ⇒ 队列 3 条（旧实现只剩 1 条）', () => {
  const ob = createTeamOutbox({ dir: obDir, file: path.join(obDir, 'outbox.json'), maxItems: 100 })
  const r1 = ob.enqueue({ kind: 'event', key: 'evt_1', payload: { op: 'create', eventId: 'evt_1', name: 'A' } })
  const r2 = ob.enqueue({ kind: 'event', key: 'evt_1', payload: { op: 'append', eventId: 'evt_1', checkpoint: { text: 'X' } } })
  const r3 = ob.enqueue({ kind: 'event', key: 'evt_1', payload: { op: 'append', eventId: 'evt_1', checkpoint: { text: 'Y' } } })
  assert.equal(r1.ok, true); assert.equal(r2.ok, true); assert.equal(r3.ok, true)
  assert.equal(r2.dup === true, false, '第 2 条不同操作不得被判 dup')
  assert.equal(r3.dup === true, false, '第 3 条不同操作不得被判 dup')
  assert.equal(ob.list().length, 3, '队列必须是 3 条，实得 ' + ob.list().length)
  assert.deepEqual(ob.list().map((x) => x.payload.op), ['create', 'append', 'append'], '顺序必须是 create→append→append')
  assert.deepEqual(ob.list().map((x) => x.payload.checkpoint && x.payload.checkpoint.text), [undefined, 'X', 'Y'], '两个检查点必须都在')
})

// ══════════════════════════════════════════════════════════════════
// #489 ⑧：同一操作重复入队 ⇒ 去重 1 条
// ══════════════════════════════════════════════════════════════════
ok('#489 同一操作重复入队 ⇒ 去重（幂等语义保留）', () => {
  const dir = path.join(TMP, 'ob2')
  const ob = createTeamOutbox({ dir, file: path.join(dir, 'outbox.json'), maxItems: 100 })
  const item = { kind: 'event', key: 'evt_2', payload: { op: 'append', eventId: 'evt_2', checkpoint: { text: 'Z' } } }
  const a = ob.enqueue(item)
  const b = ob.enqueue({ kind: 'event', key: 'evt_2', payload: { op: 'append', eventId: 'evt_2', checkpoint: { text: 'Z' } } })
  assert.equal(a.ok, true); assert.equal(b.ok, true)
  assert.equal(b.dup, true, '逐字节相同的重复操作必须判 dup，实得 ' + JSON.stringify(b))
  assert.equal(ob.list().length, 1, '必须只剩 1 条，实得 ' + ob.list().length)
})

// ══════════════════════════════════════════════════════════════════
// #489 ⑨：fact 同键新负载 ⇒ 仍原位替换（既有语义不许被改坏）
// ══════════════════════════════════════════════════════════════════
ok('#489 负路径：fact 完整快照同键新负载 ⇒ 仍原位替换 = 1 条', () => {
  const dir = path.join(TMP, 'ob3')
  const ob = createTeamOutbox({ dir, file: path.join(dir, 'outbox.json'), maxItems: 100 })
  ob.enqueue({ kind: 'fact', key: 'K1', payload: { v: 1 } })
  const b = ob.enqueue({ kind: 'fact', key: 'K1', payload: { v: 2 } })
  assert.equal(b.updated, true, 'fact 同键新负载必须 updated，实得 ' + JSON.stringify(b))
  assert.equal(ob.list().length, 1, 'fact 必须仍原位替换为 1 条，实得 ' + ob.list().length)
  assert.deepEqual(ob.list()[0].payload, { v: 2 }, '必须保留最新负载')
})

// ══════════════════════════════════════════════════════════════════
// #489 ⑩：真 flush ⇒ 发送器收到 3 条且顺序正确
// ══════════════════════════════════════════════════════════════════
await okAsync('#489 三条增量经真 flush ⇒ 发送器收到 3 条且顺序正确', async () => {
  const dir = path.join(TMP, 'ob4')
  const ob = createTeamOutbox({ dir, file: path.join(dir, 'outbox.json'), maxItems: 100 })
  ob.enqueue({ kind: 'event', key: 'evt_3', payload: { op: 'create', eventId: 'evt_3', name: 'N' } })
  ob.enqueue({ kind: 'event', key: 'evt_3', payload: { op: 'append', eventId: 'evt_3', checkpoint: { text: 'X' } } })
  ob.enqueue({ kind: 'event', key: 'evt_3', payload: { op: 'append', eventId: 'evt_3', checkpoint: { text: 'Y' } } })
  const sent = []
  const res = await ob.flush(async (entry) => { sent.push(entry) })
  assert.equal(sent.length, 3, '发送器必须收到 3 条，实得 ' + sent.length)
  assert.deepEqual(sent.map((x) => x.payload.op), ['create', 'append', 'append'], '发送顺序必须是 create→append→append')
  assert.deepEqual(sent.map((x) => x.payload.checkpoint && x.payload.checkpoint.text), [undefined, 'X', 'Y'])
  assert.equal(new Set(sent.map((x) => x.id)).size, 3, '三条的 id 必须互不相同，实得 ' + JSON.stringify(sent.map((x) => x.id)))
  assert.equal(res.sent, 3, 'flush 必须报 sent:3，实得 ' + JSON.stringify(res))
  assert.equal(ob.size(), 0, '发出后队列必须清空，实得 ' + ob.size())
})

// ══════════════════════════════════════════════════════════════════
// #489 ⑪：落盘后重新 load ⇒ 3 条仍在（操作身份从 payload 重算，不加磁盘字段）
// ══════════════════════════════════════════════════════════════════
ok('#489 落盘后新实例 load ⇒ 3 条仍在且磁盘无新增字段', () => {
  const dir = path.join(TMP, 'ob5')
  // ★文件名由模块常量决定（TEAM_OUTBOX_FILENAME_PRE = 'team-outbox.json'），不传 file 选项
  const file = path.join(dir, 'team-outbox.json')
  const ob = createTeamOutbox({ dir, maxItems: 100 })
  ob.enqueue({ kind: 'event', key: 'evt_4', payload: { op: 'create', eventId: 'evt_4' } })
  ob.enqueue({ kind: 'event', key: 'evt_4', payload: { op: 'append', eventId: 'evt_4', checkpoint: { text: 'X' } } })
  ob.enqueue({ kind: 'event', key: 'evt_4', payload: { op: 'append', eventId: 'evt_4', checkpoint: { text: 'Y' } } })
  // 磁盘形状：只允许既有字段（kind/key/at/payloadRaw/eventId），不得出现 opKey
  const disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(disk.items.length, 3, '磁盘上必须是 3 条，实得 ' + disk.items.length)
  for (const it of disk.items) {
    for (const k of Object.keys(it)) {
      // ★#511/#512（2026-11-02）：判据过期重钉 —— 磁盘合法字段集**有意**扩了一个 `opKey`。
      //   原因：操作身份必须是「操作实例」而不是「内容指纹」。若 opKey 不落盘，重启后只能由
      //   payload 重算 = 又回到内容哈希 ⇒ set X→Y→X 的第三次仍会被当成第一次的重试而丢弃
      //   （#512 当场复发）。所以 opKey 必须持久化，这是**修 #512 的必要条件**，不是顺手加的字段。
      //   判据意图不变：磁盘仍必须是**闭合字段集**（不允许出现未登记字段），只是集合本身扩容。
      //   向前兼容：旧队列文件没有 opKey ⇒ sanitizeLoadedPre 回退按 payload 重算（行为与今天逐字一致）。
      assert.ok(['kind', 'key', 'at', 'payloadRaw', 'eventId', 'opKey'].indexOf(k) >= 0, '磁盘出现未登记字段: ' + k)
    }
  }
  // 新实例 load：操作身份必须由 payload 重算出来 ⇒ 三条各自成条
  const ob2 = createTeamOutbox({ dir, maxItems: 100 })
  const lr = ob2.load()
  assert.equal(lr.ok, true, 'load 必须成功，实得 ' + JSON.stringify(lr))
  assert.equal(ob2.size(), 3, 'load 后必须仍是 3 条，实得 ' + ob2.size())
})

// ══════════════════════════════════════════════════════════════════
// ⓬ 回归：既有对外契约未变
// ══════════════════════════════════════════════════════════════════
ok('回归：applyOne 同步 applier 仍回 boolean true；未知 kind 仍回 false', () => {
  const puller = createTeamPuller({
    engine: mkEngine(),
    fetchJson: async () => ({ ok: true, data: { changes: [], cursor: 0 } }),
    appliers: { fact: () => ({ ok: true }), handoff: () => ({ ok: false, reason: 'denied' }) },
  })
  assert.equal(puller.applyOne({ kind: 'fact', key: 'Z1', payload: {} }), true, '同步成功必须回 true')
  assert.equal(puller.applyOne({ kind: 'nope', key: 'Z2', payload: {} }), false, '未知 kind 必须回 false')
  assert.equal(typeof puller.applyOne({ kind: 'fact', key: 'Z3', payload: {} }), 'boolean', '返回值必须恒为 boolean')
})

await okAsync('回归：async applier 时 applyOne 回 false（不冒充成功）且不产生 unhandled', async () => {
  const puller = createTeamPuller({
    engine: mkEngine(),
    fetchJson: async () => ({ ok: true, data: { changes: [], cursor: 0 } }),
    appliers: { event: async () => ({ ok: true }) },
  })
  const v = puller.applyOne({ kind: 'event', key: 'Z4', payload: {} })
  assert.equal(typeof v, 'boolean', '必须仍是 boolean，实得 ' + typeof v)
  assert.equal(v, false, '同步 API 拿不到异步结果 ⇒ 必须回 false（不得冒充成功）')
  await new Promise((r) => setTimeout(r, 20))   // 给潜在 unhandled 一点冒头时间
})

// ══════════════════════════════════════════════════════════════════
// 结果
// ══════════════════════════════════════════════════════════════════
try { rmSync(TMP, { recursive: true, force: true }) } catch (_) {}
console.log('\nissue493-490-489 真执行: ' + pass + ' PASS / ' + fail + ' FAIL')
if (fail > 0) { console.log('失败项:\n - ' + failures.join('\n - ')); process.exitCode = 1 }
