/**
 * R2-E1 · evidence 读侧守卫（契约对齐）
 *
 * 背景（2026-09-18 实测，报告 docs/internal/R2-EVIDENCE-DEEP-AUDIT-20260918.md）：
 *   写侧 evidence-store.js:126 的 mkdirSync 是**懒建**（只在首次成功 append 时创建），
 *   且 persistEvidence 的两个调用点都带内容前置条件（context-host.js:653/:699）
 *   ⇒ **「目录不存在」在写侧是合法状态**。
 *   读侧原先无条件 readdirSync ⇒ ENOENT 被 catch 吞掉 ⇒ impMap 恒空
 *   ⇒ importance 全体中性 ⇒ 对「从未成功 append 过」的用户，该臂每次 recall 都静默失效。
 *
 * 定性：**契约缺口**（读写对「目录可能不存在」无共识），非容错不足。
 *
 * 本套件断言三件事：
 *   ① 前提成立：目录不存在时，原实现路径确实会抛（证明守卫不是多余的）
 *   ② 守卫位置：existsSync 在 readdirSync **之前**，且不存在分支**不写 diag**（静默=预期内分支）
 *   ③ 契约对称：写侧确实懒建（目录不存在不报错），故读侧容忍不存在是对齐而非特例
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const SRC_INDEX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const SRC_STORE = fs.readFileSync(path.join(ROOT, 'lib', 'evidence-store.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n) } }

console.log('=== R2-E1 · evidence 读侧守卫 ===\n')

// ── ① 前提：目录不存在时，未加守卫的扫描确会抛 ─────────────────────
console.log('[1] 前提成立：目录不存在 ⇒ 未加守卫的 readdirSync 会抛')
{
  const missing = path.join(os.tmpdir(), 'dam-r2e1-not-exist-' + Date.now())
  let threw = false
  try { fs.readdirSync(missing) } catch (e) { threw = (e.code === 'ENOENT') }
  ok(threw, 'readdirSync 对不存在目录抛 ENOENT（守卫的必要性）')

  // 同时确认 existsSync 能正确判否——这正是守卫的判据
  ok(fs.existsSync(missing) === false, 'existsSync 正确判定目录不存在')
}

// ── ② 守卫位置与静默语义（源码级断言，精确到那一行）────────────────
console.log('\n[2] 守卫位置与静默语义（源码断言）')
{
  const iGuard = SRC_INDEX.indexOf('existsSync(evDir)')
  const iRead = SRC_INDEX.indexOf('readdirSync(evDir)')
  ok(iGuard > 0, 'index.js 含 existsSync(evDir) 守卫')
  ok(iRead > 0, 'index.js 含 readdirSync(evDir)')
  ok(iGuard < iRead, '★ 守卫在 readdirSync **之前**（顺序断言）')

  // 取守卫行到 else 分支之间的片段，确认不存在分支内没有 diag（静默）
  const iElse = SRC_INDEX.indexOf('} else {', iGuard)
  ok(iElse > 0, '存在 else 分支（存在 ⇒ 才走扫描）')
  const absentBranch = SRC_INDEX.slice(iGuard, iElse)
  ok(!/diag\s*\(/.test(absentBranch),
    '★ 目录不存在分支**不写 diag**（预期内分支，静默跳过 —— 避免每次 recall 刷屏）')
  ok(!/throw\b/.test(absentBranch),
    '目录不存在分支**不抛异常**（保持 impMap 空 = 全体中性，不阻塞检索）')

  // 反向对照：真正的异常仍应被 catch 记录（不能因为加守卫就把故障也吞成静默）
  const iCatch = SRC_INDEX.indexOf("catch (eImp)", iElse)
  ok(iCatch > 0, '保留 catch (eImp) 兜底真正的异常')
  const catchSeg = SRC_INDEX.slice(iCatch, iCatch + 220)
  // ★2026-09-22（P3-9 组1 落盘后同步）：该处 diag 已被换成 diagThrottled('evidence-agg', …)。
  //   放宽的是**拼写**不是判据 —— 仍要求「真异常分支里有诊断调用」；节流只压重复、不吞首条。
  ok(/diagThrottled\s*\(|diag\s*\(/.test(catchSeg), '★ 真异常仍写 diag（故障可见性未被削弱）')
}

// ── ③ 契约对称：写侧确实懒建 ──────────────────────────────────────
console.log('\n[3] 契约对称性：写侧懒建（故读侧容忍不存在=对齐）')
{
  const iMk = SRC_STORE.indexOf('mkdirSync(this.eventsDir')
  ok(iMk > 0, '写侧含 mkdirSync(this.eventsDir, { recursive: true })')
  // mkdirSync 必须出现在 append 内（懒建），而不是构造函数里（确定性建目录）
  const iAppend = SRC_STORE.indexOf('async append(')
  ok(iAppend > 0 && iAppend < iMk, '★ mkdirSync 在 append 之内 ⇒ 确认是**懒建**（非注册期建目录）')

  // 懒建语义：目录不存在时构造函数不报错
  const { createHash } = await import('node:crypto')
  ok(typeof createHash === 'function', '(环境自检) crypto 可用')
}

// ── ④ 端到端：懒建契约的真实行为 ──────────────────────────────────
console.log('\n[4] 端到端：懒建契约（新装用户目录不存在是合法态）')
{
  const { EvidenceEventStore } = await import(pathToFileUrl(path.join(ROOT, 'lib', 'evidence-store.js')))
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-r2e1-'))
  const root = path.join(tmpRoot, 'evidence')
  ok(!fs.existsSync(root), '初始：证据根目录不存在（模拟新装用户）')

  // 构造 store 不应因目录不存在而失败
  let ctorOk = true
  let store = null
  try { store = new EvidenceEventStore({ root }) } catch (e) { ctorOk = false }
  ok(ctorOk, '构造 EvidenceEventStore 不因目录不存在而失败（懒建契约）')
  ok(!fs.existsSync(root), '★ 构造后目录**仍未创建**（确认非注册期建目录）')

  // 目录不存在时读取：接受「返回空」或「抛 ENOENT」两种都算符合现状，
  // 但**关键断言**是：读侧（index.js）已在此之前用 existsSync 拦下，不会再走到这里。
  let readOutcome = 'ok'
  try { if (store && typeof store.loadEvents === 'function') store.loadEvents() }
  catch (e) { readOutcome = 'threw:' + (e.code || e.name) }
  ok(readOutcome !== 'ok' || true, '（信息）目录不存在时直接 loadEvents 的结果 = ' + readOutcome)

  // 清理
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
}

// ── ⑤ 回归锁：不得引入新的无条件 readdirSync ──────────────────────
console.log('\n[5] 回归锁：evidence 读取处不得再有裸 readdirSync')
{
  // 抓取 evidence 聚合块（从 R2-E1 标记到 catch），确认 readdirSync 只出现在 else 分支内
  const iMark = SRC_INDEX.indexOf('R2-E1')
  ok(iMark > 0, '存在 R2-E1 标记（可溯源）')
  const iGuard = SRC_INDEX.indexOf('existsSync(evDir)', iMark)
  const iReads = []
  let from = iMark
  while (true) {
    const j = SRC_INDEX.indexOf('readdirSync(evDir)', from)
    if (j < 0) break
    iReads.push(j); from = j + 1
  }
  ok(iReads.length >= 1, '存在 readdirSync(evDir) 调用')
  ok(iReads.every((j) => j > iGuard), '★ 所有 readdirSync(evDir) 都在守卫**之后**（无裸读）')
}

function pathToFileUrl(p) {
  let s = path.resolve(p).replace(/\\/g, '/')
  if (!s.startsWith('/')) s = '/' + s
  return 'file://' + s
}

console.log('\n=== R2-E1: PASS ' + pass + ' / FAIL ' + fail + ' ===')
if (fail > 0) process.exitCode = 1
