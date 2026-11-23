import * as fs from 'node:fs/promises'
import path from 'node:path'
import {
  listLegacyLedgers, readLegacyLedger, readLatestLegacyLedger, adaptLegacyLedger,
  writeLegacyLedger, isLegacyLedgerNamePre, legacyOrderKeyPre, LEGACY_LEDGER_RE,
  LEGACY_COMPAT_SCHEMA, LEGACY_QUAD_TITLES,
} from '../../lib/legacy-handoff-compat.js'

// R4 P6/P7 A1-b：旧账本兼容模块的**真调用**验收。
// 边界：只读合成旧账本；不读真实正文；不测 R4 新路径（那是 A1-c 的事）。
const root = path.resolve('artifacts', '_r4-p6p7-a1-20261112', 'fixtures', 'compat-suite')
await fs.rm(root, { recursive: true, force: true })
const handoffDir = path.join(root, 'handoff')
await fs.mkdir(handoffDir, { recursive: true })
let pass = 0, fail = 0
const failures = []
async function test(name, action) {
  try { const d = await action(); pass++; console.log('  ok   - ' + name + (d ? ' :: ' + d : '')) }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log('  FAIL - ' + name + ' :: ' + e.stack) }
}
const body = (ts) => ['# 交接账本 · ' + ts, '', '## 任务状态', '状态 ' + ts, '', '## 目标', '目标 ' + ts, '', '## 已试方案与失败原因', '失败 ' + ts, '', '## 进度与下一步', '下一步 ' + ts, ''].join('\n')
await fs.writeFile(path.join(handoffDir, 'handoff-20260101-010101.md'), body('20260101-010101'))
await fs.writeFile(path.join(handoffDir, 'handoff-20260102-020202.md'), body('20260102-020202'))
await fs.writeFile(path.join(handoffDir, 'handoff-20260103-030303-b.md'), body('20260103-030303-b'))
await fs.writeFile(path.join(handoffDir, 'PLAN.md'), '# 白板')
await fs.writeFile(path.join(handoffDir, 'notes.md'), 'x')
await fs.mkdir(path.join(handoffDir, 'documents'), { recursive: true })
await fs.writeFile(path.join(handoffDir, 'documents', 'x-261112-0001.md'), '# r4 doc')

