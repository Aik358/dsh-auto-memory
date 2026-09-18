#!/usr/bin/env node
/**
 * Issue #55 回归:readSidecarPrev 引用未定义标识符 → repair 的 epoch/version 继承恒失效。
 *
 * 根因(修前):`readSidecarPrev` 直接引用 `docStore`,而工厂作用域里只有 `docStoreOf`
 *   (`const docStore` 只存在于 repair()/deleteMemory() 各自的函数作用域内)。ESM 下运行时抛
 *   `ReferenceError: docStore is not defined`,被同函数的 `catch (_) { return null }` 吞掉
 *   ⇒ 该函数**结构上不可能**返回非 null ⇒ rebuildSidecar 恒以 prev=undefined 调用
 *   ⇒ 每次「修复」都 mint 新 sourceEpoch 且把 sourceVersion 打回 1。
 *
 * 本套件锁定:
 *   A. 连续两轮「外部改正文 → repair」后 sourceEpoch 不变、sourceVersion 单调 +1(不回退);
 *   B. repair 仍不改动一个字节正文(既有契约不回归);
 *   C. docStore 不可用(活读 getter 返回 null)时 readSidecarPrev 仍 fail-soft 返回 null,
 *      而不是把异常冒出来(修复不得把静默失效换成崩溃);
 *   D. 源码守卫:函数体内必须有 `docStore` 的本地绑定 —— 工厂作用域外的自由变量在 ESM 下
 *      只会得到被 catch 伪装成 null 的 ReferenceError。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(HERE, '..', '..', 'lib')
const SRC = readFileSync(path.join(LIB, 'storage-manage.js'), 'utf8')

const { MemoryDocumentStore } = await import('../../lib/memory-writer.js')
const { createStorageManagerPre } = await import('../../lib/storage-manage.js')

const tmpHome = mkdtempSync(path.join(tmpdir(), 'dam-issue55-'))
const wsDir = path.join(tmpHome, 'ws')
const userDir = path.join(tmpHome, 'user')
const sidecarDir = path.join(tmpHome, 'index', 'files')
mkdirSync(wsDir, { recursive: true }); mkdirSync(userDir, { recursive: true }); mkdirSync(sidecarDir, { recursive: true })
const NOTES = path.join(wsDir, 'MEMORY.md')
const USER = path.join(userDir, 'MEMORY.md')
const LOG = path.join(wsDir, '2026-09-19.md')
const PATHS = {
  workspaceKey: wsDir.replace(/\\/g, '/').toLowerCase(),
  userDir, userMemoryPath: USER, notesPath: NOTES, logPath: LOG,
}
const io = { sidecarDir, readFileSync }
const docStore = new MemoryDocumentStore({ sidecarDir })
const memIdOf = (t) => 'mem_' + createHash('sha256').update(String(t), 'utf8').digest('hex').slice(0, 32)

function managerFor(storeLike) {
  return createStorageManagerPre({ docStore: () => storeLike, io, pathsOf: () => PATHS })
}
function readSidecar(file) {
  const sp = docStore.sidecarPath(file)
  assert.ok(sp, 'sidecarPath 应可解析')
  return JSON.parse(readFileSync(sp, 'utf8'))
}
const recordOf = (sc, id) => sc.records.find((r) => r.memoryId === id)

/** 往正文**外部**追加一条记录(模拟用户手改:插件写入路径完全不参与,sidecar 因此变 stale)。 */
function editExternally(text) {
  const cur = readFileSync(NOTES, 'utf8')
  writeFileSync(NOTES, cur + '\n' + text, 'utf8')
}

const BASE = '<!-- memory:' + memIdOf('a') + ' -->\n## 首轮\n- 第一条\n'
const ID_A = memIdOf('a')
writeFileSync(NOTES, BASE, 'utf8')
writeFileSync(USER, '<!-- memory:' + memIdOf('u') + ' -->\n## 用户级\n- 用户级事实\n', 'utf8')
writeFileSync(LOG, '<!-- memory:' + memIdOf('l') + ' -->\n## 今日\n- 日志\n', 'utf8')

// ---- 前置:建立 v1 sidecar(无 prev 的新鲜构建) ----
const first = await docStore.rebuildSidecar(NOTES)
assert.ok(first.ok, '夹具:首次 rebuildSidecar 应成功')
const sc1 = readSidecar(NOTES)
assert.equal(sc1.sourceVersion, 1, '夹具:v1')
const epoch1 = sc1.sourceEpoch
assert.ok(typeof epoch1 === 'string' && epoch1.length > 0, '夹具:有 sourceEpoch')
assert.equal(recordOf(sc1, ID_A).sourceVersion, 1, '夹具:记录级 sourceVersion 跟随文件级')

