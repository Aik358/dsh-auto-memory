#!/usr/bin/env node
/**
 * smoke-test-a20-distill-capacity-gate.mjs —— #440（A20）AI 蒸馏成功分支绕过容量门。
 *
 * ## 缺陷（改前实测）
 * maintain 的第 3 步有两个互斥分支：
 *   · distillText 非空（AI 蒸馏成功）⇒ **直接 appendText** 写项目笔记；
 *   · distillText 为空 ⇒ 老实走 ensureBudget（brief / tiny 逐级降级）。
 * 而 appendText 只做**角色门 + 卫生门 + 事务**，**没有累计容量门** ⇒ 项目笔记满额仍被追加，
 * 回执还宣称「已写入」（issue 的复现：ensureBudget 恒拒仍 append 一次、budgetCalls=0）。
 *
 * ## 验收方式（真执行）
 * 从 lib/index.js 抽出**产线 maintain 全函数体**（真代码，不是重实现），在隔离沙箱里用真文件系统跑：
 * 真写旧日志 → 真跑 maintain → 断言真实磁盘字节、appendText 调用次数、返回串。
 * ensureBudget 用**可控探针**（三个水位：恒放行 / 恒拒绝 / 抛错），以构造 issue 的「笔记已满」场景。
 *
 * ## 判据
 *  正路径：ensureBudget 恒 ok ⇒ append 1 次、返回含「已写入」、笔记真的变长
 *  负路径：① ensureBudget 恒拒 ⇒ append 0 次、磁盘字节不变、返回含「未写入」且**不含**「蒸馏提炼已写入」
 *          ② ensureBudget 抛错 ⇒ 归档成功后维护不整体失败（fail-soft）
 *          ③ distillText 为空走 fallback ⇒ 仍走同一预算探针（acctB/acctC）
 *          ④ 部分完成时调度侧判 partial（真执行产线那段判据）
 *  变异负路径（自带）：把成功分支的容量门删掉（回到直接 appendText）⇒ ① 必红。
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (x == null ? '' : ' << ' + x)) } }

// ── 抽取产线 maintain（纯括号配平，不靠行号）──
function extractMethod(src, header) {
  const a = src.indexOf(header)
  if (a < 0) throw new Error('method not found: ' + header)
  let depth = 0, started = false
  for (let i = a + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true }
    else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(a, i + 1) }
  }
  throw new Error('unbalanced method: ' + header)
}
/** 抽单行 const 定义（到行尾）。 */
function extractConst(src, header) {
  const a = src.indexOf(header)
  if (a < 0) return ''
  const end = src.indexOf('\n', a)
  return src.slice(a, end).trim()
}
/** 抽函数（括号配平）。 */
function extractFnSrc(src, header) {
  const a = src.indexOf(header)
  if (a < 0) return ''
  let depth = 0, started = false
  for (let i = a + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true }
    else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(a, i + 1) }
  }
  return ''
}
const MAINTAIN_HEADER = '  async maintain(days = 30, agent) {'
const MAINTAIN_SRC = extractMethod(SRC, MAINTAIN_HEADER)
// ★修复是否在场：不在场不 throw —— 那就是**缺陷复现**（成功分支绕过容量门），
//   让断言自然变红，从而「回退生产代码」的实验能给出可复算的 FAIL 计数。
const GATE_PRESENT = MAINTAIN_SRC.indexOf("await this.ensureBudget(agent, 'note', distillBlock)") >= 0

// ── 构建可执行 maintain：真本方法体 + 真 fs + 可控预算探针 ──
function buildMaintain(mutate) {
  // ★仓库是 CRLF：抽取出的源码带 \r\n，多行锚点必须先归一化（沙箱内归一，不写盘、不影响被测语义）
  let body = MAINTAIN_SRC.replace(/\r\n/g, '\n')
  if (mutate === 'noGate') {
    const before = body
    // 忠实回退：成功分支**不查预算**、直接 appendText（= 修复前的语义）
    const anchor1 = "      let acctD = null\n      try { acctD = await this.ensureBudget(agent, 'note', distillBlock) } catch (e) { acctD = { ok: false, thrown: (e && e.message) || String(e) } }"
    if (body.indexOf(anchor1) < 0) throw new Error('变异锚点未命中（成功分支的容量门）')
    body = body.replace(anchor1, '      const acctD = { ok: true }')
    const anchor2 = '      if (acctD && acctD.ok === true) {'
    if (body.indexOf(anchor2) < 0) throw new Error('变异锚点2未命中')
    body = body.replace(anchor2, '      if (true) {')
    if (body === before) throw new Error('变异未生效')
  }
  const fnBody = body.slice(body.indexOf('{') + 1, body.lastIndexOf('}'))
  // maintain 体引用的模块级符号（真源码抽出，不重实现）：DATE_RE / truncateTail
  const DATE_RE_SRC = extractConst(SRC, 'const DATE_RE = ')
  const TRUNC_SRC = extractFnSrc(SRC, 'const truncateTail = (') || extractFnSrc(SRC, 'function truncateTail(')
  return new Function('path', 'readFile', 'mkdir', 'rm', 'createHash', 'console',
    DATE_RE_SRC + '\n' + TRUNC_SRC + '\n' +
    'return async function maintain(days, agent) {' + fnBody + '}')
}

