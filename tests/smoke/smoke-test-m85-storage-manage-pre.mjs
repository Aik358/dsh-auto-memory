// M10 存储管理测试(2026-08-30 P3,docs/HANDOFF-M8-M9-M10.md §2 P3):
//   H1 健康扫描:健康语料 → 全 ok;stale(fileDigest 失配)→ 判 stale 且可修
//   H2 repair:只重建 sidecar,**正文逐字节不变**(零风险自愈);修复后重扫转 ok
//   H3 删除三联动:正文原子删 + 在途激活包清理 + 派生事实撤销
//   H4 级联边界:无 activationHost/factStore 时不阻断删除,逐项回报
//   H5 失败路径:not-found / expectedDigest 冲突 / 越权路径 / 无路径
//   H6 卫生:零进程网络原语、无 BOM、审计环形有界
// 真实 MemoryDocumentStore + 真实 sidecar 落盘(临时 DSH_HOME 隔离,零真实记忆接触、零网络)。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.on('uncaughtException', (e) => { console.error('[M85-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M85-TEST] REJ:', r); process.exit(1) })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const { MemoryDocumentStore } = await import('../../lib/memory-writer.js')
const { createStorageManagerPre } = await import('../../lib/storage-manage.js')
const { createActivationHost } = await import('../../lib/activation-host.js')
const { createFactStorePre } = await import('../../lib/fact-store.js')

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a))) }
const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')

const tmpHome = mkdtempSync(path.join(tmpdir(), 'dam-m85-'))
const wsDir = path.join(tmpHome, 'ws')
const userDir = path.join(tmpHome, 'user')
const sidecarDir = path.join(tmpHome, '.dsh', 'memory', 'index', 'files')
mkdirSync(wsDir, { recursive: true }); mkdirSync(userDir, { recursive: true }); mkdirSync(sidecarDir, { recursive: true })
const NOTES = path.join(wsDir, 'MEMORY.md')
const USER = path.join(userDir, 'MEMORY.md')
const LOG = path.join(wsDir, '2026-08-30.md')
// 字段同时满足两种风格:catalogFor 读 userDir/notesPath/logPath(engine.state 风格),
// 也带上 workspaceMemoryPath/todayLogPath 便于断言时按语料字段名引用。
const PATHS = {
  workspaceKey: wsDir.replace(/\\/g, '/').toLowerCase(),
  userDir: userDir, userMemoryPath: USER, notesPath: NOTES, logPath: LOG,
  workspaceMemoryPath: NOTES, todayLogPath: LOG,
}
const docStore = new MemoryDocumentStore({ sidecarDir })
const io = { sidecarDir, readFileSync }
const memIdOf = (t) => 'mem_' + sha256('m85:' + t).slice(0, 32)

const NOTES_BODY = '<!-- memory:' + memIdOf('a') + ' -->\n## 用户偏好\n- 偏好中文回复与分步验证\n\n' +
  '<!-- memory:' + memIdOf('b') + ' -->\n## 部署流程\n- 部署走 pnpm build 后 rsync\n'
writeFileSync(NOTES, NOTES_BODY, 'utf8')
writeFileSync(USER, '<!-- memory:' + memIdOf('u') + ' -->\n## 用户级\n- 用户级事实\n', 'utf8')
writeFileSync(LOG, '<!-- memory:' + memIdOf('l') + ' -->\n## 今日\n- 今日日志一条\n', 'utf8')

function makeManager(extra = {}) {
  return createStorageManagerPre({
    docStore, io, pathsOf: () => PATHS,
    activationHostOf: extra.activationHostOf || (() => null),
    factStoreOf: extra.factStoreOf || (() => null),
  })
}

console.log('[H0] 初始建库:三源 sidecar 落盘')
{
  for (const f of [NOTES, USER, LOG]) {
    const r = await docStore.rebuildSidecar(f)
    ok(r.ok, 'H0 rebuildSidecar ' + path.basename(path.dirname(f)) + '/' + path.basename(f))
  }
}

