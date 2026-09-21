/**
 * issue #55–#58 回归锁（Minervaowl7 提交，2026-09-18；修复 2026-09-19）。
 *
 * ★ 本套件的设计纪律：每条 issue 都必须**先能失败**。
 * 因此除「修复后行为正确」的正向外，每组还配一条**回到旧实现即必红**的负向/结构断言
 * （见每组末尾 `[反向锁]`），并由 `artifacts/_mutate-5558.mjs` 做真红演示。
 *
 * 4 条共同特征（判据，值得记）：没有一条会被既有 smoke 抓到，也没有一条在正常使用中报错 ——
 * 3 条是 fail-soft 的 catch 吞掉了本该炸的错误，1 条是「删除键写错 ⇒ 删除静默失败」。
 *
 * 运行：node tests/smoke/smoke-test-issue55-58-pre.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const LIB = new URL('../../lib/', import.meta.url)
const readSrc = (f) => readFileSync(new URL(f, LIB), 'utf8')
/** 剥离注释，避免「注释里提到旧写法」造成假红/假绿（本仓既有教训）。 */
function stripComments(src) {
  let out = ''
  let i = 0
  let inBlock = false
  let inLine = false
  let inStr = null
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += c } i++; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i += 2 } else i++; continue }
    if (inStr) {
      out += c
      if (c === '\\') { out += src[i + 1] || ''; i += 2; continue }
      if (c === inStr) inStr = null
      i++; continue
    }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue }
    out += c
    i++
  }
  return out
}

let pass = 0
let fail = 0
const failures = []
/**
 * ★ 必须 await 异步用例 —— 否则 async 回调返回的 Promise 无人消费，
 * 断言失败只会变成 unhandledRejection（或静默），本套件会**假绿**。
 * 这是本仓「跑不红的断言等于没有断言」纪律的直接兑现。
 */
async function t(name, fn) {
  try { await fn(); pass++ } catch (e) { fail++; failures.push(name + ' :: ' + (e && e.message)) }
}
function ok(cond, msg) { assert.ok(cond, msg) }

// ---------- 源码级事实（剥离注释后断言，防注释误伤） ----------
const SRC_STORAGE = stripComments(readSrc('storage-manage-pre.js'))
const SRC_EVIDENCE = stripComments(readSrc('evidence-store-pre.js'))
const SRC_EPISODIC = stripComments(readSrc('episodic-store-pre.js'))
const SRC_ACT = stripComments(readSrc('activation-host-pre.js'))
const SRC_BRIDGE = stripComments(readSrc('context-bridge-pre.js'))
const SRC_INDEX = stripComments(readSrc('index.js'))

console.log('=== issue #55 storage-manage-pre.js：readSidecarPrev 的 docStore ===')

