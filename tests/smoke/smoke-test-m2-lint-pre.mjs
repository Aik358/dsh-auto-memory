/**
 * M2 · 白板 lint（缺口 4，只读纯函数）
 *
 * 契约 §6「零 token 可判的四类」：
 *   ① 孤立条目：无入站引用
 *   ② 陈旧：status≠current，或超阈值仍 current
 *   ③ 被提及却无独立卡
 *   ④ 缺交叉引用
 *   ⑤ 矛盾检测 → 需 LLM，**必须手动触发，不进自动路径**（本套件断言它被显式声明"未判"）
 *
 * **硬纪律（契约 §6 尾注）**：lint **只报告，不自动改**。
 *   「任何自动修正都会把白板变成状态机（违反边界）」
 * ⇒ 本套件必须能证明「**跑完后文件 mtime 不变**」（战斗计划原文验收口径）。
 *
 * 判据纪律（沿用 M2.5a 教训）：**宁可漏判，不可误伤**。
 *   - ③「什么算概念」无法零 token 判定 ⇒ 只判**客观可证**的悬空 id 引用
 *   - ④「什么算相关」不猜语义 ⇒ 由 tag 交集代言
 *   - 不确定的一律不报，而不是猜一个
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  lintWhiteboardPre, WB_LINT_VERSION, WB_LINT_CODES_PRE_V1, WB_LINT_DEFAULTS_PRE_V1,
} from '../../lib/wb-contract-pre.js'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n) } else { fail++; console.log('  FAIL ' + n) } }
const eq = (a, b, n) => ok(a === b, n + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const NOW = '2026-09-18'
const A = 'mem_' + 'a'.repeat(32)
const B = 'mem_' + 'b'.repeat(32)
const C = 'mem_' + 'c'.repeat(32)
const DEAD = 'mem_' + 'd'.repeat(32)
const mk = (id, title, extra = {}) => Object.assign(
  { id, title, status: 'current', date: '2026-09-15', tags: [], body: '' }, extra,
)
const codes = (r) => r.findings.map((f) => f.code)
const byCode = (r, c) => r.findings.filter((f) => f.code === c)

console.log('=== M2 · 白板 lint（只读纯函数）===\n')

// ── 1. ① 孤立条目 ────────────────────────────────────────────────
console.log('[1] ① 孤立条目（无入站引用）')
{
  const r = lintWhiteboardPre([
    mk(A, '甲卡', { body: '甲自己的正文' }),
    mk(B, '乙卡', { body: '详见 ' + A }),
  ], { now: NOW })
  const orphans = byCode(r, WB_LINT_CODES_PRE_V1.ORPHAN).map((f) => f.title)
  eq(orphans.length, 1, '只报 1 条孤立')
  eq(orphans[0], '乙卡', '★ 被引用的甲卡不报；乙卡无人引用 ⇒ 报')

  // 反例：全部互引 ⇒ 零孤立
  const r2 = lintWhiteboardPre([
    mk(A, '甲卡', { body: '见 ' + B }),
    mk(B, '乙卡', { body: '见 ' + A }),
  ], { now: NOW })
  eq(byCode(r2, WB_LINT_CODES_PRE_V1.ORPHAN).length, 0, '反例：互引 ⇒ 无孤立')

  // 标题引用也算入站 —— 注意：乙卡自己仍无人引用，所以它**仍是**孤立条目。
  // （第一版断言写成"孤立=0"是错的：漏看了乙卡自身。实现是对的，断言错。）
  const r3 = lintWhiteboardPre([
    mk(A, '甲卡', { body: 'x' }),
    mk(B, '乙卡', { body: '参见「甲卡」' }),
  ], { now: NOW })
  const orph3 = byCode(r3, WB_LINT_CODES_PRE_V1.ORPHAN).map((f) => f.title)
  ok(!orph3.includes('甲卡'), '★ 标题被提及 ⇒ 甲卡不算孤立')
  ok(orph3.includes('乙卡'), '★ 乙卡自身无人引用 ⇒ 仍是孤立（断言须精确到条目，不能只看总数）')

  // ★ 宁可漏判：单字标题不参与标题匹配（避免误命中）
  const r4 = lintWhiteboardPre([
    mk(A, '甲', { body: 'x' }),
    mk(B, '乙卡', { body: '甲乙丙' }),
  ], { now: NOW })
  ok(byCode(r4, WB_LINT_CODES_PRE_V1.ORPHAN).length >= 1, '★ 单字标题不参与匹配（宁漏不误）')
}

// ── 2. ② 陈旧 ───────────────────────────────────────────────────
console.log('\n[2] ② 陈旧（状态 + 日期）')
{
  const r = lintWhiteboardPre([
    mk(A, '现行卡', { body: '引 ' + B }),
    mk(B, '作废卡', { status: 'superseded', body: '引 ' + A }),
    mk(C, '撤回卡', { status: 'retracted', body: '引 ' + A }),
  ], { now: NOW })
  eq(byCode(r, WB_LINT_CODES_PRE_V1.INACTIVE).length, 2, 'superseded + retracted 各报一条')

  const r2 = lintWhiteboardPre([
    mk(A, '老卡', { date: '2026-01-01' }),
    mk(B, '新卡', { date: '2026-09-15', body: '引 ' + A }),
  ], { now: NOW, staleDays: 90 })
  const exp = byCode(r2, WB_LINT_CODES_PRE_V1.EXPIRED)
  eq(exp.length, 1, '超阈值 current ⇒ 报 expired')
  eq(exp[0].title, '老卡', '报的是老卡')

  // 反例：阈值内不报
  const r3 = lintWhiteboardPre([
    mk(A, '新卡', { date: '2026-09-17' }),
    mk(B, '卡2', { date: '2026-09-10', body: '引 ' + A }),
  ], { now: NOW, staleDays: 90 })
  eq(byCode(r3, WB_LINT_CODES_PRE_V1.EXPIRED).length, 0, '反例：阈值内不报')

  // 边界：正好 staleDays 天前不报（严格小于才报）
  const r4 = lintWhiteboardPre([mk(A, '边界', { date: '2026-06-20' })], { now: NOW, staleDays: 90 })
  eq(byCode(r4, WB_LINT_CODES_PRE_V1.EXPIRED).length, 0, '边界：恰好 90 天不报（严格 < 才报）')

  // 缺日期不报（不猜）
  const r5 = lintWhiteboardPre([mk(A, '无日期', { date: '' })], { now: NOW })
  eq(byCode(r5, WB_LINT_CODES_PRE_V1.EXPIRED).length, 0, '★ 无日期不报（不猜）')
}

// ── 3. ③ 悬空引用（客观可证）──────────────────────────────────────
console.log('\n[3] ③ 被引用却无卡（只判客观可证的悬空 id）')
{
  const r = lintWhiteboardPre([mk(A, '甲卡', { body: '见 ' + DEAD })], { now: NOW })
  const d = byCode(r, WB_LINT_CODES_PRE_V1.DANGLING_REF)
  eq(d.length, 1, '引用不存在的 id ⇒ 报 1 条')
  // ★ 防御式断言：不给实现出错的机会把整条套件崩掉（崩了只会报 -1/-1，看不出哪条错）
  eq(d[0] && d[0].id, DEAD, '★ 报的正是那个悬空 id')

  // 反例：引用存在的 id 不报
  const r2 = lintWhiteboardPre([
    mk(A, '甲卡', { body: '见 ' + B }),
    mk(B, '乙卡', { body: '见 ' + A }),
  ], { now: NOW })
  eq(byCode(r2, WB_LINT_CODES_PRE_V1.DANGLING_REF).length, 0, '反例：引用存在的 id 不报')

  // 外部 corpus 里出现的 id 也算"被引用"
  const r3 = lintWhiteboardPre([mk(A, '甲卡', { body: 'x' })], { now: NOW, corpus: '笔记引用了 ' + DEAD })
  eq(byCode(r3, WB_LINT_CODES_PRE_V1.DANGLING_REF).length, 1, '外部语料里的悬空引用也报')
}

// ── 4. ④ 缺交叉引用（tag 交集代言）────────────────────────────────
console.log('\n[4] ④ 缺交叉引用（共享 tag 却互不引用）')
{
  const r = lintWhiteboardPre([
    mk(A, '甲卡', { tags: ['topic:x', 'type:y'], body: '甲' }),
    mk(B, '乙卡', { tags: ['topic:x', 'type:y'], body: '乙' }),
  ], { now: NOW })
  eq(byCode(r, WB_LINT_CODES_PRE_V1.NO_CROSS_REF).length, 1, '共享 2 tag 互不引用 ⇒ 报 1 条')

  // 反例：已互引 ⇒ 不报
  const r2 = lintWhiteboardPre([
    mk(A, '甲卡', { tags: ['topic:x', 'type:y'], body: '见 ' + B }),
    mk(B, '乙卡', { tags: ['topic:x', 'type:y'], body: '见 ' + A }),
  ], { now: NOW })
  eq(byCode(r2, WB_LINT_CODES_PRE_V1.NO_CROSS_REF).length, 0, '反例：已互引 ⇒ 不报')

  // 反例：共享不足 minSharedTags ⇒ 不报（宁漏不误）
  const r3 = lintWhiteboardPre([
    mk(A, '甲卡', { tags: ['topic:x'], body: '甲' }),
    mk(B, '乙卡', { tags: ['topic:x'], body: '乙' }),
  ], { now: NOW })
  eq(byCode(r3, WB_LINT_CODES_PRE_V1.NO_CROSS_REF).length, 0, '★ 共享 1 tag（<2）⇒ 不报（宁漏不误）')

  // 单方引用也算已链
  const r4 = lintWhiteboardPre([
    mk(A, '甲卡', { tags: ['t1', 't2'], body: '见 ' + B }),
    mk(B, '乙卡', { tags: ['t1', 't2'], body: '乙' }),
  ], { now: NOW })
  eq(byCode(r4, WB_LINT_CODES_PRE_V1.NO_CROSS_REF).length, 0, '单方引用即算已链（不要求双向）')
}

// ── 5. ★ 只读纪律：跑完后文件 mtime 不变 ──────────────────────────
console.log('\n[5] ★ 只读纪律（契约 §6 尾注）')
{
  const target = 'lib/wb-contract-pre.js'
  const before = fs.statSync(target)
  const shaBefore = createHash('sha256').update(fs.readFileSync(target)).digest('hex')

  // 用真实白板语料跑一遍 lint（模拟真实调用）
  const docsDir = path.join(process.env.DSH_HOME || '', 'memory', 'workspaces')
  let realRuns = 0
  if (fs.existsSync(docsDir)) {
    for (const ws of fs.readdirSync(docsDir)) {
      const plan = path.join(docsDir, ws, 'handoff', 'PLAN.md')
      if (!fs.existsSync(plan)) continue
      const text = fs.readFileSync(plan, 'utf8')
      const entries = []
      const re = /^###\s+(.+)$/gm
      let m
      while ((m = re.exec(text))) {
        entries.push({ id: 'mem_' + createHash('sha256').update(ws + m[1]).digest('hex').slice(0, 32), title: m[1].trim(), body: text })
      }
      lintWhiteboardPre(entries, { now: NOW, corpus: text })
      realRuns++
    }
  }

  const after = fs.statSync(target)
  const shaAfter = createHash('sha256').update(fs.readFileSync(target)).digest('hex')
  eq(after.mtimeMs, before.mtimeMs, '★ 跑 lint 后文件 mtime 不变' + (realRuns ? '（含 ' + realRuns + ' 份真实白板语料）' : ''))
  eq(shaAfter, shaBefore, '★ 文件内容 SHA256 不变')

  // 源码级：lint 模块**不得** import 任何写盘 API
  const raw = fs.readFileSync(target, 'utf8')
  // 剥离注释再断言（JSDoc 里提到这些词会造成假阳性 —— 与 R3 裸 join 同源）
  let stripped = '', inBlock = false
  for (const line of raw.split(/\r?\n/)) {
    let code = line
    if (inBlock) { const c = code.indexOf('*/'); if (c < 0) { stripped += '\n'; continue } code = code.slice(c + 2); inBlock = false }
    code = code.replace(/\/\*[\s\S]*?\*\//g, '')
    const o = code.indexOf('/*')
    if (o >= 0) { code = code.slice(0, o); inBlock = true }
    stripped += code.replace(/\/\/.*$/, '') + '\n'
  }
  ok(!/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|renameSync/.test(stripped),
    '★ 源码级：本模块无任何写盘 API 调用')
  ok(raw.includes('writeFileSync') === false || !/writeFileSync/.test(stripped),
    '★ 剥离有效（注释里的词不算）')
}

