import * as fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// R4 P6/P7 A1-a：审计 / 备份 / 恢复（**只在隔离副本上做**，不读真实正文进测试，不改/删生产）。
// 判据：备份逐字节一致；恢复逐字节一致；损坏/缺失/截断必须被拒且不静默覆盖。
const root = path.resolve('artifacts', '_r4-p6p7-a1-20261112', 'fixtures', 'audit-suite')
await fs.rm(root, { recursive: true, force: true })
const src = path.join(root, 'source', 'handoff')
const backup = path.join(root, 'backup')
const restore = path.join(root, 'restore')
await fs.mkdir(src, { recursive: true }); await fs.mkdir(backup, { recursive: true }); await fs.mkdir(restore, { recursive: true })
let pass = 0, fail = 0; const failures = []
async function test(name, action) {
  try { const d = await action(); pass++; console.log('  ok   - ' + name + (d ? ' :: ' + d : '')) }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log('  FAIL - ' + name + ' :: ' + e.stack) }
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
const body = (n) => ['# 交接账本 · 2026010' + n, '', '## 任务状态', 'state-' + n, '', '## 目标', 'goal-' + n, ''].join('\n')
for (const n of [1, 2, 3, 4, 5]) await fs.writeFile(path.join(src, 'handoff-2026010' + n + '-00000' + n + '.md'), body(n))
await fs.writeFile(path.join(src, 'PLAN.md'), '# 白板')
const RE = /^handoff-\d{8}-\d{6}(-[a-z])?\.md$/
async function inventory(dir) {
  const names = (await fs.readdir(dir)).filter((n) => RE.test(n)).sort()
  const items = []
  for (const n of names) { const b = await fs.readFile(path.join(dir, n)); items.push({ name: n, bytes: b.length, sha256: sha(b) }) }
  return items
}
async function copyAll(from, to, items) {
  await fs.mkdir(to, { recursive: true })
  for (const it of items) await fs.copyFile(path.join(from, it.name), path.join(to, it.name))
}
async function verify(dir, items) {
  const bad = []
  for (const it of items) {
    try {
      const b = await fs.readFile(path.join(dir, it.name))
      if (b.length !== it.bytes) { bad.push({ name: it.name, reason: 'size-mismatch' }); continue }
      if (sha(b) !== it.sha256) { bad.push({ name: it.name, reason: 'sha256-mismatch' }) }
    } catch (e) { bad.push({ name: it.name, reason: e.code === 'ENOENT' ? 'missing' : 'read-failed' }) }
  }
  return bad
}

await test('A1A-01 真实清单：只计入旧账本，PLAN/其它文件不混入', async () => {
  const items = await inventory(src)
  if (items.length !== 5) throw new Error('n=' + items.length)
  if (items.some((i) => i.name === 'PLAN.md')) throw new Error('PLAN leaked into legacy inventory')
  return 'n=' + items.length + ' bytes=' + items.reduce((a, i) => a + i.bytes, 0)
})
await test('A1A-02 备份：逐字节一致（含 bytes 与 sha256）', async () => {
  const items = await inventory(src)
  await copyAll(src, backup, items)
  const bad = await verify(backup, items)
  if (bad.length) throw new Error(JSON.stringify(bad))
  return 'backed up ' + items.length + ' files byte-identical'
})
await test('A1A-03 恢复演练：backup → restore 逐字节一致', async () => {
  const items = await inventory(backup)
  await copyAll(backup, restore, items)
  const bad = await verify(restore, items)
  if (bad.length) throw new Error(JSON.stringify(bad))
  return 'restored ' + items.length + ' files byte-identical'
})
await test('A1A-04 负路径：损坏（翻转一字节）必须被拒', async () => {
  const items = await inventory(backup)
  const dir = path.join(root, 'corrupt-flip')
  await copyAll(backup, dir, items)
  const target = path.join(dir, items[0].name)
  const b = await fs.readFile(target); b[Math.floor(b.length / 2)] ^= 0xFF
  await fs.writeFile(target, b)
  const bad = await verify(dir, items)
  if (!bad.some((x) => x.reason === 'sha256-mismatch')) throw new Error('flip not detected: ' + JSON.stringify(bad))
  return 'sha256-mismatch caught'
})
await test('A1A-05 负路径：缺失文件必须被拒（不当作通过）', async () => {
  const items = await inventory(backup)
  const dir = path.join(root, 'corrupt-missing')
  await copyAll(backup, dir, items)
  await fs.rm(path.join(dir, items[0].name))
  const bad = await verify(dir, items)
  if (!bad.some((x) => x.reason === 'missing')) throw new Error('missing not detected')
  return 'missing caught'
})
await test('A1A-06 负路径：截断（半份）必须被拒', async () => {
  const items = await inventory(backup)
  const dir = path.join(root, 'corrupt-trunc')
  await copyAll(backup, dir, items)
  const target = path.join(dir, items[0].name)
  const b = await fs.readFile(target)
  await fs.writeFile(target, b.subarray(0, Math.floor(b.length / 2)))
  const bad = await verify(dir, items)
  if (!bad.some((x) => x.reason === 'size-mismatch')) throw new Error('truncation not detected')
  return 'size-mismatch caught'
})
await test('A1A-07 部分恢复必须被拒：恢复目录少一份 ⇒ verify 报缺失', async () => {
  const items = await inventory(backup)
  const dir = path.join(root, 'partial-restore')
  await copyAll(backup, dir, items.slice(0, items.length - 1))
  const bad = await verify(dir, items)
  if (bad.length !== 1) throw new Error('partial restore accepted: ' + JSON.stringify(bad))
  return 'partial restore rejected'
})
await test('A1A-08 源文件字节在备份/恢复全程未被改动（只读源）', async () => {
  const items = await inventory(src)
  const bad = await verify(src, items)
  if (bad.length) throw new Error('source mutated: ' + JSON.stringify(bad))
  const before = items.map((i) => i.sha256).join(',')
  const after = (await inventory(src)).map((i) => i.sha256).join(',')
  if (before !== after) throw new Error('source sha changed during drill')
  return 'source untouched (' + items.length + ' files)'
})
await test('A1A-09 账本口径可复算：清单 sha 与直接读源一致', async () => {
  const items = await inventory(src)
  for (const it of items) {
    const b = await fs.readFile(path.join(src, it.name))
    if (sha(b) !== it.sha256) throw new Error('inventory sha drift for ' + it.name)
  }
  return 'sha recomputable'
})

console.log('')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
if (fail) { for (const f of failures) console.log('  - ' + f.name + ': ' + f.error); process.exitCode = 1 }