console.log('[H1] 健康扫描')
{
  const sm = makeManager()
  const sc = sm.scanHealth()
  ok(sc.ok, 'H1 扫描成功')
  eq(sc.counts, { total: 3, ok: 3, stale: 0, unrepairable: 0 }, 'H1 健康语料 3/3 ok、零 stale')
  ok(sc.sources.every((s) => s.status === 'ok' && s.reasons.length === 0), 'H1 每源状态 ok 且无失效原因')
  // 制造 stale:直接改正文(模拟用户手改文件)→ sidecar fileDigest 失配
  writeFileSync(NOTES, NOTES_BODY + '\n- 手动新增一行\n', 'utf8')
  const sc2 = makeManager().scanHealth()
  ok(sc2.ok && sc2.counts.stale === 1, 'H1 手改正文后判为 stale(1 源)')
  const st = sc2.stale[0]
  ok(st.reasons.includes('stale-source'), 'H1 stale 原因 = stale-source(fileDigest 失配)')
  ok(st.repairable.includes('stale-source'), 'H1 stale 被标记为可修(重建 sidecar 可自愈)')
  ok(sc2.sources.filter((s) => s.status === 'ok').length === 2, 'H1 其余两源仍 ok(隔离正确)')
}

console.log('[H2] repair:只重建 sidecar,正文逐字节不变')
{
  const before = readFileSync(NOTES)
  const sm = makeManager()
  const sc = sm.scanHealth()
  const rp = await sm.repair(sc.stale)
  ok(rp.ok && rp.repaired === 1, 'H2 修复 1 源(repaired=' + rp.repaired + ')')
  const after = readFileSync(NOTES)
  ok(before.equals(after), 'H2 正文逐字节不变(零风险自愈,不动用户内容)')
  const sc2 = makeManager().scanHealth()
  eq(sc2.counts, { total: 3, ok: 3, stale: 0, unrepairable: 0 }, 'H2 修复后重扫转全 ok')
  // 修复后新增的那条记忆应重新进入语料(自愈的意义所在)
  ok(sc2.sources.find((s) => s.file === NOTES).status === 'ok', 'H2 该源回到语料')
}

console.log('[H3] 删除三联动:正文 + 在途激活包 + 派生事实')
let purgeSeen = null
{
  // 造一个在途激活包(pending)含待删记忆 + 一条派生事实
  const targetId = memIdOf('a')
  const engine = {
    config: { associativeMemoryEnabled: true, activationInboxEnabled: true, pythonBackendEnabled: true, activationSource: 'python', memoryHubEnabled: true },
    runtimes: new Map(), runtimeFor: () => null, state: { ws: wsDir }, __homedirFn: () => tmpHome, _memoryHub: null,
  }
  const host = createActivationHost({ engine })
  host.initCapability({ systemPrompt: { context: () => 'x' } })
  const { makeFakeActivationRequestPre } = await import('../../lib/activation-inbox.js')
  const mkRec = (tag) => ({
    memoryId: memIdOf(tag), anchorId: 'anc_' + tag, scope: 'Workspace', sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: '33333333-3333-4333-8333-333333333333', sourceVersion: 1,
    fileDigest: sha256('f:' + tag), recordDigest: sha256('r:' + tag), excerpt: '摘录 ' + tag,
  })
  const req = makeFakeActivationRequestPre({
    seed: 'm85-del', sessionId: 's1', agentId: 'a1', workspaceKey: PATHS.workspaceKey,
    contextVersion: 3, memoryIndexVersion: 'idx_' + '3'.repeat(32),
    records: [mkRec('a'), mkRec('b')], maxItems: 2, ttlSteps: 8, now: Date.now(),
  })
  const offered = host.offerExternalActivation(req)
  ok(offered.ok === true, 'H3 造在途包:offer 被接受')

  const factStore = createFactStorePre({ io: { save() {}, load() { return null }, clear() {} } })
  factStore.upsert({
    scope: 'Workspace', subject: '部署流程', predicate: '走 pnpm', object: 'build 后 rsync',
    sourceKind: 'explicit', sourceClass: 'semantic-candidate', confidence: 0.9, provenance: [targetId],
  })

  const sm = makeManager({ activationHostOf: () => host, factStoreOf: () => factStore })
  const before = readFileSync(NOTES, 'utf8')
  ok(before.includes(targetId), 'H3 删除前正文含目标记忆')
  const r = await sm.deleteMemory({ filePath: NOTES, memoryId: targetId })
  ok(r.ok, 'H3 删除成功')
  ok(r.removed.includes(targetId), 'H3 docStore 报告该记忆 removed')
  ok(r.kept.includes(memIdOf('b')), 'H3 同文件其它记录 kept(未误删)')
  const after = readFileSync(NOTES, 'utf8')
  ok(!after.includes(targetId), 'H3 正文已删除该记忆')
  ok(after.includes(memIdOf('b')), 'H3 正文仍保留其它记录')
  ok(after.includes('## 部署流程'), 'H3 删的是目标块,不是整篇')
  purgeSeen = r.cascade && r.cascade.purge
  ok(purgeSeen && purgeSeen.ok === true, 'H3 级联①在途激活包清理 ok')
  ok(purgeSeen && purgeSeen.droppedPending >= 1, 'H3 级联①含该记忆的 pending 包被丢弃(droppedPending=' + (purgeSeen && purgeSeen.droppedPending) + ')')
  ok(r.cascade.revoked && r.cascade.revoked.revoked === 1, 'H3 级联②派生事实撤销 1 条')
  ok(factStore.query().length === 0, 'H3 级联②撤销后查询不再返回该事实(只读过滤)')
  // 后续 offer 若再带该记忆必须被整单拒绝(抑制名单)
  const req2 = makeFakeActivationRequestPre({
    seed: 'm85-del2', sessionId: 's1', agentId: 'a1', workspaceKey: PATHS.workspaceKey,
    contextVersion: 4, memoryIndexVersion: 'idx_' + '3'.repeat(32),
    records: [mkRec('a')], maxItems: 1, ttlSteps: 8, now: Date.now(),
  })
  const denied = host.offerExternalActivation(req2)
  ok(denied.ok === false && String(denied.reason) === 'suppressed-candidate', 'H3 级联①已删记忆再 offer 被整单拒绝(suppressed-candidate)')
}

