/**
 * smoke-test-calendar-multiline-254 —— #254 MAINT-01（方案 B'「缩进续行」）行为级验收。
 *
 * 判据纪律（CR-10）：真 import → 真构造 → 真调用 → 断言**返回值与磁盘副作用**；每条都配负路径。
 * 三条路径全部覆盖（两处解析同口径是本条硬红线）：
 *   ① lib/index.js 的 parseCalendar（主路径解析）
 *   ② lib/index.js 的 renderCalendar（主路径渲染）
 *   ③ lib/migrate-pack.js 的 calendarMergePre（孪生解析 + 孪生渲染）
 *
 * 负路径：真变异（去掉续行识别 / 去掉续行渲染）后重新 import，断言必须变红。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok - ' + m) } else { fail++; console.error('  FAIL - ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' | got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)))

/** 以 data: URL 载入产线模块（可定点变异，锚串必须恰命中 1 次）。 */
async function importMutated(rel, replacements = []) {
  const abs = path.join(ROOT, rel)
  let src = fs.readFileSync(abs, 'utf8')
  for (const [from, to] of replacements) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 50)) + ' hits=' + hits)
    const next = src.replace(from, to)
    assert.notEqual(next, src, 'mutation must change the source')
    src = next
  }
  const base = pathToFileURL(abs).href
  src = src.replace(/from '([^']+)'/g, (m, spec) => spec.startsWith('.') ? 'from ' + JSON.stringify(new URL(spec, base).href) : m)
  return await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'))
}
const loadEngineModule = async () => await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'audit-engine.mjs')).href + '?v=' + Math.random())

/** 变异版引擎：把定点变异后的 lib/index.js 写到临时文件，经 audit-engine shim 真加载（暴露 MemoryEngine）。 */
const osMod = await import('node:os')
async function loadMutatedEngine(replacements) {
  const abs = path.join(ROOT, 'lib', 'index.js')
  let src = fs.readFileSync(abs, 'utf8')
  for (const [from, to] of replacements) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 60)) + ' hits=' + hits)
    const next = src.replace(from, to)
    assert.notEqual(next, src, 'mutation must change the source')
    src = next
  }
  const dir = fs.mkdtempSync(path.join(osMod.tmpdir(), 'dam-254-mut-'))
  const file = path.join(dir, 'index-mutant.mjs')
  fs.writeFileSync(file, src, 'utf8')
  const prev = process.env.DAM_AUDIT_ENGINE_SOURCE
  process.env.DAM_AUDIT_ENGINE_SOURCE = file
  try {
    return await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'audit-engine.mjs')).href + '?m=' + Math.random())
  } finally {
    if (prev === undefined) delete process.env.DAM_AUDIT_ENGINE_SOURCE
    else process.env.DAM_AUDIT_ENGINE_SOURCE = prev
  }
}
const loadMigrate = async () => await import(pathToFileURL(path.join(ROOT, 'lib', 'migrate-pack.js')).href)

/** 从真引擎取 parseCalendar / renderCalendar（真方法，非重写）。 */
async function realCalendarFns() {
  const mod = await loadEngineModule()
  const eng = new mod.MemoryEngine()
  return { parse: eng.parseCalendar.bind(eng), render: eng.renderCalendar.bind(eng) }
}

const MULTI = [
  '备注首行',
  '备注第二行（缩进续行）',
  '备注第三行',
].join('\n')