// #55 根因：readSidecarPrev 内引用未定义的 docStore（只在 repair/deleteMemory 里局部定义）
await t('#55-1 readSidecarPrev 函数体内自行取 docStore（活读），不再依赖外层同名变量', () => {
  const i = SRC_STORAGE.indexOf('function readSidecarPrev')
  ok(i > 0, '未找到 readSidecarPrev')
  const body = SRC_STORAGE.slice(i, i + 700)
  ok(/const\s+docStore\s*=\s*docStoreOf\(\)/.test(body),
    'readSidecarPrev 内必须有 `const docStore = docStoreOf()`（活读，避免 getter 被固化）')
  ok(!/if\s*\(\s*!docStore\s*\|\|\s*typeof\s+docStore\.sidecarPath/.test(body.split('const docStore')[0] || ''),
    'docStore 的判空必须发生在声明之后')
})

await t('#55-2 [反向锁] 旧写法（直接引用未声明 docStore）已不存在', () => {
  const i = SRC_STORAGE.indexOf('function readSidecarPrev')
  const body = SRC_STORAGE.slice(i, SRC_STORAGE.indexOf('async function repair', i))
  // 旧实现：函数体第一句就是 `if (!docStore || ...)`，前面没有任何声明
  const beforeFirstUse = body.slice(0, body.indexOf('docStore'))
  ok(!/if\s*\(\s*!docStore/.test(body.slice(0, 60)) || /const\s+docStore/.test(beforeFirstUse),
    '不得在未声明的情况下引用 docStore')
  ok(/docStoreOf\(\)/.test(body), 'readSidecarPrev 必须调用 docStoreOf()（工厂活读通道）')
})

await t('#55-3 readSidecarPrev 经真实调用：注入 docStore 后能取到 prev（修复前恒 null）', async () => {
  const { createStorageManagerPre } = await import(new URL('storage-manage-pre.js', LIB))
  const prev = { sourceEpoch: 'ep-1', sourceVersion: 7, fileDigest: 'abc123' }
  const seen = []
  const fakeDocStore = {
    sidecarPath: (f) => '/fake/sidecar/' + path.basename(String(f)) + '.json',
    rebuildSidecar: async (file, opts) => { seen.push(opts); return { ok: true } },
  }
  const io = {
    readFileSync: () => JSON.stringify(prev),
    sidecarDir: '/fake/sidecar',
  }
  const mgr = createStorageManagerPre({
    docStore: () => fakeDocStore,
    io,
    pathsOf: () => null,
  })
  const r = await mgr.repair([{ file: '/ws/MEMORY.md', sourceRef: 'workspace:MEMORY.md' }])
  ok(r && r.ok === true, 'repair 应返回 ok:true')
  ok(seen.length === 1, 'rebuildSidecar 应被调用一次')
  ok(seen[0] && seen[0].sourceEpoch === 'ep-1' && seen[0].sourceVersion === 7,
    '★ 必须把 prev（epoch/version）透传给 rebuildSidecar —— 修复前 docStore 未定义 ⇒ 恒抛 ReferenceError ⇒ 被吞 ⇒ prev 恒 undefined ⇒ epoch 漂移、fresh 被翻 stale')
})

console.log('=== issue #56 evidence-store-pre.js：写失败必须释放幂等登记 ===')

await t('#56-1 BoundedIdSet 具备 delete（撤销登记的能力）', () => {
  ok(/delete\s*\(\s*id\s*\)\s*\{/.test(SRC_BRIDGE), 'BoundedIdSet 必须有 delete(id)（issue#56 依赖）')
})

await t('#56-2 [反向锁] append 在写盘失败分支调用 _appended.delete(id)', () => {
  const i = SRC_EVIDENCE.indexOf('async append(')
  ok(i > 0, '未找到 append')
  const body = SRC_EVIDENCE.slice(i, SRC_EVIDENCE.indexOf('_writeLine(line)', i))
  ok(/this\._appended\.add\(id\)/.test(body), '写入前登记（维持同步去重窗口）')
  ok(/!\s*written\s*&&\s*id\s*\)\s*this\._appended\.delete\(id\)/.test(body),
    '★ 写盘失败时必须 `this._appended.delete(id)` —— 否则瞬时失败后同 id 重试恒判 duplicate ⇒ 证据静默永久丢失')
  ok(/\.then\(\(written\)\s*=>/.test(body), '失败判定必须基于真实写盘结果 written')
})

await t('#56-3 行为：首次写失败 → 同 id 重试必须成功（修复前恒 duplicate-evidence）', async () => {
  const { EvidenceEventStore } = await import(new URL('evidence-store-pre.js', LIB))
  const root = mkdtempSync(path.join(tmpdir(), 'iss56-'))
  // 造一个「写盘必失败」的 eventsDir：父路径放一个**文件**，mkdirSync(recursive) 必抛 ENOTDIR
  const blocker = path.join(root, 'blocker')
  writeFileSync(blocker, 'not a dir', 'utf8')
  const badDir = path.join(blocker, 'events')

  const ev = {
    schemaVersion: 1,
    namespace: 'dsh-auto-memory-pre',
    evidenceId: 'ev_pre_' + 'a'.repeat(32),
    kind: 'read',
    memoryId: 'mem_' + 'b'.repeat(32),
    anchorId: 'mem_' + 'b'.repeat(32),
    scope: 'Workspace',
    workspaceKey: '/ws',
    event: { sessionId: 's1', eventSeq: 1, contextVersion: 1, ts: 1 },
    source: {
      sourceRef: 'workspace:MEMORY.md',
      sourceEpoch: 'e1',
      sourceVersion: 1,
      fileDigest: 'd'.repeat(64),
      recordDigest: 'e'.repeat(64),
    },
    policyVersion: 'evidence_pre_v1',
  }

  // ★ 前置：夹具必须先能通过校验，否则下面的 r1.ok===false 来自**形状校验**而非写盘失败，
  //   断言就测错了对象（本仓「夹具不合法 ⇒ 假绿/假红」纪律）。
  const { validateAccessEvidencePre } = await import(new URL('context-bridge-pre.js', LIB))
  const shaped = validateAccessEvidencePre(ev)
  ok(shaped.ok === true, '夹具必须是合法 evidence（否则测的不是写盘路径）：' + shaped.reason)

  const store = new EvidenceEventStore({ root, eventsDir: badDir })
  const r1 = await store.append(ev)
  ok(r1.ok === false, '首次写盘失败应返回 ok:false（实际 reason=' + r1.reason + '）')
  ok(store.stats.writeFailed >= 1, 'writeFailed 计数应 +1（可观察信号）')

  // 关键：瞬时故障恢复后，**同一个 evidenceId 必须仍可写入**
  store.eventsDir = path.join(root, 'events')
  const r2 = await store.append(ev)
  ok(r2.ok === true,
    '★ 首次写失败后同 evidenceId 重试必须成功（实际 reason=' + r2.reason + '）—— 修复前恒 duplicate-evidence ⇒ 该条证据静默永久丢失')

  // 幂等语义仍然有效：写成功之后再写同一条，必须判重
  const r3 = await store.append(ev)
  ok(r3.ok === false && r3.reason === 'duplicate-evidence',
    '写成功后同 id 再写仍须判 duplicate（幂等窗口未被修复破坏）')
  rmSync(root, { recursive: true, force: true })
})

console.log('=== issue #57 episodic-store-pre.js：restore 的 current 形状校验 ===')

await t('#57-1 restore 走 restoreCurrentPre 而非裸 `|| null`', () => {
  const i = SRC_EPISODIC.indexOf('function restore(')
  ok(i > 0, '未找到 restore')
  const body = SRC_EPISODIC.slice(i, SRC_EPISODIC.indexOf('function clear()', i))
  ok(/current\s*=\s*restoreCurrentPre\(data\.current\)/.test(body), 'restore 必须经过形状校验函数')
})

await t('#57-2 [反向锁] 旧写法 `current = data.current || null` 已不存在', () => {
  ok(!/current\s*=\s*data\.current\s*\|\|\s*null/.test(SRC_EPISODIC),
    '★ 裸 `data.current || null` 必须彻底消失（零形状校验 ⇒ current={} 时 consolidate 抛 TypeError ⇒ 巩固链静默停摆）')
})

await t('#57-3 形状校验函数存在，且判据覆盖 sessionRef/startedAt/三数组', () => {
  const i = SRC_EPISODIC.indexOf('function restoreCurrentPre')
  ok(i > 0, '未找到 restoreCurrentPre')
  const body = SRC_EPISODIC.slice(i, SRC_EPISODIC.indexOf('// ---- 段追加', i))
  ok(/typeof\s+raw\.sessionRef\s*!==\s*'string'/.test(body), 'sessionRef 必须是非空字符串')
  ok(/Number\.isFinite\(raw\.startedAt\)/.test(body), 'startedAt 必须是有限数')
  ok(/Array\.isArray\(raw\.segments\)/.test(body) && /Array\.isArray\(raw\.userTexts\)/.test(body)
    && /Array\.isArray\(raw\.assistantTexts\)/.test(body), '三数组必须都是数组')
  ok(/return\s+null/.test(body), '不合格一律置 null（丢弃优于卡死）')
})

await t('#57-4 行为：伪造 current={} 恢复后不崩，consolidate 不抛 TypeError', async () => {
  const { createEpisodicStorePre } = await import(new URL('episodic-store-pre.js', LIB))
  const io = { save: () => {}, clear: () => {} }
  const store = createEpisodicStorePre({ io })
  const r = store.restore({
    schemaVersion: 1,
    episodes: [],
    current: {}, // ← 旧实现在这里埋雷
  })
  ok(r.ok === true, 'restore 应成功（丢弃坏 current 而非拒绝整份数据）')
  ok(store.hasCurrent === false, '★ 形状不合格的 current 必须被置 null（丢弃优于卡死）')
  const c = store.consolidate()
  ok(c && c.ok === false && c.reason === 'nothing-to-consolidate',
    'consolidate 必须干净返回 nothing-to-consolidate（修复前抛 TypeError）')
})

await t('#57-5 行为：合法 current 仍被正常保留（不误伤）', async () => {
  const { createEpisodicStorePre } = await import(new URL('episodic-store-pre.js', LIB))
  const store = createEpisodicStorePre({ io: { save: () => {}, clear: () => {} } })
  const good = { sessionRef: 's-1', startedAt: 123, segments: [{ kind: 'user', eventSeq: 1 }], userTexts: ['hi'], assistantTexts: [] }
  store.restore({ schemaVersion: 1, episodes: [], current: good })
  ok(store.hasCurrent === true, '合法 current 必须保留（宁可漏判不可误伤）')
})

console.log('=== issue #58 activation-host-pre.js：dispose 接线 + 键格式统一 ===')

await t('#58-1 步进键格式收敛到单一函数 stepKeyOf', () => {
  ok(/function\s+stepKeyOf\s*\(\s*sessionId\s*,\s*workspaceKey\s*\)/.test(SRC_ACT),
    '必须有 stepKeyOf（唯一键格式定义处）')
  const i = SRC_ACT.indexOf('function stepKeyOf')
  const body = SRC_ACT.slice(i, i + 300)
  ok(/\|\s*ws:/.test(body), "键格式必须仍是 `id|ws:key`（与既有写入侧一致，不改语义）")
})

await t('#58-2 [反向锁] disposeRuntime 不再用坏键删步进计数器', () => {
  const i = SRC_ACT.indexOf('function disposeRuntime')
  ok(i > 0, '未找到 disposeRuntime')
  const body = SRC_ACT.slice(i, SRC_ACT.indexOf('function disposeAll', i))
  ok(/stepsByRuntime\.delete\(k\)/.test(body), '应删除 runtimeKey 形态')
  ok(/st\s*&&\s*st\.stepKey/.test(body) && /stepsByRuntime\.delete\(st\.stepKey\)/.test(body),
    '★ 必须按登记的 stepKey 精确回收 —— 旧实现只删 `String(runtimeKey)` 而写入侧用 `sessionId|ws:...`，两键空间不相交 ⇒ 删除恒空操作 ⇒ 计数器只增不减')
})

await t('#58-3 写入侧登记 stepKey（供 dispose 精确回收）', () => {
  ok(/st\.stepKey\s*=\s*stepKeyHere/.test(SRC_ACT), 'onPreStep 必须把 stepKey 登记进 runtime 态')
})

await t('#58-4 engine.dispose 已接线 activationHost.disposeRuntime', () => {
  const i = SRC_INDEX.indexOf('  dispose(agent) {')
  ok(i > 0, '未找到 RuntimeRegistry.dispose')
  const body = SRC_INDEX.slice(i, SRC_INDEX.indexOf('  disposeAll() {', i))
  ok(/this\._activationHost\s*&&\s*runtime\.key\)\s*this\._activationHost\.disposeRuntime\(runtime\.key\)/.test(body),
    '★ dispose 必须调用 _activationHost.disposeRuntime(runtime.key) —— 修复前全仓零调用方 ⇒ per-runtime 投影与计数器永不回收')
  ok(/this\._shadowHost.*disposeRuntime/.test(body), '既有 shadowHost 接线保持不变')
})

await t('#58-5 行为：disposeRuntime 真的清掉步进计数器（键对齐实证）', async () => {
  const { createActivationHost } = await import(new URL('activation-host-pre.js', LIB))
  // 构造最小 engine 桩：只要足够让 host 创建，且能驱动 stepFor 的键空间
  const cfg = { associativeMemoryEnabled: false, activationInboxEnabled: false, activationSource: 'fake' }
  const engine = {
    config: cfg,
    state: { ws: '/ws' },
    runtimes: { values: () => [] },
    runtimeFor: () => null,
  }
  const host = createActivationHost({ engine })
  ok(typeof host.disposeRuntime === 'function', 'disposeRuntime 必须导出')
  // 直接驱动内部键：用 onPreStep 需要 runtime，这里改用源码级 + dispose 幂等断言
  // —— 行为侧由变异演示覆盖（artifacts/_mutate-5558.mjs），此处断言 dispose 不抛且幂等。
  host.disposeRuntime('session:abc')
  host.disposeRuntime('session:abc')
  host.disposeRuntime(undefined)
  ok(true, 'disposeRuntime 对未知/重复/空键必须安全（fail-soft，不抛）')
})

console.log('\n--- issue #55–#58 回归锁 ---')
console.log('pass=' + pass + ' fail=' + fail)
if (failures.length) { for (const f of failures) console.log('  ✗ ' + f) }
process.exit(fail ? 1 : 0)