function makeWorkspace(tag) {
  const root = mkdtempSync(path.join(tmpdir(), 'dam-a20-' + tag + '-'))
  const projectDir = path.join(root, '.dsh-memory')
  mkdirSync(projectDir, { recursive: true })
  for (const d of ['2020-01-01', '2020-01-02']) {
    writeFileSync(path.join(projectDir, d + '.md'), '## ' + d + '\n- 旧日志正文 ' + d + '\n', 'utf8')
  }
  const notesPath = path.join(projectDir, 'MEMORY.md')
  writeFileSync(notesPath, '# 项目笔记\n\n- 既有条目\n', 'utf8')
  return { root, projectDir, notesPath, archiveDir: path.join(projectDir, 'archive') }
}

function makeSelf(ws, opts) {
  const o = opts || {}
  const calls = { append: [], budget: [], archived: [] }
  const self = {
    memToday: () => '2026-10-17',
    // maintain 依赖的只读辅助（产线里都是本类方法/模块常量；判据关心的是容量门，不是它们）
    async listDailyLogs(projectDir) {
      const names = readdirSync(projectDir).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort()
      return names.map((n) => ({ name: n, date: n.replace(/\.md$/, '') }))
    },
    readTextSafe: async (f) => { try { return readFileSync(f, 'utf8') } catch (_) { return '' } },
    async appendText(p, text) {
      calls.append.push({ path: String(p), text: String(text) })
      const cur = readFileSync(p, 'utf8')
      const next = cur + text
      writeFileSync(p, next, 'utf8')
      return next
    },
    async ensureBudget(agent, layer, text) {
      calls.budget.push({ layer, text: String(text), chars: String(text).length })
      if (o.budgetThrows) throw new Error('budget-probe-boom')
      return o.budgetOk === false
        ? { ok: false, acct: { ok: false, limit: 100, used: 100, need: 100 + String(text).length }, reason: 'still-over-capacity' }
        : { ok: true, acct: { ok: true, limit: 100000, used: 10, need: 10 + String(text).length } }
    },
    budgetRefusalTextPre(res, layer) {
      const used = (res && res.acct && res.acct.used) || 0
      const limit = (res && res.acct && res.acct.limit) || 0
      return '项目笔记已达容量上限(' + used + '/' + limit + ' 字符),自动整理未能腾出空间:已自动整理,但整理后仍放不下本次内容(单次写入过大)。'
    },
    async writeFull(p, text) {
      calls.archived.push({ path: String(p) })
      mkdirSync(path.dirname(p), { recursive: true })
      writeFileSync(p, text, 'utf8')
    },
    _subagents: o.distillText ? {} : null,
    async runSubagent() { return o.distillText || '' },
    async resolvePaths() { return { projectDir: ws.projectDir, notesPath: ws.notesPath, userDir: path.join(ws.root, 'user'), ws: ws.root } },
    async _withMemoryMutationPre(file, job) { return job(file) },
    async _withDocumentLockPre(file, job) { return job() },
    state: {},
  }
  return { self, calls }
}