console.log('[H4] 级联边界:宿主缺失不阻断删除')
{
  const sm = makeManager() // activationHost/factStore 均为 null
  const r = await sm.deleteMemory({ filePath: USER, memoryId: memIdOf('u') })
  ok(r.ok, 'H4 无级联宿主时正文删除仍成功')
  ok(r.cascade.purge && r.cascade.purge.ok === false, 'H4 级联①如实回报 no-activation-host')
  ok(r.cascade.revoked && r.cascade.revoked.ok === false, 'H4 级联②如实回报 no-fact-store')
  ok(!readFileSync(USER, 'utf8').includes(memIdOf('u')), 'H4 目标记忆确已删除')
}

console.log('[H5] 失败路径')
{
  const sm = makeManager()
  ok((await sm.deleteMemory({ filePath: NOTES, memoryId: '' })).reason === 'no-memory-id', 'H5 空 memoryId → no-memory-id')
  ok((await sm.deleteMemory({ memoryId: memIdOf('b') })).reason === 'no-file-path', 'H5 空 filePath → no-file-path')
  const nf = await sm.deleteMemory({ filePath: NOTES, memoryId: memIdOf('nonexistent') })
  ok(nf.ok === false && nf.reason === 'not-found', 'H5 记忆不存在 → not-found(不改动文件)')
  const conflict = await sm.deleteMemory({ filePath: NOTES, memoryId: memIdOf('b'), expectedDigest: sha256('stale-digest') })
  ok(conflict.ok === false && conflict.reason === 'conflict-external-edit', 'H5 expectedDigest 不匹配 → conflict-external-edit(乐观锁)')
  ok(readFileSync(NOTES, 'utf8').includes(memIdOf('b')), 'H5 冲突时零写入(文件未被改动)')
  ok(makeManager({}).scanHealth().ok === true, 'H5 扫描在部分删除后仍可用')
}

console.log('[H6] 卫生与审计')
{
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'storage-manage.js'))
  ok(src[0] !== 0xef && src[1] !== 0xbb && src[2] !== 0xbf, 'H6 storage-manage.js 无 BOM')
  const s = src.toString('utf8')
  ok(!/from\s+'(node:net|node:http|node:child_process|node:dgram)'/.test(s), 'H6 零进程/网络原语')
  ok(!s.includes('_dev'), 'H6 无 _dev 残留')
  const sm = makeManager()
  for (let i = 0; i < 80; i++) sm.scanHealth()
  ok(sm.auditLog().length === 64, 'H6 审计环形有界(80 次扫描 → 64 条)')
  ok(sm.auditLog().every((e) => e.action === 'scan' && typeof e.at === 'number'), 'H6 审计条目为最小投影(无正文)')
  ok(existsSync(sidecarDir), 'H6 sidecar 目录位于临时 DSH_HOME(真实记忆零接触)')
}

try { rmSync(tmpHome, { recursive: true, force: true }) } catch (_) {}
console.log('\n[M85] ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1
void purgeSeen