// ══════════════════════════════════════════════════════════════
console.log('[①] 主路径 parseCalendar / renderCalendar')
// ══════════════════════════════════════════════════════════════
{
  const { parse, render } = await realCalendarFns()

  // ①-1 兼容：无续行的旧文件解析结果与改动前逐字段相同（基线由本套件硬编码钉死）
  const LEGACY = [
    '# 日历与日程 (CALENDAR)', '',
    '> 由 dsh-auto-memory 维护;AI 可从对话中提取 deadline/约定写入,用户也可在 GUI 操作.', '',
    '## 2026-10-20',
    '- [ ] 09:00 | 重要紧急 | 交报告 | 单行备注',
    '- [x] --:-- | 未分类 | 无时限条目',
    '',
    '## 2026-10-21',
    '- [ ] 23:59 | 不重要不紧急 | BME1D02 数据提交',
    '',
  ].join('\n')
  eq(parse(LEGACY), [
    { date: '2026-10-20', done: false, time: '09:00', quadrant: '重要紧急', title: '交报告', note: '单行备注' },
    { date: '2026-10-20', done: true, time: '--:--', quadrant: '未分类', title: '无时限条目', note: '' },
    { date: '2026-10-21', done: false, time: '23:59', quadrant: '不重要不紧急', title: 'BME1D02 数据提交', note: '' },
  ], '① 旧文件（无续行）解析逐字段不变（含 --:-- 与空备注）')

  // ①-2 单行渲染与改动前逐字节一致
  eq(render([
    { date: '2026-10-20', time: '09:00', quadrant: '重要紧急', title: '交报告', note: '单行备注' },
    { date: '2026-10-20', time: '--:--', quadrant: '未分类', title: '无时限条目', note: '' },
  ]), [
    '# 日历与日程 (CALENDAR)', '',
    '> 由 dsh-auto-memory 维护;AI 可从对话中提取 deadline/约定写入,用户也可在 GUI 操作。', '',
    '## 2026-10-20',
    '- [ ] --:-- | 未分类 | 无时限条目',
    '- [ ] 09:00 | 重要紧急 | 交报告 | 单行备注',
    '',
  ].join('\n'), '① 单行备注渲染逐字节不变（含 " | " 分隔、标题行文案与既有时间排序）')

  // ①-3 典型形态：B' 目标格式
  const rows = [{ date: '2026-10-20', done: false, time: '09:00', quadrant: '重要不紧急', title: '交报告', note: MULTI }]
  const rendered = render(rows)
  const lines = rendered.split('\n')
  const i = lines.findIndex((l) => l.startsWith('- ['))
  eq(lines.slice(i, i + 3), [
    '- [ ] 09:00 | 重要不紧急 | 交报告 | 备注首行',
    '    备注第二行（缩进续行）',
    '    备注第三行',
  ], '① 多行备注按**缩进续行**输出（目标形态逐行一致）')

  // ①-4 round-trip 幂等 + 二次 render 逐字节稳定
  const back = parse(rendered)
  eq(back.length, 1, '① 解析回单条目（续行没被当成新条目）')
  eq(back[0].note, MULTI, '① round-trip：note 三行完整往返')
  eq(back[0], rows[0], '① round-trip：条目逐字段一致')
  const again = render(back)
  eq(again === rendered, true, '① 二次 render 逐字节相同（写盘不会每次长一行）')
  eq(parse(again)[0].note, MULTI, '① 三轮往返仍稳定')

  // ①-5 边界：缩进续行不吞标题 / 下一条目 / 空行终止
  const boundary = [
    '## 2026-10-20',
    '- [ ] 09:00 | 重要紧急 | A | 首行',
    '    续1',
    '',
    '    空行之后这行**不算**A 的续行',
    '## 2026-10-21',
    '- [ ] 10:00 | 重要紧急 | B',
    '\tTab 缩进也算续行',
    '- [ ] 11:00 | 重要紧急 | C',
    '',
  ].join('\n')
  const b = parse(boundary)
  eq(b.map((x) => x.title), ['A', 'B', 'C'], '① 续行不吞掉后续条目（>=3 条）')
  eq(b[0].note, '首行\n续1', '① 条目自身的缩进续行被收进 note')
  eq(b[1].note, 'Tab 缩进也算续行', '① Tab 缩进同样是续行')
  eq(!!b[0].note.includes('空行之后'), false, '① 空行**终止**续行段（其后缩进行不入 note）')
  eq(b[2].note, '', '① 非缩进的后续条目不受影响')

  // ①-6 边界：备注里自带条目样式的行，仍按续行收（不被误判为新条目）
  const tricky = [
    '## 2026-10-20',
    '- [ ] 09:00 | 重要紧急 | A | 首行',
    '    - [ ] 09:30 | 重要紧急 | 这是备注里的行',
    '',
  ].join('\n')
  const t = parse(tricky)
  eq(t.length, 1, '① 缩进的「条目样式行」不算新条目（按续行收）')
  eq(t[0].note, '首行\n- [ ] 09:30 | 重要紧急 | 这是备注里的行', '① 其原文完整进 note')
}