function makeRunner(mutate) {
  const factory = buildMaintain(mutate)
  return async (ws, opts) => {
    const r = makeSelf(ws, opts)
    const fn = factory(path, readFileSync, (p) => mkdirSync(p, { recursive: true }),
      (p) => rmSync(p, { force: true }), createHash, console)
    // ★产线门是 `if (this._subagents && agent)`：agent 为 null 会直接跳过蒸馏 ⇒ 传哨兵对象
    const msg = await fn.call(r.self, 30, {})
    return { msg: String(msg), calls: r.calls, self: r.self }
  }
}
const runNormal = makeRunner(null)
// 修复不在场时没有「门」可回退 ⇒ 不构造变异体（由 A20-1/A20-2 直接给出红）
const runNoGate = GATE_PRESENT ? makeRunner('noGate') : null

console.log('[A20-1] 正路径：预算放行 ⇒ append 1 次、返回含「已写入」')
{
  const ws = makeWorkspace('ok')
  try {
    const r = await runNormal(ws, { distillText: '### 主题\n- 蒸馏要点一\n- 蒸馏要点二' })
    const notes = readFileSync(ws.notesPath, 'utf8')
    ok(r.calls.append.length === 1, 'A20-1a 成功分支 append 恰 1 次', 'n=' + r.calls.append.length)
    ok(r.calls.budget.length === 1, 'A20-1b ★ 成功分支**先过容量门**（改前 budgetCalls=0）', 'n=' + r.calls.budget.length)
    ok(/蒸馏提炼已写入/.test(r.msg), 'A20-1c 返回含「蒸馏提炼已写入」', r.msg.split('\n')[0])
    ok(notes.indexOf('蒸馏要点一') >= 0, 'A20-1d 内容真的写进笔记（磁盘）')
    ok(r.msg.indexOf('部分完成') < 0, 'A20-1e 预算放行时不得误报「部分完成」')
  } finally { rmSync(ws.root, { recursive: true, force: true }) }
}

console.log('[A20-2] 负路径①：预算恒拒 ⇒ append 0 次、磁盘不变、回执「未写入」不含「已写入」')
{
  const ws = makeWorkspace('refuse')
  try {
    const before = readFileSync(ws.notesPath, 'utf8')
    const beforeStat = statSync(ws.notesPath)
    const r = await runNormal(ws, { distillText: '### 主题\n- 这条不该被写进满额笔记', budgetOk: false })
    const after = readFileSync(ws.notesPath, 'utf8')
    const afterStat = statSync(ws.notesPath)
    ok(r.calls.budget.length >= 1, 'A20-2a 容量门**被调用**（改前成功分支 0 次）', 'n=' + r.calls.budget.length)
    ok(r.calls.append.length === 0, 'A20-2b ★ append 调用 0 次（改前 1 次 = 缺陷复现路径）', 'n=' + r.calls.append.length)
    ok(after === before, 'A20-2c ★ 被拒后磁盘字节逐字节不变', 'before=' + before.length + ' after=' + after.length)
    ok(afterStat.size === beforeStat.size, 'A20-2d 文件大小不变', beforeStat.size + ' -> ' + afterStat.size)
    ok(r.msg.indexOf('未写入') >= 0, 'A20-2e ★ 回执含「未写入」', r.msg.slice(0, 160))
    ok(r.msg.indexOf('蒸馏提炼已写入') < 0, 'A20-2f ★ 回执**不含**「蒸馏提炼已写入」（不伪报）', r.msg.slice(0, 160))
    ok(/容量上限/.test(r.msg), 'A20-2g 回执带既有统一拒绝文案（budgetRefusalTextPre）', r.msg.slice(0, 200))
    ok(r.msg.indexOf(ws.archiveDir) >= 0, 'A20-2h 回执带归档路径（信息不丢）', r.msg.slice(0, 240))
    ok(r.msg.indexOf('memory_read(kind="archive")') >= 0, 'A20-2i 回执带取回命令', r.msg.slice(0, 240))
    ok(/部分完成/.test(r.msg), 'A20-2j ★ 返回串标「部分完成」（不伪报完成）', r.msg.split('\n')[0])
    const archivedFiles = existsSync(ws.archiveDir) ? readdirSync(ws.archiveDir) : []
    ok(archivedFiles.length === 2, 'A20-2k ★ 归档副本仍在（任何分支都不删唯一副本）', JSON.stringify(archivedFiles))
  } finally { rmSync(ws.root, { recursive: true, force: true }) }
}