console.log('[A] 连续两轮 stale → repair:epoch 继承、version 不回退')
{
  editExternally('<!-- memory:' + memIdOf('b') + ' -->\n## 次轮\n- 第二条\n')
  const staleSc = readSidecar(NOTES)
  const liveDigest = createHash('sha256').update(readFileSync(NOTES)).digest('hex')
  assert.notEqual(staleSc.fileDigest, liveDigest, '夹具:正文已变而 sidecar 未更新(stale 场景成立)')

  const r = await managerFor(docStore).repair([{ file: NOTES }])
  assert.equal(r.ok, true, 'repair 回报 ok')
  assert.equal(r.repaired, 1, 'repair 成功 1 项')

  const sc2 = readSidecar(NOTES)
  assert.equal(sc2.sourceEpoch, epoch1, '★A1 repair 后 sourceEpoch 必须继承(不 mint 新 epoch)')
  assert.equal(sc2.sourceVersion, 2, '★A2 repair 后 sourceVersion 递增到 2(修复前回退成 1)')

  // 再来一轮:证明是「持续继承」而不是一次性巧合
  const body = readFileSync(NOTES, 'utf8')
  writeFileSync(NOTES, body + '\n<!-- memory:' + memIdOf('c') + ' -->\n## 第三轮\n- 第三条\n', 'utf8')
  const r2 = await managerFor(docStore).repair([{ file: NOTES }])
  assert.equal(r2.repaired, 1, '第二轮 repair 成功')
  const sc3 = readSidecar(NOTES)
  assert.equal(sc3.sourceEpoch, epoch1, '★A3 第二轮仍继承同一 epoch')
  assert.equal(sc3.sourceVersion, 3, '★A4 第二轮 version=3(绝不回退到 1)')
  // 记录级身份随文件级一起前进 —— evidence 的 fresh/stale 判定读的就是这两个字段
  const recA = recordOf(sc3, ID_A)
  assert.equal(recA.sourceVersion, 3, 'A5 记录级 sourceVersion 与文件级同步')
  assert.ok(typeof recA.recordDigest === 'string' && recA.recordDigest.length === 64, 'A6 recordDigest 仍在')
}

console.log('[B] 正文零改动契约不回归')
{
  const before = readFileSync(NOTES, 'utf8')
  editExternally('<!-- memory:' + memIdOf('d') + ' -->\n## 四轮\n- 第四条\n')
  const after = readFileSync(NOTES, 'utf8')
  await managerFor(docStore).repair([{ file: NOTES }])
  assert.equal(readFileSync(NOTES, 'utf8'), after, 'B1 repair 不改写正文(只重建 sidecar)')
  assert.ok(after.startsWith(before), 'B2 夹具:正文只增不改')
}

console.log('[C] fail-soft:docStore 不可用时仍返回 null,不抛出来')
{
  const r = await managerFor(null).repair([{ file: NOTES }])
  assert.deepEqual(r, { ok: false, reason: 'no-doc-store' }, 'C1 无 docStore → no-doc-store(既有分支不变)')
  // sidecarPath 抛错的 store:readSidecarPrev 必须吞掉并保持 repair 可用
  const boom = {
    sidecarPath() { throw new Error('boom') },
    async rebuildSidecar() { return { ok: true } },
  }
  const r2 = await managerFor(boom).repair([{ file: NOTES }])
  assert.equal(r2.results[0].ok, true, 'C2 sidecar 读取失败不阻断重建(fail-soft)')
}

console.log('[D] 源码守卫:readSidecarPrev 体内自带 docStore 绑定')
{
  const m = SRC.match(/function readSidecarPrev\(file\) \{[\s\S]*?\n {2}\}/)
  assert.ok(m, 'D0 未定位到 readSidecarPrev 实现')
  const body = m[0]
  assert.match(body, /\b(?:const|let|var)\s+docStore\s*=/, 'D1 ★函数体内必须本地解析 docStore(自由变量在 ESM 下恒 ReferenceError)')
  assert.ok(body.includes('docStoreOf('), 'D2 与 repair/deleteMemory 同源:走 docStoreOf() 活读')
}

console.log('\nissue55-sidecar-prev: all assertions passed')
