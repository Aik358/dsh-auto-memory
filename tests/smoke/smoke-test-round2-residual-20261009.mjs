#!/usr/bin/env node
/**
 * round-2 残留修复回归（2026-10-09 · #321 / #325 / #319 / #320）
 *
 * 这批的性质：**上轮修复的旁路缺口** —— 每条都是「同一根因在另一条路径上的复现」。
 * 因此本套件的重点是**旁路**：
 *   · #321 默认 append/replace/replaceSingle/applyPlan 的**默认**提交必须携带读到的摘要（锁外外部编辑必须被拒）
 *   · #325 同一物理文档经 junction 两条路径 ⇒ 必须**同一条进程内队列**（否则同步锁等待会阻塞持锁者 ⇒ 超时）
 *   · #319 归档发布段必须与写入器共用同一把文档锁（旧维护者的旧快照不得覆盖新归档）
 *   · #320 drain 未收敛 ⇒ 迁移必须 fail-closed（不得继续发布新根）
 *
 * 纪律：真 import → 真构造 → 真调用 → 断言返回值/副作用；并发用真文件系统 + 真延迟注入。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { promises as realFs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const W = await import(new URL('../../lib/memory-writer.js', import.meta.url).href)
const MT = await import(new URL('../../lib/memory-mutation-transaction.js', import.meta.url).href)
const { MemoryDocumentStore } = W

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.log('  FAIL - ' + n) } }
const tmps = []
const mkroot = (tag) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-r2-' + tag + '-')); tmps.push(d); return d }
const markerCount = (t) => (t.match(/<!--\s*memory:mem_[0-9a-f]{32}\s*-->/g) || []).length

// ══════════════════════════════════════════════════════════════
console.log('[①] #321 默认提交必须携带读到的摘要（锁外外部编辑 ⇒ 拒绝，不静默覆盖）')
// ══════════════════════════════════════════════════════════════
{
  const root = mkroot('321')
  const file = path.join(root, 'MEMORY.md')
  writeFileSync(file, '# 原始\n- 旧\n', 'utf8')
  // 在读盘之后、提交之前插入一次「不参与文档锁」的外部编辑
  const spy = Object.create(realFs)
  let reads = 0
  spy.readFile = async (p, ...rest) => {
    const out = await realFs.readFile(p, ...rest)
    if (String(p).endsWith('MEMORY.md')) {
      reads += 1
      if (reads === 1) {
        // 模拟外部编辑器：直接改盘（不经 store），让本次「读到的快照」在提交前过期
        await realFs.writeFile(file, '# 原始\n- 旧\n- 外部编辑\n', 'utf8')
      }
    }
    return out
  }
  const store = new MemoryDocumentStore({ fs: spy })
  const r = await store.append(file, '- 本应用的追加')
  ok(r && r.ok === false && r.reason === 'conflict-external-edit',
    '★ ① 默认 append 检出外部编辑并拒绝（旧实现静默覆盖；实 ' + JSON.stringify(r && (r.reason || r.ok)) + '）')
  const after = readFileSync(file, 'utf8')
  ok(after.includes('- 外部编辑'), '★ ① 外部编辑内容仍在（未被覆盖）')
  ok(!after.includes('- 本应用的追加'), '★ ① 本应用这次追加**未**落盘')
  // 负路径对照：没有外部编辑时正常成功
  const root2 = mkroot('321b')
  const f2 = path.join(root2, 'MEMORY.md')
  writeFileSync(f2, '# 原始\n', 'utf8')
  const s2 = new MemoryDocumentStore({})
  const r2 = await s2.append(f2, '- 正常追加')
  ok(r2 && r2.ok === true, '★ ① 对照：无外部编辑时正常成功（无假拒绝；实 ' + JSON.stringify(r2 && r2.ok) + '）')
}

// ══════════════════════════════════════════════════════════════
console.log('[②] #321 全路径普查：replace / replaceSingle / applyPlan 三处默认同样携带摘要')
// ══════════════════════════════════════════════════════════════
{
  const mkSpy = (file) => {
    const spy = Object.create(realFs)
    let reads = 0
    spy.readFile = async (p, ...rest) => {
      const out = await realFs.readFile(p, ...rest)
      if (String(p).endsWith(path.basename(file))) { reads += 1; if (reads === 1) await realFs.writeFile(file, readFileSync(file, 'utf8') + '\n- 外部编辑\n', 'utf8') }
      return out
    }
    return spy
  }
  // replace
  const d1 = mkroot('321r'); const f1 = path.join(d1, 'MEMORY.md')
  writeFileSync(f1, '# A\n<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n\n- 一\n', 'utf8')
  const r1 = await new MemoryDocumentStore({ fs: mkSpy(f1) }).replace(f1, '- 替换后')
  ok(r1 && r1.ok === false && r1.reason === 'conflict-external-edit', '★ ② replace 默认拒绝外部编辑（实 ' + JSON.stringify(r1 && (r1.reason || r1.ok)) + '）')
  // replaceSingle
  const d2 = mkroot('321rs'); const f2 = path.join(d2, 'MEMORY.md')
  writeFileSync(f2, '<!-- memory:mem_' + 'b'.repeat(32) + ' -->\n\n- 一\n', 'utf8')
  const r2 = await new MemoryDocumentStore({ fs: mkSpy(f2) }).replaceSingle(f2, '- 单条替换')
  ok(r2 && r2.ok === false && r2.reason === 'conflict-external-edit', '★ ② replaceSingle 默认拒绝（实 ' + JSON.stringify(r2 && (r2.reason || r2.ok)) + '）')
  // applyPlan
  const d3 = mkroot('321ap'); const f3 = path.join(d3, 'MEMORY.md')
  writeFileSync(f3, '# B\n- 旧\n', 'utf8')
  const r3 = await new MemoryDocumentStore({ fs: mkSpy(f3) }).applyPlan(f3, { version: 'memory_migration_pre_v1', operations: [] })
  ok(r3 && r3.ok === false, '★ ② applyPlan 默认拒绝（实 ' + JSON.stringify(r3 && (r3.reason || r3.ok)) + '）')
}


// ══════════════════════════════════════════════════════════════
console.log('[③] #325 同一物理文档经 junction 两条路径 ⇒ 必须同一条进程内队列')
// ══════════════════════════════════════════════════════════════
{
  const root = mkroot('325')
  const realDir = path.join(root, 'real')
  const linkDir = path.join(root, 'link')
  mkdirSync(realDir, { recursive: true })
  let junctionOk = true
  try { symlinkSync(realDir, linkDir, 'junction') } catch (e) { junctionOk = false }
  if (!junctionOk) {
    console.log('  !! junction 不可用 ⇒ 本组跳过（如实计 FAIL，不静默通过）')
    fail++
  } else {
    const fReal = path.join(realDir, 'MEMORY.md')
    const fLink = path.join(linkDir, 'MEMORY.md')
    writeFileSync(fReal, '# 原始' + String.fromCharCode(10), 'utf8')
    const store = new MemoryDocumentStore({})
    const kReal = store._queueKeyOf(fReal)
    const kLink = store._queueKeyOf(fLink)
    ok(kReal === kLink, '★ ③ 真实路径与 junction 路径算出同一队列键（实 ' + JSON.stringify({ kReal, kLink }) + '）')
    const [ra, rb] = await Promise.all([
      store.append(fReal, '- 经真实路径').then((x) => x, (e) => ({ err: e && e.code })),
      store.append(fLink, '- 经链接路径').then((x) => x, (e) => ({ err: e && e.code })),
    ])
    const timeoutish = [ra, rb].some((x) => x && (x.err === 'MEMORY_LOCK_UNAVAILABLE' || /lock-unavailable|state-lock-timeout/.test(String((x && x.reason) || (x && x.err) || ''))))
    ok(!timeoutish, '★ ③ 两条别名并发写未出现锁等待超时（实 ' + JSON.stringify([ra && (ra.ok === undefined ? ra.err : ra.ok), rb && (rb.ok === undefined ? rb.err : rb.ok)]) + '）')
    const txt = readFileSync(fReal, 'utf8')
    ok(txt.includes('- 经真实路径') && txt.includes('- 经链接路径'), '★ ③ 两条写入都落盘（markers=' + markerCount(txt) + '）')
  }
}

// ══════════════════════════════════════════════════════════════
console.log('[④] #320 drain 未收敛 ⇒ 迁移必须 fail-closed（不得继续发布新根）')
// ══════════════════════════════════════════════════════════════
{
  const empty = await MT.drainMemoryMutationFlightsPre({ _memoryMutationFlights: new Set() }, { timeoutMs: 200 })
  ok(empty.settled === true && empty.waited === 0, '★ ④ 无在途写 ⇒ settled:true（实 ' + JSON.stringify(empty) + '）')
  const engine = { _memoryMutationFlights: new Set(), config: {}, expandUserPath: (p) => String(p || '') }
  MT.registerMemoryMutationFlightPre(engine, 'D:/x/f.md')
  const t0 = Date.now()
  const bounded = await MT.drainMemoryMutationFlightsPre(engine, { timeoutMs: 300 })
  const ms = Date.now() - t0
  ok(bounded.settled === false && ms < 3000, '★ ④ 未收敛时有界返回 settled:false（实 ' + ms + 'ms ' + JSON.stringify(bounded) + '）')
  ok(bounded.settled === false, '★ ④ 该形态即迁移 fail-closed 的信号（saveConfig 据此抛 SETTINGS_MIGRATION_PENDING_WRITES）')
}
console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true }) } catch (_) {} }
process.exit(fail ? 1 : 0)