// ══════════════════════════════════════════════════════════════
console.log('[②] ③ 孪生解析/渲染：calendarMergePre 与主路径**同口径**')
// ══════════════════════════════════════════════════════════════
{
  const { parse } = await realCalendarFns()
  const { calendarMergePre } = await loadMigrate()

  const local = [
    '# 日历与日程 (CALENDAR)', '',
    '> 由 dsh-auto-memory 维护;AI 可从对话中提取 deadline/约定写入,用户也可在 GUI 操作。', '',
    '## 2026-10-20',
    '- [ ] 09:00 | 重要紧急 | 交报告 | 备注首行',
    '    备注第二行（缩进续行）',
    '    备注第三行',
    '',
  ].join('\n')
  // ⚠️ 迁移合成会过滤无日期的条目；此处两份输入都带日期，故两边条目集合一致
  const merged = calendarMergePre(local, local)
  ok(merged.ok === true, '③ calendarMergePre 正常返回')
  const mergedRows = merged.text.split('\n').filter((l) => l.startsWith('- ['))
  ok(mergedRows.length === 1, '③ 合并输出仍是 1 条（续行没变成新条目，实 ' + mergedRows.length + '）')
  eq(merged.text.includes('    ' + '备注第二行（缩进续行）'), true, '③ 合并输出**保留缩进续行**（第二个出口未压平）')
  eq(merged.text, local, '③ 合并输出与输入逐字节相同（幂等）')

  // 同口径断言：同一份含多行备注的文本，两处解析逐字段相同
  const a = parse(local)
  const bMerged = calendarMergePre(local, '').text
  const b = parse(bMerged)
  eq(b, a, '③ 迁移输出的文本再经主路径解析 ⇒ 与直接解析逐字段相同')

  // 更难的一份：含 --:--、Tab 缩进、空行终止
  const tricky = [
    '## 2026-10-20',
    '- [ ] --:-- | 未分类 | 条目一 | 首行',
    '    续行甲',
    '',
    '- [ ] 09:00 | 重要紧急 | 条目二',
    '\t续行乙',
    '',
  ].join('\n')
  const fromIndex = parse(tricky)
  const viaMerge = parse(calendarMergePre(tricky, tricky).text)
  eq(viaMerge, fromIndex, '③ 边界样本（--:--/Tab/空行）两边解析逐字段一致')
  eq(fromIndex.map((x) => x.note), ['首行\n续行甲', '续行乙'], '③ 边界样本 note 还原正确')
}

// ══════════════════════════════════════════════════════════════
console.log('[③] 端到端：calendarAdd 写多行 → calendarDone → 第 2/3 行仍在（原缺陷复现路径）')
// ══════════════════════════════════════════════════════════════
{
  const os = await import('node:os')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-254-'))
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = root }
  try {
    const mod = await loadEngineModule()
    const eng = new mod.MemoryEngine()
    eng._configPath = path.join(root, 'dsh-auto-memory.json')
    fs.writeFileSync(eng._configPath, JSON.stringify({ teamEnabled: false, memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), globalBriefEnabled: false }), 'utf8')
    const p = await eng.resolvePaths(undefined)
    fs.mkdirSync(path.dirname(p.calendarPath), { recursive: true })

    const addRes = await eng.calendarAdd({ date: '2026-10-20', time: '09:00', quadrant: '重要不紧急', title: '交报告', note: MULTI })
    ok(/已加入日历/.test(String(addRes)), '端到端：calendarAdd 返回成功（' + String(addRes).slice(0, 40) + '）')
    const afterAdd = fs.readFileSync(p.calendarPath, 'utf8')
    eq(afterAdd.includes('    备注第二行（缩进续行）'), true, '端到端：写盘后第 2 行**在盘上**（缩进形态）')
    eq(afterAdd.includes('    备注第三行'), true, '端到端：写盘后第 3 行**在盘上**')

    const doneRes = await eng.calendarDone('2026-10-20', '09:00', '交报告')
    ok(/已标记完成/.test(String(doneRes)), '端到端：calendarDone 找到并标记该条目')
    const afterDone = fs.readFileSync(p.calendarPath, 'utf8')
    eq(afterDone.includes('    备注第二行（缩进续行）'), true, '★ 端到端：做完下一次操作后第 2 行**仍在**（原缺陷的复现路径）')
    eq(afterDone.includes('    备注第三行'), true, '★ 端到端：第 3 行**仍在**')
    eq(afterDone.includes('- [x] 09:00 | 重要不紧急 | 交报告 | 备注首行'), true, '★ 端到端：状态位已翻转且备注首行保留')
    eq(eng.parseCalendar(afterDone)[0].note, MULTI, '★ 端到端：重新解析 note 三行完整')

    const removeRes = await eng.calendarRemove('2026-10-20', '09:00', '交报告')
    ok(/已删除/.test(String(removeRes)), '端到端：calendarRemove 正常删除')
  } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    try { fs.rmSync(root, { recursive: true, force: true }) } catch (_) {}
  }
}

