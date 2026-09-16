// P1 · 并发原子边界 T1-1 / T1-2 / T1-7C（设计稿 §4）。
//
// 设计稿：docs/internal/DESIGN-P1-STATE-COMMIT-20260915.md（用户已批准）
//
// 这三条断言是 P1 的**核心验收** —— 它们要证的不是"能写"，而是：
//   ① 两个写者都读到同一 digest 后**同时**提交 ⇒ **恰好一个成功**（T1-1）；
//   ② 成功者的内容**没有被后写者覆盖**（T1-2）；
//   ③ 被拒方拿到的信息**带期望值/实测值/冲突目标**，不是一句"失败"（T1-7C / §2.6）。
//
// ⚠️ 为什么必须用**真实 fs + 真实并发**：卡内明确指出"两个写者都先读 D、都通过比较、再分别写
//    A 和 B ⇒ 后写者仍会覆盖前写者"。这个缺陷只在**真并发**下暴露；用 mock 顺序调用会把它藏起来。
//    因此本套件刻意不做假 fs —— 它要复现的就是那个真实交错。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.on('uncaughtException', (e) => { console.error('[P1-CONC] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[P1-CONC] REJ:', r); process.exit(1) })

const { MemoryDocumentStore } = await import('../../lib/memory-writer-pre.js')

let pass = 0, fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const sha = (b) => createHash('sha256').update(b).digest('hex')

const ROOT = mkdtempSync(path.join(tmpdir(), 'p1-conc-'))
const LEGACY = '# 用户记忆\n\n- 硬性规则：UTF-8 无 BOM\n'

function freshStore(name, extra = {}) {
  const dir = path.join(ROOT, name)
  const file = path.join(dir, 'MEMORY.md')
  // ⚠️ 必须用**同步** mkdir：`fsp.mkdir` 返回 Promise，不 await 就 writeFileSync 会 ENOENT
  // （本套件第一次跑就踩到：全量回归里报 `ENOENT ... t1-8c\MEMORY.md`）。
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, LEGACY, 'utf8')
  const store = new MemoryDocumentStore({ fs: fsp, ...extra })
  return { store, file }
}

console.log('[p1-conc] T1-1 两窗口同 digest 并发提交 ⇒ 恰好一个成功')
{
  const { store, file } = freshStore('t1-1')
  // 两个"窗口"各自**独立**读到同一版本（这就是真实的"都读到 D"）
  const d0 = sha(readFileSync(file))
  const A = '## 2026-09-15 · 窗口A\n- A 写的内容'
  const B = '## 2026-09-15 · 窗口B\n- B 写的内容'
  // 真并发：同一 tick 双双入队（`_queue` 按路径串行 ⇒ 第二条必然在第一条提交后才读状态）
  const [ra, rb] = await Promise.all([
    store.append(file, A, { expectedDigest: d0 }),
    store.append(file, B, { expectedDigest: d0 }),
  ])
  const winners = [ra, rb].filter((r) => r && r.ok === true)
  const losers = [ra, rb].filter((r) => r && r.ok === false)
  ok(winners.length === 1, '★恰好一个成功（实得 ' + winners.length + '）')
  ok(losers.length === 1, '★恰好一个被拒（实得 ' + losers.length + '）')
  ok(losers[0] && losers[0].reason === 'conflict-external-edit', '拒因是 conflict-external-edit（实得 ' + (losers[0] && losers[0].reason) + '）')

  console.log('[p1-conc] T1-2 成功者内容未被覆盖')
  const finalText = readFileSync(file, 'utf8')
  const hasA = finalText.includes('A 写的内容')
  const hasB = finalText.includes('B 写的内容')
  const aWon = !!(ra && ra.ok)
  ok(aWon ? hasA : hasB, '★终态含**成功者**写入的内容')
  ok(aWon ? !hasB : !hasA, '★终态**不含**被拒者的内容（没被覆盖/没混入）')
  ok(hasA !== hasB, '两者不会同时出现（不出现"都写进去了"）')
  // 终态 digest 必须等于成功者那次提交返回的 digest（自证：真落盘的就是成功者那份）
  ok(sha(Buffer.from(finalText, 'utf8')) === (aWon ? ra.digest : rb.digest), '★终态字节 == 成功者提交的 digest')

  console.log('[p1-conc] T1-7C 拒绝信息可见（带期望/实测/目标）')
  const c = losers[0] && losers[0].conflict
  ok(!!c, '被拒结果携带 conflict 对象（不是只有一句失败）')
  ok(c && c.expected === d0, '★带**期望** digest')
  ok(c && c.observed && c.observed !== '(missing)', '★带**实测** digest')
  ok(c && c.observed !== c.expected, '实测 ≠ 期望（这就是冲突的事实）')
  ok(c && c.target === file, '★带**冲突目标**路径')
  ok(c && c.kind === 'digest', 'kind=digest（区分字节闸与状态闸）')
  rmSync(path.join(ROOT, 't1-1'), { recursive: true, force: true })
}