// ── 6. ⑤ 矛盾检测：必须显式声明"未判"，不许静默省略 ────────────────
console.log('\n[6] ⑤ 矛盾检测的边界')
{
  const r = lintWhiteboardPre([mk(A, '甲')], { now: NOW })
  ok(Array.isArray(r.counts.notChecked) && r.counts.notChecked.includes('contradiction'),
    '★ 显式声明 contradiction 未判（契约 §6：需 LLM，手动触发）')
  ok(!codes(r).includes('contradiction'), 'lint 结果里不出现 contradiction 码')

  // 五类码常量齐备（防字符串枚举写错被静默忽略）
  const expectCodes = ['orphan', 'inactive', 'expired', 'dangling-ref', 'no-cross-ref']
  for (const c of expectCodes) {
    ok(Object.values(WB_LINT_CODES_PRE_V1).includes(c), '码常量含 ' + c)
  }
  eq(Object.keys(WB_LINT_CODES_PRE_V1).length, 5, '★ 恰好 5 个码（多一个少一个都要红）')
}

// ── 7. fail-soft：坏输入不抛 ──────────────────────────────────────
console.log('\n[7] fail-soft（坏输入不抛，不打断整轮）')
{
  let threw = false
  try {
    lintWhiteboardPre(null); lintWhiteboardPre(undefined); lintWhiteboardPre('x')
    lintWhiteboardPre(42); lintWhiteboardPre([null, 1, 'x', {}, { id: A }, { title: '有题无 id' }])
    lintWhiteboardPre([mk(A, '甲')], null); lintWhiteboardPre([mk(A, '甲')], 'x')
    lintWhiteboardPre([mk(A, '甲')], { now: 'not-a-date', staleDays: 'x', minSharedTags: null })
  } catch (_) { threw = true }
  ok(!threw, '★ 全部坏输入均不抛')

  const r = lintWhiteboardPre([null, 1, 'x', {}, mk(A, '甲')], { now: NOW })
  eq(r.counts.skipped, 4, '坏条目计入 skipped')
  eq(r.counts.cards, 1, '好条目照常判')

  const r2 = lintWhiteboardPre(null, { now: NOW })
  ok(r2 && r2.ok === true && r2.counts.cards === 0, 'null 输入 ⇒ 空结果且 ok=true')

  const r3 = lintWhiteboardPre({ entries: [mk(A, '甲', { status: 'superseded' })] }, { now: NOW })
  eq(r3.counts.cards, 1, '★ 支持直接传 sidecar index（含 entries 字段）')
}