await test('A1B-01 schema 常量与四段标题是冻结的', () => {
  if (LEGACY_COMPAT_SCHEMA !== 'r4-legacy-handoff-compat-v1') throw new Error('schema=' + LEGACY_COMPAT_SCHEMA)
  if (LEGACY_QUAD_TITLES.length !== 4) throw new Error('quad=' + LEGACY_QUAD_TITLES.length)
  if (!Object.isFrozen(LEGACY_QUAD_TITLES)) throw new Error('LEGACY_QUAD_TITLES not frozen')
  return LEGACY_COMPAT_SCHEMA
})
await test('A1B-02 旧文件名判定与排序键一致（同秒后缀 a<b）', () => {
  if (!isLegacyLedgerNamePre('handoff-20260103-030303-b.md')) throw new Error('suffix form not recognised')
  if (isLegacyLedgerNamePre('handoff-2026-01-03.md')) throw new Error('loose form wrongly accepted')
  if (isLegacyLedgerNamePre('PLAN.md')) throw new Error('PLAN wrongly accepted')
  if (legacyOrderKeyPre('handoff-20260101-010101.md') !== '20260101-010101-a') throw new Error('order-1')
  if (legacyOrderKeyPre('handoff-20260103-030303-b.md') !== '20260103-030303-b') throw new Error('order-2')
  if (legacyOrderKeyPre('PLAN.md') !== null) throw new Error('order-null')
  return 'order keys ok'
})
await test('A1B-03 枚举只列旧账本，不混入 PLAN/notes/documents', async () => {
  const r = await listLegacyLedgers({ handoffDir })
  if (!r.ok) throw new Error('list not ok: ' + JSON.stringify(r.readErrors))
  const names = r.items.map((i) => i.name).sort()
  const want = ['handoff-20260101-010101.md', 'handoff-20260102-020202.md', 'handoff-20260103-030303-b.md']
  if (JSON.stringify(names) !== JSON.stringify(want)) throw new Error('names=' + JSON.stringify(names))
  if (r.state !== 'present') throw new Error('state=' + r.state)
  return 'n=' + names.length
})
await test('A1B-04 排序口径：mtime 优先、同 mtime 按 order 降序（与现行 readLatestHandoff 同口径）', async () => {
  const r = await listLegacyLedgers({ handoffDir })
  const sorted = r.items.map((i) => i.name)
  const byMtime = [...r.items].sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.order < b.order ? 1 : a.order > b.order ? -1 : 0)).map((i) => i.name)
  if (JSON.stringify(sorted) !== JSON.stringify(byMtime)) throw new Error('order mismatch')
  const latest = await readLatestLegacyLedger({ handoffDir })
  if (!latest.ok) throw new Error('latest not ok')
  if (latest.name !== byMtime[0]) throw new Error('latest=' + latest.name + ' want ' + byMtime[0])
  return 'latest=' + latest.name
})
await test('A1B-05 读全文逐字节一致，且返回 sha256/bytes', async () => {
  const want = body('20260102-020202')
  const r = await readLegacyLedger({ handoffDir, name: 'handoff-20260102-020202.md' })
  if (!r.ok) throw new Error('read not ok: ' + r.error)
  if (r.text !== want) throw new Error('byte drift')
  if (r.bytes !== Buffer.byteLength(want, 'utf8')) throw new Error('bytes=' + r.bytes)
  if (!/^[0-9a-f]{64}$/.test(r.sha256)) throw new Error('sha256 shape')
  return 'bytes=' + r.bytes + ' sha=' + r.sha256.slice(0, 12)
})
await test('A1B-06 三类错误分开：名称非法 / 不存在 / 目录缺失', async () => {
  const a = await readLegacyLedger({ handoffDir, name: 'PLAN.md' })
  if (a.error !== 'legacy-name-invalid') throw new Error('a=' + JSON.stringify(a))
  const b = await readLegacyLedger({ handoffDir, name: 'handoff-20991231-235959.md' })
  if (b.error !== 'legacy-not-found') throw new Error('b=' + JSON.stringify(b))
  const c = await listLegacyLedgers({ handoffDir: path.join(root, 'nope') })
  if (c.state !== 'missing' || c.ok !== true) throw new Error('c=' + JSON.stringify(c))
  return 'invalid / not-found / missing 三分'
})
await test('A1B-07 格式适配：四段齐全 true，缺段置空串且 quadComplete=false', async () => {
  const full = adaptLegacyLedger(body('20260102-020202'))
  if (!full.quadComplete) throw new Error('full not complete')
  if (full.title.indexOf('20260102-020202') < 0) throw new Error('title=' + full.title)
  const partial = adaptLegacyLedger('# T\n\n## 任务状态\n只有状态\n')
  if (partial.quadComplete) throw new Error('partial wrongly complete')
  if (partial.quad['目标'] !== '') throw new Error('missing section not empty')
  const empty = adaptLegacyLedger('')
  if (empty.sections.length !== 0) throw new Error('empty should have no sections')
  return 'full/partial/empty 三态'
})
await test('A1B-08 受控旧写入：缺 explicit:true 一律拒绝并给迁移指引', async () => {
  const r = await writeLegacyLedger({ projectDir: root, content: 'x' })
  if (r.ok !== false || r.error !== 'legacy-write-requires-explicit-call') throw new Error(JSON.stringify(r))
  if (!String(r.hint || '').includes('documentId')) throw new Error('hint lacks migration guidance')
  return 'explicit gate ok'
})
await test('A1B-09 显式旧写入薄转发给 engine.writeHandoffLedger（保护复用，不复制）', async () => {
  let called = null
  const fakeEngine = { writeHandoffLedger: async (pd, content, opts) => { called = { pd, content, opts }; return { ok: true, path: pd + '/handoff-x.md', clean: content } } }
  const r = await writeLegacyLedger({ engine: fakeEngine, projectDir: root, content: 'BODY', explicit: true, opts: { skipCriteria: true } })
  if (!r.ok || r.via !== 'legacy-handoff-compat') throw new Error('via=' + JSON.stringify(r))
  if (called.pd !== root || called.content !== 'BODY' || called.opts.skipCriteria !== true) throw new Error('forward mismatch')
  const bad = await writeLegacyLedger({ engine: {}, projectDir: root, content: 'x', explicit: true })
  if (bad.error !== 'legacy-write-engine-invalid') throw new Error('engine guard=' + JSON.stringify(bad))
  return 'thin forward ok'
})
await test('A1B-10 兼容结果绝不拼接 R4 文档内容（documents/ 不出现在任何返回值里）', async () => {
  const listed = await listLegacyLedgers({ handoffDir })
  const latest = await readLatestLegacyLedger({ handoffDir })
  const blob = JSON.stringify(listed) + JSON.stringify(latest) + JSON.stringify(adaptLegacyLedger(latest.text))
  for (const banned of ['r4 doc', 'documents/', '<!-- r4-ledger-doc-v1 -->']) {
    if (blob.includes(banned)) throw new Error('legacy result leaks R4 content: ' + banned)
  }
  if (listed.items.some((i) => i.name.startsWith('documents'))) throw new Error('documents leaked into list')
  return 'no R4 contamination'
})