console.log('[p1-conc] T1-8/T1-9 兼容档真值表（缺省 ⇒ 行为与 P1 前逐字节一致）')
{
  // ① 不传任何 expected* ⇒ 提交照常成功（这是兼容档的核心：老调用方零改动）
  const { store, file } = freshStore('t1-8a')
  const r1 = await store.append(file, '## 无期望值\n- 老调用方路径', {})
  ok(r1 && r1.ok === true, '★不传 expectedDigest/expectedStateVersion ⇒ 照常成功（零行为变化）')
  ok(!r1.conflict, '成功结果不带 conflict')
  rmSync(path.join(ROOT, 't1-8a'), { recursive: true, force: true })

  // ② 传 expectedDigest 且匹配 ⇒ 成功（既有语义不回归）
  const s2 = freshStore('t1-8b')
  const d2 = sha(readFileSync(s2.file))
  const r2 = await s2.store.append(s2.file, '## 匹配\n- 内容', { expectedDigest: d2 })
  ok(r2 && r2.ok === true, 'expectedDigest 匹配 ⇒ 成功（既有语义保持）')
  rmSync(path.join(ROOT, 't1-8b'), { recursive: true, force: true })

  // ③ 传 expectedDigest 且不符 ⇒ 拒绝（既有语义不回归）
  const s3 = freshStore('t1-8c')
  const r3 = await s3.store.append(s3.file, '## 不符\n- 内容', { expectedDigest: 'deadbeef' })
  ok(r3 && r3.ok === false && r3.reason === 'conflict-external-edit', 'expectedDigest 不符 ⇒ 拒绝（既有语义保持）')
  ok(readFileSync(s3.file, 'utf8') === LEGACY, '★拒绝后文件字节未变（既有语义：不写坏）')
  rmSync(path.join(ROOT, 't1-8c'), { recursive: true, force: true })

  // ④ 状态闸：无 sidecar ⇒ expectedStateVersion 一律 fail-closed 拒绝（证明不了"同版"就不写）
  const s4 = freshStore('t1-8d')
  const r4 = await s4.store.append(s4.file, '## 状态闸\n- 内容', { expectedStateVersion: 'v-anything' })
  ok(r4 && r4.ok === false, '★无 sidecar 时传 expectedStateVersion ⇒ 拒绝（fail-closed，不猜版本）')
  ok(r4.reason === 'conflict-state-version', '拒因是 conflict-state-version（与字节闸区分），实得 ' + r4.reason)
  ok(r4.conflict && r4.conflict.kind === 'state-version', 'conflict.kind=state-version')
  ok(r4.conflict && r4.conflict.observed === '(unknown)', '★实测值标注为 (unknown) 而非编造版本号')
  const after4 = readFileSync(s4.file, 'utf8')
  ok(after4 === LEGACY, '★拒绝后文件字节未变（没写坏）')
  rmSync(path.join(ROOT, 't1-8d'), { recursive: true, force: true })
}

// ⚠️ 结尾这三行**必须保留**：漏掉 process.exit 时脚本恒 exit 0，
// FAIL 不会传给 runner ⇒ 套件会变成"永远绿"（本文件第一版就漏了，已修）。
console.log('[p1-conc] ' + pass + '/' + (pass + fail) + ' assertions passed')
try { rmSync(ROOT, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)