// ══════════════════════════════════════════════════════════════
console.log('[④] 负路径（变异必红）：去掉续行识别 / 去掉续行渲染')
// ══════════════════════════════════════════════════════════════
{
  // ④-1 去掉续行**识别**（主路径）：多行 note 只存首行
  const noParse = await loadMutatedEngine([[
    "      if (cur >= 0 && /^[ \\t]/.test(raw)) { extras[cur].push(line); continue }",
    "      if (false) { extras[cur].push(line); continue }",
  ]])
  const engA = new noParse.MemoryEngine()
  const mutText = [
    '## 2026-10-20',
    '- [ ] 09:00 | 重要不紧急 | 交报告 | 备注首行',
    '    备注第二行（缩进续行）',
    '    备注第三行',
    '',
  ].join('\n')
  ok(engA.parseCalendar(mutText)[0].note === '备注首行',
    '★ 负路径①（去掉续行识别）：note 退回只存首行 ⇒ 第 2/3 行丢失（实 ' + JSON.stringify(engA.parseCalendar(mutText)[0].note) + '）')

  // ④-2 去掉续行**渲染**：note 被压回单行（round-trip 断裂）
  const noRender = await loadMutatedEngine([[
    "        const parts = en.note ? String(en.note).split('\\n') : []",
    "        const parts = en.note ? [String(en.note).replace(/\\n/g, ' ')] : []",
  ]])
  const engB = new noRender.MemoryEngine()
  const mutRendered = engB.renderCalendar([{ date: '2026-10-20', time: '09:00', quadrant: '重要不紧急', title: '交报告', note: MULTI }])
  const mutBack = engB.parseCalendar(mutRendered)[0]
  ok(mutBack.note !== MULTI, '★ 负路径②（去掉续行渲染）：round-trip 断裂（note 被压平，实 ' + JSON.stringify(mutBack.note) + '）')
  const fixedRendered = (await realCalendarFns()).render([{ date: '2026-10-20', time: '09:00', quadrant: '重要不紧急', title: '交报告', note: MULTI }])
  const nonEmpty = (s) => s.split('\n').filter((l) => l.trim()).length
  ok(nonEmpty(mutRendered) === nonEmpty(fixedRendered) - 2,
    '★ 负路径②：渲染行数少 2 行（不再有续行行：实 ' + nonEmpty(mutRendered) + ' vs 修复版 ' + nonEmpty(fixedRendered) + '）')

  // ④-3 去掉迁移侧续行（第三个出口）：合并输出把多行压平
  const migMut = await importMutated('lib/migrate-pack.js', [[
    "      for (let i = 1; i < parts.length; i++) lines.push('    ' + parts[i])",
    "      for (let i = 1; i < 0; i++) lines.push('    ' + parts[i])",
  ]])
  const local = [
    '## 2026-10-20',
    '- [ ] 09:00 | 重要紧急 | 交报告 | 备注首行',
    '    备注第二行（缩进续行）',
    '',
  ].join('\n')
  const outMut = migMut.calendarMergePre(local, local).text
  ok(outMut.includes('    备注第二行') === false, '★ 负路径③（去掉迁移侧续行渲染）：合并输出把第 2 行压平（第二个出口复现）')
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