// ── 8. 确定性 + 契约常量 ──────────────────────────────────────────
console.log('\n[8] 确定性与常量')
{
  const input = [
    mk(A, '甲卡', { tags: ['t1', 't2'], body: '甲' }),
    mk(B, '乙卡', { tags: ['t1', 't2'], body: '乙' }),
    mk(C, '丙卡', { status: 'superseded' }),
  ]
  const sig = (r) => JSON.stringify(r.findings)
  eq(sig(lintWhiteboardPre(input, { now: NOW })), sig(lintWhiteboardPre(input, { now: NOW })), '★ 同输入同输出（确定性）')

  eq(WB_LINT_VERSION, 'wb_lint_pre_v1', '版本常量')
  eq(WB_LINT_DEFAULTS_PRE_V1.staleDays, 90, '默认 staleDays=90')
  eq(WB_LINT_DEFAULTS_PRE_V1.minSharedTags, 2, '默认 minSharedTags=2')

  // 结果形状稳定
  const r = lintWhiteboardPre([mk(A, '甲')], { now: NOW })
  ok(typeof r.ok === 'boolean' && Array.isArray(r.findings) && r.counts && typeof r.counts === 'object',
    '返回形状 {version, ok, findings, counts}')
  ok(typeof r.version === 'string', 'version 存在')
}

console.log('\n=== M2-lint: PASS ' + pass + ' / FAIL ' + fail + ' ===')
if (fail > 0) process.exitCode = 1