console.log('[A20-3] 负路径②：容量门自身抛错 ⇒ 维护不整体失败、归档照样完成')
{
  const ws = makeWorkspace('throw')
  try {
    let threw = null, out = null
    try { out = await runNormal(ws, { distillText: '### 主题\n- 要点', budgetThrows: true }) } catch (e) { threw = e }
    ok(!threw, 'A20-3a ★ 容量门抛错不得让 maintain 整体失败（fail-soft）', threw && threw.message)
    ok(out && /未写入/.test(out.msg), 'A20-3b 回执照实说未写入', out && out.msg.slice(0, 140))
    ok(out && out.calls.append.length === 0, 'A20-3c 抛错时不追加', 'n=' + (out && out.calls.append.length))
    const archivedFiles = existsSync(ws.archiveDir) ? readdirSync(ws.archiveDir) : []
    ok(archivedFiles.length === 2, 'A20-3d ★ 第 2 步的归档已完成（不因容量门异常回退）', JSON.stringify(archivedFiles))
  } finally { rmSync(ws.root, { recursive: true, force: true }) }
}

console.log('[A20-4] 负路径③：distillText 空 ⇒ fallback 仍走同一套预算探针（口径未分叉）')
{
  const ws = makeWorkspace('fallback')
  try {
    const r = await runNormal(ws, { distillText: '' })
    ok(r.calls.budget.length >= 1, 'A20-4a ★ fallback 的指针写入也过**同一**预算探针（与成功分支同源）', 'n=' + r.calls.budget.length)
    ok(r.calls.budget.every((b) => b.layer === 'note'), 'A20-4d 探针口径一致（layer=note）', JSON.stringify(r.calls.budget.map((b) => b.layer)))
    ok(r.calls.append.length >= 1, 'A20-4b fallback 仍写得进指针', 'n=' + r.calls.append.length)
    ok(/AI 蒸馏不可用/.test(r.msg), 'A20-4c 回执仍说明 AI 蒸馏不可用', r.msg.slice(0, 120))
  } finally { rmSync(ws.root, { recursive: true, force: true }) }
}

console.log('[A20-5] 负路径④：调度侧的 partial 判据能识别「部分完成」')
{
  const a = SRC.indexOf("const partial = text.indexOf('未删除(可手动清理)') >= 0")
  if (a < 0) throw new Error('调度侧 partial 判据锚点缺失')
  const end = SRC.indexOf('\n', a)
  const line = SRC.slice(a, end).trim()
  const partialOf = new Function('text', line + '\nreturn partial')
  ok(partialOf('30 天蒸馏部分完成: AI 提炼 + 原文归档 2 个旧日志(a.md)\n蒸馏要点**未写入** /y') === true, 'A20-5a ★ 含「未写入」⇒ partial=true')
  ok(partialOf('30 天蒸馏完成: AI 提炼 + 原文归档 2 个旧日志(a.md)\n蒸馏提炼已写入 /y') === false, 'A20-5b 正常完成 ⇒ partial=false（不误报）')
  ok(partialOf('30 天蒸馏完成: 原文归档 2 个旧日志(a.md)\n未删除(可手动清理): b.md') === true, 'A20-5c 既有「未删除」判据仍生效（未回归）')
}

console.log('[A20-MUT] 变异：删掉成功分支的容量门（回到直接 appendText）⇒ A20-2 同款场景必红')
if (!GATE_PRESENT) {
  ok(true, 'A20-MUT 修复不在场 ⇒ 由 A20-1b/A20-2b 直接给出红（无需二次变异）')
} else {
  const ws = makeWorkspace('mut')
  try {
    const before = readFileSync(ws.notesPath, 'utf8')
    const r = await runNoGate(ws, { distillText: '### 主题\n- 满额时不该被追加的内容', budgetOk: false })
    const after = readFileSync(ws.notesPath, 'utf8')
    ok(r.calls.budget.length === 0, 'A20-MUTa ★ 退回缺陷语义后容量门 0 次调用（复现 budgetCalls=0）', 'n=' + r.calls.budget.length)
    ok(r.calls.append.length === 1 && after !== before, 'A20-MUTb ★ 退回后照样 append 1 次并写进磁盘（缺陷复现）', 'append=' + r.calls.append.length + ' changed=' + (after !== before))
    ok(/蒸馏提炼已写入/.test(r.msg), 'A20-MUTc ★ 退回后回执伪报「已写入」（缺陷复现）', r.msg.slice(0, 120))
  } finally { rmSync(ws.root, { recursive: true, force: true }) }
}

console.log('\nPASS ' + pass + ' / FAIL ' + fail)
if (fail) process.exit(1)