// ── A1-b 接线断言（task-2）：engine.readLatestHandoff 必须走兼容模块且行为逐字节等价 ──
await test('A1B-11 readLatestHandoff 已接线兼容模块，且返回值与原口径逐字节一致', async () => {
  const { MemoryEngine } = await import('../lib/audit-engine.mjs')
  const engineLike = Object.create(MemoryEngine.prototype)
  engineLike.readTextSafe = async (p) => { try { const fsx = await import('node:fs/promises'); return await fsx.readFile(p, 'utf8') } catch (_) { return '' } }
  const got = await MemoryEngine.prototype.readLatestHandoff.call(engineLike, handoffDir)
  const want = await readLatestLegacyLedger({ handoffDir })
  if (got !== want.text) throw new Error('text mismatch: engine=' + got.length + ' compat=' + want.text.length)
  // 目录不存在 / 空目录 ⇒ 仍返回空串（原契约）
  const emptyDir = path.join(root, 'empty-handoff')
  await fs.mkdir(emptyDir, { recursive: true })
  const gotEmpty = await MemoryEngine.prototype.readLatestHandoff.call(engineLike, emptyDir)
  if (gotEmpty !== '') throw new Error('empty dir should return empty string, got ' + JSON.stringify(gotEmpty))
  const gotMissing = await MemoryEngine.prototype.readLatestHandoff.call(engineLike, path.join(root, 'no-such-dir'))
  if (gotMissing !== '') throw new Error('missing dir should return empty string')
  return 'bytes=' + Buffer.byteLength(got, 'utf8') + ' (legacy 契约保留：只回文本或空串)'
})
await test('A1B-12 兼容模块被真实 import 使用（不是死导入）：只导入实际使用的导出', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const m = /import \{([^}]*)\} from '\.\/legacy-handoff-compat\.js'/.exec(src)
  if (!m) throw new Error('compat import missing')
  const names = m[1].split(',').map((x) => x.trim()).filter(Boolean)
  if (!names.includes('readLatestLegacyLedger')) throw new Error('readLatestLegacyLedger not imported')
  const body = src.split('\n').filter((l) => !l.startsWith('import ')).join('\n')
  for (const n of names) {
    const re = new RegExp('\\b' + n + '\\b')
    if (!re.test(body)) throw new Error('dead import: ' + n)
  }
  return 'imports=' + names.join(',') + ' (all used)'
})

console.log('')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
if (fail) { for (const f of failures) console.log('  - ' + f.name + ': ' + f.error); process.exitCode = 1 }
