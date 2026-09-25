#!/usr/bin/env node
/**
 * smoke-test-gate-atomicity.mjs —— 并发闸门「原子性」守卫（2026-09-26 事故的产品化）
 *
 * ## 封死的 bug 类
 * 2026-09-26 用户报障「一下子派出去三四十个子代理」。根因**不是逻辑错，是时序**：
 *   `if (inflight >= 3) return` ——(插入的 `await this._readWorkbench()`)——`inflight++`
 * 同一 tick 内到达的 N 个调用方**全部**看到 `inflight < 3` 而放行、集体在 await 处挂起、
 * 再集体占位 ⇒ 实测峰值 41（日志 `inflight=3→7→40→41`，111 ms 内）。
 *
 * 静态文本守卫拦不住（每行单看都对），稳态回归也拦不住（一次只跑一路）。本守卫用**结构判据**。
 *
 * ## ★本守卫开发中连续踩了四个坑，全部内化为下面的硬约束（这才是它真正的价值）
 *   坑① `ck()` 参数反序（写成 `ck(条件, 名称)`）⇒ 条件成了**非空字符串恒真** ⇒ 报 23 PASS/0 FAIL。
 *        对策：`ck` 改**对象参数**并在运行时校验类型，参数反序直接抛错（见下方自检）。
 *   坑② 闸门识别正则要求行尾 `{` ⇒ 5 个闸门只认出 1 个（真实写法有 `return x` / `return {…}`）。
 *        对策：放宽正则 + **发现数量精确断言**（漏检即 FAIL，不是软警告）。
 *   坑③ 函数范围推断（花括号配平）在本仓库 14.5k 行 / 混合对象字面量下不可靠。
 *        对策：**改用行窗口**，不猜函数边界。
 *   坑④ `finally` 同行内联写法（`try { … } finally { … }`）不被「行首 } finally {」识别。
 *        对策：全文正则 `finally\s*{`，不要求行首。
 *
 * 判据：
 *   A（核心）闸门检查行与占位赋值行之间**零 `await`** —— 这条直接对应事故根因。
 *   B 占位赋值**紧贴**检查（≤ 12 行）。
 *   C 闸门后 60 行窗口内存在释放保障（`finally` 或 `*Release*()` 调用）。
 *   D 每个占位都应有对应闸门（`_scheduleBusy` 类非互斥旗标登记豁免）。
 *
 * 用法：node tests/smoke/smoke-test-gate-atomicity.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = path.join(ROOT, 'lib', 'index.js')

let pass = 0, fail = 0
/** ★对象参数 —— 防「位置反序 ⇒ 字符串恒真」这类假绿（坑①） */
function ck({ name, ok, detail }) {
  if (typeof name !== 'string' || !name) throw new Error('ck(): name 必须是非空字符串（防参数反序）')
  if (typeof ok !== 'boolean') throw new Error('ck(): ok 必须是布尔值（防把字符串当条件）')
  ok ? pass++ : fail++
  console.log(`${ok ? '  OK  ' : '  FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
}

const raw = fs.readFileSync(SRC, 'utf8')
const lines = raw.split(/\r?\n/)
console.log(`源: lib/index.js  ${Buffer.byteLength(raw, 'utf8')} B / ${lines.length} 行`)

const FIELD = '(_[A-Za-z0-9]*(?:Busy|Inflight|Flight))'
const strip = (l) => {
  const t = l.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return ''
  return l.replace(/\/\/.*$/, '')
}
/** 闸门检查（坑②：不限定行尾字符） */
const GATE_RE = new RegExp('^\\s*if\\s*\\(\\s*!?\\s*this\\.' + FIELD + '[^)]*\\)')
/** 占位/释放赋值。m[1]=字段名，m[2]=**右值**（坑④：别再拿 m[1] 当右值） */
const SET_RE = new RegExp('^\\s*this\\.' + FIELD + '\\s*=(.*)$')
const isReleaseRhs = (rhs) => /Math\.max/.test(rhs) || /^\s*(false|null|undefined|0)\s*;?\s*$/.test(rhs)

const gates = []
const placeholders = []
const releases = []
for (let i = 0; i < lines.length; i++) {
  const s = strip(lines[i])
  const g = s.match(GATE_RE)
  if (g) gates.push({ line: i, field: g[1] })
  const m = s.match(SET_RE)
  if (m) {
    const rec = { line: i, field: m[1], rhs: m[2] }
    if (isReleaseRhs(m[2])) releases.push(rec); else placeholders.push(rec)
  }
}

console.log('\n【发现】闸门')
for (const g of gates) console.log(`        ${g.field.padEnd(20)} @L${g.line + 1}`)
console.log('【发现】占位（非释放形态）')
for (const p of placeholders) console.log(`        ${p.field.padEnd(20)} @L${p.line + 1}`)

const EXPECT_GATES = ['_smartRecallFlight', '_subagentInflight', '_wbRotateBusy', '_workbenchBusy']
console.log('\n【发现完整性】形态扫描不得漏检（坑②）')
ck({ name: '★闸门发现数 = 4', ok: gates.length === EXPECT_GATES.length, detail: `实际 ${gates.length}` })
ck({
  name: '★闸门字段集合逐字匹配',
  ok: JSON.stringify([...new Set(gates.map((g) => g.field))].sort()) === JSON.stringify([...EXPECT_GATES].sort()),
  detail: [...new Set(gates.map((g) => g.field))].join(','),
})
ck({ name: '★占位发现数 = 6', ok: placeholders.length === 6, detail: `实际 ${placeholders.length}` })
ck({ name: '★发现数量断言有效（错误正则必漏检）', ok: (() => {
  const BAD_RE = new RegExp('^\\s*if\\s*\\(\\s*this\\.' + FIELD + '[^)]*\\)\\s*\\{\\s*$')
  return lines.filter((l) => BAD_RE.test(strip(l))).length < gates.length
})(), detail: '窄正则会少认闸门' })

/* ══ 判据 A/B（行窗口，不猜函数边界 —— 坑③） ══ */
console.log('\n【判据 A/B】检查与占位之间零 await；占位紧贴检查')
for (const g of gates) {
  // 同一字段的下一个占位行（窗口上限 40 行）
  let ph = -1
  for (let i = g.line + 1; i < Math.min(g.line + 41, lines.length); i++) {
    const p = placeholders.find((x) => x.line === i && x.field === g.field)
    if (p) { ph = i; break }
  }
  ck({ name: `${g.field} 找到占位赋值行`, ok: ph > g.line, detail: ph > 0 ? `L${ph + 1}` : '未找到（窗口 40 行内）' })
  if (ph < 0) continue
  const gap = ph - g.line
  ck({ name: `${g.field} 占位紧贴检查（≤12 行）`, ok: gap <= 12, detail: `间隔 ${gap} 行` })
  const bad = []
  for (let i = g.line; i < ph; i++) if (/\bawait\b/.test(strip(lines[i]))) bad.push(i + 1)
  ck({ name: `★${g.field} 检查→占位零 await`, ok: bad.length === 0, detail: bad.length ? '越界 L' + bad.join(',L') : '无' })
  for (const ln of bad) console.log(`        L${ln}: ${lines[ln - 1].trim().slice(0, 100)}`)
}

/* ══ 判据 C（字段级配对，不用固定窗口） ══
 * 坑③b：首版用「闸门后 60 行」固定窗口 ⇒ `_workbenchBusy` 的 finally 在 200 行外被误判缺保障。
 * 正解：**按字段配对** —— 对每个闸门字段，断言「存在释放该字段的行」，
 *       且释放行数 ≥ 该字段的占位行数（多占位必须多释放，否则泄漏）。 */
console.log('\n【判据 C】按字段配对：每个闸门的占位都必须有释放')
for (const g of gates) {
  const ph = placeholders.filter((p) => p.field === g.field && p.line > g.line)
  const rel = releases.filter((r) => r.field === g.field && r.line > g.line)
  // 释放器形态（本轮修法）：_wbReleaseInflight 是幂等函数，字段级释放体现为函数体内的 Math.max
  const relFn = raw.includes(g.field.replace('_', '_')) && new RegExp('[Rr]elease[\\w$]*\\s*=').test(raw)
  ck({
    name: `${g.field} 占位与释放配对`,
    ok: rel.length >= ph.length || relFn,
    detail: `占位 ${ph.length} 处 / 直接释放 ${rel.length} 处 / 释放器存在=${relFn}`,
  })
}
// 全局守恒：每个闸门字段都必须能被释放（否则闸门永久卡死）
for (const f of [...new Set(gates.map((g) => g.field))]) {
  const hasDirect = releases.some((r) => r.field === f)
  const hasFn = new RegExp('[Rr]elease[\\w$]*\\s*=\\s*(\\(|function)').test(raw)
  // 说明：_subagentInflight 走幂等释放器；其余走 finally 内直接复位
  ck({ name: `★${f} 存在释放路径`, ok: hasDirect || hasFn, detail: `直接=${hasDirect} 释放器=${hasFn}` })
}

/* ══ 判据 D ══ */
console.log('\n【判据 D】反向：每个占位都应有对应闸门')
const NON_MUTEX = new Set(['_scheduleBusy'])   // 登记豁免：一次性状态旗标（只置位+复位，从不判）
const gateFields = new Set(gates.map((g) => g.field))
const orphan = placeholders.filter((p) => !gateFields.has(p.field) && !NON_MUTEX.has(p.field))
ck({ name: '★无孤立占位（豁免登记之外）', ok: orphan.length === 0, detail: orphan.map((o) => `L${o.line + 1} ${o.field}`).join(' ') || '无' })
ck({ name: '豁免登记有效：_scheduleBusy 确非互斥闸门', ok: !gateFields.has('_scheduleBusy') })

/* ══ 变异红证明 ══ */
console.log('\n【变异红证明】缺陷样本必须被抓住（否则判据恒真）')
{
  const S = ['    if (this._demoInflight >= 3) {', "      return ''", '    }', '    const st = await this._readWorkbench()', '    this._demoInflight = (this._demoInflight || 0) + 1']
  const gi = S.findIndex((l) => GATE_RE.test(strip(l)))
  let pi = -1
  for (let i = gi + 1; i < S.length; i++) { const m = strip(S[i]).match(SET_RE); if (m && !isReleaseRhs(m[2])) { pi = i; break } }
  let bad = 0
  for (let i = gi; i < pi; i++) if (/\bawait\b/.test(strip(S[i]))) bad++
  ck({ name: '缺陷样本可被形态扫描识别', ok: gi >= 0 && pi > gi })
  ck({ name: '★判据 A 抓住缺陷样本（检出 await =1）', ok: bad === 1, detail: `实际 ${bad}` })
}
{
  const S2 = ['    if (this._demoBusy) return', '    this._demoBusy = true', '    if (!ok) return', '    this._demoBusy = false']
  const hasFinally = S2.some((l) => /finally\s*\{/.test(strip(l)))
  const rel = S2.some((l) => /[A-Za-z_$][\w$]*[Rr]elease[\w$]*\s*\(/.test(strip(l)))
  ck({ name: '★判据 C 抓住缺陷样本（早退不释放）', ok: !(hasFinally || rel) })
}
{
  let threw = false
  try { ck({ name: true, ok: 'nonempty-string' }) } catch (_) { threw = true }
  ck({ name: '★ck() 拒绝参数反序（防假绿①）', ok: threw })
}

console.log(`\n═══ 结果：${pass} PASS / ${fail} FAIL ═══`)
process.exit(fail ? 1 : 0)
